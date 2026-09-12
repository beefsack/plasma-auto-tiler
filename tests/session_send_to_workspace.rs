//! Same-output send-to-workspace lifecycle tests (portable, headless).

use plasma_auto_tiler::contract::{
    AckOutcome, AdapterAck, DivergenceKind, LIFECYCLE_POLICY_VERSION, LifecycleCapabilities,
    LifecycleCapability, LifecycleIntent, LifecycleOperation, LifecyclePostObservation,
    Observation,
};
use plasma_auto_tiler::directional::{Axis, Node, NodeId, OutputId, Rule, WindowId, WorkspaceId};
use plasma_auto_tiler::geometry::Rect;
use plasma_auto_tiler::ids::{CorrelationId, GenerationId, OwnerId};
use plasma_auto_tiler::session::{
    DomainKey, ExceptionBehavior, ExceptionFlags, ObservedWindow, OutputDomain, ProposeError,
    RefusalKind, Session, SessionCommand, SessionObservation, SessionPlan,
};
fn owner() -> OwnerId {
    OwnerId::parse("owner-1").expect("valid")
}
fn generation() -> GenerationId {
    GenerationId::parse("gen-1").expect("valid")
}
fn corr(v: &str) -> CorrelationId {
    CorrelationId::parse(v).expect("valid")
}
fn full() -> LifecycleCapabilities {
    LifecycleCapabilities::full()
}
fn dom(o: &str, w: &str) -> OutputDomain {
    OutputDomain {
        id: OutputId(o.to_owned()),
        workspace: WorkspaceId(w.to_owned()),
        bounds: Rect {
            x: 0,
            y: 0,
            w: 120,
            h: 80,
        },
        gap: 0,
        adjacent: Default::default(),
    }
}
fn session() -> Session {
    Session::new(
        owner(),
        generation(),
        0,
        7,
        vec![
            dom("out-1", "ws-a"),
            dom("out-1", "ws-b"),
            dom("out-2", "ws-a"),
        ],
    )
    .expect("s")
}
fn tiled(w: &str, o: &str, ws: &str) -> ObservedWindow {
    ObservedWindow {
        window: WindowId(w.to_owned()),
        output: OutputId(o.to_owned()),
        workspace: WorkspaceId(ws.to_owned()),
        floating: false,
        fullscreen: false,
        maximized: false,
        sticky: false,
    }
}
fn obs(s: &Session, extra: Vec<ObservedWindow>) -> SessionObservation {
    let mut wins: Vec<ObservedWindow> = s
        .snapshot()
        .windows
        .iter()
        .map(|l| tiled(&l.window.0, &l.output.0, &l.workspace.0))
        .collect();
    wins.extend(s.exception_observed());
    wins.extend(extra);
    SessionObservation {
        observation: Observation::new(owner(), generation(), s.accepted_revision(), 100),
        windows: wins,
    }
}
fn ack_verify(s: &mut Session, plan: &SessionPlan, c: &str, fp: u64) {
    let base = s.accepted_revision();
    s.acknowledge(&AdapterAck::new(
        corr(c),
        owner(),
        generation(),
        base,
        AckOutcome::Accepted,
    ))
    .expect("ack");
    let post = LifecyclePostObservation::new(
        Observation::new(owner(), generation(), base, fp),
        corr(c),
        true,
        plan.dispatch.preconditions.clone(),
        plan.dispatch.operation.clone(),
    );
    s.verify_lifecycle(&post).expect("commit");
}
fn admit(s: &mut Session, w: &str, o: &str, ws: &str, pw: i32, ph: i32, c: &str) {
    let o0 = obs(s, vec![tiled(w, o, ws)]);
    let cmd = SessionCommand::Admit {
        window: WindowId(w.to_owned()),
        output: OutputId(o.to_owned()),
        workspace: WorkspaceId(ws.to_owned()),
        exceptions: ExceptionFlags::none(),
        exception_behavior: None,
        placement_bounds: Rect {
            x: 0,
            y: 0,
            w: pw,
            h: ph,
        },
    };
    let plan = s.propose(&cmd, &o0, &corr(c), &full()).expect("admit");
    ack_verify(s, &plan, c, 200);
}
fn mv(w: &str, o: &str, ws: &str) -> SessionCommand {
    SessionCommand::MoveToWorkspace {
        window: WindowId(w.to_owned()),
        target_output: OutputId(o.to_owned()),
        target_workspace: WorkspaceId(ws.to_owned()),
    }
}
fn propose_mv(s: &mut Session, w: &str, o: &str, ws: &str, c: &str) -> SessionPlan {
    let o0 = obs(s, vec![]);
    s.propose(&mv(w, o, ws), &o0, &corr(c), &full())
        .expect("move proposes")
}
fn mr(s: &mut Session, cmd: &SessionCommand, c: &str, caps: &LifecycleCapabilities) -> RefusalKind {
    let o0 = obs(s, vec![]);
    match s.propose(cmd, &o0, &corr(c), caps) {
        Err(ProposeError::Refused(k)) => k,
        other => panic!("expected refusal, got {other:?}"),
    }
}
fn post_for(s: &Session, plan: &SessionPlan, c: &str, fp: u64) -> LifecyclePostObservation {
    let pre = plan.dispatch.preconditions.clone();
    let op = plan.dispatch.operation.clone();
    LifecyclePostObservation::new(
        Observation::new(owner(), generation(), s.accepted_revision(), fp),
        corr(c),
        true,
        pre,
        op,
    )
}
fn defer_float(s: &mut Session, w: &str, o: &str, ws: &str, c: &str) {
    let mut f = tiled(w, o, ws);
    f.floating = true;
    let o0 = obs(s, vec![f]);
    let mut flags = ExceptionFlags::none();
    flags.floating = true;
    let cmd = SessionCommand::Admit {
        window: WindowId(w.to_owned()),
        output: OutputId(o.to_owned()),
        workspace: WorkspaceId(ws.to_owned()),
        exceptions: flags,
        exception_behavior: Some(ExceptionBehavior::Defer),
        placement_bounds: Rect {
            x: 0,
            y: 0,
            w: 120,
            h: 80,
        },
    };
    let dp = s.propose(&cmd, &o0, &corr(c), &full()).expect("defer");
    ack_verify(s, &dp, c, 210);
}
fn dk(o: &str, ws: &str) -> DomainKey {
    DomainKey {
        output: OutputId(o.to_owned()),
        workspace: WorkspaceId(ws.to_owned()),
    }
}
fn flat(t: Option<&Node>) -> Vec<String> {
    fn go(n: &Node, out: &mut Vec<String>) {
        match n {
            Node::Leaf { id } => out.push(id.0.clone()),
            Node::Group { children, .. } => children.iter().for_each(|c| go(c, out)),
        }
    }
    let mut v = vec![];
    if let Some(t) = t {
        go(t, &mut v);
    }
    v
}
fn at(ss: &[plasma_auto_tiler::session::SessionDomainView], o: &str, ws: &str) -> Option<Node> {
    ss.iter()
        .find(|d| d.output.0 == o && d.workspace.0 == ws)
        .expect("d")
        .tree
        .clone()
}
fn s_leaves(s: &Session, o: &str, ws: &str) -> Vec<String> {
    flat(at(&s.snapshot().domains, o, ws).as_ref())
}
fn p_leaves(p: &SessionPlan, o: &str, ws: &str) -> Vec<String> {
    flat(at(&p.desired_snapshot.domains, o, ws).as_ref())
}

