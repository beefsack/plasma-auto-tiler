//! Bounded Planner protocol (Stage 4, product-shaped, static only).
//!
//! Pure JSON-string-in / JSON-string-out evaluation. Rust owns all policy:
//! the complete normalized current observation (opaque adapter ids, frame
//! rectangles, output, workspace, focus) plus one parameterized command
//! proposes exactly that command through the existing
//! session/reconciler/directional/cosmic_v1 APIs ([`crate::cosmic_v1`]
//! admission axis/shares, no invented tiling semantics).
//!
//! Two evaluators share validation and reply shapes: [`evaluate_plan_json`]
//! is the stateless helper (ephemeral [`crate::session::Session`] rebuilt per
//! call), while [`Planner`] is the authoritative live-tree route (one
//! committed session per domain across calls; observations validate
//! membership/divergence but never rebuild known topology). Recovery is a
//! single rule: discard and rebuild once on owner/generation, domain, or
//! membership divergence, else reject rather than wedge. Every rejection maps
//! to a bounded recoverable `rejected` outcome (never terminal `diverged`),
//! so a fresh observation can always recover after any rejection. Native
//! execution stays outside: replies carry full target geometries plus
//! retained focus for the adapter to actuate.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::contract::{FocusCapabilities, LifecycleCapabilities, Observation};
use crate::directional::{Capabilities, Direction, NodeId, OutputId, WindowId, WorkspaceId};
use crate::geometry::{Rect, project};
use crate::ids::{CorrelationId, GenerationId, OwnerId};
use crate::session::{
    DomainKey, ExceptionFlags, ObservedWindow, OutputDomain, ProposeError, RefusalKind, Session,
    SessionCommand, SessionObservation,
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
const MSG_CROSS_DOMAIN: &str = "input output or workspace does not match a logical domain";
const MSG_AMBIGUOUS: &str = "window placement is ambiguous";
const MSG_DIRECTION: &str = "direction is invalid";

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

/// Validated request shared by the stateless and retained evaluators.
struct Validated {
    request: RequestDto,
    raw: serde_json::Value,
    owner: OwnerId,
    generation: GenerationId,
    correlation: CorrelationId,
    domain: OutputDomain,
    domain_key: DomainKey,
}

/// Shared request validation: bounds, opaque ids, geometry containment, and
/// domain binding. Returns the ready-made rejected reply on failure.
fn validate_request(request_json: &str) -> Result<Validated, String> {
    if request_json.len() > PLAN_MAX_REQUEST_BYTES {
        return Err(rejected(String::new(), "oversized", MSG_OVERSIZED));
    }
    let raw: serde_json::Value = match serde_json::from_str(request_json) {
        Ok(raw) => raw,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return Err(rejected(String::new(), kind, message));
        }
    };
    let request: RequestDto = match serde_json::from_value(raw.clone()) {
        Ok(request) => request,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return Err(rejected(valid_correlation_echo(&raw), kind, message));
        }
    };
    if request.v != PLAN_CONTRACT_VERSION {
        return Err(rejected(
            request.correlation_id.clone(),
            "unsupported-version",
            MSG_VERSION,
        ));
    }
    if CorrelationId::parse(&request.correlation_id).is_none() {
        return Err(rejected(
            String::new(),
            "correlation-invalid",
            MSG_CORRELATION,
        ));
    }
    if OwnerId::parse(&request.owner).is_none() {
        return Err(rejected(
            request.correlation_id.clone(),
            "owner-invalid",
            MSG_OWNER,
        ));
    }
    if GenerationId::parse(&request.generation).is_none() {
        return Err(rejected(
            request.correlation_id.clone(),
            "generation-invalid",
            MSG_GENERATION,
        ));
    }
    if request.revision > PLAN_MAX_REVISION {
        return Err(rejected(
            request.correlation_id.clone(),
            "revision-invalid",
            MSG_REVISION,
        ));
    }
    if !is_opaque_id(&request.domain.output)
        || !is_opaque_id(&request.domain.workspace)
        || (!request.focused_window.is_empty() && !is_opaque_id(&request.focused_window))
    {
        return Err(rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OPAQUE_ID,
        ));
    }
    if request.windows.len() > PLAN_MAX_WINDOWS {
        return Err(rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        ));
    }
    {
        let mut seen = std::collections::HashSet::new();
        for entry in &request.windows {
            if !is_opaque_id(&entry.window)
                || !is_opaque_id(&entry.output)
                || !is_opaque_id(&entry.workspace)
            {
                return Err(rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    MSG_OPAQUE_ID,
                ));
            }
            if !seen.insert(entry.window.clone()) {
                return Err(rejected(
                    request.correlation_id.clone(),
                    "snapshot-invalid",
                    MSG_OPAQUE_ID,
                ));
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
        return Err(rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        ));
    }
    for entry in &request.windows {
        if !valid_carried_rect(entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h) {
            return Err(rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OBSERVATION,
            ));
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
            return Err(rejected(
                request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OBSERVATION,
            ));
        }
        if entry.output != request.domain.output || entry.workspace != request.domain.workspace {
            return Err(rejected(
                request.correlation_id.clone(),
                "cross-domain-mismatch",
                MSG_CROSS_DOMAIN,
            ));
        }
    }
    if !request.windows.is_empty()
        && !request
            .windows
            .iter()
            .any(|w| w.window == request.focused_window)
    {
        return Err(rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        ));
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
        return Err(rejected(
            request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        ));
    }
    let domain_key = DomainKey {
        output: OutputId(request.domain.output.clone()),
        workspace: WorkspaceId(request.domain.workspace.clone()),
    };
    Ok(Validated {
        request,
        raw,
        owner,
        generation,
        correlation,
        domain,
        domain_key,
    })
}

fn validated_op(ctx: &Validated) -> String {
    ctx.request
        .command
        .get("op")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn observed_windows(request: &RequestDto) -> Vec<ObservedWindow> {
    request
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
        .collect()
}

fn observation_for(base: u64, ctx: &Validated) -> SessionObservation {
    SessionObservation {
        observation: Observation::new(
            ctx.owner.clone(),
            ctx.generation.clone(),
            base,
            ctx.request.fingerprint,
        ),
        windows: observed_windows(&ctx.request),
    }
}

fn acknowledge(session: &mut Session, ctx: &Validated, base: u64) -> bool {
    let ack = crate::contract::AdapterAck::new(
        ctx.correlation.clone(),
        ctx.owner.clone(),
        ctx.generation.clone(),
        base,
        crate::contract::AckOutcome::Accepted,
    );
    session.acknowledge(&ack).is_ok()
}

fn planned_reply(
    correlation_id: &str,
    base_revision: u64,
    detail: serde_json::Value,
    geometry: &[crate::session::DesiredGeometry],
    focus: Option<(&DomainKey, &NodeId)>,
) -> String {
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id: correlation_id.to_owned(),
        outcome: "planned",
        kind: None,
        message: None,
        base_revision: Some(base_revision),
        detail: Some(detail),
        desired_geometry: Some(geometry.iter().map(geometry_reply).collect()),
        desired_focus: focus.map(|(domain, leaf)| focus_reply(domain, leaf)),
    })
}

