//! Test vectors in two groups.
//!
//! (a) Direct translations of the authoritative TypeScript vectors. Each case
//! names its TS source (`directional-movement-planner.test.ts` /
//! `cosmic-move-adapter.test.ts` plus the S/M/U/P/F/G references used there).
//!
//! (b) Rust-specific engine properties with no TS counterpart: deterministic
//! child-order dependence, repeated-plan determinism, snapshot immutability on
//! success and on every error (including capability refusal), explicit generic
//! capability gating before plan emission, and normalized validation
//! (empty workspaces, cross-output duplicate ids).

use super::*;
use std::collections::BTreeMap;

fn leaf(id: &str) -> Node {
    Node::Leaf {
        id: NodeId::from(id),
    }
}

/// Old-vector helper: equal shares of one per child. New share-specific
/// cases construct [`Node::Group`] literals with explicit unequal shares.
fn group(id: &str, axis: Axis, children: Vec<Node>) -> Node {
    let shares = vec![1u64; children.len()];
    Node::Group {
        id: NodeId::from(id),
        axis,
        children,
        shares,
    }
}

fn group_with_shares(id: &str, axis: Axis, children: Vec<Node>, shares: Vec<u64>) -> Node {
    Node::Group {
        id: NodeId::from(id),
        axis,
        children,
        shares,
    }
}

fn output(id: &str, tree: Option<Node>, adjacent: Vec<(Direction, &str)>) -> Output {
    Output {
        id: OutputId::from(id),
        workspace: WorkspaceId::from("workspace-1"),
        tree,
        adjacent: adjacent
            .into_iter()
            .map(|(direction, target)| (direction, OutputId::from(target)))
            .collect::<BTreeMap<_, _>>(),
    }
}

/// Native-shaped snapshot: every leaf gets exactly one reciprocal window link
/// scoped to its output and workspace. Window ids derive from leaf ids.
fn snapshot(outputs: Vec<Output>) -> Snapshot {
    let mut windows = Vec::new();
    for out in &outputs {
        let mut leaves = Vec::new();
        let mut stack = vec![];
        if let Some(tree) = &out.tree {
            stack.push(tree);
        }
        while let Some(node) = stack.pop() {
            match node {
                Node::Leaf { id } => leaves.push(id.clone()),
                Node::Group { children, .. } => stack.extend(children),
            }
        }
        leaves.sort();
        for leaf_id in leaves {
            windows.push(WindowLink {
                window: WindowId(format!("w-{}", leaf_id.0)),
                leaf: leaf_id,
                output: out.id.clone(),
                workspace: out.workspace.clone(),
            });
        }
    }
    windows.sort_by(|a, b| a.window.cmp(&b.window));
    Snapshot { outputs, windows }
}

fn intent(source: &str, focused_leaf: &str, direction: Direction) -> MoveIntent {
    MoveIntent {
        source_output: OutputId::from(source),
        focused_leaf: NodeId::from(focused_leaf),
        focused_window: WindowId(format!("w-{focused_leaf}")),
        direction,
    }
}

fn single_output(tree: Node) -> Snapshot {
    snapshot(vec![output("source", Some(tree), vec![])])
}

fn planned(outcome: &MoveOutcome) -> &MovePlan {
    match outcome {
        MoveOutcome::Planned(plan) => plan,
        other => panic!("expected planned, got {other:?}"),
    }
}

// ---- R1-R4 direct translations (directional-movement-planner.test.ts) ----

#[test]
fn r1_perpendicular_wrap_s1_07_s2_03_s3_02() {
    let tree = group("root", Axis::Horizontal, vec![leaf("A"), leaf("B")]);
    let snap = single_output(tree);
    let outcome = plan_move(&snap, &intent("source", "B", Direction::Down));
    let plan = planned(&outcome);
    assert_eq!(plan.rule, Rule::R1);
    assert_eq!(
        plan.operation,
        MoveOperation::WrapPerpendicular {
            rule: Rule::R1,
            container: NodeId::from("root"),
            axis: Axis::Vertical,
        }
    );
    assert_eq!(plan.required_capability, Capability::WrapPerpendicular);
    assert!(
        plan.preconditions
            .contains(&Precondition::AdapterMustVerifyPostconditions)
    );
}

#[test]
fn r2a_swap_two_child_leaf_neighbor_s1_02_s2_01_s3_01_m1() {
    let tree = group("root", Axis::Horizontal, vec![leaf("A"), leaf("B")]);
    let snap = single_output(tree);
    let outcome = plan_move(&snap, &intent("source", "A", Direction::Right));
    let plan = planned(&outcome);
    assert_eq!(plan.rule, Rule::R2a);
    assert_eq!(
        plan.operation,
        MoveOperation::SwapNeighbor {
            rule: Rule::R2a,
            container: NodeId::from("root"),
            neighbor: NodeId::from("B"),
        }
    );
    assert_eq!(plan.required_capability, Capability::SwapNeighbor);
}

