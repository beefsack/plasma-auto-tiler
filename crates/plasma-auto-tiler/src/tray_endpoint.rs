use std::collections::VecDeque;
use std::fs::File;
use std::io::Read;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::Instant;

use zbus::blocking::{Connection, MessageIterator, fdo::DBusProxy};
use zbus::fdo::{RequestNameFlags, RequestNameReply};
use zbus::object_server::SignalEmitter;
use zbus::{MatchRule, fdo::NameOwnerChanged, message::Type};

use crate::tray::{DbusMenu, StatusNotifierItem, TrayProjection};
use crate::tray_lifecycle::{ProcProcessControl, ProcessControl, ProcessIdentity};

pub const SERVICE: &str = "org.plasmaautotiler.Tray";
pub const OBJECT: &str = "/org/plasmaautotiler/Tray";
pub const INTERFACE: &str = "org.plasmaautotiler.Tray1";
pub const METHOD: &str = "PublishSnapshot";
pub const KWIN_SERVICE: &str = "org.kde.KWin";
pub const FRESHNESS_MS: u64 = 30_000;
const APPROVED_KWIN_ENTRYPOINTS: &[&str] = &[
    "/run/current-system/sw/bin/kwin_wayland",
    "/run/current-system/sw/bin/kwin_wayland_wrapper",
    "/run/current-system/sw/bin/kwin_x11",
    "/usr/bin/kwin_wayland",
    "/usr/bin/kwin_wayland_wrapper",
    "/usr/bin/kwin_x11",
];
const WATCHER_REGISTRATION_ATTEMPTS: usize = 3;
const WATCHER_REGISTRATION_RETRY_DELAY: Duration = Duration::from_millis(100);
const STATUS_NOTIFIER_WATCHER_SERVICE: &str = "org.kde.StatusNotifierWatcher";
const STATUS_NOTIFIER_WATCHER_OBJECT: &str = "/StatusNotifierWatcher";
const STATUS_NOTIFIER_WATCHER_INTERFACE: &str = "org.kde.StatusNotifierWatcher";
const REGISTER_STATUS_NOTIFIER_ITEM: &str = "RegisterStatusNotifierItem";
const MAX_GENERATION_HISTORY: usize = 256;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub generation: String,
    pub revision: i32,
    pub enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StateView {
    pub owner: bool,
    pub snapshot: Option<Snapshot>,
    pub refreshed_at: Option<u64>,
    pub current: bool,
}

