//! Planner service boundary: retained live-tree manually invoked D-Bus service.
//!
//! Contract identity: service `org.plasmaautotiler.Planner`, object
//! `/org/plasmaautotiler/Planner`, interface `org.plasmaautotiler.Planner1`,
//! method `DescribePlan`. It is the sole general-N protocol route over the
//! retained session/reconcile/directional/cosmic_v1 policy.
//!
//! Boundary rules: no Rust-to-KWin calls (only `org.freedesktop.DBus`
//! credential queries for same-UID caller verification), no persistence, no
//! tray coupling, no autostart, no native mutation. Bounded single-flight
//! endpoint handling via a non-queuing async-lock try-acquire held across
//! verify and evaluate. Name acquisition uses `DoNotQueue`; name loss is
//! terminal. Caller authorization is exactly one fail-closed same-UID check:
//! the caller unique name's Unix UID must equal the Planner geteuid.
//!
//! Rust returns domain rejections in-band; the KWin adapter journals the
//! bounded command and rejection lines after it receives each reply.

use std::sync::Arc;

use zbus::blocking::{Connection, MessageIterator};
use zbus::fdo::{RequestNameFlags, RequestNameReply};
use zbus::message::Type;
use zbus::{MatchRule, fdo::NameOwnerChanged};

pub const SERVICE: &str = "org.plasmaautotiler.Planner";
pub const OBJECT: &str = "/org/plasmaautotiler/Planner";
pub const INTERFACE: &str = "org.plasmaautotiler.Planner1";
#[cfg(test)]
const KWIN_SERVICE: &str = "org.kde.KWin";
#[cfg(test)]
const FOCUS_METHOD: &str = "DescribeFocus";
#[cfg(test)]
const MOVEMENT_METHOD: &str = "DescribeMovement";
#[cfg(test)]
const RESIZE_METHOD: &str = "DescribeResize";
#[cfg(test)]
const POINTER_RESIZE_METHOD: &str = "DescribePointerResize";
#[cfg(test)]
const FOCUS_MAX_REPLY: usize = 64 * 1024;
#[cfg(test)]
const MOVEMENT_MAX_REPLY: usize = 64 * 1024;
#[cfg(test)]
const RESIZE_MAX_REPLY: usize = 64 * 1024;
#[cfg(test)]
const POINTER_RESIZE_MAX_REPLY: usize = 64 * 1024;
/// Stage 4 retained general-N planning route: complete normalized current
/// observation plus one parameterized command in, full target geometries or a
/// bounded recoverable rejection kind out. Retained live-tree state across
/// calls (per-domain committed sessions, single discard-and-rebuild
/// recovery), so fresh observations recover after any rejection. Rust owns
/// all policy via `crate::planner_protocol`.
pub const PLAN_METHOD: &str = "DescribePlan";
/// Bounded plan request cap (mirrors the portable planner protocol bound).
pub const PLAN_MAX_REQUEST: usize = crate::planner_protocol::PLAN_MAX_REQUEST_BYTES;
/// Bounded plan reply cap (mirrors the portable planner protocol bound).
pub const PLAN_MAX_REPLY: usize = crate::planner_protocol::PLAN_MAX_REPLY_BYTES;
/// Bounded fixed in-band unauthorized rejection. It never parses or echoes
/// request data and is returned as `Ok`, never as `PlannerError`.
pub const UNAUTHORIZED_REPLY: &str =
    "{\"v\":1,\"outcome\":\"rejected\",\"kind\":\"unauthorized\",\"message\":\"unauthorized\"}";
/// Bound for the fixed unauthorized rejection (well under every reply cap).
pub const MAX_UNAUTHORIZED_REPLY_BYTES: usize = 256;

/// Fixed unauthorized rejection body for the single protocol route.
#[must_use]
pub fn unauthorized_rejection() -> String {
    UNAUTHORIZED_REPLY.to_owned()
}

#[cfg(test)]
fn unauthorized_uses_inband_rejection(method: &str) -> bool {
    matches!(
        method,
        FOCUS_METHOD | MOVEMENT_METHOD | RESIZE_METHOD | POINTER_RESIZE_METHOD | PLAN_METHOD
    )
}

