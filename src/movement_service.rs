//! Bounded static movement transaction service (product-shaped, static only).
//!
//! Narrow JSON request/action protocol over the portable [`crate::session`]
//! movement plan (`cosmic_v1` R1-R4) and [`crate::reconcile`]
//! acknowledgement model. Rust owns normalized domains, move intent,
//! capabilities, preconditions, revision binding, and reconciliation; KWin
//! owns observation, native mapping, revalidation, native moves, and
//! post-observation. No native execution, persistence, or transport here:
//! this module is pure JSON-string-in / JSON-string-out over an owned
//! [`Session`].
//!
//! Actions (`action` field, `v == 1`):
//! - `request`: propose directional movement for one exact opaque
//!   `(domain, focused window, direction)` against a complete normalized
//!   observation. Replies `planned` with the bound dispatch/operation,
//!   complete desired geometry/focus, `noop` for planner noops, or
//!   `rejected`/`diverged` fail-closed.
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
//!
//! Session sharing: this service owns one portable [`Session`] seeded from
//! the first strict normalized `request`. Without `domains` it seeds one
//! fixed-geometry domain (R1-R3); with strict `domains` it seeds explicit
//! portable domains with real work-area bounds/gap/reciprocal same-workspace
//! adjacency (R4). The focus and movement services intentionally do not share
//! a `Session` instance: each owns single-pending reconciler state, and
//! sharing would require a broad ownership refactor. The
//! owner/generation/correlation/revision boundary, deterministic fingerprint
//! binding, and seeding discipline are reused as far as the current
//! architecture permits; no generic IPC is introduced. Every `diverged`
//! `verify` reply terminally diverges the owned session and clears pending.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::contract::{AckOutcome, AdapterAck, Observation, PostObservation};
use crate::directional::{
    Axis, Capability, CrossOutputTarget, Direction, EscapeContinuation, FocusedSide, Insertion,
    NodeId, OutputId, Precondition, Rule, WindowId, WorkspaceId,
};
use crate::focus_service::focus_fingerprint;
use crate::geometry::Rect;
use crate::ids::{CorrelationId, GenerationId, OwnerId};
use crate::session::{
    DesiredGeometry, DomainKey, ExceptionFlags, ObservedWindow, OutputDomain, ProposeError,
    Session, SessionCommand, SessionObservation,
};

/// Movement transaction contract version (JSON string v1).
pub const MOVEMENT_CONTRACT_VERSION: u32 = 1;
/// Bounded request cap.
pub const MOVEMENT_MAX_REQUEST_BYTES: usize = 64 * 1024;
/// Bounded reply cap.
pub const MOVEMENT_MAX_REPLY_BYTES: usize = 64 * 1024;
/// Opaque id bound.
pub const MOVEMENT_MAX_ID_LEN: usize = 128;
/// Observed window bound.
pub const MOVEMENT_MAX_WINDOWS: usize = 64;
/// Geometry entry bound (mirrors window bound).
pub const MOVEMENT_MAX_GEOMETRY: usize = 64;
/// Seen-correlation bound.
pub const MOVEMENT_MAX_SEEN: usize = 2048;
/// Revision bound (inclusive, shared with contract).
pub const MOVEMENT_MAX_REVISION: u64 = 1_000_000;

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
const MSG_SESSION_FULL: &str = "movement session correlation bound was reached";

/// Deterministic bounded observation fingerprint, reusing the focus adapter
/// binding exactly (FNV-1a over `output\x1fworkspace\x1ffocused\x1fids...`).
#[must_use]
pub fn movement_fingerprint(
    domain_output: &str,
    domain_workspace: &str,
    focused: &str,
    sorted_ids: &[String],
) -> u64 {
    focus_fingerprint(domain_output, domain_workspace, focused, sorted_ids)
}

/// Fixed deterministic fallback geometry for legacy single-domain seeding
/// without an explicit `domains` vector (no JS topology, no native fields).
/// Multi-domain R4 seeding uses the real native work-area bounds/gap carried
/// in the strict first `request` instead; desired geometry always projects
/// from the owned session domains.
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
        && value.len() <= MOVEMENT_MAX_ID_LEN
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

fn rule_str(value: Rule) -> &'static str {
    match value {
        Rule::R1 => "R1",
        Rule::R2a => "R2a",
        Rule::R2b => "R2b",
        Rule::R2c => "R2c",
        Rule::R3 => "R3",
        Rule::R4 => "R4",
    }
}

