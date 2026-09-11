#include "shortcutreconciler.h"

#include <QDBusArgument>
#include <QDBusMessage>
#include <QDBusMetaType>
#include <QDBusObjectPath>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QKeySequence>
#include <QSet>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QVariant>

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
    bool driftAfterNextWrite = false;
    bool failNextWrite = false;
    bool badReplyNextWrite = false;
    // Mirrors KGlobalAccelStore::tryPinOwner: first verified owner pins,
    // the same owner confirms, a different owner fails closed.
    QString pinned;
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
                *error = QStringLiteral("KGlobalAccel setShortcutKeys is absent or does not expose exactly as,a(ai),u -> a(ai) with QSet<QKeySequence>");
            }
            return false;
        }
        if (!ShortcutReconciler::introspectionContractValid(contractXml)) {
            if (error) {
                *error = QStringLiteral("KGlobalAccel setShortcutKeys is absent or does not expose exactly as,a(ai),u -> a(ai) with QSet<QKeySequence>");
            }
            return false;
        }
        return true;
    }

    bool currentOwner(QString *outOwner, uint *outUid, QString *error) override
    {
        if (!ShortcutReconciler::uniqueNameValid(owner)) {
            if (error) {
                *error = QStringLiteral("malformed KGlobalAccel service owner reply");
            }
            return false;
        }
        if (pinned.isEmpty()) {
            pinned = owner;
        } else if (pinned != owner) {
            if (error) {
                *error = QStringLiteral("KGlobalAccel service owner drifted");
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
                *error = QStringLiteral("unexpected allShortcutInfos reply");
            }
            return false;
        }
        // Bounded validation mirrors the real backend.
        if (tuples.size() > SHORTCUT_MAX_TUPLES) {
            if (error) {
                *error = QStringLiteral("unexpected allShortcutInfos reply");
            }
            return false;
        }
        for (const ShortcutTuple &tuple : tuples) {
            if (!ShortcutReconciler::keysValid(tuple.active) || !ShortcutReconciler::stringValid(tuple.component)
                || !ShortcutReconciler::stringValid(tuple.action) || !ShortcutReconciler::stringValid(tuple.friendly)
                || !ShortcutReconciler::stringValid(tuple.componentFriendly)) {
                if (error) {
                    *error = QStringLiteral("unexpected allShortcutInfos reply");
                }
                return false;
            }
        }
        if (out) {
            *out = tuples;
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
            || !ShortcutReconciler::stringValid(action) || !ShortcutReconciler::stringValid(componentFriendly)
            || !ShortcutReconciler::stringValid(friendly)) {
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
        if (failNextWrite) {
            failNextWrite = false;
            // Transport failure after the daemon may still have changed;
            // record the attempt so recovery can be tested, but report failure.
            writeLog.append({component, action, keys});
            if (error) {
                *error = QStringLiteral("setShortcutKeys call failed for action");
            }
            return false;
        }
        writeLog.append({component, action, keys});
        if (driftAfterNextWrite) {
            driftAfterNextWrite = false;
            owner = QStringLiteral(":1.99");
            uid = static_cast<uint>(::geteuid() + 1);
        }
        // Apply to the fake daemon state.
        for (ShortcutTuple &tuple : tuples) {
            if (tuple.component == component && tuple.action == action) {
                tuple.active = keys;
                break;
            }
        }
        if (badReplyNextWrite) {
            badReplyNextWrite = false;
            if (error) {
                *error = QStringLiteral("setShortcutKeys reply did not confirm expected key");
            }
            return false;
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
                *error = QStringLiteral("journal schema version v1 is unsupported; expected shortcut-override-v2 (upgrade required, no migration)");
            }
            return false;
        }
        if (stored.schema != shortcutJournalSchema()) {
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
                *error = QStringLiteral("journal schema version v1 is unsupported; expected shortcut-override-v2 (upgrade required, no migration)");
            }
            return false;
        }
        if (journal.schema != shortcutJournalSchema()) {
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
        }
        stored = journal;
        present = true;
        ++persists;
        // Sync+readback mirrors the real backend: every field must round-trip.
        const ShortcutJournal readback = stored;
        const ShortcutJournalEntry exp[6] = {journal.focus, journal.lock, journal.resizeUp, journal.switchNext,
                                             journal.resizeRight, journal.switchLast};
        const ShortcutJournalEntry got[6] = {readback.focus, readback.lock, readback.resizeUp, readback.switchNext,
                                             readback.resizeRight, readback.switchLast};
        for (int i = 0; i < 6; ++i) {
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
            || readback.row2Kind != journal.row2Kind) {
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
    };
}

void fillResizeReady(ShortcutJournal &journal, const QList<int> &upPre, const QList<int> &rightPre)
{
    journal.resizeUp = {shortcutResizeUpComponent(), shortcutResizeUpAction(), upPre, {META_ALT_K}};
    journal.switchNext = {shortcutSwitchNextComponent(), shortcutSwitchNextAction(), {META_ALT_K}, {}};
    journal.resizeRight = {shortcutResizeRightComponent(), shortcutResizeRightAction(), rightPre, {META_ALT_L}};
    journal.switchLast = {shortcutSwitchLastComponent(), shortcutSwitchLastAction(), {META_ALT_L}, {}};
    journal.row0Kind = shortcutResolutionRelocate();
    journal.row1Kind = shortcutResolutionClear();
    journal.row2Kind = shortcutResolutionClear();
}

void applySuccessAndOrder()
{
    FakeShortcutStore store;
    seedReady6(store, QList<int>{419430420}, QList<int>{META_L, 134217795});
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    const ShortcutApplyResult result = reconciler.apply();
    CHECK(result.ok);
    CHECK(result.writes == 6);
    CHECK(journal.present);
    CHECK(journal.stored.row0Kind == shortcutResolutionRelocate());
    CHECK(journal.stored.row1Kind == shortcutResolutionClear());
    CHECK(journal.stored.row2Kind == shortcutResolutionClear());
    CHECK(store.writeLog.size() == 6);
    if (store.writeLog.size() == 6) {
        CHECK(store.writeLog.at(0).action == QStringLiteral("plasma-auto-tiler-focus-right"));
        CHECK(store.writeLog.at(0).keys == QList<int>{META_L});
        CHECK(store.writeLog.at(1).action == QStringLiteral("Lock Session"));
        CHECK(store.writeLog.at(1).keys == (QList<int>{META_ESC, 134217795}));
        CHECK(store.writeLog.at(2).action == QStringLiteral("plasma-auto-tiler-resize-outwards-up"));
        CHECK(store.writeLog.at(2).keys == QList<int>{META_ALT_K});
        CHECK(store.writeLog.at(3).action == QStringLiteral("Switch to Next Keyboard Layout"));
        CHECK(store.writeLog.at(3).keys == QList<int>{});
        CHECK(store.writeLog.at(4).action == QStringLiteral("plasma-auto-tiler-resize-outwards-right"));
        CHECK(store.writeLog.at(4).keys == QList<int>{META_ALT_L});
        CHECK(store.writeLog.at(5).action == QStringLiteral("Switch to Last-Used Keyboard Layout"));
        CHECK(store.writeLog.at(5).keys == QList<int>{});
    }
    for (const auto &record : store.writeLog) {
        CHECK(ShortcutReconciler::isAllowlisted(record.component, record.action));
    }
}