#[test]
fn r2b_midpoint_even_perpendicular_target_s1_08_s3_13_u2() {
    let tree = group(
        "root",
        Axis::Vertical,
        vec![
            group(
                "target",
                Axis::Horizontal,
                vec![leaf("A"), leaf("B"), leaf("C"), leaf("D")],
            ),
            leaf("W"),
        ],
    );
    let snap = single_output(tree);
    let outcome = plan_move(&snap, &intent("source", "W", Direction::Up));
    let plan = planned(&outcome);
    assert_eq!(
        plan.operation,
        MoveOperation::InsertIntoGroup {
            rule: Rule::R2b,
            container: NodeId::from("root"),
            target_group: NodeId::from("target"),
            insertion_index: 2,
            insertion: Insertion::Midpoint,
        }
    );
    // R2b insertion is a distinct required capability an adapter may leave
    // undeclared; a minimal adapter declaring only swap/wrap refuses it.
    assert_eq!(plan.required_capability, Capability::InsertChild);
    let minimal = Capabilities {
        swap_neighbor: true,
        wrap_perpendicular: true,
        wrap_siblings: false,
        insert_child: false,
        split_group_child: false,
        reparent_leaf: false,
        cross_output_transfer: false,
    };
    assert!(!minimal.supports(plan.required_capability));
}

#[test]
fn r2b_split_odd_target_s7_02_s9_02_s12_02_s19_02_u1() {
    let tree = group(
        "root",
        Axis::Vertical,
        vec![
            group(
                "target",
                Axis::Horizontal,
                vec![leaf("A"), leaf("B"), leaf("C")],
            ),
            leaf("W"),
        ],
    );
    let snap = single_output(tree);
    let outcome = plan_move(&snap, &intent("source", "W", Direction::Up));
    let plan = planned(&outcome);
    assert_eq!(
        plan.operation,
        MoveOperation::SplitGroupChild {
            rule: Rule::R2b,
            container: NodeId::from("root"),
            target_group: NodeId::from("target"),
            target_child: NodeId::from("B"),
            target_child_index: 1,
            focused_side: FocusedSide::First,
            axis: Axis::Vertical,
        }
    );
    assert_eq!(plan.required_capability, Capability::SplitGroupChild);
}

#[test]
fn r2b_near_edge_parallel_target_s1_17_s3_08() {
    let tree = group(
        "root",
        Axis::Horizontal,
        vec![
            leaf("W"),
            group("target", Axis::Horizontal, vec![leaf("A"), leaf("B")]),
        ],
    );
    let snap = single_output(tree);
    let outcome = plan_move(&snap, &intent("source", "W", Direction::Right));
    let plan = planned(&outcome);
    assert_eq!(
        plan.operation,
        MoveOperation::InsertIntoGroup {
            rule: Rule::R2b,
            container: NodeId::from("root"),
            target_group: NodeId::from("target"),
            insertion_index: 0,
            insertion: Insertion::NearEdge,
        }
    );
}

#[test]
fn r2c_wrap_neighbor_n_ary_s1_01_s4_01_s14_01_s18_01_m2_u1() {
    let tree = group(
        "root",
        Axis::Horizontal,
        vec![leaf("A"), leaf("W"), leaf("S"), leaf("D")],
    );
    let snap = single_output(tree);
    let outcome = plan_move(&snap, &intent("source", "W", Direction::Right));
    let plan = planned(&outcome);
    assert_eq!(
        plan.operation,
        MoveOperation::WrapNeighbor {
            rule: Rule::R2c,
            container: NodeId::from("root"),
            neighbor: NodeId::from("S"),
            focused_before_neighbor: true,
            axis: Axis::Horizontal,
        }
    );
    assert_eq!(plan.required_capability, Capability::WrapSiblings);
}

#[test]
fn r3_escape_same_axis_parent_s1_03_s1_06_s3_11_s23_02() {
    let tree = group(
        "root",
        Axis::Horizontal,
        vec![
            leaf("A"),
            group("inner", Axis::Horizontal, vec![leaf("W"), leaf("B")]),
            leaf("D"),
        ],
    );
    let snap = single_output(tree);
    let outcome = plan_move(&snap, &intent("source", "B", Direction::Right));
    let plan = planned(&outcome);
    assert_eq!(
        plan.operation,
        MoveOperation::EscapeParent {
            rule: Rule::R3,
            container: NodeId::from("inner"),
            parent: NodeId::from("root"),
            container_child_index: 1,
            parent_insertion_index: Some(2),
            continuation: EscapeContinuation::None,
        }
    );
    assert_eq!(plan.required_capability, Capability::ReparentLeaf);
}

#[test]
fn r3_perpendicular_parent_r1_continuation_s2_02_s3_04_s16_02_g1() {
    let tree = group(
        "root",
        Axis::Horizontal,
        vec![
            group("inner", Axis::Vertical, vec![leaf("W"), leaf("B")]),
            leaf("D"),
        ],
    );
    let snap = single_output(tree);
    let outcome = plan_move(&snap, &intent("source", "W", Direction::Up));
    let plan = planned(&outcome);
    assert_eq!(plan.rule, Rule::R3);
    match &plan.operation {
        MoveOperation::EscapeParent {
            parent_insertion_index,
            continuation,
            ..
        } => {
            assert_eq!(*parent_insertion_index, None);
            assert_eq!(*continuation, EscapeContinuation::R1);
        }
        other => panic!("expected escape-parent, got {other:?}"),
    }
}

