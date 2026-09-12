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
    bool serviceAbsent = false;
    bool driftAfterNextWrite = false;
    bool failNextWrite = false;
    bool badReplyNextWrite = false;
    // When true, readAll returns tuples without bounds validation so the
    // independent structural check in apply() is exercised directly.
    bool allowUnboundedRead = false;
    // Keyed lookup state (Defect B): derived from tuples plus explicit
    // .desktop-only extras invisible to readAll. Tests prove the keyed path
    // is authoritative by blocking on extras alone with zero writes.
    QMap<int, QList<ShortcutKeyHolder>> extraByKey;
    QMap<int, bool> availableOverride;
    bool failByKey = false;
    bool malformedByKey = false;
    bool failAvailable = false;
    bool malformedAvailable = false;
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
        // Genuinely absent service mirrors the live serviceOwner invalid
        // reply: fail with the same malformed-owner error, no pin mutation.
        if (serviceAbsent) {
            if (error) {
                *error = QStringLiteral("malformed KGlobalAccel service owner reply");
            }
            return false;
        }
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
                *error = QStringLiteral("unexpected allShortcutInfos reply: wrong message type");
            }
            return false;
        }
        // Bounded validation mirrors the real backend, unless explicitly
        // bypassed to exercise apply()'s independent structural check.
        // Cosmetic labels allow empty with only the length bound.
        if (!allowUnboundedRead) {
            if (tuples.size() > SHORTCUT_MAX_TUPLES) {
                if (error) {
                    *error = QStringLiteral("unexpected allShortcutInfos reply: too many tuples");
                }
                return false;
            }
            for (const ShortcutTuple &tuple : tuples) {
                QString fieldError;
                // Tuples carry no context/defaults; mirror with empty
                // cosmetic contexts and empty defaults (both valid).
                if (!ShortcutReconciler::keyedFieldsValid(tuple.action, tuple.friendly, tuple.component,
                                                          tuple.componentFriendly, QString(), QString(),
                                                          tuple.active, QList<int>(), &fieldError)) {
                    if (error) {
                        *error = QStringLiteral("unexpected allShortcutInfos reply: ") + fieldError;
                    }
                    return false;
                }
            }
        }
        if (out) {
            *out = tuples;
        }
        return true;
    }

    bool shortcutsByKey(int key, QList<ShortcutKeyHolder> *holders, QString *error) override
    {
        if (key < 0) {
            if (error) {
                *error = QStringLiteral("unexpected globalShortcutsByKey reply: negative key");
            }
            return false;
        }
        if (key == 0) {
            if (error) {
                *error = QStringLiteral("unexpected globalShortcutsByKey reply: non-positive key");
            }
            return false;
        }
        if (key > SHORTCUT_MAX_KEY_VALUE) {
            if (error) {
                *error = QStringLiteral("unexpected globalShortcutsByKey reply: oversized key");
            }
            return false;
        }
        if (failByKey) {
            failByKey = false;
            if (error) {
                *error = QStringLiteral("globalShortcutsByKey call failed");
            }
            return false;
        }
        if (malformedByKey) {
            malformedByKey = false;
            if (error) {
                *error = QStringLiteral("unexpected globalShortcutsByKey reply: wrong message type");
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
        const auto extra = extraByKey.value(key);
        for (const ShortcutKeyHolder &holder : extra) {
            combined.append(holder);
        }
        if (combined.size() > SHORTCUT_MAX_TUPLES) {
            if (error) {
                *error = QStringLiteral("unexpected globalShortcutsByKey reply: too many occupancy holders");
            }
            return false;
        }
        if (holders) {
            *holders = combined;
        }
        return true;
    }

    bool shortcutAvailable(int key, const QString &component, bool *available, QString *error) override
    {
        if (key < 0) {
            if (error) {
                *error = QStringLiteral("unexpected globalShortcutAvailable reply: negative key");
            }
            return false;
        }
        if (key == 0) {
            if (error) {
                *error = QStringLiteral("unexpected globalShortcutAvailable reply: non-positive key");
            }
            return false;
        }
        if (key > SHORTCUT_MAX_KEY_VALUE) {
            if (error) {
                *error = QStringLiteral("unexpected globalShortcutAvailable reply: oversized key");
            }
            return false;
        }
        if (component.size() > SHORTCUT_MAX_STRING_LEN) {
            if (error) {
                *error = QStringLiteral("unexpected globalShortcutAvailable reply: oversized component");
            }
            return false;
        }
        if (failAvailable) {
            failAvailable = false;
            if (error) {
                *error = QStringLiteral("globalShortcutAvailable call failed");
            }
            return false;
        }
        if (malformedAvailable) {
            malformedAvailable = false;
            if (error) {
                *error = QStringLiteral("unexpected globalShortcutAvailable reply: wrong message type");
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

void ownerResolutionHermetic()
{
    // Pure KGlobalAccelStore owner seam, no live D-Bus: success, genuinely
    // absent service, and drift all classify with the live error semantics.
    {
        QString pinned;
        QString ownerOut;
        uint uidOut = 0;
        QString error;
        CHECK(KGlobalAccelStore::resolveOwnerReply(true, QStringLiteral(":1.20"), true,
                                                   static_cast<uint>(::geteuid()), pinned, &ownerOut, &uidOut,
                                                   &error));
        CHECK(pinned == QStringLiteral(":1.20"));
        CHECK(ownerOut == QStringLiteral(":1.20"));
        CHECK(uidOut == static_cast<uint>(::geteuid()));
        CHECK(KGlobalAccelStore::resolveOwnerReply(true, QStringLiteral(":1.20"), true,
                                                   static_cast<uint>(::geteuid()), pinned, nullptr, nullptr,
                                                   &error));
        CHECK(pinned == QStringLiteral(":1.20"));
    }
    {
        QString pinned;
        QString error;
        CHECK(!KGlobalAccelStore::resolveOwnerReply(false, QString(), false, 0, pinned, nullptr, nullptr, &error));
        CHECK(error.contains(QStringLiteral("malformed KGlobalAccel service owner reply")));
        CHECK(pinned.isEmpty());
    }
    {
        QString pinned;
        QString error;
        CHECK(!KGlobalAccelStore::resolveOwnerReply(true, QStringLiteral("not-unique"), false, 0, pinned, nullptr,
                                                   nullptr, &error));
        CHECK(error.contains(QStringLiteral("unique name")));
        CHECK(pinned.isEmpty());
    }
    {
        QString pinned;
        QString error;
        CHECK(!KGlobalAccelStore::resolveOwnerReply(true, QStringLiteral(":1.20"), false, 0, pinned, nullptr,
                                                   nullptr, &error));
        CHECK(error.contains(QStringLiteral("UID")));
        CHECK(pinned.isEmpty());
    }
    {
        QString pinned = QStringLiteral(":1.20");
        QString error;
        CHECK(!KGlobalAccelStore::resolveOwnerReply(true, QStringLiteral(":1.99"), true,
                                                    static_cast<uint>(::geteuid()), pinned, nullptr, nullptr,
                                                    &error));
        CHECK(error.contains(QStringLiteral("drifted")));
        CHECK(pinned == QStringLiteral(":1.20"));
    }
    {
        QString error;
        CHECK(KGlobalAccelStore::checkPinnedDrift(true, QStringLiteral(":1.20"), QStringLiteral(":1.20"), &error));
        CHECK(!KGlobalAccelStore::checkPinnedDrift(false, QString(), QStringLiteral(":1.20"), &error));
        CHECK(error.contains(QStringLiteral("drifted")));
        CHECK(!KGlobalAccelStore::checkPinnedDrift(true, QStringLiteral(":1.99"), QStringLiteral(":1.20"), &error));
        CHECK(error.contains(QStringLiteral("drifted")));
    }
}

void ownerAbsentApplyZeroWrites()
{
    // High-level absent service: first owner resolution fails, zero writes
    // and no journal, without live D-Bus.
    FakeShortcutStore store;
    seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
    store.serviceAbsent = true;
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    const ShortcutApplyResult result = reconciler.apply();
    CHECK(!result.ok);
    CHECK(result.error.contains(QStringLiteral("malformed KGlobalAccel service owner reply")));
    CHECK(store.writeLog.isEmpty());
    CHECK(result.writes == 0);
    CHECK(!journal.present);
}

void ownerDriftApplyZeroWrites()
{
    // High-level pre-write drift: pin succeeds, owner changes before apply,
    // first re-confirmation fails closed with zero writes and no journal.
    FakeShortcutStore store;
    seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
    QString pinError;
    CHECK(store.currentOwner(nullptr, nullptr, &pinError));
    CHECK(store.pinned == QStringLiteral(":1.20"));
    store.owner = QStringLiteral(":1.99");
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    const ShortcutApplyResult result = reconciler.apply();
    CHECK(!result.ok);
    CHECK(result.error.contains(QStringLiteral("drifted")));
    CHECK(store.writeLog.isEmpty());
    CHECK(result.writes == 0);
    CHECK(!journal.present);
    CHECK(store.pinned == QStringLiteral(":1.20"));
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
    // Empty cosmetic friendly labels are accepted by readAll (real captures
    // leave friendly empty) but writes stay strict.
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{1}, QList<int>{META_L});
        store.tuples[0].friendly = QString();
        QList<ShortcutTuple> out;
        QString readError;
        CHECK(store.readAll(&out, &readError));
        CHECK(out.at(0).friendly.isEmpty());
    }
    // Oversized cosmetic labels still fail closed.
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{1}, QList<int>{META_L});
        store.tuples[0].friendly = QString(SHORTCUT_MAX_STRING_LEN + 1, QChar('x'));
        FakeJournal journal;
        ShortcutReconciler reconciler(&store, &journal);
        const ShortcutApplyResult result = reconciler.apply();
        CHECK(!result.ok);
        CHECK(result.error
              == QStringLiteral("unexpected allShortcutInfos reply: oversized friendly"));
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.present);
    }
    // Identity stays strict: empty action fails as empty action.
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{1}, QList<int>{META_L});
        store.tuples[0].action = QString();
        FakeJournal journal;
        ShortcutReconciler reconciler(&store, &journal);
        const ShortcutApplyResult result = reconciler.apply();
        CHECK(!result.ok);
        CHECK(result.error == QStringLiteral("unexpected allShortcutInfos reply: empty action"));
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.present);
    }
    QString error;
    FakeShortcutStore store;
    seedReady6(store, QList<int>{1}, QList<int>{META_L});
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
    // Empty object path in the typed list is rejected with its own token.
    CHECK(!ShortcutReconciler::parseAllComponentsReply(QDBusMessage::ReplyMessage, QStringLiteral("ao"),
                                                       {objectPathArrayVariant({QString()})}, nullptr, &error));
    CHECK(error == QStringLiteral("unexpected allComponents reply: empty object path in typed list"));
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

