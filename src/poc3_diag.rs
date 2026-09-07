//! POC3 raw xdg-shell diagnostic client: pure/test-only logic.
//!
//! Explicitly diagnostic/test-only. No toolkit, font, text, input,
//! decoration, persistence, IPC, async runtime, or shared engine coupling.
//! The live Wayland path lives in `src/bin/poc3-diagnostic-client.rs`; this
//! module holds only the pure state/CLI/buffer/diagnostic logic testable
//! without a compositor. Diagnostic events and errors never emit user
//! path or environment content.

use std::collections::BTreeSet;

/// Bounded path length for runtime/socket/diag/manifest values.
pub const MAX_PATH_LEN: usize = 1024;
/// Bounded socket-name length.
pub const MAX_SOCKET_NAME_LEN: usize = 128;
/// Bounded manifest file size.
pub const MAX_MANIFEST_BYTES: usize = 8192;
/// Bounded single diagnostic event size.
pub const MAX_DIAG_EVENT_BYTES: usize = 1024;
/// Bounded diagnostic file size (append stops after this).
pub const MAX_DIAG_FILE_BYTES: usize = 65536;
/// Maximum configure dimension accepted for SHM buffers.
pub const MAX_CONFIG_DIM: i32 = 2048;
/// Maximum SHM buffer size in bytes (2048*2048*4).
pub const MAX_BUFFER_BYTES: usize = 16 * 1024 * 1024;
/// Maximum live SHM backing stores held (current plus retained until
/// release). Small explicit diagnostic bound so repeated different
/// unreleased configures refuse instead of growing unboundedly.
pub const MAX_LIVE_BUFFERS: usize = 4;
/// Maximum xdg_toplevel state count accepted per configure.
pub const MAX_CONFIG_STATES: usize = 8;
/// Fallback initial size when the compositor sends 0x0.
pub const FALLBACK_WIDTH: i32 = 320;
pub const FALLBACK_HEIGHT: i32 = 240;
/// Bytes per ARGB pixel.
pub const BYTES_PER_PIXEL: usize = 4;

/// Fixed per-slot identity. Distinct title/app_id/color/marker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SlotDesc {
    pub slot: u8,
    pub title: &'static str,
    pub app_id: &'static str,
    pub argb: u32,
    pub marker: &'static str,
}

/// Bounded distinct slot descriptors for slots 1..=3.
#[must_use]
pub const fn slot_desc(slot: u8) -> Option<SlotDesc> {
    match slot {
        1 => Some(SlotDesc {
            slot: 1,
            title: "poc3-diag-1",
            app_id: "org.plasma-auto-tiler.poc3-diag-1",
            argb: 0xFF_C0_20_20,
            marker: "slot-1-bar",
        }),
        2 => Some(SlotDesc {
            slot: 2,
            title: "poc3-diag-2",
            app_id: "org.plasma-auto-tiler.poc3-diag-2",
            argb: 0xFF_20_A0_20,
            marker: "slot-2-bars",
        }),
        3 => Some(SlotDesc {
            slot: 3,
            title: "poc3-diag-3",
            app_id: "org.plasma-auto-tiler.poc3-diag-3",
            argb: 0xFF_20_40_C0,
            marker: "slot-3-bars",
        }),
        _ => None,
    }
}

/// Validated diagnostic target. All values are bounded; no ambient fallback.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiagConfig {
    pub runtime_dir: String,
    pub socket_name: String,
    pub slot: u8,
    pub diag_path: String,
}

/// Fixed CLI failure kinds. Messages never echo user input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliError {
    MissingArg,
    MixedRoute,
    UnknownArg,
    BadValue,
    BadSlot,
    AmbientTarget,
    HostTarget,
    DefaultTarget,
    ManifestTooLarge,
    ManifestMalformed,
}

impl CliError {
    #[must_use]
    pub const fn kind(self) -> &'static str {
        match self {
            Self::MissingArg => "missing-arg",
            Self::MixedRoute => "mixed-route",
            Self::UnknownArg => "unknown-arg",
            Self::BadValue => "bad-value",
            Self::BadSlot => "bad-slot",
            Self::AmbientTarget => "ambient-target",
            Self::HostTarget => "host-target",
            Self::DefaultTarget => "default-target",
            Self::ManifestTooLarge => "manifest-too-large",
            Self::ManifestMalformed => "manifest-malformed",
        }
    }

    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::MissingArg => "explicit target is missing",
            Self::MixedRoute => "explicit and manifest routes must not mix",
            Self::UnknownArg => "unknown argument",
            Self::BadValue => "target value is invalid",
            Self::BadSlot => "slot must be exactly 1, 2, or 3",
            Self::AmbientTarget => "ambient or default target is refused",
            Self::HostTarget => "host target is refused",
            Self::DefaultTarget => "default target is refused",
            Self::ManifestTooLarge => "manifest exceeds size bound",
            Self::ManifestMalformed => "manifest is malformed",
        }
    }
}

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "error: {} ({})", self.message(), self.kind())
    }
}

fn is_ambient_set(get_env: &dyn Fn(&str) -> Option<String>) -> bool {
    for key in ["WAYLAND_DISPLAY", "WAYLAND_SOCKET", "XDG_RUNTIME_DIR"] {
        if let Some(value) = get_env(key)
            && !value.is_empty()
        {
            return true;
        }
    }
    false
}

fn valid_path_syntax(value: &str) -> bool {
    if value.is_empty() || value.len() > MAX_PATH_LEN {
        return false;
    }
    if !value.starts_with('/') {
        return false;
    }
    if value.contains("//")
        || value.contains("/../")
        || value.contains('\0')
        || value.contains('\n')
    {
        return false;
    }
    if value.ends_with("/..") || value.ends_with("/.") {
        return false;
    }
    if value.len() > 1 && value.ends_with('/') {
        return false;
    }
    true
}

