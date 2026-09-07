//! Explicit portable policy API (Cosmic v1).
//!
//! Versioned thin entry point over the sealed POC1 R1-R4 planning policy in
//! [`crate::directional`]. No planning logic is duplicated here: the accepted
//! planning surface delegates directly to the directional engine, and the
//! policy/version identifier re-exports the existing envelope value so
//! conformance and trace evidence executes through this API without wire or
//! behavior changes.

pub use crate::contract::POLICY_VERSION;

/// Cosmic v1 API version (envelope identifier for this explicit surface).
pub const COSMIC_V1_VERSION: u32 = 1;

pub use crate::directional::{
    Capabilities, Capability, MoveIntent, MoveOutcome, MovePlan, Rule, Snapshot,
};

/// Accepted R1-R4 planning surface with full adapter capabilities.
#[must_use]
pub fn plan_move(snapshot: &Snapshot, intent: &MoveIntent) -> MoveOutcome {
    crate::directional::plan_move(snapshot, intent)
}

/// Accepted R1-R4 planning surface gated by adapter-declared capabilities.
#[must_use]
pub fn plan_move_with_capabilities(
    snapshot: &Snapshot,
    intent: &MoveIntent,
    capabilities: &Capabilities,
) -> MoveOutcome {
    crate::directional::plan_move_with_capabilities(snapshot, intent, capabilities)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::directional::{
        Axis, Direction, Node, NodeId, Output, OutputId, Rule, WindowId, WindowLink, WorkspaceId,
    };
    use std::collections::BTreeMap;

    #[test]
    fn policy_version_is_current() {
        assert_eq!(POLICY_VERSION, 1);
        assert_eq!(POLICY_VERSION, crate::contract::POLICY_VERSION);
        assert_eq!(COSMIC_V1_VERSION, 1);
    }

    #[test]
    fn r2a_conformance_plan_through_v1() {
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
        let snapshot = Snapshot {
            outputs: vec![Output {
                id: OutputId::from("source"),
                workspace: WorkspaceId::from("workspace-1"),
                tree: Some(tree),
                adjacent: BTreeMap::new(),
            }],
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
        match plan_move(&snapshot, &intent) {
            MoveOutcome::Planned(plan) => {
                assert_eq!(plan.rule, Rule::R2a);
            }
            other => panic!("expected R2a plan through cosmic_v1, got {other:?}"),
        }
    }
}
