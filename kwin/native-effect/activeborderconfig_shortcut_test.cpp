#include "activeborderconfig_module.h"
#include "shortcutreconciler.h"

#include <KPluginMetaData>

#include <QApplication>
#include <QClipboard>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QLabel>
#include <QMimeData>
#include <QPushButton>
#include <QTemporaryDir>

#include <cstdio>
#include <cstdlib>
#include <sys/stat.h>
#include <unistd.h>

namespace
{

int failures = 0;

void check(bool condition, const char *expression, const char *file, int line)
{
    if (!condition) {
        std::fprintf(stderr, "FAIL: %s (%s:%d)\n", expression, file, line);
        ++failures;
    }
}

#define CHECK(expression) check(expression, #expression, __FILE__, __LINE__)

using namespace KWin;

constexpr int META_L = 268435532;
constexpr int META_ESC = 285212672;
constexpr int META_ALT_K = 402653259;
constexpr int META_ALT_L = 402653260;
constexpr int META_G = 268435527;
constexpr int META_M = 268435533;

ShortcutTuple makeTuple(const QString &component, const QString &action, const QList<int> &active)
{
    ShortcutTuple tuple;
    tuple.component = component;
    tuple.action = action;
    tuple.componentFriendly = component == QStringLiteral("kwin") ? QStringLiteral("KWin") : QStringLiteral("KDE Session Manager");
    tuple.friendly = action;
    tuple.active = active;
    return tuple;
}

class FakeShortcutStore : public ShortcutStore
{
public:
    QList<ShortcutTuple> tuples;
    QString owner = QStringLiteral(":1.20");
    uint uid = static_cast<uint>(::geteuid());
    bool contractPresent = true;
    // Mirrors the real backend: validated through the shared strict parser.
    QString contractXml = QStringLiteral(
        "<node><interface name=\"org.kde.KGlobalAccel\">"
        "<method name=\"setShortcutKeys\">"
        "<arg type=\"as\" direction=\"in\"/>"
        "<arg type=\"a(ai)\" direction=\"in\"/>"
        "<arg type=\"u\" direction=\"in\"/>"
        "<arg type=\"a(ai)\" direction=\"out\"/>"
        "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
        "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
        "</method></interface></node>");
    bool malformedRead = false;
    QMap<int, QList<ShortcutKeyHolder>> extraByKey;
    QMap<int, bool> availableOverride;
    bool failByKey = false;
    bool failAvailable = false;
    struct WriteRecord
    {
        QString component;
        QString action;
        QList<int> keys;
    };
    QList<WriteRecord> writeLog;

    bool checkSetterContract(QString *error) override
    {
        if (!contractPresent) {
            if (error) {
                *error = QStringLiteral(
                    "KGlobalAccel setShortcutKeys is absent or does not expose exactly as,a(ai),u -> a(ai) with QSet<QKeySequence>");
            }
            return false;
        }
        if (!ShortcutReconciler::introspectionContractValid(contractXml)) {
            if (error) {
                *error = QStringLiteral(
                    "KGlobalAccel setShortcutKeys is absent or does not expose exactly as,a(ai),u -> a(ai) with QSet<QKeySequence>");
            }
            return false;
        }
        return true;
    }

    bool currentOwner(QString *outOwner, uint *outUid, QString *error) override
    {
        if (!ShortcutReconciler::uniqueNameValid(owner)) {
            if (error) {
                *error = QStringLiteral("owner reply is malformed");
            }
            return false;
        }
        if (outOwner) {
            *outOwner = owner;
        }
        if (outUid) {
            *outUid = uid;
        }
        return true;
    }

    bool readAll(QList<ShortcutTuple> *out, QString *error) override
    {
        if (malformedRead) {
            if (error) {
                *error = QStringLiteral("unexpected reply");
            }
            return false;
        }
        for (const ShortcutTuple &tuple : tuples) {
            if (!ShortcutReconciler::keysValid(tuple.active) || !ShortcutReconciler::stringValid(tuple.component)
                || !ShortcutReconciler::stringValid(tuple.action) || !ShortcutReconciler::cosmeticValid(tuple.friendly)
                || !ShortcutReconciler::cosmeticValid(tuple.componentFriendly)) {
                if (error) {
                    *error = QStringLiteral("unexpected reply");
                }
                return false;
            }
        }
        if (tuples.size() > SHORTCUT_MAX_TUPLES) {
            if (error) {
                *error = QStringLiteral("unexpected reply");
            }
            return false;
        }
        if (out) {
            *out = tuples;
        }
        return true;
    }

    bool shortcutsByKey(int key, QList<ShortcutKeyHolder> *holders, QString *error) override
    {
        if (failByKey) {
            if (error) {
                *error = QStringLiteral("globalShortcutsByKey call failed");
            }
            return false;
        }
        QList<ShortcutKeyHolder> combined;
        for (const ShortcutTuple &tuple : tuples) {
            if (tuple.active.contains(key)) {
                ShortcutKeyHolder holder;
                holder.component = tuple.component;
                holder.action = tuple.action;
                holder.active = tuple.active;
                combined.append(holder);
            }
        }
        combined.append(extraByKey.value(key));
        if (holders) {
            *holders = combined;
        }
        return true;
    }

    bool shortcutAvailable(int key, const QString &component, bool *available, QString *error) override
    {
        Q_UNUSED(component);
        if (failAvailable) {
            if (error) {
                *error = QStringLiteral("globalShortcutAvailable call failed");
            }
            return false;
        }
        if (availableOverride.contains(key)) {
            if (available) {
                *available = availableOverride.value(key);
            }
            return true;
        }
        QList<ShortcutKeyHolder> combined;
        for (const ShortcutTuple &tuple : tuples) {
            if (tuple.active.contains(key)) {
                ShortcutKeyHolder holder;
                holder.component = tuple.component;
                holder.action = tuple.action;
                holder.active = tuple.active;
                combined.append(holder);
            }
        }
        combined.append(extraByKey.value(key));
        if (available) {
            *available = combined.isEmpty();
        }
        return true;
    }