/// Rebuild admission target for one seed step: the currently focused target
/// leaf's projected rectangle, or the output geometry when the rebuilt domain
/// is still empty (or focus does not resolve there). COSMIC `map_to_tree`
/// splits the last active target node, never the newly admitted window, so
/// rebuilding from each window's own observed rect inverts portrait splits to
/// left/right (and landscape splits to top/bottom). Caller window geometry
/// never selects the axis here; projection failure falls back to the output
/// geometry and the later desired-geometry projection still fails closed.
fn seed_target_bounds(session: &Session, domain: &OutputDomain) -> Rect {
    let key = DomainKey {
        output: domain.id.clone(),
        workspace: domain.workspace.clone(),
    };
    let (focus_domain, focus_leaf) = session.focus();
    if focus_domain.as_ref() == Some(&key)
        && let Some(leaf) = focus_leaf.as_ref()
        && let Some(tree) = session
            .snapshot()
            .domains
            .into_iter()
            .find(|d| d.output == key.output && d.workspace == key.workspace)
            .and_then(|d| d.tree)
        && let Ok(projected) = project(&tree, domain.bounds, domain.gap)
        && let Some(target) = projected.iter().find(|entry| &entry.leaf == leaf)
    {
        return target.rect;
    }
    domain.bounds
}

/// Rebuild ephemeral authoritative topology from the normalized observation.
///
/// Admits the observed spatial order, with the focused window last, through
/// the retained session lifecycle path only. The split axis derives from the
/// rebuild target at each step (see [`seed_target_bounds`]); opaque window
/// ids never determine topology.
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
            placement_bounds: seed_target_bounds(&session, domain),
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

fn session_domain_matches(session: &Session, domain: &OutputDomain) -> bool {
    session
        .domains()
        .iter()
        .find(|d| d.id == domain.id && d.workspace == domain.workspace)
        .is_some_and(|d| d.bounds == domain.bounds && d.gap == domain.gap)
}

fn session_usable(session: &Session) -> bool {
    session.divergence().is_none() && !session.has_pending()
}

fn needs_rebuild(error: &ProposeError) -> bool {
    match error {
        ProposeError::Diverged(_) => true,
        ProposeError::Refused(RefusalKind::PartialObservation) => true,
        ProposeError::PendingExists => false,
        ProposeError::Refused(_) => false,
    }
}

/// Authoritative live-tree planner (D4).
///
/// Retains one committed [`Session`] per logical domain across `DescribePlan`
/// calls. Observations validate membership/divergence against the retained
/// topology but never rebuild it: a known domain proposes directly, so equal
/// non-focused rectangles cannot force `ambiguous-placement` after the initial
/// plan. Exactly one recovery rule exists: on owner/generation change
/// (adapter restart), domain bounds/gap change, terminal divergence, pending
/// residue, or membership divergence (`Diverged`/`partial-observation`),
/// discard that domain's retained state and rebuild once via the
/// [`seed_session`] path; if the rebuild cannot safely infer topology
/// (`ambiguous-placement`) reject rather than wedge. Each successful plan is
/// acknowledged then verified in the same call, so no pending crosses calls
/// and no stale data crosses domains/owner/generation.
#[derive(Debug, Default)]
pub struct Planner {
    owner: Option<OwnerId>,
    generation: Option<GenerationId>,
    sessions: BTreeMap<DomainKey, Session>,
}

impl Planner {
    /// Empty retained planner.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of retained domains (bounded by [`crate::session::MAX_DOMAINS`]).
    #[must_use]
    pub fn retained_domains(&self) -> usize {
        self.sessions.len()
    }

    /// Retained owner binding, if any.
    #[must_use]
    pub fn owner(&self) -> Option<&OwnerId> {
        self.owner.as_ref()
    }

    /// Retained generation binding, if any.
    #[must_use]
    pub fn generation(&self) -> Option<&GenerationId> {
        self.generation.as_ref()
    }

    fn sync_binding(&mut self, owner: &OwnerId, generation: &GenerationId) {
        let owner_changed = self
            .owner
            .as_ref()
            .is_none_or(|o| o.as_str() != owner.as_str());
        let generation_changed = self
            .generation
            .as_ref()
            .is_none_or(|g| g.as_str() != generation.as_str());
        if owner_changed || generation_changed {
            self.sessions.clear();
            self.owner = Some(owner.clone());
            self.generation = Some(generation.clone());
        }
    }

    /// Stateful evaluation across calls. Validation, bounds, and reply shapes
    /// match [`evaluate_plan_json`]; only topology sourcing differs (retained
    /// vs rebuilt).
    pub fn evaluate(&mut self, request_json: &str) -> String {
        let ctx = match validate_request(request_json) {
            Ok(ctx) => ctx,
            Err(reply) => return reply,
        };
        self.sync_binding(&ctx.owner, &ctx.generation);
        match validated_op(&ctx).as_str() {
            "admit" => self.evaluate_admit_retained(&ctx),
            "remove" => self.evaluate_remove_retained(&ctx),
            "move" => self.evaluate_move_retained(&ctx),
            "focus" => self.evaluate_focus_retained(&ctx),
            "resize" => self.evaluate_resize_retained(&ctx),
            _ => rejected(
                valid_correlation_echo(&ctx.raw),
                "unknown-value",
                MSG_UNKNOWN_VALUE,
            ),
        }
    }

    fn take_usable_session(
        &mut self,
        domain_key: &DomainKey,
        domain: &OutputDomain,
    ) -> Option<Session> {
        let session = self.sessions.get(domain_key)?;
        if !session_usable(session) || !session_domain_matches(session, domain) {
            self.sessions.remove(domain_key);
            return None;
        }
        Some(session.clone())
    }

    fn store_committed(&mut self, domain_key: DomainKey, session: Session) {
        if self.sessions.len() >= crate::session::MAX_DOMAINS
            && !self.sessions.contains_key(&domain_key)
        {
            self.sessions.clear();
        }
        self.sessions.insert(domain_key, session);
    }