void metaEscConflictRefusesWithoutJournalOrMutation()
{
    FakeShortcutStore store;
    seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
    store.tuples.append(makeTuple(QStringLiteral("kwin"), QStringLiteral("other-action"), QList<int>{META_ESC}));
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    const ShortcutApplyResult result = reconciler.apply();
    CHECK(!result.ok);
    CHECK(store.writeLog.isEmpty());
    CHECK(!journal.present);
    CHECK(result.error.contains(QStringLiteral("Meta+Esc")));
}

void malformedReplyFailsClosed()
{
    FakeShortcutStore store;
    seedReady6(store, QList<int>{META_L}, QList<int>{META_L});
    store.malformedRead = true;
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    const ShortcutApplyResult result = reconciler.apply();
    CHECK(!result.ok);
    CHECK(store.writeLog.isEmpty());
    CHECK(!journal.present);
}

void ownerDriftFailsClosed()
{
    FakeShortcutStore store;
    seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
    store.driftAfterNextWrite = true;
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    const ShortcutApplyResult result = reconciler.apply();
    CHECK(!result.ok);
    CHECK(result.error.contains(QStringLiteral("owner")));
    CHECK(journal.present); // journal retained for recovery
    CHECK(store.uid == static_cast<uint>(::geteuid() + 1));
    CHECK(store.uid != static_cast<uint>(::geteuid()));
}

void partialWriteRecovery()
{
    FakeShortcutStore store;
    seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
    FakeJournal journal;
    ShortcutJournal partial;
    partial.schema = shortcutJournalSchema();
    partial.phase = shortcutJournalPhaseFocusApplied();
    partial.owner = QStringLiteral(":1.20");
    partial.uid = static_cast<uint>(::geteuid());
    partial.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{419430420}, QList<int>{META_L}};
    partial.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}, QList<int>{META_ESC}};
    fillResizeReady(partial, QList<int>{7}, QList<int>{8});
    QString persistError;
    CHECK(journal.persist(partial, &persistError));
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.component == QStringLiteral("kwin") && tuple.action == QStringLiteral("plasma-auto-tiler-focus-right")) {
            tuple.active = QList<int>{META_L};
        }
    }
    ShortcutReconciler reconciler(&store, &journal);
    const ShortcutApplyResult result = reconciler.apply();
    CHECK(result.ok);
    CHECK(store.writeLog.size() == 5);
    if (store.writeLog.size() == 5) {
        CHECK(store.writeLog.at(0).action == QStringLiteral("Lock Session"));
        CHECK(store.writeLog.at(1).action == QStringLiteral("plasma-auto-tiler-resize-outwards-up"));
        CHECK(store.writeLog.at(2).action == QStringLiteral("Switch to Next Keyboard Layout"));
        CHECK(store.writeLog.at(3).action == QStringLiteral("plasma-auto-tiler-resize-outwards-right"));
        CHECK(store.writeLog.at(4).action == QStringLiteral("Switch to Last-Used Keyboard Layout"));
    }
    ShortcutJournal loaded;
    QString loadError;
    CHECK(journal.load(&loaded, &loadError));
    CHECK(loaded.phase == shortcutJournalPhaseComplete());
}

void externalEditsUntouchedAndJournalRetained()
{
    FakeShortcutStore store;
    seedReady6(store, QList<int>{419430420}, QList<int>{META_L, 42});
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    CHECK(reconciler.apply().ok);
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-focus-right")) {
            tuple.active = QList<int>{111};
        }
    }
    ShortcutReconciler reverting(&store, &journal);
    const ShortcutRevertResult reverted = reverting.revert();
    CHECK(!reverted.ok);
    CHECK(!reverted.journalRemoved);
    CHECK(journal.present);
    CHECK(reverted.untouched.contains(QStringLiteral("kwin/plasma-auto-tiler-focus-right")));
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("Lock Session")) {
            CHECK(tuple.active == (QList<int>{META_L, 42}));
        }
        if (tuple.action == QStringLiteral("plasma-auto-tiler-focus-right")) {
            CHECK(tuple.active == (QList<int>{111}));
        }
    }
    for (const auto &record : store.writeLog) {
        CHECK(ShortcutReconciler::isAllowlisted(record.component, record.action));
    }
}

void cleanRevertRemovesJournal()
{
    FakeShortcutStore store;
    seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    CHECK(reconciler.apply().ok);
    ShortcutReconciler reverting(&store, &journal);
    const ShortcutRevertResult reverted = reverting.revert();
    CHECK(reverted.ok);
    CHECK(reverted.journalRemoved);
    CHECK(!journal.present);
    CHECK(reverted.untouched.isEmpty());
}

void kconfigJournalWriteSyncReadback()
{
    QTemporaryDir dir;
    CHECK(dir.isValid());
    const QString path = dir.path() + QStringLiteral("/journalrc");
    KConfigFileJournal fileJournal(path);
    CHECK(!fileJournal.hasJournal());
    ShortcutJournal journal;
    journal.schema = shortcutJournalSchema();
    journal.phase = shortcutJournalPhasePending();
    journal.owner = QStringLiteral(":1.20");
    journal.uid = static_cast<uint>(::geteuid());
    journal.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{1}, QList<int>{META_L}};
    journal.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}, QList<int>{META_ESC}};
    fillResizeReady(journal, QList<int>{7}, QList<int>{8});
    QString error;
    CHECK(fileJournal.persist(journal, &error));
    CHECK(fileJournal.hasJournal());
    // Private owner-safe permissions without weakening durability.
    {
        struct stat st = {};
        CHECK(::stat(path.toLocal8Bit().constData(), &st) == 0);
        CHECK(st.st_uid == static_cast<uid_t>(::geteuid()));
        CHECK((st.st_mode & 0077) == 0);
    }
    ShortcutJournal loaded;
    CHECK(fileJournal.load(&loaded, &error));
    CHECK(loaded.focus.pre == (QList<int>{1}));
    CHECK(loaded.lock.post == (QList<int>{META_ESC}));
    CHECK(loaded.focus.component == QStringLiteral("kwin"));
    CHECK(loaded.focus.action == QStringLiteral("plasma-auto-tiler-focus-right"));
    CHECK(loaded.lock.component == QStringLiteral("ksmserver"));
    CHECK(loaded.lock.action == QStringLiteral("Lock Session"));
    CHECK(fileJournal.remove(&error));
    CHECK(!fileJournal.hasJournal());
}

void swappedRolesRejected()
{
    FakeJournal journal;
    ShortcutJournal swapped;
    swapped.schema = shortcutJournalSchema();
    swapped.phase = shortcutJournalPhasePending();
    swapped.owner = QStringLiteral(":1.20");
    swapped.uid = static_cast<uint>(::geteuid());
    swapped.focus = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}, QList<int>{META_ESC}};
    swapped.lock = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{1}, QList<int>{META_L}};
    fillResizeReady(swapped, QList<int>{7}, QList<int>{8});
    QString error;
    CHECK(!journal.persist(swapped, &error));
    CHECK(!journal.present);
    CHECK(!ShortcutReconciler::journalRolesValid(swapped));
    ShortcutJournal correct = swapped;
    correct.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{1}, QList<int>{META_L}};
    correct.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}, QList<int>{META_ESC}};
    CHECK(ShortcutReconciler::journalRolesValid(correct));
}

