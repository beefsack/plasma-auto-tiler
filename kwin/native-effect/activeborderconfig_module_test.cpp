#include "activeborderconfig_module.h"
#include "activeborderconfig.h"

#include <KColorButton>
#include <KConfigGroup>
#include <KPluginMetaData>
#include <KSharedConfig>

#include <QApplication>
#include <QCheckBox>
#include <QClipboard>
#include <QColor>
#include <QComboBox>
#include <QDBusMessage>
#include <QDoubleSpinBox>
#include <QLabel>
#include <QMimeData>
#include <QPushButton>
#include <QSpinBox>
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

QCheckBox *scriptCheckBox(KWin::ActiveBorderConfigModule &module)
{
    return module.widget()->findChild<QCheckBox *>(QStringLiteral("dropOutlinePreviewCheckBox"));
}

QSpinBox *innerGapSpinBox(KWin::ActiveBorderConfigModule &module)
{
    return module.widget()->findChild<QSpinBox *>(QStringLiteral("innerGapSpinBox"));
}

QSpinBox *outerGapSpinBox(KWin::ActiveBorderConfigModule &module)
{
    return module.widget()->findChild<QSpinBox *>(QStringLiteral("outerGapSpinBox"));
}

KConfigGroup borderGroup()
{
    return KConfigGroup(KSharedConfig::openConfig(QStringLiteral("kwinrc")), QStringLiteral("Effect-plasma-auto-tiler-active-border"));
}

QDoubleSpinBox *borderWidthSpinBox(KWin::ActiveBorderConfigModule &module)
{
    return module.widget()->findChild<QDoubleSpinBox *>(QStringLiteral("kcfg_BorderWidth"));
}

KColorButton *borderColorButton(KWin::ActiveBorderConfigModule &module)
{
    return module.widget()->findChild<KColorButton *>(QStringLiteral("kcfg_BorderColor"));
}

QCheckBox *useThemeColorCheckBox(KWin::ActiveBorderConfigModule &module)
{
    return module.widget()->findChild<QCheckBox *>(QStringLiteral("kcfg_UseThemeColor"));
}

QComboBox *tilingAlgorithmCombo(KWin::ActiveBorderConfigModule &module)
{
    return module.widget()->findChild<QComboBox *>(QStringLiteral("tilingAlgorithmCombo"));
}

QLabel *tilerReloadStatusLabel(KWin::ActiveBorderConfigModule &module)
{
    return module.widget()->findChild<QLabel *>(QStringLiteral("tilerReloadStatusLabel"));
}

QPushButton *tilerReloadButton(KWin::ActiveBorderConfigModule &module)
{
    return module.widget()->findChild<QPushButton *>(QStringLiteral("tilerReloadButton"));
}

bool containsAppliedClaim(const QString &text)
{
    return text.toLower().contains(QStringLiteral("applied"));
}

QColor defaultBorderColor()
{
    return QColor(0x2a, 0x82, 0xda);
}

void dbusTargetIsExact()
{
    CHECK(KWin::ActiveBorderConfigModule::effectService() == QStringLiteral("org.kde.KWin"));
    CHECK(KWin::ActiveBorderConfigModule::effectPath() == QStringLiteral("/Effects"));
    CHECK(KWin::ActiveBorderConfigModule::effectInterface() == QStringLiteral("org.kde.kwin.Effects"));
    CHECK(KWin::ActiveBorderConfigModule::effectInterface() != QStringLiteral("org.kde.KWin.Effects"));
    CHECK(KWin::ActiveBorderConfigModule::effectMethod() == QStringLiteral("reconfigureEffect"));
    CHECK(KWin::ActiveBorderConfigModule::effectName() == QStringLiteral("plasma-auto-tiler-active-border"));
}

