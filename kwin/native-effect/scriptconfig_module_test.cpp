#include "scriptconfig_module.h"

#include <KConfigGroup>
#include <KPluginMetaData>
#include <KSharedConfig>

#include <QApplication>
#include <QClipboard>
#include <QComboBox>
#include <QLabel>
#include <QMessageLogContext>
#include <QMimeData>
#include <QSpinBox>
#include <QStringList>
#include <QTemporaryDir>

#include <cstdio>
#include <cstdlib>

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

KConfigGroup scriptGroup()
{
    return KConfigGroup(KSharedConfig::openConfig(QStringLiteral("kwinrc")), QStringLiteral("Script-plasma-auto-tiler-kwin"));
}

QComboBox *workspaceModeCombo(KWin::ScriptConfigModule &module)
{
    return module.widget()->findChild<QComboBox *>(QStringLiteral("workspaceModeCombo"));
}

QComboBox *shortcutProfileCombo(KWin::ScriptConfigModule &module)
{
    return module.widget()->findChild<QComboBox *>(QStringLiteral("shortcutProfileCombo"));
}

QSpinBox *innerGapSpinBox(KWin::ScriptConfigModule &module)
{
    return module.widget()->findChild<QSpinBox *>(QStringLiteral("innerGapSpinBox"));
}

QSpinBox *outerGapSpinBox(KWin::ScriptConfigModule &module)
{
    return module.widget()->findChild<QSpinBox *>(QStringLiteral("outerGapSpinBox"));
}

QLabel *scriptStatusLabel(KWin::ScriptConfigModule &module)
{
    return module.widget()->findChild<QLabel *>(QStringLiteral("scriptStatusLabel"));
}

QString storedWorkspaceMode()
{
    return scriptGroup().readEntry(QStringLiteral("workspaceMode"), QStringLiteral("per-output-local"));
}

QString storedShortcutProfile()
{
    return scriptGroup().readEntry(QStringLiteral("shortcutProfile"), QStringLiteral("cosmic"));
}

QString otherWorkspaceMode(const QString &current)
{
    const QStringList candidates = {
        QStringLiteral("per-output-local"),
        QStringLiteral("global-unique"),
        QStringLiteral("shared"),
    };
    for (const QString &candidate : candidates) {
        if (candidate != current) {
            return candidate;
        }
    }
    return QStringLiteral("shared");
}

bool containsRestartRequirement(const QString &text)
{
    return text.contains(QStringLiteral("Session restart required"))
        || text.contains(QStringLiteral("session restart remains required"))
        || text.contains(QStringLiteral("Session restart remains required"));
}

bool containsAppliedClaim(const QString &text)
{
    return text.toLower().contains(QStringLiteral("applied"));
}

void scriptReconfigureTargetIsExact()
{
    CHECK(KWin::ScriptConfigModule::scriptService() == QStringLiteral("org.kde.KWin"));
    CHECK(KWin::ScriptConfigModule::scriptPath() == QStringLiteral("/KWin"));
    CHECK(KWin::ScriptConfigModule::scriptInterface() == QStringLiteral("org.kde.KWin"));
    CHECK(KWin::ScriptConfigModule::scriptMethod() == QStringLiteral("reconfigure"));
}

class CountingScriptModule : public KWin::ScriptConfigModule
{
public:
    using KWin::ScriptConfigModule::ScriptConfigModule;
    bool requestScriptReconfigure() override
    {
        ++scriptCalls;
        return scriptSucceed;
    }
    int scriptCalls = 0;
    bool scriptSucceed = false;
};