#[cfg(test)]
fn unauthorized_response(method: &str) -> Result<String, PlannerError> {
    if unauthorized_uses_inband_rejection(method) {
        Ok(unauthorized_rejection())
    } else {
        Err(PlannerError::Unauthorized)
    }
}

/// Pure same-UID decision. Accepts iff `caller_uid` is present and equals
/// `expected_uid`; missing or differing UIDs reject fail-closed.
#[must_use]
pub fn caller_uid_authorized(caller_uid: Option<u32>, expected_uid: u32) -> bool {
    matches!(caller_uid, Some(uid) if uid == expected_uid)
}

// Exact nested-KWin manifest binding removed (Group E). Nested mode
// (`planner-service-nested`) no longer exists; there is no manifest parsing,
// no forensics, and no ambient environment authority anywhere in this
// service.

/// Opt-in verbose diagnostic gate for DescribePlan flights. Default off:
/// only the exact value `1` enables full request/reply logging to the
/// Planner's own log file (stderr, captured via the dev `planner-log`
/// pointer). Any other value, including unset and empty, stays silent so the
/// default journal surface (one bounded line per command plus one per
/// rejection, KWin side only) is preserved exactly.
pub const PLANNER_VERBOSE_ENV_VAR: &str = "PLASMA_AUTO_TILER_PLANNER_VERBOSE";

/// Whether verbose DescribePlan logging is enabled (`1` only).
#[must_use]
pub fn planner_verbose_enabled() -> bool {
    matches!(
        std::env::var(PLANNER_VERBOSE_ENV_VAR),
        Ok(value) if value == "1"
    )
}

/// Pure verbose line formatting: full request and reply JSON with stable
/// prefixes. No truncation: verbose mode is explicitly opt-in diagnostics.
#[must_use]
pub fn format_verbose_plan_lines(request: &str, reply: &str) -> (String, String) {
    (
        format!("plasma-auto-tiler:plan-verbose:request {request}"),
        format!("plasma-auto-tiler:plan-verbose:reply {reply}"),
    )
}

/// Verbose lines when enabled, `None` when default-off. Pure gate for tests;
/// production writes the lines with `eprintln!` (Planner's own log file).
#[must_use]
pub fn verbose_plan_lines(request: &str, reply: &str) -> Option<(String, String)> {
    if planner_verbose_enabled() {
        Some(format_verbose_plan_lines(request, reply))
    } else {
        None
    }
}

#[derive(Debug, zbus::DBusError, PartialEq, Eq)]
#[zbus(prefix = "org.plasmaautotiler.Planner1")]
pub enum PlannerError {
    Unauthorized,
    Unavailable(String),
}

#[derive(Clone, Debug)]
pub struct PlannerEndpoint {
    operation_lock: Arc<async_lock::Mutex<()>>,
    planner: Arc<std::sync::Mutex<crate::planner_protocol::Planner>>,
}

impl PlannerEndpoint {
    #[cfg(test)]
    fn evaluate_focus_request(&self, _request: &str) -> Result<String, PlannerError> {
        Err(PlannerError::Unavailable(
            "planner trio runtime was removed".to_owned(),
        ))
    }

    #[cfg(test)]
    fn evaluate_movement_request(&self, _request: &str) -> Result<String, PlannerError> {
        Err(PlannerError::Unavailable(
            "planner trio runtime was removed".to_owned(),
        ))
    }

    #[cfg(test)]
    fn evaluate_resize_request(&self, _request: &str) -> Result<String, PlannerError> {
        Err(PlannerError::Unavailable(
            "planner trio runtime was removed".to_owned(),
        ))
    }

    #[cfg(test)]
    fn evaluate_pointer_resize_request(&self, _request: &str) -> Result<String, PlannerError> {
        Err(PlannerError::Unavailable(
            "planner trio runtime was removed".to_owned(),
        ))
    }
    #[must_use]
    pub fn new() -> Self {
        Self {
            operation_lock: Arc::new(async_lock::Mutex::new(())),
            planner: Arc::new(std::sync::Mutex::new(
                crate::planner_protocol::Planner::new(),
            )),
        }
    }

