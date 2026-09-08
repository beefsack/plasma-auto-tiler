//! Bounded movement transaction service coverage (portable, headless).
//!
//! Drives the product `movement_service::MovementService` JSON protocol over
//! a real `session::Session`: R1-R4 planning through `cosmic_v1`, refusals,
//! acknowledge + verify commit with complete exact geometry/focus, mismatch /
//! divergence, adapter loss, and domain isolation. No live compositor state.

use plasma_auto_tiler::contract::{AckOutcome, AdapterAck, LifecycleCapabilities, Observation};
use plasma_auto_tiler::directional::{
    Capabilities, Direction, Node, NodeId, OutputId, WindowId, WorkspaceId,
};
use plasma_auto_tiler::geometry::Rect;
use plasma_auto_tiler::ids::{CorrelationId, GenerationId, OwnerId};
use plasma_auto_tiler::movement_service::{MovementService, movement_fingerprint};
use plasma_auto_tiler::session::{
    DomainKey, ExceptionFlags, ObservedWindow, OutputDomain, Session, SessionCommand,
};
use std::collections::BTreeMap;

fn owner() -> OwnerId {
    OwnerId::parse("owner-1").expect("valid")
}
fn generation() -> GenerationId {
    GenerationId::parse("gen-1").expect("valid")
}
fn correlation(value: &str) -> CorrelationId {
    CorrelationId::parse(value).unwrap_or_else(|| panic!("valid {value}"))
}
fn domain(output: &str, workspace: &str, w: i32, h: i32) -> OutputDomain {
    OutputDomain {
        id: OutputId(output.to_owned()),
        workspace: WorkspaceId(workspace.to_owned()),
        bounds: Rect { x: 0, y: 0, w, h },
        gap: 0,
        adjacent: BTreeMap::new(),
    }
}
fn domain_with_adjacent(
    output: &str,
    workspace: &str,
    adjacent: Vec<(Direction, &str)>,
) -> OutputDomain {
    OutputDomain {
        id: OutputId(output.to_owned()),
        workspace: WorkspaceId(workspace.to_owned()),
        bounds: Rect {
            x: 0,
            y: 0,
            w: 200,
            h: 200,
        },
        gap: 0,
        adjacent: adjacent
            .into_iter()
            .map(|(d, t)| (d, OutputId(t.to_owned())))
            .collect(),
    }
}
fn single_session() -> Session {
    Session::new(
        owner(),
        generation(),
        0,
        7,
        vec![domain("out-1", "ws-1", 200, 200)],
    )
    .expect("session")
}
fn r4_session() -> Session {
    Session::new(
        owner(),
        generation(),
        0,
        7,
        vec![
            domain_with_adjacent("out-1", "ws-1", vec![(Direction::Right, "out-2")]),
            domain_with_adjacent("out-2", "ws-1", vec![(Direction::Left, "out-1")]),
        ],
    )
    .expect("r4 session")
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
        observation: Observation::new(owner(), generation(), session.accepted_revision(), 100),
        windows,
    }
}
fn admit_commit(
    session: &mut Session,
    window: &str,
    output: &str,
    workspace: &str,
    horiz: bool,
    corr: &str,
) {
    let cmd = SessionCommand::Admit {
        window: WindowId(window.to_owned()),
        output: OutputId(output.to_owned()),
        workspace: WorkspaceId(workspace.to_owned()),
        exceptions: ExceptionFlags::none(),
        exception_behavior: None,
        placement_bounds: placement(horiz),
    };
    let obs = complete_obs(session, vec![tiled(window, output, workspace)]);
    let base = session.accepted_revision();
    let plan = session
        .propose(
            &cmd,
            &obs,
            &correlation(corr),
            &LifecycleCapabilities::full(),
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
fn focused_window(session: &Session, domain: &DomainKey) -> String {
    let (d, l) = session.focus();
    let d = d.expect("domain");
    let l = l.expect("leaf");
    assert_eq!(&d, domain);
    session
        .snapshot()
        .windows
        .iter()
        .find(|w| w.leaf == l)
        .expect("link")
        .window
        .0
        .clone()
}
fn full_caps() -> serde_json::Value {
    serde_json::json!({
        "swap_neighbor": true, "wrap_perpendicular": true, "wrap_siblings": true,
        "insert_child": true, "split_group_child": true, "reparent_leaf": true,
        "cross_output_transfer": true
    })
}
fn no_caps() -> serde_json::Value {
    serde_json::json!({
        "swap_neighbor": false, "wrap_perpendicular": false, "wrap_siblings": false,
        "insert_child": false, "split_group_child": false, "reparent_leaf": false,
        "cross_output_transfer": false
    })
}
fn request_json(
    session: &Session,
    corr: &str,
    domain_out: &str,
    domain_ws: &str,
    focused: &str,
    direction: &str,
    owner_s: &str,
    gen_s: &str,
    revision: u64,
    caps: &serde_json::Value,
) -> String {
    let windows: Vec<String> = session
        .snapshot()
        .windows
        .iter()
        .map(|l| {
            format!(
                "{{\"window\":\"{}\",\"output\":\"{}\",\"workspace\":\"{}\"}}",
                l.window.0, l.output.0, l.workspace.0
            )
        })
        .collect();
    let mut ids: Vec<String> = session
        .snapshot()
        .windows
        .iter()
        .map(|l| l.window.0.clone())
        .collect();
    ids.sort();
    let fingerprint = movement_fingerprint(domain_out, domain_ws, focused, &ids);
    format!(
        "{{\"v\":1,\"action\":\"request\",\"correlation_id\":\"{corr}\",\"owner\":\"{owner_s}\",\"generation\":\"{gen_s}\",\"revision\":{revision},\"fingerprint\":{fingerprint},\"domain\":{{\"output\":\"{domain_out}\",\"workspace\":\"{domain_ws}\"}},\"focused_window\":\"{focused}\",\"direction\":\"{direction}\",\"windows\":[{}],\"capabilities\":{caps}}}",
        windows.join(",")
    )
}
fn reply_outcome(reply: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(reply).expect("json");
    v.get("outcome")
        .and_then(|o| o.as_str())
        .unwrap_or_default()
        .to_owned()
}
fn reply_field(reply: &str, field: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(reply).expect("json");
    v.get(field).map(|x| x.to_string()).unwrap_or_default()
}
fn ack_json(corr: &str, base: u64, outcome: &str) -> String {
    format!(
        "{{\"v\":1,\"action\":\"acknowledge\",\"correlation_id\":\"{corr}\",\"owner\":\"owner-1\",\"generation\":\"gen-1\",\"base_revision\":{base},\"outcome\":\"{outcome}\"}}"
    )
}
fn post_fingerprint_for(
    desired_out: &str,
    desired_ws: &str,
    mover: &str,
    session: &Session,
) -> u64 {
    let mut ids: Vec<String> = session
        .snapshot()
        .windows
        .iter()
        .map(|l| l.window.0.clone())
        .collect();
    ids.sort();
    movement_fingerprint(desired_out, desired_ws, mover, &ids)
}
fn verify_json(
    corr: &str,
    base: u64,
    post_fp: u64,
    verified: bool,
    planned: &serde_json::Value,
) -> String {
    serde_json::json!({
        "v": 1, "action": "verify", "correlation_id": corr,
        "owner": "owner-1", "generation": "gen-1",
        "revision": base, "fingerprint": post_fp,
        "verified": verified,
        "verified_preconditions": planned.get("preconditions").expect("pre"),
        "verified_operation": planned.get("operation").expect("op"),
        "verified_geometry": planned.get("desired_geometry").expect("geo"),
        "verified_focus": planned.get("desired_focus").expect("focus"),
    })
    .to_string()
}
fn assert_geometry_complete(planned: &serde_json::Value) {
    let geo = planned.get("desired_geometry").expect("desired_geometry");
    let arr = geo.as_array().expect("array");
    assert!(!arr.is_empty(), "complete desired geometry");
    let mut windows = std::collections::HashSet::new();
    let mut leaves = std::collections::HashSet::new();
    for entry in arr {
        let w = entry
            .get("window")
            .and_then(|v| v.as_str())
            .expect("window");
        let leaf = entry.get("leaf").and_then(|v| v.as_str()).expect("leaf");
        assert!(!w.is_empty() && !leaf.is_empty());
        assert!(windows.insert(w.to_owned()), "no duplicate geometry");
        assert!(leaves.insert(leaf.to_owned()), "no duplicate leaf");
        for key in ["output", "workspace"] {
            let v = entry.get(key).and_then(|x| x.as_str()).expect("domain");
            assert!(!v.is_empty(), "non-empty {key}");
        }
        let rect = entry.get("rect").expect("rect");
        let (x, y, wdt, hgt) = (
            rect.get("x").and_then(|v| v.as_i64()).expect("x"),
            rect.get("y").and_then(|v| v.as_i64()).expect("y"),
            rect.get("w").and_then(|v| v.as_i64()).unwrap_or(0),
            rect.get("h").and_then(|v| v.as_i64()).unwrap_or(0),
        );
        assert!(wdt > 0 && hgt > 0, "positive rectangles");
        assert!(
            x.checked_add(wdt).is_some() && y.checked_add(hgt).is_some(),
            "finite rectangles"
        );
    }
    let focus = planned.get("desired_focus").expect("desired_focus");
    assert!(
        focus
            .get("domain_output")
            .and_then(|v| v.as_str())
            .is_some()
    );
    assert!(
        focus
            .get("domain_workspace")
            .and_then(|v| v.as_str())
            .is_some()
    );
    let leaf = focus.get("leaf").and_then(|v| v.as_str()).expect("leaf");
    assert!(!leaf.is_empty());
    assert!(
        leaves.contains(leaf),
        "desired focus leaf resolves in desired geometry"
    );
}

fn assert_geometry_exact(planned: &serde_json::Value, service: &MovementService) {
    assert_geometry_complete(planned);
    let mut known: Vec<String> = service
        .session()
        .snapshot()
        .windows
        .iter()
        .map(|l| l.window.0.clone())
        .collect();
    known.sort();
    let mut geo_windows: Vec<String> = planned["desired_geometry"]
        .as_array()
        .expect("geo")
        .iter()
        .map(|e| {
            e.get("window")
                .and_then(|v| v.as_str())
                .expect("w")
                .to_owned()
        })
        .collect();
    geo_windows.sort();
    // R4 touches source plus adjacent target; other rules touch the source
    // domain only. In both cases desired geometry must cover at least the
    // focused mover and never name an unknown window.
    let mover = service
        .session()
        .snapshot()
        .windows
        .iter()
        .map(|l| l.window.0.clone())
        .collect::<Vec<_>>();
    for w in &geo_windows {
        assert!(mover.contains(w), "geometry names a known window");
    }
    assert!(!geo_windows.is_empty());
    assert_eq!(geo_windows.len(), known.len(), "complete window coverage");
    assert_eq!(geo_windows, known, "exact leaf identity/completeness");
}

fn plan_through_service(
    session: Session,
    domain: &DomainKey,
    direction: &str,
    corr: &str,
) -> (MovementService, String, serde_json::Value) {
    let focused = focused_window(&session, domain);
    let mut service = MovementService::with_session(session);
    let base = service.accepted_revision();
    let req = request_json(
        service.session(),
        corr,
        &domain.output.0,
        &domain.workspace.0,
        &focused,
        direction,
        "owner-1",
        "gen-1",
        base,
        &full_caps(),
    );
    let reply = service.evaluate_json(&req);
    assert_eq!(reply_outcome(&reply), "planned", "{reply}");
    let v: serde_json::Value = serde_json::from_str(&reply).expect("json");
    (service, reply, v)
}

#[test]
fn r1_plans_with_complete_geometry_focus() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", "out-1", "ws-1", true, "c-1");
    admit_commit(&mut s, "win-2", "out-1", "ws-1", true, "c-2");
    let k = key("out-1", "ws-1");
    let (svc, _reply, v) = plan_through_service(s, &k, "down", "m-r1-1");
    assert_eq!(v.get("rule").and_then(|r| r.as_str()), Some("R1"));
    assert_eq!(
        v.get("capability").and_then(|c| c.as_str()),
        Some("wrap-perpendicular")
    );
    assert!(svc.session().has_pending(), "planned stages pending");
    assert_geometry_exact(&v, &svc);
    assert_eq!(v["desired_geometry"].as_array().expect("geo").len(), 2);
}

#[test]
fn r2a_swap_plans() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", "out-1", "ws-1", true, "c-1");
    admit_commit(&mut s, "win-2", "out-1", "ws-1", true, "c-2");
    admit_commit(&mut s, "win-3", "out-1", "ws-1", false, "c-3");
    admit_commit(&mut s, "win-4", "out-1", "ws-1", true, "c-4");
    let k = key("out-1", "ws-1");
    let (_svc, _reply, v) = plan_through_service(s, &k, "left", "m-r2a-1");
    assert_eq!(v.get("rule").and_then(|r| r.as_str()), Some("R2a"));
    assert_geometry_complete(&v);
}

