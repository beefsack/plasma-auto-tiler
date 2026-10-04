//! Native Windows notification tray (`cfg(windows)` only).
//!
//! Mechanism: one hidden owner-pump top-level window (class
//! [`crate::tray::TRAY_WINDOW_CLASS`]) owns exactly one official
//! `Shell_NotifyIconW` icon. The window procedure receives the tray callback
//! ([`crate::tray::TRAY_CALLBACK_MESSAGE`]) and the registered
//! `TaskbarCreated` broadcast: Explorer restarts recover MODIFY-first (a
//! surviving icon answers `NIM_MODIFY`, so no duplicate add is ever issued)
//! with a tolerant remove plus re-add only when the icon is truly gone, and
//! exactly one bounded `tray-taskbar` line carries the outcome.
//! Left-click and right-click both open the menu (KDE parity: the icon opens
//! its menu, never Settings directly).
//!
//! Menu commands: the top conflict row and Settings spawn the existing
//! `tiler-windows settings` UI as a detached child (the per-user singleton
//! mutex brings an open window forward instead); Stop sets an atomic the
//! owner loop polls next to its own stop request, so Stop follows the normal
//! owner cleanup (ledger reveal, Snap restore, watcher stop). Proof owners
//! never create this window.
//!
//! Crash recovery holds no persistent state: graceful stop issues
//! `NIM_DELETE`, while a dead owner leaves only an Explorer-side ghost that
//! the next startup or independent restore removes with a cross-process
//! `NIM_DELETE` against the stable icon GUID below (no live owner then, so
//! no live icon can be disturbed). The single-owner ledger lease guarantees
//! at most one live owner (hence at most one live icon).
//!
//! Stable automation surface: window class `PlasmaAutoTilerTray`, menu ids
//! 1001 (conflict), 1003 (Settings), 1004 (Stop), first-run prompt title
//! `Plasma Auto-Tiler - First Run`.
//!
//! GUID cross-process semantics (Microsoft Learn, `NOTIFYICONDATAW` plus the
//! `NotificationIcon` classic sample): once an icon is added with `NIF_GUID`
//! plus `guidItem`, every later call addressing that icon must carry the same
//! `NIF_GUID`/`guidItem`, and `NIM_DELETE` needs only those two fields — a
//! zero `hWnd`/`uID` from a later same-user process removes the stale
//! registration (the sample's `DeleteNotificationIcon` does exactly this).

use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use windows_sys::Win32::Foundation::HWND;
use windows_sys::core::GUID;

use crate::tray::{
    FIRST_RUN_TITLE, MENU_ID_CONFLICT, MENU_ID_DEFAULT_FLOATING, MENU_ID_DEFAULT_TILED,
    MENU_ID_SETTINGS, MENU_ID_STATUS, MENU_ID_STOP, MENU_ID_WORKSPACE_TOGGLE,
    TASKBAR_CREATED_MESSAGE, TRAY_CALLBACK_MESSAGE, TRAY_ICON_SIZE, TRAY_TOOLTIP_TITLE,
    TRAY_WINDOW_CLASS, ToggleScope, TrayIconState, WorkspaceMenu, first_run_body, menu_items,
    status_line,
};

type DynError = Box<dyn std::error::Error>;

fn err(msg: impl Into<String>) -> DynError {
    Box::new(std::io::Error::other(msg.into()))
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain([0]).collect()
}

/// Our single notification-icon id within the owner window.
const TRAY_ICON_ID: u32 = 1;

/// Stable project icon identifier. One fixed GUID, no ledger, no registry:
/// every add/modify/delete carries `NIF_GUID` plus this value, so a later
/// same-user process can delete a crash ghost with [`remove_stale_icon`]
/// while no live owner holds the lease.
const TRAY_GUID: GUID = GUID {
    data1: 0x8F3A2B1C,
    data2: 0x4D5E,
    data3: 0x4F6A,
    data4: [0x9B, 0x8C, 0x7D, 0x6E, 0x5F, 0x40, 0x91, 0xA2],
};

