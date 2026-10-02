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
use windows_sys::Win32::Foundation::{GetLastError, HWND, LPARAM, RECT, SetLastError};
use windows_sys::Win32::Graphics::Dwm::DwmGetWindowAttribute;
use windows_sys::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFOEXW,
};
use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows_sys::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent};
use windows_sys::Win32::UI::HiDpi::{
    AreDpiAwarenessContextsEqual, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, GetDpiForWindow,
    GetThreadDpiAwarenessContext, SetProcessDpiAwarenessContext,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput,
};
use windows_sys::Win32::UI::WindowsAndMessaging::MsgWaitForMultipleObjectsEx;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, EVENT_OBJECT_CREATE, EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE,
    EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_SHOW, EVENT_SYSTEM_FOREGROUND,
    EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZESTART, EnumChildWindows, EnumWindows, GW_OWNER,
    GWL_EXSTYLE, GWL_STYLE, GetClassNameW, GetCursorPos, GetDesktopWindow, GetForegroundWindow,
    GetShellWindow, GetWindow, GetWindowLongW, GetWindowRect, GetWindowThreadProcessId, IsIconic,
    IsWindow, IsWindowVisible, IsZoomed, MSG, PM_REMOVE, PeekMessageW, QS_ALLINPUT, SWP_NOACTIVATE,
    SWP_NOZORDER, SetForegroundWindow, SetWindowPos, TranslateMessage, WINEVENT_OUTOFCONTEXT,
    WS_CAPTION, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

use crate::lifecycle::{
    WORKSPACE_REQUEST_FILE, exe_paths_equal, is_medium_rid,
    sys::{log_path_for, snap_resume, snap_suspend, stop_requested},
};
use crate::model::ProcessIdentity;
use crate::native::HeldProcess;
use crate::snapkey::{
    KeyboardConfig, MAX_DISPATCH_PER_TICK, OriginVerdict, QueuedSnapEvent, SnapOp, SnapOrigin,
    VK_MASK, WorkspaceOp, direction_name, resolve_origin,
};
use crate::storage::LedgerStore;
use crate::tiling::{
    AllowEntry, CaptureOptions, ChildrenOptions, FrameInsets, GestureIntent, HideProofOptions,
    INNER_GAP, InspectOptions, OUTER_GAP, OWNER_ID, ObservedTarget, ObservedTargetRef,
    ReadbackOutcome, RefusedTracker, ScopeHostChild, SkipReason, StatelessVerdict, TileOptions,
    TileProofOptions, TokenMap, WindowFacts, WorkspaceSelectOptions, allow_match, allowlist_digest,
    classify, classify_gesture, fingerprint, hosted_child_allows, inspect_stateless_verdict,
    is_borderless_fullscreen, parse_allowlist, parse_workspace_request, readback_outcome,
    scope_allows, scope_exe_basename, tick_summary_signature, tiling_domain_bounds,
};
use crate::workspace::ManagedWorkspaces;

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
// Pumped focus-settle bound: re-reads of `GetForegroundWindow` after an
// accepted setter, 50 ms pumped each so the LL-hook message pump stays live.
// No foreign wait: `pump_wait` only services the owner's own queue.
const FOCUS_SETTLE_ROUNDS: u32 = 10;
const FOCUS_SETTLE_POLL_MS: u32 = 50;

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

#[derive(Debug, Clone)]
struct MonitorArea {
    /// Stable session key: the device name (`szDevice`, e.g. `\\.\DISPLAY1`).
    /// Rectangles decide placement; this key decides session identity.
    device: String,
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
    let mut info: MONITORINFOEXW = unsafe { std::mem::zeroed() };
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if unsafe { GetMonitorInfoW(monitor, (&mut info as *mut MONITORINFOEXW).cast()) } == 0 {
        return 1;
    }
    let work = RECT {
        left: info.monitorInfo.rcWork.left,
        top: info.monitorInfo.rcWork.top,
        right: info.monitorInfo.rcWork.right,
        bottom: info.monitorInfo.rcWork.bottom,
    };
    let full = RECT {
        left: info.monitorInfo.rcMonitor.left,
        top: info.monitorInfo.rcMonitor.top,
        right: info.monitorInfo.rcMonitor.right,
        bottom: info.monitorInfo.rcMonitor.bottom,
    };
    if let (Some(work), Some(full)) = (rect_from_win(work), rect_from_win(full)) {
        let end = info
            .szDevice
            .iter()
            .position(|c| *c == 0)
            .unwrap_or(info.szDevice.len());
        let device = String::from_utf16_lossy(&info.szDevice[..end]);
        let device = if device.is_empty() {
            "display-?".to_owned()
        } else {
            device
        };
        let area = MonitorArea { device, work, full };
        let primary = info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0;
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
    Some(ObservedTarget {
        hwnd: hwnd_u64,
        pid,
        process_creation: ident.process_creation,
        exe_path: ident.exe_path,
        user_sid: ident.user_sid,
        session_id: ident.session_id,
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
/// lifetime tag, full process identity, and medium integrity via
/// [`crate::test_window::sys::query_owned`]. Generic windows (including
/// otherwise eligible ordinary apps) fail here even when their rectangles
/// look tileable.
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
    /// Explicit normal-mode scope filter (top-level exe basenames,
    /// normalized at parse). Empty means no filter: every eligible window is
    /// managed. Nonempty fences observation, geometry writes, workspace
    /// hide/reveal membership, and focus actuation.
    scope: Vec<String>,
    /// Explicit host-to-child scope pairs (empty means no child constraint).
    /// A listed host passes observation and hide admission only while a live
    /// hosted child matches, so a newly appearing hosted app can never ride
    /// another app's host executable into management.
    scope_hosts: Vec<ScopeHostChild>,
    trace: bool,
    suspended: bool,
    last_summary: Option<String>,
    log_path: std::path::PathBuf,
    audit_path: Option<std::path::PathBuf>,
    /// Product keyboard policy for this run (takeover switch + Win+L opt-in).
    keyboard: KeyboardConfig,
    /// Last published snap-queue loss count, for explicit drop evidence.
    snap_dropped: u32,
    /// Chord-time origin snapshots for the keyboard callback, refreshed with
    /// every complete observation alongside `managed`.
    snap_origins: HashMap<u64, SnapOrigin>,
    /// Verified own-focus continuation across bounded drains. Set only on an
    /// exact verified owner actuation (`focus-ok`); cleared on external
    /// focus, lifetime mismatch, suspension, or gesture. Lets a stale chord
    /// origin continue from our own advance within and across batches, never
    /// a permissive retarget.
    snap_advance: Option<SnapOrigin>,
    /// Raw `EnumWindows` count from the latest observation (targets seen
    /// before any eligibility filtering, including zero).
    last_enumerated: usize,
    /// Project-owned per-output-local workspaces. Independent Engine domains
    /// per `(output, workspace)` preserve each layout plus last focus.
    workspaces: crate::workspace::ManagedWorkspaces,
    /// Stable session tokens per member key. The token (not the ephemeral
    /// product nonce) is the Engine identity; the nonce lives only in
    /// `hidden_claims` plus the ledger while hidden.
    member_tokens: std::collections::BTreeMap<crate::workspace::WindowKey, String>,
    /// Last-known rectangles per member token (visible reads plus hidden
    /// snapshots) so Engine source/target observations stay complete.
    member_rects: HashMap<String, Rect>,
    /// Known hidden product claims by stable member key. Retained
    /// independently of the `IsWindowVisible` observation gate so hidden
    /// windows are never dropped; the nonce leaves only after verified
    /// reveal or release. Keyed by the full `(hwnd, pid, creation)` member
    /// identity, never HWND alone, so a recycled HWND never matches.
    hidden_claims: std::collections::BTreeMap<crate::workspace::WindowKey, HiddenRecord>,
    /// Stored full process identity per member key. Hide effects bind to
    /// this stored identity and refuse recycled HWNDs with no writes.
    member_identity: std::collections::BTreeMap<crate::workspace::WindowKey, ProcessIdentity>,
    /// Stored visible-membership lifetime tag per member key, stamped at
    /// admission onto the window itself. Same-process HWND reuse starts
    /// without it, so every effect re-verifies live-against-stored before
    /// trusting HWND/PID/creation. Never serialized, never trusted across
    /// runs, never removed (the property dies with its window).
    member_tags: std::collections::BTreeMap<crate::workspace::WindowKey, String>,
    /// Cached output context for the next select. Updated on every switch
    /// and refreshed from pointer/foreground context when stale.
    active_output: String,
    /// True only for the `workspace-proof` command: workspace hides are
    /// allowed, but solely for frozen-allowlist helpers verified fresh via
    /// `verify_proof_owned` before every write. Normal `tile` allows
    /// ordinary-app hides; `shortcut-proof` and `tile-proof` never hide.
    workspace_proof: bool,
    /// Last observed foreground HWND. Only an actual foreground change to a
    /// hidden member selects its workspace; event-only notifications never do.
    last_foreground: u64,
    /// Monitor device keys from the last loop pass, for disconnect/reconnect.
    known_outputs: Vec<String>,
    /// Raw `EnumWindows` HWND inventory from the latest enumeration,
    /// independent of eligibility: close cleanup and retained-occupancy
    /// decisions never mistake an unclassified window for a closed one.
    last_hwnds: HashSet<u64>,
    /// Monitor snapshot from the last loop pass: disconnect-time geometry
    /// for the survivor chooser, never post-disconnect frames as proxy.
    last_areas: Vec<MonitorArea>,
}

/// One hidden member: the committed ledger claim (carrying the durable
/// show-state preimage, the authority for independent restore) plus the iconic
/// state at hide time for the in-memory reveal fast path and preimage-less
/// legacy claims.
#[derive(Debug, Clone)]
struct HiddenRecord {
    claim: crate::model::WindowIdentity,
    iconic: bool,
}

/// One retained-occupancy member: identity resolved but no tileable frame
/// (minimized without a DWM frame) or an ineligible state with a fresh
/// frame (maximized, fullscreen, cloaked). `rect` is `None` only when no
/// frame exists; the caller falls back to the last-known snapshot so hidden
/// Engine membership and layout survive.
#[derive(Debug, Clone)]
struct RetainedRow {
    key: crate::workspace::WindowKey,
    token: String,
    rect: Option<Rect>,
}

impl TileLoop {
    fn correlation(&self) -> CorrelationId {
        CorrelationId::parse(&format!("tick-{}", self.tick))
            .expect("tick correlation is a valid token")
    }

    /// Full enumeration with per-window eligibility. Proof mode prefilters by
    /// frozen-allowlist HWND before any per-window query, so non-owned windows
    /// never mint tokens, churn the map, or enter logs; `EnumWindows` still
    /// yields the complete raw count. Proof mode additionally requires
    /// frozen-allowlist membership plus owned-helper verification (sibling
    /// exe/class/lifetime-tag); malformed allowlist state is unreachable here
    /// because `cmd_tile_proof` refuses it before the loop starts. Invisible
    /// allowlist members stay frozen (not eligible) until an exact-bound
    /// `show` admission. Normal mode with a nonempty scope additionally
    /// reports out-of-scope executables as `scope-excluded` with no
    /// membership, geometry, or focus. Returns `None` when enumeration itself
    /// failed: the tick is skipped with retained Engine state.
    fn observe(
        &mut self,
        me: &ProcessIdentity,
        fulls: &[Rect],
        skipped: &mut Vec<(String, String)>,
        retained: &mut Vec<RetainedRow>,
    ) -> Option<Vec<ObservedWindow>> {
        use ObserveFailure::{Known, Unknown};
        let proof_mode = self.allowlist.is_some();
        let hwnds = enumerate_hwnds()?;
        self.last_enumerated = hwnds.len();
        self.last_hwnds = hwnds.iter().map(|raw| *raw as usize as u64).collect();
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
                    // Retained-occupancy members ride a row with no fresh
                    // frame so Engine membership survives minimization.
                    // Out-of-scope executables never retain membership.
                    enumerated.push((known.identity.hwnd, known.identity.process_creation.clone()));
                    if !scope_allows(&self.scope, &known.identity.exe_path) {
                        skipped.push((known.token.clone(), "scope-excluded".to_owned()));
                        continue;
                    }
                    skipped.push((known.token.clone(), reason.as_str().to_owned()));
                    retained.push(RetainedRow {
                        key: crate::workspace::WindowKey {
                            hwnd: known.identity.hwnd,
                            pid: known.identity.pid,
                            creation: known.identity.process_creation.clone(),
                        },
                        token: known.token.clone(),
                        rect: None,
                    });
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
            match classify(&window.facts) {
                Ok(()) => {
                    if !scope_allows(&self.scope, &window.identity.exe_path) {
                        skipped.push((window.token.clone(), "scope-excluded".to_owned()));
                        continue;
                    }
                    // Listed hosts pass only with a live matching hosted
                    // child, re-verified every tick: a newly appearing hosted
                    // app can never ride another app's host executable into
                    // observation, membership, writes, or focus. Excluded
                    // members keep their retained snapshot (no membership
                    // loss) and re-enter when the child set is clean again.
                    if !hosted_gate_allows(
                        &window.identity.exe_path,
                        window.hwnd,
                        window.identity.pid,
                        &self.scope_hosts,
                    ) {
                        skipped.push((window.token.clone(), "scope-excluded".to_owned()));
                        retained.push(RetainedRow {
                            key: crate::workspace::WindowKey {
                                hwnd: window.identity.hwnd,
                                pid: window.identity.pid,
                                creation: window.identity.process_creation.clone(),
                            },
                            token: window.token.clone(),
                            rect: None,
                        });
                        continue;
                    }
                    out.push(window);
                }
                Err(reason) => {
                    skipped.push((window.token.clone(), reason.as_str().to_owned()));
                    // Ineligible but fully observed: the fresh frame keeps
                    // retained occupancy (maximized, fullscreen, cloaked)
                    // inside Engine membership with no geometry writes.
                    retained.push(RetainedRow {
                        key: crate::workspace::WindowKey {
                            hwnd: window.hwnd,
                            pid: window.identity.pid,
                            creation: window.identity.process_creation.clone(),
                        },
                        token: window.token.clone(),
                        rect: Some(window.visible),
                    });
                }
            }
        }
        // Bounded retain over every enumerated pair, never HWND alone and
        // never eligible-only: skipped identities keep their tokens. Known
        // hidden claims are retained too: they never pass the visible gate
        // but their tokens stay stable across ticks.
        let mut live_refs: Vec<ObservedTargetRef<'_>> = enumerated
            .iter()
            .map(|(hwnd, creation)| ObservedTargetRef {
                hwnd: *hwnd,
                creation,
            })
            .collect();
        for record in self.hidden_claims.values() {
            if !live_refs.iter().any(|t| {
                t.hwnd == record.claim.hwnd && t.creation == record.claim.process.process_creation
            }) {
                live_refs.push(ObservedTargetRef {
                    hwnd: record.claim.hwnd,
                    creation: &record.claim.process.process_creation,
                });
            }
        }
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

/// Chord-time origin snapshot for one managed window: HWND plus the
/// process-lifetime evidence the owner rechecks. Only the token may enter logs.
fn snap_origin_of(window: &ObservedWindow) -> SnapOrigin {
    SnapOrigin {
        hwnd: window.hwnd,
        token: window.token.clone(),
        pid: window.identity.pid,
        creation: window.identity.process_creation.clone(),
    }
}

/// Refresh cached management state from a complete observation: managed set,
/// stable rects, gesture retention, and the origin map the keyboard callback
/// binds chords against. Exactness stays with the per-intent owner recheck.
fn publish_managed(state: &mut TileLoop, observed: &[ObservedWindow]) {
    state.managed = observed.iter().map(|w| w.hwnd).collect();
    state.stable = observed.iter().map(|w| (w.hwnd, w.visible)).collect();
    state
        .gesture_before
        .retain(|hwnd, _| state.managed.contains(hwnd));
    state.snap_origins = observed
        .iter()
        .map(|w| (w.hwnd, snap_origin_of(w)))
        .collect();
}

/// Revalidate one write target immediately before `SetWindowPos`: fresh
/// eligibility, scope, fresh full identity compared against the cached
/// expectation and the frozen allowlist, with the process held open across
/// the write. Returns the fresh observation plus the held process (liveness
/// guard).
struct WriteTarget {
    window: ObservedWindow,
    held: HeldProcess,
}

#[allow(clippy::too_many_arguments)]
fn revalidate_target(
    expected: &ObservedWindow,
    me: &ProcessIdentity,
    fulls: &[Rect],
    tokens: &mut TokenMap,
    proof_mode: bool,
    allowlist: Option<&Vec<AllowEntry>>,
    scope: &[String],
    member_tag: Option<&str>,
    scope_hosts: &[ScopeHostChild],
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
    let fresh = observe_window(hwnd, me, fulls, tokens).map_err(|_| "ineligible")?;
    if !scope_allows(scope, &fresh.identity.exe_path) {
        return Err("scope-excluded");
    }
    // Visible lifetime gate: the live member tag must equal the stored tag,
    // so a same-process HWND reuse (same HWND/PID/creation, fresh window)
    // authorizes no geometry write and no focus actuation. Untracked windows
    // (no stored tag) never pass, only admission stamps.
    let live_tag = crate::product_hide::sys::read_member_tag(fresh.hwnd);
    let Some(stored) = member_tag else {
        return Err("identity-changed");
    };
    if !crate::workspace_owner::visible_lifetime_ok(stored, live_tag.as_deref()) {
        return Err("identity-changed");
    }
    // Hosted-child fence, fresh (never from the tick's observation): a newly
    // appearing hosted app authorizes no geometry write and no focus
    // actuation under another app's membership.
    if !hosted_gate_allows(
        &fresh.identity.exe_path,
        fresh.hwnd,
        fresh.identity.pid,
        scope_hosts,
    ) {
        return Err("scope-excluded");
    }
    if proof_mode {
        let entries = allowlist.ok_or("allowlist-missing")?;
        let Some(entry) = entries
            .iter()
            .find(|entry| allow_match(entry, &fresh.identity))
        else {
            return Err("allowlist-changed");
        };
        // Owned-helper gate immediately before the setter: sibling
        // exe/class/tag, no ordinary fallback.
        verify_proof_owned(fresh.hwnd, entry, me)?;
    }
    classify(&fresh.facts).map_err(|reason| reason.as_str())?;
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

type DesiredEntry = crate::workspace_owner::PlannedWrite;

fn desired_entries(reply: &CoreReply) -> Option<Vec<DesiredEntry>> {
    crate::workspace_owner::planned_writes(reply)
}

/// Assemble complete Engine rows for one `(output, workspace)` domain: the
/// union of eligible visible members, retained-occupancy members with fresh
/// frames, frame-less retained members with last-known snapshots, and hidden
/// snapshots. Refreshes the member token/rect/identity tables for every row
/// with a fresh read.
///
/// Returns `None` when any member lacks a known snapshot: every Engine
/// handle path must defer with retained state instead of converging a
/// falsely complete observation that would drop membership and layout.
fn assemble_domain_rows(
    state: &mut TileLoop,
    output: &str,
    workspace: &str,
    observed: &[ObservedWindow],
    retained: &[RetainedRow],
) -> Option<Vec<crate::workspace_owner::OwnerRow>> {
    let members = state.workspaces.workspace_members(output, workspace);
    let by_token: HashMap<&str, &ObservedWindow> =
        observed.iter().map(|w| (w.token.as_str(), w)).collect();
    let mut views = Vec::new();
    for key in &members {
        if state.workspaces.is_hidden(key) {
            if let (Some(token), Some(rect)) = (
                state.member_tokens.get(key).cloned(),
                state
                    .member_tokens
                    .get(key)
                    .and_then(|t| state.member_rects.get(t).copied()),
            ) {
                views.push(crate::workspace_owner::MemberView {
                    key: key.clone(),
                    token,
                    rect,
                });
            }
            continue;
        }
        // Eligible visible read first. Out-of-scope members still ride a row
        // so the observation stays complete: the scope fence lives in
        // `writable_tokens` (no geometry writes), `workspace_hide_one`, and
        // the select/send dispatchers (no hides), never in row assembly
        // (where a missing view would stall convergence as `deferred`).
        if let Some(token) = state.member_tokens.get(key).cloned()
            && let Some(window) = by_token.get(token.as_str())
        {
            state.member_rects.insert(token.clone(), window.visible);
            if let Some(identity) = state.member_identity.get_mut(key) {
                identity.pid = window.identity.pid;
                identity.process_creation = window.identity.process_creation.clone();
                identity.exe_path = window.identity.exe_path.clone();
                identity.user_sid = window.identity.user_sid.clone();
                identity.session_id = window.identity.session_id;
            }
            views.push(crate::workspace_owner::MemberView {
                key: key.clone(),
                token: token.clone(),
                rect: window.visible,
            });
            continue;
        }
        // Retained occupancy: fresh frame when observed, else last snapshot.
        if let Some(row) = retained.iter().find(|r| r.key == *key) {
            if let Some(rect) = row.rect {
                state.member_rects.insert(row.token.clone(), rect);
                views.push(crate::workspace_owner::MemberView {
                    key: key.clone(),
                    token: row.token.clone(),
                    rect,
                });
            } else if let Some(rect) = state.member_rects.get(&row.token).copied() {
                views.push(crate::workspace_owner::MemberView {
                    key: key.clone(),
                    token: row.token.clone(),
                    rect,
                });
            }
        }
    }
    let mut rows = crate::workspace_owner::domain_rows(&members, &views)?;
    rows.sort_by(|a, b| a.token.cmp(&b.token));
    Some(rows)
}

/// Engine-writable tokens for one domain: eligible observed members only.
/// Retained and hidden rows converge membership but never take geometry
/// writes; hidden workspace geometry is not written until reveal.
///
/// Native HWND/PID/creation plus scope gates pre-filter here; the portable
/// hidden/fresh exclusion rides [`crate::workspace_owner::writable_subset`],
/// the same seam the portable regression covers, so production and tests
/// share one rule without weakening any native check.
fn writable_tokens(
    state: &TileLoop,
    output: &str,
    workspace: &str,
    observed: &[ObservedWindow],
) -> HashSet<String> {
    let members = state.workspaces.workspace_members(output, workspace);
    let by_hwnd: HashMap<u64, &ObservedWindow> = observed.iter().map(|w| (w.hwnd, w)).collect();
    let mut eligible: std::collections::BTreeMap<crate::workspace::WindowKey, String> =
        std::collections::BTreeMap::new();
    for key in &members {
        let Some(window) = by_hwnd.get(&key.hwnd) else {
            continue;
        };
        if !crate::workspace_owner::member_matches(
            key,
            window.hwnd,
            window.identity.pid,
            &window.identity.process_creation,
        ) {
            continue;
        }
        if !scope_allows(&state.scope, &window.identity.exe_path) {
            continue;
        }
        eligible.insert(key.clone(), window.token.clone());
    }
    let fresh: HashSet<String> = observed.iter().map(|w| w.token.clone()).collect();
    crate::workspace_owner::writable_subset(
        &members,
        |k| state.workspaces.is_hidden(k),
        &eligible,
        &fresh,
    )
}

/// Run one reconcile tick partitioned per output-local domain: enumerate
/// once, then converge each monitor's current workspace through its own
/// retained Engine session with that monitor's `rcWork` bounds. Hidden
/// workspace sessions are never reconciled, so their membership and layout
/// survive untouched; no layout reseeds across switches.
fn reconcile_tick(
    state: &mut TileLoop,
    me: &ProcessIdentity,
    fulls: &[Rect],
    areas: &[MonitorArea],
) {
    state.tick += 1;
    let tick = state.tick;
    let correlation = state.correlation();
    let mut skipped: Vec<(String, String)> = Vec::new();
    let mut retained: Vec<RetainedRow> = Vec::new();
    let log_path = state.log_path.clone();
    let Some(mut observed) = state.observe(me, fulls, &mut skipped, &mut retained) else {
        log_json_at(
            &log_path,
            serde_json::json!({"event":"tick-skip","tick":tick,"cause":"enum-failed"}),
        );
        return;
    };
    publish_managed(state, &observed);
    ensure_workspace_assignments(state, me, &mut observed, areas);
    workspace_close_cleanup(state);
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
    for area in areas {
        let output = area.device.clone();
        state.workspaces.ensure_output(&output);
        let Some(active) = state.workspaces.active_id(&output) else {
            continue;
        };
        if tiling_domain_bounds(area.work).is_none() {
            continue;
        }
        // Incomplete snapshot defers with retained Engine state: a falsely
        // complete observation would drop membership and layout.
        let Some(rows) = assemble_domain_rows(state, &output, &active, &observed, &retained) else {
            continue;
        };
        let windows: Vec<(WindowId, Rect)> = rows
            .iter()
            .map(|r| (WindowId(r.token.clone()), r.rect))
            .collect();
        let fp = fingerprint(
            &rows
                .iter()
                .map(|r| (r.token.clone(), r.rect))
                .collect::<Vec<_>>(),
        );
        let focused = state
            .focused_token(&observed)
            .filter(|f| windows.iter().any(|(w, _)| w == f));
        let Some((domain, domain_key)) = workspace_domain_for(&output, &active, areas) else {
            continue;
        };
        let event = crate::tiling::build_reconcile_event_for(
            &state.owner,
            &state.generation,
            &correlation,
            revision_for(state, &output, &active),
            fp,
            &domain,
            &domain_key,
            OUTER_GAP,
            &windows,
            focused.as_ref(),
        );
        let reply = state.engine.handle(&event);
        let writable = writable_tokens(state, &output, &active, &observed);
        apply_geometry(
            state,
            ApplyInput {
                me,
                fulls,
                reply: &reply,
                observed: &observed,
                op: "reconcile",
                tick,
                correlation: correlation.as_str(),
                skipped: skipped.clone(),
                writable: &writable,
                output_token: state.workspaces.output_token(&output),
                workspace_token: state.workspaces.workspace_token(&output, &active),
                revision: revision_for(state, &output, &active),
            },
        );
    }
}

/// Bundled inputs for one geometry application pass.
struct ApplyInput<'a> {
    me: &'a ProcessIdentity,
    fulls: &'a [Rect],
    reply: &'a CoreReply,
    observed: &'a [ObservedWindow],
    op: &'a str,
    tick: u64,
    correlation: &'a str,
    skipped: Vec<(String, String)>,
    /// Eligible observed tokens in this domain. Retained and hidden rows
    /// converge Engine membership but never take geometry writes.
    writable: &'a HashSet<String>,
    /// Opaque domain tokens for the per-domain tick log (no native ids).
    output_token: String,
    workspace_token: String,
    /// Engine revision of this domain for the tick summary signature.
    revision: u64,
}

/// Settled result of one geometry application pass: verified writes,
/// readback mismatches, and whether the independent readback observation ran
/// at all, plus the first privacy-safe veto diagnostic when a write vetoed.
/// Callers map this to their action outcome vocabulary instead of assuming
/// success. `veto` is `None` when no write vetoed: the action line serializes
/// null with reason, never zeros implying applied.
#[derive(Debug, Clone, Copy)]
struct ApplySummary {
    applied: usize,
    mismatched: usize,
    readback_ok: bool,
    veto: Option<VetoDiag>,
}

/// Bounded privacy-safe veto diagnostic: reason token plus the three native
/// booleans behind it. No handles, paths, PIDs, titles, or content; opaque
/// managed tokens only travel in the existing skip list.
#[derive(Debug, Clone, Copy)]
struct VetoDiag {
    reason: &'static str,
    desktop: bool,
    visible: bool,
    captioned: bool,
    dwm_readable: bool,
}

fn audit_json(state: &TileLoop, value: serde_json::Value) {
    if let Some(path) = state.audit_path.as_ref() {
        log_json_at(path, value);
    }
}

fn apply_geometry(state: &mut TileLoop, input: ApplyInput<'_>) -> Option<ApplySummary> {
    let ApplyInput {
        me,
        fulls,
        reply,
        observed,
        op,
        tick,
        correlation,
        mut skipped,
        writable,
        output_token,
        workspace_token,
        revision,
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
                "correlation": correlation,
                "op": op,
                "output": output_token,
                "workspace": workspace_token,
                "outcome": outcome.0,
                "kind": outcome.1,
            }),
        );
        return None;
    };
    let by_token: HashMap<&str, &ObservedWindow> =
        observed.iter().map(|w| (w.token.as_str(), w)).collect();
    let by_hwnd: HashMap<u64, &ObservedWindow> = observed.iter().map(|w| (w.hwnd, w)).collect();
    let proof_mode = state.allowlist.is_some();
    let now = Instant::now();
    let mut applied = 0usize;
    // First veto diagnostic in this pass for the bounded action summary; the
    // per-window skip list keeps the existing `fullscreen-foreground` token.
    let mut veto_diag: Option<VetoDiag> = None;
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
        if !writable.contains(entry.window.0.as_str()) {
            // Retained or hidden rows converge Engine membership but never
            // take geometry writes: hidden workspace geometry waits for
            // reveal and minimized/maximized/fullscreen frames stay native.
            skipped.push((entry.window.0.clone(), "retained".to_owned()));
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
        // Stored lifetime tag for the write gate: disjoint-field borrows of
        // `state` coexist with the `&mut state.tokens` below.
        let member_key = crate::workspace::WindowKey {
            hwnd: expected.hwnd,
            pid: expected.identity.pid,
            creation: expected.identity.process_creation.clone(),
        };
        let stored_tag = state.member_tags.get(&member_key).map(String::as_str);
        let target = match revalidate_target(
            expected,
            me,
            fulls,
            &mut state.tokens,
            proof_mode,
            state.allowlist.as_ref(),
            &state.scope,
            stored_tag,
            &state.scope_hosts,
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
        // User safety across the tick: a vetoing foreground that arrived
        // after the loop guard must veto this write, not ride along. The
        // first veto pins the bounded diagnostic for the action summary.
        let read = foreground_read(fulls);
        if read.veto.block {
            if veto_diag.is_none() {
                veto_diag = Some(VetoDiag {
                    reason: read.veto.reason.as_str(),
                    desktop: read.desktop,
                    visible: read.visible,
                    captioned: read.captioned,
                    dwm_readable: read.dwm_readable,
                });
            }
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
                    "correlation": correlation,
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
                "correlation": correlation,
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
    let mut reread_retained: Vec<RetainedRow> = Vec::new();
    let reread = state.observe(me, &reread_fulls, &mut reread_skipped, &mut reread_retained);
    let mut mismatched = 0usize;
    let mut readback_ok = false;
    if let Some(reread) = reread {
        readback_ok = true;
        // Stable pre-gesture state follows the AFTER-actuation observation,
        // never the pre-apply frame the Engine just consumed.
        publish_managed(state, &reread);
        let reread_by_token: HashMap<&str, Rect> = reread
            .iter()
            .map(|w| (w.token.as_str(), w.visible))
            .collect();
        for entry in &desired {
            if !writable.contains(entry.window.0.as_str()) {
                // Retained rows never took writes: no readback verdict.
                continue;
            }
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
                    "correlation": correlation,
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
                "correlation": correlation,
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
        revision,
    );
    let signature = format!("{output_token}/{workspace_token}|{signature}");
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
                "correlation": correlation,
                "output": output_token,
                "workspace": workspace_token,
                "windows": observed.len(),
                "applied": applied,
                "mismatched": mismatched,
                "skipped": skipped_json,
            }),
        );
    }
    Some(ApplySummary {
        applied,
        mismatched,
        readback_ok,
        veto: veto_diag,
    })
}

/// Closed outcome vocabulary for a directional Engine reply that is not a
/// success plan: edge no-ops and refusals actuate nothing.
fn reply_outcome(reply: &CoreReply) -> &'static str {
    match reply {
        CoreReply::Rejected { kind, .. } => kind,
        CoreReply::Diverged(reason) => reason.as_str(),
        CoreReply::SnapshotInvalid { detail, .. } => detail,
        _ => "unexpected-reply",
    }
}

