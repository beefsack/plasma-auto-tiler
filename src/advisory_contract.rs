//! Slice 3 read-only advisory plan boundary (production-shaped, v1).
//!
//! Pure JSON-string-in / JSON-string-out contract over the portable
//! [`crate::cosmic_v1`] core. Exactly three normalized opaque windows per
//! request, strict bounded schema/cardinality/size, and
//! owner/generation/revision/correlation binding through the in-memory
//! [`AdvisorySession`] tracker. Replies are deterministic advisory plans with
//! no native command/execution fields and no mutation: the verified revision
//! never advances and successful replies only echo the validated request
//! binding.
//!
//! Wire rejects (fixed redacted strings, input never echoed except a valid
//! correlation id): oversized, malformed, unknown field/value, wrong schema
//! version, invalid correlation/owner/generation/revision shape, invalid
//! snapshot (including window count != 3), unsupported capabilities, stale
//! revision, generation/owner mismatch, and duplicate-correlation mismatch.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::directional::{
    Axis, Capabilities, Capability, CrossOutputTarget, Direction, EscapeContinuation, FocusedSide,
    Insertion, MoveIntent, MoveOperation, Node, NodeId, Output, OutputId, Precondition,
    RejectionKind, Rule, Snapshot, WindowId, WindowLink, WorkspaceId,
};
use crate::ids::{CorrelationId, GenerationId, OwnerId};

/// Advisory contract version (JSON string v1).
pub const ADVISORY_CONTRACT_VERSION: u32 = 1;
/// Bounded request cap.
pub const ADVISORY_MAX_REQUEST_BYTES: usize = 64 * 1024;
/// Bounded reply cap.
pub const ADVISORY_MAX_REPLY_BYTES: usize = 64 * 1024;
/// Opaque id bound.
pub const ADVISORY_MAX_ID_LEN: usize = 128;
/// Exact normalized window count.
pub const ADVISORY_WINDOW_COUNT: usize = 3;
/// Output cardinality bound.
pub const ADVISORY_MAX_OUTPUTS: usize = 16;
/// Node cardinality bounds.
pub const ADVISORY_MAX_NODES_TOTAL: usize = 512;
pub const ADVISORY_MAX_CHILDREN: usize = 32;
pub const ADVISORY_MAX_DEPTH: usize = 16;
/// Revision bound (inclusive).
pub const ADVISORY_MAX_REVISION: u64 = 1_000_000;

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
const MSG_BOUND: &str = "topology exceeds size bound";
const MSG_WINDOW_COUNT: &str = "snapshot requires exactly three windows";
const MSG_SNAPSHOT: &str = "snapshot or intent is malformed";
const MSG_LEAF_NOT_FOUND: &str = "focused leaf is not present";
const MSG_UNSUPPORTED: &str = "operation needs an undeclared capability";
const MSG_STALE: &str = "revision does not match the pinned session revision";
const MSG_OWNER_MISMATCH: &str = "owner does not match the pinned session";
const MSG_GENERATION_MISMATCH: &str = "generation does not match the pinned session";
const MSG_CORRELATION_MISMATCH: &str = "correlation was already used";

fn is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= ADVISORY_MAX_ID_LEN
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

/// In-memory read-only session tracker. Pins owner/generation/revision on the
/// first successful advisory evaluation and accepts no further request. The
/// pinned revision never advances: advisory evaluation performs no mutation,
/// so accepting another request could replay a stale snapshot.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct AdvisorySession {
    owner: Option<String>,
    generation: Option<String>,
    revision: u64,
    pinned: bool,
    correlation: Option<String>,
}

impl AdvisorySession {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn pinned_revision(&self) -> u64 {
        if self.pinned { self.revision } else { 0 }
    }

    #[must_use]
    pub fn is_pinned(&self) -> bool {
        self.pinned
    }

