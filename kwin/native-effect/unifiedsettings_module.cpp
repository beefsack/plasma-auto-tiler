#include "unifiedsettings_module.h"
#include "activeborderconfig.h"

#include <KConfigGroup>
#include <KLocalizedString>
#include <KSharedConfig>
#include <QLoggingCategory>

#include <QComboBox>
#include <QDBusConnection>
#include <QDBusInterface>
#include <QDBusMessage>
#include <QLabel>
#include <QMessageBox>
#include <QPushButton>
#include <QSpinBox>

Q_LOGGING_CATEGORY(lcScriptConfig, "plasmaautotiler.script-config", QtInfoMsg)
Q_LOGGING_CATEGORY(lcWindowConflicts, "plasmaautotiler.window-conflicts", QtInfoMsg)

namespace KWin
{

namespace
{

constexpr int kGapDefault = 8;
constexpr int kGapMinimum = 0;
constexpr int kGapMaximum = 64;

int readBoundedGap(const KConfigGroup &group, const QString &key)
{
    if (!group.hasKey(key)) {
        return kGapDefault;
    }
    bool ok = false;
    const int parsed = group.readEntry(key, QString()).toInt(&ok);
    if (ok && parsed >= kGapMinimum && parsed <= kGapMaximum) {
        return parsed;
    }
    return kGapDefault;
}

bool isBoundedGapRawValid(const KConfigGroup &group, const QString &key)
{
    if (!group.hasKey(key)) {
        return true;
    }
    bool ok = false;
    const int parsed = group.readEntry(key, QString()).toInt(&ok);
    return ok && parsed >= kGapMinimum && parsed <= kGapMaximum;
}

void logScriptConfig(const char *operation, const char *stage, const char *outcome, const QString &detail)
{
    QString bounded = detail;
    if (bounded.size() > 256) {
        bounded.truncate(256);
    }
    qCInfo(lcScriptConfig).noquote() << QStringLiteral("plasmaautotiler.script-config op=%1 stage=%2 outcome=%3 %4")
                                            .arg(QString::fromUtf8(operation), QString::fromUtf8(stage),
                                                 QString::fromUtf8(outcome), bounded);
}

struct WindowConflictState {
    bool tiling = true;
    bool maximize = true;
    int borders = 0;
};

WindowConflictState readWindowConflictState()
{
    const KSharedConfig::Ptr config = KSharedConfig::openConfig(QStringLiteral("kwinrc"));
    config->reparseConfiguration();
    const KConfigGroup group(config, QStringLiteral("Windows"));
    WindowConflictState state;
    state.tiling = group.readEntry(QStringLiteral("ElectricBorderTiling"), true);
    state.maximize = group.readEntry(QStringLiteral("ElectricBorderMaximize"), true);
    state.borders = group.readEntry(QStringLiteral("ElectricBorders"), 0);
    return state;
}

void logWindowConflict(const char *operation, const QString &setting, const char *outcome, const QString &reason)
{
    qCInfo(lcWindowConflicts).noquote() << QStringLiteral("op=%1 setting=%2 outcome=%3 reason=%4")
                                               .arg(QString::fromUtf8(operation), setting,
                                                    QString::fromUtf8(outcome), reason);
}

} // namespace

UnifiedSettingsModule::UnifiedSettingsModule(QObject *parent, const KPluginMetaData &data)
    : KCModule(parent, data)
{
    ActiveBorderConfig::instance(QStringLiteral("kwinrc"));
    m_ui.setupUi(widget());
    addConfig(ActiveBorderConfig::self(), widget());

    m_ui.workspaceModeCombo->addItem(i18n("Per output, local"), QStringLiteral("per-output-local"));
    m_ui.workspaceModeCombo->addItem(i18n("Global, unique"), QStringLiteral("global-unique"));
    m_ui.workspaceModeCombo->addItem(i18n("Shared"), QStringLiteral("shared"));

    connect(m_ui.workspaceModeCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this,
            &UnifiedSettingsModule::updateScriptState);
    connect(m_ui.innerGapSpinBox, QOverload<int>::of(&QSpinBox::valueChanged), this,
            &UnifiedSettingsModule::updateScriptState);
    connect(m_ui.outerGapSpinBox, QOverload<int>::of(&QSpinBox::valueChanged), this,
            &UnifiedSettingsModule::updateScriptState);

    m_shortcutStore = createLiveShortcutStore();
    // Project-owned cleared-actions config only. Constructing the
    // backends writes nothing. Opening, refreshing, previewing,
    // or cancelling never writes config.
    m_clearedStore = createLiveClearedActionsStore(defaultClearedActionsPath());
    m_ownsShortcutStores = true;
    connect(m_ui.shortcutApplyButton, &QPushButton::clicked, this, &UnifiedSettingsModule::requestShortcutApply);
    connect(m_ui.shortcutRevertButton, &QPushButton::clicked, this, &UnifiedSettingsModule::requestShortcutRevert);
    connect(m_ui.shortcutForceApplyButton, &QPushButton::clicked, this, &UnifiedSettingsModule::requestShortcutForceApply);
    connect(m_ui.shortcutForceCancelButton, &QPushButton::clicked, this, &UnifiedSettingsModule::requestShortcutForceCancel);
    refreshShortcutState();

    if (m_ui.windowTilingFixButton != nullptr) {
        connect(m_ui.windowTilingFixButton, &QPushButton::clicked, this,
                [this] { requestWindowFix(QStringLiteral("ElectricBorderTiling")); });
    }
    if (m_ui.windowTilingRevertButton != nullptr) {
        connect(m_ui.windowTilingRevertButton, &QPushButton::clicked, this,
                [this] { requestWindowRevert(QStringLiteral("ElectricBorderTiling")); });
    }
    if (m_ui.windowMaximizeFixButton != nullptr) {
        connect(m_ui.windowMaximizeFixButton, &QPushButton::clicked, this,
                [this] { requestWindowFix(QStringLiteral("ElectricBorderMaximize")); });
    }
    if (m_ui.windowMaximizeRevertButton != nullptr) {
        connect(m_ui.windowMaximizeRevertButton, &QPushButton::clicked, this,
                [this] { requestWindowRevert(QStringLiteral("ElectricBorderMaximize")); });
    }
    if (m_ui.windowBordersFixButton != nullptr) {
        connect(m_ui.windowBordersFixButton, &QPushButton::clicked, this,
                [this] { requestWindowFix(QStringLiteral("ElectricBorders")); });
    }
    refreshWindowConflicts();

    m_scriptRestartRequired = false;
    m_scriptStatus = QStringLiteral("No pending script setting in this dialog.");
    if (m_ui.scriptStatusLabel != nullptr) {
        m_ui.scriptStatusLabel->setText(m_scriptStatus);
    }
    updateScriptState();
}

UnifiedSettingsModule::~UnifiedSettingsModule()
{
    if (m_ownsShortcutStores) {
        delete m_shortcutStore;
        delete m_clearedStore;
    }
}

QString UnifiedSettingsModule::effectService()
{
    return QStringLiteral("org.kde.KWin");
}

QString UnifiedSettingsModule::effectPath()
{
    return QStringLiteral("/Effects");
}

QString UnifiedSettingsModule::effectInterface()
{
    return QStringLiteral("org.kde.kwin.Effects");
}

QString UnifiedSettingsModule::effectMethod()
{
    return QStringLiteral("reconfigureEffect");
}

QString UnifiedSettingsModule::effectName()
{
    return QStringLiteral("plasma-auto-tiler-active-border");
}

bool UnifiedSettingsModule::isEffectReconfigureFailed(const QDBusMessage &reply)
{
    return reply.type() != QDBusMessage::ReplyMessage;
}

bool UnifiedSettingsModule::requestEffectReconfigure()
{
    QDBusInterface interface(effectService(), effectPath(), effectInterface(), QDBusConnection::sessionBus());
    const QDBusMessage reply = interface.call(effectMethod(), effectName());
    return !isEffectReconfigureFailed(reply);
}

QString UnifiedSettingsModule::scriptService()
{
    return QStringLiteral("org.kde.KWin");
}

QString UnifiedSettingsModule::scriptPath()
{
    return QStringLiteral("/KWin");
}

QString UnifiedSettingsModule::scriptInterface()
{
    return QStringLiteral("org.kde.KWin");
}

QString UnifiedSettingsModule::scriptMethod()
{
    return QStringLiteral("reconfigure");
}

bool UnifiedSettingsModule::requestScriptReconfigure()
{
    QDBusInterface interface(scriptService(), scriptPath(), scriptInterface(), QDBusConnection::sessionBus());
    if (!interface.isValid()) {
        return false;
    }
    return QDBusConnection::sessionBus().send(
        QDBusMessage::createMethodCall(scriptService(), scriptPath(), scriptInterface(), scriptMethod()));
}

void UnifiedSettingsModule::setShortcutStores(ShortcutStore *store, ClearedActionsStore *cleared)
{
    if (m_ownsShortcutStores) {
        delete m_shortcutStore;
        delete m_clearedStore;
        m_shortcutStore = nullptr;
        m_clearedStore = nullptr;
        m_ownsShortcutStores = false;
    }
    m_shortcutStore = store;
    m_clearedStore = cleared;
    clearForcePreview();
    refreshShortcutState();
}

void UnifiedSettingsModule::setShortcutConfirmHandler(std::function<bool(const QString &, const QString &)> handler)
{
    m_shortcutConfirm = std::move(handler);
}

QString UnifiedSettingsModule::shortcutStatusText() const
{
    return m_shortcutStatus;
}

QString UnifiedSettingsModule::shortcutErrorText() const
{
    return m_shortcutError;
}

QString UnifiedSettingsModule::shortcutForcePreviewText() const
{
    return m_forcePreviewText;
}

bool UnifiedSettingsModule::isShortcutForceApplyVisible() const
{
    return m_ui.shortcutForceApplyButton != nullptr && !m_ui.shortcutForceApplyButton->isHidden();
}

bool UnifiedSettingsModule::isShortcutForceCancelVisible() const
{
    return m_ui.shortcutForceCancelButton != nullptr && !m_ui.shortcutForceCancelButton->isHidden();
}

void UnifiedSettingsModule::requestShortcutApply()
{
    runShortcutApply("apply");
}

bool UnifiedSettingsModule::confirmShortcutAction(const QString &title, const QString &text)
{
    if (m_shortcutConfirm) {
        return m_shortcutConfirm(title, text);
    }
    return QMessageBox::question(widget(), title, text, QMessageBox::Yes | QMessageBox::No, QMessageBox::No) == QMessageBox::Yes;
}

void UnifiedSettingsModule::requestShortcutRevert()
{
    runShortcutRevert("revert");
}

void UnifiedSettingsModule::requestShortcutForceApply()
{
    // Never force without a pending exact preview.
    if (!m_forcePreviewValid || !m_forcePreview.forceable) {
        return;
    }
    if (!confirmShortcutAction(QStringLiteral("Force Apply Shortcuts"), m_forcePreviewText)) {
        return;
    }
    if (m_shortcutStore == nullptr || m_clearedStore == nullptr) {
        m_shortcutError = QStringLiteral("reconciler is not configured");
        ShortcutDiag::log(QtWarningMsg, "force-apply", "result", "failed",
                          QStringLiteral("reason=reconciler-unconfigured writes=0"));
        updateShortcutPresentation();
        return;
    }
    ShortcutReconciler reconciler(m_shortcutStore, m_clearedStore);
    // applyForced revalidates the confirmed snapshot against fresh live
    // state before any write (including cleared-list writes); stale
    // snapshots fail with zero writes.
    const ShortcutForceApplyResult result = reconciler.applyForced(m_forcePreview);
    if (result.ok) {
        m_shortcutError.clear();
    } else {
        m_shortcutError = result.error.isEmpty() ? QStringLiteral("Force Apply failed") : result.error;
    }
    ShortcutDiag::log(result.ok ? QtInfoMsg : QtWarningMsg, "force-apply", "result",
                      result.ok ? "ok" : "failed",
                      result.ok ? QStringLiteral("writes=%1").arg(result.writes)
                                : QStringLiteral("reason=%1 writes=%2").arg(result.error).arg(result.writes));
    // A consumed or stale confirmation never persists: the next Force needs
    // a fresh preview.
    clearForcePreview();
    refreshShortcutState();
}

void UnifiedSettingsModule::requestShortcutForceCancel()
{
    if (!m_forcePreviewValid) {
        return;
    }
    ShortcutDiag::log(QtDebugMsg, "force-preview", "cancel", "cancelled", QStringLiteral("rows=preview"));
    clearForcePreview();
    refreshShortcutState();
}

void UnifiedSettingsModule::clearForcePreview()
{
    m_forcePreview = ShortcutForcePreview();
    m_forcePreviewValid = false;
    m_forcePreviewText.clear();
}

QString UnifiedSettingsModule::buildForcePreviewText(const ShortcutForcePreview &preview)
{
    QStringList lines;
    lines.append(QStringLiteral("Force Apply will clear %1 binding(s). Each row shows the exact required keys "
                                "removed and the unrelated keys kept. Revalidation runs again after confirmation; "
                                "stale state aborts without writes.")
                     .arg(preview.mismatches.size()));
    for (const ShortcutForceMismatch &mismatch : preview.mismatches) {
        lines.append(QStringLiteral("- %1/%2: found %3; will remove %4 and keep %5.")
                         .arg(mismatch.component, mismatch.action,
                              ShortcutReconciler::keysDisplay(mismatch.actual),
                              ShortcutReconciler::keysDisplay(mismatch.expectedPre),
                              ShortcutReconciler::keysDisplay(mismatch.post)));
    }
    return lines.join(QStringLiteral("\n"));
}

void UnifiedSettingsModule::runShortcutApply(const char *operation)
{
    const QList<ShortcutConflictRow> &table = shortcutConflictTable();
    const int prefixSize = QStringLiteral("plasma-auto-tiler-").size();
    QStringList assigns;
    assigns.append(QStringLiteral("Assign %1 to %2 and move %3 to %4")
                       .arg(table.at(0).projectAction.mid(prefixSize), table.at(0).projectDisplay,
                            table.at(0).foreignAction, table.at(0).targetDisplay));
    for (int i = 1; i < table.size(); ++i) {
        assigns.append(QStringLiteral("assign %1 to %2")
                           .arg(table.at(i).projectAction.mid(prefixSize), table.at(i).projectDisplay));
    }
    if (!confirmShortcutAction(QStringLiteral("Apply Shortcuts"),
                               assigns.join(QStringLiteral("; "))
                                   + QStringLiteral("? Conflicting bindings refuse Apply; Force lists each holder "
                                                    "with the exact keys removed and kept."))) {
        return;
    }
    if (m_shortcutStore == nullptr || m_clearedStore == nullptr) {
        m_shortcutError = QStringLiteral("reconciler is not configured");
        ShortcutDiag::log(QtWarningMsg, operation, "result", "failed",
                          QStringLiteral("reason=reconciler-unconfigured writes=0"));
        updateShortcutPresentation();
        return;
    }
    ShortcutReconciler reconciler(m_shortcutStore, m_clearedStore);
    const ShortcutApplyResult result = reconciler.apply();
    if (result.ok) {
        m_shortcutError.clear();
        clearForcePreview();
    } else {
        m_shortcutError = result.error.isEmpty() ? QStringLiteral("Apply failed") : result.error;
        // Explicit Force preview only when a holder claims a required key;
        // every other refusal clears any pending preview.
        const ShortcutForcePreview preview = reconciler.previewForceApply();
        if (preview.forceable) {
            m_forcePreview = preview;
            m_forcePreviewValid = true;
            m_forcePreviewText = buildForcePreviewText(preview);
        } else {
            clearForcePreview();
        }
    }
    ShortcutDiag::log(result.ok ? QtInfoMsg : QtWarningMsg, operation, "result", result.ok ? "ok" : "failed",
                      result.ok ? QStringLiteral("writes=%1").arg(result.writes)
                                : QStringLiteral("reason=%1 writes=%2").arg(result.error).arg(result.writes));
    refreshShortcutState();
}

void UnifiedSettingsModule::runShortcutRevert(const char *operation)
{
    QList<ClearedAction> cleared;
    QString clearedError;
    const bool clearedKnown = m_clearedStore != nullptr && m_clearedStore->load(&cleared, &clearedError);
    QString confirmText;
    if (clearedKnown && !cleared.isEmpty()) {
        confirmText = QStringLiteral("Restore KDE default shortcuts for %1 cleared binding(s) recorded by Force? "
                                     "Project shortcuts stay assigned. Custom cleared bindings are lost.")
                          .arg(cleared.size());
    } else {
        confirmText = QStringLiteral("Restore KDE default shortcuts for every binding recorded by Force? Project "
                                     "shortcuts stay assigned. Custom cleared bindings are lost.");
    }
    if (!confirmShortcutAction(QStringLiteral("Revert Shortcuts"), confirmText)) {
        return;
    }
    if (m_shortcutStore == nullptr || m_clearedStore == nullptr) {
        m_shortcutError = QStringLiteral("reconciler is not configured");
        ShortcutDiag::log(QtWarningMsg, operation, "result", "failed",
                          QStringLiteral("reason=reconciler-unconfigured writes=0"));
        updateShortcutPresentation();
        return;
    }
    ShortcutReconciler reconciler(m_shortcutStore, m_clearedStore);
    const ShortcutRevertResult result = reconciler.revert();
    if (result.ok) {
        m_shortcutError.clear();
    } else {
        m_shortcutError = result.error.isEmpty() ? QStringLiteral("Revert failed") : result.error;
    }
    ShortcutDiag::log(result.ok ? QtInfoMsg : QtWarningMsg, operation, "result", result.ok ? "ok" : "failed",
                      result.ok ? QStringLiteral("writes=%1").arg(result.writes)
                                : QStringLiteral("reason=%1 writes=%2")
                                      .arg(result.error)
                                      .arg(result.writes));
    clearForcePreview();
    refreshShortcutState();
}

void UnifiedSettingsModule::updateShortcutPresentation()
{
    if (m_ui.shortcutStatusLabel != nullptr) {
        m_ui.shortcutStatusLabel->setText(m_shortcutStatus);
    }
    if (m_ui.shortcutErrorLabel != nullptr) {
        m_ui.shortcutErrorLabel->setText(m_shortcutError);
    }
    if (m_ui.shortcutForcePreviewLabel != nullptr) {
        m_ui.shortcutForcePreviewLabel->setText(m_forcePreviewText);
        m_ui.shortcutForcePreviewLabel->setVisible(m_forcePreviewValid);
    }
    if (m_ui.shortcutForceApplyButton != nullptr) {
        m_ui.shortcutForceApplyButton->setVisible(m_forcePreviewValid);
    }
    if (m_ui.shortcutForceCancelButton != nullptr) {
        m_ui.shortcutForceCancelButton->setVisible(m_forcePreviewValid);
    }
}

void UnifiedSettingsModule::refreshShortcutState()
{
    if (m_shortcutStore == nullptr || m_clearedStore == nullptr) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: reconciler is not configured.");
        updateShortcutPresentation();
        return;
    }
    QString error;
    QList<ClearedAction> cleared;
    if (!m_clearedStore->load(&cleared, &error)) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: %1").arg(error);
        updateShortcutPresentation();
        return;
    }
    if (!m_shortcutStore->checkSetterContract(&error)) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: %1").arg(error);
        updateShortcutPresentation();
        return;
    }
    QString owner;
    uint uid = 0;
    if (!m_shortcutStore->currentOwner(&owner, &uid, &error)) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: %1").arg(error);
        updateShortcutPresentation();
        return;
    }
    QList<ShortcutTuple> tuples;
    if (!m_shortcutStore->readAll(&tuples, &error)) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: %1").arg(error);
        updateShortcutPresentation();
        return;
    }
    const QList<ShortcutConflictRow> &table = shortcutConflictTable();
    QList<const ShortcutTuple *> projectCurrents;
    projectCurrents.reserve(table.size());
    for (int i = 0; i < table.size(); ++i) {
        projectCurrents.append(nullptr);
    }
    const ShortcutTuple *lockCurrent = nullptr;
    QList<int> projectMatches;
    projectMatches.reserve(table.size());
    for (int i = 0; i < table.size(); ++i) {
        projectMatches.append(0);
    }
    int lockMatches = 0;
    for (const ShortcutTuple &tuple : tuples) {
        for (int i = 0; i < table.size(); ++i) {
            if (tuple.component == table.at(i).projectComponent && tuple.action == table.at(i).projectAction) {
                ++projectMatches[i];
                projectCurrents[i] = &tuple;
            }
        }
        if (tuple.component == table.at(0).foreignComponent && tuple.action == table.at(0).foreignAction) {
            ++lockMatches;
            lockCurrent = &tuple;
        }
    }
    bool projectsMissing = lockMatches != 1 || lockCurrent == nullptr;
    for (int i = 0; i < table.size(); ++i) {
        if (projectMatches.at(i) != 1 || projectCurrents.at(i) == nullptr) {
            projectsMissing = true;
        }
    }
    if (projectsMissing) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: project bindings are missing.");
        updateShortcutPresentation();
        return;
    }
    for (const ShortcutTuple &tuple : tuples) {
        if (ShortcutReconciler::isProjectAction(tuple.component, tuple.action)
            || ShortcutReconciler::isLockAction(tuple.component, tuple.action)) {
            continue;
        }
        if (!ShortcutReconciler::keysValid(tuple.active)) {
            m_shortcutStatus = QStringLiteral("Shortcut state unavailable: unrelated tuple is unbounded.");
            updateShortcutPresentation();
            return;
        }
    }
    // Authoritative keyed foreign-occupancy gate for the project-required
    // chords, never tuple enumeration. Typed outcome keeps Conflict vs
    // unavailable semantics without substring matching. The explicit System
    // Monitor `_launch` Meta+Esc holder is user-authorized.
    {
        const KeyedOccupancyResult keyed = ShortcutReconciler::checkKeyedForeignOccupancyDetailed(m_shortcutStore);
        if (keyed.status != KeyedOccupancy::Clear) {
            if (keyed.status == KeyedOccupancy::Conflict) {
                m_shortcutStatus = QStringLiteral("Conflict: %1. Apply is refused.").arg(keyed.detail);
            } else {
                m_shortcutStatus = QStringLiteral("Shortcut state unavailable: %1").arg(keyed.detail);
            }
            updateShortcutPresentation();
            return;
        }
    }
    bool allAtPost = true;
    for (int i = 0; i < table.size(); ++i) {
        if (projectCurrents.at(i)->active != table.at(i).projectPost) {
            allAtPost = false;
            break;
        }
    }
    bool lockHasPre = false;
    bool lockHasTarget = false;
    for (int key : table.at(0).foreignExpectedPre) {
        if (lockCurrent->active.contains(key)) {
            lockHasPre = true;
        }
    }
    for (int key : table.at(0).resolutionTarget) {
        if (lockCurrent->active.contains(key)) {
            lockHasTarget = true;
        }
    }
    QString clearedHint;
    if (!cleared.isEmpty()) {
        clearedHint = QStringLiteral(" %1 cleared binding(s) recorded; Revert restores KDE defaults.")
                          .arg(cleared.size());
    }
    const int prefixSize = QStringLiteral("plasma-auto-tiler-").size();
    if (allAtPost && !lockHasPre && lockHasTarget) {
        QStringList owns;
        owns.append(QStringLiteral("%1 owns %2, %3 owns %4")
                        .arg(table.at(0).projectAction.mid(prefixSize), table.at(0).projectDisplay,
                             table.at(0).foreignAction, table.at(0).targetDisplay));
        for (int i = 1; i < table.size(); ++i) {
            owns.append(QStringLiteral("%1 owns %2")
                            .arg(table.at(i).projectAction.mid(prefixSize), table.at(i).projectDisplay));
        }
        m_shortcutStatus = QStringLiteral("Shortcuts applied (%1 rows): %2.").arg(table.size()).arg(owns.join(QStringLiteral(", ")))
            + clearedHint;
        updateShortcutPresentation();
        return;
    }
    QStringList assigns;
    assigns.append(QStringLiteral("assign %1 to %2 and move %3 to %4")
                       .arg(table.at(0).projectAction.mid(prefixSize), table.at(0).projectDisplay,
                            table.at(0).foreignAction, table.at(0).targetDisplay));
    for (int i = 1; i < table.size(); ++i) {
        assigns.append(QStringLiteral("assign %1 to %2")
                           .arg(table.at(i).projectAction.mid(prefixSize), table.at(i).projectDisplay));
    }
    m_shortcutStatus = QStringLiteral("Ready (%1 rows): Apply will %2.").arg(table.size()).arg(assigns.join(QStringLiteral("; ")))
        + clearedHint;
    updateShortcutPresentation();
}