    bool writeKeys(const QString &component, const QString &action, const QString &componentFriendly,
                   const QString &friendly, const QList<int> &keys, QList<int> *confirmed, QString *error) override
    {
        if (!ShortcutReconciler::isAllowlisted(component, action)) {
            if (error) {
                *error = QStringLiteral("refusing write outside the exact allowlist");
            }
            return false;
        }
        if (!ShortcutReconciler::keysValid(keys) || !ShortcutReconciler::stringValid(component)
            || !ShortcutReconciler::stringValid(action) || !ShortcutReconciler::cosmeticValid(componentFriendly)
            || !ShortcutReconciler::cosmeticValid(friendly)) {
            if (error) {
                *error = QStringLiteral("refusing write with unbounded tuple");
            }
            return false;
        }
        if (writeLog.size() >= 64) {
            if (error) {
                *error = QStringLiteral("refusing write beyond the lifetime bound");
            }
            return false;
        }
        writeLog.append({component, action, keys});
        for (ShortcutTuple &tuple : tuples) {
            if (tuple.component == component && tuple.action == action) {
                tuple.active = keys;
                break;
            }
        }
        if (confirmed) {
            *confirmed = keys;
        }
        return true;
    }

    int writeCount() const override
    {
        return writeLog.size();
    }
};

class FakeJournal : public JournalStore
{
public:
    bool present = false;
    ShortcutJournal stored;
    int persists = 0;

    bool hasJournal() const override
    {
        return present;
    }

    bool load(ShortcutJournal *journal, QString *error) const override
    {
        if (!present) {
            if (error) {
                *error = QStringLiteral("no journal");
            }
            return false;
        }
        // Mirror the real KConfig backend load validation.
        if (stored.schema == QStringLiteral("shortcut-override-v1")) {
            if (error) {
                *error = QStringLiteral("journal schema version v1 is unsupported; expected shortcut-override-v3 (upgrade required, no migration)");
            }
            return false;
        }
        const bool isV2 = stored.schema == shortcutJournalSchemaV2();
        if (!isV2 && stored.schema != shortcutJournalSchema()) {
            if (error) {
                *error = QStringLiteral("journal schema is unknown");
            }
            return false;
        }
        if (stored.phase != shortcutJournalPhasePending() && stored.phase != shortcutJournalPhaseFocusApplied()
            && stored.phase != shortcutJournalPhaseComplete()) {
            if (error) {
                *error = QStringLiteral("journal phase is unknown");
            }
            return false;
        }
        if (!ShortcutReconciler::journalRolesValid(stored)) {
            if (error) {
                *error = QStringLiteral("journal roles are swapped or not the exact allowlist");
            }
            return false;
        }
        if (!ShortcutReconciler::journalPostsValid(stored)) {
            if (error) {
                *error = QStringLiteral("journal postimage is not the allowed image");
            }
            return false;
        }
        if (!ShortcutReconciler::uniqueNameValid(stored.owner)) {
            if (error) {
                *error = QStringLiteral("journal owner is malformed");
            }
            return false;
        }
        {
            const ShortcutJournalEntry entries[6] = {stored.focus, stored.lock, stored.resizeUp, stored.switchNext,
                                                     stored.resizeRight, stored.switchLast};
            for (const auto &e : entries) {
                if (!ShortcutReconciler::keysValid(e.pre) || !ShortcutReconciler::keysValid(e.post)
                    || !ShortcutReconciler::isAllowlisted(e.component, e.action)) {
                    if (error) {
                        *error = QStringLiteral("journal entries are outside the exact allowlist");
                    }
                    return false;
                }
            }
            if (!isV2) {
                const ShortcutJournalEntry extra[4] = {stored.floatToggle, stored.gridView, stored.maximizeToggle,
                                                       stored.monocle};
                for (const auto &e : extra) {
                    if (!ShortcutReconciler::keysValid(e.pre) || !ShortcutReconciler::keysValid(e.post)
                        || !ShortcutReconciler::isAllowlisted(e.component, e.action)) {
                        if (error) {
                            *error = QStringLiteral("journal entries are outside the exact allowlist");
                        }
                        return false;
                    }
                }
            }
        }
        if (journal) {
            *journal = stored;
        }
        return true;
    }

    bool persist(const ShortcutJournal &journal, QString *error) override
    {
        if (journal.schema == QStringLiteral("shortcut-override-v1")) {
            if (error) {
                *error = QStringLiteral("journal schema version v1 is unsupported; expected shortcut-override-v3 (upgrade required, no migration)");
            }
            return false;
        }
        const bool persistV2 = journal.schema == shortcutJournalSchemaV2();
        if (!persistV2 && journal.schema != shortcutJournalSchema()) {
            if (error) {
                *error = QStringLiteral("journal schema is unknown");
            }
            return false;
        }
        if (journal.phase != shortcutJournalPhasePending() && journal.phase != shortcutJournalPhaseFocusApplied()
            && journal.phase != shortcutJournalPhaseComplete()) {
            if (error) {
                *error = QStringLiteral("refusing to persist a journal with an unknown phase");
            }
            return false;
        }
        if (!ShortcutReconciler::uniqueNameValid(journal.owner)) {
            if (error) {
                *error = QStringLiteral("refusing to persist a journal with a malformed owner");
            }
            return false;
        }
        if (journal.uid != static_cast<uint>(::geteuid())) {
            if (error) {
                *error = QStringLiteral("refusing to persist a journal with a foreign UID");
            }
            return false;
        }
        if (!ShortcutReconciler::journalRolesValid(journal) || !ShortcutReconciler::journalPostsValid(journal)) {
            if (error) {
                *error = QStringLiteral("refusing to persist a journal outside the exact allowlist");
            }
            return false;
        }
        {
            const ShortcutJournalEntry entries[6] = {journal.focus, journal.lock, journal.resizeUp, journal.switchNext,
                                                     journal.resizeRight, journal.switchLast};
            for (const auto &e : entries) {
                if (!ShortcutReconciler::keysValid(e.pre) || !ShortcutReconciler::keysValid(e.post)
                    || !ShortcutReconciler::isAllowlisted(e.component, e.action)) {
                    if (error) {
                        *error = QStringLiteral("refusing to persist a journal outside the exact allowlist");
                    }
                    return false;
                }
            }
            if (!persistV2) {
                const ShortcutJournalEntry extra[4] = {journal.floatToggle, journal.gridView,
                                                       journal.maximizeToggle, journal.monocle};
                for (const auto &e : extra) {
                    if (!ShortcutReconciler::keysValid(e.pre) || !ShortcutReconciler::keysValid(e.post)
                        || !ShortcutReconciler::isAllowlisted(e.component, e.action)) {
                        if (error) {
                            *error = QStringLiteral("refusing to persist a journal outside the exact allowlist");
                        }
                        return false;
                    }
                }
            }
        }
        stored = journal;
        present = true;
        ++persists;
        const ShortcutJournal readback = stored;
        const ShortcutJournalEntry exp[10] = {journal.focus, journal.lock, journal.resizeUp, journal.switchNext,
                                              journal.resizeRight, journal.switchLast, journal.floatToggle,
                                              journal.gridView, journal.maximizeToggle, journal.monocle};
        const ShortcutJournalEntry got[10] = {readback.focus, readback.lock, readback.resizeUp, readback.switchNext,
                                              readback.resizeRight, readback.switchLast, readback.floatToggle,
                                              readback.gridView, readback.maximizeToggle, readback.monocle};
        for (int i = 0; i < 10; ++i) {
            if (got[i].component != exp[i].component || got[i].action != exp[i].action || got[i].pre != exp[i].pre
                || got[i].post != exp[i].post) {
                if (error) {
                    *error = QStringLiteral("journal readback mismatch");
                }
                return false;
            }
        }
        if (readback.schema != journal.schema || readback.phase != journal.phase || readback.owner != journal.owner
            || readback.uid != journal.uid || readback.row0Kind != journal.row0Kind || readback.row1Kind != journal.row1Kind
            || readback.row2Kind != journal.row2Kind || readback.row3Kind != journal.row3Kind
            || readback.row4Kind != journal.row4Kind) {
            if (error) {
                *error = QStringLiteral("journal readback mismatch");
            }
            return false;
        }
        return true;
    }

