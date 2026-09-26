//! Step-3 send/R4 immediate-commit rows (test-only, authorized).
//!
//! Design: docs/changes/observation-convergence-step-3.md. The Engine must
//! commit a planned send/R4 topology synchronously into the canonical
//! per-domain sessions (retaining survivor trees) and return both-domain
//! geometry plus the native assignment. Failed native moves converge on the
//! next complete observations with no phantom. Pre-implementation these fail:
//! send reseeds from spatial observation; R4 does not commit cross-output.

use std::collections::BTreeMap;

use tiler_core::boundary::{CoreCommand, CoreEvent, CoreReply};
use tiler_core::contract::{AckOutcome, AdapterAck, LifecycleCapabilities, Observation};
use tiler_core::directional::{Direction, Node, OutputId, WindowId, WorkspaceId};
use tiler_core::engine::Engine;
use tiler_core::geometry::Rect;
use tiler_core::ids::{CorrelationId, GenerationId, OwnerId};
use tiler_core::seed::EngineWindow;
use tiler_core::session::{DomainKey, ExceptionFlags, OutputDomain, Session, SessionCommand};

fn owner() -> OwnerId {
    OwnerId::parse("owner-1").expect("valid")
}
fn generation() -> GenerationId {
    GenerationId::parse("gen-1").expect("valid")
}
fn corr(v: &str) -> CorrelationId {
    CorrelationId::parse(v).expect("valid")
}
fn bounds() -> Rect {
    Rect {
        x: 0,
        y: 0,
        w: 800,
        h: 600,
    }
}
fn domain(output: &str, workspace: &str) -> OutputDomain {
    OutputDomain {
        id: OutputId(output.to_owned()),
        workspace: WorkspaceId(workspace.to_owned()),
        bounds: bounds(),
        gap: 0,
        adjacent: BTreeMap::new(),
    }
}
fn pair_domain(output: &str, workspace: &str, neighbor: (Direction, &str)) -> OutputDomain {
    let mut d = domain(output, workspace);
    d.adjacent
        .insert(neighbor.0, OutputId(neighbor.1.to_owned()));
    d
}
fn key(output: &str, workspace: &str) -> DomainKey {
    DomainKey {
        output: OutputId(output.to_owned()),
        workspace: WorkspaceId(workspace.to_owned()),
    }
}
fn carried(window: &str, output: &str, workspace: &str, x: i32) -> EngineWindow {
    EngineWindow {
        window: WindowId(window.to_owned()),
        output: OutputId(output.to_owned()),
        workspace: WorkspaceId(workspace.to_owned()),
        rect: Rect {
            x,
            y: 0,
            w: 10,
            h: 10,
        },
        floating: false,
        fit_excluded: false,
        hints: tiler_core::size_hints::WindowSizeHints::none(),
    }
}
fn admit_to(s: &mut Session, window: &str, output: &str, workspace: &str, c: &str) {
    let mut windows: Vec<tiler_core::session::ObservedWindow> = s
        .snapshot()
        .windows
        .iter()
        .map(|l| tiler_core::session::ObservedWindow {
            window: l.window.clone(),
            output: l.output.clone(),
            workspace: l.workspace.clone(),
            floating: false,
            fullscreen: false,
            maximized: false,
            sticky: false,
            hints: tiler_core::size_hints::WindowSizeHints::none(),
        })
        .collect();
    windows.extend(s.exception_observed());
    windows.push(tiler_core::session::ObservedWindow {
        window: WindowId(window.to_owned()),
        output: OutputId(output.to_owned()),
        workspace: WorkspaceId(workspace.to_owned()),
        floating: false,
        fullscreen: false,
        maximized: false,
        sticky: false,
        hints: tiler_core::size_hints::WindowSizeHints::none(),
    });
    windows.sort_by(|a, b| a.window.0.cmp(&b.window.0));
    let base = s.accepted_revision();
    let obs = tiler_core::session::SessionObservation {
        observation: Observation::new(owner(), generation(), base, 100 + base),
        windows,
    };
    let plan = s
        .propose(
            &SessionCommand::Admit {
                window: WindowId(window.to_owned()),
                output: OutputId(output.to_owned()),
                workspace: WorkspaceId(workspace.to_owned()),
                exceptions: ExceptionFlags::none(),
                exception_behavior: None,
                placement_bounds: bounds(),
            },
            &obs,
            &corr(c),
            &LifecycleCapabilities::full(),
        )
        .unwrap_or_else(|e| panic!("seed admit {window}: {e:?}"));
    s.acknowledge(&AdapterAck::new(
        corr(c),
        owner(),
        generation(),
        base,
        AckOutcome::Accepted,
    ))
    .expect("ack");
    s.verify_lifecycle(&tiler_core::contract::LifecyclePostObservation::new(
        Observation::new(owner(), generation(), base, 200 + base),
        corr(c),
        true,
        plan.dispatch.preconditions.clone(),
        plan.dispatch.operation.clone(),
    ))
    .expect("commit");
}
fn leaves_of(s: &Session, o: &str, ws: &str) -> Vec<String> {
    let view = s
        .snapshot()
        .domains
        .iter()
        .find(|d| d.output.0 == o && d.workspace.0 == ws)
        .unwrap_or_else(|| panic!("domain {o}/{ws}"))
        .clone();
    fn go(n: &Node, out: &mut Vec<String>) {
        match n {
            Node::Leaf { id } => out.push(id.0.clone()),
            Node::Group { children, .. } => children.iter().for_each(|c| go(c, out)),
        }
    }
    match &view.tree {
        None => vec![],
        Some(t) => {
            let mut v = vec![];
            go(t, &mut v);
            v
        }
    }
}
fn homed(s: &Session, w: &str) -> Option<(String, String)> {
    s.snapshot()
        .windows
        .iter()
        .find(|l| l.window.0 == w)
        .map(|l| (l.output.0.clone(), l.workspace.0.clone()))
}
fn seed_send_engine() -> (Engine, OutputDomain, OutputDomain) {
    let mut source =
        Session::new(owner(), generation(), 0, 7, vec![domain("out-1", "ws-a")]).expect("source");
    admit_to(&mut source, "win-s1", "out-1", "ws-a", "s-1");
    admit_to(&mut source, "win-s2", "out-1", "ws-a", "s-2");
    admit_to(&mut source, "win-m", "out-1", "ws-a", "s-3");
    let mut target =
        Session::new(owner(), generation(), 0, 7, vec![domain("out-1", "ws-b")]).expect("target");
    admit_to(&mut target, "win-t1", "out-1", "ws-b", "t-1");
    admit_to(&mut target, "win-t2", "out-1", "ws-b", "t-2");
    let source_domain = source.domains().first().expect("sd").clone();
    let target_domain = target.domains().first().expect("td").clone();
    let mut engine = Engine::new();
    engine.sync_binding(&owner(), &generation());
    engine.store_committed(key("out-1", "ws-a"), source, 0);
    engine.store_committed(key("out-1", "ws-b"), target, 0);
    (engine, source_domain, target_domain)
}
fn send_event(source: &OutputDomain, target: &OutputDomain, c: &str) -> CoreEvent {
    CoreEvent {
        owner: owner(),
        generation: generation(),
        correlation: corr(c),
        revision: 0,
        fingerprint: 7,
        domain: source.clone(),
        domain_key: source.key(),
        outer_gap: 0,
        focused_window: WindowId("win-m".to_owned()),
        // Scrambled rects: spatial reseed would order survivors as
        // [s2, s1] / [t2, t1]; retained topology must stay [s1, s2] / [t1, t2].
        windows: vec![
            carried("win-s2", "out-1", "ws-a", 0),
            carried("win-s1", "out-1", "ws-a", 200),
            carried("win-m", "out-1", "ws-a", 400),
        ],
        directional: None,
        directional_target_outer_gap: None,
        target_domain: Some((target.clone(), target.key())),
        target_windows: vec![
            carried("win-t2", "out-1", "ws-b", 0),
            carried("win-t1", "out-1", "ws-b", 400),
        ],
        command: CoreCommand::SendToWorkspace {
            window: "win-m".to_owned(),
            target_output: "out-1".to_owned(),
            target_workspace: "ws-b".to_owned(),
        },
    }
}
fn reconcile_event(domain_state: &OutputDomain, windows: Vec<EngineWindow>, c: &str) -> CoreEvent {
    CoreEvent {
        owner: owner(),
        generation: generation(),
        correlation: corr(c),
        revision: 0,
        fingerprint: 999,
        domain: domain_state.clone(),
        domain_key: domain_state.key(),
        outer_gap: 0,
        focused_window: WindowId("win-m".to_owned()),
        windows,
        directional: None,
        directional_target_outer_gap: None,
        target_domain: None,
        target_windows: vec![],
        command: CoreCommand::Reconcile,
    }
}