fn parse_rule(value: &str) -> Option<Rule> {
    match value {
        "R1" => Some(Rule::R1),
        "R2a" => Some(Rule::R2a),
        "R2b" => Some(Rule::R2b),
        "R2c" => Some(Rule::R2c),
        "R3" => Some(Rule::R3),
        "R4" => Some(Rule::R4),
        _ => None,
    }
}

fn capability_str(value: Capability) -> &'static str {
    match value {
        Capability::SwapNeighbor => "swap-neighbor",
        Capability::WrapPerpendicular => "wrap-perpendicular",
        Capability::WrapSiblings => "wrap-siblings",
        Capability::InsertChild => "insert-child",
        Capability::SplitGroupChild => "split-group-child",
        Capability::ReparentLeaf => "reparent-leaf",
        Capability::CrossOutputTransfer => "cross-output-transfer",
    }
}

fn precondition_str(value: Precondition) -> &'static str {
    match value {
        Precondition::FocusedLeafOccupiedByFocusedWindow => {
            "focused-leaf-occupied-by-focused-window"
        }
        Precondition::NeighborLeafOccupied => "neighbor-leaf-occupied",
        Precondition::ContainerIsDirectParent => "container-is-direct-parent",
        Precondition::TargetGroupMembership => "target-group-membership",
        Precondition::ParentGroupMembership => "parent-group-membership",
        Precondition::SourceRootMembershipAndAdjacentSameWorkspaceOutput => {
            "source-root-membership-and-adjacent-same-workspace-output"
        }
        Precondition::AdapterMustVerifyPostconditions => "adapter-must-verify-postconditions",
    }
}

fn parse_precondition(value: &str) -> Option<Precondition> {
    match value {
        "focused-leaf-occupied-by-focused-window" => {
            Some(Precondition::FocusedLeafOccupiedByFocusedWindow)
        }
        "neighbor-leaf-occupied" => Some(Precondition::NeighborLeafOccupied),
        "container-is-direct-parent" => Some(Precondition::ContainerIsDirectParent),
        "target-group-membership" => Some(Precondition::TargetGroupMembership),
        "parent-group-membership" => Some(Precondition::ParentGroupMembership),
        "source-root-membership-and-adjacent-same-workspace-output" => {
            Some(Precondition::SourceRootMembershipAndAdjacentSameWorkspaceOutput)
        }
        "adapter-must-verify-postconditions" => Some(Precondition::AdapterMustVerifyPostconditions),
        _ => None,
    }
}

fn parse_axis(value: &str) -> Option<Axis> {
    match value {
        "horizontal" => Some(Axis::Horizontal),
        "vertical" => Some(Axis::Vertical),
        _ => None,
    }
}

fn axis_str(value: Axis) -> &'static str {
    match value {
        Axis::Horizontal => "horizontal",
        Axis::Vertical => "vertical",
    }
}

