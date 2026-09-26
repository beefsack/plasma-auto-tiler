#include "shortcutreconciler.h"

#include <KConfig>
#include <KConfigGroup>

#include <QDBusArgument>
#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusMessage>
#include <QDBusMetaType>
#include <QDBusObjectPath>
#include <QDBusReply>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QKeySequence>
#include <QRegularExpression>
#include <QSet>
#include <QStandardPaths>
#include <QXmlStreamReader>

#include <cerrno>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>

// QKeySequence D-Bus encoding is (ai): a struct holding an int array of up
// to four combined key values. QSet<QKeySequence> therefore encodes as
// a(ai). QList<QList<int>> would encode as aai and is wrong here. These
// operators match the KF6 KGlobalAccel encoding; the sets additionally need
// qDBusRegisterMetaType<QSet<QKeySequence>>() before use.
QDBusArgument &operator<<(QDBusArgument &argument, const QKeySequence &sequence)
{
    argument.beginStructure();
    argument.beginArray(qMetaTypeId<int>());
    for (int i = 0; i < 4; ++i) {
        const int value = (i < sequence.count()) ? sequence[static_cast<uint>(i)].toCombined() : 0;
        argument << value;
    }
    argument.endArray();
    argument.endStructure();
    return argument;
}

const QDBusArgument &operator>>(const QDBusArgument &argument, QKeySequence &sequence)
{
    // Read-mode guarded exact four-slot decode: a container must never
    // reach operator>>(int&). Check structure -> array -> basic before
    // each descent/read; any unexpected framing fails closed to empty.
    sequence = QKeySequence();
    if (argument.currentType() != QDBusArgument::StructureType) {
        return argument;
    }
    argument.beginStructure();
    if (argument.currentType() != QDBusArgument::ArrayType) {
        argument.endStructure();
        return argument;
    }
    argument.beginArray();
    QList<int> values;
    int innerCount = 0;
    bool bad = false;
    while (!argument.atEnd()) {
        if (argument.currentType() != QDBusArgument::BasicType) {
            bad = true;
            break;
        }
        int value = 0;
        argument >> value;
        if (innerCount < 4) {
            values.append(value);
        }
        ++innerCount;
    }
    argument.endArray();
    argument.endStructure();
    if (bad || innerCount != 4 || !KWin::ShortcutReconciler::decodeKeySequenceSlots(values, &sequence)) {
        sequence = QKeySequence();
        return argument;
    }
    return argument;
}

// Qt generic container extraction requires push_back, which QSet lacks
// (it has insert). This exact overload provides a(ai) framing for
// qDBusRegisterMetaType<QSet<QKeySequence>> and any direct extraction.
// Bounded: malformed or oversized input becomes an unmatchable sentinel so
// a clear-row reply cannot mistake it for a valid empty set. Read-mode
// guarded: a non-array or non-structure element never reaches basic reads.
const QDBusArgument &operator>>(const QDBusArgument &argument, QSet<QKeySequence> &set)
{
    set.clear();
    if (argument.currentType() != QDBusArgument::ArrayType) {
        return argument;
    }
    argument.beginArray();
    int count = 0;
    bool bad = false;
    while (!argument.atEnd()) {
        if (argument.currentType() != QDBusArgument::StructureType) {
            bad = true;
            break;
        }
        QKeySequence sequence;
        argument >> sequence;
        if (sequence.isEmpty()) {
            bad = true;
            break;
        }
        if (count <= KWin::SHORTCUT_MAX_KEYS_PER_TUPLE) {
            set.insert(sequence);
        }
        ++count;
        if (count > KWin::SHORTCUT_MAX_KEYS_PER_TUPLE) {
            while (!argument.atEnd()) {
                if (argument.currentType() != QDBusArgument::StructureType) {
                    bad = true;
                    break;
                }
                QKeySequence extra;
                argument >> extra;
                ++count;
            }
            break;
        }
    }
    argument.endArray();
    if (bad || count > KWin::SHORTCUT_MAX_KEYS_PER_TUPLE) {
        set.clear();
        // Preserve malformed/oversized wire input as unmatchable. An empty
        // set would otherwise falsely confirm a clear-row reply.
        set.insert(QKeySequence(KWin::SHORTCUT_MAX_KEY_VALUE + 1));
    }
    return argument;
}

// MatchType (i): single-int struct for globalShortcutsByKey Equal matching.
QDBusArgument &operator<<(QDBusArgument &argument, const KWin::ShortcutMatchType &match)
{
    argument.beginStructure();
    argument << match.value;
    argument.endStructure();
    return argument;
}

const QDBusArgument &operator>>(const QDBusArgument &argument, KWin::ShortcutMatchType &match)
{
    match.value = 0;
    if (argument.currentType() != QDBusArgument::StructureType) {
        return argument;
    }
    argument.beginStructure();
    if (argument.currentType() != QDBusArgument::BasicType) {
        argument.endStructure();
        return argument;
    }
    argument >> match.value;
    argument.endStructure();
    return argument;
}

