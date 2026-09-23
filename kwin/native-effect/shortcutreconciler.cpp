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

// Shared exact journal-entry comparison (component/action/pre/post), used by
// the persist readback and the force upgrade stale-image checks alike.
bool journalEntryEqual(const ShortcutJournalEntry &a, const ShortcutJournalEntry &b)
{
    return a.component == b.component && a.action == b.action && a.pre == b.pre && a.post == b.post;
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

QString keysToString(const QList<int> &keys)
{
    QStringList parts;
    parts.reserve(keys.size());
    for (int key : keys) {
        parts.append(QString::number(key));
    }
    return parts.join(QStringLiteral(","));
}

QList<int> keysFromString(const QString &value, bool *ok)
{
    QList<int> keys;
    if (value.isEmpty()) {
        if (ok) {
            *ok = true;
        }
        return keys;
    }
    const QStringList parts = value.split(QStringLiteral(","));
    for (const QString &part : parts) {
        bool parsed = false;
        const int key = part.toInt(&parsed);
        if (!parsed) {
            if (ok) {
                *ok = false;
            }
            return {};
        }
        keys.append(key);
    }
    if (ok) {
        *ok = true;
    }
    return keys;
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

bool journalEntryValid(const ShortcutJournalEntry &entry)
{
    if (!ShortcutReconciler::isAllowlisted(entry.component, entry.action)) {
        return false;
    }
    return ShortcutReconciler::keysValid(entry.pre) && ShortcutReconciler::keysValid(entry.post);
}

bool readJournalKeys(const KConfigGroup &group, const QString &key, QList<int> *out, QString *error)
{
    bool ok = false;
    const QList<int> values = keysFromString(group.readEntry(key, QString()), &ok);
    if (!ok) {
        if (error) {
            *error = QStringLiteral("journal is malformed");
        }
        return false;
    }
    if (out) {
        *out = values;
    }
    return true;
}

void writeJournalEntry(KConfigGroup &group, const QString &prefix, const ShortcutJournalEntry &entry)
{
    group.writeEntry(prefix + QStringLiteral("Component"), entry.component);
    group.writeEntry(prefix + QStringLiteral("Action"), entry.action);
    group.writeEntry(prefix + QStringLiteral("Pre"), keysToString(entry.pre));
    group.writeEntry(prefix + QStringLiteral("Post"), keysToString(entry.post));
}

bool readJournalEntry(const KConfigGroup &group, const QString &prefix, ShortcutJournalEntry *out, QString *error)
{
    out->component = group.readEntry(prefix + QStringLiteral("Component"), QString());
    out->action = group.readEntry(prefix + QStringLiteral("Action"), QString());
    return readJournalKeys(group, prefix + QStringLiteral("Pre"), &out->pre, error)
        && readJournalKeys(group, prefix + QStringLiteral("Post"), &out->post, error);
}

// One exact ordered journal comparison for persist readback: every scalar
// field in fixed order, including all ten entries even for v2 (v2 persists
// carry the new rows empty and inert, so they must round-trip too) and all
// schema, phase, owner, UID, and row-kind scalars.
bool journalsEqual(const ShortcutJournal &a, const ShortcutJournal &b)
{
    if (a.schema != b.schema || a.phase != b.phase || a.owner != b.owner || a.uid != b.uid) {
        return false;
    }
    const ShortcutJournalEntry *aEntries[10] = {&a.focus, &a.lock, &a.resizeUp, &a.switchNext,
                                                &a.resizeRight, &a.switchLast, &a.floatToggle, &a.gridView,
                                                &a.maximizeToggle, &a.monocle};
    const ShortcutJournalEntry *bEntries[10] = {&b.focus, &b.lock, &b.resizeUp, &b.switchNext,
                                                &b.resizeRight, &b.switchLast, &b.floatToggle, &b.gridView,
                                                &b.maximizeToggle, &b.monocle};
    for (int i = 0; i < 10; ++i) {
        if (!journalEntryEqual(*aEntries[i], *bEntries[i])) {
            return false;
        }
    }
    return a.row0Kind == b.row0Kind && a.row1Kind == b.row1Kind && a.row2Kind == b.row2Kind
        && a.row3Kind == b.row3Kind && a.row4Kind == b.row4Kind;
}

bool ensurePrivateDir(const QString &dirPath, QString *error)
{
    QDir dir;
    if (!dir.mkpath(dirPath)) {
        if (error) {
            *error = QStringLiteral("could not create the journal directory");
        }
        return false;
    }
    // Owner-safe private permissions: user-owned mode 0700 exactly.
    const QByteArray encoded = dirPath.toLocal8Bit();
    struct stat st = {};
    if (::stat(encoded.constData(), &st) != 0) {
        if (error) {
            *error = QStringLiteral("could not stat the journal directory");
        }
        return false;
    }
    if (st.st_uid != static_cast<uid_t>(::geteuid())) {
        if (error) {
            *error = QStringLiteral("journal directory is not owned by this user");
        }
        return false;
    }
    if ((st.st_mode & 0077) != 0) {
        if (::chmod(encoded.constData(), 0700) != 0) {
            if (error) {
                *error = QStringLiteral("journal directory is not private");
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
            *error = QStringLiteral("journal file is not owned by this user");
        }
        return false;
    }
    if ((st.st_mode & 0077) != 0) {
        if (::chmod(encoded.constData(), 0600) != 0) {
            if (error) {
                *error = QStringLiteral("journal file is not private");
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
            if (isAllowlisted(holder.component, holder.action)) {
                continue;
            }
            if (isAuthorizedDisplacement(key, holder.component, holder.action)) {
                continue;
            }
            return conflict(QStringLiteral("refusing to apply: %1 is claimed by %2/%3")
                                .arg(keyDisplayName(key), holder.component, holder.action));
        }
        // Whole-key consistency, fail closed both directions:
        // globalShortcutAvailable(key, "") reports whole-key availability,
        // so empty holders must report available and non-empty holders
        // must report unavailable. Allowlisted/authorized holders count
        // as occupying the key, so they keep the non-empty/unavailable
        // expectation and stay Clear after the skips above.
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

bool ShortcutReconciler::journalPathSafe(const QString &path, QString *error)
{
    if (path.isEmpty()) {
        if (error) {
            *error = QStringLiteral("journal path is empty; refusing CWD fallback");
        }
        return false;
    }
    if (!QDir::isAbsolutePath(path)) {
        if (error) {
            *error = QStringLiteral("journal path must be absolute; refusing CWD fallback");
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
                    *error = QStringLiteral("journal path must not be a symlink");
                }
                return false;
            }
            if (!S_ISREG(st.st_mode)) {
                if (error) {
                    *error = QStringLiteral("journal path must be a regular file");
                }
                return false;
            }
            if (st.st_uid != static_cast<uid_t>(::geteuid())) {
                if (error) {
                    *error = QStringLiteral("journal file is not owned by this user");
                }
                return false;
            }
            if ((st.st_mode & 0077) != 0) {
                if (error) {
                    *error = QStringLiteral("journal file is not private");
                }
                return false;
            }
            Q_UNUSED(leaf);
        }
    }
    // The direct journal directory is the writable trust boundary. It may be
    // readable (legacy kcmshell6), but cannot be foreign-owned or writable by
    // group/other; all ancestors are still checked for symlinks below.
    QDir parent = QFileInfo(path).dir();
    {
        struct stat st = {};
        const QByteArray encoded = parent.path().toLocal8Bit();
        if (::lstat(encoded.constData(), &st) == 0) {
            if (S_ISLNK(st.st_mode) || !S_ISDIR(st.st_mode) || st.st_uid != static_cast<uid_t>(::geteuid())
                || (st.st_mode & 0022) != 0) {
                if (error) {
                    *error = QStringLiteral("journal parent directory is unsafe");
                }
                return false;
            }
        } else if (errno != ENOENT) {
            if (error) {
                *error = QStringLiteral("journal parent directory is unavailable");
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
                    *error = QStringLiteral("journal parent path must not contain a symlink");
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

bool ShortcutReconciler::journalRolesValid(const ShortcutJournal &journal)
{
    const QList<ShortcutConflictRow> &table = shortcutConflictTable();
    if (table.size() != 5) {
        return false;
    }
    if (journal.focus.component != table.at(0).projectComponent || journal.focus.action != table.at(0).projectAction
        || journal.lock.component != table.at(0).foreignComponent || journal.lock.action != table.at(0).foreignAction
        || journal.resizeUp.component != table.at(1).projectComponent
        || journal.resizeUp.action != table.at(1).projectAction || journal.switchNext.component != table.at(1).foreignComponent
        || journal.switchNext.action != table.at(1).foreignAction || journal.resizeRight.component != table.at(2).projectComponent
        || journal.resizeRight.action != table.at(2).projectAction || journal.switchLast.component != table.at(2).foreignComponent
        || journal.switchLast.action != table.at(2).foreignAction) {
        return false;
    }
    if (journal.row0Kind != table.at(0).resolution || journal.row1Kind != table.at(1).resolution
        || journal.row2Kind != table.at(2).resolution) {
        return false;
    }
    if (journal.schema == shortcutJournalSchemaV2()) {
        // v2 journals carry only the original three rows; rows 3-4 are
        // never read or assumed here.
        return true;
    }
    if (journal.floatToggle.component != table.at(3).projectComponent
        || journal.floatToggle.action != table.at(3).projectAction || journal.gridView.component != table.at(3).foreignComponent
        || journal.gridView.action != table.at(3).foreignAction || journal.maximizeToggle.component != table.at(4).projectComponent
        || journal.maximizeToggle.action != table.at(4).projectAction || journal.monocle.component != table.at(4).foreignComponent
        || journal.monocle.action != table.at(4).foreignAction) {
        return false;
    }
    return journal.row3Kind == table.at(3).resolution && journal.row4Kind == table.at(4).resolution;
}

bool ShortcutReconciler::journalPostsValid(const ShortcutJournal &journal)
{
    if (journal.focus.post != focusPostKeys() || journal.lock.post != lockPostFor(journal.lock.pre)
        || journal.resizeUp.post != resizeUpPostKeys() || !journal.switchNext.post.isEmpty()
        || journal.resizeRight.post != resizeRightPostKeys() || !journal.switchLast.post.isEmpty()) {
        return false;
    }
    if (journal.schema == shortcutJournalSchemaV2()) {
        return true;
    }
    return journal.floatToggle.post == floatPostKeys() && journal.gridView.post.isEmpty()
        && journal.maximizeToggle.post == maximizePostKeys() && journal.monocle.post.isEmpty();
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

KConfigFileJournal::KConfigFileJournal(const QString &filePath)
    : m_filePath(filePath)
{
}

bool KConfigFileJournal::validateDiscovery(QString *error) const
{
    struct stat st = {};
    const QByteArray encoded = m_filePath.toLocal8Bit();
    if (::lstat(encoded.constData(), &st) != 0) {
        if (errno == ENOENT) {
            return true;
        }
        if (error) {
            *error = QStringLiteral("journal path is unavailable");
        }
        return false;
    }
    return ShortcutReconciler::journalPathSafe(m_filePath, error);
}

bool KConfigFileJournal::hasExistingPath() const
{
    struct stat st = {};
    return ::lstat(m_filePath.toLocal8Bit().constData(), &st) == 0;
}

bool KConfigFileJournal::hasJournal() const
{
    if (!validateDiscovery(nullptr)) {
        return false;
    }
    KConfig config(m_filePath, KConfig::SimpleConfig);
    const KConfigGroup group = config.group(shortcutJournalGroup());
    return group.hasKey(QStringLiteral("SchemaVersion")) && group.hasKey(QStringLiteral("Phase"));
}

bool KConfigFileJournal::load(ShortcutJournal *journal, QString *error) const
{
    if (!journal) {
        return false;
    }
    if (!ShortcutReconciler::journalPathSafe(m_filePath, error)) {
        return false;
    }
    KConfig config(m_filePath, KConfig::SimpleConfig);
    const KConfigGroup group = config.group(shortcutJournalGroup());
    ShortcutJournal loaded;
    loaded.schema = group.readEntry(QStringLiteral("SchemaVersion"), QString());
    loaded.phase = group.readEntry(QStringLiteral("Phase"), QString());
    loaded.owner = group.readEntry(QStringLiteral("Owner"), QString());
    loaded.uid = group.readEntry(QStringLiteral("Uid"), 0u);
    loaded.row0Kind = group.readEntry(QStringLiteral("Row0Kind"), QString());
    loaded.row1Kind = group.readEntry(QStringLiteral("Row1Kind"), QString());
    loaded.row2Kind = group.readEntry(QStringLiteral("Row2Kind"), QString());
    loaded.row3Kind = group.readEntry(QStringLiteral("Row3Kind"), QString());
    loaded.row4Kind = group.readEntry(QStringLiteral("Row4Kind"), QString());
    if (!readJournalEntry(group, QStringLiteral("Focus"), &loaded.focus, error)
        || !readJournalEntry(group, QStringLiteral("Lock"), &loaded.lock, error)
        || !readJournalEntry(group, QStringLiteral("ResizeUp"), &loaded.resizeUp, error)
        || !readJournalEntry(group, QStringLiteral("SwitchNext"), &loaded.switchNext, error)
        || !readJournalEntry(group, QStringLiteral("ResizeRight"), &loaded.resizeRight, error)
        || !readJournalEntry(group, QStringLiteral("SwitchLast"), &loaded.switchLast, error)
        || !readJournalEntry(group, QStringLiteral("FloatToggle"), &loaded.floatToggle, error)
        || !readJournalEntry(group, QStringLiteral("GridView"), &loaded.gridView, error)
        || !readJournalEntry(group, QStringLiteral("MaximizeToggle"), &loaded.maximizeToggle, error)
        || !readJournalEntry(group, QStringLiteral("Monocle"), &loaded.monocle, error)) {
        return false;
    }
    if (loaded.schema == QStringLiteral("shortcut-override-v1")) {
        if (error) {
            *error = QStringLiteral("journal schema version v1 is unsupported; expected shortcut-override-v3 (upgrade required, no migration)");
        }
        return false;
    }
    const bool isV2 = loaded.schema == shortcutJournalSchemaV2();
    if (!isV2 && loaded.schema != shortcutJournalSchema()) {
        if (error) {
            *error = QStringLiteral("journal schema is unknown");
        }
        return false;
    }
    if (loaded.phase != shortcutJournalPhasePending() && loaded.phase != shortcutJournalPhaseFocusApplied()
        && loaded.phase != shortcutJournalPhaseComplete()) {
        if (error) {
            *error = QStringLiteral("journal phase is unknown");
        }
        return false;
    }
    if (!journalEntryValid(loaded.focus) || !journalEntryValid(loaded.lock) || !journalEntryValid(loaded.resizeUp)
        || !journalEntryValid(loaded.switchNext) || !journalEntryValid(loaded.resizeRight)
        || !journalEntryValid(loaded.switchLast)) {
        if (error) {
            *error = QStringLiteral("journal entries are outside the exact allowlist");
        }
        return false;
    }
    if (!isV2) {
        // v3 journals always carry rows 3-4; v2 journals never do and their
        // (empty) new-row fields are ignored, never assumed.
        if (!journalEntryValid(loaded.floatToggle) || !journalEntryValid(loaded.gridView)
            || !journalEntryValid(loaded.maximizeToggle) || !journalEntryValid(loaded.monocle)) {
            if (error) {
                *error = QStringLiteral("journal entries are outside the exact allowlist");
            }
            return false;
        }
    }
    // Exact ordered roles: table order plus resolution kinds.
    if (!ShortcutReconciler::journalRolesValid(loaded)) {
        if (error) {
            *error = QStringLiteral("journal roles are swapped or not the exact allowlist");
        }
        return false;
    }
    if (!ShortcutReconciler::journalPostsValid(loaded)) {
        if (error) {
            *error = QStringLiteral("journal postimage is not the allowed image");
        }
        return false;
    }
    if (!ShortcutReconciler::uniqueNameValid(loaded.owner)) {
        if (error) {
            *error = QStringLiteral("journal owner is malformed");
        }
        return false;
    }
    *journal = loaded;
    return true;
}

bool KConfigFileJournal::persist(const ShortcutJournal &journal, QString *error)
{
    // Reject invalid phase/owner/UID up front, before any I/O.
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
    const bool persistV2 = journal.schema == shortcutJournalSchemaV2();
    if ((!persistV2 && journal.schema != shortcutJournalSchema()) || !journalEntryValid(journal.focus) || !journalEntryValid(journal.lock)
        || !journalEntryValid(journal.resizeUp) || !journalEntryValid(journal.switchNext)
        || !journalEntryValid(journal.resizeRight) || !journalEntryValid(journal.switchLast)
        || !ShortcutReconciler::journalRolesValid(journal)) {
        if (error) {
            *error = QStringLiteral("refusing to persist a journal outside the exact allowlist");
        }
        return false;
    }
    if (!persistV2) {
        // v3 journals always carry rows 3-4; v2 persists keep only the
        // original three rows (new-row fields persist empty and inert).
        if (!journalEntryValid(journal.floatToggle) || !journalEntryValid(journal.gridView)
            || !journalEntryValid(journal.maximizeToggle) || !journalEntryValid(journal.monocle)) {
            if (error) {
                *error = QStringLiteral("refusing to persist a journal outside the exact allowlist");
            }
            return false;
        }
    }
    if (!ShortcutReconciler::journalPathSafe(m_filePath, error)) {
        return false;
    }
    const QString parentPath = QFileInfo(m_filePath).dir().path();
    if (!ensurePrivateDir(parentPath, error)) {
        return false;
    }
    {
        KConfig config(m_filePath, KConfig::SimpleConfig);
        KConfigGroup group = config.group(shortcutJournalGroup());
        group.writeEntry(QStringLiteral("SchemaVersion"), journal.schema);
        group.writeEntry(QStringLiteral("Phase"), journal.phase);
        group.writeEntry(QStringLiteral("Owner"), journal.owner);
        group.writeEntry(QStringLiteral("Uid"), journal.uid);
        writeJournalEntry(group, QStringLiteral("Focus"), journal.focus);
        writeJournalEntry(group, QStringLiteral("Lock"), journal.lock);
        writeJournalEntry(group, QStringLiteral("ResizeUp"), journal.resizeUp);
        writeJournalEntry(group, QStringLiteral("SwitchNext"), journal.switchNext);
        writeJournalEntry(group, QStringLiteral("ResizeRight"), journal.resizeRight);
        writeJournalEntry(group, QStringLiteral("SwitchLast"), journal.switchLast);
        writeJournalEntry(group, QStringLiteral("FloatToggle"), journal.floatToggle);
        writeJournalEntry(group, QStringLiteral("GridView"), journal.gridView);
        writeJournalEntry(group, QStringLiteral("MaximizeToggle"), journal.maximizeToggle);
        writeJournalEntry(group, QStringLiteral("Monocle"), journal.monocle);
        group.writeEntry(QStringLiteral("Row0Kind"), journal.row0Kind);
        group.writeEntry(QStringLiteral("Row1Kind"), journal.row1Kind);
        group.writeEntry(QStringLiteral("Row2Kind"), journal.row2Kind);
        group.writeEntry(QStringLiteral("Row3Kind"), journal.row3Kind);
        group.writeEntry(QStringLiteral("Row4Kind"), journal.row4Kind);
        config.sync();
    }
    // Private owner-safe permissions without weakening KConfig durability
    // (sync already completed; chmod only tightens).
    if (!ensurePrivateFile(m_filePath, error)) {
        return false;
    }
    // Write+sync+readback before any mutation.
    ShortcutJournal readback;
    if (!load(&readback, nullptr)) {
        if (error) {
            *error = QStringLiteral("journal readback failed");
        }
        return false;
    }
    if (!journalsEqual(readback, journal)) {
        if (error) {
            *error = QStringLiteral("journal readback mismatch");
        }
        return false;
    }
    return true;
}

bool KConfigFileJournal::remove(QString *error)
{
    if (!ShortcutReconciler::journalPathSafe(m_filePath, error)) {
        return false;
    }
    if (!QFile::exists(m_filePath)) {
        return true;
    }
    // Only remove the project-owned journal file, never global config.
    if (!QFile::remove(m_filePath)) {
        if (error) {
            *error = QStringLiteral("could not remove the journal");
        }
        return false;
    }
    return true;
}

ShortcutReconciler::ShortcutReconciler(ShortcutStore *store, JournalStore *journal)
    : m_store(store)
    , m_journal(journal)
{
}

void ShortcutReconciler::setLegacyJournal(JournalStore *legacy)
{
    m_legacyJournal = legacy;
}

ShortcutStore *createLiveShortcutStore()
{
    return new KGlobalAccelStore;
}

JournalStore *createLiveShortcutJournal(const QString &filePath)
{
    return new KConfigFileJournal(filePath);
}

Q_LOGGING_CATEGORY(lcShortcut, "plasmaautotiler.shortcut");

namespace
{

ShortcutLogSink g_shortcutLogSink;

QString journalSelectorDetail(const QString &selector, const QString &schema, const QString &phase, bool migrated)
{
    return QStringLiteral("journal=%1 schema=%2 phase=%3 migrated=%4")
        .arg(selector, schema.isEmpty() ? QStringLiteral("-") : schema,
             phase.isEmpty() ? QStringLiteral("-") : phase, migrated ? QStringLiteral("true") : QStringLiteral("false"));
}

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

QString defaultShortcutJournalPath()
{
    // Host-independent canonical location: project-owned, shared by every
    // KCM host (kcmshell6, System Settings). Never falls back to CWD.
    const QString base = QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation);
    if (base.isEmpty() || !QDir::isAbsolutePath(base)) {
        return QString();
    }
    return base + QStringLiteral("/plasma-auto-tiler/shortcut-override-journalrc");
}

QString legacyShortcutJournalPath()
{
    // Single explicit legacy source: the kcmshell6-host journal. The only
    // migration source; directory scans are never used.
    const QString base = QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation);
    if (base.isEmpty() || !QDir::isAbsolutePath(base)) {
        return QString();
    }
    return base + QStringLiteral("/kcmshell6/shortcut-override-journalrc");
}

JournalMigrationResult migrateLegacyShortcutJournal(const QString &canonicalPath, const QString &legacyPath)
{
    JournalMigrationResult result;
    QString pathError;
    auto fail = [&](const char *outcome, const QString &message, const QString &selector) {
        result.ok = false;
        result.migrated = false;
        result.error = message;
        ShortcutDiag::log(QtWarningMsg, "migrate", "legacy-journal", outcome,
                          journalSelectorDetail(selector, QString(), QString(), false));
        return result;
    };
    if (canonicalPath.isEmpty() || legacyPath.isEmpty()) {
        return fail("unavailable", QStringLiteral("canonical shortcut journal path is unavailable"),
                    QStringLiteral("canonical"));
    }
    if (canonicalPath == legacyPath) {
        result.ok = true;
        ShortcutDiag::log(QtDebugMsg, "migrate", "legacy-journal", "same-path",
                          QStringLiteral("canonical=present legacy=present"));
        return result;
    }
    KConfigFileJournal canonical(canonicalPath);
    if (!canonical.validateDiscovery(&pathError)) {
        return fail("unsafe", QStringLiteral("canonical shortcut journal is unsafe; refusing migration"),
                    QStringLiteral("canonical"));
    }
    if (canonical.hasJournal()) {
        // Canonical authority wins; a stale legacy file is ignored, never
        // merged and never an ambiguity failure (post-migration runs always
        // have both files).
        result.ok = true;
        ShortcutDiag::log(QtDebugMsg, "migrate", "legacy-journal", "canonical-present",
                          journalSelectorDetail(QStringLiteral("canonical"), QString(), QString(), false));
        return result;
    }
    if (canonical.hasExistingPath()) {
        return fail("malformed", QStringLiteral("canonical shortcut journal is malformed; refusing migration"),
                    QStringLiteral("canonical"));
    }
    KConfigFileJournal legacy(legacyPath);
    if (!legacy.validateDiscovery(&pathError)) {
        return fail("unsafe", QStringLiteral("legacy shortcut journal is unsafe; refusing migration"),
                    QStringLiteral("legacy"));
    }
    if (!QFile::exists(legacyPath)) {
        result.ok = true;
        ShortcutDiag::log(QtDebugMsg, "migrate", "legacy-journal", "legacy-absent",
                          journalSelectorDetail(QStringLiteral("legacy"), QString(), QString(), false));
        return result;
    }
    if (!legacy.hasJournal()) {
        return fail("malformed", QStringLiteral("legacy shortcut journal is malformed; refusing migration"),
                    QStringLiteral("legacy"));
    }
    ShortcutJournal journal;
    if (!legacy.load(&journal, &pathError)) {
        return fail("malformed", QStringLiteral("legacy shortcut journal is malformed; refusing migration"),
                    QStringLiteral("legacy"));
    }
    if (journal.uid != static_cast<uint>(::geteuid())) {
        return fail("foreign-uid", QStringLiteral("legacy shortcut journal has a foreign UID; refusing migration"),
                    QStringLiteral("legacy"));
    }
    // Exact copy: schema, phase, owner, and every pre/post image are carried
    // over untouched so the original undo history is preserved. persist
    // revalidates and readbacks before reporting success.
    if (!canonical.persist(journal, &pathError)) {
        return fail("persist-failed", QStringLiteral("legacy shortcut journal migration failed; refusing migration"),
                    QStringLiteral("canonical"));
    }
    result.ok = true;
    result.migrated = true;
    ShortcutDiag::log(QtInfoMsg, "migrate", "legacy-journal", "migrated",
                      journalSelectorDetail(QStringLiteral("legacy"), journal.schema, journal.phase, true));
    return result;
}

bool ShortcutReconciler::collectLiveSnapshot(LiveSnapshot *snapshot, QString *error)
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
    LiveSnapshot snap;
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
    if (!findAllowlisted(tuples, shortcutFocusComponent(), shortcutFocusAction(), &snap.focus, error)) {
        return false;
    }
    if (!findAllowlisted(tuples, shortcutLockComponent(), shortcutLockAction(), &snap.lock, error)) {
        return false;
    }
    if (!findAllowlisted(tuples, shortcutResizeUpComponent(), shortcutResizeUpAction(), &snap.resizeUp, error)
        || !findAllowlisted(tuples, shortcutSwitchNextComponent(), shortcutSwitchNextAction(), &snap.switchNext,
                            error)
        || !findAllowlisted(tuples, shortcutResizeRightComponent(), shortcutResizeRightAction(), &snap.resizeRight,
                            error)
        || !findAllowlisted(tuples, shortcutSwitchLastComponent(), shortcutSwitchLastAction(), &snap.switchLast,
                            error)
        || !findAllowlisted(tuples, shortcutFloatComponent(), shortcutFloatAction(), &snap.floatToggle, error)
        || !findAllowlisted(tuples, shortcutGridViewComponent(), shortcutGridViewAction(), &snap.gridView, error)
        || !findAllowlisted(tuples, shortcutMaximizeComponent(), shortcutMaximizeAction(), &snap.maximizeToggle,
                            error)
        || !findAllowlisted(tuples, shortcutMonocleComponent(), shortcutMonocleAction(), &snap.monocle, error)) {
        return false;
    }
    if (!keysValid(snap.focus.active) || !keysValid(snap.lock.active) || !keysValid(snap.resizeUp.active)
        || !keysValid(snap.switchNext.active) || !keysValid(snap.resizeRight.active)
        || !keysValid(snap.switchLast.active) || !keysValid(snap.floatToggle.active)
        || !keysValid(snap.gridView.active) || !keysValid(snap.maximizeToggle.active)
        || !keysValid(snap.monocle.active)) {
        if (error) {
            *error = QStringLiteral("allowlisted tuple is unbounded");
        }
        return false;
    }
    // Independent structural validation of enumerated state (not conflict
    // detection): unbounded unrelated tuples fail closed with zero writes.
    // Foreign conflicts stay authoritative via the keyed lookup below.
    for (const ShortcutTuple &tuple : tuples) {
        if (isAllowlisted(tuple.component, tuple.action)) {
            continue;
        }
        if (!keysValid(tuple.active)) {
            if (error) {
                *error = QStringLiteral("unrelated tuple is unbounded");
            }
            return false;
        }
    }
    // Authoritative keyed foreign-occupancy preflight (Defect B): keyed
    // globalShortcutsByKey + globalShortcutAvailable for Meta+L, Meta+Esc,
    // Meta+Alt+K, Meta+Alt+L. Not tuple/config enumeration, so
    // .desktop-declared-only holders are visible. Fails closed before any
    // journal/write. The explicit System Monitor `_launch` Meta+Esc holder
    // is user-authorized and skipped; every other foreign occupier fails.
    if (!checkKeyedForeignOccupancy(m_store, error)) {
        return false;
    }
    if (snapshot) {
        *snapshot = snap;
    }
    return true;
}

bool ShortcutReconciler::isForcedClearRow(const ShortcutForcePreview *forced, const QString &component,
                                          const QString &action, const QList<int> &live)
{
    if (!forced || !forced->forceable) {
        return false;
    }
    for (const ShortcutForceMismatch &mismatch : forced->mismatches) {
        if (mismatch.component == component && mismatch.action == action && mismatch.actual == live) {
            return true;
        }
    }
    return false;
}

ShortcutApplyResult ShortcutReconciler::apply()
{
    return applyImpl(nullptr);
}

bool ShortcutReconciler::ensureLegacyMigrated(QString *error)
{
    auto fail = [&](const char *outcome, const QString &message, const QString &selector) {
        if (error) {
            *error = message;
        }
        ShortcutDiag::log(QtWarningMsg, "migrate", "legacy-journal", outcome,
                          journalSelectorDetail(selector, QString(), QString(), false));
        return false;
    };
    if (!m_journal) {
        return fail("unconfigured", QStringLiteral("reconciler is not configured"),
                    QStringLiteral("canonical"));
    }
    if (!m_legacyJournal) {
        return true;
    }
    QString discoveryError;
    if (!m_journal->validateDiscovery(&discoveryError)) {
        return fail("unsafe", QStringLiteral("canonical shortcut journal is unsafe; refusing migration"),
                    QStringLiteral("canonical"));
    }
    if (m_journal->hasJournal()) {
        // Canonical authority wins; a stale legacy journal is ignored, never
        // merged. Post-migration runs always have both present.
        ShortcutDiag::log(QtDebugMsg, "migrate", "legacy-journal", "canonical-present",
                          journalSelectorDetail(QStringLiteral("canonical"), QString(), QString(), false));
        return true;
    }
    if (m_journal->hasExistingPath()) {
        return fail("malformed", QStringLiteral("canonical shortcut journal is malformed; refusing migration"),
                    QStringLiteral("canonical"));
    }
    if (!m_legacyJournal->validateDiscovery(&discoveryError)) {
        return fail("unsafe", QStringLiteral("legacy shortcut journal is unsafe; refusing migration"),
                    QStringLiteral("legacy"));
    }
    if (!m_legacyJournal->hasJournal()) {
        if (m_legacyJournal->hasExistingPath()) {
            return fail("malformed", QStringLiteral("legacy shortcut journal is malformed; refusing migration"),
                        QStringLiteral("legacy"));
        }
        ShortcutDiag::log(QtDebugMsg, "migrate", "legacy-journal", "legacy-absent",
                          journalSelectorDetail(QStringLiteral("legacy"), QString(), QString(), false));
        return true;
    }
    ShortcutJournal journal;
    QString loadError;
    if (!m_legacyJournal->load(&journal, &loadError)) {
        return fail("malformed", loadError.isEmpty() ? QStringLiteral("legacy shortcut journal is malformed; refusing migration") : loadError,
                    QStringLiteral("legacy"));
    }
    if (journal.uid != static_cast<uint>(::geteuid())) {
        return fail("foreign-uid", QStringLiteral("legacy shortcut journal has a foreign UID; refusing migration"),
                    QStringLiteral("legacy"));
    }
    // Exact copy: schema, phase, owner, and every pre/post image are carried
    // over untouched so the original undo history is preserved. persist
    // revalidates and readbacks before reporting success.
    QString persistError;
    if (!m_journal->persist(journal, &persistError)) {
        return fail("persist-failed",
                    persistError.isEmpty() ? QStringLiteral("legacy shortcut journal migration failed; refusing migration") : persistError,
                    QStringLiteral("canonical"));
    }
    ShortcutDiag::log(QtInfoMsg, "migrate", "legacy-journal", "migrated",
                      journalSelectorDetail(QStringLiteral("legacy"), journal.schema, journal.phase, true));
    return true;
}

bool ShortcutReconciler::loadEffectiveJournal(ShortcutJournal *journal, bool *haveJournal, QString *error)
{
    if (!m_journal) {
        if (error) {
            *error = QStringLiteral("reconciler is not configured");
        }
        return false;
    }
    if (m_journal->hasJournal()) {
        if (!m_journal->load(journal, error)) {
            return false;
        }
        if (haveJournal) {
            *haveJournal = true;
        }
        return true;
    }
    if (m_journal->hasExistingPath()) {
        if (error) {
            *error = QStringLiteral("canonical shortcut journal is malformed; refusing migration");
        }
        return false;
    }
    // Read-only legacy consult: previews see the accurate context without
    // migrating and without writing config.
    if (m_legacyJournal && m_legacyJournal->hasJournal()) {
        if (!m_legacyJournal->load(journal, error)) {
            return false;
        }
        if (haveJournal) {
            *haveJournal = true;
        }
        return true;
    }
    if (m_legacyJournal && m_legacyJournal->hasExistingPath()) {
        if (error) {
            *error = QStringLiteral("legacy shortcut journal is malformed; refusing migration");
        }
        return false;
    }
    if (haveJournal) {
        *haveJournal = false;
    }
    return true;
}

ShortcutApplyResult ShortcutReconciler::applyImpl(const ShortcutForcePreview *forced)
{
    ShortcutApplyResult result;
    if (!m_store || !m_journal) {
        result.error = QStringLiteral("reconciler is not configured");
        return result;
    }
    ShortcutDiag::log(QtDebugMsg, forced ? "force-apply" : "apply", "start", "running",
                      QStringLiteral("rows=5"));
    QString error;
    // Deferred legacy migration runs here: this entry point is only reached
    // after explicit user confirmation, immediately before reconciliation.
    if (!ensureLegacyMigrated(&error)) {
        result.error = error;
        return result;
    }
    const int startWrites = m_store->writeCount();
    auto usedWrites = [&]() {
        return m_store->writeCount() - startWrites;
    };
    LiveSnapshot snap;
    if (!collectLiveSnapshot(&snap, &error)) {
        result.error = error;
        ShortcutDiag::log(QtWarningMsg, forced ? "force-apply" : "apply", "preflight", "refused", error);
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
    ShortcutTuple focusCurrent = snap.focus;
    ShortcutTuple lockCurrent = snap.lock;
    ShortcutTuple resizeUpCurrent = snap.resizeUp;
    ShortcutTuple switchNextCurrent = snap.switchNext;
    ShortcutTuple resizeRightCurrent = snap.resizeRight;
    ShortcutTuple switchLastCurrent = snap.switchLast;
    ShortcutTuple floatCurrent = snap.floatToggle;
    ShortcutTuple gridViewCurrent = snap.gridView;
    ShortcutTuple maximizeCurrent = snap.maximizeToggle;
    ShortcutTuple monocleCurrent = snap.monocle;

    const QList<int> focusPost = focusPostKeys();
    const QList<int> lockPost = lockPostFor(lockCurrent.active);
    const QList<int> resizeUpPost = resizeUpPostKeys();
    const QList<int> resizeRightPost = resizeRightPostKeys();
    const QList<int> floatPost = floatPostKeys();
    const QList<int> maximizePost = maximizePostKeys();
    const bool focusNeeds = focusCurrent.active != focusPost;
    const bool lockHadMetaL = lockCurrent.active.contains(SHORTCUT_META_L);
    const bool lockHasMetaEsc = lockCurrent.active.contains(SHORTCUT_META_ESC);
    const bool lockNeeds = lockCurrent.active != lockPost;
    if (!lockHadMetaL && !lockHasMetaEsc) {
        result.error = QStringLiteral("refusing to apply: lock binding has no Meta+L to replace");
        return result;
    }
    if (usedWrites() > SHORTCUT_MAX_WRITES) {
        result.error = QStringLiteral("tuple writes exceed the exact ten writes max");
        return result;
    }

    const bool haveJournal = m_journal->hasJournal();
    ShortcutJournal journal;
    if (haveJournal) {
        if (!m_journal->load(&journal, &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        if (journal.uid != uid) {
            result.error = QStringLiteral("KGlobalAccel service owner drifted");
            result.writes = usedWrites();
            return result;
        }
        if (journal.schema == shortcutJournalSchemaV2()) {
            // Adopt a persisted v2 journal into v3 from live state: the
            // three recorded rows are carried over untouched and the two
            // new rows are built from current live bindings (pre = live,
            // post = table image), never assumed. Persist before any write.
            // Completed v2 journals need a bounded upgrade: the old rows are
            // already applied while the new foreign chords are still live
            // preimages, so persisting the upgrade as complete would demand
            // the new postimage before the newly authorized rows are
            // applied. Demote only the legitimate completed upgrade to
            // focus-applied so the new rows resume; genuine drift fails
            // closed here without persisting any upgrade.
            const bool completingUpgrade = journal.phase == shortcutJournalPhaseComplete();
            if (completingUpgrade) {
                const bool oldAtPost = focusCurrent.active == journal.focus.post
                    && lockCurrent.active == journal.lock.post
                    && resizeUpCurrent.active == journal.resizeUp.post
                    && switchNextCurrent.active == journal.switchNext.post
                    && resizeRightCurrent.active == journal.resizeRight.post
                    && switchLastCurrent.active == journal.switchLast.post;
                if (!oldAtPost) {
                    result.error = QStringLiteral("state drifted after apply-complete; revert before re-applying");
                    result.writes = usedWrites();
                    return result;
                }
                const bool gridKnown = gridViewCurrent.active == gridViewExpectedPre()
                    || gridViewCurrent.active.isEmpty()
                    || isForcedClearRow(forced, shortcutGridViewComponent(), shortcutGridViewAction(),
                                        gridViewCurrent.active);
                const bool monocleKnown = monocleCurrent.active == monocleExpectedPre()
                    || monocleCurrent.active.isEmpty()
                    || isForcedClearRow(forced, shortcutMonocleComponent(), shortcutMonocleAction(),
                                        monocleCurrent.active);
                if (!gridKnown) {
                    result.error = QStringLiteral("refusing to apply: %1/%2 preimage is not exactly Meta+G")
                                       .arg(shortcutGridViewComponent(), shortcutGridViewAction());
                    result.writes = usedWrites();
                    return result;
                }
                if (!monocleKnown) {
                    result.error = QStringLiteral("refusing to apply: %1/%2 preimage is not exactly Meta+M")
                                       .arg(shortcutMonocleComponent(), shortcutMonocleAction());
                    result.writes = usedWrites();
                    return result;
                }
            }
            // One shared v2->v3 upgrade construction and persist path: the
            // two new rows are built from current live bindings (pre = live,
            // post = table image) while the three recorded rows stay
            // untouched. Only a legitimate completed upgrade demotes to
            // focus-applied so the new rows resume; pending upgrades keep
            // their phase.
            journal.floatToggle = {shortcutFloatComponent(), shortcutFloatAction(), floatCurrent.active,
                                   floatPost};
            journal.gridView = {shortcutGridViewComponent(), shortcutGridViewAction(), gridViewCurrent.active,
                                QList<int>{}};
            journal.maximizeToggle = {shortcutMaximizeComponent(), shortcutMaximizeAction(), maximizeCurrent.active,
                                      maximizePost};
            journal.monocle = {shortcutMonocleComponent(), shortcutMonocleAction(), monocleCurrent.active,
                               QList<int>{}};
            journal.row3Kind = shortcutResolutionClear();
            journal.row4Kind = shortcutResolutionClear();
            journal.schema = shortcutJournalSchema();
            if (completingUpgrade) {
                journal.phase = shortcutJournalPhaseFocusApplied();
            }
            if (!m_journal->persist(journal, &error)) {
                result.error = error.isEmpty() ? QStringLiteral("journal persist failed") : error;
                result.writes = usedWrites();
                return result;
            }
        }
        if (journal.phase == shortcutJournalPhaseComplete()) {
            if (focusCurrent.active == journal.focus.post && lockCurrent.active == journal.lock.post
                && resizeUpCurrent.active == journal.resizeUp.post && switchNextCurrent.active == journal.switchNext.post
                && resizeRightCurrent.active == journal.resizeRight.post
                && switchLastCurrent.active == journal.switchLast.post
                && floatCurrent.active == journal.floatToggle.post && gridViewCurrent.active == journal.gridView.post
                && maximizeCurrent.active == journal.maximizeToggle.post
                && monocleCurrent.active == journal.monocle.post) {
                // Stale unique names are volatile across a crashed KCM or
                // service lifetime: same UID rebinds to the verified current
                // owner before returning success.
                if (journal.owner != owner) {
                    if (!checkOwner(&error)) {
                        result.error = error;
                        result.writes = usedWrites();
                        return result;
                    }
                    journal.owner = owner;
                    if (!m_journal->persist(journal, &error)) {
                        result.error = error.isEmpty() ? QStringLiteral("journal persist failed") : error;
                        result.writes = usedWrites();
                        return result;
                    }
                }
                result.ok = true;
                result.writes = usedWrites();
                return result;
            }
            result.error = QStringLiteral("state drifted after apply-complete; revert before re-applying");
            result.writes = usedWrites();
            return result;
        }
        // Resume gate: before any write, each live tuple must be exactly
        // its recorded pre or post. Zero writes have occurred, so clean.
        {
            const bool known = focusCurrent.active == journal.focus.pre || focusCurrent.active == journal.focus.post;
            const bool lockKnown = lockCurrent.active == journal.lock.pre || lockCurrent.active == journal.lock.post;
            const bool upKnown = resizeUpCurrent.active == journal.resizeUp.pre
                || resizeUpCurrent.active == journal.resizeUp.post;
            const bool nextKnown = switchNextCurrent.active == journal.switchNext.pre
                || switchNextCurrent.active == journal.switchNext.post;
            const bool rightKnown = resizeRightCurrent.active == journal.resizeRight.pre
                || resizeRightCurrent.active == journal.resizeRight.post;
            const bool lastKnown = switchLastCurrent.active == journal.switchLast.pre
                || switchLastCurrent.active == journal.switchLast.post;
            const bool floatKnown = floatCurrent.active == journal.floatToggle.pre
                || floatCurrent.active == journal.floatToggle.post;
            const bool gridKnown = gridViewCurrent.active == journal.gridView.pre
                || gridViewCurrent.active == journal.gridView.post;
            const bool maximizeKnown = maximizeCurrent.active == journal.maximizeToggle.pre
                || maximizeCurrent.active == journal.maximizeToggle.post;
            const bool monocleKnown = monocleCurrent.active == journal.monocle.pre
                || monocleCurrent.active == journal.monocle.post;
            if (!known || !lockKnown || !upKnown || !nextKnown || !rightKnown || !lastKnown || !floatKnown || !gridKnown
                || !maximizeKnown || !monocleKnown) {
                result.error = QStringLiteral("current state matches neither the recorded pre nor post image");
                result.writes = usedWrites();
                return result;
            }
        }
        // Stale-owner recovery: the old D-Bus unique name is volatile, so a
        // different old name with the same UID rebinds to the verified
        // current owner (pinned/reconfirmed throughout via checkOwner) and
        // persists before any recovery write. UID mismatch still fails above
        // and current-operation drift still fails below.
        if (journal.owner != owner) {
            if (!checkOwner(&error)) {
                result.error = error;
                result.writes = usedWrites();
                return result;
            }
            journal.owner = owner;
            if (!m_journal->persist(journal, &error)) {
                result.error = error.isEmpty() ? QStringLiteral("journal persist failed") : error;
                result.writes = usedWrites();
                return result;
            }
        }
    } else {
        // Fresh closed-table foreign preimage preflight before any journal/write.
        // A clear row already at its postimage (empty) is normal idempotent
        // state: adopted with pre == post and no write. Only a genuine third
        // image refuses, or is adopted through a confirmed force preview.
        auto freshClearKnown = [&](const ShortcutTuple &current, const QList<int> &expectedPre) {
            if (current.active == expectedPre || current.active.isEmpty()) {
                return true;
            }
            return isForcedClearRow(forced, current.component, current.action, current.active);
        };
        if (!freshClearKnown(switchNextCurrent, switchNextExpectedPre())) {
            result.error = QStringLiteral("refusing to apply: %1/%2 preimage is not exactly Meta+Alt+K")
                               .arg(shortcutSwitchNextComponent(), shortcutSwitchNextAction());
            return result;
        }
        if (!freshClearKnown(switchLastCurrent, switchLastExpectedPre())) {
            result.error = QStringLiteral("refusing to apply: %1/%2 preimage is not exactly Meta+Alt+L")
                               .arg(shortcutSwitchLastComponent(), shortcutSwitchLastAction());
            return result;
        }
        if (!freshClearKnown(gridViewCurrent, gridViewExpectedPre())) {
            result.error = QStringLiteral("refusing to apply: %1/%2 preimage is not exactly Meta+G")
                               .arg(shortcutGridViewComponent(), shortcutGridViewAction());
            return result;
        }
        if (!freshClearKnown(monocleCurrent, monocleExpectedPre())) {
            result.error = QStringLiteral("refusing to apply: %1/%2 preimage is not exactly Meta+M")
                               .arg(shortcutMonocleComponent(), shortcutMonocleAction());
            return result;
        }
        journal.schema = shortcutJournalSchema();
        journal.phase = shortcutJournalPhasePending();
        journal.owner = owner;
        journal.uid = uid;
        journal.focus = {shortcutFocusComponent(), shortcutFocusAction(), focusCurrent.active, focusPost};
        journal.lock = {shortcutLockComponent(), shortcutLockAction(), lockCurrent.active, lockPost};
        journal.resizeUp = {shortcutResizeUpComponent(), shortcutResizeUpAction(), resizeUpCurrent.active, resizeUpPost};
        journal.switchNext = {shortcutSwitchNextComponent(), shortcutSwitchNextAction(), switchNextCurrent.active,
                              QList<int>{}};
        journal.resizeRight = {shortcutResizeRightComponent(), shortcutResizeRightAction(), resizeRightCurrent.active,
                               resizeRightPost};
        journal.switchLast = {shortcutSwitchLastComponent(), shortcutSwitchLastAction(), switchLastCurrent.active,
                              QList<int>{}};
        journal.floatToggle = {shortcutFloatComponent(), shortcutFloatAction(), floatCurrent.active, floatPost};
        journal.gridView = {shortcutGridViewComponent(), shortcutGridViewAction(), gridViewCurrent.active,
                            QList<int>{}};
        journal.maximizeToggle = {shortcutMaximizeComponent(), shortcutMaximizeAction(), maximizeCurrent.active,
                                  maximizePost};
        journal.monocle = {shortcutMonocleComponent(), shortcutMonocleAction(), monocleCurrent.active, QList<int>{}};
        journal.row0Kind = shortcutResolutionRelocate();
        journal.row1Kind = shortcutResolutionClear();
        journal.row2Kind = shortcutResolutionClear();
        journal.row3Kind = shortcutResolutionClear();
        journal.row4Kind = shortcutResolutionClear();
        if (!m_journal->persist(journal, &error)) {
            result.error = error.isEmpty() ? QStringLiteral("journal persist failed") : error;
            return result;
        }
    }

    // Phase 1: focus must own Meta+L before lock drops it.
    const bool focusAlready = focusCurrent.active == journal.focus.post;
    if (!focusAlready) {
        if (!checkOwner(&error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        QList<int> confirmed;
        if (!m_store->writeKeys(journal.focus.component, journal.focus.action, focusCurrent.componentFriendly,
                                focusCurrent.friendly, journal.focus.post, &confirmed, &error)) {
            result.error = error.isEmpty() ? QStringLiteral("setShortcutKeys call failed for focus") : error;
            result.writes = usedWrites();
            return result;
        }
        result.writes = usedWrites();
        if (confirmed != journal.focus.post) {
            result.error = QStringLiteral("setShortcutKeys reply did not confirm expected key");
            return result;
        }
        if (!checkOwner(&error)) {
            result.error = error;
            return result;
        }
        QList<ShortcutTuple> afterFocus;
        if (!m_store->readAll(&afterFocus, &error)) {
            result.error = error;
            return result;
        }
        ShortcutTuple focusAfter;
        if (!findAllowlisted(afterFocus, shortcutFocusComponent(), shortcutFocusAction(), &focusAfter, &error)) {
            result.error = error;
            return result;
        }
        if (focusAfter.active != journal.focus.post) {
            result.error = QStringLiteral("focus assignment did not verify");
            return result;
        }
        journal.phase = shortcutJournalPhaseFocusApplied();
        if (!m_journal->persist(journal, &error)) {
            result.error = error.isEmpty() ? QStringLiteral("journal persist failed") : error;
            return result;
        }
        focusCurrent = focusAfter;
        // Refresh lock view after the focus write for the ordered gate below.
        for (const ShortcutTuple &tuple : afterFocus) {
            if (tuple.component == shortcutLockComponent() && tuple.action == shortcutLockAction()) {
                lockCurrent = tuple;
                break;
            }
        }
    } else if (journal.phase == shortcutJournalPhasePending()) {
        journal.phase = shortcutJournalPhaseFocusApplied();
        // Focus already owns Meta+L; durably record the phase before the
        // lock write so interruption stays recoverable.
        if (focusNeeds == false && lockNeeds == true) {
            if (!m_journal->persist(journal, &error)) {
                result.error = error.isEmpty() ? QStringLiteral("journal persist failed") : error;
                return result;
            }
        }
    }

    // Ordered gate: lock drops Meta+L only while focus still owns it.
    if (focusCurrent.active != journal.focus.post) {
        result.error = QStringLiteral("refusing the lock write while focus does not own Meta+L");
        result.writes = usedWrites();
        return result;
    }

    // Phase 2: lock migration preserving exact other keys/order.
    const bool lockAlready = lockCurrent.active == journal.lock.post;
    if (!lockAlready) {
        if (!checkOwner(&error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        // Re-check focus ownership immediately before the lock write.
        QList<ShortcutTuple> beforeLock;
        if (!m_store->readAll(&beforeLock, &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        ShortcutTuple focusGate;
        ShortcutTuple lockGate;
        if (!findAllowlisted(beforeLock, shortcutFocusComponent(), shortcutFocusAction(), &focusGate, &error)
            || !findAllowlisted(beforeLock, shortcutLockComponent(), shortcutLockAction(), &lockGate, &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        if (focusGate.active != journal.focus.post) {
            result.error = QStringLiteral("refusing the lock write while focus does not own Meta+L");
            result.writes = usedWrites();
            return result;
        }
        if (lockGate.active != journal.lock.pre && lockGate.active != journal.lock.post) {
            result.error = QStringLiteral("lock binding changed during apply");
            result.writes = usedWrites();
            return result;
        }
        QList<int> confirmed;
        if (!m_store->writeKeys(journal.lock.component, journal.lock.action, lockGate.componentFriendly, lockGate.friendly,
                                journal.lock.post, &confirmed, &error)) {
            result.error = error.isEmpty() ? QStringLiteral("setShortcutKeys call failed for lock") : error;
            result.writes = usedWrites();
            return result;
        }
        result.writes = usedWrites();
        if (confirmed != journal.lock.post) {
            result.error = QStringLiteral("setShortcutKeys reply did not confirm expected key");
            return result;
        }
        if (!checkOwner(&error)) {
            result.error = error;
            return result;
        }
    }

    // Rows 1-4 ordered: project then foreign(clear) per row, resumable.
    if (journal.phase == shortcutJournalPhasePending()
        && (resizeUpCurrent.active != journal.resizeUp.post || switchNextCurrent.active != journal.switchNext.post
            || resizeRightCurrent.active != journal.resizeRight.post
            || switchLastCurrent.active != journal.switchLast.post)) {
        journal.phase = shortcutJournalPhaseFocusApplied();
        if (!m_journal->persist(journal, &error)) {
            result.error = error.isEmpty() ? QStringLiteral("journal persist failed") : error;
            return result;
        }
    }
    {
        ShortcutJournalEntry *projs[4] = {&journal.resizeUp, &journal.resizeRight, &journal.floatToggle,
                                          &journal.maximizeToggle};
        ShortcutJournalEntry *fors[4] = {&journal.switchNext, &journal.switchLast, &journal.gridView, &journal.monocle};
        for (int r = 0; r < 4; ++r) {
            QList<ShortcutTuple> cur;
            if (!m_store->readAll(&cur, &error)) {
                result.error = error;
                result.writes = usedWrites();
                return result;
            }
            ShortcutTuple proj;
            ShortcutTuple foreign;
            if (!findAllowlisted(cur, projs[r]->component, projs[r]->action, &proj, &error)
                || !findAllowlisted(cur, fors[r]->component, fors[r]->action, &foreign, &error)) {
                result.error = error;
                result.writes = usedWrites();
                return result;
            }
            if (foreign.active != fors[r]->pre && foreign.active != fors[r]->post) {
                result.error = QStringLiteral("current state matches neither the recorded pre nor post image");
                result.writes = usedWrites();
                return result;
            }
            if (proj.active != projs[r]->post) {
                if (proj.active != projs[r]->pre) {
                    result.error = QStringLiteral("current state matches neither the recorded pre nor post image");
                    result.writes = usedWrites();
                    return result;
                }
                if (!checkOwner(&error)) {
                    result.error = error;
                    result.writes = usedWrites();
                    return result;
                }
                QList<int> confirmed;
                if (!m_store->writeKeys(projs[r]->component, projs[r]->action, proj.componentFriendly, proj.friendly,
                                        projs[r]->post, &confirmed, &error)) {
                    result.error = error.isEmpty() ? QStringLiteral("setShortcutKeys call failed") : error;
                    result.writes = usedWrites();
                    return result;
                }
                if (confirmed != projs[r]->post) {
                    result.error = QStringLiteral("setShortcutKeys reply did not confirm expected key");
                    return result;
                }
                if (!checkOwner(&error)) {
                    result.error = error;
                    return result;
                }
            }
            // Ordered gate: foreign clears only while its project owns the chord.
            QList<ShortcutTuple> gate;
            if (!m_store->readAll(&gate, &error)) {
                result.error = error;
                result.writes = usedWrites();
                return result;
            }
            ShortcutTuple projGate;
            ShortcutTuple forGate;
            if (!findAllowlisted(gate, projs[r]->component, projs[r]->action, &projGate, &error)
                || !findAllowlisted(gate, fors[r]->component, fors[r]->action, &forGate, &error)) {
                result.error = error;
                result.writes = usedWrites();
                return result;
            }
            if (projGate.active != projs[r]->post) {
                result.error = QStringLiteral("refusing the foreign write while its project does not own the chord");
                result.writes = usedWrites();
                return result;
            }
            if (forGate.active != fors[r]->post) {
                if (forGate.active != fors[r]->pre) {
                    result.error = QStringLiteral("foreign binding changed during apply");
                    result.writes = usedWrites();
                    return result;
                }
                if (!checkOwner(&error)) {
                    result.error = error;
                    result.writes = usedWrites();
                    return result;
                }
                QList<int> confirmed;
                if (!m_store->writeKeys(fors[r]->component, fors[r]->action, forGate.componentFriendly,
                                        forGate.friendly, fors[r]->post, &confirmed, &error)) {
                    result.error = error.isEmpty() ? QStringLiteral("setShortcutKeys call failed") : error;
                    result.writes = usedWrites();
                    return result;
                }
                if (confirmed != fors[r]->post) {
                    result.error = QStringLiteral("setShortcutKeys reply did not confirm expected key");
                    return result;
                }
                if (!checkOwner(&error)) {
                    result.error = error;
                    result.writes = usedWrites();
                    return result;
                }
            }
        }
    }

    // Finish Apply: only the allowed pre/post image is permitted.
    QList<ShortcutTuple> finalTuples;
    if (!m_store->readAll(&finalTuples, &error)) {
        result.error = error;
        result.writes = usedWrites();
        return result;
    }
    ShortcutTuple focusFinal;
    ShortcutTuple lockFinal;
    ShortcutTuple upFinal;
    ShortcutTuple nextFinal;
    ShortcutTuple rightFinal;
    ShortcutTuple lastFinal;
    ShortcutTuple floatFinal;
    ShortcutTuple gridViewFinal;
    ShortcutTuple maximizeFinal;
    ShortcutTuple monocleFinal;
    if (!findAllowlisted(finalTuples, shortcutFocusComponent(), shortcutFocusAction(), &focusFinal, &error)
        || !findAllowlisted(finalTuples, shortcutLockComponent(), shortcutLockAction(), &lockFinal, &error)
        || !findAllowlisted(finalTuples, shortcutResizeUpComponent(), shortcutResizeUpAction(), &upFinal, &error)
        || !findAllowlisted(finalTuples, shortcutSwitchNextComponent(), shortcutSwitchNextAction(), &nextFinal, &error)
        || !findAllowlisted(finalTuples, shortcutResizeRightComponent(), shortcutResizeRightAction(), &rightFinal,
                            &error)
        || !findAllowlisted(finalTuples, shortcutSwitchLastComponent(), shortcutSwitchLastAction(), &lastFinal, &error)
        || !findAllowlisted(finalTuples, shortcutFloatComponent(), shortcutFloatAction(), &floatFinal, &error)
        || !findAllowlisted(finalTuples, shortcutGridViewComponent(), shortcutGridViewAction(), &gridViewFinal, &error)
        || !findAllowlisted(finalTuples, shortcutMaximizeComponent(), shortcutMaximizeAction(), &maximizeFinal, &error)
        || !findAllowlisted(finalTuples, shortcutMonocleComponent(), shortcutMonocleAction(), &monocleFinal,
                            &error)) {
        result.error = error;
        result.writes = usedWrites();
        return result;
    }
    if (focusFinal.active != journal.focus.post || lockFinal.active != journal.lock.post
        || upFinal.active != journal.resizeUp.post || nextFinal.active != journal.switchNext.post
        || rightFinal.active != journal.resizeRight.post || lastFinal.active != journal.switchLast.post
        || floatFinal.active != journal.floatToggle.post || gridViewFinal.active != journal.gridView.post
        || maximizeFinal.active != journal.maximizeToggle.post || monocleFinal.active != journal.monocle.post) {
        result.error = QStringLiteral("finish-apply verification failed: live state drifted from the recorded post image");
        result.writes = usedWrites();
        return result;
    }
    if (usedWrites() > SHORTCUT_MAX_WRITES) {
        result.error = QStringLiteral("tuple writes exceed the exact ten writes max");
        return result;
    }
    if (!checkOwner(&error)) {
        result.error = error;
        result.writes = usedWrites();
        return result;
    }
    journal.phase = shortcutJournalPhaseComplete();
    if (!m_journal->persist(journal, &error)) {
        result.error = error.isEmpty() ? QStringLiteral("journal persist failed") : error;
        result.writes = usedWrites();
        return result;
    }
    result.ok = true;
    result.writes = usedWrites();
    ShortcutDiag::log(QtInfoMsg, forced ? "force-apply" : "apply", "finish", "ok",
                      journalSelectorDetail(QStringLiteral("canonical"), journal.schema, journal.phase, false)
                          + QStringLiteral(" writes=%1").arg(result.writes));
    return result;
}

ShortcutRevertResult ShortcutReconciler::revert()
{
    ShortcutRevertResult result;
    if (!m_store || !m_journal) {
        result.error = QStringLiteral("reconciler is not configured");
        return result;
    }
    ShortcutDiag::log(QtDebugMsg, "revert", "start", "running", QStringLiteral("rows=5"));
    QString migrationError;
    // Deferred legacy migration runs here: this entry point is only reached
    // after explicit user confirmation, immediately before reconciliation.
    if (!ensureLegacyMigrated(&migrationError)) {
        result.error = migrationError;
        return result;
    }
    if (!m_journal->hasJournal()) {
        result.ok = true;
        ShortcutDiag::log(QtInfoMsg, "revert", "finish", "ok", QStringLiteral("journal=canonical present=false"));
        return result;
    }
    QString error;
    const int startWrites = m_store->writeCount();
    auto usedWrites = [&]() {
        return m_store->writeCount() - startWrites;
    };
    ShortcutJournal journal;
    if (!m_journal->load(&journal, &error)) {
        result.error = error;
        return result;
    }
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
    if (journal.uid != uid) {
        result.error = QStringLiteral("KGlobalAccel service owner drifted");
        return result;
    }
    QList<ShortcutTuple> tuples;
    if (!m_store->readAll(&tuples, &error)) {
        result.error = error;
        return result;
    }
    ShortcutTuple focusCurrent;
    ShortcutTuple lockCurrent;
    ShortcutTuple upCurrent;
    ShortcutTuple nextCurrent;
    ShortcutTuple rightCurrent;
    ShortcutTuple lastCurrent;
    ShortcutTuple floatCurrent;
    ShortcutTuple gridViewCurrent;
    ShortcutTuple maximizeCurrent;
    ShortcutTuple monocleCurrent;
    if (!findAllowlisted(tuples, shortcutFocusComponent(), shortcutFocusAction(), &focusCurrent, &error)
        || !findAllowlisted(tuples, shortcutLockComponent(), shortcutLockAction(), &lockCurrent, &error)
        || !findAllowlisted(tuples, shortcutResizeUpComponent(), shortcutResizeUpAction(), &upCurrent, &error)
        || !findAllowlisted(tuples, shortcutSwitchNextComponent(), shortcutSwitchNextAction(), &nextCurrent, &error)
        || !findAllowlisted(tuples, shortcutResizeRightComponent(), shortcutResizeRightAction(), &rightCurrent,
                            &error)
        || !findAllowlisted(tuples, shortcutSwitchLastComponent(), shortcutSwitchLastAction(), &lastCurrent, &error)) {
        result.error = error;
        return result;
    }
    // v2 journals revert only the original three rows; rows 3-4 live in v3
    // journals and are resolved here only for those.
    const bool revertV2 = journal.schema == shortcutJournalSchemaV2();
    if (!revertV2) {
        if (!findAllowlisted(tuples, shortcutFloatComponent(), shortcutFloatAction(), &floatCurrent, &error)
            || !findAllowlisted(tuples, shortcutGridViewComponent(), shortcutGridViewAction(), &gridViewCurrent, &error)
            || !findAllowlisted(tuples, shortcutMaximizeComponent(), shortcutMaximizeAction(), &maximizeCurrent, &error)
            || !findAllowlisted(tuples, shortcutMonocleComponent(), shortcutMonocleAction(), &monocleCurrent, &error)) {
            result.error = error;
            return result;
        }
    }
    // Stale-owner recovery for Restore: same UID with a different old unique
    // name rebinds to the verified current owner and persists before any
    // restore write. Journal image/allowlist already validated by load;
    // live tuples resolved above, so state is valid enough. Current drift
    // and UID checks below stay strict.
    if (journal.owner != owner) {
        if (!checkOwner(&error)) {
            result.error = error;
            return result;
        }
        journal.owner = owner;
        if (!m_journal->persist(journal, &error)) {
            result.error = error.isEmpty() ? QStringLiteral("journal persist failed") : error;
            return result;
        }
    }

    // Reverse ordered restore: only currently owned postimages, scoped.
    // v3 restores rows 4-3 before rows 2-0 (reverse of apply order); v2
    // restores exactly the original six entries.
    const int entryCount = revertV2 ? 6 : 10;
    ShortcutJournalEntry *ordered[10] = {&journal.focus, &journal.lock, &journal.resizeUp, &journal.switchNext,
                                         &journal.resizeRight, &journal.switchLast, &journal.floatToggle,
                                         &journal.gridView, &journal.maximizeToggle, &journal.monocle};
    QList<int> currents[10] = {focusCurrent.active, lockCurrent.active, upCurrent.active,
                               nextCurrent.active, rightCurrent.active, lastCurrent.active,
                               revertV2 ? QList<int>() : floatCurrent.active,
                               revertV2 ? QList<int>() : gridViewCurrent.active,
                               revertV2 ? QList<int>() : maximizeCurrent.active,
                               revertV2 ? QList<int>() : monocleCurrent.active};
    bool owned[10] = {false, false, false, false, false, false, false, false, false, false};
    for (int i = 0; i < entryCount; ++i) {
        owned[i] = ordered[i]->pre != ordered[i]->post && currents[i] == ordered[i]->post;
    }
    for (int idx = entryCount - 1; idx >= 0; --idx) {
        if (!owned[idx]) {
            continue;
        }
        QList<ShortcutTuple> mid;
        if (!m_store->readAll(&mid, &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        ShortcutTuple live;
        if (!findAllowlisted(mid, ordered[idx]->component, ordered[idx]->action, &live, &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        if (live.active != ordered[idx]->post && live.active != ordered[idx]->pre) {
            result.untouched.append(QStringLiteral("%1/%2").arg(ordered[idx]->component, ordered[idx]->action));
            continue;
        }
        if (live.active != ordered[idx]->post) {
            continue;
        }
        if (!checkOwner(&error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        QList<int> confirmed;
        if (!m_store->writeKeys(ordered[idx]->component, ordered[idx]->action, live.componentFriendly, live.friendly,
                                ordered[idx]->pre, &confirmed, &error)) {
            result.error = error.isEmpty() ? QStringLiteral("setShortcutKeys call failed") : error;
            result.writes = usedWrites();
            return result;
        }
        if (confirmed != ordered[idx]->pre) {
            result.error = QStringLiteral("setShortcutKeys reply did not confirm expected key");
            result.writes = usedWrites();
            return result;
        }
        if (!checkOwner(&error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
    }

    result.writes = usedWrites();
    if (result.writes > SHORTCUT_MAX_WRITES) {
        result.error = QStringLiteral("tuple writes exceed the exact ten writes max");
        return result;
    }

    QList<ShortcutTuple> finalTuples;
    if (!m_store->readAll(&finalTuples, &error)) {
        result.error = error;
        return result;
    }
    ShortcutTuple finals[10];
    for (int i = 0; i < entryCount; ++i) {
        if (!findAllowlisted(finalTuples, ordered[i]->component, ordered[i]->action, &finals[i], &error)) {
            result.error = error;
            return result;
        }
        if (finals[i].active != ordered[i]->pre) {
            result.untouched.append(QStringLiteral("%1/%2").arg(ordered[i]->component, ordered[i]->action));
        }
    }
    {
        QStringList deduped;
        for (const QString &item : result.untouched) {
            if (!deduped.contains(item)) {
                deduped.append(item);
            }
        }
        result.untouched = deduped;
    }

    bool allAtPre = true;
    for (int i = 0; i < entryCount; ++i) {
        if (finals[i].active != ordered[i]->pre) {
            allAtPre = false;
            break;
        }
    }
    if (allAtPre) {
        if (!checkOwner(&error)) {
            result.error = error;
            return result;
        }
        if (!m_journal->remove(&error)) {
            result.error = error.isEmpty() ? QStringLiteral("could not remove the journal") : error;
            return result;
        }
        result.journalRemoved = true;
        result.ok = result.untouched.isEmpty();
        if (!result.untouched.isEmpty()) {
            result.error = QStringLiteral("external edits left untouched");
        }
        ShortcutDiag::log(result.ok ? QtInfoMsg : QtWarningMsg, "revert", "finish",
                          result.ok ? "ok" : "untouched",
                          journalSelectorDetail(QStringLiteral("canonical"), journal.schema, journal.phase, false)
                              + QStringLiteral(" writes=%1").arg(result.writes));
        return result;
    }
    result.ok = false;
    if (result.error.isEmpty()) {
        result.error = QStringLiteral("external edits left untouched; journal retained");
    }
    ShortcutDiag::log(QtWarningMsg, "revert", "finish", "untouched",
                      journalSelectorDetail(QStringLiteral("canonical"), journal.schema, journal.phase, false));
    return result;
}

namespace
{

bool forceMismatchEqual(const ShortcutForceMismatch &a, const ShortcutForceMismatch &b)
{
    return a.component == b.component && a.action == b.action && a.expectedPre == b.expectedPre
        && a.actual == b.actual && a.post == b.post;
}

bool forceLiveSnapshotEqual(const ShortcutForcePreview &a, const ShortcutForcePreview &b)
{
    return a.owner == b.owner && a.uid == b.uid && a.liveImages == b.liveImages && a.journalOwner == b.journalOwner;
}

// The only force-eligible identities: compiled clear-row foreign targets
// (rows 1-4). Relocate rows, project rows, and anything outside the table
// are never overridable.
bool isCompiledClearForeign(const QString &component, const QString &action)
{
    const QList<ShortcutConflictRow> &table = shortcutConflictTable();
    for (int r = 1; r < table.size(); ++r) {
        if (component == table.at(r).foreignComponent && action == table.at(r).foreignAction) {
            return true;
        }
    }
    return false;
}

QList<int> compiledClearExpectedPre(const QString &component, const QString &action)
{
    const QList<ShortcutConflictRow> &table = shortcutConflictTable();
    for (int r = 1; r < table.size(); ++r) {
        if (component == table.at(r).foreignComponent && action == table.at(r).foreignAction) {
            return table.at(r).foreignExpectedPre;
        }
    }
    return {};
}

} // namespace

ShortcutForcePreview ShortcutReconciler::computeForcePreview()
{
    ShortcutForcePreview preview;
    auto refuse = [&](const QString &message) {
        preview.forceable = false;
        preview.error = message;
        return preview;
    };
    if (!m_store || !m_journal) {
        return refuse(QStringLiteral("reconciler is not configured"));
    }
    LiveSnapshot snap;
    QString error;
    // Force never bypasses store, journal, ownership, or transport/parsing
    // failures: the full shared preflight must pass first.
    if (!collectLiveSnapshot(&snap, &error)) {
        return refuse(error);
    }
    preview.owner = snap.owner;
    preview.uid = snap.uid;
    preview.liveImages = {snap.focus.active, snap.lock.active, snap.resizeUp.active, snap.switchNext.active,
                          snap.resizeRight.active, snap.switchLast.active, snap.floatToggle.active,
                          snap.gridView.active, snap.maximizeToggle.active, snap.monocle.active};
    // Lock preconditions are row-0 relocate logic, never forceable.
    if (!snap.lock.active.contains(SHORTCUT_META_L) && !snap.lock.active.contains(SHORTCUT_META_ESC)) {
        return refuse(QStringLiteral("refusing to apply: lock binding has no Meta+L to replace"));
    }
    if (!m_journal->hasJournal() && !(m_legacyJournal && m_legacyJournal->hasJournal())) {
        preview.context = ShortcutForceContext::Fresh;
        const ShortcutTuple *lives[4] = {&snap.switchNext, &snap.switchLast, &snap.gridView, &snap.monocle};
        const QList<int> pres[4] = {switchNextExpectedPre(), switchLastExpectedPre(), gridViewExpectedPre(),
                                    monocleExpectedPre()};
        for (int i = 0; i < 4; ++i) {
            // Pre or post (empty) is normal; only a genuine third image is a
            // force candidate. keysValid already passed in the snapshot.
            if (lives[i]->active == pres[i] || lives[i]->active.isEmpty()) {
                continue;
            }
            ShortcutForceMismatch mismatch;
            mismatch.component = lives[i]->component;
            mismatch.action = lives[i]->action;
            mismatch.expectedPre = pres[i];
            mismatch.actual = lives[i]->active;
            mismatch.post = QList<int>{};
            preview.mismatches.append(mismatch);
        }
        if (preview.mismatches.isEmpty()) {
            return refuse(QStringLiteral("no forced override applies: live state needs no clear-row adoption"));
        }
        preview.forceable = true;
        return preview;
    }
    ShortcutJournal journal;
    bool haveJournal = false;
    if (!loadEffectiveJournal(&journal, &haveJournal, &error) || !haveJournal) {
        // Unreachable when the Fresh branch above returns: kept defensive so
        // a journal cannot be skipped silently.
        return refuse(error.isEmpty() ? QStringLiteral("journal present; finish or revert before forcing") : error);
    }
    if (journal.uid != snap.uid) {
        return refuse(QStringLiteral("KGlobalAccel service owner drifted"));
    }
    if (journal.schema != shortcutJournalSchemaV2()) {
        // A governed v3 journal is never forced; Finish Apply or Revert owns
        // its recovery semantics.
        return refuse(QStringLiteral("journal present; finish or revert before forcing"));
    }
    if (journal.phase != shortcutJournalPhaseComplete()) {
        // Pending v2 upgrades adopt new rows from live state without
        // preimage gates; nothing to force.
        return refuse(QStringLiteral("journal present; finish or revert before forcing"));
    }
    const bool oldAtPost = snap.focus.active == journal.focus.post && snap.lock.active == journal.lock.post
        && snap.resizeUp.active == journal.resizeUp.post && snap.switchNext.active == journal.switchNext.post
        && snap.resizeRight.active == journal.resizeRight.post && snap.switchLast.active == journal.switchLast.post;
    if (!oldAtPost) {
        return refuse(QStringLiteral("state drifted after apply-complete; revert before re-applying"));
    }
    preview.context = ShortcutForceContext::V2Upgrade;
    preview.focusPre = journal.focus;
    preview.lockPre = journal.lock;
    preview.resizeUpPre = journal.resizeUp;
    preview.switchNextPre = journal.switchNext;
    preview.resizeRightPre = journal.resizeRight;
    preview.switchLastPre = journal.switchLast;
    preview.journalSchema = journal.schema;
    preview.journalPhase = journal.phase;
    preview.journalOwner = journal.owner;
    if (snap.gridView.active != gridViewExpectedPre() && !snap.gridView.active.isEmpty()) {
        ShortcutForceMismatch mismatch;
        mismatch.component = shortcutGridViewComponent();
        mismatch.action = shortcutGridViewAction();
        mismatch.expectedPre = gridViewExpectedPre();
        mismatch.actual = snap.gridView.active;
        mismatch.post = QList<int>{};
        preview.mismatches.append(mismatch);
    }
    if (snap.monocle.active != monocleExpectedPre() && !snap.monocle.active.isEmpty()) {
        ShortcutForceMismatch mismatch;
        mismatch.component = shortcutMonocleComponent();
        mismatch.action = shortcutMonocleAction();
        mismatch.expectedPre = monocleExpectedPre();
        mismatch.actual = snap.monocle.active;
        mismatch.post = QList<int>{};
        preview.mismatches.append(mismatch);
    }
    if (preview.mismatches.isEmpty()) {
        return refuse(QStringLiteral("no forced override applies: live state needs no clear-row adoption"));
    }
    preview.forceable = true;
    return preview;
}

ShortcutForcePreview ShortcutReconciler::previewForceApply()
{
    ShortcutForcePreview preview = computeForcePreview();
    if (preview.forceable) {
        QStringList rows;
        for (const ShortcutForceMismatch &mismatch : preview.mismatches) {
            rows.append(QStringLiteral("%1/%2 actual=%3")
                            .arg(mismatch.component, mismatch.action, keysDisplay(mismatch.actual)));
        }
        ShortcutDiag::log(QtInfoMsg, "force-preview", "preview", "forceable",
                          QStringLiteral("context=%1 %2")
                              .arg(preview.context == ShortcutForceContext::Fresh ? QStringLiteral("fresh")
                                                                                  : QStringLiteral("v2-upgrade"),
                                   rows.join(QStringLiteral("; "))));
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
    if (!confirmed.forceable) {
        return fail(QStringLiteral("no confirmed forced override to apply"), "no-confirmation");
    }
    if (confirmed.mismatches.isEmpty() || confirmed.mismatches.size() > 4) {
        return fail(QStringLiteral("forced override is outside the exact allowlist"), "unbounded");
    }
    // No arbitrary action/key inputs: every confirmed row must be an exact
    // compiled clear-row foreign identity with table-exact expected/post
    // images and bounded actuals. Anything forged fails closed here.
    QStringList seen;
    for (const ShortcutForceMismatch &mismatch : confirmed.mismatches) {
        const QString id = mismatch.component + QStringLiteral("/") + mismatch.action;
        if (seen.contains(id)) {
            return fail(QStringLiteral("forced override is outside the exact allowlist"), "duplicate");
        }
        seen.append(id);
        if (!isCompiledClearForeign(mismatch.component, mismatch.action)) {
            return fail(QStringLiteral("forced override is outside the exact allowlist"), "not-allowlisted");
        }
        if (mismatch.expectedPre != compiledClearExpectedPre(mismatch.component, mismatch.action)
            || !mismatch.post.isEmpty()) {
            return fail(QStringLiteral("forced override is outside the exact allowlist"), "image-mismatch");
        }
        if (!keysValid(mismatch.actual) || mismatch.actual.isEmpty()) {
            return fail(QStringLiteral("forced override is outside the exact allowlist"), "unbounded");
        }
        if (mismatch.actual == mismatch.expectedPre) {
            return fail(QStringLiteral("forced override is outside the exact allowlist"), "not-a-mismatch");
        }
    }
    if (confirmed.context == ShortcutForceContext::V2Upgrade) {
        for (const ShortcutForceMismatch &mismatch : confirmed.mismatches) {
            // Upgrade force adopts only the new rows; old-row mismatches
            // stay drift-guarded, never overridable.
            const bool isNewRow = (mismatch.component == shortcutGridViewComponent()
                                   && mismatch.action == shortcutGridViewAction())
                || (mismatch.component == shortcutMonocleComponent() && mismatch.action == shortcutMonocleAction());
            if (!isNewRow) {
                return fail(QStringLiteral("forced override is outside the exact allowlist"), "old-row");
            }
        }
    }
    // Revalidation after confirmation, before any write: migrate first so a
    // known legacy journal governs (exactly as a confirmed Apply would see
    // it), then recompute the full preflight and require the exact
    // confirmed snapshot.
    QString migrationError;
    if (!ensureLegacyMigrated(&migrationError)) {
        return fail(migrationError.isEmpty() ? QStringLiteral("legacy shortcut journal migration failed; refusing migration")
                                             : migrationError,
                    "migrate-failed");
    }
    const ShortcutForcePreview current = computeForcePreview();
    if (!current.forceable) {
        return fail(current.error.isEmpty() ? QStringLiteral("confirmed force image is stale; re-preview before forcing")
                                            : current.error,
                    "stale");
    }
    if (current.context != confirmed.context || current.mismatches.size() != confirmed.mismatches.size()) {
        return fail(QStringLiteral("confirmed force image is stale; re-preview before forcing"), "stale");
    }
    if (!forceLiveSnapshotEqual(current, confirmed)) {
        return fail(QStringLiteral("confirmed force image is stale; re-preview before forcing"), "stale");
    }
    for (int i = 0; i < current.mismatches.size(); ++i) {
        if (!forceMismatchEqual(current.mismatches.at(i), confirmed.mismatches.at(i))) {
            return fail(QStringLiteral("confirmed force image is stale; re-preview before forcing"), "stale");
        }
    }
    if (confirmed.context == ShortcutForceContext::V2Upgrade) {
        if (current.journalSchema != confirmed.journalSchema || current.journalPhase != confirmed.journalPhase
            || !journalEntryEqual(current.focusPre, confirmed.focusPre)
            || !journalEntryEqual(current.lockPre, confirmed.lockPre)
            || !journalEntryEqual(current.resizeUpPre, confirmed.resizeUpPre)
            || !journalEntryEqual(current.switchNextPre, confirmed.switchNextPre)
            || !journalEntryEqual(current.resizeRightPre, confirmed.resizeRightPre)
            || !journalEntryEqual(current.switchLastPre, confirmed.switchLastPre)) {
            return fail(QStringLiteral("confirmed force image is stale; re-preview before forcing"), "stale");
        }
    }
    // All gates revalidated: adopt the confirmed actuals as preimages for
    // exactly the confirmed rows. Non-forced rows keep their original live
    // preimages; existing journal rows keep their recorded pres.
    const ShortcutApplyResult inner = applyImpl(&confirmed);
    result.ok = inner.ok;
    result.error = inner.error;
    result.writes = inner.writes;
    ShortcutDiag::log(result.ok ? QtInfoMsg : QtWarningMsg, "force-apply", "finish", result.ok ? "ok" : "failed",
                      QStringLiteral("writes=%1").arg(result.writes));
    return result;
}

} // namespace KWin
