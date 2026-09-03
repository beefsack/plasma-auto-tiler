#include "shortcutreconciler.h"

#include <KConfig>
#include <KConfigGroup>

#include <QDBusArgument>
#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusInterface>
#include <QDBusMessage>
#include <QDBusReply>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QXmlStreamReader>

#include <sys/stat.h>
#include <unistd.h>

namespace KWin
{

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

bool journalEntryValid(const ShortcutJournalEntry &entry)
{
    if (!ShortcutReconciler::isAllowlisted(entry.component, entry.action)) {
        return false;
    }
    return ShortcutReconciler::keysValid(entry.pre) && ShortcutReconciler::keysValid(entry.post);
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

} // namespace

bool ShortcutReconciler::isAllowlisted(const QString &component, const QString &action)
{
    return (component == shortcutFocusComponent() && action == shortcutFocusAction())
        || (component == shortcutLockComponent() && action == shortcutLockAction());
}

QList<int> ShortcutReconciler::focusPostKeys()
{
    return {SHORTCUT_META_L};
}

QList<int> ShortcutReconciler::lockPostFor(const QList<int> &lockPre)
{
    QList<int> replaced;
    replaced.reserve(lockPre.size());
    for (int key : lockPre) {
        replaced.append(key == SHORTCUT_META_L ? SHORTCUT_META_ESC : key);
    }
    return dedupKeys(replaced);
}

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
    // Strict: succeed only when the XML parser finds the exact
    // org.kde.KGlobalAccel/setShortcutKeys method carrying a parsed in
    // arg of type asa(ai)u and a parsed out arg of type a(ai).
    // No substring fallback: the structured parse is authoritative.
    QXmlStreamReader reader(xml);
    bool inTargetInterface = false;
    bool inTargetMethod = false;
    bool methodHasIn = false;
    bool methodHasOut = false;
    bool contractFound = false;
    while (!reader.atEnd()) {
        reader.readNext();
        if (reader.isStartElement()) {
            if (reader.name() == QStringLiteral("interface") && reader.attributes().value(QStringLiteral("name")) == shortcutInterface()) {
                inTargetInterface = true;
            } else if (inTargetInterface && reader.name() == QStringLiteral("method")
                       && reader.attributes().value(QStringLiteral("name")) == shortcutSetMethod()) {
                inTargetMethod = true;
                methodHasIn = false;
                methodHasOut = false;
            } else if (inTargetMethod && reader.name() == QStringLiteral("arg")) {
                const QString type = reader.attributes().value(QStringLiteral("type")).toString();
                const QString direction = reader.attributes().value(QStringLiteral("direction")).toString();
                if (type == QStringLiteral("asa(ai)u") && direction == QStringLiteral("in")) {
                    methodHasIn = true;
                }
                if (type == QStringLiteral("a(ai)") && direction == QStringLiteral("out")) {
                    methodHasOut = true;
                }
            }
        } else if (reader.isEndElement()) {
            if (reader.name() == QStringLiteral("method") && inTargetMethod) {
                if (methodHasIn && methodHasOut) {
                    contractFound = true;
                }
                inTargetMethod = false;
            } else if (reader.name() == QStringLiteral("interface") && inTargetInterface) {
                inTargetInterface = false;
            }
        }
    }
    if (reader.hasError()) {
        return false;
    }
    return contractFound;
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
        return fail(QStringLiteral("unexpected allComponents reply"));
    }
    if (replySignature != QStringLiteral("ao") || replyArgs.size() != 1) {
        return fail(QStringLiteral("unexpected allComponents reply"));
    }
    const QVariant first = replyArgs.at(0);
    QStringList parsed;
    if (first.userType() == qMetaTypeId<QList<QDBusObjectPath>>()) {
        const QList<QDBusObjectPath> paths = first.value<QList<QDBusObjectPath>>();
        for (const QDBusObjectPath &path : paths) {
            if (path.path().isEmpty()) {
                return fail(QStringLiteral("unexpected allComponents reply"));
            }
            parsed.append(path.path());
        }
    } else if (first.canConvert<QDBusArgument>()) {
        QDBusArgument arg = first.value<QDBusArgument>();
        if (arg.currentType() != QDBusArgument::ArrayType) {
            return fail(QStringLiteral("unexpected allComponents reply"));
        }
        arg.beginArray();
        while (!arg.atEnd()) {
            QDBusObjectPath path;
            arg >> path;
            if (path.path().isEmpty()) {
                return fail(QStringLiteral("unexpected allComponents reply"));
            }
            parsed.append(path.path());
        }
        arg.endArray();
    } else {
        return fail(QStringLiteral("unexpected allComponents reply"));
    }
    if (parsed.size() > 1024) {
        return fail(QStringLiteral("unexpected allComponents reply"));
    }
    if (components) {
        *components = parsed;
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
    // Refuse unsafe symlink in any parent component (no following).
    QDir parent = QFileInfo(path).dir();
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
    return journal.focus.component == shortcutFocusComponent() && journal.focus.action == shortcutFocusAction()
        && journal.lock.component == shortcutLockComponent() && journal.lock.action == shortcutLockAction();
}

