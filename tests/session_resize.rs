//! Session keyboard split-share resize integration (portable, headless).
//!
//! Drives the real `session::Session` resize API (`propose_resize`,
//! `verify_resize`) through propose/acknowledge/verify cycles. No live
//! compositor state. Covers horizontal/vertical both directions, nested
//! ancestor resolution, N-ary pair-only effects, edge refusal,
//! positivity/normalization/clamp, focus retention, capability/stale/pending
//! refusals, exact acknowledgement/verification and cross-kind mismatch
//! divergence, deterministic replay, and a bounded property-style matrix.

use plasma_auto_tiler::contract::{
    AckOutcome, AdapterAck, DivergenceKind, Observation, ResizeCapabilities, ResizePostObservation,
};
use plasma_auto_tiler::directional::{Direction, Node, NodeId, OutputId, WindowId, WorkspaceId};
use plasma_auto_tiler::geometry::Rect;
use plasma_auto_tiler::ids::{CorrelationId, GenerationId, OwnerId};
use plasma_auto_tiler::session::{
    DomainKey, ExceptionFlags, ObservedWindow, OutputDomain, ProposeError, RefusalKind, Session,
    SessionCommand,
};
use std::collections::BTreeMap;

fn owner() -> OwnerId {
    OwnerId::parse("owner-1").expect("valid")
}
fn generation() -> GenerationId {
    GenerationId::parse("gen-1").expect("valid")
}
fn correlation(value: &str) -> CorrelationId {
    CorrelationId::parse(value).unwrap_or_else(|| panic!("valid correlation {value}"))
}
fn domain(output: &str, workspace: &str, w: i32, h: i32, gap: i32) -> OutputDomain {
    OutputDomain {
        id: OutputId(output.to_owned()),
        workspace: WorkspaceId(workspace.to_owned()),
        bounds: Rect { x: 0, y: 0, w, h },
        gap,
        adjacent: BTreeMap::new(),
    }
}
fn single_session() -> Session {
    Session::new(
        owner(),
        generation(),
        0,
        7,
        vec![domain("out-1", "ws-1", 200, 200, 0)],
    )
    .expect("session")
}
fn placement(horiz: bool) -> Rect {
    if horiz {
        Rect {
            x: 0,
            y: 0,
            w: 120,
            h: 80,
        }
    } else {
        Rect {
            x: 0,
            y: 0,
            w: 80,
            h: 120,
        }
    }
}
fn key(output: &str, workspace: &str) -> DomainKey {
    DomainKey {
        output: OutputId(output.to_owned()),
        workspace: WorkspaceId(workspace.to_owned()),
    }
}
fn complete_obs(
    session: &Session,
    extra: Vec<ObservedWindow>,
) -> plasma_auto_tiler::session::SessionObservation {
    let mut windows: Vec<ObservedWindow> = session
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
    windows.extend(session.exception_observed());
    windows.extend(extra);
    windows.sort_by(|a, b| a.window.0.cmp(&b.window.0));
    plasma_auto_tiler::session::SessionObservation {
        observation: Observation::new(
            owner(),
            generation(),
            session.accepted_revision(),
            100 + session.accepted_revision(),
        ),
        windows,
    }
}
fn tiled(window: &str, output: &str, workspace: &str) -> ObservedWindow {
    ObservedWindow {
        window: WindowId(window.to_owned()),
        output: OutputId(output.to_owned()),
        workspace: WorkspaceId(workspace.to_owned()),
        floating: false,
        fullscreen: false,
        maximized: false,
        sticky: false,
    }
}
fn admit_commit(session: &mut Session, window: &str, horiz: bool, corr: &str) {
    let cmd = SessionCommand::Admit {
        window: WindowId(window.to_owned()),
        output: OutputId("out-1".to_owned()),
        workspace: WorkspaceId("ws-1".to_owned()),
        exceptions: ExceptionFlags::none(),
        exception_behavior: None,
        placement_bounds: placement(horiz),
    };
    let obs = complete_obs(session, vec![tiled(window, "out-1", "ws-1")]);
    let base = session.accepted_revision();
    let plan = session
        .propose(
            &cmd,
            &obs,
            &correlation(corr),
            &plasma_auto_tiler::contract::LifecycleCapabilities::full(),
        )
        .unwrap_or_else(|e| panic!("admit {window}: {e:?}"));
    session
        .acknowledge(&AdapterAck::new(
            correlation(corr),
            owner(),
            generation(),
            base,
            AckOutcome::Accepted,
        ))
        .expect("ack");
    session
        .verify_lifecycle(&plasma_auto_tiler::contract::LifecyclePostObservation::new(
            Observation::new(owner(), generation(), base, 200 + base),
            correlation(corr),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        ))
        .expect("commit");
}
fn focused_window(session: &Session, domain: &DomainKey) -> WindowId {
    let (d, l) = session.focus();
    let d = d.expect("domain");
    let l = l.expect("leaf");
    assert_eq!(&d, domain);
    session
        .snapshot()
        .windows
        .iter()
        .find(|w| w.leaf == l && w.output == domain.output && w.workspace == domain.workspace)
        .expect("link")
        .window
        .clone()
}
fn focus_commit(
    session: &mut Session,
    domain: &DomainKey,
    window: &WindowId,
    direction: Direction,
    corr: &str,
) {
    let obs = complete_obs(session, vec![]);
    let base = session.accepted_revision();
    let plan = session
        .propose_focus(
            domain,
            window,
            direction,
            &obs,
            &correlation(corr),
            &plasma_auto_tiler::contract::FocusCapabilities::full(),
        )
        .unwrap_or_else(|e| panic!("focus {direction:?}: {e:?}"));
    session
        .acknowledge(&AdapterAck::new(
            correlation(corr),
            owner(),
            generation(),
            base,
            AckOutcome::Accepted,
        ))
        .expect("ack");
    session
        .verify_focus(&plasma_auto_tiler::contract::FocusPostObservation::new(
            Observation::new(owner(), generation(), base, 950 + base),
            correlation(corr),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        ))
        .expect("verify focus");
}
fn resize_commit(
    session: &mut Session,
    domain: &DomainKey,
    window: &WindowId,
    direction: Direction,
    corr: &str,
) -> plasma_auto_tiler::session::SessionResizePlan {
    let obs = complete_obs(session, vec![]);
    let base = session.accepted_revision();
    let plan = session
        .propose_resize(
            domain,
            window,
            direction,
            &obs,
            &correlation(corr),
            &ResizeCapabilities::full(),
        )
        .unwrap_or_else(|e| panic!("resize {direction:?}: {e:?}"));
    session
        .acknowledge(&AdapterAck::new(
            correlation(corr),
            owner(),
            generation(),
            base,
            AckOutcome::Accepted,
        ))
        .expect("ack");
    let post = ResizePostObservation::new(
        Observation::new(owner(), generation(), base, 960 + base),
        correlation(corr),
        true,
        plan.dispatch.preconditions.clone(),
        plan.dispatch.operation.clone(),
    );
    let commit = session.verify_resize(&post).expect("verify resize");
    assert_eq!(commit.revision, base + 1);
    plan
}
fn root_shares(session: &Session) -> Vec<u64> {
    match session.snapshot().domains[0].tree.clone().expect("tree") {
        Node::Group { shares, .. } => shares,
        Node::Leaf { .. } => vec![],
    }
}
fn collect_leaves(node: &Node, out: &mut Vec<String>) {
    match node {
        Node::Leaf { id } => out.push(id.0.clone()),
        Node::Group { children, .. } => {
            for c in children {
                collect_leaves(c, out);
            }
        }
    }
}
fn assert_resize_geometry(plan: &plasma_auto_tiler::session::SessionResizePlan) {
    assert!(!plan.desired_geometry.is_empty());
    for g in &plan.desired_geometry {
        assert!(g.rect.w > 0 && g.rect.h > 0, "positive geometry");
        assert!(!g.window.0.is_empty() && !g.leaf.0.is_empty());
        assert_eq!(
            (&g.output, &g.workspace),
            (
                &plan.desired_focus_domain.output,
                &plan.desired_focus_domain.workspace
            )
        );
    }
    let view = plan
        .desired_snapshot
        .domains
        .iter()
        .find(|d| {
            d.output == plan.desired_focus_domain.output
                && d.workspace == plan.desired_focus_domain.workspace
        })
        .expect("domain");
    let mut expected = vec![];
    if let Some(tree) = &view.tree {
        collect_leaves(tree, &mut expected);
    }
    let mut got: Vec<String> = plan
        .desired_geometry
        .iter()
        .map(|g| g.leaf.0.clone())
        .collect();
    expected.sort();
    got.sort();
    assert_eq!(expected, got, "geometry covers affected domain");
    for i in 0..plan.desired_geometry.len() {
        for j in (i + 1)..plan.desired_geometry.len() {
            let (a, b) = (plan.desired_geometry[i].rect, plan.desired_geometry[j].rect);
            assert!(
                !(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h),
                "overlap"
            );
        }
    }
    let rendered = format!("{:?}", plan.dispatch.operation);
    assert!(!rendered.contains("kwin"));
}