void gapContractNormalizesBoundsAndPersists()
{
    {
        KConfigGroup group = scriptGroup();
        group.writeEntry(QStringLiteral("innerGap"), QStringLiteral("not-a-number"));
        group.writeEntry(QStringLiteral("outerGap"), QStringLiteral("-5"));
        group.sync();
    }

    {
        CountingScriptModule module(nullptr, KPluginMetaData());
        QSpinBox *inner = innerGapSpinBox(module);
        QSpinBox *outer = outerGapSpinBox(module);
        CHECK(inner != nullptr);
        CHECK(outer != nullptr);
        module.load();
        if (inner) {
            CHECK(inner->value() == 8);
        }
        if (outer) {
            CHECK(outer->value() == 8);
        }
        module.scriptSucceed = true;
        module.save();
        CHECK(scriptGroup().readEntry(QStringLiteral("innerGap"), -1) == 8);
        CHECK(scriptGroup().readEntry(QStringLiteral("outerGap"), -1) == 8);
    }

    {
        KConfigGroup group = scriptGroup();
        group.writeEntry(QStringLiteral("innerGap"), QStringLiteral("0"));
        group.writeEntry(QStringLiteral("outerGap"), QStringLiteral("64"));
        group.sync();
    }

    {
        CountingScriptModule module(nullptr, KPluginMetaData());
        QSpinBox *inner = innerGapSpinBox(module);
        QSpinBox *outer = outerGapSpinBox(module);
        CHECK(inner != nullptr);
        CHECK(outer != nullptr);
        module.load();
        if (inner) {
            CHECK(inner->value() == 0);
        }
        if (outer) {
            CHECK(outer->value() == 64);
        }
        if (!inner || !outer) {
            return;
        }
        module.scriptSucceed = true;
        inner->setValue(64);
        outer->setValue(0);
        module.save();
        CHECK(scriptGroup().readEntry(QStringLiteral("innerGap"), -1) == 64);
        CHECK(scriptGroup().readEntry(QStringLiteral("outerGap"), -1) == 0);
        CHECK(module.scriptCalls == 1);
    }

    {
        KWin::ScriptConfigModule reloaded(nullptr, KPluginMetaData());
        reloaded.load();
        QSpinBox *inner = innerGapSpinBox(reloaded);
        QSpinBox *outer = outerGapSpinBox(reloaded);
        CHECK(inner != nullptr);
        CHECK(outer != nullptr);
        if (inner) {
            CHECK(inner->value() == 64);
        }
        if (outer) {
            CHECK(outer->value() == 0);
        }
    }

    {
        KConfigGroup group = scriptGroup();
        group.writeEntry(QStringLiteral("innerGap"), QStringLiteral("65"));
        group.writeEntry(QStringLiteral("outerGap"), QStringLiteral("100"));
        group.sync();
    }

    {
        KWin::ScriptConfigModule module(nullptr, KPluginMetaData());
        QSpinBox *inner = innerGapSpinBox(module);
        QSpinBox *outer = outerGapSpinBox(module);
        CHECK(inner != nullptr);
        CHECK(outer != nullptr);
        module.load();
        if (inner) {
            CHECK(inner->value() == 8);
        }
        if (outer) {
            CHECK(outer->value() == 8);
        }
    }

    {
        KConfigGroup group = scriptGroup();
        group.deleteEntry(QStringLiteral("innerGap"));
        group.deleteEntry(QStringLiteral("outerGap"));
        group.sync();
    }

    {
        CountingScriptModule module(nullptr, KPluginMetaData());
        QSpinBox *inner = innerGapSpinBox(module);
        QSpinBox *outer = outerGapSpinBox(module);
        CHECK(inner != nullptr);
        CHECK(outer != nullptr);
        module.load();
        if (inner) {
            CHECK(inner->value() == 8);
        }
        if (outer) {
            CHECK(outer->value() == 8);
        }
        if (!inner || !outer) {
            return;
        }
        module.scriptSucceed = true;
        module.save();
        CHECK(!scriptGroup().hasKey(QStringLiteral("innerGap")));
        CHECK(!scriptGroup().hasKey(QStringLiteral("outerGap")));
        CHECK(module.scriptCalls == 0);

        inner->setValue(12);
        outer->setValue(20);
        module.save();
        CHECK(scriptGroup().readEntry(QStringLiteral("innerGap"), -1) == 12);
        CHECK(scriptGroup().readEntry(QStringLiteral("outerGap"), -1) == 20);

        module.defaults();
        CHECK(inner->value() == 8);
        CHECK(outer->value() == 8);
        module.save();
        CHECK(scriptGroup().readEntry(QStringLiteral("innerGap"), -1) == 8);
        CHECK(scriptGroup().readEntry(QStringLiteral("outerGap"), -1) == 8);
    }
}

