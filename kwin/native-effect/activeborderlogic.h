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

inline ActiveBorderState activeBorderState(bool hasWindow, const QRectF &frameGeometry, bool deleted, bool minimized, bool fullScreen, bool maximized)
{
    if (!hasWindow || deleted || minimized || fullScreen || maximized) {
        return {false, QRectF()};
    }
    return {true, frameGeometry};
}

// Hide-until-confirmed initial gate for both native borders. The script must
// confirm the exact current active window is normal (maximize_mode 0); an
// unknown startup, unavailable endpoint, fullscreen, or any native maximize
// keeps both borders hidden even when a delayed script zero is on record.
inline bool activeBorderInitialGate(bool confirmedNormal, bool fullScreen, bool nativeMaximized, bool endpointUsable)
{
    return confirmedNormal && !fullScreen && !nativeMaximized && endpointUsable;
}

} // namespace KWin