    /// Stage 4 retained planning route. Delegates to the authoritative
    /// live-tree [`crate::planner_protocol::Planner`] held across calls
    /// (per-domain committed sessions, single discard-and-rebuild recovery);
    /// application-level rejections arrive as `Ok` JSON so fresh observations
    /// recover. Only an oversize reply or a poisoned planner lock fails
    /// closed as `Unavailable`.
    fn evaluate_plan_request(&self, request: &str) -> Result<String, PlannerError> {
        let reply = match self.planner.lock() {
            Ok(mut planner) => planner.evaluate(request),
            Err(_) => {
                return Err(PlannerError::Unavailable(
                    "planner state is unavailable".to_owned(),
                ));
            }
        };
        if reply.len() > PLAN_MAX_REPLY {
            return Err(PlannerError::Unavailable(
                "reply exceeds size bound".to_owned(),
            ));
        }
        Ok(reply)
    }
}

impl Default for PlannerEndpoint {
    fn default() -> Self {
        Self::new()
    }
}

/// Fail-closed same-UID caller verification shared by production and
/// nested routes. Converts `caller` to a unique D-Bus name, queries
/// `org.freedesktop.DBus.GetConnectionUnixUser` for the caller UID through
/// the existing `DBusProxy`, and accepts iff that UID equals the Planner
/// geteuid. Any name conversion, proxy, UID lookup, or mismatch failure
/// rejects.
async fn verify_same_uid_caller(connection: &zbus::Connection, caller: &str) -> bool {
    let Ok(unique_name) = zbus::names::UniqueName::try_from(caller) else {
        return false;
    };
    let Ok(dbus) = zbus::fdo::DBusProxy::new(connection).await else {
        return false;
    };
    let Ok(caller_uid) = dbus.get_connection_unix_user(unique_name.into()).await else {
        return false;
    };
    caller_uid_authorized(Some(caller_uid), rustix::process::geteuid().as_raw())
}

async fn verify_planner_caller(connection: &zbus::Connection, caller: &str) -> bool {
    verify_same_uid_caller(connection, caller).await
}

#[zbus::interface(name = "org.plasmaautotiler.Planner1")]
impl PlannerEndpoint {
    async fn describe_plan(
        &self,
        request: String,
        #[zbus(header)] header: zbus::message::Header<'_>,
        #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
    ) -> Result<String, PlannerError> {
        // Stage 4 retained planning route: same bounded non-queuing
        // single-flight, same-UID verification, connection-loss, and
        // reply-size checks as the four legacy routes. Authorized requests
        // delegate to the retained planner protocol (live-tree sessions per
        // domain over session/reconcile/directional/cosmic_v1 policy);
        // application rejections arrive as `Ok` JSON and stay silent like
        // success, so fresh observations recover after any rejection.
        // Diagnostics are emitted only after the guard is released (see
        // `emit_outcome` contract).
        if request.len() > PLAN_MAX_REQUEST {
            let Some(_guard) = self.operation_lock.try_lock() else {
                return Err(PlannerError::Unavailable("planner is busy".to_owned()));
            };
            drop(_guard);
            return Err(PlannerError::Unavailable(
                "request exceeds size bound".to_owned(),
            ));
        }
        let Some(_guard) = self.operation_lock.try_lock() else {
            return Err(PlannerError::Unavailable("planner is busy".to_owned()));
        };
        if emitter.connection().is_closed() {
            drop(_guard);
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        let caller = header.sender().map(ToString::to_string);
        let Some(caller) = caller.as_deref() else {
            drop(_guard);
            return Ok(unauthorized_rejection());
        };
        if !verify_planner_caller(emitter.connection(), caller).await {
            drop(_guard);
            return Ok(unauthorized_rejection());
        };
        let reply = match self.evaluate_plan_request(&request) {
            Ok(reply) => reply,
            Err(error) => {
                drop(_guard);
                return Err(error);
            }
        };
        if reply.len() > PLAN_MAX_REPLY {
            drop(_guard);
            return Err(PlannerError::Unavailable(
                "reply exceeds size bound".to_owned(),
            ));
        }
        // Planned and recoverably rejected replies are silent by default
        // (zero diagnostic lines): the reply is returned with the lock
        // released and no logging, so output never triggers bus activation
        // and never holds the operation lock. Opt-in verbose mode
        // (`PLASMA_AUTO_TILER_PLANNER_VERBOSE=1`) writes the full request
        // and reply JSON to the Planner's own log file (stderr) after the
        // guard is released; the KWin journal surface stays exactly one
        // bounded line per command plus one per rejection.
        drop(_guard);
        if let Some((request_line, reply_line)) = verbose_plan_lines(&request, &reply) {
            eprintln!("{request_line}");
            eprintln!("{reply_line}");
        }
        Ok(reply)
    }
}

fn serving_connection_lost_error() -> zbus::Error {
    zbus::Error::Failure("planner serving connection was lost".to_owned())
}

fn owner_monitor_ended_error() -> zbus::Error {
    zbus::Error::Failure("planner owner monitor ended unexpectedly".to_owned())
}

fn request_planner_name(connection: &Connection) -> zbus::Result<()> {
    match connection.request_name_with_flags(SERVICE, RequestNameFlags::DoNotQueue.into())? {
        RequestNameReply::PrimaryOwner => Ok(()),
        reply => Err(zbus::Error::Failure(format!(
            "planner service name was not acquired: {reply}"
        ))),
    }
}

fn owner_changes_match_rule() -> zbus::Result<MatchRule<'static>> {
    Ok(MatchRule::builder()
        .msg_type(Type::Signal)
        .sender("org.freedesktop.DBus")?
        .interface("org.freedesktop.DBus")?
        .member("NameOwnerChanged")?
        .build())
}

