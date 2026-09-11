//! Stateless bounded Planner protocol (Stage 4, product-shaped, static only).
//!
//! Pure JSON-string-in / JSON-string-out evaluation over an ephemeral
//! [`crate::session::Session`]. Rust owns all policy: the complete normalized
//! current observation (opaque adapter ids, frame rectangles, output,
//! workspace, focus) plus one parameterized command deterministically rebuilds
//! authoritative topology via the retained [`crate::session`] lifecycle
//! admit path ([`crate::cosmic_v1`] admission axis/shares, no invented tiling
//! semantics), then proposes exactly that command through the existing
//! session/reconciler/directional/cosmic_v1 APIs.
//!
//! Stateless recovery: no session, pending slot, divergence flag, or
//! seen-correlation set is retained between calls. Every rejection maps to a
//! bounded recoverable `rejected` outcome (never terminal `diverged`), so a
//! fresh observation can always recover after any rejection. Native execution
//! stays outside: replies carry full target geometries plus retained focus for
//! the adapter to actuate.

use serde::{Deserialize, Serialize};

use crate::contract::{FocusCapabilities, LifecycleCapabilities, Observation};
use crate::directional::{Capabilities, Direction, NodeId, OutputId, WindowId, WorkspaceId};
use crate::geometry::Rect;
use crate::ids::{CorrelationId, GenerationId, OwnerId};
use crate::session::{
    DomainKey, ExceptionFlags, ObservedWindow, OutputDomain, ProposeError, Session, SessionCommand,
    SessionObservation,
};

/// Planner protocol contract version (JSON string v1).
pub const PLAN_CONTRACT_VERSION: u32 = 1;
/// Bounded request cap (mirrors the portable service bound).
pub const PLAN_MAX_REQUEST_BYTES: usize = 64 * 1024;
/// Bounded reply cap (mirrors the portable service bound).
pub const PLAN_MAX_REPLY_BYTES: usize = 64 * 1024;
/// Opaque id bound.
pub const PLAN_MAX_ID_LEN: usize = 128;
/// Observed window bound.
pub const PLAN_MAX_WINDOWS: usize = 64;
/// Revision bound (inclusive, shared with contract).
pub const PLAN_MAX_REVISION: u64 = 1_000_000;

const MSG_OVERSIZED: &str = "request exceeds size bound";
const MSG_MALFORMED: &str = "request is malformed";
const MSG_UNKNOWN_FIELD: &str = "request contains an unknown field";
const MSG_UNKNOWN_VALUE: &str = "request contains an unknown value";
const MSG_VERSION: &str = "unsupported contract version";
const MSG_CORRELATION: &str = "correlation id is invalid";
const MSG_OWNER: &str = "owner is invalid";
const MSG_GENERATION: &str = "generation is invalid";
const MSG_REVISION: &str = "revision is invalid";
const MSG_OPAQUE_ID: &str = "opaque id is invalid";
const MSG_OBSERVATION: &str = "observation does not cover the known window set";

/// Bounded coordinate extent for carried work-area/window geometry.
const GEOMETRY_BOUND: i32 = 16384;
/// Bounded gap extent for carried work-area geometry.
const GEOMETRY_MAX_GAP: i32 = 64;

fn valid_carried_rect(x: i32, y: i32, w: i32, h: i32) -> bool {
    w > 0
        && h > 0
        && (-GEOMETRY_BOUND..=GEOMETRY_BOUND).contains(&x)
        && (-GEOMETRY_BOUND..=GEOMETRY_BOUND).contains(&y)
        && w <= GEOMETRY_BOUND
        && h <= GEOMETRY_BOUND
        && (i64::from(x) + i64::from(w) <= i64::from(i32::MAX))
        && (i64::from(y) + i64::from(h) <= i64::from(i32::MAX))
}

fn rect_contained(inner: Rect, outer: Rect) -> bool {
    let inner_right = i64::from(inner.x) + i64::from(inner.w);
    let inner_bottom = i64::from(inner.y) + i64::from(inner.h);
    let outer_right = i64::from(outer.x) + i64::from(outer.w);
    let outer_bottom = i64::from(outer.y) + i64::from(outer.h);
    inner.x >= outer.x
        && inner.y >= outer.y
        && inner_right <= outer_right
        && inner_bottom <= outer_bottom
}

fn is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= PLAN_MAX_ID_LEN
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

fn valid_correlation_echo(value: &serde_json::Value) -> String {
    value
        .get("correlation_id")
        .and_then(serde_json::Value::as_str)
        .filter(|id| CorrelationId::parse(id).is_some())
        .unwrap_or_default()
        .to_owned()
}

fn parse_direction(value: &str) -> Option<Direction> {
    match value {
        "left" => Some(Direction::Left),
        "right" => Some(Direction::Right),
        "up" => Some(Direction::Up),
        "down" => Some(Direction::Down),
        _ => None,
    }
}

fn direction_str(value: Direction) -> &'static str {
    match value {
        Direction::Left => "left",
        Direction::Right => "right",
        Direction::Up => "up",
        Direction::Down => "down",
    }
}