fn valid_socket_name(value: &str) -> bool {
    if value.is_empty() || value.len() > MAX_SOCKET_NAME_LEN {
        return false;
    }
    if value.contains('/') || value.contains('\0') || value.contains('\n') {
        return false;
    }
    value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
}

fn is_default_socket(name: &str) -> bool {
    if let Some(rest) = name.strip_prefix("wayland-") {
        !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit())
    } else {
        false
    }
}

fn is_host_runtime(runtime: &str, uid: u32) -> bool {
    if matches!(runtime, "/" | "/tmp" | "/run" | "/run/user") {
        return true;
    }
    let mut expected = [0u8; 32];
    let prefix = b"/run/user/";
    let digits = uid_to_decimal(uid, &mut expected);
    let mut full = [0u8; 64];
    full[..prefix.len()].copy_from_slice(prefix);
    full[prefix.len()..prefix.len() + digits].copy_from_slice(&expected[..digits]);
    let len = prefix.len() + digits;
    runtime.as_bytes() == &full[..len]
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

fn validate_target(
    runtime: &str,
    socket: &str,
    slot: u8,
    diag: &str,
    uid: u32,
) -> Result<(), CliError> {
    if !valid_path_syntax(runtime) || !valid_path_syntax(diag) {
        return Err(CliError::BadValue);
    }
    if diag == "/" {
        return Err(CliError::BadValue);
    }
    if !valid_socket_name(socket) {
        return Err(CliError::BadValue);
    }
    if slot_desc(slot).is_none() {
        return Err(CliError::BadSlot);
    }
    if is_host_runtime(runtime, uid) {
        return Err(CliError::HostTarget);
    }
    if is_default_socket(socket) {
        return Err(CliError::DefaultTarget);
    }
    // Joined socket path must fit sun_path and path bounds.
    if runtime.len() + 1 + socket.len() > MAX_PATH_LEN {
        return Err(CliError::BadValue);
    }
    Ok(())
}

/// Split `--flag value` / `--flag=value` arguments.
fn take_flag_value(flag: &str, arg: &str, next: Option<&str>) -> Result<(String, usize), CliError> {
    if let Some(rest) = arg.strip_prefix(&format!("{flag}=")) {
        if rest.is_empty() {
            return Err(CliError::MissingArg);
        }
        return Ok((rest.to_owned(), 1));
    }
    if arg == flag {
        let value = next.filter(|v| !v.is_empty()).ok_or(CliError::MissingArg)?;
        return Ok((value.to_owned(), 2));
    }
    Err(CliError::UnknownArg)
}

/// Strict CLI: either all of `--runtime/--socket/--slot/--diag` or exactly
/// `--manifest PATH`. No defaults, no ambient fallback, no host target.
pub fn parse_args(
    argv: &[String],
    uid: u32,
    get_env: &dyn Fn(&str) -> Option<String>,
) -> Result<DiagConfig, CliError> {
    if is_ambient_set(get_env) {
        return Err(CliError::AmbientTarget);
    }
    let mut runtime: Option<String> = None;
    let mut socket: Option<String> = None;
    let mut slot: Option<u8> = None;
    let mut diag: Option<String> = None;
    let mut manifest: Option<String> = None;
    let mut i = 0;
    let args = if argv.first().is_some_and(|a| !a.starts_with("--")) {
        &argv[1..]
    } else {
        argv
    };
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
        } else if arg == "--slot" || arg.starts_with("--slot=") {
            let (v, n) = take_flag_value("--slot", arg, next).map_err(|e| match e {
                CliError::MissingArg => CliError::BadSlot,
                other => other,
            })?;
            let parsed: u32 = v.parse().map_err(|_| CliError::BadSlot)?;
            if !(1..=3).contains(&parsed) {
                return Err(CliError::BadSlot);
            }
            slot = Some(parsed as u8);
            i += n;
        } else if arg == "--diag" || arg.starts_with("--diag=") {
            let (v, n) = take_flag_value("--diag", arg, next)?;
            diag = Some(v);
            i += n;
        } else if arg == "--manifest" || arg.starts_with("--manifest=") {
            let (v, n) = take_flag_value("--manifest", arg, next)?;
            manifest = Some(v);
            i += n;
        } else {
            return Err(CliError::UnknownArg);
        }
    }
    if let Some(path) = manifest {
        if runtime.is_some() || socket.is_some() || slot.is_some() || diag.is_some() {
            return Err(CliError::MixedRoute);
        }
        if !valid_path_syntax(&path) {
            return Err(CliError::BadValue);
        }
        // Content validation happens in parse_manifest_text after the caller
        // reads the bounded file; here we only prove the route was selected.
        return Err(CliError::MissingArg);
    }
    let (runtime, socket, slot, diag) = match (runtime, socket, slot, diag) {
        (Some(r), Some(s), Some(n), Some(d)) => (r, s, n, d),
        _ => return Err(CliError::MissingArg),
    };
    validate_target(&runtime, &socket, slot, &diag, uid)?;
    Ok(DiagConfig {
        runtime_dir: runtime,
        socket_name: socket,
        slot,
        diag_path: diag,
    })
}