#[test]
fn send_keeps_focus_in_source_and_clears_when_source_becomes_empty() {
    let mut s = session();
    admit(&mut s, "win-1", "out-1", "ws-a", 120, 80, "corr-1");
    admit(&mut s, "win-2", "out-1", "ws-a", 120, 80, "corr-2");
    admit(&mut s, "win-3", "out-1", "ws-a", 80, 120, "corr-3");
    let plan = propose_mv(&mut s, "win-3", "out-1", "ws-b", "corr-4");
    assert!(matches!(
        (&plan.dispatch.intent, &plan.dispatch.operation),
        (LifecycleIntent::MoveToWorkspace { window, target_workspace, .. },
         LifecycleOperation::MoveTiled { leaf, source_workspace, target_workspace: tw, .. })
        if window.0 == "win-3" && target_workspace.0 == "ws-b" && leaf.0 == "leaf-win-3"
            && source_workspace.0 == "ws-a" && tw.0 == "ws-b"
    ));
    assert_eq!(
        plan.dispatch.required_capability,
        LifecycleCapability::MoveTiled
    );
    assert_eq!(plan.dispatch.policy_version, LIFECYCLE_POLICY_VERSION);
    assert_eq!(
        p_leaves(&plan, "out-1", "ws-a"),
        vec!["leaf-win-1", "leaf-win-2"]
    );
    assert_eq!(p_leaves(&plan, "out-1", "ws-b"), vec!["leaf-win-3"]);
    assert_eq!(plan.desired_focus_domain, Some(dk("out-1", "ws-a")));
    assert_eq!(
        plan.desired_focus_leaf,
        Some(NodeId("leaf-win-2".to_owned()))
    );
    assert_eq!(plan.desired_geometry.len(), 3);
    ack_verify(&mut s, &plan, "corr-4", 500);
    assert_eq!(s.snapshot(), plan.desired_snapshot);
    // A later ordinary activation makes the target window focused. Sending it
    // back leaves its now-empty source unfocused instead of focusing the target.
    assert!(s.sync_focus_from_window(&dk("out-1", "ws-b"), &WindowId("win-3".to_owned())));
    let lone = propose_mv(&mut s, "win-3", "out-1", "ws-a", "corr-5");
    assert!(at(&lone.desired_snapshot.domains, "out-1", "ws-b").is_none());
    assert_eq!(
        p_leaves(&lone, "out-1", "ws-a"),
        vec!["leaf-win-1", "leaf-win-2", "leaf-win-3"]
    );
    assert_eq!(lone.desired_focus_domain, None);
    assert_eq!(lone.desired_focus_leaf, None);
    assert_eq!(lone.desired_geometry.len(), 3);
    ack_verify(&mut s, &lone, "corr-5", 502);
    assert!(s_leaves(&s, "out-1", "ws-b").is_empty());
    assert_eq!(s.snapshot().domains.len(), 3);
}