#[derive(Debug, zbus::DBusError, PartialEq, Eq)]
#[zbus(prefix = "org.plasmaautotiler.Tray1")]
pub enum TrayError {
    InvalidSnapshot(String),
    UnauthorizedPublisher,
    EmissionFailed(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PublisherIdentity {
    pub process_id: u32,
    pub process: ProcessIdentity,
    approved: ApprovedKwinIdentity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ApprovedKwinIdentity {
    canonical_path: PathBuf,
    executable: crate::tray_lifecycle::ProcessExecutableIdentity,
}

#[derive(Debug, Default)]
pub struct TrayState {
    owner: Option<String>,
    generation: Option<String>,
    revision: Option<i32>,
    ordering_conflicted: bool,
    snapshot: Option<Snapshot>,
    refreshed_at: Option<u64>,
    retired_generations: VecDeque<String>,
    quarantined_generations: VecDeque<String>,
    publisher_identity: Option<PublisherIdentity>,
    trusted_publisher: Option<PublisherIdentity>,
    /// Diagnostic-only failure memory (see [`TrayDiagTracker`]). It gates
    /// stderr records only and is never read by authorization, acceptance,
    /// ordering, freshness, or view logic.
    diag: TrayDiagTracker,
}

impl TrayState {
    pub fn owner_changed(&mut self, owner: Option<&str>) {
        if self.owner.as_deref() != owner {
            self.clear_snapshot();
            self.generation = None;
            self.revision = None;
            self.ordering_conflicted = false;
            self.retired_generations.clear();
            self.quarantined_generations.clear();
            self.publisher_identity = None;
        }
        self.owner = owner.map(str::to_owned);
    }

    pub fn publish_snapshot(
        &mut self,
        schema: i32,
        generation: String,
        revision: i32,
        enabled: bool,
        now_ms: u64,
    ) -> Result<(), TrayError> {
        if schema != 1 || !valid_generation(&generation) {
            return Err(TrayError::InvalidSnapshot(
                "schema or generation is invalid".to_owned(),
            ));
        }

        if self.owner.is_none() {
            return Ok(());
        }

        let incoming = Snapshot {
            generation,
            revision,
            enabled,
        };
        let accept = match self.generation.as_deref() {
            None => true,
            Some(current) if current == incoming.generation => {
                self.revision.is_some_and(|revision| {
                    if self.ordering_conflicted {
                        incoming.revision > revision
                    } else {
                        incoming.revision > revision
                            || (incoming.revision == revision
                                && self
                                    .snapshot
                                    .as_ref()
                                    .is_some_and(|current| current.enabled == incoming.enabled))
                    }
                })
            }
            Some(_) => {
                incoming.revision == 0
                    && !self.retired_generations.contains(&incoming.generation)
                    && !self.quarantined_generations.contains(&incoming.generation)
            }
        };

        if accept {
            if let Some(current) = self.generation.as_ref()
                && current != &incoming.generation
            {
                remember_generation(&mut self.retired_generations, current);
            }
            self.generation = Some(incoming.generation.clone());
            self.revision = Some(incoming.revision);
            self.ordering_conflicted = false;
            self.snapshot = Some(incoming);
            self.refreshed_at = Some(now_ms);
            Ok(())
        } else {
            let retired_generation = self.retired_generations.contains(&incoming.generation);
            let quarantined_generation =
                self.quarantined_generations.contains(&incoming.generation);
            if !retired_generation && !quarantined_generation {
                self.clear_snapshot();
                if self.generation.as_deref() == Some(incoming.generation.as_str()) {
                    self.revision = self.revision.map_or(Some(incoming.revision), |revision| {
                        Some(revision.max(incoming.revision))
                    });
                } else {
                    remember_generation(&mut self.quarantined_generations, &incoming.generation);
                }
                self.ordering_conflicted = true;
            }
            Err(TrayError::InvalidSnapshot(
                "revision is not a valid state transition".to_owned(),
            ))
        }
    }

    /// Collects a pre-authentication refusal record through the
    /// change-driven tracker. Returns the line on a first or distinct
    /// refusal, `None` on an identical repeat. Only the fixed reason and the
    /// `i32` revision are carried, so no sender, owner, or raw detail is ever
    /// retained or logged. Diagnostic-only.
    fn collect_early_refusal(&mut self, reason: &'static str, revision: i32) -> Option<String> {
        self.diag
            .failure_line(publish_early_refusal_line(reason, revision))
    }

    pub(crate) fn publish_snapshot_from(
        &mut self,
        publisher: Option<&str>,
        identity: Option<&PublisherIdentity>,
        schema: i32,
        snapshot: Snapshot,
        now_ms: u64,
    ) -> (Result<(), TrayError>, Option<String>) {
        // Collection only: every diagnostic line below is returned to the
        // caller and emitted after the state mutex (and, on the D-Bus path,
        // the operation lock) are released. Logging never changes the result.
        let Some(identity) = identity else {
            let line = self.collect_early_refusal("unauthorized", snapshot.revision);
            return (Err(TrayError::UnauthorizedPublisher), line);
        };
        if !authorized_publisher(
            self.owner.as_deref(),
            publisher,
            identity,
            self.publisher_identity.as_ref(),
            self.trusted_publisher.as_ref(),
        ) {
            let line = self.collect_early_refusal("unauthorized", snapshot.revision);
            return (Err(TrayError::UnauthorizedPublisher), line);
        }

        let before = (
            self.generation.clone(),
            self.revision,
            self.snapshot.as_ref().map(|current| current.enabled),
        );
        let revision = snapshot.revision;
        let enabled = snapshot.enabled;
        // Bounded join identity: the generation token is only carried when it
        // passes the existing protocol validation; otherwise only the `i32`
        // revision is logged, never untrusted text. The clone is bounded
        // (at most 32 bytes) and changes no validation or state.
        let logged_generation =
            valid_generation(&snapshot.generation).then(|| snapshot.generation.clone());
        let result = self.publish_snapshot(
            schema,
            snapshot.generation,
            snapshot.revision,
            snapshot.enabled,
            now_ms,
        );
        if result.is_ok() && self.publisher_identity.is_none() {
            self.publisher_identity = Some(identity.clone());
            if self.trusted_publisher.is_none() {
                self.trusted_publisher = Some(identity.clone());
            }
        }
        // Best-effort only: accepted-but-unchanged snapshots are the
        // steady-state heartbeat duplicate and stay silent. Recovery and
        // suppression live here: a visibly accepted change clears failure
        // memory (the accepted record is the recovery evidence); refusals
        // are change-driven (an identical repeat stays silent); silent
        // duplicates touch neither. Logging never changes the result below.
        let after = (
            self.generation.clone(),
            self.revision,
            self.snapshot.as_ref().map(|current| current.enabled),
        );
        let outcome = publish_outcome_line(
            before != after,
            &result,
            logged_generation.as_deref(),
            revision,
            enabled,
        );
        let line = match (&result, outcome) {
            (Ok(()), Some(accepted)) => {
                self.diag.note_accepted_change();
                Some(accepted)
            }
            (Ok(()), None) => None,
            (Err(_), Some(refusal)) => self.diag.failure_line(refusal),
            (Err(_), None) => None,
        };
        (result, line)
    }

    pub fn view(&self, now_ms: u64) -> StateView {
        let current = self.owner.is_some()
            && self.snapshot.is_some()
            && self.refreshed_at.is_some_and(|refreshed_at| {
                now_ms >= refreshed_at && now_ms - refreshed_at < FRESHNESS_MS
            });
        StateView {
            owner: self.owner.is_some(),
            snapshot: self.snapshot.clone(),
            refreshed_at: self.refreshed_at,
            current,
        }
    }

    fn clear_snapshot(&mut self) {
        self.snapshot = None;
        self.refreshed_at = None;
    }
}

fn valid_generation(generation: &str) -> bool {
    (1..=32).contains(&generation.len())
        && generation
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn authorized_publisher(
    owner: Option<&str>,
    publisher: Option<&str>,
    identity: &PublisherIdentity,
    expected_identity: Option<&PublisherIdentity>,
    trusted_identity: Option<&PublisherIdentity>,
) -> bool {
    let (Some(owner), Some(publisher)) = (owner, publisher) else {
        return false;
    };

    owner == publisher
        && zbus::names::UniqueName::try_from(owner).is_ok()
        && valid_publisher_identity(identity)
        && expected_identity.map_or_else(
            || {
                trusted_identity
                    .is_none_or(|trusted| same_executable(&trusted.process, &identity.process))
            },
            |expected| expected == identity,
        )
}

fn valid_publisher_identity(identity: &PublisherIdentity) -> bool {
    identity.process_id != 0
        && identity.process.start_tick != 0
        && matches_approved_identity(&identity.process, &identity.approved)
        && !identity.process.executable.content.is_empty()
}

fn matches_approved_identity(process: &ProcessIdentity, approved: &ApprovedKwinIdentity) -> bool {
    process.resolved_executable_path == approved.canonical_path
        && process.executable == approved.executable
}

fn resolve_approved_kwin_identities() -> Vec<ApprovedKwinIdentity> {
    APPROVED_KWIN_ENTRYPOINTS
        .iter()
        .filter_map(|entrypoint| {
            let canonical_path = std::fs::canonicalize(entrypoint).ok()?;
            let mut file = File::open(&canonical_path).ok()?;
            let metadata = file.metadata().ok()?;
            if !metadata.is_file() || metadata.mode() & 0o111 == 0 {
                return None;
            }
            let mut content = Vec::new();
            file.read_to_end(&mut content).ok()?;
            if content.is_empty() {
                return None;
            }
            Some(ApprovedKwinIdentity {
                canonical_path,
                executable: crate::tray_lifecycle::ProcessExecutableIdentity {
                    dev: metadata.dev(),
                    ino: metadata.ino(),
                    content,
                },
            })
        })
        .collect()
}

fn same_executable(expected: &ProcessIdentity, actual: &ProcessIdentity) -> bool {
    expected.resolved_executable_path == actual.resolved_executable_path
        && expected.executable == actual.executable
}

fn remember_generation(history: &mut VecDeque<String>, generation: &str) {
    if history.iter().any(|known| known == generation) {
        return;
    }
    history.push_back(generation.to_owned());
    while history.len() > MAX_GENERATION_HISTORY {
        history.pop_front();
    }
}

/// Diagnostic-only failure memory. Records the last emitted failure line so
/// that refusal/failure records reachable from the 1 Hz KWin heartbeat are
/// change-driven: an identical repeat stays silent, while a different
/// category, reason, or safe snapshot identity produces a different line and
/// logs again. The key is the exact line that would be emitted, so only
/// already-bounded content (fixed labels, `i32` revisions, validated
/// generation tokens, `enabled` labels) is ever retained: no owner, PID, raw
/// failure, or unvalidated generation data is stored. Bounded to a single
/// line. Never consulted by authorization, acceptance, ordering, freshness,
/// registration, signal, retry, or view logic.
#[derive(Clone, Debug, Default)]
struct TrayDiagTracker {
    last_failure_line: Option<String>,
}

impl TrayDiagTracker {
    /// Change-driven gate for failure records. Returns the line on a first
    /// or distinct failure and records it; returns `None` when this exact
    /// line was already reported, keeping identical repeats silent.
    fn failure_line(&mut self, line: String) -> Option<String> {
        if self.last_failure_line.as_deref() == Some(line.as_str()) {
            return None;
        }
        self.last_failure_line = Some(line);
        self.last_failure_line.clone()
    }

    /// Recovery: a visibly accepted state change clears failure memory, so a
    /// later failure logs again. The accepted record itself is the visible
    /// recovery evidence; silent duplicates and refusals never clear.
    fn note_accepted_change(&mut self) {
        self.last_failure_line = None;
    }

    /// Owner epochs bound suppression episodes: a real owner transition
    /// clears failure memory. Idempotent (silent) owner signals never clear.
    fn note_owner_change(&mut self) {
        self.last_failure_line = None;
    }

    /// Signal recovery clears only signal-stage suppression: a successful
    /// signal emission after an `emission-failed` record re-arms that
    /// record. Publish-stage suppression is untouched, so refusal storms
    /// spanning successful signal emissions stay bounded.
    fn note_signal_success(&mut self) {
        if self.last_failure_line.as_deref() == Some(signal_emission_failed_line().as_str()) {
            self.last_failure_line = None;
        }
    }
}

pub(crate) const TRAY_DIAG_PREFIX: &str = "plasma-auto-tiler:route-diag";
const TRAY_DIAG_COMPONENT: &str = "tray-endpoint";

/// Bounded owner-transition record. Presence transitions only: the raw owner
/// (a D-Bus unique name) is never logged. Returns `None` when nothing
/// changed, keeping idempotent owner signals silent.
fn owner_outcome_line(changed: bool, before_present: bool, after_present: bool) -> Option<String> {
    if !changed {
        return None;
    }
    let outcome = match (before_present, after_present) {
        (false, true) => "acquired",
        (true, false) => "lost",
        (true, true) => "replaced",
        (false, false) => return None,
    };
    Some(format!(
        "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=owner event=owner-changed outcome={outcome}"
    ))
}

/// Maps an `InvalidSnapshot` message to a bounded refusal reason. Exact match
/// on the two internal literals; anything else degrades to the transition
/// label so refusal text is never echoed.
fn invalid_snapshot_reason(message: &str) -> &'static str {
    if message == "schema or generation is invalid" {
        "invalid-schema-or-generation"
    } else {
        "invalid-transition"
    }
}

/// Bounded publication record. `revision` is a plain `i32` snapshot marker
/// and `enabled` the snapshot state label; `generation` is only carried when
/// the caller attests it passed the existing protocol validation
/// (`valid_generation`), so unvalidated (possibly attacker-controlled) tokens
/// are omitted and never echoed. Accepted-but-unchanged snapshots are the
/// steady-state heartbeat duplicate and stay silent (`None`); only genuine
/// state changes, refusals, and failures produce a line. The
/// generation/revision/enabled triple is a snapshot-identity join key only:
/// equality with a KWin bridge send line never implies endpoint acceptance
/// and never claims correlation or request ancestry.
fn publish_outcome_line(
    changed: bool,
    result: &Result<(), TrayError>,
    generation: Option<&str>,
    revision: i32,
    enabled: bool,
) -> Option<String> {
    match result {
        Ok(()) if changed => {
            let token = generation?;
            Some(format!(
                "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=publish event=publish outcome=accepted generation={token} revision={revision} enabled={enabled}"
            ))
        }
        Ok(()) => None,
        Err(TrayError::InvalidSnapshot(message)) => {
            let reason = invalid_snapshot_reason(message);
            match generation {
                Some(token) => Some(format!(
                    "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=publish event=publish outcome=refused reason={reason} generation={token} revision={revision} enabled={enabled}"
                )),
                None => Some(format!(
                    "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=publish event=publish outcome=refused reason={reason} revision={revision}"
                )),
            }
        }
        Err(TrayError::UnauthorizedPublisher) => Some(format!(
            "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=publish event=publish outcome=refused reason=unauthorized revision={revision}"
        )),
        Err(TrayError::EmissionFailed(_)) => Some(format!(
            "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=publish event=publish outcome=refused reason=emission-failed revision={revision}"
        )),
    }
}

/// Bounded refusal record for publications rejected before authentication.
/// `reason` must be a fixed label (`missing-sender`, `unverified-publisher`,
/// `unauthorized`); only the `i32` revision is carried as snapshot identity.
fn publish_early_refusal_line(reason: &'static str, revision: i32) -> String {
    format!(
        "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=publish event=publish outcome=refused reason={reason} revision={revision}"
    )
}

/// Bounded signal-emission failure record. The transport error is never
/// carried, only the fixed failure category. Describes the failed signal
/// emission only; the publication result stands independently.
fn signal_emission_failed_line() -> String {
    format!(
        "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=signal event=emit outcome=emission-failed"
    )
}

/// Bounded SNI projection record. Emitted only when the projected status
/// actually changes (the caller gates on the status cache); `status` is one
/// of the fixed `Active`/`Passive`/`NeedsAttention` labels. Describes the
/// emitted signal only, never final panel visibility.
pub(crate) fn status_projected_line(status: &str) -> String {
    format!(
        "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=projection event=projected outcome={status}"
    )
}

/// Best-effort tray diagnostic writer. Standard printing panics on a stderr
/// write error, so tray diagnostics use this instead: the write result is
/// discarded and logging can never affect tray behavior.
pub(crate) fn emit_tray_diag(line: &str) {
    use std::io::Write as _;
    let _ = writeln!(std::io::stderr(), "{line}");
}

#[derive(Clone, Debug)]
pub struct TrayEndpoint {
    state: Arc<Mutex<TrayState>>,
    started: Instant,
    projection: TrayProjection,
    operation_lock: Arc<async_lock::Mutex<()>>,
}

impl TrayEndpoint {
    pub fn new(initial_owner: Option<&str>) -> Self {
        let mut state = TrayState::default();
        state.owner_changed(initial_owner);
        let state = Arc::new(Mutex::new(state));
        let last_status = Arc::new(Mutex::new(None));
        let started = Instant::now();
        let projection =
            TrayProjection::with_last_status(Arc::clone(&state), started, Arc::clone(&last_status));
        Self {
            state,
            started,
            projection,
            operation_lock: Arc::new(async_lock::Mutex::new(())),
        }
    }

    pub fn owner_changed(&self, owner: Option<&str>) {
        // State transition first; the bounded lifecycle line (if any) is
        // emitted after the locks are released. Logging never changes the
        // result below. The raw owner is never logged, only presence. A real
        // owner transition starts a new suppression episode; idempotent
        // signals leave failure memory untouched.
        let line = {
            let _operation_guard = self.operation_lock.lock_blocking();
            let mut state = self.state.lock().expect("tray state mutex poisoned");
            let before_present = state.owner.is_some();
            let changed = state.owner.as_deref() != owner;
            state.owner_changed(owner);
            if changed {
                state.diag.note_owner_change();
            }
            owner_outcome_line(changed, before_present, owner.is_some())
        };
        if let Some(line) = line {
            emit_tray_diag(&line);
        }
    }

    pub fn projection(&self) -> TrayProjection {
        self.projection.clone()
    }

    fn publish_authenticated_snapshot(
        &self,
        publisher: &str,
        identity: &PublisherIdentity,
        schema: i32,
        snapshot: Snapshot,
    ) -> (Result<(), TrayError>, Option<String>) {
        // State transition only; the pending diagnostic line (if any) is
        // returned for the caller to emit after the state mutex (and, on the
        // D-Bus path, the operation lock) are released. Logging never changes
        // the result below.
        let mut state = self.state.lock().expect("tray state mutex poisoned");
        state.publish_snapshot_from(
            Some(publisher),
            Some(identity),
            schema,
            snapshot,
            self.started.elapsed().as_millis().min(u64::MAX as u128) as u64,
        )
    }

    /// Locked publish step: verifies the publisher, publishes, and signals
    /// while holding the operation lock, collecting (never emitting)
    /// diagnostic lines. The caller emits the returned lines after the
    /// operation lock and the state mutex are released. Publish/auth/signal
    /// ordering, results, and emission-failure masking match the previous
    /// inline behavior exactly.
    async fn publish_locked(
        &self,
        publisher: &str,
        schema: i32,
        snapshot: Snapshot,
        emitter: &SignalEmitter<'_>,
    ) -> (Result<(), TrayError>, Vec<String>) {
        let _operation_guard = self.operation_lock.lock().await;
        let mut pending: Vec<String> = Vec::new();
        let revision = snapshot.revision;
        let Some(identity) = verify_kwin_publisher(emitter.connection(), publisher).await else {
            // Diagnostic-only decision under the state mutex; emission
            // happens after both locks release.
            pending.extend(
                self.state
                    .lock()
                    .expect("tray state mutex poisoned")
                    .collect_early_refusal("unverified-publisher", revision),
            );
            return (Err(TrayError::UnauthorizedPublisher), pending);
        };
        let (result, line) =
            self.publish_authenticated_snapshot(publisher, &identity, schema, snapshot);
        pending.extend(line);
        if let Err(error) = self.projection().emit_changed(emitter.connection()).await {
            // Best-effort only: the transport error is never logged, only the
            // bounded failure category. The publication result above stands.
            pending.extend(
                self.state
                    .lock()
                    .expect("tray state mutex poisoned")
                    .diag
                    .failure_line(signal_emission_failed_line()),
            );
            return (Err(TrayError::EmissionFailed(error.to_string())), pending);
        }
        // Signal recovery re-arms only signal-stage suppression; the state
        // mutex is held for this diagnostic-only decision alone.
        self.state
            .lock()
            .expect("tray state mutex poisoned")
            .diag
            .note_signal_success();
        (result, pending)
    }
}

#[zbus::interface(name = "org.plasmaautotiler.Tray1")]
impl TrayEndpoint {
    async fn publish_snapshot(
        &self,
        schema: i32,
        generation: String,
        revision: i32,
        enabled: bool,
        #[zbus(header)] header: zbus::message::Header<'_>,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> Result<(), TrayError> {
        let publisher = header.sender().map(ToString::to_string);
        let Some(publisher) = publisher.as_deref() else {
            // Change-driven like every other refusal record: the line is
            // collected under the state mutex alone (the operation lock is
            // never taken on this path) and emitted after release, so
            // repeated sender-less calls stay bounded consistently.
            let line = self
                .state
                .lock()
                .expect("tray state mutex poisoned")
                .collect_early_refusal("missing-sender", revision);
            if let Some(line) = line {
                emit_tray_diag(&line);
            }
            return Err(TrayError::UnauthorizedPublisher);
        };
        // Diagnostic lines are collected under the locks and emitted only
        // after both the operation lock and the state mutex are released.
        // Publish/auth/signal ordering, results, and emission-failure masking
        // are unchanged.
        let (result, pending) = self
            .publish_locked(
                publisher,
                schema,
                Snapshot {
                    generation,
                    revision,
                    enabled,
                },
                &emitter,
            )
            .await;
        for line in &pending {
            emit_tray_diag(line);
        }
        result
    }
}

pub fn run() -> zbus::Result<()> {
    run_with_mode(false)
}

pub fn run_managed() -> zbus::Result<()> {
    crate::tray_lifecycle::validate_managed_environment()?;
    run_with_mode(true)
}

fn owner_changes_match_rule() -> zbus::Result<MatchRule<'static>> {
    Ok(MatchRule::builder()
        .msg_type(Type::Signal)
        .sender("org.freedesktop.DBus")?
        .interface("org.freedesktop.DBus")?
        .member("NameOwnerChanged")?
        .build())
}

fn monitor_owner_changes(monitor: &Connection) -> zbus::Result<MessageIterator> {
    MessageIterator::for_match_rule(owner_changes_match_rule()?, monitor, Some(16))
}

fn run_with_mode(managed: bool) -> zbus::Result<()> {
    let connection = Connection::session()?;
    let dbus = DBusProxy::new(&connection)?;
    let watcher_owner = reconcile_initial_owner(
        || dbus.name_has_owner(STATUS_NOTIFIER_WATCHER_SERVICE.try_into().unwrap()),
        || {
            dbus.get_name_owner(STATUS_NOTIFIER_WATCHER_SERVICE.try_into().unwrap())
                .map(|owner| owner.to_string())
        },
    )?;
    let initial_owner = reconcile_initial_owner(
        || dbus.name_has_owner(KWIN_SERVICE.try_into().unwrap()),
        || {
            dbus.get_name_owner(KWIN_SERVICE.try_into().unwrap())
                .map(|owner| owner.to_string())
        },
    )?;

    let endpoint = TrayEndpoint::new(initial_owner.as_deref());
    let projection = endpoint.projection();
    connection.object_server().at(OBJECT, endpoint.clone())?;
    connection.object_server().at(
        StatusNotifierItem::OBJECT,
        projection.status_notifier_item(),
    )?;
    connection
        .object_server()
        .at(DbusMenu::OBJECT, projection.menu())?;
    request_service_name(&connection)?;

    let create_record = if managed {
        crate::tray_lifecycle::create_managed_record()
    } else {
        crate::tray_lifecycle::create_current_record()
    };
    if let Err(error) = create_record {
        let cleanup = if managed {
            crate::tray_lifecycle::cleanup_managed_record()
        } else {
            crate::tray_lifecycle::cleanup_current_record()
        };
        return Err(lifecycle_error(
            format!("create tray PID record: {error}"),
            cleanup,
        ));
    }
    let watcher_owner = watcher_owner.ok_or_else(|| {
        lifecycle_error(
            "status notifier watcher has no owner".to_owned(),
            if managed {
                crate::tray_lifecycle::cleanup_managed_record()
            } else {
                crate::tray_lifecycle::cleanup_current_record()
            },
        )
    })?;
    if let Err(error) = register_status_notifier_item_with_retry(&connection, &watcher_owner) {
        let cleanup = if managed {
            crate::tray_lifecycle::cleanup_managed_record()
        } else {
            crate::tray_lifecycle::cleanup_current_record()
        };
        return Err(lifecycle_error(
            format!("register status notifier item: {error}"),
            cleanup,
        ));
    }
    let signal_ready = if managed {
        crate::tray_lifecycle::signal_managed_record_ready()
    } else {
        crate::tray_lifecycle::signal_current_record_ready()
    };
    if let Err(error) = signal_ready {
        let cleanup = if managed {
            crate::tray_lifecycle::cleanup_managed_record()
        } else {
            crate::tray_lifecycle::cleanup_current_record()
        };
        return Err(lifecycle_error(
            format!("signal tray endpoint readiness: {error}"),
            cleanup,
        ));
    }
    // Owner-change signals are observed on a dedicated monitor connection so a
    // lagging NameOwnerChanged queue can never apply backpressure to the
    // serving connection's socket reader and stall ObjectServer dispatch
    // (SNI properties, Peer.Ping, PublishSnapshot). The serving connection
    // remains dedicated to dispatch, registration, and signal emission.
    let monitor = Connection::session().map_err(|error| {
        lifecycle_error(
            format!("open tray owner monitor: {error}"),
            if managed {
                crate::tray_lifecycle::cleanup_managed_record()
            } else {
                crate::tray_lifecycle::cleanup_current_record()
            },
        )
    })?;
    let owner_changes = monitor_owner_changes(&monitor).map_err(|error| {
        lifecycle_error(
            format!("watch tray owner changes: {error}"),
            if managed {
                crate::tray_lifecycle::cleanup_managed_record()
            } else {
                crate::tray_lifecycle::cleanup_current_record()
            },
        )
    })?;
    let stop_watchdog = Arc::new(AtomicBool::new(false));
    let watchdog_stop = Arc::clone(&stop_watchdog);
    let watchdog_projection = projection.clone();
    let watchdog_connection = connection.clone();
    let watchdog = thread::spawn(move || {
        while !watchdog_stop.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_secs(1));
            if watchdog_stop.load(Ordering::Relaxed) {
                break;
            }
            let _ = zbus::block_on(watchdog_projection.emit_changed(watchdog_connection.inner()));
        }
    });
    let mut registered_watcher_owner = None;
    let result: zbus::Result<()> = (|| {
        registered_watcher_owner = Some(watcher_owner);
        for message in owner_changes {
            let message = message?;
            let signal = NameOwnerChanged::from_message(message).ok_or_else(|| {
                zbus::Error::Failure("owner-change iterator yielded a non-owner signal".to_owned())
            })?;
            let args = signal.args()?;
            let owner = args.new_owner().as_ref().map(ToString::to_string);
            match args.name().as_str() {
                KWIN_SERVICE => {
                    endpoint.owner_changed(owner.as_deref());
                    zbus::block_on(projection.emit_changed(connection.inner()))?;
                }
                STATUS_NOTIFIER_WATCHER_SERVICE => {
                    handle_watcher_owner_change(&mut registered_watcher_owner, owner, |owner| {
                        register_status_notifier_item_with_retry(&connection, owner)
                    })?
                }
                _ => {}
            }
        }
        Ok(())
    })();
    stop_watchdog.store(true, Ordering::Relaxed);
    let _ = watchdog.join();
    let cleanup = if managed {
        crate::tray_lifecycle::cleanup_managed_record()
    } else {
        crate::tray_lifecycle::cleanup_current_record()
    };
    finish_watcher(result, cleanup)
}