void unsupportedControlsAreAbsentAndLegacyValuesUntouched()
{
    KConfigGroup group = scriptGroup();
    group.writeEntry(QStringLiteral("tilingAlgorithm"), QStringLiteral("columns"));
    group.writeEntry(QStringLiteral("automaticSplitTarget"), QStringLiteral("active"));
    group.writeEntry(QStringLiteral("dropOutlinePreview"), true);
    group.sync();

    CountingScriptModule module(nullptr, KPluginMetaData());
    module.scriptSucceed = true;
    module.load();
    CHECK(module.widget()->findChild<QComboBox *>(QStringLiteral("tilingAlgorithmCombo")) == nullptr);
    CHECK(module.widget()->findChild<QComboBox *>(QStringLiteral("automaticSplitTargetCombo")) == nullptr);
    CHECK(module.widget()->findChild<QComboBox *>(QStringLiteral("dropOutlinePreviewCheckBox")) == nullptr);
    module.save();

    CHECK(group.readEntry(QStringLiteral("tilingAlgorithm"), QString()) == QStringLiteral("columns"));
    CHECK(group.readEntry(QStringLiteral("automaticSplitTarget"), QString()) == QStringLiteral("active"));
    CHECK(group.readEntry(QStringLiteral("dropOutlinePreview"), false));
}

void unchangedSaveSendsNothing()
{
    CountingScriptModule module(nullptr, KPluginMetaData());
    module.load();
    CHECK(!module.isScriptRestartRequired());
    CHECK(scriptStatusLabel(module) != nullptr);
    CHECK(module.scriptStatusText().contains(QStringLiteral("No pending")));
    CHECK(!containsAppliedClaim(module.scriptStatusText()));
    module.scriptSucceed = true;
    module.save();
    CHECK(!module.isScriptRestartRequired());
    CHECK(!module.isGapReconfigurePending());
    CHECK(module.scriptCalls == 0);
    CHECK(!module.needsSave());
    CHECK(module.scriptStatusText().contains(QStringLiteral("No pending")));
    CHECK(!containsAppliedClaim(module.scriptStatusText()));
}

void gapSavePersistsThenSendsUnconfirmed()
{
    CountingScriptModule module(nullptr, KPluginMetaData());
    module.load();
    QSpinBox *inner = innerGapSpinBox(module);
    CHECK(inner != nullptr);
    if (!inner) {
        return;
    }
    const int gapTarget = (inner->value() == 12) ? 20 : 12;
    inner->setValue(gapTarget);
    CHECK(module.needsSave());
    module.scriptSucceed = true;
    module.save();
    CHECK(scriptGroup().readEntry(QStringLiteral("innerGap"), -1) == gapTarget);
    CHECK(module.scriptCalls == 1);
    CHECK(!module.isGapReconfigurePending());
    CHECK(!module.isScriptRestartRequired());
    CHECK(module.scriptStatusText().contains(QStringLiteral("unconfirmed")));
    CHECK(!containsAppliedClaim(module.scriptStatusText()));
    CHECK(!module.needsSave());
    // A follow-up unchanged save must not send again.
    module.save();
    CHECK(module.scriptCalls == 1);
}

