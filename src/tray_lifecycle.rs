#[cfg(test)]
use std::cell::Cell;
use std::env;
use std::ffi::{CStr, CString, OsStr, OsString};
use std::fmt;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::mem::MaybeUninit;
use std::os::fd::AsRawFd;
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rustix::fs::{self as rfs, AtFlags, FlockOperation, Mode, OFlags, RawDir, RenameFlags};
use rustix::process::{Pid, PidfdFlags, Signal, geteuid, pidfd_open, pidfd_send_signal};

pub const DATA_OWNER_MARKER: &str = "plasma-auto-tiler-data-owner-v1";
pub const PID_OWNER_MARKER: &str = "plasma-auto-tiler-pid-owner-v1";
pub const DESKTOP_OWNER_MARKER: &str = "X-Plasma-Auto-Tiler-Owner=plasma-auto-tiler-v1";
pub const DATA_OWNER_FILE: &str = ".plasma-auto-tiler-owner";
const LOCK_FILE: &str = ".plasma-auto-tiler.lock";
const MAX_RECORD_BYTES: usize = 16 * 1024 * 1024;
const MAX_ARTIFACT_FILE_BYTES: usize = 64 * 1024 * 1024;
const MAX_TREE_NODES: usize = 1024;
const LAUNCH_DEV: &str = "PLASMA_AUTO_TILER_LAUNCH_DEV";
const LAUNCH_INO: &str = "PLASMA_AUTO_TILER_LAUNCH_INO";
const LAUNCH_READY: &str = "PLASMA_AUTO_TILER_LAUNCH_READY";
const LAUNCH_READY_DEV: &str = "PLASMA_AUTO_TILER_LAUNCH_READY_DEV";
const LAUNCH_READY_INO: &str = "PLASMA_AUTO_TILER_LAUNCH_READY_INO";
const PROC_COMM_MAX_BYTES: usize = 15;
const LAUNCH_READY_MARKER: &[u8] = b"plasma-auto-tiler-ready-v1\n";
static NEXT_NAME: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
thread_local! {
    static FAIL_NEXT_BACKUP_SYNC: Cell<bool> = const { Cell::new(false) };
    static FAIL_REMOVE_AFTER: Cell<u64> = const { Cell::new(0) };
    static DENY_PROC_EXE_ACCESS: Cell<bool> = const { Cell::new(false) };
    static FAIL_NEXT_INSTALL_BACKUP_CLEANUP: Cell<bool> = const { Cell::new(false) };
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LifecyclePaths {
    data_root: PathBuf,
    binary: PathBuf,
    desktop: PathBuf,
    pid_record: PathBuf,
    proc_root: PathBuf,
    test_root: Option<PathBuf>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManagedPaths {
    runtime_root: PathBuf,
    pid_record: PathBuf,
    proc_root: PathBuf,
}

impl ManagedPaths {
    pub fn from_env() -> io::Result<Self> {
        let runtime = env_path("XDG_RUNTIME_DIR")?;
        let runtime_root = runtime.join("plasma-auto-tiler-managed");
        Ok(Self {
            pid_record: runtime_root.join("tray.pid"),
            runtime_root,
            proc_root: PathBuf::from("/proc"),
        })
    }

    pub fn runtime_root(&self) -> &Path {
        &self.runtime_root
    }

    pub fn pid_record(&self) -> &Path {
        &self.pid_record
    }

    pub fn proc_root(&self) -> &Path {
        &self.proc_root
    }
}

impl LifecyclePaths {
    pub fn from_env() -> io::Result<Self> {
        let home = env_path("HOME")?;
        let data = env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local/share"));
        let config = env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config"));
        let runtime = env_path("XDG_RUNTIME_DIR")?;
        Ok(Self::derived(
            data.join("plasma-auto-tiler"),
            config.join("autostart/plasma-auto-tiler.desktop"),
            runtime.join("plasma-auto-tiler/tray.pid"),
            PathBuf::from("/proc"),
        ))
    }

    pub fn new(
        data_root: PathBuf,
        desktop: PathBuf,
        pid_record: PathBuf,
        proc_root: PathBuf,
    ) -> Self {
        let binary = data_root.join("bin/plasma-auto-tiler");
        let test_root = data_root
            .parent()
            .and_then(Path::parent)
            .map(Path::to_path_buf);
        Self {
            data_root,
            binary,
            desktop,
            pid_record,
            proc_root,
            test_root,
        }
    }

    fn derived(
        data_root: PathBuf,
        desktop: PathBuf,
        pid_record: PathBuf,
        proc_root: PathBuf,
    ) -> Self {
        Self {
            binary: data_root.join("bin/plasma-auto-tiler"),
            data_root,
            desktop,
            pid_record,
            proc_root,
            test_root: None,
        }
    }

    pub fn data_root(&self) -> &Path {
        &self.data_root
    }
    pub fn binary(&self) -> &Path {
        &self.binary
    }
    pub fn desktop(&self) -> &Path {
        &self.desktop
    }
    pub fn pid_record(&self) -> &Path {
        &self.pid_record
    }
    pub fn proc_root(&self) -> &Path {
        &self.proc_root
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LifecycleRecord {
    pub pid: u32,
    pub start_tick: u64,
    pub resolved_executable_path: PathBuf,
    pub generation_token: String,
}

impl LifecycleRecord {
    pub fn encode(&self) -> io::Result<String> {
        let executable = self
            .resolved_executable_path
            .to_str()
            .ok_or_else(|| invalid("record path is not UTF-8"))?;
        if self.pid == 0
            || self.start_tick == 0
            || !self.resolved_executable_path.is_absolute()
            || validate_path(&self.resolved_executable_path).is_err()
            || executable.contains(['\n', '\r'])
            || !valid_generation(&self.generation_token)
        {
            return Err(invalid("record contains an invalid field"));
        }
        Ok(format!(
            "{PID_OWNER_MARKER}\npid={}\nstart_tick={}\nresolved_executable_path={executable}\ngeneration_token={}\n",
            self.pid, self.start_tick, self.generation_token
        ))
    }

    fn decode(fields: &[&str]) -> Result<Self, RecordError> {
        if fields.len() != 5 || fields[0] != PID_OWNER_MARKER {
            return Err(RecordError::Malformed);
        }
        let pid = fields[1]
            .strip_prefix("pid=")
            .ok_or(RecordError::Malformed)?
            .parse()
            .map_err(|_| RecordError::Malformed)?;
        let start_tick = fields[2]
            .strip_prefix("start_tick=")
            .ok_or(RecordError::Malformed)?
            .parse()
            .map_err(|_| RecordError::Malformed)?;
        let executable = fields[3]
            .strip_prefix("resolved_executable_path=")
            .filter(|v| Path::new(v).is_absolute() && validate_path(Path::new(v)).is_ok())
            .ok_or(RecordError::Malformed)?;
        let generation = fields[4]
            .strip_prefix("generation_token=")
            .filter(|v| valid_generation(v))
            .ok_or(RecordError::Malformed)?;
        if pid == 0 || start_tick == 0 {
            return Err(RecordError::Malformed);
        }
        Ok(Self {
            pid,
            start_tick,
            resolved_executable_path: PathBuf::from(executable),
            generation_token: generation.to_owned(),
        })
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum RecordError {
    Unreadable,
    Unowned,
    Malformed,
    Mismatched,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RecordObservation {
    Absent,
    Owned(LifecycleRecord),
    Unreadable,
    Unowned,
    Malformed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileIdentity {
    dev: u64,
    ino: u64,
    mode: u32,
    uid: u32,
    directory: bool,
    content: Vec<u8>,
}

struct FileSnapshot {
    file: File,
    parent: File,
    name: CString,
    identity: FileIdentity,
}
struct TreeNode {
    relative: PathBuf,
    parent: File,
    name: CString,
    file: File,
    identity: FileIdentity,
    directory: bool,
}
struct TreeSnapshot {
    parent: File,
    name: CString,
    root: File,
    root_identity: FileIdentity,
    nodes: Vec<TreeNode>,
}
struct RecordSnapshot {
    record: LifecycleRecord,
    file: FileSnapshot,
    binary: FileIdentity,
}

#[derive(Debug)]
enum ObservedError {
    Io(io::Error),
    Unowned,
    Malformed,
}

pub fn read_record(path: &Path) -> RecordObservation {
    match read_record_snapshot(path) {
        Ok(Some(s)) => RecordObservation::Owned(s.record),
        Ok(None) => RecordObservation::Absent,
        Err(ObservedError::Io(_)) => RecordObservation::Unreadable,
        Err(ObservedError::Unowned) => RecordObservation::Unowned,
        Err(ObservedError::Malformed) => RecordObservation::Malformed,
    }
}

fn read_record_snapshot(path: &Path) -> Result<Option<RecordSnapshot>, ObservedError> {
    let file = match read_file_snapshot_with(path, Some(MAX_RECORD_BYTES), Some(0o600)) {
        Ok(Some(file)) => file,
        Ok(None) => return Ok(None),
        Err(error) if error.kind() == io::ErrorKind::InvalidInput => {
            return Err(ObservedError::Malformed);
        }
        Err(error) => return Err(ObservedError::Io(error)),
    };
    if file.file.metadata().map_err(ObservedError::Io)?.mode() & 0o7777 != 0o600 {
        return Err(ObservedError::Malformed);
    }
    if file.identity.content.split(|b| *b == b'\n').next() != Some(PID_OWNER_MARKER.as_bytes()) {
        return Err(ObservedError::Unowned);
    }
    let text =
        String::from_utf8(file.identity.content.clone()).map_err(|_| ObservedError::Malformed)?;
    if !text.ends_with('\n') {
        return Err(ObservedError::Malformed);
    }
    let fields: Vec<_> = text[..text.len() - 1].split('\n').collect();
    if fields.len() != 8 {
        return Err(ObservedError::Malformed);
    }
    let record = LifecycleRecord::decode(&fields[..5]).map_err(|_| ObservedError::Malformed)?;
    let dev = fields[5]
        .strip_prefix("binary_dev=")
        .and_then(|v| v.parse().ok())
        .ok_or(ObservedError::Malformed)?;
    let ino = fields[6]
        .strip_prefix("binary_ino=")
        .and_then(|v| v.parse().ok())
        .ok_or(ObservedError::Malformed)?;
    let content = decode_hex(
        fields[7]
            .strip_prefix("binary_content=")
            .ok_or(ObservedError::Malformed)?,
    )
    .ok_or(ObservedError::Malformed)?;
    Ok(Some(RecordSnapshot {
        record,
        file,
        binary: FileIdentity {
            dev,
            ino,
            mode: 0o755,
            uid: current_uid(),
            directory: false,
            content,
        },
    }))
}

pub fn write_record(path: &Path, record: &LifecycleRecord) -> io::Result<()> {
    let binary = installed_identity(&record.resolved_executable_path)?
        .ok_or_else(|| invalid("record executable is absent"))?;
    write_record_with_identity(path, record, &binary)
}

fn write_record_with_identity(
    path: &Path,
    record: &LifecycleRecord,
    binary: &FileIdentity,
) -> io::Result<()> {
    let temporary = unique_name(".tray-pid");
    let mut text = record.encode()?;
    let binary_prefix = format!(
        "binary_dev={}\nbinary_ino={}\nbinary_content=",
        binary.dev, binary.ino
    );
    let encoded_binary_bytes = binary
        .content
        .len()
        .checked_mul(2)
        .ok_or_else(|| invalid("PID record exceeds lifecycle record limit"))?;
    let record_bytes = text
        .len()
        .checked_add(binary_prefix.len())
        .and_then(|bytes| bytes.checked_add(encoded_binary_bytes))
        .and_then(|bytes| bytes.checked_add(1))
        .ok_or_else(|| invalid("PID record exceeds lifecycle record limit"))?;
    if record_bytes > MAX_RECORD_BYTES {
        return Err(invalid("PID record exceeds lifecycle record limit"));
    }
    text.push_str(&binary_prefix);
    text.push_str(&encode_hex(&binary.content));
    text.push('\n');
    let parent = open_directory(
        path.parent()
            .ok_or_else(|| invalid("record has no parent"))?,
        true,
    )?;
    let name = leaf_name(path)?;
    let result = (|| {
        let mut file = create_file_at(&parent, &temporary, 0o600)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        let temporary_snapshot = snapshot_file_at(&parent, &temporary)?;
        if temporary_snapshot.identity.mode != 0o600
            || temporary_snapshot.identity.uid != current_uid()
            || temporary_snapshot.identity.content != text.as_bytes()
        {
            return Err(invalid("temporary PID record identity changed"));
        }
        rename_noreplace(&parent, &temporary, &parent, &name)?;
        rfs::fsync(&parent).map_err(io::Error::from)
    })();
    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            match remove_partial_file(&parent, &temporary, 0o600, Some(text.as_bytes())) {
                Ok(()) => Err(error),
                Err(cleanup) => Err(io::Error::new(
                    cleanup.kind(),
                    format!("{error}; recovery-required: {cleanup}"),
                )),
            }
        }
    }
}

pub trait ProcessControl {
    fn identity(&self, pid: u32) -> io::Result<Option<ProcessIdentity>>;
    fn terminate(&self, pid: u32, expected: &ProcessIdentity) -> io::Result<()>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProcessExecutableIdentity {
    pub dev: u64,
    pub ino: u64,
    pub content: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ProcessPathIdentity {
    start_tick: u64,
    resolved_executable_path: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProcessIdentity {
    pub start_tick: u64,
    pub resolved_executable_path: PathBuf,
    pub executable: ProcessExecutableIdentity,
}

pub struct ProcProcessControl {
    pub proc_root: PathBuf,
}

impl ProcProcessControl {
    fn process_directory(&self, pid: u32) -> io::Result<Option<File>> {
        match open_special_directory(&self.proc_root.join(pid.to_string())) {
            Ok(dir) => Ok(Some(dir)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn identity_at(dir: &File, expected_uid: u32) -> io::Result<Option<ProcessIdentity>> {
        if dir.metadata()?.uid() != expected_uid {
            return Ok(None);
        }
        let Some(path) = process_path_identity_at(dir)? else {
            return Ok(None);
        };
        let Some(binary) = process_binary_identity_at(dir)? else {
            return Ok(None);
        };
        Ok(Some(ProcessIdentity {
            start_tick: path.start_tick,
            resolved_executable_path: path.resolved_executable_path,
            executable: ProcessExecutableIdentity {
                dev: binary.dev,
                ino: binary.ino,
                content: binary.content,
            },
        }))
    }

    fn identity_if_path(
        &self,
        pid: u32,
        expected_paths: &[&Path],
    ) -> io::Result<Option<ProcessIdentity>> {
        let Some(dir) = self.process_directory(pid)? else {
            return Ok(None);
        };
        if dir.metadata()?.uid() != current_uid() {
            return Ok(None);
        }
        let Some((start_tick, command)) = process_path_metadata_at(&dir)? else {
            return Ok(None);
        };
        let resolved_executable_path = match process_executable_path_at(&dir) {
            Ok(Some(path)) => path,
            Ok(None) => return Ok(None),
            Err(error)
                if error.kind() == io::ErrorKind::PermissionDenied
                    && !process_command_matches_paths(&command, expected_paths) =>
            {
                return Ok(None);
            }
            Err(error) => return Err(error),
        };
        if !expected_paths
            .iter()
            .any(|expected| resolved_executable_path == *expected)
        {
            return Ok(None);
        }
        let Some(binary) = process_binary_identity_at(&dir)? else {
            return Ok(None);
        };
        Ok(Some(ProcessIdentity {
            start_tick,
            resolved_executable_path,
            executable: ProcessExecutableIdentity {
                dev: binary.dev,
                ino: binary.ino,
                content: binary.content,
            },
        }))
    }
}

impl ProcessControl for ProcProcessControl {
    fn identity(&self, pid: u32) -> io::Result<Option<ProcessIdentity>> {
        let Some(dir) = self.process_directory(pid)? else {
            return Ok(None);
        };
        Self::identity_at(&dir, current_uid())
    }

    fn terminate(&self, pid: u32, expected: &ProcessIdentity) -> io::Result<()> {
        let raw = i32::try_from(pid).map_err(|_| invalid("PID is out of range"))?;
        let pid = Pid::from_raw(raw).ok_or_else(|| invalid("PID is zero"))?;
        let pidfd = pidfd_open(pid, PidfdFlags::empty()).map_err(io::Error::from)?;
        if self.identity(pid.as_raw_pid() as u32)?.as_ref() != Some(expected) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "process identity changed before signaling",
            ));
        }
        pidfd_send_signal(&pidfd, Signal::TERM).map_err(io::Error::from)
    }
}

fn process_binary_identity(proc_root: &Path, pid: u32) -> io::Result<Option<FileIdentity>> {
    let dir = match open_special_directory(&proc_root.join(pid.to_string())) {
        Ok(dir) => dir,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    process_binary_identity_at(&dir)
}

fn process_path_metadata_at(dir: &File) -> io::Result<Option<(u64, String)>> {
    let stat = match read_special_file(dir, "stat") {
        Ok(stat) => stat,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let close = stat
        .rfind(')')
        .ok_or_else(|| invalid("process stat has no command terminator"))?;
    let open = stat
        .find('(')
        .ok_or_else(|| invalid("process stat has no command opener"))?;
    let command = stat[open + 1..close].to_owned();
    let fields: Vec<_> = stat[close + 1..].split_whitespace().collect();
    let start_tick = fields
        .get(19)
        .ok_or_else(|| invalid("process stat is truncated"))?
        .parse()
        .map_err(|_| invalid("invalid process start tick"))?;
    Ok(Some((start_tick, command)))
}

fn process_executable_path_at(dir: &File) -> io::Result<Option<PathBuf>> {
    #[cfg(test)]
    if DENY_PROC_EXE_ACCESS.with(Cell::get) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Permission denied reading proc executable",
        ));
    }
    let resolved_executable_path = PathBuf::from(OsString::from_vec(
        match rfs::readlinkat(dir, "exe", Vec::new()) {
            Ok(executable) => executable,
            Err(error) if io::Error::from(error).kind() == io::ErrorKind::NotFound => {
                return Ok(None);
            }
            Err(error) => return Err(error.into()),
        }
        .into_bytes(),
    ));
    Ok(Some(resolved_executable_path))
}

fn process_path_identity_at(dir: &File) -> io::Result<Option<ProcessPathIdentity>> {
    let Some((start_tick, _)) = process_path_metadata_at(dir)? else {
        return Ok(None);
    };
    let Some(resolved_executable_path) = process_executable_path_at(dir)? else {
        return Ok(None);
    };
    Ok(Some(ProcessPathIdentity {
        start_tick,
        resolved_executable_path,
    }))
}

fn process_command_matches_paths(command: &str, expected_paths: &[&Path]) -> bool {
    expected_paths.iter().any(|expected| {
        let Some(name) = expected.file_name().and_then(OsStr::to_str) else {
            return false;
        };
        name == command
            || (command.len() == PROC_COMM_MAX_BYTES
                && name.len() > PROC_COMM_MAX_BYTES
                && name.starts_with(command))
    })
}

fn process_binary_identity_at(dir: &File) -> io::Result<Option<FileIdentity>> {
    let name = CString::new("exe").unwrap();
    // /proc/<pid>/exe is a kernel-owned symlink; opening it must resolve the
    // target, unlike ordinary lifecycle artifacts which use NOFOLLOW.
    let file = match open_at(dir, &name, OFlags::RDONLY | OFlags::CLOEXEC) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let metadata = file.metadata()?;
    if !safe_file(&metadata) && !safe_store_executable(&metadata) {
        return Err(invalid("process executable is not a safe regular file"));
    }
    Ok(Some(identity_of(&file, Some(read_content(&file)?))?))
}

fn safe_store_path(path: &Path) -> bool {
    let mut components = path.as_os_str().as_bytes().split(|byte| *byte == b'/');
    components.next() == Some(b"")
        && components.next() == Some(b"nix")
        && components.next() == Some(b"store")
        && components.next().is_some_and(|component| {
            !component.is_empty() && component != b"." && component != b".."
        })
        && components
            .all(|component| !component.is_empty() && component != b"." && component != b"..")
}

fn safe_store_executable(metadata: &fs::Metadata) -> bool {
    metadata.is_file()
        && metadata.uid() == 0
        && metadata.mode() & 0o022 == 0
        && metadata.mode() & 0o111 != 0
}

fn store_executable_identity(path: &Path) -> io::Result<Option<FileIdentity>> {
    if !safe_store_path(path) || fs::canonicalize(path)? != path {
        return Ok(None);
    }
    let parent = open_special_directory(
        path.parent()
            .ok_or_else(|| invalid("store executable has no parent"))?,
    )?;
    let file = match open_at(
        &parent,
        &leaf_name(path)?,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
    ) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let metadata = file.metadata()?;
    if !safe_store_executable(&metadata) {
        return Err(invalid("store executable is not a safe regular executable"));
    }
    Ok(Some(identity_of(&file, Some(read_content(&file)?))?))
}

#[derive(Debug, PartialEq, Eq)]
pub enum StopOutcome {
    NoRecord,
    RemovedStaleRecord,
    Retained(RecordError),
    Stopped,
}

pub fn stop(paths: &LifecyclePaths) -> Result<StopOutcome, String> {
    with_lock(paths, |_| {
        stop_locked(
            paths,
            &ProcProcessControl {
                proc_root: paths.proc_root.clone(),
            },
        )
    })
}

pub fn stop_with<P: ProcessControl>(
    paths: &LifecyclePaths,
    process: &P,
) -> Result<StopOutcome, String> {
    with_lock(paths, |_| stop_locked(paths, process))
}

fn stop_locked<P: ProcessControl>(
    paths: &LifecyclePaths,
    process: &P,
) -> Result<StopOutcome, String> {
    let Some(snapshot) = owned_record(paths)? else {
        refuse_unrecorded_helper(paths, "stop")?;
        return Ok(StopOutcome::NoRecord);
    };
    if !record_binds(&snapshot, paths) {
        return Ok(StopOutcome::Retained(RecordError::Mismatched));
    }
    let identity = match process.identity(snapshot.record.pid) {
        Ok(Some(identity)) => identity,
        Ok(None) => {
            #[cfg(test)]
            remove_file_snapshot_for_remove(&snapshot.file)?;
            #[cfg(not(test))]
            remove_file_snapshot(&snapshot.file)?;
            return Ok(StopOutcome::RemovedStaleRecord);
        }
        Err(_) => return Ok(StopOutcome::Retained(RecordError::Unreadable)),
    };
    if !process_matches(&snapshot, &identity) {
        return Ok(StopOutcome::Retained(RecordError::Mismatched));
    }
    process
        .terminate(snapshot.record.pid, &identity)
        .map_err(|e| format!("failed to stop PID {}: {e}", snapshot.record.pid))?;
    for _ in 0..20 {
        match process.identity(snapshot.record.pid) {
            Ok(None) => {
                remove_file_snapshot(&snapshot.file)?;
                return Ok(StopOutcome::Stopped);
            }
            Ok(Some(_)) => thread::sleep(Duration::from_millis(10)),
            Err(_) => return Ok(StopOutcome::Retained(RecordError::Unreadable)),
        }
    }
    Ok(StopOutcome::Retained(RecordError::Unreadable))
}

fn owned_record(paths: &LifecyclePaths) -> Result<Option<RecordSnapshot>, String> {
    match read_record_snapshot(paths.pid_record()) {
        Ok(record) => Ok(record),
        Err(ObservedError::Unowned) => Err("unowned PID record retained".to_owned()),
        Err(ObservedError::Malformed) => Err("malformed PID record retained".to_owned()),
        Err(ObservedError::Io(e)) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(ObservedError::Io(_)) => Err("unreadable PID record retained".to_owned()),
    }
}

pub fn create_current_record() -> io::Result<()> {
    let paths = LifecyclePaths::from_env()?;
    if env::var_os(LAUNCH_DEV).is_some() || env::var_os(LAUNCH_INO).is_some() {
        return create_launch_record(&paths);
    }
    with_lock_io(&paths, |_| create_current_record_locked(&paths))
}

pub fn validate_managed_environment() -> io::Result<()> {
    reject_dogfood_launch_environment()
}

pub fn create_managed_record() -> io::Result<()> {
    validate_managed_environment()?;
    let paths = ManagedPaths::from_env()?;
    with_managed_lock_io(&paths, |_| create_managed_record_locked(&paths))
}

fn create_managed_record_locked(paths: &ManagedPaths) -> io::Result<()> {
    let current = managed_current_identity(paths)?;
    if let Some(existing) = read_managed_record(paths)? {
        if !managed_record_binds(&existing) {
            return Err(invalid("retained managed PID record is mismatched"));
        }
        match managed_process_identity(paths, existing.record.pid) {
            Ok(identity) if process_matches(&existing, &identity) => {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "managed tray endpoint is already active",
                ));
            }
            Ok(_) => return Err(invalid("retained managed PID record is mismatched")),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                remove_file_snapshot_io(&existing.file)?;
            }
            Err(error) => return Err(error),
        }
    }
    if active_managed_helper(paths, &current)? {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "managed tray endpoint is already active",
        ));
    }
    let raw = i32::try_from(std::process::id()).map_err(|_| invalid("PID is out of range"))?;
    let _pidfd = pidfd_open(
        Pid::from_raw(raw).ok_or_else(|| invalid("PID is zero"))?,
        PidfdFlags::empty(),
    )
    .map_err(io::Error::from)?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let final_running = current_process_identity(paths)?;
    let binary = store_executable_identity(&final_running.resolved_executable_path)?
        .ok_or_else(|| invalid("current store executable disappeared"))?;
    write_managed_record_after_identity_check(
        paths.pid_record(),
        &current,
        &final_running,
        &binary,
        format!("{:x}-{:x}", std::process::id(), nanos),
    )
}

fn reject_dogfood_launch_environment() -> io::Result<()> {
    if [
        LAUNCH_DEV,
        LAUNCH_INO,
        LAUNCH_READY,
        LAUNCH_READY_DEV,
        LAUNCH_READY_INO,
    ]
    .iter()
    .any(|name| env::var_os(name).is_some())
    {
        Err(invalid(
            "managed tray endpoint rejects dogfood launch environment",
        ))
    } else {
        Ok(())
    }
}

fn read_managed_record(paths: &ManagedPaths) -> io::Result<Option<RecordSnapshot>> {
    match read_record_snapshot(paths.pid_record()) {
        Ok(record) => Ok(record),
        Err(ObservedError::Unowned) => Err(invalid("unowned managed PID record")),
        Err(ObservedError::Malformed) => Err(invalid("malformed managed PID record")),
        Err(ObservedError::Io(error)) => Err(error),
    }
}

fn managed_current_identity(paths: &ManagedPaths) -> io::Result<ProcessIdentity> {
    let identity = current_process_identity(paths)?;
    let binary = store_executable_identity(&identity.resolved_executable_path)?
        .ok_or_else(|| invalid("current executable is not a safe Nix store executable"))?;
    if !managed_binary_identity_matches(&identity, &identity.resolved_executable_path, &binary) {
        return Err(invalid(
            "current executable identity changed during startup",
        ));
    }
    Ok(identity)
}

fn current_process_identity(paths: &ManagedPaths) -> io::Result<ProcessIdentity> {
    let process = ProcProcessControl {
        proc_root: paths.proc_root.clone(),
    };
    process
        .identity(std::process::id())?
        .ok_or_else(|| invalid("current managed process identity is unavailable"))
}

fn managed_binary_identity_matches(
    current: &ProcessIdentity,
    final_path: &Path,
    final_binary: &FileIdentity,
) -> bool {
    current.resolved_executable_path == final_path
        && final_binary.dev == current.executable.dev
        && final_binary.ino == current.executable.ino
        && final_binary.content == current.executable.content
}

fn write_managed_record_after_identity_check(
    path: &Path,
    captured: &ProcessIdentity,
    final_running: &ProcessIdentity,
    final_binary: &FileIdentity,
    generation_token: String,
) -> io::Result<()> {
    if captured != final_running
        || !managed_binary_identity_matches(
            captured,
            &final_running.resolved_executable_path,
            final_binary,
        )
    {
        return Err(invalid(
            "managed executable identity changed before record write",
        ));
    }
    write_record_with_identity(
        path,
        &LifecycleRecord {
            pid: std::process::id(),
            start_tick: captured.start_tick,
            resolved_executable_path: captured.resolved_executable_path.clone(),
            generation_token,
        },
        final_binary,
    )
}

fn managed_process_identity(paths: &ManagedPaths, pid: u32) -> io::Result<ProcessIdentity> {
    let process = ProcProcessControl {
        proc_root: paths.proc_root.clone(),
    };
    let Some(identity) = process.identity(pid)? else {
        if process.process_directory(pid)?.is_some() {
            return Err(invalid(
                "managed process identity is unreadable or ambiguous",
            ));
        }
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "managed process is absent",
        ));
    };
    if !safe_store_path(&identity.resolved_executable_path) {
        return Err(invalid(
            "managed process executable is outside the Nix store",
        ));
    }
    Ok(identity)
}

fn managed_record_binds(snapshot: &RecordSnapshot) -> bool {
    if !safe_store_path(&snapshot.record.resolved_executable_path)
        || snapshot.binary.content.is_empty()
    {
        return false;
    }
    store_executable_identity(&snapshot.record.resolved_executable_path).is_ok_and(|identity| {
        identity.is_some_and(|identity| {
            identity.dev == snapshot.binary.dev
                && identity.ino == snapshot.binary.ino
                && identity.content == snapshot.binary.content
        })
    })
}

fn active_managed_helper(paths: &ManagedPaths, current: &ProcessIdentity) -> io::Result<bool> {
    let root = match open_special_directory(&paths.proc_root) {
        Ok(root) => root,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    let process = ProcProcessControl {
        proc_root: paths.proc_root.clone(),
    };
    for name in directory_names(&root)? {
        let Ok(text) = std::str::from_utf8(name.to_bytes()) else {
            continue;
        };
        let Ok(pid) = text.parse::<u32>() else {
            continue;
        };
        if pid == std::process::id() {
            continue;
        }
        if process
            .identity_if_path(pid, &[&current.resolved_executable_path])?
            .is_some_and(|identity| managed_active_identity_matches(current, &identity))
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn managed_active_identity_matches(current: &ProcessIdentity, candidate: &ProcessIdentity) -> bool {
    candidate.resolved_executable_path == current.resolved_executable_path
        && candidate.executable.dev == current.executable.dev
        && candidate.executable.ino == current.executable.ino
        && candidate.executable.content == current.executable.content
}

fn create_launch_record(paths: &LifecyclePaths) -> io::Result<()> {
    let expected_dev = env::var(LAUNCH_DEV)
        .map_err(|_| invalid("incomplete launch identity"))?
        .parse::<u64>()
        .map_err(|_| invalid("invalid launch device identity"))?;
    let expected_ino = env::var(LAUNCH_INO)
        .map_err(|_| invalid("incomplete launch identity"))?
        .parse::<u64>()
        .map_err(|_| invalid("invalid launch inode identity"))?;
    let process = ProcProcessControl {
        proc_root: paths.proc_root.clone(),
    };
    let process_identity = process
        .identity(std::process::id())?
        .ok_or_else(|| invalid("current process identity is unavailable"))?;
    if process_identity.resolved_executable_path != paths.binary {
        return Err(invalid("current process path is not installed"));
    }
    let binary = process_binary_identity(&paths.proc_root, std::process::id())?
        .ok_or_else(|| invalid("current process binary identity is unavailable"))?;
    if binary.dev != expected_dev || binary.ino != expected_ino {
        return Err(invalid(
            "current process binary identity is not launched binary",
        ));
    }
    let installed = installed_binary(paths)?;
    if installed.identity != binary {
        return Err(invalid("installed binary changed during launch"));
    }
    if read_record_snapshot(paths.pid_record())
        .map_err(observed_io)?
        .is_some()
    {
        return Err(invalid("PID record appeared during launch"));
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    write_record_with_identity(
        paths.pid_record(),
        &LifecycleRecord {
            pid: std::process::id(),
            start_tick: process_identity.start_tick,
            resolved_executable_path: paths.binary.clone(),
            generation_token: format!("{:x}-{:x}", std::process::id(), nanos),
        },
        &binary,
    )
}

pub fn signal_current_record_ready() -> io::Result<()> {
    if env::var_os(LAUNCH_READY).is_none() {
        return Ok(());
    }
    let paths = LifecyclePaths::from_env()?;
    signal_launch_ready(&paths)
}

pub fn signal_managed_record_ready() -> io::Result<()> {
    validate_managed_environment()?;
    let paths = ManagedPaths::from_env()?;
    with_managed_lock_io(&paths, |_| {
        let Some(record) = read_managed_record(&paths)? else {
            return Err(invalid(
                "cannot signal managed readiness without a PID record",
            ));
        };
        let identity = managed_current_identity(&paths)?;
        if record.record.pid != std::process::id()
            || !managed_record_binds(&record)
            || !process_matches(&record, &identity)
        {
            return Err(invalid(
                "managed PID record identity changed before readiness",
            ));
        }
        Ok(())
    })
}

fn signal_launch_ready(paths: &LifecyclePaths) -> io::Result<()> {
    let Some(record) = read_record_snapshot(paths.pid_record()).map_err(observed_io)? else {
        return Err(invalid("cannot signal readiness without a PID record"));
    };
    if record.record.pid != std::process::id() || !record_binds(&record, paths) {
        return Err(invalid("PID record identity changed before readiness"));
    }
    let path = env_path(LAUNCH_READY)?;
    let expected_dev = env::var(LAUNCH_READY_DEV)
        .map_err(|_| invalid("incomplete launch readiness identity"))?
        .parse::<u64>()
        .map_err(|_| invalid("invalid launch readiness device identity"))?;
    let expected_ino = env::var(LAUNCH_READY_INO)
        .map_err(|_| invalid("incomplete launch readiness identity"))?
        .parse::<u64>()
        .map_err(|_| invalid("invalid launch readiness inode identity"))?;
    validate_path(&path)?;
    let parent = open_directory(
        path.parent()
            .ok_or_else(|| invalid("launch readiness file has no parent"))?,
        false,
    )?;
    let name = leaf_name(&path)?;
    let file = open_at(
        &parent,
        &name,
        OFlags::RDWR | OFlags::NOFOLLOW | OFlags::CLOEXEC,
    )?;
    let identity = identity_of(&file, Some(read_content(&file)?))?;
    if identity.dev != expected_dev
        || identity.ino != expected_ino
        || identity.mode != 0o600
        || identity.uid != current_uid()
        || !identity.content.is_empty()
    {
        return Err(invalid("launch readiness file identity changed"));
    }
    file.set_len(0)?;
    (&file).write_all(LAUNCH_READY_MARKER)?;
    file.sync_all()?;
    let ready = snapshot_file_at(&parent, &name)?.identity;
    if ready.dev != expected_dev
        || ready.ino != expected_ino
        || ready.mode != 0o600
        || ready.uid != current_uid()
        || ready.content != LAUNCH_READY_MARKER
    {
        return Err(invalid("launch readiness file identity changed"));
    }
    rfs::fsync(&parent).map_err(io::Error::from)
}

fn launch_ready_snapshot(
    paths: &LifecyclePaths,
    reservation: &FileSnapshot,
) -> io::Result<Option<FileSnapshot>> {
    let snapshot = match snapshot_file_at(&reservation.parent, &reservation.name) {
        Ok(snapshot) => snapshot,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if snapshot.identity.dev != reservation.identity.dev
        || snapshot.identity.ino != reservation.identity.ino
        || snapshot.identity.mode != 0o600
        || snapshot.identity.uid != current_uid()
    {
        return Err(invalid("launch readiness file identity changed"));
    }
    if snapshot.identity.content == LAUNCH_READY_MARKER {
        if read_record_snapshot(paths.pid_record())
            .map_err(observed_io)?
            .is_none()
        {
            return Err(invalid("launch readiness arrived without a PID record"));
        }
        Ok(Some(snapshot))
    } else if snapshot.identity.content.is_empty() {
        Ok(None)
    } else {
        Err(invalid("launch readiness marker is invalid"))
    }
}

fn create_current_record_locked(paths: &LifecyclePaths) -> io::Result<()> {
    ensure_no_debris(paths)?;
    let binary = installed_binary(paths)?;
    if let Some(existing) = read_record_snapshot(paths.pid_record()).map_err(observed_io)? {
        if !record_binds(&existing, paths) {
            return Err(invalid("retained PID record is mismatched"));
        }
        let process = ProcProcessControl {
            proc_root: paths.proc_root.clone(),
        };
        match process.identity(existing.record.pid)? {
            None => remove_file_snapshot_io(&existing.file)?,
            Some(identity) if process_matches(&existing, &identity) => {
                if existing.record.pid == std::process::id() {
                    return Ok(());
                }
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "tray helper is already active",
                ));
            }
            Some(_) => return Err(invalid("retained PID record is mismatched")),
        }
    }
    if let Err(error) = refuse_unrecorded_helper(paths, "create PID record") {
        return Err(invalid(&error));
    }
    let current = env::current_exe()?;
    if current != paths.binary {
        return Err(invalid(
            "current executable is not the installed tray binary",
        ));
    }
    if installed_identity(&current)?.as_ref() != Some(&binary.identity) {
        return Err(invalid("current executable identity is not installed"));
    }
    let process = ProcProcessControl {
        proc_root: paths.proc_root.clone(),
    };
    let identity = process
        .identity(std::process::id())?
        .ok_or_else(|| invalid("current process identity is unavailable"))?;
    if identity.resolved_executable_path != paths.binary {
        return Err(invalid("current process path is not installed"));
    }
    let raw = i32::try_from(std::process::id()).map_err(|_| invalid("PID is out of range"))?;
    let _pidfd = pidfd_open(
        Pid::from_raw(raw).ok_or_else(|| invalid("PID is zero"))?,
        PidfdFlags::empty(),
    )
    .map_err(io::Error::from)?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    write_record(
        paths.pid_record(),
        &LifecycleRecord {
            pid: std::process::id(),
            start_tick: identity.start_tick,
            resolved_executable_path: paths.binary.clone(),
            generation_token: format!("{:x}-{:x}", std::process::id(), nanos),
        },
    )
}

pub fn cleanup_current_record() -> Result<(), String> {
    let paths = LifecyclePaths::from_env().map_err(|e| e.to_string())?;
    if env::var_os(LAUNCH_DEV).is_some() || env::var_os(LAUNCH_INO).is_some() {
        return cleanup_current_record_locked(&paths);
    }
    with_lock(&paths, |_| cleanup_current_record_locked(&paths))
}

pub fn cleanup_managed_record() -> Result<(), String> {
    validate_managed_environment().map_err(|e| e.to_string())?;
    let paths = ManagedPaths::from_env().map_err(|e| e.to_string())?;
    with_managed_lock(&paths, |_| cleanup_managed_record_locked(&paths))
}

fn cleanup_managed_record_locked(paths: &ManagedPaths) -> Result<(), String> {
    let Some(record) = read_managed_record(paths).map_err(|e| e.to_string())? else {
        return Ok(());
    };
    if !managed_record_binds(&record) || record.record.pid != std::process::id() {
        return Ok(());
    }
    let identity = managed_current_identity(paths).map_err(|e| e.to_string())?;
    if process_matches(&record, &identity) {
        remove_file_snapshot(&record.file)?;
    }
    Ok(())
}

fn cleanup_current_record_locked(paths: &LifecyclePaths) -> Result<(), String> {
    let record_result = (|| {
        let Some(snapshot) = read_record_snapshot(paths.pid_record()).map_err(observed_string)?
        else {
            return Ok(());
        };
        if snapshot.record.pid != std::process::id() || !record_binds(&snapshot, paths) {
            return Ok(());
        }
        let process = ProcProcessControl {
            proc_root: paths.proc_root.clone(),
        };
        if process
            .identity(snapshot.record.pid)
            .map_err(|e| e.to_string())?
            .is_some_and(|i| process_matches(&snapshot, &i))
        {
            remove_file_snapshot(&snapshot.file)?;
        }
        Ok(())
    })();
    let ready_result = cleanup_launch_ready();
    match (record_result, ready_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
        (Err(record), Err(ready)) => Err(format!("{record}; {ready}")),
    }
}

fn cleanup_launch_ready() -> Result<(), String> {
    if env::var_os(LAUNCH_READY).is_none() {
        return Ok(());
    }
    let path = env_path(LAUNCH_READY).map_err(|e| e.to_string())?;
    let Some(snapshot) = read_file_snapshot(&path).map_err(|e| e.to_string())? else {
        return Ok(());
    };
    let expected_dev = env::var(LAUNCH_READY_DEV)
        .map_err(|_| "incomplete launch readiness identity".to_owned())?
        .parse::<u64>()
        .map_err(|_| "invalid launch readiness device identity".to_owned())?;
    let expected_ino = env::var(LAUNCH_READY_INO)
        .map_err(|_| "incomplete launch readiness identity".to_owned())?
        .parse::<u64>()
        .map_err(|_| "invalid launch readiness inode identity".to_owned())?;
    if snapshot.identity.dev != expected_dev
        || snapshot.identity.ino != expected_ino
        || snapshot.identity.mode != 0o600
        || snapshot.identity.uid != current_uid()
        || (snapshot.identity.content != LAUNCH_READY_MARKER
            && !snapshot.identity.content.is_empty())
    {
        return Err("launch readiness file identity changed during cleanup".to_owned());
    }
    remove_file_snapshot(&snapshot)
}

pub fn status_command() -> Result<(), String> {
    let paths = LifecyclePaths::from_env().map_err(|e| e.to_string())?;
    with_lock(&paths, |_| {
        ensure_no_debris(&paths).map_err(|e| e.to_string())?;
        let Some(snapshot) = owned_record(&paths)? else {
            refuse_unrecorded_helper(&paths, "status")?;
            println!("status: stopped");
            return Ok(());
        };
        if !record_binds(&snapshot, &paths) {
            println!("status: unknown (mismatched identity; record retained)");
            return Ok(());
        }
        let process = ProcProcessControl {
            proc_root: paths.proc_root.clone(),
        };
        match process.identity(snapshot.record.pid) {
            Ok(None) => println!("status: stopped (stale record retained)"),
            Ok(Some(identity)) if process_matches(&snapshot, &identity) => {
                println!("status: running (pid {})", snapshot.record.pid)
            }
            Ok(Some(_)) => println!("status: unknown (mismatched process; record retained)"),
            Err(_) => println!("status: unknown (unreadable process identity; record retained)"),
        }
        Ok(())
    })
}

pub fn stop_command() -> Result<(), String> {
    let paths = LifecyclePaths::from_env().map_err(|e| e.to_string())?;
    with_lock(&paths, |_| {
        ensure_no_debris(&paths).map_err(|e| e.to_string())?;
        match stop_locked(
            &paths,
            &ProcProcessControl {
                proc_root: paths.proc_root.clone(),
            },
        )? {
            StopOutcome::NoRecord => println!("stop: no marker-owned record"),
            StopOutcome::RemovedStaleRecord => println!("stop: removed stale record"),
            StopOutcome::Stopped => println!("stop: stopped helper"),
            StopOutcome::Retained(reason) => {
                return Err(format!("stop: retained {reason} PID record"));
            }
        }
        Ok(())
    })
}

pub fn start_command() -> Result<(), String> {
    let paths = LifecyclePaths::from_env().map_err(|e| e.to_string())?;
    with_lock(&paths, |_| start_locked(&paths))
}

fn start_locked(paths: &LifecyclePaths) -> Result<(), String> {
    ensure_no_debris(paths).map_err(|e| e.to_string())?;
    if let Some(snapshot) = owned_record(paths)? {
        if !record_binds(&snapshot, paths) {
            return Err("start: retained mismatched PID record".to_owned());
        }
        let process = ProcProcessControl {
            proc_root: paths.proc_root.clone(),
        };
        match process
            .identity(snapshot.record.pid)
            .map_err(|e| e.to_string())?
        {
            Some(identity) if process_matches(&snapshot, &identity) => {
                return Err("start: helper is already active".to_owned());
            }
            Some(_) => return Err("start: retained mismatched PID record".to_owned()),
            None => remove_file_snapshot(&snapshot.file)?,
        }
    }
    refuse_unrecorded_helper(paths, "start")?;
    let binary =
        installed_binary(paths).map_err(|e| format!("tray helper is not installed: {e}"))?;
    let runtime_parent = open_directory(
        paths
            .pid_record
            .parent()
            .ok_or_else(|| "record has no parent".to_owned())?,
        true,
    )
    .map_err(|e| format!("start: reserve launch: {e}"))?;
    let reservation_name = unique_name(".plasma-auto-tiler-start");
    let mut reservation = match (|| {
        let file = create_file_at(&runtime_parent, &reservation_name, 0o600)?;
        file.sync_all()?;
        rfs::fsync(&runtime_parent).map_err(io::Error::from)?;
        snapshot_file_at(&runtime_parent, &reservation_name)
    })() {
        Ok(snapshot) => snapshot,
        Err(error) => {
            return Err(
                match remove_partial_file(&runtime_parent, &reservation_name, 0o600, Some(&[])) {
                    Ok(()) => format!("start: reserve launch: {error}"),
                    Err(cleanup) => {
                        format!("start: reserve launch: {error}; recovery-required: {cleanup}")
                    }
                },
            );
        }
    };
    let child = match Command::new(descriptor_exec_path(&binary.file))
        .env(LAUNCH_DEV, binary.identity.dev.to_string())
        .env(LAUNCH_INO, binary.identity.ino.to_string())
        .env(
            LAUNCH_READY,
            paths
                .pid_record
                .parent()
                .ok_or_else(|| "record has no parent".to_owned())?
                .join(reservation_name.to_string_lossy().as_ref()),
        )
        .env(LAUNCH_READY_DEV, reservation.identity.dev.to_string())
        .env(LAUNCH_READY_INO, reservation.identity.ino.to_string())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            let cleanup = remove_file_snapshot_io(&reservation);
            return Err(cleanup.err().map_or_else(
                || format!("start: {error}"),
                |cleanup| format!("start: {error}; recovery-required: {cleanup}"),
            ));
        }
    };
    let child_pid = child.id();
    let process = ProcProcessControl {
        proc_root: paths.proc_root.clone(),
    };
    let mut child = child;
    let mut observed_identity = None;
    let mut failure = None;
    let mut ready_polls = 0;
    for _ in 0..200 {
        if let Some(status) = child.try_wait().map_err(|error| {
            rollback_start(
                paths,
                &reservation,
                &mut child,
                child_pid,
                observed_identity.as_ref(),
                &binary.identity,
            )
            .err()
            .map_or_else(
                || format!("start: wait for endpoint: {error}"),
                |rollback| format!("start: wait for endpoint: {error}; {rollback}"),
            )
        })? {
            failure = Some(format!("start: helper exited during startup ({status})"));
            break;
        }
        match process.identity(child_pid) {
            Ok(Some(identity)) => {
                observed_identity = Some(identity.clone());
                if identity.resolved_executable_path != paths.binary {
                    failure = Some("start: launch identity mismatch".to_owned());
                    break;
                }
                match process_binary_identity(&paths.proc_root, child_pid) {
                    Ok(Some(actual)) if actual == binary.identity => {}
                    Ok(Some(_)) => {
                        failure = Some("start: launch binary identity mismatch".to_owned());
                        break;
                    }
                    Ok(None) => {
                        failure = Some("start: launch binary identity is unavailable".to_owned());
                        break;
                    }
                    Err(error) => {
                        failure = Some(format!("start: launch binary identity: {error}"));
                        break;
                    }
                }
            }
            Ok(None) => {
                failure = Some("start: launch identity is unavailable".to_owned());
                break;
            }
            Err(error) => {
                failure = Some(format!("start: launch identity: {error}"));
                break;
            }
        }
        let ready = match launch_ready_snapshot(paths, &reservation) {
            Ok(Some(snapshot)) => {
                reservation = snapshot;
                true
            }
            Ok(None) => false,
            Err(error) => {
                failure = Some(format!("start: endpoint readiness: {error}"));
                break;
            }
        };
        match read_record_snapshot(paths.pid_record()) {
            Ok(Some(record))
                if ready
                    && record.record.pid == child_pid
                    && observed_identity
                        .as_ref()
                        .is_some_and(|identity| process_matches(&record, identity))
                    && record.binary == binary.identity
                    && record_binds(&record, paths) =>
            {
                ready_polls += 1;
                if ready_polls < 2 {
                    thread::sleep(Duration::from_millis(10));
                    continue;
                }
                if let Err(error) = remove_launch_reservation(&reservation) {
                    let rollback = rollback_start(
                        paths,
                        &reservation,
                        &mut child,
                        child_pid,
                        observed_identity.as_ref(),
                        &binary.identity,
                    );
                    return Err(rollback.err().map_or_else(
                        || format!("start: release launch reservation: {error}"),
                        |rollback| {
                            format!("start: release launch reservation: {error}; {rollback}")
                        },
                    ));
                }
                println!("start: launched helper PID {child_pid}");
                return Ok(());
            }
            Ok(Some(record))
                if record.record.pid != child_pid
                    || !observed_identity
                        .as_ref()
                        .is_some_and(|identity| process_matches(&record, identity))
                    || record.binary != binary.identity
                    || !record_binds(&record, paths) =>
            {
                failure = Some("start: child PID record identity mismatch".to_owned());
                break;
            }
            Ok(Some(_)) => {}
            Ok(None) => {}
            Err(error) => {
                failure = Some(format!(
                    "start: child PID record: {}",
                    observed_string(error)
                ));
                break;
            }
        }
        thread::sleep(Duration::from_millis(10));
    }
    if failure.is_none() {
        failure = Some("start: endpoint did not establish PID record".to_owned());
    }
    let rollback = rollback_start(
        paths,
        &reservation,
        &mut child,
        child_pid,
        observed_identity.as_ref(),
        &binary.identity,
    );
    if let Err(rollback) = rollback {
        return Err(format!("{}; {rollback}", failure.unwrap()));
    }
    Err(failure.unwrap())
}

fn rollback_start(
    paths: &LifecyclePaths,
    reservation: &FileSnapshot,
    child: &mut Child,
    child_pid: u32,
    observed_identity: Option<&ProcessIdentity>,
    binary: &FileIdentity,
) -> Result<(), String> {
    let process = ProcProcessControl {
        proc_root: paths.proc_root.clone(),
    };
    let child_exited = child
        .try_wait()
        .map_err(|error| format!("start: wait for child rollback: {error}"))?
        .is_some();
    if !child_exited && observed_identity.is_none() {
        return Err("start: child identity unavailable during rollback".to_owned());
    }
    if !child_exited && let Some(identity) = observed_identity {
        match process.identity(child_pid) {
            Ok(None) => {
                return Err("start: child identity unavailable during rollback".to_owned());
            }
            Ok(Some(current)) if &current == identity => {
                process
                    .terminate(child_pid, identity)
                    .map_err(|error| format!("start: child retained after rollback: {error}"))?;
                let mut stopped = false;
                for _ in 0..20 {
                    if child
                        .try_wait()
                        .map_err(|error| format!("start: wait for child rollback: {error}"))?
                        .is_some()
                    {
                        stopped = true;
                        break;
                    }
                    match process.identity(child_pid) {
                        Ok(None) => {
                            stopped = true;
                            break;
                        }
                        Ok(Some(current)) if &current == identity => {
                            thread::sleep(Duration::from_millis(10));
                        }
                        Ok(Some(_)) => {
                            return Err("start: child identity changed during rollback".to_owned());
                        }
                        Err(error) => {
                            return Err(format!("start: wait for child rollback: {error}"));
                        }
                    }
                }
                if !stopped {
                    return Err("start: child retained after rollback".to_owned());
                }
            }
            Ok(Some(_)) => {
                return Err("start: child identity changed during rollback".to_owned());
            }
            Err(error) => {
                return Err(format!("start: child identity during rollback: {error}"));
            }
        }
    }
    match read_record_snapshot(paths.pid_record()) {
        Ok(Some(_)) if observed_identity.is_none() => {
            return Err("start: child identity unavailable during rollback".to_owned());
        }
        Ok(Some(record))
            if record.record.pid == child_pid
                && observed_identity.is_none_or(|identity| process_matches(&record, identity))
                && record.binary == *binary
                && record_binds(&record, paths) =>
        {
            remove_file_snapshot(&record.file)?;
        }
        Ok(Some(_)) => {
            return Err("start: retained mismatched PID record during rollback".to_owned());
        }
        Ok(None) => {}
        Err(error) => {
            return Err(format!(
                "start: PID record during rollback: {}",
                observed_string(error)
            ));
        }
    }
    remove_launch_reservation(reservation)?;
    Ok(())
}

pub fn install_command() -> Result<(), String> {
    let paths = LifecyclePaths::from_env().map_err(|e| e.to_string())?;
    with_lock(&paths, |_| {
        let source = env::current_exe().map_err(|e| e.to_string())?;
        install_locked(&paths, &source)
    })
}

pub fn install_with_source(paths: &LifecyclePaths, source: &Path) -> Result<(), String> {
    with_lock(paths, |_| install_locked(paths, source))
}

fn install_locked(paths: &LifecyclePaths, source: &Path) -> Result<(), String> {
    ensure_no_debris(paths).map_err(|e| e.to_string())?;
    let source = read_source_snapshot(source)
        .map_err(|e| format!("read source: {e}"))?
        .ok_or_else(|| "source executable is absent".to_owned())?;
    let source_mode = source.file.metadata().map_err(|e| e.to_string())?.mode();
    if source.identity.content.is_empty() || source_mode & 0o111 == 0 {
        return Err("source executable is not executable".to_owned());
    }
    let data_parent = open_directory(
        paths
            .data_root
            .parent()
            .ok_or_else(|| invalid("data root has no parent"))
            .map_err(|e| e.to_string())?,
        true,
    )
    .map_err(|e| format!("open data parent: {e}"))?;
    let config_parent = open_directory(
        paths
            .desktop
            .parent()
            .ok_or_else(|| invalid("desktop has no parent"))
            .map_err(|e| e.to_string())?,
        true,
    )
    .map_err(|e| format!("open config parent: {e}"))?;
    let old_data = snapshot_tree(paths.data_root()).map_err(|e| e.to_string())?;
    let old_desktop = read_file_snapshot(paths.desktop()).map_err(|e| e.to_string())?;
    if let Some(tree) = old_data.as_ref() {
        validate_project_tree(tree)
            .map_err(|_| "retained unowned or unexpected data tree".to_owned())?;
    }
    if let Some(file) = old_desktop.as_ref() {
        validate_desktop(file, paths)
            .map_err(|_| "retained unowned or invalid desktop entry".to_owned())?;
    }
    reconcile_helper_for_install(paths)?;

    let data_candidate_name = unique_name(".plasma-auto-tiler-data-install");
    let desktop_candidate_name = unique_name(".plasma-auto-tiler-desktop-install");
    let candidate_data = create_candidate_tree(&data_parent, &data_candidate_name, &source)
        .map_err(|e| format!("create data candidate: {e}"))?;
    let candidate_desktop =
        match create_candidate_desktop(&config_parent, &desktop_candidate_name, paths) {
            Ok(file) => file,
            Err(e) => {
                let cleanup = remove_tree_named(&candidate_data, &data_candidate_name);
                return Err(install_failure(
                    format!("create desktop candidate: {e}"),
                    cleanup,
                ));
            }
        };
    let data_backup = unique_name(".plasma-auto-tiler-data-backup");
    let desktop_backup = unique_name(".plasma-auto-tiler-desktop-backup");
    let mut data_backed = false;
    let mut desktop_backed = false;
    if let Some(old) = old_data.as_ref() {
        if let Err(e) = move_tree(old, &data_backup) {
            let backed = e.renamed;
            let rollback = rollback_install(
                paths,
                &candidate_data,
                &candidate_desktop,
                false,
                false,
                backed.then_some(&data_backup),
                None,
                &data_candidate_name,
                &desktop_candidate_name,
                &old_data,
                &old_desktop,
            );
            return Err(install_failure(
                format!("backup data: {}", e.error),
                rollback,
            ));
        }
        data_backed = true;
    }
    if let Some(old) = old_desktop.as_ref() {
        if let Err(e) = move_file(old, &desktop_backup) {
            let backed = e.renamed;
            let rollback = rollback_install(
                paths,
                &candidate_data,
                &candidate_desktop,
                false,
                false,
                data_backed.then_some(&data_backup),
                backed.then_some(&desktop_backup),
                &data_candidate_name,
                &desktop_candidate_name,
                &old_data,
                &old_desktop,
            );
            return Err(install_failure(
                format!("backup desktop: {}", e.error),
                rollback,
            ));
        }
        desktop_backed = true;
    }
    let data_leaf = leaf_name(paths.data_root()).map_err(|e| e.to_string())?;
    let desktop_leaf = leaf_name(paths.desktop()).map_err(|e| e.to_string())?;
    if let Err(e) = verify_named(
        &data_parent,
        &data_candidate_name,
        &candidate_data.root_identity,
        true,
    ) {
        let rollback = rollback_install(
            paths,
            &candidate_data,
            &candidate_desktop,
            false,
            false,
            data_backed.then_some(&data_backup),
            desktop_backed.then_some(&desktop_backup),
            &data_candidate_name,
            &desktop_candidate_name,
            &old_data,
            &old_desktop,
        );
        return Err(install_failure(format!("promote data: {e}"), rollback));
    }
    let data_promoted =
        match rename_noreplace(&data_parent, &data_candidate_name, &data_parent, &data_leaf) {
            Ok(()) => true,
            Err(e) => {
                let rollback = rollback_install(
                    paths,
                    &candidate_data,
                    &candidate_desktop,
                    false,
                    false,
                    data_backed.then_some(&data_backup),
                    desktop_backed.then_some(&desktop_backup),
                    &data_candidate_name,
                    &desktop_candidate_name,
                    &old_data,
                    &old_desktop,
                );
                return Err(install_failure(format!("promote data: {e}"), rollback));
            }
        };
    if let Err(e) = verify_named(
        &config_parent,
        &desktop_candidate_name,
        &candidate_desktop.identity,
        false,
    ) {
        let rollback = rollback_install(
            paths,
            &candidate_data,
            &candidate_desktop,
            data_promoted,
            false,
            data_backed.then_some(&data_backup),
            desktop_backed.then_some(&desktop_backup),
            &data_candidate_name,
            &desktop_candidate_name,
            &old_data,
            &old_desktop,
        );
        return Err(install_failure(format!("promote desktop: {e}"), rollback));
    }
    let desktop_promoted = match rename_noreplace(
        &config_parent,
        &desktop_candidate_name,
        &config_parent,
        &desktop_leaf,
    ) {
        Ok(()) => true,
        Err(e) => {
            let rollback = rollback_install(
                paths,
                &candidate_data,
                &candidate_desktop,
                data_promoted,
                false,
                data_backed.then_some(&data_backup),
                desktop_backed.then_some(&desktop_backup),
                &data_candidate_name,
                &desktop_candidate_name,
                &old_data,
                &old_desktop,
            );
            return Err(rollback.err().map_or_else(
                || format!("promote desktop: {e}"),
                |r| format!("promote desktop: {e}; recovery-required: {r}"),
            ));
        }
    };
    if let Err(error) = rfs::fsync(&data_parent) {
        let rollback = rollback_install(
            paths,
            &candidate_data,
            &candidate_desktop,
            data_promoted,
            desktop_promoted,
            data_backed.then_some(&data_backup),
            desktop_backed.then_some(&desktop_backup),
            &data_candidate_name,
            &desktop_candidate_name,
            &old_data,
            &old_desktop,
        );
        return Err(rollback.err().map_or_else(
            || format!("sync data parent: {error}"),
            |recovery| format!("sync data parent: {error}; recovery-required: {recovery}"),
        ));
    }
    if let Err(error) = rfs::fsync(&config_parent) {
        let rollback = rollback_install(
            paths,
            &candidate_data,
            &candidate_desktop,
            data_promoted,
            desktop_promoted,
            data_backed.then_some(&data_backup),
            desktop_backed.then_some(&desktop_backup),
            &data_candidate_name,
            &desktop_candidate_name,
            &old_data,
            &old_desktop,
        );
        return Err(rollback.err().map_or_else(
            || format!("sync config parent: {error}"),
            |recovery| format!("sync config parent: {error}; recovery-required: {recovery}"),
        ));
    }
    if let (Some(old), true) = (old_data.as_ref(), data_backed)
        && let Err(error) = remove_install_backup_tree(old, &data_backup)
    {
        return Err(format!(
            "install: clean data backup: {error}; recovery-required: install backup residue retained"
        ));
    }
    if let (Some(old), true) = (old_desktop.as_ref(), desktop_backed)
        && let Err(error) = remove_file_named(old, &desktop_backup)
    {
        return Err(format!(
            "install: clean desktop backup: {error}; recovery-required: install backup residue retained"
        ));
    }
    println!(
        "tray-installed: {}\ntray-autostart: {}",
        paths.binary().display(),
        paths.desktop().display()
    );
    Ok(())
}

fn install_failure(error: String, rollback: Result<(), String>) -> String {
    match rollback {
        Ok(()) => error,
        Err(rollback) => format!("{error}; recovery-required: {rollback}"),
    }
}

#[allow(clippy::too_many_arguments)]
fn rollback_install(
    paths: &LifecyclePaths,
    candidate_data: &TreeSnapshot,
    candidate_desktop: &FileSnapshot,
    data_promoted: bool,
    desktop_promoted: bool,
    data_backup: Option<&CString>,
    desktop_backup: Option<&CString>,
    data_candidate: &CString,
    desktop_candidate_name: &CString,
    old_data: &Option<TreeSnapshot>,
    old_desktop: &Option<FileSnapshot>,
) -> Result<(), String> {
    let data_parent = open_directory(
        paths
            .data_root
            .parent()
            .ok_or_else(|| "data root has no parent".to_owned())?,
        false,
    )
    .map_err(|e| e.to_string())?;
    let config_parent = open_directory(
        paths
            .desktop
            .parent()
            .ok_or_else(|| "desktop has no parent".to_owned())?,
        false,
    )
    .map_err(|e| e.to_string())?;
    let data_name = leaf_name(paths.data_root()).map_err(|e| e.to_string())?;
    let desktop_name = leaf_name(paths.desktop()).map_err(|e| e.to_string())?;
    let mut failures = Vec::new();
    let cleanup_data = if data_promoted {
        remove_tree_named(candidate_data, &data_name)
    } else {
        remove_tree_named(candidate_data, data_candidate)
    };
    if let Err(error) = cleanup_data {
        failures.push(format!("clean data candidate: {error}"));
    }
    let cleanup_desktop = if desktop_promoted {
        remove_file_named(candidate_desktop, &desktop_name)
    } else {
        remove_file_named(candidate_desktop, desktop_candidate_name)
    };
    if let Err(error) = cleanup_desktop {
        failures.push(format!("clean desktop candidate: {error}"));
    }
    if let (Some(old), Some(backup)) = (old_data.as_ref(), data_backup) {
        let restored = verify_named(&data_parent, backup, &old.root_identity, true)
            .and_then(|_| {
                if path_exists(paths.data_root())? {
                    return Err(invalid("data replacement is ambiguous"));
                }
                rename_noreplace(&data_parent, backup, &data_parent, &data_name)
            })
            .and_then(|_| rfs::fsync(&data_parent).map_err(io::Error::from));
        if let Err(error) = restored {
            failures.push(format!("restore data backup: {error}"));
        }
    }
    if let (Some(old), Some(backup)) = (old_desktop.as_ref(), desktop_backup) {
        let restored = verify_named(&config_parent, backup, &old.identity, false)
            .and_then(|_| {
                if path_exists(paths.desktop())? {
                    return Err(invalid("desktop replacement is ambiguous"));
                }
                rename_noreplace(&config_parent, backup, &config_parent, &desktop_name)
            })
            .and_then(|_| rfs::fsync(&config_parent).map_err(io::Error::from));
        if let Err(error) = restored {
            failures.push(format!("restore desktop backup: {error}"));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

pub fn remove_command() -> Result<(), String> {
    let paths = LifecyclePaths::from_env().map_err(|e| e.to_string())?;
    with_lock(&paths, |_| remove_locked(&paths))
}

pub fn remove_with_paths(paths: &LifecyclePaths) -> Result<(), String> {
    with_lock(paths, |_| remove_locked(paths))
}

fn remove_locked(paths: &LifecyclePaths) -> Result<(), String> {
    ensure_no_debris(paths).map_err(|e| e.to_string())?;
    let record = owned_record(paths)?;
    let record_backup_name = unique_name(".plasma-auto-tiler-pid-remove");
    let data_name = unique_name(".plasma-auto-tiler-data-remove");
    let desktop_name = unique_name(".plasma-auto-tiler-desktop-remove");
    let record_backup = match record.as_ref() {
        Some(record) => Some(copy_file(&record.file, &record_backup_name)?),
        None => None,
    };
    if record.is_some() {
        let stop = stop_locked(
            paths,
            &ProcProcessControl {
                proc_root: paths.proc_root.clone(),
            },
        );
        let outcome = match stop {
            Ok(outcome) => outcome,
            Err(error) => {
                let rollback = rollback_remove(
                    paths,
                    record.as_ref(),
                    record_backup.as_ref(),
                    None,
                    None,
                    None,
                    None,
                    &record_backup_name,
                    &unique_name(".plasma-auto-tiler-data-remove"),
                    &unique_name(".plasma-auto-tiler-desktop-remove"),
                );
                return Err(remove_failure(
                    format!("remove: stop helper: {error}"),
                    rollback,
                ));
            }
        };
        if let StopOutcome::Retained(reason) = outcome {
            let rollback = rollback_remove(
                paths,
                record.as_ref(),
                record_backup.as_ref(),
                None,
                None,
                None,
                None,
                &record_backup_name,
                &unique_name(".plasma-auto-tiler-data-remove"),
                &unique_name(".plasma-auto-tiler-desktop-remove"),
            );
            return Err(remove_failure(
                format!("remove: stop retained {reason} PID record"),
                rollback,
            ));
        }
    } else {
        refuse_unrecorded_helper(paths, "remove")?;
    }
    let data = match snapshot_tree(paths.data_root()) {
        Ok(data) => data,
        Err(error) => {
            let rollback = rollback_remove(
                paths,
                record.as_ref(),
                record_backup.as_ref(),
                None,
                None,
                None,
                None,
                &record_backup_name,
                &data_name,
                &desktop_name,
            );
            return Err(remove_failure(
                format!("remove: inspect data: {error}"),
                rollback,
            ));
        }
    };
    let desktop = match read_file_snapshot(paths.desktop()) {
        Ok(desktop) => desktop,
        Err(error) => {
            let rollback = rollback_remove(
                paths,
                record.as_ref(),
                record_backup.as_ref(),
                data.as_ref(),
                None,
                None,
                None,
                &record_backup_name,
                &data_name,
                &desktop_name,
            );
            return Err(remove_failure(
                format!("remove: inspect desktop: {error}"),
                rollback,
            ));
        }
    };
    if let Some(tree) = data.as_ref()
        && let Err(error) = validate_project_tree(tree)
    {
        let rollback = rollback_remove(
            paths,
            record.as_ref(),
            record_backup.as_ref(),
            data.as_ref(),
            None,
            None,
            None,
            &record_backup_name,
            &data_name,
            &desktop_name,
        );
        return Err(remove_failure(
            format!("remove: retained unowned or unexpected data tree: {error}"),
            rollback,
        ));
    }
    if let Some(file) = desktop.as_ref()
        && let Err(error) = validate_desktop(file, paths)
    {
        let rollback = rollback_remove(
            paths,
            record.as_ref(),
            record_backup.as_ref(),
            data.as_ref(),
            None,
            None,
            None,
            &record_backup_name,
            &data_name,
            &desktop_name,
        );
        return Err(remove_failure(
            format!("remove: retained unowned or invalid desktop entry: {error}"),
            rollback,
        ));
    }
    if data.is_none() && desktop.is_none() {
        cleanup_remove_copies(record_backup.as_ref(), None, None).map_err(|error| {
            format!("remove: cleanup rollback copies; recovery-required: {error}")
        })?;
        println!("remove: nothing installed");
        return Ok(());
    }
    let data_copy = match data.as_ref() {
        Some(data) => match copy_tree(data, &data_name) {
            Ok(copy) => Some(copy),
            Err(error) => {
                let rollback = rollback_remove(
                    paths,
                    record.as_ref(),
                    record_backup.as_ref(),
                    Some(data),
                    None,
                    None,
                    None,
                    &record_backup_name,
                    &data_name,
                    &desktop_name,
                );
                return Err(remove_failure(
                    format!("copy data rollback: {error}"),
                    rollback,
                ));
            }
        },
        None => None,
    };
    let desktop_copy = match desktop.as_ref() {
        Some(desktop) => match copy_file(desktop, &desktop_name) {
            Ok(copy) => Some(copy),
            Err(error) => {
                let rollback = rollback_remove(
                    paths,
                    record.as_ref(),
                    record_backup.as_ref(),
                    data.as_ref(),
                    data_copy.as_ref(),
                    Some(desktop),
                    None,
                    &record_backup_name,
                    &data_name,
                    &desktop_name,
                );
                return Err(remove_failure(
                    format!("copy desktop rollback: {error}"),
                    rollback,
                ));
            }
        },
        None => None,
    };
    let data_quarantine = unique_name(".plasma-auto-tiler-data-quarantine");
    let desktop_quarantine = unique_name(".plasma-auto-tiler-desktop-quarantine");
    if let Some(tree) = data.as_ref()
        && let Err(error) = quarantine_tree(tree, &data_quarantine)
    {
        let rollback = rollback_remove(
            paths,
            record.as_ref(),
            record_backup.as_ref(),
            data.as_ref(),
            data_copy.as_ref(),
            desktop.as_ref(),
            desktop_copy.as_ref(),
            &record_backup_name,
            &data_name,
            &desktop_name,
        );
        return Err(remove_failure(
            format!("quarantine data: {error}"),
            rollback,
        ));
    }
    if let Some(file) = desktop.as_ref()
        && let Err(error) = quarantine_file(file, &desktop_quarantine)
    {
        let rollback = rollback_remove(
            paths,
            record.as_ref(),
            record_backup.as_ref(),
            data.as_ref(),
            data_copy.as_ref(),
            desktop.as_ref(),
            desktop_copy.as_ref(),
            &record_backup_name,
            &data_name,
            &desktop_name,
        );
        return Err(remove_failure(
            format!("quarantine desktop: {error}"),
            rollback,
        ));
    }
    if let Some(data) = data.as_ref() {
        let tree = match snapshot_tree_at(&data.parent, &data_quarantine).and_then(|tree| {
            validate_project_tree(&tree)?;
            Ok(tree)
        }) {
            Ok(tree) => tree,
            Err(error) => {
                let rollback = rollback_remove(
                    paths,
                    record.as_ref(),
                    record_backup.as_ref(),
                    Some(data),
                    data_copy.as_ref(),
                    desktop.as_ref(),
                    desktop_copy.as_ref(),
                    &record_backup_name,
                    &data_name,
                    &desktop_name,
                );
                return Err(remove_failure(
                    format!("verify quarantined data: {error}"),
                    rollback,
                ));
            }
        };
        if let Err(error) = remove_tree_named_for_remove(&tree, &data_quarantine) {
            let rollback = rollback_remove(
                paths,
                record.as_ref(),
                record_backup.as_ref(),
                Some(data),
                data_copy.as_ref(),
                desktop.as_ref(),
                desktop_copy.as_ref(),
                &record_backup_name,
                &data_name,
                &desktop_name,
            );
            return Err(remove_failure(
                format!("remove quarantined data: {error}"),
                rollback,
            ));
        }
    }
    if let Some(desktop) = desktop.as_ref() {
        let file = match snapshot_file_at(&desktop.parent, &desktop_quarantine).and_then(|file| {
            validate_desktop(&file, paths)?;
            Ok(file)
        }) {
            Ok(file) => file,
            Err(error) => {
                let rollback = rollback_remove(
                    paths,
                    record.as_ref(),
                    record_backup.as_ref(),
                    data.as_ref(),
                    data_copy.as_ref(),
                    Some(desktop),
                    desktop_copy.as_ref(),
                    &record_backup_name,
                    &data_name,
                    &desktop_name,
                );
                return Err(remove_failure(
                    format!("verify quarantined desktop: {error}"),
                    rollback,
                ));
            }
        };
        if let Err(error) = remove_file_named_for_remove(&file, &desktop_quarantine) {
            let rollback = rollback_remove(
                paths,
                record.as_ref(),
                record_backup.as_ref(),
                data.as_ref(),
                data_copy.as_ref(),
                Some(desktop),
                desktop_copy.as_ref(),
                &record_backup_name,
                &data_name,
                &desktop_name,
            );
            return Err(remove_failure(
                format!("remove quarantined desktop: {error}"),
                rollback,
            ));
        }
    }
    let replacement = match (|| {
        Ok::<_, io::Error>(path_exists(paths.data_root())? || path_exists(paths.desktop())?)
    })() {
        Ok(replacement) => replacement,
        Err(error) => {
            let rollback = rollback_remove(
                paths,
                record.as_ref(),
                record_backup.as_ref(),
                data.as_ref(),
                data_copy.as_ref(),
                desktop.as_ref(),
                desktop_copy.as_ref(),
                &record_backup_name,
                &data_name,
                &desktop_name,
            );
            return Err(remove_failure(
                format!("remove: verify removal: {error}"),
                rollback,
            ));
        }
    };
    if replacement {
        let rollback = rollback_remove(
            paths,
            record.as_ref(),
            record_backup.as_ref(),
            data.as_ref(),
            data_copy.as_ref(),
            desktop.as_ref(),
            desktop_copy.as_ref(),
            &record_backup_name,
            &data_name,
            &desktop_name,
        );
        return Err(remove_failure(
            "remove: replacement retained".to_owned(),
            rollback,
        ));
    }
    cleanup_remove_copies(
        record_backup.as_ref(),
        data_copy.as_ref(),
        desktop_copy.as_ref(),
    )
    .map_err(|error| format!("remove: cleanup rollback copies; recovery-required: {error}"))?;
    println!("remove: removed marker-owned tray artifacts");
    Ok(())
}

fn remove_failure(error: String, rollback: Result<(), String>) -> String {
    match rollback {
        Ok(()) => error,
        Err(rollback) => format!("{error}; recovery-required: {rollback}"),
    }
}

fn cleanup_remove_copies(
    record: Option<&FileSnapshot>,
    data: Option<&TreeSnapshot>,
    desktop: Option<&FileSnapshot>,
) -> Result<(), String> {
    let mut failures = Vec::new();
    if let Some(record) = record
        && let Err(error) = cleanup_file_copy(record)
    {
        failures.push(format!("clean PID rollback copy: {error}"));
    }
    if let Some(data) = data
        && let Err(error) = cleanup_tree_copy(data)
    {
        failures.push(format!("clean data rollback copy: {error}"));
    }
    if let Some(desktop) = desktop
        && let Err(error) = cleanup_file_copy(desktop)
    {
        failures.push(format!("clean desktop rollback copy: {error}"));
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn cleanup_file_copy(copy: &FileSnapshot) -> Result<(), String> {
    match snapshot_file_at(&copy.parent, &copy.name) {
        Ok(current) if current.identity == copy.identity => remove_file_snapshot(copy),
        Ok(_) => Err("rollback file copy identity changed; retained".to_owned()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "rollback file copy is malformed or unreadable: {error}"
        )),
    }
}

fn cleanup_tree_copy(copy: &TreeSnapshot) -> Result<(), String> {
    match snapshot_tree_at(&copy.parent, &copy.name) {
        Ok(current) if same_tree_identity(copy, &current) => remove_tree_named(copy, &copy.name),
        Ok(_) => Err("rollback data copy identity changed; retained".to_owned()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            match open_at(
                &copy.parent,
                &copy.name,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            ) {
                Err(absent) if absent.kind() == io::ErrorKind::NotFound => Ok(()),
                Ok(_) | Err(_) => Err(format!(
                    "rollback data copy is malformed or unreadable: {error}"
                )),
            }
        }
        Err(error) => Err(format!(
            "rollback data copy is malformed or unreadable: {error}"
        )),
    }
}

#[allow(clippy::too_many_arguments)]
fn rollback_remove(
    _paths: &LifecyclePaths,
    record: Option<&RecordSnapshot>,
    record_copy: Option<&FileSnapshot>,
    data: Option<&TreeSnapshot>,
    data_copy: Option<&TreeSnapshot>,
    desktop: Option<&FileSnapshot>,
    desktop_copy: Option<&FileSnapshot>,
    record_name: &CStr,
    data_name: &CStr,
    desktop_name: &CStr,
) -> Result<(), String> {
    let mut failures = Vec::new();
    if let (Some(record), Some(copy)) = (record, record_copy)
        && let Err(error) = restore_file_artifact(
            &record.file.parent,
            &record.file.name,
            record_name,
            None,
            &record.file,
            copy,
        )
    {
        failures.push(format!("restore PID record: {error}"));
    }
    if let (Some(tree), Some(copy)) = (data, data_copy)
        && let Err(error) = restore_tree_artifact(
            &tree.parent,
            &tree.name,
            data_name,
            Some(b".plasma-auto-tiler-data-quarantine"),
            tree,
            copy,
        )
    {
        failures.push(format!("restore data: {error}"));
    }
    if let (Some(file), Some(copy)) = (desktop, desktop_copy)
        && let Err(error) = restore_file_artifact(
            &file.parent,
            &file.name,
            desktop_name,
            Some(b".plasma-auto-tiler-desktop-quarantine"),
            file,
            copy,
        )
    {
        failures.push(format!("restore desktop: {error}"));
    }
    if failures.is_empty() {
        cleanup_remove_copies(record_copy, data_copy, desktop_copy)
    } else {
        Err(failures.join("; "))
    }
}

fn copy_file(source: &FileSnapshot, destination: &CStr) -> Result<FileSnapshot, String> {
    verify_retained(&source.file, &source.identity).map_err(|e| e.to_string())?;
    verify_named(&source.parent, &source.name, &source.identity, false)
        .map_err(|e| e.to_string())?;
    let mut copy = match open_at(
        &source.parent,
        destination,
        OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
    ) {
        Ok(copy) => copy,
        Err(error) => return Err(error.to_string()),
    };
    let result = (|| {
        rfs::fchmod(&copy, Mode::from_raw_mode(source.identity.mode))
            .map_err(|e| io::Error::from(e).to_string())?;
        copy.write_all(&source.identity.content)
            .map_err(|e| e.to_string())?;
        copy.sync_all().map_err(|e| e.to_string())?;
        rfs::fsync(&source.parent).map_err(|e| io::Error::from(e).to_string())?;
        let snapshot = snapshot_file_at(&source.parent, destination).map_err(|e| e.to_string())?;
        if !same_file_metadata_content(source, &snapshot) {
            return Err("rollback file copy metadata or content changed".to_owned());
        }
        Ok(snapshot)
    })();
    match result {
        Ok(snapshot) => Ok(snapshot),
        Err(error) => match remove_partial_file(
            &source.parent,
            destination,
            source.identity.mode,
            Some(&source.identity.content),
        ) {
            Ok(()) => Err(error),
            Err(cleanup) if cleanup.kind() == io::ErrorKind::NotFound => Err(error),
            Err(cleanup) => Err(format!("{error}; recovery-required: {cleanup}")),
        },
    }
}

fn copy_tree(source: &TreeSnapshot, destination: &CStr) -> Result<TreeSnapshot, String> {
    verify_retained(&source.root, &source.root_identity).map_err(|e| e.to_string())?;
    verify_named(&source.parent, &source.name, &source.root_identity, true)
        .map_err(|e| e.to_string())?;
    for node in &source.nodes {
        verify_retained(&node.file, &node.identity).map_err(|e| e.to_string())?;
        verify_named(&node.parent, &node.name, &node.identity, node.directory)
            .map_err(|e| e.to_string())?;
    }
    if let Err(error) = mkdir_at(&source.parent, destination, source.root_identity.mode) {
        return Err(error.to_string());
    }
    let result = (|| {
        let root = open_at(
            &source.parent,
            destination,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        )
        .map_err(|e| e.to_string())?;
        rfs::fchmod(&root, Mode::from_raw_mode(source.root_identity.mode))
            .map_err(|e| io::Error::from(e).to_string())?;
        for node in &source.nodes {
            let parent = open_relative_directory(&root, node.relative.parent())
                .map_err(|e| e.to_string())?;
            if node.directory {
                mkdir_at(&parent, &node.name, node.identity.mode).map_err(|e| e.to_string())?;
                let directory = open_at(
                    &parent,
                    &node.name,
                    OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                )
                .map_err(|e| e.to_string())?;
                rfs::fchmod(&directory, Mode::from_raw_mode(node.identity.mode))
                    .map_err(|e| io::Error::from(e).to_string())?;
                directory.sync_all().map_err(|e| e.to_string())?;
            } else {
                let mut file = create_file_at(&parent, &node.name, node.identity.mode)
                    .map_err(|e| e.to_string())?;
                file.write_all(&node.identity.content)
                    .map_err(|e| e.to_string())?;
                rfs::fchmod(&file, Mode::from_raw_mode(node.identity.mode))
                    .map_err(|e| io::Error::from(e).to_string())?;
                file.sync_all().map_err(|e| e.to_string())?;
            }
            rfs::fsync(&parent).map_err(|e| io::Error::from(e).to_string())?;
        }
        root.sync_all().map_err(|e| e.to_string())?;
        rfs::fsync(&source.parent).map_err(|e| io::Error::from(e).to_string())?;
        let copy = snapshot_tree_at(&source.parent, destination).map_err(|e| e.to_string())?;
        if !same_tree_metadata_content(source, &copy) {
            return Err("rollback data copy metadata or content changed".to_owned());
        }
        Ok(copy)
    })();
    match result {
        Ok(copy) => Ok(copy),
        Err(error) => match remove_partial_copy_tree(&source.parent, destination) {
            Ok(()) => Err(error),
            Err(cleanup) if cleanup.kind() == io::ErrorKind::NotFound => Err(error),
            Err(cleanup) => Err(format!("{error}; recovery-required: {cleanup}")),
        },
    }
}

fn remove_partial_copy_tree(parent: &File, name: &CStr) -> io::Result<()> {
    let copy = snapshot_tree_at(parent, name)?;
    remove_tree_named(&copy, name).map_err(io::Error::other)
}

fn open_relative_directory(root: &File, relative: Option<&Path>) -> io::Result<File> {
    let mut directory = root.try_clone()?;
    let Some(relative) = relative else {
        return Ok(directory);
    };
    for component in relative.components() {
        let name = component_name(component)?;
        directory = open_at(
            &directory,
            &name,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        )?;
        validate_directory(&directory)?;
    }
    Ok(directory)
}

fn same_file_metadata_content(expected: &FileSnapshot, actual: &FileSnapshot) -> bool {
    expected.identity.mode == actual.identity.mode
        && expected.identity.uid == actual.identity.uid
        && expected.identity.directory == actual.identity.directory
        && expected.identity.content == actual.identity.content
}

fn same_tree_metadata_content(expected: &TreeSnapshot, actual: &TreeSnapshot) -> bool {
    expected.root_identity.mode == actual.root_identity.mode
        && expected.root_identity.uid == actual.root_identity.uid
        && expected.root_identity.directory == actual.root_identity.directory
        && expected.nodes.len() == actual.nodes.len()
        && expected.nodes.iter().all(|expected_node| {
            actual.nodes.iter().any(|actual_node| {
                expected_node.relative == actual_node.relative
                    && expected_node.directory == actual_node.directory
                    && expected_node.identity.mode == actual_node.identity.mode
                    && expected_node.identity.uid == actual_node.identity.uid
                    && expected_node.identity.content == actual_node.identity.content
            })
        })
}

fn find_named_prefix(parent: &File, prefix: &[u8]) -> io::Result<Option<CString>> {
    let mut match_name = None;
    for name in directory_names(parent)? {
        if name.to_bytes().starts_with(prefix) {
            if match_name.is_some() {
                return Err(invalid("multiple lifecycle quarantine artifacts retained"));
            }
            match_name = Some(name);
        }
    }
    Ok(match_name)
}

fn restore_file_artifact(
    parent: &File,
    canonical: &CStr,
    copy_name: &CStr,
    quarantine_prefix: Option<&[u8]>,
    expected: &FileSnapshot,
    copy: &FileSnapshot,
) -> io::Result<()> {
    let current = snapshot_file_at(parent, canonical);
    match current {
        Ok(current) => {
            if let Some(prefix) = quarantine_prefix
                && find_named_prefix(parent, prefix)?.is_some()
            {
                return Err(invalid("canonical file and quarantine both retained"));
            }
            if current.identity == expected.identity {
                remove_file_snapshot(copy).map_err(io::Error::other)?;
                return Ok(());
            }
            return Err(invalid("canonical file replacement retained"));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let copied = snapshot_file_at(&copy.parent, copy_name)?;
    if !same_file_metadata_content(expected, &copied) {
        return Err(invalid("rollback file copy identity changed"));
    }
    rename_noreplace(&copy.parent, copy_name, parent, canonical)?;
    rfs::fsync(parent).map_err(io::Error::from)?;
    let restored = snapshot_file_at(parent, canonical)?;
    if !same_file_metadata_content(expected, &restored) {
        return Err(invalid("restored file metadata or content changed"));
    }
    if let Some(prefix) = quarantine_prefix
        && let Some(quarantine) = find_named_prefix(parent, prefix)?
    {
        let quarantined = snapshot_file_at(parent, &quarantine)?;
        if quarantined.identity != expected.identity {
            return Err(invalid("quarantined file identity changed"));
        }
        remove_file_snapshot(&quarantined).map_err(io::Error::other)?;
    }
    Ok(())
}

fn restore_tree_artifact(
    parent: &File,
    canonical: &CStr,
    copy_name: &CStr,
    quarantine_prefix: Option<&[u8]>,
    expected: &TreeSnapshot,
    copy: &TreeSnapshot,
) -> io::Result<()> {
    let current = snapshot_tree_at(parent, canonical);
    match current {
        Ok(current) => {
            if let Some(prefix) = quarantine_prefix
                && find_named_prefix(parent, prefix)?.is_some()
            {
                return Err(invalid("canonical data and quarantine both retained"));
            }
            if same_tree_identity(expected, &current) {
                remove_tree_named(copy, copy_name).map_err(io::Error::other)?;
                return Ok(());
            }
            return Err(invalid("canonical data replacement retained"));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let copied = snapshot_tree_at(&copy.parent, copy_name)?;
    if !same_tree_metadata_content(expected, &copied) {
        return Err(invalid("rollback data copy identity changed"));
    }
    rename_noreplace(&copy.parent, copy_name, parent, canonical)?;
    rfs::fsync(parent).map_err(io::Error::from)?;
    let restored = snapshot_tree_at(parent, canonical)?;
    if !same_tree_metadata_content(expected, &restored) {
        return Err(invalid("restored data metadata or content changed"));
    }
    if let Some(prefix) = quarantine_prefix
        && let Some(quarantine) = find_named_prefix(parent, prefix)?
    {
        let quarantined = snapshot_tree_at(parent, &quarantine)?;
        if !same_tree_identity(expected, &quarantined) {
            return Err(invalid("quarantined data identity changed"));
        }
        remove_tree_named(&quarantined, &quarantine).map_err(io::Error::other)?;
    }
    Ok(())
}

fn create_candidate_tree(
    parent: &File,
    name: &CString,
    source: &FileSnapshot,
) -> io::Result<TreeSnapshot> {
    mkdir_at(parent, name, 0o700)?;
    let root = open_at(
        parent,
        name,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
    )?;
    validate_directory(&root)?;
    let root_identity = identity_of(&root, None)?;
    let result = (|| {
        let marker_name = CString::new(DATA_OWNER_FILE).unwrap();
        let marker = create_file_at(&root, &marker_name, 0o600)?;
        write_sync(marker, DATA_OWNER_MARKER.as_bytes())?;
        let bin_name = CString::new("bin").unwrap();
        mkdir_at(&root, &bin_name, 0o700)?;
        let bin = open_at(
            &root,
            &bin_name,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        )?;
        validate_directory(&bin)?;
        let binary_name = CString::new("plasma-auto-tiler").unwrap();
        let mut binary = create_file_at(&bin, &binary_name, 0o700)?;
        binary.write_all(&source.identity.content)?;
        rfs::fchmod(&binary, Mode::from_raw_mode(0o755)).map_err(io::Error::from)?;
        binary.sync_all()?;
        rfs::fsync(&bin).map_err(io::Error::from)?;
        rfs::fsync(&root).map_err(io::Error::from)?;
        snapshot_tree_at(parent, name)
    })();
    match result {
        Ok(tree) => Ok(tree),
        Err(error) => {
            match remove_partial_candidate(parent, name, &root_identity, &source.identity.content) {
                Ok(()) => Err(error),
                Err(cleanup) => Err(io::Error::new(
                    cleanup.kind(),
                    format!("{error}; recovery-required: {cleanup}"),
                )),
            }
        }
    }
}

fn create_candidate_desktop(
    parent: &File,
    name: &CString,
    paths: &LifecyclePaths,
) -> io::Result<FileSnapshot> {
    let content = desktop_content(paths)?;
    let result = (|| {
        let mut file = create_file_at(parent, name, 0o600)?;
        file.write_all(&content)?;
        file.sync_all()?;
        rfs::fsync(parent).map_err(io::Error::from)?;
        snapshot_file_at(parent, name)
    })();
    match result {
        Ok(file) => Ok(file),
        Err(error) => match remove_partial_file(parent, name, 0o600, Some(&content)) {
            Ok(()) => Err(error),
            Err(cleanup) if cleanup.kind() == io::ErrorKind::NotFound => Err(error),
            Err(cleanup) => Err(io::Error::new(
                cleanup.kind(),
                format!("{error}; recovery-required: {cleanup}"),
            )),
        },
    }
}

fn remove_partial_candidate(
    parent: &File,
    name: &CString,
    expected_root: &FileIdentity,
    expected_binary: &[u8],
) -> io::Result<()> {
    let root = open_at(
        parent,
        name,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
    )?;
    if identity_of(&root, None)? != *expected_root {
        return Err(invalid("candidate root identity changed"));
    }
    let marker_name = CString::new(DATA_OWNER_FILE).unwrap();
    remove_partial_file(
        &root,
        &marker_name,
        0o600,
        Some(DATA_OWNER_MARKER.as_bytes()),
    )?;
    let bin_name = CString::new("bin").unwrap();
    if let Ok(bin) = open_at(
        &root,
        &bin_name,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
    ) {
        let binary_name = CString::new("plasma-auto-tiler").unwrap();
        remove_partial_file(&bin, &binary_name, 0o755, Some(expected_binary))?;
        let bin_identity = identity_of(&bin, None)?;
        if bin_identity.mode != 0o700 || bin_identity.uid != current_uid() {
            return Err(invalid("candidate directory metadata changed"));
        }
        if !directory_names(&bin)?.is_empty() {
            return Err(invalid("candidate directory contains unexpected artifacts"));
        }
        unlink_at(&root, &bin_name, true)?;
        rfs::fsync(&root).map_err(io::Error::from)?;
    }
    if !directory_names(&root)?.is_empty() {
        return Err(invalid("candidate contains unexpected artifacts"));
    }
    let root_identity = identity_of(&root, None)?;
    if root_identity != *expected_root {
        return Err(invalid("candidate root metadata changed"));
    }
    unlink_at(parent, name, true)?;
    rfs::fsync(parent).map_err(io::Error::from)
}

fn remove_partial_file(
    parent: &File,
    name: &CStr,
    expected_mode: u32,
    expected_content: Option<&[u8]>,
) -> io::Result<()> {
    let snapshot = match snapshot_file_at(parent, name) {
        Ok(snapshot) => snapshot,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if snapshot.identity.mode != expected_mode
        || snapshot.identity.uid != current_uid()
        || expected_content.is_some_and(|content| snapshot.identity.content != content)
    {
        return Err(invalid("candidate file metadata or content changed"));
    }
    remove_file_named_io(&snapshot, name, false)
}

fn validate_project_tree(tree: &TreeSnapshot) -> io::Result<()> {
    if tree.root.metadata()?.mode() & 0o7777 != 0o700 {
        return Err(invalid("project root has unsafe mode"));
    }
    let expected = [
        (Path::new(DATA_OWNER_FILE), false),
        (Path::new("bin"), true),
        (Path::new("bin/plasma-auto-tiler"), false),
    ];
    if tree.nodes.len() != expected.len() {
        return Err(invalid("tree contains unexpected project artifacts"));
    }
    for (path, directory) in expected {
        let node = tree
            .nodes
            .iter()
            .find(|n| n.relative == path)
            .ok_or_else(|| invalid("tree is missing a project artifact"))?;
        if node.directory != directory {
            return Err(invalid("tree artifact has wrong type"));
        }
        let mode = node.file.metadata()?.mode() & 0o7777;
        if directory && mode != 0o700
            || !directory && path != Path::new("bin/plasma-auto-tiler") && mode != 0o600
            || path == Path::new("bin/plasma-auto-tiler") && mode != 0o755
        {
            return Err(invalid("tree artifact has unsafe mode"));
        }
        if path == Path::new(DATA_OWNER_FILE)
            && node.identity.content != DATA_OWNER_MARKER.as_bytes()
        {
            return Err(invalid("tree owner marker is invalid"));
        }
    }
    Ok(())
}

fn validate_desktop(file: &FileSnapshot, paths: &LifecyclePaths) -> io::Result<()> {
    if file.file.metadata()?.mode() & 0o7777 != 0o600
        || file.identity.content != desktop_content(paths)?
    {
        return Err(invalid("desktop entry is not marker-owned"));
    }
    Ok(())
}

fn desktop_content(paths: &LifecyclePaths) -> io::Result<Vec<u8>> {
    let executable = paths
        .binary
        .to_str()
        .ok_or_else(|| invalid("desktop path is not UTF-8"))?;
    if !valid_exec(executable.as_bytes()) {
        return Err(invalid("desktop Exec path is unsafe"));
    }
    Ok(format!("[Desktop Entry]\nType=Application\nName=Plasma Auto Tiler\nExec={executable}\n{DESKTOP_OWNER_MARKER}\n").into_bytes())
}

fn installed_binary(paths: &LifecyclePaths) -> io::Result<FileSnapshot> {
    let file = read_file_snapshot(paths.binary())?.ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "installed tray binary is absent")
    })?;
    if file.identity.content.is_empty() || file.file.metadata()?.mode() & 0o7777 != 0o755 {
        return Err(invalid("installed tray binary is not executable"));
    }
    Ok(file)
}
fn installed_identity(path: &Path) -> io::Result<Option<FileIdentity>> {
    let Some(file) = read_file_snapshot(path)? else {
        return Ok(None);
    };
    if file.identity.content.is_empty() || file.file.metadata()?.mode() & 0o7777 != 0o755 {
        return Err(invalid("installed binary is not safely executable"));
    }
    Ok(Some(file.identity))
}
fn record_binds(record: &RecordSnapshot, paths: &LifecyclePaths) -> bool {
    installed_identity(paths.binary())
        .is_ok_and(|identity| identity.is_some_and(|i| i == record.binary))
        && record.record.resolved_executable_path == paths.binary()
}
fn process_matches(record: &RecordSnapshot, identity: &ProcessIdentity) -> bool {
    record.record.start_tick == identity.start_tick
        && record.record.resolved_executable_path == identity.resolved_executable_path
        && record.binary.dev == identity.executable.dev
        && record.binary.ino == identity.executable.ino
        && record.binary.content == identity.executable.content
}

fn active_installed_helper(paths: &LifecyclePaths) -> io::Result<bool> {
    let binary = match installed_identity(paths.binary()) {
        Ok(Some(binary)) => binary,
        Ok(None) => return Ok(false),
        Err(error) => return Err(error),
    };
    let root = match open_special_directory(paths.proc_root()) {
        Ok(root) => root,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e),
    };
    let deleted = format!("{} (deleted)", paths.binary().display());
    let process = ProcProcessControl {
        proc_root: paths.proc_root.clone(),
    };
    for name in directory_names(&root)? {
        let Ok(text) = std::str::from_utf8(name.to_bytes()) else {
            continue;
        };
        let Ok(pid) = text.parse::<u32>() else {
            continue;
        };
        if pid == std::process::id() {
            continue;
        }
        if process
            .identity_if_path(pid, &[paths.binary(), Path::new(&deleted)])?
            .is_some_and(|identity| {
                identity.executable.dev == binary.dev
                    && identity.executable.ino == binary.ino
                    && identity.executable.content == binary.content
            })
        {
            return Ok(true);
        }
    }
    Ok(false)
}
fn refuse_unrecorded_helper(paths: &LifecyclePaths, command: &str) -> Result<(), String> {
    if active_installed_helper(paths).map_err(|e| e.to_string())? {
        Err(format!(
            "{command}: unrecorded active helper; recovery-required"
        ))
    } else {
        Ok(())
    }
}

fn reconcile_helper_for_install(paths: &LifecyclePaths) -> Result<(), String> {
    match read_record_snapshot(paths.pid_record()) {
        Ok(Some(snapshot)) => {
            if !record_binds(&snapshot, paths) {
                return Err("install: retained mismatched PID record".to_owned());
            }
            let process = ProcProcessControl {
                proc_root: paths.proc_root.clone(),
            };
            match process.identity(snapshot.record.pid) {
                Ok(None) => {
                    remove_file_snapshot(&snapshot.file)?;
                    refuse_unrecorded_helper(paths, "install")
                }
                Ok(Some(identity)) if process_matches(&snapshot, &identity) => {
                    Err("install: helper is already active".to_owned())
                }
                Ok(Some(_)) => Err("install: retained mismatched PID record".to_owned()),
                Err(_) => Err("install: unreadable helper identity; recovery-required".to_owned()),
            }
        }
        Ok(None) => refuse_unrecorded_helper(paths, "install"),
        Err(ObservedError::Unowned) => Err("install: unowned PID record retained".to_owned()),
        Err(ObservedError::Malformed) => Err("install: malformed PID record retained".to_owned()),
        Err(ObservedError::Io(_)) => Err("install: unreadable PID record retained".to_owned()),
    }
}

fn remove_file_snapshot(snapshot: &FileSnapshot) -> Result<(), String> {
    remove_file_named_io(snapshot, &snapshot.name, false).map_err(|e| e.to_string())
}
#[cfg(test)]
fn remove_file_snapshot_for_remove(snapshot: &FileSnapshot) -> Result<(), String> {
    remove_file_named_io(snapshot, &snapshot.name, true).map_err(|e| e.to_string())
}
fn remove_file_named(snapshot: &FileSnapshot, name: &CString) -> Result<(), String> {
    remove_file_named_io(snapshot, name, false).map_err(|e| e.to_string())
}
fn remove_file_named_for_remove(snapshot: &FileSnapshot, name: &CStr) -> Result<(), String> {
    remove_file_named_io(snapshot, name, true).map_err(|e| e.to_string())
}
fn remove_file_snapshot_io(snapshot: &FileSnapshot) -> io::Result<()> {
    remove_file_named_io(snapshot, &snapshot.name, false)
}
fn remove_launch_reservation(snapshot: &FileSnapshot) -> Result<(), String> {
    let current = match snapshot_file_at(&snapshot.parent, &snapshot.name) {
        Ok(current) => current,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    if current.identity.dev != snapshot.identity.dev
        || current.identity.ino != snapshot.identity.ino
        || current.identity.mode != 0o600
        || current.identity.uid != current_uid()
        || (current.identity.content != LAUNCH_READY_MARKER && !current.identity.content.is_empty())
    {
        return Err("launch readiness file identity changed during rollback".to_owned());
    }
    remove_file_snapshot(&current)
}
fn remove_file_named_io(
    snapshot: &FileSnapshot,
    name: &CStr,
    inject_failure: bool,
) -> io::Result<()> {
    verify_retained(&snapshot.file, &snapshot.identity)?;
    verify_named(&snapshot.parent, name, &snapshot.identity, false)?;
    unlink_at(&snapshot.parent, name, false)?;
    #[cfg(test)]
    if inject_failure && let Err(error) = inject_removal_failure() {
        return Err(error);
    }
    #[cfg(not(test))]
    let _ = inject_failure;
    rfs::fsync(&snapshot.parent).map_err(io::Error::from)
}
fn quarantine_file(snapshot: &FileSnapshot, destination: &CString) -> Result<(), String> {
    verify_retained(&snapshot.file, &snapshot.identity).map_err(|e| e.to_string())?;
    verify_named(&snapshot.parent, &snapshot.name, &snapshot.identity, false)
        .map_err(|e| e.to_string())?;
    rename_noreplace(
        &snapshot.parent,
        &snapshot.name,
        &snapshot.parent,
        destination,
    )
    .map_err(|e| e.to_string())?;
    verify_named(&snapshot.parent, destination, &snapshot.identity, false)
        .map_err(|e| e.to_string())?;
    rfs::fsync(&snapshot.parent).map_err(|e| e.to_string())?;
    Ok(())
}
fn quarantine_tree(snapshot: &TreeSnapshot, destination: &CString) -> Result<(), String> {
    verify_retained(&snapshot.root, &snapshot.root_identity).map_err(|e| e.to_string())?;
    verify_named(
        &snapshot.parent,
        &snapshot.name,
        &snapshot.root_identity,
        true,
    )
    .map_err(|e| e.to_string())?;
    rename_noreplace(
        &snapshot.parent,
        &snapshot.name,
        &snapshot.parent,
        destination,
    )
    .map_err(|e| e.to_string())?;
    let moved = snapshot_tree_at(&snapshot.parent, destination).map_err(|e| e.to_string())?;
    if moved.root_identity != snapshot.root_identity || !same_tree_identity(snapshot, &moved) {
        return Err("quarantined tree identity changed".to_owned());
    }
    rfs::fsync(&snapshot.parent).map_err(|e| e.to_string())?;
    Ok(())
}
fn same_tree_identity(expected: &TreeSnapshot, actual: &TreeSnapshot) -> bool {
    expected.root_identity == actual.root_identity
        && expected.nodes.len() == actual.nodes.len()
        && expected.nodes.iter().all(|expected_node| {
            actual.nodes.iter().any(|actual_node| {
                actual_node.relative == expected_node.relative
                    && actual_node.directory == expected_node.directory
                    && actual_node.identity == expected_node.identity
            })
        })
}
fn remove_tree_named(snapshot: &TreeSnapshot, name: &CStr) -> Result<(), String> {
    remove_tree_named_inner(snapshot, name, false)
}
fn remove_install_backup_tree(snapshot: &TreeSnapshot, name: &CStr) -> Result<(), String> {
    #[cfg(test)]
    if FAIL_NEXT_INSTALL_BACKUP_CLEANUP.with(|fail| fail.replace(false)) {
        return Err("injected install backup cleanup failure".to_owned());
    }
    remove_tree_named(snapshot, name)
}
fn remove_tree_named_for_remove(snapshot: &TreeSnapshot, name: &CStr) -> Result<(), String> {
    remove_tree_named_inner(snapshot, name, true)
}
fn remove_tree_named_inner(
    snapshot: &TreeSnapshot,
    name: &CStr,
    inject_failure: bool,
) -> Result<(), String> {
    verify_retained(&snapshot.root, &snapshot.root_identity).map_err(|e| e.to_string())?;
    verify_named(&snapshot.parent, name, &snapshot.root_identity, true)
        .map_err(|e| e.to_string())?;
    for node in snapshot.nodes.iter().rev() {
        verify_retained(&node.file, &node.identity).map_err(|e| e.to_string())?;
        verify_named(&node.parent, &node.name, &node.identity, node.directory)
            .map_err(|e| e.to_string())?;
        unlink_at(&node.parent, &node.name, node.directory)
            .map_err(|e| format!("recovery-required: {e}"))?;
        #[cfg(test)]
        if inject_failure && let Err(error) = inject_removal_failure() {
            return Err(format!("recovery-required: {error}"));
        }
        #[cfg(not(test))]
        let _ = inject_failure;
        rfs::fsync(&node.parent).map_err(|e| format!("recovery-required: {e}"))?;
    }
    unlink_at(&snapshot.parent, name, true).map_err(|e| format!("recovery-required: {e}"))?;
    #[cfg(test)]
    if inject_failure && let Err(error) = inject_removal_failure() {
        return Err(format!("recovery-required: {error}"));
    }
    #[cfg(not(test))]
    let _ = inject_failure;
    rfs::fsync(&snapshot.parent).map_err(|e| e.to_string())?;
    Ok(())
}
struct MoveError {
    error: io::Error,
    renamed: bool,
}
fn move_tree(snapshot: &TreeSnapshot, backup: &CString) -> Result<(), MoveError> {
    verify_retained(&snapshot.root, &snapshot.root_identity).map_err(|error| MoveError {
        error,
        renamed: false,
    })?;
    verify_named(
        &snapshot.parent,
        &snapshot.name,
        &snapshot.root_identity,
        true,
    )
    .map_err(|error| MoveError {
        error,
        renamed: false,
    })?;
    rename_noreplace(&snapshot.parent, &snapshot.name, &snapshot.parent, backup).map_err(
        |error| MoveError {
            error,
            renamed: false,
        },
    )?;
    sync_backup_parent(&snapshot.parent).map_err(|error| MoveError {
        error,
        renamed: true,
    })
}
fn move_file(snapshot: &FileSnapshot, backup: &CString) -> Result<(), MoveError> {
    verify_retained(&snapshot.file, &snapshot.identity).map_err(|error| MoveError {
        error,
        renamed: false,
    })?;
    verify_named(&snapshot.parent, &snapshot.name, &snapshot.identity, false).map_err(|error| {
        MoveError {
            error,
            renamed: false,
        }
    })?;
    rename_noreplace(&snapshot.parent, &snapshot.name, &snapshot.parent, backup).map_err(
        |error| MoveError {
            error,
            renamed: false,
        },
    )?;
    sync_backup_parent(&snapshot.parent).map_err(|error| MoveError {
        error,
        renamed: true,
    })
}

fn verify_named(
    parent: &File,
    name: &CStr,
    expected: &FileIdentity,
    directory: bool,
) -> io::Result<()> {
    let file = open_at(
        parent,
        name,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
    )?;
    if directory {
        verify_directory(&file, expected)
    } else {
        verify_file(&file, expected)
    }
}
fn verify_file(file: &File, expected: &FileIdentity) -> io::Result<()> {
    let metadata = file.metadata()?;
    if !safe_file(&metadata) {
        return Err(invalid("artifact is not a safe regular file"));
    }
    if identity_of(file, Some(read_content(file)?))? != *expected {
        return Err(invalid("artifact identity changed"));
    }
    Ok(())
}
fn verify_directory(file: &File, expected: &FileIdentity) -> io::Result<()> {
    validate_directory(file)?;
    if identity_of(file, None)? != *expected {
        return Err(invalid("directory identity changed"));
    }
    Ok(())
}
fn verify_retained(file: &File, expected: &FileIdentity) -> io::Result<()> {
    let actual = identity_of(file, None)?;
    if actual.dev != expected.dev
        || actual.ino != expected.ino
        || actual.mode != expected.mode
        || actual.uid != expected.uid
        || actual.directory != expected.directory
    {
        return Err(invalid("retained artifact identity changed"));
    }
    Ok(())
}

fn snapshot_tree(path: &Path) -> io::Result<Option<TreeSnapshot>> {
    validate_path(path)?;
    let parent = match open_directory(
        path.parent().ok_or_else(|| invalid("tree has no parent"))?,
        false,
    ) {
        Ok(p) => p,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    match snapshot_tree_at(&parent, &leaf_name(path)?) {
        Ok(tree) => Ok(Some(tree)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}
fn snapshot_tree_at(parent: &File, name: &CStr) -> io::Result<TreeSnapshot> {
    let root = open_at(
        parent,
        name,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
    )?;
    validate_directory(&root)?;
    let root_identity = identity_of(&root, None)?;
    let mut nodes = Vec::new();
    snapshot_tree_dir(&root, Path::new(""), &mut nodes)?;
    Ok(TreeSnapshot {
        parent: parent.try_clone()?,
        name: name.to_owned(),
        root,
        root_identity,
        nodes,
    })
}
fn snapshot_tree_dir(
    directory: &File,
    relative: &Path,
    nodes: &mut Vec<TreeNode>,
) -> io::Result<()> {
    for entry in directory_names_limited(directory, MAX_TREE_NODES.saturating_sub(nodes.len()))? {
        if nodes.len() >= MAX_TREE_NODES {
            return Err(invalid("tree contains too many nodes"));
        }
        let child = open_at(
            directory,
            &entry,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        )?;
        let metadata = child.metadata()?;
        let child_relative = relative.join(OsStr::from_bytes(entry.to_bytes()));
        if metadata.is_dir() {
            validate_directory(&child)?;
            let identity = identity_of(&child, None)?;
            let walk = child.try_clone()?;
            nodes.push(TreeNode {
                relative: child_relative.clone(),
                parent: directory.try_clone()?,
                name: entry.clone(),
                file: child,
                identity,
                directory: true,
            });
            snapshot_tree_dir(&walk, &child_relative, nodes)?;
        } else if metadata.is_file() {
            if !safe_file(&metadata) {
                return Err(invalid("tree contains unsafe file"));
            }
            let content = read_content(&child)?;
            let identity = identity_of(&child, Some(content))?;
            nodes.push(TreeNode {
                relative: child_relative,
                parent: directory.try_clone()?,
                name: entry,
                file: child,
                identity,
                directory: false,
            });
        } else {
            return Err(invalid("tree contains a special artifact"));
        }
    }
    Ok(())
}
fn read_file_snapshot(path: &Path) -> io::Result<Option<FileSnapshot>> {
    read_file_snapshot_with(path, None, None)
}
fn read_file_snapshot_with(
    path: &Path,
    limit: Option<usize>,
    expected_mode: Option<u32>,
) -> io::Result<Option<FileSnapshot>> {
    validate_path(path)?;
    let parent = match open_directory(
        path.parent().ok_or_else(|| invalid("file has no parent"))?,
        false,
    ) {
        Ok(p) => p,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    match snapshot_file_at_with(&parent, &leaf_name(path)?, limit, expected_mode) {
        Ok(file) => Ok(Some(file)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}
fn read_source_snapshot(path: &Path) -> io::Result<Option<FileSnapshot>> {
    read_file_snapshot(path)
}
fn snapshot_file_at(parent: &File, name: &CStr) -> io::Result<FileSnapshot> {
    snapshot_file_at_with(parent, name, None, None)
}
fn snapshot_file_at_with(
    parent: &File,
    name: &CStr,
    limit: Option<usize>,
    expected_mode: Option<u32>,
) -> io::Result<FileSnapshot> {
    let file = open_at(
        parent,
        name,
        OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
    )?;
    let metadata = file.metadata()?;
    if !safe_file(&metadata) {
        return Err(invalid("unsafe regular file"));
    }
    if expected_mode.is_some_and(|mode| metadata.mode() & 0o7777 != mode) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "PID record has an unsafe mode",
        ));
    }
    let content = match limit {
        Some(limit) => read_content_limited(&file, limit)?,
        None => read_content(&file)?,
    };
    Ok(FileSnapshot {
        identity: identity_of(&file, Some(content))?,
        file,
        parent: parent.try_clone()?,
        name: name.to_owned(),
    })
}
fn identity_of(file: &File, content: Option<Vec<u8>>) -> io::Result<FileIdentity> {
    let metadata = file.metadata()?;
    Ok(FileIdentity {
        dev: metadata.dev(),
        ino: metadata.ino(),
        mode: metadata.mode() & 0o7777,
        uid: metadata.uid(),
        directory: metadata.is_dir(),
        content: content.unwrap_or_default(),
    })
}
fn read_content(file: &File) -> io::Result<Vec<u8>> {
    read_content_limited_with_message(
        file,
        MAX_ARTIFACT_FILE_BYTES,
        "file content exceeds lifecycle artifact limit",
    )
}
fn read_content_limited(file: &File, limit: usize) -> io::Result<Vec<u8>> {
    read_content_limited_with_message(file, limit, "file content exceeds lifecycle record limit")
}
fn read_content_limited_with_message(
    file: &File,
    limit: usize,
    exceeded_message: &str,
) -> io::Result<Vec<u8>> {
    let limit = u64::try_from(limit)
        .ok()
        .and_then(|limit| limit.checked_add(1))
        .ok_or_else(|| invalid("file content limit is invalid"))?;
    if file.metadata()?.len() >= limit {
        return Err(invalid(exceeded_message));
    }
    let mut content = Vec::new();
    file.take(limit).read_to_end(&mut content)?;
    if content.len() as u64 >= limit {
        return Err(invalid(exceeded_message));
    }
    Ok(content)
}
fn safe_file(metadata: &fs::Metadata) -> bool {
    metadata.is_file()
        && metadata.uid() == current_uid()
        && metadata.nlink() == 1
        && metadata.mode() & 0o022 == 0
}

fn open_directory(path: &Path, create: bool) -> io::Result<File> {
    validate_path(path)?;
    let mut directory: File = File::from(rfs::openat(
        rfs::CWD,
        "/",
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )?);
    let mut current = PathBuf::from("/");
    for component in path.components() {
        if matches!(component, Component::RootDir) {
            continue;
        }
        let name = component_name(component)?;
        current.push(OsStr::from_bytes(name.to_bytes()));
        let next = match open_at(
            &directory,
            &name,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        ) {
            Ok(next) => next,
            Err(e) if create && e.kind() == io::ErrorKind::NotFound => {
                mkdir_at(&directory, &name, 0o700).or_else(|e| {
                    if e.kind() == io::ErrorKind::AlreadyExists {
                        Ok(())
                    } else {
                        Err(e)
                    }
                })?;
                rfs::fsync(&directory).map_err(io::Error::from)?;
                open_at(
                    &directory,
                    &name,
                    OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                )?
            }
            Err(e) => return Err(e),
        };
        validate_ancestor(&next, &current)?;
        directory = next;
    }
    Ok(directory)
}
fn open_special_directory(path: &Path) -> io::Result<File> {
    validate_path(path)?;
    let mut directory: File = File::from(rfs::openat(
        rfs::CWD,
        "/",
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )?);
    for component in path.components() {
        if matches!(component, Component::RootDir) {
            continue;
        }
        directory = open_at(
            &directory,
            &component_name(component)?,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        )?;
    }
    Ok(directory)
}
fn validate_directory(file: &File) -> io::Result<()> {
    let metadata = file.metadata()?;
    if !metadata.is_dir() || metadata.mode() & 0o022 != 0 || metadata.uid() != current_uid() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe directory ancestor",
        ));
    }
    Ok(())
}
fn validate_ancestor(file: &File, path: &Path) -> io::Result<()> {
    let metadata = file.metadata()?;
    if !metadata.is_dir() || metadata.mode() & 0o022 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe directory ancestor",
        ));
    }
    let home = env::var_os("HOME").map(PathBuf::from);
    let runtime_system_ancestor = env::var_os("XDG_RUNTIME_DIR").is_some_and(|runtime| {
        let runtime = Path::new(&runtime);
        runtime.starts_with("/run/user/")
            && (path == Path::new("/run") || path == Path::new("/run/user"))
    });
    if metadata.uid() != current_uid()
        && !(metadata.uid() == 0
            && (home.is_some_and(|h| h.starts_with(path)) || runtime_system_ancestor))
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe directory owner",
        ));
    }
    if env::var_os("XDG_RUNTIME_DIR").is_some_and(|r| Path::new(&r) == path)
        && (metadata.uid() != current_uid() || metadata.mode() & 0o7777 != 0o700)
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe runtime directory",
        ));
    }
    Ok(())
}
fn current_uid() -> u32 {
    geteuid().as_raw()
}
fn open_at(parent: &File, name: &CStr, flags: OFlags) -> io::Result<File> {
    Ok(File::from(rfs::openat(
        parent,
        name,
        flags | OFlags::NONBLOCK,
        Mode::empty(),
    )?))
}
fn mkdir_at(parent: &File, name: &CStr, mode: u32) -> io::Result<()> {
    rfs::mkdirat(parent, name, Mode::from_raw_mode(mode)).map_err(io::Error::from)
}
fn create_file_at(parent: &File, name: &CStr, mode: u32) -> io::Result<File> {
    let file = open_at(
        parent,
        name,
        OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
    )?;
    rfs::fchmod(&file, Mode::from_raw_mode(mode)).map_err(io::Error::from)?;
    Ok(file)
}
fn unlink_at(parent: &File, name: &CStr, directory: bool) -> io::Result<()> {
    rfs::unlinkat(
        parent,
        name,
        if directory {
            AtFlags::REMOVEDIR
        } else {
            AtFlags::empty()
        },
    )
    .map_err(io::Error::from)
}
fn rename_noreplace(
    from_parent: &File,
    from: &CStr,
    to_parent: &File,
    to: &CStr,
) -> io::Result<()> {
    rfs::renameat_with(from_parent, from, to_parent, to, RenameFlags::NOREPLACE)
        .map_err(io::Error::from)
}
fn read_special_file(parent: &File, name: &str) -> io::Result<String> {
    let name = CString::new(name).map_err(|_| invalid("invalid proc file name"))?;
    let file = open_at(
        parent,
        &name,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
    )?;
    let mut text = String::new();
    (&file).read_to_string(&mut text)?;
    Ok(text)
}
fn directory_names(directory: &File) -> io::Result<Vec<CString>> {
    directory_names_limited(directory, usize::MAX)
}
fn directory_names_limited(directory: &File, limit: usize) -> io::Result<Vec<CString>> {
    let mut buffer = [MaybeUninit::<u8>::uninit(); 8192];
    let mut iterator = RawDir::new(directory, &mut buffer);
    let mut names = Vec::new();
    while let Some(entry) = iterator.next() {
        let entry = entry.map_err(io::Error::from)?;
        let name = entry.file_name();
        if name.to_bytes() != b"." && name.to_bytes() != b".." {
            if names.len() >= limit {
                return Err(invalid("tree contains too many nodes"));
            }
            names.push(name.to_owned());
        }
    }
    Ok(names)
}

