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
    static QString scriptService();
    static QString scriptPath();
    static QString scriptInterface();
    static QString scriptMethod();
    virtual bool requestScriptReconfigure();
    QString tilerReloadStatusText() const;
    bool isTilerReloadRequired() const;
    bool isTilerRestartRequired() const;
    bool isTilerUnconsumedPending() const;

    void setShortcutStores(ShortcutStore *store, JournalStore *journal, JournalStore *legacyJournal = nullptr);
    void setShortcutConfirmHandler(std::function<bool(const QString &, const QString &)> handler);
    QString shortcutStatusText() const;
    QString shortcutErrorText() const;
    QString shortcutForcePreviewText() const;
    bool isShortcutFinishApplyVisible() const;
    bool isShortcutRestoreVisible() const;
    bool isShortcutForceApplyVisible() const;
    bool isShortcutForceCancelVisible() const;
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
    void requestShortcutForceApply();
    void requestShortcutForceCancel();
    void requestTilerReload();

private:
    QVariantMap currentScriptValues() const;
    void updateScriptState();
    void runShortcutApply(const char *operation);
    void runShortcutRevert(const char *operation);
    void clearForcePreview();
    static QString buildForcePreviewText(const ShortcutForcePreview &preview);
    void updateShortcutPresentation(bool interrupted);
    void updateTilerReloadPresentation();

    ::Ui::ActiveBorderConfig m_ui;
    QVariantMap m_loadedScriptValues;
    bool m_loadedDropOutlinePreviewRawValid = true;
    bool m_loadedInnerGapRawValid = true;
    bool m_loadedOuterGapRawValid = true;
    bool m_effectReconfigurePending = false;
    bool m_tilerReloadRequired = false;
    bool m_tilerRestartRequired = false;
    bool m_tilerUnconsumedPending = false;
    QString m_tilerReloadStatus;
    ShortcutStore *m_shortcutStore = nullptr;
    JournalStore *m_shortcutJournal = nullptr;
    // Single explicit legacy journal source. Read-only until a confirmed
    // mutation operation migrates it; never written by open, refresh,
    // preview, or cancel.
    JournalStore *m_shortcutLegacyJournal = nullptr;
    bool m_ownsShortcutStores = false;
    std::function<bool(const QString &, const QString &)> m_shortcutConfirm;
    QString m_shortcutStatus;
    QString m_shortcutError;
    // Pending confirmed-force preview: shown with Force Apply/Cancel, never
    // applied without a second explicit Force confirmation + revalidation.
    ShortcutForcePreview m_forcePreview;
    bool m_forcePreviewValid = false;
    QString m_forcePreviewText;
};

} // namespace KWin