    bool remove(QString * /*error*/) override
    {
        present = false;
        return true;
    }
};

QPushButton *buttonByName(ActiveBorderConfigModule &module, const char *name)
{
    return module.widget()->findChild<QPushButton *>(QString::fromLocal8Bit(name));
}

QLabel *labelByName(ActiveBorderConfigModule &module, const char *name)
{
    return module.widget()->findChild<QLabel *>(QString::fromLocal8Bit(name));
}

void seedReady6(FakeShortcutStore &store, const QList<int> &focusPre, const QList<int> &lockPre)
{
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), focusPre),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), lockPre),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-resize-outwards-up"), QList<int>{7}),
        makeTuple(QStringLiteral("KDE Keyboard Layout Switcher"), QStringLiteral("Switch to Next Keyboard Layout"),
                  QList<int>{META_ALT_K}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-resize-outwards-right"), QList<int>{8}),
        makeTuple(QStringLiteral("KDE Keyboard Layout Switcher"), QStringLiteral("Switch to Last-Used Keyboard Layout"),
                  QList<int>{META_ALT_L}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-toggle-float"), QList<int>{META_G}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("Grid View"), QList<int>{META_G}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-toggle-maximize"), QList<int>{META_M}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("KrohnkiteMonocleLayout"), QList<int>{META_M}),
    };
}

void fillResizeReady(ShortcutJournal &journal, const QList<int> &upPre, const QList<int> &rightPre)
{
    journal.resizeUp = {shortcutResizeUpComponent(), shortcutResizeUpAction(), upPre, {META_ALT_K}};
    journal.switchNext = {shortcutSwitchNextComponent(), shortcutSwitchNextAction(), {META_ALT_K}, {}};
    journal.resizeRight = {shortcutResizeRightComponent(), shortcutResizeRightAction(), rightPre, {META_ALT_L}};
    journal.switchLast = {shortcutSwitchLastComponent(), shortcutSwitchLastAction(), {META_ALT_L}, {}};
    journal.floatToggle = {shortcutFloatComponent(), shortcutFloatAction(), {META_G}, {META_G}};
    journal.gridView = {shortcutGridViewComponent(), shortcutGridViewAction(), {META_G}, {}};
    journal.maximizeToggle = {shortcutMaximizeComponent(), shortcutMaximizeAction(), {META_M}, {META_M}};
    journal.monocle = {shortcutMonocleComponent(), shortcutMonocleAction(), {META_M}, {}};
    journal.row0Kind = shortcutResolutionRelocate();
    journal.row1Kind = shortcutResolutionClear();
    journal.row2Kind = shortcutResolutionClear();
    journal.row3Kind = shortcutResolutionClear();
    journal.row4Kind = shortcutResolutionClear();
}

void seedReady(FakeShortcutStore &store)
{
    seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
}

// Completed-v2 legacy journal: the known kcmshell6-host image, seeded
// through the same validation a real backend enforces.
void seedCompletedV2LegacyJournal(FakeJournal &journal)
{
    ShortcutJournal v2;
    v2.schema = shortcutJournalSchemaV2();
    v2.phase = shortcutJournalPhaseComplete();
    v2.owner = QStringLiteral(":1.20");
    v2.uid = static_cast<uint>(::geteuid());
    v2.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{419430420},
                QList<int>{META_L}};
    v2.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L},
               QList<int>{META_ESC}};
    v2.resizeUp = {shortcutResizeUpComponent(), shortcutResizeUpAction(), QList<int>{7}, {META_ALT_K}};
    v2.switchNext = {shortcutSwitchNextComponent(), shortcutSwitchNextAction(), {META_ALT_K}, {}};
    v2.resizeRight = {shortcutResizeRightComponent(), shortcutResizeRightAction(), QList<int>{8}, {META_ALT_L}};
    v2.switchLast = {shortcutSwitchLastComponent(), shortcutSwitchLastAction(), {META_ALT_L}, {}};
    v2.row0Kind = shortcutResolutionRelocate();
    v2.row1Kind = shortcutResolutionClear();
    v2.row2Kind = shortcutResolutionClear();
    QString error;
    CHECK(journal.persist(v2, &error));
    journal.persists = 0;
}

// Live bindings exactly at the completed-v2 postimage with the new rows at
// preimage: the legitimate upgrade resume state.
void seedV2CompletedLive6(FakeShortcutStore &store)
{
    seedReady6(store, QList<int>{META_L}, QList<int>{META_ESC});
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-resize-outwards-up")) {
            tuple.active = QList<int>{META_ALT_K};
        }
        if (tuple.action == QStringLiteral("Switch to Next Keyboard Layout")) {
            tuple.active = QList<int>{};
        }
        if (tuple.action == QStringLiteral("plasma-auto-tiler-resize-outwards-right")) {
            tuple.active = QList<int>{META_ALT_L};
        }
        if (tuple.action == QStringLiteral("Switch to Last-Used Keyboard Layout")) {
            tuple.active = QList<int>{};
        }
    }
}

