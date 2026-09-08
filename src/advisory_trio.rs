//! Portable exact-three trio adoption boundary (standalone advisory only).
//!
//! Normalizes JS-supplied observations that carry no input topology into
//! deterministic explicit [`crate::cosmic_v1`] state with the observed nested
//! arrangement `H[A,V[B,C]]`: a horizontal root over `A` and a vertical inner
//! group over `B`/`C`, where `A`/`B`/`C` are the three opaque window ids in
//! stable lexicographic order. The built [`Snapshot`]/[`MoveIntent`] pair is
//! valid input to [`crate::cosmic_v1::plan_move_with_capabilities`] and carries
//! only opaque ids, axes, shares, and direction.
//!
//! Reusable session/adoption concept: [`AdoptedTrio`] owns one deterministic
//! adoption (sorted windows, derived leaves, single output/workspace scope,
//! and the explicit nested snapshot). It is a production type used by the
//! advisory contract observation path, not a test-only helper. Callers adopt
//! once via [`AdoptedTrio::adopt`] then derive per-intent values with
//! [`AdoptedTrio::intent_for`], so the same adoption serves every direction
//! and focus binding without rebuilding topology.

use std::collections::BTreeMap;

use crate::directional::{
    Axis, Direction, MoveIntent, Node, NodeId, Output, OutputId, Snapshot, WindowId, WindowLink,
    WorkspaceId,
};

/// Exact observed window count for the standalone advisory path.
pub const TRIO_WINDOW_COUNT: usize = 3;
/// Opaque id bound shared with the advisory contract.
pub const TRIO_MAX_ID_LEN: usize = 128;
/// Deterministic explicit group identities for the built nested state.
pub const TRIO_ROOT_ID: &str = "advisory-root";
/// Deterministic explicit inner group identity for the built nested state.
pub const TRIO_INNER_ID: &str = "advisory-inner";
/// Deterministic leaf prefix: leaf for window `w` is `leaf-{w}`.
pub const TRIO_LEAF_PREFIX: &str = "leaf-";

fn is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= TRIO_MAX_ID_LEN
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

/// Fail-closed trio adoption rejection with a fixed redacted message.
/// Input bytes are never echoed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrioError {
    message: &'static str,
}

impl TrioError {
    /// Fixed redacted diagnostic; never echoes input.
    #[must_use]
    pub const fn message(&self) -> &'static str {
        self.message
    }
}

impl std::fmt::Display for TrioError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message)
    }
}

impl std::error::Error for TrioError {}

fn error(message: &'static str) -> TrioError {
    TrioError { message }
}

/// Deterministic adoption of three opaque windows into explicit nested
/// `H[A,V[B,C]]` state.
///
/// `sorted_windows` is always lexicographic byte order, so any input
/// permutation of the same three ids adopts the same topology: `A` is
/// `sorted[0]` (direct horizontal child), `B`/`C` are `sorted[1]`/`sorted[2]`
/// (vertical inner children). Leaves are `leaf-{window}` in the same order;
/// groups are [`TRIO_ROOT_ID`] (horizontal, shares `[1,1]`) and
/// [`TRIO_INNER_ID`] (vertical, shares `[1,1]`). Every leaf has exactly one
/// reciprocal window link in the single output/workspace scope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdoptedTrio {
    snapshot: Snapshot,
    sorted_windows: [WindowId; TRIO_WINDOW_COUNT],
    leaves: [NodeId; TRIO_WINDOW_COUNT],
    output: OutputId,
    workspace: WorkspaceId,
}

