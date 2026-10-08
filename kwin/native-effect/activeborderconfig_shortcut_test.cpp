#include "activeborderconfig_module.h"
#include "shortcutreconciler.h"

#include <KPluginMetaData>

#include <QApplication>
#include <QClipboard>
#include <QDir>
#include <QFile>
#include <QLabel>
#include <QListWidget>
#include <QListWidgetItem>
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
constexpr int META_ALT_LEFT = 419430418;
constexpr int META_ALT_UP = 419430419;
constexpr int META_ALT_RIGHT = 419430420;
constexpr int META_ALT_DOWN = 419430421;
constexpr int META_G = 268435527;
constexpr int META_M = 268435533;
constexpr int META_LEFT = 285212690;
constexpr int META_DOWN = 285212693;
constexpr int META_UP = 285212691;
constexpr int META_RIGHT = 285212692;
constexpr int META_SHIFT_LEFT = 318767122;
constexpr int META_SHIFT_RIGHT = 318767124;
constexpr int META_CTRL_LEFT = 352321554;
constexpr int META_CTRL_UP = 352321555;
constexpr int META_CTRL_DOWN = 352321557;
constexpr int META_CTRL_RIGHT = 352321556;

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

void seedFullCatalogQuietExtras(FakeShortcutStore &store)
{
    // Full-catalog canonical quiet extras: every catalog row missing live is
    // appended at its canonical chord (empty for unbound rows) with no
    // foreign holders, so legacy 20-row seeds stay strict under
    // full-catalog missing-enabled rules while old oracles keep their
    // intended outcomes.
    for (const ShortcutCatalogEntry &entry : shortcutProjectCatalog()) {
        bool found = false;
        for (const ShortcutTuple &tuple : store.tuples) {
            if (tuple.component == entry.component && tuple.action == entry.action) {
                found = true;
                break;
            }
        }
        if (!found) {
            const QList<int> active = entry.canonicalKey == 0 ? QList<int>() : QList<int>{entry.canonicalKey};
            store.tuples.append(makeTuple(entry.component, entry.action, active));
        }
    }
}

void seedReady(FakeShortcutStore &store)
{
    // Project rows at non-post values with zero foreign holders, so Apply
    // succeeds. Full-catalog extras fill the remaining rows at canonical
    // (empty for unbound stay rows).
    store.tuples = {
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right"), QList<int>{419430420}),
        makeTuple(QStringLiteral("ksmserver"), QStringLiteral("Lock Session"), QList<int>{META_L}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-resize-outwards-up"), QList<int>{7}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-resize-outwards-right"), QList<int>{8}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-resize-outwards-left-arrow"),
                  QList<int>{11}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-resize-outwards-down-arrow"),
                  QList<int>{12}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-resize-outwards-up-arrow"),
                  QList<int>{13}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-resize-outwards-right-arrow"),
                  QList<int>{14}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-toggle-float"), QList<int>{9}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-toggle-maximize"), QList<int>{10}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-left-arrow"), QList<int>{21}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-down-arrow"), QList<int>{22}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-up-arrow"), QList<int>{23}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-focus-right-arrow"), QList<int>{24}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-move-left-arrow"), QList<int>{25}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-move-right-arrow"), QList<int>{26}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-workspace-prev-left-arrow"),
                  QList<int>{27}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-workspace-prev-up-arrow"),
                  QList<int>{28}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-workspace-next-down-arrow"),
                  QList<int>{29}),
        makeTuple(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-workspace-next-right-arrow"),
                  QList<int>{30}),
    };
    seedFullCatalogQuietExtras(store);
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

QListWidget *conflictListByModule(ActiveBorderConfigModule &module)
{
    return module.widget()->findChild<QListWidget *>(QStringLiteral("shortcutConflictList"));
}

QPushButton *presetButtonByModule(ActiveBorderConfigModule &module, const char *name)
{
    return module.widget()->findChild<QPushButton *>(QString::fromLocal8Bit(name));
}

void setRowDisabled(ActiveBorderConfigModule &module, const QString &id, bool disabled)
{
    QListWidget *list = conflictListByModule(module);
    CHECK(list != nullptr);
    if (list == nullptr) {
        return;
    }
    bool found = false;
    for (int i = 0; i < list->count(); ++i) {
        QListWidgetItem *item = list->item(i);
        if (item != nullptr && item->data(Qt::UserRole).toString() == id) {
            item->setCheckState(disabled ? Qt::Unchecked : Qt::Checked);
            found = true;
            break;
        }
    }
    CHECK(found);
    // Draft edits refresh through a queued state rebuild (the sender item
    // must survive its own change signal); pump it here for determinism.
    QApplication::processEvents();
}