/// Outcome of one Engine focus actuation plus setter/readback trace.
/// `setter_accepted` is the raw `SetForegroundWindow` BOOL (never trusted as
/// proof); `prime_inserted` is the bounded `SendInput` accepted-event count
/// for the E8 last-input prime (0..=2, never trusted as proof);
/// `attach_ok` reports the bounded `AttachThreadInput` coupling to the
/// pre-call foreground thread (never trusted as proof); `eventual` is true
/// only when the exact-foreground readback matched after the pumped settle
/// rather than immediately (never trusted beyond the readback itself);
/// `deferred` stays false: no synchronous foreign message waits, the
/// callback remains promptly available. Token-safe ints/bools for the
/// production log: no native ids.
struct FocusActuation {
    outcome: &'static str,
    setter_accepted: bool,
    prime_inserted: u8,
    attach_ok: bool,
    eventual: bool,
    deferred: bool,
}

/// Acquire last-input rights immediately before `SetForegroundWindow`: one
/// unassigned E8 down/up pair (`VK_MASK`, `dwExtraInfo` 0) via `SendInput`.
/// The OS grants foreground rights to the last input provider, and E8 carries
/// no modifier, character, or Start-menu side effect (same technique as the
/// accepted Win-up mask). Zero means the prime contributed nothing; the caller
/// still attempts the setter and the exact foreground readback decides.
/// A partial single insert runs one bounded E8-up release so no virtual key
/// stays held. Runs on the owner loop thread, never in the LL callback, with
/// no wait, no `AttachThreadInput`, no Alt, and no policy/registry effect.
fn prime_foreground_rights() -> u8 {
    let inserted = unsafe {
        let mut pair: [INPUT; 2] = std::mem::zeroed();
        pair[0].r#type = INPUT_KEYBOARD;
        pair[0].Anonymous.ki = KEYBDINPUT {
            wVk: VK_MASK as u16,
            wScan: 0,
            dwFlags: 0,
            time: 0,
            dwExtraInfo: 0,
        };
        pair[1].r#type = INPUT_KEYBOARD;
        pair[1].Anonymous.ki = KEYBDINPUT {
            wVk: VK_MASK as u16,
            wScan: 0,
            dwFlags: KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0,
        };
        let size = std::mem::size_of::<INPUT>() as i32;
        SendInput(2, pair.as_ptr(), size)
    };
    if inserted == 1 {
        // Bounded release of the lone E8 down; the count stays 1 (no clean
        // pair) so evidence never claims a full prime.
        unsafe {
            let mut up: INPUT = std::mem::zeroed();
            up.r#type = INPUT_KEYBOARD;
            up.Anonymous.ki = KEYBDINPUT {
                wVk: VK_MASK as u16,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            };
            let size = std::mem::size_of::<INPUT>() as i32;
            SendInput(1, &up, size);
        }
    }
    inserted.min(u32::from(u8::MAX)) as u8
}

/// Actuate one Engine focus plan on the exact target window: fresh
/// revalidation with the process held open across the call, one bounded E8
/// `SendInput` last-input prime, a bounded `AttachThreadInput` coupling of
/// the owner thread to the pre-call foreground thread, then exactly one
/// `SetForegroundWindow` with immediate detach, an exact immediate
/// `GetForegroundWindow` readback, and - on an immediate miss - a bounded
/// pumped settle (own queue only, hook stays live) distinguishing deferred
/// delivery from no transfer. The prime count, the attach result, and the
/// setter return are never trusted; only an exact foreground readback settles
/// `focus-ok`. There is no Alt injection and no `SendMessageTimeoutW` wait.
/// Proof mode keeps the frozen-allowlist gate; normal mode skips it.
///
/// This runs on the loop thread, never inside the low-level hook callback.
/// No call here waits on foreign input: `AttachThreadInput` only links
/// queues, `SetForegroundWindow` returns without waiting, detach runs
/// immediately after the single setter, and the settle only pumps the owner's
/// own queue. Revalidation is identity/liveness, not responsiveness - a hung
/// target cannot stall these calls because none of them blocks on it.
fn actuate_focus(
    state: &mut TileLoop,
    me: &ProcessIdentity,
    fulls: &[Rect],
    observed: &[ObservedWindow],
    to_token: &str,
) -> FocusActuation {
    let unsettled = |outcome: &'static str| FocusActuation {
        outcome,
        setter_accepted: false,
        prime_inserted: 0,
        attach_ok: false,
        eventual: false,
        deferred: false,
    };
    let Some(expected) = observed.iter().find(|w| w.token == to_token) else {
        return unsettled("vanished");
    };
    let proof_mode = state.allowlist.is_some();
    let member_key = crate::workspace::WindowKey {
        hwnd: expected.hwnd,
        pid: expected.identity.pid,
        creation: expected.identity.process_creation.clone(),
    };
    let stored_tag = state.member_tags.get(&member_key).map(String::as_str);
    let target = match revalidate_target(
        expected,
        me,
        fulls,
        &mut state.tokens,
        proof_mode,
        state.allowlist.as_ref(),
        &state.scope,
        stored_tag,
        &state.scope_hosts,
    ) {
        Ok(target) => target,
        Err(reason) => return unsettled(reason),
    };
    let hwnd = target.window.hwnd as isize as HWND;
    if unsafe { GetForegroundWindow() } as usize as u64 == target.window.hwnd {
        // Already exact foreground: no input and no setter needed.
        return FocusActuation {
            outcome: "focus-ok",
            setter_accepted: false,
            prime_inserted: 0,
            attach_ok: false,
            eventual: false,
            deferred: false,
        };
    }
    let prime_inserted = prime_foreground_rights();
    // Real fullscreen arrival fence immediately before the native setter: a
    // vetoing foreground (or an elevated foreground) that arrived during
    // validation/priming is never stolen from. The geometry path below then
    // vetoes honestly instead of riding along. No wait, no retry.
    if foreground_read(fulls).veto.block || foreground_elevated(me) {
        return FocusActuation {
            outcome: "focus-skipped-fence",
            setter_accepted: false,
            prime_inserted,
            attach_ok: false,
            eventual: false,
            deferred: false,
        };
    }
    // Couple the owner input queue to the pre-call foreground thread so the
    // single setter below runs attached (AHK ladder rung one). Skipped when
    // there is no foreground thread or it is already ours. No wait, no Alt.
    // `GetWindowThreadProcessId` RETURNS the thread id and writes the process
    // id to its out-param: the tid comes from the return value, never from
    // the pid slot (a pid-as-tid attach was the 024139 false negative).
    let current_tid = unsafe { GetCurrentThreadId() };
    let foreground_before = unsafe { GetForegroundWindow() };
    let foreground_tid = if foreground_before.is_null() {
        0
    } else {
        unsafe { GetWindowThreadProcessId(foreground_before, std::ptr::null_mut()) }
    };
    let attach_ok = foreground_tid != 0
        && foreground_tid != current_tid
        && unsafe { AttachThreadInput(current_tid, foreground_tid, 1) } != 0;
    let setter_accepted = unsafe { SetForegroundWindow(hwnd) } != 0;
    if attach_ok {
        unsafe {
            AttachThreadInput(current_tid, foreground_tid, 0);
        }
    }
    // The held process keeps liveness authority across the call; recheck the
    // HWND pid afterward against recycling.
    let _ = &target.held;
    if !pid_current(target.window.hwnd, target.window.identity.pid) {
        return FocusActuation {
            outcome: "pid-changed",
            setter_accepted,
            prime_inserted,
            attach_ok,
            eventual: false,
            deferred: false,
        };
    }
    if unsafe { GetForegroundWindow() } as usize as u64 == target.window.hwnd {
        return FocusActuation {
            outcome: "focus-ok",
            setter_accepted,
            prime_inserted,
            attach_ok,
            eventual: false,
            deferred: false,
        };
    }
    // Immediate miss with an accepted setter does not establish no transfer:
    // the system can deliver foreground after the call returns. Pump the
    // owner's own queue (new intents queue bounded for the next drain; the
    // hook callback stays prompt) and re-read, bounded with no foreign wait.
    let mut eventual = false;
    for _ in 0..FOCUS_SETTLE_ROUNDS {
        pump_wait(FOCUS_SETTLE_POLL_MS);
        if unsafe { GetForegroundWindow() } as usize as u64 == target.window.hwnd {
            eventual = true;
            break;
        }
    }
    // Recycled-HWND guard covers the settle window too.
    if !pid_current(target.window.hwnd, target.window.identity.pid) {
        return FocusActuation {
            outcome: "pid-changed",
            setter_accepted,
            prime_inserted,
            attach_ok,
            eventual: false,
            deferred: false,
        };
    }
    if eventual {
        return FocusActuation {
            outcome: "focus-ok",
            setter_accepted,
            prime_inserted,
            attach_ok,
            eventual,
            deferred: false,
        };
    }
    if !setter_accepted {
        return FocusActuation {
            outcome: "focus-unverified",
            setter_accepted,
            prime_inserted,
            attach_ok,
            eventual: false,
            deferred: false,
        };
    }
    FocusActuation {
        outcome: "focus-unverified",
        setter_accepted,
        prime_inserted,
        attach_ok,
        eventual: false,
        deferred: false,
    }
}