/// Best-effort removal of a crash-ghost icon. Call only with no live owner
/// (under the owner lease): the GUID addresses exactly this project's icon,
/// so a live owner's icon cannot exist then. Returns true when Explorer
/// accepted the delete. Same-user trust governs this call like every other
/// ledger-gated recovery step.
#[must_use]
pub fn remove_stale_icon() -> bool {
    use windows_sys::Win32::UI::Shell::{NIF_GUID, NIM_DELETE, NOTIFYICONDATAW, Shell_NotifyIconW};
    let mut data: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
    data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    data.uFlags = NIF_GUID;
    data.guidItem = TRAY_GUID;
    unsafe { Shell_NotifyIconW(NIM_DELETE, &data) != 0 }
}

/// Tooltip text: identity plus the short settings status, with a conflict
/// suffix when the warning badge is up. Bounded for `szTip`.
#[must_use]
pub fn tooltip_text(conflict: bool, settings_status: &str) -> String {
    let short: String = settings_status.chars().take(48).collect();
    let mut tip = format!("{TRAY_TOOLTIP_TITLE} - Enabled ({short})");
    if conflict {
        tip.push_str(" - check settings");
    }
    tip.chars().take(120).collect()
}

/// Build one `HICON` from 32x32 BGRA bytes (opaque mask: every pixel shows).
fn icon_from_bgra(
    pixels: &[u8],
) -> Result<windows_sys::Win32::UI::WindowsAndMessaging::HICON, DynError> {
    use windows_sys::Win32::Graphics::Gdi::CreateBitmap;
    use windows_sys::Win32::UI::WindowsAndMessaging::{CreateIconIndirect, ICONINFO};
    assert_eq!(pixels.len(), TRAY_ICON_SIZE * TRAY_ICON_SIZE * 4);
    let color = unsafe { CreateBitmap(32, 32, 1, 32, pixels.as_ptr().cast()) };
    if color.is_null() {
        return Err(err("error: tray color bitmap failed"));
    }
    // All-zero 1bpp mask: every pixel opaque (alpha rides the color bits).
    let mask = unsafe { CreateBitmap(32, 32, 1, 1, std::ptr::null()) };
    if mask.is_null() {
        unsafe {
            windows_sys::Win32::Graphics::Gdi::DeleteObject(color);
        }
        return Err(err("error: tray mask bitmap failed"));
    }
    let info = ICONINFO {
        fIcon: 1,
        xHotspot: 0,
        yHotspot: 0,
        hbmMask: mask,
        hbmColor: color,
    };
    let icon = unsafe { CreateIconIndirect(&info) };
    unsafe {
        windows_sys::Win32::Graphics::Gdi::DeleteObject(color);
        windows_sys::Win32::Graphics::Gdi::DeleteObject(mask);
    }
    if icon.is_null() {
        return Err(err("error: tray CreateIcon failed"));
    }
    Ok(icon)
}

struct Inner {
    hwnd: HWND,
    icon_normal: windows_sys::Win32::UI::WindowsAndMessaging::HICON,
    icon_warning: windows_sys::Win32::UI::WindowsAndMessaging::HICON,
    state: TrayIconState,
    showing_warning: bool,
    conflict_empty: bool,
    status: String,
    taskbar_created: u32,
    stop: Arc<AtomicBool>,
    log_path: Option<std::path::PathBuf>,
    /// Cached current-workspace tiled state (`None` without a readable
    /// scope: the checkbox disables). Refreshed by `sync_workspace`.
    workspace_current: Option<bool>,
    /// Opaque `(output, workspace)` scope the checkbox rendered with. A
    /// toggle pick carries exactly this scope to the owner loop, which
    /// refuses it when the live active pair no longer matches.
    workspace_scope: Option<(String, String)>,
    /// Cached persisted new-workspace default. Refreshed by
    /// `sync_workspace` and by successful default picks below.
    workspace_default: bool,
    /// Scoped workspace-toggle request (rendered output+workspace); the
    /// owner loop drains it once and refuses stale/mismatched scopes.
    toggle: Arc<Mutex<Option<ToggleScope>>>,
    /// Settings directory for persisting the default choice (normal owner
    /// only; `None` leaves the default rows as no-ops with a log line).
    settings_dir: Option<std::path::PathBuf>,
}

