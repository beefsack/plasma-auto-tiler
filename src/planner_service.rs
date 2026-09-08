//! POC2 planner service boundary: stateless manually invoked D-Bus service.
//!
//! Contract identity: service `org.plasmaautotiler.Planner`, object
//! `/org/plasmaautotiler/Planner`, interface `org.plasmaautotiler.Planner1`,
//! methods `EvaluateMove` (frozen JSON string request -> JSON string reply)
//! and `DescribeAdvisoryPlan` (read-only v1 advisory request -> advisory
//! plan reply with exactly three normalized opaque windows, delegated through
//! the portable `cosmic_v1` core; no native command/execution fields and no
//! mutation). The POC-shaped `EvaluatePoc3` route is removed.
//!
//! Boundary rules: no Rust-to-KWin calls (only `org.freedesktop.DBus`
//! owner/credential queries for caller verification), no persistence, no tray
//! coupling, no autostart, no native mutation. Bounded single-flight endpoint
//! handling via a non-queuing async-lock try-acquire held across verify and
//! evaluate. Name acquisition uses `DoNotQueue`; name loss is terminal.
//! Approved KWin binaries are read size-bounded before allocation and the
//! stable snapshot is cached fail-closed (restart to pick up upgrades).

use std::fs::File;
use std::io::Read;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use zbus::blocking::{Connection, MessageIterator};
use zbus::fdo::{RequestNameFlags, RequestNameReply};
use zbus::message::Type;
use zbus::{MatchRule, fdo::NameOwnerChanged};

use crate::advisory_contract::{
    ADVISORY_MAX_REPLY_BYTES, ADVISORY_MAX_REVISION, AdvisorySession,
    evaluate_advisory_json_for_armed_loss,
};
use crate::planner_contract::{MAX_REPLY_BYTES, evaluate_json};
// Linux-only identity boundary; portable core never depends on it.
#[cfg(target_os = "linux")]
use crate::planner_kwin_identity as kwin_identity;
use crate::tray_lifecycle::{ProcProcessControl, ProcessControl, ProcessIdentity};

pub const SERVICE: &str = "org.plasmaautotiler.Planner";
pub const OBJECT: &str = "/org/plasmaautotiler/Planner";
pub const INTERFACE: &str = "org.plasmaautotiler.Planner1";
pub const METHOD: &str = "EvaluateMove";
pub const ADVISORY_METHOD: &str = "DescribeAdvisoryPlan";
pub const KWIN_SERVICE: &str = "org.kde.KWin";

const APPROVED_KWIN_ENTRYPOINTS: &[&str] = &[
    "/run/current-system/sw/bin/kwin_wayland",
    "/run/current-system/sw/bin/kwin_wayland_wrapper",
    "/run/current-system/sw/bin/kwin_x11",
    "/usr/bin/kwin_wayland",
    "/usr/bin/kwin_wayland_wrapper",
    "/usr/bin/kwin_x11",
];

/// Size bound checked before any content allocation for approved binaries.
const MAX_APPROVED_BINARY_BYTES: u64 = 16 * 1024 * 1024;

/// Exact nested-KWin manifest binding. Compatible with the launcher manifest
/// validated by `scripts/nested-kwin-manifest.sh` (schema v2): the planner
/// only trusts the launcher-recorded nested PID + canonical executable +
/// SHA-256 + device/inode + start tick snapshot taken from an explicit
/// operator-supplied manifest file, and revalidates the live caller via D-Bus
/// credentials + independent `/proc` identity on every call. No
/// caller-supplied path/PID material is accepted and the host allowlist below
/// is never consulted or broadened by this mode. Partial identity fields are
/// rejected; v1 manifests are rejected as schema mismatch.
const NESTED_MANIFEST_SCHEMA: &str = "nested-kwin-manifest-v2";
const NESTED_KWIN_EXPECTED_VERSION: &str = "6.7.4";
const MAX_NESTED_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_NESTED_MANIFEST_LINES: usize = 128;
const MAX_NESTED_VALUE_BYTES: usize = 4096;

static APPROVED_KWIN_CACHE: OnceLock<Vec<ApprovedKwinIdentity>> = OnceLock::new();

#[derive(Debug, zbus::DBusError, PartialEq, Eq)]
#[zbus(prefix = "org.plasmaautotiler.Planner1")]
pub enum PlannerError {
    Unauthorized,
    Unavailable(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ApprovedKwinIdentity {
    canonical_path: PathBuf,
    executable: crate::tray_lifecycle::ProcessExecutableIdentity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CallerIdentity {
    process_id: u32,
    process: ProcessIdentity,
    approved: ApprovedKwinIdentity,
}

#[derive(Clone, Debug)]
pub struct PlannerEndpoint {
    operation_lock: Arc<async_lock::Mutex<()>>,
    // Read-only advisory session tracker held in process memory only. Shared
    // across endpoint clones so the single manually started service owns
    // exactly one pinned owner/generation/revision binding. The pinned
    // revision never advances; advisory evaluation performs no mutation.
    advisory_session: Arc<std::sync::Mutex<AdvisorySession>>,
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
            advisory_loss_correlation: Some(armed),
        })
    }

