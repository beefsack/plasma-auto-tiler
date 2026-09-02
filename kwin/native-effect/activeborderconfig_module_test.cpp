#include "activeborderconfig_module.h"

#include <KConfigGroup>
#include <KPluginMetaData>
#include <KSharedConfig>

#include <QApplication>
#include <QCheckBox>
#include <QClipboard>
#include <QMimeData>
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

} // namespace

int main(int argc, char **argv)
{
    QTemporaryDir configHome;
    if (!configHome.isValid()) {
        std::fprintf(stderr, "failed to create temporary config directory\n");
        return EXIT_FAILURE;
    }
    qputenv("XDG_CONFIG_HOME", configHome.path().toUtf8());
    QApplication app(argc, argv);
    app.clipboard()->setMimeData(new QMimeData);

    if (argc != 2) {
        std::fprintf(stderr, "usage: %s malformed|valid|missing\n", argv[0]);
        return EXIT_FAILURE;
    }

    const QString scenario = QString::fromLocal8Bit(argv[1]);
    if (scenario == QStringLiteral("malformed")) {
        malformedValueBecomesEstablishedFalse();
    } else if (scenario == QStringLiteral("valid")) {
        validValueIsPreservedUntilDefaultsAreSaved();
    } else if (scenario == QStringLiteral("missing")) {
        missingValueKeepsTheDefaultWithoutCreatingAKey();
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
