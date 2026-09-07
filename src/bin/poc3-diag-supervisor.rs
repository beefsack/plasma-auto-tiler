//! POC3 diagnostic supervisor (diagnostic/test-only, resident).
//!
//! Owns exactly three unchanged `poc3-diagnostic-client` processes.
//! Strict explicit target only: `--runtime DIR --socket NAME --client-bin
//! PATH --workdir DIR [--timeout-secs N]`. Refuses missing, default,
//! ambient, or host targets with no fallback. Never emits user path or
//! environment content.
//!
//! Documented standard descriptors: exactly 0, 1, 2 are preserved.
//! Every other inherited descriptor is closed before spawning clients.
//! Bounded first-map readiness: polls each `manual-N.diag.log` for the
//! exact `"event":"first-map"` marker within `--timeout-secs` (default 20).
//! Early slot failure (any child exit before ready) terminates the rest
//! and exits non-zero with bounded diagnostics. After ready the supervisor
//! stays resident until SIGTERM/SIGINT, forwarding termination to clients.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::os::unix::io::AsRawFd;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

use plasma_auto_tiler::poc3_diag::create_diag_file;
use plasma_auto_tiler::poc3_diag_supervisor::{
    SupEvent, SupervisorConfig, client_argv, client_diag_path, client_stderr_path,
    diag_contains_first_map, fds_to_close, format_sup_event, host_client_argv,
    host_client_diag_path, host_client_stderr_path, is_proc_fd_enumeration_target,
    parse_supervisor_args, supervisor_diag_path, supervisor_pidfile_path, supervisor_ready_path,
};

static SIGNAL_EXIT: AtomicBool = AtomicBool::new(false);

unsafe extern "C" fn on_signal(_: i32) {
    SIGNAL_EXIT.store(true, Ordering::SeqCst);
}

fn install_signal_handlers() {
    #[repr(C)]
    struct Sigaction {
        handler: usize,
        mask: [u64; 16],
        flags: i32,
        _restorer: usize,
    }
    unsafe extern "C" {
        fn sigaction(signum: i32, act: *const Sigaction, old: *mut Sigaction) -> i32;
    }
    unsafe {
        let act = Sigaction {
            handler: on_signal as *const () as usize,
            mask: [0; 16],
            flags: 0,
            _restorer: 0,
        };
        sigaction(2, &act, std::ptr::null_mut());
        sigaction(15, &act, std::ptr::null_mut());
    }
}

fn signal_requested() -> bool {
    SIGNAL_EXIT.load(Ordering::SeqCst)
}

struct SupLog {
    file: File,
    seq: u64,
    bytes: usize,
    capped: bool,
}

impl SupLog {
    fn create(path: &std::path::Path) -> std::io::Result<Self> {
        let file = create_diag_file(path)?;
        Ok(Self {
            file,
            seq: 0,
            bytes: 0,
            capped: false,
        })
    }

    fn push(&mut self, event: &SupEvent) {
        if self.capped {
            return;
        }
        self.seq += 1;
        let Some(mut text) = format_sup_event(self.seq, event) else {
            return;
        };
        text.push('\n');
        if self.bytes + text.len() > plasma_auto_tiler::poc3_diag_supervisor::MAX_SUP_FILE_BYTES {
            self.capped = true;
            return;
        }
        if self.file.write_all(text.as_bytes()).is_err() {
            self.capped = true;
            return;
        }
        let _ = self.file.flush();
        self.bytes += text.len();
    }
}

/// Close every inherited descriptor except documented 0/1/2.
/// The live `/proc` enumeration FD itself is never closed or reused: entries
/// whose link target is the enumeration directory are skipped, the directory
/// handle is dropped before any close, and failures are ignored.
fn close_inherited_fds() {
    let mut dir = match std::fs::read_dir("/proc/self/fd") {
        Ok(d) => d,
        Err(_) => return,
    };
    let self_pid = std::process::id();
    let mut observed: Vec<i32> = Vec::new();
    for entry in dir.by_ref().flatten() {
        let name = entry.file_name();
        let s = name.to_string_lossy();
        let Ok(fd) = s.parse::<i32>() else {
            continue;
        };
        let link = format!("/proc/self/fd/{fd}");
        let target = std::fs::read_link(&link)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        if is_proc_fd_enumeration_target(&target, self_pid) {
            continue;
        }
        observed.push(fd);
    }
    drop(dir);
    for fd in fds_to_close(&observed) {
        unsafe {
            libc_close(fd);
        }
    }
}

