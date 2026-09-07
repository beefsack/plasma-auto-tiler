//! POC2 planner transport contract: strict versioned JSON-only DTOs.
//!
//! Boundary: converts bounded [`EvaluateRequest`] JSON into the existing
//! platform-neutral [`crate::directional`] engine and back. No KWin types or
//! platform concepts appear in engine-facing conversion. All diagnostics are
//! fixed redacted strings; user input is never echoed in errors.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::directional::{
    Axis, Capabilities, Capability, CrossOutputTarget, Direction, EscapeContinuation, FocusedSide,
    Insertion, MoveIntent, MoveOperation, Node, NodeId, Output, OutputId, Precondition,
    RejectionKind, Rule, Snapshot, WindowId, WindowLink, WorkspaceId,
};
use crate::ids::{CorrelationId, GenerationId};

pub const CONTRACT_VERSION: u32 = 1;
pub const MAX_REQUEST_BYTES: usize = 64 * 1024;
pub const MAX_REPLY_BYTES: usize = 64 * 1024;
pub const MAX_ID_LEN: usize = 128;
pub const MAX_CORRELATION_LEN: usize = 128;
pub const MAX_GENERATION_LEN: usize = 64;
pub const MAX_OUTPUTS: usize = 16;
pub const MAX_WINDOWS: usize = 256;
pub const MAX_NODES_TOTAL: usize = 512;
pub const MAX_CHILDREN: usize = 32;
pub const MAX_DEPTH: usize = 16;
pub const MAX_REVISION: i32 = 1_000_000;

const MSG_OVERSIZED: &str = "request exceeds size bound";
const MSG_MALFORMED: &str = "request is malformed";
const MSG_UNKNOWN_FIELD: &str = "request contains an unknown field";
const MSG_UNKNOWN_VALUE: &str = "request contains an unknown value";
const MSG_VERSION: &str = "unsupported contract version";
const MSG_CORRELATION: &str = "correlation id is invalid";
const MSG_GENERATION: &str = "generation is invalid";
const MSG_REVISION: &str = "revision is invalid";
const MSG_OPAQUE_ID: &str = "opaque id is invalid";
const MSG_BOUND: &str = "topology exceeds size bound";
const MSG_MALFORMED_TOPOLOGY: &str = "snapshot or intent is malformed";
const MSG_UNSUPPORTED: &str = "operation needs an undeclared capability";
const MSG_LEAF_NOT_FOUND: &str = "focused leaf is not present";

fn is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ID_LEN
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

fn is_correlation_id(value: &str) -> bool {
    CorrelationId::parse(value).is_some()
}

