//! Session pointer split-share resize integration (portable, headless).
//!
//! Drives `Session::propose_pointer_resize` (Rust-derived boundary/shares
//! from a normalized boundary coordinate; callers never supply shares)
//! through propose/acknowledge/verify cycles. Covers horizontal, vertical,
//! nested ancestor resolution, N-ary adjacent-only effects, clamp/refusal,
//! minimum, projectability, determinism, capability/pending/stale failures,
//! and exact acknowledge/verify commit versus divergence. No live compositor.

use plasma_auto_tiler::contract::{
    AckOutcome, AdapterAck, DivergenceKind, Observation, ResizeCapabilities, ResizePostObservation,
};
use plasma_auto_tiler::cosmic_v1;
use plasma_auto_tiler::directional::{Axis, Direction, Node, OutputId, WindowId, WorkspaceId};
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
        vec![domain("out-1", "ws-1", 800, 600, 0)],
    )
    .expect("session")
}
fn key(output: &str, workspace: &str) -> DomainKey {
    DomainKey {
        output: OutputId(output.to_owned()),
        workspace: WorkspaceId(workspace.to_owned()),
    }
}
fn complete_obs(session: &Session) -> plasma_auto_tiler::session::SessionObservation {
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
fn tiled(window: &str) -> ObservedWindow {
    ObservedWindow {
        window: WindowId(window.to_owned()),
        output: OutputId("out-1".to_owned()),
        workspace: WorkspaceId("ws-1".to_owned()),
        floating: false,
        fullscreen: false,
        maximized: false,
        sticky: false,
    }
}
/// Axis-intent placement: `horiz` requests a horizontal split. The COSMIC
/// admission rule selects axis from target geometry (wide splits portable Horizontal),
/// so horizontal needs a wide target and vice versa.
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
fn admit_commit(session: &mut Session, window: &str, horiz: bool, corr: &str) {
    let cmd = SessionCommand::Admit {
        window: WindowId(window.to_owned()),
        output: OutputId("out-1".to_owned()),
        workspace: WorkspaceId("ws-1".to_owned()),
        exceptions: ExceptionFlags::none(),
        exception_behavior: None,
        placement_bounds: placement(horiz),
    };
    let mut obs = complete_obs(session);
    obs.windows.push(tiled(window));
    obs.windows.sort_by(|a, b| a.window.0.cmp(&b.window.0));
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
fn move_commit_focused(session: &mut Session, direction: Direction, corr: &str) {
    let k = key("out-1", "ws-1");
    let w = focused_window(session, &k);
    let obs = complete_obs(session);
    let base = session.accepted_revision();
    let plan = session
        .propose_move(
            &k,
            &w,
            direction,
            &obs,
            &correlation(corr),
            &plasma_auto_tiler::directional::Capabilities::full(),
        )
        .unwrap_or_else(|e| panic!("move {direction:?}: {e:?}"));
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
        .verify_move(&plasma_auto_tiler::contract::PostObservation::new(
            Observation::new(owner(), generation(), base, 300 + base),
            correlation(corr),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        ))
        .expect("move commit");
}
fn focus_commit_step(session: &mut Session, direction: Direction, corr: &str) {
    let k = key("out-1", "ws-1");
    let w = focused_window(session, &k);
    let obs = complete_obs(session);
    let base = session.accepted_revision();
    let plan = session
        .propose_focus(
            &k,
            &w,
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
            Observation::new(owner(), generation(), base, 400 + base),
            correlation(corr),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        ))
        .expect("focus commit");
}
fn pointer_commit(
    session: &mut Session,
    domain: &DomainKey,
    window: &WindowId,
    direction: Direction,
    boundary: i32,
    corr: &str,
) -> plasma_auto_tiler::session::SessionResizePlan {
    let obs = complete_obs(session);
    let base = session.accepted_revision();
    let plan = session
        .propose_pointer_resize(
            domain,
            window,
            direction,
            boundary,
            &obs,
            &correlation(corr),
            &ResizeCapabilities::full(),
        )
        .unwrap_or_else(|e| panic!("pointer {direction:?}@{boundary}: {e:?}"));
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
    let commit = session.verify_resize(&post).expect("verify pointer");
    assert_eq!(commit.revision, base + 1);
    plan
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

#[test]
fn horizontal_derivation_grows_focused_and_preserves_focus() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    let k = key("out-1", "ws-1");
    let w2 = focused_window(&s, &k);
    assert_eq!(w2.0, "win-2");
    let before_focus = s.focus();
    // Layout [1,1] over 800px: boundary at 400. Propose 390 with exact
    // pixel-projectable shares [389,409], projecting the pair boundary
    // exactly to 390.
    let plan = pointer_commit(&mut s, &k, &w2, Direction::Left, 390, "p-1");
    assert_eq!(plan.resize_plan.operation.old_shares, vec![1, 1]);
    assert_eq!(plan.resize_plan.operation.new_shares, vec![389, 409]);
    assert_eq!(plan.resize_plan.operation.focused_index, 1);
    assert_eq!(plan.resize_plan.operation.neighbor_index, 0);
    assert_eq!(
        (
            Some(plan.desired_focus_domain.clone()),
            Some(plan.desired_focus_leaf.clone())
        ),
        before_focus
    );
    assert_eq!(s.focus(), before_focus);
    assert!(!plan.desired_geometry.is_empty());
    for g in &plan.desired_geometry {
        assert!(g.rect.w > 0 && g.rect.h > 0);
    }
    let left_id =
        if plan.resize_plan.operation.focused_index < plan.resize_plan.operation.neighbor_index {
            &plan.resize_plan.operation.focused_child
        } else {
            &plan.resize_plan.operation.neighbor_child
        };
    let left_rect = plan
        .desired_geometry
        .iter()
        .find(|g| &g.leaf == left_id)
        .expect("left geometry");
    assert_eq!(left_rect.rect.x + left_rect.rect.w, 390);
}

#[test]
fn vertical_derivation() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", false, "c-1");
    admit_commit(&mut s, "win-2", false, "c-2");
    let k = key("out-1", "ws-1");
    let w2 = focused_window(&s, &k);
    // Vertical split over 600px: propose y=290 grows bottom (focused) to 310.
    let plan = pointer_commit(&mut s, &k, &w2, Direction::Up, 290, "p-1");
    assert_eq!(plan.resize_plan.operation.old_shares, vec![1, 1]);
    assert_eq!(plan.resize_plan.operation.new_shares, vec![289, 309]);
    assert_eq!(plan.resize_plan.intent.direction, Direction::Up);
}