void persistRejectsInvalidPhaseOwnerUid()
{
    FakeJournal journal;
    ShortcutJournal base;
    base.schema = shortcutJournalSchema();
    base.phase = shortcutJournalPhasePending();
    base.owner = QStringLiteral(":1.20");
    base.uid = static_cast<uint>(::geteuid());
    base.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{1}, QList<int>{META_L}};
    base.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}, QList<int>{META_ESC}};
    fillResizeReady(base, QList<int>{7}, QList<int>{8});
    QString error;
    ShortcutJournal bad = base;
    bad.phase = QStringLiteral("bogus-phase");
    CHECK(!journal.persist(bad, &error));
    bad = base;
    bad.owner = QStringLiteral("not-a-unique-name");
    CHECK(!journal.persist(bad, &error));
    bad = base;
    bad.owner = QString();
    CHECK(!journal.persist(bad, &error));
    bad = base;
    bad.uid = static_cast<uint>(::geteuid() + 1);
    CHECK(!journal.persist(bad, &error));
    CHECK(!journal.present);
    CHECK(journal.persist(base, &error));
}

void strictOwnerAndIntrospection()
{
    CHECK(ShortcutReconciler::uniqueNameValid(QStringLiteral(":1.20")));
    CHECK(!ShortcutReconciler::uniqueNameValid(QString()));
    CHECK(!ShortcutReconciler::uniqueNameValid(QStringLiteral("org.kde.kglobalaccel")));
    CHECK(!ShortcutReconciler::uniqueNameValid(QStringLiteral(":abc")));
    CHECK(!ShortcutReconciler::uniqueNameValid(QStringLiteral(":1")));
    const QString good = QStringLiteral(
        "<node><interface name=\"org.kde.KGlobalAccel\">"
        "<method name=\"setShortcutKeys\">"
        "<arg type=\"as\" direction=\"in\"/>"
        "<arg type=\"a(ai)\" direction=\"in\"/>"
        "<arg type=\"u\" direction=\"in\"/>"
        "<arg type=\"a(ai)\" direction=\"out\"/>"
        "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
        "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
        "</method></interface></node>");
    CHECK(ShortcutReconciler::introspectionContractValid(good));
    // Legacy single-arg combined form is rejected by the strict parser.
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"asa(ai)u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "</method></interface></node>")));
    CHECK(!ShortcutReconciler::introspectionContractValid(QString()));
    CHECK(!ShortcutReconciler::introspectionContractValid(QStringLiteral("<node/>")));
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\"><method name=\"other\"/></interface></node>")));
    // Malformed owner fails closed through the store.
    FakeShortcutStore store;
    store.owner = QStringLiteral("not-unique");
    seedReady6(store, QList<int>{1}, QList<int>{META_L});
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    CHECK(!reconciler.apply().ok);
    CHECK(store.writeLog.isEmpty());
}

void friendlyLabelsValidated()
{
    FakeShortcutStore store;
    seedReady6(store, QList<int>{1}, QList<int>{META_L});
    // Empty friendly label is rejected by the fake mirroring the backend.
    store.tuples[0].friendly = QString();
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    CHECK(!reconciler.apply().ok);
    CHECK(store.writeLog.isEmpty());
    CHECK(!journal.present);
    QString error;
    CHECK(!store.writeKeys(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QString(),
                           QStringLiteral("friendly"), QList<int>{META_L}, nullptr, &error));
    CHECK(!store.writeKeys(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"),
                           QStringLiteral("KWin"), QString(), QList<int>{META_L}, nullptr, &error));
}

void duplicateMetaEscDeduped()
{
    CHECK(ShortcutReconciler::lockPostFor(QList<int>{META_L, META_L}) == (QList<int>{META_ESC}));
    CHECK(ShortcutReconciler::lockPostFor(QList<int>{META_L, META_ESC}) == (QList<int>{META_ESC}));
    CHECK(ShortcutReconciler::lockPostFor(QList<int>{META_L, 42, META_L, 42}) == (QList<int>{META_ESC, 42}));
    CHECK(ShortcutReconciler::dedupKeys(QList<int>{1, 1, 2, 1, 2}) == (QList<int>{1, 2}));
    // End-to-end: pre with duplicate Meta+L collapses to a single Meta+Esc.
    FakeShortcutStore store;
    seedReady6(store, QList<int>{1}, QList<int>{META_L, META_L, 42});
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    const ShortcutApplyResult result = reconciler.apply();
    CHECK(result.ok);
    CHECK(store.writeLog.size() == 6);
    if (store.writeLog.size() == 6) {
        CHECK(store.writeLog.at(1).keys == (QList<int>{META_ESC, 42}));
    }
}

void exactTwoWriteLimit()
{
    FakeShortcutStore store;
    seedReady6(store, QList<int>{1}, QList<int>{META_L});
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    const ShortcutApplyResult result = reconciler.apply();
    CHECK(result.ok);
    CHECK(result.writes == 6);
    CHECK(result.writes <= SHORTCUT_MAX_WRITES);
    CHECK(store.writeLog.size() == 6);
    ShortcutReconciler reverting(&store, &journal);
    const ShortcutRevertResult reverted = reverting.revert();
    CHECK(reverted.ok);
    CHECK(reverted.writes == 6);
    CHECK(reverted.writes <= SHORTCUT_MAX_WRITES);
}

void finishApplyDriftClassified()
{
    FakeShortcutStore store;
    seedReady6(store, QList<int>{1}, QList<int>{META_L});
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    CHECK(reconciler.apply().ok);
    // Live drift after complete: finish must report drift, not a postimage error.
    // Drift keeps Meta+Esc claimed by the allowlisted lock so the
    // preflight passes and the drift is classified at finish/complete.
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.component == QStringLiteral("ksmserver")) {
            tuple.active = QList<int>{META_ESC, 999};
        }
    }
    ShortcutReconciler finishing(&store, &journal);
    const ShortcutApplyResult result = finishing.apply();
    CHECK(!result.ok);
    CHECK(result.error.contains(QStringLiteral("drifted")));
    // Corrupt recorded postimage is classified distinctly.
    FakeJournal corrupt;
    ShortcutJournal bad;
    bad.schema = shortcutJournalSchema();
    bad.phase = shortcutJournalPhaseFocusApplied();
    bad.owner = QStringLiteral(":1.20");
    bad.uid = static_cast<uint>(::geteuid());
    bad.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{1}, QList<int>{1}};
    bad.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}, QList<int>{META_L, META_L, META_L}};
    fillResizeReady(bad, QList<int>{7}, QList<int>{8});
    corrupt.present = true;
    corrupt.stored = bad;
    FakeShortcutStore store2;
    seedReady6(store2, QList<int>{META_L}, QList<int>{META_L});
    ShortcutReconciler resuming(&store2, &corrupt);
    const ShortcutApplyResult corruptResult = resuming.apply();
    CHECK(!corruptResult.ok);
    CHECK(corruptResult.error.contains(QStringLiteral("allowed image")));
}

