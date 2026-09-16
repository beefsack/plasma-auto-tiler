#include "activeborderconfig_module.h"
#include "activeborderconfig.h"

#include <KConfigGroup>
#include <KLocalizedString>
#include <KPluginFactory>
#include <KSharedConfig>

#include <QCheckBox>
#include <QComboBox>
#include <QDBusConnection>
#include <QDBusInterface>
#include <QDBusMessage>
#include <QLabel>
#include <QMessageBox>
#include <QPushButton>
#include <QSpinBox>

K_PLUGIN_CLASS_WITH_JSON(KWin::ActiveBorderConfigModule, "activeborderconfig_module.json")

namespace KWin
{

namespace
{

int readBoundedGap(const KConfigGroup &group, const QString &key)
{
    if (!group.hasKey(key)) {
        return 8;
    }
    bool ok = false;
    const int parsed = group.readEntry(key, QString()).toInt(&ok);
    if (ok && parsed >= 0 && parsed <= 64) {
        return parsed;
    }
    return 8;
}

bool isBoundedGapRawValid(const KConfigGroup &group, const QString &key)
{
    if (!group.hasKey(key)) {
        return true;
    }
    bool ok = false;
    const int parsed = group.readEntry(key, QString()).toInt(&ok);
    return ok && parsed >= 0 && parsed <= 64;
}

} // namespace

ActiveBorderConfigModule::ActiveBorderConfigModule(QObject *parent, const KPluginMetaData &data)
    : KCModule(parent, data)
{
    ActiveBorderConfig::instance(QStringLiteral("kwinrc"));
    m_ui.setupUi(widget());
    addConfig(ActiveBorderConfig::self(), widget());

    m_ui.tilingAlgorithmCombo->addItem(i18n("Columns"), QStringLiteral("columns"));
    m_ui.tilingAlgorithmCombo->addItem(i18n("Rows"), QStringLiteral("rows"));
    m_ui.tilingAlgorithmCombo->addItem(i18n("Balanced grid"), QStringLiteral("balanced-grid"));
    m_ui.tilingAlgorithmCombo->addItem(i18n("Dwindle"), QStringLiteral("dwindle"));

    m_ui.automaticSplitTargetCombo->addItem(i18n("Dwindle"), QStringLiteral("dwindle"));
    m_ui.automaticSplitTargetCombo->addItem(i18n("Largest"), QStringLiteral("largest"));
    m_ui.automaticSplitTargetCombo->addItem(i18n("Active"), QStringLiteral("active"));

    m_ui.workspaceModeCombo->addItem(i18n("Per output, local"), QStringLiteral("per-output-local"));
    m_ui.workspaceModeCombo->addItem(i18n("Global, unique"), QStringLiteral("global-unique"));
    m_ui.workspaceModeCombo->addItem(i18n("Shared"), QStringLiteral("shared"));

    m_ui.shortcutProfileCombo->addItem(i18n("COSMIC"), QStringLiteral("cosmic"));
    m_ui.shortcutProfileCombo->addItem(i18n("Hyprland"), QStringLiteral("hyprland"));
    m_ui.shortcutProfileCombo->addItem(i18n("bspwm"), QStringLiteral("bspwm"));

    connect(m_ui.tilingAlgorithmCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, &ActiveBorderConfigModule::updateScriptState);
    connect(m_ui.automaticSplitTargetCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, &ActiveBorderConfigModule::updateScriptState);
    connect(m_ui.workspaceModeCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, &ActiveBorderConfigModule::updateScriptState);
    connect(m_ui.shortcutProfileCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, &ActiveBorderConfigModule::updateScriptState);
    connect(m_ui.dropOutlinePreviewCheckBox, &QCheckBox::toggled, this, &ActiveBorderConfigModule::updateScriptState);
    connect(m_ui.innerGapSpinBox, QOverload<int>::of(&QSpinBox::valueChanged), this, &ActiveBorderConfigModule::updateScriptState);
    connect(m_ui.outerGapSpinBox, QOverload<int>::of(&QSpinBox::valueChanged), this, &ActiveBorderConfigModule::updateScriptState);

    m_shortcutStore = createLiveShortcutStore();
    m_shortcutJournal = createLiveShortcutJournal(defaultShortcutJournalPath());
    m_ownsShortcutStores = true;
    connect(m_ui.shortcutApplyButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutApply);
    connect(m_ui.shortcutRevertButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutRevert);
    connect(m_ui.shortcutFinishApplyButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutFinishApply);
    connect(m_ui.shortcutRestoreButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutRestore);
    connect(m_ui.tilerReloadButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestTilerReload);
    refreshShortcutState();
    m_tilerReloadRequired = false;
    m_tilerRestartRequired = false;
    m_tilerReloadStatus = QStringLiteral("No pending tiler reload in this dialog.");
    updateTilerReloadPresentation();
}

ActiveBorderConfigModule::~ActiveBorderConfigModule()
{
    if (m_ownsShortcutStores) {
        delete m_shortcutStore;
        delete m_shortcutJournal;
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

QString ActiveBorderConfigModule::scriptService()
{
    return QStringLiteral("org.kde.KWin");
}

QString ActiveBorderConfigModule::scriptPath()
{
    return QStringLiteral("/KWin");
}

QString ActiveBorderConfigModule::scriptInterface()
{
    return QStringLiteral("org.kde.KWin");
}

QString ActiveBorderConfigModule::scriptMethod()
{
    return QStringLiteral("reconfigure");
}

bool ActiveBorderConfigModule::requestScriptReconfigure()
{
    QDBusInterface interface(scriptService(), scriptPath(), scriptInterface(), QDBusConnection::sessionBus());
    if (!interface.isValid()) {
        return false;
    }
    return QDBusConnection::sessionBus().send(
        QDBusMessage::createMethodCall(scriptService(), scriptPath(), scriptInterface(), scriptMethod()));
}

void ActiveBorderConfigModule::setShortcutStores(ShortcutStore *store, JournalStore *journal)
{
    if (m_ownsShortcutStores) {
        delete m_shortcutStore;
        delete m_shortcutJournal;
        m_ownsShortcutStores = false;
    }
    m_shortcutStore = store;
    m_shortcutJournal = journal;
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

bool ActiveBorderConfigModule::isShortcutFinishApplyVisible() const
{
    return m_ui.shortcutFinishApplyButton != nullptr && !m_ui.shortcutFinishApplyButton->isHidden();
}

bool ActiveBorderConfigModule::isShortcutRestoreVisible() const
{
    return m_ui.shortcutRestoreButton != nullptr && !m_ui.shortcutRestoreButton->isHidden();
}

QString ActiveBorderConfigModule::tilerReloadStatusText() const
{
    return m_tilerReloadStatus;
}

bool ActiveBorderConfigModule::isTilerReloadRequired() const
{
    return m_tilerReloadRequired;
}

bool ActiveBorderConfigModule::isTilerRestartRequired() const
{
    return m_tilerRestartRequired;
}

void ActiveBorderConfigModule::requestTilerReload()
{
    // Deliberate gap-only reload: one typed KWin reconfigure send whose pickup
    // is the running controller's Options configChanged gap re-read. KWin's
    // reconfigure is Q_NOREPLY, so a queued send never proves the running
    // script reread kwinrc. Success keeps reload-required and reports
    // sent-but-unconfirmed; failure keeps reload-required and reports failed.
    // A queued send never clears a pending session-restart requirement for
    // non-gap startup settings and never claims all settings applied. This
    // never touches shortcuts and never unloads scripts or plugins. With no
    // pending gap reload the request is refused without sending so an idle
    // click can neither queue D-Bus traffic nor mark the dialog reload-required.
    if (!m_tilerReloadRequired) {
        return;
    }
    if (requestScriptReconfigure()) {
        if (m_tilerRestartRequired) {
            m_tilerReloadStatus = QStringLiteral(
                "Reload request sent. Gap application unconfirmed; session restart remains required for other "
                "settings. Restart the session to guarantee pickup.");
        } else {
            m_tilerReloadStatus = QStringLiteral(
                "Reload request sent. Application unconfirmed; restart the session to guarantee pickup.");
        }
    } else {
        if (m_tilerRestartRequired) {
            m_tilerReloadStatus = QStringLiteral(
                "Reload request failed. Running tiler still uses startup values; retry or restart the session. "
                "Session restart remains required for other settings.");
        } else {
            m_tilerReloadRequired = true;
            m_tilerReloadStatus = QStringLiteral(
                "Reload request failed. Running tiler still uses startup values; retry or restart the session.");
        }
    }
    updateTilerReloadPresentation();
}

void ActiveBorderConfigModule::updateTilerReloadPresentation()
{
    if (m_ui.tilerReloadStatusLabel != nullptr) {
        m_ui.tilerReloadStatusLabel->setText(m_tilerReloadStatus);
    }
    if (m_ui.tilerReloadButton != nullptr) {
        m_ui.tilerReloadButton->setEnabled(m_tilerReloadRequired);
    }
}

bool ActiveBorderConfigModule::confirmShortcutAction(const QString &title, const QString &text)
{
    if (m_shortcutConfirm) {
        return m_shortcutConfirm(title, text);
    }
    return QMessageBox::question(widget(), title, text, QMessageBox::Yes | QMessageBox::No, QMessageBox::No) == QMessageBox::Yes;
}

void ActiveBorderConfigModule::requestShortcutApply()
{
    runShortcutApply();
}

void ActiveBorderConfigModule::requestShortcutFinishApply()
{
    runShortcutApply();
}

void ActiveBorderConfigModule::requestShortcutRevert()
{
    runShortcutRevert();
}

void ActiveBorderConfigModule::requestShortcutRestore()
{
    runShortcutRevert();
}

void ActiveBorderConfigModule::runShortcutApply()
{
    if (!confirmShortcutAction(QStringLiteral("Apply Shortcuts"),
                               QStringLiteral("Assign focus-right to Meta+L and move Lock Session to Meta+Esc; assign "
                                              "resize-outwards-up to Meta+Alt+K clearing Switch to Next Keyboard "
                                              "Layout; assign resize-outwards-right to Meta+Alt+L clearing Switch to "
                                              "Last-Used Keyboard Layout?"))) {
        return;
    }
    if (m_shortcutStore == nullptr || m_shortcutJournal == nullptr) {
        m_shortcutError = QStringLiteral("reconciler is not configured");
        updateShortcutPresentation(false);
        return;
    }
    ShortcutReconciler reconciler(m_shortcutStore, m_shortcutJournal);
    const ShortcutApplyResult result = reconciler.apply();
    if (result.ok) {
        m_shortcutError.clear();
    } else {
        m_shortcutError = result.error.isEmpty() ? QStringLiteral("Apply failed") : result.error;
    }
    refreshShortcutState();
}

void ActiveBorderConfigModule::runShortcutRevert()
{
    if (!confirmShortcutAction(QStringLiteral("Revert Shortcuts"),
                               QStringLiteral("Restore the recorded 3-row bindings (focus-right/Lock Session, "
                                              "resize-outwards-up/Switch to Next, resize-outwards-right/Switch to "
                                              "Last-Used)? Externally edited bindings stay untouched."))) {
        return;
    }
    if (m_shortcutStore == nullptr || m_shortcutJournal == nullptr) {
        m_shortcutError = QStringLiteral("reconciler is not configured");
        updateShortcutPresentation(false);
        return;
    }
    ShortcutReconciler reconciler(m_shortcutStore, m_shortcutJournal);
    const ShortcutRevertResult result = reconciler.revert();
    if (result.ok && result.untouched.isEmpty()) {
        m_shortcutError.clear();
    } else if (!result.untouched.isEmpty()) {
        QString message = result.error.isEmpty() ? QStringLiteral("external edits left untouched") : result.error;
        message += QStringLiteral(" Untouched: ") + result.untouched.join(QStringLiteral(", "));
        m_shortcutError = message;
    } else {
        m_shortcutError = result.error.isEmpty() ? QStringLiteral("Revert failed") : result.error;
    }
    refreshShortcutState();
}

void ActiveBorderConfigModule::updateShortcutPresentation(bool interrupted)
{
    if (m_ui.shortcutStatusLabel != nullptr) {
        m_ui.shortcutStatusLabel->setText(m_shortcutStatus);
    }
    if (m_ui.shortcutErrorLabel != nullptr) {
        m_ui.shortcutErrorLabel->setText(m_shortcutError);
    }
    if (m_ui.shortcutFinishApplyButton != nullptr) {
        m_ui.shortcutFinishApplyButton->setVisible(interrupted);
    }
    if (m_ui.shortcutRestoreButton != nullptr) {
        m_ui.shortcutRestoreButton->setVisible(interrupted);
    }
}

void ActiveBorderConfigModule::refreshShortcutState()
{
    bool interrupted = false;
    if (m_shortcutStore == nullptr || m_shortcutJournal == nullptr) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: reconciler is not configured.");
        updateShortcutPresentation(false);
        return;
    }
    QString error;
    const bool haveJournal = m_shortcutJournal->hasJournal();
    ShortcutJournal journal;
    bool journalValid = false;
    if (haveJournal) {
        if (!m_shortcutJournal->load(&journal, &error)) {
            m_shortcutStatus = QStringLiteral("Shortcut state unavailable: %1").arg(error);
            updateShortcutPresentation(false);
            return;
        }
        journalValid = true;
    }
    if (!m_shortcutStore->checkSetterContract(&error)) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: %1").arg(error);
        updateShortcutPresentation(false);
        return;
    }
    QString owner;
    uint uid = 0;
    if (!m_shortcutStore->currentOwner(&owner, &uid, &error)) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: %1").arg(error);
        updateShortcutPresentation(false);
        return;
    }
    QList<ShortcutTuple> tuples;
    if (!m_shortcutStore->readAll(&tuples, &error)) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: %1").arg(error);
        updateShortcutPresentation(false);
        return;
    }
    const ShortcutTuple *focusCurrent = nullptr;
    const ShortcutTuple *lockCurrent = nullptr;
    const ShortcutTuple *upCurrent = nullptr;
    const ShortcutTuple *nextCurrent = nullptr;
    const ShortcutTuple *rightCurrent = nullptr;
    const ShortcutTuple *lastCurrent = nullptr;
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
        } else if (tuple.component == shortcutSwitchNextComponent() && tuple.action == shortcutSwitchNextAction()) {
            ++matches[3];
            nextCurrent = &tuple;
        } else if (tuple.component == shortcutResizeRightComponent() && tuple.action == shortcutResizeRightAction()) {
            ++matches[4];
            rightCurrent = &tuple;
        } else if (tuple.component == shortcutSwitchLastComponent() && tuple.action == shortcutSwitchLastAction()) {
            ++matches[5];
            lastCurrent = &tuple;
        }
    }
    if (matches[0] != 1 || matches[1] != 1 || matches[2] != 1 || matches[3] != 1 || matches[4] != 1 || matches[5] != 1
        || focusCurrent == nullptr || lockCurrent == nullptr || upCurrent == nullptr || nextCurrent == nullptr
        || rightCurrent == nullptr || lastCurrent == nullptr) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: allowlisted bindings are missing.");
        updateShortcutPresentation(false);
        return;
    }
    for (const ShortcutTuple &tuple : tuples) {
        if (ShortcutReconciler::isAllowlisted(tuple.component, tuple.action)) {
            continue;
        }
        if (!ShortcutReconciler::keysValid(tuple.active)) {
            m_shortcutStatus = QStringLiteral("Shortcut state unavailable: unrelated tuple is unbounded.");
            updateShortcutPresentation(false);
            return;
        }
    }
    // Authoritative keyed foreign-occupancy gate for Meta+L, Meta+Esc,
    // Meta+Alt+K, and Meta+Alt+L, never tuple enumeration. Typed outcome
    // keeps Conflict vs unavailable semantics without substring matching.
    // The explicit System Monitor `_launch` Meta+Esc holder is user-authorized.
    {
        const KeyedOccupancyResult keyed = ShortcutReconciler::checkKeyedForeignOccupancyDetailed(m_shortcutStore);
        if (keyed.status != KeyedOccupancy::Clear) {
            if (keyed.status == KeyedOccupancy::Conflict) {
                m_shortcutStatus = QStringLiteral("Conflict: %1. Apply is refused.").arg(keyed.detail);
            } else {
                m_shortcutStatus = QStringLiteral("Shortcut state unavailable: %1").arg(keyed.detail);
            }
            updateShortcutPresentation(false);
            return;
        }
    }
    if (journalValid
        && (journal.phase == shortcutJournalPhasePending() || journal.phase == shortcutJournalPhaseFocusApplied())) {
        interrupted = true;
        m_shortcutStatus = QStringLiteral("Interrupted apply found (phase %1). Finish Apply or Restore.").arg(journal.phase);
        updateShortcutPresentation(interrupted);
        return;
    }
    const QList<int> focusPost = ShortcutReconciler::focusPostKeys();
    if (journalValid && journal.phase == shortcutJournalPhaseComplete()) {
        if (focusCurrent->active == journal.focus.post && lockCurrent->active == journal.lock.post
            && upCurrent->active == journal.resizeUp.post && nextCurrent->active == journal.switchNext.post
            && rightCurrent->active == journal.resizeRight.post && lastCurrent->active == journal.switchLast.post) {
            m_shortcutStatus = QStringLiteral("Shortcuts applied (journal complete, 3 rows).");
        } else {
            m_shortcutStatus = QStringLiteral("Shortcuts drifted after apply-complete; live bindings differ from the recorded post image.");
        }
        updateShortcutPresentation(false);
        return;
    }
    const bool focusAtPost = focusCurrent->active == focusPost;
    const bool lockHasMetaL = lockCurrent->active.contains(SHORTCUT_META_L);
    const bool lockHasMetaEsc = lockCurrent->active.contains(SHORTCUT_META_ESC);
    const bool upAtPost = upCurrent->active == ShortcutReconciler::resizeUpPostKeys();
    const bool nextClear = nextCurrent->active.isEmpty();
    const bool rightAtPost = rightCurrent->active == ShortcutReconciler::resizeRightPostKeys();
    const bool lastClear = lastCurrent->active.isEmpty();
    const bool nextAtPre = nextCurrent->active == ShortcutReconciler::switchNextExpectedPre();
    const bool lastAtPre = lastCurrent->active == ShortcutReconciler::switchLastExpectedPre();
    if (focusAtPost && !lockHasMetaL && lockHasMetaEsc && upAtPost && nextClear && rightAtPost && lastClear) {
        m_shortcutStatus = QStringLiteral("Shortcuts applied (3 rows): focus-right owns Meta+L, Lock Session owns "
                                          "Meta+Esc, resize-outwards-up owns Meta+Alt+K, Switch to Next cleared, "
                                          "resize-outwards-right owns Meta+Alt+L, Switch to Last-Used cleared.");
        updateShortcutPresentation(false);
        return;
    }
    if (!focusAtPost && lockHasMetaL && nextAtPre && lastAtPre) {
        m_shortcutStatus = QStringLiteral("Ready (3 rows): Apply will assign focus-right to Meta+L and move Lock "
                                          "Session to Meta+Esc; assign resize-outwards-up to Meta+Alt+K clearing "
                                          "Switch to Next; assign resize-outwards-right to Meta+Alt+L clearing Switch "
                                          "to Last-Used.");
        updateShortcutPresentation(false);
        return;
    }
    m_shortcutStatus = QStringLiteral("Shortcuts differ from the allowed image.");
    updateShortcutPresentation(false);
}