fn parse_mode(value: &str) -> Option<crate::contract::ResizeMode> {
    match value {
        "inwards" => Some(crate::contract::ResizeMode::Inwards),
        "outwards" => Some(crate::contract::ResizeMode::Outwards),
        _ => None,
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RectDto {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct DomainDto {
    output: String,
    workspace: String,
    bounds: RectDto,
    gap: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ObservedDto {
    window: String,
    output: String,
    workspace: String,
    rect: RectDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestDto {
    v: u32,
    correlation_id: String,
    owner: String,
    generation: String,
    revision: u64,
    fingerprint: u64,
    domain: DomainDto,
    focused_window: String,
    windows: Vec<ObservedDto>,
    command: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
struct GeometryReply {
    window: String,
    leaf: String,
    output: String,
    workspace: String,
    rect: RectDto,
}

#[derive(Debug, Clone, Serialize)]
struct FocusReplyBody {
    domain_output: String,
    domain_workspace: String,
    leaf: String,
}

#[derive(Debug, Clone, Serialize)]
struct PlanReply {
    v: u32,
    correlation_id: String,
    outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    base_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    desired_geometry: Option<Vec<GeometryReply>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    desired_focus: Option<FocusReplyBody>,
}

fn serialize_bounded(reply: &PlanReply) -> String {
    match serde_json::to_string(reply) {
        Ok(text) if text.len() <= PLAN_MAX_REPLY_BYTES => text,
        _ => "{\"v\":1,\"correlation_id\":\"\",\"outcome\":\"rejected\",\"kind\":\"snapshot-invalid\",\"message\":\"snapshot or intent is malformed\"}"
            .to_owned(),
    }
}

fn rejected(correlation_id: String, kind: &str, message: &str) -> String {
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id,
        outcome: "rejected",
        kind: Some(kind.to_owned()),
        message: Some(message.to_owned()),
        base_revision: None,
        detail: None,
        desired_geometry: None,
        desired_focus: None,
    })
}

fn classify_parse_error(error: &serde_json::Error) -> (&'static str, &'static str) {
    let text = error.to_string();
    if text.contains("unknown field") {
        ("unknown-field", MSG_UNKNOWN_FIELD)
    } else if text.contains("unknown variant") {
        ("unknown-value", MSG_UNKNOWN_VALUE)
    } else {
        ("request-malformed", MSG_MALFORMED)
    }
}

fn geometry_reply(g: &crate::session::DesiredGeometry) -> GeometryReply {
    GeometryReply {
        window: g.window.0.clone(),
        leaf: g.leaf.0.clone(),
        output: g.output.0.clone(),
        workspace: g.workspace.0.clone(),
        rect: RectDto {
            x: g.rect.x,
            y: g.rect.y,
            w: g.rect.w,
            h: g.rect.h,
        },
    }
}

fn focus_reply(domain: &DomainKey, leaf: &NodeId) -> FocusReplyBody {
    FocusReplyBody {
        domain_output: domain.output.0.clone(),
        domain_workspace: domain.workspace.0.clone(),
        leaf: leaf.0.clone(),
    }
}

fn propose_failure(kind: ProposeError, correlation_id: String) -> String {
    match kind {
        ProposeError::PendingExists => rejected(
            correlation_id,
            "pending-exists",
            "complete the pending plan before proposing",
        ),
        ProposeError::Diverged(reason) => {
            rejected(correlation_id, reason.as_str(), reason.message())
        }
        ProposeError::Refused(reason) => {
            rejected(correlation_id, reason.as_str(), reason.message())
        }
    }
}

/// Rebuild ephemeral authoritative topology from the normalized observation.
///
/// Admits the observed spatial order, with the focused window last, through
/// the retained session lifecycle path only. Geometry and focus are the sole
/// placement inputs: opaque window ids never determine topology.
fn seed_session(
    owner: &OwnerId,
    generation: &GenerationId,
    fingerprint: u64,
    domain: &OutputDomain,
    seed_order: &[ObservedDto],
) -> Option<Session> {
    let mut session = Session::new(
        owner.clone(),
        generation.clone(),
        0,
        fingerprint,
        vec![domain.clone()],
    )
    .ok()?;
    for (index, entry) in seed_order.iter().enumerate() {
        let base = session.accepted_revision();
        let mut observed: Vec<ObservedWindow> = session
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
        observed.extend(session.exception_observed());
        observed.push(ObservedWindow {
            window: WindowId(entry.window.clone()),
            output: OutputId(entry.output.clone()),
            workspace: WorkspaceId(entry.workspace.clone()),
            floating: false,
            fullscreen: false,
            maximized: false,
            sticky: false,
        });
        let correlation_text = format!("seed-{index:04}");
        let correlation = CorrelationId::parse(&correlation_text)?;
        let observation = SessionObservation {
            observation: Observation::new(owner.clone(), generation.clone(), base, fingerprint),
            windows: observed,
        };
        let command = SessionCommand::Admit {
            window: WindowId(entry.window.clone()),
            output: OutputId(entry.output.clone()),
            workspace: WorkspaceId(entry.workspace.clone()),
            exceptions: ExceptionFlags::none(),
            exception_behavior: None,
            placement_bounds: Rect {
                x: entry.rect.x,
                y: entry.rect.y,
                w: entry.rect.w,
                h: entry.rect.h,
            },
        };
        let plan = session
            .propose(
                &command,
                &observation,
                &correlation,
                &LifecycleCapabilities::full(),
            )
            .ok()?;
        let ack = crate::contract::AdapterAck::new(
            correlation.clone(),
            owner.clone(),
            generation.clone(),
            base,
            crate::contract::AckOutcome::Accepted,
        );
        session.acknowledge(&ack).ok()?;
        session
            .verify_lifecycle(&crate::contract::LifecyclePostObservation::new(
                Observation::new(owner.clone(), generation.clone(), base, base),
                correlation,
                true,
                plan.dispatch.preconditions.clone(),
                plan.dispatch.operation.clone(),
            ))
            .ok()?;
    }
    Some(session)
}

fn spatial_with_focus_last(
    mut windows: Vec<ObservedDto>,
    focused: &str,
) -> Option<Vec<ObservedDto>> {
    // Equal frame rectangles provide no visible ordering signal. Reject rather
    // than falling back to an opaque id or native enumeration order.
    for (index, left) in windows.iter().enumerate() {
        if left.window == focused {
            continue;
        }
        if windows[index + 1..].iter().any(|right| {
            right.window != focused
                && left.rect.x == right.rect.x
                && left.rect.y == right.rect.y
                && left.rect.w == right.rect.w
                && left.rect.h == right.rect.h
        }) {
            return None;
        }
    }
    windows.sort_by(
        |left, right| match (left.window == focused, right.window == focused) {
            (true, false) => std::cmp::Ordering::Greater,
            (false, true) => std::cmp::Ordering::Less,
            _ => (left.rect.y, left.rect.x, left.rect.h, left.rect.w).cmp(&(
                right.rect.y,
                right.rect.x,
                right.rect.h,
                right.rect.w,
            )),
        },
    );
    Some(windows)
}

/// Strict stateless Planner evaluation. Always returns a bounded reply:
/// `planned` with full target geometries plus retained focus, or recoverable
/// `rejected` with a bounded kind. Never retains state, so fresh observations
/// recover after any rejection.
pub fn evaluate_plan_json(request_json: &str) -> String {
    if request_json.len() > PLAN_MAX_REQUEST_BYTES {
        return rejected(String::new(), "oversized", MSG_OVERSIZED);
    }
    let raw: serde_json::Value = match serde_json::from_str(request_json) {
        Ok(raw) => raw,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(String::new(), kind, message);
        }
    };
    let request: RequestDto = match serde_json::from_value(raw.clone()) {
        Ok(request) => request,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(valid_correlation_echo(&raw), kind, message);
        }
    };
    if request.v != PLAN_CONTRACT_VERSION {
        return rejected(
            request.correlation_id.clone(),
            "unsupported-version",
            MSG_VERSION,
        );
    }
    if CorrelationId::parse(&request.correlation_id).is_none() {
        return rejected(String::new(), "correlation-invalid", MSG_CORRELATION);
    }
    if OwnerId::parse(&request.owner).is_none() {
        return rejected(request.correlation_id.clone(), "owner-invalid", MSG_OWNER);
    }
    if GenerationId::parse(&request.generation).is_none() {
        return rejected(
            request.correlation_id.clone(),
            "generation-invalid",
            MSG_GENERATION,
        );
    }
    if request.revision > PLAN_MAX_REVISION {
        return rejected(
            request.correlation_id.clone(),
            "revision-invalid",
            MSG_REVISION,
        );
    }
    if !is_opaque_id(&request.domain.output)
        || !is_opaque_id(&request.domain.workspace)
        || (!request.focused_window.is_empty() && !is_opaque_id(&request.focused_window))
    {
        return rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OPAQUE_ID,
        );
    }
    if request.windows.len() > PLAN_MAX_WINDOWS {
        return rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        );
    }
    {
        let mut seen = std::collections::HashSet::new();
        for entry in &request.windows {
            if !is_opaque_id(&entry.window)
                || !is_opaque_id(&entry.output)
                || !is_opaque_id(&entry.workspace)
            {
                return rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    MSG_OPAQUE_ID,
                );
            }
            if !seen.insert(entry.window.clone()) {
                return rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    MSG_OPAQUE_ID,
                );
            }
        }
    }
    let carried_bounds = Rect {
        x: request.domain.bounds.x,
        y: request.domain.bounds.y,
        w: request.domain.bounds.w,
        h: request.domain.bounds.h,
    };
    if !valid_carried_rect(
        carried_bounds.x,
        carried_bounds.y,
        carried_bounds.w,
        carried_bounds.h,
    ) || request.domain.gap < 0
        || request.domain.gap > GEOMETRY_MAX_GAP
    {
        return rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        );
    }
    for entry in &request.windows {
        if !valid_carried_rect(entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h) {
            return rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OBSERVATION,
            );
        }
        if !rect_contained(
            Rect {
                x: entry.rect.x,
                y: entry.rect.y,
                w: entry.rect.w,
                h: entry.rect.h,
            },
            carried_bounds,
        ) {
            return rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OBSERVATION,
            );
        }
        // Single-domain Stage 4: every observed entry lives in the request
        // domain; anything else is a cross-domain mismatch.
        if entry.output != request.domain.output || entry.workspace != request.domain.workspace {
            return rejected(
                request.correlation_id.clone(),
                "cross-domain-mismatch",
                "input output or workspace does not match a logical domain",
            );
        }
    }
    if !request.windows.is_empty()
        && !request
            .windows
            .iter()
            .any(|w| w.window == request.focused_window)
    {
        return rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        );
    }
    let owner = OwnerId::parse(&request.owner).expect("validated");
    let generation = GenerationId::parse(&request.generation).expect("validated");
    let correlation = CorrelationId::parse(&request.correlation_id).expect("validated");
    let domain = OutputDomain {
        id: OutputId(request.domain.output.clone()),
        workspace: WorkspaceId(request.domain.workspace.clone()),
        bounds: carried_bounds,
        gap: request.domain.gap,
        adjacent: std::collections::BTreeMap::new(),
    };
    if !domain.validate() {
        return rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        );
    }
    let domain_key = DomainKey {
        output: OutputId(request.domain.output.clone()),
        workspace: WorkspaceId(request.domain.workspace.clone()),
    };
    let op = request
        .command
        .get("op")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_owned();
    match op.as_str() {
        "admit" => evaluate_admit(
            &request,
            &raw,
            &owner,
            &generation,
            &correlation,
            &domain,
            &domain_key,
        ),
        "remove" => evaluate_remove(
            &request,
            &raw,
            &owner,
            &generation,
            &correlation,
            &domain,
            &domain_key,
        ),
        "move" => evaluate_move(
            &request,
            &raw,
            &owner,
            &generation,
            &correlation,
            &domain,
            &domain_key,
        ),
        "focus" => evaluate_focus(
            &request,
            &raw,
            &owner,
            &generation,
            &correlation,
            &domain,
            &domain_key,
        ),
        "resize" => evaluate_resize(
            &request,
            &raw,
            &owner,
            &generation,
            &correlation,
            &domain,
            &domain_key,
        ),
        _ => rejected(
            valid_correlation_echo(&raw),
            "unknown-value",
            MSG_UNKNOWN_VALUE,
        ),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct AdmitCommand {
    op: String,
    window: String,
    output: String,
    workspace: String,
    #[serde(default)]
    placement_bounds: Option<RectDto>,
}

fn evaluate_admit(
    request: &RequestDto,
    raw: &serde_json::Value,
    owner: &OwnerId,
    generation: &GenerationId,
    correlation: &CorrelationId,
    domain: &OutputDomain,
    _domain_key: &DomainKey,
) -> String {
    let command: AdmitCommand = match serde_json::from_value(request.command.clone()) {
        Ok(command) => command,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(valid_correlation_echo(raw), kind, message);
        }
    };
    if command.op != "admit"
        || !is_opaque_id(&command.window)
        || !is_opaque_id(&command.output)
        || !is_opaque_id(&command.workspace)
    {
        return rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OPAQUE_ID,
        );
    }
    if command.output != request.domain.output || command.workspace != request.domain.workspace {
        return rejected(
            request.correlation_id.clone(),
            "cross-domain-mismatch",
            "input output or workspace does not match a logical domain",
        );
    }
    let Some(admitted) = request.windows.iter().find(|w| w.window == command.window) else {
        return rejected(
            request.correlation_id.clone(),
            "partial-observation",
            "observation does not cover the known window set",
        );
    };
    if admitted.output != command.output || admitted.workspace != command.workspace {
        return rejected(
            request.correlation_id.clone(),
            "partial-observation",
            "observation does not cover the known window set",
        );
    }
    let placement = match command.placement_bounds {
        Some(rect) => {
            if !valid_carried_rect(rect.x, rect.y, rect.w, rect.h) {
                return rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    MSG_OBSERVATION,
                );
            }
            Rect {
                x: rect.x,
                y: rect.y,
                w: rect.w,
                h: rect.h,
            }
        }
        None => Rect {
            x: admitted.rect.x,
            y: admitted.rect.y,
            w: admitted.rect.w,
            h: admitted.rect.h,
        },
    };
    let base: Vec<ObservedDto> = request
        .windows
        .iter()
        .filter(|w| w.window != command.window)
        .cloned()
        .collect();
    let Some(seed_order) = spatial_with_focus_last(base, &request.focused_window) else {
        return rejected(
            request.correlation_id.clone(),
            "ambiguous-placement",
            "window placement is ambiguous",
        );
    };
    let Some(mut session) =
        seed_session(owner, generation, request.fingerprint, domain, &seed_order)
    else {
        return rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        );
    };
    let observed: Vec<ObservedWindow> = request
        .windows
        .iter()
        .map(|entry| ObservedWindow {
            window: WindowId(entry.window.clone()),
            output: OutputId(entry.output.clone()),
            workspace: WorkspaceId(entry.workspace.clone()),
            floating: false,
            fullscreen: false,
            maximized: false,
            sticky: false,
        })
        .collect();
    let base_revision = session.accepted_revision();
    let observation = SessionObservation {
        observation: Observation::new(
            owner.clone(),
            generation.clone(),
            base_revision,
            request.fingerprint,
        ),
        windows: observed,
    };
    let session_command = SessionCommand::Admit {
        window: WindowId(command.window.clone()),
        output: OutputId(command.output.clone()),
        workspace: WorkspaceId(command.workspace.clone()),
        exceptions: ExceptionFlags::none(),
        exception_behavior: None,
        placement_bounds: placement,
    };
    match session.propose(
        &session_command,
        &observation,
        correlation,
        &LifecycleCapabilities::full(),
    ) {
        Ok(plan) => {
            let geometry: Vec<GeometryReply> =
                plan.desired_geometry.iter().map(geometry_reply).collect();
            let desired_focus = match (&plan.desired_focus_domain, &plan.desired_focus_leaf) {
                (Some(d), Some(l)) => Some(focus_reply(d, l)),
                _ => None,
            };
            serialize_bounded(&PlanReply {
                v: PLAN_CONTRACT_VERSION,
                correlation_id: request.correlation_id.clone(),
                outcome: "planned",
                kind: None,
                message: None,
                base_revision: Some(plan.dispatch.base_revision),
                detail: Some(serde_json::json!({
                    "kind": "admit",
                    "policy_version": plan.dispatch.policy_version,
                    "capability": "admit-tiled",
                })),
                desired_geometry: Some(geometry),
                desired_focus,
            })
        }
        Err(error) => propose_failure(error, request.correlation_id.clone()),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RemoveCommand {
    op: String,
    window: String,
}

fn evaluate_remove(
    request: &RequestDto,
    raw: &serde_json::Value,
    owner: &OwnerId,
    generation: &GenerationId,
    correlation: &CorrelationId,
    domain: &OutputDomain,
    _domain_key: &DomainKey,
) -> String {
    let command: RemoveCommand = match serde_json::from_value(request.command.clone()) {
        Ok(command) => command,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(valid_correlation_echo(raw), kind, message);
        }
    };
    if command.op != "remove" || !is_opaque_id(&command.window) {
        return rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OPAQUE_ID,
        );
    }
    let Some(seed_order) =
        spatial_with_focus_last(request.windows.clone(), &request.focused_window)
    else {
        return rejected(
            request.correlation_id.clone(),
            "ambiguous-placement",
            "window placement is ambiguous",
        );
    };
    let Some(mut session) =
        seed_session(owner, generation, request.fingerprint, domain, &seed_order)
    else {
        return rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        );
    };
    let observed: Vec<ObservedWindow> = request
        .windows
        .iter()
        .map(|entry| ObservedWindow {
            window: WindowId(entry.window.clone()),
            output: OutputId(entry.output.clone()),
            workspace: WorkspaceId(entry.workspace.clone()),
            floating: false,
            fullscreen: false,
            maximized: false,
            sticky: false,
        })
        .collect();
    let base_revision = session.accepted_revision();
    let observation = SessionObservation {
        observation: Observation::new(
            owner.clone(),
            generation.clone(),
            base_revision,
            request.fingerprint,
        ),
        windows: observed,
    };
    let session_command = SessionCommand::Remove {
        window: WindowId(command.window.clone()),
    };
    match session.propose(
        &session_command,
        &observation,
        correlation,
        &LifecycleCapabilities::full(),
    ) {
        Ok(plan) => {
            let geometry: Vec<GeometryReply> =
                plan.desired_geometry.iter().map(geometry_reply).collect();
            let desired_focus = match (&plan.desired_focus_domain, &plan.desired_focus_leaf) {
                (Some(d), Some(l)) => Some(focus_reply(d, l)),
                _ => None,
            };
            serialize_bounded(&PlanReply {
                v: PLAN_CONTRACT_VERSION,
                correlation_id: request.correlation_id.clone(),
                outcome: "planned",
                kind: None,
                message: None,
                base_revision: Some(plan.dispatch.base_revision),
                detail: Some(serde_json::json!({
                    "kind": "remove",
                    "policy_version": plan.dispatch.policy_version,
                    "capability": "remove-tiled",
                })),
                desired_geometry: Some(geometry),
                desired_focus,
            })
        }
        Err(error) => propose_failure(error, request.correlation_id.clone()),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct DirectedCommand {
    op: String,
    window: String,
    direction: String,
}

fn build_full_session(
    request: &RequestDto,
    owner: &OwnerId,
    generation: &GenerationId,
    domain: &OutputDomain,
) -> Option<(Session, SessionObservation)> {
    let seed_order = spatial_with_focus_last(request.windows.clone(), &request.focused_window)?;
    let session = seed_session(owner, generation, request.fingerprint, domain, &seed_order)?;
    let observed: Vec<ObservedWindow> = request
        .windows
        .iter()
        .map(|entry| ObservedWindow {
            window: WindowId(entry.window.clone()),
            output: OutputId(entry.output.clone()),
            workspace: WorkspaceId(entry.workspace.clone()),
            floating: false,
            fullscreen: false,
            maximized: false,
            sticky: false,
        })
        .collect();
    let base_revision = session.accepted_revision();
    let observation = SessionObservation {
        observation: Observation::new(
            owner.clone(),
            generation.clone(),
            base_revision,
            request.fingerprint,
        ),
        windows: observed,
    };
    Some((session, observation))
}

fn evaluate_move(
    request: &RequestDto,
    raw: &serde_json::Value,
    owner: &OwnerId,
    generation: &GenerationId,
    correlation: &CorrelationId,
    domain: &OutputDomain,
    domain_key: &DomainKey,
) -> String {
    let command: DirectedCommand = match serde_json::from_value(request.command.clone()) {
        Ok(command) => command,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(valid_correlation_echo(raw), kind, message);
        }
    };
    if command.op != "move" || !is_opaque_id(&command.window) {
        return rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OPAQUE_ID,
        );
    }
    let Some(direction) = parse_direction(&command.direction) else {
        return rejected(
            request.correlation_id.clone(),
            "direction-invalid",
            "direction is invalid",
        );
    };
    let Some((mut session, observation)) = build_full_session(request, owner, generation, domain)
    else {
        return rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        );
    };
    match session.propose_move(
        domain_key,
        &WindowId(command.window.clone()),
        direction,
        &observation,
        correlation,
        &Capabilities::full(),
    ) {
        Ok(plan) => {
            let geometry: Vec<GeometryReply> =
                plan.desired_geometry.iter().map(geometry_reply).collect();
            serialize_bounded(&PlanReply {
                v: PLAN_CONTRACT_VERSION,
                correlation_id: request.correlation_id.clone(),
                outcome: "planned",
                kind: None,
                message: None,
                base_revision: Some(plan.dispatch.base_revision),
                detail: Some(serde_json::json!({
                    "kind": "move",
                    "rule": format!("{:?}", plan.dispatch.rule),
                    "capability": format!("{:?}", plan.dispatch.required_capability),
                    "direction": direction_str(direction),
                })),
                desired_geometry: Some(geometry),
                desired_focus: Some(focus_reply(
                    &plan.desired_focus_domain,
                    &plan.desired_focus_leaf,
                )),
            })
        }
        Err(error) => propose_failure(error, request.correlation_id.clone()),
    }
}