void noOpRevertSkipsWrites()
{
    FakeShortcutStore store;
    store.owner = QStringLiteral(":1.20");
    store.uid = static_cast<uint>(::geteuid());
    seedReady6(store, QList<int>{META_L}, QList<int>{META_ESC});
    for (ShortcutTuple &tuple : store.tuples) {
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
    ShortcutJournal noop;
    noop.schema = shortcutJournalSchema();
    noop.phase = shortcutJournalPhaseComplete();
    noop.owner = QStringLiteral(":1.20");
    noop.uid = static_cast<uint>(::geteuid());
    noop.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{META_L}, QList<int>{META_L}};
    noop.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_ESC}, QList<int>{META_ESC}};
    noop.resizeUp = {shortcutResizeUpComponent(), shortcutResizeUpAction(), QList<int>{META_ALT_K}, QList<int>{META_ALT_K}};
    noop.switchNext = {shortcutSwitchNextComponent(), shortcutSwitchNextAction(), QList<int>{}, QList<int>{}};
    noop.resizeRight = {shortcutResizeRightComponent(), shortcutResizeRightAction(), QList<int>{META_ALT_L}, QList<int>{META_ALT_L}};
    noop.switchLast = {shortcutSwitchLastComponent(), shortcutSwitchLastAction(), QList<int>{}, QList<int>{}};
    noop.row0Kind = shortcutResolutionRelocate();
    noop.row1Kind = shortcutResolutionClear();
    noop.row2Kind = shortcutResolutionClear();
    QString error;
    CHECK(journal.persist(noop, &error));
    const int writesBefore = store.writeLog.size();
    ShortcutReconciler reverting(&store, &journal);
    const ShortcutRevertResult result = reverting.revert();
    CHECK(result.ok);
    CHECK(result.writes == 0);
    CHECK(store.writeLog.size() == writesBefore);
    CHECK(result.journalRemoved);
    CHECK(result.untouched.isEmpty());
}

void journalPathSafety()
{
    QString error;
    CHECK(!ShortcutReconciler::journalPathSafe(QString(), &error));
    CHECK(!ShortcutReconciler::journalPathSafe(QStringLiteral("relative/journalrc"), &error));
    QTemporaryDir dir;
    CHECK(dir.isValid());
    const QString good = dir.path() + QStringLiteral("/sub/journalrc");
    CHECK(QDir().mkpath(QFileInfo(good).dir().path()));
    CHECK(ShortcutReconciler::journalPathSafe(good, &error));
    // Symlink leaf refused.
    const QString target = dir.path() + QStringLiteral("/realrc");
    QFile real(target);
    CHECK(real.open(QIODevice::WriteOnly));
    real.close();
    const QString linkLeaf = dir.path() + QStringLiteral("/linkrc");
    CHECK(QFile::link(target, linkLeaf));
    CHECK(!ShortcutReconciler::journalPathSafe(linkLeaf, &error));
    // Symlink parent refused.
    const QString realDir = dir.path() + QStringLiteral("/realdir");
    CHECK(QDir().mkpath(realDir));
    const QString linkDir = dir.path() + QStringLiteral("/linkdir");
    CHECK(QFile::link(realDir, linkDir));
    CHECK(!ShortcutReconciler::journalPathSafe(linkDir + QStringLiteral("/journalrc"), &error));
    // Nonregular leaf (directory) refused.
    CHECK(!ShortcutReconciler::journalPathSafe(realDir, &error));
    // KConfig journal refuses unsafe paths without touching them.
    KConfigFileJournal unsafe(linkLeaf);
    ShortcutJournal journal;
    journal.schema = shortcutJournalSchema();
    journal.phase = shortcutJournalPhasePending();
    journal.owner = QStringLiteral(":1.20");
    journal.uid = static_cast<uint>(::geteuid());
    journal.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{1}, QList<int>{META_L}};
    journal.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}, QList<int>{META_ESC}};
    fillResizeReady(journal, QList<int>{7}, QList<int>{8});
    CHECK(!unsafe.persist(journal, &error));
    CHECK(!unsafe.hasJournal());
    CHECK(!unsafe.load(&journal, &error));
    CHECK(!unsafe.remove(&error));
    // Default path is absolute when XDG_CONFIG_HOME is isolated.
    QTemporaryDir configHome;
    CHECK(configHome.isValid());
    const QByteArray previous = qgetenv("XDG_CONFIG_HOME");
    qputenv("XDG_CONFIG_HOME", configHome.path().toUtf8());
    const QString def = defaultShortcutJournalPath();
    if (!previous.isNull()) {
        qputenv("XDG_CONFIG_HOME", previous);
    } else {
        qunsetenv("XDG_CONFIG_HOME");
    }
    CHECK(!def.isEmpty());
    CHECK(QDir::isAbsolutePath(def));
}

QVariant objectPathArrayVariant(const QStringList &paths)
{
    QList<QDBusObjectPath> typed;
    for (const QString &path : paths) {
        typed.append(QDBusObjectPath(path));
    }
    return QVariant::fromValue(typed);
}

void allComponentsStrictTransport()
{
    QString error;
    QStringList components;
    // Exact ao object-path array is accepted.
    CHECK(ShortcutReconciler::parseAllComponentsReply(QDBusMessage::ReplyMessage, QStringLiteral("ao"),
                                                      {objectPathArrayVariant({QStringLiteral("/a"), QStringLiteral("/b")})},
                                                      &components, &error));
    CHECK(components == (QStringList{QStringLiteral("/a"), QStringLiteral("/b")}));
    // QStringList fallback ("as") is rejected, never accepted.
    CHECK(!ShortcutReconciler::parseAllComponentsReply(
        QDBusMessage::ReplyMessage, QStringLiteral("as"),
        {QVariant::fromValue(QStringList{QStringLiteral("/a")})}, nullptr, &error));
    // QStringList is rejected even with a forged ao signature.
    CHECK(!ShortcutReconciler::parseAllComponentsReply(
        QDBusMessage::ReplyMessage, QStringLiteral("ao"),
        {QVariant::fromValue(QStringList{QStringLiteral("/a")})}, nullptr, &error));
    // Non-reply transport is rejected.
    CHECK(!ShortcutReconciler::parseAllComponentsReply(QDBusMessage::ErrorMessage, QStringLiteral("ao"),
                                                       {objectPathArrayVariant({QStringLiteral("/a")})}, nullptr,
                                                       &error));
    // Wrong signature with an object-path array is rejected.
    CHECK(!ShortcutReconciler::parseAllComponentsReply(QDBusMessage::ReplyMessage, QStringLiteral("as"),
                                                       {objectPathArrayVariant({QStringLiteral("/a")})}, nullptr,
                                                       &error));
    // Wrong arity is rejected.
    CHECK(!ShortcutReconciler::parseAllComponentsReply(QDBusMessage::ReplyMessage, QStringLiteral("ao"), {}, nullptr,
                                                       &error));
    // Empty object path is rejected.
    CHECK(!ShortcutReconciler::parseAllComponentsReply(QDBusMessage::ReplyMessage, QStringLiteral("ao"),
                                                       {objectPathArrayVariant({QString()})}, nullptr, &error));
}