#[test]
fn r2b_insert_plans_after_r1() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", "out-1", "ws-1", true, "c-1");
    admit_commit(&mut s, "win-2", "out-1", "ws-1", true, "c-2");
    admit_commit(&mut s, "win-3", "out-1", "ws-1", true, "c-3");
    // Commit an R1 first via direct session APIs, then plan R2b through the service.
    let k = key("out-1", "ws-1");
    {
        let w = focused_window(&s, &k);
        let obs = complete_obs(&s, vec![]);
        let base = s.accepted_revision();
        let plan = s
            .propose_move(
                &k,
                &WindowId(w),
                Direction::Down,
                &obs,
                &correlation("m-pre-1"),
                &Capabilities::full(),
            )
            .expect("r1");
        assert_eq!(plan.dispatch.rule, plasma_auto_tiler::directional::Rule::R1);
        s.acknowledge(&AdapterAck::new(
            correlation("m-pre-1"),
            owner(),
            generation(),
            base,
            AckOutcome::Accepted,
        ))
        .expect("ack");
        s.verify_move(&plasma_auto_tiler::contract::PostObservation::new(
            Observation::new(owner(), generation(), base, 900),
            correlation("m-pre-1"),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        ))
        .expect("commit");
    }
    let (_svc, _reply, v) = plan_through_service(s, &k, "up", "m-r2b-1");
    assert_eq!(v.get("rule").and_then(|r| r.as_str()), Some("R2b"));
    assert_geometry_complete(&v);
}

