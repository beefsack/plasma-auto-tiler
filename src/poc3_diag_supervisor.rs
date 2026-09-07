//! POC3 diagnostic supervisor: pure/test-only logic.
//!
//! Test-only resident staging for exactly three unchanged
//! `poc3-diagnostic-client` processes. No compositor, no KWin, no D-Bus,
//! no production coupling. The live spawn/resident path lives in
//! `src/bin/poc3-diag-supervisor.rs`; this module holds only pure
//! CLI/path/argv/readiness/diagnostic logic testable without Wayland.
//! Errors and diagnostics never emit user path or environment content.

use std::collections::BTreeMap;

pub const SUPERVISOR_BIN_NAME: &str = "poc3-diag-supervisor";
pub const CLIENT_BIN_NAME: &str = "poc3-diagnostic-client";
pub const MAX_PATH_LEN: usize = 1024;
pub const MAX_SOCKET_NAME_LEN: usize = 128;
pub const MAX_SUP_EVENT_BYTES: usize = 1024;
pub const MAX_SUP_FILE_BYTES: usize = 65536;
pub const MAX_PID_FILE_BYTES: usize = 4096;
pub const READY_TIMEOUT_DEFAULT_SECS: u64 = 20;
pub const READY_TIMEOUT_MIN_SECS: u64 = 1;
pub const READY_TIMEOUT_MAX_SECS: u64 = 120;
pub const EXPECTED_CLIENT_ARGC: usize = 9;
pub const EXPECTED_HOST_CLIENT_ARGC: usize = 10;

/// Validated supervisor target. All values bounded; no ambient fallback.
/// `client_bin` must already be the manifest-derived canonical path; its
/// on-disk `client_sha256`/`client_dev`/`client_ino` bind the exact identity
/// so unbound direct spawning (missing these flags) is rejected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupervisorConfig {
    pub runtime_dir: String,
    pub socket_name: String,
    pub client_bin: String,
    pub client_sha256: String,
    pub client_dev: u64,
    pub client_ino: u64,
    pub workdir: String,
    pub timeout_secs: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupCliError {
    MissingArg,
    UnknownArg,
    BadValue,
    BadSlot,
    AmbientTarget,
    HostTarget,
    DefaultTarget,
}

impl SupCliError {
    #[must_use]
    pub const fn kind(self) -> &'static str {
        match self {
            Self::MissingArg => "missing-arg",
            Self::UnknownArg => "unknown-arg",
            Self::BadValue => "bad-value",
            Self::BadSlot => "bad-slot",
            Self::AmbientTarget => "ambient-target",
            Self::HostTarget => "host-target",
            Self::DefaultTarget => "default-target",
        }
    }

    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::MissingArg => "explicit target is missing",
            Self::UnknownArg => "unknown argument",
            Self::BadValue => "target value is invalid",
            Self::BadSlot => "slot must be exactly 1, 2, or 3",
            Self::AmbientTarget => "ambient or default target is refused",
            Self::HostTarget => "host target is refused",
            Self::DefaultTarget => "default target is refused",
        }
    }
}

impl std::fmt::Display for SupCliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "error: {} ({})", self.message(), self.kind())
    }
}

fn is_ambient_set(get_env: &dyn Fn(&str) -> Option<String>) -> bool {
    for key in ["WAYLAND_DISPLAY", "WAYLAND_SOCKET", "XDG_RUNTIME_DIR"] {
        if let Some(v) = get_env(key)
            && !v.is_empty()
        {
            return true;
        }
    }
    false
}

fn valid_path_syntax(v: &str) -> bool {
    if v.is_empty() || v.len() > MAX_PATH_LEN {
        return false;
    }
    if !v.starts_with('/') {
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

fn valid_socket_name(v: &str) -> bool {
    if v.is_empty() || v.len() > MAX_SOCKET_NAME_LEN {
        return false;
    }
    if v.contains('/') || v.contains('\0') || v.contains('\n') {
        return false;
    }
    v.bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
}

fn is_default_socket(name: &str) -> bool {
    if let Some(rest) = name.strip_prefix("wayland-") {
        !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit())
    } else {
        false
    }
}

fn valid_sha256_hex(v: &str) -> bool {
    v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit())
}

/// True when a `/proc/<pid>/fd/<fd>` link target is the live enumeration
/// handle itself (`/proc/self/fd` or `/proc/<pid>/fd`). Such a descriptor
/// must never be closed or reused while enumerating.
#[must_use]
pub fn is_proc_fd_enumeration_target(target: &str, pid: u32) -> bool {
    if target == "/proc/self/fd" {
        return true;
    }
    let mut expected = [0u8; 64];
    let prefix = b"/proc/";
    let suffix = b"/fd";
    let mut len = prefix.len();
    expected[..len].copy_from_slice(prefix);
    let mut buf = [0u8; 32];
    let n = uid_to_decimal(pid, &mut buf);
    if len + n + suffix.len() > expected.len() {
        return false;
    }
    expected[len..len + n].copy_from_slice(&buf[..n]);
    len += n;
    expected[len..len + suffix.len()].copy_from_slice(suffix);
    len += suffix.len();
    target.as_bytes() == &expected[..len]
}

