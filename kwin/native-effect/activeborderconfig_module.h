#pragma once

#include <KCModule>

#include <QVariantMap>

#include "ui_activeborderconfig.h"

namespace KWin
{

class ActiveBorderConfigModule : public KCModule
{
    Q_OBJECT

public:
    explicit ActiveBorderConfigModule(QObject *parent, const KPluginMetaData &data);

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
};

} // namespace KWin
