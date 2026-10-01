//! Native tiling-only runtime (`cfg(windows)` only).
//!
//! One product loop: PMv2 awareness verified first, full `EnumWindows`
//! enumeration per tick, retained [`tiler_core::engine::Engine`] as layout
//! authority, `SetWindowPos` actuation with independent readback, and
//! out-of-context `SetWinEventHook` callbacks delivered on the loop thread
//! itself (the loop pumps messages; no hook thread, no join). Stop leaves all
//! geometry untouched; there is no per-window geometry ledger and nothing is
//! ever hidden.
//!
//! Production log vocabulary is structured JSON with opaque window tokens
//! only: no HWNDs, pids, process creation strings, SIDs, paths, or titles.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tiler_core::boundary::{CoreCommand, CoreReply};
use tiler_core::directional::WindowId;
use tiler_core::engine::Engine;
use tiler_core::geometry::Rect;
use tiler_core::ids::{CorrelationId, GenerationId, OwnerId};
use tiler_core::session::DesiredGeometry;
use windows_sys::Win32::Foundation::{HWND, LPARAM, RECT};
use windows_sys::Win32::Graphics::Dwm::DwmGetWindowAttribute;
use windows_sys::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
};
use windows_sys::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent};
use windows_sys::Win32::UI::HiDpi::{
    AreDpiAwarenessContextsEqual, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, GetDpiForWindow,
    GetThreadDpiAwarenessContext, SetProcessDpiAwarenessContext,
};
use windows_sys::Win32::UI::WindowsAndMessaging::MsgWaitForMultipleObjectsEx;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, EVENT_OBJECT_CREATE, EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE,
    EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_SHOW, EVENT_SYSTEM_FOREGROUND,
    EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZESTART, EnumChildWindows, EnumWindows, GW_OWNER,
    GWL_EXSTYLE, GWL_STYLE, GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindow,
    GetWindowLongW, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible, IsZoomed,
    MSG, PM_REMOVE, PeekMessageW, QS_ALLINPUT, SWP_NOACTIVATE, SWP_NOZORDER, SetWindowPos,
    TranslateMessage, WINEVENT_OUTOFCONTEXT, WS_CAPTION, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

use crate::lifecycle::{is_medium_rid, sys::stop_requested};
use crate::model::ProcessIdentity;
use crate::native::{HeldProcess, has_terminal_ancestor};
use crate::tiling::{
    AllowEntry, CaptureOptions, ChildrenOptions, FrameInsets, GestureIntent, INNER_GAP,
    InspectOptions, OUTER_GAP, OWNER_ID, ObservedTarget, ObservedTargetRef, ReadbackOutcome,
    RefusedTracker, SkipReason, StatelessVerdict, TileOptions, TileProofOptions, TokenMap,
    WindowFacts, allow_match, allowlist_digest, build_reconcile_event, classify, classify_gesture,
    fingerprint, inspect_stateless_verdict, is_borderless_fullscreen, parse_allowlist,
    readback_outcome, tick_summary_signature, tiling_domain_bounds,
};

type DynError = Box<dyn std::error::Error>;
type Result<T> = std::result::Result<T, DynError>;

fn err(msg: impl Into<String>) -> DynError {
    Box::new(std::io::Error::other(msg.into()))
}

// Extended-frame-bounds and cloaked attribute ids (stable DWM ABI).
const DWMWA_EXTENDED_FRAME_BOUNDS: u32 = 9;
const DWMWA_CLOAKED: u32 = 14;
const MONITORINFOF_PRIMARY: u32 = 1;
// Win32 object id for window-scoped events (filters out menu/scrollbar noise).
const OBJID_WINDOW: i32 = 0;
const TICK_POLL_MS: u32 = 100;
const SLOW_POLL_MS: u64 = 2000;

/// Shell classes that are never tile targets.
fn is_shell_class(class: &str) -> bool {
    matches!(
        class,
        "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "DV2ControlHost"
    )
}

/// Generic Win32 dialog class. Unowned top-level dialogs are never tile
/// targets; owned ones are already excluded as owned dialogs.
const DIALOG_CLASS: &str = "#32770";

fn rect_from_win(rect: RECT) -> Option<Rect> {
    let w = (rect.right as i64 - rect.left as i64).try_into().ok()?;
    let h = (rect.bottom as i64 - rect.top as i64).try_into().ok()?;
    if w <= 0 || h <= 0 {
        return None;
    }
    Some(Rect {
        x: rect.left,
        y: rect.top,
        w,
        h,
    })
}

/// Verify Per-Monitor-V2 awareness before any geometry call. Checks the
/// effective context first (a manifest may already set it) and only sets when
/// needed, verifying afterward. Fails closed: a wrong awareness mode
/// silently virtualizes every rectangle.
pub(crate) fn ensure_pm_v2() -> Result<()> {
    let current = unsafe { GetThreadDpiAwarenessContext() };
    if unsafe { AreDpiAwarenessContextsEqual(current, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) }
        != 0
    {
        return Ok(());
    }
    if unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) } == 0 {
        return Err(err("refuse: SetProcessDpiAwarenessContext failed"));
    }
    let current = unsafe { GetThreadDpiAwarenessContext() };
    if unsafe { AreDpiAwarenessContextsEqual(current, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) }
        == 0
    {
        return Err(err("refuse: PMv2 awareness not active"));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
struct MonitorArea {
    work: Rect,
    full: Rect,
}

unsafe extern "system" fn monitor_enum(
    monitor: HMONITOR,
    _hdc: HDC,
    _rect: *mut RECT,
    state: LPARAM,
) -> i32 {
    let out = unsafe { &mut *(state as *mut Vec<MonitorArea>) };
    let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
        return 1;
    }
    let work = RECT {
        left: info.rcWork.left,
        top: info.rcWork.top,
        right: info.rcWork.right,
        bottom: info.rcWork.bottom,
    };
    let full = RECT {
        left: info.rcMonitor.left,
        top: info.rcMonitor.top,
        right: info.rcMonitor.right,
        bottom: info.rcMonitor.bottom,
    };
    if let (Some(work), Some(full)) = (rect_from_win(work), rect_from_win(full)) {
        let area = MonitorArea { work, full };
        let primary = info.dwFlags & MONITORINFOF_PRIMARY != 0;
        if primary {
            out.insert(0, area);
        } else {
            out.push(area);
        }
    }
    1
}

/// All monitor areas in physical pixels, primary first. Fails when no
/// monitor enumerates: the caller retains Engine state and skips the tick.
fn all_monitors() -> Result<Vec<MonitorArea>> {
    let mut areas: Vec<MonitorArea> = Vec::new();
    let ok = unsafe {
        EnumDisplayMonitors(
            std::ptr::null_mut(),
            std::ptr::null(),
            Some(monitor_enum),
            &mut areas as *mut Vec<MonitorArea> as LPARAM,
        )
    };
    if ok == 0 || areas.is_empty() {
        return Err(err("error: monitor enumeration failed"));
    }
    Ok(areas)
}

/// Full `rcMonitor` bounds of every display for the portable fullscreen
/// predicate (whole-monitor coverage, not work area).
fn monitor_fulls(areas: &[MonitorArea]) -> Vec<Rect> {
    areas.iter().map(|a| a.full).collect()
}

// Hook delivery: out-of-context callbacks run on the installing (loop) thread
// while it pumps messages, so the callback and the loop share one queue lock
// with a strict invariant - the loop never holds it across a message pump -
// and the callback takes it blocking (never try_lock-and-drop, lossless).
#[derive(Debug, Clone, Copy)]
enum HookEvent {
    Wake,
    MoveSizeStart(isize),
    MoveSizeEnd(isize),
}

fn hook_queue() -> &'static Mutex<Vec<HookEvent>> {
    static QUEUE: OnceLock<Mutex<Vec<HookEvent>>> = OnceLock::new();
    QUEUE.get_or_init(|| Mutex::new(Vec::new()))
}

fn push_hook(event: HookEvent) {
    if let Ok(mut queue) = hook_queue().lock() {
        queue.push(event);
    }
}

unsafe extern "system" fn winevent_proc(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    if event == EVENT_SYSTEM_MOVESIZESTART {
        push_hook(HookEvent::MoveSizeStart(hwnd as isize));
    } else if event == EVENT_SYSTEM_MOVESIZEEND {
        push_hook(HookEvent::MoveSizeEnd(hwnd as isize));
    } else if id_object == OBJID_WINDOW
        && matches!(
            event,
            EVENT_SYSTEM_FOREGROUND
                | EVENT_OBJECT_CREATE
                | EVENT_OBJECT_DESTROY
                | EVENT_OBJECT_SHOW
                | EVENT_OBJECT_HIDE
                | EVENT_OBJECT_LOCATIONCHANGE
        )
    {
        push_hook(HookEvent::Wake);
    }
}

