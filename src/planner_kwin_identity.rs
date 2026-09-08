//! Linux-only KWin direct-parent authentication fallback for the planner.
//!
//! Primary authentication stays in [`crate::planner_service`]: exact current
//! D-Bus `org.kde.KWin` unique owner, same UID, credential PID plus `/proc`
//! start tick and an approved on-disk executable snapshot. This module only
//! adds the approved fallback used when `/proc/<owner pid>/exe` is unreadable
//! with permission-denied and nothing else.
//!
//! Fallback acceptance requires all of: unique owner still equals the caller,
//! same UID, owner PID/tick exact across revalidation, boot ID exact across
//! revalidation, owner PPid exactly equals the user `plasma-kwin_wayland`
//! service MainPID (one direct-parent level only, never a deeper descendant
//! and never the owner equal to MainPID), exact unit identity
//! (`plasma-kwin_wayland.service`, active/running, `Type=dbus`,
//! `BusName=org.kde.KWinWrapper`), an approved immutable Nix-store
//! `ExecStart` wrapper identity (`.../bin/kwin_wayland_wrapper` plus its same
//! package `.../bin/.kwin_wayland_wrapper-wrapped` sibling), and MainPID
//! tick exact. A readable owner exe never enters this fallback; any readable
//! exe disagreement fails closed. Missing, deleted, malformed, or any
//! owner/uid/tick/boot/parent/unit/ExecStart/wrapper mismatch fails closed.
//!
//! All Linux/systemd/`/proc`/executable identity I/O lives here and in the
//! planner service boundary. Nothing is added to `advisory_trio`,
//! `advisory_contract`, `cosmic_v1`, `directional`, `geometry`, `reconcile`,
//! or `trace`.

use std::fs::File;
use std::io::{self, Read};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

/// Exact user KWin unit identity.
pub const KWIN_UNIT: &str = "plasma-kwin_wayland.service";
/// Expected KWin wrapper bus name.
pub const KWIN_BUS_NAME: &str = "org.kde.KWinWrapper";
/// Expected unit type.
pub const KWIN_UNIT_TYPE: &str = "dbus";
pub const KWIN_ACTIVE_STATE: &str = "active";
pub const KWIN_SUB_STATE: &str = "running";
/// Explicit trusted systemctl location for the Nix current system. Never
/// resolve `systemctl` via `PATH`; fail closed when this file is unavailable.
pub const TRUSTED_SYSTEMCTL_PATH: &str = "/run/current-system/sw/bin/systemctl";

const WRAPPER_BASENAME: &str = "kwin_wayland_wrapper";
const WRAPPED_BASENAME: &str = ".kwin_wayland_wrapper-wrapped";
const MAX_SYSTEMD_SHOW_BYTES: u64 = 64 * 1024;
const MAX_PROC_STAT_BYTES: u64 = 64 * 1024;
const MAX_BOOT_ID_BYTES: u64 = 256;
const MAX_APPROVED_WRAPPER_BYTES: u64 = 16 * 1024 * 1024;

/// `/proc/<pid>/exe` observability for the pure fallback decision.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExeState {
    /// Read failed with permission-denied only.
    Unreadable,
    /// Readable and exactly equals the approved wrapped pin.
    Matches,
    /// Readable but disagrees with the approved wrapped pin.
    Mismatch,
    /// Process is absent.
    Missing,
    /// Executable was deleted/replaced.
    Deleted,
    /// Any other malformed/unreadable-ambiguous state.
    Malformed,
}

/// Pure direct-parent fallback input. Every `*_end` field carries the
/// post-check revalidation read and must equal the pre-check value. The full
/// raw `ExecStart` is bound pre/post (not just the parsed path) so valid
/// observed wrapper args are preserved while any drift fails closed.
pub struct DirectParentInput<'a> {
    pub owner: &'a str,
    pub caller: &'a str,
    pub owner_pid: u32,
    pub owner_pid_end: u32,
    pub owner_uid: u32,
    pub owner_uid_end: u32,
    pub expected_uid: u32,
    pub owner_tick: u64,
    pub owner_tick_end: u64,
    pub owner_ppid: u32,
    pub owner_ppid_end: u32,
    pub main_pid: u32,
    pub main_pid_end: u32,
    pub main_tick: u64,
    pub main_tick_end: u64,
    pub boot_id: &'a str,
    pub boot_id_end: &'a str,
    pub unit: &'a str,
    pub unit_end: &'a str,
    pub active: &'a str,
    pub active_end: &'a str,
    pub sub: &'a str,
    pub sub_end: &'a str,
    pub unit_type: &'a str,
    pub unit_type_end: &'a str,
    pub bus_name: &'a str,
    pub bus_name_end: &'a str,
    pub execstart_raw: &'a str,
    pub execstart_raw_end: &'a str,
    pub execstart_path: &'a str,
    pub execstart_path_end: &'a str,
    pub owner_exe: ExeState,
    pub owner_exe_end: ExeState,
    pub main_exe: ExeState,
    pub main_exe_end: ExeState,
}

/// D-Bus unique owner shape `:N.M` only.
#[must_use]
pub fn is_unique_owner(value: &str) -> bool {
    if !value.starts_with(':') || value.contains(['\n', '\r', '\0', ' ']) {
        return false;
    }
    let Some(rest) = value.strip_prefix(':') else {
        return false;
    };
    let Some((left, right)) = rest.split_once('.') else {
        return false;
    };
    if left.is_empty() || right.is_empty() {
        return false;
    }
    if right.contains('.') {
        return false;
    }
    left.bytes().all(|b| b.is_ascii_digit()) && right.bytes().all(|b| b.is_ascii_digit())
}

