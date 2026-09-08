//! Bounded static shadow projection contract (read-only, OS-neutral).
//!
//! Portable JSON-string-in / JSON-string-out contract. Rust owns topology:
//! exactly three bare opaque window observations plus one output/workspace
//! with an explicit integer work-area rect, a bounded non-negative gap, an
//! observed focused window, and the `shadow-projection` capability. Explicit
//! `tree` / `leaf` / `focused_leaf` inputs are rejected; the nested
//! `H[A,V[B,C]]` state is built through [`crate::advisory_trio::AdoptedTrio`]
//! and leaf rectangles through [`crate::geometry::project`] (no duplicated
//! projection logic). Replies carry complete desired rectangles mapped to
//! opaque window ids, focus intent, the validated binding, the required
//! capability, and the complete fixed preconditions, with no native
//! command/execution/actuation fields.
//!
//! Wire rejects (fixed redacted strings, input never echoed except a valid
//! correlation id): oversized, malformed, unknown field/value, wrong schema
//! version, invalid correlation/owner/generation/revision shape, invalid
//! snapshot (window count != 3, explicit topology, scope/membership/
//! duplicate violations, malformed/nonfinite/noninteger/overflow rectangles,
//! gap out of bounds), unsupported capability, stale owner/generation/
//! revision/correlation, and malformed/partial requests.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::geometry::{Rect, project};
use crate::ids::{CorrelationId, GenerationId, OwnerId};

/// Shadow projection contract version (JSON string v1).
pub const SHADOW_CONTRACT_VERSION: u32 = 1;
/// Bounded request cap.
pub const SHADOW_MAX_REQUEST_BYTES: usize = 64 * 1024;
/// Bounded reply cap.
pub const SHADOW_MAX_REPLY_BYTES: usize = 64 * 1024;
/// Opaque id bound.
pub const SHADOW_MAX_ID_LEN: usize = 128;
/// Exact normalized window count.
pub const SHADOW_WINDOW_COUNT: usize = 3;
/// Revision bound (inclusive).
pub const SHADOW_MAX_REVISION: u64 = 1_000_000;
/// Gap bound (inclusive, device units).
pub const SHADOW_MAX_GAP: i32 = 256;
/// Work-area / observed rect extent bound (inclusive, device units).
pub const SHADOW_MAX_EXTENT: i32 = 32_768;
/// Bounded seen-correlation cap for the session tracker.
pub const SHADOW_MAX_SEEN_CORRELATIONS: usize = 2048;
/// Required capability token.
pub const SHADOW_REQUIRED_CAPABILITY: &str = "shadow-projection";
/// Complete fixed preconditions on every projected reply.
pub const SHADOW_PRECONDITIONS: &[&str] = &[
    "trio-adopted",
    "projection-contained-and-disjoint",
    "adapter-must-verify-postconditions",
];

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
const MSG_WINDOW_COUNT: &str = "snapshot requires exactly three windows";
const MSG_SNAPSHOT: &str = "snapshot or intent is malformed";
const MSG_RECT: &str = "rectangle is malformed";
const MSG_GAP: &str = "gap is out of bounds";
const MSG_UNSUPPORTED: &str = "operation needs an undeclared capability";
const MSG_STALE: &str = "revision does not match the pinned session revision";
const MSG_OWNER_MISMATCH: &str = "owner does not match the pinned session";
const MSG_GENERATION_MISMATCH: &str = "generation does not match the pinned session";
const MSG_CORRELATION_MISMATCH: &str = "correlation was already used";
const MSG_SESSION_FULL: &str = "shadow session correlation bound was reached";

fn is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= SHADOW_MAX_ID_LEN
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

/// In-memory shadow session tracker. Pins owner/generation on the first
/// successful projection and accepts only strictly increasing revisions with
/// fresh correlations, so signal-driven recomputations can proceed while
/// stale/duplicate revisions and correlations fail closed. OS-neutral: no
/// Linux/KWin types, process memory only.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ShadowSession {
    owner: Option<String>,
    generation: Option<String>,
    revision: u64,
    pinned: bool,
    seen_correlations: HashSet<String>,
}

