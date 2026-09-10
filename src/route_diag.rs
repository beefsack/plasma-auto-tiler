//! Bounded correlated route diagnostics for the D-Bus Planner path.
//!
//! Same token schema as `kwin/src/route-diag.ts`: one line per request and one
//! per reply, fixed vocabulary, opaque correlation echo only, integer counts
//! only. Never captions, geometry, owners, PIDs, or raw payload bytes.
//!
//! Pure functions with no I/O; the D-Bus handlers in
//! [`crate::planner_service`] emit the returned lines to stderr after
//! verification, so diagnostics never trigger bus activation themselves and
//! never change wire behavior. Correlations validate through
//! [`crate::ids::CorrelationId`]; anything else renders as `invalid`.

use crate::ids::CorrelationId;

/// Shared diagnostic prefix (matches the KWin `route-diag` schema).
pub const ROUTE_DIAG_PREFIX: &str = "plasma-auto-tiler:route-diag";
/// Fixed anchor for log aggregation filtering (never a payload).
pub const ROUTE_DIAG_ANCHOR: &str = "plasma-auto-tiler:route-diag";
/// Current-boot journal source units (documented source metadata; the viewer
/// reads the full current-user current-boot journal so the unit-less tray
/// autostart is included, anchor filtering keeps visible output exact).
pub const ROUTE_DIAG_KWIN_UNIT: &str = "plasma-kwin_wayland.service";
/// Current-boot journal source units (documented source metadata; the viewer
/// reads the full current-user current-boot journal so the unit-less tray
/// autostart is included, anchor filtering keeps visible output exact).
pub const ROUTE_DIAG_PLANNER_UNIT: &str = "plasma-auto-tiler-planner.service";

/// D-Bus route carrying the request. Fixed vocabulary only: the four trio
/// transaction routes plus the frozen `EvaluateMove`, read-only advisory,
/// read-only shadow, and the portable session outcome pseudo-route.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Focus,
    Movement,
    Resize,
    Pointer,
    Move,
    Advisory,
    Shadow,
    Session,
}

impl Route {
    /// Stable route token.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Focus => "focus",
            Self::Movement => "movement",
            Self::Resize => "resize",
            Self::Pointer => "pointer",
            Self::Move => "move",
            Self::Advisory => "advisory",
            Self::Shadow => "shadow",
            Self::Session => "session",
        }
    }
}

fn sanitize_corr(value: Option<&str>) -> &str {
    match value {
        Some(id) if CorrelationId::parse(id).is_some() => id,
        _ => "invalid",
    }
}

fn action_of(raw: &serde_json::Value) -> &'static str {
    match raw.get("action").and_then(serde_json::Value::as_str) {
        Some("request") => "request",
        Some("request-pointer") => "request-pointer",
        Some("acknowledge") => "acknowledge",
        Some("verify") => "verify",
        Some("note-loss") => "note-loss",
        _ => "unknown",
    }
}

fn outcome_of(raw: &serde_json::Value) -> &'static str {
    match raw.get("outcome").and_then(serde_json::Value::as_str) {
        Some("planned") => "planned",
        Some("noop") => "noop",
        Some("acknowledged") => "acknowledged",
        Some("committed") => "committed",
        Some("rejected") => "rejected",
        Some("diverged") => "diverged",
        _ => "unknown",
    }
}

fn revision_of(raw: &serde_json::Value) -> Option<u64> {
    raw.get("revision")
        .or_else(|| raw.get("base_revision"))
        .and_then(serde_json::Value::as_u64)
}

/// Revision bound shared with every contract (inclusive). Request, reply,
/// refusal, lifecycle, and session lines all omit out-of-bounds revisions
/// rather than echoing them.
pub const MAX_DIAG_REVISION: u64 = 1_000_000;

fn bounded_rev(raw: &serde_json::Value) -> Option<u64> {
    revision_of(raw).filter(|rev| *rev <= MAX_DIAG_REVISION)
}

/// Validated generation echo for lifecycle seeding, if the request carries
/// one. Returns the owned validated token only; `None` renders as
/// `gen=invalid` downstream. Never echoes unvalidated bytes.
#[must_use]
pub fn generation_of_request(request_json: &str) -> Option<String> {
    use crate::ids::GenerationId;
    let raw: serde_json::Value = serde_json::from_str(request_json).ok()?;
    let generation = raw.get("generation")?.as_str()?;
    GenerationId::parse(generation).map(|id| id.as_str().to_owned())
}

/// One bounded line describing a received request: route, action category,
/// validated correlation echo, and bounded revision when the request carries
/// one. Malformed JSON reports
/// `action=malformed` with `corr=invalid` and never echoes input bytes.
#[must_use]
pub fn describe_request(route: Route, request_json: &str) -> String {
    let raw: serde_json::Value =
        serde_json::from_str(request_json).unwrap_or(serde_json::Value::Null);
    if raw.is_null() {
        return format!(
            "{ROUTE_DIAG_PREFIX}:route={}:action=malformed:corr=invalid",
            route.as_str()
        );
    }
    let corr = raw
        .get("correlation_id")
        .and_then(serde_json::Value::as_str);
    let base = format!(
        "{ROUTE_DIAG_PREFIX}:route={}:action={}:corr={}",
        route.as_str(),
        action_of(&raw),
        sanitize_corr(corr)
    );
    match bounded_rev(&raw) {
        Some(rev) => format!("{base}:rev={rev}"),
        None => base,
    }
}

