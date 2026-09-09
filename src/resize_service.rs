//! Bounded static keyboard resize transaction service (product-shaped, static only).
//!
//! Narrow JSON request/action protocol over the portable [`crate::session`]
//! resize plan (`Session::propose_resize` split-share) and [`crate::reconcile`]
//! acknowledgement model. Rust owns normalized domains, resize intent,
//! capabilities, preconditions, revision binding, and reconciliation; KWin
//! owns observation, native mapping, revalidation, native geometry writes,
//! and post-observation. No native execution, persistence, or transport here:
//! this module is pure JSON-string-in / JSON-string-out over an owned
//! [`Session`].
//!
//! Actions (`action` field, `v == 1`):
//! - `request`: propose keyboard split-share resize for one exact opaque
//!   `(domain, focused window, direction)` against a complete normalized
//!   observation. Replies `planned` with the bound dispatch/operation,
//!   complete adjacent/share/projected geometry plus retained focus, `noop`
//!   for missing boundaries, or `rejected`/`diverged` fail-closed.
//! - `request-pointer`: propose pointer split-share resize for one exact
//!   opaque `(domain, focused window, direction, proposed_boundary)` where
//!   Rust derives the target matching-axis boundary and adjacent shares
//!   itself (callers never supply shares). Same `planned`/`noop`/
//!   `rejected`/`diverged` shape and shared acknowledge/verify boundary as
//!   keyboard; keyboard wire behavior is unchanged.
//! - `acknowledge`: record an explicit adapter acknowledgement for the pending
//!   plan. Only `accepted` proceeds; refused/partial/lost diverge.
//!   Replies `acknowledged` or fail-closed divergence.
//! - `verify`: commit after acknowledgement given a fresh verified
//!   post-observation with complete exact geometry/focus. Replies `committed`
//!   or fail-closed divergence.
//! - `note-loss`: explicit adapter-loss signal. Always diverges terminally.
//!
//! Wire rejects are fixed redacted strings; input is never echoed except a
//! valid correlation id echo. Correlations are single-use (bounded seen set);
//! owner/generation/revision mismatches diverge through the session.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::contract::{
    AckOutcome, AdapterAck, Observation, ResizeCapabilities, ResizePostObservation,
};
use crate::directional::{Direction, NodeId, OutputId, WindowId, WorkspaceId};
use crate::focus_service::focus_fingerprint;
use crate::geometry::Rect;
use crate::ids::{CorrelationId, GenerationId, OwnerId};
use crate::session::{
    DesiredGeometry, DomainKey, ExceptionFlags, ObservedWindow, OutputDomain, ProposeError,
    Session, SessionCommand, SessionObservation,
};

/// Resize transaction contract version (JSON string v1).
pub const RESIZE_CONTRACT_VERSION: u32 = 1;
/// Bounded request cap.
pub const RESIZE_MAX_REQUEST_BYTES: usize = 64 * 1024;
/// Bounded reply cap.
pub const RESIZE_MAX_REPLY_BYTES: usize = 64 * 1024;
/// Opaque id bound.
pub const RESIZE_MAX_ID_LEN: usize = 128;
/// Observed window bound.
pub const RESIZE_MAX_WINDOWS: usize = 64;
/// Geometry entry bound (mirrors window bound).
pub const RESIZE_MAX_GEOMETRY: usize = 64;
/// Share vector bound (mirrors reconciler validation).
pub const RESIZE_MAX_SHARES: usize = 64;
/// Seen-correlation bound.
pub const RESIZE_MAX_SEEN: usize = 2048;
/// Revision bound (inclusive, shared with contract).
pub const RESIZE_MAX_REVISION: u64 = 1_000_000;

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
const MSG_SESSION_FULL: &str = "resize session correlation bound was reached";

/// Deterministic bounded observation fingerprint, reusing the focus adapter
/// binding exactly (FNV-1a over `output\x1fworkspace\x1ffocused\x1fids...`).
#[must_use]
pub fn resize_fingerprint(
    domain_output: &str,
    domain_workspace: &str,
    focused: &str,
    sorted_ids: &[String],
) -> u64 {
    focus_fingerprint(domain_output, domain_workspace, focused, sorted_ids)
}

/// Bounded coordinate extent for carried work-area/window geometry.
const GEOMETRY_BOUND: i32 = 16384;
/// Bounded gap extent for carried work-area geometry.
const GEOMETRY_MAX_GAP: i32 = 64;

fn valid_carried_rect(x: i32, y: i32, w: i32, h: i32) -> bool {
    w > 0
        && h > 0
        && (-GEOMETRY_BOUND..=GEOMETRY_BOUND).contains(&x)
        && (-GEOMETRY_BOUND..=GEOMETRY_BOUND).contains(&y)
        && w <= GEOMETRY_BOUND
        && h <= GEOMETRY_BOUND
        && (i64::from(x) + i64::from(w) <= i64::from(i32::MAX))
        && (i64::from(y) + i64::from(h) <= i64::from(i32::MAX))
}

fn rect_contained(inner: Rect, outer: Rect) -> bool {
    let inner_right = i64::from(inner.x) + i64::from(inner.w);
    let inner_bottom = i64::from(inner.y) + i64::from(inner.h);
    let outer_right = i64::from(outer.x) + i64::from(outer.w);
    let outer_bottom = i64::from(outer.y) + i64::from(outer.h);
    inner.x >= outer.x
        && inner.y >= outer.y
        && inner_right <= outer_right
        && inner_bottom <= outer_bottom
}

/// Deterministic seed placement derived from the supplied work area (never a
/// hardcoded work area): a small rect anchored at the work-area origin,
/// clamped to the supplied bounds so admission never invents geometry. Wide
/// so the COSMIC admission rule (`cosmic_v1::admission_axis`: wide splits
/// portable Horizontal) yields horizontal sibling splits for seeded
/// multi-window domains.
fn derived_seed_placement(bounds: Rect) -> Rect {
    Rect {
        x: bounds.x,
        y: bounds.y,
        w: bounds.w.clamp(1, 120),
        h: bounds.h.clamp(1, 80),
    }
}

/// Exact complete resize precondition set, in dispatch order.
const EXPECTED_PRECONDITIONS: &[&str] = &[
    "focused-leaf-occupied-by-focused-window",
    "target-boundary-valid",
    "resize-targets-same-domain",
    "adapter-must-verify-postconditions",
];

