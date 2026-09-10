//! POC2 planner service boundary: stateless manually invoked D-Bus service.
//!
//! Contract identity: service `org.plasmaautotiler.Planner`, object
//! `/org/plasmaautotiler/Planner`, interface `org.plasmaautotiler.Planner1`,
//! methods `EvaluateMove` (frozen JSON string request -> JSON string reply),
//! `DescribeAdvisoryPlan` (read-only v1 advisory request -> advisory
//! plan reply with exactly three normalized opaque windows, delegated through
//! the portable `cosmic_v1` core; no native command/execution fields and no
//! mutation), `DescribeFocus` (bounded v1 focus transaction over the shared
//! trio service), and `DescribeMovement` (bounded v1 movement transaction
//! over the same shared trio service, delegating to the one session's
//! `cosmic_v1` R1-R4 move planning with complete desired geometry/focus),
//! and `DescribeResize` (bounded v1 keyboard resize transaction over the
//! same shared trio service, delegating to the one session's
//! `propose_resize` split-share planning with complete
//! adjacent/share/projected geometry and retained focus),
//! `DescribePointerResize` (bounded v1 pointer split-share resize
//! transaction over the same shared trio service, delegating to the one
//! session's `propose_pointer_resize` with a Rust-derived boundary/shares
//! from a normalized boundary coordinate; same ack/verify boundary, keyboard
//! wire behavior unchanged), and
//! `DescribeShadowProjection` (read-only v1 shadow projection
//! request -> desired rectangles for exactly three opaque windows, delegated
//! through `AdoptedTrio` + `geometry::project`; no native
//! command/execution/actuation fields and no mutation). The POC-shaped
//! `EvaluatePoc3` route is removed.
//!
//! Boundary rules: no Rust-to-KWin calls (only `org.freedesktop.DBus`
//! credential queries for same-UID caller verification), no persistence, no
//! tray coupling, no autostart, no native mutation. Bounded single-flight
//! endpoint handling via a non-queuing async-lock try-acquire held across
//! verify and evaluate. Name acquisition uses `DoNotQueue`; name loss is
//! terminal. Caller authorization is exactly one fail-closed same-UID check:
//! the caller unique name's Unix UID must equal the Planner geteuid.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use zbus::blocking::{Connection, MessageIterator};
use zbus::fdo::{RequestNameFlags, RequestNameReply};
use zbus::message::Type;
use zbus::{MatchRule, fdo::NameOwnerChanged};

use crate::advisory_contract::{
    ADVISORY_MAX_REPLY_BYTES, ADVISORY_MAX_REVISION, AdvisorySession,
    evaluate_advisory_json_for_armed_loss,
};
use crate::focus_service::FOCUS_MAX_REPLY_BYTES;
use crate::manual_runtime::ManualTrioService;
use crate::movement_service::MOVEMENT_MAX_REPLY_BYTES;
use crate::planner_contract::{MAX_REPLY_BYTES, evaluate_json};
use crate::resize_service::RESIZE_MAX_REPLY_BYTES;
use crate::shadow_projection::{SHADOW_MAX_REPLY_BYTES, ShadowSession, evaluate_shadow_json};

pub const SERVICE: &str = "org.plasmaautotiler.Planner";
pub const OBJECT: &str = "/org/plasmaautotiler/Planner";
pub const INTERFACE: &str = "org.plasmaautotiler.Planner1";
pub const METHOD: &str = "EvaluateMove";
pub const ADVISORY_METHOD: &str = "DescribeAdvisoryPlan";
pub const SHADOW_METHOD: &str = "DescribeShadowProjection";
pub const FOCUS_METHOD: &str = "DescribeFocus";
/// Bounded focus reply cap, mirroring the portable focus service bound.
pub const FOCUS_MAX_REPLY: usize = FOCUS_MAX_REPLY_BYTES;
pub const MOVEMENT_METHOD: &str = "DescribeMovement";
/// Bounded movement reply cap, mirroring the portable movement service bound.
pub const MOVEMENT_MAX_REPLY: usize = MOVEMENT_MAX_REPLY_BYTES;
pub const RESIZE_METHOD: &str = "DescribeResize";
/// Bounded resize reply cap, mirroring the portable resize service bound.
pub const RESIZE_MAX_REPLY: usize = RESIZE_MAX_REPLY_BYTES;
pub const POINTER_RESIZE_METHOD: &str = "DescribePointerResize";
/// Bounded pointer-resize reply cap (same portable resize service bound).
pub const POINTER_RESIZE_MAX_REPLY: usize = RESIZE_MAX_REPLY_BYTES;
pub const KWIN_SERVICE: &str = "org.kde.KWin";

/// Bounded fixed in-band unauthorized rejection for exactly four routes:
/// `DescribeFocus`, `DescribeMovement`, `DescribeResize`, and
/// `DescribePointerResize`. Never parses or echoes request data; those four
/// routes return exactly this body as `Ok`, never as `PlannerError`.
/// `EvaluateMove`, `DescribeAdvisoryPlan`, and `DescribeShadowProjection`
/// keep the D-Bus `PlannerError::Unauthorized` behavior.
pub const UNAUTHORIZED_REPLY: &str =
    "{\"v\":1,\"outcome\":\"rejected\",\"kind\":\"unauthorized\",\"message\":\"unauthorized\"}";
/// Bound for the fixed unauthorized rejection (well under every reply cap).
pub const MAX_UNAUTHORIZED_REPLY_BYTES: usize = 256;

/// Fixed unauthorized rejection body for the four in-band routes.
#[must_use]
pub fn unauthorized_rejection() -> String {
    UNAUTHORIZED_REPLY.to_owned()
}

/// Pure unauthorized-channel decision. Returns true iff `method` is one of
/// the exactly four in-band routes (`DescribeFocus`, `DescribeMovement`,
/// `DescribeResize`, `DescribePointerResize`); `EvaluateMove`,
/// `DescribeAdvisoryPlan`, and `DescribeShadowProjection` use the D-Bus
/// `PlannerError::Unauthorized` channel instead.
#[must_use]
pub fn unauthorized_uses_inband_rejection(method: &str) -> bool {
    matches!(
        method,
        FOCUS_METHOD | MOVEMENT_METHOD | RESIZE_METHOD | POINTER_RESIZE_METHOD
    )
}

/// Production unauthorized-channel helper. Takes the route method identifier
/// and returns exactly what the authorization-failure branch must return:
/// the fixed in-band unauthorized JSON as `Ok` for exactly `DescribeFocus`,
/// `DescribeMovement`, `DescribeResize`, `DescribePointerResize`; D-Bus
/// `Err(PlannerError::Unauthorized)` for exactly `EvaluateMove`,
/// `DescribeAdvisoryPlan`, `DescribeShadowProjection` (and fail-closed for
/// any other method).
pub fn unauthorized_response(method: &str) -> Result<String, PlannerError> {
    match method {
        FOCUS_METHOD | MOVEMENT_METHOD | RESIZE_METHOD | POINTER_RESIZE_METHOD => {
            Ok(unauthorized_rejection())
        }
        METHOD | ADVISORY_METHOD | SHADOW_METHOD => Err(PlannerError::Unauthorized),
        _ => Err(PlannerError::Unauthorized),
    }
}

/// Pure same-UID decision. Accepts iff `caller_uid` is present and equals
/// `expected_uid`; missing or differing UIDs reject fail-closed.
#[must_use]
pub fn caller_uid_authorized(caller_uid: Option<u32>, expected_uid: u32) -> bool {
    matches!(caller_uid, Some(uid) if uid == expected_uid)
}

/// Exact nested-KWin manifest binding. Compatible with the launcher manifest
/// validated by `scripts/nested-kwin-manifest.sh` (schema v2): the private
/// bus address/workdir binding is validated from an explicit
/// operator-supplied manifest file. Per-call caller verification is the same
/// fail-closed same-UID check as production. Partial identity fields are
/// rejected; v1 manifests are rejected as schema mismatch.
const NESTED_MANIFEST_SCHEMA: &str = "nested-kwin-manifest-v2";
const NESTED_KWIN_EXPECTED_VERSION: &str = "6.7.4";
const MAX_NESTED_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_NESTED_MANIFEST_LINES: usize = 128;
const MAX_NESTED_VALUE_BYTES: usize = 4096;

#[derive(Debug, zbus::DBusError, PartialEq, Eq)]
#[zbus(prefix = "org.plasmaautotiler.Planner1")]
pub enum PlannerError {
    Unauthorized,
    Unavailable(String),
}

#[derive(Clone, Debug)]
pub struct PlannerEndpoint {
    operation_lock: Arc<async_lock::Mutex<()>>,
    // Read-only advisory session tracker held in process memory only. Shared
    // across endpoint clones so the single manually started service owns
    // exactly one pinned owner/generation/revision binding. The pinned
    // revision never advances; advisory evaluation performs no mutation.
    advisory_session: Arc<std::sync::Mutex<AdvisorySession>>,
    // Separate read-only shadow projection session tracker held in process
    // memory only. Pins owner/generation on first success and accepts only
    // strictly increasing revisions with fresh correlations, so
    // signal-driven recomputations can proceed. Never shared with advisory.
    shadow_session: Arc<std::sync::Mutex<ShadowSession>>,
    // One shared authoritative exact-three transaction service held in
    // process memory only, shared across endpoint clones so the single
    // manually started service owns exactly one portable session (seeded
    // once from the first strict resize-route request carrying real
    // work-area bounds/gap plus contained per-window rects, single
    // pending). Focus, movement, keyboard resize, and pointer resize
    // transact over this one session; no generic IPC, no shared mutable
    // topology beyond it.
    trio: Arc<std::sync::Mutex<ManualTrioService>>,
    // Optional bounded advisory-loss arming. `None` is the normal
    // `planner-service` mode (unchanged: every accepted reply returns
    // normally). `Some` arms exactly one bounded correlation id: only an
    // authenticated accepted `DescribeAdvisoryPlan` reply whose
    // `correlation_id` exactly equals the armed value emits the stderr
    // marker and withholds that single reply. Earlier success/stale
    // correlations return normally with no marker and no hang.
    advisory_loss_correlation: Option<String>,
}

impl PlannerEndpoint {
    #[must_use]
    pub fn new() -> Self {
        Self {
            operation_lock: Arc::new(async_lock::Mutex::new(())),
            advisory_session: Arc::new(std::sync::Mutex::new(AdvisorySession::new())),
            shadow_session: Arc::new(std::sync::Mutex::new(ShadowSession::new())),
            trio: Arc::new(std::sync::Mutex::new(ManualTrioService::new())),
            advisory_loss_correlation: None,
        }
    }

    /// Armed endpoint for the explicit
    /// `planner-service --advisory-loss-correlation <correlation>` launch
    /// option. Returns `None` (fail closed, no endpoint) for any missing or
    /// invalid bounded correlation instead of arming broadly. No I/O, no
    /// persistence.
    #[must_use]
    pub fn with_advisory_loss_correlation(correlation: &str) -> Option<Self> {
        let armed = parse_advisory_loss_correlation(correlation)?;
        Some(Self {
            operation_lock: Arc::new(async_lock::Mutex::new(())),
            advisory_session: Arc::new(std::sync::Mutex::new(AdvisorySession::new())),
            shadow_session: Arc::new(std::sync::Mutex::new(ShadowSession::new())),
            trio: Arc::new(std::sync::Mutex::new(ManualTrioService::new())),
            advisory_loss_correlation: Some(armed),
        })
    }

    /// Borrow the armed loss correlation, if any. `None` is normal mode.
    #[must_use]
    pub fn advisory_loss_correlation(&self) -> Option<&str> {
        self.advisory_loss_correlation.as_deref()
    }

    /// Whether the shared exact-three scope is established (seeded once
    /// from the first strict resize-route request over the public wire
    /// contract; single-shot, no reseed).
    #[must_use]
    pub fn is_trio_established(&self) -> bool {
        self.trio.lock().is_ok_and(|held| held.is_established())
    }

    /// Accepted revision of the shared trio session (0 while unseeded).
    #[must_use]
    pub fn trio_revision(&self) -> u64 {
        self.trio.lock().map_or(0, |held| held.accepted_revision())
    }

    /// Synchronous read-only advisory request route over the shared session
    /// tracker. The caller must hold the single-flight `operation_lock` guard
    /// and have passed caller verification; this only locks the session
    /// briefly with no awaits while held. A poisoned session is terminal
    /// fail-closed.
    fn evaluate_advisory_request(&self, request: &str) -> Result<String, PlannerError> {
        let mut session = self
            .advisory_session
            .lock()
            .map_err(|_| PlannerError::Unavailable("planner session state was lost".to_owned()))?;
        Ok(evaluate_advisory_json_for_armed_loss(
            &mut session,
            request,
            self.advisory_loss_correlation(),
        ))
    }

    /// Synchronous read-only shadow projection request route over the
    /// separate shadow session tracker. The caller must hold the
    /// single-flight `operation_lock` guard and have passed caller
    /// verification; this only locks the session briefly with no awaits
    /// while held. A poisoned session is terminal fail-closed.
    fn evaluate_shadow_request(&self, request: &str) -> Result<String, PlannerError> {
        let mut session = self
            .shadow_session
            .lock()
            .map_err(|_| PlannerError::Unavailable("planner session state was lost".to_owned()))?;
        Ok(evaluate_shadow_json(&mut session, request))
    }

    /// Synchronous focus transaction route over the shared trio service.
    /// The caller must hold the single-flight `operation_lock` guard and
    /// have passed caller verification; this only locks the service briefly
    /// with no awaits while held. A poisoned service is terminal
    /// fail-closed. Rejects while the trio is unseeded (focus carries no
    /// geometry and can never seed).
    fn evaluate_focus_request(&self, request: &str) -> Result<String, PlannerError> {
        let mut service = self
            .trio
            .lock()
            .map_err(|_| PlannerError::Unavailable("planner session state was lost".to_owned()))?;
        Ok(service.evaluate_focus_json(request))
    }

    /// Synchronous movement transaction route over the shared trio service.
    /// Same single-flight/poison rules as the focus route; the one shared
    /// pending slot is owned by the trio session. Rejects while the trio is
    /// unseeded (movement carries no per-window geometry and can never
    /// seed).
    fn evaluate_movement_request(&self, request: &str) -> Result<String, PlannerError> {
        let mut service = self
            .trio
            .lock()
            .map_err(|_| PlannerError::Unavailable("planner session state was lost".to_owned()))?;
        Ok(service.evaluate_movement_json(request))
    }

    /// Synchronous resize transaction route over the shared trio service.
    /// Same single-flight/poison rules as the focus route. Action-fenced:
    /// keyboard `request` plus shared ack/verify/loss only; `request-pointer`
    /// is rejected without mutation and pointer-owned pending is never
    /// touched. A strict request also seeds the trio when unseeded.
    fn evaluate_resize_request(&self, request: &str) -> Result<String, PlannerError> {
        let mut service = self
            .trio
            .lock()
            .map_err(|_| PlannerError::Unavailable("planner session state was lost".to_owned()))?;
        Ok(service.evaluate_keyboard_json(request))
    }

    /// Synchronous pointer-resize transaction route over the shared trio
    /// service (distinct D-Bus method so keyboard wire behavior is
    /// unchanged). Same single-flight/poison rules as
    /// [`Self::evaluate_resize_request`]; the JSON `action` must be
    /// `request-pointer` with a normalized `proposed_boundary`, while
    /// `acknowledge`/`verify`/`note-loss` bind only to the same pointer
    /// request cycle. Keyboard `request` and keyboard-owned pending cycles
    /// are rejected without mutation, preserving sequential pointer
    /// ack/verify and keyboard behavior. A strict request also seeds the
    /// trio when unseeded.
    fn evaluate_pointer_resize_request(&self, request: &str) -> Result<String, PlannerError> {
        let mut service = self
            .trio
            .lock()
            .map_err(|_| PlannerError::Unavailable("planner session state was lost".to_owned()))?;
        Ok(service.evaluate_pointer_json(request))
    }
}

impl Default for PlannerEndpoint {
    fn default() -> Self {
        Self::new()
    }
}

/// Best-effort route-diag emission. Contract: the caller must have released
/// the single-flight `operation_lock` guard before calling, so formatting and
/// stderr output never execute while the Planner operation lock (or any
/// session mutex) is held. Pure bounded formatting only; never alters wire
/// behavior. The session line derives solely from the already-returned reply
/// value (Planner-boundary emission, no portable Session access).
fn emit_route_refusal(
    route: crate::route_diag::Route,
    request: &str,
    refusal: crate::route_diag::Refusal,
) {
    eprintln!("{}", crate::route_diag::describe_request(route, request));
    eprintln!(
        "{}",
        crate::route_diag::describe_refusal(route, request, refusal)
    );
}

/// Best-effort request/reply/session emission after the lock is released.
/// The portable session outcome line is derived only from the already
/// computed `reply` value via [`crate::route_diag::session_line_for_reply`].
fn emit_route_reply(route: crate::route_diag::Route, request: &str, reply: &str) {
    eprintln!("{}", crate::route_diag::describe_request(route, request));
    eprintln!("{}", crate::route_diag::describe_reply(route, reply));
    if let Some(line) = crate::route_diag::session_line_for_reply(reply) {
        eprintln!("{line}");
    }
}

/// Single build-identity startup emission; caller holds no locks.
fn emit_build_identity_startup() {
    eprintln!("{}", crate::build_identity::startup_line());
}

