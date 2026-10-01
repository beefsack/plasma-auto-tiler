use serde::{Deserialize, Serialize};

pub const LEDGER_SCHEMA_VERSION: u32 = 2;

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

/// Session-only mouse-Snap (`SPI_SETWINARRANGING`) preimage persisted in the
/// owner ledger before the first setter (write-before-effect). `original` is
/// the exact live boolean captured with `SPI_GETWINARRANGING`; `owned` is an
/// intent-first recovery claim persisted before the setter runs, not only a
/// verified effect. A crash past the intent commit still recovers: live
/// `TRUE` then reads as drift-preserve, live `FALSE` as ours to restore, and
/// a failed read retains the claim for a later independent restore. A
/// readback mismatch later downgrades the claim to `owned: false`; an
/// unverified setter error retains the intent claim. When `original` was
/// already false no mutation is owned and teardown must not write.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MouseSnapPreimage {
    pub original: bool,
    pub owned: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryLedger {
    pub v: u32,
    pub owner: ProcessIdentity,
    pub windows: Vec<WindowIdentity>,
    /// Optional so ledgers written before mouse-Snap prevention still parse
    /// (missing means no Snap work). Writes use schema v2; an older v1-only
    /// reader refuses v2 outright, so it can never silently ignore the field,
    /// restore windows, and delete the ledger while leaving the setting off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mouse_snap: Option<MouseSnapPreimage>,
}

/// True when the ledger carries an intent-first ownership claim over an
/// originally-true setting: the only state that authorizes restoration. This
/// includes unverified setter attempts retained for later independent
/// restore; the teardown decision still requires the live value to equal our
/// `FALSE` effect before any write.
#[must_use]
pub const fn mouse_snap_owned(preimage: Option<MouseSnapPreimage>) -> bool {
    match preimage {
        Some(record) => record.original && record.owned,
        None => false,
    }
}

/// Closed teardown vocabulary for one Snap preimage against a fresh live
/// read. `live` is `None` when the `SPI_GETWINARRANGING` read itself failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseSnapRestoreDecision {
    /// Live is still our verified `FALSE`: restore the exact original `TRUE`.
    Restore,
    /// Live drifted to `TRUE` (foreign change): preserve it, never overwrite
    /// to force restoration.
    PreserveDrift,
    /// No owned mutation (missing preimage, originally false, or an
    /// unverified attempt): nothing to write.
    NoOwnedMutation,
    /// Live read failed: retain the ledger for a later independent restore,
    /// never clean recovery evidence while uncertain.
    UncertainRetain,
}

/// Decide the teardown of one Snap preimage. Restoration requires the strict
/// conjunction of an owned mutation and a live value still equal to our
/// `FALSE` effect; every other combination preserves or retains.
#[must_use]
pub const fn mouse_snap_restore_decision(
    preimage: Option<MouseSnapPreimage>,
    live: Option<bool>,
) -> MouseSnapRestoreDecision {
    if !mouse_snap_owned(preimage) {
        return MouseSnapRestoreDecision::NoOwnedMutation;
    }
    match live {
        Some(false) => MouseSnapRestoreDecision::Restore,
        Some(true) => MouseSnapRestoreDecision::PreserveDrift,
        None => MouseSnapRestoreDecision::UncertainRetain,
    }
}

/// Closed setup vocabulary for one exact `SPI_GETWINARRANGING` preimage read.
/// `live` is `None` when the read itself failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseSnapSetupDecision {
    /// Originally true: persist the preimage, then set `FALSE` with readback.
    Disable,
    /// Originally false: record the preimage, claim no mutation, write nothing.
    AlreadyOff,
    /// Preimage read failed: write nothing, degrade tiling-only, retry at a
    /// later meaningful opportunity.
    UnknownRetain,
}

/// Decide the setup of one Snap preimage read. `None` (failed read) never
/// authorizes a setter.
#[must_use]
pub const fn mouse_snap_setup_decision(live: Option<bool>) -> MouseSnapSetupDecision {
    match live {
        Some(true) => MouseSnapSetupDecision::Disable,
        Some(false) => MouseSnapSetupDecision::AlreadyOff,
        None => MouseSnapSetupDecision::UnknownRetain,
    }
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
    match ledger.v {
        // v1 predates Snap work: accept only with no Snap claim. A v1 tag
        // carrying a Snap field is version confusion and must not parse as
        // owner evidence.
        1 => {
            if ledger.mouse_snap.is_some() {
                return Err(LedgerError::UnsupportedVersion);
            }
        }
        // Current writes. v2 may carry or omit the Snap preimage (omitted
        // means no Snap work yet).
        2 => {}
        _ => return Err(LedgerError::UnsupportedVersion),
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