impl Inner {
    fn current_icon(&self) -> windows_sys::Win32::UI::WindowsAndMessaging::HICON {
        if self.showing_warning {
            self.icon_warning
        } else {
            self.icon_normal
        }
    }

    fn notify(&mut self, message: u32) -> bool {
        use windows_sys::Win32::UI::Shell::{
            NIF_GUID, NIF_ICON, NIF_MESSAGE, NIF_TIP, NOTIFYICONDATAW, Shell_NotifyIconW,
        };
        let mut tip = [0u16; 128];
        for (slot, unit) in tooltip_text(!self.conflict_empty, &self.status)
            .encode_utf16()
            .take(127)
            .enumerate()
        {
            tip[slot] = unit;
        }
        let mut data: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
        data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
        data.hWnd = self.hwnd;
        data.uID = TRAY_ICON_ID;
        data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_GUID;
        data.guidItem = TRAY_GUID;
        data.uCallbackMessage = TRAY_CALLBACK_MESSAGE;
        data.hIcon = self.current_icon();
        data.szTip = tip;
        unsafe { Shell_NotifyIconW(message, &data) != 0 }
    }

    fn log_line(&self, value: serde_json::Value) {
        use std::io::Write;
        if let Some(path) = self.log_path.as_ref()
            && let Ok(mut file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
        {
            let _ = writeln!(file, "{value}");
        }
    }

    /// `TaskbarCreated` recovery: a surviving icon answers `NIM_MODIFY` (a
    /// duplicate `NIM_ADD` would fail and retry forever), otherwise a
    /// tolerant remove plus re-add. Exactly one bounded `tray-taskbar` line
    /// carries the outcome; a still-pending add retries on the next sync.
    fn recover_taskbar(&mut self) {
        use crate::tray::TaskbarRecovery;
        use windows_sys::Win32::UI::Shell::{NIM_ADD, NIM_DELETE, NIM_MODIFY};
        let modify_ok = self.notify(NIM_MODIFY);
        let add_ok = if modify_ok {
            false
        } else {
            let _ = self.notify(NIM_DELETE);
            self.notify(NIM_ADD)
        };
        let outcome = match crate::tray::taskbar_recovery(modify_ok, add_ok) {
            TaskbarRecovery::Revalidated => {
                self.state.on_added();
                "revalidated"
            }
            TaskbarRecovery::ReAdded => {
                self.state.on_added();
                "re-added"
            }
            TaskbarRecovery::Pending => {
                self.state.on_removed();
                "pending"
            }
        };
        self.log_line(serde_json::json!({"event": "tray-taskbar", "outcome": outcome}));
    }

    fn add(&mut self) {
        use windows_sys::Win32::UI::Shell::NIM_ADD;
        if !self.state.needs_add() {
            return;
        }
        if self.notify(NIM_ADD) {
            self.state.on_added();
        }
    }

    fn sync_icon(&mut self) {
        use windows_sys::Win32::UI::Shell::NIM_MODIFY;
        if !self.state.is_added() {
            return;
        }
        let _ = self.notify(NIM_MODIFY);
    }

    fn remove(&mut self) {
        use windows_sys::Win32::UI::Shell::NIM_DELETE;
        if !self.state.is_added() {
            return;
        }
        let _ = self.notify(NIM_DELETE);
        self.state.on_removed();
    }
}

fn inner_of(hwnd: HWND) -> *mut Inner {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GWLP_USERDATA, GetWindowLongPtrW};
    unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut Inner }
}