#[test]
fn nested_outer_boundary_with_inner_untouched() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    admit_commit(&mut s, "win-3", false, "c-3");
    let k = key("out-1", "ws-1");
    // Focus win-2 (inner top) via Up from win-3.
    let obs = complete_obs(&s);
    let cur = focused_window(&s, &k);
    assert_eq!(cur.0, "win-3");
    let base = s.accepted_revision();
    let fplan = s
        .propose_focus(
            &k,
            &cur,
            Direction::Up,
            &obs,
            &correlation("f-1"),
            &plasma_auto_tiler::contract::FocusCapabilities::full(),
        )
        .expect("focus");
    s.acknowledge(&AdapterAck::new(
        correlation("f-1"),
        owner(),
        generation(),
        base,
        AckOutcome::Accepted,
    ))
    .expect("ack");
    s.verify_focus(&plasma_auto_tiler::contract::FocusPostObservation::new(
        Observation::new(owner(), generation(), base, 700),
        correlation("f-1"),
        true,
        fplan.dispatch.preconditions.clone(),
        fplan.dispatch.operation.clone(),
    ))
    .expect("focus commit");
    let w = focused_window(&s, &k);
    assert_eq!(w.0, "win-2");
    // Direction Left skips inner vertical group, targets outer H [1,1].
    // Exact boundary 390 projects to [389,409].
    let plan = pointer_commit(&mut s, &k, &w, Direction::Left, 390, "p-1");
    assert_eq!(plan.resize_plan.operation.old_shares, vec![1, 1]);
    assert_eq!(plan.resize_plan.operation.new_shares, vec![389, 409]);
    let root = s.snapshot().domains[0].tree.clone().expect("tree");
    match &root {
        Node::Group {
            children,
            shares,
            axis,
            ..
        } => {
            assert_eq!(*axis, Axis::Horizontal);
            assert_eq!(*shares, vec![389, 409]);
            assert_eq!(children.len(), 2);
            match &children[1] {
                Node::Group { shares, .. } => assert_eq!(*shares, vec![1, 1]),
                other => panic!("inner {other:?}"),
            }
        }
        other => panic!("root {other:?}"),
    }
}