void dbusErrorClassification()
{
    const QDBusMessage methodCall = QDBusMessage::createMethodCall(
        KWin::ActiveBorderConfigModule::effectService(),
        KWin::ActiveBorderConfigModule::effectPath(),
        KWin::ActiveBorderConfigModule::effectInterface(),
        KWin::ActiveBorderConfigModule::effectMethod());
    const QDBusMessage reply = methodCall.createReply();
    CHECK(reply.type() == QDBusMessage::ReplyMessage);
    CHECK(!KWin::ActiveBorderConfigModule::isEffectReconfigureFailed(reply));
    const QDBusMessage error = QDBusMessage::createError(QStringLiteral("org.freedesktop.DBus.Error.ServiceUnknown"), QStringLiteral("not found"));
    CHECK(error.type() == QDBusMessage::ErrorMessage);
    CHECK(KWin::ActiveBorderConfigModule::isEffectReconfigureFailed(error));
    const QDBusMessage invalid;
    CHECK(invalid.type() == QDBusMessage::InvalidMessage);
    CHECK(KWin::ActiveBorderConfigModule::isEffectReconfigureFailed(invalid));
    CHECK(methodCall.type() == QDBusMessage::MethodCallMessage);
    CHECK(KWin::ActiveBorderConfigModule::isEffectReconfigureFailed(methodCall));
}

void reconfigureRequestFailsWithoutKwin()
{
    const QDBusMessage serviceUnknown = QDBusMessage::createError(QStringLiteral("org.freedesktop.DBus.Error.ServiceUnknown"), QStringLiteral("not found"));
    CHECK(KWin::ActiveBorderConfigModule::isEffectReconfigureFailed(serviceUnknown));
    const QDBusMessage unknownInterface = QDBusMessage::createError(QStringLiteral("org.freedesktop.DBus.Error.UnknownInterface"), QStringLiteral("no such interface"));
    CHECK(KWin::ActiveBorderConfigModule::isEffectReconfigureFailed(unknownInterface));
}

void scriptReconfigureTargetIsExact()
{
    CHECK(KWin::ActiveBorderConfigModule::scriptService() == QStringLiteral("org.kde.KWin"));
    CHECK(KWin::ActiveBorderConfigModule::scriptPath() == QStringLiteral("/KWin"));
    CHECK(KWin::ActiveBorderConfigModule::scriptInterface() == QStringLiteral("org.kde.KWin"));
    CHECK(KWin::ActiveBorderConfigModule::scriptMethod() == QStringLiteral("reconfigure"));
}

class FailingReconfigureModule : public KWin::ActiveBorderConfigModule
{
public:
    using KWin::ActiveBorderConfigModule::ActiveBorderConfigModule;
    bool requestEffectReconfigure() override
    {
        return false;
    }
};

class SucceedingReconfigureModule : public KWin::ActiveBorderConfigModule
{
public:
    using KWin::ActiveBorderConfigModule::ActiveBorderConfigModule;
    bool requestEffectReconfigure() override
    {
        return true;
    }
};

class CountingReconfigureModule : public KWin::ActiveBorderConfigModule
{
public:
    using KWin::ActiveBorderConfigModule::ActiveBorderConfigModule;
    bool requestEffectReconfigure() override
    {
        ++calls;
        return succeed;
    }
    int calls = 0;
    bool succeed = false;
};

void failedHotApplyKeepsNeedsSave()
{
    FailingReconfigureModule module(nullptr, KPluginMetaData());
    module.load();
    QDoubleSpinBox *width = borderWidthSpinBox(module);
    CHECK(width != nullptr);
    if (!width) {
        return;
    }
    CHECK(!module.needsSave());
    width->setValue(7.5);
    CHECK(module.needsSave());
    module.save();
    CHECK(borderGroup().readEntry(QStringLiteral("BorderWidth"), 0.0) == 7.5);
    CHECK(module.needsSave());
}

void successfulHotApplyClearsNeedsSave()
{
    SucceedingReconfigureModule module(nullptr, KPluginMetaData());
    module.load();
    QDoubleSpinBox *width = borderWidthSpinBox(module);
    CHECK(width != nullptr);
    if (!width) {
        return;
    }
    const double freshValue = (width->value() == 8.5) ? 6.5 : 8.5;
    width->setValue(freshValue);
    CHECK(module.needsSave());
    module.save();
    CHECK(borderGroup().readEntry(QStringLiteral("BorderWidth"), 0.0) == freshValue);
    CHECK(!module.needsSave());
}

void cleanSaveClearsNeedsSave()
{
    KWin::ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.load();
    CHECK(!module.needsSave());
    module.save();
    CHECK(!module.needsSave());
}