namespace KWin
{

QDBusArgument &operator<<(QDBusArgument &argument, const ShortcutInfoFields &info)
{
    argument.beginStructure();
    argument << info.action << info.friendly << info.compUnique << info.compFriendly << info.contextUnique
             << info.contextFriendly << info.active << info.defaults;
    argument.endStructure();
    return argument;
}

const QDBusArgument &operator>>(const QDBusArgument &argument, ShortcutInfoFields &info)
{
    // Read-mode guarded: structure framing checked before descent; each
    // basic string checked as BasicType and each int array checked as
    // ArrayType with BasicType elements, so malformed containers fail
    // closed instead of reaching basic extraction.
    info = ShortcutInfoFields();
    if (argument.currentType() != QDBusArgument::StructureType) {
        return argument;
    }
    argument.beginStructure();
    auto readString = [&](QString *out) {
        if (argument.currentType() != QDBusArgument::BasicType) {
            return false;
        }
        QString value;
        argument >> value;
        if (out) {
            *out = value;
        }
        return true;
    };
    auto readIntList = [&](QList<int> *out) {
        if (argument.currentType() != QDBusArgument::ArrayType) {
            return false;
        }
        argument.beginArray();
        QList<int> values;
        while (!argument.atEnd()) {
            if (argument.currentType() != QDBusArgument::BasicType) {
                argument.endArray();
                return false;
            }
            int value = 0;
            argument >> value;
            values.append(value);
        }
        argument.endArray();
        if (out) {
            *out = values;
        }
        return true;
    };
    QString action;
    QString friendly;
    QString compUnique;
    QString compFriendly;
    QString contextUnique;
    QString contextFriendly;
    QList<int> active;
    QList<int> defaults;
    if (!readString(&action) || !readString(&friendly) || !readString(&compUnique) || !readString(&compFriendly)
        || !readString(&contextUnique) || !readString(&contextFriendly) || !readIntList(&active)
        || !readIntList(&defaults)) {
        argument.endStructure();
        info = ShortcutInfoFields();
        return argument;
    }
    argument.endStructure();
    info.action = action;
    info.friendly = friendly;
    info.compUnique = compUnique;
    info.compFriendly = compFriendly;
    info.contextUnique = contextUnique;
    info.contextFriendly = contextFriendly;
    info.active = active;
    info.defaults = defaults;
    return argument;
}

namespace
{

bool findAllowlisted(const QList<ShortcutTuple> &tuples, const QString &component, const QString &action,
                     ShortcutTuple *out, QString *error)
{
    int matches = 0;
    ShortcutTuple found;
    for (const ShortcutTuple &tuple : tuples) {
        if (tuple.component == component && tuple.action == action) {
            ++matches;
            found = tuple;
        }
    }
    if (matches != 1) {
        if (error) {
            *error = QStringLiteral("allowlisted tuple %1/%2 has %3 records, expected exactly one")
                         .arg(component, action)
                         .arg(matches);
        }
        return false;
    }
    if (out) {
        *out = found;
    }
    return true;
}

// Bounded key-list classifier without duplicate validation: single ordered
// scan distinguishing the three elementary range failures. Too-many is
// checked first, then any negative element, then any over-max element. A
// list containing both a negative and an over-max key reports negative.
enum class KeyListFailure
{
    None,
    TooMany,
    Negative,
    Oversized
};

KeyListFailure classifyKeyList(const QList<int> &keys)
{
    if (keys.size() > SHORTCUT_MAX_KEYS_PER_TUPLE) {
        return KeyListFailure::TooMany;
    }
    for (int key : keys) {
        if (key < 0) {
            return KeyListFailure::Negative;
        }
    }
    for (int key : keys) {
        if (key > SHORTCUT_MAX_KEY_VALUE) {
            return KeyListFailure::Oversized;
        }
    }
    return KeyListFailure::None;
}

bool ensurePrivateDir(const QString &dirPath, QString *error)
{
    QDir dir;
    if (!dir.mkpath(dirPath)) {
        if (error) {
            *error = QStringLiteral("could not create the cleared shortcut directory");
        }
        return false;
    }
    // Owner-safe private permissions: user-owned mode 0700 exactly.
    const QByteArray encoded = dirPath.toLocal8Bit();
    struct stat st = {};
    if (::stat(encoded.constData(), &st) != 0) {
        if (error) {
            *error = QStringLiteral("could not stat the cleared shortcut directory");
        }
        return false;
    }
    if (st.st_uid != static_cast<uid_t>(::geteuid())) {
        if (error) {
            *error = QStringLiteral("cleared shortcut directory is not owned by this user");
        }
        return false;
    }
    if ((st.st_mode & 0077) != 0) {
        if (::chmod(encoded.constData(), 0700) != 0) {
            if (error) {
                *error = QStringLiteral("cleared shortcut directory is not private");
            }
            return false;
        }
    }
    return true;
}

bool ensurePrivateFile(const QString &filePath, QString *error)
{
    const QByteArray encoded = filePath.toLocal8Bit();
    struct stat st = {};
    if (::stat(encoded.constData(), &st) != 0) {
        return true; // absent leaf needs no chmod yet
    }
    if (st.st_uid != static_cast<uid_t>(::geteuid())) {
        if (error) {
            *error = QStringLiteral("cleared shortcut file is not owned by this user");
        }
        return false;
    }
    if ((st.st_mode & 0077) != 0) {
        if (::chmod(encoded.constData(), 0600) != 0) {
            if (error) {
                *error = QStringLiteral("cleared shortcut file is not private");
            }
            return false;
        }
    }
    return true;
}

void ensureKeySequenceMetaTypes()
{
    static bool registered = false;
    if (registered) {
        return;
    }
    qDBusRegisterMetaType<QKeySequence>();
    qDBusRegisterMetaType<QSet<QKeySequence>>();
    qDBusRegisterMetaType<QList<QKeySequence>>();
    qDBusRegisterMetaType<ShortcutMatchType>();
    registered = true;
}

QSet<QKeySequence> keySetFromInts(const QList<int> &keys)
{
    // Intentional order is retained by the caller in QList form; the QSet
    // itself is unordered by definition.
    QSet<QKeySequence> out;
    for (int key : keys) {
        out.insert(QKeySequence(key, 0, 0, 0));
    }
    return out;
}

QList<QKeySequence> keyListFromInts(const QList<int> &keys)
{
    // Installed kf6_org.kde.KGlobalAccel.xml annotates the v2 key inputs as
    // QList<QKeySequence> (a(ai) framing); the QSet form encodes identically
    // but the list matches the pinned interface annotation.
    QList<QKeySequence> out;
    out.reserve(keys.size());
    for (int key : keys) {
        out.append(QKeySequence(key, 0, 0, 0));
    }
    return out;
}

QSet<int> intSetFromKeySet(const QSet<QKeySequence> &keys)
{
    QSet<int> out;
    for (const QKeySequence &sequence : keys) {
        for (int i = 0; i < sequence.count(); ++i) {
            out.insert(sequence[static_cast<uint>(i)].toCombined());
        }
    }
    return out;
}

QSet<int> intSetFromKeyList(const QList<QKeySequence> &keys)
{
    QSet<int> out;
    for (const QKeySequence &sequence : keys) {
        for (int i = 0; i < sequence.count(); ++i) {
            out.insert(sequence[static_cast<uint>(i)].toCombined());
        }
    }
    return out;
}

QList<int> sortedIntsFromSet(const QSet<int> &set)
{
    QList<int> out(set.begin(), set.end());
    std::sort(out.begin(), out.end());
    return out;
}

} // namespace

const QList<ShortcutConflictRow> &shortcutConflictTable()
{
    static const QList<ShortcutConflictRow> table = {
        {shortcutFocusComponent(), shortcutFocusAction(), {SHORTCUT_META_L}, shortcutLockComponent(),
         shortcutLockAction(), {SHORTCUT_META_L}, shortcutResolutionRelocate(), {SHORTCUT_META_ESC},
         shortcutAuthorizedEscComponent(), shortcutAuthorizedEscAction()},
        {shortcutResizeUpComponent(), shortcutResizeUpAction(), {SHORTCUT_META_ALT_K},
          shortcutSwitchNextComponent(), shortcutSwitchNextAction(), {SHORTCUT_META_ALT_K},
          shortcutResolutionClear(), {}, {}, {}},
        {shortcutResizeRightComponent(), shortcutResizeRightAction(), {SHORTCUT_META_ALT_L},
          shortcutSwitchLastComponent(), shortcutSwitchLastAction(), {SHORTCUT_META_ALT_L},
          shortcutResolutionClear(), {}, {}, {}},
        {shortcutFloatComponent(), shortcutFloatAction(), {SHORTCUT_META_G},
          shortcutGridViewComponent(), shortcutGridViewAction(), {SHORTCUT_META_G},
          shortcutResolutionClear(), {}, {}, {}},
        {shortcutMaximizeComponent(), shortcutMaximizeAction(), {SHORTCUT_META_M},
          shortcutMonocleComponent(), shortcutMonocleAction(), {SHORTCUT_META_M},
          shortcutResolutionClear(), {}, {}, {}},
    };
    return table;
}

bool ShortcutReconciler::isAllowlisted(const QString &component, const QString &action)
{
    for (const ShortcutConflictRow &row : shortcutConflictTable()) {
        if ((component == row.projectComponent && action == row.projectAction)
            || (component == row.foreignComponent && action == row.foreignAction)) {
            return true;
        }
    }
    return false;
}

bool ShortcutReconciler::isProjectAction(const QString &component, const QString &action)
{
    const QList<ShortcutConflictRow> &table = shortcutConflictTable();
    for (const ShortcutConflictRow &row : table) {
        if (component == row.projectComponent && action == row.projectAction) {
            return true;
        }
    }
    return false;
}

bool ShortcutReconciler::isProjectOwned(const QString &component, const QString &action)
{
    // Own prefix, current and legacy alike (e.g. plasma-auto-tiler-toggle,
    // plasma-auto-tiler-float-toggle). Lock Session and foreign components
    // never match.
    return component == shortcutFocusComponent() && action.startsWith(QStringLiteral("plasma-auto-tiler-"));
}

bool ShortcutReconciler::isLockAction(const QString &component, const QString &action)
{
    return component == shortcutLockComponent() && action == shortcutLockAction();
}

QList<int> ShortcutReconciler::conflictingKeys(const QList<int> &active)
{
    const QList<int> required = relevantConflictKeys();
    QList<int> out;
    out.reserve(active.size());
    for (int key : active) {
        if (required.contains(key) && !out.contains(key)) {
            out.append(key);
        }
    }
    return out;
}

QList<int> ShortcutReconciler::remainderAfterClear(const QList<int> &active)
{
    const QList<int> required = relevantConflictKeys();
    QList<int> out;
    out.reserve(active.size());
    for (int key : active) {
        if (!required.contains(key)) {
            out.append(key);
        }
    }
    return out;
}

QList<int> ShortcutReconciler::focusPostKeys() { return shortcutConflictTable().at(0).projectPost; }
QList<int> ShortcutReconciler::lockPostFor(const QList<int> &lockPre)
{
    const QList<int> target = shortcutConflictTable().at(0).resolutionTarget;
    QList<int> replaced;
    replaced.reserve(lockPre.size());
    for (int key : lockPre) {
        if (key == SHORTCUT_META_L) {
            for (int t : target) replaced.append(t);
        } else {
            replaced.append(key);
        }
    }
    return dedupKeys(replaced);
}
QList<int> ShortcutReconciler::resizeUpPostKeys() { return shortcutConflictTable().at(1).projectPost; }
QList<int> ShortcutReconciler::resizeRightPostKeys() { return shortcutConflictTable().at(2).projectPost; }
QList<int> ShortcutReconciler::switchNextExpectedPre() { return shortcutConflictTable().at(1).foreignExpectedPre; }
QList<int> ShortcutReconciler::switchLastExpectedPre() { return shortcutConflictTable().at(2).foreignExpectedPre; }
QList<int> ShortcutReconciler::floatPostKeys() { return shortcutConflictTable().at(3).projectPost; }
QList<int> ShortcutReconciler::gridViewExpectedPre() { return shortcutConflictTable().at(3).foreignExpectedPre; }
QList<int> ShortcutReconciler::maximizePostKeys() { return shortcutConflictTable().at(4).projectPost; }
QList<int> ShortcutReconciler::monocleExpectedPre() { return shortcutConflictTable().at(4).foreignExpectedPre; }
QList<int> ShortcutReconciler::dedupKeys(const QList<int> &keys)
{
    QList<int> deduped;
    deduped.reserve(keys.size());
    for (int key : keys) {
        if (!deduped.contains(key)) {
            deduped.append(key);
        }
    }
    return deduped;
}

bool ShortcutReconciler::keysValid(const QList<int> &keys)
{
    if (keys.size() > SHORTCUT_MAX_KEYS_PER_TUPLE) {
        return false;
    }
    for (int key : keys) {
        if (key < 0 || key > SHORTCUT_MAX_KEY_VALUE) {
            return false;
        }
    }
    return true;
}

bool ShortcutReconciler::stringValid(const QString &value)
{
    return !value.isEmpty() && value.size() <= SHORTCUT_MAX_STRING_LEN;
}

bool ShortcutReconciler::cosmeticValid(const QString &value)
{
    return value.size() <= SHORTCUT_MAX_STRING_LEN;
}

bool ShortcutReconciler::keyedFieldsValid(const QString &action, const QString &friendly, const QString &compUnique,
                                          const QString &compFriendly, const QString &contextUnique,
                                          const QString &contextFriendly, const QList<int> &active,
                                          const QList<int> &defaults, QString *fieldError)
{
    auto fail = [&](const QString &suffix) {
        if (fieldError) {
            *fieldError = suffix;
        }
        return false;
    };
    // Identity strict, each elementary predicate distinct: empty vs
    // oversized per field, checked action then component. Direct
    // isEmpty/size checks (not stringValid) so the branch identifies the
    // field variation without duplicate validation.
    if (action.isEmpty()) {
        return fail(QStringLiteral("empty action"));
    }
    if (action.size() > SHORTCUT_MAX_STRING_LEN) {
        return fail(QStringLiteral("oversized action"));
    }
    if (compUnique.isEmpty()) {
        return fail(QStringLiteral("empty component"));
    }
    if (compUnique.size() > SHORTCUT_MAX_STRING_LEN) {
        return fail(QStringLiteral("oversized component"));
    }
    // Cosmetic empty allowed (real captures leave friendly empty); only the
    // length bound applies, one distinct token per field in fixed order.
    if (friendly.size() > SHORTCUT_MAX_STRING_LEN) {
        return fail(QStringLiteral("oversized friendly"));
    }
    if (compFriendly.size() > SHORTCUT_MAX_STRING_LEN) {
        return fail(QStringLiteral("oversized component friendly"));
    }
    if (contextUnique.size() > SHORTCUT_MAX_STRING_LEN) {
        return fail(QStringLiteral("oversized context unique"));
    }
    if (contextFriendly.size() > SHORTCUT_MAX_STRING_LEN) {
        return fail(QStringLiteral("oversized context friendly"));
    }
    // Keys strict, each elementary range failure distinct via the single
    // ordered classifier (too-many, then negative, then oversized).
    switch (classifyKeyList(active)) {
    case KeyListFailure::TooMany:
        return fail(QStringLiteral("too many active keys"));
    case KeyListFailure::Negative:
        return fail(QStringLiteral("negative active key"));
    case KeyListFailure::Oversized:
        return fail(QStringLiteral("oversized active key"));
    case KeyListFailure::None:
        break;
    }
    switch (classifyKeyList(defaults)) {
    case KeyListFailure::TooMany:
        return fail(QStringLiteral("too many default keys"));
    case KeyListFailure::Negative:
        return fail(QStringLiteral("negative default key"));
    case KeyListFailure::Oversized:
        return fail(QStringLiteral("oversized default key"));
    case KeyListFailure::None:
        break;
    }
    return true;
}

bool ShortcutReconciler::appendComponentPath(const QString &path, bool fromArgumentArray, QStringList *parsed,
                                             QString *error)
{
    if (path.isEmpty()) {
        if (error) {
            *error = fromArgumentArray
                ? QStringLiteral("unexpected allComponents reply: empty object path in argument array")
                : QStringLiteral("unexpected allComponents reply: empty object path in typed list");
        }
        return false;
    }
    if (parsed) {
        parsed->append(path);
    }
    return true;
}

bool ShortcutReconciler::checkTupleAppendBound(int size, TupleAppendBound kind, QString *error)
{
    if (size <= SHORTCUT_MAX_TUPLES) {
        return true;
    }
    if (error) {
        switch (kind) {
        case TupleAppendBound::ByKeyWire:
            *error = QStringLiteral("unexpected globalShortcutsByKey reply: too many wire holders");
            break;
        case TupleAppendBound::AllInfosWire:
            *error = QStringLiteral("unexpected allShortcutInfos reply: too many wire tuples");
            break;
        case TupleAppendBound::Collected:
            *error = QStringLiteral("unexpected allShortcutInfos reply: too many collected tuples");
            break;
        }
    }
    return false;
}

bool ShortcutReconciler::checkOccupancyKeyRange(int key, QString *error)
{
    if (key < 0) {
        if (error) {
            *error = QStringLiteral("unexpected globalShortcutsByKey reply: negative occupancy key");
        }
        return false;
    }
    if (key == 0) {
        if (error) {
            *error = QStringLiteral("unexpected globalShortcutsByKey reply: non-positive occupancy key");
        }
        return false;
    }
    if (key > SHORTCUT_MAX_KEY_VALUE) {
        if (error) {
            *error = QStringLiteral("unexpected globalShortcutsByKey reply: oversized occupancy key");
        }
        return false;
    }
    return true;
}

bool ShortcutReconciler::decodeKeySequenceSlots(const QList<int> &slotValues, QKeySequence *out)
{
    if (slotValues.size() != 4) {
        return false;
    }
    for (int slot : slotValues) {
        if (slot < 0 || slot > SHORTCUT_MAX_KEY_VALUE) {
            return false;
        }
    }
    if (out) {
        *out = QKeySequence(slotValues.at(0), slotValues.at(1), slotValues.at(2), slotValues.at(3));
    }
    return true;
}

bool ShortcutReconciler::decodeSetterReplySlotSets(const QList<QList<int>> &slotGroups, QSet<QKeySequence> *out)
{
    if (slotGroups.size() > SHORTCUT_MAX_KEYS_PER_TUPLE) {
        return false;
    }
    QSet<QKeySequence> set;
    for (const QList<int> &group : slotGroups) {
        QKeySequence decoded;
        if (!decodeKeySequenceSlots(group, &decoded)) {
            return false;
        }
        set.insert(decoded);
    }
    if (out) {
        *out = set;
    }
    return true;
}

bool ShortcutReconciler::parseDefaultShortcutKeysReply(QDBusMessage::MessageType replyType,
                                                       const QString &replySignature,
                                                       const QList<QVariant> &replyArgs, QList<int> *defaults,
                                                       QString *error)
{
    auto fail = [&](const QString &message) {
        if (error) {
            *error = message;
        }
        return false;
    };
    // Exact transport only (installed kf6_org.kde.KGlobalAccel.xml:123-127):
    // ReplyMessage with signature "a(ai)" carrying the default key list.
    // Ordered type then signature then arity; any other shape fails closed.
    if (replyType != QDBusMessage::ReplyMessage) {
        return fail(QStringLiteral("unexpected defaultShortcutKeys reply: wrong message type"));
    }
    if (replySignature != QStringLiteral("a(ai)")) {
        return fail(QStringLiteral("unexpected defaultShortcutKeys reply: wrong signature"));
    }
    if (replyArgs.size() != 1) {
        return fail(QStringLiteral("unexpected defaultShortcutKeys reply: wrong arity"));
    }
    const QVariant first = replyArgs.at(0);
    QSet<int> parsed;
    if (first.userType() == qMetaTypeId<QSet<QKeySequence>>()) {
        const QSet<QKeySequence> set = first.value<QSet<QKeySequence>>();
        if (set.size() > SHORTCUT_MAX_KEYS_PER_TUPLE) {
            return fail(QStringLiteral("unexpected defaultShortcutKeys reply: did not return expected keys"));
        }
        parsed = intSetFromKeySet(set);
    } else if (first.userType() == qMetaTypeId<QList<QKeySequence>>()) {
        const QList<QKeySequence> list = first.value<QList<QKeySequence>>();
        if (list.size() > SHORTCUT_MAX_KEYS_PER_TUPLE) {
            return fail(QStringLiteral("unexpected defaultShortcutKeys reply: did not return expected keys"));
        }
        parsed = intSetFromKeyList(list);
    } else if (first.canConvert<QDBusArgument>()) {
        const QDBusArgument arg = first.value<QDBusArgument>();
        if (arg.currentType() != QDBusArgument::ArrayType) {
            return fail(QStringLiteral("unexpected defaultShortcutKeys reply: wrong array framing"));
        }
        QList<QList<int>> slotGroups;
        bool framingOk = true;
        arg.beginArray();
        while (!arg.atEnd() && framingOk) {
            if (arg.currentType() != QDBusArgument::StructureType) {
                framingOk = false;
                break;
            }
            arg.beginStructure();
            if (arg.currentType() != QDBusArgument::ArrayType) {
                framingOk = false;
                arg.endStructure();
                break;
            }
            arg.beginArray();
            QList<int> values;
            int innerCount = 0;
            while (!arg.atEnd()) {
                if (arg.currentType() != QDBusArgument::BasicType) {
                    framingOk = false;
                    break;
                }
                int value = 0;
                arg >> value;
                if (innerCount < 5) {
                    values.append(value);
                }
                ++innerCount;
            }
            if (!framingOk) {
                arg.endArray();
                arg.endStructure();
                break;
            }
            if (innerCount != 4) {
                framingOk = false;
                arg.endArray();
                arg.endStructure();
                break;
            }
            slotGroups.append(values);
            if (slotGroups.size() > SHORTCUT_MAX_KEYS_PER_TUPLE) {
                framingOk = false;
                arg.endArray();
                arg.endStructure();
                break;
            }
            arg.endArray();
            arg.endStructure();
        }
        arg.endArray();
        if (!framingOk) {
            return fail(QStringLiteral("unexpected defaultShortcutKeys reply: did not return expected keys"));
        }
        QSet<QKeySequence> decoded;
        if (!decodeSetterReplySlotSets(slotGroups, &decoded)) {
            return fail(QStringLiteral("unexpected defaultShortcutKeys reply: did not return expected keys"));
        }
        parsed = intSetFromKeySet(decoded);
    } else {
        return fail(QStringLiteral("unexpected defaultShortcutKeys reply: wrong variant shape"));
    }
    const QList<int> out = sortedIntsFromSet(parsed);
    if (!keysValid(out)) {
        return fail(QStringLiteral("unexpected defaultShortcutKeys reply: did not return expected keys"));
    }
    if (defaults) {
        *defaults = out;
    }
    return true;
}

bool ShortcutReconciler::parseSetForeignShortcutKeysReply(QDBusMessage::MessageType replyType,
                                                          const QString &replySignature,
                                                          const QList<QVariant> &replyArgs, QString *error)
{
    auto fail = [&](const QString &message) {
        if (error) {
            *error = message;
        }
        return false;
    };
    // Exact void transport only (installed kf6_org.kde.KGlobalAccel.xml:145-149):
    // ReplyMessage with empty signature and zero args. Any payload fails closed.
    if (replyType != QDBusMessage::ReplyMessage) {
        return fail(QStringLiteral("unexpected setForeignShortcutKeys reply: wrong message type"));
    }
    if (replySignature != QString()) {
        return fail(QStringLiteral("unexpected setForeignShortcutKeys reply: wrong signature"));
    }
    if (!replyArgs.isEmpty()) {
        return fail(QStringLiteral("unexpected setForeignShortcutKeys reply: wrong arity"));
    }
    return true;
}

bool ShortcutReconciler::foreignReadbackMatches(const QList<int> &expected, const QList<int> &actual)
{
    // Void setter has no reply keys: the fresh shortcutKeys readback must
    // confirm the exact set. Order-insensitive set comparison; duplicates
    // collapse as the live QSet reply has no order.
    return QSet<int>(expected.begin(), expected.end()) == QSet<int>(actual.begin(), actual.end());
}

bool ShortcutReconciler::uniqueNameValid(const QString &owner)
{
    // Strict D-Bus unique name: colon followed by dot-separated integers.
    static const QRegularExpression pattern(QStringLiteral("^:[0-9]+(\\.[0-9]+)+$"));
    if (owner.size() > SHORTCUT_MAX_STRING_LEN) {
        return false;
    }
    return pattern.match(owner).hasMatch();
}

bool ShortcutReconciler::introspectionContractValid(const QString &xml)
{
    if (xml.isEmpty() || xml.size() > 1048576) {
        return false;
    }
    // Live Plasma 6.7.4 contract: exactly one
    // org.kde.KGlobalAccel/setShortcutKeys method with four args.
    // Qt D-Bus introspection emits the reply first (document order) with
    // method-level annotations interleaved after their corresponding args:
    //   a(ai) reply (out) + Out0, as actionId (in),
    //   a(ai) keys (in) + In1, u flags (in).
    // The logical in-last order (as, a(ai), u, then a(ai) out, annotations
    // trailing) is also accepted for compatibility; any other permutation
    // is rejected.
    // Omitted input direction is accepted only because the D-Bus
    // introspection default is "in"; the reply must be explicit "out".
    // Proven only as exact method-level annotations
    // org.qtproject.QtDBus.QtTypeName.In1 and ...Out0 with
    // QSet<QKeySequence>: arg-nested annotations are unproven and ignored,
    // and substring key matches (e.g. In10) never count.
    // No substring fallback: the structured parse is authoritative.
    // Extra overloads are ambiguity and fail.
    struct ParsedArg
    {
        QString type;
        QString direction;
    };
    QXmlStreamReader reader(xml);
    bool inTargetInterface = false;
    bool inTargetMethod = false;
    bool inMethodArg = false;
    int methodCount = 0;
    QList<ParsedArg> firstArgs;
    QMap<QString, QString> firstMethodAnnotations;
    QList<ParsedArg> curArgs;
    QMap<QString, QString> curMethodAnnotations;
    ParsedArg curArg;
    while (!reader.atEnd()) {
        reader.readNext();
        if (reader.isStartElement()) {
            if (reader.name() == QStringLiteral("interface")
                && reader.attributes().value(QStringLiteral("name")) == shortcutInterface()) {
                inTargetInterface = true;
            } else if (inTargetInterface && reader.name() == QStringLiteral("method")
                       && reader.attributes().value(QStringLiteral("name")) == shortcutSetMethod()) {
                inTargetMethod = true;
                inMethodArg = false;
                curArgs.clear();
                curMethodAnnotations.clear();
                curArg = ParsedArg{};
            } else if (inTargetMethod && reader.name() == QStringLiteral("arg")) {
                curArg.type = reader.attributes().value(QStringLiteral("type")).toString();
                curArg.direction = reader.attributes().value(QStringLiteral("direction")).toString();
                inMethodArg = true;
            } else if (inTargetMethod && !inMethodArg && reader.name() == QStringLiteral("annotation")) {
                const QString name = reader.attributes().value(QStringLiteral("name")).toString();
                const QString value = reader.attributes().value(QStringLiteral("value")).toString();
                curMethodAnnotations.insert(name, value);
            }
        } else if (reader.isEndElement()) {
            if (reader.name() == QStringLiteral("arg") && inTargetMethod && inMethodArg) {
                curArgs.append(curArg);
                curArg = ParsedArg{};
                inMethodArg = false;
            } else if (reader.name() == QStringLiteral("method") && inTargetMethod) {
                ++methodCount;
                if (methodCount == 1) {
                    firstArgs = curArgs;
                    firstMethodAnnotations = curMethodAnnotations;
                }
                inTargetMethod = false;
                inMethodArg = false;
            } else if (reader.name() == QStringLiteral("interface") && inTargetInterface) {
                inTargetInterface = false;
            }
        }
    }
    if (reader.hasError()) {
        return false;
    }
    if (methodCount != 1) {
        return false;
    }
    if (firstArgs.size() != 4) {
        return false;
    }
    auto isIn = [](const QString &direction) {
        return direction == QStringLiteral("in") || direction.isEmpty();
    };
    auto isOut = [](const QString &direction) {
        return direction == QStringLiteral("out");
    };
    // D-Bus default direction is "in", so an omitted input direction is
    // that default; anything else on an input is malformed. The reply
    // must be explicit "out". Exactly two document orders are accepted:
    // Qt out-first (live) and logical in-last (compatible).
    const bool inLastOrder = firstArgs.at(0).type == QStringLiteral("as") && isIn(firstArgs.at(0).direction)
        && firstArgs.at(1).type == QStringLiteral("a(ai)") && isIn(firstArgs.at(1).direction)
        && firstArgs.at(2).type == QStringLiteral("u") && isIn(firstArgs.at(2).direction)
        && firstArgs.at(3).type == QStringLiteral("a(ai)") && isOut(firstArgs.at(3).direction);
    const bool outFirstOrder = firstArgs.at(0).type == QStringLiteral("a(ai)") && isOut(firstArgs.at(0).direction)
        && firstArgs.at(1).type == QStringLiteral("as") && isIn(firstArgs.at(1).direction)
        && firstArgs.at(2).type == QStringLiteral("a(ai)") && isIn(firstArgs.at(2).direction)
        && firstArgs.at(3).type == QStringLiteral("u") && isIn(firstArgs.at(3).direction);
    if (!inLastOrder && !outFirstOrder) {
        return false;
    }
    auto hasExactKeySet = [&](const QString &name) {
        const auto it = firstMethodAnnotations.constFind(name);
        return it != firstMethodAnnotations.constEnd() && *it == QStringLiteral("QSet<QKeySequence>");
    };
    if (!hasExactKeySet(QStringLiteral("org.qtproject.QtDBus.QtTypeName.In1"))
        || !hasExactKeySet(QStringLiteral("org.qtproject.QtDBus.QtTypeName.Out0"))) {
        return false;
    }
    return true;
}

bool ShortcutReconciler::parseAllComponentsReply(QDBusMessage::MessageType replyType, const QString &replySignature,
                                                 const QList<QVariant> &replyArgs, QStringList *components,
                                                 QString *error)
{
    auto fail = [&](const QString &message) {
        if (error) {
            *error = message;
        }
        return false;
    };
    // Exact transport only: a ReplyMessage with signature "ao" carrying an
    // object-path array. Both Qt representations of the exact ao array are
    // accepted: a read-mode QDBusArgument array of object paths (as produced
    // by live D-Bus demarshalling) or a typed QList<QDBusObjectPath>.
    // QStringList ("as") or any other shape is rejected; no fallback.
    if (replyType != QDBusMessage::ReplyMessage) {
        return fail(QStringLiteral("unexpected allComponents reply: wrong message type"));
    }
    if (replySignature != QStringLiteral("ao")) {
        return fail(QStringLiteral("unexpected allComponents reply: wrong signature"));
    }
    if (replyArgs.size() != 1) {
        return fail(QStringLiteral("unexpected allComponents reply: wrong arity"));
    }
    const QVariant first = replyArgs.at(0);
    QStringList parsed;
    if (first.userType() == qMetaTypeId<QList<QDBusObjectPath>>()) {
        const QList<QDBusObjectPath> paths = first.value<QList<QDBusObjectPath>>();
        for (const QDBusObjectPath &path : paths) {
            QString pathError;
            if (!appendComponentPath(path.path(), false, &parsed, &pathError)) {
                return fail(pathError);
            }
        }
    } else if (first.canConvert<QDBusArgument>()) {
        const QDBusArgument arg = first.value<QDBusArgument>();
        if (arg.currentType() != QDBusArgument::ArrayType) {
            return fail(QStringLiteral("unexpected allComponents reply: wrong array framing"));
        }
        arg.beginArray();
        while (!arg.atEnd()) {
            QDBusObjectPath path;
            arg >> path;
            QString pathError;
            if (!appendComponentPath(path.path(), true, &parsed, &pathError)) {
                return fail(pathError);
            }
        }
        arg.endArray();
    } else {
        return fail(QStringLiteral("unexpected allComponents reply: wrong variant shape"));
    }
    if (parsed.size() > 1024) {
        return fail(QStringLiteral("unexpected allComponents reply: too many components"));
    }
    if (components) {
        *components = parsed;
    }
    return true;
}

QList<int> ShortcutReconciler::relevantConflictKeys()
{
    return {SHORTCUT_META_L, SHORTCUT_META_ESC, SHORTCUT_META_ALT_K, SHORTCUT_META_ALT_L, SHORTCUT_META_G,
            SHORTCUT_META_M};
}

QString ShortcutReconciler::keyDisplayName(int key)
{
    if (key == SHORTCUT_META_L) {
        return QStringLiteral("Meta+L");
    }
    if (key == SHORTCUT_META_ESC) {
        return QStringLiteral("Meta+Esc");
    }
    if (key == SHORTCUT_META_ALT_K) {
        return QStringLiteral("Meta+Alt+K");
    }
    if (key == SHORTCUT_META_ALT_L) {
        return QStringLiteral("Meta+Alt+L");
    }
    if (key == SHORTCUT_META_G) {
        return QStringLiteral("Meta+G");
    }
    if (key == SHORTCUT_META_M) {
        return QStringLiteral("Meta+M");
    }
    return QStringLiteral("key %1").arg(key);
}

QString ShortcutReconciler::keysDisplay(const QList<int> &keys)
{
    if (keys.isEmpty()) {
        return QStringLiteral("none");
    }
    QStringList parts;
    parts.reserve(keys.size());
    for (int key : keys) {
        parts.append(QString::number(key));
    }
    return parts.join(QStringLiteral(","));
}

bool ShortcutReconciler::isAuthorizedDisplacement(int key, const QString &component, const QString &action)
{
    // Row-owned target exception: never part of the write allowlist and
    // never a permission to rebind System Monitor itself.
    for (const ShortcutConflictRow &row : shortcutConflictTable()) {
        if (row.resolutionTarget.contains(key) && component == row.authorizedTargetComponent
            && action == row.authorizedTargetAction) {
            return true;
        }
    }
    return false;
}

bool ShortcutReconciler::isHolderExempt(const QString &component, const QString &action, int key)
{
    // Single shared policy for the status keyed check and the backend
    // holder scan. Project rows and Lock Session own their chords; the
    // authorized System Monitor Meta+Esc displacement is user-approved.
    // Known compiled foreign holders (Grid View, Switcher, Monocle) and
    // unknown holders are never exempt.
    if (isProjectAction(component, action) || isLockAction(component, action)) {
        return true;
    }
    return isAuthorizedDisplacement(key, component, action);
}

bool ShortcutReconciler::holdersFromInfoFields(const QList<ShortcutInfoFields> &infos,
                                               QList<ShortcutKeyHolder> *holders, QString *error)
{
    auto fail = [&](const QString &message) {
        if (error) {
            *error = message;
        }
        return false;
    };
    QList<ShortcutKeyHolder> parsed;
    for (const ShortcutInfoFields &info : infos) {
        // Shared pure field validator: identity strict, cosmetic allows
        // empty with length bound, keys strict.
        QString fieldError;
        if (!keyedFieldsValid(info.action, info.friendly, info.compUnique, info.compFriendly, info.contextUnique,
                               info.contextFriendly, info.active, info.defaults, &fieldError)) {
            return fail(QStringLiteral("unexpected globalShortcutsByKey reply: ") + fieldError);
        }
        ShortcutKeyHolder holder;
        holder.component = info.compUnique;
        holder.action = info.action;
        holder.active = info.active;
        holder.defaults = info.defaults;
        parsed.append(holder);
        if (parsed.size() > SHORTCUT_MAX_TUPLES) {
            return fail(QStringLiteral("unexpected globalShortcutsByKey reply: too many holders"));
        }
    }
    if (holders) {
        *holders = parsed;
    }
    return true;
}

bool ShortcutReconciler::tuplesFromInfoFields(const QList<ShortcutInfoFields> &infos, QList<ShortcutTuple> *tuples,
                                              QString *error)
{
    auto fail = [&](const QString &message) {
        if (error) {
            *error = message;
        }
        return false;
    };
    QList<ShortcutTuple> parsed;
    for (const ShortcutInfoFields &info : infos) {
        QString fieldError;
        if (!keyedFieldsValid(info.action, info.friendly, info.compUnique, info.compFriendly, info.contextUnique,
                               info.contextFriendly, info.active, info.defaults, &fieldError)) {
            return fail(QStringLiteral("unexpected allShortcutInfos reply: ") + fieldError);
        }
        ShortcutTuple tuple;
        tuple.component = info.compUnique;
        tuple.action = info.action;
        tuple.componentFriendly = info.compFriendly;
        tuple.friendly = info.friendly;
        tuple.active = info.active;
        parsed.append(tuple);
        if (parsed.size() > SHORTCUT_MAX_TUPLES) {
            return fail(QStringLiteral("unexpected allShortcutInfos reply: too many tuples"));
        }
    }
    if (tuples) {
        *tuples = parsed;
    }
    return true;
}

bool ShortcutReconciler::parseGlobalShortcutsByKeyReply(QDBusMessage::MessageType replyType,
                                                        const QString &replySignature,
                                                        const QList<QVariant> &replyArgs,
                                                        QList<ShortcutKeyHolder> *holders, QString *error)
{
    auto fail = [&](const QString &message) {
        if (error) {
            *error = message;
        }
        return false;
    };
    // Exact transport only: ReplyMessage with signature "a(ssssssaiai)"
    // carrying KGlobalShortcutInfo structs (6 strings + ai + ai). Any other
    // type, signature, arity, or shape fails closed; no fallback.
    if (replyType != QDBusMessage::ReplyMessage) {
        return fail(QStringLiteral("unexpected globalShortcutsByKey reply: wrong message type"));
    }
    if (replySignature != QStringLiteral("a(ssssssaiai)")) {
        return fail(QStringLiteral("unexpected globalShortcutsByKey reply: wrong signature"));
    }
    if (replyArgs.size() != 1) {
        return fail(QStringLiteral("unexpected globalShortcutsByKey reply: wrong arity"));
    }
    const QVariant first = replyArgs.at(0);
    if (!first.canConvert<QDBusArgument>()) {
        return fail(QStringLiteral("unexpected globalShortcutsByKey reply: wrong variant shape"));
    }
    // Const read-mode access: non-const beginStructure/endStructure would
    // select the write overloads and fail on a read-only argument.
    const QDBusArgument arg = first.value<QDBusArgument>();
    if (arg.currentType() != QDBusArgument::ArrayType) {
        return fail(QStringLiteral("unexpected globalShortcutsByKey reply: wrong array framing"));
    }
    QList<ShortcutInfoFields> infos;
    arg.beginArray();
    while (!arg.atEnd()) {
        ShortcutInfoFields info;
        arg >> info;
        infos.append(info);
        // Fail-fast wire bound before further payload allocation: shared
        // predicate retains the exact wire token for direct use.
        QString boundError;
        if (!checkTupleAppendBound(infos.size(), TupleAppendBound::ByKeyWire, &boundError)) {
            return fail(boundError);
        }
    }
    arg.endArray();
    return holdersFromInfoFields(infos, holders, error);
}

bool ShortcutReconciler::parseGlobalShortcutAvailableReply(QDBusMessage::MessageType replyType,
                                                           const QString &replySignature,
                                                           const QList<QVariant> &replyArgs, bool *available,
                                                           QString *error)
{
    auto fail = [&](const QString &message) {
        if (error) {
            *error = message;
        }
        return false;
    };
    // Exact transport only: ReplyMessage with signature "b" carrying one bool.
    if (replyType != QDBusMessage::ReplyMessage) {
        return fail(QStringLiteral("unexpected globalShortcutAvailable reply: wrong message type"));
    }
    if (replySignature != QStringLiteral("b")) {
        return fail(QStringLiteral("unexpected globalShortcutAvailable reply: wrong signature"));
    }
    if (replyArgs.size() != 1) {
        return fail(QStringLiteral("unexpected globalShortcutAvailable reply: wrong arity"));
    }
    const QVariant first = replyArgs.at(0);
    if (first.userType() != QMetaType::Bool) {
        return fail(QStringLiteral("unexpected globalShortcutAvailable reply: wrong variant shape"));
    }
    if (available) {
        *available = first.toBool();
    }
    return true;
}

KeyedOccupancyResult ShortcutReconciler::checkKeyedForeignOccupancyDetailed(ShortcutStore *store)
{
    KeyedOccupancyResult result;
    result.status = KeyedOccupancy::Clear;
    auto unavailable = [&](const QString &message) {
        result.status = KeyedOccupancy::Unavailable;
        result.detail = message;
        return result;
    };
    auto conflict = [&](const QString &message) {
        result.status = KeyedOccupancy::Conflict;
        result.detail = message;
        return result;
    };
    if (!store) {
        return unavailable(QStringLiteral("reconciler is not configured"));
    }
    const QList<int> keys = relevantConflictKeys();
    for (int key : keys) {
        // Disjoint single-key range checks without duplicate validation:
        // negative first, then zero (non-positive), then over-max. The
        // list-bound predicate is unreachable for a single element and has
        // no token here; it is covered by the list classifiers elsewhere.
        // Shared helper preserves the same order and exact occupancy tokens.
        QString keyError;
        if (!checkOccupancyKeyRange(key, &keyError)) {
            return unavailable(keyError);
        }
        QList<ShortcutKeyHolder> holders;
        QString storeError;
        if (!store->shortcutsByKey(key, &holders, &storeError)) {
            return unavailable(storeError.isEmpty() ? QStringLiteral("globalShortcutsByKey call failed") : storeError);
        }
        bool available = false;
        if (!store->shortcutAvailable(key, QString(), &available, &storeError)) {
            return unavailable(storeError.isEmpty() ? QStringLiteral("globalShortcutAvailable call failed") : storeError);
        }
        if (holders.size() > SHORTCUT_MAX_TUPLES) {
            return unavailable(QStringLiteral("unexpected globalShortcutsByKey reply: too many occupancy holders"));
        }
        for (const ShortcutKeyHolder &holder : holders) {
            // Holder identity strict, each elementary predicate distinct:
            // component empty/oversized then action empty/oversized. Direct
            // checks so the branch identifies the field without duplicate
            // validation. The "holder" qualifier keeps these full tokens
            // distinct from the shared-seam field tokens above.
            if (holder.component.isEmpty()) {
                return unavailable(QStringLiteral("unexpected globalShortcutsByKey reply: empty holder component"));
            }
            if (holder.component.size() > SHORTCUT_MAX_STRING_LEN) {
                return unavailable(QStringLiteral("unexpected globalShortcutsByKey reply: oversized holder component"));
            }
            if (holder.action.isEmpty()) {
                return unavailable(QStringLiteral("unexpected globalShortcutsByKey reply: empty holder action"));
            }
            if (holder.action.size() > SHORTCUT_MAX_STRING_LEN) {
                return unavailable(QStringLiteral("unexpected globalShortcutsByKey reply: oversized holder action"));
            }
            switch (classifyKeyList(holder.active)) {
            case KeyListFailure::TooMany:
                return unavailable(
                    QStringLiteral("unexpected globalShortcutsByKey reply: too many holder active keys"));
            case KeyListFailure::Negative:
                return unavailable(
                    QStringLiteral("unexpected globalShortcutsByKey reply: negative holder active key"));
            case KeyListFailure::Oversized:
                return unavailable(
                    QStringLiteral("unexpected globalShortcutsByKey reply: oversized holder active key"));
            case KeyListFailure::None:
                break;
            }
            switch (classifyKeyList(holder.defaults)) {
            case KeyListFailure::TooMany:
                return unavailable(
                    QStringLiteral("unexpected globalShortcutsByKey reply: too many holder default keys"));
            case KeyListFailure::Negative:
                return unavailable(
                    QStringLiteral("unexpected globalShortcutsByKey reply: negative holder default key"));
            case KeyListFailure::Oversized:
                return unavailable(
                    QStringLiteral("unexpected globalShortcutsByKey reply: oversized holder default key"));
            case KeyListFailure::None:
                break;
            }
            if (isHolderExempt(holder.component, holder.action, key)) {
                continue;
            }
            return conflict(QStringLiteral("refusing to apply: %1 is claimed by %2/%3")
                                .arg(keyDisplayName(key), holder.component, holder.action));
        }
        // Whole-key consistency, fail closed both directions:
        // globalShortcutAvailable(key, "") reports whole-key availability,
        // so empty holders must report available and non-empty holders
        // must report unavailable. Exempt (project/lock/authorized)
        // holders count as occupying the key, so they keep the
        // non-empty/unavailable expectation and stay Clear after the
        // skips above.
        if (holders.isEmpty() != available) {
            if (holders.isEmpty()) {
                return unavailable(QStringLiteral(
                    "unexpected globalShortcutAvailable reply: empty holders report unavailable"));
            }
            return unavailable(QStringLiteral(
                "unexpected globalShortcutAvailable reply: occupied holders report available"));
        }
    }
    return result;
}

bool ShortcutReconciler::checkKeyedForeignOccupancy(ShortcutStore *store, QString *error)
{
    const KeyedOccupancyResult detailed = checkKeyedForeignOccupancyDetailed(store);
    if (detailed.status != KeyedOccupancy::Clear) {
        if (error) {
            *error = detailed.detail;
        }
        return false;
    }
    return true;
}

bool ShortcutReconciler::clearedActionsPathSafe(const QString &path, QString *error)
{
    if (path.isEmpty()) {
        if (error) {
            *error = QStringLiteral("cleared shortcut path is empty; refusing CWD fallback");
        }
        return false;
    }
    if (!QDir::isAbsolutePath(path)) {
        if (error) {
            *error = QStringLiteral("cleared shortcut path must be absolute; refusing CWD fallback");
        }
        return false;
    }
    const QFileInfo leaf(path);
    // Refuse symlink or nonregular leaf without following it.
    {
        struct stat st = {};
        const QByteArray encoded = path.toLocal8Bit();
        if (::lstat(encoded.constData(), &st) == 0) {
            if (S_ISLNK(st.st_mode)) {
                if (error) {
                    *error = QStringLiteral("cleared shortcut path must not be a symlink");
                }
                return false;
            }
            if (!S_ISREG(st.st_mode)) {
                if (error) {
                    *error = QStringLiteral("cleared shortcut path must be a regular file");
                }
                return false;
            }
            if (st.st_uid != static_cast<uid_t>(::geteuid())) {
                if (error) {
                    *error = QStringLiteral("cleared shortcut file is not owned by this user");
                }
                return false;
            }
            if ((st.st_mode & 0077) != 0) {
                if (error) {
                    *error = QStringLiteral("cleared shortcut file is not private");
                }
                return false;
            }
            Q_UNUSED(leaf);
        }
    }
    // The direct parent directory is the writable trust boundary. It cannot
    // be foreign-owned or writable by group/other; all ancestors are still
    // checked for symlinks below.
    QDir parent = QFileInfo(path).dir();
    {
        struct stat st = {};
        const QByteArray encoded = parent.path().toLocal8Bit();
        if (::lstat(encoded.constData(), &st) == 0) {
            if (S_ISLNK(st.st_mode) || !S_ISDIR(st.st_mode) || st.st_uid != static_cast<uid_t>(::geteuid())
                || (st.st_mode & 0022) != 0) {
                if (error) {
                    *error = QStringLiteral("cleared shortcut parent directory is unsafe");
                }
                return false;
            }
        } else if (errno != ENOENT) {
            if (error) {
                *error = QStringLiteral("cleared shortcut parent directory is unavailable");
            }
            return false;
        }
    }
    // Refuse unsafe symlink in any parent component (no following).
    while (!parent.path().isEmpty() && parent.path() != QStringLiteral("/") && parent.path() != QStringLiteral(".")) {
        struct stat st = {};
        const QByteArray encoded = parent.path().toLocal8Bit();
        if (::lstat(encoded.constData(), &st) == 0) {
            if (S_ISLNK(st.st_mode)) {
                if (error) {
                    *error = QStringLiteral("cleared shortcut parent path must not contain a symlink");
                }
                return false;
            }
        }
        const QString next = QFileInfo(parent.path()).dir().path();
        if (next == parent.path()) {
            break;
        }
        parent = QDir(next);
    }
    return true;
}

bool KGlobalAccelStore::checkSetterContract(QString *error)
{
    // Introspection-proven exact setter contract on live Plasma 6.7.4:
    // method setShortcutKeys with split args as,a(ai),u -> a(ai) where the
    // keys input and the reply carry QSet<QKeySequence> annotations.
    QDBusMessage call = QDBusMessage::createMethodCall(
        shortcutService(), shortcutPath(), QStringLiteral("org.freedesktop.DBus.Introspectable"), QStringLiteral("Introspect"));
    const QDBusMessage reply = QDBusConnection::sessionBus().call(call);
    if (reply.type() != QDBusMessage::ReplyMessage || reply.arguments().size() != 1) {
        if (error) {
            *error = QStringLiteral("KGlobalAccel introspection did not return a strict reply");
        }
        return false;
    }
    const QString xml = reply.arguments().at(0).toString();
    if (!ShortcutReconciler::introspectionContractValid(xml)) {
        if (error) {
            *error = QStringLiteral(
                "KGlobalAccel setShortcutKeys is absent or does not expose exactly as,a(ai),u -> a(ai) with QSet<QKeySequence>");
        }
        return false;
    }
    return true;
}

bool KGlobalAccelStore::tryPinOwner(QString &pinned, const QString &candidate, QString *error)
{
    if (!ShortcutReconciler::uniqueNameValid(candidate)) {
        if (error) {
            *error = QStringLiteral("KGlobalAccel owner is not a unique name");
        }
        return false;
    }
    if (pinned.isEmpty()) {
        pinned = candidate;
        return true;
    }
    if (pinned != candidate) {
        if (error) {
            *error = QStringLiteral("KGlobalAccel service owner drifted");
        }
        return false;
    }
    return true;
}

bool KGlobalAccelStore::resolveOwnerReply(bool ownerValid, const QString &ownerValue, bool uidValid, uint uidValue,
                                           QString &pinned, QString *ownerOut, uint *uidOut, QString *error)
{
    if (!ownerValid) {
        if (error) {
            *error = QStringLiteral("malformed KGlobalAccel service owner reply");
        }
        return false;
    }
    if (!ShortcutReconciler::uniqueNameValid(ownerValue)) {
        if (error) {
            *error = QStringLiteral("KGlobalAccel owner is not a unique name");
        }
        return false;
    }
    if (!uidValid) {
        if (error) {
            *error = QStringLiteral("malformed KGlobalAccel owner UID reply");
        }
        return false;
    }
    // Verified pin is immutable: the first verified unique owner sets it,
    // the same owner confirms it, and a subsequent different owner fails
    // closed without clobbering the pin.
    if (!tryPinOwner(pinned, ownerValue, error)) {
        return false;
    }
    if (ownerOut) {
        *ownerOut = ownerValue;
    }
    if (uidOut) {
        *uidOut = uidValue;
    }
    return true;
}

bool KGlobalAccelStore::checkPinnedDrift(bool liveValid, const QString &liveValue, const QString &pinned,
                                         QString *error)
{
    if (!liveValid || liveValue != pinned) {
        if (error) {
            *error = QStringLiteral("KGlobalAccel service owner drifted");
        }
        return false;
    }
    return true;
}

bool KGlobalAccelStore::currentOwner(QString *owner, uint *uid, QString *error)
{
    // Robust daemon owner resolution without dynamic QDBusInterface: Qt 6
    // dynamic QDBusInterface performs owner tracking/introspection at
    // construction, which fails implicit owner resolution against the
    // current bus daemon. QDBusConnection::interface()->serviceOwner/
    // serviceUid avoids that construction entirely.
    const QDBusConnection connection = QDBusConnection::sessionBus();
    if (!connection.isConnected()) {
        if (error) {
            *error = QStringLiteral("D-Bus daemon interface is invalid");
        }
        return false;
    }
    QDBusConnectionInterface *bus = connection.interface();
    if (!bus) {
        if (error) {
            *error = QStringLiteral("D-Bus daemon interface is invalid");
        }
        return false;
    }
    const QDBusReply<QString> nameOwner = bus->serviceOwner(shortcutService());
    const bool ownerValid = nameOwner.isValid();
    const QString ownerValue = ownerValid ? nameOwner.value() : QString();
    bool uidValid = false;
    uint uidValue = 0;
    if (ownerValid && ShortcutReconciler::uniqueNameValid(ownerValue)) {
        const QDBusReply<uint> ownerUid = bus->serviceUid(ownerValue);
        uidValid = ownerUid.isValid();
        if (uidValid) {
            uidValue = ownerUid.value();
        }
    }
    return resolveOwnerReply(ownerValid, ownerValue, uidValid, uidValue, m_pinnedOwner, owner, uid, error);
}

bool ShortcutReconciler::parseAllShortcutInfosReply(QDBusMessage::MessageType replyType,
                                                     const QString &replySignature,
                                                     const QList<QVariant> &replyArgs,
                                                     QList<ShortcutTuple> *tuples, QString *error)
{
    auto fail = [&](const QString &message) {
        if (error) {
            *error = message;
        }
        return false;
    };
    // Exact transport only: ReplyMessage with signature "a(ssssssaiai)"
    // carrying KGlobalShortcutInfo structs (6 strings + ai + ai). Ordered
    // type then signature then arity; any other shape fails closed.
    if (replyType != QDBusMessage::ReplyMessage) {
        return fail(QStringLiteral("unexpected allShortcutInfos reply: wrong message type"));
    }
    if (replySignature != QStringLiteral("a(ssssssaiai)")) {
        return fail(QStringLiteral("unexpected allShortcutInfos reply: wrong signature"));
    }
    if (replyArgs.size() != 1) {
        return fail(QStringLiteral("unexpected allShortcutInfos reply: wrong arity"));
    }
    const QVariant first = replyArgs.at(0);
    if (!first.canConvert<QDBusArgument>()) {
        return fail(QStringLiteral("unexpected allShortcutInfos reply: wrong variant shape"));
    }
    const QDBusArgument arg = first.value<QDBusArgument>();
    if (arg.currentType() != QDBusArgument::ArrayType) {
        return fail(QStringLiteral("unexpected allShortcutInfos reply: wrong array framing"));
    }
    QList<ShortcutInfoFields> infos;
    arg.beginArray();
    while (!arg.atEnd()) {
        ShortcutInfoFields info;
        arg >> info;
        infos.append(info);
        // Fail-fast wire bound before further payload allocation: shared
        // predicate retains the exact wire token for direct use.
        QString boundError;
        if (!checkTupleAppendBound(infos.size(), TupleAppendBound::AllInfosWire, &boundError)) {
            return fail(boundError);
        }
    }
    arg.endArray();
    return tuplesFromInfoFields(infos, tuples, error);
}

bool KGlobalAccelStore::readAll(QList<ShortcutTuple> *tuples, QString *error)
{
    if (!tuples) {
        return false;
    }
    // Raw method calls without dynamic QDBusInterface construction: the
    // Qt 6 dynamic interface performs owner tracking/introspection at
    // construction and fails implicit owner resolution here.
    if (!QDBusConnection::sessionBus().isConnected()) {
        if (error) {
            *error = QStringLiteral("KGlobalAccel interface is invalid");
        }
        return false;
    }
    const QDBusMessage compsCall = QDBusMessage::createMethodCall(shortcutService(), shortcutPath(),
                                                                 shortcutInterface(), shortcutAllComponentsMethod());
    const QDBusMessage compsReply = QDBusConnection::sessionBus().call(compsCall);
    QStringList components;
    if (!ShortcutReconciler::parseAllComponentsReply(compsReply.type(), compsReply.signature(), compsReply.arguments(),
                                                     &components, error)) {
        return false;
    }
    QList<ShortcutTuple> collected;
    for (const QString &componentPath : components) {
        QDBusMessage infosCall = QDBusMessage::createMethodCall(shortcutService(), componentPath,
                                                               shortcutComponentInterface(), shortcutAllInfosMethod());
        infosCall.setArguments({QStringLiteral("default")});
        const QDBusMessage infosReply = QDBusConnection::sessionBus().call(infosCall);
        QList<ShortcutTuple> batch;
        if (!ShortcutReconciler::parseAllShortcutInfosReply(infosReply.type(), infosReply.signature(),
                                                            infosReply.arguments(), &batch, error)) {
            return false;
        }
        for (const ShortcutTuple &tuple : batch) {
            collected.append(tuple);
            QString boundError;
            if (!ShortcutReconciler::checkTupleAppendBound(collected.size(),
                                                           ShortcutReconciler::TupleAppendBound::Collected,
                                                           &boundError)) {
                if (error) {
                    *error = boundError;
                }
                return false;
            }
        }
    }
    *tuples = collected;
    return true;
}

bool KGlobalAccelStore::shortcutsByKey(int key, QList<ShortcutKeyHolder> *holders, QString *error)
{
    if (!holders) {
        return false;
    }
    // Disjoint single-key guards without duplicate validation: negative,
    // then zero as non-positive, then over-max. List-bound is unreachable
    // for one element; over-max uses the direct bound check.
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
    if (!QDBusConnection::sessionBus().isConnected()) {
        if (error) {
            *error = QStringLiteral("KGlobalAccel interface is invalid");
        }
        return false;
    }
    ensureKeySequenceMetaTypes();
    const QKeySequence sequence(key, 0, 0, 0);
    const ShortcutMatchType match{SHORTCUT_MATCH_EQUAL};
    QDBusMessage call = QDBusMessage::createMethodCall(shortcutService(), shortcutPath(), shortcutInterface(),
                                                      shortcutByKeyMethod());
    call.setArguments({QVariant::fromValue(sequence), QVariant::fromValue(match)});
    const QDBusMessage reply = QDBusConnection::sessionBus().call(call);
    return ShortcutReconciler::parseGlobalShortcutsByKeyReply(reply.type(), reply.signature(), reply.arguments(),
                                                              holders, error);
}

bool KGlobalAccelStore::shortcutAvailable(int key, const QString &component, bool *available, QString *error)
{
    if (!available) {
        return false;
    }
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
    if (!QDBusConnection::sessionBus().isConnected()) {
        if (error) {
            *error = QStringLiteral("KGlobalAccel interface is invalid");
        }
        return false;
    }
    ensureKeySequenceMetaTypes();
    const QKeySequence sequence(key, 0, 0, 0);
    QDBusMessage call = QDBusMessage::createMethodCall(shortcutService(), shortcutPath(), shortcutInterface(),
                                                      shortcutAvailableMethod());
    call.setArguments({QVariant::fromValue(sequence), QVariant::fromValue(component)});
    const QDBusMessage reply = QDBusConnection::sessionBus().call(call);
    return ShortcutReconciler::parseGlobalShortcutAvailableReply(reply.type(), reply.signature(), reply.arguments(),
                                                                 available, error);
}

bool KGlobalAccelStore::writeKeys(const QString &component, const QString &action, const QString &componentFriendly,
                                  const QString &friendly, const QList<int> &keys, QList<int> *confirmed, QString *error)
{
    if (!ShortcutReconciler::isAllowlisted(component, action)) {
        if (error) {
            *error = QStringLiteral("refusing write outside the exact allowlist");
        }
        return false;
    }
    if (!ShortcutReconciler::keysValid(keys) || !ShortcutReconciler::stringValid(component) || !ShortcutReconciler::stringValid(action)
        || !ShortcutReconciler::cosmeticValid(componentFriendly) || !ShortcutReconciler::cosmeticValid(friendly)) {
        if (error) {
            *error = QStringLiteral("refusing write with unbounded tuple");
        }
        return false;
    }
    // Lifetime guard against unbounded use; the per-operation exact-two
    // bound is enforced by ShortcutReconciler via write-count deltas.
    if (m_writes >= 64) {
        if (error) {
            *error = QStringLiteral("refusing write beyond the lifetime bound");
        }
        return false;
    }
    if (m_pinnedOwner.isEmpty() || !ShortcutReconciler::uniqueNameValid(m_pinnedOwner)) {
        if (error) {
            *error = QStringLiteral("refusing write without a pinned KGlobalAccel owner");
        }
        return false;
    }
    // Re-resolve without clobbering the pin: the write must target the
    // verified captured unique owner, never a re-resolved well-known name.
    // Robust daemon query without dynamic QDBusInterface construction.
    {
        const QDBusConnection connection = QDBusConnection::sessionBus();
        if (!connection.isConnected()) {
            if (error) {
                *error = QStringLiteral("D-Bus daemon interface is invalid");
            }
            return false;
        }
        QDBusConnectionInterface *bus = connection.interface();
        if (!bus) {
            if (error) {
                *error = QStringLiteral("D-Bus daemon interface is invalid");
            }
            return false;
        }
        const QDBusReply<QString> liveOwner = bus->serviceOwner(shortcutService());
        const bool liveValid = liveOwner.isValid();
        const QString liveValue = liveValid ? liveOwner.value() : QString();
        if (!checkPinnedDrift(liveValid, liveValue, m_pinnedOwner, error)) {
            return false;
        }
    }
    ensureKeySequenceMetaTypes();
    // Typed QSet<QKeySequence> value: each active int becomes one sequence.
    // The QList target order is intentional (lock-key preservation); the
    // QSet itself is unordered and replies compare as sets.
    const QSet<QKeySequence> keySet = keySetFromInts(keys);
    const QSet<int> expectedSet(keys.begin(), keys.end());
    // Action ID is exactly [ComponentUnique, ActionUnique,
    // ComponentFriendly, ActionFriendly] from the live read tuples.
    const QStringList actionId{component, action, componentFriendly, friendly};
    if (!QDBusConnection::sessionBus().isConnected()) {
        if (error) {
            *error = QStringLiteral("KGlobalAccel interface is invalid");
        }
        return false;
    }
    QDBusMessage setCall = QDBusMessage::createMethodCall(m_pinnedOwner, shortcutPath(), shortcutInterface(),
                                                         shortcutSetMethod());
    setCall.setArguments({actionId, QVariant::fromValue(keySet), QVariant::fromValue(SHORTCUT_SET_FLAGS)});
    const QDBusMessage reply = QDBusConnection::sessionBus().call(setCall);
    if (reply.type() != QDBusMessage::ReplyMessage || reply.arguments().size() != 1
        || reply.signature() != QStringLiteral("a(ai)")) {
        if (error) {
            *error = QStringLiteral("setShortcutKeys reply did not confirm expected key");
        }
        return false;
    }
    QSet<QKeySequence> replySet;
    const QVariant replyVariant = reply.arguments().at(0);
    if (replyVariant.userType() == qMetaTypeId<QSet<QKeySequence>>()) {
        replySet = replyVariant.value<QSet<QKeySequence>>();
        // Same bound as the QDBusArgument framing below.
        if (replySet.size() > SHORTCUT_MAX_KEYS_PER_TUPLE) {
            if (error) {
                *error = QStringLiteral("setShortcutKeys reply did not confirm expected key");
            }
            return false;
        }
    } else if (replyVariant.canConvert<QDBusArgument>()) {
        // Read-mode a(ai) decode: const access selects the read overloads.
        // Guarded array -> structure -> inner array -> basic before each
        // descent/read so a container can never reach operator>>(int&);
        // every unexpected framing fails closed with the bounded error.
        const QDBusArgument arg = replyVariant.value<QDBusArgument>();
        if (arg.currentType() != QDBusArgument::ArrayType) {
            if (error) {
                *error = QStringLiteral("setShortcutKeys reply did not confirm expected key");
            }
            return false;
        }
        QList<QList<int>> slotGroups;
        bool framingOk = true;
        arg.beginArray();
        while (!arg.atEnd() && framingOk) {
            if (arg.currentType() != QDBusArgument::StructureType) {
                framingOk = false;
                break;
            }
            arg.beginStructure();
            if (arg.currentType() != QDBusArgument::ArrayType) {
                framingOk = false;
                arg.endStructure();
                break;
            }
            arg.beginArray();
            QList<int> values;
            int innerCount = 0;
            while (!arg.atEnd()) {
                if (arg.currentType() != QDBusArgument::BasicType) {
                    framingOk = false;
                    break;
                }
                int value = 0;
                arg >> value;
                if (innerCount < 5) {
                    values.append(value);
                }
                ++innerCount;
            }
            if (!framingOk) {
                arg.endArray();
                arg.endStructure();
                break;
            }
            // Bound inner growth before validation: more than five slots is
            // already long; drain state stays consistent via atEnd loop above.
            if (innerCount != 4) {
                framingOk = false;
                arg.endArray();
                arg.endStructure();
                break;
            }
            slotGroups.append(values);
            if (slotGroups.size() > SHORTCUT_MAX_KEYS_PER_TUPLE) {
                framingOk = false;
                arg.endArray();
                arg.endStructure();
                break;
            }
            arg.endArray();
            arg.endStructure();
        }
        arg.endArray();
        if (!framingOk) {
            if (error) {
                *error = QStringLiteral("setShortcutKeys reply did not confirm expected key");
            }
            return false;
        }
        if (!ShortcutReconciler::decodeSetterReplySlotSets(slotGroups, &replySet)) {
            if (error) {
                *error = QStringLiteral("setShortcutKeys reply did not confirm expected key");
            }
            return false;
        }
    } else {
        if (error) {
            *error = QStringLiteral("setShortcutKeys reply did not confirm expected key");
        }
        return false;
    }
    // A QSet reply has no meaningful order: compare as sets.
    if (intSetFromKeySet(replySet) != expectedSet) {
        if (error) {
            *error = QStringLiteral("setShortcutKeys reply did not confirm expected key");
        }
        return false;
    }
    ++m_writes;
    if (confirmed) {
        *confirmed = keys;
    }
    return true;
}

bool KGlobalAccelStore::defaultShortcutKeys(const QString &component, const QString &action,
                                            const QString &componentFriendly, const QString &friendly,
                                            QList<int> *defaults, QString *error)
{
    // Bounded native TRANSPORT seam: exact defaultShortcutKeys(as)->a(ai)
    // against the pinned owner. Arbitrary component/action IDs allowed:
    // identity strict, cosmetic bounded, pin plus drift enforced before the
    // call; reply strictly validated. No policy/UI effect; writeKeys
    // remains the project-row path.
    if (!ShortcutReconciler::stringValid(component) || !ShortcutReconciler::stringValid(action)
        || !ShortcutReconciler::cosmeticValid(componentFriendly) || !ShortcutReconciler::cosmeticValid(friendly)) {
        if (error) {
            *error = QStringLiteral("refusing default keys with unbounded tuple");
        }
        return false;
    }
    if (m_pinnedOwner.isEmpty() || !ShortcutReconciler::uniqueNameValid(m_pinnedOwner)) {
        if (error) {
            *error = QStringLiteral("refusing default keys without a pinned KGlobalAccel owner");
        }
        return false;
    }
    {
        const QDBusConnection connection = QDBusConnection::sessionBus();
        if (!connection.isConnected()) {
            if (error) {
                *error = QStringLiteral("D-Bus daemon interface is invalid");
            }
            return false;
        }
        QDBusConnectionInterface *bus = connection.interface();
        if (!bus) {
            if (error) {
                *error = QStringLiteral("D-Bus daemon interface is invalid");
            }
            return false;
        }
        const QDBusReply<QString> liveOwner = bus->serviceOwner(shortcutService());
        const bool liveValid = liveOwner.isValid();
        const QString liveValue = liveValid ? liveOwner.value() : QString();
        if (!checkPinnedDrift(liveValid, liveValue, m_pinnedOwner, error)) {
            return false;
        }
    }
    ensureKeySequenceMetaTypes();
    const QStringList actionId{component, action, componentFriendly, friendly};
    if (!QDBusConnection::sessionBus().isConnected()) {
        if (error) {
            *error = QStringLiteral("KGlobalAccel interface is invalid");
        }
        return false;
    }
    QDBusMessage call =
        QDBusMessage::createMethodCall(m_pinnedOwner, shortcutPath(), shortcutInterface(), shortcutDefaultKeysMethod());
    call.setArguments({actionId});
    const QDBusMessage reply = QDBusConnection::sessionBus().call(call);
    return ShortcutReconciler::parseDefaultShortcutKeysReply(reply.type(), reply.signature(), reply.arguments(),
                                                             defaults, error);
}

bool KGlobalAccelStore::setForeignShortcutKeys(const QString &component, const QString &action,
                                               const QString &componentFriendly, const QString &friendly,
                                               const QList<int> &keys, QString *error)
{
    // Bounded native TRANSPORT seam: exact setForeignShortcutKeys
    // (as,a(ai))->void against the pinned owner with strict void validation,
    // owner drift checks, and fresh shortcutKeys readback confirmation. The
    // void reply carries no keys, so confirmation reads back active keys for
    // the same actionId and compares as sets. Arbitrary IDs allowed; successful
    // foreign writes count against the same lifetime cap as writeKeys.
    if (!ShortcutReconciler::keysValid(keys) || !ShortcutReconciler::stringValid(component)
        || !ShortcutReconciler::stringValid(action) || !ShortcutReconciler::cosmeticValid(componentFriendly)
        || !ShortcutReconciler::cosmeticValid(friendly)) {
        if (error) {
            *error = QStringLiteral("refusing foreign write with unbounded tuple");
        }
        return false;
    }
    if (m_pinnedOwner.isEmpty() || !ShortcutReconciler::uniqueNameValid(m_pinnedOwner)) {
        if (error) {
            *error = QStringLiteral("refusing foreign write without a pinned KGlobalAccel owner");
        }
        return false;
    }
    if (m_writes >= 64) {
        if (error) {
            *error = QStringLiteral("refusing write beyond the lifetime bound");
        }
        return false;
    }
    auto driftCheck = [&](QString *driftError) {
        const QDBusConnection connection = QDBusConnection::sessionBus();
        if (!connection.isConnected()) {
            if (driftError) {
                *driftError = QStringLiteral("D-Bus daemon interface is invalid");
            }
            return false;
        }
        QDBusConnectionInterface *bus = connection.interface();
        if (!bus) {
            if (driftError) {
                *driftError = QStringLiteral("D-Bus daemon interface is invalid");
            }
            return false;
        }
        const QDBusReply<QString> liveOwner = bus->serviceOwner(shortcutService());
        const bool liveValid = liveOwner.isValid();
        const QString liveValue = liveValid ? liveOwner.value() : QString();
        return checkPinnedDrift(liveValid, liveValue, m_pinnedOwner, driftError);
    };
    if (!driftCheck(error)) {
        return false;
    }
    ensureKeySequenceMetaTypes();
    const QStringList actionId{component, action, componentFriendly, friendly};
    const QList<QKeySequence> keyList = keyListFromInts(keys);
    if (!QDBusConnection::sessionBus().isConnected()) {
        if (error) {
            *error = QStringLiteral("KGlobalAccel interface is invalid");
        }
        return false;
    }
    QDBusMessage setCall = QDBusMessage::createMethodCall(m_pinnedOwner, shortcutPath(), shortcutInterface(),
                                                          shortcutSetForeignKeysMethod());
    setCall.setArguments({actionId, QVariant::fromValue(keyList)});
    const QDBusMessage setReply = QDBusConnection::sessionBus().call(setCall);
    if (!ShortcutReconciler::parseSetForeignShortcutKeysReply(setReply.type(), setReply.signature(),
                                                              setReply.arguments(), error)) {
        return false;
    }
    if (!driftCheck(error)) {
        return false;
    }
    // Fresh readback confirmation: the void setter returns nothing, so read
    // active keys for the same actionId and compare as sets.
    QDBusMessage getCall =
        QDBusMessage::createMethodCall(m_pinnedOwner, shortcutPath(), shortcutInterface(), shortcutActiveKeysMethod());
    getCall.setArguments({actionId});
    const QDBusMessage getReply = QDBusConnection::sessionBus().call(getCall);
    QList<int> readback;
    if (!ShortcutReconciler::parseDefaultShortcutKeysReply(getReply.type(), getReply.signature(),
                                                           getReply.arguments(), &readback, nullptr)) {
        if (error) {
            *error = QStringLiteral("setForeignShortcutKeys readback did not confirm expected keys");
        }
        return false;
    }
    if (!ShortcutReconciler::foreignReadbackMatches(keys, readback)) {
        if (error) {
            *error = QStringLiteral("setForeignShortcutKeys readback did not confirm expected keys");
        }
        return false;
    }
    ++m_writes;
    return true;
}

ShortcutReconciler::ShortcutReconciler(ShortcutStore *store, ClearedActionsStore *cleared)
    : m_store(store)
    , m_cleared(cleared)
{
}

ShortcutStore *createLiveShortcutStore()
{
    return new KGlobalAccelStore;
}

namespace
{

// Bounded cleared-entry validation shared by load and save: strict
// component/action identity only, at most SHORTCUT_MAX_TUPLES entries.
// No cosmetic labels are stored.
bool clearedEntriesValid(const QList<ClearedAction> &actions, QString *error)
{
    if (actions.size() > SHORTCUT_MAX_TUPLES) {
        if (error) {
            *error = QStringLiteral("cleared shortcut list is unbounded");
        }
        return false;
    }
    for (const ClearedAction &entry : actions) {
        if (!ShortcutReconciler::stringValid(entry.component) || !ShortcutReconciler::stringValid(entry.action)) {
            if (error) {
                *error = QStringLiteral("cleared shortcut entry is unbounded");
            }
            return false;
        }
    }
    return true;
}

} // namespace

KConfigClearedActions::KConfigClearedActions(const QString &filePath)
    : m_filePath(filePath)
{
}

bool KConfigClearedActions::load(QList<ClearedAction> *actions, QString *error)
{
    if (!ShortcutReconciler::clearedActionsPathSafe(m_filePath, error)) {
        return false;
    }
    KConfig config(m_filePath, KConfig::SimpleConfig);
    const KConfigGroup group = config.group(QStringLiteral("ClearedActions"));
    const QStringList components = group.readEntry(QStringLiteral("Components"), QStringList());
    const QStringList acts = group.readEntry(QStringLiteral("Actions"), QStringList());
    // IDs only: legacy ComponentFriendlies/Friendlies keys are ignored, never
    // read, never required.
    if (components.size() != acts.size()) {
        if (error) {
            *error = QStringLiteral("cleared shortcut list is malformed");
        }
        return false;
    }
    QList<ClearedAction> loaded;
    loaded.reserve(components.size());
    for (int i = 0; i < components.size(); ++i) {
        ClearedAction entry;
        entry.component = components.at(i);
        entry.action = acts.at(i);
        loaded.append(entry);
    }
    if (!clearedEntriesValid(loaded, error)) {
        return false;
    }
    if (actions) {
        *actions = loaded;
    }
    return true;
}

bool KConfigClearedActions::save(const QList<ClearedAction> &actions, QString *error)
{
    if (!clearedEntriesValid(actions, error)) {
        return false;
    }
    if (!ShortcutReconciler::clearedActionsPathSafe(m_filePath, error)) {
        return false;
    }
    const QString parentPath = QFileInfo(m_filePath).dir().path();
    if (!ensurePrivateDir(parentPath, error)) {
        return false;
    }
    {
        KConfig config(m_filePath, KConfig::SimpleConfig);
        KConfigGroup group = config.group(QStringLiteral("ClearedActions"));
        QStringList components;
        QStringList acts;
        components.reserve(actions.size());
        acts.reserve(actions.size());
        for (const ClearedAction &entry : actions) {
            components.append(entry.component);
            acts.append(entry.action);
        }
        group.writeEntry(QStringLiteral("Components"), components);
        group.writeEntry(QStringLiteral("Actions"), acts);
        // IDs only: never write cosmetic labels. Remove any legacy
        // friendly keys so the persisted shape stays Components+Actions.
        group.deleteEntry(QStringLiteral("ComponentFriendlies"));
        group.deleteEntry(QStringLiteral("Friendlies"));
        config.sync();
    }
    if (!ensurePrivateFile(m_filePath, error)) {
        return false;
    }
    // Write+sync+readback before any daemon mutation.
    QList<ClearedAction> readback;
    if (!load(&readback, nullptr)) {
        if (error) {
            *error = QStringLiteral("cleared shortcut readback failed");
        }
        return false;
    }
    if (readback != actions) {
        if (error) {
            *error = QStringLiteral("cleared shortcut readback mismatch");
        }
        return false;
    }
    return true;
}

bool KConfigClearedActions::clear(QString *error)
{
    if (!ShortcutReconciler::clearedActionsPathSafe(m_filePath, error)) {
        return false;
    }
    if (!QFile::exists(m_filePath)) {
        return true;
    }
    // Only removes the project-owned cleared-actions file, never global config.
    if (!QFile::remove(m_filePath)) {
        if (error) {
            *error = QStringLiteral("could not clear the cleared shortcut list");
        }
        return false;
    }
    return true;
}

ClearedActionsStore *createLiveClearedActionsStore(const QString &filePath)
{
    return new KConfigClearedActions(filePath);
}

QString defaultClearedActionsPath()
{
    // Host-independent project location for the durable cleared-ID
    // list, shared by every KCM host. Never falls back to CWD.
    const QString base = QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation);
    if (base.isEmpty() || !QDir::isAbsolutePath(base)) {
        return QString();
    }
    return base + QStringLiteral("/plasma-auto-tiler/shortcut-clearedrc");
}