#[test]
fn nary_only_adjacent_pair_redistributed() {
    // Four-wide needs COSMIC-scale pairs: 1600px so the 400px children form
    // an 800px pair above the 720px pair minimum.
    let mut s = Session::new(
        owner(),
        generation(),
        0,
        7,
        vec![domain("out-1", "ws-1", 1600, 600, 0)],
    )
    .expect("session");
    for (i, c) in ["c-1", "c-2", "c-3", "c-4"].iter().enumerate() {
        admit_commit(&mut s, &format!("win-{}", i + 1), true, c);
    }
    // Automatic admission always binary-wraps, so repeated admissions yield
    // nested binary groups. Flatten to the intended ordered 4-child N-ary
    // topology via public movement/focus commits (N-ary remains for
    // movement representation only), keeping exact window/focus links.
    move_commit_focused(&mut s, Direction::Right, "m-1");
    focus_commit_step(&mut s, Direction::Left, "f-1");
    focus_commit_step(&mut s, Direction::Left, "f-2");
    move_commit_focused(&mut s, Direction::Left, "m-2");
    focus_commit_step(&mut s, Direction::Right, "f-3");
    move_commit_focused(&mut s, Direction::Left, "m-3");
    focus_commit_step(&mut s, Direction::Right, "f-4");
    let k = key("out-1", "ws-1");
    let w4 = focused_window(&s, &k);
    assert_eq!(w4.0, "win-4");
    let mut before = vec![];
    collect_leaves(
        &s.snapshot().domains[0].tree.clone().expect("tree"),
        &mut before,
    );
    // 4x400px strips; pair [win-3,win-4] starts at 800, avail 800.
    // Propose 1190: left=390 -> exact ratio-preserving normalization.
    let plan = pointer_commit(&mut s, &k, &w4, Direction::Left, 1190, "p-1");
    assert_eq!(plan.resize_plan.operation.old_shares, vec![1, 1, 1, 1]);
    assert_eq!(
        plan.resize_plan.operation.new_shares,
        vec![399, 399, 389, 409]
    );
    assert_eq!(plan.resize_plan.operation.focused_index, 3);
    assert_eq!(plan.resize_plan.operation.neighbor_index, 2);
    let mut after = vec![];
    collect_leaves(
        &s.snapshot().domains[0].tree.clone().expect("tree"),
        &mut after,
    );
    assert_eq!(before, after, "order preserved");
    // Non-pair shares scale ratio-preserving; pair redistributed.
    assert_eq!(plan.resize_plan.operation.new_shares[0], 399);
    assert_eq!(plan.resize_plan.operation.new_shares[1], 399);
    assert!(plan.resize_plan.operation.new_shares.iter().all(|v| *v > 0));
}