impl ShadowSession {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn pinned_revision(&self) -> u64 {
        if self.pinned { self.revision } else { 0 }
    }

    #[must_use]
    pub fn is_pinned(&self) -> bool {
        self.pinned
    }

    fn binding_error(
        &self,
        owner: &str,
        generation: &str,
        revision: u64,
        correlation_id: &str,
    ) -> Option<(&'static str, &'static str)> {
        if !self.pinned {
            return None;
        }
        let pinned_owner = self.owner.as_deref().unwrap_or_default();
        let pinned_generation = self.generation.as_deref().unwrap_or_default();
        if owner != pinned_owner {
            return Some(("owner-mismatch", MSG_OWNER_MISMATCH));
        }
        if generation != pinned_generation {
            return Some(("generation-mismatch", MSG_GENERATION_MISMATCH));
        }
        if self.seen_correlations.contains(correlation_id) {
            return Some(("correlation-mismatch", MSG_CORRELATION_MISMATCH));
        }
        if revision <= self.revision {
            return Some(("stale-revision", MSG_STALE));
        }
        if self.seen_correlations.len() >= SHADOW_MAX_SEEN_CORRELATIONS {
            return Some(("stale-request", MSG_SESSION_FULL));
        }
        None
    }

    fn pin_on_success(
        &mut self,
        owner: &str,
        generation: &str,
        revision: u64,
        correlation_id: &str,
    ) {
        if !self.pinned {
            self.owner = Some(owner.to_owned());
            self.generation = Some(generation.to_owned());
            self.revision = revision;
            self.pinned = true;
        } else {
            self.revision = revision;
        }
        self.seen_correlations.insert(correlation_id.to_owned());
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RectDto {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct OutputDto {
    id: String,
    workspace: String,
    work_area: RectDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct WindowDto {
    window: String,
    output: String,
    workspace: String,
    rect: RectDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct CapabilitiesDto {
    shadow_projection: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ShadowRequest {
    v: u32,
    correlation_id: String,
    owner: String,
    generation: String,
    revision: u64,
    output: OutputDto,
    windows: Vec<WindowDto>,
    gap: i32,
    focused_window: String,
    capabilities: CapabilitiesDto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
struct ReplyRect {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct DesiredEntry {
    window: String,
    rect: ReplyRect,
}

#[derive(Debug, Clone, Serialize)]
struct ShadowReply {
    v: u32,
    correlation_id: String,
    owner: String,
    generation: String,
    revision: u64,
    outcome: &'static str,
    capability: Option<&'static str>,
    preconditions: Option<Vec<&'static str>>,
    desired: Option<Vec<DesiredEntry>>,
    focused_window: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'static str>,
}

fn valid_rect_dto(rect: &RectDto) -> bool {
    if rect.w <= 0 || rect.h <= 0 {
        return false;
    }
    if rect.w > SHADOW_MAX_EXTENT || rect.h > SHADOW_MAX_EXTENT {
        return false;
    }
    if rect.x.checked_add(rect.w).is_none() || rect.y.checked_add(rect.h).is_none() {
        return false;
    }
    true
}

fn serialize_bounded(reply: &ShadowReply) -> String {
    match serde_json::to_string(reply) {
        Ok(text) if text.len() <= SHADOW_MAX_REPLY_BYTES => text,
        _ => serde_json::to_string(&ShadowReply {
            v: SHADOW_CONTRACT_VERSION,
            correlation_id: String::new(),
            owner: String::new(),
            generation: String::new(),
            revision: 0,
            outcome: "rejected",
            capability: None,
            preconditions: None,
            desired: None,
            focused_window: None,
            kind: Some("snapshot-invalid"),
            message: Some(MSG_SNAPSHOT),
        })
        .unwrap_or_else(|_| {
            "{\"v\":1,\"correlation_id\":\"\",\"owner\":\"\",\"generation\":\"\",\"revision\":0,\"outcome\":\"rejected\",\"kind\":\"snapshot-invalid\",\"message\":\"snapshot or intent is malformed\"}"
                .to_owned()
        }),
    }
}

fn valid_correlation_echo(value: &serde_json::Value) -> String {
    value
        .get("correlation_id")
        .and_then(serde_json::Value::as_str)
        .filter(|id| CorrelationId::parse(id).is_some())
        .unwrap_or_default()
        .to_owned()
}

fn rejected(
    session: &ShadowSession,
    correlation_id: String,
    kind: &'static str,
    message: &'static str,
) -> String {
    serialize_bounded(&ShadowReply {
        v: SHADOW_CONTRACT_VERSION,
        correlation_id,
        owner: String::new(),
        generation: String::new(),
        revision: session.pinned_revision(),
        outcome: "rejected",
        capability: None,
        preconditions: None,
        desired: None,
        focused_window: None,
        kind: Some(kind),
        message: Some(message),
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

/// Strict JSON-only read-only shadow projection over the shared session
/// tracker. Always returns a bounded JSON reply string; revisions advance
/// only on successful projections.
#[must_use]
pub fn evaluate_shadow_json(session: &mut ShadowSession, request_json: &str) -> String {
    if request_json.len() > SHADOW_MAX_REQUEST_BYTES {
        return rejected(session, String::new(), "oversized", MSG_OVERSIZED);
    }
    let raw: serde_json::Value = match serde_json::from_str(request_json) {
        Ok(raw) => raw,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(session, String::new(), kind, message);
        }
    };
    let request: ShadowRequest = match serde_json::from_value(raw.clone()) {
        Ok(request) => request,
        Err(error) => {
            let (kind, message) = classify_parse_error(&error);
            return rejected(session, valid_correlation_echo(&raw), kind, message);
        }
    };
    if request.v != SHADOW_CONTRACT_VERSION {
        return rejected(
            session,
            valid_correlation_echo(&raw),
            "unsupported-version",
            MSG_VERSION,
        );
    }
    if CorrelationId::parse(&request.correlation_id).is_none() {
        return rejected(
            session,
            String::new(),
            "correlation-invalid",
            MSG_CORRELATION,
        );
    }
    if OwnerId::parse(&request.owner).is_none() {
        return rejected(
            session,
            request.correlation_id.clone(),
            "owner-invalid",
            MSG_OWNER,
        );
    }
    if GenerationId::parse(&request.generation).is_none() {
        return rejected(
            session,
            request.correlation_id.clone(),
            "generation-invalid",
            MSG_GENERATION,
        );
    }
    if request.revision > SHADOW_MAX_REVISION {
        return rejected(
            session,
            request.correlation_id.clone(),
            "revision-invalid",
            MSG_REVISION,
        );
    }
    let correlation_id = request.correlation_id.clone();
    let owner = request.owner.clone();
    let generation = request.generation.clone();
    let revision = request.revision;
    if let Some((kind, message)) =
        session.binding_error(&owner, &generation, revision, &correlation_id)
    {
        return rejected(session, correlation_id, kind, message);
    }
    // Scope / membership / cardinality.
    if !is_opaque_id(&request.output.id) || !is_opaque_id(&request.output.workspace) {
        return rejected(session, correlation_id, "snapshot-invalid", MSG_OPAQUE_ID);
    }
    if !valid_rect_dto(&request.output.work_area) {
        return rejected(session, correlation_id, "snapshot-invalid", MSG_RECT);
    }
    if request.gap < 0 || request.gap > SHADOW_MAX_GAP {
        return rejected(session, correlation_id, "snapshot-invalid", MSG_GAP);
    }
    if request.windows.len() != SHADOW_WINDOW_COUNT {
        return rejected(
            session,
            correlation_id,
            "snapshot-invalid",
            MSG_WINDOW_COUNT,
        );
    }
    if !is_opaque_id(&request.focused_window) {
        return rejected(session, correlation_id, "snapshot-invalid", MSG_OPAQUE_ID);
    }
    let mut seen_windows = BTreeMap::<String, &WindowDto>::new();
    for link in &request.windows {
        if !is_opaque_id(&link.window)
            || !is_opaque_id(&link.output)
            || !is_opaque_id(&link.workspace)
        {
            return rejected(session, correlation_id, "snapshot-invalid", MSG_OPAQUE_ID);
        }
        if link.output != request.output.id || link.workspace != request.output.workspace {
            return rejected(session, correlation_id, "snapshot-invalid", MSG_SNAPSHOT);
        }
        if !valid_rect_dto(&link.rect) {
            return rejected(session, correlation_id, "snapshot-invalid", MSG_RECT);
        }
        if seen_windows.insert(link.window.clone(), link).is_some() {
            return rejected(session, correlation_id, "snapshot-invalid", MSG_SNAPSHOT);
        }
    }
    if !seen_windows.contains_key(&request.focused_window) {
        return rejected(session, correlation_id, "snapshot-invalid", MSG_SNAPSHOT);
    }
    if !request.capabilities.shadow_projection {
        return rejected(
            session,
            correlation_id,
            "capability-unsupported",
            MSG_UNSUPPORTED,
        );
    }
    // Rust owns topology: deterministic adoption, then the shared projector.
    let observed: Vec<&str> = seen_windows.keys().map(String::as_str).collect();
    let [w0, w1, w2] = observed.as_slice() else {
        return rejected(
            session,
            correlation_id,
            "snapshot-invalid",
            MSG_WINDOW_COUNT,
        );
    };
    let adopted = match crate::advisory_trio::AdoptedTrio::adopt(
        &request.output.id,
        &request.output.workspace,
        [*w0, *w1, *w2],
    ) {
        Ok(adopted) => adopted,
        Err(error) => {
            if error.message().contains("malformed") {
                return rejected(session, correlation_id, "snapshot-invalid", MSG_OPAQUE_ID);
            }
            return rejected(session, correlation_id, "snapshot-invalid", MSG_SNAPSHOT);
        }
    };
    let bounds = Rect {
        x: request.output.work_area.x,
        y: request.output.work_area.y,
        w: request.output.work_area.w,
        h: request.output.work_area.h,
    };
    let tree = match adopted
        .snapshot()
        .outputs
        .first()
        .and_then(|o| o.tree.clone())
    {
        Some(tree) => tree,
        None => return rejected(session, correlation_id, "snapshot-invalid", MSG_SNAPSHOT),
    };
    let projected = match project(&tree, bounds, request.gap) {
        Ok(projected) => projected,
        Err(_) => return rejected(session, correlation_id, "snapshot-invalid", MSG_SNAPSHOT),
    };
    // Map derived leaves back to opaque windows; every window exactly once,
    // sorted for deterministic output over input permutation.
    let mut desired: Vec<DesiredEntry> = Vec::with_capacity(SHADOW_WINDOW_COUNT);
    for leaf in &projected {
        let window = leaf
            .leaf
            .0
            .strip_prefix(crate::advisory_trio::TRIO_LEAF_PREFIX);
        let Some(window) = window else {
            return rejected(session, correlation_id, "snapshot-invalid", MSG_SNAPSHOT);
        };
        if !seen_windows.contains_key(window) {
            return rejected(session, correlation_id, "snapshot-invalid", MSG_SNAPSHOT);
        }
        if desired.iter().any(|entry| entry.window == window) {
            return rejected(session, correlation_id, "snapshot-invalid", MSG_SNAPSHOT);
        }
        desired.push(DesiredEntry {
            window: window.to_owned(),
            rect: ReplyRect {
                x: leaf.rect.x,
                y: leaf.rect.y,
                w: leaf.rect.w,
                h: leaf.rect.h,
            },
        });
    }
    if desired.len() != SHADOW_WINDOW_COUNT {
        return rejected(session, correlation_id, "snapshot-invalid", MSG_SNAPSHOT);
    }
    desired.sort_by(|a, b| a.window.cmp(&b.window));
    session.pin_on_success(&owner, &generation, revision, &correlation_id);
    serialize_bounded(&ShadowReply {
        v: SHADOW_CONTRACT_VERSION,
        correlation_id,
        owner,
        generation,
        revision,
        outcome: "projected",
        capability: Some(SHADOW_REQUIRED_CAPABILITY),
        preconditions: Some(SHADOW_PRECONDITIONS.to_vec()),
        desired: Some(desired),
        focused_window: Some(request.focused_window.clone()),
        kind: None,
        message: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn valid_request(correlation: &str, revision: u64) -> Value {
        json!({
            "v": 1,
            "correlation_id": correlation,
            "owner": "owner-1",
            "generation": "gen-1",
            "revision": revision,
            "output": {
                "id": "source",
                "workspace": "workspace-1",
                "work_area": {"x": 0, "y": 0, "w": 90, "h": 60}
            },
            "windows": [
                {"window": "w-A", "output": "source", "workspace": "workspace-1", "rect": {"x": 0, "y": 0, "w": 10, "h": 10}},
                {"window": "w-B", "output": "source", "workspace": "workspace-1", "rect": {"x": 10, "y": 0, "w": 10, "h": 10}},
                {"window": "w-C", "output": "source", "workspace": "workspace-1", "rect": {"x": 20, "y": 0, "w": 10, "h": 10}}
            ],
            "gap": 4,
            "focused_window": "w-B",
            "capabilities": {"shadow_projection": true}
        })
    }

    fn evaluate(session: &mut ShadowSession, value: &Value) -> Value {
        let text = value.to_string();
        assert!(text.len() <= SHADOW_MAX_REQUEST_BYTES);
        let reply = evaluate_shadow_json(session, &text);
        assert!(reply.len() <= SHADOW_MAX_REPLY_BYTES);
        serde_json::from_str(&reply).expect("reply is JSON")
    }

    fn fresh() -> ShadowSession {
        ShadowSession::new()
    }

    #[test]
    fn projected_reply_carries_complete_desired_output_and_binding() {
        let mut session = fresh();
        let reply = evaluate(&mut session, &valid_request("corr-1", 0));
        assert_eq!(reply["outcome"], "projected");
        assert_eq!(reply["v"], 1);
        assert_eq!(reply["correlation_id"], "corr-1");
        assert_eq!(reply["owner"], "owner-1");
        assert_eq!(reply["generation"], "gen-1");
        assert_eq!(reply["revision"], 0);
        assert_eq!(reply["capability"], "shadow-projection");
        assert_eq!(
            reply["preconditions"],
            json!([
                "trio-adopted",
                "projection-contained-and-disjoint",
                "adapter-must-verify-postconditions"
            ])
        );
        assert_eq!(reply["focused_window"], "w-B");
        let desired = reply["desired"].as_array().expect("desired array");
        assert_eq!(desired.len(), 3);
        let windows: Vec<&str> = desired
            .iter()
            .map(|e| e["window"].as_str().expect("window"))
            .collect();
        assert_eq!(windows, vec!["w-A", "w-B", "w-C"]);
        // Gap/share rounding through the existing projector: root avail
        // 90-4=86 halves of 43; inner avail 60-4=56 halves of 28 each.
        assert_eq!(
            desired[0]["rect"],
            json!({"x": 0, "y": 0, "w": 43, "h": 60})
        );
        assert_eq!(
            desired[1]["rect"],
            json!({"x": 47, "y": 0, "w": 43, "h": 28})
        );
        assert_eq!(
            desired[2]["rect"],
            json!({"x": 47, "y": 32, "w": 43, "h": 28})
        );
        assert!(session.is_pinned());
        let text = reply.to_string();
        for forbidden in [
            "\"command\"",
            "\"execute\"",
            "\"exec\"",
            "\"script\"",
            "\"native\"",
            "\"action\"",
            "\"cleanup\"",
            "\"envelopes\"",
        ] {
            assert!(
                !text.contains(forbidden),
                "reply must not contain {forbidden}"
            );
        }
    }

    #[test]
    fn determinism_holds_over_input_window_permutation() {
        let mut first_session = fresh();
        let first = evaluate(&mut first_session, &valid_request("corr-1", 0));
        let mut shuffled = valid_request("corr-1", 0);
        shuffled["windows"] = json!([
            {"window": "w-C", "output": "source", "workspace": "workspace-1", "rect": {"x": 20, "y": 0, "w": 10, "h": 10}},
            {"window": "w-A", "output": "source", "workspace": "workspace-1", "rect": {"x": 0, "y": 0, "w": 10, "h": 10}},
            {"window": "w-B", "output": "source", "workspace": "workspace-1", "rect": {"x": 10, "y": 0, "w": 10, "h": 10}}
        ]);
        let mut second_session = fresh();
        let second = evaluate(&mut second_session, &shuffled);
        assert_eq!(first["desired"], second["desired"]);
        assert_eq!(first["outcome"], "projected");
        assert_eq!(second["outcome"], "projected");
    }

    #[test]
    fn nary_project_compatibility_through_shared_projector() {
        // Direct geometry projector check: the adopted trio tree projects
        // deterministically with exact gaps and containment.
        let adopted = crate::advisory_trio::AdoptedTrio::adopt(
            "source",
            "workspace-1",
            ["w-A", "w-B", "w-C"],
        )
        .expect("adopt");
        let tree = adopted.snapshot().outputs[0].tree.clone().expect("tree");
        let bounds = Rect {
            x: 0,
            y: 0,
            w: 90,
            h: 60,
        };
        let first = project(&tree, bounds, 4).expect("project");
        let second = project(&tree, bounds, 4).expect("project");
        assert_eq!(first, second);
        assert_eq!(first.len(), 3);
        assert_eq!(
            first[0].rect,
            Rect {
                x: 0,
                y: 0,
                w: 43,
                h: 60
            }
        );
        assert_eq!(
            first[1].rect,
            Rect {
                x: 47,
                y: 0,
                w: 43,
                h: 28
            }
        );
        assert_eq!(
            first[2].rect,
            Rect {
                x: 47,
                y: 32,
                w: 43,
                h: 28
            }
        );
    }

    #[test]
    fn explicit_topology_fields_are_rejected() {
        let mut session = fresh();
        let mut request = valid_request("corr-1", 0);
        request["output"]["tree"] = json!({"kind": "leaf", "id": "A"});
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert!(!session.is_pinned());

        let mut request = valid_request("corr-1", 0);
        request["windows"][0]["leaf"] = json!("leaf-w-A");
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");

        let mut request = valid_request("corr-1", 0);
        request["focused_leaf"] = json!("leaf-w-B");
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
    }

    #[test]
    fn malformed_rectangles_and_gap_reject() {
        let mut session = fresh();
        // Non-integer work area.
        let mut request = valid_request("corr-1", 0);
        request["output"]["work_area"] = json!({"x": 0.5, "y": 0, "w": 90, "h": 60});
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert!(!session.is_pinned());
        // Zero extent.
        let mut request = valid_request("corr-1", 0);
        request["output"]["work_area"] = json!({"x": 0, "y": 0, "w": 0, "h": 60});
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        // Overflow: x + w overflows i32.
        let mut request = valid_request("corr-1", 0);
        request["output"]["work_area"] = json!({"x": 2147483647, "y": 0, "w": 1, "h": 60});
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        // Negative gap and over-bound gap.
        let mut request = valid_request("corr-1", 0);
        request["gap"] = json!(-1);
        assert_eq!(evaluate(&mut session, &request)["outcome"], "rejected");
        let mut request = valid_request("corr-1", 0);
        request["gap"] = json!(SHADOW_MAX_GAP + 1);
        assert_eq!(evaluate(&mut session, &request)["outcome"], "rejected");
        // Malformed observed rect without echo.
        let mut request = valid_request("corr-1", 0);
        request["windows"][0]["rect"] = json!({"x": 0, "y": 0, "w": 10, "h": 0});
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert!(!session.is_pinned());
    }

    #[test]
    fn scope_membership_duplicates_and_count_reject() {
        let mut session = fresh();
        // Scope mismatch.
        let mut request = valid_request("corr-1", 0);
        request["windows"][0]["workspace"] = json!("workspace-2");
        assert_eq!(evaluate(&mut session, &request)["outcome"], "rejected");
        // Duplicate windows.
        let mut request = valid_request("corr-1", 0);
        request["windows"][1]["window"] = json!("w-A");
        assert_eq!(evaluate(&mut session, &request)["outcome"], "rejected");
        // Focused window outside the set.
        let mut request = valid_request("corr-1", 0);
        request["focused_window"] = json!("w-Z");
        assert_eq!(evaluate(&mut session, &request)["outcome"], "rejected");
        // Missing window.
        let mut request = valid_request("corr-1", 0);
        request["windows"] = json!([
            {"window": "w-A", "output": "source", "workspace": "workspace-1", "rect": {"x": 0, "y": 0, "w": 10, "h": 10}},
            {"window": "w-B", "output": "source", "workspace": "workspace-1", "rect": {"x": 10, "y": 0, "w": 10, "h": 10}}
        ]);
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["message"], MSG_WINDOW_COUNT);
        // Extra window.
        let mut request = valid_request("corr-1", 0);
        let mut windows = request["windows"].as_array().unwrap().clone();
        windows.push(json!({"window": "w-D", "output": "source", "workspace": "workspace-1", "rect": {"x": 30, "y": 0, "w": 10, "h": 10}}));
        request["windows"] = json!(windows);
        assert_eq!(evaluate(&mut session, &request)["outcome"], "rejected");
        assert!(!session.is_pinned());
    }

    #[test]
    fn capability_precondition_binding_and_stale_refusal() {
        let mut session = fresh();
        // Unsupported capability.
        let mut request = valid_request("corr-1", 0);
        request["capabilities"] = json!({"shadow_projection": false});
        let reply = evaluate(&mut session, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["kind"], "capability-unsupported");
        assert!(!session.is_pinned());
        // First success pins.
        let first = evaluate(&mut session, &valid_request("corr-1", 0));
        assert_eq!(first["outcome"], "projected");
        // Strictly increasing revision accepted (signal-driven recompute).
        let second = evaluate(&mut session, &valid_request("corr-2", 1));
        assert_eq!(second["outcome"], "projected");
        assert_eq!(second["revision"], 1);
        // Stale / duplicate revisions rejected.
        let stale = evaluate(&mut session, &valid_request("corr-3", 1));
        assert_eq!(stale["outcome"], "rejected");
        assert_eq!(stale["kind"], "stale-revision");
        // Duplicate correlation rejected even with a fresh revision.
        let dup = evaluate(&mut session, &valid_request("corr-2", 2));
        assert_eq!(dup["outcome"], "rejected");
        assert_eq!(dup["kind"], "correlation-mismatch");
        // Owner / generation mismatch rejected without echo.
        let mut bad_owner = valid_request("corr-4", 2);
        bad_owner["owner"] = json!("owner-2");
        let reply = evaluate(&mut session, &bad_owner);
        assert_eq!(reply["kind"], "owner-mismatch");
        assert!(!reply.to_string().contains("owner-2"));
        let mut bad_gen = valid_request("corr-5", 2);
        bad_gen["generation"] = json!("gen-2");
        assert_eq!(
            evaluate(&mut session, &bad_gen)["kind"],
            "generation-mismatch"
        );
        // Malformed / partial requests rejected.
        let reply: Value = serde_json::from_str(&evaluate_shadow_json(&mut session, "{not json}"))
            .expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected");
        let mut partial = valid_request("corr-6", 3);
        partial.as_object_mut().unwrap().remove("gap");
        assert_eq!(evaluate(&mut session, &partial)["outcome"], "rejected");
    }
}