struct ProjectLock {
    _file: File,
    parent: File,
    name: CString,
    identity: FileIdentity,
}
fn with_lock<T>(
    paths: &LifecyclePaths,
    action: impl FnOnce(&ProjectLock) -> Result<T, String>,
) -> Result<T, String> {
    let lock = acquire_lock(paths).map_err(|e| format!("acquire project lock: {e}"))?;
    let result = validate_lifecycle_paths(paths)
        .map_err(|e| format!("validate lifecycle paths: {e}"))
        .and_then(|_| action(&lock));
    let cleanup = release_lock(&lock);
    match (result, cleanup) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(error)) => Err(format!("remove project lock: {error}")),
        (Err(error), Err(cleanup)) => Err(format!("{error}; remove project lock: {cleanup}")),
    }
}

fn with_managed_lock<T>(
    paths: &ManagedPaths,
    action: impl FnOnce(&ProjectLock) -> Result<T, String>,
) -> Result<T, String> {
    let root = open_directory(paths.runtime_root(), true)
        .map_err(|e| format!("acquire managed project lock: {e}"))?;
    let lock = acquire_lock_at(root).map_err(|e| format!("acquire managed project lock: {e}"))?;
    let result = validate_managed_paths(paths)
        .map_err(|e| format!("validate managed lifecycle paths: {e}"))
        .and_then(|_| action(&lock));
    let cleanup = release_lock(&lock);
    match (result, cleanup) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(error)) => Err(format!("remove managed project lock: {error}")),
        (Err(error), Err(cleanup)) => {
            Err(format!("{error}; remove managed project lock: {cleanup}"))
        }
    }
}

