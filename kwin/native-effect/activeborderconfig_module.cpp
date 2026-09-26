#include "activeborderconfig_module.h"
#include "activeborderconfig.h"

#include <KPluginFactory>

#include <QDBusConnection>
#include <QDBusInterface>
#include <QDBusMessage>
#include <QMessageBox>
#include <QPushButton>

K_PLUGIN_CLASS_WITH_JSON(KWin::ActiveBorderConfigModule, "activeborderconfig_module.json")

namespace KWin
{

ActiveBorderConfigModule::ActiveBorderConfigModule(QObject *parent, const KPluginMetaData &data)
    : KCModule(parent, data)
{
    ActiveBorderConfig::instance(QStringLiteral("kwinrc"));
    m_ui.setupUi(widget());
    addConfig(ActiveBorderConfig::self(), widget());

    m_shortcutStore = createLiveShortcutStore();
    // Project-owned cleared-actions config only. Constructing the
    // backends writes nothing. Opening, refreshing, previewing,
    // or cancelling never writes config.
    m_clearedStore = createLiveClearedActionsStore(defaultClearedActionsPath());
    m_ownsShortcutStores = true;
    connect(m_ui.shortcutApplyButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutApply);
    connect(m_ui.shortcutRevertButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutRevert);
    connect(m_ui.shortcutForceApplyButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutForceApply);
    connect(m_ui.shortcutForceCancelButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutForceCancel);
    refreshShortcutState();
}

ActiveBorderConfigModule::~ActiveBorderConfigModule()
{
    if (m_ownsShortcutStores) {
        delete m_shortcutStore;
        delete m_clearedStore;
    }
}

QString ActiveBorderConfigModule::effectService()
{
    return QStringLiteral("org.kde.KWin");
}

QString ActiveBorderConfigModule::effectPath()
{
    return QStringLiteral("/Effects");
}

QString ActiveBorderConfigModule::effectInterface()
{
    return QStringLiteral("org.kde.kwin.Effects");
}

QString ActiveBorderConfigModule::effectMethod()
{
    return QStringLiteral("reconfigureEffect");
}

QString ActiveBorderConfigModule::effectName()
{
    return QStringLiteral("plasma-auto-tiler-active-border");
}

bool ActiveBorderConfigModule::isEffectReconfigureFailed(const QDBusMessage &reply)
{
    return reply.type() != QDBusMessage::ReplyMessage;
}

bool ActiveBorderConfigModule::requestEffectReconfigure()
{
    QDBusInterface interface(effectService(), effectPath(), effectInterface(), QDBusConnection::sessionBus());
    const QDBusMessage reply = interface.call(effectMethod(), effectName());
    return !isEffectReconfigureFailed(reply);
}

void ActiveBorderConfigModule::setShortcutStores(ShortcutStore *store, ClearedActionsStore *cleared)
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

void ActiveBorderConfigModule::setShortcutConfirmHandler(std::function<bool(const QString &, const QString &)> handler)
{
    m_shortcutConfirm = std::move(handler);
}

QString ActiveBorderConfigModule::shortcutStatusText() const
{
    return m_shortcutStatus;
}

QString ActiveBorderConfigModule::shortcutErrorText() const
{
    return m_shortcutError;
}

QString ActiveBorderConfigModule::shortcutForcePreviewText() const
{
    return m_forcePreviewText;
}

bool ActiveBorderConfigModule::isShortcutForceApplyVisible() const
{
    return m_ui.shortcutForceApplyButton != nullptr && !m_ui.shortcutForceApplyButton->isHidden();
}

bool ActiveBorderConfigModule::isShortcutForceCancelVisible() const
{
    return m_ui.shortcutForceCancelButton != nullptr && !m_ui.shortcutForceCancelButton->isHidden();
}

void ActiveBorderConfigModule::requestShortcutApply()
{
    runShortcutApply("apply");
}

bool ActiveBorderConfigModule::confirmShortcutAction(const QString &title, const QString &text)
{
    if (m_shortcutConfirm) {
        return m_shortcutConfirm(title, text);
    }
    return QMessageBox::question(widget(), title, text, QMessageBox::Yes | QMessageBox::No, QMessageBox::No) == QMessageBox::Yes;
}

void ActiveBorderConfigModule::requestShortcutRevert()
{
    runShortcutRevert("revert");
}

void ActiveBorderConfigModule::requestShortcutForceApply()
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

void ActiveBorderConfigModule::requestShortcutForceCancel()
{
    if (!m_forcePreviewValid) {
        return;
    }
    ShortcutDiag::log(QtDebugMsg, "force-preview", "cancel", "cancelled", QStringLiteral("rows=preview"));
    clearForcePreview();
    refreshShortcutState();
}

void ActiveBorderConfigModule::clearForcePreview()
{
    m_forcePreview = ShortcutForcePreview();
    m_forcePreviewValid = false;
    m_forcePreviewText.clear();
}

QString ActiveBorderConfigModule::buildForcePreviewText(const ShortcutForcePreview &preview)
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

void ActiveBorderConfigModule::runShortcutApply(const char *operation)
{
    if (!confirmShortcutAction(QStringLiteral("Apply Shortcuts"),
                               QStringLiteral("Assign focus-right to Meta+L and move Lock Session to Meta+Esc; assign "
                                              "resize-outwards-up to Meta+Alt+K; assign resize-outwards-right to "
                                              "Meta+Alt+L; assign toggle-float to Meta+G; assign toggle-maximize to "
                                              "Meta+M? Conflicting bindings refuse Apply; Force lists each holder "
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

void ActiveBorderConfigModule::runShortcutRevert(const char *operation)
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

void ActiveBorderConfigModule::updateShortcutPresentation()
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

void ActiveBorderConfigModule::refreshShortcutState()
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
    const ShortcutTuple *focusCurrent = nullptr;
    const ShortcutTuple *lockCurrent = nullptr;
    const ShortcutTuple *upCurrent = nullptr;
    const ShortcutTuple *rightCurrent = nullptr;
    const ShortcutTuple *floatCurrent = nullptr;
    const ShortcutTuple *maximizeCurrent = nullptr;
    int matches[6] = {0, 0, 0, 0, 0, 0};
    for (const ShortcutTuple &tuple : tuples) {
        if (tuple.component == shortcutFocusComponent() && tuple.action == shortcutFocusAction()) {
            ++matches[0];
            focusCurrent = &tuple;
        } else if (tuple.component == shortcutLockComponent() && tuple.action == shortcutLockAction()) {
            ++matches[1];
            lockCurrent = &tuple;
        } else if (tuple.component == shortcutResizeUpComponent() && tuple.action == shortcutResizeUpAction()) {
            ++matches[2];
            upCurrent = &tuple;
        } else if (tuple.component == shortcutResizeRightComponent() && tuple.action == shortcutResizeRightAction()) {
            ++matches[3];
            rightCurrent = &tuple;
        } else if (tuple.component == shortcutFloatComponent() && tuple.action == shortcutFloatAction()) {
            ++matches[4];
            floatCurrent = &tuple;
        } else if (tuple.component == shortcutMaximizeComponent() && tuple.action == shortcutMaximizeAction()) {
            ++matches[5];
            maximizeCurrent = &tuple;
        }
    }
    if (matches[0] != 1 || matches[1] != 1 || matches[2] != 1 || matches[3] != 1 || matches[4] != 1 || matches[5] != 1
        || focusCurrent == nullptr || lockCurrent == nullptr || upCurrent == nullptr || rightCurrent == nullptr
        || floatCurrent == nullptr || maximizeCurrent == nullptr) {
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
    const bool focusAtPost = focusCurrent->active == ShortcutReconciler::focusPostKeys();
    const bool lockHasMetaL = lockCurrent->active.contains(SHORTCUT_META_L);
    const bool lockHasMetaEsc = lockCurrent->active.contains(SHORTCUT_META_ESC);
    const bool upAtPost = upCurrent->active == ShortcutReconciler::resizeUpPostKeys();
    const bool rightAtPost = rightCurrent->active == ShortcutReconciler::resizeRightPostKeys();
    const bool floatAtPost = floatCurrent->active == ShortcutReconciler::floatPostKeys();
    const bool maximizeAtPost = maximizeCurrent->active == ShortcutReconciler::maximizePostKeys();
    QString clearedHint;
    if (!cleared.isEmpty()) {
        clearedHint = QStringLiteral(" %1 cleared binding(s) recorded; Revert restores KDE defaults.")
                          .arg(cleared.size());
    }
    if (focusAtPost && !lockHasMetaL && lockHasMetaEsc && upAtPost && rightAtPost && floatAtPost && maximizeAtPost) {
        m_shortcutStatus = QStringLiteral("Shortcuts applied (5 rows): focus-right owns Meta+L, Lock Session owns "
                                           "Meta+Esc, resize-outwards-up owns Meta+Alt+K, resize-outwards-right owns "
                                           "Meta+Alt+L, toggle-float owns Meta+G, toggle-maximize owns Meta+M.")
            + clearedHint;
        updateShortcutPresentation();
        return;
    }
    m_shortcutStatus = QStringLiteral("Ready (5 rows): Apply will assign focus-right to Meta+L and move Lock "
                                       "Session to Meta+Esc; assign resize-outwards-up to Meta+Alt+K; assign "
                                       "resize-outwards-right to Meta+Alt+L; assign toggle-float to Meta+G; assign "
                                       "toggle-maximize to Meta+M.")
        + clearedHint;
    updateShortcutPresentation();
}

void ActiveBorderConfigModule::load()
{
    KCModule::load();

    clearForcePreview();
    refreshShortcutState();
}

void ActiveBorderConfigModule::save()
{
    const bool borderChanged = managedWidgetChangeState();
    KCModule::save();

    if (borderChanged) {
        m_effectReconfigurePending = true;
    }
    if (m_effectReconfigurePending) {
        if (requestEffectReconfigure()) {
            m_effectReconfigurePending = false;
        } else {
            markAsChanged();
        }
    }
    // Border hot-apply stays live through the native effect reconfigure.
    // Script settings (workspace mode, tiling gaps) live in
    // the native script KCM and never pass through this module.
}

void ActiveBorderConfigModule::defaults()
{
    KCModule::defaults();
}

} // namespace KWin

#include "activeborderconfig_module.moc"