Q_LOGGING_CATEGORY(lcShortcut, "plasmaautotiler.shortcut");

namespace
{

ShortcutLogSink g_shortcutLogSink;

} // namespace

void ShortcutDiag::setSink(ShortcutLogSink sink)
{
    g_shortcutLogSink = std::move(sink);
}

void ShortcutDiag::resetSink()
{
    g_shortcutLogSink = nullptr;
}

void ShortcutDiag::log(QtMsgType type, const char *operation, const char *stage, const char *outcome,
                       const QString &detail)
{
    // Logging never affects behavior: void return, bounded message, all
    // exceptions swallowed, no caller branches on this path.
    try {
        // Foreign keyed occupants are useful to the KCM but must never enter
        // diagnostics. All other backend errors are fixed bounded tokens.
        QString bounded = detail.contains(QStringLiteral(" claimed by ")) ? QStringLiteral("reason=key-conflict") : detail;
        if (bounded.size() > 512) {
            bounded.truncate(512);
        }
        const QString message = QStringLiteral("plasmaautotiler.shortcut op=%1 stage=%2 outcome=%3 %4")
                                    .arg(QString::fromUtf8(operation), QString::fromUtf8(stage),
                                         QString::fromUtf8(outcome), bounded);
        if (g_shortcutLogSink) {
            g_shortcutLogSink(type, message);
            return;
        }
        switch (type) {
        case QtDebugMsg:
            qCDebug(lcShortcut).noquote() << message;
            break;
        case QtInfoMsg:
            qCInfo(lcShortcut).noquote() << message;
            break;
        case QtWarningMsg:
            qCWarning(lcShortcut).noquote() << message;
            break;
        default:
            qCCritical(lcShortcut).noquote() << message;
            break;
        }
    } catch (...) {
    }
}