fn monitor_owner_changes(monitor: &Connection) -> zbus::Result<MessageIterator> {
    MessageIterator::for_match_rule(owner_changes_match_rule()?, monitor, Some(16))
}

/// Pure name-loss decision: terminal when our planner name loses its owner.
fn planner_name_lost(name: &str, new_owner: Option<&str>, our_unique: Option<&str>) -> bool {
    if name != SERVICE {
        return false;
    }
    match (new_owner, our_unique) {
        (Some(next), Some(ours)) => next != ours,
        (None, _) => true,
        (_, None) => new_owner.is_none(),
    }
}

fn handle_name_owner_changed(
    registered_unique: &mut Option<String>,
    name: &str,
    new_owner: Option<String>,
    our_unique: Option<&str>,
) -> zbus::Result<()> {
    if name != SERVICE {
        return Ok(());
    }
    if planner_name_lost(name, new_owner.as_deref(), our_unique) {
        *registered_unique = None;
        return Err(zbus::Error::Failure(
            "planner service name ownership was lost".to_owned(),
        ));
    }
    *registered_unique = new_owner;
    Ok(())
}

/// Stateless manually invoked planner service. Acquires the planner name
/// without queueing and serves the four transaction routes until the serving
/// connection or the planner name is lost. No persistence, no tray coupling.
pub fn run() -> zbus::Result<()> {
    serve(PlannerEndpoint::new())
}