/// Drain one bounded batch of product keyboard intents against fresh complete
/// observations through the retained Engine.
///
/// While `blocked` is set (fullscreen suspension, an open managed gesture, or
/// a just-ended gesture settling) every intent drops safely with one bounded
/// stale line and nothing dispatches. Otherwise each consumed down/repeat
/// carries its chord-time origin (opaque token plus HWND/process-lifetime
/// evidence bound by the callback) and must re-resolve against fresh
/// observation: a chord consumed for A never acts on unrelated B after an
/// external focus change. The only retarget is an explicitly verified
/// owner-caused continuation within the same batch (a prior actuation moved
/// focus and the fresh foreground is exactly that target), so rapid repeated
/// navigation survives while external focus moves reject loudly. Focus intents
/// actuate the Engine `FocusDirectional` target with an exact foreground
/// readback; move intents apply the `MoveDirectional` geometry through the
/// shared write path and report its settled summary. Key-ups close the pair
/// and passed intents never dispatch: both are trace-only so held-key traffic
/// stays out of normal logs. Every settled action carries its correlation;
/// enumeration failure settles the action as failed. Log vocabulary is tokens
/// plus op/direction/edge/disposition/outcome/correlation only: no titles, raw
/// native ids, or keys.
fn keyboard_tick(
    state: &mut TileLoop,
    me: &ProcessIdentity,
    fulls: &[Rect],
    areas: &[MonitorArea],
    events: Vec<QueuedSnapEvent>,
    blocked: Option<&'static str>,
) {
    let log_path = state.log_path.clone();
    let dropped = crate::snapkey::sys::queue_dropped();
    if dropped > state.snap_dropped {
        log_json_at(
            &log_path,
            serde_json::json!({"event":"snap-drop","lost": dropped - state.snap_dropped}),
        );
        state.snap_dropped = dropped;
    }
    if let Some(cause) = blocked {
        // Suspension and gestures invalidate any own-focus chain: the next
        // batch starts without continuation.
        state.snap_advance = None;
        let mut stale = 0u32;
        for ev in events {
            match ev {
                QueuedSnapEvent::Mask(mask) => {
                    log_json_at(
                        &log_path,
                        serde_json::json!({
                            "event": "snap-mask",
                            "mask": crate::snapkey::sys::mask_evidence(&mask),
                        }),
                    );
                }
                QueuedSnapEvent::Intent(_) => stale += 1,
                QueuedSnapEvent::Workspace(_) => stale += 1,
            }
        }
        if stale > 0 {
            log_json_at(
                &log_path,
                serde_json::json!({"event":"snap-stale","cause": cause, "dropped": stale}),
            );
        }
        return;
    }
    // Owner-caused focus advances verified across batches live on the loop:
    // the only retarget a chord origin may take, so rapid repeated
    // navigation survives bounded drains while external focus moves reject.
    // Cleared on external focus, lifetime mismatch, suspension, or gesture.
    for ev in events {
        match ev {
            QueuedSnapEvent::Mask(mask) => {
                log_json_at(
                    &log_path,
                    serde_json::json!({
                        "event": "snap-mask",
                        "mask": crate::snapkey::sys::mask_evidence(&mask),
                    }),
                );
            }
            QueuedSnapEvent::Intent(intent) => {
                if !intent.consumed || !intent.announce {
                    // Key-ups close the pair and passed chords never dispatch:
                    // trace-only, so held-key traffic stays out of normal logs.
                    if state.trace {
                        log_json_at(
                            &log_path,
                            serde_json::json!({
                                "event": "snap",
                                "tick": state.tick,
                                "op": intent.op.as_str(),
                                "direction": direction_name(intent.direction),
                                "edge": intent.edge.as_str(),
                                "disposition": if intent.consumed { "consumed" } else { "passed" },
                                "outcome": if intent.consumed { "key-up" } else { "passed" },
                            }),
                        );
                    }
                    continue;
                }
                // Fresh complete observation per intent. The chord-time origin
                // must re-resolve: stale intents die here, never on a cached
                // rectangle.
                state.tick += 1;
                let tick = state.tick;
                let correlation = state.correlation();
                let Some(origin) = intent.origin.clone() else {
                    // Consumed without an origin cannot happen through the
                    // callback gate; settle defensively without dispatch.
                    state.snap_advance = None;
                    log_json_at(
                        &log_path,
                        serde_json::json!({
                            "event": "snap",
                            "tick": tick,
                            "correlation": correlation.as_str(),
                            "op": intent.op.as_str(),
                            "direction": direction_name(intent.direction),
                            "edge": intent.edge.as_str(),
                            "disposition": "consumed",
                            "outcome": "origin-vanished",
                        }),
                    );
                    continue;
                };
                let mut skipped: Vec<(String, String)> = Vec::new();
                let mut retained: Vec<RetainedRow> = Vec::new();
                let Some(mut observed) = state.observe(me, fulls, &mut skipped, &mut retained)
                else {
                    // Enumeration failure settles the action as failed; the
                    // Engine keeps retained state and the next tick retries.
                    log_json_at(
                        &log_path,
                        serde_json::json!({
                            "event": "snap",
                            "tick": tick,
                            "correlation": correlation.as_str(),
                            "op": intent.op.as_str(),
                            "direction": direction_name(intent.direction),
                            "edge": intent.edge.as_str(),
                            "disposition": "consumed",
                            "outcome": "observation-failed",
                            "origin": origin.token,
                        }),
                    );
                    continue;
                };
                publish_managed(state, &observed);
                ensure_workspace_assignments(state, me, &mut observed, areas);
                let fresh: Vec<SnapOrigin> = observed.iter().map(snap_origin_of).collect();
                let foreground_hwnd = Some(unsafe { GetForegroundWindow() } as usize as u64);
                let (from, continued) = match resolve_origin(
                    &origin,
                    foreground_hwnd,
                    &fresh,
                    state.snap_advance.as_ref(),
                ) {
                    OriginVerdict::Dispatch { token, continued } => (token, continued),
                    OriginVerdict::Reject(reason) => {
                        // External focus or lifetime mismatch invalidates the
                        // chain; never carry a stale advance forward.
                        state.snap_advance = None;
                        log_json_at(
                            &log_path,
                            serde_json::json!({
                                "event": "snap",
                                "tick": tick,
                                "correlation": correlation.as_str(),
                                "op": intent.op.as_str(),
                                "direction": direction_name(intent.direction),
                                "edge": intent.edge.as_str(),
                                "disposition": "consumed",
                                "outcome": reason,
                                "origin": origin.token,
                            }),
                        );
                        continue;
                    }
                };
                // Route through the origin window's own (output, workspace)
                // session: directional ops run on the retained per-workspace
                // domain the mover actually lives in, never a parallel
                // single-display family.
                let Some(member_key) = state
                    .member_tokens
                    .iter()
                    .find(|(_, token)| token.as_str() == from.as_str())
                    .map(|(key, _)| key.clone())
                else {
                    state.snap_advance = None;
                    log_json_at(
                        &log_path,
                        serde_json::json!({
                            "event": "snap",
                            "tick": tick,
                            "correlation": correlation.as_str(),
                            "op": intent.op.as_str(),
                            "direction": direction_name(intent.direction),
                            "edge": intent.edge.as_str(),
                            "disposition": "consumed",
                            "outcome": "unmanaged",
                            "origin": origin.token,
                        }),
                    );
                    continue;
                };
                if !crate::workspace_owner::member_matches(
                    &member_key,
                    origin.hwnd,
                    origin.pid,
                    &origin.creation,
                ) {
                    state.snap_advance = None;
                    log_json_at(
                        &log_path,
                        serde_json::json!({
                            "event": "snap",
                            "tick": tick,
                            "correlation": correlation.as_str(),
                            "op": intent.op.as_str(),
                            "direction": direction_name(intent.direction),
                            "edge": intent.edge.as_str(),
                            "disposition": "consumed",
                            "outcome": "origin-vanished",
                            "origin": origin.token,
                        }),
                    );
                    continue;
                }
                let Some(loc) = state.workspaces.member_loc(&member_key).cloned() else {
                    state.snap_advance = None;
                    log_json_at(
                        &log_path,
                        serde_json::json!({
                            "event": "snap",
                            "tick": tick,
                            "correlation": correlation.as_str(),
                            "op": intent.op.as_str(),
                            "direction": direction_name(intent.direction),
                            "edge": intent.edge.as_str(),
                            "disposition": "consumed",
                            "outcome": "unmanaged",
                            "origin": origin.token,
                        }),
                    );
                    continue;
                };
                let Some((domain, domain_key)) =
                    workspace_domain_for(&loc.output, &loc.workspace, areas)
                else {
                    log_json_at(
                        &log_path,
                        serde_json::json!({
                            "event": "snap",
                            "tick": tick,
                            "correlation": correlation.as_str(),
                            "op": intent.op.as_str(),
                            "direction": direction_name(intent.direction),
                            "edge": intent.edge.as_str(),
                            "disposition": "consumed",
                            "outcome": "unknown-output",
                            "origin": origin.token,
                        }),
                    );
                    continue;
                };
                let Some(rows) =
                    assemble_domain_rows(state, &loc.output, &loc.workspace, &observed, &retained)
                else {
                    state.snap_advance = None;
                    log_json_at(
                        &log_path,
                        serde_json::json!({
                            "event": "snap",
                            "tick": tick,
                            "correlation": correlation.as_str(),
                            "op": intent.op.as_str(),
                            "direction": direction_name(intent.direction),
                            "edge": intent.edge.as_str(),
                            "disposition": "consumed",
                            "outcome": "deferred",
                            "origin": origin.token,
                        }),
                    );
                    continue;
                };
                if !rows.iter().any(|r| r.token == from) {
                    state.snap_advance = None;
                    log_json_at(
                        &log_path,
                        serde_json::json!({
                            "event": "snap",
                            "tick": tick,
                            "correlation": correlation.as_str(),
                            "op": intent.op.as_str(),
                            "direction": direction_name(intent.direction),
                            "edge": intent.edge.as_str(),
                            "disposition": "consumed",
                            "outcome": "unmanaged",
                            "origin": origin.token,
                        }),
                    );
                    continue;
                }
                let windows: Vec<(WindowId, Rect)> = rows
                    .iter()
                    .map(|r| (WindowId(r.token.clone()), r.rect))
                    .collect();
                let fp = fingerprint(
                    &rows
                        .iter()
                        .map(|r| (r.token.clone(), r.rect))
                        .collect::<Vec<_>>(),
                );
                // `from` is the origin-verified token, never blind foreground.
                let from = WindowId(from);
                let mut event = crate::tiling::build_reconcile_event_for(
                    &state.owner,
                    &state.generation,
                    &correlation,
                    revision_for(state, &loc.output, &loc.workspace),
                    fp,
                    &domain,
                    &domain_key,
                    OUTER_GAP,
                    &windows,
                    Some(&from),
                );
                let direction = direction_name(intent.direction).to_owned();
                event.command = match intent.op {
                    SnapOp::Focus => CoreCommand::Focus {
                        window: from.0.clone(),
                        direction,
                        cross_output_transfer: false,
                    },
                    SnapOp::Move => CoreCommand::Move {
                        window: from.0.clone(),
                        direction,
                        cross_output_transfer: false,
                    },
                };
                // Single-domain observations run the local retained
                // propose/commit path; Core owns direction semantics.
                let reply = state.engine.handle(&event);
                let outcome = match intent.op {
                    SnapOp::Focus => {
                        if let CoreReply::FocusDirectional(plan) = &reply {
                            let to = plan.to_window.0.clone();
                            let actuation = actuate_focus(state, me, fulls, &observed, &to);
                            let outcome = actuation.outcome;
                            if outcome == "focus-ok" {
                                // Verified own advance: later intents in this
                                // batch and across bounded drains may continue
                                // from it; cleared on external focus,
                                // mismatch, suspension, or gesture.
                                state.snap_advance =
                                    observed.iter().find(|w| w.token == to).map(snap_origin_of);
                            } else {
                                state.snap_advance = None;
                            }
                            log_json_at(
                                &log_path,
                                serde_json::json!({
                                    "event": "snap",
                                    "tick": tick,
                                    "correlation": correlation.as_str(),
                                    "op": intent.op.as_str(),
                                    "direction": direction_name(intent.direction),
                                    "edge": intent.edge.as_str(),
                                    "disposition": "consumed",
                                    "outcome": outcome,
                                    "setter_accepted": actuation.setter_accepted,
                                    "prime_inserted": actuation.prime_inserted,
                                    "attach_ok": actuation.attach_ok,
                                    "eventual": actuation.eventual,
                                    "deferred": actuation.deferred,
                                    "origin": origin.token,
                                    "window": from.0,
                                    "continued": continued,
                                }),
                            );
                            continue;
                        }
                        reply_outcome(&reply)
                    }
                    SnapOp::Move => {
                        if let CoreReply::MoveDirectional(_) = &reply {
                            let writable =
                                writable_tokens(state, &loc.output, &loc.workspace, &observed);
                            let summary = apply_geometry(
                                state,
                                ApplyInput {
                                    me,
                                    fulls,
                                    reply: &reply,
                                    observed: &observed,
                                    op: "move",
                                    tick,
                                    correlation: correlation.as_str(),
                                    skipped,
                                    writable: &writable,
                                    output_token: state.workspaces.output_token(&loc.output),
                                    workspace_token: state
                                        .workspaces
                                        .workspace_token(&loc.output, &loc.workspace),
                                    revision: revision_for(state, &loc.output, &loc.workspace),
                                },
                            );
                            match summary {
                                Some(s) if !s.readback_ok => "move-unverified",
                                Some(s) if s.mismatched > 0 => "move-mismatch",
                                Some(s) if s.applied > 0 => "move-applied",
                                Some(_) => "move-noop",
                                None => reply_outcome(&reply),
                            }
                        } else {
                            reply_outcome(&reply)
                        }
                    }
                };
                log_json_at(
                    &log_path,
                    serde_json::json!({
                        "event": "snap",
                        "tick": tick,
                        "correlation": correlation.as_str(),
                        "op": intent.op.as_str(),
                        "direction": direction_name(intent.direction),
                        "edge": intent.edge.as_str(),
                        "disposition": "consumed",
                        "outcome": outcome,
                        "origin": origin.token,
                        "window": from.0,
                        "continued": continued,
                    }),
                );
            }
            QueuedSnapEvent::Workspace(intent) => {
                // Routed to workspace_tick by the caller; defensive drop here
                // stays trace-only so held-key traffic never pollutes logs.
                if state.trace {
                    log_json_at(
                        &log_path,
                        serde_json::json!({
                            "event": "workspace",
                            "tick": state.tick,
                            "op": intent.op.as_str(),
                            "index": intent.index,
                            "edge": intent.edge.as_str(),
                            "disposition": "rerouted",
                            "outcome": "workspace-tick",
                        }),
                    );
                }
            }
        }
    }
}

/// Stable output key for a rectangle center: the monitor containing the
/// center wins; otherwise the largest overlap; otherwise the primary.
/// Rectangles decide placement, device names decide session identity.
fn output_for_rect(areas: &[MonitorArea], rect: &Rect) -> String {
    let cx = rect.x + rect.w / 2;
    let cy = rect.y + rect.h / 2;
    for area in areas {
        let r = area.full;
        if cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h {
            return area.device.clone();
        }
    }
    let mut best: Option<(&MonitorArea, i64)> = None;
    for area in areas {
        let r = area.full;
        let ox = (rect.x.min(r.x + r.w) - rect.x.max(r.x)).max(0) as i64;
        let oy = (rect.y.min(r.y + r.h) - rect.y.max(r.y)).max(0) as i64;
        let overlap = ox * oy;
        if best.as_ref().is_none_or(|(_, d)| overlap > *d) {
            best = Some((area, overlap));
        }
    }
    best.map(|(a, _)| a.device.clone())
        .or_else(|| areas.first().map(|a| a.device.clone()))
        .unwrap_or_else(|| "display-?".to_owned())
}

fn output_for_point(areas: &[MonitorArea], x: i32, y: i32) -> Option<String> {
    for area in areas {
        let r = area.full;
        if x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h {
            return Some(area.device.clone());
        }
    }
    None
}

fn foreground_output(areas: &[MonitorArea]) -> Option<String> {
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.is_null() {
        return None;
    }
    let mut raw: RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(foreground, &mut raw) } == 0 {
        return None;
    }
    rect_from_win(raw).map(|r| output_for_rect(areas, &r))
}

/// Exact output context for a digit chord: cached active output when known,
/// else the foreground monitor, else the pointer monitor, else ordering.
fn chord_output(state: &TileLoop, areas: &[MonitorArea]) -> Option<String> {
    let cached = if state.active_output.is_empty() {
        None
    } else {
        Some(state.active_output.as_str())
    };
    let foreground = foreground_output(areas);
    let pointer = cursor_pos().and_then(|(x, y)| output_for_point(areas, x, y));
    crate::workspace_owner::output_context(
        &state.workspaces,
        cached,
        foreground.as_deref(),
        pointer.as_deref(),
    )
}

/// Engine revision for one `(output, workspace)` domain.
fn revision_for(state: &TileLoop, output: &str, workspace: &str) -> u64 {
    let key = tiler_core::session::DomainKey {
        output: tiler_core::directional::OutputId(output.to_owned()),
        workspace: tiler_core::directional::WorkspaceId(workspace.to_owned()),
    };
    state
        .engine
        .session(&key)
        .map(|s| s.accepted_revision())
        .unwrap_or(0)
}

/// Portable domain value for one workspace on its monitor's work area.
fn workspace_domain_for(
    output: &str,
    workspace: &str,
    areas: &[MonitorArea],
) -> Option<(
    tiler_core::session::OutputDomain,
    tiler_core::session::DomainKey,
)> {
    let area = areas.iter().find(|a| a.device == output)?;
    let bounds = tiling_domain_bounds(area.work)?;
    Some(crate::workspace_owner::workspace_domain(
        output, workspace, bounds, OUTER_GAP,
    ))
}

/// Assign newly seen eligible windows to the active workspace of their
/// monitor output. Hidden-claim HWNDs are never re-admitted into another
/// domain here. A nonempty scope admits only the named executables.
///
/// Visible-membership lifetime: every admitted window carries our inert
/// window-lifetime tag, verified live against the stored copy on every tick.
/// A same-process HWND reuse (same HWND/PID/creation, fresh window without
/// our tag) repairs here as a brand-new window: stale membership, Engine
/// token, identity, tag, and focus memory drop first, then a fresh tag is
/// stamped, a fresh Engine token is issued, and the current tick's row is
/// patched to it, so the new generation inherits no membership, focus, or
/// layout. Stamping writes only our own property name (dies with the window,
/// never trusted across runs, never removed by us); a failed stamp skips
/// admission fail-closed for the tick.
fn ensure_workspace_assignments(
    state: &mut TileLoop,
    me: &ProcessIdentity,
    observed: &mut [ObservedWindow],
    areas: &[MonitorArea],
) {
    for window in observed.iter_mut() {
        if !scope_allows(&state.scope, &window.identity.exe_path) {
            continue;
        }
        let key = crate::workspace::WindowKey {
            hwnd: window.hwnd,
            pid: window.identity.pid,
            creation: window.identity.process_creation.clone(),
        };
        // Never re-admit a claimed HWND nonce into another domain: any
        // same-HWND hidden claim blocks assignment regardless of key.
        if state.hidden_claims.keys().any(|k| k.hwnd == window.hwnd) {
            continue;
        }
        // Same-HWND reuse repair (cross-process): the fresh enumeration read
        // is authoritative, so stale same-HWND members (a destroyed window
        // whose number the OS recycled while visible) drop here instead of
        // stalling Engine convergence with a viewless member. Live hidden
        // claims never drop here; they retire through the ledger/audit path.
        let stale = crate::workspace_owner::reused_hwnd_stale(
            &state.member_tokens.keys().cloned().collect::<Vec<_>>(),
            &state.hidden_claims.keys().cloned().collect(),
            &key,
        );
        for dead in stale {
            if let Some(token) = state.member_tokens.remove(&dead) {
                state.member_rects.remove(&token);
            }
            state.member_identity.remove(&dead);
            state.member_tags.remove(&dead);
            state.workspaces.remove_window(&dead);
        }
        // Visible lifetime gate: the live tag must equal the stored tag. A
        // mismatch with the same key is a same-process reuse (or an untracked
        // window): drop every stale table so the admission below treats the
        // live window as brand new with no inheritance.
        let live_tag = crate::product_hide::sys::read_member_tag(window.hwnd);
        let lifetime_ok = state.member_tags.get(&key).is_some_and(|stored| {
            crate::workspace_owner::visible_lifetime_ok(stored, live_tag.as_deref())
        });
        if !lifetime_ok {
            if let Some(token) = state.member_tokens.remove(&key) {
                state.member_rects.remove(&token);
            }
            state.member_identity.remove(&key);
            state.member_tags.remove(&key);
            state.workspaces.remove_window(&key);
        }
        if !lifetime_ok || state.workspaces.member_loc(&key).is_none() {
            // Fresh admission binds the stamp to the expected full identity:
            // the live window is re-read (identity, eligibility, hosted
            // children) and exact proof ownership is re-verified before any
            // SetProp effect. Anything stale or foreign skips fail-closed.
            let identity = ProcessIdentity {
                pid: window.identity.pid,
                process_creation: window.identity.process_creation.clone(),
                user_sid: window.identity.user_sid.clone(),
                session_id: window.identity.session_id,
                exe_path: window.identity.exe_path.clone(),
            };
            if let Some(entries) = state.allowlist.as_ref() {
                let Some(entry) = entries.iter().find(|e| e.hwnd == key.hwnd) else {
                    continue;
                };
                if verify_proof_owned(key.hwnd, entry, me).is_err() {
                    continue;
                }
            }
            let admitted = match crate::product_hide::sys::classify_candidate(window.hwnd, me) {
                crate::product_hide::sys::CandidateStatus::Admissible(snap)
                | crate::product_hide::sys::CandidateStatus::Retained(snap) => snap,
                _ => continue,
            };
            if admitted.pid != identity.pid || admitted.process != identity {
                continue;
            }
            if !hosted_gate_allows(
                &identity.exe_path,
                window.hwnd,
                identity.pid,
                &state.scope_hosts,
            ) {
                continue;
            }
            let fresh_tag = match crate::product_hide::sys::install_member_tag(window.hwnd, me.pid)
            {
                Ok(tag) => tag,
                Err(_) => continue,
            };
            // Post-stamp postcheck: the expected identity must still be live
            // with the fresh tag reading back, or no membership is stored.
            let post_ok = crate::product_hide::sys::hold_target_verified(identity.pid, &identity)
                .is_ok()
                && pid_current(window.hwnd, identity.pid)
                && crate::product_hide::sys::read_member_tag(window.hwnd).as_deref()
                    == Some(fresh_tag.as_str());
            if !post_ok {
                continue;
            }
            let fresh_token = state
                .tokens
                .reissue(window.hwnd, &window.identity.process_creation);
            window.token = fresh_token.clone();
            let output = output_for_rect(areas, &window.visible);
            state.workspaces.ensure_output(&output);
            let Some(active) = state.workspaces.active_id(&output) else {
                continue;
            };
            if state
                .workspaces
                .assign(key.clone(), &output, &active, false)
            {
                state.member_tokens.insert(key.clone(), fresh_token.clone());
                state.member_rects.insert(fresh_token, window.visible);
                state.member_identity.insert(key.clone(), identity);
                state.member_tags.insert(key, fresh_tag);
            }
            continue;
        }
        let identity = ProcessIdentity {
            pid: window.identity.pid,
            process_creation: window.identity.process_creation.clone(),
            user_sid: window.identity.user_sid.clone(),
            session_id: window.identity.session_id,
            exe_path: window.identity.exe_path.clone(),
        };
        state
            .member_tokens
            .insert(key.clone(), window.token.clone());
        state
            .member_rects
            .insert(window.token.clone(), window.visible);
        state.member_identity.insert(key, identity);
    }
    if state.active_output.is_empty()
        && let Some(first) = state.workspaces.output_keys().into_iter().next()
    {
        state.active_output = first;
    }
}

/// Periodic hidden-claim audit: destroyed/recycled claims retire through the
/// identity-safe reveal path (no foreign writes), then drop session
/// membership, tokens, identity, and prune emptied workspaces. A merely
/// invisible window never retires anything: only `query_recovery` decides.
/// Unknown identities retain with the ledger kept.
fn audit_hidden_claims(state: &mut TileLoop, me: &ProcessIdentity, store: &LedgerStore) {
    let keys: Vec<crate::workspace::WindowKey> = state.hidden_claims.keys().cloned().collect();
    let mut retired_any = false;
    for key in keys {
        let Some(record) = state.hidden_claims.get(&key).cloned() else {
            continue;
        };
        let dead = match crate::product_hide::sys::query_recovery(key.hwnd, me) {
            Ok(snap) => {
                snap.process != record.claim.process
                    || snap.nonce.as_deref() != Some(record.claim.tag.as_str())
            }
            Err(e) => {
                let msg = e.to_string();
                if msg.starts_with("absent:") || msg.contains("sid/session mismatch") {
                    true
                } else {
                    // Unknown: retain with the ledger kept.
                    continue;
                }
            }
        };
        if !dead {
            continue;
        }
        let _ = crate::product_hide::sys::reveal_product_claim_to(
            store,
            me,
            &record.claim,
            record.iconic,
        );
        state.hidden_claims.remove(&key);
        if let Some(token) = state.member_tokens.remove(&key) {
            state.member_rects.remove(&token);
        }
        state.member_identity.remove(&key);
        state.member_tags.remove(&key);
        state.workspaces.remove_window(&key);
        retired_any = true;
    }
    if retired_any {
        for output in state.workspaces.output_keys() {
            let Some(active_id) = state.workspaces.active_id(&output) else {
                continue;
            };
            let displaced: Vec<String> = state
                .workspaces
                .displaced_snapshot()
                .values()
                .flat_map(|r| r.workspace_ids.clone())
                .collect();
            let (removed, append) = state.workspaces.plan_cleanup(
                &output,
                std::slice::from_ref(&active_id),
                &displaced,
            );
            state.workspaces.apply_cleanup(&output, &removed, append);
        }
    }
}

