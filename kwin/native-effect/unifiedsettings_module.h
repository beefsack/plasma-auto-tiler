#pragma once

#include <KCModule>

#include <QDBusMessage>
#include <QSet>
#include <QString>
#include <QStringList>
#include <QVariantMap>

#include <functional>

#include "shortcutreconciler.h"
#include "ui_unifiedsettings.h"

namespace KWin
{

class UnifiedSettingsModule : public KCModule
{
    Q_OBJECT

public:
    explicit UnifiedSettingsModule(QObject *parent, const KPluginMetaData &data);
    ~UnifiedSettingsModule() override;

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

    void setShortcutStores(ShortcutStore *store, ClearedActionsStore *cleared);
    void setShortcutConfirmHandler(std::function<bool(const QString &, const QString &)> handler);
    QString shortcutStatusText() const;
    QString shortcutErrorText() const;
    QString shortcutForcePreviewText() const;
    bool isShortcutForceApplyVisible() const;
    bool isShortcutForceCancelVisible() const;
    // Staged Keep/Disable draft as sorted catalog IDs ("component/action").
    // Empty means Authentic (keep every binding).
    QStringList shortcutDisabledIds() const;
    void refreshShortcutState();
    virtual bool confirmShortcutAction(const QString &title, const QString &text);

    QString scriptStatusText() const;
    bool isScriptRestartRequired() const;
    bool isGapReconfigurePending() const;

    void refreshWindowConflicts();
    void requestWindowFix(const QString &key);
    void requestWindowRevert(const QString &key);

public Q_SLOTS:
    void load() override;
    void save() override;
    void defaults() override;
    void requestShortcutApply();
    void requestShortcutRevert();
    void requestShortcutForceApply();
    void requestShortcutForceCancel();
    void requestShortcutPresetAuthentic();
    void requestShortcutPresetCompatible();

private:
    void runShortcutApply(const char *operation);
    void runShortcutRevert(const char *operation);
    void clearForcePreview();
    static QString buildForcePreviewText(const ShortcutForcePreview &preview);
    static QString buildConflictRowText(const ShortcutRowDisplay &row, bool disabled);
    void updateShortcutPresentation();
    void refreshShortcutConflictList(const QList<ShortcutRowDisplay> &rows);
    void onShortcutDraftChanged();

    QVariantMap currentScriptValues() const;
    void updateScriptState();

    void runWindowConflictWrite(const QString &key, const char *operation);
    void updateWindowConflictPresentation();

    ::Ui::UnifiedSettings m_ui;
    bool m_effectReconfigurePending = false;
    ShortcutStore *m_shortcutStore = nullptr;
    // Durable cleared-ID list in the project-owned config. Never
    // read/written/removed except via confirmed Force
    // (union-persist before clearing) and Revert (consume then empty).
    ClearedActionsStore *m_clearedStore = nullptr;
    bool m_ownsShortcutStores = false;
    std::function<bool(const QString &, const QString &)> m_shortcutConfirm;
    QString m_shortcutStatus;
    QString m_shortcutError;
    // Pending confirmed-force preview: shown with Force Apply/Cancel, never
    // applied without a second explicit Force confirmation + revalidation.
    ShortcutForcePreview m_forcePreview;
    bool m_forcePreviewValid = false;
    QString m_forcePreviewText;
    // Staged Keep/Disable draft as catalog IDs ("component/action").
    // Checked list rows are kept; unchecked rows are disabled. Staged only:
    // ordinary Save, startup, and installation never apply it.
    QSet<QString> m_shortcutDisabledDraft;

    QVariantMap m_loadedScriptValues;
    bool m_loadedInnerGapRawValid = true;
    bool m_loadedOuterGapRawValid = true;
    bool m_scriptRestartRequired = false;
    // A failed gap reconfigure send arms a retry on the next save: an
    // unchanged save still sends while this is set, and Apply stays enabled
    // for it through updateScriptState. Cleared on a sent request or load.
    bool m_gapReconfigurePending = false;
    QString m_scriptStatus;

    QString m_windowConflictError;
};

} // namespace KWin
