//! Bounded Planner protocol (product-shaped, static only).
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
//! Workspace send route (synchronous): the `send-to-workspace`
//! operation carries a same-output distinct-workspace target as an optional
//! `target_domain` plus `target_windows` alongside the source `domain`/
//! `windows`. It proposes once through the Engine and commits immediately
//! with native assignment plus both-domain geometry. Legacy requests are
//! unchanged.

use serde::{Deserialize, Serialize};

use tiler_core::bounds::{is_opaque_id, rect_contained, valid_carried_rect};
use tiler_core::contract::{LifecycleOperation, LifecyclePrecondition};
use tiler_core::directional::{Direction, NodeId, OutputId, WindowId, WorkspaceId};
use tiler_core::engine::Engine;
use tiler_core::geometry::Rect;
use tiler_core::ids::{CorrelationId, GenerationId, OwnerId};
use tiler_core::session::{DomainKey, OutputDomain, RefusalKind};

/// Planner protocol contract version (JSON string v1).
pub const PLAN_CONTRACT_VERSION: u32 = 1;
/// Bounded request cap (1 MiB; mirrors the portable service bound).
pub const PLAN_MAX_REQUEST_BYTES: usize = 1_048_576;
/// Bounded reply cap (mirrors the portable service bound).
pub const PLAN_MAX_REPLY_BYTES: usize = 64 * 1024;
/// Opaque id bound (single source: [`tiler_core::bounds::MAX_OPAQUE_ID_LEN`]).
pub const PLAN_MAX_ID_LEN: usize = tiler_core::bounds::MAX_OPAQUE_ID_LEN;
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
const MSG_DIRECTION: &str = "direction is invalid";

/// Bounded gap extent for carried work-area geometry
/// (single source: [`tiler_core::bounds::MAX_GAP`]).
const GEOMETRY_MAX_GAP: i32 = tiler_core::bounds::MAX_GAP;

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

/// Bounded client size-hint extent (AR12): `{w, h}` device units mirroring
/// the adapter `PlanWindowConstraints` min/max shapes. Unknown fields refuse
/// fail-closed; validation of meaningfulness lives in
/// [`tiler_core::size_hints`] (non-positive or absurd values behave as
/// absent, never as rejections: hints are advisory).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SizeDto {
    w: i32,
    h: i32,
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
    /// AR12 client size hints. Both default absent so existing fixtures parse
    /// unchanged; unknown nested fields refuse via [`SizeDto`].
    /// Meaningfulness (positive, in-bound) is judged in
    /// [`tiler_core::size_hints`], never here. Hints never join the
    /// directional fingerprint (they are advisory, not layout identity), so
    /// existing adapter baselines keep matching.
    #[serde(default)]
    min_size: Option<SizeDto>,
    #[serde(default)]
    max_size: Option<SizeDto>,
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
    /// AR12: the window's minimums are unsatisfiable in this allocation
    /// (proportional fallback shown). The adapter must never reassert this
    /// window. Absent unless true, so existing replies are byte-identical.
    #[serde(skip_serializing_if = "Option::is_none")]
    overconstrained: Option<bool>,
    /// AR12: the observed rectangle accepts as a client clamp of the desired
    /// rectangle (reconcile/update-gaps family only). The adapter must
    /// neither rewrite the window nor count it toward drift/park. Absent
    /// unless true, so existing replies are byte-identical.
    #[serde(skip_serializing_if = "Option::is_none")]
    client_clamped: Option<bool>,
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
        // Fixed bounded correlated rejection: a valid large request can
        // overflow the 64 KiB reply cap, and losing correlation there would
        // leave the transaction unattributable. Only a validated correlation
        // is ever echoed (garbage degrades to empty), so untrusted bytes
        // never escape through this path.
        _ => {
            let correlation = CorrelationId::parse(&reply.correlation_id)
                .map(|id| id.as_str().to_owned())
                .unwrap_or_default();
            serde_json::json!({
                "v": PLAN_CONTRACT_VERSION,
                "correlation_id": correlation,
                "outcome": "rejected",
                "kind": "reply-oversize",
                "message": "reply exceeds size bound",
            })
            .to_string()
        }
    }
}

/// Bounded redacted DescribePlan summary lines for the normal-level service
/// sink (Planner stderr, captured via the dev `planner-log` pointer into the
/// combined `[planner]` stream).
///
/// A complete request/reply
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
/// revision. Emitted for every authorized `DescribePlan` call with truthful
/// op tokens.
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
/// correlation/outcome/kind/base/detail from the reply echo.
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

/// Normal-level convergence summary for complete-observation convergence
/// (`docs/changes/archive/observation-convergence.md`): bounded correlated counts
/// emitted at the Planner protocol boundary after [`Engine::handle`]
/// converges retained membership/floating state to the complete current
/// observation. Counts only (removed/admitted/flag-adopted) plus the reason
/// op and the validated correlation; never native identifiers, geometry,
/// domains, owner, or raw payloads. Pure and total like the other summaries:
/// unparseable sides degrade to bounded placeholders. The Engine records a
/// report only for nonzero convergence, so exact-match operations emit
/// nothing and stay at the ingress/egress pair.
#[must_use]
pub fn summarize_plan_convergence(
    correlation: &str,
    op: &str,
    removed: usize,
    admitted: usize,
    flags_adopted: usize,
) -> String {
    format!(
        "{PLAN_SUMMARY_PREFIX} direction=convergence op={} correlation={} reason=observation-mismatch removed={} admitted={} flags_adopted={}",
        summary_token(Some(op)),
        summary_correlation(Some(correlation)),
        removed,
        admitted,
        flags_adopted,
    )
}

/// Emit the bounded correlated convergence summary for the just-completed
/// [`Engine::handle`] call, if it converged with nonzero counts. Called at
/// the Planner protocol boundary after every Engine handle return; exact
/// matches and non-converging routes record nothing so they stay silent. No
/// reply field is added: the summary is log-only.
fn emit_engine_convergence(engine: &Engine) {
    if let Some(report) = engine.last_convergence() {
        use std::io::Write;
        let _ = writeln!(
            std::io::stderr(),
            "{}",
            summarize_plan_convergence(
                report.correlation.as_str(),
                report.op,
                report.removed,
                report.admitted,
                report.flags_adopted,
            )
        );
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
        overconstrained: g.overconstrained.then_some(true),
        client_clamped: g.client_clamped.then_some(true),
    }
}

fn focus_reply(domain: &DomainKey, leaf: &NodeId) -> FocusReplyBody {
    FocusReplyBody {
        domain_output: domain.output.0.clone(),
        domain_workspace: domain.workspace.0.clone(),
        leaf: leaf.0.clone(),
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
/// existing tiled-state operations, and domain binding. A fresh
/// complete reconcile seeds through fresh admission machinery, so its
/// out-of-bounds containment is relaxed while invalid rectangles still reject.
/// Returns the ready-made rejected reply on failure.
#[cfg(test)]
fn validate_request(request_json: &str) -> Result<Validated, String> {
    validate_request_with_engine(request_json, None)
}

fn validate_request_with_engine(
    request_json: &str,
    engine: Option<&Engine>,
) -> Result<Validated, String> {
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
    // Fresh complete reconcile is the admission route: when the domain
    // is absent (or the owner/generation binding would reset, making it
    // absent after sync) it seeds through fresh admission
    // machinery, so out-of-bounds containment must not gate it. Retained
    // reconcile keeps the refusal; invalid rectangles still reject first.
    let fresh_reconcile = op_str == "reconcile"
        && engine.is_some_and(|eng| {
            let binding_fresh = eng.owner().is_none_or(|o| o.as_str() != request.owner)
                || eng
                    .generation()
                    .is_none_or(|g| g.as_str() != request.generation);
            if binding_fresh {
                return true;
            }
            !eng.contains(&DomainKey {
                output: OutputId(request.domain.output.clone()),
                workspace: WorkspaceId(request.domain.workspace.clone()),
            })
        });
    // Production directional payload: only focus/move may carry `domains`;
    // every other op (including the standalone workspace-send route) keeps
    // legacy single-domain behavior and refuses it fail-closed.
    let directional = match (&request.domains, op_str) {
        (None, _) => None,
        (Some(_), "focus") | (Some(_), "move") => request.domains.clone(),
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
        if !valid_carried_rect(entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h) {
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
                    if !fresh_reconcile && !entry.floating && !rect_contained(entry_rect, *bounds) {
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
            if !fresh_reconcile
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
    if !request.windows.is_empty()
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

/// Typed pure-projection serializer for the reconcile/update-gaps family:
/// funnels a [`tiler_core::boundary::ProjectionPlan`] through the exact
/// [`planned_reply`] wire shape, so output stays byte identical. Detail
/// `kind`/`capability` tokens come from the core plan (single source).
fn planned_projection_reply(
    correlation_id: &str,
    plan: &tiler_core::boundary::ProjectionPlan,
) -> String {
    planned_reply(
        correlation_id,
        plan.base_revision,
        serde_json::json!({
            "kind": plan.kind.kind_str(),
            "capability": plan.kind.capability_str(),
        }),
        &plan.geometry,
        match (&plan.focus_domain, &plan.focus_leaf) {
            (Some(domain), Some(leaf)) => Some((domain, leaf)),
            _ => None,
        },
    )
}

/// Typed versioned-tiled serializer for the toggle-float family:
/// funnels a [`tiler_core::boundary::TiledPlan`] through the exact planned
/// wire shape, so output stays byte identical. Detail
/// `kind`/`policy_version`/`capability` tokens come from the core plan
/// (single source); only kinds with fixed literal capabilities route here.
fn planned_tiled_reply(correlation_id: &str, plan: &tiler_core::boundary::TiledPlan) -> String {
    if plan.float_window.is_some() || plan.float_rect.is_some() {
        return planned_float_reply(correlation_id, plan);
    }
    planned_reply(
        correlation_id,
        plan.base_revision,
        serde_json::json!({
            "kind": plan.kind.kind_str(),
            "policy_version": plan.policy_version,
            "capability": plan
                .kind
                .capability_str()
                .expect("tiled reply kinds carry literal capabilities"),
        }),
        &plan.geometry,
        match (&plan.focus_domain, &plan.focus_leaf) {
            (Some(domain), Some(leaf)) => Some((domain, leaf)),
            _ => None,
        },
    )
}

/// Byte-exact intentional-float serializer: the legacy float wire shape
/// driven by a [`tiler_core::boundary::TiledPlan`] (single source).
fn planned_float_reply(correlation_id: &str, plan: &tiler_core::boundary::TiledPlan) -> String {
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id: correlation_id.to_owned(),
        outcome: "planned",
        kind: None,
        message: None,
        base_revision: Some(plan.base_revision),
        detail: Some(serde_json::json!({
            "kind": plan.kind.kind_str(),
            "policy_version": plan.policy_version,
            "capability": plan
                .kind
                .capability_str()
                .expect("tiled reply kinds carry literal capabilities"),
        })),
        desired_geometry: Some(plan.geometry.iter().map(geometry_reply).collect()),
        desired_focus: match (&plan.focus_domain, &plan.focus_leaf) {
            (Some(domain), Some(leaf)) => Some(focus_reply(domain, leaf)),
            _ => None,
        },
        float_geometry: match (&plan.float_window, &plan.float_rect) {
            (Some(window), Some(rect)) => Some(FloatReplyBody {
                window: window.0.clone(),
                rect: RectDto {
                    x: rect.x,
                    y: rect.y,
                    w: rect.w,
                    h: rect.h,
                },
            }),
            _ => None,
        },
        preconditions: None,
        operation: None,
    })
}

/// Byte-exact local/cross move serializer driven by a
/// [`tiler_core::boundary::MovePlanReply`] (single source). Detail key order
/// (`kind`, `rule`, `capability`, `direction`) and the R4 cross operation
/// echo match the legacy shapes exactly; rule/capability `Debug` tokens are
/// formatted here in protocol from the same typed values.
fn serialize_move_reply(
    correlation_id: &str,
    plan: &tiler_core::boundary::MovePlanReply,
) -> String {
    let detail = serde_json::json!({
        "kind": "move",
        "rule": format!("{:?}", plan.rule),
        "capability": format!("{:?}", plan.capability),
        "direction": direction_str(plan.direction),
    });
    let focus = Some((&plan.focus_domain, &plan.focus_leaf));
    let Some(cross) = &plan.cross else {
        return planned_reply(
            correlation_id,
            plan.base_revision,
            detail,
            &plan.geometry,
            focus,
        );
    };
    let operation_value = serde_json::json!({
        "op": "move",
        "rule": format!("{:?}", cross.rule),
        "capability": format!("{:?}", plan.capability),
        "direction": direction_str(cross.intent_direction),
        "window": cross.intent_window.0,
        "leaf": cross.intent_leaf.0,
        "source_output": cross.source_output.0,
        "source_workspace": cross.source_workspace.0,
        "target_output": cross.target_output.0,
        "target_workspace": cross.target_workspace.0,
        "source_root_child_index": cross.source_root_child_index,
        "target": match cross.target {
            tiler_core::directional::CrossOutputTarget::Empty => "empty",
            tiler_core::directional::CrossOutputTarget::Occupied => "occupied",
        },
    });
    // The legacy adapter-must-verify-postconditions token binds the planned
    // operation shape. Immediate R4 commits do not await native verification;
    // KWin fences setters and follows only on fresh observed mover arrival.
    let preconditions: Vec<&'static str> = cross
        .preconditions
        .iter()
        .map(|p| move_precondition_str(*p))
        .collect();
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id: correlation_id.to_owned(),
        outcome: "planned",
        kind: None,
        message: None,
        base_revision: Some(plan.base_revision),
        detail: Some(detail),
        desired_geometry: Some(plan.geometry.iter().map(geometry_reply).collect()),
        desired_focus: focus.map(|(domain, leaf)| focus_reply(domain, leaf)),
        float_geometry: None,
        preconditions: Some(preconditions),
        operation: Some(operation_value),
    })
}

/// Byte-exact local/cross focus serializer driven by a
/// [`tiler_core::boundary::FocusPlanReply`] (single source). Detail key order
/// (`kind`, `capability`, `direction`, `to_window`, plus `cross_output` for
/// crossed plans) and the cross operation echo match the legacy shapes
/// exactly; precondition tokens derive from the carried operation.
fn serialize_focus_reply(
    correlation_id: &str,
    plan: &tiler_core::boundary::FocusPlanReply,
) -> String {
    let focus = Some((&plan.focus_domain, &plan.focus_leaf));
    let Some(operation) = &plan.cross_operation else {
        return planned_reply(
            correlation_id,
            plan.base_revision,
            serde_json::json!({
                "kind": "focus",
                "capability": "directional-focus",
                "direction": direction_str(plan.direction),
                "to_window": plan.to_window.0,
            }),
            &plan.geometry,
            focus,
        );
    };
    cross_focus_planned_reply(
        correlation_id,
        plan.base_revision,
        serde_json::json!({
            "kind": "focus",
            "capability": "directional-focus",
            "direction": direction_str(plan.direction),
            "to_window": plan.to_window.0,
            "cross_output": true,
        }),
        &plan.geometry,
        (&plan.focus_domain, &plan.focus_leaf),
        operation,
    )
}

/// Byte-exact keyboard/pointer resize serializer driven by a
/// [`tiler_core::boundary::ResizePlanReply`] (single source). Detail key
/// order matches the legacy shapes exactly; exactly one of mode/boundary is
/// set by construction.
fn serialize_resize_reply(
    correlation_id: &str,
    plan: &tiler_core::boundary::ResizePlanReply,
) -> String {
    let focus = Some((&plan.focus_domain, &plan.focus_leaf));
    let operation = &plan.operation;
    if let Some(mode) = plan.mode {
        return planned_reply(
            correlation_id,
            plan.base_revision,
            serde_json::json!({
                "kind": "resize",
                "capability": "keyboard-resize",
                "direction": direction_str(plan.direction),
                "mode": mode.as_str(),
                "target_group": operation.target_group.0,
                "focused_index": operation.focused_index,
                "neighbor_index": operation.neighbor_index,
                "old_shares": operation.old_shares,
                "new_shares": operation.new_shares,
            }),
            &plan.geometry,
            focus,
        );
    }
    debug_assert!(plan.boundary.is_some(), "pointer plans carry a boundary");
    if let Some(secondary) = &plan.secondary {
        return planned_reply(
            correlation_id,
            plan.base_revision,
            serde_json::json!({
                "kind": "pointer-resize",
                "capability": "pointer-resize",
                "direction": direction_str(plan.direction),
                "boundary": plan.boundary.unwrap_or(0),
                "target_group": operation.target_group.0,
                "focused_index": operation.focused_index,
                "neighbor_index": operation.neighbor_index,
                "old_shares": operation.old_shares,
                "new_shares": operation.new_shares,
                "direction2": direction_str(secondary.direction),
                "boundary2": secondary.boundary,
                "target_group2": secondary.operation.target_group.0,
                "focused_index2": secondary.operation.focused_index,
                "neighbor_index2": secondary.operation.neighbor_index,
                "old_shares2": secondary.operation.old_shares,
                "new_shares2": secondary.operation.new_shares,
            }),
            &plan.geometry,
            focus,
        );
    }
    planned_reply(
        correlation_id,
        plan.base_revision,
        serde_json::json!({
            "kind": "pointer-resize",
            "capability": "pointer-resize",
            "direction": direction_str(plan.direction),
            "boundary": plan.boundary.unwrap_or(0),
            "target_group": operation.target_group.0,
            "focused_index": operation.focused_index,
            "neighbor_index": operation.neighbor_index,
            "old_shares": operation.old_shares,
            "new_shares": operation.new_shares,
        }),
        &plan.geometry,
        focus,
    )
}

/// Byte-exact workspace-send serializer driven by a
/// [`tiler_core::boundary::SendWorkspacePlan`] (single source). Detail key
/// order (`kind`, `policy_version`, `capability`), the `move-tiled` operation
/// echo, and precondition tokens match the legacy shape exactly. The plan
/// constructor guarantees the `MoveTiled` operation, so the legacy
/// `move-op-invalid` fallback stays with the caller at its exact position.
fn serialize_send_workspace_reply(
    correlation_id: &str,
    plan: &tiler_core::boundary::SendWorkspacePlan,
) -> String {
    let tiler_core::boundary::SendWorkspacePlan {
        operation:
            LifecycleOperation::MoveTiled {
                window,
                leaf,
                source_output,
                source_workspace,
                target_output,
                target_workspace,
            },
        ..
    } = &plan
    else {
        unreachable!("SendWorkspacePlan always carries MoveTiled");
    };
    let operation_value = serde_json::json!({
        "op": "move-tiled",
        "window": window.0,
        "leaf": leaf.0,
        "source_output": source_output.0,
        "source_workspace": source_workspace.0,
        "target_output": target_output.0,
        "target_workspace": target_workspace.0,
    });
    // Keep the legacy wire token for exact reply binding, not as a native
    // verification or committed-native-success assertion. KWin reconciles
    // both domains after the immediate planned-topology commit.
    let preconditions: Vec<&'static str> = plan
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
        base_revision: Some(plan.base_revision),
        detail: Some(serde_json::json!({
            "kind": "send-to-workspace",
            "policy_version": plan.policy_version,
            "capability": "move-tiled",
        })),
        desired_geometry: Some(plan.geometry.iter().map(geometry_reply).collect()),
        desired_focus: match (&plan.focus_domain, &plan.focus_leaf) {
            (Some(d), Some(l)) => Some(focus_reply(d, l)),
            _ => None,
        },
        float_geometry: None,
        preconditions: Some(preconditions),
        operation: Some(operation_value),
    })
}

