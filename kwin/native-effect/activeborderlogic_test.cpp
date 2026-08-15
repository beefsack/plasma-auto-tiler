#include "activeborderlogic.h"

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

} // namespace

int main()
{
    eligibleWindowUsesFrameGeometryAsInnerRect();
    missingWindowIsNotVisible();
    deletedWindowIsNotVisible();
    minimizedWindowIsNotVisible();
    fullScreenWindowIsNotVisible();

    if (failures != 0) {
        std::fprintf(stderr, "%d check(s) failed\n", failures);
        return EXIT_FAILURE;
    }
    std::printf("all checks passed\n");
    return EXIT_SUCCESS;
}