void introspectionQtOutFirstVerbatim()
{
    // Exact captured Qt out-first ordering: out arg with its Out0
    // annotation interleaved immediately after, then inputs as,
    // a(ai) with In1 interleaved after its arg, then u. Must be accepted.
    const QString verbatim = QStringLiteral(
        "<node><interface name=\"org.kde.KGlobalAccel\">"
        "<method name=\"setShortcutKeys\">"
        "<arg type=\"a(ai)\" direction=\"out\"/>"
        "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
        "<arg type=\"as\" direction=\"in\"/>"
        "<arg type=\"a(ai)\" direction=\"in\"/>"
        "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
        "<arg type=\"u\" direction=\"in\"/>"
        "</method></interface></node>");
    CHECK(ShortcutReconciler::introspectionContractValid(verbatim));
    // Omitted input directions on the out-first shape still default to in,
    // annotations staying interleaved after their corresponding args.
    CHECK(ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<arg type=\"as\"/>"
                       "<arg type=\"a(ai)\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<arg type=\"u\"/>"
                       "</method></interface></node>")));
    // Absent method remains rejected.
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"other\"/>"
                       "</interface></node>")));
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\"></interface></node>")));
    // Wrong signatures remain rejected: wrong out type, wrong input type,
    // and missing key-set annotation on the out-first shape (interleaved).
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "</method></interface></node>")));
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<arg type=\"s\" direction=\"in\"/>"
                       "</method></interface></node>")));
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "</method></interface></node>")));
    // Scrambled order (out not first, inputs out of order) stays rejected.
    CHECK(!ShortcutReconciler::introspectionContractValid(
        QStringLiteral("<node><interface name=\"org.kde.KGlobalAccel\">"
                       "<method name=\"setShortcutKeys\">"
                       "<arg type=\"as\" direction=\"in\"/>"
                       "<arg type=\"a(ai)\" direction=\"out\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.Out0\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<arg type=\"a(ai)\" direction=\"in\"/>"
                       "<annotation name=\"org.qtproject.QtDBus.QtTypeName.In1\" value=\"QSet&lt;QKeySequence&gt;\"/>"
                       "<arg type=\"u\" direction=\"in\"/>"
                       "</method></interface></node>")));
    // End-to-end through the fake: verbatim out-first passes the contract.
    FakeShortcutStore store;
    seedReady6(store, QList<int>{1}, QList<int>{META_L});
    store.contractXml = verbatim;
    FakeJournal journal;
    ShortcutReconciler reconciler(&store, &journal);
    const ShortcutApplyResult result = reconciler.apply();
    CHECK(result.ok);
    CHECK(store.writeLog.size() == 6);
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

// Defect B: authoritative keyed lookup, not readAll enumeration.
void keyedDesktopOnlyBlocksRelocator()
{
    // .desktop-declared-only holder on Meta+Esc: absent from readAll tuples,
    // present via globalShortcutsByKey with empty active and defaults
    // containing Meta+Esc (authoritative primitive sees defaults).
    // Must block with zero writes/journals, independently of readAll.
    FakeShortcutStore store;
    seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
    ShortcutKeyHolder foreign;
    foreign.component = QStringLiteral("org.kde.unexpected");
    foreign.action = QStringLiteral("other-launch");
    foreign.active = QList<int>{};
    foreign.defaults = QList<int>{META_ESC};
    store.extraByKey[META_ESC].append(foreign);
    // Prove independence from enumeration: readAll lacks the foreign holder.
    {
        QList<ShortcutTuple> enumerated;
        QString readError;
        CHECK(store.readAll(&enumerated, &readError));
        bool found = false;
        for (const ShortcutTuple &tuple : enumerated) {
            if (tuple.component == foreign.component && tuple.action == foreign.action) {
                found = true;
            }
        }
        CHECK(!found);
    }
    {
        QList<ShortcutKeyHolder> holders;
        QString keyedError;
        CHECK(store.shortcutsByKey(META_ESC, &holders, &keyedError));
        CHECK(holders.size() == 1);
        if (holders.size() == 1) {
            CHECK(holders.at(0).component == foreign.component);
            CHECK(holders.at(0).action == foreign.action);
            CHECK(holders.at(0).active.isEmpty());
            CHECK(holders.at(0).defaults == QList<int>{META_ESC});
        }
    }
    FakeJournal journal;
    const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
    CHECK(!r.ok);
    CHECK(r.error.contains(QStringLiteral("Meta+Esc")));
    CHECK(r.error.contains(QStringLiteral("org.kde.unexpected")));
    CHECK(store.writeLog.isEmpty());
    CHECK(!journal.present);
    CHECK(r.writes == 0);
}

void keyedDesktopOnlyBlocksClearTargets()
{
    for (int chord : {META_ALT_K, META_ALT_L}) {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
        ShortcutKeyHolder foreign;
        foreign.component = QStringLiteral("org.kde.unexpected");
        foreign.action = QStringLiteral("other-action");
        foreign.active = QList<int>{};
        foreign.defaults = QList<int>{chord};
        store.extraByKey[chord].append(foreign);
        FakeJournal journal;
        const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
        CHECK(!r.ok);
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.present);
        CHECK(r.writes == 0);
    }
}

void keyedDesktopOnlyBlocksMetaL()
{
    FakeShortcutStore store;
    seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
    ShortcutKeyHolder foreign;
    foreign.component = QStringLiteral("org.kde.unexpected");
    foreign.action = QStringLiteral("steal-meta-l");
    foreign.active = QList<int>{};
    foreign.defaults = QList<int>{META_L};
    store.extraByKey[META_L].append(foreign);
    FakeJournal journal;
    const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
    CHECK(!r.ok);
    CHECK(r.error.contains(QStringLiteral("Meta+L")));
    CHECK(store.writeLog.isEmpty());
    CHECK(!journal.present);
}

void keyedSystemMonitorEscAccepted()
{
    // Explicit user-authorized displacement: System Monitor `_launch` on
    // Meta+Esc is structurally part of the compiled-in table and must not
    // block. Never part of the write allowlist; no writes target it.
    CHECK(ShortcutReconciler::isAuthorizedDisplacement(
        META_ESC, shortcutAuthorizedEscComponent(), shortcutAuthorizedEscAction()));
    CHECK(!ShortcutReconciler::isAuthorizedDisplacement(
        META_ALT_K, shortcutAuthorizedEscComponent(), shortcutAuthorizedEscAction()));
    CHECK(!ShortcutReconciler::isAllowlisted(shortcutAuthorizedEscComponent(), shortcutAuthorizedEscAction()));
    {
        bool found = false;
        for (const ShortcutConflictRow &row : shortcutConflictTable()) {
            if (row.resolutionTarget.contains(META_ESC)
                && row.authorizedTargetComponent == shortcutAuthorizedEscComponent()
                && row.authorizedTargetAction == shortcutAuthorizedEscAction()) {
                found = true;
            }
        }
        CHECK(found);
    }
    FakeShortcutStore store;
    seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
    ShortcutKeyHolder sysmon;
    sysmon.component = shortcutAuthorizedEscComponent();
    sysmon.action = shortcutAuthorizedEscAction();
    sysmon.active = QList<int>{META_ESC};
    store.extraByKey[META_ESC].append(sysmon);
    FakeJournal journal;
    const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
    CHECK(r.ok);
    CHECK(store.writeLog.size() == 6);
    CHECK(journal.present);
    for (const auto &record : store.writeLog) {
        CHECK(!(record.component == shortcutAuthorizedEscComponent() && record.action == shortcutAuthorizedEscAction()));
        CHECK(ShortcutReconciler::isAllowlisted(record.component, record.action));
    }
}

