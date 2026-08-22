#pragma once

#include <QRectF>

namespace KWin
{

inline constexpr double ACTIVE_BORDER_THICKNESS = 3.0;

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