/// Host-scope client target (additive; nested `parse_args` is frozen).
/// Selected only with an explicit `--host` flag. Requires
/// `--runtime/--socket/--slot/--diag` plus `--host`, inverts the scope gate
/// (runtime must be exactly the host `/run/user/<uid>`, socket must be a
/// default `wayland-N` display), and refuses ambient env, nested targets,
/// and incorrect scope fail-closed. No manifest route, no defaults.
pub fn parse_host_args(
    argv: &[String],
    uid: u32,
    get_env: &dyn Fn(&str) -> Option<String>,
) -> Result<DiagConfig, CliError> {
    if is_ambient_set(get_env) {
        return Err(CliError::AmbientTarget);
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
                return Err(CliError::UnknownArg);
            }
            host = true;
        } else {
            rest.push(a.clone());
        }
    }
    if !host {
        return Err(CliError::MissingArg);
    }
    let mut runtime: Option<String> = None;
    let mut socket: Option<String> = None;
    let mut slot: Option<u8> = None;
    let mut diag: Option<String> = None;
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
        } else if arg == "--slot" || arg.starts_with("--slot=") {
            let (v, n) = take_flag_value("--slot", arg, next).map_err(|e| match e {
                CliError::MissingArg => CliError::BadSlot,
                other => other,
            })?;
            let parsed: u32 = v.parse().map_err(|_| CliError::BadSlot)?;
            if !(1..=3).contains(&parsed) {
                return Err(CliError::BadSlot);
            }
            slot = Some(parsed as u8);
            i += n;
        } else if arg == "--diag" || arg.starts_with("--diag=") {
            let (v, n) = take_flag_value("--diag", arg, next)?;
            diag = Some(v);
            i += n;
        } else {
            return Err(CliError::UnknownArg);
        }
    }
    let (runtime, socket, slot, diag) = match (runtime, socket, slot, diag) {
        (Some(r), Some(s), Some(n), Some(d)) => (r, s, n, d),
        _ => return Err(CliError::MissingArg),
    };
    validate_host_target(&runtime, &socket, slot, &diag, uid)?;
    Ok(DiagConfig {
        runtime_dir: runtime,
        socket_name: socket,
        slot,
        diag_path: diag,
    })
}

fn validate_host_target(
    runtime: &str,
    socket: &str,
    slot: u8,
    diag: &str,
    uid: u32,
) -> Result<(), CliError> {
    // Same syntax bounds as nested validate_target, with the scope gate
    // inverted: host requires the host runtime plus a default display.
    if !valid_path_syntax(runtime) || !valid_path_syntax(diag) {
        return Err(CliError::BadValue);
    }
    if diag == "/" {
        return Err(CliError::BadValue);
    }
    if !valid_socket_name(socket) {
        return Err(CliError::BadValue);
    }
    if slot_desc(slot).is_none() {
        return Err(CliError::BadSlot);
    }
    if !is_host_runtime(runtime, uid) {
        return Err(CliError::HostTarget);
    }
    if !is_default_socket(socket) {
        return Err(CliError::DefaultTarget);
    }
    if runtime.len() + 1 + socket.len() > MAX_PATH_LEN {
        return Err(CliError::BadValue);
    }
    Ok(())
}

/// Validate bounded manifest text (`key=value` lines for exactly
/// runtime/socket/slot/diag) into a target. Never echoes values on error.
pub fn parse_manifest_text(
    text: &str,
    uid: u32,
    get_env: &dyn Fn(&str) -> Option<String>,
) -> Result<DiagConfig, CliError> {
    if is_ambient_set(get_env) {
        return Err(CliError::AmbientTarget);
    }
    if text.len() > MAX_MANIFEST_BYTES {
        return Err(CliError::ManifestTooLarge);
    }
    let mut runtime: Option<String> = None;
    let mut socket: Option<String> = None;
    let mut slot: Option<u8> = None;
    let mut diag: Option<String> = None;
    let mut seen = BTreeSet::new();
    let mut lines = 0;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        lines += 1;
        if lines > 16 {
            return Err(CliError::ManifestMalformed);
        }
        let (key, value) = line.split_once('=').ok_or(CliError::ManifestMalformed)?;
        if value.is_empty() || value.len() > MAX_PATH_LEN {
            return Err(CliError::ManifestMalformed);
        }
        if !seen.insert(key.to_owned()) {
            return Err(CliError::ManifestMalformed);
        }
        match key {
            "runtime" => runtime = Some(value.to_owned()),
            "socket" => socket = Some(value.to_owned()),
            "slot" => {
                let parsed: u32 = value.parse().map_err(|_| CliError::ManifestMalformed)?;
                if !(1..=3).contains(&parsed) {
                    return Err(CliError::BadSlot);
                }
                slot = Some(parsed as u8);
            }
            "diag" => diag = Some(value.to_owned()),
            _ => return Err(CliError::ManifestMalformed),
        }
    }
    let (runtime, socket, slot, diag) = match (runtime, socket, slot, diag) {
        (Some(r), Some(s), Some(n), Some(d)) => (r, s, n, d),
        _ => return Err(CliError::ManifestMalformed),
    };
    validate_target(&runtime, &socket, slot, &diag, uid).map_err(|e| match e {
        CliError::BadSlot => CliError::BadSlot,
        CliError::HostTarget => CliError::HostTarget,
        CliError::DefaultTarget => CliError::DefaultTarget,
        _ => CliError::ManifestMalformed,
    })?;
    Ok(DiagConfig {
        runtime_dir: runtime,
        socket_name: socket,
        slot,
        diag_path: diag,
    })
}

/// Map an initial compositor 0x0 configure size to the bounded fallback.
/// Initial-only helper: [`DiagLifecycle::on_configure`] retains the latest
/// positive requested size once one exists and only uses this fallback when
/// no valid positive pair has been seen yet.
#[must_use]
pub const fn effective_size(width: i32, height: i32) -> (i32, i32) {
    (
        if width == 0 { FALLBACK_WIDTH } else { width },
        if height == 0 { FALLBACK_HEIGHT } else { height },
    )
}

/// Overflow-safe SHM buffer byte count for ARGB8888.
pub fn buffer_bytes(width: i32, height: i32) -> Result<usize, &'static str> {
    if width <= 0 || height <= 0 {
        return Err("buffer-dimensions");
    }
    if width > MAX_CONFIG_DIM || height > MAX_CONFIG_DIM {
        return Err("buffer-dimensions");
    }
    let bytes = (width as usize)
        .checked_mul(height as usize)
        .and_then(|p| p.checked_mul(BYTES_PER_PIXEL))
        .ok_or("buffer-overflow")?;
    if bytes > MAX_BUFFER_BYTES {
        return Err("buffer-overflow");
    }
    Ok(bytes)
}

