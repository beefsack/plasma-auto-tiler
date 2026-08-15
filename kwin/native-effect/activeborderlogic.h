#pragma once

#include <QRectF>

namespace KWin
{

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