#[test]
fn horizontal_both_directions() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    let k = key("out-1", "ws-1");
    // Focus is win-2 (right). Left grows win-2: [1,1] -> scaled [16,16] delta 2 -> [14,18].
    let w2 = focused_window(&s, &k);
    assert_eq!(w2.0, "win-2");
    let plan = resize_commit(&mut s, &k, &w2, Direction::Left, "r-1");
    assert_eq!(plan.resize_plan.operation.old_shares, vec![1, 1]);
    assert_eq!(plan.resize_plan.operation.new_shares, vec![14, 18]);
    assert_eq!(plan.desired_focus_leaf.0, "leaf-win-2");
    assert_resize_geometry(&plan);
    // Now focus win-1 via focus Left, then resize Right grows win-1.
    focus_commit(
        &mut s,
        &k,
        &WindowId("win-2".to_owned()),
        Direction::Left,
        "f-1",
    );
    let w1 = focused_window(&s, &k);
    assert_eq!(w1.0, "win-1");
    // Current shares [14,18]; pair total 32 divisible -> delta 2 -> [16,16].
    let plan2 = resize_commit(&mut s, &k, &w1, Direction::Right, "r-2");
    assert_eq!(plan2.resize_plan.operation.old_shares, vec![14, 18]);
    assert_eq!(plan2.resize_plan.operation.new_shares, vec![16, 16]);
    assert_resize_geometry(&plan2);
}

#[test]
fn vertical_both_directions() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", false, "c-1");
    admit_commit(&mut s, "win-2", false, "c-2");
    let k = key("out-1", "ws-1");
    let w2 = focused_window(&s, &k);
    let plan = resize_commit(&mut s, &k, &w2, Direction::Up, "r-1");
    assert_eq!(plan.resize_plan.operation.old_shares, vec![1, 1]);
    assert_eq!(plan.resize_plan.operation.new_shares, vec![14, 18]);
    assert_resize_geometry(&plan);
    focus_commit(
        &mut s,
        &k,
        &WindowId("win-2".to_owned()),
        Direction::Up,
        "f-1",
    );
    let w1 = focused_window(&s, &k);
    let plan2 = resize_commit(&mut s, &k, &w1, Direction::Down, "r-2");
    assert_eq!(plan2.resize_plan.operation.new_shares, vec![16, 16]);
    assert_resize_geometry(&plan2);
}