#[test]
fn send_commits_immediately_with_retained_topology_and_stays() {
    let (mut engine, source_domain, target_domain) = seed_send_engine();
    let src_base = engine
        .session(&key("out-1", "ws-a"))
        .expect("src")
        .accepted_revision();
    let tgt_base = engine
        .session(&key("out-1", "ws-b"))
        .expect("tgt")
        .accepted_revision();
    let geometry = match engine.handle(&send_event(&source_domain, &target_domain, "send-1")) {
        CoreReply::SendWorkspace(plan) => plan.geometry,
        CoreReply::Tiled(plan) => plan.geometry,
        other => panic!("send must return a committed plan, got {other:?}"),
    };
    // Retained survivor order preserved (not spatial-reseeded), mover moved.
    let src = engine.session(&key("out-1", "ws-a")).expect("src retained");
    let tgt = engine.session(&key("out-1", "ws-b")).expect("tgt retained");
    assert_eq!(
        leaves_of(src, "out-1", "ws-a"),
        vec!["leaf-win-s1", "leaf-win-s2"]
    );
    assert_eq!(
        leaves_of(tgt, "out-1", "ws-b"),
        vec!["leaf-win-t1", "leaf-win-t2", "leaf-win-m"]
    );
    assert_eq!(homed(src, "win-m"), None);
    assert_eq!(
        homed(tgt, "win-m"),
        Some(("out-1".to_owned(), "ws-b".to_owned()))
    );
    assert!(src.accepted_revision() > src_base);
    assert!(tgt.accepted_revision() > tgt_base);
    // Both-domain geometry plus the native assignment.
    let mut ids: Vec<String> = geometry.iter().map(|g| g.window.0.clone()).collect();
    ids.sort();
    assert_eq!(ids, vec!["win-m", "win-s1", "win-s2", "win-t1", "win-t2"]);
    assert!(
        geometry
            .iter()
            .any(|g| g.window.0 == "win-m" && g.output.0 == "out-1" && g.workspace.0 == "ws-b")
    );
    // Native arrival stays: complete observations preserve both topologies.
    let src_obs = vec![
        carried("win-s1", "out-1", "ws-a", 0),
        carried("win-s2", "out-1", "ws-a", 10),
    ];
    let tgt_obs = vec![
        carried("win-t1", "out-1", "ws-b", 0),
        carried("win-t2", "out-1", "ws-b", 10),
        carried("win-m", "out-1", "ws-b", 20),
    ];
    match engine.handle(&reconcile_event(&source_domain, src_obs, "rec-s")) {
        CoreReply::Projection(_) | CoreReply::Tiled(_) => {}
        other => panic!("source reconcile must project, got {other:?}"),
    }
    match engine.handle(&reconcile_event(&target_domain, tgt_obs, "rec-t")) {
        CoreReply::Projection(_) | CoreReply::Tiled(_) => {}
        other => panic!("target reconcile must project, got {other:?}"),
    }
    let src = engine.session(&key("out-1", "ws-a")).expect("src");
    let tgt = engine.session(&key("out-1", "ws-b")).expect("tgt");
    assert_eq!(
        leaves_of(src, "out-1", "ws-a"),
        vec!["leaf-win-s1", "leaf-win-s2"]
    );
    assert_eq!(
        leaves_of(tgt, "out-1", "ws-b"),
        vec!["leaf-win-t1", "leaf-win-t2", "leaf-win-m"]
    );
}

