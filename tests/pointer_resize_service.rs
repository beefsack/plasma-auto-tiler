//! Bounded pointer-resize transaction service coverage (portable, headless).
//!
//! Drives `resize_service::ResizeService` `request-pointer` JSON over a real
//! `Session`: Rust-derived boundary/shares, clamp/refusal, determinism,
//! capability/pending/stale failures, and exact acknowledge/verify commit
//! versus divergence through the shared resize boundary. Keyboard `request`
//! wire behavior is unchanged (covered by `tests/resize_service.rs`).

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
        observation: plasma_auto_tiler::contract::Observation::new(
            owner(),
            generation(),
            session.accepted_revision(),
            100,
        ),
        windows,
    }
}
fn admit_commit(session: &mut Session, window: &str, corr: &str) {
    use plasma_auto_tiler::contract::{AckOutcome, AdapterAck, Observation};
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
    assert_eq!(d.expect("domain"), key());
    let l = l.expect("leaf");
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
#[allow(clippy::too_many_arguments)]
fn pointer_request(
    correlation: &str,
    revision: u64,
    fingerprint: u64,
    focused: &str,
    direction: &str,
    boundary: i32,
    windows: &[&str],
    pointer_resize: bool,
) -> String {
    let members: Vec<serde_json::Value> = windows
        .iter()
        .enumerate()
        .map(|(index, name)| {
            let n = windows.len().max(1) as i32;
            let strip = 800 / n;
            let x = strip * index as i32;
            let ww = if index + 1 == windows.len() {
                800 - x
            } else {
                strip
            };
            serde_json::json!({
                "window": name, "output": "out-1", "workspace": "ws-1",
                "rect": {"x": x, "y": 0, "w": ww, "h": 600},
            })
        })
        .collect();
    serde_json::json!({
        "v": 1, "action": "request-pointer", "correlation_id": correlation,
        "owner": "owner-1", "generation": "gen-1",
        "revision": revision, "fingerprint": fingerprint,
        "domain": {"output": "out-1", "workspace": "ws-1",
            "bounds": {"x": 0, "y": 0, "w": 800, "h": 600}, "gap": 0},
        "focused_window": focused, "direction": direction,
        "proposed_boundary": boundary,
        "windows": members,
        "capabilities": {"keyboard_resize": false, "pointer_resize": pointer_resize},
    })
    .to_string()
}
fn reply(text: &str) -> serde_json::Value {
    serde_json::from_str(text).expect("reply json")
}

#[test]
fn pointer_happy_path_plans_acks_and_commits() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    let planned = reply(&service.evaluate_json(&pointer_request(
        "ptr-1",
        revision,
        fingerprint,
        &focused,
        "left",
        390,
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(planned["outcome"], "planned", "{planned}");
    assert_eq!(planned["capability"], "pointer-resize");
    assert_eq!(planned["operation"]["kind"], "ResizeSplitShare");
    // Rust derived shares; callers never supply them. 390 is exactly
    // projectable as [389,409]; geometry places the boundary exactly at 390.
    assert_eq!(
        planned["operation"]["old_shares"],
        serde_json::json!([1, 1])
    );
    assert_eq!(
        planned["operation"]["new_shares"],
        serde_json::json!([389, 409])
    );
    let geometry = planned["desired_geometry"].as_array().expect("geometry");
    assert_eq!(geometry.len(), 2);
    let mut left_end: Option<i64> = None;
    for entry in geometry {
        let x = entry["rect"]["x"].as_i64().expect("x");
        let w = entry["rect"]["w"].as_i64().expect("w");
        let end = x + w;
        if left_end.is_none_or(|m| end < m) {
            left_end = Some(end);
        }
    }
    assert_eq!(left_end, Some(390));
    let operation = planned["operation"].clone();
    let geometry = planned["desired_geometry"].clone();
    let focus = planned["desired_focus"].clone();
    let base = planned["base_revision"].as_u64().expect("base");
    let ack = reply(
        &service.evaluate_json(
            &serde_json::json!({
                "v": 1, "action": "acknowledge", "correlation_id": "ptr-1",
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
                "v": 1, "action": "verify", "correlation_id": "ptr-1",
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
    assert!(!service.is_diverged());
}

#[test]
fn pointer_clamp_plans_and_outside_domain_is_rejected() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    // Far-left boundary clamps to the COSMIC child minimum (360) with
    // exact shares [359,439]; geometry places the boundary exactly at 360.
    // Exact 390 still plans.
    let clamped = reply(&service.evaluate_json(&pointer_request(
        "ptr-clamp",
        revision,
        fingerprint,
        &focused,
        "left",
        0,
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(clamped["outcome"], "planned", "{clamped}");
    assert_eq!(
        clamped["operation"]["new_shares"],
        serde_json::json!([359, 439])
    );
    let geometry = clamped["desired_geometry"].as_array().expect("geometry");
    let mut left_end: Option<i64> = None;
    for entry in geometry {
        let x = entry["rect"]["x"].as_i64().expect("x");
        let w = entry["rect"]["w"].as_i64().expect("w");
        let end = x + w;
        if left_end.is_none_or(|m| end < m) {
            left_end = Some(end);
        }
    }
    assert_eq!(left_end, Some(360));
    let (mut service_exact, focused_e, revision_e, fingerprint_e) = two_window_service();
    let exact = reply(&service_exact.evaluate_json(&pointer_request(
        "ptr-clamp-exact",
        revision_e,
        fingerprint_e,
        &focused_e,
        "left",
        390,
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(exact["outcome"], "planned", "{exact}");
    assert_eq!(
        exact["operation"]["new_shares"],
        serde_json::json!([389, 409])
    );

    // Outside the carried work area is rejected without divergence.
    let (mut service2, focused2, revision2, fingerprint2) = two_window_service();
    let out = reply(&service2.evaluate_json(&pointer_request(
        "ptr-out",
        revision2,
        fingerprint2,
        &focused2,
        "left",
        900,
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(out["outcome"], "rejected");
    assert!(!service2.is_diverged());
}

#[test]
fn pointer_minimum_and_single_leaf_are_noop() {
    // Single leaf: no boundary.
    let mut session = Session::new(owner(), generation(), 0, 7, vec![domain()]).expect("session");
    admit_commit(&mut session, "solo", "c-1");
    let revision = session.accepted_revision();
    let fp = resize_fingerprint("out-1", "ws-1", "solo", &["solo".to_owned()]);
    let mut service = ResizeService::with_session(session);
    let out = reply(&service.evaluate_json(&pointer_request(
        "ptr-solo",
        revision,
        fp,
        "solo",
        "left",
        50,
        &["solo"],
        true,
    )));
    assert_eq!(out["outcome"], "noop");
    assert_eq!(out["kind"], "unchanged");
}

#[test]
fn pointer_determinism_same_boundary_same_plan() {
    let (mut a, focused, revision, fingerprint) = two_window_service();
    let (mut b, _, _, _) = two_window_service();
    let pa = reply(&a.evaluate_json(&pointer_request(
        "ptr-a",
        revision,
        fingerprint,
        &focused,
        "left",
        390,
        &["win-a", "win-b"],
        true,
    )));
    let pb = reply(&b.evaluate_json(&pointer_request(
        "ptr-b",
        revision,
        fingerprint,
        &focused,
        "left",
        390,
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(pa["outcome"], "planned");
    assert_eq!(pa["operation"], pb["operation"]);
    assert_eq!(pa["desired_geometry"], pb["desired_geometry"]);
}

#[test]
fn pointer_capability_pending_stale_failures() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    let out = reply(&service.evaluate_json(&pointer_request(
        "ptr-cap",
        revision,
        fingerprint,
        &focused,
        "left",
        391,
        &["win-a", "win-b"],
        false,
    )));
    assert_eq!(out["outcome"], "rejected");
    assert_eq!(out["kind"], "unsupported-capability");

    let (mut service2, focused2, revision2, fp2) = two_window_service();
    let stale = reply(&service2.evaluate_json(&pointer_request(
        "ptr-stale",
        revision2 + 5,
        fp2,
        &focused2,
        "left",
        391,
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(stale["outcome"], "diverged");
    assert!(service2.is_diverged());

    let (mut service3, focused3, revision3, fingerprint3) = two_window_service();
    let first = reply(&service3.evaluate_json(&pointer_request(
        "ptr-one",
        revision3,
        fingerprint3,
        &focused3,
        "left",
        391,
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(first["outcome"], "planned");
    let second = reply(&service3.evaluate_json(&pointer_request(
        "ptr-two",
        revision3,
        fingerprint3,
        &focused3,
        "left",
        391,
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(second["outcome"], "diverged");
    assert_eq!(second["kind"], "pending-exists");
}

#[test]
fn pointer_tampered_verify_diverges_and_keyboard_wire_unchanged() {
    let (mut service, focused, revision, fingerprint) = two_window_service();
    let planned = reply(&service.evaluate_json(&pointer_request(
        "ptr-t",
        revision,
        fingerprint,
        &focused,
        "left",
        391,
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(planned["outcome"], "planned");
    let base = planned["base_revision"].as_u64().expect("base");
    let ack = reply(
        &service.evaluate_json(
            &serde_json::json!({
                "v": 1, "action": "acknowledge", "correlation_id": "ptr-t",
                "owner": "owner-1", "generation": "gen-1",
                "base_revision": base, "outcome": "accepted",
            })
            .to_string(),
        ),
    );
    assert_eq!(ack["outcome"], "acknowledged");
    let mut geometry = planned["desired_geometry"].clone();
    geometry[0]["rect"]["w"] = serde_json::json!(1);
    let out = reply(
        &service.evaluate_json(
            &serde_json::json!({
                "v": 1, "action": "verify", "correlation_id": "ptr-t",
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

    // Keyboard `request` without the pointer field is still strict: an
    // unknown `proposed_boundary` field on the keyboard action is rejected,
    // proving keyboard wire behavior is unchanged.
    let (mut ks, kfocused, krev, kfp) = two_window_service();
    let mut raw: serde_json::Value = serde_json::from_str(
        &serde_json::json!({
            "v": 1, "action": "request", "correlation_id": "kbd-1",
            "owner": "owner-1", "generation": "gen-1",
            "revision": krev, "fingerprint": kfp,
            "domain": {"output": "out-1", "workspace": "ws-1",
                "bounds": {"x": 0, "y": 0, "w": 800, "h": 600}, "gap": 0},
            "focused_window": kfocused, "direction": "left",
            "windows": [
                {"window": "win-a", "output": "out-1", "workspace": "ws-1",
                 "rect": {"x": 0, "y": 0, "w": 400, "h": 600}},
                {"window": "win-b", "output": "out-1", "workspace": "ws-1",
                 "rect": {"x": 400, "y": 0, "w": 400, "h": 600}},
            ],
            "capabilities": {"keyboard_resize": true, "pointer_resize": false},
        })
        .to_string(),
    )
    .expect("json");
    raw["proposed_boundary"] = serde_json::json!(80);
    let kout = reply(&ks.evaluate_json(&raw.to_string()));
    assert_eq!(kout["outcome"], "rejected");
    assert_eq!(kout["kind"], "unknown-field");
}

#[test]
fn pointer_ordinary_boundary_plans_and_binds_post() {
    // 800px domain, [1,1] split at 400. Proposal 390 plans exactly with
    // [389,409], and the complete projected geometry places the boundary at
    // 390, so a post-observation where the native-owned source shows 390 binds
    // and commits (the service never writes the source itself).
    let (mut exact, efocused, erevision, efingerprint) = two_window_service();
    let planned = reply(&exact.evaluate_json(&pointer_request(
        "ptr-exact",
        erevision,
        efingerprint,
        &efocused,
        "left",
        390,
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(planned["outcome"], "planned", "{planned}");
    assert_eq!(
        planned["operation"]["new_shares"],
        serde_json::json!([389, 409])
    );
    // Complete projected geometry boundary is exactly 80: left leaf ends at
    // 80. Determine the left leaf rect (smaller x of the pair).
    let geometry = planned["desired_geometry"].as_array().expect("geometry");
    assert_eq!(geometry.len(), 2);
    let mut left_end: Option<i64> = None;
    for entry in geometry {
        let rect = &entry["rect"];
        let x = rect["x"].as_i64().expect("x");
        let w = rect["w"].as_i64().expect("w");
        let end = x + w;
        // The pair spans 0..200; the left end is the smaller end.
        if left_end.is_none_or(|m| end < m) {
            left_end = Some(end);
        }
    }
    // Both leaves span 0..800, so ends are {390, 800}; minimum is 390.
    assert_eq!(left_end, Some(390));
    // Acknowledge and verify with the exact geometry commits: the source
    // rect in the verify payload is the native-owned proposal (80 split),
    // never written by Rust.
    let base = planned["base_revision"].as_u64().expect("base");
    let ack = reply(
        &exact.evaluate_json(
            &serde_json::json!({
                "v": 1, "action": "acknowledge", "correlation_id": "ptr-exact",
                "owner": "owner-1", "generation": "gen-1",
                "base_revision": base, "outcome": "accepted",
            })
            .to_string(),
        ),
    );
    assert_eq!(ack["outcome"], "acknowledged");
    let verify = reply(
        &exact.evaluate_json(
            &serde_json::json!({
                "v": 1, "action": "verify", "correlation_id": "ptr-exact",
                "owner": "owner-1", "generation": "gen-1",
                "revision": base, "fingerprint": efingerprint, "verified": true,
                "verified_preconditions": [
                    "focused-leaf-occupied-by-focused-window",
                    "target-boundary-valid",
                    "resize-targets-same-domain",
                    "adapter-must-verify-postconditions",
                ],
                "verified_operation": planned["operation"],
                "verified_geometry": planned["desired_geometry"],
                "verified_focus": planned["desired_focus"],
            })
            .to_string(),
        ),
    );
    assert_eq!(verify["outcome"], "committed");
    assert_eq!(verify["revision"], base + 1);
}

#[test]
fn dbus_routes_are_action_fenced_without_cross_mutation() {
    // `DescribeResize` (keyboard route) accepts `request` plus shared
    // ack/verify/loss only; `DescribePointerResize` (pointer route) accepts
    // `request-pointer` plus only the same-cycle shared actions. Cross-route
    // requests are rejected without mutation, and shared actions against a
    // foreign-owned pending are rejected without mutating the session or
    // clearing the foreign pending. Sequential pointer ack/verify through
    // the same route still commits.
    let (mut service, focused, revision, fingerprint) = two_window_service();
    // Pointer request through the keyboard route is rejected without seeding
    // mutation (service still unseeded-equivalent for keyboard? seeded via
    // shared session, but no pending is created).
    let cross_ptr = reply(&service.evaluate_keyboard_json(&pointer_request(
        "ptr-cross",
        revision,
        fingerprint,
        &focused,
        "left",
        391,
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(cross_ptr["outcome"], "rejected");
    assert_eq!(cross_ptr["kind"], "unknown-value");

    // Keyboard request through the pointer route is rejected without mutation.
    let keyboard_request = serde_json::json!({
        "v": 1, "action": "request", "correlation_id": "kbd-cross",
        "owner": "owner-1", "generation": "gen-1",
        "revision": revision, "fingerprint": fingerprint,
        "domain": {"output": "out-1", "workspace": "ws-1",
            "bounds": {"x": 0, "y": 0, "w": 800, "h": 600}, "gap": 0},
        "focused_window": focused, "direction": "left",
        "windows": [
            {"window": "win-a", "output": "out-1", "workspace": "ws-1",
             "rect": {"x": 0, "y": 0, "w": 400, "h": 600}},
            {"window": "win-b", "output": "out-1", "workspace": "ws-1",
             "rect": {"x": 400, "y": 0, "w": 400, "h": 600}},
        ],
        "capabilities": {"keyboard_resize": true, "pointer_resize": false},
    })
    .to_string();
    let cross_kbd = reply(&service.evaluate_pointer_json(&keyboard_request));
    assert_eq!(cross_kbd["outcome"], "rejected");
    assert_eq!(cross_kbd["kind"], "unknown-value");

    // Plan a pointer cycle through the pointer route.
    let planned = reply(&service.evaluate_pointer_json(&pointer_request(
        "ptr-fence",
        revision,
        fingerprint,
        &focused,
        "left",
        391,
        &["win-a", "win-b"],
        true,
    )));
    assert_eq!(planned["outcome"], "planned", "{planned}");
    let base = planned["base_revision"].as_u64().expect("base");

    // Keyboard-route acknowledge against pointer-owned pending is rejected
    // without mutation: the pointer cycle must survive intact.
    let foreign_ack = reply(
        &service.evaluate_keyboard_json(
            &serde_json::json!({
                "v": 1, "action": "acknowledge", "correlation_id": "ptr-fence",
                "owner": "owner-1", "generation": "gen-1",
                "base_revision": base, "outcome": "accepted",
            })
            .to_string(),
        ),
    );
    assert_eq!(foreign_ack["outcome"], "rejected");
    assert_eq!(foreign_ack["kind"], "no-pending");

    // Keyboard-route verify against pointer-owned pending is likewise
    // rejected without divergence.
    let foreign_verify = reply(
        &service.evaluate_keyboard_json(
            &serde_json::json!({
                "v": 1, "action": "verify", "correlation_id": "ptr-fence",
                "owner": "owner-1", "generation": "gen-1",
                "revision": base, "fingerprint": fingerprint, "verified": true,
                "verified_preconditions": [
                    "focused-leaf-occupied-by-focused-window",
                    "target-boundary-valid",
                    "resize-targets-same-domain",
                    "adapter-must-verify-postconditions",
                ],
                "verified_operation": planned["operation"],
                "verified_geometry": planned["desired_geometry"],
                "verified_focus": planned["desired_focus"],
            })
            .to_string(),
        ),
    );
    assert_eq!(foreign_verify["outcome"], "rejected");
    assert!(!service.is_diverged());

    // Same-route sequential ack/verify still commits.
    let ack = reply(
        &service.evaluate_pointer_json(
            &serde_json::json!({
                "v": 1, "action": "acknowledge", "correlation_id": "ptr-fence",
                "owner": "owner-1", "generation": "gen-1",
                "base_revision": base, "outcome": "accepted",
            })
            .to_string(),
        ),
    );
    assert_eq!(ack["outcome"], "acknowledged");
    let verify = reply(
        &service.evaluate_pointer_json(
            &serde_json::json!({
                "v": 1, "action": "verify", "correlation_id": "ptr-fence",
                "owner": "owner-1", "generation": "gen-1",
                "revision": base, "fingerprint": fingerprint, "verified": true,
                "verified_preconditions": [
                    "focused-leaf-occupied-by-focused-window",
                    "target-boundary-valid",
                    "resize-targets-same-domain",
                    "adapter-must-verify-postconditions",
                ],
                "verified_operation": planned["operation"],
                "verified_geometry": planned["desired_geometry"],
                "verified_focus": planned["desired_focus"],
            })
            .to_string(),
        ),
    );
    assert_eq!(verify["outcome"], "committed");

    // Reverse direction: keyboard-owned pending is invisible to the pointer
    // route. Use a fresh service so the keyboard plan is active.
    let (mut service2, focused2, revision2, fingerprint2) = two_window_service();
    let kplanned = reply(&service2.evaluate_keyboard_json(&keyboard_request_for(
        "kbd-fence",
        revision2,
        fingerprint2,
        &focused2,
    )));
    assert_eq!(kplanned["outcome"], "planned", "{kplanned}");
    let kbase = kplanned["base_revision"].as_u64().expect("base");
    let p_ack = reply(
        &service2.evaluate_pointer_json(
            &serde_json::json!({
                "v": 1, "action": "acknowledge", "correlation_id": "kbd-fence",
                "owner": "owner-1", "generation": "gen-1",
                "base_revision": kbase, "outcome": "accepted",
            })
            .to_string(),
        ),
    );
    assert_eq!(p_ack["outcome"], "rejected");
    assert!(!service2.is_diverged());
    // Keyboard-route ack still works.
    let kack = reply(
        &service2.evaluate_keyboard_json(
            &serde_json::json!({
                "v": 1, "action": "acknowledge", "correlation_id": "kbd-fence",
                "owner": "owner-1", "generation": "gen-1",
                "base_revision": kbase, "outcome": "accepted",
            })
            .to_string(),
        ),
    );
    assert_eq!(kack["outcome"], "acknowledged");
}

fn keyboard_request_for(
    correlation: &str,
    revision: u64,
    fingerprint: u64,
    focused: &str,
) -> String {
    serde_json::json!({
        "v": 1, "action": "request", "correlation_id": correlation,
        "owner": "owner-1", "generation": "gen-1",
        "revision": revision, "fingerprint": fingerprint,
        "domain": {"output": "out-1", "workspace": "ws-1",
            "bounds": {"x": 0, "y": 0, "w": 800, "h": 600}, "gap": 0},
        "focused_window": focused, "direction": "left", "mode": "outwards",
        "press_index": 0,
        "windows": [
            {"window": "win-a", "output": "out-1", "workspace": "ws-1",
             "rect": {"x": 0, "y": 0, "w": 400, "h": 600}},
            {"window": "win-b", "output": "out-1", "workspace": "ws-1",
             "rect": {"x": 400, "y": 0, "w": 400, "h": 600}},
        ],
        "capabilities": {"keyboard_resize": true, "pointer_resize": false},
    })
    .to_string()
}

#[test]
fn planner_uses_one_bounded_plan_method() {
    use plasma_auto_tiler::planner_service::{PLAN_MAX_REPLY, PLAN_METHOD};
    assert_eq!(PLAN_METHOD, "DescribePlan");
    assert_eq!(PLAN_MAX_REPLY, 64 * 1024);
    let message = zbus::message::Message::method_call("/org/plasmaautotiler/Planner", PLAN_METHOD)
        .unwrap()
        .destination("org.plasmaautotiler.Planner")
        .unwrap()
        .interface("org.plasmaautotiler.Planner1")
        .unwrap()
        .build(&("{\"v\":1}".to_owned(),))
        .unwrap();
    assert_eq!(message.body().signature().to_string(), "s");
}
