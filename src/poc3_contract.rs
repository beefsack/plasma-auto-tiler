//! POC3 strict versioned bounded JSON contract.
//!
//! Single service command route [`evaluate_poc3_json`]: a pure string-in /
//! string-out function over a caller-owned [`crate::poc3::Poc3Engine`]. The
//! engine owns all session state in process memory; this layer only validates
//! bounds, opacity, revisions, and ownership, then maps fixed engine failures
//! to redacted replies.
//!
//! Future D-Bus wiring (left for a later adapter; intentionally not coupled
//! here): expose this route as `EvaluatePoc3` on service
//! `org.plasmaautotiler.Planner`, object `/org/plasmaautotiler/Planner`,
//! interface `org.plasmaautotiler.Planner1`, with a JSON-string request and a
//! JSON-string reply, reusing the existing caller-verification and
//! single-flight patterns. Existing `EvaluateMove` behavior stays frozen.
//!
//! Rules: 64KiB request/reply cap, `v` version pin, per-request correlation
//! echo, owner/generation pinning after start, stale-revision rejection before
//! any intent, unknown-field denial, fixed redacted diagnostics (user input is
//! never echoed in errors).

use serde::{Deserialize, Serialize};

use crate::directional::Direction;
use crate::poc3::{
    CleanupModel, CompletionResult, DivergentReason, EnrolledWindow, POC3_MAX_GAP, POC3_MAX_ORIGIN,
    POC3_MAX_SIDE, POC3_MIN_ORIGIN, POC3_MIN_SIDE, POC3_WINDOW_COUNT, Poc3Engine, Poc3Error, Rect,
    StartParams,
};

/// POC3 contract version.
pub const POC3_CONTRACT_VERSION: u32 = 3;
/// Bounded request cap (matches the existing 64KiB planner bound).
pub const POC3_MAX_REQUEST_BYTES: usize = 64 * 1024;
/// Bounded reply cap (matches the existing 64KiB planner bound).
pub const POC3_MAX_REPLY_BYTES: usize = 64 * 1024;
/// Opaque id bound (window ids, owner tokens, scope aliases).
pub const POC3_MAX_ID_LEN: usize = 128;
/// Correlation id bound.
pub const POC3_MAX_CORRELATION_LEN: usize = 128;
/// Generation bound.
pub const POC3_MAX_GENERATION_LEN: usize = 64;
/// Adapter-only rollback envelope bound in bytes.
pub const POC3_MAX_ROLLBACK_BYTES: usize = 4096;

const MSG_OVERSIZED: &str = "request exceeds size bound";
const MSG_MALFORMED: &str = "request is malformed";
const MSG_UNKNOWN_FIELD: &str = "request contains an unknown field";
const MSG_UNKNOWN_VALUE: &str = "request contains an unknown value";
const MSG_UNKNOWN_COMMAND: &str = "request names an unknown command";
const MSG_VERSION: &str = "unsupported contract version";
const MSG_CORRELATION: &str = "correlation id is invalid";
const MSG_GENERATION: &str = "generation is invalid";
const MSG_OPAQUE_ID: &str = "opaque id is invalid";
const MSG_SCOPE: &str = "scope alias is invalid";
const MSG_ROLLBACK: &str = "rollback envelope is invalid";
const MSG_REVISION: &str = "revision is invalid";
const MSG_GEOMETRY: &str = "usable geometry is invalid";
const MSG_GAP: &str = "gap is invalid";
const MSG_RESULT: &str = "completion result is invalid";
const MSG_CLEANUP: &str = "cleanup model is invalid; only close-disposable is supported";

fn is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= POC3_MAX_ID_LEN
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

/// Window identity validation. Accepts the legacy opaque form plus the
/// observed `String(Window.internalId)` QUuid family: canonical
/// `8-4-4-4-12` hex with or without the single wrapping `{...}` pair that
/// `QUuid::toString()` emits. Braces are allowed only as that exact wrapping
/// pair, never elsewhere. Anything else is rejected before engine contact.
fn is_window_id(value: &str) -> bool {
    if value.is_empty() || value.len() > POC3_MAX_ID_LEN {
        return false;
    }
    if is_opaque_id(value) {
        return true;
    }
    let inner = value.strip_prefix('{').and_then(|s| s.strip_suffix('}'));
    let hex = inner.unwrap_or(value);
    let mut segments = hex.split('-');
    const LENS: [usize; 5] = [8, 4, 4, 4, 12];
    for expected in LENS {
        let Some(part) = segments.next() else {
            return false;
        };
        if part.len() != expected || !part.bytes().all(|b| b.is_ascii_hexdigit()) {
            return false;
        }
    }
    segments.next().is_none()
}

fn is_correlation_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= POC3_MAX_CORRELATION_LEN
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

