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

K_PLUGIN_CLASS_WITH_JSON(KWin::ActiveBorderConfigModule, "activeborderconfig_module.json")

namespace KWin
{

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

    m_shortcutStore = createLiveShortcutStore();
    m_shortcutJournal = createLiveShortcutJournal(defaultShortcutJournalPath());
    m_ownsShortcutStores = true;
    connect(m_ui.shortcutApplyButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutApply);
    connect(m_ui.shortcutRevertButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutRevert);
    connect(m_ui.shortcutFinishApplyButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutFinishApply);
    connect(m_ui.shortcutRestoreButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutRestore);
    refreshShortcutState();
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
                               QStringLiteral("Assign focus-right to Meta+L and move Lock Session to Meta+Esc?"))) {
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
                               QStringLiteral("Restore the recorded Lock Session and focus-right bindings? Externally edited bindings stay untouched."))) {
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
    int focusMatches = 0;
    int lockMatches = 0;
    for (const ShortcutTuple &tuple : tuples) {
        if (tuple.component == shortcutFocusComponent() && tuple.action == shortcutFocusAction()) {
            ++focusMatches;
            focusCurrent = &tuple;
        }
        if (tuple.component == shortcutLockComponent() && tuple.action == shortcutLockAction()) {
            ++lockMatches;
            lockCurrent = &tuple;
        }
    }
    if (focusMatches != 1 || lockMatches != 1 || focusCurrent == nullptr || lockCurrent == nullptr) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: allowlisted bindings are missing.");
        updateShortcutPresentation(false);
        return;
    }
    for (const ShortcutTuple &tuple : tuples) {
        if (ShortcutReconciler::isAllowlisted(tuple.component, tuple.action)) {
            continue;
        }
        if (tuple.active.contains(SHORTCUT_META_ESC)) {
            m_shortcutStatus = QStringLiteral("Conflict: Meta+Esc is claimed by %1/%2. Apply is refused.").arg(tuple.component, tuple.action);
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
    // A valid complete journal is authoritative: report applied only when
    // both exact live tuple lists equal the journal postimages.
    if (journalValid && journal.phase == shortcutJournalPhaseComplete()) {
        if (focusCurrent->active == journal.focus.post && lockCurrent->active == journal.lock.post) {
            m_shortcutStatus = QStringLiteral("Shortcuts applied (journal complete).");
        } else {
            m_shortcutStatus = QStringLiteral("Shortcuts drifted after apply-complete; live bindings differ from the recorded post image.");
        }
        updateShortcutPresentation(false);
        return;
    }
    const bool focusAtPost = focusCurrent->active == focusPost;
    const bool lockHasMetaL = lockCurrent->active.contains(SHORTCUT_META_L);
    const bool lockHasMetaEsc = lockCurrent->active.contains(SHORTCUT_META_ESC);
    if (focusAtPost && !lockHasMetaL && lockHasMetaEsc) {
        m_shortcutStatus = QStringLiteral("Shortcuts applied: focus-right owns Meta+L, Lock Session owns Meta+Esc.");
        updateShortcutPresentation(false);
        return;
    }
    if (!focusAtPost && lockHasMetaL) {
        m_shortcutStatus = QStringLiteral("Ready: Apply will assign focus-right to Meta+L and move Lock Session to Meta+Esc.");
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
    select(m_ui.tilingAlgorithmCombo, tilingAlgorithm, QStringLiteral("dwindle"));
    select(m_ui.automaticSplitTargetCombo, automaticSplitTarget, QStringLiteral("dwindle"));
    select(m_ui.workspaceModeCombo, workspaceMode, QStringLiteral("per-output-local"));
    select(m_ui.shortcutProfileCombo, shortcutProfile, QStringLiteral("cosmic"));
    m_ui.dropOutlinePreviewCheckBox->setChecked(group.readEntry(QStringLiteral("dropOutlinePreview"), false));
    m_loadedScriptValues = {
        {QStringLiteral("tilingAlgorithm"), tilingAlgorithm},
        {QStringLiteral("automaticSplitTarget"), automaticSplitTarget},
        {QStringLiteral("workspaceMode"), workspaceMode},
        {QStringLiteral("shortcutProfile"), shortcutProfile},
        {QStringLiteral("dropOutlinePreview"), m_ui.dropOutlinePreviewCheckBox->isChecked()},
    };
    updateScriptState();
    refreshShortcutState();
}

void ActiveBorderConfigModule::save()
{
    const bool borderChanged = managedWidgetChangeState();
    KCModule::save();

    const QVariantMap current = currentScriptValues();
    if (!m_loadedDropOutlinePreviewRawValid || current != m_loadedScriptValues) {
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
        group.sync();
        m_loadedScriptValues = current;
        m_loadedDropOutlinePreviewRawValid = true;
    }
    updateScriptState();

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
}

void ActiveBorderConfigModule::defaults()
{
    KCModule::defaults();

    m_ui.tilingAlgorithmCombo->setCurrentIndex(m_ui.tilingAlgorithmCombo->findData(QStringLiteral("dwindle")));
    m_ui.automaticSplitTargetCombo->setCurrentIndex(m_ui.automaticSplitTargetCombo->findData(QStringLiteral("dwindle")));
    m_ui.workspaceModeCombo->setCurrentIndex(m_ui.workspaceModeCombo->findData(QStringLiteral("per-output-local")));
    m_ui.shortcutProfileCombo->setCurrentIndex(m_ui.shortcutProfileCombo->findData(QStringLiteral("cosmic")));
    m_ui.dropOutlinePreviewCheckBox->setChecked(false);
    updateScriptState();
}

} // namespace KWin

#include "activeborderconfig_module.moc"