fn show_menu(hwnd: HWND) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreatePopupMenu, DestroyMenu, GetCursorPos, MF_CHECKED, MF_DISABLED, MF_GRAYED,
        MF_SEPARATOR, MF_STRING, PostMessageW, SetForegroundWindow, TPM_RETURNCMD, TrackPopupMenu,
        WM_NULL,
    };
    let raw = inner_of(hwnd);
    if raw.is_null() {
        return;
    }
    let cached = unsafe { &*raw };
    let cached_conflicts_empty = cached.conflict_empty;
    let cached_status = cached.status.clone();
    let cached_workspace = WorkspaceMenu::new(cached.workspace_current, cached.workspace_default);
    // Rebuild the visible menu from cached state: no syscalls here, so a
    // stale poll can never project a wrong conflict row or workspace check.
    let items = menu_items(
        !cached_conflicts_empty,
        &status_line(&cached_status),
        cached_workspace,
    );
    let menu = unsafe { CreatePopupMenu() };
    if menu.is_null() {
        return;
    }
    for item in &items {
        let crate::tray::MenuItem::Command {
            id,
            label,
            enabled,
            visible,
            checked,
        } = item
        else {
            unsafe {
                windows_sys::Win32::UI::WindowsAndMessaging::AppendMenuW(
                    menu,
                    MF_SEPARATOR,
                    0,
                    std::ptr::null(),
                );
            }
            continue;
        };
        if !visible {
            continue;
        }
        // The disabled status row renders greyed; every other visible row is
        // a live command. The workspace checkbox and default choices render
        // their truthful checked state.
        let mut flags = MF_STRING;
        if *checked {
            flags |= MF_CHECKED;
        }
        if !enabled {
            flags |= MF_DISABLED | MF_GRAYED;
        }
        let text = wide(label);
        unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::AppendMenuW(
                menu,
                flags,
                *id as usize,
                text.as_ptr(),
            );
        }
    }
    let mut point = windows_sys::Win32::Foundation::POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut point) } == 0 {
        unsafe {
            DestroyMenu(menu);
        }
        return;
    }
    unsafe {
        SetForegroundWindow(hwnd);
    }
    let picked = unsafe {
        TrackPopupMenu(
            menu,
            TPM_RETURNCMD,
            point.x,
            point.y,
            0,
            hwnd,
            std::ptr::null(),
        )
    } as u32;
    // Dismissal contract for `SetForegroundWindow` menus: the posted null
    // lets the menu close when the user clicks away instead of lingering.
    unsafe {
        PostMessageW(hwnd, WM_NULL, 0, 0);
        DestroyMenu(menu);
    }
    if picked == MENU_ID_CONFLICT || picked == MENU_ID_SETTINGS {
        spawn_settings_detached();
    } else if picked == MENU_ID_STOP {
        let inner = unsafe { &*raw };
        inner.stop.store(true, Ordering::SeqCst);
    } else if picked == MENU_ID_STATUS {
        // Disabled status row: unreachable through the menu, kept for the
        // stable automation surface.
    } else if picked == MENU_ID_WORKSPACE_TOGGLE {
        // Session-only toggle: carry the rendered opaque scope to the owner
        // loop, which drains it once on its pump and flips the mode there
        // only when the live active pair still matches (never here, so a
        // stale menu can never project or flip a wrong check).
        let inner = unsafe { &*raw };
        if inner.workspace_current.is_some()
            && let Some((output, workspace)) = inner.workspace_scope.clone()
        {
            *inner
                .toggle
                .lock()
                .unwrap_or_else(|poison| poison.into_inner()) =
                Some(ToggleScope::new(&output, &workspace));
        }
    } else if picked == MENU_ID_DEFAULT_TILED || picked == MENU_ID_DEFAULT_FLOATING {
        let inner = unsafe { &mut *raw };
        persist_default_choice(inner, picked == MENU_ID_DEFAULT_TILED);
    }
}

/// Persist one new-workspace default choice (`true` for Tiled): load,
/// modify only `workspace.default_tiled`, and atomically save. Only the
/// default persists; per-workspace session overrides never touch the file.
/// An invalid on-disk file refuses with a log line and no write.
fn persist_default_choice(inner: &mut Inner, default_tiled: bool) {
    let outcome = (|| -> &'static str {
        let Some(dir) = inner.settings_dir.clone() else {
            return "no-settings-dir";
        };
        let mut settings = match crate::settings::load_from_dir(&dir) {
            crate::settings::LoadOutcome::Loaded(settings) => settings,
            crate::settings::LoadOutcome::Missing => crate::settings::Settings::default(),
            crate::settings::LoadOutcome::Invalid(_) => return "refused-invalid",
        };
        if settings.core.workspace.default_tiled == default_tiled {
            return "unchanged";
        }
        settings.core.workspace.default_tiled = default_tiled;
        match crate::settings::save_to_dir(&dir, &mut settings) {
            Ok(()) => {
                inner.workspace_default = default_tiled;
                "written"
            }
            Err(_) => "write-failed",
        }
    })();
    inner.log_line(serde_json::json!({
        "event": "tray-default",
        "default_tiled": default_tiled,
        "outcome": outcome,
    }));
}