/// Pump loop-thread messages (delivering hook callbacks) then wait for more.
/// One thread owns install, pump, and uninstall: no join, no hang.
fn pump_wait(timeout_ms: u32) {
    let mut msg: MSG = unsafe { std::mem::zeroed() };
    loop {
        let has = unsafe { PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) };
        if has == 0 {
            break;
        }
        unsafe {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    unsafe {
        MsgWaitForMultipleObjectsEx(0, std::ptr::null(), timeout_ms, QS_ALLINPUT, 0);
    }
    loop {
        let has = unsafe { PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) };
        if has == 0 {
            break;
        }
        unsafe {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

struct ObservedWindow {
    hwnd: u64,
    token: String,
    /// Native outer rectangle from the same `GetWindowRect` read the frame
    /// insets were measured against: one coherent observe pair, never a
    /// second torn read.
    outer: Rect,
    visible: Rect,
    insets: FrameInsets,
    identity: ObservedTarget,
    facts: WindowFacts,
}

fn class_of(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    let n = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    if n <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..n as usize])
}

fn window_identity(hwnd: HWND, hwnd_u64: u64, me: &ProcessIdentity) -> Option<ObservedTarget> {
    let mut pid: u32 = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut pid);
    }
    // The owner never tiles itself.
    if pid == 0 || pid == me.pid {
        return None;
    }
    let held = HeldProcess::open(pid).ok()?;
    let ident = held.identity().ok()?;
    if ident.pid != pid {
        return None;
    }
    if ident.user_sid != me.user_sid || ident.session_id != me.session_id {
        return None;
    }
    let rid = held.integrity().ok()?;
    if !is_medium_rid(rid) {
        return None;
    }
    let terminal_ancestor = has_terminal_ancestor(pid).unwrap_or(true);
    Some(ObservedTarget {
        hwnd: hwnd_u64,
        pid,
        process_creation: ident.process_creation,
        exe_path: ident.exe_path,
        user_sid: ident.user_sid,
        session_id: ident.session_id,
        terminal_ancestor,
        tag: owned_tag(hwnd),
    })
}

/// Owned-helper lifetime tag (`PlasmaAutoTilerLifetime` property). Empty when
/// absent: generic windows never carry it, so proof allowlists requiring a
/// nonempty tag reject them before any write.
fn owned_tag(hwnd: HWND) -> String {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetPropW;
    let name: Vec<u16> = crate::test_window::TEST_WINDOW_PROP
        .encode_utf16()
        .chain([0])
        .collect();
    let v = unsafe { GetPropW(hwnd, name.as_ptr()) };
    if v.is_null() {
        return String::new();
    }
    let token = v as usize as u64;
    if token == 0 {
        return String::new();
    }
    format!("{token:016x}")
}

/// Proof-only owned-helper verification: sibling executable, owned class,
/// lifetime tag, full process identity, medium integrity, and Terminal
/// ancestry exclusion via [`crate::test_window::sys::query_owned`]. Generic
/// windows (including otherwise eligible ordinary apps) fail here even when
/// their rectangles look tileable.
fn verify_proof_owned(
    hwnd_u64: u64,
    expected: &AllowEntry,
    me: &ProcessIdentity,
) -> std::result::Result<(), &'static str> {
    let helper_exe =
        crate::test_window::sys::sibling_helper_exe().map_err(|_| "identity-changed")?;
    let snap =
        crate::test_window::sys::query_owned(hwnd_u64, &helper_exe, &me.user_sid, me.session_id)
            .map_err(|_| "identity-changed")?;
    if snap.tag != expected.tag || snap.tag.is_empty() {
        return Err("identity-changed");
    }
    if snap.process.pid != expected.pid
        || snap.process.process_creation != expected.process_creation
        || snap.process.user_sid != expected.user_sid
        || snap.process.session_id != expected.session_id
    {
        return Err("identity-changed");
    }
    if !crate::lifecycle::exe_paths_equal(&snap.process.exe_path, &expected.exe_path) {
        return Err("identity-changed");
    }
    Ok(())
}

/// Identity plus distinct window state known after identity resolution but
/// before any frame query: the stable token and the full frozen-matchable
/// identity survive even when DWM has no frame to read.
#[derive(Debug, Clone)]
pub struct KnownIdentity {
    pub identity: ObservedTarget,
    pub token: String,
}

/// Failure modes of [`observe_window`]. Identity and state stay available
/// independently of geometry: a minimized (or otherwise frameless) window
/// reports its known identity with an accurate reason instead of masquerading
/// as a changed identity, and its token stays stable across ticks.
#[derive(Debug, Clone)]
pub enum ObserveFailure {
    /// Identity never resolved (invisible, vanished, foreign session/SID,
    /// elevated, or unreadable owner): a true unknown, counted in aggregate.
    Unknown,
    /// Identity resolved: retain it, keep its token stable, and skip geometry
    /// with this reason. Boxed: the identity is large and only travels the
    /// cold failure path. `Minimized` is decided from window state before any
    /// frame query; `Unreadable` means the frames failed after identity.
    Known(Box<KnownIdentity>, SkipReason),
}

/// Observe one window fully: identity/state first, geometry second. `IsIconic`
/// is read before any frame query because iconic windows have no DWM frame;
/// a minimized window returns its known identity with `Minimized` rather than
/// an identity error. DWM cloak-query failure fails closed as `Unreadable`,
/// never as eligible. Fullscreen uses whole `rcMonitor` bounds via the
/// portable predicate: captionless covering any monitor's full rect, never
/// dimensions alone.
fn observe_window(
    hwnd: HWND,
    me: &ProcessIdentity,
    fulls: &[Rect],
    tokens: &mut TokenMap,
) -> std::result::Result<ObservedWindow, ObserveFailure> {
    use ObserveFailure::{Known, Unknown};
    if unsafe { IsWindowVisible(hwnd) } == 0 {
        return Err(Unknown);
    }
    let hwnd_u64 = hwnd as usize as u64;
    let identity = window_identity(hwnd, hwnd_u64, me).ok_or(Unknown)?;
    let token = tokens.token_for(hwnd_u64, &identity.process_creation);
    // Token clones below are per-failure (cold paths); the final use moves.
    let known = |reason| {
        Known(
            Box::new(KnownIdentity {
                identity: identity.clone(),
                token: token.clone(),
            }),
            reason,
        )
    };
    // Window state before frames: an iconic window has no composited frame,
    // so its DWM queries would fail spuriously below.
    if unsafe { IsIconic(hwnd) } != 0 {
        return Err(known(SkipReason::Minimized));
    }
    let mut outer_raw: RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(hwnd, &mut outer_raw) } == 0 {
        return Err(known(SkipReason::Unreadable));
    }
    let outer = rect_from_win(outer_raw).ok_or_else(|| known(SkipReason::Unreadable))?;
    let mut visible_raw: RECT = unsafe { std::mem::zeroed() };
    let visible = if unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&mut visible_raw as *mut RECT).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
    } == 0
    {
        rect_from_win(visible_raw).ok_or_else(|| known(SkipReason::Unreadable))?
    } else {
        return Err(known(SkipReason::Unreadable));
    };
    if !tiler_core::bounds::valid_carried_rect(visible.x, visible.y, visible.w, visible.h) {
        return Err(known(SkipReason::Unreadable));
    }
    let mut cloaked: i32 = 0;
    if unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&mut cloaked as *mut i32).cast(),
            std::mem::size_of::<i32>() as u32,
        )
    } != 0
    {
        return Err(known(SkipReason::Unreadable));
    }
    let style = unsafe { GetWindowLongW(hwnd, GWL_STYLE) } as u32;
    let exstyle = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32;
    let owned = !unsafe { GetWindow(hwnd, GW_OWNER) }.is_null();
    let class = class_of(hwnd);
    let captionless = style & WS_CAPTION == 0;
    let facts = WindowFacts {
        visible: true,
        minimized: unsafe { IsIconic(hwnd) } != 0,
        maximized: unsafe { IsZoomed(hwnd) } != 0,
        cloaked: cloaked != 0,
        elevated: false,
        shell: is_shell_class(&class),
        tool_window: exstyle & WS_EX_TOOLWINDOW != 0,
        owned,
        captionless_fullscreen: is_borderless_fullscreen(captionless, visible, fulls),
        terminal_ancestor: identity.terminal_ancestor,
        no_activate: exstyle & WS_EX_NOACTIVATE != 0,
        dialog: !owned && class == DIALOG_CLASS,
    };
    Ok(ObservedWindow {
        hwnd: hwnd_u64,
        token,
        outer,
        visible,
        insets: FrameInsets::measure(outer, visible),
        identity,
        facts,
    })
}

unsafe extern "system" fn enum_proc(hwnd: HWND, state: LPARAM) -> i32 {
    let out = unsafe { &mut *(state as *mut Vec<isize>) };
    out.push(hwnd as isize);
    1
}

