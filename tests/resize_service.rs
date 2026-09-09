//! Bounded keyboard resize transaction service coverage (portable, headless).
//!
//! Drives the product `resize_service::ResizeService` JSON protocol over a
//! real `session::Session`: split-share planning through
//! `Session::propose_resize`, refusals, acknowledge + verify commit with
//! complete exact geometry/focus, mismatch / divergence, adapter loss, and
//! domain isolation. No live compositor state.

use plasma_auto_tiler::contract::{AckOutcome, AdapterAck, Observation};
use plasma_auto_tiler::directional::{OutputId, WindowId, WorkspaceId};
use plasma_auto_tiler::geometry::Rect;
use plasma_auto_tiler::ids::{CorrelationId, GenerationId, OwnerId};
use plasma_auto_tiler::resize_service::{ResizeService, resize_fingerprint};
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
fn domain() -> OutputDomain {
    OutputDomain {
        id: OutputId("out-1".to_owned()),
        workspace: WorkspaceId("ws-1".to_owned()),
        bounds: Rect {
            x: 0,
            y: 0,
            w: 800,
            h: 600,
        },
        gap: 0,
        adjacent: BTreeMap::new(),
    }
}
fn key() -> DomainKey {
    DomainKey {
        output: OutputId("out-1".to_owned()),
        workspace: WorkspaceId("ws-1".to_owned()),
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
        observation: Observation::new(owner(), generation(), session.accepted_revision(), 100),
        windows,
    }
}
fn admit_commit(session: &mut Session, window: &str, corr: &str) {
    let cmd = SessionCommand::Admit {
        window: WindowId(window.to_owned()),
        output: OutputId("out-1".to_owned()),
        workspace: WorkspaceId("ws-1".to_owned()),
        exceptions: ExceptionFlags::none(),
        exception_behavior: None,
        // Wide target selects a horizontal split under the COSMIC admission rule.
        placement_bounds: Rect {
            x: 0,
            y: 0,
            w: 120,
            h: 80,
        },
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
fn focused_window(session: &Session) -> String {
    let (d, l) = session.focus();
    let d = d.expect("domain");
    let l = l.expect("leaf");
    assert_eq!(d, key());
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
fn two_window_service() -> (ResizeService, String, u64, u64) {
    let mut session = Session::new(owner(), generation(), 0, 7, vec![domain()]).expect("session");
    admit_commit(&mut session, "win-a", "c-1");
    admit_commit(&mut session, "win-b", "c-2");
    let focused = focused_window(&session);
    let revision = session.accepted_revision();
    let mut ids: Vec<String> = session
        .snapshot()
        .windows
        .iter()
        .map(|l| l.window.0.clone())
        .collect();
    ids.sort();
    let fingerprint = resize_fingerprint("out-1", "ws-1", &focused, &ids);
    (
        ResizeService::with_session(session),
        focused,
        revision,
        fingerprint,
    )
}
fn request_json(
    correlation: &str,
    revision: u64,
    fingerprint: u64,
    focused: &str,
    direction: &str,
    windows: &[&str],
    keyboard_resize: bool,
) -> String {
    request_json_with_geometry(
        correlation,
        revision,
        fingerprint,
        focused,
        direction,
        windows,
        keyboard_resize,
        0,
        0,
        800,
        600,
        0,
    )
}
#[allow(clippy::too_many_arguments)]
fn request_json_with_geometry(
    correlation: &str,
    revision: u64,
    fingerprint: u64,
    focused: &str,
    direction: &str,
    windows: &[&str],
    keyboard_resize: bool,
    bx: i32,
    by: i32,
    bw: i32,
    bh: i32,
    gap: i32,
) -> String {
    let members: Vec<serde_json::Value> = windows
        .iter()
        .enumerate()
        .map(|(index, name)| {
            // Deterministic contained per-window rects: vertical strips of the
            // carried work area so fixtures exercise the geometry boundary.
            let n = windows.len().max(1) as i32;
            let strip = bw / n;
            let x = bx + strip * index as i32;
            let ww = if index + 1 == windows.len() {
                bx + bw - x
            } else {
                strip
            };
            serde_json::json!({
                "window": name,
                "output": "out-1",
                "workspace": "ws-1",
                "rect": {"x": x, "y": by, "w": ww, "h": bh},
            })
        })
        .collect();
    serde_json::json!({
        "v": 1,
        "action": "request",
        "correlation_id": correlation,
        "owner": "owner-1",
        "generation": "gen-1",
        "revision": revision,
        "fingerprint": fingerprint,
        "domain": {"output": "out-1", "workspace": "ws-1",
            "bounds": {"x": bx, "y": by, "w": bw, "h": bh}, "gap": gap},
        "focused_window": focused,
        "direction": direction,
        "mode": "outwards",
        "press_index": 0,
        "windows": members,
        "capabilities": {"keyboard_resize": keyboard_resize},
    })
    .to_string()
}
fn reply(reply: &str) -> serde_json::Value {
    serde_json::from_str(reply).expect("reply json")
}

#[test]
fn happy_path_plans_acks_and_commits_with_complete_geometry_and_focus() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    let planned = reply(&service.evaluate_json(&request_json(
        "req-1",
        revision,
        fingerprint,
        &focused,
        "left",
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(planned["outcome"], "planned");
    assert_eq!(planned["capability"], "keyboard-resize");
    assert_eq!(
        planned["preconditions"],
        serde_json::json!([
            "focused-leaf-occupied-by-focused-window",
            "target-boundary-valid",
            "resize-targets-same-domain",
            "adapter-must-verify-postconditions",
        ])
    );
    let operation = planned["operation"].clone();
    assert_eq!(operation["kind"], "ResizeSplitShare");
    let geometry = planned["desired_geometry"].as_array().expect("geometry");
    assert_eq!(geometry.len(), 2);
    let focus = &planned["desired_focus"];
    assert_eq!(focus["domain_output"], "out-1");
    let base = planned["base_revision"].as_u64().expect("base");
    assert_eq!(base, revision);

    let ack = reply(
        &service.evaluate_json(
            &serde_json::json!({
                "v": 1, "action": "acknowledge", "correlation_id": "req-1",
                "owner": "owner-1", "generation": "gen-1",
                "base_revision": base, "outcome": "accepted",
            })
            .to_string(),
        ),
    );
    assert_eq!(ack["outcome"], "acknowledged");

    let verify = reply(
        &service.evaluate_json(
            &serde_json::json!({
                "v": 1, "action": "verify", "correlation_id": "req-1",
                "owner": "owner-1", "generation": "gen-1",
                "revision": base, "fingerprint": fingerprint, "verified": true,
                "verified_preconditions": [
                    "focused-leaf-occupied-by-focused-window",
                    "target-boundary-valid",
                    "resize-targets-same-domain",
                    "adapter-must-verify-postconditions",
                ],
                "verified_operation": operation,
                "verified_geometry": geometry,
                "verified_focus": focus,
            })
            .to_string(),
        ),
    );
    assert_eq!(verify["outcome"], "committed");
    assert_eq!(verify["revision"], base + 1);
    assert_eq!(service.accepted_revision(), base + 1);
    assert!(!service.is_diverged());
}

#[test]
fn missing_boundary_is_noop_without_pending() {
    let mut session = Session::new(owner(), generation(), 0, 7, vec![domain()]).expect("session");
    admit_commit(&mut session, "solo", "c-1");
    let revision = session.accepted_revision();
    let fingerprint = resize_fingerprint("out-1", "ws-1", "solo", &["solo".to_owned()]);
    let mut service = ResizeService::with_session(session);
    for direction in ["left", "right", "up", "down"] {
        let outcome = reply(&service.evaluate_json(&request_json(
            &format!("solo-{direction}"),
            revision,
            fingerprint,
            "solo",
            direction,
            &["solo"],
            true,
        )));
        assert_eq!(outcome["outcome"], "noop", "{direction}");
        assert_eq!(outcome["kind"], "unchanged");
    }
    assert!(!service.is_diverged());
}

#[test]
fn unknown_field_is_strictly_rejected() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    let mut raw: serde_json::Value = serde_json::from_str(&request_json(
        "req-x",
        revision,
        fingerprint,
        &focused,
        "left",
        &["win-a", "win-b"],
        true,
    ))
    .expect("json");
    raw["extra"] = serde_json::json!(1);
    let out = reply(&service.evaluate_json(&raw.to_string()));
    assert_eq!(out["outcome"], "rejected");
    assert_eq!(out["kind"], "unknown-field");
    assert!(!service.is_diverged());
}

#[test]
fn unknown_action_value_is_rejected() {
    let (mut service, _, _, _) = two_window_service();
    let out = reply(&service.evaluate_json(
        &serde_json::json!({"v": 1, "action": "resize", "correlation_id": "req-x"}).to_string(),
    ));
    assert_eq!(out["outcome"], "rejected");
    assert_eq!(out["kind"], "unknown-value");
}

#[test]
fn stale_revision_diverges_terminally() {
    let (mut service, focused, revision, _) = two_window_service();
    let mut ids = vec!["win-a".to_owned(), "win-b".to_owned()];
    ids.sort();
    let fp = resize_fingerprint("out-1", "ws-1", &focused, &ids);
    let out = reply(&service.evaluate_json(&request_json(
        "req-stale",
        revision + 5,
        fp,
        &focused,
        "left",
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(out["outcome"], "diverged");
    assert!(service.is_diverged());
}

#[test]
fn partial_observation_is_rejected_without_divergence() {
    let (mut service, focused, revision, _) = two_window_service();
    let fp = resize_fingerprint("out-1", "ws-1", &focused, &["win-a".to_owned()]);
    let out = reply(&service.evaluate_json(&request_json(
        "req-partial",
        revision,
        fp,
        "win-a",
        "left",
        &["win-a"],
        true,
    )));
    assert_eq!(out["outcome"], "rejected");
    assert_eq!(out["kind"], "snapshot-invalid");
    assert!(!service.is_diverged());
}

#[test]
fn extra_unknown_window_is_rejected() {
    let (mut service, focused, revision, _) = two_window_service();
    let fp = resize_fingerprint(
        "out-1",
        "ws-1",
        &focused,
        &["win-a".to_owned(), "win-b".to_owned(), "win-z".to_owned()],
    );
    let out = reply(&service.evaluate_json(&request_json(
        "req-extra",
        revision,
        fp,
        &focused,
        "left",
        &["win-a", "win-b", "win-z"],
        true,
    )));
    assert_eq!(out["outcome"], "rejected");
    assert!(!service.is_diverged());
}

#[test]
fn cross_domain_window_is_rejected() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    let mut raw: serde_json::Value = serde_json::from_str(&request_json(
        "req-xdom",
        revision,
        fingerprint,
        &focused,
        "left",
        &["win-a", "win-b"],
        true,
    ))
    .expect("json");
    raw["windows"] = serde_json::json!([
        {"window": "win-a", "output": "out-1", "workspace": "ws-1",
         "rect": {"x": 0, "y": 0, "w": 400, "h": 600}},
        {"window": "win-b", "output": "out-9", "workspace": "ws-1",
         "rect": {"x": 0, "y": 0, "w": 400, "h": 600}},
    ]);
    let out = reply(&service.evaluate_json(&raw.to_string()));
    assert_eq!(out["outcome"], "rejected");
    assert_eq!(out["kind"], "cross-domain-mismatch");
    assert!(!service.is_diverged());
}

#[test]
fn undeclared_capability_is_rejected() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    let out = reply(&service.evaluate_json(&request_json(
        "req-cap",
        revision,
        fingerprint,
        &focused,
        "left",
        &["win-a", "win-b"],
        false,
    )));
    assert_eq!(out["outcome"], "rejected");
    assert_eq!(out["kind"], "unsupported-capability");
    assert!(!service.is_diverged());
}

#[test]
fn unfocused_window_is_rejected_as_focus_mismatch() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    let other = if focused == "win-a" { "win-b" } else { "win-a" };
    let out = reply(&service.evaluate_json(&request_json(
        "req-focus",
        revision,
        fingerprint,
        other,
        "left",
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(out["outcome"], "rejected");
    assert!(!service.is_diverged());
}

#[test]
fn duplicate_correlation_diverges() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    let first = reply(&service.evaluate_json(&request_json(
        "req-dup",
        revision,
        fingerprint,
        &focused,
        "left",
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(first["outcome"], "planned");
    let second = reply(&service.evaluate_json(&request_json(
        "req-dup",
        revision,
        fingerprint,
        &focused,
        "left",
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(second["outcome"], "diverged");
    assert_eq!(second["kind"], "correlation-mismatch");
}

#[test]
fn second_request_while_pending_diverges() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    let first = reply(&service.evaluate_json(&request_json(
        "req-one",
        revision,
        fingerprint,
        &focused,
        "left",
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(first["outcome"], "planned");
    let second = reply(&service.evaluate_json(&request_json(
        "req-two",
        revision,
        fingerprint,
        &focused,
        "left",
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(second["outcome"], "diverged");
    assert_eq!(second["kind"], "pending-exists");
}

#[test]
fn refused_ack_outcome_diverges() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    let planned = reply(&service.evaluate_json(&request_json(
        "req-ack",
        revision,
        fingerprint,
        &focused,
        "left",
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(planned["outcome"], "planned");
    let base = planned["base_revision"].as_u64().expect("base");
    let out = reply(
        &service.evaluate_json(
            &serde_json::json!({
                "v": 1, "action": "acknowledge", "correlation_id": "req-ack",
                "owner": "owner-1", "generation": "gen-1",
                "base_revision": base, "outcome": "refused-capability",
            })
            .to_string(),
        ),
    );
    assert_eq!(out["outcome"], "diverged");
    assert!(service.is_diverged());
}

#[test]
fn tampered_verify_geometry_diverges_terminally() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    let planned = reply(&service.evaluate_json(&request_json(
        "req-tamper",
        revision,
        fingerprint,
        &focused,
        "left",
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(planned["outcome"], "planned");
    let base = planned["base_revision"].as_u64().expect("base");
    let ack = reply(
        &service.evaluate_json(
            &serde_json::json!({
                "v": 1, "action": "acknowledge", "correlation_id": "req-tamper",
                "owner": "owner-1", "generation": "gen-1",
                "base_revision": base, "outcome": "accepted",
            })
            .to_string(),
        ),
    );
    assert_eq!(ack["outcome"], "acknowledged");
    let mut geometry = planned["desired_geometry"].clone();
    let first = geometry[0].clone();
    let mut rect = first["rect"].clone();
    rect["w"] = serde_json::json!(rect["w"].as_i64().expect("w") + 7);
    geometry[0]["rect"] = rect;
    let out = reply(
        &service.evaluate_json(
            &serde_json::json!({
                "v": 1, "action": "verify", "correlation_id": "req-tamper",
                "owner": "owner-1", "generation": "gen-1",
                "revision": base, "fingerprint": fingerprint, "verified": true,
                "verified_preconditions": [
                    "focused-leaf-occupied-by-focused-window",
                    "target-boundary-valid",
                    "resize-targets-same-domain",
                    "adapter-must-verify-postconditions",
                ],
                "verified_operation": planned["operation"],
                "verified_geometry": geometry,
                "verified_focus": planned["desired_focus"],
            })
            .to_string(),
        ),
    );
    assert_eq!(out["outcome"], "diverged");
    assert!(service.is_diverged());
}

#[test]
fn subset_verify_preconditions_diverge() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    let planned = reply(&service.evaluate_json(&request_json(
        "req-pre",
        revision,
        fingerprint,
        &focused,
        "left",
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(planned["outcome"], "planned");
    let base = planned["base_revision"].as_u64().expect("base");
    let ack = reply(
        &service.evaluate_json(
            &serde_json::json!({
                "v": 1, "action": "acknowledge", "correlation_id": "req-pre",
                "owner": "owner-1", "generation": "gen-1",
                "base_revision": base, "outcome": "accepted",
            })
            .to_string(),
        ),
    );
    assert_eq!(ack["outcome"], "acknowledged");
    let out = reply(
        &service.evaluate_json(
            &serde_json::json!({
                "v": 1, "action": "verify", "correlation_id": "req-pre",
                "owner": "owner-1", "generation": "gen-1",
                "revision": base, "fingerprint": fingerprint, "verified": true,
                "verified_preconditions": ["focused-leaf-occupied-by-focused-window"],
                "verified_operation": planned["operation"],
                "verified_geometry": planned["desired_geometry"],
                "verified_focus": planned["desired_focus"],
            })
            .to_string(),
        ),
    );
    assert_eq!(out["outcome"], "diverged");
    assert!(service.is_diverged());
}

#[test]
fn adapter_loss_diverges_terminally() {
    let (mut service, _, _, _) = two_window_service();
    let out = reply(
        &service.evaluate_json(&serde_json::json!({"v": 1, "action": "note-loss"}).to_string()),
    );
    assert_eq!(out["outcome"], "diverged");
    assert_eq!(out["kind"], "adapter-lost");
    assert!(service.is_diverged());
}

#[test]
fn fingerprint_mismatch_is_rejected() {
    let (mut service, focused, revision, _) = two_window_service();
    let out = reply(&service.evaluate_json(&request_json(
        "req-fp",
        revision,
        12345,
        &focused,
        "left",
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(out["outcome"], "rejected");
    assert!(!service.is_diverged());
}

#[test]
fn invalid_direction_is_rejected() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    let out = reply(&service.evaluate_json(&request_json(
        "req-dir",
        revision,
        fingerprint,
        &focused,
        "diagonal",
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(out["outcome"], "rejected");
    assert_eq!(out["kind"], "direction-invalid");
}

#[test]
fn unseeded_service_seeds_from_first_strict_request() {
    let mut service = ResizeService::new();
    assert!(!service.is_seeded());
    let mut ids = vec!["win-a".to_owned(), "win-b".to_owned()];
    ids.sort();
    let fp = resize_fingerprint("out-1", "ws-1", "win-b", &ids);
    let out = reply(&service.evaluate_json(&request_json(
        "seed-1",
        2,
        fp,
        "win-b",
        "left",
        &["win-a", "win-b"],
        true,
    )));
    // Seed path must prove a valid plan, not merely any terminal outcome.
    assert_eq!(out["outcome"], "planned", "{out:?}");
    assert_eq!(out["capability"], "keyboard-resize");
    assert_eq!(out["operation"]["kind"], "ResizeSplitShare");
    let geometry = out["desired_geometry"].as_array().expect("geometry");
    assert_eq!(geometry.len(), 2);
    assert!(service.is_seeded());
    assert!(!service.is_diverged());
}

#[test]
fn unseeded_seed_with_non_default_work_area_projects_against_supplied_bounds() {
    // Non-default, non-zero work area: desired plan must project exactly
    // against the supplied bounds, never a hardcoded 1920x1080 area.
    let (bx, by, bw, bh) = (40, 30, 1280, 800);
    let mut service = ResizeService::new();
    let mut ids = vec!["win-a".to_owned(), "win-b".to_owned()];
    ids.sort();
    let fp = resize_fingerprint("out-1", "ws-1", "win-b", &ids);
    let out = reply(&service.evaluate_json(&request_json_with_geometry(
        "seed-area-1",
        2,
        fp,
        "win-b",
        "left",
        &["win-a", "win-b"],
        true,
        bx,
        by,
        bw,
        bh,
        0,
    )));
    assert_eq!(out["outcome"], "planned", "{out:?}");
    let geometry = out["desired_geometry"].as_array().expect("geometry");
    assert_eq!(geometry.len(), 2);
    for entry in geometry {
        let rect = &entry["rect"];
        let (x, y, w, h) = (
            rect["x"].as_i64().expect("x"),
            rect["y"].as_i64().expect("y"),
            rect["w"].as_i64().expect("w"),
            rect["h"].as_i64().expect("h"),
        );
        assert!(w > 0 && h > 0, "{entry:?}");
        assert!(x >= bx as i64 && y >= by as i64, "{entry:?}");
        assert!(x + w <= bx as i64 + bw as i64, "{entry:?}");
        assert!(y + h <= by as i64 + bh as i64, "{entry:?}");
    }
    // The union of the planned leaves exactly covers the supplied work area
    // width on the horizontal axis (single-domain split).
    let mut xs: Vec<(i64, i64)> = geometry
        .iter()
        .map(|e| {
            (
                e["rect"]["x"].as_i64().expect("x"),
                e["rect"]["w"].as_i64().expect("w"),
            )
        })
        .collect();
    xs.sort();
    assert_eq!(xs[0].0, bx as i64);
    let total: i64 = xs.iter().map(|(_, w)| w).sum();
    assert_eq!(total, bw as i64, "{xs:?}");
    assert!(service.is_seeded());
    assert!(!service.is_diverged());
}

#[test]
fn carried_work_area_drift_is_rejected() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    let out = reply(&service.evaluate_json(&request_json_with_geometry(
        "req-drift",
        revision,
        fingerprint,
        &focused,
        "left",
        &["win-a", "win-b"],
        true,
        10,
        10,
        640,
        480,
        0,
    )));
    assert_eq!(out["outcome"], "rejected");
    assert_eq!(out["kind"], "snapshot-invalid");
    assert!(!service.is_diverged());
}

#[test]
fn verify_without_local_pending_diverges_terminally() {
    let (mut service, _, revision, fingerprint) = two_window_service();
    let out = reply(
        &service.evaluate_json(
            &serde_json::json!({
                "v": 1, "action": "verify", "correlation_id": "req-lonely",
                "owner": "owner-1", "generation": "gen-1",
                "revision": revision, "fingerprint": fingerprint, "verified": true,
                "verified_preconditions": [
                    "focused-leaf-occupied-by-focused-window",
                    "target-boundary-valid",
                    "resize-targets-same-domain",
                    "adapter-must-verify-postconditions",
                ],
                "verified_operation": {
                    "kind": "ResizeSplitShare",
                    "domain_output": "out-1", "domain_workspace": "ws-1",
                    "focused_leaf": "leaf-a", "focused_window": "win-a",
                    "direction": "left", "target_group": "group-1",
                    "focused_child": "leaf-a", "neighbor_child": "leaf-b",
                    "focused_index": 0, "neighbor_index": 1,
                    "old_shares": [8, 8], "new_shares": [9, 7],
                },
                "verified_geometry": [
                    {"window": "win-a", "leaf": "leaf-a", "output": "out-1",
                     "workspace": "ws-1", "rect": {"x": 0, "y": 0, "w": 400, "h": 600}},
                    {"window": "win-b", "leaf": "leaf-b", "output": "out-1",
                     "workspace": "ws-1", "rect": {"x": 400, "y": 0, "w": 400, "h": 600}},
                ],
                "verified_focus": {
                    "domain_output": "out-1", "domain_workspace": "ws-1", "leaf": "leaf-a",
                },
            })
            .to_string(),
        ),
    );
    assert_eq!(out["outcome"], "diverged");
    assert_eq!(out["kind"], "postcondition-mismatch");
    assert!(service.is_diverged());
}

#[test]
fn service_starts_unseeded_without_pending() {
    let service = ResizeService::new();
    assert!(!service.is_seeded());
    assert!(!service.is_diverged());
    assert_eq!(service.accepted_revision(), 0);
}

#[test]
fn missing_mode_and_legacy_native_payload_reject_without_default() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    // Missing required mode/press_index rejects as malformed (no compat default).
    let mut raw: serde_json::Value = serde_json::from_str(&request_json(
        "req-missing",
        revision,
        fingerprint,
        &focused,
        "left",
        &["win-a", "win-b"],
        true,
    ))
    .expect("json");
    raw.as_object_mut().expect("obj").remove("mode");
    let out = reply(&service.evaluate_json(&raw.to_string()));
    assert_eq!(out["outcome"], "rejected");
    // Legacy native_min_size field is unknown (removed capability, no compat).
    let mut legacy: serde_json::Value = serde_json::from_str(&request_json(
        "req-legacy",
        revision,
        fingerprint,
        &focused,
        "left",
        &["win-a", "win-b"],
        true,
    ))
    .expect("json");
    legacy["capabilities"]["native_min_size"] = serde_json::json!(true);
    let lout = reply(&service.evaluate_json(&legacy.to_string()));
    assert_eq!(lout["outcome"], "rejected");
    assert_eq!(lout["kind"], "unknown-field");
    assert!(!service.is_diverged());
}