impl AdoptedTrio {
    /// Adopt exactly three opaque window ids into explicit nested state.
    ///
    /// Fail-closed without echo on: empty/bad-charset/overlong scope or
    /// window ids, duplicate windows, derived leaf overlong, or derived node
    /// id collision. Input order is irrelevant: the adoption sorts.
    pub fn adopt(
        output: &str,
        workspace: &str,
        windows: [&str; TRIO_WINDOW_COUNT],
    ) -> Result<Self, TrioError> {
        if !is_opaque_id(output) || !is_opaque_id(workspace) {
            return Err(error("trio scope is malformed"));
        }
        for window in windows {
            if !is_opaque_id(window) {
                return Err(error("trio window is malformed"));
            }
        }
        let mut sorted: Vec<&str> = windows.to_vec();
        sorted.sort_unstable();
        for pair in sorted.windows(2) {
            if pair[0] == pair[1] {
                return Err(error("trio windows are ambiguous"));
            }
        }
        let mut leaves: [NodeId; TRIO_WINDOW_COUNT] = [
            NodeId(String::new()),
            NodeId(String::new()),
            NodeId(String::new()),
        ];
        for (index, window) in sorted.iter().enumerate() {
            let leaf = format!("{TRIO_LEAF_PREFIX}{window}");
            if leaf.len() > TRIO_MAX_ID_LEN || !is_opaque_id(&leaf) {
                return Err(error("trio window is malformed"));
            }
            leaves[index] = NodeId(leaf);
        }
        // Fixed group ids must not collide with derived leaves.
        for leaf in &leaves {
            if leaf.0 == TRIO_ROOT_ID || leaf.0 == TRIO_INNER_ID {
                return Err(error("trio windows are ambiguous"));
            }
        }
        if TRIO_ROOT_ID == TRIO_INNER_ID {
            return Err(error("trio windows are ambiguous"));
        }
        // Derived leaves are distinct because windows are distinct.
        if leaves[0] == leaves[1] || leaves[0] == leaves[2] || leaves[1] == leaves[2] {
            return Err(error("trio windows are ambiguous"));
        }

        let output_id = OutputId(output.to_owned());
        let workspace_id = WorkspaceId(workspace.to_owned());
        let sorted_windows: [WindowId; TRIO_WINDOW_COUNT] = [
            WindowId(sorted[0].to_owned()),
            WindowId(sorted[1].to_owned()),
            WindowId(sorted[2].to_owned()),
        ];
        let tree = Node::Group {
            id: NodeId(TRIO_ROOT_ID.to_owned()),
            axis: Axis::Horizontal,
            children: vec![
                Node::Leaf {
                    id: leaves[0].clone(),
                },
                Node::Group {
                    id: NodeId(TRIO_INNER_ID.to_owned()),
                    axis: Axis::Vertical,
                    children: vec![
                        Node::Leaf {
                            id: leaves[1].clone(),
                        },
                        Node::Leaf {
                            id: leaves[2].clone(),
                        },
                    ],
                    shares: vec![1, 1],
                },
            ],
            shares: vec![1, 1],
        };
        let snapshot = Snapshot {
            outputs: vec![Output {
                id: output_id.clone(),
                workspace: workspace_id.clone(),
                tree: Some(tree),
                adjacent: BTreeMap::new(),
            }],
            windows: sorted_windows
                .iter()
                .zip(leaves.iter())
                .map(|(window, leaf)| WindowLink {
                    window: window.clone(),
                    leaf: leaf.clone(),
                    output: output_id.clone(),
                    workspace: workspace_id.clone(),
                })
                .collect(),
        };
        Ok(Self {
            snapshot,
            sorted_windows,
            leaves,
            output: output_id,
            workspace: workspace_id,
        })
    }

    /// Borrow the explicit nested snapshot (valid `cosmic_v1` input).
    #[must_use]
    pub fn snapshot(&self) -> &Snapshot {
        &self.snapshot
    }

    /// Sorted adopted windows (`A`, `B`, `C` in stable order).
    #[must_use]
    pub fn sorted_windows(&self) -> &[WindowId; TRIO_WINDOW_COUNT] {
        &self.sorted_windows
    }

    /// Derived leaves in sorted-window order.
    #[must_use]
    pub fn leaves(&self) -> &[NodeId; TRIO_WINDOW_COUNT] {
        &self.leaves
    }

    /// Adopted output scope.
    #[must_use]
    pub fn output(&self) -> &OutputId {
        &self.output
    }

    /// Adopted workspace scope.
    #[must_use]
    pub fn workspace(&self) -> &WorkspaceId {
        &self.workspace
    }

    /// Leaf bound to an adopted window, if observed.
    #[must_use]
    pub fn leaf_for_window(&self, window: &str) -> Option<&NodeId> {
        self.sorted_windows
            .iter()
            .position(|w| w.0 == window)
            .map(|index| &self.leaves[index])
    }