void selectionPresetsAndDraft()
{
    // Compatible disables the 19 known-conflict rows plus live-colliding
    // rows in catalog order; Authentic resets to Keep. Staging only: zero
    // daemon or cleared-store writes either way.
    FakeShortcutStore store;
    seedReady(store);
    store.tuples.append(makeTuple(QStringLiteral("org.example"), QStringLiteral("other-ws"),
                                  QList<int>{SHORTCUT_META_1}));
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    CHECK(module.shortcutDisabledIds().isEmpty());
    CHECK(!module.shortcutAuthenticStaged());
    // Item 2 default-unbound rows are at canonical empty, not disabled: the
    // stay row starts enabled, present-empty, and rebindable through the
    // existing route, and load must not auto-stage it. Item 5 stay rows
    // share the same zero-key support.
    {
        const QString stayId = QStringLiteral("kwin/plasma-auto-tiler-stay-workspace-1");
        CHECK(!module.shortcutDisabledIds().contains(stayId));
        bool stayFound = false;
        for (const ShortcutTuple &tuple : store.tuples) {
            if (tuple.component == QStringLiteral("kwin")
                && tuple.action == QStringLiteral("plasma-auto-tiler-stay-workspace-1")) {
                stayFound = true;
                CHECK(tuple.active.isEmpty());
            }
        }
        CHECK(stayFound);
        QString writeError;
        QList<int> confirmed;
        CHECK(store.writeKeys(QStringLiteral("kwin"), QStringLiteral("plasma-auto-tiler-stay-workspace-1"),
                              QStringLiteral("KWin"), QStringLiteral("friendly"), QList<int>{999}, &confirmed,
                              &writeError));
        CHECK(confirmed == QList<int>{999});
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.component == QStringLiteral("kwin")
                && tuple.action == QStringLiteral("plasma-auto-tiler-stay-workspace-1")) {
                tuple.active.clear();
            }
        }
        store.writeLog.clear();
        const QString outStayId = QStringLiteral("kwin/plasma-auto-tiler-send-output-left-stay");
        CHECK(!module.shortcutDisabledIds().contains(outStayId));
        bool outStayFound = false;
        for (const ShortcutTuple &tuple : store.tuples) {
            if (tuple.component == QStringLiteral("kwin")
                && tuple.action == QStringLiteral("plasma-auto-tiler-send-output-left-stay")) {
                outStayFound = true;
                CHECK(tuple.active.isEmpty());
            }
        }
        CHECK(outStayFound);
        CHECK(store.writeKeys(QStringLiteral("kwin"),
                              QStringLiteral("plasma-auto-tiler-send-output-left-stay"),
                              QStringLiteral("KWin"), QStringLiteral("friendly"), QList<int>{999}, &confirmed,
                              &writeError));
        CHECK(confirmed == QList<int>{999});
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.component == QStringLiteral("kwin")
                && tuple.action == QStringLiteral("plasma-auto-tiler-send-output-left-stay")) {
                tuple.active.clear();
            }
        }
        store.writeLog.clear();
        const QString migrateId = QStringLiteral("kwin/plasma-auto-tiler-migrate-workspace-left");
        CHECK(!module.shortcutDisabledIds().contains(migrateId));
        bool migrateFound = false;
        for (const ShortcutTuple &tuple : store.tuples) {
            if (tuple.component == QStringLiteral("kwin")
                && tuple.action == QStringLiteral("plasma-auto-tiler-migrate-workspace-left")) {
                migrateFound = true;
                CHECK(tuple.active.isEmpty());
            }
        }
        CHECK(migrateFound);
        CHECK(store.writeKeys(QStringLiteral("kwin"),
                              QStringLiteral("plasma-auto-tiler-migrate-workspace-left"),
                              QStringLiteral("KWin"), QStringLiteral("friendly"), QList<int>{999}, &confirmed,
                              &writeError));
        CHECK(confirmed == QList<int>{999});
        for (ShortcutTuple &tuple : store.tuples) {
            if (tuple.component == QStringLiteral("kwin")
                && tuple.action == QStringLiteral("plasma-auto-tiler-migrate-workspace-left")) {
                tuple.active.clear();
            }
        }
        store.writeLog.clear();
    }
    QListWidget *list = conflictListByModule(module);
    CHECK(list != nullptr);
    if (list != nullptr) {
        CHECK(list->count() == 128);
    }
    QPushButton *compatible = presetButtonByModule(module, "shortcutCompatibleButton");
    QPushButton *authentic = presetButtonByModule(module, "shortcutAuthenticButton");
    CHECK(compatible != nullptr);
    CHECK(authentic != nullptr);
    if (compatible != nullptr) {
        compatible->click();
    }
    const QString focusId = QStringLiteral("kwin/plasma-auto-tiler-focus-right");
    const QString ws1 = QStringLiteral("kwin/plasma-auto-tiler-workspace-1");
    const QStringList draft = module.shortcutDisabledIds();
    CHECK(draft.size() == 24);
    CHECK(draft.contains(focusId));
    CHECK(draft.contains(ws1));
    CHECK(draft.indexOf(focusId) < draft.indexOf(ws1));
    // Item 1 Compatible: the four workspace arrow rows disable, letters and
    // the previous toggle stay Keep.
    CHECK(draft.contains(QStringLiteral("kwin/plasma-auto-tiler-workspace-prev-left-arrow")));
    CHECK(draft.contains(QStringLiteral("kwin/plasma-auto-tiler-workspace-prev-up-arrow")));
    CHECK(draft.contains(QStringLiteral("kwin/plasma-auto-tiler-workspace-next-down-arrow")));
    CHECK(draft.contains(QStringLiteral("kwin/plasma-auto-tiler-workspace-next-right-arrow")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-workspace-previous")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-workspace-prev-h")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-workspace-prev-k")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-workspace-next-j")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-workspace-next-l")));
    // Item 5 Compatible: the eight follow rows and four stay rows keep with
    // no stock KDE holder for the Meta+Ctrl+Alt arms.
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-send-output-left")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-send-output-left-arrow")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-send-output-left-stay")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-send-output-down")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-send-output-down-arrow")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-send-output-down-stay")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-send-output-up")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-send-output-up-arrow")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-send-output-up-stay")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-send-output-right")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-send-output-right-arrow")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-send-output-right-stay")));
    // R-WS-12 Compatible: the four unbound migrate rows keep with no stock
    // KDE holder.
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-migrate-workspace-left")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-migrate-workspace-right")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-migrate-workspace-up")));
    CHECK(!draft.contains(QStringLiteral("kwin/plasma-auto-tiler-migrate-workspace-down")));
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(!module.isShortcutForceApplyVisible());
    CHECK(!module.shortcutAuthenticStaged());
    if (authentic != nullptr) {
        authentic->click();
    }
    CHECK(module.shortcutDisabledIds().isEmpty());
    CHECK(module.shortcutAuthenticStaged());
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    // Compatible resets the staged Authentic intent to Keep, then disables
    // the same conflicting rows again. Staging only either way.
    if (compatible != nullptr) {
        compatible->click();
    }
    CHECK(!module.shortcutAuthenticStaged());
    CHECK(module.shortcutDisabledIds().size() == 24);
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
}

