use std::collections::VecDeque;
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

pub const SERVICE: &str = "org.plasmaautotiler.Tray";
pub const OBJECT: &str = "/org/plasmaautotiler/Tray";
pub const INTERFACE: &str = "org.plasmaautotiler.Tray1";
pub const METHOD: &str = "PublishSnapshot";
pub const KWIN_SERVICE: &str = "org.kde.KWin";
pub const FRESHNESS_MS: u64 = 30_000;
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

#[derive(Debug, Default)]
pub struct TrayState {
    owner: Option<String>,
    generation: Option<String>,
    revision: Option<i32>,
    ordering_conflicted: bool,
    /// Row Q one-shot: after poison recovery the next fresh heartbeat
    /// repeats the same generation/revision (KWin only bumps revision on
    /// change), which the ordinary equal-revision fence would refuse once
    /// the retained snapshot is gone. Allows exactly one same-generation
    /// same-revision acceptance; any other generation/revision still follows
    /// the ordinary fences. Cleared on accept or owner epoch change.
    poison_same_revision_once: bool,
    snapshot: Option<Snapshot>,
    revoked_snapshot: Option<Snapshot>,
    refreshed_at: Option<u64>,
    retired_generations: VecDeque<String>,
    quarantined_generations: VecDeque<String>,
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
            self.poison_same_revision_once = false;
            self.retired_generations.clear();
            self.quarantined_generations.clear();
            self.revoked_snapshot = None;
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
                    if self.poison_same_revision_once && incoming.revision == revision {
                        true
                    } else if self.ordering_conflicted {
                        incoming.revision > revision
                    } else {
                        incoming.revision > revision
                            || (incoming.revision == revision
                                && (self.snapshot.as_ref() == Some(&incoming)
                                    || self.revoked_snapshot.as_ref() == Some(&incoming)))
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
            self.poison_same_revision_once = false;
            self.snapshot = Some(incoming);
            self.revoked_snapshot = None;
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
        live_owner: Option<&str>,
        schema: i32,
        snapshot: Snapshot,
        now_ms: u64,
    ) -> (Result<(), TrayError>, Option<String>) {
        // Collection only: every diagnostic line below is returned to the
        // caller and emitted after the state mutex (and, on the D-Bus path,
        // the operation lock) are released. Logging never changes the result.
        // Same-UID session bus callers are trusted: the only authorization is
        // that the sender unique name equals the current org.kde.KWin owner,
        // checked against both the cached owner epoch and a live bus query
        // (the caller passes the live query result). No executable allowlist,
        // no /proc or pidfd bindings. Fail-closed on any mismatch.
        let Some(publisher) = publisher else {
            let line = self.collect_early_refusal("missing-sender", snapshot.revision);
            return (Err(TrayError::UnauthorizedPublisher), line);
        };
        if !authorized_publisher(self.owner.as_deref(), live_owner, Some(publisher)) {
            let line = self.collect_early_refusal("not-current-KWin-owner", snapshot.revision);
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

    /// Race fail-closed: a snapshot accepted under a live owner that moved
    /// before the post-publish re-query is revoked before the locks release,
    /// so it is never served or signalled. Generation/revision history is
    /// kept as a replay floor; the pending owner-change signal resyncs the
    /// cached epoch.
    fn revoke_accepted_snapshot(&mut self) {
        self.revoked_snapshot = self.snapshot.clone();
        self.clear_snapshot();
    }

    /// Row Q: poison recovery at the lock boundary. A previous panic under
    /// the state lock leaves the guarded snapshot untrusted, so recovery
    /// clears the served snapshot (forcing `NeedsAttention` until a fresh
    /// publish arrives) and re-arms diagnostic failure memory, while keeping
    /// the owner epoch and generation/revision replay floors so the next
    /// fresh publish is authorized and ordered correctly. Arms a one-shot
    /// same-generation same-revision acceptance for the next fresh heartbeat
    /// from the current live KWin owner (KWin repeats the same revision
    /// until the state changes); all other transitions keep the ordinary
    /// fences, and the one-shot clears on accept or owner epoch change.
    pub(crate) fn recover_poisoned(&mut self) {
        self.clear_snapshot();
        self.revoked_snapshot = None;
        self.poison_same_revision_once = self.generation.is_some() && self.revision.is_some();
        self.diag = TrayDiagTracker::default();
    }
}

/// Row Q: lock the shared tray state, recovering a poisoned mutex at the
/// boundary instead of panicking. Recovery never serves the pre-poison
/// snapshot (see [`TrayState::recover_poisoned`]); the caller's fresh
/// observation (publish, owner change, or view) then proceeds normally.
pub(crate) fn lock_tray_state(
    state: &Arc<Mutex<TrayState>>,
) -> std::sync::MutexGuard<'_, TrayState> {
    match state.lock() {
        Ok(guard) => guard,
        Err(poison) => {
            let mut guard = poison.into_inner();
            guard.recover_poisoned();
            state.clear_poison();
            guard
        }
    }
}

fn valid_generation(generation: &str) -> bool {
    (1..=32).contains(&generation.len())
        && generation
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// Fail-closed publisher check: the sender unique name must equal the
/// current org.kde.KWin owner. Both the cached owner epoch (updated on
/// NameOwnerChanged) and a live bus query must agree with the sender; any
/// missing value, mismatch, or non-unique name refuses. Same-UID session bus
/// callers are trusted beyond this: no executable allowlist, no /proc or
/// pidfd bindings.
fn authorized_publisher(
    cached_owner: Option<&str>,
    live_owner: Option<&str>,
    publisher: Option<&str>,
) -> bool {
    let (Some(cached), Some(live), Some(publisher)) = (cached_owner, live_owner, publisher) else {
        return false;
    };

    cached == publisher
        && live == publisher
        && zbus::names::UniqueName::try_from(cached).is_ok()
        && zbus::names::UniqueName::try_from(publisher).is_ok()
}

/// Fail-closed live check used around the state transition: the sender must
/// equal the freshly queried KWin owner. The cached epoch is checked
/// separately inside [`TrayState::publish_snapshot_from`].
fn sender_is_current_kwin_owner(publisher: &str, live_owner: Option<&str>) -> bool {
    let Some(live) = live_owner else {
        return false;
    };
    live == publisher && zbus::names::UniqueName::try_from(publisher).is_ok()
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
            "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=publish event=publish outcome=refused reason=not-current-KWin-owner revision={revision}"
        )),
        Err(TrayError::EmissionFailed(_)) => Some(format!(
            "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=publish event=publish outcome=refused reason=emission-failed revision={revision}"
        )),
    }
}

/// Bounded refusal record for publications rejected before authentication.
/// `reason` must be a fixed label (`missing-sender`,
/// `not-current-KWin-owner`); only the `i32` revision is carried as snapshot
/// identity.
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

/// Bounded service-name acquisition records. The well-known service name is
/// fixed, so no sender or unique name is ever carried. `acquired` is the
/// single-instance win; `taken` is the second instance exiting 0.
fn service_name_acquired_line() -> String {
    format!(
        "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=name event=acquire outcome=acquired"
    )
}

/// Bounded single-instance record: another tray already owns the name, so
/// this instance exits 0 without serving.
fn service_name_taken_line() -> String {
    format!(
        "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=name event=acquire outcome=taken"
    )
}

/// Bounded service-name loss record. Terminal: the serving loop exits after
/// emitting it.
fn service_name_lost_line() -> String {
    format!(
        "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=name event=name-lost outcome=lost"
    )
}

/// Bounded malformed owner-signal record. The signal payload is never
/// carried, only the fixed failure category. The serving loop emits this and
/// continues; a later valid signal re-resolves and reprojects.
fn owner_signal_malformed_line() -> String {
    format!(
        "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=owner event=signal outcome=malformed-signal"
    )
}

/// Bounded invalid owner-signal args record. The decode error is never
/// carried, only the fixed failure category. The serving loop emits this and
/// continues; a later valid signal re-resolves and reprojects.
fn owner_signal_args_invalid_line() -> String {
    format!(
        "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=owner event=signal outcome=invalid-args"
    )
}

/// Single-instance decision over a `DoNotQueue` name request. `PrimaryOwner`
/// and `AlreadyOwner` proceed to serve; `Exists` (the `DoNotQueue` taken
/// reply) and `InQueue` (defensive: unreachable with `DoNotQueue`) exit 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NameAcquire {
    Acquired,
    Taken,
}

fn classify_name_reply(reply: RequestNameReply) -> NameAcquire {
    match reply {
        RequestNameReply::PrimaryOwner | RequestNameReply::AlreadyOwner => NameAcquire::Acquired,
        RequestNameReply::Exists | RequestNameReply::InQueue => NameAcquire::Taken,
    }
}

/// Pure name-loss decision: terminal when our tray name loses its owner.
fn tray_name_lost(name: &str, new_owner: Option<&str>, our_unique: Option<&str>) -> bool {
    if name != SERVICE {
        return false;
    }
    match (new_owner, our_unique) {
        (Some(next), Some(ours)) => next != ours,
        (None, _) => true,
        (_, None) => new_owner.is_none(),
    }
}