void gapSaveSendFailureArmsRetryOnNextSave()
{
    CountingScriptModule module(nullptr, KPluginMetaData());
    module.load();
    QSpinBox *inner = innerGapSpinBox(module);
    CHECK(inner != nullptr);
    if (!inner) {
        return;
    }
    const int gapTarget = (inner->value() == 12) ? 20 : 12;
    inner->setValue(gapTarget);
    module.scriptSucceed = false;
    module.save();
    CHECK(scriptGroup().readEntry(QStringLiteral("innerGap"), -1) == gapTarget);
    CHECK(module.scriptCalls == 1);
    CHECK(module.isGapReconfigurePending());
    CHECK(!module.isScriptRestartRequired());
    CHECK(module.scriptStatusText().contains(QStringLiteral("failed")));
    CHECK(module.scriptStatusText().contains(QStringLiteral("retry on the next save")));
    CHECK(module.scriptStatusText().contains(QStringLiteral("saved to kwinrc")));
    CHECK(!containsAppliedClaim(module.scriptStatusText()));
    // Apply stays enabled for the retry even though widgets match storage.
    CHECK(module.needsSave());
    // A still-failing retry persists nothing further and must not claim the
    // retry saved anything.
    module.save();
    CHECK(module.scriptCalls == 2);
    CHECK(module.isGapReconfigurePending());
    CHECK(module.scriptStatusText().contains(QStringLiteral("failed")));
    CHECK(module.scriptStatusText().contains(QStringLiteral("saved nothing")));
    CHECK(!module.scriptStatusText().contains(QStringLiteral("saved to kwinrc")));
    CHECK(!containsAppliedClaim(module.scriptStatusText()));
    CHECK(module.needsSave());
    // An unchanged follow-up save retries the request and clears the flag.
    module.scriptSucceed = true;
    module.save();
    CHECK(module.scriptCalls == 3);
    CHECK(!module.isGapReconfigurePending());
    CHECK(scriptGroup().readEntry(QStringLiteral("innerGap"), -1) == gapTarget);
    CHECK(module.scriptStatusText().contains(QStringLiteral("unconfirmed")));
    CHECK(module.scriptStatusText().contains(QStringLiteral("saved nothing")));
    CHECK(!module.scriptStatusText().contains(QStringLiteral("saved to kwinrc")));
    CHECK(!containsAppliedClaim(module.scriptStatusText()));
    CHECK(!module.needsSave());
}

void startupOnlySaveDisablesSendWithRestartMessage()
{
    CountingScriptModule module(nullptr, KPluginMetaData());
    module.load();
    QComboBox *mode = workspaceModeCombo(module);
    CHECK(mode != nullptr);
    if (!mode) {
        return;
    }
    const QString modeTarget = otherWorkspaceMode(storedWorkspaceMode());
    const int modeIndex = mode->findData(modeTarget);
    CHECK(modeIndex >= 0);
    mode->setCurrentIndex(modeIndex);
    CHECK(module.needsSave());
    module.scriptSucceed = true;
    module.save();
    CHECK(scriptGroup().readEntry(QStringLiteral("workspaceMode"), QString()) == modeTarget);
    CHECK(module.scriptCalls == 0);
    CHECK(module.isScriptRestartRequired());
    CHECK(module.scriptStatusText().contains(QStringLiteral("Workspace mode")));
    CHECK(!module.scriptStatusText().contains(QStringLiteral("startup settings")));
    CHECK(!containsAppliedClaim(module.scriptStatusText()));
    CHECK(!module.needsSave());
    // An unchanged follow-up save must not send and must keep the restart flag.
    module.save();
    CHECK(module.scriptCalls == 0);
    CHECK(module.isScriptRestartRequired());
}