/// Best-effort Planner trio-seeded lifecycle emission after the lock is
/// released. Generation/correlation come from already-computed request/reply
/// values only; bounded revision only when in bounds.
fn emit_planner_seeded(request: &str, reply: &str) {
    let generation = crate::route_diag::generation_of_request(request);
    let reply_raw: serde_json::Value =
        serde_json::from_str(reply).unwrap_or(serde_json::Value::Null);
    let corr = reply_raw
        .get("correlation_id")
        .and_then(serde_json::Value::as_str);
    let rev = reply_raw
        .get("revision")
        .or_else(|| reply_raw.get("base_revision"))
        .and_then(serde_json::Value::as_u64)
        .filter(|rev| *rev <= crate::route_diag::MAX_DIAG_REVISION);
    eprintln!(
        "{}",
        crate::route_diag::describe_lifecycle(
            crate::route_diag::LifecycleComp::Planner,
            crate::route_diag::LifecycleEvent::Seeded,
            generation.as_deref(),
            rev,
            corr,
            Some(crate::route_diag::LifecycleResult::Ok),
        )
    );
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct NestedManifest {
    workdir: PathBuf,
    kwin_bin: PathBuf,
    kwin_bin_raw: String,
    kwin_bin_canonical: PathBuf,
    kwin_bin_canonical_raw: String,
    kwin_bin_sha256: String,
    kwin_bin_dev: u64,
    kwin_bin_ino: u64,
    kwin_version: String,
    host_runtime: String,
    host_uid: u32,
    host_kwinrc_path: String,
    bus_address: String,
    nested_pid: u32,
    nested_starttick: u64,
    nested_exe: PathBuf,
    nested_exe_raw: String,
    nested_exe_canonical: PathBuf,
    nested_exe_canonical_raw: String,
    nested_exe_sha256: String,
    nested_exe_dev: u64,
    nested_exe_ino: u64,
}

fn nested_sha_valid(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

fn nested_exe_deleted(path: &str) -> bool {
    path.contains(" (deleted)")
}

/// Robust private-bus binding: accept only `unix:` entries whose every
/// `path=`/`abstract=` value is safely under `workdir` (exact or
/// `workdir/` prefix, so sibling `/tmp/a-evil` is rejected); reject host
/// runtime anywhere (substring rejection is fail-closed) and require at
/// least one bound path. Non-unix transports fail closed.
fn nested_bus_binds_workdir(bus_address: &str, workdir: &str, host_runtime: &str) -> bool {
    if bus_address.is_empty() || workdir.is_empty() || host_runtime.is_empty() {
        return false;
    }
    if bus_address.contains(host_runtime) {
        return false;
    }
    let mut found_path = false;
    for entry in bus_address.split(';') {
        if entry.is_empty() || !entry.starts_with("unix:") {
            return false;
        }
        let rest = &entry["unix:".len()..];
        if rest.is_empty() {
            return false;
        }
        for kv in rest.split(',') {
            if let Some(val) = kv
                .strip_prefix("path=")
                .or_else(|| kv.strip_prefix("abstract="))
            {
                if val.is_empty() || !nested_safe_abs(val) {
                    return false;
                }
                if val == workdir || val.starts_with(&format!("{workdir}/")) {
                    found_path = true;
                } else {
                    return false;
                }
            }
        }
    }
    found_path
}

/// Shell-compatible absolute safe path: starts with `/`, is not `/`, has no
/// `//`, no `/../`, no trailing `/..`, no `/./`, no trailing `/.`.
fn nested_safe_abs(path: &str) -> bool {
    if path.is_empty() || !path.starts_with('/') || path == "/" {
        return false;
    }
    if path.contains("//")
        || path.contains("/../")
        || path.ends_with("/..")
        || path.contains("/./")
        || path.ends_with("/.")
    {
        return false;
    }
    true
}

fn nested_key_valid(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 128
        && key
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// Exact static Nix store launcher identity, never by executing the binary:
/// `/nix/store/<32-char-hash>-kwin-<expected>/bin/kwin_wayland` with no
/// embedded separators in the store component.
fn nested_kwin_store_exact(path: &str, expected: &str) -> bool {
    const PREFIX: &str = "/nix/store/";
    const SUFFIX: &str = "/bin/kwin_wayland";
    let Some(without_prefix) = path.strip_prefix(PREFIX) else {
        return false;
    };
    let Some(base) = without_prefix.strip_suffix(SUFFIX) else {
        return false;
    };
    if base.contains('/') || base.contains('\0') {
        return false;
    }
    let Some((hash, _rest)) = base.split_once('-') else {
        return false;
    };
    if hash.len() != 32
        || !hash
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
    {
        return false;
    }
    base == format!("{hash}-kwin-{expected}")
}

/// Exact static Nix wrapped executable identity, never by executing it:
/// `/nix/store/<32-char-hash>-kwin-<expected>/bin/.kwin_wayland-wrapped`
/// with no embedded separators in the store component.
fn nested_kwin_wrapped_exact(path: &str, expected: &str) -> bool {
    const PREFIX: &str = "/nix/store/";
    const SUFFIX: &str = "/bin/.kwin_wayland-wrapped";
    let Some(without_prefix) = path.strip_prefix(PREFIX) else {
        return false;
    };
    let Some(base) = without_prefix.strip_suffix(SUFFIX) else {
        return false;
    };
    if base.contains('/') || base.contains('\0') {
        return false;
    }
    let Some((hash, _)) = base.split_once('-') else {
        return false;
    };
    if hash.len() != 32
        || !hash
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
    {
        return false;
    }
    base == format!("{hash}-kwin-{expected}")
}

/// Derive the expected wrapped sibling for an exact store launcher identity.
fn nested_expected_wrapped(bin: &str) -> Option<String> {
    let stripped = bin.strip_suffix("/bin/kwin_wayland")?;
    Some(format!("{stripped}/bin/.kwin_wayland-wrapped"))
}

fn parse_nested_manifest(text: &str) -> Result<NestedManifest, String> {
    if text.is_empty() || text.len() as u64 > MAX_NESTED_MANIFEST_BYTES {
        return Err("nested manifest size is out of bounds".to_owned());
    }
    let mut map = std::collections::BTreeMap::<String, String>::new();
    let mut lines = 0usize;
    for raw in text.split('\n') {
        // The launcher always terminates every line with `\n`, so the split
        // yields exactly one trailing empty slice; any other empty line is a
        // blank-line tamper signal.
        if raw.is_empty() {
            continue;
        }
        lines += 1;
        if lines > MAX_NESTED_MANIFEST_LINES {
            return Err("nested manifest exceeds line bound".to_owned());
        }
        let (key, value) = raw
            .split_once('=')
            .ok_or_else(|| "nested manifest contains a malformed line".to_owned())?;
        if !nested_key_valid(key) {
            return Err("nested manifest contains a malformed line".to_owned());
        }
        if value.contains('\r') || value.contains('\0') {
            return Err("nested manifest contains a malformed line".to_owned());
        }
        if value.len() > MAX_NESTED_VALUE_BYTES {
            return Err("nested manifest value exceeds bound".to_owned());
        }
        if map.insert(key.to_owned(), value.to_owned()).is_some() {
            return Err("nested manifest contains duplicate keys".to_owned());
        }
    }
    // A blank line anywhere (including a doubled trailing newline) leaves a
    // `\n\n` sequence; the launcher never emits one.
    if text.contains("\n\n") {
        return Err("nested manifest contains a blank line".to_owned());
    }
    let get = |key: &str| -> Result<String, String> {
        map.get(key)
            .cloned()
            .filter(|v| !v.is_empty())
            .ok_or_else(|| format!("nested manifest is missing '{key}'"))
    };
    let schema = get("schema")?;
    if schema != NESTED_MANIFEST_SCHEMA {
        return Err("nested manifest schema mismatch".to_owned());
    }
    let status = map
        .get("status")
        .cloned()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "nested manifest is missing 'status'".to_owned())?;
    if status == "starting" {
        return Err(
            "nested manifest startup was interrupted (status=starting); refusing stale manifest"
                .to_owned(),
        );
    }
    if status != "ready" {
        return Err("nested manifest status must be starting|ready".to_owned());
    }
    let workdir_raw = get("workdir")?;
    let kwin_bin_raw = get("kwin_bin")?;
    let kwin_bin_canonical_raw = get("kwin_bin_canonical")?;
    let kwin_bin_sha256 = get("kwin_bin_sha256")?;
    let kwin_bin_dev_raw = get("kwin_bin_dev")?;
    let kwin_bin_ino_raw = get("kwin_bin_ino")?;
    let kwin_version = get("kwin_version")?;
    let host_runtime = get("host_runtime")?;
    let host_uid_raw = get("host_uid")?;
    let host_kwinrc_path = get("host_kwinrc_path")?;
    let bus_address = get("bus_address")?;
    let nested_pid_raw = get("nested_pid")?;
    let nested_tick_raw = get("nested_starttick")?;
    let nested_exe_raw = get("nested_exe")?;
    let nested_exe_canonical_raw = get("nested_exe_canonical")?;
    let nested_exe_sha256 = get("nested_exe_sha256")?;
    let nested_exe_dev_raw = get("nested_exe_dev")?;
    let nested_exe_ino_raw = get("nested_exe_ino")?;

    if !nested_safe_abs(&workdir_raw) {
        return Err("nested manifest workdir is not an absolute safe path".to_owned());
    }
    if !nested_safe_abs(&kwin_bin_raw) {
        return Err("nested manifest KWin path is unsafe".to_owned());
    }
    if !nested_safe_abs(&kwin_bin_canonical_raw) {
        return Err("nested manifest KWin canonical path is unsafe".to_owned());
    }
    if !nested_safe_abs(&nested_exe_raw) {
        return Err("nested manifest nested exe is not an absolute safe path".to_owned());
    }
    if !nested_safe_abs(&nested_exe_canonical_raw) {
        return Err("nested manifest nested canonical path is unsafe".to_owned());
    }
    if !nested_safe_abs(&host_runtime) {
        return Err("nested manifest host runtime is unsafe".to_owned());
    }
    if nested_exe_deleted(&kwin_bin_raw)
        || nested_exe_deleted(&kwin_bin_canonical_raw)
        || nested_exe_deleted(&nested_exe_raw)
        || nested_exe_deleted(&nested_exe_canonical_raw)
    {
        return Err("nested manifest executable identity is deleted".to_owned());
    }
    if !nested_sha_valid(&kwin_bin_sha256) {
        return Err("nested manifest KWin sha256 is malformed".to_owned());
    }
    if !nested_sha_valid(&nested_exe_sha256) {
        return Err("nested manifest nested sha256 is malformed".to_owned());
    }
    let kwin_bin_dev: u64 = kwin_bin_dev_raw
        .parse()
        .map_err(|_| "nested manifest KWin device is malformed".to_owned())?;
    let kwin_bin_ino: u64 = kwin_bin_ino_raw
        .parse()
        .map_err(|_| "nested manifest KWin inode is malformed".to_owned())?;
    if kwin_bin_ino == 0 {
        return Err("nested manifest KWin inode is malformed".to_owned());
    }
    let nested_exe_dev: u64 = nested_exe_dev_raw
        .parse()
        .map_err(|_| "nested manifest nested device is malformed".to_owned())?;
    let nested_exe_ino: u64 = nested_exe_ino_raw
        .parse()
        .map_err(|_| "nested manifest nested inode is malformed".to_owned())?;
    if nested_exe_ino == 0 {
        return Err("nested manifest nested inode is malformed".to_owned());
    }
    // No partial identity: canonical/hash/device/inode must agree exactly
    // between the KWin on-disk record and the nested live record.
    if kwin_bin_canonical_raw != nested_exe_canonical_raw {
        return Err(
            "nested manifest nested canonical does not match KWin canonical identity".to_owned(),
        );
    }
    if !kwin_bin_sha256.eq_ignore_ascii_case(&nested_exe_sha256) {
        return Err("nested manifest nested sha256 does not match KWin sha256 identity".to_owned());
    }
    if kwin_bin_dev != nested_exe_dev || kwin_bin_ino != nested_exe_ino {
        return Err(
            "nested manifest nested device/inode does not match KWin device/inode identity"
                .to_owned(),
        );
    }
    if kwin_version != NESTED_KWIN_EXPECTED_VERSION {
        return Err(format!(
            "nested manifest KWin version mismatch (expected {NESTED_KWIN_EXPECTED_VERSION})"
        ));
    }
    if kwin_bin_raw.contains("kwin-6.7.3") || kwin_bin_canonical_raw.contains("kwin-6.7.3") {
        return Err("nested manifest stale KWin 6.7.3 path rejected".to_owned());
    }
    // Wrapper-aware launcher/canonical binding: the exact Nix launcher
    // `.../bin/kwin_wayland` binds its canonical identity to the sibling
    // `.../bin/.kwin_wayland-wrapped` in the same exact store output when and
    // only when that sibling has the expected exact store shape. Ordinary
    // non-wrapper identity (launcher == canonical) remains valid only for
    // non-store paths as before; aliases are not broadly trusted.
    if kwin_bin_raw.starts_with("/nix/store/") {
        if !kwin_bin_raw.contains(&format!("kwin-{NESTED_KWIN_EXPECTED_VERSION}")) {
            return Err(format!(
                "nested manifest KWin path does not match expected {NESTED_KWIN_EXPECTED_VERSION}"
            ));
        }
        if !nested_kwin_store_exact(&kwin_bin_raw, NESTED_KWIN_EXPECTED_VERSION) {
            return Err(format!(
                "nested manifest KWin path does not match exact expected identity (/nix/store/<hash>-kwin-{NESTED_KWIN_EXPECTED_VERSION}/bin/kwin_wayland)"
            ));
        }
        let Some(expected_wrapped) = nested_expected_wrapped(&kwin_bin_raw) else {
            return Err("nested manifest KWin wrapped sibling is unexpected".to_owned());
        };
        if kwin_bin_canonical_raw != expected_wrapped {
            return Err(
                "nested manifest KWin canonical does not match expected wrapped sibling".to_owned(),
            );
        }
        if !kwin_bin_canonical_raw.contains(&format!("kwin-{NESTED_KWIN_EXPECTED_VERSION}")) {
            return Err(format!(
                "nested manifest KWin canonical path does not match expected {NESTED_KWIN_EXPECTED_VERSION}"
            ));
        }
        if !nested_kwin_wrapped_exact(&kwin_bin_canonical_raw, NESTED_KWIN_EXPECTED_VERSION) {
            return Err(format!(
                "nested manifest KWin canonical path does not match exact expected wrapped identity (/nix/store/<hash>-kwin-{NESTED_KWIN_EXPECTED_VERSION}/bin/.kwin_wayland-wrapped)"
            ));
        }
    } else {
        if !kwin_bin_raw.contains(&format!("kwin-{NESTED_KWIN_EXPECTED_VERSION}")) {
            return Err(format!(
                "nested manifest KWin path does not match expected {NESTED_KWIN_EXPECTED_VERSION}"
            ));
        }
        if !kwin_bin_canonical_raw.contains(&format!("kwin-{NESTED_KWIN_EXPECTED_VERSION}")) {
            return Err(format!(
                "nested manifest KWin canonical path does not match expected {NESTED_KWIN_EXPECTED_VERSION}"
            ));
        }
        // Ordinary non-wrapper identity only: do not broadly trust aliases.
        if kwin_bin_raw != kwin_bin_canonical_raw {
            return Err(
                "nested manifest KWin canonical does not match KWin launcher identity".to_owned(),
            );
        }
    }
    // L1: host_uid must be numeric and host_kwinrc_path must be safe and
    // outside the WORKDIR.
    let host_uid: u32 = host_uid_raw
        .parse()
        .map_err(|_| "nested manifest host_uid is not a non-negative integer".to_owned())?;
    if !nested_safe_abs(&host_kwinrc_path) {
        return Err("nested manifest host kwinrc path is unsafe".to_owned());
    }
    if host_kwinrc_path == workdir_raw || host_kwinrc_path.starts_with(&format!("{workdir_raw}/")) {
        return Err("nested manifest host kwinrc path must not point into the workdir".to_owned());
    }
    let nested_pid: u32 = nested_pid_raw
        .parse()
        .map_err(|_| "nested manifest nested pid is not a positive integer".to_owned())?;
    if nested_pid == 0 {
        return Err("nested manifest nested pid is not a positive integer".to_owned());
    }
    let nested_starttick: u64 = nested_tick_raw
        .parse()
        .map_err(|_| "nested manifest nested starttick is not a positive integer".to_owned())?;
    if nested_starttick == 0 {
        return Err("nested manifest nested starttick is not a positive integer".to_owned());
    }
    // Private-bus binding: robust parse/prefix binding under the WORKDIR with
    // host runtime rejected anywhere via manifest-derived host_runtime only.
    // No caller ambient environment authority: the serving process is spawned
    // via `env -i` with DBUS_SESSION_BUS_ADDRESS set to this same private
    // address, so an ambient comparison would false-reject the legitimate
    // launch and let an unset variable bypass the check. Host reuse stays
    // rejected through the manifest-derived workdir/host_runtime binding.
    if !nested_bus_binds_workdir(&bus_address, &workdir_raw, &host_runtime) {
        return Err(
            "nested manifest private bus does not bind to the workdir (or references the host runtime)"
                .to_owned(),
        );
    }
    // The private workdir must never be the host runtime or live under it.
    if workdir_raw == host_runtime || workdir_raw.starts_with(&format!("{host_runtime}/")) {
        return Err("nested manifest workdir reuses the host runtime".to_owned());
    }
    Ok(NestedManifest {
        workdir: PathBuf::from(&workdir_raw),
        kwin_bin: PathBuf::from(&kwin_bin_raw),
        kwin_bin_raw,
        kwin_bin_canonical: PathBuf::from(&kwin_bin_canonical_raw),
        kwin_bin_canonical_raw,
        kwin_bin_sha256,
        kwin_bin_dev,
        kwin_bin_ino,
        kwin_version,
        host_runtime,
        host_uid,
        host_kwinrc_path,
        bus_address,
        nested_pid,
        nested_starttick,
        nested_exe: PathBuf::from(&nested_exe_raw),
        nested_exe_raw,
        nested_exe_canonical: PathBuf::from(&nested_exe_canonical_raw),
        nested_exe_canonical_raw,
        nested_exe_sha256,
        nested_exe_dev,
        nested_exe_ino,
    })
}

fn load_nested_manifest(manifest_path: &Path) -> Result<NestedManifest, String> {
    if !manifest_path.is_absolute() {
        return Err("nested manifest path is not absolute".to_owned());
    }
    let symlink = std::fs::symlink_metadata(manifest_path)
        .map_err(|_| "nested manifest is absent or unreadable".to_owned())?;
    if symlink.is_symlink() {
        return Err("nested manifest is symlinked".to_owned());
    }
    if !symlink.is_file() {
        return Err("nested manifest is absent or unreadable".to_owned());
    }
    let len = symlink.len();
    if len == 0 || len > MAX_NESTED_MANIFEST_BYTES {
        return Err("nested manifest size is out of bounds".to_owned());
    }
    let file = File::open(manifest_path)
        .map_err(|_| "nested manifest is absent or unreadable".to_owned())?;
    let mut content = Vec::new();
    file.take(MAX_NESTED_MANIFEST_BYTES + 1)
        .read_to_end(&mut content)
        .map_err(|_| "nested manifest is absent or unreadable".to_owned())?;
    if content.is_empty() || content.len() as u64 > MAX_NESTED_MANIFEST_BYTES {
        return Err("nested manifest size is out of bounds".to_owned());
    }
    let text = String::from_utf8(content)
        .map_err(|_| "nested manifest contains a malformed line".to_owned())?;
    // No ambient environment authority: validation derives exclusively from
    // the explicit manifest file (workdir/host_runtime/bus binding below).
    let manifest = parse_nested_manifest(&text)?;
    if manifest.host_uid != rustix::process::geteuid().as_raw() {
        return Err("nested manifest host_uid does not match the calling uid".to_owned());
    }
    let parent = manifest_path
        .parent()
        .ok_or_else(|| "nested manifest path has no parent".to_owned())?;
    if parent != manifest.workdir {
        return Err("nested manifest workdir does not match this directory".to_owned());
    }
    Ok(manifest)
}

/// Fail-closed same-UID caller verification shared by production and
/// nested routes. Converts `caller` to a unique D-Bus name, queries
/// `org.freedesktop.DBus.GetConnectionUnixUser` for the caller UID through
/// the existing `DBusProxy`, and accepts iff that UID equals the Planner
/// geteuid. Any name conversion, proxy, UID lookup, or mismatch failure
/// rejects.
async fn verify_same_uid_caller(connection: &zbus::Connection, caller: &str) -> bool {
    let Ok(unique_name) = zbus::names::UniqueName::try_from(caller) else {
        return false;
    };
    let Ok(dbus) = zbus::fdo::DBusProxy::new(connection).await else {
        return false;
    };
    let Ok(caller_uid) = dbus.get_connection_unix_user(unique_name.into()).await else {
        return false;
    };
    caller_uid_authorized(Some(caller_uid), rustix::process::geteuid().as_raw())
}

async fn verify_nested_caller(connection: &zbus::Connection, caller: &str) -> bool {
    verify_same_uid_caller(connection, caller).await
}

async fn verify_planner_caller(connection: &zbus::Connection, caller: &str) -> bool {
    verify_same_uid_caller(connection, caller).await
}

#[zbus::interface(name = "org.plasmaautotiler.Planner1")]
impl PlannerEndpoint {
    async fn evaluate_move(
        &self,
        request: String,
        #[zbus(header)] header: zbus::message::Header<'_>,
        #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
    ) -> Result<String, PlannerError> {
        // True bounded single-flight: non-queuing acquire held across the
        // same-UID verify and the pure evaluate, so
        // unauthorized callers cannot cause unbounded concurrent checks.
        // Diagnostics are emitted only after the guard is released (see
        // `emit_route_*` contract), so logging never holds the lock.
        let Some(_guard) = self.operation_lock.try_lock() else {
            emit_route_refusal(
                crate::route_diag::Route::Move,
                &request,
                crate::route_diag::Refusal::Busy,
            );
            return Err(PlannerError::Unavailable("planner is busy".to_owned()));
        };
        if emitter.connection().is_closed() {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Move,
                &request,
                crate::route_diag::Refusal::ConnectionLost,
            );
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        let caller = header.sender().map(ToString::to_string);
        let Some(caller) = caller.as_deref() else {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Move,
                &request,
                crate::route_diag::Refusal::Unauthorized,
            );
            return unauthorized_response(METHOD);
        };
        if !verify_planner_caller(emitter.connection(), caller).await {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Move,
                &request,
                crate::route_diag::Refusal::Unauthorized,
            );
            return unauthorized_response(METHOD);
        };
        let reply = evaluate_json(&request);
        if reply.len() > MAX_REPLY_BYTES {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Move,
                &request,
                crate::route_diag::Refusal::Oversize,
            );
            return Err(PlannerError::Unavailable(
                "reply exceeds size bound".to_owned(),
            ));
        }
        drop(_guard);
        emit_route_reply(crate::route_diag::Route::Move, &request, &reply);
        Ok(reply)
    }

    async fn describe_advisory_plan(
        &self,
        request: String,
        #[zbus(header)] header: zbus::message::Header<'_>,
        #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
    ) -> Result<String, PlannerError> {
        // Read-only advisory route replacing the POC-shaped EvaluatePoc3: the
        // exact same bounded single-flight, same-UID verification, request/reply
        // bounds, and terminal service-loss semantics as EvaluateMove. The
        // existing EvaluateMove contract is frozen. The reply is a
        // deterministic advisory plan with no native command/execution fields
        // and no mutation. Diagnostics are emitted only after the guard is
        // released (see `emit_route_*` contract).
        let Some(_guard) = self.operation_lock.try_lock() else {
            emit_route_refusal(
                crate::route_diag::Route::Advisory,
                &request,
                crate::route_diag::Refusal::Busy,
            );
            return Err(PlannerError::Unavailable("planner is busy".to_owned()));
        };
        if emitter.connection().is_closed() {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Advisory,
                &request,
                crate::route_diag::Refusal::ConnectionLost,
            );
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        let caller = header.sender().map(ToString::to_string);
        let Some(caller) = caller.as_deref() else {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Advisory,
                &request,
                crate::route_diag::Refusal::Unauthorized,
            );
            return unauthorized_response(ADVISORY_METHOD);
        };
        if !verify_planner_caller(emitter.connection(), caller).await {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Advisory,
                &request,
                crate::route_diag::Refusal::Unauthorized,
            );
            return unauthorized_response(ADVISORY_METHOD);
        };
        let reply = match self.evaluate_advisory_request(&request) {
            Ok(reply) => reply,
            Err(error) => {
                drop(_guard);
                emit_route_refusal(
                    crate::route_diag::Route::Advisory,
                    &request,
                    crate::route_diag::Refusal::Unavailable,
                );
                return Err(error);
            }
        };
        if reply.len() > ADVISORY_MAX_REPLY_BYTES {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Advisory,
                &request,
                crate::route_diag::Refusal::Oversize,
            );
            return Err(PlannerError::Unavailable(
                "reply exceeds size bound".to_owned(),
            ));
        }
        // Bounded advisory-loss barrier. Normal mode (`None`) returns every
        // reply directly. Armed mode withholds only the single authenticated
        // accepted reply whose `correlation_id` exactly equals the armed
        // launch correlation: emit one strict bounded schema-v1 marker to
        // stderr, then withhold that reply until the process is stopped while
        // holding the single-flight guard so further calls fail fast.
        // Earlier success/stale correlations (mismatch or rejected) return
        // normally with no marker and no hang. NOTE: this terminal armed-loss
        // path intentionally holds the guard across the hang by design; all
        // route-diag lines below are emitted only after the guard is released
        // on non-armed paths.
        if let Some(armed) = self.advisory_loss_correlation.as_deref()
            && let Some(marker) = loss_marker_for_armed_reply(&reply, armed)
        {
            eprintln!("{marker}");
            std::future::pending::<()>().await;
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        drop(_guard);
        emit_route_reply(crate::route_diag::Route::Advisory, &request, &reply);
        Ok(reply)
    }

    async fn describe_shadow_projection(
        &self,
        request: String,
        #[zbus(header)] header: zbus::message::Header<'_>,
        #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
    ) -> Result<String, PlannerError> {
        // Read-only shadow projection route alongside the frozen
        // EvaluateMove / DescribeAdvisoryPlan contracts: the exact same
        // bounded single-flight, same-UID verification, request/reply bounds,
        // and terminal service-loss semantics. Neither existing method
        // changes behavior. The reply carries complete desired rectangles
        // for exactly three opaque windows with no native
        // command/execution/actuation fields and no mutation, over a
        // separate session tracker from advisory. Diagnostics are emitted
        // only after the guard is released (see `emit_route_*` contract).
        let Some(_guard) = self.operation_lock.try_lock() else {
            emit_route_refusal(
                crate::route_diag::Route::Shadow,
                &request,
                crate::route_diag::Refusal::Busy,
            );
            return Err(PlannerError::Unavailable("planner is busy".to_owned()));
        };
        if emitter.connection().is_closed() {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Shadow,
                &request,
                crate::route_diag::Refusal::ConnectionLost,
            );
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        let caller = header.sender().map(ToString::to_string);
        let Some(caller) = caller.as_deref() else {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Shadow,
                &request,
                crate::route_diag::Refusal::Unauthorized,
            );
            return unauthorized_response(SHADOW_METHOD);
        };
        if !verify_planner_caller(emitter.connection(), caller).await {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Shadow,
                &request,
                crate::route_diag::Refusal::Unauthorized,
            );
            return unauthorized_response(SHADOW_METHOD);
        };
        let reply = match self.evaluate_shadow_request(&request) {
            Ok(reply) => reply,
            Err(error) => {
                drop(_guard);
                emit_route_refusal(
                    crate::route_diag::Route::Shadow,
                    &request,
                    crate::route_diag::Refusal::Unavailable,
                );
                return Err(error);
            }
        };
        if reply.len() > SHADOW_MAX_REPLY_BYTES {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Shadow,
                &request,
                crate::route_diag::Refusal::Oversize,
            );
            return Err(PlannerError::Unavailable(
                "reply exceeds size bound".to_owned(),
            ));
        }
        drop(_guard);
        emit_route_reply(crate::route_diag::Route::Shadow, &request, &reply);
        Ok(reply)
    }

    async fn describe_focus(
        &self,
        request: String,
        #[zbus(header)] header: zbus::message::Header<'_>,
        #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
    ) -> Result<String, PlannerError> {
        // Focus transaction route alongside the frozen EvaluateMove /
        // DescribeAdvisoryPlan / DescribeShadowProjection contracts: the
        // exact same bounded non-queuing single-flight, same-UID verification,
        // connection-loss, and reply-size checks. No existing route changes
        // behavior and no generic IPC is introduced. The reply is a bounded
        // focus plan/ack/verify transaction over the endpoint-owned
        // in-memory focus service (single portable session, single pending).
        // Diagnostics are emitted only after the guard is released (see
        // `emit_route_*` contract).
        let Some(_guard) = self.operation_lock.try_lock() else {
            emit_route_refusal(
                crate::route_diag::Route::Focus,
                &request,
                crate::route_diag::Refusal::Busy,
            );
            return Err(PlannerError::Unavailable("planner is busy".to_owned()));
        };
        if emitter.connection().is_closed() {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Focus,
                &request,
                crate::route_diag::Refusal::ConnectionLost,
            );
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        let caller = header.sender().map(ToString::to_string);
        let Some(caller) = caller.as_deref() else {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Focus,
                &request,
                crate::route_diag::Refusal::Unauthorized,
            );
            return unauthorized_response(FOCUS_METHOD);
        };
        if !verify_planner_caller(emitter.connection(), caller).await {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Focus,
                &request,
                crate::route_diag::Refusal::Unauthorized,
            );
            return unauthorized_response(FOCUS_METHOD);
        };
        let reply = match self.evaluate_focus_request(&request) {
            Ok(reply) => reply,
            Err(error) => {
                drop(_guard);
                emit_route_refusal(
                    crate::route_diag::Route::Focus,
                    &request,
                    crate::route_diag::Refusal::Unavailable,
                );
                return Err(error);
            }
        };
        if reply.len() > FOCUS_MAX_REPLY {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Focus,
                &request,
                crate::route_diag::Refusal::Oversize,
            );
            return Err(PlannerError::Unavailable(
                "reply exceeds size bound".to_owned(),
            ));
        }
        // Correlated diagnostics only: emitted after verification on the real
        // request path with the lock released, so logging never triggers bus
        // activation itself and never holds the operation lock. The portable
        // session outcome line derives solely from the already-returned reply
        // value at this Planner boundary.
        drop(_guard);
        emit_route_reply(crate::route_diag::Route::Focus, &request, &reply);
        Ok(reply)
    }

    async fn describe_movement(
        &self,
        request: String,
        #[zbus(header)] header: zbus::message::Header<'_>,
        #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
    ) -> Result<String, PlannerError> {
        // Movement transaction route alongside the frozen EvaluateMove /
        // DescribeAdvisoryPlan / DescribeShadowProjection / DescribeFocus
        // contracts: the exact same bounded non-queuing single-flight,
        // same-UID verification, connection-loss, and reply-size checks. No existing
        // route changes behavior and no generic IPC is introduced. The reply
        // is a bounded movement plan/ack/verify transaction over the
        // endpoint-owned in-memory movement service (single portable
        // session, single pending).
        // Diagnostics are emitted only after the guard is released (see
        // `emit_route_*` contract).
        let Some(_guard) = self.operation_lock.try_lock() else {
            emit_route_refusal(
                crate::route_diag::Route::Movement,
                &request,
                crate::route_diag::Refusal::Busy,
            );
            return Err(PlannerError::Unavailable("planner is busy".to_owned()));
        };
        if emitter.connection().is_closed() {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Movement,
                &request,
                crate::route_diag::Refusal::ConnectionLost,
            );
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        let caller = header.sender().map(ToString::to_string);
        let Some(caller) = caller.as_deref() else {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Movement,
                &request,
                crate::route_diag::Refusal::Unauthorized,
            );
            return unauthorized_response(MOVEMENT_METHOD);
        };
        if !verify_planner_caller(emitter.connection(), caller).await {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Movement,
                &request,
                crate::route_diag::Refusal::Unauthorized,
            );
            return unauthorized_response(MOVEMENT_METHOD);
        };
        let reply = match self.evaluate_movement_request(&request) {
            Ok(reply) => reply,
            Err(error) => {
                drop(_guard);
                emit_route_refusal(
                    crate::route_diag::Route::Movement,
                    &request,
                    crate::route_diag::Refusal::Unavailable,
                );
                return Err(error);
            }
        };
        if reply.len() > MOVEMENT_MAX_REPLY {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Movement,
                &request,
                crate::route_diag::Refusal::Oversize,
            );
            return Err(PlannerError::Unavailable(
                "reply exceeds size bound".to_owned(),
            ));
        }
        // Correlated diagnostics only: emitted after verification on the real
        // request path with the lock released, so logging never triggers bus
        // activation itself and never holds the operation lock. The portable
        // session outcome line derives solely from the already-returned reply
        // value at this Planner boundary.
        drop(_guard);
        emit_route_reply(crate::route_diag::Route::Movement, &request, &reply);
        Ok(reply)
    }

    async fn describe_resize(
        &self,
        request: String,
        #[zbus(header)] header: zbus::message::Header<'_>,
        #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
    ) -> Result<String, PlannerError> {
        // Keyboard resize transaction route alongside the frozen EvaluateMove /
        // DescribeAdvisoryPlan / DescribeShadowProjection / DescribeFocus /
        // DescribeMovement contracts: the exact same bounded non-queuing
        // single-flight, same-UID verification, connection-loss, and reply-size
        // checks. No existing route changes behavior and no generic IPC is
        // introduced. Action-fenced to keyboard `request` plus shared
        // ack/verify/loss only; pointer actions never mutate this route.
        // Diagnostics are emitted only after the guard is released (see
        // `emit_route_*` contract).
        // The trio-seeded lifecycle line below fires exactly on the
        // false-to-true establishment transition caused by this call; the
        // `was_established` read takes the trio mutex only, never the
        // operation lock.
        let was_established = self.is_trio_established();
        let Some(_guard) = self.operation_lock.try_lock() else {
            emit_route_refusal(
                crate::route_diag::Route::Resize,
                &request,
                crate::route_diag::Refusal::Busy,
            );
            return Err(PlannerError::Unavailable("planner is busy".to_owned()));
        };
        if emitter.connection().is_closed() {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Resize,
                &request,
                crate::route_diag::Refusal::ConnectionLost,
            );
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        let caller = header.sender().map(ToString::to_string);
        let Some(caller) = caller.as_deref() else {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Resize,
                &request,
                crate::route_diag::Refusal::Unauthorized,
            );
            return unauthorized_response(RESIZE_METHOD);
        };
        if !verify_planner_caller(emitter.connection(), caller).await {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Resize,
                &request,
                crate::route_diag::Refusal::Unauthorized,
            );
            return unauthorized_response(RESIZE_METHOD);
        };
        let reply = match self.evaluate_resize_request(&request) {
            Ok(reply) => reply,
            Err(error) => {
                drop(_guard);
                emit_route_refusal(
                    crate::route_diag::Route::Resize,
                    &request,
                    crate::route_diag::Refusal::Unavailable,
                );
                return Err(error);
            }
        };
        if reply.len() > RESIZE_MAX_REPLY {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Resize,
                &request,
                crate::route_diag::Refusal::Oversize,
            );
            return Err(PlannerError::Unavailable(
                "reply exceeds size bound".to_owned(),
            ));
        }
        let seeded_now = self.is_trio_established();
        // Release the operation lock before any output (see `emit_route_*`
        // contract). The portable session outcome line derives solely from
        // the already-returned reply value at this Planner boundary.
        drop(_guard);
        emit_route_reply(crate::route_diag::Route::Resize, &request, &reply);
        if !was_established && seeded_now {
            emit_planner_seeded(&request, &reply);
        }
        Ok(reply)
    }

    async fn describe_pointer_resize(
        &self,
        request: String,
        #[zbus(header)] header: zbus::message::Header<'_>,
        #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
    ) -> Result<String, PlannerError> {
        // Pointer split-share resize route alongside the frozen keyboard
        // `DescribeResize` contract: the exact same bounded non-queuing
        // single-flight, same-UID verification, connection-loss, and reply-size
        // checks over the same endpoint-owned in-memory resize service
        // (single portable session, single pending). Keyboard wire behavior
        // is unchanged.
        // Diagnostics are emitted only after the guard is released (see
        // `emit_route_*` contract).
        // The trio-seeded lifecycle line below fires exactly on the
        // false-to-true establishment transition caused by this call; the
        // `was_established` read takes the trio mutex only, never the
        // operation lock.
        let was_established = self.is_trio_established();
        let Some(_guard) = self.operation_lock.try_lock() else {
            emit_route_refusal(
                crate::route_diag::Route::Pointer,
                &request,
                crate::route_diag::Refusal::Busy,
            );
            return Err(PlannerError::Unavailable("planner is busy".to_owned()));
        };
        if emitter.connection().is_closed() {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Pointer,
                &request,
                crate::route_diag::Refusal::ConnectionLost,
            );
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        let caller = header.sender().map(ToString::to_string);
        let Some(caller) = caller.as_deref() else {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Pointer,
                &request,
                crate::route_diag::Refusal::Unauthorized,
            );
            return unauthorized_response(POINTER_RESIZE_METHOD);
        };
        if !verify_planner_caller(emitter.connection(), caller).await {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Pointer,
                &request,
                crate::route_diag::Refusal::Unauthorized,
            );
            return unauthorized_response(POINTER_RESIZE_METHOD);
        };
        let reply = match self.evaluate_pointer_resize_request(&request) {
            Ok(reply) => reply,
            Err(error) => {
                drop(_guard);
                emit_route_refusal(
                    crate::route_diag::Route::Pointer,
                    &request,
                    crate::route_diag::Refusal::Unavailable,
                );
                return Err(error);
            }
        };
        if reply.len() > POINTER_RESIZE_MAX_REPLY {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Pointer,
                &request,
                crate::route_diag::Refusal::Oversize,
            );
            return Err(PlannerError::Unavailable(
                "reply exceeds size bound".to_owned(),
            ));
        }
        let seeded_now = self.is_trio_established();
        // Release the operation lock before any output (see `emit_route_*`
        // contract). The portable session outcome line derives solely from
        // the already-returned reply value at this Planner boundary.
        drop(_guard);
        emit_route_reply(crate::route_diag::Route::Pointer, &request, &reply);
        if !was_established && seeded_now {
            emit_planner_seeded(&request, &reply);
        }
        Ok(reply)
    }
}

