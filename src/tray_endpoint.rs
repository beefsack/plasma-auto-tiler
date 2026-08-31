use std::sync::{Arc, Mutex};
use std::time::Instant;

use zbus::blocking::{Connection, fdo::DBusProxy};

pub const SERVICE: &str = "org.plasmaautotiler.Tray";
pub const OBJECT: &str = "/org/plasmaautotiler/Tray";
pub const INTERFACE: &str = "org.plasmaautotiler.Tray1";
pub const METHOD: &str = "PublishSnapshot";
pub const KWIN_SERVICE: &str = "org.kde.KWin";
pub const FRESHNESS_MS: u64 = 30_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub generation: String,
    pub revision: i32,
    pub enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StateView {
    pub owner: bool,
    pub snapshot: Option<Snapshot>,
    pub refreshed_at: Option<u64>,
    pub current: bool,
}

#[derive(Debug, zbus::DBusError, PartialEq, Eq)]
#[zbus(prefix = "org.plasmaautotiler.Tray1")]
pub enum TrayError {
    InvalidSnapshot(String),
}

#[derive(Debug, Default)]
pub struct TrayState {
    owner: Option<String>,
    snapshot: Option<Snapshot>,
    refreshed_at: Option<u64>,
}

impl TrayState {
    pub fn owner_changed(&mut self, owner: Option<&str>) {
        if self.owner.as_deref() != owner {
            self.clear_snapshot();
        }
        self.owner = owner.map(str::to_owned);
    }

    pub fn publish_snapshot(
        &mut self,
        schema: i32,
        generation: String,
        revision: i32,
        enabled: bool,
        now_ms: u64,
    ) -> Result<(), TrayError> {
        if schema != 1 || !valid_generation(&generation) {
            return Err(TrayError::InvalidSnapshot(
                "schema or generation is invalid".to_owned(),
            ));
        }

        if self.owner.is_none() {
            return Ok(());
        }

        let incoming = Snapshot {
            generation,
            revision,
            enabled,
        };
        let accept = match self.snapshot.as_ref() {
            None => true,
            Some(current) => {
                incoming.generation != current.generation
                    || incoming.revision > current.revision
                    || (incoming.revision == current.revision
                        && incoming.enabled == current.enabled)
            }
        };

        if accept {
            self.snapshot = Some(incoming);
            self.refreshed_at = Some(now_ms);
            Ok(())
        } else {
            self.clear_snapshot();
            Err(TrayError::InvalidSnapshot(
                "revision is not a valid state transition".to_owned(),
            ))
        }
    }

    pub fn view(&self, now_ms: u64) -> StateView {
        let current = self.owner.is_some()
            && self.snapshot.is_some()
            && self.refreshed_at.is_some_and(|refreshed_at| {
                now_ms >= refreshed_at && now_ms - refreshed_at < FRESHNESS_MS
            });
        StateView {
            owner: self.owner.is_some(),
            snapshot: self.snapshot.clone(),
            refreshed_at: self.refreshed_at,
            current,
        }
    }

    fn clear_snapshot(&mut self) {
        self.snapshot = None;
        self.refreshed_at = None;
    }
}