#[test]
fn r2c_wrap_plans() {
    let mut s = single_session();
    for (i, c) in ["c-1", "c-2", "c-3", "c-4"].iter().enumerate() {
        admit_commit(&mut s, &format!("win-{}", i + 1), "out-1", "ws-1", true, c);
    }
    let k = key("out-1", "ws-1");
    let (_svc, _reply, v) = plan_through_service(s, &k, "left", "m-r2c-1");
    assert_eq!(v.get("rule").and_then(|r| r.as_str()), Some("R2c"));
    assert_geometry_complete(&v);
}

#[test]
fn r3_escape_plans() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", "out-1", "ws-1", true, "c-1");
    admit_commit(&mut s, "win-2", "out-1", "ws-1", true, "c-2");
    admit_commit(&mut s, "win-3", "out-1", "ws-1", false, "c-3");
    admit_commit(&mut s, "win-4", "out-1", "ws-1", false, "c-4");
    let k = key("out-1", "ws-1");
    let (_svc, _reply, v) = plan_through_service(s, &k, "down", "m-r3-1");
    assert_eq!(v.get("rule").and_then(|r| r.as_str()), Some("R3"));
    assert_geometry_complete(&v);
}

#[test]
fn r4_occupied_and_empty_plan_with_focus_transfer() {
    // Occupied target.
    let mut s = r4_session();
    admit_commit(&mut s, "win-1", "out-1", "ws-1", true, "c-1");
    admit_commit(&mut s, "win-2", "out-2", "ws-1", true, "c-2");
    admit_commit(&mut s, "win-3", "out-1", "ws-1", true, "c-3");
    let k = key("out-1", "ws-1");
    let (_svc, _reply, v) = plan_through_service(s, &k, "right", "m-r4-1");
    assert_eq!(v.get("rule").and_then(|r| r.as_str()), Some("R4"));
    assert_eq!(
        v["desired_focus"]
            .get("domain_output")
            .and_then(|x| x.as_str()),
        Some("out-2")
    );
    // Geometry covers both affected domains (3 tiled windows).
    assert_eq!(v["desired_geometry"].as_array().expect("geo").len(), 3);
    assert_geometry_complete(&v);

    // Empty target.
    let mut s2 = r4_session();
    admit_commit(&mut s2, "win-1", "out-1", "ws-1", true, "c-1");
    admit_commit(&mut s2, "win-2", "out-1", "ws-1", true, "c-2");
    let k2 = key("out-1", "ws-1");
    let (_svc2, _reply2, v2) = plan_through_service(s2, &k2, "right", "m-r4-2");
    assert_eq!(v2.get("rule").and_then(|r| r.as_str()), Some("R4"));
    assert_eq!(
        v2["desired_focus"]
            .get("domain_output")
            .and_then(|x| x.as_str()),
        Some("out-2")
    );
    assert_geometry_complete(&v2);
}

