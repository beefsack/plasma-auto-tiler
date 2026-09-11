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
};

const QList<ShortcutConflictRow> &shortcutConflictTable();

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
    bool writeKeys(const QString &component, const QString &action, const QString &componentFriendly,
                   const QString &friendly, const QList<int> &keys, QList<int> *confirmed, QString *error) override;
    int writeCount() const override
    {
        return m_writes;
    }
    // Pure pin transition tested without D-Bus: first verified owner sets
    // the pin, the same owner confirms it, a different owner fails closed.
    static bool tryPinOwner(QString &pinned, const QString &candidate, QString *error);

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