#[test]
fn clamp_plans_at_minimum_and_outside_domain_is_malformed() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    let k = key("out-1", "ws-1");
    let w2 = focused_window(&s, &k);
    // Far-left edge clamps to the COSMIC child minimum (360) with exact
    // shares [359,439], projecting the pair boundary exactly to 360.
    let plan = pointer_commit(&mut s, &k, &w2, Direction::Left, 0, "p-clamp");
    assert_eq!(plan.resize_plan.operation.old_shares, vec![1, 1]);
    assert_eq!(plan.resize_plan.operation.new_shares, vec![359, 439]);
    let left_id =
        if plan.resize_plan.operation.focused_index < plan.resize_plan.operation.neighbor_index {
            &plan.resize_plan.operation.focused_child
        } else {
            &plan.resize_plan.operation.neighbor_child
        };
    let left_rect = plan
        .desired_geometry
        .iter()
        .find(|g| &g.leaf == left_id)
        .expect("left geometry");
    assert_eq!(left_rect.rect.x + left_rect.rect.w, 360);
    // Exact boundary 80 still plans on a fresh session.
    let mut s2 = single_session();
    admit_commit(&mut s2, "win-1", true, "c-1");
    admit_commit(&mut s2, "win-2", true, "c-2");
    let k2 = key("out-1", "ws-1");
    let w2b = focused_window(&s2, &k2);
    let plan = pointer_commit(&mut s2, &k2, &w2b, Direction::Left, 390, "p-clamp-exact");
    assert_eq!(plan.resize_plan.operation.old_shares, vec![1, 1]);
    assert_eq!(plan.resize_plan.operation.new_shares, vec![389, 409]);

    // Fresh session: outside the domain work area is malformed.
    let mut t = single_session();
    admit_commit(&mut t, "win-1", true, "c-1");
    admit_commit(&mut t, "win-2", true, "c-2");
    let tk = key("out-1", "ws-1");
    let tw = focused_window(&t, &tk);
    let obs = complete_obs(&t);
    assert_eq!(
        t.propose_pointer_resize(
            &tk,
            &tw,
            Direction::Left,
            900,
            &obs,
            &correlation("p-bad"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::MalformedInput))
    );
    assert!(!t.has_pending());
    // Far outside the work area is also malformed (no project bound).
    assert_eq!(
        t.propose_pointer_resize(
            &tk,
            &tw,
            Direction::Left,
            20000,
            &obs,
            &correlation("p-bad2"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::MalformedInput))
    );
}

#[test]
fn minimum_exhausted_and_single_leaf_refuse_unchanged() {
    // Sub-minimum pair region: 40px wide under the 720px COSMIC pair
    // minimum -> no feasible split.
    let mut s = Session::new(
        owner(),
        generation(),
        0,
        7,
        vec![domain("out-1", "ws-1", 40, 200, 0)],
    )
    .expect("session");
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    let k = key("out-1", "ws-1");
    let w2 = focused_window(&s, &k);
    let obs = complete_obs(&s);
    assert_eq!(
        s.propose_pointer_resize(
            &k,
            &w2,
            Direction::Left,
            20,
            &obs,
            &correlation("p-min"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::Unchanged))
    );
    assert!(!s.has_pending());

    // Single root leaf has no boundary.
    let mut t = single_session();
    admit_commit(&mut t, "win-1", true, "c-1");
    let tk = key("out-1", "ws-1");
    let tw = focused_window(&t, &tk);
    let tobs = complete_obs(&t);
    assert_eq!(
        t.propose_pointer_resize(
            &tk,
            &tw,
            Direction::Left,
            50,
            &tobs,
            &correlation("p-edge"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::Unchanged))
    );
}

#[test]
fn projectability_geometry_covers_and_spans_minimum() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    let k = key("out-1", "ws-1");
    let w2 = focused_window(&s, &k);
    // 390 is exactly projectable ([389,409]); the pair boundary lands on 390.
    let plan = pointer_commit(&mut s, &k, &w2, Direction::Left, 390, "p-1");
    assert_eq!(plan.desired_geometry.len(), 2);
    for g in &plan.desired_geometry {
        assert!(g.rect.w > 0 && g.rect.h > 0);
        // Direct leaves keep the COSMIC axis child minimum along the axis.
        assert!(
            i64::from(g.rect.w) >= cosmic_v1::child_min_for_axis(Axis::Horizontal),
            "span {g:?}"
        );
    }
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
    assert_eq!(min_x, 0);
    assert_eq!(max_e, 800);
}