/// Strict lowercase UUID boot ID, single line, no fallback path.
#[must_use]
pub fn valid_boot_id(value: &str) -> bool {
    if value.len() != 36 {
        return false;
    }
    let bytes = value.as_bytes();
    for (i, c) in bytes.iter().enumerate() {
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

/// Shell-compatible absolute safe path: starts with `/`, is not `/`, has no
/// `//`, no `/../`, no trailing `/..`, no `/./`, no trailing `/.`.
#[must_use]
pub fn is_safe_abs(path: &str) -> bool {
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
    !path.contains(['\n', '\r', '\0'])
}

fn nix_hash_ok(hash: &str) -> bool {
    hash.len() == 32
        && hash
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

/// Exact Nix-store wrapper launcher shape:
/// `/nix/store/<32-lower-alnum>-<name>/bin/kwin_wayland_wrapper` with exactly
/// one store component (embedded separators rejected).
#[must_use]
pub fn is_wrapper_launcher(path: &str) -> bool {
    if !is_safe_abs(path) || path.contains(" (deleted)") {
        return false;
    }
    const PREFIX: &str = "/nix/store/";
    const SUFFIX: &str = "/bin/kwin_wayland_wrapper";
    let Some(without) = path.strip_prefix(PREFIX) else {
        return false;
    };
    let Some(base) = without.strip_suffix(SUFFIX) else {
        return false;
    };
    if base.contains('/') || base.contains('\0') {
        return false;
    }
    let Some((hash, _)) = base.split_once('-') else {
        return false;
    };
    if !nix_hash_ok(hash) {
        return false;
    }
    if base.len() <= 33 {
        return false;
    }
    true
}

/// Exact Nix-store wrapped sibling shape:
/// `/nix/store/<32-lower-alnum>-<name>/bin/.kwin_wayland_wrapper-wrapped`
/// with exactly one store component (embedded separators rejected).
#[must_use]
pub fn is_wrapped_sibling(path: &str) -> bool {
    if !is_safe_abs(path) || path.contains(" (deleted)") {
        return false;
    }
    const PREFIX: &str = "/nix/store/";
    const SUFFIX: &str = "/bin/.kwin_wayland_wrapper-wrapped";
    let Some(without) = path.strip_prefix(PREFIX) else {
        return false;
    };
    let Some(base) = without.strip_suffix(SUFFIX) else {
        return false;
    };
    if base.contains('/') || base.contains('\0') {
        return false;
    }
    let Some((hash, _)) = base.split_once('-') else {
        return false;
    };
    if !nix_hash_ok(hash) {
        return false;
    }
    if base.len() <= 33 {
        return false;
    }
    true
}

/// Derive the expected wrapped sibling for an exact store launcher.
#[must_use]
pub fn expected_wrapped_sibling(launcher: &str) -> Option<String> {
    let stripped = launcher.strip_suffix("/bin/kwin_wayland_wrapper")?;
    Some(format!("{stripped}/bin/{WRAPPED_BASENAME}"))
}

/// Approved immutable `ExecStart` wrapper identity: the launcher itself has
/// the exact store wrapper shape and derives a same-package wrapped sibling
/// with the exact wrapped shape.
#[must_use]
pub fn is_approved_wrapper_execstart(path: &str) -> bool {
    if !is_wrapper_launcher(path) {
        return false;
    }
    let Some(expected) = expected_wrapped_sibling(path) else {
        return false;
    };
    if !is_wrapped_sibling(&expected) {
        return false;
    }
    // Same package root by construction: both derive from one launcher.
    debug_assert_eq!(
        path.rsplit_once(&format!("/bin/{WRAPPER_BASENAME}"))
            .map(|(root, _)| root),
        expected
            .rsplit_once(&format!("/bin/{WRAPPED_BASENAME}"))
            .map(|(root, _)| root),
    );
    true
}

/// Safe `ExecStart=` value parser. Takes the raw value after `ExecStart=`
/// from `systemctl show` output and prints the single `path=` target.
/// Rejects injection, ambiguity, multiple commands, and malformed values.
#[must_use]
pub fn parse_execstart_value(raw: &str) -> Option<String> {
    if raw.is_empty() || raw.contains(['\n', '\r', '\0']) {
        return None;
    }
    if raw.contains(['\\', '"', '\'', '`', '$', '&', '|', '<', '>']) {
        return None;
    }
    if raw.chars().filter(|c| *c == '{').count() != 1
        || raw.chars().filter(|c| *c == '}').count() != 1
    {
        return None;
    }
    if !raw.starts_with("{ ") || !raw.ends_with(" }") {
        return None;
    }
    if raw.matches("path=").count() != 1 {
        return None;
    }
    // `{<spaces>path=<token><spaces>;...}` like the shell regex.
    let inner = raw.strip_prefix('{')?.strip_suffix('}')?;
    let inner = inner.trim_start();
    let after = inner.strip_prefix("path=")?;
    let end = after.find([' ', ';', '\t'])?;
    let path = &after[..end];
    if path.is_empty() {
        return None;
    }
    let rest = &after[end..];
    let rest = rest.trim_start_matches([' ', '\t']);
    if !rest.starts_with(';') {
        return None;
    }
    if !is_safe_abs(path) {
        return None;
    }
    Some(path.to_owned())
}

/// Parsed user KWin unit identity from `systemctl --user show`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SystemdUnit {
    pub unit: String,
    pub active: String,
    pub sub: String,
    pub main_pid: u32,
    pub unit_type: String,
    pub bus_name: String,
    pub execstart_raw: String,
    pub fragment: String,
    pub source: String,
}

/// Strict `systemctl show` parser: exactly the nine expected properties, no
/// duplicates, no unexpected keys, no carriage returns. `SourcePath` may be
/// empty but its key must be present.
#[must_use]
pub fn parse_systemd_show(text: &str) -> Option<SystemdUnit> {
    if text.is_empty() || text.contains('\r') || text.contains('\0') {
        return None;
    }
    let mut unit: Option<String> = None;
    let mut active: Option<String> = None;
    let mut sub: Option<String> = None;
    let mut main_pid: Option<String> = None;
    let mut unit_type: Option<String> = None;
    let mut bus_name: Option<String> = None;
    let mut execstart_raw: Option<String> = None;
    let mut fragment: Option<String> = None;
    let mut source: Option<String> = None;
    let mut seen: Vec<&str> = Vec::new();
    for line in text.split('\n') {
        if line.is_empty() {
            continue;
        }
        let (name, value) = line.split_once('=')?;
        if value.contains('\n') {
            return None;
        }
        match name {
            "Id" | "ActiveState" | "SubState" | "MainPID" | "Type" | "BusName" | "ExecStart"
            | "FragmentPath" | "SourcePath" => {}
            _ => return None,
        }
        if seen.contains(&name) {
            return None;
        }
        seen.push(name);
        match name {
            "Id" => unit = Some(value.to_owned()),
            "ActiveState" => active = Some(value.to_owned()),
            "SubState" => sub = Some(value.to_owned()),
            "MainPID" => main_pid = Some(value.to_owned()),
            "Type" => unit_type = Some(value.to_owned()),
            "BusName" => bus_name = Some(value.to_owned()),
            "ExecStart" => execstart_raw = Some(value.to_owned()),
            "FragmentPath" => fragment = Some(value.to_owned()),
            "SourcePath" => source = Some(value.to_owned()),
            _ => return None,
        }
    }
    let unit = unit.filter(|v| !v.is_empty())?;
    let active = active.filter(|v| !v.is_empty())?;
    let sub = sub.filter(|v| !v.is_empty())?;
    let main_pid_raw = main_pid.filter(|v| !v.is_empty())?;
    let unit_type = unit_type.filter(|v| !v.is_empty())?;
    let bus_name = bus_name.filter(|v| !v.is_empty())?;
    let execstart_raw = execstart_raw.filter(|v| !v.is_empty())?;
    let fragment = fragment.filter(|v| !v.is_empty())?;
    if !seen.contains(&"SourcePath") {
        return None;
    }
    let source = source.unwrap_or_default();
    if source.contains(['\n', '\r', '\0']) {
        return None;
    }
    let main_pid: u32 = main_pid_raw.parse().ok()?;
    if main_pid == 0 {
        return None;
    }
    Some(SystemdUnit {
        unit,
        active,
        sub,
        main_pid,
        unit_type,
        bus_name,
        execstart_raw,
        fragment,
        source,
    })
}

/// Typed `io::Error` classification without error-string matching.
/// `PermissionDenied` is the only unreadable state that may enter the
/// fallback; `NotFound` is absent; everything else is malformed (deleted,
/// replaced, and ambiguous states all fail closed identically).
#[must_use]
pub fn classify_io_error(error: &io::Error) -> ExeState {
    match error.kind() {
        io::ErrorKind::PermissionDenied => ExeState::Unreadable,
        io::ErrorKind::NotFound => ExeState::Missing,
        _ => ExeState::Malformed,
    }
}

/// Only a `PermissionDenied` owner-exe error may enter the direct-parent
/// fallback. Every other state (readable, missing, deleted, malformed) never
/// enters and fails closed in the primary path.
#[must_use]
pub fn owner_exe_requires_fallback(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::PermissionDenied
}

/// Pure direct-parent fallback decision. Fail closed on every mismatch,
/// including any post-revalidation drift in credentials, unit identity,
/// MainPID, full raw ExecStart, ticks, boot, wrapper binding, or exe states.
#[must_use]
pub fn accept_direct_parent(input: &DirectParentInput<'_>) -> bool {
    if !is_unique_owner(input.owner) || !is_unique_owner(input.caller) {
        return false;
    }
    if input.owner != input.caller {
        return false;
    }
    if input.owner_pid == 0 || input.owner_pid_end != input.owner_pid {
        return false;
    }
    if input.main_pid == 0 || input.main_pid_end != input.main_pid {
        return false;
    }
    // Direct-parent mode only: the owner sits exactly one level below the
    // unit MainPID, never equal to it and never a deeper descendant.
    if input.owner_pid == input.main_pid {
        return false;
    }
    if input.owner_uid != input.expected_uid || input.owner_uid_end != input.owner_uid {
        return false;
    }
    if input.owner_uid_end != input.expected_uid {
        return false;
    }
    if input.owner_tick == 0 || input.owner_tick_end != input.owner_tick {
        return false;
    }
    if input.main_tick == 0 || input.main_tick_end != input.main_tick {
        return false;
    }
    if input.owner_ppid == 0
        || input.owner_ppid != input.main_pid
        || input.owner_ppid_end != input.owner_ppid
    {
        return false;
    }
    if !valid_boot_id(input.boot_id)
        || !valid_boot_id(input.boot_id_end)
        || input.boot_id_end != input.boot_id
    {
        return false;
    }
    if input.unit != KWIN_UNIT || input.unit_end != input.unit {
        return false;
    }
    if input.active != KWIN_ACTIVE_STATE
        || input.active_end != input.active
        || input.sub != KWIN_SUB_STATE
        || input.sub_end != input.sub
    {
        return false;
    }
    if input.unit_type != KWIN_UNIT_TYPE
        || input.unit_type_end != input.unit_type
        || input.bus_name != KWIN_BUS_NAME
        || input.bus_name_end != input.bus_name
    {
        return false;
    }
    // Full raw ExecStart binding pre/post: the raw value must be stable and
    // each side must parse to its claimed path, so valid observed wrapper
    // args are preserved while any arg drift fails closed.
    if input.execstart_raw.is_empty() || input.execstart_raw_end != input.execstart_raw {
        return false;
    }
    if input.execstart_path_end != input.execstart_path {
        return false;
    }
    if parse_execstart_value(input.execstart_raw).as_deref() != Some(input.execstart_path) {
        return false;
    }
    if parse_execstart_value(input.execstart_raw_end).as_deref() != Some(input.execstart_path_end) {
        return false;
    }
    if !is_approved_wrapper_execstart(input.execstart_path) {
        return false;
    }
    if !is_approved_wrapper_execstart(input.execstart_path_end) {
        return false;
    }
    // Fallback is entered only when the owner exe is unreadable with
    // permission-denied pre and still unreadable post. Any readable,
    // missing, deleted, or malformed owner exe state fails closed here.
    if input.owner_exe != ExeState::Unreadable || input.owner_exe_end != ExeState::Unreadable {
        return false;
    }
    // A readable MainPID exe must agree with the wrapped pin and stay
    // stable. An unreadable MainPID exe is allowed to skip that pin only when
    // stable; any disagreement, absence, deletion, malformation, or drift
    // fails closed.
    if !matches!(input.main_exe, ExeState::Unreadable | ExeState::Matches) {
        return false;
    }
    if input.main_exe_end != input.main_exe {
        return false;
    }
    true
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn read_small_text(path: &Path, max_bytes: u64) -> io::Result<String> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.is_symlink() || !metadata.is_file() {
        return Err(invalid("process identity path is not a regular file"));
    }
    if metadata.len() > max_bytes {
        return Err(invalid("process identity value exceeds bound"));
    }
    let file = File::open(path)?;
    let mut content = Vec::new();
    file.take(max_bytes + 1).read_to_end(&mut content)?;
    if content.is_empty() || content.len() as u64 > max_bytes {
        return Err(invalid("process identity value exceeds bound"));
    }
    String::from_utf8(content).map_err(|_| invalid("process identity value is not UTF-8"))
}

/// Paren-safe `/proc/<pid>/stat` start tick (field 22). Splits after the last
/// `") "`, validates the leading PID, the single-letter state (zombies
/// refused), and the non-zero tick.
pub fn read_proc_tick(pid: u32, proc_root: &Path) -> io::Result<u64> {
    if pid == 0 {
        return Err(invalid("PID is zero"));
    }
    let text = read_small_text(
        &proc_root.join(pid.to_string()).join("stat"),
        MAX_PROC_STAT_BYTES,
    )?;
    if text.contains('\n') || text.contains('\r') || text.contains('\0') {
        return Err(invalid("process stat is malformed"));
    }
    let pid_prefix = format!("{pid} ");
    if !text.starts_with(&pid_prefix) {
        return Err(invalid("process stat PID prefix mismatch"));
    }
    let open = text
        .find('(')
        .ok_or_else(|| invalid("process stat is malformed"))?;
    let close = text
        .rfind(')')
        .ok_or_else(|| invalid("process stat is malformed"))?;
    if close <= open {
        return Err(invalid("process stat is malformed"));
    }
    let rest = text[close + 1..].trim_start();
    if !rest.starts_with(' ') && rest.is_empty() {
        return Err(invalid("process stat is malformed"));
    }
    // Shell splits after `") "`; require that exact separator.
    if !text[close + 1..].starts_with(' ') {
        return Err(invalid("process stat is malformed"));
    }
    let fields: Vec<&str> = rest.split_whitespace().collect();
    let state = fields
        .first()
        .ok_or_else(|| invalid("process stat is truncated"))?;
    if state.len() != 1 || !state.bytes().all(|b| b.is_ascii_alphabetic()) {
        return Err(invalid("invalid process state"));
    }
    if *state == "Z" {
        return Err(invalid("process is a zombie"));
    }
    let tick: u64 = fields
        .get(19)
        .ok_or_else(|| invalid("process stat is truncated"))?
        .parse()
        .map_err(|_| invalid("invalid process start tick"))?;
    if tick == 0 {
        return Err(invalid("invalid process start tick"));
    }
    Ok(tick)
}

/// Paren-safe `/proc/<pid>/stat` direct parent PID (field 4). Same zombie and
/// shape gates as the tick reader.
pub fn read_proc_ppid(pid: u32, proc_root: &Path) -> io::Result<u32> {
    if pid == 0 {
        return Err(invalid("PID is zero"));
    }
    let text = read_small_text(
        &proc_root.join(pid.to_string()).join("stat"),
        MAX_PROC_STAT_BYTES,
    )?;
    if text.contains('\n') || text.contains('\r') || text.contains('\0') {
        return Err(invalid("process stat is malformed"));
    }
    let pid_prefix = format!("{pid} ");
    if !text.starts_with(&pid_prefix) {
        return Err(invalid("process stat PID prefix mismatch"));
    }
    let open = text
        .find('(')
        .ok_or_else(|| invalid("process stat is malformed"))?;
    let close = text
        .rfind(')')
        .ok_or_else(|| invalid("process stat is malformed"))?;
    if close <= open {
        return Err(invalid("process stat is malformed"));
    }
    if !text[close + 1..].starts_with(' ') {
        return Err(invalid("process stat is malformed"));
    }
    let rest = text[close + 1..].trim_start();
    let fields: Vec<&str> = rest.split_whitespace().collect();
    if fields.len() < 2 {
        return Err(invalid("process stat is truncated"));
    }
    if fields[0].len() != 1 || !fields[0].bytes().all(|b| b.is_ascii_alphabetic()) {
        return Err(invalid("invalid process state"));
    }
    if fields[0] == "Z" {
        return Err(invalid("process is a zombie"));
    }
    let ppid: u32 = fields[1]
        .parse()
        .map_err(|_| invalid("invalid process parent PID"))?;
    if ppid == 0 {
        return Err(invalid("invalid process parent PID"));
    }
    Ok(ppid)
}

/// Kernel boot ID: strict lowercase UUID, regular file, never a symlink.
pub fn read_boot_id(proc_root: &Path) -> io::Result<String> {
    let path = proc_root.join("sys/kernel/random/boot_id");
    let metadata = std::fs::symlink_metadata(&path)?;
    if metadata.is_symlink() || !metadata.is_file() {
        return Err(invalid("boot ID is not a regular file"));
    }
    if metadata.len() > MAX_BOOT_ID_BYTES {
        return Err(invalid("boot ID exceeds bound"));
    }
    let file = File::open(&path)?;
    let mut content = Vec::new();
    file.take(MAX_BOOT_ID_BYTES + 1).read_to_end(&mut content)?;
    let mut text = String::from_utf8(content).map_err(|_| invalid("boot ID is not UTF-8"))?;
    while text.ends_with('\n') || text.ends_with('\r') {
        text.pop();
    }
    if text.contains(['\n', '\r', '\0']) || !valid_boot_id(&text) {
        return Err(invalid("boot ID is malformed"));
    }
    Ok(text)
}

/// Trusted systemctl path check: exactly the Nix current-system location.
/// Any bare `systemctl` (PATH lookup) or alternate absolute path fails closed.
#[must_use]
pub fn is_trusted_systemctl_path(path: &Path) -> bool {
    path == Path::new(TRUSTED_SYSTEMCTL_PATH)
}

/// Query the exact user KWin unit via one bounded trusted `systemctl --user
/// show`. Never consults `PATH`; fails closed when the trusted location is
/// unavailable.
pub fn read_systemd_unit() -> io::Result<SystemdUnit> {
    read_systemd_unit_from(Path::new(TRUSTED_SYSTEMCTL_PATH))
}

/// Testable unit reader over an explicit binary path. Production passes the
/// trusted path; any non-trusted (including bare `systemctl` via `PATH`)
/// fails closed without executing.
pub fn read_systemd_unit_from(systemctl_bin: &Path) -> io::Result<SystemdUnit> {
    if !systemctl_bin.is_absolute() || !is_trusted_systemctl_path(systemctl_bin) {
        return Err(invalid("systemctl tool is not the trusted location"));
    }
    let output = std::process::Command::new(systemctl_bin)
        .args([
            "--user",
            "--no-pager",
            "show",
            KWIN_UNIT,
            "--property=Id,ActiveState,SubState,MainPID,Type,BusName,ExecStart,FragmentPath,SourcePath",
        ])
        .output()
        .map_err(|e| io::Error::new(e.kind(), format!("systemctl show failed: {e}")))?;
    if !output.status.success() {
        return Err(invalid(
            "systemctl show failed for plasma-kwin_wayland.service",
        ));
    }
    if output.stdout.is_empty() || output.stdout.len() as u64 > MAX_SYSTEMD_SHOW_BYTES {
        return Err(invalid("systemctl show reply is out of bounds"));
    }
    if output.stdout.contains(&b'\r') || output.stdout.contains(&0) {
        return Err(invalid("systemctl show reply is malformed"));
    }
    let text =
        String::from_utf8(output.stdout).map_err(|_| invalid("systemctl show is not UTF-8"))?;
    parse_systemd_show(&text).ok_or_else(|| invalid("systemctl show reply is malformed"))
}

/// Approved immutable wrapper pair pinned from the exact `ExecStart` path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WrapperPair {
    pub launcher_canon: PathBuf,
    pub launcher_dev: u64,
    pub launcher_ino: u64,
    pub launcher_mode: u32,
    pub launcher_content: Vec<u8>,
    pub wrapped_canon: PathBuf,
    pub wrapped_dev: u64,
    pub wrapped_ino: u64,
    pub wrapped_mode: u32,
    pub wrapped_content: Vec<u8>,
    pub package_root: PathBuf,
}

fn stat_regular_executable(path: &Path) -> io::Result<(u64, u64, u32)> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.is_symlink() || !metadata.is_file() {
        return Err(invalid("wrapper identity is not a regular file"));
    }
    if metadata.uid() != 0 {
        return Err(invalid("wrapper identity is not root-owned"));
    }
    let mode = metadata.mode() & 0o7777;
    if mode & 0o222 != 0 || mode & 0o111 == 0 {
        return Err(invalid("wrapper identity mode is not immutable executable"));
    }
    if metadata.ino() == 0 {
        return Err(invalid("wrapper identity inode is malformed"));
    }
    Ok((metadata.dev(), metadata.ino(), mode))
}