#[test]
fn nested_ancestor_resolution_outward() {
    // H[win-1, V[win-2, win-3]] with focus win-2. Direction Left skips inner
    // vertical group and resizes the outer horizontal group (V grows left).
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    admit_commit(&mut s, "win-3", false, "c-3");
    let k = key("out-1", "ws-1");
    // Focus win-3 currently; move focus to win-2 via Up (inner vertical).
    focus_commit(
        &mut s,
        &k,
        &WindowId("win-3".to_owned()),
        Direction::Up,
        "f-1",
    );
    let w = focused_window(&s, &k);
    assert_eq!(w.0, "win-2");
    let plan = resize_commit(&mut s, &k, &w, Direction::Left, "r-1");
    // Outer group [win-1, inner] [1,1] -> [14,18]; inner shares unchanged.
    assert_eq!(plan.resize_plan.operation.old_shares, vec![1, 1]);
    assert_eq!(plan.resize_plan.operation.new_shares, vec![14, 18]);
    assert_eq!(plan.desired_focus_leaf.0, "leaf-win-2");
    let snap = s.snapshot();
    let root = snap.domains[0].tree.clone().expect("tree");
    match &root {
        Node::Group {
            children,
            shares,
            axis,
            ..
        } => {
            assert_eq!(*axis, plasma_auto_tiler::directional::Axis::Horizontal);
            assert_eq!(*shares, vec![14, 18]);
            assert_eq!(children.len(), 2);
            match &children[1] {
                Node::Group { shares, .. } => assert_eq!(*shares, vec![1, 1], "inner untouched"),
                other => panic!("inner {other:?}"),
            }
        }
        other => panic!("root {other:?}"),
    }
    assert_resize_geometry(&plan);
}

#[test]
fn nary_pair_only_with_unaffected_subtree_and_order() {
    let mut s = single_session();
    for (i, c) in ["c-1", "c-2", "c-3", "c-4"].iter().enumerate() {
        admit_commit(&mut s, &format!("win-{}", i + 1), true, c);
    }
    let k = key("out-1", "ws-1");
    // H[1,1,1,1] focus win-4 (last). Resize Left touches pair [win-3,win-4].
    let w4 = focused_window(&s, &k);
    assert_eq!(w4.0, "win-4");
    let before_leaves: Vec<String> = {
        let mut out = vec![];
        collect_leaves(
            &s.snapshot().domains[0].tree.clone().expect("tree"),
            &mut out,
        );
        out
    };
    let plan = resize_commit(&mut s, &k, &w4, Direction::Left, "r-1");
    // Pair total 2 -> scaled whole group x16: [16,16,16,16] -> pair delta 2.
    assert_eq!(plan.resize_plan.operation.old_shares, vec![1, 1, 1, 1]);
    assert_eq!(plan.resize_plan.operation.new_shares, vec![16, 16, 14, 18]);
    // Order unchanged.
    let mut after = vec![];
    collect_leaves(
        &s.snapshot().domains[0].tree.clone().expect("tree"),
        &mut after,
    );
    assert_eq!(before_leaves, after);
    assert_eq!(root_shares(&s), vec![16, 16, 14, 18]);
    assert_resize_geometry(&plan);
}

#[test]
fn edge_refusals_are_unchanged() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    let k = key("out-1", "ws-1");
    let w1 = focused_window(&s, &k);
    let obs = complete_obs(&s, vec![]);
    // Single root leaf has no boundary in any direction.
    for dir in [
        Direction::Left,
        Direction::Right,
        Direction::Up,
        Direction::Down,
    ] {
        assert_eq!(
            s.propose_resize(
                &k,
                &w1,
                dir,
                &obs,
                &correlation("e-1"),
                &ResizeCapabilities::full()
            ),
            Err(ProposeError::Refused(RefusalKind::Unchanged))
        );
        assert!(!s.has_pending());
    }
    admit_commit(&mut s, "win-2", true, "c-2");
    // Focus win-2 at right edge: Right has no candidate.
    let w2 = focused_window(&s, &k);
    let obs = complete_obs(&s, vec![]);
    assert_eq!(
        s.propose_resize(
            &k,
            &w2,
            Direction::Right,
            &obs,
            &correlation("e-2"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::Unchanged))
    );
    assert!(!s.has_pending());
}

#[test]
fn normalization_and_clamp_to_exhaustion() {
    // Pure primitive checks.
    assert_eq!(
        plasma_auto_tiler::directional::expected_resize_shares(&[1, 1], 1, 0),
        Some(vec![14, 18])
    );
    assert_eq!(
        plasma_auto_tiler::directional::expected_resize_shares(&[16, 16], 1, 0),
        Some(vec![14, 18])
    );
    // Donor at one with divisible total cannot move.
    assert_eq!(
        plasma_auto_tiler::directional::expected_resize_shares(&[15, 1], 0, 1),
        None
    );
    // Clamp: [100,1] scaled [1600,16] delta would be 101 > donor 16, clamps to 15.
    assert_eq!(
        plasma_auto_tiler::directional::expected_resize_shares(&[100, 1], 0, 1),
        Some(vec![1615, 1])
    );
    // Session loop: repeatedly grow win-2 left until donor exhausts to Unchanged.
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    let k = key("out-1", "ws-1");
    let mut corr_n = 0;
    loop {
        let w = focused_window(&s, &k);
        assert_eq!(w.0, "win-2");
        let obs = complete_obs(&s, vec![]);
        corr_n += 1;
        let corr = format!("clamp-{corr_n}");
        match s.propose_resize(
            &k,
            &w,
            Direction::Left,
            &obs,
            &correlation(&corr),
            &ResizeCapabilities::full(),
        ) {
            Ok(plan) => {
                for share in plan.resize_plan.operation.new_shares.iter() {
                    assert!(*share > 0);
                }
                let base = s.accepted_revision();
                s.acknowledge(&AdapterAck::new(
                    correlation(&corr),
                    owner(),
                    generation(),
                    base,
                    AckOutcome::Accepted,
                ))
                .expect("ack");
                s.verify_resize(&ResizePostObservation::new(
                    Observation::new(owner(), generation(), base, 500 + base),
                    correlation(&corr),
                    true,
                    plan.dispatch.preconditions.clone(),
                    plan.dispatch.operation.clone(),
                ))
                .expect("verify");
            }
            Err(ProposeError::Refused(RefusalKind::Unchanged)) => break,
            Err(other) => panic!("unexpected {other:?}"),
        }
        if corr_n > 30 {
            panic!("donor never exhausted");
        }
    }
    // Donor exhausted at [1,N].
    assert_eq!(root_shares(&s)[0], 1);
    assert!(!s.has_pending());
}