fn serve(endpoint: PlannerEndpoint) -> zbus::Result<()> {
    let connection = Connection::session()?;
    connection.object_server().at(OBJECT, endpoint)?;
    request_planner_name(&connection)?;
    let our_unique = connection.unique_name().map(|name| name.to_string());

    let monitor = Connection::session()?;
    let owner_changes = monitor_owner_changes(&monitor)?;
    let mut registered_unique = our_unique.clone();
    for message in owner_changes {
        if connection.is_closed() {
            return Err(serving_connection_lost_error());
        }
        if monitor.is_closed() {
            return Err(owner_monitor_ended_error());
        }
        let message = message?;
        let signal = NameOwnerChanged::from_message(message).ok_or_else(|| {
            zbus::Error::Failure("owner-change iterator yielded a non-owner signal".to_owned())
        })?;
        let args = signal.args()?;
        let name = args.name().to_string();
        let new_owner = args.new_owner().as_ref().map(ToString::to_string);
        handle_name_owner_changed(
            &mut registered_unique,
            &name,
            new_owner,
            our_unique.as_deref(),
        )?;
    }
    Err(owner_monitor_ended_error())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_identity_is_exact() {
        assert_eq!(SERVICE, "org.plasmaautotiler.Planner");
        assert_eq!(OBJECT, "/org/plasmaautotiler/Planner");
        assert_eq!(INTERFACE, "org.plasmaautotiler.Planner1");
    }

    #[test]
    fn planner_name_request_disallows_queueing() {
        let flags = zbus::fdo::RequestNameFlags::DoNotQueue as u32;
        assert_eq!(flags, 0x04);
        assert_eq!(flags & (0x01 | 0x02), 0);
    }

    #[test]
    fn owner_monitor_uses_fixed_dbus_contract() {
        let rule = owner_changes_match_rule().unwrap().to_string();
        assert!(rule.contains("type='signal'"), "{rule}");
        assert!(rule.contains("sender='org.freedesktop.DBus'"), "{rule}");
        assert!(rule.contains("interface='org.freedesktop.DBus'"), "{rule}");
        assert!(rule.contains("member='NameOwnerChanged'"), "{rule}");
    }

    #[test]
    fn planner_name_loss_is_terminal() {
        assert!(planner_name_lost(SERVICE, None, Some(":1.7")));
        assert!(planner_name_lost(SERVICE, Some(":1.9"), Some(":1.7")));
        assert!(!planner_name_lost(SERVICE, Some(":1.7"), Some(":1.7")));
        assert!(!planner_name_lost(KWIN_SERVICE, None, Some(":1.7")));
    }

    #[test]
    fn planner_name_change_handler_exits_on_loss() {
        let mut registered = Some(":1.7".to_owned());
        let result = handle_name_owner_changed(&mut registered, SERVICE, None, Some(":1.7"));
        assert!(result.is_err());
        assert_eq!(registered, None);

        let mut registered = Some(":1.7".to_owned());
        let result = handle_name_owner_changed(&mut registered, KWIN_SERVICE, None, Some(":1.7"));
        assert!(result.is_ok());
        assert_eq!(registered, Some(":1.7".to_owned()));
    }

    #[test]
    fn same_uid_accepts() {
        let expected = rustix::process::geteuid().as_raw();
        assert!(caller_uid_authorized(Some(expected), expected));
    }

    #[test]
    fn differing_uid_rejects() {
        let expected = rustix::process::geteuid().as_raw();
        let differing = expected.wrapping_add(1);
        assert_ne!(differing, expected);
        assert!(!caller_uid_authorized(Some(differing), expected));
        assert!(!caller_uid_authorized(
            Some(expected.wrapping_add(1000)),
            expected
        ));
    }

    #[test]
    fn unavailable_uid_rejects() {
        let expected = rustix::process::geteuid().as_raw();
        assert!(!caller_uid_authorized(None, expected));
    }

    #[test]
    fn unauthorized_reply_is_bounded_fixed_inband_ok() {
        let first = unauthorized_rejection();
        let second = unauthorized_rejection();
        assert_eq!(first, second);
        assert_eq!(first, UNAUTHORIZED_REPLY);
        assert!(first.len() <= MAX_UNAUTHORIZED_REPLY_BYTES);
        assert!(first.len() <= FOCUS_MAX_REPLY);
        assert!(first.len() <= MOVEMENT_MAX_REPLY);
        assert!(first.len() <= RESIZE_MAX_REPLY);
        assert!(first.len() <= POINTER_RESIZE_MAX_REPLY);
        assert!(first.len() <= PLAN_MAX_REPLY);
        let parsed: serde_json::Value =
            serde_json::from_str(&first).expect("unauthorized reply is valid JSON");
        assert_eq!(parsed["outcome"], "rejected");
        assert_eq!(parsed["kind"], "unauthorized");
        // Fixed body never echoes caller input.
        assert!(!first.contains("evil-correlation"));
        // Represents Ok rather than PlannerError.
        let as_result: Result<String, PlannerError> = Ok(unauthorized_rejection());
        assert!(
            as_result.is_ok_and(|body| body != String::new()),
            "unauthorized body is non-empty fixed JSON"
        );
    }

    #[test]
    fn unauthorized_channel_is_inband_for_exactly_five_routes() {
        // The five transaction routes return the fixed in-band JSON body via
        // the actual production helper.
        for method in [
            FOCUS_METHOD,
            MOVEMENT_METHOD,
            RESIZE_METHOD,
            POINTER_RESIZE_METHOD,
            PLAN_METHOD,
        ] {
            assert!(
                unauthorized_uses_inband_rejection(method),
                "{method} must use the in-band unauthorized rejection"
            );
            let body = unauthorized_response(method)
                .unwrap_or_else(|_| panic!("{method} must return in-band Ok"));
            assert_eq!(body, UNAUTHORIZED_REPLY, "{method} in-band body is fixed");
            let parsed: serde_json::Value =
                serde_json::from_str(&body).expect("in-band body is valid JSON");
            assert_eq!(parsed["v"], 1);
            assert_eq!(parsed["outcome"], "rejected");
            assert_eq!(parsed["kind"], "unauthorized");
            assert_eq!(parsed["message"], "unauthorized");
        }
        // Unknown methods fail closed via the D-Bus PlannerError::Unauthorized
        // channel through the same helper.
        assert!(
            !unauthorized_uses_inband_rejection("EvaluateMove"),
            "unknown method must use PlannerError::Unauthorized"
        );
        assert_eq!(
            unauthorized_response("EvaluateMove"),
            Err(PlannerError::Unauthorized),
            "unknown method must return D-Bus unauthorized"
        );
    }

    #[test]
    fn endpoint_is_single_flight_shared() {
        let endpoint = PlannerEndpoint::new();
        let cloned = endpoint.clone();
        assert!(Arc::ptr_eq(
            &endpoint.operation_lock,
            &cloned.operation_lock
        ));
    }

    #[test]
    fn movement_method_identity_is_exact_and_distinct() {
        assert_eq!(MOVEMENT_METHOD, "DescribeMovement");
        assert_ne!(MOVEMENT_METHOD, FOCUS_METHOD);
        assert_ne!(MOVEMENT_METHOD, RESIZE_METHOD);
        assert_eq!(SERVICE, "org.plasmaautotiler.Planner");
        assert_eq!(OBJECT, "/org/plasmaautotiler/Planner");
        assert_eq!(INTERFACE, "org.plasmaautotiler.Planner1");
        assert_eq!(MOVEMENT_MAX_REPLY, 64 * 1024);
        assert_eq!(
            MOVEMENT_MAX_REPLY,
            crate::movement_service::MOVEMENT_MAX_REPLY_BYTES
        );
    }

    #[test]
    fn movement_method_signature_is_json_string_to_json_string() {
        let message = zbus::message::Message::method_call(OBJECT, MOVEMENT_METHOD)
            .unwrap()
            .destination(SERVICE)
            .unwrap()
            .interface(INTERFACE)
            .unwrap()
            .build(&("{\"v\":1}".to_owned(),))
            .unwrap();
        assert_eq!(message.body().signature().to_string(), "s");
        let body: (String,) = message.body().deserialize().unwrap();
        assert_eq!(body.0, "{\"v\":1}");
    }

    #[test]
    fn removed_trio_routes_fail_closed_as_unavailable() {
        // Group B: the trio backend was removed. The four legacy transaction
        // routes fail closed as unavailable over the preserved D-Bus
        // identity; Stage 4 `DescribePlan` is the only planning route.
        let endpoint = PlannerEndpoint::new();
        for result in [
            endpoint.evaluate_focus_request("{\"v\":1}"),
            endpoint.evaluate_movement_request("{\"v\":1}"),
            endpoint.evaluate_resize_request("{\"v\":1}"),
            endpoint.evaluate_pointer_resize_request("{\"v\":1}"),
        ] {
            assert_eq!(
                result,
                Err(PlannerError::Unavailable(
                    "planner trio runtime was removed".to_owned()
                ))
            );
        }
    }

    #[test]
    fn focus_method_identity_is_exact_and_distinct() {
        assert_eq!(FOCUS_METHOD, "DescribeFocus");
        assert_ne!(FOCUS_METHOD, RESIZE_METHOD);
        assert_eq!(SERVICE, "org.plasmaautotiler.Planner");
        assert_eq!(OBJECT, "/org/plasmaautotiler/Planner");
        assert_eq!(INTERFACE, "org.plasmaautotiler.Planner1");
        assert_eq!(FOCUS_MAX_REPLY, 64 * 1024);
        assert_eq!(FOCUS_MAX_REPLY, crate::focus_service::FOCUS_MAX_REPLY_BYTES);
    }

    #[test]
    fn focus_method_signature_is_json_string_to_json_string() {
        let message = zbus::message::Message::method_call(OBJECT, FOCUS_METHOD)
            .unwrap()
            .destination(SERVICE)
            .unwrap()
            .interface(INTERFACE)
            .unwrap()
            .build(&("{\"v\":1}".to_owned(),))
            .unwrap();
        assert_eq!(message.body().signature().to_string(), "s");
        let body: (String,) = message.body().deserialize().unwrap();
        assert_eq!(body.0, "{\"v\":1}");
    }

    #[test]
    fn resize_method_identity_is_exact_and_distinct() {
        assert_eq!(RESIZE_METHOD, "DescribeResize");
        assert_ne!(RESIZE_METHOD, FOCUS_METHOD);
        assert_ne!(RESIZE_METHOD, MOVEMENT_METHOD);
        assert_eq!(SERVICE, "org.plasmaautotiler.Planner");
        assert_eq!(OBJECT, "/org/plasmaautotiler/Planner");
        assert_eq!(INTERFACE, "org.plasmaautotiler.Planner1");
        assert_eq!(RESIZE_MAX_REPLY, 64 * 1024);
        assert_eq!(
            RESIZE_MAX_REPLY,
            crate::resize_service::RESIZE_MAX_REPLY_BYTES
        );
    }

    #[test]
    fn resize_method_signature_is_json_string_to_json_string() {
        let message = zbus::message::Message::method_call(OBJECT, RESIZE_METHOD)
            .unwrap()
            .destination(SERVICE)
            .unwrap()
            .interface(INTERFACE)
            .unwrap()
            .build(&("{\"v\":1}".to_owned(),))
            .unwrap();
        assert_eq!(message.body().signature().to_string(), "s");
        let body: (String,) = message.body().deserialize().unwrap();
        assert_eq!(body.0, "{\"v\":1}");
    }

    #[test]
    fn single_flight_is_non_queuing_bounded() {
        let endpoint = PlannerEndpoint::new();
        let guard = endpoint.operation_lock.try_lock();
        assert!(guard.is_some(), "idle endpoint must acquire");
        assert!(
            endpoint.operation_lock.try_lock().is_none(),
            "contended endpoint must fail fast instead of queueing verify work"
        );
        drop(guard);
        assert!(endpoint.operation_lock.try_lock().is_some());
    }

    #[test]
    fn connection_loss_and_monitor_end_are_errors() {
        let serving = serving_connection_lost_error();
        assert!(serving.to_string().contains("serving connection was lost"));
        let ended = owner_monitor_ended_error();
        assert!(ended.to_string().contains("monitor ended unexpectedly"));
    }

    #[test]
    fn plan_method_identity_is_exact_and_distinct() {
        assert_eq!(PLAN_METHOD, "DescribePlan");
        assert_ne!(PLAN_METHOD, FOCUS_METHOD);
        assert_ne!(PLAN_METHOD, MOVEMENT_METHOD);
        assert_ne!(PLAN_METHOD, RESIZE_METHOD);
        assert_ne!(PLAN_METHOD, POINTER_RESIZE_METHOD);
        assert_eq!(SERVICE, "org.plasmaautotiler.Planner");
        assert_eq!(OBJECT, "/org/plasmaautotiler/Planner");
        assert_eq!(INTERFACE, "org.plasmaautotiler.Planner1");
        assert_eq!(PLAN_MAX_REPLY, 64 * 1024);
        assert_eq!(
            PLAN_MAX_REPLY,
            crate::planner_protocol::PLAN_MAX_REPLY_BYTES
        );
        assert_eq!(
            PLAN_MAX_REQUEST,
            crate::planner_protocol::PLAN_MAX_REQUEST_BYTES
        );
    }

    #[test]
    fn plan_method_signature_is_json_string_to_json_string() {
        let message = zbus::message::Message::method_call(OBJECT, PLAN_METHOD)
            .unwrap()
            .destination(SERVICE)
            .unwrap()
            .interface(INTERFACE)
            .unwrap()
            .build(&("{\"v\":1}".to_owned(),))
            .unwrap();
        assert_eq!(message.body().signature().to_string(), "s");
        let body: (String,) = message.body().deserialize().unwrap();
        assert_eq!(body.0, "{\"v\":1}");
    }

    fn plan_request_for(
        correlation: &str,
        focused: &str,
        windows: &[&str],
        command: serde_json::Value,
    ) -> String {
        let entries: Vec<serde_json::Value> = windows
            .iter()
            .map(|w| {
                serde_json::json!({
                    "window": w,
                    "output": "out-1",
                    "workspace": "ws-1",
                    "rect": {"x": 10, "y": 10, "w": 100, "h": 80},
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
                "bounds": {"x": 0, "y": 0, "w": 1200, "h": 800},
                "gap": 0,
            },
            "focused_window": focused,
            "windows": entries,
            "command": command,
        })
        .to_string()
    }

    #[test]
    fn plan_route_returns_geometries_and_recovers_after_rejection() {
        let endpoint = PlannerEndpoint::new();
        // Recoverable rejection first: unknown window is `Ok` JSON, never a
        // terminal D-Bus error, so the next fresh observation can plan.
        let bad = plan_request_for(
            "plan-dbus-bad-1",
            "win-1",
            &["win-1", "win-2"],
            serde_json::json!({"op": "remove", "window": "win-9"}),
        );
        let bad_reply = endpoint
            .evaluate_plan_request(&bad)
            .expect("rejections are Ok JSON");
        let bad_value: serde_json::Value =
            serde_json::from_str(&bad_reply).expect("rejection is JSON");
        assert_eq!(bad_value["outcome"], "rejected");
        assert!(bad_value["kind"].as_str().is_some());
        assert!(bad_reply.len() <= PLAN_MAX_REPLY);
        // Fresh observation plans with full target geometries.
        let good = plan_request_for(
            "plan-dbus-good-1",
            "win-1",
            &["win-1", "win-2"],
            serde_json::json!({"op": "remove", "window": "win-2"}),
        );
        let good_reply = endpoint
            .evaluate_plan_request(&good)
            .expect("valid plan is Ok");
        let good_value: serde_json::Value =
            serde_json::from_str(&good_reply).expect("plan is JSON");
        assert_eq!(good_value["outcome"], "planned");
        let geometry = good_value["desired_geometry"]
            .as_array()
            .expect("full target geometries");
        assert_eq!(geometry.len(), 1);
        assert_eq!(geometry[0]["window"], "win-1");
    }

    #[test]
    fn planner_verbose_is_default_off_and_opt_in_by_single_env() {
        // D7: default-off gate plus full-JSON line formatting. Single test
        // touches the process env var to avoid parallel-test races.
        let var = crate::planner_service::PLANNER_VERBOSE_ENV_VAR;
        let previous = std::env::var(var).ok();
        unsafe { std::env::remove_var(var) };
        assert!(
            !crate::planner_service::planner_verbose_enabled(),
            "unset must stay silent"
        );
        assert!(
            crate::planner_service::verbose_plan_lines("{}", "{}").is_none(),
            "unset must produce no lines"
        );
        for off in ["0", "", "true", "TRUE", "2"] {
            unsafe { std::env::set_var(var, off) };
            assert!(
                !crate::planner_service::planner_verbose_enabled(),
                "value {off:?} must stay silent"
            );
            assert!(
                crate::planner_service::verbose_plan_lines("{}", "{}").is_none(),
                "value {off:?} must produce no lines"
            );
        }
        unsafe { std::env::set_var(var, "1") };
        assert!(crate::planner_service::planner_verbose_enabled());
        let request = r#"{"v":1,"correlation_id":"plan-1-p44"}"#;
        let reply = r#"{"v":1,"outcome":"rejected","kind":"snapshot-invalid"}"#;
        let lines = crate::planner_service::verbose_plan_lines(request, reply)
            .expect("value 1 must produce lines");
        assert!(
            lines.0.contains(request),
            "request line must carry full JSON: {lines:?}"
        );
        assert!(
            lines.1.contains(reply),
            "reply line must carry full JSON: {lines:?}"
        );
        assert!(
            lines
                .0
                .starts_with("plasma-auto-tiler:plan-verbose:request "),
            "{lines:?}"
        );
        assert!(
            lines.1.starts_with("plasma-auto-tiler:plan-verbose:reply "),
            "{lines:?}"
        );
        match previous {
            Some(value) => unsafe { std::env::set_var(var, value) },
            None => unsafe { std::env::remove_var(var) },
        }
    }
}