QVariantMap ActiveBorderConfigModule::currentScriptValues() const
{
    return {
        {QStringLiteral("tilingAlgorithm"), m_ui.tilingAlgorithmCombo->currentData()},
        {QStringLiteral("automaticSplitTarget"), m_ui.automaticSplitTargetCombo->currentData()},
        {QStringLiteral("workspaceMode"), m_ui.workspaceModeCombo->currentData()},
        {QStringLiteral("shortcutProfile"), m_ui.shortcutProfileCombo->currentData()},
        {QStringLiteral("dropOutlinePreview"), m_ui.dropOutlinePreviewCheckBox->isChecked()},
        {QStringLiteral("innerGap"), m_ui.innerGapSpinBox->value()},
        {QStringLiteral("outerGap"), m_ui.outerGapSpinBox->value()},
    };
}

void ActiveBorderConfigModule::updateScriptState()
{
    const QVariantMap current = currentScriptValues();
    const QVariantMap defaults = {
        {QStringLiteral("tilingAlgorithm"), QStringLiteral("dwindle")},
        {QStringLiteral("automaticSplitTarget"), QStringLiteral("dwindle")},
        {QStringLiteral("workspaceMode"), QStringLiteral("per-output-local")},
        {QStringLiteral("shortcutProfile"), QStringLiteral("cosmic")},
        {QStringLiteral("dropOutlinePreview"), false},
        {QStringLiteral("innerGap"), 8},
        {QStringLiteral("outerGap"), 8},
    };
    unmanagedWidgetChangeState(!m_loadedScriptValues.isEmpty() && current != m_loadedScriptValues);
    unmanagedWidgetDefaultState(current == defaults);
}