/// Drop membership for windows that vanished from the raw enumeration
/// inventory. Retained-occupancy members (minimized, maximized, fullscreen)
/// stay enumerated with identity, so only a truly absent HWND cleans up;
/// hidden claims retire through the reveal path, never here. Unknown
/// identities (enumeration without resolution) retain membership.
fn workspace_close_cleanup(state: &mut TileLoop) {
    let gone: Vec<crate::workspace::WindowKey> = state
        .member_tokens
        .keys()
        .filter(|k| !state.last_hwnds.contains(&k.hwnd) && !state.hidden_claims.contains_key(k))
        .cloned()
        .collect();
    for key in gone {
        if let Some(token) = state.member_tokens.remove(&key) {
            state.member_rects.remove(&token);
        }
        state.member_identity.remove(&key);
        state.member_tags.remove(&key);
        state.workspaces.remove_window(&key);
    }
}

/// Hide one managed member bound to its stored full identity: the live
/// window must equal the stored [`ProcessIdentity`] exactly, so a recycled
/// HWND refuses with no writes. Fresh proof gate on every write in proof
/// modes; commit-before-hide through the central watcher/ledger. Outcomes
/// are typed at the source, never selected by error strings.
fn workspace_hide_one(
    state: &mut TileLoop,
    me: &ProcessIdentity,
    store: &LedgerStore,
    dir: &Path,
    key: &crate::workspace::WindowKey,
    expected: &ProcessIdentity,
    iconic: bool,
) -> &'static str {
    use crate::product_hide::sys::ManagedAdmitError;
    if state.allowlist.is_some() && !state.workspace_proof {
        return "workspace-disabled";
    }
    if !scope_allows(&state.scope, &expected.exe_path) {
        return "scope-excluded";
    }
    // Listed hosts hide only with a live matching hosted child, re-verified
    // fresh here (not from the tick's observation): a newly appearing hosted
    // app is never hidden under another app's membership.
    if !hosted_gate_allows(
        &expected.exe_path,
        key.hwnd,
        expected.pid,
        &state.scope_hosts,
    ) {
        return "scope-excluded";
    }
    // Visible lifetime gate: the live member tag must equal the stored tag.
    // A same-process HWND reuse (same HWND/PID/creation, fresh window)
    // drops its stale membership here with no writes; the next tick
    // re-admits the live window as brand new.
    let live_tag = crate::product_hide::sys::read_member_tag(key.hwnd);
    let stored_tag = state.member_tags.get(key).cloned().unwrap_or_default();
    if !crate::workspace_owner::visible_lifetime_ok(&stored_tag, live_tag.as_deref()) {
        if let Some(token) = state.member_tokens.remove(key) {
            state.member_rects.remove(&token);
        }
        state.member_identity.remove(key);
        state.member_tags.remove(key);
        state.workspaces.remove_window(key);
        return "identity-changed";
    }
    if let Some(entries) = state.allowlist.as_ref() {
        let Some(entry) = entries.iter().find(|e| e.hwnd == key.hwnd) else {
            return "allowlist-changed";
        };
        if verify_proof_owned(key.hwnd, entry, me).is_err() {
            return "identity-changed";
        }
    }
    let claim =
        match crate::product_hide::sys::admit_managed_claim(key.hwnd, me, expected, &stored_tag) {
            Ok(claim) => claim,
            Err(ManagedAdmitError::Absent) => return "origin-vanished",
            Err(ManagedAdmitError::Uncertain) => return "uncertain",
            Err(ManagedAdmitError::WrongIdentity) => return "identity-changed",
            Err(ManagedAdmitError::Refused(_)) => return "refused",
        };
    match crate::product_hide::sys::hide_managed_claim(store, me, &claim, dir) {
        Ok(committed) => {
            state.hidden_claims.insert(
                key.clone(),
                HiddenRecord {
                    claim: committed,
                    iconic,
                },
            );
            "hidden"
        }
        Err(e) => {
            // Commit-before-hide appends the durable enriched claim BEFORE the
            // async visibility post: an already-committed claim must register
            // in the owner table even when the post-hide readback fails, or
            // the window is lost (hidden with no claim). Re-read the ledger
            // for the exact key (full identity plus tag); never re-admit the
            // claimed HWND nonce and never fabricate a rollback.
            if let Ok(Some(record)) = store.committed()
                && record.owner == *me
                && let Some(durable) = record.windows.iter().find(|w| {
                    w.hwnd == claim.hwnd
                        && w.tag == claim.tag
                        && w.process == claim.process
                        && w.kind == crate::model::WindowClaimKind::Product
                })
            {
                state.hidden_claims.insert(
                    key.clone(),
                    HiddenRecord {
                        claim: durable.clone(),
                        iconic,
                    },
                );
            }
            let msg = e.to_string();
            if msg.starts_with("absent:") {
                "origin-vanished"
            } else if msg.starts_with("uncertain:") {
                "uncertain"
            } else {
                "refused"
            }
        }
    }
}

/// Fresh proof-owned gate for one reveal write: in proof modes the helper
/// must verify against the frozen allowlist immediately before the reveal
/// effect, exactly like the hide path.
fn workspace_proof_reveal_gate(
    state: &TileLoop,
    me: &ProcessIdentity,
    hwnd: u64,
) -> std::result::Result<(), &'static str> {
    let Some(entries) = state.allowlist.as_ref() else {
        return Ok(());
    };
    if !state.workspace_proof {
        return Err("workspace-disabled");
    }
    let Some(entry) = entries.iter().find(|e| e.hwnd == hwnd) else {
        return Err("allowlist-changed");
    };
    verify_proof_owned(hwnd, entry, me).map_err(|_| "identity-changed")
}

/// Switch the visible set from the output's active workspace to `target`:
/// hide the prior set, reveal the target set, preserve Engine sessions for
/// both, prune trailing empties, then re-enumerate fresh, establish the
/// appropriate target focus BEFORE geometry (with fullscreen/elevated fences
/// retained so a real arrival is never stolen from), then reconcile the
/// selected domain geometry with verified readback. Empty targets hide the
/// prior set and take no focus.
/// The pre-switch `observed` serves only the hide phase; focus never uses it
/// because the hidden target set is absent from it by construction.
/// `ctx` carries the stable action correlation even when inner ticks
/// increment; `focus_hint` (send-follow mover) wins when eligible so the
/// caller can reuse the fresh focus without a redundant enumeration.
#[allow(clippy::too_many_arguments)]
fn workspace_do_select(
    state: &mut TileLoop,
    me: &ProcessIdentity,
    store: &LedgerStore,
    dir: &Path,
    fulls: &[Rect],
    areas: &[MonitorArea],
    observed: &mut [ObservedWindow],
    output: &str,
    target: &str,
    ctx: &ActionCtx,
    focus_hint: Option<&crate::workspace::WindowKey>,
) -> SelectEffect {
    let none =
        |outcome: &'static str, source_workspace: String, target_workspace: String| SelectEffect {
            outcome,
            geometry: None,
            focus: "none",
            transition_ms: 0,
            observation_ms: 0,
            geometry_ms: 0,
            hide_ms: 0,
            reveal_ms: 0,
            focus_ms: 0,
            plan_ms: 0,
            source_workspace,
            target_workspace,
        };
    let Some(current) = state.workspaces.active_id(output) else {
        return none("unknown-output", "ws?".to_owned(), "ws?".to_owned());
    };
    if current == target {
        state.active_output = output.to_owned();
        let token = state.workspaces.workspace_token(output, target);
        return none("already-active", token.clone(), token);
    }
    let source_token = state.workspaces.workspace_token(output, &current);
    let target_token = state.workspaces.workspace_token(output, target);
    let by_hwnd: HashMap<u64, &ObservedWindow> = observed.iter().map(|w| (w.hwnd, w)).collect();
    let leaving = state.workspaces.workspace_members(output, &current);
    let mut hide_failed = false;
    // Windows newly committed to hidden in this transition: on any failure
    // before activation these are safely revealed back (exact identity) so a
    // partial never leaves a doubled visible set or a lost claim behind.
    let mut newly_hidden: Vec<crate::workspace::WindowKey> = Vec::new();
    let hide_start = Instant::now();
    for key in &leaving {
        if state.workspaces.is_hidden(key) {
            continue;
        }
        let Some(expected) = state.member_identity.get(key).cloned() else {
            continue;
        };
        // Explicit scope fences every hide: out-of-scope members stay
        // visible and keep membership, never hidden.
        if !scope_allows(&state.scope, &expected.exe_path) {
            continue;
        }
        // Bind the hide to the stored full member identity: a recycled HWND
        // (same number, fresh process) reconciles membership with no writes.
        // Members absent from the tiled observation hide through a fresh
        // identity-only read so retained minimized/maximized/fullscreen
        // members still leave the visible set.
        let (live_ok, iconic) = match by_hwnd.get(&key.hwnd) {
            Some(window) => {
                let live_ok = crate::workspace_owner::member_matches(
                    key,
                    window.hwnd,
                    window.identity.pid,
                    &window.identity.process_creation,
                ) && window.identity.exe_path == expected.exe_path
                    && window.identity.user_sid == expected.user_sid
                    && window.identity.session_id == expected.session_id;
                (live_ok, window.facts.minimized)
            }
            None => match crate::product_hide::sys::query_recovery(key.hwnd, me) {
                Ok(snap) => {
                    let live_ok = snap.pid == expected.pid
                        && snap.process == expected
                        && snap.nonce.is_none();
                    (live_ok, snap.iconic)
                }
                Err(e) => {
                    let msg = e.to_string();
                    if msg.starts_with("absent:") || msg.contains("sid/session mismatch") {
                        if let Some(token) = state.member_tokens.remove(key) {
                            state.member_rects.remove(&token);
                        }
                        state.member_identity.remove(key);
                        state.member_tags.remove(key);
                        state.workspaces.remove_window(key);
                    } else {
                        hide_failed = true;
                    }
                    continue;
                }
            },
        };
        if !live_ok {
            // Recycled HWND: drop the stale membership, never touch the new
            // owner, and retire any same-HWND claim residue without writes.
            if let Some(token) = state.member_tokens.remove(key) {
                state.member_rects.remove(&token);
            }
            state.member_identity.remove(key);
            state.member_tags.remove(key);
            state.workspaces.remove_window(key);
            continue;
        }
        let had_claim = state.hidden_claims.contains_key(key);
        let outcome = workspace_hide_one(state, me, store, dir, key, &expected, iconic);
        // A committed claim (exact full identity plus tag) is owned even when
        // the post-hide readback reports uncertain: the ledger and the owner
        // table keep it, never a lost window.
        if state.hidden_claims.contains_key(key) || outcome == "hidden" {
            state.workspaces.set_hidden(key, true);
            if !had_claim {
                newly_hidden.push(key.clone());
            }
        } else if outcome == "origin-vanished" || outcome == "identity-changed" {
            if let Some(token) = state.member_tokens.remove(key) {
                state.member_rects.remove(&token);
            }
            state.member_identity.remove(key);
            state.member_tags.remove(key);
            state.workspaces.remove_window(key);
        } else if outcome == "scope-excluded" {
            // Explicit scope fence: out-of-scope members stay visible with
            // membership intact, never hidden, never a failure.
        } else {
            hide_failed = true;
        }
    }
    // A failed hide phase never activates: revealing the target beside a
    // still-visible current set would double the visible set and lose claims.
    // Narrow recovery reveals exactly the claims committed above (exact
    // identity, no blind replay, no fabricated rollback) and keeps current.
    let hide_ms = hide_start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    if hide_failed {
        for key in &newly_hidden {
            let Some(record) = state.hidden_claims.get(key).cloned() else {
                continue;
            };
            match crate::product_hide::sys::reveal_product_claim_to(
                store,
                me,
                &record.claim,
                record.iconic,
            ) {
                Ok(crate::product_hide::ProductTeardown::Retired) => {
                    state.hidden_claims.remove(key);
                    if let Some(token) = state.member_tokens.remove(key) {
                        state.member_rects.remove(&token);
                    }
                    state.member_identity.remove(key);
                    state.member_tags.remove(key);
                    state.workspaces.remove_window(key);
                }
                Ok(_) => {
                    state.hidden_claims.remove(key);
                    state.workspaces.set_hidden(key, false);
                }
                Err(_) => {}
            }
        }
        return SelectEffect {
            outcome: "partial",
            hide_ms,
            source_workspace: source_token.clone(),
            target_workspace: target_token.clone(),
            ..none("partial", source_token.clone(), target_token.clone())
        };
    }
    let entering = state.workspaces.workspace_members(output, target);
    let reveal_start = Instant::now();
    for key in &entering {
        let Some(record) = state.hidden_claims.get(key).cloned() else {
            state.workspaces.set_hidden(key, false);
            continue;
        };
        if workspace_proof_reveal_gate(state, me, key.hwnd).is_err() {
            hide_failed = true;
            continue;
        }
        match crate::product_hide::sys::reveal_product_claim_to(
            store,
            me,
            &record.claim,
            record.iconic,
        ) {
            Ok(crate::product_hide::ProductTeardown::Retired) => {
                state.hidden_claims.remove(key);
                if let Some(token) = state.member_tokens.remove(key) {
                    state.member_rects.remove(&token);
                }
                state.member_identity.remove(key);
                state.member_tags.remove(key);
                state.workspaces.remove_window(key);
            }
            Ok(_) => {
                state.hidden_claims.remove(key);
                state.workspaces.set_hidden(key, false);
            }
            Err(_) => {
                hide_failed = true;
            }
        }
    }
    // A failed reveal phase keeps current as well: the leaving set was
    // hidden successfully, so the safest known view is restored by revealing
    // exactly those affected claims (exact identity only). The switch is not
    // pretended: the outcome stays partial with current kept.
    let reveal_ms = reveal_start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    if hide_failed {
        for key in &newly_hidden {
            let Some(record) = state.hidden_claims.get(key).cloned() else {
                continue;
            };
            match crate::product_hide::sys::reveal_product_claim_to(
                store,
                me,
                &record.claim,
                record.iconic,
            ) {
                Ok(crate::product_hide::ProductTeardown::Retired) => {
                    state.hidden_claims.remove(key);
                    if let Some(token) = state.member_tokens.remove(key) {
                        state.member_rects.remove(&token);
                    }
                    state.member_identity.remove(key);
                    state.member_tags.remove(key);
                    state.workspaces.remove_window(key);
                }
                Ok(_) => {
                    state.hidden_claims.remove(key);
                    state.workspaces.set_hidden(key, false);
                }
                Err(_) => {}
            }
        }
        return SelectEffect {
            outcome: "partial",
            hide_ms,
            reveal_ms,
            source_workspace: source_token.clone(),
            target_workspace: target_token.clone(),
            ..none("partial", source_token.clone(), target_token.clone())
        };
    }
    // Move active to the target id without disturbing order, including
    // appended trailing ids past the Win1..9 ordinal range. This is the only
    // activation point: callers resolve targets without preactivating so the
    // `current == target` guard above stays accurate. Reached only after the
    // hide and reveal effects verified, so the switch is real.
    state.workspaces.activate(output, target);
    state.active_output = output.to_owned();
    // Trailing maintenance: keep one empty, minimum two, active preserved.
    let active_id = state.workspaces.active_id(output).unwrap_or_default();
    let displaced: Vec<String> = state
        .workspaces
        .displaced_snapshot()
        .values()
        .flat_map(|r| r.workspace_ids.clone())
        .collect();
    let (removed, append) =
        state
            .workspaces
            .plan_cleanup(output, std::slice::from_ref(&active_id), &displaced);
    state.workspaces.apply_cleanup(output, &removed, append);
    // Post-reveal fresh observation: the pre-switch `observed` cannot contain
    // the hidden target set, so focusing from it always misses as `vanished`.
    // Re-enumerate, republish origins, establish the appropriate target focus
    // BEFORE geometry (fenced), then reconcile the selected domain geometry
    // with verified readback. Empty targets hide the prior set and take no
    // focus.
    let transition_ms = ctx.start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    let observation_start = Instant::now();
    let mut fresh_skipped: Vec<(String, String)> = Vec::new();
    let mut fresh_retained: Vec<RetainedRow> = Vec::new();
    let Some(mut fresh_observed) =
        state.observe(me, fulls, &mut fresh_skipped, &mut fresh_retained)
    else {
        let observation_ms = observation_start
            .elapsed()
            .as_millis()
            .min(u128::from(u64::MAX)) as u64;
        return SelectEffect {
            outcome: "observation-failed",
            transition_ms,
            observation_ms,
            hide_ms,
            reveal_ms,
            source_workspace: source_token.clone(),
            target_workspace: target_token.clone(),
            ..none(
                "observation-failed",
                source_token.clone(),
                target_token.clone(),
            )
        };
    };
    let observation_ms = observation_start
        .elapsed()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;
    publish_managed(state, &fresh_observed);
    ensure_workspace_assignments(state, me, &mut fresh_observed, areas);
    workspace_close_cleanup(state);
    // Focus-before-geometry on the verified transition: the revealed target
    // must hold foreground before writes so a transient foreground cannot
    // veto eligible writes on the next tick. All fences retained: a real
    // fullscreen or elevated arrival is never stolen from, and identity,
    // lifetime, scope, and observation gates inside `actuate_focus` still
    // apply. Skipping focus there lets geometry veto honestly.
    let members = state.workspaces.workspace_members(output, target);
    let fresh_tokens: HashSet<String> = fresh_observed.iter().map(|w| w.token.clone()).collect();
    let eligible =
        state
            .workspaces
            .eligible_focus_set(&members, &state.member_tokens, &fresh_tokens);
    let focus_key = focus_hint
        .filter(|hint| eligible.contains(*hint))
        .cloned()
        .or_else(|| state.workspaces.focus_target(output, target, &eligible));
    let mut focus_outcome: &'static str = "no-focus";
    // Focus duration covers the bounded pumped settle when it runs, so a
    // dominating 500 ms settle attributes to focus, not geometry.
    let mut focus_ms: u64 = 0;
    if let Some(ref focus_key) = focus_key {
        let token = state
            .member_tokens
            .get(focus_key)
            .cloned()
            .unwrap_or_default();
        if !token.is_empty() {
            if crate::workspace_owner::focus_before_geometry(
                true,
                foreground_fullscreen(fulls),
                foreground_elevated(me),
            ) {
                let focus_start = Instant::now();
                let actuation = actuate_focus(state, me, fulls, &fresh_observed, &token);
                focus_ms = focus_start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
                focus_outcome = actuation.outcome;
                if actuation.outcome == "focus-ok" {
                    state.workspaces.note_foreground(focus_key);
                }
            } else {
                // Fenced: a real fullscreen/elevated foreground arrived
                // during the transition. Never steal; geometry below vetoes
                // honestly instead of riding along.
                focus_outcome = "focus-skipped-fence";
            }
        }
    }
    let mut geometry: Option<ApplySummary> = None;
    if let Some((domain, domain_key)) = workspace_domain_for(output, target, areas)
        && let Some(rows) =
            assemble_domain_rows(state, output, target, &fresh_observed, &fresh_retained)
    {
        let windows: Vec<(WindowId, Rect)> = rows
            .iter()
            .map(|r| (WindowId(r.token.clone()), r.rect))
            .collect();
        let fp = fingerprint(
            &rows
                .iter()
                .map(|r| (r.token.clone(), r.rect))
                .collect::<Vec<_>>(),
        );
        // Foreground read after the focus above, so the Engine sees the
        // established target focus when eligible.
        let focused = state
            .focused_token(&fresh_observed)
            .filter(|f| windows.iter().any(|(w, _)| w == f));
        state.tick += 1;
        let tick = state.tick;
        let correlation =
            CorrelationId::parse(&ctx.correlation).expect("action correlation is a valid token");
        let plan_start = Instant::now();
        let event = crate::tiling::build_reconcile_event_for(
            &state.owner,
            &state.generation,
            &correlation,
            revision_for(state, output, target),
            fp,
            &domain,
            &domain_key,
            OUTER_GAP,
            &windows,
            focused.as_ref(),
        );
        let reply = state.engine.handle(&event);
        let plan_ms = plan_start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
        let writable = writable_tokens(state, output, target, &fresh_observed);
        let geometry_start = Instant::now();
        let summary = apply_geometry(
            state,
            ApplyInput {
                me,
                fulls,
                reply: &reply,
                observed: &fresh_observed,
                op: "reconcile",
                tick,
                correlation: ctx.correlation.as_str(),
                skipped: fresh_skipped,
                writable: &writable,
                output_token: state.workspaces.output_token(output),
                workspace_token: state.workspaces.workspace_token(output, target),
                revision: revision_for(state, output, target),
            },
        );
        let geometry_ms = geometry_start
            .elapsed()
            .as_millis()
            .min(u128::from(u64::MAX)) as u64;
        geometry = summary;
        return SelectEffect {
            outcome: "ok",
            geometry,
            focus: focus_outcome,
            transition_ms,
            observation_ms,
            geometry_ms,
            hide_ms,
            reveal_ms,
            focus_ms,
            plan_ms,
            source_workspace: source_token.clone(),
            target_workspace: target_token.clone(),
        };
    }
    SelectEffect {
        outcome: "ok",
        geometry,
        focus: focus_outcome,
        transition_ms,
        observation_ms,
        geometry_ms: 0,
        hide_ms,
        reveal_ms,
        focus_ms,
        plan_ms: 0,
        source_workspace: source_token.clone(),
        target_workspace: target_token.clone(),
    }
}