fn register_status_notifier_item(
    connection: &Connection,
    expected_owner: &str,
) -> zbus::Result<()> {
    connection
        .call_method(
            Some(STATUS_NOTIFIER_WATCHER_SERVICE),
            STATUS_NOTIFIER_WATCHER_OBJECT,
            Some(STATUS_NOTIFIER_WATCHER_INTERFACE),
            REGISTER_STATUS_NOTIFIER_ITEM,
            &(SERVICE,),
        )
        .map(|_| ())?;
    let owner = DBusProxy::new(connection)?
        .get_name_owner(STATUS_NOTIFIER_WATCHER_SERVICE.try_into().unwrap())?;
    if owner.as_str() != expected_owner {
        return Err(zbus::Error::Failure(
            "status notifier watcher owner changed during registration".to_owned(),
        ));
    }
    Ok(())
}

fn request_service_name(connection: &Connection) -> zbus::Result<()> {
    match connection.request_name_with_flags(SERVICE, RequestNameFlags::DoNotQueue.into())? {
        RequestNameReply::PrimaryOwner => Ok(()),
        reply => Err(zbus::Error::Failure(format!(
            "helper service name was not acquired: {reply}"
        ))),
    }
}

fn register_status_notifier_item_with_retry(
    connection: &Connection,
    expected_owner: &str,
) -> zbus::Result<()> {
    retry_registration(
        || register_status_notifier_item(connection, expected_owner),
        || thread::sleep(WATCHER_REGISTRATION_RETRY_DELAY),
    )
}

