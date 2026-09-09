//! Distinct keyboard/pointer resize capability split (portable, headless).
//!
//! Locks the independent advertisement of `keyboard-resize` and
//! `pointer-resize`: the keyboard route requires `KeyboardResize`, the
//! pointer route requires `PointerResize`, and either can be held without the
//! other across the contract, session/reconciler, and JSON service boundary
//! with strict unknown/invalid refusal preserved.

use plasma_auto_tiler::contract::{ResizeCapabilities, ResizeCapability, ResizeMode};
use plasma_auto_tiler::directional::{Direction, OutputId, WindowId, WorkspaceId};
use plasma_auto_tiler::geometry::Rect;
use plasma_auto_tiler::ids::{CorrelationId, GenerationId, OwnerId};
use plasma_auto_tiler::resize_service::{ResizeService, resize_fingerprint};
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

fn keyboard_only() -> ResizeCapabilities {
    ResizeCapabilities {
        keyboard_resize: true,
        pointer_resize: false,
    }
}

fn pointer_only() -> ResizeCapabilities {
    ResizeCapabilities {
        keyboard_resize: false,
        pointer_resize: true,
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
        placement_bounds: Rect {
            x: 0,
            y: 0,
            w: 120,
            h: 80,
        },
    };
    let mut obs = complete_obs(session);
    obs.windows.push(ObservedWindow {
        window: WindowId(window.to_owned()),
        output: OutputId("out-1".to_owned()),
        workspace: WorkspaceId("ws-1".to_owned()),
        floating: false,
        fullscreen: false,
        maximized: false,
        sticky: false,
    });
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

fn two_window_session() -> (Session, WindowId) {
    let mut session = Session::new(owner(), generation(), 0, 7, vec![domain()]).expect("session");
    admit_commit(&mut session, "win-a", "c-1");
    admit_commit(&mut session, "win-b", "c-2");
    let (d, l) = session.focus();
    assert_eq!(d.expect("domain"), key());
    let leaf = l.expect("leaf");
    let window = session
        .snapshot()
        .windows
        .iter()
        .find(|w| w.leaf == leaf)
        .expect("link")
        .window
        .clone();
    (session, window)
}

#[test]
fn contract_capabilities_advertise_independently() {
    assert_eq!(ResizeCapability::KeyboardResize.as_str(), "keyboard-resize");
    assert_eq!(ResizeCapability::PointerResize.as_str(), "pointer-resize");
    assert!(ResizeCapabilities::full().supports(ResizeCapability::KeyboardResize));
    assert!(ResizeCapabilities::full().supports(ResizeCapability::PointerResize));
    assert!(!ResizeCapabilities::none().supports(ResizeCapability::KeyboardResize));
    assert!(!ResizeCapabilities::none().supports(ResizeCapability::PointerResize));
    assert!(keyboard_only().supports(ResizeCapability::KeyboardResize));
    assert!(!keyboard_only().supports(ResizeCapability::PointerResize));
    assert!(!pointer_only().supports(ResizeCapability::KeyboardResize));
    assert!(pointer_only().supports(ResizeCapability::PointerResize));
}

#[test]
fn session_keyboard_route_requires_keyboard_resize_only() {
    let (mut session, window) = two_window_session();
    let k = key();
    let obs = complete_obs(&session);
    // Keyboard-only plans on the keyboard route.
    let plan = session
        .propose_resize(
            &k,
            &window,
            Direction::Left,
            ResizeMode::Outwards,
            0,
            &obs,
            &correlation("kbd-only-ok"),
            &keyboard_only(),
        )
        .expect("keyboard-only accepts keyboard route");
    assert_eq!(
        plan.dispatch.required_capability,
        ResizeCapability::KeyboardResize
    );
}

#[test]
fn session_pointer_route_requires_pointer_resize_only() {
    let (mut session, window) = two_window_session();
    let k = key();
    let obs = complete_obs(&session);
    // Pointer-only plans on the pointer route.
    let plan = session
        .propose_pointer_resize(
            &k,
            &window,
            Direction::Left,
            390,
            &obs,
            &correlation("ptr-only-ok"),
            &pointer_only(),
        )
        .expect("pointer-only accepts pointer route");
    assert_eq!(
        plan.dispatch.required_capability,
        ResizeCapability::PointerResize
    );
}

#[test]
fn session_cross_capability_refuses_without_pending() {
    // Keyboard-only refuses the pointer route.
    let (mut keyboard_session, keyboard_window) = two_window_session();
    let k = key();
    let obs = complete_obs(&keyboard_session);
    assert_eq!(
        keyboard_session.propose_pointer_resize(
            &k,
            &keyboard_window,
            Direction::Left,
            390,
            &obs,
            &correlation("x-ptr"),
            &keyboard_only(),
        ),
        Err(ProposeError::Refused(RefusalKind::UnsupportedCapability))
    );
    assert!(!keyboard_session.has_pending());
    // Pointer-only refuses the keyboard route.
    let (mut pointer_session, pointer_window) = two_window_session();
    let obs = complete_obs(&pointer_session);
    assert_eq!(
        pointer_session.propose_resize(
            &k,
            &pointer_window,
            Direction::Left,
            ResizeMode::Outwards,
            0,
            &obs,
            &correlation("x-kbd"),
            &pointer_only(),
        ),
        Err(ProposeError::Refused(RefusalKind::UnsupportedCapability))
    );
    assert!(!pointer_session.has_pending());
    // Neither accepts either route.
    let (mut none_session, none_window) = two_window_session();
    let obs = complete_obs(&none_session);
    assert_eq!(
        none_session.propose_resize(
            &k,
            &none_window,
            Direction::Left,
            ResizeMode::Outwards,
            0,
            &obs,
            &correlation("x-none-kbd"),
            &ResizeCapabilities::none(),
        ),
        Err(ProposeError::Refused(RefusalKind::UnsupportedCapability))
    );
    assert_eq!(
        none_session.propose_pointer_resize(
            &k,
            &none_window,
            Direction::Left,
            390,
            &obs,
            &correlation("x-none-ptr"),
            &ResizeCapabilities::none(),
        ),
        Err(ProposeError::Refused(RefusalKind::UnsupportedCapability))
    );
    assert!(!none_session.has_pending());
}

fn service_with_focus() -> (ResizeService, String, u64, u64) {
    let (session, window) = two_window_session();
    let revision = session.accepted_revision();
    let ids = vec!["win-a".to_owned(), "win-b".to_owned()];
    let fingerprint = resize_fingerprint("out-1", "ws-1", &window.0, &ids);
    (
        ResizeService::with_session(session),
        window.0,
        revision,
        fingerprint,
    )
}

fn keyboard_json(
    correlation: &str,
    revision: u64,
    fingerprint: u64,
    focused: &str,
    keyboard_resize: bool,
    pointer_resize: bool,
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
        "capabilities": {"keyboard_resize": keyboard_resize, "pointer_resize": pointer_resize},
    })
    .to_string()
}