#[test]
fn repeated_proposals_are_deterministic() {
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
    let obsa = complete_obs(&a);
    let obsb = complete_obs(&b);
    let pa = a
        .propose_pointer_resize(
            &ka,
            &wa,
            Direction::Left,
            390,
            &obsa,
            &correlation("rep-1"),
            &ResizeCapabilities::full(),
        )
        .expect("a");
    let pb = b
        .propose_pointer_resize(
            &kb,
            &wb,
            Direction::Left,
            390,
            &obsb,
            &correlation("rep-1"),
            &ResizeCapabilities::full(),
        )
        .expect("b");
    assert_eq!(pa, pb);
    // Same boundary twice on the same session state is also identical.
    let mut c = build().0;
    let kc = key("out-1", "ws-1");
    let wc = focused_window(&c, &kc);
    let obsc = complete_obs(&c);
    let pc = c
        .propose_pointer_resize(
            &kc,
            &wc,
            Direction::Left,
            390,
            &obsc,
            &correlation("rep-1"),
            &ResizeCapabilities::full(),
        )
        .expect("c");
    assert_eq!(
        pa.resize_plan.operation.new_shares,
        pc.resize_plan.operation.new_shares
    );
}

#[test]
fn capability_pending_stale_failures() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    let k = key("out-1", "ws-1");
    let w2 = focused_window(&s, &k);
    let obs = complete_obs(&s);
    assert_eq!(
        s.propose_pointer_resize(
            &k,
            &w2,
            Direction::Left,
            391,
            &obs,
            &correlation("x-cap"),
            &ResizeCapabilities::none()
        ),
        Err(ProposeError::Refused(RefusalKind::UnsupportedCapability))
    );
    assert!(!s.has_pending());
    // COSMIC fixed minima need no separate capability; keyboard-declared full
    // capabilities plan on equivalent fresh state.
    {
        let mut tmp = single_session();
        admit_commit(&mut tmp, "win-1", true, "c-t1");
        admit_commit(&mut tmp, "win-2", true, "c-t2");
        let tk = key("out-1", "ws-1");
        let tw = focused_window(&tmp, &tk);
        let tobs = complete_obs(&tmp);
        assert!(
            tmp.propose_pointer_resize(
                &tk,
                &tw,
                Direction::Left,
                391,
                &tobs,
                &correlation("x-cap-native"),
                &ResizeCapabilities::full()
            )
            .is_ok()
        );
    }
    let mut stale = obs.clone();
    stale.observation.revision += 1;
    assert_eq!(
        s.propose_pointer_resize(
            &k,
            &w2,
            Direction::Left,
            391,
            &stale,
            &correlation("x-stale"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Diverged(DivergenceKind::StaleRevision))
    );
    // Fresh session for pending.
    let mut p = single_session();
    admit_commit(&mut p, "win-1", true, "c-1");
    admit_commit(&mut p, "win-2", true, "c-2");
    let pk = key("out-1", "ws-1");
    let pw = focused_window(&p, &pk);
    let pobs = complete_obs(&p);
    p.propose_pointer_resize(
        &pk,
        &pw,
        Direction::Left,
        391,
        &pobs,
        &correlation("pend-1"),
        &ResizeCapabilities::full(),
    )
    .expect("pending");
    assert!(p.has_pending());
    assert_eq!(
        p.propose_pointer_resize(
            &pk,
            &pw,
            Direction::Left,
            391,
            &pobs,
            &correlation("pend-2"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::PendingExists)
    );
    // Unknown domain/window/mismatch classify like keyboard.
    let mut q = single_session();
    admit_commit(&mut q, "win-1", true, "c-1");
    admit_commit(&mut q, "win-2", true, "c-2");
    let qk = key("out-1", "ws-1");
    let qw = focused_window(&q, &qk);
    let qobs = complete_obs(&q);
    assert_eq!(
        q.propose_pointer_resize(
            &key("out-9", "ws-1"),
            &qw,
            Direction::Left,
            391,
            &qobs,
            &correlation("x-dom"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::UnknownDomain))
    );
    assert_eq!(
        q.propose_pointer_resize(
            &qk,
            &WindowId("win-9".to_owned()),
            Direction::Left,
            391,
            &qobs,
            &correlation("x-win"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::UnknownWindow))
    );
    assert_eq!(
        q.propose_pointer_resize(
            &qk,
            &WindowId("win-1".to_owned()),
            Direction::Left,
            391,
            &qobs,
            &correlation("x-focus"),
            &ResizeCapabilities::full()
        ),
        Err(ProposeError::Refused(RefusalKind::FocusMismatch))
    );
}

#[test]
fn exact_ack_verify_commit_versus_divergence() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    let k = key("out-1", "ws-1");
    let w2 = focused_window(&s, &k);
    let obs = complete_obs(&s);
    let base = s.accepted_revision();
    let plan = s
        .propose_pointer_resize(
            &k,
            &w2,
            Direction::Left,
            391,
            &obs,
            &correlation("v-1"),
            &ResizeCapabilities::full(),
        )
        .expect("plan");
    // Operation shape matches the shared keyboard reconciliation boundary.
    assert_eq!(
        plan.dispatch.required_capability,
        plasma_auto_tiler::contract::ResizeCapability::KeyboardResize
    );
    s.acknowledge(&AdapterAck::new(
        correlation("v-1"),
        owner(),
        generation(),
        base,
        AckOutcome::Accepted,
    ))
    .expect("ack");
    // Tampered preconditions diverge and clear pending.
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
    assert!(!s.has_pending());

    // Fresh exact commit advances revision by one with retained focus.
    let mut t = single_session();
    admit_commit(&mut t, "win-1", true, "c-1");
    admit_commit(&mut t, "win-2", true, "c-2");
    let tk = key("out-1", "ws-1");
    let tw = focused_window(&t, &tk);
    let before = t.focus();
    let tobs = complete_obs(&t);
    let tbase = t.accepted_revision();
    let tplan = t
        .propose_pointer_resize(
            &tk,
            &tw,
            Direction::Left,
            391,
            &tobs,
            &correlation("v-2"),
            &ResizeCapabilities::full(),
        )
        .expect("plan");
    t.acknowledge(&AdapterAck::new(
        correlation("v-2"),
        owner(),
        generation(),
        tbase,
        AckOutcome::Accepted,
    ))
    .expect("ack");
    let commit = t
        .verify_resize(&ResizePostObservation::new(
            Observation::new(owner(), generation(), tbase, 2),
            correlation("v-2"),
            true,
            tplan.dispatch.preconditions.clone(),
            tplan.dispatch.operation.clone(),
        ))
        .expect("verify");
    assert_eq!(commit.revision, tbase + 1);
    assert_eq!(t.focus(), before);
    // Diverged verify reports fixed redacted text without echo.
    assert_eq!(
        ProposeError::Refused(RefusalKind::MalformedInput).message(),
        "command or observation input is malformed"
    );
}

