#include "dragoracle.h"
#include "drag_oracle_ffi.h"
#include <effect/effecthandler.h>
#include <window.h>
#include <QDBusConnection>
#include <QByteArray>
#include <QString>
#include <QUuid>
#include <cmath>
#include <cstddef>
#include <cstdint>
namespace KWin {
namespace {
class LastVerdictObject : public QObject {
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.plasmaautotiler.DragOracle1")
public:
    using QObject::QObject;
public Q_SLOTS:
    Q_SCRIPTABLE QString LastVerdict() const {
        uint8_t copy[1024];
        const size_t taken = drag_oracle_last_copy(copy, sizeof(copy));
        if (taken == 0 || taken > sizeof(copy)) return QStringLiteral("{\"v\":1,\"cancelled\":true,\"finalRect\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1},\"windowIdentity\":\"\",\"correlation\":\"drag-0\",\"reason\":\"oracle-unavailable\"}");
        return QString::fromUtf8(reinterpret_cast<const char *>(copy), static_cast<int>(taken));
    }
};
DragOracleRect toPod(const QRect &r) { DragOracleRect o; o.x = r.x(); o.y = r.y(); o.w = r.width(); o.h = r.height(); return o; }
QRect quantized(const RectF &g) { return QRect(static_cast<int>(std::lround(g.x())), static_cast<int>(std::lround(g.y())), static_cast<int>(std::lround(g.width())), static_cast<int>(std::lround(g.height()))); }
QRect moveResizeRect(EffectWindow *w) { if (w == nullptr) return QRect(); if (Window *i = w->window()) return quantized(i->moveResizeGeometry()); return QRect(); }
} // namespace
DragOracleEffect::DragOracleEffect() {
    m_dbusObject = new LastVerdictObject(this);
    QDBusConnection bus = QDBusConnection::sessionBus();
    if (bus.isConnected()) { bus.registerService(QStringLiteral("org.plasmaautotiler.DragOracle")); bus.registerObject(QStringLiteral("/org/plasmaautotiler/DragOracle"), m_dbusObject, QDBusConnection::ExportScriptableContents); }
    for (EffectWindow *window : effects->stackingOrder()) attachWindow(window);
    connect(effects, &EffectsHandler::windowAdded, this, [this](EffectWindow *window) { attachWindow(window); });
    connect(effects, &EffectsHandler::windowClosed, this, [this](EffectWindow *window) { forgetWindow(window); });
    connect(effects, &EffectsHandler::windowDeleted, this, [this](EffectWindow *window) { forgetWindow(window); });
}
DragOracleEffect::~DragOracleEffect() {
    QDBusConnection bus = QDBusConnection::sessionBus();
    bus.unregisterObject(QStringLiteral("/org/plasmaautotiler/DragOracle"));
    bus.unregisterService(QStringLiteral("org.plasmaautotiler.DragOracle"));
}
void DragOracleEffect::attachWindow(EffectWindow *window) {
    if (window == nullptr) return;
    connect(window, &EffectWindow::windowStartUserMovedResized, this, [this](EffectWindow *w) { onDragStart(w); });
    connect(window, &EffectWindow::windowFinishUserMovedResized, this, [this](EffectWindow *w) { onDragFinish(w); });
}
void DragOracleEffect::forgetWindow(EffectWindow *window) { m_startRects.remove(window); }
void DragOracleEffect::onDragStart(EffectWindow *window) { if (window == nullptr || window->isDeleted()) return; m_startRects.insert(window, moveResizeRect(window)); }
void DragOracleEffect::onDragFinish(EffectWindow *window) {
    if (window == nullptr || window->isDeleted()) return;
    const QRect finalRect = moveResizeRect(window);
    const QRect startRect = m_startRects.take(window);
    const QByteArray identity = window->internalId().toString(QUuid::WithoutBraces).toUtf8();
    drag_oracle_record(toPod(startRect), toPod(finalRect), reinterpret_cast<const uint8_t *>(identity.constData()), static_cast<size_t>(identity.size()));
}
KWIN_EFFECT_FACTORY(DragOracleEffect, "dragoracle-metadata.json")
} // namespace KWin
#include "dragoracle.moc"