void selectionDisabledApplyIgnoresForeign()
{
    // A disabled row with a live foreign holder: Apply succeeds, clears
    // only the project's own assignment, and never writes the holder.
    FakeShortcutStore store;
    seedReady(store);
    store.tuples.append(makeTuple(QStringLiteral("org.example"), QStringLiteral("other-ws"),
                                  QList<int>{SHORTCUT_META_1}));
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    CHECK(module.shortcutStatusText().contains(QStringLiteral("Conflict")));
    setRowDisabled(module, QStringLiteral("kwin/plasma-auto-tiler-workspace-1"), true);
    CHECK(module.shortcutDisabledIds() == QStringList{QStringLiteral("kwin/plasma-auto-tiler-workspace-1")});
    CHECK(!module.shortcutStatusText().contains(QStringLiteral("Conflict")));
    module.requestShortcutApply();
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(store.foreignWriteLog.isEmpty());
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-workspace-1")) {
            CHECK(tuple.active.isEmpty());
        }
        if (tuple.action == QStringLiteral("other-ws")) {
            CHECK(tuple.active == (QList<int>{SHORTCUT_META_1}));
        }
    }
    CHECK(cleared.saves == 0);
    CHECK(cleared.stored.isEmpty());
}

void selectionDraftEditCancelsPreview()
{
    // An enabled-row conflict raises a Force preview; any draft edit after
    // cancels it with zero writes and no confirmation.
    FakeShortcutStore store;
    seedReady(store);
    store.tuples.append(makeTuple(QStringLiteral("kwin"), QStringLiteral("Grid View"), QList<int>{META_G}));
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    int confirms = 0;
    module.setShortcutConfirmHandler([&](const QString &, const QString &) {
        ++confirms;
        return true;
    });
    module.setShortcutStores(&store, &cleared);
    module.load();
    QPushButton *authenticForDraft = presetButtonByModule(module, "shortcutAuthenticButton");
    CHECK(authenticForDraft != nullptr);
    if (authenticForDraft != nullptr) {
        authenticForDraft->click();
    }
    module.requestShortcutApply();
    CHECK(confirms == 1);
    CHECK(module.isShortcutForceApplyVisible());
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("Grid View")));
    setRowDisabled(module, QStringLiteral("kwin/plasma-auto-tiler-workspace-1"), true);
    CHECK(!module.isShortcutForceApplyVisible());
    CHECK(confirms == 1);
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
}

void selectionStaleDraftRefusesForce()
{
    // Preview, then a draft edit: the edit cancels the preview, so Force
    // has nothing to apply and zero writes happen. The Apply refusal error
    // is preserved.
    FakeShortcutStore store;
    seedReady(store);
    store.tuples.append(makeTuple(QStringLiteral("kwin"), QStringLiteral("Grid View"), QList<int>{META_G}));
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    QPushButton *authenticForStale = presetButtonByModule(module, "shortcutAuthenticButton");
    CHECK(authenticForStale != nullptr);
    if (authenticForStale != nullptr) {
        authenticForStale->click();
    }
    module.requestShortcutApply();
    CHECK(module.isShortcutForceApplyVisible());
    setRowDisabled(module, QStringLiteral("kwin/plasma-auto-tiler-workspace-1"), true);
    CHECK(!module.isShortcutForceApplyVisible());
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(module.shortcutErrorText().contains(QStringLiteral("Meta+G")));
}

void selectionSaveIsolationWithDraft()
{
    // A staged non-empty draft never leaks into ordinary Save: zero
    // shortcut writes, zero cleared saves, draft retained.
    FakeShortcutStore store;
    seedReady(store);
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    setRowDisabled(module, QStringLiteral("kwin/plasma-auto-tiler-workspace-1"), true);
    CHECK(module.shortcutDisabledIds().size() == 1);
    module.save();
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(cleared.clears == 0);
    CHECK(module.shortcutDisabledIds().size() == 1);
    module.save();
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
}

void selectionRevertKeepsOwnAssignment()
{
    // Force clears the holder and assigns the project row; Revert restores
    // the foreign default while the project assignment stays in place.
    FakeShortcutStore store;
    seedReady(store);
    addForeignHolder(store, QStringLiteral("org.example"), QStringLiteral("other-launch"),
                     QList<int>{META_G, 999}, QList<int>{2222});
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    QPushButton *authenticForRevert = presetButtonByModule(module, "shortcutAuthenticButton");
    CHECK(authenticForRevert != nullptr);
    if (authenticForRevert != nullptr) {
        authenticForRevert->click();
    }
    module.requestShortcutApply();
    CHECK(module.isShortcutForceApplyVisible());
    module.requestShortcutForceApply();
    CHECK(module.shortcutErrorText().isEmpty());
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("other-launch")) {
            CHECK(tuple.active == (QList<int>{999}));
        }
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-float")) {
            CHECK(tuple.active == (QList<int>{META_G}));
        }
    }
    module.requestShortcutRevert();
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(cleared.stored.isEmpty());
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("other-launch")) {
            CHECK(tuple.active == (QList<int>{2222}));
        }
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-float")) {
            CHECK(tuple.active == (QList<int>{META_G}));
        }
    }
}