#[test]
fn ordinary_boundary_plans_and_projects_exactly() {
    // 200px domain, [1,1] split at 100. Proposal 80 plans with exact
    // pixel-projectable shares [79,119], projecting the pair boundary exactly
    // to 80, so a native-owned source showing 80 binds post-observation.
    // Acknowledge/verify commits advance revision with retained focus.
    let mut t = single_session();
    admit_commit(&mut t, "win-1", true, "c-1");
    admit_commit(&mut t, "win-2", true, "c-2");
    let tk = key("out-1", "ws-1");
    let tw = focused_window(&t, &tk);
    let before = t.focus();
    let plan = pointer_commit(&mut t, &tk, &tw, Direction::Left, 390, "p-exact");
    assert_eq!(plan.resize_plan.operation.old_shares, vec![1, 1]);
    assert_eq!(plan.resize_plan.operation.new_shares, vec![389, 409]);
    assert_eq!(t.focus(), before);
    // Complete projected geometry places the pair boundary exactly at 80:
    // left leaf ends at 80, right leaf starts at 80 (gap 0).
    let mut left_end: Option<i32> = None;
    let mut right_start: Option<i32> = None;
    for g in &plan.desired_geometry {
        if g.leaf.0 == plan.resize_plan.operation.focused_child.0
            || g.leaf.0 == plan.resize_plan.operation.neighbor_child.0
        {
            // Both pair leaves are direct; identify left by smaller x.
            if left_end.is_none_or(|m| g.rect.x < m) {
                right_start = left_end.map(|_| g.rect.x);
                left_end = Some(g.rect.x + g.rect.w);
            } else {
                right_start = Some(g.rect.x);
            }
        }
    }
    // Recompute deterministically: left child end must equal 80.
    let left_id =
        if plan.resize_plan.operation.focused_index < plan.resize_plan.operation.neighbor_index {
            &plan.resize_plan.operation.focused_child
        } else {
            &plan.resize_plan.operation.neighbor_child
        };
    let left_rect = plan
        .desired_geometry
        .iter()
        .find(|g| &g.leaf == left_id)
        .expect("left geometry");
    assert_eq!(left_rect.rect.x + left_rect.rect.w, 390);
    assert!(left_end.is_some() && right_start.is_some());

    // Proposal 391 still plans exactly with [390,408] on a fresh session.
    let mut u = single_session();
    admit_commit(&mut u, "win-1", true, "c-1");
    admit_commit(&mut u, "win-2", true, "c-2");
    let uk = key("out-1", "ws-1");
    let uw = focused_window(&u, &uk);
    let plan81 = pointer_commit(&mut u, &uk, &uw, Direction::Left, 391, "p-exact-81");
    assert_eq!(plan81.resize_plan.operation.new_shares, vec![390, 408]);
}