fn serving_connection_lost_error() -> zbus::Error {
    zbus::Error::Failure("planner serving connection was lost".to_owned())
}

fn owner_monitor_ended_error() -> zbus::Error {
    zbus::Error::Failure("planner owner monitor ended unexpectedly".to_owned())
}

fn request_planner_name(connection: &Connection) -> zbus::Result<()> {
    match connection.request_name_with_flags(SERVICE, RequestNameFlags::DoNotQueue.into())? {
        RequestNameReply::PrimaryOwner => Ok(()),
        reply => Err(zbus::Error::Failure(format!(
            "planner service name was not acquired: {reply}"
        ))),
    }
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

/// Pure name-loss decision: terminal when our planner name loses its owner.
fn planner_name_lost(name: &str, new_owner: Option<&str>, our_unique: Option<&str>) -> bool {
    if name != SERVICE {
        return false;
    }
    match (new_owner, our_unique) {
        (Some(next), Some(ours)) => next != ours,
        (None, _) => true,
        (_, None) => new_owner.is_none(),
    }
}

fn handle_name_owner_changed(
    registered_unique: &mut Option<String>,
    name: &str,
    new_owner: Option<String>,
    our_unique: Option<&str>,
) -> zbus::Result<()> {
    if name != SERVICE {
        return Ok(());
    }
    if planner_name_lost(name, new_owner.as_deref(), our_unique) {
        *registered_unique = None;
        return Err(zbus::Error::Failure(
            "planner service name ownership was lost".to_owned(),
        ));
    }
    *registered_unique = new_owner;
    Ok(())
}

/// Stateless manually invoked planner service. Acquires the planner name
/// without queueing and serves `EvaluateMove` until the serving connection or
/// the planner name is lost. No persistence, no tray coupling.
pub fn run() -> zbus::Result<()> {
    serve(PlannerEndpoint::new())
}

/// Explicit bounded launch option for the authorized advisory service-loss
/// phase: `planner-service --advisory-loss-correlation <correlation>`.
/// Normal `planner-service` with no option remains unchanged. The armed
/// correlation must be a valid bounded correlation id; missing, extra, or
/// invalid values fail closed before serving. Same bus name, object,
/// interface, methods, and caller verification as `run()`; no new method,
/// no persistence, no host/path/config changes.
pub fn run_with_advisory_loss_correlation(correlation: &str) -> zbus::Result<()> {
    let Some(endpoint) = PlannerEndpoint::with_advisory_loss_correlation(correlation) else {
        return Err(zbus::Error::Failure(
            "planner-service advisory loss correlation is invalid".to_owned(),
        ));
    };
    serve(endpoint)
}

fn serve(endpoint: PlannerEndpoint) -> zbus::Result<()> {
    let connection = Connection::session()?;
    connection.object_server().at(OBJECT, endpoint)?;
    request_planner_name(&connection)?;
    // One build-identity startup record after successful start; no locks held.
    emit_build_identity_startup();
    let our_unique = connection.unique_name().map(|name| name.to_string());

    let monitor = Connection::session()?;
    let owner_changes = monitor_owner_changes(&monitor)?;
    let mut registered_unique = our_unique.clone();
    for message in owner_changes {
        if connection.is_closed() {
            return Err(serving_connection_lost_error());
        }
        if monitor.is_closed() {
            return Err(owner_monitor_ended_error());
        }
        let message = message?;
        let signal = NameOwnerChanged::from_message(message).ok_or_else(|| {
            zbus::Error::Failure("owner-change iterator yielded a non-owner signal".to_owned())
        })?;
        let args = signal.args()?;
        let name = args.name().to_string();
        let new_owner = args.new_owner().as_ref().map(ToString::to_string);
        handle_name_owner_changed(
            &mut registered_unique,
            &name,
            new_owner,
            our_unique.as_deref(),
        )?;
    }
    Err(owner_monitor_ended_error())
}

/// Distinct nested-mode endpoint. Same D-Bus contract as the production
/// endpoint, with the same fail-closed same-UID caller verification. The
/// explicit validated manifest still gates the private-bus setup in
/// `run_nested`; no per-call PID/`/proc` attestation remains.
#[derive(Clone, Debug)]
struct NestedPlannerEndpoint {
    inner: PlannerEndpoint,
}

impl NestedPlannerEndpoint {
    fn new() -> Self {
        Self {
            inner: PlannerEndpoint::new(),
        }
    }
}

#[zbus::interface(name = "org.plasmaautotiler.Planner1")]
impl NestedPlannerEndpoint {
    async fn evaluate_move(
        &self,
        request: String,
        #[zbus(header)] header: zbus::message::Header<'_>,
        #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
    ) -> Result<String, PlannerError> {
        // Nested-mode EvaluateMove: same contract as production with the same
        // same-UID verification. Diagnostics after guard release only.
        let Some(_guard) = self.inner.operation_lock.try_lock() else {
            emit_route_refusal(
                crate::route_diag::Route::Move,
                &request,
                crate::route_diag::Refusal::Busy,
            );
            return Err(PlannerError::Unavailable("planner is busy".to_owned()));
        };
        if emitter.connection().is_closed() {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Move,
                &request,
                crate::route_diag::Refusal::ConnectionLost,
            );
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        let caller = header.sender().map(ToString::to_string);
        let Some(caller) = caller.as_deref() else {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Move,
                &request,
                crate::route_diag::Refusal::Unauthorized,
            );
            return Err(PlannerError::Unauthorized);
        };
        if !verify_nested_caller(emitter.connection(), caller).await {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Move,
                &request,
                crate::route_diag::Refusal::Unauthorized,
            );
            return Err(PlannerError::Unauthorized);
        };
        let reply = evaluate_json(&request);
        if reply.len() > MAX_REPLY_BYTES {
            drop(_guard);
            emit_route_refusal(
                crate::route_diag::Route::Move,
                &request,
                crate::route_diag::Refusal::Oversize,
            );
            return Err(PlannerError::Unavailable(
                "reply exceeds size bound".to_owned(),
            ));
        }
        drop(_guard);
        emit_route_reply(crate::route_diag::Route::Move, &request, &reply);
        Ok(reply)
    }
}