void selectionLiveDisabledReopen()
{
    // Reopening stages present-empty own assignments as Disable; missing
    // rows are not Disable.
    FakeShortcutStore store;
    seedReady(store);
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-workspace-1")) {
            tuple.active.clear();
        }
    }
    for (int i = store.tuples.size() - 1; i >= 0; --i) {
        if (store.tuples.at(i).action == QStringLiteral("plasma-auto-tiler-move-workspace-1")) {
            store.tuples.removeAt(i);
        }
    }
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    CHECK(module.shortcutDisabledIds().contains(QStringLiteral("kwin/plasma-auto-tiler-workspace-1")));
    CHECK(!module.shortcutDisabledIds().contains(QStringLiteral("kwin/plasma-auto-tiler-move-workspace-1")));
}

void selectionMissingEnabledStatus()
{
    // Missing enabled rows never claim success; missing disabled rows stay
    // allowed with an honest missing row.
    {
        FakeShortcutStore store;
        seedReady(store);
        for (int i = store.tuples.size() - 1; i >= 0; --i) {
            if (store.tuples.at(i).action == QStringLiteral("plasma-auto-tiler-workspace-1")) {
                store.tuples.removeAt(i);
            }
        }
        FakeClearedStore cleared;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &cleared);
        module.load();
        CHECK(module.shortcutStatusText().contains(QStringLiteral("unavailable"))
              || module.shortcutStatusText().contains(QStringLiteral("missing")));
        CHECK(!module.shortcutStatusText().contains(QStringLiteral("applied (128 rows")));
    }
    {
        FakeShortcutStore store;
        seedReady(store);
        for (int i = store.tuples.size() - 1; i >= 0; --i) {
            if (store.tuples.at(i).action == QStringLiteral("plasma-auto-tiler-workspace-1")) {
                store.tuples.removeAt(i);
            }
        }
        FakeClearedStore cleared;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &cleared);
        // Stage the absent row as disabled before load completes: absent
        // disabled is allowed, so seeding the draft directly then refreshing
        // must not claim missing success for enabled rows (none missing
        // enabled here because the only absent row is disabled).
        module.load();
        setRowDisabled(module, QStringLiteral("kwin/plasma-auto-tiler-workspace-1"), true);
        CHECK(module.shortcutDisabledIds().contains(QStringLiteral("kwin/plasma-auto-tiler-workspace-1")));
    }
}

void selectionDisabledLockAbsentShowsRows()
{
    // Focus disabled leaves the lock out of scope: an absent lock still
    // shows the full row list instead of an empty missing state.
    FakeShortcutStore store;
    seedReady(store);
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    // Lock vanishes live after open; disabling focus-right then leaves it
    // out of scope instead of failing the page.
    for (int i = static_cast<int>(store.tuples.size()) - 1; i >= 0; --i) {
        if (store.tuples.at(i).action == QStringLiteral("Lock Session")) {
            store.tuples.removeAt(i);
        }
    }
    setRowDisabled(module, QStringLiteral("kwin/plasma-auto-tiler-focus-right"), true);
    CHECK(!module.shortcutStatusText().contains(QStringLiteral("project bindings are missing")));
    QListWidget *list = conflictListByModule(module);
    CHECK(list != nullptr);
    if (list != nullptr) {
        CHECK(list->count() == 128);
    }
}

void selectionCompatibleQueryFailurePreservesDraft()
{
    FakeShortcutStore store;
    seedReady(store);
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    CHECK(module.shortcutDisabledIds().isEmpty());
    store.failByKey = true;
    QPushButton *compatible = presetButtonByModule(module, "shortcutCompatibleButton");
    CHECK(compatible != nullptr);
    if (compatible != nullptr) {
        compatible->click();
    }
    CHECK(module.shortcutDisabledIds().isEmpty());
    CHECK(module.shortcutErrorText().contains(QStringLiteral("Compatible preset unavailable")));
}

void selectionForeignDefaultCompatibleAfterClear()
{
    // Noncompiled foreign default claims the chord after its active list is
    // cleared: Compatible still disables the row.
    FakeShortcutStore store;
    seedReady(store);
    ShortcutTuple foreign = makeTuple(QStringLiteral("org.example"), QStringLiteral("other-ws"), QList<int>());
    foreign.defaults = QList<int>{SHORTCUT_META_1};
    store.tuples.append(foreign);
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    QPushButton *compatible = presetButtonByModule(module, "shortcutCompatibleButton");
    CHECK(compatible != nullptr);
    if (compatible != nullptr) {
        compatible->click();
    }
    CHECK(module.shortcutDisabledIds().contains(QStringLiteral("kwin/plasma-auto-tiler-workspace-1")));
}

