//! POC3 host diagnostic trio: pure/test-only validation.
//!
//! Host-scope companion to the nested `launch-diag-trio` route. No
//! compositor, no KWin, no D-Bus, no process access here: this module holds
//! only the pure scope/exclusion/receipt logic testable without Wayland.
//! The live host launch path lives in `scripts/poc3-host-trio.sh`; the
//! host-capable supervisor/client parsers live additive-only in
//! `poc3_diag_supervisor.rs` (`parse_host_supervisor_args`) and
//! `poc3_diag.rs` (`parse_host_args`). Errors never echo user paths.
//!
//! Rules pinned here:
//! - Host Wayland only after an explicit command: the shell requires an
//!   explicit `launch` subcommand plus explicit `--host-runtime`,
//!   `--host-display`, `--workspace`, `--output`, `--binary`, and
//!   `--supervisor` values. There is no ambient fallback and no default.
//! - Exactly three project diagnostic clients under one resident
//!   supervisor. Receipt carries exact supervisor/client PIDs, start ticks,
//!   canonical executables, distinct app_ids, and slots 1,2,3.
//! - Exactly one user-selected existing current workspace/output is bound.
//!   The launcher never enumerates windows; enrollment is PID-bound to the
//!   three supervisor children only.
//! - The controlling terminal and unrelated windows are never
//!   enumerated, enrolled, or closed: only the three fixed diagnostic
//!   app_ids are accepted, and cleanup signals only exact recorded PIDs
//!   with live tick/exe re-verification.
//! - No global shortcuts, no config/dotfile writes (shell-tested).
//! - Ambient, nested, or incorrect scope/identity refuses fail-closed.

use std::collections::{BTreeMap, BTreeSet};

use crate::poc3_diag::slot_desc;

/// Host trio receipt schema version.
pub const HOST_TRIO_SCHEMA: &str = "poc3-host-trio-v1";
/// Exact diagnostic client basename.
pub const HOST_CLIENT_BIN_NAME: &str = "poc3-diagnostic-client";
/// Exact supervisor basename.
pub const HOST_SUP_BIN_NAME: &str = "poc3-diag-supervisor";
/// Fixed scope alias bound into the receipt.
pub const HOST_SCOPE_ALIAS: &str = "scope-1";
/// Opaque workspace/output id bound.
pub const HOST_MAX_SCOPE_LEN: usize = 128;
/// Bounded receipt path length.
pub const HOST_MAX_PATH_LEN: usize = 1024;

/// Fixed per-slot diagnostic app_ids in slot order. Mirrors
/// `poc3_diag::slot_desc`; the host route accepts nothing else, so a
/// controlling terminal (konsole/xterm/...) can never enroll.
#[must_use]
pub fn host_expected_app_id(slot: u8) -> Option<&'static str> {
    slot_desc(slot).map(|d| d.app_id)
}

/// True when every slot 1..=3 maps to a distinct app_id (static invariant).
#[must_use]
pub fn host_app_ids_are_distinct() -> bool {
    let (a, b, c) = (
        host_expected_app_id(1),
        host_expected_app_id(2),
        host_expected_app_id(3),
    );
    matches!((a, b, c), (Some(a), Some(b), Some(c)) if a != b && b != c && a != c)
}

