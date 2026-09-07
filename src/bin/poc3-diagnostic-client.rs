//! POC3 raw xdg-shell diagnostic client (diagnostic/test-only).
//!
//! Manually launched. Strict explicit target only: either
//! `--runtime DIR --socket NAME --slot 1..3 --diag PATH` or
//! `--manifest PATH` (bounded `key=value` for runtime/socket/slot/diag).
//! Refuses missing, default, ambient, or host targets with no fallback.
//! Never emits user path or environment content in diagnostics or errors.
//!
//! Raw `wl_compositor` / `wl_shm` / `xdg_wm_base` / `xdg_surface` /
//! `xdg_toplevel`: registry bind, ping/pong, configure ack, minimal SHM
//! ARGB attach/commit after configure, alive until compositor close,
//! signal, or explicit cleanup.

use std::fs::File;
use std::io::Write;
use std::os::unix::io::AsFd;
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, Ordering};

use plasma_auto_tiler::poc3_diag::{
    BufferDecision, ConfigureAction, DiagBufferTracker, DiagConfig, DiagEvent, DiagLifecycle,
    MAX_DIAG_FILE_BYTES, MAX_MANIFEST_BYTES, buffer_bytes, create_diag_file, draw_slot,
    format_event, parse_args, parse_manifest_text, slot_desc,
};
use wayland_client::protocol::{
    wl_buffer, wl_compositor, wl_registry, wl_shm, wl_shm_pool, wl_surface,
};
use wayland_client::{Connection, Dispatch, QueueHandle};
use wayland_protocols::xdg::shell::client::{xdg_surface, xdg_toplevel, xdg_wm_base};

static SIGNAL_EXIT: AtomicBool = AtomicBool::new(false);

// Async-signal-safe only: single lock-free store. Installed persistently via
// `sigaction` (no `RESETHAND`), so the first SIGINT/SIGTERM is never lost to
// a reset handler. No `SA_RESTART` so blocking Wayland reads fail with EINTR
// and the loop can exit as `signal` instead of `protocol-error`.
unsafe extern "C" fn on_signal(_: i32) {
    SIGNAL_EXIT.store(true, Ordering::SeqCst);
}

fn install_signal_handlers() {
    // Persistent Linux handlers via already-linked libc `sigaction`
    // (no new dependency, no handler reset). Mirrors `SA_NODEFER`-free
    // minimal setup: empty mask, no `SA_RESTART`, no `SA_RESETHAND`.
    #[repr(C)]
    struct Sigaction {
        handler: usize,
        mask: [u64; 16],
        flags: i32,
        _restorer: usize,
    }
    unsafe extern "C" {
        fn sigaction(signum: i32, act: *const Sigaction, old: *mut Sigaction) -> i32;
    }
    unsafe {
        let act = Sigaction {
            handler: on_signal as *const () as usize,
            mask: [0; 16],
            flags: 0,
            _restorer: 0,
        };
        sigaction(2, &act, std::ptr::null_mut());
        sigaction(15, &act, std::ptr::null_mut());
    }
}

fn signal_requested() -> bool {
    SIGNAL_EXIT.load(Ordering::SeqCst)
}