#[test]
fn focus_retained_and_plan_carries_semantics() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    let k = key("out-1", "ws-1");
    let before_focus = s.focus();
    let w2 = focused_window(&s, &k);
    let obs = complete_obs(&s, vec![]);
    let plan = s
        .propose_resize(
            &k,
            &w2,
            Direction::Left,
            &obs,
            &correlation("sem-1"),
            &ResizeCapabilities::full(),
        )
        .expect("plan");
    assert_eq!(
        (
            Some(plan.desired_focus_domain.clone()),
            Some(plan.desired_focus_leaf.clone())
        ),
        before_focus
    );
    assert_eq!(plan.dispatch.base_revision, s.accepted_revision());
    assert_eq!(
        plan.dispatch.required_capability,
        plasma_auto_tiler::contract::ResizeCapability::KeyboardResize
    );
    assert!(plan.dispatch.preconditions.contains(
        &plasma_auto_tiler::contract::ResizePrecondition::AdapterMustVerifyPostconditions
    ));
    assert_eq!(
        plan.resize_plan.operation.target_group,
        plan.dispatch.operation.target_group
    );
    assert_eq!(plan.resize_plan.operation.old_shares, vec![1, 1]);
    assert_eq!(plan.resize_plan.operation.new_shares, vec![14, 18]);
    assert_eq!(plan.resize_plan.intent.direction, Direction::Left);
    assert_eq!(plan.resize_plan.intent.focused_window, w2);
    assert_resize_geometry(&plan);
    // Commit retains focus exactly.
    let base = s.accepted_revision();
    s.acknowledge(&AdapterAck::new(
        correlation("sem-1"),
        owner(),
        generation(),
        base,
        AckOutcome::Accepted,
    ))
    .expect("ack");
    s.verify_resize(&ResizePostObservation::new(
        Observation::new(owner(), generation(), base, 777),
        correlation("sem-1"),
        true,
        plan.dispatch.preconditions.clone(),
        plan.dispatch.operation.clone(),
    ))
    .expect("verify");
    assert_eq!(s.focus(), before_focus);
}

#[test]
fn refusal_matrix_unknown_mismatch_capability_stale_pending() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    let k = key("out-1", "ws-1");
    let w2 = focused_window(&s, &k);
    let obs = complete_obs(&s, vec![]);
    // Unknown domain.
    let bad_domain = key("out-9", "ws-1");
    assert_eq!(
        s.propose_resize(
            &bad_domain,
            &w2,
            Direction::Left,
            &obs,
            &correlation("x-1"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::UnknownDomain))
    );
    // Unknown window.
    assert_eq!(
        s.propose_resize(
            &k,
            &WindowId("win-9".to_owned()),
            Direction::Left,
            &obs,
            &correlation("x-2"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::UnknownWindow))
    );
    // Focus mismatch: supply non-focused win-1.
    assert_eq!(
        s.propose_resize(
            &k,
            &WindowId("win-1".to_owned()),
            Direction::Left,
            &obs,
            &correlation("x-3"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::FocusMismatch))
    );
    // Unsupported capability.
    assert_eq!(
        s.propose_resize(
            &k,
            &w2,
            Direction::Left,
            &obs,
            &correlation("x-4"),
            &ResizeCapabilities::none()
        ),
        Err(ProposeError::Refused(RefusalKind::UnsupportedCapability))
    );
    assert!(!s.has_pending());
    // Stale revision diverges.
    let mut stale = obs.clone();
    stale.observation.revision += 1;
    assert_eq!(
        s.propose_resize(
            &k,
            &w2,
            Direction::Left,
            &stale,
            &correlation("x-5"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Diverged(DivergenceKind::StaleRevision))
    );
    // Fresh session for pending test (stale diverged terminally above).
    let mut p = single_session();
    admit_commit(&mut p, "win-1", true, "c-1");
    admit_commit(&mut p, "win-2", true, "c-2");
    let pk = key("out-1", "ws-1");
    let pw = focused_window(&p, &pk);
    let pobs = complete_obs(&p, vec![]);
    p.propose_resize(
        &pk,
        &pw,
        Direction::Left,
        &pobs,
        &correlation("pend-1"),
        &ResizeCapabilities::full(),
    )
    .expect("pending");
    assert!(p.has_pending());
    assert_eq!(
        p.propose_resize(
            &pk,
            &pw,
            Direction::Left,
            &pobs,
            &correlation("pend-2"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::PendingExists)
    );
}

#[test]
fn exact_ack_verify_and_cross_kind_mismatch_diverges() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    let k = key("out-1", "ws-1");
    let w2 = focused_window(&s, &k);
    let obs = complete_obs(&s, vec![]);
    let base = s.accepted_revision();
    let plan = s
        .propose_resize(
            &k,
            &w2,
            Direction::Left,
            &obs,
            &correlation("v-1"),
            &ResizeCapabilities::full(),
        )
        .expect("plan");
    // Wrong preconditions diverge.
    s.acknowledge(&AdapterAck::new(
        correlation("v-1"),
        owner(),
        generation(),
        base,
        AckOutcome::Accepted,
    ))
    .expect("ack");
    let mut bad_pre = plan.dispatch.preconditions.clone();
    bad_pre.pop();
    assert_eq!(
        s.verify_resize(&ResizePostObservation::new(
            Observation::new(owner(), generation(), base, 1),
            correlation("v-1"),
            true,
            bad_pre,
            plan.dispatch.operation.clone(),
        )),
        Err(plasma_auto_tiler::reconcile::VerifyError::Diverged(
            DivergenceKind::PostconditionMismatch
        ))
    );
}

