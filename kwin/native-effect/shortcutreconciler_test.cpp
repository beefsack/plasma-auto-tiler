#include "shortcutreconciler.h"

#include <QDBusArgument>
#include <QDBusMessage>
#include <QDBusObjectPath>
#include <QDir>
#include <QFile>
#include <QFileInfo>
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
        "<arg type=\"asa(ai)u\" direction=\"in\"/>"
        "<arg type=\"a(ai)\" direction=\"out\"/>"
        "</method></interface></node>");
    bool malformedRead = false;
    bool driftAfterNextWrite = false;
    bool failNextWrite = false;
    bool badReplyNextWrite = false;
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
                *error = QStringLiteral("KGlobalAccel setShortcutKeys is absent or does not expose exactly asa(ai)u -> a(ai)");
            }
            return false;
        }
        if (!ShortcutReconciler::introspectionContractValid(contractXml)) {
            if (error) {
                *error = QStringLiteral("KGlobalAccel setShortcutKeys is absent or does not expose exactly asa(ai)u -> a(ai)");
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
        // Sync+readback mirrors the real backend: every field must round-trip.
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

void applySuccessAndOrder()
{
    FakeShortcutStore store;
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{419430420}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L, 134217795}),
    };
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    const ShortcutApplyResult result = reconciler.apply();
    CHECK(result.ok);
    CHECK(result.writes == 2);
    CHECK(journal.present);
    CHECK(store.uid == static_cast<uint>(::geteuid()));
    CHECK(journal.stored.uid == static_cast<uint>(::geteuid()));
    CHECK(store.writeLog.size() == 2);
    if (store.writeLog.size() == 2) {
        CHECK(store.writeLog.at(0).component == QStringLiteral("kwin"));
        CHECK(store.writeLog.at(0).action == QStringLiteral("plasma-auto-tiler-focus-right"));
        CHECK(store.writeLog.at(0).keys == QList<int>{META_L});
        CHECK(store.writeLog.at(1).component == QStringLiteral("ksmserver"));
        CHECK(store.writeLog.at(1).action == QStringLiteral("Lock Session"));
        // Other lock keys preserved exactly in order, Meta+L replaced by Meta+Esc.
        CHECK(store.writeLog.at(1).keys == (QList<int>{META_ESC, 134217795}));
    }
    // Final daemon state is the allowed post image.
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.component == QStringLiteral("kwin")) {
            CHECK(tuple.active == (QList<int>{META_L}));
        }
        if (tuple.component == QStringLiteral("ksmserver")) {
            CHECK(tuple.active == (QList<int>{META_ESC, 134217795}));
        }
    }
    // No out-of-allowlist writes.
    for (const auto &record : store.writeLog) {
        CHECK(ShortcutReconciler::isAllowlisted(record.component, record.action));
    }
}

void metaEscConflictRefusesWithoutJournalOrMutation()
{
    FakeShortcutStore store;
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{419430420}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("other-action"), QList<int>{META_ESC}),
    };
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
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{META_L}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
    };
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
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{419430420}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
    };
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
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{419430420}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
    };
    FakeJournal journal;
    // Simulate interruption: focus write verified, journal at focus-applied,
    // lock still at pre. Re-apply must resume the lock write only.
    ShortcutJournal partial;
    partial.schema = shortcutJournalSchema();
    partial.phase = shortcutJournalPhaseFocusApplied();
    partial.owner = QStringLiteral(":1.20");
    partial.uid = static_cast<uint>(::geteuid());
    partial.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{419430420}, QList<int>{META_L}};
    partial.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}, QList<int>{META_ESC}};
    QString persistError;
    CHECK(journal.persist(partial, &persistError));
    CHECK(partial.uid == static_cast<uint>(::geteuid()));
    // Daemon reflects the partial progress.
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.component == QStringLiteral("kwin")) {
            tuple.active = QList<int>{META_L};
        }
    }
    ShortcutReconciler reconciler(&store, &journal);
    const ShortcutApplyResult result = reconciler.apply();
    CHECK(result.ok);
    CHECK(store.writeLog.size() == 1);
    if (!store.writeLog.isEmpty()) {
        CHECK(store.writeLog.at(0).component == QStringLiteral("ksmserver"));
        CHECK(store.writeLog.at(0).keys == (QList<int>{META_ESC}));
    }
    ShortcutJournal loaded;
    QString loadError;
    CHECK(journal.load(&loaded, &loadError));
    CHECK(loaded.phase == shortcutJournalPhaseComplete());
}