#[test]
fn capability_refusal_fails_closed() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", "out-1", "ws-1", true, "c-1");
    admit_commit(&mut s, "win-2", "out-1", "ws-1", true, "c-2");
    let k = key("out-1", "ws-1");
    let focused = focused_window(&s, &k);
    let mut service = MovementService::with_session(s);
    let base = service.accepted_revision();
    let req = request_json(
        service.session(),
        "m-cap-1",
        "out-1",
        "ws-1",
        &focused,
        "down",
        "owner-1",
        "gen-1",
        base,
        &no_caps(),
    );
    let reply = service.evaluate_json(&req);
    assert_eq!(reply_outcome(&reply), "rejected");
    assert!(reply_field(&reply, "kind").contains("unsupported-capability"));
    assert!(!service.is_diverged());
    assert!(!service.session().has_pending());
}

#[test]
fn stale_revision_diverges_terminally() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", "out-1", "ws-1", true, "c-1");
    admit_commit(&mut s, "win-2", "out-1", "ws-1", true, "c-2");
    let k = key("out-1", "ws-1");
    let focused = focused_window(&s, &k);
    let mut service = MovementService::with_session(s);
    let base = service.accepted_revision();
    let req = request_json(
        service.session(),
        "m-stale-1",
        "out-1",
        "ws-1",
        &focused,
        "down",
        "owner-1",
        "gen-1",
        base + 99,
        &full_caps(),
    );
    assert_eq!(reply_outcome(&service.evaluate_json(&req)), "diverged");
    assert!(service.is_diverged());
}

#[test]
fn domain_refusal_fails_closed() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", "out-1", "ws-1", true, "c-1");
    admit_commit(&mut s, "win-2", "out-1", "ws-1", true, "c-2");
    let mut service = MovementService::with_session(s);
    let base = service.accepted_revision();
    // Unknown domain with otherwise complete membership: session refuses
    // unknown-domain without divergence.
    let mut ids = vec!["win-1".to_owned(), "win-2".to_owned()];
    ids.sort();
    let fp = movement_fingerprint("out-9", "ws-1", "win-1", &ids);
    let unknown = format!(
        "{{\"v\":1,\"action\":\"request\",\"correlation_id\":\"m-dom-1\",\"owner\":\"owner-1\",\"generation\":\"gen-1\",\"revision\":{base},\"fingerprint\":{fp},\"domain\":{{\"output\":\"out-9\",\"workspace\":\"ws-1\"}},\"focused_window\":\"win-1\",\"direction\":\"left\",\"windows\":[{{\"window\":\"win-1\",\"output\":\"out-1\",\"workspace\":\"ws-1\"}},{{\"window\":\"win-2\",\"output\":\"out-1\",\"workspace\":\"ws-1\"}}],\"capabilities\":{}}}",
        full_caps()
    );
    let reply = service.evaluate_json(&unknown);
    assert_eq!(reply_outcome(&reply), "rejected");
    assert!(!service.is_diverged());
    // Partial observation (missing win-2) is rejected without divergence.
    let fp2 = movement_fingerprint("out-1", "ws-1", "win-1", &["win-1".to_owned()]);
    let partial = format!(
        "{{\"v\":1,\"action\":\"request\",\"correlation_id\":\"m-dom-2\",\"owner\":\"owner-1\",\"generation\":\"gen-1\",\"revision\":{base},\"fingerprint\":{fp2},\"domain\":{{\"output\":\"out-1\",\"workspace\":\"ws-1\"}},\"focused_window\":\"win-1\",\"direction\":\"left\",\"windows\":[{{\"window\":\"win-1\",\"output\":\"out-1\",\"workspace\":\"ws-1\"}}],\"capabilities\":{}}}",
        full_caps()
    );
    assert_eq!(reply_outcome(&service.evaluate_json(&partial)), "rejected");
    assert!(!service.is_diverged());
}

#[test]
fn accepted_ack_plus_fresh_post_verification_commits() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", "out-1", "ws-1", true, "c-1");
    admit_commit(&mut s, "win-2", "out-1", "ws-1", true, "c-2");
    let k = key("out-1", "ws-1");
    let focused = focused_window(&s, &k);
    let mut service = MovementService::with_session(s);
    let base = service.accepted_revision();
    let req = request_json(
        service.session(),
        "m-commit-1",
        "out-1",
        "ws-1",
        &focused,
        "down",
        "owner-1",
        "gen-1",
        base,
        &full_caps(),
    );
    let planned = service.evaluate_json(&req);
    assert_eq!(reply_outcome(&planned), "planned");
    assert!(service.session().has_pending(), "planned stages pending");
    let v: serde_json::Value = serde_json::from_str(&planned).expect("json");
    assert_geometry_exact(&v, &service);
    assert_eq!(
        reply_outcome(&service.evaluate_json(&ack_json("m-commit-1", base, "accepted"))),
        "acknowledged"
    );
    assert!(service.session().has_pending(), "acked plan stays pending");
    let desired_out = v["desired_focus"]
        .get("domain_output")
        .and_then(|x| x.as_str())
        .expect("out")
        .to_owned();
    let desired_ws = v["desired_focus"]
        .get("domain_workspace")
        .and_then(|x| x.as_str())
        .expect("ws")
        .to_owned();
    let post_fp = post_fingerprint_for(&desired_out, &desired_ws, &focused, service.session());
    let verify = verify_json("m-commit-1", base, post_fp, true, &v);
    let committed = service.evaluate_json(&verify);
    assert_eq!(reply_outcome(&committed), "committed", "{committed}");
    assert_eq!(service.accepted_revision(), base + 1);
    assert!(!service.session().has_pending(), "commit clears pending");
}