bool KGlobalAccelStore::checkSetterContract(QString *error)
{
    // Introspection-proven exact setter contract observed via
    // `busctl introspect org.kde.kglobalaccel /kglobalaccel`:
    // method setShortcutKeys with signature asa(ai)u returning a(ai).
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
            *error = QStringLiteral("KGlobalAccel setShortcutKeys is absent or does not expose exactly asa(ai)u -> a(ai)");
        }
        return false;
    }
    return true;
}

bool KGlobalAccelStore::currentOwner(QString *owner, uint *uid, QString *error)
{
    QDBusInterface bus(QStringLiteral("org.freedesktop.DBus"), QStringLiteral("/org/freedesktop/DBus"),
                       QStringLiteral("org.freedesktop.DBus"), QDBusConnection::sessionBus());
    if (!bus.isValid()) {
        if (error) {
            *error = QStringLiteral("D-Bus daemon interface is invalid");
        }
        return false;
    }
    const QDBusReply<QString> nameOwner = bus.call(QStringLiteral("GetNameOwner"), shortcutService());
    if (!nameOwner.isValid()) {
        if (error) {
            *error = QStringLiteral("malformed KGlobalAccel service owner reply");
        }
        return false;
    }
    const QString ownerName = nameOwner.value();
    if (!ShortcutReconciler::uniqueNameValid(ownerName)) {
        if (error) {
            *error = QStringLiteral("KGlobalAccel owner is not a unique name");
        }
        return false;
    }
    const QDBusReply<uint> ownerUid = bus.call(QStringLiteral("GetConnectionUnixUser"), ownerName);
    if (!ownerUid.isValid()) {
        if (error) {
            *error = QStringLiteral("malformed KGlobalAccel owner UID reply");
        }
        return false;
    }
    if (owner) {
        *owner = ownerName;
    }
    if (uid) {
        *uid = ownerUid.value();
    }
    return true;
}