/// Send the focused tiled window to an existing/trailing same-output
/// workspace through the retained Engine `MoveToWorkspace` route, verify the
/// project-owned membership transfer, then follow. Refuses unmanaged focus,
/// no-op/foreign transfers, and proof modes without workspace hides.
///
/// Source reflow consumes the existing `SendWorkspace` plan while the source
/// survivors are still visible and eligible in the same action (scoped by the
/// source writable set; hidden/retained rows never take writes). The follow
/// select then reveals the target, establishes mover focus before geometry
/// with all fences retained, and reconciles the destination in the same
/// action. The select's fresh focus/observation is reused: no redundant
/// post-follow enumeration. Real fullscreen/unreadable/identity/incomplete
/// observation continues to block writes honestly; `ok` never implies
/// applied.
#[allow(clippy::too_many_arguments)]
fn workspace_do_send(
    state: &mut TileLoop,
    me: &ProcessIdentity,
    store: &LedgerStore,
    dir: &Path,
    fulls: &[Rect],
    areas: &[MonitorArea],
    observed: &mut [ObservedWindow],
    retained: &[RetainedRow],
    output: &str,
    index: u8,
    mover_hwnd: u64,
    origin_token: &str,
    origin_pid: u32,
    origin_creation: &str,
    ctx: &ActionCtx,
) -> SendEffect {
    let fail = |outcome: &'static str| SendEffect {
        outcome,
        focus: "none",
        source: None,
        target: None,
        transition_ms: 0,
        observation_ms: 0,
        source_geometry_ms: 0,
        target_geometry_ms: 0,
        hide_ms: 0,
        reveal_ms: 0,
        focus_ms: 0,
        source_plan_ms: 0,
        target_plan_ms: 0,
        source_workspace: "ws?".to_owned(),
        target_workspace: "ws?".to_owned(),
    };
    let mover_key = state
        .member_tokens
        .iter()
        .find(|(_, t)| t.as_str() == origin_token)
        .map(|(k, _)| k.clone());
    let Some(mover_key) = mover_key else {
        return fail("unmanaged");
    };
    // Full chord-time binding: token plus HWND, PID, and process creation.
    // A recycled HWND or a retargeted token never dispatches.
    if !crate::workspace_owner::member_matches(&mover_key, mover_hwnd, origin_pid, origin_creation)
    {
        return fail("foreground-changed");
    }
    let Some(loc) = state.workspaces.member_loc(&mover_key).cloned() else {
        return fail("unmanaged");
    };
    if loc.output != output || state.workspaces.is_hidden(&mover_key) {
        return fail("unmanaged");
    }
    // Explicit scope fences every send before the Engine mutation: an
    // out-of-scope mover reports without touching Engine sessions,
    // membership, or layout. The hide path re-fences independently.
    if let Some(stored) = state.member_identity.get(&mover_key) {
        if !scope_allows(&state.scope, &stored.exe_path) {
            return fail("scope-excluded");
        }
        // Listed hosts send only with a live matching hosted child: a newly
        // appearing hosted app never dispatches under another app's
        // membership. The hide path re-fences fresh independently.
        if !hosted_gate_allows(&stored.exe_path, mover_hwnd, stored.pid, &state.scope_hosts) {
            return fail("scope-excluded");
        }
    }
    // Visible lifetime gate: the live member tag must equal the stored tag,
    // so a same-process HWND reuse (same HWND/PID/creation, fresh window)
    // dispatches nothing. The stale membership drops here; the next tick
    // re-admits the live window as brand new with no inheritance.
    let live_tag = crate::product_hide::sys::read_member_tag(mover_hwnd);
    let lifetime_ok = state.member_tags.get(&mover_key).is_some_and(|stored| {
        crate::workspace_owner::visible_lifetime_ok(stored, live_tag.as_deref())
    });
    if !lifetime_ok {
        if let Some(token) = state.member_tokens.remove(&mover_key) {
            state.member_rects.remove(&token);
        }
        state.member_identity.remove(&mover_key);
        state.member_tags.remove(&mover_key);
        state.workspaces.remove_window(&mover_key);
        return fail("identity-changed");
    }
    if state.allowlist.is_some() && !state.workspace_proof {
        return fail("workspace-disabled");
    }
    let target_id = if index == 0 {
        // Trailing send reuses or creates without switching first.
        match state.workspaces.resolve_send_trailing(output) {
            Some((id, _)) => id,
            None => return fail("unknown-output"),
        }
    } else {
        match state.workspaces.resolve_send(output, index) {
            Some(id) => id,
            None => return fail("unknown-target"),
        }
    };
    if target_id == loc.workspace {
        return fail("no-op");
    }
    let source_token = state.workspaces.workspace_token(output, &loc.workspace);
    let target_token = state.workspaces.workspace_token(output, &target_id);
    let fail_at = |outcome: &'static str| SendEffect {
        outcome,
        focus: "none",
        source: None,
        target: None,
        transition_ms: 0,
        observation_ms: 0,
        source_geometry_ms: 0,
        target_geometry_ms: 0,
        hide_ms: 0,
        reveal_ms: 0,
        focus_ms: 0,
        source_plan_ms: 0,
        target_plan_ms: 0,
        source_workspace: source_token.clone(),
        target_workspace: target_token.clone(),
    };
    // Full source+target observations including hidden snapshots, so the
    // planned mutation reuses topology instead of remove/reseed. Either side
    // incomplete defers with retained state, never a falsely complete pair.
    let Some(source_rows) = assemble_domain_rows(state, output, &loc.workspace, observed, retained)
    else {
        return fail_at("deferred");
    };
    let Some(target_rows) = assemble_domain_rows(state, output, &target_id, observed, retained)
    else {
        return fail_at("deferred");
    };
    if !source_rows.iter().any(|r| r.token == origin_token) {
        return fail_at("unmanaged");
    }
    let Some((source_domain, source_key)) = workspace_domain_for(output, &loc.workspace, areas)
    else {
        return fail_at("unknown-output");
    };
    let Some((target_domain, target_key)) = workspace_domain_for(output, &target_id, areas) else {
        return fail_at("unknown-output");
    };
    let fingerprint = {
        let mut pairs: Vec<(String, Rect)> = source_rows
            .iter()
            .chain(target_rows.iter())
            .map(|r| (r.token.clone(), r.rect))
            .collect();
        pairs.sort_by(|a, b| a.0.cmp(&b.0));
        fingerprint(
            &pairs
                .iter()
                .map(|(t, r)| (t.clone(), *r))
                .collect::<Vec<_>>(),
        )
    };
    let action_correlation =
        CorrelationId::parse(&ctx.correlation).expect("action correlation is a valid token");
    let revision = revision_for(state, output, &loc.workspace);
    let Some(mut event) = crate::workspace_owner::build_send_event(
        &state.owner,
        &state.generation,
        &action_correlation,
        revision,
        fingerprint,
        (source_domain, source_key.clone()),
        (target_domain, target_key.clone()),
        &source_rows,
        &target_rows,
        origin_token,
        OUTER_GAP,
    ) else {
        return fail_at("refused");
    };
    crate::workspace_owner::stamp_send_target(&mut event, &target_key);
    let source_plan_start = Instant::now();
    let reply = state.engine.handle(&event);
    let source_plan_ms = source_plan_start
        .elapsed()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;
    let tiler_core::boundary::CoreReply::SendWorkspace(_) = reply else {
        let outcome: &'static str = match reply {
            tiler_core::boundary::CoreReply::Rejected { kind, .. } => kind,
            tiler_core::boundary::CoreReply::Diverged(reason) => reason.as_str(),
            tiler_core::boundary::CoreReply::SnapshotInvalid { detail, .. } => detail,
            _ => "refused",
        };
        return fail_at(outcome);
    };
    // Project-owned membership change after revalidation and the planned
    // Engine mutation: exact identity table update, never HWND alone.
    let by_hwnd: HashMap<u64, &ObservedWindow> = observed.iter().map(|w| (w.hwnd, w)).collect();
    let Some(fresh) = by_hwnd.get(&mover_hwnd) else {
        return fail_at("origin-vanished");
    };
    let Some(stored) = state.member_identity.get(&mover_key).cloned() else {
        return fail_at("unmanaged");
    };
    if !crate::workspace_owner::member_matches(
        &mover_key,
        fresh.hwnd,
        fresh.identity.pid,
        &fresh.identity.process_creation,
    ) || fresh.identity.exe_path != stored.exe_path
        || fresh.identity.user_sid != stored.user_sid
        || fresh.identity.session_id != stored.session_id
    {
        return fail_at("origin-vanished");
    }
    // Post-Engine lifetime recheck: a same-process reuse across the in-memory
    // mutation still refuses before any membership change or hide.
    let post_tag = crate::product_hide::sys::read_member_tag(mover_hwnd);
    if !state
        .member_tags
        .get(&mover_key)
        .is_some_and(|tag| crate::workspace_owner::visible_lifetime_ok(tag, post_tag.as_deref()))
    {
        return fail_at("identity-changed");
    }
    if !state
        .workspaces
        .assign(mover_key.clone(), output, &target_id, true)
    {
        return fail_at("refused");
    }
    // Verified transfer before follow: absent source, present target.
    let source_now = state.workspaces.workspace_members(output, &loc.workspace);
    let target_now = state.workspaces.workspace_members(output, &target_id);
    if !crate::workspace_owner::verify_membership_transfer(&mover_key, &source_now, &target_now) {
        return fail_at("unverified");
    }
    // Consume the existing source plan while the survivors are still visible
    // and eligible in the same action. The writable set scopes to the source
    // domain (mover already transferred out, hidden/retained rows never
    // writable), so target entries skip honestly as retained and hidden
    // geometry is never written. All write fences stay inside
    // `apply_geometry` (identity/lifetime/scope, fullscreen veto, readback).
    // The internal tick reuses the parent action correlation.
    let source_writable = writable_tokens(state, output, &loc.workspace, observed);
    state.tick += 1;
    let source_tick = state.tick;
    let source_start = Instant::now();
    let source_summary = apply_geometry(
        state,
        ApplyInput {
            me,
            fulls,
            reply: &reply,
            observed,
            op: "send-source",
            tick: source_tick,
            correlation: ctx.correlation.as_str(),
            skipped: Vec::new(),
            writable: &source_writable,
            output_token: state.workspaces.output_token(output),
            workspace_token: state.workspaces.workspace_token(output, &loc.workspace),
            revision: revision_for(state, output, &loc.workspace),
        },
    );
    let source_ms = source_start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    let source = source_summary;
    // Hide the mover from the source view (commit-before-hide), then follow
    // by selecting the target (which reveals it). The select reuses the mover
    // as its focus hint and returns its fresh focus/observation: no redundant
    // post-follow enumeration here. A committed claim is owned even on
    // uncertain post-hide readback: flag it hidden and report the stall
    // without pretending follow success.
    let hide_outcome = workspace_hide_one(
        state,
        me,
        store,
        dir,
        &mover_key,
        &stored,
        fresh.facts.minimized,
    );
    if state.hidden_claims.contains_key(&mover_key) {
        state.workspaces.set_hidden(&mover_key, true);
    }
    if hide_outcome != "hidden" {
        return SendEffect {
            outcome: hide_outcome,
            focus: "none",
            source,
            target: None,
            transition_ms: 0,
            observation_ms: 0,
            source_geometry_ms: source_ms,
            target_geometry_ms: 0,
            hide_ms: 0,
            reveal_ms: 0,
            focus_ms: 0,
            source_plan_ms,
            target_plan_ms: 0,
            source_workspace: source_token.clone(),
            target_workspace: target_token.clone(),
        };
    }
    let select = workspace_do_select(
        state,
        me,
        store,
        dir,
        fulls,
        areas,
        observed,
        output,
        &target_id,
        ctx,
        Some(&mover_key),
    );
    if select.outcome != "ok" {
        return SendEffect {
            outcome: select.outcome,
            focus: select.focus,
            source,
            target: select.geometry,
            transition_ms: select.transition_ms,
            observation_ms: select.observation_ms,
            source_geometry_ms: source_ms,
            target_geometry_ms: select.geometry_ms,
            hide_ms: select.hide_ms,
            reveal_ms: select.reveal_ms,
            focus_ms: select.focus_ms,
            source_plan_ms,
            target_plan_ms: select.plan_ms,
            source_workspace: source_token.clone(),
            target_workspace: select.target_workspace.clone(),
        };
    }
    let outcome: &'static str = if select.focus == "focus-ok" {
        "ok"
    } else {
        "focus-unverified"
    };
    SendEffect {
        outcome,
        focus: select.focus,
        source,
        target: select.geometry,
        transition_ms: select.transition_ms,
        observation_ms: select.observation_ms,
        source_geometry_ms: source_ms,
        target_geometry_ms: select.geometry_ms,
        hide_ms: select.hide_ms,
        reveal_ms: select.reveal_ms,
        focus_ms: select.focus_ms,
        source_plan_ms,
        target_plan_ms: select.plan_ms,
        source_workspace: source_token.clone(),
        target_workspace: select.target_workspace.clone(),
    }
}

/// Exact-owner out-of-hook workspace select: one bounded `workspace.request`
/// file consumed once through the existing `workspace_do_select` resolver.
/// Normal `tile` only (proof owners refuse without effect); fullscreen and
/// elevated foreground gate like the hook path; the keyboard takeover switch
/// never gates this (out-of-hook dogfood/recovery). The request is deleted
/// before dispatch so there is no replay; a malformed or mismatched body is
/// consumed the same way with a `refused` outcome. Production log carries
/// op/index/edge/outcome only (no HWNDs, tokens, or identity bytes); the
/// client correlation is opaque and never logged.
fn poll_workspace_cli_request(
    state: &mut TileLoop,
    me: &ProcessIdentity,
    store: &LedgerStore,
    dir: &Path,
    fulls: &[Rect],
    areas: &[MonitorArea],
) {
    let path = dir.join(WORKSPACE_REQUEST_FILE);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
        Err(_) => return,
    };
    // Proof owners never serve the normal control: consume once with an
    // honest refusal and no native effect so the queue cannot wedge.
    if state.allowlist.is_some() {
        let _ = std::fs::remove_file(&path);
        state.tick += 1;
        let tick = state.tick;
        log_json_at(
            &state.log_path,
            workspace_log(state, tick, "select", 0, "cli", "refused-proof"),
        );
        return;
    }
    let parsed = parse_workspace_request(text.trim());
    // Consume-before-dispatch: exactly once, never replayed, never timed out
    // and retried. A bad body is still consumed with a refused outcome.
    let _ = std::fs::remove_file(&path);
    let request = match parsed {
        Ok(request) => request,
        Err(_) => {
            state.tick += 1;
            let tick = state.tick;
            log_json_at(
                &state.log_path,
                workspace_log(state, tick, "select", 0, "cli", "refused"),
            );
            return;
        }
    };
    if request.creation != me.process_creation
        || request.pid != me.pid
        || !exe_paths_equal(&request.exe_path, &me.exe_path)
        || request.user_sid != me.user_sid
        || request.session_id != me.session_id
    {
        state.tick += 1;
        let tick = state.tick;
        log_json_at(
            &state.log_path,
            workspace_log(state, tick, "select", request.index, "cli", "refused"),
        );
        return;
    }
    if foreground_fullscreen(fulls) {
        state.tick += 1;
        let tick = state.tick;
        log_json_at(
            &state.log_path,
            workspace_log(state, tick, "select", request.index, "cli", "suspended"),
        );
        return;
    }
    if foreground_elevated(me) {
        state.tick += 1;
        let tick = state.tick;
        log_json_at(
            &state.log_path,
            workspace_log(
                state,
                tick,
                "select",
                request.index,
                "cli",
                "elevated-foreground",
            ),
        );
        return;
    }
    let Some(output) = chord_output(state, areas) else {
        state.tick += 1;
        let tick = state.tick;
        log_json_at(
            &state.log_path,
            workspace_log(
                state,
                tick,
                "select",
                request.index,
                "cli",
                "unknown-output",
            ),
        );
        return;
    };
    state.workspaces.ensure_output(&output);
    state.tick += 1;
    let tick = state.tick;
    // Dispatch beginning for the CLI path: the clock starts before the
    // initial observation. No queued chord here, so the queue wait stays
    // zero by construction.
    let start = Instant::now();
    let mut skipped: Vec<(String, String)> = Vec::new();
    let mut retained: Vec<RetainedRow> = Vec::new();
    let Some(mut observed) = state.observe(me, fulls, &mut skipped, &mut retained) else {
        log_json_at(
            &state.log_path,
            workspace_log(
                state,
                tick,
                "select",
                request.index,
                "cli",
                "observation-failed",
            ),
        );
        return;
    };
    publish_managed(state, &observed);
    ensure_workspace_assignments(state, me, &mut observed, areas);
    workspace_close_cleanup(state);
    // Resolve without preactivating (same as the hook select path):
    // `resolve_send*` never touch ACTIVE; only the transition activates.
    let target = if request.index == 0 {
        state
            .workspaces
            .resolve_send_trailing(&output)
            .map(|(id, _)| id)
    } else {
        state.workspaces.resolve_send(&output, request.index)
    };
    let Some(target) = target else {
        let outcome = if request.index == 0 {
            "unknown-output"
        } else {
            "unknown-target"
        };
        log_json_at(
            &state.log_path,
            workspace_log(state, tick, "select", request.index, "cli", outcome),
        );
        return;
    };
    let ctx = ActionCtx {
        correlation: format!("act-{tick}"),
        tick,
        queued_at: start,
        start,
    };
    let effect = workspace_do_select(
        state,
        me,
        store,
        dir,
        fulls,
        areas,
        &mut observed,
        &output,
        &target,
        &ctx,
        None,
    );
    log_json_at(
        &state.log_path,
        workspace_log(state, tick, "select", request.index, "cli", effect.outcome),
    );
    log_workspace_action(
        state,
        &state.log_path.clone(),
        &ActionLine {
            ctx: &ctx,
            op: "select",
            index: request.index,
            edge: "cli",
            outcome: effect.outcome,
            focus: effect.focus,
            timings: &ActionTimings {
                transition_ms: effect.transition_ms,
                observation_ms: effect.observation_ms,
                source_plan_ms: 0,
                target_plan_ms: effect.plan_ms,
                source_geometry_ms: 0,
                target_geometry_ms: effect.geometry_ms,
                hide_ms: effect.hide_ms,
                reveal_ms: effect.reveal_ms,
                focus_ms: effect.focus_ms,
            },
            source_workspace: &effect.source_workspace,
            target_workspace: &effect.target_workspace,
            source: None,
            target: effect.geometry.as_ref(),
        },
    );
}

/// Drain one bounded batch of workspace digit intents. Select works on empty
/// workspaces and unmanaged foreground; send refuses unmanaged focus. The
/// `--no-keyboard-snap-takeover` off switch disables all product
/// interception (the hook is never installed; this is the defensive second
/// fence). Fullscreen and elevated foreground gate both ops.
#[allow(clippy::too_many_arguments)]
fn workspace_tick(
    state: &mut TileLoop,
    me: &ProcessIdentity,
    store: &LedgerStore,
    dir: &Path,
    fulls: &[Rect],
    areas: &[MonitorArea],
    events: Vec<crate::snapkey::QueuedWorkspaceIntent>,
    blocked: Option<&'static str>,
) {
    let log_path = state.log_path.clone();
    if let Some(cause) = blocked {
        let stale = events.len() as u32;
        if stale > 0 {
            log_json_at(
                &log_path,
                serde_json::json!({"event":"workspace-stale","cause": cause, "dropped": stale}),
            );
        }
        return;
    }
    if !state.keyboard.takeover {
        if !events.is_empty() {
            log_json_at(
                &log_path,
                serde_json::json!({"event":"workspace-stale","cause":"takeover-off","dropped": events.len()}),
            );
        }
        return;
    }
    for intent in events {
        if !intent.consumed || !intent.announce {
            if state.trace {
                log_json_at(
                    &log_path,
                    serde_json::json!({
                        "event": "workspace",
                        "tick": state.tick,
                        "op": intent.op.as_str(),
                        "index": intent.index,
                        "edge": intent.edge.as_str(),
                        "disposition": if intent.consumed { "consumed" } else { "passed" },
                        "outcome": "key-up",
                    }),
                );
            }
            continue;
        }
        // Dispatch beginning: the action clock starts here, before the
        // initial observation, so queue-to-effect latency includes the
        // observation itself. `queued_at` stays the cheap callback stamp.
        let dispatch_start = Instant::now();
        if foreground_fullscreen(fulls) {
            log_json_at(
                &log_path,
                serde_json::json!({
                    "event": "workspace",
                    "op": intent.op.as_str(),
                    "index": intent.index,
                    "edge": intent.edge.as_str(),
                    "disposition": "consumed",
                    "outcome": "suspended",
                }),
            );
            continue;
        }
        if foreground_elevated(me) {
            log_json_at(
                &log_path,
                serde_json::json!({
                    "event": "workspace",
                    "op": intent.op.as_str(),
                    "index": intent.index,
                    "edge": intent.edge.as_str(),
                    "disposition": "consumed",
                    "outcome": "elevated-foreground",
                }),
            );
            continue;
        }
        let Some(output) = chord_output(state, areas) else {
            log_json_at(
                &log_path,
                serde_json::json!({
                    "event": "workspace",
                    "op": intent.op.as_str(),
                    "index": intent.index,
                    "edge": intent.edge.as_str(),
                    "disposition": "consumed",
                    "outcome": "unknown-output",
                }),
            );
            continue;
        };
        state.workspaces.ensure_output(&output);
        state.tick += 1;
        let tick = state.tick;
        let mut skipped: Vec<(String, String)> = Vec::new();
        let mut retained: Vec<RetainedRow> = Vec::new();
        let Some(mut observed) = state.observe(me, fulls, &mut skipped, &mut retained) else {
            log_json_at(
                &log_path,
                serde_json::json!({
                    "event": "workspace",
                    "tick": tick,
                    "op": intent.op.as_str(),
                    "index": intent.index,
                    "edge": intent.edge.as_str(),
                    "disposition": "consumed",
                    "outcome": "observation-failed",
                }),
            );
            continue;
        };
        publish_managed(state, &observed);
        ensure_workspace_assignments(state, me, &mut observed, areas);
        workspace_close_cleanup(state);
        // Stable per-action context: one opaque correlation for the whole
        // select/send/follow lifecycle even when inner geometry ticks
        // increment. `queued_at` is the cheap callback stamp (no
        // logging/syscalls in the callback); `start` is the dispatch
        // beginning on the loop thread, captured before observation.
        let op = intent.op;
        let index = intent.index;
        let edge = intent.edge;
        let ctx = ActionCtx {
            correlation: format!("act-{tick}"),
            tick,
            queued_at: intent.tick,
            start: dispatch_start,
        };
        match op {
            WorkspaceOp::Select => {
                // Resolve without preactivating: `select`/`select_trailing`
                // mutate ACTIVE, which makes `workspace_do_select` see
                // `current == target` and return `already-active` with no
                // native effects. `resolve_send`/`resolve_send_trailing`
                // resolve (and append trailing when needed) without touching
                // ACTIVE; only the transition activates after hide/reveal.
                let target = if index == 0 {
                    state
                        .workspaces
                        .resolve_send_trailing(&output)
                        .map(|(id, _)| id)
                } else {
                    state.workspaces.resolve_send(&output, index)
                };
                match target {
                    Some(id) => {
                        let effect = workspace_do_select(
                            state,
                            me,
                            store,
                            dir,
                            fulls,
                            areas,
                            &mut observed,
                            &output,
                            &id,
                            &ctx,
                            None,
                        );
                        log_json_at(
                            &log_path,
                            workspace_log(
                                state,
                                tick,
                                op.as_str(),
                                index,
                                edge.as_str(),
                                effect.outcome,
                            ),
                        );
                        log_workspace_action(
                            state,
                            &log_path,
                            &ActionLine {
                                ctx: &ctx,
                                op: op.as_str(),
                                index,
                                edge: edge.as_str(),
                                outcome: effect.outcome,
                                focus: effect.focus,
                                timings: &ActionTimings {
                                    transition_ms: effect.transition_ms,
                                    observation_ms: effect.observation_ms,
                                    source_plan_ms: 0,
                                    target_plan_ms: effect.plan_ms,
                                    source_geometry_ms: 0,
                                    target_geometry_ms: effect.geometry_ms,
                                    hide_ms: effect.hide_ms,
                                    reveal_ms: effect.reveal_ms,
                                    focus_ms: effect.focus_ms,
                                },
                                source_workspace: &effect.source_workspace,
                                target_workspace: &effect.target_workspace,
                                source: None,
                                target: effect.geometry.as_ref(),
                            },
                        );
                    }
                    None => {
                        let outcome = if index == 0 {
                            "unknown-output"
                        } else {
                            "unknown-target"
                        };
                        log_json_at(
                            &log_path,
                            workspace_log(state, tick, op.as_str(), index, edge.as_str(), outcome),
                        );
                    }
                }
            }
            WorkspaceOp::Send => {
                let foreground_hwnd = unsafe { GetForegroundWindow() } as usize as u64;
                let origin = intent.origin.clone();
                match origin.filter(|o| o.hwnd == foreground_hwnd) {
                    Some(o) if !o.token.is_empty() => {
                        let effect = workspace_do_send(
                            state,
                            me,
                            store,
                            dir,
                            fulls,
                            areas,
                            &mut observed,
                            &retained,
                            &output,
                            index,
                            o.hwnd,
                            &o.token,
                            o.pid,
                            &o.creation,
                            &ctx,
                        );
                        log_json_at(
                            &log_path,
                            workspace_log(
                                state,
                                tick,
                                op.as_str(),
                                index,
                                edge.as_str(),
                                effect.outcome,
                            ),
                        );
                        log_workspace_action(
                            state,
                            &log_path,
                            &ActionLine {
                                ctx: &ctx,
                                op: op.as_str(),
                                index,
                                edge: edge.as_str(),
                                outcome: effect.outcome,
                                focus: effect.focus,
                                timings: &ActionTimings {
                                    transition_ms: effect.transition_ms,
                                    observation_ms: effect.observation_ms,
                                    source_plan_ms: effect.source_plan_ms,
                                    target_plan_ms: effect.target_plan_ms,
                                    source_geometry_ms: effect.source_geometry_ms,
                                    target_geometry_ms: effect.target_geometry_ms,
                                    hide_ms: effect.hide_ms,
                                    reveal_ms: effect.reveal_ms,
                                    focus_ms: effect.focus_ms,
                                },
                                source_workspace: &effect.source_workspace,
                                target_workspace: &effect.target_workspace,
                                source: effect.source.as_ref(),
                                target: effect.target.as_ref(),
                            },
                        );
                    }
                    _ => {
                        log_json_at(
                            &log_path,
                            workspace_log(
                                state,
                                tick,
                                op.as_str(),
                                index,
                                edge.as_str(),
                                "unmanaged",
                            ),
                        );
                    }
                }
            }
        }
    }
}

