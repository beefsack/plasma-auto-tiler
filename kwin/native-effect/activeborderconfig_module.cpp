#include "activeborderconfig_module.h"
#include "activeborderconfig.h"

#include <KPluginFactory>

#include <QDBusConnection>
#include <QDBusInterface>
#include <QDBusMessage>
#include <QMessageBox>
#include <QPushButton>

K_PLUGIN_CLASS_WITH_JSON(KWin::ActiveBorderConfigModule, "activeborderconfig_module.json")

namespace KWin
{

ActiveBorderConfigModule::ActiveBorderConfigModule(QObject *parent, const KPluginMetaData &data)
    : KCModule(parent, data)
{
    ActiveBorderConfig::instance(QStringLiteral("kwinrc"));
    m_ui.setupUi(widget());
    addConfig(ActiveBorderConfig::self(), widget());

    m_shortcutStore = createLiveShortcutStore();
    // Canonical host-independent journal plus the single explicit legacy
    // source. Constructing the backends writes nothing; legacy-to-canonical
    // migration runs only inside already-confirmed mutation operations,
    // immediately before reconciliation. Opening, refreshing, previewing,
    // or cancelling never writes config.
    m_shortcutJournal = createLiveShortcutJournal(defaultShortcutJournalPath());
    m_shortcutLegacyJournal = createLiveShortcutJournal(legacyShortcutJournalPath());
    m_ownsShortcutStores = true;
    connect(m_ui.shortcutApplyButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutApply);
    connect(m_ui.shortcutRevertButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutRevert);
    connect(m_ui.shortcutFinishApplyButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutFinishApply);
    connect(m_ui.shortcutRestoreButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutRestore);
    connect(m_ui.shortcutForceApplyButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutForceApply);
    connect(m_ui.shortcutForceCancelButton, &QPushButton::clicked, this, &ActiveBorderConfigModule::requestShortcutForceCancel);
    refreshShortcutState();
}

ActiveBorderConfigModule::~ActiveBorderConfigModule()
{
    if (m_ownsShortcutStores) {
        delete m_shortcutStore;
        delete m_shortcutJournal;
        delete m_shortcutLegacyJournal;
    }
}

QString ActiveBorderConfigModule::effectService()
{
    return QStringLiteral("org.kde.KWin");
}

QString ActiveBorderConfigModule::effectPath()
{
    return QStringLiteral("/Effects");
}

QString ActiveBorderConfigModule::effectInterface()
{
    return QStringLiteral("org.kde.kwin.Effects");
}

QString ActiveBorderConfigModule::effectMethod()
{
    return QStringLiteral("reconfigureEffect");
}

QString ActiveBorderConfigModule::effectName()
{
    return QStringLiteral("plasma-auto-tiler-active-border");
}

bool ActiveBorderConfigModule::isEffectReconfigureFailed(const QDBusMessage &reply)
{
    return reply.type() != QDBusMessage::ReplyMessage;
}

bool ActiveBorderConfigModule::requestEffectReconfigure()
{
    QDBusInterface interface(effectService(), effectPath(), effectInterface(), QDBusConnection::sessionBus());
    const QDBusMessage reply = interface.call(effectMethod(), effectName());
    return !isEffectReconfigureFailed(reply);
}

void ActiveBorderConfigModule::setShortcutStores(ShortcutStore *store, JournalStore *journal,
                                                 JournalStore *legacyJournal)
{
    if (m_ownsShortcutStores) {
        delete m_shortcutStore;
        delete m_shortcutJournal;
        delete m_shortcutLegacyJournal;
        m_shortcutStore = nullptr;
        m_shortcutJournal = nullptr;
        m_shortcutLegacyJournal = nullptr;
        m_ownsShortcutStores = false;
    }
    m_shortcutStore = store;
    m_shortcutJournal = journal;
    m_shortcutLegacyJournal = legacyJournal;
    refreshShortcutState();
}

void ActiveBorderConfigModule::setShortcutConfirmHandler(std::function<bool(const QString &, const QString &)> handler)
{
    m_shortcutConfirm = std::move(handler);
}

QString ActiveBorderConfigModule::shortcutStatusText() const
{
    return m_shortcutStatus;
}

QString ActiveBorderConfigModule::shortcutErrorText() const
{
    return m_shortcutError;
}

QString ActiveBorderConfigModule::shortcutForcePreviewText() const
{
    return m_forcePreviewText;
}

bool ActiveBorderConfigModule::isShortcutFinishApplyVisible() const
{
    return m_ui.shortcutFinishApplyButton != nullptr && !m_ui.shortcutFinishApplyButton->isHidden();
}

bool ActiveBorderConfigModule::isShortcutRestoreVisible() const
{
    return m_ui.shortcutRestoreButton != nullptr && !m_ui.shortcutRestoreButton->isHidden();
}

bool ActiveBorderConfigModule::isShortcutForceApplyVisible() const
{
    return m_ui.shortcutForceApplyButton != nullptr && !m_ui.shortcutForceApplyButton->isHidden();
}

bool ActiveBorderConfigModule::isShortcutForceCancelVisible() const
{
    return m_ui.shortcutForceCancelButton != nullptr && !m_ui.shortcutForceCancelButton->isHidden();
}

void ActiveBorderConfigModule::requestShortcutApply()
{
    runShortcutApply("apply");
}

bool ActiveBorderConfigModule::confirmShortcutAction(const QString &title, const QString &text)
{
    if (m_shortcutConfirm) {
        return m_shortcutConfirm(title, text);
    }
    return QMessageBox::question(widget(), title, text, QMessageBox::Yes | QMessageBox::No, QMessageBox::No) == QMessageBox::Yes;
}

void ActiveBorderConfigModule::requestShortcutFinishApply()
{
    runShortcutApply("finish-apply");
}

void ActiveBorderConfigModule::requestShortcutRevert()
{
    runShortcutRevert("revert");
}

void ActiveBorderConfigModule::requestShortcutRestore()
{
    runShortcutRevert("restore");
}

void ActiveBorderConfigModule::requestShortcutForceApply()
{
    // Never force without a pending exact preview.
    if (!m_forcePreviewValid || !m_forcePreview.forceable) {
        return;
    }
    if (!confirmShortcutAction(QStringLiteral("Force Apply Shortcuts"), m_forcePreviewText)) {
        return;
    }
    if (m_shortcutStore == nullptr || m_shortcutJournal == nullptr) {
        m_shortcutError = QStringLiteral("reconciler is not configured");
        ShortcutDiag::log(QtWarningMsg, "force-apply", "result", "failed",
                          QStringLiteral("reason=reconciler-unconfigured writes=0"));
        updateShortcutPresentation(false);
        return;
    }
    ShortcutReconciler reconciler(m_shortcutStore, m_shortcutJournal);
    reconciler.setLegacyJournal(m_shortcutLegacyJournal);
    // applyForced revalidates the confirmed snapshot against fresh live
    // state before any write; stale snapshots fail with zero writes.
    const ShortcutForceApplyResult result = reconciler.applyForced(m_forcePreview);
    if (result.ok) {
        m_shortcutError.clear();
    } else {
        m_shortcutError = result.error.isEmpty() ? QStringLiteral("Force Apply failed") : result.error;
    }
    ShortcutDiag::log(result.ok ? QtInfoMsg : QtWarningMsg, "force-apply", "result",
                      result.ok ? "ok" : "failed",
                      result.ok ? QStringLiteral("writes=%1").arg(result.writes)
                                : QStringLiteral("reason=%1 writes=%2").arg(result.error).arg(result.writes));
    // A consumed or stale confirmation never persists: the next Force needs
    // a fresh preview.
    clearForcePreview();
    refreshShortcutState();
}

void ActiveBorderConfigModule::requestShortcutForceCancel()
{
    if (!m_forcePreviewValid) {
        return;
    }
    ShortcutDiag::log(QtDebugMsg, "force-preview", "cancel", "cancelled", QStringLiteral("rows=preview"));
    clearForcePreview();
    refreshShortcutState();
}

void ActiveBorderConfigModule::clearForcePreview()
{
    m_forcePreview = ShortcutForcePreview();
    m_forcePreviewValid = false;
    m_forcePreviewText.clear();
}

QString ActiveBorderConfigModule::buildForcePreviewText(const ShortcutForcePreview &preview)
{
    QStringList lines;
    lines.append(QStringLiteral("Force Apply will clear %1 unexpected binding(s) and record each current value "
                                "for Revert. Revalidation runs again after confirmation; stale state aborts "
                                "without writes.")
                     .arg(preview.mismatches.size()));
    for (const ShortcutForceMismatch &mismatch : preview.mismatches) {
        QString line = QStringLiteral("- %1/%2: found %3; will clear to %4 and record %3 for Revert.")
                           .arg(mismatch.component, mismatch.action,
                                ShortcutReconciler::keysDisplay(mismatch.actual),
                                ShortcutReconciler::keysDisplay(mismatch.post));
        // Paired project assignment comes only from the compiled
        // conflict-resolution table, keyed by the exact foreign identity;
        // anything outside the table renders foreign-only, never invented.
        for (const ShortcutConflictRow &row : shortcutConflictTable()) {
            if (row.foreignComponent == mismatch.component && row.foreignAction == mismatch.action) {
                line += QStringLiteral(" Paired project assignment: %1/%2 takes %3.")
                            .arg(row.projectComponent, row.projectAction,
                                 ShortcutReconciler::keysDisplay(row.projectPost));
                break;
            }
        }
        lines.append(line);
    }
    return lines.join(QStringLiteral("\n"));
}

void ActiveBorderConfigModule::runShortcutApply(const char *operation)
{
    if (!confirmShortcutAction(QStringLiteral("Apply Shortcuts"),
                               QStringLiteral("Assign focus-right to Meta+L and move Lock Session to Meta+Esc; assign "
                                              "resize-outwards-up to Meta+Alt+K clearing Switch to Next Keyboard "
                                              "Layout; assign resize-outwards-right to Meta+Alt+L clearing Switch to "
                                              "Last-Used Keyboard Layout; assign toggle-float to Meta+G clearing "
                                              "Grid View; assign toggle-maximize to Meta+M clearing Krohnkite "
                                              "Monocle Layout?"))) {
        return;
    }
    if (m_shortcutStore == nullptr || m_shortcutJournal == nullptr) {
        m_shortcutError = QStringLiteral("reconciler is not configured");
        ShortcutDiag::log(QtWarningMsg, operation, "result", "failed",
                          QStringLiteral("reason=reconciler-unconfigured writes=0"));
        updateShortcutPresentation(false);
        return;
    }
    ShortcutReconciler reconciler(m_shortcutStore, m_shortcutJournal);
    reconciler.setLegacyJournal(m_shortcutLegacyJournal);
    const ShortcutApplyResult result = reconciler.apply();
    if (result.ok) {
        m_shortcutError.clear();
        clearForcePreview();
    } else {
        m_shortcutError = result.error.isEmpty() ? QStringLiteral("Apply failed") : result.error;
        // Explicit Force preview only for exact compiled clear-row foreign
        // mismatches; every other refusal clears any pending preview.
        const ShortcutForcePreview preview = reconciler.previewForceApply();
        if (preview.forceable) {
            m_forcePreview = preview;
            m_forcePreviewValid = true;
            m_forcePreviewText = buildForcePreviewText(preview);
        } else {
            clearForcePreview();
        }
    }
    ShortcutDiag::log(result.ok ? QtInfoMsg : QtWarningMsg, operation, "result", result.ok ? "ok" : "failed",
                      result.ok ? QStringLiteral("writes=%1").arg(result.writes)
                                : QStringLiteral("reason=%1 writes=%2").arg(result.error).arg(result.writes));
    refreshShortcutState();
}

void ActiveBorderConfigModule::runShortcutRevert(const char *operation)
{
    if (!confirmShortcutAction(QStringLiteral("Revert Shortcuts"),
                               QStringLiteral("Restore the recorded bindings (focus-right/Lock Session, "
                                              "resize-outwards-up/Switch to Next, resize-outwards-right/Switch to "
                                              "Last-Used, plus toggle-float/Grid View and toggle-maximize/Monocle "
                                              "when the journal manages five rows)? Externally edited bindings stay "
                                              "untouched."))) {
        return;
    }
    if (m_shortcutStore == nullptr || m_shortcutJournal == nullptr) {
        m_shortcutError = QStringLiteral("reconciler is not configured");
        ShortcutDiag::log(QtWarningMsg, operation, "result", "failed",
                          QStringLiteral("reason=reconciler-unconfigured writes=0"));
        updateShortcutPresentation(false);
        return;
    }
    ShortcutReconciler reconciler(m_shortcutStore, m_shortcutJournal);
    reconciler.setLegacyJournal(m_shortcutLegacyJournal);
    const ShortcutRevertResult result = reconciler.revert();
    if (result.ok && result.untouched.isEmpty()) {
        m_shortcutError.clear();
    } else if (!result.untouched.isEmpty()) {
        QString message = result.error.isEmpty() ? QStringLiteral("external edits left untouched") : result.error;
        message += QStringLiteral(" Untouched: ") + result.untouched.join(QStringLiteral(", "));
        m_shortcutError = message;
    } else {
        m_shortcutError = result.error.isEmpty() ? QStringLiteral("Revert failed") : result.error;
    }
    ShortcutDiag::log(result.ok ? QtInfoMsg : QtWarningMsg, operation, "result", result.ok ? "ok" : "failed",
                      result.ok ? QStringLiteral("writes=%1 untouched=%2").arg(result.writes).arg(result.untouched.size())
                                : QStringLiteral("reason=%1 writes=%2 untouched=%3")
                                      .arg(result.error)
                                      .arg(result.writes)
                                      .arg(result.untouched.size()));
    refreshShortcutState();
}

void ActiveBorderConfigModule::updateShortcutPresentation(bool interrupted)
{
    if (m_ui.shortcutStatusLabel != nullptr) {
        m_ui.shortcutStatusLabel->setText(m_shortcutStatus);
    }
    if (m_ui.shortcutErrorLabel != nullptr) {
        m_ui.shortcutErrorLabel->setText(m_shortcutError);
    }
    if (m_ui.shortcutForcePreviewLabel != nullptr) {
        m_ui.shortcutForcePreviewLabel->setText(m_forcePreviewText);
        m_ui.shortcutForcePreviewLabel->setVisible(m_forcePreviewValid);
    }
    if (m_ui.shortcutFinishApplyButton != nullptr) {
        m_ui.shortcutFinishApplyButton->setVisible(interrupted);
    }
    if (m_ui.shortcutRestoreButton != nullptr) {
        m_ui.shortcutRestoreButton->setVisible(interrupted);
    }
    if (m_ui.shortcutForceApplyButton != nullptr) {
        m_ui.shortcutForceApplyButton->setVisible(m_forcePreviewValid);
    }
    if (m_ui.shortcutForceCancelButton != nullptr) {
        m_ui.shortcutForceCancelButton->setVisible(m_forcePreviewValid);
    }
}

void ActiveBorderConfigModule::refreshShortcutState()
{
    bool interrupted = false;
    if (m_shortcutStore == nullptr || m_shortcutJournal == nullptr) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: reconciler is not configured.");
        updateShortcutPresentation(false);
        return;
    }
    QString error;
    if (!m_shortcutJournal->validateDiscovery(&error)) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: canonical shortcut journal is unsafe.");
        updateShortcutPresentation(false);
        return;
    }
    bool haveJournal = m_shortcutJournal->hasJournal();
    if (!haveJournal && m_shortcutJournal->hasExistingPath()) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: canonical shortcut journal is malformed.");
        updateShortcutPresentation(false);
        return;
    }
    const JournalStore *displayJournal = m_shortcutJournal;
    if (!haveJournal && m_shortcutLegacyJournal != nullptr) {
        if (!m_shortcutLegacyJournal->validateDiscovery(&error)) {
            m_shortcutStatus = QStringLiteral("Shortcut state unavailable: legacy shortcut journal is unsafe.");
            updateShortcutPresentation(false);
            return;
        }
        if (m_shortcutLegacyJournal->hasJournal()) {
            haveJournal = true;
            displayJournal = m_shortcutLegacyJournal;
        } else if (m_shortcutLegacyJournal->hasExistingPath()) {
            m_shortcutStatus = QStringLiteral("Shortcut state unavailable: legacy shortcut journal is malformed.");
            updateShortcutPresentation(false);
            return;
        }
    }
    ShortcutJournal journal;
    bool journalValid = false;
    if (haveJournal) {
        if (!displayJournal->load(&journal, &error)) {
            m_shortcutStatus = QStringLiteral("Shortcut state unavailable: %1").arg(error);
            updateShortcutPresentation(false);
            return;
        }
        journalValid = true;
    }
    if (!m_shortcutStore->checkSetterContract(&error)) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: %1").arg(error);
        updateShortcutPresentation(false);
        return;
    }
    QString owner;
    uint uid = 0;
    if (!m_shortcutStore->currentOwner(&owner, &uid, &error)) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: %1").arg(error);
        updateShortcutPresentation(false);
        return;
    }
    QList<ShortcutTuple> tuples;
    if (!m_shortcutStore->readAll(&tuples, &error)) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: %1").arg(error);
        updateShortcutPresentation(false);
        return;
    }
    const ShortcutTuple *focusCurrent = nullptr;
    const ShortcutTuple *lockCurrent = nullptr;
    const ShortcutTuple *upCurrent = nullptr;
    const ShortcutTuple *nextCurrent = nullptr;
    const ShortcutTuple *rightCurrent = nullptr;
    const ShortcutTuple *lastCurrent = nullptr;
    const ShortcutTuple *floatCurrent = nullptr;
    const ShortcutTuple *gridViewCurrent = nullptr;
    const ShortcutTuple *maximizeCurrent = nullptr;
    const ShortcutTuple *monocleCurrent = nullptr;
    int matches[10] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    for (const ShortcutTuple &tuple : tuples) {
        if (tuple.component == shortcutFocusComponent() && tuple.action == shortcutFocusAction()) {
            ++matches[0];
            focusCurrent = &tuple;
        } else if (tuple.component == shortcutLockComponent() && tuple.action == shortcutLockAction()) {
            ++matches[1];
            lockCurrent = &tuple;
        } else if (tuple.component == shortcutResizeUpComponent() && tuple.action == shortcutResizeUpAction()) {
            ++matches[2];
            upCurrent = &tuple;
        } else if (tuple.component == shortcutSwitchNextComponent() && tuple.action == shortcutSwitchNextAction()) {
            ++matches[3];
            nextCurrent = &tuple;
        } else if (tuple.component == shortcutResizeRightComponent() && tuple.action == shortcutResizeRightAction()) {
            ++matches[4];
            rightCurrent = &tuple;
        } else if (tuple.component == shortcutSwitchLastComponent() && tuple.action == shortcutSwitchLastAction()) {
            ++matches[5];
            lastCurrent = &tuple;
        } else if (tuple.component == shortcutFloatComponent() && tuple.action == shortcutFloatAction()) {
            ++matches[6];
            floatCurrent = &tuple;
        } else if (tuple.component == shortcutGridViewComponent() && tuple.action == shortcutGridViewAction()) {
            ++matches[7];
            gridViewCurrent = &tuple;
        } else if (tuple.component == shortcutMaximizeComponent() && tuple.action == shortcutMaximizeAction()) {
            ++matches[8];
            maximizeCurrent = &tuple;
        } else if (tuple.component == shortcutMonocleComponent() && tuple.action == shortcutMonocleAction()) {
            ++matches[9];
            monocleCurrent = &tuple;
        }
    }
    if (matches[0] != 1 || matches[1] != 1 || matches[2] != 1 || matches[3] != 1 || matches[4] != 1 || matches[5] != 1
        || matches[6] != 1 || matches[7] != 1 || matches[8] != 1 || matches[9] != 1 || focusCurrent == nullptr
        || lockCurrent == nullptr || upCurrent == nullptr || nextCurrent == nullptr || rightCurrent == nullptr
        || lastCurrent == nullptr || floatCurrent == nullptr || gridViewCurrent == nullptr
        || maximizeCurrent == nullptr || monocleCurrent == nullptr) {
        m_shortcutStatus = QStringLiteral("Shortcut state unavailable: allowlisted bindings are missing.");
        updateShortcutPresentation(false);
        return;
    }
    for (const ShortcutTuple &tuple : tuples) {
        if (ShortcutReconciler::isAllowlisted(tuple.component, tuple.action)) {
            continue;
        }
        if (!ShortcutReconciler::keysValid(tuple.active)) {
            m_shortcutStatus = QStringLiteral("Shortcut state unavailable: unrelated tuple is unbounded.");
            updateShortcutPresentation(false);
            return;
        }
    }
    // Authoritative keyed foreign-occupancy gate for Meta+L, Meta+Esc,
    // Meta+Alt+K, Meta+Alt+L, Meta+G, and Meta+M, never tuple enumeration. Typed outcome
    // keeps Conflict vs unavailable semantics without substring matching.
    // The explicit System Monitor `_launch` Meta+Esc holder is user-authorized.
    {
        const KeyedOccupancyResult keyed = ShortcutReconciler::checkKeyedForeignOccupancyDetailed(m_shortcutStore);
        if (keyed.status != KeyedOccupancy::Clear) {
            if (keyed.status == KeyedOccupancy::Conflict) {
                m_shortcutStatus = QStringLiteral("Conflict: %1. Apply is refused.").arg(keyed.detail);
            } else {
                m_shortcutStatus = QStringLiteral("Shortcut state unavailable: %1").arg(keyed.detail);
            }
            updateShortcutPresentation(false);
            return;
        }
    }
    if (journalValid
        && (journal.phase == shortcutJournalPhasePending() || journal.phase == shortcutJournalPhaseFocusApplied())) {
        interrupted = true;
        m_shortcutStatus = QStringLiteral("Interrupted apply found (phase %1). Finish Apply or Restore.").arg(journal.phase);
        updateShortcutPresentation(interrupted);
        return;
    }
    const QList<int> focusPost = ShortcutReconciler::focusPostKeys();
    if (journalValid && journal.phase == shortcutJournalPhaseComplete()) {
        if (focusCurrent->active == journal.focus.post && lockCurrent->active == journal.lock.post
            && upCurrent->active == journal.resizeUp.post && nextCurrent->active == journal.switchNext.post
            && rightCurrent->active == journal.resizeRight.post && lastCurrent->active == journal.switchLast.post
            && (journal.schema == shortcutJournalSchemaV2()
                || (floatCurrent->active == journal.floatToggle.post && gridViewCurrent->active == journal.gridView.post
                    && maximizeCurrent->active == journal.maximizeToggle.post
                    && monocleCurrent->active == journal.monocle.post))) {
            // A v2 journal manages only the original three rows; it never
            // claims Grid View or Monocle state.
            m_shortcutStatus = journal.schema == shortcutJournalSchemaV2()
                ? QStringLiteral("Shortcuts applied (journal complete, 3 rows: Grid View and Monocle unmanaged).")
                : QStringLiteral("Shortcuts applied (journal complete, 5 rows).");
        } else {
            m_shortcutStatus = QStringLiteral("Shortcuts drifted after apply-complete; live bindings differ from the recorded post image.");
        }
        updateShortcutPresentation(false);
        return;
    }
    const bool focusAtPost = focusCurrent->active == focusPost;
    const bool lockHasMetaL = lockCurrent->active.contains(SHORTCUT_META_L);
    const bool lockHasMetaEsc = lockCurrent->active.contains(SHORTCUT_META_ESC);
    const bool upAtPost = upCurrent->active == ShortcutReconciler::resizeUpPostKeys();
    const bool nextClear = nextCurrent->active.isEmpty();
    const bool rightAtPost = rightCurrent->active == ShortcutReconciler::resizeRightPostKeys();
    const bool lastClear = lastCurrent->active.isEmpty();
    const bool nextAtPre = nextCurrent->active == ShortcutReconciler::switchNextExpectedPre();
    const bool lastAtPre = lastCurrent->active == ShortcutReconciler::switchLastExpectedPre();
    const bool floatAtPost = floatCurrent->active == ShortcutReconciler::floatPostKeys();
    const bool gridClear = gridViewCurrent->active.isEmpty();
    const bool maximizeAtPost = maximizeCurrent->active == ShortcutReconciler::maximizePostKeys();
    const bool monocleClear = monocleCurrent->active.isEmpty();
    const bool gridAtPre = gridViewCurrent->active == ShortcutReconciler::gridViewExpectedPre();
    const bool monocleAtPre = monocleCurrent->active == ShortcutReconciler::monocleExpectedPre();
    if (focusAtPost && !lockHasMetaL && lockHasMetaEsc && upAtPost && nextClear && rightAtPost && lastClear && floatAtPost
        && gridClear && maximizeAtPost && monocleClear) {
        m_shortcutStatus = QStringLiteral("Shortcuts applied (5 rows): focus-right owns Meta+L, Lock Session owns "
                                           "Meta+Esc, resize-outwards-up owns Meta+Alt+K, Switch to Next cleared, "
                                           "resize-outwards-right owns Meta+Alt+L, Switch to Last-Used cleared, "
                                           "toggle-float owns Meta+G, Grid View cleared, toggle-maximize owns Meta+M, "
                                           "Monocle cleared.");
        updateShortcutPresentation(false);
        return;
    }
    if (!focusAtPost && lockHasMetaL && nextAtPre && lastAtPre && gridAtPre && monocleAtPre) {
        m_shortcutStatus = QStringLiteral("Ready (5 rows): Apply will assign focus-right to Meta+L and move Lock "
                                           "Session to Meta+Esc; assign resize-outwards-up to Meta+Alt+K clearing "
                                           "Switch to Next; assign resize-outwards-right to Meta+Alt+L clearing Switch "
                                           "to Last-Used; assign toggle-float to Meta+G clearing Grid View; assign "
                                           "toggle-maximize to Meta+M clearing Monocle.");
        updateShortcutPresentation(false);
        return;
    }
    m_shortcutStatus = QStringLiteral("Shortcuts differ from the allowed image.");
    updateShortcutPresentation(false);
}

void ActiveBorderConfigModule::load()
{
    KCModule::load();

    clearForcePreview();
    refreshShortcutState();
}

void ActiveBorderConfigModule::save()
{
    const bool borderChanged = managedWidgetChangeState();
    KCModule::save();

    if (borderChanged) {
        m_effectReconfigurePending = true;
    }
    if (m_effectReconfigurePending) {
        if (requestEffectReconfigure()) {
            m_effectReconfigurePending = false;
        } else {
            markAsChanged();
        }
    }
    // Border hot-apply stays live through the native effect reconfigure.
    // Script settings (workspace mode, tiling gaps) live in
    // the native script KCM and never pass through this module.
}

void ActiveBorderConfigModule::defaults()
{
    KCModule::defaults();
}

} // namespace KWin

#include "activeborderconfig_module.moc"