/// Bounded refusal category for D-Bus handler `Err` paths. Fixed closed
/// vocabulary only; never carries error strings, bus names, or PIDs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    Busy,
    ConnectionLost,
    Unauthorized,
    Unavailable,
    Oversize,
}

impl Refusal {
    /// Stable refusal token.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Busy => "busy",
            Self::ConnectionLost => "connection-lost",
            Self::Unauthorized => "unauthorized",
            Self::Unavailable => "unavailable",
            Self::Oversize => "oversize",
        }
    }
}

/// One bounded line describing a refused request: route, fixed refusal
/// category, validated correlation echo, and the terminal revision when the
/// request carries one. Never echoes input bytes beyond the validated token.
#[must_use]
pub fn describe_refusal(route: Route, request_json: &str, refusal: Refusal) -> String {
    let raw: serde_json::Value =
        serde_json::from_str(request_json).unwrap_or(serde_json::Value::Null);
    if raw.is_null() {
        return format!(
            "{ROUTE_DIAG_PREFIX}:route={}:result={}:corr=invalid",
            route.as_str(),
            refusal.as_str()
        );
    }
    let corr = raw
        .get("correlation_id")
        .and_then(serde_json::Value::as_str);
    let base = format!(
        "{ROUTE_DIAG_PREFIX}:route={}:result={}:corr={}",
        route.as_str(),
        refusal.as_str(),
        sanitize_corr(corr)
    );
    match bounded_rev(&raw) {
        Some(rev) => format!("{base}:rev={rev}"),
        None => base,
    }
}

/// One bounded line describing a produced reply: route, outcome category
/// (plan/refusal/ack/terminal), validated correlation echo, and the terminal
/// revision when the reply carries one (bounded, omitted when out of bounds).
/// Malformed JSON reports
/// `result=unknown` and never echoes input bytes.
#[must_use]
pub fn describe_reply(route: Route, reply_json: &str) -> String {
    let raw: serde_json::Value =
        serde_json::from_str(reply_json).unwrap_or(serde_json::Value::Null);
    if raw.is_null() {
        return format!(
            "{ROUTE_DIAG_PREFIX}:route={}:result=unknown:corr=invalid",
            route.as_str()
        );
    }
    let corr = raw
        .get("correlation_id")
        .and_then(serde_json::Value::as_str);
    let base = format!(
        "{ROUTE_DIAG_PREFIX}:route={}:result={}:corr={}",
        route.as_str(),
        outcome_of(&raw),
        sanitize_corr(corr)
    );
    match bounded_rev(&raw) {
        Some(rev) => format!("{base}:rev={rev}"),
        None => base,
    }
}

/// Lifecycle component for background/tray/bridge/planner events.
/// Fixed vocabulary only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleComp {
    Tray,
    Bridge,
    Planner,
}

impl LifecycleComp {
    /// Stable component token.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Tray => "tray",
            Self::Bridge => "bridge",
            Self::Planner => "planner",
        }
    }
}

/// Lifecycle event. Fixed vocabulary, narrowed to actually emitted branches:
/// background/tray record and owner transitions, bridge send outcomes, and
/// planner trio seeding.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleEvent {
    Started,
    Published,
    OwnerChanged,
    EnabledChanged,
    Seeded,
    Stopped,
    SendFailed,
}

impl LifecycleEvent {
    /// Stable event token.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Started => "started",
            Self::Published => "published",
            Self::OwnerChanged => "owner-changed",
            Self::EnabledChanged => "enabled-changed",
            Self::Seeded => "seeded",
            Self::Stopped => "stopped",
            Self::SendFailed => "send-failed",
        }
    }
}

/// Lifecycle result. Fixed vocabulary, narrowed to actually emitted
/// outcomes: accepted transitions (`ok`), rejected publications/requests
/// (`rejected`), and failed emissions (`failed`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleResult {
    Ok,
    Rejected,
    Failed,
}

impl LifecycleResult {
    /// Stable result token.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Rejected => "rejected",
            Self::Failed => "failed",
        }
    }
}

/// Revision bound shared with the contract (inclusive).
const LIFECYCLE_MAX_REVISION: u64 = 1_000_000;

fn sanitize_gen_opt(value: Option<&str>) -> &str {
    use crate::ids::GenerationId;
    match value {
        Some(text) if GenerationId::parse(text).is_some() => text,
        _ => "invalid",
    }
}

fn sanitize_corr_opt(value: Option<&str>) -> Option<&str> {
    match value {
        Some(id) if CorrelationId::parse(id).is_some() => Some(id),
        Some(_) => Some("invalid"),
        None => None,
    }
}

/// Bounded N.N.N version for startup identity lines.
#[must_use]
pub fn is_valid_package_version(value: &str) -> bool {
    if value.is_empty() || value.len() > 16 {
        return false;
    }
    let mut parts = 0u8;
    for part in value.split('.') {
        if part.is_empty() || part.len() > 4 || !part.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
        parts += 1;
    }
    parts == 3
}

fn sanitize_version_opt(value: Option<&str>) -> Option<&str> {
    match value {
        Some(text) if is_valid_package_version(text) => Some(text),
        Some(_) => Some("invalid"),
        None => None,
    }
}