    /// Borrow the armed loss correlation, if any. `None` is normal mode.
    #[must_use]
    pub fn advisory_loss_correlation(&self) -> Option<&str> {
        self.advisory_loss_correlation.as_deref()
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
}

impl Default for PlannerEndpoint {
    fn default() -> Self {
        Self::new()
    }
}

fn valid_caller_identity(identity: &CallerIdentity) -> bool {
    identity.process_id != 0
        && identity.process.start_tick != 0
        && matches_approved_identity(&identity.process, &identity.approved)
        && !identity.process.executable.content.is_empty()
}

fn matches_approved_identity(process: &ProcessIdentity, approved: &ApprovedKwinIdentity) -> bool {
    process.resolved_executable_path == approved.canonical_path
        && process.executable == approved.executable
}

fn read_approved_identity(canonical_path: PathBuf) -> Option<ApprovedKwinIdentity> {
    let file = File::open(&canonical_path).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() || metadata.mode() & 0o111 == 0 {
        return None;
    }
    let len = metadata.len();
    if len == 0 || len > MAX_APPROVED_BINARY_BYTES {
        return None;
    }
    let mut content = Vec::new();
    file.take(MAX_APPROVED_BINARY_BYTES + 1)
        .read_to_end(&mut content)
        .ok()?;
    if content.is_empty() || content.len() as u64 > MAX_APPROVED_BINARY_BYTES {
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
}

fn resolve_approved_kwin_identities_uncached() -> Vec<ApprovedKwinIdentity> {
    APPROVED_KWIN_ENTRYPOINTS
        .iter()
        .filter_map(|entrypoint| {
            let canonical_path = std::fs::canonicalize(entrypoint).ok()?;
            read_approved_identity(canonical_path)
        })
        .collect()
}

/// Cached stable approved identities. Fail-closed: a KWin upgrade that
/// changes the on-disk binary no longer matches the cache, so callers are
/// rejected until the service restarts and re-snapshots.
fn approved_kwin_identities() -> Vec<ApprovedKwinIdentity> {
    APPROVED_KWIN_CACHE
        .get_or_init(resolve_approved_kwin_identities_uncached)
        .clone()
}

fn resolve_approved_kwin_identities() -> Vec<ApprovedKwinIdentity> {
    approved_kwin_identities()
}

fn authorized_caller(
    kwin_owner: Option<&str>,
    caller: Option<&str>,
    identity: &CallerIdentity,
) -> bool {
    match (kwin_owner, caller) {
        (Some(owner), Some(caller)) => {
            owner == caller
                && zbus::names::UniqueName::try_from(owner).is_ok()
                && valid_caller_identity(identity)
        }
        _ => false,
    }
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

fn nested_exe_sha256_hex(content: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(content);
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push(char::from_digit((byte >> 4) as u32, 16).unwrap_or('0'));
        out.push(char::from_digit((byte & 0x0f) as u32, 16).unwrap_or('0'));
    }
    out
}

fn nested_live_sha_matches(manifest_sha: &str, content: &[u8]) -> bool {
    !content.is_empty() && nested_exe_sha256_hex(content).eq_ignore_ascii_case(manifest_sha)
}

/// Live `/proc` identity must exactly match the launcher-recorded snapshot:
/// canonical path plus SHA-256 plus device/inode plus start tick. Any PID
/// reuse (start-tick mismatch), canonical/exe mismatch, deleted suffix, hash
/// or device/inode mismatch, or empty executable content fails closed.
fn nested_live_identity_matches(manifest: &NestedManifest, live: &ProcessIdentity) -> bool {
    let live_path = live.resolved_executable_path.to_string_lossy();
    if nested_exe_deleted(&live_path) {
        return false;
    }
    live.start_tick != 0
        && live.start_tick == manifest.nested_starttick
        && live.resolved_executable_path == manifest.nested_exe_canonical
        && live.resolved_executable_path == manifest.kwin_bin_canonical
        && live.executable.dev == manifest.nested_exe_dev
        && live.executable.ino == manifest.nested_exe_ino
        && live.executable.dev == manifest.kwin_bin_dev
        && live.executable.ino == manifest.kwin_bin_ino
        && !live.executable.content.is_empty()
        && nested_live_sha_matches(&manifest.nested_exe_sha256, &live.executable.content)
        && nested_live_sha_matches(&manifest.kwin_bin_sha256, &live.executable.content)
}

/// Pure nested caller binding. The only trusted PID/exe/tick material is the
/// explicit manifest snapshot plus the independently re-read live `/proc`
/// identity; `caller_pid` must come from D-Bus credentials, never from a
/// caller-supplied message body. The host allowlist is intentionally not
/// consulted here.
fn authorized_nested_caller(
    kwin_owner: Option<&str>,
    caller: Option<&str>,
    caller_pid: u32,
    manifest: &NestedManifest,
    live: &ProcessIdentity,
) -> bool {
    match (kwin_owner, caller) {
        (Some(owner), Some(caller)) => {
            owner == caller
                && zbus::names::UniqueName::try_from(owner).is_ok()
                && caller_pid != 0
                && caller_pid == manifest.nested_pid
                && nested_live_identity_matches(manifest, live)
        }
        _ => false,
    }
}

async fn verify_nested_caller(
    connection: &zbus::Connection,
    caller: &str,
    manifest: &NestedManifest,
    proc_root: &Path,
) -> Option<ProcessIdentity> {
    let unique_name = zbus::names::UniqueName::try_from(caller).ok()?;
    let dbus = zbus::fdo::DBusProxy::new(connection).await.ok()?;
    let owner = dbus
        .get_name_owner(KWIN_SERVICE.try_into().expect("valid KWin service name"))
        .await
        .ok()?;
    if owner.as_str() != caller {
        return None;
    }
    let credentials = dbus
        .get_connection_credentials(unique_name.into())
        .await
        .ok()?;
    if credentials.unix_user_id() != Some(rustix::process::geteuid().as_raw()) {
        return None;
    }
    // Credential PID only: never accept caller-supplied path/PID material.
    let caller_pid = credentials.process_id()?;
    if caller_pid != manifest.nested_pid {
        return None;
    }
    let process = ProcProcessControl {
        proc_root: proc_root.to_path_buf(),
    };
    // Independent `/proc` revalidation of executable identity + start tick.
    let live = process.identity(caller_pid).ok().flatten()?;
    if !authorized_nested_caller(
        Some(owner.as_str()),
        Some(caller),
        caller_pid,
        manifest,
        &live,
    ) {
        return None;
    }
    let current_owner = dbus
        .get_name_owner(KWIN_SERVICE.try_into().expect("valid KWin service name"))
        .await
        .ok()?;
    if current_owner.as_str() != caller {
        return None;
    }
    Some(live)
}

async fn verify_planner_caller(
    connection: &zbus::Connection,
    caller: &str,
) -> Option<CallerIdentity> {
    let unique_name = zbus::names::UniqueName::try_from(caller).ok()?;
    let dbus = zbus::fdo::DBusProxy::new(connection).await.ok()?;
    let owner = dbus
        .get_name_owner(KWIN_SERVICE.try_into().expect("valid KWin service name"))
        .await
        .ok()?;
    if owner.as_str() != caller {
        return None;
    }
    let credentials = dbus
        .get_connection_credentials(unique_name.into())
        .await
        .ok()?;
    if credentials.unix_user_id() != Some(rustix::process::geteuid().as_raw()) {
        return None;
    }
    let process_id = credentials.process_id()?;
    let owner_uid = credentials.unix_user_id()?;
    let proc_root = Path::new("/proc").to_path_buf();
    let process = ProcProcessControl {
        proc_root: proc_root.clone(),
    };
    let process_identity = match process.identity(process_id) {
        Ok(Some(identity)) => identity,
        // Absent owner: no fallback. Deleted/malformed exe: no fallback.
        Ok(None) => return None,
        // Unreadable `/proc/<owner pid>/exe` only: approved Linux
        // direct-parent fallback. Any other I/O error fails closed with no
        // fallback. Non-Linux builds have no fallback and fail closed.
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            #[cfg(target_os = "linux")]
            {
                return verify_direct_parent_fallback(
                    &dbus,
                    owner.as_str(),
                    caller,
                    process_id,
                    owner_uid,
                )
                .await;
            }
            #[cfg(not(target_os = "linux"))]
            {
                let _ = (&dbus, owner.as_str(), caller, process_id, owner_uid, error);
                return None;
            }
        }
        Err(_) => return None,
    };
    // Primary boot binding: the exact live boot ID must be observable and
    // well-formed alongside the readable exe pin. Non-Linux fails closed.
    #[cfg(target_os = "linux")]
    if kwin_identity::read_boot_id(Path::new("/proc")).is_err() {
        return None;
    }
    #[cfg(not(target_os = "linux"))]
    return None;
    let approved = resolve_approved_kwin_identities()
        .into_iter()
        .find(|approved| matches_approved_identity(&process_identity, approved))?;
    let identity = CallerIdentity {
        process_id,
        process: process_identity,
        approved,
    };
    if !authorized_caller(Some(owner.as_str()), Some(caller), &identity) {
        return None;
    }
    let current_owner = dbus
        .get_name_owner(KWIN_SERVICE.try_into().expect("valid KWin service name"))
        .await
        .ok()?;
    if current_owner.as_str() != caller {
        return None;
    }
    Some(identity)
}

/// Approved Linux/KWin direct-parent fallback (Linux only). Entered only when
/// `/proc/<owner pid>/exe` is unreadable with permission-denied; every other
/// owner exe state (readable, missing, deleted, malformed) never reaches
/// here and fails closed in the primary path. Requires the exact current
/// unique owner, same UID, exact owner PID/tick/boot with pre/post
/// revalidation, owner PPid exactly equal to the user
/// `plasma-kwin_wayland.service` MainPID (one direct level only), exact unit
/// identity, approved root-owned immutable Nix-store `ExecStart` wrapper
/// identity with the full raw `ExecStart` bound pre/post, and exact MainPID
/// tick. A readable MainPID exe must agree with the wrapped pin; an
/// unreadable MainPID exe skips only that pin. End revalidation re-reads
/// current D-Bus owner credentials PID/UID, owner exe still
/// `PermissionDenied`, the full systemd unit including MainPID and complete
/// `ExecStart`, owner tick plus parent, main tick, boot, wrapper pair, and
/// main exe state.
#[cfg(target_os = "linux")]
async fn verify_direct_parent_fallback(
    dbus: &zbus::fdo::DBusProxy<'_>,
    owner: &str,
    caller: &str,
    owner_pid: u32,
    owner_uid: u32,
) -> Option<CallerIdentity> {
    use crate::planner_kwin_identity::{
        DirectParentInput, ExeState, KWIN_ACTIVE_STATE, KWIN_BUS_NAME, KWIN_SUB_STATE, KWIN_UNIT,
        KWIN_UNIT_TYPE, approve_wrapper_pair, classify_io_error, is_approved_wrapper_execstart,
        is_safe_abs, is_unique_owner, parse_execstart_value, read_boot_id, read_proc_ppid,
        read_proc_tick, read_systemd_unit,
    };

    fn classify_main_exe(
        result: std::io::Result<Option<ProcessIdentity>>,
        pair: &crate::planner_kwin_identity::WrapperPair,
    ) -> ExeState {
        match result {
            Ok(Some(live)) => {
                if live.resolved_executable_path == pair.wrapped_canon
                    && live.executable.dev == pair.wrapped_dev
                    && live.executable.ino == pair.wrapped_ino
                    && live.executable.content == pair.wrapped_content
                    && !live.executable.content.is_empty()
                {
                    ExeState::Matches
                } else {
                    ExeState::Mismatch
                }
            }
            Ok(None) => ExeState::Missing,
            Err(error) => classify_io_error(&error),
        }
    }

    if !is_unique_owner(owner) || !is_unique_owner(caller) || owner != caller {
        return None;
    }
    if owner_pid == 0 || owner_uid != rustix::process::geteuid().as_raw() {
        return None;
    }
    let proc_root = Path::new("/proc").to_path_buf();
    let owner_tick = read_proc_tick(owner_pid, &proc_root).ok()?;
    if owner_tick == 0 {
        return None;
    }
    let owner_ppid = read_proc_ppid(owner_pid, &proc_root).ok()?;
    let boot = read_boot_id(&proc_root).ok()?;
    let unit = read_systemd_unit().ok()?;
    if unit.unit != KWIN_UNIT
        || unit.active != KWIN_ACTIVE_STATE
        || unit.sub != KWIN_SUB_STATE
        || unit.unit_type != KWIN_UNIT_TYPE
        || unit.bus_name != KWIN_BUS_NAME
    {
        return None;
    }
    if !is_safe_abs(&unit.fragment) {
        return None;
    }
    if !unit.source.is_empty() && !is_safe_abs(&unit.source) {
        return None;
    }
    if owner_ppid != unit.main_pid || owner_pid == unit.main_pid {
        return None;
    }
    let exec_path = parse_execstart_value(&unit.execstart_raw)?;
    if !is_approved_wrapper_execstart(&exec_path) {
        return None;
    }
    let pair = approve_wrapper_pair(&exec_path)?;
    let main_tick = read_proc_tick(unit.main_pid, &proc_root).ok()?;
    if main_tick == 0 {
        return None;
    }
    let process = ProcProcessControl {
        proc_root: proc_root.clone(),
    };
    let main_exe = classify_main_exe(process.identity(unit.main_pid), &pair);
    let expected_uid = rustix::process::geteuid().as_raw();
    let pre = DirectParentInput {
        owner,
        caller,
        owner_pid,
        owner_pid_end: owner_pid,
        owner_uid,
        owner_uid_end: owner_uid,
        expected_uid,
        owner_tick,
        owner_tick_end: owner_tick,
        owner_ppid,
        owner_ppid_end: owner_ppid,
        main_pid: unit.main_pid,
        main_pid_end: unit.main_pid,
        main_tick,
        main_tick_end: main_tick,
        boot_id: &boot,
        boot_id_end: &boot,
        unit: &unit.unit,
        unit_end: &unit.unit,
        active: &unit.active,
        active_end: &unit.active,
        sub: &unit.sub,
        sub_end: &unit.sub,
        unit_type: &unit.unit_type,
        unit_type_end: &unit.unit_type,
        bus_name: &unit.bus_name,
        bus_name_end: &unit.bus_name,
        execstart_raw: &unit.execstart_raw,
        execstart_raw_end: &unit.execstart_raw,
        execstart_path: &exec_path,
        execstart_path_end: &exec_path,
        owner_exe: ExeState::Unreadable,
        owner_exe_end: ExeState::Unreadable,
        main_exe,
        main_exe_end: main_exe,
    };
    if !crate::planner_kwin_identity::accept_direct_parent(&pre) {
        return None;
    }
    // Comprehensive end revalidation. Every live binding is re-read and must
    // be stable: current D-Bus owner credentials PID/UID, owner exe still
    // `PermissionDenied` (readable/missing/deleted/malformed all reject),
    // full systemd unit including MainPID and complete raw `ExecStart`
    // unchanged, owner tick plus parent, main tick, boot, wrapper pair, and
    // main exe state.
    let current_owner = dbus
        .get_name_owner(KWIN_SERVICE.try_into().expect("valid KWin service name"))
        .await
        .ok()?;
    if current_owner.as_str() != caller || current_owner.as_str() != owner {
        return None;
    }
    let unique_name = zbus::names::UniqueName::try_from(caller).ok()?;
    let credentials = dbus
        .get_connection_credentials(unique_name.into())
        .await
        .ok()?;
    let owner_pid_end = credentials.process_id()?;
    let owner_uid_end = credentials.unix_user_id()?;
    if owner_pid_end != owner_pid || owner_uid_end != owner_uid {
        return None;
    }
    // Owner exe must still be unreadable with permission-denied. Any other
    // outcome (readable identity, absent, or any other error kind) rejects
    // with no fallback.
    match process.identity(owner_pid) {
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {}
        _ => return None,
    }
    let owner_tick_end = read_proc_tick(owner_pid, &proc_root).ok()?;
    let owner_ppid_end = read_proc_ppid(owner_pid, &proc_root).ok()?;
    let unit_end = read_systemd_unit().ok()?;
    if unit_end.unit != unit.unit
        || unit_end.active != unit.active
        || unit_end.sub != unit.sub
        || unit_end.main_pid != unit.main_pid
        || unit_end.unit_type != unit.unit_type
        || unit_end.bus_name != unit.bus_name
        || unit_end.execstart_raw != unit.execstart_raw
        || unit_end.fragment != unit.fragment
        || unit_end.source != unit.source
    {
        return None;
    }
    let exec_path_end = parse_execstart_value(&unit_end.execstart_raw)?;
    if exec_path_end != exec_path {
        return None;
    }
    let main_tick_end = read_proc_tick(unit.main_pid, &proc_root).ok()?;
    let boot_end = read_boot_id(&proc_root).ok()?;
    if owner_tick_end != owner_tick
        || owner_ppid_end != owner_ppid
        || main_tick_end != main_tick
        || boot_end != boot
    {
        return None;
    }
    let pair_end = approve_wrapper_pair(&exec_path)?;
    if pair_end != pair {
        return None;
    }
    // Re-approve from the re-read raw path as well so a swapped raw that
    // parses identically cannot bypass the pair pin.
    let pair_from_reread = approve_wrapper_pair(&exec_path_end)?;
    if pair_from_reread != pair {
        return None;
    }
    let main_exe_end = classify_main_exe(process.identity(unit.main_pid), &pair);
    if main_exe_end != main_exe {
        return None;
    }
    let post = DirectParentInput {
        owner,
        caller,
        owner_pid,
        owner_pid_end,
        owner_uid,
        owner_uid_end,
        expected_uid,
        owner_tick,
        owner_tick_end,
        owner_ppid,
        owner_ppid_end,
        main_pid: unit.main_pid,
        main_pid_end: unit_end.main_pid,
        main_tick,
        main_tick_end,
        boot_id: &boot,
        boot_id_end: &boot_end,
        unit: &unit.unit,
        unit_end: &unit_end.unit,
        active: &unit.active,
        active_end: &unit_end.active,
        sub: &unit.sub,
        sub_end: &unit_end.sub,
        unit_type: &unit.unit_type,
        unit_type_end: &unit_end.unit_type,
        bus_name: &unit.bus_name,
        bus_name_end: &unit_end.bus_name,
        execstart_raw: &unit.execstart_raw,
        execstart_raw_end: &unit_end.execstart_raw,
        execstart_path: &exec_path,
        execstart_path_end: &exec_path_end,
        owner_exe: ExeState::Unreadable,
        owner_exe_end: ExeState::Unreadable,
        main_exe,
        main_exe_end,
    };
    if !crate::planner_kwin_identity::accept_direct_parent(&post) {
        return None;
    }
    // Synthetic attestation bound to the approved wrapped pin. The owner exe
    // itself was unreadable; trust comes from the direct-parent/unit/wrapper
    // pins above, and this identity passes the unchanged `authorized_caller`
    // gate exactly like a primary match.
    let approved = ApprovedKwinIdentity {
        canonical_path: pair.wrapped_canon.clone(),
        executable: crate::tray_lifecycle::ProcessExecutableIdentity {
            dev: pair.wrapped_dev,
            ino: pair.wrapped_ino,
            content: pair.wrapped_content.clone(),
        },
    };
    let identity = CallerIdentity {
        process_id: owner_pid,
        process: ProcessIdentity {
            start_tick: owner_tick,
            resolved_executable_path: pair.wrapped_canon,
            executable: approved.executable.clone(),
        },
        approved,
    };
    if !authorized_caller(Some(owner), Some(caller), &identity) {
        return None;
    }
    Some(identity)
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
        // credential/proc/filesystem verify and the pure evaluate, so
        // unauthorized callers cannot cause unbounded concurrent checks.
        let Some(_guard) = self.operation_lock.try_lock() else {
            return Err(PlannerError::Unavailable("planner is busy".to_owned()));
        };
        if emitter.connection().is_closed() {
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        let caller = header.sender().map(ToString::to_string);
        let Some(caller) = caller.as_deref() else {
            return Err(PlannerError::Unauthorized);
        };
        let Some(_identity) = verify_planner_caller(emitter.connection(), caller).await else {
            return Err(PlannerError::Unauthorized);
        };
        let reply = evaluate_json(&request);
        if reply.len() > MAX_REPLY_BYTES {
            return Err(PlannerError::Unavailable(
                "reply exceeds size bound".to_owned(),
            ));
        }
        Ok(reply)
    }

    async fn describe_advisory_plan(
        &self,
        request: String,
        #[zbus(header)] header: zbus::message::Header<'_>,
        #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
    ) -> Result<String, PlannerError> {
        // Read-only advisory route replacing the POC-shaped EvaluatePoc3: the
        // exact same bounded single-flight, current-KWin-owner/same-uid/
        // executable pinning with pre/post owner revalidation, request/reply
        // bounds, and terminal service-loss semantics as EvaluateMove. The
        // existing EvaluateMove contract is frozen. The reply is a
        // deterministic advisory plan with no native command/execution fields
        // and no mutation.
        let Some(_guard) = self.operation_lock.try_lock() else {
            return Err(PlannerError::Unavailable("planner is busy".to_owned()));
        };
        if emitter.connection().is_closed() {
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        let caller = header.sender().map(ToString::to_string);
        let Some(caller) = caller.as_deref() else {
            return Err(PlannerError::Unauthorized);
        };
        let Some(_identity) = verify_planner_caller(emitter.connection(), caller).await else {
            return Err(PlannerError::Unauthorized);
        };
        let reply = self.evaluate_advisory_request(&request)?;
        if reply.len() > ADVISORY_MAX_REPLY_BYTES {
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
        // normally with no marker and no hang.
        if let Some(armed) = self.advisory_loss_correlation.as_deref()
            && let Some(marker) = loss_marker_for_armed_reply(&reply, armed)
        {
            eprintln!("{marker}");
            std::future::pending::<()>().await;
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
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
/// endpoint, but caller verification is bound to the explicit validated
/// nested manifest snapshot (launcher-recorded PID + executable + start
/// tick) with independent `/proc` revalidation on every call. The host
/// allowlist is never consulted here.
#[derive(Clone, Debug)]
struct NestedPlannerEndpoint {
    inner: PlannerEndpoint,
    manifest: NestedManifest,
    proc_root: PathBuf,
}

impl NestedPlannerEndpoint {
    fn new(manifest: NestedManifest) -> Self {
        Self {
            inner: PlannerEndpoint::new(),
            manifest,
            proc_root: Path::new("/proc").to_path_buf(),
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
        let Some(_guard) = self.inner.operation_lock.try_lock() else {
            return Err(PlannerError::Unavailable("planner is busy".to_owned()));
        };
        if emitter.connection().is_closed() {
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        let caller = header.sender().map(ToString::to_string);
        let Some(caller) = caller.as_deref() else {
            return Err(PlannerError::Unauthorized);
        };
        let Some(_identity) = verify_nested_caller(
            emitter.connection(),
            caller,
            &self.manifest,
            &self.proc_root,
        )
        .await
        else {
            return Err(PlannerError::Unauthorized);
        };
        let reply = evaluate_json(&request);
        if reply.len() > MAX_REPLY_BYTES {
            return Err(PlannerError::Unavailable(
                "reply exceeds size bound".to_owned(),
            ));
        }
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
    let endpoint = NestedPlannerEndpoint::new(manifest);
    connection.object_server().at(OBJECT, endpoint)?;
    request_planner_name(&connection)?;
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
    fn caller_binding_requires_current_unique_kwin_owner() {
        let approved = ApprovedKwinIdentity {
            canonical_path: PathBuf::from("/nix/store/host-kwin/bin/kwin_wayland"),
            executable: crate::tray_lifecycle::ProcessExecutableIdentity {
                dev: 1,
                ino: 1,
                content: b"host-kwin".to_vec(),
            },
        };
        let identity = CallerIdentity {
            process_id: 1,
            process: ProcessIdentity {
                start_tick: 1,
                resolved_executable_path: approved.canonical_path.clone(),
                executable: approved.executable.clone(),
            },
            approved,
        };
        assert!(authorized_caller(Some(":1.1"), Some(":1.1"), &identity));
        assert!(!authorized_caller(Some(":1.1"), Some(":1.2"), &identity));
        assert!(!authorized_caller(None, Some(":1.1"), &identity));
        assert!(!authorized_caller(
            Some("not-a-unique-name"),
            Some("not-a-unique-name"),
            &identity
        ));
        let mut bad = identity.clone();
        bad.process.executable.content.clear();
        assert!(!authorized_caller(Some(":1.1"), Some(":1.1"), &bad));
    }

    #[test]
    fn endpoint_is_single_flight_shared() {
        let endpoint = PlannerEndpoint::new();
        let cloned = endpoint.clone();
        assert!(Arc::ptr_eq(
            &endpoint.operation_lock,
            &cloned.operation_lock
        ));
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
    fn approved_binary_read_is_size_bounded_before_allocation() {
        assert_eq!(MAX_APPROVED_BINARY_BYTES, 16 * 1024 * 1024);
        let dir = std::env::temp_dir();
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = dir.join(format!(
            "planner-approved-test-{}-{stamp}",
            std::process::id()
        ));
        {
            use std::io::Write;
            use std::os::unix::fs::PermissionsExt;
            let mut file = File::create(&path).unwrap();
            file.write_all(b"fake-kwin").unwrap();
            file.set_permissions(std::fs::Permissions::from_mode(0o755))
                .unwrap();
        }
        let identity = read_approved_identity(path.clone()).expect("bounded binary reads");
        assert_eq!(identity.canonical_path, path);
        assert_eq!(identity.executable.content, b"fake-kwin");
        std::fs::remove_file(&path).ok();

        let empty_path = dir.join(format!(
            "planner-approved-empty-{}-{stamp}",
            std::process::id()
        ));
        {
            use std::os::unix::fs::PermissionsExt;
            let file = File::create(&empty_path).unwrap();
            file.set_permissions(std::fs::Permissions::from_mode(0o755))
                .unwrap();
        }
        assert!(read_approved_identity(empty_path.clone()).is_none());
        std::fs::remove_file(&empty_path).ok();

        let huge_path = dir.join(format!(
            "planner-approved-huge-{}-{stamp}",
            std::process::id()
        ));
        {
            use std::os::unix::fs::PermissionsExt;
            let file = File::create(&huge_path).unwrap();
            file.set_permissions(std::fs::Permissions::from_mode(0o755))
                .unwrap();
            file.set_len(MAX_APPROVED_BINARY_BYTES + 1).unwrap();
        }
        assert!(
            read_approved_identity(huge_path.clone()).is_none(),
            "oversized binary must be rejected by size bound before allocation"
        );
        std::fs::remove_file(&huge_path).ok();
    }

    #[test]
    fn approved_cache_reuses_stable_snapshot() {
        let first = approved_kwin_identities();
        let second = approved_kwin_identities();
        assert_eq!(first, second);
        let uncached = resolve_approved_kwin_identities_uncached();
        assert!(uncached.len() <= APPROVED_KWIN_ENTRYPOINTS.len());
        assert_eq!(resolve_approved_kwin_identities(), first);
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

    fn nested_test_manifest(workdir: &str) -> NestedManifest {
        let kwin = format!("{workdir}/kwin-6.7.4/bin/kwin_wayland");
        parse_nested_manifest(&nested_test_manifest_text(workdir, &kwin)).unwrap()
    }

    fn nested_test_live(manifest: &NestedManifest) -> ProcessIdentity {
        ProcessIdentity {
            start_tick: manifest.nested_starttick,
            resolved_executable_path: manifest.nested_exe_canonical.clone(),
            executable: crate::tray_lifecycle::ProcessExecutableIdentity {
                dev: manifest.nested_exe_dev,
                ino: manifest.nested_exe_ino,
                content: b"nested-kwin".to_vec(),
            },
        }
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
    fn nested_caller_binding_requires_exact_pid_and_start_tick() {
        let manifest = nested_test_manifest("/tmp/nested-test-workdir");
        let live = nested_test_live(&manifest);
        assert!(authorized_nested_caller(
            Some(":1.10"),
            Some(":1.10"),
            manifest.nested_pid,
            &manifest,
            &live
        ));
        // Owner mismatch.
        assert!(!authorized_nested_caller(
            Some(":1.10"),
            Some(":1.11"),
            manifest.nested_pid,
            &manifest,
            &live
        ));
        // Non-unique owner.
        assert!(!authorized_nested_caller(
            Some("not-a-unique-name"),
            Some("not-a-unique-name"),
            manifest.nested_pid,
            &manifest,
            &live
        ));
        // Credential PID must equal the launcher-recorded PID; caller bodies
        // carry no trusted PID material (no such parameter exists).
        assert!(!authorized_nested_caller(
            Some(":1.10"),
            Some(":1.10"),
            manifest.nested_pid + 1,
            &manifest,
            &live
        ));
        // PID reuse: live start tick differs from the manifest snapshot.
        let mut reused = live.clone();
        reused.start_tick = manifest.nested_starttick + 1;
        assert!(!nested_live_identity_matches(&manifest, &reused));
        assert!(!authorized_nested_caller(
            Some(":1.10"),
            Some(":1.10"),
            manifest.nested_pid,
            &manifest,
            &reused
        ));
        // Zero tick fails closed.
        let mut zero = live.clone();
        zero.start_tick = 0;
        assert!(!nested_live_identity_matches(&manifest, &zero));
    }

    #[test]
    fn nested_manifest_rejects_executable_mismatch() {
        let manifest = nested_test_manifest("/tmp/nested-test-workdir");
        let live = nested_test_live(&manifest);
        let mut evil = live.clone();
        evil.resolved_executable_path = PathBuf::from("/tmp/evil-kwin");
        assert!(!nested_live_identity_matches(&manifest, &evil));
        assert!(!authorized_nested_caller(
            Some(":1.10"),
            Some(":1.10"),
            manifest.nested_pid,
            &manifest,
            &evil
        ));
        // Empty executable content fails closed.
        let mut empty = live.clone();
        empty.executable.content.clear();
        assert!(!nested_live_identity_matches(&manifest, &empty));
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
        // Live hash/device/inode mismatch fails closed.
        let mut bad_hash = live.clone();
        bad_hash.executable.content = b"tampered".to_vec();
        assert!(!nested_live_identity_matches(&manifest, &bad_hash));
        let mut bad_dev = live.clone();
        bad_dev.executable.dev += 1;
        assert!(!nested_live_identity_matches(&manifest, &bad_dev));
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
    fn nested_manifest_rejects_host_bus_reuse_and_preserves_host_allowlist() {
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
        // Host allowlist is not broadened: the nested test binary is not an
        // approved host entrypoint and the host verifier rejects it.
        assert!(!APPROVED_KWIN_ENTRYPOINTS.iter().any(|entry| kwin == *entry));
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
        let manifest = nested_test_manifest(workdir);
        let live = nested_test_live(&manifest);
        let host_identity = CallerIdentity {
            process_id: manifest.nested_pid,
            process: live,
            approved: ApprovedKwinIdentity {
                canonical_path: PathBuf::from("/nix/store/host-kwin/bin/kwin_wayland"),
                executable: crate::tray_lifecycle::ProcessExecutableIdentity {
                    dev: 1,
                    ino: 1,
                    content: b"host-kwin".to_vec(),
                },
            },
        };
        // The nested binary does not match the host-approved snapshot, so the
        // production host path stays unauthorized for it.
        assert!(
            !matches_approved_identity(&host_identity.process, &host_identity.approved)
                || host_identity.process.resolved_executable_path
                    != host_identity.approved.canonical_path
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
    fn nested_live_rejects_deleted_exe_suffix() {
        let manifest = nested_test_manifest("/tmp/nested-test-workdir");
        let mut live = nested_test_live(&manifest);
        live.resolved_executable_path =
            PathBuf::from("/tmp/nested-test-workdir/kwin-6.7.4/bin/kwin_wayland (deleted)");
        assert!(!nested_live_identity_matches(&manifest, &live));
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
}