/// Bounded workspace log line: opaque output/workspace tokens plus
/// op/index/edge/outcome only. No HWNDs, tokens, titles, or app data.
fn workspace_log(
    state: &TileLoop,
    tick: u64,
    op: &str,
    index: u8,
    edge: &str,
    outcome: &str,
) -> serde_json::Value {
    let output = if state.active_output.is_empty() {
        "o?".to_owned()
    } else {
        state.workspaces.output_token(&state.active_output)
    };
    let workspace = state
        .workspaces
        .active_id(&state.active_output)
        .map(|id| state.workspaces.workspace_token(&state.active_output, &id))
        .unwrap_or_else(|| "ws?".to_owned());
    serde_json::json!({
        "event": "workspace",
        "tick": tick,
        "output": output,
        "workspace": workspace,
        "op": op,
        "index": index,
        "edge": edge,
        "outcome": outcome,
    })
}

/// Stable per-action context: one opaque correlation for the whole select /
/// send / follow lifecycle, even when inner reconcile ticks increment. Times
/// are monotonic `Instant`s: `queued_at` is the cheap callback stamp from the
/// existing hook event (no logging/syscalls in the callback), `start` is the
/// dispatch instant on the loop thread.
struct ActionCtx {
    correlation: String,
    tick: u64,
    queued_at: Instant,
    start: Instant,
}

/// Settled effect of one verified select transition: membership outcome
/// plus honest per-phase geometry and focus evidence. `geometry` is `None`
/// when no geometry pass ran (empty target, observation failure, early
/// refusal, non-plan Engine reply with readback not run); otherwise it
/// carries the verified verdict so `ok` never implies applied.
/// `transition_ms` covers dispatch to activation (hide+reveal+activate,
/// measured before the post-reveal observation); `observation_ms` covers the
/// post-reveal observation alone. `action_ms` on the log line is the terminal
/// dispatch-to-geometry-completion offset.
struct SelectEffect {
    outcome: &'static str,
    geometry: Option<ApplySummary>,
    focus: &'static str,
    transition_ms: u64,
    observation_ms: u64,
    geometry_ms: u64,
    hide_ms: u64,
    reveal_ms: u64,
    focus_ms: u64,
    plan_ms: u64,
    source_workspace: String,
    target_workspace: String,
}

/// Settled effect of one send+follow action: membership outcome plus honest
/// source (pre-hide reflow) and target (post-reveal) geometry evidence.
/// `source`/`target` are `None` when that pass never ran. Plan and geometry
/// durations stay split per domain, never collapsed. Tokens are captured
/// before cleanup so a removed source still logs its opaque identity.
struct SendEffect {
    outcome: &'static str,
    focus: &'static str,
    source: Option<ApplySummary>,
    target: Option<ApplySummary>,
    transition_ms: u64,
    observation_ms: u64,
    source_geometry_ms: u64,
    target_geometry_ms: u64,
    hide_ms: u64,
    reveal_ms: u64,
    focus_ms: u64,
    source_plan_ms: u64,
    target_plan_ms: u64,
    source_workspace: String,
    target_workspace: String,
}

/// Grouped phase timings for one bounded action line: dispatch offsets plus
/// per-phase durations. Source/target plan and geometry stay distinct.
struct ActionTimings {
    transition_ms: u64,
    observation_ms: u64,
    source_plan_ms: u64,
    target_plan_ms: u64,
    source_geometry_ms: u64,
    target_geometry_ms: u64,
    hide_ms: u64,
    reveal_ms: u64,
    focus_ms: u64,
}

/// One bounded action summary: opaque correlation plus monotonic
/// queue/action/transition/geometry durations and per-phase
/// applied/mismatched/readback states. A phase that never ran serializes as
/// null (outcome carries empty vs deferred vs failed), never zeros implying
/// applied; a vetoed pass carries its bounded `veto` reason.
struct ActionLine<'a> {
    ctx: &'a ActionCtx,
    op: &'a str,
    index: u8,
    edge: &'a str,
    outcome: &'a str,
    focus: &'a str,
    timings: &'a ActionTimings,
    source_workspace: &'a str,
    target_workspace: &'a str,
    source: Option<&'a ApplySummary>,
    target: Option<&'a ApplySummary>,
}

fn log_workspace_action(_state: &TileLoop, log_path: &Path, line: &ActionLine<'_>) {
    let queue_wait_ms = line
        .ctx
        .start
        .duration_since(line.ctx.queued_at)
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;
    let action_ms = line
        .ctx
        .start
        .elapsed()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;
    let phase = |summary: Option<&ApplySummary>| match summary {
        Some(s) => {
            let mut v = serde_json::json!({
                "applied": s.applied,
                "mismatched": s.mismatched,
                "readback_ok": s.readback_ok,
            });
            match s.veto {
                Some(diag) => {
                    v["veto"] = serde_json::json!({
                        "reason": diag.reason,
                        "desktop": diag.desktop,
                        "visible": diag.visible,
                        "captioned": diag.captioned,
                        "dwm_readable": diag.dwm_readable,
                    });
                }
                None => {
                    v["veto"] = serde_json::Value::Null;
                }
            }
            v
        }
        None => serde_json::Value::Null,
    };
    log_json_at(
        log_path,
        serde_json::json!({
            "event": "workspace-action",
            "tick": line.ctx.tick,
            "correlation": line.ctx.correlation,
            "op": line.op,
            "index": line.index,
            "edge": line.edge,
            "outcome": line.outcome,
            "focus": line.focus,
            "queue_wait_ms": queue_wait_ms,
            "action_ms": action_ms,
            "transition_ms": line.timings.transition_ms,
            "observation_ms": line.timings.observation_ms,
            "source_plan_ms": line.timings.source_plan_ms,
            "target_plan_ms": line.timings.target_plan_ms,
            "source_geometry_ms": line.timings.source_geometry_ms,
            "target_geometry_ms": line.timings.target_geometry_ms,
            "hide_ms": line.timings.hide_ms,
            "reveal_ms": line.timings.reveal_ms,
            "focus_ms": line.timings.focus_ms,
            "source_workspace": line.source_workspace,
            "target_workspace": line.target_workspace,
            "source": phase(line.source),
            "target": phase(line.target),
        }),
    );
}

/// True when the foreground window's process is not medium integrity:
/// elevated foreground gates workspace dispatch.
fn foreground_elevated(me: &ProcessIdentity) -> bool {
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.is_null() {
        return false;
    }
    let mut pid: u32 = 0;
    unsafe {
        GetWindowThreadProcessId(foreground, &mut pid);
    }
    if pid == 0 || pid == me.pid {
        return false;
    }
    let Ok(held) = HeldProcess::open(pid) else {
        return true;
    };
    match held.integrity() {
        Ok(rid) => !is_medium_rid(rid),
        Err(_) => true,
    }
}

/// Actual-foreground hidden member selects its workspace. Only a real
/// foreground change to an exactly verified hidden member switches; the
/// `Wake` event alone never does. Returns the settled select effect or `None`.
fn poll_foreground_workspace(
    state: &mut TileLoop,
    me: &ProcessIdentity,
    store: &LedgerStore,
    dir: &Path,
    fulls: &[Rect],
    areas: &[MonitorArea],
    observed: &mut [ObservedWindow],
) -> Option<SelectEffect> {
    let foreground = unsafe { GetForegroundWindow() } as usize as u64;
    if foreground == 0 || foreground == state.last_foreground {
        return None;
    }
    state.last_foreground = foreground;
    // Keyed by full member identity: find the HWND's key, then guard full
    // equality before any lookup so a recycled HWND never selects.
    let key = state
        .hidden_claims
        .keys()
        .find(|k| k.hwnd == foreground)
        .cloned()?;
    let record = state.hidden_claims.get(&key).cloned()?;
    // Exact verification: live PID, full process identity, exact nonce.
    let snap = crate::product_hide::sys::query_recovery(foreground, me).ok()?;
    if !crate::workspace_owner::member_matches(
        &key,
        foreground,
        snap.pid,
        &snap.process.process_creation,
    ) || snap.process != record.claim.process
        || snap.nonce.as_deref() != Some(record.claim.tag.as_str())
    {
        return None;
    }
    // Externally foregrounded: this is genuinely the member's workspace.
    let loc = state.workspaces.member_loc(&key).cloned()?;
    if !loc.hidden {
        return None;
    }
    let output = loc.output.clone();
    let workspace = loc.workspace.clone();
    // No queued chord here: the external foreground is the trigger, so the
    // queue wait is zero by construction.
    state.tick += 1;
    let tick = state.tick;
    let start = Instant::now();
    let ctx = ActionCtx {
        correlation: format!("act-{tick}"),
        tick,
        queued_at: start,
        start,
    };
    let effect = workspace_do_select(
        state, me, store, dir, fulls, areas, observed, &output, &workspace, &ctx, None,
    );
    log_workspace_action(
        state,
        &state.log_path.clone(),
        &ActionLine {
            ctx: &ctx,
            op: "select",
            index: 0,
            edge: "foreground",
            outcome: effect.outcome,
            focus: effect.focus,
            timings: &ActionTimings {
                transition_ms: effect.transition_ms,
                observation_ms: effect.observation_ms,
                source_plan_ms: 0,
                target_plan_ms: effect.plan_ms,
                source_geometry_ms: 0,
                target_geometry_ms: effect.geometry_ms,
                hide_ms: effect.hide_ms,
                reveal_ms: effect.reveal_ms,
                focus_ms: effect.focus_ms,
            },
            source_workspace: &effect.source_workspace,
            target_workspace: &effect.target_workspace,
            source: None,
            target: effect.geometry.as_ref(),
        },
    );
    Some(effect)
}

/// Externally revealed hidden claims without foreground return to hidden
/// under the same claim and identity: never re-admitted, never moved to the
/// wrong domain. Destroyed/recycled claims retire their ledger notes.
fn rehide_pass(state: &mut TileLoop, me: &ProcessIdentity, store: &LedgerStore) {
    let foreground = unsafe { GetForegroundWindow() } as usize as u64;
    let keys: Vec<crate::workspace::WindowKey> = state.hidden_claims.keys().cloned().collect();
    for key in keys {
        if key.hwnd == foreground {
            continue;
        }
        let Some(record) = state.hidden_claims.get(&key).cloned() else {
            continue;
        };
        let visible = unsafe { IsWindowVisible(key.hwnd as isize as HWND) } != 0;
        if !visible {
            continue;
        }
        // Same-claim guard: only the exact stored identity returns to hidden.
        let snap = match crate::product_hide::sys::query_recovery(key.hwnd, me) {
            Ok(s) => s,
            Err(_) => continue,
        };
        if !crate::workspace_owner::member_matches(
            &key,
            key.hwnd,
            snap.pid,
            &snap.process.process_creation,
        ) || snap.process != record.claim.process
            || snap.nonce.as_deref() != Some(record.claim.tag.as_str())
        {
            continue;
        }
        match crate::product_hide::sys::rehide_known_claim(me, &record.claim) {
            Ok(true) => {}
            Ok(false) => {
                // Retired: drop the ledger note through the identity-safe
                // reveal path and forget session membership safely.
                let _ = crate::product_hide::sys::reveal_product_claim_to(
                    store,
                    me,
                    &record.claim,
                    record.iconic,
                );
                state.hidden_claims.remove(&key);
            }
            Err(_) => {}
        }
    }
}
/// Sync monitor arrivals/removals with whole-workspace displacement/return:
/// displaced layouts are never merged, hidden windows never lost, and on
/// return the workspaces come back with then-current contents. Focus
/// preserves the surviving view unless the removed monitor held focus.
fn sync_monitor_outputs(state: &mut TileLoop, areas: &[MonitorArea]) {
    let current: Vec<String> = areas.iter().map(|a| a.device.clone()).collect();
    // Returning displaced origins are recreated by `reconnect_output` without
    // baseline empties below: never `ensure_output` them here, or a duplicate
    // trailing/minimum pair appears beside the returning workspaces.
    let displaced_origins: Vec<String> = state
        .workspaces
        .displaced_snapshot()
        .keys()
        .cloned()
        .collect();
    for key in &current {
        if displaced_origins.contains(key) {
            continue;
        }
        state.workspaces.ensure_output(key);
    }
    let gone: Vec<String> = state
        .known_outputs
        .iter()
        .filter(|k| !current.contains(k))
        .cloned()
        .collect();
    // Actual-foreground member view at disconnect time: when the removed
    // monitor held focus, the survivor shows that member's workspace instead
    // of an arbitrary one. Otherwise the surviving view keeps focus untouched.
    // The foreground key must also pass the visible lifetime gate, so a
    // same-process HWND reuse racing the disconnect never activates the wrong
    // workspace.
    let fg_workspace: Option<(String, String)> = {
        let fg = unsafe { GetForegroundWindow() } as usize as u64;
        let fg_tag = crate::product_hide::sys::read_member_tag(fg);
        state
            .member_tokens
            .iter()
            .find(|(k, _)| {
                k.hwnd == fg
                    && state.member_tags.get(*k).is_some_and(|stored| {
                        crate::workspace_owner::visible_lifetime_ok(stored, fg_tag.as_deref())
                    })
            })
            .and_then(|(k, _)| state.workspaces.member_loc(k).cloned())
            .map(|loc| (loc.output, loc.workspace))
    };
    let mut deferred: Vec<String> = Vec::new();
    for origin in gone {
        // Disconnect-time geometry decides the survivor: the origin's own
        // last-seen rectangle first, never post-disconnect frames as proxy;
        // then active output, then ordering. Never merge into a new split.
        let reference = state
            .last_areas
            .iter()
            .find(|a| a.device == origin)
            .or_else(|| state.last_areas.first())
            .map(|a| tiler_core::workspace::DisplacedRect {
                x: a.full.x,
                y: a.full.y,
                w: a.full.w,
                h: a.full.h,
            });
        let survivors: Vec<tiler_core::workspace::Survivor> = current
            .iter()
            .map(|k| {
                let rect = areas.iter().find(|a| &a.device == k).map(|a| {
                    tiler_core::workspace::DisplacedRect {
                        x: a.full.x,
                        y: a.full.y,
                        w: a.full.w,
                        h: a.full.h,
                    }
                });
                tiler_core::workspace::Survivor {
                    key: k.clone(),
                    rect,
                }
            })
            .collect();
        let active = if state.active_output.is_empty() {
            None
        } else {
            Some(state.active_output.as_str())
        };
        if let Some(dest) =
            tiler_core::workspace::choose_displaced_destination(&survivors, active, reference)
        {
            // Relocate retained Engine sessions first so layout trees,
            // contents, and focus move with the workspaces instead of
            // reseeding on the survivor. Empty or unusable sessions stay;
            // the outcome counts below stay opaque.
            let mut relocated = 0u32;
            let mut retained_count = 0u32;
            // Membership entries move below; Engine sessions follow per
            // workspace id through the existing relocation operation.
            let before: Vec<String> = state.workspaces.workspace_ids(&origin);
            for ws in &before {
                let target_key = tiler_core::session::DomainKey {
                    output: tiler_core::directional::OutputId(dest.clone()),
                    workspace: tiler_core::directional::WorkspaceId(ws.clone()),
                };
                let bounds = areas
                    .iter()
                    .find(|a| a.device == dest)
                    .and_then(|a| tiling_domain_bounds(a.work));
                let Some(bounds) = bounds else {
                    retained_count += 1;
                    continue;
                };
                let target_domain = tiler_core::session::OutputDomain {
                    id: tiler_core::directional::OutputId(dest.clone()),
                    workspace: tiler_core::directional::WorkspaceId(ws.clone()),
                    bounds,
                    gap: OUTER_GAP,
                    adjacent: std::collections::BTreeMap::new(),
                };
                if state
                    .engine
                    .try_relocate_for_target(&target_key, &target_domain, OUTER_GAP)
                {
                    relocated += 1;
                } else {
                    retained_count += 1;
                }
            }
            state.workspaces.displace_output_to(&origin, &dest);
            if state.active_output == origin {
                state.active_output = dest.clone();
            }
            // The removed monitor held focus: show that member's workspace on
            // the survivor with its actual focus preserved. Any other case
            // keeps the survivor view with no stealing.
            if let Some((fg_output, fg_workspace)) = fg_workspace.clone()
                && fg_output == origin
            {
                state.workspaces.activate(&dest, &fg_workspace);
                if let Some(fg_key) = state
                    .member_tokens
                    .keys()
                    .find(|k| {
                        state
                            .workspaces
                            .member_loc(k)
                            .is_some_and(|l| l.output == dest && l.workspace == fg_workspace)
                    })
                    .cloned()
                {
                    state.workspaces.note_foreground(&fg_key);
                }
            }
            log_json_at(
                &state.log_path,
                serde_json::json!({
                    "event": "workspace-displace",
                    "output": state.workspaces.output_token(&dest),
                    "relocated": relocated,
                    "retained": retained_count,
                }),
            );
        } else {
            // No survivor: defer with known origins kept, never drop the
            // workspaces or their Engine sessions.
            deferred.push(origin);
        }
    }
    // Reconnect returns displaced workspaces to the exact origin key with
    // then-current contents; Engine sessions relocate back first so the
    // returning monitor shows then-current trees, not saved snapshots.
    // The active view shows the returning workspace only when it holds the
    // focused window, otherwise the surviving view keeps focus with no
    // stealing (best-effort: preserve active output).
    let displaced: Vec<String> = state
        .workspaces
        .displaced_snapshot()
        .keys()
        .cloned()
        .collect();
    for origin in displaced {
        if current.contains(&origin) {
            if let Some(record) = state.workspaces.displaced_snapshot().get(&origin).cloned() {
                let bounds = areas
                    .iter()
                    .find(|a| a.device == origin)
                    .and_then(|a| tiling_domain_bounds(a.work));
                if let Some(bounds) = bounds {
                    for ws in &record.workspace_ids {
                        let target_key = tiler_core::session::DomainKey {
                            output: tiler_core::directional::OutputId(origin.clone()),
                            workspace: tiler_core::directional::WorkspaceId(ws.clone()),
                        };
                        let target_domain = tiler_core::session::OutputDomain {
                            id: tiler_core::directional::OutputId(origin.clone()),
                            workspace: tiler_core::directional::WorkspaceId(ws.clone()),
                            bounds,
                            gap: OUTER_GAP,
                            adjacent: std::collections::BTreeMap::new(),
                        };
                        state.engine.try_relocate_for_target(
                            &target_key,
                            &target_domain,
                            OUTER_GAP,
                        );
                    }
                }
            }
            state.workspaces.reconnect_output(&origin);
        }
    }
    // Deferred no-survivor origins stay known with their last geometry until
    // a survivor exists; their workspaces and Engine sessions are untouched.
    let mut known = current.clone();
    for origin in &deferred {
        if !known.contains(origin) {
            known.push(origin.clone());
        }
    }
    state.known_outputs = known;
    let mut last = areas.to_vec();
    for origin in &deferred {
        if !last.iter().any(|a| &a.device == origin)
            && let Some(area) = state
                .last_areas
                .iter()
                .find(|a| &a.device == origin)
                .cloned()
        {
            last.push(area);
        }
    }
    state.last_areas = last;
    if state.active_output.is_empty()
        && let Some(first) = state.known_outputs.first().cloned()
    {
        state.active_output = first;
    }
}

