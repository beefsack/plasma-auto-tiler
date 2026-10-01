use std::path::PathBuf;
use tiler_windows::model::{
    LEDGER_SCHEMA_VERSION, ProcessIdentity, RecoveryLedger, WindowIdentity,
};
use tiler_windows::storage::{LedgerStore, StorageError};

static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

struct Temp {
    path: PathBuf,
}

impl Temp {
    fn new(name: &str) -> Self {
        let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "tiler-windows-{name}-{}-{t}-{n}",
            std::process::id()
        ));
        std::fs::create_dir(&path).expect("temp dir");
        Self { path }
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn owner() -> ProcessIdentity {
    ProcessIdentity {
        pid: 100,
        process_creation: "c-owner".to_owned(),
        user_sid: "S-owner".to_owned(),
        session_id: 1,
        exe_path: "C:\\tools\\t.exe".to_owned(),
    }
}

fn window(hwnd: u64, tag: &str) -> WindowIdentity {
    WindowIdentity {
        hwnd,
        process: ProcessIdentity {
            pid: 200,
            process_creation: "c-200".to_owned(),
            user_sid: "S-owner".to_owned(),
            session_id: 1,
            exe_path: "C:\\apps\\a.exe".to_owned(),
        },
        tag: tag.to_owned(),
    }
}

fn ledger() -> RecoveryLedger {
    RecoveryLedger {
        v: LEDGER_SCHEMA_VERSION,
        owner: owner(),
        windows: vec![window(0xABCD, "tag-1")],
        mouse_snap: None,
    }
}

#[test]
fn roundtrip() {
    let temp = Temp::new("roundtrip");
    let store = LedgerStore::open(&temp.path).expect("open");
    assert_eq!(store.committed().expect("read"), None);
    store.commit(&ledger()).expect("commit");
    assert_eq!(store.committed().expect("read"), Some(ledger()));
    let mut updated = ledger();
    updated.windows.push(window(0xABCE, "tag-2"));
    store.commit(&updated).expect("same-owner update");
    assert_eq!(store.committed().expect("read"), Some(updated));
}

#[test]
fn different_owner_refusal_preserves_bytes() {
    let temp = Temp::new("owner");
    let store = LedgerStore::open(&temp.path).expect("open");
    store.commit(&ledger()).expect("commit");
    let before = std::fs::read(temp.path.join("ledger.json")).expect("bytes");
    let mut other = ledger();
    other.owner.pid = 101;
    assert!(matches!(
        store.commit(&other).expect_err("owner"),
        StorageError::DifferentOwner
    ));
    assert_eq!(
        std::fs::read(temp.path.join("ledger.json")).expect("bytes"),
        before
    );
    assert_eq!(store.committed().expect("read"), Some(ledger()));
}

#[test]
fn corrupt_ledger_refused() {
    let temp = Temp::new("corrupt");
    {
        let store = LedgerStore::open(&temp.path).expect("open");
        store.commit(&ledger()).expect("commit");
    }
    std::fs::write(temp.path.join("ledger.json"), b"{not json").expect("corrupt");
    let store = LedgerStore::open(&temp.path).expect("open");
    assert!(matches!(
        store.committed().expect_err("read"),
        StorageError::Ledger(_)
    ));
    assert!(matches!(
        store.commit(&ledger()).expect_err("write"),
        StorageError::Ledger(_)
    ));
    assert_eq!(
        std::fs::read(temp.path.join("ledger.json")).expect("bytes"),
        b"{not json"
    );
}

#[test]
fn lock_contention() {
    let temp = Temp::new("lock");
    let first = LedgerStore::open(&temp.path).expect("first");
    let err = match LedgerStore::open(&temp.path) {
        Ok(_) => panic!("second open must fail"),
        Err(e) => e,
    };
    assert!(matches!(err, StorageError::LockContended));
    drop(first);
    LedgerStore::open(&temp.path).expect("reopen");
}
