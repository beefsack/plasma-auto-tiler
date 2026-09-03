#pragma once

#include <KCModule>

#include <QDBusMessage>
#include <QString>
#include <QVariantMap>

#include "ui_activeborderconfig.h"

namespace KWin
{

class ActiveBorderConfigModule : public KCModule
{
    Q_OBJECT

public:
    explicit ActiveBorderConfigModule(QObject *parent, const KPluginMetaData &data);

    static QString effectService();
    static QString effectPath();
    static QString effectInterface();
    static QString effectMethod();
    static QString effectName();
    static bool isEffectReconfigureFailed(const QDBusMessage &reply);
    virtual bool requestEffectReconfigure();

public Q_SLOTS:
    void load() override;
    void save() override;
    void defaults() override;

private:
    QVariantMap currentScriptValues() const;
    void updateScriptState();

    ::Ui::ActiveBorderConfig m_ui;
    QVariantMap m_loadedScriptValues;
    bool m_loadedDropOutlinePreviewRawValid = true;
    bool m_effectReconfigurePending = false;
};

} // namespace KWin