/// Bounded lifecycle line with optional version for startup identity records.
#[must_use]
pub fn describe_lifecycle(
    comp: LifecycleComp,
    event: LifecycleEvent,
    generation: Option<&str>,
    rev: Option<u64>,
    corr: Option<&str>,
    result: Option<LifecycleResult>,
) -> String {
    describe_lifecycle_with_version(comp, event, generation, rev, corr, result, None)
}

/// Lifecycle line with explicit version for startup identity records.
#[must_use]
pub fn describe_lifecycle_with_version(
    comp: LifecycleComp,
    event: LifecycleEvent,
    generation: Option<&str>,
    rev: Option<u64>,
    corr: Option<&str>,
    result: Option<LifecycleResult>,
    version: Option<&str>,
) -> String {
    let mut line = format!(
        "{ROUTE_DIAG_PREFIX}:lifecycle:comp={}:event={}:gen={}",
        comp.as_str(),
        event.as_str(),
        sanitize_gen_opt(generation)
    );
    if let Some(version) = sanitize_version_opt(version) {
        line.push_str(&format!(":version={version}"));
    }
    if let Some(rev) = rev
        && rev <= LIFECYCLE_MAX_REVISION
    {
        line.push_str(&format!(":rev={rev}"));
    }
    if let Some(corr) = sanitize_corr_opt(corr) {
        line.push_str(&format!(":corr={corr}"));
    }
    if let Some(result) = result {
        line.push_str(&format!(":result={}", result.as_str()));
    }
    line
}

/// Deterministic portable Session/plan/reconciliation outcome. Closed
/// vocabulary, derived only from already-computed outcomes, never from
/// payloads. Mirrors the D-Bus reply outcome tokens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionOutcome {
    Planned,
    Acknowledged,
    Committed,
    Rejected,
    Diverged,
    Noop,
}

impl SessionOutcome {
    /// Stable outcome token (matches the reply `result=` vocabulary).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Planned => "planned",
            Self::Acknowledged => "acknowledged",
            Self::Committed => "committed",
            Self::Rejected => "rejected",
            Self::Diverged => "diverged",
            Self::Noop => "noop",
        }
    }
}

/// One bounded line describing an already-computed portable Session outcome:
/// `plasma-auto-tiler:route-diag:route=session:result=...:corr=...[:rev=N]`.
/// Pure with no I/O and no Session access, so logging can never change
/// authority, timing, IPC semantics, Session state, or fail-closed behavior.
/// Validated correlation echo only; bounded revision only when in bounds.
/// Never window data, geometry, or raw payload bytes.
#[must_use]
pub fn describe_session_outcome(
    outcome: SessionOutcome,
    corr: Option<&str>,
    rev: Option<u64>,
) -> String {
    let corr = sanitize_corr_opt(corr).unwrap_or("invalid");
    let mut line = format!(
        "{ROUTE_DIAG_PREFIX}:route={}:result={}:corr={}",
        Route::Session.as_str(),
        outcome.as_str(),
        corr
    );
    if let Some(rev) = rev
        && rev <= LIFECYCLE_MAX_REVISION
    {
        line.push_str(&format!(":rev={rev}"));
    }
    line
}

/// Map an already-returned D-Bus reply outcome to its portable Session
/// outcome. Pure mapping over the closed reply vocabulary only; `None` for
/// malformed or unknown outcomes (no line is emitted then).
#[must_use]
pub fn session_outcome_of_reply_outcome(outcome: &str) -> Option<SessionOutcome> {
    match outcome {
        "planned" => Some(SessionOutcome::Planned),
        "acknowledged" => Some(SessionOutcome::Acknowledged),
        "committed" => Some(SessionOutcome::Committed),
        "rejected" => Some(SessionOutcome::Rejected),
        "diverged" => Some(SessionOutcome::Diverged),
        "noop" => Some(SessionOutcome::Noop),
        _ => None,
    }
}

/// Build the portable session outcome line from an already-returned reply
/// JSON value only. This is the Planner-boundary emission helper: callers
/// pass the reply string they already computed and returned on the wire, so
/// the session line correlates (`corr`, bounded `rev`, `result`) without
/// touching portable Session state, timing, authority, logging frameworks,
/// or platform I/O. Returns `None` when the reply carries no known outcome
/// (no line is emitted then). Never echoes payload bytes.
#[must_use]
pub fn session_line_for_reply(reply_json: &str) -> Option<String> {
    let raw: serde_json::Value = serde_json::from_str(reply_json).ok()?;
    if raw.is_null() {
        return None;
    }
    let outcome = raw.get("outcome")?.as_str()?;
    let mapped = session_outcome_of_reply_outcome(outcome)?;
    let corr = raw
        .get("correlation_id")
        .and_then(serde_json::Value::as_str);
    let rev = bounded_rev(&raw);
    Some(describe_session_outcome(mapped, corr, rev))
}