void selectionReadableRowText()
{
    FakeShortcutStore store;
    seedReady(store);
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    QListWidget *list = conflictListByModule(module);
    CHECK(list != nullptr);
    if (list == nullptr) {
        return;
    }
    bool sawReadable = false;
    bool sawOwn = false;
    for (int i = 0; i < list->count(); ++i) {
        const QString text = list->item(i)->text();
        if (text.contains(QStringLiteral("Meta+1"))) {
            sawReadable = true;
        }
        if (text.contains(QStringLiteral("own ["))) {
            sawOwn = true;
        }
        CHECK(!text.contains(QStringLiteral("268435505")));
    }
    CHECK(sawReadable);
    CHECK(sawOwn);
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
    // Accepted Apply with zero holders: succeeds. Canonical assignment
    // requires staged Authentic; plain Keep would preserve with zero
    // writes.
    allow = true;
    QPushButton *authenticForConfirm = presetButtonByModule(module, "shortcutAuthenticButton");
    CHECK(authenticForConfirm != nullptr);
    if (authenticForConfirm != nullptr) {
        authenticForConfirm->click();
    }
    CHECK(module.shortcutAuthenticStaged());
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
    // Preserved with zero holders: Keep is trivially satisfied, so a fresh
    // load with nothing staged reports preservation, never canonical
    // ownership.
    {
        FakeShortcutStore store;
        seedReady(store);
        FakeClearedStore cleared;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &cleared);
        module.load();
        CHECK(module.shortcutStatusText().contains(QStringLiteral("preserved")));
        CHECK(module.shortcutStatusText().contains(QStringLiteral("128 rows")));
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
    // Applied then consumed after an Authentic Apply: canonical chords are
    // committed and the staged reset intent is consumed, so the page reports
    // preservation for the next Apply.
    {
        FakeShortcutStore store;
        seedReady(store);
        FakeClearedStore cleared;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &cleared);
        module.load();
        QPushButton *authentic = presetButtonByModule(module, "shortcutAuthenticButton");
        CHECK(authentic != nullptr);
        if (authentic != nullptr) {
            authentic->click();
        }
        module.requestShortcutApply();
        CHECK(module.shortcutErrorText().isEmpty());
        CHECK(!module.shortcutAuthenticStaged());
        CHECK(module.shortcutStatusText().contains(QStringLiteral("preserved")));
        CHECK(module.shortcutStatusText().contains(QStringLiteral("128 rows")));
    }
    // Conflict with an unknown foreign holder (Authentic stages the lock
    // relocation chords, so Meta+Esc is in scope).
    {
        FakeShortcutStore store;
        seedReady(store);
        store.tuples.append(makeTuple(QStringLiteral("kwin"), QStringLiteral("other-action"), QList<int>{META_ESC}));
        FakeClearedStore cleared;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &cleared);
        module.load();
        QPushButton *authentic = presetButtonByModule(module, "shortcutAuthenticButton");
        CHECK(authentic != nullptr);
        if (authentic != nullptr) {
            authentic->click();
        }
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
        // Stage Authentic before asserting: the authorized displacement is
        // in scope only while the lock relocation is staged.
        QPushButton *authenticForSysmon = presetButtonByModule(module, "shortcutAuthenticButton");
        CHECK(authenticForSysmon != nullptr);
        if (authenticForSysmon != nullptr) {
            authenticForSysmon->click();
        }
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
    // Canonical assignment requires staged Authentic: the foreign holder
    // claims the canonical chord while the own row is customized.
    QPushButton *authenticForForce = presetButtonByModule(module, "shortcutAuthenticButton");
    CHECK(authenticForForce != nullptr);
    if (authenticForForce != nullptr) {
        authenticForForce->click();
    }
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
    CHECK(module.shortcutForcePreviewText().contains(ShortcutReconciler::keyDisplayName(META_G)));
    CHECK(module.shortcutForcePreviewText().contains(ShortcutReconciler::keyDisplayName(999)));
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
    QPushButton *authenticForRecovery = presetButtonByModule(module, "shortcutAuthenticButton");
    CHECK(authenticForRecovery != nullptr);
    if (authenticForRecovery != nullptr) {
        authenticForRecovery->click();
    }
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
    QPushButton *authenticForKnown = presetButtonByModule(module, "shortcutAuthenticButton");
    CHECK(authenticForKnown != nullptr);
    if (authenticForKnown != nullptr) {
        authenticForKnown->click();
    }
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

void growArrowStatusAlignsWithApply()
{
    // KCM status/backend alignment: a Switch Window holder on Meta+Alt+Left
    // shows Conflict with the 15-row state, Apply refuses with zero writes,
    // and Force preview lists the exact removal.
    FakeShortcutStore store;
    seedReady(store);
    store.tuples.append(
        makeTuple(QStringLiteral("kwin"), QStringLiteral("Switch Window Left"), QList<int>{META_ALT_LEFT}));
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    QPushButton *authenticForGrow = presetButtonByModule(module, "shortcutAuthenticButton");
    CHECK(authenticForGrow != nullptr);
    if (authenticForGrow != nullptr) {
        authenticForGrow->click();
    }
    CHECK(module.shortcutStatusText().contains(QStringLiteral("Conflict")));
    CHECK(module.shortcutStatusText().contains(QStringLiteral("Meta+Alt+Left")));
    CHECK(!module.shortcutStatusText().contains(QStringLiteral("Ready")));
    module.requestShortcutApply();
    CHECK(store.writeLog.empty());
    CHECK(store.foreignWriteLog.empty());
    CHECK(!module.shortcutErrorText().isEmpty());
    CHECK(module.shortcutErrorText().contains(QStringLiteral("Switch Window Left")));
    CHECK(module.isShortcutForceApplyVisible());
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("Switch Window Left")));
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("Meta+Alt+Left")));
}

