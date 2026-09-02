#include "activewindowborder.h"
#include "activeborderconfig.h"
#include "activeborderlogic.h"

#include <KColorScheme>
#include <KSharedConfig>

#include <effect/effecthandler.h>
#include <scene/workspacescene.h>

#include <QColor>
#include <QPalette>

namespace KWin
{

ActiveWindowBorderEffect::ActiveWindowBorderEffect()
    : m_isOpenGL(effects->isOpenGLCompositing())
    , m_borderItem(RectF(), BorderOutline())
{
    ActiveBorderConfig::instance(QStringLiteral("kwinrc"));
    updateOutline();

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

void ActiveWindowBorderEffect::reconfigure(ReconfigureFlags)
{
    ActiveBorderConfig::self()->read();
    updateOutline();
    updateBorder();
}

void ActiveWindowBorderEffect::updateOutline()
{
    const QColor fallback = ActiveBorderConfig::borderColor();
    const KSharedConfigPtr colorConfig = KSharedConfig::openConfig(QStringLiteral("kdeglobals"));
    const QColor themeColor = KColorScheme::isColorSetSupported(colorConfig, KColorScheme::Selection)
        ? KColorScheme(QPalette::Active, KColorScheme::Selection, colorConfig).background().color()
        : QColor();
    m_borderItem.setOutline(BorderOutline(
        ActiveBorderConfig::borderWidth(),
        activeBorderColor(themeColor, fallback),
        BorderRadius(ActiveBorderConfig::borderRadius())));
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
    const qreal gap = ActiveBorderConfig::borderGap();
    m_borderItem.setInnerRect(state.innerRect.adjusted(-gap, -gap, gap, gap));
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