void hiddenShortcutProfileIsAbsentAndPreservedUntouched()
{
    // The profile control is hidden until distinct profiles exist, but any
    // saved kwinrc value must survive every dialog operation untouched.
    const QStringList profiles = {
        QStringLiteral("cosmic"),
        QStringLiteral("hyprland"),
        QStringLiteral("bspwm"),
    };
    for (const QString &seeded : profiles) {
        {
            KConfigGroup group = scriptGroup();
            group.writeEntry(QStringLiteral("shortcutProfile"), seeded);
            group.sync();
        }
        CountingScriptModule module(nullptr, KPluginMetaData());
        module.load();
        CHECK(shortcutProfileCombo(module) == nullptr);
        CHECK(module.widget()->findChild<QWidget *>(QStringLiteral("label_shortcutProfile")) == nullptr);
        CHECK(storedShortcutProfile() == seeded);
        // Unchanged save: no send, no restart, value untouched.
        module.scriptSucceed = true;
        module.save();
        CHECK(storedShortcutProfile() == seeded);
        CHECK(module.scriptCalls == 0);
        CHECK(!module.isScriptRestartRequired());
        // Gap change: sends reconfigure, value untouched.
        QSpinBox *inner = innerGapSpinBox(module);
        CHECK(inner != nullptr);
        if (!inner) {
            return;
        }
        const int gapTarget = (inner->value() == 12) ? 20 : 12;
        inner->setValue(gapTarget);
        module.save();
        CHECK(storedShortcutProfile() == seeded);
        CHECK(module.scriptCalls == 1);
        CHECK(!module.isScriptRestartRequired());
        // Workspace-mode change: restart required, no send, value untouched.
        QComboBox *mode = workspaceModeCombo(module);
        CHECK(mode != nullptr);
        if (!mode) {
            return;
        }
        const QString modeTarget = otherWorkspaceMode(storedWorkspaceMode());
        const int modeIndex = mode->findData(modeTarget);
        CHECK(modeIndex >= 0);
        mode->setCurrentIndex(modeIndex);
        module.save();
        CHECK(storedShortcutProfile() == seeded);
        CHECK(scriptGroup().readEntry(QStringLiteral("workspaceMode"), QString()) == modeTarget);
        CHECK(module.scriptCalls == 1);
        CHECK(module.isScriptRestartRequired());
        CHECK(containsRestartRequirement(module.scriptStatusText()));
        // Defaults must not introduce or alter the hidden key either.
        module.defaults();
        module.save();
        CHECK(storedShortcutProfile() == seeded);
    }
    // A missing hidden key must stay missing through gap and mode saves.
    {
        KConfigGroup group = scriptGroup();
        group.deleteEntry(QStringLiteral("shortcutProfile"));
        group.sync();
    }
    {
        CountingScriptModule module(nullptr, KPluginMetaData());
        module.load();
        CHECK(shortcutProfileCombo(module) == nullptr);
        CHECK(!scriptGroup().hasKey(QStringLiteral("shortcutProfile")));
        QSpinBox *inner = innerGapSpinBox(module);
        CHECK(inner != nullptr);
        if (!inner) {
            return;
        }
        const int gapTarget = (inner->value() == 12) ? 20 : 12;
        inner->setValue(gapTarget);
        module.scriptSucceed = true;
        module.save();
        CHECK(!scriptGroup().hasKey(QStringLiteral("shortcutProfile")));
        QComboBox *mode = workspaceModeCombo(module);
        CHECK(mode != nullptr);
        if (!mode) {
            return;
        }
        const QString modeTarget = otherWorkspaceMode(storedWorkspaceMode());
        const int modeIndex = mode->findData(modeTarget);
        CHECK(modeIndex >= 0);
        mode->setCurrentIndex(modeIndex);
        module.save();
        CHECK(!scriptGroup().hasKey(QStringLiteral("shortcutProfile")));
        CHECK(module.isScriptRestartRequired());
    }
}