fn is_generation(value: &str) -> bool {
    GenerationId::parse(value).is_some()
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
struct EvaluateRequest {
    v: u32,
    correlation_id: String,
    generation: String,
    revision: i32,
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
struct EvaluateReply {
    v: u32,
    correlation_id: String,
    generation: String,
    revision: i32,
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
    if depth > MAX_DEPTH {
        return Err(MSG_BOUND);
    }
    *total = total.checked_add(1).ok_or(MSG_BOUND)?;
    if *total > MAX_NODES_TOTAL {
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
            if children.len() > MAX_CHILDREN {
                return Err(MSG_BOUND);
            }
            let mut converted = Vec::with_capacity(children.len());
            for child in children {
                converted.push(convert_node(child, depth + 1, total)?);
            }
            // Wire schema carries no shares in this unit: absent DTO shares
            // normalize deterministically to equal u64 weights.
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
    if dto.outputs.is_empty() || dto.outputs.len() > MAX_OUTPUTS {
        return Err(MSG_BOUND);
    }
    if dto.windows.len() > MAX_WINDOWS {
        return Err(MSG_BOUND);
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

fn serialize_reply(reply: &EvaluateReply) -> String {
    match serde_json::to_string(reply) {
        Ok(text) if text.len() <= MAX_REPLY_BYTES => text,
        _ => {
            let fallback = EvaluateReply {
                v: CONTRACT_VERSION,
                correlation_id: String::new(),
                generation: String::new(),
                revision: 0,
                outcome: "rejected",
                rule: None,
                capability: None,
                preconditions: None,
                operation: None,
                reason: None,
                kind: Some("malformed-topology"),
                message: Some(MSG_MALFORMED_TOPOLOGY),
            };
            serde_json::to_string(&fallback).unwrap_or_else(|_| {
                "{\"v\":1,\"correlation_id\":\"\",\"generation\":\"\",\"revision\":0,\"outcome\":\"rejected\",\"kind\":\"malformed-topology\",\"message\":\"snapshot or intent is malformed\"}"
                    .to_owned()
            })
        }
    }
}

fn rejected(
    correlation_id: String,
    generation: String,
    revision: i32,
    kind: RejectionKind,
    message: &'static str,
) -> String {
    let kind_str = match kind {
        RejectionKind::MalformedTopology => "malformed-topology",
        RejectionKind::UnsupportedTopology => "unsupported-topology",
        RejectionKind::FocusedLeafNotFound => "focused-leaf-not-found",
    };
    serialize_reply(&EvaluateReply {
        v: CONTRACT_VERSION,
        correlation_id,
        generation,
        revision,
        outcome: "rejected",
        rule: None,
        capability: None,
        preconditions: None,
        operation: None,
        reason: None,
        kind: Some(kind_str),
        message: Some(message),
    })
}

fn classify_parse_error(error: &serde_json::Error) -> &'static str {
    let text = error.to_string();
    if text.contains("unknown field") {
        MSG_UNKNOWN_FIELD
    } else if text.contains("unknown variant") {
        MSG_UNKNOWN_VALUE
    } else {
        MSG_MALFORMED
    }
}

/// Strict JSON-only evaluation. Always returns a bounded JSON reply string.
#[must_use]
pub fn evaluate_json(request_json: &str) -> String {
    if request_json.len() > MAX_REQUEST_BYTES {
        return rejected(
            String::new(),
            String::new(),
            0,
            RejectionKind::MalformedTopology,
            MSG_OVERSIZED,
        );
    }
    let request: EvaluateRequest = match serde_json::from_str(request_json) {
        Ok(request) => request,
        Err(error) => {
            return rejected(
                String::new(),
                String::new(),
                0,
                RejectionKind::MalformedTopology,
                classify_parse_error(&error),
            );
        }
    };
    if request.v != CONTRACT_VERSION {
        return rejected(
            String::new(),
            String::new(),
            0,
            RejectionKind::MalformedTopology,
            MSG_VERSION,
        );
    }
    if !is_correlation_id(&request.correlation_id) {
        return rejected(
            String::new(),
            String::new(),
            0,
            RejectionKind::MalformedTopology,
            MSG_CORRELATION,
        );
    }
    if !is_generation(&request.generation) {
        return rejected(
            String::new(),
            String::new(),
            0,
            RejectionKind::MalformedTopology,
            MSG_GENERATION,
        );
    }
    if !(0..=MAX_REVISION).contains(&request.revision) {
        return rejected(
            String::new(),
            String::new(),
            0,
            RejectionKind::MalformedTopology,
            MSG_REVISION,
        );
    }
    let correlation_id = request.correlation_id.clone();
    let generation = request.generation.clone();
    let revision = request.revision;
    let snapshot = match convert_snapshot(&request.snapshot) {
        Ok(snapshot) => snapshot,
        Err(message) => {
            return rejected(
                correlation_id,
                generation,
                revision,
                RejectionKind::MalformedTopology,
                message,
            );
        }
    };
    let intent = match convert_intent(&request.intent) {
        Ok(intent) => intent,
        Err(message) => {
            return rejected(
                correlation_id,
                generation,
                revision,
                RejectionKind::MalformedTopology,
                message,
            );
        }
    };
    let capabilities = convert_capabilities(&request.capabilities);
    match crate::cosmic_v1::plan_move_with_capabilities(&snapshot, &intent, &capabilities) {
        crate::directional::MoveOutcome::Planned(plan) => serialize_reply(&EvaluateReply {
            v: CONTRACT_VERSION,
            correlation_id,
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
        }),
        crate::directional::MoveOutcome::Noop { reason } => {
            let reason_str = match reason {
                crate::directional::NoopReason::Boundary => "boundary",
                crate::directional::NoopReason::NoAdjacentOutput => "no-adjacent-output",
                crate::directional::NoopReason::SingleRootLeaf => "single-root-leaf",
            };
            serialize_reply(&EvaluateReply {
                v: CONTRACT_VERSION,
                correlation_id,
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
                RejectionKind::MalformedTopology => {
                    (RejectionKind::MalformedTopology, MSG_MALFORMED_TOPOLOGY)
                }
                RejectionKind::UnsupportedTopology => {
                    (RejectionKind::UnsupportedTopology, MSG_UNSUPPORTED)
                }
                RejectionKind::FocusedLeafNotFound => {
                    (RejectionKind::FocusedLeafNotFound, MSG_LEAF_NOT_FOUND)
                }
            };
            rejected(correlation_id, generation, revision, kind, message)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn base_request() -> Value {
        json!({
            "v": 1,
            "correlation_id": "corr-1",
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
                            {"kind": "leaf", "id": "A"},
                            {"kind": "leaf", "id": "B"}
                        ]
                    },
                    "adjacent": {}
                }],
                "windows": [
                    {"window": "w-A", "leaf": "A", "output": "source", "workspace": "workspace-1"},
                    {"window": "w-B", "leaf": "B", "output": "source", "workspace": "workspace-1"}
                ]
            },
            "intent": {
                "source_output": "source",
                "focused_leaf": "A",
                "focused_window": "w-A",
                "direction": "right"
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

    fn evaluate(value: &Value) -> Value {
        let reply = evaluate_json(&value.to_string());
        assert!(reply.len() <= MAX_REPLY_BYTES);
        serde_json::from_str(&reply).expect("reply is JSON")
    }

    #[test]
    fn r2a_advisory_plan_round_trips() {
        let reply = evaluate(&base_request());
        assert_eq!(reply["outcome"], "planned");
        assert_eq!(reply["rule"], "R2a");
        assert_eq!(reply["capability"], "swap-neighbor");
        assert_eq!(reply["correlation_id"], "corr-1");
        assert_eq!(reply["generation"], "gen-1");
        assert_eq!(reply["revision"], 0);
        let preconditions = reply["preconditions"].as_array().expect("preconditions");
        assert!(
            preconditions
                .iter()
                .any(|v| v == "adapter-must-verify-postconditions")
        );
        assert_eq!(reply["operation"]["kind"], "swap-neighbor");
        assert_eq!(reply["operation"]["container"], "root");
        assert_eq!(reply["operation"]["neighbor"], "B");
    }

    #[test]
    fn capability_refusal_is_typed() {
        let mut request = base_request();
        request["capabilities"]["swap_neighbor"] = json!(false);
        let reply = evaluate(&request);
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["kind"], "unsupported-topology");
        assert_eq!(reply["message"], MSG_UNSUPPORTED);
    }

    #[test]
    fn unknown_fields_are_rejected_without_echo() {
        let mut request = base_request();
        request["intent"]["extra"] = json!("boom-secret-id-A");
        let reply = evaluate(&request);
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["message"], MSG_UNKNOWN_FIELD);
        assert!(!reply.to_string().contains("boom-secret-id-A"));
    }

    #[test]
    fn unknown_enum_values_are_rejected() {
        let mut request = base_request();
        request["intent"]["direction"] = json!("diagonal");
        let reply = evaluate(&request);
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["message"], MSG_UNKNOWN_VALUE);
    }

    #[test]
    fn malformed_json_is_redacted() {
        let reply: Value =
            serde_json::from_str(&evaluate_json("{not json")).expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["message"], MSG_MALFORMED);
    }

    #[test]
    fn oversized_payload_is_rejected() {
        let big = "x".repeat(MAX_REQUEST_BYTES + 1);
        let reply: Value = serde_json::from_str(&evaluate_json(&big)).expect("reply is JSON");
        assert_eq!(reply["message"], MSG_OVERSIZED);
    }

    #[test]
    fn invalid_opaque_id_is_rejected_without_echo() {
        let mut request = base_request();
        request["intent"]["focused_leaf"] = json!("");
        let reply = evaluate(&request);
        assert_eq!(reply["message"], MSG_OPAQUE_ID);
        let mut request = base_request();
        request["snapshot"]["outputs"][0]["id"] = json!("bad id with spaces and SECRET123");
        let reply = evaluate(&request);
        assert_eq!(reply["message"], MSG_OPAQUE_ID);
        assert!(!reply.to_string().contains("SECRET123"));
    }

    #[test]
    fn duplicate_ids_map_to_malformed_without_echo() {
        let mut request = base_request();
        request["snapshot"]["outputs"][0]["tree"]["children"] =
            json!([{"kind": "leaf", "id": "A"}, {"kind": "leaf", "id": "A"}]);
        let reply = evaluate(&request);
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["kind"], "malformed-topology");
        assert!(!reply.to_string().contains("\"A\"") || reply["message"] == MSG_MALFORMED_TOPOLOGY);
    }

    #[test]
    fn topology_bounds_are_enforced() {
        let mut request = base_request();
        let mut outputs = Vec::new();
        for i in 0..(MAX_OUTPUTS + 1) {
            outputs.push(json!({
                "id": format!("out-{i}"),
                "workspace": "workspace-1",
                "adjacent": {}
            }));
        }
        request["snapshot"]["outputs"] = json!(outputs);
        request["snapshot"]["windows"] = json!([]);
        let reply = evaluate(&request);
        assert_eq!(reply["message"], MSG_BOUND);
    }

    #[test]
    fn version_correlation_generation_revision_are_validated() {
        let mut request = base_request();
        request["v"] = json!(2);
        assert_eq!(evaluate(&request)["message"], MSG_VERSION);
        let mut request = base_request();
        request["correlation_id"] = json!("");
        assert_eq!(evaluate(&request)["message"], MSG_CORRELATION);
        let mut request = base_request();
        request["generation"] = json!("UPPERCASE");
        assert_eq!(evaluate(&request)["message"], MSG_GENERATION);
        let mut request = base_request();
        request["revision"] = json!(-1);
        assert_eq!(evaluate(&request)["message"], MSG_REVISION);
    }

    #[test]
    fn error_replies_never_echo_ids() {
        let mut request = base_request();
        request["intent"]["focused_leaf"] = json!("SECRET-LEAF-XYZ");
        request["intent"]["focused_window"] = json!("SECRET-WIN-XYZ");
        let reply = evaluate(&request);
        assert_eq!(reply["outcome"], "rejected");
        let text = reply.to_string();
        assert!(!text.contains("SECRET-LEAF-XYZ"));
        assert!(!text.contains("SECRET-WIN-XYZ"));
    }

    #[test]
    fn noop_reasons_are_typed() {
        let mut request = base_request();
        request["snapshot"]["outputs"][0]["tree"] = json!({"kind": "leaf", "id": "A"});
        request["snapshot"]["windows"] =
            json!([{"window": "w-A", "leaf": "A", "output": "source", "workspace": "workspace-1"}]);
        request["intent"]["focused_leaf"] = json!("A");
        request["intent"]["focused_window"] = json!("w-A");
        let reply = evaluate(&request);
        assert_eq!(reply["outcome"], "noop");
        assert_eq!(reply["reason"], "single-root-leaf");
    }

    #[test]
    fn request_and_reply_stay_bounded() {
        let request = base_request().to_string();
        assert!(request.len() <= MAX_REQUEST_BYTES);
        let reply = evaluate_json(&request);
        assert!(reply.len() <= MAX_REPLY_BYTES);
    }

    #[test]
    fn shared_golden_r2a_contract_holds() {
        let fixture: Value =
            serde_json::from_str(include_str!("../test-fixtures/planner-r2a-golden-v1.json"))
                .expect("golden fixture is JSON");
        assert_eq!(fixture["v"], 1);
        let request = &fixture["request"];
        assert_eq!(request["v"], CONTRACT_VERSION);
        assert_eq!(
            request["correlation_id"],
            fixture["expected"]["correlation_id"]
        );
        assert_eq!(request["generation"], fixture["expected"]["generation"]);
        assert_eq!(request["revision"], fixture["expected"]["revision"]);
        let request_text = request.to_string();
        assert!(request_text.len() <= MAX_REQUEST_BYTES);
        let reply: Value =
            serde_json::from_str(&evaluate_json(&request_text)).expect("reply is JSON");
        assert!(evaluate_json(&request_text).len() <= MAX_REPLY_BYTES);
        let expected = &fixture["expected"];
        assert_eq!(reply["v"], expected["v"]);
        assert_eq!(reply["correlation_id"], expected["correlation_id"]);
        assert_eq!(reply["generation"], expected["generation"]);
        assert_eq!(reply["revision"], expected["revision"]);
        assert_eq!(reply["outcome"], expected["outcome"]);
        assert_eq!(reply["outcome"], "planned");
        assert_eq!(reply["rule"], expected["rule"]);
        assert_eq!(reply["rule"], "R2a");
        assert_eq!(reply["capability"], expected["capability"]);
        assert_eq!(reply["capability"], "swap-neighbor");
        assert_eq!(reply["operation"]["kind"], expected["operation"]["kind"]);
        assert_eq!(reply["operation"]["rule"], expected["operation"]["rule"]);
        assert_eq!(
            reply["operation"]["container"],
            expected["operation"]["container"]
        );
        assert_eq!(
            reply["operation"]["neighbor"],
            expected["operation"]["neighbor"]
        );
        let preconditions = reply["preconditions"].as_array().expect("preconditions");
        assert!(
            preconditions
                .iter()
                .any(|v| v == "adapter-must-verify-postconditions")
        );
    }
}
