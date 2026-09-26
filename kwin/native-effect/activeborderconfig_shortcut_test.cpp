#include "activeborderconfig_module.h"
#include "shortcutreconciler.h"

#include <KPluginMetaData>

#include <QApplication>
#include <QClipboard>
#include <QDir>
#include <QFile>
#include <QLabel>
#include <QMimeData>
#include <QPushButton>
#include <QTemporaryDir>

#include <cstdio>
#include <cstdlib>
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
constexpr int META_G = 268435527;
constexpr int META_M = 268435533;

ShortcutTuple makeTuple(const QString &component, const QString &action, const QList<int> &active)
{
    ShortcutTuple tuple;
    tuple.component = component;
    tuple.action = action;
    tuple.componentFriendly = component == QStringLiteral("kwin") ? QStringLiteral("KWin") : component;
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
    QMap<int, QList<ShortcutKeyHolder>> extraByKey;
    QMap<int, bool> availableOverride;
    bool failByKey = false;
    bool failAvailable = false;
    struct WriteRecord
    {
        QString component;
        QString action;
        QList<int> keys;
    };
    QList<WriteRecord> writeLog;
    QMap<QString, QList<int>> defaultKeysById;
    QList<WriteRecord> foreignWriteLog;

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
                || !ShortcutReconciler::stringValid(tuple.action) || !ShortcutReconciler::cosmeticValid(tuple.friendly)
                || !ShortcutReconciler::cosmeticValid(tuple.componentFriendly)) {
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

    bool shortcutsByKey(int key, QList<ShortcutKeyHolder> *holders, QString *error) override
    {
        if (failByKey) {
            if (error) {
                *error = QStringLiteral("globalShortcutsByKey call failed");
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
        combined.append(extraByKey.value(key));
        if (holders) {
            *holders = combined;
        }
        return true;
    }

    bool shortcutAvailable(int key, const QString &component, bool *available, QString *error) override
    {
        Q_UNUSED(component);
        if (failAvailable) {
            if (error) {
                *error = QStringLiteral("globalShortcutAvailable call failed");
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
            || !ShortcutReconciler::stringValid(action) || !ShortcutReconciler::cosmeticValid(componentFriendly)
            || !ShortcutReconciler::cosmeticValid(friendly)) {
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

    bool defaultShortcutKeys(const QString &component, const QString &action, const QString &componentFriendly,
                             const QString &friendly, QList<int> *defaults, QString *error) override
    {
        if (!ShortcutReconciler::stringValid(component) || !ShortcutReconciler::stringValid(action)
            || !ShortcutReconciler::cosmeticValid(componentFriendly)
            || !ShortcutReconciler::cosmeticValid(friendly)) {
            if (error) {
                *error = QStringLiteral("refusing default keys with unbounded tuple");
            }
            return false;
        }
        const QString id = component + QStringLiteral("/") + action;
        const QList<int> stored = defaultKeysById.value(id);
        if (!ShortcutReconciler::keysValid(stored)) {
            if (error) {
                *error = QStringLiteral("unexpected defaultShortcutKeys reply: did not return expected keys");
            }
            return false;
        }
        if (defaults) {
            *defaults = stored;
        }
        return true;
    }

    bool setForeignShortcutKeys(const QString &component, const QString &action, const QString &componentFriendly,
                                const QString &friendly, const QList<int> &keys, QString *error) override
    {
        if (!ShortcutReconciler::keysValid(keys) || !ShortcutReconciler::stringValid(component)
            || !ShortcutReconciler::stringValid(action) || !ShortcutReconciler::cosmeticValid(componentFriendly)
            || !ShortcutReconciler::cosmeticValid(friendly)) {
            if (error) {
                *error = QStringLiteral("refusing foreign write with unbounded tuple");
            }
            return false;
        }
        if (writeLog.size() + foreignWriteLog.size() >= 64) {
            if (error) {
                *error = QStringLiteral("refusing write beyond the lifetime bound");
            }
            return false;
        }
        foreignWriteLog.append({component, action, keys});
        bool found = false;
        for (ShortcutTuple &tuple : tuples) {
            if (tuple.component == component && tuple.action == action) {
                tuple.active = keys;
                found = true;
                break;
            }
        }
        if (!found) {
            ShortcutTuple created = makeTuple(component, action, keys);
            created.componentFriendly = componentFriendly;
            created.friendly = friendly;
            tuples.append(created);
        }
        QList<int> readback;
        for (const ShortcutTuple &tuple : tuples) {
            if (tuple.component == component && tuple.action == action) {
                readback = tuple.active;
                break;
            }
        }
        if (!ShortcutReconciler::foreignReadbackMatches(keys, readback)) {
            if (error) {
                *error = QStringLiteral("setForeignShortcutKeys readback did not confirm expected keys");
            }
            return false;
        }
        return true;
    }

    int writeCount() const override
    {
        return writeLog.size() + foreignWriteLog.size();
    }

    int totalWrites() const
    {
        return writeLog.size() + foreignWriteLog.size();
    }
};

class FakeClearedStore : public ClearedActionsStore
{
public:
    QList<ClearedAction> stored;
    int saves = 0;
    int clears = 0;
    bool failLoad = false;
    bool failSave = false;
    bool failClear = false;

    bool load(QList<ClearedAction> *actions, QString *error) override
    {
        if (failLoad) {
            if (error) {
                *error = QStringLiteral("cleared shortcut load failed");
            }
            return false;
        }
        if (actions) {
            *actions = stored;
        }
        return true;
    }

    bool save(const QList<ClearedAction> &actions, QString *error) override
    {
        if (failSave) {
            if (error) {
                *error = QStringLiteral("cleared shortcut persist failed");
            }
            return false;
        }
        if (actions.size() > SHORTCUT_MAX_TUPLES) {
            if (error) {
                *error = QStringLiteral("cleared shortcut list is unbounded");
            }
            return false;
        }
        stored = actions;
        ++saves;
        return true;
    }

    bool clear(QString *error) override
    {
        if (failClear) {
            if (error) {
                *error = QStringLiteral("could not clear the cleared shortcut list");
            }
            return false;
        }
        stored.clear();
        ++clears;
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
    // Six project rows at non-post values with zero foreign holders of the
    // six required chords, so Apply succeeds.
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{419430420}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-resize-outwards-up"), QList<int>{7}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-resize-outwards-right"), QList<int>{8}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-toggle-float"), QList<int>{9}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-toggle-maximize"), QList<int>{10}),
    };
}

void addForeignHolder(FakeShortcutStore &store, const QString &component, const QString &action,
                      const QList<int> &active, const QList<int> &defaults = {})
{
    store.tuples.append(makeTuple(component, action, active));
    if (!defaults.isEmpty()) {
        store.defaultKeysById[component + QStringLiteral("/") + action] = defaults;
    } else {
        store.defaultKeysById[component + QStringLiteral("/") + action] = QList<int>{7777};
    }
}

void ordinarySettingsApplyNeverMutatesShortcuts()
{
    FakeShortcutStore store;
    seedReady(store);
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    int confirms = 0;
    module.setShortcutConfirmHandler([&](const QString &, const QString &) {
        ++confirms;
        return true;
    });
    module.setShortcutStores(&store, &cleared);
    module.load();
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(cleared.clears == 0);
    module.refreshShortcutState();
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(confirms == 0);
    module.save();
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(cleared.clears == 0);
    CHECK(confirms == 0);
    module.defaults();
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(confirms == 0);
    module.save();
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(confirms == 0);
    module.refreshShortcutState();
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(confirms == 0);
    QList<ClearedAction> loaded;
    QString error;
    CHECK(cleared.load(&loaded, &error));
    CHECK(loaded.isEmpty());
}

void confirmationGatesEveryMutation()
{
    FakeShortcutStore store;
    seedReady(store);
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    int confirms = 0;
    bool allow = false;
    module.setShortcutConfirmHandler([&](const QString &title, const QString &text) {
        ++confirms;
        CHECK(!title.isEmpty());
        CHECK(!text.isEmpty());
        return allow;
    });
    module.setShortcutStores(&store, &cleared);
    module.load();
    // Declined Apply: no writes, no cleared saves.
    module.requestShortcutApply();
    CHECK(confirms == 1);
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    // Accepted Apply with zero holders: succeeds.
    allow = true;
    module.requestShortcutApply();
    CHECK(confirms == 2);
    CHECK(store.totalWrites() > 0);
    CHECK(module.shortcutErrorText().isEmpty());
    // Revert needs its own confirmation; decline first.
    allow = false;
    const int writesBeforeRevert = store.totalWrites();
    const int savesBeforeRevert = cleared.saves;
    module.requestShortcutRevert();
    CHECK(confirms == 3);
    CHECK(store.totalWrites() == writesBeforeRevert);
    CHECK(cleared.saves == savesBeforeRevert);
    // Force Cancel needs no confirmation.
    allow = true;
    CHECK(!module.isShortcutForceApplyVisible());
    module.requestShortcutForceCancel();
    CHECK(confirms == 3);
    CHECK(store.totalWrites() == writesBeforeRevert);
}

void stateAndErrorPresentation()
{
    // Ready with zero holders.
    {
        FakeShortcutStore store;
        seedReady(store);
        FakeClearedStore cleared;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &cleared);
        module.load();
        CHECK(module.shortcutStatusText().contains(QStringLiteral("Ready")));
        CHECK(module.shortcutStatusText().contains(QStringLiteral("5 rows")));
        CHECK(module.shortcutErrorText().isEmpty());
        CHECK(buttonByName(module, "shortcutFinishApplyButton") == nullptr);
        CHECK(buttonByName(module, "shortcutRestoreButton") == nullptr);
        CHECK(!module.shortcutStatusText().contains(QStringLiteral("journal")));
        CHECK(!module.shortcutStatusText().contains(QStringLiteral("Interrupted")));
        CHECK(!module.shortcutStatusText().contains(QStringLiteral("legacy")));
        CHECK(!module.shortcutStatusText().contains(QStringLiteral("migration")));
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
    // Applied after Apply.
    {
        FakeShortcutStore store;
        seedReady(store);
        FakeClearedStore cleared;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &cleared);
        module.load();
        module.requestShortcutApply();
        CHECK(module.shortcutErrorText().isEmpty());
        CHECK(module.shortcutStatusText().contains(QStringLiteral("applied")));
        CHECK(module.shortcutStatusText().contains(QStringLiteral("5 rows")));
    }
    // Conflict with an unknown foreign holder.
    {
        FakeShortcutStore store;
        seedReady(store);
        store.tuples.append(makeTuple(QStringLiteral("kwin"), QStringLiteral("other-action"), QList<int>{META_ESC}));
        FakeClearedStore cleared;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &cleared);
        module.load();
        CHECK(module.shortcutStatusText().contains(QStringLiteral("Conflict")));
        CHECK(module.shortcutStatusText().contains(QStringLiteral("Meta+Esc")));
        module.requestShortcutApply();
        CHECK(store.writeLog.empty());
        CHECK(store.foreignWriteLog.empty());
        CHECK(!module.shortcutErrorText().isEmpty());
        CHECK(module.shortcutErrorText().contains(QStringLiteral("Meta+Esc")));
        const QString preserved = module.shortcutErrorText();
        module.refreshShortcutState();
        CHECK(module.shortcutErrorText() == preserved);
        CHECK(module.shortcutStatusText().contains(QStringLiteral("Conflict")));
    }
    // Transport failure surfaces as unavailable, never Conflict.
    {
        FakeShortcutStore store;
        seedReady(store);
        store.failByKey = true;
        FakeClearedStore cleared;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &cleared);
        module.load();
        CHECK(!module.shortcutStatusText().contains(QStringLiteral("Conflict")));
        CHECK(module.shortcutStatusText().contains(QStringLiteral("unavailable")));
    }
    // Split-signature contract rejection, never the stale combined form.
    {
        FakeShortcutStore store;
        seedReady(store);
        store.contractXml = QStringLiteral(
            "<node><interface name=\"org.kde.KGlobalAccel\">"
            "<method name=\"setShortcutKeys\">"
            "<arg type=\"asa(ai)u\" direction=\"in\"/>"
            "<arg type=\"a(ai)\" direction=\"out\"/>"
            "</method></interface></node>");
        FakeClearedStore cleared;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &cleared);
        module.load();
        CHECK(module.shortcutStatusText().contains(QStringLiteral("as,a(ai),u -> a(ai)")));
        CHECK(!module.shortcutStatusText().contains(QStringLiteral("asa(ai)u")));
        module.requestShortcutApply();
        CHECK(store.totalWrites() == 0);
        CHECK(module.shortcutErrorText().contains(QStringLiteral("as,a(ai),u -> a(ai)")));
        CHECK(!module.shortcutErrorText().contains(QStringLiteral("asa(ai)u")));
    }
    // System Monitor Meta+Esc holder stays Ready and Apply avoids it.
    {
        FakeShortcutStore store;
        seedReady(store);
        ShortcutKeyHolder sysmon;
        sysmon.component = shortcutAuthorizedEscComponent();
        sysmon.action = shortcutAuthorizedEscAction();
        sysmon.active = QList<int>{META_ESC};
        store.extraByKey[META_ESC].append(sysmon);
        FakeClearedStore cleared;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &cleared);
        module.load();
        CHECK(!module.shortcutStatusText().contains(QStringLiteral("Conflict")));
        CHECK(module.shortcutStatusText().contains(QStringLiteral("Ready")));
        module.requestShortcutApply();
        CHECK(!store.writeLog.empty());
        CHECK(module.shortcutErrorText().isEmpty());
        for (const auto &record : store.writeLog) {
            CHECK(!(record.component == shortcutAuthorizedEscComponent() && record.action == shortcutAuthorizedEscAction()));
        }
        for (const auto &record : store.foreignWriteLog) {
            CHECK(!(record.component == shortcutAuthorizedEscComponent() && record.action == shortcutAuthorizedEscAction()));
        }
    }
}