void failedHotApplyRetriesOnSecondSaveWithoutEdit()
{
    CountingReconfigureModule module(nullptr, KPluginMetaData());
    module.load();
    QDoubleSpinBox *width = borderWidthSpinBox(module);
    CHECK(width != nullptr);
    if (!width) {
        return;
    }
    const double target = (width->value() == 7.5) ? 6.5 : 7.5;
    width->setValue(target);
    CHECK(module.needsSave());
    module.save();
    CHECK(module.calls == 1);
    CHECK(borderGroup().readEntry(QStringLiteral("BorderWidth"), 0.0) == target);
    CHECK(module.needsSave());
    module.save();
    CHECK(module.calls == 2);
    CHECK(module.needsSave());
    module.succeed = true;
    module.save();
    CHECK(module.calls == 3);
    CHECK(!module.needsSave());
    module.save();
    CHECK(module.calls == 3);
    CHECK(!module.needsSave());
}

void borderSerializationRoundtrip()
{
    SucceedingReconfigureModule module(nullptr, KPluginMetaData());
    module.load();
    QDoubleSpinBox *width = borderWidthSpinBox(module);
    CHECK(width != nullptr);
    if (!width) {
        return;
    }
    width->setValue(9.5);
    module.save();
    CHECK(borderGroup().readEntry(QStringLiteral("BorderWidth"), 0.0) == 9.5);

    KWin::ActiveBorderConfigModule reloaded(nullptr, KPluginMetaData());
    reloaded.load();
    QDoubleSpinBox *reloadedWidth = borderWidthSpinBox(reloaded);
    CHECK(reloadedWidth != nullptr);
    if (reloadedWidth) {
        CHECK(reloadedWidth->value() == 9.5);
    }
}

void borderDefaultsReset()
{
    SucceedingReconfigureModule module(nullptr, KPluginMetaData());
    module.load();
    QDoubleSpinBox *width = borderWidthSpinBox(module);
    CHECK(width != nullptr);
    if (!width) {
        return;
    }
    width->setValue(9.5);
    module.save();
    CHECK(borderGroup().readEntry(QStringLiteral("BorderWidth"), 0.0) == 9.5);
    module.defaults();
    CHECK(width->value() == 3.0);
    module.save();
    CHECK(borderGroup().readEntry(QStringLiteral("BorderWidth"), 3.0) == 3.0);
    KWin::ActiveBorderConfig::self()->read();
    CHECK(KWin::ActiveBorderConfig::borderWidth() == 3.0);
}

void borderColorSerializationRoundtrip()
{
    SucceedingReconfigureModule module(nullptr, KPluginMetaData());
    module.load();
    KColorButton *color = borderColorButton(module);
    CHECK(color != nullptr);
    if (!color) {
        return;
    }
    const QColor target(0x11, 0x22, 0x33);
    color->setColor(target);
    module.save();
    CHECK(borderGroup().readEntry(QStringLiteral("BorderColor"), QColor()) == target);

    KWin::ActiveBorderConfigModule reloaded(nullptr, KPluginMetaData());
    reloaded.load();
    KColorButton *reloadedColor = borderColorButton(reloaded);
    CHECK(reloadedColor != nullptr);
    if (reloadedColor) {
        CHECK(reloadedColor->color() == target);
    }
    KWin::ActiveBorderConfig::self()->read();
    CHECK(KWin::ActiveBorderConfig::borderColor() == target);
}

void borderColorDefaultsReset()
{
    SucceedingReconfigureModule module(nullptr, KPluginMetaData());
    module.load();
    KColorButton *color = borderColorButton(module);
    CHECK(color != nullptr);
    if (!color) {
        return;
    }
    const QColor custom(0x11, 0x22, 0x33);
    color->setColor(custom);
    module.save();
    CHECK(borderGroup().readEntry(QStringLiteral("BorderColor"), QColor()) == custom);
    module.defaults();
    CHECK(color->color() == defaultBorderColor());
    module.save();
    CHECK(borderGroup().readEntry(QStringLiteral("BorderColor"), defaultBorderColor()) == defaultBorderColor());
    KWin::ActiveBorderConfig::self()->read();
    CHECK(KWin::ActiveBorderConfig::borderColor() == defaultBorderColor());
}