/// Open the existing native Settings window as a detached child: the
/// per-user singleton mutex brings an open window forward instead of
/// racing it, and the owner pump never blocks.
fn spawn_settings_detached() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let _ = std::process::Command::new(exe).arg("settings").spawn();
}

unsafe extern "system" fn tray_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: windows_sys::Win32::Foundation::WPARAM,
    lparam: windows_sys::Win32::Foundation::LPARAM,
) -> windows_sys::Win32::Foundation::LRESULT {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CREATESTRUCTW, DefWindowProcW, GWLP_USERDATA, SetWindowLongPtrW, WM_CREATE, WM_DESTROY,
        WM_LBUTTONUP, WM_RBUTTONUP,
    };
    if msg == WM_CREATE {
        let create = unsafe { &*(lparam as *const CREATESTRUCTW) };
        unsafe {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize);
        }
        return 0;
    }
    // TaskbarCreated arrives as the registered message id, never WM_CREATE.
    let raw = inner_of(hwnd);
    if !raw.is_null() {
        let inner = unsafe { &mut *raw };
        if msg == inner.taskbar_created {
            inner.recover_taskbar();
            return 0;
        }
        if msg == TRAY_CALLBACK_MESSAGE {
            let mouse = (lparam & 0xffff) as u32;
            if wparam as u32 == TRAY_ICON_ID && (mouse == WM_LBUTTONUP || mouse == WM_RBUTTONUP) {
                show_menu(hwnd);
            }
            return 0;
        }
    }
    if msg == WM_DESTROY {
        // Owned by `TrayOwner::drop` (detach-then-destroy there): never
        // free here, so exactly one owner exists either way.
        return 0;
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

/// Live owner tray: hidden window plus exactly one notification icon.
pub struct TrayOwner {
    hwnd: HWND,
    stop: Arc<AtomicBool>,
    toggle: Arc<Mutex<Option<ToggleScope>>>,
}

impl TrayOwner {
    /// Create the hidden owner window, both glyph variants, and the icon.
    /// `conflict_empty` and `settings_status` seed the first presentation;
    /// `sync` refreshes them later. Icon-add failure is not fatal: the next
    /// `sync` retries through the state gate. `log_path` receives the single
    /// bounded `tray-taskbar` line per Explorer restart, if any, plus the
    /// bounded `tray-default` lines for default picks. `toggle` carries the
    /// scoped workspace-toggle request to the owner loop (drained once via
    /// `take_toggle_request`); `settings_dir` persists default picks
    /// (normal owner only).
    pub fn create(
        conflict_empty: bool,
        settings_status: &str,
        log_path: Option<std::path::PathBuf>,
        toggle: &Arc<Mutex<Option<ToggleScope>>>,
        settings_dir: Option<std::path::PathBuf>,
    ) -> Result<Self, DynError> {
        use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CS_HREDRAW, CS_VREDRAW, CreateWindowExW, RegisterClassW, RegisterWindowMessageW,
            WNDCLASSW, WS_EX_TOOLWINDOW, WS_POPUP,
        };
        let class_w = wide(TRAY_WINDOW_CLASS);
        let hinst = unsafe { GetModuleHandleW(std::ptr::null()) };
        let mut cls: WNDCLASSW = unsafe { std::mem::zeroed() };
        cls.style = CS_HREDRAW | CS_VREDRAW;
        cls.lpfnWndProc = Some(tray_wnd_proc);
        cls.hInstance = hinst;
        cls.lpszClassName = class_w.as_ptr();
        let atom = unsafe { RegisterClassW(&cls) };
        if atom == 0 {
            let code = unsafe { windows_sys::Win32::Foundation::GetLastError() };
            if code != 1410 {
                return Err(err("error: tray RegisterClass failed"));
            }
        }
        let taskbar_created =
            unsafe { RegisterWindowMessageW(wide(TASKBAR_CREATED_MESSAGE).as_ptr()) };
        if taskbar_created == 0 {
            return Err(err("error: tray TaskbarCreated register failed"));
        }
        let icon_normal = icon_from_bgra(&crate::tray::tray_icon_bgra(false))?;
        let icon_warning = match icon_from_bgra(&crate::tray::tray_icon_bgra(true)) {
            Ok(icon) => icon,
            Err(error) => {
                unsafe {
                    windows_sys::Win32::UI::WindowsAndMessaging::DestroyIcon(icon_normal);
                }
                return Err(error);
            }
        };
        let stop = Arc::new(AtomicBool::new(false));
        let inner = Box::new(Inner {
            hwnd: std::ptr::null_mut(),
            icon_normal,
            icon_warning,
            state: TrayIconState::new(),
            showing_warning: !conflict_empty,
            conflict_empty,
            status: settings_status.to_owned(),
            taskbar_created,
            stop: Arc::clone(&stop),
            log_path,
            workspace_current: None,
            workspace_scope: None,
            workspace_default: true,
            toggle: Arc::clone(toggle),
            settings_dir,
        });
        let raw = Box::into_raw(inner);
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_TOOLWINDOW,
                class_w.as_ptr(),
                std::ptr::null(),
                WS_POPUP,
                0,
                0,
                0,
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                hinst,
                raw.cast(),
            )
        };
        if hwnd.is_null() {
            unsafe {
                drop(Box::from_raw(raw));
            }
            unsafe {
                windows_sys::Win32::UI::WindowsAndMessaging::DestroyIcon(icon_normal);
                windows_sys::Win32::UI::WindowsAndMessaging::DestroyIcon(icon_warning);
            }
            return Err(err("error: tray CreateWindow failed"));
        }
        unsafe {
            (*raw).hwnd = hwnd;
            (*raw).add();
        }
        Ok(Self {
            hwnd,
            stop,
            toggle: Arc::clone(toggle),
        })
    }

    /// Refresh the badge/tooltip from live owner state and retry a pending
    /// add through the state gate. Change-gated: steady state issues no
    /// syscalls, so the 100 ms pump costs nothing when nothing changed.
    pub fn sync(&mut self, conflict_empty: bool, settings_status: &str) {
        let raw = inner_of(self.hwnd);
        if raw.is_null() {
            return;
        }
        let inner = unsafe { &mut *raw };
        let warning = !conflict_empty;
        let changed = warning != inner.showing_warning || settings_status != inner.status;
        inner.conflict_empty = conflict_empty;
        inner.status = settings_status.to_owned();
        if warning != inner.showing_warning {
            inner.showing_warning = warning;
            inner.sync_icon();
        } else if inner.state.needs_add() {
            inner.add();
        } else if changed {
            // Tooltip/status refresh rides one modify; icon swaps above.
            inner.sync_icon();
        }
    }

    /// True after the user picks Stop from the menu.
    #[must_use]
    pub fn stop_requested(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }

    /// Drain one pending scoped workspace-toggle request (set by the menu,
    /// consumed once by the owner loop). Returns `None` when no pick waits.
    pub fn take_toggle_request(&self) -> Option<ToggleScope> {
        self.toggle
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .take()
    }

    /// Refresh the cached workspace section from live owner state: the opaque
    /// scope the checkbox rendered with, its tiled state, and the persisted
    /// default. The next menu open renders it; no syscalls here. `None`
    /// scope disables only the checkbox while the default choices stay
    /// usable.
    pub fn sync_workspace(
        &mut self,
        scope: Option<(String, String)>,
        current_tiled: Option<bool>,
        default_tiled: bool,
    ) {
        let raw = inner_of(self.hwnd);
        if raw.is_null() {
            return;
        }
        let inner = unsafe { &mut *raw };
        inner.workspace_scope = scope;
        inner.workspace_current = current_tiled;
        inner.workspace_default = default_tiled;
    }
}