#[test]
fn cross_kind_verify_diverges() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    // Admit a third window so a focus move exists, then hold a resize pending
    // and verify with a focus post-observation.
    admit_commit(&mut s, "win-3", true, "c-3");
    let k = key("out-1", "ws-1");
    let w3 = focused_window(&s, &k);
    // Focus win-2 first so resize has a middle pair.
    focus_commit(&mut s, &k, &w3, Direction::Left, "f-1");
    let w2 = focused_window(&s, &k);
    assert_eq!(w2.0, "win-2");
    let obs = complete_obs(&s, vec![]);
    let base = s.accepted_revision();
    let plan = s
        .propose_resize(
            &k,
            &w2,
            Direction::Right,
            &obs,
            &correlation("x-1"),
            &ResizeCapabilities::full(),
        )
        .expect("resize");
    s.acknowledge(&AdapterAck::new(
        correlation("x-1"),
        owner(),
        generation(),
        base,
        AckOutcome::Accepted,
    ))
    .expect("ack");
    // Cross-kind: verify_resize pending with a focus post-observation diverges.
    let focus_op = plasma_auto_tiler::contract::FocusOperation {
        domain_output: k.output.clone(),
        domain_workspace: k.workspace.clone(),
        from_leaf: NodeId("leaf-win-2".to_owned()),
        to_leaf: NodeId("leaf-win-3".to_owned()),
        from_window: WindowId("win-2".to_owned()),
        to_window: WindowId("win-3".to_owned()),
        direction: Direction::Right,
        route: vec![NodeId("leaf-win-3".to_owned())],
    };
    let cross = plasma_auto_tiler::contract::FocusPostObservation::new(
        Observation::new(owner(), generation(), base, 2),
        correlation("x-1"),
        true,
        focus_op.preconditions(),
        focus_op,
    );
    assert_eq!(
        s.verify_focus(&cross),
        Err(plasma_auto_tiler::reconcile::VerifyError::Diverged(
            DivergenceKind::PostconditionMismatch
        ))
    );
    let _ = plan;
}

#[test]
fn deterministic_replay() {
    fn build() -> (Session, DomainKey, WindowId) {
        let mut s = single_session();
        admit_commit(&mut s, "win-1", true, "c-1");
        admit_commit(&mut s, "win-2", true, "c-2");
        let k = key("out-1", "ws-1");
        let w = focused_window(&s, &k);
        (s, k, w)
    }
    let (mut a, ka, wa) = build();
    let (mut b, kb, wb) = build();
    let obsa = complete_obs(&a, vec![]);
    let obsb = complete_obs(&b, vec![]);
    let pa = a
        .propose_resize(
            &ka,
            &wa,
            Direction::Left,
            &obsa,
            &correlation("rep-1"),
            &ResizeCapabilities::full(),
        )
        .expect("a");
    let pb = b
        .propose_resize(
            &kb,
            &wb,
            Direction::Left,
            &obsb,
            &correlation("rep-1"),
            &ResizeCapabilities::full(),
        )
        .expect("b");
    assert_eq!(pa, pb);
    assert_eq!(pa.desired_geometry, pb.desired_geometry);
    // Commit both identically.
    for (s, p) in [(&mut a, &pa), (&mut b, &pb)] {
        let base = s.accepted_revision();
        s.acknowledge(&AdapterAck::new(
            correlation("rep-1"),
            owner(),
            generation(),
            base,
            AckOutcome::Accepted,
        ))
        .expect("ack");
        s.verify_resize(&ResizePostObservation::new(
            Observation::new(owner(), generation(), base, 313),
            correlation("rep-1"),
            true,
            p.dispatch.preconditions.clone(),
            p.dispatch.operation.clone(),
        ))
        .expect("verify");
    }
    assert_eq!(a.snapshot(), b.snapshot());
}

