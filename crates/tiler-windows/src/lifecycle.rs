pub const DEFAULT_RUN_SECONDS: u64 = 120;
pub const MAX_RUN_SECONDS: u64 = 600;
pub const STOP_REQUEST_FILE: &str = "stop.request";
/// Pointer to the current per-run log file name (never geometry).
pub const RUN_CURRENT_FILE: &str = "run-current.txt";

/// Per-run unique log file name keyed by owner process creation. Historical
/// logs are never overwritten: each owner run writes its own file and updates
/// the current pointer. `creation` must be nonempty hex from process times.
#[must_use]
pub fn run_log_file_name(creation: &str) -> String {
    format!("run-{creation}.log")
}

pub const MEDIUM_RID_MIN: u32 = 8192;
pub const MEDIUM_RID_MAX: u32 = 12288;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOptions {
    pub seconds: u64,
    pub trace: bool,
    pub hide_hwnd: Option<u64>,
}

#[must_use]
pub fn is_medium_rid(rid: u32) -> bool {
    (MEDIUM_RID_MIN..MEDIUM_RID_MAX).contains(&rid)
}

#[must_use]
pub fn exe_paths_equal(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('/', "\\").to_ascii_lowercase();
    norm(a) == norm(b)
}

pub fn parse_run_args(args: &[String]) -> Result<RunOptions, String> {
    let mut seconds = DEFAULT_RUN_SECONDS;
    let mut trace = false;
    let mut hide_hwnd: Option<u64> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--trace" => {
                trace = true;
                i += 1;
            }
            "--seconds" => {
                i += 1;
                let value = args
                    .get(i)
                    .ok_or("usage: run --seconds N [--trace] [--hide HWND]")?;
                seconds = value
                    .parse::<u64>()
                    .map_err(|_| "usage: run --seconds N [--trace] [--hide HWND]")?;
                i += 1;
            }
            "--hide" => {
                i += 1;
                let value = args
                    .get(i)
                    .ok_or("usage: run --seconds N [--trace] [--hide HWND]")?;
                hide_hwnd = Some(
                    crate::test_window::parse_hwnd(value)
                        .ok_or("usage: run --seconds N [--trace] [--hide HWND]")?,
                );
                i += 1;
            }
            _ => return Err("usage: run --seconds N [--trace] [--hide HWND]".to_owned()),
        }
    }
    if seconds == 0 || seconds > MAX_RUN_SECONDS {
        return Err(format!("refuse: seconds must be 1..={MAX_RUN_SECONDS}"));
    }
    Ok(RunOptions {
        seconds,
        trace,
        hide_hwnd,
    })
}

#[must_use]
pub fn stop_request_matches(contents: &str, owner_creation: &str) -> bool {
    !owner_creation.is_empty() && contents.trim() == owner_creation
}

#[cfg(windows)]
pub mod sys {
    use super::{
        RUN_CURRENT_FILE, STOP_REQUEST_FILE, is_medium_rid, run_log_file_name, stop_request_matches,
    };
    use crate::model::{LEDGER_SCHEMA_VERSION, RecoveryLedger, parse_ledger, restore_eligibility};
    use crate::native::{
        HeldProcess, IdentityError, current_exe_path, current_identity, current_integrity_level,
        has_terminal_ancestor, ledger_directory,
    };
    use crate::storage::{LEDGER_FILE_NAME, LedgerStore};
    use crate::test_window::{SnapshotError, WindowSnapshot};
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    const POLL_MS: u64 = 150;
    const STOP_WAIT_MS: u32 = 5000;

    type DynError = Box<dyn std::error::Error>;
    type Result<T> = std::result::Result<T, DynError>;

    fn err(msg: impl Into<String>) -> DynError {
        Box::new(std::io::Error::other(msg.into()))
    }

    fn write_log_at(path: &Path, line: &str, first: bool) -> Result<()> {
        use std::io::Write;
        let mut file = if first {
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
        } else {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
        }
        .map_err(|e| err(format!("error: log write: {e}")))?;
        writeln!(file, "{line}").map_err(|e| err(format!("error: log write: {e}")))?;
        file.flush()
            .map_err(|e| err(format!("error: log write: {e}")))
    }

    /// Per-run unique log path persisted via the owner creation. Historical
    /// logs are never overwritten: each run owns `run-<creation>.log`.
    pub fn log_path_for(dir: &Path, creation: &str) -> PathBuf {
        dir.join(run_log_file_name(creation))
    }

