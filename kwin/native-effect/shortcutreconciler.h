#pragma once

#include <QDBusArgument>
#include <QDBusMessage>
#include <QKeySequence>
#include <QList>
#include <QSet>
#include <QString>
#include <QStringList>
#include <QVariant>

// Exact (ai)/a(ai) framing for QKeySequence/QSet<QKeySequence>> matching the
// KF6 KGlobalAccel encoding: each sequence is a struct holding exactly four
// combined key ints. Declared here so tests exercise the same operators.
QDBusArgument &operator<<(QDBusArgument &argument, const QKeySequence &sequence);
const QDBusArgument &operator>>(const QDBusArgument &argument, QKeySequence &sequence);
const QDBusArgument &operator>>(const QDBusArgument &argument, QSet<QKeySequence> &set);

// Bounded KCM shortcut-override backend/state machine.
//
// Closed ordered conflict-resolution table (only):
//   row 0 relocate: kwin/plasma-auto-tiler-focus-right -> Meta+L post;
//     ksmserver/Lock Session Meta+L replaced by Meta+Esc post
//   row 1 clear: kwin/plasma-auto-tiler-resize-outwards-up -> Meta+Alt+K;
//     KDE Keyboard Layout Switcher/Switch to Next Keyboard Layout cleared
//   row 2 clear: kwin/plasma-auto-tiler-resize-outwards-right -> Meta+Alt+L;
//     KDE Keyboard Layout Switcher/Switch to Last-Used Keyboard Layout cleared
//
// Uses only the KGlobalAccel D-Bus APIs proven on live Plasma 6.7.4:
//   org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel
//     allComponents -> ao
//     setShortcutKeys as,a(ai),u -> a(ai) with QSet<QKeySequence>
//       annotations on the keys input and the reply; actionId is
//       [ComponentUnique, ActionUnique, ComponentFriendly, ActionFriendly]
//   org.kde.kglobalaccel.Component allShortcutInfos s default -> a(ssssssaiai)
//   org.freedesktop.DBus GetNameOwner / GetConnectionUnixUser for owner/UID.
// No shell, no guessed identities. All backends are injectable; tests use
// deterministic fakes with no live mutation.