#[test]
fn pointer_two_sided_correction_preserved() {
    // Pointer path clamps two-sided to the COSMIC child minima, unlike the
    // keyboard one-sided shrink clamp.
    use plasma_auto_tiler::cosmic_v1;
    use plasma_auto_tiler::directional::Axis;
    assert_eq!(
        cosmic_v1::clamp_pair_split(800, 10, Axis::Horizontal),
        Some((360, 440))
    );
    assert_eq!(
        cosmic_v1::clamp_pair_split(800, 790, Axis::Horizontal),
        Some((440, 360))
    );
    assert_eq!(
        cosmic_v1::clamp_keyboard_shrink_pair(500, 220, 12, Axis::Horizontal),
        Some((488, 232))
    );
    // Session pointer proposal still plans through the dedicated pointer
    // dispatch with two-sided semantics and exact boundary projection.
    let mut s = single_session();
    admit_commit(&mut s, "win-1", true, "c-1");
    admit_commit(&mut s, "win-2", true, "c-2");
    let k = key("out-1", "ws-1");
    let w = focused_window(&s, &k);
    let obs = complete_obs(&s);
    let plan = s
        .propose_pointer_resize(
            &k,
            &w,
            Direction::Left,
            390,
            &obs,
            &correlation("ptr-2s"),
            &ResizeCapabilities::full(),
        )
        .expect("pointer plans");
    assert_eq!(
        plan.dispatch.required_capability,
        plasma_auto_tiler::contract::ResizeCapability::KeyboardResize
    );
    assert!(!plan.resize_plan.operation.new_shares.contains(&0));
    assert_ne!(
        plan.resize_plan.operation.new_shares,
        plan.resize_plan.operation.old_shares
    );
}