#[test]
fn failed_native_send_converges_to_source_without_phantom() {
    let (mut engine, source_domain, target_domain) = seed_send_engine();
    match engine.handle(&send_event(&source_domain, &target_domain, "send-1")) {
        CoreReply::SendWorkspace(_) | CoreReply::Tiled(_) => {}
        other => panic!("send must return a committed plan, got {other:?}"),
    }
    assert_eq!(
        homed(
            engine.session(&key("out-1", "ws-b")).expect("target"),
            "win-m"
        ),
        Some(("out-1".to_owned(), "ws-b".to_owned())),
        "native failure must follow an actual provisional Engine commit"
    );
    // Native refused: mover still observed on source, target without mover.
    let src_obs = vec![
        carried("win-s1", "out-1", "ws-a", 0),
        carried("win-s2", "out-1", "ws-a", 10),
        carried("win-m", "out-1", "ws-a", 20),
    ];
    let tgt_obs = vec![
        carried("win-t1", "out-1", "ws-b", 0),
        carried("win-t2", "out-1", "ws-b", 10),
    ];
    match engine.handle(&reconcile_event(&source_domain, src_obs, "rec-s")) {
        CoreReply::Projection(_) | CoreReply::Tiled(_) => {}
        other => panic!("source reconcile must project, got {other:?}"),
    }
    match engine.handle(&reconcile_event(&target_domain, tgt_obs, "rec-t")) {
        CoreReply::Projection(_) | CoreReply::Tiled(_) => {}
        other => panic!("target reconcile must project, got {other:?}"),
    }
    let src = engine.session(&key("out-1", "ws-a")).expect("src");
    let tgt = engine.session(&key("out-1", "ws-b")).expect("tgt");
    // Provisional target leaf withdrawn; mover admitted normally on source.
    assert_eq!(
        homed(src, "win-m"),
        Some(("out-1".to_owned(), "ws-a".to_owned()))
    );
    assert_eq!(homed(tgt, "win-m"), None);
    assert_eq!(
        leaves_of(src, "out-1", "ws-a"),
        vec!["leaf-win-s1", "leaf-win-s2", "leaf-win-m"]
    );
    assert!(
        !leaves_of(tgt, "out-1", "ws-b").contains(&"leaf-win-m".to_owned()),
        "no retained phantom on target"
    );
    for window in ["win-s1", "win-s2", "win-m", "win-t1", "win-t2"] {
        assert_eq!(
            usize::from(homed(src, window).is_some()) + usize::from(homed(tgt, window).is_some()),
            1
        );
    }
}