void ActiveBorderConfigModule::load()
{
    KCModule::load();

    const KConfigGroup group(KSharedConfig::openConfig(QStringLiteral("kwinrc")), QStringLiteral("Script-plasma-auto-tiler-kwin"));
    const auto select = [](QComboBox *combo, const QString &value, const QString &fallback) {
        const int index = combo->findData(value);
        const int fallbackIndex = combo->findData(fallback);
        combo->setCurrentIndex(index >= 0 ? index : fallbackIndex);
    };
    const QString tilingAlgorithm = group.readEntry(QStringLiteral("tilingAlgorithm"), QStringLiteral("dwindle"));
    const QString automaticSplitTarget = group.readEntry(QStringLiteral("automaticSplitTarget"), QStringLiteral("dwindle"));
    const QString workspaceMode = group.readEntry(QStringLiteral("workspaceMode"), QStringLiteral("per-output-local"));
    const QString shortcutProfile = group.readEntry(QStringLiteral("shortcutProfile"), QStringLiteral("cosmic"));
    const QString dropOutlinePreviewRaw = group.readEntry(QStringLiteral("dropOutlinePreview"), QString());
    m_loadedDropOutlinePreviewRawValid = !group.hasKey(QStringLiteral("dropOutlinePreview"))
        || dropOutlinePreviewRaw.compare(QStringLiteral("true"), Qt::CaseInsensitive) == 0
        || dropOutlinePreviewRaw.compare(QStringLiteral("false"), Qt::CaseInsensitive) == 0;
    const int innerGap = readBoundedGap(group, QStringLiteral("innerGap"));
    const int outerGap = readBoundedGap(group, QStringLiteral("outerGap"));
    m_loadedInnerGapRawValid = isBoundedGapRawValid(group, QStringLiteral("innerGap"));
    m_loadedOuterGapRawValid = isBoundedGapRawValid(group, QStringLiteral("outerGap"));
    select(m_ui.tilingAlgorithmCombo, tilingAlgorithm, QStringLiteral("dwindle"));
    select(m_ui.automaticSplitTargetCombo, automaticSplitTarget, QStringLiteral("dwindle"));
    select(m_ui.workspaceModeCombo, workspaceMode, QStringLiteral("per-output-local"));
    select(m_ui.shortcutProfileCombo, shortcutProfile, QStringLiteral("cosmic"));
    m_ui.dropOutlinePreviewCheckBox->setChecked(group.readEntry(QStringLiteral("dropOutlinePreview"), false));
    m_ui.innerGapSpinBox->setValue(innerGap);
    m_ui.outerGapSpinBox->setValue(outerGap);
    m_loadedScriptValues = {
        {QStringLiteral("tilingAlgorithm"), tilingAlgorithm},
        {QStringLiteral("automaticSplitTarget"), automaticSplitTarget},
        {QStringLiteral("workspaceMode"), workspaceMode},
        {QStringLiteral("shortcutProfile"), shortcutProfile},
        {QStringLiteral("dropOutlinePreview"), m_ui.dropOutlinePreviewCheckBox->isChecked()},
        {QStringLiteral("innerGap"), innerGap},
        {QStringLiteral("outerGap"), outerGap},
    };
    updateScriptState();
    refreshShortcutState();
    m_tilerReloadRequired = false;
    m_tilerRestartRequired = false;
    m_tilerReloadStatus = QStringLiteral("No pending tiler reload in this dialog.");
    updateTilerReloadPresentation();
}

