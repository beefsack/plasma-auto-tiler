//! Owned active-border overlay (`cfg(windows)` only).
//!
//! Mechanism: one process-owned `WS_EX_LAYERED | WS_EX_TRANSPARENT |
//! WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE` `WS_POPUP` surface with per-pixel
//! alpha via `UpdateLayeredWindow`. No foreign attribute mutation, no foreign
//! ownership/style writes. The surface is click-through, never activates,
//! skips Alt+Tab via `WS_EX_TOOLWINDOW`, and follows the target's topmost
//! band (`HWND_TOPMOST` only while the target is topmost, otherwise a
//! normal-band surface placed directly beneath the target): never
//! permanently pinned over unrelated topmost/shell UI. Hidden on any suppression. Process exit
//! destroys it implicitly (no residue); graceful stop destroys it explicitly.
//!
//! The drawing carrier (create/paint/move/hide/destroy) is reusable for the
//! later group underlay, which is not implemented here.

use tiler_core::geometry::Rect;

use crate::active_border::{ActiveBorderStyle, SystemAccent, effective_color, ring_covers};

type DynError = Box<dyn std::error::Error>;

fn err(msg: impl Into<String>) -> DynError {
    Box::new(std::io::Error::other(msg.into()))
}

pub const OVERLAY_CLASS: &str = "PlasmaAutoTilerActiveBorder";

// Stable Win32 broadcast ids (no new dependency): the overlay WndProc only
// flags on these; the loop thread re-queries and repaints.
const WM_SETTINGCHANGE: u32 = 0x001A;
const WM_DWMCOLORIZATIONCOLORCHANGED: u32 = 0x0320;

fn accent_dirty_flag() -> &'static std::sync::atomic::AtomicBool {
    use std::sync::atomic::AtomicBool;
    static DIRTY: AtomicBool = AtomicBool::new(false);
    &DIRTY
}

/// Sticky accent-refresh request from the overlay WndProc. Consumed by
/// `show_at`: sticky, so coalesced broadcasts still refresh exactly once.
fn take_accent_dirty() -> bool {
    use std::sync::atomic::Ordering;
    accent_dirty_flag().swap(false, Ordering::SeqCst)
}

fn mark_accent_dirty() {
    use std::sync::atomic::Ordering;
    accent_dirty_flag().store(true, Ordering::SeqCst);
}