fn with_managed_lock_io<T>(
    paths: &ManagedPaths,
    action: impl FnOnce(&ProjectLock) -> io::Result<T>,
) -> io::Result<T> {
    let root = open_directory(paths.runtime_root(), true)?;
    let lock = acquire_lock_at(root)?;
    let result = validate_managed_paths(paths).and_then(|_| action(&lock));
    let cleanup = release_lock(&lock);
    match (result, cleanup) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) | (Ok(_), Err(error)) => Err(error),
        (Err(error), Err(cleanup)) => Err(io::Error::new(
            error.kind(),
            format!("{error}; remove managed project lock: {cleanup}"),
        )),
    }
}

fn with_lock_io<T>(
    paths: &LifecyclePaths,
    action: impl FnOnce(&ProjectLock) -> io::Result<T>,
) -> io::Result<T> {
    let lock = acquire_lock(paths)?;
    let result = validate_lifecycle_paths(paths).and_then(|_| action(&lock));
    let cleanup = release_lock(&lock);
    match (result, cleanup) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(error)) => Err(error),
        (Err(error), Err(cleanup)) => Err(io::Error::new(
            error.kind(),
            format!("{error}; remove project lock: {cleanup}"),
        )),
    }
}
fn acquire_lock(paths: &LifecyclePaths) -> io::Result<ProjectLock> {
    let parent = open_directory(
        paths
            .pid_record
            .parent()
            .ok_or_else(|| invalid("record has no parent"))?,
        true,
    )?;
    acquire_lock_at(parent)
}