#[test]
fn r4_occupied_and_empty_after_boundary_s20_s22_s23_p1_p5_f1_f3() {
    let source_tree = group("source-root", Axis::Horizontal, vec![leaf("W"), leaf("B")]);
    let occupied = snapshot(vec![
        output("left", Some(leaf("X")), vec![(Direction::Right, "source")]),
        output(
            "source",
            Some(source_tree.clone()),
            vec![(Direction::Left, "left")],
        ),
    ]);
    let outcome = plan_move(&occupied, &intent("source", "W", Direction::Left));
    let plan = planned(&outcome);
    assert_eq!(plan.rule, Rule::R4);
    assert_eq!(
        plan.operation,
        MoveOperation::CrossOutput {
            rule: Rule::R4,
            target_output: OutputId::from("left"),
            source_root_child_index: 0,
            target: CrossOutputTarget::Occupied,
        }
    );

    let empty = snapshot(vec![
        output("left", None, vec![(Direction::Right, "source")]),
        output("source", Some(source_tree), vec![(Direction::Left, "left")]),
    ]);
    let outcome = plan_move(&empty, &intent("source", "W", Direction::Left));
    assert_eq!(
        planned(&outcome).operation,
        MoveOperation::CrossOutput {
            rule: Rule::R4,
            target_output: OutputId::from("left"),
            source_root_child_index: 0,
            target: CrossOutputTarget::Empty,
        }
    );
}

#[test]
fn r4_denied_without_adjacency_or_on_workspace_mismatch_s5_s6_s17_s21_m3() {
    let tree = group("root", Axis::Horizontal, vec![leaf("W"), leaf("B")]);
    let missing = single_output(tree.clone());
    assert_eq!(
        plan_move(&missing, &intent("source", "W", Direction::Left)),
        MoveOutcome::Noop {
            reason: NoopReason::NoAdjacentOutput
        }
    );

    let mut mismatched = snapshot(vec![
        output(
            "target",
            Some(leaf("X")),
            vec![(Direction::Right, "source")],
        ),
        output("source", Some(tree), vec![(Direction::Left, "target")]),
    ]);
    mismatched.outputs[0].workspace = WorkspaceId::from("workspace-2");
    // Repair the link workspace so topology validates; the denial under test
    // is the output-scope mismatch at the R4 gate.
    for link in &mut mismatched.windows {
        if link.output.0 == "target" {
            link.workspace = WorkspaceId::from("workspace-2");
        }
    }
    assert_eq!(
        plan_move(&mismatched, &intent("source", "W", Direction::Left)),
        MoveOutcome::Noop {
            reason: NoopReason::NoAdjacentOutput
        }
    );
}

// ---- validation translations (fail-closed topology) ----

#[test]
fn rejects_duplicate_identities_one_child_groups_missing_leaves() {
    // Duplicate leaf ids.
    let duplicate = group("root", Axis::Horizontal, vec![leaf("A"), leaf("A")]);
    let snap = Snapshot {
        outputs: vec![output("source", Some(duplicate), vec![])],
        windows: vec![WindowLink {
            window: WindowId::from("w-A"),
            leaf: NodeId::from("A"),
            output: OutputId::from("source"),
            workspace: WorkspaceId::from("workspace-1"),
        }],
    };
    assert!(matches!(
        plan_move(&snap, &intent("source", "A", Direction::Right)),
        MoveOutcome::Rejected { .. }
    ));

    // One-child group (TS: `{ children: [leaf("A")] }`).
    let one_child = Node::Group {
        id: NodeId::from("root"),
        axis: Axis::Horizontal,
        children: vec![leaf("A")],
        shares: vec![1],
    };
    let snap = single_output(one_child);
    assert!(matches!(
        plan_move(&snap, &intent("source", "A", Direction::Right)),
        MoveOutcome::Rejected { .. }
    ));

    // Missing focused leaf.
    let tree = group("root", Axis::Horizontal, vec![leaf("A"), leaf("B")]);
    let snap = single_output(tree);
    assert!(matches!(
        plan_move(&snap, &intent("source", "missing", Direction::Right)),
        MoveOutcome::Rejected {
            reason: Rejection {
                kind: RejectionKind::FocusedLeafNotFound,
                ..
            },
        }
    ));
}

#[test]
fn rejects_shared_topology_and_malformed_output_sets() {
    // Shared semantic node: same leaf id under two parents (TS object sharing).
    let shared = group(
        "root",
        Axis::Horizontal,
        vec![
            group("left", Axis::Vertical, vec![leaf("shared"), leaf("L")]),
            group("right", Axis::Vertical, vec![leaf("shared"), leaf("R")]),
        ],
    );
    let snap = Snapshot {
        outputs: vec![output("source", Some(shared), vec![])],
        windows: vec![
            WindowLink {
                window: WindowId::from("w-shared"),
                leaf: NodeId::from("shared"),
                output: OutputId::from("source"),
                workspace: WorkspaceId::from("workspace-1"),
            },
            WindowLink {
                window: WindowId::from("w-L"),
                leaf: NodeId::from("L"),
                output: OutputId::from("source"),
                workspace: WorkspaceId::from("workspace-1"),
            },
            WindowLink {
                window: WindowId::from("w-R"),
                leaf: NodeId::from("R"),
                output: OutputId::from("source"),
                workspace: WorkspaceId::from("workspace-1"),
            },
        ],
    };
    assert!(matches!(
        plan_move(&snap, &intent("source", "shared", Direction::Right)),
        MoveOutcome::Rejected { .. }
    ));

    // Missing source output.
    let snap = snapshot(vec![output("source", None, vec![])]);
    assert!(matches!(
        plan_move(
            &snap,
            &MoveIntent {
                source_output: OutputId::from("missing"),
                focused_leaf: NodeId::from("A"),
                focused_window: WindowId::from("w-A"),
                direction: Direction::Right,
            },
        ),
        MoveOutcome::Rejected { .. }
    ));

    // Empty node id.
    let snap = single_output(group("root", Axis::Horizontal, vec![leaf(""), leaf("B")]));
    assert!(matches!(
        plan_move(&snap, &intent("source", "", Direction::Right)),
        MoveOutcome::Rejected { .. }
    ));
}