fn nested_private_connections(bus_address: &str) -> zbus::Result<(Connection, Connection)> {
    if bus_address.is_empty() {
        return Err(zbus::Error::Failure(
            "nested planner requires a validated private bus address".to_owned(),
        ));
    }
    // No session/host fallback: both the serving and the monitor connection
    // must use the manifest's validated private bus address.
    let connection = zbus::blocking::connection::Builder::address(bus_address)?.build()?;
    let monitor = zbus::blocking::connection::Builder::address(bus_address)?.build()?;
    Ok((connection, monitor))
}

/// Private nested planner service. Requires an explicit launcher manifest
/// path; the manifest's validated private bus address is the only bus used.
/// There is no implicit session/host fallback for nested mode.
pub fn run_nested(manifest_path: &Path) -> zbus::Result<()> {
    let manifest = load_nested_manifest(manifest_path)
        .map_err(|error| zbus::Error::Failure(format!("nested manifest rejected: {error}")))?;
    let bus_address = manifest.bus_address.clone();
    let (connection, monitor) = nested_private_connections(&bus_address)?;
    let endpoint = NestedPlannerEndpoint::new();
    connection.object_server().at(OBJECT, endpoint)?;
    request_planner_name(&connection)?;
    // One build-identity startup record after successful start; no locks held.
    emit_build_identity_startup();
    let our_unique = connection.unique_name().map(|name| name.to_string());

    let owner_changes = monitor_owner_changes(&monitor)?;
    let mut registered_unique = our_unique.clone();
    for message in owner_changes {
        if connection.is_closed() {
            return Err(serving_connection_lost_error());
        }
        if monitor.is_closed() {
            return Err(owner_monitor_ended_error());
        }
        let message = message?;
        let signal = NameOwnerChanged::from_message(message).ok_or_else(|| {
            zbus::Error::Failure("owner-change iterator yielded a non-owner signal".to_owned())
        })?;
        let args = signal.args()?;
        let name = args.name().to_string();
        let new_owner = args.new_owner().as_ref().map(ToString::to_string);
        handle_name_owner_changed(
            &mut registered_unique,
            &name,
            new_owner,
            our_unique.as_deref(),
        )?;
    }
    Err(owner_monitor_ended_error())
}

/// Explicit bounded launch flag for the authorized advisory service-loss
/// phase. Used only as `planner-service --advisory-loss-correlation
/// <correlation>`; there is no separate loss-test command or endpoint.
pub const ADVISORY_LOSS_CORRELATION_FLAG: &str = "--advisory-loss-correlation";

/// Bounded schema-v1 service-loss-ready marker kind/version. The marker is a
/// single JSON line on stderr only, binding the accepted advisory reply's
/// correlation/owner/generation/revision.
pub const LOSS_READY_MARKER_KIND: &str = "planner-service-loss-ready";
pub const LOSS_READY_MARKER_VERSION: u32 = 1;
pub const MAX_LOSS_READY_MARKER_BYTES: usize = 1024;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct LossReadyMarker {
    v: u32,
    marker: String,
    correlation_id: String,
    owner: String,
    generation: String,
    revision: u64,
}

/// Strict bounded schema-v1 marker builder. Returns `None` for any malformed
/// binding instead of echoing it. No I/O, no persistence.
#[must_use]
pub fn format_loss_ready_marker(
    correlation_id: &str,
    owner: &str,
    generation: &str,
    revision: u64,
) -> Option<String> {
    crate::ids::CorrelationId::parse(correlation_id)?;
    crate::ids::OwnerId::parse(owner)?;
    crate::ids::GenerationId::parse(generation)?;
    if revision > ADVISORY_MAX_REVISION {
        return None;
    }
    let marker = LossReadyMarker {
        v: LOSS_READY_MARKER_VERSION,
        marker: LOSS_READY_MARKER_KIND.to_owned(),
        correlation_id: correlation_id.to_owned(),
        owner: owner.to_owned(),
        generation: generation.to_owned(),
        revision,
    };
    let text = serde_json::to_string(&marker).ok()?;
    if text.len() > MAX_LOSS_READY_MARKER_BYTES {
        return None;
    }
    // Schema strictness: round-trip must preserve exactly this shape.
    let parsed: LossReadyMarker = serde_json::from_str(&text).ok()?;
    if parsed != marker || parsed.v != 1 || parsed.marker != LOSS_READY_MARKER_KIND {
        return None;
    }
    Some(text)
}