bool KGlobalAccelStore::readAll(QList<ShortcutTuple> *tuples, QString *error)
{
    if (!tuples) {
        return false;
    }
    QDBusInterface global(shortcutService(), shortcutPath(), shortcutInterface(), QDBusConnection::sessionBus());
    if (!global.isValid()) {
        if (error) {
            *error = QStringLiteral("KGlobalAccel interface is invalid");
        }
        return false;
    }
    const QDBusMessage compsReply = global.call(shortcutAllComponentsMethod());
    QStringList components;
    if (!ShortcutReconciler::parseAllComponentsReply(compsReply.type(), compsReply.signature(), compsReply.arguments(),
                                                     &components, error)) {
        return false;
    }
    QList<ShortcutTuple> collected;
    for (const QString &componentPath : components) {
        QDBusInterface component(shortcutService(), componentPath, shortcutComponentInterface(), QDBusConnection::sessionBus());
        if (!component.isValid()) {
            if (error) {
                *error = QStringLiteral("unexpected allShortcutInfos reply");
            }
            return false;
        }
        const QDBusMessage infosReply = component.call(shortcutAllInfosMethod(), QStringLiteral("default"));
        if (infosReply.type() != QDBusMessage::ReplyMessage || infosReply.arguments().size() != 1) {
            if (error) {
                *error = QStringLiteral("unexpected allShortcutInfos reply");
            }
            return false;
        }
        const QDBusArgument arg = infosReply.arguments().at(0).value<QDBusArgument>();
        if (arg.currentType() != QDBusArgument::ArrayType) {
            if (error) {
                *error = QStringLiteral("unexpected allShortcutInfos reply");
            }
            return false;
        }
        arg.beginArray();
        while (!arg.atEnd()) {
            QString action;
            QString friendly;
            QString compUnique;
            QString compFriendly;
            QString contextUnique;
            QString contextFriendly;
            QList<int> active;
            QList<int> defaults;
            arg.beginStructure();
            arg >> action >> friendly >> compUnique >> compFriendly >> contextUnique >> contextFriendly >> active >> defaults;
            arg.endStructure();
            if (!ShortcutReconciler::stringValid(action) || !ShortcutReconciler::stringValid(compUnique) || !ShortcutReconciler::stringValid(friendly) || !ShortcutReconciler::stringValid(compFriendly)) {
                if (error) {
                    *error = QStringLiteral("unexpected allShortcutInfos reply");
                }
                return false;
            }
            if (!ShortcutReconciler::keysValid(active) || !ShortcutReconciler::keysValid(defaults)) {
                if (error) {
                    *error = QStringLiteral("unexpected allShortcutInfos reply");
                }
                return false;
            }
            ShortcutTuple tuple;
            tuple.component = compUnique;
            tuple.action = action;
            tuple.componentFriendly = compFriendly;
            tuple.friendly = friendly;
            tuple.active = active;
            collected.append(tuple);
            if (collected.size() > SHORTCUT_MAX_TUPLES) {
                if (error) {
                    *error = QStringLiteral("unexpected allShortcutInfos reply");
                }
                return false;
            }
        }
        arg.endArray();
    }
    *tuples = collected;
    return true;
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
        || !ShortcutReconciler::stringValid(componentFriendly) || !ShortcutReconciler::stringValid(friendly)) {
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
    // QSet<QKeySequence> D-Bus value: each active int becomes one
    // four-slot sequence [key,0,0,0], preserving order.
    QList<QList<int>> sequences;
    sequences.reserve(keys.size());
    for (int key : keys) {
        sequences.append({key, 0, 0, 0});
    }
    QStringList actionId{component, action, componentFriendly, friendly};
    QDBusInterface global(shortcutService(), shortcutPath(), shortcutInterface(), QDBusConnection::sessionBus());
    if (!global.isValid()) {
        if (error) {
            *error = QStringLiteral("KGlobalAccel interface is invalid");
        }
        return false;
    }
    QVariantList args{actionId, QVariant::fromValue(sequences), SHORTCUT_SET_FLAGS};
    const QDBusMessage reply = global.callWithArgumentList(QDBus::Block, shortcutSetMethod(), args);
    if (reply.type() != QDBusMessage::ReplyMessage || reply.arguments().size() != 1) {
        if (error) {
            *error = QStringLiteral("setShortcutKeys reply did not confirm expected key");
        }
        return false;
    }
    const QDBusArgument arg = reply.arguments().at(0).value<QDBusArgument>();
    if (arg.currentType() != QDBusArgument::ArrayType) {
        if (error) {
            *error = QStringLiteral("setShortcutKeys reply did not confirm expected key");
        }
        return false;
    }
    QList<int> flattened;
    arg.beginArray();
    while (!arg.atEnd()) {
        QList<int> sequence;
        arg >> sequence;
        for (int key : sequence) {
            if (key != 0) {
                flattened.append(key);
            }
        }
    }
    arg.endArray();
    if (flattened != keys) {
        if (error) {
            *error = QStringLiteral("setShortcutKeys reply did not confirm expected key");
        }
        return false;
    }
    ++m_writes;
    if (confirmed) {
        *confirmed = flattened;
    }
    return true;
}