fn is_host_runtime(runtime: &str, uid: u32) -> bool {
    if matches!(runtime, "/" | "/tmp" | "/run" | "/run/user") {
        return true;
    }
    let mut buf = [0u8; 32];
    let n = uid_to_decimal(uid, &mut buf);
    let mut full = [0u8; 64];
    let prefix = b"/run/user/";
    full[..prefix.len()].copy_from_slice(prefix);
    full[prefix.len()..prefix.len() + n].copy_from_slice(&buf[..n]);
    runtime.as_bytes() == &full[..prefix.len() + n]
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

fn take_flag_value(
    flag: &str,
    arg: &str,
    next: Option<&str>,
) -> Result<(String, usize), SupCliError> {
    if let Some(rest) = arg.strip_prefix(&format!("{flag}=")) {
        if rest.is_empty() {
            return Err(SupCliError::MissingArg);
        }
        return Ok((rest.to_owned(), 1));
    }
    if arg == flag {
        let v = next
            .filter(|v| !v.is_empty())
            .ok_or(SupCliError::MissingArg)?;
        return Ok((v.to_owned(), 2));
    }
    Err(SupCliError::UnknownArg)
}

/// Strict supervisor CLI: requires
/// `--runtime/--socket/--client-bin/--client-sha256/--client-dev/--client-ino/--workdir`,
/// optional `--timeout-secs` (bounded 1..120). The client identity flags are
/// the existing manifest-derived exact values supplied by the launcher; direct
/// invocation without them is rejected as unbound. No manifest route, no
/// defaults, no ambient fallback, no host target.
pub fn parse_supervisor_args(
    argv: &[String],
    uid: u32,
    get_env: &dyn Fn(&str) -> Option<String>,
) -> Result<SupervisorConfig, SupCliError> {
    if is_ambient_set(get_env) {
        return Err(SupCliError::AmbientTarget);
    }
    let mut runtime: Option<String> = None;
    let mut socket: Option<String> = None;
    let mut client_bin: Option<String> = None;
    let mut client_sha256: Option<String> = None;
    let mut client_dev: Option<String> = None;
    let mut client_ino: Option<String> = None;
    let mut workdir: Option<String> = None;
    let mut timeout: Option<u64> = None;
    let args = if argv.first().is_some_and(|a| !a.starts_with("--")) {
        &argv[1..]
    } else {
        argv
    };
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        let next = args.get(i + 1).map(String::as_str);
        if arg == "--runtime" || arg.starts_with("--runtime=") {
            let (v, n) = take_flag_value("--runtime", arg, next)?;
            runtime = Some(v);
            i += n;
        } else if arg == "--socket" || arg.starts_with("--socket=") {
            let (v, n) = take_flag_value("--socket", arg, next)?;
            socket = Some(v);
            i += n;
        } else if arg == "--client-bin" || arg.starts_with("--client-bin=") {
            let (v, n) = take_flag_value("--client-bin", arg, next)?;
            client_bin = Some(v);
            i += n;
        } else if arg == "--client-sha256" || arg.starts_with("--client-sha256=") {
            let (v, n) = take_flag_value("--client-sha256", arg, next)?;
            client_sha256 = Some(v);
            i += n;
        } else if arg == "--client-dev" || arg.starts_with("--client-dev=") {
            let (v, n) = take_flag_value("--client-dev", arg, next)?;
            client_dev = Some(v);
            i += n;
        } else if arg == "--client-ino" || arg.starts_with("--client-ino=") {
            let (v, n) = take_flag_value("--client-ino", arg, next)?;
            client_ino = Some(v);
            i += n;
        } else if arg == "--workdir" || arg.starts_with("--workdir=") {
            let (v, n) = take_flag_value("--workdir", arg, next)?;
            workdir = Some(v);
            i += n;
        } else if arg == "--timeout-secs" || arg.starts_with("--timeout-secs=") {
            let (v, n) = take_flag_value("--timeout-secs", arg, next)?;
            let t: u64 = v.parse().map_err(|_| SupCliError::BadValue)?;
            if !(READY_TIMEOUT_MIN_SECS..=READY_TIMEOUT_MAX_SECS).contains(&t) {
                return Err(SupCliError::BadValue);
            }
            timeout = Some(t);
            i += n;
        } else {
            return Err(SupCliError::UnknownArg);
        }
    }
    let (runtime, socket, client_bin, client_sha256, client_dev, client_ino, workdir) = match (
        runtime,
        socket,
        client_bin,
        client_sha256,
        client_dev,
        client_ino,
        workdir,
    ) {
        (Some(r), Some(s), Some(c), Some(h), Some(d), Some(n), Some(w)) => (r, s, c, h, d, n, w),
        _ => return Err(SupCliError::MissingArg),
    };
    if !valid_sha256_hex(&client_sha256) {
        return Err(SupCliError::BadValue);
    }
    let dev_num: u64 = client_dev.parse().map_err(|_| SupCliError::BadValue)?;
    let ino_num: u64 = client_ino.parse().map_err(|_| SupCliError::BadValue)?;
    if ino_num == 0 {
        return Err(SupCliError::BadValue);
    }
    if !valid_path_syntax(&runtime)
        || !valid_path_syntax(&client_bin)
        || !valid_path_syntax(&workdir)
    {
        return Err(SupCliError::BadValue);
    }
    if !valid_socket_name(&socket) {
        return Err(SupCliError::BadValue);
    }
    if is_host_runtime(&runtime, uid) {
        return Err(SupCliError::HostTarget);
    }
    if is_default_socket(&socket) {
        return Err(SupCliError::DefaultTarget);
    }
    if runtime.len() + 1 + socket.len() > MAX_PATH_LEN {
        return Err(SupCliError::BadValue);
    }
    // Client binary must be the exact diagnostic basename; directory binding
    // is enforced by the launcher (documented local build or /nix/store).
    let base = client_bin.rsplit('/').next().unwrap_or("");
    if base != CLIENT_BIN_NAME {
        return Err(SupCliError::BadValue);
    }
    if workdir == runtime || workdir.starts_with(&format!("{runtime}/")) {
        // Workdir inside runtime would be removed with runtime bookkeeping;
        // keep them distinct. Runtime inside workdir is the expected shape
        // (WORKDIR/runtime), so only reject workdir==runtime or workdir under
        // runtime.
        return Err(SupCliError::BadValue);
    }
    Ok(SupervisorConfig {
        runtime_dir: runtime,
        socket_name: socket,
        client_bin,
        client_sha256,
        client_dev: dev_num,
        client_ino: ino_num,
        workdir,
        timeout_secs: timeout.unwrap_or(READY_TIMEOUT_DEFAULT_SECS),
    })
}