fn acquire_lock_at(parent: File) -> io::Result<ProjectLock> {
    let name = CString::new(LOCK_FILE).unwrap();
    let mut retried_unheld = false;
    loop {
        let (file, created) = loop {
            match open_at(
                &parent,
                &name,
                OFlags::RDWR | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            ) {
                Ok(file) => {
                    if !safe_lock(&file.metadata()?) {
                        return Err(invalid("unsafe project lock"));
                    }
                    break (file, false);
                }
                Err(e) if e.kind() == io::ErrorKind::NotFound => {
                    match rfs::openat(
                        &parent,
                        &name,
                        OFlags::RDWR
                            | OFlags::CREATE
                            | OFlags::EXCL
                            | OFlags::NOFOLLOW
                            | OFlags::CLOEXEC,
                        Mode::from_raw_mode(0o600),
                    ) {
                        Ok(file) => {
                            let file = File::from(file);
                            rfs::fchmod(&file, Mode::from_raw_mode(0o600))
                                .map_err(io::Error::from)?;
                            break (file, true);
                        }
                        Err(error)
                            if io::Error::from(error).kind() == io::ErrorKind::AlreadyExists =>
                        {
                            continue;
                        }
                        Err(error) => return Err(error.into()),
                    }
                }
                Err(e) => return Err(e),
            }
        };
        if created {
            rfs::flock(&file, FlockOperation::LockExclusive).map_err(io::Error::from)?;
        } else {
            match rfs::flock(&file, FlockOperation::NonBlockingLockExclusive) {
                Ok(()) if !retried_unheld => {
                    retried_unheld = true;
                    drop(file);
                    thread::sleep(Duration::from_millis(1));
                    continue;
                }
                Ok(()) => return Err(invalid("retained project lock; recovery-required")),
                Err(error) if io::Error::from(error).kind() == io::ErrorKind::WouldBlock => {
                    rfs::flock(&file, FlockOperation::LockExclusive).map_err(io::Error::from)?;
                }
                Err(error) => return Err(error.into()),
            }
        }
        let identity = identity_of(&file, Some(Vec::new()))?;
        match verify_named(&parent, &name, &identity, false) {
            Ok(()) if created => {
                return Ok(ProjectLock {
                    _file: file,
                    parent: parent.try_clone()?,
                    name: name.clone(),
                    identity,
                });
            }
            Ok(()) => return Err(invalid("retained project lock; recovery-required")),
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        }
    }
}
fn release_lock(lock: &ProjectLock) -> io::Result<()> {
    match verify_named(&lock.parent, &lock.name, &lock.identity, false) {
        Ok(()) => {
            unlink_at(&lock.parent, &lock.name, false)?;
            rfs::fsync(&lock.parent).map_err(io::Error::from)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}
fn safe_lock(metadata: &fs::Metadata) -> bool {
    safe_file(metadata) && metadata.mode() & 0o7777 == 0o600
}

fn validate_lifecycle_paths(paths: &LifecyclePaths) -> io::Result<()> {
    for path in [
        paths.data_root(),
        paths.binary(),
        paths.desktop(),
        paths.pid_record(),
    ] {
        validate_path(path)?;
    }
    let home = absolute_env("HOME")?;
    let valid = if let Some(root) = paths.test_root.as_ref() {
        root.parent() == Some(home.as_path())
            && root
                .file_name()
                .is_some_and(|n| n.as_bytes().starts_with(b".plasma-auto-tiler-test-"))
            && paths.data_root() == root.join("data/plasma-auto-tiler")
            && paths.desktop() == root.join("config/autostart/plasma-auto-tiler.desktop")
            && paths.pid_record() == root.join("runtime/plasma-auto-tiler/tray.pid")
            && paths.proc_root() == root.join("proc")
    } else {
        let expected = LifecyclePaths::from_env()?;
        paths.data_root() == expected.data_root()
            && paths.binary() == expected.binary()
            && paths.desktop() == expected.desktop()
            && paths.pid_record() == expected.pid_record()
            && paths.proc_root() == expected.proc_root()
    };
    if !valid {
        return Err(invalid(
            "lifecycle paths are outside the confined project layout",
        ));
    }
    Ok(())
}

fn validate_managed_paths(paths: &ManagedPaths) -> io::Result<()> {
    validate_path(paths.runtime_root())?;
    validate_path(paths.pid_record())?;
    let expected = ManagedPaths::from_env()?;
    if paths != &expected || paths.proc_root() != Path::new("/proc") {
        return Err(invalid(
            "managed lifecycle paths are outside the confined runtime layout",
        ));
    }
    let root = open_directory(paths.runtime_root(), false)?;
    let metadata = root.metadata()?;
    if metadata.uid() != current_uid() || metadata.mode() & 0o7777 != 0o700 {
        return Err(invalid(
            "managed runtime directory has unsafe ownership or mode",
        ));
    }
    for name in directory_names(&root)? {
        if name.to_bytes() != b"tray.pid" && name.to_bytes() != LOCK_FILE.as_bytes() {
            return Err(invalid("unexpected managed runtime residue retained"));
        }
    }
    Ok(())
}

fn ensure_no_debris(paths: &LifecyclePaths) -> io::Result<()> {
    for parent_path in [
        paths
            .data_root
            .parent()
            .ok_or_else(|| invalid("data root has no parent"))?,
        paths
            .desktop
            .parent()
            .ok_or_else(|| invalid("desktop has no parent"))?,
    ] {
        let parent = match open_directory(parent_path, false) {
            Ok(parent) => parent,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        for name in directory_names(&parent)? {
            if name.to_bytes().starts_with(b".plasma-auto-tiler-") {
                return Err(invalid("interrupted lifecycle residue retained"));
            }
        }
    }
    if let Some(parent_path) = paths.pid_record.parent() {
        let parent = match open_directory(parent_path, false) {
            Ok(parent) => parent,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        let record_name = leaf_name(paths.pid_record())?;
        for name in directory_names(&parent)? {
            if name != record_name && name.to_bytes() != LOCK_FILE.as_bytes() {
                return Err(invalid("unexpected runtime lifecycle residue retained"));
            }
        }
    }
    Ok(())
}
fn path_exists(path: &Path) -> io::Result<bool> {
    if path.parent().is_none() {
        return Ok(false);
    }
    let parent = match open_directory(path.parent().unwrap(), false) {
        Ok(p) => p,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e),
    };
    match open_at(
        &parent,
        &leaf_name(path)?,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
    ) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}
fn absolute_env(name: &str) -> io::Result<PathBuf> {
    let path = env_path(name)?;
    if path.is_absolute() {
        Ok(path)
    } else {
        Err(invalid("environment path is not absolute"))
    }
}
fn env_path(name: &str) -> io::Result<PathBuf> {
    Ok(PathBuf::from(env::var_os(name).ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, format!("{name} is not set"))
    })?))
}
fn validate_path(path: &Path) -> io::Result<()> {
    if !path.is_absolute() {
        return Err(invalid("path is not absolute"));
    }
    for component in path.components() {
        if !matches!(component, Component::RootDir | Component::Normal(_)) {
            return Err(invalid("path contains non-normal component"));
        }
    }
    Ok(())
}
fn leaf_name(path: &Path) -> io::Result<CString> {
    CString::new(
        path.file_name()
            .ok_or_else(|| invalid("path has no leaf"))?
            .as_bytes(),
    )
    .map_err(|_| invalid("invalid path leaf"))
}
fn component_name(component: Component<'_>) -> io::Result<CString> {
    match component {
        Component::Normal(name) => {
            CString::new(name.as_bytes()).map_err(|_| invalid("invalid path component"))
        }
        _ => Err(invalid("path contains non-normal component")),
    }
}
fn unique_name(prefix: &str) -> CString {
    CString::new(format!(
        "{prefix}-{}-{}",
        std::process::id(),
        NEXT_NAME.fetch_add(1, Ordering::Relaxed)
    ))
    .unwrap()
}
fn descriptor_exec_path(file: &File) -> PathBuf {
    PathBuf::from(format!("/proc/self/fd/{}", file.as_raw_fd()))
}
fn write_sync(mut file: File, content: &[u8]) -> io::Result<()> {
    file.write_all(content)?;
    file.sync_all()
}
fn sync_backup_parent(parent: &File) -> io::Result<()> {
    #[cfg(test)]
    if FAIL_NEXT_BACKUP_SYNC.with(|fail| fail.replace(false)) {
        return Err(io::Error::other("injected backup fsync failure"));
    }
    rfs::fsync(parent).map_err(io::Error::from)
}
#[cfg(test)]
fn inject_removal_failure() -> io::Result<()> {
    let fail = FAIL_REMOVE_AFTER.with(|remaining| {
        let value = remaining.get();
        if value == 0 {
            false
        } else if value == 1 {
            remaining.set(0);
            true
        } else {
            remaining.set(value - 1);
            false
        }
    });
    if fail {
        Err(io::Error::other("injected removal failure"))
    } else {
        Ok(())
    }
}
fn observed_io(error: ObservedError) -> io::Error {
    match error {
        ObservedError::Io(e) => e,
        ObservedError::Unowned => invalid("unowned PID record"),
        ObservedError::Malformed => invalid("malformed PID record"),
    }
}
fn observed_string(error: ObservedError) -> String {
    observed_io(error).to_string()
}
fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}
fn valid_generation(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn valid_exec(value: &[u8]) -> bool {
    !value.is_empty()
        && value[0] == b'/'
        && value
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || b"/._-".contains(b))
}
fn encode_hex(content: &[u8]) -> String {
    content.iter().map(|b| format!("{b:02x}")).collect()
}
fn decode_hex(value: &str) -> Option<Vec<u8>> {
    let bytes = value.as_bytes();
    if !bytes.len().is_multiple_of(2) {
        return None;
    }
    bytes
        .chunks_exact(2)
        .map(|pair| {
            let high = hex_digit(pair[0])?;
            let low = hex_digit(pair[1])?;
            Some((high << 4) | low)
        })
        .collect()
}
fn hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