QString UnifiedSettingsModule::scriptStatusText() const
{
    return m_scriptStatus;
}

bool UnifiedSettingsModule::isScriptRestartRequired() const
{
    return m_scriptRestartRequired;
}

bool UnifiedSettingsModule::isGapReconfigurePending() const
{
    return m_gapReconfigurePending;
}

QVariantMap UnifiedSettingsModule::currentScriptValues() const
{
    return {
        {QStringLiteral("workspaceMode"), m_ui.workspaceModeCombo->currentData()},
        {QStringLiteral("innerGap"), m_ui.innerGapSpinBox->value()},
        {QStringLiteral("outerGap"), m_ui.outerGapSpinBox->value()},
    };
}

void UnifiedSettingsModule::updateScriptState()
{
    const QVariantMap current = currentScriptValues();
    const QVariantMap defaults = {
        {QStringLiteral("workspaceMode"), QStringLiteral("per-output-local")},
        {QStringLiteral("innerGap"), kGapDefault},
        {QStringLiteral("outerGap"), kGapDefault},
    };
    unmanagedWidgetChangeState(m_gapReconfigurePending
                               || (!m_loadedScriptValues.isEmpty() && current != m_loadedScriptValues));
    unmanagedWidgetDefaultState(current == defaults);
}

void UnifiedSettingsModule::load()
{
    KCModule::load();

    clearForcePreview();
    refreshShortcutState();
    m_windowConflictError.clear();
    refreshWindowConflicts();

    const KConfigGroup group(KSharedConfig::openConfig(QStringLiteral("kwinrc")),
                             QStringLiteral("Script-plasma-auto-tiler-kwin"));
    const auto select = [](QComboBox *combo, const QString &value, const QString &fallback) {
        const int index = combo->findData(value);
        const int fallbackIndex = combo->findData(fallback);
        combo->setCurrentIndex(index >= 0 ? index : fallbackIndex);
    };
    const QString workspaceMode = group.readEntry(QStringLiteral("workspaceMode"), QStringLiteral("per-output-local"));
    const int innerGap = readBoundedGap(group, QStringLiteral("innerGap"));
    const int outerGap = readBoundedGap(group, QStringLiteral("outerGap"));
    m_loadedInnerGapRawValid = isBoundedGapRawValid(group, QStringLiteral("innerGap"));
    m_loadedOuterGapRawValid = isBoundedGapRawValid(group, QStringLiteral("outerGap"));
    select(m_ui.workspaceModeCombo, workspaceMode, QStringLiteral("per-output-local"));
    m_ui.innerGapSpinBox->setValue(innerGap);
    m_ui.outerGapSpinBox->setValue(outerGap);
    m_loadedScriptValues = {
        {QStringLiteral("workspaceMode"), workspaceMode},
        {QStringLiteral("innerGap"), innerGap},
        {QStringLiteral("outerGap"), outerGap},
    };
    updateScriptState();
    m_scriptRestartRequired = false;
    m_gapReconfigurePending = false;
    updateScriptState();
    m_scriptStatus = QStringLiteral("No pending script setting in this dialog.");
    if (m_ui.scriptStatusLabel != nullptr) {
        m_ui.scriptStatusLabel->setText(m_scriptStatus);
    }
}