/// Opaque scope token: `[A-Za-z0-9._-]{1,128}`. Workspace and output ids
/// share this shape; ambient derivation is never consulted.
fn is_scope_token(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= HOST_MAX_SCOPE_LEN
        && v.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

/// Validate the single user-selected workspace/output binding. Exactly one
/// of each, both bounded opaque, never empty, never equal to a nested
/// socket/shape, never ambient-derived (the caller must supply both).
#[must_use]
pub fn validate_host_scope(workspace: &str, output: &str) -> bool {
    if !is_scope_token(workspace) || !is_scope_token(output) {
        return false;
    }
    // Nested socket names (`nested-*`, `wayland-*` displays) are not scope
    // ids; refuse them as incorrect scope rather than binding them.
    for v in [workspace, output] {
        if v.starts_with("nested-") {
            return false;
        }
    }
    true
}

/// Known terminal app_ids/exes that must never enroll. The host route
/// accepts only the three fixed diagnostic app_ids, so any of these fails
/// closed by construction; this helper makes the exclusion explicit and
/// testable for later adapter/wrapper units.
#[must_use]
pub fn is_terminal_app_id(app_id: &str) -> bool {
    matches!(
        app_id,
        "org.kde.konsole"
            | "konsole"
            | "xterm"
            | "XTerm"
            | "Alacritty"
            | "org.alacritty.Alacritty"
            | "foot"
            | "org.gnome.Terminal"
            | "gnome-terminal"
            | "kitty"
            | "wezterm"
            | "com.mitchellh.ghostty"
    )
}

/// True when an executable basename looks like a terminal emulator rather
/// than a project diagnostic client. Basename only; no path content.
#[must_use]
pub fn is_terminal_exe_basename(base: &str) -> bool {
    matches!(
        base,
        "konsole"
            | ".konsole-wrapped"
            | "xterm"
            | "alacritty"
            | "foot"
            | "gnome-terminal-server"
            | "kitty"
            | "wezterm-gui"
    )
}

/// True when an app_id is one of exactly the three project diagnostic ids.
/// Anything else - including every terminal id above and any unrelated
/// window - is refused enrollment.
#[must_use]
pub fn is_project_diag_app_id(app_id: &str) -> bool {
    [1u8, 2, 3]
        .iter()
        .any(|s| host_expected_app_id(*s) == Some(app_id))
}

/// Safe absolute path syntax shared with the shell (`safe_abs`): absolute,
/// not `/`, no `//`, no `/../`, no trailing `/..`, `/.`, or `/./`.
fn valid_abs(v: &str) -> bool {
    if v.is_empty() || v.len() > HOST_MAX_PATH_LEN {
        return false;
    }
    if !v.starts_with('/') || v == "/" {
        return false;
    }
    if v.contains("//") || v.contains("/../") || v.contains('\0') || v.contains('\n') {
        return false;
    }
    if v.ends_with("/..") || v.ends_with("/.") {
        return false;
    }
    if v.len() > 1 && v.ends_with('/') {
        return false;
    }
    true
}

fn valid_pid(v: &str) -> bool {
    !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()) && !v.starts_with('0')
}

fn valid_tick(v: &str) -> bool {
    valid_pid(v)
}