void ActiveBorderConfigModule::save()
{
    const bool borderChanged = managedWidgetChangeState();
    KCModule::save();

    const QVariantMap current = currentScriptValues();
    if (!m_loadedDropOutlinePreviewRawValid || !m_loadedInnerGapRawValid || !m_loadedOuterGapRawValid || current != m_loadedScriptValues) {
        const bool gapChanged = !m_loadedInnerGapRawValid || !m_loadedOuterGapRawValid
            || current.value(QStringLiteral("innerGap")) != m_loadedScriptValues.value(QStringLiteral("innerGap"))
            || current.value(QStringLiteral("outerGap")) != m_loadedScriptValues.value(QStringLiteral("outerGap"));
        const bool startupSettingChanged = !m_loadedDropOutlinePreviewRawValid
            || current.value(QStringLiteral("tilingAlgorithm")) != m_loadedScriptValues.value(QStringLiteral("tilingAlgorithm"))
            || current.value(QStringLiteral("automaticSplitTarget")) != m_loadedScriptValues.value(QStringLiteral("automaticSplitTarget"))
            || current.value(QStringLiteral("workspaceMode")) != m_loadedScriptValues.value(QStringLiteral("workspaceMode"))
            || current.value(QStringLiteral("shortcutProfile")) != m_loadedScriptValues.value(QStringLiteral("shortcutProfile"))
            || current.value(QStringLiteral("dropOutlinePreview")) != m_loadedScriptValues.value(QStringLiteral("dropOutlinePreview"));
        KConfigGroup group(KSharedConfig::openConfig(QStringLiteral("kwinrc")), QStringLiteral("Script-plasma-auto-tiler-kwin"));
        if (current.value(QStringLiteral("tilingAlgorithm")) != m_loadedScriptValues.value(QStringLiteral("tilingAlgorithm"))) {
            group.writeEntry(QStringLiteral("tilingAlgorithm"), current.value(QStringLiteral("tilingAlgorithm")).toString());
        }
        if (current.value(QStringLiteral("automaticSplitTarget")) != m_loadedScriptValues.value(QStringLiteral("automaticSplitTarget"))) {
            group.writeEntry(QStringLiteral("automaticSplitTarget"), current.value(QStringLiteral("automaticSplitTarget")).toString());
        }
        if (current.value(QStringLiteral("workspaceMode")) != m_loadedScriptValues.value(QStringLiteral("workspaceMode"))) {
            group.writeEntry(QStringLiteral("workspaceMode"), current.value(QStringLiteral("workspaceMode")).toString());
        }
        if (current.value(QStringLiteral("shortcutProfile")) != m_loadedScriptValues.value(QStringLiteral("shortcutProfile"))) {
            group.writeEntry(QStringLiteral("shortcutProfile"), current.value(QStringLiteral("shortcutProfile")).toString());
        }
        if (!m_loadedDropOutlinePreviewRawValid || current.value(QStringLiteral("dropOutlinePreview")) != m_loadedScriptValues.value(QStringLiteral("dropOutlinePreview"))) {
            group.writeEntry(QStringLiteral("dropOutlinePreview"), current.value(QStringLiteral("dropOutlinePreview")).toBool());
        }
        if (!m_loadedInnerGapRawValid || current.value(QStringLiteral("innerGap")) != m_loadedScriptValues.value(QStringLiteral("innerGap"))) {
            group.writeEntry(QStringLiteral("innerGap"), current.value(QStringLiteral("innerGap")).toInt());
        }
        if (!m_loadedOuterGapRawValid || current.value(QStringLiteral("outerGap")) != m_loadedScriptValues.value(QStringLiteral("outerGap"))) {
            group.writeEntry(QStringLiteral("outerGap"), current.value(QStringLiteral("outerGap")).toInt());
        }
        group.sync();
        m_loadedScriptValues = current;
        m_loadedDropOutlinePreviewRawValid = true;
        m_loadedInnerGapRawValid = true;
        m_loadedOuterGapRawValid = true;
        if (gapChanged) {
            m_tilerReloadRequired = true;
        }
        if (startupSettingChanged) {
            m_tilerRestartRequired = true;
        }
        if (m_tilerReloadRequired && m_tilerRestartRequired) {
            m_tilerReloadStatus = QStringLiteral(
                "Tiling gaps and startup settings saved. Reload applies gaps only; session restart remains required "
                "for other settings.");
        } else if (m_tilerReloadRequired) {
            m_tilerReloadStatus = QStringLiteral(
                "Tiling gaps saved. Reload required: the running tiler still uses startup gap values.");
        } else if (m_tilerRestartRequired) {
            m_tilerReloadStatus = QStringLiteral(
                "Startup setting saved. Session restart required: the running tiler still uses startup values.");
        }
    }
    updateScriptState();
    updateTilerReloadPresentation();

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
    // Border hot-apply stays live through the native effect reconfigure. The
    // running controller re-reads only validated gaps on the KWin Options
    // configChanged signal emitted by the deliberate reconfigure; non-gap
    // startup settings (tilingAlgorithm, automaticSplitTarget, workspaceMode,
    // shortcutProfile, dropOutlinePreview) remain startup-only, and KWin's
    // reconfigure is Q_NOREPLY, so save() never auto-sends a tiler reload and
    // never claims the running tiler applied saved values. The deliberate
    // Reload Tiler button sends one typed reconfigure request for gaps and
    // reports sent-but-unconfirmed or failed.
}

void ActiveBorderConfigModule::defaults()
{
    KCModule::defaults();

    m_ui.tilingAlgorithmCombo->setCurrentIndex(m_ui.tilingAlgorithmCombo->findData(QStringLiteral("dwindle")));
    m_ui.automaticSplitTargetCombo->setCurrentIndex(m_ui.automaticSplitTargetCombo->findData(QStringLiteral("dwindle")));
    m_ui.workspaceModeCombo->setCurrentIndex(m_ui.workspaceModeCombo->findData(QStringLiteral("per-output-local")));
    m_ui.shortcutProfileCombo->setCurrentIndex(m_ui.shortcutProfileCombo->findData(QStringLiteral("cosmic")));
    m_ui.dropOutlinePreviewCheckBox->setChecked(false);
    m_ui.innerGapSpinBox->setValue(8);
    m_ui.outerGapSpinBox->setValue(8);
    updateScriptState();
}

} // namespace KWin

#include "activeborderconfig_module.moc"