/// Overlay window procedure: accent broadcasts only flag a refresh, every
/// other message keeps default handling. Never paints, hides, or destroys:
/// no feedback into the loop-owned overlay state.
unsafe extern "system" fn overlay_wnd_proc(
    hwnd: windows_sys::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows_sys::Win32::Foundation::WPARAM,
    lparam: windows_sys::Win32::Foundation::LPARAM,
) -> windows_sys::Win32::Foundation::LRESULT {
    use windows_sys::Win32::UI::WindowsAndMessaging::DefWindowProcW;
    if msg == WM_DWMCOLORIZATIONCOLORCHANGED || msg == WM_SETTINGCHANGE {
        mark_accent_dirty();
        return 0;
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

/// Read-only system accent query: the official DWM colorization colour
/// (`DwmGetColorizationColor`, `0xAARRGGBB`), the Windows analogue of the KDE
/// Plasma highlight the KWin effect reads from `KColorScheme`. `None` when
/// the API fails: callers fall back to the configured colour. No writes, no
/// settings changes, no parameters consumed.
fn query_system_accent() -> Option<SystemAccent> {
    use windows_sys::Win32::Graphics::Dwm::DwmGetColorizationColor;
    let mut dword: u32 = 0;
    let mut opaque: i32 = 0;
    let hr = unsafe { DwmGetColorizationColor(&mut dword, &mut opaque) };
    if hr == 0 {
        Some(SystemAccent::from_colorization_dword(dword))
    } else {
        None
    }
}

/// Outcome of one overlay update, for bounded logging.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverlayOutcome {
    Hidden,
    Shown,
    Moved,
    Redrew,
    Unchanged,
}

/// Process-owned overlay lifecycle plus owned-pixel inspection.
#[derive(Default)]
pub struct BorderOverlay {
    hwnd: Option<u64>,
    outer: Option<Rect>,
    style_px: Option<(i32, i32, i32)>,
    color: Option<(u8, u8, u8)>,
    /// Last queried system accent (`None` until the first show or when the
    /// query fails): refreshed only on the WndProc dirty flag, compared
    /// through `effective_color` so an accent change repaints via the
    /// existing colour comparison with no extra paint path.
    accent: Option<SystemAccent>,
    target_token: Option<String>,
    topmost: bool,
    dib_checksum: u64,
    redraws: u64,
    moves: u64,
    failures: u64,
    last_error: Option<String>,
}

impl BorderOverlay {
    #[must_use]
    pub fn hwnd(&self) -> Option<u64> {
        self.hwnd
    }

    #[must_use]
    pub fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }

    #[must_use]
    pub fn is_visible(&self) -> bool {
        self.outer.is_some()
    }

    /// Last resolved ring colour (accent-or-fallback actually painted).
    #[must_use]
    pub fn current_color(&self) -> Option<(u8, u8, u8)> {
        self.color
    }

    /// Hide the surface (no-op when already hidden). Keeps the window alive
    /// for the next target; failures count boundedly.
    pub fn hide(&mut self) {
        if self.outer.is_none() {
            return;
        }
        self.outer = None;
        self.target_token = None;
        if let Some(hwnd) = self.hwnd {
            hide_window(hwnd);
        }
    }

    /// Destroy the surface explicitly (graceful stop). Process exit also
    /// destroys it implicitly.
    pub fn destroy(&mut self) {
        if let Some(hwnd) = self.hwnd.take() {
            destroy_window(hwnd);
        }
        self.outer = None;
        self.style_px = None;
        self.color = None;
        self.accent = None;
        self.target_token = None;
        self.topmost = false;
    }

    /// Show or move the ring for one eligible target. Position-only changes
    /// move without repainting; size/style/colour changes repaint. `topmost`
    /// mirrors the target's `WS_EX_TOPMOST`: a topmost target needs a topmost
    /// ring, an ordinary target must demote a previously topmost ring.
    /// Paint/move failures hide any stale ring and clear state, returning
    /// `Hidden` for bounded caller logging with `last_error`.
    ///
    /// Cached equality never trusts the cache alone: when geometry, style,
    /// colour, token, and band all match, the actual overlay is still probed
    /// (visibility, `GetWindowRect`, z-order against the fresh `target_hwnd`)
    /// and only a truly current surface returns `Unchanged`. A hidden,
    /// misplaced, or displaced surface falls through to a `place_overlay`
    /// reassert in the target's own band, directly beneath the target:
    /// never over unrelated topmost or shell UI. No foreign attribute
    /// writes; `target_hwnd` is the refresh's fresh foreground HWND, never
    /// a stale cache.
    #[allow(clippy::too_many_arguments)]
    pub fn show_at(
        &mut self,
        outer: Rect,
        width_px: i32,
        gap_px: i32,
        radius_px: i32,
        style: &ActiveBorderStyle,
        target_token: &str,
        topmost: bool,
        target_hwnd: u64,
    ) -> OverlayOutcome {
        // Accent first, before the equality check: a theme change must miss
        // neither the repaint (colour comparison below) nor the first show.
        // Sticky flag plus first-show query means no broadcast is missed; the
        // comparison makes an unchanged accent a no-op without repaint.
        if self.accent.is_none() || take_accent_dirty() {
            self.accent = query_system_accent();
        }
        let color = effective_color(style, self.accent);
        let style_px = (width_px, gap_px, radius_px);
        if self.outer == Some(outer)
            && self.style_px == Some(style_px)
            && self.color == Some(color)
            && self.target_token.as_deref() == Some(target_token)
            && self.topmost == topmost
        {
            match self.hwnd {
                Some(hwnd) if !overlay_needs_reassert(hwnd, outer, target_hwnd) => {
                    return OverlayOutcome::Unchanged;
                }
                Some(dead) if !is_overlay_window(dead) => {
                    // Externally destroyed surface: drop the stale handle so
                    // the path below recreates instead of moving a dead HWND.
                    self.hwnd = None;
                    self.outer = None;
                }
                _ => {}
            }
        }
        let hwnd = match self.hwnd {
            Some(hwnd) => hwnd,
            None => match create_overlay_window() {
                Ok(hwnd) => {
                    self.hwnd = Some(hwnd);
                    self.last_error = None;
                    hwnd
                }
                Err(e) => {
                    self.failures += 1;
                    self.last_error = Some(truncate_error(&e.to_string()));
                    self.fail_hide();
                    return OverlayOutcome::Hidden;
                }
            },
        };
        let first_show = self.outer.is_none();
        let size_changed = first_show
            || self.outer.is_none_or(|o| o.w != outer.w || o.h != outer.h)
            || self.style_px != Some(style_px)
            || self.color != Some(color);
        if size_changed {
            match paint_and_present(
                hwnd,
                outer,
                width_px,
                radius_px,
                color,
                topmost,
                target_hwnd,
            ) {
                Ok(checksum) => {
                    self.dib_checksum = checksum;
                    self.redraws += 1;
                    self.last_error = None;
                }
                Err(e) => {
                    self.failures += 1;
                    self.last_error = Some(truncate_error(&e.to_string()));
                    self.fail_hide();
                    return OverlayOutcome::Hidden;
                }
            }
        } else if let Err(e) = move_overlay(hwnd, outer, topmost, target_hwnd) {
            self.failures += 1;
            self.last_error = Some(truncate_error(&e.to_string()));
            self.fail_hide();
            return OverlayOutcome::Hidden;
        } else {
            self.moves += 1;
        }
        self.outer = Some(outer);
        self.style_px = Some(style_px);
        self.color = Some(color);
        self.target_token = Some(target_token.to_owned());
        self.topmost = topmost;
        if first_show {
            OverlayOutcome::Shown
        } else if size_changed {
            OverlayOutcome::Redrew
        } else {
            OverlayOutcome::Moved
        }
    }

    fn fail_hide(&mut self) {
        self.outer = None;
        self.target_token = None;
        if let Some(hwnd) = self.hwnd {
            hide_window(hwnd);
        }
    }

    /// Read-only owned-surface snapshot for proof support: geometry, style,
    /// opaque target token, and a checksum over our own DIB pixels only.
    /// No screen capture, no titles, no content, no foreign IDs.
    pub fn snapshot(&self) -> serde_json::Value {
        serde_json::json!({
            "visible": self.is_visible(),
            "outer": self.outer.map(|r| [r.x, r.y, r.w, r.h]),
            "style_px": self.style_px.map(|(w, g, r)| [w, g, r]),
            "color": self.color.map(crate::active_border::render_color),
            "accent": self.accent.map(|a| crate::active_border::render_color(a.color)),
            "target": self.target_token.clone(),
            "dib_checksum": format!("{:016x}", self.dib_checksum),
            "redraws": self.redraws,
            "moves": self.moves,
            "failures": self.failures,
            "last_error": self.last_error.clone(),
        })
    }
}