unsafe fn libc_close(fd: i32) {
    unsafe extern "C" {
        fn close(fd: i32) -> i32;
    }
    // Preserve documented standard descriptors even if caller passed them in
    // the observed list (filter already did this, double-guard here).
    if fd == 0 || fd == 1 || fd == 2 {
        return;
    }
    unsafe {
        close(fd);
    }
}

fn load_config(argv: &[String]) -> Result<(SupervisorConfig, bool), String> {
    use plasma_auto_tiler::poc3_diag_supervisor::parse_host_supervisor_args;
    let uid = rustix::process::getuid().as_raw();
    let get_env = |k: &str| std::env::var(k).ok();
    let is_host = argv.iter().any(|a| a == "--host");
    if is_host {
        return parse_host_supervisor_args(argv, uid, &get_env).map(|c| (c, true)).map_err(|e| format!("error: {} ({})\nusage: poc3-diag-supervisor --host --runtime DIR --socket NAME --client-bin PATH --client-sha256 HEX --client-dev DEV --client-ino INO --workdir DIR [--timeout-secs N]", e.message(), e.kind()));
    }
    parse_supervisor_args(argv, uid, &get_env)
        .map(|c| (c, false))
        .map_err(|e| format!("error: {} ({})\nusage: poc3-diag-supervisor --runtime DIR --socket NAME --client-bin PATH --client-sha256 HEX --client-dev DEV --client-ino INO --workdir DIR [--timeout-secs N]", e.message(), e.kind()))
}

fn private_child_env(workdir: &str) -> Vec<(String, String)> {
    // Deliberately omits XDG_RUNTIME_DIR/WAYLAND_DISPLAY/WAYLAND_SOCKET/
    // DISPLAY/bus address: the client refuses ambient targets and receives
    // only explicit argv. Manifest-derived private XDG/KDE/HOME only. No FHS
    // PATH/SHELL is supplied: the Rust client needs neither a shell nor a
    // host search path.
    vec![
        ("HOME".to_owned(), workdir.to_owned()),
        ("KDEHOME".to_owned(), workdir.to_owned()),
        ("XDG_CONFIG_HOME".to_owned(), format!("{workdir}/config")),
        ("XDG_DATA_HOME".to_owned(), format!("{workdir}/data")),
        ("XDG_CACHE_HOME".to_owned(), format!("{workdir}/cache")),
        ("XDG_STATE_HOME".to_owned(), format!("{workdir}/state")),
        ("LANG".to_owned(), "C.utf8".to_owned()),
        ("LC_ALL".to_owned(), "C.utf8".to_owned()),
        ("TERM".to_owned(), "xterm".to_owned()),
    ]
}

fn verify_client_bin_identity(config: &SupervisorConfig) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    use std::os::unix::fs::MetadataExt;
    let canon = std::fs::canonicalize(&config.client_bin)
        .map_err(|_| "error: target value is invalid (bad-value)".to_owned())?;
    if canon.to_string_lossy() != config.client_bin {
        return Err("error: target value is invalid (bad-value)".to_owned());
    }
    let meta = std::fs::metadata(&canon)
        .map_err(|_| "error: target value is invalid (bad-value)".to_owned())?;
    if !meta.is_file() {
        return Err("error: target value is invalid (bad-value)".to_owned());
    }
    if meta.dev() != config.client_dev || meta.ino() != config.client_ino {
        return Err("error: target value is invalid (bad-value)".to_owned());
    }
    let bytes = std::fs::read(&canon)
        .map_err(|_| "error: target value is invalid (bad-value)".to_owned())?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let digest = format!("{:x}", hasher.finalize());
    if !digest.eq_ignore_ascii_case(&config.client_sha256) {
        return Err("error: target value is invalid (bad-value)".to_owned());
    }
    Ok(())
}

fn main() {
    let argv: Vec<String> = std::env::args().collect();
    let (config, is_host) = match load_config(&argv) {
        Ok(c) => c,
        Err(text) => {
            eprintln!("{text}");
            std::process::exit(1);
        }
    };
    if let Err(text) = run(config, is_host) {
        eprintln!("{text}");
        std::process::exit(1);
    }
}

