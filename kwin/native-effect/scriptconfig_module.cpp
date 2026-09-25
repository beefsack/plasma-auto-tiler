#include "scriptconfig_module.h"

#include <KConfigGroup>
#include <KLocalizedString>
#include <KPluginFactory>
#include <KSharedConfig>
#include <QLoggingCategory>

#include <QComboBox>
#include <QDBusConnection>
#include <QDBusInterface>
#include <QDBusMessage>
#include <QSpinBox>

Q_LOGGING_CATEGORY(lcScriptConfig, "plasmaautotiler.script-config", QtInfoMsg)

K_PLUGIN_CLASS_WITH_JSON(KWin::ScriptConfigModule, "scriptconfig_module.json")

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

} // namespace

ScriptConfigModule::ScriptConfigModule(QObject *parent, const KPluginMetaData &data)
    : KCModule(parent, data)
{
    m_ui.setupUi(widget());

    m_ui.workspaceModeCombo->addItem(i18n("Per output, local"), QStringLiteral("per-output-local"));
    m_ui.workspaceModeCombo->addItem(i18n("Global, unique"), QStringLiteral("global-unique"));
    m_ui.workspaceModeCombo->addItem(i18n("Shared"), QStringLiteral("shared"));

    connect(m_ui.workspaceModeCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this,
            &ScriptConfigModule::updateScriptState);
    connect(m_ui.innerGapSpinBox, QOverload<int>::of(&QSpinBox::valueChanged), this,
            &ScriptConfigModule::updateScriptState);
    connect(m_ui.outerGapSpinBox, QOverload<int>::of(&QSpinBox::valueChanged), this,
            &ScriptConfigModule::updateScriptState);

    m_scriptRestartRequired = false;
    m_scriptStatus = QStringLiteral("No pending script setting in this dialog.");
    if (m_ui.scriptStatusLabel != nullptr) {
        m_ui.scriptStatusLabel->setText(m_scriptStatus);
    }
}

QString ScriptConfigModule::scriptService()
{
    return QStringLiteral("org.kde.KWin");
}

QString ScriptConfigModule::scriptPath()
{
    return QStringLiteral("/KWin");
}

QString ScriptConfigModule::scriptInterface()
{
    return QStringLiteral("org.kde.KWin");
}

QString ScriptConfigModule::scriptMethod()
{
    return QStringLiteral("reconfigure");
}

bool ScriptConfigModule::requestScriptReconfigure()
{
    QDBusInterface interface(scriptService(), scriptPath(), scriptInterface(), QDBusConnection::sessionBus());
    if (!interface.isValid()) {
        return false;
    }
    return QDBusConnection::sessionBus().send(
        QDBusMessage::createMethodCall(scriptService(), scriptPath(), scriptInterface(), scriptMethod()));
}

QString ScriptConfigModule::scriptStatusText() const
{
    return m_scriptStatus;
}

bool ScriptConfigModule::isScriptRestartRequired() const
{
    return m_scriptRestartRequired;
}

bool ScriptConfigModule::isGapReconfigurePending() const
{
    return m_gapReconfigurePending;
}

QVariantMap ScriptConfigModule::currentScriptValues() const
{
    return {
        {QStringLiteral("workspaceMode"), m_ui.workspaceModeCombo->currentData()},
        {QStringLiteral("innerGap"), m_ui.innerGapSpinBox->value()},
        {QStringLiteral("outerGap"), m_ui.outerGapSpinBox->value()},
    };
}

void ScriptConfigModule::updateScriptState()
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

void ScriptConfigModule::load()
{
    KCModule::load();

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
    m_scriptStatus = QStringLiteral("No pending script setting in this dialog.");
    if (m_ui.scriptStatusLabel != nullptr) {
        m_ui.scriptStatusLabel->setText(m_scriptStatus);
    }
}

void ScriptConfigModule::save()
{
    KCModule::save();

    const QVariantMap current = currentScriptValues();
    const bool widgetsChanged =
        !m_loadedInnerGapRawValid || !m_loadedOuterGapRawValid || current != m_loadedScriptValues;
    if (!widgetsChanged && !m_gapReconfigurePending) {
        updateScriptState();
        return;
    }
    const bool gapChanged = !m_loadedInnerGapRawValid || !m_loadedOuterGapRawValid
        || current.value(QStringLiteral("innerGap")) != m_loadedScriptValues.value(QStringLiteral("innerGap"))
        || current.value(QStringLiteral("outerGap")) != m_loadedScriptValues.value(QStringLiteral("outerGap"));
    // Per-key startup changes are captured before persistence refreshes the
    // loaded snapshot; comparing afterwards would always match and the
    // restart-required log must enumerate only the keys that changed.
    const bool workspaceModeChanged = current.value(QStringLiteral("workspaceMode"))
        != m_loadedScriptValues.value(QStringLiteral("workspaceMode"));
    const bool startupConsumedChanged = workspaceModeChanged;
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
    if (gapChanged || m_gapReconfigurePending) {
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

void ScriptConfigModule::defaults()
{
    KCModule::defaults();

    m_ui.workspaceModeCombo->setCurrentIndex(m_ui.workspaceModeCombo->findData(QStringLiteral("per-output-local")));
    m_ui.innerGapSpinBox->setValue(kGapDefault);
    m_ui.outerGapSpinBox->setValue(kGapDefault);
    updateScriptState();
}

} // namespace KWin

#include "scriptconfig_module.moc"