/// Enumerate top-level HWNDs. `None` on API failure: the caller retains Engine
/// state and skips the tick, never treating a failed enumeration as a
/// complete (possibly empty) observation.
fn enumerate_hwnds() -> Option<Vec<isize>> {
    let mut out: Vec<isize> = Vec::new();
    let ok = unsafe { EnumWindows(Some(enum_proc), &mut out as *mut Vec<isize> as LPARAM) };
    if ok == 0 { None } else { Some(out) }
}

fn cursor_pos() -> Option<(i32, i32)> {
    let mut point = windows_sys::Win32::Foundation::POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut point) } == 0 {
        return None;
    }
    Some((point.x, point.y))
}

fn log_json_at(path: &Path, value: serde_json::Value) {
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{value}");
    }
}

struct TileLoop {
    engine: Engine,
    owner: OwnerId,
    generation: GenerationId,
    tokens: TokenMap,
    refused: RefusedTracker,
    /// Stable pre-gesture rectangles from the last reconcile observation.
    stable: HashMap<u64, Rect>,
    /// Managed HWNDs from the last reconcile observation.
    managed: HashSet<u64>,
    /// Open user gestures on managed windows only.
    active: HashSet<u64>,
    /// Pre-gesture rectangles captured at START (from `stable`, never from a
    /// mid-gesture frame).
    gesture_before: HashMap<u64, Rect>,
    tick: u64,
    allowlist: Option<Vec<AllowEntry>>,
    trace: bool,
    suspended: bool,
    last_summary: Option<String>,
    log_path: std::path::PathBuf,
    audit_path: Option<std::path::PathBuf>,
    /// Raw `EnumWindows` count from the latest observation (targets seen
    /// before any eligibility filtering, including zero).
    last_enumerated: usize,
}

impl TileLoop {
    fn domain_key(&self) -> tiler_core::session::DomainKey {
        tiler_core::session::DomainKey {
            output: tiler_core::directional::OutputId(crate::tiling::OUTPUT_ID.to_owned()),
            workspace: tiler_core::directional::WorkspaceId(crate::tiling::WORKSPACE_ID.to_owned()),
        }
    }

    fn revision(&self) -> u64 {
        let key = self.domain_key();
        self.engine
            .session(&key)
            .map(|s| s.accepted_revision())
            .unwrap_or(0)
    }

    fn correlation(&self) -> CorrelationId {
        CorrelationId::parse(&format!("tick-{}", self.tick))
            .expect("tick correlation is a valid token")
    }

    /// Full enumeration with per-window eligibility. Proof mode prefilters by
    /// frozen-allowlist HWND before any per-window query, so non-owned windows
    /// never mint tokens, churn the map, or enter logs; `EnumWindows` still
    /// yields the complete raw count. Proof mode additionally requires
    /// frozen-allowlist membership, owned-helper verification (sibling
    /// exe/class/lifetime-tag plus Terminal exclusion), and excludes the
    /// Terminal tree (via `classify`); malformed allowlist state is
    /// unreachable here because `cmd_tile_proof` refuses it before the loop
    /// starts. Invisible allowlist members stay frozen (not eligible) until an
    /// exact-bound `show` admission. Returns `None` when enumeration itself
    /// failed: the tick is skipped with retained Engine state.
    fn observe(
        &mut self,
        me: &ProcessIdentity,
        fulls: &[Rect],
        skipped: &mut Vec<(String, String)>,
    ) -> Option<Vec<ObservedWindow>> {
        use ObserveFailure::{Known, Unknown};
        let proof_mode = self.allowlist.is_some();
        let hwnds = enumerate_hwnds()?;
        self.last_enumerated = hwnds.len();
        let mut out = Vec::new();
        let mut unreadable = 0usize;
        // Every resolved identity pair mints or reuses a token; retain all of
        // them below (eligible, skipped, and frame-failed) so known windows
        // keep stable tokens instead of churning one new token per tick.
        let mut enumerated: Vec<(u64, String)> = Vec::new();
        for raw in hwnds {
            let hwnd = raw as HWND;
            if proof_mode {
                // Frozen-HWND prefilter before any per-window query.
                let entries = self.allowlist.as_ref().expect("proof mode has allowlist");
                if !entries
                    .iter()
                    .any(|entry| entry.hwnd == raw as usize as u64)
                {
                    continue;
                }
            }
            let window = match observe_window(hwnd, me, fulls, &mut self.tokens) {
                Ok(window) => window,
                Err(Known(known, reason)) => {
                    // Identity known: retain it and skip with the accurate
                    // reason (minimized needs no frame; unreadable keeps its
                    // stable token instead of counting as changed identity).
                    enumerated.push((known.identity.hwnd, known.identity.process_creation.clone()));
                    skipped.push((known.token, reason.as_str().to_owned()));
                    continue;
                }
                Err(Unknown) => {
                    unreadable += 1;
                    continue;
                }
            };
            enumerated.push((window.hwnd, window.identity.process_creation.clone()));
            if proof_mode {
                let entries = self.allowlist.as_ref().expect("proof mode has allowlist");
                let Some(entry) = entries
                    .iter()
                    .find(|entry| allow_match(entry, &window.identity))
                else {
                    continue;
                };
                // Owned-helper gate: non-owned windows never enter management
                // even when otherwise eligible. Invisible frozen members are
                // still verified (passive admission) but stay skipped until
                // shown.
                if verify_proof_owned(window.hwnd, entry, me).is_err() {
                    skipped.push((window.token.clone(), "identity-changed".to_owned()));
                    continue;
                }
            }
            match classify(&window.facts, proof_mode) {
                Ok(()) => {
                    out.push(window);
                }
                Err(reason) => {
                    skipped.push((window.token.clone(), reason.as_str().to_owned()));
                }
            }
        }
        // Bounded retain over every enumerated pair, never HWND alone and
        // never eligible-only: skipped identities keep their tokens.
        let live_refs: Vec<ObservedTargetRef<'_>> = enumerated
            .iter()
            .map(|(hwnd, creation)| ObservedTargetRef {
                hwnd: *hwnd,
                creation,
            })
            .collect();
        self.tokens.retain(&live_refs);
        if unreadable > 0 {
            skipped.push((
                format!("unreadable-{unreadable}"),
                SkipReason::Unreadable.as_str().to_owned(),
            ));
        }
        Some(out)
    }

    fn focused_token(&self, observed: &[ObservedWindow]) -> Option<WindowId> {
        let foreground = unsafe { GetForegroundWindow() } as usize as u64;
        observed
            .iter()
            .find(|w| w.hwnd == foreground)
            .map(|w| WindowId(w.token.clone()))
    }
}

/// Revalidate one write target immediately before `SetWindowPos`: fresh
/// eligibility, fresh full identity compared against the cached expectation
/// and the frozen allowlist, with the process held open across the write.
/// Returns the fresh observation plus the held process (liveness guard).
struct WriteTarget {
    window: ObservedWindow,
    held: HeldProcess,
}

fn revalidate_target(
    expected: &ObservedWindow,
    me: &ProcessIdentity,
    fulls: &[Rect],
    tokens: &mut TokenMap,
    proof_mode: bool,
    allowlist: Option<&Vec<AllowEntry>>,
) -> std::result::Result<WriteTarget, &'static str> {
    let hwnd = expected.hwnd as isize as HWND;
    let mut pid: u32 = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut pid);
    }
    if pid == 0 || pid != expected.identity.pid {
        return Err("pid-changed");
    }
    let held = HeldProcess::open(pid).map_err(|_| "identity-changed")?;
    let ident = held.identity().map_err(|_| "identity-changed")?;
    if ident.pid != pid
        || ident.process_creation != expected.identity.process_creation
        || ident.exe_path != expected.identity.exe_path
        || ident.user_sid != expected.identity.user_sid
        || ident.session_id != expected.identity.session_id
    {
        return Err("identity-changed");
    }
    if ident.user_sid != me.user_sid || ident.session_id != me.session_id {
        return Err("identity-changed");
    }
    let rid = held.integrity().map_err(|_| "identity-changed")?;
    if !is_medium_rid(rid) {
        return Err("integrity-changed");
    }
    let terminal_ancestor = has_terminal_ancestor(pid).map_err(|_| "identity-changed")?;
    let mut fresh = observe_window(hwnd, me, fulls, tokens).map_err(|_| "ineligible")?;
    fresh.identity.terminal_ancestor = terminal_ancestor;
    fresh.facts.terminal_ancestor = terminal_ancestor;
    if proof_mode {
        let entries = allowlist.ok_or("allowlist-missing")?;
        let Some(entry) = entries
            .iter()
            .find(|entry| allow_match(entry, &fresh.identity))
        else {
            return Err("allowlist-changed");
        };
        // Owned-helper gate immediately before the setter: sibling
        // exe/class/tag plus Terminal exclusion, no ordinary fallback.
        verify_proof_owned(fresh.hwnd, entry, me)?;
    }
    classify(&fresh.facts, proof_mode).map_err(|reason| reason.as_str())?;
    if fresh.token != expected.token {
        return Err("identity-changed");
    }
    Ok(WriteTarget {
        window: fresh,
        held,
    })
}

