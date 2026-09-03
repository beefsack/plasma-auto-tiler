#pragma once

#include <KCModule>

#include <QDBusMessage>
#include <QString>
#include <QVariantMap>

#include <functional>

#include "shortcutreconciler.h"
#include "ui_activeborderconfig.h"

namespace KWin
{

class ActiveBorderConfigModule : public KCModule
{
    Q_OBJECT

public:
    explicit ActiveBorderConfigModule(QObject *parent, const KPluginMetaData &data);
    ~ActiveBorderConfigModule() override;

    static QString effectService();
    static QString effectPath();
    static QString effectInterface();
    static QString effectMethod();
    static QString effectName();
    static bool isEffectReconfigureFailed(const QDBusMessage &reply);
    virtual bool requestEffectReconfigure();

    void setShortcutStores(ShortcutStore *store, JournalStore *journal);
    void setShortcutConfirmHandler(std::function<bool(const QString &, const QString &)> handler);
    QString shortcutStatusText() const;
    QString shortcutErrorText() const;
    bool isShortcutFinishApplyVisible() const;
    bool isShortcutRestoreVisible() const;
    void refreshShortcutState();
    virtual bool confirmShortcutAction(const QString &title, const QString &text);

public Q_SLOTS:
    void load() override;
    void save() override;
    void defaults() override;
    void requestShortcutApply();
    void requestShortcutFinishApply();
    void requestShortcutRevert();
    void requestShortcutRestore();

private:
    QVariantMap currentScriptValues() const;
    void updateScriptState();
    void runShortcutApply();
    void runShortcutRevert();
    void updateShortcutPresentation(bool interrupted);

    ::Ui::ActiveBorderConfig m_ui;
    QVariantMap m_loadedScriptValues;
    bool m_loadedDropOutlinePreviewRawValid = true;
    bool m_effectReconfigurePending = false;
    ShortcutStore *m_shortcutStore = nullptr;
    JournalStore *m_shortcutJournal = nullptr;
    bool m_ownsShortcutStores = false;
    std::function<bool(const QString &, const QString &)> m_shortcutConfirm;
    QString m_shortcutStatus;
    QString m_shortcutError;
};

} // namespace KWin