void forcePreviewAcceptCancelRevert()
{
    FakeShortcutStore store;
    seedReady(store);
    // Holder with one required key plus one unrelated key.
    addForeignHolder(store, QStringLiteral("org.kde.unknown"), QStringLiteral("other-launch"),
                     QList<int>{META_G, 999}, QList<int>{1111});
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    int confirms = 0;
    bool allow = true;
    module.setShortcutConfirmHandler([&](const QString &title, const QString &text) {
        ++confirms;
        CHECK(!title.isEmpty());
        CHECK(!text.isEmpty());
        return allow;
    });
    module.setShortcutStores(&store, &cleared);
    module.load();
    CHECK(!module.isShortcutForceApplyVisible());
    CHECK(!module.isShortcutForceCancelVisible());
    // Apply refuses with zero mutation and raises the exact preview.
    module.requestShortcutApply();
    CHECK(confirms == 1);
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(module.shortcutErrorText().contains(QStringLiteral("Meta+G")));
    CHECK(module.isShortcutForceApplyVisible());
    CHECK(module.isShortcutForceCancelVisible());
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("org.kde.unknown")));
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("other-launch")));
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("268435527")));
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("999")));
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("will remove")));
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("keep")));
    QLabel *preview = labelByName(module, "shortcutForcePreviewLabel");
    CHECK(preview != nullptr);
    if (preview) {
        CHECK(preview->text() == module.shortcutForcePreviewText());
        CHECK(!preview->isHidden());
    }
    // Cancel clears the preview with no mutation, no confirmation.
    module.requestShortcutForceCancel();
    CHECK(confirms == 1);
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(!module.isShortcutForceApplyVisible());
    CHECK(!module.isShortcutForceCancelVisible());
    // Preview again, decline at the Force confirmation: retained, unmutated.
    module.requestShortcutApply();
    CHECK(confirms == 2);
    CHECK(module.isShortcutForceApplyVisible());
    allow = false;
    module.requestShortcutForceApply();
    CHECK(confirms == 3);
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(module.isShortcutForceApplyVisible());
    // Accept: only the required key is removed, the unrelated key is kept,
    // and the cleared ID is persisted before clearing.
    allow = true;
    module.requestShortcutForceApply();
    CHECK(confirms == 4);
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(!module.isShortcutForceApplyVisible());
    CHECK(!module.isShortcutForceCancelVisible());
    CHECK(cleared.saves == 1);
    bool foundHolder = false;
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.component == QStringLiteral("org.kde.unknown") && tuple.action == QStringLiteral("other-launch")) {
            foundHolder = true;
            CHECK(tuple.active == (QList<int>{999}));
        }
    }
    CHECK(foundHolder);
    // Stale preview: mutate the holder after a fresh preview, then force.
    module.requestShortcutApply();
    // Holder is now at the kept value {999} with no required key, so Apply
    // may proceed on project rows; force a new conflict instead.
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.component == QStringLiteral("org.kde.unknown")) {
            tuple.active = QList<int>{META_M, 4242};
        }
    }
    store.defaultKeysById[QStringLiteral("org.kde.unknown/other-launch")] = QList<int>{1111};
    module.requestShortcutApply();
    const int confirmsBeforeStale = confirms;
    const int writesBeforeStale = store.totalWrites();
    const int savesBeforeStale = cleared.saves;
    if (module.isShortcutForceApplyVisible()) {
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.component == QStringLiteral("org.kde.unknown")) {
                tuple.active = QList<int>{META_M, 5555};
            }
        }
        module.requestShortcutForceApply();
        CHECK(confirms == confirmsBeforeStale + 1);
        CHECK(!module.shortcutErrorText().isEmpty());
        CHECK(store.totalWrites() == writesBeforeStale);
        CHECK(cleared.saves == savesBeforeStale);
    } else {
        CHECK(module.shortcutErrorText().isEmpty());
    }
}

