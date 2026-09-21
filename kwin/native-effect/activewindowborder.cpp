#include "activewindowborder.h"
#include "activeborderconfig.h"
#include "activeborderlogic.h"

#include <KColorScheme>
#include <KSharedConfig>

#include <effect/effecthandler.h>
#include <scene/workspacescene.h>

#include <QByteArray>
#include <QColor>
#include <QDBusConnection>
#include <QPalette>
#include <QUuid>

#include <cstddef>
#include <cstdint>

namespace KWin
{

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

    if (!m_isOpenGL) {
        return;
    }

    m_borderItem.setParentItem(effects->scene()->overlayItem());
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
    connect(effects, &EffectsHandler::windowDeleted, this, [this](EffectWindow *window) {
        unsubscribeMaximize(window);
        m_maximizedWindows.remove(window);
        if (m_trackedWindow == window) {
            setTrackedWindow(nullptr);
            updateBorder();
        }
        updateGroupVisibility();
    });
    // Fullscreen/minimized/hidden/deleted transitions must hide immediately
    // while Meta is held without pointer movement: the tracked-window
    // signals below plus windowActivated/windowDeleted drive visibility.
    connect(effects, &EffectsHandler::windowClosed, this, [this](EffectWindow *window) {
        unsubscribeMaximize(window);
        m_maximizedWindows.remove(window);
        updateGroupVisibility();
    });
    connect(effects, &EffectsHandler::mouseChanged, this, &ActiveWindowBorderEffect::onMouseChanged);
    // Global maximize tracking: transitions for every window while the
    // effect is loaded, not only the tracked one, so a window maximized
    // while inactive is already known when later activated. Windows already
    // maximized before effect load emit no transition and stay unknown.
    for (EffectWindow *window : effects->stackingOrder()) {
        subscribeMaximize(window);
    }
    connect(effects, &EffectsHandler::windowAdded, this, [this](EffectWindow *window) {
        subscribeMaximize(window);
    });

    setTrackedWindow(effects->activeWindow());
    updateBorder();
    updateGroupVisibility();
}

ActiveWindowBorderEffect::~ActiveWindowBorderEffect()
{
    QDBusConnection bus = QDBusConnection::sessionBus();
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
        connect(m_trackedWindow, &EffectWindow::windowFrameGeometryChanged, this, &ActiveWindowBorderEffect::updateBorder);
        connect(m_trackedWindow, &EffectWindow::minimizedChanged, this, &ActiveWindowBorderEffect::updateBorder);
        connect(m_trackedWindow, &EffectWindow::windowFullScreenChanged, this, &ActiveWindowBorderEffect::updateBorder);
        // Own active tracked signals update group visibility immediately so
        // fullscreen/minimized transitions hide while Meta is held without
        // waiting for pointer movement. Allowed effect conventions only: no
        // polling, timers, interception, or extra rendering.
        connect(m_trackedWindow, &EffectWindow::minimizedChanged, this, &ActiveWindowBorderEffect::updateGroupVisibility);
        connect(m_trackedWindow, &EffectWindow::windowFullScreenChanged, this, &ActiveWindowBorderEffect::updateGroupVisibility);
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
}

void ActiveWindowBorderEffect::unsubscribeMaximize(EffectWindow *window)
{
    if (window == nullptr || !m_maximizeSubscribed.remove(window)) {
        return;
    }
    disconnect(window, &EffectWindow::windowMaximizedStateAboutToChange, this, nullptr);
    disconnect(window, &EffectWindow::windowMaximizedStateChanged, this, nullptr);
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
        window ? window->isFullScreen() : false,
        window ? m_maximizedWindows.contains(window) : false);
    const qreal gap = ActiveBorderConfig::borderGap();
    m_borderItem.setInnerRect(activeBorderInnerRect(state.innerRect, gap));
    m_borderItem.setVisible(state.visible);
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
    // eligibility (fullscreen/minimized/hidden/deleted/non-tiled hide
    // immediately via the tracked-signal connections above). Member validity
    // is never derived native-side: only the carried union bounds render.
    // Policy lives in Rust; C++ supplies POD observer flags and renders.
    const bool show = group_highlight_is_visible(&m_groupState, m_metaHeld ? 1 : 0, m_firstMouseSeen ? 1 : 0,
                          isGroupFocusEligible() ? 1 : 0, m_groupDbusAvailable ? 1 : 0)
        == 1;
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