/// Map any internal lifecycle/buffer failure to a bounded diagnostic kind.
/// Only the `format_event` allowlist can be emitted; everything else becomes
/// the generic `protocol-error` so no terminal cause is silently dropped.
fn diag_protocol_kind(kind: &'static str) -> &'static str {
    match kind {
        "missing-global" | "shm-unavailable" | "protocol-error" | "buffer-overflow"
        | "dispatch-failure" => kind,
        _ => "protocol-error",
    }
}

struct DiagLog {
    file: File,
    seq: u64,
    bytes: usize,
    capped: bool,
}

impl DiagLog {
    fn create(path: &std::path::Path) -> std::io::Result<Self> {
        let file = create_diag_file(path)?;
        Ok(Self {
            file,
            seq: 0,
            bytes: 0,
            capped: false,
        })
    }

    fn push(&mut self, event: &DiagEvent) {
        if self.capped {
            return;
        }
        self.seq += 1;
        let Some(mut text) = format_event(self.seq, event) else {
            return;
        };
        text.push('\n');
        if self.bytes + text.len() > MAX_DIAG_FILE_BYTES {
            self.capped = true;
            return;
        }
        if self.file.write_all(text.as_bytes()).is_err() {
            self.capped = true;
            return;
        }
        let _ = self.file.flush();
        self.bytes += text.len();
    }
}

/// One live SHM backing store. Retained in `State.live` until termination;
/// replaced stores are kept (not destroyed) until `wl_buffer.release` marks
/// them released, so a buffer still used by the compositor is never freed.
struct LiveShm {
    buffer: wl_buffer::WlBuffer,
    pool: wl_shm_pool::WlShmPool,
    _file: File,
    _map: memmap2::MmapMut,
}

struct State {
    slot: u8,
    log: DiagLog,
    lifecycle: DiagLifecycle,
    buffer_tracker: DiagBufferTracker,
    live: std::collections::HashMap<u64, LiveShm>,
    running: bool,
    compositor: Option<wl_compositor::WlCompositor>,
    shm: Option<wl_shm::WlShm>,
    wm_base: Option<xdg_wm_base::XdgWmBase>,
    surface: Option<wl_surface::WlSurface>,
    xdg_surface: Option<xdg_surface::XdgSurface>,
    toplevel: Option<xdg_toplevel::XdgToplevel>,
    pending_width: i32,
    pending_height: i32,
    pending_states: usize,
    globals_emitted: bool,
    exit_reason: &'static str,
}

impl State {
    /// Preserve the first terminal cause (`close`/`protocol-error`/`signal`).
    /// Later causes never overwrite the first, so requested diagnostics match
    /// the actual exit.
    fn note_exit(&mut self, reason: &'static str) {
        if self.exit_reason == "error" {
            self.exit_reason = reason;
        }
    }

    fn note_protocol_error(&mut self, kind: &'static str) {
        // Preserve the first lifecycle terminal condition: a protocol error
        // after close (or a second protocol error) must not emit a
        // contradictory second terminal event.
        if self.lifecycle.on_protocol_error(kind).is_ok() {
            self.log.push(&DiagEvent::ProtocolError {
                kind: diag_protocol_kind(kind),
            });
            self.note_exit("protocol-error");
            self.running = false;
        }
    }

    /// Bounded nonterminal diagnostic: invalid/excessive/overflow/too-many-
    /// states/bad-serial configures and tracker limit refusals log an
    /// existing bounded kind without ack/commit and stay running so a later
    /// valid configure can still succeed. Genuine transport/allocation
    /// failures keep using `note_protocol_error` (terminal).
    fn push_nonterminal(&mut self, kind: &'static str) {
        self.log.push(&DiagEvent::ProtocolError {
            kind: diag_protocol_kind(kind),
        });
    }

    /// Retain the last requested content size so a later surface configure
    /// without a fresh toplevel size reuses it instead of resetting to 0x0.
    /// Invalid sizes never reach here (lifecycle rejects without mutating),
    /// so the retained size is always the last valid request.
    fn retain_pending(&mut self) {
        if let Some((w, h)) = self.lifecycle.content_size() {
            self.pending_width = w;
            self.pending_height = h;
        } else {
            self.pending_width = 0;
            self.pending_height = 0;
        }
        self.pending_states = 0;
    }

    fn maybe_init_surface(&mut self, qh: &QueueHandle<Self>) {
        if self.surface.is_some() || self.compositor.is_none() || self.wm_base.is_none() {
            return;
        }
        let desc = slot_desc(self.slot).expect("slot validated");
        let surface = self
            .compositor
            .as_ref()
            .expect("compositor present")
            .create_surface(qh, ());
        let xdg_surface = self
            .wm_base
            .as_ref()
            .expect("wm base present")
            .get_xdg_surface(&surface, qh, ());
        let toplevel = xdg_surface.get_toplevel(qh, ());
        toplevel.set_title(desc.title.into());
        toplevel.set_app_id(desc.app_id.into());
        surface.commit();
        self.surface = Some(surface);
        self.xdg_surface = Some(xdg_surface);
        self.toplevel = Some(toplevel);
    }

    fn maybe_emit_globals(&mut self) {
        if self.globals_emitted {
            return;
        }
        if self.compositor.is_some() && self.shm.is_some() && self.wm_base.is_some() {
            self.globals_emitted = true;
            self.log.push(&DiagEvent::Globals {
                compositor: true,
                shm: true,
                xdg: true,
            });
        }
    }

    /// Strict order: toplevel size already recorded in lifecycle, surface
    /// configure validated/acked by the caller, then attach+commit here at the
    /// requested content size. Zero dimensions retain the latest positive
    /// size via the lifecycle (320x240 initial fallback only);
    /// negative/excessive sizes reject without commit. Only released
    /// compatible buffers are reused; otherwise a new store is allocated and
    /// the replaced store is retained until `wl_buffer.release`. Tracker
    /// limit refusals stay nonterminal without commit; genuine
    /// transport/allocation failures and missing live/surface after ack are
    /// terminal protocol errors. All held objects are destroyed at
    /// termination cleanup.
    fn attach_configured(&mut self, qh: &QueueHandle<Self>) {
        let (width, height) = match self.lifecycle.on_first_map() {
            Ok(size) => size,
            Err(_) => return,
        };
        // Validate bounds/overflow before touching protocol objects; invalid
        // sizes stay nonterminal without commit and map to bounded kinds.
        if buffer_bytes(width, height).is_err() {
            let kind = match buffer_bytes(width, height) {
                Err(k) => k,
                Ok(_) => "protocol-error",
            };
            self.push_nonterminal(kind);
            return;
        }
        let decision = match self.buffer_tracker.request(width, height) {
            Ok(d) => d,
            Err(kind) => {
                self.push_nonterminal(kind);
                return;
            }
        };
        match decision {
            BufferDecision::Reuse { id } => {
                if let (Some(surface), Some(live)) = (self.surface.as_ref(), self.live.get(&id)) {
                    surface.attach(Some(&live.buffer), 0, 0);
                    surface.commit();
                    self.log.push(&DiagEvent::FirstMap { width, height });
                } else {
                    self.note_protocol_error("protocol-error");
                }
            }
            BufferDecision::Allocate { id, bytes } => {
                let shm = match self.shm.as_ref() {
                    Some(shm) => shm.clone(),
                    None => {
                        self.note_protocol_error("shm-unavailable");
                        return;
                    }
                };
                // Allocation failed after the tracker reserved the id: the
                // tracker state already retains the replaced current until
                // release, which is safe (no destroy of in-use buffers).
                // Undo the reservation only by keeping tracker as-is; a retry
                // on the next configure will allocate again. To avoid a stuck
                // current pointing at a missing live object, fall back to a
                // protocol error (terminal) since we cannot commit.
                let fd = match create_shm_file(bytes) {
                    Ok(fd) => fd,
                    Err(_) => {
                        self.note_protocol_error("shm-unavailable");
                        return;
                    }
                };
                // SAFETY: memfd file we just sized; converting OwnedFd to File.
                let file: File = fd.into();
                let mut map = match unsafe { memmap2::MmapOptions::new().len(bytes).map_mut(&file) }
                {
                    Ok(map) => map,
                    Err(_) => {
                        self.note_protocol_error("shm-unavailable");
                        return;
                    }
                };
                if draw_slot(width as u32, height as u32, self.slot, &mut map).is_err() {
                    self.note_protocol_error("buffer-overflow");
                    return;
                }
                let _ = map.flush();
                let pool = shm.create_pool(file.as_fd(), bytes as i32, qh, ());
                let buffer = pool.create_buffer(
                    0,
                    width,
                    height,
                    width * 4,
                    wl_shm::Format::Argb8888,
                    qh,
                    id,
                );
                self.live.insert(
                    id,
                    LiveShm {
                        buffer,
                        pool,
                        _file: file,
                        _map: map,
                    },
                );
                if let (Some(surface), Some(live)) = (self.surface.as_ref(), self.live.get(&id)) {
                    surface.attach(Some(&live.buffer), 0, 0);
                    surface.commit();
                    self.log.push(&DiagEvent::FirstMap { width, height });
                } else {
                    self.note_protocol_error("protocol-error");
                }
            }
        }
    }

    fn cleanup(&mut self) {
        if let Some(toplevel) = self.toplevel.take() {
            toplevel.destroy();
        }
        if let Some(xdg_surface) = self.xdg_surface.take() {
            xdg_surface.destroy();
        }
        // Destroy every held buffer/pool (current plus retained until
        // release) exactly once at termination.
        let ids: Vec<u64> = self.live.keys().copied().collect();
        for id in ids {
            if let Some(live) = self.live.remove(&id) {
                live.buffer.destroy();
                live.pool.destroy();
            }
        }
        if let Some(surface) = self.surface.take() {
            surface.destroy();
        }
    }
}

fn create_shm_file(len: usize) -> Result<std::os::fd::OwnedFd, &'static str> {
    use rustix::fs::{MemfdFlags, ftruncate, memfd_create};
    let fd = memfd_create("poc3-diag-shm", MemfdFlags::CLOEXEC).map_err(|_| "shm-unavailable")?;
    ftruncate(&fd, len as u64).map_err(|_| "shm-unavailable")?;
    Ok(fd)
}