fn handle_watcher_owner_change<Register>(
    registered_owner: &mut Option<String>,
    new_owner: Option<String>,
    register: Register,
) -> zbus::Result<()>
where
    Register: FnOnce(&str) -> zbus::Result<()>,
{
    if new_owner.as_deref() == registered_owner.as_deref() {
        return Ok(());
    }

    *registered_owner = None;
    let Some(new_owner) = new_owner else {
        return Err(zbus::Error::Failure(
            "status notifier watcher ownership was lost after registration".to_owned(),
        ));
    };

    register(&new_owner)?;
    *registered_owner = Some(new_owner);
    Ok(())
}

async fn verify_kwin_publisher(
    connection: &zbus::Connection,
    publisher: &str,
) -> Option<PublisherIdentity> {
    let unique_name = zbus::names::UniqueName::try_from(publisher).ok()?;
    let Ok(dbus) = zbus::fdo::DBusProxy::new(connection).await else {
        return None;
    };
    let Ok(owner) = dbus
        .get_name_owner(KWIN_SERVICE.try_into().expect("valid KWin service name"))
        .await
    else {
        return None;
    };
    if owner.as_str() != publisher {
        return None;
    }
    let Ok(credentials) = dbus.get_connection_credentials(unique_name.into()).await else {
        return None;
    };
    if credentials.unix_user_id() != Some(rustix::process::geteuid().as_raw()) {
        return None;
    }
    let process_id = credentials.process_id()?;
    let process = ProcProcessControl {
        proc_root: Path::new("/proc").to_path_buf(),
    };
    let process_identity = process.identity(process_id).ok().flatten()?;
    let approved = resolve_approved_kwin_identities()
        .into_iter()
        .find(|approved| matches_approved_identity(&process_identity, approved))?;
    let current_owner = dbus
        .get_name_owner(KWIN_SERVICE.try_into().expect("valid KWin service name"))
        .await
        .ok()?;
    if current_owner.as_str() != publisher {
        return None;
    }
    Some(PublisherIdentity {
        process_id,
        process: process_identity,
        approved,
    })
}