/// Recheck the HWND's current pid after the write (recycled-HWND guard).
fn pid_current(hwnd_u64: u64, pid: u32) -> bool {
    let hwnd = hwnd_u64 as isize as HWND;
    let mut current: u32 = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut current);
    }
    current != 0 && current == pid
}

/// Geometry-bearing plan entries with Engine constraint flags.
struct DesiredEntry {
    window: WindowId,
    rect: Rect,
    overconstrained: bool,
    client_clamped: bool,
}

fn desired_entries(reply: &CoreReply) -> Option<Vec<DesiredEntry>> {
    fn map(geometry: &[DesiredGeometry]) -> Vec<DesiredEntry> {
        geometry
            .iter()
            .map(|g| DesiredEntry {
                window: g.window.clone(),
                rect: g.rect,
                overconstrained: g.overconstrained,
                client_clamped: g.client_clamped,
            })
            .collect()
    }
    match reply {
        CoreReply::Projection(plan) => Some(map(&plan.geometry)),
        CoreReply::Tiled(plan) => Some(map(&plan.geometry)),
        CoreReply::Resize(plan) => Some(map(&plan.geometry)),
        _ => None,
    }
}

/// Run one reconcile tick: enumerate, build the complete observation, handle
/// through the Engine, apply desired geometry, read back.
fn reconcile_tick(state: &mut TileLoop, me: &ProcessIdentity, fulls: &[Rect], domain: Rect) {
    state.tick += 1;
    let tick = state.tick;
    let correlation = state.correlation();
    let mut skipped: Vec<(String, String)> = Vec::new();
    let log_path = state.log_path.clone();
    let Some(observed) = state.observe(me, fulls, &mut skipped) else {
        log_json_at(
            &log_path,
            serde_json::json!({"event":"tick-skip","tick":tick,"cause":"enum-failed"}),
        );
        return;
    };
    state.managed = observed.iter().map(|w| w.hwnd).collect();
    state.stable = observed.iter().map(|w| (w.hwnd, w.visible)).collect();
    state
        .gesture_before
        .retain(|hwnd, _| state.managed.contains(hwnd));
    // Structured observer tick before Engine dispatch: full EnumWindows
    // success with the raw enumerated count and the managed (eligible,
    // allowlisted) count, including zero. A zero managed set is a completed
    // observation, not a failure: the Engine may answer Rejected for an empty
    // domain and the nonmoving proof must not require a layout plan.
    let enumerated = state.last_enumerated;
    let managed = observed.len();
    if state.trace {
        log_json_at(
            &log_path,
            serde_json::json!({
                "event": "observe",
                "tick": tick,
                "op": "reconcile",
                "enumerated": enumerated,
                "managed": managed,
            }),
        );
    }
    if let Some(audit) = state.audit_path.clone() {
        log_json_at(
            &audit,
            serde_json::json!({
                "event": "proof-observe",
                "tick": tick,
                "op": "reconcile",
                "enumerated": enumerated,
                "managed": managed,
            }),
        );
    }
    let pairs: Vec<(String, Rect)> = observed
        .iter()
        .map(|w| (w.token.clone(), w.visible))
        .collect();
    let fp = fingerprint(&pairs);
    let windows: Vec<(WindowId, Rect)> = observed
        .iter()
        .map(|w| (WindowId(w.token.clone()), w.visible))
        .collect();
    let focused = state.focused_token(&observed);
    let event = build_reconcile_event(&crate::tiling::ReconcileInput {
        owner: &state.owner,
        generation: &state.generation,
        correlation: &correlation,
        revision: state.revision(),
        fingerprint: fp,
        domain_bounds: domain,
        windows: &windows,
        focused: focused.as_ref(),
    });
    let reply = state.engine.handle(&event);
    apply_geometry(
        state,
        ApplyInput {
            me,
            fulls,
            reply: &reply,
            observed: &observed,
            op: "reconcile",
            tick,
            skipped,
        },
    );
}

/// Bundled inputs for one geometry application pass.
struct ApplyInput<'a> {
    me: &'a ProcessIdentity,
    fulls: &'a [Rect],
    reply: &'a CoreReply,
    observed: &'a [ObservedWindow],
    op: &'a str,
    tick: u64,
    skipped: Vec<(String, String)>,
}

fn audit_json(state: &TileLoop, value: serde_json::Value) {
    if let Some(path) = state.audit_path.as_ref() {
        log_json_at(path, value);
    }
}

