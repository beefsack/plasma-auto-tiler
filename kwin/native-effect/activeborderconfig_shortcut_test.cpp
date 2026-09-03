#include "activeborderconfig_module.h"
#include "shortcutreconciler.h"

#include <KPluginMetaData>

#include <QApplication>
#include <QClipboard>
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
                || !ShortcutReconciler::stringValid(tuple.action) || !ShortcutReconciler::stringValid(tuple.friendly)
                || !ShortcutReconciler::stringValid(tuple.componentFriendly)) {
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
        if (!ShortcutReconciler::uniqueNameValid(stored.owner)) {
            if (error) {
                *error = QStringLiteral("journal owner is malformed");
            }
            return false;
        }
        if (!ShortcutReconciler::keysValid(stored.focus.pre) || !ShortcutReconciler::keysValid(stored.focus.post)
            || !ShortcutReconciler::keysValid(stored.lock.pre) || !ShortcutReconciler::keysValid(stored.lock.post)) {
            if (error) {
                *error = QStringLiteral("journal entries are outside the exact allowlist");
            }
            return false;
        }
        if (!ShortcutReconciler::isAllowlisted(stored.focus.component, stored.focus.action)
            || !ShortcutReconciler::isAllowlisted(stored.lock.component, stored.lock.action)) {
            if (error) {
                *error = QStringLiteral("journal entries are outside the exact allowlist");
            }
            return false;
        }
        if (journal) {
            *journal = stored;
        }
        return true;
    }

    bool persist(const ShortcutJournal &journal, QString *error) override
    {
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
        if (!ShortcutReconciler::journalRolesValid(journal)) {
            if (error) {
                *error = QStringLiteral("refusing to persist a journal outside the exact allowlist");
            }
            return false;
        }
        if (!ShortcutReconciler::keysValid(journal.focus.pre) || !ShortcutReconciler::keysValid(journal.focus.post)
            || !ShortcutReconciler::keysValid(journal.lock.pre) || !ShortcutReconciler::keysValid(journal.lock.post)) {
            if (error) {
                *error = QStringLiteral("refusing to persist a journal outside the exact allowlist");
            }
            return false;
        }
        if (!ShortcutReconciler::isAllowlisted(journal.focus.component, journal.focus.action)
            || !ShortcutReconciler::isAllowlisted(journal.lock.component, journal.lock.action)) {
            if (error) {
                *error = QStringLiteral("refusing to persist a journal outside the exact allowlist");
            }
            return false;
        }
        stored = journal;
        present = true;
        ++persists;
        // Readback mirrors the real backend: every field must round-trip.
        const ShortcutJournal readback = stored;
        if (readback.schema != journal.schema || readback.phase != journal.phase || readback.owner != journal.owner
            || readback.uid != journal.uid || readback.focus.component != journal.focus.component
            || readback.focus.action != journal.focus.action || readback.focus.pre != journal.focus.pre
            || readback.focus.post != journal.focus.post || readback.lock.component != journal.lock.component
            || readback.lock.action != journal.lock.action || readback.lock.pre != journal.lock.pre
            || readback.lock.post != journal.lock.post) {
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

void seedReady(FakeShortcutStore &store)
{
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{419430420}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
    };
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
            if (tuple.component == QStringLiteral("kwin")) {
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
        CHECK(store.writeLog.size() == writesBefore + 1);
        CHECK(store.writeLog.last().component == QStringLiteral("ksmserver"));
        CHECK(module.shortcutErrorText().isEmpty());
        CHECK(!module.isShortcutFinishApplyVisible());
        CHECK(!module.isShortcutRestoreVisible());
    }
    {
        FakeShortcutStore store;
        seedReady(store);
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.component == QStringLiteral("kwin")) {
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
    CHECK(store.writeLog.size() == 2);
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
        if (tuple.component == QStringLiteral("kwin")) {
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
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.component == QStringLiteral("kwin")) {
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
        if (tuple.component == QStringLiteral("kwin")) {
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

} // namespace

int main(int argc, char **argv)
{
    QTemporaryDir configHome;
    if (!configHome.isValid()) {
        std::fprintf(stderr, "failed to create temporary config directory\n");
        return EXIT_FAILURE;
    }
    qputenv("XDG_CONFIG_HOME", configHome.path().toUtf8());
    QApplication app(argc, argv);
    app.clipboard()->setMimeData(new QMimeData);

    if (argc != 2) {
        std::fprintf(stderr, "usage: %s ordinary|recovery|confirm|state\n", argv[0]);
        return EXIT_FAILURE;
    }

    const QString scenario = QString::fromLocal8Bit(argv[1]);
    if (scenario == QStringLiteral("ordinary")) {
        ordinarySettingsApplyNeverMutatesShortcuts();
    } else if (scenario == QStringLiteral("recovery")) {
        recoveryVisibilityAndRouting();
    } else if (scenario == QStringLiteral("confirm")) {
        confirmationGatesEveryMutation();
    } else if (scenario == QStringLiteral("state")) {
        stateAndErrorPresentation();
        completeJournalStatusComparesExactPostimages();
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