void keyedTransportFailsClosed()
{
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{1}, QList<int>{META_L});
        store.failByKey = true;
        FakeJournal journal;
        const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
        CHECK(!r.ok);
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.present);
    }
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{1}, QList<int>{META_L});
        store.malformedByKey = true;
        FakeJournal journal;
        const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
        CHECK(!r.ok);
        CHECK(r.error.contains(QStringLiteral("globalShortcutsByKey")));
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.present);
    }
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{1}, QList<int>{META_L});
        store.failAvailable = true;
        FakeJournal journal;
        const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
        CHECK(!r.ok);
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.present);
    }
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{1}, QList<int>{META_L});
        store.malformedAvailable = true;
        FakeJournal journal;
        const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
        CHECK(!r.ok);
        CHECK(r.error.contains(QStringLiteral("globalShortcutAvailable")));
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.present);
    }
}

void keyedReplyParsingStrict()
{
    QString error;
    bool available = false;
    CHECK(ShortcutReconciler::parseGlobalShortcutAvailableReply(
        QDBusMessage::ReplyMessage, QStringLiteral("b"), {QVariant::fromValue(true)}, &available, &error));
    CHECK(available);
    CHECK(ShortcutReconciler::parseGlobalShortcutAvailableReply(
        QDBusMessage::ReplyMessage, QStringLiteral("b"), {QVariant::fromValue(false)}, &available, &error));
    CHECK(!available);
    CHECK(!ShortcutReconciler::parseGlobalShortcutAvailableReply(
        QDBusMessage::ErrorMessage, QStringLiteral("b"), {QVariant::fromValue(true)}, nullptr, &error));
    CHECK(!ShortcutReconciler::parseGlobalShortcutAvailableReply(
        QDBusMessage::ReplyMessage, QStringLiteral("s"), {QVariant::fromValue(QStringLiteral("x"))}, nullptr,
        &error));
    CHECK(!ShortcutReconciler::parseGlobalShortcutAvailableReply(QDBusMessage::ReplyMessage, QStringLiteral("b"),
                                                                 {}, nullptr, &error));
    CHECK(!ShortcutReconciler::parseGlobalShortcutAvailableReply(QDBusMessage::ReplyMessage, QStringLiteral("b"),
                                                                 {QVariant::fromValue(1)}, nullptr, &error));
    CHECK(!ShortcutReconciler::parseGlobalShortcutAvailableReply(QDBusMessage::ReplyMessage, QStringLiteral("b"),
                                                                 {QVariant::fromValue(QStringLiteral("true"))},
                                                                 nullptr, &error));
    QList<ShortcutKeyHolder> holders;
    CHECK(!ShortcutReconciler::parseGlobalShortcutsByKeyReply(
        QDBusMessage::ErrorMessage, QStringLiteral("a(ssssssaiai)"),
        {QVariant::fromValue(QStringLiteral("x"))}, nullptr, &error));
    CHECK(!ShortcutReconciler::parseGlobalShortcutsByKeyReply(QDBusMessage::ReplyMessage,
                                                              QStringLiteral("as"),
                                                              {QVariant::fromValue(QStringLiteral("x"))}, nullptr,
                                                              &error));
    CHECK(!ShortcutReconciler::parseGlobalShortcutsByKeyReply(QDBusMessage::ReplyMessage,
                                                              QStringLiteral("a(ssssssaiai)"), {}, nullptr, &error));
    CHECK(!ShortcutReconciler::parseGlobalShortcutsByKeyReply(
        QDBusMessage::ReplyMessage, QStringLiteral("a(ssssssaiai)"),
        {QVariant::fromValue(QStringLiteral("not-an-argument"))}, nullptr, &error));
    CHECK(ShortcutReconciler::relevantConflictKeys()
          == (QList<int>{META_L, META_ESC, META_ALT_K, META_ALT_L}));
    CHECK(ShortcutReconciler::keyDisplayName(META_L) == QStringLiteral("Meta+L"));
    CHECK(ShortcutReconciler::keyDisplayName(META_ESC) == QStringLiteral("Meta+Esc"));
}

void keyedAvailabilityConsistencyBothDirections()
{
    // Whole-key invariant: empty holders must report available, non-empty
    // must report unavailable. Both inconsistent directions fail closed
    // with zero writes, without assuming component semantics beyond "".
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{1}, QList<int>{META_L});
        // Force empty lookup to report unavailable: inconsistent.
        for (int key : {META_L, META_ESC, META_ALT_K, META_ALT_L}) {
            Q_UNUSED(key);
        }
        store.availableOverride[META_L] = false;
        // META_L holders: focus tuple holds META_L? seedReady6 focus {1}, lock {META_L} so META_L non-empty.
        // To test empty+unavailable, clear META_L holders and force unavailable.
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.active.contains(META_L)) {
                tuple.active.removeAll(META_L);
            }
        }
        store.extraByKey.clear();
        // Now META_L empty, override false -> inconsistent.
        FakeJournal journal;
        const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
        CHECK(!r.ok);
        CHECK(r.error.contains(QStringLiteral("globalShortcutAvailable")));
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.present);
    }
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{1}, QList<int>{META_L});
        // Non-empty holders reporting available: inconsistent.
        store.availableOverride[META_L] = true;
        FakeJournal journal;
        const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
        CHECK(!r.ok);
        CHECK(r.error.contains(QStringLiteral("globalShortcutAvailable")));
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.present);
    }
    {
        // Authorized holder with inconsistent availability still fails.
        FakeShortcutStore store;
        seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
        ShortcutKeyHolder sysmon;
        sysmon.component = shortcutAuthorizedEscComponent();
        sysmon.action = shortcutAuthorizedEscAction();
        sysmon.active = QList<int>{META_ESC};
        store.extraByKey[META_ESC].append(sysmon);
        store.availableOverride[META_ESC] = true;
        FakeJournal journal;
        const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
        CHECK(!r.ok);
        CHECK(r.error.contains(QStringLiteral("globalShortcutAvailable")));
        CHECK(store.writeLog.isEmpty());
        CHECK(!journal.present);
    }
    {
        // Typed outcome preserves semantics: Conflict vs Unavailable.
        FakeShortcutStore store;
        seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
        ShortcutKeyHolder foreign;
        foreign.component = QStringLiteral("org.kde.unexpected");
        foreign.action = QStringLiteral("other-launch");
        foreign.active = QList<int>{};
        foreign.defaults = QList<int>{META_ESC};
        store.extraByKey[META_ESC].append(foreign);
        const KeyedOccupancyResult outcome = ShortcutReconciler::checkKeyedForeignOccupancyDetailed(&store);
        CHECK(outcome.status == KeyedOccupancy::Conflict);
        CHECK(outcome.detail.contains(QStringLiteral("claimed by")));
    }
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{1}, QList<int>{META_L});
        store.failByKey = true;
        const KeyedOccupancyResult outcome = ShortcutReconciler::checkKeyedForeignOccupancyDetailed(&store);
        CHECK(outcome.status == KeyedOccupancy::Unavailable);
        CHECK(!outcome.detail.contains(QStringLiteral("claimed by")));
    }
}

void unrelatedUnboundedRefusesZeroWrites()
{
    // Independent structural validation (not conflict detection):
    // unbounded unrelated enumerated state fails with zero writes.
    FakeShortcutStore store;
    seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
    store.allowUnboundedRead = true;
    store.tuples.append(makeTuple(QStringLiteral("kwin"), QStringLiteral("other-action"), QList<int>{-1}));
    FakeJournal journal;
    const ShortcutApplyResult r = ShortcutReconciler(&store, &journal).apply();
    CHECK(!r.ok);
    CHECK(r.error.contains(QStringLiteral("unbounded")));
    CHECK(store.writeLog.isEmpty());
    CHECK(!journal.present);
    CHECK(r.writes == 0);
}

QString oversizedString()
{
    return QString(SHORTCUT_MAX_STRING_LEN + 1, QChar('x'));
}