/// Per-tick workspace maintenance on quiet ticks: monitor sync, new-window
/// assignment, close cleanup, foreground-driven select, and same-claim
/// rehide of externally revealed hidden windows.
fn workspace_maintenance(
    state: &mut TileLoop,
    me: &ProcessIdentity,
    store: &LedgerStore,
    dir: &Path,
    fulls: &[Rect],
    areas: &[MonitorArea],
) {
    sync_monitor_outputs(state, areas);
    let mut skipped: Vec<(String, String)> = Vec::new();
    let mut retained: Vec<RetainedRow> = Vec::new();
    let Some(mut observed) = state.observe(me, fulls, &mut skipped, &mut retained) else {
        return;
    };
    publish_managed(state, &observed);
    ensure_workspace_assignments(state, me, &mut observed, areas);
    workspace_close_cleanup(state);
    // Periodic hidden-claim retirement before any foreground-driven switch so
    // dead claims never select.
    audit_hidden_claims(state, me, store);
    // Foreground-driven select only on an actual foreground change to an
    // exactly verified hidden member; event-only wakes never switch.
    if poll_foreground_workspace(state, me, store, dir, fulls, areas, &mut observed).is_some() {
        return;
    }
    rehide_pass(state, me, store);
}

fn gesture_tick(
    state: &mut TileLoop,
    me: &ProcessIdentity,
    fulls: &[Rect],
    areas: &[MonitorArea],
    ended: &[u64],
) {
    let log_path = state.log_path.clone();
    let mut skipped: Vec<(String, String)> = Vec::new();
    let mut retained: Vec<RetainedRow> = Vec::new();
    let Some(mut observed) = state.observe(me, fulls, &mut skipped, &mut retained) else {
        log_json_at(
            &log_path,
            serde_json::json!({"event":"tick-skip","tick":state.tick,"cause":"enum-failed"}),
        );
        return;
    };
    publish_managed(state, &observed);
    ensure_workspace_assignments(state, me, &mut observed, areas);
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
        // The gesture window's own (output, workspace) session owns this
        // settle: same per-workspace routing as directional chords.
        let member_key = state
            .member_tokens
            .iter()
            .find(|(_, token)| token.as_str() == current.token.as_str())
            .map(|(key, _)| key.clone());
        let Some(member_key) = member_key else {
            continue;
        };
        if !crate::workspace_owner::member_matches(
            &member_key,
            current.hwnd,
            current.identity.pid,
            &current.identity.process_creation,
        ) {
            continue;
        }
        let Some(loc) = state.workspaces.member_loc(&member_key).cloned() else {
            continue;
        };
        let Some((domain, domain_key)) = workspace_domain_for(&loc.output, &loc.workspace, areas)
        else {
            continue;
        };
        state.tick += 1;
        let correlation = state.correlation();
        // Incomplete snapshot defers with retained Engine state.
        let Some(rows) =
            assemble_domain_rows(state, &loc.output, &loc.workspace, &observed, &retained)
        else {
            continue;
        };
        let windows: Vec<(WindowId, Rect)> = rows
            .iter()
            .map(|r| (WindowId(r.token.clone()), r.rect))
            .collect();
        let fp = fingerprint(
            &rows
                .iter()
                .map(|r| (r.token.clone(), r.rect))
                .collect::<Vec<_>>(),
        );
        let mover = WindowId(current.token.clone());
        let event = crate::tiling::build_reconcile_event_for(
            &state.owner,
            &state.generation,
            &correlation,
            revision_for(state, &loc.output, &loc.workspace),
            fp,
            &domain,
            &domain_key,
            OUTER_GAP,
            &windows,
            Some(&mover),
        );
        // Single-domain observations run the local retained
        // propose/commit path; Core owns gesture semantics.
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
                let writable = writable_tokens(state, &loc.output, &loc.workspace, &observed);
                apply_geometry(
                    state,
                    ApplyInput {
                        me,
                        fulls: &fulls_owned,
                        reply: &reply,
                        observed: &observed,
                        op,
                        tick,
                        correlation: correlation.as_str(),
                        skipped: Vec::new(),
                        writable: &writable,
                        output_token: state.workspaces.output_token(&loc.output),
                        workspace_token: state
                            .workspaces
                            .workspace_token(&loc.output, &loc.workspace),
                        revision: revision_for(state, &loc.output, &loc.workspace),
                    },
                );
            }
            _ => {
                // Refusal converges through the next ordinary reconcile,
                // matching the KDE restore-marker outcome with no ledger.
                let fulls_owned = fulls.to_vec();
                reconcile_tick(state, me, &fulls_owned, areas);
            }
        }
    }
    state.gesture_before.clear();
}

/// Native foreground veto read: one fresh pass over the live foreground with
/// exact desktop identity, fresh visibility, caption, and DWM frame facts fed
/// into the portable [`crate::workspace_owner::classify_foreground`] policy.
/// No titles, paths, PIDs, or content leave this function; the caller logs
/// only the returned reason plus booleans. Pure reads, never IO.
struct ForegroundRead {
    veto: crate::workspace_owner::ForegroundVeto,
    desktop: bool,
    visible: bool,
    captioned: bool,
    dwm_readable: bool,
}

fn foreground_read(fulls: &[Rect]) -> ForegroundRead {
    use crate::workspace_owner::{ForegroundFacts, ForegroundVetoReason, classify_foreground};
    let settled = |veto: crate::workspace_owner::ForegroundVeto,
                   desktop: bool,
                   visible: bool,
                   captioned: bool,
                   dwm_readable: bool| {
        ForegroundRead {
            veto,
            desktop,
            visible,
            captioned,
            dwm_readable,
        }
    };
    let allow = |reason: ForegroundVetoReason,
                 desktop: bool,
                 visible: bool,
                 captioned: bool,
                 dwm_readable: bool| {
        settled(
            crate::workspace_owner::ForegroundVeto {
                block: false,
                reason,
            },
            desktop,
            visible,
            captioned,
            dwm_readable,
        )
    };
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.is_null() {
        // No foreground window: nothing covering.
        return allow(ForegroundVetoReason::None, false, false, false, false);
    }
    if unsafe { IsWindow(foreground) } == 0 {
        // `IsWindowVisible` returns false for invalid handles, so validity is
        // checked first and fails closed.
        return settled(
            crate::workspace_owner::ForegroundVeto {
                block: true,
                reason: ForegroundVetoReason::Invalid,
            },
            false,
            false,
            false,
            false,
        );
    }
    // Exact known desktop shell handles are the desktop, not a fullscreen
    // application. Narrow API identity only: no class-name, exe, tool/popup,
    // or unmanaged exceptions.
    let shell = unsafe { GetShellWindow() };
    let desktop_handle = unsafe { GetDesktopWindow() };
    let is_desktop = (!shell.is_null() && shell == foreground)
        || (!desktop_handle.is_null() && desktop_handle == foreground);
    // Fresh unambiguous visibility read on the valid handle: invisible
    // windows cannot be covering fullscreen.
    let visible = unsafe { IsWindowVisible(foreground) } != 0;
    let style = unsafe {
        SetLastError(0);
        GetWindowLongW(foreground, GWL_STYLE)
    } as u32;
    let style_err = unsafe { GetLastError() };
    let style_ok = style != 0 || style_err == 0;
    let captioned = style & WS_CAPTION != 0;
    let mut visible_raw: RECT = unsafe { std::mem::zeroed() };
    let dwm_ok = unsafe {
        DwmGetWindowAttribute(
            foreground,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&mut visible_raw as *mut RECT).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
    } == 0;
    if unsafe { IsWindow(foreground) } == 0 {
        return settled(
            crate::workspace_owner::ForegroundVeto {
                block: true,
                reason: ForegroundVetoReason::Invalid,
            },
            false,
            false,
            false,
            false,
        );
    }
    let readable = dwm_ok && style_ok;
    let covers_monitor = readable
        && rect_from_win(visible_raw)
            .is_some_and(|visible| is_borderless_fullscreen(true, visible, fulls));
    let veto = classify_foreground(ForegroundFacts {
        valid: true,
        is_desktop,
        visible,
        captioned,
        dwm_readable: readable,
        covers_monitor,
    });
    settled(veto, is_desktop, visible, captioned, readable)
}

fn foreground_veto(fulls: &[Rect]) -> crate::workspace_owner::ForegroundVeto {
    foreground_read(fulls).veto
}

fn foreground_fullscreen(fulls: &[Rect]) -> bool {
    foreground_veto(fulls).block
}

/// Owned inputs for one `run_tile_loop` invocation. Bundled so the loop
/// entry keeps a narrow signature as keyboard policy joins the run.
/// `mouse_snap` arms session-only `SPI_SETWINARRANGING FALSE` prevention for
/// product runs; proof runs always pass false (no settings changes).
struct TileRun {
    seconds: Option<u64>,
    trace: bool,
    allowlist: Option<Vec<AllowEntry>>,
    proof: bool,
    /// `shortcut-proof` only: proof geometry gate stays on, but the owner
    /// installs the hook with test-only marker acceptance and drives the same
    /// keyboard dispatcher plus session-only mouse routines. Product `tile`
    /// and `tile-proof` always pass false.
    shortcut_proof: bool,
    /// `workspace-proof` only: like `shortcut-proof` plus the workspace
    /// dispatcher (select/send/follow with hide/reveal) for exactly the
    /// frozen allowlist. Never enabled on the product path.
    workspace_proof: bool,
    raw_argv: Vec<String>,
    keyboard: KeyboardConfig,
    mouse_snap: bool,
    /// Explicit normal-mode scope filter (empty means no filter). Proof runs
    /// always pass empty (frozen allowlist is the gate there).
    scope: Vec<String>,
    /// Explicit host-to-child scope pairs (empty means no child constraint).
    /// Proof runs always pass empty.
    scope_hosts: Vec<ScopeHostChild>,
}