impl Dispatch<wl_registry::WlRegistry, ()> for State {
    fn event(
        state: &mut Self,
        registry: &wl_registry::WlRegistry,
        event: wl_registry::Event,
        _: &(),
        _: &Connection,
        qh: &QueueHandle<Self>,
    ) {
        if let wl_registry::Event::Global {
            name,
            interface,
            version,
        } = event
        {
            match interface.as_str() {
                "wl_compositor" if version >= 1 => {
                    let want = std::cmp::min(version, 4);
                    let compositor =
                        registry.bind::<wl_compositor::WlCompositor, _, _>(name, want, qh, ());
                    state.compositor = Some(compositor);
                }
                "wl_shm" if version >= 1 => {
                    let want = std::cmp::min(version, 1);
                    let shm = registry.bind::<wl_shm::WlShm, _, _>(name, want, qh, ());
                    state.shm = Some(shm);
                }
                "xdg_wm_base" if version >= 1 => {
                    let want = std::cmp::min(version, 2);
                    let wm_base = registry.bind::<xdg_wm_base::XdgWmBase, _, _>(name, want, qh, ());
                    state.wm_base = Some(wm_base);
                }
                _ => {}
            }
            state.maybe_emit_globals();
            state.maybe_init_surface(qh);
        }
    }
}