    /// Shared retained propose/commit: try the usable retained session, then
    /// rebuild once from `seed_order`. `ambiguous_as_snapshot` selects the
    /// fail-closed kind when no safe order exists (admit/remove use
    /// `ambiguous-placement`; directional ops reuse the stateless
    /// `snapshot-invalid` mapping).
    fn run_retained<R>(
        &mut self,
        ctx: &Validated,
        seed_order: Option<Vec<ObservedDto>>,
        ambiguous_as_snapshot: bool,
        propose: impl Fn(&mut Session, &SessionObservation) -> Result<R, ProposeError>,
        reply: impl Fn(&R) -> String,
        commit: impl Fn(&mut Session, &R, &Validated, u64) -> bool,
    ) -> String {
        let cid = ctx.request.correlation_id.clone();
        if let Some(mut session) = self.take_usable_session(&ctx.domain_key, &ctx.domain) {
            let base = session.accepted_revision();
            let observation = observation_for(base, ctx);
            match propose(&mut session, &observation) {
                Ok(plan) => {
                    let text = reply(&plan);
                    if commit(&mut session, &plan, ctx, base) {
                        self.store_committed(ctx.domain_key.clone(), session);
                        return text;
                    }
                    self.sessions.remove(&ctx.domain_key);
                    return rejected(cid, "snapshot-invalid", MSG_OBSERVATION);
                }
                Err(error) if needs_rebuild(&error) => {
                    self.sessions.remove(&ctx.domain_key);
                }
                Err(error) => {
                    return propose_failure(error, cid.clone());
                }
            }
        }
        let Some(order) = seed_order else {
            if ambiguous_as_snapshot {
                return rejected(cid, "snapshot-invalid", MSG_OBSERVATION);
            }
            return rejected(cid, "ambiguous-placement", MSG_AMBIGUOUS);
        };
        let Some(mut session) = seed_session(
            &ctx.owner,
            &ctx.generation,
            ctx.request.fingerprint,
            &ctx.domain,
            &order,
        ) else {
            return rejected(cid, "snapshot-invalid", MSG_OBSERVATION);
        };
        let base = session.accepted_revision();
        let observation = observation_for(base, ctx);
        match propose(&mut session, &observation) {
            Ok(plan) => {
                let text = reply(&plan);
                if commit(&mut session, &plan, ctx, base) {
                    self.store_committed(ctx.domain_key.clone(), session);
                    return text;
                }
                rejected(cid, "snapshot-invalid", MSG_OBSERVATION)
            }
            Err(error) => propose_failure(error, cid),
        }
    }