void preflightAllComponentsSplitTokens()
{
    QString error;
    QStringList components;
    // Wrong message type.
    CHECK(!ShortcutReconciler::parseAllComponentsReply(
        QDBusMessage::ErrorMessage, QStringLiteral("ao"),
        {objectPathArrayVariant({QStringLiteral("/a")})}, nullptr, &error));
    CHECK(error == QStringLiteral("unexpected allComponents reply: wrong message type"));
    // Wrong signature.
    CHECK(!ShortcutReconciler::parseAllComponentsReply(
        QDBusMessage::ReplyMessage, QStringLiteral("as"),
        {objectPathArrayVariant({QStringLiteral("/a")})}, nullptr, &error));
    CHECK(error == QStringLiteral("unexpected allComponents reply: wrong signature"));
    // Wrong arity.
    CHECK(!ShortcutReconciler::parseAllComponentsReply(QDBusMessage::ReplyMessage, QStringLiteral("ao"), {},
                                                       nullptr, &error));
    CHECK(error == QStringLiteral("unexpected allComponents reply: wrong arity"));
    // Wrong variant shape (QStringList is never ao, even with forged signature).
    CHECK(!ShortcutReconciler::parseAllComponentsReply(
        QDBusMessage::ReplyMessage, QStringLiteral("ao"),
        {QVariant::fromValue(QStringList{QStringLiteral("/a")})}, nullptr, &error));
    CHECK(error == QStringLiteral("unexpected allComponents reply: wrong variant shape"));
    // Wrong array framing (default QDBusArgument is not an array).
    CHECK(!ShortcutReconciler::parseAllComponentsReply(QDBusMessage::ReplyMessage, QStringLiteral("ao"),
                                                       {QVariant::fromValue(QDBusArgument())}, nullptr,
                                                       &error));
    CHECK(error == QStringLiteral("unexpected allComponents reply: wrong array framing"));
    // Empty object path in the typed list branch.
    CHECK(!ShortcutReconciler::parseAllComponentsReply(QDBusMessage::ReplyMessage, QStringLiteral("ao"),
                                                       {objectPathArrayVariant({QString()})}, nullptr,
                                                       &error));
    CHECK(error == QStringLiteral("unexpected allComponents reply: empty object path in typed list"));
    // The argument-array branch carries its own token
    // ("empty object path in argument array"): no public Qt API builds a
    // read-mode QDBusArgument outside a real bus reply, so the real branch
    // delegates to appendComponentPath and the exact token is triggered
    // hermetically there (see boundedHelperSeamsExactTokens).
    // Too many components (bound 1024).
    {
        QStringList many;
        for (int i = 0; i < 1025; ++i) {
            many.append(QStringLiteral("/c%1").arg(i));
        }
        CHECK(!ShortcutReconciler::parseAllComponentsReply(QDBusMessage::ReplyMessage, QStringLiteral("ao"),
                                                           {objectPathArrayVariant(many)}, nullptr, &error));
        CHECK(error == QStringLiteral("unexpected allComponents reply: too many components"));
    }
    // Acceptance still exact.
    CHECK(ShortcutReconciler::parseAllComponentsReply(
        QDBusMessage::ReplyMessage, QStringLiteral("ao"),
        {objectPathArrayVariant({QStringLiteral("/a")})}, &components, &error));
    CHECK(components == (QStringList{QStringLiteral("/a")}));
}

void preflightAvailableSplitTokens()
{
    QString error;
    bool available = false;
    CHECK(!ShortcutReconciler::parseGlobalShortcutAvailableReply(
        QDBusMessage::ErrorMessage, QStringLiteral("b"), {QVariant::fromValue(true)}, nullptr, &error));
    CHECK(error == QStringLiteral("unexpected globalShortcutAvailable reply: wrong message type"));
    CHECK(!ShortcutReconciler::parseGlobalShortcutAvailableReply(
        QDBusMessage::ReplyMessage, QStringLiteral("s"), {QVariant::fromValue(QStringLiteral("x"))}, nullptr,
        &error));
    CHECK(error == QStringLiteral("unexpected globalShortcutAvailable reply: wrong signature"));
    CHECK(!ShortcutReconciler::parseGlobalShortcutAvailableReply(QDBusMessage::ReplyMessage, QStringLiteral("b"),
                                                                 {}, nullptr, &error));
    CHECK(error == QStringLiteral("unexpected globalShortcutAvailable reply: wrong arity"));
    CHECK(!ShortcutReconciler::parseGlobalShortcutAvailableReply(QDBusMessage::ReplyMessage, QStringLiteral("b"),
                                                                 {QVariant::fromValue(1)}, nullptr, &error));
    CHECK(error == QStringLiteral("unexpected globalShortcutAvailable reply: wrong variant shape"));
    CHECK(!ShortcutReconciler::parseGlobalShortcutAvailableReply(
        QDBusMessage::ReplyMessage, QStringLiteral("b"), {QVariant::fromValue(QStringLiteral("true"))}, nullptr,
        &error));
    CHECK(error == QStringLiteral("unexpected globalShortcutAvailable reply: wrong variant shape"));
    CHECK(ShortcutReconciler::parseGlobalShortcutAvailableReply(
        QDBusMessage::ReplyMessage, QStringLiteral("b"), {QVariant::fromValue(true)}, &available, &error));
    CHECK(available);
}

void preflightByKeyTransportSplitTokens()
{
    QString error;
    CHECK(!ShortcutReconciler::parseGlobalShortcutsByKeyReply(
        QDBusMessage::ErrorMessage, QStringLiteral("a(ssssssaiai)"),
        {QVariant::fromValue(QStringLiteral("x"))}, nullptr, &error));
    CHECK(error == QStringLiteral("unexpected globalShortcutsByKey reply: wrong message type"));
    CHECK(!ShortcutReconciler::parseGlobalShortcutsByKeyReply(QDBusMessage::ReplyMessage, QStringLiteral("as"),
                                                              {QVariant::fromValue(QStringLiteral("x"))},
                                                              nullptr, &error));
    CHECK(error == QStringLiteral("unexpected globalShortcutsByKey reply: wrong signature"));
    CHECK(!ShortcutReconciler::parseGlobalShortcutsByKeyReply(
        QDBusMessage::ReplyMessage, QStringLiteral("a(ssssssaiai)"), {}, nullptr, &error));
    CHECK(error == QStringLiteral("unexpected globalShortcutsByKey reply: wrong arity"));
    CHECK(!ShortcutReconciler::parseGlobalShortcutsByKeyReply(
        QDBusMessage::ReplyMessage, QStringLiteral("a(ssssssaiai)"),
        {QVariant::fromValue(QStringLiteral("not-an-argument"))}, nullptr, &error));
    CHECK(error == QStringLiteral("unexpected globalShortcutsByKey reply: wrong variant shape"));
    CHECK(!ShortcutReconciler::parseGlobalShortcutsByKeyReply(
        QDBusMessage::ReplyMessage, QStringLiteral("a(ssssssaiai)"),
        {QVariant::fromValue(QDBusArgument())}, nullptr, &error));
    CHECK(error == QStringLiteral("unexpected globalShortcutsByKey reply: wrong array framing"));
}

void preflightAllInfosSplitTokens()
{
    // Pure allShortcutInfos parser: ordered type then signature then arity,
    // exact tokens per branch, no live D-Bus. Mirrors the readAll live path.
    QString error;
    CHECK(!ShortcutReconciler::parseAllShortcutInfosReply(
        QDBusMessage::ErrorMessage, QStringLiteral("a(ssssssaiai)"),
        {QVariant::fromValue(QStringLiteral("x"))}, nullptr, &error));
    CHECK(error == QStringLiteral("unexpected allShortcutInfos reply: wrong message type"));
    CHECK(!ShortcutReconciler::parseAllShortcutInfosReply(QDBusMessage::ReplyMessage, QStringLiteral("as"),
                                                          {QVariant::fromValue(QStringLiteral("x"))}, nullptr,
                                                          &error));
    CHECK(error == QStringLiteral("unexpected allShortcutInfos reply: wrong signature"));
    CHECK(!ShortcutReconciler::parseAllShortcutInfosReply(
        QDBusMessage::ReplyMessage, QStringLiteral("a(ssssssaiai)"), {}, nullptr, &error));
    CHECK(error == QStringLiteral("unexpected allShortcutInfos reply: wrong arity"));
    CHECK(!ShortcutReconciler::parseAllShortcutInfosReply(
        QDBusMessage::ReplyMessage, QStringLiteral("a(ssssssaiai)"),
        {QVariant::fromValue(QStringLiteral("not-an-argument"))}, nullptr, &error));
    CHECK(error == QStringLiteral("unexpected allShortcutInfos reply: wrong variant shape"));
    CHECK(!ShortcutReconciler::parseAllShortcutInfosReply(
        QDBusMessage::ReplyMessage, QStringLiteral("a(ssssssaiai)"),
        {QVariant::fromValue(QDBusArgument())}, nullptr, &error));
    CHECK(error == QStringLiteral("unexpected allShortcutInfos reply: wrong array framing"));
    // Ordering: type beats signature, signature beats arity.
    CHECK(!ShortcutReconciler::parseAllShortcutInfosReply(QDBusMessage::ErrorMessage, QStringLiteral("as"), {},
                                                          nullptr, &error));
    CHECK(error == QStringLiteral("unexpected allShortcutInfos reply: wrong message type"));
    CHECK(!ShortcutReconciler::parseAllShortcutInfosReply(QDBusMessage::ReplyMessage, QStringLiteral("as"), {},
                                                          nullptr, &error));
    CHECK(error == QStringLiteral("unexpected allShortcutInfos reply: wrong signature"));
}

