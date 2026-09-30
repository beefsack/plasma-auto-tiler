use serde::{Deserialize, Serialize};

pub const LEDGER_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessIdentity {
    pub pid: u32,
    pub process_creation: String,
    pub user_sid: String,
    pub session_id: u32,
    pub exe_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowIdentity {
    pub hwnd: u64,
    pub process: ProcessIdentity,
    pub tag: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObservedWindow {
    pub identity: WindowIdentity,
    pub visible: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryLedger {
    pub v: u32,
    pub owner: ProcessIdentity,
    pub windows: Vec<WindowIdentity>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LedgerError {
    Malformed,
    UnsupportedVersion,
    DuplicateWindow,
    OwnerWindowMismatch,
}

impl std::fmt::Display for LedgerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Malformed => f.write_str("malformed"),
            Self::UnsupportedVersion => f.write_str("unsupported-version"),
            Self::DuplicateWindow => f.write_str("duplicate-window"),
            Self::OwnerWindowMismatch => f.write_str("owner-window-mismatch"),
        }
    }
}

impl std::error::Error for LedgerError {}

pub fn validate_ledger(ledger: &RecoveryLedger) -> Result<(), LedgerError> {
    if ledger.v != LEDGER_SCHEMA_VERSION {
        return Err(LedgerError::UnsupportedVersion);
    }
    for window in &ledger.windows {
        if window.process.user_sid != ledger.owner.user_sid
            || window.process.session_id != ledger.owner.session_id
        {
            return Err(LedgerError::OwnerWindowMismatch);
        }
    }
    let mut seen = std::collections::HashSet::new();
    for window in &ledger.windows {
        if !seen.insert(window.hwnd) {
            return Err(LedgerError::DuplicateWindow);
        }
    }
    Ok(())
}

pub fn parse_ledger(json: &str) -> Result<RecoveryLedger, LedgerError> {
    let ledger: RecoveryLedger = serde_json::from_str(json).map_err(|_| LedgerError::Malformed)?;
    validate_ledger(&ledger)?;
    Ok(ledger)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefuseReason {
    MissingObservation,
    AmbiguousObservation,
    ProcessMismatch,
    TagMismatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestoreDecision {
    Reveal { hwnd: u64 },
    SkipAlreadyVisible { hwnd: u64 },
    Refuse { reason: RefuseReason },
}

#[must_use]
pub fn restore_eligibility(
    record: &WindowIdentity,
    observations: &[ObservedWindow],
) -> RestoreDecision {
    let mut matched: Option<&ObservedWindow> = None;
    for observed in observations {
        if observed.identity.hwnd == record.hwnd {
            if matched.is_some() {
                return RestoreDecision::Refuse {
                    reason: RefuseReason::AmbiguousObservation,
                };
            }
            matched = Some(observed);
        }
    }
    let Some(observed) = matched else {
        return RestoreDecision::Refuse {
            reason: RefuseReason::MissingObservation,
        };
    };
    if observed.identity.process != record.process {
        return RestoreDecision::Refuse {
            reason: RefuseReason::ProcessMismatch,
        };
    }
    if observed.identity.tag != record.tag {
        return RestoreDecision::Refuse {
            reason: RefuseReason::TagMismatch,
        };
    }
    if observed.visible {
        RestoreDecision::SkipAlreadyVisible { hwnd: record.hwnd }
    } else {
        RestoreDecision::Reveal { hwnd: record.hwnd }
    }
}