fn retry_registration<T, E, Register, Delay>(
    mut register: Register,
    mut delay: Delay,
) -> Result<T, E>
where
    Register: FnMut() -> Result<T, E>,
    Delay: FnMut(),
{
    let mut last_error = None;
    for attempt in 0..WATCHER_REGISTRATION_ATTEMPTS {
        match register() {
            Ok(value) => return Ok(value),
            Err(error) => {
                last_error = Some(error);
                if attempt + 1 < WATCHER_REGISTRATION_ATTEMPTS {
                    delay();
                }
            }
        }
    }

    Err(last_error.expect("watcher registration attempts are non-empty"))
}

fn finish_watcher(result: zbus::Result<()>, cleanup: Result<(), String>) -> zbus::Result<()> {
    match (result, cleanup) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), Err(error)) => Err(zbus::Error::Failure(format!(
            "clean tray PID record: {error}"
        ))),
        (Err(error), Err(cleanup)) => Err(zbus::Error::Failure(format!(
            "{error}; clean tray PID record: {cleanup}"
        ))),
    }
}

fn lifecycle_error(message: String, cleanup: Result<(), String>) -> zbus::Error {
    zbus::Error::Failure(match cleanup {
        Ok(()) => message,
        Err(cleanup) => format!("{message}; cleanup: {cleanup}"),
    })
}