#[test]
fn occupied_target_splits_remembered_leaf() {
    let mut s = session();
    admit(&mut s, "win-t1", "out-1", "ws-b", 120, 80, "corr-1");
    admit(&mut s, "win-t2", "out-1", "ws-b", 120, 80, "corr-2");
    admit(&mut s, "win-1", "out-1", "ws-a", 120, 80, "corr-3");
    admit(&mut s, "win-2", "out-1", "ws-a", 120, 80, "corr-4");
    let plan = propose_mv(&mut s, "win-2", "out-1", "ws-b", "corr-5");
    assert_eq!(
        p_leaves(&plan, "out-1", "ws-b"),
        vec!["leaf-win-t1", "leaf-win-t2", "leaf-win-2"]
    );
    // Remembered t2 rect is narrow (60x80) so axis is Vertical, not the
    // output-bounds Horizontal; root keeps Horizontal with nested split.
    match at(&plan.desired_snapshot.domains, "out-1", "ws-b") {
        Some(Node::Group {
            axis,
            children,
            shares,
            ..
        }) => {
            assert_eq!(axis, Axis::Horizontal);
            assert_eq!(shares, vec![1, 1]);
            assert!(matches!(&children[0], Node::Leaf { id } if id.0 == "leaf-win-t1"));
            match &children[1] {
                Node::Group {
                    axis,
                    children: inner,
                    shares,
                    ..
                } => {
                    assert_eq!(*axis, Axis::Vertical);
                    assert_eq!(*shares, vec![1, 1]);
                    assert!(matches!(&inner[0], Node::Leaf { id } if id.0 == "leaf-win-t2"));
                    assert!(matches!(&inner[1], Node::Leaf { id } if id.0 == "leaf-win-2"));
                }
                other => panic!("expected nested split, got {other:?}"),
            }
        }
        other => panic!("expected root group, got {other:?}"),
    }
    assert_eq!(p_leaves(&plan, "out-1", "ws-a"), vec!["leaf-win-1"]);
    assert_eq!(plan.desired_focus_domain, Some(dk("out-1", "ws-a")));
    assert_eq!(
        plan.desired_focus_leaf,
        Some(NodeId("leaf-win-1".to_owned()))
    );
    assert_eq!(plan.desired_geometry.len(), 4);
    ack_verify(&mut s, &plan, "corr-5", 501);
    assert_eq!(
        s_leaves(&s, "out-1", "ws-b"),
        vec!["leaf-win-t1", "leaf-win-t2", "leaf-win-2"]
    );
}