    fn write_log_for(dir: &Path, creation: &str, line: &str, first: bool) -> Result<()> {
        write_log_at(&log_path_for(dir, creation), line, first)
    }

    fn point_current(dir: &Path, creation: &str) -> Result<()> {
        std::fs::write(dir.join(RUN_CURRENT_FILE), run_log_file_name(creation))
            .map_err(|e| err(format!("error: log pointer write: {e}")))
    }

    fn medium_caller() -> Result<crate::model::ProcessIdentity> {
        let me = current_identity().map_err(|e| err(format!("error: identity {e}")))?;
        let rid = current_integrity_level().map_err(|e| err(format!("error: integrity {e}")))?;
        if !is_medium_rid(rid) {
            return Err(err(format!("refuse: integrity {rid} is not medium")));
        }
        Ok(me)
    }

    fn open_held(pid: u32, terminate: bool, ctx: &str) -> Result<Option<HeldProcess>> {
        match if terminate {
            HeldProcess::open_terminate(pid)
        } else {
            HeldProcess::open(pid)
        } {
            Ok(held) => Ok(Some(held)),
            Err(IdentityError::Absent) => Ok(None),
            Err(e) => Err(err(format!("error: {ctx} {e}"))),
        }
    }

    fn held_live(
        pid: u32,
        terminate: bool,
    ) -> Result<Option<(HeldProcess, crate::model::ProcessIdentity)>> {
        let Some(held) = open_held(pid, terminate, "owner")? else {
            return Ok(None);
        };
        match held.identity() {
            Ok(live) => Ok(Some((held, live))),
            Err(IdentityError::Absent) => Ok(None),
            Err(e) => Err(err(format!("error: owner {e}"))),
        }
    }

    fn owned(hwnd: u64, exe: &str, sid: &str, session: u32, ctx: &str) -> Result<WindowSnapshot> {
        match crate::test_window::sys::query_owned(hwnd, exe, sid, session) {
            Ok(s) => Ok(s),
            Err(SnapshotError::Absent(msg)) => Err(err(format!("refuse: {ctx}{msg}"))),
            Err(SnapshotError::Failed(msg)) => Err(err(format!("error: {ctx}{msg}"))),
        }
    }

    fn owned_opt(hwnd: u64, exe: &str, sid: &str, session: u32) -> Result<Option<WindowSnapshot>> {
        match crate::test_window::sys::query_owned(hwnd, exe, sid, session) {
            Ok(s) => Ok(Some(s)),
            Err(SnapshotError::Absent(_)) => Ok(None),
            Err(SnapshotError::Failed(msg)) => Err(err(format!("error: {msg}"))),
        }
    }

    /// Snapshot must equal the ledger entry; `visible` is the expected state.
    fn snap_matches(
        snap: &WindowSnapshot,
        want: &crate::model::WindowIdentity,
        hwnd: u64,
        visible: bool,
    ) -> bool {
        snap.hwnd == hwnd
            && snap.process == want.process
            && snap.tag == want.tag
            && snap.visible == visible
    }

    fn open_store(dir: &Path) -> Result<LedgerStore> {
        LedgerStore::open(dir).map_err(|e| match e {
            crate::storage::StorageError::LockContended => {
                err("refuse: another owner holds the store")
            }
            other => err(format!("error: store open: {other}")),
        })
    }

    fn committed_or_none(store: &LedgerStore) -> Result<Option<RecoveryLedger>> {
        match store.committed() {
            Ok(v) => Ok(v),
            Err(crate::storage::StorageError::Ledger(_)) => Err(err("refuse: corrupt ledger")),
            Err(crate::storage::StorageError::Io(e)) => {
                Err(err(format!("error: ledger read: {e}")))
            }
            Err(e) => Err(err(format!("error: store read: {e}"))),
        }
    }