void recoveryVisibilityAndRouting()
{
    // Revert restores KDE defaults for cleared bindings, empties the list,
    // and leaves project-owned IDs cleared.
    FakeShortcutStore store;
    seedReady(store);
    addForeignHolder(store, QStringLiteral("org.kde.unknown"), QStringLiteral("other-launch"),
                     QList<int>{META_G, 999}, QList<int>{2222});
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    int confirms = 0;
    module.setShortcutConfirmHandler([&](const QString &, const QString &) {
        ++confirms;
        return true;
    });
    module.setShortcutStores(&store, &cleared);
    module.load();
    CHECK(buttonByName(module, "shortcutFinishApplyButton") == nullptr);
    CHECK(buttonByName(module, "shortcutRestoreButton") == nullptr);
    module.requestShortcutApply();
    CHECK(confirms == 1);
    CHECK(module.isShortcutForceApplyVisible());
    module.requestShortcutForceApply();
    CHECK(confirms == 2);
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(cleared.stored.size() == 1);
    // Revert confirm mentions KDE defaults.
    bool revertTextSawDefaults = false;
    module.setShortcutConfirmHandler([&](const QString &title, const QString &text) {
        ++confirms;
        if (title.contains(QStringLiteral("Revert")) && text.contains(QStringLiteral("KDE default"))) {
            revertTextSawDefaults = true;
        }
        return true;
    });
    module.requestShortcutRevert();
    CHECK(confirms == 3);
    CHECK(revertTextSawDefaults);
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(cleared.stored.isEmpty());
    bool foundHolder = false;
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.component == QStringLiteral("org.kde.unknown") && tuple.action == QStringLiteral("other-launch")) {
            foundHolder = true;
            CHECK(tuple.active == (QList<int>{2222}));
        }
    }
    CHECK(foundHolder);
    // Empty-list Revert is a no-op success.
    const int writesAfter = store.totalWrites();
    module.requestShortcutRevert();
    CHECK(confirms == 4);
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(store.totalWrites() == writesAfter);
}