void focusMoveArrowStatusAlignsWithApply()
{
    // KCM status/backend alignment for all six focus/move rows: each Quick
    // Tile / to-Screen holder shows Conflict, Apply refuses with zero
    // writes, and Force preview lists the exact removal.
    const QList<QString> actions = {
        QStringLiteral("Window Quick Tile Left"),
        QStringLiteral("Window Quick Tile Bottom"),
        QStringLiteral("Window Quick Tile Top"),
        QStringLiteral("Window Quick Tile Right"),
        QStringLiteral("Window to Previous Screen"),
        QStringLiteral("Window to Next Screen"),
    };
    const QList<QString> displays = {
        QStringLiteral("Meta+Left"),
        QStringLiteral("Meta+Down"),
        QStringLiteral("Meta+Up"),
        QStringLiteral("Meta+Right"),
        QStringLiteral("Meta+Shift+Left"),
        QStringLiteral("Meta+Shift+Right"),
    };
    const QList<int> keys = {META_LEFT, META_DOWN, META_UP, META_RIGHT, META_SHIFT_LEFT, META_SHIFT_RIGHT};
    for (int i = 0; i < actions.size(); ++i) {
        FakeShortcutStore store;
        seedReady(store);
        store.tuples.append(makeTuple(QStringLiteral("kwin"), actions.at(i), QList<int>{keys.at(i)}));
        FakeClearedStore cleared;
        ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
        module.setShortcutStores(&store, &cleared);
        module.load();
        QPushButton *authenticForFocusMove = presetButtonByModule(module, "shortcutAuthenticButton");
        CHECK(authenticForFocusMove != nullptr);
        if (authenticForFocusMove != nullptr) {
            authenticForFocusMove->click();
        }
        CHECK(module.shortcutStatusText().contains(QStringLiteral("Conflict")));
        CHECK(module.shortcutStatusText().contains(displays.at(i)));
        CHECK(!module.shortcutStatusText().contains(QStringLiteral("Ready")));
        module.requestShortcutApply();
        CHECK(store.writeLog.empty());
        CHECK(store.foreignWriteLog.empty());
        CHECK(!module.shortcutErrorText().isEmpty());
        CHECK(module.shortcutErrorText().contains(actions.at(i)));
        CHECK(module.isShortcutForceApplyVisible());
        CHECK(module.shortcutForcePreviewText().contains(actions.at(i)));
        CHECK(module.shortcutForcePreviewText().contains(displays.at(i)));
    }
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
    QPushButton *authenticForLog = presetButtonByModule(module, "shortcutAuthenticButton");
    CHECK(authenticForLog != nullptr);
    if (authenticForLog != nullptr) {
        authenticForLog->click();
    }
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

void selectionKeepPreservesCustomCanonicalEmpty()
{
    // Plain Keep Apply preserves every enabled row: a customized chord, a
    // canonical chord, and a present-empty assignment all stay, with zero
    // writes. Status reports preservation, never canonical ownership.
    FakeShortcutStore store;
    seedReady(store);
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-float")) {
            tuple.active = QList<int>{777001};
        }
        if (tuple.action == QStringLiteral("plasma-auto-tiler-workspace-1")) {
            tuple.active.clear();
        }
    }
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    CHECK(!module.shortcutAuthenticStaged());
    // The live-empty row auto-stages Disable; restage it to Keep so empty
    // means leave empty.
    CHECK(module.shortcutDisabledIds().contains(QStringLiteral("kwin/plasma-auto-tiler-workspace-1")));
    setRowDisabled(module, QStringLiteral("kwin/plasma-auto-tiler-workspace-1"), false);
    CHECK(!module.shortcutDisabledIds().contains(QStringLiteral("kwin/plasma-auto-tiler-workspace-1")));
    module.requestShortcutApply();
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(!module.isShortcutForceApplyVisible());
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-float")) {
            CHECK(tuple.active == (QList<int>{777001}));
        }
        if (tuple.action == QStringLiteral("plasma-auto-tiler-workspace-1")) {
            CHECK(tuple.active.isEmpty());
        }
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-maximize")) {
            CHECK(tuple.active == (QList<int>{10}));
        }
        if (tuple.action == QStringLiteral("Lock Session")) {
            CHECK(tuple.active == (QList<int>{META_L}));
        }
    }
    CHECK(module.shortcutStatusText().contains(QStringLiteral("preserved")));
    CHECK(module.shortcutStatusText().contains(QStringLiteral("128 rows")));
}

void selectionAuthenticAssignsCanonical()
{
    // Staged Authentic commits canonical chords on confirmed Apply,
    // including the focus/lock relocation, without touching foreign
    // holders, and the staged reset intent is consumed there.
    FakeShortcutStore store;
    seedReady(store);
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    QPushButton *authentic = presetButtonByModule(module, "shortcutAuthenticButton");
    CHECK(authentic != nullptr);
    if (authentic != nullptr) {
        authentic->click();
    }
    CHECK(module.shortcutAuthenticStaged());
    CHECK(module.shortcutDisabledIds().isEmpty());
    module.requestShortcutApply();
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(!module.shortcutAuthenticStaged());
    CHECK(store.totalWrites() > 0);
    CHECK(store.foreignWriteLog.isEmpty());
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-float")) {
            CHECK(tuple.active == (QList<int>{META_G}));
        }
        if (tuple.action == QStringLiteral("plasma-auto-tiler-resize-outwards-up")) {
            CHECK(tuple.active == (QList<int>{META_ALT_K}));
        }
        if (tuple.action == QStringLiteral("plasma-auto-tiler-focus-right")) {
            CHECK(tuple.active == (QList<int>{META_L}));
        }
        if (tuple.action == QStringLiteral("Lock Session")) {
            CHECK(tuple.active == (QList<int>{META_ESC}));
        }
    }
    CHECK(module.shortcutStatusText().contains(QStringLiteral("preserved")));
}