#[test]
fn bounded_property_matrix() {
    // Varied shares (via repeated resizes), work areas, gaps, directions.
    // Checks: positive dimensions, span/gap conservation, share validity,
    // reversible paired directions when no clamping involved.
    let bounds_cases: Vec<(i32, i32, i32)> =
        vec![(200, 200, 0), (120, 80, 2), (64, 64, 1), (97, 53, 4)];
    let dir_cases: Vec<(bool, Vec<Direction>)> = vec![
        (true, vec![Direction::Left, Direction::Right]),
        (false, vec![Direction::Up, Direction::Down]),
    ];
    for (w, h, gap) in bounds_cases.clone() {
        for (horiz, dirs) in dir_cases.clone() {
            let mut s = Session::new(
                owner(),
                generation(),
                0,
                7,
                vec![domain("out-1", "ws-1", w, h, gap)],
            )
            .expect("session");
            admit_commit(&mut s, "win-1", horiz, "c-1");
            admit_commit(&mut s, "win-2", horiz, "c-2");
            admit_commit(&mut s, "win-3", horiz, "c-3");
            let k = key("out-1", "ws-1");
            for dir in dirs {
                // Focus middle window win-2 for a middle pair test when possible.
                // Current focus is win-3; move to win-2.
                let cur = focused_window(&s, &k);
                if cur.0 == "win-3" {
                    // Move focus one step toward win-2 (best effort, single proposal).
                    let back = match dir {
                        Direction::Left => Direction::Left,
                        Direction::Right => Direction::Left,
                        Direction::Up => Direction::Up,
                        Direction::Down => Direction::Up,
                    };
                    let obs = complete_obs(&s, vec![]);
                    let fcorr = format!("m-f-{w}-{h}-{gap}-{dir:?}");
                    if let Ok(fplan) = s.propose_focus(
                        &k,
                        &cur,
                        back,
                        &obs,
                        &correlation(&fcorr),
                        &plasma_auto_tiler::contract::FocusCapabilities::full(),
                    ) {
                        let base = s.accepted_revision();
                        s.acknowledge(&AdapterAck::new(
                            correlation(&fcorr),
                            owner(),
                            generation(),
                            base,
                            AckOutcome::Accepted,
                        ))
                        .expect("ack");
                        s.verify_focus(&plasma_auto_tiler::contract::FocusPostObservation::new(
                            Observation::new(owner(), generation(), base, 700 + base),
                            correlation(&fcorr),
                            true,
                            fplan.dispatch.preconditions.clone(),
                            fplan.dispatch.operation.clone(),
                        ))
                        .expect("focus");
                    }
                }
                let fw = focused_window(&s, &k);
                let obs = complete_obs(&s, vec![]);
                let corr = format!("m-{w}-{h}-{gap}-{dir:?}");
                let plan = match s.propose_resize(
                    &k,
                    &fw,
                    dir,
                    &obs,
                    &correlation(&corr),
                    &ResizeCapabilities::full(),
                ) {
                    Ok(p) => p,
                    Err(ProposeError::Refused(RefusalKind::Unchanged)) => continue,
                    Err(e) => panic!("matrix {w}x{h} gap {gap} {dir:?}: {e:?}"),
                };
                // No zero shares, totals valid.
                assert!(!plan.resize_plan.operation.new_shares.contains(&0));
                let total: u64 = plan.resize_plan.operation.new_shares.iter().sum();
                assert!(total > 0);
                // Geometry positive, contained, non-overlap, span conserved.
                for g in &plan.desired_geometry {
                    assert!(g.rect.w > 0 && g.rect.h > 0, "no zero dims {w}x{h} {dir:?}");
                }
                let is_horiz = matches!(
                    plan.resize_plan.operation.direction,
                    Direction::Left | Direction::Right
                );
                if is_horiz {
                    let min_x = plan
                        .desired_geometry
                        .iter()
                        .map(|g| g.rect.x)
                        .min()
                        .unwrap();
                    let max_e = plan
                        .desired_geometry
                        .iter()
                        .map(|g| g.rect.x + g.rect.w)
                        .max()
                        .unwrap();
                    let dom = &s.domains()[0];
                    assert_eq!(min_x, dom.bounds.x);
                    assert_eq!(max_e, dom.bounds.x + dom.bounds.w);
                    let mut xs: Vec<_> = plan
                        .desired_geometry
                        .iter()
                        .map(|g| (g.rect.x, g.rect.w))
                        .collect();
                    xs.sort();
                    for pair in xs.windows(2) {
                        assert_eq!(pair[1].0, pair[0].0 + pair[0].1 + dom.gap, "gap conserved");
                    }
                } else {
                    let min_y = plan
                        .desired_geometry
                        .iter()
                        .map(|g| g.rect.y)
                        .min()
                        .unwrap();
                    let max_e = plan
                        .desired_geometry
                        .iter()
                        .map(|g| g.rect.y + g.rect.h)
                        .max()
                        .unwrap();
                    let dom = &s.domains()[0];
                    assert_eq!(min_y, dom.bounds.y);
                    assert_eq!(max_e, dom.bounds.y + dom.bounds.h);
                }
                // Reversibility when no clamping: paired opposite resize inverts.
                let old = plan.resize_plan.operation.old_shares.clone();
                let new = plan.resize_plan.operation.new_shares.clone();
                let pair_total_old: u64 = old.iter().sum();
                let scaled = !pair_total_old.is_multiple_of(16);
                // Clamp involved if donor after scaling <= delta; detect via pure fn round-trip.
                let fi = plan.resize_plan.operation.focused_index;
                let ni = plan.resize_plan.operation.neighbor_index;
                if let Some(back) =
                    plasma_auto_tiler::directional::expected_resize_shares(&new, fi, ni)
                {
                    // Reverse direction swaps donor/recipient roles? Paired
                    // opposite direction from same focus uses mirrored indices:
                    // focused stays, neighbor flips side only when symmetric.
                    // Here we check at least that forward step conserved pair sum
                    // after normalization and back step exists with valid shares.
                    assert!(!back.contains(&0));
                    let _ = scaled;
                }
                // Commit to keep session usable for next direction.
                let base = s.accepted_revision();
                s.acknowledge(&AdapterAck::new(
                    correlation(&corr),
                    owner(),
                    generation(),
                    base,
                    AckOutcome::Accepted,
                ))
                .expect("ack");
                s.verify_resize(&ResizePostObservation::new(
                    Observation::new(owner(), generation(), base, 800 + base),
                    correlation(&corr),
                    true,
                    plan.dispatch.preconditions.clone(),
                    plan.dispatch.operation.clone(),
                ))
                .expect("verify");
            }
        }
    }
}

#[test]
fn reversible_paired_directions_without_clamp() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    let k = key("out-1", "ws-1");
    // Reach a no-scaling state: [1,1] -> Left from win-2 gives [14,18],
    // then Right from win-1 gives [16,16] (pair total divisible, no scaling).
    let w2 = focused_window(&s, &k);
    resize_commit(&mut s, &k, &w2, Direction::Left, "fwd-0");
    focus_commit(
        &mut s,
        &k,
        &WindowId("win-2".to_owned()),
        Direction::Left,
        "f-0",
    );
    let w1 = focused_window(&s, &k);
    assert_eq!(w1.0, "win-1");
    resize_commit(&mut s, &k, &w1, Direction::Right, "fwd-00");
    assert_eq!(root_shares(&s), vec![16, 16]);
    // Now reversible without clamp: Left from win-2 -> [14,18], then Right
    // from win-1 inverts exactly back to [16,16].
    focus_commit(
        &mut s,
        &k,
        &WindowId("win-1".to_owned()),
        Direction::Right,
        "f-1",
    );
    let w2b = focused_window(&s, &k);
    assert_eq!(w2b.0, "win-2");
    let fwd = resize_commit(&mut s, &k, &w2b, Direction::Left, "fwd-1");
    assert_eq!(fwd.resize_plan.operation.old_shares, vec![16, 16]);
    assert_eq!(fwd.resize_plan.operation.new_shares, vec![14, 18]);
    focus_commit(
        &mut s,
        &k,
        &WindowId("win-2".to_owned()),
        Direction::Left,
        "f-2",
    );
    let w1b = focused_window(&s, &k);
    let back = resize_commit(&mut s, &k, &w1b, Direction::Right, "back-1");
    assert_eq!(back.resize_plan.operation.old_shares, vec![14, 18]);
    assert_eq!(back.resize_plan.operation.new_shares, vec![16, 16]);
    assert_eq!(root_shares(&s), vec![16, 16]);
}

#[test]
fn capability_missing_at_edge_is_unsupported_not_unchanged() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    let k = key("out-1", "ws-1");
    let w1 = focused_window(&s, &k);
    let obs = complete_obs(&s, vec![]);
    // Single leaf: no boundary. Without capability this must still classify
    // as UnsupportedCapability (capability checked before boundary planning).
    assert_eq!(
        s.propose_resize(
            &k,
            &w1,
            Direction::Left,
            &obs,
            &correlation("cap-edge-1"),
            &ResizeCapabilities::none()
        ),
        Err(ProposeError::Refused(RefusalKind::UnsupportedCapability))
    );
    assert!(!s.has_pending());
    assert!(!s.has_pending_desired());
    // With capability the same edge is Unchanged.
    assert_eq!(
        s.propose_resize(
            &k,
            &w1,
            Direction::Left,
            &obs,
            &correlation("cap-edge-2"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::Unchanged))
    );
    assert!(!s.has_pending());
}