#[test]
fn r4_cross_output_commits_immediately_with_empty_target() {
    // Source out-1/ws-a holds H[win-a, win-m] with win-m focused at the right
    // edge; target out-2/ws-b is empty (no retained session).
    let mut source =
        Session::new(owner(), generation(), 0, 7, vec![domain("out-1", "ws-a")]).expect("source");
    admit_to(&mut source, "win-a", "out-1", "ws-a", "r-a");
    admit_to(&mut source, "win-m", "out-1", "ws-a", "r-m");
    let source_pair = pair_domain("out-1", "ws-a", (Direction::Right, "out-2"));
    let target_pair = pair_domain("out-2", "ws-b", (Direction::Left, "out-1"));
    let (source_key, target_key) = (source_pair.key(), target_pair.key());
    let mut engine = Engine::new();
    engine.sync_binding(&owner(), &generation());
    engine.store_committed(key("out-1", "ws-a"), source, 0);
    let event = CoreEvent {
        owner: owner(),
        generation: generation(),
        correlation: corr("r4-1"),
        revision: 0,
        fingerprint: 999,
        domain: source_pair.clone(),
        domain_key: source_key.clone(),
        outer_gap: 0,
        focused_window: WindowId("win-m".to_owned()),
        windows: vec![
            carried("win-a", "out-1", "ws-a", 0),
            carried("win-m", "out-1", "ws-a", 10),
        ],
        directional: Some(vec![
            (source_pair.clone(), source_key.clone()),
            (target_pair.clone(), target_key.clone()),
        ]),
        directional_target_outer_gap: Some(0),
        target_domain: None,
        target_windows: vec![],
        command: CoreCommand::Move {
            window: "win-m".to_owned(),
            direction: "right".to_owned(),
            cross_output_transfer: true,
        },
    };
    let geometry = match engine.handle(&event) {
        CoreReply::MoveDirectional(plan) => {
            assert_eq!(plan.rule, tiler_core::directional::Rule::R4);
            plan.geometry
        }
        other => panic!("R4 must plan cross-output, got {other:?}"),
    };
    let src = engine.session(&source_key).expect("source retained");
    let tgt = engine.session(&target_key).expect("target retained");
    assert_eq!(leaves_of(src, "out-1", "ws-a"), vec!["leaf-win-a"]);
    assert_eq!(leaves_of(tgt, "out-2", "ws-b"), vec!["leaf-win-m"]);
    assert_eq!(
        homed(tgt, "win-m"),
        Some(("out-2".to_owned(), "ws-b".to_owned()))
    );
    let mut ids: Vec<String> = geometry.iter().map(|g| g.window.0.clone()).collect();
    ids.sort();
    assert_eq!(ids, vec!["win-a", "win-m"]);
    assert!(geometry.iter().all(|g| g.rect.w > 0 && g.rect.h > 0));
}

