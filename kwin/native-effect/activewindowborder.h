#pragma once

#include "drag_oracle_ffi.h"
#include "group_highlight_ffi.h"

#include <effect/effect.h>
#include <effect/effectwindow.h>
#include <scene/outlinedborderitem.h>

#include <QByteArray>
#include <QHash>
#include <QPointF>
#include <QPointer>
#include <QRect>
#include <QRectF>
#include <QSet>
#include <QString>

#include <chrono>
#include <cstdint>

namespace KWin
{

struct PointerButtonEvent;
class OraclePressSpy;

class ActiveWindowBorderEffect : public Effect
{
    Q_OBJECT

public:
    ActiveWindowBorderEffect();
    ~ActiveWindowBorderEffect() override;

    void applyGroupHighlight(const QString &payload);
    void clearGroupHighlight();
    QString groupHighlightStatus() const;
    void applyInitialMaximizeState(const QString &payload);
    void clearInitialMaximizeState(const QString &payload);
    QString initialMaximizeEpoch() const;

private:
    friend class OraclePressSpy;
    void reconfigure(ReconfigureFlags flags) override;
    void setTrackedWindow(EffectWindow *window);
    void subscribeMaximize(EffectWindow *window);
    void unsubscribeMaximize(EffectWindow *window);
    void attachOracleWindow(EffectWindow *window);
    void forgetOracleWindow(EffectWindow *window);
    void onOracleDragStart(EffectWindow *window);
    void onOracleDragFinish(EffectWindow *window);
    // Passive press capture: a public InputEventSpy observes pointer presses
    // without grabbing or intercepting. A press matching the live configured
    // MouseUnrestrictedResize binding (or the Alt+Right source default while
    // the public options are unavailable) overwrites the single candidate;
    // any other press clears it. At drag start a candidate matching the exact
    // same effect window and identity within the bounded monotonic age moves
    // single-use into the per-window start slot, which the finish handler
    // passes to the verdict atomically. Move-vs-resize is never decided here.
    void noteOraclePointerPress(PointerButtonEvent *event);
    void emitOraclePressDiag(const char *outcome, bool configured);
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
    QSet<EffectWindow *> m_maximizeSubscribed;
    QObject *m_groupDbusObject = nullptr;
    // Drag oracle state: inert read-only
    // observer state only (start rects plus the D-Bus object). The verdict
    // policy lives in the std-only Rust staticlib behind the POD C ABI.
    QObject *m_oracleDbusObject = nullptr;
    QHash<EffectWindow *, QRect> m_oracleStartRects;
    QSet<EffectWindow *> m_oracleAttached;
    // Single overwrite-on-press candidate plus one single-use press slot per
    // window pending between drag start and finish. Coordinates keep full
    // native precision (f64) so script thirds comparisons match exactly.
    struct OraclePressCandidate {
        QPointer<EffectWindow> window;
        QByteArray identity;
        double x = 0.0;
        double y = 0.0;
        bool configured = false;
        bool hasPress = false;
        std::chrono::steady_clock::time_point at{};
    };
    OraclePressCandidate m_oraclePress;
    QHash<EffectWindow *, DragOraclePress> m_oracleStartPress;
    OraclePressSpy *m_oraclePressSpy = nullptr;
    bool m_oraclePressDefaultLogged = false;
    // Pure group policy state lives in the std-only Rust staticlib; C++
    // holds it by value and forwards QString-to-UTF8 bytes plus POD
    // observer flags. Rendering reads the POD rect back out.
    GroupHighlightState m_groupState{};
    // Hide-until-confirmed initial maximize gate, same staticlib pattern.
    // Never mutates m_maximizedWindows: native transition signals stay
    // authoritative and override any delayed script zero. m_initialEpoch is
    // minted once per effect instance; every handoff payload generation must
    // equal it exactly, so an old script generation can never authorize a
    // new effect.
    InitialMaximizeState m_initialState{};
    QString m_initialEpoch;
    void handleInitialPayload(const QString &payload);
    void clearInitialGate();
    bool isInitialConfirmedNormal() const;
    void logActiveBorderDiag(const QString &message);
    void emitActiveBorderEndpoint();
    void emitActiveBorderApply(int32_t code);
    void emitActiveBorderVisible(bool visible, const char *reason);
    bool m_groupVisible = false;
    bool m_metaHeld = false;
    bool m_firstMouseSeen = false;
    bool m_groupDbusAvailable = false;
    // Bounded visibility diagnostic edge state only (two scalars, no ledger):
    // whether the first updateBorder() evaluation was emitted, and the last
    // emitted visibility. updateBorder() emits exactly on first evaluation
    // and then only when computed visibility flips.
    bool m_borderDiagEmitted = false;
    bool m_borderDiagVisible = false;
};

} // namespace KWin