void combinedGapAndStartupSaveSendsWithResidualRestart()
{
    CountingScriptModule module(nullptr, KPluginMetaData());
    module.load();
    QComboBox *mode = workspaceModeCombo(module);
    QSpinBox *inner = innerGapSpinBox(module);
    CHECK(mode != nullptr);
    CHECK(inner != nullptr);
    if (!mode || !inner) {
        return;
    }
    const QString modeTarget = otherWorkspaceMode(storedWorkspaceMode());
    const int modeIndex = mode->findData(modeTarget);
    CHECK(modeIndex >= 0);
    const int gapTarget = (inner->value() == 12) ? 20 : 12;
    mode->setCurrentIndex(modeIndex);
    inner->setValue(gapTarget);
    CHECK(module.needsSave());
    module.scriptSucceed = true;
    module.save();
    CHECK(scriptGroup().readEntry(QStringLiteral("workspaceMode"), QString()) == modeTarget);
    CHECK(scriptGroup().readEntry(QStringLiteral("innerGap"), -1) == gapTarget);
    CHECK(module.scriptCalls == 1);
    CHECK(module.isScriptRestartRequired());
    CHECK(module.scriptStatusText().contains(QStringLiteral("unconfirmed")));
    CHECK(module.scriptStatusText().contains(QStringLiteral("workspace mode")));
    CHECK(!module.scriptStatusText().contains(QStringLiteral("startup settings")));
    CHECK(containsRestartRequirement(module.scriptStatusText()));
    CHECK(!containsAppliedClaim(module.scriptStatusText()));
    CHECK(!module.needsSave());
    // A later gap-only save keeps the standing workspace-mode restart without
    // claiming workspace mode was just saved again.
    QSpinBox *laterGap = innerGapSpinBox(module);
    CHECK(laterGap != nullptr);
    if (!laterGap) {
        return;
    }
    const int laterGapTarget = (laterGap->value() == 12) ? 20 : 12;
    laterGap->setValue(laterGapTarget);
    module.save();
    CHECK(scriptGroup().readEntry(QStringLiteral("innerGap"), -1) == laterGapTarget);
    CHECK(module.scriptCalls == 2);
    CHECK(module.isScriptRestartRequired());
    CHECK(module.scriptStatusText().contains(QStringLiteral("workspace mode")));
    CHECK(!module.scriptStatusText().contains(QStringLiteral("startup settings")));
    CHECK(!module.scriptStatusText().contains(QStringLiteral("Workspace mode saved")));
    CHECK(containsRestartRequirement(module.scriptStatusText()));
    CHECK(!containsAppliedClaim(module.scriptStatusText()));
    CHECK(!module.needsSave());
}

void combinedGapAndStartupSendFailureKeepsResidualRestart()
{
    CountingScriptModule module(nullptr, KPluginMetaData());
    module.load();
    QComboBox *mode = workspaceModeCombo(module);
    QSpinBox *inner = innerGapSpinBox(module);
    CHECK(mode != nullptr);
    CHECK(inner != nullptr);
    if (!mode || !inner) {
        return;
    }
    const QString modeTarget = otherWorkspaceMode(storedWorkspaceMode());
    const int modeIndex = mode->findData(modeTarget);
    CHECK(modeIndex >= 0);
    const int gapTarget = (inner->value() == 12) ? 20 : 12;
    mode->setCurrentIndex(modeIndex);
    inner->setValue(gapTarget);
    module.scriptSucceed = false;
    module.save();
    CHECK(module.scriptCalls == 1);
    CHECK(module.isGapReconfigurePending());
    CHECK(module.isScriptRestartRequired());
    CHECK(module.scriptStatusText().contains(QStringLiteral("failed")));
    CHECK(module.scriptStatusText().contains(QStringLiteral("retry on the next save")));
    CHECK(module.scriptStatusText().contains(QStringLiteral("saved to kwinrc")));
    CHECK(module.scriptStatusText().contains(QStringLiteral("workspace mode")));
    CHECK(!module.scriptStatusText().contains(QStringLiteral("startup settings")));
    CHECK(containsRestartRequirement(module.scriptStatusText()));
    CHECK(!containsAppliedClaim(module.scriptStatusText()));
    CHECK(module.needsSave());
    // A still-failing retry saves nothing yet keeps the restart residual.
    module.save();
    CHECK(module.scriptCalls == 2);
    CHECK(module.isGapReconfigurePending());
    CHECK(module.isScriptRestartRequired());
    CHECK(module.scriptStatusText().contains(QStringLiteral("failed")));
    CHECK(module.scriptStatusText().contains(QStringLiteral("saved nothing")));
    CHECK(!module.scriptStatusText().contains(QStringLiteral("saved to kwinrc")));
    CHECK(module.scriptStatusText().contains(QStringLiteral("workspace mode")));
    CHECK(!module.scriptStatusText().contains(QStringLiteral("startup settings")));
    CHECK(containsRestartRequirement(module.scriptStatusText()));
    CHECK(!containsAppliedClaim(module.scriptStatusText()));
    // Retry success keeps the restart residual while clearing the pending flag.
    module.scriptSucceed = true;
    module.save();
    CHECK(module.scriptCalls == 3);
    CHECK(!module.isGapReconfigurePending());
    CHECK(module.isScriptRestartRequired());
    CHECK(module.scriptStatusText().contains(QStringLiteral("unconfirmed")));
    CHECK(module.scriptStatusText().contains(QStringLiteral("saved nothing")));
    CHECK(!module.scriptStatusText().contains(QStringLiteral("saved to kwinrc")));
    CHECK(module.scriptStatusText().contains(QStringLiteral("workspace mode")));
    CHECK(!module.scriptStatusText().contains(QStringLiteral("startup settings")));
    CHECK(containsRestartRequirement(module.scriptStatusText()));
    CHECK(!containsAppliedClaim(module.scriptStatusText()));
    CHECK(!module.needsSave());
}