void UnifiedSettingsModule::save()
{
    const bool borderChanged = managedWidgetChangeState();

    const QVariantMap current = currentScriptValues();
    const bool widgetsChanged =
        !m_loadedInnerGapRawValid || !m_loadedOuterGapRawValid || current != m_loadedScriptValues;
    const bool gapChanged = !m_loadedInnerGapRawValid || !m_loadedOuterGapRawValid
        || current.value(QStringLiteral("innerGap")) != m_loadedScriptValues.value(QStringLiteral("innerGap"))
        || current.value(QStringLiteral("outerGap")) != m_loadedScriptValues.value(QStringLiteral("outerGap"));
    // Per-key startup changes are captured before persistence refreshes the
    // loaded snapshot; comparing afterwards would always match and the
    // restart-required log must enumerate only the keys that changed.
    const bool workspaceModeChanged = current.value(QStringLiteral("workspaceMode"))
        != m_loadedScriptValues.value(QStringLiteral("workspaceMode"));
    const bool startupConsumedChanged = workspaceModeChanged;
    const bool scriptRetryArmed = m_gapReconfigurePending;

    KCModule::save();

    if (borderChanged) {
        m_effectReconfigurePending = true;
    }

    if (!widgetsChanged && !scriptRetryArmed) {
        updateScriptState();
    } else {
    // This module owns exactly workspaceMode, innerGap, and outerGap. Any
    // other key in this group (including the hidden shortcutProfile) is never
    // read here beyond the group open and is never written; there is no
    // migration. A pure retry
    // save (pending request, unchanged widgets) skips persistence: the loaded
    // values already match the widgets.
    KConfigGroup group(KSharedConfig::openConfig(QStringLiteral("kwinrc")),
                       QStringLiteral("Script-plasma-auto-tiler-kwin"));
    QStringList written;
    if (widgetsChanged) {
        if (workspaceModeChanged) {
            group.writeEntry(QStringLiteral("workspaceMode"), current.value(QStringLiteral("workspaceMode")).toString());
            written.append(QStringLiteral("workspaceMode"));
        }
        if (!m_loadedInnerGapRawValid
            || current.value(QStringLiteral("innerGap")) != m_loadedScriptValues.value(QStringLiteral("innerGap"))) {
            group.writeEntry(QStringLiteral("innerGap"), current.value(QStringLiteral("innerGap")).toInt());
            written.append(QStringLiteral("innerGap"));
        }
        if (!m_loadedOuterGapRawValid
            || current.value(QStringLiteral("outerGap")) != m_loadedScriptValues.value(QStringLiteral("outerGap"))) {
            group.writeEntry(QStringLiteral("outerGap"), current.value(QStringLiteral("outerGap")).toInt());
            written.append(QStringLiteral("outerGap"));
        }
        group.sync();
        m_loadedScriptValues = current;
        m_loadedInnerGapRawValid = true;
        m_loadedOuterGapRawValid = true;
        logScriptConfig("save", "persist", "ok", QStringLiteral("keys=%1").arg(written.join(QStringLiteral(","))));
    }
    if (startupConsumedChanged) {
        m_scriptRestartRequired = true;
        QStringList startupWritten;
        if (workspaceModeChanged) {
            startupWritten.append(QStringLiteral("workspaceMode"));
        }
        logScriptConfig("save", "startup", "restart-required",
                        QStringLiteral("keys=%1").arg(startupWritten.join(QStringLiteral(","))));
    }
    // Changed gaps request one typed KWin reconfigure after persistence whose
    // pickup is the running controller's Options configChanged gap re-read.
    // KWin's reconfigure is Q_NOREPLY, so a queued send never proves the
    // running script reread kwinrc. Success reports sent-but-unconfirmed and
    // clears any pending retry; failure arms a retry on the next save (an
    // unchanged save still sends while armed, and Apply stays enabled for it
    // through updateScriptState) and reports failed with the retry. A pure
    // retry save skips persistence, so its statuses must not claim anything
    // was saved by the retry. A queued send never clears a pending
    // session-restart requirement for the startup-consumed setting
    // (workspaceMode) and never claims the running tiler applied saved values.
    if (gapChanged || scriptRetryArmed) {
        if (requestScriptReconfigure()) {
            m_gapReconfigurePending = false;
            logScriptConfig("save", "reconfigure", "sent-unconfirmed", QStringLiteral("method=reconfigure"));
            if (!widgetsChanged) {
                if (m_scriptRestartRequired) {
                    m_scriptStatus = QStringLiteral(
                        "Reconfigure request sent for gaps; application unconfirmed. This retry saved nothing; "
                        "persisted settings are unchanged. Session restart remains required for workspace mode. "
                        "Restart the session to guarantee pickup.");
                } else {
                    m_scriptStatus = QStringLiteral(
                        "Reconfigure request sent; application unconfirmed. This retry saved nothing; persisted "
                        "settings are unchanged. Restart the session to guarantee pickup.");
                }
            } else if (m_scriptRestartRequired) {
                m_scriptStatus = QStringLiteral(
                    "Settings saved to kwinrc. Reconfigure request sent for gaps; "
                    "application unconfirmed. Session restart remains required for workspace mode. Restart the "
                    "session to guarantee pickup.");
            } else {
                m_scriptStatus = QStringLiteral(
                    "Tiling gaps saved to kwinrc. Reconfigure request sent; application unconfirmed. Restart the "
                    "session to guarantee pickup.");
            }
        } else {
            m_gapReconfigurePending = true;
            logScriptConfig("save", "reconfigure", "failed",
                            QStringLiteral("method=reconfigure retry-on-next-save"));
            if (!widgetsChanged) {
                if (m_scriptRestartRequired) {
                    m_scriptStatus = QStringLiteral(
                        "Reconfigure request failed; the running tiler still uses startup gap values. This retry saved "
                        "nothing; the request will retry on the next save. Session restart remains required for workspace "
                        "mode.");
                } else {
                    m_scriptStatus = QStringLiteral(
                        "Reconfigure request failed; the running tiler still uses startup gap values. This retry saved "
                        "nothing; the request will retry on the next save. Restart the session to guarantee pickup.");
                }
            } else if (m_scriptRestartRequired) {
                m_scriptStatus = QStringLiteral(
                    "Settings saved to kwinrc. Reconfigure request failed; the running tiler still uses "
                    "startup gap values. The request will retry on the next save. Session restart remains required for "
                    "workspace mode.");
            } else {
                m_scriptStatus = QStringLiteral(
                    "Tiling gaps saved to kwinrc. Reconfigure request failed; the running tiler still uses startup gap values. "
                    "The request will retry on the next save; restart the session to guarantee pickup.");
            }
        }
    } else if (m_scriptRestartRequired) {
        m_scriptStatus = QStringLiteral(
            "Workspace mode saved. Session restart required: the running tiler still uses startup values.");
    }
    updateScriptState();
    if (m_ui.scriptStatusLabel != nullptr) {
        m_ui.scriptStatusLabel->setText(m_scriptStatus);
    }
    }

    // Border hot-apply stays live through the native effect reconfigure and
    // runs after the script unmanaged state settles so a failed effect
    // reconfigure keeps Apply enabled via markAsChanged without being
    // cleared by updateScriptState.
    if (m_effectReconfigurePending) {
        if (requestEffectReconfigure()) {
            m_effectReconfigurePending = false;
        } else {
            markAsChanged();
        }
    }
}