fn apply_geometry(state: &mut TileLoop, input: ApplyInput<'_>) {
    let ApplyInput {
        me,
        fulls,
        reply,
        observed,
        op,
        tick,
        mut skipped,
    } = input;
    let log_path = state.log_path.clone();
    let Some(desired) = desired_entries(reply) else {
        let outcome = match reply {
            CoreReply::Rejected { kind, .. } => ("rejected", *kind),
            CoreReply::Diverged(reason) => ("diverged", reason.as_str()),
            CoreReply::SnapshotInvalid { detail, .. } => ("snapshot-invalid", *detail),
            _ => ("unexpected-reply", "unhandled-variant"),
        };
        log_json_at(
            &log_path,
            serde_json::json!({
                "event": "reply",
                "tick": tick,
                "op": op,
                "outcome": outcome.0,
                "kind": outcome.1,
            }),
        );
        return;
    };
    let by_token: HashMap<&str, &ObservedWindow> =
        observed.iter().map(|w| (w.token.as_str(), w)).collect();
    let by_hwnd: HashMap<u64, &ObservedWindow> = observed.iter().map(|w| (w.hwnd, w)).collect();
    let proof_mode = state.allowlist.is_some();
    let now = Instant::now();
    let mut applied = 0usize;
    // Tokens whose setter succeeded this tick. Only these may enter the
    // app-clamp lane on readback mismatch; failed or skipped setters keep
    // the transient/backoff lanes intact.
    let mut written: HashSet<String> = HashSet::new();
    for entry in &desired {
        if entry.overconstrained {
            skipped.push((entry.window.0.clone(), "overconstrained".to_owned()));
            continue;
        }
        if entry.client_clamped {
            skipped.push((entry.window.0.clone(), "client-clamped".to_owned()));
            continue;
        }
        let Some(expected) = by_token.get(entry.window.0.as_str()) else {
            skipped.push((entry.window.0.clone(), "vanished".to_owned()));
            continue;
        };
        if expected.visible == entry.rect {
            state.refused.note_match(&entry.window.0);
            continue;
        }
        if state
            .refused
            .should_skip(&entry.window.0, &entry.rect, &expected.visible, now)
        {
            skipped.push((entry.window.0.clone(), "refused-intent".to_owned()));
            continue;
        }
        // Snapshot the pre-write identity for the proof audit before the
        // revalidation borrows `state.tokens` mutably.
        let audit_pre = if proof_mode {
            by_hwnd.get(&expected.hwnd).map(|w| {
                (
                    w.identity.pid,
                    w.identity.process_creation.clone(),
                    w.identity.exe_path.clone(),
                    w.identity.user_sid.clone(),
                    w.identity.session_id,
                    w.identity.tag.clone(),
                )
            })
        } else {
            None
        };
        let target = match revalidate_target(
            expected,
            me,
            fulls,
            &mut state.tokens,
            proof_mode,
            state.allowlist.as_ref(),
        ) {
            Ok(target) => target,
            Err(reason) => {
                skipped.push((entry.window.0.clone(), reason.to_owned()));
                if proof_mode {
                    audit_json(
                        state,
                        serde_json::json!({
                            "event": "proof-skip",
                            "tick": tick,
                            "op": op,
                            "window": entry.window.0,
                            "requested": [entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h],
                            "reason": reason,
                        }),
                    );
                }
                continue;
            }
        };
        let Some(outer) = target.window.insets.visible_to_outer(entry.rect) else {
            skipped.push((entry.window.0.clone(), "frame-overflow".to_owned()));
            continue;
        };
        // User safety across the tick: a fullscreen foreground that arrived
        // after the loop guard must veto this write, not ride along.
        if foreground_fullscreen(fulls) {
            skipped.push((entry.window.0.clone(), "fullscreen-foreground".to_owned()));
            continue;
        }
        let hwnd = target.window.hwnd as isize as HWND;
        let ok = unsafe {
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                outer.x,
                outer.y,
                outer.w,
                outer.h,
                SWP_NOACTIVATE | SWP_NOZORDER,
            )
        };
        // The held process keeps liveness authority across the write; recheck
        // the HWND pid afterward against recycling.
        let _ = &target.held;
        let pid_ok = pid_current(target.window.hwnd, target.window.identity.pid);
        if proof_mode {
            let (pid, creation, exe, sid, session, tag) = audit_pre.unwrap_or_else(|| {
                (
                    target.window.identity.pid,
                    target.window.identity.process_creation.clone(),
                    target.window.identity.exe_path.clone(),
                    target.window.identity.user_sid.clone(),
                    target.window.identity.session_id,
                    target.window.identity.tag.clone(),
                )
            });
            audit_json(
                state,
                serde_json::json!({
                    "event": "proof-write",
                    "tick": tick,
                    "op": op,
                    "window": entry.window.0,
                    "requested": [entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h],
                    "outer": [outer.x, outer.y, outer.w, outer.h],
                    "target": {
                        "hwnd": target.window.hwnd,
                        "pid": pid,
                        "process_creation": creation,
                        "exe_path": exe,
                        "user_sid": sid,
                        "session_id": session,
                        "tag": tag,
                    },
                    "flags": "SWP_NOACTIVATE|SWP_NOZORDER",
                    "outcome": if ok != 0 && pid_ok { "written" } else if ok == 0 { "setter-failed" } else { "pid-changed" },
                }),
            );
        }
        if !pid_ok {
            skipped.push((entry.window.0.clone(), "pid-changed".to_owned()));
            continue;
        }
        if ok == 0 {
            skipped.push((entry.window.0.clone(), "setter-failed".to_owned()));
            state
                .refused
                .note_transient(&entry.window.0, &entry.rect, &target.window.visible, now);
            continue;
        }
        applied += 1;
        written.insert(entry.window.0.clone());
        if state.trace {
            log_json_at(
                &log_path,
                serde_json::json!({
                    "event": "write",
                    "tick": tick,
                    "op": op,
                    "window": entry.window.0,
                    "desired": [entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h],
                }),
            );
        }
    }
    // Complete Engine plan for this tick: every desired entry, not only the
    // changed writes, so proof can compare the full requested set.
    if state.trace {
        let plan: Vec<serde_json::Value> = desired
            .iter()
            .map(|entry| {
                serde_json::json!({
                    "window": entry.window.0,
                    "rect": [entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h],
                })
            })
            .collect();
        log_json_at(
            &log_path,
            serde_json::json!({
                "event": "plan",
                "tick": tick,
                "op": op,
                "entries": plan,
            }),
        );
    }
    // Independent readback: a second full observation pass, never the setter
    // result. Successful writes that still mismatch are app-held sizes (clamp
    // lane); failed setters already took the transient lane above. The
    // readback pass reuses the same full-monitor list so DWM pre/post frame
    // math stays coherent within the tick.
    let reread_fulls = fulls.to_vec();
    let mut reread_skipped = Vec::new();
    let reread = state.observe(me, &reread_fulls, &mut reread_skipped);
    let mut mismatched = 0usize;
    if let Some(reread) = reread {
        // Stable pre-gesture state follows the AFTER-actuation observation,
        // never the pre-apply frame the Engine just consumed.
        state.managed = reread.iter().map(|w| w.hwnd).collect();
        state.stable = reread.iter().map(|w| (w.hwnd, w.visible)).collect();
        state
            .gesture_before
            .retain(|hwnd, _| state.managed.contains(hwnd));
        let reread_by_token: HashMap<&str, Rect> = reread
            .iter()
            .map(|w| (w.token.as_str(), w.visible))
            .collect();
        for entry in &desired {
            match reread_by_token.get(entry.window.0.as_str()) {
                Some(visible) => {
                    match readback_outcome(
                        written.contains(entry.window.0.as_str()),
                        &entry.rect,
                        visible,
                    ) {
                        ReadbackOutcome::Match => {
                            state.refused.note_match(&entry.window.0);
                        }
                        ReadbackOutcome::Clamp => {
                            mismatched += 1;
                            state
                                .refused
                                .note_clamp(&entry.window.0, &entry.rect, visible);
                        }
                        ReadbackOutcome::Pending => {
                            // No write behind this mismatch (skipped or
                            // refused intent): count it, but leave the
                            // tracker lanes alone so a later matching
                            // re-read still converges instead of sticking
                            // as a permanent clamp.
                            mismatched += 1;
                        }
                    }
                }
                None => {
                    skipped.push((entry.window.0.clone(), "vanished".to_owned()));
                }
            }
        }
        let live: Vec<&str> = reread_by_token.keys().copied().collect();
        state.refused.retain(&live);
        if state.trace {
            let detail: Vec<serde_json::Value> = desired
                .iter()
                .map(|entry| {
                    let readback = reread_by_token.get(entry.window.0.as_str());
                    serde_json::json!({
                        "window": entry.window.0,
                        "desired": [entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h],
                        "readback": readback.map(|r| [r.x, r.y, r.w, r.h]),
                        "matched": readback.is_some_and(|r| r == &entry.rect),
                    })
                })
                .collect();
            log_json_at(
                &log_path,
                serde_json::json!({
                    "event": "readback-detail",
                    "tick": tick,
                    "op": op,
                    "entries": detail,
                }),
            );
        }
    }
    skipped.extend(reread_skipped);
    if mismatched > 0 {
        log_json_at(
            &log_path,
            serde_json::json!({
                "event": "readback",
                "tick": tick,
                "op": op,
                "mismatched": mismatched,
            }),
        );
    }
    // Routine zero-change ticks stay quiet; anything else logs one summary.
    // The dedupe signature carries no tick (stable-noop): an identical
    // observation must stay quiet no matter how many ticks pass. Bounded: the
    // sorted skip list is the full signal, no arbitrary caps.
    let mut summary_skipped = skipped.clone();
    summary_skipped.sort();
    let signature = tick_summary_signature(
        observed.len(),
        applied,
        &summary_skipped,
        mismatched,
        op,
        state.revision(),
    );
    let changed = state.last_summary.as_ref() != Some(&signature);
    if changed || state.trace {
        state.last_summary = Some(signature);
        let skipped_json: Vec<serde_json::Value> = summary_skipped
            .into_iter()
            .map(|(window, reason)| serde_json::json!({"window": window, "reason": reason}))
            .collect();
        log_json_at(
            &log_path,
            serde_json::json!({
                "event": "tick",
                "tick": tick,
                "op": op,
                "correlation": format!("tick-{tick}"),
                "windows": observed.len(),
                "applied": applied,
                "mismatched": mismatched,
                "skipped": skipped_json,
            }),
        );
    }
}

fn gesture_tick(
    state: &mut TileLoop,
    me: &ProcessIdentity,
    fulls: &[Rect],
    domain: Rect,
    ended: &[u64],
) {
    let log_path = state.log_path.clone();
    let mut skipped: Vec<(String, String)> = Vec::new();
    let Some(observed) = state.observe(me, fulls, &mut skipped) else {
        log_json_at(
            &log_path,
            serde_json::json!({"event":"tick-skip","tick":state.tick,"cause":"enum-failed"}),
        );
        return;
    };
    let by_hwnd: HashMap<u64, &ObservedWindow> = observed.iter().map(|w| (w.hwnd, w)).collect();
    for hwnd in ended {
        let Some(current) = by_hwnd.get(hwnd) else {
            continue;
        };
        let before = state
            .gesture_before
            .get(hwnd)
            .copied()
            .or_else(|| state.stable.get(hwnd).copied());
        let Some(before) = before else {
            continue;
        };
        let Some(intent) = classify_gesture(&before, &current.visible, cursor_pos()) else {
            continue;
        };
        state.tick += 1;
        let correlation = state.correlation();
        let pairs: Vec<(String, Rect)> = observed
            .iter()
            .map(|w| (w.token.clone(), w.visible))
            .collect();
        let fp = fingerprint(&pairs);
        let windows: Vec<(WindowId, Rect)> = observed
            .iter()
            .map(|w| (WindowId(w.token.clone()), w.visible))
            .collect();
        let mover = WindowId(current.token.clone());
        let event = build_reconcile_event(&crate::tiling::ReconcileInput {
            owner: &state.owner,
            generation: &state.generation,
            correlation: &correlation,
            revision: state.revision(),
            fingerprint: fp,
            domain_bounds: domain,
            windows: &windows,
            focused: Some(&mover),
        });
        let reply = match intent {
            GestureIntent::MoveDrop { x, y } => {
                let mut event = event;
                event.command = CoreCommand::DragDrop {
                    window: current.token.clone(),
                    x,
                    y,
                    hover_prior: None,
                    source: None,
                };
                state.engine.handle(&event)
            }
            GestureIntent::PointerResize {
                direction,
                boundary,
                direction2,
                boundary2,
            } => {
                let mut event = event;
                event.command = CoreCommand::PointerResize {
                    window: current.token.clone(),
                    direction: direction.to_owned(),
                    boundary,
                    direction2: direction2.map(str::to_owned),
                    boundary2,
                };
                state.engine.handle(&event)
            }
        };
        let op = match intent {
            GestureIntent::MoveDrop { .. } => "drag-drop",
            GestureIntent::PointerResize { .. } => "pointer-resize",
        };
        match &reply {
            CoreReply::Tiled(_) | CoreReply::Projection(_) | CoreReply::Resize(_) => {
                let tick = state.tick;
                let fulls_owned = fulls.to_vec();
                apply_geometry(
                    state,
                    ApplyInput {
                        me,
                        fulls: &fulls_owned,
                        reply: &reply,
                        observed: &observed,
                        op,
                        tick,
                        skipped: Vec::new(),
                    },
                );
            }
            _ => {
                // Refusal converges through the next ordinary reconcile,
                // matching the KDE restore-marker outcome with no ledger.
                let fulls_owned = fulls.to_vec();
                reconcile_tick(state, me, &fulls_owned, domain);
            }
        }
    }
    state.gesture_before.clear();
}