void poisonedBusScriptSendFailsClosed()
{
    KWin::ScriptConfigModule module(nullptr, KPluginMetaData());
    module.load();
    CHECK(!module.requestScriptReconfigure());
}

QStringList capturedScriptConfigMessages;

void captureScriptConfigMessage(QtMsgType, const QMessageLogContext &, const QString &message)
{
    capturedScriptConfigMessages.append(message);
}

QString startupRestartLog()
{
    for (const QString &message : capturedScriptConfigMessages) {
        if (message.contains(QStringLiteral("stage=startup"))) {
            return message;
        }
    }
    return QString();
}

void startupRestartLogEnumeratesOnlyChangedKeys()
{
    // Only workspaceMode can be changed from this dialog: the startup log
    // must list exactly that key and never the hidden shortcutProfile.
    capturedScriptConfigMessages.clear();
    const QtMessageHandler previous = qInstallMessageHandler(captureScriptConfigMessage);
    {
        CountingScriptModule module(nullptr, KPluginMetaData());
        module.load();
        QComboBox *mode = workspaceModeCombo(module);
        CHECK(mode != nullptr);
        if (mode) {
            const QString modeTarget = otherWorkspaceMode(storedWorkspaceMode());
            const int modeIndex = mode->findData(modeTarget);
            CHECK(modeIndex >= 0);
            mode->setCurrentIndex(modeIndex);
        }
        module.scriptSucceed = true;
        module.save();
    }
    qInstallMessageHandler(previous);
    const QString single = startupRestartLog();
    CHECK(!single.isEmpty());
    CHECK(single.contains(QStringLiteral("keys=workspaceMode")));
    CHECK(!single.contains(QStringLiteral("shortcutProfile")));
}

} // namespace

int main(int argc, char **argv)
{
    // Isolate from the live session bus before any
    // QDBusConnection::sessionBus() initialization.
    qputenv("DBUS_SESSION_BUS_ADDRESS", QByteArray("unix:path=/dev/null/plasma-auto-tiler-scriptconfig-test-isolated-bus"));
    QTemporaryDir configHome;
    if (!configHome.isValid()) {
        std::fprintf(stderr, "failed to create temporary config directory\n");
        return EXIT_FAILURE;
    }
    qputenv("XDG_CONFIG_HOME", configHome.path().toUtf8());
    QApplication app(argc, argv);
    app.clipboard()->setMimeData(new QMimeData);

    if (argc != 2) {
        std::fprintf(stderr, "usage: %s dbus|gaps|save\n", argv[0]);
        return EXIT_FAILURE;
    }

    const QString scenario = QString::fromLocal8Bit(argv[1]);
    if (scenario == QStringLiteral("dbus")) {
        scriptReconfigureTargetIsExact();
        poisonedBusScriptSendFailsClosed();
    } else if (scenario == QStringLiteral("gaps")) {
        gapContractNormalizesBoundsAndPersists();
        unsupportedControlsAreAbsentAndLegacyValuesUntouched();
    } else if (scenario == QStringLiteral("save")) {
        unchangedSaveSendsNothing();
        gapSavePersistsThenSendsUnconfirmed();
        gapSaveSendFailureArmsRetryOnNextSave();
        startupRestartLogEnumeratesOnlyChangedKeys();
        startupOnlySaveDisablesSendWithRestartMessage();
        hiddenShortcutProfileIsAbsentAndPreservedUntouched();
        combinedGapAndStartupSaveSendsWithResidualRestart();
        combinedGapAndStartupSendFailureKeepsResidualRestart();
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