    fn binding_error(
        &self,
        owner: &str,
        generation: &str,
        revision: u64,
        correlation_id: &str,
    ) -> Option<(&'static str, &'static str)> {
        if !self.pinned {
            return None;
        }
        let pinned_owner = self.owner.as_deref().unwrap_or_default();
        let pinned_generation = self.generation.as_deref().unwrap_or_default();
        if owner != pinned_owner {
            return Some(("owner-mismatch", MSG_OWNER_MISMATCH));
        }
        if generation != pinned_generation {
            return Some(("generation-mismatch", MSG_GENERATION_MISMATCH));
        }
        if revision != self.revision {
            return Some(("stale-revision", MSG_STALE));
        }
        if self.correlation.as_deref() == Some(correlation_id) {
            return Some(("correlation-mismatch", MSG_CORRELATION_MISMATCH));
        }
        Some((
            "stale-request",
            "read-only advisory session is already consumed",
        ))
    }

    fn pin_on_success(
        &mut self,
        owner: &str,
        generation: &str,
        revision: u64,
        correlation_id: &str,
    ) {
        if !self.pinned {
            self.owner = Some(owner.to_owned());
            self.generation = Some(generation.to_owned());
            self.revision = revision;
            self.pinned = true;
        }
        self.correlation = Some(correlation_id.to_owned());
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "lowercase")]
enum DirectionDto {
    Left,
    Right,
    Up,
    Down,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum AxisDto {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
enum NodeDto {
    Leaf {
        id: String,
    },
    Group {
        id: String,
        axis: AxisDto,
        children: Vec<NodeDto>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct OutputDto {
    id: String,
    workspace: String,
    #[serde(default)]
    tree: Option<NodeDto>,
    #[serde(default)]
    adjacent: BTreeMap<DirectionDto, String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct WindowLinkDto {
    window: String,
    leaf: String,
    output: String,
    workspace: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct SnapshotDto {
    outputs: Vec<OutputDto>,
    #[serde(default)]
    windows: Vec<WindowLinkDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct IntentDto {
    source_output: String,
    focused_leaf: String,
    focused_window: String,
    direction: DirectionDto,
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
struct AdvisoryRequest {
    v: u32,
    correlation_id: String,
    owner: String,
    generation: String,
    revision: u64,
    snapshot: SnapshotDto,
    intent: IntentDto,
    capabilities: CapabilitiesDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum OperationReply {
    WrapPerpendicular {
        rule: &'static str,
        container: String,
        axis: &'static str,
    },
    SwapNeighbor {
        rule: &'static str,
        container: String,
        neighbor: String,
    },
    InsertIntoGroup {
        rule: &'static str,
        container: String,
        target_group: String,
        insertion_index: usize,
        insertion: &'static str,
    },
    SplitGroupChild {
        rule: &'static str,
        container: String,
        target_group: String,
        target_child: String,
        target_child_index: usize,
        focused_side: &'static str,
        axis: &'static str,
    },
    WrapNeighbor {
        rule: &'static str,
        container: String,
        neighbor: String,
        focused_before_neighbor: bool,
        axis: &'static str,
    },
    EscapeParent {
        rule: &'static str,
        container: String,
        parent: String,
        container_child_index: usize,
        parent_insertion_index: Option<usize>,
        continuation: &'static str,
    },
    CrossOutput {
        rule: &'static str,
        target_output: String,
        source_root_child_index: usize,
        target: &'static str,
    },
}

#[derive(Debug, Clone, Serialize)]
struct AdvisoryReply {
    v: u32,
    correlation_id: String,
    owner: String,
    generation: String,
    revision: u64,
    outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    rule: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    capability: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preconditions: Option<Vec<&'static str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation: Option<OperationReply>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'static str>,
}

fn rule_str(rule: Rule) -> &'static str {
    match rule {
        Rule::R1 => "R1",
        Rule::R2a => "R2a",
        Rule::R2b => "R2b",
        Rule::R2c => "R2c",
        Rule::R3 => "R3",
        Rule::R4 => "R4",
    }
}

fn capability_str(capability: Capability) -> &'static str {
    match capability {
        Capability::SwapNeighbor => "swap-neighbor",
        Capability::WrapPerpendicular => "wrap-perpendicular",
        Capability::WrapSiblings => "wrap-siblings",
        Capability::InsertChild => "insert-child",
        Capability::SplitGroupChild => "split-group-child",
        Capability::ReparentLeaf => "reparent-leaf",
        Capability::CrossOutputTransfer => "cross-output-transfer",
    }
}

fn precondition_str(precondition: Precondition) -> &'static str {
    match precondition {
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

fn axis_str(axis: Axis) -> &'static str {
    match axis {
        Axis::Horizontal => "horizontal",
        Axis::Vertical => "vertical",
    }
}

fn convert_direction(direction: DirectionDto) -> Direction {
    match direction {
        DirectionDto::Left => Direction::Left,
        DirectionDto::Right => Direction::Right,
        DirectionDto::Up => Direction::Up,
        DirectionDto::Down => Direction::Down,
    }
}

fn convert_axis(axis: AxisDto) -> Axis {
    match axis {
        AxisDto::Horizontal => Axis::Horizontal,
        AxisDto::Vertical => Axis::Vertical,
    }
}

fn convert_node(dto: &NodeDto, depth: usize, total: &mut usize) -> Result<Node, &'static str> {
    if depth > ADVISORY_MAX_DEPTH {
        return Err(MSG_BOUND);
    }
    *total = total.checked_add(1).ok_or(MSG_BOUND)?;
    if *total > ADVISORY_MAX_NODES_TOTAL {
        return Err(MSG_BOUND);
    }
    match dto {
        NodeDto::Leaf { id } => {
            if !is_opaque_id(id) {
                return Err(MSG_OPAQUE_ID);
            }
            Ok(Node::Leaf {
                id: NodeId(id.clone()),
            })
        }
        NodeDto::Group { id, axis, children } => {
            if !is_opaque_id(id) {
                return Err(MSG_OPAQUE_ID);
            }
            if children.len() > ADVISORY_MAX_CHILDREN {
                return Err(MSG_BOUND);
            }
            let mut converted = Vec::with_capacity(children.len());
            for child in children {
                converted.push(convert_node(child, depth + 1, total)?);
            }
            let shares = vec![1u64; converted.len()];
            Ok(Node::Group {
                id: NodeId(id.clone()),
                axis: convert_axis(*axis),
                children: converted,
                shares,
            })
        }
    }
}

fn convert_snapshot(dto: &SnapshotDto) -> Result<Snapshot, &'static str> {
    if dto.outputs.is_empty() || dto.outputs.len() > ADVISORY_MAX_OUTPUTS {
        return Err(MSG_BOUND);
    }
    if dto.windows.len() != ADVISORY_WINDOW_COUNT {
        return Err(MSG_WINDOW_COUNT);
    }
    let mut outputs = Vec::with_capacity(dto.outputs.len());
    let mut total_nodes = 0usize;
    for output in &dto.outputs {
        if !is_opaque_id(&output.id) || !is_opaque_id(&output.workspace) {
            return Err(MSG_OPAQUE_ID);
        }
        if output.adjacent.len() > 4 {
            return Err(MSG_BOUND);
        }
        let mut adjacent = BTreeMap::new();
        for (direction, target) in &output.adjacent {
            if !is_opaque_id(target) {
                return Err(MSG_OPAQUE_ID);
            }
            adjacent.insert(convert_direction(*direction), OutputId(target.clone()));
        }
        let tree = match &output.tree {
            Some(tree) => Some(convert_node(tree, 0, &mut total_nodes)?),
            None => None,
        };
        outputs.push(Output {
            id: OutputId(output.id.clone()),
            workspace: WorkspaceId(output.workspace.clone()),
            tree,
            adjacent,
        });
    }
    let mut windows = Vec::with_capacity(dto.windows.len());
    for link in &dto.windows {
        if !is_opaque_id(&link.window)
            || !is_opaque_id(&link.leaf)
            || !is_opaque_id(&link.output)
            || !is_opaque_id(&link.workspace)
        {
            return Err(MSG_OPAQUE_ID);
        }
        windows.push(WindowLink {
            window: WindowId(link.window.clone()),
            leaf: NodeId(link.leaf.clone()),
            output: OutputId(link.output.clone()),
            workspace: WorkspaceId(link.workspace.clone()),
        });
    }
    Ok(Snapshot { outputs, windows })
}

fn convert_intent(dto: &IntentDto) -> Result<MoveIntent, &'static str> {
    if !is_opaque_id(&dto.source_output)
        || !is_opaque_id(&dto.focused_leaf)
        || !is_opaque_id(&dto.focused_window)
    {
        return Err(MSG_OPAQUE_ID);
    }
    Ok(MoveIntent {
        source_output: OutputId(dto.source_output.clone()),
        focused_leaf: NodeId(dto.focused_leaf.clone()),
        focused_window: WindowId(dto.focused_window.clone()),
        direction: convert_direction(dto.direction),
    })
}

fn convert_capabilities(dto: &CapabilitiesDto) -> Capabilities {
    Capabilities {
        swap_neighbor: dto.swap_neighbor,
        wrap_perpendicular: dto.wrap_perpendicular,
        wrap_siblings: dto.wrap_siblings,
        insert_child: dto.insert_child,
        split_group_child: dto.split_group_child,
        reparent_leaf: dto.reparent_leaf,
        cross_output_transfer: dto.cross_output_transfer,
    }
}

fn convert_operation(operation: &MoveOperation) -> OperationReply {
    match operation {
        MoveOperation::WrapPerpendicular {
            rule,
            container,
            axis,
        } => OperationReply::WrapPerpendicular {
            rule: rule_str(*rule),
            container: container.0.clone(),
            axis: axis_str(*axis),
        },
        MoveOperation::SwapNeighbor {
            rule,
            container,
            neighbor,
        } => OperationReply::SwapNeighbor {
            rule: rule_str(*rule),
            container: container.0.clone(),
            neighbor: neighbor.0.clone(),
        },
        MoveOperation::InsertIntoGroup {
            rule,
            container,
            target_group,
            insertion_index,
            insertion,
        } => OperationReply::InsertIntoGroup {
            rule: rule_str(*rule),
            container: container.0.clone(),
            target_group: target_group.0.clone(),
            insertion_index: *insertion_index,
            insertion: match insertion {
                Insertion::Midpoint => "midpoint",
                Insertion::NearEdge => "near-edge",
            },
        },
        MoveOperation::SplitGroupChild {
            rule,
            container,
            target_group,
            target_child,
            target_child_index,
            focused_side,
            axis,
        } => OperationReply::SplitGroupChild {
            rule: rule_str(*rule),
            container: container.0.clone(),
            target_group: target_group.0.clone(),
            target_child: target_child.0.clone(),
            target_child_index: *target_child_index,
            focused_side: match focused_side {
                FocusedSide::First => "first",
                FocusedSide::Second => "second",
            },
            axis: axis_str(*axis),
        },
        MoveOperation::WrapNeighbor {
            rule,
            container,
            neighbor,
            focused_before_neighbor,
            axis,
        } => OperationReply::WrapNeighbor {
            rule: rule_str(*rule),
            container: container.0.clone(),
            neighbor: neighbor.0.clone(),
            focused_before_neighbor: *focused_before_neighbor,
            axis: axis_str(*axis),
        },
        MoveOperation::EscapeParent {
            rule,
            container,
            parent,
            container_child_index,
            parent_insertion_index,
            continuation,
        } => OperationReply::EscapeParent {
            rule: rule_str(*rule),
            container: container.0.clone(),
            parent: parent.0.clone(),
            container_child_index: *container_child_index,
            parent_insertion_index: *parent_insertion_index,
            continuation: match continuation {
                EscapeContinuation::None => "none",
                EscapeContinuation::R1 => "R1",
            },
        },
        MoveOperation::CrossOutput {
            rule,
            target_output,
            source_root_child_index,
            target,
        } => OperationReply::CrossOutput {
            rule: rule_str(*rule),
            target_output: target_output.0.clone(),
            source_root_child_index: *source_root_child_index,
            target: match target {
                CrossOutputTarget::Empty => "empty",
                CrossOutputTarget::Occupied => "occupied",
            },
        },
    }
}

fn serialize_bounded(reply: &AdvisoryReply) -> String {
    match serde_json::to_string(reply) {
        Ok(text) if text.len() <= ADVISORY_MAX_REPLY_BYTES => text,
        _ => serde_json::to_string(&AdvisoryReply {
            v: ADVISORY_CONTRACT_VERSION,
            correlation_id: String::new(),
            owner: String::new(),
            generation: String::new(),
            revision: 0,
            outcome: "rejected",
            rule: None,
            capability: None,
            preconditions: None,
            operation: None,
            reason: None,
            kind: Some("snapshot-invalid"),
            message: Some(MSG_SNAPSHOT),
        })
        .unwrap_or_else(|_| {
            "{\"v\":1,\"correlation_id\":\"\",\"owner\":\"\",\"generation\":\"\",\"revision\":0,\"outcome\":\"rejected\",\"kind\":\"snapshot-invalid\",\"message\":\"snapshot or intent is malformed\"}"
                .to_owned()
        }),
    }
}

fn valid_correlation_echo(value: &serde_json::Value) -> String {
    value
        .get("correlation_id")
        .and_then(serde_json::Value::as_str)
        .filter(|id| CorrelationId::parse(id).is_some())
        .unwrap_or_default()
        .to_owned()
}

fn rejected(
    session: &AdvisorySession,
    correlation_id: String,
    kind: &'static str,
    message: &'static str,
) -> String {
    serialize_bounded(&AdvisoryReply {
        v: ADVISORY_CONTRACT_VERSION,
        correlation_id,
        owner: String::new(),
        generation: String::new(),
        revision: session.pinned_revision(),
        outcome: "rejected",
        rule: None,
        capability: None,
        preconditions: None,
        operation: None,
        reason: None,
        kind: Some(kind),
        message: Some(message),
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

/// Strict JSON-only read-only advisory evaluation over the shared session
/// tracker. Always returns a bounded JSON reply string and never mutates the
/// verified revision.
#[must_use]
pub fn evaluate_advisory_json(session: &mut AdvisorySession, request_json: &str) -> String {
    if request_json.len() > ADVISORY_MAX_REQUEST_BYTES {
        return rejected(session, String::new(), "oversized", MSG_OVERSIZED);
    }
    let raw: serde_json::Value = match serde_json::from_str(request_json) {
        Ok(raw) => raw,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(session, String::new(), kind, message);
        }
    };
    let request: AdvisoryRequest = match serde_json::from_value(raw.clone()) {
        Ok(request) => request,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(session, valid_correlation_echo(&raw), kind, message);
        }
    };
    if request.v != ADVISORY_CONTRACT_VERSION {
        return rejected(
            session,
            valid_correlation_echo(&raw),
            "unsupported-version",
            MSG_VERSION,
        );
    }
    if CorrelationId::parse(&request.correlation_id).is_none() {
        return rejected(
            session,
            String::new(),
            "correlation-invalid",
            MSG_CORRELATION,
        );
    }
    if OwnerId::parse(&request.owner).is_none() {
        return rejected(
            session,
            request.correlation_id.clone(),
            "owner-invalid",
            MSG_OWNER,
        );
    }
    if GenerationId::parse(&request.generation).is_none() {
        return rejected(
            session,
            request.correlation_id.clone(),
            "generation-invalid",
            MSG_GENERATION,
        );
    }
    if request.revision > ADVISORY_MAX_REVISION {
        return rejected(
            session,
            request.correlation_id.clone(),
            "revision-invalid",
            MSG_REVISION,
        );
    }
    let correlation_id = request.correlation_id.clone();
    let owner = request.owner.clone();
    let generation = request.generation.clone();
    let revision = request.revision;
    if let Some((kind, message)) =
        session.binding_error(&owner, &generation, revision, &correlation_id)
    {
        return rejected(session, correlation_id, kind, message);
    }
    let snapshot = match convert_snapshot(&request.snapshot) {
        Ok(snapshot) => snapshot,
        Err(MSG_WINDOW_COUNT) => {
            return rejected(
                session,
                correlation_id,
                "snapshot-invalid",
                MSG_WINDOW_COUNT,
            );
        }
        Err(message) => return rejected(session, correlation_id, "snapshot-invalid", message),
    };
    let intent = match convert_intent(&request.intent) {
        Ok(intent) => intent,
        Err(message) => return rejected(session, correlation_id, "snapshot-invalid", message),
    };
    let capabilities = convert_capabilities(&request.capabilities);
    match crate::cosmic_v1::plan_move_with_capabilities(&snapshot, &intent, &capabilities) {
        crate::directional::MoveOutcome::Planned(plan) => {
            session.pin_on_success(&owner, &generation, revision, &correlation_id);
            serialize_bounded(&AdvisoryReply {
                v: ADVISORY_CONTRACT_VERSION,
                correlation_id,
                owner,
                generation,
                revision,
                outcome: "planned",
                rule: Some(rule_str(plan.rule)),
                capability: Some(capability_str(plan.required_capability)),
                preconditions: Some(
                    plan.preconditions
                        .iter()
                        .map(|precondition| precondition_str(*precondition))
                        .collect(),
                ),
                operation: Some(convert_operation(&plan.operation)),
                reason: None,
                kind: None,
                message: None,
            })
        }
        crate::directional::MoveOutcome::Noop { reason } => {
            session.pin_on_success(&owner, &generation, revision, &correlation_id);
            let reason_str = match reason {
                crate::directional::NoopReason::Boundary => "boundary",
                crate::directional::NoopReason::NoAdjacentOutput => "no-adjacent-output",
                crate::directional::NoopReason::SingleRootLeaf => "single-root-leaf",
            };
            serialize_bounded(&AdvisoryReply {
                v: ADVISORY_CONTRACT_VERSION,
                correlation_id,
                owner,
                generation,
                revision,
                outcome: "noop",
                rule: None,
                capability: None,
                preconditions: None,
                operation: None,
                reason: Some(reason_str),
                kind: None,
                message: None,
            })
        }
        crate::directional::MoveOutcome::Rejected { reason } => {
            let (kind, message) = match reason.kind {
                RejectionKind::MalformedTopology => ("snapshot-invalid", MSG_SNAPSHOT),
                RejectionKind::UnsupportedTopology => ("capability-unsupported", MSG_UNSUPPORTED),
                RejectionKind::FocusedLeafNotFound => {
                    ("focused-leaf-not-found", MSG_LEAF_NOT_FOUND)
                }
            };
            rejected(session, correlation_id, kind, message)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn valid_three_window_request(correlation: &str) -> Value {
        json!({
            "v": 1,
            "correlation_id": correlation,
            "owner": "owner-1",
            "generation": "gen-1",
            "revision": 0,
            "snapshot": {
                "outputs": [{
                    "id": "source",
                    "workspace": "workspace-1",
                    "tree": {
                        "kind": "group",
                        "id": "root",
                        "axis": "horizontal",
                        "children": [
                            {"kind": "group", "id": "left", "axis": "vertical", "children": [
                                {"kind": "leaf", "id": "A"},
                                {"kind": "leaf", "id": "B"}
                            ]},
                            {"kind": "leaf", "id": "C"}
                        ]
                    },
                    "adjacent": {}
                }],
                "windows": [
                    {"window": "w-A", "leaf": "A", "output": "source", "workspace": "workspace-1"},
                    {"window": "w-B", "leaf": "B", "output": "source", "workspace": "workspace-1"},
                    {"window": "w-C", "leaf": "C", "output": "source", "workspace": "workspace-1"}
                ]
            },
            "intent": {
                "source_output": "source",
                "focused_leaf": "A",
                "focused_window": "w-A",
                "direction": "down"
            },
            "capabilities": {
                "swap_neighbor": true,
                "wrap_perpendicular": true,
                "wrap_siblings": true,
                "insert_child": true,
                "split_group_child": true,
                "reparent_leaf": true,
                "cross_output_transfer": true
            }
        })
    }

    fn evaluate(session: &mut AdvisorySession, value: &Value) -> Value {
        let text = value.to_string();
        assert!(text.len() <= ADVISORY_MAX_REQUEST_BYTES);
        let reply = evaluate_advisory_json(session, &text);
        assert!(reply.len() <= ADVISORY_MAX_REPLY_BYTES);
        serde_json::from_str(&reply).expect("reply is JSON")
    }

    fn fresh() -> AdvisorySession {
        AdvisorySession::new()
    }

    #[test]
    fn valid_plan_echoes_binding_and_delegates_to_cosmic_v1() {
        let mut session = fresh();
        let reply = evaluate(&mut session, &valid_three_window_request("corr-1"));
        assert_eq!(reply["outcome"], "planned");
        assert_eq!(reply["v"], 1);
        assert_eq!(reply["correlation_id"], "corr-1");
        assert_eq!(reply["owner"], "owner-1");
        assert_eq!(reply["generation"], "gen-1");
        assert_eq!(reply["revision"], 0);
        assert_eq!(reply["rule"], "R2a");
        assert_eq!(reply["capability"], "swap-neighbor");
        assert_eq!(reply["operation"]["kind"], "swap-neighbor");
        let preconditions = reply["preconditions"].as_array().expect("preconditions");
        assert!(
            preconditions
                .iter()
                .any(|v| v == "adapter-must-verify-postconditions")
        );
        assert!(session.is_pinned());
        assert_eq!(session.pinned_revision(), 0);
    }

    #[test]
    fn malformed_json_is_rejected() {
        let mut session = fresh();
        let reply: Value =
            serde_json::from_str(&evaluate_advisory_json(&mut session, "{not json}"))
                .expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["message"], MSG_MALFORMED);
        assert!(!session.is_pinned());
    }

    #[test]
    fn unknown_fields_are_rejected_without_echo() {
        let mut session = fresh();
        let mut request = valid_three_window_request("corr-1");
        request["intent"]["extra"] = json!("SECRET-LEAF");
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["message"], MSG_UNKNOWN_FIELD);
        assert!(!reply.to_string().contains("SECRET-LEAF"));
        assert!(!session.is_pinned());
    }

    #[test]
    fn unknown_values_are_rejected() {
        let mut session = fresh();
        let mut request = valid_three_window_request("corr-1");
        request["intent"]["direction"] = json!("diagonal");
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["message"], MSG_UNKNOWN_VALUE);
    }

    #[test]
    fn oversized_input_is_rejected() {
        let mut session = fresh();
        let big = "x".repeat(ADVISORY_MAX_REQUEST_BYTES + 1);
        let reply: Value = serde_json::from_str(&evaluate_advisory_json(&mut session, &big))
            .expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["message"], MSG_OVERSIZED);
    }

    #[test]
    fn wrong_schema_version_is_rejected() {
        let mut session = fresh();
        let mut request = valid_three_window_request("corr-1");
        request["v"] = json!(2);
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["message"], MSG_VERSION);
        assert!(!session.is_pinned());
    }

    #[test]
    fn invalid_correlation_owner_generation_revision_shapes_reject() {
        let mut session = fresh();
        let request = valid_three_window_request("");
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["message"], MSG_CORRELATION);

        let mut request = valid_three_window_request("corr-1");
        request["owner"] = json!("bad owner");
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["message"], MSG_OWNER);

        let mut request = valid_three_window_request("corr-1");
        request["generation"] = json!("UPPERCASE");
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["message"], MSG_GENERATION);