/// Host-scope supervisor CLI (additive; nested `parse_supervisor_args` is
/// frozen). Selected only with an explicit `--host` flag consumed here.
/// Requires the same seven identity flags plus `--host`, and inverts the
/// scope gate: the runtime must be exactly the host `/run/user/<uid>` and
/// the socket must be a default `wayland-N` display. Nested private
/// runtimes/sockets, ambient env targets, and missing/unknown args refuse
/// fail-closed. No defaults, no manifest route.
pub fn parse_host_supervisor_args(
    argv: &[String],
    uid: u32,
    get_env: &dyn Fn(&str) -> Option<String>,
) -> Result<SupervisorConfig, SupCliError> {
    if is_ambient_set(get_env) {
        return Err(SupCliError::AmbientTarget);
    }
    let args = if argv.first().is_some_and(|a| !a.starts_with("--")) {
        &argv[1..]
    } else {
        argv
    };
    let mut host = false;
    let mut rest: Vec<String> = Vec::new();
    for a in args {
        if a == "--host" {
            if host {
                return Err(SupCliError::UnknownArg);
            }
            host = true;
        } else {
            rest.push(a.clone());
        }
    }
    if !host {
        return Err(SupCliError::MissingArg);
    }
    let mut runtime: Option<String> = None;
    let mut socket: Option<String> = None;
    let mut client_bin: Option<String> = None;
    let mut client_sha256: Option<String> = None;
    let mut client_dev: Option<String> = None;
    let mut client_ino: Option<String> = None;
    let mut workdir: Option<String> = None;
    let mut timeout: Option<u64> = None;
    let mut i = 0;
    while i < rest.len() {
        let arg = rest[i].as_str();
        let next = rest.get(i + 1).map(String::as_str);
        if arg == "--runtime" || arg.starts_with("--runtime=") {
            let (v, n) = take_flag_value("--runtime", arg, next)?;
            runtime = Some(v);
            i += n;
        } else if arg == "--socket" || arg.starts_with("--socket=") {
            let (v, n) = take_flag_value("--socket", arg, next)?;
            socket = Some(v);
            i += n;
        } else if arg == "--client-bin" || arg.starts_with("--client-bin=") {
            let (v, n) = take_flag_value("--client-bin", arg, next)?;
            client_bin = Some(v);
            i += n;
        } else if arg == "--client-sha256" || arg.starts_with("--client-sha256=") {
            let (v, n) = take_flag_value("--client-sha256", arg, next)?;
            client_sha256 = Some(v);
            i += n;
        } else if arg == "--client-dev" || arg.starts_with("--client-dev=") {
            let (v, n) = take_flag_value("--client-dev", arg, next)?;
            client_dev = Some(v);
            i += n;
        } else if arg == "--client-ino" || arg.starts_with("--client-ino=") {
            let (v, n) = take_flag_value("--client-ino", arg, next)?;
            client_ino = Some(v);
            i += n;
        } else if arg == "--workdir" || arg.starts_with("--workdir=") {
            let (v, n) = take_flag_value("--workdir", arg, next)?;
            workdir = Some(v);
            i += n;
        } else if arg == "--timeout-secs" || arg.starts_with("--timeout-secs=") {
            let (v, n) = take_flag_value("--timeout-secs", arg, next)?;
            let t: u64 = v.parse().map_err(|_| SupCliError::BadValue)?;
            if !(READY_TIMEOUT_MIN_SECS..=READY_TIMEOUT_MAX_SECS).contains(&t) {
                return Err(SupCliError::BadValue);
            }
            timeout = Some(t);
            i += n;
        } else {
            return Err(SupCliError::UnknownArg);
        }
    }
    let (runtime, socket, client_bin, client_sha256, client_dev, client_ino, workdir) = match (
        runtime,
        socket,
        client_bin,
        client_sha256,
        client_dev,
        client_ino,
        workdir,
    ) {
        (Some(r), Some(s), Some(c), Some(h), Some(d), Some(n), Some(w)) => (r, s, c, h, d, n, w),
        _ => return Err(SupCliError::MissingArg),
    };
    if !valid_sha256_hex(&client_sha256) {
        return Err(SupCliError::BadValue);
    }
    let dev_num: u64 = client_dev.parse().map_err(|_| SupCliError::BadValue)?;
    let ino_num: u64 = client_ino.parse().map_err(|_| SupCliError::BadValue)?;
    if ino_num == 0 {
        return Err(SupCliError::BadValue);
    }
    if !valid_path_syntax(&runtime)
        || !valid_path_syntax(&client_bin)
        || !valid_path_syntax(&workdir)
    {
        return Err(SupCliError::BadValue);
    }
    if !valid_socket_name(&socket) {
        return Err(SupCliError::BadValue);
    }
    // Inverted scope gate vs nested: host requires the host runtime and a
    // default display. Anything else is a nested/incorrect scope refusal.
    if !is_host_runtime(&runtime, uid) {
        return Err(SupCliError::HostTarget);
    }
    if !is_default_socket(&socket) {
        return Err(SupCliError::DefaultTarget);
    }
    if runtime.len() + 1 + socket.len() > MAX_PATH_LEN {
        return Err(SupCliError::BadValue);
    }
    let base = client_bin.rsplit('/').next().unwrap_or("");
    if base != CLIENT_BIN_NAME {
        // Narrow frozen content-addressed acceptance: ONLY the exact
        // current-UID lexical path
        // `/run/user/<uid>/plasma-auto-tiler-host-frozen/poc3-diagnostic-client-<client_sha256>`
        // where `<client_sha256>` is the already validated 64-lowercase hex
        // `--client-sha256` value. Regular unsuffixed acceptance above is
        // preserved; no generic suffix/copy path.
        let sha_is_lower_hex = client_sha256.len() == 64
            && client_sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'));
        if !sha_is_lower_hex {
            return Err(SupCliError::BadValue);
        }
        let expected = format!(
            "/run/user/{uid}/plasma-auto-tiler-host-frozen/{CLIENT_BIN_NAME}-{client_sha256}"
        );
        if client_bin != expected {
            return Err(SupCliError::BadValue);
        }
    }
    // Host layout: the project workdir is a private subdir of the shared
    // host runtime (e.g. /run/user/<uid>/plasma-auto-tiler-host-pilot), so
    // only equality is rejected here. Nested keeps the stricter rule above.
    if workdir == runtime {
        return Err(SupCliError::BadValue);
    }
    Ok(SupervisorConfig {
        runtime_dir: runtime,
        socket_name: socket,
        client_bin,
        client_sha256,
        client_dev: dev_num,
        client_ino: ino_num,
        workdir,
        timeout_secs: timeout.unwrap_or(READY_TIMEOUT_DEFAULT_SECS),
    })
}

