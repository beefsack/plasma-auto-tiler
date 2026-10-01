//! Product hiding and recovery: identity-safe `SW_HIDE` with nonactivating
//! reveal, commit-before-hide, and a same-executable crash watcher.
//!
//! Product claims use [`crate::model::PRODUCT_CLAIM_PROP`] plus
//! [`crate::model::WindowClaimKind::Product`], so helper proof gates never
//! mistake them for helper ownership. The full process tuple alone does not
//! protect same-process HWND reuse: every effect checks fresh HWND, live PID,
//! full process identity, and the window-lifetime nonce before and after,
//! committed to the ledger BEFORE hiding. The nonce leaves only after a
//! verified reveal or release. Missing/destroyed/recycled windows retire with
//! no writes; uncertain identities refuse and keep the residue.
//!
//! Actuation posts `ShowWindowAsync` (never blocks on a hung target) and
//! succeeds only after a pumped visibility readback observes the effect.

use crate::model::{ProcessIdentity, WindowClaimKind, WindowIdentity};

/// Shell classes that are never hide targets.
#[must_use]
pub fn shell_class_excluded(class: &str) -> bool {
    matches!(
        class,
        "Progman"
            | "WorkerW"
            | "Shell_TrayWnd"
            | "Shell_SecondaryTrayWnd"
            | "DV2ControlHost"
            | "MSCTFIME UI"
            | "SystemTray_Main"
    )
}

/// Generic dialog class: unowned top-level dialogs are never hide targets.
pub const DIALOG_CLASS: &str = "#32770";

/// Watcher readiness marker `watcher-<owner-creation>.ready`: three lines of
/// `owner-creation`, watcher pid, watcher creation. Readiness verifies the
/// live watcher process, never stale text alone.
#[must_use]
pub fn watcher_ready_filename(owner_creation: &str) -> String {
    format!("watcher-{owner_creation}.ready")
}

#[must_use]
pub fn render_watcher_ready(
    owner_creation: &str,
    watcher_pid: u32,
    watcher_creation: &str,
) -> String {
    format!("{owner_creation}\n{watcher_pid}\n{watcher_creation}\n")
}

#[must_use]
pub fn parse_watcher_ready(contents: &str) -> Option<(String, u32, String)> {
    let mut lines = contents.lines();
    let owner = lines.next()?.trim();
    let pid: u32 = lines.next()?.trim().parse().ok()?;
    let creation = lines.next()?.trim();
    if owner.is_empty() || creation.is_empty() || pid == 0 {
        return None;
    }
    Some((owner.to_owned(), pid, creation.to_owned()))
}

/// Visibility readback bound (ms) for one posted effect.
pub const HIDE_TIMEOUT_MS: u64 = 2000;
pub const REVEAL_TIMEOUT_MS: u64 = 2000;
pub const WATCHER_READY_TIMEOUT_MS: u64 = 5000;
pub const WATCHER_POLL_MS: u64 = 50;
pub const STORE_ACQUIRE_TIMEOUT_MS: u64 = 5000;

/// Per-window teardown outcome for one product claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProductTeardown {
    Revealed,
    AlreadyVisible,
    /// Verifiably gone or recycled: drop the claim with no window writes.
    Retired,
    /// Identity not established: keep the ledger residue, never touch.
    Uncertain,
}

#[must_use]
pub const fn teardown_keep_ledger(outcomes: &[ProductTeardown]) -> bool {
    let mut i = 0;
    while i < outcomes.len() {
        if matches!(outcomes[i], ProductTeardown::Uncertain) {
            return true;
        }
        i += 1;
    }
    false
}

#[must_use]
pub fn committed_has_same_claim(
    windows: &[crate::model::WindowIdentity],
    hwnd: u64,
    tag: &str,
) -> bool {
    windows
        .iter()
        .any(|w| w.hwnd == hwnd && w.tag == tag && w.kind == crate::model::WindowClaimKind::Product)
}

#[must_use]
pub fn product_claim(hwnd: u64, process: ProcessIdentity, tag: String) -> WindowIdentity {
    WindowIdentity {
        hwnd,
        process,
        tag,
        kind: WindowClaimKind::Product,
    }
}

#[cfg(windows)]
pub mod sys {
    use super::{
        HIDE_TIMEOUT_MS, REVEAL_TIMEOUT_MS, STORE_ACQUIRE_TIMEOUT_MS, WATCHER_POLL_MS,
        WATCHER_READY_TIMEOUT_MS, committed_has_same_claim, parse_watcher_ready,
        render_watcher_ready, watcher_ready_filename,
    };
    use crate::lifecycle::{exe_paths_equal, is_medium_rid};
    use crate::model::{
        PRODUCT_CLAIM_PROP, ProcessIdentity, WindowClaimKind, WindowIdentity, generate_claim_tag,
        valid_claim_tag, watcher_may_restore,
    };
    use crate::native::{HeldProcess, IdentityError, has_terminal_ancestor};
    use crate::storage::{LEDGER_FILE_NAME, LedgerStore};
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    type DynError = Box<dyn std::error::Error>;
    type Result<T> = std::result::Result<T, DynError>;