fn run(config: SupervisorConfig, is_host: bool) -> Result<(), String> {
    install_signal_handlers();
    close_inherited_fds();
    let sup_diag = supervisor_diag_path(&config.workdir);
    let ready_path = supervisor_ready_path(&config.workdir);
    let pidfile = supervisor_pidfile_path(&config.workdir);
    // Exclusive creation: fail closed when residue exists.
    let mut log = SupLog::create(std::path::Path::new(&sup_diag))
        .map_err(|_| "error: diagnostic unavailable (diag)".to_owned())?;
    log.push(&SupEvent::Connect);

    // Fail closed on pre-existing pidfile/ready residue: no pre-ready stale
    // pidfile is ever published or overwritten. Each file below is published
    // per-file via tmp+rename only after readiness; there is no multi-file
    // transaction.
    for residue in [&pidfile, &ready_path] {
        if std::fs::symlink_metadata(residue).is_ok() {
            log.push(&SupEvent::ProtocolError {
                kind: "protocol-error",
            });
            log.push(&SupEvent::Exit { reason: "error" });
            return Err("error: diagnostic unavailable (diag)".to_owned());
        }
    }

    // Bind the exact manifest-derived client identity before any spawn:
    // canonical path plus SHA-256 plus device/inode. Unbound direct
    // invocation (basename only) is rejected here.
    if verify_client_bin_identity(&config).is_err() {
        log.push(&SupEvent::ProtocolError {
            kind: "protocol-error",
        });
        log.push(&SupEvent::Exit { reason: "error" });
        return Err("error: target value is invalid (bad-value)".to_owned());
    }

    let mut children: HashMap<u8, Child> = HashMap::new();
    let mut pids: HashMap<u8, u32> = HashMap::new();
    for slot in 1..=3u8 {
        let diag = if is_host {
            host_client_diag_path(&config.workdir, slot).expect("slot")
        } else {
            client_diag_path(&config.workdir, slot).expect("slot")
        };
        let stderr_path = if is_host {
            host_client_stderr_path(&config.workdir, slot).expect("slot")
        } else {
            client_stderr_path(&config.workdir, slot).expect("slot")
        };
        // Exclusive stderr capture: fail closed on residue.
        let stderr_file = File::options()
            .write(true)
            .create_new(true)
            .open(&stderr_path)
            .map_err(|_| "error: diagnostic unavailable (diag)".to_owned())?;
        let argv = if is_host {
            host_client_argv(
                &config.client_bin,
                &config.runtime_dir,
                &config.socket_name,
                slot,
                &diag,
            )
        } else {
            client_argv(
                &config.client_bin,
                &config.runtime_dir,
                &config.socket_name,
                slot,
                &diag,
            )
        }
        .ok_or_else(|| "error: target value is invalid (bad-value)".to_owned())?;
        let mut cmd = Command::new(&argv[0]);
        cmd.args(&argv[1..]);
        cmd.env_clear();
        for (k, v) in private_child_env(&config.workdir) {
            cmd.env(k, v);
        }
        // Slot marker for later exact-PID enrollment diagnostics (not a
        // Wayland target; the client ignores unknown vars for target
        // validation which only checks the three ambient keys).
        cmd.env("PLASMA_AUTO_TILER_MANUAL_CLIENT_INDEX", slot.to_string());
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::null());
        cmd.stderr(stderr_file);
        let child = cmd.spawn().map_err(|_| {
            log.push(&SupEvent::ProtocolError {
                kind: "protocol-error",
            });
            log.push(&SupEvent::Exit { reason: "error" });
            "error: spawn failed (bad-value)".to_owned()
        })?;
        let pid = child.id();
        log.push(&SupEvent::Spawn { slot });
        children.insert(slot, child);
        pids.insert(slot, pid);
    }

    // No pre-ready pidfile: the pidfile is published per-file via tmp+rename
    // only after bounded readiness below, together with the ready marker.
    // Bounded first-map readiness.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(config.timeout_secs);
    let mut seen = [false; 3];
    let mut buf = vec![0u8; 65536];
    loop {
        if signal_requested() {
            terminate_all(&mut children);
            log.push(&SupEvent::Exit { reason: "signal" });
            return Ok(());
        }
        // Early slot failure: any child exit before ready is terminal.
        for (slot, child) in children.iter_mut() {
            match child.try_wait() {
                Ok(Some(_)) => {
                    terminate_all(&mut children);
                    log.push(&SupEvent::ProtocolError { kind: "early-exit" });
                    log.push(&SupEvent::Exit {
                        reason: "protocol-error",
                    });
                    let _ = std::fs::remove_file(&pidfile);
                    return Err("error: early slot failure (protocol-error)".to_owned());
                }
                Ok(None) => {}
                Err(_) => {
                    terminate_all(&mut children);
                    log.push(&SupEvent::ProtocolError {
                        kind: "protocol-error",
                    });
                    log.push(&SupEvent::Exit { reason: "error" });
                    let _ = std::fs::remove_file(&pidfile);
                    return Err("error: protocol failure (protocol-error)".to_owned());
                }
            }
            let _ = slot;
        }
        for slot in 1..=3u8 {
            if seen[(slot - 1) as usize] {
                continue;
            }
            let diag = if is_host {
                host_client_diag_path(&config.workdir, slot).expect("slot")
            } else {
                client_diag_path(&config.workdir, slot).expect("slot")
            };
            buf.clear();
            buf.resize(65536, 0);
            if let Ok(mut f) = File::open(&diag)
                && let Ok(n) = f.read(&mut buf)
            {
                buf.truncate(n);
                if let Ok(text) = std::str::from_utf8(&buf)
                    && diag_contains_first_map(text)
                {
                    seen[(slot - 1) as usize] = true;
                    log.push(&SupEvent::FirstMap { slot });
                }
            }
        }
        if seen[0] && seen[1] && seen[2] {
            break;
        }
        if std::time::Instant::now() >= deadline {
            terminate_all(&mut children);
            log.push(&SupEvent::ProtocolError { kind: "timeout" });
            log.push(&SupEvent::Exit {
                reason: "protocol-error",
            });
            let _ = std::fs::remove_file(&pidfile);
            return Err("error: readiness timeout (protocol-error)".to_owned());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    // Ready: publish pidfile then marker, each per-file via tmp+rename only
    // after readiness (no pre-ready stale pidfile, no multi-file transaction).
    // Fail closed if either target appeared concurrently.
    for residue in [&pidfile, &ready_path] {
        if std::fs::symlink_metadata(residue).is_ok() {
            terminate_all(&mut children);
            log.push(&SupEvent::ProtocolError { kind: "timeout" });
            log.push(&SupEvent::Exit {
                reason: "protocol-error",
            });
            return Err("error: diagnostic unavailable (diag)".to_owned());
        }
    }
    {
        let tmp = format!("{pidfile}.tmp.{}", std::process::id());
        let mut f = File::options()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|_| "error: diagnostic unavailable (diag)".to_owned())?;
        for slot in 1..=3u8 {
            let pid = pids.get(&slot).copied().unwrap_or(0);
            writeln!(f, "slot-{slot}={pid}").map_err(|_| {
                let _ = std::fs::remove_file(&tmp);
                "error: diagnostic unavailable (diag)".to_owned()
            })?;
        }
        drop(f);
        if std::fs::symlink_metadata(&pidfile).is_ok() {
            let _ = std::fs::remove_file(&tmp);
            terminate_all(&mut children);
            return Err("error: diagnostic unavailable (diag)".to_owned());
        }
        std::fs::rename(&tmp, &pidfile).map_err(|_| {
            let _ = std::fs::remove_file(&tmp);
            "error: diagnostic unavailable (diag)".to_owned()
        })?;
    }
    {
        let tmp = format!("{ready_path}.tmp.{}", std::process::id());
        let mut f = File::options()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|_| "error: diagnostic unavailable (diag)".to_owned())?;
        writeln!(f, "ready pid={}", std::process::id()).map_err(|_| {
            let _ = std::fs::remove_file(&tmp);
            "error: diagnostic unavailable (diag)".to_owned()
        })?;
        drop(f);
        if std::fs::symlink_metadata(&ready_path).is_ok() {
            let _ = std::fs::remove_file(&tmp);
            let _ = std::fs::remove_file(&pidfile);
            terminate_all(&mut children);
            return Err("error: diagnostic unavailable (diag)".to_owned());
        }
        std::fs::rename(&tmp, &ready_path).map_err(|_| {
            let _ = std::fs::remove_file(&tmp);
            "error: diagnostic unavailable (diag)".to_owned()
        })?;
    }
    log.push(&SupEvent::Ready);

    // Resident until signal. Poll children; a post-ready exit is logged but
    // the supervisor stays alive so cleanup can reconcile exact identities.
    loop {
        if signal_requested() {
            terminate_all(&mut children);
            log.push(&SupEvent::Exit { reason: "ready" });
            return Ok(());
        }
        for child in children.values_mut() {
            let _ = child.try_wait();
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
        // Keep stderr/stdout valid; ensure we don't spin on closed fds.
        let _ = std::io::stdout().flush();
    }
}

fn terminate_all(children: &mut HashMap<u8, Child>) {
    for child in children.values_mut() {
        // Exact children only; no broad kills.
        let _ = child.kill();
    }
    for child in children.values_mut() {
        let _ = child.wait();
    }
    // Drop ensures FDs close; keep raw fd use minimal.
    let _ = std::io::stderr().flush();
    let _ = AsRawFd::as_raw_fd(&std::io::stderr());
}