/// Documented standard descriptors preserved across spawn: exactly 0, 1, 2.
/// Every other descriptor is closed before spawning clients.
#[must_use]
pub const fn should_preserve_fd(fd: i32) -> bool {
    matches!(fd, 0..=2)
}

/// Pure filter: given observed FDs, return those that must be closed
/// (all except documented 0/1/2). No I/O, no discovery.
#[must_use]
pub fn fds_to_close(observed: &[i32]) -> Vec<i32> {
    observed
        .iter()
        .copied()
        .filter(|fd| !should_preserve_fd(*fd))
        .collect()
}

/// Direct WORKDIR children owned by the trio. All bounded absolute paths.
#[must_use]
pub fn client_diag_path(workdir: &str, slot: u8) -> Option<String> {
    if !(1..=3).contains(&slot) {
        return None;
    }
    Some(format!("{workdir}/manual-{slot}.diag.log"))
}

#[must_use]
pub fn client_stderr_path(workdir: &str, slot: u8) -> Option<String> {
    if !(1..=3).contains(&slot) {
        return None;
    }
    Some(format!("{workdir}/manual-{slot}.stderr"))
}

/// Host-only direct WORKDIR children owned by the trio. All bounded
/// absolute paths. Additive; nested `client_diag_path`/`client_stderr_path`
/// (`manual-*`) are frozen.
#[must_use]
pub fn host_client_diag_path(workdir: &str, slot: u8) -> Option<String> {
    if !(1..=3).contains(&slot) {
        return None;
    }
    Some(format!("{workdir}/host-{slot}.diag.log"))
}