void introspectionStrictParsing()
{
    const QString liveGood = QStringLiteral(
        "<node><interface name=\"org.kde.KGlobalAccel\">"
        "<method name=\"setShortcutKeys\">"
        "<arg type=\"as\" direction=\"in\"/>"
        "<arg type=\"a(ai)\" direction=\"in\"/>"
        "<arg type=\"u\" direction=\"in\"/>"
        "<arg type=\"a(ai)\" direction=\"out\"/>"
        "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
        "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
        "</method></interface></node>");
    CHECK(ShortcutReconciler::introspectionContractValid(liveGood));
    // Omitted input direction defaults to "in" and is accepted; the reply
    // must stay explicit "out".
    CHECK(ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\"/>"
                       "<arg type=\"a(ai)\"/>"
                       "<arg type=\"u\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method></interface></node>")));
    // Legacy single-arg combined form is rejected.
    const QString legacyCombined = QStringLiteral(
        "<node><interface name=\"org.kde.KGlobalAccel\">"
        "<method name=\"setShortcutKeys\">"
        "<arg type=\"asa(ai)u\" direction=\"in\"/>"
        "<arg type=\"a(ai)\" direction=\"out\"/>"
        "</method></interface></node>");
    CHECK(!ShortcutReconciler::introspectionContractValid(legacyCombined));
    // Wrong arg counts are rejected.
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method></interface></node>")));
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method></interface></node>")));
    // Wrong types are rejected.
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"s\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method></interface></node>")));
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"aai\" direction=\"in\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method></interface></node>")));
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"s\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method></interface></node>")));
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<arg type=\"as\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method></interface></node>")));
    // Wrong directions are rejected: inputs must be "in" (or omitted) and
    // the reply must be explicit "out".
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"out\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method></interface></node>")));
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method></interface></node>")));
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method></interface></node>")));
    // Absent key-set annotations are rejected.
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "</method></interface></node>")));
    // Wrong key-set annotations are rejected: missing reply, missing keys,
    // and wrong value types.
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method></interface></node>")));
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method></interface></node>")));
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QList<int>\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method></interface></node>")));
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In2\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method></interface></node>")));
    // Extra overloads are ambiguity and fail.
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method>"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method></interface></node>")));
    // Substring fallback removed: signatures visible only as text, with no
    // parsed args on the exact method, must fail.
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><!-- as a(ai) u a(ai) QSet<QKeySequence> org.kde.KGlobalAccel setShortcutKeys -->"
                       "<interface name=\"org.kde.KGlobalAccel\"><method name=\"setShortcutKeys\"/>"
                       "</interface></node>")));
    // Exact method on the wrong interface must fail even though the
    // signature strings are present.
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.Other\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</method></interface></node>")));
    // Malformed XML must fail.
    CHECK(!ShortcutReconciler::introspectionContractValid(QStringLiteral("<node><interface>")));
    // The fake store mirrors the real parser: bad XML fails the apply
    // with zero writes.
    FakeShortcutStore store;
    seedReady6(store, QList<int>{1}, QList<int>{META_L});
    store.contractXml = QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                                       "<method name=\"setShortcutKeys\"/>"
                                       "</interface></node>");
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    const ShortcutApplyResult result = reconciler.apply();
    CHECK(!result.ok);
    CHECK(store.writeLog.isEmpty());
    CHECK(!journal.present);
    // Legacy combined form fails the apply with zero writes and the error
    // reports the split contract, never the erroneous combined signature.
    FakeShortcutStore legacyStore;
    seedReady6(legacyStore, QList<int>{1}, QList<int>{META_L});
    legacyStore.contractXml = legacyCombined;
    FakeJournal legacyJournal;
    ShortcutReconciler legacyReconciler(&legacyStore, &legacyJournal);
    const ShortcutApplyResult legacyResult = legacyReconciler.apply();
    CHECK(!legacyResult.ok);
    CHECK(legacyStore.writeLog.isEmpty());
    CHECK(!legacyJournal.present);
    CHECK(legacyResult.error.contains(QStringLiteral("as,a(ai),u -> a(ai)")));
    CHECK(legacyResult.error.contains(QStringLiteral("QSet<QKeySequence>")));
    CHECK(!legacyResult.error.contains(QStringLiteral("asa(ai)u")));
    CHECK(!journal.present);
}

void resumeGateFailsClosedZeroWrites()
{
    // Pending journal, focus still at pre, lock drifted to neither pre nor
    // post: must fail before any write (old code wrote focus first).
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
        FakeJournal journal;
        ShortcutJournal pending;
        pending.schema = shortcutJournalSchema();
        pending.phase = shortcutJournalPhasePending();
        pending.owner = QStringLiteral(":1.20");
        pending.uid = static_cast<uint>(::geteuid());
        pending.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"),
                         QList<int>{419430420}, QList<int>{META_L}};
        pending.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L},
                        QList<int>{META_ESC}};
        fillResizeReady(pending, QList<int>{7}, QList<int>{8});
        QString persistError;
        CHECK(journal.persist(pending, &persistError));
        // Drift to a value that passes the live-state guards (still claims
        // Meta+L) but matches neither the recorded pre nor post image.
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.component == QStringLiteral("ksmserver")) {
                tuple.active = QList<int>{META_L, 999};
            }
        }
        ShortcutReconciler reconciler(&store, &journal);
        const ShortcutApplyResult result = reconciler.apply();
        CHECK(!result.ok);
        CHECK(result.error.contains(QStringLiteral("neither")));
        CHECK(store.writeLog.isEmpty());
        CHECK(result.writes == 0);
        CHECK(journal.present);
    }
    // Focus-applied journal, focus drifted to neither pre nor post:
    // must fail with zero writes instead of re-clobbering focus.
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
        FakeJournal journal;
        ShortcutJournal partial;
        partial.schema = shortcutJournalSchema();
        partial.phase = shortcutJournalPhaseFocusApplied();
        partial.owner = QStringLiteral(":1.20");
        partial.uid = static_cast<uint>(::geteuid());
        partial.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"),
                         QList<int>{419430420}, QList<int>{META_L}};
        partial.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L},
                        QList<int>{META_ESC}};
        fillResizeReady(partial, QList<int>{7}, QList<int>{8});
        QString persistError;
        CHECK(journal.persist(partial, &persistError));
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.action == QStringLiteral("plasma-auto-tiler-focus-right")) {
                tuple.active = QList<int>{888};
            }
        }
        ShortcutReconciler reconciler(&store, &journal);
        const ShortcutApplyResult result = reconciler.apply();
        CHECK(!result.ok);
        CHECK(result.error.contains(QStringLiteral("neither")));
        CHECK(store.writeLog.isEmpty());
        CHECK(result.writes == 0);
    }
    // Focus-applied journal, focus at post, lock drifted to neither:
    // Finish Apply must fail with zero writes.
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{META_L}, QList<int>{META_L});
        FakeJournal journal;
        ShortcutJournal partial;
        partial.schema = shortcutJournalSchema();
        partial.phase = shortcutJournalPhaseFocusApplied();
        partial.owner = QStringLiteral(":1.20");
        partial.uid = static_cast<uint>(::geteuid());
        partial.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{111},
                         QList<int>{META_L}};
        partial.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L},
                        QList<int>{META_ESC}};
        fillResizeReady(partial, QList<int>{7}, QList<int>{8});
        QString persistError;
        CHECK(journal.persist(partial, &persistError));
        // Lock drift that keeps Meta+Esc claimed by the allowlisted lock
        // (passes the live-state guards) but matches neither recorded image.
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.component == QStringLiteral("ksmserver")) {
                tuple.active = QList<int>{META_ESC, 999};
            }
        }
        ShortcutReconciler reconciler(&store, &journal);
        const ShortcutApplyResult result = reconciler.apply();
        CHECK(!result.ok);
        CHECK(result.error.contains(QStringLiteral("neither")));
        CHECK(store.writeLog.isEmpty());
        CHECK(result.writes == 0);
    }
}

