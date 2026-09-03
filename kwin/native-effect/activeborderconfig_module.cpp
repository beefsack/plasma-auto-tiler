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