#[test]
fn rejects_unknown_and_self_output_adjacency() {
    let tree = || group("root", Axis::Horizontal, vec![leaf("A"), leaf("B")]);
    // Unknown adjacency target (TS: `{ right: "unknown" }`).
    let snap = snapshot(vec![output(
        "source",
        Some(tree()),
        vec![(Direction::Right, "unknown")],
    )]);
    assert!(matches!(
        plan_move(&snap, &intent("source", "A", Direction::Right)),
        MoveOutcome::Rejected { .. }
    ));

    // Self adjacency.
    let snap = snapshot(vec![output(
        "source",
        Some(tree()),
        vec![(Direction::Right, "source")],
    )]);
    assert!(matches!(
        plan_move(&snap, &intent("source", "A", Direction::Right)),
        MoveOutcome::Rejected { .. }
    ));
}

// ---- window associations: stale / nonreciprocal / missing ----

#[test]
fn rejects_stale_nonreciprocal_and_missing_window_associations() {
    let tree = || group("root", Axis::Horizontal, vec![leaf("A"), leaf("B")]);

    // Missing association for leaf B.
    let snap = Snapshot {
        outputs: vec![output("source", Some(tree()), vec![])],
        windows: vec![WindowLink {
            window: WindowId::from("w-A"),
            leaf: NodeId::from("A"),
            output: OutputId::from("source"),
            workspace: WorkspaceId::from("workspace-1"),
        }],
    };
    assert!(matches!(
        plan_move(&snap, &intent("source", "A", Direction::Right)),
        MoveOutcome::Rejected { .. }
    ));

    // Stale link: window points at the wrong leaf.
    let mut snap = single_output(tree());
    for link in &mut snap.windows {
        if link.leaf.0 == "A" {
            link.leaf = NodeId::from("B");
        }
    }
    assert!(matches!(
        plan_move(&snap, &intent("source", "A", Direction::Right)),
        MoveOutcome::Rejected { .. }
    ));

    // Nonreciprocal: link references an unknown leaf.
    let snap = Snapshot {
        outputs: vec![output("source", Some(tree()), vec![])],
        windows: vec![
            WindowLink {
                window: WindowId::from("w-A"),
                leaf: NodeId::from("A"),
                output: OutputId::from("source"),
                workspace: WorkspaceId::from("workspace-1"),
            },
            WindowLink {
                window: WindowId::from("w-ghost"),
                leaf: NodeId::from("ghost"),
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
    assert!(matches!(
        plan_move(&snap, &intent("source", "A", Direction::Right)),
        MoveOutcome::Rejected { .. }
    ));

    // Duplicate window identity.
    let snap = Snapshot {
        outputs: vec![output("source", Some(tree()), vec![])],
        windows: vec![
            WindowLink {
                window: WindowId::from("w-A"),
                leaf: NodeId::from("A"),
                output: OutputId::from("source"),
                workspace: WorkspaceId::from("workspace-1"),
            },
            WindowLink {
                window: WindowId::from("w-A"),
                leaf: NodeId::from("B"),
                output: OutputId::from("source"),
                workspace: WorkspaceId::from("workspace-1"),
            },
        ],
    };
    assert!(matches!(
        plan_move(&snap, &intent("source", "A", Direction::Right)),
        MoveOutcome::Rejected { .. }
    ));
}

// ---- native-shaped snapshots, reordered children, determinism, no mutation ----

#[test]
fn reordered_children_change_the_planned_neighbor() {
    // H[A,W,S,D] moving right from W meets S; H[A,S,W,D] meets D. Order is
    // the determinism source, mirroring native decode order.
    let ordered = group(
        "root",
        Axis::Horizontal,
        vec![leaf("A"), leaf("W"), leaf("S"), leaf("D")],
    );
    let snap = single_output(ordered);
    let outcome = plan_move(&snap, &intent("source", "W", Direction::Right));
    let plan = planned(&outcome);
    assert_eq!(
        plan.operation,
        MoveOperation::WrapNeighbor {
            rule: Rule::R2c,
            container: NodeId::from("root"),
            neighbor: NodeId::from("S"),
            focused_before_neighbor: true,
            axis: Axis::Horizontal,
        }
    );

    let reordered = group(
        "root",
        Axis::Horizontal,
        vec![leaf("A"), leaf("S"), leaf("W"), leaf("D")],
    );
    let snap = single_output(reordered);
    let outcome = plan_move(&snap, &intent("source", "W", Direction::Right));
    let plan = planned(&outcome);
    assert_eq!(
        plan.operation,
        MoveOperation::WrapNeighbor {
            rule: Rule::R2c,
            container: NodeId::from("root"),
            neighbor: NodeId::from("D"),
            focused_before_neighbor: true,
            axis: Axis::Horizontal,
        }
    );
}

#[test]
fn repeated_plans_are_deterministic() {
    let tree = group(
        "root",
        Axis::Vertical,
        vec![
            group(
                "target",
                Axis::Horizontal,
                vec![leaf("A"), leaf("B"), leaf("C"), leaf("D")],
            ),
            leaf("W"),
        ],
    );
    let snap = single_output(tree);
    let first = plan_move(&snap, &intent("source", "W", Direction::Up));
    let second = plan_move(&snap, &intent("source", "W", Direction::Up));
    assert_eq!(first, second);
}

#[test]
fn errors_leave_input_unchanged_and_success_mutates_nothing() {
    let tree = group("root", Axis::Horizontal, vec![leaf("A"), leaf("B")]);
    let snap = single_output(tree);
    let before = snap.clone();
    let outcome = plan_move(&snap, &intent("source", "missing", Direction::Right));
    assert!(matches!(outcome, MoveOutcome::Rejected { .. }));
    assert_eq!(snap, before, "rejected plan must not mutate the snapshot");

    let outcome = plan_move(&snap, &intent("source", "A", Direction::Right));
    assert!(matches!(outcome, MoveOutcome::Planned(_)));
    assert_eq!(snap, before, "planning never mutates the snapshot");

    // Capability refusal also leaves the snapshot unchanged.
    let tree = group(
        "root",
        Axis::Vertical,
        vec![
            group(
                "target",
                Axis::Horizontal,
                vec![leaf("A"), leaf("B"), leaf("C"), leaf("D")],
            ),
            leaf("W"),
        ],
    );
    let snap = single_output(tree);
    let before = snap.clone();
    let outcome = plan_move_with_capabilities(
        &snap,
        &intent("source", "W", Direction::Up),
        &Capabilities::none(),
    );
    assert!(matches!(
        outcome,
        MoveOutcome::Rejected {
            reason: Rejection {
                kind: RejectionKind::UnsupportedTopology,
                ..
            },
        }
    ));
    assert_eq!(
        snap, before,
        "capability refusal must not mutate the snapshot"
    );

    // Malformed workspace on a window link also leaves input unchanged.
    let mut snap = single_output(group("root", Axis::Horizontal, vec![leaf("A"), leaf("B")]));
    let before = snap.clone();
    snap.windows[0].workspace = WorkspaceId::from("");
    let outcome = plan_move(&snap, &intent("source", "A", Direction::Right));
    assert!(matches!(
        outcome,
        MoveOutcome::Rejected {
            reason: Rejection {
                kind: RejectionKind::MalformedTopology,
                ..
            },
        }
    ));
    assert_eq!(
        snap.windows[0].workspace,
        WorkspaceId::from(""),
        "validation must not repair the snapshot"
    );
    assert_eq!(snap.outputs, before.outputs);
}

// ---- capability refusal before plan emission (Rust-specific property) ----

#[test]
fn capability_refusal_precedes_plan_emission() {
    // R2b insertion requires InsertChild, undeclared in this minimal adapter.
    let minimal = Capabilities {
        swap_neighbor: true,
        wrap_perpendicular: true,
        wrap_siblings: false,
        insert_child: false,
        split_group_child: false,
        reparent_leaf: false,
        cross_output_transfer: false,
    };

    let tree = group(
        "root",
        Axis::Vertical,
        vec![
            group(
                "target",
                Axis::Horizontal,
                vec![leaf("A"), leaf("B"), leaf("C"), leaf("D")],
            ),
            leaf("W"),
        ],
    );
    let snap = single_output(tree);
    let refused =
        plan_move_with_capabilities(&snap, &intent("source", "W", Direction::Up), &minimal);
    assert!(
        matches!(
            refused,
            MoveOutcome::Rejected {
                reason: Rejection {
                    kind: RejectionKind::UnsupportedTopology,
                    ..
                },
            }
        ),
        "minimal adapter must refuse undeclared R2b insertion, got {refused:?}"
    );

    let admitted = plan_move_with_capabilities(
        &snap,
        &intent("source", "W", Direction::Up),
        &Capabilities::full(),
    );
    assert!(matches!(admitted, MoveOutcome::Planned(_)));

    // R2a swap is within the minimal declared capabilities.
    let tree = group("root", Axis::Horizontal, vec![leaf("A"), leaf("B")]);
    let snap = single_output(tree);
    let outcome =
        plan_move_with_capabilities(&snap, &intent("source", "A", Direction::Right), &minimal);
    assert!(matches!(outcome, MoveOutcome::Planned(_)));

    // No capabilities: even the R1 wrap is refused.
    let tree = group("root", Axis::Horizontal, vec![leaf("A"), leaf("B")]);
    let snap = single_output(tree);
    let outcome = plan_move_with_capabilities(
        &snap,
        &intent("source", "B", Direction::Down),
        &Capabilities::none(),
    );
    assert!(matches!(
        outcome,
        MoveOutcome::Rejected {
            reason: Rejection {
                kind: RejectionKind::UnsupportedTopology,
                ..
            },
        }
    ));
}

// ---- tree-relative focus (cosmic-move-adapter.test.ts) ----

#[test]
fn focus_climbs_to_matching_axis_sibling_then_descends_to_edge() {
    // H[A,V[B,C]]: right from A reaches B (perpendicular first-child
    // descent); left from C reaches A.
    let tree = group(
        "root",
        Axis::Horizontal,
        vec![
            leaf("A"),
            group("inner", Axis::Vertical, vec![leaf("B"), leaf("C")]),
        ],
    );
    assert_eq!(
        plan_focus(&tree, &NodeId::from("A"), Direction::Right),
        Some(FocusPlan::Focused {
            leaf: NodeId::from("B"),
            route: vec![NodeId::from("inner"), NodeId::from("B")],
        })
    );
    assert_eq!(
        plan_focus(&tree, &NodeId::from("C"), Direction::Left),
        Some(FocusPlan::Focused {
            leaf: NodeId::from("A"),
            route: vec![NodeId::from("A")],
        })
    );
}

#[test]
fn focus_reports_exhausted_edge_for_routing() {
    let tree = group("root", Axis::Horizontal, vec![leaf("A"), leaf("B")]);
    assert_eq!(
        plan_focus(&tree, &NodeId::from("A"), Direction::Left),
        Some(FocusPlan::Edge)
    );
    assert_eq!(
        plan_focus(&tree, &NodeId::from("B"), Direction::Right),
        Some(FocusPlan::Edge)
    );
}

#[test]
fn focus_fails_closed_on_duplicate_single_child_and_missing() {
    let duplicate = group("root", Axis::Horizontal, vec![leaf("A"), leaf("A")]);
    assert_eq!(
        plan_focus(&duplicate, &NodeId::from("A"), Direction::Right),
        None
    );

    let single = Node::Group {
        id: NodeId::from("root"),
        axis: Axis::Horizontal,
        children: vec![leaf("A")],
        shares: vec![1],
    };
    assert_eq!(
        plan_focus(&single, &NodeId::from("A"), Direction::Right),
        None
    );

    let two = group("root", Axis::Horizontal, vec![leaf("A"), leaf("B")]);
    assert_eq!(
        plan_focus(&two, &NodeId::from("missing"), Direction::Right),
        None
    );
}

// ---- fraction sizing (cosmic-move-adapter.test.ts sizing cases) ----

#[test]
fn insert_grants_equal_share_and_preserves_ratios() {
    let even = insert_shares(&[0.5, 0.5], 2).expect("valid shares");
    for share in &even {
        assert!((share - 1.0 / 3.0).abs() < 1e-9);
    }
    let uneven = insert_shares(&[0.4, 0.6], 1).expect("valid shares");
    assert!((uneven[1] - 1.0 / 3.0).abs() < 1e-9);
    assert!((uneven[0] / uneven[2] - 0.4 / 0.6).abs() < 1e-9);
}

#[test]
fn removal_redistributes_proportionally() {
    // 50/30/20 losing the 50% child becomes 60/40, preserving 30:20.
    let result = remove_shares(&[0.5, 0.3, 0.2], 0).expect("valid shares");
    assert!((result[0] - 0.6).abs() < 1e-9);
    assert!((result[1] - 0.4).abs() < 1e-9);
}

#[test]
fn half_split_grants_equal_shares() {
    assert_eq!(half_split(), [0.5, 0.5]);
}

#[test]
fn sizing_fails_closed_on_malformed_input() {
    assert_eq!(insert_shares(&[], 0), None);
    assert_eq!(insert_shares(&[0.5, 0.0], 1), None);
    assert_eq!(remove_shares(&[1.0], 0), None);
    assert_eq!(remove_shares(&[0.5, 0.5], 9), None);
}

// ---- Rust-specific properties: self-contained plans, global ids, workspaces ----

#[test]
fn move_plan_carries_originating_intent() {
    let tree = group("root", Axis::Horizontal, vec![leaf("A"), leaf("B")]);
    let snap = single_output(tree);
    let expected = intent("source", "A", Direction::Right);
    let outcome = plan_move(&snap, &expected);
    let plan = planned(&outcome);
    assert_eq!(plan.intent, expected);
    assert_eq!(plan.rule, Rule::R2a);
}

#[test]
fn rejects_cross_output_duplicate_node_ids() {
    // Global NodeId uniqueness is an intentional engine snapshot invariant:
    // opaque global ids plus WindowLink require an unambiguous logical
    // topology, so the same leaf id on two outputs is rejected.
    let snap = snapshot(vec![
        output("left", Some(leaf("dup")), vec![]),
        output("right", Some(leaf("dup")), vec![]),
    ]);
    assert!(matches!(
        plan_move(&snap, &intent("left", "dup", Direction::Right)),
        MoveOutcome::Rejected {
            reason: Rejection {
                kind: RejectionKind::MalformedTopology,
                ..
            },
        }
    ));
}

#[test]
fn ordered_n_ary_unequal_shares_keep_child_order_planning() {
    // Unequal shares never steer the movement planner: neighbor selection
    // stays purely child-order driven (R2c), matching equal-share behavior.
    let unequal = group_with_shares(
        "root",
        Axis::Horizontal,
        vec![leaf("A"), leaf("W"), leaf("S"), leaf("D")],
        vec![5, 1, 2, 1],
    );
    let snap = single_output(unequal);
    let outcome = plan_move(&snap, &intent("source", "W", Direction::Right));
    let plan = planned(&outcome);
    assert_eq!(
        plan.operation,
        MoveOperation::WrapNeighbor {
            rule: Rule::R2c,
            container: NodeId::from("root"),
            neighbor: NodeId::from("S"),
            focused_before_neighbor: true,
            axis: Axis::Horizontal,
        }
    );
}

#[test]
fn rejects_misaligned_zero_and_overflowing_shares() {
    // Share count must match child count exactly.
    let short = group_with_shares(
        "root",
        Axis::Horizontal,
        vec![leaf("A"), leaf("B")],
        vec![1],
    );
    assert!(matches!(
        plan_move(
            &single_output(short),
            &intent("source", "A", Direction::Right)
        ),
        MoveOutcome::Rejected {
            reason: Rejection {
                kind: RejectionKind::MalformedTopology,
                ..
            },
        }
    ));

    // Zero shares are malformed.
    let zero = group_with_shares(
        "root",
        Axis::Horizontal,
        vec![leaf("A"), leaf("B")],
        vec![1, 0],
    );
    assert!(matches!(
        plan_move(
            &single_output(zero),
            &intent("source", "A", Direction::Right)
        ),
        MoveOutcome::Rejected {
            reason: Rejection {
                kind: RejectionKind::MalformedTopology,
                ..
            },
        }
    ));

    // Overflowing u64 totals fail closed.
    let overflow = group_with_shares(
        "root",
        Axis::Horizontal,
        vec![leaf("A"), leaf("B")],
        vec![u64::MAX, 1],
    );
    assert!(matches!(
        plan_move(
            &single_output(overflow),
            &intent("source", "A", Direction::Right)
        ),
        MoveOutcome::Rejected {
            reason: Rejection {
                kind: RejectionKind::MalformedTopology,
                ..
            },
        }
    ));

    // Focus is equally fail-closed on malformed shares.
    let bad_focus = group_with_shares(
        "root",
        Axis::Horizontal,
        vec![leaf("A"), leaf("B")],
        vec![1, 0],
    );
    assert_eq!(
        plan_focus(&bad_focus, &NodeId::from("A"), Direction::Right),
        None
    );
    let misaligned = group_with_shares(
        "root",
        Axis::Horizontal,
        vec![leaf("A"), leaf("B")],
        vec![1, 1, 1],
    );
    assert_eq!(
        plan_focus(&misaligned, &NodeId::from("A"), Direction::Right),
        None
    );
}

#[test]
fn resize_exhausted_inner_selects_viable_outer_same_axis() {
    // Root H[inner H, C]; inner H[B, D] with focus B. Direction Right:
    // inner donor D == 1 with divisible total (exhausted), outer donor C
    // viable after x16 normalization. Must select the outer boundary.
    let inner = group_with_shares(
        "inner",
        Axis::Horizontal,
        vec![leaf("B"), leaf("D")],
        vec![15, 1],
    );
    let tree = group_with_shares("root", Axis::Horizontal, vec![inner, leaf("C")], vec![1, 1]);
    let step = plan_resize_step(&tree, &NodeId::from("B"), Direction::Right)
        .expect("outer boundary viable");
    assert_eq!(step.target_group, NodeId::from("root"));
    assert_eq!(step.focused_child, NodeId::from("inner"));
    assert_eq!(step.neighbor_child, NodeId::from("C"));
    assert_eq!(step.old_shares, vec![1, 1]);
    assert_eq!(step.new_shares, vec![18, 14]);
}

#[test]
fn resize_no_viable_candidate_returns_no_boundary() {
    // Same nesting, but the outer donor is also exhausted: root [15,1]
    // divisible with donor C == 1. Neither boundary applies.
    let inner = group_with_shares(
        "inner",
        Axis::Horizontal,
        vec![leaf("B"), leaf("D")],
        vec![15, 1],
    );
    let tree = group_with_shares(
        "root",
        Axis::Horizontal,
        vec![inner, leaf("C")],
        vec![15, 1],
    );
    assert_eq!(
        plan_resize_step(&tree, &NodeId::from("B"), Direction::Right),
        Err(ResizePlanError::NoBoundary)
    );
}

#[test]
fn resize_overflow_is_malformed_not_skipped() {
    // Valid topology (non-overflowing total) with unrepresentable transfer:
    // pair total not divisible by 16, x16 normalization overflows u64.
    // Must fail closed as Malformed, not silently skip outward.
    let tree = group_with_shares(
        "root",
        Axis::Horizontal,
        vec![leaf("A"), leaf("B")],
        vec![u64::MAX - 100, 1],
    );
    assert_eq!(
        plan_resize_step(&tree, &NodeId::from("A"), Direction::Right),
        Err(ResizePlanError::Malformed)
    );
    assert_eq!(expected_resize_shares(&[u64::MAX - 100, 1], 0, 1), None);
    // Overflowing pair total is likewise malformed.
    assert_eq!(expected_resize_shares(&[u64::MAX - 1, 2], 0, 1), None);
}

#[test]
fn apply_resize_shares_hardens_identities_and_shapes() {
    let tree = group("root", Axis::Horizontal, vec![leaf("A"), leaf("B")]);
    // Success preserves order/axis/descendants, replaces shares only.
    let next = apply_resize_shares(&tree, &NodeId::from("root"), &[14, 18]).expect("apply");
    match &next {
        Node::Group {
            id,
            axis,
            children,
            shares,
        } => {
            assert_eq!(id, &NodeId::from("root"));
            assert_eq!(*axis, Axis::Horizontal);
            assert_eq!(*shares, vec![14, 18]);
            assert_eq!(children.len(), 2);
            assert_eq!(children[0].id(), &NodeId::from("A"));
            assert_eq!(children[1].id(), &NodeId::from("B"));
        }
        other => panic!("unexpected {other:?}"),
    }
    // Nested target replaces only the nested group.
    let nested = Node::Group {
        id: NodeId::from("root"),
        axis: Axis::Horizontal,
        children: vec![
            Node::Group {
                id: NodeId::from("inner"),
                axis: Axis::Vertical,
                children: vec![leaf("A"), leaf("B")],
                shares: vec![1, 1],
            },
            leaf("C"),
        ],
        shares: vec![1, 1],
    };
    let next = apply_resize_shares(&nested, &NodeId::from("inner"), &[14, 18]).expect("nested");
    match &next {
        Node::Group {
            children, shares, ..
        } => {
            assert_eq!(*shares, vec![1, 1]);
            match &children[0] {
                Node::Group { shares, axis, .. } => {
                    assert_eq!(*shares, vec![14, 18]);
                    assert_eq!(*axis, Axis::Vertical);
                }
                other => panic!("inner {other:?}"),
            }
        }
        other => panic!("root {other:?}"),
    }
    // Duplicate node identities rejected (no first-match path).
    let dup = Node::Group {
        id: NodeId::from("root"),
        axis: Axis::Horizontal,
        children: vec![
            Node::Group {
                id: NodeId::from("dup"),
                axis: Axis::Horizontal,
                children: vec![leaf("A"), leaf("B")],
                shares: vec![1, 1],
            },
            Node::Group {
                id: NodeId::from("dup"),
                axis: Axis::Horizontal,
                children: vec![leaf("C"), leaf("D")],
                shares: vec![1, 1],
            },
        ],
        shares: vec![1, 1],
    };
    assert_eq!(
        apply_resize_shares(&dup, &NodeId::from("dup"), &[14, 18]),
        None
    );
    // Empty identities rejected anywhere in the tree.
    let empty = group("root", Axis::Horizontal, vec![leaf("A"), leaf("")]);
    assert_eq!(
        apply_resize_shares(&empty, &NodeId::from("root"), &[14, 18]),
        None
    );
    assert_eq!(
        apply_resize_shares(&tree, &NodeId::from(""), &[14, 18]),
        None
    );
    // Malformed group shares anywhere in the tree rejected.
    let zero = group_with_shares(
        "root",
        Axis::Horizontal,
        vec![leaf("A"), leaf("B")],
        vec![1, 0],
    );
    assert_eq!(
        apply_resize_shares(&zero, &NodeId::from("root"), &[14, 18]),
        None
    );
    let misaligned = group_with_shares(
        "root",
        Axis::Horizontal,
        vec![leaf("A"), leaf("B")],
        vec![1, 1, 1],
    );
    assert_eq!(
        apply_resize_shares(&misaligned, &NodeId::from("root"), &[14, 18]),
        None
    );
    let single = group_with_shares("root", Axis::Horizontal, vec![leaf("A")], vec![1]);
    assert_eq!(
        apply_resize_shares(&single, &NodeId::from("root"), &[14, 18]),
        None
    );
    let overflow_tree = group_with_shares(
        "root",
        Axis::Horizontal,
        vec![leaf("A"), leaf("B")],
        vec![u64::MAX, 1],
    );
    assert_eq!(
        apply_resize_shares(&overflow_tree, &NodeId::from("root"), &[14, 18]),
        None
    );
    // Target must be an existing group with matching arity.
    assert_eq!(
        apply_resize_shares(&tree, &NodeId::from("A"), &[14, 18]),
        None,
        "leaf target rejected"
    );
    assert_eq!(
        apply_resize_shares(&tree, &NodeId::from("missing"), &[14, 18]),
        None
    );
    assert_eq!(
        apply_resize_shares(&tree, &NodeId::from("root"), &[14, 18, 1]),
        None,
        "arity mismatch"
    );
    // Malformed replacement shares rejected.
    assert_eq!(
        apply_resize_shares(&tree, &NodeId::from("root"), &[14, 0]),
        None
    );
    assert_eq!(
        apply_resize_shares(&tree, &NodeId::from("root"), &[14]),
        None
    );
    assert_eq!(
        apply_resize_shares(&tree, &NodeId::from("root"), &[u64::MAX, u64::MAX]),
        None,
        "replacement total overflow"
    );
}

#[test]
fn rejects_empty_window_link_workspace_before_scope_comparison() {
    let mut snap = single_output(group("root", Axis::Horizontal, vec![leaf("A"), leaf("B")]));
    snap.windows[0].workspace = WorkspaceId::from("");
    assert!(matches!(
        plan_move(&snap, &intent("source", "A", Direction::Right)),
        MoveOutcome::Rejected {
            reason: Rejection {
                kind: RejectionKind::MalformedTopology,
                ..
            },
        }
    ));
}