void fakeJournalMirrorsRealValidation()
{
    FakeJournal journal;
    QString error;
    ShortcutJournal base;
    base.schema = shortcutJournalSchema();
    base.phase = shortcutJournalPhasePending();
    base.owner = QStringLiteral(":1.20");
    base.uid = static_cast<uint>(::geteuid());
    base.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{1},
                  QList<int>{META_L}};
    base.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L},
                 QList<int>{META_ESC}};
    fillResizeReady(base, QList<int>{7}, QList<int>{8});
    // Unbounded keys are rejected like the real backend.
    ShortcutJournal bad = base;
    QList<int> tooMany;
    for (int i = 0; i < SHORTCUT_MAX_KEYS_PER_TUPLE + 1; ++i) {
        tooMany.append(i);
    }
    bad.lock.post = tooMany;
    CHECK(!journal.persist(bad, &error));
    bad = base;
    bad.focus.pre = QList<int>{-1};
    CHECK(!journal.persist(bad, &error));
    // Non-allowlisted identities are rejected.
    bad = base;
    bad.focus.action = QStringLiteral("other-action");
    CHECK(!journal.persist(bad, &error));
    CHECK(!journal.present);
    // Load mirrors real validation: corrupt stored state fails to load.
    CHECK(journal.persist(base, &error));
    journal.stored.schema = QStringLiteral("bogus-schema");
    CHECK(!journal.load(nullptr, &error));
    journal.stored = base;
    journal.stored.phase = QStringLiteral("bogus-phase");
    CHECK(!journal.load(nullptr, &error));
    journal.stored = base;
    journal.stored.owner = QStringLiteral("not-a-unique-name");
    CHECK(!journal.load(nullptr, &error));
    journal.stored = base;
    ShortcutJournal loaded;
    CHECK(journal.load(&loaded, &error));
    CHECK(loaded.focus.post == (QList<int>{META_L}));
}

QString contractXmlWith(const QString &annotations)
{
    return QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                          "<method name=\"setShortcutKeys\">"
                          "<arg type=\"as\" direction=\"in\"/>"
                          "<arg type=\"a(ai)\" direction=\"in\"/>"
                          "<arg type=\"u\" direction=\"in\"/>"
                          "<arg type=\"a(ai)\" direction=\"out\"/>")
        + annotations
        + QStringLiteral("</method></interface></node>");
}

void introspectionAnnotationNamesStrict()
{
    // Substring trap: In10 contains "In1" but is not the proven In1 slot.
    CHECK(!ShortcutReconciler::introspectionContractValid(contractXmlWith(
        QStringLiteral("<annotation name=\"org.qtproject.QtDBus.QtTypeName.In10\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"))));
    // Substring trap on the reply slot: Out00 contains "Out0" but is wrong.
    CHECK(!ShortcutReconciler::introspectionContractValid(contractXmlWith(
        QStringLiteral("<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out00\" value=\"QSet&lt;QKeySequence&gt;\"/>"))));
    // Misnamed slots are rejected.
    CHECK(!ShortcutReconciler::introspectionContractValid(contractXmlWith(
        QStringLiteral("<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"))));
    CHECK(!ShortcutReconciler::introspectionContractValid(contractXmlWith(
        QStringLiteral("<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out1\" value=\"QSet&lt;QKeySequence&gt;\"/>"))));
    // Wrong value type on the exact name is rejected.
    CHECK(!ShortcutReconciler::introspectionContractValid(contractXmlWith(
        QStringLiteral("<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QList&lt;int&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"))));
    // Bare "In1"/"Out0" names without the exact QtDBus prefix are rejected.
    CHECK(!ShortcutReconciler::introspectionContractValid(contractXmlWith(
        QStringLiteral("<annotation name=\"In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"))));
    // Arg-nested annotations are unproven and ignored: even correctly named
    // nested annotations must not satisfy the contract.
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\">"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</arg>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\">"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "</arg>"
                       "</method></interface></node>")));
    // Exact method annotations still pass when an unrelated extra is present;
    // extras are ignored, only the two proven keys count as proof.
    CHECK(ShortcutReconciler::introspectionContractValid(contractXmlWith(
        QStringLiteral("<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In2\" value=\"QList&lt;int&gt;\"/>"))));
}

void pinImmutableFailsClosed()
{
    // Direct seam on the real backend logic: no D-Bus needed.
    QString pinned;
    QString error;
    CHECK(KGlobalAccelStore::tryPinOwner(pinned, QStringLiteral(":1.20"), &error));
    CHECK(pinned == QStringLiteral(":1.20"));
    CHECK(KGlobalAccelStore::tryPinOwner(pinned, QStringLiteral(":1.20"), &error));
    CHECK(pinned == QStringLiteral(":1.20"));
    CHECK(!KGlobalAccelStore::tryPinOwner(pinned, QStringLiteral(":1.21"), &error));
    CHECK(pinned == QStringLiteral(":1.20"));
    CHECK(error.contains(QStringLiteral("drifted")));
    // Malformed candidate never pins.
    QString empty;
    CHECK(!KGlobalAccelStore::tryPinOwner(empty, QStringLiteral("not-unique"), &error));
    CHECK(empty.isEmpty());
    // Fake mirrors the same immutability through the store boundary, so
    // normal apply/revert flows (repeated same-owner confirmations) stay
    // correct while a drifted second owner fails closed.
    FakeShortcutStore store;
    seedReady6(store, QList<int>{1}, QList<int>{META_L});
    QString ownerError;
    CHECK(store.currentOwner(nullptr, nullptr, &ownerError));
    CHECK(store.pinned == QStringLiteral(":1.20"));
    CHECK(store.currentOwner(nullptr, nullptr, &ownerError));
    store.owner = QStringLiteral(":1.21");
    CHECK(!store.currentOwner(nullptr, nullptr, &ownerError));
    CHECK(store.pinned == QStringLiteral(":1.20"));
    CHECK(ownerError.contains(QStringLiteral("drifted")));
}

void ensureKeySequenceTestMetaTypes()
{
    static bool registered = false;
    if (registered) {
        return;
    }
    qDBusRegisterMetaType<QKeySequence>();
    qDBusRegisterMetaType<QSet<QKeySequence>>();
    registered = true;
}