fn is_generation(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= POC3_MAX_GENERATION_LEN
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum DirectionDto {
    Left,
    Right,
    Up,
    Down,
}

impl DirectionDto {
    const fn convert(self) -> Direction {
        match self {
            Self::Left => Direction::Left,
            Self::Right => Direction::Right,
            Self::Up => Direction::Up,
            Self::Down => Direction::Down,
        }
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
struct WindowDto {
    id: String,
    scope: String,
    rollback: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct CapabilitiesDto {
    untiled_asserted: bool,
    disposable: bool,
    restore_capable: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct StartDto {
    v: u32,
    correlation_id: String,
    owner: String,
    generation: String,
    scope: String,
    usable: RectDto,
    gap: i32,
    windows: Vec<WindowDto>,
    session_rollback: String,
    capabilities: CapabilitiesDto,
    cleanup: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct FocusMoveDto {
    v: u32,
    correlation_id: String,
    owner: String,
    generation: String,
    expected_revision: u64,
    direction: DirectionDto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum CompletionOutcomeDto {
    Applied,
    Divergent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum DivergentReasonDto {
    GeometryMismatch,
    WindowMissing,
    FocusUnverified,
    PartialApplication,
}

impl DivergentReasonDto {
    const fn convert(self) -> DivergentReason {
        match self {
            Self::GeometryMismatch => DivergentReason::GeometryMismatch,
            Self::WindowMissing => DivergentReason::WindowMissing,
            Self::FocusUnverified => DivergentReason::FocusUnverified,
            Self::PartialApplication => DivergentReason::PartialApplication,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteDto {
    v: u32,
    correlation_id: String,
    owner: String,
    generation: String,
    expected_revision: u64,
    outcome: CompletionOutcomeDto,
    #[serde(default)]
    reason: Option<DivergentReasonDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct StatusDto {
    v: u32,
    correlation_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct StopDto {
    v: u32,
    correlation_id: String,
    owner: String,
    generation: String,
    expected_revision: u64,
    confirm_restore: bool,
}

#[derive(Debug, Clone, Serialize)]
struct ErrorBody {
    kind: &'static str,
    message: &'static str,
}

#[derive(Debug, Clone, Serialize)]
struct Reply {
    v: u32,
    correlation_id: String,
    command: String,
    outcome: &'static str,
    revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    intent: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    noop: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cleanup: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ErrorBody>,
}

fn serialize_bounded(reply: &Reply) -> String {
    match serde_json::to_string(reply) {
        Ok(text) if text.len() <= POC3_MAX_REPLY_BYTES => text,
        _ => {
            let fallback = Reply {
                v: POC3_CONTRACT_VERSION,
                correlation_id: String::new(),
                command: "unknown".to_owned(),
                outcome: "rejected",
                revision: 0,
                intent: None,
                noop: None,
                completed: None,
                status: None,
                cleanup: None,
                error: Some(ErrorBody {
                    kind: "malformed-topology",
                    message: MSG_MALFORMED,
                }),
            };
            serde_json::to_string(&fallback).unwrap_or_else(|_| {
                "{\"v\":3,\"correlation_id\":\"\",\"command\":\"unknown\",\"outcome\":\"rejected\",\"revision\":0}"
                    .to_owned()
            })
        }
    }
}

fn rejected(
    command: &str,
    correlation_id: String,
    revision: u64,
    kind: &'static str,
    message: &'static str,
) -> String {
    serialize_bounded(&Reply {
        v: POC3_CONTRACT_VERSION,
        correlation_id,
        command: command.to_owned(),
        outcome: "rejected",
        revision,
        intent: None,
        noop: None,
        completed: None,
        status: None,
        cleanup: None,
        error: Some(ErrorBody { kind, message }),
    })
}

fn engine_rejected(
    engine: &Poc3Engine,
    command: &str,
    correlation_id: String,
    error: Poc3Error,
) -> String {
    rejected(
        command,
        correlation_id,
        engine.status().revision,
        error.kind(),
        error.message(),
    )
}

fn classify_value_error(error: &serde_json::Error) -> &'static str {
    let text = error.to_string();
    if text.contains("unknown field") {
        MSG_UNKNOWN_FIELD
    } else if text.contains("unknown variant") {
        MSG_UNKNOWN_VALUE
    } else {
        MSG_MALFORMED
    }
}

/// Best-effort valid correlation echo for malformed requests. Only echoes
/// values that already satisfy the opaque format; never echoes input
/// otherwise.
fn opportunistic_correlation(value: &serde_json::Value) -> String {
    value
        .get("correlation_id")
        .and_then(serde_json::Value::as_str)
        .filter(|id| is_correlation_id(id))
        .unwrap_or_default()
        .to_owned()
}

fn valid_rect(dto: &RectDto) -> Option<Rect> {
    if !(POC3_MIN_ORIGIN..=POC3_MAX_ORIGIN).contains(&dto.x)
        || !(POC3_MIN_ORIGIN..=POC3_MAX_ORIGIN).contains(&dto.y)
        || !(POC3_MIN_SIDE..=POC3_MAX_SIDE).contains(&dto.w)
        || !(POC3_MIN_SIDE..=POC3_MAX_SIDE).contains(&dto.h)
    {
        return None;
    }
    Some(Rect {
        x: dto.x,
        y: dto.y,
        w: dto.w,
        h: dto.h,
    })
}

fn valid_rollback(value: &str) -> bool {
    value.len() <= POC3_MAX_ROLLBACK_BYTES
}

fn handle_start(engine: &mut Poc3Engine, value: serde_json::Value) -> String {
    let dto: StartDto = match serde_json::from_value(value) {
        Ok(dto) => dto,
        Err(error) => {
            return rejected(
                "start",
                String::new(),
                0,
                "request-malformed",
                classify_value_error(&error),
            );
        }
    };
    if dto.v != POC3_CONTRACT_VERSION {
        return rejected("start", String::new(), 0, "version", MSG_VERSION);
    }
    if !is_correlation_id(&dto.correlation_id) {
        return rejected("start", String::new(), 0, "correlation", MSG_CORRELATION);
    }
    let correlation_id = dto.correlation_id.clone();
    if !is_opaque_id(&dto.owner) {
        return rejected("start", correlation_id, 0, "owner", MSG_OPAQUE_ID);
    }
    if !is_generation(&dto.generation) {
        return rejected("start", correlation_id, 0, "generation", MSG_GENERATION);
    }
    if !is_opaque_id(&dto.scope) {
        return rejected("start", correlation_id, 0, "scope", MSG_SCOPE);
    }
    if dto.windows.len() != POC3_WINDOW_COUNT {
        return rejected(
            "start",
            correlation_id,
            0,
            Poc3Error::WindowCount.kind(),
            Poc3Error::WindowCount.message(),
        );
    }
    let Some(cleanup) = CleanupModel::parse(dto.cleanup.as_str()) else {
        return rejected("start", correlation_id, 0, "cleanup-model", MSG_CLEANUP);
    };
    for window in &dto.windows {
        if !is_window_id(&window.id) {
            return rejected("start", correlation_id, 0, "opaque-id", MSG_OPAQUE_ID);
        }
        if !is_opaque_id(&window.scope) {
            return rejected("start", correlation_id, 0, "scope", MSG_SCOPE);
        }
        if !valid_rollback(&window.rollback) {
            return rejected("start", correlation_id, 0, "rollback", MSG_ROLLBACK);
        }
    }
    if !valid_rollback(&dto.session_rollback) {
        return rejected("start", correlation_id, 0, "rollback", MSG_ROLLBACK);
    }
    let Some(usable) = valid_rect(&dto.usable) else {
        return rejected("start", correlation_id, 0, "geometry", MSG_GEOMETRY);
    };
    if !(0..=POC3_MAX_GAP).contains(&dto.gap) {
        return rejected("start", correlation_id, 0, "gap", MSG_GAP);
    }
    let params = StartParams {
        owner: dto.owner,
        generation: dto.generation,
        scope: dto.scope,
        usable,
        gap: dto.gap,
        windows: dto
            .windows
            .into_iter()
            .map(|w| EnrolledWindow {
                id: w.id,
                scope: w.scope,
                rollback: w.rollback,
            })
            .collect(),
        session_rollback: dto.session_rollback,
        untiled_asserted: dto.capabilities.untiled_asserted,
        disposable: dto.capabilities.disposable,
        restore_capable: dto.capabilities.restore_capable,
        cleanup,
    };
    match engine.start(params) {
        Ok(intent) => serialize_bounded(&Reply {
            v: POC3_CONTRACT_VERSION,
            correlation_id,
            command: "start".to_owned(),
            outcome: "ok",
            revision: intent.base_revision,
            intent: Some(serde_json::to_value(&intent).unwrap_or(serde_json::Value::Null)),
            noop: None,
            completed: None,
            status: None,
            cleanup: None,
            error: None,
        }),
        Err(error) => engine_rejected(engine, "start", correlation_id, error),
    }
}

fn session_dto<T>(
    value: serde_json::Value,
    command: &'static str,
    parse: impl FnOnce(serde_json::Value) -> Result<T, serde_json::Error>,
    validate: impl FnOnce(&T, &mut Poc3Engine, String) -> String,
    engine: &mut Poc3Engine,
) -> String {
    let dto = match parse(value) {
        Ok(dto) => dto,
        Err(error) => {
            return rejected(
                command,
                String::new(),
                engine.status().revision,
                "request-malformed",
                classify_value_error(&error),
            );
        }
    };
    validate(&dto, engine, command.to_owned())
}

fn check_envelope(
    v: u32,
    correlation_id: &str,
    owner: &str,
    generation: &str,
    command: &str,
) -> Result<String, String> {
    if v != POC3_CONTRACT_VERSION {
        return Err(rejected(command, String::new(), 0, "version", MSG_VERSION));
    }
    if !is_correlation_id(correlation_id) {
        return Err(rejected(
            command,
            String::new(),
            0,
            "correlation",
            MSG_CORRELATION,
        ));
    }
    if !is_opaque_id(owner) {
        return Err(rejected(
            command,
            correlation_id.to_owned(),
            0,
            "owner",
            MSG_OPAQUE_ID,
        ));
    }
    if !is_generation(generation) {
        return Err(rejected(
            command,
            correlation_id.to_owned(),
            0,
            "generation",
            MSG_GENERATION,
        ));
    }
    Ok(correlation_id.to_owned())
}

fn handle_focus(engine: &mut Poc3Engine, value: serde_json::Value) -> String {
    session_dto(
        value,
        "focus",
        serde_json::from_value::<FocusMoveDto>,
        |dto, engine, command| {
            let correlation_id = match check_envelope(
                dto.v,
                &dto.correlation_id,
                &dto.owner,
                &dto.generation,
                &command,
            ) {
                Ok(id) => id,
                Err(reply) => return reply,
            };
            match engine.dispatch_focus(
                &dto.owner,
                &dto.generation,
                dto.expected_revision,
                dto.direction.convert(),
            ) {
                Ok(crate::poc3::DispatchOutcome::Planned(intent)) => serialize_bounded(&Reply {
                    v: POC3_CONTRACT_VERSION,
                    correlation_id,
                    command,
                    outcome: "ok",
                    revision: intent.base_revision,
                    intent: Some(serde_json::to_value(&intent).unwrap_or(serde_json::Value::Null)),
                    noop: None,
                    completed: None,
                    status: None,
                    cleanup: None,
                    error: None,
                }),
                Ok(crate::poc3::DispatchOutcome::Noop(noop)) => serialize_bounded(&Reply {
                    v: POC3_CONTRACT_VERSION,
                    correlation_id,
                    command,
                    outcome: "noop",
                    revision: noop.revision,
                    intent: None,
                    noop: Some(serde_json::to_value(&noop).unwrap_or(serde_json::Value::Null)),
                    completed: None,
                    status: None,
                    cleanup: None,
                    error: None,
                }),
                Err(error) => engine_rejected(engine, &command, correlation_id, error),
            }
        },
        engine,
    )
}

fn handle_move(engine: &mut Poc3Engine, value: serde_json::Value) -> String {
    session_dto(
        value,
        "move",
        serde_json::from_value::<FocusMoveDto>,
        |dto, engine, command| {
            let correlation_id = match check_envelope(
                dto.v,
                &dto.correlation_id,
                &dto.owner,
                &dto.generation,
                &command,
            ) {
                Ok(id) => id,
                Err(reply) => return reply,
            };
            match engine.dispatch_move(
                &dto.owner,
                &dto.generation,
                dto.expected_revision,
                dto.direction.convert(),
            ) {
                Ok(crate::poc3::DispatchOutcome::Planned(intent)) => serialize_bounded(&Reply {
                    v: POC3_CONTRACT_VERSION,
                    correlation_id,
                    command,
                    outcome: "ok",
                    revision: intent.base_revision,
                    intent: Some(serde_json::to_value(&intent).unwrap_or(serde_json::Value::Null)),
                    noop: None,
                    completed: None,
                    status: None,
                    cleanup: None,
                    error: None,
                }),
                Ok(crate::poc3::DispatchOutcome::Noop(noop)) => serialize_bounded(&Reply {
                    v: POC3_CONTRACT_VERSION,
                    correlation_id,
                    command,
                    outcome: "noop",
                    revision: noop.revision,
                    intent: None,
                    noop: Some(serde_json::to_value(&noop).unwrap_or(serde_json::Value::Null)),
                    completed: None,
                    status: None,
                    cleanup: None,
                    error: None,
                }),
                Err(error) => engine_rejected(engine, &command, correlation_id, error),
            }
        },
        engine,
    )
}

fn handle_complete(engine: &mut Poc3Engine, value: serde_json::Value) -> String {
    session_dto(
        value,
        "complete",
        serde_json::from_value::<CompleteDto>,
        |dto, engine, command| {
            let correlation_id = match check_envelope(
                dto.v,
                &dto.correlation_id,
                &dto.owner,
                &dto.generation,
                &command,
            ) {
                Ok(id) => id,
                Err(reply) => return reply,
            };
            let (result, reason) = match dto.outcome {
                CompletionOutcomeDto::Applied => {
                    if dto.reason.is_some() {
                        return rejected(
                            &command,
                            correlation_id,
                            engine.status().revision,
                            "result",
                            MSG_RESULT,
                        );
                    }
                    (CompletionResult::Applied, None)
                }
                CompletionOutcomeDto::Divergent => {
                    let Some(reason) = dto.reason else {
                        return rejected(
                            &command,
                            correlation_id,
                            engine.status().revision,
                            "result",
                            MSG_RESULT,
                        );
                    };
                    (CompletionResult::Divergent, Some(reason.convert()))
                }
            };
            if dto.expected_revision > crate::poc3::POC3_MAX_REVISION {
                return rejected(
                    &command,
                    correlation_id,
                    engine.status().revision,
                    "revision",
                    MSG_REVISION,
                );
            }
            match engine.complete(
                &dto.owner,
                &dto.generation,
                dto.expected_revision,
                result,
                reason,
            ) {
                Ok(view) => {
                    let outcome = if view.divergent { "diverged" } else { "ok" };
                    serialize_bounded(&Reply {
                        v: POC3_CONTRACT_VERSION,
                        correlation_id,
                        command,
                        outcome,
                        revision: view.revision,
                        intent: None,
                        noop: None,
                        completed: Some(
                            serde_json::to_value(&view).unwrap_or(serde_json::Value::Null),
                        ),
                        status: None,
                        cleanup: None,
                        error: None,
                    })
                }
                Err(error) => engine_rejected(engine, &command, correlation_id, error),
            }
        },
        engine,
    )
}

fn handle_status(engine: &mut Poc3Engine, value: serde_json::Value) -> String {
    let dto: StatusDto = match serde_json::from_value(value) {
        Ok(dto) => dto,
        Err(error) => {
            return rejected(
                "status",
                String::new(),
                engine.status().revision,
                "request-malformed",
                classify_value_error(&error),
            );
        }
    };
    if dto.v != POC3_CONTRACT_VERSION {
        return rejected("status", String::new(), 0, "version", MSG_VERSION);
    }
    if !is_correlation_id(&dto.correlation_id) {
        return rejected("status", String::new(), 0, "correlation", MSG_CORRELATION);
    }
    let status = engine.status();
    serialize_bounded(&Reply {
        v: POC3_CONTRACT_VERSION,
        correlation_id: dto.correlation_id,
        command: "status".to_owned(),
        outcome: "ok",
        revision: status.revision,
        intent: None,
        noop: None,
        completed: None,
        status: Some(serde_json::to_value(&status).unwrap_or(serde_json::Value::Null)),
        cleanup: None,
        error: None,
    })
}

fn handle_stop(engine: &mut Poc3Engine, value: serde_json::Value) -> String {
    session_dto(
        value,
        "stop",
        serde_json::from_value::<StopDto>,
        |dto, engine, command| {
            let correlation_id = match check_envelope(
                dto.v,
                &dto.correlation_id,
                &dto.owner,
                &dto.generation,
                &command,
            ) {
                Ok(id) => id,
                Err(reply) => return reply,
            };
            if dto.expected_revision > crate::poc3::POC3_MAX_REVISION {
                return rejected(
                    &command,
                    correlation_id,
                    engine.status().revision,
                    "revision",
                    MSG_REVISION,
                );
            }
            match engine.stop(
                &dto.owner,
                &dto.generation,
                dto.expected_revision,
                dto.confirm_restore,
            ) {
                Ok(view) => serialize_bounded(&Reply {
                    v: POC3_CONTRACT_VERSION,
                    correlation_id,
                    command,
                    outcome: "ok",
                    revision: view.revision,
                    intent: None,
                    noop: None,
                    completed: None,
                    status: None,
                    cleanup: Some(serde_json::to_value(&view).unwrap_or(serde_json::Value::Null)),
                    error: None,
                }),
                Err(error) => engine_rejected(engine, &command, correlation_id, error),
            }
        },
        engine,
    )
}

/// Strict versioned bounded JSON command route for the POC3 session engine.
///
/// Commands: `start`, `focus`, `move`, `complete`, `status`, `stop`. Always
/// returns a bounded JSON reply string; never panics on adapter input.
#[must_use]
pub fn evaluate_poc3_json(engine: &mut Poc3Engine, request_json: &str) -> String {
    if request_json.len() > POC3_MAX_REQUEST_BYTES {
        return rejected("unknown", String::new(), 0, "oversized", MSG_OVERSIZED);
    }
    let mut value: serde_json::Value = match serde_json::from_str(request_json) {
        Ok(value) => value,
        Err(error) => {
            return rejected(
                "unknown",
                String::new(),
                0,
                "request-malformed",
                classify_value_error(&error),
            );
        }
    };
    let Some(command) = value.get("command").and_then(serde_json::Value::as_str) else {
        return rejected(
            "unknown",
            opportunistic_correlation(&value),
            0,
            "command",
            MSG_UNKNOWN_COMMAND,
        );
    };
    let command = command.to_owned();
    // The discriminator is routing metadata, not a command field: strip it so
    // per-command `deny_unknown_fields` DTOs see only their own fields.
    if let Some(object) = value.as_object_mut() {
        object.remove("command");
    }
    match command.as_str() {
        "start" => handle_start(engine, value),
        "focus" => handle_focus(engine, value),
        "move" => handle_move(engine, value),
        "complete" => handle_complete(engine, value),
        "status" => handle_status(engine, value),
        "stop" => handle_stop(engine, value),
        _ => rejected(
            "unknown",
            opportunistic_correlation(&value),
            0,
            "command",
            MSG_UNKNOWN_COMMAND,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn engine() -> Poc3Engine {
        Poc3Engine::new()
    }

    fn start_request() -> Value {
        json!({
            "v": 3,
            "command": "start",
            "correlation_id": "corr-1",
            "owner": "owner-1",
            "generation": "gen-1",
            "scope": "scope-1",
            "usable": {"x": 0, "y": 0, "w": 900, "h": 600},
            "gap": 8,
            "windows": [
                {"id": "w-1", "scope": "scope-1", "rollback": "rb-1"},
                {"id": "w-2", "scope": "scope-1", "rollback": "rb-2"},
                {"id": "w-3", "scope": "scope-1", "rollback": "rb-3"}
            ],
            "session_rollback": "session-rb",
            "capabilities": {"untiled_asserted": true, "disposable": true, "restore_capable": true},
            "cleanup": "close-disposable"
        })
    }

    fn call(engine: &mut Poc3Engine, value: &Value) -> Value {
        let text = value.to_string();
        assert!(text.len() <= POC3_MAX_REQUEST_BYTES);
        let reply = evaluate_poc3_json(engine, &text);
        assert!(reply.len() <= POC3_MAX_REPLY_BYTES);
        serde_json::from_str(&reply).expect("reply is JSON")
    }

    fn complete_applied(engine: &mut Poc3Engine, revision: u64, corr: &str) -> Value {
        call(
            engine,
            &json!({
                "v": 3, "command": "complete", "correlation_id": corr,
                "owner": "owner-1", "generation": "gen-1",
                "expected_revision": revision, "outcome": "applied"
            }),
        )
    }

    #[test]
    fn start_intent_is_versioned_transactional_batch() {
        let mut engine = engine();
        let reply = call(&mut engine, &start_request());
        assert_eq!(reply["outcome"], "ok");
        assert_eq!(reply["v"], 3);
        assert_eq!(reply["command"], "start");
        assert_eq!(reply["correlation_id"], "corr-1");
        assert_eq!(reply["revision"], 0);
        let intent = &reply["intent"];
        assert_eq!(intent["base_revision"], 0);
        assert_eq!(intent["next_revision"], 1);
        assert_eq!(intent["atomic"], false);
        assert_eq!(intent["adapter_verification_required"], true);
        assert_eq!(intent["topology"], "H[w-1,V[w-2,w-3]]");
        assert_eq!(intent["focus"], "w-1");
        assert_eq!(intent["desired"].as_array().expect("desired").len(), 3);
        assert_eq!(intent["desired"][0]["id"], "w-1");
        assert_eq!(
            intent["desired"][0]["rect"],
            json!({"x": 0, "y": 0, "w": 446, "h": 600})
        );
        let preconditions = intent["preconditions"].as_array().expect("preconditions");
        assert!(
            preconditions
                .iter()
                .any(|v| v == "adapter-must-verify-postconditions")
        );
        assert_eq!(intent["capabilities"]["disposable"], true);
        assert_eq!(intent["rollback_required"]["retain_envelopes"], true);
    }

    #[test]
    fn dispatch_does_not_complete_until_report() {
        let mut engine = engine();
        call(&mut engine, &start_request());
        complete_applied(&mut engine, 0, "c-init");
        let focus = call(
            &mut engine,
            &json!({
                "v": 3, "command": "focus", "correlation_id": "c2",
                "owner": "owner-1", "generation": "gen-1",
                "expected_revision": 1, "direction": "right"
            }),
        );
        assert_eq!(focus["outcome"], "ok");
        assert_eq!(focus["intent"]["focus"], "w-2");
        let status = call(
            &mut engine,
            &json!({"v": 3, "command": "status", "correlation_id": "c3"}),
        );
        assert_eq!(status["status"]["revision"], 1);
        assert_eq!(status["status"]["focus"], "w-1");
        assert_eq!(status["status"]["pending"], true);
        let done = complete_applied(&mut engine, 1, "c4");
        assert_eq!(done["outcome"], "ok");
        assert_eq!(done["completed"]["result"], "applied");
        assert_eq!(done["completed"]["revision"], 2);
        let status = call(
            &mut engine,
            &json!({"v": 3, "command": "status", "correlation_id": "c5"}),
        );
        assert_eq!(status["status"]["focus"], "w-2");
        assert_eq!(status["status"]["pending"], false);
    }

    #[test]
    fn structural_move_changes_topology_and_geometry() {
        let mut engine = engine();
        call(&mut engine, &start_request());
        complete_applied(&mut engine, 0, "c-init");
        // Focus w-2 (right from w-1), complete it.
        call(
            &mut engine,
            &json!({
                "v": 3, "command": "focus", "correlation_id": "c-f",
                "owner": "owner-1", "generation": "gen-1",
                "expected_revision": 1, "direction": "right"
            }),
        );
        complete_applied(&mut engine, 1, "c-fc");
        let moved = call(
            &mut engine,
            &json!({
                "v": 3, "command": "move", "correlation_id": "c-m",
                "owner": "owner-1", "generation": "gen-1",
                "expected_revision": 2, "direction": "down"
            }),
        );
        assert_eq!(moved["outcome"], "ok");
        assert_eq!(moved["intent"]["operation"]["kind"], "swap");
        assert_eq!(moved["intent"]["topology"], "H[w-1,V[w-3,w-2]]");
        let w2 = moved["intent"]["desired"]
            .as_array()
            .expect("desired")
            .iter()
            .find(|w| w["id"] == "w-2")
            .expect("w-2 desired")
            .clone();
        assert_eq!(w2["rect"], json!({"x": 454, "y": 304, "w": 446, "h": 296}));
    }

    #[test]
    fn stale_revision_rejects_before_intent() {
        let mut engine = engine();
        call(&mut engine, &start_request());
        let reply = call(
            &mut engine,
            &json!({
                "v": 3, "command": "focus", "correlation_id": "stale",
                "owner": "owner-1", "generation": "gen-1",
                "expected_revision": 7, "direction": "right"
            }),
        );
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["error"]["kind"], "stale-revision");
        assert!(reply.get("intent").is_none());
    }

    #[test]
    fn partial_completion_fails_closed() {
        let mut engine = engine();
        call(&mut engine, &start_request());
        let reply = call(
            &mut engine,
            &json!({
                "v": 3, "command": "complete", "correlation_id": "c-div",
                "owner": "owner-1", "generation": "gen-1",
                "expected_revision": 0, "outcome": "divergent",
                "reason": "partial-application"
            }),
        );
        assert_eq!(reply["outcome"], "diverged");
        assert_eq!(reply["completed"]["result"], "diverged-recorded");
        let status = call(
            &mut engine,
            &json!({"v": 3, "command": "status", "correlation_id": "c-s"}),
        );
        assert_eq!(status["status"]["state"], "divergent");
        let again = call(
            &mut engine,
            &json!({
                "v": 3, "command": "focus", "correlation_id": "c-x",
                "owner": "owner-1", "generation": "gen-1",
                "expected_revision": 0, "direction": "right"
            }),
        );
        assert_eq!(again["error"]["kind"], "divergent-fail-closed");
    }

    #[test]
    fn stop_cleanup_uses_only_enrolled_ids() {
        let mut engine = engine();
        call(&mut engine, &start_request());
        complete_applied(&mut engine, 0, "c-init");
        let reply = call(
            &mut engine,
            &json!({
                "v": 3, "command": "stop", "correlation_id": "c-stop",
                "owner": "owner-1", "generation": "gen-1",
                "expected_revision": 1, "confirm_restore": true
            }),
        );
        assert_eq!(reply["outcome"], "ok");
        assert_eq!(reply["cleanup"]["action"], "restore-enrolled");
        let mut ids: Vec<String> = reply["cleanup"]["ids"]
            .as_array()
            .expect("ids")
            .iter()
            .map(|v| v.as_str().expect("id").to_owned())
            .collect();
        ids.sort();
        assert_eq!(ids, vec!["w-1", "w-2", "w-3"]);
        assert_eq!(reply["cleanup"]["envelopes"]["w-1"], "rb-1");
        let status = call(
            &mut engine,
            &json!({"v": 3, "command": "status", "correlation_id": "c-s"}),
        );
        assert_eq!(status["status"]["state"], "disabled");
    }

    #[test]
    fn stop_without_restore_confirms_disposable_closure() {
        let mut engine = engine();
        call(&mut engine, &start_request());
        complete_applied(&mut engine, 0, "c-init");
        let reply = call(
            &mut engine,
            &json!({
                "v": 3, "command": "stop", "correlation_id": "c-stop",
                "owner": "owner-1", "generation": "gen-1",
                "expected_revision": 1, "confirm_restore": false
            }),
        );
        assert_eq!(reply["cleanup"]["action"], "close-disposable");
        assert_eq!(reply["cleanup"]["ids"].as_array().expect("ids").len(), 3);
        assert!(reply["cleanup"].get("envelopes").is_none());
    }

    #[test]
    fn fresh_engine_carries_no_saved_state() {
        let mut engine = engine();
        let status = call(
            &mut engine,
            &json!({"v": 3, "command": "status", "correlation_id": "c-s"}),
        );
        assert_eq!(status["status"]["state"], "disabled");
        assert!(
            status["status"].get("enrolled").is_none(),
            "disabled status carries no enrollment"
        );
    }

    #[test]
    fn status_is_redacted_and_bounded() {
        let mut engine = engine();
        call(&mut engine, &start_request());
        let status = call(
            &mut engine,
            &json!({"v": 3, "command": "status", "correlation_id": "c-s"}),
        );
        let text = status.to_string();
        assert!(!text.contains("rb-1"));
        assert!(!text.contains("session-rb"));
        assert!(!text.contains("owner-1"));
    }

    #[test]
    fn contract_rejects_bad_envelopes_and_counts() {
        let mut engine = engine();
        // Four windows: fixed max 3 violated.
        let mut request = start_request();
        request["windows"]
            .as_array_mut()
            .expect("windows")
            .push(json!({
                "id": "w-4", "scope": "scope-1", "rollback": "rb-4"
            }));
        let reply = call(&mut engine, &request);
        assert_eq!(reply["error"]["kind"], "window-count");

        // Scope alias mismatch.
        let mut request = start_request();
        request["windows"][2]["scope"] = json!("scope-2");
        let reply = call(&mut engine, &request);
        assert_eq!(reply["error"]["kind"], "scope-mismatch");

        // Eligibility not asserted.
        let mut request = start_request();
        request["capabilities"]["untiled_asserted"] = json!(false);
        let reply = call(&mut engine, &request);
        assert_eq!(reply["error"]["kind"], "eligibility-unasserted");

        // Owner pinning enforced after start.
        call(&mut engine, &start_request());
        let reply = call(
            &mut engine,
            &json!({
                "v": 3, "command": "focus", "correlation_id": "c-o",
                "owner": "owner-2", "generation": "gen-1",
                "expected_revision": 0, "direction": "right"
            }),
        );
        assert_eq!(reply["error"]["kind"], "owner-mismatch");

        // Generation pinning enforced after start.
        let reply = call(
            &mut engine,
            &json!({
                "v": 3, "command": "focus", "correlation_id": "c-g",
                "owner": "owner-1", "generation": "gen-2",
                "expected_revision": 0, "direction": "right"
            }),
        );
        assert_eq!(reply["error"]["kind"], "generation-mismatch");
    }

    #[test]
    fn unknown_fields_and_values_are_denied_without_echo() {
        let mut engine = engine();
        let mut request = start_request();
        request["windows"][0]["caption"] = json!("SECRET-CAPTION");
        let reply = call(&mut engine, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["error"]["message"], MSG_UNKNOWN_FIELD);
        assert!(!reply.to_string().contains("SECRET-CAPTION"));

        call(&mut engine, &start_request());
        let reply = call(
            &mut engine,
            &json!({
                "v": 3, "command": "focus", "correlation_id": "c-d",
                "owner": "owner-1", "generation": "gen-1",
                "expected_revision": 0, "direction": "diagonal"
            }),
        );
        assert_eq!(reply["error"]["message"], MSG_UNKNOWN_VALUE);

        let reply = call(
            &mut engine,
            &json!({"v": 3, "command": "teleport", "correlation_id": "c-t"}),
        );
        assert_eq!(reply["error"]["message"], MSG_UNKNOWN_COMMAND);

        let mut request = start_request();
        request["v"] = json!(2);
        let reply = call(&mut engine, &request);
        assert_eq!(reply["error"]["message"], MSG_VERSION);
    }

    #[test]
    fn malformed_and_oversized_inputs_are_redacted() {
        let mut engine = engine();
        let reply: Value = serde_json::from_str(&evaluate_poc3_json(&mut engine, "{not json}"))
            .expect("reply is JSON");
        assert_eq!(reply["outcome"], "rejected");
        assert_eq!(reply["error"]["message"], MSG_MALFORMED);

        let big = "x".repeat(POC3_MAX_REQUEST_BYTES + 1);
        let reply: Value =
            serde_json::from_str(&evaluate_poc3_json(&mut engine, &big)).expect("reply is JSON");
        assert_eq!(reply["error"]["message"], MSG_OVERSIZED);

        // Error replies never echo opaque ids.
        let reply = call(
            &mut engine,
            &json!({
                "v": 3, "command": "focus", "correlation_id": "c-e",
                "owner": "SECRET-OWNER", "generation": "gen-1",
                "expected_revision": 0, "direction": "right"
            }),
        );
        assert!(!reply.to_string().contains("SECRET-OWNER"));
    }

    #[test]
    fn request_and_reply_stay_bounded() {
        let request = start_request().to_string();
        assert!(request.len() <= POC3_MAX_REQUEST_BYTES);
        let mut engine = engine();
        let reply = evaluate_poc3_json(&mut engine, &request);
        assert!(reply.len() <= POC3_MAX_REPLY_BYTES);
    }

    #[test]
    fn start_requires_literal_close_disposable_cleanup() {
        let mut engine1 = engine();
        // Absent cleanup: missing field is malformed, never reaches the engine.
        let mut request = start_request();
        request.as_object_mut().expect("object").remove("cleanup");
        let reply = call(&mut engine1, &request);
        assert_eq!(reply["outcome"], "rejected");
        assert!(engine1.status().enrolled.is_empty());

        // Any other value is rejected before native writes.
        for bad in [
            "",
            "restore",
            "close",
            "close_disposable",
            "CLOSE-DISPOSABLE",
        ] {
            let mut engine2 = engine();
            let mut request = start_request();
            request["cleanup"] = json!(bad);
            let reply = call(&mut engine2, &request);
            assert_eq!(reply["outcome"], "rejected", "cleanup {bad:?} must reject");
            assert_eq!(reply["error"]["kind"], "cleanup-model");
            assert!(engine2.status().enrolled.is_empty());
        }

        // The literal is carried into the intent and status.
        let mut engine3 = engine();
        let reply = call(&mut engine3, &start_request());
        assert_eq!(reply["outcome"], "ok");
        assert_eq!(reply["intent"]["cleanup_model"], "close-disposable");
        let status = call(
            &mut engine3,
            &json!({"v": 3, "command": "status", "correlation_id": "c-s"}),
        );
        assert_eq!(status["status"]["cleanup_model"], "close-disposable");
    }

    #[test]
    fn start_accepts_observed_internal_id_uuid_forms() {
        for id in [
            "{12345678-1234-1234-1234-1234567890ab}",
            "12345678-1234-1234-1234-1234567890ab",
            "w-1",
        ] {
            assert!(is_window_id(id), "must accept {id}");
        }
        for bad in [
            "{12345678-1234-1234-1234-1234567890ab",
            "12345678-1234-1234-1234-1234567890ab}",
            "{not-a-uuid}",
            "{12345678-1234-1234-1234-1234567890ab}}",
            "id-a;rm -rf /",
            "id a",
            "",
        ] {
            assert!(!is_window_id(bad), "must reject {bad:?}");
        }
        // Brace-form UUIDs travel the full start route.
        let mut engine = engine();
        let mut request = start_request();
        request["windows"] = json!([
            {"id": "{11111111-1111-1111-1111-111111111111}", "scope": "scope-1", "rollback": "rb-1"},
            {"id": "{22222222-2222-2222-2222-222222222222}", "scope": "scope-1", "rollback": "rb-2"},
            {"id": "{33333333-3333-3333-3333-333333333333}", "scope": "scope-1", "rollback": "rb-3"}
        ]);
        let reply = call(&mut engine, &request);
        assert_eq!(reply["outcome"], "ok");
    }

    #[test]
    fn stop_while_pending_reports_abandoned_close_only() {
        let mut engine = engine();
        call(&mut engine, &start_request());
        // Revision 0 still has the pending init intent: stop must not erase
        // it silently, even with restore confirmed.
        let reply = call(
            &mut engine,
            &json!({
                "v": 3, "command": "stop", "correlation_id": "c-stop",
                "owner": "owner-1", "generation": "gen-1",
                "expected_revision": 0, "confirm_restore": true
            }),
        );
        assert_eq!(reply["outcome"], "ok");
        assert_eq!(reply["cleanup"]["action"], "abandoned-pending-close");
        assert_eq!(reply["cleanup"]["abandoned_pending"], true);
        assert!(reply["cleanup"].get("envelopes").is_none());
        let status = call(
            &mut engine,
            &json!({"v": 3, "command": "status", "correlation_id": "c-s"}),
        );
        assert_eq!(status["status"]["state"], "disabled");
    }
}
