use crate::model::ProcessIdentity;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, HANDLE, LocalFree, WAIT_FAILED, WAIT_OBJECT_0,
};
use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows_sys::Win32::Security::{
    GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TOKEN_MANDATORY_LABEL,
    TOKEN_QUERY, TOKEN_USER, TokenIntegrityLevel, TokenUser,
};
use windows_sys::Win32::System::Com::CoTaskMemFree;
use windows_sys::Win32::System::RemoteDesktop::ProcessIdToSessionId;
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, GetProcessTimes, OpenProcess, OpenProcessToken,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
    QueryFullProcessImageNameW, TerminateProcess, WaitForSingleObject,
};
use windows_sys::Win32::UI::Shell::{FOLDERID_LocalAppData, SHGetKnownFolderPath};
use windows_sys::core::PWSTR;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityError {
    Absent,
    AccessDenied,
    Win32(u32),
}

impl std::fmt::Display for IdentityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Absent => f.write_str("absent"),
            Self::AccessDenied => f.write_str("access-denied"),
            Self::Win32(code) => write!(f, "win32-{code}"),
        }
    }
}

impl std::error::Error for IdentityError {}

struct Handle(HANDLE);

impl Handle {
    fn get(&self) -> HANDLE {
        self.0
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

fn last_error() -> u32 {
    unsafe { GetLastError() }
}

fn map_open_error(code: u32) -> IdentityError {
    match code {
        5 => IdentityError::AccessDenied,
        // OpenProcess reports a bad/nonexistent pid as invalid parameter.
        2 | 87 => IdentityError::Absent,
        other => IdentityError::Win32(other),
    }
}

fn open_process_token(process: HANDLE) -> Result<Handle, IdentityError> {
    let mut token: HANDLE = std::ptr::null_mut();
    let ok = unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) };
    if ok == 0 {
        let code = last_error();
        if code == 5 {
            return Err(IdentityError::AccessDenied);
        }
        return Err(IdentityError::Win32(code));
    }
    Ok(Handle(token))
}

fn token_info(class: i32, token: HANDLE) -> Result<Vec<u8>, IdentityError> {
    let mut needed: u32 = 0;
    unsafe {
        GetTokenInformation(token, class, std::ptr::null_mut(), 0, &mut needed);
    }
    if needed == 0 {
        return Err(IdentityError::Win32(last_error()));
    }
    let mut buf = vec![0u8; needed as usize];
    let mut returned: u32 = 0;
    let ok = unsafe {
        GetTokenInformation(token, class, buf.as_mut_ptr().cast(), needed, &mut returned)
    };
    if ok == 0 {
        let code = last_error();
        if code == 5 {
            return Err(IdentityError::AccessDenied);
        }
        return Err(IdentityError::Win32(code));
    }
    Ok(buf)
}

fn wide_len(ptr: PWSTR) -> usize {
    let mut len = 0;
    unsafe {
        while *ptr.add(len) != 0 {
            len += 1;
        }
    }
    len
}

fn sid_to_string(sid: *mut std::ffi::c_void) -> Result<String, IdentityError> {
    let mut out: PWSTR = std::ptr::null_mut();
    let ok = unsafe { ConvertSidToStringSidW(sid, &mut out) };
    if ok == 0 || out.is_null() {
        return Err(IdentityError::Win32(last_error()));
    }
    let len = wide_len(out);
    let text = unsafe { std::slice::from_raw_parts(out, len) };
    let sid = String::from_utf16_lossy(text);
    unsafe {
        LocalFree(out.cast());
    }
    Ok(sid)
}

fn creation_string(process: HANDLE) -> Result<String, IdentityError> {
    let mut creation = std::mem::MaybeUninit::zeroed();
    let mut exit = std::mem::MaybeUninit::zeroed();
    let mut kernel = std::mem::MaybeUninit::zeroed();
    let mut user = std::mem::MaybeUninit::zeroed();
    let ok = unsafe {
        GetProcessTimes(
            process,
            creation.as_mut_ptr(),
            exit.as_mut_ptr(),
            kernel.as_mut_ptr(),
            user.as_mut_ptr(),
        )
    };
    if ok == 0 {
        return Err(IdentityError::Win32(last_error()));
    }
    let creation = unsafe { creation.assume_init() };
    let combined = (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
    Ok(format!("{combined:016x}"))
}

fn image_path(process: HANDLE) -> Result<String, IdentityError> {
    let mut buf = vec![0u16; 32_768];
    let mut size = buf.len() as u32;
    let ok = unsafe {
        QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut size)
    };
    if ok == 0 {
        let code = last_error();
        if code == 5 {
            return Err(IdentityError::AccessDenied);
        }
        return Err(IdentityError::Win32(code));
    }
    Ok(String::from_utf16_lossy(&buf[..size as usize]))
}

fn user_sid(process: HANDLE) -> Result<String, IdentityError> {
    let token = open_process_token(process)?;
    let buf = token_info(TokenUser, token.get())?;
    if buf.len() < std::mem::size_of::<TOKEN_USER>() {
        return Err(IdentityError::Win32(24));
    }
    let user = unsafe { buf.as_ptr().cast::<TOKEN_USER>().read_unaligned() };
    sid_to_string(user.User.Sid)
}