/// True only when the cached overlay needs a same-geometry reassert: the
/// surface is gone, hidden, misplaced, or displaced below the fresh target.
/// Adjacent-below is the achievable correct placement for a background
/// owner's surface under its foreground target, so only true-below (or an
/// unreadable probe, which recovers by reasserting) reasserts. The reassert
/// is a `place_overlay` in the target's own band directly beneath the fresh
/// target HWND, never a blind raise over unrelated topmost or shell UI.
fn overlay_needs_reassert(overlay_u64: u64, outer: Rect, target_hwnd: u64) -> bool {
    use windows_sys::Win32::Foundation::{HWND, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsWindowVisible};
    if overlay_u64 == 0 {
        return true;
    }
    let overlay = overlay_u64 as usize as HWND;
    if !is_overlay_window(overlay_u64) {
        return true;
    }
    if unsafe { IsWindowVisible(overlay) } == 0 {
        return true;
    }
    let mut actual: RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(overlay, &mut actual) } == 0 {
        return true;
    }
    let w = actual.right - actual.left;
    let h = actual.bottom - actual.top;
    if actual.left != outer.x || actual.top != outer.y || w != outer.w || h != outer.h {
        return true;
    }
    if target_hwnd == 0 || target_hwnd == overlay_u64 {
        return false;
    }
    // Behind means displaced (a foreign window between, or far below):
    // adjacent-below is the achievable correct placement for a background
    // owner's surface under its foreground target, so only true-below
    // reasserts. Unknown order (endpoint vanished mid-probe, or enumeration
    // failed) recovers by reasserting: a needless same-geometry move is
    // harmless, a missed displacement is not.
    matches!(
        z_relation(overlay_u64, target_hwnd),
        Some(ZRelation::Below) | None
    )
}

fn is_overlay_window(hwnd_u64: u64) -> bool {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::IsWindow;
    if hwnd_u64 == 0 {
        return false;
    }
    unsafe { IsWindow(hwnd_u64 as usize as HWND) != 0 }
}