#[must_use]
pub fn host_client_stderr_path(workdir: &str, slot: u8) -> Option<String> {
    if !(1..=3).contains(&slot) {
        return None;
    }
    Some(format!("{workdir}/host-{slot}.stderr"))
}

#[must_use]
pub fn supervisor_diag_path(workdir: &str) -> String {
    format!("{workdir}/diag-supervisor.log")
}

#[must_use]
pub fn supervisor_ready_path(workdir: &str) -> String {
    format!("{workdir}/diag-trio.ready")
}

#[must_use]
pub fn supervisor_pidfile_path(workdir: &str) -> String {
    format!("{workdir}/diag-trio.pids")
}

/// Exact unchanged client argv: 9 elements, no shell, no interpolation.
#[must_use]
pub fn client_argv(
    client_bin: &str,
    runtime: &str,
    socket: &str,
    slot: u8,
    diag: &str,
) -> Option<Vec<String>> {
    if !(1..=3).contains(&slot) {
        return None;
    }
    let v = vec![
        client_bin.to_owned(),
        "--runtime".to_owned(),
        runtime.to_owned(),
        "--socket".to_owned(),
        socket.to_owned(),
        "--slot".to_owned(),
        slot.to_string(),
        "--diag".to_owned(),
        diag.to_owned(),
    ];
    if v.len() != EXPECTED_CLIENT_ARGC {
        return None;
    }
    Some(v)
}

/// Exact host-scope client argv: 10 elements with exactly one `--host`,
/// no shell, no interpolation. Additive; nested `client_argv` is frozen.
#[must_use]
pub fn host_client_argv(
    client_bin: &str,
    runtime: &str,
    socket: &str,
    slot: u8,
    diag: &str,
) -> Option<Vec<String>> {
    if !(1..=3).contains(&slot) {
        return None;
    }
    let v = vec![
        client_bin.to_owned(),
        "--host".to_owned(),
        "--runtime".to_owned(),
        runtime.to_owned(),
        "--socket".to_owned(),
        socket.to_owned(),
        "--slot".to_owned(),
        slot.to_string(),
        "--diag".to_owned(),
        diag.to_owned(),
    ];
    if v.len() != EXPECTED_HOST_CLIENT_ARGC {
        return None;
    }
    Some(v)
}