    fn evaluate_admit_retained(&mut self, ctx: &Validated) -> String {
        let command: AdmitCommand = match serde_json::from_value(ctx.request.command.clone()) {
            Ok(command) => command,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        if command.op != "admit"
            || !is_opaque_id(&command.window)
            || !is_opaque_id(&command.output)
            || !is_opaque_id(&command.workspace)
        {
            return rejected(
                ctx.request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OPAQUE_ID,
            );
        }
        if command.output != ctx.request.domain.output
            || command.workspace != ctx.request.domain.workspace
        {
            return rejected(
                ctx.request.correlation_id.clone(),
                "cross-domain-mismatch",
                MSG_CROSS_DOMAIN,
            );
        }
        let Some(admitted) = ctx
            .request
            .windows
            .iter()
            .find(|w| w.window == command.window)
        else {
            return rejected(
                ctx.request.correlation_id.clone(),
                "partial-observation",
                MSG_OBSERVATION,
            );
        };
        if admitted.output != command.output || admitted.workspace != command.workspace {
            return rejected(
                ctx.request.correlation_id.clone(),
                "partial-observation",
                MSG_OBSERVATION,
            );
        };
        let placement_explicit = match &command.placement_bounds {
            Some(rect) => {
                if !valid_carried_rect(rect.x, rect.y, rect.w, rect.h) {
                    return rejected(
                        ctx.request.correlation_id.clone(),
                        "snapshot-invalid",
                        MSG_OBSERVATION,
                    );
                }
                Some(Rect {
                    x: rect.x,
                    y: rect.y,
                    w: rect.w,
                    h: rect.h,
                })
            }
            None => None,
        };
        let seed_order = spatial_with_focus_last(
            ctx.request
                .windows
                .iter()
                .filter(|w| w.window != command.window)
                .cloned()
                .collect(),
            &ctx.request.focused_window,
        );
        let window = WindowId(command.window.clone());
        let output = OutputId(command.output.clone());
        let workspace = WorkspaceId(command.workspace.clone());
        let domain = ctx.domain.clone();
        self.run_retained(
            ctx,
            seed_order,
            false,
            |session, observation| {
                let placement =
                    placement_explicit.unwrap_or_else(|| seed_target_bounds(session, &domain));
                session.propose(
                    &SessionCommand::Admit {
                        window: window.clone(),
                        output: output.clone(),
                        workspace: workspace.clone(),
                        exceptions: ExceptionFlags::none(),
                        exception_behavior: None,
                        placement_bounds: placement,
                    },
                    observation,
                    &ctx.correlation,
                    &LifecycleCapabilities::full(),
                )
            },
            |plan| {
                planned_reply(
                    &ctx.request.correlation_id,
                    plan.dispatch.base_revision,
                    serde_json::json!({
                        "kind": "admit",
                        "policy_version": plan.dispatch.policy_version,
                        "capability": "admit-tiled",
                    }),
                    &plan.desired_geometry,
                    match (&plan.desired_focus_domain, &plan.desired_focus_leaf) {
                        (Some(d), Some(l)) => Some((d, l)),
                        _ => None,
                    },
                )
            },
            |session, plan, c, base| {
                if !acknowledge(session, c, base) {
                    return false;
                }
                let post = crate::contract::LifecyclePostObservation::new(
                    Observation::new(
                        c.owner.clone(),
                        c.generation.clone(),
                        base,
                        c.request.fingerprint,
                    ),
                    c.correlation.clone(),
                    true,
                    plan.dispatch.preconditions.clone(),
                    plan.dispatch.operation.clone(),
                );
                session.verify_lifecycle(&post).is_ok()
            },
        )
    }

    fn evaluate_remove_retained(&mut self, ctx: &Validated) -> String {
        let command: RemoveCommand = match serde_json::from_value(ctx.request.command.clone()) {
            Ok(command) => command,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        if command.op != "remove" || !is_opaque_id(&command.window) {
            return rejected(
                ctx.request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OPAQUE_ID,
            );
        }
        let seed_order =
            spatial_with_focus_last(ctx.request.windows.clone(), &ctx.request.focused_window);
        let window = WindowId(command.window.clone());
        self.run_retained(
            ctx,
            seed_order,
            false,
            |session, observation| {
                session.propose(
                    &SessionCommand::Remove {
                        window: window.clone(),
                    },
                    observation,
                    &ctx.correlation,
                    &LifecycleCapabilities::full(),
                )
            },
            |plan| {
                planned_reply(
                    &ctx.request.correlation_id,
                    plan.dispatch.base_revision,
                    serde_json::json!({
                        "kind": "remove",
                        "policy_version": plan.dispatch.policy_version,
                        "capability": "remove-tiled",
                    }),
                    &plan.desired_geometry,
                    match (&plan.desired_focus_domain, &plan.desired_focus_leaf) {
                        (Some(d), Some(l)) => Some((d, l)),
                        _ => None,
                    },
                )
            },
            |session, plan, c, base| {
                if !acknowledge(session, c, base) {
                    return false;
                }
                let post = crate::contract::LifecyclePostObservation::new(
                    Observation::new(
                        c.owner.clone(),
                        c.generation.clone(),
                        base,
                        c.request.fingerprint,
                    ),
                    c.correlation.clone(),
                    true,
                    plan.dispatch.preconditions.clone(),
                    plan.dispatch.operation.clone(),
                );
                session.verify_lifecycle(&post).is_ok()
            },
        )
    }

    fn evaluate_move_retained(&mut self, ctx: &Validated) -> String {
        let command: DirectedCommand = match serde_json::from_value(ctx.request.command.clone()) {
            Ok(command) => command,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        if command.op != "move" || !is_opaque_id(&command.window) {
            return rejected(
                ctx.request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OPAQUE_ID,
            );
        }
        let Some(direction) = parse_direction(&command.direction) else {
            return rejected(
                ctx.request.correlation_id.clone(),
                "direction-invalid",
                MSG_DIRECTION,
            );
        };
        let seed_order =
            spatial_with_focus_last(ctx.request.windows.clone(), &ctx.request.focused_window);
        let window = WindowId(command.window.clone());
        self.run_retained(
            ctx,
            seed_order,
            true,
            |session, observation| {
                session.propose_move(
                    &ctx.domain_key,
                    &window,
                    direction,
                    observation,
                    &ctx.correlation,
                    &Capabilities::full(),
                )
            },
            |plan| {
                planned_reply(
                    &ctx.request.correlation_id,
                    plan.dispatch.base_revision,
                    serde_json::json!({
                        "kind": "move",
                        "rule": format!("{:?}", plan.dispatch.rule),
                        "capability": format!("{:?}", plan.dispatch.required_capability),
                        "direction": direction_str(direction),
                    }),
                    &plan.desired_geometry,
                    Some((&plan.desired_focus_domain, &plan.desired_focus_leaf)),
                )
            },
            |session, plan, c, base| {
                if !acknowledge(session, c, base) {
                    return false;
                }
                let post = crate::contract::PostObservation::new(
                    Observation::new(
                        c.owner.clone(),
                        c.generation.clone(),
                        base,
                        c.request.fingerprint,
                    ),
                    c.correlation.clone(),
                    true,
                    plan.dispatch.preconditions.clone(),
                    plan.dispatch.operation.clone(),
                );
                session.verify_move(&post).is_ok()
            },
        )
    }

    fn evaluate_focus_retained(&mut self, ctx: &Validated) -> String {
        let command: DirectedCommand = match serde_json::from_value(ctx.request.command.clone()) {
            Ok(command) => command,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        if command.op != "focus" || !is_opaque_id(&command.window) {
            return rejected(
                ctx.request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OPAQUE_ID,
            );
        }
        let Some(direction) = parse_direction(&command.direction) else {
            return rejected(
                ctx.request.correlation_id.clone(),
                "direction-invalid",
                MSG_DIRECTION,
            );
        };
        let seed_order =
            spatial_with_focus_last(ctx.request.windows.clone(), &ctx.request.focused_window);
        let window = WindowId(command.window.clone());
        self.run_retained(
            ctx,
            seed_order,
            true,
            |session, observation| {
                session.propose_focus(
                    &ctx.domain_key,
                    &window,
                    direction,
                    observation,
                    &ctx.correlation,
                    &FocusCapabilities::full(),
                )
            },
            |plan| {
                planned_reply(
                    &ctx.request.correlation_id,
                    plan.dispatch.base_revision,
                    serde_json::json!({
                        "kind": "focus",
                        "capability": "directional-focus",
                        "direction": direction_str(direction),
                        "to_window": plan.dispatch.operation.to_window.0,
                    }),
                    &plan.desired_geometry,
                    Some((&plan.desired_focus_domain, &plan.desired_focus_leaf)),
                )
            },
            |session, plan, c, base| {
                if !acknowledge(session, c, base) {
                    return false;
                }
                let post = crate::contract::FocusPostObservation::new(
                    Observation::new(
                        c.owner.clone(),
                        c.generation.clone(),
                        base,
                        c.request.fingerprint,
                    ),
                    c.correlation.clone(),
                    true,
                    plan.dispatch.preconditions.clone(),
                    plan.dispatch.operation.clone(),
                );
                session.verify_focus(&post).is_ok()
            },
        )
    }

    fn evaluate_resize_retained(&mut self, ctx: &Validated) -> String {
        let command: ResizeCommand = match serde_json::from_value(ctx.request.command.clone()) {
            Ok(command) => command,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        if command.op != "resize" || !is_opaque_id(&command.window) {
            return rejected(
                ctx.request.correlation_id.clone(),
                "snapshot-invalid",
                MSG_OPAQUE_ID,
            );
        }
        let Some(direction) = parse_direction(&command.direction) else {
            return rejected(
                ctx.request.correlation_id.clone(),
                "direction-invalid",
                MSG_DIRECTION,
            );
        };
        let Some(mode) = parse_mode(&command.mode) else {
            return rejected(
                ctx.request.correlation_id.clone(),
                "direction-invalid",
                MSG_DIRECTION,
            );
        };
        let seed_order =
            spatial_with_focus_last(ctx.request.windows.clone(), &ctx.request.focused_window);
        let window = WindowId(command.window.clone());
        let capabilities = crate::contract::ResizeCapabilities {
            keyboard_resize: true,
            pointer_resize: false,
        };
        self.run_retained(
            ctx,
            seed_order,
            true,
            |session, observation| {
                session.propose_resize(
                    &ctx.domain_key,
                    &window,
                    direction,
                    mode,
                    command.press_index,
                    observation,
                    &ctx.correlation,
                    &capabilities,
                )
            },
            |plan| {
                planned_reply(
                    &ctx.request.correlation_id,
                    plan.dispatch.base_revision,
                    serde_json::json!({
                        "kind": "resize",
                        "capability": "keyboard-resize",
                        "direction": direction_str(direction),
                        "mode": mode.as_str(),
                        "target_group": plan.dispatch.operation.target_group.0,
                        "focused_index": plan.dispatch.operation.focused_index,
                        "neighbor_index": plan.dispatch.operation.neighbor_index,
                        "old_shares": plan.dispatch.operation.old_shares,
                        "new_shares": plan.dispatch.operation.new_shares,
                    }),
                    &plan.desired_geometry,
                    Some((&plan.desired_focus_domain, &plan.desired_focus_leaf)),
                )
            },
            |session, plan, c, base| {
                if !acknowledge(session, c, base) {
                    return false;
                }
                let post = crate::contract::ResizePostObservation::new(
                    Observation::new(
                        c.owner.clone(),
                        c.generation.clone(),
                        base,
                        c.request.fingerprint,
                    ),
                    c.correlation.clone(),
                    true,
                    plan.dispatch.preconditions.clone(),
                    plan.dispatch.operation.clone(),
                );
                session.verify_resize(&post).is_ok()
            },
        )
    }
}

/// Strict stateless Planner evaluation. Always returns a bounded reply:
/// `planned` with full target geometries plus retained focus, or recoverable
/// `rejected` with a bounded kind. Never retains state, so fresh observations
/// recover after any rejection.
pub fn evaluate_plan_json(request_json: &str) -> String {
    let ctx = match validate_request(request_json) {
        Ok(ctx) => ctx,
        Err(reply) => return reply,
    };
    match validated_op(&ctx).as_str() {
        "admit" => evaluate_admit(&ctx),
        "remove" => evaluate_remove(&ctx),
        "move" => evaluate_move(&ctx),
        "focus" => evaluate_focus(&ctx),
        "resize" => evaluate_resize(&ctx),
        _ => rejected(
            valid_correlation_echo(&ctx.raw),
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

fn evaluate_admit(ctx: &Validated) -> String {
    let command: AdmitCommand = match serde_json::from_value(ctx.request.command.clone()) {
        Ok(command) => command,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(valid_correlation_echo(&ctx.raw), kind, message);
        }
    };
    if command.op != "admit"
        || !is_opaque_id(&command.window)
        || !is_opaque_id(&command.output)
        || !is_opaque_id(&command.workspace)
    {
        return rejected(
            ctx.request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OPAQUE_ID,
        );
    }
    if command.output != ctx.request.domain.output
        || command.workspace != ctx.request.domain.workspace
    {
        return rejected(
            ctx.request.correlation_id.clone(),
            "cross-domain-mismatch",
            MSG_CROSS_DOMAIN,
        );
    }
    let Some(admitted) = ctx
        .request
        .windows
        .iter()
        .find(|w| w.window == command.window)
    else {
        return rejected(
            ctx.request.correlation_id.clone(),
            "partial-observation",
            MSG_OBSERVATION,
        );
    };
    if admitted.output != command.output || admitted.workspace != command.workspace {
        return rejected(
            ctx.request.correlation_id.clone(),
            "partial-observation",
            MSG_OBSERVATION,
        );
    }
    let base: Vec<ObservedDto> = ctx
        .request
        .windows
        .iter()
        .filter(|w| w.window != command.window)
        .cloned()
        .collect();
    let Some(seed_order) = spatial_with_focus_last(base, &ctx.request.focused_window) else {
        return rejected(
            ctx.request.correlation_id.clone(),
            "ambiguous-placement",
            MSG_AMBIGUOUS,
        );
    };
    let Some(mut session) = seed_session(
        &ctx.owner,
        &ctx.generation,
        ctx.request.fingerprint,
        &ctx.domain,
        &seed_order,
    ) else {
        return rejected(
            ctx.request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        );
    };
    let placement = match command.placement_bounds {
        Some(rect) => {
            if !valid_carried_rect(rect.x, rect.y, rect.w, rect.h) {
                return rejected(
                    ctx.request.correlation_id.clone(),
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
        // No explicit target geometry (the KWin adapter sends none): split
        // the rebuild target, never the admitted window's own rect, so a
        // landscape observed rect on a portrait output cannot select a
        // left/right split (and vice versa).
        None => seed_target_bounds(&session, &ctx.domain),
    };
    let base_revision = session.accepted_revision();
    let observation = observation_for(base_revision, ctx);
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
        &ctx.correlation,
        &LifecycleCapabilities::full(),
    ) {
        Ok(plan) => planned_reply(
            &ctx.request.correlation_id,
            plan.dispatch.base_revision,
            serde_json::json!({
                "kind": "admit",
                "policy_version": plan.dispatch.policy_version,
                "capability": "admit-tiled",
            }),
            &plan.desired_geometry,
            match (&plan.desired_focus_domain, &plan.desired_focus_leaf) {
                (Some(d), Some(l)) => Some((d, l)),
                _ => None,
            },
        ),
        Err(error) => propose_failure(error, ctx.request.correlation_id.clone()),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RemoveCommand {
    op: String,
    window: String,
}

fn evaluate_remove(ctx: &Validated) -> String {
    let command: RemoveCommand = match serde_json::from_value(ctx.request.command.clone()) {
        Ok(command) => command,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(valid_correlation_echo(&ctx.raw), kind, message);
        }
    };
    if command.op != "remove" || !is_opaque_id(&command.window) {
        return rejected(
            ctx.request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OPAQUE_ID,
        );
    }
    let Some(seed_order) =
        spatial_with_focus_last(ctx.request.windows.clone(), &ctx.request.focused_window)
    else {
        return rejected(
            ctx.request.correlation_id.clone(),
            "ambiguous-placement",
            MSG_AMBIGUOUS,
        );
    };
    let Some(mut session) = seed_session(
        &ctx.owner,
        &ctx.generation,
        ctx.request.fingerprint,
        &ctx.domain,
        &seed_order,
    ) else {
        return rejected(
            ctx.request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        );
    };
    let base_revision = session.accepted_revision();
    let observation = observation_for(base_revision, ctx);
    let session_command = SessionCommand::Remove {
        window: WindowId(command.window.clone()),
    };
    match session.propose(
        &session_command,
        &observation,
        &ctx.correlation,
        &LifecycleCapabilities::full(),
    ) {
        Ok(plan) => planned_reply(
            &ctx.request.correlation_id,
            plan.dispatch.base_revision,
            serde_json::json!({
                "kind": "remove",
                "policy_version": plan.dispatch.policy_version,
                "capability": "remove-tiled",
            }),
            &plan.desired_geometry,
            match (&plan.desired_focus_domain, &plan.desired_focus_leaf) {
                (Some(d), Some(l)) => Some((d, l)),
                _ => None,
            },
        ),
        Err(error) => propose_failure(error, ctx.request.correlation_id.clone()),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct DirectedCommand {
    op: String,
    window: String,
    direction: String,
}

fn build_full_session(ctx: &Validated) -> Option<(Session, SessionObservation)> {
    let seed_order =
        spatial_with_focus_last(ctx.request.windows.clone(), &ctx.request.focused_window)?;
    let session = seed_session(
        &ctx.owner,
        &ctx.generation,
        ctx.request.fingerprint,
        &ctx.domain,
        &seed_order,
    )?;
    let base_revision = session.accepted_revision();
    let observation = observation_for(base_revision, ctx);
    Some((session, observation))
}

fn evaluate_move(ctx: &Validated) -> String {
    let command: DirectedCommand = match serde_json::from_value(ctx.request.command.clone()) {
        Ok(command) => command,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(valid_correlation_echo(&ctx.raw), kind, message);
        }
    };
    if command.op != "move" || !is_opaque_id(&command.window) {
        return rejected(
            ctx.request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OPAQUE_ID,
        );
    }
    let Some(direction) = parse_direction(&command.direction) else {
        return rejected(
            ctx.request.correlation_id.clone(),
            "direction-invalid",
            MSG_DIRECTION,
        );
    };
    let Some((mut session, observation)) = build_full_session(ctx) else {
        return rejected(
            ctx.request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        );
    };
    match session.propose_move(
        &ctx.domain_key,
        &WindowId(command.window.clone()),
        direction,
        &observation,
        &ctx.correlation,
        &Capabilities::full(),
    ) {
        Ok(plan) => planned_reply(
            &ctx.request.correlation_id,
            plan.dispatch.base_revision,
            serde_json::json!({
                "kind": "move",
                "rule": format!("{:?}", plan.dispatch.rule),
                "capability": format!("{:?}", plan.dispatch.required_capability),
                "direction": direction_str(direction),
            }),
            &plan.desired_geometry,
            Some((&plan.desired_focus_domain, &plan.desired_focus_leaf)),
        ),
        Err(error) => propose_failure(error, ctx.request.correlation_id.clone()),
    }
}

fn evaluate_focus(ctx: &Validated) -> String {
    let command: DirectedCommand = match serde_json::from_value(ctx.request.command.clone()) {
        Ok(command) => command,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(valid_correlation_echo(&ctx.raw), kind, message);
        }
    };
    if command.op != "focus" || !is_opaque_id(&command.window) {
        return rejected(
            ctx.request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OPAQUE_ID,
        );
    }
    let Some(direction) = parse_direction(&command.direction) else {
        return rejected(
            ctx.request.correlation_id.clone(),
            "direction-invalid",
            MSG_DIRECTION,
        );
    };
    let Some((mut session, observation)) = build_full_session(ctx) else {
        return rejected(
            ctx.request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        );
    };
    match session.propose_focus(
        &ctx.domain_key,
        &WindowId(command.window.clone()),
        direction,
        &observation,
        &ctx.correlation,
        &FocusCapabilities::full(),
    ) {
        Ok(plan) => planned_reply(
            &ctx.request.correlation_id,
            plan.dispatch.base_revision,
            serde_json::json!({
                "kind": "focus",
                "capability": "directional-focus",
                "direction": direction_str(direction),
                "to_window": plan.dispatch.operation.to_window.0,
            }),
            &plan.desired_geometry,
            Some((&plan.desired_focus_domain, &plan.desired_focus_leaf)),
        ),
        Err(error) => propose_failure(error, ctx.request.correlation_id.clone()),
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

fn evaluate_resize(ctx: &Validated) -> String {
    let command: ResizeCommand = match serde_json::from_value(ctx.request.command.clone()) {
        Ok(command) => command,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(valid_correlation_echo(&ctx.raw), kind, message);
        }
    };
    if command.op != "resize" || !is_opaque_id(&command.window) {
        return rejected(
            ctx.request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OPAQUE_ID,
        );
    }
    let Some(direction) = parse_direction(&command.direction) else {
        return rejected(
            ctx.request.correlation_id.clone(),
            "direction-invalid",
            MSG_DIRECTION,
        );
    };
    let Some(mode) = parse_mode(&command.mode) else {
        return rejected(
            ctx.request.correlation_id.clone(),
            "direction-invalid",
            MSG_DIRECTION,
        );
    };
    let Some((mut session, observation)) = build_full_session(ctx) else {
        return rejected(
            ctx.request.correlation_id.clone(),
            "snapshot-invalid",
            MSG_OBSERVATION,
        );
    };
    let capabilities = crate::contract::ResizeCapabilities {
        keyboard_resize: true,
        pointer_resize: false,
    };
    match session.propose_resize(
        &ctx.domain_key,
        &WindowId(command.window.clone()),
        direction,
        mode,
        command.press_index,
        &observation,
        &ctx.correlation,
        &capabilities,
    ) {
        Ok(plan) => planned_reply(
            &ctx.request.correlation_id,
            plan.dispatch.base_revision,
            serde_json::json!({
                "kind": "resize",
                "capability": "keyboard-resize",
                "direction": direction_str(direction),
                "mode": mode.as_str(),
                "target_group": plan.dispatch.operation.target_group.0,
                "focused_index": plan.dispatch.operation.focused_index,
                "neighbor_index": plan.dispatch.operation.neighbor_index,
                "old_shares": plan.dispatch.operation.old_shares,
                "new_shares": plan.dispatch.operation.new_shares,
            }),
            &plan.desired_geometry,
            Some((&plan.desired_focus_domain, &plan.desired_focus_leaf)),
        ),
        Err(error) => propose_failure(error, ctx.request.correlation_id.clone()),
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

    /// Admit request with explicit domain bounds and per-window rects, so
    /// portrait/landscape/square targets can carry deliberately misleading
    /// (opposite-orientation) observed window geometry.
    fn custom_request(
        correlation: &str,
        focused: &str,
        domain_rect: (i32, i32, i32, i32),
        windows: &[(&str, i32, i32, i32, i32)],
        command: serde_json::Value,
    ) -> String {
        let entries: Vec<serde_json::Value> = windows
            .iter()
            .map(|(window, x, y, w, h)| {
                serde_json::json!({
                    "window": window,
                    "output": "out-1",
                    "workspace": "ws-1",
                    "rect": {"x": x, "y": y, "w": w, "h": h},
                })
            })
            .collect();
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
                "bounds": {"x": domain_rect.0, "y": domain_rect.1, "w": domain_rect.2, "h": domain_rect.3},
                "gap": 0,
            },
            "focused_window": focused,
            "windows": entries,
            "command": command,
        })
        .to_string()
    }

    fn geometry_rects(reply: &serde_json::Value) -> Vec<(i32, i32, i32, i32)> {
        let mut rects: Vec<(i32, i32, i32, i32)> = reply["desired_geometry"]
            .as_array()
            .expect("planned geometry present")
            .iter()
            .map(|entry| {
                let rect = &entry["rect"];
                (
                    rect["x"].as_i64().unwrap() as i32,
                    rect["y"].as_i64().unwrap() as i32,
                    rect["w"].as_i64().unwrap() as i32,
                    rect["h"].as_i64().unwrap() as i32,
                )
            })
            .collect();
        rects.sort();
        rects
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
    fn admit_portrait_output_splits_top_bottom_despite_landscape_rects() {
        // D1: the split axis derives from the rebuild target (here the full
        // portrait output), never from the admitted window's own observed
        // rect. Both observed rects are landscape, which must not select a
        // left/right split on this portrait output.
        let request = custom_request(
            "admit-portrait-1",
            "win-1",
            (0, 0, 800, 1200),
            &[("win-1", 0, 0, 400, 300), ("win-2", 400, 300, 400, 300)],
            serde_json::json!({
                "op": "admit",
                "window": "win-2",
                "output": "out-1",
                "workspace": "ws-1",
            }),
        );
        let reply = parse_reply(&evaluate_plan_json(&request));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
        assert_eq!(
            geometry_rects(&reply),
            vec![(0, 0, 800, 600), (0, 600, 800, 600)],
            "{reply}"
        );
    }

    #[test]
    fn admit_landscape_output_splits_left_right_despite_portrait_rects() {
        // Converse of D1: portrait observed rects must not select a
        // top/bottom split on a landscape output.
        let request = custom_request(
            "admit-landscape-1",
            "win-1",
            (0, 0, 1200, 800),
            &[("win-1", 0, 0, 300, 400), ("win-2", 300, 400, 300, 400)],
            serde_json::json!({
                "op": "admit",
                "window": "win-2",
                "output": "out-1",
                "workspace": "ws-1",
            }),
        );
        let reply = parse_reply(&evaluate_plan_json(&request));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
        assert_eq!(
            geometry_rects(&reply),
            vec![(0, 0, 600, 800), (600, 0, 600, 800)],
            "{reply}"
        );
    }

    #[test]
    fn admit_square_tie_splits_top_bottom() {
        // Exact-square tie selects Vertical (top/bottom stacking). This keeps
        // the COSMIC tall/tied-to-portable-Vertical rule and the historic tie
        // direction deterministic; a square output has no wider axis, so the
        // choice is stacking rather than side-by-side.
        let request = custom_request(
            "admit-square-1",
            "win-1",
            (0, 0, 500, 500),
            &[("win-1", 0, 0, 200, 100), ("win-2", 200, 100, 200, 100)],
            serde_json::json!({
                "op": "admit",
                "window": "win-2",
                "output": "out-1",
                "workspace": "ws-1",
            }),
        );
        let reply = parse_reply(&evaluate_plan_json(&request));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
        assert_eq!(
            geometry_rects(&reply),
            vec![(0, 0, 500, 250), (0, 250, 500, 250)],
            "{reply}"
        );
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

    fn retained_request(
        correlation: &str,
        owner: &str,
        generation: &str,
        focused: &str,
        windows: &[(&str, i32, i32, i32, i32)],
        command: serde_json::Value,
    ) -> String {
        let entries: Vec<serde_json::Value> = windows
            .iter()
            .map(|(window, x, y, w, h)| {
                serde_json::json!({
                    "window": window,
                    "output": "out-1",
                    "workspace": "ws-1",
                    "rect": {"x": x, "y": y, "w": w, "h": h},
                })
            })
            .collect();
        serde_json::json!({
            "v": 1,
            "correlation_id": correlation,
            "owner": owner,
            "generation": generation,
            "revision": 0,
            "fingerprint": 7,
            "domain": {
                "output": "out-1",
                "workspace": "ws-1",
                "bounds": {"x": 0, "y": 0, "w": 1200, "h": 800},
                "gap": 0,
            },
            "focused_window": focused,
            "windows": entries,
            "command": command,
        })
        .to_string()
    }

    fn admit_body(window: &str) -> serde_json::Value {
        serde_json::json!({
            "op": "admit",
            "window": window,
            "output": "out-1",
            "workspace": "ws-1",
        })
    }

    #[test]
    fn retained_equal_non_focused_rects_plan_after_initial() {
        // D4: after the initial plan the domain topology is retained, so equal
        // non-focused rectangles no longer force `ambiguous-placement`.
        let mut planner = Planner::new();
        for (correlation, focused, windows, command) in [
            (
                "d4-equal-1",
                "win-1",
                vec![("win-1", 0, 0, 100, 80)],
                admit_body("win-1"),
            ),
            (
                "d4-equal-2",
                "win-1",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                admit_body("win-2"),
            ),
            (
                "d4-equal-3",
                "win-1",
                vec![
                    ("win-1", 0, 0, 100, 80),
                    ("win-2", 200, 0, 100, 80),
                    ("win-3", 400, 0, 100, 80),
                ],
                admit_body("win-3"),
            ),
        ] {
            let request =
                retained_request(correlation, "owner-1", "gen-1", focused, &windows, command);
            let reply = parse_reply(&planner.evaluate(&request));
            assert_eq!(reply["outcome"], "planned", "{reply}");
        }
        assert_eq!(planner.retained_domains(), 1);
        // Two non-focused windows share an exact frame; the stateless rebuild
        // path must still reject this as ambiguous (the D4 root).
        let ambiguous = retained_request(
            "d4-equal-4",
            "owner-1",
            "gen-1",
            "win-1",
            &[
                ("win-1", 0, 0, 100, 80),
                ("win-2", 200, 0, 100, 80),
                ("win-3", 200, 0, 100, 80),
            ],
            serde_json::json!({"op": "remove", "window": "win-3"}),
        );
        let stateless = parse_reply(&evaluate_plan_json(&ambiguous));
        assert_eq!(stateless["outcome"], "rejected", "{stateless}");
        assert_eq!(stateless["kind"], "ambiguous-placement", "{stateless}");
        // Retained state proposes directly from membership, so it plans.
        let retained = parse_reply(&planner.evaluate(&ambiguous));
        assert_eq!(retained["outcome"], "planned", "{retained}");
        assert_geometry_covers(&retained, &["win-1", "win-2"]);
        assert_eq!(planner.retained_domains(), 1);
    }

    #[test]
    fn retained_generation_change_discards_and_rebuilds() {
        // D4 recovery: owner/generation change (adapter restart) discards all
        // retained domains and rebuilds once from the fresh observation.
        let mut planner = Planner::new();
        let first = retained_request(
            "d4-gen-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            admit_body("win-1"),
        );
        assert_eq!(parse_reply(&planner.evaluate(&first))["outcome"], "planned");
        let second = retained_request(
            "d4-gen-2",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            admit_body("win-2"),
        );
        assert_eq!(
            parse_reply(&planner.evaluate(&second))["outcome"],
            "planned"
        );
        assert_eq!(planner.retained_domains(), 1);
        // New generation carries only win-1/win-2 with distinct frames: the
        // rebuild must succeed and must not leak gen-1 windows.
        let restarted = retained_request(
            "d4-gen-3",
            "owner-1",
            "gen-2",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            admit_body("win-2"),
        );
        let reply = parse_reply(&planner.evaluate(&restarted));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
        assert_eq!(planner.retained_domains(), 1);
        // Follow-up under the new generation still plans (no stale gen-1).
        let follow = retained_request(
            "d4-gen-4",
            "owner-1",
            "gen-2",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "remove", "window": "win-2"}),
        );
        let follow_reply = parse_reply(&planner.evaluate(&follow));
        assert_eq!(follow_reply["outcome"], "planned", "{follow_reply}");
        assert_geometry_covers(&follow_reply, &["win-1"]);
    }

    #[test]
    fn retained_divergence_discards_and_rebuilds_once() {
        // D4 recovery: membership divergence discards the domain and rebuilds
        // once; the rebuilt topology then commits so later calls stay live.
        let mut planner = Planner::new();
        for (correlation, windows, command) in [
            (
                "d4-div-1",
                vec![("win-1", 0, 0, 100, 80)],
                admit_body("win-1"),
            ),
            (
                "d4-div-2",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                admit_body("win-2"),
            ),
        ] {
            let request =
                retained_request(correlation, "owner-1", "gen-1", "win-1", &windows, command);
            assert_eq!(
                parse_reply(&planner.evaluate(&request))["outcome"],
                "planned"
            );
        }
        // win-2 vanished externally; retained {win-1,win-2} diverges, rebuilds
        // from {win-1} plus the admitted win-3.
        let divergent = retained_request(
            "d4-div-3",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-3", 400, 0, 100, 80)],
            admit_body("win-3"),
        );
        let reply = parse_reply(&planner.evaluate(&divergent));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-3"]);
        // Committed rebuild: a follow-up remove plans without wedging.
        let follow = retained_request(
            "d4-div-4",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-3", 400, 0, 100, 80)],
            serde_json::json!({"op": "remove", "window": "win-3"}),
        );
        let follow_reply = parse_reply(&planner.evaluate(&follow));
        assert_eq!(follow_reply["outcome"], "planned", "{follow_reply}");
        assert_geometry_covers(&follow_reply, &["win-1"]);
    }

    #[test]
    fn retained_rejects_when_safe_rebuild_is_impossible() {
        // D4 fail-closed: when no retained topology exists and the observation
        // cannot safely infer one (equal non-focused rects), reject rather
        // than wedge; the next fresh observation still recovers.
        let mut planner = Planner::new();
        let ambiguous = retained_request(
            "d4-reject-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[
                ("win-1", 0, 0, 100, 80),
                ("win-2", 200, 0, 100, 80),
                ("win-3", 200, 0, 100, 80),
            ],
            serde_json::json!({"op": "remove", "window": "win-3"}),
        );
        let reply = parse_reply(&planner.evaluate(&ambiguous));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "ambiguous-placement", "{reply}");
        assert_eq!(planner.retained_domains(), 0);
        let valid = retained_request(
            "d4-reject-2",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "remove", "window": "win-2"}),
        );
        // Rebuild from the distinct observation succeeds: no wedge.
        // Note: no retained base exists, so this rebuilds {win-1,win-2} then
        // removes win-2.
        let valid_reply = parse_reply(&planner.evaluate(&valid));
        assert_eq!(valid_reply["outcome"], "planned", "{valid_reply}");
        assert_geometry_covers(&valid_reply, &["win-1"]);
        // Divergence that rebuilds to an ambiguous base also rejects.
        let mut planner2 = Planner::new();
        let seed = retained_request(
            "d4-reject-3",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            admit_body("win-1"),
        );
        assert_eq!(parse_reply(&planner2.evaluate(&seed))["outcome"], "planned");
        let seed2 = retained_request(
            "d4-reject-4",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            admit_body("win-2"),
        );
        assert_eq!(
            parse_reply(&planner2.evaluate(&seed2))["outcome"],
            "planned"
        );
        let divergent_ambiguous = retained_request(
            "d4-reject-5",
            "owner-1",
            "gen-1",
            "win-1",
            &[
                ("win-1", 0, 0, 100, 80),
                ("win-2", 200, 0, 100, 80),
                ("win-3", 200, 0, 100, 80),
                ("win-4", 400, 0, 100, 80),
            ],
            admit_body("win-4"),
        );
        let bad = parse_reply(&planner2.evaluate(&divergent_ambiguous));
        assert_eq!(bad["outcome"], "rejected", "{bad}");
        assert_eq!(bad["kind"], "ambiguous-placement", "{bad}");
        // Still recoverable afterwards.
        let recover = retained_request(
            "d4-reject-6",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "remove", "window": "win-2"}),
        );
        let recovered = parse_reply(&planner2.evaluate(&recover));
        assert_eq!(recovered["outcome"], "planned", "{recovered}");
    }
}