/// Z-order relation between the owned overlay and the fresh target in
/// `EnumWindows` top-to-bottom order. A background owner cannot place its
/// surface above the foreground window (live probe: steady-state overlay
/// adjacent-below the focused helper despite `HWND_TOP`), so `AdjacentBelow`
/// is the achievable correct placement for an eligible foreground target:
/// directly beneath it, above everything else, ring pixels uncovered.
/// `GetWindow` handle walks are invalid evidence (they skip the toolwindow
/// overlay against normal targets). Read-only enumeration, no writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ZRelation {
    Above,
    AdjacentBelow,
    Below,
}

/// Z-order probe: relation of the overlay to the fresh target, `None` when
/// either endpoint is gone or the order is unreadable.
fn z_relation(overlay_u64: u64, target_hwnd: u64) -> Option<ZRelation> {
    let order = top_to_bottom_hwnds()?;
    let mut upper_idx: Option<usize> = None;
    let mut lower_idx: Option<usize> = None;
    for (i, hwnd) in order.iter().enumerate() {
        if *hwnd == overlay_u64 && upper_idx.is_none() {
            upper_idx = Some(i);
        }
        if *hwnd == target_hwnd && lower_idx.is_none() {
            lower_idx = Some(i);
        }
        if upper_idx.is_some() && lower_idx.is_some() {
            break;
        }
    }
    match (upper_idx, lower_idx) {
        (Some(u), Some(l)) if u < l => Some(ZRelation::Above),
        (Some(u), Some(l)) if u == l + 1 => Some(ZRelation::AdjacentBelow),
        (Some(_), Some(_)) => Some(ZRelation::Below),
        _ => None,
    }
}

/// Shared `EnumWindows` top-to-bottom snapshot for z-order evidence.
fn top_to_bottom_hwnds() -> Option<Vec<u64>> {
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::EnumWindows;
    unsafe extern "system" fn enum_proc(hwnd: HWND, state: LPARAM) -> i32 {
        let out = unsafe { &mut *(state as *mut Vec<u64>) };
        out.push(hwnd as usize as u64);
        1
    }
    let mut out: Vec<u64> = Vec::new();
    let ok = unsafe { EnumWindows(Some(enum_proc), &mut out as *mut Vec<u64> as LPARAM) };
    if ok == 0 { None } else { Some(out) }
}

fn truncate_error(message: &str) -> String {
    const MAX: usize = 160;
    let mut out: String = message.chars().take(MAX).collect();
    if message.chars().count() > MAX {
        out.push_str("...");
    }
    out
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain([0]).collect()
}

fn overlay_registered_flag() -> &'static std::sync::atomic::AtomicBool {
    use std::sync::atomic::AtomicBool;
    static REGISTERED: AtomicBool = AtomicBool::new(false);
    &REGISTERED
}

fn overlay_class_registered() -> bool {
    use std::sync::atomic::Ordering;
    overlay_registered_flag().load(Ordering::SeqCst)
}

fn mark_overlay_class_registered() {
    use std::sync::atomic::Ordering;
    overlay_registered_flag().store(true, Ordering::SeqCst);
}

fn create_overlay_window() -> Result<u64, DynError> {
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CS_HREDRAW, CS_VREDRAW, CreateWindowExW, RegisterClassW, WNDCLASSW, WS_EX_LAYERED,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT, WS_POPUP,
    };
    if !overlay_class_registered() {
        let class_w = wide(OVERLAY_CLASS);
        let hinst = unsafe { GetModuleHandleW(std::ptr::null()) };
        let mut cls: WNDCLASSW = unsafe { std::mem::zeroed() };
        cls.style = CS_HREDRAW | CS_VREDRAW;
        cls.lpfnWndProc = Some(overlay_wnd_proc);
        cls.hInstance = hinst;
        cls.lpszClassName = class_w.as_ptr();
        let atom = unsafe { RegisterClassW(&cls) };
        if atom == 0 {
            // Tolerate a lost race / prior registration in this process:
            // ERROR_CLASS_ALREADY_EXISTS (1410) means the class is usable.
            let code = unsafe { windows_sys::Win32::Foundation::GetLastError() };
            if code != 1410 {
                return Err(err("error: active-border RegisterClass failed"));
            }
        }
        mark_overlay_class_registered();
    }
    let class_w = wide(OVERLAY_CLASS);
    let hinst = unsafe { GetModuleHandleW(std::ptr::null()) };
    let hwnd = unsafe {
        CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
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
            std::ptr::null(),
        )
    };
    if hwnd.is_null() {
        return Err(err("error: active-border CreateWindow failed"));
    }
    Ok(hwnd as usize as u64)
}