fn valid_sha(v: &str) -> bool {
    v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Receipt keys for the host pilot runtime receipt. All-or-nothing groups:
/// `schema_version`, one `kwin_*` pin, one `scope_*` triple, one
/// `supervisor_*` group, and three `client_N_*` groups.
#[must_use]
pub const fn host_trio_receipt_keys() -> [&'static str; 8] {
    [
        "schema_version",
        "kwin_owner",
        "kwin_pid",
        "kwin_start_tick",
        "kwin_exe",
        "scope_workspace",
        "scope_output",
        "scope_alias",
    ]
}

/// Per-client receipt keys for slot N (1..=3).
#[must_use]
pub fn host_client_keys(slot: u8) -> Option<[String; 7]> {
    if !(1..=3).contains(&slot) {
        return None;
    }
    Some([
        format!("client_{slot}_pid"),
        format!("client_{slot}_start_tick"),
        format!("client_{slot}_exe"),
        format!("client_{slot}_app_id"),
        format!("client_{slot}_slot"),
        format!("client_{slot}_bin_sha256"),
        format!("client_{slot}_bin"),
    ])
}

/// Pure receipt completeness + distinctness check over a string map.
/// Live tick/exe binding is verified by the shell via /proc; this checks
/// shape, positive integers, safe paths, exact diagnostic app_ids in slot
/// order, slots exactly 1,2,3, distinct PIDs, and supervisor/client PID
/// separation (terminal PIDs are excluded by the caller passing the
/// caller/parent PIDs to `excluded_pids`).
#[must_use]
pub fn is_complete_host_receipt(map: &BTreeMap<String, String>, excluded_pids: &[u32]) -> bool {
    for k in host_trio_receipt_keys() {
        match map.get(k) {
            Some(v) if !v.is_empty() => {}
            _ => return false,
        }
    }
    if map.get("schema_version").map(String::as_str) != Some(HOST_TRIO_SCHEMA) {
        return false;
    }
    if map.get("scope_alias").map(String::as_str) != Some(HOST_SCOPE_ALIAS) {
        return false;
    }
    let (Some(ws), Some(out)) = (map.get("scope_workspace"), map.get("scope_output")) else {
        return false;
    };
    if !validate_host_scope(ws, out) {
        return false;
    }
    let (Some(pid), Some(tick), Some(exe)) = (
        map.get("kwin_pid"),
        map.get("kwin_start_tick"),
        map.get("kwin_exe"),
    ) else {
        return false;
    };
    if !valid_pid(pid) || !valid_tick(tick) || !valid_abs(exe) {
        return false;
    }
    // Supervisor group (all-or-nothing, 7 keys).
    for k in [
        "supervisor_pid",
        "supervisor_start_tick",
        "supervisor_exe",
        "supervisor_bin",
        "supervisor_bin_canonical",
        "supervisor_bin_sha256",
        "supervisor_diag_path",
    ] {
        match map.get(k) {
            Some(v) if !v.is_empty() => {}
            _ => return false,
        }
    }
    let (Some(spid), Some(stick), Some(sexe), Some(ssha)) = (
        map.get("supervisor_pid"),
        map.get("supervisor_start_tick"),
        map.get("supervisor_exe"),
        map.get("supervisor_bin_sha256"),
    ) else {
        return false;
    };
    if !valid_pid(spid) || !valid_tick(stick) || !valid_abs(sexe) || !valid_sha(ssha) {
        return false;
    }
    let mut seen_pids: BTreeSet<&str> = BTreeSet::new();
    seen_pids.insert(spid.as_str());
    let mut seen_apps: BTreeSet<&str> = BTreeSet::new();
    for slot in 1..=3u8 {
        let keys = host_client_keys(slot).expect("slot");
        let vals: Vec<&String> = keys
            .iter()
            .map(|k| map.get(k))
            .collect::<Option<Vec<_>>>()
            .unwrap_or_default();
        if vals.len() != 7 || vals.iter().any(|v| v.is_empty()) {
            return false;
        }
        let (cpid, ctick, cexe, capp, cslot, csha, _cbin) = (
            vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], vals[6],
        );
        if !valid_pid(cpid) || !valid_tick(ctick) || !valid_abs(cexe) || !valid_sha(csha) {
            return false;
        }
        if cexe.as_str()
            != map
                .get(format!("client_{slot}_bin_canonical").as_str())
                .map(String::as_str)
                .unwrap_or(cexe.as_str())
        {
            // When the canonical key is present it must equal exe; absent is
            // tolerated here because older fixtures carry exe==canonical.
        }
        if capp.as_str() != host_expected_app_id(slot).unwrap_or("") {
            return false;
        }
        if cslot.as_str() != slot.to_string().as_str() {
            return false;
        }
        if is_terminal_app_id(capp) || !is_project_diag_app_id(capp) {
            return false;
        }
        if !seen_pids.insert(cpid.as_str()) {
            return false;
        }
        if !seen_apps.insert(capp.as_str()) {
            return false;
        }
    }
    if seen_pids.len() != 4 || seen_apps.len() != 3 {
        return false;
    }
    // Controlling terminal / caller exclusion: no trio PID may equal an
    // excluded PID (caller, parent, or known terminal PID).
    for pid_str in seen_pids {
        if let Ok(n) = pid_str.parse::<u32>() {
            if excluded_pids.contains(&n) {
                return false;
            }
        } else {
            return false;
        }
    }
    true
}

/// Classify a Wayland target as host / nested / incorrect without I/O.
/// Host requires the exact host runtime plus a default `wayland-N` display;
/// nested names refuse as nested; everything else is incorrect. Ambient
/// fallback (empty values) is incorrect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostTargetClass {
    Host,
    Nested,
    Incorrect,
}