void externalEditsUntouchedAndJournalRetained()
{
    FakeShortcutStore store;
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{419430420}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L, 42}),
    };
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    CHECK(reconciler.apply().ok);
    // External edit to focus after apply-complete.
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.component == QStringLiteral("kwin")) {
            tuple.active = QList<int>{111};
        }
    }
    ShortcutReconciler reverting(&store, &journal);
    const ShortcutRevertResult reverted = reverting.revert();
    CHECK(!reverted.ok);
    CHECK(!reverted.journalRemoved);
    CHECK(journal.present);
    CHECK(reverted.untouched.contains(QStringLiteral("kwin/plasma-auto-tiler-focus-right")));
    // Lock was still owned, so it is restored; focus external edit is untouched.
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.component == QStringLiteral("ksmserver")) {
            CHECK(tuple.active == (QList<int>{META_L, 42}));
        }
        if (tuple.component == QStringLiteral("kwin")) {
            CHECK(tuple.active == (QList<int>{111}));
        }
    }
    // No out-of-allowlist writes across apply+revert.
    for (const auto &record : store.writeLog) {
        CHECK(ShortcutReconciler::isAllowlisted(record.component, record.action));
    }
}

void cleanRevertRemovesJournal()
{
    FakeShortcutStore store;
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{419430420}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
    };
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
    QString error;
    CHECK(!journal.persist(swapped, &error));
    CHECK(!journal.present);
    // Loader-equivalent role check through the public predicate.
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
        "<arg type=\"asa(ai)u\" direction=\"in\"/>"
        "<arg type=\"a(ai)\" direction=\"out\"/>"
        "</method></interface></node>");
    CHECK(ShortcutReconciler::introspectionContractValid(good));
    CHECK(!ShortcutReconciler::introspectionContractValid(QString()));
    CHECK(!ShortcutReconciler::introspectionContractValid(QStringLiteral("<node/>")));
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\"><method name=\"other\"/></interface></node>")));
    // Malformed owner fails closed through the store.
    FakeShortcutStore store;
    store.owner = QStringLiteral("not-unique");
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{1}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
    };
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    CHECK(!reconciler.apply().ok);
    CHECK(store.writeLog.isEmpty());
}

void friendlyLabelsValidated()
{
    FakeShortcutStore store;
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{1}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
    };
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
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{1}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L, META_L, 42}),
    };
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    const ShortcutApplyResult result = reconciler.apply();
    CHECK(result.ok);
    CHECK(store.writeLog.size() == 2);
    if (store.writeLog.size() == 2) {
        CHECK(store.writeLog.at(1).keys == (QList<int>{META_ESC, 42}));
    }
}

void exactTwoWriteLimit()
{
    FakeShortcutStore store;
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{1}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
    };
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    const ShortcutApplyResult result = reconciler.apply();
    CHECK(result.ok);
    // Exact-two-write constraint: one apply uses exactly two tuple writes.
    CHECK(result.writes == 2);
    CHECK(result.writes <= SHORTCUT_MAX_WRITES);
    CHECK(store.writeLog.size() == 2);
    // Revert is a separate operation with its own exact-two budget.
    ShortcutReconciler reverting(&store, &journal);
    const ShortcutRevertResult reverted = reverting.revert();
    CHECK(reverted.ok);
    CHECK(reverted.writes == 2);
    CHECK(reverted.writes <= SHORTCUT_MAX_WRITES);
}