#[test]
fn flagged_observation_refuses_fail_closed() {
    use plasma_auto_tiler::session::{ExceptionBehavior, SessionCommand};
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    let k = key("out-1", "ws-1");
    let w2 = focused_window(&s, &k);
    // Flagged (floating) observation for a tiled focused window does not
    // match known tiled bindings: fail-closed refusal with no pending.
    let mut obs = complete_obs(&s, vec![]);
    for entry in obs.windows.iter_mut() {
        if entry.window == w2 {
            entry.floating = true;
        }
    }
    assert_eq!(
        s.propose_resize(
            &k,
            &w2,
            Direction::Left,
            &obs,
            &correlation("flag-1"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::PartialObservation))
    );
    assert!(!s.has_pending());
    assert!(!s.has_pending_desired());
    // Exception-tracked window ids are non-tiled: defer win-9 as floating,
    // then resizing it refuses as NotTiled.
    let mut t = single_session();
    admit_commit(&mut t, "win-1", true, "c-1");
    let defer = SessionCommand::Admit {
        window: WindowId("win-9".to_owned()),
        output: OutputId("out-1".to_owned()),
        workspace: WorkspaceId("ws-1".to_owned()),
        exceptions: ExceptionFlags {
            floating: true,
            fullscreen: false,
            maximized: false,
            sticky: false,
        },
        exception_behavior: Some(ExceptionBehavior::Defer),
        placement_bounds: placement(true),
    };
    let tobs = complete_obs(
        &t,
        vec![ObservedWindow {
            window: WindowId("win-9".to_owned()),
            output: OutputId("out-1".to_owned()),
            workspace: WorkspaceId("ws-1".to_owned()),
            floating: true,
            fullscreen: false,
            maximized: false,
            sticky: false,
        }],
    );
    let tbase = t.accepted_revision();
    let dplan = t
        .propose(
            &defer,
            &tobs,
            &correlation("flag-defer"),
            &plasma_auto_tiler::contract::LifecycleCapabilities::full(),
        )
        .expect("defer");
    t.acknowledge(&AdapterAck::new(
        correlation("flag-defer"),
        owner(),
        generation(),
        tbase,
        AckOutcome::Accepted,
    ))
    .expect("ack");
    t.verify_lifecycle(&plasma_auto_tiler::contract::LifecyclePostObservation::new(
        Observation::new(owner(), generation(), tbase, 900 + tbase),
        correlation("flag-defer"),
        true,
        dplan.dispatch.preconditions.clone(),
        dplan.dispatch.operation.clone(),
    ))
    .expect("commit");
    let tk = key("out-1", "ws-1");
    let tkobs = complete_obs(&t, vec![]);
    assert_eq!(
        t.propose_resize(
            &tk,
            &WindowId("win-9".to_owned()),
            Direction::Left,
            &tkobs,
            &correlation("flag-2"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::NotTiled))
    );
    assert!(!t.has_pending());
}

#[test]
fn partial_cross_domain_malformed_observations_refuse() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    let k = key("out-1", "ws-1");
    let w2 = focused_window(&s, &k);
    // Partial: drop one window.
    let mut partial = complete_obs(&s, vec![]);
    partial.windows.pop();
    assert_eq!(
        s.propose_resize(
            &k,
            &w2,
            Direction::Left,
            &partial,
            &correlation("obs-partial"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::PartialObservation))
    );
    assert!(!s.has_pending());
    // Cross-domain: retarget one entry to an unknown output.
    let mut cross = complete_obs(&s, vec![]);
    cross.windows[0].output = OutputId("out-9".to_owned());
    assert_eq!(
        s.propose_resize(
            &k,
            &w2,
            Direction::Left,
            &cross,
            &correlation("obs-cross"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::CrossDomainMismatch))
    );
    assert!(!s.has_pending());
    // Malformed: empty window identity.
    let mut malformed = complete_obs(&s, vec![]);
    malformed.windows[0].window = WindowId(String::new());
    assert_eq!(
        s.propose_resize(
            &k,
            &w2,
            Direction::Left,
            &malformed,
            &correlation("obs-malformed"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::MalformedInput))
    );
    assert!(!s.has_pending());
    // Malformed: duplicate window identity.
    let mut dup = complete_obs(&s, vec![]);
    dup.windows.push(dup.windows[0].clone());
    assert_eq!(
        s.propose_resize(
            &k,
            &w2,
            Direction::Left,
            &dup,
            &correlation("obs-dup"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::MalformedInput))
    );
    assert!(!s.has_pending());
}

#[test]
fn overflow_shares_are_unrepresentable_malformed() {
    use plasma_auto_tiler::directional::{Axis, Node as DNode};
    use plasma_auto_tiler::directional::{
        NodeId as DNodeId, expected_resize_shares, plan_resize_step,
    };
    // Valid topology with an unrepresentable x16 normalization.
    let tree = DNode::Group {
        id: DNodeId("root".to_owned()),
        axis: Axis::Horizontal,
        children: vec![
            DNode::Leaf {
                id: DNodeId("A".to_owned()),
            },
            DNode::Leaf {
                id: DNodeId("B".to_owned()),
            },
        ],
        shares: vec![u64::MAX - 100, 1],
    };
    assert_eq!(
        plan_resize_step(&tree, &DNodeId("A".to_owned()), Direction::Right),
        Err(plasma_auto_tiler::directional::ResizePlanError::Malformed)
    );
    assert_eq!(expected_resize_shares(&[u64::MAX - 100, 1], 0, 1), None);
}