void seedPartialJournal(FakeJournal &journal)
{
    ShortcutJournal partial;
    partial.schema = shortcutJournalSchema();
    partial.phase = shortcutJournalPhaseFocusApplied();
    partial.owner = QStringLiteral(":1.20");
    partial.uid = static_cast<uint>(::geteuid());
    partial.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{419430420}, QList<int>{META_L}};
    partial.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}, QList<int>{META_ESC}};
    fillResizeReady(partial, QList<int>{7}, QList<int>{8});
    QString error;
    CHECK(journal.persist(partial, &error));
    CHECK(partial.uid == static_cast<uint>(::geteuid()));
    journal.persists = 0;
}

void ordinarySettingsApplyNeverMutatesShortcuts()
{
    FakeShortcutStore store;
    seedReady(store);
    FakeJournal journal;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    int confirms = 0;
    module.setShortcutConfirmHandler([&](const QString &, const QString &) {
        ++confirms;
        return true;
    });
    module.setShortcutStores(&store, &journal);
    module.load();
    const int writesAfterLoad = store.writeLog.size();
    const int persistsAfterLoad = journal.persists;
    CHECK(writesAfterLoad == 0);
    module.refreshShortcutState();
    CHECK(store.writeLog.size() == 0);
    CHECK(journal.persists == persistsAfterLoad);
    CHECK(confirms == 0);
    module.save();
    CHECK(store.writeLog.size() == 0);
    CHECK(journal.persists == persistsAfterLoad);
    CHECK(confirms == 0);
    module.defaults();
    CHECK(store.writeLog.size() == 0);
    CHECK(journal.persists == persistsAfterLoad);
    CHECK(confirms == 0);
    module.save();
    CHECK(store.writeLog.size() == 0);
    CHECK(journal.persists == persistsAfterLoad);
    CHECK(confirms == 0);
    module.refreshShortcutState();
    CHECK(store.writeLog.size() == 0);
    CHECK(journal.persists == persistsAfterLoad);
    CHECK(confirms == 0);
    CHECK(!journal.hasJournal());
}

void contractRejectionSurfacesSplitSignatureWithoutStaleCombinedForm()
{
    // Legacy combined signature is rejected and surfaced with the split
    // live contract, never the erroneous combined form.
    {
        FakeShortcutStore store;
        seedReady(store);
        store.contractXml = QStringLiteral(
            "<node><interface name=\"org.kde.KGlobalAccel\">"
            "<method name=\"setShortcutKeys\">"
            "<arg type=\"asa(ai)u\" direction=\"in\"/>"
            "<arg type=\"a(ai)\" direction=\"out\"/>"
            "</method></interface></node>");
        FakeJournal journal;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &journal);
        module.load();
        CHECK(module.shortcutStatusText().contains(QStringLiteral("as,a(ai),u -> a(ai)")));
        CHECK(module.shortcutStatusText().contains(QStringLiteral("QSet<QKeySequence>")));
        CHECK(!module.shortcutStatusText().contains(QStringLiteral("asa(ai)u")));
        const int writesBefore = store.writeLog.size();
        module.refreshShortcutState();
        CHECK(store.writeLog.size() == writesBefore);
        CHECK(store.writeLog.isEmpty());
        module.requestShortcutApply();
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.hasJournal());
        CHECK(module.shortcutErrorText().contains(QStringLiteral("as,a(ai),u -> a(ai)")));
        CHECK(module.shortcutErrorText().contains(QStringLiteral("QSet<QKeySequence>")));
        CHECK(!module.shortcutErrorText().contains(QStringLiteral("asa(ai)u")));
    }
    // Absent contract likewise fails closed without the stale form.
    {
        FakeShortcutStore store;
        seedReady(store);
        store.contractPresent = false;
        FakeJournal journal;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &journal);
        module.load();
        CHECK(module.shortcutStatusText().contains(QStringLiteral("as,a(ai),u -> a(ai)")));
        CHECK(!module.shortcutStatusText().contains(QStringLiteral("asa(ai)u")));
        module.refreshShortcutState();
        CHECK(store.writeLog.isEmpty());
        module.requestShortcutApply();
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.hasJournal());
        CHECK(module.shortcutErrorText().contains(QStringLiteral("as,a(ai),u -> a(ai)")));
        CHECK(!module.shortcutErrorText().contains(QStringLiteral("asa(ai)u")));
    }
}

void recoveryVisibilityAndRouting()
{
    {
        FakeShortcutStore store;
        seedReady(store);
        FakeJournal journal;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &journal);
        module.load();
        CHECK(!module.isShortcutFinishApplyVisible());
        CHECK(!module.isShortcutRestoreVisible());
        CHECK(buttonByName(module, "shortcutApplyButton") != nullptr);
        CHECK(buttonByName(module, "shortcutRevertButton") != nullptr);
    }
    {
        FakeShortcutStore store;
        seedReady(store);
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.action == QStringLiteral("plasma-auto-tiler-focus-right")) {
                tuple.active = QList<int>{META_L};
            }
        }
        FakeJournal journal;
        seedPartialJournal(journal);
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &journal);
        module.load();
        CHECK(module.isShortcutFinishApplyVisible());
        CHECK(module.isShortcutRestoreVisible());
        CHECK(module.shortcutStatusText().contains(QStringLiteral("Interrupted")));
        const int writesBefore = store.writeLog.size();
        module.requestShortcutFinishApply();
        CHECK(store.writeLog.size() == writesBefore + 7);
        CHECK(store.writeLog.last().action == QStringLiteral("KrohnkiteMonocleLayout"));
        CHECK(module.shortcutErrorText().isEmpty());
        CHECK(!module.isShortcutFinishApplyVisible());
        CHECK(!module.isShortcutRestoreVisible());
    }
    {
        FakeShortcutStore store;
        seedReady(store);
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.action == QStringLiteral("plasma-auto-tiler-focus-right")) {
                tuple.active = QList<int>{META_L};
            }
        }
        FakeJournal journal;
        seedPartialJournal(journal);
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &journal);
        module.load();
        CHECK(module.isShortcutFinishApplyVisible());
        module.requestShortcutRestore();
        CHECK(!store.writeLog.isEmpty());
        CHECK(store.writeLog.last().component == QStringLiteral("kwin"));
        CHECK(module.shortcutErrorText().isEmpty());
    }
}