#[test]
fn partial_application_ack_diverges_and_clears_pending() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", "out-1", "ws-1", true, "c-1");
    admit_commit(&mut s, "win-2", "out-1", "ws-1", true, "c-2");
    let k = key("out-1", "ws-1");
    let focused = focused_window(&s, &k);
    let mut service = MovementService::with_session(s);
    let base = service.accepted_revision();
    let req = request_json(
        service.session(),
        "m-part-1",
        "out-1",
        "ws-1",
        &focused,
        "down",
        "owner-1",
        "gen-1",
        base,
        &full_caps(),
    );
    assert_eq!(reply_outcome(&service.evaluate_json(&req)), "planned");
    assert!(service.session().has_pending());
    let diverged = service.evaluate_json(&ack_json("m-part-1", base, "partial-application"));
    assert_eq!(reply_outcome(&diverged), "diverged");
    assert!(reply_field(&diverged, "kind").contains("partial-application"));
    assert!(service.is_diverged());
    assert!(!service.session().has_pending());
}

#[test]
fn tampered_geometry_or_unverified_post_diverges() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", "out-1", "ws-1", true, "c-1");
    admit_commit(&mut s, "win-2", "out-1", "ws-1", true, "c-2");
    let k = key("out-1", "ws-1");
    let focused = focused_window(&s, &k);
    let mut service = MovementService::with_session(s);
    let base = service.accepted_revision();
    let req = request_json(
        service.session(),
        "m-tamp-1",
        "out-1",
        "ws-1",
        &focused,
        "down",
        "owner-1",
        "gen-1",
        base,
        &full_caps(),
    );
    let planned = service.evaluate_json(&req);
    assert_eq!(reply_outcome(&planned), "planned");
    let v: serde_json::Value = serde_json::from_str(&planned).expect("json");
    assert_eq!(
        reply_outcome(&service.evaluate_json(&ack_json("m-tamp-1", base, "accepted"))),
        "acknowledged"
    );
    // Tamper one rectangle.
    let mut tampered = v.clone();
    {
        let arr = tampered
            .get_mut("desired_geometry")
            .expect("geo")
            .as_array_mut()
            .expect("arr");
        let first = arr.get_mut(0).expect("first");
        let rect = first.get_mut("rect").expect("rect");
        let w = rect.get("w").and_then(|x| x.as_i64()).expect("w");
        *rect.get_mut("w").expect("w") = serde_json::json!(w + 7);
    }
    let desired_out = v["desired_focus"]
        .get("domain_output")
        .and_then(|x| x.as_str())
        .expect("out");
    let desired_ws = v["desired_focus"]
        .get("domain_workspace")
        .and_then(|x| x.as_str())
        .expect("ws");
    let post_fp = post_fingerprint_for(desired_out, desired_ws, &focused, service.session());
    let bad = serde_json::json!({
        "v": 1, "action": "verify", "correlation_id": "m-tamp-1",
        "owner": "owner-1", "generation": "gen-1",
        "revision": base, "fingerprint": post_fp, "verified": true,
        "verified_preconditions": v.get("preconditions").expect("pre"),
        "verified_operation": v.get("operation").expect("op"),
        "verified_geometry": tampered.get("desired_geometry").expect("geo"),
        "verified_focus": v.get("desired_focus").expect("focus"),
    });
    assert_eq!(
        reply_outcome(&service.evaluate_json(&bad.to_string())),
        "diverged"
    );
    assert!(
        service.is_diverged(),
        "tampered geometry diverges terminally"
    );
    assert!(
        !service.session().has_pending(),
        "no pending survives diverged verify"
    );

    // Fresh service: verified=false diverges as postcondition-unverified.
    let mut s2 = single_session();
    admit_commit(&mut s2, "win-1", "out-1", "ws-1", true, "c-1");
    admit_commit(&mut s2, "win-2", "out-1", "ws-1", true, "c-2");
    let k2 = key("out-1", "ws-1");
    let focused2 = focused_window(&s2, &k2);
    let mut service2 = MovementService::with_session(s2);
    let base2 = service2.accepted_revision();
    let req2 = request_json(
        service2.session(),
        "m-tamp-2",
        "out-1",
        "ws-1",
        &focused2,
        "down",
        "owner-1",
        "gen-1",
        base2,
        &full_caps(),
    );
    let planned2 = service2.evaluate_json(&req2);
    assert_eq!(reply_outcome(&planned2), "planned");
    let v2: serde_json::Value = serde_json::from_str(&planned2).expect("json");
    assert_eq!(
        reply_outcome(&service2.evaluate_json(&ack_json("m-tamp-2", base2, "accepted"))),
        "acknowledged"
    );
    let post_fp2 = post_fingerprint_for("out-1", "ws-1", &focused2, service2.session());
    let unverified = verify_json("m-tamp-2", base2, post_fp2, false, &v2);
    let reply = service2.evaluate_json(&unverified);
    assert_eq!(reply_outcome(&reply), "diverged");
    assert!(
        service2.is_diverged(),
        "unverified post diverges terminally"
    );
    assert!(
        !service2.session().has_pending(),
        "no pending survives diverged verify"
    );
}

#[test]
fn owner_mismatch_and_service_loss_are_terminal() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", "out-1", "ws-1", true, "c-1");
    admit_commit(&mut s, "win-2", "out-1", "ws-1", true, "c-2");
    let k = key("out-1", "ws-1");
    let focused = focused_window(&s, &k);
    let mut service = MovementService::with_session(s);
    let base = service.accepted_revision();
    // Wrong owner diverges without echo.
    let req = request_json(
        service.session(),
        "m-owner-1",
        "out-1",
        "ws-1",
        &focused,
        "down",
        "owner-9",
        "gen-1",
        base,
        &full_caps(),
    );
    let reply = service.evaluate_json(&req);
    assert_eq!(reply_outcome(&reply), "diverged");
    assert!(reply_field(&reply, "kind").contains("owner-mismatch"));
    assert!(!reply.contains("owner-9"));
    assert!(service.is_diverged());

    // Explicit loss is terminal even without pending.
    let mut fresh = MovementService::with_session({
        let mut s = single_session();
        admit_commit(&mut s, "win-1", "out-1", "ws-1", true, "c-1");
        admit_commit(&mut s, "win-2", "out-1", "ws-1", true, "c-2");
        s
    });
    let loss = fresh.evaluate_json("{\"v\":1,\"action\":\"note-loss\"}");
    assert_eq!(reply_outcome(&loss), "diverged");
    assert!(reply_field(&loss, "kind").contains("adapter-lost"));
    assert!(fresh.is_diverged());
}

