//! Planner service boundary: stateless manually invoked D-Bus service.
//!
//! Contract identity: service `org.plasmaautotiler.Planner`, object
//! `/org/plasmaautotiler/Planner`, interface `org.plasmaautotiler.Planner1`,
//! methods `DescribeFocus`, `DescribeMovement`, `DescribeResize`, and
//! `DescribePointerResize`. Group B removal: the exact-three trio runtime
//! was removed without a general-N replacement, so the four transaction
//! routes keep their D-Bus identity but fail closed as unavailable rather
//! than faking plans. Group E: nested-manifest parsing/forensics,
//! route-diag, build-identity, and KWin direct-parent identity were removed.
//! No general-N planning is implemented here.
//!
//! Boundary rules: no Rust-to-KWin calls (only `org.freedesktop.DBus`
//! credential queries for same-UID caller verification), no persistence, no
//! tray coupling, no autostart, no native mutation. Bounded single-flight
//! endpoint handling via a non-queuing async-lock try-acquire held across
//! verify and evaluate. Name acquisition uses `DoNotQueue`; name loss is
//! terminal. Caller authorization is exactly one fail-closed same-UID check:
//! the caller unique name's Unix UID must equal the Planner geteuid.
//!
//! Minimal bounded diagnostic: Rust owns the `Rejected { kind }` outcome
//! (the fixed in-band `kind=unauthorized` body below); the KWin adapters map
//! transport errors to their own reject tokens. At most one bounded
//! `plasma-auto-tiler:planner` stderr line per command, carrying only the
//! closed route/kind vocabulary below.

use std::sync::Arc;

use zbus::blocking::{Connection, MessageIterator};
use zbus::fdo::{RequestNameFlags, RequestNameReply};
use zbus::message::Type;
use zbus::{MatchRule, fdo::NameOwnerChanged};

use crate::focus_service::FOCUS_MAX_REPLY_BYTES;
use crate::movement_service::MOVEMENT_MAX_REPLY_BYTES;
use crate::resize_service::RESIZE_MAX_REPLY_BYTES;

pub const SERVICE: &str = "org.plasmaautotiler.Planner";
pub const OBJECT: &str = "/org/plasmaautotiler/Planner";
pub const INTERFACE: &str = "org.plasmaautotiler.Planner1";
pub const FOCUS_METHOD: &str = "DescribeFocus";
/// Bounded focus reply cap, mirroring the portable focus service bound.
pub const FOCUS_MAX_REPLY: usize = FOCUS_MAX_REPLY_BYTES;
pub const MOVEMENT_METHOD: &str = "DescribeMovement";
/// Bounded movement reply cap, mirroring the portable movement service bound.
pub const MOVEMENT_MAX_REPLY: usize = MOVEMENT_MAX_REPLY_BYTES;
pub const RESIZE_METHOD: &str = "DescribeResize";
/// Bounded resize reply cap, mirroring the portable resize service bound.
pub const RESIZE_MAX_REPLY: usize = RESIZE_MAX_REPLY_BYTES;
pub const POINTER_RESIZE_METHOD: &str = "DescribePointerResize";
/// Bounded pointer-resize reply cap (same portable resize service bound).
pub const POINTER_RESIZE_MAX_REPLY: usize = RESIZE_MAX_REPLY_BYTES;
pub const KWIN_SERVICE: &str = "org.kde.KWin";

/// Bounded fixed in-band unauthorized rejection for exactly four routes:
/// `DescribeFocus`, `DescribeMovement`, `DescribeResize`, and
/// `DescribePointerResize`. Never parses or echoes request data; those four
/// routes return exactly this body as `Ok`, never as `PlannerError`.
pub const UNAUTHORIZED_REPLY: &str =
    "{\"v\":1,\"outcome\":\"rejected\",\"kind\":\"unauthorized\",\"message\":\"unauthorized\"}";
/// Bound for the fixed unauthorized rejection (well under every reply cap).
pub const MAX_UNAUTHORIZED_REPLY_BYTES: usize = 256;

/// Fixed unauthorized rejection body for the four in-band routes.
#[must_use]
pub fn unauthorized_rejection() -> String {
    UNAUTHORIZED_REPLY.to_owned()
}

/// Pure unauthorized-channel decision. Returns true iff `method` is one of
/// the exactly four in-band routes (`DescribeFocus`, `DescribeMovement`,
/// `DescribeResize`, `DescribePointerResize`).
#[must_use]
pub fn unauthorized_uses_inband_rejection(method: &str) -> bool {
    matches!(
        method,
        FOCUS_METHOD | MOVEMENT_METHOD | RESIZE_METHOD | POINTER_RESIZE_METHOD
    )
}