bool ShortcutReconciler::collectHolderSnapshot(HolderSnapshot *snapshot, QString *error)
{
    if (!m_store) {
        if (error) {
            *error = QStringLiteral("reconciler is not configured");
        }
        return false;
    }
    if (!m_store->checkSetterContract(error)) {
        return false;
    }
    HolderSnapshot snap;
    if (!m_store->currentOwner(&snap.owner, &snap.uid, error)) {
        return false;
    }
    QList<ShortcutTuple> tuples;
    if (!m_store->readAll(&tuples, error)) {
        return false;
    }
    if (tuples.size() > SHORTCUT_MAX_TUPLES) {
        if (error) {
            *error = QStringLiteral("tuple enumeration is unbounded");
        }
        return false;
    }
    if (!findAllowlisted(tuples, shortcutFocusComponent(), shortcutFocusAction(), &snap.focus, error)
        || !findAllowlisted(tuples, shortcutLockComponent(), shortcutLockAction(), &snap.lock, error)
        || !findAllowlisted(tuples, shortcutResizeUpComponent(), shortcutResizeUpAction(), &snap.resizeUp, error)
        || !findAllowlisted(tuples, shortcutResizeRightComponent(), shortcutResizeRightAction(), &snap.resizeRight,
                            error)
        || !findAllowlisted(tuples, shortcutFloatComponent(), shortcutFloatAction(), &snap.floatToggle, error)
        || !findAllowlisted(tuples, shortcutMaximizeComponent(), shortcutMaximizeAction(), &snap.maximizeToggle,
                            error)) {
        return false;
    }
    if (!keysValid(snap.focus.active) || !keysValid(snap.lock.active) || !keysValid(snap.resizeUp.active)
        || !keysValid(snap.resizeRight.active) || !keysValid(snap.floatToggle.active)
        || !keysValid(snap.maximizeToggle.active)) {
        if (error) {
            *error = QStringLiteral("allowlisted tuple is unbounded");
        }
        return false;
    }
    // Independent structural validation of enumerated state: unbounded
    // unrelated tuples fail closed with zero writes.
    QMap<QString, QPair<QString, QString>> cosmetics;
    for (const ShortcutTuple &tuple : tuples) {
        if (isProjectAction(tuple.component, tuple.action) || isLockAction(tuple.component, tuple.action)) {
            continue;
        }
        if (!keysValid(tuple.active)) {
            if (error) {
                *error = QStringLiteral("unrelated tuple is unbounded");
            }
            return false;
        }
        cosmetics.insert(tuple.component + QStringLiteral("/") + tuple.action,
                         qMakePair(tuple.componentFriendly, tuple.friendly));
    }
    // Authoritative per-required-key holder scan. Project actions and Lock
    // Session own their chords; the explicit System Monitor Meta+Esc holder
    // is user-authorized. Every other actual holder becomes a clear row,
    // whatever its identity (known, unknown, or legacy project IDs).
    // Transport, parsing, and consistency failures sort before the lock
    // gate below, matching the historical refusal precedence.
    const QList<int> required = relevantConflictKeys();
    QMap<QString, int> rowIndex;
    for (int key : required) {
        QString keyError;
        if (!checkOccupancyKeyRange(key, &keyError)) {
            if (error) {
                *error = keyError;
            }
            return false;
        }
        QList<ShortcutKeyHolder> holders;
        QString storeError;
        if (!m_store->shortcutsByKey(key, &holders, &storeError)) {
            if (error) {
                *error = storeError.isEmpty() ? QStringLiteral("globalShortcutsByKey call failed") : storeError;
            }
            return false;
        }
        bool available = false;
        if (!m_store->shortcutAvailable(key, QString(), &available, &storeError)) {
            if (error) {
                *error = storeError.isEmpty() ? QStringLiteral("globalShortcutAvailable call failed") : storeError;
            }
            return false;
        }
        if (holders.size() > SHORTCUT_MAX_TUPLES) {
            if (error) {
                *error = QStringLiteral("unexpected globalShortcutsByKey reply: too many occupancy holders");
            }
            return false;
        }
        for (const ShortcutKeyHolder &holder : holders) {
            if (holder.component.isEmpty()) {
                if (error) {
                    *error = QStringLiteral("unexpected globalShortcutsByKey reply: empty holder component");
                }
                return false;
            }
            if (holder.component.size() > SHORTCUT_MAX_STRING_LEN) {
                if (error) {
                    *error = QStringLiteral("unexpected globalShortcutsByKey reply: oversized holder component");
                }
                return false;
            }
            if (holder.action.isEmpty()) {
                if (error) {
                    *error = QStringLiteral("unexpected globalShortcutsByKey reply: empty holder action");
                }
                return false;
            }
            if (holder.action.size() > SHORTCUT_MAX_STRING_LEN) {
                if (error) {
                    *error = QStringLiteral("unexpected globalShortcutsByKey reply: oversized holder action");
                }
                return false;
            }
            switch (classifyKeyList(holder.active)) {
            case KeyListFailure::TooMany:
                if (error) {
                    *error = QStringLiteral("unexpected globalShortcutsByKey reply: too many holder active keys");
                }
                return false;
            case KeyListFailure::Negative:
                if (error) {
                    *error = QStringLiteral("unexpected globalShortcutsByKey reply: negative holder active key");
                }
                return false;
            case KeyListFailure::Oversized:
                if (error) {
                    *error = QStringLiteral("unexpected globalShortcutsByKey reply: oversized holder active key");
                }
                return false;
            case KeyListFailure::None:
                break;
            }
            switch (classifyKeyList(holder.defaults)) {
            case KeyListFailure::TooMany:
                if (error) {
                    *error = QStringLiteral("unexpected globalShortcutsByKey reply: too many holder default keys");
                }
                return false;
            case KeyListFailure::Negative:
                if (error) {
                    *error = QStringLiteral("unexpected globalShortcutsByKey reply: negative holder default key");
                }
                return false;
            case KeyListFailure::Oversized:
                if (error) {
                    *error = QStringLiteral("unexpected globalShortcutsByKey reply: oversized holder default key");
                }
                return false;
            case KeyListFailure::None:
                break;
            }
            if (isHolderExempt(holder.component, holder.action, key)) {
                continue;
            }
            const QString id = holder.component + QStringLiteral("/") + holder.action;
            const auto existing = rowIndex.find(id);
            if (existing == rowIndex.end()) {
                const QList<int> removals = conflictingKeys(holder.active);
                if (removals.isEmpty()) {
                    // Listed for the key but holds no required chord in its
                    // active list: claims the chord (e.g. via a
                    // .desktop-declared default) with nothing to clear.
                    Blocker blocker;
                    blocker.component = holder.component;
                    blocker.action = holder.action;
                    blocker.key = key;
                    snap.blocked.append(blocker);
                    continue;
                }
                ClearRow row;
                row.component = holder.component;
                row.action = holder.action;
                const auto cosmetic = cosmetics.find(id);
                if (cosmetic != cosmetics.end()) {
                    row.componentFriendly = cosmetic->first;
                    row.friendly = cosmetic->second;
                }
                row.active = holder.active;
                row.removals = removals;
                row.remainder = remainderAfterClear(holder.active);
                rowIndex.insert(id, snap.rows.size());
                snap.rows.append(row);
                if (snap.rows.size() > SHORTCUT_MAX_TUPLES) {
                    if (error) {
                        *error = QStringLiteral("unexpected globalShortcutsByKey reply: too many occupancy holders");
                    }
                    return false;
                }
            } else {
                ClearRow &row = snap.rows[existing.value()];
                if (row.active != holder.active) {
                    if (error) {
                        *error = QStringLiteral(
                            "unexpected globalShortcutsByKey reply: inconsistent holder for the requested key");
                    }
                    return false;
                }
            }
        }
        // Whole-key consistency, fail closed both directions: empty holders
        // must report available and non-empty holders must report
        // unavailable. Skipped project/lock/authorized holders still occupy
        // the key and keep the non-empty/unavailable expectation.
        if (holders.isEmpty() != available) {
            if (error) {
                *error = holders.isEmpty()
                    ? QStringLiteral("unexpected globalShortcutAvailable reply: empty holders report unavailable")
                    : QStringLiteral("unexpected globalShortcutAvailable reply: occupied holders report available");
            }
            return false;
        }
    }
    // Deterministic row order regardless of daemon reply order, so a fresh
    // re-preview compares exactly against the confirmed snapshot.
    std::sort(snap.rows.begin(), snap.rows.end(), [](const ClearRow &a, const ClearRow &b) {
        if (a.component != b.component) {
            return a.component < b.component;
        }
        return a.action < b.action;
    });
    // Lock preconditions are relocate logic: without Meta+L to replace and
    // without Meta+Esc already held there is nothing safe to do.
    if (!snap.lock.active.contains(SHORTCUT_META_L) && !snap.lock.active.contains(SHORTCUT_META_ESC)) {
        if (error) {
            *error = QStringLiteral("refusing to apply: lock binding has no Meta+L to replace");
        }
        return false;
    }
    if (snapshot) {
        *snapshot = snap;
    }
    return true;
}