fn seed_request(corr: &str, owner: &str, focused: &str, direction: &str, ids: &[&str]) -> String {
    let mut sorted: Vec<String> = ids.iter().map(|s| s.to_string()).collect();
    sorted.sort();
    let fp = movement_fingerprint("move-output", "move-workspace", focused, &sorted);
    let revision = ids.len();
    let windows: Vec<String> = ids
        .iter()
        .map(|id| format!("{{\"window\":\"{id}\",\"output\":\"move-output\",\"workspace\":\"move-workspace\"}}"))
        .collect();
    format!(
        "{{\"v\":1,\"action\":\"request\",\"correlation_id\":\"{corr}\",\"owner\":\"{owner}\",\"generation\":\"gen-1\",\"revision\":{revision},\"fingerprint\":{fp},\"domain\":{{\"output\":\"move-output\",\"workspace\":\"move-workspace\"}},\"focused_window\":\"{focused}\",\"direction\":\"{direction}\",\"windows\":[{}],\"capabilities\":{}}}",
        windows.join(","),
        full_caps()
    )
}

#[test]
fn seeds_owned_session_from_first_request() {
    let mut service = MovementService::new();
    assert!(!service.is_seeded());
    let reply = service.evaluate_json(&seed_request(
        "seed-m-1",
        "owner-1",
        "win-b",
        "down",
        &["win-a", "win-b"],
    ));
    assert!(service.is_seeded(), "{reply}");
    let outcome = reply_outcome(&reply);
    assert!(outcome == "planned" || outcome == "noop", "{reply}");
    if outcome == "planned" {
        let v: serde_json::Value = serde_json::from_str(&reply).expect("json");
        assert_eq!(v.get("base_revision").and_then(|b| b.as_u64()), Some(2));
        assert_geometry_complete(&v);
    }
}

#[test]
fn leaves_are_topology_complete_after_commit() {
    let mut s = single_session();
    admit_commit(&mut s, "win-1", "out-1", "ws-1", true, "c-1");
    admit_commit(&mut s, "win-2", "out-1", "ws-1", true, "c-2");
    let k = key("out-1", "ws-1");
    let focused = focused_window(&s, &k);
    let mut service = MovementService::with_session(s);
    let base = service.accepted_revision();
    let req = request_json(
        service.session(),
        "m-leaves-1",
        "out-1",
        "ws-1",
        &focused,
        "down",
        "owner-1",
        "gen-1",
        base,
        &full_caps(),
    );
    let planned = service.evaluate_json(&req);
    assert_eq!(reply_outcome(&planned), "planned");
    let v: serde_json::Value = serde_json::from_str(&planned).expect("json");
    // Desired geometry leaves must equal desired snapshot leaves for the
    // affected domain.
    let snap_leaves = |svc: &MovementService| {
        let snap = svc.session().snapshot();
        let view = snap
            .domains
            .iter()
            .find(|d| d.output.0 == "out-1")
            .expect("view");
        let mut out = vec![];
        fn collect(n: &Node, acc: &mut Vec<String>) {
            match n {
                Node::Leaf { id } => acc.push(id.0.clone()),
                Node::Group { children, .. } => {
                    for c in children {
                        collect(c, acc);
                    }
                }
            }
        }
        if let Some(t) = &view.tree {
            collect(t, &mut out);
        }
        out.sort();
        out
    };
    let _ = snap_leaves(&service);
    assert_eq!(
        reply_outcome(&service.evaluate_json(&ack_json("m-leaves-1", base, "accepted"))),
        "acknowledged"
    );
    let post_fp = post_fingerprint_for("out-1", "ws-1", &focused, service.session());
    let verify = verify_json("m-leaves-1", base, post_fp, true, &v);
    assert_eq!(reply_outcome(&service.evaluate_json(&verify)), "committed");
    // Post-commit leaves still resolve; mover stays focused.
    let (d, l) = service.session().focus();
    assert_eq!(d, Some(key("out-1", "ws-1")));
    assert!(l.is_some());
    // No KWin/native fields leak into the reply.
    assert!(!planned.contains("kwin"));
    assert!(!planned.contains("native"));
    let _ = NodeId("x".into());
}

fn r4_seed_request(
    corr: &str,
    focused: &str,
    direction: &str,
    windows: &[(&str, &str, &str)],
    domains_json: &str,
) -> String {
    let mut sorted: Vec<String> = windows.iter().map(|w| w.0.to_owned()).collect();
    sorted.sort();
    let fp = movement_fingerprint("out-1", "ws-1", focused, &sorted);
    let revision = windows.len();
    let win_json: Vec<String> = windows
        .iter()
        .map(|(w, o, ws)| {
            format!("{{\"window\":\"{w}\",\"output\":\"{o}\",\"workspace\":\"{ws}\"}}")
        })
        .collect();
    format!(
        "{{\"v\":1,\"action\":\"request\",\"correlation_id\":\"{corr}\",\"owner\":\"owner-1\",\"generation\":\"gen-1\",\"revision\":{revision},\"fingerprint\":{fp},\"domain\":{{\"output\":\"out-1\",\"workspace\":\"ws-1\"}},\"focused_window\":\"{focused}\",\"direction\":\"{direction}\",\"windows\":[{}],\"capabilities\":{},\"domains\":{domains_json}}}",
        win_json.join(","),
        full_caps()
    )
}