void confirmationGatesEveryMutation()
{
    FakeShortcutStore store;
    seedReady(store);
    FakeJournal journal;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    int confirms = 0;
    bool allow = false;
    module.setShortcutConfirmHandler([&](const QString &title, const QString &text) {
        ++confirms;
        CHECK(!title.isEmpty());
        CHECK(!text.isEmpty());
        return allow;
    });
    module.setShortcutStores(&store, &journal);
    module.load();
    module.requestShortcutApply();
    CHECK(confirms == 1);
    CHECK(store.writeLog.isEmpty());
    CHECK(!journal.hasJournal());
    allow = true;
    module.requestShortcutApply();
    CHECK(confirms == 2);
    CHECK(store.writeLog.size() == 8);
    CHECK(journal.hasJournal());
    allow = false;
    const int writesBeforeRevert = store.writeLog.size();
    module.requestShortcutRevert();
    CHECK(confirms == 3);
    CHECK(store.writeLog.size() == writesBeforeRevert);
    allow = true;
    QPushButton *restore = buttonByName(module, "shortcutRestoreButton");
    QPushButton *finish = buttonByName(module, "shortcutFinishApplyButton");
    CHECK(restore != nullptr);
    CHECK(finish != nullptr);
    // Force an interrupted journal to exercise the recovery buttons through
    // the same confirmed routing.
    FakeShortcutStore store2;
    seedReady(store2);
    for (ShortcutTuple &tuple : store2.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-focus-right")) {
            tuple.active = QList<int>{META_L};
        }
    }
    FakeJournal journal2;
    seedPartialJournal(journal2);
    ActiveBorderConfigModule recovery(nullptr, KPluginMetaData());
    int recoveryConfirms = 0;
    recovery.setShortcutConfirmHandler([&](const QString &, const QString &) {
        ++recoveryConfirms;
        return false;
    });
    recovery.setShortcutStores(&store2, &journal2);
    recovery.load();
    CHECK(recovery.isShortcutFinishApplyVisible());
    recovery.requestShortcutFinishApply();
    CHECK(recoveryConfirms == 1);
    CHECK(store2.writeLog.isEmpty());
}

void stateAndErrorPresentation()
{
    {
        FakeShortcutStore store;
        seedReady(store);
        FakeJournal journal;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &journal);
        module.load();
        CHECK(module.shortcutStatusText().contains(QStringLiteral("Ready")));
        CHECK(module.shortcutStatusText().contains(QStringLiteral("5 rows")));
        CHECK(module.shortcutStatusText().contains(QStringLiteral("Grid View")));
        CHECK(module.shortcutStatusText().contains(QStringLiteral("Monocle")));
        CHECK(module.shortcutStatusText().contains(QStringLiteral("resize-outwards-up")));
        CHECK(module.shortcutErrorText().isEmpty());
        QLabel *status = labelByName(module, "shortcutStatusLabel");
        QLabel *error = labelByName(module, "shortcutErrorLabel");
        CHECK(status != nullptr);
        CHECK(error != nullptr);
        if (status) {
            CHECK(status->text() == module.shortcutStatusText());
        }
        if (error) {
            CHECK(error->text() == module.shortcutErrorText());
        }
    }
    {
        FakeShortcutStore store;
        seedReady(store);
        store.tuples.append(makeTuple(QStringLiteral("kwin"), QStringLiteral("other-action"), QList<int>{META_ESC}));
        FakeJournal journal;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &journal);
        module.load();
        CHECK(module.shortcutStatusText().contains(QStringLiteral("Conflict")));
        CHECK(module.shortcutStatusText().contains(QStringLiteral("Meta+Esc")));
        module.requestShortcutApply();
        CHECK(store.writeLog.isEmpty());
        CHECK(!module.shortcutErrorText().isEmpty());
        CHECK(module.shortcutErrorText().contains(QStringLiteral("Meta+Esc")));
        QLabel *error = labelByName(module, "shortcutErrorLabel");
        if (error) {
            CHECK(error->text() == module.shortcutErrorText());
        }
        // Error is preserved across a read-only refresh.
        const QString preserved = module.shortcutErrorText();
        module.refreshShortcutState();
        CHECK(module.shortcutErrorText() == preserved);
        CHECK(module.shortcutStatusText().contains(QStringLiteral("Conflict")));
    }
    {
        FakeShortcutStore store;
        seedReady(store);
        FakeJournal journal;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &journal);
        module.load();
        module.requestShortcutApply();
        CHECK(module.shortcutErrorText().isEmpty());
        CHECK(module.shortcutStatusText().contains(QStringLiteral("applied")));
        CHECK(module.shortcutStatusText().contains(QStringLiteral("5 rows")));
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.action == QStringLiteral("plasma-auto-tiler-focus-right")) {
                tuple.active = QList<int>{111};
            }
        }
        module.requestShortcutRevert();
        CHECK(!module.shortcutErrorText().isEmpty());
        CHECK(module.shortcutErrorText().contains(QStringLiteral("kwin/plasma-auto-tiler-focus-right")));
        CHECK(journal.hasJournal());
    }
}

void completeJournalStatusComparesExactPostimages()
{
    FakeShortcutStore store;
    store.uid = static_cast<uint>(::geteuid());
    seedReady(store);
    FakeJournal journal;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &journal);
    module.load();
    module.requestShortcutApply();
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(journal.hasJournal());
    // Exact postimage live with a valid complete journal: applied.
    module.refreshShortcutState();
    CHECK(module.shortcutStatusText().contains(QStringLiteral("journal complete")));
    // Lock drift that still passes the loose heuristic (Meta+Esc present,
    // no Meta+L, extra key appended) must report drift, never applied.
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.component == QStringLiteral("ksmserver")) {
            tuple.active = QList<int>{META_ESC, 999};
        }
    }
    module.refreshShortcutState();
    CHECK(!module.shortcutStatusText().contains(QStringLiteral("applied")));
    CHECK(module.shortcutStatusText().contains(QStringLiteral("drift")));
    // Focus drift likewise reports drift, never applied.
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-focus-right")) {
            tuple.active = QList<int>{META_L, 42};
        }
        if (tuple.component == QStringLiteral("ksmserver")) {
            tuple.active = QList<int>{META_ESC};
        }
    }
    module.refreshShortcutState();
    CHECK(!module.shortcutStatusText().contains(QStringLiteral("applied")));
    CHECK(module.shortcutStatusText().contains(QStringLiteral("drift")));
}

