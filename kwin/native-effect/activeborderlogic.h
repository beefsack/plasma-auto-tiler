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

inline ActiveBorderState activeBorderState(bool hasWindow, const QRectF &frameGeometry, bool deleted, bool minimized, bool fullScreen)
{
    if (!hasWindow || deleted || minimized || fullScreen) {
        return {false, QRectF()};
    }
    return {true, frameGeometry};
}

} // namespace KWin
