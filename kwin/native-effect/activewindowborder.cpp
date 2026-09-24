#include "activewindowborder.h"
#include "activeborderconfig.h"
#include "activeborderlogic.h"
#include "drag_oracle_ffi.h"
#include "oraclepress.h"

#include <KColorScheme>
#include <KSharedConfig>

#include <core/inputdevice.h>
#include <effect/effecthandler.h>
#include <input.h>
#include <input_event.h>
#include <input_event_spy.h>
#include <options.h>
#include <scene/workspacescene.h>
#include <scene/windowitem.h>
#include <window.h>

#include <QByteArray>
#include <QColor>
#include <QDBusConnection>
#include <QLoggingCategory>
#include <QPalette>
#include <QUuid>

#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace KWin
{

Q_LOGGING_CATEGORY(lcActiveBorder, "plasmaautotiler.activeborder");

namespace
{

class GroupHighlightObject : public QObject
{
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.plasmaautotiler.ActiveBorder1")

public:
    explicit GroupHighlightObject(ActiveWindowBorderEffect *effect, QObject *parent = nullptr)
        : QObject(parent)
        , m_effect(effect)
    {
    }

public Q_SLOTS:
    Q_SCRIPTABLE void SetGroupHighlight(const QString &payload)
    {
        if (m_effect) {
            m_effect->applyGroupHighlight(payload);
        }
    }
    Q_SCRIPTABLE void ClearGroupHighlight()
    {
        if (m_effect) {
            m_effect->clearGroupHighlight();
        }
    }
    Q_SCRIPTABLE QString GetGroupHighlightStatus()
    {
        return m_effect ? m_effect->groupHighlightStatus() : QStringLiteral("v=1;rx=0;ok=0;parse_rej=0;focus_mm=0;stale=0;clr=0;has=0;ord=0;first=0;meta=0;foc=0;ep=0;gl=0;vis=0");
    }

private:
    ActiveWindowBorderEffect *m_effect = nullptr;
};

class LastVerdictObject : public QObject
{
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.plasmaautotiler.DragOracle1")

public:
    using QObject::QObject;

public Q_SLOTS:
    Q_SCRIPTABLE QString LastVerdict() const
    {
        // Copy the verdict before the D-Bus return so the reply never borrows
        // the oracle's process-static storage across threads or reentrancy.
        // The reply carries the exact existing fields plus, only when a
        // resize-binding press was verified for the same window, an optional
        // bounded "press" object (native f64 position, closed-vocabulary
        // binding token). No second call, service, or object.
        uint8_t copy[1024];
        const size_t taken = drag_oracle_last_copy(copy, sizeof(copy));
        if (taken == 0 || taken > sizeof(copy)) {
            return QStringLiteral("{\"v\":1,\"cancelled\":true,\"finalRect\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1},\"windowIdentity\":\"\",\"correlation\":\"drag-0\",\"reason\":\"oracle-unavailable\"}");
        }
        return QString::fromUtf8(reinterpret_cast<const char *>(copy), static_cast<int>(taken));
    }
};

} // namespace

// Passive press observer at KWin scope (matching the header forward
// declaration): sees every pointer button event before filters but never
// consumes, grabs, or modifies anything. Forwards presses to the effect,
// which matches them against the resize binding and window.
class OraclePressSpy : public InputEventSpy
{
public:
    explicit OraclePressSpy(ActiveWindowBorderEffect *effect)
        : m_effect(effect)
    {
    }

    void pointerButton(PointerButtonEvent *event) override
    {
        if (m_effect != nullptr) {
            m_effect->noteOraclePointerPress(event);
        }
    }

private:
    ActiveWindowBorderEffect *m_effect = nullptr;
};

namespace
{

DragOracleRect toOraclePod(const QRect &rect)
{
    DragOracleRect out{};
    out.x = rect.x();
    out.y = rect.y();
    out.w = rect.width();
    out.h = rect.height();
    return out;
}

QRect quantizedOracleRect(const RectF &geometry)
{
    return QRect(static_cast<int>(std::lround(geometry.x())), static_cast<int>(std::lround(geometry.y())),
        static_cast<int>(std::lround(geometry.width())), static_cast<int>(std::lround(geometry.height())));
}

QRect oracleMoveResizeRect(EffectWindow *window)
{
    if (window == nullptr) {
        return QRect();
    }
    if (Window *inner = window->window()) {
        return quantizedOracleRect(inner->moveResizeGeometry());
    }
    return QRect();
}

// Single fixed reason token for the computed active-border visibility. Order
// matches updateBorder() evaluation so exactly one token distinguishes the
// first suppressing gate: endpoint, window presence, deleted, minimized,
// fullscreen, then maximized.
const char *activeBorderDiagReason(bool hasWindow, bool deleted, bool minimized, bool fullScreen, bool nativeMaximized,
    bool dbusAvailable)
{
    if (!dbusAvailable) {
        return "endpoint-unavailable";
    }
    if (!hasWindow) {
        return "no-window";
    }
    if (deleted) {
        return "deleted";
    }
    if (minimized) {
        return "minimized";
    }
    if (fullScreen) {
        return "fullscreen";
    }
    if (nativeMaximized) {
        return "maximized";
    }
    return "eligible";
}

} // namespace

ActiveWindowBorderEffect::ActiveWindowBorderEffect()
    : m_isOpenGL(effects->isOpenGLCompositing())
    , m_borderItem(RectF(), BorderOutline())
    , m_groupItem(RectF(), BorderOutline())
{
    ActiveBorderConfig::instance(QStringLiteral("kwinrc"));
    updateOutline();

    m_groupDbusObject = new GroupHighlightObject(this, this);
    group_highlight_state_init(&m_groupState);
    // Fail closed with no false endpoint expectation and no live retry: the
    // group stays unavailable/clear unless both the well-known service and
    // object register. Visibility and apply paths gate on this flag.
    bool groupRegistered = false;
    QDBusConnection bus = QDBusConnection::sessionBus();
    if (bus.isConnected()) {
        const bool serviceOk = bus.registerService(QStringLiteral("org.plasmaautotiler.ActiveBorder"));
        const bool objectOk = bus.registerObject(
            QStringLiteral("/org/plasmaautotiler/ActiveBorder"), m_groupDbusObject, QDBusConnection::ExportScriptableContents);
        groupRegistered = serviceOk && objectOk;
        if (!groupRegistered) {
            bus.unregisterObject(QStringLiteral("/org/plasmaautotiler/ActiveBorder"));
            bus.unregisterService(QStringLiteral("org.plasmaautotiler.ActiveBorder"));
        }
    }
    m_groupDbusAvailable = groupRegistered;
    if (!m_groupDbusAvailable) {
        group_highlight_clear(&m_groupState);
    }
    // Transition diagnostic only: endpoint availability once, after
    // registration. Never affects gate, visibility, or repaint decisions.
    emitActiveBorderEndpoint();

    // Drag oracle endpoint: registered independently of the
    // ActiveBorder endpoint outcome, so one registration failure never hides
    // the other service. No retry, no polling.
    m_oracleDbusObject = new LastVerdictObject(this);
    if (bus.isConnected()) {
        const bool oracleServiceOk = bus.registerService(QStringLiteral("org.plasmaautotiler.DragOracle"));
        const bool oracleObjectOk = bus.registerObject(QStringLiteral("/org/plasmaautotiler/DragOracle"), m_oracleDbusObject,
            QDBusConnection::ExportScriptableContents);
        if (!(oracleServiceOk && oracleObjectOk)) {
            bus.unregisterObject(QStringLiteral("/org/plasmaautotiler/DragOracle"));
            bus.unregisterService(QStringLiteral("org.plasmaautotiler.DragOracle"));
        }
    }

    // Passive press capture for the drag oracle: a public InputEventSpy
    // observes pointer presses without grabbing or intercepting. Fail closed
    // when input redirection is unavailable: drags then simply carry no press
    // evidence and the existing verdict contract is unchanged. Deleting the
    // spy uninstalls it automatically; the destructor deletes it explicitly.
    m_oraclePressSpy = new OraclePressSpy(this);
    if (input() != nullptr) {
        input()->installInputEventSpy(m_oraclePressSpy);
    } else {
        delete m_oraclePressSpy;
        m_oraclePressSpy = nullptr;
        logActiveBorderDiag(QStringLiteral("plasma-auto-tiler:drag-oracle:press-spy available=0"));
    }

    // Oracle observation is independent of rendering. Keep this one shared
    // lifecycle hookup set active even when the border cannot render.
    connect(effects, &EffectsHandler::windowDeleted, this, [this](EffectWindow *window) {
        unsubscribeMaximize(window);
        forgetOracleWindow(window);
        m_maximizedWindows.remove(window);
        if (!m_isOpenGL) {
            return;
        }
        if (m_trackedWindow == window) {
            setTrackedWindow(nullptr);
        }
        updateBorder();
        updateGroupVisibility();
    });
    connect(effects, &EffectsHandler::windowClosed, this, [this](EffectWindow *window) {
        unsubscribeMaximize(window);
        forgetOracleWindow(window);
        m_maximizedWindows.remove(window);
        if (!m_isOpenGL) {
            return;
        }
        updateBorder();
        updateGroupVisibility();
    });
    // Global maximize tracking and the oracle observe every window,
    // including when the active border cannot render. Each observed window
    // seeds its committed maximizeMode() directly: windows already maximized
    // before effect load emit no transition, so the seed is authoritative
    // until native transition signals update it.
    for (EffectWindow *window : effects->stackingOrder()) {
        subscribeMaximize(window);
        attachOracleWindow(window);
    }
    connect(effects, &EffectsHandler::windowAdded, this, [this](EffectWindow *window) {
        subscribeMaximize(window);
        attachOracleWindow(window);
    });

    if (!m_isOpenGL) {
        return;
    }

    // Keep the active outline in the target window subtree so higher windows
    // occlude it normally instead of treating it as a screen-wide overlay.
    m_borderItem.setZ(-1);
    m_groupItem.setParentItem(effects->scene()->overlayItem());
    m_groupItem.setVisible(false);

    connect(effects, &EffectsHandler::windowActivated, this, [this](EffectWindow *) {
        // Focus activation clears the old group immediately before any
        // asynchronous script refresh, so no stale group renders under the
        // new active focus while Meta is held.
        clearGroupHighlight();
        setTrackedWindow(effects->activeWindow());
        updateBorder();
        updateGroupVisibility();
    });
    connect(effects, &EffectsHandler::mouseChanged, this, &ActiveWindowBorderEffect::onMouseChanged);

    setTrackedWindow(effects->activeWindow());
    updateBorder();
    updateGroupVisibility();
}

ActiveWindowBorderEffect::~ActiveWindowBorderEffect()
{
    delete m_oraclePressSpy;
    m_oraclePressSpy = nullptr;
    QDBusConnection bus = QDBusConnection::sessionBus();
    bus.unregisterObject(QStringLiteral("/org/plasmaautotiler/DragOracle"));
    bus.unregisterService(QStringLiteral("org.plasmaautotiler.DragOracle"));
    bus.unregisterObject(QStringLiteral("/org/plasmaautotiler/ActiveBorder"));
    bus.unregisterService(QStringLiteral("org.plasmaautotiler.ActiveBorder"));
}

void ActiveWindowBorderEffect::reconfigure(ReconfigureFlags)
{
    ActiveBorderConfig::self()->read();
    updateOutline();
    updateBorder();
    updateGroupVisibility();
}

void ActiveWindowBorderEffect::updateOutline()
{
    const QColor fallback = ActiveBorderConfig::borderColor();
    const bool useThemeColor = ActiveBorderConfig::useThemeColor();
    QColor themeColor;
    if (useThemeColor) {
        const KSharedConfigPtr colorConfig = KSharedConfig::openConfig(QStringLiteral("kdeglobals"));
        themeColor = KColorScheme::isColorSetSupported(colorConfig, KColorScheme::Selection)
            ? KColorScheme(QPalette::Active, KColorScheme::Selection, colorConfig).background().color()
            : QColor();
    }
    const BorderOutline outline = BorderOutline(
        ActiveBorderConfig::borderWidth(),
        activeBorderColor(themeColor, fallback, useThemeColor),
        BorderRadius(ActiveBorderConfig::borderRadius()));
    m_borderItem.setOutline(outline);
    m_groupItem.setOutline(outline);
}

void ActiveWindowBorderEffect::setTrackedWindow(EffectWindow *window)
{
    if (m_trackedWindow == window) {
        return;
    }
    if (m_trackedWindow) {
        // Disconnect only the tracked-window signals. Global maximize
        // subscriptions stay connected across tracked switches.
        disconnect(m_trackedWindow, &EffectWindow::windowFrameGeometryChanged, this,
            &ActiveWindowBorderEffect::updateBorder);
        disconnect(m_trackedWindow, &EffectWindow::minimizedChanged, this, &ActiveWindowBorderEffect::updateBorder);
        disconnect(m_trackedWindow, &EffectWindow::windowFullScreenChanged, this,
            &ActiveWindowBorderEffect::updateBorder);
        disconnect(m_trackedWindow, &EffectWindow::minimizedChanged, this,
            &ActiveWindowBorderEffect::updateGroupVisibility);
        disconnect(m_trackedWindow, &EffectWindow::windowFullScreenChanged, this,
            &ActiveWindowBorderEffect::updateGroupVisibility);
    }
    m_trackedWindow = window;
    if (m_trackedWindow) {
        m_borderItem.setParentItem(m_trackedWindow->windowItem());
        connect(m_trackedWindow, &EffectWindow::windowFrameGeometryChanged, this, &ActiveWindowBorderEffect::updateBorder);
        connect(m_trackedWindow, &EffectWindow::minimizedChanged, this, &ActiveWindowBorderEffect::updateBorder);
        connect(m_trackedWindow, &EffectWindow::windowFullScreenChanged, this, &ActiveWindowBorderEffect::updateBorder);
        // Own active tracked signals update group visibility immediately so
        // fullscreen/minimized transitions hide while Meta is held without
        // waiting for pointer movement. Allowed effect conventions only: no
        // polling, timers, interception, or extra rendering.
        connect(m_trackedWindow, &EffectWindow::minimizedChanged, this, &ActiveWindowBorderEffect::updateGroupVisibility);
        connect(m_trackedWindow, &EffectWindow::windowFullScreenChanged, this, &ActiveWindowBorderEffect::updateGroupVisibility);
    } else {
        m_borderItem.setParentItem(effects->scene()->overlayItem());
    }
}

void ActiveWindowBorderEffect::subscribeMaximize(EffectWindow *window)
{
    if (window == nullptr || m_maximizeSubscribed.contains(window)) {
        return;
    }
    m_maximizeSubscribed.insert(window);
    connect(window, &EffectWindow::windowMaximizedStateAboutToChange, this,
        [this](EffectWindow *changed, bool horizontal, bool vertical) {
            // KWin supplies the target state before geometry changes. Hide
            // before entering maximize, but defer restoration until the
            // changed signal so the border uses the restored frame.
            if (activeBorderIsMaximized(horizontal, vertical)) {
                updateMaximizedState(changed, true);
            }
        });
    connect(window, &EffectWindow::windowMaximizedStateChanged, this,
        [this](EffectWindow *changed, bool horizontal, bool vertical) {
            updateMaximizedState(changed, activeBorderIsMaximized(horizontal, vertical));
        });
    // Direct-read seed from the native committed maximizeMode(): until a
    // Wayland client acknowledges its maximize configure it stays rendered
    // at normal geometry. Acknowledgement updates committed mode through the
    // changed signal; about-to-change can still hide earlier on a request.
    // A null inner window seeds normal.
    // Native transition signals stay authoritative after this seed.
    bool seededMaximized = false;
    try {
        if (Window *inner = window->window()) {
            seededMaximized = activeBorderSeedMaximized(static_cast<int>(inner->maximizeMode()));
        }
    } catch (...) {
        seededMaximized = false;
    }
    if (seededMaximized) {
        m_maximizedWindows.insert(window);
    } else {
        m_maximizedWindows.remove(window);
    }
    bool seedFullScreen = false;
    try {
        seedFullScreen = window->isFullScreen();
    } catch (...) {
        seedFullScreen = false;
    }
    // Bounded per-window observation seed log: two scalars only, no native
    // identifiers, geometry, or payload.
    try {
        logActiveBorderDiag(QStringLiteral("plasma-auto-tiler:active-border:observe-seed maximized=%1 fullscreen=%2")
                .arg(seededMaximized ? 1 : 0)
                .arg(seedFullScreen ? 1 : 0));
    } catch (...) {
    }
}

void ActiveWindowBorderEffect::unsubscribeMaximize(EffectWindow *window)
{
    if (window == nullptr || !m_maximizeSubscribed.remove(window)) {
        return;
    }
    disconnect(window, &EffectWindow::windowMaximizedStateAboutToChange, this, nullptr);
    disconnect(window, &EffectWindow::windowMaximizedStateChanged, this, nullptr);
}

void ActiveWindowBorderEffect::attachOracleWindow(EffectWindow *window)
{
    if (window == nullptr || m_oracleAttached.contains(window)) {
        return;
    }
    m_oracleAttached.insert(window);
    connect(window, &EffectWindow::windowStartUserMovedResized, this, [this](EffectWindow *moved) {
        onOracleDragStart(moved);
    });
    connect(window, &EffectWindow::windowFinishUserMovedResized, this, [this](EffectWindow *moved) {
        onOracleDragFinish(moved);
    });
}

void ActiveWindowBorderEffect::forgetOracleWindow(EffectWindow *window)
{
    if (window == nullptr) {
        return;
    }
    m_oracleStartRects.remove(window);
    m_oracleStartPress.remove(window);
    if (m_oraclePress.window == window) {
        m_oraclePress = OraclePressCandidate{};
    }
    m_oracleAttached.remove(window);
}

void ActiveWindowBorderEffect::emitOraclePressDiag(const char *outcome, bool configured)
{
    // Redacted transition diagnostic only: outcome plus the closed-vocabulary
    // binding source. Never carries coordinates, identities, or geometry.
    try {
        logActiveBorderDiag(QStringLiteral("plasma-auto-tiler:drag-oracle:press outcome=%1 binding=%2")
                .arg(QString::fromUtf8(outcome))
                .arg(QString::fromUtf8(oraclePressBindingName(configured))));
    } catch (...) {
    }
}

void ActiveWindowBorderEffect::noteOraclePointerPress(PointerButtonEvent *event)
{
    // Passive observer only: the event is never consumed, grabbed, filtered,
    // or modified. Only press edges can start a candidate; every other event
    // leaves the current candidate untouched.
    if (event == nullptr || event->state != PointerButtonState::Pressed) {
        return;
    }
    // Single overwrite-on-press candidate: each press replaces the previous
    // one, so at most one press is ever pending.
    m_oraclePress = OraclePressCandidate{};
    if (!std::isfinite(event->position.x()) || !std::isfinite(event->position.y())) {
        return;
    }
    // Identify the actual configured MouseUnrestrictedResize binding. While
    // the public options are unavailable, fall back to the verified source
    // default (Alt+RightButton) and log that default once per effect
    // instance. A missing resize slot fails closed with no candidate.
    Qt::MouseButton resizeButton = oracleDefaultResizeButton();
    Qt::KeyboardModifier resizeModifier = oracleDefaultResizeModifier();
    bool configured = false;
    if (options != nullptr) {
        resizeButton = oracleResizeButton(static_cast<int>(options->commandAll1()), static_cast<int>(options->commandAll2()),
            static_cast<int>(options->commandAll3()), static_cast<int>(Options::MouseUnrestrictedResize));
        resizeModifier = options->commandAllModifier();
        configured = true;
    } else if (!m_oraclePressDefaultLogged) {
        m_oraclePressDefaultLogged = true;
        emitOraclePressDiag("default-binding", false);
    }
    if (resizeButton == Qt::NoButton || event->button != resizeButton || !event->modifiers.testFlag(resizeModifier)) {
        return;
    }
    InputRedirection *redir = input();
    if (redir == nullptr) {
        return;
    }
    Window *top = redir->findToplevel(event->position);
    if (top == nullptr || top->isDeleted()) {
        return;
    }
    // Associate the toplevel with its effect window through the public
    // internal-id lookup, then verify the exact same live window object.
    EffectWindow *found = effects->findWindow(top->internalId());
    if (found == nullptr || found->isDeleted() || found->window() != top) {
        return;
    }
    OraclePressCandidate next;
    next.window = found;
    next.identity = found->internalId().toString(QUuid::WithoutBraces).toUtf8();
    next.x = event->position.x();
    next.y = event->position.y();
    next.configured = configured;
    next.hasPress = true;
    next.at = std::chrono::steady_clock::now();
    m_oraclePress = next;
    emitOraclePressDiag("captured", configured);
}

void ActiveWindowBorderEffect::onOracleDragStart(EffectWindow *window)
{
    if (window == nullptr || window->isDeleted()) {
        return;
    }
    m_oracleStartRects.insert(window, oracleMoveResizeRect(window));
    // A repeated start supersedes any prior unconsumed slot for this window:
    // drop it before evaluating the candidate so a stale slot can never leak
    // into a later finish. A stale candidate likewise drops on any start via
    // the exact freshness match below instead of lingering for an unrelated
    // later window start; only a fresh candidate for another window stays
    // pending (bounded by age and overwrite-on-press).
    m_oracleStartPress.remove(window);
    // Single-use press evidence: a candidate for the exact same effect window
    // and identity within the bounded monotonic age moves into this window's
    // start slot. Stale or orphaned candidates drop; a candidate for another
    // window stays pending (bounded by age and overwrite-on-press). Whether
    // this drag is a move or a resize is not decided here: the matched press
    // is recorded and the script adapter gates on its own start.resize.
    if (m_oraclePress.hasPress) {
        const auto now = std::chrono::steady_clock::now();
        const int64_t ageMs =
            std::chrono::duration_cast<std::chrono::milliseconds>(now - m_oraclePress.at).count();
        const QByteArray identity = window->internalId().toString(QUuid::WithoutBraces).toUtf8();
        if (m_oraclePress.window.isNull() || !oraclePressAgeOk(ageMs)) {
            const bool wasConfigured = m_oraclePress.configured;
            m_oraclePress = OraclePressCandidate{};
            emitOraclePressDiag("stale", wasConfigured);
        } else if (m_oraclePress.window == window && m_oraclePress.identity == identity) {
            DragOraclePress pod{};
            pod.hasPress = 1;
            pod.binding = m_oraclePress.configured ? 1 : 0;
            pod.x = m_oraclePress.x;
            pod.y = m_oraclePress.y;
            m_oracleStartPress.insert(window, pod);
            const bool wasConfigured = m_oraclePress.configured;
            m_oraclePress = OraclePressCandidate{};
            emitOraclePressDiag("attached", wasConfigured);
        }
    }
}

void ActiveWindowBorderEffect::onOracleDragFinish(EffectWindow *window)
{
    if (window == nullptr || window->isDeleted()) {
        return;
    }
    const QRect finalRect = oracleMoveResizeRect(window);
    const QRect startRect = m_oracleStartRects.take(window);
    // Single-use: the start slot is consumed with this verdict, so the press
    // evidence correlates atomically with the final verdict in one reply.
    const DragOraclePress press = m_oracleStartPress.take(window);
    const QByteArray identity = window->internalId().toString(QUuid::WithoutBraces).toUtf8();
    drag_oracle_record(toOraclePod(startRect), toOraclePod(finalRect), reinterpret_cast<const uint8_t *>(identity.constData()),
        static_cast<size_t>(identity.size()), press);
}

void ActiveWindowBorderEffect::updateMaximizedState(EffectWindow *window, bool maximized)
{
    if (window == nullptr) {
        return;
    }
    if (maximized) {
        m_maximizedWindows.insert(window);
    } else {
        m_maximizedWindows.remove(window);
    }
    if (m_trackedWindow == window) {
        updateBorder();
        // A displayed Meta-held group must hide immediately on entering
        // maximize and may only return after the restore transition; the
        // focus-eligibility gate above keeps a maximized-before-Meta window
        // from ever showing it.
        updateGroupVisibility();
    }
}

void ActiveWindowBorderEffect::logActiveBorderDiag(const QString &message)
{
    // Diagnostic path only: swallow every failure and never branch caller
    // behavior on logging. Bounded fixed-token message built by callers.
    try {
        qCInfo(lcActiveBorder).noquote() << message;
    } catch (...) {
    }
}

void ActiveWindowBorderEffect::emitActiveBorderEndpoint()
{
    try {
        logActiveBorderDiag(QStringLiteral("plasma-auto-tiler:active-border:endpoint available=%1")
                .arg(m_groupDbusAvailable ? 1 : 0));
    } catch (...) {
    }
}

void ActiveWindowBorderEffect::emitActiveBorderVisible(bool visible, const char *reason)
{
    // Edge only: first evaluation plus visibility flips. Two scalars, no ledger.
    try {
        if (m_borderDiagEmitted && visible == m_borderDiagVisible) {
            return;
        }
        m_borderDiagEmitted = true;
        m_borderDiagVisible = visible;
        logActiveBorderDiag(QStringLiteral("plasma-auto-tiler:active-border:visible vis=%1 reason=%2")
                .arg(visible ? 1 : 0)
                .arg(QString::fromUtf8(reason)));
    } catch (...) {
    }
}

void ActiveWindowBorderEffect::updateBorder()
{
    if (!m_isOpenGL) {
        return;
    }

    EffectWindow *window = effects->activeWindow();
    const bool nativeMaximized = window ? m_maximizedWindows.contains(window) : false;
    const bool fullScreen = window ? window->isFullScreen() : false;
    const ActiveBorderState state = activeBorderState(
        window != nullptr,
        window ? static_cast<QRectF>(window->frameGeometry()) : QRectF(),
        window ? window->isDeleted() : false,
        window ? window->isMinimized() : false,
        fullScreen,
        nativeMaximized);
    // Native maximize/fullscreen signals stay authoritative: any seeded or
    // transitioned maximize axis plus live fullscreen suppresses the border.
    const bool visible = state.visible;
    // Transition diagnostic only: first evaluation plus visibility flips.
    // Never affects the border or repaint decision below.
    emitActiveBorderVisible(visible,
        activeBorderDiagReason(window != nullptr, window ? window->isDeleted() : false, window ? window->isMinimized() : false,
            fullScreen, nativeMaximized, m_groupDbusAvailable));
    const qreal gap = ActiveBorderConfig::borderGap();
    const QRectF innerRect = activeBorderInnerRect(state.innerRect, gap);
    m_borderItem.setInnerRect(window ? window->windowItem()->mapFromScene(innerRect) : RectF());
    m_borderItem.setVisible(visible);
    effects->addRepaintFull();
}

void ActiveWindowBorderEffect::applyGroupHighlight(const QString &payload)
{
    // Unavailable endpoint never displays: fail closed.
    if (!m_groupDbusAvailable) {
        clearGroupHighlight();
        return;
    }
    // QObject/D-Bus boundary: QString payload and native active identity to
    // UTF-8 bytes. All parsing, ordering, and focus policy lives in Rust.
    const QByteArray payloadBytes = payload.toUtf8();
    EffectWindow *active = effects->activeWindow();
    QByteArray activeBytes;
    if (active != nullptr) {
        activeBytes = active->internalId().toString(QUuid::WithoutBraces).toUtf8();
    }
    const bool hadDisplayed = m_groupState.has_group != 0;
    const uint8_t *payloadPtr = payloadBytes.isEmpty() ? nullptr : reinterpret_cast<const uint8_t *>(payloadBytes.constData());
    const uint8_t *activePtr = activeBytes.isEmpty() ? nullptr : reinterpret_cast<const uint8_t *>(activeBytes.constData());
    const int32_t code = group_highlight_apply(&m_groupState, payloadPtr, static_cast<size_t>(payloadBytes.size()), activePtr,
        static_cast<size_t>(activeBytes.size()));
    if (code == 2) {
        // Stale/out-of-order versus the newer displayed highlight is ignored
        // without destroying it.
        return;
    }
    if (code == 1) {
        GroupHighlightRect rect{};
        if (group_highlight_rect(&m_groupState, &rect) == 1 && m_isOpenGL) {
            const qreal gap = ActiveBorderConfig::borderGap();
            m_groupItem.setInnerRect(activeBorderInnerRect(QRectF(static_cast<qreal>(rect.x), static_cast<qreal>(rect.y),
                static_cast<qreal>(rect.w), static_cast<qreal>(rect.h)), gap));
        }
        updateGroupVisibility();
        if (m_isOpenGL) {
            effects->addRepaintFull();
        }
        return;
    }
    updateGroupVisibility();
    if (hadDisplayed && m_isOpenGL) {
        effects->addRepaintFull();
    }
}

void ActiveWindowBorderEffect::clearGroupHighlight()
{
    // Rust preserves the order within the stream; only the display clears.
    const int32_t hadGroup = group_highlight_clear(&m_groupState);
    updateGroupVisibility();
    if (hadGroup == 1 && m_isOpenGL) {
        effects->addRepaintFull();
    }
}

QString ActiveWindowBorderEffect::groupHighlightStatus() const
{
    GroupHighlightStatus status{};
    if (group_highlight_status(&m_groupState, &status) != 0) {
        status = GroupHighlightStatus{};
    }
    const bool focusEligible = isGroupFocusEligible();
    return QStringLiteral("v=1;rx=%1;ok=%2;parse_rej=%3;focus_mm=%4;stale=%5;clr=%6;has=%7;ord=%8;first=%9;meta=%10;foc=%11;ep=%12;gl=%13;vis=%14")
        .arg(QString::number(status.receipts))
        .arg(QString::number(status.accepted))
        .arg(QString::number(status.parse_rejected))
        .arg(QString::number(status.focus_mismatch))
        .arg(QString::number(status.stale_ignored))
        .arg(QString::number(status.clear_requests))
        .arg(status.has_group != 0 ? 1 : 0)
        .arg(status.order_initialized != 0 ? 1 : 0)
        .arg(m_firstMouseSeen ? 1 : 0)
        .arg(m_metaHeld ? 1 : 0)
        .arg(focusEligible ? 1 : 0)
        .arg(m_groupDbusAvailable ? 1 : 0)
        .arg(m_isOpenGL ? 1 : 0)
        .arg(m_groupVisible ? 1 : 0);
}

bool ActiveWindowBorderEffect::isGroupFocusEligible() const
{
    EffectWindow *window = effects->activeWindow();
    if (window == nullptr) {
        return false;
    }
    return group_highlight_focus_eligible(1, window->isDeleted() ? 1 : 0, window->isMinimized() ? 1 : 0,
               window->isFullScreen() ? 1 : 0, window->isHidden() ? 1 : 0,
               m_maximizedWindows.contains(window) ? 1 : 0)
        != 0;
}

void ActiveWindowBorderEffect::onMouseChanged(const QPointF &pos, const QPointF &oldPos, Qt::MouseButtons buttons, Qt::MouseButtons oldButtons,
    Qt::KeyboardModifiers modifiers, Qt::KeyboardModifiers oldModifiers)
{
    Q_UNUSED(pos);
    Q_UNUSED(oldPos);
    Q_UNUSED(buttons);
    Q_UNUSED(oldButtons);
    Q_UNUSED(oldModifiers);
    m_firstMouseSeen = true;
    m_metaHeld = modifiers.testFlag(Qt::MetaModifier);
    updateGroupVisibility();
}

void ActiveWindowBorderEffect::updateGroupVisibility()
{
    if (!m_isOpenGL) {
        return;
    }
    // Fail-closed endpoint gate plus the passive Meta gate plus live focus
    // eligibility (fullscreen/minimized/hidden/deleted/maximized hide
    // immediately via the tracked-signal connections above). Member validity
    // is never derived native-side: only the carried union bounds render.
    // Policy lives in Rust; C++ supplies POD observer flags and renders.
    const bool groupShow = group_highlight_is_visible(&m_groupState, m_metaHeld ? 1 : 0, m_firstMouseSeen ? 1 : 0,
                               isGroupFocusEligible() ? 1 : 0, m_groupDbusAvailable ? 1 : 0)
        == 1;
    const bool show = groupShow;
    if (show != m_groupVisible) {
        m_groupVisible = show;
        m_groupItem.setVisible(show);
        effects->addRepaintFull();
    } else {
        m_groupItem.setVisible(show);
    }
}

void ActiveWindowBorderEffect::paintScreen(const RenderTarget &renderTarget, const RenderViewport &viewport, int mask, const Region &deviceRegion, LogicalOutput *screen)
{
    effects->paintScreen(renderTarget, viewport, mask, deviceRegion, screen);
}

KWIN_EFFECT_FACTORY(ActiveWindowBorderEffect, "metadata.json")

} // namespace KWin

#include "activewindowborder.moc"