KConfigFileJournal::KConfigFileJournal(const QString &filePath)
    : m_filePath(filePath)
{
}

bool KConfigFileJournal::hasJournal() const
{
    if (!ShortcutReconciler::journalPathSafe(m_filePath, nullptr)) {
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
    loaded.focus.component = group.readEntry(QStringLiteral("FocusComponent"), QString());
    loaded.focus.action = group.readEntry(QStringLiteral("FocusAction"), QString());
    loaded.lock.component = group.readEntry(QStringLiteral("LockComponent"), QString());
    loaded.lock.action = group.readEntry(QStringLiteral("LockAction"), QString());
    bool ok = false;
    loaded.focus.pre = keysFromString(group.readEntry(QStringLiteral("FocusPre"), QString()), &ok);
    if (!ok) {
        if (error) {
            *error = QStringLiteral("journal is malformed");
        }
        return false;
    }
    loaded.focus.post = keysFromString(group.readEntry(QStringLiteral("FocusPost"), QString()), &ok);
    if (!ok) {
        if (error) {
            *error = QStringLiteral("journal is malformed");
        }
        return false;
    }
    loaded.lock.pre = keysFromString(group.readEntry(QStringLiteral("LockPre"), QString()), &ok);
    if (!ok) {
        if (error) {
            *error = QStringLiteral("journal is malformed");
        }
        return false;
    }
    loaded.lock.post = keysFromString(group.readEntry(QStringLiteral("LockPost"), QString()), &ok);
    if (!ok) {
        if (error) {
            *error = QStringLiteral("journal is malformed");
        }
        return false;
    }
    if (loaded.schema != shortcutJournalSchema()) {
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
    if (!journalEntryValid(loaded.focus) || !journalEntryValid(loaded.lock)) {
        if (error) {
            *error = QStringLiteral("journal entries are outside the exact allowlist");
        }
        return false;
    }
    // Exact roles: focus must be kwin/focus-right, lock must be ksmserver/Lock Session.
    if (!ShortcutReconciler::journalRolesValid(loaded)) {
        if (error) {
            *error = QStringLiteral("journal roles are swapped or not the exact allowlist");
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
    if (journal.schema != shortcutJournalSchema() || !journalEntryValid(journal.focus) || !journalEntryValid(journal.lock)
        || !ShortcutReconciler::journalRolesValid(journal)) {
        if (error) {
            *error = QStringLiteral("refusing to persist a journal outside the exact allowlist");
        }
        return false;
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
        group.writeEntry(QStringLiteral("FocusComponent"), journal.focus.component);
        group.writeEntry(QStringLiteral("FocusAction"), journal.focus.action);
        group.writeEntry(QStringLiteral("FocusPre"), keysToString(journal.focus.pre));
        group.writeEntry(QStringLiteral("FocusPost"), keysToString(journal.focus.post));
        group.writeEntry(QStringLiteral("LockComponent"), journal.lock.component);
        group.writeEntry(QStringLiteral("LockAction"), journal.lock.action);
        group.writeEntry(QStringLiteral("LockPre"), keysToString(journal.lock.pre));
        group.writeEntry(QStringLiteral("LockPost"), keysToString(journal.lock.post));
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

ShortcutStore *createLiveShortcutStore()
{
    return new KGlobalAccelStore;
}

JournalStore *createLiveShortcutJournal(const QString &filePath)
{
    return new KConfigFileJournal(filePath);
}

QString defaultShortcutJournalPath()
{
    // Narrowly project-owned user config location; never fall back to CWD.
    const QString base = QStandardPaths::writableLocation(QStandardPaths::AppConfigLocation);
    if (base.isEmpty() || !QDir::isAbsolutePath(base)) {
        return QString();
    }
    return base + QStringLiteral("/shortcut-override-journalrc");
}

ShortcutApplyResult ShortcutReconciler::apply()
{
    ShortcutApplyResult result;
    if (!m_store || !m_journal) {
        result.error = QStringLiteral("reconciler is not configured");
        return result;
    }
    QString error;
    const int startWrites = m_store->writeCount();
    auto usedWrites = [&]() {
        return m_store->writeCount() - startWrites;
    };
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
    QList<ShortcutTuple> tuples;
    if (!m_store->readAll(&tuples, &error)) {
        result.error = error;
        return result;
    }
    if (tuples.size() > SHORTCUT_MAX_TUPLES) {
        result.error = QStringLiteral("tuple enumeration is unbounded");
        return result;
    }
    ShortcutTuple focusCurrent;
    ShortcutTuple lockCurrent;
    if (!findAllowlisted(tuples, shortcutFocusComponent(), shortcutFocusAction(), &focusCurrent, &error)) {
        result.error = error;
        return result;
    }
    if (!findAllowlisted(tuples, shortcutLockComponent(), shortcutLockAction(), &lockCurrent, &error)) {
        result.error = error;
        return result;
    }
    if (!keysValid(focusCurrent.active) || !keysValid(lockCurrent.active)) {
        result.error = QStringLiteral("allowlisted tuple is unbounded");
        return result;
    }
    // Preflight: refuse on any Meta+Esc claimed by a non-allowlisted record.
    // No journal and no mutation on this path.
    for (const ShortcutTuple &tuple : tuples) {
        if (isAllowlisted(tuple.component, tuple.action)) {
            continue;
        }
        if (!keysValid(tuple.active)) {
            result.error = QStringLiteral("unrelated tuple is unbounded");
            return result;
        }
        if (tuple.active.contains(SHORTCUT_META_ESC)) {
            result.error = QStringLiteral("refusing to apply: Meta+Esc is claimed by %1/%2").arg(tuple.component, tuple.action);
            return result;
        }
    }

    const QList<int> focusPost = focusPostKeys();
    const QList<int> lockPost = lockPostFor(lockCurrent.active);
    const bool focusNeeds = focusCurrent.active != focusPost;
    const bool lockHadMetaL = lockCurrent.active.contains(SHORTCUT_META_L);
    const bool lockHasMetaEsc = lockCurrent.active.contains(SHORTCUT_META_ESC);
    const bool lockNeeds = lockCurrent.active != lockPost;
    if (!lockHadMetaL && !lockHasMetaEsc) {
        result.error = QStringLiteral("refusing to apply: lock binding has no Meta+L to replace");
        return result;
    }
    if (usedWrites() > SHORTCUT_MAX_WRITES) {
        result.error = QStringLiteral("tuple writes exceed the exact two writes max");
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
        if (!journalRolesValid(journal)) {
            result.error = QStringLiteral("journal roles are swapped or not the exact allowlist");
            result.writes = usedWrites();
            return result;
        }
        if (journal.owner != owner || journal.uid != uid) {
            result.error = QStringLiteral("KGlobalAccel service owner drifted");
            result.writes = usedWrites();
            return result;
        }
        if (journal.phase == shortcutJournalPhaseComplete()) {
            if (focusCurrent.active == journal.focus.post && lockCurrent.active == journal.lock.post) {
                result.ok = true;
                result.writes = usedWrites();
                return result;
            }
            result.error = QStringLiteral("state drifted after apply-complete; revert before re-applying");
            result.writes = usedWrites();
            return result;
        }
        // Resume with the recorded postimage only when it equals the
        // deterministic allowed derivation from the recorded pre.
        const QList<int> expectedFocusPost = focusPostKeys();
        const QList<int> expectedLockPost = lockPostFor(journal.lock.pre);
        if (journal.focus.post != expectedFocusPost || journal.lock.post != expectedLockPost) {
            result.error = QStringLiteral("journal postimage is not the allowed image");
            result.writes = usedWrites();
            return result;
        }
        // Resume/Finish Apply gate: before any write, each live tuple must
        // be exactly its recorded pre or its recorded post. Anything else
        // is external focus/lock drift and must not be re-clobbered.
        // Zero writes have occurred at this point, so failing here is clean.
        {
            const bool focusKnown = focusCurrent.active == journal.focus.pre || focusCurrent.active == journal.focus.post;
            const bool lockKnown = lockCurrent.active == journal.lock.pre || lockCurrent.active == journal.lock.post;
            if (!focusKnown || !lockKnown) {
                result.error = QStringLiteral("current state matches neither the recorded pre nor post image");
                result.writes = usedWrites();
                return result;
            }
        }
    } else {
        journal.schema = shortcutJournalSchema();
        journal.phase = shortcutJournalPhasePending();
        journal.owner = owner;
        journal.uid = uid;
        journal.focus = {shortcutFocusComponent(), shortcutFocusAction(), focusCurrent.active, focusPost};
        journal.lock = {shortcutLockComponent(), shortcutLockAction(), lockCurrent.active, lockPost};
        if (!m_journal->persist(journal, &error)) {
            result.error = error.isEmpty() ? QStringLiteral("journal persist failed") : error;
            return result;
        }
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

    // Finish Apply: only the allowed pre/post image is permitted.
    QList<ShortcutTuple> finalTuples;
    if (!m_store->readAll(&finalTuples, &error)) {
        result.error = error;
        result.writes = usedWrites();
        return result;
    }
    ShortcutTuple focusFinal;
    ShortcutTuple lockFinal;
    if (!findAllowlisted(finalTuples, shortcutFocusComponent(), shortcutFocusAction(), &focusFinal, &error)
        || !findAllowlisted(finalTuples, shortcutLockComponent(), shortcutLockAction(), &lockFinal, &error)) {
        result.error = error;
        result.writes = usedWrites();
        return result;
    }
    if (focusFinal.active != journal.focus.post || lockFinal.active != journal.lock.post) {
        result.error = QStringLiteral("finish-apply verification failed: live state drifted from the recorded post image");
        result.writes = usedWrites();
        return result;
    }
    if (usedWrites() > SHORTCUT_MAX_WRITES) {
        result.error = QStringLiteral("tuple writes exceed the exact two writes max");
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
    return result;
}

ShortcutRevertResult ShortcutReconciler::revert()
{
    ShortcutRevertResult result;
    if (!m_store || !m_journal) {
        result.error = QStringLiteral("reconciler is not configured");
        return result;
    }
    if (!m_journal->hasJournal()) {
        result.ok = true;
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
    if (journal.owner != owner || journal.uid != uid) {
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
    if (!findAllowlisted(tuples, shortcutFocusComponent(), shortcutFocusAction(), &focusCurrent, &error)
        || !findAllowlisted(tuples, shortcutLockComponent(), shortcutLockAction(), &lockCurrent, &error)) {
        result.error = error;
        return result;
    }

    const bool focusNoop = journal.focus.pre == journal.focus.post;
    const bool lockNoop = journal.lock.pre == journal.lock.post;
    const bool focusOwned = !focusNoop && focusCurrent.active == journal.focus.post;
    const bool lockOwned = !lockNoop && lockCurrent.active == journal.lock.post;

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

    // No-op entries (pre == post) never need a write; external edits to
    // either tuple are preserved independently.
    // Restore in reverse dependency order: lock first, then focus.
    if (lockOwned) {
        if (!checkOwner(&error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        QList<int> confirmed;
        if (!m_store->writeKeys(journal.lock.component, journal.lock.action, lockCurrent.componentFriendly,
                                lockCurrent.friendly, journal.lock.pre, &confirmed, &error)) {
            result.error = error.isEmpty() ? QStringLiteral("setShortcutKeys call failed for lock") : error;
            result.writes = usedWrites();
            return result;
        }
        if (confirmed != journal.lock.pre) {
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
    if (focusOwned) {
        // Re-read focus identity after a lock restore so friendly names stay exact.
        QList<ShortcutTuple> mid;
        if (!m_store->readAll(&mid, &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        ShortcutTuple focusMid;
        if (!findAllowlisted(mid, shortcutFocusComponent(), shortcutFocusAction(), &focusMid, &error)) {
            result.error = error;
            result.writes = usedWrites();
            return result;
        }
        if (focusMid.active != journal.focus.post && focusMid.active != journal.focus.pre) {
            result.untouched.append(QStringLiteral("%1/%2").arg(journal.focus.component, journal.focus.action));
        } else if (focusMid.active == journal.focus.post) {
            if (!checkOwner(&error)) {
                result.error = error;
                result.writes = usedWrites();
                return result;
            }
            QList<int> confirmed;
            if (!m_store->writeKeys(journal.focus.component, journal.focus.action, focusMid.componentFriendly,
                                    focusMid.friendly, journal.focus.pre, &confirmed, &error)) {
                result.error = error.isEmpty() ? QStringLiteral("setShortcutKeys call failed for focus") : error;
                result.writes = usedWrites();
                return result;
            }
            if (confirmed != journal.focus.pre) {
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
    }

    result.writes = usedWrites();
    if (result.writes > SHORTCUT_MAX_WRITES) {
        result.error = QStringLiteral("tuple writes exceed the exact two writes max");
        return result;
    }

    // Authoritative verification: only tuples still equal to the recorded
    // postimage were restored; external edits stay untouched and reported
    // independently per tuple.
    QList<ShortcutTuple> finalTuples;
    if (!m_store->readAll(&finalTuples, &error)) {
        result.error = error;
        return result;
    }
    ShortcutTuple focusFinal;
    ShortcutTuple lockFinal;
    if (!findAllowlisted(finalTuples, shortcutFocusComponent(), shortcutFocusAction(), &focusFinal, &error)
        || !findAllowlisted(finalTuples, shortcutLockComponent(), shortcutLockAction(), &lockFinal, &error)) {
        result.error = error;
        return result;
    }
    const bool focusAtPre = focusFinal.active == journal.focus.pre;
    const bool lockAtPre = lockFinal.active == journal.lock.pre;
    if (!focusAtPre) {
        result.untouched.append(QStringLiteral("%1/%2").arg(journal.focus.component, journal.focus.action));
    }
    if (!lockAtPre) {
        result.untouched.append(QStringLiteral("%1/%2").arg(journal.lock.component, journal.lock.action));
    }
    // Deduplicate while preserving order.
    {
        QStringList deduped;
        for (const QString &item : result.untouched) {
            if (!deduped.contains(item)) {
                deduped.append(item);
            }
        }
        result.untouched = deduped;
    }

    if (focusAtPre && lockAtPre) {
        if (!m_journal->remove(&error)) {
            result.error = error.isEmpty() ? QStringLiteral("could not remove the journal") : error;
            return result;
        }
        result.journalRemoved = true;
        result.ok = result.untouched.isEmpty();
        if (!result.untouched.isEmpty()) {
            result.error = QStringLiteral("external edits left untouched");
        }
        return result;
    }
    // Journal is removed only when both authoritative restores complete.
    result.ok = false;
    if (result.error.isEmpty()) {
        result.error = QStringLiteral("external edits left untouched; journal retained");
    }
    return result;
}

} // namespace KWin
