use std::collections::VecDeque;
use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use plasma_auto_tiler::tray_lifecycle::{
    LifecyclePaths, LifecycleRecord, PID_OWNER_MARKER, ProcessControl, ProcessIdentity,
    RecordError, RecordObservation, StopOutcome, install_with_source, read_record,
    remove_with_paths, stop_with, write_record,
};
use rustix::fs::{self as rfs, Mode};

fn fixture(name: &str) -> (PathBuf, LifecyclePaths) {
    let root = PathBuf::from(std::env::var_os("HOME").unwrap()).join(format!(
        ".plasma-auto-tiler-test-{name}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir(&root).unwrap();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
    let paths = LifecyclePaths::new(
        root.join("data/plasma-auto-tiler"),
        root.join("config/autostart/plasma-auto-tiler.desktop"),
        root.join("runtime/plasma-auto-tiler/tray.pid"),
        root.join("proc"),
    );
    (root, paths)
}

fn source(root: &Path, contents: &[u8]) -> PathBuf {
    let path = root.join("source-helper");
    fs::write(&path, contents).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn clean(root: PathBuf) {
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn install_and_exact_remove_round_trip() {
    let (root, paths) = fixture("round-trip");
    install_with_source(&paths, &source(&root, b"helper-v1")).unwrap();
    assert_eq!(fs::read(paths.binary()).unwrap(), b"helper-v1");
    assert!(paths.binary().metadata().unwrap().mode() & 0o7777 == 0o755);
    remove_with_paths(&paths).unwrap();
    assert!(!paths.data_root().exists());
    assert!(!paths.desktop().exists());
    clean(root);
}

#[test]
fn pid_record_has_exact_schema_mode_and_final_newline() {
    let (root, paths) = fixture("pid-record");
    install_with_source(&paths, &source(&root, b"helper")).unwrap();
    let record = LifecycleRecord {
        pid: 77,
        start_tick: 123,
        resolved_executable_path: paths.binary().to_path_buf(),
        generation_token: "generation-1".to_owned(),
    };
    write_record(paths.pid_record(), &record).unwrap();
    let text = fs::read_to_string(paths.pid_record()).unwrap();
    assert!(text.ends_with('\n'));
    assert_eq!(text.lines().count(), 8);
    assert_eq!(
        fs::metadata(paths.pid_record()).unwrap().mode() & 0o7777,
        0o600
    );
    assert_eq!(
        read_record(paths.pid_record()),
        RecordObservation::Owned(record)
    );
    clean(root);
}

#[test]
fn malformed_or_wrong_mode_record_is_retained() {
    let (root, paths) = fixture("bad-record");
    fs::create_dir_all(paths.pid_record().parent().unwrap()).unwrap();
    fs::write(paths.pid_record(), format!("{PID_OWNER_MARKER}\npid=7\n")).unwrap();
    fs::set_permissions(paths.pid_record(), fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(
        read_record(paths.pid_record()),
        RecordObservation::Malformed
    );
    let error = remove_with_paths(&paths).unwrap_err();
    assert!(error.contains("malformed"));
    assert!(paths.pid_record().exists());
    clean(root);
}

#[test]
fn malformed_unicode_hex_record_is_rejected_without_panicking() {
    let (root, paths) = fixture("malformed-hex");
    fs::create_dir_all(paths.pid_record().parent().unwrap()).unwrap();
    fs::write(
        paths.pid_record(),
        format!(
            "{PID_OWNER_MARKER}\npid=7\nstart_tick=1\nresolved_executable_path={}\ngeneration_token=g\nbinary_dev=1\nbinary_ino=1\nbinary_content=é\n",
            paths.binary().display()
        ),
    )
    .unwrap();
    fs::set_permissions(paths.pid_record(), fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(
        read_record(paths.pid_record()),
        RecordObservation::Malformed
    );
    clean(root);
}

#[test]
fn install_refuses_malformed_existing_record_before_replacement() {
    let (root, paths) = fixture("install-record-preflight");
    install_with_source(&paths, &source(&root, b"helper-v1")).unwrap();
    fs::write(
        paths.pid_record(),
        format!(
            "{PID_OWNER_MARKER}\npid=7\nstart_tick=1\nresolved_executable_path={}\ngeneration_token=g\nbinary_dev=1\nbinary_ino=1\nbinary_content=é\n",
            paths.binary().display()
        ),
    )
    .unwrap();
    fs::set_permissions(paths.pid_record(), fs::Permissions::from_mode(0o600)).unwrap();
    let error = install_with_source(&paths, &source(&root, b"helper-v2")).unwrap_err();
    assert!(error.contains("malformed"), "{error}");
    assert_eq!(fs::read(paths.binary()).unwrap(), b"helper-v1");
    assert!(paths.pid_record().exists());
    clean(root);
}

#[test]
fn special_and_oversized_pid_records_are_rejected_without_reading_unbounded_data() {
    let (root, paths) = fixture("record-input-limits");
    let runtime_parent = paths.pid_record().parent().unwrap();
    fs::create_dir_all(runtime_parent).unwrap();
    rfs::mkfifoat(rfs::CWD, paths.pid_record(), Mode::from_raw_mode(0o600)).unwrap();
    assert_eq!(
        read_record(paths.pid_record()),
        RecordObservation::Unreadable
    );
    fs::remove_file(paths.pid_record()).unwrap();

    fs::write(paths.pid_record(), vec![b'x'; 1024 * 1024 + 1]).unwrap();
    fs::set_permissions(paths.pid_record(), fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(
        read_record(paths.pid_record()),
        RecordObservation::Unreadable
    );
    clean(root);
}

#[test]
fn pid_reuse_and_installed_replacement_do_not_signal() {
    let (root, paths) = fixture("binding");
    install_with_source(&paths, &source(&root, b"helper")).unwrap();
    let record = LifecycleRecord {
        pid: 77,
        start_tick: 10,
        resolved_executable_path: paths.binary().to_path_buf(),
        generation_token: "generation".to_owned(),
    };
    write_record(paths.pid_record(), &record).unwrap();
    let process = FakeProcess::new(Some(ProcessIdentity {
        start_tick: 11,
        resolved_executable_path: paths.binary().to_path_buf(),
    }));
    assert_eq!(
        stop_with(&paths, &process).unwrap(),
        StopOutcome::Retained(RecordError::Mismatched)
    );
    assert_eq!(process.terminated(), 0);
    fs::remove_file(paths.binary()).unwrap();
    fs::write(paths.binary(), b"replacement").unwrap();
    fs::set_permissions(paths.binary(), fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        stop_with(
            &paths,
            &FakeProcess::new(Some(ProcessIdentity {
                start_tick: 10,
                resolved_executable_path: paths.binary().to_path_buf()
            }))
        )
        .unwrap(),
        StopOutcome::Retained(RecordError::Mismatched)
    );
    assert!(paths.pid_record().exists());
    clean(root);
}

#[test]
fn status_uses_installed_binary_binding_before_reporting_running() {
    let (root, paths) = fixture("status-binding");
    install_with_source(&paths, &source(&root, b"helper")).unwrap();
    write_record(
        paths.pid_record(),
        &LifecycleRecord {
            pid: 77,
            start_tick: 10,
            resolved_executable_path: paths.binary().to_path_buf(),
            generation_token: "generation".to_owned(),
        },
    )
    .unwrap();
    fs::remove_file(paths.binary()).unwrap();
    fs::write(paths.binary(), b"replacement").unwrap();
    fs::set_permissions(paths.binary(), fs::Permissions::from_mode(0o755)).unwrap();

    let output = Command::new(std::env::var_os("CARGO_BIN_EXE_plasma-auto-tiler").unwrap())
        .arg("tray-status")
        .env("HOME", &root)
        .env("XDG_DATA_HOME", root.join("data"))
        .env("XDG_CONFIG_HOME", root.join("config"))
        .env("XDG_RUNTIME_DIR", root.join("runtime"))
        .output()
        .unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("unknown"));
    assert!(!stdout.contains("running"));
    assert!(paths.pid_record().exists());
    clean(root);
}

#[test]
fn waiter_error_retains_record_after_signal() {
    let (root, paths) = fixture("waiter-error");
    install_with_source(&paths, &source(&root, b"helper")).unwrap();
    let record = LifecycleRecord {
        pid: 77,
        start_tick: 10,
        resolved_executable_path: paths.binary().to_path_buf(),
        generation_token: "generation".to_owned(),
    };
    write_record(paths.pid_record(), &record).unwrap();
    let process = FakeProcess::with_results([
        Ok(Some(ProcessIdentity {
            start_tick: 10,
            resolved_executable_path: paths.binary().to_path_buf(),
        })),
        Err(std::io::Error::other("waiter failed")),
    ]);
    assert_eq!(
        stop_with(&paths, &process).unwrap(),
        StopOutcome::Retained(RecordError::Unreadable)
    );
    assert_eq!(process.terminated(), 1);
    assert!(paths.pid_record().exists());
    clean(root);
}

#[test]
fn cooperative_install_commands_serialize() {
    let (root, paths) = fixture("concurrent");
    let source = source(&root, b"helper");
    let a_paths = paths.clone();
    let b_paths = paths.clone();
    let a_source = source.clone();
    let b_source = source.clone();
    let a = thread::spawn(move || install_with_source(&a_paths, &a_source));
    let b = thread::spawn(move || install_with_source(&b_paths, &b_source));
    let a_result = a.join().unwrap();
    let b_result = b.join().unwrap();
    assert!(a_result.is_ok(), "first install: {a_result:?}");
    assert!(b_result.is_ok(), "second install: {b_result:?}");
    remove_with_paths(&paths).unwrap();
    clean(root);
}

#[test]
fn cooperative_remove_commands_serialize() {
    let (root, paths) = fixture("concurrent-remove");
    install_with_source(&paths, &source(&root, b"helper")).unwrap();
    let a_paths = paths.clone();
    let b_paths = paths.clone();
    let a = thread::spawn(move || remove_with_paths(&a_paths));
    let b = thread::spawn(move || remove_with_paths(&b_paths));
    let a_result = a.join().unwrap();
    let b_result = b.join().unwrap();
    assert!(a_result.is_ok(), "first remove: {a_result:?}");
    assert!(b_result.is_ok(), "second remove: {b_result:?}");
    assert!(!paths.data_root().exists());
    assert!(!paths.desktop().exists());
    clean(root);
}

#[test]
fn project_lock_is_acquired_before_layout_validation() {
    let (root, paths) = fixture("lock-order");
    let runtime_parent = paths.pid_record().parent().unwrap();
    fs::create_dir_all(runtime_parent).unwrap();
    let lock = runtime_parent.join(".plasma-auto-tiler.lock");
    fs::write(&lock, b"").unwrap();
    fs::set_permissions(&lock, fs::Permissions::from_mode(0o600)).unwrap();

    let invalid_paths = LifecyclePaths::new(
        root.join("invalid/plasma-auto-tiler"),
        paths.desktop().to_path_buf(),
        paths.pid_record().to_path_buf(),
        paths.proc_root().to_path_buf(),
    );
    let error = remove_with_paths(&invalid_paths).unwrap_err();
    assert!(error.contains("retained project lock"), "{error}");
    assert!(lock.exists());
    clean(root);
}

#[test]
fn every_lifecycle_command_checks_the_project_lock_first() {
    let (root, paths) = fixture("lock-first-all");
    let runtime_parent = paths.pid_record().parent().unwrap();
    fs::create_dir_all(runtime_parent).unwrap();
    fs::set_permissions(root.join("runtime"), fs::Permissions::from_mode(0o700)).unwrap();
    let lock = runtime_parent.join(".plasma-auto-tiler.lock");
    fs::write(&lock, b"").unwrap();
    fs::set_permissions(&lock, fs::Permissions::from_mode(0o600)).unwrap();
    let executable = std::env::var_os("CARGO_BIN_EXE_plasma-auto-tiler").unwrap();

    for command in [
        "tray-install",
        "tray-start",
        "tray-status",
        "tray-stop",
        "tray-remove",
    ] {
        let output = Command::new(&executable)
            .arg(command)
            .env("HOME", &root)
            .env("XDG_DATA_HOME", root.join("data"))
            .env("XDG_CONFIG_HOME", root.join("config"))
            .env("XDG_RUNTIME_DIR", root.join("runtime"))
            .output()
            .unwrap();
        assert!(!output.status.success(), "{command} unexpectedly succeeded");
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("retained project lock"),
            "{command}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    assert!(lock.exists());
    clean(root);
}

#[test]
fn replacement_is_preserved_when_owned_tree_becomes_unsafe() {
    let (root, paths) = fixture("replacement-preserved");
    install_with_source(&paths, &source(&root, b"helper")).unwrap();
    fs::set_permissions(paths.binary(), fs::Permissions::from_mode(0o644)).unwrap();
    let error = remove_with_paths(&paths).unwrap_err();
    assert!(error.contains("unexpected") || error.contains("invalid"));
    assert!(paths.binary().exists());
    clean(root);
}

#[test]
fn unrecorded_active_helper_is_refused() {
    let (root, paths) = fixture("unrecorded");
    fs::create_dir_all(paths.binary().parent().unwrap()).unwrap();
    fs::write(paths.binary(), b"helper").unwrap();
    fs::set_permissions(paths.binary(), fs::Permissions::from_mode(0o755)).unwrap();
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
        format!("777 (tray-helper) {}", fields.join(" ")),
    )
    .unwrap();
    std::os::unix::fs::symlink(paths.binary(), process_dir.join("exe")).unwrap();
    let error = remove_with_paths(&paths).unwrap_err();
    assert!(error.contains("unrecorded active helper"));
    clean(root);
}

struct FakeProcess {
    identities: Arc<Mutex<VecDeque<std::io::Result<Option<ProcessIdentity>>>>>,
    terminated: Arc<Mutex<usize>>,
}

impl FakeProcess {
    fn new(identity: Option<ProcessIdentity>) -> Self {
        Self::with_results([Ok(identity)])
    }
    fn with_results(
        identities: impl IntoIterator<Item = std::io::Result<Option<ProcessIdentity>>>,
    ) -> Self {
        Self {
            identities: Arc::new(Mutex::new(identities.into_iter().collect())),
            terminated: Arc::new(Mutex::new(0)),
        }
    }
    fn terminated(&self) -> usize {
        *self.terminated.lock().unwrap()
    }
}

impl ProcessControl for FakeProcess {
    fn identity(&self, _pid: u32) -> std::io::Result<Option<ProcessIdentity>> {
        self.identities
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Ok(None))
    }
    fn terminate(&self, _pid: u32, _expected: &ProcessIdentity) -> std::io::Result<()> {
        *self.terminated.lock().unwrap() += 1;
        Ok(())
    }
}