void selectionCompatibleKeepsCustomNonconflict()
{
    // Compatible disables known/canonical conflicts while an unrelated
    // customized row stays Keep; Apply clears the disabled own rows and
    // leaves the custom chord and the foreign holder untouched.
    FakeShortcutStore store;
    seedReady(store);
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-workspace-2")) {
            tuple.active = QList<int>{888001};
        }
    }
    store.tuples.append(makeTuple(QStringLiteral("kwin"), QStringLiteral("Grid View"), QList<int>{META_G}));
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    QPushButton *compatible = presetButtonByModule(module, "shortcutCompatibleButton");
    CHECK(compatible != nullptr);
    if (compatible != nullptr) {
        compatible->click();
    }
    CHECK(!module.shortcutAuthenticStaged());
    CHECK(module.shortcutDisabledIds().contains(QStringLiteral("kwin/plasma-auto-tiler-toggle-float")));
    CHECK(!module.shortcutDisabledIds().contains(QStringLiteral("kwin/plasma-auto-tiler-workspace-2")));
    module.requestShortcutApply();
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(store.foreignWriteLog.isEmpty());
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-workspace-2")) {
            CHECK(tuple.active == (QList<int>{888001}));
        }
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-float")) {
            CHECK(tuple.active.isEmpty());
        }
        if (tuple.action == QStringLiteral("Grid View")) {
            CHECK(tuple.active == (QList<int>{META_G}));
        }
    }
}

void selectionKeepCustomConflictPreviewForce()
{
    // A Keep-customized chord claimed by a foreign holder refuses Apply
    // naming the actual chord. Force previews the actual removal and clears
    // only the foreign holder, preserving the custom chord with zero
    // project writes.
    FakeShortcutStore store;
    seedReady(store);
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-float")) {
            tuple.active = QList<int>{777001};
        }
    }
    addForeignHolder(store, QStringLiteral("org.example"), QStringLiteral("other-app"), QList<int>{777001},
                    QList<int>{5555});
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    CHECK(!module.shortcutAuthenticStaged());
    module.requestShortcutApply();
    CHECK(store.totalWrites() == 0);
    CHECK(!module.shortcutErrorText().isEmpty());
    // The refusal names the live actual chord, never a silent canonical.
    CHECK(module.shortcutErrorText().contains(ShortcutReconciler::keyDisplayName(777001)));
    CHECK(!module.shortcutErrorText().contains(QStringLiteral("Meta+G")));
    CHECK(module.isShortcutForceApplyVisible());
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("other-app")));
    CHECK(module.shortcutForcePreviewText().contains(QStringLiteral("stay at their current assignments")));
    module.requestShortcutForceApply();
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(!module.isShortcutForceApplyVisible());
    CHECK(store.writeLog.isEmpty());
    CHECK(!store.foreignWriteLog.isEmpty());
    CHECK(cleared.saves == 1);
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("other-app")) {
            CHECK(tuple.active.isEmpty());
        }
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-float")) {
            CHECK(tuple.active == (QList<int>{777001}));
        }
    }
}

void selectionForceRevalidationKeepDrift()
{
    // A Keep-actual drift after preview fails Force as stale with zero
    // writes and zero cleared-list persists.
    FakeShortcutStore store;
    seedReady(store);
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-float")) {
            tuple.active = QList<int>{777001};
        }
    }
    addForeignHolder(store, QStringLiteral("org.example"), QStringLiteral("other-app"), QList<int>{777001},
                    QList<int>{5555});
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    module.requestShortcutApply();
    CHECK(module.isShortcutForceApplyVisible());
    // Drift the Keep row to a superset: the conflicting chord stays claimed
    // so revalidation still sees a holder, but the live image differs and
    // Force must refuse as stale before any persist.
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-float")) {
            tuple.active = QList<int>{777001, 888002};
        }
    }
    module.requestShortcutForceApply();
    CHECK(!module.shortcutErrorText().isEmpty());
    CHECK(module.shortcutErrorText().contains(QStringLiteral("stale")));
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(cleared.stored.isEmpty());
    CHECK(!module.isShortcutForceApplyVisible());
}

void selectionSaveIsolationWithAuthentic()
{
    // A staged Authentic intent plus a disabled row never leaks into
    // ordinary Save: zero shortcut writes, intent and draft retained.
    FakeShortcutStore store;
    seedReady(store);
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    QPushButton *authentic = presetButtonByModule(module, "shortcutAuthenticButton");
    CHECK(authentic != nullptr);
    if (authentic != nullptr) {
        authentic->click();
    }
    setRowDisabled(module, QStringLiteral("kwin/plasma-auto-tiler-workspace-1"), true);
    CHECK(module.shortcutAuthenticStaged());
    CHECK(module.shortcutDisabledIds().size() == 1);
    module.save();
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(cleared.clears == 0);
    CHECK(module.shortcutAuthenticStaged());
    CHECK(module.shortcutDisabledIds().size() == 1);
    module.save();
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(module.shortcutAuthenticStaged());
}