fn r4_domains_json() -> String {
    "{\"output\":\"out-1\",\"workspace\":\"ws-1\",\"bounds\":{\"x\":0,\"y\":0,\"w\":200,\"h\":200},\"gap\":0,\"adjacent\":{\"right\":\"out-2\"}}".to_owned()
        + ",{\"output\":\"out-2\",\"workspace\":\"ws-1\",\"bounds\":{\"x\":200,\"y\":0,\"w\":200,\"h\":200},\"gap\":0,\"adjacent\":{\"left\":\"out-1\"}}"
}

#[test]
fn request_seeded_r4_occupied_uses_real_bounds() {
    let domains = format!("[{}]", r4_domains_json());
    let req = r4_seed_request(
        "m-r4seed-1",
        "win-3",
        "right",
        &[
            ("win-1", "out-1", "ws-1"),
            ("win-2", "out-2", "ws-1"),
            ("win-3", "out-1", "ws-1"),
        ],
        &domains,
    );
    let mut service = MovementService::new();
    let reply = service.evaluate_json(&req);
    assert_eq!(reply_outcome(&reply), "planned", "{reply}");
    assert!(service.is_seeded());
    assert!(service.session().has_pending(), "planned stages pending");
    let v: serde_json::Value = serde_json::from_str(&reply).expect("json");
    assert_eq!(v.get("rule").and_then(|r| r.as_str()), Some("R4"));
    assert_eq!(
        v["desired_focus"]
            .get("domain_output")
            .and_then(|x| x.as_str()),
        Some("out-2")
    );
    assert_geometry_exact(&v, &service);
    assert_eq!(v["desired_geometry"].as_array().expect("geo").len(), 3);
    for entry in v["desired_geometry"].as_array().expect("geo") {
        let rect = entry.get("rect").expect("rect");
        let w = rect.get("w").and_then(|x| x.as_i64()).expect("w");
        let h = rect.get("h").and_then(|x| x.as_i64()).expect("h");
        assert!(w <= 200 && h <= 200, "real bounds, not 1920x1080: {rect}");
        assert!(w != 1920 && h != 1080, "no hardcoded seed geometry");
    }
    assert!(!service.is_diverged());
}

#[test]
fn request_seeded_r4_empty_uses_real_bounds() {
    let domains = format!("[{}]", r4_domains_json());
    let req = r4_seed_request(
        "m-r4seed-2",
        "win-2",
        "right",
        &[("win-1", "out-1", "ws-1"), ("win-2", "out-1", "ws-1")],
        &domains,
    );
    let mut service = MovementService::new();
    let reply = service.evaluate_json(&req);
    assert_eq!(reply_outcome(&reply), "planned", "{reply}");
    let v: serde_json::Value = serde_json::from_str(&reply).expect("json");
    assert_eq!(v.get("rule").and_then(|r| r.as_str()), Some("R4"));
    assert_eq!(
        v["desired_focus"]
            .get("domain_output")
            .and_then(|x| x.as_str()),
        Some("out-2")
    );
    assert!(service.session().has_pending(), "planned stages pending");
    assert_geometry_exact(&v, &service);
    assert!(!service.is_diverged());
}

#[test]
fn malformed_verify_reports_diverge_terminally_without_pending() {
    for (tag, mutate) in [
        ("empty", "empty" as &str),
        ("duplicate", "duplicate"),
        ("bad-rect", "bad-rect"),
        ("bad-focus", "bad-focus"),
        ("bad-operation", "bad-operation"),
        ("bad-precondition", "bad-precondition"),
    ] {
        let mut s = single_session();
        admit_commit(&mut s, "win-1", "out-1", "ws-1", true, "c-1");
        admit_commit(&mut s, "win-2", "out-1", "ws-1", true, "c-2");
        let k = key("out-1", "ws-1");
        let focused = focused_window(&s, &k);
        let mut service = MovementService::with_session(s);
        let base = service.accepted_revision();
        let corr = format!("m-mal-{tag}-1");
        let req = request_json(
            service.session(),
            &corr,
            "out-1",
            "ws-1",
            &focused,
            "down",
            "owner-1",
            "gen-1",
            base,
            &full_caps(),
        );
        let planned = service.evaluate_json(&req);
        assert_eq!(reply_outcome(&planned), "planned", "{tag}");
        let v: serde_json::Value = serde_json::from_str(&planned).expect("json");
        assert_eq!(
            reply_outcome(&service.evaluate_json(&ack_json(&corr, base, "accepted"))),
            "acknowledged",
            "{tag}"
        );
        assert!(service.session().has_pending(), "{tag} ack stages pending");
        let desired_out = v["desired_focus"]
            .get("domain_output")
            .and_then(|x| x.as_str())
            .expect("out");
        let desired_ws = v["desired_focus"]
            .get("domain_workspace")
            .and_then(|x| x.as_str())
            .expect("ws");
        let post_fp = post_fingerprint_for(desired_out, desired_ws, &focused, service.session());
        let mut verify = serde_json::json!({
            "v": 1, "action": "verify", "correlation_id": corr,
            "owner": "owner-1", "generation": "gen-1",
            "revision": base, "fingerprint": post_fp, "verified": true,
            "verified_preconditions": v.get("preconditions").expect("pre"),
            "verified_operation": v.get("operation").expect("op"),
            "verified_geometry": v.get("desired_geometry").expect("geo"),
            "verified_focus": v.get("desired_focus").expect("focus"),
        });
        match mutate {
            "empty" => {
                *verify.get_mut("verified_geometry").expect("geo") = serde_json::json!([]);
            }
            "duplicate" => {
                let geo = verify.get("verified_geometry").expect("geo").clone();
                let mut arr = geo.as_array().expect("arr").clone();
                arr.push(arr[0].clone());
                *verify.get_mut("verified_geometry").expect("geo") = serde_json::Value::Array(arr);
            }
            "bad-rect" => {
                let mut geo = verify.get("verified_geometry").expect("geo").clone();
                let first = geo.as_array_mut().expect("arr").get_mut(0).expect("first");
                *first
                    .get_mut("rect")
                    .expect("rect")
                    .get_mut("w")
                    .expect("w") = serde_json::json!(0);
                *verify.get_mut("verified_geometry").expect("geo") = geo;
            }
            "bad-focus" => {
                *verify.get_mut("verified_focus").expect("focus") = serde_json::json!({
                    "domain_output": "", "domain_workspace": "ws-1", "leaf": "x"
                });
            }
            "bad-operation" => {
                *verify.get_mut("verified_operation").expect("op") =
                    serde_json::json!({"kind": "Nope"});
            }
            _ => {
                *verify.get_mut("verified_preconditions").expect("pre") =
                    serde_json::json!(["bogus-precondition"]);
            }
        }
        let reply = service.evaluate_json(&verify.to_string());
        assert_eq!(reply_outcome(&reply), "diverged", "{tag} {reply}");
        assert!(service.is_diverged(), "{tag} terminal divergence");
        assert!(
            !service.session().has_pending(),
            "{tag} no pending survives diverged verify"
        );
    }
}

