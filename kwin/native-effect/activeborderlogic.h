#pragma once

#include <QColor>
#include <QRectF>

namespace KWin
{

inline constexpr double ACTIVE_BORDER_THICKNESS = 3.0;

inline QColor activeBorderColor(const QColor &themeColor, const QColor &fallbackColor, bool useThemeColor)
{
    // A transparent theme brush is not usable for a visible border.
    if (useThemeColor && themeColor.isValid() && themeColor.alpha() > 0) {
        return themeColor;
    }
    return fallbackColor;
}

inline QRectF activeBorderInnerRect(const QRectF &frameGeometry, double gap)
{
    return frameGeometry.adjusted(-gap, -gap, gap, gap);
}

struct ActiveBorderState
{
    bool visible;
    QRectF innerRect;
};

inline bool activeBorderIsMaximized(bool horizontal, bool vertical)
{
    return horizontal || vertical;
}

// Direct-read observation seed from the native committed maximizeMode()
// (KWin::MaximizeMode: 0 restore, 1 vertical, 2 horizontal, 3 full). Any
// nonzero axis suppresses both borders; fullscreen stays suppressed
// independently via the live isFullScreen() observation. No script handoff,
// no epoch, no polling.
inline bool activeBorderSeedMaximized(int maximizeMode)
{
    return maximizeMode != 0;
}

inline ActiveBorderState activeBorderState(bool hasWindow, const QRectF &frameGeometry, bool deleted, bool minimized, bool fullScreen, bool maximized)
{
    if (!hasWindow || deleted || minimized || fullScreen || maximized) {
        return {false, QRectF()};
    }
    return {true, frameGeometry};
}

} // namespace KWin