fn foreground_fullscreen(fulls: &[Rect]) -> bool {
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.is_null() {
        return false;
    }
    let style = unsafe { GetWindowLongW(foreground, GWL_STYLE) } as u32;
    if style & WS_CAPTION != 0 {
        return false;
    }
    let mut visible_raw: RECT = unsafe { std::mem::zeroed() };
    if unsafe {
        DwmGetWindowAttribute(
            foreground,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&mut visible_raw as *mut RECT).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
    } != 0
    {
        // Unreadable foreground fails closed as fullscreen: never tile under
        // an unknown covering window.
        return true;
    }
    rect_from_win(visible_raw).is_some_and(|visible| is_borderless_fullscreen(true, visible, fulls))
}

fn run_tile_loop(
    dir: &Path,
    me: &ProcessIdentity,
    seconds: Option<u64>,
    trace: bool,
    allowlist: Option<Vec<AllowEntry>>,
    proof: bool,
    raw_argv: Vec<String>,
) -> Result<()> {
    ensure_pm_v2()?;
    let owner = OwnerId::parse(OWNER_ID).expect("static owner token is valid");
    let generation =
        GenerationId::parse(&me.process_creation).ok_or_else(|| err("error: bad generation"))?;
    let log_path = crate::lifecycle::sys::log_path_for(dir, &me.process_creation);
    let audit_path: Option<std::path::PathBuf> = if proof {
        Some(dir.join(format!("proof-audit-{}.jsonl", me.process_creation)))
    } else {
        None
    };
    // Proof audit starts before any geometry: raw received argv (elements
    // stay separate strings so spaces survive without quoting), parsed
    // seconds/trace/mode, and allowlist digest/count. The frozen identity
    // record follows verification below. Raw argv carries flags and paths
    // only (no titles or window content) and never enters production logs.
    if let Some(audit) = audit_path.as_ref() {
        if audit.exists() {
            return Err(err("refuse: audit preexists, will not overwrite"));
        }
        let digest = allowlist
            .as_ref()
            .map(|entries| allowlist_digest(entries))
            .unwrap_or_default();
        let count = allowlist.as_ref().map(|e| e.len()).unwrap_or(0);
        let line = serde_json::json!({
            "event": "proof-start",
            "argv": raw_argv,
            "seconds": seconds,
            "trace": trace,
            "mode": "proof",
            "allowlist_digest": digest,
            "allowlist_count": count,
        });
        log_json_at(audit, line);
    }
    // Proof gate before first geometry: every frozen entry must verify as an
    // owned helper (sibling exe/class/tag, full identity, Terminal excluded).
    // Invisible passive members verify here and stay frozen until `show`.
    if proof {
        let entries = allowlist
            .as_ref()
            .ok_or_else(|| err("refuse: allowlist missing"))?;
        if entries.is_empty() {
            return Err(err("refuse: empty allowlist"));
        }
        for entry in entries {
            verify_proof_owned(entry.hwnd, entry, me).map_err(|reason| {
                err(format!(
                    "refuse: proof allowlist non-owned hwnd={} {reason}",
                    entry.hwnd
                ))
            })?;
        }
        if let Some(audit) = audit_path.as_ref() {
            let frozen: Vec<serde_json::Value> = entries
                .iter()
                .map(|e| {
                    serde_json::json!({
                        "hwnd": e.hwnd,
                        "pid": e.pid,
                        "process_creation": e.process_creation,
                        "exe_path": e.exe_path,
                        "user_sid": e.user_sid,
                        "session_id": e.session_id,
                        "tag": e.tag,
                    })
                })
                .collect();
            log_json_at(
                audit,
                serde_json::json!({"event": "proof-frozen", "windows": frozen}),
            );
        }
    }
    let mut state = TileLoop {
        engine: Engine::new(),
        owner: owner.clone(),
        generation: generation.clone(),
        tokens: TokenMap::default(),
        refused: RefusedTracker::default(),
        stable: HashMap::new(),
        managed: HashSet::new(),
        active: HashSet::new(),
        gesture_before: HashMap::new(),
        tick: 0,
        allowlist,
        trace,
        suspended: false,
        last_summary: None,
        log_path: log_path.clone(),
        audit_path: audit_path.clone(),
        last_enumerated: 0,
    };
    state.engine.sync_binding(&owner, &generation);
    let mut areas = all_monitors()?;
    let (mut monitor, mut monitor_count) = (areas[0], areas.len());
    let mode = if state.allowlist.is_some() {
        "proof"
    } else {
        "normal"
    };
    log_json_at(
        &log_path,
        serde_json::json!({
            "event": "tile-start",
            "mode": mode,
            "trace": trace,
            "monitors": monitor_count,
            "work": [monitor.work.x, monitor.work.y, monitor.work.w, monitor.work.h],
            "full": [monitor.full.x, monitor.full.y, monitor.full.w, monitor.full.h],
            "inner": INNER_GAP,
            "outer": OUTER_GAP,
        }),
    );
    // Hook on this thread; this thread pumps messages, so callbacks run here.
    // Four narrow hooks keep the callback cheap: foreground wakes, move/size
    // transitions queue losslessly, object create/destroy/show/hide wakes,
    // and explicit location-change wakes (a range up to LOCATIONCHANGE would
    // also pull unrelated state-change noise, so it stays separate).
    let hooks = unsafe {
        [
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                std::ptr::null_mut(),
                Some(winevent_proc),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            ),
            SetWinEventHook(
                EVENT_SYSTEM_MOVESIZESTART,
                EVENT_SYSTEM_MOVESIZEEND,
                std::ptr::null_mut(),
                Some(winevent_proc),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            ),
            SetWinEventHook(
                EVENT_OBJECT_CREATE,
                EVENT_OBJECT_SHOW
                    .max(EVENT_OBJECT_DESTROY)
                    .max(EVENT_OBJECT_HIDE),
                std::ptr::null_mut(),
                Some(winevent_proc),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            ),
            SetWinEventHook(
                EVENT_OBJECT_LOCATIONCHANGE,
                EVENT_OBJECT_LOCATIONCHANGE,
                std::ptr::null_mut(),
                Some(winevent_proc),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            ),
        ]
    };
    if hooks.iter().any(|hook| hook.is_null()) {
        for hook in hooks {
            if !hook.is_null() {
                unsafe {
                    UnhookWinEvent(hook);
                }
            }
        }
        return Err(err("error: SetWinEventHook failed"));
    }
    let deadline = seconds.map(|s| Instant::now() + Duration::from_secs(s));
    let mut slow_last = Instant::now();
    let result = (|| -> Result<()> {
        let fulls = monitor_fulls(&areas);
        // Fullscreen guard applies before the initial tick as well.
        if foreground_fullscreen(&fulls) {
            state.suspended = true;
            log_json_at(
                &log_path,
                serde_json::json!({"event":"suspend","cause":"fullscreen-foreground"}),
            );
        } else {
            let Some(domain) = tiling_domain_bounds(monitor.work) else {
                return Err(err("error: work area cannot carry outer gap"));
            };
            reconcile_tick(&mut state, me, &fulls, domain);
        }
        loop {
            if stop_requested(dir, me)? {
                return Ok(());
            }
            if deadline.is_some_and(|end| Instant::now() >= end) {
                return Ok(());
            }
            pump_wait(TICK_POLL_MS);
            let events = hook_queue()
                .lock()
                .map(|mut queue| std::mem::take(&mut *queue))
                .unwrap_or_default();
            let mut woke = false;
            for event in events {
                match event {
                    HookEvent::Wake => woke = true,
                    HookEvent::MoveSizeStart(raw) => {
                        woke = true;
                        let hwnd = raw as u64;
                        // PRE-gesture from the last stable observation, never
                        // from a mid-gesture frame.
                        if let Some(pre) = state.stable.get(&hwnd).copied() {
                            state.gesture_before.entry(hwnd).or_insert(pre);
                        }
                        state.active.insert(hwnd);
                    }
                    HookEvent::MoveSizeEnd(raw) => {
                        woke = true;
                        state.active.remove(&(raw as u64));
                    }
                }
            }
            let now = Instant::now();
            let slow = now.duration_since(slow_last).as_millis() >= u128::from(SLOW_POLL_MS);
            if slow {
                slow_last = now;
                let fresh = all_monitors()?;
                if fresh[0].work != monitor.work || fresh.len() != monitor_count {
                    areas = fresh;
                    monitor = areas[0];
                    monitor_count = areas.len();
                    log_json_at(&log_path, serde_json::json!({"event":"work-area-changed"}));
                    woke = true;
                }
            }
            if !(woke || slow) {
                continue;
            }
            let fulls = monitor_fulls(&areas);
            let Some(domain) = tiling_domain_bounds(monitor.work) else {
                log_json_at(
                    &log_path,
                    serde_json::json!({"event":"tick-skip","tick":state.tick,"cause":"domain-inset"}),
                );
                continue;
            };
            if foreground_fullscreen(&fulls) {
                if !state.suspended {
                    state.suspended = true;
                    log_json_at(
                        &log_path,
                        serde_json::json!({"event":"suspend","cause":"fullscreen-foreground"}),
                    );
                }
                state.gesture_before.clear();
                state.active.clear();
                continue;
            }
            if state.suspended {
                state.suspended = false;
                log_json_at(&log_path, serde_json::json!({"event":"resume"}));
            }
            // Only gestures on managed windows pause tiling; unrelated
            // windows never stall the loop.
            let ended: Vec<u64> = state
                .gesture_before
                .keys()
                .copied()
                .filter(|hwnd| state.managed.contains(hwnd) && !state.active.contains(hwnd))
                .collect();
            // Drop pre-gesture state for windows that left management.
            state
                .gesture_before
                .retain(|hwnd, _| state.managed.contains(hwnd));
            state.active.retain(|hwnd| state.managed.contains(hwnd));
            let paused = state.active.iter().any(|hwnd| state.managed.contains(hwnd));
            if paused {
                continue;
            }
            if ended.is_empty() {
                reconcile_tick(&mut state, me, &fulls, domain);
            } else {
                gesture_tick(&mut state, me, &fulls, domain, &ended);
            }
        }
    })();
    for hook in hooks {
        unsafe {
            UnhookWinEvent(hook);
        }
    }
    log_json_at(
        &log_path,
        serde_json::json!({"event":"tile-end","ticks":state.tick}),
    );
    result
}