impl fmt::Display for RecordError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Unreadable => "unreadable",
            Self::Unowned => "unowned",
            Self::Malformed => "malformed",
            Self::Mismatched => "mismatched",
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    fn unit_root(name: &str) -> PathBuf {
        env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap()
            .join(format!(
                ".plasma-auto-tiler-test-unit-{name}-{}",
                std::process::id()
            ))
    }

    #[test]
    fn malformed_hex_is_byte_safe() {
        assert_eq!(decode_hex("é"), None);
        assert_eq!(decode_hex("6162"), Some(b"ab".to_vec()));
    }

    #[test]
    fn managed_final_identity_mismatch_leaves_no_record_or_temporary_file() {
        let root = unit_root("managed-final-identity");
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let captured = ProcessIdentity {
            start_tick: 10,
            resolved_executable_path: PathBuf::from(
                "/nix/store/example-plasma-auto-tiler/bin/plasma-auto-tiler",
            ),
            executable: ProcessExecutableIdentity {
                dev: 1,
                ino: 2,
                content: b"running-image".to_vec(),
            },
        };
        let matching_binary = FileIdentity {
            dev: 1,
            ino: 2,
            mode: 0o755,
            uid: 0,
            directory: false,
            content: b"running-image".to_vec(),
        };

        for (name, final_running, final_binary) in [
            (
                "path",
                ProcessIdentity {
                    resolved_executable_path: PathBuf::from(
                        "/nix/store/other-plasma-auto-tiler/bin/plasma-auto-tiler",
                    ),
                    ..captured.clone()
                },
                matching_binary.clone(),
            ),
            (
                "start",
                ProcessIdentity {
                    start_tick: 11,
                    ..captured.clone()
                },
                matching_binary.clone(),
            ),
            (
                "device",
                captured.clone(),
                FileIdentity {
                    dev: 3,
                    ..matching_binary.clone()
                },
            ),
            (
                "inode",
                captured.clone(),
                FileIdentity {
                    ino: 4,
                    ..matching_binary.clone()
                },
            ),
            (
                "content",
                captured.clone(),
                FileIdentity {
                    content: b"replacement-image".to_vec(),
                    ..matching_binary.clone()
                },
            ),
        ] {
            let record_path = root.join(format!("{name}.pid"));
            assert!(
                write_managed_record_after_identity_check(
                    &record_path,
                    &captured,
                    &final_running,
                    &final_binary,
                    "generation".to_owned(),
                )
                .is_err()
            );
            assert!(!record_path.exists());
        }
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn managed_store_path_validation_rejects_lexical_prefix_escapes() {
        for path in [
            "/nix/storehouse/example",
            "/nix/store/../tmp/example",
            "/nix/store/name/../../tmp/example",
        ] {
            assert!(!safe_store_path(Path::new(path)), "accepted {path}");
        }
        assert!(safe_store_path(Path::new(
            "/nix/store/example/bin/plasma-auto-tiler"
        )));
    }

    #[test]
    fn managed_state_anomalies_are_retained_and_fail_closed() {
        for (name, content, mode, symlink) in [
            (
                "malformed",
                b"plasma-auto-tiler-pid-owner-v1\npid=7\n".to_vec(),
                0o600,
                false,
            ),
            ("wrong-mode", b"not-owned".to_vec(), 0o644, false),
            ("unowned", b"other-owner\n".to_vec(), 0o600, false),
            ("symlink", b"target".to_vec(), 0o600, true),
        ] {
            let root = unit_root(&format!("managed-state-{name}"));
            let runtime_root = root.join("runtime");
            fs::create_dir_all(&runtime_root).unwrap();
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
            fs::set_permissions(&runtime_root, fs::Permissions::from_mode(0o700)).unwrap();
            let pid_record = runtime_root.join("tray.pid");
            if symlink {
                fs::write(runtime_root.join("target"), content).unwrap();
                fs::set_permissions(
                    runtime_root.join("target"),
                    fs::Permissions::from_mode(mode),
                )
                .unwrap();
                std::os::unix::fs::symlink("target", &pid_record).unwrap();
            } else {
                fs::write(&pid_record, content).unwrap();
                fs::set_permissions(&pid_record, fs::Permissions::from_mode(mode)).unwrap();
            }
            let paths = ManagedPaths {
                runtime_root,
                pid_record,
                proc_root: root.join("proc"),
            };

            assert!(read_managed_record(&paths).is_err(), "accepted {name}");
            assert!(paths.pid_record().exists());
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn managed_stale_start_tick_does_not_match_reused_pid() {
        let root = unit_root("managed-stale-pid");
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let binary_path =
            PathBuf::from("/nix/store/example-plasma-auto-tiler/bin/plasma-auto-tiler");
        let binary = FileIdentity {
            dev: 1,
            ino: 2,
            mode: 0o755,
            uid: 0,
            directory: false,
            content: b"running-image".to_vec(),
        };
        let record_path = root.join("tray.pid");
        let record = LifecycleRecord {
            pid: 777,
            start_tick: 10,
            resolved_executable_path: binary_path.clone(),
            generation_token: "generation".to_owned(),
        };
        write_record_with_identity(&record_path, &record, &binary).unwrap();
        let snapshot = read_record_snapshot(&record_path).unwrap().unwrap();
        let reused = ProcessIdentity {
            start_tick: 11,
            resolved_executable_path: binary_path,
            executable: ProcessExecutableIdentity {
                dev: binary.dev,
                ino: binary.ino,
                content: binary.content,
            },
        };

        assert!(!process_matches(&snapshot, &reused));
        assert!(record_path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn managed_duplicate_active_process_requires_exact_identity() {
        let current = ProcessIdentity {
            start_tick: 10,
            resolved_executable_path: PathBuf::from(
                "/nix/store/example-plasma-auto-tiler/bin/plasma-auto-tiler",
            ),
            executable: ProcessExecutableIdentity {
                dev: 1,
                ino: 2,
                content: b"running-image".to_vec(),
            },
        };
        assert!(managed_active_identity_matches(&current, &current));
        for candidate in [
            ProcessIdentity {
                resolved_executable_path: PathBuf::from(
                    "/nix/store/other-plasma-auto-tiler/bin/plasma-auto-tiler",
                ),
                ..current.clone()
            },
            ProcessIdentity {
                executable: ProcessExecutableIdentity {
                    dev: 3,
                    ..current.executable.clone()
                },
                ..current.clone()
            },
            ProcessIdentity {
                executable: ProcessExecutableIdentity {
                    ino: 4,
                    ..current.executable.clone()
                },
                ..current.clone()
            },
            ProcessIdentity {
                executable: ProcessExecutableIdentity {
                    content: b"replacement-image".to_vec(),
                    ..current.executable.clone()
                },
                ..current.clone()
            },
        ] {
            assert!(!managed_active_identity_matches(&current, &candidate));
        }
    }

    #[test]
    fn recorded_process_identity_rejects_foreign_proc_owner() {
        let root = unit_root("foreign-proc-owner");
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let process_dir = root.join("proc/777");
        fs::create_dir_all(&process_dir).unwrap();
        let dir = open_special_directory(&process_dir).unwrap();
        let foreign_uid = if current_uid() == 0 { 1 } else { 0 };

        assert_eq!(
            ProcProcessControl::identity_at(&dir, foreign_uid).unwrap(),
            None
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn oversized_encoded_binary_record_is_rejected_before_atomic_write() {
        let root = unit_root("oversized-record");
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let record_path = root.join("tray.pid");
        let record = LifecycleRecord {
            pid: 77,
            start_tick: 10,
            resolved_executable_path: root.join("plasma-auto-tiler"),
            generation_token: "generation".to_owned(),
        };
        let binary = FileIdentity {
            dev: 1,
            ino: 1,
            mode: 0o755,
            uid: current_uid(),
            directory: false,
            content: vec![0; MAX_RECORD_BYTES / 2],
        };

        let error = write_record_with_identity(&record_path, &record, &binary).unwrap_err();
        assert!(error.to_string().contains("exceeds lifecycle record limit"));
        assert!(!record_path.exists());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    fn remove_fixture(name: &str) -> (PathBuf, LifecyclePaths, TreeSnapshot, FileSnapshot) {
        let root = unit_root(name);
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let paths = LifecyclePaths::new(
            root.join("data/plasma-auto-tiler"),
            root.join("config/autostart/plasma-auto-tiler.desktop"),
            root.join("runtime/plasma-auto-tiler/tray.pid"),
            root.join("proc"),
        );
        let source = root.join("source");
        fs::write(&source, b"helper").unwrap();
        fs::set_permissions(&source, fs::Permissions::from_mode(0o755)).unwrap();
        install_locked(&paths, &source).unwrap();
        (
            root,
            paths.clone(),
            snapshot_tree(paths.data_root()).unwrap().unwrap(),
            read_file_snapshot(paths.desktop()).unwrap().unwrap(),
        )
    }

    fn rollback_copies(
        data: &TreeSnapshot,
        desktop: &FileSnapshot,
    ) -> (CString, TreeSnapshot, CString, FileSnapshot) {
        let data_name = unique_name(".plasma-auto-tiler-data-remove-test");
        let desktop_name = unique_name(".plasma-auto-tiler-desktop-remove-test");
        (
            data_name.clone(),
            copy_tree(data, &data_name).unwrap(),
            desktop_name.clone(),
            copy_file(desktop, &desktop_name).unwrap(),
        )
    }

    fn rollback_args<'a>(
        paths: &'a LifecyclePaths,
        data: &'a TreeSnapshot,
        data_copy: &'a TreeSnapshot,
        desktop: &'a FileSnapshot,
        desktop_copy: &'a FileSnapshot,
        data_copy_name: &'a CString,
        desktop_copy_name: &'a CString,
    ) -> Result<(), String> {
        rollback_remove(
            paths,
            None,
            None,
            Some(data),
            Some(data_copy),
            Some(desktop),
            Some(desktop_copy),
            &unique_name(".plasma-auto-tiler-pid-remove-test"),
            data_copy_name,
            desktop_copy_name,
        )
    }

    #[test]
    fn backup_fsync_failure_restores_original_identity() {
        let root = unit_root("backup-fsync");
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let paths = LifecyclePaths::new(
            root.join("data/plasma-auto-tiler"),
            root.join("config/autostart/plasma-auto-tiler.desktop"),
            root.join("runtime/plasma-auto-tiler/tray.pid"),
            root.join("proc"),
        );
        let source = root.join("source");
        fs::write(&source, b"v1").unwrap();
        fs::set_permissions(&source, fs::Permissions::from_mode(0o755)).unwrap();
        install_locked(&paths, &source).unwrap();
        fs::write(&source, b"v2").unwrap();
        FAIL_NEXT_BACKUP_SYNC.with(|fail| fail.set(true));
        assert!(install_locked(&paths, &source).is_err());
        assert_eq!(fs::read(paths.binary()).unwrap(), b"v1");
        let data_parent = paths.data_root().parent().unwrap();
        assert_eq!(
            fs::read_dir(data_parent)
                .unwrap()
                .map(|entry| entry.unwrap().file_name())
                .filter(|name| name.to_string_lossy().starts_with(".plasma-auto-tiler-"))
                .count(),
            0
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn install_backup_cleanup_failure_is_recovery_required_and_blocks_retry() {
        let root = unit_root("install-cleanup-failure");
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let paths = LifecyclePaths::new(
            root.join("data/plasma-auto-tiler"),
            root.join("config/autostart/plasma-auto-tiler.desktop"),
            root.join("runtime/plasma-auto-tiler/tray.pid"),
            root.join("proc"),
        );
        let source = root.join("source");
        fs::write(&source, b"v1").unwrap();
        fs::set_permissions(&source, fs::Permissions::from_mode(0o755)).unwrap();
        install_locked(&paths, &source).unwrap();
        fs::write(&source, b"v2").unwrap();

        FAIL_NEXT_INSTALL_BACKUP_CLEANUP.with(|fail| fail.set(true));
        let error = install_locked(&paths, &source).unwrap_err();
        assert!(error.contains("recovery-required"), "{error}");
        assert!(error.contains("install backup residue retained"), "{error}");
        assert!(
            directory_names(&open_directory(paths.data_root().parent().unwrap(), false).unwrap())
                .unwrap()
                .iter()
                .any(|name| name
                    .to_bytes()
                    .starts_with(b".plasma-auto-tiler-data-backup"))
        );

        let retry = install_locked(&paths, &source).unwrap_err();
        assert!(
            retry.contains("interrupted lifecycle residue retained"),
            "{retry}"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn artifact_tree_snapshot_limits_file_content_and_node_count() {
        let root = unit_root("tree-input-limits");
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();

        let content_tree = root.join("content-tree");
        fs::create_dir(&content_tree).unwrap();
        fs::set_permissions(&content_tree, fs::Permissions::from_mode(0o700)).unwrap();
        let oversized = content_tree.join("oversized");
        let file = fs::File::create(&oversized).unwrap();
        file.set_len(MAX_ARTIFACT_FILE_BYTES as u64 + 1).unwrap();
        fs::set_permissions(&oversized, fs::Permissions::from_mode(0o600)).unwrap();
        let error = match snapshot_tree(&content_tree) {
            Ok(_) => panic!("oversized tree file was accepted"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("lifecycle artifact limit"));

        let node_tree = root.join("node-tree");
        fs::create_dir(&node_tree).unwrap();
        fs::set_permissions(&node_tree, fs::Permissions::from_mode(0o700)).unwrap();
        for index in 0..=MAX_TREE_NODES {
            let path = node_tree.join(format!("node-{index}"));
            fs::write(&path, []).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        }
        let error = match snapshot_tree(&node_tree) {
            Ok(_) => panic!("oversized tree was accepted"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("too many nodes"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn remove_rollback_restores_after_each_deletion_step() {
        for (name, delete_desktop) in [("after-data", false), ("after-desktop", true)] {
            let (root, paths, data, desktop) = remove_fixture(name);
            let (data_copy_name, data_copy, desktop_copy_name, desktop_copy) =
                rollback_copies(&data, &desktop);
            let data_quarantine = unique_name(".plasma-auto-tiler-data-quarantine-test");
            quarantine_tree(&data, &data_quarantine).unwrap();
            let quarantined_data = snapshot_tree_at(&data.parent, &data_quarantine).unwrap();
            remove_tree_named(&quarantined_data, &data_quarantine).unwrap();
            if delete_desktop {
                let desktop_quarantine = unique_name(".plasma-auto-tiler-desktop-quarantine-test");
                quarantine_file(&desktop, &desktop_quarantine).unwrap();
                let quarantined_desktop =
                    snapshot_file_at(&desktop.parent, &desktop_quarantine).unwrap();
                remove_file_named(&quarantined_desktop, &desktop_quarantine).unwrap();
            }

            rollback_args(
                &paths,
                &data,
                &data_copy,
                &desktop,
                &desktop_copy,
                &data_copy_name,
                &desktop_copy_name,
            )
            .unwrap();
            assert!(paths.data_root().exists());
            assert!(paths.desktop().exists());
            assert!(snapshot_tree_at(&data_copy.parent, &data_copy_name).is_err());
            assert!(snapshot_file_at(&desktop_copy.parent, &desktop_copy_name).is_err());
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn remove_with_paths_restores_after_data_and_desktop_deletion_failures() {
        for (name, removals_before_failure, expect_residue) in [
            ("remove-data-failure", 1, true),
            ("remove-desktop-failure", 5, false),
        ] {
            let (root, paths, _, _) = remove_fixture(name);
            let data = snapshot_tree(paths.data_root()).unwrap().unwrap();
            let desktop = read_file_snapshot(paths.desktop()).unwrap().unwrap();
            FAIL_REMOVE_AFTER.with(|remaining| remaining.set(removals_before_failure));

            let error = remove_with_paths(&paths).unwrap_err();
            assert!(same_tree_metadata_content(
                &data,
                &snapshot_tree(paths.data_root()).unwrap().unwrap()
            ));
            assert!(same_file_metadata_content(
                &desktop,
                &read_file_snapshot(paths.desktop()).unwrap().unwrap()
            ));
            assert!(
                !directory_names(
                    &open_directory(paths.data_root().parent().unwrap(), false).unwrap()
                )
                .unwrap()
                .iter()
                .any(|name| name
                    .to_bytes()
                    .starts_with(b".plasma-auto-tiler-data-remove"))
            );
            assert!(
                !directory_names(
                    &open_directory(paths.desktop().parent().unwrap(), false).unwrap()
                )
                .unwrap()
                .iter()
                .any(|name| name
                    .to_bytes()
                    .starts_with(b".plasma-auto-tiler-desktop-remove"))
            );
            if expect_residue {
                assert!(error.contains("recovery-required"), "{error}");
                assert!(
                    directory_names(
                        &open_directory(paths.data_root().parent().unwrap(), false).unwrap()
                    )
                    .unwrap()
                    .iter()
                    .any(|name| {
                        name.to_bytes()
                            .starts_with(b".plasma-auto-tiler-data-quarantine")
                    })
                );
            } else {
                assert!(!error.contains("recovery-required"), "{error}");
                assert!(
                    !directory_names(
                        &open_directory(paths.data_root().parent().unwrap(), false).unwrap()
                    )
                    .unwrap()
                    .iter()
                    .any(|name| {
                        name.to_bytes()
                            .starts_with(b".plasma-auto-tiler-data-quarantine")
                    })
                );
                assert!(
                    !directory_names(
                        &open_directory(paths.desktop().parent().unwrap(), false).unwrap()
                    )
                    .unwrap()
                    .iter()
                    .any(|name| {
                        name.to_bytes()
                            .starts_with(b".plasma-auto-tiler-desktop-quarantine")
                    })
                );
            }
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn remove_rollback_restores_the_pid_record_copy() {
        let (root, paths, _, _) = remove_fixture("pid-remove-rollback");
        let record = LifecycleRecord {
            pid: 77,
            start_tick: 10,
            resolved_executable_path: paths.binary().to_path_buf(),
            generation_token: "generation".to_owned(),
        };
        write_record(paths.pid_record(), &record).unwrap();
        let snapshot = read_record_snapshot(paths.pid_record()).unwrap().unwrap();
        let copy_name = unique_name(".plasma-auto-tiler-pid-remove-test");
        let copy = copy_file(&snapshot.file, &copy_name).unwrap();
        remove_file_snapshot(&snapshot.file).unwrap();

        rollback_remove(
            &paths,
            Some(&snapshot),
            Some(&copy),
            None,
            None,
            None,
            None,
            &copy_name,
            &unique_name(".plasma-auto-tiler-data-remove-test"),
            &unique_name(".plasma-auto-tiler-desktop-remove-test"),
        )
        .unwrap();
        assert_eq!(
            read_record(paths.pid_record()),
            RecordObservation::Owned(record)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn remove_with_paths_restores_pid_record_after_removal_failure() {
        let (root, paths, data, desktop) = remove_fixture("pid-remove-failure");
        let record = LifecycleRecord {
            pid: 77,
            start_tick: 10,
            resolved_executable_path: paths.binary().to_path_buf(),
            generation_token: "generation".to_owned(),
        };
        write_record(paths.pid_record(), &record).unwrap();
        let record_before = read_record_snapshot(paths.pid_record()).unwrap().unwrap();

        FAIL_REMOVE_AFTER.with(|remaining| remaining.set(1));
        let error = remove_with_paths(&paths).unwrap_err();
        assert!(error.contains("injected removal failure"), "{error}");

        let restored_record = read_record_snapshot(paths.pid_record()).unwrap().unwrap();
        assert_eq!(restored_record.record, record_before.record);
        assert!(same_file_metadata_content(
            &record_before.file,
            &restored_record.file
        ));
        assert_eq!(restored_record.binary, record_before.binary);
        assert!(same_tree_identity(
            &data,
            &snapshot_tree(paths.data_root()).unwrap().unwrap()
        ));
        assert_eq!(
            desktop.identity,
            read_file_snapshot(paths.desktop())
                .unwrap()
                .unwrap()
                .identity
        );
        assert!(
            !directory_names(&open_directory(paths.pid_record().parent().unwrap(), false).unwrap())
                .unwrap()
                .iter()
                .any(|name| name
                    .to_bytes()
                    .starts_with(b".plasma-auto-tiler-pid-remove"))
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rollback_copy_preserves_metadata_and_content_and_copy_collision() {
        let (root, paths, data, desktop) = remove_fixture("copy-fidelity");
        let (data_copy_name, data_copy, desktop_copy_name, desktop_copy) =
            rollback_copies(&data, &desktop);
        assert!(same_tree_metadata_content(&data, &data_copy));
        assert!(same_file_metadata_content(&desktop, &desktop_copy));
        assert_eq!(data_copy.root.metadata().unwrap().mode() & 0o7777, 0o700);
        assert_eq!(desktop_copy.file.metadata().unwrap().mode() & 0o7777, 0o600);

        let collision = paths.desktop().to_path_buf();
        fs::remove_file(&collision).unwrap();
        fs::write(&collision, b"replacement").unwrap();
        fs::set_permissions(&collision, fs::Permissions::from_mode(0o600)).unwrap();
        let error = rollback_args(
            &paths,
            &data,
            &data_copy,
            &desktop,
            &desktop_copy,
            &data_copy_name,
            &desktop_copy_name,
        )
        .unwrap_err();
        assert!(error.contains("replacement"));
        assert_eq!(fs::read(collision).unwrap(), b"replacement");
        assert!(paths.data_root().exists());
        assert!(snapshot_tree_at(&data_copy.parent, &data_copy_name).is_err());
        assert!(snapshot_file_at(&desktop_copy.parent, &desktop_copy_name).is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanup_replaced_file_copy_is_retained_and_reported() {
        let (root, paths, _, desktop) = remove_fixture("cleanup-replaced-file");
        let copy_name = unique_name(".plasma-auto-tiler-desktop-remove-test");
        let copy = copy_file(&desktop, &copy_name).unwrap();
        let copy_path = paths
            .desktop()
            .parent()
            .unwrap()
            .join(copy_name.to_string_lossy().as_ref());
        fs::remove_file(&copy_path).unwrap();
        fs::write(&copy_path, &desktop.identity.content).unwrap();
        fs::set_permissions(&copy_path, fs::Permissions::from_mode(0o600)).unwrap();

        let error = cleanup_file_copy(&copy).unwrap_err();
        assert!(error.contains("identity changed"), "{error}");
        assert_eq!(fs::read(copy_path).unwrap(), desktop.identity.content);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanup_replaced_tree_copy_is_retained_and_reported() {
        let (root, paths, data, _) = remove_fixture("cleanup-replaced-tree");
        let copy_name = unique_name(".plasma-auto-tiler-data-remove-test");
        let copy = copy_tree(&data, &copy_name).unwrap();
        let copy_path = paths
            .data_root()
            .parent()
            .unwrap()
            .join(copy_name.to_string_lossy().as_ref());
        fs::remove_dir_all(&copy_path).unwrap();
        let replacement_name = unique_name(".plasma-auto-tiler-data-replacement-test");
        let replacement = copy_tree(&data, &replacement_name).unwrap();
        rename_noreplace(
            &replacement.parent,
            &replacement_name,
            &replacement.parent,
            &copy_name,
        )
        .unwrap();
        let current = snapshot_tree_at(&copy.parent, &copy_name).unwrap();
        assert!(same_tree_metadata_content(&copy, &current));

        let error = cleanup_tree_copy(&copy).unwrap_err();
        assert!(error.contains("identity changed"), "{error}");
        assert_eq!(
            fs::read(copy_path.join("bin/plasma-auto-tiler")).unwrap(),
            b"helper"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rollback_copy_failure_and_cleanup_failure_fail_closed() {
        let (root, paths, data, desktop) = remove_fixture("copy-cleanup-failure");
        let exact_collision = paths
            .desktop()
            .parent()
            .unwrap()
            .join("copy-exact-collision");
        fs::copy(paths.desktop(), &exact_collision).unwrap();
        let error = match copy_file(&desktop, &CString::new("copy-exact-collision").unwrap()) {
            Ok(_) => panic!("copy unexpectedly replaced exact collision"),
            Err(error) => error,
        };
        assert!(!error.contains("recovery-required"));
        assert!(exact_collision.exists());
        fs::remove_file(exact_collision).unwrap();

        let collision = paths.desktop().parent().unwrap().join("copy-collision");
        fs::write(&collision, b"collision").unwrap();
        fs::set_permissions(&collision, fs::Permissions::from_mode(0o600)).unwrap();
        let error = match copy_file(&desktop, &CString::new("copy-collision").unwrap()) {
            Ok(_) => panic!("copy unexpectedly replaced collision"),
            Err(error) => error,
        };
        assert!(error.contains("exists"));
        assert_eq!(fs::read(collision).unwrap(), b"collision");

        let (data_name, data_copy, desktop_name, desktop_copy) = rollback_copies(&data, &desktop);
        fs::set_permissions(
            paths.data_root().parent().unwrap(),
            fs::Permissions::from_mode(0o500),
        )
        .unwrap();
        let error = cleanup_remove_copies(None, Some(&data_copy), Some(&desktop_copy)).unwrap_err();
        assert!(error.contains("clean data rollback copy"));
        assert!(snapshot_tree_at(&data_copy.parent, &data_name).is_ok());
        fs::set_permissions(
            paths.data_root().parent().unwrap(),
            fs::Permissions::from_mode(0o700),
        )
        .unwrap();
        let retry_error =
            cleanup_remove_copies(None, Some(&data_copy), Some(&desktop_copy)).unwrap_err();
        assert!(retry_error.contains("clean data rollback copy"));
        assert!(retry_error.contains("identity changed"));
        assert!(snapshot_tree_at(&data_copy.parent, &data_name).is_ok());
        assert!(snapshot_file_at(&desktop_copy.parent, &desktop_name).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn start_rollback_removes_uncommitted_launch_reservation() {
        let root = unit_root("start-rollback");
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let paths = LifecyclePaths::new(
            root.join("data/plasma-auto-tiler"),
            root.join("config/autostart/plasma-auto-tiler.desktop"),
            root.join("runtime/plasma-auto-tiler/tray.pid"),
            root.join("proc"),
        );
        let source = root.join("source");
        fs::write(&source, b"v1").unwrap();
        fs::set_permissions(&source, fs::Permissions::from_mode(0o755)).unwrap();
        install_locked(&paths, &source).unwrap();
        let parent = open_directory(paths.pid_record().parent().unwrap(), true).unwrap();
        let name = unique_name(".plasma-auto-tiler-start-test");
        let file = create_file_at(&parent, &name, 0o600).unwrap();
        file.sync_all().unwrap();
        let reservation = snapshot_file_at(&parent, &name).unwrap();
        let mut child = Command::new(env::current_exe().unwrap())
            .args(["--exact", "__does_not_exist__"])
            .spawn()
            .unwrap();
        let child_pid = child.id();
        child.wait().unwrap();

        rollback_start(
            &paths,
            &reservation,
            &mut child,
            child_pid,
            None,
            &installed_binary(&paths).unwrap().identity,
        )
        .unwrap();

        assert!(snapshot_file_at(&parent, &name).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn start_rollback_retains_pid_record_without_child_identity() {
        let root = unit_root("start-rollback-record");
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let paths = LifecyclePaths::new(
            root.join("data/plasma-auto-tiler"),
            root.join("config/autostart/plasma-auto-tiler.desktop"),
            root.join("runtime/plasma-auto-tiler/tray.pid"),
            root.join("proc"),
        );
        let source = root.join("source");
        fs::write(&source, b"v1").unwrap();
        fs::set_permissions(&source, fs::Permissions::from_mode(0o755)).unwrap();
        install_locked(&paths, &source).unwrap();
        let parent = open_directory(paths.pid_record().parent().unwrap(), true).unwrap();
        let name = unique_name(".plasma-auto-tiler-start-test");
        let file = create_file_at(&parent, &name, 0o600).unwrap();
        file.sync_all().unwrap();
        let reservation = snapshot_file_at(&parent, &name).unwrap();
        let mut child = Command::new(env::current_exe().unwrap())
            .args(["--exact", "__does_not_exist__"])
            .spawn()
            .unwrap();
        let child_pid = child.id();
        child.wait().unwrap();
        write_record(
            paths.pid_record(),
            &LifecycleRecord {
                pid: child_pid,
                start_tick: 10,
                resolved_executable_path: paths.binary().to_path_buf(),
                generation_token: "generation".to_owned(),
            },
        )
        .unwrap();

        let error = rollback_start(
            &paths,
            &reservation,
            &mut child,
            child_pid,
            None,
            &installed_binary(&paths).unwrap().identity,
        )
        .unwrap_err();

        assert!(error.contains("child identity unavailable"), "{error}");
        assert!(paths.pid_record().exists());
        assert!(snapshot_file_at(&parent, &name).is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn denied_proc_executable_access_blocks_remove_for_truncated_comm() {
        let root = unit_root("denied-proc-exe");
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let paths = LifecyclePaths::new(
            root.join("data/plasma-auto-tiler"),
            root.join("config/autostart/plasma-auto-tiler.desktop"),
            root.join("runtime/plasma-auto-tiler/tray.pid"),
            root.join("proc"),
        );
        let source = env::current_exe().unwrap();
        install_locked(&paths, &source).unwrap();
        let process_dir = paths.proc_root().join("777");
        fs::create_dir_all(&process_dir).unwrap();
        let fields = (0..20)
            .map(|index| {
                if index == 0 {
                    "S"
                } else if index == 19 {
                    "10"
                } else {
                    "0"
                }
            })
            .collect::<Vec<_>>();
        fs::write(
            process_dir.join("stat"),
            format!("777 (plasma-auto-til) {}", fields.join(" ")),
        )
        .unwrap();
        std::os::unix::fs::symlink(paths.binary(), process_dir.join("exe")).unwrap();

        DENY_PROC_EXE_ACCESS.with(|denied| denied.set(true));
        let result = remove_with_paths(&paths);
        DENY_PROC_EXE_ACCESS.with(|denied| denied.set(false));
        let error = result.unwrap_err();
        assert!(error.contains("Permission denied"), "{error}");
        assert!(paths.data_root().exists());
        assert!(paths.binary().exists());
        assert!(paths.desktop().exists());
        assert!(!paths.pid_record().exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn denied_proc_executable_access_ignores_unrelated_command() {
        let root = unit_root("denied-proc-exe-unrelated");
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let paths = LifecyclePaths::new(
            root.join("data/plasma-auto-tiler"),
            root.join("config/autostart/plasma-auto-tiler.desktop"),
            root.join("runtime/plasma-auto-tiler/tray.pid"),
            root.join("proc"),
        );
        let source = env::current_exe().unwrap();
        install_locked(&paths, &source).unwrap();
        let process_dir = paths.proc_root().join("777");
        fs::create_dir_all(&process_dir).unwrap();
        let fields = (0..20)
            .map(|index| {
                if index == 0 {
                    "S"
                } else if index == 19 {
                    "10"
                } else {
                    "0"
                }
            })
            .collect::<Vec<_>>();
        fs::write(
            process_dir.join("stat"),
            format!("777 (unrelated-comman) {}", fields.join(" ")),
        )
        .unwrap();
        std::os::unix::fs::symlink(paths.binary(), process_dir.join("exe")).unwrap();

        DENY_PROC_EXE_ACCESS.with(|denied| denied.set(true));
        let result = remove_with_paths(&paths);
        DENY_PROC_EXE_ACCESS.with(|denied| denied.set(false));
        result.unwrap();
        assert!(!paths.data_root().exists());
        assert!(!paths.desktop().exists());

        fs::remove_dir_all(root).unwrap();
    }
}