void effectConfigReloadReflectsStoredValues()
{
    KWin::ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.load();
    {
        KConfigGroup group = borderGroup();
        group.writeEntry(QStringLiteral("BorderWidth"), 12.5);
        group.sync();
    }
    KWin::ActiveBorderConfig::self()->read();
    CHECK(KWin::ActiveBorderConfig::borderWidth() == 12.5);
    {
        KConfigGroup group = borderGroup();
        group.writeEntry(QStringLiteral("BorderWidth"), 3.0);
        group.sync();
    }
    KWin::ActiveBorderConfig::self()->read();
    CHECK(KWin::ActiveBorderConfig::borderWidth() == 3.0);
}

void useThemeColorMissingKeyDefaultsToChecked()
{
    {
        KConfigGroup group = borderGroup();
        group.deleteEntry(QStringLiteral("UseThemeColor"));
        group.sync();
    }
    KWin::ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    QCheckBox *checkBox = useThemeColorCheckBox(module);
    CHECK(checkBox != nullptr);
    module.load();
    if (checkBox) {
        CHECK(checkBox->isChecked());
    }
    KWin::ActiveBorderConfig::self()->read();
    CHECK(KWin::ActiveBorderConfig::useThemeColor());
}

void useThemeColorSerializationRoundtrip()
{
    SucceedingReconfigureModule module(nullptr, KPluginMetaData());
    module.load();
    QCheckBox *checkBox = useThemeColorCheckBox(module);
    CHECK(checkBox != nullptr);
    if (!checkBox) {
        return;
    }
    checkBox->setChecked(false);
    module.save();
    CHECK(borderGroup().readEntry(QStringLiteral("UseThemeColor"), true) == false);

    KWin::ActiveBorderConfigModule reloaded(nullptr, KPluginMetaData());
    reloaded.load();
    QCheckBox *reloadedCheckBox = useThemeColorCheckBox(reloaded);
    CHECK(reloadedCheckBox != nullptr);
    if (reloadedCheckBox) {
        CHECK(!reloadedCheckBox->isChecked());
    }
    KWin::ActiveBorderConfig::self()->read();
    CHECK(!KWin::ActiveBorderConfig::useThemeColor());
}

void useThemeColorDefaultsReset()
{
    SucceedingReconfigureModule module(nullptr, KPluginMetaData());
    module.load();
    QCheckBox *checkBox = useThemeColorCheckBox(module);
    CHECK(checkBox != nullptr);
    if (!checkBox) {
        return;
    }
    checkBox->setChecked(false);
    module.save();
    CHECK(borderGroup().readEntry(QStringLiteral("UseThemeColor"), true) == false);
    module.defaults();
    CHECK(checkBox->isChecked());
    module.save();
    CHECK(borderGroup().readEntry(QStringLiteral("UseThemeColor"), true) == true);
    KWin::ActiveBorderConfig::self()->read();
    CHECK(KWin::ActiveBorderConfig::useThemeColor());
}

void useThemeColorToggleMarksDirty()
{
    SucceedingReconfigureModule module(nullptr, KPluginMetaData());
    module.load();
    QCheckBox *checkBox = useThemeColorCheckBox(module);
    CHECK(checkBox != nullptr);
    if (!checkBox) {
        return;
    }
    CHECK(!module.needsSave());
    checkBox->setChecked(!checkBox->isChecked());
    CHECK(module.needsSave());
}

void useThemeColorOnlyHotApplyRetry()
{
    CountingReconfigureModule module(nullptr, KPluginMetaData());
    module.load();
    QCheckBox *checkBox = useThemeColorCheckBox(module);
    CHECK(checkBox != nullptr);
    if (!checkBox) {
        return;
    }
    checkBox->setChecked(false);
    CHECK(module.needsSave());
    module.save();
    CHECK(module.calls == 1);
    CHECK(borderGroup().readEntry(QStringLiteral("UseThemeColor"), true) == false);
    CHECK(module.needsSave());
    module.save();
    CHECK(module.calls == 2);
    CHECK(module.needsSave());
    module.succeed = true;
    module.save();
    CHECK(module.calls == 3);
    CHECK(!module.needsSave());
}