fn evaluate_focus(
    request: &RequestDto,
    raw: &serde_json::Value,
    owner: &OwnerId,
    generation: &GenerationId,
    correlation: &CorrelationId,
    domain: &OutputDomain,
    domain_key: &DomainKey,
) -> String {
    let command: DirectedCommand = match serde_json::from_value(request.command.clone()) {
        Ok(command) => command,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(valid_correlation_echo(raw), kind, message);
        }
    };
    if command.op != "focus" || !is_opaque_id(&command.window) {
        return rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OPAQUE_ID,
        );
    }
    let Some(direction) = parse_direction(&command.direction) else {
        return rejected(
            request.correlation_id.clone(),
            "direction-invalid",
            "direction is invalid",
        );
    };
    let Some((mut session, observation)) = build_full_session(request, owner, generation, domain)
    else {
        return rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        );
    };
    match session.propose_focus(
        domain_key,
        &WindowId(command.window.clone()),
        direction,
        &observation,
        correlation,
        &FocusCapabilities::full(),
    ) {
        Ok(plan) => {
            let geometry: Vec<GeometryReply> =
                plan.desired_geometry.iter().map(geometry_reply).collect();
            serialize_bounded(&PlanReply {
                v: PLAN_CONTRACT_VERSION,
                correlation_id: request.correlation_id.clone(),
                outcome: "planned",
                kind: None,
                message: None,
                base_revision: Some(plan.dispatch.base_revision),
                detail: Some(serde_json::json!({
                    "kind": "focus",
                    "capability": "directional-focus",
                    "direction": direction_str(direction),
                    "to_window": plan.dispatch.operation.to_window.0,
                })),
                desired_geometry: Some(geometry),
                desired_focus: Some(focus_reply(
                    &plan.desired_focus_domain,
                    &plan.desired_focus_leaf,
                )),
            })
        }
        Err(error) => propose_failure(error, request.correlation_id.clone()),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResizeCommand {
    op: String,
    window: String,
    direction: String,
    mode: String,
    press_index: u32,
}

fn evaluate_resize(
    request: &RequestDto,
    raw: &serde_json::Value,
    owner: &OwnerId,
    generation: &GenerationId,
    correlation: &CorrelationId,
    domain: &OutputDomain,
    domain_key: &DomainKey,
) -> String {
    let command: ResizeCommand = match serde_json::from_value(request.command.clone()) {
        Ok(command) => command,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(valid_correlation_echo(raw), kind, message);
        }
    };
    if command.op != "resize" || !is_opaque_id(&command.window) {
        return rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OPAQUE_ID,
        );
    }
    let Some(direction) = parse_direction(&command.direction) else {
        return rejected(
            request.correlation_id.clone(),
            "direction-invalid",
            "direction is invalid",
        );
    };
    let Some(mode) = parse_mode(&command.mode) else {
        return rejected(
            request.correlation_id.clone(),
            "direction-invalid",
            "direction is invalid",
        );
    };
    let Some((mut session, observation)) = build_full_session(request, owner, generation, domain)
    else {
        return rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        );
    };
    let capabilities = crate::contract::ResizeCapabilities {
        keyboard_resize: true,
        pointer_resize: false,
    };
    match session.propose_resize(
        domain_key,
        &WindowId(command.window.clone()),
        direction,
        mode,
        command.press_index,
        &observation,
        correlation,
        &capabilities,
    ) {
        Ok(plan) => {
            let geometry: Vec<GeometryReply> =
                plan.desired_geometry.iter().map(geometry_reply).collect();
            serialize_bounded(&PlanReply {
                v: PLAN_CONTRACT_VERSION,
                correlation_id: request.correlation_id.clone(),
                outcome: "planned",
                kind: None,
                message: None,
                base_revision: Some(plan.dispatch.base_revision),
                detail: Some(serde_json::json!({
                    "kind": "resize",
                    "capability": "keyboard-resize",
                    "direction": direction_str(direction),
                    "mode": mode.as_str(),
                    "target_group": plan.dispatch.operation.target_group.0,
                    "focused_index": plan.dispatch.operation.focused_index,
                    "neighbor_index": plan.dispatch.operation.neighbor_index,
                    "old_shares": plan.dispatch.operation.old_shares,
                    "new_shares": plan.dispatch.operation.new_shares,
                })),
                desired_geometry: Some(geometry),
                desired_focus: Some(focus_reply(
                    &plan.desired_focus_domain,
                    &plan.desired_focus_leaf,
                )),
            })
        }
        Err(error) => propose_failure(error, request.correlation_id.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn domain_bounds() -> serde_json::Value {
        serde_json::json!({"x": 0, "y": 0, "w": 1200, "h": 800})
    }

    fn window_entry(window: &str) -> serde_json::Value {
        let index = window
            .rsplit_once('-')
            .and_then(|(_, value)| value.parse::<i32>().ok())
            .unwrap_or(1);
        serde_json::json!({
            "window": window,
            "output": "out-1",
            "workspace": "ws-1",
            "rect": {"x": (index - 1) * 100, "y": 0, "w": 100, "h": 80},
        })
    }

    fn plan_request(
        correlation: &str,
        focused: &str,
        windows: &[&str],
        command: serde_json::Value,
    ) -> String {
        let entries: Vec<serde_json::Value> = windows.iter().map(|w| window_entry(w)).collect();
        serde_json::json!({
            "v": 1,
            "correlation_id": correlation,
            "owner": "owner-1",
            "generation": "gen-1",
            "revision": 0,
            "fingerprint": 7,
            "domain": {
                "output": "out-1",
                "workspace": "ws-1",
                "bounds": domain_bounds(),
                "gap": 0,
            },
            "focused_window": focused,
            "windows": entries,
            "command": command,
        })
        .to_string()
    }

    fn parse_reply(reply: &str) -> serde_json::Value {
        serde_json::from_str(reply).expect("reply is JSON")
    }

    fn assert_geometry_covers(reply: &serde_json::Value, expected: &[&str]) {
        let geometry = reply["desired_geometry"]
            .as_array()
            .expect("planned geometry present");
        assert_eq!(geometry.len(), expected.len(), "{reply}");
        let mut got: Vec<String> = geometry
            .iter()
            .map(|g| g["window"].as_str().expect("window").to_owned())
            .collect();
        got.sort();
        let mut want: Vec<String> = expected.iter().map(|s| s.to_string()).collect();
        want.sort();
        assert_eq!(got, want, "{reply}");
        for entry in geometry {
            let rect = &entry["rect"];
            assert!(rect["w"].as_i64().unwrap() > 0, "{reply}");
            assert!(rect["h"].as_i64().unwrap() > 0, "{reply}");
            for key in ["window", "leaf", "output", "workspace"] {
                assert!(
                    entry[key].as_str().is_some_and(|s| !s.is_empty()),
                    "{reply}"
                );
            }
        }
        assert!(reply["desired_focus"]["leaf"].as_str().is_some(), "{reply}");
    }

    #[test]
    fn admit_builds_1_to_6_with_full_geometries() {
        for total in 1..=6 {
            let windows: Vec<String> = (1..=total).map(|i| format!("win-{i}")).collect();
            let refs: Vec<&str> = windows.iter().map(String::as_str).collect();
            let admitted = format!("win-{total}");
            // Observation carries the complete normalized set including the
            // admitted window; the base is rebuilt from the remaining set.
            let focused = if total == 1 {
                admitted.clone()
            } else {
                "win-1".to_owned()
            };
            let request = plan_request(
                &format!("admit-1-{total}"),
                &focused,
                &refs,
                serde_json::json!({
                    "op": "admit",
                    "window": admitted,
                    "output": "out-1",
                    "workspace": "ws-1",
                }),
            );
            let reply = parse_reply(&evaluate_plan_json(&request));
            assert_eq!(reply["outcome"], "planned", "total={total} {reply}");
            let want: Vec<&str> = refs.clone();
            assert_geometry_covers(&reply, &want);
        }
    }

    #[test]
    fn remove_collapses_2_to_6_preserving_survivors() {
        for total in 2..=6 {
            let windows: Vec<String> = (1..=total).map(|i| format!("win-{i}")).collect();
            let refs: Vec<&str> = windows.iter().map(String::as_str).collect();
            // Remove a middle window so single-child collapse is exercised.
            let removed = format!("win-{}", (total + 1) / 2);
            let request = plan_request(
                &format!("remove-1-{total}"),
                "win-1",
                &refs,
                serde_json::json!({"op": "remove", "window": removed}),
            );
            let reply = parse_reply(&evaluate_plan_json(&request));
            assert_eq!(reply["outcome"], "planned", "total={total} {reply}");
            let want: Vec<String> = windows.iter().filter(|w| *w != &removed).cloned().collect();
            let want_refs: Vec<&str> = want.iter().map(String::as_str).collect();
            assert_geometry_covers(&reply, &want_refs);
        }
    }

    #[test]
    fn directional_focus_moves_to_neighbor() {
        // Seeding admits sorted ids with the focused window last, so win-1
        // is the rightmost leaf; left reaches its siblings.
        let request = plan_request(
            "focus-1",
            "win-1",
            &["win-1", "win-2", "win-3"],
            serde_json::json!({"op": "focus", "window": "win-1", "direction": "left"}),
        );
        let reply = parse_reply(&evaluate_plan_json(&request));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2", "win-3"]);
        let to = reply["detail"]["to_window"].as_str().expect("to_window");
        assert_ne!(to, "win-1", "{reply}");
    }

    #[test]
    fn directional_move_retains_mover_with_full_geometry() {
        // Rightmost focused leaf moves left into its siblings (R2a/R2c).
        let request = plan_request(
            "move-1",
            "win-1",
            &["win-1", "win-2", "win-3"],
            serde_json::json!({"op": "move", "window": "win-1", "direction": "left"}),
        );
        let reply = parse_reply(&evaluate_plan_json(&request));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2", "win-3"]);
        assert!(reply["detail"]["rule"].as_str().is_some(), "{reply}");
    }

    #[test]
    fn keyboard_resize_reflows_with_full_geometry() {
        // Rightmost focused leaf resizes against its left neighbor.
        let request = plan_request(
            "resize-1",
            "win-1",
            &["win-1", "win-2"],
            serde_json::json!({
                "op": "resize",
                "window": "win-1",
                "direction": "left",
                "mode": "outwards",
                "press_index": 0,
            }),
        );
        let reply = parse_reply(&evaluate_plan_json(&request));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
        let old = reply["detail"]["old_shares"]
            .as_array()
            .expect("old shares");
        let new = reply["detail"]["new_shares"]
            .as_array()
            .expect("new shares");
        assert_eq!(old.len(), new.len(), "{reply}");
        assert_ne!(old, new, "{reply}");
    }

    #[test]
    fn fresh_observations_recover_after_any_rejection() {
        // Unknown window rejects recoverably (rejected, never diverged).
        let bad = plan_request(
            "recover-bad-1",
            "win-1",
            &["win-1", "win-2"],
            serde_json::json!({"op": "remove", "window": "win-9"}),
        );
        let bad_reply = parse_reply(&evaluate_plan_json(&bad));
        assert_eq!(bad_reply["outcome"], "rejected", "{bad_reply}");
        assert!(bad_reply["kind"].as_str().is_some(), "{bad_reply}");
        assert_ne!(bad_reply["kind"], "diverged", "{bad_reply}");
        // A fresh observation with a valid command plans immediately.
        let good = plan_request(
            "recover-good-1",
            "win-1",
            &["win-1", "win-2"],
            serde_json::json!({"op": "focus", "window": "win-1", "direction": "left"}),
        );
        let good_reply = parse_reply(&evaluate_plan_json(&good));
        assert_eq!(good_reply["outcome"], "planned", "{good_reply}");
        // Malformed input also recovers on the next fresh call.
        let malformed = plan_request(
            "recover-bad-2",
            "win-1",
            &["win-1", "win-2"],
            serde_json::json!({"op": "move", "window": "win-1", "direction": "diagonal"}),
        );
        let malformed_reply = parse_reply(&evaluate_plan_json(&malformed));
        assert_eq!(malformed_reply["outcome"], "rejected", "{malformed_reply}");
        let good2 = plan_request(
            "recover-good-2",
            "win-1",
            &["win-1", "win-2"],
            serde_json::json!({"op": "remove", "window": "win-2"}),
        );
        let good2_reply = parse_reply(&evaluate_plan_json(&good2));
        assert_eq!(good2_reply["outcome"], "planned", "{good2_reply}");
        assert_geometry_covers(&good2_reply, &["win-1"]);
    }

    #[test]
    fn rejection_kinds_are_bounded_without_echo() {
        let bad = plan_request(
            "bounded-1",
            "win-1",
            &["win-1"],
            serde_json::json!({"op": "remove", "window": "evil-window-xyz"}),
        );
        let reply = parse_reply(&evaluate_plan_json(&bad));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        let text = serde_json::to_string(&reply).expect("serialize");
        assert!(!text.contains("evil-window-xyz"), "{reply}");
        assert!(text.len() <= PLAN_MAX_REPLY_BYTES, "{reply}");
    }
}
