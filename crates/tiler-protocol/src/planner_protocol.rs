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
//! acknowledging, verifying, rebinding, or advancing anything. A fenced
//! `send-to-workspace-abandon` operation retires ANY existing
//! workspace-send pending (exact or orphan: older generation, other
//! correlation, other same-UID caller, other revision or scope), regardless
//! of acked/unacked/diverged state, with no commit claim and no new retained
//! state, preserving all per-domain Engine sessions. An exact retained
//! match (owner/generation/correlation/retained-revision/scope) replies
//! `abandoned`; a mismatched retired live pending replies distinct
//! `orphan-abandoned` (v, requester correlation, kind `send-to-workspace`,
//! no base/geometry/operation/preconditions). Absent pending replies
//! `no-pending-unknown` with the exact correlation and kind. Malformed or
//! unauthorized requests still fail closed before any retirement, and a
//! directional R4 pending is out of scope (never retired by this op).

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
/// that and never implies a commit. Abandon outcomes (`abandoned`,
/// `orphan-abandoned`) pass through with the same redaction posture.
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
            | Some("send-to-workspace-abandon")
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

/// Typed versioned-tiled serializer for the admit/remove/toggle-float family:
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
        CoreReply::Status {
            base_revision,
            status,
        } => status_reply(&cid, *base_revision, status.as_str()),
        CoreReply::Acknowledged {
            base_revision,
            kind,
        } => serialize_bounded(&PlanReply {
            v: PLAN_CONTRACT_VERSION,
            correlation_id: cid,
            outcome: "acknowledged",
            kind: Some(kind.kind_str().to_owned()),
            message: None,
            base_revision: Some(*base_revision),
            detail: None,
            desired_geometry: None,
            desired_focus: None,
            float_geometry: None,
            preconditions: None,
            operation: None,
        }),
        CoreReply::Committed { revision, kind } => serialize_bounded(&PlanReply {
            v: PLAN_CONTRACT_VERSION,
            correlation_id: cid,
            outcome: "committed",
            kind: Some(kind.kind_str().to_owned()),
            message: None,
            base_revision: Some(*revision),
            detail: None,
            desired_geometry: None,
            desired_focus: None,
            float_geometry: None,
            preconditions: None,
            operation: None,
        }),
        CoreReply::Cancelled {
            base_revision,
            kind,
        } => cancelled_reply(&cid, kind.kind_str(), *base_revision),
    }
}

/// Planned workspace-send reply: carries the full affected geometry plus the
/// exact operation/preconditions the adapter must echo back in the verify
/// post-observation. Legacy byte oracle for the typed
/// [`serialize_send_workspace_reply`] funnel; production routes through
/// [`serialize_core_reply`].
#[cfg(test)]
fn workspace_planned_reply(
    correlation_id: &str,
    plan: &tiler_core::session::SessionPlan,
) -> String {
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

/// Abandon success reply: outcome `abandoned` with the retired route kind and
/// the exact request correlation. Carries no base revision, geometry, focus,
/// operation, or preconditions and must never be read as a commit: the exact
/// pending was retired and its staged desired state discarded, with Engine
/// sessions and baselines untouched.
fn abandoned_reply(correlation_id: &str, kind: &'static str) -> String {
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id: correlation_id.to_owned(),
        outcome: "abandoned",
        kind: Some(kind.to_owned()),
        message: None,
        base_revision: None,
        detail: None,
        desired_geometry: None,
        desired_focus: None,
        float_geometry: None,
        preconditions: None,
        operation: None,
    })
}

/// Orphan abandon reply: outcome `orphan-abandoned` with the retired route
/// kind and the requester correlation. Same shape contract as
/// [`abandoned_reply`]: no base revision, geometry, focus, operation, or
/// preconditions, never a commit. Emitted when a fenced abandon retires a
/// live workspace-send pending whose retained identity (owner, generation,
/// correlation), revision, or scope does not exactly match the requester
/// (older generation, other correlation, other same-UID caller). The
/// distinct outcome lets the caller distinguish orphan retirement from an
/// exact retire while both clear the same pending slot.
fn orphan_abandoned_reply(correlation_id: &str, kind: &'static str) -> String {
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id: correlation_id.to_owned(),
        outcome: "orphan-abandoned",
        kind: Some(kind.to_owned()),
        message: None,
        base_revision: None,
        detail: None,
        desired_geometry: None,
        desired_focus: None,
        float_geometry: None,
        preconditions: None,
        operation: None,
    })
}

/// Abandon retry reply: outcome `no-pending-unknown` with the route kind and
/// the exact request correlation. Emitted for the same fenced abandon request
/// when no matching pending exists (already retired, already committed, or
/// never staged). Carries nothing else and never implies a commit.
fn abandon_unknown_reply(correlation_id: &str, kind: &'static str) -> String {
    serialize_bounded(&PlanReply {
        v: PLAN_CONTRACT_VERSION,
        correlation_id: correlation_id.to_owned(),
        outcome: "no-pending-unknown",
        kind: Some(kind.to_owned()),
        message: None,
        base_revision: None,
        detail: None,
        desired_geometry: None,
        desired_focus: None,
        float_geometry: None,
        preconditions: None,
        operation: None,
    })
}

/// Deferred raw echo of a verify command's nested `preconditions`/`operation`.
///
/// Captures the nested JSON bytes opaquely at the tagged [`SyncCommand`]
/// decode boundary, so the outer parse always succeeds on well-formed JSON
/// and conversion to portable core types runs only after the `verified` gate
/// at its exact legacy position. Handlers see only this opaque string plus
/// the converted core types, never an untyped JSON tree: every shape failure
/// still maps to `verify-invalid`, never to a top-level parse error.
/// Re-serialization is outcome-preserving here because inner validation only
/// reads strings/bools/u64 through the strict echo DTOs below, which accept
/// exactly the shapes the previous untyped parse accepted.
#[derive(Debug, Clone)]
struct RawEcho(String);

impl<'de> Deserialize<'de> for RawEcho {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        serde_json::to_string(&value)
            .map(RawEcho)
            .map_err(serde::de::Error::custom)
    }
}

/// Typed wire echo of a MoveTiled operation carried in a verify command.
/// No `deny_unknown_fields`: extra fencing fields stay lenient exactly like
/// the previous untyped parse (typed operation equality plus the
/// post-observation geometry check enforce exactness at verify time).
/// Decoded only from the deferred [`RawEcho`] after the `verified` gate, so
/// every shape failure still maps to `verify-invalid`.
#[derive(Debug, Clone, Deserialize)]
struct MoveTiledEchoDto {
    op: String,
    window: String,
    leaf: String,
    source_output: String,
    source_workspace: String,
    target_output: String,
    target_workspace: String,
}

/// Typed wire echo of an R4 cross-output move operation carried in a verify
/// command. Same leniency contract as [`MoveTiledEchoDto`]: extra fencing
/// fields are ignored here while the typed operation equality, the fenced
/// source/target binding, and the post-observation geometry check enforce
/// exactness at verify time. The exact wire syntax (window/leaf/direction/
/// source ids/capability) cannot be represented by the portable
/// [`tiler_core::directional::MoveOperation::CrossOutput`] shape, which
/// carries only rule/target/output/workspace/child-index/target-occupancy, so
/// decoding stays strictly in protocol and only the portable operation is
/// passed to the next layer (see recommendation in the work report).
#[derive(Debug, Clone, Deserialize)]
struct DirectionalMoveEchoDto {
    op: String,
    rule: String,
    capability: String,
    direction: String,
    window: String,
    leaf: String,
    source_output: String,
    source_workspace: String,
    target_output: String,
    target_workspace: String,
    source_root_child_index: u64,
    target: String,
}

/// Parse a MoveTiled operation echo back to its typed lifecycle form.
/// The echo arrives as deferred [`RawEcho`] (see [`SyncCommand`]) so the
/// outer tagged decode always succeeds on well-formed JSON and this runs only
/// after the `verified` gate at its exact legacy position; any shape failure
/// maps to `verify-invalid`.
fn parse_move_tiled_operation(value: &RawEcho) -> Option<LifecycleOperation> {
    let echo: MoveTiledEchoDto = serde_json::from_str(&value.0).ok()?;
    if echo.op != "move-tiled" {
        return None;
    }
    if !is_opaque_id(&echo.window)
        || !is_opaque_id(&echo.leaf)
        || !is_opaque_id(&echo.source_output)
        || !is_opaque_id(&echo.source_workspace)
        || !is_opaque_id(&echo.target_output)
        || !is_opaque_id(&echo.target_workspace)
    {
        return None;
    }
    Some(LifecycleOperation::MoveTiled {
        window: WindowId(echo.window),
        leaf: NodeId(echo.leaf),
        source_output: OutputId(echo.source_output),
        source_workspace: WorkspaceId(echo.source_workspace),
        target_output: OutputId(echo.target_output),
        target_workspace: WorkspaceId(echo.target_workspace),
    })
}

