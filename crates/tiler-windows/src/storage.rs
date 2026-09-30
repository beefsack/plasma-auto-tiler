use crate::model::{LedgerError, RecoveryLedger, parse_ledger, validate_ledger};
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const LEDGER_FILE_NAME: &str = "ledger.json";
pub const LOCK_FILE_NAME: &str = "ledger.lock";
pub const PENDING_FILE_NAME: &str = "ledger.json.pending";

#[derive(Debug)]
pub enum StorageError {
    Io(std::io::Error),
    Ledger(LedgerError),
    DifferentOwner,
    LockContended,
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(_) => f.write_str("io-error"),
            Self::Ledger(inner) => write!(f, "{inner}"),
            Self::DifferentOwner => f.write_str("different-owner"),
            Self::LockContended => f.write_str("lock-contended"),
        }
    }
}

impl std::error::Error for StorageError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(inner) => Some(inner),
            Self::Ledger(inner) => Some(inner),
            _ => None,
        }
    }
}

impl From<std::io::Error> for StorageError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

#[cfg(windows)]
fn atomic_replace(from: &Path, to: &Path) -> Result<(), StorageError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let from_w: Vec<u16> = from.as_os_str().encode_wide().chain([0]).collect();
    let to_w: Vec<u16> = to.as_os_str().encode_wide().chain([0]).collect();
    let ok = unsafe {
        MoveFileExW(
            from_w.as_ptr(),
            to_w.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(StorageError::Io(std::io::Error::last_os_error()))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn atomic_replace(from: &Path, to: &Path) -> Result<(), StorageError> {
    std::fs::rename(from, to).map_err(StorageError::Io)
}

pub struct LedgerStore {
    dir: PathBuf,
    _lock: File,
}

impl LedgerStore {
    pub fn open(dir: &Path) -> Result<Self, StorageError> {
        std::fs::create_dir_all(dir)?;
        let lock = File::create(dir.join(LOCK_FILE_NAME))?;
        lock.try_lock().map_err(|e| match e {
            std::fs::TryLockError::WouldBlock => StorageError::LockContended,
            std::fs::TryLockError::Error(io) => StorageError::Io(io),
        })?;
        Ok(Self {
            dir: dir.to_path_buf(),
            _lock: lock,
        })
    }

    pub fn committed(&self) -> Result<Option<RecoveryLedger>, StorageError> {
        let path = self.dir.join(LEDGER_FILE_NAME);
        match std::fs::read(&path) {
            Ok(bytes) => {
                let text = std::str::from_utf8(&bytes)
                    .map_err(|_| StorageError::Ledger(LedgerError::Malformed))?;
                Ok(Some(parse_ledger(text).map_err(StorageError::Ledger)?))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(StorageError::Io(e)),
        }
    }

    pub fn commit(&self, ledger: &RecoveryLedger) -> Result<(), StorageError> {
        validate_ledger(ledger).map_err(StorageError::Ledger)?;
        let committed = self.dir.join(LEDGER_FILE_NAME);
        if self
            .committed()?
            .is_some_and(|existing| existing.owner != ledger.owner)
        {
            return Err(StorageError::DifferentOwner);
        }
        let bytes = serde_json::to_vec_pretty(ledger)
            .map_err(|_| StorageError::Ledger(LedgerError::Malformed))?;
        let pending = self.dir.join(PENDING_FILE_NAME);
        let mut file = File::create(&pending)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        atomic_replace(&pending, &committed)?;
        Ok(())
    }
}