impl Dispatch<xdg_wm_base::XdgWmBase, ()> for State {
    fn event(
        _: &mut Self,
        wm_base: &xdg_wm_base::XdgWmBase,
        event: xdg_wm_base::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let xdg_wm_base::Event::Ping { serial } = event {
            wm_base.pong(serial);
        }
    }
}

impl Dispatch<xdg_surface::XdgSurface, ()> for State {
    fn event(
        state: &mut Self,
        xdg_surface: &xdg_surface::XdgSurface,
        event: xdg_surface::Event,
        _: &(),
        _: &Connection,
        qh: &QueueHandle<Self>,
    ) {
        if let xdg_surface::Event::Configure { serial } = event {
            // Valid distinct configures ack then attach/commit; duplicates
            // ack without recommit; invalid/excessive/overflow/too-many-
            // states/bad-serial never ack or commit, log an existing bounded
            // kind, and stay nonterminal so a later valid configure can run.
            // Genuine terminal states still go through `note_protocol_error`.
            let (w, h) = (state.pending_width, state.pending_height);
            let states = state.pending_states;
            match state.lifecycle.on_configure(serial, w, h, states) {
                Ok(ConfigureAction::AckAndMap { serial }) => {
                    xdg_surface.ack_configure(serial);
                    state.log.push(&DiagEvent::Configure {
                        serial,
                        width: w,
                        height: h,
                        states,
                    });
                    state.attach_configured(qh);
                }
                Ok(ConfigureAction::DuplicateAck { serial }) => {
                    xdg_surface.ack_configure(serial);
                    state.log.push(&DiagEvent::Configure {
                        serial,
                        width: w,
                        height: h,
                        states,
                    });
                }
                Err(kind)
                    if matches!(
                        kind,
                        "bad-serial" | "buffer-dimensions" | "too-many-states" | "buffer-overflow"
                    ) =>
                {
                    state.push_nonterminal(kind);
                }
                Err(kind) => {
                    state.note_protocol_error(kind);
                }
            }
            // Retain the last requested size so a later surface configure
            // without a fresh toplevel configure reuses it, never 0x0.
            state.retain_pending();
        }
    }
}

impl Dispatch<xdg_toplevel::XdgToplevel, ()> for State {
    fn event(
        state: &mut Self,
        _: &xdg_toplevel::XdgToplevel,
        event: xdg_toplevel::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            xdg_toplevel::Event::Configure {
                width,
                height,
                states,
            } => {
                // Keep raw received values; fallback applies only to buffer
                // sizing, and too many states are rejected, never clamped.
                state.pending_width = width;
                state.pending_height = height;
                state.pending_states = states.len();
            }
            // Emit Close, claim close exit, and stop only if the close wins
            // the lifecycle race. A close after a protocol terminal state
            // must not emit a contradictory close event nor overwrite/claim
            // a close.
            xdg_toplevel::Event::Close if state.lifecycle.on_close().is_ok() => {
                state.log.push(&DiagEvent::Close);
                state.note_exit("close");
                state.running = false;
            }
            _ => {}
        }
    }
}

