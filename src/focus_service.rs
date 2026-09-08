//! Bounded static focus transaction service (product-shaped, static only).
//!
//! Narrow JSON request/action protocol over the portable [`crate::session`]
//! focus plan and [`crate::reconcile`] acknowledgement model. Rust owns
//! normalized domains, focus intent, capabilities, preconditions, revision
//! binding, and reconciliation; KWin owns observation, native mapping,
//! revalidation, native focus writes, and post-observation. No native
//! execution, persistence, or transport here: this module is pure
//! JSON-string-in / JSON-string-out over an owned [`Session`].
//!
//! Actions (`action` field, `v == 1`):
//! - `request`: propose directional focus for one exact opaque
//!   `(domain, focused window, direction)` against a complete normalized
//!   observation. Replies `planned` with the bound dispatch/operation, `noop`
//!   for exhausted edges, or `rejected`/`diverged` fail-closed.
//! - `acknowledge`: record an explicit adapter acknowledgement for the pending
//!   plan. Replies `acknowledged` or fail-closed divergence.
//! - `verify`: commit after acknowledgement given a fresh verified
//!   post-observation. Replies `committed` or fail-closed divergence.
//! - `note-loss`: explicit adapter-loss signal. Always diverges terminally.
//!
//! Wire rejects are fixed redacted strings; input is never echoed except a
//! valid correlation id echo. Correlations are single-use (bounded seen set);
//! owner/generation/revision mismatches diverge through the session.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::contract::{
    AckOutcome, AdapterAck, FocusCapabilities, FocusPostObservation, Observation,
};
use crate::directional::{Direction, NodeId, OutputId, WindowId, WorkspaceId};
use crate::geometry::Rect;
use crate::ids::{CorrelationId, GenerationId, OwnerId};
use crate::session::{
    DomainKey, ExceptionFlags, ObservedWindow, OutputDomain, ProposeError, Session, SessionCommand,
    SessionObservation,
};

/// Focus transaction contract version (JSON string v1).
pub const FOCUS_CONTRACT_VERSION: u32 = 1;
/// Bounded request cap.
pub const FOCUS_MAX_REQUEST_BYTES: usize = 64 * 1024;
/// Bounded reply cap.
pub const FOCUS_MAX_REPLY_BYTES: usize = 64 * 1024;
/// Opaque id bound.
pub const FOCUS_MAX_ID_LEN: usize = 128;
/// Observed window bound.
pub const FOCUS_MAX_WINDOWS: usize = 64;
/// Route vector bound.
pub const FOCUS_MAX_ROUTE: usize = 64;
/// Seen-correlation bound.
pub const FOCUS_MAX_SEEN: usize = 2048;
/// Revision bound (inclusive, shared with contract).
pub const FOCUS_MAX_REVISION: u64 = 1_000_000;

const MSG_OVERSIZED: &str = "request exceeds size bound";
const MSG_MALFORMED: &str = "request is malformed";
const MSG_UNKNOWN_FIELD: &str = "request contains an unknown field";
const MSG_UNKNOWN_VALUE: &str = "request contains an unknown value";
const MSG_VERSION: &str = "unsupported contract version";
const MSG_CORRELATION: &str = "correlation id is invalid";
const MSG_OWNER: &str = "owner is invalid";
const MSG_GENERATION: &str = "generation is invalid";
const MSG_REVISION: &str = "revision is invalid";
const MSG_OPAQUE_ID: &str = "opaque id is invalid";
const MSG_DIRECTION: &str = "direction is invalid";
const MSG_OBSERVATION: &str = "observation does not cover the known window set";
const MSG_CAPABILITY: &str = "operation needs an undeclared capability";
const MSG_SESSION_FULL: &str = "focus session correlation bound was reached";

/// Deterministic bounded observation fingerprint (FNV-1a 32-bit over a
/// canonical `output\x1fworkspace\x1ffocused\x1fids...` string, sorted ids).
/// Mirrors the KWin adapter `focusFingerprint` exactly (ASCII opaque ids, so
/// UTF-8 equals char codes). Transport-neutral `u64` carrying the 32-bit
/// value; never interpreted beyond equality binding.
#[must_use]
pub fn focus_fingerprint(
    domain_output: &str,
    domain_workspace: &str,
    focused: &str,
    sorted_ids: &[String],
) -> u64 {
    const OFFSET: u32 = 2_166_136_261;
    const PRIME: u32 = 16_777_619;
    let mut hash = OFFSET;
    fn feed(hash: &mut u32, text: &str) {
        for byte in text.bytes() {
            *hash ^= u32::from(byte);
            *hash = hash.wrapping_mul(PRIME);
        }
    }
    feed(&mut hash, domain_output);
    hash ^= 0x1f;
    hash = hash.wrapping_mul(PRIME);
    feed(&mut hash, domain_workspace);
    hash ^= 0x1f;
    hash = hash.wrapping_mul(PRIME);
    feed(&mut hash, focused);
    for id in sorted_ids {
        hash ^= 0x1f;
        hash = hash.wrapping_mul(PRIME);
        feed(&mut hash, id);
    }
    u64::from(hash)
}