fn is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= RESIZE_MAX_ID_LEN
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

fn parse_direction(value: &str) -> Option<Direction> {
    match value {
        "left" => Some(Direction::Left),
        "right" => Some(Direction::Right),
        "up" => Some(Direction::Up),
        "down" => Some(Direction::Down),
        _ => None,
    }
}

fn direction_str(value: Direction) -> &'static str {
    match value {
        Direction::Left => "left",
        Direction::Right => "right",
        Direction::Up => "up",
        Direction::Down => "down",
    }
}

fn precondition_token(value: &str) -> Option<crate::contract::ResizePrecondition> {
    use crate::contract::ResizePrecondition as P;
    match value {
        "focused-leaf-occupied-by-focused-window" => Some(P::FocusedLeafOccupiedByFocusedWindow),
        "target-boundary-valid" => Some(P::TargetBoundaryValid),
        "resize-targets-same-domain" => Some(P::ResizeTargetsSameDomain),
        "adapter-must-verify-postconditions" => Some(P::AdapterMustVerifyPostconditions),
        _ => None,
    }
}

fn precondition_str(value: &crate::contract::ResizePrecondition) -> &'static str {
    use crate::contract::ResizePrecondition as P;
    match value {
        P::FocusedLeafOccupiedByFocusedWindow => "focused-leaf-occupied-by-focused-window",
        P::TargetBoundaryValid => "target-boundary-valid",
        P::ResizeTargetsSameDomain => "resize-targets-same-domain",
        P::AdapterMustVerifyPostconditions => "adapter-must-verify-postconditions",
    }
}

fn get_usize(obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<usize> {
    obj.get(key)?.as_u64()?.try_into().ok()
}

fn mode_str(value: crate::contract::ResizeMode) -> &'static str {
    value.as_str()
}

fn parse_mode(value: &str) -> Option<crate::contract::ResizeMode> {
    match value {
        "inwards" => Some(crate::contract::ResizeMode::Inwards),
        "outwards" => Some(crate::contract::ResizeMode::Outwards),
        _ => None,
    }
}

fn operation_to_value(op: &crate::contract::ResizeOperation) -> serde_json::Value {
    serde_json::json!({
        "kind": "ResizeSplitShare",
        "domain_output": op.domain_output.0,
        "domain_workspace": op.domain_workspace.0,
        "focused_leaf": op.focused_leaf.0,
        "focused_window": op.focused_window.0,
        "direction": direction_str(op.direction),
        "mode": mode_str(op.mode),
        "target_group": op.target_group.0,
        "focused_child": op.focused_child.0,
        "neighbor_child": op.neighbor_child.0,
        "focused_index": op.focused_index,
        "neighbor_index": op.neighbor_index,
        "old_shares": op.old_shares,
        "new_shares": op.new_shares,
    })
}

fn parse_shares(value: &serde_json::Value) -> Option<Vec<u64>> {
    let items = value.as_array()?;
    if items.len() < 2 || items.len() > RESIZE_MAX_SHARES {
        return None;
    }
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let share = item.as_u64()?;
        if share == 0 {
            return None;
        }
        out.push(share);
    }
    Some(out)
}