void UnifiedSettingsModule::defaults()
{
    KCModule::defaults();

    m_ui.workspaceModeCombo->setCurrentIndex(m_ui.workspaceModeCombo->findData(QStringLiteral("per-output-local")));
    m_ui.innerGapSpinBox->setValue(kGapDefault);
    m_ui.outerGapSpinBox->setValue(kGapDefault);
    updateScriptState();
}

void UnifiedSettingsModule::refreshWindowConflicts()
{
    updateWindowConflictPresentation();
}

void UnifiedSettingsModule::requestWindowFix(const QString &key)
{
    runWindowConflictWrite(key, "fix");
}

void UnifiedSettingsModule::requestWindowRevert(const QString &key)
{
    runWindowConflictWrite(key, "revert");
}

void UnifiedSettingsModule::runWindowConflictWrite(const QString &key, const char *operation)
{
    const bool isFix = QString::fromUtf8(operation) == QStringLiteral("fix");
    const bool isBorders = key == QStringLiteral("ElectricBorders");

    const KSharedConfig::Ptr config = KSharedConfig::openConfig(QStringLiteral("kwinrc"));
    KConfigGroup group(config, QStringLiteral("Windows"));
    if (isFix && !isBorders) {
        group.writeEntry(key, false);
    } else {
        group.deleteEntry(key);
    }
    bool syncOk = group.sync();
    if (syncOk) {
        syncOk = config->sync();
    }
    bool sendOk = false;
    if (syncOk) {
        sendOk = requestScriptReconfigure();
    }

    config->reparseConfiguration();
    const KConfigGroup readback(config, QStringLiteral("Windows"));
    bool matches = false;
    if (isBorders) {
        matches = readback.readEntry(key, 0) == 0;
    } else if (isFix) {
        matches = !readback.readEntry(key, true);
    } else {
        matches = readback.readEntry(key, true);
    }

    const bool ok = syncOk && sendOk && matches;
    QString reason;
    if (!syncOk) {
        reason = QStringLiteral("write-failed");
    } else if (!sendOk) {
        reason = QStringLiteral("send-failed");
    } else if (!matches) {
        reason = QStringLiteral("readback-mismatch");
    } else {
        reason = QStringLiteral("ok");
    }
    logWindowConflict(operation, key, ok ? "ok" : "failed", reason);
    if (ok) {
        m_windowConflictError.clear();
    } else {
        const QString what = isFix ? QStringLiteral("Fix") : QStringLiteral("Revert");
        QString cause;
        if (!syncOk) {
            cause = QStringLiteral("the kwinrc write failed");
        } else if (!sendOk) {
            cause = QStringLiteral("the KWin reconfigure send failed");
        } else {
            cause = QStringLiteral("the re-read value did not match");
        }
        m_windowConflictError = QStringLiteral("%1 failed for %2: %3.").arg(what, key, cause);
    }
    updateWindowConflictPresentation();
}

