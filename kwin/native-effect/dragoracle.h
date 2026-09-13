#pragma once
#include <effect/effect.h>
#include <effect/effectwindow.h>
#include <QHash>
#include <QObject>
#include <QRect>
namespace KWin {
class DragOracleEffect : public Effect {
    Q_OBJECT
public:
    DragOracleEffect();
    ~DragOracleEffect() override;
    bool isActive() const override { return false; }
private:
    void attachWindow(EffectWindow *window);
    void forgetWindow(EffectWindow *window);
    void onDragStart(EffectWindow *window);
    void onDragFinish(EffectWindow *window);
    QHash<EffectWindow *, QRect> m_startRects; QObject *m_dbusObject = nullptr;
};
}