void selectionAuthenticApplyConsumesPreservesLaterCustom()
{
    // Lifecycle: staged Authentic is committed by a confirmed successful
    // Apply and consumed there. A later external customization in KDE
    // Shortcuts with the still-open KCM must survive the next confirmed
    // Apply (Keep preserves with no reset).
    FakeShortcutStore store;
    seedReady(store);
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.setShortcutConfirmHandler([](const QString &, const QString &) { return true; });
    module.setShortcutStores(&store, &cleared);
    module.load();
    QPushButton *authentic = presetButtonByModule(module, "shortcutAuthenticButton");
    CHECK(authentic != nullptr);
    if (authentic != nullptr) {
        authentic->click();
    }
    CHECK(module.shortcutAuthenticStaged());
    module.requestShortcutApply();
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(!module.shortcutAuthenticStaged());
    CHECK(store.totalWrites() > 0);
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-float")) {
            CHECK(tuple.active == (QList<int>{META_G}));
        }
    }
    // Still-open KCM: the user customizes the current native chord in KDE
    // Shortcuts (external mutation, no KCM reload, draft untouched).
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-float")) {
            tuple.active = QList<int>{777001};
        }
    }
    const int writesAfterFirst = store.totalWrites();
    CHECK(module.shortcutDisabledIds().isEmpty());
    CHECK(!module.shortcutAuthenticStaged());
    module.requestShortcutApply();
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(!module.shortcutAuthenticStaged());
    CHECK(!module.isShortcutForceApplyVisible());
    CHECK(store.totalWrites() == writesAfterFirst);
    CHECK(cleared.saves == 0);
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-float")) {
            CHECK(tuple.active == (QList<int>{777001}));
        }
    }
    CHECK(module.shortcutStatusText().contains(QStringLiteral("preserved")));
}

void selectionAuthenticForceConsumesRetainsOnFailure()
{
    // Force lifecycle: a refused Apply and a declined Force retain the
    // staged Authentic intent; a confirmed successful Force consumes it, so
    // a later external customization with the still-open KCM is preserved
    // by the next confirmed Apply.
    FakeShortcutStore store;
    seedReady(store);
    addForeignHolder(store, QStringLiteral("org.example"), QStringLiteral("other-launch"),
                     QList<int>{META_G, 999}, QList<int>{1111});
    FakeClearedStore cleared;
    ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    bool allow = true;
    int confirms = 0;
    module.setShortcutConfirmHandler([&](const QString &, const QString &) {
        ++confirms;
        return allow;
    });
    module.setShortcutStores(&store, &cleared);
    module.load();
    QPushButton *authentic = presetButtonByModule(module, "shortcutAuthenticButton");
    CHECK(authentic != nullptr);
    if (authentic != nullptr) {
        authentic->click();
    }
    CHECK(module.shortcutAuthenticStaged());
    module.requestShortcutApply();
    CHECK(confirms == 1);
    CHECK(store.totalWrites() == 0);
    CHECK(!module.shortcutErrorText().isEmpty());
    CHECK(module.shortcutAuthenticStaged());
    CHECK(module.isShortcutForceApplyVisible());
    // Declined Force retains the staged intent with the preview kept.
    allow = false;
    module.requestShortcutForceApply();
    CHECK(confirms == 2);
    CHECK(store.totalWrites() == 0);
    CHECK(cleared.saves == 0);
    CHECK(module.shortcutAuthenticStaged());
    CHECK(module.isShortcutForceApplyVisible());
    // Accepted Force succeeds and consumes the staged intent.
    allow = true;
    module.requestShortcutForceApply();
    CHECK(confirms == 3);
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(!module.shortcutAuthenticStaged());
    CHECK(!module.isShortcutForceApplyVisible());
    CHECK(cleared.saves == 1);
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-float")) {
            CHECK(tuple.active == (QList<int>{META_G}));
        }
        if (tuple.action == QStringLiteral("other-launch")) {
            CHECK(tuple.active == (QList<int>{999}));
        }
    }
    // Still-open KCM: external customization then a confirmed Keep Apply
    // preserves it with no additional writes and no reset.
    for (ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-float")) {
            tuple.active = QList<int>{777002};
        }
    }
    const int writesAfterForce = store.totalWrites();
    module.requestShortcutApply();
    CHECK(confirms == 4);
    CHECK(module.shortcutErrorText().isEmpty());
    CHECK(!module.shortcutAuthenticStaged());
    CHECK(store.totalWrites() == writesAfterForce);
    for (const ShortcutTuple &tuple : store.tuples) {
        if (tuple.action == QStringLiteral("plasma-auto-tiler-toggle-float")) {
            CHECK(tuple.active == (QList<int>{777002}));
        }
    }
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
        std::fprintf(stderr, "usage: %s ordinary|recovery|confirm|state|force|migration|selection\n", argv[0]);
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
        growArrowStatusAlignsWithApply();
        focusMoveArrowStatusAlignsWithApply();
    } else if (scenario == QStringLiteral("selection")) {
        selectionPresetsAndDraft();
        selectionDisabledApplyIgnoresForeign();
        selectionDraftEditCancelsPreview();
        selectionStaleDraftRefusesForce();
        selectionSaveIsolationWithDraft();
        selectionRevertKeepsOwnAssignment();
        selectionLiveDisabledReopen();
        selectionMissingEnabledStatus();
        selectionDisabledLockAbsentShowsRows();
        selectionCompatibleQueryFailurePreservesDraft();
        selectionForeignDefaultCompatibleAfterClear();
        selectionReadableRowText();
        selectionKeepPreservesCustomCanonicalEmpty();
        selectionAuthenticAssignsCanonical();
        selectionCompatibleKeepsCustomNonconflict();
        selectionKeepCustomConflictPreviewForce();
        selectionForceRevalidationKeepDrift();
        selectionSaveIsolationWithAuthentic();
        selectionAuthenticApplyConsumesPreservesLaterCustom();
        selectionAuthenticForceConsumesRetainsOnFailure();
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
