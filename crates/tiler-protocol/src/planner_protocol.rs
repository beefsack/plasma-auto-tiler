//! Bounded Planner protocol (Stage 4, product-shaped, static only).
//!
//! Pure JSON-string-in / JSON-string-out evaluation. Rust owns all policy:
//! the complete normalized current observation (opaque adapter ids, frame
//! rectangles, output, workspace, focus) plus one parameterized command
//! proposes exactly that command through the existing
//! session/reconciler/directional/cosmic_v1 APIs ([`tiler_core::cosmic_v1`]
//! admission axis/shares, no invented tiling semantics).
//!
//! [`Planner`] is the authoritative live-tree route (one
//! committed session per domain across calls; observations validate
//! membership/divergence but never rebuild known topology). Recovery is a
//! single rule: discard and rebuild once on owner/generation, domain, or
//! membership divergence, else reject rather than wedge. Every rejection maps
//! to a bounded recoverable `rejected` outcome (never terminal `diverged`),
//! so a fresh observation can always recover after any rejection. Native
//! execution stays outside: replies carry full target geometries plus
//! retained focus for the adapter to actuate.
//!
//! Workspace send route (standalone, dev-only): the `send-to-workspace`
//! operation carries a same-output distinct-workspace target as an optional
//! `target_domain` plus `target_windows` alongside the source `domain`/
//! `windows`. It proposes once and retains one pending two-domain Session
//! (owner/generation/correlation/base-revision bound) until an exact accepted
//! `send-to-workspace-ack` and a matching verified `send-to-workspace-verify`
//! post-observation commit it. No owner rebind during pending; pending
//! mismatch, loss, refused ack, or failed verification is terminal
//! `diverged` with no Legacy fallback. Legacy requests are unchanged. A
//! read-only `send-to-workspace-status` query classifies the retained
//! transaction against a fresh complete observation without mutating,
//! acknowledging, verifying, rebinding, or advancing anything.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use tiler_core::contract::{
    AckOutcome, AdapterAck, FocusCapabilities, LifecycleCapabilities, LifecycleOperation,
    LifecyclePostObservation, LifecyclePrecondition, Observation,
};
use tiler_core::directional::{
    Axis, Capabilities, Direction, Node, NodeId, OutputId, WindowId, WindowLink, WorkspaceId,
};
use tiler_core::geometry::{Rect, project};
use tiler_core::ids::{CorrelationId, GenerationId, OwnerId};
use tiler_core::reconcile::{AckError, CancelUnackedError, VerifyError};
use tiler_core::session::{
    DesiredGeometry, DomainKey, ExceptionFlags, ObservedWindow, OutputDomain, ProposeError,
    RefusalKind, Session, SessionCommand, SessionObservation, SessionPlan,
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

/// Canonical production directional fingerprint (FNV-1a 32-bit) over the
/// full two-domain evidence, byte-identical to the adapter's
/// `planDirectionalFingerprint`: ordered domain primitives (output,
/// workspace, raw bounds, gaps, left/right adjacency), the focused id, and
/// every window sorted by id (id, output, workspace, rect, floating,
/// fit-excluded). Any alteration of target rect, bounds, or adjacency
/// changes the value. Legacy single-domain requests keep `planFingerprint`.
fn directional_fingerprint(
    entries: &[DirectionalDomainDto],
    focused: &str,
    windows: &[ObservedDto],
) -> u64 {
    fn feed(hash: &mut u32, text: &str) {
        for byte in text.bytes() {
            *hash ^= u32::from(byte);
            *hash = hash.wrapping_mul(16777619);
        }
    }
    fn sep(hash: &mut u32, byte: u8) {
        *hash ^= u32::from(byte);
        *hash = hash.wrapping_mul(16777619);
    }
    let mut hash: u32 = 2166136261;
    for (index, entry) in entries.iter().enumerate() {
        if index > 0 {
            sep(&mut hash, 0x1e);
        }
        feed(&mut hash, &entry.output);
        sep(&mut hash, 0x1f);
        feed(&mut hash, &entry.workspace);
        sep(&mut hash, 0x1f);
        feed(&mut hash, &entry.bounds.x.to_string());
        sep(&mut hash, 0x1f);
        feed(&mut hash, &entry.bounds.y.to_string());
        sep(&mut hash, 0x1f);
        feed(&mut hash, &entry.bounds.w.to_string());
        sep(&mut hash, 0x1f);
        feed(&mut hash, &entry.bounds.h.to_string());
        sep(&mut hash, 0x1f);
        feed(&mut hash, &entry.gap.to_string());
        sep(&mut hash, 0x1f);
        feed(&mut hash, &entry.outer_gap.to_string());
        sep(&mut hash, 0x1f);
        feed(&mut hash, "left");
        sep(&mut hash, 0x1f);
        feed(
            &mut hash,
            entry.adjacent.get("left").map(String::as_str).unwrap_or(""),
        );
        sep(&mut hash, 0x1f);
        feed(&mut hash, "right");
        sep(&mut hash, 0x1f);
        feed(
            &mut hash,
            entry
                .adjacent
                .get("right")
                .map(String::as_str)
                .unwrap_or(""),
        );
    }
    sep(&mut hash, 0x1f);
    feed(&mut hash, focused);
    let mut ordered: Vec<&ObservedDto> = windows.iter().collect();
    ordered.sort_by(|a, b| a.window.cmp(&b.window));
    for entry in ordered {
        sep(&mut hash, 0x1f);
        feed(&mut hash, &entry.window);
        sep(&mut hash, 0x1f);
        feed(&mut hash, &entry.output);
        sep(&mut hash, 0x1f);
        feed(&mut hash, &entry.workspace);
        sep(&mut hash, 0x1f);
        feed(&mut hash, &entry.rect.x.to_string());
        sep(&mut hash, 0x1f);
        feed(&mut hash, &entry.rect.y.to_string());
        sep(&mut hash, 0x1f);
        feed(&mut hash, &entry.rect.w.to_string());
        sep(&mut hash, 0x1f);
        feed(&mut hash, &entry.rect.h.to_string());
        sep(&mut hash, 0x1f);
        feed(&mut hash, if entry.floating { "1" } else { "0" });
        sep(&mut hash, 0x1f);
        feed(&mut hash, if entry.fit_excluded { "1" } else { "0" });
    }
    u64::from(hash)
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

fn parse_mode(value: &str) -> Option<tiler_core::contract::ResizeMode> {
    match value {
        "inwards" => Some(tiler_core::contract::ResizeMode::Inwards),
        "outwards" => Some(tiler_core::contract::ResizeMode::Outwards),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
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
    #[serde(default)]
    outer_gap: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct ObservedDto {
    window: String,
    output: String,
    workspace: String,
    rect: RectDto,
    #[serde(default)]
    floating: bool,
    /// Internal fit opt-out carried by the adapter for any floating, sticky,
    /// fullscreen, or maximized snapshot entry. Defaults false so existing
    /// fixtures parse unchanged; any set entry declines fitting while the
    /// normal seed/reflow exception behavior is untouched.
    #[serde(default)]
    fit_excluded: bool,
}

/// Production directional domains payload (DescribePlan active route only).
/// Bounded primitive per domain: output, workspace, work-area bounds, inner
/// and outer gaps, plus horizontal reciprocal adjacency (`left`/`right` to an
/// output name). At most two domains: source first (must equal `domain`),
/// then the horizontally adjacent output's current logical workspace (which
/// may differ in workspace id). Up/Down keys are never admitted.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct DirectionalDomainDto {
    output: String,
    workspace: String,
    bounds: RectDto,
    gap: i32,
    #[serde(default)]
    outer_gap: i32,
    #[serde(default)]
    adjacent: std::collections::BTreeMap<String, String>,
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
    #[serde(default)]
    target_domain: Option<DomainDto>,
    #[serde(default)]
    target_windows: Vec<ObservedDto>,
    /// Production directional cross-output observation: source plus at most
    /// one horizontally reciprocal adjacent domain. Absent for legacy
    /// single-domain requests, whose behavior is unchanged.
    #[serde(default)]
    domains: Option<Vec<DirectionalDomainDto>>,
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
struct FloatReplyBody {
    window: String,
    rect: RectDto,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    float_geometry: Option<FloatReplyBody>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preconditions: Option<Vec<&'static str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation: Option<serde_json::Value>,
}

fn serialize_bounded(reply: &PlanReply) -> String {
    match serde_json::to_string(reply) {
        Ok(text) if text.len() <= PLAN_MAX_REPLY_BYTES => text,
        _ => "{\"v\":1,\"correlation_id\":\"\",\"outcome\":\"rejected\",\"kind\":\"snapshot-invalid\",\"message\":\"snapshot or intent is malformed\"}"
            .to_owned(),
    }
}

/// Bounded redacted DescribePlan summary lines for the normal-level service
/// sink (Planner stderr, captured via the dev `planner-log` pointer into the
/// combined `[planner]` stream).
///
/// These replace the former raw full-JSON trace: a complete request/reply
/// pair carries window ids, frame rectangles, domains, owner, and generation
/// in cleartext, which exceeds every other surface's redaction posture (KWin
/// logs opaque ids at most, never rects, owners, or payload bytes). The
/// summaries below are the only Planner-side record: op/outcome/kind tokens,
/// a validated correlation, bounded integers, and carried-entry counts.
/// Window/native ids, geometry, domains, owner, app/caption/secret data, and
/// raw payloads never appear. Both functions are pure and total over
/// arbitrary input: unparseable or out-of-shape sides degrade to bounded
/// placeholders, so malformed and unauthorized-shaped inputs cannot echo.
pub const PLAN_SUMMARY_PREFIX: &str = "plasma-auto-tiler:plan-summary";

/// Sanitize one free-form token for summary lines: lowercase dashes only,
/// capped at 64 chars, else `unknown`. Mirrors the adapter-side rejection
/// token vocabulary. Never echoes payload bytes.
fn summary_token(raw: Option<&str>) -> String {
    match raw {
        Some(text)
            if !text.is_empty()
                && text.len() <= 64
                && text.bytes().all(|b| b.is_ascii_lowercase() || b == b'-') =>
        {
            text.to_owned()
        }
        _ => "unknown".to_owned(),
    }
}

/// Validated correlation for summary lines, else `-`. Only a well-formed
/// correlation id is ever emitted, so garbage (including unauthorized or
/// malformed requests) never echoes. This is the cross-service lookup key
/// shared with the KWin `correlation=` fields.
fn summary_correlation(raw: Option<&str>) -> String {
    match raw.and_then(CorrelationId::parse) {
        Some(id) => id.as_str().to_owned(),
        None => "-".to_owned(),
    }
}

/// Bounded revision for summary lines, else `-`.
fn summary_revision(value: Option<u64>) -> String {
    match value {
        Some(n) if n <= PLAN_MAX_REVISION => n.to_string(),
        _ => "-".to_owned(),
    }
}

/// Carried-entry count for summary lines. The request itself is size-bounded,
/// so the count is exact without enumerating anything sensitive.
fn summary_count(value: Option<&serde_json::Value>) -> String {
    match value.and_then(serde_json::Value::as_array) {
        Some(items) => items.len().to_string(),
        None => "0".to_owned(),
    }
}

fn summary_request_field<'a>(
    request: &'a serde_json::Value,
    key: &str,
) -> Option<&'a serde_json::Value> {
    request.as_object().and_then(|object| object.get(key))
}

/// Normal-level ingress summary: requested op, validated correlation, bounded
/// revision. Emitted for every authorized `DescribePlan` call, covering
/// normal ops plus the status and cancel routes with truthful op tokens.
#[must_use]
pub fn summarize_plan_ingress(request_json: &str) -> String {
    let request: serde_json::Value = serde_json::from_str(request_json).unwrap_or_default();
    format!(
        "{PLAN_SUMMARY_PREFIX} direction=ingress op={} correlation={} revision={}",
        summary_token(
            summary_request_field(&request, "command")
                .and_then(|command| command.get("op"))
                .and_then(serde_json::Value::as_str)
        ),
        summary_correlation(
            summary_request_field(&request, "correlation_id").and_then(serde_json::Value::as_str)
        ),
        summary_revision(
            summary_request_field(&request, "revision").and_then(serde_json::Value::as_u64)
        ),
    )
}

/// Opt-in structural ingress detail (trace wiring only): carried observation
/// shape as entry counts plus the numeric fingerprint. Counts and integers
/// only; never ids, rects, domains, owner, or payload bytes.
#[must_use]
pub fn summarize_plan_shape(request_json: &str) -> String {
    let request: serde_json::Value = serde_json::from_str(request_json).unwrap_or_default();
    format!(
        "{PLAN_SUMMARY_PREFIX} direction=shape op={} correlation={} windows={} target_windows={} domains={} fingerprint={}",
        summary_token(
            summary_request_field(&request, "command")
                .and_then(|command| command.get("op"))
                .and_then(serde_json::Value::as_str)
        ),
        summary_correlation(
            summary_request_field(&request, "correlation_id").and_then(serde_json::Value::as_str)
        ),
        summary_count(summary_request_field(&request, "windows")),
        summary_count(summary_request_field(&request, "target_windows")),
        summary_count(summary_request_field(&request, "domains")),
        match summary_request_field(&request, "fingerprint").and_then(serde_json::Value::as_u64) {
            Some(n) => n.to_string(),
            None => "-".to_owned(),
        },
    )
}

/// Normal-level terminal summary: op re-parsed from the request (so the pair
/// stays attributable even when the reply carries no context), plus
/// correlation/outcome/kind/base/detail from the reply echo. Status result
/// codes pass through truthfully (`status`/`post-unacked`/…,
/// `cancelled`/`send-to-workspace`/…); `no-pending-unknown` stays exactly
/// that and never implies a commit.
#[must_use]
pub fn summarize_plan_egress(request_json: &str, reply_json: &str) -> String {
    let request: serde_json::Value = serde_json::from_str(request_json).unwrap_or_default();
    let reply: serde_json::Value = serde_json::from_str(reply_json).unwrap_or_default();
    let reply_field = |key: &str| reply.as_object().and_then(|object| object.get(key));
    format!(
        "{PLAN_SUMMARY_PREFIX} direction=egress op={} correlation={} outcome={} kind={} base_revision={} detail={}",
        summary_token(
            summary_request_field(&request, "command")
                .and_then(|command| command.get("op"))
                .and_then(serde_json::Value::as_str)
        ),
        summary_correlation(reply_field("correlation_id").and_then(serde_json::Value::as_str)),
        summary_token(reply_field("outcome").and_then(serde_json::Value::as_str)),
        match reply_field("kind").and_then(serde_json::Value::as_str) {
            Some(kind) => summary_token(Some(kind)),
            None => "-".to_owned(),
        },
        summary_revision(reply_field("base_revision").and_then(serde_json::Value::as_u64)),
        match reply_field("detail") {
            Some(serde_json::Value::String(detail)) => summary_token(Some(detail)),
            _ => "-".to_owned(),
        },
    )
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
        float_geometry: None,
        preconditions: None,
        operation: None,
    })
}

fn snapshot_invalid(correlation_id: String, message: &str, detail: &'static str) -> String {
    debug_assert!(PLANNER_SNAPSHOT_DETAILS.contains(&detail));
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id,
        outcome: "rejected",
        kind: Some("snapshot-invalid".to_owned()),
        message: Some(message.to_owned()),
        base_revision: None,
        detail: Some(serde_json::Value::String(detail.to_owned())),
        desired_geometry: None,
        desired_focus: None,
        float_geometry: None,
        preconditions: None,
        operation: None,
    })
}

const PLANNER_SNAPSHOT_DETAILS: &[&str] = &[
    "domain-output-invalid",
    "domain-workspace-invalid",
    "focused-id-invalid",
    "window-limit",
    "observed-window-invalid",
    "observed-output-invalid",
    "observed-workspace-invalid",
    "duplicate-window",
    "domain-bounds-invalid",
    "gap-low",
    "gap-high",
    "outer-gap-low",
    "outer-gap-high",
    "window-rect-invalid",
    "window-out-of-bounds",
    "focused-not-observed",
    "fingerprint-mismatch",
    "inset-exhausted",
    "domain-invalid",
    "canonical-state-unavailable",
    "canonical-source-unavailable",
    "canonical-pair-domain-mismatch",
    "canonical-pair-identity-mismatch",
    "canonical-pair-unusable",
    "canonical-pair-duplicate-state",
    "commit-rejected",
    "missing-seed-order",
    "seed-failed",
    "placement-bounds-invalid",
    "admit-op-invalid",
    "admit-window-invalid",
    "admit-output-invalid",
    "admit-workspace-invalid",
    "remove-op-invalid",
    "remove-window-invalid",
    "move-op-invalid",
    "move-window-invalid",
    "move-output-invalid",
    "move-workspace-invalid",
    "focus-op-invalid",
    "focus-window-invalid",
    "resize-op-invalid",
    "resize-window-invalid",
    "pointer-resize-op-invalid",
    "pointer-resize-window-invalid",
    "reconcile-op-invalid",
    "active-group-op-invalid",
    "toggle-float-op-invalid",
    "toggle-float-window-invalid",
    "float-rect-invalid",
];

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

fn geometry_reply(g: &tiler_core::session::DesiredGeometry) -> GeometryReply {
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

/// Validated request for the retained evaluator.
struct Validated {
    request: RequestDto,
    raw: serde_json::Value,
    owner: OwnerId,
    generation: GenerationId,
    correlation: CorrelationId,
    domain: OutputDomain,
    domain_key: DomainKey,
    /// Production directional domains (source first) when the adapter sent a
    /// bounded `domains` payload on focus/move. `None` for legacy
    /// single-domain requests, whose behavior is unchanged.
    directional_domains: Option<Vec<OutputDomain>>,
    directional_keys: Option<Vec<DomainKey>>,
}

/// Parse one directional wire domain into its projected [`OutputDomain`].
/// Fails closed on any unreadable shape; only `left`/`right` adjacency keys
/// are admitted (Up/Down never cross).
fn parse_directional_domain(
    entry: &DirectionalDomainDto,
    correlation_id: &str,
) -> Result<(OutputDomain, DomainKey), String> {
    if !is_opaque_id(&entry.output) {
        return Err(snapshot_invalid(
            correlation_id.to_owned(),
            MSG_OPAQUE_ID,
            "domain-output-invalid",
        ));
    }
    if !is_opaque_id(&entry.workspace) {
        return Err(snapshot_invalid(
            correlation_id.to_owned(),
            MSG_OPAQUE_ID,
            "domain-workspace-invalid",
        ));
    }
    let carried = Rect {
        x: entry.bounds.x,
        y: entry.bounds.y,
        w: entry.bounds.w,
        h: entry.bounds.h,
    };
    if !valid_carried_rect(carried.x, carried.y, carried.w, carried.h) {
        return Err(snapshot_invalid(
            correlation_id.to_owned(),
            MSG_OBSERVATION,
            "domain-bounds-invalid",
        ));
    }
    if entry.gap < 0 {
        return Err(snapshot_invalid(
            correlation_id.to_owned(),
            MSG_OBSERVATION,
            "gap-low",
        ));
    }
    if entry.gap > GEOMETRY_MAX_GAP {
        return Err(snapshot_invalid(
            correlation_id.to_owned(),
            MSG_OBSERVATION,
            "gap-high",
        ));
    }
    if entry.outer_gap < 0 {
        return Err(snapshot_invalid(
            correlation_id.to_owned(),
            MSG_OBSERVATION,
            "outer-gap-low",
        ));
    }
    if entry.outer_gap > GEOMETRY_MAX_GAP {
        return Err(snapshot_invalid(
            correlation_id.to_owned(),
            MSG_OBSERVATION,
            "outer-gap-high",
        ));
    }
    let mut adjacent: std::collections::BTreeMap<Direction, OutputId> =
        std::collections::BTreeMap::new();
    for (key, target) in &entry.adjacent {
        let direction = match key.as_str() {
            "left" => Direction::Left,
            "right" => Direction::Right,
            _ => {
                return Err(snapshot_invalid(
                    correlation_id.to_owned(),
                    MSG_OBSERVATION,
                    "domain-invalid",
                ));
            }
        };
        if !is_opaque_id(target) {
            return Err(snapshot_invalid(
                correlation_id.to_owned(),
                MSG_OPAQUE_ID,
                "domain-output-invalid",
            ));
        }
        if adjacent
            .insert(direction, OutputId(target.clone()))
            .is_some()
        {
            return Err(snapshot_invalid(
                correlation_id.to_owned(),
                MSG_OBSERVATION,
                "domain-invalid",
            ));
        }
    }
    let Ok(projected) = tiler_core::geometry::inset_bounds(carried, entry.outer_gap) else {
        return Err(snapshot_invalid(
            correlation_id.to_owned(),
            MSG_OBSERVATION,
            "inset-exhausted",
        ));
    };
    let domain = OutputDomain {
        id: OutputId(entry.output.clone()),
        workspace: WorkspaceId(entry.workspace.clone()),
        bounds: projected,
        gap: entry.gap,
        adjacent,
    };
    if !domain.validate() {
        return Err(snapshot_invalid(
            correlation_id.to_owned(),
            MSG_OBSERVATION,
            "domain-invalid",
        ));
    }
    let key = DomainKey {
        output: OutputId(entry.output.clone()),
        workspace: WorkspaceId(entry.workspace.clone()),
    };
    Ok((domain, key))
}

/// Shared request validation: bounds, opaque ids, geometry containment for
/// existing tiled-state operations, and domain binding. Admission assigns every
/// member a new geometry, so carried member rectangles do not gate it.
/// Returns the ready-made rejected reply on failure.
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
    if !is_opaque_id(&request.domain.output) {
        return Err(snapshot_invalid(
            request.correlation_id.clone(),
            MSG_OPAQUE_ID,
            "domain-output-invalid",
        ));
    }
    if !is_opaque_id(&request.domain.workspace) {
        return Err(snapshot_invalid(
            request.correlation_id.clone(),
            MSG_OPAQUE_ID,
            "domain-workspace-invalid",
        ));
    }
    if !request.focused_window.is_empty() && !is_opaque_id(&request.focused_window) {
        return Err(snapshot_invalid(
            request.correlation_id.clone(),
            MSG_OPAQUE_ID,
            "focused-id-invalid",
        ));
    }
    if request.windows.len() > PLAN_MAX_WINDOWS {
        return Err(snapshot_invalid(
            request.correlation_id.clone(),
            MSG_OBSERVATION,
            "window-limit",
        ));
    }
    {
        let mut seen = std::collections::HashSet::new();
        for entry in &request.windows {
            if !is_opaque_id(&entry.window) {
                return Err(snapshot_invalid(
                    request.correlation_id.clone(),
                    MSG_OPAQUE_ID,
                    "observed-window-invalid",
                ));
            }
            if !is_opaque_id(&entry.output) {
                return Err(snapshot_invalid(
                    request.correlation_id.clone(),
                    MSG_OPAQUE_ID,
                    "observed-output-invalid",
                ));
            }
            if !is_opaque_id(&entry.workspace) {
                return Err(snapshot_invalid(
                    request.correlation_id.clone(),
                    MSG_OPAQUE_ID,
                    "observed-workspace-invalid",
                ));
            }
            if !seen.insert(entry.window.clone()) {
                return Err(snapshot_invalid(
                    request.correlation_id.clone(),
                    MSG_OPAQUE_ID,
                    "duplicate-window",
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
    ) {
        return Err(snapshot_invalid(
            request.correlation_id.clone(),
            MSG_OBSERVATION,
            "domain-bounds-invalid",
        ));
    }
    if request.domain.gap < 0 {
        return Err(snapshot_invalid(
            request.correlation_id.clone(),
            MSG_OBSERVATION,
            "gap-low",
        ));
    }
    if request.domain.gap > GEOMETRY_MAX_GAP {
        return Err(snapshot_invalid(
            request.correlation_id.clone(),
            MSG_OBSERVATION,
            "gap-high",
        ));
    }
    if request.domain.outer_gap < 0 {
        return Err(snapshot_invalid(
            request.correlation_id.clone(),
            MSG_OBSERVATION,
            "outer-gap-low",
        ));
    }
    if request.domain.outer_gap > GEOMETRY_MAX_GAP {
        return Err(snapshot_invalid(
            request.correlation_id.clone(),
            MSG_OBSERVATION,
            "outer-gap-high",
        ));
    }
    let op_str = request
        .command
        .get("op")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let admission = op_str == "admit";
    // Production directional payload: only focus/move may carry `domains`;
    // every other op (including the standalone workspace-send route) keeps
    // legacy single-domain behavior and refuses it fail-closed. The
    // directional R4 async ack/verify/status/cancel phases carry the same
    // two-domain post-observation, so they admit `domains` with no new
    // topology seeding.
    let directional = match (&request.domains, op_str) {
        (None, _) => None,
        (Some(_), "focus")
        | (Some(_), "move")
        | (Some(_), "directional-move-ack")
        | (Some(_), "directional-move-verify")
        | (Some(_), "directional-move-status")
        | (Some(_), "directional-move-cancel") => request.domains.clone(),
        (Some(_), _) => {
            return Err(snapshot_invalid(
                request.correlation_id.clone(),
                MSG_OBSERVATION,
                "domain-invalid",
            ));
        }
    };
    // Parsed directional domains (source first), when present.
    let mut directional_parsed: Option<Vec<(OutputDomain, DomainKey)>> = None;
    if let Some(entries) = &directional {
        if entries.is_empty() || entries.len() > 2 {
            return Err(snapshot_invalid(
                request.correlation_id.clone(),
                MSG_OBSERVATION,
                "domain-invalid",
            ));
        }
        let mut parsed: Vec<(OutputDomain, DomainKey)> = Vec::with_capacity(entries.len());
        for entry in entries {
            parsed.push(parse_directional_domain(entry, &request.correlation_id)?);
        }
        // Source entry must equal the carried source domain (output,
        // workspace, raw bounds, gaps). Adjacency lives only in `domains`;
        // the inset-projected bounds are compared via the wire entry so the
        // raw work area must match exactly.
        {
            let wire_source = &entries[0];
            if wire_source.output != request.domain.output
                || wire_source.workspace != request.domain.workspace
                || wire_source.bounds.x != request.domain.bounds.x
                || wire_source.bounds.y != request.domain.bounds.y
                || wire_source.bounds.w != request.domain.bounds.w
                || wire_source.bounds.h != request.domain.bounds.h
                || wire_source.gap != request.domain.gap
                || wire_source.outer_gap != request.domain.outer_gap
            {
                return Err(snapshot_invalid(
                    request.correlation_id.clone(),
                    MSG_OBSERVATION,
                    "domain-invalid",
                ));
            }
        }
        // Distinct (output, workspace) pairs and distinct outputs.
        {
            let mut seen_pairs = std::collections::HashSet::new();
            let mut seen_outputs = std::collections::HashSet::new();
            for (domain, _) in &parsed {
                if !seen_pairs.insert((domain.id.0.clone(), domain.workspace.0.clone())) {
                    return Err(snapshot_invalid(
                        request.correlation_id.clone(),
                        MSG_OBSERVATION,
                        "domain-invalid",
                    ));
                }
                if !seen_outputs.insert(domain.id.0.clone()) {
                    // Ambiguous duplicate output ids fail closed.
                    return Err(snapshot_invalid(
                        request.correlation_id.clone(),
                        MSG_OBSERVATION,
                        "domain-invalid",
                    ));
                }
            }
        }
        // Two-domain reciprocity: source names target on Left/Right and the
        // target names source back on the opposite side. Single-domain
        // payloads carry no adjacency requirement.
        if parsed.len() == 2 {
            let (source_domain, _) = &parsed[0];
            let (target_domain, _) = &parsed[1];
            let mut reciprocal = false;
            for direction in [Direction::Left, Direction::Right] {
                let opposite = match direction {
                    Direction::Left => Direction::Right,
                    Direction::Right => Direction::Left,
                    _ => continue,
                };
                if source_domain.adjacent.get(&direction) == Some(&target_domain.id)
                    && target_domain.adjacent.get(&opposite) == Some(&source_domain.id)
                {
                    reciprocal = true;
                    break;
                }
            }
            if !reciprocal {
                return Err(snapshot_invalid(
                    request.correlation_id.clone(),
                    MSG_OBSERVATION,
                    "domain-invalid",
                ));
            }
        }
        directional_parsed = Some(parsed);
    }
    // Per-domain carried bounds for containment (projected bounds above are
    // per domain; containment uses the already-inset domain bounds).
    let directional_bounds: Option<Vec<Rect>> = directional_parsed
        .as_ref()
        .map(|parsed| parsed.iter().map(|(d, _)| d.bounds).collect());
    for entry in &request.windows {
        if !admission && !valid_carried_rect(entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h)
        {
            return Err(snapshot_invalid(
                request.correlation_id.clone(),
                MSG_OBSERVATION,
                "window-rect-invalid",
            ));
        }
        let entry_rect = Rect {
            x: entry.rect.x,
            y: entry.rect.y,
            w: entry.rect.w,
            h: entry.rect.h,
        };
        if let Some(parsed) = &directional_parsed {
            let bounds_list: &Vec<Rect> = directional_bounds.as_ref().expect("built");
            let mut homed = false;
            for ((domain, _), bounds) in parsed.iter().zip(bounds_list.iter()) {
                if entry.output == domain.id.0 && entry.workspace == domain.workspace.0 {
                    homed = true;
                    if !admission && !entry.floating && !rect_contained(entry_rect, *bounds) {
                        return Err(snapshot_invalid(
                            request.correlation_id.clone(),
                            MSG_OBSERVATION,
                            "window-out-of-bounds",
                        ));
                    }
                    break;
                }
            }
            if !homed {
                return Err(rejected(
                    request.correlation_id.clone(),
                    "cross-domain-mismatch",
                    MSG_CROSS_DOMAIN,
                ));
            }
        } else {
            if !admission
                && !entry.floating
                && !rect_contained(
                    Rect {
                        x: entry.rect.x,
                        y: entry.rect.y,
                        w: entry.rect.w,
                        h: entry.rect.h,
                    },
                    carried_bounds,
                )
            {
                return Err(snapshot_invalid(
                    request.correlation_id.clone(),
                    MSG_OBSERVATION,
                    "window-out-of-bounds",
                ));
            }
            if entry.output != request.domain.output || entry.workspace != request.domain.workspace
            {
                return Err(rejected(
                    request.correlation_id.clone(),
                    "cross-domain-mismatch",
                    MSG_CROSS_DOMAIN,
                ));
            }
        }
    }
    // Ack/verify/status/cancel phases carry the complete source+target
    // post-observation where focus is not a planning input: after the mover
    // leaves the source desktop the observed focus may be empty or a
    // remaining source window, so the focus-membership gate is relaxed for
    // those ops only (workspace and directional R4 async routes). Cancellation
    // additionally binds focus exactly against the retained pre-image below,
    // so the relaxed gate loses nothing.
    let focus_skipped_for_ack_verify = matches!(
        request
            .command
            .get("op")
            .and_then(serde_json::Value::as_str),
        Some("send-to-workspace-ack")
            | Some("send-to-workspace-verify")
            | Some("send-to-workspace-status")
            | Some("send-to-workspace-cancel")
            | Some("directional-move-ack")
            | Some("directional-move-verify")
            | Some("directional-move-status")
            | Some("directional-move-cancel")
    );
    if !request.windows.is_empty()
        && !focus_skipped_for_ack_verify
        && !request
            .windows
            .iter()
            .any(|w| w.window == request.focused_window)
    {
        return Err(snapshot_invalid(
            request.correlation_id.clone(),
            MSG_OBSERVATION,
            "focused-not-observed",
        ));
    }
    // Directional focus/move: the focused window must live in the source
    // domain (cross targets are never the planning input). Binds the request
    // to the source so a stale target substitution cannot redirect planning.
    if directional_parsed.is_some()
        && !focus_skipped_for_ack_verify
        && !request.windows.iter().any(|w| {
            w.window == request.focused_window
                && w.output == request.domain.output
                && w.workspace == request.domain.workspace
        })
    {
        return Err(snapshot_invalid(
            request.correlation_id.clone(),
            MSG_OBSERVATION,
            "focused-not-observed",
        ));
    }
    // Directional fingerprint binding: recompute over the full two-domain
    // evidence (ordered domain primitives, focused id, every window) and
    // refuse altered target rects/bounds/adjacency here at request
    // validation, not only at reply revalidation downstream.
    if let Some(entries) = &directional {
        let expected = directional_fingerprint(entries, &request.focused_window, &request.windows);
        if request.fingerprint != expected {
            return Err(snapshot_invalid(
                request.correlation_id.clone(),
                MSG_OBSERVATION,
                "fingerprint-mismatch",
            ));
        }
    }
    let owner = OwnerId::parse(&request.owner).expect("validated");
    let generation = GenerationId::parse(&request.generation).expect("validated");
    let correlation = CorrelationId::parse(&request.correlation_id).expect("validated");
    // Rust owns the outer inset: an exhausted inset fails closed here while
    // segment overflow still fails in projection.
    let Ok(projected_bounds) =
        tiler_core::geometry::inset_bounds(carried_bounds, request.domain.outer_gap)
    else {
        return Err(snapshot_invalid(
            request.correlation_id.clone(),
            MSG_OBSERVATION,
            "inset-exhausted",
        ));
    };
    let domain = OutputDomain {
        id: OutputId(request.domain.output.clone()),
        workspace: WorkspaceId(request.domain.workspace.clone()),
        bounds: projected_bounds,
        gap: request.domain.gap,
        adjacent: std::collections::BTreeMap::new(),
    };
    if !domain.validate() {
        return Err(snapshot_invalid(
            request.correlation_id.clone(),
            MSG_OBSERVATION,
            "domain-invalid",
        ));
    }
    let domain_key = DomainKey {
        output: OutputId(request.domain.output.clone()),
        workspace: WorkspaceId(request.domain.workspace.clone()),
    };
    // Directional domains/keys for the focus/move cross route. Single entry
    // means source-only (behaves like legacy); two entries carry the
    // reciprocal adjacent target.
    let (directional_domains, directional_keys) = match directional_parsed {
        Some(parsed) => {
            let mut domains = Vec::with_capacity(parsed.len());
            let mut keys = Vec::with_capacity(parsed.len());
            for (d, k) in parsed {
                domains.push(d);
                keys.push(k);
            }
            (Some(domains), Some(keys))
        }
        None => (None, None),
    };
    Ok(Validated {
        request,
        raw,
        owner,
        generation,
        correlation,
        domain,
        domain_key,
        directional_domains,
        directional_keys,
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
            floating: entry.floating,
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
    let ack = tiler_core::contract::AdapterAck::new(
        ctx.correlation.clone(),
        ctx.owner.clone(),
        ctx.generation.clone(),
        base,
        tiler_core::contract::AckOutcome::Accepted,
    );
    session.acknowledge(&ack).is_ok()
}

/// Wire token for a directional move precondition (production cross-output
/// route). Matches the portable movement-service vocabulary exactly.
fn move_precondition_str(value: tiler_core::directional::Precondition) -> &'static str {
    match value {
        tiler_core::directional::Precondition::FocusedLeafOccupiedByFocusedWindow => {
            "focused-leaf-occupied-by-focused-window"
        }
        tiler_core::directional::Precondition::NeighborLeafOccupied => "neighbor-leaf-occupied",
        tiler_core::directional::Precondition::ContainerIsDirectParent => "container-is-direct-parent",
        tiler_core::directional::Precondition::TargetGroupMembership => "target-group-membership",
        tiler_core::directional::Precondition::ParentGroupMembership => "parent-group-membership",
        tiler_core::directional::Precondition::SourceRootMembershipAndAdjacentSameWorkspaceOutput => {
            "source-root-membership-and-adjacent-same-workspace-output"
        }
        tiler_core::directional::Precondition::AdapterMustVerifyPostconditions => {
            "adapter-must-verify-postconditions"
        }
    }
}

/// Wire token for a focus precondition (production directional route).
fn focus_precondition_str(value: tiler_core::contract::FocusPrecondition) -> &'static str {
    match value {
        tiler_core::contract::FocusPrecondition::FocusedLeafOccupiedByFocusedWindow => {
            "focused-leaf-occupied-by-focused-window"
        }
        tiler_core::contract::FocusPrecondition::TargetLeafOccupied => "target-leaf-occupied",
        tiler_core::contract::FocusPrecondition::FocusTargetsSameDomain => {
            "focus-targets-same-domain"
        }
        tiler_core::contract::FocusPrecondition::FocusTargetsAdjacentOutput => {
            "focus-targets-adjacent-output"
        }
        tiler_core::contract::FocusPrecondition::AdapterMustVerifyPostconditions => {
            "adapter-must-verify-postconditions"
        }
    }
}

/// Planned cross-output focus reply: full source+target geometry, target
/// focus, plus the exact operation/preconditions the adapter must fence
/// (target domain plus explicit cross source must match the captured source).
fn cross_focus_planned_reply(
    correlation_id: &str,
    base_revision: u64,
    detail: serde_json::Value,
    geometry: &[tiler_core::session::DesiredGeometry],
    focus: (&DomainKey, &NodeId),
    operation: &tiler_core::contract::FocusOperation,
) -> String {
    let operation_value = serde_json::json!({
        "op": "focus",
        "domain_output": operation.domain_output.0,
        "domain_workspace": operation.domain_workspace.0,
        "from_leaf": operation.from_leaf.0,
        "to_leaf": operation.to_leaf.0,
        "from_window": operation.from_window.0,
        "to_window": operation.to_window.0,
        "direction": direction_str(operation.direction),
        "route": operation.route.iter().map(|id| id.0.clone()).collect::<Vec<_>>(),
        "cross_source_output": operation.cross_source_output.as_ref().map(|id| id.0.clone()),
        "cross_source_workspace": operation.cross_source_workspace.as_ref().map(|id| id.0.clone()),
    });
    let preconditions: Vec<&'static str> = operation
        .preconditions()
        .iter()
        .map(|p| focus_precondition_str(*p))
        .collect();
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id: correlation_id.to_owned(),
        outcome: "planned",
        kind: None,
        message: None,
        base_revision: Some(base_revision),
        detail: Some(detail),
        desired_geometry: Some(geometry.iter().map(geometry_reply).collect()),
        desired_focus: Some(focus_reply(focus.0, focus.1)),
        float_geometry: None,
        preconditions: Some(preconditions),
        operation: Some(operation_value),
    })
}

/// Directional pair from a validated request: source + adjacent target when
/// the adapter sent two domains. Single-domain payloads return `None` and
/// keep legacy behavior.
fn directional_pair(
    ctx: &Validated,
) -> Option<(&OutputDomain, &DomainKey, &OutputDomain, &DomainKey)> {
    let domains = ctx.directional_domains.as_ref()?;
    let keys = ctx.directional_keys.as_ref()?;
    if domains.len() == 2 && keys.len() == 2 {
        Some((&domains[0], &keys[0], &domains[1], &keys[1]))
    } else {
        None
    }
}

fn planned_reply(
    correlation_id: &str,
    base_revision: u64,
    detail: serde_json::Value,
    geometry: &[tiler_core::session::DesiredGeometry],
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
        float_geometry: None,
        preconditions: None,
        operation: None,
    })
}

fn snapshot_windows_leaf_map(
    session: &Session,
    domain_key: &DomainKey,
) -> std::collections::BTreeMap<String, String> {
    session
        .snapshot()
        .windows
        .into_iter()
        .filter(|l| l.output == domain_key.output && l.workspace == domain_key.workspace)
        .map(|l| (l.leaf.0, l.window.0))
        .collect()
}

/// Planned workspace-send reply: carries the full affected geometry plus the
/// exact operation/preconditions the adapter must echo back in the verify
/// post-observation.
fn workspace_planned_reply(correlation_id: &str, plan: &SessionPlan) -> String {
    let operation = match &plan.dispatch.operation {
        LifecycleOperation::MoveTiled {
            window,
            leaf,
            source_output,
            source_workspace,
            target_output,
            target_workspace,
        } => serde_json::json!({
            "op": "move-tiled",
            "window": window.0,
            "leaf": leaf.0,
            "source_output": source_output.0,
            "source_workspace": source_workspace.0,
            "target_output": target_output.0,
            "target_workspace": target_workspace.0,
        }),
        _ => {
            return snapshot_invalid(
                correlation_id.to_owned(),
                MSG_OBSERVATION,
                "move-op-invalid",
            );
        }
    };
    let preconditions: Vec<&'static str> = plan
        .dispatch
        .preconditions
        .iter()
        .map(|p| lifecycle_precondition_str(*p))
        .collect();
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id: correlation_id.to_owned(),
        outcome: "planned",
        kind: Some("send-to-workspace".to_owned()),
        message: None,
        base_revision: Some(plan.dispatch.base_revision),
        detail: Some(serde_json::json!({
            "kind": "send-to-workspace",
            "policy_version": plan.dispatch.policy_version,
            "capability": "move-tiled",
        })),
        desired_geometry: Some(plan.desired_geometry.iter().map(geometry_reply).collect()),
        desired_focus: match (&plan.desired_focus_domain, &plan.desired_focus_leaf) {
            (Some(d), Some(l)) => Some(focus_reply(d, l)),
            _ => None,
        },
        float_geometry: None,
        preconditions: Some(preconditions),
        operation: Some(operation),
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

/// Deterministic near-strip fit over the current admission's complete
/// carried rectangles.
///
/// A simple best-effort project policy, not topology reconstruction and not
/// exact recognition: succeeds only when every non-excluded rectangle is
/// valid, contained in the already-inset domain, and non-overlapping, plus
/// one axis has unambiguous sequential primary intervals. A horizontal
/// near-strip sorts by the existing `(x, y, w, h)` key and needs each
/// carried positive x interval strictly non-overlapping and sequential
/// (`previous.x + previous.w <= next.x`), regardless of domain edge offsets,
/// cross-axis drift, or the observed inter-window gap; vertical mirrors by
/// sorting on `(y, x, h, w)` and checking `previous.y + previous.h <=
/// next.y`. A single window stays on the normal path (`None`).
///
/// Each supported axis builds one ordered flat N-ary `Node::Group` along
/// that axis with the observed primary spans (`w` horizontal, `h` vertical)
/// as shares, then projects it with the existing
/// `project(domain.bounds, domain.gap)` as the canonical valid complete
/// result with the configured gap. No exact input reprojection is required.
/// When both axes support, the fixed Horizontal tie-break applies. Anything
/// else returns `None` for the normal deterministic seed/reflow. Grids,
/// nested, and T arrangements with primary-interval overlap on both axes are
/// normal unsupported fallback, not fitted topology. Topology decisions use
/// only rectangle geometry (never opaque window ids); leaf/group ids are
/// safe internal deterministic index names.
fn try_flat_strip_fit(
    domain: &OutputDomain,
    windows: &[ObservedDto],
) -> Option<(Node, Vec<WindowLink>)> {
    if windows.len() < 2 || windows.len() > PLAN_MAX_WINDOWS {
        return None;
    }
    if windows.iter().any(|w| w.floating || w.fit_excluded) {
        return None;
    }
    let mut items: Vec<(WindowId, Rect)> = Vec::with_capacity(windows.len());
    for entry in windows {
        let rect = Rect {
            x: entry.rect.x,
            y: entry.rect.y,
            w: entry.rect.w,
            h: entry.rect.h,
        };
        if !valid_carried_rect(rect.x, rect.y, rect.w, rect.h) {
            return None;
        }
        if !rect_contained(rect, domain.bounds) {
            return None;
        }
        items.push((WindowId(entry.window.clone()), rect));
    }
    for i in 0..items.len() {
        for (_, other) in items.iter().skip(i + 1) {
            let (a, b) = (items[i].1, *other);
            if a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h {
                return None;
            }
        }
    }
    // One axis attempt: sort by the existing geometry key, require strictly
    // non-overlapping sequential primary intervals with no tolerance knobs,
    // then project one flat N-ary group with observed primary spans as
    // shares. Edge offsets, cross-axis drift, and observed gaps never gate
    // support; the configured-gap projection is the canonical result.
    fn strip_candidate(
        domain: &OutputDomain,
        items: &[(WindowId, Rect)],
        axis: Axis,
    ) -> Option<(Node, Vec<WindowLink>)> {
        let mut ordered: Vec<(WindowId, Rect)> = items.to_vec();
        match axis {
            Axis::Horizontal => ordered
                .sort_by(|a, b| (a.1.x, a.1.y, a.1.w, a.1.h).cmp(&(b.1.x, b.1.y, b.1.w, b.1.h))),
            Axis::Vertical => ordered
                .sort_by(|a, b| (a.1.y, a.1.x, a.1.h, a.1.w).cmp(&(b.1.y, b.1.x, b.1.h, b.1.w))),
        }
        for pair in ordered.windows(2) {
            let (previous, next) = (pair[0].1, pair[1].1);
            match axis {
                Axis::Horizontal => {
                    if i64::from(previous.x) + i64::from(previous.w) > i64::from(next.x) {
                        return None;
                    }
                }
                Axis::Vertical => {
                    if i64::from(previous.y) + i64::from(previous.h) > i64::from(next.y) {
                        return None;
                    }
                }
            }
        }
        let shares: Vec<u64> = ordered
            .iter()
            .map(|(_, rect)| match axis {
                Axis::Horizontal => rect.w as u64,
                Axis::Vertical => rect.h as u64,
            })
            .collect();
        if shares.iter().any(|share| *share == 0) {
            return None;
        }
        let children: Vec<Node> = (0..ordered.len())
            .map(|i| Node::Leaf {
                id: NodeId(format!("fit-l{i}")),
            })
            .collect();
        let tree = Node::Group {
            id: NodeId("fit-g0".to_owned()),
            axis,
            children,
            shares,
        };
        let projected = project(&tree, domain.bounds, domain.gap).ok()?;
        if projected.len() != ordered.len() {
            return None;
        }
        let links: Vec<WindowLink> = ordered
            .iter()
            .enumerate()
            .map(|(index, (window, _))| WindowLink {
                window: window.clone(),
                leaf: NodeId(format!("fit-l{index}")),
                output: domain.id.clone(),
                workspace: domain.workspace.clone(),
            })
            .collect();
        Some((tree, links))
    }
    let horizontal = strip_candidate(domain, &items, Axis::Horizontal);
    let vertical = strip_candidate(domain, &items, Axis::Vertical);
    match (horizontal, vertical) {
        // Fixed Horizontal tie-break keeps the choice deterministic when both
        // interval orders support a near strip.
        (Some(h), Some(_)) => Some(h),
        (Some(h), None) => Some(h),
        (None, Some(v)) => Some(v),
        (None, None) => None,
    }
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
        let ack = tiler_core::contract::AdapterAck::new(
            correlation.clone(),
            owner.clone(),
            generation.clone(),
            base,
            tiler_core::contract::AckOutcome::Accepted,
        );
        session.acknowledge(&ack).ok()?;
        session
            .verify_lifecycle(&tiler_core::contract::LifecyclePostObservation::new(
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
    allow_tied_observations: bool,
) -> Option<Vec<ObservedDto>> {
    if !allow_tied_observations {
        // Non-admission rebuilds reconstruct existing tiled state, so equal
        // frame rectangles still lack a safe topology signal.
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
    }
    // Stable sorting preserves the adapter's observation order when carried
    // rectangles tie during admission. Admission assigns new geometry, so an
    // uninformative incoming rectangle must not reject the other members.
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

/// One retained pending two-domain workspace-send Session for the standalone
/// dev-only route. Bound to owner/generation/correlation/base revision; no
/// owner rebind during pending. Pending mismatch, loss, refused ack, or failed
/// verification is terminal divergence with no Legacy fallback. The retained
/// desired geometry is exactly the expected post-observation: a bare
/// `verified: true` never commits unless every desired window is observed once
/// with the expected output, workspace, and rectangle. The retained pre-image
/// is the exact normalized dispatch-time observation (focused window plus the
/// complete source/target window sets with carried rectangles); it is bounded
/// by the request window/entry bounds and lives exactly as long as the
/// pending. `request_revision` is the revision the dispatching request
/// carried (distinct from the seeded `base_revision`); cancellation must echo
/// it, never a base learned from a stale probe.
#[derive(Debug)]
struct WorkspacePending {
    owner: OwnerId,
    generation: GenerationId,
    correlation: CorrelationId,
    base_revision: u64,
    request_revision: u64,
    session: Session,
    desired_geometry: Vec<DesiredGeometry>,
    pre_focused: String,
    pre_windows: Vec<ObservedDto>,
    pre_target_windows: Vec<ObservedDto>,
}

/// One retained pending two-domain directional R4 cross-output move. Bound to
/// owner/generation/correlation/base revision plus the source/target pair
/// keys and outer gaps; no owner rebind during pending and no new topology
/// seeding. R4 proposes once and retains the pair Session (with its single
/// reconciler pending slot) until an exact accepted `directional-move-ack`
/// and a matching verified `directional-move-verify` post-observation commit
/// it via `Session::verify_move` then split/store the canonical sessions
/// once. Pending mismatch, refused ack, failed verification, or
/// identity/correlation/revision loss is terminal `diverged` with no commit.
/// R1-R3 never stage this pending and stay synchronous. The retained
/// pre-image and `request_revision` follow the [`WorkspacePending`] contract.
#[derive(Debug)]
struct DirectionalMovePending {
    owner: OwnerId,
    generation: GenerationId,
    correlation: CorrelationId,
    base_revision: u64,
    request_revision: u64,
    session: Session,
    source_key: DomainKey,
    target_key: DomainKey,
    source_outer_gap: i32,
    target_outer_gap: i32,
    desired_geometry: Vec<DesiredGeometry>,
    operation: tiler_core::directional::MoveOperation,
    preconditions: Vec<tiler_core::directional::Precondition>,
    pre_focused: String,
    pre_windows: Vec<ObservedDto>,
}

/// Validated workspace-send route input: the target domain plus the exact
/// mover binding. The source domain is the already-validated request domain.
#[derive(Debug)]
struct WorkspaceInput {
    target_domain: OutputDomain,
    target_key: DomainKey,
    target_windows: Vec<ObservedDto>,
    window: WindowId,
}

/// Stable lifecycle precondition token (mirrors the KWin wire tokens).
#[must_use]
fn lifecycle_precondition_str(value: LifecyclePrecondition) -> &'static str {
    match value {
        LifecyclePrecondition::WindowObserved => "window-observed",
        LifecyclePrecondition::DesiredTopologyValid => "desired-topology-valid",
        LifecyclePrecondition::AdapterMustVerifyPostconditions => {
            "adapter-must-verify-postconditions"
        }
    }
}

/// Parse a lifecycle precondition token (fail-closed on unknown tokens).
#[must_use]
fn parse_lifecycle_precondition(value: &str) -> Option<LifecyclePrecondition> {
    match value {
        "window-observed" => Some(LifecyclePrecondition::WindowObserved),
        "desired-topology-valid" => Some(LifecyclePrecondition::DesiredTopologyValid),
        "adapter-must-verify-postconditions" => {
            Some(LifecyclePrecondition::AdapterMustVerifyPostconditions)
        }
        _ => None,
    }
}

fn observed_from_dto(entry: &ObservedDto) -> ObservedWindow {
    ObservedWindow {
        window: WindowId(entry.window.clone()),
        output: OutputId(entry.output.clone()),
        workspace: WorkspaceId(entry.workspace.clone()),
        floating: entry.floating,
        fullscreen: false,
        maximized: false,
        sticky: false,
    }
}

/// Terminal divergence reply for the standalone workspace route: outcome
/// `diverged`, exact bounded kind, no Legacy fallback.
fn diverged_reply(correlation_id: &str, reason: tiler_core::contract::DivergenceKind) -> String {
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id: correlation_id.to_owned(),
        outcome: "diverged",
        kind: Some(reason.as_str().to_owned()),
        message: Some(reason.message().to_owned()),
        base_revision: None,
        detail: None,
        desired_geometry: None,
        desired_focus: None,
        float_geometry: None,
        preconditions: None,
        operation: None,
    })
}

/// Read-only pending-transaction status reply: outcome `status` with the
/// truthful classification as `kind` (`post-unacked`, `post-acked`,
/// `unresolved`, `stale`, or `no-pending-unknown`). Carries no geometry,
/// focus, operation, or preconditions and never implies a commit:
/// `no-pending-unknown` in particular cannot be read as committed.
fn status_reply(correlation_id: &str, base_revision: Option<u64>, status: &'static str) -> String {
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id: correlation_id.to_owned(),
        outcome: "status",
        kind: Some(status.to_owned()),
        message: None,
        base_revision,
        detail: None,
        desired_geometry: None,
        desired_focus: None,
        float_geometry: None,
        preconditions: None,
        operation: None,
    })
}

/// Cancellation success reply: outcome `cancelled` with the route kind and
/// the un-advanced base revision. Carries no geometry, focus, operation, or
/// preconditions and must never be read as a commit: nothing advanced, the
/// matching unacknowledged pending was withdrawn and its staged desired state
/// discarded.
fn cancelled_reply(correlation_id: &str, kind: &'static str, base_revision: u64) -> String {
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id: correlation_id.to_owned(),
        outcome: "cancelled",
        kind: Some(kind.to_owned()),
        message: None,
        base_revision: Some(base_revision),
        detail: None,
        desired_geometry: None,
        desired_focus: None,
        float_geometry: None,
        preconditions: None,
        operation: None,
    })
}

/// One admission step of the two-domain workspace seed: propose/ack/verify
/// one tiled window into its exact source or target domain.
fn seed_workspace_admit(
    session: &mut Session,
    owner: &OwnerId,
    generation: &GenerationId,
    fingerprint: u64,
    domain: &OutputDomain,
    entry: &ObservedDto,
    index: usize,
) -> Option<()> {
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
    observed.push(observed_from_dto(entry));
    let correlation = CorrelationId::parse(&format!("seed-{index:04}"))?;
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
        placement_bounds: seed_target_bounds(session, domain),
    };
    let plan = session
        .propose(
            &command,
            &observation,
            &correlation,
            &LifecycleCapabilities::full(),
        )
        .ok()?;
    let ack = AdapterAck::new(
        correlation.clone(),
        owner.clone(),
        generation.clone(),
        base,
        AckOutcome::Accepted,
    );
    session.acknowledge(&ack).ok()?;
    session
        .verify_lifecycle(&LifecyclePostObservation::new(
            Observation::new(owner.clone(), generation.clone(), base, fingerprint),
            correlation,
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        ))
        .ok()?;
    Some(())
}

/// Rebuild the authoritative two-domain workspace topology from the observed
/// source and target spatial orders (source first, then target). Mirrors
/// [`seed_session`]; the mover is admitted into its source domain and focus is
/// synced to it by the caller before the workspace move proposes.
fn seed_workspace_session(
    owner: &OwnerId,
    generation: &GenerationId,
    fingerprint: u64,
    source_domain: &OutputDomain,
    target_domain: &OutputDomain,
    source_order: &[ObservedDto],
    target_order: &[ObservedDto],
) -> Option<Session> {
    let mut session = Session::new(
        owner.clone(),
        generation.clone(),
        0,
        fingerprint,
        vec![source_domain.clone(), target_domain.clone()],
    )
    .ok()?;
    for (index, entry) in source_order.iter().enumerate() {
        seed_workspace_admit(
            &mut session,
            owner,
            generation,
            fingerprint,
            source_domain,
            entry,
            index,
        )?;
    }
    for (index, entry) in target_order.iter().enumerate() {
        seed_workspace_admit(
            &mut session,
            owner,
            generation,
            fingerprint,
            target_domain,
            entry,
            source_order.len() + index,
        )?;
    }
    Some(session)
}

/// Complete workspace observation covering every known source and target
/// window at the given base revision.
fn workspace_observation(base: u64, ctx: &Validated, input: &WorkspaceInput) -> SessionObservation {
    let mut windows: Vec<ObservedWindow> =
        ctx.request.windows.iter().map(observed_from_dto).collect();
    windows.extend(input.target_windows.iter().map(observed_from_dto));
    SessionObservation {
        observation: Observation::new(
            ctx.owner.clone(),
            ctx.generation.clone(),
            base,
            ctx.request.fingerprint,
        ),
        windows,
    }
}

/// Complete post-observation validation against the retained plan: every
/// desired window must be carried exactly once (source plus target) with the
/// expected output, workspace, and rectangle. Any missing, duplicate, extra,
/// mis-homed, or mis-sized window fails closed so a bare `verified: true`
/// never commits a divergent state.
fn workspace_post_matches(pending: &WorkspacePending, ctx: &Validated) -> bool {
    let mut observed: std::collections::HashMap<&str, &ObservedDto> =
        std::collections::HashMap::with_capacity(
            ctx.request.windows.len() + ctx.request.target_windows.len(),
        );
    for entry in ctx
        .request
        .windows
        .iter()
        .chain(ctx.request.target_windows.iter())
    {
        if observed.insert(entry.window.as_str(), entry).is_some() {
            return false;
        }
    }
    if observed.len() != pending.desired_geometry.len() {
        return false;
    }
    for desired in &pending.desired_geometry {
        let Some(entry) = observed.get(desired.window.0.as_str()) else {
            return false;
        };
        if entry.output != desired.output.0
            || entry.workspace != desired.workspace.0
            || entry.rect.x != desired.rect.x
            || entry.rect.y != desired.rect.y
            || entry.rect.w != desired.rect.w
            || entry.rect.h != desired.rect.h
        {
            return false;
        }
    }
    true
}

/// Parse a MoveTiled operation JSON body back to its typed lifecycle form.
fn parse_move_tiled_operation(value: &serde_json::Value) -> Option<LifecycleOperation> {
    if !value.is_object() {
        return None;
    }
    let window = value.get("window").and_then(serde_json::Value::as_str)?;
    let leaf = value.get("leaf").and_then(serde_json::Value::as_str)?;
    let source_output = value
        .get("source_output")
        .and_then(serde_json::Value::as_str)?;
    let source_workspace = value
        .get("source_workspace")
        .and_then(serde_json::Value::as_str)?;
    let target_output = value
        .get("target_output")
        .and_then(serde_json::Value::as_str)?;
    let target_workspace = value
        .get("target_workspace")
        .and_then(serde_json::Value::as_str)?;
    if value.get("op").and_then(serde_json::Value::as_str) != Some("move-tiled") {
        return None;
    }
    if !is_opaque_id(window)
        || !is_opaque_id(leaf)
        || !is_opaque_id(source_output)
        || !is_opaque_id(source_workspace)
        || !is_opaque_id(target_output)
        || !is_opaque_id(target_workspace)
    {
        return None;
    }
    Some(LifecycleOperation::MoveTiled {
        window: WindowId(window.to_owned()),
        leaf: NodeId(leaf.to_owned()),
        source_output: OutputId(source_output.to_owned()),
        source_workspace: WorkspaceId(source_workspace.to_owned()),
        target_output: OutputId(target_output.to_owned()),
        target_workspace: WorkspaceId(target_workspace.to_owned()),
    })
}

/// Parse the exact lifecycle precondition vector from the verify command.
fn parse_lifecycle_preconditions(value: &serde_json::Value) -> Option<Vec<LifecyclePrecondition>> {
    let values = value.as_array()?;
    if values.is_empty() || values.len() > tiler_core::contract::MAX_PRECONDITIONS {
        return None;
    }
    let mut out = Vec::with_capacity(values.len());
    for entry in values {
        out.push(parse_lifecycle_precondition(entry.as_str()?)?);
    }
    Some(out)
}

/// Parse one directional move precondition token (fail-closed on unknown).
fn parse_directional_precondition(value: &str) -> Option<tiler_core::directional::Precondition> {
    use tiler_core::directional::Precondition as P;
    match value {
        "focused-leaf-occupied-by-focused-window" => Some(P::FocusedLeafOccupiedByFocusedWindow),
        "neighbor-leaf-occupied" => Some(P::NeighborLeafOccupied),
        "container-is-direct-parent" => Some(P::ContainerIsDirectParent),
        "target-group-membership" => Some(P::TargetGroupMembership),
        "parent-group-membership" => Some(P::ParentGroupMembership),
        "source-root-membership-and-adjacent-same-workspace-output" => {
            Some(P::SourceRootMembershipAndAdjacentSameWorkspaceOutput)
        }
        "adapter-must-verify-postconditions" => Some(P::AdapterMustVerifyPostconditions),
        _ => None,
    }
}

/// Parse the exact directional precondition vector from the verify command.
fn parse_directional_preconditions(
    value: &serde_json::Value,
) -> Option<Vec<tiler_core::directional::Precondition>> {
    let values = value.as_array()?;
    if values.is_empty() || values.len() > tiler_core::contract::MAX_PRECONDITIONS {
        return None;
    }
    let mut out = Vec::with_capacity(values.len());
    for entry in values {
        out.push(parse_directional_precondition(entry.as_str()?)?);
    }
    Some(out)
}

/// Parse an R4 cross-output move operation from the verify command back to
/// its typed directional form. Strict bounded parsing: requires the exact
/// fenced wire shape emitted in the planned reply (`op`/`rule`/`capability`/
/// left-right `direction`, opaque window/leaf/source/target ids, bounded
/// child index, empty/occupied target). Extra fencing fields are validated
/// for shape; the typed operation equality plus the post-observation geometry
/// check enforce exactness at verify time.
fn parse_directional_move_operation(
    value: &serde_json::Value,
) -> Option<tiler_core::directional::MoveOperation> {
    if !value.is_object() {
        return None;
    }
    if value.get("op").and_then(serde_json::Value::as_str) != Some("move") {
        return None;
    }
    if value.get("rule").and_then(serde_json::Value::as_str) != Some("R4") {
        return None;
    }
    if value.get("capability").and_then(serde_json::Value::as_str) != Some("CrossOutputTransfer") {
        return None;
    }
    let direction = value.get("direction").and_then(serde_json::Value::as_str)?;
    if direction != "left" && direction != "right" {
        return None;
    }
    let window = value.get("window").and_then(serde_json::Value::as_str)?;
    let leaf = value.get("leaf").and_then(serde_json::Value::as_str)?;
    let source_output = value
        .get("source_output")
        .and_then(serde_json::Value::as_str)?;
    let source_workspace = value
        .get("source_workspace")
        .and_then(serde_json::Value::as_str)?;
    let target_output = value
        .get("target_output")
        .and_then(serde_json::Value::as_str)?;
    let target_workspace = value
        .get("target_workspace")
        .and_then(serde_json::Value::as_str)?;
    if !is_opaque_id(window)
        || !is_opaque_id(leaf)
        || !is_opaque_id(source_output)
        || !is_opaque_id(source_workspace)
        || !is_opaque_id(target_output)
        || !is_opaque_id(target_workspace)
    {
        return None;
    }
    let index = value.get("source_root_child_index")?.as_u64()?;
    let Ok(index) = usize::try_from(index) else {
        return None;
    };
    let target = match value.get("target").and_then(serde_json::Value::as_str) {
        Some("empty") => tiler_core::directional::CrossOutputTarget::Empty,
        Some("occupied") => tiler_core::directional::CrossOutputTarget::Occupied,
        _ => return None,
    };
    Some(tiler_core::directional::MoveOperation::CrossOutput {
        rule: tiler_core::directional::Rule::R4,
        target_output: OutputId(target_output.to_owned()),
        target_workspace: WorkspaceId(target_workspace.to_owned()),
        source_root_child_index: index,
        target,
    })
}

/// Exact normalized pre-image match against the dispatch-time observation:
/// focused window plus every carried window exactly once with identical
/// output, workspace, rectangle, and flags. Order-insensitive like the post
/// predicates (adapter enumeration order is not significant), but otherwise
/// byte-exact: any missing, duplicate, extra, mis-homed, mis-sized, or
/// flag-divergent entry fails closed. Pure function, no mutation.
fn pre_image_matches(
    pre_focused: &str,
    pre_windows: &[ObservedDto],
    pre_target_windows: &[ObservedDto],
    ctx: &Validated,
) -> bool {
    if ctx.request.focused_window != pre_focused {
        return false;
    }
    let mut retained: std::collections::HashMap<&str, &ObservedDto> =
        std::collections::HashMap::with_capacity(pre_windows.len() + pre_target_windows.len());
    for entry in pre_windows.iter().chain(pre_target_windows.iter()) {
        if retained.insert(entry.window.as_str(), entry).is_some() {
            return false;
        }
    }
    let mut observed: std::collections::HashMap<&str, &ObservedDto> =
        std::collections::HashMap::with_capacity(
            ctx.request.windows.len() + ctx.request.target_windows.len(),
        );
    for entry in ctx
        .request
        .windows
        .iter()
        .chain(ctx.request.target_windows.iter())
    {
        if observed.insert(entry.window.as_str(), entry).is_some() {
            return false;
        }
    }
    if observed.len() != retained.len() {
        return false;
    }
    for (id, want) in &retained {
        let Some(got) = observed.get(id) else {
            return false;
        };
        if *got != *want {
            return false;
        }
    }
    true
}

/// Complete directional post-observation validation against the retained R4
/// plan: every desired window must be carried exactly once (source plus
/// target homed entries in `windows`) with the expected output, workspace,
/// and rectangle. Any missing, duplicate, extra, mis-homed, or mis-sized
/// window fails closed so a bare `verified: true` never commits.
fn directional_post_matches(pending: &DirectionalMovePending, ctx: &Validated) -> bool {
    let mut observed: std::collections::HashMap<&str, &ObservedDto> =
        std::collections::HashMap::with_capacity(ctx.request.windows.len());
    for entry in ctx.request.windows.iter() {
        if observed.insert(entry.window.as_str(), entry).is_some() {
            return false;
        }
    }
    if observed.len() != pending.desired_geometry.len() {
        return false;
    }
    for desired in &pending.desired_geometry {
        let Some(entry) = observed.get(desired.window.0.as_str()) else {
            return false;
        };
        if entry.output != desired.output.0
            || entry.workspace != desired.workspace.0
            || entry.rect.x != desired.rect.x
            || entry.rect.y != desired.rect.y
            || entry.rect.w != desired.rect.w
            || entry.rect.h != desired.rect.h
        {
            return false;
        }
    }
    true
}

/// Whether a validated request touches either key of a live directional R4
/// pair: its source domain key, any carried directional domain key, or (for
/// the workspace route) its target domain matches the pair.
fn ctx_affects_pair(ctx: &Validated, pending: &DirectionalMovePending) -> bool {
    if ctx.domain_key == pending.source_key || ctx.domain_key == pending.target_key {
        return true;
    }
    if let Some(keys) = ctx.directional_keys.as_ref() {
        for key in keys {
            if *key == pending.source_key || *key == pending.target_key {
                return true;
            }
        }
    }
    if let Some(target) = ctx.request.target_domain.as_ref() {
        if (target.output == pending.source_key.output.0
            && target.workspace == pending.source_key.workspace.0)
            || (target.output == pending.target_key.output.0
                && target.workspace == pending.target_key.workspace.0)
        {
            return true;
        }
    }
    false
}

fn session_domain_matches(session: &Session, domain: &OutputDomain) -> bool {
    session
        .domains()
        .iter()
        .find(|d| d.id == domain.id && d.workspace == domain.workspace)
        .is_some_and(|d| {
            d.bounds == domain.bounds && d.gap == domain.gap && d.adjacent == domain.adjacent
        })
}

fn session_usable(session: &Session) -> bool {
    session.divergence().is_none() && !session.has_pending()
}

/// A committed session with no tiled members and no deferred exceptions holds
/// no topology and must not consume a domain slot.
fn committed_session_is_empty(session: &Session) -> bool {
    session.snapshot().windows.is_empty() && session.exception_count() == 0
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
/// plan. Domain bounds changes reproject the retained tree when the domain key
/// and complete window set remain unchanged; owner/generation change (adapter
/// restart), terminal divergence, pending residue, or membership divergence
/// (`Diverged`/`partial-observation`) discard that domain's retained state and
/// rebuild once via the [`seed_session`] path. If the rebuild cannot safely
/// infer topology (`ambiguous-placement`), reject rather than wedge. Each
/// successful plan is acknowledged then verified in the same call, so no
/// pending crosses calls and no stale data crosses domains/owner/generation.
///
/// Standalone workspace-send route: `send-to-workspace`/`-ack`/`-verify` keep
/// one pending two-domain Session in [`WorkspacePending`], never crossing
/// routes. No owner rebind during pending; pending mismatch/loss/refused
/// ack/failed verification is terminal `diverged`. `send-to-workspace-status`
/// is read-only classification of that pending against a fresh observation
/// and never mutates, acknowledges, verifies, rebinds, or advances anything.
/// `send-to-workspace-cancel` withdraws the pending only on exact identity,
/// scope, unacked state, zero-dispatch attestation, and pre-image proof,
/// preserving everything committed.
///
/// Directional R4 route: `move` with a two-domain payload proposes an R4
/// cross-output transfer once and retains it in [`DirectionalMovePending`]
/// until `directional-move-ack`/`directional-move-verify` commit it. R1-R3
/// stay synchronous with no pending. While either pending exists, all other
/// plan operations block as `pending-exists` (diverged on identity loss) so
/// workspace and directional routes never interleave. `directional-move-status`
/// is the read-only counterpart of the workspace status query, and
/// `directional-move-cancel` the counterpart of the workspace cancellation.
#[derive(Debug, Default)]
pub struct Planner {
    owner: Option<OwnerId>,
    generation: Option<GenerationId>,
    sessions: BTreeMap<DomainKey, Session>,
    domain_outer_gaps: BTreeMap<DomainKey, i32>,
    workspace_pending: Option<WorkspacePending>,
    directional_pending: Option<DirectionalMovePending>,
}

impl Planner {
    /// Empty retained planner.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of retained domains (bounded by [`tiler_core::session::MAX_DOMAINS`]).
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
            self.domain_outer_gaps.clear();
            self.owner = Some(owner.clone());
            self.generation = Some(generation.clone());
        }
    }

    /// Stateful evaluation across calls. Retained reconcile accepts work-area
    /// bounds changes only when the domain key and complete window set remain
    /// unchanged, projecting the existing tree without replacing shares or
    /// topology. The standalone workspace-send and directional-move routes
    /// dispatch their ack/verify phases before the legacy owner/generation
    /// binding sync so a pending Session is never discarded or rebound
    /// mid-flight; legacy requests are unchanged except that any pending
    /// (workspace or directional) blocks all other plan operations. The
    /// read-only status phases dispatch alongside ack/verify (before the
    /// binding sync and the pending conflict boundary) and take `&self` so
    /// they cannot mutate, acknowledge, verify, clear, rebind, or advance
    /// any retained state or topology. The cancellation phases dispatch at
    /// the same boundary but take `&mut self`: on exact pre-image proof they
    /// withdraw only the matching unacknowledged pending and its staged
    /// desired state, preserving everything committed.
    pub fn evaluate(&mut self, request_json: &str) -> String {
        let ctx = match validate_request(request_json) {
            Ok(ctx) => ctx,
            Err(reply) => return reply,
        };
        match validated_op(&ctx).as_str() {
            "send-to-workspace-ack" => return self.evaluate_workspace_ack(&ctx),
            "send-to-workspace-verify" => return self.evaluate_workspace_verify(&ctx),
            "send-to-workspace-status" => return self.evaluate_workspace_status(&ctx),
            "send-to-workspace-cancel" => return self.evaluate_workspace_cancel(&ctx),
            "directional-move-ack" => return self.evaluate_directional_ack(&ctx),
            "directional-move-verify" => return self.evaluate_directional_verify(&ctx),
            "directional-move-status" => return self.evaluate_directional_status(&ctx),
            "directional-move-cancel" => return self.evaluate_directional_cancel(&ctx),
            _ => {}
        }
        // Full global pending conflict boundary: while either pending exists,
        // every other plan operation blocks (diverged on identity/divergence
        // loss, else `pending-exists`). Ack/verify/status/cancel above never
        // reach here.
        if let Some(reply) = self.pending_conflict_reply(&ctx) {
            return reply;
        }
        match validated_op(&ctx).as_str() {
            "send-to-workspace" => return self.evaluate_workspace_request(&ctx),
            _ => {}
        }
        self.sync_binding(&ctx.owner, &ctx.generation);
        match validated_op(&ctx).as_str() {
            "admit" => self.evaluate_admit_retained(&ctx),
            "remove" => self.evaluate_remove_retained(&ctx),
            "move" => self.evaluate_move_retained(&ctx),
            "focus" => self.evaluate_focus_retained(&ctx),
            "resize" => self.evaluate_resize_retained(&ctx),
            "pointer-resize" => self.evaluate_pointer_resize_retained(&ctx),
            "reconcile" => self.evaluate_reconcile_retained(&ctx),
            "update-gaps" => self.evaluate_update_gaps_retained(&ctx),
            "toggle-float" => self.evaluate_toggle_float_retained(&ctx),
            "active-group" => self.evaluate_active_group_retained(&ctx),
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
            self.domain_outer_gaps.remove(domain_key);
            return None;
        }
        // Legacy empty slots never block capacity: drop them lazily without
        // proposing, so a later admission can reuse the slot.
        if committed_session_is_empty(session) {
            self.sessions.remove(domain_key);
            self.domain_outer_gaps.remove(domain_key);
            return None;
        }
        Some(session.clone())
    }

    /// Pending conflict boundary for every non-ack/verify plan operation.
    ///
    /// Directional R4 pending: terminal `diverged` on pending divergence or
    /// owner/generation loss for any operation (so a stale identity never
    /// silently rebinds around the live pair); otherwise the standalone
    /// workspace-send route is blocked entirely and ordinary plans affecting
    /// either pair key are rejected as `pending-exists`. Unrelated domains
    /// stay usable, mirroring the workspace route's existing relocation
    /// behavior.
    ///
    /// Workspace pending: existing single-domain behavior is preserved
    /// untouched; only new directional two-domain moves are blocked here
    /// (diverged on pending divergence/identity loss, else `pending-exists`).
    /// The second-send guard stays inside `evaluate_workspace_request`.
    fn pending_conflict_reply(&self, ctx: &Validated) -> Option<String> {
        let cid = ctx.request.correlation_id.clone();
        let op = validated_op(ctx);
        if let Some(pending) = &self.directional_pending {
            if let Some(reason) = pending.session.divergence() {
                return Some(diverged_reply(&cid, reason));
            }
            if pending.owner != ctx.owner || pending.generation != ctx.generation {
                return Some(diverged_reply(
                    &cid,
                    tiler_core::contract::DivergenceKind::OwnerMismatch,
                ));
            }
            if op == "send-to-workspace" {
                return Some(rejected(
                    cid,
                    "pending-exists",
                    "complete the pending plan before proposing",
                ));
            }
            if op != "active-group" && ctx_affects_pair(ctx, pending) {
                return Some(rejected(
                    cid,
                    "pending-exists",
                    "complete the pending plan before proposing",
                ));
            }
            return None;
        }
        if let Some(pending) = &self.workspace_pending {
            // Only two-domain directional moves enter the conflict zone; all
            // other operations keep their existing behavior.
            if op != "move" || directional_pair(ctx).is_none() {
                return None;
            }
            if let Some(reason) = pending.session.divergence() {
                return Some(diverged_reply(&cid, reason));
            }
            if pending.owner != ctx.owner || pending.generation != ctx.generation {
                return Some(diverged_reply(
                    &cid,
                    tiler_core::contract::DivergenceKind::OwnerMismatch,
                ));
            }
            return Some(rejected(
                cid,
                "pending-exists",
                "complete the pending plan before proposing",
            ));
        }
        None
    }

    fn store_committed(&mut self, domain_key: DomainKey, session: Session, outer_gap: i32) {
        // A committed remove that empties the domain retires its session at
        // the same applied boundary so the slot is released. Zero-window
        // sessions are never retained.
        if committed_session_is_empty(&session) {
            self.sessions.remove(&domain_key);
            self.domain_outer_gaps.remove(&domain_key);
            return;
        }
        if self.sessions.len() >= tiler_core::session::MAX_DOMAINS
            && !self.sessions.contains_key(&domain_key)
        {
            // Retained topology is authoritative. A capacity miss must never
            // evict unrelated domains and force their later spatial rebuild.
            return;
        }
        self.domain_outer_gaps.insert(domain_key.clone(), outer_gap);
        self.sessions.insert(domain_key, session);
    }

    fn canonical_component_domain(domain: &OutputDomain) -> OutputDomain {
        OutputDomain {
            id: domain.id.clone(),
            workspace: domain.workspace.clone(),
            bounds: domain.bounds,
            gap: domain.gap,
            adjacent: BTreeMap::new(),
        }
    }

    /// Assemble a temporary directional view solely from canonical per-domain
    /// sessions. This deliberately never infers a tree from current geometry:
    /// selected cross-output paths require retained authoritative state.
    fn canonical_directional_pair(
        &mut self,
        source_domain: &OutputDomain,
        source_key: &DomainKey,
        target_domain: &OutputDomain,
        target_key: &DomainKey,
    ) -> Result<Session, &'static str> {
        let source_component = Self::canonical_component_domain(source_domain);
        let target_component = Self::canonical_component_domain(target_domain);
        // Cross-domain pairing must never discard a canonical component merely
        // because an adjacent work area changed. A normal reconcile owns that
        // update; this selected path fails closed without spatial rebuilding.
        let source = self
            .sessions
            .get(source_key)
            .filter(|session| {
                session_usable(session)
                    && !committed_session_is_empty(session)
                    && session_domain_matches(session, &source_component)
            })
            .cloned()
            .ok_or("canonical-source-unavailable")?;
        let target = match self.sessions.get(target_key) {
            None => None,
            Some(session)
                if session_usable(session)
                    && !committed_session_is_empty(session)
                    && session_domain_matches(session, &target_component) =>
            {
                Some(session.clone())
            }
            Some(_) => return Err("canonical-pair-unusable"),
        };
        Session::paired_from_canonical(
            &source,
            target.as_ref(),
            vec![source_domain.clone(), target_domain.clone()],
        )
        .map_err(|error| match error {
            tiler_core::session::CanonicalPairError::MismatchedIdentity => {
                "canonical-pair-identity-mismatch"
            }
            tiler_core::session::CanonicalPairError::UnusableInput => "canonical-pair-unusable",
            tiler_core::session::CanonicalPairError::DomainMismatch => {
                "canonical-pair-domain-mismatch"
            }
            tiler_core::session::CanonicalPairError::DuplicateState => {
                "canonical-pair-duplicate-state"
            }
        })
    }

    /// Return a terminal two-domain transaction to the sole canonical state
    /// authority. The pair is never retained after this boundary.
    fn store_canonical_directional_pair(
        &mut self,
        source_key: DomainKey,
        target_key: DomainKey,
        pair: Session,
        source_outer_gap: i32,
    ) -> bool {
        let Ok((source, target)) = pair.split_canonical_pair() else {
            return false;
        };
        let target_outer_gap = self
            .domain_outer_gaps
            .get(&target_key)
            .copied()
            .unwrap_or(0);
        self.store_committed(source_key, source, source_outer_gap);
        if let Some(target) = target {
            self.store_committed(target_key, target, target_outer_gap);
        } else {
            self.sessions.remove(&target_key);
            self.domain_outer_gaps.remove(&target_key);
        }
        true
    }

    /// Portable output relocation: when no usable session exists for the
    /// target key, move a usable retained session with the same workspace id
    /// from a different output to the target, preserving topology, shares,
    /// focus, exceptions, and revision. Updates domain bounds/gap plus window
    /// and exception homing. Session-local only, no history. A target session
    /// that existed at the start of request handling is never removed or
    /// superseded to permit source relocation: `try_relocate_for_target`
    /// returns false without mutation if `sessions` contains the target,
    /// even when that target is empty, unusable, or mismatched (normal
    /// target cleanup/seeding owns that slot). Fails closed with no source
    /// mutation when no single usable non-empty source exists, when a
    /// standalone workspace-send or directional R4 move is pending, when the
    /// request outer gap is out of range, or when the move itself refuses. The
    /// insert honors
    /// normal `store_committed` constraints (never retain empty, never exceed
    /// `MAX_DOMAINS`) without the all-domain clearing eviction: at capacity
    /// the relocation fails closed and the source is restored. The standalone
    /// workspace-send route is untouched.
    fn try_relocate_for_target(
        &mut self,
        target_key: &DomainKey,
        target_domain: &OutputDomain,
        request_outer_gap: i32,
    ) -> bool {
        if self.workspace_pending.is_some() || self.directional_pending.is_some() {
            return false;
        }
        if request_outer_gap < 0 || request_outer_gap > GEOMETRY_MAX_GAP {
            return false;
        }
        // Target collision: a session that exists for the target at handling
        // start is never removed or superseded for relocation, even if it is
        // empty, unusable, or mismatched. Normal target cleanup/seeding owns
        // that slot.
        if self.sessions.contains_key(target_key) {
            return false;
        }
        let mut source_key: Option<DomainKey> = None;
        for key in self.sessions.keys() {
            if key.workspace == target_key.workspace && key.output != target_key.output {
                if source_key.is_some() {
                    // Ambiguous source: fail closed, no mutation.
                    return false;
                }
                source_key = Some(key.clone());
            }
        }
        let Some(source) = source_key else {
            return false;
        };
        let Some(session) = self.sessions.get(&source) else {
            return false;
        };
        if !session_usable(session) {
            return false;
        }
        // Pending-desired and drag residue refuse like the session does;
        // `session_usable` covers divergence/pending, these cover the rest.
        if session.has_pending_desired() || session.has_drag() {
            return false;
        }
        if committed_session_is_empty(session) {
            return false;
        }
        // Validate the move on a clone first: no retained mutation yet.
        let mut moved = session.clone();
        if !moved.relocate_domain(&source, target_key, target_domain.bounds, target_domain.gap) {
            return false;
        }
        if committed_session_is_empty(&moved) {
            return false;
        }
        // All validation passed: mutate. Capacity was freed by removing the
        // source; insert under normal constraints without all-clear.
        let backup_session = session.clone();
        let backup_outer = self.domain_outer_gaps.get(&source).copied();
        self.domain_outer_gaps.remove(&source);
        self.sessions.remove(&source);
        if self.sessions.len() >= tiler_core::session::MAX_DOMAINS {
            // Fail closed, restore source, no clearing.
            self.sessions.insert(source.clone(), backup_session);
            if let Some(gap) = backup_outer {
                self.domain_outer_gaps.insert(source, gap);
            }
            return false;
        }
        self.domain_outer_gaps
            .insert(target_key.clone(), request_outer_gap);
        self.sessions.insert(target_key.clone(), moved);
        true
    }

    /// Shared retained propose/commit: try the usable retained session, then
    /// rebuild once from `seed_order`. `ambiguous_as_snapshot` selects the
    /// fail-closed kind when no safe order exists (admit/remove use
    /// `ambiguous-placement`; directional ops reuse the `snapshot-invalid`
    /// mapping).
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
        // Target presence at handling start: normal target processing/seeding
        // owns that slot. Source relocation is attempted only when no target
        // session existed, even if normal cleanup removes a stale target
        // below. This preserves existing non-hotplug behavior.
        let target_existed = self.sessions.contains_key(&ctx.domain_key);
        if let Some(mut session) = self.take_usable_session(&ctx.domain_key, &ctx.domain) {
            let base = session.accepted_revision();
            let observation = observation_for(base, ctx);
            match propose(&mut session, &observation) {
                Ok(plan) => {
                    let text = reply(&plan);
                    if commit(&mut session, &plan, ctx, base) {
                        self.store_committed(
                            ctx.domain_key.clone(),
                            session,
                            ctx.request.domain.outer_gap,
                        );
                        return text;
                    }
                    self.sessions.remove(&ctx.domain_key);
                    self.domain_outer_gaps.remove(&ctx.domain_key);
                    return snapshot_invalid(cid, MSG_OBSERVATION, "commit-rejected");
                }
                Err(error) if needs_rebuild(&error) => {
                    self.sessions.remove(&ctx.domain_key);
                    self.domain_outer_gaps.remove(&ctx.domain_key);
                }
                Err(error) => {
                    return propose_failure(error, cid.clone());
                }
            }
        } else if !target_existed {
            // Displaced workspace relocation: same workspace id observed on a
            // different output (monitor disconnect/reconnect) reuses the
            // retained tree instead of reseeding, preserving CURRENT contents
            // convergence through the normal propose path below. A rejected
            // follow-up leaves retained state untouched: the source backup is
            // restored before falling through or replying.
            let backup_sessions = self.sessions.clone();
            let backup_gaps = self.domain_outer_gaps.clone();
            if self.try_relocate_for_target(
                &ctx.domain_key,
                &ctx.domain,
                ctx.request.domain.outer_gap,
            ) {
                if let Some(mut session) = self.take_usable_session(&ctx.domain_key, &ctx.domain) {
                    let base = session.accepted_revision();
                    let observation = observation_for(base, ctx);
                    match propose(&mut session, &observation) {
                        Ok(plan) => {
                            let text = reply(&plan);
                            if commit(&mut session, &plan, ctx, base) {
                                self.store_committed(
                                    ctx.domain_key.clone(),
                                    session,
                                    ctx.request.domain.outer_gap,
                                );
                                return text;
                            }
                            // Commit rejected: restore source, no mutation.
                            self.sessions = backup_sessions;
                            self.domain_outer_gaps = backup_gaps;
                            return snapshot_invalid(cid, MSG_OBSERVATION, "commit-rejected");
                        }
                        Err(error) if needs_rebuild(&error) => {
                            // Rebuild path: restore source, then fall through
                            // to seed the target from scratch.
                            self.sessions = backup_sessions;
                            self.domain_outer_gaps = backup_gaps;
                        }
                        Err(error) => {
                            self.sessions = backup_sessions;
                            self.domain_outer_gaps = backup_gaps;
                            return propose_failure(error, cid.clone());
                        }
                    }
                } else {
                    // Relocated target unusable: restore source, fall through.
                    self.sessions = backup_sessions;
                    self.domain_outer_gaps = backup_gaps;
                }
            }
        }
        let Some(order) = seed_order else {
            if ambiguous_as_snapshot {
                return snapshot_invalid(cid, MSG_OBSERVATION, "missing-seed-order");
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
            return snapshot_invalid(cid, MSG_OBSERVATION, "seed-failed");
        };
        let base = session.accepted_revision();
        let observation = observation_for(base, ctx);
        match propose(&mut session, &observation) {
            Ok(plan) => {
                let text = reply(&plan);
                if commit(&mut session, &plan, ctx, base) {
                    self.store_committed(
                        ctx.domain_key.clone(),
                        session,
                        ctx.request.domain.outer_gap,
                    );
                    return text;
                }
                snapshot_invalid(cid, MSG_OBSERVATION, "commit-rejected")
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
        if command.op != "admit" {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "admit-op-invalid",
            );
        }
        if !is_opaque_id(&command.window) {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "admit-window-invalid",
            );
        }
        if !is_opaque_id(&command.output) {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "admit-output-invalid",
            );
        }
        if !is_opaque_id(&command.workspace) {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "admit-workspace-invalid",
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
                    return snapshot_invalid(
                        ctx.request.correlation_id.clone(),
                        MSG_OBSERVATION,
                        "placement-bounds-invalid",
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
        // Flat strip fit: truly fresh domains only (no retained session at
        // all, including empty/pending/diverged/mismatch slots which stay on
        // `run_retained`), `admit` only, no explicit placement bounds, and the
        // admitted window is the focused window. The fitted topology still
        // goes through the real proposal/acknowledgement/`verify_lifecycle`
        // commit path with pre-commit base revision 0. Anything unsupported
        // falls through to the normal seed/reflow below, independently per
        // foreground or background domain through this same admit route.
        if placement_explicit.is_none()
            && command.window == ctx.request.focused_window
            && self.sessions.get(&ctx.domain_key).is_none()
            && let Some((tree, links)) = try_flat_strip_fit(&ctx.domain, &ctx.request.windows)
            && let Some(focus_leaf) = links
                .iter()
                .find(|l| l.window.0 == command.window)
                .map(|l| l.leaf.clone())
        {
            if let Ok(mut fitted) = Session::new(
                ctx.owner.clone(),
                ctx.generation.clone(),
                0,
                ctx.request.fingerprint,
                vec![ctx.domain.clone()],
            ) {
                let base = fitted.accepted_revision();
                let observation = observation_for(base, ctx);
                let window = WindowId(command.window.clone());
                let output = OutputId(command.output.clone());
                let workspace = WorkspaceId(command.workspace.clone());
                if let Ok(plan) = fitted.propose_fitted_admit(
                    tree,
                    links,
                    focus_leaf,
                    &window,
                    &output,
                    &workspace,
                    &observation,
                    &ctx.correlation,
                    &LifecycleCapabilities::full(),
                ) {
                    let text = planned_reply(
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
                    );
                    if acknowledge(&mut fitted, ctx, base) {
                        let post = tiler_core::contract::LifecyclePostObservation::new(
                            Observation::new(
                                ctx.owner.clone(),
                                ctx.generation.clone(),
                                base,
                                ctx.request.fingerprint,
                            ),
                            ctx.correlation.clone(),
                            true,
                            plan.dispatch.preconditions.clone(),
                            plan.dispatch.operation.clone(),
                        );
                        if fitted.verify_lifecycle(&post).is_ok() {
                            self.store_committed(
                                ctx.domain_key.clone(),
                                fitted,
                                ctx.request.domain.outer_gap,
                            );
                            return text;
                        }
                    }
                }
            }
        }
        let seed_order = spatial_with_focus_last(
            ctx.request
                .windows
                .iter()
                .filter(|w| w.window != command.window)
                .cloned()
                .collect(),
            &ctx.request.focused_window,
            true,
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
                let post = tiler_core::contract::LifecyclePostObservation::new(
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
        if command.op != "remove" {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "remove-op-invalid",
            );
        }
        if !is_opaque_id(&command.window) {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "remove-window-invalid",
            );
        }
        let seed_order = spatial_with_focus_last(
            ctx.request.windows.clone(),
            &ctx.request.focused_window,
            false,
        );
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
                let post = tiler_core::contract::LifecyclePostObservation::new(
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

    fn evaluate_toggle_float_retained(&mut self, ctx: &Validated) -> String {
        if ctx
            .request
            .windows
            .iter()
            .find(|entry| {
                entry.window
                    == ctx
                        .request
                        .command
                        .get("window")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default()
            })
            .is_some_and(|entry| entry.floating)
            && !self.sessions.contains_key(&ctx.domain_key)
        {
            return rejected(
                ctx.request.correlation_id.clone(),
                RefusalKind::NotTiled.as_str(),
                RefusalKind::NotTiled.message(),
            );
        }
        evaluate_toggle_float_with(ctx, |command, float_rect| {
            let seed_order = spatial_with_focus_last(
                ctx.request.windows.clone(),
                &ctx.request.focused_window,
                false,
            );
            let window = WindowId(command.window.clone());
            self.run_retained(
                ctx,
                seed_order,
                true,
                |session, observation| {
                    session
                        .propose(
                            &SessionCommand::ToggleFloat {
                                window: window.clone(),
                                float_geometry: float_rect,
                            },
                            observation,
                            &ctx.correlation,
                            &LifecycleCapabilities::full(),
                        )
                        .map(|plan| {
                            let effective = session.pending_float_geometry(&window);
                            (plan, effective)
                        })
                },
                |result| float_planned_reply(&ctx.request.correlation_id, &result.0, result.1),
                |session, result, c, base| {
                    if !acknowledge(session, c, base) {
                        return false;
                    }
                    session
                        .verify_lifecycle(&LifecyclePostObservation::new(
                            Observation::new(
                                c.owner.clone(),
                                c.generation.clone(),
                                base,
                                c.request.fingerprint,
                            ),
                            c.correlation.clone(),
                            true,
                            result.0.dispatch.preconditions.clone(),
                            result.0.dispatch.operation.clone(),
                        ))
                        .is_ok()
                },
            )
        })
    }

    fn evaluate_move_retained(&mut self, ctx: &Validated) -> String {
        let command: DirectedCommand = match serde_json::from_value(ctx.request.command.clone()) {
            Ok(command) => command,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        if command.op != "move" {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "move-op-invalid",
            );
        }
        // Production directional route: two-domain observations build one
        // temporary pair from canonical retained domain sessions.
        // Single-domain legacy requests fall through unchanged.
        if directional_pair(ctx).is_some() {
            return self.evaluate_move_directional(ctx, &command);
        }
        if !is_opaque_id(&command.window) {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "move-window-invalid",
            );
        }
        let Some(direction) = parse_direction(&command.direction) else {
            return rejected(
                ctx.request.correlation_id.clone(),
                "direction-invalid",
                MSG_DIRECTION,
            );
        };
        let seed_order = spatial_with_focus_last(
            ctx.request.windows.clone(),
            &ctx.request.focused_window,
            false,
        );
        let window = WindowId(command.window.clone());
        self.run_retained(
            ctx,
            seed_order,
            true,
            |session, observation| {
                let _ = session.sync_focus_from_window(
                    &ctx.domain_key,
                    &WindowId(ctx.request.focused_window.clone()),
                );
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
                let post = tiler_core::contract::PostObservation::new(
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
        if command.op != "focus" {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "focus-op-invalid",
            );
        }
        // Production directional route: two-domain observations try local
        // focus first, then the exhausted Left/Right cross-output proposal
        // against a temporary pair built from canonical domain state.
        // Single-domain legacy requests fall through unchanged.
        if directional_pair(ctx).is_some() {
            return self.evaluate_focus_directional(ctx, &command);
        }
        if !is_opaque_id(&command.window) {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "focus-window-invalid",
            );
        }
        let Some(direction) = parse_direction(&command.direction) else {
            return rejected(
                ctx.request.correlation_id.clone(),
                "direction-invalid",
                MSG_DIRECTION,
            );
        };
        let seed_order = spatial_with_focus_last(
            ctx.request.windows.clone(),
            &ctx.request.focused_window,
            false,
        );
        let window = WindowId(command.window.clone());
        self.run_retained(
            ctx,
            seed_order,
            true,
            |session, observation| {
                let _ = session.sync_focus_from_window(
                    &ctx.domain_key,
                    &WindowId(ctx.request.focused_window.clone()),
                );
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
                let post = tiler_core::contract::FocusPostObservation::new(
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

    /// Production directional move: retained two-domain session, existing
    /// local R1/R2/R3 first (S21 no-cross preserved) and committed
    /// synchronously exactly as before, crossing only at the actual output
    /// boundary via the multi-domain R4 planner (S20/S22/S23). R4 cross-output
    /// transfers no longer acknowledge/verify/split synchronously: they
    /// propose once and retain a [`DirectionalMovePending`] pair Session until
    /// an exact accepted `directional-move-ack` and a matching verified
    /// `directional-move-verify` post-observation commit it. Complete
    /// source+target geometry, focus follow, and the existing
    /// owner/generation/revision/correlation/single-pending/total-observation/
    /// duplicate/stale/visibility safeguards apply. Up/Down never cross (the
    /// directional core gates R4 to Left/Right).
    fn evaluate_move_directional(&mut self, ctx: &Validated, command: &DirectedCommand) -> String {
        let cid = ctx.request.correlation_id.clone();
        if !is_opaque_id(&command.window) {
            return snapshot_invalid(cid, MSG_OPAQUE_ID, "move-window-invalid");
        }
        let Some(direction) = parse_direction(&command.direction) else {
            return rejected(cid, "direction-invalid", MSG_DIRECTION);
        };
        let Some((source_domain, source_key, target_domain, target_key)) = directional_pair(ctx)
        else {
            return snapshot_invalid(cid, MSG_OBSERVATION, "domain-invalid");
        };
        let window = WindowId(command.window.clone());
        let mut session = match self.canonical_directional_pair(
            source_domain,
            source_key,
            target_domain,
            target_key,
        ) {
            Ok(session) => session,
            Err(detail) => return snapshot_invalid(cid, MSG_OBSERVATION, detail),
        };
        let base = session.accepted_revision();
        let observation = observation_for(base, ctx);
        match self.propose_directional_move(
            &mut session,
            ctx,
            command,
            source_key,
            &window,
            direction,
            &observation,
        ) {
            Ok(plan) => {
                // R4 cross-output: stage the async pending, never sync-commit.
                if matches!(
                    plan.dispatch.operation,
                    tiler_core::directional::MoveOperation::CrossOutput { .. }
                ) {
                    // Global boundary already blocks when either pending
                    // exists, but refuse here as well without mutation when a
                    // wedged or live pending is present.
                    if let Some(pending) = &self.directional_pending {
                        if let Some(reason) = pending.session.divergence() {
                            return diverged_reply(&cid, reason);
                        }
                        return rejected(
                            cid,
                            "pending-exists",
                            "complete the pending plan before proposing",
                        );
                    }
                    if let Some(pending) = &self.workspace_pending {
                        if let Some(reason) = pending.session.divergence() {
                            return diverged_reply(&cid, reason);
                        }
                        return rejected(
                            cid,
                            "pending-exists",
                            "complete the pending plan before proposing",
                        );
                    }
                    let target_outer_gap = ctx
                        .raw
                        .get("domains")
                        .and_then(serde_json::Value::as_array)
                        .and_then(|entries| entries.get(1))
                        .and_then(|entry| entry.get("outer_gap"))
                        .and_then(serde_json::Value::as_i64)
                        .filter(|gap| (0..=i64::from(GEOMETRY_MAX_GAP)).contains(gap))
                        .map(|gap| gap as i32)
                        .unwrap_or(0);
                    let text = self.move_directional_reply(ctx, direction, &plan);
                    self.directional_pending = Some(DirectionalMovePending {
                        owner: ctx.owner.clone(),
                        generation: ctx.generation.clone(),
                        correlation: ctx.correlation.clone(),
                        base_revision: base,
                        request_revision: ctx.request.revision,
                        session,
                        source_key: source_key.clone(),
                        target_key: target_key.clone(),
                        source_outer_gap: ctx.request.domain.outer_gap,
                        target_outer_gap,
                        desired_geometry: plan.desired_geometry.clone(),
                        operation: plan.dispatch.operation.clone(),
                        preconditions: plan.dispatch.preconditions.clone(),
                        pre_focused: ctx.request.focused_window.clone(),
                        pre_windows: ctx.request.windows.clone(),
                    });
                    return text;
                }
                // R1-R3 local: synchronous acknowledge/verify/split, unchanged.
                let text = self.move_directional_reply(ctx, direction, &plan);
                if self.commit_move_directional(&mut session, ctx, &plan, base) {
                    if self.store_canonical_directional_pair(
                        source_key.clone(),
                        target_key.clone(),
                        session,
                        ctx.request.domain.outer_gap,
                    ) {
                        return text;
                    }
                }
                snapshot_invalid(cid, MSG_OBSERVATION, "commit-rejected")
            }
            Err(error) => propose_failure(error, cid),
        }
    }

    fn propose_directional_move(
        &self,
        session: &mut Session,
        ctx: &Validated,
        command: &DirectedCommand,
        source_key: &DomainKey,
        window: &WindowId,
        direction: Direction,
        observation: &SessionObservation,
    ) -> Result<tiler_core::session::SessionMovePlan, ProposeError> {
        let _ = session
            .sync_focus_from_window(source_key, &WindowId(ctx.request.focused_window.clone()));
        let mut capabilities = Capabilities::full();
        capabilities.cross_output_transfer = command.cross_output_transfer;
        session.propose_move(
            source_key,
            window,
            direction,
            observation,
            &ctx.correlation,
            &capabilities,
        )
    }

    /// Production directional move reply. R4 cross-output plans carry the
    /// exact operation/preconditions the adapter must fence (source, target,
    /// direction, mover, target workspace, R4 rule, transfer capability);
    /// local R1/R2/R3 plans carry neither, like the legacy route.
    fn move_directional_reply(
        &self,
        ctx: &Validated,
        direction: Direction,
        plan: &tiler_core::session::SessionMovePlan,
    ) -> String {
        let detail = serde_json::json!({
            "kind": "move",
            "rule": format!("{:?}", plan.dispatch.rule),
            "capability": format!("{:?}", plan.dispatch.required_capability),
            "direction": direction_str(direction),
        });
        let focus = Some((&plan.desired_focus_domain, &plan.desired_focus_leaf));
        match &plan.dispatch.operation {
            tiler_core::directional::MoveOperation::CrossOutput {
                rule,
                target_output,
                target_workspace,
                source_root_child_index,
                target,
            } => {
                let Some((_, source_key, _, _)) = directional_pair(ctx) else {
                    return snapshot_invalid(
                        ctx.request.correlation_id.clone(),
                        MSG_OBSERVATION,
                        "domain-invalid",
                    );
                };
                let operation_value = serde_json::json!({
                    "op": "move",
                    "rule": format!("{rule:?}"),
                    "capability": format!("{:?}", plan.dispatch.required_capability),
                    "direction": direction_str(plan.dispatch.intent.direction),
                    "window": plan.dispatch.intent.focused_window.0,
                    "leaf": plan.dispatch.intent.focused_leaf.0,
                    "source_output": source_key.output.0,
                    "source_workspace": source_key.workspace.0,
                    "target_output": target_output.0,
                    "target_workspace": target_workspace.0,
                    "source_root_child_index": source_root_child_index,
                    "target": match target {
                        tiler_core::directional::CrossOutputTarget::Empty => "empty",
                        tiler_core::directional::CrossOutputTarget::Occupied => "occupied",
                    },
                });
                let preconditions: Vec<&'static str> = plan
                    .dispatch
                    .preconditions
                    .iter()
                    .map(|p| move_precondition_str(*p))
                    .collect();
                serialize_bounded(&PlanReply {
                    v: PLAN_CONTRACT_VERSION,
                    correlation_id: ctx.request.correlation_id.clone(),
                    outcome: "planned",
                    kind: None,
                    message: None,
                    base_revision: Some(plan.dispatch.base_revision),
                    detail: Some(detail),
                    desired_geometry: Some(
                        plan.desired_geometry.iter().map(geometry_reply).collect(),
                    ),
                    desired_focus: focus.map(|(domain, leaf)| focus_reply(domain, leaf)),
                    float_geometry: None,
                    preconditions: Some(preconditions),
                    operation: Some(operation_value),
                })
            }
            _ => planned_reply(
                &ctx.request.correlation_id,
                plan.dispatch.base_revision,
                detail,
                &plan.desired_geometry,
                focus,
            ),
        }
    }

    fn commit_move_directional(
        &self,
        session: &mut Session,
        ctx: &Validated,
        plan: &tiler_core::session::SessionMovePlan,
        base: u64,
    ) -> bool {
        if !acknowledge(session, ctx, base) {
            return false;
        }
        let post = tiler_core::contract::PostObservation::new(
            Observation::new(
                ctx.owner.clone(),
                ctx.generation.clone(),
                base,
                ctx.request.fingerprint,
            ),
            ctx.correlation.clone(),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        );
        session.verify_move(&post).is_ok()
    }

    /// Production directional focus: local focus first; on local `Unchanged`
    /// and Left/Right call `Session::propose_cross_output_focus` to the
    /// adjacent output's current workspace last-focused leaf. Up/Down stay
    /// local (no vertical crossing). Exactly one focus actuation downstream;
    /// no geometry/layout/window membership writes.
    fn evaluate_focus_directional(&mut self, ctx: &Validated, command: &DirectedCommand) -> String {
        let cid = ctx.request.correlation_id.clone();
        if !is_opaque_id(&command.window) {
            return snapshot_invalid(cid, MSG_OPAQUE_ID, "focus-window-invalid");
        }
        let Some(direction) = parse_direction(&command.direction) else {
            return rejected(cid, "direction-invalid", MSG_DIRECTION);
        };
        let Some((source_domain, source_key, target_domain, target_key)) = directional_pair(ctx)
        else {
            return snapshot_invalid(cid, MSG_OBSERVATION, "domain-invalid");
        };
        let window = WindowId(command.window.clone());
        let mut session = match self.canonical_directional_pair(
            source_domain,
            source_key,
            target_domain,
            target_key,
        ) {
            Ok(session) => session,
            Err(detail) => return snapshot_invalid(cid, MSG_OBSERVATION, detail),
        };
        let base = session.accepted_revision();
        let observation = observation_for(base, ctx);
        match self.propose_directional_focus(
            &mut session,
            ctx,
            source_key,
            &window,
            direction,
            &observation,
        ) {
            Ok((plan, crossed)) => {
                let text = self.focus_directional_reply(ctx, direction, &plan, crossed);
                if self.commit_focus_directional(&mut session, ctx, &plan, base) {
                    if self.store_canonical_directional_pair(
                        source_key.clone(),
                        target_key.clone(),
                        session,
                        ctx.request.domain.outer_gap,
                    ) {
                        return text;
                    }
                }
                snapshot_invalid(cid, MSG_OBSERVATION, "commit-rejected")
            }
            Err(error) => propose_failure(error, cid),
        }
    }

    fn propose_directional_focus(
        &self,
        session: &mut Session,
        ctx: &Validated,
        source_key: &DomainKey,
        window: &WindowId,
        direction: Direction,
        observation: &SessionObservation,
    ) -> Result<(tiler_core::session::SessionFocusPlan, bool), ProposeError> {
        let _ = session
            .sync_focus_from_window(source_key, &WindowId(ctx.request.focused_window.clone()));
        // Local first: any local target wins (no cross).
        match session.propose_focus(
            source_key,
            window,
            direction,
            observation,
            &ctx.correlation,
            &FocusCapabilities::full(),
        ) {
            Ok(plan) => Ok((plan, false)),
            Err(ProposeError::Refused(RefusalKind::Unchanged))
                if matches!(direction, Direction::Left | Direction::Right) =>
            {
                // Exhausted horizontal edge: cross to the adjacent output's
                // current workspace last-focused leaf. Up/Down never reach
                // here (local Unchanged stays terminal for them).
                session
                    .propose_cross_output_focus(
                        source_key,
                        window,
                        direction,
                        observation,
                        &ctx.correlation,
                        &FocusCapabilities::full(),
                    )
                    .map(|plan| (plan, true))
            }
            Err(other) => Err(other),
        }
    }

    fn focus_directional_reply(
        &self,
        ctx: &Validated,
        direction: Direction,
        plan: &tiler_core::session::SessionFocusPlan,
        crossed: bool,
    ) -> String {
        if crossed {
            cross_focus_planned_reply(
                &ctx.request.correlation_id,
                plan.dispatch.base_revision,
                serde_json::json!({
                    "kind": "focus",
                    "capability": "directional-focus",
                    "direction": direction_str(direction),
                    "to_window": plan.dispatch.operation.to_window.0,
                    "cross_output": true,
                }),
                &plan.desired_geometry,
                (&plan.desired_focus_domain, &plan.desired_focus_leaf),
                &plan.dispatch.operation,
            )
        } else {
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
        }
    }

    fn commit_focus_directional(
        &self,
        session: &mut Session,
        ctx: &Validated,
        plan: &tiler_core::session::SessionFocusPlan,
        base: u64,
    ) -> bool {
        if !acknowledge(session, ctx, base) {
            return false;
        }
        let post = tiler_core::contract::FocusPostObservation::new(
            Observation::new(
                ctx.owner.clone(),
                ctx.generation.clone(),
                base,
                ctx.request.fingerprint,
            ),
            ctx.correlation.clone(),
            true,
            plan.dispatch.preconditions.clone(),
            plan.dispatch.operation.clone(),
        );
        session.verify_focus(&post).is_ok()
    }

    fn evaluate_resize_retained(&mut self, ctx: &Validated) -> String {
        let command: ResizeCommand = match serde_json::from_value(ctx.request.command.clone()) {
            Ok(command) => command,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        if command.op != "resize" {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "resize-op-invalid",
            );
        }
        if !is_opaque_id(&command.window) {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "resize-window-invalid",
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
        let seed_order = spatial_with_focus_last(
            ctx.request.windows.clone(),
            &ctx.request.focused_window,
            false,
        );
        let window = WindowId(command.window.clone());
        let capabilities = tiler_core::contract::ResizeCapabilities {
            keyboard_resize: true,
            pointer_resize: false,
        };
        self.run_retained(
            ctx,
            seed_order,
            true,
            |session, observation| {
                let _ = session.sync_focus_from_window(
                    &ctx.domain_key,
                    &WindowId(ctx.request.focused_window.clone()),
                );
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
                let post = tiler_core::contract::ResizePostObservation::new(
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

    fn evaluate_pointer_resize_retained(&mut self, ctx: &Validated) -> String {
        let command: PointerResizeCommand =
            match serde_json::from_value(ctx.request.command.clone()) {
                Ok(command) => command,
                Err(error) => {
                    let (kind, message) = classify_parse_error(&error);
                    return rejected(valid_correlation_echo(&ctx.raw), kind, message);
                }
            };
        if command.op != "pointer-resize" {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "pointer-resize-op-invalid",
            );
        }
        if !is_opaque_id(&command.window) {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "pointer-resize-window-invalid",
            );
        }
        let Some(direction) = parse_direction(&command.direction) else {
            return rejected(
                ctx.request.correlation_id.clone(),
                "direction-invalid",
                MSG_DIRECTION,
            );
        };
        let seed_order = spatial_with_focus_last(
            ctx.request.windows.clone(),
            &ctx.request.focused_window,
            false,
        );
        let window = WindowId(command.window.clone());
        let boundary = command.boundary;
        let capabilities = tiler_core::contract::ResizeCapabilities {
            keyboard_resize: false,
            pointer_resize: true,
        };
        self.run_retained(
            ctx,
            seed_order,
            true,
            |session, observation| {
                let _ = session.sync_focus_from_window(
                    &ctx.domain_key,
                    &WindowId(ctx.request.focused_window.clone()),
                );
                session.propose_pointer_resize(
                    &ctx.domain_key,
                    &window,
                    direction,
                    boundary,
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
                        "kind": "pointer-resize",
                        "capability": "pointer-resize",
                        "direction": direction_str(direction),
                        "boundary": boundary,
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
                let post = tiler_core::contract::ResizePostObservation::new(
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

    fn evaluate_reconcile_retained(&mut self, ctx: &Validated) -> String {
        let command: ReconcileCommand = match serde_json::from_value(ctx.request.command.clone()) {
            Ok(command) => command,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        if command.op != "reconcile" {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "reconcile-op-invalid",
            );
        }
        let cid = ctx.request.correlation_id.clone();
        // Displaced workspace relocation for reconcile: same workspace id on
        // a different output reuses the retained tree. No retained mutation
        // occurs on any rejection: outer-gap is pre-validated against the
        // source before mutating, and any later rejection restores the source.
        let backup_sessions = self.sessions.clone();
        let backup_gaps = self.domain_outer_gaps.clone();
        let mut relocated_here = false;
        if !self.sessions.contains_key(&ctx.domain_key) {
            // Pre-validate outer-gap against the unique source so a mismatch
            // fails closed with no mutation (target collision inside
            // `try_relocate_for_target` likewise mutates nothing).
            let mut source_key: Option<DomainKey> = None;
            for key in self.sessions.keys() {
                if key.workspace == ctx.domain_key.workspace && key.output != ctx.domain_key.output
                {
                    if source_key.is_some() {
                        source_key = None;
                        break;
                    }
                    source_key = Some(key.clone());
                }
            }
            let outer_ok = match &source_key {
                Some(source) => {
                    self.domain_outer_gaps.get(source).copied()
                        == Some(ctx.request.domain.outer_gap)
                }
                None => false,
            };
            if outer_ok {
                relocated_here = self.try_relocate_for_target(
                    &ctx.domain_key,
                    &ctx.domain,
                    ctx.request.domain.outer_gap,
                );
            }
        }
        // Restore helper: any rejection below with `relocated_here` set
        // returns retained state to the pre-request backup.
        macro_rules! restore_on_reject {
            () => {
                if relocated_here {
                    self.sessions = backup_sessions.clone();
                    self.domain_outer_gaps = backup_gaps.clone();
                }
            };
        }
        let Some(session) = self.sessions.get(&ctx.domain_key).cloned() else {
            restore_on_reject!();
            return rejected(
                cid,
                RefusalKind::UnknownDomain.as_str(),
                RefusalKind::UnknownDomain.message(),
            );
        };
        if let Some(reason) = session.divergence() {
            restore_on_reject!();
            return rejected(cid, reason.as_str(), reason.message());
        }
        if session.has_pending() || session.has_pending_desired() || session.has_drag() {
            restore_on_reject!();
            return rejected(
                cid,
                "pending-exists",
                "complete the pending plan before proposing",
            );
        }
        let Some(retained_domain) = session
            .domains()
            .iter()
            .find(|d| d.key() == ctx.domain_key)
            .cloned()
        else {
            restore_on_reject!();
            return rejected(
                cid,
                RefusalKind::UnknownDomain.as_str(),
                RefusalKind::UnknownDomain.message(),
            );
        };
        if retained_domain.gap != ctx.domain.gap {
            restore_on_reject!();
            return rejected(
                cid,
                "domain-mismatch",
                "domain gap does not match retained state",
            );
        }
        if self.domain_outer_gaps.get(&ctx.domain_key).copied()
            != Some(ctx.request.domain.outer_gap)
        {
            restore_on_reject!();
            return rejected(
                cid,
                "domain-mismatch",
                "domain outer gap does not match retained state",
            );
        }
        let bounds_changed = retained_domain.bounds != ctx.domain.bounds;
        let snapshot = session.snapshot();
        let mut known: std::collections::BTreeSet<String> = snapshot
            .windows
            .iter()
            .map(|l| l.window.0.clone())
            .collect();
        for entry in session.exception_observed() {
            known.insert(entry.window.0.clone());
        }
        let observed: std::collections::BTreeSet<String> = ctx
            .request
            .windows
            .iter()
            .map(|w| w.window.clone())
            .collect();
        if observed != known {
            restore_on_reject!();
            return rejected(
                cid,
                RefusalKind::PartialObservation.as_str(),
                RefusalKind::PartialObservation.message(),
            );
        }
        // Empty retained domain: no tree, no windows, no focus. Projecting
        // nothing preserves allocation trivially without touching state.
        let domain_view = snapshot.domains.into_iter().find(|d| {
            d.output.0 == ctx.domain_key.output.0 && d.workspace.0 == ctx.domain_key.workspace.0
        });
        let tree = domain_view.and_then(|d| d.tree);
        let Some(tree) = tree else {
            if known.is_empty() && observed.is_empty() {
                if bounds_changed {
                    if let Some(session) = self.sessions.get_mut(&ctx.domain_key) {
                        session.reproject_domain(&ctx.domain_key, ctx.domain.bounds);
                    }
                }
                return planned_reply(
                    &cid,
                    session.accepted_revision(),
                    serde_json::json!({
                        "kind": "reconcile",
                        "capability": "reconcile-geometry",
                    }),
                    &[],
                    None,
                );
            }
            restore_on_reject!();
            return rejected(
                cid,
                RefusalKind::MalformedTopology.as_str(),
                RefusalKind::MalformedTopology.message(),
            );
        };
        let (focus_domain, focus_leaf) = session.focus();
        let (Some(focus_domain), Some(focus_leaf)) = (focus_domain, focus_leaf) else {
            restore_on_reject!();
            return rejected(
                cid,
                RefusalKind::FocusMismatch.as_str(),
                RefusalKind::FocusMismatch.message(),
            );
        };
        if focus_domain != ctx.domain_key {
            restore_on_reject!();
            return rejected(
                cid,
                RefusalKind::FocusMismatch.as_str(),
                RefusalKind::FocusMismatch.message(),
            );
        }
        let Ok(projected) = project(&tree, ctx.domain.bounds, retained_domain.gap) else {
            restore_on_reject!();
            return rejected(
                cid,
                RefusalKind::MalformedTopology.as_str(),
                RefusalKind::MalformedTopology.message(),
            );
        };
        let leaf_to_window: std::collections::BTreeMap<String, String> =
            snapshot_windows_leaf_map(&session, &ctx.domain_key);
        // Rebuild authoritative desired geometry from retained topology only;
        // observed client rectangles are never adopted and shares are untouched.
        let mut geometry: Vec<tiler_core::session::DesiredGeometry> =
            Vec::with_capacity(projected.len());
        for leaf in projected {
            let Some(window) = leaf_to_window.get(&leaf.leaf.0) else {
                restore_on_reject!();
                return rejected(
                    cid,
                    RefusalKind::MalformedTopology.as_str(),
                    RefusalKind::MalformedTopology.message(),
                );
            };
            if leaf.rect.w <= 0 || leaf.rect.h <= 0 {
                restore_on_reject!();
                return rejected(
                    cid,
                    RefusalKind::MalformedTopology.as_str(),
                    RefusalKind::MalformedTopology.message(),
                );
            }
            geometry.push(tiler_core::session::DesiredGeometry {
                window: WindowId(window.clone()),
                leaf: leaf.leaf.clone(),
                output: ctx.domain_key.output.clone(),
                workspace: ctx.domain_key.workspace.clone(),
                rect: leaf.rect,
            });
        }
        geometry.sort_by(|a, b| {
            a.output
                .0
                .cmp(&b.output.0)
                .then(a.workspace.0.cmp(&b.workspace.0))
                .then(a.leaf.0.cmp(&b.leaf.0))
        });
        // Geometry covers tiled leaves only; floating/fullscreen/maximized
        // exceptions remain membership (known/observed) but are never
        // projected. Comparing against known (tiled plus exceptions) would
        // reject every reconcile with an intentional float as malformed.
        if geometry.len() != leaf_to_window.len() {
            restore_on_reject!();
            return rejected(
                cid,
                RefusalKind::MalformedTopology.as_str(),
                RefusalKind::MalformedTopology.message(),
            );
        }
        if bounds_changed {
            if let Some(session) = self.sessions.get_mut(&ctx.domain_key) {
                session.reproject_domain(&ctx.domain_key, ctx.domain.bounds);
            }
        }
        planned_reply(
            &cid,
            session.accepted_revision(),
            serde_json::json!({
                "kind": "reconcile",
                "capability": "reconcile-geometry",
            }),
            &geometry,
            Some((&focus_domain, &focus_leaf)),
        )
    }

    /// Deliberate retained gap-update reprojection for the interim tiler
    /// reload: adopt the carried inner/outer gaps (plus the carried
    /// outer-inset bounds they imply) and reproject the retained tree with
    /// the new inner gap, preserving topology, shares, membership, focus,
    /// exceptions, and accepted revision. No pending is staged: like
    /// reconcile this is a pure projection whose reply the adapter applies
    /// natively. Fail-closed without mutation on unknown/diverged/pending
    /// domains, membership or focus mismatch, unprojectable results, or an
    /// unadoptable gap/bounds update. Never seeds, relocates, resets, or
    /// reseeds a session: an unknown domain refuses so the normal admit path
    /// seeds it with the new gaps instead. A simultaneous work-area change
    /// folds into the same projection with reconcile-equivalent safety; a
    /// simultaneous membership change refuses as partial-observation and the
    /// normal admit/remove path owns it.
    fn evaluate_update_gaps_retained(&mut self, ctx: &Validated) -> String {
        let command: UpdateGapsCommand = match serde_json::from_value(ctx.request.command.clone()) {
            Ok(command) => command,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        if command.op != "update-gaps" {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "update-gaps-op-invalid",
            );
        }
        let cid = ctx.request.correlation_id.clone();
        let Some(session) = self.sessions.get(&ctx.domain_key).cloned() else {
            return rejected(
                cid,
                RefusalKind::UnknownDomain.as_str(),
                RefusalKind::UnknownDomain.message(),
            );
        };
        if let Some(reason) = session.divergence() {
            return rejected(cid, reason.as_str(), reason.message());
        }
        if session.has_pending() || session.has_pending_desired() || session.has_drag() {
            return rejected(
                cid,
                "pending-exists",
                "complete the pending plan before proposing",
            );
        }
        if session
            .domains()
            .iter()
            .find(|d| d.key() == ctx.domain_key)
            .is_none()
        {
            return rejected(
                cid,
                RefusalKind::UnknownDomain.as_str(),
                RefusalKind::UnknownDomain.message(),
            );
        }
        let snapshot = session.snapshot();
        let mut known: std::collections::BTreeSet<String> = snapshot
            .windows
            .iter()
            .map(|l| l.window.0.clone())
            .collect();
        for entry in session.exception_observed() {
            known.insert(entry.window.0.clone());
        }
        let observed: std::collections::BTreeSet<String> = ctx
            .request
            .windows
            .iter()
            .map(|w| w.window.clone())
            .collect();
        if observed != known {
            return rejected(
                cid,
                RefusalKind::PartialObservation.as_str(),
                RefusalKind::PartialObservation.message(),
            );
        }
        // Empty retained domain: no tree, no windows, no focus. Adopt the new
        // gap state trivially without touching anything else.
        let domain_view = snapshot.domains.into_iter().find(|d| {
            d.output.0 == ctx.domain_key.output.0 && d.workspace.0 == ctx.domain_key.workspace.0
        });
        let tree = domain_view.and_then(|d| d.tree);
        let Some(tree) = tree else {
            if known.is_empty() && observed.is_empty() {
                if let Some(session) = self.sessions.get_mut(&ctx.domain_key)
                    && !session.update_domain_gaps(
                        &ctx.domain_key,
                        ctx.domain.bounds,
                        ctx.domain.gap,
                    )
                {
                    return rejected(
                        cid,
                        RefusalKind::MalformedTopology.as_str(),
                        RefusalKind::MalformedTopology.message(),
                    );
                }
                self.domain_outer_gaps
                    .insert(ctx.domain_key.clone(), ctx.request.domain.outer_gap);
                return planned_reply(
                    &cid,
                    session.accepted_revision(),
                    serde_json::json!({
                        "kind": "update-gaps",
                        "capability": "update-gaps-geometry",
                    }),
                    &[],
                    None,
                );
            }
            return rejected(
                cid,
                RefusalKind::MalformedTopology.as_str(),
                RefusalKind::MalformedTopology.message(),
            );
        };
        let (focus_domain, focus_leaf) = session.focus();
        let (Some(focus_domain), Some(focus_leaf)) = (focus_domain, focus_leaf) else {
            return rejected(
                cid,
                RefusalKind::FocusMismatch.as_str(),
                RefusalKind::FocusMismatch.message(),
            );
        };
        if focus_domain != ctx.domain_key {
            return rejected(
                cid,
                RefusalKind::FocusMismatch.as_str(),
                RefusalKind::FocusMismatch.message(),
            );
        }
        // Project the retained tree with the NEW inner gap into the NEW
        // outer-inset bounds before mutating anything; observed client
        // rectangles are never adopted and shares are untouched.
        let Ok(projected) = project(&tree, ctx.domain.bounds, ctx.domain.gap) else {
            return rejected(
                cid,
                RefusalKind::MalformedTopology.as_str(),
                RefusalKind::MalformedTopology.message(),
            );
        };
        let leaf_to_window: std::collections::BTreeMap<String, String> =
            snapshot_windows_leaf_map(&session, &ctx.domain_key);
        let mut geometry: Vec<tiler_core::session::DesiredGeometry> =
            Vec::with_capacity(projected.len());
        for leaf in projected {
            let Some(window) = leaf_to_window.get(&leaf.leaf.0) else {
                return rejected(
                    cid,
                    RefusalKind::MalformedTopology.as_str(),
                    RefusalKind::MalformedTopology.message(),
                );
            };
            if leaf.rect.w <= 0 || leaf.rect.h <= 0 {
                return rejected(
                    cid,
                    RefusalKind::MalformedTopology.as_str(),
                    RefusalKind::MalformedTopology.message(),
                );
            }
            geometry.push(tiler_core::session::DesiredGeometry {
                window: WindowId(window.clone()),
                leaf: leaf.leaf.clone(),
                output: ctx.domain_key.output.clone(),
                workspace: ctx.domain_key.workspace.clone(),
                rect: leaf.rect,
            });
        }
        geometry.sort_by(|a, b| {
            a.output
                .0
                .cmp(&b.output.0)
                .then(a.workspace.0.cmp(&b.workspace.0))
                .then(a.leaf.0.cmp(&b.leaf.0))
        });
        // Same tiled-only projection as reconcile: exceptions stay in
        // known/observed membership but never appear in geometry.
        if geometry.len() != leaf_to_window.len() {
            return rejected(
                cid,
                RefusalKind::MalformedTopology.as_str(),
                RefusalKind::MalformedTopology.message(),
            );
        }
        let mut session = session;
        if !session.update_domain_gaps(&ctx.domain_key, ctx.domain.bounds, ctx.domain.gap) {
            return rejected(
                cid,
                RefusalKind::MalformedTopology.as_str(),
                RefusalKind::MalformedTopology.message(),
            );
        }
        let revision = session.accepted_revision();
        self.store_committed(
            ctx.domain_key.clone(),
            session,
            ctx.request.domain.outer_gap,
        );
        planned_reply(
            &cid,
            revision,
            serde_json::json!({
                "kind": "update-gaps",
                "capability": "update-gaps-geometry",
            }),
            &geometry,
            Some((&focus_domain, &focus_leaf)),
        )
    }

    /// Retained read-only active-group highlight query over the existing
    /// `DescribePlan` transport. No mutation, no timer, no Meta state, no
    /// polling/retry/fallback: resolves the current retained focused leaf's
    /// immediate parent split-tree group in the requested focused domain,
    /// recursively includes its descendants, and projects them with the engine
    /// projector (never native/client rect topology). The carried
    /// `revision` is never a staleness gate (read-only snapshot resolves
    /// current retained state, so initial revision 0 and any lagging caller
    /// revision still resolve); the authoritative `base_revision` is returned
    /// for downstream identity ordering. Replies `active-group` with opaque
    /// group/member identities, the projected union bounds, and the
    /// owner/generation/correlation/base-revision identity; any
    /// invalid/missing/non-tiled focus, unknown domain/tree, or root-leaf
    /// focus replies `no-group`.
    ///
    /// Carried-window divergence safety (exact contract, no new topology
    /// authority): carried `windows` rectangles/sets are never consulted for
    /// membership or projection. Membership comes solely from the retained
    /// split tree via [`tiler_core::active_group::describe_active_group`],
    /// projection from retained bounds/gap plus the engine projector. The
    /// carried `focused_window` may update retained focus only through its
    /// guarded focus-sync path, while carried domain bounds/gap are bound to
    /// the retained domain. Drifted rects, extra/missing carried entries, or
    /// lagging revisions cannot corrupt topology or geometry: worst case is
    /// fail-closed `no-group` via `focus-unmapped`/`domain-mismatch`/pending/
    /// diverged.
    fn evaluate_active_group_retained(&mut self, ctx: &Validated) -> String {
        let command: ActiveGroupCommand = match serde_json::from_value(ctx.request.command.clone())
        {
            Ok(command) => command,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        if command.op != "active-group" {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "active-group-op-invalid",
            );
        }
        let Some(mut session) = self.sessions.get(&ctx.domain_key).cloned() else {
            return no_group_reply(ctx, None, "no-session");
        };
        // Align retained focus from the valid observed snapshot before
        // resolving the immediate parent group. Focus-only sync: no topology
        // or geometry mutation. Fails closed on divergence, pending/drag
        // residue, unknown/exception/cross-domain windows, or domain
        // bounds/gap mismatch (then the resolver still replies fail-closed
        // `no-group` without persisting).
        let focused = WindowId(ctx.request.focused_window.clone());
        if !focused.0.is_empty()
            && let Some(retained_domain) = session
                .domains()
                .iter()
                .find(|domain| domain.key() == ctx.domain_key)
            && retained_domain.bounds == ctx.domain.bounds
            && retained_domain.gap == ctx.domain.gap
        {
            let before = session.focus();
            if session.sync_focus_from_window(&ctx.domain_key, &focused)
                && session.focus() != before
                && let Some(stored) = self.sessions.get_mut(&ctx.domain_key)
            {
                *stored = session.clone();
            }
        }
        active_group_response(&session, ctx)
    }

    /// Shared standalone workspace-send target scope: optional `target_domain`
    /// plus `target_windows` against the source `domain`. Refuses
    /// cross-output, same-workspace, and malformed or uncovered target windows
    /// fail-closed with bounded kinds, and returns the projected target domain
    /// plus its key. No mover/command binding; the request and status paths
    /// add their own command checks.
    fn workspace_target_scope(&self, ctx: &Validated) -> Result<(OutputDomain, DomainKey), String> {
        let cid = ctx.request.correlation_id.clone();
        let Some(target_dto) = &ctx.request.target_domain else {
            return Err(rejected(
                cid,
                "workspace-target-invalid",
                "target workspace domain is missing",
            ));
        };
        if !is_opaque_id(&target_dto.output) {
            return Err(rejected(
                cid,
                "workspace-target-invalid",
                "target output is invalid",
            ));
        }
        if !is_opaque_id(&target_dto.workspace) {
            return Err(rejected(
                cid,
                "workspace-target-invalid",
                "target workspace is invalid",
            ));
        }
        if target_dto.output != ctx.request.domain.output {
            return Err(rejected(
                cid,
                "cross-output",
                "target workspace is not on the focused output",
            ));
        }
        if target_dto.workspace == ctx.request.domain.workspace {
            return Err(rejected(
                cid,
                "unchanged-workspace",
                "target workspace equals the source workspace",
            ));
        }
        let carried_bounds = Rect {
            x: target_dto.bounds.x,
            y: target_dto.bounds.y,
            w: target_dto.bounds.w,
            h: target_dto.bounds.h,
        };
        if !valid_carried_rect(
            carried_bounds.x,
            carried_bounds.y,
            carried_bounds.w,
            carried_bounds.h,
        ) {
            return Err(snapshot_invalid(
                cid,
                MSG_OBSERVATION,
                "domain-bounds-invalid",
            ));
        }
        if target_dto.gap < 0 {
            return Err(snapshot_invalid(cid, MSG_OBSERVATION, "gap-low"));
        }
        if target_dto.gap > GEOMETRY_MAX_GAP {
            return Err(snapshot_invalid(cid, MSG_OBSERVATION, "gap-high"));
        }
        if target_dto.outer_gap < 0 {
            return Err(snapshot_invalid(cid, MSG_OBSERVATION, "outer-gap-low"));
        }
        if target_dto.outer_gap > GEOMETRY_MAX_GAP {
            return Err(snapshot_invalid(cid, MSG_OBSERVATION, "outer-gap-high"));
        }
        {
            let mut seen = std::collections::HashSet::new();
            for entry in &ctx.request.target_windows {
                if !is_opaque_id(&entry.window) {
                    return Err(snapshot_invalid(
                        cid,
                        MSG_OPAQUE_ID,
                        "observed-window-invalid",
                    ));
                }
                if !is_opaque_id(&entry.output) {
                    return Err(snapshot_invalid(
                        cid,
                        MSG_OPAQUE_ID,
                        "observed-output-invalid",
                    ));
                }
                if !is_opaque_id(&entry.workspace) {
                    return Err(snapshot_invalid(
                        cid,
                        MSG_OPAQUE_ID,
                        "observed-workspace-invalid",
                    ));
                }
                if entry.output != target_dto.output || entry.workspace != target_dto.workspace {
                    return Err(rejected(cid, "cross-domain-mismatch", MSG_CROSS_DOMAIN));
                }
                if !valid_carried_rect(entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h) {
                    return Err(snapshot_invalid(
                        cid,
                        MSG_OBSERVATION,
                        "window-rect-invalid",
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
                    return Err(snapshot_invalid(
                        cid,
                        MSG_OBSERVATION,
                        "window-out-of-bounds",
                    ));
                }
                if !seen.insert(entry.window.clone()) {
                    return Err(snapshot_invalid(cid, MSG_OPAQUE_ID, "duplicate-window"));
                }
            }
        }
        let Ok(projected_target) =
            tiler_core::geometry::inset_bounds(carried_bounds, target_dto.outer_gap)
        else {
            return Err(snapshot_invalid(cid, MSG_OBSERVATION, "inset-exhausted"));
        };
        let target_domain = OutputDomain {
            id: OutputId(target_dto.output.clone()),
            workspace: WorkspaceId(target_dto.workspace.clone()),
            bounds: projected_target,
            gap: target_dto.gap,
            adjacent: std::collections::BTreeMap::new(),
        };
        if !target_domain.validate() {
            return Err(snapshot_invalid(cid, MSG_OBSERVATION, "domain-invalid"));
        }
        let target_key = DomainKey {
            output: OutputId(target_dto.output.clone()),
            workspace: WorkspaceId(target_dto.workspace.clone()),
        };
        Ok((target_domain, target_key))
    }

    /// Validate the standalone workspace-send target: optional `target_domain`
    /// plus `target_windows` against the source `domain`/`windows`. Refuses
    /// cross-output, same-workspace, absent/invalid focus, and malformed or
    /// uncovered target windows fail-closed with bounded kinds.
    fn validate_workspace_input(&self, ctx: &Validated) -> Result<WorkspaceInput, String> {
        let cid = ctx.request.correlation_id.clone();
        // Target scope first (presence, cross-output, bounds, homing), then
        // the mover binding; a missing target still reports
        // `workspace-target-invalid` from the shared scope helper.
        let (target_domain, target_key) = self.workspace_target_scope(ctx)?;
        if ctx.request.focused_window.is_empty() {
            return Err(rejected(
                cid,
                "absent-focus",
                "no focused window is observed",
            ));
        }
        let command: WorkspaceSendCommand =
            match serde_json::from_value(ctx.request.command.clone()) {
                Ok(command) => command,
                Err(error) => {
                    let (kind, message) = classify_parse_error(&error);
                    return Err(rejected(valid_correlation_echo(&ctx.raw), kind, message));
                }
            };
        if command.op != "send-to-workspace" {
            return Err(snapshot_invalid(cid, MSG_OPAQUE_ID, "move-op-invalid"));
        }
        if !is_opaque_id(&command.window) {
            return Err(snapshot_invalid(cid, MSG_OPAQUE_ID, "move-window-invalid"));
        }
        if !is_opaque_id(&command.target_output) {
            return Err(snapshot_invalid(cid, MSG_OPAQUE_ID, "move-output-invalid"));
        }
        if !is_opaque_id(&command.target_workspace) {
            return Err(snapshot_invalid(
                cid,
                MSG_OPAQUE_ID,
                "move-workspace-invalid",
            ));
        }
        if command.window != ctx.request.focused_window {
            return Err(rejected(
                cid,
                "focus-mismatch",
                "the moved window is not the focused window",
            ));
        }
        if command.target_output != target_key.output.0
            || command.target_workspace != target_key.workspace.0
        {
            return Err(rejected(
                cid,
                "target-mismatch",
                "command target does not match the target domain",
            ));
        }
        Ok(WorkspaceInput {
            target_domain,
            target_key,
            target_windows: ctx.request.target_windows.clone(),
            window: WindowId(command.window.clone()),
        })
    }

    /// Workspace-send request phase: rebuild the two-domain session from the
    /// observation, propose the same-output distinct-workspace move, and retain
    /// exactly one pending Session. Never auto-acknowledges: the adapter must
    /// send an exact accepted ack and then a matching verified post-observation.
    fn evaluate_workspace_request(&mut self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        if let Some(pending) = &self.workspace_pending {
            if let Some(reason) = pending.session.divergence() {
                return diverged_reply(&cid, reason);
            }
            if pending.owner != ctx.owner || pending.generation != ctx.generation {
                return diverged_reply(&cid, tiler_core::contract::DivergenceKind::OwnerMismatch);
            }
            return rejected(
                cid,
                "pending-exists",
                "complete the pending workspace plan before proposing",
            );
        }
        let input = match self.validate_workspace_input(ctx) {
            Ok(input) => input,
            Err(reply) => return reply,
        };
        let Some(source_order) = spatial_with_focus_last(
            ctx.request.windows.clone(),
            &ctx.request.focused_window,
            false,
        ) else {
            return rejected(cid, "ambiguous-placement", MSG_AMBIGUOUS);
        };
        let Some(target_order) = spatial_with_focus_last(input.target_windows.clone(), "", false)
        else {
            return rejected(cid, "ambiguous-placement", MSG_AMBIGUOUS);
        };
        let Some(mut session) = seed_workspace_session(
            &ctx.owner,
            &ctx.generation,
            ctx.request.fingerprint,
            &ctx.domain,
            &input.target_domain,
            &source_order,
            &target_order,
        ) else {
            return snapshot_invalid(cid, MSG_OBSERVATION, "seed-failed");
        };
        let focused = WindowId(ctx.request.focused_window.clone());
        if !session.sync_focus_from_window(&ctx.domain_key, &focused) {
            return rejected(
                cid,
                RefusalKind::FocusMismatch.as_str(),
                RefusalKind::FocusMismatch.message(),
            );
        }
        let base = session.accepted_revision();
        let observation = workspace_observation(base, ctx, &input);
        let session_command = SessionCommand::MoveToWorkspace {
            window: input.window.clone(),
            target_output: input.target_key.output.clone(),
            target_workspace: input.target_key.workspace.clone(),
        };
        match session.propose(
            &session_command,
            &observation,
            &ctx.correlation,
            &LifecycleCapabilities::full(),
        ) {
            Ok(plan) => {
                let text = workspace_planned_reply(&ctx.request.correlation_id, &plan);
                self.workspace_pending = Some(WorkspacePending {
                    owner: ctx.owner.clone(),
                    generation: ctx.generation.clone(),
                    correlation: ctx.correlation.clone(),
                    base_revision: base,
                    request_revision: ctx.request.revision,
                    session,
                    desired_geometry: plan.desired_geometry.clone(),
                    pre_focused: ctx.request.focused_window.clone(),
                    pre_windows: ctx.request.windows.clone(),
                    pre_target_windows: ctx.request.target_windows.clone(),
                });
                text
            }
            Err(error) => propose_failure(error, cid),
        }
    }

    /// Workspace-send acknowledgement phase: exact accepted acknowledgement
    /// against the retained pending Session. Refused ack or binding mismatch is
    /// terminal divergence.
    fn evaluate_workspace_ack(&mut self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        let command: WorkspaceAckCommand = match serde_json::from_value(ctx.request.command.clone())
        {
            Ok(command) => command,
            Err(error) => {
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        if command.op != "send-to-workspace-ack" {
            return snapshot_invalid(cid, MSG_OPAQUE_ID, "ack-op-invalid");
        }
        let outcome = match command.ack_outcome.as_str() {
            "accepted" => AckOutcome::Accepted,
            "refused-capability" => AckOutcome::RefusedCapability,
            "partial-application" => AckOutcome::PartialApplication,
            "adapter-lost" => AckOutcome::AdapterLost,
            _ => {
                return rejected(cid, "ack-refused", "acknowledgement outcome is invalid");
            }
        };
        let Some(pending) = &mut self.workspace_pending else {
            return rejected(cid, "no-pending", "no workspace plan is pending");
        };
        if let Some(reason) = pending.session.divergence() {
            return diverged_reply(&cid, reason);
        }
        if pending.owner != ctx.owner || pending.generation != ctx.generation {
            return diverged_reply(&cid, tiler_core::contract::DivergenceKind::OwnerMismatch);
        }
        if pending.correlation != ctx.correlation {
            return diverged_reply(
                &cid,
                tiler_core::contract::DivergenceKind::CorrelationMismatch,
            );
        }
        if ctx.request.revision != pending.base_revision {
            return diverged_reply(&cid, tiler_core::contract::DivergenceKind::StaleRevision);
        }
        let ack = AdapterAck::new(
            ctx.correlation.clone(),
            ctx.owner.clone(),
            ctx.generation.clone(),
            pending.base_revision,
            outcome,
        );
        match pending.session.acknowledge(&ack) {
            Ok(_) => serialize_bounded(&PlanReply {
                v: PLAN_CONTRACT_VERSION,
                correlation_id: cid,
                outcome: "acknowledged",
                kind: Some("send-to-workspace".to_owned()),
                message: None,
                base_revision: Some(pending.base_revision),
                detail: None,
                desired_geometry: None,
                desired_focus: None,
                float_geometry: None,
                preconditions: None,
                operation: None,
            }),
            Err(AckError::Diverged(reason)) => diverged_reply(&cid, reason),
            Err(AckError::NoPending) => rejected(cid, "no-pending", "no workspace plan is pending"),
        }
    }

    /// Workspace-send verification phase: exact post-observation (preconditions
    /// and operation echoed from the plan) plus a matching fresh observation
    /// commits the pending Session and advances the revision by exactly one.
    /// Pending mismatch or failed verification is terminal divergence.
    fn evaluate_workspace_verify(&mut self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        let command: WorkspaceVerifyCommand =
            match serde_json::from_value(ctx.request.command.clone()) {
                Ok(command) => command,
                Err(error) => {
                    let (kind, message) = classify_parse_error(&error);
                    return rejected(valid_correlation_echo(&ctx.raw), kind, message);
                }
            };
        if command.op != "send-to-workspace-verify" {
            return snapshot_invalid(cid, MSG_OPAQUE_ID, "verify-op-invalid");
        }
        if !command.verified {
            return diverged_reply(
                &cid,
                tiler_core::contract::DivergenceKind::PostconditionUnverified,
            );
        }
        let Some(preconditions) = parse_lifecycle_preconditions(&command.preconditions) else {
            return rejected(cid, "verify-invalid", "preconditions are invalid");
        };
        let Some(operation) = parse_move_tiled_operation(&command.operation) else {
            return rejected(cid, "verify-invalid", "operation is invalid");
        };
        let Some(mut pending) = self.workspace_pending.take() else {
            return rejected(cid, "no-pending", "no workspace plan is pending");
        };
        if let Some(reason) = pending.session.divergence() {
            self.workspace_pending = Some(pending);
            return diverged_reply(&cid, reason);
        }
        if pending.owner != ctx.owner || pending.generation != ctx.generation {
            self.workspace_pending = Some(pending);
            return diverged_reply(&cid, tiler_core::contract::DivergenceKind::OwnerMismatch);
        }
        if pending.correlation != ctx.correlation {
            self.workspace_pending = Some(pending);
            return diverged_reply(
                &cid,
                tiler_core::contract::DivergenceKind::CorrelationMismatch,
            );
        }
        if ctx.request.revision != pending.base_revision {
            self.workspace_pending = Some(pending);
            return diverged_reply(&cid, tiler_core::contract::DivergenceKind::StaleRevision);
        }
        // Complete source+target post-observation validation against the
        // retained plan before any lifecycle commit. A bare `verified: true`
        // must not commit; divergence here is terminal with the pending kept
        // wedged exactly like a failed lifecycle verification.
        if !workspace_post_matches(&pending, ctx) {
            let reason = pending.session.note_postcondition_mismatch();
            self.workspace_pending = Some(pending);
            return diverged_reply(&cid, reason);
        }
        let post = LifecyclePostObservation::new(
            Observation::new(
                ctx.owner.clone(),
                ctx.generation.clone(),
                pending.base_revision,
                ctx.request.fingerprint,
            ),
            ctx.correlation.clone(),
            true,
            preconditions,
            operation,
        );
        match pending.session.verify_lifecycle(&post) {
            Ok(commit) => {
                self.workspace_pending = None;
                serialize_bounded(&PlanReply {
                    v: PLAN_CONTRACT_VERSION,
                    correlation_id: cid,
                    outcome: "committed",
                    kind: Some("send-to-workspace".to_owned()),
                    message: None,
                    base_revision: Some(commit.revision),
                    detail: None,
                    desired_geometry: None,
                    desired_focus: None,
                    float_geometry: None,
                    preconditions: None,
                    operation: None,
                })
            }
            Err(VerifyError::Diverged(reason)) => {
                self.workspace_pending = Some(pending);
                diverged_reply(&cid, reason)
            }
            Err(_) => {
                self.workspace_pending = Some(pending);
                rejected(cid, "verify-rejected", "workspace verification failed")
            }
        }
    }

    /// Directional R4 acknowledgement phase: exact accepted acknowledgement
    /// against the retained pending pair Session. Refused ack or
    /// identity/correlation/revision mismatch is terminal divergence with no
    /// commit and no canonical split. Strict bounded parsing, no new topology
    /// seeding.
    fn evaluate_directional_ack(&mut self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        let command: DirectionalMoveAckCommand =
            match serde_json::from_value(ctx.request.command.clone()) {
                Ok(command) => command,
                Err(error) => {
                    let (kind, message) = classify_parse_error(&error);
                    return rejected(valid_correlation_echo(&ctx.raw), kind, message);
                }
            };
        if command.op != "directional-move-ack" {
            return snapshot_invalid(cid, MSG_OPAQUE_ID, "ack-op-invalid");
        }
        let outcome = match command.ack_outcome.as_str() {
            "accepted" => AckOutcome::Accepted,
            "refused-capability" => AckOutcome::RefusedCapability,
            "partial-application" => AckOutcome::PartialApplication,
            "adapter-lost" => AckOutcome::AdapterLost,
            _ => {
                return rejected(cid, "ack-refused", "acknowledgement outcome is invalid");
            }
        };
        let Some(pending) = &mut self.directional_pending else {
            return rejected(cid, "no-pending", "no directional move is pending");
        };
        if let Some(reason) = pending.session.divergence() {
            return diverged_reply(&cid, reason);
        }
        if pending.owner != ctx.owner || pending.generation != ctx.generation {
            return diverged_reply(&cid, tiler_core::contract::DivergenceKind::OwnerMismatch);
        }
        if pending.correlation != ctx.correlation {
            return diverged_reply(
                &cid,
                tiler_core::contract::DivergenceKind::CorrelationMismatch,
            );
        }
        if ctx.request.revision != pending.base_revision {
            return diverged_reply(&cid, tiler_core::contract::DivergenceKind::StaleRevision);
        }
        let ack = AdapterAck::new(
            ctx.correlation.clone(),
            ctx.owner.clone(),
            ctx.generation.clone(),
            pending.base_revision,
            outcome,
        );
        match pending.session.acknowledge(&ack) {
            Ok(_) => serialize_bounded(&PlanReply {
                v: PLAN_CONTRACT_VERSION,
                correlation_id: cid,
                outcome: "acknowledged",
                kind: Some("directional-move".to_owned()),
                message: None,
                base_revision: Some(pending.base_revision),
                detail: None,
                desired_geometry: None,
                desired_focus: None,
                float_geometry: None,
                preconditions: None,
                operation: None,
            }),
            Err(AckError::Diverged(reason)) => diverged_reply(&cid, reason),
            Err(AckError::NoPending) => {
                rejected(cid, "no-pending", "no directional move is pending")
            }
        }
    }

    /// Directional R4 verification phase: exact post-observation (operation
    /// and preconditions echoed from the plan) plus a complete matching
    /// source+target observation commits via `Session::verify_move`, then
    /// splits/stores the canonical sessions once and replies `committed`.
    /// Mismatch, refused ack residue, failed verification, or
    /// identity/correlation/revision loss is terminal `diverged` with no
    /// commit. A bare `verified: true` never commits.
    fn evaluate_directional_verify(&mut self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        let command: DirectionalMoveVerifyCommand =
            match serde_json::from_value(ctx.request.command.clone()) {
                Ok(command) => command,
                Err(error) => {
                    let (kind, message) = classify_parse_error(&error);
                    return rejected(valid_correlation_echo(&ctx.raw), kind, message);
                }
            };
        if command.op != "directional-move-verify" {
            return snapshot_invalid(cid, MSG_OPAQUE_ID, "verify-op-invalid");
        }
        if !command.verified {
            return diverged_reply(
                &cid,
                tiler_core::contract::DivergenceKind::PostconditionUnverified,
            );
        }
        let Some(preconditions) = parse_directional_preconditions(&command.preconditions) else {
            return rejected(cid, "verify-invalid", "preconditions are invalid");
        };
        let Some(operation) = parse_directional_move_operation(&command.operation) else {
            return rejected(cid, "verify-invalid", "operation is invalid");
        };
        let Some(mut pending) = self.directional_pending.take() else {
            return rejected(cid, "no-pending", "no directional move is pending");
        };
        if let Some(reason) = pending.session.divergence() {
            self.directional_pending = Some(pending);
            return diverged_reply(&cid, reason);
        }
        if pending.owner != ctx.owner || pending.generation != ctx.generation {
            self.directional_pending = Some(pending);
            return diverged_reply(&cid, tiler_core::contract::DivergenceKind::OwnerMismatch);
        }
        if pending.correlation != ctx.correlation {
            self.directional_pending = Some(pending);
            return diverged_reply(
                &cid,
                tiler_core::contract::DivergenceKind::CorrelationMismatch,
            );
        }
        if ctx.request.revision != pending.base_revision {
            self.directional_pending = Some(pending);
            return diverged_reply(&cid, tiler_core::contract::DivergenceKind::StaleRevision);
        }
        // Exact pending operation/preconditions binding before any commit.
        if operation != pending.operation || preconditions != pending.preconditions {
            let reason = pending.session.note_postcondition_mismatch();
            self.directional_pending = Some(pending);
            return diverged_reply(&cid, reason);
        }
        // Complete source+target post-observation must equal the retained
        // desired geometry/membership exactly.
        if !directional_post_matches(&pending, ctx) {
            let reason = pending.session.note_postcondition_mismatch();
            self.directional_pending = Some(pending);
            return diverged_reply(&cid, reason);
        }
        // Fenced source/target binding: the echoed operation target must home
        // to the retained pair, and any carried source binding must match.
        if let tiler_core::directional::MoveOperation::CrossOutput {
            target_output,
            target_workspace,
            ..
        } = &pending.operation
        {
            let op_target_output = command
                .operation
                .get("target_output")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let op_target_workspace = command
                .operation
                .get("target_workspace")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let op_source_output = command
                .operation
                .get("source_output")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let op_source_workspace = command
                .operation
                .get("source_workspace")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            if op_target_output != target_output.0
                || op_target_workspace != target_workspace.0
                || op_target_output != pending.target_key.output.0
                || op_target_workspace != pending.target_key.workspace.0
                || op_source_output != pending.source_key.output.0
                || op_source_workspace != pending.source_key.workspace.0
            {
                let reason = pending.session.note_postcondition_mismatch();
                self.directional_pending = Some(pending);
                return diverged_reply(&cid, reason);
            }
        }
        let post = tiler_core::contract::PostObservation::new(
            Observation::new(
                ctx.owner.clone(),
                ctx.generation.clone(),
                pending.base_revision,
                ctx.request.fingerprint,
            ),
            ctx.correlation.clone(),
            true,
            preconditions,
            operation,
        );
        match pending.session.verify_move(&post) {
            Ok(commit) => {
                let source_key = pending.source_key.clone();
                let target_key = pending.target_key.clone();
                let source_outer_gap = pending.source_outer_gap;
                let target_outer_gap = pending.target_outer_gap;
                let Ok((source, target)) = pending.session.split_canonical_pair() else {
                    // Verification already committed the pair. Retain an
                    // explicit terminal wedge rather than losing canonical
                    // state and permitting a spatial rebuild around it.
                    self.directional_pending = Some(pending);
                    return diverged_reply(
                        &cid,
                        tiler_core::contract::DivergenceKind::PostconditionMismatch,
                    );
                };
                self.directional_pending = None;
                self.store_committed(source_key, source, source_outer_gap);
                if let Some(target) = target {
                    self.store_committed(target_key, target, target_outer_gap);
                } else {
                    self.sessions.remove(&target_key);
                    self.domain_outer_gaps.remove(&target_key);
                }
                serialize_bounded(&PlanReply {
                    v: PLAN_CONTRACT_VERSION,
                    correlation_id: cid,
                    outcome: "committed",
                    kind: Some("directional-move".to_owned()),
                    message: None,
                    base_revision: Some(commit.revision),
                    detail: None,
                    desired_geometry: None,
                    desired_focus: None,
                    float_geometry: None,
                    preconditions: None,
                    operation: None,
                })
            }
            Err(VerifyError::Diverged(reason)) => {
                self.directional_pending = Some(pending);
                diverged_reply(&cid, reason)
            }
            Err(_) => {
                self.directional_pending = Some(pending);
                rejected(cid, "verify-rejected", "directional verification failed")
            }
        }
    }

    /// Read-only workspace-send status query: classify the exact retained
    /// [`WorkspacePending`] transaction against a fresh complete observation.
    ///
    /// Takes `&self`, so classification cannot acknowledge, verify, clear,
    /// rebind, or advance any retained state, revision, or topology. Envelope
    /// validation (opaque ids, bounds, containment) is the shared
    /// [`validate_request`] path; target scope validation is the shared
    /// [`Planner::workspace_target_scope`] helper without any mover command
    /// binding. The planned-post predicate is the exact
    /// [`workspace_post_matches`] pure function (it builds one local map and
    /// only reads `pending.desired_geometry` plus the carried request, so it
    /// performs no mutation). Identity mismatch reports `stale` without
    /// recording divergence; a nonmatching observation reports `unresolved`
    /// (never `mixed`); absent pending reports `no-pending-unknown`, which
    /// cannot imply a commit.
    fn evaluate_workspace_status(&self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        let command: WorkspaceStatusCommand =
            match serde_json::from_value(ctx.request.command.clone()) {
                Ok(command) => command,
                Err(error) => {
                    let (kind, message) = classify_parse_error(&error);
                    return rejected(valid_correlation_echo(&ctx.raw), kind, message);
                }
            };
        if command.op != "send-to-workspace-status" {
            return rejected(cid, "status-op-invalid", "status operation is invalid");
        }
        // A `domains` payload on this route is already refused fail-closed by
        // `validate_request` (`domain-invalid`); only the target scope below
        // remains to bind.
        let (target_domain, _) = match self.workspace_target_scope(ctx) {
            Ok(scope) => scope,
            Err(reply) => return reply,
        };
        let Some(pending) = &self.workspace_pending else {
            return status_reply(&cid, None, "no-pending-unknown");
        };
        if let Some(reason) = pending.session.divergence() {
            return diverged_reply(&cid, reason);
        }
        if pending.owner != ctx.owner
            || pending.generation != ctx.generation
            || pending.correlation != ctx.correlation
            || ctx.request.revision != pending.base_revision
        {
            return status_reply(&cid, Some(pending.base_revision), "stale");
        }
        // Strict scope binding: the carried source/target domains (projected
        // bounds and gaps included) must equal the retained pending domains.
        // Window geometry alone does not prove scope.
        let retained = pending.session.domains();
        if retained.len() != 2 || retained[0] != ctx.domain || retained[1] != target_domain {
            return status_reply(&cid, Some(pending.base_revision), "unresolved");
        }
        if !workspace_post_matches(pending, ctx) {
            return status_reply(&cid, Some(pending.base_revision), "unresolved");
        }
        match pending.session.status().state {
            tiler_core::reconcile::StateKind::PendingAcked => {
                status_reply(&cid, Some(pending.base_revision), "post-acked")
            }
            tiler_core::reconcile::StateKind::PendingUnacked => {
                status_reply(&cid, Some(pending.base_revision), "post-unacked")
            }
            _ => status_reply(&cid, Some(pending.base_revision), "unresolved"),
        }
    }

    /// Read-only directional R4 status query: classify the exact retained
    /// [`DirectionalMovePending`] transaction against a fresh complete
    /// observation. Same read-only contract as
    /// [`Planner::evaluate_workspace_status`]; the planned-post predicate is
    /// the exact [`directional_post_matches`] pure function (one local map,
    /// reads only), plus strict carried-pair binding to the retained
    /// source/target keys and projected domains.
    fn evaluate_directional_status(&self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        let command: DirectionalMoveStatusCommand =
            match serde_json::from_value(ctx.request.command.clone()) {
                Ok(command) => command,
                Err(error) => {
                    let (kind, message) = classify_parse_error(&error);
                    return rejected(valid_correlation_echo(&ctx.raw), kind, message);
                }
            };
        if command.op != "directional-move-status" {
            return rejected(cid, "status-op-invalid", "status operation is invalid");
        }
        let Some((source_domain, source_key, target_domain, target_key)) = directional_pair(ctx)
        else {
            return snapshot_invalid(cid, MSG_OBSERVATION, "domain-invalid");
        };
        let Some(pending) = &self.directional_pending else {
            return status_reply(&cid, None, "no-pending-unknown");
        };
        if let Some(reason) = pending.session.divergence() {
            return diverged_reply(&cid, reason);
        }
        if pending.owner != ctx.owner
            || pending.generation != ctx.generation
            || pending.correlation != ctx.correlation
            || ctx.request.revision != pending.base_revision
        {
            return status_reply(&cid, Some(pending.base_revision), "stale");
        }
        if source_key != &pending.source_key || target_key != &pending.target_key {
            return status_reply(&cid, Some(pending.base_revision), "unresolved");
        }
        let retained = pending.session.domains();
        if retained.len() != 2 || retained[0] != *source_domain || retained[1] != *target_domain {
            return status_reply(&cid, Some(pending.base_revision), "unresolved");
        }
        if !directional_post_matches(pending, ctx) {
            return status_reply(&cid, Some(pending.base_revision), "unresolved");
        }
        match pending.session.status().state {
            tiler_core::reconcile::StateKind::PendingAcked => {
                status_reply(&cid, Some(pending.base_revision), "post-acked")
            }
            tiler_core::reconcile::StateKind::PendingUnacked => {
                status_reply(&cid, Some(pending.base_revision), "post-unacked")
            }
            _ => status_reply(&cid, Some(pending.base_revision), "unresolved"),
        }
    }

    /// Workspace-send cancellation: withdraw the exact retained
    /// [`WorkspacePending`] transaction when the adapter proves, over the
    /// same-UID transport, that its flight dispatched no native write and its
    /// current complete observation still equals the dispatch-time pre-image.
    ///
    /// Requires the exact owner/generation/correlation/original-request-
    /// revision identity, the exact route scope, a non-diverged
    /// `PendingUnacked` reconciler state with no drag capture, the
    /// `zero_dispatch` attestation, and byte-exact pre-image equality. On
    /// success clears only the matching pending, its reconciler pending slot,
    /// and its staged desired state; committed topology, focus, exceptions,
    /// retained float geometry, accepted revision/fingerprint, and unrelated
    /// domains are exactly preserved, and the base/ack/verify paths are
    /// untouched. Every other state fails closed with no mutation and no
    /// divergence recorded: started writes can only surface as pre-image or
    /// scope mismatch (natives already moved), acked plans refuse (an applied
    /// ack may already have committed elsewhere), and stale/diverged/absent/
    /// malformed probes change nothing.
    fn evaluate_workspace_cancel(&mut self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        let command: WorkspaceCancelCommand =
            match serde_json::from_value(ctx.request.command.clone()) {
                Ok(command) => command,
                Err(error) => {
                    let (kind, message) = classify_parse_error(&error);
                    return rejected(valid_correlation_echo(&ctx.raw), kind, message);
                }
            };
        if command.op != "send-to-workspace-cancel" {
            return rejected(cid, "cancel-op-invalid", "cancel operation is invalid");
        }
        if !command.zero_dispatch {
            return rejected(cid, "cancel-refused", "adapter attests a native dispatch");
        }
        // A `domains` payload on this route is already refused fail-closed by
        // `validate_request` (`domain-invalid`); only the target scope below
        // remains to bind.
        let (target_domain, _) = match self.workspace_target_scope(ctx) {
            Ok(scope) => scope,
            Err(reply) => return reply,
        };
        let Some(pending) = &mut self.workspace_pending else {
            return rejected(cid, "no-pending", "no workspace plan is pending");
        };
        if let Some(reason) = pending.session.divergence() {
            return diverged_reply(&cid, reason);
        }
        if pending.owner != ctx.owner
            || pending.generation != ctx.generation
            || pending.correlation != ctx.correlation
            || ctx.request.revision != pending.request_revision
        {
            return rejected(
                cid,
                "stale",
                "cancel identity does not match the pending transaction",
            );
        }
        if pending.session.has_drag() {
            return rejected(cid, "cancel-refused", "pending plan holds a drag capture");
        }
        if !matches!(
            pending.session.status().state,
            tiler_core::reconcile::StateKind::PendingUnacked
        ) {
            return rejected(
                cid,
                "cancel-refused",
                "pending plan was already acknowledged",
            );
        }
        // Strict scope binding first: the carried source/target domains
        // (projected bounds and gaps included) must equal the retained pending
        // domains. Window pre-image alone does not prove scope.
        let retained = pending.session.domains();
        if retained.len() != 2 || retained[0] != ctx.domain || retained[1] != target_domain {
            return rejected(
                cid,
                "cancel-mismatch",
                "current scope does not match the pending transaction",
            );
        }
        if !pre_image_matches(
            &pending.pre_focused,
            &pending.pre_windows,
            &pending.pre_target_windows,
            ctx,
        ) {
            return rejected(
                cid,
                "cancel-mismatch",
                "current observation does not match the dispatch-time pre-image",
            );
        }
        let base = pending.base_revision;
        match pending
            .session
            .cancel_unacked_pending(&ctx.correlation, base)
        {
            Ok(()) => {
                self.workspace_pending = None;
                cancelled_reply(&cid, "send-to-workspace", base)
            }
            Err(CancelUnackedError::Diverged(reason)) => diverged_reply(&cid, reason),
            Err(CancelUnackedError::NoPending) => {
                rejected(cid, "no-pending", "no workspace plan is pending")
            }
            Err(CancelUnackedError::AlreadyAcknowledged) => rejected(
                cid,
                "cancel-refused",
                "pending plan was already acknowledged",
            ),
            Err(CancelUnackedError::DragActive) => {
                rejected(cid, "cancel-refused", "pending plan holds a drag capture")
            }
            Err(CancelUnackedError::BindingMismatch) => rejected(
                cid,
                "stale",
                "cancel identity does not match the pending transaction",
            ),
        }
    }

    /// Directional R4 cancellation: withdraw the exact retained
    /// [`DirectionalMovePending`] transaction under the same contract as
    /// [`Planner::evaluate_workspace_cancel`], with the carried pair keys and
    /// projected domains bound to the retained pair plus byte-exact pre-image
    /// equality over the combined two-domain window set. On success the pair
    /// pending clears without splitting or storing: canonical sessions are
    /// exactly preserved.
    fn evaluate_directional_cancel(&mut self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        let command: DirectionalMoveCancelCommand =
            match serde_json::from_value(ctx.request.command.clone()) {
                Ok(command) => command,
                Err(error) => {
                    let (kind, message) = classify_parse_error(&error);
                    return rejected(valid_correlation_echo(&ctx.raw), kind, message);
                }
            };
        if command.op != "directional-move-cancel" {
            return rejected(cid, "cancel-op-invalid", "cancel operation is invalid");
        }
        if !command.zero_dispatch {
            return rejected(cid, "cancel-refused", "adapter attests a native dispatch");
        }
        let Some((source_domain, source_key, target_domain, target_key)) = directional_pair(ctx)
        else {
            return snapshot_invalid(cid, MSG_OBSERVATION, "domain-invalid");
        };
        let Some(pending) = &mut self.directional_pending else {
            return rejected(cid, "no-pending", "no directional move is pending");
        };
        if let Some(reason) = pending.session.divergence() {
            return diverged_reply(&cid, reason);
        }
        if pending.owner != ctx.owner
            || pending.generation != ctx.generation
            || pending.correlation != ctx.correlation
            || ctx.request.revision != pending.request_revision
        {
            return rejected(
                cid,
                "stale",
                "cancel identity does not match the pending transaction",
            );
        }
        if pending.session.has_drag() {
            return rejected(cid, "cancel-refused", "pending plan holds a drag capture");
        }
        if !matches!(
            pending.session.status().state,
            tiler_core::reconcile::StateKind::PendingUnacked
        ) {
            return rejected(
                cid,
                "cancel-refused",
                "pending plan was already acknowledged",
            );
        }
        if source_key != &pending.source_key || target_key != &pending.target_key {
            return rejected(
                cid,
                "cancel-mismatch",
                "current scope does not match the pending transaction",
            );
        }
        let retained = pending.session.domains();
        if retained.len() != 2 || retained[0] != *source_domain || retained[1] != *target_domain {
            return rejected(
                cid,
                "cancel-mismatch",
                "current scope does not match the pending transaction",
            );
        }
        if !pre_image_matches(&pending.pre_focused, &pending.pre_windows, &[], ctx) {
            return rejected(
                cid,
                "cancel-mismatch",
                "current observation does not match the dispatch-time pre-image",
            );
        }
        let base = pending.base_revision;
        match pending
            .session
            .cancel_unacked_pending(&ctx.correlation, base)
        {
            Ok(()) => {
                self.directional_pending = None;
                cancelled_reply(&cid, "directional-move", base)
            }
            Err(CancelUnackedError::Diverged(reason)) => diverged_reply(&cid, reason),
            Err(CancelUnackedError::NoPending) => {
                rejected(cid, "no-pending", "no directional move is pending")
            }
            Err(CancelUnackedError::AlreadyAcknowledged) => rejected(
                cid,
                "cancel-refused",
                "pending plan was already acknowledged",
            ),
            Err(CancelUnackedError::DragActive) => {
                rejected(cid, "cancel-refused", "pending plan holds a drag capture")
            }
            Err(CancelUnackedError::BindingMismatch) => rejected(
                cid,
                "stale",
                "cancel identity does not match the pending transaction",
            ),
        }
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

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RemoveCommand {
    op: String,
    window: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ToggleFloatCommand {
    op: String,
    window: String,
    #[serde(default)]
    float_rect: Option<RectDto>,
}

fn evaluate_toggle_float_with(
    ctx: &Validated,
    evaluate: impl FnOnce(&ToggleFloatCommand, Option<Rect>) -> String,
) -> String {
    let command: ToggleFloatCommand = match serde_json::from_value(ctx.request.command.clone()) {
        Ok(command) => command,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(valid_correlation_echo(&ctx.raw), kind, message);
        }
    };
    if command.op != "toggle-float" {
        return snapshot_invalid(
            ctx.request.correlation_id.clone(),
            MSG_OBSERVATION,
            "toggle-float-op-invalid",
        );
    }
    if !is_opaque_id(&command.window) {
        return snapshot_invalid(
            ctx.request.correlation_id.clone(),
            MSG_OBSERVATION,
            "toggle-float-window-invalid",
        );
    }
    if !ctx
        .request
        .windows
        .iter()
        .any(|entry| entry.window == command.window)
    {
        return rejected(
            ctx.request.correlation_id.clone(),
            "partial-observation",
            MSG_OBSERVATION,
        );
    }
    let float_rect = match command.float_rect.as_ref() {
        Some(rect) if valid_carried_rect(rect.x, rect.y, rect.w, rect.h) => Some(Rect {
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
        }),
        Some(_) => {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OBSERVATION,
                "float-rect-invalid",
            );
        }
        None => None,
    };
    evaluate(&command, float_rect)
}

fn float_planned_reply(
    correlation_id: &str,
    plan: &SessionPlan,
    float_rect: Option<Rect>,
) -> String {
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id: correlation_id.to_owned(),
        outcome: "planned",
        kind: None,
        message: None,
        base_revision: Some(plan.dispatch.base_revision),
        detail: Some(serde_json::json!({
            "kind": "toggle-float",
            "policy_version": plan.dispatch.policy_version,
            "capability": "intentional-float",
        })),
        desired_geometry: Some(plan.desired_geometry.iter().map(geometry_reply).collect()),
        desired_focus: match (&plan.desired_focus_domain, &plan.desired_focus_leaf) {
            (Some(domain), Some(leaf)) => Some(focus_reply(domain, leaf)),
            _ => None,
        },
        float_geometry: float_rect.map(|rect| FloatReplyBody {
            window: match &plan.dispatch.operation {
                LifecycleOperation::Remove { window, .. } => window.0.clone(),
                _ => String::new(),
            },
            rect: RectDto {
                x: rect.x,
                y: rect.y,
                w: rect.w,
                h: rect.h,
            },
        }),
        preconditions: None,
        operation: None,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct DirectedCommand {
    op: String,
    window: String,
    direction: String,
    /// Active KWin currently has no public output-transfer primitive. The
    /// adapter sends false for a two-domain flight, preserving local movement
    /// while rejecting R4 before the planner stages any state. Omitted legacy
    /// requests retain their historical full-capability behavior.
    #[serde(default = "default_cross_output_transfer")]
    cross_output_transfer: bool,
}

const fn default_cross_output_transfer() -> bool {
    true
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

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct PointerResizeCommand {
    op: String,
    window: String,
    direction: String,
    boundary: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReconcileCommand {
    op: String,
}

/// Deliberate gap-update command: same strict envelope as [`ReconcileCommand`]
/// but an explicit opt-in to retained gap reprojection. Only the deliberate
/// tiler-reload route sends it; ordinary drift reconciliation keeps refusing
/// gap changes as `domain-mismatch`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateGapsCommand {
    op: String,
}

/// Read-only active-group highlight query: no parameters beyond the shared
/// observation envelope (domain/windows/focus) plus identity. Strict shape:
/// extra fields reject via the established unknown-field path.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ActiveGroupCommand {
    op: String,
}

/// Fixed `no-group` reasons (short lowercase-hyphenated ASCII, never echoes
/// input). Covers invalid/missing/non-tiled focus, unknown domain/tree,
/// root-leaf focus, projection failure, and pending/divergence.
/// `stale-revision` is retained in this closed registry for contract
/// compatibility but is no longer emitted: the read-only resolver returns the
/// current retained snapshot regardless of the carried revision.
const ACTIVE_GROUP_NO_GROUP_REASONS: &[&str] = &[
    "no-session",
    "diverged",
    "pending",
    "domain-mismatch",
    "stale-revision",
    "focus-mismatch",
    "focus-unmapped",
    "no-tree",
    "no-parent-group",
];

fn no_group_reply(ctx: &Validated, base_revision: Option<u64>, reason: &'static str) -> String {
    debug_assert!(ACTIVE_GROUP_NO_GROUP_REASONS.contains(&reason));
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id: ctx.request.correlation_id.clone(),
        outcome: "no-group",
        kind: Some("no-group".to_owned()),
        message: None,
        base_revision,
        detail: Some(serde_json::json!({
            "kind": "no-group",
            "reason": reason,
            "owner": ctx.owner.as_str(),
            "generation": ctx.generation.as_str(),
        })),
        desired_geometry: None,
        desired_focus: None,
        float_geometry: None,
        preconditions: None,
        operation: None,
    })
}

/// Shared read-only group resolution over one authoritative session (retained
/// or ephemeral): validates domain binding, focus mapping, and tree presence,
/// then derives the focused leaf's immediate parent group through
/// [`tiler_core::active_group::describe_active_group`] using only retained
/// bounds/gap plus engine projection. Always returns a bounded
/// `active-group`/`no-group` reply; never mutates. The carried revision is
/// intentionally not gated: this is a read-only current-state snapshot, so a
/// lagging or initial-zero caller revision still resolves; freshness is
/// carried in the returned `base_revision` for downstream ordering. The
/// `stale-revision` reason token is retained in the closed reason registry
/// for contract compatibility but is no longer emitted by this resolver.
/// Carried windows are never topology sources (see retained-route docs).
fn active_group_response(session: &Session, ctx: &Validated) -> String {
    let base = session.accepted_revision();
    if session.divergence().is_some() {
        return no_group_reply(ctx, Some(base), "diverged");
    }
    if session.has_pending() || session.has_pending_desired() || session.has_drag() {
        return no_group_reply(ctx, Some(base), "pending");
    }
    let Some(retained_domain) = session
        .domains()
        .iter()
        .find(|domain| domain.key() == ctx.domain_key)
        .cloned()
    else {
        return no_group_reply(ctx, Some(base), "domain-mismatch");
    };
    if retained_domain.bounds != ctx.domain.bounds || retained_domain.gap != ctx.domain.gap {
        return no_group_reply(ctx, Some(base), "domain-mismatch");
    }
    let (focus_domain, focus_leaf) = session.focus();
    let (Some(focus_domain), Some(focus_leaf)) = (focus_domain, focus_leaf) else {
        return no_group_reply(ctx, Some(base), "focus-mismatch");
    };
    if focus_domain != ctx.domain_key {
        return no_group_reply(ctx, Some(base), "focus-mismatch");
    }
    let snapshot = session.snapshot();
    let Some(tree) = snapshot
        .domains
        .into_iter()
        .find(|domain| {
            domain.output == ctx.domain_key.output && domain.workspace == ctx.domain_key.workspace
        })
        .and_then(|domain| domain.tree)
    else {
        return no_group_reply(ctx, Some(base), "no-tree");
    };
    let leaf_to_window: std::collections::BTreeMap<NodeId, WindowId> = snapshot
        .windows
        .into_iter()
        .filter(|link| {
            link.output == ctx.domain_key.output && link.workspace == ctx.domain_key.workspace
        })
        .map(|link| (link.leaf, link.window))
        .collect();
    let focused_window = WindowId(ctx.request.focused_window.clone());
    match leaf_to_window.get(&focus_leaf) {
        Some(window) if *window == focused_window => {}
        _ => return no_group_reply(ctx, Some(base), "focus-unmapped"),
    }
    let Some(group) = tiler_core::active_group::describe_active_group(
        &tree,
        retained_domain.bounds,
        retained_domain.gap,
        &focus_leaf,
        &leaf_to_window,
    ) else {
        return no_group_reply(ctx, Some(base), "no-parent-group");
    };
    if group.members.len() > PLAN_MAX_WINDOWS {
        return no_group_reply(ctx, Some(base), "no-parent-group");
    }
    let members: Vec<serde_json::Value> = group
        .members
        .iter()
        .map(|member| {
            serde_json::json!({
                "window": member.window.0,
                "leaf": member.leaf.0,
                "rect": {"x": member.rect.x, "y": member.rect.y, "w": member.rect.w, "h": member.rect.h},
            })
        })
        .collect();
    let geometry: Vec<GeometryReply> = group
        .members
        .iter()
        .map(|member| GeometryReply {
            window: member.window.0.clone(),
            leaf: member.leaf.0.clone(),
            output: ctx.domain_key.output.0.clone(),
            workspace: ctx.domain_key.workspace.0.clone(),
            rect: RectDto {
                x: member.rect.x,
                y: member.rect.y,
                w: member.rect.w,
                h: member.rect.h,
            },
        })
        .collect();
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id: ctx.request.correlation_id.clone(),
        outcome: "active-group",
        kind: Some("active-group".to_owned()),
        message: None,
        base_revision: Some(base),
        detail: Some(serde_json::json!({
            "kind": "active-group",
            "owner": ctx.owner.as_str(),
            "generation": ctx.generation.as_str(),
            "domain_output": ctx.domain_key.output.0,
            "domain_workspace": ctx.domain_key.workspace.0,
            "group": group.group.0,
            "focused_leaf": focus_leaf.0,
            "focused_window": focused_window.0,
            "members": members,
            "bounds": {"x": group.bounds.x, "y": group.bounds.y, "w": group.bounds.w, "h": group.bounds.h},
        })),
        desired_geometry: Some(geometry),
        desired_focus: Some(focus_reply(&ctx.domain_key, &focus_leaf)),
        float_geometry: None,
        preconditions: None,
        operation: None,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkspaceSendCommand {
    op: String,
    window: String,
    target_output: String,
    target_workspace: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkspaceAckCommand {
    op: String,
    ack_outcome: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkspaceVerifyCommand {
    op: String,
    verified: bool,
    preconditions: serde_json::Value,
    operation: serde_json::Value,
}

/// Strict directional R4 acknowledgement command.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct DirectionalMoveAckCommand {
    op: String,
    ack_outcome: String,
}

/// Strict directional R4 verification command: exact echoed preconditions and
/// cross-output operation plus the explicit native verification flag.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct DirectionalMoveVerifyCommand {
    op: String,
    verified: bool,
    preconditions: serde_json::Value,
    operation: serde_json::Value,
}

/// Strict read-only workspace-send status command: no fields beyond the op
/// tag. The envelope already carries the complete fresh observation plus the
/// exact transaction identity; extra fields fail closed as malformed.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkspaceStatusCommand {
    op: String,
}

/// Strict read-only directional R4 status command: no fields beyond the op
/// tag, same envelope rule as the workspace status command.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct DirectionalMoveStatusCommand {
    op: String,
}

/// Strict workspace-send cancellation command: the op tag plus the trusted
/// adapter zero-dispatch attestation. `zero_dispatch` must be exactly true:
/// the adapter attests that this flight dispatched no geometry, membership,
/// or follow setter, so withdrawing the unacknowledged plan cannot strand a
/// native mutation. Rust cannot verify the claim itself; it is trusted only
/// together with the exact identity, scope, unacked state, and pre-image
/// checks, over the same-UID transport that already authorizes the route.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkspaceCancelCommand {
    op: String,
    zero_dispatch: bool,
}

/// Strict directional R4 cancellation command: same attestation contract as
/// the workspace cancellation command.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct DirectionalMoveCancelCommand {
    op: String,
    zero_dispatch: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    type SnapshotMutator = fn(&mut serde_json::Value);

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
                "outer_gap": 0,
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

    #[test]
    fn retained_toggle_float_carries_geometry_then_freshly_admits() {
        let mut planner = Planner::new();
        let float = plan_request(
            "float-1",
            "win-1",
            &["win-1", "win-2"],
            serde_json::json!({
                "op": "toggle-float",
                "window": "win-1",
                "float_rect": {"x": 240, "y": 160, "w": 720, "h": 480},
            }),
        );
        let floated = parse_reply(&planner.evaluate(&float));
        assert_eq!(floated["outcome"], "planned");
        assert_eq!(
            floated["desired_geometry"].as_array().map(Vec::len),
            Some(1)
        );
        assert_eq!(floated["float_geometry"]["window"], "win-1");
        assert_eq!(floated["float_geometry"]["rect"]["w"], 720);

        let mut unfloat: serde_json::Value = serde_json::from_str(&plan_request(
            "float-2",
            "win-1",
            &["win-1", "win-2"],
            serde_json::json!({"op": "toggle-float", "window": "win-1"}),
        ))
        .expect("request JSON");
        unfloat["windows"][0]["floating"] = serde_json::Value::Bool(true);
        let tiled = parse_reply(&planner.evaluate(&unfloat.to_string()));
        assert_eq!(tiled["outcome"], "planned");
        assert_eq!(tiled["float_geometry"], serde_json::Value::Null);
        assert_eq!(tiled["desired_geometry"].as_array().map(Vec::len), Some(2));

        // Re-float selects the durable retained placement: no rect is carried
        // in the request, and the reply echoes the retained rectangle rather
        // than a recomputed center.
        let refloat = plan_request(
            "float-3",
            "win-1",
            &["win-1", "win-2"],
            serde_json::json!({"op": "toggle-float", "window": "win-1"}),
        );
        let refloated = parse_reply(&planner.evaluate(&refloat));
        assert_eq!(refloated["outcome"], "planned");
        assert_eq!(refloated["float_geometry"]["window"], "win-1");
        assert_eq!(
            refloated["float_geometry"]["rect"],
            serde_json::json!({"x": 240, "y": 160, "w": 720, "h": 480})
        );
    }

    #[test]
    fn retained_toggle_float_tracks_moved_live_geometry_across_cycle() {
        let mut planner = Planner::new();
        let float = plan_request(
            "moved-1",
            "win-1",
            &["win-1", "win-2"],
            serde_json::json!({"op": "toggle-float", "window": "win-1"}),
        );
        let floated = parse_reply(&planner.evaluate(&float));
        assert_eq!(floated["outcome"], "planned");
        // No explicit rect: the session resolves the centered 60% placement.
        assert_eq!(
            floated["float_geometry"]["rect"],
            serde_json::json!({"x": 240, "y": 160, "w": 720, "h": 480})
        );

        // Unfloat carries the user's moved live rectangle.
        let mut unfloat: serde_json::Value = serde_json::from_str(&plan_request(
            "moved-2",
            "win-1",
            &["win-1", "win-2"],
            serde_json::json!({
                "op": "toggle-float",
                "window": "win-1",
                "float_rect": {"x": 300, "y": 200, "w": 500, "h": 400},
            }),
        ))
        .expect("request JSON");
        unfloat["windows"][0]["floating"] = serde_json::Value::Bool(true);
        let tiled = parse_reply(&planner.evaluate(&unfloat.to_string()));
        assert_eq!(tiled["outcome"], "planned");
        assert_eq!(tiled["float_geometry"], serde_json::Value::Null);

        // Re-float selects the moved retained rectangle, not the center.
        let refloat = plan_request(
            "moved-3",
            "win-1",
            &["win-1", "win-2"],
            serde_json::json!({"op": "toggle-float", "window": "win-1"}),
        );
        let refloated = parse_reply(&planner.evaluate(&refloat));
        assert_eq!(refloated["outcome"], "planned");
        assert_eq!(
            refloated["float_geometry"]["rect"],
            serde_json::json!({"x": 300, "y": 200, "w": 500, "h": 400})
        );
    }

    #[test]
    fn retained_float_admits_then_moved_reconcile_then_unfloat() {
        // Exact-float incident: p5 float removes the tile and retains
        // placement, later tiled admissions proceed around the exception, a
        // native float move arrives as reconcile, unfloat freshly admits, and
        // a later tiling command still plans. Membership stays canonical and
        // incomplete observations still refuse fail-closed.
        fn float_request(
            correlation: &str,
            focused: &str,
            windows: &[(&str, i32, i32, i32, i32, bool)],
            command: serde_json::Value,
        ) -> String {
            let entries: Vec<serde_json::Value> = windows
                .iter()
                .map(|(window, x, y, w, h, floating)| {
                    let mut entry = serde_json::json!({
                        "window": window,
                        "output": "out-1",
                        "workspace": "ws-1",
                        "rect": {"x": x, "y": y, "w": w, "h": h},
                    });
                    if *floating {
                        entry["floating"] = serde_json::Value::Bool(true);
                        entry["fit_excluded"] = serde_json::Value::Bool(true);
                    }
                    entry
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
                    "bounds": {"x": 0, "y": 0, "w": 1200, "h": 800},
                    "gap": 0,
                    "outer_gap": 0,
                },
                "focused_window": focused,
                "windows": entries,
                "command": command,
            })
            .to_string()
        }

        let mut planner = Planner::new();
        // Two tiled admissions seed the domain.
        for (correlation, focused, windows, command) in [
            (
                "float-seq-1",
                "win-1",
                vec![("win-1", 0, 0, 100, 80, false)],
                serde_json::json!({"op": "admit", "window": "win-1", "output": "out-1", "workspace": "ws-1"}),
            ),
            (
                "float-seq-2",
                "win-2",
                vec![
                    ("win-1", 0, 0, 100, 80, false),
                    ("win-2", 200, 0, 100, 80, false),
                ],
                serde_json::json!({"op": "admit", "window": "win-2", "output": "out-1", "workspace": "ws-1"}),
            ),
        ] {
            let reply = parse_reply(&planner.evaluate(&float_request(
                correlation,
                focused,
                &windows,
                command,
            )));
            assert_eq!(reply["outcome"], "planned", "{reply}");
        }
        // p5 analogue: float removes the tile, retains placement, survivors stay tiled.
        let floated = parse_reply(&planner.evaluate(&float_request(
            "float-seq-3",
            "win-2",
            &[
                ("win-1", 0, 0, 100, 80, false),
                ("win-2", 200, 0, 100, 80, false),
            ],
            serde_json::json!({"op": "toggle-float", "window": "win-2"}),
        )));
        assert_eq!(floated["outcome"], "planned", "{floated}");
        assert_geometry_covers(&floated, &["win-1"]);
        assert_eq!(floated["float_geometry"]["window"], "win-2");
        // Later tiled admissions proceed around the retained exception.
        let admitted3 = parse_reply(&planner.evaluate(&float_request(
            "float-seq-4",
            "win-3",
            &[
                ("win-1", 0, 0, 100, 80, false),
                ("win-2", 240, 160, 720, 480, true),
                ("win-3", 400, 0, 100, 80, false),
            ],
            serde_json::json!({"op": "admit", "window": "win-3", "output": "out-1", "workspace": "ws-1"}),
        )));
        assert_eq!(admitted3["outcome"], "planned", "{admitted3}");
        assert_geometry_covers(&admitted3, &["win-1", "win-3"]);
        let admitted4 = parse_reply(&planner.evaluate(&float_request(
            "float-seq-5",
            "win-4",
            &[
                ("win-1", 0, 0, 100, 80, false),
                ("win-2", 240, 160, 720, 480, true),
                ("win-3", 400, 0, 100, 80, false),
                ("win-4", 600, 0, 100, 80, false),
            ],
            serde_json::json!({"op": "admit", "window": "win-4", "output": "out-1", "workspace": "ws-1"}),
        )));
        assert_eq!(admitted4["outcome"], "planned", "{admitted4}");
        assert_geometry_covers(&admitted4, &["win-1", "win-3", "win-4"]);
        let before = geometry_by_window(&admitted4);
        // Native float movement arrives as reconcile with a drifted float rect.
        // The retained tiled allocation must project unchanged, not reject as
        // malformed-topology merely because an exception is present.
        let reconciled = parse_reply(&planner.evaluate(&float_request(
            "float-seq-6",
            "win-1",
            &[
                ("win-1", 0, 0, 100, 80, false),
                ("win-2", 100, 300, 720, 480, true),
                ("win-3", 400, 0, 100, 80, false),
                ("win-4", 600, 0, 100, 80, false),
            ],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(reconciled["outcome"], "planned", "{reconciled}");
        assert_eq!(reconciled["detail"]["kind"], "reconcile", "{reconciled}");
        assert_geometry_covers(&reconciled, &["win-1", "win-3", "win-4"]);
        assert_eq!(
            geometry_by_window(&reconciled),
            before,
            "{reconciled} vs {admitted4}"
        );
        // Unfloat freshly admits the exception back to tiled.
        let untiled = parse_reply(&planner.evaluate(&float_request(
            "float-seq-7",
            "win-2",
            &[
                ("win-1", 0, 0, 100, 80, false),
                ("win-2", 100, 300, 720, 480, true),
                ("win-3", 400, 0, 100, 80, false),
                ("win-4", 600, 0, 100, 80, false),
            ],
            serde_json::json!({"op": "toggle-float", "window": "win-2"}),
        )));
        assert_eq!(untiled["outcome"], "planned", "{untiled}");
        assert_eq!(untiled["float_geometry"], serde_json::Value::Null);
        assert_geometry_covers(&untiled, &["win-1", "win-2", "win-3", "win-4"]);
        // A later tiling command still plans on the reunited topology.
        let removed = parse_reply(&planner.evaluate(&float_request(
            "float-seq-8",
            "win-1",
            &[
                ("win-1", 0, 0, 100, 80, false),
                ("win-2", 200, 0, 100, 80, false),
                ("win-3", 400, 0, 100, 80, false),
                ("win-4", 600, 0, 100, 80, false),
            ],
            serde_json::json!({"op": "remove", "window": "win-4"}),
        )));
        assert_eq!(removed["outcome"], "planned", "{removed}");
        assert_geometry_covers(&removed, &["win-1", "win-2", "win-3"]);
        // Stale/failure handling stays fail-closed: an incomplete observation
        // refuses, then the complete observation still reconciles.
        let partial = parse_reply(&planner.evaluate(&float_request(
            "float-seq-9",
            "win-1",
            &[
                ("win-1", 0, 0, 100, 80, false),
                ("win-2", 200, 0, 100, 80, false),
            ],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(partial["outcome"], "rejected", "{partial}");
        assert_eq!(partial["kind"], "partial-observation", "{partial}");
        let converged = parse_reply(&planner.evaluate(&float_request(
            "float-seq-10",
            "win-1",
            &[
                ("win-1", 0, 0, 100, 80, false),
                ("win-2", 200, 0, 100, 80, false),
                ("win-3", 400, 0, 100, 80, false),
            ],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(converged["outcome"], "planned", "{converged}");
        assert_geometry_covers(&converged, &["win-1", "win-2", "win-3"]);
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
                "outer_gap": 0,
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
    fn retained_admit_portrait_output_splits_top_bottom_despite_landscape_rects() {
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
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&request));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
        assert_eq!(
            geometry_rects(&reply),
            vec![(0, 0, 800, 600), (0, 600, 800, 600)],
            "{reply}"
        );
    }

    #[test]
    fn retained_admit_landscape_output_splits_left_right_despite_portrait_rects() {
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
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&request));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
        assert_eq!(
            geometry_rects(&reply),
            vec![(0, 0, 600, 800), (600, 0, 600, 800)],
            "{reply}"
        );
    }

    #[test]
    fn retained_admit_square_tie_splits_top_bottom() {
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
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&request));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
        assert_eq!(
            geometry_rects(&reply),
            vec![(0, 0, 500, 250), (0, 250, 500, 250)],
            "{reply}"
        );
    }

    #[test]
    fn admit_reflows_an_out_of_bounds_member_after_planner_restart() {
        let command = serde_json::json!({
            "op": "admit",
            "window": "firefox-new",
            "output": "out-1",
            "workspace": "ws-1",
        });
        // This is the reported shape: an older Firefox member extends 26px
        // below the work area while a new Firefox window is admitted.
        let request = custom_request(
            "admit-oob-1",
            "ghostty",
            (0, 44, 1536, 980),
            &[
                ("ghostty", 0, 44, 504, 980),
                ("firefox-old", 504, 44, 526, 1006),
                ("firefox-new", 1030, 44, 506, 980),
            ],
            command,
        );
        let mut first_planner = Planner::new();
        let first = parse_reply(&first_planner.evaluate(&request));
        assert_eq!(first["outcome"], "planned", "{first}");
        assert_geometry_covers(&first, &["ghostty", "firefox-old", "firefox-new"]);
        for geometry in first["desired_geometry"].as_array().expect("geometry") {
            let rect = &geometry["rect"];
            assert!(rect["x"].as_i64().unwrap() >= 0, "{first}");
            assert!(rect["y"].as_i64().unwrap() >= 44, "{first}");
            assert!(
                rect["x"].as_i64().unwrap() + rect["w"].as_i64().unwrap() <= 1536,
                "{first}"
            );
            assert!(
                rect["y"].as_i64().unwrap() + rect["h"].as_i64().unwrap() <= 1024,
                "{first}"
            );
        }

        // The raw out-of-bounds observation contains no state that can wedge
        // a fresh Planner instance after an adapter or Planner restart.
        let restarted_request = request.replace("admit-oob-1", "admit-oob-2");
        let mut restarted_planner = Planner::new();
        let restarted = parse_reply(&restarted_planner.evaluate(&restarted_request));
        assert_eq!(restarted["outcome"], "planned", "{restarted}");
        assert_geometry_covers(&restarted, &["ghostty", "firefox-old", "firefox-new"]);

        // Existing tiled-state operations still reject an out-of-bounds drift.
        let drift = custom_request(
            "drift-oob-1",
            "ghostty",
            (0, 44, 1536, 980),
            &[
                ("ghostty", 0, 44, 504, 980),
                ("firefox-old", 504, 44, 526, 1006),
                ("firefox-new", 1030, 44, 506, 980),
            ],
            serde_json::json!({"op": "focus", "window": "ghostty", "direction": "left"}),
        );
        let drift_reply = parse_reply(&restarted_planner.evaluate(&drift));
        assert_eq!(drift_reply["kind"], "snapshot-invalid", "{drift_reply}");
        assert_eq!(
            drift_reply["detail"], "window-out-of-bounds",
            "{drift_reply}"
        );
    }

    #[test]
    fn rejection_kinds_are_bounded_without_echo() {
        let bad = plan_request(
            "bounded-1",
            "win-1",
            &["win-1"],
            serde_json::json!({"op": "remove", "window": "evil-window-xyz"}),
        );
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&bad));
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
                "outer_gap": 0,
            },
            "focused_window": focused,
            "windows": entries,
            "command": command,
        })
        .to_string()
    }

    fn retained_request_with_selected_gaps(
        correlation: &str,
        owner: &str,
        generation: &str,
        focused: &str,
        windows: &[(&str, i32, i32, i32, i32)],
        command: serde_json::Value,
    ) -> String {
        let mut request: serde_json::Value = serde_json::from_str(&retained_request(
            correlation,
            owner,
            generation,
            focused,
            windows,
            command,
        ))
        .expect("valid retained request");
        request["domain"]["gap"] = serde_json::json!(8);
        request["domain"]["outer_gap"] = serde_json::json!(8);
        request.to_string()
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
        // Two non-focused windows share an exact frame; retained state
        // proposes directly from membership, so it still plans (the D4
        // behavior under test).
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
        // An admission may rebuild from tied carried rectangles because it
        // assigns a fresh geometry to every member.
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
        assert_eq!(bad["outcome"], "planned", "{bad}");
        assert_geometry_covers(&bad, &["win-1", "win-2", "win-3", "win-4"]);
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

    #[test]
    fn retained_ordinary_activation_resyncs_focus_for_directional() {
        // Part A: ordinary KWin activation changes only the observed
        // `focused_window`; retained Session focus otherwise only moves via
        // planned commands. A directional command carrying the other valid
        // tiled focus with complete matching membership must plan without a
        // generation change, and the follow-up must remain usable.
        let mut planner = Planner::new();
        let first = retained_request(
            "d4-focus-sync-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            admit_body("win-1"),
        );
        assert_eq!(parse_reply(&planner.evaluate(&first))["outcome"], "planned");
        let second = retained_request(
            "d4-focus-sync-2",
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
        // Retained focus is now win-2. Ordinary activation moves observed
        // focus to win-1; membership is complete and unchanged.
        let activated = retained_request(
            "d4-focus-sync-3",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "focus", "window": "win-1", "direction": "right"}),
        );
        let reply = parse_reply(&planner.evaluate(&activated));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
        // Committed resync: follow-up from the new focus stays usable.
        let follow = retained_request(
            "d4-focus-sync-4",
            "owner-1",
            "gen-1",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "focus", "window": "win-2", "direction": "left"}),
        );
        let follow_reply = parse_reply(&planner.evaluate(&follow));
        assert_eq!(follow_reply["outcome"], "planned", "{follow_reply}");
        assert_geometry_covers(&follow_reply, &["win-1", "win-2"]);
    }

    #[test]
    fn retained_keyboard_resize_caps_large_press_index() {
        // D6: retained `op=resize` must apply the COSMIC
        // `(10 + 2 + 2 * press_index).min(20)` cap for every u32.
        // The previous i32 multiply returned 10px for u32::MAX and
        // panicked in debug for 2^31, so a held-key repeat with a large
        // index mis-sized the retained boundary.
        fn resize_shares(press_index: u32) -> serde_json::Value {
            let mut planner = Planner::new();
            for (correlation, focused, windows, command) in [
                (
                    "d6-resize-cap-1",
                    "win-1",
                    vec![("win-1", 0, 0, 100, 80)],
                    admit_body("win-1"),
                ),
                (
                    "d6-resize-cap-2",
                    "win-1",
                    vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                    admit_body("win-2"),
                ),
            ] {
                let request =
                    retained_request(correlation, "owner-1", "gen-1", focused, &windows, command);
                assert_eq!(
                    parse_reply(&planner.evaluate(&request))["outcome"],
                    "planned"
                );
            }
            let request = retained_request(
                "d6-resize-cap-3",
                "owner-1",
                "gen-1",
                "win-2",
                &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({
                    "op": "resize",
                    "window": "win-2",
                    "direction": "left",
                    "mode": "outwards",
                    "press_index": press_index,
                }),
            );
            parse_reply(&planner.evaluate(&request))
        }
        let capped = resize_shares(4);
        assert_eq!(capped["outcome"], "planned", "{capped}");
        assert_geometry_covers(&capped, &["win-1", "win-2"]);
        for press_index in [2_147_483_648u32, u32::MAX] {
            let reply = resize_shares(press_index);
            assert_eq!(reply["outcome"], "planned", "{reply}");
            assert_geometry_covers(&reply, &["win-1", "win-2"]);
            assert_eq!(
                reply["detail"]["new_shares"], capped["detail"]["new_shares"],
                "press_index {press_index} must cap at 20px like press_index 4: {reply} vs {capped}"
            );
        }
    }

    fn seed_pointer_planner() -> Planner {
        let mut planner = Planner::new();
        for (correlation, focused, windows, command) in [
            (
                "ptr-seed-1",
                "win-1",
                vec![("win-1", 0, 0, 100, 80)],
                admit_body("win-1"),
            ),
            (
                "ptr-seed-2",
                "win-1",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                admit_body("win-2"),
            ),
        ] {
            let request =
                retained_request(correlation, "owner-1", "gen-1", focused, &windows, command);
            assert_eq!(
                parse_reply(&planner.evaluate(&request))["outcome"],
                "planned"
            );
        }
        planner
    }

    #[test]
    fn retained_pointer_resize_reflows_allocation_and_shares() {
        let mut planner = seed_pointer_planner();
        let request = retained_request(
            "ptr-ok-1",
            "owner-1",
            "gen-1",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({
                "op": "pointer-resize",
                "window": "win-2",
                "direction": "left",
                "boundary": 550,
            }),
        );
        let reply = parse_reply(&planner.evaluate(&request));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(reply["detail"]["kind"], "pointer-resize", "{reply}");
        assert_eq!(reply["detail"]["capability"], "pointer-resize", "{reply}");
        assert_eq!(reply["detail"]["direction"], "left", "{reply}");
        assert_eq!(reply["detail"]["boundary"], 550, "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
        let old = reply["detail"]["old_shares"]
            .as_array()
            .expect("old shares");
        let new = reply["detail"]["new_shares"]
            .as_array()
            .expect("new shares");
        assert_ne!(old, new, "{reply}");
    }

    #[test]
    fn retained_pointer_resize_out_of_bounds_refuses_precisely() {
        let mut planner = seed_pointer_planner();
        let request = retained_request(
            "ptr-bad-1",
            "owner-1",
            "gen-1",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({
                "op": "pointer-resize",
                "window": "win-2",
                "direction": "left",
                "boundary": 5000,
            }),
        );
        let reply = parse_reply(&planner.evaluate(&request));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "malformed-input", "{reply}");
        assert_eq!(
            reply["message"], "command or observation input is malformed",
            "{reply}"
        );
        assert!(reply.get("detail").is_none(), "{reply}");
        assert!(reply.get("desired_geometry").is_none(), "{reply}");
    }

    #[test]
    fn retained_pointer_resize_refusal_details_are_exact() {
        let mut planner = seed_pointer_planner();
        // Unknown window: valid opaque id covered by the observation but not
        // tiled in the session.
        let request = retained_request(
            "ptr-bad-2",
            "owner-1",
            "gen-1",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({
                "op": "pointer-resize",
                "window": "win-zzz",
                "direction": "left",
                "boundary": 150,
            }),
        );
        let reply = parse_reply(&planner.evaluate(&request));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "unknown-window", "{reply}");
        assert_eq!(
            reply["message"], "window is not known to the session",
            "{reply}"
        );
        assert!(reply.get("desired_geometry").is_none(), "{reply}");
        // Invalid direction binds the exact direction refusal.
        let request = retained_request(
            "ptr-bad-3",
            "owner-1",
            "gen-1",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({
                "op": "pointer-resize",
                "window": "win-2",
                "direction": "sideways",
                "boundary": 150,
            }),
        );
        let reply = parse_reply(&planner.evaluate(&request));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "direction-invalid", "{reply}");
        assert_eq!(reply["message"], "direction is invalid", "{reply}");
        assert!(reply.get("desired_geometry").is_none(), "{reply}");
    }

    fn base_valid_value(cid: &str) -> serde_json::Value {
        serde_json::from_str(&plan_request(
            cid,
            "win-1",
            &["win-1", "win-2"],
            serde_json::json!({"op": "remove", "window": "win-2"}),
        ))
        .expect("valid base")
    }

    fn assert_retained_detail(mut value: serde_json::Value, cid: &str, expected: &str) {
        value["correlation_id"] = serde_json::json!(cid);
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&value.to_string()));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "snapshot-invalid", "{reply}");
        assert_eq!(reply["detail"], expected, "{reply}");
    }

    #[test]
    fn snapshot_validation_details_are_exact() {
        let cases: Vec<(&str, SnapshotMutator)> = vec![
            ("domain-output-invalid", |v| {
                v["domain"]["output"] = serde_json::json!("bad id!")
            }),
            ("domain-workspace-invalid", |v| {
                v["domain"]["workspace"] = serde_json::json!("bad id!")
            }),
            ("focused-id-invalid", |v| {
                v["focused_window"] = serde_json::json!("bad id!")
            }),
            ("observed-window-invalid", |v| {
                v["windows"][0]["window"] = serde_json::json!("bad!")
            }),
            ("observed-output-invalid", |v| {
                v["windows"][0]["output"] = serde_json::json!("bad!")
            }),
            ("observed-workspace-invalid", |v| {
                v["windows"][0]["workspace"] = serde_json::json!("bad!")
            }),
            ("duplicate-window", |v| {
                v["windows"][1]["window"] = serde_json::json!("win-1");
                v["windows"][1]["rect"] = serde_json::json!({"x": 400, "y": 0, "w": 100, "h": 80});
            }),
            ("domain-bounds-invalid", |v| {
                v["domain"]["bounds"]["w"] = serde_json::json!(0)
            }),
            ("gap-low", |v| v["domain"]["gap"] = serde_json::json!(-1)),
            ("gap-high", |v| v["domain"]["gap"] = serde_json::json!(65)),
            ("outer-gap-low", |v| {
                v["domain"]["outer_gap"] = serde_json::json!(-1)
            }),
            ("outer-gap-high", |v| {
                v["domain"]["outer_gap"] = serde_json::json!(65)
            }),
            ("window-rect-invalid", |v| {
                v["windows"][0]["rect"]["w"] = serde_json::json!(0)
            }),
            ("window-out-of-bounds", |v| {
                v["windows"][0]["rect"] = serde_json::json!({"x": 1100, "y": 0, "w": 200, "h": 80});
            }),
            ("focused-not-observed", |v| {
                v["focused_window"] = serde_json::json!("win-9")
            }),
            ("inset-exhausted", |v| {
                v["domain"]["bounds"] = serde_json::json!({"x": 0, "y": 0, "w": 10, "h": 10});
                v["domain"]["outer_gap"] = serde_json::json!(5);
                v["windows"] = serde_json::json!([]);
                v["focused_window"] = serde_json::json!("");
            }),
        ];
        for (index, (expected, mutate)) in cases.into_iter().enumerate() {
            let mut value = base_valid_value(&format!("snap-v-{index}"));
            mutate(&mut value);
            assert_retained_detail(value, &format!("snap-v-{index}"), expected);
        }
        let mut many = base_valid_value("snap-v-limit");
        let mut windows = Vec::new();
        for i in 0..65 {
            windows.push(serde_json::json!({
                "window": format!("win-{i}"),
                "output": "out-1", "workspace": "ws-1",
                "rect": {"x": 0, "y": 0, "w": 10, "h": 10},
            }));
        }
        many["windows"] = serde_json::Value::Array(windows);
        many["focused_window"] = serde_json::json!("win-0");
        assert_retained_detail(many, "snap-v-limit", "window-limit");
    }
    #[test]
    fn command_and_construction_details_are_exact() {
        let cases: Vec<(&str, serde_json::Value)> = vec![
            (
                "admit-window-invalid",
                serde_json::json!({"op": "admit", "window": "bad!", "output": "out-1", "workspace": "ws-1"}),
            ),
            (
                "admit-output-invalid",
                serde_json::json!({"op": "admit", "window": "win-2", "output": "bad!", "workspace": "ws-1"}),
            ),
            (
                "admit-workspace-invalid",
                serde_json::json!({"op": "admit", "window": "win-2", "output": "out-1", "workspace": "bad!"}),
            ),
            (
                "remove-window-invalid",
                serde_json::json!({"op": "remove", "window": "bad!"}),
            ),
            (
                "move-window-invalid",
                serde_json::json!({"op": "move", "window": "bad!", "direction": "left"}),
            ),
            (
                "focus-window-invalid",
                serde_json::json!({"op": "focus", "window": "bad!", "direction": "left"}),
            ),
            (
                "resize-window-invalid",
                serde_json::json!({"op": "resize", "window": "bad!", "direction": "left", "mode": "outwards", "press_index": 0}),
            ),
            (
                "placement-bounds-invalid",
                serde_json::json!({"op": "admit", "window": "win-2", "output": "out-1", "workspace": "ws-1", "placement_bounds": {"x": 0, "y": 0, "w": 0, "h": 80}}),
            ),
        ];
        for (index, (expected, command)) in cases.into_iter().enumerate() {
            let mut value = base_valid_value(&format!("snap-c-{index}"));
            if expected == "placement-bounds-invalid" {
                value["focused_window"] = serde_json::json!("win-1");
            }
            value["command"] = command;
            assert_retained_detail(value, &format!("snap-c-{index}"), expected);
        }
        let ambiguous = retained_request(
            "snap-c-amb",
            "owner-1",
            "gen-1",
            "win-1",
            &[
                ("win-1", 0, 0, 100, 80),
                ("win-2", 200, 0, 100, 80),
                ("win-3", 200, 0, 100, 80),
            ],
            serde_json::json!({"op": "move", "window": "win-1", "direction": "left"}),
        );
        let mut planner = Planner::new();
        let retained = parse_reply(&planner.evaluate(&ambiguous));
        assert_eq!(retained["kind"], "snapshot-invalid", "{retained}");
        assert_eq!(retained["detail"], "missing-seed-order", "{retained}");
    }
    #[test]
    fn retained_op_details_are_exact() {
        let cases = [
            (
                "admit-op-invalid",
                serde_json::json!({"op": "admit", "window": "win-2", "output": "out-1", "workspace": "ws-1"}),
                Planner::evaluate_admit_retained as fn(&mut Planner, &Validated) -> String,
            ),
            (
                "remove-op-invalid",
                serde_json::json!({"op": "remove", "window": "win-2"}),
                Planner::evaluate_remove_retained,
            ),
            (
                "move-op-invalid",
                serde_json::json!({"op": "move", "window": "win-1", "direction": "left"}),
                Planner::evaluate_move_retained,
            ),
            (
                "focus-op-invalid",
                serde_json::json!({"op": "focus", "window": "win-1", "direction": "left"}),
                Planner::evaluate_focus_retained,
            ),
            (
                "resize-op-invalid",
                serde_json::json!({"op": "resize", "window": "win-1", "direction": "left", "mode": "outwards", "press_index": 0}),
                Planner::evaluate_resize_retained,
            ),
        ];
        for (index, (expected, command, eval)) in cases.into_iter().enumerate() {
            let cid = format!("snap-o-ret-{index}");
            let mut ctx =
                validate_request(&plan_request(&cid, "win-1", &["win-1", "win-2"], command))
                    .expect("base valid");
            ctx.request.command["op"] = serde_json::json!("bogus-op");
            let mut planner = Planner::new();
            let text = eval(&mut planner, &ctx);
            let reply = parse_reply(&text);
            assert_eq!(reply["detail"], expected, "{reply}");
            assert_eq!(reply["correlation_id"], cid, "{reply}");
            assert!(text.len() <= PLAN_MAX_REPLY_BYTES, "{reply}");
        }
    }
    #[test]
    fn planner_snapshot_detail_registry_is_unique() {
        use std::collections::HashSet;
        let mut seen = HashSet::new();
        for token in PLANNER_SNAPSHOT_DETAILS {
            assert!(!token.is_empty(), "empty token");
            assert!(token.len() <= 32, "token too long: {token}");
            assert!(
                token
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
                "token must be short lowercase-hyphenated ASCII: {token}"
            );
            assert!(
                !token.contains("window-count-mismatch"),
                "must not generalize existing producer"
            );
            assert!(seen.insert(*token), "duplicate token: {token}");
        }
        assert_eq!(PLANNER_SNAPSHOT_DETAILS.len(), 50, "closed registry size");
    }

    fn geometry_by_window(
        reply: &serde_json::Value,
    ) -> std::collections::BTreeMap<String, (i32, i32, i32, i32)> {
        reply["desired_geometry"]
            .as_array()
            .expect("planned geometry present")
            .iter()
            .map(|entry| {
                let rect = &entry["rect"];
                (
                    entry["window"].as_str().expect("window").to_owned(),
                    (
                        rect["x"].as_i64().unwrap() as i32,
                        rect["y"].as_i64().unwrap() as i32,
                        rect["w"].as_i64().unwrap() as i32,
                        rect["h"].as_i64().unwrap() as i32,
                    ),
                )
            })
            .collect()
    }

    fn seed_two_window_planner() -> Planner {
        let mut planner = Planner::new();
        for (correlation, focused, windows, command) in [
            (
                "rec-seed-1",
                "win-1",
                vec![("win-1", 0, 0, 100, 80)],
                admit_body("win-1"),
            ),
            (
                "rec-seed-2",
                "win-1",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                admit_body("win-2"),
            ),
        ] {
            let request =
                retained_request(correlation, "owner-1", "gen-1", focused, &windows, command);
            let reply = parse_reply(&planner.evaluate(&request));
            assert_eq!(reply["outcome"], "planned", "{reply}");
        }
        assert_eq!(planner.retained_domains(), 1);
        planner
    }

    #[test]
    fn reconcile_retains_allocation_despite_changed_observed_rects() {
        let mut planner = seed_two_window_planner();
        let baseline = retained_request(
            "rec-base-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        let baseline_reply = parse_reply(&planner.evaluate(&baseline));
        assert_eq!(baseline_reply["outcome"], "planned", "{baseline_reply}");
        assert_eq!(
            baseline_reply["detail"]["kind"], "reconcile",
            "{baseline_reply}"
        );
        assert_geometry_covers(&baseline_reply, &["win-1", "win-2"]);
        let before = geometry_by_window(&baseline_reply);
        // Same membership with deliberately drifted client rectangles; the
        // authoritative allocation must not move and shares/topology must not
        // change. Observed rects stay within domain bounds so only allocation
        // retention is exercised, never snapshot validation.
        let drifted = retained_request(
            "rec-drift-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 10, 10), ("win-2", 1100, 700, 50, 50)],
            serde_json::json!({"op": "reconcile"}),
        );
        let drifted_reply = parse_reply(&planner.evaluate(&drifted));
        assert_eq!(drifted_reply["outcome"], "planned", "{drifted_reply}");
        assert_eq!(
            drifted_reply["detail"]["kind"], "reconcile",
            "{drifted_reply}"
        );
        assert_geometry_covers(&drifted_reply, &["win-1", "win-2"]);
        assert_eq!(
            geometry_by_window(&drifted_reply),
            before,
            "{drifted_reply} vs {baseline_reply}"
        );
        assert_eq!(planner.retained_domains(), 1);
        // No pending crosses calls and no topology rebuild: a follow-up
        // directional command still plans on the retained tree.
        let follow = retained_request(
            "rec-follow-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "focus", "window": "win-1", "direction": "right"}),
        );
        let follow_reply = parse_reply(&planner.evaluate(&follow));
        assert_eq!(follow_reply["outcome"], "planned", "{follow_reply}");
    }

    #[test]
    fn discarded_reconcile_reply_leaves_retained_session_ready_for_finish_and_pointer_resize() {
        let mut planner = seed_two_window_planner();
        // The adapter may suppress this reply after native resize starts, but
        // the server has already completed this pure retained projection.
        let held = retained_request(
            "rec-held-1",
            "owner-1",
            "gen-1",
            "win-2",
            &[("win-1", 0, 0, 500, 80), ("win-2", 500, 0, 700, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        let held_reply = parse_reply(&planner.evaluate(&held));
        assert_eq!(held_reply["outcome"], "planned", "{held_reply}");

        // A no-oracle finish resync remains usable in the same retained
        // session: reconcile stages no Session pending transaction.
        let finish = retained_request(
            "rec-finish-1",
            "owner-1",
            "gen-1",
            "win-2",
            &[("win-1", 0, 0, 450, 80), ("win-2", 450, 0, 750, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        let finish_reply = parse_reply(&planner.evaluate(&finish));
        assert_eq!(finish_reply["outcome"], "planned", "{finish_reply}");
        assert_eq!(
            geometry_by_window(&finish_reply),
            geometry_by_window(&held_reply),
            "finish resync retains the original allocation"
        );

        // A delayed valid oracle verdict can still commit the selected pointer
        // share adjustment after either retained projection has been evaluated.
        let pointer = retained_request(
            "rec-pointer-1",
            "owner-1",
            "gen-1",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({
                "op": "pointer-resize",
                "window": "win-2",
                "direction": "left",
                "boundary": 550,
            }),
        );
        let pointer_reply = parse_reply(&planner.evaluate(&pointer));
        assert_eq!(pointer_reply["outcome"], "planned", "{pointer_reply}");
        assert_eq!(
            pointer_reply["detail"]["kind"], "pointer-resize",
            "{pointer_reply}"
        );
        assert_ne!(
            pointer_reply["detail"]["old_shares"], pointer_reply["detail"]["new_shares"],
            "the delayed oracle boundary remains authoritative"
        );
    }

    #[test]
    fn reconcile_reprojects_retained_tree_for_scale_style_work_area_change() {
        let mut planner = Planner::new();
        for (correlation, windows, command) in [
            (
                "rec-gap-seed-1",
                vec![("win-1", 0, 0, 100, 80)],
                admit_body("win-1"),
            ),
            (
                "rec-gap-seed-2",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                admit_body("win-2"),
            ),
        ] {
            let reply = parse_reply(&planner.evaluate(&retained_request_with_selected_gaps(
                correlation,
                "owner-1",
                "gen-1",
                "win-1",
                &windows,
                command,
            )));
            assert_eq!(reply["outcome"], "planned", "{reply}");
        }
        let mut request: serde_json::Value =
            serde_json::from_str(&retained_request_with_selected_gaps(
                "rec-grow-1",
                "owner-1",
                "gen-1",
                "win-1",
                &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "reconcile"}),
            ))
            .expect("valid request");
        request["domain"]["bounds"] = serde_json::json!({"x": 0, "y": 0, "w": 1800, "h": 1200});
        assert_eq!(request["domain"]["gap"], 8);
        assert_eq!(request["domain"]["outer_gap"], 8);
        let grown = parse_reply(&planner.evaluate(&request.to_string()));
        assert_eq!(grown["outcome"], "planned", "{grown}");
        assert_eq!(
            geometry_by_window(&grown),
            std::collections::BTreeMap::from([
                ("win-1".to_owned(), (8, 8, 888, 1184)),
                ("win-2".to_owned(), (904, 8, 888, 1184)),
            ])
        );

        request["correlation_id"] = serde_json::json!("rec-shrink-1");
        request["domain"]["bounds"] = serde_json::json!({"x": 0, "y": 0, "w": 800, "h": 600});
        let shrunk = parse_reply(&planner.evaluate(&request.to_string()));
        assert_eq!(shrunk["outcome"], "planned", "{shrunk}");
        assert_eq!(
            geometry_by_window(&shrunk),
            std::collections::BTreeMap::from([
                ("win-1".to_owned(), (8, 8, 388, 584)),
                ("win-2".to_owned(), (404, 8, 388, 584)),
            ])
        );
    }

    #[test]
    fn reconcile_rejects_changed_outer_gap_as_a_domain_mismatch() {
        let mut planner = Planner::new();
        for (correlation, windows, command) in [
            (
                "rec-outer-seed-1",
                vec![("win-1", 0, 0, 100, 80)],
                admit_body("win-1"),
            ),
            (
                "rec-outer-seed-2",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                admit_body("win-2"),
            ),
        ] {
            let reply = parse_reply(&planner.evaluate(&retained_request_with_selected_gaps(
                correlation,
                "owner-1",
                "gen-1",
                "win-1",
                &windows,
                command,
            )));
            assert_eq!(reply["outcome"], "planned", "{reply}");
        }
        let mut request: serde_json::Value =
            serde_json::from_str(&retained_request_with_selected_gaps(
                "rec-outer-reproject-1",
                "owner-1",
                "gen-1",
                "win-1",
                &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "reconcile"}),
            ))
            .expect("valid request");
        request["domain"]["outer_gap"] = serde_json::json!(0);
        let reply = parse_reply(&planner.evaluate(&request.to_string()));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "domain-mismatch", "{reply}");
        assert_eq!(
            reply["message"],
            "domain outer gap does not match retained state"
        );
        assert!(reply.get("detail").is_none(), "{reply}");
    }

    fn seed_gap_planner() -> Planner {
        let mut planner = Planner::new();
        for (correlation, windows, command) in [
            (
                "gap-seed-1",
                vec![("win-1", 0, 0, 100, 80)],
                admit_body("win-1"),
            ),
            (
                "gap-seed-2",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                admit_body("win-2"),
            ),
        ] {
            let reply = parse_reply(&planner.evaluate(&retained_request_with_selected_gaps(
                correlation,
                "owner-1",
                "gen-1",
                "win-1",
                &windows,
                command,
            )));
            assert_eq!(reply["outcome"], "planned", "{reply}");
        }
        assert_eq!(planner.retained_domains(), 1);
        planner
    }

    fn update_gaps_request(correlation: &str, inner: i32, outer: i32) -> String {
        let mut request: serde_json::Value =
            serde_json::from_str(&retained_request_with_selected_gaps(
                correlation,
                "owner-1",
                "gen-1",
                "win-1",
                &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "update-gaps"}),
            ))
            .expect("valid request");
        request["domain"]["gap"] = serde_json::json!(inner);
        request["domain"]["outer_gap"] = serde_json::json!(outer);
        request.to_string()
    }

    fn reconcile_gaps_request(correlation: &str, inner: i32, outer: i32) -> String {
        let mut request: serde_json::Value =
            serde_json::from_str(&retained_request_with_selected_gaps(
                correlation,
                "owner-1",
                "gen-1",
                "win-1",
                &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "reconcile"}),
            ))
            .expect("valid request");
        request["domain"]["gap"] = serde_json::json!(inner);
        request["domain"]["outer_gap"] = serde_json::json!(outer);
        request.to_string()
    }

    #[test]
    fn update_gaps_accepts_changed_inner_gap_and_reprojects_retained_tree() {
        let mut planner = seed_gap_planner();
        let baseline = parse_reply(&planner.evaluate(&reconcile_gaps_request("gap-base-1", 8, 8)));
        assert_eq!(baseline["outcome"], "planned", "{baseline}");
        assert_eq!(baseline["detail"]["kind"], "reconcile", "{baseline}");
        assert_geometry_covers(&baseline, &["win-1", "win-2"]);
        let before = geometry_by_window(&baseline);
        assert_eq!(
            before,
            std::collections::BTreeMap::from([
                ("win-1".to_owned(), (8, 8, 588, 784)),
                ("win-2".to_owned(), (604, 8, 588, 784)),
            ]),
            "{baseline}"
        );

        let updated = parse_reply(&planner.evaluate(&update_gaps_request("gap-inner-1", 16, 8)));
        assert_eq!(updated["outcome"], "planned", "{updated}");
        assert_eq!(updated["detail"]["kind"], "update-gaps", "{updated}");
        assert_eq!(
            updated["detail"]["capability"], "update-gaps-geometry",
            "{updated}"
        );
        assert_geometry_covers(&updated, &["win-1", "win-2"]);
        // Native-apply-relevant reply: the retained tree reprojected with the
        // new inner gap into the unchanged outer-inset bounds.
        assert_eq!(
            geometry_by_window(&updated),
            std::collections::BTreeMap::from([
                ("win-1".to_owned(), (8, 8, 584, 784)),
                ("win-2".to_owned(), (608, 8, 584, 784)),
            ]),
            "{updated}"
        );
        assert_ne!(geometry_by_window(&updated), before, "{updated}");
        // Focus and accepted revision are preserved, not reseeded.
        assert_eq!(
            updated["desired_focus"], baseline["desired_focus"],
            "{updated}"
        );
        assert_eq!(
            updated["base_revision"], baseline["base_revision"],
            "{updated}"
        );
        assert_eq!(planner.retained_domains(), 1);

        // The retained session now owns the new gaps: a normal reconcile with
        // the new gaps converges, while the old-flight gaps refuse.
        let converged =
            parse_reply(&planner.evaluate(&reconcile_gaps_request("gap-inner-2", 16, 8)));
        assert_eq!(converged["outcome"], "planned", "{converged}");
        assert_eq!(
            geometry_by_window(&converged),
            geometry_by_window(&updated),
            "{converged} vs {updated}"
        );
        let stale = parse_reply(&planner.evaluate(&reconcile_gaps_request("gap-inner-3", 8, 8)));
        assert_eq!(stale["outcome"], "rejected", "{stale}");
        assert_eq!(stale["kind"], "domain-mismatch", "{stale}");

        // Round trip back to the original gaps restores the exact baseline
        // allocation: topology and shares survived, nothing reseeded.
        let restored = parse_reply(&planner.evaluate(&update_gaps_request("gap-inner-4", 8, 8)));
        assert_eq!(restored["outcome"], "planned", "{restored}");
        assert_eq!(geometry_by_window(&restored), before, "{restored}");
        assert_eq!(
            restored["desired_focus"], baseline["desired_focus"],
            "{restored}"
        );
    }

    #[test]
    fn update_gaps_accepts_changed_outer_gap_and_reprojects_retained_tree() {
        let mut planner = seed_gap_planner();
        let baseline = parse_reply(&planner.evaluate(&reconcile_gaps_request("gap-obase-1", 8, 8)));
        assert_eq!(baseline["outcome"], "planned", "{baseline}");
        let before = geometry_by_window(&baseline);

        let updated = parse_reply(&planner.evaluate(&update_gaps_request("gap-outer-1", 8, 0)));
        assert_eq!(updated["outcome"], "planned", "{updated}");
        assert_eq!(updated["detail"]["kind"], "update-gaps", "{updated}");
        assert_geometry_covers(&updated, &["win-1", "win-2"]);
        // Outer zero drops the work-area inset: the full 1200x800 carries the
        // retained split with the unchanged inner gap.
        assert_eq!(
            geometry_by_window(&updated),
            std::collections::BTreeMap::from([
                ("win-1".to_owned(), (0, 0, 596, 800)),
                ("win-2".to_owned(), (604, 0, 596, 800)),
            ]),
            "{updated}"
        );
        assert_ne!(geometry_by_window(&updated), before, "{updated}");
        assert_eq!(
            updated["desired_focus"], baseline["desired_focus"],
            "{updated}"
        );
        assert_eq!(
            updated["base_revision"], baseline["base_revision"],
            "{updated}"
        );
        assert_eq!(planner.retained_domains(), 1);

        let converged =
            parse_reply(&planner.evaluate(&reconcile_gaps_request("gap-outer-2", 8, 0)));
        assert_eq!(converged["outcome"], "planned", "{converged}");
        assert_eq!(
            geometry_by_window(&converged),
            geometry_by_window(&updated),
            "{converged} vs {updated}"
        );
        let stale = parse_reply(&planner.evaluate(&reconcile_gaps_request("gap-outer-3", 8, 8)));
        assert_eq!(stale["outcome"], "rejected", "{stale}");
        assert_eq!(stale["kind"], "domain-mismatch", "{stale}");

        let restored = parse_reply(&planner.evaluate(&update_gaps_request("gap-outer-4", 8, 8)));
        assert_eq!(restored["outcome"], "planned", "{restored}");
        assert_eq!(geometry_by_window(&restored), before, "{restored}");
    }

    #[test]
    fn update_gaps_accepts_combined_inner_and_outer_change() {
        let mut planner = seed_gap_planner();
        let baseline = parse_reply(&planner.evaluate(&reconcile_gaps_request("gap-cbase-1", 8, 8)));
        assert_eq!(baseline["outcome"], "planned", "{baseline}");

        let updated = parse_reply(&planner.evaluate(&update_gaps_request("gap-combo-1", 4, 12)));
        assert_eq!(updated["outcome"], "planned", "{updated}");
        assert_eq!(updated["detail"]["kind"], "update-gaps", "{updated}");
        assert_geometry_covers(&updated, &["win-1", "win-2"]);
        // Outer 12 insets to (12,12,1176,776); inner 4 splits 1172 into 586s.
        assert_eq!(
            geometry_by_window(&updated),
            std::collections::BTreeMap::from([
                ("win-1".to_owned(), (12, 12, 586, 776)),
                ("win-2".to_owned(), (602, 12, 586, 776)),
            ]),
            "{updated}"
        );
        assert_eq!(
            updated["desired_focus"], baseline["desired_focus"],
            "{updated}"
        );
        assert_eq!(
            updated["base_revision"], baseline["base_revision"],
            "{updated}"
        );

        // A later directional command still plans on the retained tree with
        // the new gaps instead of reseeding.
        let mut follow: serde_json::Value =
            serde_json::from_str(&retained_request_with_selected_gaps(
                "gap-combo-2",
                "owner-1",
                "gen-1",
                "win-1",
                &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "focus", "window": "win-1", "direction": "right"}),
            ))
            .expect("valid request");
        follow["domain"]["gap"] = serde_json::json!(4);
        follow["domain"]["outer_gap"] = serde_json::json!(12);
        let follow_reply = parse_reply(&planner.evaluate(&follow.to_string()));
        assert_eq!(follow_reply["outcome"], "planned", "{follow_reply}");
    }

    #[test]
    fn update_gaps_preserves_resized_shares_across_round_trip() {
        let mut planner = seed_gap_planner();
        let resized = parse_reply(&planner.evaluate(&retained_request_with_selected_gaps(
            "gap-share-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({
                "op": "resize",
                "window": "win-1",
                "direction": "right",
                "mode": "outwards",
                "press_index": 0,
            }),
        )));
        assert_eq!(resized["outcome"], "planned", "{resized}");
        let shares = geometry_by_window(&resized);
        assert_ne!(
            shares["win-1"].2, shares["win-2"].2,
            "resize must leave unequal shares {resized}"
        );
        let baseline = parse_reply(&planner.evaluate(&reconcile_gaps_request("gap-share-2", 8, 8)));
        assert_eq!(baseline["outcome"], "planned", "{baseline}");
        let before = geometry_by_window(&baseline);
        assert_ne!(
            before["win-1"].2, before["win-2"].2,
            "reconcile must retain resized shares {baseline}"
        );

        let updated = parse_reply(&planner.evaluate(&update_gaps_request("gap-share-3", 16, 8)));
        assert_eq!(updated["outcome"], "planned", "{updated}");
        let reprojected = geometry_by_window(&updated);
        assert_ne!(
            reprojected["win-1"].2, reprojected["win-2"].2,
            "gap reprojection must retain resized shares {updated}"
        );
        // Leaf identity is stable: the same retained leaves carry new rects.
        let leaves_before: std::collections::BTreeSet<String> = baseline["desired_geometry"]
            .as_array()
            .expect("geometry")
            .iter()
            .map(|g| g["leaf"].as_str().expect("leaf").to_owned())
            .collect();
        let leaves_after: std::collections::BTreeSet<String> = updated["desired_geometry"]
            .as_array()
            .expect("geometry")
            .iter()
            .map(|g| g["leaf"].as_str().expect("leaf").to_owned())
            .collect();
        assert_eq!(leaves_before, leaves_after, "{updated}");

        let restored = parse_reply(&planner.evaluate(&update_gaps_request("gap-share-4", 8, 8)));
        assert_eq!(restored["outcome"], "planned", "{restored}");
        assert_eq!(
            geometry_by_window(&restored),
            before,
            "round trip must restore resized allocation exactly {restored}"
        );
    }

    #[test]
    fn update_gaps_refuses_membership_change_without_mutation() {
        let mut planner = seed_gap_planner();
        let baseline = parse_reply(&planner.evaluate(&reconcile_gaps_request("gap-part-1", 8, 8)));
        assert_eq!(baseline["outcome"], "planned", "{baseline}");
        let before = geometry_by_window(&baseline);

        let mut partial: serde_json::Value =
            serde_json::from_str(&update_gaps_request("gap-part-2", 16, 8)).expect("valid request");
        partial["windows"] = serde_json::json!([
            {"window": "win-1", "output": "out-1", "workspace": "ws-1",
             "rect": {"x": 0, "y": 0, "w": 100, "h": 80}},
        ]);
        let refused = parse_reply(&planner.evaluate(&partial.to_string()));
        assert_eq!(refused["outcome"], "rejected", "{refused}");
        assert_eq!(refused["kind"], "partial-observation", "{refused}");

        // The refused update mutated nothing: the old gaps still converge to
        // the exact baseline allocation.
        let converged = parse_reply(&planner.evaluate(&reconcile_gaps_request("gap-part-3", 8, 8)));
        assert_eq!(converged["outcome"], "planned", "{converged}");
        assert_eq!(geometry_by_window(&converged), before, "{converged}");
    }

    #[test]
    fn update_gaps_refuses_unknown_domain_without_seeding() {
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&update_gaps_request("gap-unknown-1", 16, 8)));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "unknown-domain", "{reply}");
        assert_eq!(planner.retained_domains(), 0);
    }

    #[test]
    fn update_gaps_rejects_out_of_range_gaps_as_snapshot_invalid() {
        let mut planner = seed_gap_planner();
        for (correlation, inner, outer, expected) in [
            ("gap-range-1", -1, 8, "gap-low"),
            ("gap-range-2", 65, 8, "gap-high"),
            ("gap-range-3", 8, -1, "outer-gap-low"),
            ("gap-range-4", 8, 65, "outer-gap-high"),
        ] {
            let reply =
                parse_reply(&planner.evaluate(&update_gaps_request(correlation, inner, outer)));
            assert_eq!(reply["outcome"], "rejected", "{reply}");
            assert_eq!(reply["kind"], "snapshot-invalid", "{reply}");
            assert_eq!(reply["detail"], expected, "{reply}");
        }
        // The refused range checks mutated nothing: old gaps still converge.
        let converged =
            parse_reply(&planner.evaluate(&reconcile_gaps_request("gap-range-5", 8, 8)));
        assert_eq!(converged["outcome"], "planned", "{converged}");
    }

    #[test]
    fn update_gaps_rejects_malformed_command_shape() {
        let mut planner = seed_gap_planner();
        let mut request: serde_json::Value =
            serde_json::from_str(&update_gaps_request("gap-shape-1", 16, 8))
                .expect("valid request");
        request["command"] = serde_json::json!({"op": "update-gaps", "extra": 1});
        let reply = parse_reply(&planner.evaluate(&request.to_string()));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "unknown-field", "{reply}");
    }

    #[test]
    fn reconcile_reprojects_unequal_nested_retained_shares_not_observed_rects() {
        let mut planner = Planner::new();
        for (correlation, windows, command) in [
            (
                "rec-nested-seed-1",
                vec![("win-1", 0, 0, 100, 80)],
                admit_body("win-1"),
            ),
            (
                "rec-nested-seed-2",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                admit_body("win-2"),
            ),
            (
                "rec-nested-seed-3",
                vec![
                    ("win-1", 0, 0, 100, 80),
                    ("win-2", 200, 0, 100, 80),
                    ("win-3", 400, 0, 100, 80),
                ],
                admit_body("win-3"),
            ),
        ] {
            let reply = parse_reply(&planner.evaluate(&retained_request_with_selected_gaps(
                correlation,
                "owner-1",
                "gen-1",
                "win-1",
                &windows,
                command,
            )));
            assert_eq!(reply["outcome"], "planned", "{reply}");
        }
        let resized = parse_reply(&planner.evaluate(&retained_request_with_selected_gaps(
            "rec-nested-resize",
            "owner-1",
            "gen-1",
            "win-1",
            &[
                ("win-1", 0, 0, 100, 80),
                ("win-2", 200, 0, 100, 80),
                ("win-3", 400, 0, 100, 80),
            ],
            serde_json::json!({
                "op": "resize",
                "window": "win-1",
                "direction": "right",
                "mode": "outwards",
                "press_index": 0,
            }),
        )));
        assert_eq!(resized["outcome"], "planned", "{resized}");
        let before = geometry_by_window(&resized);
        assert_ne!(
            before["win-1"].2, before["win-3"].2,
            "resize must retain unequal nested shares"
        );

        let mut request: serde_json::Value =
            serde_json::from_str(&retained_request_with_selected_gaps(
                "rec-nested-reproject",
                "owner-1",
                "gen-1",
                "win-1",
                &[
                    ("win-1", 100, 50, 100, 100),
                    ("win-2", 500, 200, 200, 200),
                    ("win-3", 700, 400, 100, 100),
                ],
                serde_json::json!({"op": "reconcile"}),
            ))
            .expect("valid request");
        request["domain"]["bounds"] = serde_json::json!({"x": 100, "y": 50, "w": 1000, "h": 700});
        let reprojected = parse_reply(&planner.evaluate(&request.to_string()));
        assert_eq!(reprojected["outcome"], "planned", "{reprojected}");
        let after = geometry_by_window(&reprojected);
        assert_ne!(
            after["win-1"].2, after["win-3"].2,
            "nested retained shares must survive reprojection"
        );
        assert_ne!(
            after["win-1"],
            (108, 58, 100, 100),
            "reprojection must not adopt observed client rectangles"
        );
    }

    #[test]
    fn reconcile_membership_mismatch_rejects_with_single_reason() {
        let mut planner = seed_two_window_planner();
        let mismatched = retained_request(
            "rec-mismatch-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-3", 400, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        let reply = parse_reply(&planner.evaluate(&mismatched));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "partial-observation", "{reply}");
        assert_eq!(
            reply["message"], "observation does not cover the known window set",
            "{reply}"
        );
        assert!(reply.get("detail").is_none(), "{reply}");
        assert_ne!(reply["kind"], "diverged", "{reply}");
        // Preserved state: the next complete observation still reconciles.
        assert_eq!(planner.retained_domains(), 1);
        let recover = retained_request(
            "rec-mismatch-2",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        let recovered = parse_reply(&planner.evaluate(&recover));
        assert_eq!(recovered["outcome"], "planned", "{recovered}");
        assert_geometry_covers(&recovered, &["win-1", "win-2"]);
    }

    #[test]
    fn invalid_command_paths_have_single_precise_reason() {
        let mut planner = seed_two_window_planner();
        // Unknown op stays coarse-free with exactly one kind.
        let unknown = retained_request(
            "inv-unknown-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "bogus-op"}),
        );
        let unknown_reply = parse_reply(&planner.evaluate(&unknown));
        assert_eq!(unknown_reply["outcome"], "rejected", "{unknown_reply}");
        assert_eq!(unknown_reply["kind"], "unknown-value", "{unknown_reply}");
        // Strict shape: extra fields reject without rebuilding.
        let extra = retained_request(
            "inv-extra-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile", "extra": 1}),
        );
        let extra_reply = parse_reply(&planner.evaluate(&extra));
        assert_eq!(extra_reply["outcome"], "rejected", "{extra_reply}");
        assert_eq!(extra_reply["kind"], "unknown-field", "{extra_reply}");
        // Direct op-mismatch details are exact single tokens.
        let cid = "inv-op-1";
        let mut ctx = validate_request(&retained_request(
            cid,
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        ))
        .expect("base valid");
        ctx.request.command["op"] = serde_json::json!("bogus-op");
        let text = planner.evaluate_reconcile_retained(&ctx);
        let reply = parse_reply(&text);
        assert_eq!(reply["kind"], "snapshot-invalid", "{reply}");
        assert_eq!(reply["detail"], "reconcile-op-invalid", "{reply}");
    }

    fn workspace_entry(window: &str, workspace: &str, x: i32) -> serde_json::Value {
        serde_json::json!({
            "window": window,
            "output": "out-1",
            "workspace": workspace,
            "rect": {"x": x, "y": 0, "w": 100, "h": 80},
        })
    }

    /// Full workspace-send request over source ws-1 and target ws-2. `focused`
    /// names the observed focused window (empty when the source is empty) and
    /// `revision` is the carried observation revision (0 on request, the
    /// seeded base on ack/verify). Optional overrides mutate the request
    /// before serialization so refusal routes share one builder.
    #[allow(clippy::too_many_arguments)]
    fn workspace_request(
        correlation: &str,
        owner: &str,
        generation: &str,
        revision: u64,
        focused: &str,
        source: Vec<serde_json::Value>,
        target: Vec<serde_json::Value>,
        command: serde_json::Value,
    ) -> String {
        let windows = if source.is_empty() {
            serde_json::json!([])
        } else {
            serde_json::Value::Array(source)
        };
        let target_windows = serde_json::Value::Array(target);
        serde_json::json!({
            "v": 1,
            "correlation_id": correlation,
            "owner": owner,
            "generation": generation,
            "revision": revision,
            "fingerprint": 7,
            "domain": {
                "output": "out-1",
                "workspace": "ws-1",
                "bounds": {"x": 0, "y": 0, "w": 1200, "h": 800},
                "gap": 0,
                "outer_gap": 0,
            },
            "target_domain": {
                "output": "out-1",
                "workspace": "ws-2",
                "bounds": {"x": 0, "y": 0, "w": 1200, "h": 800},
                "gap": 0,
                "outer_gap": 0,
            },
            "focused_window": focused,
            "windows": windows,
            "target_windows": target_windows,
            "command": command,
        })
        .to_string()
    }

    fn workspace_send_body() -> serde_json::Value {
        serde_json::json!({
            "op": "send-to-workspace",
            "window": "win-1",
            "target_output": "out-1",
            "target_workspace": "ws-2",
        })
    }

    fn workspace_ack_body() -> serde_json::Value {
        serde_json::json!({"op": "send-to-workspace-ack", "ack_outcome": "accepted"})
    }

    fn workspace_verify_body(
        preconditions: serde_json::Value,
        operation: serde_json::Value,
    ) -> serde_json::Value {
        serde_json::json!({
            "op": "send-to-workspace-verify",
            "verified": true,
            "preconditions": preconditions,
            "operation": operation,
        })
    }

    /// Split a planned `desired_geometry` into the exact source and target
    /// post-observation the adapter must report back after applying the plan.
    fn observation_from_geometry(
        geometry: &serde_json::Value,
    ) -> (Vec<serde_json::Value>, Vec<serde_json::Value>) {
        let mut source = Vec::new();
        let mut target = Vec::new();
        for entry in geometry.as_array().expect("desired geometry array") {
            let workspace = entry["workspace"].as_str().expect("workspace");
            let rect = &entry["rect"];
            let observed = serde_json::json!({
                "window": entry["window"].as_str().expect("window"),
                "output": entry["output"].as_str().expect("output"),
                "workspace": workspace,
                "rect": {
                    "x": rect["x"], "y": rect["y"], "w": rect["w"], "h": rect["h"],
                },
            });
            if workspace == "ws-1" {
                source.push(observed);
            } else {
                target.push(observed);
            }
        }
        (source, target)
    }

    /// Drive a full successful lifecycle: request, ack, verify. Returns the
    /// verify reply plus the echoed operation/preconditions from the request
    /// reply so mismatch tests can mutate them.
    fn run_workspace_lifecycle(
        planner: &mut Planner,
    ) -> (serde_json::Value, serde_json::Value, serde_json::Value) {
        let source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let request = workspace_request(
            "ws-ok-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source,
            target,
            workspace_send_body(),
        );
        let planned = parse_reply(&planner.evaluate(&request));
        assert_eq!(planned["outcome"], "planned", "{planned}");
        assert_eq!(planned["kind"], "send-to-workspace", "{planned}");
        // The seeded two-domain session advances one revision per admitted
        // window, so the proposal base is the seeded window count (3).
        assert_eq!(planned["base_revision"], 3, "{planned}");
        let preconditions = planned["preconditions"].clone();
        let operation = planned["operation"].clone();
        assert!(
            planned["desired_geometry"]
                .as_array()
                .is_some_and(|g| g.len() == 3),
            "{planned}"
        );
        assert!(
            planned["desired_focus"]["leaf"].as_str().is_some(),
            "{planned}"
        );
        let base = planned["base_revision"].as_u64().expect("base revision");
        let desired_geometry = planned["desired_geometry"].clone();
        let (ack_source, ack_target) = observation_from_geometry(&desired_geometry);
        // Ack phase carries the same complete post-observation.
        let ack_request = workspace_request(
            "ws-ok-1",
            "owner-1",
            "gen-1",
            base,
            "",
            ack_source,
            ack_target,
            workspace_ack_body(),
        );
        let acked = parse_reply(&planner.evaluate(&ack_request));
        assert_eq!(acked["outcome"], "acknowledged", "{acked}");
        assert_eq!(acked["kind"], "send-to-workspace", "{acked}");
        assert_eq!(acked["base_revision"], base, "{acked}");
        // Verify phase with the exact same post-observation.
        let (verify_source, verify_target) = observation_from_geometry(&desired_geometry);
        let verify_request = workspace_request(
            "ws-ok-1",
            "owner-1",
            "gen-1",
            base,
            "",
            verify_source,
            verify_target,
            workspace_verify_body(preconditions.clone(), operation.clone()),
        );
        let committed = parse_reply(&planner.evaluate(&verify_request));
        assert_eq!(committed["outcome"], "committed", "{committed}");
        assert_eq!(committed["kind"], "send-to-workspace", "{committed}");
        assert_eq!(committed["base_revision"], base + 1, "{committed}");
        (committed, preconditions, operation)
    }

    #[test]
    fn workspace_send_lifecycle_commits_only_after_ack_and_verify() {
        let mut planner = Planner::new();
        let (committed, _, _) = run_workspace_lifecycle(&mut planner);
        assert_eq!(committed["outcome"], "committed", "{committed}");
        // Pending released after commit: a fresh request plans again.
        let source = vec![workspace_entry("win-1", "ws-1", 0)];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let second = parse_reply(&planner.evaluate(&workspace_request(
            "ws-ok-2",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source,
            target,
            workspace_send_body(),
        )));
        assert_eq!(second["outcome"], "planned", "{second}");
    }

    #[test]
    fn workspace_send_verify_after_pending_is_rejected_without_ack() {
        let mut planner = Planner::new();
        let source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let request = workspace_request(
            "ws-noack-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source.clone(),
            target.clone(),
            workspace_send_body(),
        );
        let planned = parse_reply(&planner.evaluate(&request));
        assert_eq!(planned["outcome"], "planned", "{planned}");
        let preconditions = planned["preconditions"].clone();
        let operation = planned["operation"].clone();
        let base = planned["base_revision"].as_u64().expect("base revision");
        let desired_geometry = planned["desired_geometry"].clone();
        // Verify before ack: the session is not yet acknowledged.
        let (verify_source, verify_target) = observation_from_geometry(&desired_geometry);
        let verify = parse_reply(&planner.evaluate(&workspace_request(
            "ws-noack-1",
            "owner-1",
            "gen-1",
            base,
            "",
            verify_source,
            verify_target,
            workspace_verify_body(preconditions, operation),
        )));
        assert_eq!(verify["outcome"], "rejected", "{verify}");
        assert_eq!(verify["kind"], "verify-rejected", "{verify}");
    }

    #[test]
    fn workspace_send_refuses_cross_output() {
        let mut planner = Planner::new();
        let source = vec![workspace_entry("win-1", "ws-1", 0)];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let mut request: serde_json::Value = serde_json::from_str(&workspace_request(
            "ws-cross-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source,
            target,
            workspace_send_body(),
        ))
        .expect("json");
        request["target_domain"]["output"] = serde_json::json!("out-2");
        let reply = parse_reply(&planner.evaluate(&request.to_string()));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "cross-output", "{reply}");
    }

    #[test]
    fn workspace_send_refuses_same_workspace() {
        let mut planner = Planner::new();
        let source = vec![workspace_entry("win-1", "ws-1", 0)];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let mut request: serde_json::Value = serde_json::from_str(&workspace_request(
            "ws-same-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source,
            target,
            workspace_send_body(),
        ))
        .expect("json");
        request["target_domain"]["workspace"] = serde_json::json!("ws-1");
        let reply = parse_reply(&planner.evaluate(&request.to_string()));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "unchanged-workspace", "{reply}");
    }

    #[test]
    fn workspace_send_refuses_absent_focus() {
        let mut planner = Planner::new();
        // No focused window and no source windows: no mover can exist.
        let request = workspace_request(
            "ws-absent-1",
            "owner-1",
            "gen-1",
            0,
            "",
            vec![],
            vec![],
            workspace_send_body(),
        );
        let reply = parse_reply(&planner.evaluate(&request));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "absent-focus", "{reply}");
    }

    #[test]
    fn workspace_send_refuses_focus_not_observed() {
        let mut planner = Planner::new();
        let source = vec![workspace_entry("win-2", "ws-1", 0)];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let request = workspace_request(
            "ws-focus-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source,
            target,
            workspace_send_body(),
        );
        // win-1 is named as focused but only win-2 is observed in the source.
        let reply = parse_reply(&planner.evaluate(&request));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "snapshot-invalid", "{reply}");
        assert_eq!(reply["detail"], "focused-not-observed", "{reply}");
    }

    #[test]
    fn workspace_send_second_request_while_pending_is_rejected() {
        let mut planner = Planner::new();
        let source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let request = workspace_request(
            "ws-pend-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source.clone(),
            target.clone(),
            workspace_send_body(),
        );
        assert_eq!(
            parse_reply(&planner.evaluate(&request))["outcome"],
            "planned"
        );
        let reply = parse_reply(&planner.evaluate(&workspace_request(
            "ws-pend-2",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source,
            target,
            workspace_send_body(),
        )));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "pending-exists", "{reply}");
    }

    #[test]
    fn workspace_send_owner_rebind_during_pending_is_terminal() {
        let mut planner = Planner::new();
        let source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let request = workspace_request(
            "ws-owner-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source.clone(),
            target.clone(),
            workspace_send_body(),
        );
        assert_eq!(
            parse_reply(&planner.evaluate(&request))["outcome"],
            "planned"
        );
        let reply = parse_reply(&planner.evaluate(&workspace_request(
            "ws-owner-2",
            "owner-2",
            "gen-1",
            0,
            "win-1",
            source,
            target,
            workspace_send_body(),
        )));
        assert_eq!(reply["outcome"], "diverged", "{reply}");
        assert_eq!(reply["kind"], "owner-mismatch", "{reply}");
    }

    #[test]
    fn workspace_send_refused_ack_is_terminal() {
        let mut planner = Planner::new();
        let source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let request = workspace_request(
            "ws-refack-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source,
            target,
            workspace_send_body(),
        );
        let planned = parse_reply(&planner.evaluate(&request));
        assert_eq!(planned["outcome"], "planned", "{planned}");
        let base = planned["base_revision"].as_u64().expect("base revision");
        let (ack_source, ack_target) = observation_from_geometry(&planned["desired_geometry"]);
        let refused = parse_reply(&planner.evaluate(&workspace_request(
            "ws-refack-1",
            "owner-1",
            "gen-1",
            base,
            "",
            ack_source,
            ack_target,
            serde_json::json!({"op": "send-to-workspace-ack", "ack_outcome": "partial-application"}),
        )));
        assert_eq!(refused["outcome"], "diverged", "{refused}");
        assert_eq!(refused["kind"], "partial-application", "{refused}");
        // The wedged pending stays terminal: no recovery on the next request.
        let again = parse_reply(&planner.evaluate(&workspace_request(
            "ws-refack-2",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_send_body(),
        )));
        assert_eq!(again["outcome"], "diverged", "{again}");
    }

    #[test]
    fn workspace_send_ack_with_wrong_correlation_is_terminal() {
        let mut planner = Planner::new();
        let source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let request = workspace_request(
            "ws-corr-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source.clone(),
            target.clone(),
            workspace_send_body(),
        );
        assert_eq!(
            parse_reply(&planner.evaluate(&request))["outcome"],
            "planned"
        );
        let reply = parse_reply(&planner.evaluate(&workspace_request(
            "ws-corr-2",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source,
            target,
            workspace_ack_body(),
        )));
        assert_eq!(reply["outcome"], "diverged", "{reply}");
        assert_eq!(reply["kind"], "correlation-mismatch", "{reply}");
    }

    #[test]
    fn workspace_send_verify_mismatch_is_terminal() {
        let mut planner = Planner::new();
        let source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let request = workspace_request(
            "ws-badop-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source.clone(),
            target.clone(),
            workspace_send_body(),
        );
        let planned = parse_reply(&planner.evaluate(&request));
        assert_eq!(planned["outcome"], "planned", "{planned}");
        let preconditions = planned["preconditions"].clone();
        let mut operation = planned["operation"].clone();
        let base = planned["base_revision"].as_u64().expect("base revision");
        let desired_geometry = planned["desired_geometry"].clone();
        let (ack_source, ack_target) = observation_from_geometry(&desired_geometry);
        // Ack the real pending with the complete post-observation.
        let acked = parse_reply(&planner.evaluate(&workspace_request(
            "ws-badop-1",
            "owner-1",
            "gen-1",
            base,
            "",
            ack_source,
            ack_target,
            workspace_ack_body(),
        )));
        assert_eq!(acked["outcome"], "acknowledged", "{acked}");
        if let serde_json::Value::Object(ref mut op) = operation {
            op.insert("target_workspace".to_owned(), serde_json::json!("ws-9"));
        } else {
            panic!("operation must be an object");
        }
        let (verify_source, verify_target) = observation_from_geometry(&desired_geometry);
        let verify = parse_reply(&planner.evaluate(&workspace_request(
            "ws-badop-1",
            "owner-1",
            "gen-1",
            base,
            "",
            verify_source,
            verify_target,
            workspace_verify_body(preconditions, operation),
        )));
        assert_eq!(verify["outcome"], "diverged", "{verify}");
        assert_eq!(verify["kind"], "postcondition-mismatch", "{verify}");
    }

    #[test]
    fn workspace_send_stale_revision_is_terminal() {
        let mut planner = Planner::new();
        let source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let request = workspace_request(
            "ws-stale-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source.clone(),
            target.clone(),
            workspace_send_body(),
        );
        let planned = parse_reply(&planner.evaluate(&request));
        let preconditions = planned["preconditions"].clone();
        let operation = planned["operation"].clone();
        let base = planned["base_revision"].as_u64().expect("base revision");
        let desired_geometry = planned["desired_geometry"].clone();
        let (ack_source, ack_target) = observation_from_geometry(&desired_geometry);
        let acked = parse_reply(&planner.evaluate(&workspace_request(
            "ws-stale-1",
            "owner-1",
            "gen-1",
            base,
            "",
            ack_source.clone(),
            ack_target.clone(),
            workspace_ack_body(),
        )));
        assert_eq!(acked["outcome"], "acknowledged", "{acked}");
        // A verify request carrying a bumped revision is stale.
        let mut stale_request: serde_json::Value = serde_json::from_str(&workspace_request(
            "ws-stale-1",
            "owner-1",
            "gen-1",
            base,
            "",
            ack_source,
            ack_target,
            workspace_verify_body(preconditions, operation),
        ))
        .expect("json");
        stale_request["revision"] = serde_json::json!(7);
        let reply = parse_reply(&planner.evaluate(&stale_request.to_string()));
        assert_eq!(reply["outcome"], "diverged", "{reply}");
        assert_eq!(reply["kind"], "stale-revision", "{reply}");
    }

    #[test]
    fn workspace_send_ack_with_wrong_revision_is_terminal() {
        let mut planner = Planner::new();
        let source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let request = workspace_request(
            "ws-ackrev-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source,
            target,
            workspace_send_body(),
        );
        let planned = parse_reply(&planner.evaluate(&request));
        assert_eq!(planned["outcome"], "planned", "{planned}");
        let base = planned["base_revision"].as_u64().expect("base revision");
        let (ack_source, ack_target) = observation_from_geometry(&planned["desired_geometry"]);
        // Ack carries a bumped base revision: terminal stale-revision.
        let ack = parse_reply(&planner.evaluate(&workspace_request(
            "ws-ackrev-1",
            "owner-1",
            "gen-1",
            base + 1,
            "",
            ack_source,
            ack_target,
            workspace_ack_body(),
        )));
        assert_eq!(ack["outcome"], "diverged", "{ack}");
        assert_eq!(ack["kind"], "stale-revision", "{ack}");
    }

    #[test]
    fn workspace_send_verify_bad_geometry_is_terminal() {
        let mut planner = Planner::new();
        let source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let request = workspace_request(
            "ws-geom-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source,
            target,
            workspace_send_body(),
        );
        let planned = parse_reply(&planner.evaluate(&request));
        assert_eq!(planned["outcome"], "planned", "{planned}");
        let preconditions = planned["preconditions"].clone();
        let operation = planned["operation"].clone();
        let base = planned["base_revision"].as_u64().expect("base revision");
        let desired_geometry = planned["desired_geometry"].clone();
        let (ack_source, ack_target) = observation_from_geometry(&desired_geometry);
        assert_eq!(
            parse_reply(&planner.evaluate(&workspace_request(
                "ws-geom-1",
                "owner-1",
                "gen-1",
                base,
                "",
                ack_source,
                ack_target,
                workspace_ack_body(),
            )))["outcome"],
            "acknowledged"
        );
        // One observed rectangle diverges from the retained desired geometry.
        let (mut verify_source, verify_target) = observation_from_geometry(&desired_geometry);
        verify_source[0]["rect"]["w"] = serde_json::json!(1);
        let verify = parse_reply(&planner.evaluate(&workspace_request(
            "ws-geom-1",
            "owner-1",
            "gen-1",
            base,
            "",
            verify_source,
            verify_target,
            workspace_verify_body(preconditions, operation),
        )));
        assert_eq!(verify["outcome"], "diverged", "{verify}");
        assert_eq!(verify["kind"], "postcondition-mismatch", "{verify}");
        // Wedged pending stays terminal on a subsequent request.
        let again = parse_reply(&planner.evaluate(&workspace_request(
            "ws-geom-2",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_send_body(),
        )));
        assert_eq!(again["outcome"], "diverged", "{again}");
        assert_eq!(again["kind"], "postcondition-mismatch", "{again}");
    }

    #[test]
    fn workspace_send_verify_bad_membership_is_terminal() {
        let mut planner = Planner::new();
        let source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let request = workspace_request(
            "ws-memb-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source,
            target,
            workspace_send_body(),
        );
        let planned = parse_reply(&planner.evaluate(&request));
        assert_eq!(planned["outcome"], "planned", "{planned}");
        let preconditions = planned["preconditions"].clone();
        let operation = planned["operation"].clone();
        let base = planned["base_revision"].as_u64().expect("base revision");
        let desired_geometry = planned["desired_geometry"].clone();
        let (ack_source, ack_target) = observation_from_geometry(&desired_geometry);
        assert_eq!(
            parse_reply(&planner.evaluate(&workspace_request(
                "ws-memb-1",
                "owner-1",
                "gen-1",
                base,
                "",
                ack_source,
                ack_target,
                workspace_ack_body(),
            )))["outcome"],
            "acknowledged"
        );
        // The mover is reported in the source workspace instead of the target.
        let (verify_source, verify_target) = observation_from_geometry(&desired_geometry);
        let mut bad_source = verify_source;
        let mut bad_target = verify_target;
        bad_source.push(workspace_entry("win-1", "ws-1", 600));
        if let Some(index) = bad_target
            .iter()
            .position(|entry| entry["window"] == "win-1")
        {
            bad_target.remove(index);
        }
        let verify = parse_reply(&planner.evaluate(&workspace_request(
            "ws-memb-1",
            "owner-1",
            "gen-1",
            base,
            "",
            bad_source,
            bad_target,
            workspace_verify_body(preconditions, operation),
        )));
        assert_eq!(verify["outcome"], "diverged", "{verify}");
        assert_eq!(verify["kind"], "postcondition-mismatch", "{verify}");
    }

    fn workspace_status_body() -> serde_json::Value {
        serde_json::json!({"op": "send-to-workspace-status"})
    }

    fn workspace_cancel_body() -> serde_json::Value {
        serde_json::json!({"op": "send-to-workspace-cancel", "zero_dispatch": true})
    }

    /// Stage one workspace send and split its planned desired geometry into
    /// the exact source/target post-observation the adapter must report back.
    fn stage_workspace_send(
        planner: &mut Planner,
        correlation: &str,
    ) -> (
        serde_json::Value,
        Vec<serde_json::Value>,
        Vec<serde_json::Value>,
    ) {
        let source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let planned = parse_reply(&planner.evaluate(&workspace_request(
            correlation,
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source,
            target,
            workspace_send_body(),
        )));
        assert_eq!(planned["outcome"], "planned", "{planned}");
        let (post_source, post_target) = observation_from_geometry(&planned["desired_geometry"]);
        (planned, post_source, post_target)
    }

    fn workspace_status_request(
        correlation: &str,
        owner: &str,
        generation: &str,
        revision: u64,
        source: Vec<serde_json::Value>,
        target: Vec<serde_json::Value>,
        command: serde_json::Value,
    ) -> String {
        workspace_request(
            correlation,
            owner,
            generation,
            revision,
            "",
            source,
            target,
            command,
        )
    }

    #[test]
    fn workspace_status_reports_post_unacked_then_post_acked_without_blocking_commit() {
        let mut planner = Planner::new();
        let (planned, post_source, post_target) = stage_workspace_send(&mut planner, "ws-status-1");
        let base = planned["base_revision"].as_u64().expect("base revision");
        // Exact planned post before any ack: unacknowledged, never committed.
        let unacked = parse_reply(&planner.evaluate(&workspace_status_request(
            "ws-status-1",
            "owner-1",
            "gen-1",
            base,
            post_source.clone(),
            post_target.clone(),
            workspace_status_body(),
        )));
        assert_eq!(unacked["outcome"], "status", "{unacked}");
        assert_eq!(unacked["kind"], "post-unacked", "{unacked}");
        assert_eq!(unacked["base_revision"], base, "{unacked}");
        assert!(unacked.get("desired_geometry").is_none(), "{unacked}");
        // Read-only: the normal ack still applies afterwards.
        let acked_reply = parse_reply(&planner.evaluate(&workspace_request(
            "ws-status-1",
            "owner-1",
            "gen-1",
            base,
            "",
            post_source.clone(),
            post_target.clone(),
            workspace_ack_body(),
        )));
        assert_eq!(acked_reply["outcome"], "acknowledged", "{acked_reply}");
        // Exact planned post after the accepted ack: acknowledged.
        let acked = parse_reply(&planner.evaluate(&workspace_status_request(
            "ws-status-1",
            "owner-1",
            "gen-1",
            base,
            post_source.clone(),
            post_target.clone(),
            workspace_status_body(),
        )));
        assert_eq!(acked["outcome"], "status", "{acked}");
        assert_eq!(acked["kind"], "post-acked", "{acked}");
        assert_eq!(acked["base_revision"], base, "{acked}");
        // Read-only again: the normal verify still commits afterwards.
        let committed = parse_reply(&planner.evaluate(&workspace_request(
            "ws-status-1",
            "owner-1",
            "gen-1",
            base,
            "",
            post_source,
            post_target,
            workspace_verify_body(
                planned["preconditions"].clone(),
                planned["operation"].clone(),
            ),
        )));
        assert_eq!(committed["outcome"], "committed", "{committed}");
        assert_eq!(committed["base_revision"], base + 1, "{committed}");
    }

    #[test]
    fn workspace_status_reports_unresolved_without_consuming_pending() {
        let mut planner = Planner::new();
        let (planned, post_source, post_target) = stage_workspace_send(&mut planner, "ws-status-2");
        let base = planned["base_revision"].as_u64().expect("base revision");
        // One observed rectangle diverges from the retained desired geometry.
        let (mut bad_source, bad_target) = observation_from_geometry(&planned["desired_geometry"]);
        bad_source[0]["rect"]["w"] = serde_json::json!(1);
        let unresolved = parse_reply(&planner.evaluate(&workspace_status_request(
            "ws-status-2",
            "owner-1",
            "gen-1",
            base,
            bad_source,
            bad_target,
            workspace_status_body(),
        )));
        assert_eq!(unresolved["outcome"], "status", "{unresolved}");
        assert_eq!(unresolved["kind"], "unresolved", "{unresolved}");
        assert_eq!(unresolved["base_revision"], base, "{unresolved}");
        // The pending survives the probe: exact ack plus verify still commit.
        assert_eq!(
            parse_reply(&planner.evaluate(&workspace_request(
                "ws-status-2",
                "owner-1",
                "gen-1",
                base,
                "",
                post_source.clone(),
                post_target.clone(),
                workspace_ack_body(),
            )))["outcome"],
            "acknowledged"
        );
        let committed = parse_reply(&planner.evaluate(&workspace_request(
            "ws-status-2",
            "owner-1",
            "gen-1",
            base,
            "",
            post_source,
            post_target,
            workspace_verify_body(
                planned["preconditions"].clone(),
                planned["operation"].clone(),
            ),
        )));
        assert_eq!(committed["outcome"], "committed", "{committed}");
    }

    #[test]
    fn workspace_status_reports_stale_without_recording_divergence() {
        let mut planner = Planner::new();
        let (planned, post_source, post_target) = stage_workspace_send(&mut planner, "ws-status-3");
        let base = planned["base_revision"].as_u64().expect("base revision");
        // Wrong correlation, revision, owner, and generation each report stale
        // against the exact post-observation.
        for (correlation, owner, generation, revision) in [
            ("ws-status-other", "owner-1", "gen-1", base),
            ("ws-status-3", "owner-1", "gen-1", base + 1),
            ("ws-status-3", "owner-9", "gen-1", base),
            ("ws-status-3", "owner-1", "gen-9", base),
        ] {
            let stale = parse_reply(&planner.evaluate(&workspace_status_request(
                correlation,
                owner,
                generation,
                revision,
                post_source.clone(),
                post_target.clone(),
                workspace_status_body(),
            )));
            assert_eq!(stale["outcome"], "status", "{stale}");
            assert_eq!(stale["kind"], "stale", "{stale}");
            assert_eq!(stale["base_revision"], base, "{stale}");
        }
        // Stale probes record nothing: the exact query still sees the live
        // unacknowledged post, and the lifecycle still commits.
        let live = parse_reply(&planner.evaluate(&workspace_status_request(
            "ws-status-3",
            "owner-1",
            "gen-1",
            base,
            post_source.clone(),
            post_target.clone(),
            workspace_status_body(),
        )));
        assert_eq!(live["kind"], "post-unacked", "{live}");
        assert_eq!(
            parse_reply(&planner.evaluate(&workspace_request(
                "ws-status-3",
                "owner-1",
                "gen-1",
                base,
                "",
                post_source.clone(),
                post_target.clone(),
                workspace_ack_body(),
            )))["outcome"],
            "acknowledged"
        );
        assert_eq!(
            parse_reply(&planner.evaluate(&workspace_request(
                "ws-status-3",
                "owner-1",
                "gen-1",
                base,
                "",
                post_source,
                post_target,
                workspace_verify_body(
                    planned["preconditions"].clone(),
                    planned["operation"].clone(),
                ),
            )))["outcome"],
            "committed"
        );
    }

    #[test]
    fn workspace_status_reports_diverged_after_terminal_ack() {
        let mut planner = Planner::new();
        let (planned, post_source, post_target) = stage_workspace_send(&mut planner, "ws-status-4");
        let base = planned["base_revision"].as_u64().expect("base revision");
        let refused = parse_reply(&planner.evaluate(&workspace_request(
            "ws-status-4",
            "owner-1",
            "gen-1",
            base,
            "",
            post_source.clone(),
            post_target.clone(),
            serde_json::json!({"op": "send-to-workspace-ack", "ack_outcome": "partial-application"}),
        )));
        assert_eq!(refused["outcome"], "diverged", "{refused}");
        let diverged = parse_reply(&planner.evaluate(&workspace_status_request(
            "ws-status-4",
            "owner-1",
            "gen-1",
            base,
            post_source,
            post_target,
            workspace_status_body(),
        )));
        assert_eq!(diverged["outcome"], "diverged", "{diverged}");
        assert_eq!(diverged["kind"], "partial-application", "{diverged}");
    }

    #[test]
    fn workspace_status_no_pending_unknown_carries_no_commit_implication() {
        let planner = &mut Planner::new();
        // A valid scope with no retained transaction: unknown, with no base
        // revision and no geometry that could be mistaken for a commit.
        let reply = parse_reply(&planner.evaluate(&workspace_status_request(
            "ws-status-5",
            "owner-1",
            "gen-1",
            0,
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_status_body(),
        )));
        assert_eq!(reply["outcome"], "status", "{reply}");
        assert_eq!(reply["kind"], "no-pending-unknown", "{reply}");
        assert!(reply.get("base_revision").is_none(), "{reply}");
        assert!(reply.get("desired_geometry").is_none(), "{reply}");
        assert!(reply.get("kind").and_then(|kind| kind.as_str()) != Some("send-to-workspace"));
        // Read-only against an empty planner: no binding sync, no sessions.
        assert!(planner.owner().is_none());
        assert_eq!(planner.retained_domains(), 0);
    }

    #[test]
    fn workspace_status_rejects_malformed_and_scope_violations() {
        let mut planner = Planner::new();
        let source = vec![workspace_entry("win-1", "ws-1", 0)];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        // Unknown command fields fail closed like any other route.
        let unknown = parse_reply(&planner.evaluate(&workspace_status_request(
            "ws-status-6",
            "owner-1",
            "gen-1",
            0,
            source.clone(),
            target.clone(),
            serde_json::json!({"op": "send-to-workspace-status", "extra": 1}),
        )));
        assert_eq!(unknown["outcome"], "rejected", "{unknown}");
        assert_eq!(unknown["kind"], "unknown-field", "{unknown}");
        // Missing target domain fails closed with the request scope kind.
        let mut missing: serde_json::Value = serde_json::from_str(&workspace_status_request(
            "ws-status-6",
            "owner-1",
            "gen-1",
            0,
            source.clone(),
            target.clone(),
            workspace_status_body(),
        ))
        .expect("json");
        missing
            .as_object_mut()
            .expect("object")
            .remove("target_domain");
        let missing_reply = parse_reply(&planner.evaluate(&missing.to_string()));
        assert_eq!(missing_reply["outcome"], "rejected", "{missing_reply}");
        assert_eq!(
            missing_reply["kind"], "workspace-target-invalid",
            "{missing_reply}"
        );
        // Cross-output target fails closed with the request scope kind.
        let mut cross: serde_json::Value = serde_json::from_str(&workspace_status_request(
            "ws-status-6",
            "owner-1",
            "gen-1",
            0,
            source.clone(),
            target.clone(),
            workspace_status_body(),
        ))
        .expect("json");
        cross["target_domain"]["output"] = serde_json::json!("out-9");
        let cross_reply = parse_reply(&planner.evaluate(&cross.to_string()));
        assert_eq!(cross_reply["outcome"], "rejected", "{cross_reply}");
        assert_eq!(cross_reply["kind"], "cross-output", "{cross_reply}");
        // Same-workspace target fails closed with the request scope kind.
        let mut same: serde_json::Value = serde_json::from_str(&workspace_status_request(
            "ws-status-6",
            "owner-1",
            "gen-1",
            0,
            source,
            target,
            workspace_status_body(),
        ))
        .expect("json");
        same["target_domain"]["workspace"] = serde_json::json!("ws-1");
        let same_reply = parse_reply(&planner.evaluate(&same.to_string()));
        assert_eq!(same_reply["outcome"], "rejected", "{same_reply}");
        assert_eq!(same_reply["kind"], "unchanged-workspace", "{same_reply}");
    }

    /// Cancel request carrying the exact dispatch-time pre-observation:
    /// revision 0 is the original request revision (never the seeded base),
    /// focus names the dispatch-time focused window, and source/target carry
    /// the dispatch-time window sets.
    #[allow(clippy::too_many_arguments)]
    fn workspace_cancel_request(
        correlation: &str,
        owner: &str,
        generation: &str,
        revision: u64,
        focused: &str,
        source: Vec<serde_json::Value>,
        target: Vec<serde_json::Value>,
        command: serde_json::Value,
    ) -> String {
        workspace_request(
            correlation,
            owner,
            generation,
            revision,
            focused,
            source,
            target,
            command,
        )
    }

    #[test]
    fn workspace_cancel_withdraws_unacked_pre_and_leaves_new_correlation_usable() {
        let mut planner = Planner::new();
        let source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let planned = parse_reply(&planner.evaluate(&workspace_request(
            "ws-cancel-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source.clone(),
            target.clone(),
            workspace_send_body(),
        )));
        assert_eq!(planned["outcome"], "planned", "{planned}");
        let base = planned["base_revision"].as_u64().expect("base revision");
        // Exact dispatch-time pre-image with the original request revision:
        // withdrawn, never committed.
        let cancelled = parse_reply(&planner.evaluate(&workspace_cancel_request(
            "ws-cancel-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source,
            target,
            workspace_cancel_body(),
        )));
        assert_eq!(cancelled["outcome"], "cancelled", "{cancelled}");
        assert_eq!(cancelled["kind"], "send-to-workspace", "{cancelled}");
        assert_eq!(cancelled["base_revision"], base, "{cancelled}");
        assert!(cancelled.get("desired_geometry").is_none(), "{cancelled}");
        // The slot is released without a wedge: status cannot imply a commit,
        // a duplicate cancel finds no pending, and a fresh correlation plans.
        // Nothing committed, so no canonical domain was retained either.
        let unknown = parse_reply(&planner.evaluate(&workspace_status_request(
            "ws-cancel-1",
            "owner-1",
            "gen-1",
            0,
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_status_body(),
        )));
        assert_eq!(unknown["kind"], "no-pending-unknown", "{unknown}");
        let duplicate = parse_reply(&planner.evaluate(&workspace_cancel_request(
            "ws-cancel-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_cancel_body(),
        )));
        assert_eq!(duplicate["outcome"], "rejected", "{duplicate}");
        assert_eq!(duplicate["kind"], "no-pending", "{duplicate}");
        assert_eq!(planner.retained_domains(), 0);
        let second = parse_reply(&planner.evaluate(&workspace_request(
            "ws-cancel-2",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_send_body(),
        )));
        assert_eq!(second["outcome"], "planned", "{second}");
    }

    #[test]
    fn workspace_cancel_refuses_acked_plan_without_mutation() {
        let mut planner = Planner::new();
        let (planned, post_source, post_target) = stage_workspace_send(&mut planner, "ws-cancel-3");
        let base = planned["base_revision"].as_u64().expect("base revision");
        assert_eq!(
            parse_reply(&planner.evaluate(&workspace_request(
                "ws-cancel-3",
                "owner-1",
                "gen-1",
                base,
                "",
                post_source.clone(),
                post_target.clone(),
                workspace_ack_body(),
            )))["outcome"],
            "acknowledged"
        );
        // The plan is acked: cancellation refuses even with the exact
        // pre-image, since the ack may already have committed elsewhere.
        let refused = parse_reply(&planner.evaluate(&workspace_cancel_request(
            "ws-cancel-3",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![
                workspace_entry("win-1", "ws-1", 0),
                workspace_entry("win-2", "ws-1", 100),
            ],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_cancel_body(),
        )));
        assert_eq!(refused["outcome"], "rejected", "{refused}");
        assert_eq!(refused["kind"], "cancel-refused", "{refused}");
        // Refusal mutated nothing: the ack stands and verify still commits.
        let status = parse_reply(&planner.evaluate(&workspace_status_request(
            "ws-cancel-3",
            "owner-1",
            "gen-1",
            base,
            post_source.clone(),
            post_target.clone(),
            workspace_status_body(),
        )));
        assert_eq!(status["kind"], "post-acked", "{status}");
        let committed = parse_reply(&planner.evaluate(&workspace_request(
            "ws-cancel-3",
            "owner-1",
            "gen-1",
            base,
            "",
            post_source,
            post_target,
            workspace_verify_body(
                planned["preconditions"].clone(),
                planned["operation"].clone(),
            ),
        )));
        assert_eq!(committed["outcome"], "committed", "{committed}");
    }

    #[test]
    fn workspace_cancel_refuses_mismatch_without_mutation() {
        let mut planner = Planner::new();
        let (planned, post_source, post_target) = stage_workspace_send(&mut planner, "ws-cancel-4");
        let base = planned["base_revision"].as_u64().expect("base revision");
        // One carried rectangle differs from the dispatch-time pre-image:
        // mismatch refuses while the pending stays live and committable.
        let mut bad_source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        bad_source[0]["rect"]["w"] = serde_json::json!(1);
        let mismatch = parse_reply(&planner.evaluate(&workspace_cancel_request(
            "ws-cancel-4",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            bad_source,
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_cancel_body(),
        )));
        assert_eq!(mismatch["outcome"], "rejected", "{mismatch}");
        assert_eq!(mismatch["kind"], "cancel-mismatch", "{mismatch}");
        // A started write surfaces the same way: the post-observation is not
        // the pre-image, so cancellation refuses and the lifecycle proceeds.
        let started = parse_reply(&planner.evaluate(&workspace_cancel_request(
            "ws-cancel-4",
            "owner-1",
            "gen-1",
            0,
            "",
            post_source.clone(),
            post_target.clone(),
            workspace_cancel_body(),
        )));
        assert_eq!(started["outcome"], "rejected", "{started}");
        assert_eq!(started["kind"], "cancel-mismatch", "{started}");
        assert_eq!(
            parse_reply(&planner.evaluate(&workspace_request(
                "ws-cancel-4",
                "owner-1",
                "gen-1",
                base,
                "",
                post_source.clone(),
                post_target.clone(),
                workspace_ack_body(),
            )))["outcome"],
            "acknowledged"
        );
        assert_eq!(
            parse_reply(&planner.evaluate(&workspace_request(
                "ws-cancel-4",
                "owner-1",
                "gen-1",
                base,
                "",
                post_source,
                post_target,
                workspace_verify_body(
                    planned["preconditions"].clone(),
                    planned["operation"].clone(),
                ),
            )))["outcome"],
            "committed"
        );
    }

    #[test]
    fn workspace_cancel_refuses_stale_diverged_absent_malformed() {
        let mut planner = Planner::new();
        let (planned, post_source, post_target) = stage_workspace_send(&mut planner, "ws-cancel-5");
        let base = planned["base_revision"].as_u64().expect("base revision");
        let pre_source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let pre_target = vec![workspace_entry("win-t1", "ws-2", 0)];
        // Wrong correlation, the seeded base instead of the original request
        // revision, wrong owner, and wrong generation each report stale
        // without recording anything.
        for (correlation, owner, generation, revision) in [
            ("ws-cancel-other", "owner-1", "gen-1", 0),
            ("ws-cancel-5", "owner-1", "gen-1", base),
            ("ws-cancel-5", "owner-9", "gen-1", 0),
            ("ws-cancel-5", "owner-1", "gen-9", 0),
        ] {
            let stale = parse_reply(&planner.evaluate(&workspace_cancel_request(
                correlation,
                owner,
                generation,
                revision,
                "win-1",
                pre_source.clone(),
                pre_target.clone(),
                workspace_cancel_body(),
            )));
            assert_eq!(stale["outcome"], "rejected", "{stale}");
            assert_eq!(stale["kind"], "stale", "{stale}");
        }
        // A false attestation (a dispatch did occur) refuses outright.
        let attested = parse_reply(&planner.evaluate(&workspace_cancel_request(
            "ws-cancel-5",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            pre_source.clone(),
            pre_target.clone(),
            serde_json::json!({"op": "send-to-workspace-cancel", "zero_dispatch": false}),
        )));
        assert_eq!(attested["outcome"], "rejected", "{attested}");
        assert_eq!(attested["kind"], "cancel-refused", "{attested}");
        // Stale and refused probes recorded nothing: exact cancellation still
        // succeeds and the lifecycle is fully released.
        let cancelled = parse_reply(&planner.evaluate(&workspace_cancel_request(
            "ws-cancel-5",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            pre_source,
            pre_target,
            workspace_cancel_body(),
        )));
        assert_eq!(cancelled["outcome"], "cancelled", "{cancelled}");
        // A terminally diverged transaction reports divergence, never cancel.
        let (diverged_plan, div_source, div_target) =
            stage_workspace_send(&mut planner, "ws-cancel-6");
        let div_base = diverged_plan["base_revision"].as_u64().expect("base");
        assert_eq!(
            parse_reply(&planner.evaluate(&workspace_request(
                "ws-cancel-6",
                "owner-1",
                "gen-1",
                div_base,
                "",
                div_source,
                div_target,
                serde_json::json!({"op": "send-to-workspace-ack", "ack_outcome": "partial-application"}),
            )))["outcome"],
            "diverged"
        );
        let diverged = parse_reply(&planner.evaluate(&workspace_cancel_request(
            "ws-cancel-6",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![
                workspace_entry("win-1", "ws-1", 0),
                workspace_entry("win-2", "ws-1", 100),
            ],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_cancel_body(),
        )));
        assert_eq!(diverged["outcome"], "diverged", "{diverged}");
        assert_eq!(diverged["kind"], "partial-application", "{diverged}");
        // Absent pending and malformed shapes fail closed with no mutation.
        let absent = parse_reply(&Planner::new().evaluate(&workspace_cancel_request(
            "ws-cancel-7",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_cancel_body(),
        )));
        assert_eq!(absent["outcome"], "rejected", "{absent}");
        assert_eq!(absent["kind"], "no-pending", "{absent}");
        let unknown = parse_reply(&planner.evaluate(&workspace_cancel_request(
            "ws-cancel-6",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            serde_json::json!({"op": "send-to-workspace-cancel", "zero_dispatch": true, "extra": 1}),
        )));
        assert_eq!(unknown["outcome"], "rejected", "{unknown}");
        assert_eq!(unknown["kind"], "unknown-field", "{unknown}");
        let _ = (post_source, post_target);
    }

    #[test]
    fn plan_summary_ingress_is_bounded_and_redacted() {
        let request = workspace_request(
            "ws-sum-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_send_body(),
        );
        let line = summarize_plan_ingress(&request);
        assert_eq!(
            line,
            "plasma-auto-tiler:plan-summary direction=ingress op=send-to-workspace correlation=ws-sum-1 revision=0"
        );
        // Malformed input degrades to placeholders without echoing anything
        // caller-controlled: no window ids, rects, owner, or payload bytes.
        let garbage = summarize_plan_ingress("{not-json!! owner-1 win-1");
        assert_eq!(
            garbage,
            "plasma-auto-tiler:plan-summary direction=ingress op=unknown correlation=- revision=-"
        );
        // An invalid correlation shape never echoes, even when well-formed.
        let bad_corr = summarize_plan_ingress(
            r#"{"v":1,"correlation_id":"evil correlation!!","owner":"owner-1","generation":"gen-1","revision":0,"command":{"op":"remove"}}"#,
        );
        assert!(bad_corr.contains("correlation=-"), "{bad_corr}");
        assert!(!bad_corr.contains("evil"), "{bad_corr}");
        // Out-of-bounds revisions never echo.
        let bad_rev = summarize_plan_ingress(
            r#"{"v":1,"correlation_id":"ws-sum-1","revision":99999999,"command":{"op":"remove"}}"#,
        );
        assert!(bad_rev.contains("revision=-"), "{bad_rev}");
        assert!(!bad_rev.contains("99999999"), "{bad_rev}");
    }

    #[test]
    fn plan_summary_egress_reports_status_and_cancel_truthfully() {
        // Status result codes pass through exactly, including the
        // never-commit `no-pending-unknown`.
        let status_request = workspace_request(
            "ws-sum-2",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_status_body(),
        );
        let status_reply =
            r#"{"v":1,"correlation_id":"ws-sum-2","outcome":"status","kind":"no-pending-unknown"}"#;
        assert_eq!(
            summarize_plan_egress(&status_request, status_reply),
            "plasma-auto-tiler:plan-summary direction=egress op=send-to-workspace-status correlation=ws-sum-2 outcome=status kind=no-pending-unknown base_revision=- detail=-"
        );
        // Cancellation success carries the route kind and the un-advanced
        // base, never commit language.
        let cancel_request = workspace_cancel_request(
            "ws-sum-3",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_cancel_body(),
        );
        let cancel_reply = r#"{"v":1,"correlation_id":"ws-sum-3","outcome":"cancelled","kind":"send-to-workspace","base_revision":3}"#;
        let cancelled = summarize_plan_egress(&cancel_request, cancel_reply);
        assert!(cancelled.contains("outcome=cancelled"), "{cancelled}");
        assert!(cancelled.contains("kind=send-to-workspace"), "{cancelled}");
        assert!(cancelled.contains("base_revision=3"), "{cancelled}");
        assert!(!cancelled.contains("committed"), "{cancelled}");
        // A garbage reply degrades without echoing it.
        let garbage = summarize_plan_egress(&cancel_request, "{not-json!!");
        assert!(garbage.contains("outcome=unknown"), "{garbage}");
        assert!(garbage.contains("correlation=-"), "{garbage}");
        assert!(!garbage.contains("not-json"), "{garbage}");
        // Snapshot-invalid detail tokens pass through bounded.
        let invalid = summarize_plan_egress(
            &cancel_request,
            r#"{"v":1,"correlation_id":"ws-sum-3","outcome":"rejected","kind":"snapshot-invalid","detail":"domain-invalid"}"#,
        );
        assert!(invalid.contains("detail=domain-invalid"), "{invalid}");
    }

    #[test]
    fn plan_summary_shape_counts_without_payload_bytes() {
        let request = workspace_request(
            "ws-sum-4",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![
                workspace_entry("win-1", "ws-1", 0),
                workspace_entry("win-2", "ws-1", 100),
            ],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_send_body(),
        );
        let shape = summarize_plan_shape(&request);
        assert!(shape.contains("windows=2"), "{shape}");
        assert!(shape.contains("target_windows=1"), "{shape}");
        assert!(!shape.contains("win-1"), "{shape}");
        assert!(!shape.contains("owner-1"), "{shape}");
        assert!(!shape.contains("\"x\""), "{shape}");
        // Summaries are pure: running them changes no planner state and the
        // lifecycle they describe still commits exactly once afterwards.
        let mut planner = Planner::new();
        let (planned, post_source, post_target) = stage_workspace_send(&mut planner, "ws-sum-5");
        let base = planned["base_revision"].as_u64().expect("base");
        let pre = workspace_request(
            "ws-sum-5",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![
                workspace_entry("win-1", "ws-1", 0),
                workspace_entry("win-2", "ws-1", 100),
            ],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_send_body(),
        );
        let _ = summarize_plan_ingress(&pre);
        let _ = summarize_plan_shape(&pre);
        let _ = summarize_plan_egress(&pre, &planned.to_string());
        assert_eq!(
            parse_reply(&planner.evaluate(&workspace_request(
                "ws-sum-5",
                "owner-1",
                "gen-1",
                base,
                "",
                post_source.clone(),
                post_target.clone(),
                workspace_ack_body(),
            )))["outcome"],
            "acknowledged"
        );
        assert_eq!(
            parse_reply(&planner.evaluate(&workspace_request(
                "ws-sum-5",
                "owner-1",
                "gen-1",
                base,
                "",
                post_source,
                post_target,
                workspace_verify_body(
                    planned["preconditions"].clone(),
                    planned["operation"].clone(),
                ),
            )))["outcome"],
            "committed"
        );
    }

    fn active_group_request(
        correlation: &str,
        owner: &str,
        generation: &str,
        revision: u64,
        focused: &str,
        windows: &[(&str, i32, i32, i32, i32)],
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
            "revision": revision,
            "fingerprint": 7,
            "domain": {
                "output": "out-1",
                "workspace": "ws-1",
                "bounds": {"x": 0, "y": 0, "w": 1200, "h": 800},
                "gap": 0,
                "outer_gap": 0,
            },
            "focused_window": focused,
            "windows": entries,
            "command": {"op": "active-group"},
        })
        .to_string()
    }

    fn seed_active_group_planner() -> Planner {
        let mut planner = Planner::new();
        for (correlation, focused, windows, command) in [
            (
                "ag-seed-1",
                "win-1",
                vec![("win-1", 0, 0, 100, 80)],
                admit_body("win-1"),
            ),
            (
                "ag-seed-2",
                "win-1",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                admit_body("win-2"),
            ),
        ] {
            let request =
                retained_request(correlation, "owner-1", "gen-1", focused, &windows, command);
            let reply = parse_reply(&planner.evaluate(&request));
            assert_eq!(reply["outcome"], "planned", "{reply}");
        }
        assert_eq!(planner.retained_domains(), 1);
        planner
    }

    #[test]
    fn retained_active_group_returns_parent_members_and_engine_projection() {
        let mut planner = seed_active_group_planner();
        // Retained focus after the second admit is win-2 at base revision 2.
        let baseline = parse_reply(&planner.evaluate(&retained_request(
            "ag-rec-1",
            "owner-1",
            "gen-1",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(baseline["outcome"], "planned", "{baseline}");
        let expected = geometry_by_window(&baseline);
        // Carried client rectangles drift within bounds; the highlight must
        // still report the retained engine allocation, never native topology.
        let drifted = active_group_request(
            "ag-1",
            "owner-1",
            "gen-1",
            2,
            "win-2",
            &[("win-1", 0, 0, 10, 10), ("win-2", 1100, 700, 50, 50)],
        );
        let reply_text = planner.evaluate(&drifted);
        assert!(reply_text.len() <= PLAN_MAX_REPLY_BYTES, "{reply_text}");
        let reply = parse_reply(&reply_text);
        assert_eq!(reply["outcome"], "active-group", "{reply}");
        assert_eq!(reply["kind"], "active-group", "{reply}");
        assert_eq!(reply["correlation_id"], "ag-1", "{reply}");
        assert_eq!(reply["base_revision"], 2, "{reply}");
        let detail = &reply["detail"];
        assert_eq!(detail["kind"], "active-group", "{reply}");
        assert_eq!(detail["owner"], "owner-1", "{reply}");
        assert_eq!(detail["generation"], "gen-1", "{reply}");
        assert_eq!(detail["domain_output"], "out-1", "{reply}");
        assert_eq!(detail["domain_workspace"], "ws-1", "{reply}");
        assert_eq!(detail["focused_window"], "win-2", "{reply}");
        let group = detail["group"].as_str().expect("group id");
        assert!(!group.is_empty(), "{reply}");
        let members = detail["members"].as_array().expect("members");
        assert_eq!(members.len(), 2, "{reply}");
        let mut windows: Vec<&str> = members
            .iter()
            .map(|m| m["window"].as_str().expect("member window"))
            .collect();
        windows.sort();
        assert_eq!(windows, vec!["win-1", "win-2"], "{reply}");
        for member in members {
            let window = member["window"].as_str().expect("window");
            let rect = (
                member["rect"]["x"].as_i64().unwrap() as i32,
                member["rect"]["y"].as_i64().unwrap() as i32,
                member["rect"]["w"].as_i64().unwrap() as i32,
                member["rect"]["h"].as_i64().unwrap() as i32,
            );
            assert_eq!(rect, expected[window], "{reply} vs {baseline}");
            assert!(
                member["leaf"].as_str().is_some_and(|s| !s.is_empty()),
                "{reply}"
            );
        }
        let bounds = &detail["bounds"];
        let (bx, by, bw, bh) = (
            bounds["x"].as_i64().unwrap() as i32,
            bounds["y"].as_i64().unwrap() as i32,
            bounds["w"].as_i64().unwrap() as i32,
            bounds["h"].as_i64().unwrap() as i32,
        );
        assert!(bw > 0 && bh > 0, "{reply}");
        for member in members {
            let rect = &member["rect"];
            let (x, y, w, h) = (
                rect["x"].as_i64().unwrap() as i32,
                rect["y"].as_i64().unwrap() as i32,
                rect["w"].as_i64().unwrap() as i32,
                rect["h"].as_i64().unwrap() as i32,
            );
            assert!(x >= bx && y >= by, "{reply}");
            assert!(x + w <= bx + bw && y + h <= by + bh, "{reply}");
        }
        let geometry = reply["desired_geometry"].as_array().expect("geometry");
        assert_eq!(geometry.len(), 2, "{reply}");
        assert!(reply["desired_focus"]["leaf"].as_str().is_some(), "{reply}");
        assert_eq!(
            reply["desired_focus"]["leaf"], detail["focused_leaf"],
            "{reply}"
        );
    }

    #[test]
    fn retained_active_group_clears_for_non_group_focus() {
        // Single tiled window is a root leaf: no parent group exists.
        let mut planner = Planner::new();
        let seed = retained_request(
            "ag-solo-seed-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            admit_body("win-1"),
        );
        assert_eq!(parse_reply(&planner.evaluate(&seed))["outcome"], "planned");
        let solo = active_group_request(
            "ag-solo-1",
            "owner-1",
            "gen-1",
            1,
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
        );
        let cleared = parse_reply(&planner.evaluate(&solo));
        assert_eq!(cleared["outcome"], "no-group", "{cleared}");
        assert_eq!(cleared["kind"], "no-group", "{cleared}");
        assert_eq!(cleared["correlation_id"], "ag-solo-1", "{cleared}");
        assert_eq!(cleared["base_revision"], 1, "{cleared}");
        assert_eq!(cleared["detail"]["reason"], "no-parent-group", "{cleared}");
        assert_eq!(cleared["detail"]["generation"], "gen-1", "{cleared}");
        assert!(cleared.get("desired_geometry").is_none(), "{cleared}");
        // Unknown domain has no retained tree: clear without leaking state.
        let unknown = serde_json::json!({
            "v": 1,
            "correlation_id": "ag-unknown-1",
            "owner": "owner-1",
            "generation": "gen-1",
            "revision": 0,
            "fingerprint": 7,
            "domain": {
                "output": "out-9",
                "workspace": "ws-9",
                "bounds": {"x": 0, "y": 0, "w": 1200, "h": 800},
                "gap": 0,
                "outer_gap": 0,
            },
            "focused_window": "win-1",
            "windows": [{"window": "win-1", "output": "out-9", "workspace": "ws-9",
                "rect": {"x": 0, "y": 0, "w": 100, "h": 80}}],
            "command": {"op": "active-group"},
        })
        .to_string();
        let missing = parse_reply(&planner.evaluate(&unknown));
        assert_eq!(missing["outcome"], "no-group", "{missing}");
        assert_eq!(missing["detail"]["reason"], "no-session", "{missing}");
        assert_eq!(missing["correlation_id"], "ag-unknown-1", "{missing}");
        // Op mismatch inside the handler binds the exact snapshot detail.
        let mut ctx = validate_request(&active_group_request(
            "ag-op-1",
            "owner-1",
            "gen-1",
            1,
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
        ))
        .expect("base valid");
        ctx.request.command["op"] = serde_json::json!("bogus-op");
        let text = planner.evaluate_active_group_retained(&ctx);
        let op_reply = parse_reply(&text);
        assert_eq!(op_reply["outcome"], "rejected", "{op_reply}");
        assert_eq!(op_reply["kind"], "snapshot-invalid", "{op_reply}");
        assert_eq!(op_reply["detail"], "active-group-op-invalid", "{op_reply}");
        assert_eq!(op_reply["correlation_id"], "ag-op-1", "{op_reply}");
        assert!(text.len() <= PLAN_MAX_REPLY_BYTES, "{op_reply}");
    }

    #[test]
    fn retained_active_group_resolves_current_snapshot_without_revision_gate() {
        let mut planner = seed_active_group_planner();
        // Initial/lagging carried revision resolves current retained state
        // instead of livelocking on stale-revision: revision 0 still yields
        // the current base 2 snapshot with safe returned identity.
        let initial = active_group_request(
            "ag-initial-1",
            "owner-1",
            "gen-1",
            0,
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
        );
        let initial_reply = parse_reply(&planner.evaluate(&initial));
        assert_eq!(initial_reply["outcome"], "active-group", "{initial_reply}");
        assert_eq!(
            initial_reply["correlation_id"], "ag-initial-1",
            "{initial_reply}"
        );
        assert_eq!(initial_reply["base_revision"], 2, "{initial_reply}");
        assert_eq!(
            initial_reply["detail"]["owner"], "owner-1",
            "{initial_reply}"
        );
        assert_eq!(
            initial_reply["detail"]["generation"], "gen-1",
            "{initial_reply}"
        );
        assert_eq!(
            initial_reply["detail"]["focused_window"], "win-2",
            "{initial_reply}"
        );
        // Fresh revision with the same observation resolves identically and
        // echoes the exact identity binding.
        let fresh = active_group_request(
            "ag-fresh-1",
            "owner-1",
            "gen-1",
            2,
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
        );
        let fresh_reply = parse_reply(&planner.evaluate(&fresh));
        assert_eq!(fresh_reply["outcome"], "active-group", "{fresh_reply}");
        assert_eq!(fresh_reply["correlation_id"], "ag-fresh-1", "{fresh_reply}");
        assert_eq!(fresh_reply["base_revision"], 2, "{fresh_reply}");
        assert_eq!(
            fresh_reply["detail"]["generation"], "gen-1",
            "{fresh_reply}"
        );
        // Carried-window divergence is safe: drifted rects plus an extra
        // carried-only window still resolve from retained topology with the
        // retained focus binding, never from carried geometry.
        let diverged = active_group_request(
            "ag-diverged-1",
            "owner-1",
            "gen-1",
            0,
            "win-2",
            &[
                ("win-1", 5, 5, 10, 10),
                ("win-2", 1100, 700, 20, 20),
                ("win-9", 0, 0, 50, 50),
            ],
        );
        let diverged_reply = parse_reply(&planner.evaluate(&diverged));
        assert_eq!(
            diverged_reply["outcome"], "active-group",
            "{diverged_reply}"
        );
        assert_eq!(diverged_reply["base_revision"], 2, "{diverged_reply}");
        assert_eq!(
            diverged_reply["detail"]["focused_window"], "win-2",
            "{diverged_reply}"
        );
        // Generation change (adapter restart) discards retained state instead
        // of leaking the previous generation's group.
        let rotated = active_group_request(
            "ag-rot-1",
            "owner-1",
            "gen-2",
            2,
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
        );
        let rotated_reply = parse_reply(&planner.evaluate(&rotated));
        assert_eq!(rotated_reply["outcome"], "no-group", "{rotated_reply}");
        assert_eq!(
            rotated_reply["detail"]["reason"], "no-session",
            "{rotated_reply}"
        );
        assert_eq!(
            rotated_reply["detail"]["generation"], "gen-2",
            "{rotated_reply}"
        );
    }

    #[test]
    fn retained_active_group_aligns_focus_and_resolves_nested_after_move() {
        // Real admitted/planned lifecycle producing H[win-1, V[win-2, win-3]]:
        // two landscape admits build root H, the third admit nests V under
        // the tall focused leaf. No hand-seeded sessions.
        let mut planner = Planner::new();
        for (correlation, focused, windows, command) in [
            (
                "ag-nested-1",
                "win-1",
                vec![("win-1", 0, 0, 100, 80)],
                admit_body("win-1"),
            ),
            (
                "ag-nested-2",
                "win-1",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                admit_body("win-2"),
            ),
            (
                "ag-nested-3",
                "win-2",
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
        // Retained focus is now win-3. An ordinary activation observes win-2
        // (a known tiled window in the same domain). The query must align
        // retained focus from this valid snapshot and resolve the immediate
        // parent inner V[win-2, win-3], not fail-closed `focus-unmapped`.
        let aligned = active_group_request(
            "ag-nested-4",
            "owner-1",
            "gen-1",
            0,
            "win-2",
            &[
                ("win-1", 0, 0, 100, 80),
                ("win-2", 200, 0, 100, 80),
                ("win-3", 400, 0, 100, 80),
            ],
        );
        let aligned_reply = parse_reply(&planner.evaluate(&aligned));
        assert_eq!(aligned_reply["outcome"], "active-group", "{aligned_reply}");
        assert_eq!(aligned_reply["base_revision"], 3, "{aligned_reply}");
        assert_eq!(
            aligned_reply["detail"]["focused_window"], "win-2",
            "{aligned_reply}"
        );
        let mut members: Vec<String> = aligned_reply["detail"]["members"]
            .as_array()
            .expect("members")
            .iter()
            .map(|m| m["window"].as_str().expect("window").to_owned())
            .collect();
        members.sort();
        assert_eq!(
            members,
            vec!["win-2".to_owned(), "win-3".to_owned()],
            "{aligned_reply}"
        );
        // Root H proof: focusing win-1 resolves the 3-member root group.
        let root = active_group_request(
            "ag-nested-5",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            &[
                ("win-1", 0, 0, 100, 80),
                ("win-2", 200, 0, 100, 80),
                ("win-3", 400, 0, 100, 80),
            ],
        );
        let root_reply = parse_reply(&planner.evaluate(&root));
        assert_eq!(root_reply["outcome"], "active-group", "{root_reply}");
        assert_eq!(
            root_reply["detail"]["members"].as_array().map(Vec::len),
            Some(3),
            "{root_reply}"
        );
        // Move the inner member down (swap within V). Focus must remain win-2
        // and the post-move query must still yield the inner active group.
        let moved = retained_request(
            "ag-nested-6",
            "owner-1",
            "gen-1",
            "win-2",
            &[
                ("win-1", 0, 0, 100, 80),
                ("win-2", 200, 0, 100, 80),
                ("win-3", 400, 0, 100, 80),
            ],
            serde_json::json!({"op": "move", "window": "win-2", "direction": "down"}),
        );
        let moved_reply = parse_reply(&planner.evaluate(&moved));
        assert_eq!(moved_reply["outcome"], "planned", "{moved_reply}");
        let focus_leaf = moved_reply["desired_focus"]["leaf"]
            .as_str()
            .expect("focus leaf");
        let mut focus_window = String::new();
        for entry in moved_reply["desired_geometry"]
            .as_array()
            .expect("geometry")
        {
            if entry["leaf"].as_str() == Some(focus_leaf) {
                focus_window = entry["window"].as_str().expect("window").to_owned();
            }
        }
        assert_eq!(focus_window, "win-2", "{moved_reply}");
        let after = active_group_request(
            "ag-nested-7",
            "owner-1",
            "gen-1",
            0,
            "win-2",
            &[
                ("win-1", 0, 0, 100, 80),
                ("win-2", 200, 0, 100, 80),
                ("win-3", 400, 0, 100, 80),
            ],
        );
        let after_reply = parse_reply(&planner.evaluate(&after));
        assert_eq!(after_reply["outcome"], "active-group", "{after_reply}");
        assert_eq!(
            after_reply["detail"]["focused_window"], "win-2",
            "{after_reply}"
        );
        let mut after_members: Vec<String> = after_reply["detail"]["members"]
            .as_array()
            .expect("members")
            .iter()
            .map(|m| m["window"].as_str().expect("window").to_owned())
            .collect();
        after_members.sort();
        assert_eq!(
            after_members,
            vec!["win-2".to_owned(), "win-3".to_owned()],
            "{after_reply}"
        );
    }

    fn retained_request_for_domain(
        correlation: &str,
        owner: &str,
        generation: &str,
        output: &str,
        workspace: &str,
        focused: &str,
        windows: &[(&str, i32, i32, i32, i32)],
        command: serde_json::Value,
    ) -> String {
        let entries: Vec<serde_json::Value> = windows
            .iter()
            .map(|(window, x, y, w, h)| {
                serde_json::json!({
                    "window": window,
                    "output": output,
                    "workspace": workspace,
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
                "output": output,
                "workspace": workspace,
                "bounds": {"x": 0, "y": 0, "w": 1200, "h": 800},
                "gap": 0,
                "outer_gap": 0,
            },
            "focused_window": focused,
            "windows": entries,
            "command": command,
        })
        .to_string()
    }

    #[test]
    fn retained_last_remove_retires_empty_session_and_frees_slot() {
        // Closing the final member retires the empty session at the same
        // committed boundary so a later background domain can be admitted.
        // Offline only: retained Planner evaluation, no bus.
        let mut planner = Planner::new();
        let admit = retained_request_for_domain(
            "empty-retire-1",
            "owner-1",
            "gen-1",
            "out-1",
            "ws-2",
            "win-h",
            &[("win-h", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-h", "output": "out-1", "workspace": "ws-2"}),
        );
        let admit_reply = parse_reply(&planner.evaluate(&admit));
        assert_eq!(admit_reply["outcome"], "planned", "{admit_reply}");
        assert_eq!(planner.retained_domains(), 1);
        let remove = retained_request_for_domain(
            "empty-retire-2",
            "owner-1",
            "gen-1",
            "out-1",
            "ws-2",
            "win-h",
            &[("win-h", 0, 0, 100, 80)],
            serde_json::json!({"op": "remove", "window": "win-h"}),
        );
        let remove_reply = parse_reply(&planner.evaluate(&remove));
        assert_eq!(remove_reply["outcome"], "planned", "{remove_reply}");
        assert_eq!(
            remove_reply["desired_geometry"].as_array().map(Vec::len),
            Some(0),
            "{remove_reply}"
        );
        assert_eq!(planner.retained_domains(), 0);
        // The freed slot admits a subsequent background domain.
        let next = retained_request_for_domain(
            "empty-retire-3",
            "owner-1",
            "gen-1",
            "out-1",
            "ws-3",
            "win-n",
            &[("win-n", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-n", "output": "out-1", "workspace": "ws-3"}),
        );
        let next_reply = parse_reply(&planner.evaluate(&next));
        assert_eq!(next_reply["outcome"], "planned", "{next_reply}");
        assert_eq!(planner.retained_domains(), 1);
    }

    #[test]
    fn retained_at_cap_empty_cleanup_releases_one_slot() {
        // At cap, removing the final member of an already-retained domain
        // still commits and retires, freeing exactly one slot. Offline only.
        let mut planner = Planner::new();
        for index in 1..=tiler_core::session::MAX_DOMAINS {
            let workspace = format!("ws-{index}");
            let window = format!("win-{index}");
            let correlation = format!("cap-retire-admit-{index}");
            let request = retained_request_for_domain(
                &correlation,
                "owner-1",
                "gen-1",
                "out-1",
                &workspace,
                &window,
                &[(window.as_str(), 0, 0, 100, 80)],
                serde_json::json!({"op": "admit", "window": window, "output": "out-1", "workspace": workspace}),
            );
            let reply = parse_reply(&planner.evaluate(&request));
            assert_eq!(reply["outcome"], "planned", "{reply} {index}");
        }
        assert_eq!(planner.retained_domains(), tiler_core::session::MAX_DOMAINS);
        // Empty the first retained domain with its exact single-member
        // observation: the committed remove retires it even at cap.
        let remove = retained_request_for_domain(
            "cap-retire-remove-1",
            "owner-1",
            "gen-1",
            "out-1",
            "ws-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "remove", "window": "win-1"}),
        );
        let remove_reply = parse_reply(&planner.evaluate(&remove));
        assert_eq!(remove_reply["outcome"], "planned", "{remove_reply}");
        assert_eq!(
            remove_reply["desired_geometry"].as_array().map(Vec::len),
            Some(0),
            "{remove_reply}"
        );
        assert_eq!(
            planner.retained_domains(),
            tiler_core::session::MAX_DOMAINS - 1
        );
    }

    #[test]
    fn retained_multi_member_collapse_is_not_falsely_committed() {
        // Two members vanishing before one observation cannot be committed
        // through the single-remove transaction: the empty post-observation
        // must not produce a planned empty commit. Offline only.
        let mut planner = Planner::new();
        for (correlation, focused, windows, command) in [
            (
                "collapse-1",
                "win-1",
                vec![("win-1", 0, 0, 100, 80)],
                serde_json::json!({"op": "admit", "window": "win-1", "output": "out-1", "workspace": "ws-1"}),
            ),
            (
                "collapse-2",
                "win-1",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "admit", "window": "win-2", "output": "out-1", "workspace": "ws-1"}),
            ),
        ] {
            let request = retained_request_for_domain(
                correlation,
                "owner-1",
                "gen-1",
                "out-1",
                "ws-1",
                focused,
                &windows,
                command,
            );
            assert_eq!(
                parse_reply(&planner.evaluate(&request))["outcome"],
                "planned"
            );
        }
        assert_eq!(planner.retained_domains(), 1);
        // Both members gone: an empty observation with a single-remove
        // command must stay fail-closed, never a planned empty commit.
        let collapsed = retained_request_for_domain(
            "collapse-3",
            "owner-1",
            "gen-1",
            "out-1",
            "ws-1",
            "",
            &[],
            serde_json::json!({"op": "remove", "window": "win-1"}),
        );
        let reply = parse_reply(&planner.evaluate(&collapsed));
        assert_ne!(reply["outcome"], "planned", "{reply}");
        if let Some(geometry) = reply.get("desired_geometry") {
            assert_ne!(geometry.as_array().map(Vec::len), Some(0), "{reply}");
        }
    }

    fn fit_excluded_request(
        correlation: &str,
        focused: &str,
        windows: &[(&str, i32, i32, i32, i32)],
        excluded: &[&str],
        command: serde_json::Value,
    ) -> String {
        let mut request: serde_json::Value = serde_json::from_str(&retained_request(
            correlation,
            "owner-1",
            "gen-1",
            focused,
            windows,
            command,
        ))
        .expect("valid retained request");
        for entry in request["windows"].as_array_mut().expect("windows") {
            if excluded.contains(&entry["window"].as_str().expect("window")) {
                entry["fit_excluded"] = serde_json::Value::Bool(true);
            }
        }
        request.to_string()
    }

    fn fit_leaves(reply: &serde_json::Value) -> Vec<String> {
        let mut leaves: Vec<String> = reply["desired_geometry"]
            .as_array()
            .expect("planned geometry present")
            .iter()
            .map(|entry| entry["leaf"].as_str().expect("leaf").to_owned())
            .collect();
        leaves.sort();
        leaves
    }

    #[test]
    fn fit_horizontal_strip_commits_through_lifecycle_at_base_zero() {
        // Unequal 400/800 side-by-side strip: the normal seed would reflow to
        // an equal split, so exact observed geometry proves the fit path.
        let windows = [("win-1", 0, 0, 400, 800), ("win-2", 400, 0, 800, 800)];
        let mut first = Planner::new();
        let reply = parse_reply(&first.evaluate(&retained_request(
            "fit-h-1",
            "owner-1",
            "gen-1",
            "win-2",
            &windows,
            admit_body("win-2"),
        )));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(reply["base_revision"], 0, "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
        assert_eq!(
            geometry_by_window(&reply),
            std::collections::BTreeMap::from([
                ("win-1".to_owned(), (0, 0, 400, 800)),
                ("win-2".to_owned(), (400, 0, 800, 800)),
            ]),
            "{reply}"
        );
        assert_eq!(fit_leaves(&reply), vec!["fit-l0", "fit-l1"], "{reply}");
        // Deterministic across fresh planners.
        let mut second = Planner::new();
        let again = parse_reply(&second.evaluate(&retained_request(
            "fit-h-1",
            "owner-1",
            "gen-1",
            "win-2",
            &windows,
            admit_body("win-2"),
        )));
        assert_eq!(
            again["desired_geometry"], reply["desired_geometry"],
            "{reply}"
        );
    }

    #[test]
    fn fit_vertical_flat_nary_strip_with_exact_shares() {
        // Three-high stacked strip: one flat N-ary group with positive spans
        // as shares projects back to the exact observed geometry.
        let windows = [
            ("win-1", 0, 0, 1200, 200),
            ("win-2", 0, 200, 1200, 200),
            ("win-3", 0, 400, 1200, 400),
        ];
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&retained_request(
            "fit-v-1",
            "owner-1",
            "gen-1",
            "win-3",
            &windows,
            admit_body("win-3"),
        )));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(reply["base_revision"], 0, "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2", "win-3"]);
        assert_eq!(
            geometry_by_window(&reply),
            std::collections::BTreeMap::from([
                ("win-1".to_owned(), (0, 0, 1200, 200)),
                ("win-2".to_owned(), (0, 200, 1200, 200)),
                ("win-3".to_owned(), (0, 400, 1200, 400)),
            ]),
            "{reply}"
        );
        assert_eq!(
            fit_leaves(&reply),
            vec!["fit-l0", "fit-l1", "fit-l2"],
            "{reply}"
        );
    }

    #[test]
    fn fit_respects_configured_inner_and_outer_gaps() {
        let windows = [("win-1", 8, 8, 588, 784), ("win-2", 604, 8, 588, 784)];
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&retained_request_with_selected_gaps(
            "fit-gap-1",
            "owner-1",
            "gen-1",
            "win-2",
            &windows,
            admit_body("win-2"),
        )));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(reply["base_revision"], 0, "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
        let got = geometry_by_window(&reply);
        assert_eq!(got["win-1"], (8, 8, 588, 784), "{reply}");
        assert_eq!(got["win-2"], (604, 8, 588, 784), "{reply}");
        assert_eq!(
            got["win-2"].0,
            got["win-1"].0 + got["win-1"].2 + 8,
            "{reply}"
        );
    }

    #[test]
    fn fit_falls_back_to_normal_seed_on_overlap_grid_and_out_of_domain() {
        // Overlap and out-of-domain stay on the initial overlap/containment
        // boundary; a T arrangement with primary-interval overlap on both axes
        // is genuinely unsupported under the near-strip interval policy, so
        // every case must take the normal deterministic seed/reflow.
        let normal = std::collections::BTreeMap::from([
            ("win-1".to_owned(), (0, 0, 600, 800)),
            ("win-2".to_owned(), (600, 0, 600, 800)),
        ]);
        for (correlation, windows) in [
            (
                "fit-fb-1",
                vec![("win-1", 0, 0, 700, 800), ("win-2", 500, 0, 700, 800)],
            ),
            (
                "fit-fb-3",
                vec![("win-1", 0, 0, 600, 800), ("win-2", 600, 0, 700, 800)],
            ),
        ] {
            let mut planner = Planner::new();
            let reply = parse_reply(&planner.evaluate(&retained_request(
                correlation,
                "owner-1",
                "gen-1",
                "win-2",
                &windows,
                admit_body("win-2"),
            )));
            assert_eq!(reply["outcome"], "planned", "{correlation} {reply}");
            assert_geometry_covers(&reply, &["win-1", "win-2"]);
            assert_eq!(geometry_by_window(&reply), normal, "{correlation} {reply}");
            assert!(
                !fit_leaves(&reply)
                    .iter()
                    .any(|leaf| leaf.starts_with("fit-l")),
                "{correlation} {reply}"
            );
        }
        // T arrangement: top full-width plus two bottom siblings. Sorted x
        // intervals overlap (top spans both bottom cells) and sorted y
        // intervals overlap (bottom siblings share one row), so neither axis
        // supports a near strip.
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&retained_request(
            "fit-fb-grid-1",
            "owner-1",
            "gen-1",
            "win-3",
            &[
                ("win-1", 0, 0, 1200, 400),
                ("win-2", 0, 400, 600, 400),
                ("win-3", 600, 400, 600, 400),
            ],
            admit_body("win-3"),
        )));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2", "win-3"]);
        assert!(
            !fit_leaves(&reply)
                .iter()
                .any(|leaf| leaf.starts_with("fit-l")),
            "{reply}"
        );
        // Deterministic normal fallback across fresh planners.
        let mut second = Planner::new();
        let again = parse_reply(&second.evaluate(&retained_request(
            "fit-fb-grid-1",
            "owner-1",
            "gen-1",
            "win-3",
            &[
                ("win-1", 0, 0, 1200, 400),
                ("win-2", 0, 400, 600, 400),
                ("win-3", 600, 400, 600, 400),
            ],
            admit_body("win-3"),
        )));
        assert_eq!(
            again["desired_geometry"], reply["desired_geometry"],
            "{reply}"
        );
    }

    #[test]
    fn fit_horizontal_near_strip_with_drift_projects_canonical_gaps() {
        // Imperfect horizontal near strip: left/right edge offsets, cross-axis
        // drift, and a nonconfigured observed 7px inter-gap. The x intervals
        // stay sequential, so the fit builds one flat N-ary group with the
        // observed widths as shares and projects the canonical configured-gap
        // result, which matches neither the observed geometry nor the normal
        // equal reflow.
        let windows = [("win-1", 10, 5, 398, 790), ("win-2", 415, 2, 770, 795)];
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&retained_request(
            "fit-near-h-1",
            "owner-1",
            "gen-1",
            "win-2",
            &windows,
            admit_body("win-2"),
        )));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(reply["base_revision"], 0, "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
        let got = geometry_by_window(&reply);
        assert_eq!(
            got,
            std::collections::BTreeMap::from([
                ("win-1".to_owned(), (0, 0, 409, 800)),
                ("win-2".to_owned(), (409, 0, 791, 800)),
            ]),
            "{reply}"
        );
        assert_eq!(fit_leaves(&reply), vec!["fit-l0", "fit-l1"], "{reply}");
        assert_ne!(
            got,
            std::collections::BTreeMap::from([
                ("win-1".to_owned(), (10, 5, 398, 790)),
                ("win-2".to_owned(), (415, 2, 770, 795)),
            ]),
            "{reply}"
        );
        assert_ne!(
            got,
            std::collections::BTreeMap::from([
                ("win-1".to_owned(), (0, 0, 600, 800)),
                ("win-2".to_owned(), (600, 0, 600, 800)),
            ]),
            "{reply}"
        );
    }

    #[test]
    fn fit_horizontal_near_strip_with_configured_gaps() {
        // Same interval policy under the configured outer/inner gaps: edge
        // offsets, cross-axis drift, and a nonconfigured observed 10px gap
        // still support a horizontal near strip with the observed widths as
        // shares, projected with the configured 8px gap.
        let windows = [("win-1", 10, 10, 400, 780), ("win-2", 420, 12, 760, 778)];
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&retained_request_with_selected_gaps(
            "fit-near-gap-1",
            "owner-1",
            "gen-1",
            "win-2",
            &windows,
            admit_body("win-2"),
        )));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(reply["base_revision"], 0, "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
        let got = geometry_by_window(&reply);
        assert_eq!(
            got,
            std::collections::BTreeMap::from([
                ("win-1".to_owned(), (8, 8, 405, 784)),
                ("win-2".to_owned(), (421, 8, 771, 784)),
            ]),
            "{reply}"
        );
        assert_eq!(fit_leaves(&reply), vec!["fit-l0", "fit-l1"], "{reply}");
        assert_eq!(
            got["win-2"].0,
            got["win-1"].0 + got["win-1"].2 + 8,
            "{reply}"
        );
    }

    #[test]
    fn fit_vertical_near_strip_with_drift_is_deterministic() {
        // Imperfect vertical near strip: cross-axis drift with x intervals
        // overlapping (so horizontal is unsupported) while y intervals stay
        // sequential. Canonical heights come from the observed spans.
        let windows = [("win-1", 5, 10, 1190, 250), ("win-2", 2, 270, 1194, 515)];
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&retained_request(
            "fit-near-v-1",
            "owner-1",
            "gen-1",
            "win-2",
            &windows,
            admit_body("win-2"),
        )));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(reply["base_revision"], 0, "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
        assert_eq!(
            geometry_by_window(&reply),
            std::collections::BTreeMap::from([
                ("win-1".to_owned(), (0, 0, 1200, 261)),
                ("win-2".to_owned(), (0, 261, 1200, 539)),
            ]),
            "{reply}"
        );
        assert_eq!(fit_leaves(&reply), vec!["fit-l0", "fit-l1"], "{reply}");
        let mut second = Planner::new();
        let again = parse_reply(&second.evaluate(&retained_request(
            "fit-near-v-1",
            "owner-1",
            "gen-1",
            "win-2",
            &windows,
            admit_body("win-2"),
        )));
        assert_eq!(
            again["desired_geometry"], reply["desired_geometry"],
            "{reply}"
        );
    }

    #[test]
    fn fit_excluded_flag_declines_fit_without_changing_normal_path() {
        // The marker only declines fitting: the normal seed still tiles the
        // flagged member to the same deterministic geometry.
        let windows = [("win-1", 0, 0, 400, 800), ("win-2", 400, 0, 800, 800)];
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&fit_excluded_request(
            "fit-x-1",
            "win-2",
            &windows,
            &["win-1"],
            admit_body("win-2"),
        )));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
        assert_eq!(
            geometry_by_window(&reply),
            std::collections::BTreeMap::from([
                ("win-1".to_owned(), (0, 0, 600, 800)),
                ("win-2".to_owned(), (600, 0, 600, 800)),
            ]),
            "{reply}"
        );
    }

    #[test]
    fn fit_gates_on_focused_admit_without_explicit_placement() {
        // Admitting a non-focused window never fits, even on exact strip
        // geometry: the focused window must be the admitted one.
        let windows = [("win-1", 0, 0, 400, 800), ("win-2", 400, 0, 800, 800)];
        let normal = std::collections::BTreeMap::from([
            ("win-1".to_owned(), (0, 0, 600, 800)),
            ("win-2".to_owned(), (600, 0, 600, 800)),
        ]);
        let mut unfocused = Planner::new();
        let reply = parse_reply(&unfocused.evaluate(&retained_request(
            "fit-g-1",
            "owner-1",
            "gen-1",
            "win-1",
            &windows,
            admit_body("win-2"),
        )));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(geometry_by_window(&reply), normal, "{reply}");
        // Explicit placement bounds also opt out of fitting.
        let mut placed = Planner::new();
        let placed_reply = parse_reply(&placed.evaluate(&retained_request(
            "fit-g-2",
            "owner-1",
            "gen-1",
            "win-2",
            &windows,
            serde_json::json!({
                "op": "admit",
                "window": "win-2",
                "output": "out-1",
                "workspace": "ws-1",
                "placement_bounds": {"x": 0, "y": 0, "w": 1200, "h": 800},
            }),
        )));
        assert_eq!(placed_reply["outcome"], "planned", "{placed_reply}");
        assert_eq!(geometry_by_window(&placed_reply), normal, "{placed_reply}");
    }

    #[test]
    fn fit_commits_once_and_retained_followup_never_refits() {
        let mut planner = Planner::new();
        let fitted = parse_reply(&planner.evaluate(&retained_request(
            "fit-r-1",
            "owner-1",
            "gen-1",
            "win-2",
            &[("win-1", 0, 0, 400, 800), ("win-2", 400, 0, 800, 800)],
            admit_body("win-2"),
        )));
        assert_eq!(fitted["outcome"], "planned", "{fitted}");
        assert_eq!(fitted["base_revision"], 0, "{fitted}");
        let before = geometry_by_window(&fitted)["win-1"];
        // A retained follow-up (existing session) always uses the normal
        // path: base 1 proves the fit committed exactly once, and the fitted
        // first child is not rewritten.
        let follow = parse_reply(&planner.evaluate(&retained_request(
            "fit-r-2",
            "owner-1",
            "gen-1",
            "win-3",
            &[
                ("win-1", 0, 0, 400, 800),
                ("win-2", 400, 0, 800, 800),
                ("win-3", 0, 0, 100, 80),
            ],
            admit_body("win-3"),
        )));
        assert_eq!(follow["outcome"], "planned", "{follow}");
        assert_eq!(follow["base_revision"], 1, "{follow}");
        assert_geometry_covers(&follow, &["win-1", "win-2", "win-3"]);
        assert_eq!(
            geometry_by_window(&follow)["win-1"],
            before,
            "{follow} vs {fitted}"
        );
    }

    #[test]
    fn output_relocation_preserves_topology_on_same_workspace_survivor() {
        // Displaced workspace (same id) observed on a survivor output reuses
        // the retained tree instead of reseeding. Offline only.
        let mut planner = Planner::new();
        let first = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-1",
            "owner-1",
            "gen-1",
            "out-removed",
            "ws-9",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-2", "output": "out-removed", "workspace": "ws-9"}),
        )));
        assert_eq!(first["outcome"], "planned", "{first}");
        assert_eq!(planner.retained_domains(), 1);
        // Same workspace id now observed on the survivor with the same
        // members: a reconcile must project the retained allocation, not
        // reseed, and the domain count stays one (source moved, not copied).
        let moved = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-2",
            "owner-1",
            "gen-1",
            "out-survivor",
            "ws-9",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(moved["outcome"], "planned", "{moved}");
        assert_eq!(moved["detail"]["kind"], "reconcile", "{moved}");
        assert_eq!(planner.retained_domains(), 1, "{moved}");
        assert_geometry_covers(&moved, &["win-1", "win-2"]);
    }

    #[test]
    fn output_relocation_returns_with_current_contents_after_edits() {
        // Membership edits while displaced converge through the normal
        // remove/admit path on the relocated tree: moved-out stays out,
        // moved-in admits into the relocated topology.
        let mut planner = Planner::new();
        let seed = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-edit-1",
            "owner-1",
            "gen-1",
            "out-old",
            "ws-7",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-2", "output": "out-old", "workspace": "ws-7"}),
        )));
        assert_eq!(seed["outcome"], "planned", "{seed}");
        // Displace with the same set: relocation preserves the tree.
        let displaced = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-edit-2",
            "owner-1",
            "gen-1",
            "out-new",
            "ws-7",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(displaced["outcome"], "planned", "{displaced}");
        assert_eq!(planner.retained_domains(), 1, "{displaced}");
        // While displaced, remove win-2 (moved-out stays out).
        let removed = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-edit-3",
            "owner-1",
            "gen-1",
            "out-new",
            "ws-7",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 0, 0, 100, 80)],
            serde_json::json!({"op": "remove", "window": "win-2"}),
        )));
        assert_eq!(removed["outcome"], "planned", "{removed}");
        // Admit win-3 into the displaced workspace (moved-in returns with it).
        let admitted = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-edit-4",
            "owner-1",
            "gen-1",
            "out-new",
            "ws-7",
            "win-3",
            &[("win-1", 0, 0, 100, 80), ("win-3", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-3", "output": "out-new", "workspace": "ws-7"}),
        )));
        assert_eq!(admitted["outcome"], "planned", "{admitted}");
        assert_geometry_covers(&admitted, &["win-1", "win-3"]);
        // Return to the original output with current contents.
        let returned = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-edit-5",
            "owner-1",
            "gen-1",
            "out-old",
            "ws-7",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-3", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(returned["outcome"], "planned", "{returned}");
        assert_geometry_covers(&returned, &["win-1", "win-3"]);
        assert_eq!(planner.retained_domains(), 1, "{returned}");
    }

    #[test]
    fn output_relocation_never_merges_into_survivor_visible_tree() {
        // A survivor output with its own workspace keeps its session; the
        // displaced workspace arrives as a separate domain, never merged.
        let mut planner = Planner::new();
        let survivor = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-merge-1",
            "owner-1",
            "gen-1",
            "out-keep",
            "ws-keep",
            "win-k",
            &[("win-k", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-k", "output": "out-keep", "workspace": "ws-keep"}),
        )));
        assert_eq!(survivor["outcome"], "planned", "{survivor}");
        let displaced = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-merge-2",
            "owner-1",
            "gen-1",
            "out-gone",
            "ws-away",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-a", "output": "out-gone", "workspace": "ws-away"}),
        )));
        assert_eq!(displaced["outcome"], "planned", "{displaced}");
        assert_eq!(planner.retained_domains(), 2);
        let relocated = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-merge-3",
            "owner-1",
            "gen-1",
            "out-keep",
            "ws-away",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(relocated["outcome"], "planned", "{relocated}");
        // Two separate domains: survivor visible plus displaced, not one
        // merged tree.
        assert_eq!(planner.retained_domains(), 2, "{relocated}");
        assert_geometry_covers(&relocated, &["win-a"]);
    }

    #[test]
    fn output_relocation_target_collision_is_atomic() {
        // A usable non-empty target is a collision: fail closed with no
        // source mutation. Both domains stay retained and usable.
        let mut planner = Planner::new();
        let source = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-coll-1",
            "owner-1",
            "gen-1",
            "out-gone",
            "ws-away",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-a", "output": "out-gone", "workspace": "ws-away"}),
        )));
        assert_eq!(source["outcome"], "planned", "{source}");
        let target = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-coll-2",
            "owner-1",
            "gen-1",
            "out-keep",
            "ws-away",
            "win-k",
            &[("win-k", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-k", "output": "out-keep", "workspace": "ws-away"}),
        )));
        assert_eq!(target["outcome"], "planned", "{target}");
        assert_eq!(planner.retained_domains(), 2);
        // Reconcile on the existing target follows the normal path; the
        // source is untouched (no relocation, no destruction).
        let again = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-coll-3",
            "owner-1",
            "gen-1",
            "out-keep",
            "ws-away",
            "win-k",
            &[("win-k", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(again["outcome"], "planned", "{again}");
        assert_eq!(planner.retained_domains(), 2, "{again}");
        let source_again = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-coll-4",
            "owner-1",
            "gen-1",
            "out-gone",
            "ws-away",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(source_again["outcome"], "planned", "{source_again}");
        assert_eq!(planner.retained_domains(), 2, "{source_again}");
    }

    #[test]
    fn output_relocation_mismatched_target_does_not_relocate_source() {
        // A target session that existed at handling start is never removed
        // or superseded for relocation, even when normal target cleanup
        // drops it as mismatched. The stale target follows the normal
        // seed path while the source stays retained and usable.
        let mut planner = Planner::new();
        let source = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-mismatch-1",
            "owner-1",
            "gen-1",
            "out-gone",
            "ws-away",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-a", "output": "out-gone", "workspace": "ws-away"}),
        )));
        assert_eq!(source["outcome"], "planned", "{source}");
        let target = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-mismatch-2",
            "owner-1",
            "gen-1",
            "out-keep",
            "ws-away",
            "win-k",
            &[("win-k", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-k", "output": "out-keep", "workspace": "ws-away"}),
        )));
        assert_eq!(target["outcome"], "planned", "{target}");
        assert_eq!(planner.retained_domains(), 2);
        // Admit on the existing target with different bounds: normal cleanup
        // drops the mismatched target slot, but source relocation must not
        // run because the target existed at handling start.
        let mut mismatched: serde_json::Value =
            serde_json::from_str(&retained_request_for_domain(
                "reloc-mismatch-3",
                "owner-1",
                "gen-1",
                "out-keep",
                "ws-away",
                "win-k2",
                &[("win-k", 0, 0, 100, 80), ("win-k2", 0, 0, 100, 80)],
                serde_json::json!({"op": "admit", "window": "win-k2", "output": "out-keep", "workspace": "ws-away"}),
            ))
            .expect("request JSON");
        mismatched["domain"]["bounds"] = serde_json::json!({"x": 0, "y": 0, "w": 800, "h": 600});
        let reseeded = parse_reply(&planner.evaluate(&mismatched.to_string()));
        assert_eq!(reseeded["outcome"], "planned", "{reseeded}");
        // Normal seeding replaced the target; the source was not relocated.
        assert_eq!(planner.retained_domains(), 2, "{reseeded}");
        let source_key = DomainKey {
            output: OutputId("out-gone".to_owned()),
            workspace: WorkspaceId("ws-away".to_owned()),
        };
        let target_key = DomainKey {
            output: OutputId("out-keep".to_owned()),
            workspace: WorkspaceId("ws-away".to_owned()),
        };
        assert!(planner.sessions.contains_key(&source_key), "{reseeded}");
        assert!(planner.sessions.contains_key(&target_key), "{reseeded}");
        assert_geometry_covers(&reseeded, &["win-k", "win-k2"]);
        // Source is untouched and still reconciles on its own domain.
        let source_again = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-mismatch-4",
            "owner-1",
            "gen-1",
            "out-gone",
            "ws-away",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(source_again["outcome"], "planned", "{source_again}");
        assert_eq!(planner.retained_domains(), 2, "{source_again}");
    }

    #[test]
    fn output_relocation_outer_gap_mismatch_is_atomic() {
        // Outer-gap mismatch against the source fails closed with no retained
        // mutation: the source stays and no target is created.
        let mut planner = Planner::new();
        let seed = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-gap-1",
            "owner-1",
            "gen-1",
            "out-gone",
            "ws-away",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-a", "output": "out-gone", "workspace": "ws-away"}),
        )));
        assert_eq!(seed["outcome"], "planned", "{seed}");
        assert_eq!(planner.retained_domains(), 1);
        let mut mismatched: serde_json::Value = serde_json::from_str(&retained_request_for_domain(
            "reloc-gap-2",
            "owner-1",
            "gen-1",
            "out-keep",
            "ws-away",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        ))
        .expect("request JSON");
        mismatched["domain"]["outer_gap"] = serde_json::json!(8);
        let rejected_reply = parse_reply(&planner.evaluate(&mismatched.to_string()));
        assert_eq!(rejected_reply["outcome"], "rejected", "{rejected_reply}");
        assert_eq!(planner.retained_domains(), 1, "{rejected_reply}");
        // Source is untouched and still reconciles.
        let source_again = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-gap-3",
            "owner-1",
            "gen-1",
            "out-gone",
            "ws-away",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(source_again["outcome"], "planned", "{source_again}");
        assert_eq!(planner.retained_domains(), 1, "{source_again}");
    }

    #[test]
    fn output_relocation_ambiguous_source_is_atomic() {
        // Two usable sources with the same workspace refuse relocation with
        // no mutation: both stay retained.
        let mut planner = Planner::new();
        for (correlation, output, window) in [
            ("reloc-amb-1", "out-a", "win-a"),
            ("reloc-amb-2", "out-b", "win-b"),
        ] {
            let seeded = parse_reply(&planner.evaluate(&retained_request_for_domain(
                correlation,
                "owner-1",
                "gen-1",
                output,
                "ws-x",
                window,
                &[(window, 0, 0, 100, 80)],
                serde_json::json!({"op": "admit", "window": window, "output": output, "workspace": "ws-x"}),
            )));
            assert_eq!(seeded["outcome"], "planned", "{seeded}");
        }
        assert_eq!(planner.retained_domains(), 2);
        let ambiguous = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-amb-3",
            "owner-1",
            "gen-1",
            "out-c",
            "ws-x",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(ambiguous["outcome"], "rejected", "{ambiguous}");
        assert_eq!(planner.retained_domains(), 2, "{ambiguous}");
    }

    #[test]
    fn output_relocation_blocked_while_workspace_send_pending() {
        // A pending standalone workspace-send blocks normal relocation fail
        // closed: the displaced target is not created and the source stays.
        // The workspace-send route itself is unchanged (still pending).
        let mut planner = Planner::new();
        let seed = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-pend-1",
            "owner-1",
            "gen-1",
            "out-gone",
            "ws-9",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-a", "output": "out-gone", "workspace": "ws-9"}),
        )));
        assert_eq!(seed["outcome"], "planned", "{seed}");
        // Open a standalone workspace-send pending session (out-1/ws-1 ->
        // out-1/ws-2); it stays pending across calls until ack/verify.
        let source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let send = parse_reply(&planner.evaluate(&workspace_request(
            "reloc-pend-send-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source,
            target,
            workspace_send_body(),
        )));
        assert_eq!(send["outcome"], "planned", "{send}");
        assert_eq!(send["kind"], "send-to-workspace", "{send}");
        // Displaced reconcile while the send is pending fails closed.
        let blocked = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-pend-2",
            "owner-1",
            "gen-1",
            "out-survivor",
            "ws-9",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(blocked["outcome"], "rejected", "{blocked}");
        assert_eq!(planner.retained_domains(), 1, "{blocked}");
        // Source is untouched and still reconciles; the send is still pending
        // (a second send is rejected rather than silently replaced).
        let source_again = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-pend-3",
            "owner-1",
            "gen-1",
            "out-gone",
            "ws-9",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(source_again["outcome"], "planned", "{source_again}");
        let second = parse_reply(&planner.evaluate(&workspace_request(
            "reloc-pend-send-2",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_send_body(),
        )));
        assert_eq!(second["outcome"], "rejected", "{second}");
    }

    #[test]
    fn output_relocation_preserves_exception_class_and_float_geometry() {
        // A floated exception keeps its class (flags) and floating geometry
        // across relocation; only the homing output moves. Revision is
        // preserved.
        let mut planner = Planner::new();
        let seed = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-exc-1",
            "owner-1",
            "gen-1",
            "out-removed",
            "ws-9",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-2", "output": "out-removed", "workspace": "ws-9"}),
        )));
        assert_eq!(seed["outcome"], "planned", "{seed}");
        let floated = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-exc-2",
            "owner-1",
            "gen-1",
            "out-removed",
            "ws-9",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 0, 0, 100, 80)],
            serde_json::json!({"op": "toggle-float", "window": "win-1"}),
        )));
        assert_eq!(floated["outcome"], "planned", "{floated}");
        let source_key = DomainKey {
            output: OutputId("out-removed".to_owned()),
            workspace: WorkspaceId("ws-9".to_owned()),
        };
        let before = planner
            .sessions
            .get(&source_key)
            .expect("source retained")
            .clone();
        assert_eq!(before.exception_count(), 1, "{floated}");
        let before_revision = before.accepted_revision();
        let before_exception = before
            .exception_observed()
            .into_iter()
            .next()
            .expect("float exception");
        assert!(before_exception.floating, "{floated}");
        let before_float_geometry = before.floating_geometry(&before_exception.window);
        // Displaced observation carries the floated window flagged floating and
        // admits a new tiled window through the normal admit path (reconcile
        // projects tiled leaves only, so membership changes converge via
        // admit/remove instead).
        let mut displaced: serde_json::Value = serde_json::from_str(&retained_request_for_domain(
            "reloc-exc-3",
            "owner-1",
            "gen-1",
            "out-survivor",
            "ws-9",
            "win-3",
            &[("win-1", 0, 0, 100, 80), ("win-2", 0, 0, 100, 80), ("win-3", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-3", "output": "out-survivor", "workspace": "ws-9"}),
        ))
        .expect("request JSON");
        displaced["windows"][0]["floating"] = serde_json::json!(true);
        let moved = parse_reply(&planner.evaluate(&displaced.to_string()));
        assert_eq!(moved["outcome"], "planned", "{moved}");
        assert_eq!(planner.retained_domains(), 1, "{moved}");
        let target_key = DomainKey {
            output: OutputId("out-survivor".to_owned()),
            workspace: WorkspaceId("ws-9".to_owned()),
        };
        let after = planner.sessions.get(&target_key).expect("target retained");
        // One admit applied on the relocated tree: revision advances by
        // exactly one (relocation itself adds zero).
        assert_eq!(after.accepted_revision(), before_revision + 1, "{moved}");
        assert_eq!(after.exception_count(), 1, "{moved}");
        let after_exception = after
            .exception_observed()
            .into_iter()
            .next()
            .expect("relocated exception");
        assert_eq!(
            after_exception.floating, before_exception.floating,
            "{moved}"
        );
        assert_eq!(
            after_exception.fullscreen, before_exception.fullscreen,
            "{moved}"
        );
        assert_eq!(
            after_exception.maximized, before_exception.maximized,
            "{moved}"
        );
        assert_eq!(after_exception.sticky, before_exception.sticky, "{moved}");
        assert_eq!(after_exception.output.0, "out-survivor", "{moved}");
        assert_eq!(after_exception.workspace.0, "ws-9", "{moved}");
        assert_eq!(
            after.floating_geometry(&after_exception.window),
            before_float_geometry,
            "{moved}"
        );
    }

    #[test]
    fn output_relocation_preserves_revision_gap_tree_and_focus() {
        // Successful relocation keeps accepted revision, inner gap, topology
        // shares, window homing, and focus; only output identity changes.
        let mut planner = Planner::new();
        let seed = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-state-1",
            "owner-1",
            "gen-1",
            "out-removed",
            "ws-9",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-2", "output": "out-removed", "workspace": "ws-9"}),
        )));
        assert_eq!(seed["outcome"], "planned", "{seed}");
        let source_key = DomainKey {
            output: OutputId("out-removed".to_owned()),
            workspace: WorkspaceId("ws-9".to_owned()),
        };
        let before = planner
            .sessions
            .get(&source_key)
            .expect("source retained")
            .clone();
        let before_revision = before.accepted_revision();
        let before_snapshot = before.snapshot();
        let (before_focus_domain, before_focus_leaf) = before.focus();
        assert!(before_focus_leaf.is_some(), "seeded focus");
        let moved = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-state-2",
            "owner-1",
            "gen-1",
            "out-survivor",
            "ws-9",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(moved["outcome"], "planned", "{moved}");
        assert_eq!(planner.retained_domains(), 1, "{moved}");
        assert!(!planner.sessions.contains_key(&source_key), "{moved}");
        let target_key = DomainKey {
            output: OutputId("out-survivor".to_owned()),
            workspace: WorkspaceId("ws-9".to_owned()),
        };
        let after = planner.sessions.get(&target_key).expect("target retained");
        assert_eq!(after.accepted_revision(), before_revision, "{moved}");
        // Topology shares and window set are preserved; only output homing
        // moves to the survivor.
        let after_snapshot = after.snapshot();
        assert_eq!(
            after_snapshot.windows.len(),
            before_snapshot.windows.len(),
            "{moved}"
        );
        for link in &after_snapshot.windows {
            assert_eq!(link.output.0, "out-survivor", "{moved}");
            assert_eq!(link.workspace.0, "ws-9", "{moved}");
        }
        let (after_focus_domain, after_focus_leaf) = after.focus();
        assert_eq!(after_focus_domain, Some(target_key.clone()), "{moved}");
        assert_eq!(after_focus_leaf, before_focus_leaf, "{moved}");
        assert_eq!(before_focus_domain, Some(source_key), "{moved}");
    }
}