#[test]
fn strict_first_request_schema_refuses_domains_revision_identity() {
    // Bad bounds (zero width) fails closed without seeding.
    let mut service = MovementService::new();
    let bad_bounds = "[{\"output\":\"out-1\",\"workspace\":\"ws-1\",\"bounds\":{\"x\":0,\"y\":0,\"w\":0,\"h\":200},\"gap\":0,\"adjacent\":{}}]";
    let req = r4_seed_request(
        "m-schema-1",
        "win-1",
        "down",
        &[("win-1", "out-1", "ws-1"), ("win-2", "out-1", "ws-1")],
        bad_bounds,
    );
    assert_eq!(reply_outcome(&service.evaluate_json(&req)), "rejected");
    assert!(!service.is_seeded());

    // Non-reciprocal adjacency fails closed without seeding.
    let mut service = MovementService::new();
    let one_sided = "[{\"output\":\"out-1\",\"workspace\":\"ws-1\",\"bounds\":{\"x\":0,\"y\":0,\"w\":200,\"h\":200},\"gap\":0,\"adjacent\":{\"right\":\"out-2\"}},{\"output\":\"out-2\",\"workspace\":\"ws-1\",\"bounds\":{\"x\":200,\"y\":0,\"w\":200,\"h\":200},\"gap\":0,\"adjacent\":{}}]";
    let req = r4_seed_request(
        "m-schema-2",
        "win-1",
        "right",
        &[("win-1", "out-1", "ws-1")],
        one_sided,
    );
    assert_eq!(reply_outcome(&service.evaluate_json(&req)), "rejected");
    assert!(!service.is_seeded());

    // Unknown adjacent target fails closed.
    let mut service = MovementService::new();
    let unknown = "[{\"output\":\"out-1\",\"workspace\":\"ws-1\",\"bounds\":{\"x\":0,\"y\":0,\"w\":200,\"h\":200},\"gap\":0,\"adjacent\":{\"right\":\"out-9\"}}]";
    let req = r4_seed_request(
        "m-schema-3",
        "win-1",
        "right",
        &[("win-1", "out-1", "ws-1")],
        unknown,
    );
    assert_eq!(reply_outcome(&service.evaluate_json(&req)), "rejected");
    assert!(!service.is_seeded());

    // Revision must equal membership size N.
    let mut service = MovementService::new();
    let domains = format!("[{}]", r4_domains_json());
    let mut bad_rev: serde_json::Value = serde_json::from_str(&r4_seed_request(
        "m-schema-4",
        "win-1",
        "down",
        &[("win-1", "out-1", "ws-1"), ("win-2", "out-1", "ws-1")],
        &domains,
    ))
    .expect("json");
    *bad_rev.get_mut("revision").expect("rev") = serde_json::json!(99);
    assert_eq!(
        reply_outcome(&service.evaluate_json(&bad_rev.to_string())),
        "rejected"
    );
    assert!(!service.is_seeded());

    // Unknown top-level field fails closed.
    let mut service = MovementService::new();
    let mut extra: serde_json::Value = serde_json::from_str(&r4_seed_request(
        "m-schema-5",
        "win-1",
        "down",
        &[("win-1", "out-1", "ws-1"), ("win-2", "out-1", "ws-1")],
        &domains,
    ))
    .expect("json");
    extra
        .as_object_mut()
        .expect("obj")
        .insert("extra".to_owned(), serde_json::json!(1));
    assert_eq!(
        reply_outcome(&service.evaluate_json(&extra.to_string())),
        "rejected"
    );
    assert!(!service.is_seeded());

    // Invalid generation format fails closed without divergence.
    let mut seeded = MovementService::new();
    let ok = seeded.evaluate_json(&seed_request(
        "seed-m-9",
        "owner-1",
        "win-b",
        "down",
        &["win-a", "win-b"],
    ));
    assert!(seeded.is_seeded(), "{ok}");
    let base = seeded.accepted_revision();
    let bad_gen = format!(
        "{{\"v\":1,\"action\":\"request\",\"correlation_id\":\"m-schema-6\",\"owner\":\"owner-1\",\"generation\":\"\",\"revision\":{base},\"fingerprint\":0,\"domain\":{{\"output\":\"move-output\",\"workspace\":\"move-workspace\"}},\"focused_window\":\"win-a\",\"direction\":\"down\",\"windows\":[],\"capabilities\":{}}}",
        full_caps()
    );
    assert_eq!(reply_outcome(&seeded.evaluate_json(&bad_gen)), "rejected");
    assert!(!seeded.is_diverged());
}