/// Production unauthorized-channel helper. Takes the route method identifier
/// and returns exactly what the authorization-failure branch must return:
/// the fixed in-band unauthorized JSON as `Ok` for exactly `DescribeFocus`,
/// `DescribeMovement`, `DescribeResize`, `DescribePointerResize` (and
/// fail-closed D-Bus `Err(PlannerError::Unauthorized)` for any other method).
pub fn unauthorized_response(method: &str) -> Result<String, PlannerError> {
    match method {
        FOCUS_METHOD | MOVEMENT_METHOD | RESIZE_METHOD | POINTER_RESIZE_METHOD => {
            Ok(unauthorized_rejection())
        }
        _ => Err(PlannerError::Unauthorized),
    }
}

/// Pure same-UID decision. Accepts iff `caller_uid` is present and equals
/// `expected_uid`; missing or differing UIDs reject fail-closed.
#[must_use]
pub fn caller_uid_authorized(caller_uid: Option<u32>, expected_uid: u32) -> bool {
    matches!(caller_uid, Some(uid) if uid == expected_uid)
}

/// Exact nested-KWin manifest binding removed (Group E). Nested mode
/// (`planner-service-nested`) no longer exists; there is no manifest parsing,
/// no forensics, and no ambient environment authority anywhere in this
/// service.

#[derive(Debug, zbus::DBusError, PartialEq, Eq)]
#[zbus(prefix = "org.plasmaautotiler.Planner1")]
pub enum PlannerError {
    Unauthorized,
    Unavailable(String),
}

#[derive(Clone, Debug)]
pub struct PlannerEndpoint {
    operation_lock: Arc<async_lock::Mutex<()>>,
    // Group B: the exact-three trio service was removed. No shared session
    // is owned here; the four D-Bus routes fail closed as unavailable until
    // a full general-N protocol lands. No generic IPC is introduced.
}

impl PlannerEndpoint {
    #[must_use]
    pub fn new() -> Self {
        Self {
            operation_lock: Arc::new(async_lock::Mutex::new(())),
        }
    }

    /// Removed trio backend: focus has no planner session to transact over.
    /// Callers hold the single-flight guard and pass caller verification;
    /// this returns fail-closed unavailable without touching any session.
    fn evaluate_focus_request(&self, _request: &str) -> Result<String, PlannerError> {
        Err(PlannerError::Unavailable(
            "planner trio runtime was removed".to_owned(),
        ))
    }

    /// Removed trio backend: movement has no planner session to transact over.
    /// Same single-flight contract as the focus route; always unavailable.
    fn evaluate_movement_request(&self, _request: &str) -> Result<String, PlannerError> {
        Err(PlannerError::Unavailable(
            "planner trio runtime was removed".to_owned(),
        ))
    }

    /// Removed trio backend: keyboard resize has no planner session.
    /// Same single-flight contract; always unavailable.
    fn evaluate_resize_request(&self, _request: &str) -> Result<String, PlannerError> {
        Err(PlannerError::Unavailable(
            "planner trio runtime was removed".to_owned(),
        ))
    }

    /// Removed trio backend: pointer resize has no planner session.
    /// Same single-flight contract as the keyboard route; always unavailable.
    fn evaluate_pointer_resize_request(&self, _request: &str) -> Result<String, PlannerError> {
        Err(PlannerError::Unavailable(
            "planner trio runtime was removed".to_owned(),
        ))
    }
}

impl Default for PlannerEndpoint {
    fn default() -> Self {
        Self::new()
    }
}

/// Minimal bounded outcome diagnostic: at most one stderr line per command,
/// emitted only after the single-flight guard is released. Closed route/kind
/// vocabulary only; never request bytes, bus names, or PIDs. Pure formatting
/// plus eprintln; never alters wire behavior.
const DIAG_PREFIX: &str = "plasma-auto-tiler:planner";

fn diag_route_valid(route: &str) -> bool {
    matches!(route, "focus" | "movement" | "resize" | "pointer")
}

fn diag_kind_valid(kind: &str) -> bool {
    matches!(
        kind,
        "busy" | "connection-lost" | "unauthorized" | "unavailable" | "oversize"
    )
}