/// `tile` command: normal user tiling only (explicit `--user-start`).
/// Geometry is left in place on stop; nothing is hidden or restored.
/// Includes Terminal targets; agents never run this path.
pub fn cmd_tile(options: &TileOptions) -> Result<String> {
    if !options.user_start {
        return Err(err("refuse: tile requires explicit --user-start"));
    }
    let trace = options.trace;
    let seconds = options.seconds;
    crate::lifecycle::sys::run_product(trace, move |dir, me| {
        run_tile_loop(dir, me, seconds, trace, None, false, Vec::new())
    })
}

/// `tile-proof` command: owned-helpers-only proof loop. Requires a nonempty
/// valid `--allowlist` at parse and at native start; malformed, empty,
/// duplicate, untagged, or non-owned entries refuse before any lease or write
/// and never fall back to normal mode. The raw received argv travels with the
/// parsed options into the proof-only audit (never production logs) with a
/// parsed/raw consistency check, so flag delivery is evidenced. Every setter
/// carries a proof audit record (requested/native target plus flags/outcome);
/// production logs stay token-only.
pub fn cmd_tile_proof(options: &TileProofOptions, raw_argv: &[String]) -> Result<String> {
    let text = std::fs::read_to_string(&options.allowlist)
        .map_err(|e| err(format!("error: allowlist read: {e}")))?;
    let entries = parse_allowlist(&text).map_err(err)?;
    if entries.is_empty() {
        return Err(err("refuse: empty allowlist"));
    }
    crate::tiling::verify_proof_argv_consistency(raw_argv, options).map_err(err)?;
    let trace = options.trace;
    let seconds = options.seconds;
    let raw_argv = raw_argv.to_vec();
    crate::lifecycle::sys::run_product(trace, move |dir, me| {
        run_tile_loop(dir, me, seconds, trace, Some(entries), true, raw_argv)
    })
}

/// `capture` command: read-only frozen-allowlist capture of explicitly listed
/// owned-helper windows only. Each `--hwnd` target is fully validated
/// (owned-helper identity with lifetime tag, proof-mode eligibility, fresh
/// rectangles from one coherent observe pair); any ineligible or untagged
/// target refuses the whole capture. The HWND pid is rechecked immediately
/// before the receipt write. Receipts may carry raw native ids; production
/// logs never do.
pub fn cmd_capture(options: &CaptureOptions) -> Result<String> {
    ensure_pm_v2()?;
    let me = medium_caller()?;
    let areas = all_monitors()?;
    let fulls = monitor_fulls(&areas);
    let mut tokens = TokenMap::default();
    let mut entries = Vec::new();
    let mut guarded: Vec<(u64, u32)> = Vec::new();
    for hwnd_u64 in &options.hwnds {
        let hwnd = *hwnd_u64 as isize as HWND;
        let window = match observe_window(hwnd, &me, &fulls, &mut tokens) {
            Ok(window) if window.hwnd == *hwnd_u64 => window,
            _ => return Err(err("refuse: capture target ineligible")),
        };
        if window.identity.tag.is_empty() {
            return Err(err("refuse: capture target ineligible"));
        }
        // Owned-helper binding: sibling exe/class/tag plus Terminal exclusion.
        // Generic windows never capture even when otherwise eligible.
        let helper_exe =
            crate::test_window::sys::sibling_helper_exe().map_err(|e| err(e.to_string()))?;
        let snap = crate::test_window::sys::query_owned(
            window.hwnd,
            &helper_exe,
            &me.user_sid,
            me.session_id,
        )
        .map_err(|_| err("refuse: capture target ineligible"))?;
        if snap.tag != window.identity.tag || snap.tag.is_empty() {
            return Err(err("refuse: capture target ineligible"));
        }
        if classify(&window.facts, true).is_err() {
            return Err(err("refuse: capture target ineligible"));
        }
        guarded.push((window.hwnd, window.identity.pid));
        entries.push(serde_json::json!({
            "hwnd": window.hwnd,
            "pid": window.identity.pid,
            "process_creation": window.identity.process_creation,
            "exe_path": window.identity.exe_path,
            "user_sid": window.identity.user_sid,
            "session_id": window.identity.session_id,
            "tag": window.identity.tag,
            "outer": [window.outer.x, window.outer.y, window.outer.w, window.outer.h],
            "visible": [window.visible.x, window.visible.y, window.visible.w, window.visible.h],
        }));
    }
    if options.hwnds.is_empty() {
        return Err(err("refuse: capture requires at least one --hwnd"));
    }
    // Fresh per-HWND pid guard immediately before the write: a recycled
    // HWND between observation and receipt refuses the whole capture.
    for (hwnd_u64, pid) in &guarded {
        let hwnd = *hwnd_u64 as isize as HWND;
        let mut current: u32 = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut current);
        }
        if current == 0 || current != *pid {
            return Err(err("refuse: capture target identity changed"));
        }
    }
    let receipt = serde_json::json!({ "windows": entries }).to_string();
    if options.out.exists() {
        return Err(err("refuse: receipt preexists"));
    }
    std::fs::write(&options.out, &receipt)
        .map_err(|e| err(format!("error: receipt write: {e}")))?;
    Ok(serde_json::json!({"captured": entries.len()}).to_string())
}

/// `inventory` command: read-only top-level window list for selecting capture
/// targets. Reports HWND, pid, executable basename, class, and style bits;
/// never reads titles. Stdout only; nothing is written or tiled.
pub fn cmd_inventory() -> Result<String> {
    ensure_pm_v2()?;
    let Some(hwnds) = enumerate_hwnds() else {
        return Err(err("error: enumeration failed"));
    };
    let mut entries = Vec::new();
    for raw in hwnds {
        let hwnd = raw as HWND;
        if unsafe { IsWindowVisible(hwnd) } == 0 {
            continue;
        }
        let mut pid: u32 = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut pid);
        }
        if pid == 0 {
            continue;
        }
        let exe = HeldProcess::open(pid)
            .ok()
            .and_then(|held| held.identity().ok())
            .map(|ident| {
                ident
                    .exe_path
                    .rsplit(['\\', '/'])
                    .next()
                    .unwrap_or("unknown")
                    .to_owned()
            })
            .unwrap_or_else(|| "unknown".to_owned());
        let style = unsafe { GetWindowLongW(hwnd, GWL_STYLE) } as u32;
        let exstyle = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32;
        entries.push(serde_json::json!({
            "hwnd": raw as u64,
            "pid": pid,
            "exe": exe,
            "class": class_of(hwnd),
            "style": format!("{style:#x}"),
            "exstyle": format!("{exstyle:#x}"),
        }));
    }
    Ok(serde_json::json!({ "windows": entries }).to_string())
}