/// Fill an ARGB8888 buffer with the slot base color plus a simple distinct
/// visual marker: white inset border plus `slot` white bars top-left.
pub fn draw_slot(width: u32, height: u32, slot: u8, out: &mut [u8]) -> Result<(), &'static str> {
    let desc = slot_desc(slot).ok_or("bad-slot")?;
    let expect = (width as usize)
        .checked_mul(height as usize)
        .and_then(|p| p.checked_mul(BYTES_PER_PIXEL))
        .ok_or("buffer-overflow")?;
    if out.len() != expect {
        return Err("buffer-length");
    }
    let base = desc.argb.to_le_bytes();
    for chunk in out.chunks_exact_mut(4) {
        chunk.copy_from_slice(&base);
    }
    let white = [0xFF, 0xFF, 0xFF, 0xFF];
    let stride = width as usize * BYTES_PER_PIXEL;
    // Inset 2px border.
    for y in 0..height as usize {
        for x in 0..width as usize {
            let border = x < 2 || y < 2 || x >= width as usize - 2 || y >= height as usize - 2;
            if border {
                let off = y * stride + x * BYTES_PER_PIXEL;
                out[off..off + 4].copy_from_slice(&white);
            }
        }
    }
    // Slot-count bars: 12x12 white squares with 4px gaps from (8,8).
    for bar in 0..slot as usize {
        for dy in 0..12usize {
            for dx in 0..12usize {
                let x = 8 + bar * 16 + dx;
                let y = 8 + dy;
                if x < width as usize && y < height as usize {
                    let off = y * stride + x * BYTES_PER_PIXEL;
                    out[off..off + 4].copy_from_slice(&white);
                }
            }
        }
    }
    Ok(())
}

/// Bounded structured diagnostic events. No path or env content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiagEvent {
    Connect {
        slot: u8,
    },
    Globals {
        compositor: bool,
        shm: bool,
        xdg: bool,
    },
    Configure {
        serial: u32,
        width: i32,
        height: i32,
        states: usize,
    },
    FirstMap {
        width: i32,
        height: i32,
    },
    Close,
    ProtocolError {
        kind: &'static str,
    },
    Exit {
        reason: &'static str,
    },
}

impl DiagEvent {
    #[must_use]
    pub const fn name(&self) -> &'static str {
        match self {
            Self::Connect { .. } => "connect",
            Self::Globals { .. } => "globals",
            Self::Configure { .. } => "configure",
            Self::FirstMap { .. } => "first-map",
            Self::Close => "close",
            Self::ProtocolError { .. } => "protocol-error",
            Self::Exit { .. } => "exit",
        }
    }
}

