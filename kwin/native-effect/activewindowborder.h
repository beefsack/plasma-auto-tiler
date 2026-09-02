#pragma once

#include <effect/effect.h>
#include <effect/effectwindow.h>
#include <scene/outlinedborderitem.h>

#include <QPointer>

namespace KWin
{

class ActiveWindowBorderEffect : public Effect
{
    Q_OBJECT

public:
    ActiveWindowBorderEffect();

private:
    void reconfigure(ReconfigureFlags flags) override;
    void setTrackedWindow(EffectWindow *window);
    void updateBorder();
    void updateOutline();
    void paintScreen(const RenderTarget &renderTarget, const RenderViewport &viewport, int mask, const Region &deviceRegion, LogicalOutput *screen) override;

    const bool m_isOpenGL;
    OutlinedBorderItem m_borderItem;
    QPointer<EffectWindow> m_trackedWindow;
};

} // namespace KWin