fn hide_window(hwnd_u64: u64) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{SW_HIDE, ShowWindow};
    unsafe {
        ShowWindow(hwnd_u64 as usize as HWND, SW_HIDE);
    }
}

fn destroy_window(hwnd_u64: u64) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::DestroyWindow;
    unsafe {
        DestroyWindow(hwnd_u64 as usize as HWND);
    }
}

/// Z-order anchors: ordinary targets stay in the normal band and sit directly
/// beneath the target; topmost targets use the topmost band the same way.
/// Live probes proved `HWND_TOP` a silent no-op for z-order here (a direct
/// `SetWindowPos(TOP)` from the background owner succeeds yet never
/// reorders), while passing the fresh target HWND as `hWndInsertAfter`
/// places the overlay immediately below it. The band still follows the
/// target every paint/move, never permanently over unrelated topmost/shell.
fn insert_after(topmost: bool) -> windows_sys::Win32::Foundation::HWND {
    if topmost {
        windows_sys::Win32::UI::WindowsAndMessaging::HWND_TOPMOST as usize
            as windows_sys::Win32::Foundation::HWND
    } else {
        windows_sys::Win32::UI::WindowsAndMessaging::HWND_TOP as usize
            as windows_sys::Win32::Foundation::HWND
    }
}

/// Position the owned overlay directly beneath its fresh target without
/// leaving its band. Ordinary targets: a `NOTOPMOST` demote-if-needed (no-op
/// when already normal) followed by placement with the target HWND as
/// `hWndInsertAfter` (immediately below the target). Topmost targets: a
/// `TOPMOST` promote-if-needed followed by the same below-target placement
/// inside the topmost band. A zero `target_hwnd` falls back to the band
/// anchor (best effort, no adjacency). Read-only band input, owned-window
/// writes only, never over unrelated topmost or shell UI.
fn place_overlay(
    hwnd_u64: u64,
    outer: Rect,
    topmost: bool,
    target_hwnd: u64,
) -> Result<(), DynError> {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        HWND_NOTOPMOST, SWP_NOACTIVATE, SWP_SHOWWINDOW, SetWindowPos,
    };
    let band = |after: HWND| unsafe {
        SetWindowPos(
            hwnd_u64 as usize as HWND,
            after,
            outer.x,
            outer.y,
            outer.w,
            outer.h,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
    };
    if topmost {
        if band(insert_after(true)) == 0 {
            return Err(err("error: active-border position failed"));
        }
    } else if band(HWND_NOTOPMOST as usize as HWND) == 0 {
        return Err(err("error: active-border position failed"));
    }
    if target_hwnd != 0 && target_hwnd != hwnd_u64 {
        let below_target = unsafe {
            SetWindowPos(
                hwnd_u64 as usize as HWND,
                target_hwnd as usize as HWND,
                outer.x,
                outer.y,
                outer.w,
                outer.h,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            )
        };
        if below_target == 0 {
            return Err(err("error: active-border position failed"));
        }
        return Ok(());
    }
    if band(insert_after(topmost)) == 0 {
        return Err(err("error: active-border position failed"));
    }
    Ok(())
}

fn move_overlay(
    hwnd_u64: u64,
    outer: Rect,
    topmost: bool,
    target_hwnd: u64,
) -> Result<(), DynError> {
    place_overlay(hwnd_u64, outer, topmost, target_hwnd)
}