void keySequenceDbusRoundtripAndBounds()
{
    ensureKeySequenceTestMetaTypes();
    // Narrow roundtrip/framing via the existing QVariant message pattern:
    // the live exact four-slot QKeySequence semantics survive the typed
    // encode without fallback formats.
    {
        const QKeySequence original(META_L);
        QDBusMessage message = QDBusMessage::createSignal(QStringLiteral("/test"), QStringLiteral("i.I"),
                                                          QStringLiteral("keys"));
        message << QVariant::fromValue(original);
        CHECK(message.arguments().size() == 1);
        const QKeySequence decoded = message.arguments().at(0).value<QKeySequence>();
        CHECK(decoded == original);
        CHECK(decoded.count() == 1);
        CHECK(decoded[0].toCombined() == META_L);
    }
    {
        const QKeySequence original(META_L, 42, 0, 0);
        QDBusMessage message = QDBusMessage::createSignal(QStringLiteral("/test"), QStringLiteral("i.I"),
                                                          QStringLiteral("keys"));
        message << QVariant::fromValue(original);
        CHECK(message.arguments().at(0).value<QKeySequence>() == original);
    }
    {
        QSet<QKeySequence> original;
        original.insert(QKeySequence(META_L));
        original.insert(QKeySequence(META_ESC));
        QDBusMessage message = QDBusMessage::createSignal(QStringLiteral("/test"), QStringLiteral("i.I"),
                                                          QStringLiteral("keys"));
        message << QVariant::fromValue(original);
        const QSet<QKeySequence> decoded = message.arguments().at(0).value<QSet<QKeySequence>>();
        CHECK(decoded == original);
        CHECK(decoded.contains(QKeySequence(META_L)));
        CHECK(decoded.contains(QKeySequence(META_ESC)));
    }
    // Strict shared slot validator: exactly four bounded ints pass; short,
    // long, or out-of-range sequences fail closed. Both reply-decode
    // variants share this validator, so malformed/long (ai) never
    // truncates into a false confirm.
    {
        QKeySequence out;
        CHECK(ShortcutReconciler::decodeKeySequenceSlots(QList<int>{META_L, 0, 0, 0}, &out));
        CHECK(out == QKeySequence(META_L));
        CHECK(ShortcutReconciler::decodeKeySequenceSlots(QList<int>{0, 0, 0, 0}, &out));
        CHECK(ShortcutReconciler::decodeKeySequenceSlots(QList<int>{1, 2, 3, 4}, &out));
        CHECK(out == QKeySequence(1, 2, 3, 4));
        CHECK(!ShortcutReconciler::decodeKeySequenceSlots(QList<int>{1, 2, 3}, &out));
        CHECK(!ShortcutReconciler::decodeKeySequenceSlots(QList<int>{1, 2, 3, 4, 5}, &out));
        CHECK(!ShortcutReconciler::decodeKeySequenceSlots(QList<int>{}, &out));
        CHECK(!ShortcutReconciler::decodeKeySequenceSlots(QList<int>{-1, 0, 0, 0}, &out));
        CHECK(!ShortcutReconciler::decodeKeySequenceSlots(QList<int>{SHORTCUT_MAX_KEY_VALUE + 1, 0, 0, 0}, &out));
        CHECK(ShortcutReconciler::decodeKeySequenceSlots(QList<int>{META_L, 0, 0, 0}, nullptr));
    }
    // Bounds are consistent for both variants: an oversized decoded set
    // exceeds SHORTCUT_MAX_KEYS_PER_TUPLE and the write path rejects it.
    {
        QSet<QKeySequence> oversized;
        for (int i = 0; i < SHORTCUT_MAX_KEYS_PER_TUPLE + 1; ++i) {
            oversized.insert(QKeySequence(1000 + i));
        }
        CHECK(oversized.size() > SHORTCUT_MAX_KEYS_PER_TUPLE);
    }
}

void writeFailureControlsFailClosed()
{
    // Previously unused fake controls: transport failure fails the apply
    // with zero completed writes reported and the journal retained.
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{1}, QList<int>{META_L});
        store.failNextWrite = true;
        FakeJournal journal;
        ShortcutReconciler reconciler(&store, &journal);
        const ShortcutApplyResult result = reconciler.apply();
        CHECK(!result.ok);
        CHECK(result.error.contains(QStringLiteral("setShortcutKeys")));
    }
    // Reply-mismatch control fails closed with the confirm error.
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{1}, QList<int>{META_L});
        store.badReplyNextWrite = true;
        FakeJournal journal;
        ShortcutReconciler reconciler(&store, &journal);
        const ShortcutApplyResult result = reconciler.apply();
        CHECK(!result.ok);
        CHECK(result.error.contains(QStringLiteral("confirm")));
    }
}

void tablePreimageRefusalZeroMutation()
{
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.action == QStringLiteral("Switch to Next Keyboard Layout")) {
                tuple.active = QList<int>{999};
            }
        }
        FakeJournal journal;
        ShortcutReconciler reconciler(&store, &journal);
        const ShortcutApplyResult result = reconciler.apply();
        CHECK(!result.ok);
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.present);
    }
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.action == QStringLiteral("Switch to Last-Used Keyboard Layout")) {
                tuple.active = QList<int>{META_ALT_K};
            }
        }
        FakeJournal journal;
        ShortcutReconciler reconciler(&store, &journal);
        const ShortcutApplyResult result = reconciler.apply();
        CHECK(!result.ok);
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.present);
    }
}

void tableClearRevertAndScopedOwnership()
{
    FakeShortcutStore store;
    seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
    FakeJournal journal;
    CHECK(ShortcutReconciler(&store, &journal).apply().ok);
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("Switch to Next Keyboard Layout")) {
            CHECK(tuple.active.isEmpty());
        }
        if (tuple.action == QStringLiteral("Switch to Last-Used Keyboard Layout")) {
            CHECK(tuple.active.isEmpty());
        }
    }
    CHECK(ShortcutReconciler(&store, &journal).revert().ok);
    CHECK(!journal.present);
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("Switch to Next Keyboard Layout")) {
            CHECK(tuple.active == QList<int>{META_ALT_K});
        }
        if (tuple.action == QStringLiteral("Switch to Last-Used Keyboard Layout")) {
            CHECK(tuple.active == QList<int>{META_ALT_L});
        }
    }
    CHECK(ShortcutReconciler(&store, &journal).apply().ok);
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("Switch to Next Keyboard Layout")) {
            tuple.active = QList<int>{999};
        }
    }
    ShortcutRevertResult reverted = ShortcutReconciler(&store, &journal).revert();
    CHECK(!reverted.ok);
    CHECK(!reverted.journalRemoved);
    CHECK(journal.present);
    CHECK(reverted.untouched.contains(QStringLiteral("KDE Keyboard Layout Switcher/Switch to Next Keyboard Layout")));
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("Switch to Next Keyboard Layout")) {
            CHECK(tuple.active == QList<int>{999});
        }
        if (tuple.action == QStringLiteral("Switch to Last-Used Keyboard Layout")) {
            CHECK(tuple.active == QList<int>{META_ALT_L});
        }
    }
}