void malformedValueBecomesEstablishedFalse()
{
    {
        KConfigGroup group = scriptGroup();
        group.writeEntry(QStringLiteral("dropOutlinePreview"), QStringLiteral("not-a-boolean"));
        group.sync();
    }

    KWin::ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    QCheckBox *checkBox = scriptCheckBox(module);
    CHECK(checkBox != nullptr);
    module.load();

    module.defaults();
    if (checkBox) {
        CHECK(!checkBox->isChecked());
    }
    module.save();

    const KConfigGroup group = scriptGroup();
    CHECK(group.hasKey(QStringLiteral("dropOutlinePreview")));
    CHECK(group.readEntry(QStringLiteral("dropOutlinePreview"), QString()) == QStringLiteral("false"));
}

void validValueIsPreservedUntilDefaultsAreSaved()
{
    {
        KConfigGroup group = scriptGroup();
        group.writeEntry(QStringLiteral("dropOutlinePreview"), QStringLiteral("true"));
        group.sync();
        CHECK(group.readEntry(QStringLiteral("dropOutlinePreview"), QString()) == QStringLiteral("true"));
    }

    {
        KWin::ActiveBorderConfigModule module(nullptr, KPluginMetaData());
        module.load();
        QCheckBox *checkBox = scriptCheckBox(module);
        CHECK(checkBox != nullptr);
        if (checkBox) {
            CHECK(checkBox->isChecked());
        }
        module.save();
    }

    {
        const KConfigGroup group = scriptGroup();
        CHECK(group.hasKey(QStringLiteral("dropOutlinePreview")));
        CHECK(group.readEntry(QStringLiteral("dropOutlinePreview"), QString()) == QStringLiteral("true"));
    }

    KWin::ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    QCheckBox *checkBox = scriptCheckBox(module);
    CHECK(checkBox != nullptr);
    CHECK(scriptGroup().readEntry(QStringLiteral("dropOutlinePreview"), QString()) == QStringLiteral("true"));
    module.load();
    CHECK(scriptGroup().readEntry(QStringLiteral("dropOutlinePreview"), QString()) == QStringLiteral("true"));
    if (checkBox) {
        CHECK(checkBox->isChecked());
    }
    module.defaults();
    if (checkBox) {
        CHECK(!checkBox->isChecked());
    }
    module.save();

    const KConfigGroup group = scriptGroup();
    CHECK(group.hasKey(QStringLiteral("dropOutlinePreview")));
    CHECK(group.readEntry(QStringLiteral("dropOutlinePreview"), QString()) == QStringLiteral("false"));
}

void missingValueKeepsTheDefaultWithoutCreatingAKey()
{
    KWin::ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    QCheckBox *checkBox = scriptCheckBox(module);
    CHECK(checkBox != nullptr);
    module.load();
    if (checkBox) {
        CHECK(!checkBox->isChecked());
    }

    module.defaults();
    if (checkBox) {
        CHECK(!checkBox->isChecked());
    }
    module.save();

    const KConfigGroup group = scriptGroup();
    CHECK(!group.hasKey(QStringLiteral("dropOutlinePreview")));
    CHECK(!group.readEntry(QStringLiteral("dropOutlinePreview"), false));
}