    fn read_stop(dir: &Path) -> Result<Option<String>> {
        match std::fs::read_to_string(dir.join(STOP_REQUEST_FILE)) {
            Ok(t) => Ok(Some(t)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(err(format!("error: stop read: {e}"))),
        }
    }

    fn cleanup_own_stop(dir: &Path, own_creation: &str) -> Result<()> {
        match read_stop(dir)? {
            Some(text) if stop_request_matches(&text, own_creation) => {
                match std::fs::remove_file(dir.join(STOP_REQUEST_FILE)) {
                    Ok(()) => Ok(()),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    Err(e) => Err(err(format!("error: stop cleanup: {e}"))),
                }
            }
            _ => Ok(()),
        }
    }

    fn hold_helper_verified(
        pid: u32,
        expected: &crate::model::ProcessIdentity,
    ) -> Result<HeldProcess> {
        let Some(held) = open_held(pid, false, "helper")? else {
            return Err(err(format!("refuse: helper pid={pid} absent")));
        };
        let live = match held.identity() {
            Ok(l) => l,
            Err(IdentityError::Absent) => {
                return Err(err(format!("refuse: helper pid={pid} absent")));
            }
            Err(e) => return Err(err(format!("error: helper {e}"))),
        };
        if live != *expected || !held.is_alive() {
            return Err(err(format!("refuse: helper pid={pid} identity changed")));
        }
        Ok(held)
    }

    pub fn cmd_run(seconds: u64, trace: bool, hide_hwnd: Option<u64>) -> Result<String> {
        run_with_callback(seconds, trace, hide_hwnd, |dir, me| {
            let deadline = Some(Instant::now() + Duration::from_secs(seconds));
            poll_stop(dir, me, deadline)
        })
    }

    fn poll_stop(
        dir: &Path,
        me: &crate::model::ProcessIdentity,
        deadline: Option<Instant>,
    ) -> Result<bool> {
        loop {
            if stop_requested(dir, me)? {
                return Ok(true);
            }
            if deadline.is_some_and(|end| Instant::now() >= end) {
                return Ok(false);
            }
            std::thread::sleep(Duration::from_millis(POLL_MS));
        }
    }

    /// Non-blocking exact-owner stop check for product loops that poll on
    /// their own schedule.
    pub fn stop_requested(dir: &Path, me: &crate::model::ProcessIdentity) -> Result<bool> {
        match read_stop(dir)? {
            Some(text) if stop_request_matches(&text, &me.process_creation) => Ok(true),
            Some(_) | None => Ok(false),
        }
    }

    /// Product tiling loop seam: same owner lease/commit/stop checks as
    /// `run_with_callback`, but untimed (body returns on exact-owner stop),
    /// never hides, and commits an empty window ledger. The body must poll
    /// [`stop_requested`] itself and return when it observes a request.
    pub fn run_product(
        trace: bool,
        body: impl FnOnce(&Path, &crate::model::ProcessIdentity) -> Result<()>,
    ) -> Result<String> {
        let dir = ledger_directory().map_err(|e| err(format!("error: ledger dir: {e}")))?;
        let me = medium_caller()?;
        if has_terminal_ancestor(me.pid).map_err(|e| err(format!("error: ancestry {e}")))? {
            return Err(err("refuse: terminal-ancestor"));
        }
        match run_guarded(&dir, &me, 0, trace, None, true, |dir, me| {
            body(dir, me)?;
            Ok(true)
        }) {
            Ok(out) => Ok(out),
            Err(e) => {
                // Post-lease failures append to the per-run log; pre-lease
                // refusals (no file yet) surface without writing.
                let path = log_path_for(&dir, &me.process_creation);
                if path.exists() {
                    let msg = e.to_string();
                    let line = serde_json::json!({"event": "run-error", "error": msg}).to_string();
                    write_log_at(&path, &line, false)?;
                }
                Err(e)
            }
        }
    }

    /// Owner setup/commit/log seam; body runs on the calling thread.
    pub fn run_with_callback(
        seconds: u64,
        trace: bool,
        hide_hwnd: Option<u64>,
        body: impl FnOnce(&Path, &crate::model::ProcessIdentity) -> Result<bool>,
    ) -> Result<String> {
        let dir = ledger_directory().map_err(|e| err(format!("error: ledger dir: {e}")))?;
        let me = medium_caller()?;
        if has_terminal_ancestor(me.pid).map_err(|e| err(format!("error: ancestry {e}")))? {
            return Err(err("refuse: terminal-ancestor"));
        }
        match run_guarded(&dir, &me, seconds, trace, hide_hwnd, false, body) {
            Ok(out) => Ok(out),
            Err(e) => {
                let path = log_path_for(&dir, &me.process_creation);
                if path.exists() {
                    let msg = e.to_string();
                    write_log_at(&path, &format!("run failed: {msg}"), false)?;
                }
                Err(e)
            }
        }
    }

    fn hide_once(
        dir: &Path,
        hwnd: u64,
        me: &crate::model::ProcessIdentity,
        expect: &crate::model::WindowIdentity,
    ) -> Result<()> {
        use windows_sys::Win32::UI::WindowsAndMessaging::{SW_HIDE, ShowWindow};
        let helper_exe =
            crate::test_window::sys::sibling_helper_exe().map_err(|e| err(e.to_string()))?;
        let fresh = owned(hwnd, &helper_exe, &me.user_sid, me.session_id, "")?;
        if !snap_matches(&fresh, expect, hwnd, true) {
            return Err(err("refuse: hide pre-readback mismatch"));
        }
        let _held = hold_helper_verified(fresh.process.pid, &fresh.process)?;
        // Write-before-hide: ledger commit precedes this ShowWindow.
        let raw = hwnd as isize as windows_sys::Win32::Foundation::HWND;
        if unsafe { ShowWindow(raw, SW_HIDE) } == 0 {
            return Err(err("refuse: hide not previously visible"));
        }
        let back = owned(hwnd, &helper_exe, &me.user_sid, me.session_id, "")?;
        if !snap_matches(&back, expect, hwnd, false) {
            return Err(err("refuse: hide readback mismatch"));
        }
        write_log_for(
            dir,
            &me.process_creation,
            &format!("run hide hwnd={hwnd} tag={}", expect.tag),
            false,
        )
    }

    fn run_guarded(
        dir: &Path,
        me: &crate::model::ProcessIdentity,
        seconds: u64,
        trace: bool,
        hide_hwnd: Option<u64>,
        product: bool,
        body: impl FnOnce(&Path, &crate::model::ProcessIdentity) -> Result<bool>,
    ) -> Result<String> {
        let store = open_store(dir)?;
        if committed_or_none(&store)?.is_some() {
            return Err(err("refuse: ledger committed until stopped cleanup"));
        }
        cleanup_own_stop(dir, &me.process_creation)?;
        let windows = if let Some(hwnd) = hide_hwnd {
            let helper_exe =
                crate::test_window::sys::sibling_helper_exe().map_err(|e| err(e.to_string()))?;
            let snap = owned(hwnd, &helper_exe, &me.user_sid, me.session_id, "")?;
            if !snap.visible {
                return Err(err("refuse: target not visible"));
            }
            vec![crate::model::WindowIdentity {
                hwnd: snap.hwnd,
                process: snap.process.clone(),
                tag: snap.tag.clone(),
            }]
        } else {
            Vec::new()
        };
        let span = if seconds == 0 {
            "untimed".to_owned()
        } else {
            format!("seconds={seconds}")
        };
        // Per-run unique log: refuse when the file already exists so one
        // owner run can never overwrite another. The ledger (committed below)
        // persists the owner creation, and `cmd_ready` derives the same path.
        let log_file = log_path_for(dir, &me.process_creation);
        if log_file.exists() {
            return Err(err("refuse: log preexists, will not overwrite"));
        }
        if product {
            // Product log vocabulary: structured JSON, no native ids (no pid,
            // creation, SID, or session). Legacy spike/dev lines stay below.
            write_log_at(
                &log_file,
                "{\"event\":\"run-start\",\"mode\":\"product\"}",
                true,
            )?;
        } else {
            write_log_at(&log_file, &format!("run start pid={} {span}", me.pid), true)?;
        }
        if trace && !product {
            write_log_at(
                &log_file,
                &format!(
                    "run owner pid={} creation={} sid={} session={}",
                    me.pid, me.process_creation, me.user_sid, me.session_id
                ),
                false,
            )?;
        }
        point_current(dir, &me.process_creation)?;
        let record = RecoveryLedger {
            v: LEDGER_SCHEMA_VERSION,
            owner: (*me).clone(),
            windows,
        };
        store
            .commit(&record)
            .map_err(|e| err(format!("error: ledger commit: {e}")))?;
        if let Some(hwnd) = hide_hwnd {
            let expect = record
                .windows
                .first()
                .ok_or_else(|| err("error: ledger empty"))?;
            hide_once(dir, hwnd, me, expect)?;
        }
        let stopped = body(dir, me)?;
        let log_path = log_file.to_string_lossy().into_owned();
        if product {
            let status = if stopped { "stopped" } else { "expired" };
            write_log_at(
                &log_file,
                &format!("{{\"event\":\"run-end\",\"status\":\"{status}\"}}"),
                false,
            )?;
            Ok(serde_json::json!({"status": status, "log_path": log_path}).to_string())
        } else {
            let (status, message) = if stopped {
                ("stopped", "run stop-request observed")
            } else {
                ("expired", "run deadline expired")
            };
            write_log_at(&log_file, message, false)?;
            Ok(
                serde_json::json!({"status": status, "owner": me, "log_path": log_path})
                    .to_string(),
            )
        }
    }

    fn caller_owns(me: &crate::model::ProcessIdentity, record: &RecoveryLedger) -> Result<bool> {
        if me.user_sid != record.owner.user_sid || me.session_id != record.owner.session_id {
            return Ok(false);
        }
        let exe = current_exe_path().map_err(|e| err(format!("error: exe {e}")))?;
        Ok(super::exe_paths_equal(&exe, &record.owner.exe_path))
    }

    fn target_verified(held: &HeldProcess, pid: u32) -> Result<()> {
        if has_terminal_ancestor(pid).map_err(|e| err(format!("error: target ancestry {e}")))? {
            return Err(err("refuse: target terminal-ancestor"));
        }
        let rid = held
            .integrity()
            .map_err(|e| err(format!("error: target integrity {e}")))?;
        if !is_medium_rid(rid) {
            return Err(err(format!("refuse: target integrity {rid} is not medium")));
        }
        Ok(())
    }

    fn not_ready() -> Result<String> {
        Ok(serde_json::json!({"ready": false}).to_string())
    }

    pub fn cmd_ready() -> Result<String> {
        let dir: PathBuf =
            ledger_directory().map_err(|e| err(format!("error: ledger dir: {e}")))?;
        let Some(record) = unlocked(&dir)? else {
            return not_ready();
        };
        if !caller_owns(&medium_caller()?, &record)? {
            return not_ready();
        }
        let Some((held, live)) = held_live(record.owner.pid, false)? else {
            return not_ready();
        };
        if live != record.owner || !held.is_alive() {
            return not_ready();
        }
        match target_verified(&held, record.owner.pid) {
            Ok(()) => {}
            Err(e) if e.to_string().starts_with("refuse:") => {
                return not_ready();
            }
            Err(e) => return Err(e),
        }
        if !record.windows.is_empty() {
            let helper_exe =
                crate::test_window::sys::sibling_helper_exe().map_err(|e| err(e.to_string()))?;
            for w in &record.windows {
                let Some(snap) = owned_opt(
                    w.hwnd,
                    &helper_exe,
                    &record.owner.user_sid,
                    record.owner.session_id,
                )?
                else {
                    return not_ready();
                };
                if !snap_matches(&snap, w, w.hwnd, false) {
                    return not_ready();
                }
            }
        }
        let log_path = log_path_for(&dir, &record.owner.process_creation)
            .to_string_lossy()
            .into_owned();
        Ok(
            serde_json::json!({"ready": true, "owner": record.owner, "log_path": log_path})
                .to_string(),
        )
    }

    fn unlocked(dir: &Path) -> Result<Option<RecoveryLedger>> {
        match std::fs::read(dir.join(LEDGER_FILE_NAME)) {
            Ok(bytes) => {
                let text =
                    std::str::from_utf8(&bytes).map_err(|_| err("refuse: corrupt ledger"))?;
                parse_ledger(text)
                    .map(Some)
                    .map_err(|_| err("refuse: corrupt ledger"))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(err(format!("error: ledger read: {e}"))),
        }
    }

    fn reveal_once(
        w: &crate::model::WindowIdentity,
        helper_exe: &str,
        owner: &crate::model::ProcessIdentity,
    ) -> Result<()> {
        use windows_sys::Win32::UI::WindowsAndMessaging::{SW_SHOWNA, ShowWindow};
        let pre = format!("restore pre-read {} ", w.hwnd);
        let fresh = owned(w.hwnd, helper_exe, &owner.user_sid, owner.session_id, &pre)?;
        if !snap_matches(&fresh, w, w.hwnd, false) {
            return Err(err(format!(
                "refuse: restore pre-read mismatch hwnd={}",
                w.hwnd
            )));
        }
        let _held = hold_helper_verified(fresh.process.pid, &fresh.process)?;
        let _prev = unsafe {
            ShowWindow(
                w.hwnd as isize as windows_sys::Win32::Foundation::HWND,
                SW_SHOWNA,
            )
        };
        let ctx = format!("restore readback {} ", w.hwnd);
        let back = owned(w.hwnd, helper_exe, &owner.user_sid, owner.session_id, &ctx)?;
        if !snap_matches(&back, w, w.hwnd, true) {
            return Err(err(format!(
                "refuse: restore readback mismatch hwnd={}",
                w.hwnd
            )));
        }
        Ok(())
    }

    fn restore_locked() -> Result<usize> {
        let dir = ledger_directory().map_err(|e| err(format!("error: ledger dir: {e}")))?;
        if !dir.exists() {
            return Ok(0);
        }
        let me = medium_caller()?;
        let store = open_store(&dir)?;
        let Some(record) = committed_or_none(&store)? else {
            match read_stop(&dir)? {
                Some(text) if !stop_request_matches(&text, &me.process_creation) => {
                    return Err(err("refuse: orphan stop.request"));
                }
                Some(_) => cleanup_own_stop(&dir, &me.process_creation)?,
                None => {}
            }
            return Ok(0);
        };
        if !caller_owns(&me, &record)? {
            return Err(err("refuse: owner mismatch"));
        }
        // Owner must be dead; PID reuse with different full identity is dead.
        if let Some((held, live)) = held_live(record.owner.pid, false)?
            && live == record.owner
            && held.is_alive()
        {
            return Err(err("refuse: owner still active"));
        }
        let helper_exe =
            crate::test_window::sys::sibling_helper_exe().map_err(|e| err(e.to_string()))?;
        for w in &record.windows {
            let ctx = format!("restore hwnd={} ", w.hwnd);
            let snap = owned(
                w.hwnd,
                &helper_exe,
                &record.owner.user_sid,
                record.owner.session_id,
                &ctx,
            )?;
            let observed = crate::model::ObservedWindow {
                identity: crate::model::WindowIdentity {
                    hwnd: snap.hwnd,
                    process: snap.process.clone(),
                    tag: snap.tag.clone(),
                },
                visible: snap.visible,
            };
            match restore_eligibility(w, std::slice::from_ref(&observed)) {
                crate::model::RestoreDecision::SkipAlreadyVisible { .. } => {}
                crate::model::RestoreDecision::Reveal { .. } => {
                    reveal_once(w, &helper_exe, &record.owner)?;
                }
                crate::model::RestoreDecision::Refuse { reason } => {
                    return Err(err(format!("refuse: restore hwnd={} {reason:?}", w.hwnd)));
                }
            }
        }
        let count = record.windows.len();
        cleanup_own_stop(&dir, &record.owner.process_creation)?;
        std::fs::remove_file(dir.join(LEDGER_FILE_NAME))
            .map_err(|e| err(format!("error: ledger cleanup: {e}")))?;
        Ok(count)
    }

    pub fn cmd_restore() -> Result<String> {
        let windows = restore_locked()?;
        Ok(
            serde_json::json!({"restored": true, "windows": windows, "ledger_cleaned": true})
                .to_string(),
        )
    }

    pub fn cmd_stop(terminate: bool) -> Result<String> {
        let dir: PathBuf =
            ledger_directory().map_err(|e| err(format!("error: ledger dir: {e}")))?;
        let Some(record) = unlocked(&dir)? else {
            return Ok(stop_json(terminate, false, false));
        };
        if !caller_owns(&medium_caller()?, &record)? {
            return Err(err("refuse: owner mismatch"));
        }
        let held = match held_live(record.owner.pid, terminate)? {
            Some((held, live)) if live == record.owner => held,
            _ => return Ok(stop_json(terminate, true, true)),
        };
        target_verified(&held, record.owner.pid)?;
        if terminate {
            held.terminate()
                .map_err(|e| err(format!("error: terminate {e}")))?;
        } else {
            std::fs::write(dir.join(STOP_REQUEST_FILE), &record.owner.process_creation)
                .map_err(|e| err(format!("error: stop request write: {e}")))?;
        }
        let exited = held.wait(STOP_WAIT_MS);
        if !exited {
            return Err(err("error: owner exit timeout"));
        }
        Ok(stop_json(terminate, true, true))
    }

    fn stop_json(terminate: bool, exited: bool, recovery_required: bool) -> String {
        let key = if terminate {
            "emergency_stopped"
        } else {
            "stopped"
        };
        serde_json::json!({key: exited, "owner_exited": exited, "recovery_required": recovery_required})
            .to_string()
    }
}