fn read_bounded_content(path: &Path) -> io::Result<Vec<u8>> {
    let file = File::open(path)?;
    let len = file.metadata()?.len();
    if len == 0 || len > MAX_APPROVED_WRAPPER_BYTES {
        return Err(invalid("wrapper identity size is out of bounds"));
    }
    let mut content = Vec::new();
    file.take(MAX_APPROVED_WRAPPER_BYTES + 1)
        .read_to_end(&mut content)?;
    if content.is_empty() || content.len() as u64 > MAX_APPROVED_WRAPPER_BYTES {
        return Err(invalid("wrapper identity size is out of bounds"));
    }
    Ok(content)
}

/// Pin the exact wrapper pair from an approved `ExecStart` launcher path.
/// Both files must canonicalize to themselves with immutable executable
/// modes; content/dev/ino are captured twice and must agree (replacement
/// drift refused). Returns `None` for any mismatch without I/O beyond the
/// two pinned files.
#[must_use]
pub fn approve_wrapper_pair(execstart_path: &str) -> Option<WrapperPair> {
    if !is_approved_wrapper_execstart(execstart_path) {
        return None;
    }
    let launcher = PathBuf::from(execstart_path);
    let launcher_canon = std::fs::canonicalize(&launcher).ok()?;
    if launcher_canon != launcher {
        return None;
    }
    if !is_safe_abs(&launcher_canon.to_string_lossy()) {
        return None;
    }
    let expected_wrapped = expected_wrapped_sibling(execstart_path)?;
    let wrapped = PathBuf::from(&expected_wrapped);
    let wrapped_canon = std::fs::canonicalize(&wrapped).ok()?;
    if wrapped_canon != wrapped {
        return None;
    }
    // Same package root by construction.
    let package_root = launcher.parent()?.parent()?.to_path_buf();
    if wrapped.parent()?.parent()? != package_root {
        return None;
    }
    let (launcher_dev, launcher_ino, launcher_mode) =
        stat_regular_executable(&launcher_canon).ok()?;
    let launcher_content = read_bounded_content(&launcher_canon).ok()?;
    let (wrapped_dev, wrapped_ino, wrapped_mode) = stat_regular_executable(&wrapped_canon).ok()?;
    let wrapped_content = read_bounded_content(&wrapped_canon).ok()?;
    // Revalidate once more before accepting.
    let (launcher_dev2, launcher_ino2, launcher_mode2) =
        stat_regular_executable(&launcher_canon).ok()?;
    let launcher_content2 = read_bounded_content(&launcher_canon).ok()?;
    let (wrapped_dev2, wrapped_ino2, wrapped_mode2) =
        stat_regular_executable(&wrapped_canon).ok()?;
    let wrapped_content2 = read_bounded_content(&wrapped_canon).ok()?;
    if (launcher_dev2, launcher_ino2, launcher_mode2) != (launcher_dev, launcher_ino, launcher_mode)
        || launcher_content2 != launcher_content
        || (wrapped_dev2, wrapped_ino2, wrapped_mode2) != (wrapped_dev, wrapped_ino, wrapped_mode)
        || wrapped_content2 != wrapped_content
    {
        return None;
    }
    Some(WrapperPair {
        launcher_canon,
        launcher_dev,
        launcher_ino,
        launcher_mode,
        launcher_content,
        wrapped_canon,
        wrapped_dev,
        wrapped_ino,
        wrapped_mode,
        wrapped_content,
        package_root,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "abcd1234abcd1234abcd1234abcd1234";
    fn launcher() -> String {
        format!("/nix/store/{HASH}-kwin-6.7.4-test/bin/kwin_wayland_wrapper")
    }
    fn wrapped() -> String {
        format!("/nix/store/{HASH}-kwin-6.7.4-test/bin/.kwin_wayland_wrapper-wrapped")
    }

    fn exec_raw_for(path: &str) -> String {
        format!("{{ path={path} ; argv[]={path} --test ; ignore=no }}")
    }

    fn input_ok() -> (
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
    ) {
        let exec = launcher();
        let raw = exec_raw_for(&exec);
        (
            ":1.9".to_owned(),
            ":1.9".to_owned(),
            "2e63db46-c4ae-4552-a899-fb864e3cbbc6".to_owned(),
            "2e63db46-c4ae-4552-a899-fb864e3cbbc6".to_owned(),
            KWIN_UNIT.to_owned(),
            KWIN_ACTIVE_STATE.to_owned(),
            KWIN_SUB_STATE.to_owned(),
            KWIN_UNIT_TYPE.to_owned(),
            KWIN_BUS_NAME.to_owned(),
            exec.clone(),
            exec,
            raw.clone(),
            raw,
        )
    }

    fn accept_ok_with(mutate: impl FnOnce(&mut DirectParentInput<'_>)) -> bool {
        let (
            owner,
            caller,
            boot,
            boot_end,
            unit,
            active,
            sub,
            unit_type,
            bus,
            exec,
            exec_end,
            raw,
            raw_end,
        ) = input_ok();
        let mut input = DirectParentInput {
            owner: &owner,
            caller: &caller,
            owner_pid: 3568836,
            owner_pid_end: 3568836,
            owner_uid: 1000,
            owner_uid_end: 1000,
            expected_uid: 1000,
            owner_tick: 13991576,
            owner_tick_end: 13991576,
            owner_ppid: 3568829,
            owner_ppid_end: 3568829,
            main_pid: 3568829,
            main_pid_end: 3568829,
            main_tick: 13991575,
            main_tick_end: 13991575,
            boot_id: &boot,
            boot_id_end: &boot_end,
            unit: &unit,
            unit_end: &unit,
            active: &active,
            active_end: &active,
            sub: &sub,
            sub_end: &sub,
            unit_type: &unit_type,
            unit_type_end: &unit_type,
            bus_name: &bus,
            bus_name_end: &bus,
            execstart_raw: &raw,
            execstart_raw_end: &raw_end,
            execstart_path: &exec,
            execstart_path_end: &exec_end,
            owner_exe: ExeState::Unreadable,
            owner_exe_end: ExeState::Unreadable,
            main_exe: ExeState::Unreadable,
            main_exe_end: ExeState::Unreadable,
        };
        mutate(&mut input);
        accept_direct_parent(&input)
    }

    #[test]
    fn accepted_exact_direct_parent() {
        assert!(accept_ok_with(|_| {}));
        // Readable MainPID agreement is also accepted when stable
        // (owner stays unreadable pre/post).
        assert!(accept_ok_with(|input| {
            input.main_exe = ExeState::Matches;
            input.main_exe_end = ExeState::Matches;
        }));
    }

    #[test]
    fn rejects_owner_mismatch() {
        assert!(!accept_ok_with(|input| {
            input.caller = ":1.10";
        }));
        assert!(!accept_ok_with(|input| {
            input.owner = "not-a-unique-name";
            input.caller = "not-a-unique-name";
        }));
        assert!(!accept_ok_with(|input| {
            input.owner = "";
            input.caller = "";
        }));
    }

    #[test]
    fn rejects_pid_mismatch() {
        assert!(!accept_ok_with(|input| {
            input.owner_pid = 0;
            input.owner_pid_end = 0;
        }));
        assert!(!accept_ok_with(|input| {
            input.main_pid = 0;
            input.main_pid_end = 0;
        }));
        // Owner equal to MainPID is the systemd (non-direct-parent) topology.
        assert!(!accept_ok_with(|input| {
            input.owner_pid = input.main_pid;
            input.owner_pid_end = input.main_pid;
            input.owner_ppid = 1;
            input.owner_ppid_end = 1;
        }));
        assert!(!accept_ok_with(|input| {
            input.owner_uid = 1001;
        }));
        // Credential PID/UID drift at end fails closed (TOCTOU).
        assert!(!accept_ok_with(|input| {
            input.owner_pid_end = input.owner_pid + 1;
        }));
        assert!(!accept_ok_with(|input| {
            input.owner_uid_end = input.owner_uid + 1;
        }));
        assert!(!accept_ok_with(|input| {
            input.main_pid_end = input.main_pid + 1;
        }));
    }

    #[test]
    fn rejects_tick_mismatch() {
        assert!(!accept_ok_with(|input| {
            input.owner_tick_end = input.owner_tick + 1;
        }));
        assert!(!accept_ok_with(|input| {
            input.owner_tick = 0;
            input.owner_tick_end = 0;
        }));
        assert!(!accept_ok_with(|input| {
            input.main_tick_end = input.main_tick + 1;
        }));
        assert!(!accept_ok_with(|input| {
            input.main_tick = 0;
            input.main_tick_end = 0;
        }));
    }

    #[test]
    fn rejects_boot_mismatch() {
        assert!(accept_ok_with(|_| {}));
        assert!(!accept_ok_with(|input| {
            input.boot_id_end = "00000000-0000-0000-0000-000000000000";
        }));
        assert!(!accept_ok_with(|input| {
            input.boot_id = "not-a-boot-id";
            input.boot_id_end = "not-a-boot-id";
        }));
        assert!(!accept_ok_with(|input| {
            input.boot_id = "2E63DB46-C4AE-4552-A899-FB864E3CBBc6";
            input.boot_id_end = "2E63DB46-C4AE-4552-A899-FB864E3CBBc6";
        }));
    }

    #[test]
    fn rejects_parent_mismatch() {
        // Sibling with unrelated PPid.
        assert!(!accept_ok_with(|input| {
            input.owner_ppid = 999999;
            input.owner_ppid_end = 999999;
        }));
        // Deeper descendant is not the direct MainPID even when MainPID is an
        // ancestor further up the tree.
        assert!(!accept_ok_with(|input| {
            input.owner_ppid = 3568830;
            input.owner_ppid_end = 3568830;
        }));
        // Mid-run PPid drift.
        assert!(!accept_ok_with(|input| {
            input.owner_ppid_end = input.owner_ppid + 1;
        }));
        assert!(!accept_ok_with(|input| {
            input.owner_ppid = 0;
            input.owner_ppid_end = 0;
        }));
    }

    #[test]
    fn rejects_unit_mismatch() {
        assert!(!accept_ok_with(|input| {
            input.unit = "plasma-kwin_x11.service";
        }));
        assert!(!accept_ok_with(|input| {
            input.active = "inactive";
        }));
        assert!(!accept_ok_with(|input| {
            input.sub = "dead";
        }));
        assert!(!accept_ok_with(|input| {
            input.unit_type = "simple";
        }));
        assert!(!accept_ok_with(|input| {
            input.bus_name = "org.kde.Other";
        }));
        // Post unit identity drift fails closed.
        assert!(!accept_ok_with(|input| {
            input.unit_end = "plasma-kwin_x11.service";
        }));
        assert!(!accept_ok_with(|input| {
            input.active_end = "inactive";
        }));
        assert!(!accept_ok_with(|input| {
            input.sub_end = "dead";
        }));
        assert!(!accept_ok_with(|input| {
            input.unit_type_end = "simple";
        }));
        assert!(!accept_ok_with(|input| {
            input.bus_name_end = "org.kde.Other";
        }));
    }

    #[test]
    fn rejects_execstart_wrapper_mismatch() {
        // Keep raw/path pairs consistent for pure wrapper-shape refusals.
        let bad_path = "/usr/bin/kwin_wayland_wrapper".to_owned();
        let bad_raw = format!("{{ path={bad_path} ; ignore=no }}");
        assert!(!accept_ok_with(|input| {
            input.execstart_path = Box::leak(bad_path.clone().into_boxed_str());
            input.execstart_path_end = Box::leak(bad_path.clone().into_boxed_str());
            input.execstart_raw = Box::leak(bad_raw.clone().into_boxed_str());
            input.execstart_raw_end = Box::leak(bad_raw.clone().into_boxed_str());
        }));
        let short_path = "/nix/store/short/bin/kwin_wayland_wrapper".to_owned();
        let short_raw = format!("{{ path={short_path} ; ignore=no }}");
        assert!(!accept_ok_with(|input| {
            input.execstart_path = Box::leak(short_path.clone().into_boxed_str());
            input.execstart_path_end = Box::leak(short_path.clone().into_boxed_str());
            input.execstart_raw = Box::leak(short_raw.clone().into_boxed_str());
            input.execstart_raw_end = Box::leak(short_raw.clone().into_boxed_str());
        }));
        // Embedded separator in the store component is rejected.
        let evil = format!("/nix/store/{HASH}-kwin-6.7.4-test/bin/evil/bin/kwin_wayland_wrapper");
        assert!(!is_wrapper_launcher(&evil));
        assert!(!is_approved_wrapper_execstart(&evil));
        let evil_wrapped =
            format!("/nix/store/{HASH}-kwin-6.7.4-test/bin/evil/bin/.kwin_wayland_wrapper-wrapped");
        assert!(!is_wrapped_sibling(&evil_wrapped));
        // Full raw drift (valid observed args changed) fails closed even when
        // the parsed path is unchanged.
        assert!(!accept_ok_with(|input| {
            input.execstart_raw_end =
                Box::leak(format!("{} --drifted", input.execstart_raw).into_boxed_str());
        }));
        assert!(!accept_ok_with(|input| {
            input.execstart_path_end = "/usr/bin/kwin_wayland_wrapper";
        }));
    }

    #[test]
    fn rejects_readable_exe_disagreement() {
        // Readable owner exe must never take the fallback, even when it would
        // otherwise match. Both pre and post must stay Unreadable.
        for state in [
            ExeState::Matches,
            ExeState::Mismatch,
            ExeState::Missing,
            ExeState::Deleted,
            ExeState::Malformed,
        ] {
            assert!(!accept_ok_with(|input| {
                input.owner_exe = state;
            }));
            assert!(!accept_ok_with(|input| {
                input.owner_exe_end = state;
            }));
        }
        // Readable MainPID disagreement fails closed, as does any post drift.
        for state in [
            ExeState::Mismatch,
            ExeState::Missing,
            ExeState::Deleted,
            ExeState::Malformed,
        ] {
            assert!(!accept_ok_with(|input| {
                input.main_exe = state;
                input.main_exe_end = state;
            }));
        }
        assert!(!accept_ok_with(|input| {
            input.main_exe = ExeState::Matches;
            input.main_exe_end = ExeState::Unreadable;
        }));
        assert!(!accept_ok_with(|input| {
            input.main_exe = ExeState::Unreadable;
            input.main_exe_end = ExeState::Matches;
        }));
    }

    #[test]
    fn execstart_parser_accepts_single_and_rejects_ambiguous() {
        let good = format!(
            "{{ path={} ; argv[]={} test ; ignore=no }}",
            launcher(),
            launcher()
        );
        assert_eq!(
            parse_execstart_value(&good).as_deref(),
            Some(launcher().as_str())
        );
        assert!(parse_execstart_value("").is_none());
        assert!(
            parse_execstart_value(&format!(
                "{{ path={} ; ignore=no }} {{ path={} ; ignore=no }}",
                launcher(),
                launcher()
            ))
            .is_none()
        );
        assert!(parse_execstart_value("{ path=/usr/bin/x ; ignore=no }").is_some());
        assert!(
            parse_execstart_value(
                "{ path=/usr/bin/x ; ignore=no } { path=/usr/bin/y ; ignore=no }"
            )
            .is_none()
        );
        assert!(parse_execstart_value("tcp:host=x").is_none());
        assert!(parse_execstart_value("{ path=/tmp/a;$(id) ; ignore=no }").is_none());
    }

    #[test]
    fn systemd_show_parser_is_strict() {
        let text = format!(
            "Id=plasma-kwin_wayland.service\nActiveState=active\nSubState=running\nMainPID=3568829\nType=dbus\nBusName=org.kde.KWinWrapper\nExecStart={{ path={} ; ignore=no }}\nFragmentPath=/run/systemd/user/plasma-kwin_wayland.service\nSourcePath=\n",
            launcher()
        );
        let unit = parse_systemd_show(&text).expect("valid show parses");
        assert_eq!(unit.unit, KWIN_UNIT);
        assert_eq!(unit.main_pid, 3568829);
        assert!(parse_systemd_show(&text.replace("SubState=running", "SubState=dead")).is_some());
        // Duplicate, unexpected, missing, and malformed replies fail closed.
        assert!(parse_systemd_show(&format!("{text}Id=other\n")).is_none());
        assert!(parse_systemd_show(&format!("{text}Extra=1\n")).is_none());
        assert!(parse_systemd_show(&text.replace("SourcePath=\n", "")).is_none());
        assert!(parse_systemd_show("").is_none());
        assert!(parse_systemd_show(&text.replace("MainPID=3568829", "MainPID=0")).is_none());
    }

    #[test]
    fn wrapper_shape_checks_are_exact() {
        assert!(is_approved_wrapper_execstart(&launcher()));
        assert!(is_wrapper_launcher(&launcher()));
        assert!(is_wrapped_sibling(&wrapped()));
        assert_eq!(
            expected_wrapped_sibling(&launcher()).as_deref(),
            Some(wrapped().as_str())
        );
        assert!(!is_approved_wrapper_execstart(&wrapped()));
        assert!(!is_approved_wrapper_execstart(
            "/usr/bin/kwin_wayland_wrapper"
        ));
        assert!(!is_approved_wrapper_execstart(
            "/nix/store/short/bin/kwin_wayland_wrapper"
        ));
        assert!(!is_safe_abs("/tmp/a-evil/../b"));
        assert!(is_safe_abs("/tmp/a/bus"));
    }

    #[test]
    fn boot_and_owner_shapes_are_strict() {
        assert!(valid_boot_id("2e63db46-c4ae-4552-a899-fb864e3cbbc6"));
        assert!(!valid_boot_id("2E63DB46-C4AE-4552-A899-FB864E3CBBc6"));
        assert!(!valid_boot_id("not-a-boot-id"));
        assert!(!valid_boot_id(""));
        assert!(is_unique_owner(":1.9"));
        assert!(!is_unique_owner("org.kde.KWin"));
        assert!(!is_unique_owner("not-a-unique-name"));
        assert!(!is_unique_owner(""));
    }

    #[test]
    fn trusted_systemctl_location_is_explicit_and_fails_closed() {
        assert_eq!(
            TRUSTED_SYSTEMCTL_PATH,
            "/run/current-system/sw/bin/systemctl"
        );
        assert!(Path::new(TRUSTED_SYSTEMCTL_PATH).is_absolute());
        assert!(is_trusted_systemctl_path(Path::new(
            "/run/current-system/sw/bin/systemctl"
        )));
        assert!(!is_trusted_systemctl_path(Path::new("systemctl")));
        assert!(!is_trusted_systemctl_path(Path::new("/usr/bin/systemctl")));
        assert!(!is_trusted_systemctl_path(Path::new(
            "/run/current-system/sw/bin/systemctl-evil"
        )));
        // Non-trusted paths fail closed without executing anything.
        assert!(read_systemd_unit_from(Path::new("systemctl")).is_err());
        assert!(read_systemd_unit_from(Path::new("/usr/bin/systemctl")).is_err());
        assert!(read_systemd_unit_from(Path::new("relative/path")).is_err());
    }

    #[test]
    fn io_error_classification_is_kind_based_with_no_fallback_except_denied() {
        let denied = io::Error::new(io::ErrorKind::PermissionDenied, "x");
        let missing = io::Error::new(io::ErrorKind::NotFound, "x");
        let deleted = io::Error::new(io::ErrorKind::InvalidData, "x (deleted)");
        let other = io::Error::new(io::ErrorKind::Interrupted, "x");
        assert_eq!(classify_io_error(&denied), ExeState::Unreadable);
        assert_eq!(classify_io_error(&missing), ExeState::Missing);
        // Deleted/invalid content folds to Malformed without string matching;
        // both fail closed identically.
        assert_eq!(classify_io_error(&deleted), ExeState::Malformed);
        assert_eq!(classify_io_error(&other), ExeState::Malformed);
        assert!(owner_exe_requires_fallback(&denied));
        assert!(!owner_exe_requires_fallback(&missing));
        assert!(!owner_exe_requires_fallback(&deleted));
        assert!(!owner_exe_requires_fallback(&other));
    }

    #[test]
    fn nix_paths_reject_embedded_separators() {
        let evil_launcher =
            format!("/nix/store/{HASH}-kwin-6.7.4-test/bin/evil/bin/kwin_wayland_wrapper");
        assert!(!is_wrapper_launcher(&evil_launcher));
        assert!(!is_approved_wrapper_execstart(&evil_launcher));
        let evil_wrapped =
            format!("/nix/store/{HASH}-kwin-6.7.4-test/bin/evil/bin/.kwin_wayland_wrapper-wrapped");
        assert!(!is_wrapped_sibling(&evil_wrapped));
        let traversal =
            format!("/nix/store/{HASH}-kwin-6.7.4-test/bin/../bin/kwin_wayland_wrapper");
        assert!(!is_wrapper_launcher(&traversal));
        assert!(!is_safe_abs(&traversal) || !is_wrapper_launcher(&traversal));
    }

    #[test]
    fn execstart_raw_binding_preserves_args_and_rejects_drift() {
        let good = exec_raw_for(&launcher());
        assert_eq!(
            parse_execstart_value(&good).as_deref(),
            Some(launcher().as_str())
        );
        // Malformed/ambiguous raws are rejected.
        assert!(parse_execstart_value("").is_none());
        assert!(parse_execstart_value("{ path=/a ; ignore=no } { path=/b ; ignore=no }").is_none());
        // Raw drift with an unchanged parsed path still fails closed.
        assert!(!accept_ok_with(|input| {
            input.execstart_raw_end =
                Box::leak(format!("{} ", input.execstart_raw).into_boxed_str());
        }));
        // Unparseable post raw fails closed.
        assert!(!accept_ok_with(|input| {
            input.execstart_raw_end = "not-an-execstart";
            input.execstart_path_end = "not-an-execstart";
        }));
    }
}