void UnifiedSettingsModule::updateWindowConflictPresentation()
{
    const WindowConflictState state = readWindowConflictState();
    const int conflicts = (state.tiling ? 1 : 0) + (state.maximize ? 1 : 0) + (state.borders != 0 ? 1 : 0);

    if (m_ui.windowConflictStatusLabel != nullptr) {
        m_ui.windowConflictStatusLabel->setText(
            conflicts > 0 ? QStringLiteral("Found %1 conflicting edge setting(s). Use Fix on each shown row.")
                                        .arg(conflicts)
                          : QStringLiteral("No window edge conflicts."));
    }
    if (m_ui.windowTilingLabel != nullptr) {
        m_ui.windowTilingLabel->setText(QStringLiteral("ElectricBorderTiling: %1. Edge drag tiles windows over our preview.")
                                            .arg(state.tiling ? QStringLiteral("on") : QStringLiteral("off")));
    }
    if (m_ui.windowMaximizeLabel != nullptr) {
        m_ui.windowMaximizeLabel->setText(QStringLiteral("ElectricBorderMaximize: %1. Top-edge drag maximizes windows over our preview.")
                                               .arg(state.maximize ? QStringLiteral("on") : QStringLiteral("off")));
    }
    if (m_ui.windowBordersLabel != nullptr) {
        m_ui.windowBordersLabel->setText(
            QStringLiteral("ElectricBorders: %1. Switching desktops at edges interrupts a window drag.").arg(state.borders));
    }
    if (m_ui.windowTilingFixButton != nullptr) {
        m_ui.windowTilingFixButton->setVisible(state.tiling);
    }
    if (m_ui.windowTilingRevertButton != nullptr) {
        m_ui.windowTilingRevertButton->setVisible(!state.tiling);
    }
    if (m_ui.windowMaximizeFixButton != nullptr) {
        m_ui.windowMaximizeFixButton->setVisible(state.maximize);
    }
    if (m_ui.windowMaximizeRevertButton != nullptr) {
        m_ui.windowMaximizeRevertButton->setVisible(!state.maximize);
    }
    if (m_ui.windowBordersRow != nullptr) {
        m_ui.windowBordersRow->setVisible(state.borders != 0);
    }
    if (m_ui.windowConflictErrorLabel != nullptr) {
        m_ui.windowConflictErrorLabel->setText(m_windowConflictError);
    }
}

} // namespace KWin