unsafe extern "system" fn child_proc(hwnd: HWND, state: LPARAM) -> i32 {
    let out = unsafe { &mut *(state as *mut Vec<isize>) };
    out.push(hwnd as isize);
    1
}

/// Enumerate direct child windows of one parent. `None` on API failure.
fn enumerate_child_windows(parent: HWND) -> Option<Vec<isize>> {
    let mut out: Vec<isize> = Vec::new();
    let ok = unsafe {
        EnumChildWindows(
            parent,
            Some(child_proc),
            &mut out as *mut Vec<isize> as LPARAM,
        )
    };
    if ok == 0 { None } else { Some(out) }
}

fn exe_basename(exe_path: &str) -> String {
    exe_path
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or("unknown")
        .to_owned()
}

/// `children` command: read-only child-window report for explicitly listed
/// top-level targets. Each child carries HWND, pid, executable basename,
/// class, and full process identity when readable; never titles. Used to
/// bind hosted app windows (e.g. Calculator under an ApplicationFrameHost
/// root) to their owning process before any capture or mutation.
pub fn cmd_children(options: &ChildrenOptions) -> Result<String> {
    ensure_pm_v2()?;
    let mut windows = Vec::new();
    for hwnd_u64 in &options.hwnds {
        let parent = *hwnd_u64 as isize as HWND;
        let Some(raw_children) = enumerate_child_windows(parent) else {
            return Err(err("error: child enumeration failed"));
        };
        let mut children = Vec::new();
        for raw in raw_children {
            let hwnd = raw as HWND;
            let mut pid: u32 = 0;
            unsafe {
                GetWindowThreadProcessId(hwnd, &mut pid);
            }
            let identity = (pid != 0)
                .then(|| HeldProcess::open(pid).ok())
                .flatten()
                .and_then(|held| held.identity().ok())
                .filter(|ident| ident.pid == pid);
            let (exe, detail) = match identity {
                Some(ident) => (
                    exe_basename(&ident.exe_path),
                    serde_json::json!({
                        "pid": ident.pid,
                        "process_creation": ident.process_creation,
                        "exe_path": ident.exe_path,
                        "user_sid": ident.user_sid,
                        "session_id": ident.session_id,
                    }),
                ),
                None => ("unknown".to_owned(), serde_json::Value::Null),
            };
            children.push(serde_json::json!({
                "hwnd": raw as u64,
                "pid": pid,
                "exe": exe,
                "class": class_of(hwnd),
                "identity": detail,
            }));
        }
        windows.push(serde_json::json!({ "hwnd": *hwnd_u64, "children": children }));
    }
    Ok(serde_json::json!({ "windows": windows }).to_string())
}

fn rect_array(rect: &Rect) -> [i32; 4] {
    [rect.x, rect.y, rect.w, rect.h]
}

fn medium_caller() -> Result<ProcessIdentity> {
    let me = crate::native::current_identity().map_err(|e| err(format!("error: identity {e}")))?;
    let rid = crate::native::current_integrity_level()
        .map_err(|e| err(format!("error: integrity {e}")))?;
    if !is_medium_rid(rid) {
        return Err(err(format!("refuse: integrity {rid} is not medium")));
    }
    Ok(me)
}

fn read_allowlist(path: &Path) -> Result<Vec<AllowEntry>> {
    let text =
        std::fs::read_to_string(path).map_err(|e| err(format!("error: allowlist read: {e}")))?;
    parse_allowlist(&text).map_err(err)
}

/// One inspection entry without frame geometry: full frozen-matchable
/// identity, an accurate skip, and no fabricated rectangles. `outer` and
/// `visible` are null; `dpi` and `minimized` are real queried state.
fn noframe_inspect_report(
    entry: &AllowEntry,
    identity: &ObservedTarget,
    skip: SkipReason,
    minimized: bool,
    hwnd: HWND,
) -> serde_json::Value {
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    serde_json::json!({
        "hwnd": entry.hwnd,
        "pid": identity.pid,
        "process_creation": identity.process_creation,
        "exe_path": identity.exe_path,
        "user_sid": identity.user_sid,
        "session_id": identity.session_id,
        "tag": identity.tag,
        "identity_match": true,
        "outer": null,
        "visible": null,
        "dpi": dpi,
        "minimized": minimized,
        "eligible": false,
        "skip": skip.as_str(),
    })
}

/// `inspect` command: read-only fresh-state report for exactly the frozen
/// allowlist. Identity and state resolve before any frame query, so a
/// legitimately hidden (passive) or minimized exact helper keeps full
/// identity match with an accurate skip and no fabricated rectangles; only a
/// genuinely unresolvable or non-matching identity reports
/// `identity-changed`. Raw native identity, fresh outer/visible rectangles
/// from one coherent observe pair when frames exist, per-window DPI, native
/// facts with proof-mode eligibility, and the current foreground HWND. No
/// titles, no writes.
pub fn cmd_inspect(options: &InspectOptions) -> Result<String> {
    use ObserveFailure::Known;
    ensure_pm_v2()?;
    let me = medium_caller()?;
    let areas = all_monitors()?;
    let fulls = monitor_fulls(&areas);
    let allow = read_allowlist(&options.allowlist)?;
    let mut tokens = TokenMap::default();
    let foreground = unsafe { GetForegroundWindow() } as usize as u64;
    let mut windows = Vec::new();
    for entry in &allow {
        let hwnd = entry.hwnd as isize as HWND;
        // Stateless identity/state first, independent of geometry.
        let ident = window_identity(hwnd, entry.hwnd, &me);
        let matched = ident.as_ref().is_some_and(|i| allow_match(entry, i));
        let visible = unsafe { IsWindowVisible(hwnd) } != 0;
        let minimized = unsafe { IsIconic(hwnd) } != 0;
        match inspect_stateless_verdict(matched, visible, minimized) {
            StatelessVerdict::Report {
                identity_match,
                // No-frame reports are never eligible; the verdict type
                // guarantees this today.
                eligible: _,
                skip,
            } => {
                match (ident.as_ref(), identity_match) {
                    (Some(identity), true) => windows.push(noframe_inspect_report(
                        entry, identity, skip, minimized, hwnd,
                    )),
                    _ => windows.push(serde_json::json!({
                        "hwnd": entry.hwnd,
                        "identity_match": false,
                        "eligible": false,
                        "skip": skip.as_str(),
                    })),
                }
                continue;
            }
            StatelessVerdict::NeedsGeometry => {}
        }
        // Identity matched a visible, non-minimized window: frame queries and
        // `classify` still decide. A racy frame failure still reports the
        // known identity with its accurate reason, never `identity-changed`.
        match observe_window(hwnd, &me, &fulls, &mut tokens) {
            Ok(window) if allow_match(entry, &window.identity) => {
                let outer = window.outer;
                let dpi = unsafe { GetDpiForWindow(hwnd) };
                let (eligible, skip) = match classify(&window.facts, true) {
                    Ok(()) => (true, None),
                    Err(reason) => (false, Some(reason.as_str().to_owned())),
                };
                windows.push(serde_json::json!({
                    "hwnd": window.hwnd,
                    "pid": window.identity.pid,
                    "process_creation": window.identity.process_creation,
                    "exe_path": window.identity.exe_path,
                    "user_sid": window.identity.user_sid,
                    "session_id": window.identity.session_id,
                    "tag": window.identity.tag,
                    "identity_match": true,
                    "outer": rect_array(&outer),
                    "visible": rect_array(&window.visible),
                    "dpi": dpi,
                    "facts": {
                        "minimized": window.facts.minimized,
                        "maximized": window.facts.maximized,
                        "cloaked": window.facts.cloaked,
                        "elevated": window.facts.elevated,
                        "shell": window.facts.shell,
                        "tool_window": window.facts.tool_window,
                        "owned": window.facts.owned,
                        "captionless_fullscreen": window.facts.captionless_fullscreen,
                        "terminal_ancestor": window.facts.terminal_ancestor,
                        "no_activate": window.facts.no_activate,
                        "dialog": window.facts.dialog,
                    },
                    "eligible": eligible,
                    "skip": skip,
                }));
            }
            Err(Known(known, reason)) if allow_match(entry, &known.identity) => {
                windows.push(noframe_inspect_report(
                    entry,
                    &known.identity,
                    reason,
                    reason == SkipReason::Minimized,
                    hwnd,
                ));
            }
            _ => windows.push(serde_json::json!({
                "hwnd": entry.hwnd,
                "identity_match": false,
                "eligible": false,
                "skip": SkipReason::IdentityChanged.as_str(),
            })),
        }
    }
    Ok(serde_json::json!({ "windows": windows, "foreground": foreground }).to_string())
}