namespace KWin
{

inline constexpr int SHORTCUT_META_L = 268435532; // Meta+L (Qt Meta | Key_L)
inline constexpr int SHORTCUT_META_ESC = 285212672; // Meta+Esc (Qt Meta | Key_Escape)
inline constexpr int SHORTCUT_META_ALT_K = 402653259; // Meta+Alt+K catalog resize-outwards-up
inline constexpr int SHORTCUT_META_ALT_L = 402653260; // Meta+Alt+L catalog resize-outwards-right
inline constexpr uint SHORTCUT_SET_FLAGS = 6; // SetPresent|NoAutoloading
inline constexpr int SHORTCUT_MAX_KEYS_PER_TUPLE = 16;
inline constexpr int SHORTCUT_MAX_TUPLES = 16384;
inline constexpr int SHORTCUT_MAX_STRING_LEN = 256;
inline constexpr int SHORTCUT_MAX_KEY_VALUE = 536870911;
inline constexpr int SHORTCUT_MAX_WRITES = 6;

inline const QString &shortcutService()
{
    static const QString value = QStringLiteral("org.kde.kglobalaccel");
    return value;
}
inline const QString &shortcutPath()
{
    static const QString value = QStringLiteral("/kglobalaccel");
    return value;
}
inline const QString &shortcutInterface()
{
    static const QString value = QStringLiteral("org.kde.KGlobalAccel");
    return value;
}
inline const QString &shortcutComponentInterface()
{
    static const QString value = QStringLiteral("org.kde.kglobalaccel.Component");
    return value;
}
inline const QString &shortcutSetMethod()
{
    static const QString value = QStringLiteral("setShortcutKeys");
    return value;
}
inline const QString &shortcutAllComponentsMethod()
{
    static const QString value = QStringLiteral("allComponents");
    return value;
}
inline const QString &shortcutAllInfosMethod()
{
    static const QString value = QStringLiteral("allShortcutInfos");
    return value;
}
inline const QString &shortcutByKeyMethod()
{
    static const QString value = QStringLiteral("globalShortcutsByKey");
    return value;
}
inline const QString &shortcutAvailableMethod()
{
    static const QString value = QStringLiteral("globalShortcutAvailable");
    return value;
}
// User-authorized explicit displacement (auditable): System Monitor `_launch`
// may hold Meta+Esc; Apply may displace it onto Lock Session without
// rebinding System Monitor itself. No other foreign occupier is authorized.
// Do not select a different target and do not write to System Monitor.
inline const QString &shortcutAuthorizedEscComponent()
{
    static const QString value = QStringLiteral("org.kde.plasma.systemmonitor");
    return value;
}
inline const QString &shortcutAuthorizedEscAction()
{
    static const QString value = QStringLiteral("_launch");
    return value;
}
inline constexpr int SHORTCUT_MATCH_EQUAL = 0;
inline const QString &shortcutFocusComponent()
{
    static const QString value = QStringLiteral("kwin");
    return value;
}
inline const QString &shortcutFocusAction()
{
    static const QString value = QStringLiteral("plasma-auto-tiler-focus-right");
    return value;
}
inline const QString &shortcutLockComponent()
{
    static const QString value = QStringLiteral("ksmserver");
    return value;
}
inline const QString &shortcutLockAction()
{
    static const QString value = QStringLiteral("Lock Session");
    return value;
}
inline const QString &shortcutResizeUpComponent() { static const QString v = QStringLiteral("kwin"); return v; }
inline const QString &shortcutResizeUpAction() { static const QString v = QStringLiteral("plasma-auto-tiler-resize-outwards-up"); return v; }
inline const QString &shortcutResizeRightComponent() { static const QString v = QStringLiteral("kwin"); return v; }
inline const QString &shortcutResizeRightAction() { static const QString v = QStringLiteral("plasma-auto-tiler-resize-outwards-right"); return v; }
inline const QString &shortcutSwitchNextComponent() { static const QString v = QStringLiteral("KDE Keyboard Layout Switcher"); return v; }
inline const QString &shortcutSwitchNextAction() { static const QString v = QStringLiteral("Switch to Next Keyboard Layout"); return v; }
inline const QString &shortcutSwitchLastComponent() { static const QString v = QStringLiteral("KDE Keyboard Layout Switcher"); return v; }
inline const QString &shortcutSwitchLastAction() { static const QString v = QStringLiteral("Switch to Last-Used Keyboard Layout"); return v; }
inline const QString &shortcutResolutionRelocate() { static const QString v = QStringLiteral("relocate"); return v; }
inline const QString &shortcutResolutionClear() { static const QString v = QStringLiteral("clear"); return v; }
inline const QString &shortcutJournalSchema()
{
    static const QString value = QStringLiteral("shortcut-override-v2");
    return value;
}
inline const QString &shortcutJournalGroup()
{
    static const QString value = QStringLiteral("ShortcutOverride");
    return value;
}
inline const QString &shortcutJournalPhasePending()
{
    static const QString value = QStringLiteral("apply-pending");
    return value;
}
inline const QString &shortcutJournalPhaseFocusApplied()
{
    static const QString value = QStringLiteral("focus-applied");
    return value;
}
inline const QString &shortcutJournalPhaseComplete()
{
    static const QString value = QStringLiteral("apply-complete");
    return value;
}

struct ShortcutTuple
{
    QString component;
    QString action;
    QString componentFriendly;
    QString friendly;
    QList<int> active;
};

struct ShortcutJournalEntry
{
    QString component;
    QString action;
    QList<int> pre;
    QList<int> post;
};

struct ShortcutJournal
{
    QString schema;
    QString phase;
    QString owner;
    uint uid = 0;
    ShortcutJournalEntry focus;
    ShortcutJournalEntry lock;
    ShortcutJournalEntry resizeUp;
    ShortcutJournalEntry switchNext;
    ShortcutJournalEntry resizeRight;
    ShortcutJournalEntry switchLast;
    QString row0Kind;
    QString row1Kind;
    QString row2Kind;
};

struct ShortcutConflictRow
{
    QString projectComponent;
    QString projectAction;
    QList<int> projectPost;
    QString foreignComponent;
    QString foreignAction;
    QList<int> foreignExpectedPre;
    QString resolution;
    QList<int> resolutionTarget;
    // Exact foreign holder permitted on this row's resolution target. It is
    // never writable and any other holder remains a conflict.
    QString authorizedTargetComponent;
    QString authorizedTargetAction;
};

const QList<ShortcutConflictRow> &shortcutConflictTable();

// Typed keyed-occupancy outcome (no substring classification):
// Clear means no foreign occupancy, Conflict means an unexpected holder
// claims a relevant key, Unavailable means transport/parse/consistency
// failure. globalShortcutAvailable(key, "") is whole-key availability.
enum class KeyedOccupancy
{
    Clear,
    Conflict,
    Unavailable
};

struct KeyedOccupancyResult
{
    KeyedOccupancy status = KeyedOccupancy::Clear;
    QString detail;
};

struct ShortcutKeyHolder
{
    QString component;
    QString action;
    // Authoritative primitive sees defaults: a .desktop-declared-only
    // holder may have empty active with defaults containing the key.
    QList<int> active;
    QList<int> defaults;
};

// Plain KGlobalShortcutInfo fields (ssssss + ai + ai) shared by the
// allShortcutInfos and globalShortcutsByKey reply parsers. The QDBusArgument
// versions only extract this list from the wire struct array, then delegate
// all field/bound mapping here, so hermetic tests cover the real field
// branches without a live bus and without duplicating parsing.
struct ShortcutInfoFields
{
    QString action;
    QString friendly;
    QString compUnique;
    QString compFriendly;
    QString contextUnique;
    QString contextFriendly;
    QList<int> active;
    QList<int> defaults;
};

// Exact (ssssssaiai) struct framing for KGlobalShortcutInfo: 6 strings plus
// active/default int arrays. In KWin namespace so ADL finds them from
// qDBusRegisterMetaType helpers; tests encode a write-mode array through them
// and assert the marshalled signature is exactly a(ssssssaiai).
QDBusArgument &operator<<(QDBusArgument &argument, const ShortcutInfoFields &info);
const QDBusArgument &operator>>(const QDBusArgument &argument, ShortcutInfoFields &info);

// QKeySequence D-Bus framing is (ai); MatchType is (i): a struct holding one
// int (0 == Equal). Registered for the keyed globalShortcutsByKey call.
struct ShortcutMatchType
{
    int value = SHORTCUT_MATCH_EQUAL;
};

struct ShortcutApplyResult
{
    bool ok = false;
    QString error;
    int writes = 0;
};

struct ShortcutRevertResult
{
    bool ok = false;
    QString error;
    int writes = 0;
    QStringList untouched;
    bool journalRemoved = false;
};

class ShortcutStore
{
public:
    virtual ~ShortcutStore() = default;
    virtual bool checkSetterContract(QString *error) = 0;
    virtual bool currentOwner(QString *owner, uint *uid, QString *error) = 0;
    virtual bool readAll(QList<ShortcutTuple> *tuples, QString *error) = 0;
    // Authoritative keyed primitives (Defect B): globalShortcutsByKey and
    // globalShortcutAvailable. Foreign conflict detection must use these,
    // never tuple/config enumeration, so .desktop-only holders are visible.
    virtual bool shortcutsByKey(int key, QList<ShortcutKeyHolder> *holders, QString *error) = 0;
    virtual bool shortcutAvailable(int key, const QString &component, bool *available, QString *error) = 0;
    virtual bool writeKeys(const QString &component, const QString &action, const QString &componentFriendly,
                           const QString &friendly, const QList<int> &keys, QList<int> *confirmed, QString *error) = 0;
    virtual int writeCount() const = 0;
};

class JournalStore
{
public:
    virtual ~JournalStore() = default;
    virtual bool hasJournal() const = 0;
    virtual bool load(ShortcutJournal *journal, QString *error) const = 0;
    virtual bool persist(const ShortcutJournal &journal, QString *error) = 0;
    virtual bool remove(QString *error) = 0;
};

// Real D-Bus backend using QDBus with the exact observed contract.
class KGlobalAccelStore : public ShortcutStore
{
public:
    bool checkSetterContract(QString *error) override;
    bool currentOwner(QString *owner, uint *uid, QString *error) override;
    bool readAll(QList<ShortcutTuple> *tuples, QString *error) override;
    bool shortcutsByKey(int key, QList<ShortcutKeyHolder> *holders, QString *error) override;
    bool shortcutAvailable(int key, const QString &component, bool *available, QString *error) override;
    bool writeKeys(const QString &component, const QString &action, const QString &componentFriendly,
                   const QString &friendly, const QList<int> &keys, QList<int> *confirmed, QString *error) override;
    int writeCount() const override
    {
        return m_writes;
    }
    // Pure pin transition tested without D-Bus: first verified owner sets
    // the pin, the same owner confirms it, a different owner fails closed.
    static bool tryPinOwner(QString &pinned, const QString &candidate, QString *error);
    // Pure daemon owner resolution tested without D-Bus: validates the
    // serviceOwner/serviceUid values, pins on first success, and fails
    // closed on absent service or drift. Live currentOwner() only fetches
    // the values via QDBusConnection::interface() and delegates here.
    static bool resolveOwnerReply(bool ownerValid, const QString &ownerValue, bool uidValid, uint uidValue,
                                  QString &pinned, QString *ownerOut, uint *uidOut, QString *error);
    // Pure pinned-owner drift check for the write path without D-Bus:
    // invalid live owner or any mismatch fails closed as drift.
    static bool checkPinnedDrift(bool liveValid, const QString &liveValue, const QString &pinned, QString *error);

private:
    int m_writes = 0;
    QString m_pinnedOwner;
};

// Real KConfig journal backend rooted at an explicit project-owned file.
class KConfigFileJournal : public JournalStore
{
public:
    explicit KConfigFileJournal(const QString &filePath);
    bool hasJournal() const override;
    bool load(ShortcutJournal *journal, QString *error) const override;
    bool persist(const ShortcutJournal &journal, QString *error) override;
    bool remove(QString *error) override;

private:
    QString m_filePath;
};

class ShortcutReconciler
{
public:
    ShortcutReconciler(ShortcutStore *store, JournalStore *journal);
    ShortcutApplyResult apply();
    ShortcutRevertResult revert();