    /// Intent for an adopted focused window and direction. Fail-closed when
    /// the focused window was not adopted.
    pub fn intent_for(
        &self,
        focused_window: &str,
        direction: Direction,
    ) -> Result<MoveIntent, TrioError> {
        let leaf = self
            .leaf_for_window(focused_window)
            .ok_or_else(|| error("trio focus is ambiguous"))?;
        Ok(MoveIntent {
            source_output: self.output.clone(),
            focused_leaf: leaf.clone(),
            focused_window: WindowId(focused_window.to_owned()),
            direction,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cosmic_v1::plan_move_with_capabilities;
    use crate::directional::{Capabilities, Capability, Rule};

    fn adopted() -> AdoptedTrio {
        AdoptedTrio::adopt("source", "workspace-1", ["w-C", "w-A", "w-B"]).expect("adopt")
    }

    #[test]
    fn deterministic_binding_sorts_input_permutations() {
        let first =
            AdoptedTrio::adopt("source", "workspace-1", ["w-C", "w-A", "w-B"]).expect("adopt");
        let second =
            AdoptedTrio::adopt("source", "workspace-1", ["w-A", "w-B", "w-C"]).expect("adopt");
        let third =
            AdoptedTrio::adopt("source", "workspace-1", ["w-B", "w-C", "w-A"]).expect("adopt");
        assert_eq!(first, second);
        assert_eq!(first, third);
        assert_eq!(
            first
                .sorted_windows()
                .iter()
                .map(|w| w.0.clone())
                .collect::<Vec<_>>()
                .as_slice(),
            ["w-A", "w-B", "w-C"]
        );
        assert_eq!(
            first
                .leaves()
                .iter()
                .map(|l| l.0.clone())
                .collect::<Vec<_>>()
                .as_slice(),
            ["leaf-w-A", "leaf-w-B", "leaf-w-C"]
        );
        // Focused binding follows sorted order regardless of input order.
        let intent = first.intent_for("w-B", Direction::Down).expect("intent");
        assert_eq!(intent.focused_leaf.0, "leaf-w-B");
        assert_eq!(intent.focused_window.0, "w-B");
    }

    #[test]
    fn nested_axes_shares_and_reciprocal_invariants_hold() {
        let trio = adopted();
        let snapshot = trio.snapshot();
        assert_eq!(snapshot.outputs.len(), 1);
        assert_eq!(snapshot.windows.len(), TRIO_WINDOW_COUNT);
        let output = &snapshot.outputs[0];
        let Some(Node::Group {
            id: root,
            axis: root_axis,
            children: root_children,
            shares: root_shares,
        }) = &output.tree
        else {
            panic!("root must be a group");
        };
        assert_eq!(root.0, TRIO_ROOT_ID);
        assert_eq!(*root_axis, Axis::Horizontal);
        assert_eq!(*root_shares, vec![1, 1]);
        assert_eq!(root_children.len(), 2);
        assert_eq!(root_children[0].id().0, "leaf-w-A");
        let Node::Group {
            id: inner,
            axis: inner_axis,
            children: inner_children,
            shares: inner_shares,
        } = &root_children[1]
        else {
            panic!("inner must be a group");
        };
        assert_eq!(inner.0, TRIO_INNER_ID);
        assert_eq!(*inner_axis, Axis::Vertical);
        assert_eq!(*inner_shares, vec![1, 1]);
        assert_eq!(inner_children.len(), 2);
        assert_eq!(inner_children[0].id().0, "leaf-w-B");
        assert_eq!(inner_children[1].id().0, "leaf-w-C");
        // Every leaf has exactly one reciprocal link in the same scope.
        for (window, leaf) in trio.sorted_windows().iter().zip(trio.leaves().iter()) {
            let link = snapshot
                .windows
                .iter()
                .find(|link| &link.window == window)
                .expect("reciprocal link");
            assert_eq!(&link.leaf, leaf);
            assert_eq!(&link.output, trio.output());
            assert_eq!(&link.workspace, trio.workspace());
        }
    }

    #[test]
    fn ambiguity_rejects_duplicates_and_unknown_focus() {
        assert!(AdoptedTrio::adopt("source", "workspace-1", ["w-A", "w-A", "w-B"]).is_err());
        let trio = adopted();
        assert!(trio.intent_for("w-Z", Direction::Down).is_err());
        assert!(trio.leaf_for_window("w-Z").is_none());
        let error = AdoptedTrio::adopt("source", "workspace-1", ["w-A", "w-A", "w-B"])
            .expect_err("duplicate");
        assert!(!error.message().contains("w-A"));
    }

    #[test]
    fn malformed_scope_and_windows_reject_without_echo() {
        for bad in ["", "bad id", &"x".repeat(TRIO_MAX_ID_LEN + 1)] {
            assert!(
                AdoptedTrio::adopt("source", "workspace-1", [bad, "w-B", "w-C"]).is_err(),
                "window {bad:?}"
            );
        }
        assert!(AdoptedTrio::adopt("", "workspace-1", ["w-A", "w-B", "w-C"]).is_err());
        assert!(AdoptedTrio::adopt("source", "", ["w-A", "w-B", "w-C"]).is_err());
        // Derived leaf overlong fails closed without echoing the long id.
        let long = "y".repeat(TRIO_MAX_ID_LEN);
        let error = AdoptedTrio::adopt("source", "workspace-1", [&long, "w-B", "w-C"])
            .expect_err("overlong derived leaf");
        assert!(!error.message().contains(&long));
    }

    #[test]
    fn trio_state_plans_r1_r2a_r2b_r3_through_cosmic_v1() {
        let trio = adopted();
        let full = Capabilities::full();
        // R1: A faces the perpendicular axis moving down.
        match plan_move_with_capabilities(
            trio.snapshot(),
            &trio.intent_for("w-A", Direction::Down).expect("intent"),
            &full,
        ) {
            crate::directional::MoveOutcome::Planned(plan) => assert_eq!(plan.rule, Rule::R1),
            other => panic!("expected R1, got {other:?}"),
        }
        // R2a: B swaps with leaf neighbor C moving down.
        match plan_move_with_capabilities(
            trio.snapshot(),
            &trio.intent_for("w-B", Direction::Down).expect("intent"),
            &full,
        ) {
            crate::directional::MoveOutcome::Planned(plan) => {
                assert_eq!(plan.rule, Rule::R2a);
                assert_eq!(plan.required_capability, Capability::SwapNeighbor);
            }
            other => panic!("expected R2a, got {other:?}"),
        }
        // R2b: A moves right into the perpendicular inner group.
        match plan_move_with_capabilities(
            trio.snapshot(),
            &trio.intent_for("w-A", Direction::Right).expect("intent"),
            &full,
        ) {
            crate::directional::MoveOutcome::Planned(plan) => assert_eq!(plan.rule, Rule::R2b),
            other => panic!("expected R2b, got {other:?}"),
        }
        // R3: B escapes its inner parent moving up past the first child edge.
        match plan_move_with_capabilities(
            trio.snapshot(),
            &trio.intent_for("w-B", Direction::Up).expect("intent"),
            &full,
        ) {
            crate::directional::MoveOutcome::Planned(plan) => assert_eq!(plan.rule, Rule::R3),
            other => panic!("expected R3, got {other:?}"),
        }
        // R4 compatibility: single-output trio without adjacency ends at the
        // boundary as a typed noop rather than malformed.
        match plan_move_with_capabilities(
            trio.snapshot(),
            &trio.intent_for("w-A", Direction::Left).expect("intent"),
            &full,
        ) {
            crate::directional::MoveOutcome::Noop { .. } => {}
            other => panic!("expected R4 boundary noop, got {other:?}"),
        }
    }

    #[test]
    fn capability_gating_applies_to_trio_state() {
        let trio = adopted();
        let mut caps = Capabilities::full();
        caps.swap_neighbor = false;
        match plan_move_with_capabilities(
            trio.snapshot(),
            &trio.intent_for("w-B", Direction::Down).expect("intent"),
            &caps,
        ) {
            crate::directional::MoveOutcome::Rejected { reason } => {
                assert_eq!(
                    reason.kind,
                    crate::directional::RejectionKind::UnsupportedTopology
                );
            }
            other => panic!("expected capability refusal, got {other:?}"),
        }
    }
}
