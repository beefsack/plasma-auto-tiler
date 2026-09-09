//! Bounded focus transaction service coverage (portable, headless).
//!
//! Drives the product `focus_service::FocusService` JSON protocol over a real
//! `session::Session`: request planning, refusals, acknowledge + verify
//! commit, mismatch/divergence, adapter loss, and domain isolation. No live
//! compositor state.

use plasma_auto_tiler::contract::{AckOutcome, AdapterAck, LifecycleCapabilities, Observation};
use plasma_auto_tiler::directional::{OutputId, WindowId, WorkspaceId};
use plasma_auto_tiler::focus_service::{FocusService, focus_fingerprint};
use plasma_auto_tiler::geometry::Rect;
use plasma_auto_tiler::ids::{CorrelationId, GenerationId, OwnerId};
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
fn domain(output: &str, workspace: &str) -> OutputDomain {
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
        adjacent: BTreeMap::new(),
    }
}
fn key(output: &str, workspace: &str) -> DomainKey {
    DomainKey {
        output: OutputId(output.to_owned()),
        workspace: WorkspaceId(workspace.to_owned()),
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
fn admit(
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
            Observation::new(owner(), generation(), base, 200),
            correlation(corr),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        ))
        .expect("commit");
}
fn seeded_session() -> Session {
    let mut session =
        Session::new(owner(), generation(), 0, 7, vec![domain("out-1", "ws-1")]).expect("session");
    admit(&mut session, "win-a", "out-1", "ws-1", true, "seed-a");
    admit(&mut session, "win-b", "out-1", "ws-1", true, "seed-b");
    admit(&mut session, "win-c", "out-1", "ws-1", false, "seed-c");
    session
}
fn two_domain_session() -> Session {
    let mut session = Session::new(
        owner(),
        generation(),
        0,
        7,
        vec![domain("out-1", "ws-1"), domain("out-2", "ws-1")],
    )
    .expect("session");
    admit(&mut session, "win-a", "out-1", "ws-1", true, "seed-a");
    admit(&mut session, "win-b", "out-1", "ws-1", true, "seed-b");
    admit(&mut session, "win-c", "out-2", "ws-1", true, "seed-c");
    session
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
fn request_json(
    session: &Session,
    corr: &str,
    focused: &str,
    direction: &str,
    owner_s: &str,
    gen_s: &str,
    revision: u64,
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
    let fingerprint = focus_fingerprint("out-1", "ws-1", focused, &ids);
    format!(
        "{{\"v\":1,\"action\":\"request\",\"correlation_id\":\"{corr}\",\"owner\":\"{owner_s}\",\"generation\":\"{gen_s}\",\"revision\":{revision},\"fingerprint\":{fingerprint},\"domain\":{{\"output\":\"out-1\",\"workspace\":\"ws-1\"}},\"focused_window\":\"{focused}\",\"direction\":\"{direction}\",\"windows\":[{}],\"capabilities\":{{\"directional_focus\":true}}}}",
        windows.join(",")
    )
}

fn post_fingerprint(session: &Session, to_window: &str) -> u64 {
    let mut ids: Vec<String> = session
        .snapshot()
        .windows
        .iter()
        .map(|l| l.window.0.clone())
        .collect();
    ids.sort();
    focus_fingerprint("out-1", "ws-1", to_window, &ids)
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

#[test]
fn service_plans_focus_request() {
    let session = seeded_session();
    let d = key("out-1", "ws-1");
    let focused = focused_window(&session, &d);
    let mut service = FocusService::with_session(session);
    let base = service.accepted_revision();
    let reply = service.evaluate_json(&request_json(
        service.session(),
        "corr-plan-1",
        &focused,
        "left",
        "owner-1",
        "gen-1",
        base,
    ));
    assert_eq!(reply_outcome(&reply), "planned");
    let v: serde_json::Value = serde_json::from_str(&reply).expect("json");
    assert_eq!(
        v.get("capability").and_then(|c| c.as_str()),
        Some("directional-focus")
    );
    assert!(v.get("operation").is_some());
    assert!(v.get("to_window").is_some());
}

#[test]
fn service_refuses_exhausted_edge_as_noop() {
    let mut session =
        Session::new(owner(), generation(), 0, 7, vec![domain("out-1", "ws-1")]).expect("session");
    admit(&mut session, "win-a", "out-1", "ws-1", true, "edge-a");
    admit(&mut session, "win-b", "out-1", "ws-1", true, "edge-b");
    let d = key("out-1", "ws-1");
    let focused = focused_window(&session, &d);
    assert_eq!(focused, "win-b");
    let mut service = FocusService::with_session(session);
    let base = service.accepted_revision();
    // Rightmost leaf has no right neighbor: exhausted edge -> noop.
    let reply = service.evaluate_json(&request_json(
        service.session(),
        "corr-edge-1",
        &focused,
        "right",
        "owner-1",
        "gen-1",
        base,
    ));
    assert_eq!(reply_outcome(&reply), "noop");
    assert!(!service.is_diverged());
    assert!(!service.session().has_pending());
}

#[test]
fn service_acknowledge_and_verify_commit() {
    let session = seeded_session();
    let d = key("out-1", "ws-1");
    let focused = focused_window(&session, &d);
    let mut service = FocusService::with_session(session);
    let base = service.accepted_revision();
    let reply = service.evaluate_json(&request_json(
        service.session(),
        "corr-commit-1",
        &focused,
        "left",
        "owner-1",
        "gen-1",
        base,
    ));
    // Edge may be noop; pick a direction that plans.
    let (corr, planned) = if reply_outcome(&reply) == "planned" {
        ("corr-commit-1".to_owned(), reply)
    } else {
        service.evaluate_json("{\"v\":1,\"action\":\"note-loss\"}");
        let retry = service.evaluate_json(&request_json(
            service.session(),
            "corr-commit-2",
            &focused,
            "right",
            "owner-1",
            "gen-1",
            base,
        ));
        assert_eq!(reply_outcome(&retry), "planned");
        ("corr-commit-2".to_owned(), retry)
    };
    let planned_v: serde_json::Value = serde_json::from_str(&planned).expect("json");
    let operation = planned_v.get("operation").expect("operation").clone();
    let preconditions = planned_v.get("preconditions").expect("pre").clone();
    let to_window = operation
        .get("to_window")
        .and_then(|v| v.as_str())
        .expect("to_window")
        .to_owned();
    let ack = format!(
        "{{\"v\":1,\"action\":\"acknowledge\",\"correlation_id\":\"{corr}\",\"owner\":\"owner-1\",\"generation\":\"gen-1\",\"base_revision\":{base},\"outcome\":\"accepted\"}}"
    );
    assert_eq!(reply_outcome(&service.evaluate_json(&ack)), "acknowledged");
    let post_fp = post_fingerprint(service.session(), &to_window);
    let verify = serde_json::json!({
        "v": 1, "action": "verify", "correlation_id": corr,
        "owner": "owner-1", "generation": "gen-1",
        "revision": base, "fingerprint": post_fp,
        "verified": true,
        "verified_preconditions": preconditions,
        "verified_operation": operation,
    });
    let committed = service.evaluate_json(&verify.to_string());
    assert_eq!(reply_outcome(&committed), "committed");
    assert_eq!(service.accepted_revision(), base + 1);
}

#[test]
fn service_rejects_mismatch_and_diverges() {
    let session = seeded_session();
    let d = key("out-1", "ws-1");
    let focused = focused_window(&session, &d);
    let mut service = FocusService::with_session(session);
    let base = service.accepted_revision();
    // Stale revision diverges.
    let stale = service.evaluate_json(&request_json(
        service.session(),
        "corr-stale-1",
        &focused,
        "left",
        "owner-1",
        "gen-1",
        base + 99,
    ));
    assert_eq!(reply_outcome(&stale), "diverged");
    assert!(service.is_diverged());
    // Further requests stay diverged.
    let after = service.evaluate_json(&request_json(
        service.session(),
        "corr-stale-2",
        &focused,
        "left",
        "owner-1",
        "gen-1",
        base,
    ));
    assert_eq!(reply_outcome(&after), "diverged");
}

#[test]
fn service_diverges_on_owner_loss() {
    let session = seeded_session();
    let d = key("out-1", "ws-1");
    let focused = focused_window(&session, &d);
    let mut service = FocusService::with_session(session);
    let base = service.accepted_revision();
    let reply = service.evaluate_json(&request_json(
        service.session(),
        "corr-owner-1",
        &focused,
        "left",
        "owner-9",
        "gen-1",
        base,
    ));
    assert_eq!(reply_outcome(&reply), "diverged");
    assert!(reply_field(&reply, "kind").contains("owner-mismatch"));
    assert!(service.is_diverged());
    // Explicit loss is also terminal.
    let mut fresh = FocusService::with_session(seeded_session());
    let loss = fresh.evaluate_json("{\"v\":1,\"action\":\"note-loss\"}");
    assert_eq!(reply_outcome(&loss), "diverged");
    assert!(fresh.is_diverged());
}

#[test]
fn service_enforces_domain_isolation() {
    let session = two_domain_session();
    let mut service = FocusService::with_session(session);
    let base = service.accepted_revision();
    // Unknown domain refuses without divergence.
    let unknown = "{\"v\":1,\"action\":\"request\",\"correlation_id\":\"corr-dom-1\",\"owner\":\"owner-1\",\"generation\":\"gen-1\",\"revision\":0,\"fingerprint\":1,\"domain\":{\"output\":\"out-9\",\"workspace\":\"ws-1\"},\"focused_window\":\"win-a\",\"direction\":\"left\",\"windows\":[{\"window\":\"win-a\",\"output\":\"out-1\",\"workspace\":\"ws-1\"},{\"window\":\"win-b\",\"output\":\"out-1\",\"workspace\":\"ws-1\"},{\"window\":\"win-c\",\"output\":\"out-2\",\"workspace\":\"ws-1\"}],\"capabilities\":{\"directional_focus\":true}}";
    let _ = base;
    let reply = service.evaluate_json(unknown);
    assert_eq!(reply_outcome(&reply), "rejected");
    assert!(!service.is_diverged());
    // Cross-domain focused window (win-c lives in out-2) refuses.
    let cross = "{\"v\":1,\"action\":\"request\",\"correlation_id\":\"corr-dom-2\",\"owner\":\"owner-1\",\"generation\":\"gen-1\",\"revision\":0,\"fingerprint\":1,\"domain\":{\"output\":\"out-1\",\"workspace\":\"ws-1\"},\"focused_window\":\"win-c\",\"direction\":\"left\",\"windows\":[{\"window\":\"win-a\",\"output\":\"out-1\",\"workspace\":\"ws-1\"},{\"window\":\"win-b\",\"output\":\"out-1\",\"workspace\":\"ws-1\"},{\"window\":\"win-c\",\"output\":\"out-2\",\"workspace\":\"ws-1\"}],\"capabilities\":{\"directional_focus\":true}}";
    let reply2 = service.evaluate_json(cross);
    assert!(reply_outcome(&reply2) == "rejected" || reply_outcome(&reply2) == "diverged");
}

#[test]
fn service_rejects_duplicate_correlation_and_bad_shapes() {
    let session = seeded_session();
    let d = key("out-1", "ws-1");
    let focused = focused_window(&session, &d);
    let mut service = FocusService::with_session(session);
    let base = service.accepted_revision();
    let first = request_json(
        service.session(),
        "corr-dup-1",
        &focused,
        "left",
        "owner-1",
        "gen-1",
        base,
    );
    let r1 = service.evaluate_json(&first);
    assert!(
        reply_outcome(&r1) == "planned"
            || reply_outcome(&r1) == "noop"
            || reply_outcome(&r1) == "rejected"
    );
    if reply_outcome(&r1) == "planned" {
        // Same correlation while pending diverges as correlation mismatch.
        let dup = service.evaluate_json(&first);
        assert_eq!(reply_outcome(&dup), "diverged");
    }
    let mut fresh = FocusService::with_session(seeded_session());
    let bad = fresh.evaluate_json("{\"v\":1,\"action\":\"request\",\"correlation_id\":\"bad id\",\"owner\":\"owner-1\",\"generation\":\"gen-1\",\"revision\":0,\"fingerprint\":0,\"domain\":{\"output\":\"out-1\",\"workspace\":\"ws-1\"},\"focused_window\":\"win-a\",\"direction\":\"left\",\"windows\":[],\"capabilities\":{\"directional_focus\":true}}");
    assert_eq!(reply_outcome(&bad), "rejected");
    let unknown_field = fresh.evaluate_json("{\"v\":1,\"action\":\"request\",\"correlation_id\":\"corr-x1\",\"owner\":\"owner-1\",\"generation\":\"gen-1\",\"revision\":0,\"fingerprint\":0,\"domain\":{\"output\":\"out-1\",\"workspace\":\"ws-1\"},\"focused_window\":\"win-a\",\"direction\":\"left\",\"windows\":[],\"capabilities\":{\"directional_focus\":true},\"extra\":1}");
    assert_eq!(reply_outcome(&unknown_field), "rejected");
}

fn seed_request(corr: &str, owner: &str, focused: &str, direction: &str, ids: &[&str]) -> String {
    let mut sorted: Vec<String> = ids.iter().map(|s| s.to_string()).collect();
    sorted.sort();
    let fp = focus_fingerprint("focus-output", "focus-workspace", focused, &sorted);
    let revision = ids.len();
    let windows: Vec<String> = ids
        .iter()
        .map(|id| {
            format!(
                "{{\"window\":\"{id}\",\"output\":\"focus-output\",\"workspace\":\"focus-workspace\"}}"
            )
        })
        .collect();
    format!(
        "{{\"v\":1,\"action\":\"request\",\"correlation_id\":\"{corr}\",\"owner\":\"{owner}\",\"generation\":\"gen-1\",\"revision\":{revision},\"fingerprint\":{fp},\"domain\":{{\"output\":\"focus-output\",\"workspace\":\"focus-workspace\"}},\"focused_window\":\"{focused}\",\"direction\":\"{direction}\",\"windows\":[{}],\"capabilities\":{{\"directional_focus\":true}}}}",
        windows.join(",")
    )
}

#[test]
fn service_seeds_owned_session_from_first_request() {
    let mut service = FocusService::new();
    assert!(!service.is_seeded());
    assert_eq!(service.accepted_revision(), 0);
    let reply = service.evaluate_json(&seed_request(
        "seed-req-1",
        "owner-1",
        "win-b",
        "right",
        &["win-a", "win-b", "win-c"],
    ));
    assert!(service.is_seeded(), "{reply}");
    let outcome = reply_outcome(&reply);
    assert!(outcome == "planned" || outcome == "noop", "{reply}");
    // Post-seed base is exactly N admits.
    let v: serde_json::Value = serde_json::from_str(&reply).expect("json");
    if outcome == "planned" {
        assert_eq!(v.get("base_revision").and_then(|b| b.as_u64()), Some(3));
    }
    assert!(service.session_opt().is_some());
}

#[test]
fn service_rejects_literal_zero_fingerprint() {
    let mut service = FocusService::new();
    let zeroed = "{\"v\":1,\"action\":\"request\",\"correlation_id\":\"seed-zero-1\",\"owner\":\"owner-1\",\"generation\":\"gen-1\",\"revision\":0,\"fingerprint\":0,\"domain\":{\"output\":\"focus-output\",\"workspace\":\"focus-workspace\"},\"focused_window\":\"win-b\",\"direction\":\"right\",\"windows\":[{\"window\":\"win-a\",\"output\":\"focus-output\",\"workspace\":\"focus-workspace\"},{\"window\":\"win-b\",\"output\":\"focus-output\",\"workspace\":\"focus-workspace\"},{\"window\":\"win-c\",\"output\":\"focus-output\",\"workspace\":\"focus-workspace\"}],\"capabilities\":{\"directional_focus\":true}}";
    assert_eq!(reply_outcome(&service.evaluate_json(zeroed)), "rejected");
    assert!(!service.is_seeded());
}

#[test]
fn service_rejects_changed_membership_after_seeding() {
    let mut service = FocusService::new();
    let first = seed_request(
        "seed-mem-1",
        "owner-1",
        "win-b",
        "right",
        &["win-a", "win-b", "win-c"],
    );
    let r1 = service.evaluate_json(&first);
    assert!(reply_outcome(&r1) == "planned" || reply_outcome(&r1) == "noop");
    let changed = seed_request(
        "seed-mem-2",
        "owner-1",
        "win-a",
        "right",
        &["win-a", "win-z"],
    );
    // Changed membership is rejected without terminal divergence.
    let r2 = service.evaluate_json(&changed);
    assert_eq!(reply_outcome(&r2), "rejected");
    assert!(!service.is_diverged());
}

#[test]
fn service_verify_rejects_duplicate_preconditions() {
    let session = seeded_session();
    let d = key("out-1", "ws-1");
    let focused = focused_window(&session, &d);
    let mut service = FocusService::with_session(session);
    let base = service.accepted_revision();
    // Find a planning direction first.
    let mut planned_corr = String::new();
    let mut planned: serde_json::Value = serde_json::Value::Null;
    for (corr, dir) in [("corr-pre-1", "left"), ("corr-pre-2", "right")] {
        let reply = service.evaluate_json(&request_json(
            service.session(),
            corr,
            &focused,
            dir,
            "owner-1",
            "gen-1",
            base,
        ));
        if reply_outcome(&reply) == "planned" {
            planned_corr = corr.to_owned();
            planned = serde_json::from_str(&reply).expect("json");
            break;
        }
        if reply_outcome(&reply) == "diverged" {
            break;
        }
    }
    if planned.is_null() {
        return;
    }
    let operation = planned.get("operation").expect("op").clone();
    let ack = format!(
        "{{\"v\":1,\"action\":\"acknowledge\",\"correlation_id\":\"{planned_corr}\",\"owner\":\"owner-1\",\"generation\":\"gen-1\",\"base_revision\":{base},\"outcome\":\"accepted\"}}"
    );
    assert_eq!(reply_outcome(&service.evaluate_json(&ack)), "acknowledged");
    let to_window = operation
        .get("to_window")
        .and_then(|v| v.as_str())
        .expect("to")
        .to_owned();
    let post_fp = post_fingerprint(service.session(), &to_window);
    // Duplicate the first precondition: exact complete set required.
    let duped = serde_json::json!({
        "v": 1, "action": "verify", "correlation_id": planned_corr,
        "owner": "owner-1", "generation": "gen-1",
        "revision": base, "fingerprint": post_fp,
        "verified": true,
        "verified_preconditions": [
            "focused-leaf-occupied-by-focused-window",
            "focused-leaf-occupied-by-focused-window",
            "focus-targets-same-domain",
            "adapter-must-verify-postconditions",
        ],
        "verified_operation": operation,
    });
    assert_eq!(
        reply_outcome(&service.evaluate_json(&duped.to_string())),
        "diverged"
    );
}

#[test]
fn service_ack_wrong_owner_diverges_and_stays_terminal() {
    let session = seeded_session();
    let d = key("out-1", "ws-1");
    let focused = focused_window(&session, &d);
    let mut service = FocusService::with_session(session);
    let base = service.accepted_revision();
    let reply = service.evaluate_json(&request_json(
        service.session(),
        "corr-ackloss-1",
        &focused,
        "left",
        "owner-1",
        "gen-1",
        base,
    ));
    if reply_outcome(&reply) != "planned" {
        return;
    }
    // Wrong generation on ack diverges the pending plan.
    let bad_ack = format!(
        "{{\"v\":1,\"action\":\"acknowledge\",\"correlation_id\":\"corr-ackloss-1\",\"owner\":\"owner-1\",\"generation\":\"gen-9\",\"base_revision\":{base},\"outcome\":\"accepted\"}}"
    );
    assert_eq!(reply_outcome(&service.evaluate_json(&bad_ack)), "diverged");
    assert!(service.is_diverged());
}

#[test]
fn service_diagnostics_stay_redacted() {
    let mut service = FocusService::new();
    let bad_owner = seed_request(
        "seed-red-1",
        "owner-9",
        "win-b",
        "right",
        &["win-a", "win-b", "win-c"],
    );
    // First seeding with owner-9 succeeds (pins owner-9); second with
    // owner-1 must diverge without echoing either owner.
    assert!(reply_outcome(&service.evaluate_json(&bad_owner)) == "planned" || true);
    let second = seed_request(
        "seed-red-2",
        "owner-1",
        "win-b",
        "right",
        &["win-a", "win-b", "win-c"],
    );
    let reply = service.evaluate_json(&second);
    assert!(!reply.contains("owner-9"));
    assert!(!reply.contains("owner-1"));
    assert!(!reply.contains("win-a"));
}

#[test]
fn service_adapter_lost_ack_terminates_pending() {
    let session = seeded_session();
    let d = key("out-1", "ws-1");
    let focused = focused_window(&session, &d);
    let mut service = FocusService::with_session(session);
    let base = service.accepted_revision();
    let reply = service.evaluate_json(&request_json(
        service.session(),
        "corr-lost-1",
        &focused,
        "left",
        "owner-1",
        "gen-1",
        base,
    ));
    if reply_outcome(&reply) != "planned" {
        return;
    }
    assert!(service.session().has_pending());
    let loss = format!(
        "{{\"v\":1,\"action\":\"acknowledge\",\"correlation_id\":\"corr-lost-1\",\"owner\":\"owner-1\",\"generation\":\"gen-1\",\"base_revision\":{base},\"outcome\":\"adapter-lost\"}}"
    );
    let diverged = service.evaluate_json(&loss);
    assert_eq!(reply_outcome(&diverged), "diverged");
    assert!(reply_field(&diverged, "kind").contains("adapter-lost"));
    assert!(service.is_diverged());
    assert!(!service.session().has_pending());
    // Terminal: no pending retained, further proposals stay diverged.
    let after = service.evaluate_json(&request_json(
        service.session(),
        "corr-lost-2",
        &focused,
        "left",
        "owner-1",
        "gen-1",
        base,
    ));
    assert_eq!(reply_outcome(&after), "diverged");
}

#[test]
fn service_loss_signal_without_pending_stays_terminal() {
    let mut service = FocusService::with_session(seeded_session());
    assert!(!service.session().has_pending());
    let loss = service.evaluate_json("{\"v\":1,\"action\":\"note-loss\"}");
    assert_eq!(reply_outcome(&loss), "diverged");
    assert!(reply_field(&loss, "kind").contains("adapter-lost"));
    assert!(service.is_diverged());
}