/// Exact complete precondition set, in dispatch order. Adapter replies and
/// verify vectors must equal exactly this (no duplicates, no subsets).
const EXPECTED_PRECONDITIONS: &[&str] = &[
    "focused-leaf-occupied-by-focused-window",
    "target-leaf-occupied",
    "focus-targets-same-domain",
    "adapter-must-verify-postconditions",
];

/// Fixed deterministic initial domain geometry for Rust-owned seeding
/// (no JS topology, no native fields). Single logical domain only.
const SEED_BOUNDS: Rect = Rect {
    x: 0,
    y: 0,
    w: 1920,
    h: 1080,
};
const SEED_PLACEMENT: Rect = Rect {
    x: 0,
    y: 0,
    w: 120,
    h: 80,
};

fn is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= FOCUS_MAX_ID_LEN
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

fn valid_correlation_echo(value: &serde_json::Value) -> String {
    value
        .get("correlation_id")
        .and_then(serde_json::Value::as_str)
        .filter(|id| CorrelationId::parse(id).is_some())
        .unwrap_or_default()
        .to_owned()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct DomainDto {
    output: String,
    workspace: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ObservedDto {
    window: String,
    output: String,
    workspace: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct CapabilitiesDto {
    directional_focus: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestDto {
    v: u32,
    action: String,
    correlation_id: String,
    owner: String,
    generation: String,
    revision: u64,
    fingerprint: u64,
    domain: DomainDto,
    focused_window: String,
    direction: String,
    windows: Vec<ObservedDto>,
    capabilities: CapabilitiesDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct AckDto {
    v: u32,
    action: String,
    correlation_id: String,
    owner: String,
    generation: String,
    base_revision: u64,
    outcome: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct OperationDto {
    domain_output: String,
    domain_workspace: String,
    from_leaf: String,
    to_leaf: String,
    from_window: String,
    to_window: String,
    direction: String,
    route: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct VerifyDto {
    v: u32,
    action: String,
    correlation_id: String,
    owner: String,
    generation: String,
    revision: u64,
    fingerprint: u64,
    verified: bool,
    verified_preconditions: Vec<String>,
    verified_operation: OperationDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct LossDto {
    v: u32,
    action: String,
}

#[derive(Debug, Clone, Serialize)]
struct OperationReply {
    domain_output: String,
    domain_workspace: String,
    from_leaf: String,
    to_leaf: String,
    from_window: String,
    to_window: String,
    direction: String,
    route: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct FocusReply {
    v: u32,
    correlation_id: String,
    outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    base_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    capability: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preconditions: Option<Vec<&'static str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation: Option<OperationReply>,
    #[serde(skip_serializing_if = "Option::is_none")]
    to_window: Option<String>,
}

fn serialize_bounded(reply: &FocusReply) -> String {
    match serde_json::to_string(reply) {
        Ok(text) if text.len() <= FOCUS_MAX_REPLY_BYTES => text,
        _ => "{\"v\":1,\"correlation_id\":\"\",\"outcome\":\"rejected\",\"kind\":\"snapshot-invalid\",\"message\":\"snapshot or intent is malformed\"}"
            .to_owned(),
    }
}

fn rejected(correlation_id: String, kind: &'static str, message: &'static str) -> String {
    serialize_bounded(&FocusReply {
        v: FOCUS_CONTRACT_VERSION,
        correlation_id,
        outcome: "rejected",
        kind: Some(kind),
        message: Some(message),
        base_revision: None,
        revision: None,
        capability: None,
        preconditions: None,
        operation: None,
        to_window: None,
    })
}

fn diverged(correlation_id: String, kind: &'static str, message: &'static str) -> String {
    serialize_bounded(&FocusReply {
        v: FOCUS_CONTRACT_VERSION,
        correlation_id,
        outcome: "diverged",
        kind: Some(kind),
        message: Some(message),
        base_revision: None,
        revision: None,
        capability: None,
        preconditions: None,
        operation: None,
        to_window: None,
    })
}

fn classify_parse_error(error: &serde_json::Error) -> (&'static str, &'static str) {
    let text = error.to_string();
    if text.contains("unknown field") {
        ("unknown-field", MSG_UNKNOWN_FIELD)
    } else if text.contains("unknown variant") {
        ("unknown-value", MSG_UNKNOWN_VALUE)
    } else {
        ("request-malformed", MSG_MALFORMED)
    }
}

fn parse_direction(value: &str) -> Option<Direction> {
    match value {
        "left" => Some(Direction::Left),
        "right" => Some(Direction::Right),
        "up" => Some(Direction::Up),
        "down" => Some(Direction::Down),
        _ => None,
    }
}

fn precondition_token(value: &str) -> Option<crate::contract::FocusPrecondition> {
    use crate::contract::FocusPrecondition as P;
    match value {
        "focused-leaf-occupied-by-focused-window" => Some(P::FocusedLeafOccupiedByFocusedWindow),
        "target-leaf-occupied" => Some(P::TargetLeafOccupied),
        "focus-targets-same-domain" => Some(P::FocusTargetsSameDomain),
        "adapter-must-verify-postconditions" => Some(P::AdapterMustVerifyPostconditions),
        _ => None,
    }
}

fn precondition_str(value: &crate::contract::FocusPrecondition) -> &'static str {
    use crate::contract::FocusPrecondition as P;
    match value {
        P::FocusedLeafOccupiedByFocusedWindow => "focused-leaf-occupied-by-focused-window",
        P::TargetLeafOccupied => "target-leaf-occupied",
        P::FocusTargetsSameDomain => "focus-targets-same-domain",
        P::AdapterMustVerifyPostconditions => "adapter-must-verify-postconditions",
    }
}

/// Bounded static focus transaction service over an owned [`Session`].
///
/// Owns/creates the single portable [`Session`] from the first strict
/// normalized `request` (Rust-only deterministic initial domain + admission
/// order; no JS topology, no native fields). Changed membership/domain after
/// seeding is rejected without divergence. Single session, single pending via
/// the session/reconciler. Single-use correlations (bounded seen set);
/// the session itself enforces owner/generation/revision/pending binding and
/// terminal divergence. Seen exhaustion diverges fail-closed.
#[derive(Debug)]
pub struct FocusService {
    session: Option<Session>,
    seeded_domain: Option<DomainKey>,
    seeded_members: Vec<String>,
    seen: HashSet<String>,
}

impl Default for FocusService {
    fn default() -> Self {
        Self::new()
    }
}

impl FocusService {
    /// Fresh unseeded service. The first strict `request` seeds the owned
    /// session; until then there is no pending and revision mirrors 0.
    #[must_use]
    pub fn new() -> Self {
        Self {
            session: None,
            seeded_domain: None,
            seeded_members: Vec::new(),
            seen: HashSet::new(),
        }
    }

    /// Wrap an already-seeded session (domains/topology/focus owned by Rust).
    /// Used by portable tests; production D-Bus ownership uses [`Self::new`].
    #[must_use]
    pub fn with_session(session: Session) -> Self {
        let members = {
            let mut ids: Vec<String> = session
                .snapshot()
                .windows
                .iter()
                .map(|l| l.window.0.clone())
                .collect();
            ids.extend(
                session
                    .exception_observed()
                    .iter()
                    .map(|w| w.window.0.clone()),
            );
            ids.sort();
            ids.dedup();
            ids
        };
        let domain = session.focus().0;
        Self {
            session: Some(session),
            seeded_domain: domain,
            seeded_members: members,
            seen: HashSet::new(),
        }
    }

    /// Borrow the owned session. Panics when unseeded; use
    /// [`Self::session_opt`] for the unseeded case.
    #[must_use]
    pub fn session(&self) -> &Session {
        self.session.as_ref().expect("focus session is seeded")
    }

    /// Borrow the owned session, if seeded.
    #[must_use]
    pub fn session_opt(&self) -> Option<&Session> {
        self.session.as_ref()
    }

    /// Whether the owned session is seeded.
    #[must_use]
    pub fn is_seeded(&self) -> bool {
        self.session.is_some()
    }

    /// Accepted revision mirror (0 while unseeded).
    #[must_use]
    pub fn accepted_revision(&self) -> u64 {
        self.session
            .as_ref()
            .map_or(0, |session| session.accepted_revision())
    }

    /// Whether the session diverged terminally.
    #[must_use]
    pub fn is_diverged(&self) -> bool {
        self.session
            .as_ref()
            .is_some_and(|session| session.divergence().is_some())
    }

    /// Strict JSON-only focus transaction. Always returns a bounded reply.
    pub fn evaluate_json(&mut self, request_json: &str) -> String {
        if request_json.len() > FOCUS_MAX_REQUEST_BYTES {
            return rejected(String::new(), "oversized", MSG_OVERSIZED);
        }
        let raw: serde_json::Value = match serde_json::from_str(request_json) {
            Ok(raw) => raw,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(String::new(), kind, message);
            }
        };
        let action = raw
            .get("action")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        match action {
            "request" => self.evaluate_request(&raw),
            "acknowledge" => self.evaluate_ack(&raw),
            "verify" => self.evaluate_verify(&raw),
            "note-loss" => self.evaluate_loss(&raw),
            _ => {
                let (kind, message) = if action.is_empty() {
                    ("request-malformed", MSG_MALFORMED)
                } else {
                    ("unknown-value", MSG_UNKNOWN_VALUE)
                };
                rejected(valid_correlation_echo(&raw), kind, message)
            }
        }
    }

    fn claim_correlation(&mut self, correlation_id: &str) -> bool {
        if self.seen.contains(correlation_id) {
            return false;
        }
        if self.seen.len() >= FOCUS_MAX_SEEN {
            return false;
        }
        self.seen.insert(correlation_id.to_owned());
        true
    }

    /// Fail-closed terminal divergence for seen-set exhaustion. Records
    /// adapter loss on the owned session when seeded so [`Self::is_diverged`]
    /// stays terminal, then reports a redacted `session-full` divergence.
    fn diverged_exhausted(&mut self, correlation_id: String) -> String {
        if let Some(session) = self.session.as_mut() {
            let _ = session.note_adapter_loss();
        }
        diverged(correlation_id, "session-full", MSG_SESSION_FULL)
    }

    fn sorted_ids(windows: &[ObservedDto]) -> Vec<String> {
        let mut ids: Vec<String> = windows.iter().map(|w| w.window.clone()).collect();
        ids.sort();
        ids
    }

    fn expected_request_fingerprint(
        domain_output: &str,
        domain_workspace: &str,
        focused: &str,
        windows: &[ObservedDto],
    ) -> u64 {
        focus_fingerprint(
            domain_output,
            domain_workspace,
            focused,
            &Self::sorted_ids(windows),
        )
    }

    /// Deterministic Rust-only seeding from the first strict normalized
    /// request. Single fixed-geometry domain; admits sorted windows with the
    /// focused window last so session focus equals the request focus. Uses
    /// existing [`Session`] lifecycle admit/acknowledge/verify APIs only.
    /// First request revision must exactly equal the normalized observed
    /// membership size (`windows.len()`, hence the post-seed base N); any
    /// other explicit revision is rejected without seeding. Changed
    /// domain/membership afterwards is rejected by the caller, never reseeded.
    fn ensure_seeded(
        &mut self,
        owner: &OwnerId,
        generation: &GenerationId,
        request: &RequestDto,
    ) -> Result<(), String> {
        let revision = request.revision;
        let fingerprint = request.fingerprint;
        let domain_output = request.domain.output.as_str();
        let domain_workspace = request.domain.workspace.as_str();
        let focused = request.focused_window.as_str();
        let windows = request.windows.as_slice();
        if self.session.is_some() {
            return Ok(());
        }
        if revision != windows.len() as u64 {
            return Err("initial focus request must carry revision N".to_owned());
        }
        if windows.is_empty() || windows.len() > FOCUS_MAX_WINDOWS {
            return Err(MSG_OBSERVATION.to_owned());
        }
        for entry in windows {
            if entry.output != domain_output || entry.workspace != domain_workspace {
                return Err(MSG_OBSERVATION.to_owned());
            }
        }
        if !windows.iter().any(|w| w.window == focused) {
            return Err(MSG_OBSERVATION.to_owned());
        }
        let expected =
            Self::expected_request_fingerprint(domain_output, domain_workspace, focused, windows);
        if fingerprint != expected {
            return Err(MSG_OBSERVATION.to_owned());
        }
        let domain = OutputDomain {
            id: OutputId(domain_output.to_owned()),
            workspace: WorkspaceId(domain_workspace.to_owned()),
            bounds: SEED_BOUNDS,
            gap: 0,
            adjacent: std::collections::BTreeMap::new(),
        };
        let mut session = Session::new(
            owner.clone(),
            generation.clone(),
            0,
            fingerprint,
            vec![domain],
        )
        .map_err(|_| MSG_OBSERVATION.to_owned())?;
        // Deterministic admission order: sorted ids with focused last.
        let mut ordered: Vec<String> = Self::sorted_ids(windows);
        ordered.retain(|id| id != focused);
        ordered.push(focused.to_owned());
        for (index, window) in ordered.iter().enumerate() {
            Self::admit_seed_window(
                &mut session,
                owner,
                generation,
                window,
                domain_output,
                domain_workspace,
                index,
            )?;
        }
        // Post-seed focus must equal the request focus; otherwise the
        // deterministic order did not bind (fail closed, no session).
        let (focus_domain, focus_leaf) = session.focus();
        let focus_ok = focus_domain
            .as_ref()
            .is_some_and(|d| d.output.0 == domain_output && d.workspace.0 == domain_workspace)
            && focus_leaf.is_some()
            && session
                .snapshot()
                .windows
                .iter()
                .find(|l| Some(&l.leaf) == focus_leaf.as_ref())
                .is_some_and(|l| l.window.0 == focused);
        if !focus_ok {
            return Err(MSG_OBSERVATION.to_owned());
        }
        let mut members = Self::sorted_ids(windows);
        members.sort();
        self.seeded_domain = Some(DomainKey {
            output: OutputId(domain_output.to_owned()),
            workspace: WorkspaceId(domain_workspace.to_owned()),
        });
        self.seeded_members = members;
        self.session = Some(session);
        Ok(())
    }

    fn admit_seed_window(
        session: &mut Session,
        owner: &OwnerId,
        generation: &GenerationId,
        window: &str,
        output: &str,
        workspace: &str,
        index: usize,
    ) -> Result<(), String> {
        use crate::contract::LifecycleCapabilities;
        let base = session.accepted_revision();
        let mut observed: Vec<ObservedWindow> = session
            .snapshot()
            .windows
            .iter()
            .map(|l| ObservedWindow {
                window: l.window.clone(),
                output: l.output.clone(),
                workspace: l.workspace.clone(),
                floating: false,
                fullscreen: false,
                maximized: false,
                sticky: false,
            })
            .collect();
        observed.extend(session.exception_observed());
        observed.push(ObservedWindow {
            window: WindowId(window.to_owned()),
            output: OutputId(output.to_owned()),
            workspace: WorkspaceId(workspace.to_owned()),
            floating: false,
            fullscreen: false,
            maximized: false,
            sticky: false,
        });
        observed.sort_by(|a, b| a.window.0.cmp(&b.window.0));
        let correlation_text = format!("seed-{index:04}");
        let correlation =
            CorrelationId::parse(&correlation_text).ok_or_else(|| MSG_CORRELATION.to_owned())?;
        let observation = SessionObservation {
            observation: Observation::new(
                owner.clone(),
                generation.clone(),
                base,
                session.accepted_revision(),
            ),
            windows: observed,
        };
        let command = SessionCommand::Admit {
            window: WindowId(window.to_owned()),
            output: OutputId(output.to_owned()),
            workspace: WorkspaceId(workspace.to_owned()),
            exceptions: ExceptionFlags::none(),
            exception_behavior: None,
            placement_bounds: SEED_PLACEMENT,
        };
        let plan = session
            .propose(
                &command,
                &observation,
                &correlation,
                &LifecycleCapabilities::full(),
            )
            .map_err(|_| MSG_OBSERVATION.to_owned())?;
        let ack = AdapterAck::new(
            correlation.clone(),
            owner.clone(),
            generation.clone(),
            base,
            AckOutcome::Accepted,
        );
        session
            .acknowledge(&ack)
            .map_err(|_| MSG_OBSERVATION.to_owned())?;
        session
            .verify_lifecycle(&crate::contract::LifecyclePostObservation::new(
                Observation::new(owner.clone(), generation.clone(), base, base),
                correlation,
                true,
                plan.dispatch.preconditions.clone(),
                plan.dispatch.operation.clone(),
            ))
            .map_err(|_| MSG_OBSERVATION.to_owned())?;
        Ok(())
    }

    fn evaluate_request(&mut self, raw: &serde_json::Value) -> String {
        let request: RequestDto = match serde_json::from_value(raw.clone()) {
            Ok(request) => request,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(raw), kind, message);
            }
        };
        if request.v != FOCUS_CONTRACT_VERSION || request.action != "request" {
            let (kind, message) = if request.v != FOCUS_CONTRACT_VERSION {
                ("unsupported-version", MSG_VERSION)
            } else {
                ("unknown-value", MSG_UNKNOWN_VALUE)
            };
            return rejected(request.correlation_id.clone(), kind, message);
        }
        if CorrelationId::parse(&request.correlation_id).is_none() {
            return rejected(String::new(), "correlation-invalid", MSG_CORRELATION);
        }
        if OwnerId::parse(&request.owner).is_none() {
            return rejected(request.correlation_id.clone(), "owner-invalid", MSG_OWNER);
        }
        if GenerationId::parse(&request.generation).is_none() {
            return rejected(
                request.correlation_id.clone(),
                "generation-invalid",
                MSG_GENERATION,
            );
        }
        if request.revision > FOCUS_MAX_REVISION {
            return rejected(
                request.correlation_id.clone(),
                "revision-invalid",
                MSG_REVISION,
            );
        }
        if !is_opaque_id(&request.domain.output)
            || !is_opaque_id(&request.domain.workspace)
            || !is_opaque_id(&request.focused_window)
        {
            return rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OPAQUE_ID,
            );
        }
        let Some(direction) = parse_direction(&request.direction) else {
            return rejected(
                request.correlation_id.clone(),
                "direction-invalid",
                MSG_DIRECTION,
            );
        };
        if request.windows.is_empty() || request.windows.len() > FOCUS_MAX_WINDOWS {
            return rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OBSERVATION,
            );
        }
        {
            let mut seen = HashSet::new();
            for entry in &request.windows {
                if !is_opaque_id(&entry.window)
                    || !is_opaque_id(&entry.output)
                    || !is_opaque_id(&entry.workspace)
                {
                    return rejected(
                        request.correlation_id.clone(),
                        "snapshot-invalid",
                        MSG_OPAQUE_ID,
                    );
                }
                if !seen.insert(entry.window.clone()) {
                    return rejected(
                        request.correlation_id.clone(),
                        "snapshot-invalid",
                        MSG_OPAQUE_ID,
                    );
                }
            }
        }
        if !request.capabilities.directional_focus {
            return rejected(
                request.correlation_id.clone(),
                "unsupported-capability",
                MSG_CAPABILITY,
            );
        }
        // Exact deterministic fingerprint binding from the observation
        // (sorted ids + focused + domain). Literal or stale fingerprints
        // are rejected before any session work.
        let expected_fingerprint = Self::expected_request_fingerprint(
            &request.domain.output,
            &request.domain.workspace,
            &request.focused_window,
            &request.windows,
        );
        if request.fingerprint != expected_fingerprint {
            return rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OBSERVATION,
            );
        }
        // All observed entries must live in the request domain (single-domain
        // focus; no cross-domain JS topology is trusted).
        for entry in &request.windows {
            if entry.output != request.domain.output || entry.workspace != request.domain.workspace
            {
                return rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    MSG_OBSERVATION,
                );
            }
        }
        if !request
            .windows
            .iter()
            .any(|w| w.window == request.focused_window)
        {
            return rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OBSERVATION,
            );
        }
        if !self.claim_correlation(&request.correlation_id) {
            if self.seen.contains(&request.correlation_id) {
                return diverged(
                    request.correlation_id.clone(),
                    "correlation-mismatch",
                    "correlation does not match the pending plan",
                );
            }
            return self.diverged_exhausted(request.correlation_id.clone());
        }
        let owner = OwnerId::parse(&request.owner).expect("validated");
        let generation = GenerationId::parse(&request.generation).expect("validated");
        let correlation = CorrelationId::parse(&request.correlation_id).expect("validated");
        // Own/create the portable session from the first strict request.
        // First revision must exactly equal the normalized membership size N
        // (hence the post-seed base N), so the first propose binds the caller
        // revision exactly like all later requests; stale revisions diverge
        // via the reconciler.
        let was_unseeded = self.session.is_none();
        if was_unseeded && let Err(reason) = self.ensure_seeded(&owner, &generation, &request) {
            let _ = reason;
            return rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OBSERVATION,
            );
        }
        // Reject changed membership/domain after seeding without divergence.
        if let Some(seeded) = self.seeded_domain.clone()
            && (seeded.output.0 != request.domain.output
                || seeded.workspace.0 != request.domain.workspace)
        {
            return rejected(
                request.correlation_id.clone(),
                "cross-domain-mismatch",
                MSG_OBSERVATION,
            );
        }
        {
            let mut current = Self::sorted_ids(&request.windows);
            current.sort();
            let mut seeded = self.seeded_members.clone();
            seeded.sort();
            if current != seeded {
                return rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    MSG_OBSERVATION,
                );
            }
        }
        let domain = DomainKey {
            output: OutputId(request.domain.output.clone()),
            workspace: WorkspaceId(request.domain.workspace.clone()),
        };
        let window = WindowId(request.focused_window.clone());
        let observed: Vec<ObservedWindow> = request
            .windows
            .iter()
            .map(|entry| ObservedWindow {
                window: WindowId(entry.window.clone()),
                output: OutputId(entry.output.clone()),
                workspace: WorkspaceId(entry.workspace.clone()),
                floating: false,
                fullscreen: false,
                maximized: false,
                sticky: false,
            })
            .collect();
        // First-flight seeding advanced exactly N revisions, which the caller
        // already supplied as its revision, so every request (first included)
        // binds the caller revision exactly and stale revisions diverge via
        // the reconciler.
        let session = self.session.as_mut().expect("seeded");
        let observation_revision = request.revision;
        let observation = SessionObservation {
            observation: Observation::new(
                owner.clone(),
                generation.clone(),
                observation_revision,
                request.fingerprint,
            ),
            windows: observed,
        };
        let caps = FocusCapabilities {
            directional_focus: request.capabilities.directional_focus,
        };
        match session.propose_focus(
            &domain,
            &window,
            direction,
            &observation,
            &correlation,
            &caps,
        ) {
            Ok(plan) => serialize_bounded(&FocusReply {
                v: FOCUS_CONTRACT_VERSION,
                correlation_id: request.correlation_id.clone(),
                outcome: "planned",
                kind: None,
                message: None,
                base_revision: Some(plan.dispatch.base_revision),
                revision: None,
                capability: Some("directional-focus"),
                preconditions: Some(
                    plan.dispatch
                        .preconditions
                        .iter()
                        .map(precondition_str)
                        .collect(),
                ),
                operation: Some(OperationReply {
                    domain_output: plan.dispatch.operation.domain_output.0.clone(),
                    domain_workspace: plan.dispatch.operation.domain_workspace.0.clone(),
                    from_leaf: plan.dispatch.operation.from_leaf.0.clone(),
                    to_leaf: plan.dispatch.operation.to_leaf.0.clone(),
                    from_window: plan.dispatch.operation.from_window.0.clone(),
                    to_window: plan.dispatch.operation.to_window.0.clone(),
                    direction: request.direction.clone(),
                    route: plan
                        .dispatch
                        .operation
                        .route
                        .iter()
                        .map(|id| id.0.clone())
                        .collect(),
                }),
                to_window: Some(plan.dispatch.operation.to_window.0.clone()),
            }),
            Err(ProposeError::PendingExists) => diverged(
                request.correlation_id.clone(),
                "pending-exists",
                "complete the pending plan before proposing",
            ),
            Err(ProposeError::Diverged(reason)) => diverged(
                request.correlation_id.clone(),
                reason.as_str(),
                reason.message(),
            ),
            Err(ProposeError::Refused(kind)) => {
                if kind.as_str() == "unchanged" {
                    let revision = self.accepted_revision();
                    serialize_bounded(&FocusReply {
                        v: FOCUS_CONTRACT_VERSION,
                        correlation_id: request.correlation_id.clone(),
                        outcome: "noop",
                        kind: Some(kind.as_str()),
                        message: Some(kind.message()),
                        base_revision: None,
                        revision: Some(revision),
                        capability: None,
                        preconditions: None,
                        operation: None,
                        to_window: None,
                    })
                } else {
                    rejected(
                        request.correlation_id.clone(),
                        kind.as_str(),
                        kind.message(),
                    )
                }
            }
        }
    }

    fn evaluate_ack(&mut self, raw: &serde_json::Value) -> String {
        let request: AckDto = match serde_json::from_value(raw.clone()) {
            Ok(request) => request,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(raw), kind, message);
            }
        };
        if request.v != FOCUS_CONTRACT_VERSION || request.action != "acknowledge" {
            return rejected(
                valid_correlation_echo(raw),
                "unsupported-version",
                MSG_VERSION,
            );
        }
        if CorrelationId::parse(&request.correlation_id).is_none() {
            return rejected(String::new(), "correlation-invalid", MSG_CORRELATION);
        }
        if OwnerId::parse(&request.owner).is_none() {
            return rejected(request.correlation_id.clone(), "owner-invalid", MSG_OWNER);
        }
        if GenerationId::parse(&request.generation).is_none() {
            return rejected(
                request.correlation_id.clone(),
                "generation-invalid",
                MSG_GENERATION,
            );
        }
        if request.base_revision > FOCUS_MAX_REVISION {
            return rejected(
                request.correlation_id.clone(),
                "revision-invalid",
                MSG_REVISION,
            );
        }
        let outcome = match request.outcome.as_str() {
            "accepted" => AckOutcome::Accepted,
            "refused-capability" => AckOutcome::RefusedCapability,
            "partial-application" => AckOutcome::PartialApplication,
            "adapter-lost" => AckOutcome::AdapterLost,
            _ => {
                return rejected(
                    request.correlation_id.clone(),
                    "unknown-value",
                    MSG_UNKNOWN_VALUE,
                );
            }
        };
        let Some(correlation) = CorrelationId::parse(&request.correlation_id) else {
            return rejected(String::new(), "correlation-invalid", MSG_CORRELATION);
        };
        let Some(owner) = OwnerId::parse(&request.owner) else {
            return rejected(request.correlation_id.clone(), "owner-invalid", MSG_OWNER);
        };
        let Some(generation) = GenerationId::parse(&request.generation) else {
            return rejected(
                request.correlation_id.clone(),
                "generation-invalid",
                MSG_GENERATION,
            );
        };
        let ack = AdapterAck::new(
            correlation,
            owner,
            generation,
            request.base_revision,
            outcome,
        );
        let Some(session) = self.session.as_mut() else {
            return rejected(
                request.correlation_id.clone(),
                "no-pending",
                "no pending plan awaits acknowledgement",
            );
        };
        match session.acknowledge(&ack) {
            Ok(_) => serialize_bounded(&FocusReply {
                v: FOCUS_CONTRACT_VERSION,
                correlation_id: request.correlation_id.clone(),
                outcome: "acknowledged",
                kind: None,
                message: None,
                base_revision: Some(request.base_revision),
                revision: None,
                capability: None,
                preconditions: None,
                operation: None,
                to_window: None,
            }),
            Err(crate::reconcile::AckError::NoPending) => rejected(
                request.correlation_id.clone(),
                "no-pending",
                "no pending plan awaits acknowledgement",
            ),
            Err(crate::reconcile::AckError::Diverged(reason)) => diverged(
                request.correlation_id.clone(),
                reason.as_str(),
                reason.message(),
            ),
        }
    }

    fn evaluate_verify(&mut self, raw: &serde_json::Value) -> String {
        let request: VerifyDto = match serde_json::from_value(raw.clone()) {
            Ok(request) => request,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(raw), kind, message);
            }
        };
        if request.v != FOCUS_CONTRACT_VERSION || request.action != "verify" {
            return rejected(
                valid_correlation_echo(raw),
                "unsupported-version",
                MSG_VERSION,
            );
        }
        if CorrelationId::parse(&request.correlation_id).is_none() {
            return rejected(String::new(), "correlation-invalid", MSG_CORRELATION);
        }
        if OwnerId::parse(&request.owner).is_none() {
            return rejected(request.correlation_id.clone(), "owner-invalid", MSG_OWNER);
        }
        if GenerationId::parse(&request.generation).is_none() {
            return rejected(
                request.correlation_id.clone(),
                "generation-invalid",
                MSG_GENERATION,
            );
        }
        if request.revision > FOCUS_MAX_REVISION {
            return rejected(
                request.correlation_id.clone(),
                "revision-invalid",
                MSG_REVISION,
            );
        }
        // Exact complete known preconditions in dispatch order: no
        // duplicates, no subsets, no supersets. Anything else diverges
        // before touching the session.
        if request.verified_preconditions.len() != EXPECTED_PRECONDITIONS.len()
            || request
                .verified_preconditions
                .iter()
                .zip(EXPECTED_PRECONDITIONS.iter())
                .any(|(got, want)| got != want)
            || request.verified_operation.route.is_empty()
            || request.verified_operation.route.len() > FOCUS_MAX_ROUTE
        {
            return diverged(
                request.correlation_id.clone(),
                "postcondition-mismatch",
                "plan postconditions do not bind the pending plan",
            );
        }
        let mut preconditions = Vec::with_capacity(request.verified_preconditions.len());
        for token in &request.verified_preconditions {
            let Some(pre) = precondition_token(token) else {
                return diverged(
                    request.correlation_id.clone(),
                    "postcondition-mismatch",
                    "plan postconditions do not bind the pending plan",
                );
            };
            if preconditions.contains(&pre) {
                return diverged(
                    request.correlation_id.clone(),
                    "postcondition-mismatch",
                    "plan postconditions do not bind the pending plan",
                );
            }
            preconditions.push(pre);
        }
        let Some(direction) = parse_direction(&request.verified_operation.direction) else {
            return diverged(
                request.correlation_id.clone(),
                "postcondition-mismatch",
                "plan postconditions do not bind the pending plan",
            );
        };
        for id in [
            &request.verified_operation.domain_output,
            &request.verified_operation.domain_workspace,
            &request.verified_operation.from_leaf,
            &request.verified_operation.to_leaf,
            &request.verified_operation.from_window,
            &request.verified_operation.to_window,
        ] {
            if !is_opaque_id(id) {
                return diverged(
                    request.correlation_id.clone(),
                    "postcondition-mismatch",
                    "plan postconditions do not bind the pending plan",
                );
            }
        }
        for id in &request.verified_operation.route {
            if !is_opaque_id(id) {
                return diverged(
                    request.correlation_id.clone(),
                    "postcondition-mismatch",
                    "plan postconditions do not bind the pending plan",
                );
            }
        }
        let Some(correlation) = CorrelationId::parse(&request.correlation_id) else {
            return rejected(String::new(), "correlation-invalid", MSG_CORRELATION);
        };
        let Some(owner) = OwnerId::parse(&request.owner) else {
            return rejected(request.correlation_id.clone(), "owner-invalid", MSG_OWNER);
        };
        let Some(generation) = GenerationId::parse(&request.generation) else {
            return rejected(
                request.correlation_id.clone(),
                "generation-invalid",
                MSG_GENERATION,
            );
        };
        let operation = crate::contract::FocusOperation {
            domain_output: OutputId(request.verified_operation.domain_output.clone()),
            domain_workspace: WorkspaceId(request.verified_operation.domain_workspace.clone()),
            from_leaf: NodeId(request.verified_operation.from_leaf.clone()),
            to_leaf: NodeId(request.verified_operation.to_leaf.clone()),
            from_window: WindowId(request.verified_operation.from_window.clone()),
            to_window: WindowId(request.verified_operation.to_window.clone()),
            direction,
            route: request
                .verified_operation
                .route
                .iter()
                .map(|id| NodeId(id.clone()))
                .collect(),
        };
        // Bind the post-observation fingerprint exactly to the deterministic
        // observation (seeded membership + verified target as focused).
        // Literal or stale fingerprints diverge before touching the session.
        if let Some(session) = self.session.as_ref() {
            let mut known: Vec<String> = session
                .snapshot()
                .windows
                .iter()
                .map(|l| l.window.0.clone())
                .collect();
            known.extend(
                session
                    .exception_observed()
                    .iter()
                    .map(|w| w.window.0.clone()),
            );
            known.sort();
            known.dedup();
            let expected_post = focus_fingerprint(
                &request.verified_operation.domain_output,
                &request.verified_operation.domain_workspace,
                &request.verified_operation.to_window,
                &known,
            );
            if request.fingerprint != expected_post {
                // Fingerprint mismatch is a postcondition binding fault:
                // diverge the pending plan fail-closed via a mismatched
                // verify rather than committing.
                let post = FocusPostObservation::new(
                    Observation::new(
                        owner.clone(),
                        generation.clone(),
                        request.revision,
                        request.fingerprint,
                    ),
                    correlation.clone(),
                    false,
                    preconditions.clone(),
                    operation.clone(),
                );
                if let Some(session) = self.session.as_mut() {
                    let _ = session.verify_focus(&post);
                }
                return diverged(
                    request.correlation_id.clone(),
                    "postcondition-mismatch",
                    "plan postconditions do not bind the pending plan",
                );
            }
        }
        let post = FocusPostObservation::new(
            Observation::new(owner, generation, request.revision, request.fingerprint),
            correlation,
            request.verified,
            preconditions,
            operation,
        );
        let Some(session) = self.session.as_mut() else {
            return rejected(
                request.correlation_id.clone(),
                "no-pending",
                "no pending plan awaits verification",
            );
        };
        match session.verify_focus(&post) {
            Ok(commit) => serialize_bounded(&FocusReply {
                v: FOCUS_CONTRACT_VERSION,
                correlation_id: request.correlation_id.clone(),
                outcome: "committed",
                kind: None,
                message: None,
                base_revision: None,
                revision: Some(commit.revision),
                capability: None,
                preconditions: None,
                operation: None,
                to_window: None,
            }),
            Err(crate::reconcile::VerifyError::NoPending) => rejected(
                request.correlation_id.clone(),
                "no-pending",
                "no pending plan awaits verification",
            ),
            Err(crate::reconcile::VerifyError::NotAcknowledged) => rejected(
                request.correlation_id.clone(),
                "not-acknowledged",
                "plan awaits acknowledgement before verification",
            ),
            Err(crate::reconcile::VerifyError::Diverged(reason)) => diverged(
                request.correlation_id.clone(),
                reason.as_str(),
                reason.message(),
            ),
        }
    }

    fn evaluate_loss(&mut self, raw: &serde_json::Value) -> String {
        let request: LossDto = match serde_json::from_value(raw.clone()) {
            Ok(request) => request,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(raw), kind, message);
            }
        };
        if request.v != FOCUS_CONTRACT_VERSION || request.action != "note-loss" {
            return rejected(
                valid_correlation_echo(raw),
                "unsupported-version",
                MSG_VERSION,
            );
        }
        let Some(session) = self.session.as_mut() else {
            return diverged("".to_owned(), "adapter-lost", "adapter reported loss");
        };
        let reason = session.note_adapter_loss();
        diverged(String::new(), reason.as_str(), reason.message())
    }
}