/// Shared typed-reply choke point: every [`tiler_core::boundary::CoreReply`]
/// variant serializes here through the exact legacy wire shapes, so output
/// stays byte identical. Rejection/status/ack/commit/cancel arms reuse their
/// existing tiny serializers (single source); transaction orchestration
/// itself never crosses.
fn serialize_core_reply(ctx: &Validated, reply: &tiler_core::boundary::CoreReply) -> String {
    use tiler_core::boundary::CoreReply;
    let cid = ctx.request.correlation_id.clone();
    match reply {
        CoreReply::Projection(plan) => planned_projection_reply(&cid, plan),
        CoreReply::Tiled(plan) => planned_tiled_reply(&cid, plan),
        CoreReply::SendWorkspace(plan) => serialize_send_workspace_reply(&cid, plan),
        CoreReply::MoveDirectional(plan) => serialize_move_reply(&cid, plan),
        CoreReply::FocusDirectional(plan) => serialize_focus_reply(&cid, plan),
        CoreReply::Resize(plan) => serialize_resize_reply(&cid, plan),
        CoreReply::ActiveGroup(found) => serialize_active_group_found(ctx, found),
        CoreReply::NoGroup {
            base_revision,
            reason,
        } => no_group_reply(ctx, *base_revision, reason.as_str()),
        CoreReply::Rejected { kind, message } => rejected(cid, kind, message),
        CoreReply::SnapshotInvalid { message, detail } => snapshot_invalid(cid, message, detail),
        CoreReply::Diverged(reason) => diverged_reply(&cid, *reason),
    }
}

/// Convert carried wire windows to the portable near-strip fitter.
/// AR12 hints map straight across (raw values; meaningfulness is judged in
/// [`tiler_core::size_hints`] so absurd reports behave as absent).
fn engine_window_from_dto(entry: &ObservedDto) -> tiler_core::seed::EngineWindow {
    tiler_core::seed::EngineWindow {
        window: WindowId(entry.window.clone()),
        output: OutputId(entry.output.clone()),
        workspace: WorkspaceId(entry.workspace.clone()),
        rect: Rect {
            x: entry.rect.x,
            y: entry.rect.y,
            w: entry.rect.w,
            h: entry.rect.h,
        },
        floating: entry.floating,
        fit_excluded: entry.fit_excluded,
        hints: tiler_core::size_hints::WindowSizeHints {
            min_w: entry.min_size.as_ref().map(|size| size.w),
            min_h: entry.min_size.as_ref().map(|size| size.h),
            max_w: entry.max_size.as_ref().map(|size| size.w),
            max_h: entry.max_size.as_ref().map(|size| size.h),
        },
    }
}

/// Validated workspace-send route input: the target domain plus the exact
/// mover binding. The source domain is the already-validated request domain.
#[derive(Debug)]
struct WorkspaceInput {
    target_domain: OutputDomain,
    target_key: DomainKey,
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

/// Terminal divergence reply: outcome `diverged`, exact bounded kind.
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

/// Authoritative live-tree planner.
///
/// Retains one committed [`Session`] per logical domain across `DescribePlan`
/// calls. Observations validate membership/divergence against the retained
/// topology but never rebuild it: a known domain proposes directly, so equal
/// non-focused rectangles cannot force `ambiguous-placement` after the initial
/// plan. Domain bounds changes reproject the retained tree when the domain key
/// and complete window set remain unchanged; owner/generation change (adapter
/// restart), terminal divergence, pending residue, or membership divergence
/// (`Diverged`/`partial-observation`) discard that domain's retained state and
/// rebuild once via the [`tiler_core::seed::seed_session`] path. If the rebuild cannot safely
/// infer topology (`ambiguous-placement`), reject rather than wedge. Each
/// successful plan commits synchronously in the same call, so no pending
/// crosses calls and no stale data crosses domains/owner/generation.
///
/// Standalone workspace-send route: `send-to-workspace` commits synchronously
/// through the Engine with native assignment plus both-domain geometry.
///
/// Directional R4 route: `move` with a two-domain payload proposes an R4
/// cross-output transfer synchronously through the Engine. R1-R3 stay
/// synchronous.
#[derive(Debug, Default)]
pub struct Planner {
    engine: Engine,
}

impl Planner {
    /// Empty retained planner.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of retained domains.
    #[must_use]
    pub fn retained_domains(&self) -> usize {
        self.engine.retained_domains()
    }

    /// Retained owner binding, if any.
    #[must_use]
    pub fn owner(&self) -> Option<&OwnerId> {
        self.engine.owner()
    }

    /// Retained generation binding, if any.
    #[must_use]
    pub fn generation(&self) -> Option<&GenerationId> {
        self.engine.generation()
    }

    fn sync_binding(&mut self, owner: &OwnerId, generation: &GenerationId) {
        self.engine.sync_binding(owner, generation);
    }

    /// Stateful evaluation across calls. Retained reconcile accepts work-area
    /// bounds changes only when the domain key and complete window set remain
    /// unchanged, projecting the existing tree without replacing shares or
    /// topology.
    pub fn evaluate(&mut self, request_json: &str) -> String {
        let ctx = match validate_request_with_engine(request_json, Some(&self.engine)) {
            Ok(ctx) => ctx,
            Err(reply) => return reply,
        };
        if validated_op(&ctx).as_str() == "send-to-workspace" {
            return self.evaluate_workspace_request(&ctx);
        }
        self.sync_binding(&ctx.owner, &ctx.generation);
        // Typed codec: reconcile/update-gaps/active-group
        // parse once via `SyncCommand` after all boundaries (validation,
        // send dispatch, binding sync) and call the
        // inner bodies directly, eliminating the second `from_value` + op-string
        // check on this production path. The string guard preserves exact
        // unknown/missing/non-string `unknown-value` behavior without a typed
        // parse.
        // Move/focus/resize/pointer-resize/toggle-float parse `SyncCommand`
        // once in place inside their handlers (see `SyncCommand` docs for the
        // exact probe/ordering reasons), so these arms dispatch by op string.
        match validated_op(&ctx).as_str() {
            "reconcile" | "update-gaps" | "active-group" => {
                match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
                    Ok(SyncCommand::Reconcile {}) => self.evaluate_reconcile_inner(&ctx),
                    Ok(SyncCommand::UpdateGaps {}) => self.evaluate_update_gaps_inner(&ctx),
                    Ok(command @ SyncCommand::ActiveGroup {}) => {
                        // Production typed-boundary route: convert the
                        // already-decoded command after all fences, then run
                        // the typed active-group body (no second parse).
                        let core_command =
                            core_command_from_sync(&command).expect("non-verify sync op converts");
                        self.evaluate_active_group_typed(&ctx, &core_command)
                    }
                    // Unreachable: the outer string guard admits only the three
                    // ops above, so no other variant can decode here.
                    Ok(_) => rejected(
                        valid_correlation_echo(&ctx.raw),
                        "unknown-value",
                        MSG_UNKNOWN_VALUE,
                    ),
                    Err(error) => {
                        let (kind, message) = classify_parse_error(&error);
                        rejected(valid_correlation_echo(&ctx.raw), kind, message)
                    }
                }
            }
            "move" => self.evaluate_move_retained(&ctx),
            "focus" => self.evaluate_focus_retained(&ctx),
            "resize" => self.evaluate_resize_retained(&ctx),
            "pointer-resize" => self.evaluate_pointer_resize_retained(&ctx),
            "toggle-float" => self.evaluate_toggle_float_retained(&ctx),
            _ => rejected(
                valid_correlation_echo(&ctx.raw),
                "unknown-value",
                MSG_UNKNOWN_VALUE,
            ),
        }
    }

    /// Engine-handle choke point: runs the owned [`Engine::handle`] entry
    /// point, emits the bounded correlated convergence summary when the op
    /// converged with nonzero counts, then serializes through the typed choke
    /// point. Reply bytes are unchanged; the summary carries counts plus the
    /// reason op only (no new reply field, no identifiers, no payloads).
    fn handle_and_serialize(
        &mut self,
        ctx: &Validated,
        event: &tiler_core::boundary::CoreEvent,
    ) -> String {
        let reply = self.engine.handle(event);
        emit_engine_convergence(&self.engine);
        serialize_core_reply(ctx, &reply)
    }

    fn evaluate_toggle_float_retained(&mut self, ctx: &Validated) -> String {
        // Probe-before-parse precedence for malformed floats on untracked
        // floating windows (`not-tiled`, never `unknown-field` or
        // `float-rect-invalid`): only a fully valid toggle-float command is
        // pre-rejected here. A valid toggle-float reaches the Engine, which
        // converges a fresh floating observation into an exception and
        // unfloats it into the current domain.
        let well_formed = match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
            Ok(SyncCommand::ToggleFloat { window, float_rect }) => {
                is_opaque_id(&window)
                    && ctx
                        .request
                        .windows
                        .iter()
                        .any(|entry| entry.window == window)
                    && float_rect
                        .as_ref()
                        .is_none_or(|rect| valid_carried_rect(rect.x, rect.y, rect.w, rect.h))
            }
            _ => false,
        };
        if !well_formed
            && ctx
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
            && !self.engine.contains(&ctx.domain_key)
        {
            return rejected(
                ctx.request.correlation_id.clone(),
                RefusalKind::NotTiled.as_str(),
                RefusalKind::NotTiled.message(),
            );
        }
        evaluate_toggle_float_with(ctx, |window, float_rect| {
            // Engine-owned toggle-float orchestration: the validated window
            // and float rect cross in the typed command; seed ordering,
            // relocation, propose/commit, and store run in `Engine::handle`.
            let core_command = tiler_core::boundary::CoreCommand::ToggleFloat {
                window: window.to_owned(),
                float_rect,
            };
            let event = core_event(ctx, &core_command);
            self.handle_and_serialize(ctx, &event)
        })
    }

    fn evaluate_move_retained(&mut self, ctx: &Validated) -> String {
        // Strict tagged decode in place (see `SyncCommand`): the directional
        // pair branch and every validation below run on the rebuilt plumbing
        // value exactly as before.
        let command: DirectedCommand =
            match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
                Ok(SyncCommand::Move {
                    window,
                    direction,
                    cross_output_transfer,
                }) => DirectedCommand {
                    window,
                    direction,
                    cross_output_transfer,
                },
                Ok(_) => {
                    return snapshot_invalid(
                        ctx.request.correlation_id.clone(),
                        MSG_OPAQUE_ID,
                        "move-op-invalid",
                    );
                }
                Err(error) => {
                    if is_unknown_variant(&error) {
                        return snapshot_invalid(
                            ctx.request.correlation_id.clone(),
                            MSG_OPAQUE_ID,
                            "move-op-invalid",
                        );
                    }
                    let (kind, message) = classify_parse_error(&error);
                    return rejected(valid_correlation_echo(&ctx.raw), kind, message);
                }
            };
        // Production directional route: two-domain observations build one
        // temporary pair from canonical retained domain sessions.
        // Single-domain legacy requests run the Engine-owned local path below.
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
        if parse_direction(&command.direction).is_none() {
            return rejected(
                ctx.request.correlation_id.clone(),
                "direction-invalid",
                MSG_DIRECTION,
            );
        }
        // Engine-owned local orchestration: the validated window/direction
        // cross opaquely in the typed command; seed ordering, focus sync,
        // relocation, propose/commit, and store run in `Engine::handle`.
        // Serialization funnels through the typed choke point.
        let core_command = tiler_core::boundary::CoreCommand::Move {
            window: command.window.clone(),
            direction: command.direction.clone(),
            cross_output_transfer: command.cross_output_transfer,
        };
        let event = core_event(ctx, &core_command);
        self.handle_and_serialize(ctx, &event)
    }

    fn evaluate_focus_retained(&mut self, ctx: &Validated) -> String {
        // Strict tagged decode in place (see `SyncCommand`): same contract as
        // `evaluate_move_retained`; the `cross_output_transfer` carrier is
        // preserved so explicit values keep parsing exactly as before.
        let command: DirectedCommand =
            match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
                Ok(SyncCommand::Focus {
                    window,
                    direction,
                    cross_output_transfer,
                }) => DirectedCommand {
                    window,
                    direction,
                    cross_output_transfer,
                },
                Ok(_) => {
                    return snapshot_invalid(
                        ctx.request.correlation_id.clone(),
                        MSG_OPAQUE_ID,
                        "focus-op-invalid",
                    );
                }
                Err(error) => {
                    if is_unknown_variant(&error) {
                        return snapshot_invalid(
                            ctx.request.correlation_id.clone(),
                            MSG_OPAQUE_ID,
                            "focus-op-invalid",
                        );
                    }
                    let (kind, message) = classify_parse_error(&error);
                    return rejected(valid_correlation_echo(&ctx.raw), kind, message);
                }
            };
        // Production directional route: two-domain observations try local
        // focus first, then the exhausted Left/Right cross-output proposal
        // against a temporary pair built from canonical domain state.
        // Single-domain legacy requests run the Engine-owned local path below.
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
        if parse_direction(&command.direction).is_none() {
            return rejected(
                ctx.request.correlation_id.clone(),
                "direction-invalid",
                MSG_DIRECTION,
            );
        }
        // Engine-owned local orchestration: the validated window/direction
        // cross opaquely in the typed command; seed ordering, focus sync,
        // relocation, propose/commit, and store run in `Engine::handle`
        // (local only, no cross fallback). Serialization funnels through the
        // typed choke point.
        let core_command = tiler_core::boundary::CoreCommand::Focus {
            window: command.window.clone(),
            direction: command.direction.clone(),
            cross_output_transfer: command.cross_output_transfer,
        };
        let event = core_event(ctx, &core_command);
        self.handle_and_serialize(ctx, &event)
    }

    /// Production directional move: envelope, tagged decoding, pair scope
    /// shape, mover binding, and parsed-direction/op validation stay here at
    /// their exact positions; planning, R4 staging, and the R1-R3 synchronous
    /// commit are the Engine-owned [`tiler_core::engine::Engine::handle`]
    /// typed entry point over the validated pair. Serialization funnels
    /// through the typed [`serialize_core_reply`] choke point.
    fn evaluate_move_directional(&mut self, ctx: &Validated, command: &DirectedCommand) -> String {
        let cid = ctx.request.correlation_id.clone();
        if !is_opaque_id(&command.window) {
            return snapshot_invalid(cid, MSG_OPAQUE_ID, "move-window-invalid");
        }
        if parse_direction(&command.direction).is_none() {
            return rejected(cid, "direction-invalid", MSG_DIRECTION);
        }
        if directional_pair(ctx).is_none() {
            return snapshot_invalid(cid, MSG_OBSERVATION, "domain-invalid");
        }
        let core_command = core_command_from_sync(&SyncCommand::Move {
            window: command.window.clone(),
            direction: command.direction.clone(),
            cross_output_transfer: command.cross_output_transfer,
        })
        .expect("move sync op converts");
        let event = core_event(ctx, &core_command);
        self.handle_and_serialize(ctx, &event)
    }

    /// Production directional focus: envelope, tagged decoding, pair scope
    /// shape, and parsed-direction/op validation stay here at their exact
    /// positions; planning and the synchronous commit are the Engine-owned
    /// [`tiler_core::engine::Engine::handle`] typed entry point. Exactly one
    /// focus actuation downstream; no geometry/layout/window membership
    /// writes.
    fn evaluate_focus_directional(&mut self, ctx: &Validated, command: &DirectedCommand) -> String {
        let cid = ctx.request.correlation_id.clone();
        if !is_opaque_id(&command.window) {
            return snapshot_invalid(cid, MSG_OPAQUE_ID, "focus-window-invalid");
        }
        if parse_direction(&command.direction).is_none() {
            return rejected(cid, "direction-invalid", MSG_DIRECTION);
        }
        if directional_pair(ctx).is_none() {
            return snapshot_invalid(cid, MSG_OBSERVATION, "domain-invalid");
        }
        let core_command = core_command_from_sync(&SyncCommand::Focus {
            window: command.window.clone(),
            direction: command.direction.clone(),
            cross_output_transfer: command.cross_output_transfer,
        })
        .expect("focus sync op converts");
        let event = core_event(ctx, &core_command);
        self.handle_and_serialize(ctx, &event)
    }

    fn evaluate_resize_retained(&mut self, ctx: &Validated) -> String {
        // Strict tagged decode in place (see `SyncCommand`).
        let (window_raw, direction_raw, mode_raw, press_index) =
            match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
                Ok(SyncCommand::Resize {
                    window,
                    direction,
                    mode,
                    press_index,
                }) => (window, direction, mode, press_index),
                Ok(_) => {
                    return snapshot_invalid(
                        ctx.request.correlation_id.clone(),
                        MSG_OPAQUE_ID,
                        "resize-op-invalid",
                    );
                }
                Err(error) => {
                    if is_unknown_variant(&error) {
                        return snapshot_invalid(
                            ctx.request.correlation_id.clone(),
                            MSG_OPAQUE_ID,
                            "resize-op-invalid",
                        );
                    }
                    let (kind, message) = classify_parse_error(&error);
                    return rejected(valid_correlation_echo(&ctx.raw), kind, message);
                }
            };
        if !is_opaque_id(&window_raw) {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "resize-window-invalid",
            );
        }
        if parse_direction(&direction_raw).is_none() {
            return rejected(
                ctx.request.correlation_id.clone(),
                "direction-invalid",
                MSG_DIRECTION,
            );
        }
        if parse_mode(&mode_raw).is_none() {
            return rejected(
                ctx.request.correlation_id.clone(),
                "direction-invalid",
                MSG_DIRECTION,
            );
        }
        // Engine-owned keyboard-resize orchestration: the validated
        // window/direction/mode cross opaquely in the typed command;
        // seed ordering, focus sync, keyboard-gated propose/commit, and
        // store run in `Engine::handle`. Serialization funnels through the
        // typed choke point.
        let core_command = tiler_core::boundary::CoreCommand::Resize {
            window: window_raw,
            direction: direction_raw,
            mode: mode_raw,
            press_index,
        };
        let event = core_event(ctx, &core_command);
        self.handle_and_serialize(ctx, &event)
    }

    fn evaluate_pointer_resize_retained(&mut self, ctx: &Validated) -> String {
        // Strict tagged decode in place (see `SyncCommand`).
        let (window_raw, direction_raw, boundary, direction2_raw, boundary2) =
            match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
                Ok(SyncCommand::PointerResize {
                    window,
                    direction,
                    boundary,
                    direction2,
                    boundary2,
                }) => (window, direction, boundary, direction2, boundary2),
                Ok(_) => {
                    return snapshot_invalid(
                        ctx.request.correlation_id.clone(),
                        MSG_OPAQUE_ID,
                        "pointer-resize-op-invalid",
                    );
                }
                Err(error) => {
                    if is_unknown_variant(&error) {
                        return snapshot_invalid(
                            ctx.request.correlation_id.clone(),
                            MSG_OPAQUE_ID,
                            "pointer-resize-op-invalid",
                        );
                    }
                    let (kind, message) = classify_parse_error(&error);
                    return rejected(valid_correlation_echo(&ctx.raw), kind, message);
                }
            };
        if !is_opaque_id(&window_raw) {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "pointer-resize-window-invalid",
            );
        }
        if parse_direction(&direction_raw).is_none() {
            return rejected(
                ctx.request.correlation_id.clone(),
                "direction-invalid",
                MSG_DIRECTION,
            );
        }
        // Corner second axis is both-or-neither; a half-present pair is an
        // op shape violation, and an unparsable second direction binds the
        // exact direction refusal like the primary.
        if direction2_raw.is_some() != boundary2.is_some() {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "pointer-resize-op-invalid",
            );
        }
        if let Some(second) = &direction2_raw
            && parse_direction(second).is_none()
        {
            return rejected(
                ctx.request.correlation_id.clone(),
                "direction-invalid",
                MSG_DIRECTION,
            );
        }
        // Engine-owned pointer-resize orchestration: the validated
        // window/direction plus the opaquely carried boundary (and the
        // optional corner second axis) cross in the typed command; seed
        // ordering, focus sync, pointer-gated propose/commit, and store run
        // in `Engine::handle`. Serialization funnels through the typed
        // choke point.
        let core_command = tiler_core::boundary::CoreCommand::PointerResize {
            window: window_raw,
            direction: direction_raw,
            boundary,
            direction2: direction2_raw,
            boundary2,
        };
        let event = core_event(ctx, &core_command);
        self.handle_and_serialize(ctx, &event)
    }

    /// Direct-evaluator compatibility wrapper (test-only): exact legacy
    /// `from_value` + op-check behavior. Production `evaluate` bypasses this
    /// via the typed [`SyncCommand`] single parse + inner below.
    #[cfg(test)]
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
        self.evaluate_reconcile_inner(ctx)
    }

    /// Production reconcile body without a second command parse/op check.
    /// The `evaluate` typed path parses [`SyncCommand`] once after all
    /// dispatch boundaries and calls here directly; the retained wrapper
    /// above preserves the exact direct-evaluator invalid-op behavior.
    fn evaluate_reconcile_inner(&mut self, ctx: &Validated) -> String {
        // Engine-owned reconcile orchestration: relocation, fences,
        // membership, projection, and reprojection run in `Engine::handle`.
        // Serialization funnels through the typed choke point.
        let core_command = tiler_core::boundary::CoreCommand::Reconcile;
        let event = core_event(ctx, &core_command);
        self.handle_and_serialize(ctx, &event)
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
    /// reseeds a session: an unknown domain refuses so the normal reconcile path
    /// seeds it with the new gaps instead. A simultaneous work-area change
    /// folds into the same projection with reconcile-equivalent safety; a
    /// simultaneous membership change refuses as partial-observation and the
    /// normal reconcile path owns it.
    /// Production update-gaps body without a second command parse/op check.
    /// Same boundary contract as [`Self::evaluate_reconcile_inner`].
    fn evaluate_update_gaps_inner(&mut self, ctx: &Validated) -> String {
        // Engine-owned update-gaps orchestration: fences, membership,
        // projection, and gap adoption run in `Engine::handle`.
        // Serialization funnels through the typed choke point.
        let core_command = tiler_core::boundary::CoreCommand::UpdateGaps;
        let event = core_event(ctx, &core_command);
        self.handle_and_serialize(ctx, &event)
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
    /// Direct-evaluator compatibility wrapper (test-only): exact legacy
    /// `from_value` + op-check behavior. Production `evaluate` bypasses this
    /// via the typed [`SyncCommand`] single parse + inner below.
    #[cfg(test)]
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
        self.evaluate_active_group_inner(ctx)
    }

    /// Direct-evaluator compatibility entry (test-only): shared focus-sync
    /// fences plus the typed resolution over a freshly built event.
    #[cfg(test)]
    fn evaluate_active_group_inner(&mut self, ctx: &Validated) -> String {
        let event = core_event(ctx, &tiler_core::boundary::CoreCommand::ActiveGroup);
        self.evaluate_active_group_with_event(ctx, &event)
    }

    /// Production typed active-group body: `core_command` is the total
    /// conversion of the already-decoded [`SyncCommand`] after all fences.
    /// Focus-sync plus read-only resolution run in
    /// `tiler_core::engine::Engine::handle`; serialization funnels through the
    /// typed choke point.
    fn evaluate_active_group_typed(
        &mut self,
        ctx: &Validated,
        core_command: &tiler_core::boundary::CoreCommand,
    ) -> String {
        debug_assert!(matches!(
            core_command,
            tiler_core::boundary::CoreCommand::ActiveGroup
        ));
        let event = core_event(ctx, core_command);
        self.evaluate_active_group_with_event(ctx, &event)
    }

    /// Shared active-group body over a total [`tiler_core::boundary::CoreEvent`]:
    /// Engine-owned focus-sync plus read-only resolution. Both production and
    /// test entries funnel here.
    fn evaluate_active_group_with_event(
        &mut self,
        ctx: &Validated,
        event: &tiler_core::boundary::CoreEvent,
    ) -> String {
        self.handle_and_serialize(ctx, event)
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
        // Strict tagged decode after the target scope and focus checks above
        // (see `SyncCommand`): scope-before-parse order is unchanged.
        let (window, target_output, target_workspace) =
            match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
                Ok(SyncCommand::SendToWorkspace {
                    window,
                    target_output,
                    target_workspace,
                }) => (window, target_output, target_workspace),
                Ok(_) => {
                    return Err(snapshot_invalid(cid, MSG_OPAQUE_ID, "move-op-invalid"));
                }
                Err(error) => {
                    if is_unknown_variant(&error) {
                        return Err(snapshot_invalid(cid, MSG_OPAQUE_ID, "move-op-invalid"));
                    }
                    let (kind, message) = classify_parse_error(&error);
                    return Err(rejected(valid_correlation_echo(&ctx.raw), kind, message));
                }
            };
        if !is_opaque_id(&window) {
            return Err(snapshot_invalid(cid, MSG_OPAQUE_ID, "move-window-invalid"));
        }
        if !is_opaque_id(&target_output) {
            return Err(snapshot_invalid(cid, MSG_OPAQUE_ID, "move-output-invalid"));
        }
        if !is_opaque_id(&target_workspace) {
            return Err(snapshot_invalid(
                cid,
                MSG_OPAQUE_ID,
                "move-workspace-invalid",
            ));
        }
        if window != ctx.request.focused_window {
            return Err(rejected(
                cid,
                "focus-mismatch",
                "the moved window is not the focused window",
            ));
        }
        if target_output != target_key.output.0 || target_workspace != target_key.workspace.0 {
            return Err(rejected(
                cid,
                "target-mismatch",
                "command target does not match the target domain",
            ));
        }
        Ok(WorkspaceInput {
            target_domain,
            target_key,
            window: WindowId(window),
        })
    }

    /// Workspace-send request phase: propose the same-output
    /// distinct-workspace move synchronously through the Engine with native
    /// assignment plus both-domain geometry.
    ///
    /// Codec/scope stays here (shared target scope, tagged command decode,
    /// mover binding in [`Planner::validate_workspace_input`]); the outcome
    /// itself is the Engine-owned [`tiler_core::engine::Engine::handle`]
    /// typed entry point over the validated target scope.
    fn evaluate_workspace_request(&mut self, ctx: &Validated) -> String {
        let input = match self.validate_workspace_input(ctx) {
            Ok(input) => input,
            Err(reply) => return reply,
        };
        let core_command = tiler_core::boundary::CoreCommand::SendToWorkspace {
            window: input.window.0.clone(),
            target_output: input.target_key.output.0.clone(),
            target_workspace: input.target_key.workspace.0.clone(),
        };
        let mut event = core_event(ctx, &core_command);
        event.target_domain = Some((input.target_domain, input.target_key));
        self.handle_and_serialize(ctx, &event)
    }
}