/// Format one JSON-line event bounded to [`MAX_DIAG_EVENT_BYTES`].
/// Returns `None` when the rendering would exceed the bound.
#[must_use]
pub fn format_event(seq: u64, event: &DiagEvent) -> Option<String> {
    if seq > 999_999 {
        return None;
    }
    let text = match event {
        DiagEvent::Connect { slot } => {
            slot_desc(*slot)?;
            format!(r#"{{"seq":{seq},"event":"connect","slot":{slot}}}"#)
        }
        DiagEvent::Globals {
            compositor,
            shm,
            xdg,
        } => format!(
            r#"{{"seq":{seq},"event":"globals","compositor":{compositor},"shm":{shm},"xdg":{xdg}}}"#
        ),
        DiagEvent::Configure {
            serial,
            width,
            height,
            states,
        } => {
            if *serial == 0 || *states > MAX_CONFIG_STATES {
                return None;
            }
            if !(0..=MAX_CONFIG_DIM).contains(width) || !(0..=MAX_CONFIG_DIM).contains(height) {
                return None;
            }
            format!(
                r#"{{"seq":{seq},"event":"configure","serial":{serial},"width":{width},"height":{height},"states":{states}}}"#
            )
        }
        DiagEvent::FirstMap { width, height } => {
            if !(1..=MAX_CONFIG_DIM).contains(width) || !(1..=MAX_CONFIG_DIM).contains(height) {
                return None;
            }
            format!(r#"{{"seq":{seq},"event":"first-map","width":{width},"height":{height}}}"#)
        }
        DiagEvent::Close => format!(r#"{{"seq":{seq},"event":"close"}}"#),
        DiagEvent::ProtocolError { kind } => {
            if !matches!(
                *kind,
                "missing-global"
                    | "shm-unavailable"
                    | "protocol-error"
                    | "buffer-overflow"
                    | "dispatch-failure"
            ) {
                return None;
            }
            format!(r#"{{"seq":{seq},"event":"protocol-error","kind":"{kind}"}}"#)
        }
        DiagEvent::Exit { reason } => {
            if !matches!(
                *reason,
                "close" | "signal" | "protocol-error" | "cleanup" | "error"
            ) {
                return None;
            }
            format!(r#"{{"seq":{seq},"event":"exit","reason":"{reason}"}}"#)
        }
    };
    if text.len() > MAX_DIAG_EVENT_BYTES {
        return None;
    }
    Some(text)
}

/// Pure lifecycle: enforces configure-before-map, every distinct valid
/// configure acks-and-commits at the latest requested size, duplicate
/// serial dedup, and terminal close/protocol-error. Zero dimensions retain
/// the latest positive requested size once one exists; the 320x240 fallback
/// applies only initially. Negative/excessive sizes reject without
/// overwriting the retained size.
#[derive(Debug, Default)]
pub struct DiagLifecycle {
    configured: bool,
    last_serial: Option<u32>,
    configure_count: u32,
    mapped: bool,
    closed: bool,
    protocol_error: Option<&'static str>,
    width: i32,
    height: i32,
    last_positive: Option<(i32, i32)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigureAction {
    AckAndMap { serial: u32 },
    DuplicateAck { serial: u32 },
}

impl DiagLifecycle {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn on_configure(
        &mut self,
        serial: u32,
        width: i32,
        height: i32,
        states: usize,
    ) -> Result<ConfigureAction, &'static str> {
        if serial == 0 {
            return Err("bad-serial");
        }
        if self.closed {
            return Err("closed");
        }
        if self.protocol_error.is_some() {
            return Err("protocol-error");
        }
        if !(0..=MAX_CONFIG_DIM).contains(&width) || !(0..=MAX_CONFIG_DIM).contains(&height) {
            return Err("buffer-dimensions");
        }
        if states > MAX_CONFIG_STATES {
            return Err("too-many-states");
        }
        if self.last_serial == Some(serial) {
            return Ok(ConfigureAction::DuplicateAck { serial });
        }
        self.configured = true;
        self.last_serial = Some(serial);
        self.configure_count += 1;
        if width > 0 && height > 0 {
            self.width = width;
            self.height = height;
            self.last_positive = Some((width, height));
        } else if let Some((lw, lh)) = self.last_positive {
            // Later 0x0 (any zero dimension) retains the prior content size.
            self.width = lw;
            self.height = lh;
        } else {
            let (w, h) = effective_size(width, height);
            self.width = w;
            self.height = h;
        }
        // Every distinct valid configure produces an ack-and-commit action so
        // resizes attach/commit instead of ack-only.
        Ok(ConfigureAction::AckAndMap { serial })
    }

    /// Repeatable commit size: returns the latest acknowledged content size.
    /// Idempotent after the first map so subsequent configures can attach and
    /// commit again at the new size. `320x240` fallback applies only when the
    /// compositor sent `0` and no positive size exists yet (via
    /// [`effective_size`]).
    pub fn on_first_map(&mut self) -> Result<(i32, i32), &'static str> {
        if self.closed {
            return Err("closed");
        }
        if self.protocol_error.is_some() {
            return Err("protocol-error");
        }
        if !self.configured {
            return Err("configure-before-map");
        }
        self.mapped = true;
        Ok((self.width, self.height))
    }

    pub fn on_close(&mut self) -> Result<(), &'static str> {
        if self.protocol_error.is_some() {
            return Err("protocol-error");
        }
        if self.closed {
            return Err("closed");
        }
        self.closed = true;
        Ok(())
    }

    pub fn on_protocol_error(&mut self, kind: &'static str) -> Result<(), &'static str> {
        if self.closed {
            return Err("closed");
        }
        if self.protocol_error.is_some() {
            return Err("protocol-error");
        }
        self.protocol_error = Some(kind);
        Ok(())
    }

    #[must_use]
    pub const fn is_mapped(&self) -> bool {
        self.mapped
    }

    #[must_use]
    pub const fn is_closed(&self) -> bool {
        self.closed
    }

    #[must_use]
    pub const fn configure_count(&self) -> u32 {
        self.configure_count
    }

    /// Latest acknowledged content size, if any configure has been accepted.
    /// The live client resets its pending toplevel size to this after each
    /// surface configure so a surface configure without a fresh toplevel
    /// size retains the last request instead of resetting to 0x0.
    #[must_use]
    pub const fn content_size(&self) -> Option<(i32, i32)> {
        if self.configured {
            Some((self.width, self.height))
        } else {
            None
        }
    }
}

/// Pure SHM buffer allocation/lifetime model for the diagnostic client.
///
/// The live Wayland path keeps real `wl_buffer`/`wl_shm_pool`/mmap objects
/// keyed by these ids; this tracker decides reuse vs allocate and tracks
/// `wl_buffer.release` so a buffer still used by the compositor is never
/// reattached or destroyed. Only a released compatible buffer may be reused;
/// a same-size repeat while the current buffer is still unreleased allocates
/// a separate retained buffer. Total live stores are bounded by
/// [`MAX_LIVE_BUFFERS`]; requests beyond the bound refuse with the bounded
/// `buffer-overflow` kind without changing state and must not commit.
/// Replaced stores are retained until release and destroyed only at
/// termination cleanup.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BufferRecord {
    pub id: u64,
    pub width: i32,
    pub height: i32,
    pub bytes: usize,
    pub released: bool,
}

/// Reuse an existing live buffer object or allocate a new backing store.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BufferDecision {
    Reuse { id: u64 },
    Allocate { id: u64, bytes: usize },
}

#[derive(Debug, Default)]
pub struct DiagBufferTracker {
    next_id: u64,
    current: Option<BufferRecord>,
    retained: Vec<BufferRecord>,
}

impl DiagBufferTracker {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Validate `width`/`height` with [`buffer_bytes`], then decide reuse vs
    /// allocate. Only a released compatible buffer may be reused; otherwise a
    /// new id is allocated and the replaced current is retained until
    /// release. Same-size repeats while unreleased therefore allocate a
    /// separate retained buffer. At [`MAX_LIVE_BUFFERS`] live stores a new
    /// size refuses with the bounded `buffer-overflow` kind without changing
    /// state and must not commit. Invalid (negative/excessive/overflow) sizes
    /// return the bounded `buffer-dimensions`/`buffer-overflow` kind without
    /// changing state and must not commit.
    pub fn request(&mut self, width: i32, height: i32) -> Result<BufferDecision, &'static str> {
        let bytes = buffer_bytes(width, height)?;
        if let Some(cur) = self.current
            && cur.width == width
            && cur.height == height
            && cur.released
        {
            let id = cur.id;
            if let Some(slot) = self.current.as_mut() {
                slot.released = false;
            }
            return Ok(BufferDecision::Reuse { id });
        }
        if let Some(pos) = self
            .retained
            .iter()
            .position(|r| r.width == width && r.height == height && r.released)
        {
            let mut rec = self.retained.remove(pos);
            if let Some(old) = self.current.take() {
                self.retained.push(old);
            }
            let id = rec.id;
            rec.released = false;
            self.current = Some(rec);
            return Ok(BufferDecision::Reuse { id });
        }
        if self.total_count() >= MAX_LIVE_BUFFERS {
            return Err("buffer-overflow");
        }
        if self.next_id == u64::MAX {
            return Err("buffer-overflow");
        }
        self.next_id += 1;
        let id = self.next_id;
        if let Some(old) = self.current.take() {
            self.retained.push(old);
        }
        self.current = Some(BufferRecord {
            id,
            width,
            height,
            bytes,
            released: false,
        });
        Ok(BufferDecision::Allocate { id, bytes })
    }

    /// Mark `id` released after `wl_buffer.release`. Returns true when the id
    /// is known (current or retained). Released buffers are kept for reuse and
    /// destroyed only at termination cleanup.
    pub fn on_release(&mut self, id: u64) -> bool {
        if let Some(cur) = self.current.as_mut()
            && cur.id == id
        {
            cur.released = true;
            return true;
        }
        for rec in self.retained.iter_mut() {
            if rec.id == id {
                rec.released = true;
                return true;
            }
        }
        false
    }

    #[must_use]
    pub const fn current(&self) -> Option<BufferRecord> {
        // `Option<BufferRecord>` is `Copy`; const projection via match.
        match self.current {
            Some(rec) => Some(rec),
            None => None,
        }
    }

    #[must_use]
    pub fn retained_unreleased_count(&self) -> usize {
        self.retained.iter().filter(|r| !r.released).count()
    }

    #[must_use]
    pub fn total_count(&self) -> usize {
        self.retained.len() + usize::from(self.current.is_some())
    }

    #[must_use]
    pub fn is_released(&self, id: u64) -> Option<bool> {
        if let Some(cur) = self.current
            && cur.id == id
        {
            return Some(cur.released);
        }
        self.retained
            .iter()
            .find(|r| r.id == id)
            .map(|r| r.released)
    }

    #[must_use]
    pub fn all_ids(&self) -> Vec<u64> {
        let mut ids = Vec::with_capacity(self.total_count());
        if let Some(cur) = self.current {
            ids.push(cur.id);
        }
        ids.extend(self.retained.iter().map(|r| r.id));
        ids
    }
}

/// Exclusively create a new diagnostic file: `O_CREAT|O_EXCL|O_NOFOLLOW`,
/// mode 0600. Never follows a trailing symlink, never truncates, never
/// overwrites an existing file. Parent symlink traversal is constrained by
/// the caller (manifest launcher validates `no_symlink_path` plus a direct
/// WORKDIR child; direct CLI validates bounded absolute syntax).
pub fn create_diag_file(path: &std::path::Path) -> std::io::Result<std::fs::File> {
    use rustix::fs::{Mode, OFlags};
    let fd = rustix::fs::open(
        path,
        OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::from_raw_mode(0o600),
    )
    .map_err(std::io::Error::from)?;
    Ok(std::fs::File::from(fd))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clean_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn slots_are_distinct_and_bounded() {
        let mut titles = BTreeSet::new();
        let mut app_ids = BTreeSet::new();
        let mut colors = BTreeSet::new();
        for slot in 1..=3u8 {
            let desc = slot_desc(slot).expect("slot exists");
            assert!(titles.insert(desc.title));
            assert!(app_ids.insert(desc.app_id));
            assert!(colors.insert(desc.argb));
        }
        assert!(slot_desc(0).is_none());
        assert!(slot_desc(4).is_none());
    }

    #[test]
    fn cli_requires_all_explicit_values() {
        let argv: Vec<String> = vec!["bin".into()];
        assert_eq!(
            parse_args(&argv, 1000, &clean_env).unwrap_err(),
            CliError::MissingArg
        );
        let argv: Vec<String> = ["bin", "--runtime", "/tmp/w/runtime", "--socket", "nested-0"]
            .iter()
            .map(ToString::to_string)
            .collect();
        assert_eq!(
            parse_args(&argv, 1000, &clean_env).unwrap_err(),
            CliError::MissingArg
        );
    }

    #[test]
    fn cli_rejects_host_default_and_ambient() {
        let ambient = |key: &str| match key {
            "WAYLAND_DISPLAY" => Some("wayland-0".to_owned()),
            _ => None,
        };
        let argv: Vec<String> = [
            "bin",
            "--runtime",
            "/tmp/w/runtime",
            "--socket",
            "nested-0",
            "--slot",
            "1",
            "--diag",
            "/tmp/w/diag.log",
        ]
        .iter()
        .map(ToString::to_string)
        .collect();
        assert_eq!(
            parse_args(&argv, 1000, &ambient).unwrap_err(),
            CliError::AmbientTarget
        );
        // Host runtimes refused without echo.
        for host in ["/", "/tmp", "/run", "/run/user", "/run/user/1000"] {
            let argv: Vec<String> = [
                "bin",
                "--runtime",
                host,
                "--socket",
                "nested-0",
                "--slot",
                "1",
                "--diag",
                "/tmp/w/diag.log",
            ]
            .iter()
            .map(ToString::to_string)
            .collect();
            let err = parse_args(&argv, 1000, &clean_env).unwrap_err();
            assert_eq!(err, CliError::HostTarget, "runtime {host}");
            assert!(!err.to_string().contains(host));
        }
        // Default socket names refused: all canonical wayland-<decimal>.
        for sock in [
            "wayland-0",
            "wayland-1",
            "wayland-2",
            "wayland-10",
            "wayland-999",
        ] {
            let argv: Vec<String> = [
                "bin",
                "--runtime",
                "/tmp/w/runtime",
                "--socket",
                sock,
                "--slot",
                "1",
                "--diag",
                "/tmp/w/diag.log",
            ]
            .iter()
            .map(ToString::to_string)
            .collect();
            assert_eq!(
                parse_args(&argv, 1000, &clean_env).unwrap_err(),
                CliError::DefaultTarget,
                "socket {sock}"
            );
        }
        // Non-default private nested names remain accepted.
        for sock in [
            "nested-0",
            "nested-poc3",
            "poc3-nested-2",
            "wayland-private",
            "wayland-0a",
            "wayland-",
        ] {
            let argv: Vec<String> = [
                "bin",
                "--runtime",
                "/tmp/w/runtime",
                "--socket",
                sock,
                "--slot",
                "1",
                "--diag",
                "/tmp/w/diag.log",
            ]
            .iter()
            .map(ToString::to_string)
            .collect();
            assert!(
                parse_args(&argv, 1000, &clean_env).is_ok(),
                "socket {sock} accepted"
            );
        }
        // Slot bounds.
        for bad in ["0", "4", "abc"] {
            let argv: Vec<String> = [
                "bin",
                "--runtime",
                "/tmp/w/runtime",
                "--socket",
                "nested-0",
                "--slot",
                bad,
                "--diag",
                "/tmp/w/diag.log",
            ]
            .iter()
            .map(ToString::to_string)
            .collect();
            assert_eq!(
                parse_args(&argv, 1000, &clean_env).unwrap_err(),
                CliError::BadSlot,
                "slot {bad}"
            );
        }
    }

    #[test]
    fn lifecycle_enforces_configure_before_map_and_duplicates() {
        let mut life = DiagLifecycle::new();
        assert_eq!(life.on_first_map().unwrap_err(), "configure-before-map");
        let action = life.on_configure(7, 0, 0, 0).expect("first configure");
        assert_eq!(action, ConfigureAction::AckAndMap { serial: 7 });
        assert_eq!(
            life.on_configure(7, 0, 0, 0).expect("duplicate"),
            ConfigureAction::DuplicateAck { serial: 7 }
        );
        assert_eq!(life.configure_count(), 1);
        let (w, h) = life.on_first_map().expect("map after configure");
        assert_eq!((w, h), (FALLBACK_WIDTH, FALLBACK_HEIGHT));
        assert!(life.is_mapped());
        // Repeatable commit: second call returns latest size instead of error.
        assert_eq!(life.on_first_map().expect("repeat commit"), (320, 240));
        // Second distinct configure also acks-and-commits at the new size.
        assert_eq!(
            life.on_configure(8, 100, 100, 1).expect("second"),
            ConfigureAction::AckAndMap { serial: 8 }
        );
        assert_eq!(life.on_first_map().expect("resize commit"), (100, 100));
        life.on_close().expect("close");
        assert!(life.is_closed());
        assert_eq!(life.on_close().unwrap_err(), "closed");
        assert_eq!(life.on_configure(9, 10, 10, 0).unwrap_err(), "closed");
    }

    #[test]
    fn protocol_error_is_terminal() {
        let mut life = DiagLifecycle::new();
        life.on_configure(1, 100, 100, 1).expect("configure");
        life.on_protocol_error("protocol-error").expect("record");
        assert_eq!(life.on_first_map().unwrap_err(), "protocol-error");
        assert_eq!(life.on_close().unwrap_err(), "protocol-error");
    }

    #[test]
    fn terminal_first_wins_and_raw_states_unclamped() {
        // Raw state count is never clamped: over-bound configures reject.
        let mut life = DiagLifecycle::new();
        assert_eq!(
            life.on_configure(1, 100, 100, MAX_CONFIG_STATES + 1)
                .unwrap_err(),
            "too-many-states"
        );
        assert_eq!(life.configure_count(), 0);
        // Raw 0x0 size still configures; fallback applies to buffer sizing.
        assert_eq!(
            life.on_configure(2, 0, 0, 0).expect("raw zero"),
            ConfigureAction::AckAndMap { serial: 2 }
        );
        // Close wins: later protocol-error must not claim a second terminal.
        life.on_close().expect("close");
        assert_eq!(
            life.on_protocol_error("protocol-error").unwrap_err(),
            "closed"
        );
        assert_eq!(life.on_close().unwrap_err(), "closed");
        assert_eq!(life.on_configure(3, 10, 10, 0).unwrap_err(), "closed");
        // Protocol-error wins: later close must not claim a close.
        let mut other = DiagLifecycle::new();
        other.on_configure(4, 64, 64, 1).expect("configure");
        other.on_protocol_error("protocol-error").expect("record");
        assert_eq!(other.on_close().unwrap_err(), "protocol-error");
        assert_eq!(
            other.on_protocol_error("dispatch-failure").unwrap_err(),
            "protocol-error"
        );
        assert_eq!(
            other.on_configure(5, 64, 64, 0).unwrap_err(),
            "protocol-error"
        );
    }

    #[test]
    fn configure_rejects_too_many_states_without_clamp() {
        let mut life = DiagLifecycle::new();
        assert_eq!(
            life.on_configure(1, 100, 100, MAX_CONFIG_STATES + 1)
                .unwrap_err(),
            "too-many-states"
        );
        assert_eq!(life.configure_count(), 0);
        // Terminal configure is never acked: invalid serial rejected.
        assert_eq!(life.on_configure(0, 100, 100, 0).unwrap_err(), "bad-serial");
        // Valid configure (including raw 0x0) still acks.
        assert_eq!(
            life.on_configure(2, 0, 0, 0).expect("raw zero"),
            ConfigureAction::AckAndMap { serial: 2 }
        );
    }

    #[test]
    fn diag_file_creation_is_exclusive_and_never_follows_symlink() {
        let dir = std::env::temp_dir().join(format!(
            "poc3-diag-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let path = dir.join("diag.log");
        let _file = create_diag_file(&path).expect("exclusive create");
        assert!(path.is_file() && !path.is_symlink());
        assert!(create_diag_file(&path).is_err(), "no overwrite");
        let link = dir.join("link.log");
        std::os::unix::fs::symlink(&path, &link).expect("symlink");
        assert!(create_diag_file(&link).is_err(), "no symlink follow");
        std::fs::remove_file(&path).ok();
        std::fs::remove_file(&link).ok();
        std::fs::remove_dir(&dir).ok();
    }

    #[test]
    fn buffer_sizing_rejects_overflow() {
        assert!(buffer_bytes(320, 240).is_ok());
        assert_eq!(buffer_bytes(0, 10).unwrap_err(), "buffer-dimensions");
        assert_eq!(
            buffer_bytes(i32::MAX, i32::MAX).unwrap_err(),
            "buffer-dimensions"
        );
        assert_eq!(buffer_bytes(5000, 5000).unwrap_err(), "buffer-dimensions");
        // 2048x2048x4 fits the cap; larger dims are refused before overflow.
        assert_eq!(buffer_bytes(2048, 2048).expect("max"), MAX_BUFFER_BYTES);
    }

    #[test]
    fn events_are_bounded_and_redacted() {
        let sensitive = "/tmp/secret-runtime-xyz";
        for event in [
            DiagEvent::Connect { slot: 1 },
            DiagEvent::Globals {
                compositor: true,
                shm: false,
                xdg: true,
            },
            DiagEvent::Configure {
                serial: 3,
                width: 100,
                height: 50,
                states: 1,
            },
            DiagEvent::FirstMap {
                width: 100,
                height: 50,
            },
            DiagEvent::Close,
            DiagEvent::ProtocolError {
                kind: "missing-global",
            },
            DiagEvent::Exit { reason: "close" },
        ] {
            let text = format_event(1, &event).expect("bounded");
            assert!(text.len() <= MAX_DIAG_EVENT_BYTES);
            assert!(!text.contains(sensitive));
            assert!(!text.contains("runtime"));
            assert!(!text.contains("wayland"));
        }
        assert!(format_event(1, &DiagEvent::Connect { slot: 9 }).is_none());
        assert!(format_event(1, &DiagEvent::Exit { reason: "bogus" }).is_none());
    }

    #[test]
    fn manifest_route_is_bounded_and_validated() {
        let text = "runtime=/tmp/w/runtime\nsocket=nested-0\nslot=2\ndiag=/tmp/w/diag.log\n";
        let cfg = parse_manifest_text(text, 1000, &clean_env).expect("valid");
        assert_eq!(cfg.slot, 2);
        let big = "x".repeat(MAX_MANIFEST_BYTES + 1);
        assert_eq!(
            parse_manifest_text(&big, 1000, &clean_env).unwrap_err(),
            CliError::ManifestTooLarge
        );
        assert_eq!(
            parse_manifest_text("runtime=/tmp/w/runtime\n", 1000, &clean_env).unwrap_err(),
            CliError::ManifestMalformed
        );
        let bad_slot = "runtime=/tmp/w/runtime\nsocket=nested-0\nslot=9\ndiag=/tmp/w/diag.log\n";
        assert_eq!(
            parse_manifest_text(bad_slot, 1000, &clean_env).unwrap_err(),
            CliError::BadSlot
        );
    }

    #[test]
    fn zero_retains_latest_positive_and_invalid_never_overwrites() {
        let mut life = DiagLifecycle::new();
        life.on_configure(1, 0, 0, 0).expect("initial zero");
        assert_eq!(life.on_first_map().expect("fallback"), (320, 240));
        life.on_configure(2, 640, 480, 0).expect("positive");
        assert_eq!(life.on_first_map().expect("positive"), (640, 480));
        life.on_configure(3, 0, 0, 0).expect("later zero");
        assert_eq!(life.on_first_map().expect("retained"), (640, 480));
        life.on_configure(4, 640, 0, 0).expect("partial zero");
        assert_eq!(life.on_first_map().expect("retained"), (640, 480));
        assert_eq!(life.content_size(), Some((640, 480)));
        // Invalid dimensions reject without overwriting the retained size.
        assert_eq!(
            life.on_configure(5, -1, 240, 0).unwrap_err(),
            "buffer-dimensions"
        );
        assert_eq!(
            life.on_configure(6, 5000, 5000, 0).unwrap_err(),
            "buffer-dimensions"
        );
        assert_eq!(
            life.on_configure(7, 100, 100, MAX_CONFIG_STATES + 1)
                .unwrap_err(),
            "too-many-states"
        );
        assert_eq!(life.on_configure(0, 100, 100, 0).unwrap_err(), "bad-serial");
        assert_eq!(life.content_size(), Some((640, 480)));
        assert_eq!(life.on_first_map().expect("retained"), (640, 480));
        // Later valid still succeeds (nonterminal invalids).
        life.on_configure(8, 800, 600, 0).expect("valid");
        assert_eq!(life.on_first_map().expect("new"), (800, 600));
    }

    #[test]
    fn tracker_never_reuses_unreleased_and_bounds_live() {
        let mut tracker = DiagBufferTracker::new();
        let first = tracker.request(320, 240).expect("first");
        let first_id = match first {
            BufferDecision::Allocate { id, .. } => id,
            BufferDecision::Reuse { .. } => panic!("first must allocate"),
        };
        // Same-size repeat while unreleased allocates separately.
        let second = tracker.request(320, 240).expect("second");
        assert!(matches!(second, BufferDecision::Allocate { .. }));
        assert_eq!(tracker.total_count(), 2);
        // Fill to the explicit bound with distinct unreleased sizes.
        tracker.request(640, 480).expect("third");
        tracker.request(800, 600).expect("fourth");
        assert_eq!(tracker.total_count(), MAX_LIVE_BUFFERS);
        assert_eq!(tracker.request(200, 100).unwrap_err(), "buffer-overflow");
        assert_eq!(tracker.total_count(), MAX_LIVE_BUFFERS);
        // Released compatible buffers may reuse without growing.
        assert!(tracker.on_release(first_id));
        assert_eq!(
            tracker.request(320, 240).expect("reuse"),
            BufferDecision::Reuse { id: first_id }
        );
        assert_eq!(tracker.total_count(), MAX_LIVE_BUFFERS);
        // All held ids are known exactly once for termination cleanup.
        let mut ids = tracker.all_ids();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), tracker.total_count());
    }
}