fn run_tile_loop(
    dir: &Path,
    me: &ProcessIdentity,
    store: &LedgerStore,
    run: TileRun,
) -> Result<()> {
    let TileRun {
        seconds,
        trace,
        allowlist,
        proof,
        shortcut_proof,
        workspace_proof,
        raw_argv,
        keyboard,
        mouse_snap,
        scope,
        scope_hosts,
    } = run;
    // Prevention needs an active loop: proof never arms it, and the guarded
    // setup already captured the preimage plus the initial effect.
    let snap_want = mouse_snap && (!proof || shortcut_proof || workspace_proof);
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
            "mode": if workspace_proof {
                "workspace-proof"
            } else if shortcut_proof {
                "shortcut-proof"
            } else {
                "proof"
            },
            "allowlist_digest": digest,
            "allowlist_count": count,
        });
        log_json_at(audit, line);
    }
    // Proof gate before first geometry: every frozen entry must verify as an
    // owned helper (sibling exe/class/tag plus full identity). Invisible
    // passive members verify here and stay frozen until `show`.
    if proof {
        let entries = allowlist
            .as_ref()
            .ok_or_else(|| err("refuse: allowlist missing"))?;
        if entries.is_empty() {
            return Err(err("refuse: empty allowlist"));
        }
        for (index, entry) in entries.iter().enumerate() {
            verify_proof_owned(entry.hwnd, entry, me).map_err(|reason| {
                err(format!(
                    "refuse: proof allowlist non-owned index={index} {reason}"
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
        scope,
        scope_hosts,
        trace,
        suspended: false,
        last_summary: None,
        log_path: log_path.clone(),
        audit_path: audit_path.clone(),
        keyboard,
        snap_dropped: 0,
        snap_origins: HashMap::new(),
        snap_advance: None,
        last_enumerated: 0,
        workspaces: ManagedWorkspaces::new(),
        member_tokens: std::collections::BTreeMap::new(),
        member_rects: HashMap::new(),
        hidden_claims: std::collections::BTreeMap::new(),
        member_identity: std::collections::BTreeMap::new(),
        member_tags: std::collections::BTreeMap::new(),
        active_output: String::new(),
        workspace_proof: false,
        last_foreground: 0,
        known_outputs: Vec::new(),
        last_hwnds: HashSet::new(),
        last_areas: Vec::new(),
    };
    state.engine.sync_binding(&owner, &generation);
    state.workspace_proof = workspace_proof;
    let mut areas = all_monitors()?;
    let (mut monitor, mut monitor_count) = (areas[0].clone(), areas.len());
    let mode = if workspace_proof {
        "workspace-proof"
    } else if shortcut_proof {
        "shortcut-proof"
    } else if state.allowlist.is_some() {
        "proof"
    } else {
        "normal"
    };
    // Visible takeover state: default on, explicit off, proof never hooks
    // except shortcut-proof/workspace-proof with test-only marker acceptance.
    let takeover = (state.keyboard.takeover && !proof) || shortcut_proof || workspace_proof;
    // Per-output-local workspaces start from live monitors: one domain set
    // per device key, retained Engine sessions per (output, workspace).
    sync_monitor_outputs(&mut state, &areas);
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
            "keyboard": {"takeover": takeover, "allow_win_l": state.keyboard.allow_win_l},
            "mouse_snap_prevention": snap_want,
            "scope_count": state.scope.len(),
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
    // Product keyboard takeover on the loop thread: the callback runs during
    // pump_wait on this same thread, so install/uninstall bracket the loop
    // with no join. Plain proof mode never installs a hook; shortcut-proof
    // installs with test-only marker acceptance. Install is best-effort with
    // bounded backoff retries below: failure degrades to keyboard-unavailable
    // (nothing consumes) while tiling continues, never a refused run.
    let mut snap_hook = None;
    let mut snap_failures: u32 = 0;
    let mut snap_retry_at: Option<Instant> = None;
    let deadline = seconds.map(|s| Instant::now() + Duration::from_secs(s));
    let mut slow_last = Instant::now();
    let result = (|| -> Result<()> {
        let fulls = monitor_fulls(&areas);
        // Mouse prevention is deferred until an actual active tick or resume:
        // an initial fullscreen must not disable only to immediately restore.
        // The first active tick, resume, or work-area change drives the
        // effect; teardown and crash restore keep the lease-held guarantee.
        let mut snap_primed = false;
        // Fullscreen guard applies before the initial tick as well.
        if foreground_fullscreen(&fulls) {
            state.suspended = true;
            state.snap_advance = None;
            log_json_at(
                &log_path,
                serde_json::json!({"event":"suspend","cause":"fullscreen-foreground"}),
            );
            if snap_want {
                snap_suspend(dir, me, store);
            }
        } else {
            if !areas.iter().any(|a| tiling_domain_bounds(a.work).is_some()) {
                return Err(err("error: work area cannot carry outer gap"));
            }
            if snap_want {
                snap_resume(dir, me, store);
                snap_primed = true;
            }
            reconcile_tick(&mut state, me, &fulls, &areas);
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
            // Best-effort keyboard hook with bounded backoff retries (5s
            // doubling, 60s cap): failure logs one `snap-unavailable` per
            // attempt, never per-poll noise, and the loop keeps tiling with
            // nothing consuming. Resume and work-area changes re-arm an
            // immediate retry; there is no permanent disable.
            if takeover && snap_hook.is_none() && snap_retry_at.is_none_or(|at| now >= at) {
                let installed = if shortcut_proof || workspace_proof {
                    crate::snapkey::sys::install_proof(keyboard)
                } else {
                    crate::snapkey::sys::install(keyboard)
                };
                match installed {
                    Ok(hook) => {
                        snap_hook = Some(hook);
                        snap_failures = 0;
                        snap_retry_at = None;
                        log_json_at(&log_path, serde_json::json!({"event":"snap-available"}));
                    }
                    Err(message) => {
                        snap_failures += 1;
                        let backoff = (5u64 << snap_failures.min(4)).min(60);
                        snap_retry_at = Some(now + Duration::from_secs(backoff));
                        log_json_at(
                            &log_path,
                            serde_json::json!({
                                "event": "snap-unavailable",
                                "attempt": snap_failures,
                                "retry_secs": backoff,
                                "cause": message,
                            }),
                        );
                    }
                }
            }
            // Cached keyboard gate for the callback (exactness stays with the
            // per-intent owner recheck), then one bounded intent batch. A
            // pending batch wakes the loop even with no other event. The gate
            // folds the current fullscreen and elevated reads in here so the
            // hook never swallows a chord during cached suspension; the owner
            // dispatch rechecks both fresh per intent anyway. Hook-side work
            // stays cheap reads, never expensive syscalls per key.
            let gate_fulls = monitor_fulls(&areas);
            let snap_gate_active = state.keyboard.takeover
                && !state.suspended
                && !state.active.iter().any(|hwnd| state.managed.contains(hwnd))
                && !foreground_fullscreen(&gate_fulls)
                && !foreground_elevated(me);
            let snap_events = if snap_hook.is_some() {
                crate::snapkey::sys::publish_gate(&state.snap_origins, snap_gate_active);
                let batch = crate::snapkey::sys::drain_up_to(MAX_DISPATCH_PER_TICK);
                if !batch.is_empty() {
                    woke = true;
                }
                batch
            } else {
                Vec::new()
            };
            // Workspace digits ride the same hook/queue/mask authority but
            // dispatch through the workspace owner, never the directional
            // Engine route. Partition here so each batch keeps its verdict
            // vocabulary; `shortcut-proof` keeps workspace hides disabled
            // inside `workspace_tick` via the proof gate.
            let mut workspace_events = Vec::new();
            let mut directional_events = Vec::new();
            for event in snap_events {
                match event {
                    QueuedSnapEvent::Workspace(intent) => workspace_events.push(intent),
                    QueuedSnapEvent::Mask(_) | QueuedSnapEvent::Intent(_) => {
                        directional_events.push(event);
                    }
                }
            }
            if !workspace_events.is_empty() {
                woke = true;
            }
            let snap_events = directional_events;
            // Proof-only callback diagnostics for shortcut-proof: accepted
            // marked events as the callback saw them, drained to the proof
            // audit (never production logs) so live runs can distinguish
            // actual modifier delivery from classifier state. Product `tile`
            // never records or writes these.
            if (shortcut_proof || workspace_proof) && snap_hook.is_some() {
                let diag = crate::snapkey::sys::drain_marked_diag();
                if !diag.is_empty()
                    && let Some(audit) = state.audit_path.as_ref()
                {
                    let entries: Vec<serde_json::Value> = diag
                        .iter()
                        .map(crate::snapkey::marked_diag_evidence)
                        .collect();
                    log_json_at(
                        audit,
                        serde_json::json!({
                            "event": "proof-keys",
                            "entries": entries,
                            "dropped": crate::snapkey::sys::marked_diag_dropped(),
                        }),
                    );
                }
                // Proof-only complement: non-marked modifier traffic
                // (injected-filtered plus physical, modifiers only) drained
                // to the proof audit under its own event, so the actual
                // callback modifier sequence is complete. Product `tile`
                // never records or writes these.
                let mods = crate::snapkey::sys::drain_mod_diag();
                if !mods.is_empty()
                    && let Some(audit) = state.audit_path.as_ref()
                {
                    let entries: Vec<serde_json::Value> =
                        mods.iter().map(crate::snapkey::mod_diag_evidence).collect();
                    log_json_at(
                        audit,
                        serde_json::json!({
                            "event": "proof-mods",
                            "entries": entries,
                            "dropped": crate::snapkey::sys::mod_diag_dropped(),
                        }),
                    );
                }
            }
            if slow {
                slow_last = now;
                let fresh = all_monitors()?;
                let devices: Vec<String> = areas.iter().map(|a| a.device.clone()).collect();
                let fresh_devices: Vec<String> = fresh.iter().map(|a| a.device.clone()).collect();
                let geometry_changed = fresh.len() != monitor_count
                    || fresh_devices != devices
                    || fresh.iter().any(|a| {
                        areas
                            .iter()
                            .find(|b| b.device == a.device)
                            .is_none_or(|b| b.work != a.work || b.full != a.full)
                    });
                if geometry_changed {
                    areas = fresh;
                    monitor = areas[0].clone();
                    monitor_count = areas.len();
                    // Arrival/removal relocates whole-workspace Engine
                    // sessions; bounds-only changes reproject retained
                    // sessions without touching topology.
                    sync_monitor_outputs(&mut state, &areas);
                    for output in state.workspaces.output_keys() {
                        let Some(active) = state.workspaces.active_id(&output) else {
                            continue;
                        };
                        if let Some((_, key)) = workspace_domain_for(&output, &active, &areas)
                            && let Some(area) = areas.iter().find(|a| a.device == output)
                            && let Some(bounds) = tiling_domain_bounds(area.work)
                        {
                            state.engine.reproject_retained(&key, bounds);
                        }
                    }
                    log_json_at(&log_path, serde_json::json!({"event":"work-area-changed"}));
                    snap_retry_at = None;
                    // A changed work area is a meaningful retry point for a
                    // degraded Snap setup; quiet when the effect holds.
                    if snap_want && !state.suspended {
                        snap_resume(dir, me, store);
                        snap_primed = true;
                    }
                    woke = true;
                }
            }
            // Exact-owner out-of-hook select wakes the loop even with no other
            // event; the poll itself consumes once and dispatches through the
            // existing resolver. Checked before the idle skip so a pending
            // request never waits for an unrelated wake.
            if dir.join(WORKSPACE_REQUEST_FILE).exists() {
                woke = true;
            }
            if !(woke || slow) {
                continue;
            }
            let fulls = monitor_fulls(&areas);
            if foreground_fullscreen(&fulls) {
                if !state.suspended {
                    state.suspended = true;
                    state.snap_advance = None;
                    log_json_at(
                        &log_path,
                        serde_json::json!({"event":"suspend","cause":"fullscreen-foreground"}),
                    );
                    if snap_want {
                        snap_suspend(dir, me, store);
                    }
                } else {
                    state.snap_advance = None;
                }
                if !snap_events.is_empty() {
                    keyboard_tick(
                        &mut state,
                        me,
                        &fulls,
                        &areas,
                        snap_events,
                        Some("suspended"),
                    );
                }
                if !workspace_events.is_empty() {
                    workspace_tick(
                        &mut state,
                        me,
                        store,
                        dir,
                        &fulls,
                        &areas,
                        workspace_events,
                        Some("suspended"),
                    );
                }
                // Out-of-hook select observes the same suspension: consumed
                // once with a suspended outcome, never applied while a
                // fullscreen foreground holds the session.
                poll_workspace_cli_request(&mut state, me, store, dir, &fulls, &areas);
                state.gesture_before.clear();
                state.active.clear();
                continue;
            }
            if state.suspended {
                state.suspended = false;
                log_json_at(&log_path, serde_json::json!({"event":"resume"}));
                // A fresh foreground may accept the hook now: retry soon.
                snap_retry_at = None;
                // Fresh Snap preimage when the setting drifted during
                // suspension (or setup degraded earlier); quiet when the
                // effect is still ours. This is also the deferred initial
                // effect when the run started suspended.
                if snap_want {
                    snap_resume(dir, me, store);
                    snap_primed = true;
                }
            } else if snap_want && !snap_primed {
                // Deferred initial effect: the run started active but setup
                // no longer disables. Drive once on the first active tick.
                snap_resume(dir, me, store);
                snap_primed = true;
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
                // A managed gesture holds the loop and invalidates any
                // own-focus chain; keyboard intents of this batch are stale
                // and drop safely.
                state.snap_advance = None;
                if !snap_events.is_empty() {
                    keyboard_tick(&mut state, me, &fulls, &areas, snap_events, Some("gesture"));
                }
                if !workspace_events.is_empty() {
                    workspace_tick(
                        &mut state,
                        me,
                        store,
                        dir,
                        &fulls,
                        &areas,
                        workspace_events,
                        Some("gesture"),
                    );
                }
                continue;
            }
            if ended.is_empty() {
                if snap_events.is_empty() && workspace_events.is_empty() {
                    reconcile_tick(&mut state, me, &fulls, &areas);
                    workspace_maintenance(&mut state, me, store, dir, &fulls, &areas);
                    poll_workspace_cli_request(&mut state, me, store, dir, &fulls, &areas);
                } else {
                    if !snap_events.is_empty() {
                        keyboard_tick(&mut state, me, &fulls, &areas, snap_events, None);
                    }
                    if !workspace_events.is_empty() {
                        workspace_tick(
                            &mut state,
                            me,
                            store,
                            dir,
                            &fulls,
                            &areas,
                            workspace_events,
                            None,
                        );
                    }
                    poll_workspace_cli_request(&mut state, me, store, dir, &fulls, &areas);
                }
            } else {
                // A just-ended managed gesture settles before keyboard
                // continuation resumes.
                state.snap_advance = None;
                if !snap_events.is_empty() {
                    keyboard_tick(&mut state, me, &fulls, &areas, snap_events, Some("gesture"));
                }
                if !workspace_events.is_empty() {
                    workspace_tick(
                        &mut state,
                        me,
                        store,
                        dir,
                        &fulls,
                        &areas,
                        workspace_events,
                        Some("gesture"),
                    );
                }
                gesture_tick(&mut state, me, &fulls, &areas, &ended);
                poll_workspace_cli_request(&mut state, me, store, dir, &fulls, &areas);
            }
        }
    })();
    for hook in hooks {
        unsafe {
            UnhookWinEvent(hook);
        }
    }
    if let Some(mut snap) = snap_hook {
        // Honest release accounting: process exit releases the hook in any
        // case, but success is recorded, never fabricated.
        let ok = crate::snapkey::sys::uninstall(&mut snap);
        let mut release = serde_json::json!({"event":"snap-release","ok": ok});
        if !ok {
            release["note"] = serde_json::json!("release failed; process exit releases the hook");
        }
        log_json_at(&log_path, release);
    }
    log_json_at(
        &log_path,
        serde_json::json!({"event":"tile-end","ticks":state.tick}),
    );
    result
}

/// `tile` command: normal user tiling only (explicit `--user-start`).
/// Geometry is left in place on stop; nothing is hidden or restored.
/// Terminal windows are ordinary targets; agents never run this path.
/// Optional repeatable `--scope-exe NAME` restricts management to the named
/// executables (empty default means no filter). Product keyboard takeover
/// follows the parsed options (default on, visible off switch, Win+L
/// opt-in). Session-only mouse-Snap prevention is default on with the
/// visible `--no-mouse-snap-prevention` off switch; the exact preimage is
/// restored conditionally on stop.
pub fn cmd_tile(options: &TileOptions) -> Result<String> {
    if !options.user_start {
        return Err(err("refuse: tile requires explicit --user-start"));
    }
    let trace = options.trace;
    let seconds = options.seconds;
    let keyboard = KeyboardConfig {
        takeover: !options.no_keyboard_snap_takeover,
        allow_win_l: options.allow_win_l,
    };
    let mouse_snap = !options.no_mouse_snap_prevention;
    let scope = options.scope_exes.clone();
    let scope_hosts = options.scope_hosts.clone();
    crate::lifecycle::sys::run_product(trace, mouse_snap, move |dir, me, store| {
        run_tile_loop(
            dir,
            me,
            store,
            TileRun {
                seconds,
                trace,
                allowlist: None,
                proof: false,
                shortcut_proof: false,
                workspace_proof: false,
                raw_argv: Vec::new(),
                keyboard,
                mouse_snap,
                scope,
                scope_hosts,
            },
        )
    })
}

/// `workspace --select INDEX` command: exact-owner out-of-hook select for the
/// normal `tile` loop only. Queues one bounded `workspace.request` file; the
/// owner validates the full owner binding (creation/pid/exe/sid/session plus
/// a client correlation) and dispatches once through the existing
/// `workspace_do_select` resolver. No window actuation here, no synthetic
/// input, no keyboard acceptance. Refuses when no normal owner runs, when the
/// caller is not the same medium path (SID/session/exe), when the ledger
/// owner is a proof run, and when a request is already pending
/// (single-pending queue, no overwrite, no replay). Stdout reports
/// `dispatched` (queued) honestly; completion is the owner's `workspace`
/// log outcome, observed natively by the caller.
pub fn cmd_workspace_select(options: &WorkspaceSelectOptions) -> Result<String> {
    use crate::tiling::{WORKSPACE_REQUEST_VERSION, WorkspaceRequest, render_workspace_request};
    ensure_pm_v2()?;
    let me = medium_caller()?;
    // Like `cmd_stop`, the CLI itself may run from any shell; only the
    // ledger owner liveness plus the same-path medium binding gate below.
    let dir =
        crate::native::ledger_directory().map_err(|e| err(format!("error: ledger dir: {e}")))?;
    let ledger_text =
        std::fs::read_to_string(dir.join(crate::storage::LEDGER_FILE_NAME)).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                err("refuse: no owner running")
            } else {
                err(format!("error: ledger read: {e}"))
            }
        })?;
    let record: crate::model::RecoveryLedger =
        crate::model::parse_ledger(&ledger_text).map_err(|_| err("refuse: corrupt ledger"))?;
    // Same-path medium caller check, mirroring `cmd_stop`: SID, session, exe.
    if me.user_sid != record.owner.user_sid || me.session_id != record.owner.session_id {
        return Err(err("refuse: owner mismatch"));
    }
    let exe = crate::native::current_exe_path().map_err(|e| err(format!("error: exe {e}")))?;
    if !exe_paths_equal(&exe, &record.owner.exe_path) {
        return Err(err("refuse: owner mismatch"));
    }
    // Proof owners never serve the normal control: a proof audit marker for
    // this exact owner creation proves proof mode (normal runs write none).
    let audit = dir.join(format!(
        "proof-audit-{}.jsonl",
        record.owner.process_creation
    ));
    if audit.exists() {
        return Err(err("refuse: proof owner"));
    }
    // The ledger owner must be exactly alive (full identity, no PID reuse).
    let held = HeldProcess::open(record.owner.pid).map_err(|e| match e {
        crate::native::IdentityError::Absent => err("refuse: owner not running"),
        other => err(format!("error: owner {other}")),
    })?;
    let live = held.identity().map_err(|e| match e {
        crate::native::IdentityError::Absent => err("refuse: owner not running"),
        other => err(format!("error: owner {other}")),
    })?;
    if live != record.owner || !held.is_alive() {
        return Err(err("refuse: owner not running"));
    }
    let rid = held
        .integrity()
        .map_err(|e| err(format!("error: target integrity {e}")))?;
    if !is_medium_rid(rid) {
        return Err(err(format!("refuse: target integrity {rid} is not medium")));
    }
    if options.index > 9 {
        return Err(err("refuse: select index must be 0..=9"));
    }
    let path = dir.join(WORKSPACE_REQUEST_FILE);
    if path.exists() {
        return Err(err("refuse: workspace request pending"));
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(1);
    let correlation = format!("cli-{}-{:x}", me.pid, nanos);
    if tiler_core::ids::CorrelationId::parse(&correlation).is_none() {
        return Err(err("error: correlation render"));
    }
    let request = WorkspaceRequest {
        v: WORKSPACE_REQUEST_VERSION,
        creation: record.owner.process_creation.clone(),
        pid: record.owner.pid,
        exe_path: record.owner.exe_path.clone(),
        user_sid: record.owner.user_sid.clone(),
        session_id: record.owner.session_id,
        index: options.index,
        correlation: correlation.clone(),
    };
    let body = render_workspace_request(&request);
    if body.is_empty() {
        return Err(err("error: request render"));
    }
    // Bounded single-pending queue: the body is written and synced to a
    // same-directory unique temp first and only then published atomically
    // with no-overwrite semantics, so the owner never observes a partial
    // body. A publish race against an already-queued request refuses.
    match crate::storage::publish_no_overwrite(
        &dir,
        WORKSPACE_REQUEST_FILE,
        body.as_bytes(),
        &correlation,
    ) {
        Ok(()) => {}
        Err(crate::storage::PublishError::Pending) => {
            return Err(err("refuse: workspace request pending"));
        }
        Err(crate::storage::PublishError::Io(e)) => {
            return Err(err(format!("error: request write: {e}")));
        }
    }
    Ok(serde_json::json!({"dispatched": true, "index": options.index}).to_string())
}

/// `tile-proof` command: owned-helpers-only proof loop. Requires a nonempty
/// valid `--allowlist` at parse and at native start; malformed, empty,
/// duplicate, untagged, or non-owned entries refuse before any lease or write
/// and never fall back to normal mode. The raw received argv travels with the
/// parsed options into the proof-only audit (never production logs) with a
/// parsed/raw consistency check, so flag delivery is evidenced. Every setter
/// carries a proof audit record (requested/native target plus flags/outcome);
/// production logs stay token-only. Proof installs no keyboard hook; automated
/// synthetic-input verification uses the separate `shortcut-proof` command.
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
    let keyboard = KeyboardConfig::disabled();
    // Proof installs no keyboard hook and takes no Snap setting: the proof
    // contract is unchanged unless a future explicit opt-in lands.
    crate::lifecycle::sys::run_product(trace, false, move |dir, me, store| {
        run_tile_loop(
            dir,
            me,
            store,
            TileRun {
                seconds,
                trace,
                allowlist: Some(entries),
                proof: true,
                shortcut_proof: false,
                workspace_proof: false,
                raw_argv,
                keyboard,
                mouse_snap: false,
                scope: Vec::new(),
                scope_hosts: Vec::new(),
            },
        )
    })
}

/// `shortcut-proof` command: owned-helpers-only automated shortcut proof.
/// Same frozen-allowlist geometry gate as `tile-proof` (never falls back to
/// normal), but the owner installs the hook with test-only acceptance of
/// exactly [`crate::snapkey::SHORTCUT_PROOF_MARKER`] in `dwExtraInfo` and
/// drives the same keyboard dispatcher (fresh observation per intent, Engine
/// focus/move, native readback) plus the same session-only mouse routines.
/// Unshifted Win+L stays gated off (no flag offers it): live runs must never
/// send Win+L. Raw argv travels into the proof-only audit with a consistency
/// check; production logs stay token-only.
pub fn cmd_shortcut_proof(
    options: &crate::tiling::ShortcutProofOptions,
    raw_argv: &[String],
) -> Result<String> {
    let text = std::fs::read_to_string(&options.allowlist)
        .map_err(|e| err(format!("error: allowlist read: {e}")))?;
    let entries = parse_allowlist(&text).map_err(err)?;
    if entries.is_empty() {
        return Err(err("refuse: empty allowlist"));
    }
    crate::tiling::verify_shortcut_proof_argv_consistency(raw_argv, options).map_err(err)?;
    let trace = options.trace;
    let seconds = options.seconds;
    let mouse_snap = !options.no_mouse_snap_prevention;
    let raw_argv = raw_argv.to_vec();
    let keyboard = KeyboardConfig {
        takeover: true,
        allow_win_l: false,
    };
    crate::lifecycle::sys::run_product(trace, mouse_snap, move |dir, me, store| {
        run_tile_loop(
            dir,
            me,
            store,
            TileRun {
                seconds,
                trace,
                allowlist: Some(entries),
                proof: true,
                shortcut_proof: true,
                workspace_proof: false,
                raw_argv,
                keyboard,
                mouse_snap,
                scope: Vec::new(),
                scope_hosts: Vec::new(),
            },
        )
    })
}

/// `workspace-proof` command: owned-helpers-only automated workspace proof.
/// Same frozen-allowlist geometry gate as `shortcut-proof` plus the workspace
/// dispatcher (select/send/follow with hide/reveal) for exactly the
/// allowlisted helpers. The hook accepts exactly
/// [`crate::snapkey::SHORTCUT_PROOF_MARKER`]; every workspace hide verifies
/// `verify_proof_owned` fresh before the write. `shortcut-proof` never hides
/// for workspace intents and `tile-proof` installs no hook.
pub fn cmd_workspace_proof(
    options: &crate::tiling::WorkspaceProofOptions,
    raw_argv: &[String],
) -> Result<String> {
    let text = std::fs::read_to_string(&options.allowlist)
        .map_err(|e| err(format!("error: allowlist read: {e}")))?;
    let entries = parse_allowlist(&text).map_err(err)?;
    if entries.is_empty() {
        return Err(err("refuse: empty allowlist"));
    }
    crate::tiling::verify_workspace_proof_argv_consistency(raw_argv, options).map_err(err)?;
    let trace = options.trace;
    let seconds = options.seconds;
    let mouse_snap = !options.no_mouse_snap_prevention;
    let raw_argv = raw_argv.to_vec();
    let keyboard = KeyboardConfig {
        takeover: true,
        allow_win_l: false,
    };
    crate::lifecycle::sys::run_product(trace, mouse_snap, move |dir, me, store| {
        run_tile_loop(
            dir,
            me,
            store,
            TileRun {
                seconds,
                trace,
                allowlist: Some(entries),
                proof: true,
                shortcut_proof: false,
                workspace_proof: true,
                raw_argv,
                keyboard,
                mouse_snap,
                scope: Vec::new(),
                scope_hosts: Vec::new(),
            },
        )
    })
}

/// `hide-proof` command: owned-helpers-only visibility proof over the product
/// nonce mechanism. Requires a nonempty valid `--allowlist`; every frozen
/// entry is verified as an owned helper (sibling exe/class/lifetime-tag via
/// [`verify_proof_owned`]) BEFORE the ordinary product nonce APIs run, so
/// helper-only gates are never weakened. Each verified helper is admitted with a fresh product nonce and hidden with a
/// write-before-hide ledger commit (schema v4) under the central product
/// watcher; graceful stop auto-reveals via the guarded teardown, and
/// emergency loss auto-reveals via the watcher with idempotent independent
/// restore. Installs no hook, takes no Snap setting, moves no geometry.
pub fn cmd_hide_proof(options: &HideProofOptions, raw_argv: &[String]) -> Result<String> {
    let text = std::fs::read_to_string(&options.allowlist)
        .map_err(|e| err(format!("error: allowlist read: {e}")))?;
    let entries = parse_allowlist(&text).map_err(err)?;
    if entries.is_empty() {
        return Err(err("refuse: empty allowlist"));
    }
    crate::tiling::verify_hide_proof_argv_consistency(raw_argv, options).map_err(err)?;
    let trace = options.trace;
    let seconds = options.seconds;
    let raw_argv = raw_argv.to_vec();
    // No Snap prevention, no hook, no geometry: visibility proof only.
    crate::lifecycle::sys::run_product(trace, false, move |dir, me, store| {
        run_hide_proof_loop(dir, me, store, entries, seconds, trace, raw_argv)
    })
}

fn run_hide_proof_loop(
    dir: &Path,
    me: &ProcessIdentity,
    store: &LedgerStore,
    entries: Vec<AllowEntry>,
    seconds: Option<u64>,
    trace: bool,
    raw_argv: Vec<String>,
) -> Result<()> {
    ensure_pm_v2()?;
    let log_path = log_path_for(dir, &me.process_creation);
    let audit_path = dir.join(format!("proof-audit-{}.jsonl", me.process_creation));
    if audit_path.exists() {
        return Err(err("refuse: audit preexists, will not overwrite"));
    }
    let digest = allowlist_digest(&entries);
    let count = entries.len();
    log_json_at(
        &audit_path,
        serde_json::json!({
            "event": "proof-start",
            "argv": raw_argv,
            "seconds": seconds,
            "trace": trace,
            "mode": "hide-proof",
            "allowlist_digest": digest,
            "allowlist_count": count,
        }),
    );
    // Frozen-helper gate BEFORE any product nonce API: every entry must verify
    // as an owned helper, never an ordinary window. Opaque index only in
    // product errors; raw identity stays in the proof audit below.
    for (index, entry) in entries.iter().enumerate() {
        verify_proof_owned(entry.hwnd, entry, me).map_err(|reason| {
            err(format!(
                "refuse: hide-proof allowlist non-owned index={index} {reason}"
            ))
        })?;
    }
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
        &audit_path,
        serde_json::json!({"event": "proof-frozen", "windows": frozen}),
    );
    let areas = all_monitors()?;
    let monitor = areas[0].clone();
    log_json_at(
        &log_path,
        serde_json::json!({
            "event": "hide-proof-start",
            "mode": "hide-proof",
            "trace": trace,
            "monitors": areas.len(),
            "work": [monitor.work.x, monitor.work.y, monitor.work.w, monitor.work.h],
            "full": [monitor.full.x, monitor.full.y, monitor.full.w, monitor.full.h],
            "allowlist_digest": digest,
            "allowlist_count": count,
        }),
    );
    // Admit + hide each verified helper via the ordinary product APIs.
    // Write-before-hide holds per window: the ledger commit precedes the
    // hide. Opaque index only in product errors; raw identity stays in the
    // proof audit below.
    let mut hidden = 0usize;
    let mut admitted: Vec<crate::model::WindowIdentity> = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let claim = crate::product_hide::sys::admit_product_target(entry.hwnd, me)
            .map_err(|e| err(format!("error: hide-proof admit index={index} {e}")))?;
        crate::product_hide::sys::hide_committed_product(store, me, &claim, dir)
            .map_err(|e| err(format!("error: hide-proof hide index={index} {e}")))?;
        admitted.push(claim);
        hidden += 1;
        log_json_at(
            &log_path,
            serde_json::json!({"event": "hide-proof-hide", "index": hidden, "count": count}),
        );
        log_json_at(
            &audit_path,
            serde_json::json!({
                "event": "hide-proof-hide",
                "hwnd": entry.hwnd,
                "pid": entry.pid,
                "process_creation": entry.process_creation,
                "tag": entry.tag,
            }),
        );
    }
    // Ledger receipt check: current version with exactly the admitted product
    // claims, verified field-by-field (kind, HWND, full process, tag), not by
    // count alone, so a substituted claim cannot pass the receipt.
    match store.committed() {
        Ok(Some(record)) => {
            let exact = record.v == crate::model::LEDGER_SCHEMA_VERSION
                && record.windows.len() == admitted.len()
                && admitted.iter().all(|claim| {
                    record.windows.iter().any(|w| {
                        w.kind == crate::model::WindowClaimKind::Product
                            && w.hwnd == claim.hwnd
                            && w.process == claim.process
                            && w.tag == claim.tag
                    })
                });
            if !exact {
                return Err(err("error: hide-proof ledger receipt mismatch"));
            }
        }
        _ => return Err(err("error: hide-proof ledger receipt missing")),
    }
    let deadline = seconds.map(|s| Instant::now() + Duration::from_secs(s));
    loop {
        if stop_requested(dir, me)? {
            return Ok(());
        }
        if deadline.is_some_and(|end| Instant::now() >= end) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(150));
    }
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
        // Owned-helper binding: sibling exe/class/tag. Generic windows never
        // capture even when otherwise eligible.
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
        if classify(&window.facts).is_err() {
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

/// Live executable paths of a top-level window's hosted children: direct
/// children owned by a different process than the top-level window itself.
/// Unreadable children contribute nothing (never a match). Scope
/// classification only: no effects touch child windows. Empty on enumeration
/// failure, which fails closed for listed hosts at the caller's gate.
fn hosted_child_exes(parent: HWND, top_pid: u32) -> Vec<String> {
    let mut out = Vec::new();
    let Some(children) = enumerate_child_windows(parent) else {
        return out;
    };
    for raw in children {
        let hwnd = raw as HWND;
        let mut pid: u32 = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut pid);
        }
        if pid == 0 || pid == top_pid {
            continue;
        }
        let exe = HeldProcess::open(pid)
            .ok()
            .and_then(|held| held.identity().ok())
            .filter(|ident| ident.pid == pid)
            .map(|ident| ident.exe_path);
        if let Some(exe) = exe {
            out.push(exe);
        }
    }
    out
}

/// Fresh hosted-child gate for one top-level window: listed hosts pass only
/// while a live hosted child matches. Short-circuits before enumerating when
/// the top-level executable names no pair. Read-only; the caller selects the
/// refusal outcome.
fn hosted_gate_allows(
    top_exe: &str,
    hwnd_u64: u64,
    top_pid: u32,
    pairs: &[ScopeHostChild],
) -> bool {
    if pairs.is_empty() {
        return true;
    }
    if !pairs
        .iter()
        .any(|pair| scope_exe_basename(&pair.host) == scope_exe_basename(top_exe))
    {
        return true;
    }
    let hwnd = hwnd_u64 as isize as HWND;
    hosted_child_allows(top_exe, &hosted_child_exes(hwnd, top_pid), pairs)
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
                let (eligible, skip) = match classify(&window.facts) {
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