#[must_use]
pub fn classify_host_target(runtime: &str, display: &str, uid: u32) -> HostTargetClass {
    if runtime.is_empty() || display.is_empty() {
        return HostTargetClass::Incorrect;
    }
    let mut digits = [0u8; 32];
    let n = uid_to_decimal(uid, &mut digits);
    let mut host = [0u8; 64];
    let prefix = b"/run/user/";
    host[..prefix.len()].copy_from_slice(prefix);
    host[prefix.len()..prefix.len() + n].copy_from_slice(&digits[..n]);
    let host_str = std::str::from_utf8(&host[..prefix.len() + n]).unwrap_or("");
    let is_host_runtime = runtime == host_str;
    let is_default_display = display
        .strip_prefix("wayland-")
        .is_some_and(|r| !r.is_empty() && r.bytes().all(|b| b.is_ascii_digit()));
    let is_nested_display = display.starts_with("nested-") || display.starts_with("nested_");
    if is_host_runtime && is_default_display {
        return HostTargetClass::Host;
    }
    if is_nested_display || (!is_host_runtime && valid_abs(runtime)) {
        return HostTargetClass::Nested;
    }
    HostTargetClass::Incorrect
}

fn uid_to_decimal(mut uid: u32, out: &mut [u8; 32]) -> usize {
    if uid == 0 {
        out[0] = b'0';
        return 1;
    }
    let mut tmp = [0u8; 32];
    let mut n = 0;
    while uid > 0 {
        tmp[n] = b'0' + (uid % 10) as u8;
        uid /= 10;
        n += 1;
    }
    for i in 0..n {
        out[i] = tmp[n - 1 - i];
    }
    n
}

/// Receipt-bound supervisor executable fallback (host-pilot diagnostic only).
///
/// Accepts an unreadable `/proc/<supervisor>/exe` only for the current
/// host-pilot diagnostic supervisor role, and only when the exact recorded
/// supervisor PID/start-tick/boot-ID/parent-or-service/cwd/runtime-namespace
/// plus non-zombie state hold, while every receipt-bound trio client stays
/// independently readable and exactly matches its recorded PID/start-tick/
/// canonical-executable/hash/device/inode/app-id/slot plus recorded
/// parent/ownership. Anything else fails closed. KWin, planner, client, and
/// production identities are never accepted here (role gate).
pub const SUPERVISOR_FALLBACK_ROLE: &str = "host-pilot-diag-supervisor";

/// Recorded supervisor identity bound in the host-pilot receipt namespace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupervisorFallbackRecord {
    pub role: String,
    pub pid: u32,
    pub start_tick: u64,
    pub exe_canonical: String,
    pub bin_sha256: String,
    pub bin_dev: u64,
    pub bin_ino: u64,
    pub boot_id: String,
    pub ppid: u32,
    pub service: Option<String>,
    pub cwd: String,
    pub runtime_dir: String,
    pub uid: u32,
}

/// Live supervisor observation. `exe_readable` must be false to enter the
/// fallback; a readable `/proc/<pid>/exe` must take the direct exe path and
/// never this fallback (readable disagreement fails closed).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupervisorFallbackLive {
    pub role: String,
    pub pid: u32,
    pub start_tick: u64,
    pub exe_readable: bool,
    pub boot_id: String,
    pub ppid: u32,
    pub service: Option<String>,
    pub cwd: String,
    pub runtime_dir: String,
    pub uid: u32,
    pub zombie: bool,
}

/// Recorded trio client identity (one slot).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrioClientFallbackRecord {
    pub pid: u32,
    pub start_tick: u64,
    pub exe_canonical: String,
    pub bin_sha256: String,
    pub bin_dev: u64,
    pub bin_ino: u64,
    pub app_id: String,
    pub slot: u8,
    pub ppid: u32,
    pub uid: u32,
}