#[test]
fn rapid_second_send_with_arrival_commits_without_reconcile() {
    // Step-3 Watch risk probe, arrival-showing case: first send A->B commits;
    // then, with NO intervening per-domain reconcile but native observations
    // already showing the arrival (m on B), a second send B->C (empty C)
    // commits immediately with the native assignment. No refusal, no
    // pending-exists/abandon wait.
    let (mut engine, source_domain, target_domain) = seed_send_engine();
    match engine.handle(&send_event(&source_domain, &target_domain, "send-1")) {
        CoreReply::SendWorkspace(_) | CoreReply::Tiled(_) => {}
        other => panic!("first send must commit, got {other:?}"),
    }
    assert_eq!(
        homed(engine.session(&key("out-1", "ws-b")).expect("tgt"), "win-m"),
        Some(("out-1".to_owned(), "ws-b".to_owned()))
    );
    let source_b = target_domain.clone();
    let target_c = domain("out-1", "ws-c");
    let b_windows = vec![
        carried("win-t1", "out-1", "ws-b", 0),
        carried("win-t2", "out-1", "ws-b", 10),
        carried("win-m", "out-1", "ws-b", 20),
    ];
    let second = CoreEvent {
        owner: owner(),
        generation: generation(),
        correlation: corr("send-2"),
        revision: 0,
        fingerprint: 7,
        domain: source_b.clone(),
        domain_key: source_b.key(),
        outer_gap: 0,
        focused_window: WindowId("win-m".to_owned()),
        windows: b_windows,
        directional: None,
        directional_target_outer_gap: None,
        target_domain: Some((target_c.clone(), target_c.key())),
        target_windows: vec![],
        command: CoreCommand::SendToWorkspace {
            window: "win-m".to_owned(),
            target_output: "out-1".to_owned(),
            target_workspace: "ws-c".to_owned(),
        },
    };
    match engine.handle(&second) {
        CoreReply::SendWorkspace(plan) => {
            assert!(
                plan.geometry.iter().any(|g| g.window.0 == "win-m"
                    && g.output.0 == "out-1"
                    && g.workspace.0 == "ws-c"),
                "second send must carry the native assignment, got {:?}",
                plan.geometry
            );
            assert_eq!(
                homed(
                    engine.session(&key("out-1", "ws-c")).expect("ws-c"),
                    "win-m"
                ),
                Some(("out-1".to_owned(), "ws-c".to_owned()))
            );
        }
        other => panic!("PROBE-RESULT rapid second send refused: {other:?}"),
    }
}

