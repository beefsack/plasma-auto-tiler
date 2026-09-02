#pragma once

#include <QColor>
#include <QRectF>

namespace KWin
{

inline constexpr double ACTIVE_BORDER_THICKNESS = 3.0;

inline QColor activeBorderColor(const QColor &themeColor, const QColor &fallbackColor)
{
    // A transparent theme brush is not usable for a visible border.
    if (themeColor.isValid() && themeColor.alpha() > 0) {
        return themeColor;
    }
    return fallbackColor;
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