    fn err(msg: impl Into<String>) -> DynError {
        Box::new(std::io::Error::other(msg.into()))
    }

    fn store_err(e: crate::storage::StorageError) -> DynError {
        match e {
            crate::storage::StorageError::Ledger(_) => err("refuse: corrupt ledger"),
            crate::storage::StorageError::LockContended => {
                err("refuse: another owner holds the store")
            }
            crate::storage::StorageError::DifferentOwner => {
                err("refuse: ledger owner changed under lease")
            }
            crate::storage::StorageError::Io(io) => err(format!("error: ledger store: {io}")),
        }
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain([0]).collect()
    }

    fn prop_name() -> Vec<u16> {
        wide(PRODUCT_CLAIM_PROP)
    }

    /// Fresh read of the product nonce. `Ok(None)` means verifiably absent: a
    /// recycled HWND starts without it.
    fn get_nonce(
        hwnd: windows_sys::Win32::Foundation::HWND,
    ) -> std::result::Result<Option<String>, String> {
        use windows_sys::Win32::UI::WindowsAndMessaging::GetPropW;
        let name = prop_name();
        let v = unsafe { GetPropW(hwnd, name.as_ptr()) };
        if v.is_null() {
            return Ok(None);
        }
        let token = v as usize as u64;
        if token == 0 {
            return Ok(None);
        }
        Ok(Some(format!("{token:016x}")))
    }