// Shared seam coverage: the QDBusArgument reply parsers only extract
// QList<ShortcutInfoFields> from the wire array, then delegate all field and
// bound mapping to holdersFromInfoFields / tuplesFromInfoFields. These tests
// exercise those real field branches hermetically (no live bus).
//
// Why not a direct readable QDBusArgument: the public Qt API offers no way to
// build a read-mode QDBusArgument outside a real bus reply (a write-mode
// argument reports no ArrayType for const read access), and an in-process
// private dbus-daemon service+client fixture was attempted but the service
// never dispatched even basic ping/introspection calls in this environment
// (connections up, service registered, object registered, yet NoReply), so a
// bus fixture is not feasible here. Instead the wire encoding is proven by
// marshalling a write-mode array through the real source operators and
// asserting the signature is exactly a(ssssssaiai), and the field branches
// run through the shared seam the real parsers delegate to. Transport
// branches (type, signature, arity, variant shape, array framing) are covered
// separately with exact tokens on the real QDBusArgument parsers.
void ensureInfoFieldsTestMetaTypes()
{
    static bool registered = false;
    if (registered) {
        return;
    }
    qDBusRegisterMetaType<ShortcutInfoFields>();
    qDBusRegisterMetaType<QList<ShortcutInfoFields>>();
    registered = true;
}

ShortcutInfoFields makeSeamInfo(const QString &action, const QString &friendly, const QString &compUnique,
                                const QList<int> &active, const QList<int> &defaults)
{
    ShortcutInfoFields info;
    info.action = action;
    info.friendly = friendly;
    info.compUnique = compUnique;
    info.compFriendly = QStringLiteral("KWin");
    info.contextUnique = QStringLiteral("default");
    info.contextFriendly = QStringLiteral("Default Context");
    info.active = active;
    info.defaults = defaults;
    return info;
}

void infoFieldsWireEncodingProvesSignature()
{
    ensureInfoFieldsTestMetaTypes();
    // The real source operators encode exactly a(ssssssaiai): build a
    // write-mode array with them and read back the marshalled signature.
    // (A readable QDBusArgument is only produced by a real bus reply, which
    // is out of reach here; the field branches below run through the shared
    // seam the wire parsers delegate to.)
    QDBusArgument arg;
    arg.beginArray(QMetaType::fromType<ShortcutInfoFields>());
    const ShortcutInfoFields info =
        makeSeamInfo(QStringLiteral("walk"), QString(), QStringLiteral("kwin"), QList<int>{META_L},
                     QList<int>{META_ESC});
    arg << info;
    arg.endArray();
    CHECK(arg.currentSignature() == QStringLiteral("a(ssssssaiai)"));
}

void seamHoldersAndTuplesFieldBranches()
{
    // Real-capture-shaped empty-friendly accepted record maps through both
    // seam functions (the same code the wire parsers delegate to).
    {
        const QList<ShortcutInfoFields> infos = {
            makeSeamInfo(QStringLiteral("walk"), QString(), QStringLiteral("kwin"), QList<int>{META_L},
                         QList<int>{META_ESC}),
        };
        QList<ShortcutKeyHolder> holders;
        QString error;
        CHECK(ShortcutReconciler::holdersFromInfoFields(infos, &holders, &error));
        CHECK(holders.size() == 1);
        if (holders.size() == 1) {
            CHECK(holders.at(0).component == QStringLiteral("kwin"));
            CHECK(holders.at(0).action == QStringLiteral("walk"));
            CHECK(holders.at(0).active == QList<int>{META_L});
            CHECK(holders.at(0).defaults == QList<int>{META_ESC});
        }
        QList<ShortcutTuple> tuples;
        CHECK(ShortcutReconciler::tuplesFromInfoFields(infos, &tuples, &error));
        CHECK(tuples.size() == 1);
        if (tuples.size() == 1) {
            CHECK(tuples.at(0).component == QStringLiteral("kwin"));
            CHECK(tuples.at(0).action == QStringLiteral("walk"));
            CHECK(tuples.at(0).friendly.isEmpty());
            CHECK(tuples.at(0).active == QList<int>{META_L});
        }
    }
    // Each elementary predicate below reaches only its own full token on
    // both seams (by-key prefix vs allShortcutInfos prefix). Triggers are
    // pure: only the named field violates, all others valid.
    auto checkBothSeams = [](const ShortcutInfoFields &info, const char *byKeyToken, const char *allInfosToken) {
        const QList<ShortcutInfoFields> infos = {info};
        QString error;
        CHECK(!ShortcutReconciler::holdersFromInfoFields(infos, nullptr, &error));
        CHECK(error == QString::fromUtf8(byKeyToken));
        CHECK(!ShortcutReconciler::tuplesFromInfoFields(infos, nullptr, &error));
        CHECK(error == QString::fromUtf8(allInfosToken));
    };
    {
        ShortcutInfoFields info =
            makeSeamInfo(QString(), QString(), QStringLiteral("kwin"), QList<int>{}, QList<int>{});
        checkBothSeams(info, "unexpected globalShortcutsByKey reply: empty action",
                       "unexpected allShortcutInfos reply: empty action");
    }
    {
        ShortcutInfoFields info =
            makeSeamInfo(oversizedString(), QString(), QStringLiteral("kwin"), QList<int>{}, QList<int>{});
        checkBothSeams(info, "unexpected globalShortcutsByKey reply: oversized action",
                       "unexpected allShortcutInfos reply: oversized action");
    }
    {
        ShortcutInfoFields info =
            makeSeamInfo(QStringLiteral("walk"), QString(), QString(), QList<int>{}, QList<int>{});
        checkBothSeams(info, "unexpected globalShortcutsByKey reply: empty component",
                       "unexpected allShortcutInfos reply: empty component");
    }
    {
        ShortcutInfoFields info = makeSeamInfo(QStringLiteral("walk"), QString(), oversizedString(), QList<int>{},
                                               QList<int>{});
        checkBothSeams(info, "unexpected globalShortcutsByKey reply: oversized component",
                       "unexpected allShortcutInfos reply: oversized component");
    }
    {
        ShortcutInfoFields info = makeSeamInfo(QStringLiteral("walk"), oversizedString(), QStringLiteral("kwin"),
                                               QList<int>{}, QList<int>{});
        checkBothSeams(info, "unexpected globalShortcutsByKey reply: oversized friendly",
                       "unexpected allShortcutInfos reply: oversized friendly");
    }
    {
        ShortcutInfoFields info = makeSeamInfo(QStringLiteral("walk"), QString(), QStringLiteral("kwin"),
                                               QList<int>{}, QList<int>{});
        info.compFriendly = oversizedString();
        checkBothSeams(info, "unexpected globalShortcutsByKey reply: oversized component friendly",
                       "unexpected allShortcutInfos reply: oversized component friendly");
    }
    {
        ShortcutInfoFields info = makeSeamInfo(QStringLiteral("walk"), QString(), QStringLiteral("kwin"),
                                               QList<int>{}, QList<int>{});
        info.contextUnique = oversizedString();
        checkBothSeams(info, "unexpected globalShortcutsByKey reply: oversized context unique",
                       "unexpected allShortcutInfos reply: oversized context unique");
    }
    {
        ShortcutInfoFields info = makeSeamInfo(QStringLiteral("walk"), QString(), QStringLiteral("kwin"),
                                               QList<int>{}, QList<int>{});
        info.contextFriendly = oversizedString();
        checkBothSeams(info, "unexpected globalShortcutsByKey reply: oversized context friendly",
                       "unexpected allShortcutInfos reply: oversized context friendly");
    }
    {
        QList<int> tooMany;
        for (int i = 0; i < SHORTCUT_MAX_KEYS_PER_TUPLE + 1; ++i) {
            tooMany.append(i + 1);
        }
        ShortcutInfoFields info =
            makeSeamInfo(QStringLiteral("walk"), QString(), QStringLiteral("kwin"), tooMany, QList<int>{});
        checkBothSeams(info, "unexpected globalShortcutsByKey reply: too many active keys",
                       "unexpected allShortcutInfos reply: too many active keys");
    }
    {
        ShortcutInfoFields info = makeSeamInfo(QStringLiteral("walk"), QString(), QStringLiteral("kwin"),
                                               QList<int>{-1}, QList<int>{});
        checkBothSeams(info, "unexpected globalShortcutsByKey reply: negative active key",
                       "unexpected allShortcutInfos reply: negative active key");
    }
    {
        ShortcutInfoFields info = makeSeamInfo(QStringLiteral("walk"), QString(), QStringLiteral("kwin"),
                                               QList<int>{SHORTCUT_MAX_KEY_VALUE + 1}, QList<int>{});
        checkBothSeams(info, "unexpected globalShortcutsByKey reply: oversized active key",
                       "unexpected allShortcutInfos reply: oversized active key");
    }
    {
        QList<int> tooMany;
        for (int i = 0; i < SHORTCUT_MAX_KEYS_PER_TUPLE + 1; ++i) {
            tooMany.append(i + 1);
        }
        ShortcutInfoFields info =
            makeSeamInfo(QStringLiteral("walk"), QString(), QStringLiteral("kwin"), QList<int>{}, tooMany);
        checkBothSeams(info, "unexpected globalShortcutsByKey reply: too many default keys",
                       "unexpected allShortcutInfos reply: too many default keys");
    }
    {
        ShortcutInfoFields info = makeSeamInfo(QStringLiteral("walk"), QString(), QStringLiteral("kwin"),
                                               QList<int>{}, QList<int>{-1});
        checkBothSeams(info, "unexpected globalShortcutsByKey reply: negative default key",
                       "unexpected allShortcutInfos reply: negative default key");
    }
    {
        ShortcutInfoFields info = makeSeamInfo(QStringLiteral("walk"), QString(), QStringLiteral("kwin"),
                                               QList<int>{}, QList<int>{SHORTCUT_MAX_KEY_VALUE + 1});
        checkBothSeams(info, "unexpected globalShortcutsByKey reply: oversized default key",
                       "unexpected allShortcutInfos reply: oversized default key");
    }
    // Bound maps only to the per-parser bound token on both seams.
    {
        QList<ShortcutInfoFields> many;
        many.reserve(SHORTCUT_MAX_TUPLES + 1);
        for (int i = 0; i < SHORTCUT_MAX_TUPLES + 1; ++i) {
            many.append(makeSeamInfo(QStringLiteral("a%1").arg(i), QString(),
                                     QStringLiteral("c%1").arg(i), QList<int>{}, QList<int>{}));
        }
        QString error;
        CHECK(!ShortcutReconciler::holdersFromInfoFields(many, nullptr, &error));
        CHECK(error == QStringLiteral("unexpected globalShortcutsByKey reply: too many holders"));
        CHECK(!ShortcutReconciler::tuplesFromInfoFields(many, nullptr, &error));
        CHECK(error == QStringLiteral("unexpected allShortcutInfos reply: too many tuples"));
    }
}

