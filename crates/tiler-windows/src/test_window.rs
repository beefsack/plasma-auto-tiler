use serde::Serialize;

use crate::model::ProcessIdentity;

pub const TEST_WINDOW_CLASS: &str = "PlasmaAutoTilerOwnedTest";
pub const TEST_WINDOW_PROP: &str = "PlasmaAutoTilerLifetime";
pub const TEST_WINDOW_X: i32 = 200;
pub const TEST_WINDOW_Y: i32 = 200;
pub const TEST_WINDOW_W: i32 = 640;
pub const TEST_WINDOW_H: i32 = 480;
pub const HELPER_DEFAULT_SECONDS: u64 = 180;
pub const HELPER_MAX_SECONDS: u64 = 600;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WindowSnapshot {
    pub hwnd: u64,
    pub process: ProcessIdentity,
    pub tag: String,
    pub visible: bool,
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SnapshotError {
    Absent(String),
    Failed(String),
}

impl std::fmt::Display for SnapshotError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Absent(msg) => write!(f, "refuse: {msg}"),
            Self::Failed(msg) => write!(f, "error: {msg}"),
        }
    }
}

impl std::error::Error for SnapshotError {}

#[must_use]
pub fn parse_hwnd(s: &str) -> Option<u64> {
    let t = s.trim();
    if let Some(hex) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        u64::from_str_radix(hex, 16).ok().filter(|v| *v != 0)
    } else {
        t.parse::<u64>().ok().filter(|v| *v != 0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelperRunOptions {
    pub receipt: std::path::PathBuf,
    pub seconds: u64,
}

pub fn parse_helper_run_args(args: &[String]) -> Result<HelperRunOptions, String> {
    let mut receipt: Option<std::path::PathBuf> = None;
    let mut seconds = HELPER_DEFAULT_SECONDS;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--receipt" => {
                i += 1;
                let v = args
                    .get(i)
                    .ok_or("usage: run --receipt PATH [--seconds N]")?;
                receipt = Some(std::path::PathBuf::from(v));
                i += 1;
            }
            "--seconds" => {
                i += 1;
                let v = args
                    .get(i)
                    .ok_or("usage: run --receipt PATH [--seconds N]")?;
                seconds = v
                    .parse::<u64>()
                    .map_err(|_| "usage: run --receipt PATH [--seconds N]")?;
                i += 1;
            }
            _ => return Err("usage: run --receipt PATH [--seconds N]".to_owned()),
        }
    }
    let receipt = receipt.ok_or("usage: run --receipt PATH [--seconds N]")?;
    if seconds == 0 || seconds > HELPER_MAX_SECONDS {
        return Err(format!("refuse: seconds must be 1..={HELPER_MAX_SECONDS}"));
    }
    Ok(HelperRunOptions { receipt, seconds })
}

#[cfg(windows)]
pub mod sys {
    use super::{
        HELPER_MAX_SECONDS, TEST_WINDOW_CLASS, TEST_WINDOW_H, TEST_WINDOW_PROP, TEST_WINDOW_W,
        TEST_WINDOW_X, TEST_WINDOW_Y, WindowSnapshot,
    };
    use crate::lifecycle::exe_paths_equal;
    use crate::model::ProcessIdentity;
    use crate::native::{
        HeldProcess, IdentityError, current_exe_path, current_identity, current_integrity_level,
        has_terminal_ancestor,
    };
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    type SResult<T> = Result<T, super::SnapshotError>;
    fn absent(msg: impl Into<String>) -> super::SnapshotError {
        super::SnapshotError::Absent(msg.into())
    }
    fn failed(msg: impl Into<String>) -> super::SnapshotError {
        super::SnapshotError::Failed(msg.into())
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain([0]).collect()
    }

    pub fn sibling_helper_exe() -> SResult<String> {
        let me = current_exe_path().map_err(|e| failed(format!("exe {e}")))?;
        let mut path = std::path::PathBuf::from(&me);
        path.pop();
        path.push("tiler-test-window.exe");
        Ok(path.to_string_lossy().into_owned())
    }

    fn medium_or_fail(pid: u32, held: &HeldProcess) -> SResult<()> {
        let rid = held.integrity().map_err(|e| match e {
            IdentityError::Absent => absent(format!("target pid={pid} absent")),
            other => failed(format!("target integrity {other}")),
        })?;
        if !crate::lifecycle::is_medium_rid(rid) {
            return Err(absent(format!("target integrity {rid} is not medium")));
        }
        Ok(())
    }

    fn no_terminal_or_fail(pid: u32) -> SResult<()> {
        match has_terminal_ancestor(pid) {
            Ok(true) => Err(absent(format!("target pid={pid} terminal-ancestor"))),
            Ok(false) => Ok(()),
            Err(IdentityError::Absent) => Err(absent(format!("target pid={pid} absent"))),
            Err(e) => Err(failed(format!("target ancestry {e}"))),
        }
    }

    fn class_of(hwnd: HWND) -> SResult<String> {
        let mut buf = [0u16; 256];
        let n = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        if n <= 0 {
            return Err(absent("unknown class"));
        }
        Ok(String::from_utf16_lossy(&buf[..n as usize]))
    }