/// Paint the ring into a fresh 32bpp top-down DIB and present it with
/// `UpdateLayeredWindow` (`ULW_ALPHA`). Returns an FNV-1a checksum over the
/// owned DIB bytes (proof support without screen capture), computed in the
/// single paint pass (no second full-buffer hash walk).
fn paint_and_present(
    hwnd_u64: u64,
    outer: Rect,
    width_px: i32,
    radius_px: i32,
    color: (u8, u8, u8),
    topmost: bool,
    target_hwnd: u64,
) -> Result<u64, DynError> {
    use windows_sys::Win32::Foundation::{HWND, POINT, SIZE};
    use windows_sys::Win32::Graphics::Gdi::{
        AC_SRC_ALPHA, BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BLENDFUNCTION, CreateCompatibleDC,
        CreateDIBSection, DIB_RGB_COLORS, DeleteDC, DeleteObject, SelectObject,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{ULW_ALPHA, UpdateLayeredWindow};
    if outer.w <= 0 || outer.h <= 0 || width_px < 0 || radius_px < 0 {
        return Err(err("error: active-border bad paint geometry"));
    }
    if width_px == 0 {
        hide_window(hwnd_u64);
        return Ok(0);
    }
    // Bound the surface: a full-monitor overlay plus ring is the largest
    // legitimate case; anything absurd fails closed instead of allocating.
    if outer.w > 16384 || outer.h > 16384 {
        return Err(err("error: active-border surface too large"));
    }
    let memdc = unsafe { CreateCompatibleDC(std::ptr::null_mut()) };
    if memdc.is_null() {
        return Err(err("error: active-border DC failed"));
    }
    let mut bmi: BITMAPINFO = unsafe { std::mem::zeroed() };
    bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    bmi.bmiHeader.biWidth = outer.w;
    bmi.bmiHeader.biHeight = -outer.h;
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;
    let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
    let hbmp = unsafe {
        CreateDIBSection(
            memdc,
            &bmi,
            DIB_RGB_COLORS,
            &mut bits,
            std::ptr::null_mut(),
            0,
        )
    };
    if hbmp.is_null() || bits.is_null() {
        unsafe {
            DeleteDC(memdc);
        }
        return Err(err("error: active-border DIB failed"));
    }
    let stride = outer.w as usize * 4;
    let total = stride * outer.h as usize;
    let pixels = unsafe { std::slice::from_raw_parts_mut(bits as *mut u8, total) };
    let checksum = paint_ring(pixels, outer.w, outer.h, width_px, radius_px, color);
    let old = unsafe { SelectObject(memdc, hbmp) };
    let dst = POINT {
        x: outer.x,
        y: outer.y,
    };
    let size = SIZE {
        cx: outer.w,
        cy: outer.h,
    };
    let src = POINT { x: 0, y: 0 };
    let blend = BLENDFUNCTION {
        BlendOp: 0,
        BlendFlags: 0,
        SourceConstantAlpha: 255,
        AlphaFormat: AC_SRC_ALPHA as u8,
    };
    let presented = unsafe {
        UpdateLayeredWindow(
            hwnd_u64 as usize as HWND,
            std::ptr::null_mut(),
            &dst,
            &size,
            memdc,
            &src,
            0,
            &blend,
            ULW_ALPHA,
        )
    };
    unsafe {
        SelectObject(memdc, old);
        DeleteObject(hbmp);
        DeleteDC(memdc);
    }
    if presented == 0 {
        return Err(err("error: active-border present failed"));
    }
    // Target-relative anchor (not blindly permanent TOPMOST): above the
    // ordinary frame, topmost only while the target is topmost. Task
    // View/Alt+Tab interplay needs live evidence.
    place_overlay(hwnd_u64, outer, topmost, target_hwnd)?;
    Ok(checksum)
}

/// Fill a BGRA buffer with the ring: colour with full alpha on the ring,
/// fully transparent elsewhere. Returns the FNV-1a checksum over the owned
/// bytes in the same pass (no second buffer walk).
fn paint_ring(
    pixels: &mut [u8],
    w: i32,
    h: i32,
    width_px: i32,
    radius_px: i32,
    color: (u8, u8, u8),
) -> u64 {
    let (r, g, b) = color;
    let mut hash: u64 = 0xcbf29ce484222325;
    let mut mix = |byte: u8| {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    };
    for y in 0..h {
        for x in 0..w {
            let idx = (y as usize * w as usize + x as usize) * 4;
            let (bb, gg, rr, aa) = if ring_covers(x, y, w, h, width_px, radius_px) {
                (b, g, r, 255)
            } else {
                (0, 0, 0, 0)
            };
            pixels[idx] = bb;
            pixels[idx + 1] = gg;
            pixels[idx + 2] = rr;
            pixels[idx + 3] = aa;
            mix(bb);
            mix(gg);
            mix(rr);
            mix(aa);
        }
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accent_dirty_flag_is_sticky_until_consumed() {
        // WndProc broadcast path without a live window: marks coalesce into
        // one refresh, and consumption resets exactly once.
        assert!(!take_accent_dirty());
        mark_accent_dirty();
        mark_accent_dirty();
        assert!(take_accent_dirty());
        assert!(!take_accent_dirty());
    }
}