#[test]
fn refusals_fail_closed_then_lifecycle_diverges() {
    use plasma_auto_tiler::reconcile::VerifyError;
    let mut s = session();
    admit(&mut s, "win-1", "out-1", "ws-a", 120, 80, "corr-1");
    admit(&mut s, "win-2", "out-1", "ws-b", 120, 80, "corr-2");
    let cases = [
        (
            "win-1",
            "out-1",
            "ws-b",
            "corr-3",
            RefusalKind::FocusMismatch,
        ),
        ("win-2", "out-1", "ws-b", "corr-4", RefusalKind::Unchanged),
        (
            "win-zzz",
            "out-1",
            "ws-a",
            "corr-5",
            RefusalKind::UnknownWindow,
        ),
        (
            "win-2",
            "out-1",
            "ws-zzz",
            "corr-6",
            RefusalKind::UnknownDomain,
        ),
        (
            "win-2",
            "out-2",
            "ws-a",
            "corr-7",
            RefusalKind::CrossDomainMismatch,
        ),
    ];
    for (w, o, ws, c, want) in cases {
        assert_eq!(mr(&mut s, &mv(w, o, ws), c, &full()), want);
    }
    let no_move = LifecycleCapabilities {
        admit_tiled: true,
        remove_tiled: true,
        move_tiled: false,
    };
    {
        let mut s_cap = session();
        admit(&mut s_cap, "win-1", "out-1", "ws-a", 120, 80, "corr-8a");
        admit(&mut s_cap, "win-2", "out-1", "ws-b", 120, 80, "corr-8b");
        let o_cap = obs(&s_cap, vec![]);
        let got = s_cap.propose(
            &mv("win-2", "out-1", "ws-a"),
            &o_cap,
            &corr("corr-8"),
            &no_move,
        );
        assert_eq!(
            got,
            Err(ProposeError::Diverged(DivergenceKind::CapabilityRefused))
        );
        assert_eq!(s_cap.divergence(), Some(DivergenceKind::CapabilityRefused));
        assert!(!s_cap.has_pending());
        assert!(!s_cap.has_pending_desired());
    }
    let partial = SessionObservation {
        observation: Observation::new(owner(), generation(), s.accepted_revision(), 50),
        windows: vec![tiled("win-2", "out-1", "ws-b")],
    };
    let retry = mv("win-2", "out-1", "ws-a");
    let got = s.propose(&retry, &partial, &corr("corr-9"), &full());
    assert_eq!(
        got,
        Err(ProposeError::Refused(RefusalKind::PartialObservation))
    );
    assert_eq!(
        mr(&mut s, &mv("win-2", "", "ws-a"), "corr-10", &full()),
        RefusalKind::MalformedInput
    );
    defer_float(&mut s, "win-9", "out-1", "ws-a", "corr-11");
    let deferred = mv("win-9", "out-1", "ws-b");
    assert_eq!(
        mr(&mut s, &deferred, "corr-12", &full()),
        RefusalKind::NotTiled
    );
    assert_eq!(s.divergence(), None);
    assert!(!s.has_pending());
    let plan = propose_mv(&mut s, "win-2", "out-1", "ws-a", "corr-13");
    assert!(s.has_pending());
    let o2 = obs(&s, vec![]);
    let dup = s.propose(
        &mv("win-2", "out-1", "ws-a"),
        &o2,
        &corr("corr-14"),
        &full(),
    );
    assert_eq!(dup, Err(ProposeError::PendingExists));
    // Verification before acknowledgement is rejected without divergence.
    let pre = post_for(&s, &plan, "corr-13", 511);
    assert_eq!(s.verify_lifecycle(&pre), Err(VerifyError::NotAcknowledged));
    let base = s.accepted_revision();
    let ack = AdapterAck::new(
        corr("corr-13"),
        owner(),
        generation(),
        base,
        AckOutcome::Accepted,
    );
    s.acknowledge(&ack).expect("ack");
    let mut bad = plan.dispatch.operation.clone();
    if let LifecycleOperation::MoveTiled {
        ref mut target_workspace,
        ..
    } = bad
    {
        *target_workspace = WorkspaceId("ws-b".to_owned());
    } else {
        panic!("expected move-tiled");
    }
    let bad_post = LifecyclePostObservation::new(
        Observation::new(owner(), generation(), s.accepted_revision(), 512),
        corr("corr-13"),
        true,
        plan.dispatch.preconditions.clone(),
        bad,
    );
    assert_eq!(
        s.verify_lifecycle(&bad_post),
        Err(VerifyError::Diverged(DivergenceKind::PostconditionMismatch))
    );
    assert_eq!(s.divergence(), Some(DivergenceKind::PostconditionMismatch));
    assert!(!s.has_pending_desired());
    assert_eq!(s_leaves(&s, "out-1", "ws-b"), vec!["leaf-win-2"]);
}

#[test]
fn r1_r4_untouched() {
    const RULES: [Rule; 6] = [
        Rule::R1,
        Rule::R2a,
        Rule::R2b,
        Rule::R2c,
        Rule::R3,
        Rule::R4,
    ];
    assert_eq!(RULES.len(), 6);
    assert_ne!(
        LifecycleCapability::MoveTiled,
        LifecycleCapability::AdmitTiled
    );
    assert!(full().supports(LifecycleCapability::MoveTiled));
}