ShortcutApplyResult ShortcutReconciler::writeProjectKeys(const char *operation)
{
    ShortcutApplyResult result;
    if (!m_store) {
        result.error = QStringLiteral("reconciler is not configured");
        return result;
    }
    ShortcutDiag::log(QtDebugMsg, operation, "start", "running", QStringLiteral("rows=5"));
    const int startWrites = m_store->writeCount();
    auto usedWrites = [&]() {
        return m_store->writeCount() - startWrites;
    };
    QString error;
    HolderSnapshot snap;
    if (!collectHolderSnapshot(&snap, &error)) {
        result.error = error;
        ShortcutDiag::log(QtWarningMsg, operation, "preflight", "refused", error);
        return result;
    }
    if (!snap.rows.isEmpty() || !snap.blocked.isEmpty()) {
        if (!snap.blocked.isEmpty()) {
            const Blocker &first = snap.blocked.first();
            result.error = QStringLiteral("refusing to apply: %1 is claimed by %2/%3")
                               .arg(keyDisplayName(first.key), first.component, first.action);
        } else {
            const ClearRow &first = snap.rows.first();
            const int key = first.removals.isEmpty() ? 0 : first.removals.first();
            if (key == 0) {
                result.error = QStringLiteral("refusing to apply: holder state is inconsistent");
            } else {
                result.error = QStringLiteral("refusing to apply: %1 is claimed by %2/%3")
                                   .arg(keyDisplayName(key), first.component, first.action);
            }
        }
        ShortcutDiag::log(QtWarningMsg, operation, "preflight", "refused", result.error);
        return result;
    }
    const QString owner = snap.owner;
    const uint uid = snap.uid;
    auto checkOwner = [&](QString *ownerError) {
        QString liveOwner;
        uint liveUid = 0;
        if (!m_store->currentOwner(&liveOwner, &liveUid, ownerError)) {
            return false;
        }
        if (liveOwner != owner || liveUid != uid) {
            if (ownerError) {
                *ownerError = QStringLiteral("KGlobalAccel service owner drifted");
            }
            return false;
        }
        return true;
    };
    auto writeOne = [&](const QString &component, const QString &action, const QString &componentFriendly,
                        const QString &friendly, const QList<int> &keys, const char *what, QString *writeError) {
        if (!checkOwner(writeError)) {
            return false;
        }
        QList<int> confirmed;
        if (!m_store->writeKeys(component, action, componentFriendly, friendly, keys, &confirmed, writeError)) {
            if (writeError && writeError->isEmpty()) {
                *writeError =
                    QStringLiteral("setShortcutKeys call failed for %1").arg(QString::fromUtf8(what));
            }
            return false;
        }
        if (confirmed != keys) {
            if (writeError) {
                *writeError = QStringLiteral("setShortcutKeys reply did not confirm expected key");
            }
            return false;
        }
        return checkOwner(writeError);
    };
    // Phase 1: focus must own Meta+L before lock drops it.
    const QList<int> focusPost = focusPostKeys();
    if (snap.focus.active != focusPost) {
        if (!writeOne(snap.focus.component, snap.focus.action, snap.focus.componentFriendly, snap.focus.friendly,
                      focusPost, "focus", &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
    }
    // Phase 2: lock relocation preserving exact other keys/order, gated on a
    // fresh read showing focus still owning Meta+L.
    {
        QList<ShortcutTuple> tuples;
        if (!m_store->readAll(&tuples, &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        ShortcutTuple focusGate;
        ShortcutTuple lockGate;
        if (!findAllowlisted(tuples, shortcutFocusComponent(), shortcutFocusAction(), &focusGate, &error)
            || !findAllowlisted(tuples, shortcutLockComponent(), shortcutLockAction(), &lockGate, &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        if (focusGate.active != focusPost) {
            result.error = QStringLiteral("refusing the lock write while focus does not own Meta+L");
            result.writes = usedWrites();
            return result;
        }
        const QList<int> lockPost = lockPostFor(lockGate.active);
        if (lockGate.active != lockPost) {
            if (!writeOne(lockGate.component, lockGate.action, lockGate.componentFriendly, lockGate.friendly, lockPost,
                          "lock", &error)) {
                result.error = error;
                result.writes = usedWrites();
                return result;
            }
        }
    }
    // Phase 3: remaining project assignments from a fresh read.
    {
        QList<ShortcutTuple> tuples;
        if (!m_store->readAll(&tuples, &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        struct Need
        {
            ShortcutTuple current;
            QList<int> post;
            const char *what;
        };
        QList<Need> needs;
        ShortcutTuple current;
        if (!findAllowlisted(tuples, shortcutResizeUpComponent(), shortcutResizeUpAction(), &current, &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        needs.append({current, resizeUpPostKeys(), "resize-up"});
        if (!findAllowlisted(tuples, shortcutResizeRightComponent(), shortcutResizeRightAction(), &current, &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        needs.append({current, resizeRightPostKeys(), "resize-right"});
        if (!findAllowlisted(tuples, shortcutFloatComponent(), shortcutFloatAction(), &current, &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        needs.append({current, floatPostKeys(), "float"});
        if (!findAllowlisted(tuples, shortcutMaximizeComponent(), shortcutMaximizeAction(), &current, &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        needs.append({current, maximizePostKeys(), "maximize"});
        for (const Need &need : needs) {
            if (need.current.active == need.post) {
                continue;
            }
            if (!writeOne(need.current.component, need.current.action, need.current.componentFriendly,
                          need.current.friendly, need.post, need.what, &error)) {
                result.error = error;
                result.writes = usedWrites();
                return result;
            }
        }
    }
    // Finish: only the expected image is permitted.
    {
        QList<ShortcutTuple> finalTuples;
        if (!m_store->readAll(&finalTuples, &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        ShortcutTuple focusFinal;
        ShortcutTuple lockFinal;
        ShortcutTuple upFinal;
        ShortcutTuple rightFinal;
        ShortcutTuple floatFinal;
        ShortcutTuple maximizeFinal;
        if (!findAllowlisted(finalTuples, shortcutFocusComponent(), shortcutFocusAction(), &focusFinal, &error)
            || !findAllowlisted(finalTuples, shortcutLockComponent(), shortcutLockAction(), &lockFinal, &error)
            || !findAllowlisted(finalTuples, shortcutResizeUpComponent(), shortcutResizeUpAction(), &upFinal, &error)
            || !findAllowlisted(finalTuples, shortcutResizeRightComponent(), shortcutResizeRightAction(), &rightFinal,
                                &error)
            || !findAllowlisted(finalTuples, shortcutFloatComponent(), shortcutFloatAction(), &floatFinal, &error)
            || !findAllowlisted(finalTuples, shortcutMaximizeComponent(), shortcutMaximizeAction(), &maximizeFinal,
                                &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        if (focusFinal.active != focusPost || upFinal.active != resizeUpPostKeys()
            || rightFinal.active != resizeRightPostKeys() || floatFinal.active != floatPostKeys()
            || maximizeFinal.active != maximizePostKeys() || lockFinal.active.contains(SHORTCUT_META_L)
            || !lockFinal.active.contains(SHORTCUT_META_ESC)) {
            result.error = QStringLiteral("finish-apply verification failed: live state differs from the expected image");
            result.writes = usedWrites();
            return result;
        }
    }
    if (usedWrites() > SHORTCUT_MAX_WRITES) {
        result.error = QStringLiteral("tuple writes exceed the exact ten writes max");
        result.writes = usedWrites();
        return result;
    }
    if (!checkOwner(&error)) {
        result.error = error;
        result.writes = usedWrites();
        return result;
    }
    result.ok = true;
    result.writes = usedWrites();
    ShortcutDiag::log(QtInfoMsg, operation, "finish", "ok", QStringLiteral("writes=%1").arg(result.writes));
    return result;
}

ShortcutApplyResult ShortcutReconciler::apply()
{
    return writeProjectKeys("apply");
}

ShortcutRevertResult ShortcutReconciler::revert()
{
    ShortcutRevertResult result;
    if (!m_store || !m_cleared) {
        result.error = QStringLiteral("reconciler is not configured");
        return result;
    }
    ShortcutDiag::log(QtDebugMsg, "revert", "start", "running", QStringLiteral("cleared=list"));
    QString error;
    if (!m_store->checkSetterContract(&error)) {
        result.error = error;
        return result;
    }
    QString owner;
    uint uid = 0;
    if (!m_store->currentOwner(&owner, &uid, &error)) {
        result.error = error;
        return result;
    }
    auto checkOwner = [&](QString *ownerError) {
        QString liveOwner;
        uint liveUid = 0;
        if (!m_store->currentOwner(&liveOwner, &liveUid, ownerError)) {
            return false;
        }
        if (liveOwner != owner || liveUid != uid) {
            if (ownerError) {
                *ownerError = QStringLiteral("KGlobalAccel service owner drifted");
            }
            return false;
        }
        return true;
    };
    QList<ClearedAction> existing;
    if (!m_cleared->load(&existing, &error)) {
        result.error = error;
        return result;
    }
    if (existing.isEmpty()) {
        result.ok = true;
        ShortcutDiag::log(QtInfoMsg, "revert", "finish", "ok", QStringLiteral("cleared=empty writes=0"));
        return result;
    }
    const int startWrites = m_store->writeCount();
    auto usedWrites = [&]() {
        return m_store->writeCount() - startWrites;
    };
    // Idempotent per-entry restore: resolve each persisted ID to its fresh
    // current tuple from readAll to supply the current friendly labels
    // (empty allowed) for the 4-field actionId. Never assume 2-field
    // daemon semantics. Project-owned IDs (current and legacy) stay
    // cleared. Absent or duplicate IDs fail closed without writing
    // unrelated actions; any failure retains the list for resume.
    QList<ShortcutTuple> fresh;
    if (!m_store->readAll(&fresh, &error)) {
        result.error = error.isEmpty() ? QStringLiteral("cleared shortcut resolve failed") : error;
        result.writes = usedWrites();
        return result;
    }
    for (const ClearedAction &entry : existing) {
        if (!stringValid(entry.component) || !stringValid(entry.action)) {
            result.error = QStringLiteral("cleared shortcut entry is unbounded");
            result.writes = usedWrites();
            return result;
        }
        if (isProjectOwned(entry.component, entry.action)) {
            continue;
        }
        int matches = 0;
        ShortcutTuple current;
        for (const ShortcutTuple &tuple : fresh) {
            if (tuple.component == entry.component && tuple.action == entry.action) {
                ++matches;
                current = tuple;
            }
        }
        if (matches != 1) {
            result.error = matches == 0
                ? QStringLiteral("cleared shortcut action is absent; retaining list for retry")
                : QStringLiteral("cleared shortcut action is ambiguous; retaining list for retry");
            result.writes = usedWrites();
            return result;
        }
        // Fresh labels only; empty friendlies allowed, length bound applies.
        if (!cosmeticValid(current.componentFriendly) || !cosmeticValid(current.friendly)) {
            result.error = QStringLiteral("cleared shortcut entry is unbounded");
            result.writes = usedWrites();
            return result;
        }
        QList<int> defaults;
        if (!m_store->defaultShortcutKeys(entry.component, entry.action, current.componentFriendly,
                                          current.friendly, &defaults, &error)) {
            result.error = error.isEmpty() ? QStringLiteral("defaultShortcutKeys call failed") : error;
            result.writes = usedWrites();
            return result;
        }
        if (!checkOwner(&error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        if (!m_store->setForeignShortcutKeys(entry.component, entry.action, current.componentFriendly,
                                             current.friendly, defaults, &error)) {
            result.error = error.isEmpty() ? QStringLiteral("setForeignShortcutKeys call failed") : error;
            result.writes = usedWrites();
            return result;
        }
    }
    if (!m_cleared->clear(&error)) {
        result.error = error.isEmpty() ? QStringLiteral("could not clear the cleared shortcut list") : error;
        result.writes = usedWrites();
        return result;
    }
    result.ok = true;
    result.writes = usedWrites();
    ShortcutDiag::log(QtInfoMsg, "revert", "finish", "ok", QStringLiteral("writes=%1").arg(result.writes));
    return result;
}

bool ShortcutReconciler::forceMismatchFromRow(const ClearRow &row, ShortcutForceMismatch *out)
{
    if (!out) {
        return false;
    }
    ShortcutForceMismatch mismatch;
    mismatch.component = row.component;
    mismatch.action = row.action;
    mismatch.expectedPre = row.removals;
    mismatch.actual = row.active;
    mismatch.post = row.remainder;
    mismatch.componentFriendly = row.componentFriendly;
    mismatch.friendly = row.friendly;
    *out = mismatch;
    return true;
}

ShortcutForcePreview ShortcutReconciler::buildForcePreview()
{
    ShortcutForcePreview preview;
    auto refuse = [&](const QString &message) {
        preview.forceable = false;
        preview.error = message;
        return preview;
    };
    if (!m_store) {
        return refuse(QStringLiteral("reconciler is not configured"));
    }
    HolderSnapshot snap;
    QString error;
    if (!collectHolderSnapshot(&snap, &error)) {
        return refuse(error);
    }
    // Lock preconditions are relocate logic, never forceable: even with
    // clearable holders, a lock binding with nothing to replace refuses the
    // preview up front instead of failing mid-force after clearing.
    if (!snap.lock.active.contains(SHORTCUT_META_L) && !snap.lock.active.contains(SHORTCUT_META_ESC)) {
        return refuse(QStringLiteral("refusing to apply: lock binding has no Meta+L to replace"));
    }
    preview.owner = snap.owner;
    preview.uid = snap.uid;
    preview.liveImages = {snap.focus.active, snap.lock.active, snap.resizeUp.active, snap.resizeRight.active,
                          snap.floatToggle.active, snap.maximizeToggle.active};
    if (!snap.blocked.isEmpty()) {
        const Blocker &first = snap.blocked.first();
        return refuse(QStringLiteral("refusing force: %1 is claimed by %2/%3 with no active binding to clear")
                          .arg(keyDisplayName(first.key), first.component, first.action));
    }
    if (snap.rows.isEmpty()) {
        return refuse(QStringLiteral("no forced override applies: no holder claims a project-required key"));
    }
    for (const ClearRow &row : snap.rows) {
        ShortcutForceMismatch mismatch;
        forceMismatchFromRow(row, &mismatch);
        preview.mismatches.append(mismatch);
    }
    preview.forceable = true;
    return preview;
}

ShortcutForcePreview ShortcutReconciler::previewForceApply()
{
    ShortcutForcePreview preview = buildForcePreview();
    if (preview.forceable) {
        QStringList rows;
        for (const ShortcutForceMismatch &mismatch : preview.mismatches) {
            rows.append(QStringLiteral("%1/%2 actual=%3 remove=%4 keep=%5")
                            .arg(mismatch.component, mismatch.action, keysDisplay(mismatch.actual),
                                 keysDisplay(mismatch.expectedPre), keysDisplay(mismatch.post)));
        }
        ShortcutDiag::log(QtInfoMsg, "force-preview", "preview", "forceable", rows.join(QStringLiteral("; ")));
    } else {
        ShortcutDiag::log(QtDebugMsg, "force-preview", "preview", "not-forceable", preview.error);
    }
    return preview;
}

ShortcutForceApplyResult ShortcutReconciler::applyForced(const ShortcutForcePreview &confirmed)
{
    ShortcutForceApplyResult result;
    auto fail = [&](const QString &message, const char *outcome) {
        result.ok = false;
        result.error = message;
        result.writes = 0;
        ShortcutDiag::log(QtWarningMsg, "force-apply", "confirm", outcome, message);
        return result;
    };
    if (!m_store || !m_cleared) {
        if (!m_store) {
            return fail(QStringLiteral("reconciler is not configured"), "unconfigured");
        }
        return fail(QStringLiteral("cleared shortcut store is not configured"), "unconfigured");
    }
    if (!confirmed.forceable) {
        return fail(QStringLiteral("no confirmed forced override to apply"), "no-confirmation");
    }
    if (confirmed.mismatches.isEmpty() || confirmed.mismatches.size() > SHORTCUT_MAX_TUPLES) {
        return fail(QStringLiteral("forced override is unbounded"), "unbounded");
    }
    // No arbitrary action/key inputs: every confirmed row must carry a
    // bounded identity with removals/remainder exactly derived from its
    // actuals. Anything forged fails closed here.
    QStringList seen;
    for (const ShortcutForceMismatch &mismatch : confirmed.mismatches) {
        if (!stringValid(mismatch.component) || !stringValid(mismatch.action)
            || !cosmeticValid(mismatch.componentFriendly) || !cosmeticValid(mismatch.friendly)
            || !keysValid(mismatch.actual) || !keysValid(mismatch.expectedPre) || !keysValid(mismatch.post)
            || mismatch.actual.isEmpty() || mismatch.expectedPre.isEmpty()) {
            return fail(QStringLiteral("forced override is unbounded"), "unbounded");
        }
        const QString id = mismatch.component + QStringLiteral("/") + mismatch.action;
        if (seen.contains(id)) {
            return fail(QStringLiteral("forced override is unbounded"), "duplicate");
        }
        seen.append(id);
        if (mismatch.expectedPre != conflictingKeys(mismatch.actual)
            || mismatch.post != remainderAfterClear(mismatch.actual)) {
            return fail(QStringLiteral("forced override is unbounded"), "image-mismatch");
        }
    }
    // Revalidation after confirmation, before any write (including
    // cleared-list writes): recompute the full preflight and require the
    // exact confirmed snapshot.
    const ShortcutForcePreview current = buildForcePreview();
    if (!current.forceable) {
        return fail(current.error.isEmpty() ? QStringLiteral("confirmed force image is stale; re-preview before forcing")
                                            : current.error,
                    "stale");
    }
    if (current.owner != confirmed.owner || current.uid != confirmed.uid
        || current.liveImages != confirmed.liveImages
        || current.mismatches.size() != confirmed.mismatches.size()) {
        return fail(QStringLiteral("confirmed force image is stale; re-preview before forcing"), "stale");
    }
    for (int i = 0; i < current.mismatches.size(); ++i) {
        const ShortcutForceMismatch &a = current.mismatches.at(i);
        const ShortcutForceMismatch &b = confirmed.mismatches.at(i);
        if (a.component != b.component || a.action != b.action || a.expectedPre != b.expectedPre
            || a.actual != b.actual || a.post != b.post || a.componentFriendly != b.componentFriendly
            || a.friendly != b.friendly) {
            return fail(QStringLiteral("confirmed force image is stale; re-preview before forcing"), "stale");
        }
    }
    const int startWrites = m_store->writeCount();
    auto usedWrites = [&]() {
        return m_store->writeCount() - startWrites;
    };
    // Durable union BEFORE clearing: an interrupted Force stays revertible.
    QList<ClearedAction> existing;
    QString storeError;
    if (!m_cleared->load(&existing, &storeError)) {
        return fail(storeError.isEmpty() ? QStringLiteral("cleared shortcut load failed") : storeError,
                    "persist-failed");
    }
    QList<ClearedAction> merged = existing;
    for (const ShortcutForceMismatch &mismatch : confirmed.mismatches) {
        ClearedAction entry;
        entry.component = mismatch.component;
        entry.action = mismatch.action;
        // Union by ID only: transient preview labels are never persisted.
        bool found = false;
        for (const ClearedAction &prior : merged) {
            if (clearedActionSameId(prior, entry)) {
                found = true;
                break;
            }
        }
        if (!found) {
            merged.append(entry);
        }
    }
    if (!m_cleared->save(merged, &storeError)) {
        return fail(storeError.isEmpty() ? QStringLiteral("cleared shortcut persist failed") : storeError,
                    "persist-failed");
    }
    const QString owner = current.owner;
    const uint uid = current.uid;
    auto checkOwner = [&](QString *ownerError) {
        QString liveOwner;
        uint liveUid = 0;
        if (!m_store->currentOwner(&liveOwner, &liveUid, ownerError)) {
            return false;
        }
        if (liveOwner != owner || liveUid != uid) {
            if (ownerError) {
                *ownerError = QStringLiteral("KGlobalAccel service owner drifted");
            }
            return false;
        }
        return true;
    };
    // Clear only the conflicting keys from each holder; unrelated keys stay.
    // Fresh per-holder re-read immediately before each foreign setter: the
    // confirmed post image is stale, so abort when the live active list no
    // longer matches the confirmed actual. This keeps a concurrent
    // unrelated-key change from being erased. Owner is re-checked first.
    // The persisted union is already written here, so this abort retains
    // the list (a superset when the drifted holder was never cleared);
    // Revert may then restore an action Force never cleared.
    for (const ShortcutForceMismatch &mismatch : confirmed.mismatches) {
        if (!checkOwner(&storeError)) {
            result.ok = false;
            result.error = storeError;
            result.writes = usedWrites();
            ShortcutDiag::log(QtWarningMsg, "force-apply", "clear", "drifted", storeError);
            return result;
        }
        {
            const int probeKey = mismatch.expectedPre.isEmpty() ? 0 : mismatch.expectedPre.first();
            QList<ShortcutKeyHolder> liveHolders;
            QString keyError;
            if (probeKey == 0 || !m_store->shortcutsByKey(probeKey, &liveHolders, &keyError)) {
                result.ok = false;
                result.error = keyError.isEmpty()
                    ? QStringLiteral("confirmed force image is stale; re-preview before forcing")
                    : keyError;
                result.writes = usedWrites();
                ShortcutDiag::log(QtWarningMsg, "force-apply", "clear", "stale", result.error);
                return result;
            }
            bool found = false;
            for (const ShortcutKeyHolder &live : liveHolders) {
                if (live.component == mismatch.component && live.action == mismatch.action) {
                    found = true;
                    if (live.active != mismatch.actual) {
                        result.ok = false;
                        result.error =
                            QStringLiteral("confirmed force image is stale; re-preview before forcing");
                        result.writes = usedWrites();
                        ShortcutDiag::log(QtWarningMsg, "force-apply", "clear", "stale", result.error);
                        return result;
                    }
                    break;
                }
            }
            if (!found) {
                result.ok = false;
                result.error = QStringLiteral("confirmed force image is stale; re-preview before forcing");
                result.writes = usedWrites();
                ShortcutDiag::log(QtWarningMsg, "force-apply", "clear", "stale", result.error);
                return result;
            }
        }
        if (!m_store->setForeignShortcutKeys(mismatch.component, mismatch.action, mismatch.componentFriendly,
                                             mismatch.friendly, mismatch.post, &storeError)) {
            result.ok = false;
            result.error =
                storeError.isEmpty() ? QStringLiteral("setForeignShortcutKeys call failed") : storeError;
            result.writes = usedWrites();
            ShortcutDiag::log(QtWarningMsg, "force-apply", "clear", "failed", result.error);
            return result;
        }
    }
    // Project assignments from a fresh read now that holders are cleared.
    const ShortcutApplyResult projects = writeProjectKeys("force-apply");
    result.ok = projects.ok;
    result.error = projects.error;
    result.writes = usedWrites();
    ShortcutDiag::log(result.ok ? QtInfoMsg : QtWarningMsg, "force-apply", "finish", result.ok ? "ok" : "failed",
                      QStringLiteral("writes=%1").arg(result.writes));
    return result;
}

} // namespace KWin