/// Bounded first-map probe over diagnostic file content. Looks only for the
/// exact `"event":"first-map"` marker; never parses paths.
#[must_use]
pub fn diag_contains_first_map(text: &str) -> bool {
    if text.len() > MAX_SUP_FILE_BYTES {
        return false;
    }
    text.contains(r#""event":"first-map""#)
}

#[must_use]
pub const fn all_ready(flags: [bool; 3]) -> bool {
    flags[0] && flags[1] && flags[2]
}

/// Bounded redacted supervisor events. No path or env content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SupEvent {
    Connect,
    Spawn { slot: u8 },
    FirstMap { slot: u8 },
    Ready,
    Exit { reason: &'static str },
    ProtocolError { kind: &'static str },
}

#[must_use]
pub fn format_sup_event(seq: u64, event: &SupEvent) -> Option<String> {
    if seq > 999_999 {
        return None;
    }
    let text = match event {
        SupEvent::Connect => format!(r#"{{"seq":{seq},"event":"connect"}}"#),
        SupEvent::Spawn { slot } => {
            if !(1..=3).contains(slot) {
                return None;
            }
            format!(r#"{{"seq":{seq},"event":"spawn","slot":{slot}}}"#)
        }
        SupEvent::FirstMap { slot } => {
            if !(1..=3).contains(slot) {
                return None;
            }
            format!(r#"{{"seq":{seq},"event":"first-map","slot":{slot}}}"#)
        }
        SupEvent::Ready => format!(r#"{{"seq":{seq},"event":"ready"}}"#),
        SupEvent::Exit { reason } => {
            if !matches!(*reason, "ready" | "signal" | "protocol-error" | "error") {
                return None;
            }
            format!(r#"{{"seq":{seq},"event":"exit","reason":"{reason}"}}"#)
        }
        SupEvent::ProtocolError { kind } => {
            if !matches!(*kind, "early-exit" | "timeout" | "protocol-error") {
                return None;
            }
            format!(r#"{{"seq":{seq},"event":"protocol-error","kind":"{kind}"}}"#)
        }
    };
    if text.len() > MAX_SUP_EVENT_BYTES {
        return None;
    }
    Some(text)
}

/// Manifest keys for the exact identity-bound supervisor record. All-or-nothing.
#[must_use]
pub const fn supervisor_manifest_keys() -> [&'static str; 9] {
    [
        "diag_supervisor_bin",
        "diag_supervisor_bin_canonical",
        "diag_supervisor_bin_sha256",
        "diag_supervisor_bin_dev",
        "diag_supervisor_bin_ino",
        "diag_supervisor_pid",
        "diag_supervisor_starttick",
        "diag_supervisor_exe",
        "diag_supervisor_diag_path",
    ]
}

/// Pure completeness check: all nine supervisor keys present with non-empty
/// values. Live tick/exe binding is verified by the shell via /proc.
#[must_use]
pub fn is_complete_supervisor_group(map: &BTreeMap<String, String>) -> bool {
    for k in supervisor_manifest_keys() {
        match map.get(k) {
            Some(v) if !v.is_empty() => {}
            _ => return false,
        }
    }
    true
}

/// Parse a bounded pid-file (`slot=N pid=P` lines, exactly 3 distinct PIDs).
pub fn parse_pidfile(text: &str) -> Option<[u32; 3]> {
    if text.len() > MAX_PID_FILE_BYTES {
        return None;
    }
    let mut slots: [Option<u32>; 4] = [None, None, None, None];
    let mut lines = 0;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        lines += 1;
        if lines > 4 {
            return None;
        }
        let (k, v) = line.split_once('=')?;
        let slot: usize = match k {
            "slot-1" => 1,
            "slot-2" => 2,
            "slot-3" => 3,
            _ => return None,
        };
        let pid: u32 = v.parse().ok()?;
        if pid == 0 {
            return None;
        }
        if slots[slot].is_some() {
            return None;
        }
        slots[slot] = Some(pid);
    }
    let (a, b, c) = (slots[1]?, slots[2]?, slots[3]?);
    if a == b || a == c || b == c {
        return None;
    }
    Some([a, b, c])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clean(_: &str) -> Option<String> {
        None
    }

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(ToString::to_string).collect()
    }

    fn valid() -> Vec<String> {
        argv(&[
            "poc3-diag-supervisor",
            "--runtime",
            "/tmp/poc3-wd/runtime",
            "--socket",
            "nested-poc3",
            "--client-bin",
            "/tmp/poc3-wd/poc3-diagnostic-client",
            "--client-sha256",
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "--client-dev",
            "1",
            "--client-ino",
            "2",
            "--workdir",
            "/tmp/poc3-wd",
        ])
    }

    #[test]
    fn accepts_explicit_valid_target() {
        let cfg = parse_supervisor_args(&valid(), 1000, &clean).expect("valid");
        assert_eq!(cfg.timeout_secs, READY_TIMEOUT_DEFAULT_SECS);
        assert_eq!(cfg.socket_name, "nested-poc3");
    }

    #[test]
    fn rejects_missing_unknown_and_bad_client() {
        assert_eq!(
            parse_supervisor_args(&argv(&["bin"]), 1000, &clean).unwrap_err(),
            SupCliError::MissingArg
        );
        assert_eq!(
            parse_supervisor_args(&argv(&["bin", "--bogus", "x"]), 1000, &clean).unwrap_err(),
            SupCliError::UnknownArg
        );
        let mut bad = valid();
        bad[6] = "/tmp/poc3-wd/konsole".to_owned();
        assert_eq!(
            parse_supervisor_args(&bad, 1000, &clean).unwrap_err(),
            SupCliError::BadValue
        );
    }

    #[test]
    fn refuses_host_default_and_ambient() {
        let ambient = |k: &str| match k {
            "XDG_RUNTIME_DIR" => Some("/run/user/1000".to_owned()),
            _ => None,
        };
        assert_eq!(
            parse_supervisor_args(&valid(), 1000, &ambient).unwrap_err(),
            SupCliError::AmbientTarget
        );
        let mut host = valid();
        host[2] = "/run/user/1000".to_owned();
        assert_eq!(
            parse_supervisor_args(&host, 1000, &clean).unwrap_err(),
            SupCliError::HostTarget
        );
        let mut def = valid();
        def[4] = "wayland-0".to_owned();
        assert_eq!(
            parse_supervisor_args(&def, 1000, &clean).unwrap_err(),
            SupCliError::DefaultTarget
        );
    }

    #[test]
    fn timeout_is_bounded() {
        let mut t = valid();
        t.extend(argv(&["--timeout-secs", "0"]));
        assert!(parse_supervisor_args(&t, 1000, &clean).is_err());
        let mut t2 = valid();
        t2.extend(argv(&["--timeout-secs", "999"]));
        assert!(parse_supervisor_args(&t2, 1000, &clean).is_err());
        let mut t3 = valid();
        t3.extend(argv(&["--timeout-secs", "5"]));
        assert_eq!(
            parse_supervisor_args(&t3, 1000, &clean)
                .expect("t")
                .timeout_secs,
            5
        );
    }

    #[test]
    fn standard_descriptors_are_documented() {
        assert!(should_preserve_fd(0));
        assert!(should_preserve_fd(1));
        assert!(should_preserve_fd(2));
        assert!(!should_preserve_fd(3));
        assert!(!should_preserve_fd(9));
        assert!(!should_preserve_fd(255));
        assert_eq!(fds_to_close(&[0, 1, 2, 3, 9]), vec![3, 9]);
        assert!(fds_to_close(&[0, 1, 2]).is_empty());
    }

    #[test]
    fn client_argv_is_exact_nine() {
        let v = client_argv(
            "BIN",
            "/tmp/w/runtime",
            "nested-0",
            2,
            "/tmp/w/manual-2.diag.log",
        )
        .expect("argv");
        assert_eq!(v.len(), EXPECTED_CLIENT_ARGC);
        assert_eq!(v[0], "BIN");
        assert!(client_argv("BIN", "/tmp/w/runtime", "nested-0", 9, "/tmp/w/d").is_none());
    }

    #[test]
    fn readiness_marker_is_bounded() {
        assert!(diag_contains_first_map(
            r#"{"seq":1,"event":"first-map","width":320}"#
        ));
        assert!(!diag_contains_first_map(r#"{"seq":1,"event":"configure"}"#));
        assert!(!diag_contains_first_map(
            &"x".repeat(MAX_SUP_FILE_BYTES + 1)
        ));
        assert!(all_ready([true, true, true]));
        assert!(!all_ready([true, false, true]));
    }

    #[test]
    fn supervisor_events_are_bounded_and_redacted() {
        let text = format_sup_event(1, &SupEvent::Spawn { slot: 1 }).expect("e");
        assert!(text.len() <= MAX_SUP_EVENT_BYTES);
        assert!(!text.contains("/tmp/secret"));
        assert!(format_sup_event(1, &SupEvent::Spawn { slot: 9 }).is_none());
        assert!(format_sup_event(1, &SupEvent::Exit { reason: "bogus" }).is_none());
        assert!(format_sup_event(1_000_000, &SupEvent::Ready).is_none());
    }

    #[test]
    fn supervisor_group_completeness() {
        let mut m = BTreeMap::new();
        assert!(!is_complete_supervisor_group(&m));
        for k in supervisor_manifest_keys() {
            m.insert(k.to_owned(), "x".to_owned());
        }
        assert!(is_complete_supervisor_group(&m));
        m.remove("diag_supervisor_pid");
        assert!(!is_complete_supervisor_group(&m));
    }

    #[test]
    fn pidfile_parsing_requires_three_distinct() {
        assert_eq!(
            parse_pidfile("slot-1=100\nslot-2=200\nslot-3=300\n"),
            Some([100, 200, 300])
        );
        assert_eq!(parse_pidfile("slot-1=100\nslot-2=100\nslot-3=300\n"), None);
        assert_eq!(parse_pidfile("slot-1=100\nslot-2=200\n"), None);
        assert_eq!(parse_pidfile("slot-1=0\nslot-2=200\nslot-3=300\n"), None);
    }

    #[test]
    fn unbound_direct_spawn_is_rejected() {
        // Missing manifest-derived identity flags must fail closed.
        let mut missing = argv(&[
            "poc3-diag-supervisor",
            "--runtime",
            "/tmp/poc3-wd/runtime",
            "--socket",
            "nested-poc3",
            "--client-bin",
            "/tmp/poc3-wd/poc3-diagnostic-client",
            "--workdir",
            "/tmp/poc3-wd",
        ]);
        assert_eq!(
            parse_supervisor_args(&missing, 1000, &clean).unwrap_err(),
            SupCliError::MissingArg
        );
        // Malformed identity values fail closed.
        let mut bad_sha = valid();
        let pos = bad_sha
            .iter()
            .position(|a| a == "--client-sha256")
            .expect("sha");
        bad_sha[pos + 1] = "not-hex".to_owned();
        assert_eq!(
            parse_supervisor_args(&bad_sha, 1000, &clean).unwrap_err(),
            SupCliError::BadValue
        );
        let mut bad_ino = valid();
        let pos = bad_ino
            .iter()
            .position(|a| a == "--client-ino")
            .expect("ino");
        bad_ino[pos + 1] = "0".to_owned();
        assert_eq!(
            parse_supervisor_args(&bad_ino, 1000, &clean).unwrap_err(),
            SupCliError::BadValue
        );
        // Bound identity parses.
        let cfg = parse_supervisor_args(&valid(), 1000, &clean).expect("bound");
        assert_eq!(cfg.client_dev, 1);
        assert_eq!(cfg.client_ino, 2);
        assert_eq!(
            cfg.client_sha256,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        let _ = &mut missing;
    }

    #[test]
    fn enumeration_fd_target_is_never_closed() {
        let pid = 1234;
        assert!(is_proc_fd_enumeration_target("/proc/self/fd", pid));
        assert!(is_proc_fd_enumeration_target("/proc/1234/fd", pid));
        assert!(!is_proc_fd_enumeration_target("/proc/1234/fd/3", pid));
        assert!(!is_proc_fd_enumeration_target("/dev/null", pid));
        assert!(!is_proc_fd_enumeration_target("/proc/9999/fd", pid));
        // Standard filter still applies alongside the enumeration guard.
        assert_eq!(fds_to_close(&[0, 1, 2, 3]), vec![3]);
    }

    fn host_valid() -> Vec<String> {
        argv(&[
            "poc3-diag-supervisor",
            "--host",
            "--runtime",
            "/run/user/1000",
            "--socket",
            "wayland-0",
            "--client-bin",
            "/tmp/w/poc3-diagnostic-client",
            "--client-sha256",
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "--client-dev",
            "1",
            "--client-ino",
            "2",
            "--workdir",
            "/run/user/1000/plasma-auto-tiler-host-pilot",
        ])
    }

    fn host_with_client_bin(bin: &str, sha: &str) -> Vec<String> {
        let mut v = host_valid();
        let pos = v.iter().position(|a| a == "--client-bin").expect("bin");
        v[pos + 1] = bin.to_owned();
        let pos = v.iter().position(|a| a == "--client-sha256").expect("sha");
        v[pos + 1] = sha.to_owned();
        v
    }

    #[test]
    fn host_accepts_regular_unsuffixed_client() {
        let cfg = parse_host_supervisor_args(&host_valid(), 1000, &clean).expect("regular");
        assert_eq!(cfg.client_bin, "/tmp/w/poc3-diagnostic-client");
    }

    #[test]
    fn host_accepts_exact_current_uid_frozen_client() {
        let sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let frozen =
            format!("/run/user/1000/plasma-auto-tiler-host-frozen/poc3-diagnostic-client-{sha}");
        let cfg = parse_host_supervisor_args(&host_with_client_bin(&frozen, sha), 1000, &clean)
            .expect("frozen");
        assert_eq!(cfg.client_bin, frozen);
        assert_eq!(cfg.client_sha256, sha);
    }

    #[test]
    fn host_rejects_frozen_mismatch_and_generic_suffix() {
        let sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        // Wrong UID.
        let wrong_uid =
            format!("/run/user/1001/plasma-auto-tiler-host-frozen/poc3-diagnostic-client-{sha}");
        assert_eq!(
            parse_host_supervisor_args(&host_with_client_bin(&wrong_uid, sha), 1000, &clean)
                .unwrap_err(),
            SupCliError::BadValue
        );
        // SHA suffix mismatch.
        let other = "c8750208df8b37ad9d1179183ff736a8e446af5c9b8ea87b4c17d00aeef866b7";
        let mismatch =
            format!("/run/user/1000/plasma-auto-tiler-host-frozen/poc3-diagnostic-client-{other}");
        assert_eq!(
            parse_host_supervisor_args(&host_with_client_bin(&mismatch, sha), 1000, &clean)
                .unwrap_err(),
            SupCliError::BadValue
        );
        // Generic copy path with matching suffix outside the frozen dir.
        let generic = format!("/tmp/w/poc3-diagnostic-client-{sha}");
        assert_eq!(
            parse_host_supervisor_args(&host_with_client_bin(&generic, sha), 1000, &clean)
                .unwrap_err(),
            SupCliError::BadValue
        );
        // Wrong frozen dir prefix.
        let wrong_dir = format!("/run/user/1000/other-frozen/poc3-diagnostic-client-{sha}");
        assert_eq!(
            parse_host_supervisor_args(&host_with_client_bin(&wrong_dir, sha), 1000, &clean)
                .unwrap_err(),
            SupCliError::BadValue
        );
        // Uppercase SHA refuses frozen form.
        let upper = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855";
        let frozen_upper =
            format!("/run/user/1000/plasma-auto-tiler-host-frozen/poc3-diagnostic-client-{upper}");
        assert_eq!(
            parse_host_supervisor_args(&host_with_client_bin(&frozen_upper, upper), 1000, &clean)
                .unwrap_err(),
            SupCliError::BadValue
        );
        // Plain wrong basename still refused.
        let mut bad = host_valid();
        let pos = bad.iter().position(|a| a == "--client-bin").expect("bin");
        bad[pos + 1] = "/tmp/w/konsole".to_owned();
        assert_eq!(
            parse_host_supervisor_args(&bad, 1000, &clean).unwrap_err(),
            SupCliError::BadValue
        );
    }

    #[test]
    fn host_frozen_preserves_scope_gates() {
        let sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let frozen =
            format!("/run/user/1000/plasma-auto-tiler-host-frozen/poc3-diagnostic-client-{sha}");
        // Nested runtime still refused even with frozen client.
        let mut nested = host_with_client_bin(&frozen, sha);
        let pos = nested.iter().position(|a| a == "--runtime").expect("rt");
        nested[pos + 1] = "/tmp/w/runtime".to_owned();
        assert!(parse_host_supervisor_args(&nested, 1000, &clean).is_err());
        // Nested socket still refused even with frozen client.
        let mut nested_sock = host_with_client_bin(&frozen, sha);
        let pos = nested_sock
            .iter()
            .position(|a| a == "--socket")
            .expect("sock");
        nested_sock[pos + 1] = "nested-poc3".to_owned();
        assert!(parse_host_supervisor_args(&nested_sock, 1000, &clean).is_err());
    }
}