void gapContractNormalizesBoundsAndPersists()
{
    {
        KConfigGroup group = scriptGroup();
        group.writeEntry(QStringLiteral("innerGap"), QStringLiteral("not-a-number"));
        group.writeEntry(QStringLiteral("outerGap"), QStringLiteral("-5"));
        group.sync();
    }

    {
        SucceedingReconfigureModule module(nullptr, KPluginMetaData());
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
        SucceedingReconfigureModule module(nullptr, KPluginMetaData());
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
        inner->setValue(64);
        outer->setValue(0);
        module.save();
        CHECK(scriptGroup().readEntry(QStringLiteral("innerGap"), -1) == 64);
        CHECK(scriptGroup().readEntry(QStringLiteral("outerGap"), -1) == 0);
    }

    {
        KWin::ActiveBorderConfigModule reloaded(nullptr, KPluginMetaData());
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
        KWin::ActiveBorderConfigModule module(nullptr, KPluginMetaData());
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
        SucceedingReconfigureModule module(nullptr, KPluginMetaData());
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
        module.save();
        CHECK(!scriptGroup().hasKey(QStringLiteral("innerGap")));
        CHECK(!scriptGroup().hasKey(QStringLiteral("outerGap")));

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

class CountingScriptReloadModule : public KWin::ActiveBorderConfigModule
{
public:
    using KWin::ActiveBorderConfigModule::ActiveBorderConfigModule;
    bool requestEffectReconfigure() override
    {
        ++effectCalls;
        return effectSucceed;
    }
    bool requestScriptReconfigure() override
    {
        ++scriptCalls;
        return scriptSucceed;
    }
    int effectCalls = 0;
    int scriptCalls = 0;
    bool effectSucceed = true;
    bool scriptSucceed = false;
};

void unchangedSaveMarksNoReloadWithoutSend()
{
    CountingScriptReloadModule module(nullptr, KPluginMetaData());
    module.load();
    CHECK(!module.isTilerReloadRequired());
    CHECK(tilerReloadStatusLabel(module) != nullptr);
    CHECK(tilerReloadButton(module) != nullptr);
    CHECK(module.tilerReloadStatusText().contains(QStringLiteral("No pending")));
    CHECK(!containsAppliedClaim(module.tilerReloadStatusText()));
    int confirms = 0;
    module.setShortcutConfirmHandler([&confirms](const QString &, const QString &) {
        ++confirms;
        return false;
    });
    module.save();
    CHECK(!module.isTilerReloadRequired());
    CHECK(module.scriptCalls == 0);
    CHECK(module.effectCalls == 0);
    CHECK(!module.needsSave());
    CHECK(confirms == 0);
    CHECK(!containsAppliedClaim(module.tilerReloadStatusText()));
}

void tilingSaveMarksReloadRequiredWithoutAutoSend()
{
    CountingScriptReloadModule module(nullptr, KPluginMetaData());
    module.load();
    QComboBox *tiling = tilingAlgorithmCombo(module);
    CHECK(tiling != nullptr);
    if (!tiling) {
        return;
    }
    const int rows = tiling->findData(QStringLiteral("rows"));
    CHECK(rows >= 0);
    tiling->setCurrentIndex(rows);
    CHECK(module.needsSave());
    int confirms = 0;
    module.setShortcutConfirmHandler([&confirms](const QString &, const QString &) {
        ++confirms;
        return false;
    });
    module.save();
    CHECK(scriptGroup().readEntry(QStringLiteral("tilingAlgorithm"), QString()) == QStringLiteral("rows"));
    CHECK(module.isTilerReloadRequired());
    CHECK(module.tilerReloadStatusText().contains(QStringLiteral("Reload required")));
    CHECK(!containsAppliedClaim(module.tilerReloadStatusText()));
    CHECK(module.scriptCalls == 0);
    CHECK(module.effectCalls == 0);
    CHECK(!module.needsSave());
    CHECK(confirms == 0);
    // An unchanged follow-up save must not auto-send and must keep the flag.
    module.save();
    CHECK(module.isTilerReloadRequired());
    CHECK(module.scriptCalls == 0);
    CHECK(confirms == 0);
}

void borderOnlySaveHotAppliesWithoutReloadRequired()
{
    CountingScriptReloadModule module(nullptr, KPluginMetaData());
    module.load();
    QDoubleSpinBox *width = borderWidthSpinBox(module);
    CHECK(width != nullptr);
    if (!width) {
        return;
    }
    const double target = (width->value() == 7.5) ? 6.5 : 7.5;
    width->setValue(target);
    module.save();
    CHECK(borderGroup().readEntry(QStringLiteral("BorderWidth"), 0.0) == target);
    CHECK(!module.isTilerReloadRequired());
    CHECK(module.effectCalls == 1);
    CHECK(module.scriptCalls == 0);
    CHECK(!module.needsSave());
}

void deliberateReloadSuccessIsUnconfirmedWithoutAppliedClaim()
{
    CountingScriptReloadModule module(nullptr, KPluginMetaData());
    module.load();
    QComboBox *tiling = tilingAlgorithmCombo(module);
    CHECK(tiling != nullptr);
    if (!tiling) {
        return;
    }
    tiling->setCurrentIndex(tiling->findData(QStringLiteral("balanced-grid")));
    module.save();
    CHECK(module.isTilerReloadRequired());
    CHECK(module.scriptCalls == 0);
    module.scriptSucceed = true;
    int confirms = 0;
    module.setShortcutConfirmHandler([&confirms](const QString &, const QString &) {
        ++confirms;
        return false;
    });
    module.requestTilerReload();
    CHECK(module.scriptCalls == 1);
    CHECK(module.isTilerReloadRequired());
    CHECK(module.tilerReloadStatusText().contains(QStringLiteral("unconfirmed")));
    CHECK(!containsAppliedClaim(module.tilerReloadStatusText()));
    CHECK(!module.needsSave());
    CHECK(confirms == 0);
    CHECK(scriptGroup().readEntry(QStringLiteral("tilingAlgorithm"), QString()) == QStringLiteral("balanced-grid"));
}

void deliberateReloadFailureKeepsRequiredWithoutAppliedClaim()
{
    CountingScriptReloadModule module(nullptr, KPluginMetaData());
    module.load();
    QComboBox *tiling = tilingAlgorithmCombo(module);
    CHECK(tiling != nullptr);
    if (!tiling) {
        return;
    }
    tiling->setCurrentIndex(tiling->findData(QStringLiteral("dwindle")));
    module.save();
    // Force a real tiling change when the stored value already is dwindle.
    if (!module.isTilerReloadRequired()) {
        tiling->setCurrentIndex(tiling->findData(QStringLiteral("rows")));
        module.save();
    }
    CHECK(module.isTilerReloadRequired());
    module.scriptSucceed = false;
    module.requestTilerReload();
    CHECK(module.scriptCalls == 1);
    CHECK(module.isTilerReloadRequired());
    CHECK(module.tilerReloadStatusText().contains(QStringLiteral("failed")));
    CHECK(!containsAppliedClaim(module.tilerReloadStatusText()));
    CHECK(!module.needsSave());
}

void poisonedBusScriptSendFailsClosed()
{
    KWin::ActiveBorderConfigModule module(nullptr, KPluginMetaData());
    module.load();
    CHECK(!module.requestScriptReconfigure());
}

} // namespace

int main(int argc, char **argv)
{
    // Unit 1 hard gate: isolate from the live session bus before any
    // QDBusConnection::sessionBus() initialization (ActiveBorderConfigModule
    // creates the live KGlobalAccelStore in its constructor).
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
        std::fprintf(stderr, "usage: %s malformed|valid|missing|dbus|hotapply|border|config|gaps|reload\n", argv[0]);
        return EXIT_FAILURE;
    }

    const QString scenario = QString::fromLocal8Bit(argv[1]);
    if (scenario == QStringLiteral("malformed")) {
        malformedValueBecomesEstablishedFalse();
    } else if (scenario == QStringLiteral("valid")) {
        validValueIsPreservedUntilDefaultsAreSaved();
    } else if (scenario == QStringLiteral("missing")) {
        missingValueKeepsTheDefaultWithoutCreatingAKey();
    } else if (scenario == QStringLiteral("dbus")) {
        dbusTargetIsExact();
        dbusErrorClassification();
        reconfigureRequestFailsWithoutKwin();
        scriptReconfigureTargetIsExact();
    } else if (scenario == QStringLiteral("hotapply")) {
        cleanSaveClearsNeedsSave();
        failedHotApplyKeepsNeedsSave();
        successfulHotApplyClearsNeedsSave();
        failedHotApplyRetriesOnSecondSaveWithoutEdit();
    } else if (scenario == QStringLiteral("border")) {
        useThemeColorMissingKeyDefaultsToChecked();
        borderSerializationRoundtrip();
        borderDefaultsReset();
        borderColorSerializationRoundtrip();
        borderColorDefaultsReset();
        useThemeColorSerializationRoundtrip();
        useThemeColorDefaultsReset();
        useThemeColorToggleMarksDirty();
        useThemeColorOnlyHotApplyRetry();
    } else if (scenario == QStringLiteral("config")) {
        effectConfigReloadReflectsStoredValues();
    } else if (scenario == QStringLiteral("gaps")) {
        gapContractNormalizesBoundsAndPersists();
    } else if (scenario == QStringLiteral("reload")) {
        scriptReconfigureTargetIsExact();
        unchangedSaveMarksNoReloadWithoutSend();
        tilingSaveMarksReloadRequiredWithoutAutoSend();
        borderOnlySaveHotAppliesWithoutReloadRequired();
        deliberateReloadSuccessIsUnconfirmedWithoutAppliedClaim();
        deliberateReloadFailureKeepsRequiredWithoutAppliedClaim();
        poisonedBusScriptSendFailsClosed();
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