fn session_of(pid: u32) -> Result<u32, IdentityError> {
    let mut session: u32 = 0;
    let ok = unsafe { ProcessIdToSessionId(pid, &mut session) };
    if ok == 0 {
        let code = last_error();
        if code == 5 {
            return Err(IdentityError::AccessDenied);
        }
        // Nonexistent pid surfaces as invalid parameter here as well.
        if code == 87 {
            return Err(IdentityError::Absent);
        }
        return Err(IdentityError::Win32(code));
    }
    Ok(session)
}

fn integrity_of_token(token: HANDLE) -> Result<u32, IdentityError> {
    let buf = token_info(TokenIntegrityLevel, token)?;
    if buf.len() < std::mem::size_of::<TOKEN_MANDATORY_LABEL>() {
        return Err(IdentityError::Win32(24));
    }
    let label = unsafe {
        buf.as_ptr()
            .cast::<TOKEN_MANDATORY_LABEL>()
            .read_unaligned()
    };
    let sid = label.Label.Sid;
    if sid.is_null() {
        return Err(IdentityError::Win32(87));
    }
    let count = unsafe { *GetSidSubAuthorityCount(sid) };
    if count == 0 {
        return Err(IdentityError::Win32(87));
    }
    let rid = unsafe { *GetSidSubAuthority(sid, u32::from(count) - 1) };
    Ok(rid)
}

pub fn query_identity(pid: u32) -> Result<ProcessIdentity, IdentityError> {
    // Single open+liveness path shared with HeldProcess.
    HeldProcess::open(pid)?.identity()
}

pub fn current_identity() -> Result<ProcessIdentity, IdentityError> {
    query_identity(unsafe { GetCurrentProcessId() })
}

pub fn query_integrity_level(pid: u32) -> Result<u32, IdentityError> {
    HeldProcess::open(pid)?.integrity()
}

pub fn current_integrity_level() -> Result<u32, IdentityError> {
    let mut token: HANDLE = std::ptr::null_mut();
    let ok = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) };
    if ok == 0 {
        return Err(IdentityError::Win32(last_error()));
    }
    let token = Handle(token);
    integrity_of_token(token.get())
}

pub fn ledger_directory() -> Result<PathBuf, IdentityError> {
    let mut out: PWSTR = std::ptr::null_mut();
    let hr =
        unsafe { SHGetKnownFolderPath(&FOLDERID_LocalAppData, 0, std::ptr::null_mut(), &mut out) };
    if hr != 0 || out.is_null() {
        return Err(IdentityError::Win32(hr as u32));
    }
    let len = wide_len(out);
    let text = unsafe { std::slice::from_raw_parts(out, len) };
    let base = std::ffi::OsString::from_wide(text);
    unsafe {
        CoTaskMemFree(out.cast());
    }
    let session = session_of(unsafe { GetCurrentProcessId() })?;
    Ok(PathBuf::from(base)
        .join("plasma-auto-tiler")
        .join(format!("session-{session}")))
}

pub struct HeldProcess {
    inner: Handle,
    pid: u32,
}

impl HeldProcess {
    fn open_with(pid: u32, access: u32) -> Result<Self, IdentityError> {
        let handle = unsafe { OpenProcess(access, 0, pid) };
        if handle.is_null() {
            return Err(map_open_error(last_error()));
        }
        let inner = Handle(handle);
        let wait = unsafe { WaitForSingleObject(inner.get(), 0) };
        if wait == WAIT_OBJECT_0 {
            return Err(IdentityError::Absent);
        }
        if wait == WAIT_FAILED {
            return Err(IdentityError::Win32(last_error()));
        }
        Ok(Self { inner, pid })
    }

    pub fn open(pid: u32) -> Result<Self, IdentityError> {
        Self::open_with(pid, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE)
    }

    pub fn open_terminate(pid: u32) -> Result<Self, IdentityError> {
        Self::open_with(
            pid,
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE | PROCESS_TERMINATE,
        )
    }

    pub fn identity(&self) -> Result<ProcessIdentity, IdentityError> {
        Ok(ProcessIdentity {
            pid: self.pid,
            process_creation: creation_string(self.inner.get())?,
            user_sid: user_sid(self.inner.get())?,
            session_id: session_of(self.pid)?,
            exe_path: image_path(self.inner.get())?,
        })
    }

    pub fn integrity(&self) -> Result<u32, IdentityError> {
        let token = open_process_token(self.inner.get())?;
        integrity_of_token(token.get())
    }

    pub fn is_alive(&self) -> bool {
        unsafe { WaitForSingleObject(self.inner.get(), 0) != WAIT_OBJECT_0 }
    }

    pub fn wait(&self, timeout_ms: u32) -> bool {
        unsafe { WaitForSingleObject(self.inner.get(), timeout_ms) == WAIT_OBJECT_0 }
    }

    pub fn terminate(&self) -> Result<(), IdentityError> {
        let ok = unsafe { TerminateProcess(self.inner.get(), 1) };
        if ok == 0 {
            let code = last_error();
            if code == 5 {
                return Err(IdentityError::AccessDenied);
            }
            return Err(IdentityError::Win32(code));
        }
        Ok(())
    }
}

pub fn current_exe_path() -> Result<String, IdentityError> {
    image_path(unsafe { GetCurrentProcess() })
}
