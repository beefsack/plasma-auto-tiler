#pragma once

#include <KCModule>

#include <QDBusMessage>
#include <QString>
#include <QVariantMap>

#include "ui_scriptconfig.h"

namespace KWin
{

class ScriptConfigModule : public KCModule
{
    Q_OBJECT

public:
    explicit ScriptConfigModule(QObject *parent, const KPluginMetaData &data);
    ~ScriptConfigModule() override = default;

    static QString scriptService();
    static QString scriptPath();
    static QString scriptInterface();
    static QString scriptMethod();
    virtual bool requestScriptReconfigure();
    QString scriptStatusText() const;
    bool isScriptRestartRequired() const;
    bool isGapReconfigurePending() const;

public Q_SLOTS:
    void load() override;
    void save() override;
    void defaults() override;

private:
    QVariantMap currentScriptValues() const;
    void updateScriptState();

    ::Ui::ScriptConfig m_ui;
    QVariantMap m_loadedScriptValues;
    bool m_loadedInnerGapRawValid = true;
    bool m_loadedOuterGapRawValid = true;
    bool m_scriptRestartRequired = false;
    // A failed gap reconfigure send arms a retry on the next save: an
    // unchanged save still sends while this is set, and Apply stays enabled
    // for it through updateScriptState. Cleared on a sent request or load.
    bool m_gapReconfigurePending = false;
    QString m_scriptStatus;
};

} // namespace KWin
