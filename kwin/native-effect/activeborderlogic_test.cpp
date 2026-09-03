#include "activeborderlogic.h"

#include <QColor>
#include <QRectF>

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

void eligibleWindowUsesFrameGeometryAsInnerRect()
{
    const QRectF frame(10.0, 20.0, 320.0, 200.0);
    const KWin::ActiveBorderState state = KWin::activeBorderState(true, frame, false, false, false);
    CHECK(state.visible);
    CHECK(state.innerRect == frame);
}

void missingWindowIsNotVisible()
{
    const QRectF frame(0.0, 0.0, 100.0, 100.0);
    const KWin::ActiveBorderState state = KWin::activeBorderState(false, frame, false, false, false);
    CHECK(!state.visible);
    CHECK(state.innerRect == QRectF());
}

void deletedWindowIsNotVisible()
{
    const QRectF frame(0.0, 0.0, 100.0, 100.0);
    const KWin::ActiveBorderState state = KWin::activeBorderState(true, frame, true, false, false);
    CHECK(!state.visible);
}

void minimizedWindowIsNotVisible()
{
    const QRectF frame(0.0, 0.0, 100.0, 100.0);
    const KWin::ActiveBorderState state = KWin::activeBorderState(true, frame, false, true, false);
    CHECK(!state.visible);
}

void fullScreenWindowIsNotVisible()
{
    const QRectF frame(0.0, 0.0, 1920.0, 1080.0);
    const KWin::ActiveBorderState state = KWin::activeBorderState(true, frame, false, false, true);
    CHECK(!state.visible);
}

void invalidThemeColorUsesConfiguredFallback()
{
    const QColor fallback(0x2a, 0x82, 0xda);
    CHECK(KWin::activeBorderColor(QColor(), fallback, true) == fallback);
}

void transparentThemeColorUsesConfiguredFallback()
{
    const QColor fallback(0x2a, 0x82, 0xda);
    CHECK(KWin::activeBorderColor(QColor(0, 0, 0, 0), fallback, true) == fallback);
}

void usableThemeColorWinsOverConfiguredFallback()
{
    const QColor theme(0x10, 0x20, 0x30);
    CHECK(KWin::activeBorderColor(theme, QColor(0x2a, 0x82, 0xda), true) == theme);
}

void disabledThemeOverrideAlwaysUsesConfiguredFallback()
{
    const QColor fallback(0x2a, 0x82, 0xda);
    const QColor theme(0x10, 0x20, 0x30);
    CHECK(KWin::activeBorderColor(theme, fallback, false) == fallback);
    CHECK(KWin::activeBorderColor(QColor(), fallback, false) == fallback);
    CHECK(KWin::activeBorderColor(QColor(0, 0, 0, 0), fallback, false) == fallback);
}

void zeroGapKeepsFrameAsInnerRect()
{
    const QRectF frame(10.0, 20.0, 320.0, 200.0);
    CHECK(KWin::activeBorderInnerRect(frame, 0.0) == frame);
}

void positiveGapExpandsInnerRect()
{
    const QRectF frame(10.0, 20.0, 320.0, 200.0);
    const QRectF expanded = KWin::activeBorderInnerRect(frame, 5.0);
    CHECK(expanded == frame.adjusted(-5.0, -5.0, 5.0, 5.0));
    CHECK(expanded.x() == 5.0);
    CHECK(expanded.y() == 15.0);
    CHECK(expanded.width() == 330.0);
    CHECK(expanded.height() == 210.0);
}

void gapAppliesToVisibleBorderState()
{
    const QRectF frame(0.0, 0.0, 100.0, 100.0);
    const KWin::ActiveBorderState state = KWin::activeBorderState(true, frame, false, false, false);
    CHECK(state.visible);
    CHECK(KWin::activeBorderInnerRect(state.innerRect, 2.0) == QRectF(-2.0, -2.0, 104.0, 104.0));
}

} // namespace

int main()
{
    eligibleWindowUsesFrameGeometryAsInnerRect();
    missingWindowIsNotVisible();
    deletedWindowIsNotVisible();
    minimizedWindowIsNotVisible();
    fullScreenWindowIsNotVisible();
    invalidThemeColorUsesConfiguredFallback();
    transparentThemeColorUsesConfiguredFallback();
    usableThemeColorWinsOverConfiguredFallback();
    disabledThemeOverrideAlwaysUsesConfiguredFallback();
    zeroGapKeepsFrameAsInnerRect();
    positiveGapExpandsInnerRect();
    gapAppliesToVisibleBorderState();

    if (failures != 0) {
        std::fprintf(stderr, "%d check(s) failed\n", failures);
        return EXIT_FAILURE;
    }
    std::printf("all checks passed\n");
    return EXIT_SUCCESS;
}