fn parse_operation(value: &serde_json::Value) -> Option<crate::contract::ResizeOperation> {
    let obj = value.as_object()?;
    let keys: std::collections::BTreeSet<&str> = obj.keys().map(String::as_str).collect();
    let want: &[&str] = &[
        "kind",
        "domain_output",
        "domain_workspace",
        "focused_leaf",
        "focused_window",
        "direction",
        "mode",
        "target_group",
        "focused_child",
        "neighbor_child",
        "focused_index",
        "neighbor_index",
        "old_shares",
        "new_shares",
    ];
    if keys.len() != want.len() || !want.iter().all(|k| keys.contains(k)) {
        return None;
    }
    if obj.get("kind")?.as_str()? != "ResizeSplitShare" {
        return None;
    }
    let opaque = |key: &str| -> Option<String> {
        let v = obj.get(key)?.as_str()?;
        if is_opaque_id(v) {
            Some(v.to_owned())
        } else {
            None
        }
    };
    let old_shares = parse_shares(obj.get("old_shares")?)?;
    let new_shares = parse_shares(obj.get("new_shares")?)?;
    if old_shares.len() != new_shares.len() || old_shares == new_shares {
        return None;
    }
    Some(crate::contract::ResizeOperation {
        domain_output: OutputId(opaque("domain_output")?),
        domain_workspace: WorkspaceId(opaque("domain_workspace")?),
        focused_leaf: NodeId(opaque("focused_leaf")?),
        focused_window: WindowId(opaque("focused_window")?),
        direction: parse_direction(obj.get("direction")?.as_str()?)?,
        mode: parse_mode(obj.get("mode")?.as_str()?)?,
        target_group: NodeId(opaque("target_group")?),
        focused_child: NodeId(opaque("focused_child")?),
        neighbor_child: NodeId(opaque("neighbor_child")?),
        focused_index: get_usize(obj, "focused_index")?,
        neighbor_index: get_usize(obj, "neighbor_index")?,
        old_shares,
        new_shares,
    })
    .filter(|op| {
        op.focused_child != op.neighbor_child
            && op.focused_index != op.neighbor_index
            && op.focused_index < op.old_shares.len()
            && op.neighbor_index < op.old_shares.len()
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct DomainDto {
    output: String,
    workspace: String,
    bounds: RectDto,
    gap: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ObservedDto {
    window: String,
    output: String,
    workspace: String,
    rect: RectDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct CapabilitiesDto {
    keyboard_resize: bool,
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
    /// Cardinal edge selecting the neighbor side (left/right/up/down).
    direction: String,
    /// Source resize direction mode (inwards shrinks focused, outwards grows).
    mode: String,
    /// Explicit portable key-repeat state for the COSMIC keyboard step
    /// schedule (0 is the initial press, 12px). All three are required;
    /// absent fields reject as malformed with no compatibility default.
    press_index: u32,
    windows: Vec<ObservedDto>,
    capabilities: CapabilitiesDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct PointerRequestDto {
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
    proposed_boundary: i32,
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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RectDto {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct GeometryDto {
    window: String,
    leaf: String,
    output: String,
    workspace: String,
    rect: RectDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct FocusDto {
    domain_output: String,
    domain_workspace: String,
    leaf: String,
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
    verified_operation: serde_json::Value,
    verified_geometry: Vec<GeometryDto>,
    verified_focus: FocusDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct LossDto {
    v: u32,
    action: String,
}

#[derive(Debug, Clone, Serialize)]
struct GeometryReply {
    window: String,
    leaf: String,
    output: String,
    workspace: String,
    rect: RectDto,
}

#[derive(Debug, Clone, Serialize)]
struct FocusReplyBody {
    domain_output: String,
    domain_workspace: String,
    leaf: String,
}

#[derive(Debug, Clone, Serialize)]
struct ResizeReply {
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
    operation: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    desired_geometry: Option<Vec<GeometryReply>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    desired_focus: Option<FocusReplyBody>,
}

fn serialize_bounded(reply: &ResizeReply) -> String {
    match serde_json::to_string(reply) {
        Ok(text) if text.len() <= RESIZE_MAX_REPLY_BYTES => text,
        _ => "{\"v\":1,\"correlation_id\":\"\",\"outcome\":\"rejected\",\"kind\":\"snapshot-invalid\",\"message\":\"snapshot or intent is malformed\"}"
            .to_owned(),
    }
}

fn rejected(correlation_id: String, kind: &'static str, message: &'static str) -> String {
    serialize_bounded(&ResizeReply {
        v: RESIZE_CONTRACT_VERSION,
        correlation_id,
        outcome: "rejected",
        kind: Some(kind),
        message: Some(message),
        base_revision: None,
        revision: None,
        capability: None,
        preconditions: None,
        operation: None,
        desired_geometry: None,
        desired_focus: None,
    })
}

fn diverged(correlation_id: String, kind: &'static str, message: &'static str) -> String {
    serialize_bounded(&ResizeReply {
        v: RESIZE_CONTRACT_VERSION,
        correlation_id,
        outcome: "diverged",
        kind: Some(kind),
        message: Some(message),
        base_revision: None,
        revision: None,
        capability: None,
        preconditions: None,
        operation: None,
        desired_geometry: None,
        desired_focus: None,
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

fn geometry_reply(g: &DesiredGeometry) -> GeometryReply {
    GeometryReply {
        window: g.window.0.clone(),
        leaf: g.leaf.0.clone(),
        output: g.output.0.clone(),
        workspace: g.workspace.0.clone(),
        rect: RectDto {
            x: g.rect.x,
            y: g.rect.y,
            w: g.rect.w,
            h: g.rect.h,
        },
    }
}

#[derive(Debug, Clone)]
struct PendingResize {
    correlation: String,
    focused_window: String,
    operation: crate::contract::ResizeOperation,
    preconditions: Vec<crate::contract::ResizePrecondition>,
    desired_geometry: Vec<DesiredGeometry>,
    desired_focus_domain: DomainKey,
    desired_focus_leaf: NodeId,
}

/// Which D-Bus route created the active pending plan. Used only for
/// method-level action fencing: `DescribeResize` owns keyboard
/// `request` cycles, `DescribePointerResize` owns `request-pointer` cycles.
/// Shared `acknowledge`/`verify`/`note-loss` bind only to the pending cycle
/// created through the same route; cross-route calls are rejected without
/// mutating the session or clearing the foreign pending.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PendingOrigin {
    Keyboard,
    Pointer,
}

struct MismatchedVerify {
    correlation: CorrelationId,
    owner: OwnerId,
    generation: GenerationId,
    revision: u64,
    fingerprint: u64,
    preconditions: Vec<crate::contract::ResizePrecondition>,
    operation: crate::contract::ResizeOperation,
}

/// Bounded static keyboard resize transaction service over an owned [`Session`].
///
/// Owns/creates the single portable [`Session`] from the first strict
/// normalized `request` (Rust-only deterministic admission order over the
/// carried work-area bounds/gap; no JS topology, no native fields). Changed membership/domain after
/// seeding is rejected without divergence. Single session, single pending via
/// the session/reconciler. Single-use correlations (bounded seen set);
/// the session itself enforces owner/generation/revision/pending binding and
/// terminal divergence. Seen exhaustion diverges fail-closed.
#[derive(Debug)]
pub struct ResizeService {
    session: Option<Session>,
    seeded_domain: Option<DomainKey>,
    seeded_members: Vec<String>,
    seen: HashSet<String>,
    pending: Option<PendingResize>,
    pending_origin: Option<PendingOrigin>,
}

impl Default for ResizeService {
    fn default() -> Self {
        Self::new()
    }
}

impl ResizeService {
    /// Fresh unseeded service. The first strict `request` seeds the owned
    /// session; until then there is no pending and revision mirrors 0.
    #[must_use]
    pub fn new() -> Self {
        Self {
            session: None,
            seeded_domain: None,
            seeded_members: Vec::new(),
            seen: HashSet::new(),
            pending: None,
            pending_origin: None,
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
            pending: None,
            pending_origin: None,
        }
    }

    /// Borrow the owned session. Panics when unseeded; use
    /// [`Self::session_opt`] for the unseeded case.
    #[must_use]
    pub fn session(&self) -> &Session {
        self.session.as_ref().expect("resize session is seeded")
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

    /// Strict JSON-only resize transaction. Always returns a bounded reply.
    /// Shared entry used by portable tests; production D-Bus routes must use
    /// the fenced [`Self::evaluate_keyboard_json`] (`DescribeResize`) or
    /// [`Self::evaluate_pointer_json`] (`DescribePointerResize`) so
    /// `request` and `request-pointer` cycles never mutate each other.
    pub fn evaluate_json(&mut self, request_json: &str) -> String {
        if request_json.len() > RESIZE_MAX_REQUEST_BYTES {
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
            "request-pointer" => self.evaluate_pointer_request(&raw),
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

    /// Fenced keyboard D-Bus route (`DescribeResize`): accepts keyboard
    /// `request` plus shared `acknowledge`/`verify`/`note-loss` only.
    /// `request-pointer` is rejected without mutation. Shared actions bind
    /// only when no pointer-owned pending exists; a pointer-owned pending
    /// is rejected without mutating the session or clearing the foreign
    /// pending, preserving sequential pointer cycles. Idle (no pending) or
    /// keyboard-owned pending behaves exactly like [`Self::evaluate_json`].
    pub fn evaluate_keyboard_json(&mut self, request_json: &str) -> String {
        if request_json.len() > RESIZE_MAX_REQUEST_BYTES {
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
            "request-pointer" => rejected(
                valid_correlation_echo(&raw),
                "unknown-value",
                MSG_UNKNOWN_VALUE,
            ),
            "acknowledge" | "verify" | "note-loss" => {
                if self.pending.is_some() && self.pending_origin == Some(PendingOrigin::Pointer) {
                    // Cross-route shared action: reject without mutation so
                    // the pointer cycle survives intact.
                    if action == "note-loss" {
                        return rejected(
                            String::new(),
                            "no-pending",
                            "no pending plan awaits loss",
                        );
                    }
                    if action == "acknowledge" {
                        return rejected(
                            valid_correlation_echo(&raw),
                            "no-pending",
                            "no pending plan awaits acknowledgement",
                        );
                    }
                    return rejected(
                        valid_correlation_echo(&raw),
                        "no-pending",
                        "no pending plan awaits verification",
                    );
                }
                match action {
                    "acknowledge" => self.evaluate_ack(&raw),
                    "verify" => self.evaluate_verify(&raw),
                    _ => self.evaluate_loss(&raw),
                }
            }
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

    /// Fenced pointer D-Bus route (`DescribePointerResize`): accepts
    /// `request-pointer` plus only the same-cycle shared
    /// `acknowledge`/`verify`/`note-loss` for the pointer request.
    /// Keyboard `request` is rejected without mutation. Shared actions bind
    /// only when no keyboard-owned pending exists; a keyboard-owned pending
    /// is rejected without mutation, preserving keyboard behavior and
    /// sequential pointer ack/verify.
    pub fn evaluate_pointer_json(&mut self, request_json: &str) -> String {
        if request_json.len() > RESIZE_MAX_REQUEST_BYTES {
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
            "request-pointer" => self.evaluate_pointer_request(&raw),
            "request" => rejected(
                valid_correlation_echo(&raw),
                "unknown-value",
                MSG_UNKNOWN_VALUE,
            ),
            "acknowledge" | "verify" | "note-loss" => {
                if self.pending.is_some() && self.pending_origin == Some(PendingOrigin::Keyboard) {
                    if action == "note-loss" {
                        return rejected(
                            String::new(),
                            "no-pending",
                            "no pending plan awaits loss",
                        );
                    }
                    if action == "acknowledge" {
                        return rejected(
                            valid_correlation_echo(&raw),
                            "no-pending",
                            "no pending plan awaits acknowledgement",
                        );
                    }
                    return rejected(
                        valid_correlation_echo(&raw),
                        "no-pending",
                        "no pending plan awaits verification",
                    );
                }
                match action {
                    "acknowledge" => self.evaluate_ack(&raw),
                    "verify" => self.evaluate_verify(&raw),
                    _ => self.evaluate_loss(&raw),
                }
            }
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
        if self.seen.len() >= RESIZE_MAX_SEEN {
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
        self.pending = None;
        self.pending_origin = None;
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
        resize_fingerprint(
            domain_output,
            domain_workspace,
            focused,
            &Self::sorted_ids(windows),
        )
    }

    /// Deterministic Rust-only seeding from the first strict normalized
    /// request. Single domain whose portable work-area bounds/gap are carried
    /// in the request (never hardcoded, never JS topology, no native fields);
    /// admits sorted windows with the focused window last so session focus
    /// equals the request focus. Uses existing [`Session`] lifecycle
    /// admit/acknowledge/verify APIs only. First request revision must exactly
    /// equal the normalized observed membership size (`windows.len()`, hence
    /// the post-seed base N); any other explicit revision is rejected without
    /// seeding. Carried per-window rectangles are an observation/precondition
    /// boundary only (validated shape + containment in the work area, never
    /// stored as native objects/identities in the session). Changed
    /// domain/membership/bounds afterwards is rejected by the caller, never
    /// reseeded.
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
            return Err("initial resize request must carry revision N".to_owned());
        }
        if windows.is_empty() || windows.len() > RESIZE_MAX_WINDOWS {
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
        let bounds = Rect {
            x: request.domain.bounds.x,
            y: request.domain.bounds.y,
            w: request.domain.bounds.w,
            h: request.domain.bounds.h,
        };
        if !valid_carried_rect(bounds.x, bounds.y, bounds.w, bounds.h) {
            return Err(MSG_OBSERVATION.to_owned());
        }
        if request.domain.gap < 0 || request.domain.gap > GEOMETRY_MAX_GAP {
            return Err(MSG_OBSERVATION.to_owned());
        }
        for entry in windows {
            if !valid_carried_rect(entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h) {
                return Err(MSG_OBSERVATION.to_owned());
            }
            let rect = Rect {
                x: entry.rect.x,
                y: entry.rect.y,
                w: entry.rect.w,
                h: entry.rect.h,
            };
            if !rect_contained(rect, bounds) {
                return Err(MSG_OBSERVATION.to_owned());
            }
        }
        let domain = OutputDomain {
            id: OutputId(domain_output.to_owned()),
            workspace: WorkspaceId(domain_workspace.to_owned()),
            bounds,
            gap: request.domain.gap,
            adjacent: std::collections::BTreeMap::new(),
        };
        if !domain.validate() {
            return Err(MSG_OBSERVATION.to_owned());
        }
        let mut session = Session::new(
            owner.clone(),
            generation.clone(),
            0,
            fingerprint,
            vec![domain],
        )
        .map_err(|_| MSG_OBSERVATION.to_owned())?;
        let mut ordered: Vec<String> = Self::sorted_ids(windows);
        ordered.retain(|id| id != focused);
        ordered.push(focused.to_owned());
        let placement = derived_seed_placement(bounds);
        for (index, window) in ordered.iter().enumerate() {
            Self::admit_seed_window(
                &mut session,
                owner,
                generation,
                window,
                domain_output,
                domain_workspace,
                placement,
                index,
            )?;
        }
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

    #[allow(clippy::too_many_arguments)]
    fn admit_seed_window(
        session: &mut Session,
        owner: &OwnerId,
        generation: &GenerationId,
        window: &str,
        output: &str,
        workspace: &str,
        placement_bounds: Rect,
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
            placement_bounds,
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
        if request.v != RESIZE_CONTRACT_VERSION || request.action != "request" {
            let (kind, message) = if request.v != RESIZE_CONTRACT_VERSION {
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
        if request.revision > RESIZE_MAX_REVISION {
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
        if request.windows.is_empty() || request.windows.len() > RESIZE_MAX_WINDOWS {
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
        if !request.capabilities.keyboard_resize {
            return rejected(
                request.correlation_id.clone(),
                "unsupported-capability",
                MSG_CAPABILITY,
            );
        }
        // Carried work-area bounds/gap plus complete per-window rectangles
        // are an observation/precondition boundary: bounded shapes contained
        // in the work area. Drift/mismatch fails closed below.
        let carried_bounds = Rect {
            x: request.domain.bounds.x,
            y: request.domain.bounds.y,
            w: request.domain.bounds.w,
            h: request.domain.bounds.h,
        };
        if !valid_carried_rect(
            carried_bounds.x,
            carried_bounds.y,
            carried_bounds.w,
            carried_bounds.h,
        ) || request.domain.gap < 0
            || request.domain.gap > GEOMETRY_MAX_GAP
        {
            return rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OBSERVATION,
            );
        }
        for entry in &request.windows {
            if !valid_carried_rect(entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h) {
                return rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    MSG_OBSERVATION,
                );
            }
            if !rect_contained(
                Rect {
                    x: entry.rect.x,
                    y: entry.rect.y,
                    w: entry.rect.w,
                    h: entry.rect.h,
                },
                carried_bounds,
            ) {
                return rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    MSG_OBSERVATION,
                );
            }
        }
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
        // Single-domain static resize: every observed entry must live in the
        // request domain. Anything else is a cross-domain mismatch.
        for entry in &request.windows {
            if entry.output != request.domain.output || entry.workspace != request.domain.workspace
            {
                return rejected(
                    request.correlation_id.clone(),
                    "cross-domain-mismatch",
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
        let was_unseeded = self.session.is_none();
        if was_unseeded && let Err(reason) = self.ensure_seeded(&owner, &generation, &request) {
            let _ = reason;
            return rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OBSERVATION,
            );
        }
        // Reject changed membership/domain/work-area after seeding without
        // divergence. Work-area bounds/gap must exactly match the owned
        // session domain; per-window geometry drift outside the work area is
        // already rejected above, and membership is pinned below.
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
        if let Some(session) = self.session.as_ref() {
            let key = DomainKey {
                output: OutputId(request.domain.output.clone()),
                workspace: WorkspaceId(request.domain.workspace.clone()),
            };
            let bounds_ok = session
                .domains()
                .iter()
                .find(|d| d.key() == key)
                .is_some_and(|d| d.bounds == carried_bounds && d.gap == request.domain.gap);
            if !bounds_ok {
                return rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    MSG_OBSERVATION,
                );
            }
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
        let session = self.session.as_mut().expect("seeded");
        let observation = SessionObservation {
            observation: Observation::new(
                owner.clone(),
                generation.clone(),
                request.revision,
                request.fingerprint,
            ),
            windows: observed,
        };
        let caps = ResizeCapabilities {
            keyboard_resize: request.capabilities.keyboard_resize,
        };
        let Some(mode) = parse_mode(&request.mode) else {
            return rejected(
                request.correlation_id.clone(),
                "direction-invalid",
                MSG_DIRECTION,
            );
        };
        match session.propose_resize(
            &domain,
            &window,
            direction,
            mode,
            request.press_index,
            &observation,
            &correlation,
            &caps,
        ) {
            Ok(plan) => {
                let preconditions: Vec<&'static str> = plan
                    .dispatch
                    .preconditions
                    .iter()
                    .map(precondition_str)
                    .collect();
                let operation = operation_to_value(&plan.dispatch.operation);
                let desired_geometry: Vec<GeometryReply> =
                    plan.desired_geometry.iter().map(geometry_reply).collect();
                let desired_focus = FocusReplyBody {
                    domain_output: plan.desired_focus_domain.output.0.clone(),
                    domain_workspace: plan.desired_focus_domain.workspace.0.clone(),
                    leaf: plan.desired_focus_leaf.0.clone(),
                };
                self.pending = Some(PendingResize {
                    correlation: request.correlation_id.clone(),
                    focused_window: request.focused_window.clone(),
                    operation: plan.dispatch.operation.clone(),
                    preconditions: plan.dispatch.preconditions.clone(),
                    desired_geometry: plan.desired_geometry.clone(),
                    desired_focus_domain: plan.desired_focus_domain.clone(),
                    desired_focus_leaf: plan.desired_focus_leaf.clone(),
                });
                self.pending_origin = Some(PendingOrigin::Keyboard);
                serialize_bounded(&ResizeReply {
                    v: RESIZE_CONTRACT_VERSION,
                    correlation_id: request.correlation_id.clone(),
                    outcome: "planned",
                    kind: None,
                    message: None,
                    base_revision: Some(plan.dispatch.base_revision),
                    revision: None,
                    capability: Some("keyboard-resize"),
                    preconditions: Some(preconditions),
                    operation: Some(operation),
                    desired_geometry: Some(desired_geometry),
                    desired_focus: Some(desired_focus),
                })
            }
            Err(ProposeError::PendingExists) => diverged(
                request.correlation_id.clone(),
                "pending-exists",
                "complete the pending plan before proposing",
            ),
            Err(ProposeError::Diverged(reason)) => {
                self.pending = None;
                self.pending_origin = None;
                diverged(
                    request.correlation_id.clone(),
                    reason.as_str(),
                    reason.message(),
                )
            }
            Err(ProposeError::Refused(kind)) => {
                if kind.as_str() == "unchanged" {
                    let revision = self.accepted_revision();
                    serialize_bounded(&ResizeReply {
                        v: RESIZE_CONTRACT_VERSION,
                        correlation_id: request.correlation_id.clone(),
                        outcome: "noop",
                        kind: Some(kind.as_str()),
                        message: Some(kind.message()),
                        base_revision: None,
                        revision: Some(revision),
                        capability: None,
                        preconditions: None,
                        operation: None,
                        desired_geometry: None,
                        desired_focus: None,
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

    fn evaluate_pointer_request(&mut self, raw: &serde_json::Value) -> String {
        let request: PointerRequestDto = match serde_json::from_value(raw.clone()) {
            Ok(request) => request,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(raw), kind, message);
            }
        };
        if request.v != RESIZE_CONTRACT_VERSION || request.action != "request-pointer" {
            let (kind, message) = if request.v != RESIZE_CONTRACT_VERSION {
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
        if request.revision > RESIZE_MAX_REVISION {
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
        // Absolute boundary sanity is enforced against the domain work-area
        // extent by the session layer (fail-closed malformed input); no
        // project coordinate bound lives here.
        if request.windows.is_empty() || request.windows.len() > RESIZE_MAX_WINDOWS {
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
        if !request.capabilities.keyboard_resize {
            return rejected(
                request.correlation_id.clone(),
                "unsupported-capability",
                MSG_CAPABILITY,
            );
        }
        let carried_bounds = Rect {
            x: request.domain.bounds.x,
            y: request.domain.bounds.y,
            w: request.domain.bounds.w,
            h: request.domain.bounds.h,
        };
        if !valid_carried_rect(
            carried_bounds.x,
            carried_bounds.y,
            carried_bounds.w,
            carried_bounds.h,
        ) || request.domain.gap < 0
            || request.domain.gap > GEOMETRY_MAX_GAP
        {
            return rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OBSERVATION,
            );
        }
        for entry in &request.windows {
            if !valid_carried_rect(entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h) {
                return rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    MSG_OBSERVATION,
                );
            }
            if !rect_contained(
                Rect {
                    x: entry.rect.x,
                    y: entry.rect.y,
                    w: entry.rect.w,
                    h: entry.rect.h,
                },
                carried_bounds,
            ) {
                return rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    MSG_OBSERVATION,
                );
            }
        }
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
        for entry in &request.windows {
            if entry.output != request.domain.output || entry.workspace != request.domain.workspace
            {
                return rejected(
                    request.correlation_id.clone(),
                    "cross-domain-mismatch",
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
        let was_unseeded = self.session.is_none();
        if was_unseeded {
            let seed = RequestDto {
                v: request.v,
                action: "request".to_owned(),
                correlation_id: request.correlation_id.clone(),
                owner: request.owner.clone(),
                generation: request.generation.clone(),
                revision: request.revision,
                fingerprint: request.fingerprint,
                domain: request.domain.clone(),
                focused_window: request.focused_window.clone(),
                direction: request.direction.clone(),
                mode: "outwards".to_owned(),
                press_index: 0,
                windows: request.windows.clone(),
                capabilities: request.capabilities.clone(),
            };
            if let Err(reason) = self.ensure_seeded(&owner, &generation, &seed) {
                let _ = reason;
                return rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    MSG_OBSERVATION,
                );
            }
        }
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
        if let Some(session) = self.session.as_ref() {
            let key = DomainKey {
                output: OutputId(request.domain.output.clone()),
                workspace: WorkspaceId(request.domain.workspace.clone()),
            };
            let bounds_ok = session
                .domains()
                .iter()
                .find(|d| d.key() == key)
                .is_some_and(|d| d.bounds == carried_bounds && d.gap == request.domain.gap);
            if !bounds_ok {
                return rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    MSG_OBSERVATION,
                );
            }
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
        let session = self.session.as_mut().expect("seeded");
        let observation = SessionObservation {
            observation: Observation::new(
                owner.clone(),
                generation.clone(),
                request.revision,
                request.fingerprint,
            ),
            windows: observed,
        };
        let caps = ResizeCapabilities {
            keyboard_resize: request.capabilities.keyboard_resize,
        };
        match session.propose_pointer_resize(
            &domain,
            &window,
            direction,
            request.proposed_boundary,
            &observation,
            &correlation,
            &caps,
        ) {
            Ok(plan) => {
                let preconditions: Vec<&'static str> = plan
                    .dispatch
                    .preconditions
                    .iter()
                    .map(precondition_str)
                    .collect();
                let operation = operation_to_value(&plan.dispatch.operation);
                let desired_geometry: Vec<GeometryReply> =
                    plan.desired_geometry.iter().map(geometry_reply).collect();
                let desired_focus = FocusReplyBody {
                    domain_output: plan.desired_focus_domain.output.0.clone(),
                    domain_workspace: plan.desired_focus_domain.workspace.0.clone(),
                    leaf: plan.desired_focus_leaf.0.clone(),
                };
                self.pending = Some(PendingResize {
                    correlation: request.correlation_id.clone(),
                    focused_window: request.focused_window.clone(),
                    operation: plan.dispatch.operation.clone(),
                    preconditions: plan.dispatch.preconditions.clone(),
                    desired_geometry: plan.desired_geometry.clone(),
                    desired_focus_domain: plan.desired_focus_domain.clone(),
                    desired_focus_leaf: plan.desired_focus_leaf.clone(),
                });
                self.pending_origin = Some(PendingOrigin::Pointer);
                serialize_bounded(&ResizeReply {
                    v: RESIZE_CONTRACT_VERSION,
                    correlation_id: request.correlation_id.clone(),
                    outcome: "planned",
                    kind: None,
                    message: None,
                    base_revision: Some(plan.dispatch.base_revision),
                    revision: None,
                    capability: Some("keyboard-resize"),
                    preconditions: Some(preconditions),
                    operation: Some(operation),
                    desired_geometry: Some(desired_geometry),
                    desired_focus: Some(desired_focus),
                })
            }
            Err(ProposeError::PendingExists) => diverged(
                request.correlation_id.clone(),
                "pending-exists",
                "complete the pending plan before proposing",
            ),
            Err(ProposeError::Diverged(reason)) => {
                self.pending = None;
                self.pending_origin = None;
                diverged(
                    request.correlation_id.clone(),
                    reason.as_str(),
                    reason.message(),
                )
            }
            Err(ProposeError::Refused(kind)) => {
                if kind.as_str() == "unchanged" {
                    let revision = self.accepted_revision();
                    serialize_bounded(&ResizeReply {
                        v: RESIZE_CONTRACT_VERSION,
                        correlation_id: request.correlation_id.clone(),
                        outcome: "noop",
                        kind: Some(kind.as_str()),
                        message: Some(kind.message()),
                        base_revision: None,
                        revision: Some(revision),
                        capability: None,
                        preconditions: None,
                        operation: None,
                        desired_geometry: None,
                        desired_focus: None,
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
        if request.v != RESIZE_CONTRACT_VERSION || request.action != "acknowledge" {
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
        if request.base_revision > RESIZE_MAX_REVISION {
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
            Ok(_) => serialize_bounded(&ResizeReply {
                v: RESIZE_CONTRACT_VERSION,
                correlation_id: request.correlation_id.clone(),
                outcome: "acknowledged",
                kind: None,
                message: None,
                base_revision: Some(request.base_revision),
                revision: None,
                capability: None,
                preconditions: None,
                operation: None,
                desired_geometry: None,
                desired_focus: None,
            }),
            Err(crate::reconcile::AckError::NoPending) => rejected(
                request.correlation_id.clone(),
                "no-pending",
                "no pending plan awaits acknowledgement",
            ),
            Err(crate::reconcile::AckError::Diverged(reason)) => {
                self.pending = None;
                self.pending_origin = None;
                diverged(
                    request.correlation_id.clone(),
                    reason.as_str(),
                    reason.message(),
                )
            }
        }
    }

    fn mismatched_verify_diverge(&mut self, report: MismatchedVerify) {
        // Drive the session to terminal divergence with a mismatched report
        // so fail-closed state is terminal.
        let post = ResizePostObservation::new(
            Observation::new(
                report.owner,
                report.generation,
                report.revision,
                report.fingerprint,
            ),
            report.correlation,
            false,
            report.preconditions,
            report.operation,
        );
        if let Some(session) = self.session.as_mut() {
            let _ = session.verify_resize(&post);
            // `verify_resize` with no pending or a not-acknowledged plan does
            // not diverge; mismatched verify reports must still be terminal.
            if session.divergence().is_none() {
                let _ = session.note_adapter_loss();
            }
        }
        self.pending = None;
        self.pending_origin = None;
    }

    /// Terminal divergence for structurally invalid verify reports (empty /
    /// oversize / duplicate geometry, bad rects / identities, unparseable
    /// operation / preconditions). Clears local pending and forces the owned
    /// session terminal via adapter loss so no pending plan survives any
    /// `diverged` verify reply.
    fn terminal_verify_diverge(&mut self, correlation_id: String) -> String {
        self.pending = None;
        self.pending_origin = None;
        if let Some(session) = self.session.as_mut() {
            let _ = session.note_adapter_loss();
        }
        diverged(
            correlation_id,
            "postcondition-mismatch",
            "plan postconditions do not bind the pending plan",
        )
    }

    fn evaluate_verify(&mut self, raw: &serde_json::Value) -> String {
        let request: VerifyDto = match serde_json::from_value(raw.clone()) {
            Ok(request) => request,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(raw), kind, message);
            }
        };
        if request.v != RESIZE_CONTRACT_VERSION || request.action != "verify" {
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
        if request.revision > RESIZE_MAX_REVISION {
            return rejected(
                request.correlation_id.clone(),
                "revision-invalid",
                MSG_REVISION,
            );
        }
        if request.verified_geometry.is_empty()
            || request.verified_geometry.len() > RESIZE_MAX_GEOMETRY
        {
            return self.terminal_verify_diverge(request.correlation_id.clone());
        }
        for id in [
            &request.verified_focus.domain_output,
            &request.verified_focus.domain_workspace,
            &request.verified_focus.leaf,
        ] {
            if !is_opaque_id(id) {
                return self.terminal_verify_diverge(request.correlation_id.clone());
            }
        }
        for entry in &request.verified_geometry {
            if !is_opaque_id(&entry.window)
                || !is_opaque_id(&entry.leaf)
                || !is_opaque_id(&entry.output)
                || !is_opaque_id(&entry.workspace)
                || entry.rect.w <= 0
                || entry.rect.h <= 0
            {
                return self.terminal_verify_diverge(request.correlation_id.clone());
            }
        }
        {
            let mut seen = HashSet::new();
            for entry in &request.verified_geometry {
                if !seen.insert(entry.window.clone()) {
                    return self.terminal_verify_diverge(request.correlation_id.clone());
                }
            }
        }
        let Some(operation) = parse_operation(&request.verified_operation) else {
            return self.terminal_verify_diverge(request.correlation_id.clone());
        };
        let mut preconditions = Vec::with_capacity(request.verified_preconditions.len());
        for token in &request.verified_preconditions {
            let Some(pre) = precondition_token(token) else {
                return self.terminal_verify_diverge(request.correlation_id.clone());
            };
            if preconditions.contains(&pre) {
                return self.terminal_verify_diverge(request.correlation_id.clone());
            }
            preconditions.push(pre);
        }
        // Exact complete known preconditions in dispatch order.
        if preconditions.len() != EXPECTED_PRECONDITIONS.len()
            || preconditions
                .iter()
                .map(precondition_str)
                .zip(EXPECTED_PRECONDITIONS.iter())
                .any(|(got, want)| got != *want)
        {
            return self.terminal_verify_diverge(request.correlation_id.clone());
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
        let Some(pending) = self.pending.clone() else {
            // No local pending: terminally fail closed. Never delegate a
            // loosely-bound verify (caller-supplied operation/preconditions)
            // to the session; force terminal divergence instead.
            self.pending = None;
            self.pending_origin = None;
            if let Some(session) = self.session.as_mut() {
                let _ = session.note_adapter_loss();
            }
            return diverged(
                request.correlation_id.clone(),
                "postcondition-mismatch",
                "plan postconditions do not bind the pending plan",
            );
        };
        if pending.correlation != request.correlation_id {
            self.mismatched_verify_diverge(MismatchedVerify {
                correlation: correlation.clone(),
                owner: owner.clone(),
                generation: generation.clone(),
                revision: request.revision,
                fingerprint: request.fingerprint,
                preconditions,
                operation,
            });
            return diverged(
                request.correlation_id.clone(),
                "postcondition-mismatch",
                "plan postconditions do not bind the pending plan",
            );
        }
        // Exact precondition/operation binding in dispatch order.
        if preconditions != pending.preconditions || operation != pending.operation {
            self.mismatched_verify_diverge(MismatchedVerify {
                correlation: correlation.clone(),
                owner: owner.clone(),
                generation: generation.clone(),
                revision: request.revision,
                fingerprint: request.fingerprint,
                preconditions,
                operation,
            });
            return diverged(
                request.correlation_id.clone(),
                "postcondition-mismatch",
                "plan postconditions do not bind the pending plan",
            );
        }
        // Complete exact geometry binding: same windows, same leaves,
        // same domains, same positive rects.
        if request.verified_geometry.len() != pending.desired_geometry.len() {
            self.mismatched_verify_diverge(MismatchedVerify {
                correlation: correlation.clone(),
                owner: owner.clone(),
                generation: generation.clone(),
                revision: request.revision,
                fingerprint: request.fingerprint,
                preconditions,
                operation,
            });
            return diverged(
                request.correlation_id.clone(),
                "postcondition-mismatch",
                "plan postconditions do not bind the pending plan",
            );
        }
        {
            let mut want: Vec<(String, String, String, String, Rect)> = pending
                .desired_geometry
                .iter()
                .map(|g| {
                    (
                        g.window.0.clone(),
                        g.leaf.0.clone(),
                        g.output.0.clone(),
                        g.workspace.0.clone(),
                        g.rect,
                    )
                })
                .collect();
            want.sort_by(|a, b| {
                (&a.0, &a.1, &a.2, &a.3, a.4.x, a.4.y, a.4.w, a.4.h)
                    .cmp(&(&b.0, &b.1, &b.2, &b.3, b.4.x, b.4.y, b.4.w, b.4.h))
            });
            let mut got: Vec<(String, String, String, String, Rect)> = request
                .verified_geometry
                .iter()
                .map(|g| {
                    (
                        g.window.clone(),
                        g.leaf.clone(),
                        g.output.clone(),
                        g.workspace.clone(),
                        Rect {
                            x: g.rect.x,
                            y: g.rect.y,
                            w: g.rect.w,
                            h: g.rect.h,
                        },
                    )
                })
                .collect();
            got.sort_by(|a, b| {
                (&a.0, &a.1, &a.2, &a.3, a.4.x, a.4.y, a.4.w, a.4.h)
                    .cmp(&(&b.0, &b.1, &b.2, &b.3, b.4.x, b.4.y, b.4.w, b.4.h))
            });
            if want != got {
                self.mismatched_verify_diverge(MismatchedVerify {
                    correlation: correlation.clone(),
                    owner: owner.clone(),
                    generation: generation.clone(),
                    revision: request.revision,
                    fingerprint: request.fingerprint,
                    preconditions,
                    operation,
                });
                return diverged(
                    request.correlation_id.clone(),
                    "postcondition-mismatch",
                    "plan postconditions do not bind the pending plan",
                );
            }
        }
        // Complete exact focus binding: resize retains focus exactly.
        if request.verified_focus.domain_output != pending.desired_focus_domain.output.0
            || request.verified_focus.domain_workspace != pending.desired_focus_domain.workspace.0
            || request.verified_focus.leaf != pending.desired_focus_leaf.0
        {
            self.mismatched_verify_diverge(MismatchedVerify {
                correlation: correlation.clone(),
                owner: owner.clone(),
                generation: generation.clone(),
                revision: request.revision,
                fingerprint: request.fingerprint,
                preconditions,
                operation,
            });
            return diverged(
                request.correlation_id.clone(),
                "postcondition-mismatch",
                "plan postconditions do not bind the pending plan",
            );
        }
        // Work-area membership revalidation: every verified rect must be
        // contained in its session domain work area. Drift fails closed.
        if let Some(session) = self.session.as_ref() {
            for entry in &request.verified_geometry {
                let key = DomainKey {
                    output: OutputId(entry.output.clone()),
                    workspace: WorkspaceId(entry.workspace.clone()),
                };
                let Some(domain) = session.domains().iter().find(|d| d.key() == key) else {
                    self.mismatched_verify_diverge(MismatchedVerify {
                        correlation: correlation.clone(),
                        owner: owner.clone(),
                        generation: generation.clone(),
                        revision: request.revision,
                        fingerprint: request.fingerprint,
                        preconditions,
                        operation,
                    });
                    return diverged(
                        request.correlation_id.clone(),
                        "postcondition-mismatch",
                        "plan postconditions do not bind the pending plan",
                    );
                };
                if !rect_contained(
                    Rect {
                        x: entry.rect.x,
                        y: entry.rect.y,
                        w: entry.rect.w,
                        h: entry.rect.h,
                    },
                    domain.bounds,
                ) {
                    self.mismatched_verify_diverge(MismatchedVerify {
                        correlation: correlation.clone(),
                        owner: owner.clone(),
                        generation: generation.clone(),
                        revision: request.revision,
                        fingerprint: request.fingerprint,
                        preconditions,
                        operation,
                    });
                    return diverged(
                        request.correlation_id.clone(),
                        "postcondition-mismatch",
                        "plan postconditions do not bind the pending plan",
                    );
                }
            }
        }
        // Bind the post-observation fingerprint exactly to the deterministic
        // observation (desired focus domain + focused window + known ids).
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
            let expected_post = resize_fingerprint(
                &pending.desired_focus_domain.output.0,
                &pending.desired_focus_domain.workspace.0,
                &pending.focused_window,
                &known,
            );
            if request.fingerprint != expected_post {
                self.mismatched_verify_diverge(MismatchedVerify {
                    correlation: correlation.clone(),
                    owner: owner.clone(),
                    generation: generation.clone(),
                    revision: request.revision,
                    fingerprint: request.fingerprint,
                    preconditions,
                    operation,
                });
                return diverged(
                    request.correlation_id.clone(),
                    "postcondition-mismatch",
                    "plan postconditions do not bind the pending plan",
                );
            }
        }
        let post = ResizePostObservation::new(
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
        match session.verify_resize(&post) {
            Ok(commit) => {
                self.pending = None;
                self.pending_origin = None;
                serialize_bounded(&ResizeReply {
                    v: RESIZE_CONTRACT_VERSION,
                    correlation_id: request.correlation_id.clone(),
                    outcome: "committed",
                    kind: None,
                    message: None,
                    base_revision: None,
                    revision: Some(commit.revision),
                    capability: None,
                    preconditions: None,
                    operation: None,
                    desired_geometry: None,
                    desired_focus: None,
                })
            }
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
            Err(crate::reconcile::VerifyError::Diverged(reason)) => {
                self.pending = None;
                self.pending_origin = None;
                diverged(
                    request.correlation_id.clone(),
                    reason.as_str(),
                    reason.message(),
                )
            }
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
        if request.v != RESIZE_CONTRACT_VERSION || request.action != "note-loss" {
            return rejected(
                valid_correlation_echo(raw),
                "unsupported-version",
                MSG_VERSION,
            );
        }
        let Some(session) = self.session.as_mut() else {
            return diverged("".to_owned(), "adapter-lost", "adapter reported loss");
        };
        self.pending = None;
        self.pending_origin = None;
        let reason = session.note_adapter_loss();
        diverged(String::new(), reason.as_str(), reason.message())
    }
}