fn evaluate_toggle_float_with(
    ctx: &Validated,
    evaluate: impl FnOnce(&str, Option<Rect>) -> String,
) -> String {
    // Strict tagged decode in place (see `SyncCommand`): runs after the
    // caller's raw-window floating probe, preserving `not-tiled` precedence
    // for malformed floats on untracked floating windows.
    let (window, float_rect_dto) =
        match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
            Ok(SyncCommand::ToggleFloat { window, float_rect }) => (window, float_rect),
            Ok(_) => {
                return snapshot_invalid(
                    ctx.request.correlation_id.clone(),
                    MSG_OBSERVATION,
                    "toggle-float-op-invalid",
                );
            }
            Err(error) => {
                if is_unknown_variant(&error) {
                    return snapshot_invalid(
                        ctx.request.correlation_id.clone(),
                        MSG_OBSERVATION,
                        "toggle-float-op-invalid",
                    );
                }
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
    if !is_opaque_id(&window) {
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
        .any(|entry| entry.window == window)
    {
        return rejected(
            ctx.request.correlation_id.clone(),
            "partial-observation",
            MSG_OBSERVATION,
        );
    }
    let float_rect = match float_rect_dto.as_ref() {
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
    evaluate(&window, float_rect)
}

/// Directional move/focus plumbing value for the canonical pair path.
/// Rebuilt by the converted `move`/`focus` handlers from the typed
/// [`SyncCommand`] variant (never parsed directly anymore); the
/// `cross_output_transfer` default-true is mirrored on the enum variants so
/// omitted legacy requests keep their historical full-capability behavior.
#[derive(Debug, Clone)]
struct DirectedCommand {
    window: String,
    direction: String,
    /// Active KWin currently has no public output-transfer primitive. The
    /// adapter sends false for a two-domain flight, preserving local movement
    /// while rejecting R4 before the planner stages any state. Omitted legacy
    /// requests retain their historical full-capability behavior.
    cross_output_transfer: bool,
}

const fn default_cross_output_transfer() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg(test)]
struct ReconcileCommand {
    op: String,
}

/// Read-only active-group highlight query: no parameters beyond the shared
/// observation envelope (domain/windows/focus) plus identity. Strict shape:
/// extra fields reject via the established unknown-field path.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg(test)]
struct ActiveGroupCommand {
    op: String,
}

/// Typed synchronous command codec (narrow).
///
/// Internally tagged on `op` with `deny_unknown_fields` for all nine
/// synchronous command ops: reconcile, update-gaps, active-group, move,
/// focus, resize, pointer-resize, toggle-float, and `send-to-workspace`.
/// Sync handlers parse
/// [`SyncCommand`] once in place after the existing dispatch boundaries
/// (validation, send dispatch, binding sync): the production `evaluate`
/// string-guards on the known op before dispatch, so missing/non-string/
/// unknown ops keep the exact `unknown-value` path without a typed parse.
/// A present-but-wrong op string surfaces as an
/// `unknown variant` decode error, which each handler maps back to the exact
/// legacy `*-op-invalid` snapshot the old `from_value` + op-check produced;
/// missing/non-string/extra-field errors keep `classify_parse_error`
/// behavior. Direct `evaluate_*` tests therefore pass unchanged.
/// `move`/`focus` rebuild the [`DirectedCommand`] plumbing value from the
/// typed variant for the untouched directional pair path (including the
/// `cross_output_transfer` default-true); `toggle-float` keeps its raw-window
/// floating probe before the typed parse, so malformed floats on untracked
/// floating windows still report `not-tiled`.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", deny_unknown_fields)]
enum SyncCommand {
    #[serde(rename = "reconcile")]
    Reconcile {},
    #[serde(rename = "update-gaps")]
    UpdateGaps {},
    #[serde(rename = "active-group")]
    ActiveGroup {},
    #[serde(rename = "move")]
    Move {
        window: String,
        direction: String,
        #[serde(default = "default_cross_output_transfer")]
        cross_output_transfer: bool,
    },
    #[serde(rename = "focus")]
    Focus {
        window: String,
        direction: String,
        #[serde(default = "default_cross_output_transfer")]
        cross_output_transfer: bool,
    },
    #[serde(rename = "resize")]
    Resize {
        window: String,
        direction: String,
        mode: String,
        press_index: u32,
    },
    #[serde(rename = "pointer-resize")]
    PointerResize {
        window: String,
        direction: String,
        boundary: i32,
        /// Corner second axis: both present for an atomic corner resize,
        /// both absent for an ordinary single-axis request. `deny_unknown_fields`
        /// is preserved; single-axis JSON is shape-identical to before.
        #[serde(default)]
        direction2: Option<String>,
        #[serde(default)]
        boundary2: Option<i32>,
    },
    #[serde(rename = "toggle-float")]
    ToggleFloat {
        window: String,
        #[serde(default)]
        float_rect: Option<RectDto>,
    },
    #[serde(rename = "send-to-workspace")]
    SendToWorkspace {
        window: String,
        target_output: String,
        target_workspace: String,
    },
}

/// Legacy op-mismatch mapping for converted handlers (see [`SyncCommand`]):
/// a tagged-decode `unknown variant` error means the carried op was present
/// but wrong, which the legacy struct parse + op-check reported as the
/// handler's `*-op-invalid` snapshot. All other decode errors keep
/// [`classify_parse_error`] behavior.
fn is_unknown_variant(error: &serde_json::Error) -> bool {
    error.to_string().contains("unknown variant")
}

/// Typed core boundary conversion.
///
/// Maps the already-decoded [`SyncCommand`] into
/// [`tiler_core::boundary::CoreCommand`] after the existing validation,
/// send-dispatch, and binding-sync boundaries. Total for the synchronous
/// routes: clones already-validated values, never validates, never re-parses.
/// Fallible wire vocabularies (direction/mode) cross opaquely so
/// handler-local precedence (`not-tiled`, `*-op-invalid`) is untouched.
/// Directional pair state comes from the validated
/// `directional_domains`/`directional_keys`; the workspace-send target stays
/// route-local (validated `WorkspaceInput`).
fn core_command_from_sync(command: &SyncCommand) -> Option<tiler_core::boundary::CoreCommand> {
    use tiler_core::boundary::CoreCommand;
    match command {
        SyncCommand::Reconcile {} => Some(CoreCommand::Reconcile),
        SyncCommand::UpdateGaps {} => Some(CoreCommand::UpdateGaps),
        SyncCommand::ActiveGroup {} => Some(CoreCommand::ActiveGroup),
        SyncCommand::Move {
            window,
            direction,
            cross_output_transfer,
        } => Some(CoreCommand::Move {
            window: window.clone(),
            direction: direction.clone(),
            cross_output_transfer: *cross_output_transfer,
        }),
        SyncCommand::Focus {
            window,
            direction,
            cross_output_transfer,
        } => Some(CoreCommand::Focus {
            window: window.clone(),
            direction: direction.clone(),
            cross_output_transfer: *cross_output_transfer,
        }),
        SyncCommand::Resize {
            window,
            direction,
            mode,
            press_index,
        } => Some(CoreCommand::Resize {
            window: window.clone(),
            direction: direction.clone(),
            mode: mode.clone(),
            press_index: *press_index,
        }),
        SyncCommand::PointerResize {
            window,
            direction,
            boundary,
            direction2,
            boundary2,
        } => Some(CoreCommand::PointerResize {
            window: window.clone(),
            direction: direction.clone(),
            boundary: *boundary,
            direction2: direction2.clone(),
            boundary2: *boundary2,
        }),
        SyncCommand::ToggleFloat { window, float_rect } => Some(CoreCommand::ToggleFloat {
            window: window.clone(),
            float_rect: float_rect.as_ref().map(|rect| Rect {
                x: rect.x,
                y: rect.y,
                w: rect.w,
                h: rect.h,
            }),
        }),
        SyncCommand::SendToWorkspace {
            window,
            target_output,
            target_workspace,
        } => Some(CoreCommand::SendToWorkspace {
            window: window.clone(),
            target_output: target_output.clone(),
            target_workspace: target_workspace.clone(),
        }),
    }
}

/// Total [`tiler_core::boundary::CoreEvent`] construction from validated
/// state plus an already-decoded command. See
/// [`core_command_from_sync`] for the precedence contract.
fn core_event(
    ctx: &Validated,
    command: &tiler_core::boundary::CoreCommand,
) -> tiler_core::boundary::CoreEvent {
    let directional = match (&ctx.directional_domains, &ctx.directional_keys) {
        (Some(domains), Some(keys)) => {
            Some(domains.iter().cloned().zip(keys.iter().cloned()).collect())
        }
        _ => None,
    };
    let directional_target_outer_gap = ctx
        .raw
        .get("domains")
        .and_then(serde_json::Value::as_array)
        .and_then(|entries| entries.get(1))
        .and_then(|entry| entry.get("outer_gap"))
        .and_then(serde_json::Value::as_i64)
        .filter(|gap| (0..=i64::from(GEOMETRY_MAX_GAP)).contains(gap))
        .map(|gap| gap as i32);
    tiler_core::boundary::CoreEvent {
        owner: ctx.owner.clone(),
        generation: ctx.generation.clone(),
        correlation: ctx.correlation.clone(),
        revision: ctx.request.revision,
        fingerprint: ctx.request.fingerprint,
        domain: ctx.domain.clone(),
        domain_key: ctx.domain_key.clone(),
        outer_gap: ctx.request.domain.outer_gap,
        focused_window: WindowId(ctx.request.focused_window.clone()),
        windows: ctx
            .request
            .windows
            .iter()
            .map(engine_window_from_dto)
            .collect(),
        directional,
        directional_target_outer_gap,
        target_domain: None,
        target_windows: ctx
            .request
            .target_windows
            .iter()
            .map(engine_window_from_dto)
            .collect(),
        command: command.clone(),
    }
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

/// Byte-exact `active-group` found serializer for the [`serialize_core_reply`]
/// choke point (single source).
fn serialize_active_group_found(
    ctx: &Validated,
    found: &tiler_core::boundary::ActiveGroupFound,
) -> String {
    let members: Vec<serde_json::Value> = found
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
    let geometry: Vec<GeometryReply> = found
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
            // Read-only group query: no hint/clamp context applies.
            overconstrained: None,
            client_clamped: None,
        })
        .collect();
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id: ctx.request.correlation_id.clone(),
        outcome: "active-group",
        kind: Some("active-group".to_owned()),
        message: None,
        base_revision: Some(found.base_revision),
        detail: Some(serde_json::json!({
            "kind": "active-group",
            "owner": ctx.owner.as_str(),
            "generation": ctx.generation.as_str(),
            "domain_output": ctx.domain_key.output.0,
            "domain_workspace": ctx.domain_key.workspace.0,
            "group": found.group.0,
            "focused_leaf": found.focused_leaf.0,
            "focused_window": found.focused_window.0,
            "members": members,
            "bounds": {"x": found.bounds.x, "y": found.bounds.y, "w": found.bounds.w, "h": found.bounds.h},
        })),
        desired_geometry: Some(geometry),
        desired_focus: Some(focus_reply(&ctx.domain_key, &found.focused_leaf)),
        float_geometry: None,
        preconditions: None,
        operation: None,
    })
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
    fn retained_float_reconciles_then_moved_reconcile_then_unfloat() {
        // Exact-float incident: p5 float removes the tile and retains
        // placement, later reconciles converge newcomers around the
        // exception, a native float move arrives as reconcile, unfloat
        // returns the exception to tiled, and a later post-removal
        // reconcile still plans. Membership stays canonical and
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
        // Two tiled reconciles seed the domain.
        for (correlation, focused, windows, command) in [
            (
                "float-seq-1",
                "win-1",
                vec![("win-1", 0, 0, 100, 80, false)],
                serde_json::json!({"op": "reconcile"}),
            ),
            (
                "float-seq-2",
                "win-2",
                vec![
                    ("win-1", 0, 0, 100, 80, false),
                    ("win-2", 200, 0, 100, 80, false),
                ],
                serde_json::json!({"op": "reconcile"}),
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
        // Float removes the tile, retains placement, survivors stay tiled.
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
        // Later reconciles converge newcomers around the retained exception.
        let admitted3 = parse_reply(&planner.evaluate(&float_request(
            "float-seq-4",
            "win-3",
            &[
                ("win-1", 0, 0, 100, 80, false),
                ("win-2", 240, 160, 720, 480, true),
                ("win-3", 400, 0, 100, 80, false),
            ],
            serde_json::json!({"op": "reconcile"}),
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
            serde_json::json!({"op": "reconcile"}),
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
        // Unfloat returns the exception to tiled.
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
        // A later post-removal observation still plans on the reunited topology.
        let removed = parse_reply(&planner.evaluate(&float_request(
            "float-seq-8",
            "win-1",
            &[
                ("win-1", 0, 0, 100, 80, false),
                ("win-2", 200, 0, 100, 80, false),
                ("win-3", 400, 0, 100, 80, false),
            ],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(removed["outcome"], "planned", "{removed}");
        assert_geometry_covers(&removed, &["win-1", "win-2", "win-3"]);
        // Stale/failure handling stays fail-closed for malformed shapes, but a
        // complete observation with changed membership converges first: the
        // missing member is removed and the reconcile projects the survivors.
        let partial = parse_reply(&planner.evaluate(&float_request(
            "float-seq-9",
            "win-1",
            &[
                ("win-1", 0, 0, 100, 80, false),
                ("win-2", 200, 0, 100, 80, false),
            ],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(partial["outcome"], "planned", "{partial}");
        assert_eq!(partial["detail"]["kind"], "reconcile", "{partial}");
        assert_geometry_covers(&partial, &["win-1", "win-2"]);
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

    /// Reconcile request with explicit domain bounds and per-window rects, so
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
    fn reconcile_fresh_portrait_output_splits_top_bottom_despite_landscape_rects() {
        // The split axis derives from the complete observation fit on the
        // portrait target: x intervals overlap (horizontal unsupported) while
        // y intervals stay sequential, so the vertical near-strip projects
        // top/bottom. Both observed rects stay landscape, which must not
        // select a left/right split on this portrait output. Product fit
        // policy is unchanged (fixed Horizontal tie-break when both axes
        // support; here only vertical supports).
        let request = custom_request(
            "admit-portrait-1",
            "win-1",
            (0, 0, 800, 1200),
            &[("win-1", 0, 0, 800, 300), ("win-2", 0, 300, 800, 300)],
            serde_json::json!({"op": "reconcile"}),
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
    fn reconcile_fresh_landscape_output_splits_left_right_despite_portrait_rects() {
        // Portrait observed rects must not select a
        // top/bottom split on a landscape output.
        let request = custom_request(
            "admit-landscape-1",
            "win-1",
            (0, 0, 1200, 800),
            &[("win-1", 0, 0, 300, 400), ("win-2", 300, 400, 300, 400)],
            serde_json::json!({"op": "reconcile"}),
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
    fn admit_reflows_an_out_of_bounds_member_after_planner_restart() {
        // Fresh complete reconcile is the admission route: an older
        // out-of-work-area member must not wedge a fresh domain.
        let command = serde_json::json!({"op": "reconcile"});
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
        // Surviving directional op with an unknown window id: the rejection
        // stays bounded and never echoes the raw native id.
        let bad = plan_request(
            "bounded-1",
            "win-1",
            &["win-1"],
            serde_json::json!({"op": "focus", "window": "evil-window-xyz", "direction": "left"}),
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

    /// Retained request variant carrying AR12 per-window size hints:
    /// `hints` maps window id to `(min_size, max_size)` as `(w, h)` pairs.
    /// Windows absent from the map carry no hint fields (legacy shape).
    type HintPair = (Option<(i32, i32)>, Option<(i32, i32)>);
    #[allow(clippy::too_many_arguments)]
    fn retained_request_with_hints(
        correlation: &str,
        owner: &str,
        generation: &str,
        focused: &str,
        windows: &[(&str, i32, i32, i32, i32)],
        hints: &std::collections::BTreeMap<&str, HintPair>,
        command: serde_json::Value,
    ) -> String {
        let entries: Vec<serde_json::Value> = windows
            .iter()
            .map(|(window, x, y, w, h)| {
                let mut entry = serde_json::json!({
                    "window": window,
                    "output": "out-1",
                    "workspace": "ws-1",
                    "rect": {"x": x, "y": y, "w": w, "h": h},
                });
                if let Some((min, max)) = hints.get(window) {
                    if let Some((mw, mh)) = min {
                        entry["min_size"] = serde_json::json!({"w": mw, "h": mh});
                    }
                    if let Some((mw, mh)) = max {
                        entry["max_size"] = serde_json::json!({"w": mw, "h": mh});
                    }
                }
                entry
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

    #[test]
    fn retained_equal_non_focused_rects_plan_after_initial() {
        // After the initial plan the domain topology is retained, so equal
        // non-focused rectangles no longer force `ambiguous-placement`.
        let mut planner = Planner::new();
        for (correlation, focused, windows, command) in [
            (
                "d4-equal-1",
                "win-1",
                vec![("win-1", 0, 0, 100, 80)],
                serde_json::json!({"op": "reconcile"}),
            ),
            (
                "d4-equal-2",
                "win-1",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "reconcile"}),
            ),
            (
                "d4-equal-3",
                "win-1",
                vec![
                    ("win-1", 0, 0, 100, 80),
                    ("win-2", 200, 0, 100, 80),
                    ("win-3", 400, 0, 100, 80),
                ],
                serde_json::json!({"op": "reconcile"}),
            ),
        ] {
            let request =
                retained_request(correlation, "owner-1", "gen-1", focused, &windows, command);
            let reply = parse_reply(&planner.evaluate(&request));
            assert_eq!(reply["outcome"], "planned", "{reply}");
        }
        assert_eq!(planner.retained_domains(), 1);
        // Two non-focused windows share an exact frame; retained state
        // proposes directly from membership, so it still plans.
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
            serde_json::json!({"op": "reconcile"}),
        );
        let retained = parse_reply(&planner.evaluate(&ambiguous));
        assert_eq!(retained["outcome"], "planned", "{retained}");
        assert_geometry_covers(&retained, &["win-1", "win-2", "win-3"]);
        assert_eq!(planner.retained_domains(), 1);
    }

    #[test]
    fn retained_generation_change_discards_and_rebuilds() {
        // Recovery: owner/generation change (adapter restart) discards all
        // retained domains and rebuilds once from the fresh observation.
        let mut planner = Planner::new();
        let first = retained_request(
            "d4-gen-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        assert_eq!(parse_reply(&planner.evaluate(&first))["outcome"], "planned");
        let second = retained_request(
            "d4-gen-2",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
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
            serde_json::json!({"op": "reconcile"}),
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
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        let follow_reply = parse_reply(&planner.evaluate(&follow));
        assert_eq!(follow_reply["outcome"], "planned", "{follow_reply}");
        assert_geometry_covers(&follow_reply, &["win-1"]);
    }

    #[test]
    fn retained_directional_rejects_tied_seed_without_retained_state() {
        // Fail-closed: a directional command with no retained topology that
        // cannot safely infer one (equal non-focused rects) rejects
        // `missing-seed-order` without retaining state; the next fresh
        // observation still recovers.
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
            serde_json::json!({"op": "move", "window": "win-1", "direction": "left"}),
        );
        let reply = parse_reply(&planner.evaluate(&ambiguous));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "snapshot-invalid", "{reply}");
        assert_eq!(reply["detail"], "missing-seed-order", "{reply}");
        assert_eq!(planner.retained_domains(), 0);
        let valid = retained_request(
            "d4-reject-2",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        // The next fresh observation still plans: no wedge, no retained base.
        let valid_reply = parse_reply(&planner.evaluate(&valid));
        assert_eq!(valid_reply["outcome"], "planned", "{valid_reply}");
        assert_geometry_covers(&valid_reply, &["win-1"]);
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
            serde_json::json!({"op": "reconcile"}),
        );
        assert_eq!(parse_reply(&planner.evaluate(&first))["outcome"], "planned");
        let second = retained_request(
            "d4-focus-sync-2",
            "owner-1",
            "gen-1",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
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
        // Retained `op=resize` must apply the COSMIC
        // `(10 + 2 + 2 * press_index).min(20)` cap for every u32.
        fn resize_shares(press_index: u32) -> serde_json::Value {
            let mut planner = Planner::new();
            for (correlation, focused, windows, command) in [
                (
                    "d6-resize-cap-1",
                    "win-1",
                    vec![("win-1", 0, 0, 100, 80)],
                    serde_json::json!({"op": "reconcile"}),
                ),
                (
                    "d6-resize-cap-2",
                    "win-2",
                    vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                    serde_json::json!({"op": "reconcile"}),
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
                serde_json::json!({"op": "reconcile"}),
            ),
            (
                "ptr-seed-2",
                "win-2",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "reconcile"}),
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
    fn retained_pointer_resize_corner_commits_both_axes_in_one_request() {
        // Nested retained layout from two horizontal reconciles plus one tall
        // reconcile: root H [win-1 | V[win-2, win-3]] over 1200x800 with the
        // shared horizontal edge at 600 and the shared vertical edge at
        // 400, focused on win-3. One corner request must plan and commit
        // both axes atomically: a single planned reply whose geometry moves
        // both shared edges, advancing exactly one revision.
        let mut planner = seed_pointer_planner();
        let seed3 = retained_request(
            "ptr-seed-3",
            "owner-1",
            "gen-1",
            "win-3",
            &[
                ("win-1", 0, 0, 100, 80),
                ("win-2", 200, 0, 100, 80),
                ("win-3", 400, 0, 100, 300),
            ],
            serde_json::json!({"op": "reconcile"}),
        );
        let seeded = parse_reply(&planner.evaluate(&seed3));
        assert_eq!(seeded["outcome"], "planned", "{seeded}");
        let request = retained_request(
            "ptr-corner-1",
            "owner-1",
            "gen-1",
            "win-3",
            &[
                ("win-1", 0, 0, 100, 80),
                ("win-2", 200, 0, 100, 80),
                ("win-3", 400, 0, 100, 300),
            ],
            serde_json::json!({
                "op": "pointer-resize",
                "window": "win-3",
                "direction": "left",
                "boundary": 590,
                "direction2": "up",
                "boundary2": 390,
            }),
        );
        let reply = parse_reply(&planner.evaluate(&request));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(reply["base_revision"], 3, "{reply}");
        assert_eq!(reply["detail"]["kind"], "pointer-resize", "{reply}");
        assert_eq!(reply["detail"]["capability"], "pointer-resize", "{reply}");
        assert_eq!(reply["detail"]["direction"], "left", "{reply}");
        assert_eq!(reply["detail"]["boundary"], 590, "{reply}");
        assert_eq!(reply["detail"]["direction2"], "up", "{reply}");
        assert_eq!(reply["detail"]["boundary2"], 390, "{reply}");
        assert!(reply["detail"]["target_group"].is_string(), "{reply}");
        assert!(reply["detail"]["target_group2"].is_string(), "{reply}");
        assert_ne!(
            reply["detail"]["target_group"], reply["detail"]["target_group2"],
            "corner spans two split groups: {reply}"
        );
        let rect_of = |window: &str| {
            reply["desired_geometry"]
                .as_array()
                .expect("geometry")
                .iter()
                .find(|g| g["window"] == window)
                .expect("member")
                .get("rect")
                .expect("rect")
                .clone()
        };
        assert_eq!(rect_of("win-3")["x"], 590, "{reply}");
        assert_eq!(rect_of("win-3")["y"], 390, "{reply}");
        assert_eq!(
            rect_of("win-1")["x"].as_i64().unwrap() + rect_of("win-1")["w"].as_i64().unwrap(),
            590,
            "{reply}"
        );
        assert_eq!(
            rect_of("win-2")["y"].as_i64().unwrap() + rect_of("win-2")["h"].as_i64().unwrap(),
            390,
            "{reply}"
        );
        assert_geometry_covers(&reply, &["win-1", "win-2", "win-3"]);
    }

    #[test]
    fn retained_pointer_resize_corner_refusals_are_exact() {
        let mut planner = seed_pointer_planner();
        let seed3 = retained_request(
            "ptr-seed-3",
            "owner-1",
            "gen-1",
            "win-3",
            &[
                ("win-1", 0, 0, 100, 80),
                ("win-2", 200, 0, 100, 80),
                ("win-3", 400, 0, 100, 300),
            ],
            serde_json::json!({"op": "reconcile"}),
        );
        assert_eq!(parse_reply(&planner.evaluate(&seed3))["outcome"], "planned");
        let mut corner = |correlation: &str, command: serde_json::Value| {
            parse_reply(&planner.evaluate(&retained_request(
                correlation,
                "owner-1",
                "gen-1",
                "win-3",
                &[
                    ("win-1", 0, 0, 100, 80),
                    ("win-2", 200, 0, 100, 80),
                    ("win-3", 400, 0, 100, 300),
                ],
                command,
            )))
        };
        // Same-axis pair cannot express a corner.
        let same_axis = corner(
            "ptr-corner-bad-1",
            serde_json::json!({
                "op": "pointer-resize",
                "window": "win-3",
                "direction": "left",
                "boundary": 590,
                "direction2": "right",
                "boundary2": 700,
            }),
        );
        assert_eq!(same_axis["outcome"], "rejected", "{same_axis}");
        assert_eq!(same_axis["kind"], "direction-invalid", "{same_axis}");
        // Half-present pair is an op shape violation.
        let half = corner(
            "ptr-corner-bad-2",
            serde_json::json!({
                "op": "pointer-resize",
                "window": "win-3",
                "direction": "left",
                "boundary": 590,
                "direction2": "up",
            }),
        );
        assert_eq!(half["outcome"], "rejected", "{half}");
        assert_eq!(half["kind"], "snapshot-invalid", "{half}");
        assert_eq!(half["detail"], "pointer-resize-op-invalid", "{half}");
        // Unparsable second direction binds the direction refusal.
        let bad_dir = corner(
            "ptr-corner-bad-3",
            serde_json::json!({
                "op": "pointer-resize",
                "window": "win-3",
                "direction": "left",
                "boundary": 590,
                "direction2": "sideways",
                "boundary2": 390,
            }),
        );
        assert_eq!(bad_dir["outcome"], "rejected", "{bad_dir}");
        assert_eq!(bad_dir["kind"], "direction-invalid", "{bad_dir}");
        // No-op on either grabbed axis refuses the whole corner as
        // unchanged with no plan and no pending: the committed edge still
        // sits at 600/400 afterwards.
        let noop = corner(
            "ptr-corner-bad-4",
            serde_json::json!({
                "op": "pointer-resize",
                "window": "win-3",
                "direction": "left",
                "boundary": 600,
                "direction2": "up",
                "boundary2": 390,
            }),
        );
        assert_eq!(noop["outcome"], "rejected", "{noop}");
        assert_eq!(noop["kind"], "unchanged", "{noop}");
        assert!(noop.get("desired_geometry").is_none(), "{noop}");
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
            serde_json::json!({"op": "move", "window": "win-1", "direction": "left"}),
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
    }

    #[test]
    fn many_observed_windows_plan_without_count_cap() {
        // No observed-window count cap: 70 windows in one horizontal strip
        // reconcile through the flat N-ary fit path on a fresh planner. Each
        // carried rectangle is valid, contained, and strictly sequential.
        let names: Vec<String> = (0..70).map(|i| format!("win-{i}")).collect();
        let windows: Vec<(&str, i32, i32, i32, i32)> = names
            .iter()
            .enumerate()
            .map(|(i, name)| (name.as_str(), i as i32 * 17, 0, 10, 800))
            .collect();
        let focused = names.last().expect("names").clone();
        let command = serde_json::json!({"op": "reconcile"});
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&retained_request(
            "many-win-1",
            "owner-1",
            "gen-1",
            &focused,
            &windows,
            command,
        )));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(
            reply["desired_geometry"].as_array().map(Vec::len),
            Some(70),
            "{reply}"
        );
    }
    #[test]
    fn command_and_construction_details_are_exact() {
        let cases: Vec<(&str, serde_json::Value)> = vec![
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
        ];
        for (index, (expected, command)) in cases.into_iter().enumerate() {
            let mut value = base_valid_value(&format!("snap-c-{index}"));
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
                "move-op-invalid",
                serde_json::json!({"op": "move", "window": "win-1", "direction": "left"}),
                Planner::evaluate_move_retained as fn(&mut Planner, &Validated) -> String,
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
    fn typed_sync_codec_active_group_wire_golden() {
        // Wire golden for the typed `SyncCommand` active-group: valid requests
        // plan byte-exact through the single typed parse + inner path,
        // malformed commands reject byte-exact with unchanged kinds. Retired
        // admit/remove wire goldens deleted; seeding uses complete-observation
        // reconcile. Literals recorded from the production `evaluate` path
        // (offline, no host mutation).
        // Seed a two-window domain through complete observations.
        let mut planner = Planner::new();
        for (cid, focused, windows) in [
            ("s1", "win-1", vec![("win-1", 0, 0, 100, 80)]),
            (
                "s2",
                "win-2",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            ),
        ] {
            let reply = parse_reply(&planner.evaluate(&retained_request(
                cid,
                "owner-1",
                "gen-1",
                focused,
                &windows,
                serde_json::json!({"op": "reconcile"}),
            )));
            assert_eq!(reply["outcome"], "planned", "{reply}");
        }
        let active_group = retained_request(
            "gold-ag-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "active-group"}),
        );
        assert_eq!(
            planner.evaluate(&active_group),
            "{\"v\":1,\"correlation_id\":\"gold-ag-1\",\"outcome\":\"active-group\",\"kind\":\"active-group\",\"base_revision\":2,\"detail\":{\"bounds\":{\"h\":800,\"w\":1200,\"x\":0,\"y\":0},\"domain_output\":\"out-1\",\"domain_workspace\":\"ws-1\",\"focused_leaf\":\"leaf-win-1\",\"focused_window\":\"win-1\",\"generation\":\"gen-1\",\"group\":\"grp-win-2-r1\",\"kind\":\"active-group\",\"members\":[{\"leaf\":\"leaf-win-1\",\"rect\":{\"h\":800,\"w\":600,\"x\":0,\"y\":0},\"window\":\"win-1\"},{\"leaf\":\"leaf-win-2\",\"rect\":{\"h\":800,\"w\":600,\"x\":600,\"y\":0},\"window\":\"win-2\"}],\"owner\":\"owner-1\"},\"desired_geometry\":[{\"window\":\"win-1\",\"leaf\":\"leaf-win-1\",\"output\":\"out-1\",\"workspace\":\"ws-1\",\"rect\":{\"x\":0,\"y\":0,\"w\":600,\"h\":800}},{\"window\":\"win-2\",\"leaf\":\"leaf-win-2\",\"output\":\"out-1\",\"workspace\":\"ws-1\",\"rect\":{\"x\":600,\"y\":0,\"w\":600,\"h\":800}}],\"desired_focus\":{\"domain_output\":\"out-1\",\"domain_workspace\":\"ws-1\",\"leaf\":\"leaf-win-1\"}}",
        );
        let active_group_extra = retained_request(
            "gold-ag-2",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "active-group", "bogus": 1}),
        );
        assert_eq!(
            planner.evaluate(&active_group_extra),
            "{\"v\":1,\"correlation_id\":\"gold-ag-2\",\"outcome\":\"rejected\",\"kind\":\"unknown-field\",\"message\":\"request contains an unknown field\"}",
        );
    }
    #[test]
    fn typed_sync_codec_covers_all_nine_ops_total() {
        // Fence proof for the boundary conversion: all nine synchronous wire
        // ops decode once via `SyncCommand`, then convert into `CoreCommand`
        // with the identical `op` token. Fallible vocabularies
        // (direction/mode) cross opaquely. The eight retired wire ops
        // (ack/verify/status/cancel on both routes) no longer decode.
        let commands = [
            serde_json::json!({"op": "reconcile"}),
            serde_json::json!({"op": "update-gaps"}),
            serde_json::json!({"op": "active-group"}),
            serde_json::json!({"op": "move", "window": "win-1", "direction": "left"}),
            serde_json::json!({"op": "focus", "window": "win-1", "direction": "left"}),
            serde_json::json!({"op": "resize", "window": "win-1", "direction": "left", "mode": "inwards", "press_index": 0}),
            serde_json::json!({"op": "pointer-resize", "window": "win-1", "direction": "left", "boundary": 10}),
            serde_json::json!({"op": "toggle-float", "window": "win-1"}),
            serde_json::json!({"op": "send-to-workspace", "window": "win-1", "target_output": "out-1", "target_workspace": "ws-2"}),
        ];
        assert_eq!(commands.len(), 9);
        let mut ops = std::collections::HashSet::new();
        for command in &commands {
            let decoded: SyncCommand =
                serde_json::from_value(command.clone()).expect("wire op decodes");
            let converted = core_command_from_sync(&decoded).expect("sync op converts");
            let expected = command.get("op").and_then(|op| op.as_str()).expect("op");
            assert_eq!(converted.op(), expected);
            ops.insert(converted.op());
        }
        assert_eq!(ops.len(), 9);
        // Opaque crossing: an unknown direction string converts without
        // validation; handlers own precedence.
        let decoded: SyncCommand = serde_json::from_value(
            serde_json::json!({"op": "move", "window": "win-1", "direction": "sideways"}),
        )
        .expect("decodes");
        assert!(matches!(
            core_command_from_sync(&decoded).expect("sync op converts"),
            tiler_core::boundary::CoreCommand::Move { direction, .. } if direction == "sideways"
        ));
        // Retired wire ops no longer decode as sync commands.
        for retired in [
            serde_json::json!({"op": "send-to-workspace-ack", "ack_outcome": "accepted"}),
            serde_json::json!({"op": "send-to-workspace-verify", "verified": true, "preconditions": [], "operation": {}}),
            serde_json::json!({"op": "send-to-workspace-status"}),
            serde_json::json!({"op": "send-to-workspace-cancel", "zero_dispatch": false}),
            serde_json::json!({"op": "directional-move-ack", "ack_outcome": "accepted"}),
            serde_json::json!({"op": "directional-move-verify", "verified": true, "preconditions": [], "operation": {}}),
            serde_json::json!({"op": "directional-move-status"}),
            serde_json::json!({"op": "directional-move-cancel", "zero_dispatch": false}),
        ] {
            assert!(
                serde_json::from_value::<SyncCommand>(retired).is_err(),
                "retired op must not decode"
            );
        }
    }

    #[test]
    fn retired_lifecycle_commands_refuse_without_mutation() {
        let mut planner = Planner::new();
        for command in [
            serde_json::json!({"op": "admit", "window": "win-1", "output": "out-1", "workspace": "ws-1"}),
            serde_json::json!({"op": "remove", "window": "win-1"}),
            serde_json::json!({"op": "send-to-workspace-ack", "ack_outcome": "accepted"}),
            serde_json::json!({"op": "send-to-workspace-verify", "verified": true, "preconditions": [], "operation": {}}),
            serde_json::json!({"op": "send-to-workspace-status"}),
            serde_json::json!({"op": "send-to-workspace-cancel", "zero_dispatch": false}),
            serde_json::json!({"op": "directional-move-ack", "ack_outcome": "accepted"}),
            serde_json::json!({"op": "directional-move-verify", "verified": true, "preconditions": [], "operation": {}}),
            serde_json::json!({"op": "directional-move-status"}),
            serde_json::json!({"op": "directional-move-cancel", "zero_dispatch": false}),
        ] {
            let reply = parse_reply(&planner.evaluate(&retained_request(
                "retired-wire-1",
                "owner-1",
                "gen-1",
                "win-1",
                &[("win-1", 0, 0, 100, 80)],
                command,
            )));
            assert_eq!(reply["outcome"], "rejected", "{reply}");
            assert_eq!(reply["kind"], "unknown-value", "{reply}");
            assert_eq!(planner.retained_domains(), 0);
        }
    }

    #[test]
    fn core_reply_choke_point_matches_legacy_constructors_byte_exact() {
        // Proof that `serialize_core_reply` is a byte-exact funnel for the
        // surviving `CoreReply` shapes: each arm must equal its legacy
        // constructor. Production-real arms (Projection, fresh Tiled
        // admission, ActiveGroup/NoGroup) are additionally covered by wire
        // goldens through `evaluate`; the remaining arms pin bytes here
        // until their routes migrate.
        use tiler_core::boundary::{
            CoreReply, NoGroupReason, ProjectionKind, ProjectionPlan, TiledKind, TiledPlan,
        };
        use tiler_core::contract::DivergenceKind;
        let request = retained_request(
            "core-reply-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        let ctx = validate_request(&request).expect("fixture validates");
        assert_eq!(
            serialize_core_reply(
                &ctx,
                &CoreReply::Rejected {
                    kind: "unknown-value",
                    message: MSG_UNKNOWN_VALUE,
                }
            ),
            rejected(
                "core-reply-1".to_owned(),
                "unknown-value",
                MSG_UNKNOWN_VALUE
            ),
        );
        assert_eq!(
            serialize_core_reply(
                &ctx,
                &CoreReply::SnapshotInvalid {
                    message: MSG_OBSERVATION,
                    detail: "focused-not-observed",
                }
            ),
            snapshot_invalid(
                "core-reply-1".to_owned(),
                MSG_OBSERVATION,
                "focused-not-observed",
            ),
        );
        assert_eq!(
            serialize_core_reply(&ctx, &CoreReply::Diverged(DivergenceKind::OwnerMismatch)),
            diverged_reply("core-reply-1", DivergenceKind::OwnerMismatch),
        );
        let projection = ProjectionPlan {
            base_revision: 2,
            kind: ProjectionKind::Reconcile,
            geometry: Vec::new(),
            focus_domain: None,
            focus_leaf: None,
        };
        assert_eq!(
            serialize_core_reply(&ctx, &CoreReply::Projection(projection.clone())),
            planned_projection_reply("core-reply-1", &projection),
        );
        let tiled = TiledPlan {
            base_revision: 2,
            policy_version: 1,
            kind: TiledKind::Admit,
            geometry: Vec::new(),
            focus_domain: None,
            focus_leaf: None,
            float_window: None,
            float_rect: None,
        };
        assert_eq!(
            serialize_core_reply(&ctx, &CoreReply::Tiled(tiled.clone())),
            planned_tiled_reply("core-reply-1", &tiled),
        );
        assert_eq!(
            serialize_core_reply(
                &ctx,
                &CoreReply::NoGroup {
                    base_revision: None,
                    reason: NoGroupReason::NoSession,
                }
            ),
            no_group_reply(&ctx, None, "no-session"),
        );
    }
    #[test]
    fn sync_family_choke_point_matches_legacy_shapes_byte_exact() {
        // Byte pins for the migrated sync family (move local/cross, focus
        // local/cross, keyboard/pointer resize, toggle-float): literals
        // recorded from the typed serializers, with key order and tokens
        // verified against the replaced legacy constructors. The matching
        // production goldens (`typed_sync_codec_move_focus_resize_float_wire_golden`
        // and friends) prove the same bytes flow end to end.
        use tiler_core::boundary::{
            CoreReply, FocusPlanReply, MoveCrossView, MovePlanReply, ResizePlanReply, TiledKind,
            TiledPlan,
        };
        use tiler_core::contract::{FocusOperation, ResizeMode, ResizeOperation};
        use tiler_core::directional::{Capability, CrossOutputTarget, Direction, Rule};
        let request = retained_request(
            "core-sync-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        let ctx = validate_request(&request).expect("fixture validates");
        let focus_leaf = NodeId::from("leaf-1");
        let move_local = MovePlanReply {
            base_revision: 2,
            rule: Rule::R2a,
            capability: Capability::SwapNeighbor,
            direction: Direction::Right,
            geometry: Vec::new(),
            focus_domain: ctx.domain_key.clone(),
            focus_leaf: focus_leaf.clone(),
            cross: None,
        };
        assert_eq!(
            serialize_core_reply(&ctx, &CoreReply::MoveDirectional(move_local)),
            "{\"v\":1,\"correlation_id\":\"core-sync-1\",\"outcome\":\"planned\",\"base_revision\":2,\"detail\":{\"capability\":\"SwapNeighbor\",\"direction\":\"right\",\"kind\":\"move\",\"rule\":\"R2a\"},\"desired_geometry\":[],\"desired_focus\":{\"domain_output\":\"out-1\",\"domain_workspace\":\"ws-1\",\"leaf\":\"leaf-1\"}}",
        );
        let move_cross = MovePlanReply {
            base_revision: 2,
            rule: Rule::R2a,
            capability: Capability::SwapNeighbor,
            direction: Direction::Right,
            geometry: Vec::new(),
            focus_domain: ctx.domain_key.clone(),
            focus_leaf: focus_leaf.clone(),
            cross: Some(MoveCrossView {
                rule: Rule::R4,
                intent_direction: Direction::Right,
                intent_window: WindowId::from("win-1"),
                intent_leaf: NodeId::from("leaf-1"),
                source_output: OutputId::from("out-1"),
                source_workspace: WorkspaceId::from("ws-1"),
                target_output: OutputId::from("out-2"),
                target_workspace: WorkspaceId::from("ws-1"),
                source_root_child_index: 1,
                target: CrossOutputTarget::Occupied,
                preconditions: Vec::new(),
            }),
        };
        assert_eq!(
            serialize_core_reply(&ctx, &CoreReply::MoveDirectional(move_cross)),
            "{\"v\":1,\"correlation_id\":\"core-sync-1\",\"outcome\":\"planned\",\"base_revision\":2,\"detail\":{\"capability\":\"SwapNeighbor\",\"direction\":\"right\",\"kind\":\"move\",\"rule\":\"R2a\"},\"desired_geometry\":[],\"desired_focus\":{\"domain_output\":\"out-1\",\"domain_workspace\":\"ws-1\",\"leaf\":\"leaf-1\"},\"preconditions\":[],\"operation\":{\"capability\":\"SwapNeighbor\",\"direction\":\"right\",\"leaf\":\"leaf-1\",\"op\":\"move\",\"rule\":\"R4\",\"source_output\":\"out-1\",\"source_root_child_index\":1,\"source_workspace\":\"ws-1\",\"target\":\"occupied\",\"target_output\":\"out-2\",\"target_workspace\":\"ws-1\",\"window\":\"win-1\"}}",
        );
        let focus_local = FocusPlanReply {
            base_revision: 2,
            direction: Direction::Right,
            to_window: WindowId::from("win-2"),
            geometry: Vec::new(),
            focus_domain: ctx.domain_key.clone(),
            focus_leaf: focus_leaf.clone(),
            cross_operation: None,
        };
        assert_eq!(
            serialize_core_reply(&ctx, &CoreReply::FocusDirectional(focus_local)),
            "{\"v\":1,\"correlation_id\":\"core-sync-1\",\"outcome\":\"planned\",\"base_revision\":2,\"detail\":{\"capability\":\"directional-focus\",\"direction\":\"right\",\"kind\":\"focus\",\"to_window\":\"win-2\"},\"desired_geometry\":[],\"desired_focus\":{\"domain_output\":\"out-1\",\"domain_workspace\":\"ws-1\",\"leaf\":\"leaf-1\"}}",
        );
        let focus_cross = FocusPlanReply {
            base_revision: 2,
            direction: Direction::Right,
            to_window: WindowId::from("win-2"),
            geometry: Vec::new(),
            focus_domain: ctx.domain_key.clone(),
            focus_leaf: focus_leaf.clone(),
            cross_operation: Some(FocusOperation {
                domain_output: OutputId::from("out-2"),
                domain_workspace: WorkspaceId::from("ws-1"),
                from_leaf: NodeId::from("a"),
                to_leaf: NodeId::from("b"),
                from_window: WindowId::from("win-1"),
                to_window: WindowId::from("win-2"),
                direction: Direction::Right,
                route: vec![NodeId::from("a"), NodeId::from("b")],
                cross_source_output: Some(OutputId::from("out-1")),
                cross_source_workspace: Some(WorkspaceId::from("ws-1")),
            }),
        };
        let cross_text = serialize_core_reply(&ctx, &CoreReply::FocusDirectional(focus_cross));
        let cross: serde_json::Value = serde_json::from_str(&cross_text).expect("serializes");
        assert_eq!(cross["outcome"], "planned");
        assert_eq!(
            cross["detail"],
            serde_json::json!({"capability": "directional-focus", "cross_output": true, "direction": "right", "kind": "focus", "to_window": "win-2"}),
        );
        assert_eq!(
            cross["operation"],
            serde_json::json!({"op": "focus", "domain_output": "out-2", "domain_workspace": "ws-1", "from_leaf": "a", "to_leaf": "b", "from_window": "win-1", "to_window": "win-2", "direction": "right", "route": ["a", "b"], "cross_source_output": "out-1", "cross_source_workspace": "ws-1"}),
        );
        let resize_op = ResizeOperation {
            domain_output: OutputId::from("out-1"),
            domain_workspace: WorkspaceId::from("ws-1"),
            focused_leaf: NodeId::from("a"),
            focused_window: WindowId::from("win-1"),
            direction: Direction::Right,
            mode: ResizeMode::Outwards,
            target_group: NodeId::from("grp"),
            focused_child: NodeId::from("a"),
            neighbor_child: NodeId::from("b"),
            focused_index: 0,
            neighbor_index: 1,
            old_shares: vec![1, 1],
            new_shares: vec![611, 587],
        };
        let resize = ResizePlanReply {
            base_revision: 2,
            direction: Direction::Right,
            mode: Some(ResizeMode::Outwards),
            boundary: None,
            operation: resize_op.clone(),
            secondary: None,
            geometry: Vec::new(),
            focus_domain: ctx.domain_key.clone(),
            focus_leaf: focus_leaf.clone(),
        };
        assert_eq!(
            serialize_core_reply(&ctx, &CoreReply::Resize(resize)),
            "{\"v\":1,\"correlation_id\":\"core-sync-1\",\"outcome\":\"planned\",\"base_revision\":2,\"detail\":{\"capability\":\"keyboard-resize\",\"direction\":\"right\",\"focused_index\":0,\"kind\":\"resize\",\"mode\":\"outwards\",\"neighbor_index\":1,\"new_shares\":[611,587],\"old_shares\":[1,1],\"target_group\":\"grp\"},\"desired_geometry\":[],\"desired_focus\":{\"domain_output\":\"out-1\",\"domain_workspace\":\"ws-1\",\"leaf\":\"leaf-1\"}}",
        );
        let pointer = ResizePlanReply {
            base_revision: 2,
            direction: Direction::Right,
            mode: None,
            boundary: Some(120),
            operation: resize_op,
            secondary: None,
            geometry: Vec::new(),
            focus_domain: ctx.domain_key.clone(),
            focus_leaf: focus_leaf.clone(),
        };
        assert_eq!(
            serialize_core_reply(&ctx, &CoreReply::Resize(pointer)),
            "{\"v\":1,\"correlation_id\":\"core-sync-1\",\"outcome\":\"planned\",\"base_revision\":2,\"detail\":{\"boundary\":120,\"capability\":\"pointer-resize\",\"direction\":\"right\",\"focused_index\":0,\"kind\":\"pointer-resize\",\"neighbor_index\":1,\"new_shares\":[611,587],\"old_shares\":[1,1],\"target_group\":\"grp\"},\"desired_geometry\":[],\"desired_focus\":{\"domain_output\":\"out-1\",\"domain_workspace\":\"ws-1\",\"leaf\":\"leaf-1\"}}",
        );
        let float_tiled = TiledPlan {
            base_revision: 2,
            policy_version: 1,
            kind: TiledKind::ToggleFloat,
            geometry: Vec::new(),
            focus_domain: None,
            focus_leaf: None,
            float_window: Some(WindowId::from("win-1")),
            float_rect: Some(Rect {
                x: 240,
                y: 160,
                w: 720,
                h: 480,
            }),
        };
        assert_eq!(
            serialize_core_reply(&ctx, &CoreReply::Tiled(float_tiled)),
            "{\"v\":1,\"correlation_id\":\"core-sync-1\",\"outcome\":\"planned\",\"base_revision\":2,\"detail\":{\"capability\":\"intentional-float\",\"kind\":\"toggle-float\",\"policy_version\":1},\"desired_geometry\":[],\"float_geometry\":{\"window\":\"win-1\",\"rect\":{\"x\":240,\"y\":160,\"w\":720,\"h\":480}}}",
        );
    }
    #[test]
    fn typed_sync_codec_move_focus_resize_float_wire_golden() {
        // Wire golden for the tagged `SyncCommand` conversion of
        // move/focus/resize/pointer-resize/toggle-float: valid requests reply
        // byte-exact through the in-place typed parse, malformed commands
        // reject byte-exact with unchanged kinds. Literals recorded from the
        // production `evaluate` path before the switch (offline).
        // Explicit `cross_output_transfer: false` refuses the local swap as
        // `planner-noop` while the omitted (default-true) form plans: pins
        // the preserved default. Each group below runs on a freshly seeded
        // two-window planner so committed plans cannot bleed across goldens.
        let seed = || {
            let mut planner = Planner::new();
            for (cid, focused, windows, command) in [
                (
                    "s1",
                    "win-1",
                    vec![("win-1", 0, 0, 100, 80)],
                    serde_json::json!({"op": "reconcile"}),
                ),
                (
                    "s2",
                    "win-2",
                    vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                    serde_json::json!({"op": "reconcile"}),
                ),
            ] {
                let reply = parse_reply(&planner.evaluate(&retained_request(
                    cid, "owner-1", "gen-1", focused, &windows, command,
                )));
                assert_eq!(reply["outcome"], "planned", "{reply}");
            }
            planner
        };
        let mut planner = seed();
        let two = vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)];
        let request = retained_request(
            "gold-move-1",
            "owner-1",
            "gen-1",
            "win-1",
            &two,
            serde_json::json!({"op": "move", "window": "win-1", "direction": "right"}),
        );
        assert_eq!(
            planner.evaluate(&request),
            "{\"v\":1,\"correlation_id\":\"gold-move-1\",\"outcome\":\"planned\",\"base_revision\":2,\"detail\":{\"capability\":\"SwapNeighbor\",\"direction\":\"right\",\"kind\":\"move\",\"rule\":\"R2a\"},\"desired_geometry\":[{\"window\":\"win-1\",\"leaf\":\"leaf-win-1\",\"output\":\"out-1\",\"workspace\":\"ws-1\",\"rect\":{\"x\":600,\"y\":0,\"w\":600,\"h\":800}},{\"window\":\"win-2\",\"leaf\":\"leaf-win-2\",\"output\":\"out-1\",\"workspace\":\"ws-1\",\"rect\":{\"x\":0,\"y\":0,\"w\":600,\"h\":800}}],\"desired_focus\":{\"domain_output\":\"out-1\",\"domain_workspace\":\"ws-1\",\"leaf\":\"leaf-win-1\"}}",
        );
        let no_transfer = retained_request(
            "gold-move-2",
            "owner-1",
            "gen-1",
            "win-1",
            &two,
            serde_json::json!({"op": "move", "window": "win-1", "direction": "right", "cross_output_transfer": false}),
        );
        assert_eq!(
            planner.evaluate(&no_transfer),
            "{\"v\":1,\"correlation_id\":\"gold-move-2\",\"outcome\":\"rejected\",\"kind\":\"planner-noop\",\"message\":\"planner reports no movement\"}",
        );
        let move_extra = retained_request(
            "gold-move-3",
            "owner-1",
            "gen-1",
            "win-1",
            &two,
            serde_json::json!({"op": "move", "window": "win-1", "direction": "right", "bogus": 1}),
        );
        assert_eq!(
            planner.evaluate(&move_extra),
            "{\"v\":1,\"correlation_id\":\"gold-move-3\",\"outcome\":\"rejected\",\"kind\":\"unknown-field\",\"message\":\"request contains an unknown field\"}",
        );
        planner = seed();
        let focus = retained_request(
            "gold-focus-1",
            "owner-1",
            "gen-1",
            "win-1",
            &two,
            serde_json::json!({"op": "focus", "window": "win-1", "direction": "right"}),
        );
        assert_eq!(
            planner.evaluate(&focus),
            "{\"v\":1,\"correlation_id\":\"gold-focus-1\",\"outcome\":\"planned\",\"base_revision\":2,\"detail\":{\"capability\":\"directional-focus\",\"direction\":\"right\",\"kind\":\"focus\",\"to_window\":\"win-2\"},\"desired_geometry\":[{\"window\":\"win-1\",\"leaf\":\"leaf-win-1\",\"output\":\"out-1\",\"workspace\":\"ws-1\",\"rect\":{\"x\":0,\"y\":0,\"w\":600,\"h\":800}},{\"window\":\"win-2\",\"leaf\":\"leaf-win-2\",\"output\":\"out-1\",\"workspace\":\"ws-1\",\"rect\":{\"x\":600,\"y\":0,\"w\":600,\"h\":800}}],\"desired_focus\":{\"domain_output\":\"out-1\",\"domain_workspace\":\"ws-1\",\"leaf\":\"leaf-win-2\"}}",
        );
        let focus_missing = retained_request(
            "gold-focus-2",
            "owner-1",
            "gen-1",
            "win-1",
            &two,
            serde_json::json!({"op": "focus", "window": "win-2"}),
        );
        assert_eq!(
            planner.evaluate(&focus_missing),
            "{\"v\":1,\"correlation_id\":\"gold-focus-2\",\"outcome\":\"rejected\",\"kind\":\"request-malformed\",\"message\":\"request is malformed\"}",
        );
        planner = seed();
        let resize = retained_request(
            "gold-resize-1",
            "owner-1",
            "gen-1",
            "win-1",
            &two,
            serde_json::json!({"op": "resize", "window": "win-1", "direction": "right", "mode": "outwards", "press_index": 0}),
        );
        assert_eq!(
            planner.evaluate(&resize),
            "{\"v\":1,\"correlation_id\":\"gold-resize-1\",\"outcome\":\"planned\",\"base_revision\":2,\"detail\":{\"capability\":\"keyboard-resize\",\"direction\":\"right\",\"focused_index\":0,\"kind\":\"resize\",\"mode\":\"outwards\",\"neighbor_index\":1,\"new_shares\":[611,587],\"old_shares\":[1,1],\"target_group\":\"grp-win-2-r1\"},\"desired_geometry\":[{\"window\":\"win-1\",\"leaf\":\"leaf-win-1\",\"output\":\"out-1\",\"workspace\":\"ws-1\",\"rect\":{\"x\":0,\"y\":0,\"w\":612,\"h\":800}},{\"window\":\"win-2\",\"leaf\":\"leaf-win-2\",\"output\":\"out-1\",\"workspace\":\"ws-1\",\"rect\":{\"x\":612,\"y\":0,\"w\":588,\"h\":800}}],\"desired_focus\":{\"domain_output\":\"out-1\",\"domain_workspace\":\"ws-1\",\"leaf\":\"leaf-win-1\"}}",
        );
        let resize_extra = retained_request(
            "gold-resize-2",
            "owner-1",
            "gen-1",
            "win-1",
            &two,
            serde_json::json!({"op": "resize", "window": "win-1", "direction": "right", "mode": "outwards", "press_index": 0, "bogus": 1}),
        );
        assert_eq!(
            planner.evaluate(&resize_extra),
            "{\"v\":1,\"correlation_id\":\"gold-resize-2\",\"outcome\":\"rejected\",\"kind\":\"unknown-field\",\"message\":\"request contains an unknown field\"}",
        );
        planner = seed();
        let pointer = retained_request(
            "gold-ptr-1",
            "owner-1",
            "gen-1",
            "win-1",
            &two,
            serde_json::json!({"op": "pointer-resize", "window": "win-1", "direction": "right", "boundary": 550}),
        );
        assert_eq!(
            planner.evaluate(&pointer),
            "{\"v\":1,\"correlation_id\":\"gold-ptr-1\",\"outcome\":\"planned\",\"base_revision\":2,\"detail\":{\"boundary\":550,\"capability\":\"pointer-resize\",\"direction\":\"right\",\"focused_index\":0,\"kind\":\"pointer-resize\",\"neighbor_index\":1,\"new_shares\":[549,649],\"old_shares\":[1,1],\"target_group\":\"grp-win-2-r1\"},\"desired_geometry\":[{\"window\":\"win-1\",\"leaf\":\"leaf-win-1\",\"output\":\"out-1\",\"workspace\":\"ws-1\",\"rect\":{\"x\":0,\"y\":0,\"w\":550,\"h\":800}},{\"window\":\"win-2\",\"leaf\":\"leaf-win-2\",\"output\":\"out-1\",\"workspace\":\"ws-1\",\"rect\":{\"x\":550,\"y\":0,\"w\":650,\"h\":800}}],\"desired_focus\":{\"domain_output\":\"out-1\",\"domain_workspace\":\"ws-1\",\"leaf\":\"leaf-win-1\"}}",
        );
        let pointer_missing = retained_request(
            "gold-ptr-2",
            "owner-1",
            "gen-1",
            "win-1",
            &two,
            serde_json::json!({"op": "pointer-resize", "window": "win-1", "direction": "right"}),
        );
        assert_eq!(
            planner.evaluate(&pointer_missing),
            "{\"v\":1,\"correlation_id\":\"gold-ptr-2\",\"outcome\":\"rejected\",\"kind\":\"request-malformed\",\"message\":\"request is malformed\"}",
        );
        planner = seed();
        let float = retained_request(
            "gold-float-1",
            "owner-1",
            "gen-1",
            "win-1",
            &two,
            serde_json::json!({"op": "toggle-float", "window": "win-1"}),
        );
        assert_eq!(
            planner.evaluate(&float),
            "{\"v\":1,\"correlation_id\":\"gold-float-1\",\"outcome\":\"planned\",\"base_revision\":2,\"detail\":{\"capability\":\"intentional-float\",\"kind\":\"toggle-float\",\"policy_version\":1},\"desired_geometry\":[{\"window\":\"win-2\",\"leaf\":\"leaf-win-2\",\"output\":\"out-1\",\"workspace\":\"ws-1\",\"rect\":{\"x\":0,\"y\":0,\"w\":1200,\"h\":800}}],\"desired_focus\":{\"domain_output\":\"out-1\",\"domain_workspace\":\"ws-1\",\"leaf\":\"leaf-win-2\"},\"float_geometry\":{\"window\":\"win-1\",\"rect\":{\"x\":240,\"y\":160,\"w\":720,\"h\":480}}}",
        );
        let float_extra = retained_request(
            "gold-float-2",
            "owner-1",
            "gen-1",
            "win-1",
            &two,
            serde_json::json!({"op": "toggle-float", "window": "win-1", "bogus": 1}),
        );
        assert_eq!(
            planner.evaluate(&float_extra),
            "{\"v\":1,\"correlation_id\":\"gold-float-2\",\"outcome\":\"rejected\",\"kind\":\"unknown-field\",\"message\":\"request contains an unknown field\"}",
        );
        // Probe-before-parse precedence: a malformed float naming an untracked
        // floating window still reports `not-tiled`, never `unknown-field`.
        let mut fresh = Planner::new();
        let mut floating_value: serde_json::Value = serde_json::from_str(&retained_request(
            "gold-float-3",
            "owner-1",
            "gen-1",
            "win-1",
            &two,
            serde_json::json!({"op": "toggle-float", "window": "win-1", "bogus": 1}),
        ))
        .expect("request JSON");
        floating_value["windows"][0]["floating"] = serde_json::Value::Bool(true);
        assert_eq!(
            fresh.evaluate(&floating_value.to_string()),
            "{\"v\":1,\"correlation_id\":\"gold-float-3\",\"outcome\":\"rejected\",\"kind\":\"not-tiled\",\"message\":\"focused window is not a tiled window\"}",
        );
    }
    #[test]
    fn untracked_floating_toggle_float_rect_precedence_and_fresh_unfloat() {
        // Probe precedence covers an invalid `float_rect` too: an untracked
        // floating window on an absent session reports `not-tiled`, never
        // `float-rect-invalid`. A valid rect (or none) reaches the Engine,
        // which converges the fresh floating observation into an exception
        // and unfloats it into the current domain.
        let one = vec![("win-1", 0, 0, 100, 80)];
        let mut bad_rect: serde_json::Value = serde_json::from_str(&retained_request(
            "gold-float-rect-1",
            "owner-1",
            "gen-1",
            "win-1",
            &one,
            serde_json::json!({"op": "toggle-float", "window": "win-1", "float_rect": {"x": 0, "y": 0, "w": 0, "h": 80}}),
        ))
        .expect("request JSON");
        bad_rect["windows"][0]["floating"] = serde_json::Value::Bool(true);
        assert_eq!(
            Planner::new().evaluate(&bad_rect.to_string()),
            "{\"v\":1,\"correlation_id\":\"gold-float-rect-1\",\"outcome\":\"rejected\",\"kind\":\"not-tiled\",\"message\":\"focused window is not a tiled window\"}",
        );
        for (correlation, command) in [
            (
                "gold-float-rect-2",
                serde_json::json!({"op": "toggle-float", "window": "win-1"}),
            ),
            (
                "gold-float-rect-3",
                serde_json::json!({"op": "toggle-float", "window": "win-1", "float_rect": {"x": 240, "y": 160, "w": 720, "h": 480}}),
            ),
        ] {
            let mut request: serde_json::Value = serde_json::from_str(&retained_request(
                correlation,
                "owner-1",
                "gen-1",
                "win-1",
                &one,
                command,
            ))
            .expect("request JSON");
            request["windows"][0]["floating"] = serde_json::Value::Bool(true);
            let reply = parse_reply(&Planner::new().evaluate(&request.to_string()));
            assert_eq!(reply["outcome"], "planned", "{reply}");
            assert_eq!(reply["float_geometry"], serde_json::Value::Null, "{reply}");
            let geometry = reply["desired_geometry"].as_array().expect("geometry");
            assert_eq!(geometry.len(), 1, "{reply}");
            assert_eq!(geometry[0]["window"], "win-1", "{reply}");
            assert_eq!(geometry[0]["workspace"], "ws-1", "{reply}");
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
        assert_eq!(PLANNER_SNAPSHOT_DETAILS.len(), 49, "closed registry size");
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
                serde_json::json!({"op": "reconcile"}),
            ),
            (
                "rec-seed-2",
                "win-1",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "reconcile"}),
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
    fn reconcile_fresh_horizontal_fit_projects_exact_geometry() {
        // A fresh two-window strip reconciles through the flat-strip fit
        // without any admit derivation: equal shares project back with fit
        // leaves.
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&retained_request(
            "fresh-fit-rec",
            "owner-1",
            "gen-1",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
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
        assert_eq!(fit_leaves(&reply), vec!["fit-l0", "fit-l1"], "{reply}");
        assert_eq!(planner.retained_domains(), 1);
    }

    #[test]
    fn reconcile_fresh_fallback_seeds_deterministic_geometry() {
        // Overlapping carried rectangles decline fitting, so fresh reconcile
        // takes the deterministic spatial seed with no fit leaves.
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&retained_request(
            "fresh-seed-rec",
            "owner-1",
            "gen-1",
            "win-2",
            &[("win-1", 0, 0, 1200, 800), ("win-2", 0, 0, 1200, 800)],
            serde_json::json!({"op": "reconcile"}),
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
        assert!(
            !fit_leaves(&reply)
                .iter()
                .any(|leaf| leaf.starts_with("fit-l")),
            "{reply}"
        );
        assert_eq!(planner.retained_domains(), 1);
    }

    #[test]
    fn reconcile_fresh_mixed_converges_exception() {
        // Focused tiled newcomer plus a floating member: the tiled set
        // plans while the floating member converges as an exception.
        let mut value: serde_json::Value = serde_json::from_str(&retained_request(
            "fresh-mixed-rec",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        ))
        .expect("valid retained request");
        value["windows"][1]["floating"] = serde_json::json!(true);
        value["windows"][1]["fit_excluded"] = serde_json::json!(true);
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&value.to_string()));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_geometry_covers(&reply, &["win-1"]);
        assert_eq!(planner.retained_domains(), 1);
    }

    #[test]
    fn reconcile_fresh_all_floating_projects_empty() {
        let mut value: serde_json::Value = serde_json::from_str(&retained_request(
            "fresh-float-rec",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        ))
        .expect("valid retained request");
        for entry in value["windows"].as_array_mut().expect("windows") {
            entry["floating"] = serde_json::json!(true);
            entry["fit_excluded"] = serde_json::json!(true);
        }
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&value.to_string()));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(
            reply["desired_geometry"].as_array().map(Vec::len),
            Some(0),
            "{reply}"
        );
        // Floating exceptions retain the slot without tiled geometry.
        assert_eq!(planner.retained_domains(), 1);
    }

    #[test]
    fn reconcile_fresh_empty_projects_empty_without_session() {
        let mut value: serde_json::Value = serde_json::from_str(&retained_request(
            "fresh-empty-rec",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        ))
        .expect("valid retained request");
        value["windows"] = serde_json::json!([]);
        value["focused_window"] = serde_json::json!("");
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&value.to_string()));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(
            reply["desired_geometry"].as_array().map(Vec::len),
            Some(0),
            "{reply}"
        );
        assert_eq!(planner.retained_domains(), 0);
    }

    #[test]
    fn reconcile_fresh_relocation_uses_retained_source() {
        // Same-workspace displaced source relocates on a fresh reconcile
        // carrying the complete moved observation instead of seeding anew.
        let mut planner = seed_two_window_planner();
        let moved = retained_request_for_domain(
            "fresh-reloc-rec",
            "owner-1",
            "gen-1",
            "out-2",
            "ws-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        // Entries above are homed to out-1 by the helper; re-home the
        // complete observation to the target output for the moved domain.
        let mut value: serde_json::Value = serde_json::from_str(&moved).expect("valid request");
        for entry in value["windows"].as_array_mut().expect("windows") {
            entry["output"] = serde_json::json!("out-2");
        }
        let reply = parse_reply(&planner.evaluate(&value.to_string()));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-2"]);
    }

    #[test]
    fn update_gaps_exception_only_adopts_without_topology_error() {
        // Both members observed floating: convergence drops the tiled tree,
        // and update-gaps adopts the carried gaps while projecting empty
        // instead of `malformed-topology`.
        let mut planner = seed_two_window_planner();
        // Float win-2 first (win-1 still tiles), then both: convergence
        // adopts each exception while the tree drains to nothing.
        for (correlation, float_win_1) in [("gap-float-1", false), ("gap-float-2", true)] {
            let mut value: serde_json::Value = serde_json::from_str(&retained_request(
                correlation,
                "owner-1",
                "gen-1",
                "win-1",
                &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "reconcile"}),
            ))
            .expect("valid retained request");
            value["windows"][1]["floating"] = serde_json::json!(true);
            value["windows"][1]["fit_excluded"] = serde_json::json!(true);
            if float_win_1 {
                value["windows"][0]["floating"] = serde_json::json!(true);
                value["windows"][0]["fit_excluded"] = serde_json::json!(true);
            }
            let reply = parse_reply(&planner.evaluate(&value.to_string()));
            assert_eq!(reply["outcome"], "planned", "{reply}");
        }
        let mut gaps: serde_json::Value =
            serde_json::from_str(&retained_request_with_selected_gaps(
                "gap-exc-1",
                "owner-1",
                "gen-1",
                "win-1",
                &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "update-gaps"}),
            ))
            .expect("valid gaps request");
        for entry in gaps["windows"].as_array_mut().expect("windows") {
            entry["floating"] = serde_json::json!(true);
            entry["fit_excluded"] = serde_json::json!(true);
        }
        let reply = parse_reply(&planner.evaluate(&gaps.to_string()));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(
            reply["desired_geometry"].as_array().map(Vec::len),
            Some(0),
            "{reply}"
        );
        // The adopted gaps bind later fences: old gaps mismatch, new gaps plan.
        let stale = retained_request(
            "gap-exc-stale",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        let stale_reply = parse_reply(&planner.evaluate(&stale));
        assert_eq!(stale_reply["outcome"], "rejected", "{stale_reply}");
    }

    #[test]
    fn update_gaps_fresh_tiled_still_unknown_domain() {
        // update-gaps never seeds: a fresh tiled domain refuses so the
        // reconcile seed path owns it.
        let mut planner = Planner::new();
        let request = retained_request(
            "gap-fresh-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "update-gaps"}),
        );
        let reply = parse_reply(&planner.evaluate(&request));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "unknown-domain", "{reply}");
        assert_eq!(planner.retained_domains(), 0);
    }

    #[test]
    fn reconcile_retained_empty_reconcile_retires_slot() {
        // A retained domain whose complete observation is empty retires on
        // reconcile, freeing the slot for a later admission.
        let mut planner = seed_two_window_planner();
        let mut value: serde_json::Value = serde_json::from_str(&retained_request(
            "empty-retire-rec",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        ))
        .expect("valid retained request");
        value["windows"] = serde_json::json!([]);
        value["focused_window"] = serde_json::json!("");
        let reply = parse_reply(&planner.evaluate(&value.to_string()));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(
            reply["desired_geometry"].as_array().map(Vec::len),
            Some(0),
            "{reply}"
        );
        assert_eq!(planner.retained_domains(), 0);
    }

    #[test]
    fn reconcile_without_hints_carries_no_hint_flags() {
        let mut planner = seed_two_window_planner();
        let request = retained_request(
            "rec-flags-absent",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        let reply = parse_reply(&planner.evaluate(&request));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        for entry in reply["desired_geometry"]
            .as_array()
            .expect("planned geometry present")
        {
            assert!(entry.get("overconstrained").is_none(), "{reply}");
            assert!(entry.get("client_clamped").is_none(), "{reply}");
        }
    }

    #[test]
    fn reconcile_accepts_hinted_short_frame_as_client_clamped() {
        let mut planner = seed_two_window_planner();
        let baseline = retained_request(
            "rec-clamp-base",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        let baseline_reply = parse_reply(&planner.evaluate(&baseline));
        assert_eq!(baseline_reply["outcome"], "planned", "{baseline_reply}");
        let before = geometry_by_window(&baseline_reply);
        // Short frame against a REAL carried maximum: win-2 keeps position
        // but lands 56 short in height, exactly at its carried max, so the
        // observed size equals clamp(desired, min, max) and accepts. (This
        // is distinct from the logged Ghostty evidence, whose max is the
        // unbounded sentinel: that stays genuine drift.) Hints ride
        // alongside the legacy fingerprint (7): advisory hints never join
        // the fingerprint.
        let desired_h = before["win-2"].3;
        let clamped_h = desired_h - 56;
        let (x, y, w, _) = before["win-2"];
        let mut hints = std::collections::BTreeMap::new();
        hints.insert("win-2", (None, Some((w, clamped_h))));
        let clamped = retained_request_with_hints(
            "rec-clamp-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", x, y, w, clamped_h)],
            &hints,
            serde_json::json!({"op": "reconcile"}),
        );
        let reply = parse_reply(&planner.evaluate(&clamped));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        // Retained truth stands (leftover explained, shares untouched)...
        assert_eq!(geometry_by_window(&reply), before, "{reply}");
        // ...while the clamped window accepts: no rewrite, no drift/park.
        let by_window: std::collections::BTreeMap<String, &serde_json::Value> =
            reply["desired_geometry"]
                .as_array()
                .expect("planned geometry present")
                .iter()
                .map(|entry| (entry["window"].as_str().expect("window").to_owned(), entry))
                .collect();
        assert_eq!(
            by_window["win-2"].get("client_clamped"),
            Some(&serde_json::Value::Bool(true)),
            "{reply}"
        );
        assert!(
            by_window["win-2"].get("overconstrained").is_none(),
            "{reply}"
        );
        assert!(
            by_window["win-1"].get("client_clamped").is_none(),
            "{reply}"
        );
        assert!(
            by_window["win-1"].get("overconstrained").is_none(),
            "{reply}"
        );
        // No pending crosses the read-only reconcile: a follow-up command
        // still plans on the retained tree.
        let follow = retained_request(
            "rec-clamp-follow",
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
    fn reconcile_marks_unsatisfiable_minimums_overconstrained() {
        let mut planner = seed_two_window_planner();
        // Both windows demand 700 wide in a 1200 extent: unsatisfiable.
        let mut hints = std::collections::BTreeMap::new();
        hints.insert("win-1", (Some((700, 10)), None));
        hints.insert("win-2", (Some((700, 10)), None));
        let request = retained_request_with_hints(
            "rec-over-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            &hints,
            serde_json::json!({"op": "reconcile"}),
        );
        let reply = parse_reply(&planner.evaluate(&request));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        for entry in reply["desired_geometry"]
            .as_array()
            .expect("planned geometry present")
        {
            assert_eq!(
                entry.get("overconstrained"),
                Some(&serde_json::Value::Bool(true)),
                "{reply}"
            );
            assert!(entry.get("client_clamped").is_none(), "{reply}");
        }
    }

    #[test]
    fn reconcile_unhinted_drift_never_accepts() {
        let mut planner = seed_two_window_planner();
        let baseline = retained_request(
            "rec-nodrift-base",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        let baseline_reply = parse_reply(&planner.evaluate(&baseline));
        let before = geometry_by_window(&baseline_reply);
        // Same 56-short frame with no hints: drift, still fully reasserted.
        let (x, y, w, h) = before["win-2"];
        let drifted = retained_request(
            "rec-nodrift-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", x, y, w, h - 56)],
            serde_json::json!({"op": "reconcile"}),
        );
        let reply = parse_reply(&planner.evaluate(&drifted));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(geometry_by_window(&reply), before, "{reply}");
        for entry in reply["desired_geometry"]
            .as_array()
            .expect("planned geometry present")
        {
            assert!(entry.get("client_clamped").is_none(), "{reply}");
            assert!(entry.get("overconstrained").is_none(), "{reply}");
        }
    }

    #[test]
    fn reconcile_honors_satisfiable_minimum_from_observed_hints() {
        let mut planner = seed_two_window_planner();
        // A satisfiable observed minimum converges the newcomer through the
        // fresh complete observation; win-3 needs 400 wide.
        let mut hints = std::collections::BTreeMap::new();
        hints.insert("win-3", (Some((400, 10)), None));
        let request: serde_json::Value = serde_json::from_str(&retained_request_with_hints(
            "rec-hint-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[
                ("win-1", 0, 0, 100, 80),
                ("win-2", 200, 0, 100, 80),
                ("win-3", 400, 0, 100, 80),
            ],
            &hints,
            serde_json::json!({"op": "reconcile"}),
        ))
        .expect("valid request");
        // Converge through the normal path with the hinted observation.
        let reply = parse_reply(&planner.evaluate(&request.to_string()));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        let geometry = geometry_by_window(&reply);
        assert_eq!(geometry.len(), 3, "{reply}");
        let win3 = geometry["win-3"];
        assert!(win3.2 >= 400, "converged minimum honored: {reply}");
        for entry in reply["desired_geometry"]
            .as_array()
            .expect("planned geometry present")
        {
            assert!(entry.get("overconstrained").is_none(), "{reply}");
        }
    }

    #[test]
    fn hint_unknown_nested_field_rejects_fail_closed() {
        let mut planner = seed_two_window_planner();
        let mut request: serde_json::Value = serde_json::from_str(&retained_request(
            "rec-hint-bad",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        ))
        .expect("valid request");
        request["windows"][0]["min_size"] = serde_json::json!({"w": 10, "h": 10, "depth": 3});
        let reply = parse_reply(&planner.evaluate(&request.to_string()));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "unknown-field", "{reply}");
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
                serde_json::json!({"op": "reconcile"}),
            ),
            (
                "rec-gap-seed-2",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "reconcile"}),
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
                serde_json::json!({"op": "reconcile"}),
            ),
            (
                "rec-outer-seed-2",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "reconcile"}),
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
                serde_json::json!({"op": "reconcile"}),
            ),
            (
                "gap-seed-2",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "reconcile"}),
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
    fn update_gaps_converges_membership_change_then_projects() {
        let mut planner = seed_gap_planner();
        let baseline = parse_reply(&planner.evaluate(&reconcile_gaps_request("gap-part-1", 8, 8)));
        assert_eq!(baseline["outcome"], "planned", "{baseline}");
        assert_geometry_covers(&baseline, &["win-1", "win-2"]);

        // Complete-observation convergence
        // (docs/changes/archive/observation-convergence.md): the missing retained
        // member is removed before the ordinary gap update projects the
        // survivor with the new gaps. No `partial-observation` remains on
        // this path.
        let mut partial: serde_json::Value =
            serde_json::from_str(&update_gaps_request("gap-part-2", 16, 8)).expect("valid request");
        partial["windows"] = serde_json::json!([
            {"window": "win-1", "output": "out-1", "workspace": "ws-1",
             "rect": {"x": 0, "y": 0, "w": 100, "h": 80}},
        ]);
        let converged = parse_reply(&planner.evaluate(&partial.to_string()));
        assert_eq!(converged["outcome"], "planned", "{converged}");
        assert_eq!(converged["detail"]["kind"], "update-gaps", "{converged}");
        assert_geometry_covers(&converged, &["win-1"]);

        // The converged state is retained: an exact observation of the
        // survivor at the adopted gaps still plans.
        let mut exact: serde_json::Value =
            serde_json::from_str(&reconcile_gaps_request("gap-part-3", 16, 8))
                .expect("valid request");
        exact["windows"] = serde_json::json!([
            {"window": "win-1", "output": "out-1", "workspace": "ws-1",
             "rect": {"x": 0, "y": 0, "w": 100, "h": 80}},
        ]);
        let replanned = parse_reply(&planner.evaluate(&exact.to_string()));
        assert_eq!(replanned["outcome"], "planned", "{replanned}");
        assert_geometry_covers(&replanned, &["win-1"]);
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
        for (correlation, focused, windows) in [
            ("rec-nested-seed-1", "win-1", vec![("win-1", 0, 0, 100, 80)]),
            (
                "rec-nested-seed-2",
                "win-2",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            ),
            (
                "rec-nested-seed-3",
                "win-3",
                vec![
                    ("win-1", 0, 0, 100, 80),
                    ("win-2", 200, 0, 100, 80),
                    ("win-3", 400, 0, 100, 80),
                ],
            ),
        ] {
            let reply = parse_reply(&planner.evaluate(&retained_request_with_selected_gaps(
                correlation,
                "owner-1",
                "gen-1",
                focused,
                &windows,
                serde_json::json!({"op": "reconcile"}),
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
    fn reconcile_membership_change_converges_before_projecting() {
        // Complete-observation convergence (docs/changes/archive/observation-convergence.md):
        // a missing retained member is removed and an unexpected new normal
        // member is admitted through normal placement before the ordinary
        // reconcile projects the converged survivors. No single-reason
        // `partial-observation` remains on this path.
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
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(reply["detail"]["kind"], "reconcile", "{reply}");
        assert_geometry_covers(&reply, &["win-1", "win-3"]);
        assert_ne!(reply["kind"], "diverged", "{reply}");
        // Converged state is retained: the next complete observation of the
        // converged set still reconciles.
        assert_eq!(planner.retained_domains(), 1);
        let recover = retained_request(
            "rec-mismatch-2",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-3", 400, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        let recovered = parse_reply(&planner.evaluate(&recover));
        assert_eq!(recovered["outcome"], "planned", "{recovered}");
        assert_geometry_covers(&recovered, &["win-1", "win-3"]);
    }

    #[test]
    fn reconcile_converges_floating_skew_without_partial_observation() {
        // Retained tiled win-1 observed floating: convergence removes its
        // leaf, retains a floating exception, and the reconcile projects the
        // survivors without `partial-observation` or reset.
        let mut planner = seed_two_window_planner();
        let mut skewed: serde_json::Value = serde_json::from_str(&retained_request(
            "rec-float-1",
            "owner-1",
            "gen-1",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        ))
        .expect("valid request");
        skewed["windows"][0]["floating"] = serde_json::json!(true);
        let reply = parse_reply(&planner.evaluate(&skewed.to_string()));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(reply["detail"]["kind"], "reconcile", "{reply}");
        assert_geometry_covers(&reply, &["win-2"]);
    }

    #[test]
    fn reconcile_with_post_removal_observation_projects_survivor() {
        // KWin sends the current post-removal observation: win-2 already
        // departed, so complete-observation reconcile converges it away and
        // projects the survivor (reconcile capability, valid focus).
        let mut planner = Planner::new();
        let seed = parse_reply(&planner.evaluate(&retained_request(
            "post-rem-rec-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(seed["outcome"], "planned", "{seed}");
        assert_eq!(planner.retained_domains(), 1);
        let reply = parse_reply(&planner.evaluate(&retained_request(
            "post-rem-rec-2",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(reply["detail"]["kind"], "reconcile", "{reply}");
        assert_geometry_covers(&reply, &["win-1"]);
        assert_eq!(planner.retained_domains(), 1);
    }

    #[test]
    fn exact_reconcile_keeps_revision_without_convergence() {
        // Exact-match observation: no convergence bump. Two identical
        // reconciles report the same base revision; the projection is a pure
        // function of retained state, not a mutation.
        let mut planner = seed_two_window_planner();
        let windows = &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)];
        let first = parse_reply(&planner.evaluate(&retained_request(
            "rec-exact-1",
            "owner-1",
            "gen-1",
            "win-1",
            windows,
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(first["outcome"], "planned", "{first}");
        let second = parse_reply(&planner.evaluate(&retained_request(
            "rec-exact-2",
            "owner-1",
            "gen-1",
            "win-1",
            windows,
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(second["outcome"], "planned", "{second}");
        assert_eq!(second["base_revision"], first["base_revision"], "{second}");
        assert_eq!(
            geometry_by_window(&second),
            geometry_by_window(&first),
            "{second}"
        );
    }

    #[test]
    fn convergence_summaries_are_bounded_and_redacted() {
        let line = summarize_plan_convergence("conv-sum-1", "reconcile", 1, 2, 3);
        assert_eq!(
            line,
            "plasma-auto-tiler:plan-summary direction=convergence op=reconcile correlation=conv-sum-1 reason=observation-mismatch removed=1 admitted=2 flags_adopted=3"
        );
        // Malformed sides degrade to bounded placeholders without echoing
        // anything caller-controlled: no window ids, rects, owner, or
        // payload bytes.
        let garbage = summarize_plan_convergence("evil correlation!!", "Reconcile!!", 0, 0, 0);
        assert_eq!(
            garbage,
            "plasma-auto-tiler:plan-summary direction=convergence op=unknown correlation=- reason=observation-mismatch removed=0 admitted=0 flags_adopted=0"
        );
        assert!(!garbage.contains("evil"), "{garbage}");
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
    fn workspace_send_commits_immediately_with_native_assignment_and_converges() {
        // Compact Planner/Engine codec row: a real send-to-workspace commits
        // immediately with the native membership action (`move-tiled`
        // operation plus preconditions) and both-domain geometry. A failed
        // native assignment then converges on the next complete observations
        // with no retained phantom.
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&workspace_request(
            "ws-codec-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_send_body(),
        )));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(reply["kind"], "send-to-workspace", "{reply}");
        assert_eq!(reply["operation"]["op"], "move-tiled", "{reply}");
        assert_eq!(reply["operation"]["window"], "win-1", "{reply}");
        assert_eq!(reply["operation"]["source_workspace"], "ws-1", "{reply}");
        assert_eq!(reply["operation"]["target_workspace"], "ws-2", "{reply}");
        assert!(
            reply["preconditions"]
                .as_array()
                .is_some_and(|p| !p.is_empty()),
            "{reply}"
        );
        // Both-domain geometry: the mover lands on the target, the target
        // member survives, and the emptied source carries no entry.
        let geometry = reply["desired_geometry"].as_array().expect("geometry");
        let mut members: Vec<(String, String)> = geometry
            .iter()
            .map(|g| {
                (
                    g["window"].as_str().expect("window").to_owned(),
                    g["workspace"].as_str().expect("workspace").to_owned(),
                )
            })
            .collect();
        members.sort();
        assert_eq!(
            members,
            vec![
                ("win-1".to_owned(), "ws-2".to_owned()),
                ("win-t1".to_owned(), "ws-2".to_owned()),
            ],
            "{reply}"
        );
        // Native refused: the next complete observations still show the mover
        // on the source and the target without it; both converge with no
        // retained phantom.
        let source = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "ws-codec-2",
            "owner-1",
            "gen-1",
            "out-1",
            "ws-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(source["outcome"], "planned", "{source}");
        let target = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "ws-codec-3",
            "owner-1",
            "gen-1",
            "out-1",
            "ws-2",
            "win-t1",
            &[("win-t1", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(target["outcome"], "planned", "{target}");
        let source_geometry = source["desired_geometry"].as_array().expect("geometry");
        assert!(
            source_geometry
                .iter()
                .any(|g| g["window"] == "win-1" && g["workspace"] == "ws-1"),
            "{source}"
        );
        let target_geometry = target["desired_geometry"].as_array().expect("geometry");
        assert!(
            target_geometry.iter().all(|g| g["window"] != "win-1"),
            "{target}"
        );
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
            r#"{"v":1,"correlation_id":"evil correlation!!","owner":"owner-1","generation":"gen-1","revision":0,"command":{"op":"reconcile"}}"#,
        );
        assert!(bad_corr.contains("correlation=-"), "{bad_corr}");
        assert!(!bad_corr.contains("evil"), "{bad_corr}");
        // Out-of-bounds revisions never echo.
        let bad_rev = summarize_plan_ingress(
            r#"{"v":1,"correlation_id":"ws-sum-1","revision":99999999,"command":{"op":"reconcile"}}"#,
        );
        assert!(bad_rev.contains("revision=-"), "{bad_rev}");
        assert!(!bad_rev.contains("99999999"), "{bad_rev}");
    }

    #[test]
    fn plan_summary_egress_reports_planned_send_truthfully() {
        // Planned send result codes pass through exactly: the native
        // membership action carries the route kind and the committed base.
        let send_request = workspace_request(
            "ws-sum-2",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_send_body(),
        );
        let send_reply = r#"{"v":1,"correlation_id":"ws-sum-2","outcome":"planned","kind":"send-to-workspace","base_revision":3}"#;
        assert_eq!(
            summarize_plan_egress(&send_request, send_reply),
            "plasma-auto-tiler:plan-summary direction=egress op=send-to-workspace correlation=ws-sum-2 outcome=planned kind=send-to-workspace base_revision=3 detail=-"
        );
        // A garbage reply degrades without echoing it.
        let garbage = summarize_plan_egress(&send_request, "{not-json!!");
        assert!(garbage.contains("outcome=unknown"), "{garbage}");
        assert!(garbage.contains("correlation=-"), "{garbage}");
        assert!(!garbage.contains("not-json"), "{garbage}");
        // Snapshot-invalid detail tokens pass through bounded.
        let invalid = summarize_plan_egress(
            &send_request,
            r#"{"v":1,"correlation_id":"ws-sum-2","outcome":"rejected","kind":"snapshot-invalid","detail":"domain-invalid"}"#,
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
        // Summaries are pure: running them changes no planner state.
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
        let _ = summarize_plan_egress(&pre, &pre);
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
                serde_json::json!({"op": "reconcile"}),
            ),
            (
                "ag-seed-2",
                "win-2",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "reconcile"}),
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
        // Retained focus after the second reconcile is win-2.
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
            serde_json::json!({"op": "reconcile"}),
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
        // Real reconciled/planned lifecycle producing H[win-1, V[win-2, win-3]]:
        // two landscape reconciles build root H, the third reconcile nests V
        // under the tall focused leaf. No hand-seeded sessions.
        let mut planner = Planner::new();
        for (correlation, focused, windows, command) in [
            (
                "ag-nested-1",
                "win-1",
                vec![("win-1", 0, 0, 100, 80)],
                serde_json::json!({"op": "reconcile"}),
            ),
            (
                "ag-nested-2",
                "win-2",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "reconcile"}),
            ),
            (
                "ag-nested-3",
                "win-3",
                vec![
                    ("win-1", 0, 0, 100, 80),
                    ("win-2", 200, 0, 100, 80),
                    ("win-3", 400, 0, 100, 80),
                ],
                serde_json::json!({"op": "reconcile"}),
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

    #[allow(clippy::too_many_arguments)]
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
    fn retained_empty_reconcile_retires_session_and_frees_slot() {
        // An empty complete observation retires the session at the same
        // committed boundary so a later background domain can be admitted.
        // Offline only: retained Planner evaluation, no bus.
        let mut planner = Planner::new();
        let seed = retained_request_for_domain(
            "empty-retire-1",
            "owner-1",
            "gen-1",
            "out-1",
            "ws-2",
            "win-h",
            &[("win-h", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        let seed_reply = parse_reply(&planner.evaluate(&seed));
        assert_eq!(seed_reply["outcome"], "planned", "{seed_reply}");
        assert_eq!(planner.retained_domains(), 1);
        let empty = retained_request_for_domain(
            "empty-retire-2",
            "owner-1",
            "gen-1",
            "out-1",
            "ws-2",
            "",
            &[],
            serde_json::json!({"op": "reconcile"}),
        );
        let empty_reply = parse_reply(&planner.evaluate(&empty));
        assert_eq!(empty_reply["outcome"], "planned", "{empty_reply}");
        assert_eq!(
            empty_reply["desired_geometry"].as_array().map(Vec::len),
            Some(0),
            "{empty_reply}"
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
            serde_json::json!({"op": "reconcile"}),
        );
        let next_reply = parse_reply(&planner.evaluate(&next));
        assert_eq!(next_reply["outcome"], "planned", "{next_reply}");
        assert_eq!(planner.retained_domains(), 1);
    }

    #[test]
    fn retained_many_domains_plan_without_count_cap() {
        // No retained-domain count cap: well beyond the old 16-domain bound,
        // every distinct domain converges and stays retained. Offline only.
        let mut planner = Planner::new();
        for index in 1..=24 {
            let workspace = format!("ws-{index}");
            let window = format!("win-{index}");
            let correlation = format!("many-domain-reconcile-{index}");
            let request = retained_request_for_domain(
                &correlation,
                "owner-1",
                "gen-1",
                "out-1",
                &workspace,
                &window,
                &[(window.as_str(), 0, 0, 100, 80)],
                serde_json::json!({"op": "reconcile"}),
            );
            let reply = parse_reply(&planner.evaluate(&request));
            assert_eq!(reply["outcome"], "planned", "{reply} {index}");
        }
        assert_eq!(planner.retained_domains(), 24);
        // An empty complete observation for the first domain retires it.
        let retire = retained_request_for_domain(
            "many-domain-retire-1",
            "owner-1",
            "gen-1",
            "out-1",
            "ws-1",
            "",
            &[],
            serde_json::json!({"op": "reconcile"}),
        );
        let retire_reply = parse_reply(&planner.evaluate(&retire));
        assert_eq!(retire_reply["outcome"], "planned", "{retire_reply}");
        assert_eq!(
            retire_reply["desired_geometry"].as_array().map(Vec::len),
            Some(0),
            "{retire_reply}"
        );
        assert_eq!(planner.retained_domains(), 23);
    }

    #[test]
    fn request_size_cap_is_one_mib_with_bounded_oversize_refusal() {
        assert_eq!(PLAN_MAX_REQUEST_BYTES, 1_048_576);
        assert_eq!(PLAN_MAX_REPLY_BYTES, 64 * 1024);
        // At-cap input passes the size gate (trailing JSON whitespace is
        // ignored by parsing, so padding is neutral).
        let base = retained_request(
            "size-cap-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        );
        assert!(base.len() < PLAN_MAX_REQUEST_BYTES);
        let mut at_cap = base.clone();
        at_cap.push_str(&" ".repeat(PLAN_MAX_REQUEST_BYTES - at_cap.len()));
        assert_eq!(at_cap.len(), PLAN_MAX_REQUEST_BYTES);
        let mut planner = Planner::new();
        let at_reply = parse_reply(&planner.evaluate(&at_cap));
        assert_ne!(at_reply["kind"], "oversized", "{at_reply}");
        // Just-over-cap input refuses without parsing: empty correlation,
        // bounded fixed message, valid JSON within the reply cap.
        let mut over = base.clone();
        over.push_str(&" ".repeat(PLAN_MAX_REQUEST_BYTES - over.len() + 1));
        assert_eq!(over.len(), PLAN_MAX_REQUEST_BYTES + 1);
        let over_text = planner.evaluate(&over);
        let over_reply: serde_json::Value =
            serde_json::from_str(&over_text).expect("oversize reply is JSON");
        assert_eq!(over_reply["outcome"], "rejected");
        assert_eq!(over_reply["kind"], "oversized");
        assert_eq!(over_reply["message"], "request exceeds size bound");
        assert_eq!(over_reply["correlation_id"], "");
        assert!(over_text.len() <= PLAN_MAX_REPLY_BYTES);
        // The oversize path never echoes untrusted bytes, so no trusted
        // correlation can be extracted: the service early-exit stays fixed
        // and uncorrelated (adapter logs the correlated preflight refusal).
        assert!(!over_text.contains("size-cap"));
    }

    #[test]
    fn oversize_reply_from_valid_large_request_stays_correlated_and_bounded() {
        // A valid large request (800 observed windows, well under the 1 MiB
        // request cap) overflows the 64 KiB reply cap through desired
        // geometry. The codec fallback must stay correlated (validated
        // correlation only, never untrusted bytes) and bounded, and the
        // normal summary pair must stay bounded with the correlation
        // attributable.
        let names: Vec<String> = (0..800).map(|i| format!("win-{i}")).collect();
        let windows: Vec<(&str, i32, i32, i32, i32)> = names
            .iter()
            .enumerate()
            .map(|(i, name)| (name.as_str(), i as i32, 0, 1, 800))
            .collect();
        let focused = names.last().expect("names").clone();
        let request = retained_request(
            "big-reply-1",
            "owner-1",
            "gen-1",
            &focused,
            &windows,
            serde_json::json!({"op": "reconcile"}),
        );
        assert!(request.len() < PLAN_MAX_REQUEST_BYTES, "{}", request.len());
        let mut planner = Planner::new();
        let text = planner.evaluate(&request);
        let reply: serde_json::Value = serde_json::from_str(&text).expect("fallback reply is JSON");
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        assert_eq!(reply["kind"], "reply-oversize", "{reply}");
        assert_eq!(reply["message"], "reply exceeds size bound", "{reply}");
        assert_eq!(reply["correlation_id"], "big-reply-1", "{reply}");
        assert!(text.len() <= PLAN_MAX_REPLY_BYTES, "{reply}");
        // No carried data echoes: only the validated correlation survives.
        assert!(!text.contains("win-42"), "{reply}");
        let ingress = summarize_plan_ingress(&request);
        let egress = summarize_plan_egress(&request, &text);
        for line in [&ingress, &egress] {
            assert!(line.len() <= 512, "{line}");
        }
        assert!(ingress.contains("correlation=big-reply-1"), "{ingress}");
        assert!(egress.contains("correlation=big-reply-1"), "{egress}");
        assert!(egress.contains("kind=reply-oversize"), "{egress}");
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
    fn fit_horizontal_strip_commits_through_reconcile() {
        // Unequal 400/800 side-by-side strip: the normal seed would reflow to
        // an equal split, so exact observed geometry proves the fit path.
        let windows = [("win-1", 0, 0, 400, 800), ("win-2", 400, 0, 800, 800)];
        let mut planner = Planner::new();
        let reply = parse_reply(&planner.evaluate(&retained_request(
            "fit-h-1",
            "owner-1",
            "gen-1",
            "win-2",
            &windows,
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(reply["outcome"], "planned", "{reply}");
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
            serde_json::json!({"op": "reconcile"}),
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
            serde_json::json!({"op": "reconcile"}),
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
            serde_json::json!({"op": "reconcile"}),
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
    fn fit_vertical_near_strip_with_drift_projects_canonical() {
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
            serde_json::json!({"op": "reconcile"}),
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
            serde_json::json!({"op": "reconcile"}),
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
    fn fit_commits_once_and_retained_followup_never_refits() {
        let mut planner = Planner::new();
        let fitted = parse_reply(&planner.evaluate(&retained_request(
            "fit-r-1",
            "owner-1",
            "gen-1",
            "win-2",
            &[("win-1", 0, 0, 400, 800), ("win-2", 400, 0, 800, 800)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(fitted["outcome"], "planned", "{fitted}");
        let before = geometry_by_window(&fitted)["win-1"];
        // A retained follow-up reconciles the newcomer into the fitted tree
        // without rewriting the fitted first child.
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
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(follow["outcome"], "planned", "{follow}");
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
            serde_json::json!({"op": "reconcile"}),
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
        // Membership edits while displaced converge through complete-observation
        // reconcile on the relocated tree: moved-out stays out, moved-in
        // reconciles into the relocated topology.
        let mut planner = Planner::new();
        let seed = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-edit-1",
            "owner-1",
            "gen-1",
            "out-old",
            "ws-7",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
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
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(removed["outcome"], "planned", "{removed}");
        // Reconcile win-3 into the displaced workspace (moved-in returns with it).
        let admitted = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-edit-4",
            "owner-1",
            "gen-1",
            "out-new",
            "ws-7",
            "win-3",
            &[("win-1", 0, 0, 100, 80), ("win-3", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
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
            serde_json::json!({"op": "reconcile"}),
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
            serde_json::json!({"op": "reconcile"}),
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
        // A usable non-empty target is a collision: complete-observation
        // reconcile follows the normal path with no source mutation. Both
        // domains stay retained and usable.
        let mut planner = Planner::new();
        let source = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-coll-1",
            "owner-1",
            "gen-1",
            "out-gone",
            "ws-away",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
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
            serde_json::json!({"op": "reconcile"}),
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
        // or superseded for relocation, even when the carried bounds skew.
        // The stale target follows the normal complete-observation reconcile
        // path while the source stays retained and usable.
        let mut planner = Planner::new();
        let source = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-mismatch-1",
            "owner-1",
            "gen-1",
            "out-gone",
            "ws-away",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
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
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(target["outcome"], "planned", "{target}");
        assert_eq!(planner.retained_domains(), 2);
        // Reconcile on the existing target with different bounds: the
        // retained target reprojects/converges through the normal path, but
        // source relocation must not run because the target existed at
        // handling start.
        let mut mismatched: serde_json::Value = serde_json::from_str(&retained_request_for_domain(
            "reloc-mismatch-3",
            "owner-1",
            "gen-1",
            "out-keep",
            "ws-away",
            "win-k2",
            &[("win-k", 0, 0, 100, 80), ("win-k2", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        ))
        .expect("request JSON");
        mismatched["domain"]["bounds"] = serde_json::json!({"x": 0, "y": 0, "w": 800, "h": 600});
        let reseeded = parse_reply(&planner.evaluate(&mismatched.to_string()));
        assert_eq!(reseeded["outcome"], "planned", "{reseeded}");
        // Normal reconcile kept the target; the source was not relocated.
        assert_eq!(planner.retained_domains(), 2, "{reseeded}");
        let source_key = DomainKey {
            output: OutputId("out-gone".to_owned()),
            workspace: WorkspaceId("ws-away".to_owned()),
        };
        let target_key = DomainKey {
            output: OutputId("out-keep".to_owned()),
            workspace: WorkspaceId("ws-away".to_owned()),
        };
        assert!(planner.engine.contains(&source_key), "{reseeded}");
        assert!(planner.engine.contains(&target_key), "{reseeded}");
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
        // mutation: the source stays and no target is created. Complete
        // observation carries the exact source/target ids.
        let mut planner = Planner::new();
        let seed = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-gap-1",
            "owner-1",
            "gen-1",
            "out-gone",
            "ws-away",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
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
        // Two usable sources with the same workspace never relocate: with no
        // pending, a fresh reconcile seeds the new domain through the same
        // admission route while both sources stay retained (Orchestrator
        // ambiguous-source fresh-seed rule).
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
                serde_json::json!({"op": "reconcile"}),
            )));
            assert_eq!(seeded["outcome"], "planned", "{seeded}");
        }
        assert_eq!(planner.retained_domains(), 2);
        let seeded = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-amb-3",
            "owner-1",
            "gen-1",
            "out-c",
            "ws-x",
            "win-a",
            &[("win-a", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(seeded["outcome"], "planned", "{seeded}");
        assert_geometry_covers(&seeded, &["win-a"]);
        assert_eq!(planner.retained_domains(), 3, "{seeded}");
        // Neither source moved: both still reconcile their own members.
        for (correlation, output, window) in [
            ("reloc-amb-4", "out-a", "win-a"),
            ("reloc-amb-5", "out-b", "win-b"),
        ] {
            let source = parse_reply(&planner.evaluate(&retained_request_for_domain(
                correlation,
                "owner-1",
                "gen-1",
                output,
                "ws-x",
                window,
                &[(window, 0, 0, 100, 80)],
                serde_json::json!({"op": "reconcile"}),
            )));
            assert_eq!(source["outcome"], "planned", "{source}");
            assert_geometry_covers(&source, &[window]);
        }
    }

    #[test]
    fn output_relocation_preserves_exception_class_and_float_geometry() {
        // A floated exception keeps its class (flags) and floating geometry
        // across relocation; only the homing output moves. Seed and relocate
        // through complete-observation reconcile (no admit newcomer on the
        // move); a later complete reconcile admits win-3. Revision is
        // preserved across the move and advances once for the admit.
        let mut planner = Planner::new();
        let seed = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "reloc-exc-1",
            "owner-1",
            "gen-1",
            "out-removed",
            "ws-9",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
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
            .engine
            .session(&source_key)
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
        // Relocated exact overlapping observation (no newcomer) reconciles on
        // the moved tree: the floated window stays flagged floating.
        let mut displaced: serde_json::Value = serde_json::from_str(&retained_request_for_domain(
            "reloc-exc-3",
            "owner-1",
            "gen-1",
            "out-survivor",
            "ws-9",
            "win-2",
            &[("win-1", 0, 0, 100, 80), ("win-2", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        ))
        .expect("request JSON");
        displaced["windows"][0]["floating"] = serde_json::json!(true);
        let moved = parse_reply(&planner.evaluate(&displaced.to_string()));
        assert_eq!(moved["outcome"], "planned", "{moved}");
        assert_eq!(moved["detail"]["kind"], "reconcile", "{moved}");
        assert_eq!(planner.retained_domains(), 1, "{moved}");
        let target_key = DomainKey {
            output: OutputId("out-survivor".to_owned()),
            workspace: WorkspaceId("ws-9".to_owned()),
        };
        let relocated = planner
            .engine
            .session(&target_key)
            .expect("target retained");
        // Relocation itself adds zero: revision preserved.
        assert_eq!(relocated.accepted_revision(), before_revision, "{moved}");
        assert_eq!(relocated.exception_count(), 1, "{moved}");
        let relocated_exception = relocated
            .exception_observed()
            .into_iter()
            .next()
            .expect("relocated exception");
        assert_eq!(
            relocated_exception.floating, before_exception.floating,
            "{moved}"
        );
        assert_eq!(
            relocated_exception.fullscreen, before_exception.fullscreen,
            "{moved}"
        );
        assert_eq!(
            relocated_exception.maximized, before_exception.maximized,
            "{moved}"
        );
        assert_eq!(
            relocated_exception.sticky, before_exception.sticky,
            "{moved}"
        );
        assert_eq!(relocated_exception.output.0, "out-survivor", "{moved}");
        assert_eq!(relocated_exception.workspace.0, "ws-9", "{moved}");
        assert_eq!(
            relocated.floating_geometry(&relocated_exception.window),
            before_float_geometry,
            "{moved}"
        );
        // Separate retained complete reconcile admits win-3 on the relocated
        // tree, preserving topology and exception class; revision advances
        // exactly once.
        let mut admit: serde_json::Value = serde_json::from_str(&retained_request_for_domain(
            "reloc-exc-4",
            "owner-1",
            "gen-1",
            "out-survivor",
            "ws-9",
            "win-3",
            &[
                ("win-1", 0, 0, 100, 80),
                ("win-2", 0, 0, 100, 80),
                ("win-3", 0, 0, 100, 80),
            ],
            serde_json::json!({"op": "reconcile"}),
        ))
        .expect("request JSON");
        admit["windows"][0]["floating"] = serde_json::json!(true);
        let admitted = parse_reply(&planner.evaluate(&admit.to_string()));
        assert_eq!(admitted["outcome"], "planned", "{admitted}");
        assert_eq!(admitted["detail"]["kind"], "reconcile", "{admitted}");
        assert_geometry_covers(&admitted, &["win-2", "win-3"]);
        assert_eq!(planner.retained_domains(), 1, "{admitted}");
        let after = planner
            .engine
            .session(&target_key)
            .expect("target retained");
        assert_eq!(after.accepted_revision(), before_revision + 1, "{admitted}");
        assert_eq!(after.exception_count(), 1, "{admitted}");
        let after_exception = after
            .exception_observed()
            .into_iter()
            .next()
            .expect("admitted exception");
        assert_eq!(
            after_exception.floating, before_exception.floating,
            "{admitted}"
        );
        assert_eq!(
            after_exception.fullscreen, before_exception.fullscreen,
            "{admitted}"
        );
        assert_eq!(
            after_exception.maximized, before_exception.maximized,
            "{admitted}"
        );
        assert_eq!(
            after_exception.sticky, before_exception.sticky,
            "{admitted}"
        );
        assert_eq!(after_exception.output.0, "out-survivor", "{admitted}");
        assert_eq!(after_exception.workspace.0, "ws-9", "{admitted}");
        assert_eq!(
            after.floating_geometry(&after_exception.window),
            before_float_geometry,
            "{admitted}"
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
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(seed["outcome"], "planned", "{seed}");
        let source_key = DomainKey {
            output: OutputId("out-removed".to_owned()),
            workspace: WorkspaceId("ws-9".to_owned()),
        };
        let before = planner
            .engine
            .session(&source_key)
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
        assert!(!planner.engine.contains(&source_key), "{moved}");
        let target_key = DomainKey {
            output: OutputId("out-survivor".to_owned()),
            workspace: WorkspaceId("ws-9".to_owned()),
        };
        let after = planner
            .engine
            .session(&target_key)
            .expect("target retained");
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
