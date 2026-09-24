#include "activeborderlogic.h"
#include "oraclepress.h"

#include <QColor>
#include <QRectF>

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

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
    const KWin::ActiveBorderState state = KWin::activeBorderState(true, frame, false, false, false, false);
    CHECK(state.visible);
    CHECK(state.innerRect == frame);
}

void missingWindowIsNotVisible()
{
    const QRectF frame(0.0, 0.0, 100.0, 100.0);
    const KWin::ActiveBorderState state = KWin::activeBorderState(false, frame, false, false, false, false);
    CHECK(!state.visible);
    CHECK(state.innerRect == QRectF());
}

void deletedWindowIsNotVisible()
{
    const QRectF frame(0.0, 0.0, 100.0, 100.0);
    const KWin::ActiveBorderState state = KWin::activeBorderState(true, frame, true, false, false, false);
    CHECK(!state.visible);
}

void minimizedWindowIsNotVisible()
{
    const QRectF frame(0.0, 0.0, 100.0, 100.0);
    const KWin::ActiveBorderState state = KWin::activeBorderState(true, frame, false, true, false, false);
    CHECK(!state.visible);
}

void fullScreenWindowIsNotVisible()
{
    const QRectF frame(0.0, 0.0, 1920.0, 1080.0);
    const KWin::ActiveBorderState state = KWin::activeBorderState(true, frame, false, false, true, false);
    CHECK(!state.visible);
}

void maximizedWindowIsNotVisibleAndRestores()
{
    const QRectF frame(0.0, 0.0, 1920.0, 1080.0);
    const KWin::ActiveBorderState maximized = KWin::activeBorderState(true, frame, false, false, false, true);
    const KWin::ActiveBorderState restored = KWin::activeBorderState(true, frame, false, false, false, false);
    CHECK(!maximized.visible);
    CHECK(restored.visible);
    CHECK(restored.innerRect == frame);
}

void partialMaximizeStatesAreMaximized()
{
    CHECK(!KWin::activeBorderIsMaximized(false, false));
    CHECK(KWin::activeBorderIsMaximized(true, false));
    CHECK(KWin::activeBorderIsMaximized(false, true));
    CHECK(KWin::activeBorderIsMaximized(true, true));
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
    const KWin::ActiveBorderState state = KWin::activeBorderState(true, frame, false, false, false, false);
    CHECK(state.visible);
    CHECK(KWin::activeBorderInnerRect(state.innerRect, 2.0) == QRectF(-2.0, -2.0, 104.0, 104.0));
}

void initialGateStartupUnknownStaysHidden()
{
    // No script confirmation yet: both borders hidden even when the native
    // window itself is eligible.
    CHECK(!KWin::activeBorderInitialGate(false, false, false, true));
    CHECK(!KWin::activeBorderInitialGate(false, false, false, false));
}

void initialGateNormalZeroShowsOnlyWhenUsable()
{
    CHECK(KWin::activeBorderInitialGate(true, false, false, true));
    CHECK(!KWin::activeBorderInitialGate(true, false, false, false));
}

void initialGateFullscreenAndAnyMaximizeSuppress()
{
    CHECK(!KWin::activeBorderInitialGate(true, true, false, true));
    // A delayed script zero cannot override a live native maximize signal.
    CHECK(!KWin::activeBorderInitialGate(true, false, true, true));
    CHECK(!KWin::activeBorderInitialGate(true, true, true, true));
}

void pressResizeBindingMapsSlotsInOrder()
{
    // Options::MouseUnrestrictedResize value is opaque here; the seam takes
    // it as a plain int so no KWin headers are needed.
    constexpr int resize = 14;
    CHECK(KWin::oracleResizeButton(resize, 0, 0, resize) == Qt::LeftButton);
    CHECK(KWin::oracleResizeButton(0, resize, 0, resize) == Qt::MiddleButton);
    CHECK(KWin::oracleResizeButton(0, 0, resize, resize) == Qt::RightButton);
    CHECK(KWin::oracleResizeButton(0, 0, 0, resize) == Qt::NoButton);
    CHECK(KWin::oracleResizeButton(1, 2, 3, resize) == Qt::NoButton);
    // First slot carrying the resize command wins.
    CHECK(KWin::oracleResizeButton(resize, resize, resize, resize) == Qt::LeftButton);
}

void pressDefaultBindingIsAltRight()
{
    // Verified against Options::defaultCommandAll3() (MouseUnrestrictedResize)
    // and Options::defaultKeyCmdAllModKey() (Key_Alt): fallback only while
    // the public options are unavailable.
    CHECK(KWin::oracleDefaultResizeButton() == Qt::RightButton);
    CHECK(KWin::oracleDefaultResizeModifier() == Qt::AltModifier);
}

void pressAgeGateBoundsTwoSecondsMonotonic()
{
    CHECK(KWin::oraclePressAgeOk(0));
    CHECK(KWin::oraclePressAgeOk(2000));
    CHECK(!KWin::oraclePressAgeOk(2001));
    CHECK(!KWin::oraclePressAgeOk(-1));
    CHECK(!KWin::oraclePressAgeOk(INT64_C(1000000)));
}

void pressBindingNameIsClosedVocabulary()
{
    CHECK(std::strcmp(KWin::oraclePressBindingName(true), "configured") == 0);
    CHECK(std::strcmp(KWin::oraclePressBindingName(false), "default") == 0);
}

} // namespace

int main()
{
    eligibleWindowUsesFrameGeometryAsInnerRect();
    missingWindowIsNotVisible();
    deletedWindowIsNotVisible();
    minimizedWindowIsNotVisible();
    fullScreenWindowIsNotVisible();
    maximizedWindowIsNotVisibleAndRestores();
    partialMaximizeStatesAreMaximized();
    invalidThemeColorUsesConfiguredFallback();
    transparentThemeColorUsesConfiguredFallback();
    usableThemeColorWinsOverConfiguredFallback();
    disabledThemeOverrideAlwaysUsesConfiguredFallback();
    zeroGapKeepsFrameAsInnerRect();
    positiveGapExpandsInnerRect();
    gapAppliesToVisibleBorderState();
    initialGateStartupUnknownStaysHidden();
    initialGateNormalZeroShowsOnlyWhenUsable();
    initialGateFullscreenAndAnyMaximizeSuppress();
    pressResizeBindingMapsSlotsInOrder();
    pressDefaultBindingIsAltRight();
    pressAgeGateBoundsTwoSecondsMonotonic();
    pressBindingNameIsClosedVocabulary();

    if (failures != 0) {
        std::fprintf(stderr, "%d check(s) failed\n", failures);
        return EXIT_FAILURE;
    }
    std::printf("all checks passed\n");
    return EXIT_SUCCESS;
}