#[test]
fn stale_rapid_second_send_drops_mover_until_domain_reconcile() {
    // Step-3 Watch risk, stale-observation case: after A->B commits, a rapid
    // B->C send of win-m itself carries a STALE B observation (m absent,
    // still natively on A) before any per-domain reconcile. Pair convergence
    // drops the provisional m from the canonical sessions (stored before the
    // focus-sync refusal), so the second send refuses with focus-mismatch
    // and m is retained NOWHERE until the domains ordinary-reconcile. The
    // refusal clears on complete observations and the command is NOT lost
    // silently indefinitely: reconciling A (m present) re-admits m and a
    // retried A->C send commits.
    let (mut engine, source_domain, target_domain) = seed_send_engine();
    match engine.handle(&send_event(&source_domain, &target_domain, "send-1")) {
        CoreReply::SendWorkspace(_) | CoreReply::Tiled(_) => {}
        other => panic!("first send must commit, got {other:?}"),
    }
    let source_b = target_domain.clone();
    let target_c = domain("out-1", "ws-c");
    let stale_b_windows = vec![
        carried("win-t1", "out-1", "ws-b", 0),
        carried("win-t2", "out-1", "ws-b", 10),
    ];
    let second = CoreEvent {
        owner: owner(),
        generation: generation(),
        correlation: corr("send-2"),
        revision: 0,
        fingerprint: 7,
        domain: source_b.clone(),
        domain_key: source_b.key(),
        outer_gap: 0,
        focused_window: WindowId("win-m".to_owned()),
        windows: stale_b_windows,
        directional: None,
        directional_target_outer_gap: None,
        target_domain: Some((target_c.clone(), target_c.key())),
        target_windows: vec![],
        command: CoreCommand::SendToWorkspace {
            window: "win-m".to_owned(),
            target_output: "out-1".to_owned(),
            target_workspace: "ws-c".to_owned(),
        },
    };
    match engine.handle(&second) {
        CoreReply::Rejected { kind, .. } => assert_eq!(
            kind, "focus-mismatch",
            "stale rapid second send must refuse at focus sync"
        ),
        other => panic!("stale rapid second send must refuse, got {other:?}"),
    }
    // The converged removal was stored before the refusal: m is retained
    // nowhere, even though it is still natively on A.
    assert_eq!(
        engine
            .session(&key("out-1", "ws-b"))
            .map(|s| homed(s, "win-m"))
            .unwrap_or(None),
        None,
        "stale convergence drops provisional m from B"
    );
    assert_eq!(
        engine
            .session(&key("out-1", "ws-a"))
            .map(|s| homed(s, "win-m"))
            .unwrap_or(None),
        None,
        "m is retained nowhere until domain reconcile"
    );
    // Ordinary per-domain reconciles recover: A re-admits m normally.
    let a_obs = vec![
        carried("win-s1", "out-1", "ws-a", 0),
        carried("win-s2", "out-1", "ws-a", 10),
        carried("win-m", "out-1", "ws-a", 20),
    ];
    let b_obs = vec![
        carried("win-t1", "out-1", "ws-b", 0),
        carried("win-t2", "out-1", "ws-b", 10),
    ];
    match engine.handle(&reconcile_event(&source_domain, a_obs, "rec-a")) {
        CoreReply::Projection(_) | CoreReply::Tiled(_) => {}
        other => panic!("A reconcile must project, got {other:?}"),
    }
    match engine.handle(&reconcile_event(&target_domain, b_obs, "rec-b")) {
        CoreReply::Projection(_) | CoreReply::Tiled(_) => {}
        other => panic!("B reconcile must project, got {other:?}"),
    }
    assert_eq!(
        homed(engine.session(&key("out-1", "ws-a")).expect("src"), "win-m"),
        Some(("out-1".to_owned(), "ws-a".to_owned())),
        "complete A observation re-admits m"
    );
    // Retried send A->C (empty C) commits: the refused command was not lost
    // silently indefinitely.
    let retry = CoreEvent {
        owner: owner(),
        generation: generation(),
        correlation: corr("send-3"),
        revision: 0,
        fingerprint: 7,
        domain: source_domain.clone(),
        domain_key: source_domain.key(),
        outer_gap: 0,
        focused_window: WindowId("win-m".to_owned()),
        windows: vec![
            carried("win-s1", "out-1", "ws-a", 0),
            carried("win-s2", "out-1", "ws-a", 10),
            carried("win-m", "out-1", "ws-a", 20),
        ],
        directional: None,
        directional_target_outer_gap: None,
        target_domain: Some((target_c.clone(), target_c.key())),
        target_windows: vec![],
        command: CoreCommand::SendToWorkspace {
            window: "win-m".to_owned(),
            target_output: "out-1".to_owned(),
            target_workspace: "ws-c".to_owned(),
        },
    };
    match engine.handle(&retry) {
        CoreReply::SendWorkspace(plan) => assert!(
            plan.geometry
                .iter()
                .any(|g| g.window.0 == "win-m" && g.output.0 == "out-1" && g.workspace.0 == "ws-c"),
            "retried send must carry the native assignment, got {:?}",
            plan.geometry
        ),
        other => panic!("retried send must commit after reconcile, got {other:?}"),
    }
    assert_eq!(
        homed(
            engine.session(&key("out-1", "ws-c")).expect("ws-c"),
            "win-m"
        ),
        Some(("out-1".to_owned(), "ws-c".to_owned()))
    );
}