void unrelatedChordConflictStatus()
{
    FakeShortcutStore store;
    seedReady(store);
    store.tuples.append(makeTuple(QStringLiteral("kwin"), QStringLiteral("other-k"), QList<int>{META_ALT_K}));
    store.tuples.append(makeTuple(QStringLiteral("kwin"), QStringLiteral("other-l"), QList<int>{META_ALT_L}));
    FakeJournal journal;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &journal);
    module.load();
    CHECK(module.shortcutStatusText().contains(QStringLiteral("Conflict")));
    module.requestShortcutApply();
    CHECK(store.writeLog.isEmpty());
    CHECK(!journal.hasJournal());
}

void keyedDesktopOnlyConflictStatus()
{
    // .desktop-only Meta+Esc holder invisible to readAll blocks via keyed
    // lookup on both Apply and KCM status with zero writes. The holder is
    // modeled with empty active and defaults {Meta+Esc} because the
    // authoritative primitive sees defaults.
    {
        FakeShortcutStore store;
        seedReady(store);
        ShortcutKeyHolder foreign;
        foreign.component = QStringLiteral("org.kde.unexpected");
        foreign.action = QStringLiteral("other-launch");
        foreign.active = QList<int>{};
        foreign.defaults = QList<int>{META_ESC};
        store.extraByKey[META_ESC].append(foreign);
        FakeJournal journal;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &journal);
        module.load();
        CHECK(module.shortcutStatusText().contains(QStringLiteral("Conflict")));
        CHECK(module.shortcutStatusText().contains(QStringLiteral("Meta+Esc")));
        module.requestShortcutApply();
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.hasJournal());
        CHECK(module.shortcutErrorText().contains(QStringLiteral("Meta+Esc")));
    }
    // Clear-target .desktop-only holder on Meta+Alt+K likewise blocks.
    {
        FakeShortcutStore store;
        seedReady(store);
        ShortcutKeyHolder foreign;
        foreign.component = QStringLiteral("org.kde.unexpected");
        foreign.action = QStringLiteral("other-clear");
        foreign.active = QList<int>{};
        foreign.defaults = QList<int>{META_ALT_K};
        store.extraByKey[META_ALT_K].append(foreign);
        FakeJournal journal;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &journal);
        module.load();
        CHECK(module.shortcutStatusText().contains(QStringLiteral("Conflict")));
        module.requestShortcutApply();
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.hasJournal());
    }
}

void keyedSystemMonitorStatusAccepted()
{
    // Explicit System Monitor `_launch` Meta+Esc holder is user-authorized
    // via the compiled-in table: status stays Ready (not Conflict) and
    // Apply proceeds with no writes targeting System Monitor itself.
    FakeShortcutStore store;
    seedReady(store);
    ShortcutKeyHolder sysmon;
    sysmon.component = shortcutAuthorizedEscComponent();
    sysmon.action = shortcutAuthorizedEscAction();
    sysmon.active = QList<int>{META_ESC};
    store.extraByKey[META_ESC].append(sysmon);
    FakeJournal journal;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &journal);
    module.load();
    CHECK(!module.shortcutStatusText().contains(QStringLiteral("Conflict")));
    CHECK(module.shortcutStatusText().contains(QStringLiteral("Ready")));
    module.requestShortcutApply();
    CHECK(store.writeLog.size() == 8);
    CHECK(journal.hasJournal());
    CHECK(module.shortcutErrorText().isEmpty());
    for (const auto &record : store.writeLog) {
        CHECK(!(record.component == shortcutAuthorizedEscComponent() && record.action == shortcutAuthorizedEscAction()));
    }
}

void keyedTransportFailureShowsUnavailable()
{
    // Keyed transport failure surfaces as unavailable (never Conflict)
    // with zero writes, via the typed outcome (no substring matching).
    FakeShortcutStore store;
    seedReady(store);
    store.failByKey = true;
    FakeJournal journal;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &journal);
    module.load();
    CHECK(!module.shortcutStatusText().contains(QStringLiteral("Conflict")));
    CHECK(module.shortcutStatusText().contains(QStringLiteral("unavailable")));
    module.requestShortcutApply();
    CHECK(store.writeLog.isEmpty());
    CHECK(!journal.hasJournal());
    CHECK(!module.shortcutErrorText().contains(QStringLiteral("Conflict")));
    CHECK(module.shortcutErrorText().contains(QStringLiteral("unavailable")) || module.shortcutErrorText().contains(QStringLiteral("globalShortcutsByKey")));
}

void v2JournalStatusStaysThreeRows()
{
    // A persisted v2 complete journal is revealed as its original three-row
    // state: it never claims Grid View or Monocle management.
    FakeShortcutStore store;
    seedReady(store);
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-focus-right")) {
            tuple.active = QList<int>{META_L};
        }
        if (tuple.action == QStringLiteral("Lock Session")) {
            tuple.active = QList<int>{META_ESC};
        }
        if (tuple.action == QStringLiteral("plasma-auto-tiler-resize-outwards-up")) {
            tuple.active = QList<int>{META_ALT_K};
        }
        if (tuple.action == QStringLiteral("plasma-auto-tiler-resize-outwards-right")) {
            tuple.active = QList<int>{META_ALT_L};
        }
        if (tuple.action.contains(QStringLiteral("Keyboard Layout"))) {
            tuple.active = QList<int>{};
        }
    }
    FakeJournal journal;
    ShortcutJournal v2;
    v2.schema = shortcutJournalSchemaV2();
    v2.phase = shortcutJournalPhaseComplete();
    v2.owner = QStringLiteral(":1.20");
    v2.uid = static_cast<uint>(::geteuid());
    v2.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{419430420},
                QList<int>{META_L}};
    v2.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L},
               QList<int>{META_ESC}};
    v2.resizeUp = {shortcutResizeUpComponent(), shortcutResizeUpAction(), QList<int>{7}, {META_ALT_K}};
    v2.switchNext = {shortcutSwitchNextComponent(), shortcutSwitchNextAction(), {META_ALT_K}, {}};
    v2.resizeRight = {shortcutResizeRightComponent(), shortcutResizeRightAction(), QList<int>{8}, {META_ALT_L}};
    v2.switchLast = {shortcutSwitchLastComponent(), shortcutSwitchLastAction(), {META_ALT_L}, {}};
    v2.row0Kind = shortcutResolutionRelocate();
    v2.row1Kind = shortcutResolutionClear();
    v2.row2Kind = shortcutResolutionClear();
    QString persistError;
    CHECK(journal.persist(v2, &persistError));
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &journal);
    module.load();
    CHECK(module.shortcutStatusText().contains(QStringLiteral("journal complete, 3 rows")));
    CHECK(module.shortcutStatusText().contains(QStringLiteral("unmanaged")));
    CHECK(!module.shortcutStatusText().contains(QStringLiteral("5 rows")));
    CHECK(module.shortcutErrorText().isEmpty());
}