    static bool isAllowlisted(const QString &component, const QString &action);
    static QList<int> focusPostKeys();
    static QList<int> lockPostFor(const QList<int> &lockPre);
    static QList<int> resizeUpPostKeys();
    static QList<int> resizeRightPostKeys();
    static QList<int> switchNextExpectedPre();
    static QList<int> switchLastExpectedPre();
    static QList<int> dedupKeys(const QList<int> &keys);
    static bool keysValid(const QList<int> &keys);
    static bool stringValid(const QString &value);
    // Cosmetic labels/contexts: empty allowed (real captures leave friendly
    // empty), only the length bound applies. Identity (action/compUnique)
    // and keys stay strict via stringValid/keysValid.
    static bool cosmeticValid(const QString &value);
    // Pure field-category validator shared by allShortcutInfos and
    // globalShortcutsByKey parsing (and mirrored by fakes): identity stays
    // strict, cosmetic labels/contexts allow empty with only the length
    // bound, active/default keys stay strict. Returns true when valid;
    // otherwise sets *fieldError to a bounded non-reflective suffix for the
    // caller to prefix. Each independently producing elementary predicate
    // has its own suffix, in fixed order: "empty action",
    // "oversized action", "empty component", "oversized component",
    // "oversized friendly", "oversized component friendly",
    // "oversized context unique", "oversized context friendly",
    // "too many active keys", "negative active key",
    // "oversized active key", "too many default keys",
    // "negative default key", "oversized default key". The key classifier
    // is one ordered scan (too-many, then negative, then oversized), so a
    // list with both a negative and an over-max key reports negative.
    // Full tokens add the per-parser prefix
    // ("unexpected globalShortcutsByKey reply: " or
    // "unexpected allShortcutInfos reply: "), so the same suffix under two
    // prefixes is two distinct full tokens, each covered on both seams.
    static bool keyedFieldsValid(const QString &action, const QString &friendly, const QString &compUnique,
                                 const QString &compFriendly, const QString &contextUnique,
                                 const QString &contextFriendly, const QList<int> &active,
                                 const QList<int> &defaults, QString *fieldError);
    static bool uniqueNameValid(const QString &owner);
    static bool introspectionContractValid(const QString &xml);
    static bool parseAllComponentsReply(QDBusMessage::MessageType replyType, const QString &replySignature,
                                        const QList<QVariant> &replyArgs, QStringList *components, QString *error);
    // Pure strict (ai) slot validation tested without D-Bus: exactly four
    // ints in [0, SHORTCUT_MAX_KEY_VALUE]; the live encoding always writes
    // four slots with zero padding. Both reply-decode variants share it.
    static bool decodeKeySequenceSlots(const QList<int> &slotValues, QKeySequence *out);
    static bool journalPathSafe(const QString &path, QString *error);
    static bool journalRolesValid(const ShortcutJournal &journal);
    static bool journalPostsValid(const ShortcutJournal &journal);
    // Defect B keyed conflict detection (authoritative, not enumeration).
    static QList<int> relevantConflictKeys();
    static QString keyDisplayName(int key);
    static bool isAuthorizedDisplacement(int key, const QString &component, const QString &action);
    static bool parseGlobalShortcutsByKeyReply(QDBusMessage::MessageType replyType, const QString &replySignature,
                                               const QList<QVariant> &replyArgs,
                                               QList<ShortcutKeyHolder> *holders, QString *error);
    // Pure allShortcutInfos reply parser shared with KGlobalAccelStore::readAll
    // (no live D-Bus): exact ReplyMessage with signature "a(ssssssaiai)".
    // Ordered type then signature then arity; field validation shares
    // keyedFieldsValid; bound SHORTCUT_MAX_TUPLES. Lets hermetic tests cover
    // the live read path without session services and without duplicating
    // parsing in the backend.
    static bool parseAllShortcutInfosReply(QDBusMessage::MessageType replyType, const QString &replySignature,
                                           const QList<QVariant> &replyArgs, QList<ShortcutTuple> *tuples,
                                           QString *error);
    // Shared pure field-to-output mapping (no D-Bus): validates each fields
    // record via keyedFieldsValid and maps to holders/tuples with the exact
    // per-parser error prefix and bound ("too many holders" / "too many
    // tuples"). The QDBusArgument reply parsers enforce their own independent
    // fail-fast wire bound in the demarshal loop ("too many wire holders" /
    // "too many wire tuples") immediately after every append, before further
    // payload allocation, then delegate here, so hermetic tests of these functions cover the real field
    // branches (a direct readable QDBusArgument is not constructible via the
    // public Qt API outside a real bus reply).
    static bool holdersFromInfoFields(const QList<ShortcutInfoFields> &infos,
                                      QList<ShortcutKeyHolder> *holders, QString *error);
    static bool tuplesFromInfoFields(const QList<ShortcutInfoFields> &infos, QList<ShortcutTuple> *tuples,
                                     QString *error);
    // Smallest pure seams covering otherwise unreachable wire/collected and
    // defensive branches (no new capability, same tokens/bounds/order):
    // appendComponentPath validates one ao path and appends on success,
    // parameterized by the two actual representation provenances (false is
    // the typed QList<QDBusObjectPath> list, true is the read-mode
    // QDBusArgument array); checkTupleAppendBound is the shared size
    // predicate called immediately after each real wire append and each
    // real cross-component collected append; checkOccupancyKeyRange is the
    // single-key range helper called by occupancy. Each returns false with
    // the exact full bounded token for its failing predicate only.
    enum class TupleAppendBound
    {
        ByKeyWire,
        AllInfosWire,
        Collected
    };
    static bool appendComponentPath(const QString &path, bool fromArgumentArray, QStringList *parsed,
                                    QString *error);
    static bool checkTupleAppendBound(int size, TupleAppendBound kind, QString *error);
    static bool checkOccupancyKeyRange(int key, QString *error);
    static bool parseGlobalShortcutAvailableReply(QDBusMessage::MessageType replyType,
                                                  const QString &replySignature, const QList<QVariant> &replyArgs,
                                                  bool *available, QString *error);
    // Calls shortcutsByKey + shortcutAvailable for every relevant key.
    // Skips allowlisted holders and the explicit System Monitor Meta+Esc
    // displacement; any other holder fails closed with a "claimed by"
    // error before any journal/write. Availability consistency fails
    // closed in both directions: holders empty must report available,
    // holders non-empty must report unavailable (whole-key semantics).
    static KeyedOccupancyResult checkKeyedForeignOccupancyDetailed(ShortcutStore *store);
    static bool checkKeyedForeignOccupancy(ShortcutStore *store, QString *error);

private:
    ShortcutStore *m_store = nullptr;
    JournalStore *m_journal = nullptr;
};

// Live backend factories for KCM integration. The KCM calls only these and
// the allowlisted reconciler API; no other identities are exposed here.
ShortcutStore *createLiveShortcutStore();
JournalStore *createLiveShortcutJournal(const QString &filePath);
QString defaultShortcutJournalPath();

} // namespace KWin
Q_DECLARE_METATYPE(KWin::ShortcutMatchType)
Q_DECLARE_METATYPE(KWin::ShortcutInfoFields)
Q_DECLARE_METATYPE(QList<KWin::ShortcutInfoFields>)
QDBusArgument &operator<<(QDBusArgument &argument, const KWin::ShortcutMatchType &match);
const QDBusArgument &operator>>(const QDBusArgument &argument, KWin::ShortcutMatchType &match);
