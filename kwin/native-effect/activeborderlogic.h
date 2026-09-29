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

inline ActiveBorderState activeBorderState(bool hasWindow, const QRectF &frameGeometry, bool deleted, bool minimized, bool fullScreen, bool maximized,
    bool appletPopup)
{
    if (!hasWindow || deleted || minimized || fullScreen || maximized || appletPopup) {
        return {false, QRectF()};
    }
    return {true, frameGeometry};
}

// Independent drag-target preview policy (screen-space, window-agnostic):
// valid only for carried-geometry bounds (x/y in -16384..16384,
// w/h in 1..16384, matching the group-highlight carried bound). Invalid
// rects fail closed (never display). Visibility is solely "set versus
// explicitly cleared": never gated on Meta, focus, or the group outline.
inline bool dragPreviewRectValid(int x, int y, int w, int h)
{
    constexpr int coordBound = 16384;
    if (w < 1 || h < 1 || w > coordBound || h > coordBound) {
        return false;
    }
    return x >= -coordBound && x <= coordBound && y >= -coordBound && y <= coordBound;
}

// Group underlay extension default: sentinel -1 means "match the current
// configured border width". Explicit values (including 0) render as-is.
inline double groupUnderlayEffectiveExtension(double extension, double borderWidth)
{
    return extension < 0.0 ? borderWidth : extension;
}

// Group underlay outer geometry: the Rust-carried union bounds expanded by
// the border gap plus the border width plus the resolved extension beyond
// the border outer edge. Pure so the effect remap after re-anchor and
// reconfigure stays testable without KWin.
inline QRectF groupUnderlayOuterRect(const QRectF &unionRect, double gap, double borderWidth, double extension)
{
    const double pad = gap + borderWidth + extension;
    return unionRect.adjusted(-pad, -pad, pad, pad);
}

} // namespace KWin