fn pointer_json(
    correlation: &str,
    revision: u64,
    fingerprint: u64,
    focused: &str,
    keyboard_resize: bool,
    pointer_resize: bool,
) -> String {
    serde_json::json!({
        "v": 1, "action": "request-pointer", "correlation_id": correlation,
        "owner": "owner-1", "generation": "gen-1",
        "revision": revision, "fingerprint": fingerprint,
        "domain": {"output": "out-1", "workspace": "ws-1",
            "bounds": {"x": 0, "y": 0, "w": 800, "h": 600}, "gap": 0},
        "focused_window": focused, "direction": "left",
        "proposed_boundary": 390,
        "windows": [
            {"window": "win-a", "output": "out-1", "workspace": "ws-1",
             "rect": {"x": 0, "y": 0, "w": 400, "h": 600}},
            {"window": "win-b", "output": "out-1", "workspace": "ws-1",
             "rect": {"x": 400, "y": 0, "w": 400, "h": 600}},
        ],
        "capabilities": {"keyboard_resize": keyboard_resize, "pointer_resize": pointer_resize},
    })
    .to_string()
}

fn reply(text: &str) -> serde_json::Value {
    serde_json::from_str(text).expect("reply json")
}

#[test]
fn service_routes_require_their_own_capability() {
    // Keyboard route: keyboard-only plans with `keyboard-resize`.
    let (mut service, focused, revision, fingerprint) = service_with_focus();
    let planned = reply(&service.evaluate_json(&keyboard_json(
        "split-kbd",
        revision,
        fingerprint,
        &focused,
        true,
        false,
    )));
    assert_eq!(planned["outcome"], "planned", "{planned}");
    assert_eq!(planned["capability"], "keyboard-resize");
}

#[test]
fn service_pointer_route_plans_with_pointer_only_capability() {
    let (mut service, focused, revision, fingerprint) = service_with_focus();
    let planned = reply(&service.evaluate_json(&pointer_json(
        "split-ptr",
        revision,
        fingerprint,
        &focused,
        false,
        true,
    )));
    assert_eq!(planned["outcome"], "planned", "{planned}");
    assert_eq!(planned["capability"], "pointer-resize");
}

#[test]
fn service_cross_capability_is_rejected_without_divergence() {
    // Pointer-only on the keyboard route refuses as unsupported.
    let (mut service, focused, revision, fingerprint) = service_with_focus();
    let out = reply(&service.evaluate_json(&keyboard_json(
        "split-x",
        revision,
        fingerprint,
        &focused,
        false,
        true,
    )));
    assert_eq!(out["outcome"], "rejected");
    assert_eq!(out["kind"], "unsupported-capability");
    assert!(!service.is_diverged());
    // Keyboard-only on the pointer route refuses as unsupported.
    let (mut service, focused, revision, fingerprint) = service_with_focus();
    let out = reply(&service.evaluate_json(&pointer_json(
        "split-x",
        revision,
        fingerprint,
        &focused,
        true,
        false,
    )));
    assert_eq!(out["outcome"], "rejected");
    assert_eq!(out["kind"], "unsupported-capability");
    assert!(!service.is_diverged());
}

#[test]
fn service_schema_stays_strict_for_capabilities() {
    let (mut service, focused, revision, fingerprint) = service_with_focus();
    // Missing `pointer_resize` is malformed, never defaulted.
    let mut raw: serde_json::Value = serde_json::from_str(&keyboard_json(
        "split-missing",
        revision,
        fingerprint,
        &focused,
        true,
        true,
    ))
    .expect("json");
    raw["capabilities"]
        .as_object_mut()
        .expect("caps")
        .remove("pointer_resize");
    let out = reply(&service.evaluate_json(&raw.to_string()));
    assert_eq!(out["outcome"], "rejected");
    assert_eq!(out["kind"], "request-malformed");
    assert!(!service.is_diverged());
    // Unknown capability fields are refused.
    let (mut service, focused, revision, fingerprint) = service_with_focus();
    let mut raw: serde_json::Value = serde_json::from_str(&pointer_json(
        "split-unknown",
        revision,
        fingerprint,
        &focused,
        false,
        true,
    ))
    .expect("json");
    raw["capabilities"]["native_min_size"] = serde_json::json!(true);
    let out = reply(&service.evaluate_json(&raw.to_string()));
    assert_eq!(out["outcome"], "rejected");
    assert_eq!(out["kind"], "unknown-field");
    assert!(!service.is_diverged());
}
