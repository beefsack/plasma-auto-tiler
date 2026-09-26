#pragma once

#include <QDBusArgument>
#include <QDBusMessage>
#include <QKeySequence>
#include <QList>
#include <QLoggingCategory>
#include <QSet>
#include <QString>
#include <QStringList>
#include <QVariant>

#include <functional>

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
//   row 3 clear: kwin/plasma-auto-tiler-toggle-float -> Meta+G;
//     kwin/Grid View cleared
//   row 4 clear: kwin/plasma-auto-tiler-toggle-maximize -> Meta+M;
//     kwin/KrohnkiteMonocleLayout cleared
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
inline constexpr int SHORTCUT_META_G = 268435527; // Meta+G catalog toggle-float
inline constexpr int SHORTCUT_META_M = 268435533; // Meta+M catalog toggle-maximize
inline constexpr uint SHORTCUT_SET_FLAGS = 6; // SetPresent|NoAutoloading
inline constexpr int SHORTCUT_MAX_KEYS_PER_TUPLE = 16;
inline constexpr int SHORTCUT_MAX_TUPLES = 16384;
inline constexpr int SHORTCUT_MAX_STRING_LEN = 256;
inline constexpr int SHORTCUT_MAX_KEY_VALUE = 536870911;
inline constexpr int SHORTCUT_MAX_WRITES = 10;

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
inline const QString &shortcutDefaultKeysMethod()
{
    static const QString value = QStringLiteral("defaultShortcutKeys");
    return value;
}
inline const QString &shortcutSetForeignKeysMethod()
{
    static const QString value = QStringLiteral("setForeignShortcutKeys");
    return value;
}
inline const QString &shortcutActiveKeysMethod()
{
    static const QString value = QStringLiteral("shortcutKeys");
    return value;
}
// User-authorized explicit displacement (auditable): System Monitor `_launch`
// may hold Meta+Esc; Apply may displace it onto Lock Session without
// rebinding System Monitor itself. No other foreign occupier is authorized.
// Do not select a different target and do not write to System Monitor.
inline const QString &shortcutAuthorizedEscComponent()
{
    static const QString value = QStringLiteral("org.kde.plasma-systemmonitor.desktop");
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
inline const QString &shortcutFloatComponent() { static const QString v = QStringLiteral("kwin"); return v; }
inline const QString &shortcutFloatAction() { static const QString v = QStringLiteral("plasma-auto-tiler-toggle-float"); return v; }
inline const QString &shortcutGridViewComponent() { static const QString v = QStringLiteral("kwin"); return v; }
inline const QString &shortcutGridViewAction() { static const QString v = QStringLiteral("Grid View"); return v; }
inline const QString &shortcutMaximizeComponent() { static const QString v = QStringLiteral("kwin"); return v; }
inline const QString &shortcutMaximizeAction() { static const QString v = QStringLiteral("plasma-auto-tiler-toggle-maximize"); return v; }
inline const QString &shortcutMonocleComponent() { static const QString v = QStringLiteral("kwin"); return v; }
inline const QString &shortcutMonocleAction() { static const QString v = QStringLiteral("KrohnkiteMonocleLayout"); return v; }
inline const QString &shortcutResolutionRelocate() { static const QString v = QStringLiteral("relocate"); return v; }
inline const QString &shortcutResolutionClear() { static const QString v = QStringLiteral("clear"); return v; }

struct ShortcutTuple
{
    QString component;
    QString action;
    QString componentFriendly;
    QString friendly;
    QList<int> active;
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

// Explicit confirmed override for holders of project-required chords.
// Produced by previewForceApply and consumed by applyForced; never
// constructed from arbitrary UI input. One row per cleared holder:
//   actual is the full live active list observed for the holder,
//   expectedPre carries precisely the conflicting required subset being
//     removed (actual intersected with the project-required chords),
//   post carries the remainder kept on the holder (actual minus the
//     conflicting subset, order-preserving; possibly empty).
// Revert does not consume preimages: it restores defaults.
struct ShortcutForceMismatch
{
    QString component;
    QString action;
    QList<int> expectedPre;
    QList<int> actual;
    QList<int> post;
    // Cosmetic actionId parts observed for the holder (empty allowed, e.g.
    // for .desktop-only holders). Transient preview labels only: never
    // persisted to the cleared-ID list; never part of identity.
    QString componentFriendly;
    QString friendly;
};

struct ShortcutForcePreview
{
    bool forceable = false;
    QString error;
    QList<ShortcutForceMismatch> mismatches;
    // Full bounded preflight image. Force accepts only this exact live image,
    // not merely the rows that initially needed clearing.
    QString owner;
    uint uid = 0;
    // Project/lock actives at preview time (focus, lock, resize-up,
    // resize-right, float, maximize, in table order). Any drift fails the
    // confirmation as stale with zero writes.
    QList<QList<int>> liveImages;
};

struct ShortcutForceApplyResult
{
    bool ok = false;
    QString error;
    int writes = 0;
};

// Bounded structured diagnostics through QLoggingCategory
// "plasmaautotiler.shortcut" (visible in the kcmshell6/System Settings
// journald log). Only safe fields are ever logged: operation, stage,
// outcome, allowlisted component/action identity, and key images. Logging
// never affects behavior: the sink is void, exceptions are swallowed, and
// no caller branches on logging.
using ShortcutLogSink = std::function<void(QtMsgType, const QString &)>;
class ShortcutDiag
{
public:
    static void setSink(ShortcutLogSink sink);
    static void resetSink();
    static void log(QtMsgType type, const char *operation, const char *stage, const char *outcome,
                    const QString &detail);
};

struct ShortcutRevertResult
{
    bool ok = false;
    QString error;
    int writes = 0;
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
    // Bounded native TRANSPORT seam: exact KGlobalAccel
    // defaultShortcutKeys(as)->a(ai) read and setForeignShortcutKeys
    // (as,a(ai))->void write against the pinned org.kde.KGlobalAccel owner.
    // Policy/UI paths use writeKeys for project rows; these methods
    // establish the injectable seam for foreign defaults/clears.
    virtual bool defaultShortcutKeys(const QString &component, const QString &action,
                                     const QString &componentFriendly, const QString &friendly,
                                     QList<int> *defaults, QString *error) = 0;
    virtual bool setForeignShortcutKeys(const QString &component, const QString &action,
                                        const QString &componentFriendly, const QString &friendly,
                                        const QList<int> &keys, QString *error) = 0;
    virtual int writeCount() const = 0;
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
    bool defaultShortcutKeys(const QString &component, const QString &action, const QString &componentFriendly,
                             const QString &friendly, QList<int> *defaults, QString *error) override;
    bool setForeignShortcutKeys(const QString &component, const QString &action, const QString &componentFriendly,
                                const QString &friendly, const QList<int> &keys, QString *error) override;
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

// Minimal durable Force record: ONLY the component/action IDs Force
// cleared, in the project-owned config. Union-persisted BEFORE Force
// clearing so an interrupted Force stays revertible; emptied only after
// Revert restores every non-project entry. No cosmetic labels are
// persisted: Revert resolves each ID to its fresh current tuple from
// readAll to supply the current friendly labels for the 4-field actionId
// (KGlobalAccel 4-field semantics proven; 2-field daemon behavior
// unproven, so never assumed). Identity is component/action.
struct ClearedAction
{
    QString component;
    QString action;
};

inline bool operator==(const ClearedAction &a, const ClearedAction &b)
{
    return a.component == b.component && a.action == b.action;
}

inline bool clearedActionSameId(const ClearedAction &a, const ClearedAction &b)
{
    return a.component == b.component && a.action == b.action;
}

class ClearedActionsStore
{
public:
    virtual ~ClearedActionsStore() = default;
    // Absent config loads as an empty list (no error). Bounded: at most
    // SHORTCUT_MAX_TUPLES entries, strict component/action identity only.
    // Only Components+Actions are stored; legacy friendly keys are ignored.
    virtual bool load(QList<ClearedAction> *actions, QString *error) = 0;
    // Whole-list replace with write+sync+readback.
    virtual bool save(const QList<ClearedAction> &actions, QString *error) = 0;
    // Empty the list after a complete Revert.
    virtual bool clear(QString *error) = 0;
};

// Real KConfig backend rooted at an explicit project-owned file.
class KConfigClearedActions : public ClearedActionsStore
{
public:
    explicit KConfigClearedActions(const QString &filePath);
    bool load(QList<ClearedAction> *actions, QString *error) override;
    bool save(const QList<ClearedAction> &actions, QString *error) override;
    bool clear(QString *error) override;

private:
    QString m_filePath;
};

class ShortcutReconciler
{
public:
    explicit ShortcutReconciler(ShortcutStore *store, ClearedActionsStore *cleared = nullptr);
    ShortcutApplyResult apply();
    // Revert restores defaults for every non-project ID in the durable
    // cleared list (project-owned kwin/plasma-auto-tiler-* IDs, including
    // legacy ones, stay cleared) and empties the list only after all of
    // them are restored. Each persisted ID is resolved to its fresh
    // current tuple from readAll to supply the current friendly labels
    // (empty allowed) for the 4-field actionId; absent or duplicate IDs
    // fail closed without writing unrelated actions and retain the list
    // for retry. Empty list is a no-op success.
    ShortcutRevertResult revert();
    // Read-only force preview: every actual holder of a project-required
    // chord (known, unknown, and legacy project IDs alike), except the
    // project actions themselves, Lock Session, and the authorized System
    // Monitor Meta+Esc holder. Never forceable when any store, ownership,
    // transport, or parsing check fails.
    ShortcutForcePreview previewForceApply();
    // Confirmed force: revalidates the preview snapshot against a fresh live
    // read (stale snapshots fail closed with zero writes, including zero
    // cleared-list writes when stale before persist), persists the union of
    // cleared component/action IDs (no cosmetic labels) to the project
    // config BEFORE clearing, re-reads each
    // holder immediately before its foreign setter and aborts when its
    // active list changed (zero further KGlobalAccel writes), clears only
    // the conflicting keys from each holder (unrelated keys preserved),
    // then assigns the project keys and relocates Lock Session. Drift after
    // persist retains the persisted union (a superset when the drifted
    // holder was never cleared); a later Revert may therefore restore
    // defaults for an action Force never cleared.
    ShortcutForceApplyResult applyForced(const ShortcutForcePreview &confirmed);

    static bool isAllowlisted(const QString &component, const QString &action);
    // Current project-owned action (one of the five conflict-table project
    // rows). Never cleared by Force, never restored by Revert.
    static bool isProjectAction(const QString &component, const QString &action);
    // Any own-prefix action: kwin/plasma-auto-tiler-*, covering the current
    // project rows and legacy IDs (e.g. plasma-auto-tiler-float-toggle,
    // plasma-auto-tiler-toggle). Force may clear them; Revert leaves them
    // cleared.
    static bool isProjectOwned(const QString &component, const QString &action);
    static bool isLockAction(const QString &component, const QString &action);
    // Required-chord subset of a live active list (the keys Force removes),
    // order-preserving. Empty means the holder claims no required chord.
    static QList<int> conflictingKeys(const QList<int> &active);
    // Remainder kept on a cleared holder (active minus required chords),
    // order-preserving.
    static QList<int> remainderAfterClear(const QList<int> &active);
    static QList<int> focusPostKeys();
    static QList<int> lockPostFor(const QList<int> &lockPre);
    static QList<int> resizeUpPostKeys();
    static QList<int> resizeRightPostKeys();
    static QList<int> switchNextExpectedPre();
    static QList<int> switchLastExpectedPre();
    static QList<int> floatPostKeys();
    static QList<int> gridViewExpectedPre();
    static QList<int> maximizePostKeys();
    static QList<int> monocleExpectedPre();
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
    // Pure setter-reply slot-set validation used by the real setShortcutKeys
    // decoder: each group must be exactly four bounded slots; the outer
    // count must not exceed SHORTCUT_MAX_KEYS_PER_TUPLE. Empty accepted.
    static bool decodeSetterReplySlotSets(const QList<QList<int>> &slotGroups, QSet<QKeySequence> *out);
    // Bounded native TRANSPORT pure seams (Delivery 2 Unit 1, no live bus):
    // exact defaultShortcutKeys(as)->a(ai) reply decode into primitive
    // defaults (flattened distinct non-zero slots, sorted for determinism),
    // exact setForeignShortcutKeys(as,a(ai))->void reply validation (empty
    // void reply only), and order-insensitive set comparison for the void
    // setter fresh readback. Ordered type then signature then arity.
    static bool parseDefaultShortcutKeysReply(QDBusMessage::MessageType replyType, const QString &replySignature,
                                              const QList<QVariant> &replyArgs, QList<int> *defaults,
                                              QString *error);
    static bool parseSetForeignShortcutKeysReply(QDBusMessage::MessageType replyType,
                                                 const QString &replySignature, const QList<QVariant> &replyArgs,
                                                 QString *error);
    static bool foreignReadbackMatches(const QList<int> &expected, const QList<int> &actual);
    static bool clearedActionsPathSafe(const QString &path, QString *error);
    // Defect B keyed conflict detection (authoritative, not enumeration).
    static QList<int> relevantConflictKeys();
    static QString keyDisplayName(int key);
    // Bounded safe key-list image for diagnostics/preview: "none" for empty,
    // otherwise comma-joined ints. Only ever called with validated key lists.
    static QString keysDisplay(const QList<int> &keys);
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
    // Skips only the project actions, Lock Session, and the explicit
    // System Monitor Meta+Esc displacement (shared with the backend
    // holder scan); any other holder, known or unknown, fails closed
    // with a "claimed by" error before any write. Availability
    // consistency fails closed in both directions: holders empty must
    // report available, holders non-empty must report unavailable
    // (whole-key semantics).
    static KeyedOccupancyResult checkKeyedForeignOccupancyDetailed(ShortcutStore *store);
    static bool checkKeyedForeignOccupancy(ShortcutStore *store, QString *error);
    // Shared occupancy exemption behind the status check and the backend
    // holder scan: project actions own their chords, Lock Session owns
    // its chord, and the explicit System Monitor Meta+Esc holder is
    // user-authorized. Every other holder, including the compiled
    // foreign rows (Grid View, Switcher, Monocle), is a conflict.
    static bool isHolderExempt(const QString &component, const QString &action, int key);

private:
    ShortcutStore *m_store = nullptr;
    // Durable cleared-ID list in the project config. Not owned.
    // Force persists the union here before clearing; Revert consumes it.
    ClearedActionsStore *m_cleared = nullptr;

    // One observed holder row needing clearance.
    struct ClearRow
    {
        QString component;
        QString action;
        QString componentFriendly;
        QString friendly;
        QList<int> active;
        QList<int> removals;
        QList<int> remainder;
    };
    // A non-exempt holder listed for a required key without any required
    // key in its active list (e.g. a .desktop-declared default). It claims
    // the chord but offers nothing Force can clear: Apply refuses and Force
    // is not available until it is unbound manually.
    struct Blocker
    {
        QString component;
        QString action;
        int key = 0;
    };
    struct HolderSnapshot
    {
        QString owner;
        uint uid = 0;
        ShortcutTuple focus;
        ShortcutTuple lock;
        ShortcutTuple resizeUp;
        ShortcutTuple resizeRight;
        ShortcutTuple floatToggle;
        ShortcutTuple maximizeToggle;
        QList<ClearRow> rows;
        QList<Blocker> blocked;
    };
    // Shared fresh read for apply and force preview: setter contract, owner,
    // project/lock tuple resolution with key bounds, and the per-required-key
    // holder scan. Zero writes. Fails closed on any transport, parsing,
    // consistency, or lock-precondition failure.
    bool collectHolderSnapshot(HolderSnapshot *snapshot, QString *error);
    // Assigns project posts and relocates Lock Session from a fresh read.
    // Used by both apply (no holders present) and the second half of force
    // (holders just cleared). Owner-pinned with confirmed replies.
    ShortcutApplyResult writeProjectKeys(const char *operation);
    // Fresh preview builder behind previewForceApply and the force
    // revalidation inside applyForced.
    ShortcutForcePreview buildForcePreview();
    static bool forceMismatchFromRow(const ClearRow &row, ShortcutForceMismatch *out);
};

// Live backend factories for KCM integration. The KCM calls only these and
// the allowlisted reconciler API; no other identities are exposed here.
ShortcutStore *createLiveShortcutStore();
ClearedActionsStore *createLiveClearedActionsStore(const QString &filePath);
// Host-independent project config path (GenericConfigLocation,
// project-owned) for the durable cleared-ID list.
QString defaultClearedActionsPath();



} // namespace KWin
Q_DECLARE_METATYPE(KWin::ShortcutMatchType)
Q_DECLARE_METATYPE(KWin::ShortcutInfoFields)
Q_DECLARE_METATYPE(QList<KWin::ShortcutInfoFields>)
QDBusArgument &operator<<(QDBusArgument &argument, const KWin::ShortcutMatchType &match);
const QDBusArgument &operator>>(const QDBusArgument &argument, KWin::ShortcutMatchType &match);