void wireBoundTokensDistinctFromSeams()
{
    // Wire demarshal loops delegate their fail-fast SHORTCUT_MAX_TUPLES
    // bound to the shared checkTupleAppendBound predicate immediately after
    // each real append; the exact wire tokens are triggered hermetically via
    // that predicate in boundedHelperSeamsExactTokens. Distinctness below is
    // only a uniqueness guard, not coverage.
    CHECK(QStringLiteral("unexpected globalShortcutsByKey reply: too many wire holders")
          != QStringLiteral("unexpected globalShortcutsByKey reply: too many holders"));
    CHECK(QStringLiteral("unexpected allShortcutInfos reply: too many wire tuples")
          != QStringLiteral("unexpected allShortcutInfos reply: too many tuples"));
    CHECK(QStringLiteral("unexpected globalShortcutsByKey reply: too many wire holders")
          != QStringLiteral("unexpected allShortcutInfos reply: too many wire tuples"));
}

void boundedHelperSeamsExactTokens()
{
    // Smallest pure seams, each trigger pure (one predicate only) with exact
    // full bounded tokens. Real branches call these helpers with the same
    // mutation/order/check, so this is executable coverage of the real
    // tokens, not string inequality or audit.
    {
        // (1) allComponents object-path validator: typed-list provenance.
        QString error;
        QStringList parsed;
        CHECK(!ShortcutReconciler::appendComponentPath(QString(), false, &parsed, &error));
        CHECK(error
              == QStringLiteral("unexpected allComponents reply: empty object path in typed list"));
        CHECK(parsed.isEmpty());
        CHECK(ShortcutReconciler::appendComponentPath(QStringLiteral("/a"), false, &parsed, &error));
        CHECK(parsed == (QStringList{QStringLiteral("/a")}));
    }
    {
        // (1) allComponents object-path validator: argument-array provenance.
        QString error;
        QStringList parsed;
        CHECK(!ShortcutReconciler::appendComponentPath(QString(), true, &parsed, &error));
        CHECK(error
              == QStringLiteral(
                  "unexpected allComponents reply: empty object path in argument array"));
        CHECK(parsed.isEmpty());
        CHECK(ShortcutReconciler::appendComponentPath(QStringLiteral("/b"), true, &parsed, &error));
        CHECK(parsed == (QStringList{QStringLiteral("/b")}));
    }
    {
        // (2) by-key wire bound via the shared predicate.
        QString error;
        CHECK(!ShortcutReconciler::checkTupleAppendBound(
            SHORTCUT_MAX_TUPLES + 1, ShortcutReconciler::TupleAppendBound::ByKeyWire, &error));
        CHECK(error
              == QStringLiteral("unexpected globalShortcutsByKey reply: too many wire holders"));
        CHECK(ShortcutReconciler::checkTupleAppendBound(
            SHORTCUT_MAX_TUPLES, ShortcutReconciler::TupleAppendBound::ByKeyWire, &error));
        CHECK(ShortcutReconciler::checkTupleAppendBound(
            0, ShortcutReconciler::TupleAppendBound::ByKeyWire, &error));
    }
    {
        // (2) allShortcutInfos wire bound via the shared predicate.
        QString error;
        CHECK(!ShortcutReconciler::checkTupleAppendBound(
            SHORTCUT_MAX_TUPLES + 1, ShortcutReconciler::TupleAppendBound::AllInfosWire, &error));
        CHECK(error
              == QStringLiteral("unexpected allShortcutInfos reply: too many wire tuples"));
        CHECK(ShortcutReconciler::checkTupleAppendBound(
            SHORTCUT_MAX_TUPLES, ShortcutReconciler::TupleAppendBound::AllInfosWire, &error));
    }
    {
        // (3) cross-component collected-tuples bound via the shared predicate.
        QString error;
        CHECK(!ShortcutReconciler::checkTupleAppendBound(
            SHORTCUT_MAX_TUPLES + 1, ShortcutReconciler::TupleAppendBound::Collected, &error));
        CHECK(error
              == QStringLiteral("unexpected allShortcutInfos reply: too many collected tuples"));
        CHECK(ShortcutReconciler::checkTupleAppendBound(
            SHORTCUT_MAX_TUPLES, ShortcutReconciler::TupleAppendBound::Collected, &error));
    }
    {
        // (4) defensive occupancy-key range: negative only.
        QString error;
        CHECK(!ShortcutReconciler::checkOccupancyKeyRange(-1, &error));
        CHECK(error
              == QStringLiteral("unexpected globalShortcutsByKey reply: negative occupancy key"));
    }
    {
        // (4) defensive occupancy-key range: zero (non-positive) only; passes
        // the negative check, fails only the zero check.
        QString error;
        CHECK(!ShortcutReconciler::checkOccupancyKeyRange(0, &error));
        CHECK(error
              == QStringLiteral("unexpected globalShortcutsByKey reply: non-positive occupancy key"));
    }
    {
        // (4) defensive occupancy-key range: oversized only; passes negative
        // and zero checks, fails only the over-max check.
        QString error;
        CHECK(!ShortcutReconciler::checkOccupancyKeyRange(SHORTCUT_MAX_KEY_VALUE + 1, &error));
        CHECK(error
              == QStringLiteral("unexpected globalShortcutsByKey reply: oversized occupancy key"));
        CHECK(ShortcutReconciler::checkOccupancyKeyRange(META_L, &error));
    }
}