void forcePreviewAcceptCancelRevert()
{
    FakeShortcutStore store;
    seedReady(store);
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("Grid View")) {
            tuple.active = QList<int>{999};
        }
    }
    FakeJournal journal;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    int confirms = 0;
    bool allow = true;
    module.setShortcutConfirmHandler([&](const QString &title, const QString &text) {
        ++confirms;
        CHECK(!title.isEmpty());
        CHECK(!text.isEmpty());
        return allow;
    });
    module.setShortcutStores(&store, &journal);
    module.load();
    CHECK(!module.isShortcutForceApplyVisible());
    CHECK(!module.isShortcutForceCancelVisible());
    // Normal apply refuses the third image with zero mutation and raises
    // the exact preview with Force Apply/Cancel. Raising the preview writes
    // no journal.
    module.requestShortcutApply();
    CHECK(confirms == 1);
    CHECK(store.writeLog.isEmpty());
    CHECK(!journal.hasJournal());
    CHECK(journal.persists == 0);
    CHECK(module.shortcutErrorText().contains(QStringLiteral("Meta+G")));
    CHECK(module.isShortcutForceApplyVisible());
    CHECK(module.isShortcutForceCancelVisible());
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("Grid View")));
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("999")));
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("Paired project assignment")));
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("plasma-auto-tiler-toggle-float")));
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("268435527")));
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("will clear to none")));
    QLabel *preview = module.widget()->findChild<QLabel *>(QStringLiteral("shortcutForcePreviewLabel"));
    CHECK(preview != nullptr);
    if (preview) {
        CHECK(preview->text() == module.shortcutForcePreviewText());
        CHECK(!preview->isHidden());
    }
    // Cancel clears the preview with no mutation, no confirmation, and no
    // journal write.
    module.requestShortcutForceCancel();
    CHECK(confirms == 1);
    CHECK(store.writeLog.isEmpty());
    CHECK(!journal.hasJournal());
    CHECK(journal.persists == 0);
    CHECK(!module.isShortcutForceApplyVisible());
    CHECK(!module.isShortcutForceCancelVisible());
    // Preview again, decline at the Force confirmation: retained, unmutated.
    module.requestShortcutApply();
    CHECK(confirms == 2);
    CHECK(module.isShortcutForceApplyVisible());
    allow = false;
    module.requestShortcutForceApply();
    CHECK(confirms == 3);
    CHECK(store.writeLog.isEmpty());
    CHECK(!journal.hasJournal());
    CHECK(module.isShortcutForceApplyVisible());
    // Accept: revalidation passes, the adopted actual clears, Revert
    // restores exactly the adopted value.
    allow = true;
    module.requestShortcutForceApply();
    CHECK(confirms == 4);
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(journal.hasJournal());
    CHECK(!module.isShortcutForceApplyVisible());
    CHECK(!module.isShortcutForceCancelVisible());
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("Grid View")) {
            CHECK(tuple.active.isEmpty());
        }
    }
    module.requestShortcutRevert();
    CHECK(confirms == 5);
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(!journal.hasJournal());
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("Grid View")) {
            CHECK(tuple.active == (QList<int>{999}));
        }
    }
}

void legacyMigrationDeferredFromOpen()
{
    // A known legacy completed-v2 journal is never touched by opening the
    // KCM, loading it, or refreshing state: zero writes on both journals,
    // no migration error, no legacy text in the status.
    FakeShortcutStore store;
    seedReady(store);
    FakeJournal journal;
    FakeJournal legacyJournal;
    seedCompletedV2LegacyJournal(legacyJournal);
    CHECK(legacyJournal.hasJournal());
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    int confirms = 0;
    module.setShortcutConfirmHandler([&](const QString &, const QString &) {
        ++confirms;
        return true;
    });
    module.setShortcutStores(&store, &journal, &legacyJournal);
    module.load();
    module.refreshShortcutState();
    CHECK(journal.persists == 0);
    CHECK(!journal.hasJournal());
    CHECK(legacyJournal.persists == 0);
    CHECK(legacyJournal.hasJournal());
    CHECK(!QFile::exists(legacyShortcutJournalPath()));
    CHECK(!QFile::exists(defaultShortcutJournalPath()));
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(!module.shortcutStatusText().contains(QStringLiteral("legacy")));
    CHECK(module.shortcutStatusText().contains(QStringLiteral("drifted after apply-complete")));
    CHECK(confirms == 0);
    CHECK(store.writeLog.isEmpty());
}