wayland_client::delegate_noop!(State: ignore wl_compositor::WlCompositor);
wayland_client::delegate_noop!(State: ignore wl_surface::WlSurface);
wayland_client::delegate_noop!(State: ignore wl_shm::WlShm);
wayland_client::delegate_noop!(State: ignore wl_shm_pool::WlShmPool);

impl Dispatch<wl_buffer::WlBuffer, u64> for State {
    fn event(
        state: &mut Self,
        _: &wl_buffer::WlBuffer,
        event: wl_buffer::Event,
        id: &u64,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        // Release identity comes from the typed per-buffer user data (`id`
        // passed to `create_buffer`). Retained stores are kept for reuse and
        // destroyed only at termination cleanup, never here.
        if let wl_buffer::Event::Release = event {
            state.buffer_tracker.on_release(*id);
        }
    }
}

const USAGE: &str = "usage: poc3-diagnostic-client --runtime DIR --socket NAME --slot 1..3 --diag PATH | --manifest PATH | --host --runtime DIR --socket NAME --slot 1..3 --diag PATH";

fn load_config(argv: &[String]) -> Result<DiagConfig, String> {
    use plasma_auto_tiler::poc3_diag::parse_host_args;
    let uid = rustix::process::getuid().as_raw();
    let get_env = |key: &str| std::env::var(key).ok();
    if argv.iter().any(|a| a == "--host") {
        return parse_host_args(argv, uid, &get_env)
            .map_err(|e| format!("error: {} ({})\n{USAGE}", e.message(), e.kind()));
    }
    // Manifest route first: read the bounded file, then validate content.
    let mut manifest_path: Option<String> = None;
    let mut i = 0;
    let args = if argv.first().is_some_and(|a| !a.starts_with("--")) {
        &argv[1..]
    } else {
        argv
    };
    while i < args.len() {
        let arg = args[i].as_str();
        if arg == "--manifest" {
            let next = args.get(i + 1).cloned().ok_or_else(|| {
                format!("error: explicit target is missing (missing-arg)\n{USAGE}")
            })?;
            manifest_path = Some(next);
            i += 2;
        } else if let Some(rest) = arg.strip_prefix("--manifest=") {
            if rest.is_empty() {
                return Err(format!(
                    "error: explicit target is missing (missing-arg)\n{USAGE}"
                ));
            }
            manifest_path = Some(rest.to_owned());
            i += 1;
        } else {
            i += 1;
        }
    }
    if let Some(path) = manifest_path {
        let meta = std::fs::symlink_metadata(&path)
            .map_err(|_| format!("error: target value is invalid (bad-value)\n{USAGE}"))?;
        if meta.file_type().is_symlink() {
            return Err(format!(
                "error: target value is invalid (bad-value)\n{USAGE}"
            ));
        }
        if meta.len() > MAX_MANIFEST_BYTES as u64 {
            return Err(format!(
                "error: manifest exceeds size bound (manifest-too-large)\n{USAGE}"
            ));
        }
        let text = std::fs::read_to_string(&path)
            .map_err(|_| format!("error: target value is invalid (bad-value)\n{USAGE}"))?;
        return parse_manifest_text(&text, uid, &get_env)
            .map_err(|e| format!("error: {} ({})\n{USAGE}", e.message(), e.kind()));
    }
    parse_args(argv, uid, &get_env)
        .map_err(|e| format!("error: {} ({})\n{USAGE}", e.message(), e.kind()))
}

fn main() {
    let argv: Vec<String> = std::env::args().collect();
    let config = match load_config(&argv) {
        Ok(config) => config,
        Err(text) => {
            eprintln!("{text}");
            std::process::exit(1);
        }
    };
    if let Err(text) = run(config) {
        eprintln!("{text}");
        std::process::exit(1);
    }
}