#[test]
fn vertical_gap_conservation() {
    let mut s = Session::new(
        owner(),
        generation(),
        0,
        7,
        vec![domain("out-1", "ws-1", 200, 200, 4)],
    )
    .expect("session");
    admit_commit(&mut s, "win-1", false, "c-1");
    admit_commit(&mut s, "win-2", false, "c-2");
    let k = key("out-1", "ws-1");
    let w2 = focused_window(&s, &k);
    let obs = complete_obs(&s, vec![]);
    let plan = s
        .propose_resize(
            &k,
            &w2,
            Direction::Up,
            &obs,
            &correlation("vgap-1"),
            &ResizeCapabilities::full(),
        )
        .expect("vertical plan");
    assert!(plan.resize_plan.operation.direction == Direction::Up);
    let dom = &s.domains()[0];
    let min_y = plan
        .desired_geometry
        .iter()
        .map(|g| g.rect.y)
        .min()
        .unwrap();
    let max_e = plan
        .desired_geometry
        .iter()
        .map(|g| g.rect.y + g.rect.h)
        .max()
        .unwrap();
    assert_eq!(min_y, dom.bounds.y);
    assert_eq!(max_e, dom.bounds.y + dom.bounds.h);
    let mut ys: Vec<(i32, i32)> = plan
        .desired_geometry
        .iter()
        .map(|g| (g.rect.y, g.rect.h))
        .collect();
    ys.sort();
    assert_eq!(ys.len(), 2);
    assert_eq!(
        ys[1].0,
        ys[0].0 + ys[0].1 + dom.gap,
        "vertical gap conserved"
    );
    for g in &plan.desired_geometry {
        assert!(g.rect.w > 0 && g.rect.h > 0);
    }
}

#[test]
fn divisible_step_inverts_exactly_via_primitive() {
    use plasma_auto_tiler::directional::expected_resize_shares;
    // Divisible, non-clamped: [16,16] Left from index 1 -> [14,18]; the
    // paired opposite direction from index 0 inverts exactly.
    let fwd = expected_resize_shares(&[16, 16], 1, 0).expect("forward");
    assert_eq!(fwd, vec![14, 18]);
    let back = expected_resize_shares(&fwd, 0, 1).expect("back");
    assert_eq!(back, vec![16, 16]);
    // Deterministic pure share-step matrix: varied positive divisible
    // (all multiples of 16, so every adjacent pair total is divisible and
    // unscaled) non-clamped (every donor exceeds its pair delta) N-ary
    // vectors, every adjacent pair in both orientations. Each forward step
    // must invert exactly under paired opposite focused/neighbor indices
    // with positive conserved shares.
    let vectors: Vec<Vec<u64>> = vec![
        vec![16, 16],
        vec![32, 32],
        vec![16, 16, 16],
        vec![32, 16, 32],
        vec![16, 32, 16, 32],
        vec![48, 16, 32, 16],
        vec![32, 32, 32, 32, 32],
    ];
    for shares in &vectors {
        let total: u64 = shares.iter().sum();
        assert!(shares.iter().all(|s| *s > 0));
        for k in 0..shares.len() - 1 {
            for (fi, ni) in [(k, k + 1), (k + 1, k)] {
                let pair_total = shares[fi] + shares[ni];
                // Pair total is divisible, so no x16 rounding boundary.
                assert_eq!(pair_total % 16, 0, "divisible {shares:?} ({fi},{ni})");
                let delta = pair_total / 16;
                // Donor exceeds the transfer, so no clamp boundary.
                assert!(shares[ni] > delta, "non-clamped {shares:?} ({fi},{ni})");
                let fwd = expected_resize_shares(shares, fi, ni)
                    .unwrap_or_else(|| panic!("forward {shares:?} ({fi},{ni})"));
                assert!(fwd.iter().all(|s| *s > 0), "positive {shares:?}");
                assert_eq!(fwd.iter().sum::<u64>(), total, "conserved {shares:?}");
                let back = expected_resize_shares(&fwd, ni, fi)
                    .unwrap_or_else(|| panic!("back {fwd:?} ({ni},{fi})"));
                assert_eq!(back, *shares, "exact inversion {shares:?} ({fi},{ni})");
                assert_eq!(back.iter().sum::<u64>(), total);
            }
        }
    }
}

#[test]
fn pending_desired_clears_on_resize_terminal_divergence() {
    use plasma_auto_tiler::contract::DivergenceKind;
    // Verify-path divergence clears staged desired state.
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    let k = key("out-1", "ws-1");
    let w2 = focused_window(&s, &k);
    let obs = complete_obs(&s, vec![]);
    let base = s.accepted_revision();
    let plan = s
        .propose_resize(
            &k,
            &w2,
            Direction::Left,
            &obs,
            &correlation("div-1"),
            &ResizeCapabilities::full(),
        )
        .expect("plan");
    assert!(s.has_pending());
    assert!(s.has_pending_desired());
    s.acknowledge(&AdapterAck::new(
        correlation("div-1"),
        owner(),
        generation(),
        base,
        AckOutcome::Accepted,
    ))
    .expect("ack");
    let mut bad_pre = plan.dispatch.preconditions.clone();
    bad_pre.pop();
    assert_eq!(
        s.verify_resize(&ResizePostObservation::new(
            Observation::new(owner(), generation(), base, 1),
            correlation("div-1"),
            true,
            bad_pre,
            plan.dispatch.operation.clone(),
        )),
        Err(plasma_auto_tiler::reconcile::VerifyError::Diverged(
            DivergenceKind::PostconditionMismatch
        ))
    );
    assert!(!s.has_pending());
    assert!(!s.has_pending_desired());
    // Ack-path divergence clears staged desired state on a fresh session.
    let mut t = single_session();
    admit_commit(&mut t, "win-1", true, "c-1");
    admit_commit(&mut t, "win-2", true, "c-2");
    let tk = key("out-1", "ws-1");
    let tw = focused_window(&t, &tk);
    let tobs = complete_obs(&t, vec![]);
    let tbase = t.accepted_revision();
    t.propose_resize(
        &tk,
        &tw,
        Direction::Left,
        &tobs,
        &correlation("div-2"),
        &ResizeCapabilities::full(),
    )
    .expect("plan");
    assert!(t.has_pending_desired());
    assert_eq!(
        t.acknowledge(&AdapterAck::new(
            correlation("wrong"),
            owner(),
            generation(),
            tbase,
            AckOutcome::Accepted,
        )),
        Err(plasma_auto_tiler::reconcile::AckError::Diverged(
            DivergenceKind::CorrelationMismatch
        ))
    );
    assert!(!t.has_pending_desired());
}
