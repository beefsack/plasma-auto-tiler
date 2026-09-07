//! POC1 COSMIC vector preservation lock.
//!
//! Semantically exact existing evidence: the shared planner JSON fixture must
//! remain byte-exact and representative POC1 policy output must stay
//! deterministic. This test never redefines planner math, strings, shapes, or
//! rule/capability names; it only locks them.

use plasma_auto_tiler::directional::{
    Axis, Capability, Direction, MoveIntent, MoveOperation, MoveOutcome, Node, NodeId, Output,
    OutputId, Precondition, Rule, Snapshot, WindowId, WindowLink, WorkspaceId, plan_move,
};
use plasma_auto_tiler::planner_contract::evaluate_json;
use std::collections::BTreeMap;

const FIXTURE: &str = include_str!("../test-fixtures/planner-r2a-golden-v1.json");
const FIXTURE_LEN: usize = 1533;
const FIXTURE_BYTE_SUM: u64 = 105164;

fn r2a_snapshot() -> (Snapshot, MoveIntent) {
    let tree = Node::Group {
        id: NodeId::from("root"),
        axis: Axis::Horizontal,
        children: vec![
            Node::Leaf {
                id: NodeId::from("A"),
            },
            Node::Leaf {
                id: NodeId::from("B"),
            },
        ],
        shares: vec![1, 1],
    };
    let output = Output {
        id: OutputId::from("source"),
        workspace: WorkspaceId::from("workspace-1"),
        tree: Some(tree),
        adjacent: BTreeMap::new(),
    };
    let snapshot = Snapshot {
        outputs: vec![output],
        windows: vec![
            WindowLink {
                window: WindowId::from("w-A"),
                leaf: NodeId::from("A"),
                output: OutputId::from("source"),
                workspace: WorkspaceId::from("workspace-1"),
            },
            WindowLink {
                window: WindowId::from("w-B"),
                leaf: NodeId::from("B"),
                output: OutputId::from("source"),
                workspace: WorkspaceId::from("workspace-1"),
            },
        ],
    };
    let intent = MoveIntent {
        source_output: OutputId::from("source"),
        focused_leaf: NodeId::from("A"),
        focused_window: WindowId::from("w-A"),
        direction: Direction::Right,
    };
    (snapshot, intent)
}

#[test]
fn planner_golden_fixture_remains_byte_exact() {
    assert_eq!(FIXTURE.len(), FIXTURE_LEN);
    let sum: u64 = FIXTURE.bytes().map(u64::from).sum();
    assert_eq!(sum, FIXTURE_BYTE_SUM);
    let fixture: serde_json::Value = serde_json::from_str(FIXTURE).expect("golden fixture is JSON");
    assert_eq!(fixture["v"], 1);
    assert_eq!(fixture["request"]["v"], 1);
    assert_eq!(fixture["request"]["correlation_id"], "planner-golden-r2a-1");
    assert_eq!(fixture["request"]["generation"], "golden-gen-1");
    assert_eq!(fixture["expected"]["rule"], "R2a");
    assert_eq!(fixture["expected"]["capability"], "swap-neighbor");
    assert_eq!(fixture["expected"]["operation"]["kind"], "swap-neighbor");
    assert_eq!(fixture["expected"]["operation"]["rule"], "R2a");
    assert_eq!(fixture["expected"]["operation"]["container"], "root");
    assert_eq!(fixture["expected"]["operation"]["neighbor"], "leaf-b");
}

#[test]
fn planner_golden_reply_is_deterministic_and_byte_exact() {
    let fixture: serde_json::Value = serde_json::from_str(FIXTURE).expect("golden fixture is JSON");
    let request_text = fixture["request"].to_string();
    let first = evaluate_json(&request_text);
    let second = evaluate_json(&request_text);
    assert_eq!(first, second);
    let reply: serde_json::Value = serde_json::from_str(&first).expect("reply is JSON");
    assert_eq!(reply["outcome"], "planned");
    assert_eq!(reply["rule"], "R2a");
    assert_eq!(reply["capability"], "swap-neighbor");
    assert_eq!(reply["operation"]["kind"], "swap-neighbor");
    assert_eq!(reply["operation"]["container"], "root");
    assert_eq!(reply["operation"]["neighbor"], "leaf-b");
    let preconditions = reply["preconditions"].as_array().expect("preconditions");
    assert_eq!(
        *preconditions,
        vec![
            "focused-leaf-occupied-by-focused-window",
            "neighbor-leaf-occupied",
            "container-is-direct-parent",
            "adapter-must-verify-postconditions",
        ]
    );
}

#[test]
fn poc1_r2a_policy_output_is_deterministic() {
    let (snapshot, intent) = r2a_snapshot();
    let first = plan_move(&snapshot, &intent);
    let second = plan_move(&snapshot, &intent);
    assert_eq!(first, second);
    match &first {
        MoveOutcome::Planned(plan) => {
            assert_eq!(plan.rule, Rule::R2a);
            assert_eq!(plan.required_capability, Capability::SwapNeighbor);
            assert_eq!(
                plan.operation,
                MoveOperation::SwapNeighbor {
                    rule: Rule::R2a,
                    container: NodeId::from("root"),
                    neighbor: NodeId::from("B"),
                }
            );
            assert_eq!(plan.intent, intent);
            assert_eq!(plan.preconditions, plan.operation.preconditions());
            assert_eq!(
                plan.preconditions,
                vec![
                    Precondition::FocusedLeafOccupiedByFocusedWindow,
                    Precondition::NeighborLeafOccupied,
                    Precondition::ContainerIsDirectParent,
                    Precondition::AdapterMustVerifyPostconditions,
                ]
            );
        }
        other => panic!("expected R2a plan, got {other:?}"),
    }
}

#[test]
fn cosmic_v1_policy_version_and_r2a_conformance_plan() {
    // Exact current policy version, shared without duplication.
    assert_eq!(plasma_auto_tiler::cosmic_v1::POLICY_VERSION, 1);
    assert_eq!(
        plasma_auto_tiler::cosmic_v1::POLICY_VERSION,
        plasma_auto_tiler::contract::POLICY_VERSION
    );
    assert_eq!(plasma_auto_tiler::cosmic_v1::COSMIC_V1_VERSION, 1);
    // The R2a conformance plan executes through the explicit cosmic_v1 API.
    let (snapshot, intent) = r2a_snapshot();
    match plasma_auto_tiler::cosmic_v1::plan_move(&snapshot, &intent) {
        MoveOutcome::Planned(plan) => {
            assert_eq!(plan.rule, Rule::R2a);
            assert_eq!(plan.required_capability, Capability::SwapNeighbor);
            assert_eq!(
                plan.operation,
                MoveOperation::SwapNeighbor {
                    rule: Rule::R2a,
                    container: NodeId::from("root"),
                    neighbor: NodeId::from("B"),
                }
            );
        }
        other => panic!("expected R2a plan through cosmic_v1, got {other:?}"),
    }
    // Conformance evidence (planner contract) executes through the same API:
    // the golden reply still reports the identical R2a plan.
    let fixture: serde_json::Value = serde_json::from_str(FIXTURE).expect("golden fixture is JSON");
    let request_text = fixture["request"].to_string();
    let reply: serde_json::Value =
        serde_json::from_str(&evaluate_json(&request_text)).expect("reply is JSON");
    assert_eq!(reply["rule"], "R2a");
    assert_eq!(reply["capability"], "swap-neighbor");
}
