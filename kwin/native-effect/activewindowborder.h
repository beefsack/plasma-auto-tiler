#pragma once

#include "group_highlight_ffi.h"

#include <effect/effect.h>
#include <effect/effectwindow.h>
#include <scene/outlinedborderitem.h>

#include <QPointF>
#include <QPointer>
#include <QRectF>
#include <QSet>
#include <QString>

namespace KWin
{

class ActiveWindowBorderEffect : public Effect
{
    Q_OBJECT

public:
    ActiveWindowBorderEffect();
    ~ActiveWindowBorderEffect() override;

    void applyGroupHighlight(const QString &payload);
    void clearGroupHighlight();
    QString groupHighlightStatus() const;

private:
    void reconfigure(ReconfigureFlags flags) override;
    void setTrackedWindow(EffectWindow *window);
    void updateMaximizedState(EffectWindow *window, bool maximized);
    void updateBorder();
    void updateOutline();
    void paintScreen(const RenderTarget &renderTarget, const RenderViewport &viewport, int mask, const Region &deviceRegion, LogicalOutput *screen) override;
    void updateGroupVisibility();
    void onMouseChanged(const QPointF &pos, const QPointF &oldPos, Qt::MouseButtons buttons, Qt::MouseButtons oldButtons,
        Qt::KeyboardModifiers modifiers, Qt::KeyboardModifiers oldModifiers);
    bool isGroupFocusEligible() const;

    const bool m_isOpenGL;
    OutlinedBorderItem m_borderItem;
    OutlinedBorderItem m_groupItem;
    QPointer<EffectWindow> m_trackedWindow;
    QSet<EffectWindow *> m_maximizedWindows;
    QObject *m_groupDbusObject = nullptr;
    // Pure group policy state lives in the std-only Rust staticlib; C++
    // holds it by value and forwards QString-to-UTF8 bytes plus POD
    // observer flags. Rendering reads the POD rect back out.
    GroupHighlightState m_groupState{};
    bool m_groupVisible = false;
    bool m_metaHeld = false;
    bool m_firstMouseSeen = false;
    bool m_groupDbusAvailable = false;
};

} // namespace KWin