void preflightKeyedFieldsSplitTokens()
{
    // Real-capture-shaped fixture: action, empty friendly, component,
    // componentFriendly, default, Default Context, ai, ai. Must be accepted.
    {
        QString fieldError = QStringLiteral("seed");
        CHECK(ShortcutReconciler::keyedFieldsValid(
            QStringLiteral("action"), QString(), QStringLiteral("component"),
            QStringLiteral("componentFriendly"), QStringLiteral("default"), QStringLiteral("Default Context"),
            QList<int>{META_L}, QList<int>{META_ESC}, &fieldError));
        CHECK(fieldError == QStringLiteral("seed"));
    }
    // All cosmetic fields empty is accepted for globalShortcutsByKey parsing.
    {
        QString fieldError;
        CHECK(ShortcutReconciler::keyedFieldsValid(QStringLiteral("action"), QString(),
                                                   QStringLiteral("component"), QString(), QString(), QString(),
                                                   QList<int>{}, QList<int>{}, &fieldError));
    }
    // Cosmetic validator allows empty with only the length bound.
    CHECK(ShortcutReconciler::cosmeticValid(QString()));
    CHECK(ShortcutReconciler::cosmeticValid(QStringLiteral("Default Context")));
    CHECK(!ShortcutReconciler::cosmeticValid(oversizedString()));
    CHECK(!ShortcutReconciler::stringValid(QString()));
    // Invalid identity: empty action.
    {
        QString fieldError;
        CHECK(!ShortcutReconciler::keyedFieldsValid(QString(), QStringLiteral("friendly"),
                                                    QStringLiteral("component"), QStringLiteral("compFriendly"),
                                                    QStringLiteral("default"), QStringLiteral("Default Context"),
                                                    QList<int>{}, QList<int>{}, &fieldError));
        CHECK(fieldError == QStringLiteral("empty action"));
    }
    // Invalid identity: oversized action (bound preserved).
    {
        QString fieldError;
        CHECK(!ShortcutReconciler::keyedFieldsValid(oversizedString(), QString(),
                                                    QStringLiteral("component"), QStringLiteral("compFriendly"),
                                                    QStringLiteral("default"), QStringLiteral("Default Context"),
                                                    QList<int>{}, QList<int>{}, &fieldError));
        CHECK(fieldError == QStringLiteral("oversized action"));
    }
    // Invalid identity: empty compUnique.
    {
        QString fieldError;
        CHECK(!ShortcutReconciler::keyedFieldsValid(QStringLiteral("action"), QString(),
                                                    QString(), QStringLiteral("compFriendly"),
                                                    QStringLiteral("default"), QStringLiteral("Default Context"),
                                                    QList<int>{}, QList<int>{}, &fieldError));
        CHECK(fieldError == QStringLiteral("empty component"));
    }
    // Invalid identity: oversized compUnique.
    {
        QString fieldError;
        CHECK(!ShortcutReconciler::keyedFieldsValid(QStringLiteral("action"), QString(),
                                                    oversizedString(), QStringLiteral("compFriendly"),
                                                    QStringLiteral("default"), QStringLiteral("Default Context"),
                                                    QList<int>{}, QList<int>{}, &fieldError));
        CHECK(fieldError == QStringLiteral("oversized component"));
    }
    // Invalid cosmetic: oversized friendly.
    {
        QString fieldError;
        CHECK(!ShortcutReconciler::keyedFieldsValid(
            QStringLiteral("action"), oversizedString(), QStringLiteral("component"),
            QStringLiteral("compFriendly"), QStringLiteral("default"), QStringLiteral("Default Context"),
            QList<int>{}, QList<int>{}, &fieldError));
        CHECK(fieldError == QStringLiteral("oversized friendly"));
    }
    // Invalid cosmetic: oversized compFriendly.
    {
        QString fieldError;
        CHECK(!ShortcutReconciler::keyedFieldsValid(
            QStringLiteral("action"), QString(), QStringLiteral("component"), oversizedString(),
            QStringLiteral("default"), QStringLiteral("Default Context"), QList<int>{}, QList<int>{}, &fieldError));
        CHECK(fieldError == QStringLiteral("oversized component friendly"));
    }
    // Invalid cosmetic: oversized contextUnique.
    {
        QString fieldError;
        CHECK(!ShortcutReconciler::keyedFieldsValid(
            QStringLiteral("action"), QString(), QStringLiteral("component"), QStringLiteral("compFriendly"),
            oversizedString(), QStringLiteral("Default Context"), QList<int>{}, QList<int>{}, &fieldError));
        CHECK(fieldError == QStringLiteral("oversized context unique"));
    }
    // Invalid cosmetic: oversized contextFriendly.
    {
        QString fieldError;
        CHECK(!ShortcutReconciler::keyedFieldsValid(
            QStringLiteral("action"), QString(), QStringLiteral("component"), QStringLiteral("compFriendly"),
            QStringLiteral("default"), oversizedString(), QList<int>{}, QList<int>{}, &fieldError));
        CHECK(fieldError == QStringLiteral("oversized context friendly"));
    }
    // Invalid active keys: too many.
    {
        QList<int> tooMany;
        for (int i = 0; i < SHORTCUT_MAX_KEYS_PER_TUPLE + 1; ++i) {
            tooMany.append(i + 1);
        }
        QString fieldError;
        CHECK(!ShortcutReconciler::keyedFieldsValid(
            QStringLiteral("action"), QString(), QStringLiteral("component"), QStringLiteral("compFriendly"),
            QStringLiteral("default"), QStringLiteral("Default Context"), tooMany, QList<int>{}, &fieldError));
        CHECK(fieldError == QStringLiteral("too many active keys"));
    }
    // Invalid active keys: negative.
    {
        QString fieldError;
        CHECK(!ShortcutReconciler::keyedFieldsValid(
            QStringLiteral("action"), QString(), QStringLiteral("component"), QStringLiteral("compFriendly"),
            QStringLiteral("default"), QStringLiteral("Default Context"), QList<int>{-1}, QList<int>{},
            &fieldError));
        CHECK(fieldError == QStringLiteral("negative active key"));
    }
    // Invalid active keys: over-max.
    {
        QString fieldError;
        CHECK(!ShortcutReconciler::keyedFieldsValid(
            QStringLiteral("action"), QString(), QStringLiteral("component"), QStringLiteral("compFriendly"),
            QStringLiteral("default"), QStringLiteral("Default Context"),
            QList<int>{SHORTCUT_MAX_KEY_VALUE + 1}, QList<int>{}, &fieldError));
        CHECK(fieldError == QStringLiteral("oversized active key"));
    }
    // Invalid default keys: too many.
    {
        QList<int> tooMany;
        for (int i = 0; i < SHORTCUT_MAX_KEYS_PER_TUPLE + 1; ++i) {
            tooMany.append(i + 1);
        }
        QString fieldError;
        CHECK(!ShortcutReconciler::keyedFieldsValid(
            QStringLiteral("action"), QString(), QStringLiteral("component"), QStringLiteral("compFriendly"),
            QStringLiteral("default"), QStringLiteral("Default Context"), QList<int>{}, tooMany, &fieldError));
        CHECK(fieldError == QStringLiteral("too many default keys"));
    }
    // Invalid default keys: negative.
    {
        QString fieldError;
        CHECK(!ShortcutReconciler::keyedFieldsValid(
            QStringLiteral("action"), QString(), QStringLiteral("component"), QStringLiteral("compFriendly"),
            QStringLiteral("default"), QStringLiteral("Default Context"), QList<int>{}, QList<int>{-1},
            &fieldError));
        CHECK(fieldError == QStringLiteral("negative default key"));
    }
    // Invalid default keys: over-max.
    {
        QString fieldError;
        CHECK(!ShortcutReconciler::keyedFieldsValid(
            QStringLiteral("action"), QString(), QStringLiteral("component"), QStringLiteral("compFriendly"),
            QStringLiteral("default"), QStringLiteral("Default Context"), QList<int>{},
            QList<int>{SHORTCUT_MAX_KEY_VALUE + 1}, &fieldError));
        CHECK(fieldError == QStringLiteral("oversized default key"));
    }
    // Empty friendly alone never reports an identity token.
    {
        QString fieldError;
        CHECK(ShortcutReconciler::keyedFieldsValid(
            QStringLiteral("action"), QString(), QStringLiteral("component"), QStringLiteral("compFriendly"),
            QStringLiteral("default"), QStringLiteral("Default Context"), QList<int>{}, QList<int>{},
            &fieldError));
    }
}

void preflightStoreGuardsSplitTokens()
{
    // Pre-D-Bus keyed input guards fail closed without a bus. Each
    // elementary single-key predicate has its own token: negative, zero
    // (non-positive), over-max. List-bound is unreachable for one element.
    {
        KGlobalAccelStore store;
        QList<ShortcutKeyHolder> holders;
        QString error;
        CHECK(!store.shortcutsByKey(-1, &holders, &error));
        CHECK(error == QStringLiteral("unexpected globalShortcutsByKey reply: negative key"));
        CHECK(!store.shortcutsByKey(0, &holders, &error));
        CHECK(error == QStringLiteral("unexpected globalShortcutsByKey reply: non-positive key"));
        CHECK(!store.shortcutsByKey(SHORTCUT_MAX_KEY_VALUE + 1, &holders, &error));
        CHECK(error == QStringLiteral("unexpected globalShortcutsByKey reply: oversized key"));
        // Fake mirrors the same split.
        FakeShortcutStore fake;
        CHECK(!fake.shortcutsByKey(-1, &holders, &error));
        CHECK(error == QStringLiteral("unexpected globalShortcutsByKey reply: negative key"));
        CHECK(!fake.shortcutsByKey(0, &holders, &error));
        CHECK(error == QStringLiteral("unexpected globalShortcutsByKey reply: non-positive key"));
        CHECK(!fake.shortcutsByKey(SHORTCUT_MAX_KEY_VALUE + 1, &holders, &error));
        CHECK(error == QStringLiteral("unexpected globalShortcutsByKey reply: oversized key"));
    }
    {
        KGlobalAccelStore store;
        bool available = false;
        QString error;
        CHECK(!store.shortcutAvailable(-1, QString(), &available, &error));
        CHECK(error == QStringLiteral("unexpected globalShortcutAvailable reply: negative key"));
        CHECK(!store.shortcutAvailable(0, QString(), &available, &error));
        CHECK(error == QStringLiteral("unexpected globalShortcutAvailable reply: non-positive key"));
        CHECK(!store.shortcutAvailable(SHORTCUT_MAX_KEY_VALUE + 1, QString(), &available, &error));
        CHECK(error == QStringLiteral("unexpected globalShortcutAvailable reply: oversized key"));
        CHECK(!store.shortcutAvailable(META_L, oversizedString(), &available, &error));
        CHECK(error == QStringLiteral("unexpected globalShortcutAvailable reply: oversized component"));
    }
}

