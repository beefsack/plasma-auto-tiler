#include "activewindowborder.h"
#include "activeborderlogic.h"

#include <effect/effecthandler.h>
#include <scene/workspacescene.h>

#include <QColor>

namespace KWin
{

ActiveWindowBorderEffect::ActiveWindowBorderEffect()
    : m_isOpenGL(effects->isOpenGLCompositing())
    , m_borderItem(RectF(), BorderOutline(ACTIVE_BORDER_THICKNESS, QColor(0x2a, 0x82, 0xda), BorderRadius()))
{
    if (!m_isOpenGL) {
        return;
    }

    m_borderItem.setParentItem(effects->scene()->overlayItem());

    connect(effects, &EffectsHandler::windowActivated, this, [this](EffectWindow *) {
        setTrackedWindow(effects->activeWindow());
        updateBorder();
    });
    connect(effects, &EffectsHandler::windowDeleted, this, [this](EffectWindow *window) {
        if (m_trackedWindow == window) {
            setTrackedWindow(nullptr);
            updateBorder();
        }
    });

    setTrackedWindow(effects->activeWindow());
    updateBorder();
}

void ActiveWindowBorderEffect::setTrackedWindow(EffectWindow *window)
{
    if (m_trackedWindow == window) {
        return;
    }
    if (m_trackedWindow) {
        disconnect(m_trackedWindow, nullptr, this, nullptr);
    }
    m_trackedWindow = window;
    if (m_trackedWindow) {
        connect(m_trackedWindow, &EffectWindow::windowFrameGeometryChanged, this, &ActiveWindowBorderEffect::updateBorder);
        connect(m_trackedWindow, &EffectWindow::minimizedChanged, this, &ActiveWindowBorderEffect::updateBorder);
        connect(m_trackedWindow, &EffectWindow::windowFullScreenChanged, this, &ActiveWindowBorderEffect::updateBorder);
    }
}

void ActiveWindowBorderEffect::updateBorder()
{
    if (!m_isOpenGL) {
        return;
    }

    EffectWindow *window = effects->activeWindow();
    const ActiveBorderState state = activeBorderState(
        window != nullptr,
        window ? static_cast<QRectF>(window->frameGeometry()) : QRectF(),
        window ? window->isDeleted() : false,
        window ? window->isMinimized() : false,
        window ? window->isFullScreen() : false);
    m_borderItem.setInnerRect(state.innerRect);
    m_borderItem.setVisible(state.visible);
    effects->addRepaintFull();
}

void ActiveWindowBorderEffect::paintScreen(const RenderTarget &renderTarget, const RenderViewport &viewport, int mask, const Region &deviceRegion, LogicalOutput *screen)
{
    effects->paintScreen(renderTarget, viewport, mask, deviceRegion, screen);
}

KWIN_EFFECT_FACTORY(ActiveWindowBorderEffect, "metadata.json")

} // namespace KWin

#include "activewindowborder.moc"