fn get_str(obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<String> {
    obj.get(key)?.as_str().map(ToOwned::to_owned)
}

fn get_usize(obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<usize> {
    obj.get(key)?.as_u64()?.try_into().ok()
}

fn get_bool(obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<bool> {
    obj.get(key)?.as_bool()
}

fn operation_to_value(op: &crate::directional::MoveOperation) -> serde_json::Value {
    use crate::directional::MoveOperation as O;
    match op {
        O::WrapPerpendicular {
            rule,
            container,
            axis,
        } => serde_json::json!({
            "kind": "WrapPerpendicular",
            "rule": rule_str(*rule),
            "container": container.0,
            "axis": axis_str(*axis),
        }),
        O::SwapNeighbor {
            rule,
            container,
            neighbor,
        } => serde_json::json!({
            "kind": "SwapNeighbor",
            "rule": rule_str(*rule),
            "container": container.0,
            "neighbor": neighbor.0,
        }),
        O::InsertIntoGroup {
            rule,
            container,
            target_group,
            insertion_index,
            insertion,
        } => {
            serde_json::json!({
                "kind": "InsertIntoGroup",
                "rule": rule_str(*rule),
                "container": container.0,
                "target_group": target_group.0,
                "insertion_index": insertion_index,
                "insertion": match insertion {
                    Insertion::Midpoint => "midpoint",
                    Insertion::NearEdge => "near-edge",
                },
            })
        }
        O::SplitGroupChild {
            rule,
            container,
            target_group,
            target_child,
            target_child_index,
            focused_side,
            axis,
        } => {
            serde_json::json!({
                "kind": "SplitGroupChild",
                "rule": rule_str(*rule),
                "container": container.0,
                "target_group": target_group.0,
                "target_child": target_child.0,
                "target_child_index": target_child_index,
                "focused_side": match focused_side {
                    FocusedSide::First => "first",
                    FocusedSide::Second => "second",
                },
                "axis": axis_str(*axis),
            })
        }
        O::WrapNeighbor {
            rule,
            container,
            neighbor,
            focused_before_neighbor,
            axis,
        } => {
            serde_json::json!({
                "kind": "WrapNeighbor",
                "rule": rule_str(*rule),
                "container": container.0,
                "neighbor": neighbor.0,
                "focused_before_neighbor": focused_before_neighbor,
                "axis": axis_str(*axis),
            })
        }
        O::EscapeParent {
            rule,
            container,
            parent,
            container_child_index,
            parent_insertion_index,
            continuation,
        } => {
            serde_json::json!({
                "kind": "EscapeParent",
                "rule": rule_str(*rule),
                "container": container.0,
                "parent": parent.0,
                "container_child_index": container_child_index,
                "parent_insertion_index": parent_insertion_index,
                "continuation": match continuation {
                    EscapeContinuation::None => "none",
                    EscapeContinuation::R1 => "R1",
                },
            })
        }
        O::CrossOutput {
            rule,
            target_output,
            source_root_child_index,
            target,
        } => {
            serde_json::json!({
                "kind": "CrossOutput",
                "rule": rule_str(*rule),
                "target_output": target_output.0,
                "source_root_child_index": source_root_child_index,
                "target": match target {
                    CrossOutputTarget::Empty => "empty",
                    CrossOutputTarget::Occupied => "occupied",
                },
            })
        }
    }
}

fn parse_operation(value: &serde_json::Value) -> Option<crate::directional::MoveOperation> {
    use crate::directional::MoveOperation as O;
    let obj = value.as_object()?;
    let kind = obj.get("kind")?.as_str()?;
    let rule = parse_rule(obj.get("rule")?.as_str()?)?;
    let opaque = |key: &str| -> Option<String> {
        let v = get_str(obj, key)?;
        if is_opaque_id(&v) { Some(v) } else { None }
    };
    let keys: std::collections::BTreeSet<&str> = obj.keys().map(String::as_str).collect();
    let exact = |want: &[&str]| -> bool {
        keys.len() == want.len() && want.iter().all(|k| keys.contains(k))
    };
    match kind {
        "WrapPerpendicular" => {
            if !exact(&["kind", "rule", "container", "axis"]) {
                return None;
            }
            Some(O::WrapPerpendicular {
                rule,
                container: NodeId(opaque("container")?),
                axis: parse_axis(obj.get("axis")?.as_str()?)?,
            })
        }
        "SwapNeighbor" => {
            if !exact(&["kind", "rule", "container", "neighbor"]) {
                return None;
            }
            Some(O::SwapNeighbor {
                rule,
                container: NodeId(opaque("container")?),
                neighbor: NodeId(opaque("neighbor")?),
            })
        }
        "InsertIntoGroup" => {
            if !exact(&[
                "kind",
                "rule",
                "container",
                "target_group",
                "insertion_index",
                "insertion",
            ]) {
                return None;
            }
            let insertion = match obj.get("insertion")?.as_str()? {
                "midpoint" => Insertion::Midpoint,
                "near-edge" => Insertion::NearEdge,
                _ => return None,
            };
            Some(O::InsertIntoGroup {
                rule,
                container: NodeId(opaque("container")?),
                target_group: NodeId(opaque("target_group")?),
                insertion_index: get_usize(obj, "insertion_index")?,
                insertion,
            })
        }
        "SplitGroupChild" => {
            if !exact(&[
                "kind",
                "rule",
                "container",
                "target_group",
                "target_child",
                "target_child_index",
                "focused_side",
                "axis",
            ]) {
                return None;
            }
            let focused_side = match obj.get("focused_side")?.as_str()? {
                "first" => FocusedSide::First,
                "second" => FocusedSide::Second,
                _ => return None,
            };
            Some(O::SplitGroupChild {
                rule,
                container: NodeId(opaque("container")?),
                target_group: NodeId(opaque("target_group")?),
                target_child: NodeId(opaque("target_child")?),
                target_child_index: get_usize(obj, "target_child_index")?,
                focused_side,
                axis: parse_axis(obj.get("axis")?.as_str()?)?,
            })
        }
        "WrapNeighbor" => {
            if !exact(&[
                "kind",
                "rule",
                "container",
                "neighbor",
                "focused_before_neighbor",
                "axis",
            ]) {
                return None;
            }
            Some(O::WrapNeighbor {
                rule,
                container: NodeId(opaque("container")?),
                neighbor: NodeId(opaque("neighbor")?),
                focused_before_neighbor: get_bool(obj, "focused_before_neighbor")?,
                axis: parse_axis(obj.get("axis")?.as_str()?)?,
            })
        }
        "EscapeParent" => {
            if !exact(&[
                "kind",
                "rule",
                "container",
                "parent",
                "container_child_index",
                "parent_insertion_index",
                "continuation",
            ]) {
                return None;
            }
            let parent_insertion_index = match obj.get("parent_insertion_index")? {
                serde_json::Value::Null => None,
                serde_json::Value::Number(n) => Some(n.as_u64()?.try_into().ok()?),
                _ => return None,
            };
            let continuation = match obj.get("continuation")?.as_str()? {
                "none" => EscapeContinuation::None,
                "R1" => EscapeContinuation::R1,
                _ => return None,
            };
            Some(O::EscapeParent {
                rule,
                container: NodeId(opaque("container")?),
                parent: NodeId(opaque("parent")?),
                container_child_index: get_usize(obj, "container_child_index")?,
                parent_insertion_index,
                continuation,
            })
        }
        "CrossOutput" => {
            if !exact(&[
                "kind",
                "rule",
                "target_output",
                "source_root_child_index",
                "target",
            ]) {
                return None;
            }
            let target = match obj.get("target")?.as_str()? {
                "empty" => CrossOutputTarget::Empty,
                "occupied" => CrossOutputTarget::Occupied,
                _ => return None,
            };
            Some(O::CrossOutput {
                rule,
                target_output: OutputId(opaque("target_output")?),
                source_root_child_index: get_usize(obj, "source_root_child_index")?,
                target,
            })
        }
        _ => None,
    }
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
    swap_neighbor: bool,
    wrap_perpendicular: bool,
    wrap_siblings: bool,
    insert_child: bool,
    split_group_child: bool,
    reparent_leaf: bool,
    cross_output_transfer: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct SeedBoundsDto {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct SeedDomainDto {
    output: String,
    workspace: String,
    bounds: SeedBoundsDto,
    gap: i32,
    #[serde(default)]
    adjacent: std::collections::BTreeMap<String, String>,
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
    #[serde(default)]
    domains: Option<Vec<SeedDomainDto>>,
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
struct MoveReply {
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
    rule: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preconditions: Option<Vec<&'static str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    desired_geometry: Option<Vec<GeometryReply>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    desired_focus: Option<FocusReplyBody>,
}

fn serialize_bounded(reply: &MoveReply) -> String {
    match serde_json::to_string(reply) {
        Ok(text) if text.len() <= MOVEMENT_MAX_REPLY_BYTES => text,
        _ => "{\"v\":1,\"correlation_id\":\"\",\"outcome\":\"rejected\",\"kind\":\"snapshot-invalid\",\"message\":\"snapshot or intent is malformed\"}"
            .to_owned(),
    }
}

fn rejected(correlation_id: String, kind: &'static str, message: &'static str) -> String {
    serialize_bounded(&MoveReply {
        v: MOVEMENT_CONTRACT_VERSION,
        correlation_id,
        outcome: "rejected",
        kind: Some(kind),
        message: Some(message),
        base_revision: None,
        revision: None,
        capability: None,
        rule: None,
        preconditions: None,
        operation: None,
        desired_geometry: None,
        desired_focus: None,
    })
}

fn diverged(correlation_id: String, kind: &'static str, message: &'static str) -> String {
    serialize_bounded(&MoveReply {
        v: MOVEMENT_CONTRACT_VERSION,
        correlation_id,
        outcome: "diverged",
        kind: Some(kind),
        message: Some(message),
        base_revision: None,
        revision: None,
        capability: None,
        rule: None,
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
struct PendingMovement {
    correlation: String,
    focused_window: String,
    operation: crate::directional::MoveOperation,
    preconditions: Vec<Precondition>,
    desired_geometry: Vec<DesiredGeometry>,
    desired_focus_domain: DomainKey,
    desired_focus_leaf: NodeId,
}

struct MismatchedVerify {
    correlation: CorrelationId,
    owner: OwnerId,
    generation: GenerationId,
    revision: u64,
    fingerprint: u64,
    preconditions: Vec<Precondition>,
    operation: crate::directional::MoveOperation,
}

/// Bounded static movement transaction service over an owned [`Session`].
///
/// Owns/creates the single portable [`Session`] from the first strict
/// normalized `request` (Rust-only deterministic admission order; no JS
/// topology, no native fields). The first request either carries no `domains`
/// field for legacy single-domain R1-R3 seeding (fixed geometry) or carries
/// an explicit strict `domains` vector for R4 seeding with real native
/// work-area bounds/gap/reciprocal same-workspace adjacency. Changed
/// membership after seeding is rejected without divergence. Single session,
/// single pending via the session/reconciler. Single-use correlations
/// (bounded seen set); the session itself enforces
/// owner/generation/revision/pending binding and terminal divergence. Seen
/// exhaustion diverges fail-closed.
#[derive(Debug)]
pub struct MovementService {
    session: Option<Session>,
    seen: HashSet<String>,
    pending: Option<PendingMovement>,
}

impl Default for MovementService {
    fn default() -> Self {
        Self::new()
    }
}

impl MovementService {
    /// Fresh unseeded service. The first strict `request` seeds the owned
    /// session; until then there is no pending and revision mirrors 0.
    #[must_use]
    pub fn new() -> Self {
        Self {
            session: None,
            seen: HashSet::new(),
            pending: None,
        }
    }

    /// Wrap an already-seeded session (domains/topology/focus owned by Rust).
    /// Used by portable tests; production D-Bus ownership uses [`Self::new`].
    #[must_use]
    pub fn with_session(session: Session) -> Self {
        Self {
            session: Some(session),
            seen: HashSet::new(),
            pending: None,
        }
    }

    /// Borrow the owned session. Panics when unseeded; use
    /// [`Self::session_opt`] for the unseeded case.
    #[must_use]
    pub fn session(&self) -> &Session {
        self.session.as_ref().expect("movement session is seeded")
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

    /// Strict JSON-only movement transaction. Always returns a bounded reply.
    pub fn evaluate_json(&mut self, request_json: &str) -> String {
        if request_json.len() > MOVEMENT_MAX_REQUEST_BYTES {
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
        if self.seen.len() >= MOVEMENT_MAX_SEEN {
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
        movement_fingerprint(
            domain_output,
            domain_workspace,
            focused,
            &Self::sorted_ids(windows),
        )
    }

    /// Deterministic Rust-only seeding from the first strict normalized
    /// request. Without `domains`, seeds one fixed-geometry domain for
    /// single-domain R1-R3; with `domains`, seeds explicit portable domains
    /// with real work-area bounds/gap/reciprocal same-workspace adjacency
    /// for R4. Admits sorted windows with the focused window last so session
    /// focus equals the request focus. Uses existing [`Session`] lifecycle
    /// admit/acknowledge/verify APIs only. First request revision must
    /// exactly equal the normalized observed membership size (`windows.len()`,
    /// hence the post-seed base N); any other explicit revision is rejected
    /// without seeding. Changed membership afterwards is rejected by the
    /// caller, never reseeded. Domain shape uses portable
    /// [`OutputDomain::validate`]; cross-domain reciprocal/known/same-workspace
    /// adjacency is enforced by [`Session::new`], never reimplemented here.
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
            return Err("initial movement request must carry revision N".to_owned());
        }
        if windows.is_empty() || windows.len() > MOVEMENT_MAX_WINDOWS {
            return Err(MSG_OBSERVATION.to_owned());
        }
        if !windows.iter().any(|w| w.window == focused) {
            return Err(MSG_OBSERVATION.to_owned());
        }
        let expected =
            Self::expected_request_fingerprint(domain_output, domain_workspace, focused, windows);
        if fingerprint != expected {
            return Err(MSG_OBSERVATION.to_owned());
        }
        // Focused entry must live in the request source domain; other entries
        // may span adjacent same-workspace domains (R4). Unknown domains and
        // completeness are enforced below and by the session layer.
        if !windows.iter().any(|w| {
            w.window == focused && w.output == domain_output && w.workspace == domain_workspace
        }) {
            return Err(MSG_OBSERVATION.to_owned());
        }
        let domains: Vec<OutputDomain> = match &request.domains {
            None => {
                for entry in windows {
                    if entry.output != domain_output || entry.workspace != domain_workspace {
                        return Err(MSG_OBSERVATION.to_owned());
                    }
                }
                vec![OutputDomain {
                    id: OutputId(domain_output.to_owned()),
                    workspace: WorkspaceId(domain_workspace.to_owned()),
                    bounds: SEED_BOUNDS,
                    gap: 0,
                    adjacent: std::collections::BTreeMap::new(),
                }]
            }
            Some(seeds) => Self::parse_seed_domains(seeds)?,
        };
        if let Some(seeds) = &request.domains {
            let _ = seeds;
            let known: std::collections::BTreeSet<(String, String)> = domains
                .iter()
                .map(|d| (d.id.0.clone(), d.workspace.0.clone()))
                .collect();
            if !known.contains(&(domain_output.to_owned(), domain_workspace.to_owned())) {
                return Err(MSG_OBSERVATION.to_owned());
            }
            for entry in windows {
                if !known.contains(&(entry.output.clone(), entry.workspace.clone())) {
                    return Err(MSG_OBSERVATION.to_owned());
                }
            }
        }
        let mut session = Session::new(owner.clone(), generation.clone(), 0, fingerprint, domains)
            .map_err(|_| MSG_OBSERVATION.to_owned())?;
        let placement: std::collections::BTreeMap<String, (String, String)> = windows
            .iter()
            .map(|w| (w.window.clone(), (w.output.clone(), w.workspace.clone())))
            .collect();
        let mut ordered: Vec<String> = Self::sorted_ids(windows);
        ordered.retain(|id| id != focused);
        ordered.push(focused.to_owned());
        for (index, window) in ordered.iter().enumerate() {
            let (output, workspace) = placement
                .get(window)
                .ok_or_else(|| MSG_OBSERVATION.to_owned())?;
            Self::admit_seed_window(
                &mut session,
                owner,
                generation,
                window,
                output,
                workspace,
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
        self.session = Some(session);
        Ok(())
    }

    fn parse_seed_domains(seeds: &[SeedDomainDto]) -> Result<Vec<OutputDomain>, String> {
        use crate::session::MAX_DOMAINS;
        if seeds.is_empty() || seeds.len() > MAX_DOMAINS {
            return Err(MSG_OBSERVATION.to_owned());
        }
        let mut out = Vec::with_capacity(seeds.len());
        let mut seen = std::collections::BTreeSet::new();
        for seed in seeds {
            if !is_opaque_id(&seed.output)
                || !is_opaque_id(&seed.workspace)
                || seed.adjacent.len() > 4
            {
                return Err(MSG_OBSERVATION.to_owned());
            }
            if !seen.insert((seed.output.clone(), seed.workspace.clone())) {
                return Err(MSG_OBSERVATION.to_owned());
            }
            let mut adjacent = std::collections::BTreeMap::new();
            for (dir_text, target_text) in &seed.adjacent {
                let Some(direction) = parse_direction(dir_text) else {
                    return Err(MSG_OBSERVATION.to_owned());
                };
                if !is_opaque_id(target_text) || target_text == &seed.output {
                    return Err(MSG_OBSERVATION.to_owned());
                }
                if adjacent
                    .insert(direction, OutputId(target_text.clone()))
                    .is_some()
                {
                    return Err(MSG_OBSERVATION.to_owned());
                }
            }
            let domain = OutputDomain {
                id: OutputId(seed.output.clone()),
                workspace: WorkspaceId(seed.workspace.clone()),
                bounds: Rect {
                    x: seed.bounds.x,
                    y: seed.bounds.y,
                    w: seed.bounds.w,
                    h: seed.bounds.h,
                },
                gap: seed.gap,
                adjacent,
            };
            if !domain.validate() {
                return Err(MSG_OBSERVATION.to_owned());
            }
            out.push(domain);
        }
        Ok(out)
    }

    fn seed_domains_match_session(seeds: &[SeedDomainDto], session: &Session) -> bool {
        let parsed = match Self::parse_seed_domains(seeds) {
            Ok(domains) => domains,
            Err(_) => return false,
        };
        if parsed.len() != session.domains().len() {
            return false;
        }
        let mut want: Vec<OutputDomain> = parsed;
        want.sort_by(|a, b| {
            (a.id.0.clone(), a.workspace.0.clone()).cmp(&(b.id.0.clone(), b.workspace.0.clone()))
        });
        let mut got: Vec<OutputDomain> = session.domains().to_vec();
        got.sort_by(|a, b| {
            (a.id.0.clone(), a.workspace.0.clone()).cmp(&(b.id.0.clone(), b.workspace.0.clone()))
        });
        want == got
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
        if request.v != MOVEMENT_CONTRACT_VERSION || request.action != "request" {
            let (kind, message) = if request.v != MOVEMENT_CONTRACT_VERSION {
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
        if request.revision > MOVEMENT_MAX_REVISION {
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
        if request.windows.is_empty() || request.windows.len() > MOVEMENT_MAX_WINDOWS {
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
        // The focused entry must live in the request source domain;
        // other entries may span adjacent same-workspace domains (R4).
        // Unknown domains and completeness are enforced below and by the
        // session layer.
        if !request.windows.iter().any(|w| {
            w.window == request.focused_window
                && w.output == request.domain.output
                && w.workspace == request.domain.workspace
        }) {
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
        // Reject changed membership after seeding without divergence. The
        // request must carry the complete known tiled-plus-exception set;
        // R4 focus-domain changes are allowed (no domain pinning), only the
        // membership set is pinned. The session layer re-enforces
        // completeness and refuses partial observations. A strict `domains`
        // vector on later requests must exactly match the owned session
        // domains; mismatched topology is rejected fail-closed.
        if let Some(session) = self.session.as_ref() {
            if let Some(seeds) = &request.domains
                && !Self::seed_domains_match_session(seeds, session)
            {
                return rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    MSG_OBSERVATION,
                );
            }
            let mut current = Self::sorted_ids(&request.windows);
            current.sort();
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
                // Membership pins via the live known set for both production
                // seeding and wrapped test sessions. Requires exact complete
                // membership.
                if current != known {
                    return rejected(
                        request.correlation_id.clone(),
                        "snapshot-invalid",
                        MSG_OBSERVATION,
                    );
                }
            }
        }
        let domain = DomainKey {
            output: OutputId(request.domain.output.clone()),
            workspace: WorkspaceId(request.domain.workspace.clone()),
        };
        let window = WindowId(request.focused_window.clone());
        // Complete session observation: the request windows are the full
        // known set (enforced above); pass through directly so partial
        // observations fail closed in the session layer.
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
        let caps = crate::directional::Capabilities {
            swap_neighbor: request.capabilities.swap_neighbor,
            wrap_perpendicular: request.capabilities.wrap_perpendicular,
            wrap_siblings: request.capabilities.wrap_siblings,
            insert_child: request.capabilities.insert_child,
            split_group_child: request.capabilities.split_group_child,
            reparent_leaf: request.capabilities.reparent_leaf,
            cross_output_transfer: request.capabilities.cross_output_transfer,
        };
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
        match session.propose_move(
            &domain,
            &window,
            direction,
            &observation,
            &correlation,
            &caps,
        ) {
            Ok(plan) => {
                let rule = rule_str(plan.dispatch.rule);
                let capability = capability_str(plan.dispatch.required_capability);
                let preconditions: Vec<&'static str> = plan
                    .dispatch
                    .preconditions
                    .iter()
                    .map(|p| precondition_str(*p))
                    .collect();
                let operation = operation_to_value(&plan.dispatch.operation);
                let desired_geometry: Vec<GeometryReply> =
                    plan.desired_geometry.iter().map(geometry_reply).collect();
                let desired_focus = FocusReplyBody {
                    domain_output: plan.desired_focus_domain.output.0.clone(),
                    domain_workspace: plan.desired_focus_domain.workspace.0.clone(),
                    leaf: plan.desired_focus_leaf.0.clone(),
                };
                self.pending = Some(PendingMovement {
                    correlation: request.correlation_id.clone(),
                    focused_window: request.focused_window.clone(),
                    operation: plan.dispatch.operation.clone(),
                    preconditions: plan.dispatch.preconditions.clone(),
                    desired_geometry: plan.desired_geometry.clone(),
                    desired_focus_domain: plan.desired_focus_domain.clone(),
                    desired_focus_leaf: plan.desired_focus_leaf.clone(),
                });
                serialize_bounded(&MoveReply {
                    v: MOVEMENT_CONTRACT_VERSION,
                    correlation_id: request.correlation_id.clone(),
                    outcome: "planned",
                    kind: None,
                    message: None,
                    base_revision: Some(plan.dispatch.base_revision),
                    revision: None,
                    capability: Some(capability),
                    rule: Some(rule),
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
                diverged(
                    request.correlation_id.clone(),
                    reason.as_str(),
                    reason.message(),
                )
            }
            Err(ProposeError::Refused(kind)) => {
                if kind.as_str() == "planner-noop" {
                    let revision = self.accepted_revision();
                    serialize_bounded(&MoveReply {
                        v: MOVEMENT_CONTRACT_VERSION,
                        correlation_id: request.correlation_id.clone(),
                        outcome: "noop",
                        kind: Some(kind.as_str()),
                        message: Some(kind.message()),
                        base_revision: None,
                        revision: Some(revision),
                        capability: None,
                        rule: None,
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
        if request.v != MOVEMENT_CONTRACT_VERSION || request.action != "acknowledge" {
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
        if request.base_revision > MOVEMENT_MAX_REVISION {
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
            Ok(_) => serialize_bounded(&MoveReply {
                v: MOVEMENT_CONTRACT_VERSION,
                correlation_id: request.correlation_id.clone(),
                outcome: "acknowledged",
                kind: None,
                message: None,
                base_revision: Some(request.base_revision),
                revision: None,
                capability: None,
                rule: None,
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
        let post = PostObservation::new(
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
            let _ = session.verify_move(&post);
            // `verify_move` with no pending or a not-acknowledged plan does
            // not diverge; malformed verify reports must still be terminal.
            if session.divergence().is_none() {
                let _ = session.note_adapter_loss();
            }
        }
        self.pending = None;
    }

    /// Terminal divergence for structurally invalid verify reports (empty /
    /// oversize / duplicate geometry, bad rects / identities, unparseable
    /// operation / preconditions). Clears local pending and forces the owned
    /// session terminal via adapter loss so no pending plan survives any
    /// `diverged` verify reply.
    fn terminal_verify_diverge(&mut self, correlation_id: String) -> String {
        self.pending = None;
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
        if request.v != MOVEMENT_CONTRACT_VERSION || request.action != "verify" {
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
        if request.revision > MOVEMENT_MAX_REVISION {
            return rejected(
                request.correlation_id.clone(),
                "revision-invalid",
                MSG_REVISION,
            );
        }
        if request.verified_geometry.is_empty()
            || request.verified_geometry.len() > MOVEMENT_MAX_GEOMETRY
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
            let Some(pre) = parse_precondition(token) else {
                return self.terminal_verify_diverge(request.correlation_id.clone());
            };
            if preconditions.contains(&pre) {
                return self.terminal_verify_diverge(request.correlation_id.clone());
            }
            preconditions.push(pre);
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
            // No cached plan: let the session classify (no-pending vs
            // terminal divergence).
            let Some(session) = self.session.as_mut() else {
                return rejected(
                    request.correlation_id.clone(),
                    "no-pending",
                    "no pending plan awaits verification",
                );
            };
            let post = PostObservation::new(
                Observation::new(owner, generation, request.revision, request.fingerprint),
                correlation,
                request.verified,
                preconditions,
                operation,
            );
            return match session.verify_move(&post) {
                Ok(commit) => serialize_bounded(&MoveReply {
                    v: MOVEMENT_CONTRACT_VERSION,
                    correlation_id: request.correlation_id.clone(),
                    outcome: "committed",
                    kind: None,
                    message: None,
                    base_revision: None,
                    revision: Some(commit.revision),
                    capability: None,
                    rule: None,
                    preconditions: None,
                    operation: None,
                    desired_geometry: None,
                    desired_focus: None,
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
            };
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
        // Complete exact focus binding.
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
        // Bind the post-observation fingerprint exactly to the deterministic
        // observation (desired focus domain + mover window + known ids).
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
            let expected_post = movement_fingerprint(
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
        let post = PostObservation::new(
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
        match session.verify_move(&post) {
            Ok(commit) => {
                self.pending = None;
                serialize_bounded(&MoveReply {
                    v: MOVEMENT_CONTRACT_VERSION,
                    correlation_id: request.correlation_id.clone(),
                    outcome: "committed",
                    kind: None,
                    message: None,
                    base_revision: None,
                    revision: Some(commit.revision),
                    capability: None,
                    rule: None,
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
        if request.v != MOVEMENT_CONTRACT_VERSION || request.action != "note-loss" {
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
        let reason = session.note_adapter_loss();
        diverged(String::new(), reason.as_str(), reason.message())
    }
}