impl Drop for TrayOwner {
    /// Plain RAII teardown on every path (graceful stop and early errors
    /// alike): `NIM_DELETE` when added, both glyphs destroyed, window
    /// destroyed, owner box freed exactly once.
    fn drop(&mut self) {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            DestroyIcon, DestroyWindow, GWLP_USERDATA, SetWindowLongPtrW,
        };
        let raw = inner_of(self.hwnd);
        if raw.is_null() {
            return;
        }
        unsafe {
            let inner = &mut *raw;
            inner.remove();
            DestroyIcon(inner.icon_normal);
            DestroyIcon(inner.icon_warning);
            SetWindowLongPtrW(self.hwnd, GWLP_USERDATA, 0);
            DestroyWindow(self.hwnd);
            drop(Box::from_raw(raw));
        }
    }
}

/// First-run prompt outcome on the normal owner path only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FirstRunOutcome {
    Authentic,
    Compatible,
    Dismissed,
}

impl FirstRunOutcome {
    #[must_use]
    pub const fn choice(self) -> Option<crate::tray::FirstRunChoice> {
        match self {
            Self::Authentic => Some(crate::tray::FirstRunChoice::Authentic),
            Self::Compatible => Some(crate::tray::FirstRunChoice::Compatible),
            Self::Dismissed => None,
        }
    }
}