void legacyMigrationOnConfirmedApply()
{
    // A confirmed Apply migrates the known legacy completed-v2 journal and
    // then resumes the normal upgrade: old preimages preserved, new rows
    // cleared, Revert restores everything.
    FakeShortcutStore store;
    seedV2CompletedLive6(store);
    FakeJournal journal;
    FakeJournal legacyJournal;
    seedCompletedV2LegacyJournal(legacyJournal);
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    int confirms = 0;
    module.setShortcutConfirmHandler([&](const QString &, const QString &) {
        ++confirms;
        return true;
    });
    module.setShortcutStores(&store, &journal, &legacyJournal);
    module.load();
    CHECK(journal.persists == 0);
    module.requestShortcutApply();
    CHECK(confirms == 1);
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(journal.hasJournal());
    CHECK(journal.stored.schema == shortcutJournalSchema());
    CHECK(journal.stored.phase == shortcutJournalPhaseComplete());
    CHECK(journal.stored.focus.pre == (QList<int>{419430420}));
    CHECK(journal.stored.lock.pre == (QList<int>{META_L}));
    CHECK(journal.stored.gridView.pre == (QList<int>{META_G}));
    CHECK(journal.stored.monocle.pre == (QList<int>{META_M}));
    CHECK(legacyJournal.persists == 0);
    CHECK(store.writeLog.size() == 2);
    module.requestShortcutRevert();
    CHECK(confirms == 2);
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(!journal.hasJournal());
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-focus-right")) {
            CHECK(tuple.active == (QList<int>{419430420}));
        }
        if (tuple.action == QStringLiteral("Grid View")) {
            CHECK(tuple.active == (QList<int>{META_G}));
        }
        if (tuple.action == QStringLiteral("KrohnkiteMonocleLayout")) {
            CHECK(tuple.active == (QList<int>{META_M}));
        }
    }
}

void legacyMigrationFailureFailClosed()
{
    // An unloadable legacy journal fails a confirmed Apply closed: the
    // exact load error surfaces, with zero store writes and zero canonical
    // writes.
    FakeShortcutStore store;
    seedV2CompletedLive6(store);
    FakeJournal journal;
    FakeJournal legacyJournal;
    legacyJournal.present = true;
    legacyJournal.stored.schema = QStringLiteral("shortcut-override-v1");
    legacyJournal.stored.phase = shortcutJournalPhasePending();
    legacyJournal.stored.owner = QStringLiteral(":1.20");
    legacyJournal.stored.uid = static_cast<uint>(::geteuid());
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    int confirms = 0;
    module.setShortcutConfirmHandler([&](const QString &, const QString &) {
        ++confirms;
        return true;
    });
    module.setShortcutStores(&store, &journal, &legacyJournal);
    module.load();
    CHECK(journal.persists == 0);
    module.requestShortcutApply();
    CHECK(confirms == 1);
    CHECK(store.writeLog.isEmpty());
    CHECK(!journal.hasJournal());
    CHECK(journal.persists == 0);
    CHECK(module.shortcutErrorText().contains(QStringLiteral("upgrade required, no migration")));
    CHECK(!module.isShortcutForceApplyVisible());
}

void terminalFailureLogIncludesReason()
{
    FakeShortcutStore store;
    seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("Grid View")) {
            tuple.active = QList<int>{999};
        }
    }
    FakeJournal journal;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) {
        return true;
    });
    module.setShortcutStores(&store, &journal);
    module.load();
    QStringList messages;
    ShortcutDiag::setSink([&](QtMsgType, const QString &message) {
        messages.append(message);
    });
    module.requestShortcutApply();
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("Grid View")) {
            tuple.active = QList<int>{1000};
        }
    }
    module.requestShortcutForceApply();
    ShortcutDiag::resetSink();
    bool sawTerminalFailure = false;
    bool sawStaleForceFailure = false;
    for (const QString &message : messages) {
        if (message.contains(QStringLiteral("plasmaautotiler.shortcut op=apply stage=result outcome=failed"))
            && message.contains(QStringLiteral("reason=refusing to apply: kwin/Grid View"))
            && message.contains(QStringLiteral("writes=0"))) {
            sawTerminalFailure = true;
        }
        if (message.contains(QStringLiteral("plasmaautotiler.shortcut op=force-apply stage=result outcome=failed"))
            && message.contains(QStringLiteral("reason=confirmed force image is stale"))
            && message.contains(QStringLiteral("writes=0"))) {
            sawStaleForceFailure = true;
        }
    }
    CHECK(sawTerminalFailure);
    CHECK(sawStaleForceFailure);
    CHECK(store.writeLog.isEmpty());
    CHECK(!journal.hasJournal());
}

} // namespace

int main(int argc, char **argv)
{
    // Unit 1 hard gate: isolate from the live session bus before any
    // QDBusConnection::sessionBus() initialization (ActiveBorderConfigModule
    // creates the live KGlobalAccelStore in its constructor).
    qputenv("DBUS_SESSION_BUS_ADDRESS", QByteArray("unix:path=/dev/null/plasma-auto-tiler-kcm-test-isolated-bus"));
    QTemporaryDir configHome;
    if (!configHome.isValid()) {
        std::fprintf(stderr, "failed to create temporary config directory\n");
        return EXIT_FAILURE;
    }
    qputenv("XDG_CONFIG_HOME", configHome.path().toUtf8());
    QApplication app(argc, argv);
    app.clipboard()->setMimeData(new QMimeData);

    if (argc != 2) {
        std::fprintf(stderr, "usage: %s ordinary|recovery|confirm|state|force|migration\n", argv[0]);
        return EXIT_FAILURE;
    }

    const QString scenario = QString::fromLocal8Bit(argv[1]);
    if (scenario == QStringLiteral("ordinary")) {
        ordinarySettingsApplyNeverMutatesShortcuts();
    } else if (scenario == QStringLiteral("recovery")) {
        recoveryVisibilityAndRouting();
    } else if (scenario == QStringLiteral("confirm")) {
        confirmationGatesEveryMutation();
    } else if (scenario == QStringLiteral("force")) {
        forcePreviewAcceptCancelRevert();
        terminalFailureLogIncludesReason();
    } else if (scenario == QStringLiteral("migration")) {
        legacyMigrationDeferredFromOpen();
        legacyMigrationOnConfirmedApply();
        legacyMigrationFailureFailClosed();
    } else if (scenario == QStringLiteral("state")) {
        stateAndErrorPresentation();
        completeJournalStatusComparesExactPostimages();
        v2JournalStatusStaysThreeRows();
        unrelatedChordConflictStatus();
        keyedDesktopOnlyConflictStatus();
        keyedSystemMonitorStatusAccepted();
        keyedTransportFailureShowsUnavailable();
        contractRejectionSurfacesSplitSignatureWithoutStaleCombinedForm();
    } else {
        std::fprintf(stderr, "unknown scenario: %s\n", argv[1]);
        return EXIT_FAILURE;
    }

    if (failures != 0) {
        std::fprintf(stderr, "%d check(s) failed\n", failures);
        return EXIT_FAILURE;
    }
    std::printf("all checks passed\n");
    return EXIT_SUCCESS;
}