void legacyMigrationDeferredFromOpen()
{
    // The cleared config is the only durability: opening/refreshing never
    // writes the cleared store and the status never mentions retired
    // vocabulary or interrupted phases.
    FakeShortcutStore store;
    seedReady(store);
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    int confirms = 0;
    module.setShortcutConfirmHandler([&](const QString &, const QString &) {
        ++confirms;
        return true;
    });
    module.setShortcutStores(&store, &cleared);
    module.load();
    module.refreshShortcutState();
    CHECK(confirms == 0);
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(!module.shortcutStatusText().contains(QStringLiteral("journal")));
    CHECK(!module.shortcutStatusText().contains(QStringLiteral("legacy")));
    CHECK(!module.shortcutStatusText().contains(QStringLiteral("migration")));
    CHECK(!module.shortcutStatusText().contains(QStringLiteral("Interrupted")));
    CHECK(!module.shortcutStatusText().contains(QStringLiteral("Finish")));
    CHECK(!module.shortcutStatusText().contains(QStringLiteral("Restore")));
    const QString clearedPath = defaultClearedActionsPath();
    CHECK(!clearedPath.isEmpty());
    CHECK(QDir::isAbsolutePath(clearedPath));
    CHECK(clearedPath.endsWith(QStringLiteral("shortcut-clearedrc")));
    CHECK(clearedPath.contains(QStringLiteral("plasma-auto-tiler")));
    CHECK(!QFile::exists(clearedPath));
}