/// Modal first-run prompt (Yes = authentic default, No = compatible).
/// Closed/dismissed boxes report `Dismissed` and persist nothing.
#[must_use]
pub fn first_run_prompt() -> FirstRunOutcome {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IDNO, IDYES, MB_DEFBUTTON1, MB_ICONQUESTION, MB_SYSTEMMODAL, MB_YESNO, MessageBoxW,
    };
    let body = wide(&first_run_body());
    let title = wide(FIRST_RUN_TITLE);
    let picked = unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            body.as_ptr(),
            title.as_ptr(),
            MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON1 | MB_SYSTEMMODAL,
        )
    };
    if picked == IDYES {
        FirstRunOutcome::Authentic
    } else if picked == IDNO {
        FirstRunOutcome::Compatible
    } else {
        FirstRunOutcome::Dismissed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tooltip_carries_status_and_conflict_suffix() {
        let plain = tooltip_text(false, "saved:3");
        assert!(plain.contains(TRAY_TOOLTIP_TITLE));
        assert!(plain.contains("saved:3"));
        assert!(!plain.contains("check settings"));
        let warned = tooltip_text(true, "saved:3");
        assert!(warned.contains("check settings"));
        let long = "x".repeat(400);
        assert!(tooltip_text(true, &long).len() <= 128);
    }

    #[test]
    fn icons_build_and_destroy_headless() {
        for warning in [false, true] {
            let icon = icon_from_bgra(&crate::tray::tray_icon_bgra(warning))
                .expect("icon builds headless");
            assert!(!icon.is_null());
            unsafe {
                assert_ne!(
                    windows_sys::Win32::UI::WindowsAndMessaging::DestroyIcon(icon),
                    0
                );
            }
        }
    }

    #[test]
    fn menu_model_projects_cached_conflict_visibility() {
        // Sys menu builder consumes the portable model: visible conflict
        // row exactly when the cache is non-empty.
        let workspace = crate::tray::WorkspaceMenu::new(Some(true), true);
        let shown = menu_items(true, &status_line("saved:2"), workspace);
        let hidden = menu_items(false, &status_line("saved:2"), workspace);
        let visible_of = |items: &Vec<crate::tray::MenuItem>| {
            items.iter().find_map(|item| match item {
                crate::tray::MenuItem::Command { id, visible, .. } if *id == MENU_ID_CONFLICT => {
                    Some(*visible)
                }
                _ => None,
            })
        };
        assert_eq!(visible_of(&shown), Some(true));
        assert_eq!(visible_of(&hidden), Some(false));
        assert!(shown.iter().any(|item| matches!(
            item,
            crate::tray::MenuItem::Command {
                id: MENU_ID_STATUS,
                ..
            }
        )));
        assert!(shown.iter().any(|item| matches!(
            item,
            crate::tray::MenuItem::Command {
                id: MENU_ID_SETTINGS,
                ..
            }
        )));
    }
}