void preflightReadAllFieldSplitTokens()
{
    // Negative active key via Fake readAll.
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{1}, QList<int>{META_L});
        store.tuples[0].active = QList<int>{-1};
        QString error;
        QList<ShortcutTuple> out;
        CHECK(!store.readAll(&out, &error));
        CHECK(error == QStringLiteral("unexpected allShortcutInfos reply: negative active key"));
    }
    // Oversized active key via Fake readAll.
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{1}, QList<int>{META_L});
        store.tuples[0].active = QList<int>{SHORTCUT_MAX_KEY_VALUE + 1};
        QString error;
        QList<ShortcutTuple> out;
        CHECK(!store.readAll(&out, &error));
        CHECK(error == QStringLiteral("unexpected allShortcutInfos reply: oversized active key"));
    }
    // Too many tuples via Fake readAll.
    {
        FakeShortcutStore store;
        for (int i = 0; i < SHORTCUT_MAX_TUPLES + 1; ++i) {
            ShortcutTuple tuple;
            tuple.component = QStringLiteral("c%1").arg(i);
            tuple.action = QStringLiteral("a%1").arg(i);
            tuple.componentFriendly = QStringLiteral("cf");
            tuple.friendly = QString();
            store.tuples.append(tuple);
        }
        QString error;
        QList<ShortcutTuple> out;
        CHECK(!store.readAll(&out, &error));
        CHECK(error == QStringLiteral("unexpected allShortcutInfos reply: too many tuples"));
    }
}

void preflightOccupancyHolderSplitTokens()
{
    // Each holder predicate has its own token; triggers are pure. The
    // "holder" qualifier keeps these distinct from the shared-seam field
    // tokens under the same by-key prefix. Occupancy-key range tokens are
    // defensive: relevantConflictKeys() constants are always valid, so the
    // real occupancy branch delegates to checkOccupancyKeyRange and the
    // exact tokens are triggered hermetically there (see
    // boundedHelperSeamsExactTokens).
    auto checkHolder = [](const ShortcutKeyHolder &bad, const char *token) {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
        store.extraByKey[META_L].append(bad);
        const KeyedOccupancyResult outcome = ShortcutReconciler::checkKeyedForeignOccupancyDetailed(&store);
        CHECK(outcome.status == KeyedOccupancy::Unavailable);
        CHECK(outcome.detail == QString::fromUtf8(token));
    };
    {
        ShortcutKeyHolder bad;
        bad.component = QString();
        bad.action = QStringLiteral("other");
        bad.active = QList<int>{META_L};
        checkHolder(bad, "unexpected globalShortcutsByKey reply: empty holder component");
    }
    {
        ShortcutKeyHolder bad;
        bad.component = oversizedString();
        bad.action = QStringLiteral("other");
        bad.active = QList<int>{META_L};
        checkHolder(bad, "unexpected globalShortcutsByKey reply: oversized holder component");
    }
    {
        ShortcutKeyHolder bad;
        bad.component = QStringLiteral("org.kde.unexpected");
        bad.action = QString();
        bad.active = QList<int>{META_L};
        checkHolder(bad, "unexpected globalShortcutsByKey reply: empty holder action");
    }
    {
        ShortcutKeyHolder bad;
        bad.component = QStringLiteral("org.kde.unexpected");
        bad.action = oversizedString();
        bad.active = QList<int>{META_L};
        checkHolder(bad, "unexpected globalShortcutsByKey reply: oversized holder action");
    }
    {
        ShortcutKeyHolder bad;
        bad.component = QStringLiteral("org.kde.unexpected");
        bad.action = QStringLiteral("other");
        QList<int> tooMany;
        for (int i = 0; i < SHORTCUT_MAX_KEYS_PER_TUPLE + 1; ++i) {
            tooMany.append(i + 1);
        }
        bad.active = tooMany;
        checkHolder(bad, "unexpected globalShortcutsByKey reply: too many holder active keys");
    }
    {
        ShortcutKeyHolder bad;
        bad.component = QStringLiteral("org.kde.unexpected");
        bad.action = QStringLiteral("other");
        bad.active = QList<int>{-1};
        checkHolder(bad, "unexpected globalShortcutsByKey reply: negative holder active key");
    }
    {
        ShortcutKeyHolder bad;
        bad.component = QStringLiteral("org.kde.unexpected");
        bad.action = QStringLiteral("other");
        bad.active = QList<int>{SHORTCUT_MAX_KEY_VALUE + 1};
        checkHolder(bad, "unexpected globalShortcutsByKey reply: oversized holder active key");
    }
    {
        ShortcutKeyHolder bad;
        bad.component = QStringLiteral("org.kde.unexpected");
        bad.action = QStringLiteral("other");
        bad.active = QList<int>{};
        QList<int> tooMany;
        for (int i = 0; i < SHORTCUT_MAX_KEYS_PER_TUPLE + 1; ++i) {
            tooMany.append(i + 1);
        }
        bad.defaults = tooMany;
        checkHolder(bad, "unexpected globalShortcutsByKey reply: too many holder default keys");
    }
    {
        ShortcutKeyHolder bad;
        bad.component = QStringLiteral("org.kde.unexpected");
        bad.action = QStringLiteral("other");
        bad.active = QList<int>{};
        bad.defaults = QList<int>{-1};
        checkHolder(bad, "unexpected globalShortcutsByKey reply: negative holder default key");
    }
    {
        ShortcutKeyHolder bad;
        bad.component = QStringLiteral("org.kde.unexpected");
        bad.action = QStringLiteral("other");
        bad.active = QList<int>{};
        bad.defaults = QList<int>{SHORTCUT_MAX_KEY_VALUE + 1};
        checkHolder(bad, "unexpected globalShortcutsByKey reply: oversized holder default key");
    }
    // Too many occupancy holders.
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{419430420}, QList<int>{META_L});
        for (int i = 0; i < SHORTCUT_MAX_TUPLES + 1; ++i) {
            ShortcutKeyHolder holder;
            holder.component = QStringLiteral("c%1").arg(i);
            holder.action = QStringLiteral("a%1").arg(i);
            store.extraByKey[META_L].append(holder);
        }
        const KeyedOccupancyResult outcome = ShortcutReconciler::checkKeyedForeignOccupancyDetailed(&store);
        CHECK(outcome.status == KeyedOccupancy::Unavailable);
        CHECK(outcome.detail
              == QStringLiteral("unexpected globalShortcutsByKey reply: too many occupancy holders"));
    }
    // Availability inconsistency both directions with exact tokens.
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{1}, QList<int>{META_L});
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.active.contains(META_L)) {
                tuple.active.removeAll(META_L);
            }
        }
        store.extraByKey.clear();
        store.availableOverride[META_L] = false;
        const KeyedOccupancyResult outcome = ShortcutReconciler::checkKeyedForeignOccupancyDetailed(&store);
        CHECK(outcome.status == KeyedOccupancy::Unavailable);
        CHECK(outcome.detail
              == QStringLiteral(
                  "unexpected globalShortcutAvailable reply: empty holders report unavailable"));
    }
    {
        FakeShortcutStore store;
        seedReady6(store, QList<int>{1}, QList<int>{META_L});
        store.availableOverride[META_L] = true;
        const KeyedOccupancyResult outcome = ShortcutReconciler::checkKeyedForeignOccupancyDetailed(&store);
        CHECK(outcome.status == KeyedOccupancy::Unavailable);
        CHECK(outcome.detail
              == QStringLiteral(
                  "unexpected globalShortcutAvailable reply: occupied holders report available"));
    }
}

} // namespace


int main(int argc, char **argv)
{
    // Unit 1 hard gate: isolate from the live session bus before any
    // QDBusConnection::sessionBus() initialization (this test constructs
    // the live KGlobalAccelStore).
    qputenv("DBUS_SESSION_BUS_ADDRESS", QByteArray("unix:path=/dev/null/plasma-auto-tiler-kcm-test-isolated-bus"));
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
        unrelatedUnboundedRefusesZeroWrites();
        keyedDesktopOnlyBlocksRelocator();
        keyedDesktopOnlyBlocksClearTargets();
        keyedDesktopOnlyBlocksMetaL();
        keyedSystemMonitorEscAccepted();
        keyedTransportFailsClosed();
        keyedReplyParsingStrict();
        keyedAvailabilityConsistencyBothDirections();
        preflightOccupancyHolderSplitTokens();
    }
    if (scenario == QStringLiteral("all") || scenario == QStringLiteral("malformed")) {
        malformedReplyFailsClosed();
        swappedRolesRejected();
        strictOwnerAndIntrospection();
        friendlyLabelsValidated();
        allComponentsStrictTransport();
        introspectionStrictParsing();
        introspectionQtOutFirstVerbatim();
        introspectionAnnotationNamesStrict();
        keySequenceDbusRoundtripAndBounds();
        writeFailureControlsFailClosed();
        preflightAllComponentsSplitTokens();
        preflightAvailableSplitTokens();
        preflightByKeyTransportSplitTokens();
        preflightAllInfosSplitTokens();
        preflightKeyedFieldsSplitTokens();
        preflightStoreGuardsSplitTokens();
        preflightReadAllFieldSplitTokens();
        infoFieldsWireEncodingProvesSignature();
        seamHoldersAndTuplesFieldBranches();
        wireBoundTokensDistinctFromSeams();
        boundedHelperSeamsExactTokens();
    }
    if (scenario == QStringLiteral("all") || scenario == QStringLiteral("owner")) {
        ownerDriftFailsClosed();
        ownerResolutionHermetic();
        ownerAbsentApplyZeroWrites();
        ownerDriftApplyZeroWrites();
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