void knownForeignStatusAlignsWithApply()
{
    // Status/backend alignment: a known compiled foreign holder (Grid
    // View on Meta+G) shows Conflict, never Ready, and Apply refuses
    // with zero writes while offering a Force preview.
    FakeShortcutStore store;
    seedReady(store);
    store.tuples.append(makeTuple(QStringLiteral("kwin"), QStringLiteral("Grid View"), QList<int>{META_G}));
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    CHECK(module.shortcutStatusText().contains(QStringLiteral("Conflict")));
    CHECK(module.shortcutStatusText().contains(QStringLiteral("Meta+G")));
    CHECK(!module.shortcutStatusText().contains(QStringLiteral("Ready")));
    module.requestShortcutApply();
    CHECK(store.writeLog.empty());
    CHECK(store.foreignWriteLog.empty());
    CHECK(!module.shortcutErrorText().isEmpty());
    CHECK(module.shortcutErrorText().contains(QStringLiteral("Grid View")));
    CHECK(module.isShortcutForceApplyVisible());
}

void terminalFailureLogIncludesReason()
{
    FakeShortcutStore store;
    seedReady(store);
    addForeignHolder(store, QStringLiteral("org.kde.unknown"), QStringLiteral("other-launch"),
                     QList<int>{META_G, 999}, QList<int>{1111});
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) {
        return true;
    });
    module.setShortcutStores(&store, &cleared);
    module.load();
    QStringList messages;
    ShortcutDiag::setSink([&](QtMsgType, const QString &message) {
        messages.append(message);
    });
    module.requestShortcutApply();
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.component == QStringLiteral("org.kde.unknown")) {
            tuple.active = QList<int>{META_G, 1000};
        }
    }
    module.requestShortcutForceApply();
    ShortcutDiag::resetSink();
    bool sawTerminalFailure = false;
    bool sawStaleForceFailure = false;
    for (const QString &message : messages) {
        // Backend diagnostics redact foreign identities: any "claimed by"
        // detail becomes reason=key-conflict (writes count redacted with it).
        if (message.contains(QStringLiteral("plasmaautotiler.shortcut op=apply stage=result outcome=failed"))
            && message.contains(QStringLiteral("reason=key-conflict"))) {
            sawTerminalFailure = true;
        }
        if (message.contains(QStringLiteral("plasmaautotiler.shortcut op=force-apply stage=result outcome=failed"))
            && message.contains(QStringLiteral("confirmed force image is stale"))
            && message.contains(QStringLiteral("writes=0"))) {
            sawStaleForceFailure = true;
        }
    }
    CHECK(sawTerminalFailure);
    CHECK(sawStaleForceFailure);
    CHECK(cleared.saves == 0);
}

} // namespace