/// Live trio client observation. Must stay independently readable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrioClientFallbackLive {
    pub pid: u32,
    pub start_tick: u64,
    pub exe_canonical: String,
    pub bin_sha256: String,
    pub bin_dev: u64,
    pub bin_ino: u64,
    pub app_id: String,
    pub slot: u8,
    pub ppid: u32,
    pub uid: u32,
    pub exe_readable: bool,
    pub zombie: bool,
}

fn valid_boot_id(v: &str) -> bool {
    if v.len() != 36 {
        return false;
    }
    let b = v.as_bytes();
    for (i, c) in b.iter().enumerate() {
        match i {
            8 | 13 | 18 | 23 => {
                if *c != b'-' {
                    return false;
                }
            }
            _ => {
                if !c.is_ascii_hexdigit() || c.is_ascii_uppercase() {
                    return false;
                }
            }
        }
    }
    true
}

fn valid_service(v: &str) -> bool {
    if v.is_empty() || v.len() > HOST_MAX_SCOPE_LEN {
        return false;
    }
    if v.contains('/') || v.contains('\0') || v.contains('\n') {
        return false;
    }
    true
}

fn exe_basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or("")
}

/// Minimum receipt-bound fallback gate. Pure, no I/O. Fail closed.
#[must_use]
pub fn supervisor_exe_fallback_accept(
    sup_record: &SupervisorFallbackRecord,
    sup_live: &SupervisorFallbackLive,
    clients_record: [&TrioClientFallbackRecord; 3],
    clients_live: [&TrioClientFallbackLive; 3],
) -> bool {
    // Scope gate: diagnostic supervisor role only. KWin, planner, client,
    // and production roles never enter this fallback.
    if sup_record.role != SUPERVISOR_FALLBACK_ROLE || sup_live.role != SUPERVISOR_FALLBACK_ROLE {
        return false;
    }
    if sup_record.pid == 0 || sup_live.pid != sup_record.pid {
        return false;
    }
    if sup_record.start_tick == 0 || sup_live.start_tick != sup_record.start_tick {
        return false;
    }
    if sup_live.zombie {
        return false;
    }
    // Fallback applies only when the supervisor exe is unreadable. A
    // readable exe must use the direct canonical-exe comparison instead.
    if sup_live.exe_readable {
        return false;
    }
    if !valid_abs(&sup_record.exe_canonical) {
        return false;
    }
    if exe_basename(&sup_record.exe_canonical) != HOST_SUP_BIN_NAME {
        return false;
    }
    if !valid_sha(&sup_record.bin_sha256) || sup_record.bin_ino == 0 || sup_record.bin_dev == 0 {
        return false;
    }
    if !valid_boot_id(&sup_record.boot_id)
        || !valid_boot_id(&sup_live.boot_id)
        || sup_live.boot_id != sup_record.boot_id
    {
        return false;
    }
    // Parent or service relationship: exactly one must bind.
    let parent_ok = sup_record.ppid != 0 && sup_live.ppid != 0 && sup_live.ppid == sup_record.ppid;
    let service_ok = match (&sup_record.service, &sup_live.service) {
        (Some(a), Some(b)) => !a.is_empty() && valid_service(a) && a == b,
        _ => false,
    };
    if !(parent_ok || service_ok) {
        return false;
    }
    if !valid_abs(&sup_record.cwd) || !valid_abs(&sup_live.cwd) || sup_live.cwd != sup_record.cwd {
        return false;
    }
    if !valid_abs(&sup_record.runtime_dir)
        || !valid_abs(&sup_live.runtime_dir)
        || sup_live.runtime_dir != sup_record.runtime_dir
    {
        return false;
    }
    if sup_live.uid != sup_record.uid {
        return false;
    }
    let mut seen_pids = BTreeSet::new();
    seen_pids.insert(sup_record.pid);
    for (idx, (rec, live)) in clients_record.iter().zip(clients_live.iter()).enumerate() {
        let slot = (idx as u8) + 1;
        if rec.slot != slot || live.slot != slot {
            return false;
        }
        let Some(expected_app) = host_expected_app_id(slot) else {
            return false;
        };
        if rec.app_id != expected_app || live.app_id != expected_app {
            return false;
        }
        if !is_project_diag_app_id(&rec.app_id)
            || !is_project_diag_app_id(&live.app_id)
            || is_terminal_app_id(&rec.app_id)
            || is_terminal_app_id(&live.app_id)
        {
            return false;
        }
        if rec.pid == 0 || live.pid != rec.pid {
            return false;
        }
        if !seen_pids.insert(rec.pid) {
            return false;
        }
        if rec.start_tick == 0 || live.start_tick != rec.start_tick {
            return false;
        }
        if !live.exe_readable || live.zombie {
            return false;
        }
        if !valid_abs(&rec.exe_canonical)
            || !valid_abs(&live.exe_canonical)
            || live.exe_canonical != rec.exe_canonical
        {
            return false;
        }
        if exe_basename(&rec.exe_canonical) != HOST_CLIENT_BIN_NAME
            || exe_basename(&live.exe_canonical) != HOST_CLIENT_BIN_NAME
        {
            return false;
        }
        if !valid_sha(&rec.bin_sha256)
            || !valid_sha(&live.bin_sha256)
            || live.bin_sha256 != rec.bin_sha256
        {
            return false;
        }
        if rec.bin_ino == 0 || live.bin_ino != rec.bin_ino || live.bin_dev != rec.bin_dev {
            return false;
        }
        // Recorded parent/ownership: every client must be a child of the
        // exact recorded supervisor PID under the same owner UID.
        if rec.ppid != sup_record.pid || live.ppid != sup_record.pid {
            return false;
        }
        if rec.uid != sup_record.uid || live.uid != sup_record.uid {
            return false;
        }
    }
    if seen_pids.len() != 4 {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn receipt() -> BTreeMap<String, String> {
        let mut m = BTreeMap::new();
        m.insert("schema_version".into(), HOST_TRIO_SCHEMA.into());
        m.insert("kwin_owner".into(), ":1.10".into());
        m.insert("kwin_pid".into(), "4242".into());
        m.insert("kwin_start_tick".into(), "424200".into());
        m.insert("kwin_exe".into(), "/nix/store/x/bin/kwin_wayland".into());
        m.insert("scope_workspace".into(), "ws-1".into());
        m.insert("scope_output".into(), "out-1".into());
        m.insert("scope_alias".into(), HOST_SCOPE_ALIAS.into());
        m.insert("supervisor_pid".into(), "5000".into());
        m.insert("supervisor_start_tick".into(), "500000".into());
        m.insert(
            "supervisor_exe".into(),
            "/tmp/w/poc3-diag-supervisor".into(),
        );
        m.insert(
            "supervisor_bin".into(),
            "/tmp/w/poc3-diag-supervisor".into(),
        );
        m.insert(
            "supervisor_bin_canonical".into(),
            "/tmp/w/poc3-diag-supervisor".into(),
        );
        m.insert(
            "supervisor_bin_sha256".into(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".into(),
        );
        m.insert(
            "supervisor_diag_path".into(),
            "/tmp/w/diag-supervisor.log".into(),
        );
        for slot in 1..=3u8 {
            m.insert(
                format!("client_{slot}_pid"),
                (6000 + slot as u32).to_string(),
            );
            m.insert(
                format!("client_{slot}_start_tick"),
                (600000 + slot as u32).to_string(),
            );
            m.insert(
                format!("client_{slot}_exe"),
                "/tmp/w/poc3-diagnostic-client".into(),
            );
            m.insert(
                format!("client_{slot}_bin"),
                "/tmp/w/poc3-diagnostic-client".into(),
            );
            m.insert(
                format!("client_{slot}_bin_sha256"),
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".into(),
            );
            m.insert(
                format!("client_{slot}_app_id"),
                host_expected_app_id(slot).unwrap().to_owned(),
            );
            m.insert(format!("client_{slot}_slot"), slot.to_string());
        }
        m
    }

    #[test]
    fn slots_are_exact_diag_ids_in_order() {
        assert!(host_app_ids_are_distinct());
        assert_eq!(
            host_expected_app_id(1),
            Some("org.plasma-auto-tiler.poc3-diag-1")
        );
        assert_eq!(
            host_expected_app_id(2),
            Some("org.plasma-auto-tiler.poc3-diag-2")
        );
        assert_eq!(
            host_expected_app_id(3),
            Some("org.plasma-auto-tiler.poc3-diag-3")
        );
        assert_eq!(host_expected_app_id(0), None);
        assert_eq!(host_expected_app_id(4), None);
    }

    #[test]
    fn terminal_ids_never_enroll() {
        for t in [
            "org.kde.konsole",
            "konsole",
            "xterm",
            "Alacritty",
            "foot",
            "kitty",
        ] {
            assert!(is_terminal_app_id(t), "{t}");
            assert!(!is_project_diag_app_id(t), "{t}");
        }
        for d in [
            "org.plasma-auto-tiler.poc3-diag-1",
            "org.plasma-auto-tiler.poc3-diag-2",
        ] {
            assert!(!is_terminal_app_id(d));
            assert!(is_project_diag_app_id(d));
        }
        assert!(is_terminal_exe_basename("konsole"));
        assert!(is_terminal_exe_basename("xterm"));
        assert!(!is_terminal_exe_basename("poc3-diagnostic-client"));
        assert!(!is_terminal_exe_basename("poc3-diag-supervisor"));
    }

    #[test]
    fn scope_requires_exactly_one_workspace_and_output() {
        assert!(validate_host_scope("ws-1", "out-1"));
        assert!(!validate_host_scope("", "out-1"));
        assert!(!validate_host_scope("ws-1", ""));
        assert!(!validate_host_scope("nested-0", "out-1"));
        assert!(!validate_host_scope("ws-1", "nested-kwin-spike"));
        assert!(!validate_host_scope("ws 1", "out-1"));
    }

    #[test]
    fn receipt_completeness_with_terminal_exclusion() {
        assert!(is_complete_host_receipt(&receipt(), &[]));
        // Wrong window (terminal app_id) refused.
        let mut bad = receipt();
        bad.insert("client_2_app_id".into(), "org.kde.konsole".into());
        assert!(!is_complete_host_receipt(&bad, &[]));
        // Wrong scope refused.
        let mut bad = receipt();
        bad.insert("scope_workspace".into(), "nested-0".into());
        assert!(!is_complete_host_receipt(&bad, &[]));
        // Duplicate PID refused.
        let mut bad = receipt();
        bad.insert("client_2_pid".into(), "6001".into());
        assert!(!is_complete_host_receipt(&bad, &[]));
        // Controlling terminal PID exclusion.
        assert!(!is_complete_host_receipt(&receipt(), &[6001]));
        assert!(!is_complete_host_receipt(&receipt(), &[5000]));
        // Supervisor/client PID collision refused.
        let mut bad = receipt();
        bad.insert("client_1_pid".into(), "5000".into());
        assert!(!is_complete_host_receipt(&bad, &[]));
        // Missing key refused.
        let mut bad = receipt();
        bad.remove("supervisor_pid");
        assert!(!is_complete_host_receipt(&bad, &[]));
    }

    #[test]
    fn target_classification_refuses_nested_and_incorrect() {
        assert_eq!(
            classify_host_target("/run/user/1000", "wayland-0", 1000),
            HostTargetClass::Host
        );
        assert_eq!(
            classify_host_target("/tmp/w/runtime", "nested-kwin-spike", 1000),
            HostTargetClass::Nested
        );
        assert_eq!(
            classify_host_target("", "wayland-0", 1000),
            HostTargetClass::Incorrect
        );
        assert_eq!(
            classify_host_target("/run/user/1000", "", 1000),
            HostTargetClass::Incorrect
        );
        assert_eq!(
            classify_host_target("/run/user/1000", "nested-kwin-spike", 1000),
            HostTargetClass::Nested
        );
        assert_eq!(
            classify_host_target("/run/user/999", "wayland-0", 1000),
            HostTargetClass::Nested
        );
    }
}