    fn prop_tag(hwnd: HWND) -> SResult<String> {
        let name = wide(super::TEST_WINDOW_PROP);
        let v = unsafe { GetPropW(hwnd, name.as_ptr()) };
        if v.is_null() {
            return Err(absent("missing lifetime property"));
        }
        let token = v as usize as u64;
        if token == 0 {
            return Err(absent("zero lifetime property"));
        }
        Ok(format!("{token:016x}"))
    }

    fn rect_of(hwnd: HWND) -> SResult<(i32, i32, i32, i32)> {
        let mut r: RECT = unsafe { std::mem::zeroed() };
        let ok = unsafe { GetWindowRect(hwnd, &mut r) };
        if ok == 0 {
            return Err(failed("GetWindowRect failed"));
        }
        Ok((r.left, r.top, r.right, r.bottom))
    }

    pub fn query_owned(
        hwnd_u64: u64,
        expected_exe: &str,
        expected_sid: &str,
        expected_session: u32,
    ) -> SResult<WindowSnapshot> {
        if hwnd_u64 == 0 {
            return Err(absent("zero hwnd"));
        }
        let hwnd = hwnd_u64 as isize as HWND;
        if unsafe { IsWindow(hwnd) } == 0 {
            return Err(absent(format!("hwnd={hwnd_u64} absent")));
        }
        let mut pid: u32 = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut pid);
        }
        if pid == 0 {
            return Err(absent(format!("hwnd={hwnd_u64} no pid")));
        }
        let held = match HeldProcess::open(pid) {
            Ok(h) => h,
            Err(IdentityError::Absent) => return Err(absent(format!("pid={pid} absent"))),
            Err(e) => return Err(failed(format!("owner {e}"))),
        };
        let ident: ProcessIdentity = held.identity().map_err(|e| match e {
            IdentityError::Absent => absent(format!("pid={pid} absent")),
            other => failed(format!("owner {other}")),
        })?;
        if ident.pid != pid {
            return Err(absent("pid reuse"));
        }
        if ident.user_sid != expected_sid || ident.session_id != expected_session {
            return Err(absent("sid/session mismatch"));
        }
        if !exe_paths_equal(&ident.exe_path, expected_exe) {
            return Err(absent("peer exe mismatch"));
        }
        medium_or_fail(pid, &held)?;
        no_terminal_or_fail(pid)?;
        let class = class_of(hwnd)?;
        if class != super::TEST_WINDOW_CLASS {
            return Err(absent("class mismatch"));
        }
        // Ordinary window: no parent, no owner, not topmost.
        if !unsafe { GetParent(hwnd) }.is_null() {
            return Err(absent("parented"));
        }
        if !unsafe { GetWindow(hwnd, GW_OWNER) }.is_null() {
            return Err(absent("owned window"));
        }
        let ex = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32;
        if ex & WS_EX_TOPMOST != 0 {
            return Err(absent("topmost"));
        }
        let tag = prop_tag(hwnd)?;
        let visible = unsafe { IsWindowVisible(hwnd) } != 0;
        let (left, top, right, bottom) = rect_of(hwnd)?;
        Ok(WindowSnapshot {
            hwnd: hwnd_u64,
            process: ident,
            tag,
            visible,
            left,
            top,
            right,
            bottom,
        })
    }

    pub fn helper_precheck() -> SResult<ProcessIdentity> {
        let me = current_identity().map_err(|e| failed(format!("identity {e}")))?;
        let rid = current_integrity_level().map_err(|e| failed(format!("integrity {e}")))?;
        if !crate::lifecycle::is_medium_rid(rid) {
            return Err(absent(format!("integrity {rid} is not medium")));
        }
        match has_terminal_ancestor(me.pid) {
            Ok(true) => Err(absent("terminal-ancestor")),
            Ok(false) => Ok(me),
            Err(e) => Err(failed(format!("ancestry {e}"))),
        }
    }

    fn held_matches(pid: u32, expected: &ProcessIdentity) -> SResult<HeldProcess> {
        let held = match HeldProcess::open(pid) {
            Ok(h) => h,
            Err(IdentityError::Absent) => {
                return Err(absent(format!("helper pid={pid} absent")));
            }
            Err(e) => return Err(failed(format!("helper {e}"))),
        };
        let live: ProcessIdentity = held.identity().map_err(|e| match e {
            IdentityError::Absent => absent(format!("helper pid={pid} absent")),
            other => failed(format!("helper {other}")),
        })?;
        if live != *expected || !held.is_alive() {
            return Err(absent("helper identity changed"));
        }
        Ok(held)
    }

    pub fn close_owned(hwnd_u64: u64) -> SResult<String> {
        let me = current_identity().map_err(|e| failed(format!("identity {e}")))?;
        let snap = query_owned(hwnd_u64, &me.exe_path, &me.user_sid, me.session_id)?;
        let _held = held_matches(snap.process.pid, &snap.process)?;
        let fresh = query_owned(hwnd_u64, &me.exe_path, &me.user_sid, me.session_id)?;
        if fresh.process != snap.process || fresh.tag != snap.tag || fresh.hwnd != snap.hwnd {
            return Err(absent("helper identity changed"));
        }
        let ok = unsafe { PostMessageW(fresh.hwnd as isize as HWND, WM_CLOSE, 0, 0) };
        if ok == 0 {
            return Err(failed("PostMessage WM_CLOSE failed"));
        }
        Ok(serde_json::json!({"closed": fresh.hwnd, "tag": fresh.tag}).to_string())
    }

    pub fn inspect_owned(hwnd_u64: u64) -> SResult<String> {
        let me = current_identity().map_err(|e| failed(format!("identity {e}")))?;
        let snap = query_owned(hwnd_u64, &me.exe_path, &me.user_sid, me.session_id)?;
        serde_json::to_string(&snap).map_err(|e| failed(format!("json {e}")))
    }

    unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        match msg {
            WM_CLOSE | WM_TIMER => {
                unsafe { DestroyWindow(hwnd) };
                0
            }
            WM_DESTROY => {
                unsafe { PostQuitMessage(0) };
                0
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wp, lp) },
        }
    }

    fn write_receipt_atomic(receipt: &std::path::Path, json: &str) -> SResult<()> {
        let tmp = receipt.with_extension("json.tmp");
        {
            let mut opts = std::fs::OpenOptions::new();
            opts.write(true).create_new(true);
            let mut f = opts
                .open(&tmp)
                .map_err(|e| failed(format!("receipt open: {e}")))?;
            use std::io::Write;
            f.write_all(json.as_bytes())
                .map_err(|e| failed(format!("receipt write: {e}")))?;
            f.sync_all()
                .map_err(|e| failed(format!("receipt sync: {e}")))?;
        }
        if receipt.exists() {
            let _ = std::fs::remove_file(&tmp);
            return Err(absent("receipt preexists"));
        }
        std::fs::rename(&tmp, receipt).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            failed(format!("receipt rename: {e}"))
        })
    }

    pub fn run_owned_window(receipt: &std::path::Path, seconds: u64) -> SResult<String> {
        if seconds == 0 || seconds > HELPER_MAX_SECONDS {
            return Err(absent(format!("seconds must be 1..={HELPER_MAX_SECONDS}")));
        }
        let me = helper_precheck()?;
        let parent = receipt
            .parent()
            .ok_or_else(|| failed("receipt no parent"))?;
        if !parent.is_dir() {
            return Err(failed("receipt parent missing"));
        }
        if receipt.exists() {
            return Err(absent("receipt preexists"));
        }
        let class_w = wide(TEST_WINDOW_CLASS);
        let hinst = unsafe { GetModuleHandleW(std::ptr::null()) };
        let mut cls: WNDCLASSW = unsafe { std::mem::zeroed() };
        cls.lpfnWndProc = Some(wndproc);
        cls.hInstance = hinst;
        cls.lpszClassName = class_w.as_ptr();
        let atom = unsafe { RegisterClassW(&cls) };
        if atom == 0 {
            return Err(failed("RegisterClass failed"));
        }
        // Nonzero opaque lifetime token, fresh each creation.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(1);
        let token = if nanos == 0 { 1 } else { nanos };
        let title = wide("PlasmaAutoTiler owned test");
        let hwnd = unsafe {
            CreateWindowExW(
                0,
                class_w.as_ptr(),
                title.as_ptr(),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                TEST_WINDOW_X,
                TEST_WINDOW_Y,
                TEST_WINDOW_W,
                TEST_WINDOW_H,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                hinst,
                std::ptr::null_mut(),
            )
        };
        if hwnd.is_null() {
            return Err(failed("CreateWindow failed"));
        }
        let kill = || unsafe { DestroyWindow(hwnd) };
        let prop_w = wide(TEST_WINDOW_PROP);
        let ok = unsafe { SetPropW(hwnd, prop_w.as_ptr(), token as usize as _) };
        if ok == 0 {
            kill();
            return Err(failed("SetProp failed"));
        }
        unsafe {
            ShowWindow(hwnd, SW_SHOWNORMAL);
        }
        // Fresh readback for receipt bounds.
        let hwnd_u64 = hwnd as usize as u64;
        let snap =
            query_owned(hwnd_u64, &me.exe_path, &me.user_sid, me.session_id).inspect_err(|_| {
                kill();
            })?;
        if !snap.visible {
            kill();
            return Err(failed("window not visible after show"));
        }
        let json = serde_json::to_string(&snap).map_err(|e| {
            kill();
            failed(format!("json {e}"))
        })?;
        write_receipt_atomic(receipt, &json).inspect_err(|_| {
            kill();
        })?;
        let timer = unsafe { SetTimer(hwnd, 1, (seconds * 1000) as u32, None) };
        if timer == 0 {
            kill();
            return Err(failed("SetTimer failed"));
        }
        let mut msg: MSG = unsafe { std::mem::zeroed() };
        loop {
            let r = unsafe { GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) };
            if r == 0 {
                break;
            }
            if r == -1 {
                kill();
                return Err(failed("GetMessage failed"));
            }
            unsafe {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        Ok(json)
    }
}