        let mut request = valid_three_window_request("corr-1");
        request["revision"] = json!(ADVISORY_MAX_REVISION + 1);
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["message"], MSG_REVISION);
        assert!(!session.is_pinned());
    }

    #[test]
    fn window_cardinality_is_exactly_three() {
        let mut session = fresh();
        let mut request = valid_three_window_request("corr-1");
        request["snapshot"]["windows"] = json!([
            {"window": "w-A", "leaf": "A", "output": "source", "workspace": "workspace-1"},
            {"window": "w-B", "leaf": "B", "output": "source", "workspace": "workspace-1"}
        ]);
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["message"], MSG_WINDOW_COUNT);

        let mut request = valid_three_window_request("corr-1");
        let mut windows = request["snapshot"]["windows"].as_array().unwrap().clone();
        windows.push(
            json!({"window": "w-D", "leaf": "C", "output": "source", "workspace": "workspace-1"}),
        );
        request["snapshot"]["windows"] = json!(windows);
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["message"], MSG_WINDOW_COUNT);
    }

    #[test]
    fn invalid_snapshots_reject_without_echo() {
        let mut session = fresh();
        let mut request = valid_three_window_request("corr-1");
        request["snapshot"]["windows"][0]["window"] = json!("SECRET-WIN");
        request["snapshot"]["windows"][0]["leaf"] = json!("SECRET-WIN");
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert!(!reply.to_string().contains("SECRET-WIN"));

        let mut request = valid_three_window_request("corr-1");
        request["intent"]["focused_leaf"] = json!("missing-leaf");
        request["intent"]["focused_window"] = json!("missing-win");
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert!(
            reply["kind"] == "snapshot-invalid" || reply["kind"] == "focused-leaf-not-found",
            "{}",
            reply
        );
    }

    #[test]
    fn unsupported_capabilities_reject() {
        let mut session = fresh();
        let mut request = valid_three_window_request("corr-1");
        request["capabilities"]["swap_neighbor"] = json!(false);
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["kind"], "capability-unsupported");
        assert_eq!(reply["message"], MSG_UNSUPPORTED);
        assert!(!session.is_pinned());
    }

    #[test]
    fn session_tracker_rejects_stale_revision_and_generation_and_owner() {
        let mut session = fresh();
        let first = evaluate(&mut session, &valid_three_window_request("corr-1"));
        assert_eq!(first["outcome"], "planned");

        let mut request = valid_three_window_request("corr-2");
        request["revision"] = json!(7);
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["kind"], "stale-revision");

        let mut request = valid_three_window_request("corr-3");
        request["generation"] = json!("gen-2");
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["kind"], "generation-mismatch");

        let mut request = valid_three_window_request("corr-4");
        request["owner"] = json!("owner-2");
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["kind"], "owner-mismatch");
        assert_eq!(session.pinned_revision(), 0);
    }

    #[test]
    fn consumed_session_rejects_duplicate_and_new_correlations() {
        let mut session = fresh();
        let first = evaluate(&mut session, &valid_three_window_request("corr-exact-1"));
        assert_eq!(first["correlation_id"], "corr-exact-1");
        let again = evaluate(&mut session, &valid_three_window_request("corr-exact-1"));
        assert_eq!(again["outcome"], "rejected");
        assert_eq!(again["kind"], "correlation-mismatch");
        let next = evaluate(&mut session, &valid_three_window_request("corr-exact-2"));
        assert_eq!(next["outcome"], "rejected");
        assert_eq!(next["kind"], "stale-request");
    }

    #[test]
    fn rejected_replies_never_echo_owner_or_generation() {
        let mut session = fresh();
        let first = evaluate(&mut session, &valid_three_window_request("corr-1"));
        assert_eq!(first["outcome"], "planned");
        let mut request = valid_three_window_request("corr-2");
        request["owner"] = json!("owner-2");
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["kind"], "owner-mismatch");
        assert!(!reply.to_string().contains("owner-2"));
    }

    #[test]
    fn reply_has_no_native_command_or_execution_fields_and_no_mutation() {
        let mut session = fresh();
        let before = session.clone();
        let reply = evaluate(&mut session, &valid_three_window_request("corr-1"));
        assert_eq!(reply["outcome"], "planned");
        let text = reply.to_string();
        for forbidden in [
            "\"command\"",
            "\"desired\"",
            "\"rect\"",
            "\"cleanup\"",
            "\"envelopes\"",
            "\"execute\"",
            "\"native\"",
            "\"geometry\"",
            "\"action\"",
            "\"close-disposable\"",
            "\"restore\"",
        ] {
            assert!(
                !text.contains(forbidden),
                "reply must not contain {forbidden}: {text}"
            );
        }
        assert_eq!(session.pinned_revision(), before.pinned_revision());
        assert_eq!(session.pinned_revision(), 0);
    }

    #[test]
    fn requests_and_replies_stay_bounded() {
        let request = valid_three_window_request("corr-1").to_string();
        assert!(request.len() <= ADVISORY_MAX_REQUEST_BYTES);
        let mut session = fresh();
        let reply = evaluate_advisory_json(&mut session, &request);
        assert!(reply.len() <= ADVISORY_MAX_REPLY_BYTES);
    }
}