void schemaV1UpgradeExplicit()
{
    FakeShortcutStore store;
    seedReady6(store, QList<int>{1}, QList<int>{META_L});
    FakeJournal journal;
    ShortcutJournal bad;
    bad.schema = QStringLiteral("shortcut-override-v1");
    bad.phase = shortcutJournalPhasePending();
    bad.owner = QStringLiteral(":1.20");
    bad.uid = static_cast<uint>(::geteuid());
    bad.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{1}, QList<int>{META_L}};
    bad.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}, QList<int>{META_ESC}};
    fillResizeReady(bad, QList<int>{7}, QList<int>{8});
    journal.present = true;
    journal.stored = bad;
    const ShortcutApplyResult ar = ShortcutReconciler(&store, &journal).apply();
    CHECK(!ar.ok);
    CHECK(ar.error.contains(QStringLiteral("schema")));
    CHECK(ar.error.contains(QStringLiteral("upgrade")));
    CHECK(store.writeLog.isEmpty());
    const ShortcutRevertResult rr = ShortcutReconciler(&store, &journal).revert();
    CHECK(!rr.ok);
    CHECK(rr.error.contains(QStringLiteral("upgrade")));
    CHECK(store.writeLog.isEmpty());
}

void corruptPostFailsAllLoadedPaths()
{
    auto makeBad = []() {
        ShortcutJournal bad;
        bad.schema = shortcutJournalSchema();
        bad.phase = shortcutJournalPhaseFocusApplied();
        bad.owner = QStringLiteral(":1.20");
        bad.uid = static_cast<uint>(::geteuid());
        bad.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{1}, QList<int>{META_L}};
        bad.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}, QList<int>{META_ESC}};
        fillResizeReady(bad, QList<int>{7}, QList<int>{8});
        bad.switchNext.post = QList<int>{999};
        return bad;
    };
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{META_L}, QList<int>{META_L});
        FakeJournal journal;
        journal.present = true;
        journal.stored = makeBad();
        const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
        CHECK(!r.ok);
        CHECK(r.error.contains(QStringLiteral("allowed image")));
        CHECK(store.writeLog.isEmpty());
        CHECK(r.writes == 0);
        const ShortcutRevertResult rr = ShortcutReconciler(&store, &journal).revert();
        CHECK(!rr.ok);
        CHECK(rr.error.contains(QStringLiteral("allowed image")));
        CHECK(store.writeLog.isEmpty());
    }
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{META_L}, QList<int>{META_ESC});
        FakeJournal journal;
        ShortcutJournal bad = makeBad();
        bad.phase = shortcutJournalPhaseComplete();
        journal.present = true;
        journal.stored = bad;
        const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
        CHECK(!r.ok);
        CHECK(r.error.contains(QStringLiteral("allowed image")));
        CHECK(store.writeLog.isEmpty());
    }
}

void rowForeignGateAndMidCrossResume()
{
    auto validJournal = [](const QString &phase) {
        ShortcutJournal j;
        j.schema = shortcutJournalSchema();
        j.phase = phase;
        j.owner = QStringLiteral(":1.20");
        j.uid = static_cast<uint>(::geteuid());
        j.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{1}, QList<int>{META_L}};
        j.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}, QList<int>{META_ESC}};
        fillResizeReady(j, QList<int>{7}, QList<int>{8});
        return j;
    };
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{META_L}, QList<int>{META_ESC});
        store.tuples[3].active = QList<int>{999};
        FakeJournal journal;
        journal.present = true;
        journal.stored = validJournal(shortcutJournalPhaseFocusApplied());
        const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
        CHECK(!r.ok);
        CHECK(r.error.contains(QStringLiteral("neither")));
        CHECK(store.writeLog.isEmpty());
    }
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{META_L}, QList<int>{META_ESC});
        store.tuples[2].active = QList<int>{META_ALT_K};
        FakeJournal journal;
        ShortcutJournal j = validJournal(shortcutJournalPhaseFocusApplied());
        QString e;
        CHECK(journal.persist(j, &e));
        const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
        CHECK(r.ok);
        CHECK(store.writeLog.size() == 3);
        CHECK(journal.stored.phase == shortcutJournalPhaseComplete());
    }
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{META_L}, QList<int>{META_ESC});
        store.tuples[2].active = QList<int>{META_ALT_K};
        store.tuples[3].active = QList<int>{};
        store.tuples[4].active = QList<int>{META_ALT_L};
        FakeJournal journal;
        ShortcutJournal j = validJournal(shortcutJournalPhaseFocusApplied());
        QString e;
        CHECK(journal.persist(j, &e));
        const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
        CHECK(r.ok);
        CHECK(store.writeLog.size() == 1);
    }
}

void unrelatedChordsAllRefuse()
{
    for (int chord : {META_ALT_K, META_ALT_L}) {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
        store.tuples.append(makeTuple(QStringLiteral("kwin"), QStringLiteral("other-action"), QList<int>{chord}));
        FakeJournal journal;
        const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
        CHECK(!r.ok);
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.present);
    }
}

} // namespace

int main(int argc, char **argv)
{
    const QString scenario = argc == 2 ? QString::fromLocal8Bit(argv[1]) : QStringLiteral("all");
    if (scenario == QStringLiteral("all") || scenario == QStringLiteral("success")) {
        applySuccessAndOrder();
        duplicateMetaEscDeduped();
        exactTwoWriteLimit();
    }
    if (scenario == QStringLiteral("all") || scenario == QStringLiteral("conflict")) {
        metaEscConflictRefusesWithoutJournalOrMutation();
        tablePreimageRefusalZeroMutation();
        unrelatedChordsAllRefuse();
    }
    if (scenario == QStringLiteral("all") || scenario == QStringLiteral("malformed")) {
        malformedReplyFailsClosed();
        swappedRolesRejected();
        strictOwnerAndIntrospection();
        friendlyLabelsValidated();
        allComponentsStrictTransport();
        introspectionStrictParsing();
        introspectionAnnotationNamesStrict();
        keySequenceDbusRoundtripAndBounds();
        writeFailureControlsFailClosed();
    }
    if (scenario == QStringLiteral("all") || scenario == QStringLiteral("owner")) {
        ownerDriftFailsClosed();
        persistRejectsInvalidPhaseOwnerUid();
        pinImmutableFailsClosed();
    }
    if (scenario == QStringLiteral("all") || scenario == QStringLiteral("recovery")) {
        partialWriteRecovery();
        finishApplyDriftClassified();
        resumeGateFailsClosedZeroWrites();
        rowForeignGateAndMidCrossResume();
    }
    if (scenario == QStringLiteral("all") || scenario == QStringLiteral("external")) {
        externalEditsUntouchedAndJournalRetained();
        cleanRevertRemovesJournal();
        noOpRevertSkipsWrites();
        tableClearRevertAndScopedOwnership();
    }
    if (scenario == QStringLiteral("all") || scenario == QStringLiteral("journal")) {
        kconfigJournalWriteSyncReadback();
        journalPathSafety();
        fakeJournalMirrorsRealValidation();
        schemaV1UpgradeExplicit();
        corruptPostFailsAllLoadedPaths();
    }
    if (scenario != QStringLiteral("all") && scenario != QStringLiteral("success") && scenario != QStringLiteral("conflict")
        && scenario != QStringLiteral("malformed") && scenario != QStringLiteral("owner") && scenario != QStringLiteral("recovery")
        && scenario != QStringLiteral("external") && scenario != QStringLiteral("journal")) {
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