fn valid_generation(generation: &str) -> bool {
    (1..=32).contains(&generation.len())
        && generation
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

#[derive(Clone, Debug)]
pub struct TrayEndpoint {
    state: Arc<Mutex<TrayState>>,
    started: Instant,
}

impl TrayEndpoint {
    pub fn new(initial_owner: Option<&str>) -> Self {
        let mut state = TrayState::default();
        state.owner_changed(initial_owner);
        Self {
            state: Arc::new(Mutex::new(state)),
            started: Instant::now(),
        }
    }

    pub fn owner_changed(&self, owner: Option<&str>) {
        self.state
            .lock()
            .expect("tray state mutex poisoned")
            .owner_changed(owner);
    }
}

#[zbus::interface(name = "org.plasmaautotiler.Tray1")]
impl TrayEndpoint {
    fn publish_snapshot(
        &self,
        schema: i32,
        generation: String,
        revision: i32,
        enabled: bool,
    ) -> Result<(), TrayError> {
        let now_ms = self.started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        self.state
            .lock()
            .expect("tray state mutex poisoned")
            .publish_snapshot(schema, generation, revision, enabled, now_ms)
    }
}

pub fn run() -> zbus::Result<()> {
    let connection = Connection::session()?;
    let dbus = DBusProxy::new(&connection)?;
    let owner_changes = dbus.receive_name_owner_changed_with_args(&[(0, KWIN_SERVICE)])?;
    let initial_owner = reconcile_initial_owner(
        || dbus.name_has_owner(KWIN_SERVICE.try_into().unwrap()),
        || {
            dbus.get_name_owner(KWIN_SERVICE.try_into().unwrap())
                .map(|owner| owner.to_string())
        },
    )?;

    let endpoint = TrayEndpoint::new(initial_owner.as_deref());
    connection.object_server().at(OBJECT, endpoint.clone())?;
    connection.request_name(SERVICE)?;

    if let Err(error) = crate::tray_lifecycle::create_current_record() {
        let cleanup = crate::tray_lifecycle::cleanup_current_record();
        return Err(lifecycle_error(
            format!("create tray PID record: {error}"),
            cleanup,
        ));
    }
    if let Err(error) = crate::tray_lifecycle::signal_current_record_ready() {
        let cleanup = crate::tray_lifecycle::cleanup_current_record();
        return Err(lifecycle_error(
            format!("signal tray endpoint readiness: {error}"),
            cleanup,
        ));
    }
    let result: zbus::Result<()> = (|| {
        for signal in owner_changes {
            let args = signal.args()?;
            let owner = args.new_owner().as_ref().map(ToString::to_string);
            endpoint.owner_changed(owner.as_deref());
        }
        Ok(())
    })();
    let cleanup = crate::tray_lifecycle::cleanup_current_record();
    finish_watcher(result, cleanup)
}

fn finish_watcher(result: zbus::Result<()>, cleanup: Result<(), String>) -> zbus::Result<()> {
    match (result, cleanup) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), Err(error)) => Err(zbus::Error::Failure(format!(
            "clean tray PID record: {error}"
        ))),
        (Err(error), Err(cleanup)) => Err(zbus::Error::Failure(format!(
            "{error}; clean tray PID record: {cleanup}"
        ))),
    }
}

fn lifecycle_error(message: String, cleanup: Result<(), String>) -> zbus::Error {
    zbus::Error::Failure(match cleanup {
        Ok(()) => message,
        Err(cleanup) => format!("{message}; cleanup: {cleanup}"),
    })
}

fn reconcile_initial_owner<Observed, Resolved>(
    observe_owner: Observed,
    resolve_owner: Resolved,
) -> zbus::fdo::Result<Option<String>>
where
    Observed: FnOnce() -> zbus::fdo::Result<bool>,
    Resolved: FnOnce() -> zbus::fdo::Result<String>,
{
    if observe_owner()? {
        match resolve_owner() {
            Ok(owner) => Ok(Some(owner)),
            Err(zbus::fdo::Error::NameHasNoOwner(_)) => Ok(None),
            Err(error) => Err(error),
        }
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use super::{KWIN_SERVICE, reconcile_initial_owner};

    #[test]
    fn owner_loss_during_startup_reconciliation_begins_empty() {
        let calls = Rc::new(RefCell::new(Vec::new()));
        let observed_calls = Rc::clone(&calls);
        let resolved_calls = Rc::clone(&calls);
        let initial_owner = reconcile_initial_owner(
            || {
                observed_calls.borrow_mut().push("observe");
                Ok(true)
            },
            || {
                resolved_calls.borrow_mut().push("resolve");
                Err(zbus::fdo::Error::NameHasNoOwner(KWIN_SERVICE.to_owned()))
            },
        )
        .unwrap();

        assert_eq!(*calls.borrow(), ["observe", "resolve"]);
        assert_eq!(initial_owner, None);
    }

    #[test]
    fn watcher_error_keeps_cleanup_error() {
        let result = super::finish_watcher(
            Err(zbus::Error::Failure("watcher failed".to_owned())),
            Err("record cleanup failed".to_owned()),
        )
        .unwrap_err()
        .to_string();

        assert!(result.contains("watcher failed"));
        assert!(result.contains("record cleanup failed"));
    }
}