/// Live well-known-name owner query. `Ok(owner)` is the current owner,
/// `Ok(None)` means the name presently has no owner, `Err` is a transport
/// or proxy failure. Never logs: callers carry only fixed labels, never
/// the queried identity.
fn query_name_owner(connection: &Connection, service: &str) -> zbus::Result<Option<String>> {
    let dbus = DBusProxy::new(connection)?;
    let name: zbus::names::BusName<'_> = service
        .try_into()
        .map_err(|_| zbus::Error::Failure("invalid service name".to_owned()))?;
    match dbus.get_name_owner(name) {
        Ok(owner) => Ok(Some(owner.to_string())),
        Err(zbus::fdo::Error::NameHasNoOwner(_)) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// Live service-loss check for the serving loop. Re-resolves the tray name
/// instead of trusting the event, so a stale replay or an overflow-dropped
/// signal can never hide a loss. An unresolvable query falls back to the
/// event's owner, so transient bus errors never evict a healthy owner;
/// a genuinely unowned name still exits (we must own it).
fn service_name_lost_live(
    connection: &Connection,
    event_owner: Option<&str>,
    our_unique: Option<&str>,
) -> bool {
    match query_name_owner(connection, SERVICE) {
        Ok(live) => tray_name_lost(SERVICE, live.as_deref(), our_unique),
        Err(_) => tray_name_lost(SERVICE, event_owner, our_unique),
    }
}

/// Native journal submission address for the documented Linux journald
/// datagram protocol: one `AF_UNIX` datagram per entry.
#[cfg(not(test))]
const TRAY_JOURNAL_SOCKET: &str = "/run/systemd/journal/socket";
/// Fixed journal identifier for tray endpoint records. The diagnostic line
/// itself stays in `MESSAGE`, so the existing
/// `plasma-auto-tiler:route-diag component=tray-endpoint` filter keeps
/// working; no sender, owner, PID, or raw detail is ever added here.
const TRAY_JOURNAL_IDENTIFIER: &str = "plasma-auto-tiler-tray";
/// Syslog info: tray records are normal-operation lifecycle diagnostics.
const TRAY_JOURNAL_PRIORITY: &str = "6";

/// Pure journald datagram payload builder. Returns `None` when the line
/// carries `\n` or `\r`, so a hostile or malformed line can never inject an
/// extra journal field; the stderr fallback below still carries it.
fn tray_journal_payload(line: &str) -> Option<Vec<u8>> {
    if line.contains('\n') || line.contains('\r') {
        return None;
    }
    Some(
        format!(
            "PRIORITY={TRAY_JOURNAL_PRIORITY}\nSYSLOG_IDENTIFIER={TRAY_JOURNAL_IDENTIFIER}\nMESSAGE={line}\n"
        )
        .into_bytes(),
    )
}

/// Best-effort journald submission. Every setup/send error is ignored:
/// submission is not acknowledgement and never affects tray behavior.
#[cfg(not(test))]
fn submit_tray_journal(payload: &[u8]) {
    submit_tray_journal_to(payload, TRAY_JOURNAL_SOCKET);
}

/// Path-parameterized submission used by [`submit_tray_journal`]. The
/// indirection exists so offline tests can verify the real datagram send
/// path against a fixture socket without touching the host journal socket.
fn submit_tray_journal_to(payload: &[u8], socket_path: &str) {
    let result = (|| -> std::io::Result<()> {
        let socket = std::os::unix::net::UnixDatagram::unbound()?;
        socket.set_nonblocking(true)?;
        let _ = socket.send_to(payload, socket_path)?;
        Ok(())
    })();
    let _ = result;
}

/// Best-effort tray diagnostic writer. Standard printing panics on a stderr
/// write error, so tray diagnostics use this instead: the write result is
/// discarded and logging can never affect tray behavior. Records go to the
/// inherited stderr (manual terminal runs, existing captures) and, in the
/// same call, best-effort to the user journal via the native datagram
/// protocol (queryable sink for XDG-autostarted runs, where stderr has no
/// repository-owned capture). Stderr is retained universally: where stderr
/// is already journal-connected the same `MESSAGE` may appear twice, and
/// message equality joins those twins. No `JOURNAL_STREAM` suppression
/// check: that would add device/inode comparison for no reliability gain.
pub(crate) fn emit_tray_diag(line: &str) {
    use std::io::Write as _;
    let _ = writeln!(std::io::stderr(), "{line}");
    // Unit tests exercise the send path with a private fixture socket.
    #[cfg(not(test))]
    if let Some(payload) = tray_journal_payload(line) {
        submit_tray_journal(&payload);
    }
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
            let mut state = lock_tray_state(&self.state);
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
        live_owner: Option<&str>,
        schema: i32,
        snapshot: Snapshot,
    ) -> (Result<(), TrayError>, Option<String>) {
        // State transition only; the pending diagnostic line (if any) is
        // returned for the caller to emit after the state mutex (and, on the
        // D-Bus path, the operation lock) are released. Logging never changes
        // the result below.
        let mut state = lock_tray_state(&self.state);
        state.publish_snapshot_from(
            Some(publisher),
            live_owner,
            schema,
            snapshot,
            self.started.elapsed().as_millis().min(u64::MAX as u128) as u64,
        )
    }

    /// Locked publish step: verifies the sender against the live KWin owner,
    /// publishes, re-queries the owner race fail-closed, and signals while
    /// holding the operation lock, collecting (never emitting) diagnostic
    /// lines. The caller emits the returned lines after the operation lock
    /// and the state mutex are released. Publish/auth/signal ordering,
    /// results, and emission-failure masking match the previous inline
    /// behavior exactly.
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
        // Fail-closed pre-check against the live owner before touching state.
        // Diagnostic-only decision under the state mutex; emission happens
        // after both locks release. No sender or owner is logged, only the
        // fixed reason and the i32 revision.
        let live_before =
            current_kwin_owner_with_deadline(emitter.connection(), OWNER_QUERY_TIMEOUT).await;
        if !sender_is_current_kwin_owner(publisher, live_before.as_deref()) {
            pending.extend(
                lock_tray_state(&self.state)
                    .collect_early_refusal("not-current-KWin-owner", revision),
            );
            return (Err(TrayError::UnauthorizedPublisher), pending);
        }
        let (mut result, line) = self.publish_authenticated_snapshot(
            publisher,
            live_before.as_deref(),
            schema,
            snapshot,
        );
        // Race fail-closed: the KWin owner may have moved between the live
        // query and the state transition. Re-query while still holding the
        // operation lock (owner-change signals serialize on the same lock);
        // an accepted snapshot under a moved owner is revoked before release
        // so it is never served or signalled.
        let live_after =
            current_kwin_owner_with_deadline(emitter.connection(), OWNER_QUERY_TIMEOUT).await;
        if result.is_ok() && !sender_is_current_kwin_owner(publisher, live_after.as_deref()) {
            let mut state = lock_tray_state(&self.state);
            state.revoke_accepted_snapshot();
            let outcome = publish_outcome_line(
                true,
                &Err(TrayError::UnauthorizedPublisher),
                None,
                revision,
                false,
            );
            // Revocation is a refusal: route it through the change-driven
            // tracker like every other refusal. Only the i32 revision is
            // carried, so no untrusted text is echoed here.
            if let Some(refusal) = outcome {
                pending.extend(state.diag.failure_line(refusal));
            }
            result = Err(TrayError::UnauthorizedPublisher);
        } else {
            pending.extend(line);
        }
        if let Err(error) = self.projection().emit_changed(emitter.connection()).await {
            // Best-effort only: the transport error is never logged, only the
            // bounded failure category. The publication result above stands.
            pending.extend(
                lock_tray_state(&self.state)
                    .diag
                    .failure_line(signal_emission_failed_line()),
            );
            return (Err(TrayError::EmissionFailed(error.to_string())), pending);
        }
        // Signal recovery re-arms only signal-stage suppression; the state
        // mutex is held for this diagnostic-only decision alone.
        lock_tray_state(&self.state).diag.note_signal_success();
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
            let line =
                lock_tray_state(&self.state).collect_early_refusal("missing-sender", revision);
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

/// Single-instance tray endpoint. Acquires `org.plasmaautotiler.Tray` with
/// `DoNotQueue`: a taken name means another tray is already serving, so this
/// instance logs one bounded record and exits 0. No PID records, no locks, no
/// executable allowlist. Snapshots are accepted only from the sender unique
/// name equal to the current `org.kde.KWin` owner (live query plus cached
/// epoch, race fail-closed).
pub fn run() -> zbus::Result<()> {
    let connection = Connection::session()?;
    // Owner-change signals are observed on a dedicated monitor connection so a
    // lagging NameOwnerChanged queue can never apply backpressure to the
    // serving connection's socket reader and stall ObjectServer dispatch
    // (SNI properties, Peer.Ping, PublishSnapshot). The serving connection
    // remains dedicated to dispatch, registration, and signal emission.
    //
    // The subscription is established BEFORE any owner resolution or name
    // acquisition. AddMatch is synchronous, so every later change queues a
    // signal on this iterator and no racing change is ever missed. Queued
    // signals are still never trusted for their payload (see
    // `query_name_owner`): each application re-resolves live, so stale
    // replays and iterator-overflow drops always converge instead of
    // wedging the cached epoch. Query-then-subscribe would lose exactly
    // one racing change.
    let monitor = Connection::session()?;
    let owner_changes = monitor_owner_changes(&monitor)?;
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
    match request_service_name(&connection)? {
        NameAcquire::Taken => return Ok(()),
        NameAcquire::Acquired => {}
    }
    let our_unique = connection.unique_name().map(|name| name.to_string());

    // Audit M (option 2): the tray carrier stays alive with no watcher.
    // Registration happens only against a live-confirmed owner; a transient
    // failure leaves the carrier unregistered and retryable, never claimed.
    // Loss of our own service name/connection below stays terminal.
    // The live query, transition, and registration run under the same shared
    // lock on every path, so a watchdog tick can never store an owner that
    // the serving loop already released (stale `Some` forever). The watchdog
    // re-checks the live owner on every tick, so a stale confirmation can
    // never block recovery. Diagnostics are bounded, redacted, and
    // change-driven (no per-tick spam); emission happens after lock release.
    let registered_watcher_owner = Arc::new(Mutex::new(WatcherState::default()));
    if watcher_owner.is_none() {
        emit_tray_diag(&watcher_absent_line());
    }
    {
        let pending = {
            let mut guard = lock_watcher_state(&registered_watcher_owner);
            handle_watcher_owner_change(&mut guard, watcher_owner, |owner| {
                register_status_notifier_item_with_retry(&connection, owner)
            })
        };
        if let Some(line) = pending {
            emit_tray_diag(&line);
        }
    }
    let stop_watchdog = Arc::new(AtomicBool::new(false));
    let watchdog_stop = Arc::clone(&stop_watchdog);
    let watchdog_projection = projection.clone();
    let watchdog_connection = connection.clone();
    let watchdog_watcher_owner = Arc::clone(&registered_watcher_owner);
    let watchdog = thread::spawn(move || {
        let mut emission_failed = false;
        while !watchdog_stop.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_secs(1));
            if watchdog_stop.load(Ordering::Relaxed) {
                break;
            }
            if zbus::block_on(watchdog_projection.emit_changed(watchdog_connection.inner()))
                .is_err()
            {
                if !emission_failed {
                    emit_tray_diag(&signal_emission_failed_line());
                }
                emission_failed = true;
            } else {
                emission_failed = false;
            }
            // Audit M retry: re-resolve the live owner on every tick under
            // the shared lock (same helper as the signal path). A transient
            // registration failure stays retryable while the live owner
            // remains; a stale confirmation is replaced on the next tick.
            // Repeated identical failures stay silent; only transitions,
            // the first failure, and recovery emit.
            let pending = {
                let mut guard = lock_watcher_state(&watchdog_watcher_owner);
                poll_watcher_once(
                    &mut guard,
                    || query_name_owner(&watchdog_connection, STATUS_NOTIFIER_WATCHER_SERVICE),
                    |owner| register_status_notifier_item_with_retry(&watchdog_connection, owner),
                )
            };
            if let Some(line) = pending {
                emit_tray_diag(&line);
            }
        }
    });
    let result: zbus::Result<()> = (|| {
        for message in owner_changes {
            // Transport loss / monitor closed stays terminal via `?` below.
            let message = message?;
            // Audit N: a malformed owner signal or undecodable args logs one
            // bounded redacted record and continues. The next valid signal
            // re-resolves live and reprojects, so transient bus noise never
            // exits the tray. Own-name/connection loss below stays terminal.
            let Some(signal) = NameOwnerChanged::from_message(message) else {
                emit_tray_diag(&owner_signal_malformed_line());
                continue;
            };
            let args = match signal.args() {
                Ok(args) => args,
                Err(_) => {
                    emit_tray_diag(&owner_signal_args_invalid_line());
                    continue;
                }
            };
            let owner = args.new_owner().as_ref().map(ToString::to_string);
            match args.name().as_str() {
                KWIN_SERVICE => {
                    // Never apply the event's new_owner: queued signals can
                    // replay a stale epoch (A->B->C observed at C replays B,
                    // wedging the cache until the next event) or be dropped
                    // on iterator overflow. Re-resolving converges to live
                    // on every signal; failure resolves to no owner
                    // (fail-closed: unknown owner refuses all publishes
                    // until a later signal recovers).
                    endpoint.owner_changed(
                        query_name_owner(&connection, KWIN_SERVICE)
                            .ok()
                            .flatten()
                            .as_deref(),
                    );
                    // Audit N: a failed owner-change notification logs one
                    // bounded redacted record and continues. The transport
                    // error is never carried. The 1 Hz watchdog and the next
                    // valid signal reproject, so this never exits the tray.
                    if zbus::block_on(projection.emit_changed(connection.inner())).is_err() {
                        emit_tray_diag(&signal_emission_failed_line());
                    }
                }
                STATUS_NOTIFIER_WATCHER_SERVICE => {
                    // Live-confirmed only: the queued payload is never
                    // trusted (stale replay/overflow). The live query,
                    // transition, and registration run under the shared lock
                    // (same helper as the watchdog), so concurrent ticks can
                    // never interleave a stale store. Absence, transient
                    // failure, and query errors stay alive unregistered with
                    // one bounded record; the watchdog tick retries while
                    // the live owner remains.
                    let pending = {
                        let mut guard = lock_watcher_state(&registered_watcher_owner);
                        poll_watcher_once(
                            &mut guard,
                            || query_name_owner(&connection, STATUS_NOTIFIER_WATCHER_SERVICE),
                            |owner| register_status_notifier_item_with_retry(&connection, owner),
                        )
                    };
                    if let Some(line) = pending {
                        emit_tray_diag(&line);
                    }
                }
                SERVICE
                    if !service_name_lost_live(
                        &connection,
                        owner.as_deref(),
                        our_unique.as_deref(),
                    ) => {}
                SERVICE => {
                    emit_tray_diag(&service_name_lost_line());
                    return Err(zbus::Error::Failure(
                        "tray service name ownership was lost".to_owned(),
                    ));
                }
                _ => {}
            }
        }
        Ok(())
    })();
    stop_watchdog.store(true, Ordering::Relaxed);
    let _ = watchdog.join();
    result
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

/// Maps a `DoNotQueue` name-request outcome to the single-instance decision.
/// `Exists` never surfaces as `Ok` here: zbus 5.19 converts it to
/// `Err(Error::NameTaken)` before returning (see `Connection::request_name`
/// internals). `InQueue` is unreachable with `DoNotQueue` but stays fail-safe
/// (exiting 0 drops the connection, releasing the queue slot).
fn classify_name_request(result: zbus::Result<RequestNameReply>) -> zbus::Result<NameAcquire> {
    match result {
        Ok(reply) => Ok(classify_name_reply(reply)),
        // Another tray already serves: the caller logs one bounded record
        // and exits 0. Every other error propagates and exits non-zero.
        Err(zbus::Error::NameTaken) => Ok(NameAcquire::Taken),
        Err(error) => Err(error),
    }
}

fn request_service_name(connection: &Connection) -> zbus::Result<NameAcquire> {
    // No `?` on the request itself: `Exists` arrives as `Err(NameTaken)`
    // and only that error maps to exit 0 inside `classify_name_request`.
    let decision = classify_name_request(
        connection.request_name_with_flags(SERVICE, RequestNameFlags::DoNotQueue.into()),
    );
    match decision {
        Ok(NameAcquire::Acquired) => emit_tray_diag(&service_name_acquired_line()),
        Ok(NameAcquire::Taken) => emit_tray_diag(&service_name_taken_line()),
        Err(_) => {}
    }
    decision
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

fn register_status_notifier_item_with_retry(
    connection: &Connection,
    expected_owner: &str,
) -> zbus::Result<()> {
    retry_registration(
        || register_status_notifier_item(connection, expected_owner),
        || thread::sleep(WATCHER_REGISTRATION_RETRY_DELAY),
    )
}

/// Bounded watcher registration records. The D-Bus unique name is never
/// carried: only presence transitions and fixed outcome labels are logged.
/// `registered` is emitted on a confirmed registration (the recovery
/// evidence); `lost` on a live-confirmed absence that clears a prior
/// registration; `registration-failed` on the first transient registration
/// failure per owner episode; `query-failed` on the first live-query transport
/// failure. Steady-state repeats stay silent (no per-tick spam).
fn watcher_registered_line() -> String {
    format!(
        "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=watcher event=register outcome=registered"
    )
}

/// Bounded watcher-loss record. Emitted once per live-confirmed transition
/// from a registered owner to no owner; steady-state absence stays silent.
fn watcher_lost_line() -> String {
    format!(
        "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=watcher event=owner-changed outcome=lost"
    )
}

fn watcher_absent_line() -> String {
    format!(
        "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=watcher event=startup outcome=absent"
    )
}

/// Bounded watcher registration-failure record. The transport error is never
/// carried, only the fixed failure category.
fn watcher_registration_failed_line() -> String {
    format!(
        "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=watcher event=register outcome=registration-failed"
    )
}

/// Bounded watcher live-query failure record. The transport error is never
/// carried; the existing registration is kept and the next tick retries.
fn watcher_query_failed_line() -> String {
    format!(
        "{TRAY_DIAG_PREFIX} component={TRAY_DIAG_COMPONENT} stage=watcher event=query outcome=query-failed"
    )
}

/// Shared watcher registration state. Guarded by a single mutex in `run` so
/// the live query, transition, and registration serialize on every path
/// (signal loop and watchdog tick). `last_failure_line` gates failure records
/// only and is never read by transition, retry, or terminal logic.
#[derive(Debug, Default)]
struct WatcherState {
    registered: Option<String>,
    last_failure_line: Option<String>,
}

fn lock_watcher_state(state: &Mutex<WatcherState>) -> std::sync::MutexGuard<'_, WatcherState> {
    match state.lock() {
        Ok(guard) => guard,
        Err(poison) => {
            let mut guard = poison.into_inner();
            *guard = WatcherState::default();
            state.clear_poison();
            emit_tray_diag(&watcher_registration_failed_line());
            guard
        }
    }
}

impl WatcherState {
    fn failure_line(&mut self, line: String) -> Option<String> {
        if self.last_failure_line.as_deref() == Some(line.as_str()) {
            return None;
        }
        self.last_failure_line = Some(line);
        self.last_failure_line.clone()
    }

    fn note_registered(&mut self) {
        self.last_failure_line = None;
    }
}

/// Audit M (option 2) watcher registration: stay alive unregistered when
/// there is no live-confirmed owner; register whenever one appears; a
/// transient registration failure stays retryable while the owner remains
/// and never claims success until confirmed. Callers must pass a fresh live
/// query result (subscribe-before-query is established in `run`), never the
/// stale signal payload. Returns a bounded redacted diagnostic line on
/// transition, first failure, or recovery, and `None` when nothing changed
/// (idempotent ticks stay silent). Never terminal: only loss of our own
/// service name/connection elsewhere terminates the tray.
fn handle_watcher_owner_change<Register>(
    state: &mut WatcherState,
    live_owner: Option<String>,
    register: Register,
) -> Option<String>
where
    Register: FnOnce(&str) -> zbus::Result<()>,
{
    if live_owner.as_deref() == state.registered.as_deref() {
        return None;
    }

    state.registered = None;
    let Some(live_owner) = live_owner else {
        state.last_failure_line = None;
        return Some(watcher_lost_line());
    };

    match register(&live_owner) {
        Ok(()) => {
            state.registered = Some(live_owner);
            state.note_registered();
            Some(watcher_registered_line())
        }
        Err(_) => state.failure_line(watcher_registration_failed_line()),
    }
}

/// Bounded live-query failure path. Keeps the existing registration (a
/// transient bus error never evicts a healthy owner) and returns the query
/// failure record once per episode; identical repeats stay silent.
fn note_watcher_query_failure(state: &mut WatcherState) -> Option<String> {
    state.failure_line(watcher_query_failed_line())
}

/// Single serialized watcher poll used by both the serving loop and the
/// watchdog tick: live query, transition, and registration run under the
/// caller's shared lock. Every tick re-checks the live owner, so a stale
/// confirmation is replaced rather than wedging recovery. Returns the bounded
/// diagnostic line, if any; callers emit it after releasing the lock.
fn poll_watcher_once<Query, Register>(
    state: &mut WatcherState,
    query: Query,
    register: Register,
) -> Option<String>
where
    Query: FnOnce() -> zbus::Result<Option<String>>,
    Register: FnOnce(&str) -> zbus::Result<()>,
{
    match query() {
        Ok(live) => handle_watcher_owner_change(state, live, register),
        Err(_) => note_watcher_query_failure(state),
    }
}

/// Row P: bounded owner-lookup deadline for the two awaits held under the
/// publication (operation) lock. zbus 5.19 has no timeout on these lookups
/// either, so a hang becomes `None` (fail-closed refusal): the hung query
/// future is dropped, the operation lock releases on return, and no state is
/// touched so a later publication retries.
const OWNER_QUERY_TIMEOUT: Duration = Duration::from_secs(2);

async fn with_owner_deadline(
    timeout: Duration,
    query: impl std::future::Future<Output = Option<String>>,
) -> Option<String> {
    use std::pin::pin;
    use std::task::Poll;
    let mut query = pin!(query);
    let mut timer = pin!(async_io::Timer::after(timeout));
    // A timer win yields the outer `None`, which `flatten` maps to the same
    // fail-closed `None` as a genuine no-owner answer; the hung query is
    // dropped on cancellation.
    std::future::poll_fn(|cx| {
        if let Poll::Ready(value) = query.as_mut().poll(cx) {
            return Poll::Ready(Some(value));
        }
        if timer.as_mut().poll(cx).is_ready() {
            return Poll::Ready(None);
        }
        Poll::Pending
    })
    .await
    .flatten()
}

async fn current_kwin_owner_with_deadline(
    connection: &zbus::Connection,
    timeout: Duration,
) -> Option<String> {
    with_owner_deadline(timeout, current_kwin_owner(connection)).await
}

/// Live KWin owner query. Returns the current `org.kde.KWin` owner unique
/// name, or `None` when the name has no owner or the query fails
/// (fail-closed: the caller refuses). No identity is logged or retained.
async fn current_kwin_owner(connection: &zbus::Connection) -> Option<String> {
    let Ok(dbus) = zbus::fdo::DBusProxy::new(connection).await else {
        return None;
    };
    dbus.get_name_owner(KWIN_SERVICE.try_into().expect("valid KWin service name"))
        .await
        .map(|owner| owner.to_string())
        .ok()
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
    use std::rc::Rc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Barrier};
    use std::thread;
    use std::time::Duration;

    use super::{
        KWIN_SERVICE, REGISTER_STATUS_NOTIFIER_ITEM, SERVICE, STATUS_NOTIFIER_WATCHER_INTERFACE,
        STATUS_NOTIFIER_WATCHER_OBJECT, STATUS_NOTIFIER_WATCHER_SERVICE, WatcherState,
        authorized_publisher, classify_name_reply, handle_watcher_owner_change,
        invalid_snapshot_reason, note_watcher_query_failure, owner_changes_match_rule,
        owner_outcome_line, owner_signal_args_invalid_line, owner_signal_malformed_line,
        poll_watcher_once, publish_early_refusal_line, publish_outcome_line,
        reconcile_initial_owner, retry_registration, sender_is_current_kwin_owner,
        service_name_acquired_line, service_name_lost_line, service_name_taken_line,
        status_projected_line, tray_name_lost, watcher_lost_line, watcher_query_failed_line,
        watcher_registered_line, watcher_registration_failed_line,
    };

    #[test]
    fn single_instance_taken_name_exits_zero_without_serving() {
        use zbus::fdo::RequestNameReply;
        assert_eq!(
            classify_name_reply(RequestNameReply::PrimaryOwner),
            super::NameAcquire::Acquired
        );
        assert_eq!(
            classify_name_reply(RequestNameReply::AlreadyOwner),
            super::NameAcquire::Acquired
        );
        // DoNotQueue taken reply: the second instance exits 0.
        assert_eq!(
            classify_name_reply(RequestNameReply::Exists),
            super::NameAcquire::Taken
        );
        assert_eq!(
            classify_name_reply(RequestNameReply::InQueue),
            super::NameAcquire::Taken
        );
        // zbus 5.19 surfaces the taken reply as Err(NameTaken): only that
        // error maps to exit 0, every other error propagates.
        assert_eq!(
            super::classify_name_request(Err(zbus::Error::NameTaken)),
            Ok(super::NameAcquire::Taken)
        );
        assert_eq!(
            super::classify_name_request(Ok(RequestNameReply::PrimaryOwner)),
            Ok(super::NameAcquire::Acquired)
        );
        assert_eq!(
            super::classify_name_request(Ok(RequestNameReply::Exists)),
            Ok(super::NameAcquire::Taken)
        );
        assert!(
            super::classify_name_request(Err(zbus::Error::Failure("boom".to_owned()))).is_err()
        );
    }

    #[test]
    fn service_name_lines_are_bounded_without_identity() {
        assert_eq!(
            service_name_acquired_line(),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=name event=acquire outcome=acquired"
        );
        assert_eq!(
            service_name_taken_line(),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=name event=acquire outcome=taken"
        );
        assert_eq!(
            service_name_lost_line(),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=name event=name-lost outcome=lost"
        );
    }

    #[test]
    fn tray_name_loss_is_terminal_for_our_name_only() {
        assert!(tray_name_lost(SERVICE, None, Some(":1.7")));
        assert!(tray_name_lost(SERVICE, Some(":1.9"), Some(":1.7")));
        assert!(!tray_name_lost(SERVICE, Some(":1.7"), Some(":1.7")));
        assert!(!tray_name_lost(KWIN_SERVICE, None, Some(":1.7")));
    }

    #[test]
    fn malformed_owner_signal_lines_are_bounded_and_non_owner_message_is_detected() {
        // Audit N: malformed signal/args log a fixed redacted record and the
        // loop continues; own-name loss stays terminal (covered above).
        assert_eq!(
            owner_signal_malformed_line(),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=owner event=signal outcome=malformed-signal"
        );
        assert_eq!(
            owner_signal_args_invalid_line(),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=owner event=signal outcome=invalid-args"
        );
        for line in [
            owner_signal_malformed_line(),
            owner_signal_args_invalid_line(),
        ] {
            assert!(!line.contains('\n'));
            assert!(!line.contains(":1."));
        }
        // Actual behavior: a non-owner message never parses as an owner
        // signal, so the serving loop takes the log-and-continue path.
        let message = zbus::message::Message::method_call(
            STATUS_NOTIFIER_WATCHER_OBJECT,
            REGISTER_STATUS_NOTIFIER_ITEM,
        )
        .unwrap()
        .destination(STATUS_NOTIFIER_WATCHER_SERVICE)
        .unwrap()
        .interface(STATUS_NOTIFIER_WATCHER_INTERFACE)
        .unwrap()
        .build(&("arg",))
        .unwrap();
        assert!(zbus::fdo::NameOwnerChanged::from_message(message).is_none());
        // Failed owner-change notification reuses the bounded signal record
        // without transport detail; the next valid event reprojects.
        let emission = super::signal_emission_failed_line();
        assert_eq!(
            emission,
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=signal event=emit outcome=emission-failed"
        );
        assert!(!emission.contains('\n'));
    }

    #[test]
    fn sender_must_equal_the_live_kwin_owner() {
        assert!(sender_is_current_kwin_owner(":1.1", Some(":1.1")));
        assert!(!sender_is_current_kwin_owner(":1.1", Some(":1.2")));
        assert!(!sender_is_current_kwin_owner(":1.1", None));
        assert!(!sender_is_current_kwin_owner(
            "not-a-unique-name",
            Some("not-a-unique-name")
        ));
    }

    #[test]
    fn owner_query_deadline_fails_closed_and_releases_the_operation_lock() {
        // Row P: a hung KWin-owner lookup awaited under the publication lock
        // times out to `None` (fail-closed), drops the hung query, and
        // releases the lock; a later fresh query still resolves.
        let endpoint = super::TrayEndpoint::new(Some(":org.kwin"));
        zbus::block_on(async {
            let _operation_guard = endpoint.operation_lock.lock().await;
            let owner = super::with_owner_deadline(
                Duration::from_millis(20),
                std::future::pending::<Option<String>>(),
            )
            .await;
            assert_eq!(owner, None, "hung owner query must fail closed");
            drop(_operation_guard);
        });
        assert!(
            endpoint.operation_lock.try_lock().is_some(),
            "deadline must release the operation lock"
        );
        let owner = zbus::block_on(super::with_owner_deadline(Duration::from_secs(2), async {
            Some(":org.kwin".to_owned())
        }));
        assert_eq!(owner.as_deref(), Some(":org.kwin"));
    }

    #[test]
    fn poisoned_tray_state_recovers_and_serves_only_fresh_snapshots() {
        // Row Q: a poisoned tray state lock recovers at the boundary instead
        // of panicking; recovery serves no stale snapshot and the next fresh
        // publish round-trips to current.
        let endpoint = super::TrayEndpoint::new(Some(":1.7"));
        let snapshot = |revision| super::Snapshot {
            generation: "gen-1".to_owned(),
            revision,
            enabled: true,
        };
        let (result, _) = super::lock_tray_state(&endpoint.state).publish_snapshot_from(
            Some(":1.7"),
            Some(":1.7"),
            1,
            snapshot(0),
            0,
        );
        assert!(result.is_ok());
        assert!(super::lock_tray_state(&endpoint.state).view(0).current);
        let state = Arc::clone(&endpoint.state);
        let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = state.lock().unwrap();
            panic!("inject tray state poison");
        }));
        assert!(poisoned.is_err());
        assert!(endpoint.state.is_poisoned());
        let recovered = super::lock_tray_state(&endpoint.state).view(0);
        assert!(
            !endpoint.state.is_poisoned(),
            "boundary lock must clear poison"
        );
        assert!(recovered.owner, "owner epoch survives recovery");
        assert!(
            !recovered.current,
            "recovered state must not serve the pre-poison snapshot"
        );
        let (result, _) = super::lock_tray_state(&endpoint.state).publish_snapshot_from(
            Some(":1.7"),
            Some(":1.7"),
            1,
            snapshot(1),
            1,
        );
        assert!(result.is_ok(), "next fresh publish converges");
        let view = super::lock_tray_state(&endpoint.state).view(1);
        assert!(view.current);
        assert_eq!(view.snapshot.map(|snapshot| snapshot.enabled), Some(true));
    }

    #[test]
    fn poison_recovery_accepts_next_same_revision_heartbeat_once() {
        // Row Q narrow fix: KWin heartbeats repeat the SAME revision until
        // the state changes, so after poison recovery (snapshot cleared but
        // generation/revision floors kept) the next fresh same-generation
        // same-revision heartbeat from the current live owner must recover
        // once, without weakening ordinary replay.
        let endpoint = super::TrayEndpoint::new(Some(":1.7"));
        let snapshot = |generation: &str, revision: i32, enabled: bool| super::Snapshot {
            generation: generation.to_owned(),
            revision,
            enabled,
        };
        super::lock_tray_state(&endpoint.state)
            .publish_snapshot_from(Some(":1.7"), Some(":1.7"), 1, snapshot("gen-1", 5, true), 0)
            .0
            .unwrap();
        let state = Arc::clone(&endpoint.state);
        let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = state.lock().unwrap();
            panic!("inject tray state poison");
        }));
        assert!(poisoned.is_err());
        let recovered = super::lock_tray_state(&endpoint.state).view(0);
        assert!(recovered.owner);
        assert!(!recovered.current);
        // Mismatched owner still refuses and does not consume the one-shot.
        let (result, _) = super::lock_tray_state(&endpoint.state).publish_snapshot_from(
            Some(":1.8"),
            Some(":1.8"),
            1,
            snapshot("gen-1", 5, true),
            1,
        );
        assert_eq!(result.unwrap_err(), super::TrayError::UnauthorizedPublisher);
        // Stale same-generation revision still refuses.
        let (result, _) = super::lock_tray_state(&endpoint.state).publish_snapshot_from(
            Some(":1.7"),
            Some(":1.7"),
            1,
            snapshot("gen-1", 4, true),
            2,
        );
        assert!(result.is_err());
        // Fresh same-generation same-revision heartbeat recovers.
        let (result, _) = super::lock_tray_state(&endpoint.state).publish_snapshot_from(
            Some(":1.7"),
            Some(":1.7"),
            1,
            snapshot("gen-1", 5, true),
            3,
        );
        assert!(result.is_ok(), "same-revision heartbeat must recover once");
        assert!(super::lock_tray_state(&endpoint.state).view(3).current);
        // One-shot is consumed: stale and mismatched-owner replays refuse again.
        let (result, _) = super::lock_tray_state(&endpoint.state).publish_snapshot_from(
            Some(":1.7"),
            Some(":1.7"),
            1,
            snapshot("gen-1", 4, true),
            4,
        );
        assert!(
            result.is_err(),
            "ordinary revision floor returns after recovery"
        );
        let (result, _) = super::lock_tray_state(&endpoint.state).publish_snapshot_from(
            Some(":1.8"),
            Some(":1.8"),
            1,
            snapshot("gen-1", 5, true),
            5,
        );
        assert_eq!(result.unwrap_err(), super::TrayError::UnauthorizedPublisher);
        // A new generation still needs revision 0.
        let (result, _) = super::lock_tray_state(&endpoint.state).publish_snapshot_from(
            Some(":1.7"),
            Some(":1.7"),
            1,
            snapshot("gen-2", 1, true),
            6,
        );
        assert!(result.is_err());
    }

    #[test]
    fn authorization_requires_cached_and_live_owner_to_agree() {
        assert!(authorized_publisher(
            Some(":1.1"),
            Some(":1.1"),
            Some(":1.1"),
        ));
        // Live owner moved: fail-closed even though the cache still matches.
        assert!(!authorized_publisher(
            Some(":1.1"),
            Some(":1.2"),
            Some(":1.1"),
        ));
        // Stale cache: fail-closed even though the live owner matches.
        assert!(!authorized_publisher(
            Some(":1.1"),
            Some(":1.2"),
            Some(":1.2"),
        ));
        assert!(!authorized_publisher(Some(":1.1"), Some(":1.1"), None));
        assert!(!authorized_publisher(Some(":1.1"), None, Some(":1.1")));
        assert!(!authorized_publisher(None, Some(":1.1"), Some(":1.1")));
    }

    #[test]
    fn snapshot_acceptance_requires_sender_equal_to_cached_and_live_kwin_owner() {
        let mut state = super::TrayState::default();
        state.owner_changed(Some(":org.kwin"));

        // Missing sender refuses fail-closed.
        assert_eq!(
            state
                .publish_snapshot_from(
                    None,
                    Some(":org.kwin"),
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
        // Live owner missing (KWin has no owner) refuses.
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":org.kwin"),
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
        // Sender differs from the owners refuses.
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":other"),
                    Some(":other"),
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
        // Live owner moved since the cached epoch: fail-closed.
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":org.kwin"),
                    Some(":org.moved"),
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
        // Sender, cached owner, and live owner agree: accept.
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":org.kwin"),
                    Some(":org.kwin"),
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

        // Owner epoch moved: the stale sender refuses even though the live
        // query still names it (cache and live must agree).
        state.owner_changed(Some(":org.new-kwin"));
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":org.kwin"),
                    Some(":org.kwin"),
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
        // New owner publishes under the new epoch: accept.
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":org.new-kwin"),
                    Some(":org.new-kwin"),
                    1,
                    super::Snapshot {
                        generation: "beta".to_owned(),
                        revision: 0,
                        enabled: false,
                    },
                    1,
                )
                .0,
            Ok(())
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
                    Some("not-a-unique-name"),
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
    fn revoked_race_snapshot_is_never_served() {
        let mut state = super::TrayState::default();
        state.owner_changed(Some(":org.kwin"));
        state
            .publish_snapshot_from(
                Some(":org.kwin"),
                Some(":org.kwin"),
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
        state.revoke_accepted_snapshot();
        assert_eq!(
            state.view(0),
            super::StateView {
                owner: true,
                snapshot: None,
                refreshed_at: None,
                current: false,
            }
        );
        state
            .publish_snapshot_from(
                Some(":org.kwin"),
                Some(":org.kwin"),
                1,
                super::Snapshot {
                    generation: "alpha".to_owned(),
                    revision: 0,
                    enabled: true,
                },
                1,
            )
            .0
            .expect("same snapshot recovers after a transient post-query failure");
        assert!(state.view(1).current);
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
            Some(":new.kwin"),
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
        state
            .publish_snapshot_from(
                Some(":org.kwin"),
                Some(":org.kwin"),
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
                Some(":org.kwin"),
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
                Some(":org.kwin"),
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
    fn watcher_absence_and_loss_stay_alive_unregistered_without_claiming() {
        // Audit M (option 2): no live owner clears registration and never
        // fails; the carrier stays alive for a later live-confirmed owner.
        // The loss transition emits one bounded record; steady absence stays
        // silent (no per-tick spam).
        let mut state = WatcherState {
            registered: Some(":watcher".to_owned()),
            last_failure_line: None,
        };
        let mut registration_attempts = 0;
        let line = handle_watcher_owner_change(&mut state, None, |_| {
            registration_attempts += 1;
            Ok(())
        });

        assert_eq!(line, Some(watcher_lost_line()));
        assert_eq!(state.registered, None);
        assert_eq!(registration_attempts, 0);

        // Steady-state absence: idempotent, silent.
        let line = handle_watcher_owner_change(&mut state, None, |_| {
            registration_attempts += 1;
            Ok(())
        });
        assert_eq!(line, None);
        assert_eq!(state.registered, None);
        assert_eq!(registration_attempts, 0);
    }

    #[test]
    fn watcher_transient_failure_stays_retryable_and_never_claims_until_confirmed() {
        // Audit M (option 2): a transient registration failure leaves the
        // carrier unregistered (retryable while the owner remains) and only
        // a confirmed registration is claimed. The first failure emits one
        // bounded record; an identical repeat stays silent; recovery emits
        // the registered record and re-arms failure logging.
        let mut state = WatcherState::default();
        let mut attempts = 0;
        let line = handle_watcher_owner_change(&mut state, Some(":watcher".to_owned()), |_| {
            attempts += 1;
            Err(zbus::Error::Failure("transient".to_owned()))
        });
        assert_eq!(line, Some(watcher_registration_failed_line()));
        assert_eq!(state.registered, None);
        assert_eq!(attempts, 1);

        // Identical repeat: still unregistered, still one attempt, silent.
        let line = handle_watcher_owner_change(&mut state, Some(":watcher".to_owned()), |_| {
            attempts += 1;
            Err(zbus::Error::Failure("transient".to_owned()))
        });
        assert_eq!(line, None);
        assert_eq!(state.registered, None);
        assert_eq!(attempts, 2);

        // Retry while the same live owner remains succeeds and claims.
        let line = handle_watcher_owner_change(&mut state, Some(":watcher".to_owned()), |owner| {
            attempts += 1;
            assert_eq!(owner, ":watcher");
            Ok(())
        });
        assert_eq!(line, Some(watcher_registered_line()));
        assert_eq!(state.registered, Some(":watcher".to_owned()));
        assert_eq!(attempts, 3);

        // Idempotent: the confirmed owner never re-registers.
        let line = handle_watcher_owner_change(&mut state, Some(":watcher".to_owned()), |_| {
            attempts += 1;
            Ok(())
        });
        assert_eq!(line, None);
        assert_eq!(state.registered, Some(":watcher".to_owned()));
        assert_eq!(attempts, 3);
    }

    #[test]
    fn watcher_stale_confirmation_recovers_on_live_recheck() {
        // A stale `Some(old)` never blocks recovery: every poll re-checks
        // the live owner, so a moved owner re-registers instead of wedging.
        let mut state = WatcherState {
            registered: Some(":old".to_owned()),
            last_failure_line: None,
        };
        let mut seen = Vec::new();
        let line = poll_watcher_once(
            &mut state,
            || Ok(Some(":new".to_owned())),
            |owner| {
                seen.push(owner.to_owned());
                Ok(())
            },
        );
        assert_eq!(seen, [":new"]);
        assert_eq!(line, Some(watcher_registered_line()));
        assert_eq!(state.registered, Some(":new".to_owned()));

        // Steady confirmation stays silent without re-registering.
        let line = poll_watcher_once(
            &mut state,
            || Ok(Some(":new".to_owned())),
            |_| {
                seen.push("unexpected".to_owned());
                Ok(())
            },
        );
        assert_eq!(line, None);
        assert_eq!(seen.len(), 1);
    }

    #[test]
    fn watcher_query_failure_keeps_registration_and_stays_bounded() {
        // A transient live-query failure never evicts a healthy owner; the
        // first failure emits one bounded record and repeats stay silent.
        let mut state = WatcherState {
            registered: Some(":watcher".to_owned()),
            last_failure_line: None,
        };
        let line = note_watcher_query_failure(&mut state);
        assert_eq!(line, Some(watcher_query_failed_line()));
        assert_eq!(state.registered, Some(":watcher".to_owned()));
        assert_eq!(note_watcher_query_failure(&mut state), None);

        // Recovery (a confirmed registration) re-arms failure logging.
        let line = handle_watcher_owner_change(&mut state, Some(":other".to_owned()), |_| Ok(()));
        assert_eq!(line, Some(watcher_registered_line()));
        let line = note_watcher_query_failure(&mut state);
        assert_eq!(line, Some(watcher_query_failed_line()));
    }

    #[test]
    fn watcher_lines_are_bounded_without_identity() {
        assert_eq!(
            watcher_registered_line(),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=watcher event=register outcome=registered"
        );
        assert_eq!(
            watcher_lost_line(),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=watcher event=owner-changed outcome=lost"
        );
        assert_eq!(
            watcher_registration_failed_line(),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=watcher event=register outcome=registration-failed"
        );
        assert_eq!(
            watcher_query_failed_line(),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=watcher event=query outcome=query-failed"
        );
        for line in [
            watcher_registered_line(),
            watcher_lost_line(),
            watcher_registration_failed_line(),
            watcher_query_failed_line(),
        ] {
            assert!(!line.contains(":watcher"));
            assert!(!line.contains('\n'));
        }
    }

    #[test]
    fn watcher_shared_lock_serializes_concurrent_polls_to_one_registration() {
        // Watchdog tick and signal path share one mutex: concurrent polls
        // with the same live owner register exactly once; the rest observe
        // the confirmed owner idempotently instead of re-registering (the
        // pre-fix watchdog queried outside the lock and could store stale
        // owners or duplicate registrations).
        use std::sync::atomic::AtomicUsize;

        let state = Arc::new(std::sync::Mutex::new(WatcherState::default()));
        let attempts = Arc::new(AtomicUsize::new(0));
        let barrier = Arc::new(Barrier::new(4));
        let mut handles = Vec::new();
        for _ in 0..4 {
            let state = Arc::clone(&state);
            let attempts = Arc::clone(&attempts);
            let barrier = Arc::clone(&barrier);
            handles.push(thread::spawn(move || {
                barrier.wait();
                let mut guard = state.lock().expect("watcher state mutex poisoned");
                poll_watcher_once(
                    &mut guard,
                    || Ok(Some(":watcher".to_owned())),
                    |_| {
                        attempts.fetch_add(1, Ordering::Relaxed);
                        Ok(())
                    },
                )
            }));
        }
        let mut lines = Vec::new();
        for handle in handles {
            lines.push(handle.join().expect("poll thread panicked"));
        }
        assert_eq!(attempts.load(Ordering::Relaxed), 1);
        assert_eq!(
            state
                .lock()
                .expect("watcher state mutex poisoned")
                .registered,
            Some(":watcher".to_owned())
        );
        assert_eq!(
            lines.iter().filter(|line| line.is_some()).count(),
            1,
            "exactly one transition record, no per-thread spam"
        );
    }

    #[test]
    fn poisoned_watcher_lock_recovers_and_registers_on_next_poll() {
        let state = std::sync::Mutex::new(WatcherState::default());
        let _ = std::panic::catch_unwind(|| {
            let _guard = state.lock().unwrap();
            panic!("inject watcher poison");
        });
        let line = poll_watcher_once(
            &mut super::lock_watcher_state(&state),
            || Ok(Some(":watcher".to_owned())),
            |_| Ok(()),
        );
        assert_eq!(line, Some(watcher_registered_line()));
        assert!(!state.is_poisoned());
        assert_eq!(
            state.lock().unwrap().registered.as_deref(),
            Some(":watcher")
        );
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
                "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=refused reason=not-current-KWin-owner revision=4"
                    .to_owned()
            )
        );
    }

    #[test]
    fn tray_journal_payload_uses_fixed_identifier_priority_and_message() {
        let line = "plasma-auto-tiler:route-diag component=tray-endpoint stage=name event=acquire outcome=acquired";
        let payload = super::tray_journal_payload(line).expect("fixed line builds a payload");
        let text = String::from_utf8(payload).expect("payload is UTF-8");
        assert_eq!(
            text,
            format!("PRIORITY=6\nSYSLOG_IDENTIFIER=plasma-auto-tiler-tray\nMESSAGE={line}\n")
        );
    }

    #[test]
    fn tray_journal_payload_rejects_field_injection_lines() {
        assert!(super::tray_journal_payload("ok\nPRIORITY=3").is_none());
        assert!(super::tray_journal_payload("ok\rPRIORITY=3").is_none());
        assert!(super::tray_journal_payload("alpha\ninjected").is_none());
    }

    #[test]
    fn tray_journal_submission_delivers_one_datagram_to_a_fixture_socket() {
        // Offline verification of the real `UnixDatagram` send path: bind a
        // fixture socket in a temp dir, submit through the
        // path-parameterized writer, and read back the exact payload. The
        // host journal socket is never touched.
        let path = std::env::temp_dir().join(format!(
            "plasma-auto-tiler-tray-journal-{}-{}.sock",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock is after epoch")
                .as_nanos()
        ));
        let receiver =
            std::os::unix::net::UnixDatagram::bind(&path).expect("fixture journal socket binds");
        receiver
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .expect("fixture socket read timeout sets");
        let line = "plasma-auto-tiler:route-diag component=tray-endpoint stage=test event=writer-check outcome=ok";
        let payload = super::tray_journal_payload(line).expect("fixed line builds a payload");
        let result: () = super::submit_tray_journal_to(
            &payload,
            path.to_str().expect("temp socket path is UTF-8"),
        );
        assert_eq!(result, ());
        let mut buf = vec![0_u8; 4096];
        let (len, _) = receiver
            .recv_from(&mut buf)
            .expect("fixture socket receives");
        assert_eq!(&buf[..len], &payload[..]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn tray_diag_writer_is_best_effort_and_never_fails_the_caller() {
        // The writer discards every I/O result by signature (returns ()),
        // so a submission error can never panic or propagate into tray
        // behavior. This submits to a path with no listener, which exercises
        // the ignored-error path without touching the host journal socket
        // or the test runner's stderr; the contract is the return type.
        let missing = std::env::temp_dir().join(format!(
            "plasma-auto-tiler-tray-journal-missing-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock is after epoch")
                .as_nanos()
        ));
        let payload = super::tray_journal_payload(
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=test event=writer-check outcome=ok",
        )
        .expect("fixed line builds a payload");
        let result: () =
            super::submit_tray_journal_to(&payload, missing.to_str().expect("temp path is UTF-8"));
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
            publish_early_refusal_line("not-current-KWin-owner", 7),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=refused reason=not-current-KWin-owner revision=7"
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
                Some(":org.kwin"),
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
                Some(":org.kwin"),
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
                Some(":org.kwin"),
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
            Some(":org.kwin"),
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
            Some(":org.kwin"),
            1,
            snapshot("alpha", 2, true),
            4,
        );
        assert_eq!(
            unauthorized.unwrap_err(),
            super::TrayError::UnauthorizedPublisher
        );
        assert_eq!(
            publish_early_refusal_line("not-current-KWin-owner", 2),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=refused reason=not-current-KWin-owner revision=2"
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
        let snapshot = |generation: &str, revision: i32, enabled: bool| super::Snapshot {
            generation: generation.to_owned(),
            revision,
            enabled,
        };
        let publish =
            |state: &mut super::TrayState, generation: &str, revision: i32, enabled: bool| {
                state.publish_snapshot_from(
                    Some(":org.kwin"),
                    Some(":org.kwin"),
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
            Some(":org.kwin"),
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
                "plasma-auto-tiler:route-diag component=tray-endpoint stage=publish event=publish outcome=refused reason=not-current-KWin-owner revision=1"
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
                .collect_early_refusal("not-current-KWin-owner", 4)
                .as_deref()
                .is_some_and(|line| line.contains("reason=not-current-KWin-owner")),
            "distinct reason was hidden"
        );

        // A visibly accepted change re-arms the sender-less record.
        state.owner_changed(Some(":org.kwin"));
        let (result, _) = state.publish_snapshot_from(
            Some(":org.kwin"),
            Some(":org.kwin"),
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

        let refusal = super::publish_early_refusal_line("not-current-KWin-owner", 7);
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
        let snapshot = |revision: i32, enabled: bool| super::Snapshot {
            generation: "alpha".to_owned(),
            revision,
            enabled,
        };
        let (result, _) = endpoint.publish_authenticated_snapshot(
            ":org.kwin",
            Some(":org.kwin"),
            1,
            snapshot(0, true),
        );
        result.unwrap();

        let (result, line) = endpoint.publish_authenticated_snapshot(
            ":org.kwin",
            Some(":org.kwin"),
            1,
            snapshot(0, false),
        );
        assert!(result.is_err());
        let first = line.expect("first refusal collects a record");
        assert!(
            first.contains("reason=invalid-transition generation=alpha revision=0 enabled=false")
        );
        assert!(!first.contains(":org.kwin"));

        let (result, line) = endpoint.publish_authenticated_snapshot(
            ":org.kwin",
            Some(":org.kwin"),
            1,
            snapshot(0, false),
        );
        assert!(result.is_err());
        assert_eq!(line, None);
    }

    /// Throwaway private bus for hermetic tests. Private unix socket, no
    /// host session bus contact, no KWin, no mutation outside the temp dir.
    /// Skips (returns `None`) when `dbus-daemon` cannot run here.
    struct PrivateBus {
        child: std::process::Child,
        socket_dir: std::path::PathBuf,
        address: String,
    }

    impl PrivateBus {
        fn start() -> Option<Self> {
            let socket_dir = std::env::temp_dir().join(format!(
                "plasma-auto-tiler-test-bus-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_nanos())
                    .unwrap_or_default()
            ));
            std::fs::create_dir_all(&socket_dir).ok()?;
            let address = format!("unix:path={}", socket_dir.join("bus.sock").display());
            let child = std::process::Command::new("dbus-daemon")
                .arg("--session")
                .arg(format!("--address={address}"))
                .arg("--nofork")
                .arg("--nopidfile")
                .arg("--nosyslog")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .ok()?;
            Some(Self {
                child,
                socket_dir,
                address,
            })
        }

        /// Connects to the private bus, waiting briefly for daemon startup.
        /// Returns `None` (skip) when the daemon never listens.
        fn session(&self) -> Option<zbus::blocking::Connection> {
            let start = std::time::Instant::now();
            loop {
                match zbus::blocking::connection::Builder::address(self.address.as_str())
                    .and_then(|builder| builder.build())
                {
                    Ok(connection) => return Some(connection),
                    Err(_) if start.elapsed() < std::time::Duration::from_secs(3) => {
                        std::thread::sleep(std::time::Duration::from_millis(25));
                    }
                    Err(_) => return None,
                }
            }
        }
    }

    impl Drop for PrivateBus {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
            let _ = std::fs::remove_dir_all(&self.socket_dir);
        }
    }

    #[test]
    fn private_bus_second_request_surfaces_name_taken() {
        // End-to-end proof of the zbus 5.19 behavior the single-instance
        // path depends on: a taken `DoNotQueue` name arrives as
        // `Err(NameTaken)`, and only that error maps to exit 0.
        let Some(bus) = PrivateBus::start() else {
            eprintln!("SKIP: dbus-daemon unavailable for hermetic name-taken test");
            return;
        };
        let Some(first) = bus.session() else {
            eprintln!("SKIP: private bus daemon never listened");
            return;
        };
        first
            .request_name_with_flags(
                super::SERVICE,
                zbus::fdo::RequestNameFlags::DoNotQueue.into(),
            )
            .expect("first holder acquires the tray name");
        let Some(second) = bus.session() else {
            eprintln!("SKIP: private bus daemon dropped the second connection");
            return;
        };
        let taken = second.request_name_with_flags(
            super::SERVICE,
            zbus::fdo::RequestNameFlags::DoNotQueue.into(),
        );
        assert!(
            matches!(&taken, Err(zbus::Error::NameTaken)),
            "zbus must surface a taken DoNotQueue name as Err(NameTaken), got: {taken:?}"
        );
        assert_eq!(
            super::classify_name_request(taken),
            Ok(super::NameAcquire::Taken)
        );
    }

    #[test]
    fn post_subscribe_owner_change_is_always_observable() {
        // Pins the mechanism behind subscribe-before-resolve: a KWin change
        // after subscription is visible both via a fresh owner query and via
        // the queued signal on the same iterator the serving loop consumes,
        // so the production order (subscribe, then resolve, then loop) can
        // never wedge the cached epoch on a racing change.
        use zbus::fdo::NameOwnerChanged;
        let Some(bus) = PrivateBus::start() else {
            eprintln!("SKIP: dbus-daemon unavailable for hermetic owner-change test");
            return;
        };
        let Some(monitor) = bus.session() else {
            eprintln!("SKIP: private bus daemon never listened");
            return;
        };
        let owner_changes = super::monitor_owner_changes(&monitor).expect("subscribe first");
        // Change AFTER subscription: acquire the KWin name on a new peer.
        let Some(holder) = bus.session() else {
            eprintln!("SKIP: private bus daemon dropped the holder connection");
            return;
        };
        holder
            .request_name_with_flags(
                super::KWIN_SERVICE,
                zbus::fdo::RequestNameFlags::DoNotQueue.into(),
            )
            .expect("holder acquires the KWin name");
        let holder_unique = holder
            .unique_name()
            .map(|name| name.to_string())
            .expect("holder has a unique name");
        // A query issued after subscription observes the racing change.
        let Some(serving) = bus.session() else {
            eprintln!("SKIP: private bus daemon dropped the serving connection");
            return;
        };
        let queried = zbus::blocking::fdo::DBusProxy::new(&serving)
            .expect("proxy builds")
            .get_name_owner(super::KWIN_SERVICE.try_into().unwrap())
            .map(|owner| owner.to_string())
            .expect("KWin name has an owner after the racing acquire");
        assert_eq!(queried, holder_unique);
        // The same change is also queued for the serving loop: the holder's
        // hello plus the KWin acquisition, in order, before anything else the
        // loop could consume. Both round-trips completed above, so both
        // signals are already queued and this cannot block.
        let mut seen_kwin_acquire = false;
        for message in owner_changes.take(2) {
            let message = message.expect("queued owner signal reads");
            let Some(signal) = NameOwnerChanged::from_message(message) else {
                continue;
            };
            let args = signal.args().expect("owner signal parses");
            if args.name().as_str() == super::KWIN_SERVICE {
                assert_eq!(
                    args.new_owner().as_ref().map(ToString::to_string),
                    Some(holder_unique.clone())
                );
                seen_kwin_acquire = true;
            }
        }
        assert!(
            seen_kwin_acquire,
            "post-subscribe KWin acquire must be queued for the serving loop"
        );
    }

    #[test]
    fn kwin_signal_application_always_converges_to_live_owner() {
        // Regression for stale replay: with the seed already at C, replaying
        // queued A->B->C (here: none->h1->none->h2) by event payload would
        // transiently cache B, then no-owner, wedging legitimate publishes
        // until the next event (permanently on iterator overflow, which
        // drops oldest first). Production re-resolves live per signal, so
        // every application converges. The contrast fold below proves this
        // test reproduces the wedge shape (it visits stale epochs) while
        // the production path never does.
        use zbus::fdo::NameOwnerChanged;
        let Some(bus) = PrivateBus::start() else {
            eprintln!("SKIP: dbus-daemon unavailable for hermetic convergence test");
            return;
        };
        let Some(monitor) = bus.session() else {
            eprintln!("SKIP: private bus daemon never listened");
            return;
        };
        let owner_changes = super::monitor_owner_changes(&monitor).expect("subscribe first");
        let Some(serving) = bus.session() else {
            eprintln!("SKIP: private bus daemon dropped the serving connection");
            return;
        };
        // Epoch B: acquire then release (A->B->A prefix of the storm).
        let h1 = bus.session().expect("holder one connects");
        h1.request_name_with_flags(
            super::KWIN_SERVICE,
            zbus::fdo::RequestNameFlags::DoNotQueue.into(),
        )
        .expect("holder one acquires the KWin name");
        drop(h1);
        // Epoch C: a new owner acquires. Disconnect delivery is async, so
        // retry until the daemon has processed holder one's release; the
        // successful round-trip then orders every signal below ahead of
        // the drain, which therefore cannot block.
        let h2 = bus.session().expect("holder two connects");
        let start = std::time::Instant::now();
        loop {
            match h2.request_name_with_flags(
                super::KWIN_SERVICE,
                zbus::fdo::RequestNameFlags::DoNotQueue.into(),
            ) {
                Ok(_) => break,
                Err(_) if start.elapsed() < std::time::Duration::from_secs(5) => {
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                Err(error) => panic!("holder two never acquires the KWin name: {error:?}"),
            }
        }
        let live = super::query_name_owner(&serving, super::KWIN_SERVICE)
            .expect("live query resolves")
            .expect("KWin name has an owner");
        let h2_unique = h2
            .unique_name()
            .map(|name| name.to_string())
            .expect("holder two has a unique name");
        assert_eq!(live, h2_unique);
        // Seed exactly like production startup (post-subscribe query).
        let mut state = super::TrayState::default();
        state.owner_changed(Some(live.as_str()));
        // Contrast model of the old event-payload behavior, for sensitivity:
        // folding bare event owners visits stale epochs mid-replay.
        let mut contrast: Option<String> = Some(live.clone());
        let mut visited_stale = false;
        // Three KWin transitions occurred; ignore hello noise. Terminates:
        // all three round-trips completed above, so all three signals are
        // already queued ahead of any future traffic.
        let mut applied = 0;
        for message in owner_changes {
            let message = message.expect("queued owner signal reads");
            let Some(signal) = NameOwnerChanged::from_message(message) else {
                continue;
            };
            let args = signal.args().expect("owner signal parses");
            if args.name().as_str() != super::KWIN_SERVICE {
                continue;
            }
            let event_owner = args.new_owner().as_ref().map(ToString::to_string);
            if event_owner.as_deref() != Some(live.as_str()) {
                visited_stale = true;
            }
            contrast = event_owner.clone();
            // Production application: live re-resolution, never the event.
            state.owner_changed(
                super::query_name_owner(&serving, super::KWIN_SERVICE)
                    .ok()
                    .flatten()
                    .as_deref(),
            );
            // Converges on every signal, including the stale release replay:
            // the current owner keeps publishing while the backlog drains.
            assert_eq!(
                state.owner.as_deref(),
                Some(live.as_str()),
                "re-resolution must converge even when replaying a stale event"
            );
            applied += 1;
            if applied == 3 {
                break;
            }
        }
        assert_eq!(applied, 3, "expected acquire/release/acquire KWin events");
        // The scenario provably contains stale replay material: the
        // event-folded model visited a non-live epoch mid-replay, which is
        // exactly what wedged the old event-trusting cache.
        assert!(
            visited_stale,
            "stale replay material must exist for this regression to be sensitive"
        );
        // The release replay provably wedged the event-folded model: without
        // re-resolution the cache would have visited no-owner mid-replay.
        assert_eq!(
            contrast,
            Some(live.clone()),
            "event fold ends at live only after the full suffix replays"
        );
        // Fail-closed recovery: owner vanishes for real; live resolution
        // clears the cache (refuses all) instead of retaining stale state.
        h2.release_name(super::KWIN_SERVICE)
            .expect("holder two releases the KWin name");
        let gone = super::query_name_owner(&serving, super::KWIN_SERVICE)
            .expect("live query resolves")
            .is_none();
        assert!(gone, "released KWin name must have no owner");
        state.owner_changed(
            super::query_name_owner(&serving, super::KWIN_SERVICE)
                .ok()
                .flatten()
                .as_deref(),
        );
        assert_eq!(state.owner, None);
        assert!(!state.view(0).current);
    }

    #[test]
    fn service_loss_detection_converges_to_live_owner() {
        // Our tray name is subscribed before acquisition in production, but
        // events can still replay stale (a queued acquire observed after a
        // real loss) or drop on overflow. `service_name_lost_live` decides
        // on the live owner, so a stale acquire event can never mask a loss
        // and a transient query failure never evicts a healthy owner.
        use zbus::fdo::NameOwnerChanged;
        let Some(bus) = PrivateBus::start() else {
            eprintln!("SKIP: dbus-daemon unavailable for hermetic loss test");
            return;
        };
        let Some(monitor) = bus.session() else {
            eprintln!("SKIP: private bus daemon never listened");
            return;
        };
        let mut owner_changes = super::monitor_owner_changes(&monitor).expect("subscribe first");
        let Some(serving) = bus.session() else {
            eprintln!("SKIP: private bus daemon dropped the serving connection");
            return;
        };
        let Some(holder) = bus.session() else {
            eprintln!("SKIP: private bus daemon dropped the holder connection");
            return;
        };
        holder
            .request_name_with_flags(
                super::SERVICE,
                zbus::fdo::RequestNameFlags::DoNotQueue.into(),
            )
            .expect("holder acquires the tray name");
        let holder_unique = holder
            .unique_name()
            .map(|name| name.to_string())
            .expect("holder has a unique name");
        // Drain the acquire event (hellos ignored); its round-trip is done
        // so it is already queued and this cannot block.
        let mut acquire_event: Option<String> = None;
        for message in owner_changes.by_ref() {
            let message = message.expect("queued owner signal reads");
            let Some(signal) = NameOwnerChanged::from_message(message) else {
                continue;
            };
            let args = signal.args().expect("owner signal parses");
            if args.name().as_str() == super::SERVICE {
                acquire_event = args.new_owner().as_ref().map(ToString::to_string);
                break;
            }
        }
        assert_eq!(acquire_event.as_deref(), Some(holder_unique.as_str()));
        // Healthy: live agrees with the event, no false loss.
        assert!(!super::service_name_lost_live(
            &serving,
            acquire_event.as_deref(),
            Some(holder_unique.as_str())
        ));
        // Real loss: release; the release round-trip completes before the
        // drain below, so it is already queued and cannot block.
        holder
            .release_name(super::SERVICE)
            .expect("holder releases the tray name");
        let mut saw_release = false;
        // Fresh iterator position continues after the acquire above.
        for message in owner_changes.by_ref() {
            let message = message.expect("queued owner signal reads");
            let Some(signal) = NameOwnerChanged::from_message(message) else {
                continue;
            };
            let args = signal.args().expect("owner signal parses");
            if args.name().as_str() == super::SERVICE {
                saw_release = true;
                break;
            }
        }
        assert!(saw_release, "release event must be queued");
        assert!(super::service_name_lost_live(
            &serving,
            None,
            Some(&holder_unique)
        ));
        // Stale acquire replayed after the real loss must still report
        // lost: the live owner (none), not the event, decides. Event-only
        // logic would keep serving with no name here.
        assert!(super::service_name_lost_live(
            &serving,
            acquire_event.as_deref(),
            Some(&holder_unique)
        ));
    }
}