fn reconcile_initial_owner<Observed, Resolved>(
    observe_owner: Observed,
    resolve_owner: Resolved,
) -> zbus::fdo::Result<Option<String>>
where
    Observed: FnOnce() -> zbus::fdo::Result<bool>,
    Resolved: FnOnce() -> zbus::fdo::Result<String>,
{
    if observe_owner()? {
        match resolve_owner() {
            Ok(owner) => Ok(Some(owner)),
            Err(zbus::fdo::Error::NameHasNoOwner(_)) => Ok(None),
            Err(error) => Err(error),
        }
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::path::PathBuf;
    use std::rc::Rc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Barrier};
    use std::thread;
    use std::time::Duration;

    use super::{
        APPROVED_KWIN_ENTRYPOINTS, KWIN_SERVICE, REGISTER_STATUS_NOTIFIER_ITEM, SERVICE,
        STATUS_NOTIFIER_WATCHER_INTERFACE, STATUS_NOTIFIER_WATCHER_OBJECT,
        STATUS_NOTIFIER_WATCHER_SERVICE, authorized_publisher, handle_watcher_owner_change,
        invalid_snapshot_reason, owner_changes_match_rule, owner_outcome_line,
        publish_early_refusal_line, publish_outcome_line, reconcile_initial_owner,
        retry_registration, status_projected_line,
    };

    fn approved_identity() -> super::ApprovedKwinIdentity {
        super::ApprovedKwinIdentity {
            canonical_path: PathBuf::from("/nix/store/host-kwin-6.7.4/bin/kwin_wayland"),
            executable: crate::tray_lifecycle::ProcessExecutableIdentity {
                dev: 1,
                ino: 1,
                content: b"host-kwin".to_vec(),
            },
        }
    }

    fn publisher_identity(process_id: u32) -> super::PublisherIdentity {
        let approved = approved_identity();
        super::PublisherIdentity {
            process_id,
            process: super::ProcessIdentity {
                start_tick: 1,
                resolved_executable_path: approved.canonical_path.clone(),
                executable: approved.executable.clone(),
            },
            approved,
        }
    }

    #[test]
    fn kwin_publisher_binding_requires_an_exact_canonical_host_identity() {
        assert_eq!(
            APPROVED_KWIN_ENTRYPOINTS,
            &[
                "/run/current-system/sw/bin/kwin_wayland",
                "/run/current-system/sw/bin/kwin_wayland_wrapper",
                "/run/current-system/sw/bin/kwin_x11",
                "/usr/bin/kwin_wayland",
                "/usr/bin/kwin_wayland_wrapper",
                "/usr/bin/kwin_x11",
            ]
        );

        let exact = publisher_identity(1);
        assert!(authorized_publisher(
            Some(":1.1"),
            Some(":1.1"),
            &exact,
            None,
            None,
        ));

        for path in [
            "/tmp/kwin_wayland",
            "/nix/store/unrelated-kwin-6.7.4/bin/kwin_wayland",
        ] {
            let mut copied = publisher_identity(1);
            copied.process.resolved_executable_path = PathBuf::from(path);
            assert!(!authorized_publisher(
                Some(":1.1"),
                Some(":1.1"),
                &copied,
                None,
                None,
            ));
        }

        let mut copied = publisher_identity(1);
        copied.process.executable.content = b"different-kwin".to_vec();
        assert!(!authorized_publisher(
            Some(":1.1"),
            Some(":1.1"),
            &copied,
            None,
            None,
        ));
    }

    #[test]
    fn snapshot_acceptance_requires_the_current_unique_kwin_publisher_and_rejects_pid_reuse() {
        let mut state = super::TrayState::default();
        state.owner_changed(Some(":org.kwin"));

        assert_eq!(
            state
                .publish_snapshot_from(
                    None,
                    None,
                    1,
                    super::Snapshot {
                        generation: "alpha".to_owned(),
                        revision: 1,
                        enabled: true,
                    },
                    0,
                )
                .0
                .unwrap_err(),
            super::TrayError::UnauthorizedPublisher
        );
        let mut incomplete_identity = publisher_identity(1);
        incomplete_identity.process.executable.content.clear();
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":org.kwin"),
                    Some(&incomplete_identity),
                    1,
                    super::Snapshot {
                        generation: "alpha".to_owned(),
                        revision: 1,
                        enabled: true,
                    },
                    0,
                )
                .0
                .unwrap_err(),
            super::TrayError::UnauthorizedPublisher
        );
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":other"),
                    Some(&publisher_identity(1)),
                    1,
                    super::Snapshot {
                        generation: "alpha".to_owned(),
                        revision: 1,
                        enabled: true,
                    },
                    0,
                )
                .0
                .unwrap_err(),
            super::TrayError::UnauthorizedPublisher
        );
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":org.kwin"),
                    Some(&publisher_identity(1)),
                    1,
                    super::Snapshot {
                        generation: "alpha".to_owned(),
                        revision: 1,
                        enabled: true,
                    },
                    0,
                )
                .0,
            Ok(())
        );

        let mut changed_identity = publisher_identity(1);
        changed_identity.process.start_tick = 2;
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":org.kwin"),
                    Some(&changed_identity),
                    1,
                    super::Snapshot {
                        generation: "alpha".to_owned(),
                        revision: 2,
                        enabled: false,
                    },
                    1,
                )
                .0
                .unwrap_err(),
            super::TrayError::UnauthorizedPublisher
        );

        state.owner_changed(Some(":org.new-kwin"));
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":org.kwin"),
                    Some(&publisher_identity(1)),
                    1,
                    super::Snapshot {
                        generation: "beta".to_owned(),
                        revision: 1,
                        enabled: false,
                    },
                    1,
                )
                .0
                .unwrap_err(),
            super::TrayError::UnauthorizedPublisher
        );
    }

    #[test]
    fn snapshot_acceptance_rejects_ambiguous_owner_identity() {
        let mut state = super::TrayState::default();
        state.owner_changed(Some("not-a-unique-name"));

        assert_eq!(
            state
                .publish_snapshot_from(
                    Some("not-a-unique-name"),
                    Some(&publisher_identity(1)),
                    1,
                    super::Snapshot {
                        generation: "alpha".to_owned(),
                        revision: 1,
                        enabled: true,
                    },
                    0,
                )
                .0
                .unwrap_err(),
            super::TrayError::UnauthorizedPublisher
        );
    }

    #[test]
    fn replacement_owner_must_reuse_the_trusted_kwin_executable_identity() {
        let mut state = super::TrayState::default();
        state.owner_changed(Some(":old.kwin"));
        let original = publisher_identity(1);
        state
            .publish_snapshot_from(
                Some(":old.kwin"),
                Some(&original),
                1,
                super::Snapshot {
                    generation: "alpha".to_owned(),
                    revision: 0,
                    enabled: true,
                },
                0,
            )
            .0
            .unwrap();

        state.owner_changed(Some(":replacement.kwin"));
        let mut replacement = publisher_identity(2);
        replacement.process.executable.content = b"replacement".to_vec();
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":replacement.kwin"),
                    Some(&replacement),
                    1,
                    super::Snapshot {
                        generation: "beta".to_owned(),
                        revision: 0,
                        enabled: false,
                    },
                    1,
                )
                .0
                .unwrap_err(),
            super::TrayError::UnauthorizedPublisher
        );
    }

    #[test]
    fn owner_transition_waits_for_in_flight_publication_authorization() {
        let endpoint = super::TrayEndpoint::new(Some(":old.kwin"));
        let started = Arc::new(Barrier::new(2));
        let finished = Arc::new(AtomicBool::new(false));
        let worker_endpoint = endpoint.clone();
        let worker_started = Arc::clone(&started);
        let worker_finished = Arc::clone(&finished);
        let worker = thread::spawn(move || {
            worker_started.wait();
            worker_endpoint.owner_changed(Some(":new.kwin"));
            worker_finished.store(true, Ordering::Release);
        });

        let operation_guard = endpoint.operation_lock.lock_blocking();
        started.wait();
        thread::yield_now();
        assert!(!finished.load(Ordering::Acquire));
        drop(operation_guard);
        worker.join().unwrap();
        assert!(finished.load(Ordering::Acquire));
        assert_eq!(
            endpoint.state.lock().unwrap().owner.as_deref(),
            Some(":new.kwin")
        );

        let operation_guard = endpoint.operation_lock.lock_blocking();
        let before = endpoint.started.elapsed().as_millis() as u64;
        thread::sleep(Duration::from_millis(5));
        // Collection happens under the locks and returns the pending line to
        // the caller: the caller (here, the test, standing in for the D-Bus
        // handler) owns emission after release. The accepted record pins the
        // exact line collected for this publication.
        let (result, pending) = endpoint.publish_authenticated_snapshot(
            ":new.kwin",
            &publisher_identity(1),
            1,
            super::Snapshot {
                generation: "alpha".to_owned(),
                revision: 1,
                enabled: true,
            },
        );
        result.unwrap();
        assert_eq!(
            pending,
            Some(
                "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=accepted generation=alpha revision=1 enabled=true"
                    .to_owned()
            )
        );
        // Both locks are still acquirable-or-held in the documented order
        // here; emission belongs after this guard drops.
        assert!(endpoint.state.try_lock().is_ok());
        drop(operation_guard);
        let refreshed_at = endpoint.state.lock().unwrap().view(before).refreshed_at;
        assert!(refreshed_at.is_some_and(|refreshed_at| refreshed_at > before));
    }

    #[test]
    fn steady_state_duplicate_publish_leaves_observable_state_unchanged_for_coalescing() {
        // Finding 7: the endpoint stays silent on steady-state duplicates
        // (no state change) and emits only on state changes or refusals,
        // using existing state only with no new timing/state behavior and no
        // raw snapshot logging. The duplicate heartbeat below must leave the
        // observable (generation, revision, enabled) triple unchanged, which
        // is the silence signal the endpoint gates `eprintln` on.
        let mut state = super::TrayState::default();
        state.owner_changed(Some(":org.kwin"));
        let identity = publisher_identity(1);
        state
            .publish_snapshot_from(
                Some(":org.kwin"),
                Some(&identity),
                1,
                super::Snapshot {
                    generation: "alpha".to_owned(),
                    revision: 1,
                    enabled: true,
                },
                0,
            )
            .0
            .unwrap();
        let before = (
            state.generation.clone(),
            state.revision,
            state.snapshot.as_ref().map(|current| current.enabled),
        );
        state
            .publish_snapshot_from(
                Some(":org.kwin"),
                Some(&identity),
                1,
                super::Snapshot {
                    generation: "alpha".to_owned(),
                    revision: 1,
                    enabled: true,
                },
                1,
            )
            .0
            .unwrap();
        // Same generation/revision/enabled is accepted but changes nothing
        // observable: the endpoint treats this as a silent heartbeat.
        let after_duplicate = (
            state.generation.clone(),
            state.revision,
            state.snapshot.as_ref().map(|current| current.enabled),
        );
        assert_eq!(after_duplicate.0, before.0);
        assert_eq!(after_duplicate.1, before.1);
        assert_eq!(after_duplicate.2, before.2);
        // A genuine state change alters the triple: the endpoint emits one
        // bounded lifecycle line for it.
        state
            .publish_snapshot_from(
                Some(":org.kwin"),
                Some(&identity),
                1,
                super::Snapshot {
                    generation: "alpha".to_owned(),
                    revision: 2,
                    enabled: true,
                },
                2,
            )
            .0
            .unwrap();
        let after_change = (
            state.generation.clone(),
            state.revision,
            state.snapshot.as_ref().map(|current| current.enabled),
        );
        assert_ne!(after_change, before);
    }

    #[test]
    fn watcher_registration_retry_is_bounded_and_retries_transient_failures() {
        let mut attempts = 0;
        let mut delays = 0;
        let result = retry_registration(
            || {
                attempts += 1;
                if attempts < 3 {
                    Err("transient")
                } else {
                    Ok(())
                }
            },
            || delays += 1,
        );

        assert_eq!(result, Ok(()));
        assert_eq!(attempts, 3);
        assert_eq!(delays, 2);

        attempts = 0;
        delays = 0;
        let result = retry_registration(
            || {
                attempts += 1;
                Err::<(), _>("permanent")
            },
            || delays += 1,
        );
        assert_eq!(result, Err("permanent"));
        assert_eq!(attempts, 3);
        assert_eq!(delays, 2);
    }

    #[test]
    fn watcher_loss_after_registration_returns_a_terminal_error_without_reregistering() {
        let mut registered_owner = Some(":watcher".to_owned());
        let mut registration_attempts = 0;
        let result = handle_watcher_owner_change(&mut registered_owner, None, |_| {
            registration_attempts += 1;
            Ok(())
        });

        let error = super::finish_watcher(result, Ok(()))
            .unwrap_err()
            .to_string();
        assert!(error.contains("ownership was lost"));
        assert_eq!(registered_owner, None);
        assert_eq!(registration_attempts, 0);
    }

    #[test]
    fn status_notifier_registration_uses_the_standard_watcher_contract() {
        let message = zbus::message::Message::method_call(
            STATUS_NOTIFIER_WATCHER_OBJECT,
            REGISTER_STATUS_NOTIFIER_ITEM,
        )
        .unwrap()
        .destination(STATUS_NOTIFIER_WATCHER_SERVICE)
        .unwrap()
        .interface(STATUS_NOTIFIER_WATCHER_INTERFACE)
        .unwrap()
        .build(&(SERVICE,))
        .unwrap();

        assert_eq!(
            message.header().destination().unwrap().to_string(),
            STATUS_NOTIFIER_WATCHER_SERVICE
        );
        assert_eq!(
            message.header().path().unwrap().to_string(),
            STATUS_NOTIFIER_WATCHER_OBJECT
        );
        assert_eq!(
            message.header().interface().unwrap().to_string(),
            STATUS_NOTIFIER_WATCHER_INTERFACE
        );
        assert_eq!(
            message.header().member().unwrap().to_string(),
            REGISTER_STATUS_NOTIFIER_ITEM
        );
        assert_eq!(message.body().signature().to_string(), "s");
        let body: (String,) = message.body().deserialize().unwrap();
        assert_eq!(body, (SERVICE.to_owned(),));
    }

    #[test]
    fn helper_name_request_contract_disallows_replacement_and_queueing() {
        let flags = zbus::fdo::RequestNameFlags::DoNotQueue as u32;
        assert_eq!(flags, 0x04);
        assert_eq!(flags & (0x01 | 0x02), 0);
    }

    #[test]
    fn owner_loss_during_startup_reconciliation_begins_empty() {
        let calls = Rc::new(RefCell::new(Vec::new()));
        let observed_calls = Rc::clone(&calls);
        let resolved_calls = Rc::clone(&calls);
        let initial_owner = reconcile_initial_owner(
            || {
                observed_calls.borrow_mut().push("observe");
                Ok(true)
            },
            || {
                resolved_calls.borrow_mut().push("resolve");
                Err(zbus::fdo::Error::NameHasNoOwner(KWIN_SERVICE.to_owned()))
            },
        )
        .unwrap();

        assert_eq!(*calls.borrow(), ["observe", "resolve"]);
        assert_eq!(initial_owner, None);
    }

    #[test]
    fn watcher_error_keeps_cleanup_error() {
        let result = super::finish_watcher(
            Err(zbus::Error::Failure("watcher failed".to_owned())),
            Err("record cleanup failed".to_owned()),
        )
        .unwrap_err()
        .to_string();

        assert!(result.contains("watcher failed"));
        assert!(result.contains("record cleanup failed"));
    }

    #[test]
    fn owner_monitor_rule_uses_the_fixed_dbus_owner_contract() {
        let rule = owner_changes_match_rule().unwrap().to_string();
        assert!(rule.contains("type='signal'"), "{rule}");
        assert!(rule.contains("sender='org.freedesktop.DBus'"), "{rule}");
        assert!(rule.contains("interface='org.freedesktop.DBus'"), "{rule}");
        assert!(rule.contains("member='NameOwnerChanged'"), "{rule}");
    }

    #[test]
    fn owner_transition_lines_cover_presence_only_and_stay_silent_without_change() {
        assert_eq!(owner_outcome_line(false, false, false), None);
        assert_eq!(owner_outcome_line(false, true, true), None);
        assert_eq!(
            owner_outcome_line(true, false, true),
            Some(
                "plasma-auto-tiler:route-diag component=tray-endpoint stage=owner event=owner-changed outcome=acquired"
                    .to_owned()
            )
        );
        assert_eq!(
            owner_outcome_line(true, true, false),
            Some(
                "plasma-auto-tiler:route-diag component=tray-endpoint stage=owner event=owner-changed outcome=lost"
                    .to_owned()
            )
        );
        assert_eq!(
            owner_outcome_line(true, true, true),
            Some(
                "plasma-auto-tiler:route-diag component=tray-endpoint stage=owner event=owner-changed outcome=replaced"
                    .to_owned()
            )
        );
    }

    #[test]
    fn publication_lines_accept_change_refuse_and_keep_heartbeat_duplicates_silent() {
        // Steady-state duplicate: accepted but observably unchanged, so the
        // 1 Hz heartbeat stays silent.
        assert_eq!(
            publish_outcome_line(false, &Ok(()), Some("alpha"), 1, true),
            None
        );
        // Genuine state change: one bounded acceptance line carrying the
        // validated generation token plus the i32 revision and the enabled
        // state label. The triple joins with the KWin bridge send line on
        // equality only, with no ancestry claim.
        assert_eq!(
            publish_outcome_line(true, &Ok(()), Some("beta"), 2, false),
            Some(
                "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=accepted generation=beta revision=2 enabled=false"
                    .to_owned()
            )
        );
        // Ordering refusal: bounded reason plus validated generation,
        // revision, and enabled, never raw detail.
        let transition = Err(super::TrayError::InvalidSnapshot(
            "revision is not a valid state transition".to_owned(),
        ));
        let line = publish_outcome_line(false, &transition, Some("alpha"), 3, true)
            .expect("refusal is logged");
        assert_eq!(
            line,
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=refused reason=invalid-transition generation=alpha revision=3 enabled=true"
        );
        assert!(!line.contains("valid state transition"));
        // Schema/generation refusal carries no generation: the token failed
        // validation and is never echoed, only the bounded reason.
        let schema = Err(super::TrayError::InvalidSnapshot(
            "schema or generation is invalid".to_owned(),
        ));
        let line = publish_outcome_line(false, &schema, None, 0, true).unwrap();
        assert!(line.contains("reason=invalid-schema-or-generation"));
        assert!(!line.contains("generation="));
        // Unknown refusal text degrades to the transition label, never echo.
        let hostile = Err(super::TrayError::InvalidSnapshot(
            "alpha\ninjected".to_owned(),
        ));
        let line = publish_outcome_line(false, &hostile, None, 5, true).unwrap();
        assert!(line.contains("reason=invalid-transition"));
        assert!(!line.contains("alpha"));
        assert!(!line.contains("generation="));
        // Authorization refusal: bounded label plus revision only.
        let unauthorized = Err(super::TrayError::UnauthorizedPublisher);
        assert_eq!(
            publish_outcome_line(false, &unauthorized, None, 4, true),
            Some(
                "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=refused reason=unauthorized revision=4"
                    .to_owned()
            )
        );
    }

    #[test]
    fn tray_diag_writer_is_best_effort_and_never_fails_the_caller() {
        // The writer discards the stderr result by signature (returns ()),
        // so a write error can never panic or propagate into tray behavior.
        // This exercises the normal path; the contract is the return type.
        let result: () = super::emit_tray_diag(
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=test event=writer-check outcome=ok",
        );
        assert_eq!(result, ());
    }

    #[test]
    fn invalid_snapshot_reason_never_echoes_refusal_text() {
        assert_eq!(
            invalid_snapshot_reason("schema or generation is invalid"),
            "invalid-schema-or-generation"
        );
        assert_eq!(
            invalid_snapshot_reason("revision is not a valid state transition"),
            "invalid-transition"
        );
        assert_eq!(
            invalid_snapshot_reason("anything-else"),
            "invalid-transition"
        );
    }

    #[test]
    fn early_refusal_and_projection_lines_use_fixed_labels() {
        assert_eq!(
            publish_early_refusal_line("unverified-publisher", 7),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=refused reason=unverified-publisher revision=7"
        );
        assert_eq!(
            publish_early_refusal_line("missing-sender", 7),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=refused reason=missing-sender revision=7"
        );
        for status in ["Active", "Passive", "NeedsAttention"] {
            assert_eq!(
                status_projected_line(status),
                format!(
                    "plasma-auto-tiler:route-diag component=tray-endpoint stage=projection event=projected outcome={status}"
                )
            );
        }
    }

    #[test]
    fn authenticated_publication_state_machine_pins_the_silence_boundary() {
        // Exercises publish_snapshot_from through accept, steady-state
        // duplicate, genuine change, and refusal: the observable triple is
        // the behavior, and publish_outcome_line records exactly the
        // transitions (duplicates silent) without asserting external logs.
        let mut state = super::TrayState::default();
        state.owner_changed(Some(":org.kwin"));
        let identity = publisher_identity(1);
        let snapshot = |generation: &str, revision: i32, enabled: bool| super::Snapshot {
            generation: generation.to_owned(),
            revision,
            enabled,
        };
        let triple = |state: &super::TrayState| {
            (
                state.generation.clone(),
                state.revision,
                state.snapshot.clone(),
            )
        };
        state
            .publish_snapshot_from(
                Some(":org.kwin"),
                Some(&identity),
                1,
                snapshot("alpha", 0, true),
                0,
            )
            .0
            .unwrap();
        assert_eq!(
            publish_outcome_line(true, &Ok(()), Some("alpha"), 0, true).unwrap(),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=accepted generation=alpha revision=0 enabled=true"
        );

        let before = triple(&state);
        state
            .publish_snapshot_from(
                Some(":org.kwin"),
                Some(&identity),
                1,
                snapshot("alpha", 0, true),
                1,
            )
            .0
            .unwrap();
        assert_eq!(triple(&state), before);
        assert_eq!(
            publish_outcome_line(false, &Ok(()), Some("alpha"), 0, true),
            None
        );

        state
            .publish_snapshot_from(
                Some(":org.kwin"),
                Some(&identity),
                1,
                snapshot("alpha", 1, false),
                2,
            )
            .0
            .unwrap();
        assert_ne!(triple(&state), before);
        assert_eq!(
            publish_outcome_line(true, &Ok(()), Some("alpha"), 1, false).unwrap(),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=accepted generation=alpha revision=1 enabled=false"
        );

        let (refusal, refusal_line) = state.publish_snapshot_from(
            Some(":org.kwin"),
            Some(&identity),
            1,
            snapshot("alpha", 0, true),
            3,
        );
        assert!(refusal.is_err());
        // The collected refusal line matches the pure line builder: the
        // endpoint collects (never emits) the record for the caller.
        assert!(
            refusal_line
                .as_deref()
                .is_some_and(|line| line.contains("reason=invalid-transition"))
        );
        assert!(
            publish_outcome_line(false, &refusal, Some("alpha"), 0, true)
                .unwrap()
                .contains("reason=invalid-transition")
        );

        let (unauthorized, _) = state.publish_snapshot_from(
            Some(":other"),
            Some(&publisher_identity(1)),
            1,
            snapshot("alpha", 2, true),
            4,
        );
        assert_eq!(
            unauthorized.unwrap_err(),
            super::TrayError::UnauthorizedPublisher
        );
        assert_eq!(
            publish_early_refusal_line("unauthorized", 2),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=refused reason=unauthorized revision=2"
        );
    }

    #[test]
    fn repeated_invalid_transition_refusals_stay_silent_until_distinct_or_recovered() {
        // 1 Hz heartbeat flooding: the first invalid-transition refusal for
        // one safe snapshot identity collects a line; identical repeats
        // collect nothing; a different reason or identity collects again; a
        // later accepted change visibly recovers and re-arms the record.
        let mut state = super::TrayState::default();
        state.owner_changed(Some(":org.kwin"));
        let identity = publisher_identity(1);
        let snapshot = |generation: &str, revision: i32, enabled: bool| super::Snapshot {
            generation: generation.to_owned(),
            revision,
            enabled,
        };
        let publish =
            |state: &mut super::TrayState, generation: &str, revision: i32, enabled: bool| {
                state.publish_snapshot_from(
                    Some(":org.kwin"),
                    Some(&identity),
                    1,
                    snapshot(generation, revision, enabled),
                    0,
                )
            };

        let (result, line) = publish(&mut state, "alpha", 0, true);
        result.unwrap();
        assert_eq!(
            line,
            Some(
                "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=accepted generation=alpha revision=0 enabled=true"
                    .to_owned()
            )
        );

        // Same revision, flipped enabled: not a valid transition.
        let (result, line) = publish(&mut state, "alpha", 0, false);
        assert!(result.is_err());
        assert_eq!(
            line,
            Some(
                "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=refused reason=invalid-transition generation=alpha revision=0 enabled=false"
                    .to_owned()
            )
        );

        // Identical heartbeat repeats stay silent.
        let (result, line) = publish(&mut state, "alpha", 0, false);
        assert!(result.is_err());
        assert_eq!(line, None);
        let (result, line) = publish(&mut state, "alpha", 0, false);
        assert!(result.is_err());
        assert_eq!(line, None);

        // A different safe snapshot identity logs again.
        let (result, line) = publish(&mut state, "alpha", -1, true);
        assert!(result.is_err());
        assert!(
            line.as_deref()
                .is_some_and(|line| line.contains("revision=-1")),
            "distinct identity was hidden: {line:?}"
        );

        // A different failure category logs again.
        let (result, line) = state.publish_snapshot_from(
            Some(":org.kwin"),
            Some(&identity),
            2,
            snapshot("alpha", 5, true),
            0,
        );
        assert!(result.is_err());
        assert!(
            line.as_deref()
                .is_some_and(|line| line.contains("reason=invalid-schema-or-generation")),
            "distinct category was hidden: {line:?}"
        );

        // A later accepted change visibly recovers (the accepted record is
        // the recovery evidence) and re-arms refusal records.
        let (result, line) = publish(&mut state, "alpha", 1, true);
        result.unwrap();
        assert!(
            line.as_deref()
                .is_some_and(|line| line
                    .contains("outcome=accepted generation=alpha revision=1 enabled=true")),
            "recovery record missing: {line:?}"
        );
        let (result, line) = publish(&mut state, "alpha", 0, false);
        assert!(result.is_err());
        assert!(
            line.as_deref().is_some_and(|line| line
                .contains("reason=invalid-transition generation=alpha revision=0 enabled=false")),
            "post-recovery refusal was hidden: {line:?}"
        );
    }

    #[test]
    fn early_unauthorized_refusals_are_change_driven_and_rearmed_by_owner_change() {
        // Pre-authentication refusals carry only the fixed reason and the
        // `i32` revision: identical repeats stay silent, a distinct revision
        // logs, and a real owner transition starts a new episode.
        let mut state = super::TrayState::default();
        state.owner_changed(Some(":org.kwin"));
        let snapshot = |revision: i32| super::Snapshot {
            generation: "alpha".to_owned(),
            revision,
            enabled: true,
        };

        let (result, line) =
            state.publish_snapshot_from(Some(":org.kwin"), None, 1, snapshot(1), 0);
        assert_eq!(result.unwrap_err(), super::TrayError::UnauthorizedPublisher);
        assert_eq!(
            line,
            Some(
                "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=refused reason=unauthorized revision=1"
                    .to_owned()
            )
        );

        let (result, line) =
            state.publish_snapshot_from(Some(":org.kwin"), None, 1, snapshot(1), 1);
        assert_eq!(result.unwrap_err(), super::TrayError::UnauthorizedPublisher);
        assert_eq!(line, None);

        let (result, line) =
            state.publish_snapshot_from(Some(":org.kwin"), None, 1, snapshot(2), 2);
        assert_eq!(result.unwrap_err(), super::TrayError::UnauthorizedPublisher);
        assert!(
            line.as_deref()
                .is_some_and(|line| line.contains("revision=2")),
            "distinct revision was hidden: {line:?}"
        );

        // A real owner transition re-arms: the same refusal identity under
        // the new epoch logs again. The raw owner never appears in records.
        state.owner_changed(Some(":org.other"));
        let (result, line) =
            state.publish_snapshot_from(Some(":org.other"), None, 1, snapshot(1), 3);
        assert_eq!(result.unwrap_err(), super::TrayError::UnauthorizedPublisher);
        let line = line.expect("owner change re-arms the refusal record");
        assert!(line.contains("revision=1"));
        assert!(!line.contains(":org.other"));
        assert!(!line.contains(":org.kwin"));

        // An idempotent owner signal does not re-arm: the repeat stays silent.
        state.owner_changed(Some(":org.other"));
        let (result, line) =
            state.publish_snapshot_from(Some(":org.other"), None, 1, snapshot(1), 4);
        assert_eq!(result.unwrap_err(), super::TrayError::UnauthorizedPublisher);
        assert_eq!(line, None);
    }

    #[test]
    fn missing_sender_refusals_are_change_driven_and_rearmed_by_acceptance() {
        // The sender-less refusal shares the change-driven tracker with every
        // other refusal record: identical repeats stay silent, a distinct
        // revision or reason logs, and a visibly accepted change re-arms.
        // Only the fixed reason and the `i32` revision are ever carried.
        let mut state = super::TrayState::default();
        assert_eq!(
            state.collect_early_refusal("missing-sender", 3),
            Some(
                "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=refused reason=missing-sender revision=3"
                    .to_owned()
            )
        );
        assert_eq!(state.collect_early_refusal("missing-sender", 3), None);
        assert!(
            state
                .collect_early_refusal("missing-sender", 4)
                .as_deref()
                .is_some_and(|line| line.contains("revision=4")),
            "distinct revision was hidden"
        );
        assert!(
            state
                .collect_early_refusal("unverified-publisher", 4)
                .as_deref()
                .is_some_and(|line| line.contains("reason=unverified-publisher")),
            "distinct reason was hidden"
        );

        // A visibly accepted change re-arms the sender-less record.
        state.owner_changed(Some(":org.kwin"));
        let identity = publisher_identity(1);
        let (result, _) = state.publish_snapshot_from(
            Some(":org.kwin"),
            Some(&identity),
            1,
            super::Snapshot {
                generation: "alpha".to_owned(),
                revision: 0,
                enabled: true,
            },
            0,
        );
        result.unwrap();
        let line = state
            .collect_early_refusal("missing-sender", 3)
            .expect("acceptance re-arms the sender-less record");
        assert!(line.contains("revision=3"));
        assert!(!line.contains(":org.kwin"));
    }

    #[test]
    fn diag_tracker_suppresses_repeats_and_scopes_recovery() {
        // Pure diagnostic-memory semantics: repeats suppress, accepted
        // changes and owner transitions clear everything, and signal success
        // re-arms only signal-stage suppression.
        let mut tracker = super::TrayDiagTracker::default();
        let signal = super::signal_emission_failed_line();
        assert_eq!(
            signal,
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=signal event=emit outcome=emission-failed"
        );
        assert_eq!(tracker.failure_line(signal.clone()), Some(signal.clone()));
        assert_eq!(tracker.failure_line(signal.clone()), None);
        tracker.note_signal_success();
        assert_eq!(
            tracker.failure_line(signal.clone()),
            Some(signal.clone()),
            "signal recovery must re-arm the signal record"
        );

        let refusal = super::publish_early_refusal_line("unverified-publisher", 7);
        assert_eq!(tracker.failure_line(refusal.clone()), Some(refusal.clone()));
        tracker.note_signal_success();
        assert_eq!(
            tracker.failure_line(refusal.clone()),
            None,
            "signal success must not clear publish-stage suppression"
        );
        tracker.note_accepted_change();
        assert_eq!(
            tracker.failure_line(refusal.clone()),
            Some(refusal.clone()),
            "accepted change must clear failure memory"
        );
        tracker.note_owner_change();
        assert_eq!(
            tracker.failure_line(refusal.clone()),
            Some(refusal.clone()),
            "owner change must clear failure memory"
        );
    }

    #[test]
    fn endpoint_level_repeated_refusals_collect_once_then_silence() {
        // Collection through the endpoint (no caller locks held): the first
        // refusal for one identity returns its pending record, the identical
        // repeat returns none, and the record leaks no owner or raw detail.
        let endpoint = super::TrayEndpoint::new(Some(":org.kwin"));
        let identity = publisher_identity(1);
        let snapshot = |revision: i32, enabled: bool| super::Snapshot {
            generation: "alpha".to_owned(),
            revision,
            enabled,
        };
        let (result, _) =
            endpoint.publish_authenticated_snapshot(":org.kwin", &identity, 1, snapshot(0, true));
        result.unwrap();

        let (result, line) =
            endpoint.publish_authenticated_snapshot(":org.kwin", &identity, 1, snapshot(0, false));
        assert!(result.is_err());
        let first = line.expect("first refusal collects a record");
        assert!(
            first.contains("reason=invalid-transition generation=alpha revision=0 enabled=false")
        );
        assert!(!first.contains(":org.kwin"));

        let (result, line) =
            endpoint.publish_authenticated_snapshot(":org.kwin", &identity, 1, snapshot(0, false));
        assert!(result.is_err());
        assert_eq!(line, None);
    }
}