fn run(config: DiagConfig) -> Result<(), String> {
    install_signal_handlers();
    // Exclusively create the owned diagnostic file first so a failed connect
    // can still record bounded `connect` then terminal diagnostics.
    // From this point on no path or env content is emitted.
    let log = DiagLog::create(std::path::Path::new(&config.diag_path))
        .map_err(|_| "error: diagnostic unavailable (diag)".to_owned())?;
    let mut state = State {
        slot: config.slot,
        log,
        lifecycle: DiagLifecycle::new(),
        buffer_tracker: DiagBufferTracker::new(),
        live: std::collections::HashMap::new(),
        running: true,
        compositor: None,
        shm: None,
        wm_base: None,
        surface: None,
        xdg_surface: None,
        toplevel: None,
        pending_width: 0,
        pending_height: 0,
        pending_states: 0,
        globals_emitted: false,
        exit_reason: "error",
    };
    state.log.push(&DiagEvent::Connect { slot: state.slot });

    let socket_path = std::path::Path::new(&config.runtime_dir).join(&config.socket_name);
    let stream = match UnixStream::connect(&socket_path) {
        Ok(stream) => stream,
        Err(_) => {
            state.note_protocol_error("protocol-error");
            state.cleanup();
            let reason = state.exit_reason;
            state.log.push(&DiagEvent::Exit { reason });
            return Err("error: wayland connect failed (connect)\n".to_owned());
        }
    };
    let conn = match Connection::from_socket(stream) {
        Ok(conn) => conn,
        Err(_) => {
            state.note_protocol_error("protocol-error");
            state.cleanup();
            let reason = state.exit_reason;
            state.log.push(&DiagEvent::Exit { reason });
            return Err("error: wayland connect failed (connect)".to_owned());
        }
    };
    let mut event_queue = conn.new_event_queue();
    let qh = event_queue.handle();
    let display = conn.display();
    display.get_registry(&qh, ());

    // Flush the initial registry request; failure is a protocol error.
    if event_queue.flush().is_err() {
        state.note_protocol_error("protocol-error");
        state.cleanup();
        let reason = state.exit_reason;
        state.log.push(&DiagEvent::Exit { reason });
        return Err("error: protocol failure (protocol-error)".to_owned());
    }

    // Bounded initial handshake that actually reads events.
    for _ in 0..50 {
        if signal_requested() {
            state.note_exit("signal");
            state.cleanup();
            let reason = state.exit_reason;
            state.log.push(&DiagEvent::Exit { reason });
            return Ok(());
        }
        match event_queue.blocking_dispatch(&mut state) {
            Ok(_) => {}
            Err(_) => {
                if signal_requested() {
                    state.note_exit("signal");
                    state.cleanup();
                    let reason = state.exit_reason;
                    state.log.push(&DiagEvent::Exit { reason });
                    return Ok(());
                }
                state.note_protocol_error("dispatch-failure");
                state.cleanup();
                let reason = state.exit_reason;
                state.log.push(&DiagEvent::Exit { reason });
                return Err("error: protocol failure (protocol-error)".to_owned());
            }
        }
        if state.globals_emitted {
            break;
        }
        if signal_requested() {
            state.note_exit("signal");
            state.cleanup();
            let reason = state.exit_reason;
            state.log.push(&DiagEvent::Exit { reason });
            return Ok(());
        }
    }
    if !state.globals_emitted {
        if signal_requested() {
            state.note_exit("signal");
            state.cleanup();
            let reason = state.exit_reason;
            state.log.push(&DiagEvent::Exit { reason });
            return Ok(());
        }
        state.note_protocol_error("missing-global");
        state.cleanup();
        let reason = state.exit_reason;
        state.log.push(&DiagEvent::Exit { reason });
        return Err("error: protocol failure (protocol-error)".to_owned());
    }

    while state.running {
        if signal_requested() {
            state.note_exit("signal");
            break;
        }
        match event_queue.blocking_dispatch(&mut state) {
            Ok(_) => {}
            Err(_) => {
                if signal_requested() {
                    state.note_exit("signal");
                } else {
                    state.note_protocol_error("dispatch-failure");
                }
                break;
            }
        }
        if !state.running {
            break;
        }
    }

    // Exact cleanup: destroy protocol objects, flush, emit exit.
    // First terminal cause is preserved; a later signal never overwrites a
    // prior close/protocol-error.
    if signal_requested() {
        state.note_exit("signal");
    }
    state.cleanup();
    if event_queue.flush().is_err() && state.exit_reason == "error" {
        state.note_protocol_error("dispatch-failure");
    }
    // Drop the connection explicitly (exact cleanup, no fallback).
    drop(event_queue);
    drop(conn);
    if signal_requested() {
        state.note_exit("signal");
    }
    let reason = state.exit_reason;
    state.log.push(&DiagEvent::Exit { reason });
    Ok(())
}
