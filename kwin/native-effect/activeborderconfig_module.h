#pragma once

#include <KCModule>

#include <QDBusMessage>
#include <QString>

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

private:
    void runShortcutApply(const char *operation);
    void runShortcutRevert(const char *operation);
    void clearForcePreview();
    static QString buildForcePreviewText(const ShortcutForcePreview &preview);
    void updateShortcutPresentation(bool interrupted);

    ::Ui::ActiveBorderConfig m_ui;
    bool m_effectReconfigurePending = false;
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