int main(int argc, char **argv)
{
    qputenv("DBUS_SESSION_BUS_ADDRESS", QByteArray("unix:path=/dev/null/plasma-auto-tiler-kcm-test-isolated-bus"));
    QTemporaryDir configHome;
    if (!configHome.isValid()) {
        std::fprintf(stderr, "failed to create temporary config directory\n");
        return EXIT_FAILURE;
    }
    qputenv("XDG_CONFIG_HOME", configHome.path().toUtf8());
    QApplication app(argc, argv);
    app.clipboard()->setMimeData(new QMimeData);

    if (argc != 2) {
        std::fprintf(stderr, "usage: %s ordinary|recovery|confirm|state|force|migration\n", argv[0]);
        return EXIT_FAILURE;
    }

    const QString scenario = QString::fromLocal8Bit(argv[1]);
    if (scenario == QStringLiteral("ordinary")) {
        ordinarySettingsApplyNeverMutatesShortcuts();
    } else if (scenario == QStringLiteral("recovery")) {
        recoveryVisibilityAndRouting();
    } else if (scenario == QStringLiteral("confirm")) {
        confirmationGatesEveryMutation();
    } else if (scenario == QStringLiteral("force")) {
        forcePreviewAcceptCancelRevert();
        terminalFailureLogIncludesReason();
    } else if (scenario == QStringLiteral("migration")) {
        legacyMigrationDeferredFromOpen();
    } else if (scenario == QStringLiteral("state")) {
        stateAndErrorPresentation();
        knownForeignStatusAlignsWithApply();
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