fn emit_outcome(route: &str, kind: &str) {
    let route = if diag_route_valid(route) { route } else { "unknown" };
    let kind = if diag_kind_valid(kind) { kind } else { "unknown" };
    eprintln!("{DIAG_PREFIX}:route={route}:result=rejected:kind={kind}");
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
    async fn describe_focus(
        &self,
        request: String,
        #[zbus(header)] header: zbus::message::Header<'_>,
        #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
    ) -> Result<String, PlannerError> {
        // Focus route: same bounded non-queuing single-flight, same-UID
        // verification, connection-loss, and reply-size checks. Group B: the
        // trio backend was removed, so authorized requests fail closed as
        // unavailable. No generic IPC is introduced.
        // Diagnostics are emitted only after the guard is released (see
        // `emit_outcome` contract).
        let Some(_guard) = self.operation_lock.try_lock() else {
            emit_outcome("focus", "busy");
            return Err(PlannerError::Unavailable("planner is busy".to_owned()));
        };
        if emitter.connection().is_closed() {
            drop(_guard);
            emit_outcome("focus", "connection-lost");
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        let caller = header.sender().map(ToString::to_string);
        let Some(caller) = caller.as_deref() else {
            drop(_guard);
            emit_outcome("focus", "unauthorized");
            return unauthorized_response(FOCUS_METHOD);
        };
        if !verify_planner_caller(emitter.connection(), caller).await {
            drop(_guard);
            emit_outcome("focus", "unauthorized");
            return unauthorized_response(FOCUS_METHOD);
        };
        let reply = match self.evaluate_focus_request(&request) {
            Ok(reply) => reply,
            Err(error) => {
                drop(_guard);
                emit_outcome("focus", "unavailable");
                return Err(error);
            }
        };
        if reply.len() > FOCUS_MAX_REPLY {
            drop(_guard);
            emit_outcome("focus", "oversize");
            return Err(PlannerError::Unavailable(
                "reply exceeds size bound".to_owned(),
            ));
        }
        // Success is silent (zero diagnostic lines): the reply is returned
        // with the lock released and no logging, so output never triggers
        // bus activation and never holds the operation lock.
        drop(_guard);
        Ok(reply)
    }

    async fn describe_movement(
        &self,
        request: String,
        #[zbus(header)] header: zbus::message::Header<'_>,
        #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
    ) -> Result<String, PlannerError> {
        // Movement route: same bounded non-queuing single-flight,
        // same-UID verification, connection-loss, and reply-size checks.
        // Group B: the trio backend was removed, so authorized requests fail
        // closed as unavailable. No generic IPC is introduced.
        // Diagnostics are emitted only after the guard is released (see
        // `emit_outcome` contract).
        let Some(_guard) = self.operation_lock.try_lock() else {
            emit_outcome("movement", "busy");
            return Err(PlannerError::Unavailable("planner is busy".to_owned()));
        };
        if emitter.connection().is_closed() {
            drop(_guard);
            emit_outcome("movement", "connection-lost");
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        let caller = header.sender().map(ToString::to_string);
        let Some(caller) = caller.as_deref() else {
            drop(_guard);
            emit_outcome("movement", "unauthorized");
            return unauthorized_response(MOVEMENT_METHOD);
        };
        if !verify_planner_caller(emitter.connection(), caller).await {
            drop(_guard);
            emit_outcome("movement", "unauthorized");
            return unauthorized_response(MOVEMENT_METHOD);
        };
        let reply = match self.evaluate_movement_request(&request) {
            Ok(reply) => reply,
            Err(error) => {
                drop(_guard);
                emit_outcome("movement", "unavailable");
                return Err(error);
            }
        };
        if reply.len() > MOVEMENT_MAX_REPLY {
            drop(_guard);
            emit_outcome("movement", "oversize");
            return Err(PlannerError::Unavailable(
                "reply exceeds size bound".to_owned(),
            ));
        }
        // Success is silent (zero diagnostic lines): the reply is returned
        // with the lock released and no logging, so output never triggers
        // bus activation and never holds the operation lock.
        drop(_guard);
        Ok(reply)
    }

    async fn describe_resize(
        &self,
        request: String,
        #[zbus(header)] header: zbus::message::Header<'_>,
        #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
    ) -> Result<String, PlannerError> {
        // Keyboard resize route: same bounded non-queuing single-flight,
        // same-UID verification, connection-loss, and reply-size checks.
        // Group B: the trio backend was removed, so authorized requests fail
        // closed as unavailable. No generic IPC is introduced.
        // Diagnostics are emitted only after the guard is released (see
        // `emit_outcome` contract).
        let Some(_guard) = self.operation_lock.try_lock() else {
            emit_outcome("resize", "busy");
            return Err(PlannerError::Unavailable("planner is busy".to_owned()));
        };
        if emitter.connection().is_closed() {
            drop(_guard);
            emit_outcome("resize", "connection-lost");
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        let caller = header.sender().map(ToString::to_string);
        let Some(caller) = caller.as_deref() else {
            drop(_guard);
            emit_outcome("resize", "unauthorized");
            return unauthorized_response(RESIZE_METHOD);
        };
        if !verify_planner_caller(emitter.connection(), caller).await {
            drop(_guard);
            emit_outcome("resize", "unauthorized");
            return unauthorized_response(RESIZE_METHOD);
        };
        let reply = match self.evaluate_resize_request(&request) {
            Ok(reply) => reply,
            Err(error) => {
                drop(_guard);
                emit_outcome("resize", "unavailable");
                return Err(error);
            }
        };
        if reply.len() > RESIZE_MAX_REPLY {
            drop(_guard);
            emit_outcome("resize", "oversize");
            return Err(PlannerError::Unavailable(
                "reply exceeds size bound".to_owned(),
            ));
        }
        // Success is silent (zero diagnostic lines, see `emit_outcome`
        // contract): the reply is returned with the lock released.
        drop(_guard);
        Ok(reply)
    }

    async fn describe_pointer_resize(
        &self,
        request: String,
        #[zbus(header)] header: zbus::message::Header<'_>,
        #[zbus(signal_emitter)] emitter: zbus::object_server::SignalEmitter<'_>,
    ) -> Result<String, PlannerError> {
        // Pointer resize route: same bounded non-queuing single-flight,
        // same-UID verification, connection-loss, and reply-size checks.
        // Group B: the trio backend was removed, so authorized requests fail
        // closed as unavailable. No generic IPC is introduced.
        // Diagnostics are emitted only after the guard is released (see
        // `emit_outcome` contract).
        let Some(_guard) = self.operation_lock.try_lock() else {
            emit_outcome("pointer", "busy");
            return Err(PlannerError::Unavailable("planner is busy".to_owned()));
        };
        if emitter.connection().is_closed() {
            drop(_guard);
            emit_outcome("pointer", "connection-lost");
            return Err(PlannerError::Unavailable(
                "planner serving connection was lost".to_owned(),
            ));
        }
        let caller = header.sender().map(ToString::to_string);
        let Some(caller) = caller.as_deref() else {
            drop(_guard);
            emit_outcome("pointer", "unauthorized");
            return unauthorized_response(POINTER_RESIZE_METHOD);
        };
        if !verify_planner_caller(emitter.connection(), caller).await {
            drop(_guard);
            emit_outcome("pointer", "unauthorized");
            return unauthorized_response(POINTER_RESIZE_METHOD);
        };
        let reply = match self.evaluate_pointer_resize_request(&request) {
            Ok(reply) => reply,
            Err(error) => {
                drop(_guard);
                emit_outcome("pointer", "unavailable");
                return Err(error);
            }
        };
        if reply.len() > POINTER_RESIZE_MAX_REPLY {
            drop(_guard);
            emit_outcome("pointer", "oversize");
            return Err(PlannerError::Unavailable(
                "reply exceeds size bound".to_owned(),
            ));
        }
        // Success is silent (zero diagnostic lines, see `emit_outcome`
        // contract): the reply is returned with the lock released.
        drop(_guard);
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
        let parsed: serde_json::Value =
            serde_json::from_str(&first).expect("unauthorized reply is valid JSON");
        assert_eq!(parsed["outcome"], "rejected");
        assert_eq!(parsed["kind"], "unauthorized");
        // Fixed body never echoes caller input.
        assert!(!first.contains("evil-correlation"));
        // Represents Ok rather than PlannerError.
        let as_result: Result<String, PlannerError> = Ok(unauthorized_rejection());
        assert!(as_result.is_ok());
        assert_ne!(
            as_result.unwrap(),
            String::new(),
            "unauthorized body is non-empty fixed JSON"
        );
    }

    #[test]
    fn unauthorized_channel_is_inband_for_exactly_four_routes() {
        // The four transaction routes return the fixed in-band JSON body via
        // the actual production helper.
        for method in [
            FOCUS_METHOD,
            MOVEMENT_METHOD,
            RESIZE_METHOD,
            POINTER_RESIZE_METHOD,
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
        // Group B: the trio backend was removed without a general-N
        // replacement. All four transaction routes fail closed as
        // unavailable over the preserved D-Bus identity.
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

}