/// Pure acceptance decision for the armed loss mode. Returns the bounded
/// marker to emit (and then withhold the reply for) only when `reply` is an
/// authenticated-accepted advisory reply (`planned`/`noop`, schema v1, with a
/// strictly valid correlation/owner/generation/revision binding). Rejected or
/// malformed replies yield `None`: no marker, no hang.
#[must_use]
pub fn loss_marker_for_advisory_reply(reply: &str) -> Option<String> {
    if reply.is_empty() || reply.len() > ADVISORY_MAX_REPLY_BYTES {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(reply).ok()?;
    if value.get("v")?.as_u64()? != u64::from(LOSS_READY_MARKER_VERSION) {
        return None;
    }
    let outcome = value.get("outcome")?.as_str()?;
    if outcome != "planned" && outcome != "noop" {
        return None;
    }
    let correlation_id = value.get("correlation_id")?.as_str()?;
    let owner = value.get("owner")?.as_str()?;
    let generation = value.get("generation")?.as_str()?;
    let revision = value.get("revision")?.as_u64()?;
    format_loss_ready_marker(correlation_id, owner, generation, revision)
}

/// Bounded launch-correlation parser for
/// `planner-service --advisory-loss-correlation <correlation>`. Returns the
/// owned correlation only when it is a valid bounded correlation id;
/// missing/empty/malformed/overlong values yield `None` (fail closed, no
/// echo). No I/O, no persistence.
#[must_use]
pub fn parse_advisory_loss_correlation(value: &str) -> Option<String> {
    crate::ids::CorrelationId::parse(value).map(|id| id.as_str().to_owned())
}

/// Pure armed acceptance decision. Returns the bounded marker to emit (and
/// then withhold the reply for) only when `armed_correlation` is itself a
/// valid bounded correlation, `reply` is an authenticated-accepted advisory
/// reply, and the reply's `correlation_id` exactly equals the armed value.
/// Any mismatch, rejected/malformed reply, or invalid arming yields `None`:
/// the call returns normally with no marker and no hang. Exact string
/// equality only; no prefix, substring, or case folding.
#[must_use]
pub fn loss_marker_for_armed_reply(reply: &str, armed_correlation: &str) -> Option<String> {
    crate::ids::CorrelationId::parse(armed_correlation)?;
    let marker = loss_marker_for_advisory_reply(reply)?;
    let value: serde_json::Value = serde_json::from_str(reply).ok()?;
    let reply_correlation = value.get("correlation_id")?.as_str()?;
    if reply_correlation != armed_correlation {
        return None;
    }
    // Marker binding must agree with the armed correlation exactly.
    let marker_value: serde_json::Value = serde_json::from_str(&marker).ok()?;
    if marker_value.get("correlation_id")?.as_str()? != armed_correlation {
        return None;
    }
    Some(marker)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_identity_is_exact() {
        assert_eq!(SERVICE, "org.plasmaautotiler.Planner");
        assert_eq!(OBJECT, "/org/plasmaautotiler/Planner");
        assert_eq!(INTERFACE, "org.plasmaautotiler.Planner1");
        assert_eq!(METHOD, "EvaluateMove");
    }

    #[test]
    fn advisory_method_identity_replaces_poc3_and_freezes_move() {
        assert_eq!(ADVISORY_METHOD, "DescribeAdvisoryPlan");
        assert_eq!(METHOD, "EvaluateMove");
        assert_ne!(METHOD, ADVISORY_METHOD);
        assert_eq!(SERVICE, "org.plasmaautotiler.Planner");
        assert_eq!(OBJECT, "/org/plasmaautotiler/Planner");
        assert_eq!(INTERFACE, "org.plasmaautotiler.Planner1");
        assert_eq!(ADVISORY_MAX_REPLY_BYTES, 64 * 1024);
        assert_eq!(ADVISORY_MAX_REPLY_BYTES, MAX_REPLY_BYTES);
    }

    #[test]
    fn planner_name_request_disallows_queueing() {
        let flags = zbus::fdo::RequestNameFlags::DoNotQueue as u32;
        assert_eq!(flags, 0x04);
        assert_eq!(flags & (0x01 | 0x02), 0);
    }

    #[test]
    fn owner_monitor_uses_fixed_dbus_contract() {
        let rule = owner_changes_match_rule().unwrap().to_string();
        assert!(rule.contains("type='signal'"), "{rule}");
        assert!(rule.contains("sender='org.freedesktop.DBus'"), "{rule}");
        assert!(rule.contains("interface='org.freedesktop.DBus'"), "{rule}");
        assert!(rule.contains("member='NameOwnerChanged'"), "{rule}");
    }

    #[test]
    fn planner_name_loss_is_terminal() {
        assert!(planner_name_lost(SERVICE, None, Some(":1.7")));
        assert!(planner_name_lost(SERVICE, Some(":1.9"), Some(":1.7")));
        assert!(!planner_name_lost(SERVICE, Some(":1.7"), Some(":1.7")));
        assert!(!planner_name_lost(KWIN_SERVICE, None, Some(":1.7")));
    }

    #[test]
    fn planner_name_change_handler_exits_on_loss() {
        let mut registered = Some(":1.7".to_owned());
        let result = handle_name_owner_changed(&mut registered, SERVICE, None, Some(":1.7"));
        assert!(result.is_err());
        assert_eq!(registered, None);

        let mut registered = Some(":1.7".to_owned());
        let result = handle_name_owner_changed(&mut registered, KWIN_SERVICE, None, Some(":1.7"));
        assert!(result.is_ok());
        assert_eq!(registered, Some(":1.7".to_owned()));
    }

    #[test]
    fn same_uid_accepts() {
        let expected = rustix::process::geteuid().as_raw();
        assert!(caller_uid_authorized(Some(expected), expected));
    }

    #[test]
    fn differing_uid_rejects() {
        let expected = rustix::process::geteuid().as_raw();
        let differing = expected.wrapping_add(1);
        assert_ne!(differing, expected);
        assert!(!caller_uid_authorized(Some(differing), expected));
        assert!(!caller_uid_authorized(
            Some(expected.wrapping_add(1000)),
            expected
        ));
    }

    #[test]
    fn unavailable_uid_rejects() {
        let expected = rustix::process::geteuid().as_raw();
        assert!(!caller_uid_authorized(None, expected));
    }

    #[test]
    fn unauthorized_reply_is_bounded_fixed_inband_ok() {
        let first = unauthorized_rejection();
        let second = unauthorized_rejection();
        assert_eq!(first, second);
        assert_eq!(first, UNAUTHORIZED_REPLY);
        assert!(first.len() <= MAX_UNAUTHORIZED_REPLY_BYTES);
        assert!(first.len() <= MAX_REPLY_BYTES);
        assert!(first.len() <= FOCUS_MAX_REPLY);
        assert!(first.len() <= MOVEMENT_MAX_REPLY);
        assert!(first.len() <= RESIZE_MAX_REPLY);
        assert!(first.len() <= POINTER_RESIZE_MAX_REPLY);
        let parsed: serde_json::Value =
            serde_json::from_str(&first).expect("unauthorized reply is valid JSON");
        assert_eq!(parsed["outcome"], "rejected");
        assert_eq!(parsed["kind"], "unauthorized");
        // Fixed body never echoes caller input.
        assert!(!first.contains("evil-correlation"));
        // Represents Ok rather than PlannerError.
        let as_result: Result<String, PlannerError> = Ok(unauthorized_rejection());
        assert!(as_result.is_ok());
        assert_ne!(
            as_result.unwrap(),
            String::new(),
            "unauthorized body is non-empty fixed JSON"
        );
    }

    #[test]
    fn unauthorized_channel_is_inband_for_exactly_four_routes() {
        // The four transaction routes return the fixed in-band JSON body via
        // the actual production helper.
        for method in [
            FOCUS_METHOD,
            MOVEMENT_METHOD,
            RESIZE_METHOD,
            POINTER_RESIZE_METHOD,
        ] {
            assert!(
                unauthorized_uses_inband_rejection(method),
                "{method} must use the in-band unauthorized rejection"
            );
            let body = unauthorized_response(method)
                .unwrap_or_else(|_| panic!("{method} must return in-band Ok"));
            assert_eq!(body, UNAUTHORIZED_REPLY, "{method} in-band body is fixed");
            let parsed: serde_json::Value =
                serde_json::from_str(&body).expect("in-band body is valid JSON");
            assert_eq!(parsed["v"], 1);
            assert_eq!(parsed["outcome"], "rejected");
            assert_eq!(parsed["kind"], "unauthorized");
            assert_eq!(parsed["message"], "unauthorized");
        }
        // EvaluateMove, DescribeAdvisoryPlan, DescribeShadowProjection keep
        // the D-Bus PlannerError::Unauthorized channel via the same helper.
        for method in [METHOD, ADVISORY_METHOD, SHADOW_METHOD] {
            assert!(
                !unauthorized_uses_inband_rejection(method),
                "{method} must use PlannerError::Unauthorized"
            );
            assert_eq!(
                unauthorized_response(method),
                Err(PlannerError::Unauthorized),
                "{method} must return D-Bus unauthorized"
            );
        }
    }

    #[test]
    fn endpoint_is_single_flight_shared() {
        let endpoint = PlannerEndpoint::new();
        let cloned = endpoint.clone();
        assert!(Arc::ptr_eq(
            &endpoint.operation_lock,
            &cloned.operation_lock
        ));
        assert!(Arc::ptr_eq(&endpoint.trio, &cloned.trio));
    }

    #[test]
    fn movement_method_identity_is_exact_and_distinct() {
        assert_eq!(MOVEMENT_METHOD, "DescribeMovement");
        assert_ne!(MOVEMENT_METHOD, METHOD);
        assert_ne!(MOVEMENT_METHOD, ADVISORY_METHOD);
        assert_ne!(MOVEMENT_METHOD, SHADOW_METHOD);
        assert_ne!(MOVEMENT_METHOD, FOCUS_METHOD);
        assert_ne!(MOVEMENT_METHOD, RESIZE_METHOD);
        assert_eq!(SERVICE, "org.plasmaautotiler.Planner");
        assert_eq!(OBJECT, "/org/plasmaautotiler/Planner");
        assert_eq!(INTERFACE, "org.plasmaautotiler.Planner1");
        assert_eq!(MOVEMENT_MAX_REPLY, 64 * 1024);
        assert_eq!(
            MOVEMENT_MAX_REPLY,
            crate::movement_service::MOVEMENT_MAX_REPLY_BYTES
        );
    }

    #[test]
    fn movement_method_signature_is_json_string_to_json_string() {
        let message = zbus::message::Message::method_call(OBJECT, MOVEMENT_METHOD)
            .unwrap()
            .destination(SERVICE)
            .unwrap()
            .interface(INTERFACE)
            .unwrap()
            .build(&("{\"v\":1}".to_owned(),))
            .unwrap();
        assert_eq!(message.body().signature().to_string(), "s");
        let body: (String,) = message.body().deserialize().unwrap();
        assert_eq!(body.0, "{\"v\":1}");
    }

    fn movement_seed_request(correlation: &str, owner: &str, fingerprint: u64) -> String {
        serde_json::json!({
            "v": 1,
            "action": "request",
            "correlation_id": correlation,
            "owner": owner,
            "generation": "gen-1",
            "revision": 2,
            "fingerprint": fingerprint,
            "domain": {"output": "move-output", "workspace": "move-workspace"},
            "focused_window": "win-b",
            "direction": "down",
            "windows": [
                {"window": "win-a", "output": "move-output", "workspace": "move-workspace"},
                {"window": "win-b", "output": "move-output", "workspace": "move-workspace"}
            ],
            "capabilities": {
                "swap_neighbor": true, "wrap_perpendicular": true, "wrap_siblings": true,
                "insert_child": true, "split_group_child": true, "reparent_leaf": true,
                "cross_output_transfer": true
            }
        })
        .to_string()
    }

    #[test]
    fn movement_route_rejects_until_trio_seeded() {
        // Movement carries no per-window geometry and can never seed the
        // shared trio: malformed input and strict requests alike fail
        // closed while unseeded, with no session state.
        let endpoint = PlannerEndpoint::new();
        assert!(!endpoint.is_trio_established());
        assert_eq!(endpoint.trio_revision(), 0);
        let fingerprint = crate::movement_service::movement_fingerprint(
            "move-output",
            "move-workspace",
            "win-b",
            &["win-a".to_owned(), "win-b".to_owned()],
        );
        let reply: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_movement_request("{not json}")
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected");
        // Two windows can never be the exact-three scope.
        let reply: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_movement_request(&movement_seed_request("m-1", "owner-1", fingerprint))
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected");
        assert!(!endpoint.is_trio_established());
        // A strict three-window movement request still cannot seed: the
        // route carries no work-area geometry.
        let trio_fp = crate::focus_service::focus_fingerprint(
            "move-output",
            "move-workspace",
            "win-c",
            &["win-a".to_owned(), "win-b".to_owned(), "win-c".to_owned()],
        );
        let trio_req = serde_json::json!({
            "v": 1, "action": "request", "correlation_id": "m-2",
            "owner": "owner-1", "generation": "gen-1", "revision": 3,
            "fingerprint": trio_fp,
            "domain": {"output": "move-output", "workspace": "move-workspace"},
            "focused_window": "win-c", "direction": "down",
            "windows": [
                {"window": "win-a", "output": "move-output", "workspace": "move-workspace"},
                {"window": "win-b", "output": "move-output", "workspace": "move-workspace"},
                {"window": "win-c", "output": "move-output", "workspace": "move-workspace"}
            ],
            "capabilities": {
                "swap_neighbor": true, "wrap_perpendicular": true, "wrap_siblings": true,
                "insert_child": true, "split_group_child": true, "reparent_leaf": true,
                "cross_output_transfer": true
            },
            "domains": [{
                "output": "move-output", "workspace": "move-workspace",
                "bounds": {"x": 0, "y": 0, "w": 1920, "h": 1080},
                "gap": 8, "adjacent": {}
            }]
        })
        .to_string();
        let reply: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_movement_request(&trio_req)
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected");
        assert!(!endpoint.is_trio_established());
        assert_eq!(endpoint.trio_revision(), 0);
    }

    #[test]
    fn focus_method_identity_is_exact_and_distinct() {
        assert_eq!(FOCUS_METHOD, "DescribeFocus");
        assert_ne!(FOCUS_METHOD, METHOD);
        assert_ne!(FOCUS_METHOD, ADVISORY_METHOD);
        assert_ne!(FOCUS_METHOD, SHADOW_METHOD);
        assert_ne!(FOCUS_METHOD, RESIZE_METHOD);
        assert_eq!(SERVICE, "org.plasmaautotiler.Planner");
        assert_eq!(OBJECT, "/org/plasmaautotiler/Planner");
        assert_eq!(INTERFACE, "org.plasmaautotiler.Planner1");
        assert_eq!(FOCUS_MAX_REPLY, 64 * 1024);
        assert_eq!(FOCUS_MAX_REPLY, crate::focus_service::FOCUS_MAX_REPLY_BYTES);
    }

    #[test]
    fn focus_method_signature_is_json_string_to_json_string() {
        let message = zbus::message::Message::method_call(OBJECT, FOCUS_METHOD)
            .unwrap()
            .destination(SERVICE)
            .unwrap()
            .interface(INTERFACE)
            .unwrap()
            .build(&("{\"v\":1}".to_owned(),))
            .unwrap();
        assert_eq!(message.body().signature().to_string(), "s");
        let body: (String,) = message.body().deserialize().unwrap();
        assert_eq!(body.0, "{\"v\":1}");
    }

    #[test]
    fn resize_method_identity_is_exact_and_distinct() {
        assert_eq!(RESIZE_METHOD, "DescribeResize");
        assert_ne!(RESIZE_METHOD, METHOD);
        assert_ne!(RESIZE_METHOD, ADVISORY_METHOD);
        assert_ne!(RESIZE_METHOD, SHADOW_METHOD);
        assert_ne!(RESIZE_METHOD, FOCUS_METHOD);
        assert_ne!(RESIZE_METHOD, MOVEMENT_METHOD);
        assert_eq!(SERVICE, "org.plasmaautotiler.Planner");
        assert_eq!(OBJECT, "/org/plasmaautotiler/Planner");
        assert_eq!(INTERFACE, "org.plasmaautotiler.Planner1");
        assert_eq!(RESIZE_MAX_REPLY, 64 * 1024);
        assert_eq!(
            RESIZE_MAX_REPLY,
            crate::resize_service::RESIZE_MAX_REPLY_BYTES
        );
    }

    #[test]
    fn resize_method_signature_is_json_string_to_json_string() {
        let message = zbus::message::Message::method_call(OBJECT, RESIZE_METHOD)
            .unwrap()
            .destination(SERVICE)
            .unwrap()
            .interface(INTERFACE)
            .unwrap()
            .build(&("{\"v\":1}".to_owned(),))
            .unwrap();
        assert_eq!(message.body().signature().to_string(), "s");
        let body: (String,) = message.body().deserialize().unwrap();
        assert_eq!(body.0, "{\"v\":1}");
    }

    #[test]
    fn resize_route_rejects_malformed_without_session_state() {
        let endpoint = PlannerEndpoint::new();
        let reply: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_resize_request("{\"v\":1}")
                .expect("reply"),
        )
        .expect("json");
        assert_eq!(reply["outcome"], "rejected");
    }

    fn focus_seed_request(correlation: &str, owner: &str, fingerprint: u64) -> String {
        serde_json::json!({
            "v": 1,
            "action": "request",
            "correlation_id": correlation,
            "owner": owner,
            "generation": "gen-1",
            "revision": 3,
            "fingerprint": fingerprint,
            "domain": {"output": "focus-output", "workspace": "focus-workspace"},
            "focused_window": "win-b",
            "direction": "right",
            "windows": [
                {"window": "win-a", "output": "focus-output", "workspace": "focus-workspace"},
                {"window": "win-b", "output": "focus-output", "workspace": "focus-workspace"},
                {"window": "win-c", "output": "focus-output", "workspace": "focus-workspace"}
            ],
            "capabilities": {"directional_focus": true}
        })
        .to_string()
    }

    #[test]
    fn focus_route_rejects_until_trio_seeded() {
        let endpoint = PlannerEndpoint::new();
        let fingerprint = crate::focus_service::focus_fingerprint(
            "focus-output",
            "focus-workspace",
            "win-b",
            &["win-a".to_owned(), "win-b".to_owned(), "win-c".to_owned()],
        );
        // Malformed input is rejected fail-closed without echo.
        let reply: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_focus_request("{not json}")
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected");
        // A strict focus request can never seed the trio (no geometry):
        // rejected with no session state.
        let reply: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_focus_request(&focus_seed_request("f-1", "owner-1", fingerprint))
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected");
        assert!(!endpoint.is_trio_established());
        // Literal-zero fingerprint is rejected (exact deterministic binding).
        let zeroed = focus_seed_request("f-2", "owner-1", 0);
        let reply: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_focus_request(&zeroed)
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected");
        // Changed membership after seeding is rejected without divergence.
        let changed = serde_json::json!({
            "v": 1, "action": "request", "correlation_id": "f-3",
            "owner": "owner-1", "generation": "gen-1", "revision": 2,
            "fingerprint": crate::focus_service::focus_fingerprint(
                "focus-output", "focus-workspace", "win-a",
                &["win-a".to_owned(), "win-z".to_owned()],
            ),
            "domain": {"output": "focus-output", "workspace": "focus-workspace"},
            "focused_window": "win-a", "direction": "right",
            "windows": [
                {"window": "win-a", "output": "focus-output", "workspace": "focus-workspace"},
                {"window": "win-z", "output": "focus-output", "workspace": "focus-workspace"}
            ],
            "capabilities": {"directional_focus": true}
        })
        .to_string();
        let reply: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_focus_request(&changed)
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected");
    }

    #[test]
    fn advisory_session_is_shared_and_unpinned_initially() {
        let endpoint = PlannerEndpoint::new();
        let cloned = endpoint.clone();
        assert!(Arc::ptr_eq(
            &endpoint.advisory_session,
            &cloned.advisory_session
        ));
        let session = endpoint
            .advisory_session
            .lock()
            .expect("fresh session lock succeeds");
        assert!(!session.is_pinned());
        assert_eq!(session.pinned_revision(), 0);
    }

    fn advisory_test_request(correlation: &str, owner: &str) -> String {
        // Observation-only: no tree/leaf/focused_leaf. Rust builds H[A,V[B,C]]
        // and sorted B-down swaps with C (R2a), preserving prior expectations.
        serde_json::json!({
            "v": 1,
            "correlation_id": correlation,
            "owner": owner,
            "generation": "gen-1",
            "revision": 0,
            "snapshot": {
                "outputs": [{
                    "id": "source",
                    "workspace": "workspace-1",
                    "adjacent": {}
                }],
                "windows": [
                    {"window": "w-A", "output": "source", "workspace": "workspace-1"},
                    {"window": "w-B", "output": "source", "workspace": "workspace-1"},
                    {"window": "w-C", "output": "source", "workspace": "workspace-1"}
                ]
            },
            "intent": {
                "source_output": "source",
                "focused_window": "w-B",
                "direction": "down"
            },
            "capabilities": {
                "swap_neighbor": true,
                "wrap_perpendicular": true,
                "wrap_siblings": true,
                "insert_child": true,
                "split_group_child": true,
                "reparent_leaf": true,
                "cross_output_transfer": true
            }
        })
        .to_string()
    }

    fn shadow_test_request(correlation: &str, owner: &str, revision: u64) -> String {
        // Read-only shadow projection: explicit work area, exact-three opaque
        // windows, focus binding, gap, and shadow-projection capability. Rust
        // builds H[A,V[B,C]] through AdoptedTrio + geometry::project.
        serde_json::json!({
            "v": 1,
            "correlation_id": correlation,
            "owner": owner,
            "generation": "gen-1",
            "revision": revision,
            "output": {
                "id": "source",
                "workspace": "workspace-1",
                "work_area": {"x": 0, "y": 0, "w": 90, "h": 60}
            },
            "windows": [
                {"window": "w-A", "output": "source", "workspace": "workspace-1", "rect": {"x": 0, "y": 0, "w": 10, "h": 10}},
                {"window": "w-B", "output": "source", "workspace": "workspace-1", "rect": {"x": 10, "y": 0, "w": 10, "h": 10}},
                {"window": "w-C", "output": "source", "workspace": "workspace-1", "rect": {"x": 20, "y": 0, "w": 10, "h": 10}}
            ],
            "gap": 4,
            "focused_window": "w-B",
            "capabilities": {"shadow_projection": true}
        })
        .to_string()
    }

    #[test]
    fn shadow_method_identity_is_exact_and_distinct() {
        assert_eq!(SHADOW_METHOD, "DescribeShadowProjection");
        assert_ne!(SHADOW_METHOD, METHOD);
        assert_ne!(SHADOW_METHOD, ADVISORY_METHOD);
        assert_eq!(SERVICE, "org.plasmaautotiler.Planner");
        assert_eq!(OBJECT, "/org/plasmaautotiler/Planner");
        assert_eq!(INTERFACE, "org.plasmaautotiler.Planner1");
        assert_eq!(
            crate::shadow_projection::SHADOW_MAX_REPLY_BYTES,
            SHADOW_MAX_REPLY_BYTES
        );
        assert_eq!(SHADOW_MAX_REPLY_BYTES, 64 * 1024);
    }

    #[test]
    fn shadow_request_route_is_bounded_owner_pinned_and_read_only() {
        let endpoint = PlannerEndpoint::new();
        let reply: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_shadow_request("{not json}")
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected");
        assert!(reply.to_string().len() <= SHADOW_MAX_REPLY_BYTES);

        let reply: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_shadow_request(&shadow_test_request("s-1", "owner-1", 0))
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(reply["outcome"], "projected");
        assert_eq!(reply["correlation_id"], "s-1");
        assert_eq!(reply["owner"], "owner-1");
        assert_eq!(reply["capability"], "shadow-projection");
        assert_eq!(reply["desired"].as_array().expect("desired").len(), 3);
        let text = reply.to_string();
        for forbidden in ["command", "execute", "exec", "script", "native", "action"] {
            assert!(
                !text.contains(&format!("\"{forbidden}\"")),
                "reply must not contain {forbidden}"
            );
        }

        let reply: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_shadow_request(&shadow_test_request("s-2", "owner-2", 1))
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["kind"], "owner-mismatch");
        assert!(!reply.to_string().contains("owner-2"));
    }

    #[test]
    fn shadow_session_is_separate_and_signal_driven() {
        let endpoint = PlannerEndpoint::new();
        // Advisory pinning never shares state with the shadow tracker.
        let advisory: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_advisory_request(&advisory_test_request("c-1", "owner-1"))
                .expect("advisory route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(advisory["outcome"], "planned");
        let shadow_locked = endpoint
            .shadow_session
            .lock()
            .expect("shadow session lock succeeds");
        assert!(!shadow_locked.is_pinned());
        assert_eq!(shadow_locked.pinned_revision(), 0);
        drop(shadow_locked);

        // Shadow revisions advance strictly so signal-driven recomputations
        // proceed; stale and duplicate correlations fail closed.
        let first: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_shadow_request(&shadow_test_request("s-1", "owner-1", 0))
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(first["outcome"], "projected");
        let second: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_shadow_request(&shadow_test_request("s-2", "owner-1", 1))
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(second["outcome"], "projected");
        assert_eq!(second["revision"], 1);
        let stale: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_shadow_request(&shadow_test_request("s-3", "owner-1", 1))
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(stale["outcome"], "rejected");
        assert_eq!(stale["kind"], "stale-revision");
        let dupe: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_shadow_request(&shadow_test_request("s-2", "owner-1", 2))
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(dupe["outcome"], "rejected");
        assert_eq!(dupe["kind"], "correlation-mismatch");
        // Nested endpoint support is intentionally POC-only/out of scope: the
        // shadow route never consults nested manifests here.
    }

    #[test]
    fn shadow_method_signature_is_json_string_to_json_string() {
        let message = zbus::message::Message::method_call(OBJECT, SHADOW_METHOD)
            .unwrap()
            .destination(SERVICE)
            .unwrap()
            .interface(INTERFACE)
            .unwrap()
            .build(&("{\"v\":1}".to_owned(),))
            .unwrap();
        assert_eq!(message.body().signature().to_string(), "s");
        let body: (String,) = message.body().deserialize().unwrap();
        assert_eq!(body.0, "{\"v\":1}");
    }

    #[test]
    fn advisory_request_route_is_bounded_owner_pinned_and_read_only() {
        let endpoint = PlannerEndpoint::new();
        // Malformed input is rejected fail-closed without echo.
        let reply: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_advisory_request("{not json}")
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected");
        assert!(reply.to_string().len() <= ADVISORY_MAX_REPLY_BYTES);

        // First valid advisory pins the session and echoes the binding.
        let reply: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_advisory_request(&advisory_test_request("c-1", "owner-1"))
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(reply["outcome"], "planned");
        assert_eq!(reply["correlation_id"], "c-1");
        assert_eq!(reply["owner"], "owner-1");
        assert_eq!(reply["rule"], "R2a");
        let text = reply.to_string();
        assert!(!text.contains("command"));
        assert!(!text.contains("desired"));

        // Mismatched owner is rejected without echo; revision never advances.
        let reply: serde_json::Value = serde_json::from_str(
            &endpoint
                .evaluate_advisory_request(&advisory_test_request("c-2", "owner-2"))
                .expect("route returns a reply string"),
        )
        .expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["kind"], "owner-mismatch");
        assert!(!reply.to_string().contains("owner-2"));
        let session = endpoint
            .advisory_session
            .lock()
            .expect("session lock succeeds");
        assert!(session.is_pinned());
        assert_eq!(session.pinned_revision(), 0);
    }

    #[test]
    fn single_flight_is_non_queuing_bounded() {
        let endpoint = PlannerEndpoint::new();
        let guard = endpoint.operation_lock.try_lock();
        assert!(guard.is_some(), "idle endpoint must acquire");
        assert!(
            endpoint.operation_lock.try_lock().is_none(),
            "contended endpoint must fail fast instead of queueing verify work"
        );
        drop(guard);
        assert!(endpoint.operation_lock.try_lock().is_some());
    }

    #[test]
    fn connection_loss_and_monitor_end_are_errors() {
        let serving = serving_connection_lost_error();
        assert!(serving.to_string().contains("serving connection was lost"));
        let ended = owner_monitor_ended_error();
        assert!(ended.to_string().contains("monitor ended unexpectedly"));
    }

    #[test]
    fn method_signature_is_json_string_to_json_string() {
        let message = zbus::message::Message::method_call(OBJECT, METHOD)
            .unwrap()
            .destination(SERVICE)
            .unwrap()
            .interface(INTERFACE)
            .unwrap()
            .build(&("{\"v\":1}".to_owned(),))
            .unwrap();
        assert_eq!(message.body().signature().to_string(), "s");
        let body: (String,) = message.body().deserialize().unwrap();
        assert_eq!(body.0, "{\"v\":1}");
    }

    #[test]
    fn advisory_method_signature_is_json_string_to_json_string() {
        let message = zbus::message::Message::method_call(OBJECT, ADVISORY_METHOD)
            .unwrap()
            .destination(SERVICE)
            .unwrap()
            .interface(INTERFACE)
            .unwrap()
            .build(&("{\"v\":1}".to_owned(),))
            .unwrap();
        assert_eq!(message.body().signature().to_string(), "s");
        let body: (String,) = message.body().deserialize().unwrap();
        assert_eq!(body.0, "{\"v\":1}");
    }

    const NESTED_TEST_SHA: &str =
        "c21006664ee13ed232387474b23c8ed2b10e4084266ce427043de2a16108c4b8";
    const NESTED_TEST_DEV: u64 = 7;
    const NESTED_TEST_INO: u64 = 8;

    fn nested_test_manifest_text(workdir: &str, kwin_bin: &str) -> String {
        format!(
            "schema=nested-kwin-manifest-v2\n\
status=ready\n\
workdir={workdir}\n\
kwin_bin={kwin_bin}\n\
kwin_bin_canonical={kwin_bin}\n\
kwin_bin_sha256={sha}\n\
kwin_bin_dev={dev}\n\
kwin_bin_ino={ino}\n\
kwin_version=6.7.4\n\
host_runtime=/run/user/1000\n\
host_uid=1000\n\
host_kwinrc_path=/tmp/nested-test-kwinrc\n\
bus_address=unix:path={workdir}/runtime/bus\n\
nested_pid=2222\n\
nested_starttick=222200\n\
nested_exe={kwin_bin}\n\
nested_exe_canonical={kwin_bin}\n\
nested_exe_sha256={sha}\n\
nested_exe_dev={dev}\n\
nested_exe_ino={ino}\n",
            sha = NESTED_TEST_SHA,
            dev = NESTED_TEST_DEV,
            ino = NESTED_TEST_INO,
        )
    }

    #[test]
    fn nested_manifest_rejects_missing_and_tampered_values() {
        let workdir = "/tmp/nested-test-workdir";
        let kwin = format!("{workdir}/kwin-6.7.4/bin/kwin_wayland");
        let valid = nested_test_manifest_text(workdir, &kwin);
        assert!(parse_nested_manifest(&valid).is_ok());

        // Missing nested_pid.
        let missing: String = valid
            .lines()
            .filter(|l| !l.starts_with("nested_pid="))
            .map(|l| format!("{l}\n"))
            .collect();
        assert!(
            parse_nested_manifest(&missing)
                .unwrap_err()
                .contains("nested_pid")
        );

        // Empty bus address.
        let empty_bus = valid.replace(
            &format!("bus_address=unix:path={workdir}/runtime/bus"),
            "bus_address=",
        );
        assert!(
            parse_nested_manifest(&empty_bus)
                .unwrap_err()
                .contains("bus_address")
        );

        // Schema mismatch (v1 rejected, v0 rejected).
        let bad_schema = valid.replace(
            "schema=nested-kwin-manifest-v2",
            "schema=nested-kwin-manifest-v0",
        );
        assert!(
            parse_nested_manifest(&valid.replace(
                "schema=nested-kwin-manifest-v2",
                "schema=nested-kwin-manifest-v1"
            ))
            .unwrap_err()
            .contains("schema")
        );
        assert!(
            parse_nested_manifest(&bad_schema)
                .unwrap_err()
                .contains("schema")
        );

        // Interrupted startup stays stale.
        let starting = valid.replace("status=ready", "status=starting");
        assert!(
            parse_nested_manifest(&starting)
                .unwrap_err()
                .contains("interrupted")
        );

        // Malformed line and duplicate keys fail closed.
        assert!(
            parse_nested_manifest(&format!("{valid}not a kv line\n"))
                .unwrap_err()
                .contains("malformed")
        );
        assert!(
            parse_nested_manifest(&format!("{valid}status=ready\n"))
                .unwrap_err()
                .contains("duplicate")
        );
        // Blank line fails closed.
        assert!(
            parse_nested_manifest(&valid.replace("\n", "\n\n"))
                .unwrap_err()
                .contains("blank")
        );
        // Zero PID / tick rejected.
        assert!(
            parse_nested_manifest(&valid.replace("nested_pid=2222", "nested_pid=0"))
                .unwrap_err()
                .contains("positive integer")
        );
        assert!(
            parse_nested_manifest(&valid.replace("nested_starttick=222200", "nested_starttick=0"))
                .unwrap_err()
                .contains("positive integer")
        );
    }

    #[test]
    fn nested_manifest_rejects_executable_mismatch() {
        // Manifest-level nested canonical != kwin canonical rejected at parse.
        let workdir = "/tmp/nested-test-workdir";
        let text =
            nested_test_manifest_text(workdir, &format!("{workdir}/kwin-6.7.4/bin/kwin_wayland"))
                .replace(
                    &format!("nested_exe_canonical={workdir}/kwin-6.7.4/bin/kwin_wayland"),
                    "nested_exe_canonical=/tmp/evil-kwin",
                );
        assert!(
            parse_nested_manifest(&text)
                .unwrap_err()
                .contains("does not match KWin canonical")
        );
        // Deleted suffix fails closed.
        let deleted =
            nested_test_manifest_text(workdir, &format!("{workdir}/kwin-6.7.4/bin/kwin_wayland"))
                .replace(
                    &format!("nested_exe={workdir}/kwin-6.7.4/bin/kwin_wayland"),
                    &format!("nested_exe={workdir}/kwin-6.7.4/bin/kwin_wayland (deleted)"),
                );
        assert!(
            parse_nested_manifest(&deleted)
                .unwrap_err()
                .contains("deleted")
        );
    }

    #[test]
    fn nested_manifest_rejects_stale_kwin_version_and_path() {
        let workdir = "/tmp/nested-test-workdir";
        let good_kwin = format!("{workdir}/kwin-6.7.4/bin/kwin_wayland");
        let valid = nested_test_manifest_text(workdir, &good_kwin);
        // Wrong version.
        let stale_version = valid.replace("kwin_version=6.7.4", "kwin_version=6.7.3");
        assert!(
            parse_nested_manifest(&stale_version)
                .unwrap_err()
                .contains("version mismatch")
        );
        // Stale 6.7.3 path.
        let stale_path_kwin = format!("{workdir}/kwin-6.7.3/bin/kwin_wayland");
        let stale_path = nested_test_manifest_text(workdir, &stale_path_kwin);
        assert!(
            parse_nested_manifest(&stale_path)
                .unwrap_err()
                .contains("6.7.3")
        );
        // Path not matching the pinned version.
        let other_kwin = format!("{workdir}/kwin-9.9.9/bin/kwin_wayland");
        let other = nested_test_manifest_text(workdir, &other_kwin);
        assert!(
            parse_nested_manifest(&other)
                .unwrap_err()
                .contains("does not match expected")
        );
    }

    #[test]
    fn nested_manifest_rejects_host_bus_reuse() {
        let workdir = "/tmp/nested-test-workdir";
        let kwin = format!("{workdir}/kwin-6.7.4/bin/kwin_wayland");
        let valid = nested_test_manifest_text(workdir, &kwin);
        // Explicit host bus input is rejected via manifest-derived binding
        // (no ambient environment authority).
        let host_bus = "unix:path=/run/user/1000/bus";
        let leak = valid.replace(
            &format!("bus_address=unix:path={workdir}/runtime/bus"),
            &format!("bus_address={host_bus}"),
        );
        assert!(
            parse_nested_manifest(&leak)
                .unwrap_err()
                .contains("does not bind")
        );
        // Bus referencing the host runtime without the workdir is rejected.
        let host_ref = valid.replace(
            &format!("bus_address=unix:path={workdir}/runtime/bus"),
            "bus_address=unix:path=/run/user/1000/runtime/bus",
        );
        assert!(
            parse_nested_manifest(&host_ref)
                .unwrap_err()
                .contains("workdir")
        );
        // Workdir inside the host runtime is rejected.
        let host_wd = valid
            .replace(
                "workdir=/tmp/nested-test-workdir",
                "workdir=/run/user/1000/nested",
            )
            .replace(
                &format!("bus_address=unix:path={workdir}/runtime/bus"),
                "bus_address=unix:path=/run/user/1000/nested/runtime/bus",
            );
        assert!(
            parse_nested_manifest(&host_wd)
                .unwrap_err()
                .contains("host runtime")
        );
    }

    #[test]
    fn nested_manifest_has_no_ambient_bus_authority() {
        let workdir = "/tmp/nested-test-workdir";
        let kwin = format!("{workdir}/kwin-6.7.4/bin/kwin_wayland");
        let valid = nested_test_manifest_text(workdir, &kwin);
        // Hostile ambient host bus is ignored: the manifest-derived
        // workdir/host_runtime binding is the only authority.
        // SAFETY: no other test in this binary reads DBUS_SESSION_BUS_ADDRESS
        // and the value is restored before return.
        unsafe { std::env::set_var("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/1000/bus") };
        assert!(parse_nested_manifest(&valid).is_ok());
        // Ambient agreeing with the private bus must not reject either: an
        // ambient equality check would false-reject the legitimate launch.
        unsafe {
            std::env::set_var(
                "DBUS_SESSION_BUS_ADDRESS",
                format!("unix:path={workdir}/runtime/bus"),
            )
        };
        assert!(parse_nested_manifest(&valid).is_ok());
        unsafe { std::env::remove_var("DBUS_SESSION_BUS_ADDRESS") };
        // Host-valued manifest bus stays rejected with nothing ambient
        // consulted.
        let host_bus = valid.replace(
            &format!("bus_address=unix:path={workdir}/runtime/bus"),
            "bus_address=unix:path=/run/user/1000/bus",
        );
        assert!(
            parse_nested_manifest(&host_bus)
                .unwrap_err()
                .contains("does not bind")
        );
    }

    #[test]
    fn nested_loader_requires_manifest_and_binds_workdir() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "planner-nested-test-{}-{stamp}",
            std::process::id()
        ));
        let workdir = root.join("case");
        std::fs::create_dir_all(&workdir).unwrap();
        let kwin = format!("{}/kwin-6.7.4/bin/kwin_wayland", workdir.to_string_lossy());
        let manifest_path = workdir.join("manifest");
        std::fs::write(
            &manifest_path,
            nested_test_manifest_text(&workdir.to_string_lossy(), &kwin),
        )
        .unwrap();
        let loaded = load_nested_manifest(&manifest_path).expect("valid manifest loads");
        assert_eq!(loaded.nested_pid, 2222);
        assert_eq!(loaded.nested_starttick, 222200);

        // Tampered workdir value does not match the parent directory.
        std::fs::write(
            &manifest_path,
            nested_test_manifest_text(&workdir.to_string_lossy(), &kwin)
                .replace(
                    &format!("workdir={}", workdir.to_string_lossy()),
                    "workdir=/tmp/evil",
                )
                .replace(
                    &format!(
                        "bus_address=unix:path={}/runtime/bus",
                        workdir.to_string_lossy()
                    ),
                    "bus_address=unix:path=/tmp/evil/runtime/bus",
                ),
        )
        .unwrap();
        assert!(
            load_nested_manifest(&manifest_path)
                .unwrap_err()
                .contains("does not match")
        );

        // Missing manifest fails closed.
        std::fs::remove_file(&manifest_path).unwrap();
        assert!(load_nested_manifest(&manifest_path).is_err());
        // Relative manifest path is rejected (no CWD ambiguity).
        assert!(load_nested_manifest(Path::new("manifest")).is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn nested_private_connections_require_an_address() {
        assert!(nested_private_connections("").is_err());
    }

    #[test]
    fn nested_bus_parser_rejects_sibling_and_embedded_host_runtime() {
        // Sibling prefix confusion: /tmp/a-evil is not under /tmp/a.
        assert!(!nested_bus_binds_workdir(
            "unix:path=/tmp/a-evil/runtime/bus",
            "/tmp/a",
            "/run/user/1000"
        ));
        assert!(nested_bus_binds_workdir(
            "unix:path=/tmp/a/runtime/bus",
            "/tmp/a",
            "/run/user/1000"
        ));
        // Exact workdir path itself binds.
        assert!(nested_bus_binds_workdir(
            "unix:path=/tmp/a",
            "/tmp/a",
            "/run/user/1000"
        ));
        // Host runtime embedded anywhere is rejected, even with workdir present.
        assert!(!nested_bus_binds_workdir(
            "unix:path=/tmp/a/runtime/bus,extra=/run/user/1000/x",
            "/tmp/a",
            "/run/user/1000"
        ));
        assert!(!nested_bus_binds_workdir(
            "unix:path=/run/user/1000/runtime/bus",
            "/tmp/a",
            "/run/user/1000"
        ));
        // Non-unix transports and missing paths fail closed.
        assert!(!nested_bus_binds_workdir(
            "tcp:host=localhost,port=1234",
            "/tmp/a",
            "/run/user/1000"
        ));
        assert!(!nested_bus_binds_workdir(
            "unix:guid=abc",
            "/tmp/a",
            "/run/user/1000"
        ));
        assert!(nested_bus_binds_workdir(
            "unix:path=/tmp/a/runtime/bus,guid=abc",
            "/tmp/a",
            "/run/user/1000"
        ));
        assert!(nested_bus_binds_workdir(
            "unix:abstract=/tmp/a/bus",
            "/tmp/a",
            "/run/user/1000"
        ));
        // Manifest-level sibling and embedded cases fail closed.
        let workdir = "/tmp/nested-test-workdir";
        let kwin = format!("{workdir}/kwin-6.7.4/bin/kwin_wayland");
        let valid = nested_test_manifest_text(workdir, &kwin);
        let sibling = valid.replace(
            &format!("bus_address=unix:path={workdir}/runtime/bus"),
            "bus_address=unix:path=/tmp/nested-test-workdir-evil/runtime/bus",
        );
        assert!(
            parse_nested_manifest(&sibling)
                .unwrap_err()
                .contains("does not bind")
        );
        let embedded = valid.replace(
            &format!("bus_address=unix:path={workdir}/runtime/bus"),
            &format!("bus_address=unix:path={workdir}/runtime/bus;unix:path=/run/user/1000/bus"),
        );
        assert!(
            parse_nested_manifest(&embedded)
                .unwrap_err()
                .contains("does not bind")
        );
    }

    #[test]
    fn nested_manifest_validates_host_uid_and_kwinrc_path() {
        let workdir = "/tmp/nested-test-workdir";
        let kwin = format!("{workdir}/kwin-6.7.4/bin/kwin_wayland");
        let valid = nested_test_manifest_text(workdir, &kwin);
        // host_uid must be numeric.
        let non_numeric = valid.replace("host_uid=1000", "host_uid=abc");
        assert!(
            parse_nested_manifest(&non_numeric)
                .unwrap_err()
                .contains("host_uid")
        );
        // host kwinrc inside the WORKDIR is rejected.
        let kwinrc_inside = valid.replace(
            "host_kwinrc_path=/tmp/nested-test-kwinrc",
            &format!("host_kwinrc_path={workdir}/kwinrc"),
        );
        assert!(
            parse_nested_manifest(&kwinrc_inside)
                .unwrap_err()
                .contains("kwinrc")
        );
    }

    #[test]
    fn nested_manifest_rejects_partial_identity_fields() {
        let workdir = "/tmp/nested-test-workdir";
        let kwin = format!("{workdir}/kwin-6.7.4/bin/kwin_wayland");
        let valid = nested_test_manifest_text(workdir, &kwin);
        // Missing one KWin identity field fails closed (not accepted partial).
        let missing_sha: String = valid
            .lines()
            .filter(|l| !l.starts_with("kwin_bin_sha256="))
            .map(|l| format!("{l}\n"))
            .collect();
        assert!(
            parse_nested_manifest(&missing_sha)
                .unwrap_err()
                .contains("kwin_bin_sha256")
        );
        let missing_nested_ino: String = valid
            .lines()
            .filter(|l| !l.starts_with("nested_exe_ino="))
            .map(|l| format!("{l}\n"))
            .collect();
        assert!(
            parse_nested_manifest(&missing_nested_ino)
                .unwrap_err()
                .contains("nested_exe_ino")
        );
        // Mismatched canonical pair fails closed.
        let mismatched = valid.replace(
            &format!("nested_exe_sha256={NESTED_TEST_SHA}"),
            "nested_exe_sha256=0000000000000000000000000000000000000000000000000000000000000000",
        );
        assert!(
            parse_nested_manifest(&mismatched)
                .unwrap_err()
                .contains("sha256")
        );
    }

    #[test]
    fn advisory_loss_launch_option_is_bounded_and_distinct() {
        assert_eq!(
            ADVISORY_LOSS_CORRELATION_FLAG,
            "--advisory-loss-correlation"
        );
        assert_eq!(LOSS_READY_MARKER_KIND, "planner-service-loss-ready");
        assert_eq!(LOSS_READY_MARKER_VERSION, 1);
        assert_eq!(MAX_LOSS_READY_MARKER_BYTES, 1024);
        // Same contract identity in both modes: no new method, no rename.
        assert_eq!(SERVICE, "org.plasmaautotiler.Planner");
        assert_eq!(OBJECT, "/org/plasmaautotiler/Planner");
        assert_eq!(INTERFACE, "org.plasmaautotiler.Planner1");
        assert_eq!(METHOD, "EvaluateMove");
        assert_eq!(ADVISORY_METHOD, "DescribeAdvisoryPlan");
    }

    #[test]
    fn advisory_loss_correlation_parsing_is_bounded_fail_closed() {
        assert_eq!(
            parse_advisory_loss_correlation("c-loss-1").as_deref(),
            Some("c-loss-1")
        );
        assert_eq!(
            parse_advisory_loss_correlation("UPPERCASE-1").as_deref(),
            Some("UPPERCASE-1")
        );
        assert_eq!(
            parse_advisory_loss_correlation("a.b_c-d9").as_deref(),
            Some("a.b_c-d9")
        );
        // Missing/empty/malformed/overlong fail closed with no endpoint.
        assert!(parse_advisory_loss_correlation("").is_none());
        assert!(parse_advisory_loss_correlation("bad id").is_none());
        assert!(parse_advisory_loss_correlation("bad/corr").is_none());
        assert!(parse_advisory_loss_correlation(&"x".repeat(129)).is_none());
        assert!(parse_advisory_loss_correlation(&"x".repeat(4096)).is_none());
    }

    #[test]
    fn advisory_loss_arming_requires_valid_correlation() {
        let armed = PlannerEndpoint::with_advisory_loss_correlation("c-loss-1")
            .expect("valid correlation arms");
        assert_eq!(armed.advisory_loss_correlation(), Some("c-loss-1"));
        let cloned = armed.clone();
        assert_eq!(cloned.advisory_loss_correlation(), Some("c-loss-1"));
        assert!(Arc::ptr_eq(
            &armed.advisory_session,
            &cloned.advisory_session
        ));
        assert!(PlannerEndpoint::with_advisory_loss_correlation("").is_none());
        assert!(PlannerEndpoint::with_advisory_loss_correlation("bad id").is_none());
        assert!(PlannerEndpoint::with_advisory_loss_correlation(&"x".repeat(129)).is_none());
    }

    #[test]
    fn normal_planner_service_has_no_loss_arming() {
        let endpoint = PlannerEndpoint::new();
        assert_eq!(endpoint.advisory_loss_correlation(), None);
        let reply = endpoint
            .evaluate_advisory_request(&advisory_test_request("c-normal-1", "owner-1"))
            .expect("normal route returns a reply");
        let parsed: serde_json::Value = serde_json::from_str(&reply).expect("reply is JSON");
        assert_eq!(parsed["outcome"], "planned");
        assert_eq!(parsed["correlation_id"], "c-normal-1");
    }

    #[test]
    fn loss_ready_marker_is_strict_schema_v1_and_bounded() {
        let marker =
            format_loss_ready_marker("c-1", "owner-1", "gen-1", 0).expect("valid binding formats");
        assert!(marker.len() <= MAX_LOSS_READY_MARKER_BYTES);
        assert!(!marker.contains('\n'));
        let parsed: serde_json::Value = serde_json::from_str(&marker).expect("marker is JSON");
        assert_eq!(parsed["v"], 1);
        assert_eq!(parsed["marker"], "planner-service-loss-ready");
        assert_eq!(parsed["correlation_id"], "c-1");
        assert_eq!(parsed["owner"], "owner-1");
        assert_eq!(parsed["generation"], "gen-1");
        assert_eq!(parsed["revision"], 0);
        // Exact keys only.
        let obj = parsed.as_object().expect("marker is an object");
        assert_eq!(obj.len(), 6);

        // Strict rejections: no echo path, just None.
        assert!(format_loss_ready_marker("", "owner-1", "gen-1", 0).is_none());
        assert!(format_loss_ready_marker("bad id", "owner-1", "gen-1", 0).is_none());
        assert!(format_loss_ready_marker("c-1", "", "gen-1", 0).is_none());
        assert!(format_loss_ready_marker("c-1", "bad owner", "gen-1", 0).is_none());
        assert!(format_loss_ready_marker("c-1", "owner-1", "UPPERCASE", 0).is_none());
        assert!(format_loss_ready_marker("c-1", "owner-1", "", 0).is_none());
        assert!(
            format_loss_ready_marker("c-1", "owner-1", "gen-1", ADVISORY_MAX_REVISION + 1)
                .is_none()
        );
        assert!(format_loss_ready_marker(&"x".repeat(129), "owner-1", "gen-1", 0).is_none());
        assert!(format_loss_ready_marker("c-1", &"x".repeat(129), "gen-1", 0).is_none());
        assert!(format_loss_ready_marker("c-1", "owner-1", &"x".repeat(65), 0).is_none());
    }

    #[test]
    fn loss_marker_armed_requires_exact_correlation_equality() {
        // One armed process serves success, stale, then loss: earlier
        // correlations return normally (no marker), only the exact armed
        // accepted correlation yields the marker. Pure decision keeps the
        // session out of the equality proof, so each reply is judged alone.
        let endpoint = PlannerEndpoint::with_advisory_loss_correlation("c-loss-9")
            .expect("valid armed endpoint");
        let success = endpoint
            .evaluate_advisory_request(&advisory_test_request("c-success-1", "owner-1"))
            .expect("success reply");
        let success_value: serde_json::Value =
            serde_json::from_str(&success).expect("success is JSON");
        assert_eq!(success_value["outcome"], "planned");
        // Earlier success correlation returns normally under the loss arming.
        assert!(loss_marker_for_armed_reply(&success, "c-loss-9").is_none());
        // Stale reuse of the success correlation is rejected and also
        // returns normally (no marker even under its own arming).
        let stale = endpoint
            .evaluate_advisory_request(&advisory_test_request("c-success-1", "owner-1"))
            .expect("stale still returns JSON");
        let stale_value: serde_json::Value = serde_json::from_str(&stale).expect("stale is JSON");
        assert_eq!(stale_value["outcome"], "rejected");
        assert!(loss_marker_for_armed_reply(&stale, "c-success-1").is_none());
        assert!(loss_marker_for_armed_reply(&stale, "c-loss-9").is_none());

        // The exact armed loss correlation is the sole exception to the
        // consumed-session stale-request rule. It is accepted only to emit
        // the terminal marker; the D-Bus method withholds this reply.
        let loss = endpoint
            .evaluate_advisory_request(&advisory_test_request("c-loss-9", "owner-1"))
            .expect("loss reply");
        let marker =
            loss_marker_for_armed_reply(&loss, "c-loss-9").expect("exact match yields marker");
        assert!(marker.len() <= MAX_LOSS_READY_MARKER_BYTES);
        assert!(!marker.contains('\n'));
        let parsed: serde_json::Value = serde_json::from_str(&marker).expect("marker is JSON");
        let reply: serde_json::Value = serde_json::from_str(&loss).expect("reply is JSON");
        assert_eq!(parsed["correlation_id"], "c-loss-9");
        assert_eq!(parsed["correlation_id"], reply["correlation_id"]);
        assert_eq!(parsed["owner"], reply["owner"]);
        assert_eq!(parsed["generation"], reply["generation"]);
        assert_eq!(parsed["revision"], reply["revision"]);

        // Exact equality only: prefix, suffix, case, and neighbor all miss.
        assert!(loss_marker_for_armed_reply(&loss, "c-loss-90").is_none());
        assert!(loss_marker_for_armed_reply(&loss, "c-loss").is_none());
        assert!(loss_marker_for_armed_reply(&loss, "C-LOSS-9").is_none());
        assert!(loss_marker_for_armed_reply(&loss, "c-success-1").is_none());
        assert!(loss_marker_for_armed_reply(&loss, "").is_none());
        assert!(loss_marker_for_armed_reply(&loss, "bad id").is_none());
    }

    #[test]
    fn nested_store_identities_reject_embedded_separators() {
        let good_hash = "abcd1234abcd1234abcd1234abcd1234";
        let good = format!("/nix/store/{good_hash}-kwin-6.7.4/bin/kwin_wayland");
        assert!(nested_kwin_store_exact(&good, "6.7.4"));
        let evil = format!("/nix/store/{good_hash}-kwin-6.7.4/bin/evil/bin/kwin_wayland");
        assert!(!nested_kwin_store_exact(&evil, "6.7.4"));
        let good_wrapped = format!("/nix/store/{good_hash}-kwin-6.7.4/bin/.kwin_wayland-wrapped");
        assert!(nested_kwin_wrapped_exact(&good_wrapped, "6.7.4"));
        let evil_wrapped =
            format!("/nix/store/{good_hash}-kwin-6.7.4/bin/evil/bin/.kwin_wayland-wrapped");
        assert!(!nested_kwin_wrapped_exact(&evil_wrapped, "6.7.4"));
    }

    #[test]
    fn fallback_entry_is_permission_denied_only() {
        use crate::planner_kwin_identity::owner_exe_requires_fallback;
        let denied = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "x");
        let not_found = std::io::Error::new(std::io::ErrorKind::NotFound, "x");
        let invalid = std::io::Error::new(std::io::ErrorKind::InvalidData, "x (deleted)");
        let other = std::io::Error::new(std::io::ErrorKind::Interrupted, "x");
        assert!(owner_exe_requires_fallback(&denied));
        assert!(!owner_exe_requires_fallback(&not_found));
        assert!(!owner_exe_requires_fallback(&invalid));
        assert!(!owner_exe_requires_fallback(&other));
    }

    #[test]
    fn loss_marker_rejects_malformed_marker_and_reply() {
        // Malformed marker bindings never format (no echo path, just None).
        assert!(format_loss_ready_marker("", "owner-1", "gen-1", 0).is_none());
        assert!(format_loss_ready_marker("bad id", "owner-1", "gen-1", 0).is_none());
        assert!(format_loss_ready_marker("c-1", "bad owner", "gen-1", 0).is_none());
        assert!(format_loss_ready_marker("c-1", "owner-1", "UPPERCASE", 0).is_none());
        assert!(
            format_loss_ready_marker("c-1", "owner-1", "gen-1", ADVISORY_MAX_REVISION + 1)
                .is_none()
        );
        // Malformed replies never yield a marker, armed or not.
        assert!(loss_marker_for_advisory_reply("").is_none());
        assert!(loss_marker_for_advisory_reply("not json").is_none());
        assert!(loss_marker_for_armed_reply("not json", "c-1").is_none());
        assert!(loss_marker_for_armed_reply("", "c-1").is_none());
        let rejected_json = serde_json::json!({
            "v": 1, "correlation_id": "c-1", "owner": "", "generation": "",
            "revision": 0, "outcome": "rejected", "kind": "snapshot-invalid",
            "message": "snapshot or intent is malformed"
        })
        .to_string();
        assert!(loss_marker_for_advisory_reply(&rejected_json).is_none());
        assert!(loss_marker_for_armed_reply(&rejected_json, "c-1").is_none());
        let wrong_v = serde_json::json!({
            "v": 2, "correlation_id": "c-1", "owner": "owner-1",
            "generation": "gen-1", "revision": 0, "outcome": "planned"
        })
        .to_string();
        assert!(loss_marker_for_advisory_reply(&wrong_v).is_none());
        assert!(loss_marker_for_armed_reply(&wrong_v, "c-1").is_none());
        // Missing correlation field in an otherwise planned-shaped reply.
        let missing_corr = serde_json::json!({
            "v": 1, "owner": "owner-1", "generation": "gen-1",
            "revision": 0, "outcome": "planned"
        })
        .to_string();
        assert!(loss_marker_for_advisory_reply(&missing_corr).is_none());
        assert!(loss_marker_for_armed_reply(&missing_corr, "c-1").is_none());
        // Oversized reply never yields a marker.
        let big = format!(
            "{{\"v\":1,\"correlation_id\":\"c-1\",\"owner\":\"owner-1\",\"generation\":\"gen-1\",\"revision\":0,\"outcome\":\"planned\",\"pad\":\"{}\"}}",
            "x".repeat(ADVISORY_MAX_REPLY_BYTES)
        );
        assert!(loss_marker_for_advisory_reply(&big).is_none());
        assert!(loss_marker_for_armed_reply(&big, "c-1").is_none());
    }

    fn trio_fp(focused: &str) -> u64 {
        crate::focus_service::focus_fingerprint(
            "out-1",
            "ws-1",
            focused,
            &["win-a".to_owned(), "win-b".to_owned(), "win-c".to_owned()],
        )
    }

    fn trio_resize_windows_json() -> serde_json::Value {
        serde_json::json!([
            {"window": "win-a", "output": "out-1", "workspace": "ws-1",
                "rect": {"x": 0, "y": 0, "w": 800, "h": 600}},
            {"window": "win-b", "output": "out-1", "workspace": "ws-1",
                "rect": {"x": 100, "y": 100, "w": 640, "h": 400}},
            {"window": "win-c", "output": "out-1", "workspace": "ws-1",
                "rect": {"x": 200, "y": 200, "w": 400, "h": 640}}
        ])
    }

    fn trio_plain_windows_json() -> serde_json::Value {
        serde_json::json!([
            {"window": "win-a", "output": "out-1", "workspace": "ws-1"},
            {"window": "win-b", "output": "out-1", "workspace": "ws-1"},
            {"window": "win-c", "output": "out-1", "workspace": "ws-1"}
        ])
    }

    fn trio_resize_request_json(
        correlation: &str,
        focused: &str,
        direction: &str,
        mode: &str,
        press: u32,
        revision: u64,
    ) -> String {
        serde_json::json!({
            "v": 1, "action": "request", "correlation_id": correlation,
            "owner": "owner-1", "generation": "gen-1", "revision": revision,
            "fingerprint": trio_fp(focused),
            "domain": {"output": "out-1", "workspace": "ws-1",
                "bounds": {"x": 0, "y": 0, "w": 1920, "h": 1080}, "gap": 8},
            "focused_window": focused, "direction": direction, "mode": mode,
            "press_index": press, "windows": trio_resize_windows_json(),
            "capabilities": {"keyboard_resize": true, "pointer_resize": false}
        })
        .to_string()
    }

    fn trio_pointer_request_json(
        correlation: &str,
        focused: &str,
        direction: &str,
        boundary: i32,
        revision: u64,
    ) -> String {
        serde_json::json!({
            "v": 1, "action": "request-pointer", "correlation_id": correlation,
            "owner": "owner-1", "generation": "gen-1", "revision": revision,
            "fingerprint": trio_fp(focused),
            "domain": {"output": "out-1", "workspace": "ws-1",
                "bounds": {"x": 0, "y": 0, "w": 1920, "h": 1080}, "gap": 8},
            "focused_window": focused, "direction": direction,
            "proposed_boundary": boundary, "windows": trio_resize_windows_json(),
            "capabilities": {"keyboard_resize": false, "pointer_resize": true}
        })
        .to_string()
    }

    fn trio_focus_request_json(
        correlation: &str,
        focused: &str,
        direction: &str,
        revision: u64,
    ) -> String {
        serde_json::json!({
            "v": 1, "action": "request", "correlation_id": correlation,
            "owner": "owner-1", "generation": "gen-1", "revision": revision,
            "fingerprint": trio_fp(focused),
            "domain": {"output": "out-1", "workspace": "ws-1"},
            "focused_window": focused, "direction": direction,
            "windows": trio_plain_windows_json(),
            "capabilities": {"directional_focus": true}
        })
        .to_string()
    }

    fn trio_movement_request_json(
        correlation: &str,
        focused: &str,
        direction: &str,
        revision: u64,
    ) -> String {
        serde_json::json!({
            "v": 1, "action": "request", "correlation_id": correlation,
            "owner": "owner-1", "generation": "gen-1", "revision": revision,
            "fingerprint": trio_fp(focused),
            "domain": {"output": "out-1", "workspace": "ws-1"},
            "focused_window": focused, "direction": direction,
            "windows": trio_plain_windows_json(),
            "capabilities": {
                "swap_neighbor": true, "wrap_perpendicular": true, "wrap_siblings": true,
                "insert_child": true, "split_group_child": true, "reparent_leaf": true,
                "cross_output_transfer": true
            },
            "domains": [{
                "output": "out-1", "workspace": "ws-1",
                "bounds": {"x": 0, "y": 0, "w": 1920, "h": 1080},
                "gap": 8, "adjacent": {}
            }]
        })
        .to_string()
    }

    fn trio_ack_json(correlation: &str, base: u64) -> String {
        serde_json::json!({
            "v": 1, "action": "acknowledge", "correlation_id": correlation,
            "owner": "owner-1", "generation": "gen-1",
            "base_revision": base, "outcome": "accepted"
        })
        .to_string()
    }

    fn trio_resize_verify_json(
        plan: &serde_json::Value,
        correlation: &str,
        focused: &str,
        base: u64,
    ) -> String {
        serde_json::json!({
            "v": 1, "action": "verify", "correlation_id": correlation,
            "owner": "owner-1", "generation": "gen-1", "revision": base,
            "fingerprint": trio_fp(focused), "verified": true,
            "verified_preconditions": plan["preconditions"],
            "verified_operation": plan["operation"],
            "verified_geometry": plan["desired_geometry"],
            "verified_focus": plan["desired_focus"]
        })
        .to_string()
    }

    fn trio_focus_verify_json(
        plan: &serde_json::Value,
        correlation: &str,
        to_window: &str,
        base: u64,
    ) -> String {
        serde_json::json!({
            "v": 1, "action": "verify", "correlation_id": correlation,
            "owner": "owner-1", "generation": "gen-1", "revision": base,
            "fingerprint": trio_fp(to_window), "verified": true,
            "verified_preconditions": plan["preconditions"],
            "verified_operation": plan["operation"]
        })
        .to_string()
    }

    fn trio_reply(text: &str) -> serde_json::Value {
        serde_json::from_str(text).expect("reply is JSON")
    }

    fn trio_rect_for(geometry: &serde_json::Value, window: &str) -> (i32, i32, i32, i32) {
        let entry = geometry
            .as_array()
            .expect("geometry is an array")
            .iter()
            .find(|entry| entry["window"] == window)
            .expect("window present in geometry");
        (
            entry["rect"]["x"].as_i64().expect("x") as i32,
            entry["rect"]["y"].as_i64().expect("y") as i32,
            entry["rect"]["w"].as_i64().expect("w") as i32,
            entry["rect"]["h"].as_i64().expect("h") as i32,
        )
    }

    fn trio_boundary_above_c(geometry: &serde_json::Value) -> i32 {
        let (_, y, _, h) = trio_rect_for(geometry, "win-c");
        y + h + 24
    }

    #[test]
    fn trio_shared_session_serves_all_four_routes_over_the_wire() {
        let endpoint = PlannerEndpoint::new();
        assert!(!endpoint.is_trio_established());
        assert_eq!(endpoint.trio_revision(), 0);

        // Focus carries no geometry and can never seed: rejected fail-closed
        // with no session state.
        let reply = trio_reply(
            &endpoint
                .evaluate_focus_request(&trio_focus_request_json("trio-f0", "win-c", "up", 3))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "rejected");
        assert!(!endpoint.is_trio_established());

        // A strict keyboard resize request seeds the trio and plans in one
        // flight over the shared session.
        let seed_plan = trio_reply(
            &endpoint
                .evaluate_resize_request(&trio_resize_request_json(
                    "trio-k1", "win-c", "up", "inwards", 0, 3,
                ))
                .expect("reply"),
        );
        assert_eq!(seed_plan["outcome"], "planned", "{seed_plan}");
        assert_eq!(seed_plan["base_revision"], 3);
        assert_eq!(seed_plan["capability"], "keyboard-resize");
        assert_eq!(seed_plan["operation"]["kind"], "ResizeSplitShare");
        assert!(seed_plan["operation"]["direction"] == "up");
        // Deterministic COSMIC H[A,V[B,C]] projection over the real bounds.
        let (ax, ay, aw, ah) = trio_rect_for(&seed_plan["desired_geometry"], "win-a");
        let (bx, by, bw, bh) = trio_rect_for(&seed_plan["desired_geometry"], "win-b");
        let (cx, cy, cw, ch) = trio_rect_for(&seed_plan["desired_geometry"], "win-c");
        assert!(ax < bx && ax < cx);
        assert_eq!(bx, cx);
        assert_eq!(bw, cw);
        assert!(by < cy);
        assert_eq!((ay, ah), (0, 1080));
        for (x, y, w, h) in [(ax, ay, aw, ah), (bx, by, bw, bh), (cx, cy, cw, ch)] {
            assert!(x >= 0 && y >= 0 && w > 0 && h > 0);
            assert!(x + w <= 1920 && y + h <= 1080);
        }
        assert!(endpoint.is_trio_established());
        assert_eq!(endpoint.trio_revision(), 3);

        // Acknowledge and verify commit the seed flight on the shared session.
        let reply = trio_reply(
            &endpoint
                .evaluate_resize_request(&trio_ack_json("trio-k1", 3))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "acknowledged");
        let reply = trio_reply(
            &endpoint
                .evaluate_resize_request(&trio_resize_verify_json(
                    &seed_plan, "trio-k1", "win-c", 3,
                ))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "committed");
        assert_eq!(reply["revision"], 4);
        assert_eq!(endpoint.trio_revision(), 4);

        // Focus C up pins B over the same shared session.
        let focus_plan = trio_reply(
            &endpoint
                .evaluate_focus_request(&trio_focus_request_json("trio-f1", "win-c", "up", 4))
                .expect("reply"),
        );
        assert_eq!(focus_plan["outcome"], "planned", "{focus_plan}");
        assert_eq!(focus_plan["to_window"], "win-b");
        let reply = trio_reply(
            &endpoint
                .evaluate_focus_request(&trio_ack_json("trio-f1", 4))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "acknowledged");
        let reply = trio_reply(
            &endpoint
                .evaluate_focus_request(&trio_focus_verify_json(&focus_plan, "trio-f1", "win-b", 4))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "committed");
        assert_eq!(reply["revision"], 5);
        assert_eq!(endpoint.trio_revision(), 5);

        // Movement B down swaps with C (R2a) over the same shared session.
        let move_plan = trio_reply(
            &endpoint
                .evaluate_movement_request(&trio_movement_request_json(
                    "trio-m1", "win-b", "down", 5,
                ))
                .expect("reply"),
        );
        assert_eq!(move_plan["outcome"], "planned", "{move_plan}");
        assert_eq!(move_plan["rule"], "R2a");
        assert!(move_plan.get("desired_geometry").is_some());
        assert!(move_plan.get("desired_focus").is_some());
        let reply = trio_reply(
            &endpoint
                .evaluate_movement_request(&trio_ack_json("trio-m1", 5))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "acknowledged");
        let reply = trio_reply(
            &endpoint
                .evaluate_movement_request(&trio_resize_verify_json(
                    &move_plan, "trio-m1", "win-b", 5,
                ))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "committed");
        assert_eq!(reply["revision"], 6);
        assert_eq!(endpoint.trio_revision(), 6);

        // Keyboard resize B up inwards over the same shared session.
        let resize_plan = trio_reply(
            &endpoint
                .evaluate_resize_request(&trio_resize_request_json(
                    "trio-k2", "win-b", "up", "inwards", 0, 6,
                ))
                .expect("reply"),
        );
        assert_eq!(resize_plan["outcome"], "planned", "{resize_plan}");
        let reply = trio_reply(
            &endpoint
                .evaluate_resize_request(&trio_ack_json("trio-k2", 6))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "acknowledged");
        let reply = trio_reply(
            &endpoint
                .evaluate_resize_request(&trio_resize_verify_json(
                    &resize_plan,
                    "trio-k2",
                    "win-b",
                    6,
                ))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "committed");
        assert_eq!(reply["revision"], 7);
        assert_eq!(endpoint.trio_revision(), 7);

        // Pointer resize B up over the same shared session, with the
        // deterministic exact boundary from the accepted projection.
        let boundary = trio_boundary_above_c(&resize_plan["desired_geometry"]);
        let pointer_plan = trio_reply(
            &endpoint
                .evaluate_pointer_resize_request(&trio_pointer_request_json(
                    "trio-p1", "win-b", "up", boundary, 7,
                ))
                .expect("reply"),
        );
        assert_eq!(pointer_plan["outcome"], "planned", "{pointer_plan}");
        assert_eq!(pointer_plan["capability"], "pointer-resize");
        let reply = trio_reply(
            &endpoint
                .evaluate_pointer_resize_request(&trio_ack_json("trio-p1", 7))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "acknowledged");
        let reply = trio_reply(
            &endpoint
                .evaluate_pointer_resize_request(&trio_resize_verify_json(
                    &pointer_plan,
                    "trio-p1",
                    "win-b",
                    7,
                ))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "committed");
        assert_eq!(reply["revision"], 8);
        assert_eq!(endpoint.trio_revision(), 8);

        // A pointer-owned pending plan is fenced from the keyboard route: a
        // cross-route acknowledge is rejected without mutation, and the
        // pointer cycle still acknowledges and commits afterwards.
        let boundary = trio_boundary_above_c(&pointer_plan["desired_geometry"]);
        let fenced_plan = trio_reply(
            &endpoint
                .evaluate_pointer_resize_request(&trio_pointer_request_json(
                    "trio-p2", "win-b", "up", boundary, 8,
                ))
                .expect("reply"),
        );
        assert_eq!(fenced_plan["outcome"], "planned", "{fenced_plan}");
        let reply = trio_reply(
            &endpoint
                .evaluate_resize_request(&trio_ack_json("trio-p2", 8))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "rejected");
        let reply = trio_reply(
            &endpoint
                .evaluate_pointer_resize_request(&trio_ack_json("trio-p2", 8))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "acknowledged");
        let reply = trio_reply(
            &endpoint
                .evaluate_pointer_resize_request(&trio_resize_verify_json(
                    &fenced_plan,
                    "trio-p2",
                    "win-b",
                    8,
                ))
                .expect("reply"),
        );
        assert_eq!(reply["revision"], 9);
        assert_eq!(endpoint.trio_revision(), 9);
    }

    #[test]
    fn trio_routes_share_one_pending_slot() {
        let endpoint = PlannerEndpoint::new();
        // Seed once through the keyboard resize route; the seed flight stays
        // pending on the one shared session.
        let seed_plan = trio_reply(
            &endpoint
                .evaluate_resize_request(&trio_resize_request_json(
                    "trio-share-k1",
                    "win-c",
                    "up",
                    "inwards",
                    0,
                    3,
                ))
                .expect("reply"),
        );
        assert_eq!(seed_plan["outcome"], "planned");
        assert!(endpoint.is_trio_established());
        // A movement request at the same revision reaches the shared single
        // pending slot and diverges instead of planning a second concurrent
        // flight on another session.
        let reply = trio_reply(
            &endpoint
                .evaluate_movement_request(&trio_movement_request_json(
                    "trio-share-m1",
                    "win-c",
                    "down",
                    3,
                ))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "diverged", "{reply}");
        assert_eq!(reply["kind"], "pending-exists");
        // Same for focus: one shared session, one pending slot.
        let reply = trio_reply(
            &endpoint
                .evaluate_focus_request(&trio_focus_request_json("trio-share-f1", "win-c", "up", 3))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "diverged", "{reply}");
        assert_eq!(reply["kind"], "pending-exists");
        // The original keyboard cycle still owns the slot and commits.
        let reply = trio_reply(
            &endpoint
                .evaluate_resize_request(&trio_ack_json("trio-share-k1", 3))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "acknowledged");
        let reply = trio_reply(
            &endpoint
                .evaluate_resize_request(&trio_resize_verify_json(
                    &seed_plan,
                    "trio-share-k1",
                    "win-c",
                    3,
                ))
                .expect("reply"),
        );
        assert_eq!(reply["outcome"], "committed");
        assert_eq!(reply["revision"], 4);
        assert_eq!(endpoint.trio_revision(), 4);
    }
}