void finishApplyDriftClassified()
{
    FakeShortcutStore store;
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{1}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
    };
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
    // lock post is not the deduped derivation of its pre, but persist it directly to simulate corruption.
    corrupt.present = true;
    corrupt.stored = bad;
    FakeShortcutStore store2;
    store2.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{META_L}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
    };
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
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{META_L}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_ESC}),
    };
    FakeJournal journal;
    ShortcutJournal noop;
    noop.schema = shortcutJournalSchema();
    noop.phase = shortcutJournalPhaseComplete();
    noop.owner = QStringLiteral(":1.20");
    noop.uid = static_cast<uint>(::geteuid());
    noop.focus = {QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{META_L}, QList<int>{META_L}};
    noop.lock = {QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_ESC}, QList<int>{META_ESC}};
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
    const QString good = QStringLiteral(
        "<node><interface name=\"org.kde.KGlobalAccel\">"
        "<method name=\"setShortcutKeys\">"
        "<arg type=\"asa(ai)u\" direction=\"in\"/>"
        "<arg type=\"a(ai)\" direction=\"out\"/>"
        "</method></interface></node>");
    CHECK(ShortcutReconciler::introspectionContractValid(good));
    // Substring fallback removed: signatures visible only as text, with no
    // parsed args on the exact method, must fail.
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><!-- asa(ai)u a(ai) org.kde.KGlobalAccel setShortcutKeys -->"
                       "<interface name=\"org.kde.KGlobalAccel\"><method name=\"setShortcutKeys\"/>"
                       "</interface></node>")));
    // Missing direction on the in-arg must fail (no empty-direction allowance).
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"asa(ai)u\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "</method></interface></node>")));
    // Out-arg with the wrong direction must fail.
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"asa(ai)u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "</method></interface></node>")));
    // Exact method on the wrong interface must fail even though the
    // signature strings are present.
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.Other\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"asa(ai)u\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "</method></interface></node>")));
    // Malformed XML must fail.
    CHECK(!ShortcutReconciler::introspectionContractValid(QStringLiteral("<node><interface>")));
    // The fake store mirrors the real parser: bad XML fails the apply
    // with zero writes.
    FakeShortcutStore store;
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{1}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
    };
    store.contractXml = QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                                       "<method name=\"setShortcutKeys\"/>"
                                       "</interface></node>");
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    const ShortcutApplyResult result = reconciler.apply();
    CHECK(!result.ok);
    CHECK(store.writeLog.isEmpty());
    CHECK(!journal.present);
}

void resumeGateFailsClosedZeroWrites()
{
    // Pending journal, focus still at pre, lock drifted to neither pre nor
    // post: must fail before any write (old code wrote focus first).
    {
        FakeShortcutStore store;
        store.tuples = {
            makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{419430420}),
            makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
        };
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
        store.tuples = {
            makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{419430420}),
            makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
        };
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
        QString persistError;
        CHECK(journal.persist(partial, &persistError));
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.component == QStringLiteral("kwin")) {
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
        store.tuples = {
            makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{META_L}),
            makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
        };
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
    }
    if (scenario == QStringLiteral("all") || scenario == QStringLiteral("malformed")) {
        malformedReplyFailsClosed();
        swappedRolesRejected();
        strictOwnerAndIntrospection();
        friendlyLabelsValidated();
        allComponentsStrictTransport();
        introspectionStrictParsing();
    }
    if (scenario == QStringLiteral("all") || scenario == QStringLiteral("owner")) {
        ownerDriftFailsClosed();
        persistRejectsInvalidPhaseOwnerUid();
    }
    if (scenario == QStringLiteral("all") || scenario == QStringLiteral("recovery")) {
        partialWriteRecovery();
        finishApplyDriftClassified();
        resumeGateFailsClosedZeroWrites();
    }
    if (scenario == QStringLiteral("all") || scenario == QStringLiteral("external")) {
        externalEditsUntouchedAndJournalRetained();
        cleanRevertRemovesJournal();
        noOpRevertSkipsWrites();
    }
    if (scenario == QStringLiteral("all") || scenario == QStringLiteral("journal")) {
        kconfigJournalWriteSyncReadback();
        journalPathSafety();
        fakeJournalMirrorsRealValidation();
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