/// Parse the exact lifecycle precondition vector from the verify echo.
/// Deferred [`RawEcho`] input preserves the legacy precedence: non-array,
/// empty, overlong, non-string, and unknown-token echoes all map to
/// `verify-invalid` after the `verified` gate, never to a top-level parse
/// error.
fn parse_lifecycle_preconditions(value: &RawEcho) -> Option<Vec<LifecyclePrecondition>> {
    let values: Vec<String> = serde_json::from_str(&value.0).ok()?;
    if values.is_empty() || values.len() > tiler_core::contract::MAX_PRECONDITIONS {
        return None;
    }
    let mut out = Vec::with_capacity(values.len());
    for entry in &values {
        out.push(parse_lifecycle_precondition(entry)?);
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

/// Parse the exact directional precondition vector from the verify echo.
/// Deferred [`RawEcho`] input preserves the legacy precedence exactly like
/// [`parse_lifecycle_preconditions`].
fn parse_directional_preconditions(
    value: &RawEcho,
) -> Option<Vec<tiler_core::directional::Precondition>> {
    let values: Vec<String> = serde_json::from_str(&value.0).ok()?;
    if values.is_empty() || values.len() > tiler_core::contract::MAX_PRECONDITIONS {
        return None;
    }
    let mut out = Vec::with_capacity(values.len());
    for entry in &values {
        out.push(parse_directional_precondition(entry)?);
    }
    Some(out)
}

/// Parse an R4 cross-output move echo back to its typed directional form
/// plus the fenced wire DTO. Strict bounded parsing of the exact fenced wire
/// shape emitted in the planned reply (`op`/`rule`/`capability`/ left-right
/// `direction`, opaque window/leaf/source/target ids, bounded child index,
/// empty/occupied target); extra fencing fields stay lenient while the typed
/// operation equality, the fenced source/target binding, and the
/// post-observation geometry check enforce exactness at verify time.
/// Deferred [`RawEcho`] input keeps every shape failure on the
/// `verify-invalid` path after the `verified` gate.
fn parse_directional_move_operation(
    value: &RawEcho,
) -> Option<(
    tiler_core::directional::MoveOperation,
    DirectionalMoveEchoDto,
)> {
    let echo: DirectionalMoveEchoDto = serde_json::from_str(&value.0).ok()?;
    if echo.op != "move" {
        return None;
    }
    if echo.rule != "R4" {
        return None;
    }
    if echo.capability != "CrossOutputTransfer" {
        return None;
    }
    if echo.direction != "left" && echo.direction != "right" {
        return None;
    }
    if !is_opaque_id(&echo.window)
        || !is_opaque_id(&echo.leaf)
        || !is_opaque_id(&echo.source_output)
        || !is_opaque_id(&echo.source_workspace)
        || !is_opaque_id(&echo.target_output)
        || !is_opaque_id(&echo.target_workspace)
    {
        return None;
    }
    let Ok(index) = usize::try_from(echo.source_root_child_index) else {
        return None;
    };
    let target = match echo.target.as_str() {
        "empty" => tiler_core::directional::CrossOutputTarget::Empty,
        "occupied" => tiler_core::directional::CrossOutputTarget::Occupied,
        _ => return None,
    };
    let operation = tiler_core::directional::MoveOperation::CrossOutput {
        rule: tiler_core::directional::Rule::R4,
        target_output: OutputId(echo.target_output.clone()),
        target_workspace: WorkspaceId(echo.target_workspace.clone()),
        source_root_child_index: index,
        target,
    };
    Some((operation, echo))
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
/// preserving everything committed. `send-to-workspace-abandon` retires ANY
/// existing workspace-send pending regardless of acked/unacked/diverged state
/// with no commit claim and no session/baseline reset: an exact retained
/// match replies `abandoned`, a mismatched retired live pending replies
/// distinct `orphan-abandoned`, and absence replies `no-pending-unknown`.
/// A directional R4 pending is out of scope and never retired by this op.
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
    /// topology. The standalone workspace-send and directional-move routes
    /// dispatch their ack/verify phases before the legacy owner/generation
    /// binding sync so a pending Session is never discarded or rebound
    /// mid-flight; legacy requests are unchanged except that any pending
    /// (workspace or directional) blocks all other plan operations. The
    /// read-only status phases dispatch alongside ack/verify (before the
    /// binding sync and the pending conflict boundary) through the
    /// Engine-owned read-only typed entry point (`inspect` takes `&self`, so
    /// status cannot mutate, acknowledge, verify, clear, rebind, or advance
    /// any retained state or topology). The cancellation phases dispatch at
    /// the same boundary through the mutating entry point (`handle` takes
    /// `&mut self`): on exact pre-image
    /// proof they withdraw only the matching unacknowledged pending and its
    /// staged desired state, preserving everything committed. The abandon
    /// phase dispatches at the same boundary through existing Engine
    /// accessors only: any live send pending retires (exact or orphan, any
    /// ack state, diverged or not) with no commit claim and no
    /// session/baseline mutation; exact identity/scope/revision proof replies
    /// `abandoned`, a mismatched retired live pending replies distinct
    /// `orphan-abandoned`, and absent pending replies `no-pending-unknown`
    /// without mutation. A directional R4 pending is out of scope.
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
            "send-to-workspace-abandon" => return self.evaluate_workspace_abandon(&ctx),
            "directional-move-ack" => return self.evaluate_directional_ack(&ctx),
            "directional-move-verify" => return self.evaluate_directional_verify(&ctx),
            "directional-move-status" => return self.evaluate_directional_status(&ctx),
            "directional-move-cancel" => return self.evaluate_directional_cancel(&ctx),
            _ => {}
        }
        // Full global pending conflict boundary: while either pending exists,
        // every other plan operation blocks (diverged on identity/divergence
        // loss, else `pending-exists`). Ack/verify/status/cancel/abandon above
        // never reach here.
        if let Some(reply) = self.pending_conflict_reply(&ctx) {
            return reply;
        }
        if validated_op(&ctx).as_str() == "send-to-workspace" {
            return self.evaluate_workspace_request(&ctx);
        }
        self.sync_binding(&ctx.owner, &ctx.generation);
        // Typed codec: reconcile/update-gaps/admit/remove/active-group
        // parse once via `SyncCommand` after all boundaries (validation, async
        // dispatch, pending conflict, send dispatch, binding sync) and call the
        // inner bodies directly, eliminating the second `from_value` + op-string
        // check on this production path. The string guard preserves exact
        // unknown/missing/non-string `unknown-value` behavior without a typed
        // parse; malformed known ops during pending never reach here.
        // Move/focus/resize/pointer-resize/toggle-float parse `SyncCommand`
        // once in place inside their handlers (see `SyncCommand` docs for the
        // exact probe/ordering reasons), so these arms dispatch by op string.
        match validated_op(&ctx).as_str() {
            "reconcile" | "update-gaps" | "admit" | "remove" | "active-group" => {
                match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
                    Ok(SyncCommand::Reconcile {}) => self.evaluate_reconcile_inner(&ctx),
                    Ok(SyncCommand::UpdateGaps {}) => self.evaluate_update_gaps_inner(&ctx),
                    Ok(SyncCommand::Admit {
                        window,
                        output,
                        workspace,
                        placement_bounds,
                    }) => self.evaluate_admit_inner(
                        &ctx,
                        &window,
                        &output,
                        &workspace,
                        placement_bounds,
                    ),
                    Ok(SyncCommand::Remove { window }) => self.evaluate_remove_inner(&ctx, &window),
                    Ok(command @ SyncCommand::ActiveGroup {}) => {
                        // Production typed-boundary route: convert the
                        // already-decoded command after all fences, then run
                        // the typed active-group body (no second parse).
                        let core_command =
                            core_command_from_sync(&command).expect("non-verify sync op converts");
                        self.evaluate_active_group_typed(&ctx, &core_command)
                    }
                    // Unreachable: the outer string guard admits only the five
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

    /// Pending conflict boundary for every non-ack/verify plan operation.
    ///
    /// Codec/envelope stays here (validated op token, directional keys, raw
    /// target scope); the outcome itself is the Engine-owned
    /// [`tiler_core::engine::Engine::pending_conflict`] typed entry point,
    /// serialized here so wire bytes stay identical. See the Engine docs for
    /// the exact fence order.
    fn pending_conflict_reply(&self, ctx: &Validated) -> Option<String> {
        let op = validated_op(ctx);
        let directional_keys = ctx.directional_keys.as_deref();
        let raw_target = ctx
            .request
            .target_domain
            .as_ref()
            .map(|target| (target.output.as_str(), target.workspace.as_str()));
        self.engine
            .pending_conflict(
                op.as_str(),
                &ctx.owner,
                &ctx.generation,
                &ctx.domain_key,
                directional_keys,
                raw_target,
            )
            .map(|reply| serialize_core_reply(ctx, &reply))
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

    /// Direct-evaluator compatibility wrapper (test-only): exact legacy
    /// `from_value` + op-check behavior. Production `evaluate` bypasses this
    /// via the typed [`SyncCommand`] single parse + inner below.
    #[cfg(test)]
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
        self.evaluate_admit_inner(
            ctx,
            &command.window,
            &command.output,
            &command.workspace,
            command.placement_bounds.clone(),
        )
    }

    /// Production admit body without a second command parse/op check.
    /// Same boundary contract as [`Self::evaluate_reconcile_inner`].
    fn evaluate_admit_inner(
        &mut self,
        ctx: &Validated,
        window: &str,
        output: &str,
        workspace: &str,
        placement_bounds: Option<RectDto>,
    ) -> String {
        if !is_opaque_id(window) {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "admit-window-invalid",
            );
        }
        if !is_opaque_id(output) {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "admit-output-invalid",
            );
        }
        if !is_opaque_id(workspace) {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "admit-workspace-invalid",
            );
        }
        if output != ctx.request.domain.output || workspace != ctx.request.domain.workspace {
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
            .find(|w| w.window.as_str() == window)
        else {
            return rejected(
                ctx.request.correlation_id.clone(),
                "partial-observation",
                MSG_OBSERVATION,
            );
        };
        if admitted.output.as_str() != output || admitted.workspace.as_str() != workspace {
            return rejected(
                ctx.request.correlation_id.clone(),
                "partial-observation",
                MSG_OBSERVATION,
            );
        };
        let placement_explicit = match &placement_bounds {
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
        // Engine-owned admit orchestration: the validated placement crosses in
        // the typed command; fit fallback, seed ordering, relocation,
        // propose/commit, and store run in `Engine::handle`. Serialization
        // funnels through the typed choke point.
        let core_command = tiler_core::boundary::CoreCommand::Admit {
            window: WindowId(window.to_owned()),
            output: OutputId(output.to_owned()),
            workspace: WorkspaceId(workspace.to_owned()),
            placement_bounds: placement_explicit,
        };
        let event = core_event(ctx, &core_command);
        self.handle_and_serialize(ctx, &event)
    }

    /// Direct-evaluator compatibility wrapper (test-only): exact legacy
    /// `from_value` + op-check behavior. Production `evaluate` bypasses this
    /// via the typed [`SyncCommand`] single parse + inner below.
    #[cfg(test)]
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
        self.evaluate_remove_inner(ctx, &command.window)
    }

    /// Production remove body without a second command parse/op check.
    /// Same boundary contract as [`Self::evaluate_reconcile_inner`].
    fn evaluate_remove_inner(&mut self, ctx: &Validated, window: &str) -> String {
        if !is_opaque_id(window) {
            return snapshot_invalid(
                ctx.request.correlation_id.clone(),
                MSG_OPAQUE_ID,
                "remove-window-invalid",
            );
        }
        // Engine-owned remove orchestration: the validated window crosses in
        // the typed command; seed ordering, relocation, propose/commit, and
        // store run in `Engine::handle`.
        let core_command = tiler_core::boundary::CoreCommand::Remove {
            window: WindowId(window.to_owned()),
        };
        let event = core_event(ctx, &core_command);
        self.handle_and_serialize(ctx, &event)
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
    /// reseeds a session: an unknown domain refuses so the normal admit path
    /// seeds it with the new gaps instead. A simultaneous work-area change
    /// folds into the same projection with reconcile-equivalent safety; a
    /// simultaneous membership change refuses as partial-observation and the
    /// normal admit/remove path owns it.
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

    /// Workspace-send request phase: rebuild the two-domain session from the
    /// observation, propose the same-output distinct-workspace move, and retain
    /// exactly one pending Session. Never auto-acknowledges: the adapter must
    /// send an exact accepted ack and then a matching verified post-observation.
    ///
    /// Codec/scope stays here (shared target scope, tagged command decode,
    /// mover binding in [`Planner::validate_workspace_input`]); the pending
    /// outcome and the seed/propose/stage plan itself are the Engine-owned
    /// [`tiler_core::engine::Engine::handle`] typed entry point over the
    /// validated target scope. The workspace second-send guard runs before
    /// scope validation so error order is preserved (the Engine re-checks
    /// defensively inside `handle` with byte-identical replies).
    fn evaluate_workspace_request(&mut self, ctx: &Validated) -> String {
        if let Some(reply) = self
            .engine
            .workspace_request_guard(&ctx.owner, &ctx.generation)
        {
            return serialize_core_reply(ctx, &reply);
        }
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

    /// Workspace-send acknowledgement phase: exact accepted acknowledgement
    /// against the retained pending Session. Refused ack or binding mismatch is
    /// terminal divergence.
    ///
    /// Codec stays here (tagged decode with the original `ack-op-invalid` /
    /// parse-error fences); the outcome and the fenced acknowledge itself are
    /// the Engine-owned [`Engine::handle`] typed entry point, which retains
    /// the pending for verify.
    fn evaluate_workspace_ack(&mut self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        // Strict tagged decode first (see `SyncCommand`); the outcome,
        // pending, and binding transition below is Engine-owned.
        let command = match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
            Ok(command @ SyncCommand::SendToWorkspaceAck { .. }) => command,
            Ok(_) => {
                return snapshot_invalid(cid, MSG_OPAQUE_ID, "ack-op-invalid");
            }
            Err(error) => {
                if is_unknown_variant(&error) {
                    return snapshot_invalid(cid, MSG_OPAQUE_ID, "ack-op-invalid");
                }
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        let core_command = core_command_from_sync(&command).expect("non-verify sync op converts");
        let event = core_event(ctx, &core_command);
        self.handle_and_serialize(ctx, &event)
    }

    /// Workspace-send verification phase: exact post-observation (preconditions
    /// and operation echoed from the plan) plus a matching fresh observation
    /// commits the pending Session and advances the revision by exactly one.
    /// Pending mismatch or failed verification is terminal divergence.
    ///
    /// Codec and echo parsing stay here (tagged decode with the original
    /// `verify-op-invalid` / parse-error fences, `verified=false` divergence
    /// before nested parse, malformed echoes as `verify-invalid`); the fenced
    /// commit itself is the Engine-owned [`Engine::handle`] typed entry point
    /// over fully validated serde-free typed echoes.
    fn evaluate_workspace_verify(&mut self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        // Strict tagged decode first (see `SyncCommand`); the verified flag
        // and precondition/operation echo parsing below keep their exact
        // legacy positions before any pending handling.
        let (verified, preconditions_raw, operation_raw) =
            match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
                Ok(SyncCommand::SendToWorkspaceVerify {
                    verified,
                    preconditions,
                    operation,
                }) => (verified, preconditions, operation),
                Ok(_) => {
                    return snapshot_invalid(cid, MSG_OPAQUE_ID, "verify-op-invalid");
                }
                Err(error) => {
                    if is_unknown_variant(&error) {
                        return snapshot_invalid(cid, MSG_OPAQUE_ID, "verify-op-invalid");
                    }
                    let (kind, message) = classify_parse_error(&error);
                    return rejected(valid_correlation_echo(&ctx.raw), kind, message);
                }
            };
        if !verified {
            return diverged_reply(
                &cid,
                tiler_core::contract::DivergenceKind::PostconditionUnverified,
            );
        }
        let Some(preconditions) = parse_lifecycle_preconditions(&preconditions_raw) else {
            return rejected(cid, "verify-invalid", "preconditions are invalid");
        };
        let Some(operation) = parse_move_tiled_operation(&operation_raw) else {
            return rejected(cid, "verify-invalid", "operation is invalid");
        };
        let core_command = tiler_core::boundary::CoreCommand::SendVerify {
            verified,
            preconditions,
            operation,
        };
        let event = core_event(ctx, &core_command);
        self.handle_and_serialize(ctx, &event)
    }

    /// Directional R4 acknowledgement phase: exact accepted acknowledgement
    /// against the retained pending pair Session. Refused ack or
    /// identity/correlation/revision mismatch is terminal divergence with no
    /// commit and no canonical split. Strict bounded parsing, no new topology
    /// seeding.
    /// Directional R4 acknowledgement phase: exact accepted acknowledgement
    /// against the retained pending pair Session. Refused ack or
    /// identity/correlation/revision mismatch is terminal divergence with no
    /// commit and no canonical split. Strict bounded parsing, no new topology
    /// seeding.
    ///
    /// Codec stays here (tagged decode with the original `ack-op-invalid` /
    /// parse-error fences); the outcome and the fenced acknowledge itself are
    /// the Engine-owned [`Engine::handle`] typed entry point.
    fn evaluate_directional_ack(&mut self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        // Strict tagged decode first (see `SyncCommand`); the outcome,
        // pending, and binding transition below is Engine-owned.
        let command = match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
            Ok(command @ SyncCommand::DirectionalMoveAck { .. }) => command,
            Ok(_) => {
                return snapshot_invalid(cid, MSG_OPAQUE_ID, "ack-op-invalid");
            }
            Err(error) => {
                if is_unknown_variant(&error) {
                    return snapshot_invalid(cid, MSG_OPAQUE_ID, "ack-op-invalid");
                }
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        let core_command = core_command_from_sync(&command).expect("non-verify sync op converts");
        let event = core_event(ctx, &core_command);
        self.handle_and_serialize(ctx, &event)
    }

    /// Directional R4 verification phase: exact post-observation (operation
    /// and preconditions echoed from the plan) plus a complete matching
    /// source+target observation commits via `Session::verify_move`, then
    /// splits/stores the canonical sessions once and replies `committed`.
    /// Mismatch, refused ack residue, failed verification, or
    /// identity/correlation/revision loss is terminal `diverged` with no
    /// commit. A bare `verified: true` never commits.
    ///
    /// Codec and echo parsing stay here (tagged decode with the original
    /// `verify-op-invalid` / parse-error fences, `verified=false` divergence
    /// before nested parse, malformed echoes as `verify-invalid`); the fenced
    /// commit plus canonical split/store is the Engine-owned [`Engine::handle`]
    /// typed entry point over fully validated serde-free typed echoes.
    fn evaluate_directional_verify(&mut self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        // Strict tagged decode first (see `SyncCommand`); the verified flag
        // and echo parsing below keep their exact legacy positions before any
        // pending handling.
        let (verified, preconditions_raw, operation_raw) =
            match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
                Ok(SyncCommand::DirectionalMoveVerify {
                    verified,
                    preconditions,
                    operation,
                }) => (verified, preconditions, operation),
                Ok(_) => {
                    return snapshot_invalid(cid, MSG_OPAQUE_ID, "verify-op-invalid");
                }
                Err(error) => {
                    if is_unknown_variant(&error) {
                        return snapshot_invalid(cid, MSG_OPAQUE_ID, "verify-op-invalid");
                    }
                    let (kind, message) = classify_parse_error(&error);
                    return rejected(valid_correlation_echo(&ctx.raw), kind, message);
                }
            };
        if !verified {
            return diverged_reply(
                &cid,
                tiler_core::contract::DivergenceKind::PostconditionUnverified,
            );
        }
        let Some(preconditions) = parse_directional_preconditions(&preconditions_raw) else {
            return rejected(cid, "verify-invalid", "preconditions are invalid");
        };
        let Some((operation, echo)) = parse_directional_move_operation(&operation_raw) else {
            return rejected(cid, "verify-invalid", "operation is invalid");
        };
        let core_command = tiler_core::boundary::CoreCommand::DirectionalVerify {
            verified,
            preconditions,
            operation,
            echo_source_output: tiler_core::directional::OutputId(echo.source_output),
            echo_source_workspace: tiler_core::directional::WorkspaceId(echo.source_workspace),
            echo_target_output: tiler_core::directional::OutputId(echo.target_output),
            echo_target_workspace: tiler_core::directional::WorkspaceId(echo.target_workspace),
        };
        let event = core_event(ctx, &core_command);
        self.handle_and_serialize(ctx, &event)
    }

    /// Read-only workspace-send status query: classify the exact retained
    /// [`WorkspacePending`] transaction against a fresh complete observation.
    ///
    /// Codec and scope-shape validation stay here (tagged decode, shared
    /// [`Planner::workspace_target_scope`]); the classification outcome itself
    /// is the Engine-owned [`Engine::inspect`] typed entry point, which takes
    /// `&self` so classification cannot mutate, acknowledge, verify, clear,
    /// rebind, or advance anything. Identity mismatch reports `stale` without
    /// recording divergence; a nonmatching observation reports `unresolved`
    /// (never `mixed`); absent pending reports `no-pending-unknown`, which
    /// cannot imply a commit.
    fn evaluate_workspace_status(&self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        // Strict tagged decode first (see `SyncCommand`); the read-only
        // contract below is untouched.
        let command = match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
            Ok(command @ SyncCommand::SendToWorkspaceStatus {}) => command,
            Ok(_) => {
                return rejected(cid, "status-op-invalid", "status operation is invalid");
            }
            Err(error) => {
                if is_unknown_variant(&error) {
                    return rejected(cid, "status-op-invalid", "status operation is invalid");
                }
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        // A `domains` payload on this route is already refused fail-closed by
        // `validate_request` (`domain-invalid`); only the target scope below
        // remains to bind.
        let (target_domain, target_key) = match self.workspace_target_scope(ctx) {
            Ok(scope) => scope,
            Err(reply) => return reply,
        };
        let core_command = core_command_from_sync(&command).expect("non-verify sync op converts");
        let mut event = core_event(ctx, &core_command);
        event.target_domain = Some((target_domain, target_key));
        let reply = self.engine.inspect(&event);
        serialize_core_reply(ctx, &reply)
    }

    /// Read-only directional R4 status query: classify the exact retained
    /// [`DirectionalMovePending`] transaction against a fresh complete
    /// observation. Codec and pair-shape validation stay here; the outcome is
    /// the Engine-owned [`Engine::inspect`] typed entry point with the same
    /// read-only contract as [`Planner::evaluate_workspace_status`].
    fn evaluate_directional_status(&self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        // Strict tagged decode first (see `SyncCommand`); the read-only
        // contract below is untouched.
        let command = match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
            Ok(command @ SyncCommand::DirectionalMoveStatus {}) => command,
            Ok(_) => {
                return rejected(cid, "status-op-invalid", "status operation is invalid");
            }
            Err(error) => {
                if is_unknown_variant(&error) {
                    return rejected(cid, "status-op-invalid", "status operation is invalid");
                }
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        if directional_pair(ctx).is_none() {
            return snapshot_invalid(cid, MSG_OBSERVATION, "domain-invalid");
        }
        let core_command = core_command_from_sync(&command).expect("non-verify sync op converts");
        let event = core_event(ctx, &core_command);
        let reply = self.engine.inspect(&event);
        serialize_core_reply(ctx, &reply)
    }

    /// Workspace-send cancellation: withdraw the exact retained
    /// [`WorkspacePending`] transaction when the adapter proves, over the
    /// same-UID transport, that its flight dispatched no native write and its
    /// current complete observation still equals the dispatch-time pre-image.
    ///
    /// Codec and scope-shape validation stay here (tagged decode, the
    /// `zero_dispatch` attestation precedence, shared target scope); the fenced
    /// withdraw itself is the Engine-owned [`Engine::handle`] typed entry
    /// point, which clears only the matching pending on exact pre-image proof
    /// and preserves everything committed. Every other state fails closed with
    /// no mutation and no divergence recorded.
    fn evaluate_workspace_cancel(&mut self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        // Strict tagged decode first (see `SyncCommand`); attestation, scope,
        // identity, and withdraw effects below are untouched.
        let command = match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
            Ok(command @ SyncCommand::SendToWorkspaceCancel { .. }) => command,
            Ok(_) => {
                return rejected(cid, "cancel-op-invalid", "cancel operation is invalid");
            }
            Err(error) => {
                if is_unknown_variant(&error) {
                    return rejected(cid, "cancel-op-invalid", "cancel operation is invalid");
                }
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        let SyncCommand::SendToWorkspaceCancel { zero_dispatch } = &command else {
            return rejected(cid, "cancel-op-invalid", "cancel operation is invalid");
        };
        if !zero_dispatch {
            return rejected(cid, "cancel-refused", "adapter attests a native dispatch");
        }
        // A `domains` payload on this route is already refused fail-closed by
        // `validate_request` (`domain-invalid`); only the target scope below
        // remains to bind.
        let (target_domain, target_key) = match self.workspace_target_scope(ctx) {
            Ok(scope) => scope,
            Err(reply) => return reply,
        };
        let core_command = core_command_from_sync(&command).expect("non-verify sync op converts");
        let mut event = core_event(ctx, &core_command);
        event.target_domain = Some((target_domain, target_key));
        self.handle_and_serialize(ctx, &event)
    }

    /// Workspace-send abandon: retire ANY existing workspace-send pending.
    ///
    /// Fenced control op for the accepted 2026-09-25 abandon path (option B).
    /// Codec and scope-shape validation stay here (tagged decode, shared
    /// target scope) and fail closed before any retirement: malformed or
    /// unauthorized requests never retire anything, and a directional R4
    /// pending is out of scope (only the workspace-send slot is read and
    /// cleared via the existing Engine accessors, so no new typed command,
    /// receipts, or retained state cross). Any live workspace-send pending
    /// retires regardless of acked/unacked/diverged state, even on older
    /// generation, other correlation, other same-UID caller, other revision,
    /// or other scope, with no commit claim and without touching Engine
    /// sessions, baselines, or outer gaps. Exact binding (owner, generation,
    /// correlation, retained base or original request revision for a lost
    /// planned reply, and the retained source/target scope) replies
    /// `abandoned`; a mismatched retired live pending replies distinct
    /// `orphan-abandoned` with the requester correlation. Absent pending
    /// replies `no-pending-unknown` with the exact correlation and kind.
    /// A `domains` payload is already refused fail-closed by
    /// `validate_request`.
    fn evaluate_workspace_abandon(&mut self, ctx: &Validated) -> String {
        const ABANDON_KIND: &str = "send-to-workspace";
        let cid = ctx.request.correlation_id.clone();
        match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
            Ok(SyncCommand::SendToWorkspaceAbandon {}) => {}
            Ok(_) => {
                return rejected(cid, "abandon-op-invalid", "abandon operation is invalid");
            }
            Err(error) => {
                if is_unknown_variant(&error) {
                    return rejected(cid, "abandon-op-invalid", "abandon operation is invalid");
                }
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        }
        let (target_domain, _) = match self.workspace_target_scope(ctx) {
            Ok(scope) => scope,
            Err(reply) => return reply,
        };
        let Some(pending) = self.engine.workspace_pending() else {
            return abandon_unknown_reply(&cid, ABANDON_KIND);
        };
        let exact = pending.owner() == &ctx.owner
            && pending.generation() == &ctx.generation
            && pending.correlation() == &ctx.correlation
            && (ctx.request.revision == pending.base_revision()
                || ctx.request.revision == pending.request_revision())
            && {
                let retained = pending.session().domains();
                retained.len() == 2 && retained[0] == ctx.domain && retained[1] == target_domain
            };
        self.engine.clear_workspace_pending();
        if exact {
            abandoned_reply(&cid, ABANDON_KIND)
        } else {
            orphan_abandoned_reply(&cid, ABANDON_KIND)
        }
    }

    /// Directional R4 cancellation: withdraw the exact retained
    /// [`DirectionalMovePending`] transaction under the same contract as
    /// [`Planner::evaluate_workspace_cancel`]. Codec and pair-shape validation
    /// stay here; the fenced withdraw itself is the Engine-owned
    /// [`Engine::handle`] typed entry point. On success the pair
    /// pending clears without splitting or storing: canonical sessions are
    /// exactly preserved.
    fn evaluate_directional_cancel(&mut self, ctx: &Validated) -> String {
        let cid = ctx.request.correlation_id.clone();
        // Strict tagged decode first (see `SyncCommand`); attestation, pair
        // binding, identity, and withdraw effects below are untouched.
        let command = match serde_json::from_value::<SyncCommand>(ctx.request.command.clone()) {
            Ok(command @ SyncCommand::DirectionalMoveCancel { .. }) => command,
            Ok(_) => {
                return rejected(cid, "cancel-op-invalid", "cancel operation is invalid");
            }
            Err(error) => {
                if is_unknown_variant(&error) {
                    return rejected(cid, "cancel-op-invalid", "cancel operation is invalid");
                }
                let (kind, message) = classify_parse_error(&error);
                return rejected(valid_correlation_echo(&ctx.raw), kind, message);
            }
        };
        let SyncCommand::DirectionalMoveCancel { zero_dispatch } = &command else {
            return rejected(cid, "cancel-op-invalid", "cancel operation is invalid");
        };
        if !zero_dispatch {
            return rejected(cid, "cancel-refused", "adapter attests a native dispatch");
        }
        if directional_pair(ctx).is_none() {
            return snapshot_invalid(cid, MSG_OBSERVATION, "domain-invalid");
        }
        let core_command = core_command_from_sync(&command).expect("non-verify sync op converts");
        let event = core_event(ctx, &core_command);
        self.handle_and_serialize(ctx, &event)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg(test)]
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
#[cfg(test)]
struct RemoveCommand {
    op: String,
    window: String,
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
/// Internally tagged on `op` with `deny_unknown_fields` for all twenty
/// command ops: the ten synchronous ops plus `send-to-workspace`, the eight
/// R4 ack/verify/status/cancel phases, and `send-to-workspace-abandon`. Sync
/// handlers parse
/// [`SyncCommand`] once in place after the existing dispatch boundaries
/// (validation, ack/verify/status/cancel/abandon dispatch, pending conflict,
/// send dispatch, binding sync): the production `evaluate` string-guards on
/// the known op before dispatch, so missing/non-string/unknown ops keep the
/// exact `unknown-value` path without a typed parse, and malformed known ops
/// during pending keep `pending-exists` by never reaching here.
/// Transaction handlers parse [`SyncCommand`] once in place at their exact
/// legacy position: `send-to-workspace` keeps target-scope-before-parse in
/// `validate_workspace_input`, ack/verify/status/cancel/abandon keep
/// parse-first at the pre-binding dispatch boundary, status handlers stay
/// read-only (`&self`), cancel/abandon handlers keep their `&mut self`
/// withdraw effects (abandon clears any live workspace-send pending via existing
/// Engine accessors, with no CoreCommand crossing).
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
    #[serde(rename = "admit")]
    Admit {
        window: String,
        output: String,
        workspace: String,
        #[serde(default)]
        placement_bounds: Option<RectDto>,
    },
    #[serde(rename = "remove")]
    Remove { window: String },
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
    #[serde(rename = "send-to-workspace-ack")]
    SendToWorkspaceAck { ack_outcome: String },
    #[serde(rename = "send-to-workspace-verify")]
    SendToWorkspaceVerify {
        verified: bool,
        /// Deferred raw echo: any well-formed JSON decodes here so the
        /// `verified` gate and `verify-invalid` precedence below stay exact;
        /// conversion to [`LifecyclePrecondition`] runs only afterwards via
        /// [`parse_lifecycle_preconditions`].
        preconditions: RawEcho,
        /// Deferred raw echo; conversion to [`LifecycleOperation`] runs only
        /// after the `verified` gate via [`parse_move_tiled_operation`].
        operation: RawEcho,
    },
    #[serde(rename = "send-to-workspace-status")]
    SendToWorkspaceStatus {},
    #[serde(rename = "send-to-workspace-cancel")]
    SendToWorkspaceCancel { zero_dispatch: bool },
    #[serde(rename = "send-to-workspace-abandon")]
    SendToWorkspaceAbandon {},
    #[serde(rename = "directional-move-ack")]
    DirectionalMoveAck { ack_outcome: String },
    #[serde(rename = "directional-move-verify")]
    DirectionalMoveVerify {
        verified: bool,
        /// Deferred raw echo; conversion to the portable directional
        /// preconditions runs only after the `verified` gate via
        /// [`parse_directional_preconditions`].
        preconditions: RawEcho,
        /// Deferred raw echo; conversion to
        /// [`tiler_core::directional::MoveOperation`] plus the fenced wire
        /// DTO runs only after the `verified` gate via
        /// [`parse_directional_move_operation`].
        operation: RawEcho,
    },
    #[serde(rename = "directional-move-status")]
    DirectionalMoveStatus {},
    #[serde(rename = "directional-move-cancel")]
    DirectionalMoveCancel { zero_dispatch: bool },
}

/// Legacy op-mismatch mapping for converted handlers (see [`SyncCommand`]):
/// a tagged-decode `unknown variant` error means the carried op was present
/// but wrong, which the legacy struct parse + op-check reported as the
/// handler's `*-op-invalid` snapshot. All other decode errors keep
/// [`classify_parse_error`] behavior.
fn is_unknown_variant(error: &serde_json::Error) -> bool {
    error.to_string().contains("unknown variant")
}

/// Typed core boundary conversion (deferred for verify).
///
/// Maps the already-decoded [`SyncCommand`] into
/// [`tiler_core::boundary::CoreCommand`] after the existing validation, async
/// dispatch, pending-conflict, send-dispatch, and binding-sync boundaries.
/// Total for the synchronous plus ack/status/cancel routes: clones
/// already-validated values, never validates, never re-parses. Fallible wire
/// vocabularies (direction/mode/ack outcome) cross opaquely so handler-local
/// precedence (`not-tiled`, `ack-refused`, `*-op-invalid`) is untouched.
/// Verify routes are deferred: this returns `None` for both verify variants
/// because their [`RawEcho`] echoes must parse after the `verified` gate into
/// fully validated typed fields (malformed as `verify-invalid`) with the typed
/// verify command constructed directly in the verify evaluators before
/// [`Engine::handle`]. No fabricated placeholder values exist here or in
/// tests. Pending, binding, and transaction state never cross. Directional
/// pair state comes from the validated `directional_domains`/`directional_keys`;
/// the workspace-send target stays route-local (validated `WorkspaceInput`).
fn core_command_from_sync(command: &SyncCommand) -> Option<tiler_core::boundary::CoreCommand> {
    use tiler_core::boundary::CoreCommand;
    use tiler_core::directional::{OutputId, WorkspaceId};
    match command {
        SyncCommand::Reconcile {} => Some(CoreCommand::Reconcile),
        SyncCommand::UpdateGaps {} => Some(CoreCommand::UpdateGaps),
        SyncCommand::Admit {
            window,
            output,
            workspace,
            placement_bounds,
        } => Some(CoreCommand::Admit {
            window: WindowId(window.clone()),
            output: OutputId(output.clone()),
            workspace: WorkspaceId(workspace.clone()),
            placement_bounds: placement_bounds.as_ref().map(|rect| Rect {
                x: rect.x,
                y: rect.y,
                w: rect.w,
                h: rect.h,
            }),
        }),
        SyncCommand::Remove { window } => Some(CoreCommand::Remove {
            window: WindowId(window.clone()),
        }),
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
        SyncCommand::SendToWorkspaceAck { ack_outcome } => Some(CoreCommand::SendAck {
            ack_outcome: ack_outcome.clone(),
        }),
        SyncCommand::SendToWorkspaceVerify { .. } => None,
        SyncCommand::SendToWorkspaceStatus {} => Some(CoreCommand::SendStatus),
        SyncCommand::SendToWorkspaceCancel { zero_dispatch } => Some(CoreCommand::SendCancel {
            zero_dispatch: *zero_dispatch,
        }),
        // Abandon never crosses the typed boundary: the Planner retires the
        // exact pending via Engine accessors without a CoreCommand, so no
        // new retained state, receipts, or Engine mutation beyond the clear.
        SyncCommand::SendToWorkspaceAbandon {} => None,
        SyncCommand::DirectionalMoveAck { ack_outcome } => Some(CoreCommand::DirectionalAck {
            ack_outcome: ack_outcome.clone(),
        }),
        SyncCommand::DirectionalMoveVerify { .. } => None,
        SyncCommand::DirectionalMoveStatus {} => Some(CoreCommand::DirectionalStatus),
        SyncCommand::DirectionalMoveCancel { zero_dispatch } => {
            Some(CoreCommand::DirectionalCancel {
                zero_dispatch: *zero_dispatch,
            })
        }
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
        // The split axis derives from the rebuild target (here the full
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
        // Portrait observed rects must not select a
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
            serde_json::json!({"op": "remove", "window": "win-3"}),
        );
        let retained = parse_reply(&planner.evaluate(&ambiguous));
        assert_eq!(retained["outcome"], "planned", "{retained}");
        assert_geometry_covers(&retained, &["win-1", "win-2"]);
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
        // Recovery: membership divergence discards the domain and rebuilds
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
        // Fail-closed: when no retained topology exists and the observation
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
        // Retained `op=resize` must apply the COSMIC
        // `(10 + 2 + 2 * press_index).min(20)` cap for every u32.
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
    fn retained_pointer_resize_corner_commits_both_axes_in_one_request() {
        // Nested retained layout from two horizontal admits plus one tall
        // admit: root H [win-1 | V[win-2, win-3]] over 1200x800 with the
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
            admit_body("win-3"),
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
            admit_body("win-3"),
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
    }

    #[test]
    fn many_observed_windows_plan_without_count_cap() {
        // No observed-window count cap: 70 windows in one horizontal strip
        // admit through the flat N-ary fit path on a fresh planner. Each
        // carried rectangle is valid, contained, and strictly sequential.
        let names: Vec<String> = (0..70).map(|i| format!("win-{i}")).collect();
        let windows: Vec<(&str, i32, i32, i32, i32)> = names
            .iter()
            .enumerate()
            .map(|(i, name)| (name.as_str(), i as i32 * 17, 0, 10, 800))
            .collect();
        let focused = names.last().expect("names").clone();
        let command = serde_json::json!({"op": "admit", "window": focused, "output": "out-1", "workspace": "ws-1"});
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
    fn typed_sync_codec_admit_remove_active_group_wire_golden() {
        // Wire golden for the typed `SyncCommand` (admit, remove,
        // active-group): valid requests plan byte-exact through the single
        // typed parse + inner path, malformed commands reject byte-exact with
        // unchanged kinds. Literals recorded from the production `evaluate`
        // path (offline, no host mutation).
        let mut planner = Planner::new();
        let admit = retained_request(
            "gold-admit-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-1", "output": "out-1", "workspace": "ws-1"}),
        );
        let text = planner.evaluate(&admit);
        assert_eq!(
            text,
            "{\"v\":1,\"correlation_id\":\"gold-admit-1\",\"outcome\":\"planned\",\"base_revision\":0,\"detail\":{\"capability\":\"admit-tiled\",\"kind\":\"admit\",\"policy_version\":1},\"desired_geometry\":[{\"window\":\"win-1\",\"leaf\":\"leaf-win-1\",\"output\":\"out-1\",\"workspace\":\"ws-1\",\"rect\":{\"x\":0,\"y\":0,\"w\":1200,\"h\":800}}],\"desired_focus\":{\"domain_output\":\"out-1\",\"domain_workspace\":\"ws-1\",\"leaf\":\"leaf-win-1\"}}",
        );
        let admit_extra = retained_request(
            "gold-admit-2",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-1", "output": "out-1", "workspace": "ws-1", "bogus": 1}),
        );
        assert_eq!(
            planner.evaluate(&admit_extra),
            "{\"v\":1,\"correlation_id\":\"gold-admit-2\",\"outcome\":\"rejected\",\"kind\":\"unknown-field\",\"message\":\"request contains an unknown field\"}",
        );
        // Seed a two-window domain, then remove byte-exact.
        let mut planner = Planner::new();
        for (cid, focused, windows, command) in [
            (
                "s1",
                "win-1",
                vec![("win-1", 0, 0, 100, 80)],
                serde_json::json!({"op": "admit", "window": "win-1", "output": "out-1", "workspace": "ws-1"}),
            ),
            (
                "s2",
                "win-2",
                vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                serde_json::json!({"op": "admit", "window": "win-2", "output": "out-1", "workspace": "ws-1"}),
            ),
        ] {
            let reply = parse_reply(&planner.evaluate(&retained_request(
                cid, "owner-1", "gen-1", focused, &windows, command,
            )));
            assert_eq!(reply["outcome"], "planned", "{reply}");
        }
        let remove = retained_request(
            "gold-remove-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "remove", "window": "win-2"}),
        );
        assert_eq!(
            planner.evaluate(&remove),
            "{\"v\":1,\"correlation_id\":\"gold-remove-1\",\"outcome\":\"planned\",\"base_revision\":2,\"detail\":{\"capability\":\"remove-tiled\",\"kind\":\"remove\",\"policy_version\":1},\"desired_geometry\":[{\"window\":\"win-1\",\"leaf\":\"leaf-win-1\",\"output\":\"out-1\",\"workspace\":\"ws-1\",\"rect\":{\"x\":0,\"y\":0,\"w\":1200,\"h\":800}}],\"desired_focus\":{\"domain_output\":\"out-1\",\"domain_workspace\":\"ws-1\",\"leaf\":\"leaf-win-1\"}}",
        );
        let remove_missing = retained_request(
            "gold-remove-2",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
            serde_json::json!({"op": "remove"}),
        );
        assert_eq!(
            planner.evaluate(&remove_missing),
            "{\"v\":1,\"correlation_id\":\"gold-remove-2\",\"outcome\":\"rejected\",\"kind\":\"request-malformed\",\"message\":\"request is malformed\"}",
        );
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
            "{\"v\":1,\"correlation_id\":\"gold-ag-1\",\"outcome\":\"no-group\",\"kind\":\"no-group\",\"base_revision\":3,\"detail\":{\"generation\":\"gen-1\",\"kind\":\"no-group\",\"owner\":\"owner-1\",\"reason\":\"no-parent-group\"}}",
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
    fn typed_boundary_conversion_covers_all_nineteen_ops_total() {
        // Fence proof for the boundary conversion: the 17 non-verify wire ops
        // decode once via `SyncCommand`, then convert into `CoreCommand` with
        // the identical `op` token. Fallible vocabularies (direction/mode/ack)
        // cross opaquely. Both verify echoes arrive as deferred `RawEcho`
        // opaquely at outer decode, defer here (`None`), then parse into fully
        // validated typed fields after the `verified` gate in the verify
        // evaluators before `Engine::handle`; production typed verify
        // construction below uses only real validated echoes, never fabricated
        // placeholders.
        let commands = [
            serde_json::json!({"op": "reconcile"}),
            serde_json::json!({"op": "update-gaps"}),
            serde_json::json!({"op": "admit", "window": "win-1", "output": "out-1", "workspace": "ws-1"}),
            serde_json::json!({"op": "remove", "window": "win-1"}),
            serde_json::json!({"op": "active-group"}),
            serde_json::json!({"op": "move", "window": "win-1", "direction": "left"}),
            serde_json::json!({"op": "focus", "window": "win-1", "direction": "left"}),
            serde_json::json!({"op": "resize", "window": "win-1", "direction": "left", "mode": "inwards", "press_index": 0}),
            serde_json::json!({"op": "pointer-resize", "window": "win-1", "direction": "left", "boundary": 10}),
            serde_json::json!({"op": "toggle-float", "window": "win-1"}),
            serde_json::json!({"op": "send-to-workspace", "window": "win-1", "target_output": "out-1", "target_workspace": "ws-2"}),
            serde_json::json!({"op": "send-to-workspace-ack", "ack_outcome": "accepted"}),
            serde_json::json!({"op": "send-to-workspace-status"}),
            serde_json::json!({"op": "send-to-workspace-cancel", "zero_dispatch": false}),
            serde_json::json!({"op": "directional-move-ack", "ack_outcome": "accepted"}),
            serde_json::json!({"op": "directional-move-status"}),
            serde_json::json!({"op": "directional-move-cancel", "zero_dispatch": false}),
        ];
        assert_eq!(commands.len(), 17);
        let mut ops = std::collections::HashSet::new();
        for command in &commands {
            let decoded: SyncCommand =
                serde_json::from_value(command.clone()).expect("wire op decodes");
            let converted = core_command_from_sync(&decoded).expect("non-verify op converts");
            let expected = command.get("op").and_then(|op| op.as_str()).expect("op");
            assert_eq!(converted.op(), expected);
            ops.insert(converted.op());
        }
        assert_eq!(ops.len(), 17);
        // Verify wire tokens decode; conversion defers (`None`).
        let ws_verify = serde_json::json!({"op": "send-to-workspace-verify", "verified": true, "preconditions": ["window-observed", "desired-topology-valid", "adapter-must-verify-postconditions"], "operation": {"op": "move-tiled", "window": "win-1", "leaf": "leaf-1", "source_output": "out-1", "source_workspace": "ws-1", "target_output": "out-1", "target_workspace": "ws-2"}});
        let decoded: SyncCommand =
            serde_json::from_value(ws_verify.clone()).expect("verify op decodes");
        assert!(matches!(decoded, SyncCommand::SendToWorkspaceVerify { .. }));
        assert!(core_command_from_sync(&decoded).is_none());
        // Production typed construction from the real validated echoes above.
        if let SyncCommand::SendToWorkspaceVerify {
            verified,
            preconditions,
            operation,
        } = decoded
        {
            let typed_pre = parse_lifecycle_preconditions(&preconditions)
                .expect("real workspace echoes validate");
            let typed_op =
                parse_move_tiled_operation(&operation).expect("real workspace op validates");
            let typed = tiler_core::boundary::CoreCommand::SendVerify {
                verified,
                preconditions: typed_pre,
                operation: typed_op,
            };
            assert_eq!(typed.op(), "send-to-workspace-verify");
        } else {
            panic!("expected SendToWorkspaceVerify");
        }
        let dir_verify = serde_json::json!({"op": "directional-move-verify", "verified": true, "preconditions": ["focused-leaf-occupied-by-focused-window", "adapter-must-verify-postconditions"], "operation": {"op": "move", "rule": "R4", "capability": "CrossOutputTransfer", "direction": "right", "window": "win-1", "leaf": "leaf-1", "source_output": "out-1", "source_workspace": "ws-1", "target_output": "out-2", "target_workspace": "ws-1", "source_root_child_index": 0, "target": "empty"}});
        let decoded: SyncCommand =
            serde_json::from_value(dir_verify.clone()).expect("verify op decodes");
        assert!(matches!(decoded, SyncCommand::DirectionalMoveVerify { .. }));
        assert!(core_command_from_sync(&decoded).is_none());
        if let SyncCommand::DirectionalMoveVerify {
            verified,
            preconditions,
            operation,
        } = decoded
        {
            let typed_pre = parse_directional_preconditions(&preconditions)
                .expect("real directional echoes validate");
            let (typed_op, echo) = parse_directional_move_operation(&operation)
                .expect("real directional op validates");
            let typed = tiler_core::boundary::CoreCommand::DirectionalVerify {
                verified,
                preconditions: typed_pre,
                operation: typed_op,
                echo_source_output: tiler_core::directional::OutputId(echo.source_output),
                echo_source_workspace: tiler_core::directional::WorkspaceId(echo.source_workspace),
                echo_target_output: tiler_core::directional::OutputId(echo.target_output),
                echo_target_workspace: tiler_core::directional::WorkspaceId(echo.target_workspace),
            };
            assert_eq!(typed.op(), "directional-move-verify");
        } else {
            panic!("expected DirectionalMoveVerify");
        }
        assert_eq!(ops.len() + 2, 19);
        // Opaque crossings: unknown direction/mode/ack strings convert without
        // validation; handlers own precedence. Bogus verify echoes decode
        // opaquely at the outer `SyncCommand` boundary (deferred `RawEcho`)
        // yet still defer here; the verify evaluators gate `verified=false`
        // before nested parsing and map malformed echoes to `verify-invalid`
        // before any `Engine::handle` transition.
        let decoded: SyncCommand = serde_json::from_value(
            serde_json::json!({"op": "move", "window": "win-1", "direction": "sideways"}),
        )
        .expect("decodes");
        assert!(matches!(
            core_command_from_sync(&decoded).expect("non-verify converts"),
            tiler_core::boundary::CoreCommand::Move { direction, .. } if direction == "sideways"
        ));
        let decoded: SyncCommand = serde_json::from_value(serde_json::json!({
            "op": "send-to-workspace-verify",
            "verified": false,
            "preconditions": "bogus",
            "operation": "bogus",
        }))
        .expect("deferred echo decodes opaquely");
        assert!(core_command_from_sync(&decoded).is_none());
    }
    #[test]
    fn core_reply_choke_point_matches_legacy_constructors_byte_exact() {
        // Proof that `serialize_core_reply` is a byte-exact funnel for every
        // `CoreReply` shape: each arm must equal its legacy constructor.
        // Production-real arms (Projection, Tiled admit/remove,
        // ActiveGroup/NoGroup) are additionally covered by wire goldens
        // through `evaluate`; the remaining arms pin bytes here until their
        // routes migrate.
        use tiler_core::boundary::{
            CoreReply, NoGroupReason, ProjectionKind, ProjectionPlan, TiledKind, TiledPlan,
            TransactionKind, TransactionStatus,
        };
        use tiler_core::contract::DivergenceKind;
        let request = retained_request(
            "core-reply-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-1", "output": "out-1", "workspace": "ws-1"}),
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
        assert_eq!(
            serialize_core_reply(
                &ctx,
                &CoreReply::Status {
                    base_revision: Some(3),
                    status: TransactionStatus::PostUnacked,
                }
            ),
            status_reply("core-reply-1", Some(3), "post-unacked"),
        );
        assert_eq!(
            serialize_core_reply(
                &ctx,
                &CoreReply::Status {
                    base_revision: None,
                    status: TransactionStatus::NoPendingUnknown,
                }
            ),
            status_reply("core-reply-1", None, "no-pending-unknown"),
        );
        assert_eq!(
            serialize_core_reply(
                &ctx,
                &CoreReply::Acknowledged {
                    base_revision: 3,
                    kind: TransactionKind::SendToWorkspace,
                }
            ),
            "{\"v\":1,\"correlation_id\":\"core-reply-1\",\"outcome\":\"acknowledged\",\"kind\":\"send-to-workspace\",\"base_revision\":3}",
        );
        assert_eq!(
            serialize_core_reply(
                &ctx,
                &CoreReply::Committed {
                    revision: 4,
                    kind: TransactionKind::DirectionalMove,
                }
            ),
            "{\"v\":1,\"correlation_id\":\"core-reply-1\",\"outcome\":\"committed\",\"kind\":\"directional-move\",\"base_revision\":4}",
        );
        assert_eq!(
            serialize_core_reply(
                &ctx,
                &CoreReply::Cancelled {
                    base_revision: 3,
                    kind: TransactionKind::SendToWorkspace,
                }
            ),
            cancelled_reply("core-reply-1", "send-to-workspace", 3),
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
            kind: TiledKind::Remove,
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
            serde_json::json!({"op": "admit", "window": "win-1", "output": "out-1", "workspace": "ws-1"}),
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
    fn transaction_choke_point_matches_legacy_shapes_byte_exact() {
        // Byte pins for the migrated transaction family: workspace-send
        // planned (typed `SendWorkspacePlan` vs the legacy constructor) plus
        // the ack/commit/cancel/status outcomes for both transaction kinds
        // that the sync-family test does not cover. The existing workspace
        // and directional R4 wire goldens prove the same bytes flow end to
        // end through `evaluate`.
        use tiler_core::boundary::{
            CoreReply, SendWorkspacePlan, TransactionKind, TransactionStatus,
        };
        use tiler_core::contract::{
            LifecycleCapability, LifecycleIntent, LifecycleOperation, LifecyclePrecondition,
        };
        let request = retained_request(
            "core-txn-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-1", "output": "out-1", "workspace": "ws-1"}),
        );
        let ctx = validate_request(&request).expect("fixture validates");
        let plan = tiler_core::session::SessionPlan {
            dispatch: tiler_core::contract::LifecycleDispatch {
                correlation_id: ctx.correlation.clone(),
                owner: ctx.owner.clone(),
                generation: ctx.generation.clone(),
                base_revision: 2,
                required_capability: LifecycleCapability::MoveTiled,
                preconditions: vec![
                    LifecyclePrecondition::WindowObserved,
                    LifecyclePrecondition::DesiredTopologyValid,
                    LifecyclePrecondition::AdapterMustVerifyPostconditions,
                ],
                intent: LifecycleIntent::MoveToWorkspace {
                    window: WindowId::from("win-1"),
                    target_output: OutputId::from("out-1"),
                    target_workspace: WorkspaceId::from("ws-2"),
                },
                operation: LifecycleOperation::MoveTiled {
                    window: WindowId::from("win-1"),
                    leaf: NodeId::from("leaf-1"),
                    source_output: OutputId::from("out-1"),
                    source_workspace: WorkspaceId::from("ws-1"),
                    target_output: OutputId::from("out-1"),
                    target_workspace: WorkspaceId::from("ws-2"),
                },
                policy_version: 1,
            },
            desired_snapshot: tiler_core::session::SessionSnapshot {
                domains: Vec::new(),
                windows: Vec::new(),
            },
            desired_focus_domain: Some(ctx.domain_key.clone()),
            desired_focus_leaf: Some(NodeId::from("leaf-1")),
            desired_geometry: Vec::new(),
        };
        let typed = SendWorkspacePlan::from_session(&plan).expect("move-tiled builds");
        assert_eq!(
            serialize_core_reply(&ctx, &CoreReply::SendWorkspace(typed.clone())),
            workspace_planned_reply("core-txn-1", &plan),
        );
        assert_eq!(
            serialize_send_workspace_reply("core-txn-1", &typed),
            workspace_planned_reply("core-txn-1", &plan),
        );
        // The non-`MoveTiled` fallback stays a `move-op-invalid` fence.
        let mut admit = plan.clone();
        admit.dispatch.operation = LifecycleOperation::Remove {
            window: WindowId::from("win-1"),
            leaf: NodeId::from("leaf-1"),
            output: OutputId::from("out-1"),
            workspace: WorkspaceId::from("ws-1"),
        };
        assert!(SendWorkspacePlan::from_session(&admit).is_none());
        assert_eq!(
            serialize_core_reply(
                &ctx,
                &CoreReply::Acknowledged {
                    base_revision: 3,
                    kind: TransactionKind::DirectionalMove,
                }
            ),
            "{\"v\":1,\"correlation_id\":\"core-txn-1\",\"outcome\":\"acknowledged\",\"kind\":\"directional-move\",\"base_revision\":3}",
        );
        assert_eq!(
            serialize_core_reply(
                &ctx,
                &CoreReply::Committed {
                    revision: 4,
                    kind: TransactionKind::SendToWorkspace,
                }
            ),
            "{\"v\":1,\"correlation_id\":\"core-txn-1\",\"outcome\":\"committed\",\"kind\":\"send-to-workspace\",\"base_revision\":4}",
        );
        assert_eq!(
            serialize_core_reply(
                &ctx,
                &CoreReply::Cancelled {
                    base_revision: 3,
                    kind: TransactionKind::DirectionalMove,
                }
            ),
            cancelled_reply("core-txn-1", "directional-move", 3),
        );
        for (status, token) in [
            (TransactionStatus::PostUnacked, "post-unacked"),
            (TransactionStatus::PostAcked, "post-acked"),
            (TransactionStatus::Unresolved, "unresolved"),
            (TransactionStatus::Stale, "stale"),
        ] {
            assert_eq!(
                serialize_core_reply(
                    &ctx,
                    &CoreReply::Status {
                        base_revision: Some(3),
                        status,
                    }
                ),
                status_reply("core-txn-1", Some(3), token),
                "{token} funnels byte-exact",
            );
        }
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
                    serde_json::json!({"op": "admit", "window": "win-1", "output": "out-1", "workspace": "ws-1"}),
                ),
                (
                    "s2",
                    "win-2",
                    vec![("win-1", 0, 0, 100, 80), ("win-2", 200, 0, 100, 80)],
                    serde_json::json!({"op": "admit", "window": "win-2", "output": "out-1", "workspace": "ws-1"}),
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
    fn typed_transaction_codec_workspace_wire_golden() {
        // Wire golden for the tagged `SyncCommand` conversion of the
        // workspace-send route: full request/ack/verify lifecycle plus
        // read-only status and cancel, byte-exact through the in-place typed
        // parse. Malformed commands reject byte-exact with unchanged kinds;
        // scope-before-parse order is unchanged (`send-to-workspace` still
        // validates the target scope first). Literals recorded from the
        // production `evaluate` path before the switch (offline).
        let source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let mut planner = Planner::new();
        let planned_str = planner.evaluate(&workspace_request(
            "gold-ws-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source.clone(),
            target.clone(),
            workspace_send_body(),
        ));
        assert_eq!(
            planned_str,
            "{\"v\":1,\"correlation_id\":\"gold-ws-1\",\"outcome\":\"planned\",\"kind\":\"send-to-workspace\",\"base_revision\":3,\"detail\":{\"capability\":\"move-tiled\",\"kind\":\"send-to-workspace\",\"policy_version\":1},\"desired_geometry\":[{\"window\":\"win-2\",\"leaf\":\"leaf-win-2\",\"output\":\"out-1\",\"workspace\":\"ws-1\",\"rect\":{\"x\":0,\"y\":0,\"w\":1200,\"h\":800}},{\"window\":\"win-1\",\"leaf\":\"leaf-win-1\",\"output\":\"out-1\",\"workspace\":\"ws-2\",\"rect\":{\"x\":600,\"y\":0,\"w\":600,\"h\":800}},{\"window\":\"win-t1\",\"leaf\":\"leaf-win-t1\",\"output\":\"out-1\",\"workspace\":\"ws-2\",\"rect\":{\"x\":0,\"y\":0,\"w\":600,\"h\":800}}],\"desired_focus\":{\"domain_output\":\"out-1\",\"domain_workspace\":\"ws-2\",\"leaf\":\"leaf-win-1\"},\"preconditions\":[\"window-observed\",\"desired-topology-valid\",\"adapter-must-verify-postconditions\"],\"operation\":{\"leaf\":\"leaf-win-1\",\"op\":\"move-tiled\",\"source_output\":\"out-1\",\"source_workspace\":\"ws-1\",\"target_output\":\"out-1\",\"target_workspace\":\"ws-2\",\"window\":\"win-1\"}}",
        );
        let planned = parse_reply(&planned_str);
        let base = planned["base_revision"].as_u64().expect("base");
        let (post_source, post_target) = observation_from_geometry(&planned["desired_geometry"]);
        let post = |command: serde_json::Value| {
            workspace_request(
                "gold-ws-1",
                "owner-1",
                "gen-1",
                base,
                "",
                post_source.clone(),
                post_target.clone(),
                command,
            )
        };
        assert_eq!(
            planner.evaluate(&post(serde_json::json!({"op": "send-to-workspace-status"}))),
            "{\"v\":1,\"correlation_id\":\"gold-ws-1\",\"outcome\":\"status\",\"kind\":\"post-unacked\",\"base_revision\":3}",
        );
        assert_eq!(
            planner.evaluate(&post(workspace_ack_body())),
            "{\"v\":1,\"correlation_id\":\"gold-ws-1\",\"outcome\":\"acknowledged\",\"kind\":\"send-to-workspace\",\"base_revision\":3}",
        );
        assert_eq!(
            planner.evaluate(&post(serde_json::json!({"op": "send-to-workspace-status"}))),
            "{\"v\":1,\"correlation_id\":\"gold-ws-1\",\"outcome\":\"status\",\"kind\":\"post-acked\",\"base_revision\":3}",
        );
        assert_eq!(
            planner.evaluate(&post(workspace_verify_body(
                planned["preconditions"].clone(),
                planned["operation"].clone()
            ))),
            "{\"v\":1,\"correlation_id\":\"gold-ws-1\",\"outcome\":\"committed\",\"kind\":\"send-to-workspace\",\"base_revision\":4}",
        );
        // Malformed commands reject before any scope/pending handling, with
        // unchanged kinds.
        let mut fresh = Planner::new();
        let malformed = [
            (
                "gold-ws-2",
                serde_json::json!({"op": "send-to-workspace", "window": "win-1", "target_output": "out-1", "target_workspace": "ws-2", "bogus": 1}),
                "{\"v\":1,\"correlation_id\":\"gold-ws-2\",\"outcome\":\"rejected\",\"kind\":\"unknown-field\",\"message\":\"request contains an unknown field\"}",
            ),
            (
                "gold-ws-3",
                serde_json::json!({"op": "send-to-workspace-ack", "ack_outcome": "accepted", "bogus": 1}),
                "{\"v\":1,\"correlation_id\":\"gold-ws-3\",\"outcome\":\"rejected\",\"kind\":\"unknown-field\",\"message\":\"request contains an unknown field\"}",
            ),
            (
                "gold-ws-4",
                serde_json::json!({"op": "send-to-workspace-verify", "verified": true, "preconditions": []}),
                "{\"v\":1,\"correlation_id\":\"gold-ws-4\",\"outcome\":\"rejected\",\"kind\":\"request-malformed\",\"message\":\"request is malformed\"}",
            ),
            (
                "gold-ws-5",
                serde_json::json!({"op": "send-to-workspace-status", "bogus": 1}),
                "{\"v\":1,\"correlation_id\":\"gold-ws-5\",\"outcome\":\"rejected\",\"kind\":\"unknown-field\",\"message\":\"request contains an unknown field\"}",
            ),
            (
                "gold-ws-6",
                serde_json::json!({"op": "send-to-workspace-cancel"}),
                "{\"v\":1,\"correlation_id\":\"gold-ws-6\",\"outcome\":\"rejected\",\"kind\":\"request-malformed\",\"message\":\"request is malformed\"}",
            ),
        ];
        for (cid, command, expected) in malformed {
            let reply = fresh.evaluate(&workspace_request(
                cid,
                "owner-1",
                "gen-1",
                0,
                if cid == "gold-ws-2" { "win-1" } else { "" },
                source.clone(),
                target.clone(),
                command,
            ));
            assert_eq!(reply, expected, "{cid}");
        }
        // Read-only status with no retained transaction.
        assert_eq!(
            fresh.evaluate(&workspace_request(
                "gold-ws-7",
                "owner-1",
                "gen-1",
                0,
                "",
                source.clone(),
                target.clone(),
                serde_json::json!({"op": "send-to-workspace-status"}),
            )),
            "{\"v\":1,\"correlation_id\":\"gold-ws-7\",\"outcome\":\"status\",\"kind\":\"no-pending-unknown\"}",
        );
        // Cancel withdraws the staged pending on exact pre-image proof.
        let mut canceller = Planner::new();
        let staged = canceller.evaluate(&workspace_request(
            "gold-ws-8",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source.clone(),
            target.clone(),
            workspace_send_body(),
        ));
        assert_eq!(parse_reply(&staged)["outcome"], "planned", "{staged}");
        assert_eq!(
            canceller.evaluate(&workspace_request(
                "gold-ws-8",
                "owner-1",
                "gen-1",
                0,
                "win-1",
                source,
                target,
                serde_json::json!({"op": "send-to-workspace-cancel", "zero_dispatch": true}),
            )),
            "{\"v\":1,\"correlation_id\":\"gold-ws-8\",\"outcome\":\"cancelled\",\"kind\":\"send-to-workspace\",\"base_revision\":3}",
        );
        // Directional phases reject malformed commands before any pair
        // binding or pending handling, with unchanged kinds.
        let directional_malformed = [
            (
                "gold-dir-1",
                serde_json::json!({"op": "directional-move-ack", "ack_outcome": "accepted", "bogus": 1}),
                "{\"v\":1,\"correlation_id\":\"gold-dir-1\",\"outcome\":\"rejected\",\"kind\":\"unknown-field\",\"message\":\"request contains an unknown field\"}",
            ),
            (
                "gold-dir-2",
                serde_json::json!({"op": "directional-move-verify", "verified": true, "preconditions": []}),
                "{\"v\":1,\"correlation_id\":\"gold-dir-2\",\"outcome\":\"rejected\",\"kind\":\"request-malformed\",\"message\":\"request is malformed\"}",
            ),
            (
                "gold-dir-3",
                serde_json::json!({"op": "directional-move-status", "bogus": 1}),
                "{\"v\":1,\"correlation_id\":\"gold-dir-3\",\"outcome\":\"rejected\",\"kind\":\"unknown-field\",\"message\":\"request contains an unknown field\"}",
            ),
            (
                "gold-dir-4",
                serde_json::json!({"op": "directional-move-cancel"}),
                "{\"v\":1,\"correlation_id\":\"gold-dir-4\",\"outcome\":\"rejected\",\"kind\":\"request-malformed\",\"message\":\"request is malformed\"}",
            ),
        ];
        for (cid, command, expected) in directional_malformed {
            let reply = fresh.evaluate(&plan_request(cid, "win-1", &["win-1"], command));
            assert_eq!(reply, expected, "{cid}");
        }
    }
    #[test]
    fn verify_echo_typed_boundary_wire_golden() {
        // Byte-level golden for the verify echo boundary (workspace-send
        // route): malformed nested preconditions/operation reject as
        // `verify-invalid` before any pending handling, `verified: false`
        // diverges before echo parsing, and the exact echo still commits.
        // Literals recorded from the production `evaluate` path (offline, no
        // host mutation); the typed `SyncCommand` conversion must reproduce
        // them byte-exact.
        let source = vec![
            workspace_entry("win-1", "ws-1", 0),
            workspace_entry("win-2", "ws-1", 100),
        ];
        let target = vec![workspace_entry("win-t1", "ws-2", 0)];
        let mut planner = Planner::new();
        let planned = parse_reply(&planner.evaluate(&workspace_request(
            "gold-verify-1",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source.clone(),
            target.clone(),
            workspace_send_body(),
        )));
        assert_eq!(planned["outcome"], "planned", "{planned}");
        let base = planned["base_revision"].as_u64().expect("base");
        let (post_source, post_target) = observation_from_geometry(&planned["desired_geometry"]);
        let post = |cid: &str, command: serde_json::Value| {
            workspace_request(
                cid,
                "owner-1",
                "gen-1",
                base,
                "",
                post_source.clone(),
                post_target.clone(),
                command,
            )
        };
        assert_eq!(
            planner.evaluate(&post("gold-verify-1", workspace_ack_body())),
            format!(
                "{{\"v\":1,\"correlation_id\":\"gold-verify-1\",\"outcome\":\"acknowledged\",\"kind\":\"send-to-workspace\",\"base_revision\":{base}}}"
            ),
        );
        let good_pre = planned["preconditions"].clone();
        let good_op = planned["operation"].clone();
        // Malformed nested echoes reject as `verify-invalid` before any
        // pending handling, so the staged pending survives every probe below
        // and the exact echo still commits afterwards.
        let malformed = [
            (
                "gold-verify-2",
                serde_json::json!({"op": "send-to-workspace-verify", "verified": true, "preconditions": "window-observed", "operation": good_op}),
                "{\"v\":1,\"correlation_id\":\"gold-verify-2\",\"outcome\":\"rejected\",\"kind\":\"verify-invalid\",\"message\":\"preconditions are invalid\"}",
            ),
            (
                "gold-verify-3",
                serde_json::json!({"op": "send-to-workspace-verify", "verified": true, "preconditions": ["window-observed", 7], "operation": good_op}),
                "{\"v\":1,\"correlation_id\":\"gold-verify-3\",\"outcome\":\"rejected\",\"kind\":\"verify-invalid\",\"message\":\"preconditions are invalid\"}",
            ),
            (
                "gold-verify-4",
                serde_json::json!({"op": "send-to-workspace-verify", "verified": true, "preconditions": ["bogus-token"], "operation": good_op}),
                "{\"v\":1,\"correlation_id\":\"gold-verify-4\",\"outcome\":\"rejected\",\"kind\":\"verify-invalid\",\"message\":\"preconditions are invalid\"}",
            ),
            (
                "gold-verify-5",
                serde_json::json!({"op": "send-to-workspace-verify", "verified": true, "preconditions": [], "operation": good_op}),
                "{\"v\":1,\"correlation_id\":\"gold-verify-5\",\"outcome\":\"rejected\",\"kind\":\"verify-invalid\",\"message\":\"preconditions are invalid\"}",
            ),
            (
                "gold-verify-6",
                serde_json::json!({"op": "send-to-workspace-verify", "verified": true, "preconditions": good_pre, "operation": []}),
                "{\"v\":1,\"correlation_id\":\"gold-verify-6\",\"outcome\":\"rejected\",\"kind\":\"verify-invalid\",\"message\":\"operation is invalid\"}",
            ),
            (
                "gold-verify-7",
                serde_json::json!({"op": "send-to-workspace-verify", "verified": true, "preconditions": good_pre, "operation": {"op": "move-tiled", "leaf": "leaf-win-1", "source_output": "out-1", "source_workspace": "ws-1", "target_output": "out-1", "target_workspace": "ws-2"}}),
                "{\"v\":1,\"correlation_id\":\"gold-verify-7\",\"outcome\":\"rejected\",\"kind\":\"verify-invalid\",\"message\":\"operation is invalid\"}",
            ),
            (
                "gold-verify-8",
                serde_json::json!({"op": "send-to-workspace-verify", "verified": true, "preconditions": good_pre, "operation": {"op": "move-tiled", "leaf": "leaf-win-1", "source_output": "out-1", "source_workspace": "ws-1", "target_output": "out-1", "target_workspace": "ws-2", "window": ""}}),
                "{\"v\":1,\"correlation_id\":\"gold-verify-8\",\"outcome\":\"rejected\",\"kind\":\"verify-invalid\",\"message\":\"operation is invalid\"}",
            ),
            (
                "gold-verify-9",
                serde_json::json!({"op": "send-to-workspace-verify", "verified": true, "preconditions": good_pre, "operation": {"op": "move", "leaf": "leaf-win-1", "source_output": "out-1", "source_workspace": "ws-1", "target_output": "out-1", "target_workspace": "ws-2", "window": "win-1"}}),
                "{\"v\":1,\"correlation_id\":\"gold-verify-9\",\"outcome\":\"rejected\",\"kind\":\"verify-invalid\",\"message\":\"operation is invalid\"}",
            ),
        ];
        for (cid, command, expected) in malformed {
            assert_eq!(planner.evaluate(&post(cid, command)), expected, "{cid}");
        }
        // The `verified` flag gates before echo parsing: an unverified report
        // with garbage echoes diverges as postcondition-unverified, never
        // `verify-invalid`.
        assert_eq!(
            planner.evaluate(&post(
                "gold-verify-10",
                serde_json::json!({"op": "send-to-workspace-verify", "verified": false, "preconditions": [7], "operation": []}),
            )),
            "{\"v\":1,\"correlation_id\":\"gold-verify-10\",\"outcome\":\"diverged\",\"kind\":\"postcondition-unverified\",\"message\":\"adapter did not verify postconditions\"}",
        );
        // The exact echo still commits after every probe above: echo parsing
        // never consumed the pending.
        assert_eq!(
            planner.evaluate(&post(
                "gold-verify-1",
                workspace_verify_body(good_pre.clone(), good_op.clone()),
            )),
            format!(
                "{{\"v\":1,\"correlation_id\":\"gold-verify-1\",\"outcome\":\"committed\",\"kind\":\"send-to-workspace\",\"base_revision\":{}}}",
                base + 1
            ),
        );
        // Echo parsing precedes pending checks: malformed echoes on a planner
        // with no pending report `verify-invalid`, never `no-pending`.
        let mut fresh = Planner::new();
        assert_eq!(
            fresh.evaluate(&post(
                "gold-verify-11",
                serde_json::json!({"op": "send-to-workspace-verify", "verified": true, "preconditions": [7], "operation": good_op}),
            )),
            "{\"v\":1,\"correlation_id\":\"gold-verify-11\",\"outcome\":\"rejected\",\"kind\":\"verify-invalid\",\"message\":\"preconditions are invalid\"}",
        );
        // Extra fencing fields stay lenient: the exact echo plus one unknown
        // nested field still commits on a freshly staged lifecycle.
        let mut lenient = Planner::new();
        let staged = parse_reply(&lenient.evaluate(&workspace_request(
            "gold-verify-12",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            source,
            target,
            workspace_send_body(),
        )));
        assert_eq!(staged["outcome"], "planned", "{staged}");
        let staged_base = staged["base_revision"].as_u64().expect("base");
        let (lenient_source, lenient_target) =
            observation_from_geometry(&staged["desired_geometry"]);
        let lenient_post = |cid: &str, command: serde_json::Value| {
            workspace_request(
                cid,
                "owner-1",
                "gen-1",
                staged_base,
                "",
                lenient_source.clone(),
                lenient_target.clone(),
                command,
            )
        };
        assert_eq!(
            parse_reply(&lenient.evaluate(&lenient_post("gold-verify-12", workspace_ack_body())))["outcome"],
            "acknowledged",
        );
        let mut extra_op = staged["operation"].clone();
        extra_op["bogus"] = serde_json::json!(1);
        assert_eq!(
            lenient.evaluate(&lenient_post(
                "gold-verify-12",
                workspace_verify_body(staged["preconditions"].clone(), extra_op),
            )),
            format!(
                "{{\"v\":1,\"correlation_id\":\"gold-verify-12\",\"outcome\":\"committed\",\"kind\":\"send-to-workspace\",\"base_revision\":{}}}",
                staged_base + 1
            ),
        );
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
    fn admit_honors_satisfiable_minimum_from_observed_hints() {
        let mut planner = seed_two_window_planner();
        // Wide placement forces a horizontal split of the focused leaf;
        // win-3 needs 400 wide, so win-1 yields inside the new pair.
        let mut hints = std::collections::BTreeMap::new();
        hints.insert("win-3", (Some((400, 10)), None));
        let request: serde_json::Value = serde_json::from_str(&retained_request_with_hints(
            "rec-admit-hint",
            "owner-1",
            "gen-1",
            "win-1",
            &[
                ("win-1", 0, 0, 100, 80),
                ("win-2", 200, 0, 100, 80),
                ("win-3", 400, 0, 100, 80),
            ],
            &hints,
            serde_json::json!({
                "op": "admit",
                "window": "win-3",
                "output": "out-1",
                "workspace": "ws-1",
                "placement_bounds": {"x": 0, "y": 0, "w": 400, "h": 100},
            }),
        ))
        .expect("valid request");
        // Admit through the normal path with the hinted observation.
        let reply = parse_reply(&planner.evaluate(&request.to_string()));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        let geometry = geometry_by_window(&reply);
        assert_eq!(geometry.len(), 3, "{reply}");
        let win3 = geometry["win-3"];
        assert!(win3.2 >= 400, "admitted minimum honored: {reply}");
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
    fn remove_with_current_post_removal_observation_replies_idempotent() {
        // KWin sends the current post-removal observation: the requested
        // window already departed in convergence, so the remove replies with
        // the complete converged projection (remove capability, valid focus)
        // instead of `unknown-window`, with no extra commit.
        let mut planner = seed_two_window_planner();
        let request = retained_request(
            "rem-post-1",
            "owner-1",
            "gen-1",
            "win-1",
            &[("win-1", 0, 0, 100, 80)],
            serde_json::json!({"op": "remove", "window": "win-2"}),
        );
        let reply = parse_reply(&planner.evaluate(&request));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(reply["detail"]["kind"], "remove", "{reply}");
        assert_geometry_covers(&reply, &["win-1"]);
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

    fn workspace_abandon_body() -> serde_json::Value {
        serde_json::json!({"op": "send-to-workspace-abandon"})
    }

    fn workspace_abandon_request(
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
    fn workspace_abandon_retires_exact_pending_regardless_state_without_commit() {
        // Exact abandon retires the pending whether unacked, acked, or
        // diverged, with no commit claim, geometry, operation, or setter
        // replay. The fenced retry with no pending is correlated
        // `no-pending-unknown`.
        for (id, setup) in [("unacked", 0u8), ("acked", 1u8), ("diverged", 2u8)] {
            let mut planner = Planner::new();
            let correlation = format!("ws-abandon-{id}");
            let (planned, post_source, post_target) =
                stage_workspace_send(&mut planner, &correlation);
            let base = planned["base_revision"].as_u64().expect("base revision");
            if setup == 1 {
                assert_eq!(
                    parse_reply(&planner.evaluate(&workspace_request(
                        &correlation,
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
            }
            if setup == 2 {
                assert_eq!(
                    parse_reply(&planner.evaluate(&workspace_request(
                        &correlation,
                        "owner-1",
                        "gen-1",
                        base,
                        "",
                        post_source.clone(),
                        post_target.clone(),
                        serde_json::json!({"op": "send-to-workspace-ack", "ack_outcome": "partial-application"}),
                    )))["outcome"],
                    "diverged"
                );
            }
            let abandoned = parse_reply(&planner.evaluate(&workspace_abandon_request(
                &correlation,
                "owner-1",
                "gen-1",
                base,
                post_source.clone(),
                post_target.clone(),
                workspace_abandon_body(),
            )));
            assert_eq!(abandoned["correlation_id"], correlation, "{abandoned}");
            assert_eq!(abandoned["outcome"], "abandoned", "{abandoned}");
            assert_eq!(abandoned["kind"], "send-to-workspace", "{abandoned}");
            assert!(abandoned.get("base_revision").is_none(), "{abandoned}");
            assert!(abandoned.get("desired_geometry").is_none(), "{abandoned}");
            assert!(abandoned.get("operation").is_none(), "{abandoned}");
            assert!(abandoned.get("preconditions").is_none(), "{abandoned}");
            assert_ne!(abandoned["outcome"], "committed", "{abandoned}");
            // No new retained state: pure workspace flow binds nothing and
            // retains no domains.
            assert!(planner.owner().is_none());
            assert_eq!(planner.retained_domains(), 0);
            // Exact same fenced retry finds no pending: correlated
            // `no-pending-unknown`, never a commit.
            let retry = parse_reply(&planner.evaluate(&workspace_abandon_request(
                &correlation,
                "owner-1",
                "gen-1",
                base,
                post_source.clone(),
                post_target.clone(),
                workspace_abandon_body(),
            )));
            assert_eq!(retry["correlation_id"], correlation, "{retry}");
            assert_eq!(retry["outcome"], "no-pending-unknown", "{retry}");
            assert_eq!(retry["kind"], "send-to-workspace", "{retry}");
            assert_ne!(retry["outcome"], "committed", "{retry}");
            // Slot released: a fresh correlation plans and status cannot imply
            // a commit.
            let second = parse_reply(&planner.evaluate(&workspace_request(
                "ws-abandon-next",
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
            )));
            assert_eq!(second["outcome"], "planned", "{second}");
        }
    }

    #[test]
    fn workspace_abandon_lost_planned_reply_matches_original_request_revision() {
        let mut planner = Planner::new();
        let (planned, source, target) = stage_workspace_send(&mut planner, "ws-abandon-lost-plan");
        assert_ne!(
            planned["base_revision"], 0,
            "seeded base differs from the request revision"
        );
        let abandoned = parse_reply(&planner.evaluate(&workspace_abandon_request(
            "ws-abandon-lost-plan",
            "owner-1",
            "gen-1",
            0,
            source,
            target,
            workspace_abandon_body(),
        )));
        assert_eq!(abandoned["outcome"], "abandoned", "{abandoned}");
        assert!(planner.engine.workspace_pending().is_none());
    }

    #[test]
    fn workspace_abandon_mismatch_preserves_pending_without_mutation() {
        // 2026-09-25 option B: the same fenced abandon retires ANY live
        // workspace-send pending. A mismatched live pending retires with the
        // distinct `orphan-abandoned` outcome (never a commit, no retained
        // state), and the retired slot then reports `no-pending-unknown`.
        // Each probe uses a fresh staged pending because the first retire
        // clears the slot. Each probe differs in exactly one fencing
        // dimension: correlation, owner, generation, then revision.
        let probes = [
            ("ws-abandon-other", "owner-1", "gen-1", false),
            ("ws-abandon-mismatch", "owner-9", "gen-1", false),
            ("ws-abandon-mismatch", "owner-1", "gen-9", false),
            ("ws-abandon-mismatch", "owner-1", "gen-1", true),
        ];
        for (correlation, owner, generation, bump_revision) in probes {
            let mut planner = Planner::new();
            let (planned, post_source, post_target) =
                stage_workspace_send(&mut planner, "ws-abandon-mismatch");
            let base = planned["base_revision"].as_u64().expect("base revision");
            let revision = if bump_revision { base + 1 } else { base };
            let orphan = parse_reply(&planner.evaluate(&workspace_abandon_request(
                correlation,
                owner,
                generation,
                revision,
                post_source.clone(),
                post_target.clone(),
                workspace_abandon_body(),
            )));
            assert_eq!(orphan["v"], 1, "{orphan}");
            assert_eq!(orphan["correlation_id"], correlation, "{orphan}");
            assert_eq!(orphan["outcome"], "orphan-abandoned", "{orphan}");
            assert_eq!(orphan["kind"], "send-to-workspace", "{orphan}");
            assert!(orphan.get("base_revision").is_none(), "{orphan}");
            assert!(orphan.get("desired_geometry").is_none(), "{orphan}");
            assert!(orphan.get("desired_focus").is_none(), "{orphan}");
            assert!(orphan.get("float_geometry").is_none(), "{orphan}");
            assert!(orphan.get("operation").is_none(), "{orphan}");
            assert!(orphan.get("preconditions").is_none(), "{orphan}");
            assert_ne!(orphan["outcome"], "committed", "{orphan}");
            assert!(planner.engine.workspace_pending().is_none());
            // No new retained state: pure workspace flow binds nothing and
            // retains no domains.
            assert!(planner.owner().is_none());
            assert_eq!(planner.retained_domains(), 0);
            // Post-retire the same fenced request finds no pending.
            let retry = parse_reply(&planner.evaluate(&workspace_abandon_request(
                correlation,
                owner,
                generation,
                revision,
                post_source.clone(),
                post_target.clone(),
                workspace_abandon_body(),
            )));
            assert_eq!(retry["correlation_id"], correlation, "{retry}");
            assert_eq!(retry["outcome"], "no-pending-unknown", "{retry}");
            assert_eq!(retry["kind"], "send-to-workspace", "{retry}");
            assert_ne!(retry["outcome"], "committed", "{retry}");
        }
        // Wrong scope (valid but non-retained target domain) retires the same
        // way: option B retires ANY live pending on a well-formed abandon.
        // Observation window sets never gate abandon, only the request shape.
        let mut planner = Planner::new();
        let (planned, post_source, _) = stage_workspace_send(&mut planner, "ws-abandon-mismatch");
        let base = planned["base_revision"].as_u64().expect("base revision");
        let mut scoped: serde_json::Value = serde_json::from_str(&workspace_abandon_request(
            "ws-abandon-mismatch",
            "owner-1",
            "gen-1",
            base,
            post_source.clone(),
            vec![workspace_entry("win-t1", "ws-3", 0)],
            workspace_abandon_body(),
        ))
        .expect("json");
        scoped["target_domain"]["workspace"] = serde_json::json!("ws-3");
        let scope_orphan = parse_reply(&planner.evaluate(&scoped.to_string()));
        assert_eq!(
            scope_orphan["correlation_id"], "ws-abandon-mismatch",
            "{scope_orphan}"
        );
        assert_eq!(
            scope_orphan["outcome"], "orphan-abandoned",
            "{scope_orphan}"
        );
        assert_eq!(scope_orphan["kind"], "send-to-workspace", "{scope_orphan}");
        assert!(
            scope_orphan.get("base_revision").is_none(),
            "{scope_orphan}"
        );
        assert_ne!(scope_orphan["outcome"], "committed", "{scope_orphan}");
        assert!(planner.engine.workspace_pending().is_none());
    }

    #[test]
    fn workspace_abandon_orphan_cross_generation_correlation() {
        // Option B cross-generation recovery: a gen-1 flight orphans when its
        // owner restarts at gen-2; the new generation's fenced abandon (new
        // correlation, new generation, same owner and scope) retires it as
        // `orphan-abandoned` with the requester correlation, never a commit.
        let mut planner = Planner::new();
        let (planned, post_source, post_target) =
            stage_workspace_send(&mut planner, "ws-orphan-old");
        let base = planned["base_revision"].as_u64().expect("base revision");
        let orphan = parse_reply(&planner.evaluate(&workspace_abandon_request(
            "ws-orphan-new",
            "owner-1",
            "gen-2",
            base,
            post_source.clone(),
            post_target.clone(),
            workspace_abandon_body(),
        )));
        assert_eq!(orphan["v"], 1, "{orphan}");
        assert_eq!(orphan["correlation_id"], "ws-orphan-new", "{orphan}");
        assert_eq!(orphan["outcome"], "orphan-abandoned", "{orphan}");
        assert_eq!(orphan["kind"], "send-to-workspace", "{orphan}");
        assert!(orphan.get("base_revision").is_none(), "{orphan}");
        assert!(orphan.get("desired_geometry").is_none(), "{orphan}");
        assert!(orphan.get("operation").is_none(), "{orphan}");
        assert!(orphan.get("preconditions").is_none(), "{orphan}");
        assert_ne!(orphan["outcome"], "committed", "{orphan}");
        assert!(planner.engine.workspace_pending().is_none());
        // Post-retire the slot reports absence, and a fresh flight plans.
        let retry = parse_reply(&planner.evaluate(&workspace_abandon_request(
            "ws-orphan-new",
            "owner-1",
            "gen-2",
            base,
            post_source,
            post_target,
            workspace_abandon_body(),
        )));
        assert_eq!(retry["outcome"], "no-pending-unknown", "{retry}");
        assert_eq!(retry["kind"], "send-to-workspace", "{retry}");
        let second = parse_reply(&planner.evaluate(&workspace_request(
            "ws-orphan-next",
            "owner-1",
            "gen-2",
            0,
            "win-1",
            vec![
                workspace_entry("win-1", "ws-1", 0),
                workspace_entry("win-2", "ws-1", 100),
            ],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_send_body(),
        )));
        assert_eq!(second["outcome"], "planned", "{second}");
    }

    #[test]
    fn workspace_abandon_orphan_different_owner_preserves_sessions() {
        // A different same-format owner (other same-UID caller) retires the
        // orphan as `orphan-abandoned` while every canonical per-domain
        // Engine session survives and stays reusable.
        let mut planner = Planner::new();
        let admit = retained_request_for_domain(
            "ws-orphan-owner-1",
            "owner-1",
            "gen-1",
            "out-9",
            "ws-9",
            "win-keep",
            &[("win-keep", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-keep", "output": "out-9", "workspace": "ws-9"}),
        );
        assert_eq!(parse_reply(&planner.evaluate(&admit))["outcome"], "planned");
        assert_eq!(planner.retained_domains(), 1);
        let (planned, post_source, post_target) =
            stage_workspace_send(&mut planner, "ws-orphan-owner-2");
        let base = planned["base_revision"].as_u64().expect("base revision");
        let orphan = parse_reply(&planner.evaluate(&workspace_abandon_request(
            "ws-orphan-owner-2",
            "owner-9",
            "gen-1",
            base,
            post_source,
            post_target,
            workspace_abandon_body(),
        )));
        assert_eq!(orphan["outcome"], "orphan-abandoned", "{orphan}");
        assert_eq!(orphan["kind"], "send-to-workspace", "{orphan}");
        assert_ne!(orphan["outcome"], "committed", "{orphan}");
        assert!(planner.engine.workspace_pending().is_none());
        assert_eq!(planner.retained_domains(), 1, "canonical session preserved");
        let regroup = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "ws-orphan-owner-3",
            "owner-1",
            "gen-1",
            "out-9",
            "ws-9",
            "win-keep",
            &[("win-keep", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(regroup["outcome"], "planned", "{regroup}");
    }

    #[test]
    fn workspace_abandon_orphan_displaced_late_phases_recover_without_commit() {
        // Displaced original owner after an orphan retire: its late ack and
        // verify find no pending and never commit, and its own late abandon
        // reports `no-pending-unknown` (option A recovery shape).
        let mut planner = Planner::new();
        let (planned, post_source, post_target) =
            stage_workspace_send(&mut planner, "ws-orphan-late");
        let base = planned["base_revision"].as_u64().expect("base revision");
        let orphan = parse_reply(&planner.evaluate(&workspace_abandon_request(
            "ws-orphan-late-new",
            "owner-1",
            "gen-2",
            base,
            post_source.clone(),
            post_target.clone(),
            workspace_abandon_body(),
        )));
        assert_eq!(orphan["outcome"], "orphan-abandoned", "{orphan}");
        let late_ack = parse_reply(&planner.evaluate(&workspace_request(
            "ws-orphan-late",
            "owner-1",
            "gen-1",
            base,
            "",
            post_source.clone(),
            post_target.clone(),
            workspace_ack_body(),
        )));
        assert_eq!(late_ack["correlation_id"], "ws-orphan-late", "{late_ack}");
        assert_eq!(late_ack["outcome"], "rejected", "{late_ack}");
        assert_eq!(late_ack["kind"], "no-pending", "{late_ack}");
        assert_ne!(late_ack["outcome"], "committed", "{late_ack}");
        let late_verify = parse_reply(&planner.evaluate(&workspace_request(
            "ws-orphan-late",
            "owner-1",
            "gen-1",
            base,
            "",
            post_source.clone(),
            post_target.clone(),
            workspace_verify_body(
                planned["preconditions"].clone(),
                planned["operation"].clone(),
            ),
        )));
        assert_eq!(late_verify["outcome"], "rejected", "{late_verify}");
        assert_eq!(late_verify["kind"], "no-pending", "{late_verify}");
        assert_ne!(late_verify["outcome"], "committed", "{late_verify}");
        let late_abandon = parse_reply(&planner.evaluate(&workspace_abandon_request(
            "ws-orphan-late",
            "owner-1",
            "gen-1",
            base,
            post_source,
            post_target,
            workspace_abandon_body(),
        )));
        assert_eq!(
            late_abandon["correlation_id"], "ws-orphan-late",
            "{late_abandon}"
        );
        assert_eq!(
            late_abandon["outcome"], "no-pending-unknown",
            "{late_abandon}"
        );
        assert_eq!(late_abandon["kind"], "send-to-workspace", "{late_abandon}");
        assert_ne!(late_abandon["outcome"], "committed", "{late_abandon}");
    }

    #[test]
    fn workspace_abandon_malformed_preserves_live_pending() {
        // Malformed or unauthorized abandon requests fail closed before any
        // retirement: the live pending survives and the exact abandon still
        // retires it afterwards.
        let mut planner = Planner::new();
        let (planned, post_source, post_target) =
            stage_workspace_send(&mut planner, "ws-abandon-malformed");
        let base = planned["base_revision"].as_u64().expect("base revision");
        let unknown_field = parse_reply(&planner.evaluate(&workspace_abandon_request(
            "ws-abandon-malformed",
            "owner-1",
            "gen-1",
            base,
            post_source.clone(),
            post_target.clone(),
            serde_json::json!({"op": "send-to-workspace-abandon", "extra": 1}),
        )));
        assert_eq!(unknown_field["outcome"], "rejected", "{unknown_field}");
        assert_eq!(unknown_field["kind"], "unknown-field", "{unknown_field}");
        let mut missing: serde_json::Value = serde_json::from_str(&workspace_abandon_request(
            "ws-abandon-malformed",
            "owner-1",
            "gen-1",
            base,
            post_source.clone(),
            post_target.clone(),
            workspace_abandon_body(),
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
        // Unauthorized owner shape fails closed at request validation.
        let bad_owner = parse_reply(&planner.evaluate(&workspace_abandon_request(
            "ws-abandon-malformed",
            "not an owner!!",
            "gen-1",
            base,
            post_source.clone(),
            post_target.clone(),
            workspace_abandon_body(),
        )));
        assert_eq!(bad_owner["outcome"], "rejected", "{bad_owner}");
        assert_eq!(bad_owner["kind"], "owner-invalid", "{bad_owner}");
        // The live pending survived every malformed probe.
        assert!(planner.engine.workspace_pending().is_some());
        let abandoned = parse_reply(&planner.evaluate(&workspace_abandon_request(
            "ws-abandon-malformed",
            "owner-1",
            "gen-1",
            base,
            post_source,
            post_target,
            workspace_abandon_body(),
        )));
        assert_eq!(abandoned["outcome"], "abandoned", "{abandoned}");
        assert_eq!(abandoned["kind"], "send-to-workspace", "{abandoned}");
    }

    #[test]
    fn workspace_abandon_leaves_directional_pending_untouched() {
        // Directional R4 pending is out of scope: a fenced workspace abandon
        // with no workspace pending reports `no-pending-unknown` and never
        // clears, rebinds, or otherwise touches the directional transaction.
        use tiler_core::directional::{
            CrossOutputTarget, MoveOperation, OutputId, Rule, WindowId, WorkspaceId,
        };
        use tiler_core::ids::{CorrelationId, GenerationId, OwnerId};
        use tiler_core::pending::DirectionalMovePending;
        use tiler_core::session::Session;
        let mut planner = Planner::new();
        let domain = OutputDomain {
            id: OutputId("out-9".to_owned()),
            workspace: WorkspaceId("ws-9".to_owned()),
            bounds: Rect {
                x: 0,
                y: 0,
                w: 1200,
                h: 800,
            },
            gap: 0,
            adjacent: std::collections::BTreeMap::new(),
        };
        let session = Session::new(
            OwnerId::parse("owner-1").expect("owner"),
            GenerationId::parse("gen-1").expect("generation"),
            0,
            7,
            vec![domain],
        )
        .expect("session");
        let source_key = DomainKey {
            output: OutputId("out-9".to_owned()),
            workspace: WorkspaceId("ws-9".to_owned()),
        };
        let target_key = DomainKey {
            output: OutputId("out-8".to_owned()),
            workspace: WorkspaceId("ws-9".to_owned()),
        };
        planner
            .engine
            .set_directional_pending(DirectionalMovePending::new(
                OwnerId::parse("owner-1").expect("owner"),
                GenerationId::parse("gen-1").expect("generation"),
                CorrelationId::parse("ws-r4-live").expect("correlation"),
                0,
                0,
                session,
                source_key,
                target_key,
                0,
                0,
                vec![],
                MoveOperation::CrossOutput {
                    rule: Rule::R4,
                    target_output: OutputId("out-8".to_owned()),
                    target_workspace: WorkspaceId("ws-9".to_owned()),
                    source_root_child_index: 0,
                    target: CrossOutputTarget::Empty,
                },
                vec![],
                WindowId("win-keep".to_owned()),
                vec![],
            ));
        let reply = parse_reply(&planner.evaluate(&workspace_abandon_request(
            "ws-abandon-r4",
            "owner-1",
            "gen-1",
            0,
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_abandon_body(),
        )));
        assert_eq!(reply["correlation_id"], "ws-abandon-r4", "{reply}");
        assert_eq!(reply["outcome"], "no-pending-unknown", "{reply}");
        assert_eq!(reply["kind"], "send-to-workspace", "{reply}");
        assert_ne!(reply["outcome"], "committed", "{reply}");
        assert!(
            planner.engine.directional_pending().is_some(),
            "directional pending untouched"
        );
        assert!(planner.engine.workspace_pending().is_none());
    }

    #[test]
    fn workspace_abandon_orphan_summaries_redacted() {
        // The distinct orphan outcome flows through the existing bounded
        // redacted summaries: truthful outcome/kind tokens, validated
        // correlation only, no ids, rects, owner, or payload bytes. Logging
        // stays pure and never mutates planner state.
        let request = workspace_abandon_request(
            "ws-abandon-orphan-sum-1",
            "owner-9",
            "gen-9",
            3,
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_abandon_body(),
        );
        assert_eq!(
            summarize_plan_ingress(&request),
            "plasma-auto-tiler:plan-summary direction=ingress op=send-to-workspace-abandon correlation=ws-abandon-orphan-sum-1 revision=3"
        );
        let shape = summarize_plan_shape(&request);
        assert!(shape.contains("op=send-to-workspace-abandon"), "{shape}");
        assert!(!shape.contains("win-1"), "{shape}");
        assert!(!shape.contains("owner-9"), "{shape}");
        let orphaned = summarize_plan_egress(
            &request,
            r#"{"v":1,"correlation_id":"ws-abandon-orphan-sum-1","outcome":"orphan-abandoned","kind":"send-to-workspace"}"#,
        );
        assert!(orphaned.contains("outcome=orphan-abandoned"), "{orphaned}");
        assert!(orphaned.contains("kind=send-to-workspace"), "{orphaned}");
        assert!(!orphaned.contains("committed"), "{orphaned}");
        assert!(!orphaned.contains("win-1"), "{orphaned}");
        assert!(!orphaned.contains("owner-9"), "{orphaned}");
        // Summaries are pure: a staged flight still retires exactly once
        // afterwards (exact here, proving the summaries changed nothing).
        let mut planner = Planner::new();
        let (planned, post_source, post_target) =
            stage_workspace_send(&mut planner, "ws-abandon-orphan-sum-2");
        let base = planned["base_revision"].as_u64().expect("base");
        let _ = summarize_plan_ingress(&request);
        let _ = summarize_plan_shape(&request);
        let _ = summarize_plan_egress(&request, &planned.to_string());
        let abandoned = parse_reply(&planner.evaluate(&workspace_abandon_request(
            "ws-abandon-orphan-sum-2",
            "owner-1",
            "gen-1",
            base,
            post_source,
            post_target,
            workspace_abandon_body(),
        )));
        assert_eq!(abandoned["outcome"], "abandoned", "{abandoned}");
    }

    #[test]
    fn workspace_abandon_after_commit_reports_no_pending_without_commit_claim() {
        // Committed-before-lost-reply: the Engine committed on verify, so the
        // pending is gone and abandon must report correlated no-pending
        // without ever claiming commit.
        let mut planner = Planner::new();
        let (planned, post_source, post_target) =
            stage_workspace_send(&mut planner, "ws-abandon-committed");
        let base = planned["base_revision"].as_u64().expect("base revision");
        assert_eq!(
            parse_reply(&planner.evaluate(&workspace_request(
                "ws-abandon-committed",
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
            "ws-abandon-committed",
            "owner-1",
            "gen-1",
            base,
            "",
            post_source.clone(),
            post_target.clone(),
            workspace_verify_body(
                planned["preconditions"].clone(),
                planned["operation"].clone(),
            ),
        )));
        assert_eq!(committed["outcome"], "committed", "{committed}");
        let retry = parse_reply(&planner.evaluate(&workspace_abandon_request(
            "ws-abandon-committed",
            "owner-1",
            "gen-1",
            base,
            post_source,
            post_target,
            workspace_abandon_body(),
        )));
        assert_eq!(retry["correlation_id"], "ws-abandon-committed", "{retry}");
        assert_eq!(retry["outcome"], "no-pending-unknown", "{retry}");
        assert_eq!(retry["kind"], "send-to-workspace", "{retry}");
        assert_ne!(retry["outcome"], "committed", "{retry}");
        assert!(retry.get("desired_geometry").is_none(), "{retry}");
        assert!(retry.get("operation").is_none(), "{retry}");
    }

    #[test]
    fn workspace_abandon_preserves_canonical_sessions_and_rejects_malformed() {
        // Canonical domain sessions survive abandon: seed an unrelated legacy
        // domain, stage and abandon a workspace flight, then prove the legacy
        // slot is intact and reusable.
        let mut planner = Planner::new();
        let admit = retained_request_for_domain(
            "ws-abandon-keep-1",
            "owner-1",
            "gen-1",
            "out-9",
            "ws-9",
            "win-keep",
            &[("win-keep", 0, 0, 100, 80)],
            serde_json::json!({"op": "admit", "window": "win-keep", "output": "out-9", "workspace": "ws-9"}),
        );
        assert_eq!(parse_reply(&planner.evaluate(&admit))["outcome"], "planned");
        assert_eq!(planner.retained_domains(), 1);
        let (planned, post_source, post_target) =
            stage_workspace_send(&mut planner, "ws-abandon-keep-2");
        let base = planned["base_revision"].as_u64().expect("base revision");
        let abandoned = parse_reply(&planner.evaluate(&workspace_abandon_request(
            "ws-abandon-keep-2",
            "owner-1",
            "gen-1",
            base,
            post_source,
            post_target,
            workspace_abandon_body(),
        )));
        assert_eq!(abandoned["outcome"], "abandoned", "{abandoned}");
        assert_eq!(planner.retained_domains(), 1, "canonical session preserved");
        let regroup = parse_reply(&planner.evaluate(&retained_request_for_domain(
            "ws-abandon-keep-3",
            "owner-1",
            "gen-1",
            "out-9",
            "ws-9",
            "win-keep",
            &[("win-keep", 0, 0, 100, 80)],
            serde_json::json!({"op": "reconcile"}),
        )));
        assert_eq!(regroup["outcome"], "planned", "{regroup}");
        // Malformed abandon shapes fail closed without mutation.
        let unknown = parse_reply(&planner.evaluate(&workspace_abandon_request(
            "ws-abandon-keep-4",
            "owner-1",
            "gen-1",
            0,
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            serde_json::json!({"op": "send-to-workspace-abandon", "extra": 1}),
        )));
        assert_eq!(unknown["outcome"], "rejected", "{unknown}");
        assert_eq!(unknown["kind"], "unknown-field", "{unknown}");
        let mut missing: serde_json::Value = serde_json::from_str(&workspace_abandon_request(
            "ws-abandon-keep-4",
            "owner-1",
            "gen-1",
            0,
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_abandon_body(),
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
        // Unknown ops stay on the exact unknown-value path and never reach
        // abandon.
        let unknown_op = parse_reply(&planner.evaluate(&workspace_request(
            "ws-abandon-keep-4",
            "owner-1",
            "gen-1",
            0,
            "win-1",
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            serde_json::json!({"op": "send-to-workspace-bogus"}),
        )));
        assert_eq!(unknown_op["outcome"], "rejected", "{unknown_op}");
        assert_eq!(unknown_op["kind"], "unknown-value", "{unknown_op}");
    }

    #[test]
    fn workspace_abandon_summaries_are_bounded_and_redacted() {
        // Requested/replied/retry semantics flow through the existing bounded
        // redacted summaries with no ids, rects, owner, or payload bytes.
        // Logging is pure: summaries never mutate planner state and failures
        // degrade to placeholders without changing behavior.
        let request = workspace_abandon_request(
            "ws-abandon-sum-1",
            "owner-1",
            "gen-1",
            3,
            vec![workspace_entry("win-1", "ws-1", 0)],
            vec![workspace_entry("win-t1", "ws-2", 0)],
            workspace_abandon_body(),
        );
        assert_eq!(
            summarize_plan_ingress(&request),
            "plasma-auto-tiler:plan-summary direction=ingress op=send-to-workspace-abandon correlation=ws-abandon-sum-1 revision=3"
        );
        let shape = summarize_plan_shape(&request);
        assert!(shape.contains("op=send-to-workspace-abandon"), "{shape}");
        assert!(!shape.contains("win-1"), "{shape}");
        assert!(!shape.contains("owner-1"), "{shape}");
        let replied = summarize_plan_egress(
            &request,
            r#"{"v":1,"correlation_id":"ws-abandon-sum-1","outcome":"abandoned","kind":"send-to-workspace"}"#,
        );
        assert!(replied.contains("outcome=abandoned"), "{replied}");
        assert!(replied.contains("kind=send-to-workspace"), "{replied}");
        assert!(!replied.contains("committed"), "{replied}");
        let retried = summarize_plan_egress(
            &request,
            r#"{"v":1,"correlation_id":"ws-abandon-sum-1","outcome":"no-pending-unknown","kind":"send-to-workspace"}"#,
        );
        assert!(retried.contains("outcome=no-pending-unknown"), "{retried}");
        assert!(retried.contains("kind=send-to-workspace"), "{retried}");
        let garbage = summarize_plan_egress(&request, "{not-json!!");
        assert!(garbage.contains("outcome=unknown"), "{garbage}");
        assert!(!garbage.contains("not-json"), "{garbage}");
        // Summaries are pure: the lifecycle they describe still commits
        // exactly once afterwards.
        let mut planner = Planner::new();
        let (planned, post_source, post_target) =
            stage_workspace_send(&mut planner, "ws-abandon-sum-2");
        let base = planned["base_revision"].as_u64().expect("base");
        let _ = summarize_plan_ingress(&request);
        let _ = summarize_plan_shape(&request);
        let _ = summarize_plan_egress(&request, &planned.to_string());
        assert_eq!(
            parse_reply(&planner.evaluate(&workspace_request(
                "ws-abandon-sum-2",
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
                "ws-abandon-sum-2",
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
    fn retained_many_domains_plan_without_count_cap() {
        // No retained-domain count cap: well beyond the old 16-domain bound,
        // every distinct domain admits and stays retained. Offline only.
        let mut planner = Planner::new();
        for index in 1..=24 {
            let workspace = format!("ws-{index}");
            let window = format!("win-{index}");
            let correlation = format!("many-domain-admit-{index}");
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
        assert_eq!(planner.retained_domains(), 24);
        // Empty the first retained domain with its exact single-member
        // observation: the committed remove retires it.
        let remove = retained_request_for_domain(
            "many-domain-remove-1",
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
            serde_json::json!({"op": "admit", "window": "win-1", "output": "out-1", "workspace": "ws-1"}),
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
            serde_json::json!({"op": "admit", "window": focused, "output": "out-1", "workspace": "ws-1"}),
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

    #[test]
    fn retained_multi_member_collapse_converges_to_empty_idempotent_remove() {
        // Both members vanishing before one observation converges both away;
        // the single remove then takes the idempotent success with the
        // complete converged (empty) projection and retires the emptied
        // domain slot. Offline only.
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
        // Both members gone: convergence removes both, then the remove takes
        // the idempotent success with the complete converged empty
        // projection (remove capability) and retires the emptied slot.
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
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(reply["detail"]["kind"], "remove", "{reply}");
        assert_eq!(
            reply["desired_geometry"].as_array().map(Vec::len),
            Some(0),
            "{reply}"
        );
        assert_eq!(planner.retained_domains(), 0, "{reply}");
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
        // A retained follow-up converges first: the unexpected member is
        // admitted by convergence (base 1 -> 2), then the ordinary admit
        // takes the idempotent success with no extra commit. Base 2 proves
        // the fit committed exactly once plus one convergence, and the fitted
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
        assert_eq!(follow["base_revision"], 2, "{follow}");
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
        let after = planner
            .engine
            .session(&target_key)
            .expect("target retained");
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