/// Visible no-activation current-boot hint for the `route-diag` command and
/// the follow script. Pure text with no I/O, no D-Bus, no activation: names
/// the shared anchor, the documented KWin/Planner source units plus the
/// unit-less tray autostart, and the exact current-boot journal invocation
/// (full current-user current-boot journal, anchor-filtered so visible output
/// is exclusively anchored project records). Never echoes live state.
#[must_use]
pub fn route_diag_status() -> String {
    format!(
        "route-diag anchor: {ROUTE_DIAG_ANCHOR}\nsources: {ROUTE_DIAG_KWIN_UNIT}, {ROUTE_DIAG_PLANNER_UNIT}, tray (autostart, no unit)\ncurrent-boot follow: journalctl --user -b | grep -F {ROUTE_DIAG_ANCHOR}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request(action: &str, corr: &str) -> String {
        json!({
            "v": 1,
            "action": action,
            "correlation_id": corr,
            "owner": "owner-1",
            "generation": "gen-1",
            "revision": 3,
            "fingerprint": 42,
            "focused_window": "w-a",
            "direction": "right",
            "windows": [{"window": "w-a", "output": "o", "workspace": "w"}],
        })
        .to_string()
    }

    fn reply(outcome: &str, corr: &str) -> String {
        json!({
            "v": 1,
            "correlation_id": corr,
            "outcome": outcome,
            "base_revision": 3,
        })
        .to_string()
    }

    #[test]
    fn request_and_reply_share_the_correlation_token_in_order() {
        let req = describe_request(Route::Focus, &request("request", "gen-1-f0"));
        let rep = describe_reply(Route::Focus, &reply("planned", "gen-1-f0"));
        assert!(req.contains("route=focus"), "{req}");
        assert!(req.contains("action=request"), "{req}");
        assert!(req.contains("corr=gen-1-f0"), "{req}");
        assert!(rep.contains("route=focus"), "{rep}");
        assert!(rep.contains("result=planned"), "{rep}");
        assert!(rep.contains("corr=gen-1-f0"), "{rep}");
        // Same token both sides: one command correlates end to end.
        let token = "corr=gen-1-f0";
        assert!(req.contains(token) && rep.contains(token));
    }

    #[test]
    fn failure_categories_are_fixed_and_never_echo_input() {
        let malformed = describe_request(Route::Movement, "{not json");
        assert!(malformed.contains("action=malformed"), "{malformed}");
        assert!(malformed.contains("corr=invalid"), "{malformed}");

        let unknown_action = describe_request(Route::Resize, &request("explode", "gen-1-r0"));
        assert!(
            unknown_action.contains("action=unknown"),
            "{unknown_action}"
        );

        let bad_corr = describe_request(Route::Pointer, &request("request-pointer", "bad corr!!"));
        assert!(bad_corr.contains("corr=invalid"), "{bad_corr}");
        assert!(!bad_corr.contains("bad corr!!"));

        let unknown_outcome = describe_reply(Route::Focus, &reply("meltdown", "gen-1-f0"));
        assert!(
            unknown_outcome.contains("result=unknown"),
            "{unknown_outcome}"
        );

        // Refusal and terminal outcomes keep their categories.
        for (outcome, route) in [
            ("rejected", Route::Focus),
            ("diverged", Route::Movement),
            ("acknowledged", Route::Resize),
            ("committed", Route::Pointer),
            ("noop", Route::Focus),
        ] {
            let line = describe_reply(route, &reply(outcome, "gen-1-x9"));
            assert!(line.contains(&format!("result={outcome}")), "{line}");
            assert!(line.contains("corr=gen-1-x9"), "{line}");
        }
    }

    #[test]
    fn sensitive_request_content_never_appears_in_output() {
        let raw = json!({
            "v": 1,
            "action": "request",
            "correlation_id": "gen-1-f3",
            "owner": "secret-owner-9",
            "generation": "secret-gen-9",
            "revision": 3,
            "fingerprint": 123456789,
            "domain": {"output": "secret-output-9", "workspace": "secret-workspace-9"},
            "focused_window": "secret-window-9",
            "direction": "right",
            "windows": [{"window": "secret-window-9", "rect": {"x": 11, "y": 22, "w": 33, "h": 44}}],
            "geometry": "raw-bytes-9",
            "pid": 42429,
        })
        .to_string();
        let line = describe_request(Route::Focus, &raw);
        for forbidden in [
            "secret-owner-9",
            "secret-gen-9",
            "secret-window-9",
            "secret-output-9",
            "secret-workspace-9",
            "123456789",
            "42429",
            "raw-bytes-9",
        ] {
            assert!(
                !line.contains(forbidden),
                "{line} must not contain {forbidden}"
            );
        }
        assert!(line.contains("corr=gen-1-f3"), "{line}");
    }

    #[test]
    fn pointer_route_keeps_its_distinct_action() {
        let line = describe_request(Route::Pointer, &request("request-pointer", "gen-1-p2"));
        assert!(line.contains("route=pointer"), "{line}");
        assert!(line.contains("action=request-pointer"), "{line}");
    }

    #[test]
    fn refusals_use_fixed_categories_with_validated_correlation() {
        for (refusal, route) in [
            (Refusal::Busy, Route::Focus),
            (Refusal::ConnectionLost, Route::Movement),
            (Refusal::Unauthorized, Route::Resize),
            (Refusal::Unavailable, Route::Pointer),
            (Refusal::Oversize, Route::Focus),
        ] {
            let line = describe_refusal(route, &request("request", "gen-1-f0"), refusal);
            assert!(
                line.contains(&format!("result={}", refusal.as_str())),
                "{line}"
            );
            assert!(line.contains("corr=gen-1-f0"), "{line}");
            assert!(line.contains("rev=3"), "{line}");
        }
        // Malformed input never widens the vocabulary.
        let malformed = describe_refusal(Route::Focus, "{not json", Refusal::Busy);
        assert!(malformed.contains("result=busy"), "{malformed}");
        assert!(malformed.contains("corr=invalid"), "{malformed}");
        // Bad correlation echoes only as invalid, never the raw bytes.
        let bad = describe_refusal(
            Route::Movement,
            &request("request", "bad corr!!"),
            Refusal::Unauthorized,
        );
        assert!(bad.contains("corr=invalid"), "{bad}");
        assert!(!bad.contains("bad corr!!"), "{bad}");
        // Sensitive request content never appears in refusal output.
        let raw = json!({
            "v": 1,
            "action": "request",
            "correlation_id": "gen-1-f3",
            "owner": "secret-owner-9",
            "revision": 3,
            "focused_window": "secret-window-9",
            "pid": 42429,
        })
        .to_string();
        let line = describe_refusal(Route::Resize, &raw, Refusal::Unavailable);
        for forbidden in ["secret-owner-9", "secret-window-9", "42429"] {
            assert!(
                !line.contains(forbidden),
                "{line} must not contain {forbidden}"
            );
        }
        assert!(line.contains("corr=gen-1-f3"), "{line}");
    }

    #[test]
    fn lifecycle_lines_use_closed_vocab_with_validated_generation() {
        let line = describe_lifecycle(
            LifecycleComp::Tray,
            LifecycleEvent::Started,
            Some("packaged-rust-1"),
            Some(0),
            None,
            Some(LifecycleResult::Ok),
        );
        assert_eq!(
            line,
            "plasma-auto-tiler:route-diag:lifecycle:comp=tray:event=started:gen=packaged-rust-1:rev=0:result=ok",
            "{line}"
        );
        let bridge = describe_lifecycle(
            LifecycleComp::Bridge,
            LifecycleEvent::Published,
            Some("test-gen-1"),
            Some(2),
            None,
            Some(LifecycleResult::Ok),
        );
        assert!(bridge.contains("comp=bridge:event=published"), "{bridge}");
        let planner = describe_lifecycle(
            LifecycleComp::Planner,
            LifecycleEvent::Seeded,
            Some("test-gen-1"),
            Some(3),
            Some("gen-1-f0"),
            Some(LifecycleResult::Ok),
        );
        assert!(planner.contains("comp=planner:event=seeded"), "{planner}");
        assert!(planner.contains("corr=gen-1-f0"), "{planner}");
    }

    #[test]
    fn lifecycle_never_echoes_unvalidated_input() {
        let line = describe_lifecycle(
            LifecycleComp::Tray,
            LifecycleEvent::Published,
            Some("secret gen!!"),
            Some(3),
            Some("bad corr!!"),
            Some(LifecycleResult::Ok),
        );
        assert!(line.contains("gen=invalid"), "{line}");
        assert!(line.contains("corr=invalid"), "{line}");
        for forbidden in ["secret", "bad corr!!", " "] {
            assert!(
                !line.contains(forbidden),
                "{line} must not contain {forbidden}"
            );
        }
        // Missing generation still yields a gen token, never live bytes.
        let absent = describe_lifecycle(
            LifecycleComp::Tray,
            LifecycleEvent::OwnerChanged,
            None,
            None,
            None,
            None,
        );
        assert!(absent.contains("gen=invalid"), "{absent}");
        assert!(!absent.contains(":rev="), "{absent}");
        assert!(!absent.contains(":corr="), "{absent}");
    }

    #[test]
    fn lifecycle_revision_is_bounded_and_optional() {
        let in_bounds = describe_lifecycle(
            LifecycleComp::Planner,
            LifecycleEvent::Seeded,
            Some("test-gen-1"),
            Some(1_000_000),
            None,
            Some(LifecycleResult::Ok),
        );
        assert!(in_bounds.contains(":rev=1000000"), "{in_bounds}");
        let out_of_bounds = describe_lifecycle(
            LifecycleComp::Planner,
            LifecycleEvent::Seeded,
            Some("test-gen-1"),
            Some(1_000_001),
            None,
            Some(LifecycleResult::Ok),
        );
        assert!(!out_of_bounds.contains(":rev="), "{out_of_bounds}");
        assert!(out_of_bounds.contains("gen=test-gen-1"), "{out_of_bounds}");
    }

    #[test]
    fn session_outcomes_are_deterministic_and_redacted() {
        for (outcome, token) in [
            (SessionOutcome::Planned, "planned"),
            (SessionOutcome::Acknowledged, "acknowledged"),
            (SessionOutcome::Committed, "committed"),
            (SessionOutcome::Rejected, "rejected"),
            (SessionOutcome::Diverged, "diverged"),
            (SessionOutcome::Noop, "noop"),
        ] {
            let line = describe_session_outcome(outcome, Some("gen-1-f0"), Some(3));
            assert_eq!(
                line,
                format!(
                    "plasma-auto-tiler:route-diag:route=session:result={token}:corr=gen-1-f0:rev=3"
                ),
                "{line:?}"
            );
            // Deterministic: already-computed outcome renders identically.
            assert_eq!(
                line,
                describe_session_outcome(outcome, Some("gen-1-f0"), Some(3))
            );
        }
        // Bad correlation never echoes; out-of-bounds revision is omitted.
        let bad = describe_session_outcome(SessionOutcome::Committed, Some("bad corr!!"), Some(3));
        assert!(bad.contains("corr=invalid"), "{bad}");
        assert!(!bad.contains("bad corr!!"), "{bad}");
        let oob =
            describe_session_outcome(SessionOutcome::Planned, Some("gen-1-f0"), Some(u64::MAX));
        assert!(!oob.contains(":rev="), "{oob}");
        let absent = describe_session_outcome(SessionOutcome::Noop, None, None);
        assert!(absent.contains("corr=invalid"), "{absent}");
    }

    #[test]
    fn session_outcome_shares_correlation_with_reply_categories() {
        // One already-computed outcome correlates across the session line and
        // the D-Bus reply line with the same token and category.
        let session = describe_session_outcome(SessionOutcome::Planned, Some("gen-1-x9"), Some(3));
        let reply_line = describe_reply(Route::Focus, &reply("planned", "gen-1-x9"));
        assert!(session.contains("corr=gen-1-x9"), "{session}");
        assert!(reply_line.contains("corr=gen-1-x9"), "{reply_line}");
        assert!(session.contains("result=planned"), "{session}");
        assert!(reply_line.contains("result=planned"), "{reply_line}");
    }

    #[test]
    fn diagnostics_are_pure_and_never_mutate_inputs() {
        let req = request("request", "gen-1-f0");
        let rep = reply("planned", "gen-1-f0");
        let before_req = req.clone();
        let before_rep = rep.clone();
        let first = describe_request(Route::Focus, &req);
        let second = describe_request(Route::Focus, &req);
        assert_eq!(first, second);
        assert_eq!(req, before_req);
        assert_eq!(rep, before_rep);
        let lifecycle_first = describe_lifecycle(
            LifecycleComp::Tray,
            LifecycleEvent::Published,
            Some("test-gen-1"),
            Some(1),
            None,
            Some(LifecycleResult::Ok),
        );
        let lifecycle_second = describe_lifecycle(
            LifecycleComp::Tray,
            LifecycleEvent::Published,
            Some("test-gen-1"),
            Some(1),
            None,
            Some(LifecycleResult::Ok),
        );
        assert_eq!(lifecycle_first, lifecycle_second);
    }

    #[test]
    fn route_diag_command_is_visible_without_activation() {
        let status = route_diag_status();
        assert!(status.contains(ROUTE_DIAG_ANCHOR), "{status}");
        assert!(status.contains("--user"), "{status}");
        assert!(status.contains("-b"), "{status}");
        assert!(status.contains(ROUTE_DIAG_KWIN_UNIT), "{status}");
        assert!(status.contains(ROUTE_DIAG_PLANNER_UNIT), "{status}");
        assert!(status.contains("tray"), "{status}");
        assert!(status.contains("grep -F"), "{status}");
        // Combined viewer: the follow invocation reads the full
        // current-user current-boot journal (no `-u` unit restriction, so
        // the unit-less tray autostart is included); anchor filtering keeps
        // visible output exclusively anchored project records.
        assert!(
            status.contains("current-boot follow: journalctl --user -b | grep -F"),
            "{status}"
        );
        for forbidden in ["dbus", "systemctl", "busctl", "qdbus", "gdbus", "activate"] {
            assert!(
                !status.to_lowercase().contains(forbidden),
                "{status} must not contain {forbidden}"
            );
        }
        // Sink wiring: the binary routes `route-diag` to this pure status
        // with no bus access on that path.
        let main_source = include_str!("main.rs");
        assert!(
            main_source.contains("\"route-diag\""),
            "route-diag arm missing"
        );
        assert!(
            main_source.contains("route_diag::route_diag_status"),
            "route-diag arm must call the pure status"
        );
        let arm = main_source
            .split("\"route-diag\"")
            .nth(1)
            .expect("route-diag arm present");
        let arm_end = arm.find(']').unwrap_or(arm.len().min(600));
        let arm_head = &arm[..arm_end];
        for forbidden in ["zbus", "dbus", "systemctl", "Connection::"] {
            assert!(
                !arm_head.contains(forbidden),
                "route-diag arm must not touch {forbidden}"
            );
        }
    }

    #[test]
    fn move_advisory_shadow_routes_carry_corr_and_bounded_rev() {
        // Finding 1: EvaluateMove / DescribeAdvisoryPlan /
        // DescribeShadowProjection share the closed route categories with
        // correlation/revision where the actual route inputs carry them.
        for route in [Route::Move, Route::Advisory, Route::Shadow] {
            let req = describe_request(route, &request("request", "gen-1-m0"));
            assert!(req.contains(&format!("route={}", route.as_str())), "{req}");
            assert!(req.contains("action=request"), "{req}");
            assert!(req.contains("corr=gen-1-m0"), "{req}");
            assert!(req.contains("rev=3"), "{req}");
            let rep = describe_reply(route, &reply("planned", "gen-1-m0"));
            assert!(rep.contains("result=planned"), "{rep}");
            assert!(rep.contains("corr=gen-1-m0"), "{rep}");
            assert!(rep.contains("rev=3"), "{rep}");
            let refusal = describe_refusal(route, &request("request", "gen-1-m0"), Refusal::Busy);
            assert!(refusal.contains("result=busy"), "{refusal}");
            assert!(refusal.contains("corr=gen-1-m0"), "{refusal}");
            assert!(refusal.contains("rev=3"), "{refusal}");
        }
        // Advisory/shadow wire behavior is unchanged: tokens are exact.
        assert_eq!(Route::Move.as_str(), "move");
        assert_eq!(Route::Advisory.as_str(), "advisory");
        assert_eq!(Route::Shadow.as_str(), "shadow");
    }

    #[test]
    fn request_revision_is_bounded_and_redacted() {
        // Finding 6: revision boundedness applies to request fields too, with
        // redaction retained.
        let in_bounds = describe_request(Route::Move, &request("request", "gen-1-m1"));
        assert!(in_bounds.contains(":rev=3"), "{in_bounds}");
        let oob = json!({
            "v": 1,
            "action": "request",
            "correlation_id": "gen-1-m1",
            "revision": MAX_DIAG_REVISION + 1,
        })
        .to_string();
        let oob_line = describe_request(Route::Advisory, &oob);
        assert!(!oob_line.contains(":rev="), "{oob_line}");
        assert!(oob_line.contains("corr=gen-1-m1"), "{oob_line}");
        // No raw payload beyond validated tokens.
        let raw = json!({
            "v": 1,
            "action": "request",
            "correlation_id": "gen-1-m2",
            "revision": 3,
            "owner": "secret-owner-9",
            "geometry": "raw-bytes-9",
            "pid": 42429,
        })
        .to_string();
        let line = describe_request(Route::Shadow, &raw);
        for forbidden in ["secret-owner-9", "raw-bytes-9", "42429"] {
            assert!(
                !line.contains(forbidden),
                "{line} must not contain {forbidden}"
            );
        }
    }

    #[test]
    fn reply_and_refusal_revisions_are_bounded() {
        // Finding 6: out-of-bounds revisions are omitted, never echoed.
        let oob_reply = json!({
            "v": 1,
            "correlation_id": "gen-1-m1",
            "outcome": "planned",
            "revision": MAX_DIAG_REVISION + 1,
        })
        .to_string();
        let line = describe_reply(Route::Move, &oob_reply);
        assert!(!line.contains(":rev="), "{line}");
        assert!(line.contains("result=planned"), "{line}");
        let oob_req = json!({
            "v": 1,
            "action": "request",
            "correlation_id": "gen-1-m1",
            "revision": u64::MAX,
        })
        .to_string();
        let refusal = describe_refusal(Route::Shadow, &oob_req, Refusal::Unavailable);
        assert!(!refusal.contains(":rev="), "{refusal}");
        assert!(refusal.contains("corr=gen-1-m1"), "{refusal}");
        // base_revision is the bounded fallback for replies.
        let base = json!({
            "v": 1,
            "correlation_id": "gen-1-m1",
            "outcome": "committed",
            "base_revision": 7,
        })
        .to_string();
        let base_line = describe_reply(Route::Resize, &base);
        assert!(base_line.contains(":rev=7"), "{base_line}");
    }

    #[test]
    fn planner_boundary_session_line_derives_only_from_returned_reply() {
        // Finding 2: real production-call coverage at the Planner boundary
        // based only on the already-returned decision value (no Session
        // access, no portable-core logging dependency). The helper below is
        // what the D-Bus handlers emit alongside the wire reply.
        for (outcome, token) in [
            ("planned", "planned"),
            ("noop", "noop"),
            ("acknowledged", "acknowledged"),
            ("committed", "committed"),
            ("rejected", "rejected"),
            ("diverged", "diverged"),
        ] {
            let reply_text = reply(outcome, "gen-1-s9");
            let line = session_line_for_reply(&reply_text).expect("known outcome yields a line");
            assert!(line.contains("route=session"), "{line}");
            assert!(line.contains(&format!("result={token}")), "{line}");
            assert!(line.contains("corr=gen-1-s9"), "{line}");
            assert!(line.contains(":rev=3"), "{line}");
            // Deterministic over the already-computed value.
            assert_eq!(
                line,
                session_line_for_reply(&reply_text).expect("deterministic")
            );
        }
        // Unknown/malformed replies yield no session line (nothing emitted).
        assert!(session_line_for_reply(&reply("meltdown", "gen-1-s9")).is_none());
        assert!(session_line_for_reply("{not json").is_none());
        // Out-of-bounds reply revision is omitted, correlation still echoes.
        let oob = json!({
            "v": 1,
            "correlation_id": "gen-1-s9",
            "outcome": "planned",
            "revision": u64::MAX,
        })
        .to_string();
        let line = session_line_for_reply(&oob).expect("line without rev");
        assert!(!line.contains(":rev="), "{line}");
        assert!(line.contains("corr=gen-1-s9"), "{line}");
    }

    #[test]
    fn lifecycle_vocab_covers_only_actually_emitted_outcomes() {
        // Finding 3: closed component/event/result sets match the real
        // tray/bridge/planner emits (started/published/owner-changed/
        // enabled-changed/seeded/stopped/send-failed with ok/rejected/failed).
        assert_eq!(LifecycleComp::Tray.as_str(), "tray");
        assert_eq!(LifecycleComp::Bridge.as_str(), "bridge");
        assert_eq!(LifecycleComp::Planner.as_str(), "planner");
        for (event, token) in [
            (LifecycleEvent::Started, "started"),
            (LifecycleEvent::Published, "published"),
            (LifecycleEvent::OwnerChanged, "owner-changed"),
            (LifecycleEvent::EnabledChanged, "enabled-changed"),
            (LifecycleEvent::Seeded, "seeded"),
            (LifecycleEvent::Stopped, "stopped"),
            (LifecycleEvent::SendFailed, "send-failed"),
        ] {
            assert_eq!(event.as_str(), token);
            let line = describe_lifecycle(
                LifecycleComp::Planner,
                event,
                Some("test-gen-1"),
                Some(1),
                Some("gen-1-f0"),
                Some(LifecycleResult::Ok),
            );
            assert!(line.contains(&format!("event={token}")), "{line}");
        }
        // No dead result variants remain: only ok/rejected/failed.
        assert_eq!(LifecycleResult::Ok.as_str(), "ok");
        assert_eq!(LifecycleResult::Rejected.as_str(), "rejected");
        assert_eq!(LifecycleResult::Failed.as_str(), "failed");
    }

    #[test]
    fn source_config_and_viewer_agree_without_activation() {
        // Finding 5: the existing background Planner launch route retains
        // stdout/stderr in the user journal; the viewer reads the full
        // current-user current-boot journal anchor-filtered, so KWin,
        // Planner, and the unit-less tray autostart appear together with no
        // activation. KWin/Planner unit names remain documented source
        // metadata.
        let module = include_str!("../home-manager-module.nix");
        assert!(
            module.contains("plasma-auto-tiler-planner"),
            "planner unit missing from Home Manager module"
        );
        assert!(
            module.contains("StandardOutput") && module.contains("journal"),
            "planner unit must explicitly retain stdout in the user journal"
        );
        assert!(
            module.contains("StandardError") && module.contains("journal"),
            "planner unit must explicitly retain stderr in the user journal"
        );
        // The viewer constants agree exactly with the deployment source.
        // The Home Manager unit key is the base name; the viewer/follow
        // script carry the full `.service` unit name.
        assert!(
            module.contains(ROUTE_DIAG_PLANNER_UNIT.trim_end_matches(".service")),
            "viewer planner unit must match module"
        );
        let follow = include_str!("../scripts/route-diag-follow.sh");
        assert!(
            follow.contains(ROUTE_DIAG_KWIN_UNIT),
            "follow script must document the KWin unit"
        );
        assert!(
            follow.contains(ROUTE_DIAG_PLANNER_UNIT),
            "follow script must document the planner unit"
        );
        assert!(
            follow.contains(ROUTE_DIAG_ANCHOR),
            "follow script must filter on the anchor"
        );
        // Combined viewer: full current-user current-boot journal with no
        // `-u` unit restriction (the tray autostart has no committed unit).
        assert!(
            follow.contains("journal_args=(--user -b)"),
            "follow script must read the full current-boot user journal"
        );
        let status = route_diag_status();
        assert!(status.contains(ROUTE_DIAG_PLANNER_UNIT), "{status}");
        assert!(status.contains(ROUTE_DIAG_KWIN_UNIT), "{status}");
        // No activation verbs in the viewer path (code, not prose).
        for forbidden in ["systemctl", "busctl", "qdbus", "gdbus", "activate"] {
            assert!(
                !status.to_lowercase().contains(forbidden),
                "{status} must not contain {forbidden}"
            );
        }
    }

    #[test]
    fn planner_and_tray_release_locks_before_output_contract() {
        // Finding 4 (source contract, as feasible in unit tests): every
        // Planner handler releases the single-flight guard before emitting
        // diagnostics, and the tray releases its mutexes before output.
        let planner = include_str!("planner_service.rs");
        for handler in [
            "async fn evaluate_move",
            "async fn describe_advisory_plan",
            "async fn describe_shadow_projection",
            "async fn describe_focus",
            "async fn describe_movement",
            "async fn describe_resize",
            "async fn describe_pointer_resize",
        ] {
            let body = planner.split(handler).nth(1).expect("handler present");
            let end = body.find("async fn ").unwrap_or(body.len());
            let body = &body[..end];
            assert!(
                body.contains("drop(_guard)"),
                "{handler} must release the operation lock before output"
            );
            // Route-diag output goes through the emit helpers after release.
            // The only direct `eprintln!` allowed is the terminal armed-loss
            // barrier marker in `describe_advisory_plan`, which holds the
            // guard across its hang by design (documented at the barrier).
            assert!(
                body.contains("emit_route_"),
                "{handler} must route output through emit helpers after release"
            );
            let direct_prints = body.match_indices("eprintln!").count();
            if handler == "async fn describe_advisory_plan" {
                assert!(
                    direct_prints <= 1,
                    "{handler} has {direct_prints} direct prints (at most the armed-loss marker)"
                );
                if direct_prints == 1 {
                    assert!(
                        body.contains("{marker}"),
                        "{handler} direct print must be the armed-loss marker only"
                    );
                }
            } else {
                assert_eq!(
                    direct_prints, 0,
                    "{handler} must not print directly while holding the lock"
                );
            }
        }
        assert!(
            planner.contains("must have released"),
            "emit helpers must document the release-before-output contract"
        );
        let tray = include_str!("tray_endpoint.rs");
        assert!(
            tray.contains("released before any formatting or"),
            "tray publish path must document lock release before output"
        );
    }
}