    fn class_of(hwnd: windows_sys::Win32::Foundation::HWND) -> String {
        use windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW;
        let mut buf = [0u16; 256];
        let n = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        if n <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..n as usize])
    }

    pub struct ProductSnapshot {
        pub hwnd: u64,
        pub pid: u32,
        pub process: ProcessIdentity,
        pub nonce: Option<String>,
        pub visible: bool,
        pub iconic: bool,
        pub class: String,
    }

    /// Admission read: HWND liveness, live PID, full process identity, nonce,
    /// plus the hide exclusions (same session/SID medium, no terminal
    /// ancestor, no shell/parented/owned/tool/topmost/no-activate/dialog, no
    /// maximized or captionless fullscreen). Only visible, unclaimed windows
    /// pass the callers below.
    pub fn query_candidate(
        hwnd_u64: u64,
        owner: &ProcessIdentity,
    ) -> std::result::Result<ProductSnapshot, DynError> {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GW_OWNER, GWL_EXSTYLE, GetParent, GetWindow, GetWindowLongW, IsIconic, IsWindow,
            IsWindowVisible, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
        };
        if hwnd_u64 == 0 {
            return Err(err("refuse: zero hwnd"));
        }
        let hwnd = hwnd_u64 as isize as HWND;
        if unsafe { IsWindow(hwnd) } == 0 {
            return Err(err("absent: hwnd destroyed"));
        }
        let mut pid: u32 = 0;
        unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, &mut pid);
        }
        if pid == 0 {
            return Err(err("absent: hwnd no pid"));
        }
        if pid == owner.pid {
            return Err(err("refuse: self-owned"));
        }
        let held = match HeldProcess::open(pid) {
            Ok(h) => h,
            Err(IdentityError::Absent) => return Err(err("absent: target pid absent")),
            Err(e) => return Err(err(format!("error: target owner {e}"))),
        };
        let ident = match held.identity() {
            Ok(id) => id,
            Err(IdentityError::Absent) => return Err(err("absent: target pid absent")),
            Err(IdentityError::AccessDenied) => return Err(err("uncertain: target access-denied")),
            Err(e) => return Err(err(format!("error: target identity {e}"))),
        };
        if ident.pid != pid {
            return Err(err("absent: pid reuse"));
        }
        if ident.user_sid != owner.user_sid || ident.session_id != owner.session_id {
            return Err(err("refuse: sid/session mismatch"));
        }
        let rid = match held.integrity() {
            Ok(r) => r,
            Err(IdentityError::Absent) => return Err(err("absent: target pid absent")),
            Err(IdentityError::AccessDenied) => {
                return Err(err("uncertain: target integrity access-denied"));
            }
            Err(e) => return Err(err(format!("error: target integrity {e}"))),
        };
        if !is_medium_rid(rid) {
            return Err(err(format!("refuse: target integrity {rid} is not medium")));
        }
        match has_terminal_ancestor(pid) {
            Ok(true) => return Err(err("refuse: target terminal-ancestor")),
            Ok(false) => {}
            Err(IdentityError::Absent) => return Err(err("absent: target pid absent")),
            Err(e) => return Err(err(format!("error: target ancestry {e}"))),
        }
        let class = class_of(hwnd);
        if super::shell_class_excluded(&class) {
            return Err(err("refuse: shell window"));
        }
        if !unsafe { GetParent(hwnd) }.is_null() {
            return Err(err("refuse: parented"));
        }
        if !unsafe { GetWindow(hwnd, GW_OWNER) }.is_null() {
            return Err(err("refuse: owned dialog"));
        }
        let ex = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32;
        if ex & WS_EX_TOOLWINDOW != 0 {
            return Err(err("refuse: tool window"));
        }
        if ex & WS_EX_TOPMOST != 0 {
            return Err(err("refuse: topmost"));
        }
        if ex & WS_EX_NOACTIVATE != 0 {
            return Err(err("refuse: no-activate"));
        }
        if class == super::DIALOG_CLASS {
            return Err(err("refuse: dialog"));
        }
        {
            use windows_sys::Win32::UI::WindowsAndMessaging::{GWL_STYLE, IsZoomed, WS_CAPTION};
            if unsafe { IsZoomed(hwnd) } != 0 {
                return Err(err("refuse: fullscreen"));
            }
            let style = unsafe { GetWindowLongW(hwnd, GWL_STYLE) } as u32;
            if style & WS_CAPTION == 0 {
                return Err(err("refuse: borderless (possible fullscreen)"));
            }
        }
        let nonce = get_nonce(hwnd).map_err(|e| err(format!("error: nonce read {e}")))?;
        let visible = unsafe { IsWindowVisible(hwnd) } != 0;
        let iconic = unsafe { IsIconic(hwnd) } != 0;
        Ok(ProductSnapshot {
            hwnd: hwnd_u64,
            pid,
            process: ident,
            nonce,
            visible,
            iconic,
            class,
        })
    }

    /// Recovery read: HWND liveness, live PID, full process identity, nonce,
    /// visibility. No admission exclusions: a safely hidden window may change
    /// maximized, captionless, topmost, or owned state while hidden, and
    /// recovery reveals exact process plus nonce regardless. Unknown identity
    /// errors are uncertain, never absent.
    pub fn query_recovery(
        hwnd_u64: u64,
        owner: &ProcessIdentity,
    ) -> std::result::Result<ProductSnapshot, DynError> {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::WindowsAndMessaging::{IsIconic, IsWindow, IsWindowVisible};
        if hwnd_u64 == 0 {
            return Err(err("refuse: zero hwnd"));
        }
        let hwnd = hwnd_u64 as isize as HWND;
        if unsafe { IsWindow(hwnd) } == 0 {
            return Err(err("absent: hwnd destroyed"));
        }
        let mut pid: u32 = 0;
        unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, &mut pid);
        }
        if pid == 0 {
            return Err(err("absent: hwnd no pid"));
        }
        let held = match HeldProcess::open(pid) {
            Ok(h) => h,
            Err(IdentityError::Absent) => return Err(err("absent: target pid absent")),
            Err(IdentityError::AccessDenied) => {
                return Err(err("uncertain: target access-denied"));
            }
            Err(e) => return Err(err(format!("error: target owner {e}"))),
        };
        let ident = match held.identity() {
            Ok(id) => id,
            Err(IdentityError::Absent) => return Err(err("absent: target pid absent")),
            Err(IdentityError::AccessDenied) => return Err(err("uncertain: target access-denied")),
            Err(e) => return Err(err(format!("error: target identity {e}"))),
        };
        if ident.pid != pid {
            return Err(err("absent: pid reuse"));
        }
        if ident.user_sid != owner.user_sid || ident.session_id != owner.session_id {
            return Err(err("refuse: sid/session mismatch"));
        }
        let nonce = get_nonce(hwnd).map_err(|e| err(format!("error: nonce read {e}")))?;
        let visible = unsafe { IsWindowVisible(hwnd) } != 0;
        let iconic = unsafe { IsIconic(hwnd) } != 0;
        Ok(ProductSnapshot {
            hwnd: hwnd_u64,
            pid,
            process: ident,
            nonce,
            visible,
            iconic,
            class: String::new(),
        })
    }

    /// Install a fresh random nonzero window-lifetime nonce, then read it
    /// back. Only call after [`query_candidate`] admitted the window; the
    /// caller commits the returned tag BEFORE hiding.
    pub fn install_nonce(hwnd_u64: u64, owner_pid: u32) -> Result<String> {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::WindowsAndMessaging::SetPropW;
        let hwnd = hwnd_u64 as isize as HWND;
        for _ in 0..4 {
            let tag = generate_claim_tag(owner_pid);
            debug_assert!(valid_claim_tag(&tag));
            let token = u64::from_str_radix(&tag, 16).map_err(|_| err("error: nonce render"))?;
            if token == 0 {
                continue;
            }
            let name = prop_name();
            let ok = unsafe { SetPropW(hwnd, name.as_ptr(), token as usize as _) };
            if ok == 0 {
                return Err(err("error: SetProp failed"));
            }
            match get_nonce(hwnd).map_err(|e| err(format!("error: nonce readback {e}")))? {
                Some(back) if back == tag => return Ok(tag),
                _ => {
                    let _ = remove_nonce_inner(hwnd);
                    return Err(err("error: nonce readback mismatch"));
                }
            }
        }
        Err(err("error: nonce install failed"))
    }

    fn remove_nonce_inner(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
        use windows_sys::Win32::UI::WindowsAndMessaging::RemovePropW;
        let name = prop_name();
        !unsafe { RemovePropW(hwnd, name.as_ptr()) }.is_null()
            || get_nonce(hwnd).ok().flatten().is_none()
    }

    /// Remove the nonce only when the live tag still equals the claim. Returns
    /// `true` when verifiably absent afterwards, `false` when a different tag
    /// owns the window now (recycled: retire the claim, never touch the new
    /// owner).
    pub fn remove_nonce_checked(hwnd_u64: u64, expected_tag: &str) -> Result<bool> {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::WindowsAndMessaging::IsWindow;
        let hwnd = hwnd_u64 as isize as HWND;
        if unsafe { IsWindow(hwnd) } == 0 {
            return Ok(true);
        }
        let live = get_nonce(hwnd).map_err(|e| err(format!("error: nonce read {e}")))?;
        match live {
            None => Ok(true),
            Some(tag) if tag == expected_tag => {
                let _ = remove_nonce_inner(hwnd);
                match get_nonce(hwnd)
                    .map_err(|e| err(format!("error: nonce remove readback {e}")))?
                {
                    None => Ok(true),
                    Some(_) => Err(err("error: nonce remove failed")),
                }
            }
            Some(_) => Ok(false),
        }
    }

    fn pump_once() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, MSG, PM_REMOVE, PeekMessageW, TranslateMessage,
        };
        unsafe {
            let mut msg: MSG = std::mem::zeroed();
            while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    /// Post one visibility effect without blocking, then pump until the
    /// readback observes it. `ShowWindowAsync` queues behind earlier posts so
    /// hide/show ordering per window is preserved, a hung target cannot wedge
    /// the caller, and no orphan setter thread outlives the call. Success
    /// requires the observed effect, never the post alone.
    fn post_visibility(
        hwnd_u64: u64,
        cmd: i32,
        expect_visible: bool,
        timeout_ms: u64,
    ) -> Result<()> {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            IsWindow, IsWindowVisible, ShowWindowAsync,
        };
        let hwnd = hwnd_u64 as isize as HWND;
        if unsafe { ShowWindowAsync(hwnd, cmd) } == 0 {
            return Err(err("error: visibility post failed"));
        }
        let start = Instant::now();
        let budget = Duration::from_millis(timeout_ms);
        loop {
            pump_once();
            if unsafe { IsWindow(hwnd) } == 0 {
                return Err(err("absent: hwnd destroyed"));
            }
            if (unsafe { IsWindowVisible(hwnd) } != 0) == expect_visible {
                return Ok(());
            }
            if start.elapsed() >= budget {
                return Err(err("uncertain: visibility not observed"));
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn hold_target_verified(pid: u32, expected: &ProcessIdentity) -> Result<HeldProcess> {
        let held = match HeldProcess::open(pid) {
            Ok(h) => h,
            Err(IdentityError::Absent) => return Err(err("absent: target pid absent")),
            Err(e) => return Err(err(format!("error: target held {e}"))),
        };
        let live = match held.identity() {
            Ok(l) => l,
            Err(IdentityError::Absent) => return Err(err("absent: target pid absent")),
            Err(e) => return Err(err(format!("error: target identity {e}"))),
        };
        if live != *expected || !held.is_alive() {
            return Err(err("absent: target identity changed (recycled)"));
        }
        Ok(held)
    }

    fn pid_current(hwnd_u64: u64, pid: u32) -> bool {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
        let mut current: u32 = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd_u64 as isize as HWND, &mut current);
        }
        current != 0 && current == pid
    }

    pub fn admit_product_target(hwnd_u64: u64, owner: &ProcessIdentity) -> Result<WindowIdentity> {
        let snap = query_candidate(hwnd_u64, owner)?;
        if !snap.visible || snap.iconic {
            return Err(err("refuse: target not visible"));
        }
        if snap.nonce.is_some() {
            return Err(err("refuse: target already claimed"));
        }
        let _held = hold_target_verified(snap.pid, &snap.process)?;
        let tag = install_nonce(hwnd_u64, owner.pid)?;
        let back = query_candidate(hwnd_u64, owner)?;
        if back.pid != snap.pid
            || back.process != snap.process
            || back.nonce.as_deref() != Some(tag.as_str())
            || !back.visible
        {
            let _ = remove_nonce_checked(hwnd_u64, &tag);
            return Err(err("refuse: admit readback mismatch"));
        }
        if !pid_current(hwnd_u64, snap.pid) {
            let _ = remove_nonce_checked(hwnd_u64, &tag);
            return Err(err("refuse: admit pid changed"));
        }
        Ok(crate::model::WindowIdentity {
            hwnd: hwnd_u64,
            process: snap.process,
            tag,
            kind: WindowClaimKind::Product,
        })
    }

    /// Best-effort orphan cleanup for an admitted-but-uncommitted nonce.
    /// Removes the window-lifetime nonce ONLY when the fresh committed ledger
    /// proves no same HWND+tag product claim exists AND the live window still
    /// carries the full expected process plus the exact nonce. Any ledger
    /// with the same claim, any unreadable ledger, or any process/nonce
    /// mismatch retains the residue. Never fails: the caller's error stands.
    fn maybe_cleanup_orphan(store: &LedgerStore, owner: &ProcessIdentity, claim: &WindowIdentity) {
        let committed = match store.committed() {
            Ok(Some(record)) => record,
            // Unreadable or absent ledger: retain, never touch the window.
            _ => return,
        };
        if committed.owner != *owner {
            return;
        }
        if committed_has_same_claim(&committed.windows, claim.hwnd, &claim.tag) {
            return;
        }
        let snap = match query_recovery(claim.hwnd, owner) {
            Ok(s) => s,
            // Destroyed/recycled/absent: nonce is gone or not ours.
            Err(_) => return,
        };
        if snap.pid != claim.process.pid
            || snap.process != claim.process
            || snap.nonce.as_deref() != Some(claim.tag.as_str())
        {
            return;
        }
        let _ = remove_nonce_checked(claim.hwnd, &claim.tag);
    }

    pub fn hide_committed_product(
        store: &LedgerStore,
        owner: &ProcessIdentity,
        claim: &WindowIdentity,
        dir: &Path,
    ) -> Result<()> {
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;
        if claim.kind != WindowClaimKind::Product {
            return Err(err("refuse: not a product claim"));
        }
        if !valid_claim_tag(&claim.tag) {
            return Err(err("refuse: bad product tag"));
        }
        if let Err(e) = verify_watcher_ready(dir, owner) {
            maybe_cleanup_orphan(store, owner, claim);
            return Err(e);
        }
        let pre = match query_candidate(claim.hwnd, owner) {
            Ok(s) => s,
            Err(e) => {
                maybe_cleanup_orphan(store, owner, claim);
                return Err(e);
            }
        };
        if pre.pid != claim.process.pid
            || pre.process != claim.process
            || pre.nonce.as_deref() != Some(claim.tag.as_str())
            || !pre.visible
        {
            maybe_cleanup_orphan(store, owner, claim);
            return Err(err("refuse: hide pre-readback mismatch"));
        }
        let held = match hold_target_verified(pre.pid, &pre.process) {
            Ok(h) => h,
            Err(e) => {
                maybe_cleanup_orphan(store, owner, claim);
                return Err(e);
            }
        };
        if let Err(e) = append_product_claim(store, owner, claim) {
            maybe_cleanup_orphan(store, owner, claim);
            return Err(e);
        }
        let _ = &held;
        match post_visibility(claim.hwnd, SW_HIDE, false, HIDE_TIMEOUT_MS) {
            Ok(()) => {}
            Err(e) if e.to_string().starts_with("absent:") => {
                let _ = remove_product_note(store, owner, claim.hwnd);
                return Err(e);
            }
            Err(e) => return Err(e),
        }
        if !held.is_alive() || !pid_current(claim.hwnd, pre.pid) {
            return Err(err("uncertain: hide post-pid changed"));
        }
        let back = query_recovery(claim.hwnd, owner)?;
        if back.pid != claim.process.pid
            || back.process != claim.process
            || back.nonce.as_deref() != Some(claim.tag.as_str())
            || back.visible
        {
            return Err(err("uncertain: hide readback mismatch (kept ledger)"));
        }
        Ok(())
    }

    fn commit_windows(
        store: &LedgerStore,
        owner: &ProcessIdentity,
        windows: Vec<WindowIdentity>,
    ) -> Result<()> {
        let committed = store.committed().map_err(store_err)?;
        let Some(existing) = committed else {
            return Err(err("refuse: ledger missing under owner lease"));
        };
        if existing.owner != *owner {
            return Err(err("refuse: ledger owner changed under lease"));
        }
        store
            .commit(&crate::model::RecoveryLedger {
                v: crate::model::LEDGER_SCHEMA_VERSION,
                owner: owner.clone(),
                windows,
                mouse_snap: existing.mouse_snap,
            })
            .map_err(store_err)
    }

    fn append_product_claim(
        store: &LedgerStore,
        owner: &ProcessIdentity,
        claim: &WindowIdentity,
    ) -> Result<()> {
        let committed = store.committed().map_err(store_err)?;
        let Some(existing) = committed else {
            return Err(err("refuse: ledger missing under owner lease"));
        };
        if existing.owner != *owner {
            return Err(err("refuse: ledger owner changed under lease"));
        }
        if existing.windows.iter().any(|w| w.hwnd == claim.hwnd) {
            return Err(err("refuse: duplicate product hwnd"));
        }
        let mut windows = existing.windows;
        windows.push(claim.clone());
        commit_windows(store, owner, windows)
    }

    pub fn reveal_product_claim(
        store: &LedgerStore,
        owner: &ProcessIdentity,
        claim: &WindowIdentity,
    ) -> std::result::Result<super::ProductTeardown, DynError> {
        use super::ProductTeardown;
        use windows_sys::Win32::UI::WindowsAndMessaging::{IsWindow, SW_SHOWNA};
        if claim.kind != WindowClaimKind::Product {
            return Err(err("refuse: not a product claim"));
        }
        let hwnd = claim.hwnd;
        if unsafe { IsWindow(hwnd as isize as _) } == 0 {
            remove_product_note(store, owner, hwnd)?;
            return Ok(ProductTeardown::Retired);
        }
        let snap = match query_recovery(hwnd, owner) {
            Ok(s) => s,
            Err(e) => {
                let msg = e.to_string();
                if msg.starts_with("absent:") {
                    remove_product_note(store, owner, hwnd)?;
                    return Ok(ProductTeardown::Retired);
                }
                if msg.contains("sid/session mismatch") {
                    remove_product_note(store, owner, hwnd)?;
                    return Ok(ProductTeardown::Retired);
                }
                return Err(err(format!("uncertain: reveal pre-read {msg}")));
            }
        };
        if snap.process != claim.process || snap.nonce.as_deref() != Some(claim.tag.as_str()) {
            remove_product_note(store, owner, hwnd)?;
            return Ok(ProductTeardown::Retired);
        }
        if snap.visible {
            remove_nonce_checked(hwnd, &claim.tag)?;
            remove_product_note(store, owner, hwnd)?;
            return Ok(ProductTeardown::AlreadyVisible);
        }
        let held = match hold_target_verified(snap.pid, &snap.process) {
            Ok(h) => h,
            Err(e) if e.to_string().starts_with("absent:") => {
                remove_product_note(store, owner, hwnd)?;
                return Ok(ProductTeardown::Retired);
            }
            Err(e) => return Err(err(format!("uncertain: reveal held {e}"))),
        };
        match post_visibility(hwnd, SW_SHOWNA, true, REVEAL_TIMEOUT_MS) {
            Ok(()) => {}
            Err(e) if e.to_string().starts_with("absent:") => {
                remove_product_note(store, owner, hwnd)?;
                return Ok(ProductTeardown::Retired);
            }
            Err(e) => return Err(e),
        }
        let _ = &held;
        if !held.is_alive() || !pid_current(hwnd, snap.pid) {
            return Err(err("uncertain: reveal post-pid changed"));
        }
        let back = query_recovery(hwnd, owner)
            .map_err(|e| err(format!("uncertain: reveal readback {e}")))?;
        if back.process != claim.process
            || back.nonce.as_deref() != Some(claim.tag.as_str())
            || !back.visible
        {
            return Err(err("uncertain: reveal readback mismatch (kept ledger)"));
        }
        remove_nonce_checked(hwnd, &claim.tag)?;
        remove_product_note(store, owner, hwnd)?;
        Ok(ProductTeardown::Revealed)
    }

    fn remove_product_note(store: &LedgerStore, owner: &ProcessIdentity, hwnd: u64) -> Result<()> {
        let committed = store.committed().map_err(store_err)?;
        let Some(existing) = committed else {
            return Ok(());
        };
        if existing.owner != *owner {
            return Err(err("refuse: ledger owner changed under lease"));
        }
        commit_windows(
            store,
            owner,
            existing
                .windows
                .into_iter()
                .filter(|w| w.hwnd != hwnd)
                .collect(),
        )
    }

    pub fn reveal_all_product(
        store: &LedgerStore,
        owner: &ProcessIdentity,
    ) -> (Vec<super::ProductTeardown>, Vec<WindowIdentity>) {
        let claims: Vec<WindowIdentity> = store
            .committed()
            .ok()
            .flatten()
            .map(|r| {
                r.windows
                    .into_iter()
                    .filter(|w| w.kind == WindowClaimKind::Product)
                    .collect()
            })
            .unwrap_or_default();
        let mut outcomes = Vec::new();
        let mut uncertain = Vec::new();
        for claim in &claims {
            match reveal_product_claim(store, owner, claim) {
                Ok(o) => outcomes.push(o),
                Err(_) => {
                    outcomes.push(super::ProductTeardown::Uncertain);
                    uncertain.push(claim.clone());
                }
            }
        }
        (outcomes, uncertain)
    }

    pub fn watcher_ready_path(dir: &Path, owner_creation: &str) -> PathBuf {
        dir.join(watcher_ready_filename(owner_creation))
    }

    /// Start the same-executable watcher bound to the exact owner and wait
    /// until its live identity verifies. Call before the first product hide.
    pub fn spawn_watcher(owner: &ProcessIdentity, dir: &Path) -> Result<std::process::Child> {
        match HeldProcess::open(owner.pid) {
            Ok(_) => {}
            Err(e) => return Err(err(format!("refuse: owner absent at watcher spawn {e}"))),
        }
        let exe_path =
            crate::native::current_exe_path().map_err(|e| err(format!("error: exe {e}")))?;
        let mut child = std::process::Command::new(&exe_path)
            .arg("watch-owner")
            .arg("--pid")
            .arg(owner.pid.to_string())
            .arg("--creation")
            .arg(owner.process_creation.clone())
            .spawn()
            .map_err(|e| err(format!("error: watcher spawn {e}")))?;
        let start = Instant::now();
        loop {
            match verify_watcher_ready(dir, owner) {
                Ok(()) => break,
                Err(e) if e.to_string().starts_with("refuse:") => {}
                Err(e) => {
                    let _ = child.kill();
                    return Err(e);
                }
            }
            if let Ok(Some(status)) = child
                .try_wait()
                .map_err(|e| err(format!("error: watcher wait {e}")))
            {
                return Err(err(format!("error: watcher exited early {status}")));
            }
            if start.elapsed() > Duration::from_millis(WATCHER_READY_TIMEOUT_MS) {
                let _ = child.kill();
                return Err(err("error: watcher readiness timeout"));
            }
            std::thread::sleep(Duration::from_millis(WATCHER_POLL_MS));
        }
        Ok(child)
    }

    /// Verify the live watcher: marker parses, owner creation matches, the
    /// watcher pid is alive with the recorded creation, same exe/SID/session,
    /// and medium integrity. Stale text alone never passes.
    pub fn verify_watcher_ready(dir: &Path, owner: &ProcessIdentity) -> Result<()> {
        let not_ready = || err("refuse: recovery watcher not ready");
        let text = match std::fs::read_to_string(watcher_ready_path(dir, &owner.process_creation)) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(not_ready()),
            Err(e) => return Err(err(format!("error: watcher ready read: {e}"))),
        };
        let Some((creation, watcher_pid, watcher_creation)) = parse_watcher_ready(&text) else {
            return Err(not_ready());
        };
        if creation != owner.process_creation || watcher_pid == owner.pid {
            return Err(not_ready());
        }
        let held = match HeldProcess::open(watcher_pid) {
            Ok(h) => h,
            Err(_) => return Err(not_ready()),
        };
        let live = match held.identity() {
            Ok(l) => l,
            Err(_) => return Err(not_ready()),
        };
        if live.process_creation != watcher_creation || !held.is_alive() {
            return Err(not_ready());
        }
        if !exe_paths_equal(&live.exe_path, &owner.exe_path)
            || live.user_sid != owner.user_sid
            || live.session_id != owner.session_id
        {
            return Err(not_ready());
        }
        match held.integrity() {
            Ok(rid) if is_medium_rid(rid) => Ok(()),
            Ok(_) => Err(not_ready()),
            Err(_) => Err(not_ready()),
        }
    }

    pub fn stop_watcher(child: &mut std::process::Child, dir: &Path, owner_creation: &str) {
        let _ = child.kill();
        let start = Instant::now();
        while start.elapsed() < Duration::from_millis(2000) {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => std::thread::sleep(Duration::from_millis(25)),
                Err(_) => break,
            }
        }
        let _ = std::fs::remove_file(watcher_ready_path(dir, owner_creation));
    }

    fn peek_ledger(dir: &Path) -> Result<Option<crate::model::RecoveryLedger>> {
        match std::fs::read(dir.join(LEDGER_FILE_NAME)) {
            Ok(bytes) => {
                let text =
                    std::str::from_utf8(&bytes).map_err(|_| err("refuse: corrupt ledger"))?;
                crate::model::parse_ledger(text)
                    .map(Some)
                    .map_err(|_| err("refuse: corrupt ledger"))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(err(format!("error: ledger read: {e}"))),
        }
    }

    /// Retry the lease until obtained or the ledger is verifiably gone or
    /// replaced, then restore under that same lease. Contention never reports
    /// handled success: exhaustion preserves the failure for the next reclaim.
    fn watcher_restore(expected: &ProcessIdentity) -> Result<String> {
        let dir = crate::native::ledger_directory()
            .map_err(|e| err(format!("error: ledger dir: {e}")))?;
        let start = Instant::now();
        loop {
            match LedgerStore::open(&dir) {
                Ok(store) => {
                    match crate::lifecycle::sys::restore_under_lease(&store, Some(expected)) {
                        Ok((windows, _)) => {
                            let _ = std::fs::remove_file(watcher_ready_path(
                                &dir,
                                &expected.process_creation,
                            ));
                            return Ok(serde_json::json!({
                                "watched": true, "outcome": "restored", "windows": windows,
                            })
                            .to_string());
                        }
                        Err(e) if e.to_string() == "refuse: owner-replaced" => {
                            return Ok(serde_json::json!({
                                "watched": false, "outcome": "owner-replaced",
                            })
                            .to_string());
                        }
                        Err(e) => return Err(e),
                    }
                }
                Err(crate::storage::StorageError::LockContended) => match peek_ledger(&dir)? {
                    None => {
                        let _ = std::fs::remove_file(watcher_ready_path(
                            &dir,
                            &expected.process_creation,
                        ));
                        return Ok(serde_json::json!({"watched": true, "outcome": "no-ledger"})
                            .to_string());
                    }
                    Some(record) if !watcher_may_restore(expected, &record.owner) => {
                        return Ok(serde_json::json!({
                            "watched": false, "outcome": "owner-replaced",
                        })
                        .to_string());
                    }
                    Some(_) => {
                        if start.elapsed() > Duration::from_millis(STORE_ACQUIRE_TIMEOUT_MS) {
                            return Err(err("error: watcher store contended"));
                        }
                        std::thread::sleep(Duration::from_millis(WATCHER_POLL_MS));
                    }
                },
                Err(e) => return Err(store_err(e)),
            }
        }
    }

    /// Watcher entry: `tiler-windows watch-owner --pid PID --creation HEX`.
    /// Binds the exact owner, publishes readiness, waits on the held owner
    /// handle, then restores. Never touches a replacement owner's ledger.
    pub fn cmd_watch_owner(pid: u32, creation: &str) -> Result<String> {
        if pid == 0 || creation.is_empty() {
            return Err(err("usage: watch-owner --pid PID --creation HEX"));
        }
        let dir = crate::native::ledger_directory()
            .map_err(|e| err(format!("error: ledger dir: {e}")))?;
        let me = crate::native::current_identity().map_err(|e| err(format!("error: exe {e}")))?;
        let (held_opt, captured): (Option<HeldProcess>, Option<ProcessIdentity>) =
            match HeldProcess::open(pid) {
                Ok(h) => match h.identity() {
                    Ok(live) if live.process_creation == creation => {
                        let snapshot = live.clone();
                        (Some(h), Some(snapshot))
                    }
                    Ok(_) => (None, None),
                    Err(IdentityError::Absent) => (None, None),
                    Err(e) => return Err(err(format!("error: owner bind {e}"))),
                },
                Err(IdentityError::Absent) => (None, None),
                Err(e) => return Err(err(format!("error: owner bind {e}"))),
            };
        std::fs::write(
            watcher_ready_path(&dir, creation),
            render_watcher_ready(creation, me.pid, &me.process_creation),
        )
        .map_err(|e| err(format!("error: watcher ready write: {e}")))?;
        if let Some(held) = held_opt {
            held.wait(u32::MAX);
        }
        let expected = match captured {
            Some(full) => full,
            None => match peek_ledger(&dir)? {
                Some(record)
                    if record.owner.pid == pid && record.owner.process_creation == creation =>
                {
                    record.owner
                }
                _ => {
                    return Ok(serde_json::json!({
                        "watched": false, "outcome": "owner-replaced",
                    })
                    .to_string());
                }
            },
        };
        watcher_restore(&expected)
    }

    /// Restore dead-owner residue before a new product owner starts. Unknown
    /// identity errors propagate (never treated as absent); contention without
    /// a restore reports no work so the guarded refusal below still applies.
    pub fn reclaim_dead_residue() -> Result<bool> {
        let dir = crate::native::ledger_directory()
            .map_err(|e| err(format!("error: ledger dir: {e}")))?;
        if !dir.exists() {
            return Ok(false);
        }
        let record = match peek_ledger(&dir)? {
            Some(r) => r,
            None => return Ok(false),
        };
        let me =
            crate::native::current_identity().map_err(|e| err(format!("error: identity {e}")))?;
        if me.user_sid != record.owner.user_sid || me.session_id != record.owner.session_id {
            return Ok(false);
        }
        if !exe_paths_equal(&me.exe_path, &record.owner.exe_path) {
            return Ok(false);
        }
        let dead = match HeldProcess::open(record.owner.pid) {
            Ok(held) => match held.identity() {
                Ok(live) => live != record.owner || !held.is_alive(),
                Err(IdentityError::Absent) => true,
                Err(e) => return Err(err(format!("error: owner bind {e}"))),
            },
            Err(IdentityError::Absent) => true,
            Err(e) => return Err(err(format!("error: owner bind {e}"))),
        };
        if !dead {
            return Ok(false);
        }
        match crate::lifecycle::sys::cmd_restore() {
            Ok(_) => Ok(true),
            Err(e) if e.to_string().contains("another owner holds the store") => Ok(false),
            Err(e) => Err(e),
        }
    }
}
