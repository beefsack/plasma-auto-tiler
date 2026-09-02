use std::collections::VecDeque;
use std::fs::File;
use std::io::Read;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::Instant;

use zbus::blocking::{Connection, MessageIterator, fdo::DBusProxy};
use zbus::fdo::{RequestNameFlags, RequestNameReply};
use zbus::object_server::SignalEmitter;
use zbus::{MatchRule, fdo::NameOwnerChanged, message::Type};

use crate::tray::{DbusMenu, StatusNotifierItem, TrayProjection};
use crate::tray_lifecycle::{ProcProcessControl, ProcessControl, ProcessIdentity};

pub const SERVICE: &str = "org.plasmaautotiler.Tray";
pub const OBJECT: &str = "/org/plasmaautotiler/Tray";
pub const INTERFACE: &str = "org.plasmaautotiler.Tray1";
pub const METHOD: &str = "PublishSnapshot";
pub const KWIN_SERVICE: &str = "org.kde.KWin";
pub const FRESHNESS_MS: u64 = 30_000;
const APPROVED_KWIN_ENTRYPOINTS: &[&str] = &[
    "/run/current-system/sw/bin/kwin_wayland",
    "/run/current-system/sw/bin/kwin_wayland_wrapper",
    "/run/current-system/sw/bin/kwin_x11",
    "/usr/bin/kwin_wayland",
    "/usr/bin/kwin_wayland_wrapper",
    "/usr/bin/kwin_x11",
];
const WATCHER_REGISTRATION_ATTEMPTS: usize = 3;
const WATCHER_REGISTRATION_RETRY_DELAY: Duration = Duration::from_millis(100);
const STATUS_NOTIFIER_WATCHER_SERVICE: &str = "org.kde.StatusNotifierWatcher";
const STATUS_NOTIFIER_WATCHER_OBJECT: &str = "/StatusNotifierWatcher";
const STATUS_NOTIFIER_WATCHER_INTERFACE: &str = "org.kde.StatusNotifierWatcher";
const REGISTER_STATUS_NOTIFIER_ITEM: &str = "RegisterStatusNotifierItem";
const MAX_GENERATION_HISTORY: usize = 256;

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
    UnauthorizedPublisher,
    EmissionFailed(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PublisherIdentity {
    pub process_id: u32,
    pub process: ProcessIdentity,
    approved: ApprovedKwinIdentity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ApprovedKwinIdentity {
    canonical_path: PathBuf,
    executable: crate::tray_lifecycle::ProcessExecutableIdentity,
}

#[derive(Debug, Default)]
pub struct TrayState {
    owner: Option<String>,
    generation: Option<String>,
    revision: Option<i32>,
    ordering_conflicted: bool,
    snapshot: Option<Snapshot>,
    refreshed_at: Option<u64>,
    retired_generations: VecDeque<String>,
    quarantined_generations: VecDeque<String>,
    publisher_identity: Option<PublisherIdentity>,
    trusted_publisher: Option<PublisherIdentity>,
}

impl TrayState {
    pub fn owner_changed(&mut self, owner: Option<&str>) {
        if self.owner.as_deref() != owner {
            self.clear_snapshot();
            self.generation = None;
            self.revision = None;
            self.ordering_conflicted = false;
            self.retired_generations.clear();
            self.quarantined_generations.clear();
            self.publisher_identity = None;
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
        let accept = match self.generation.as_deref() {
            None => true,
            Some(current) if current == incoming.generation => {
                self.revision.is_some_and(|revision| {
                    if self.ordering_conflicted {
                        incoming.revision > revision
                    } else {
                        incoming.revision > revision
                            || (incoming.revision == revision
                                && self
                                    .snapshot
                                    .as_ref()
                                    .is_some_and(|current| current.enabled == incoming.enabled))
                    }
                })
            }
            Some(_) => {
                incoming.revision == 0
                    && !self.retired_generations.contains(&incoming.generation)
                    && !self.quarantined_generations.contains(&incoming.generation)
            }
        };

        if accept {
            if let Some(current) = self.generation.as_ref()
                && current != &incoming.generation
            {
                remember_generation(&mut self.retired_generations, current);
            }
            self.generation = Some(incoming.generation.clone());
            self.revision = Some(incoming.revision);
            self.ordering_conflicted = false;
            self.snapshot = Some(incoming);
            self.refreshed_at = Some(now_ms);
            Ok(())
        } else {
            let retired_generation = self.retired_generations.contains(&incoming.generation);
            let quarantined_generation =
                self.quarantined_generations.contains(&incoming.generation);
            if !retired_generation && !quarantined_generation {
                self.clear_snapshot();
                if self.generation.as_deref() == Some(incoming.generation.as_str()) {
                    self.revision = self.revision.map_or(Some(incoming.revision), |revision| {
                        Some(revision.max(incoming.revision))
                    });
                } else {
                    remember_generation(&mut self.quarantined_generations, &incoming.generation);
                }
                self.ordering_conflicted = true;
            }
            Err(TrayError::InvalidSnapshot(
                "revision is not a valid state transition".to_owned(),
            ))
        }
    }

    pub(crate) fn publish_snapshot_from(
        &mut self,
        publisher: Option<&str>,
        identity: Option<&PublisherIdentity>,
        schema: i32,
        snapshot: Snapshot,
        now_ms: u64,
    ) -> Result<(), TrayError> {
        let Some(identity) = identity else {
            return Err(TrayError::UnauthorizedPublisher);
        };
        if !authorized_publisher(
            self.owner.as_deref(),
            publisher,
            identity,
            self.publisher_identity.as_ref(),
            self.trusted_publisher.as_ref(),
        ) {
            return Err(TrayError::UnauthorizedPublisher);
        }

        let result = self.publish_snapshot(
            schema,
            snapshot.generation,
            snapshot.revision,
            snapshot.enabled,
            now_ms,
        );
        if result.is_ok() && self.publisher_identity.is_none() {
            self.publisher_identity = Some(identity.clone());
            if self.trusted_publisher.is_none() {
                self.trusted_publisher = Some(identity.clone());
            }
        }
        result
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

fn authorized_publisher(
    owner: Option<&str>,
    publisher: Option<&str>,
    identity: &PublisherIdentity,
    expected_identity: Option<&PublisherIdentity>,
    trusted_identity: Option<&PublisherIdentity>,
) -> bool {
    let (Some(owner), Some(publisher)) = (owner, publisher) else {
        return false;
    };

    owner == publisher
        && zbus::names::UniqueName::try_from(owner).is_ok()
        && valid_publisher_identity(identity)
        && expected_identity.map_or_else(
            || {
                trusted_identity
                    .is_none_or(|trusted| same_executable(&trusted.process, &identity.process))
            },
            |expected| expected == identity,
        )
}

fn valid_publisher_identity(identity: &PublisherIdentity) -> bool {
    identity.process_id != 0
        && identity.process.start_tick != 0
        && matches_approved_identity(&identity.process, &identity.approved)
        && !identity.process.executable.content.is_empty()
}

fn matches_approved_identity(process: &ProcessIdentity, approved: &ApprovedKwinIdentity) -> bool {
    process.resolved_executable_path == approved.canonical_path
        && process.executable == approved.executable
}

fn resolve_approved_kwin_identities() -> Vec<ApprovedKwinIdentity> {
    APPROVED_KWIN_ENTRYPOINTS
        .iter()
        .filter_map(|entrypoint| {
            let canonical_path = std::fs::canonicalize(entrypoint).ok()?;
            let mut file = File::open(&canonical_path).ok()?;
            let metadata = file.metadata().ok()?;
            if !metadata.is_file() || metadata.mode() & 0o111 == 0 {
                return None;
            }
            let mut content = Vec::new();
            file.read_to_end(&mut content).ok()?;
            if content.is_empty() {
                return None;
            }
            Some(ApprovedKwinIdentity {
                canonical_path,
                executable: crate::tray_lifecycle::ProcessExecutableIdentity {
                    dev: metadata.dev(),
                    ino: metadata.ino(),
                    content,
                },
            })
        })
        .collect()
}

fn same_executable(expected: &ProcessIdentity, actual: &ProcessIdentity) -> bool {
    expected.resolved_executable_path == actual.resolved_executable_path
        && expected.executable == actual.executable
}

fn remember_generation(history: &mut VecDeque<String>, generation: &str) {
    if history.iter().any(|known| known == generation) {
        return;
    }
    history.push_back(generation.to_owned());
    while history.len() > MAX_GENERATION_HISTORY {
        history.pop_front();
    }
}

#[derive(Clone, Debug)]
pub struct TrayEndpoint {
    state: Arc<Mutex<TrayState>>,
    started: Instant,
    projection: TrayProjection,
    operation_lock: Arc<async_lock::Mutex<()>>,
}

impl TrayEndpoint {
    pub fn new(initial_owner: Option<&str>) -> Self {
        let mut state = TrayState::default();
        state.owner_changed(initial_owner);
        let state = Arc::new(Mutex::new(state));
        let last_status = Arc::new(Mutex::new(None));
        let started = Instant::now();
        let projection =
            TrayProjection::with_last_status(Arc::clone(&state), started, Arc::clone(&last_status));
        Self {
            state,
            started,
            projection,
            operation_lock: Arc::new(async_lock::Mutex::new(())),
        }
    }

    pub fn owner_changed(&self, owner: Option<&str>) {
        let _operation_guard = self.operation_lock.lock_blocking();
        self.state
            .lock()
            .expect("tray state mutex poisoned")
            .owner_changed(owner);
    }

    pub fn projection(&self) -> TrayProjection {
        self.projection.clone()
    }

    fn publish_authenticated_snapshot(
        &self,
        publisher: &str,
        identity: &PublisherIdentity,
        schema: i32,
        snapshot: Snapshot,
    ) -> Result<(), TrayError> {
        let mut state = self.state.lock().expect("tray state mutex poisoned");
        let now_ms = self.started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        state.publish_snapshot_from(Some(publisher), Some(identity), schema, snapshot, now_ms)
    }
}

#[zbus::interface(name = "org.plasmaautotiler.Tray1")]
impl TrayEndpoint {
    async fn publish_snapshot(
        &self,
        schema: i32,
        generation: String,
        revision: i32,
        enabled: bool,
        #[zbus(header)] header: zbus::message::Header<'_>,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> Result<(), TrayError> {
        let publisher = header.sender().map(ToString::to_string);
        let Some(publisher) = publisher.as_deref() else {
            return Err(TrayError::UnauthorizedPublisher);
        };
        let _operation_guard = self.operation_lock.lock().await;
        let Some(identity) = verify_kwin_publisher(emitter.connection(), publisher).await else {
            return Err(TrayError::UnauthorizedPublisher);
        };
        let result = self.publish_authenticated_snapshot(
            publisher,
            &identity,
            schema,
            Snapshot {
                generation,
                revision,
                enabled,
            },
        );
        self.projection()
            .emit_changed(emitter.connection())
            .await
            .map_err(|error| TrayError::EmissionFailed(error.to_string()))?;
        result
    }
}

pub fn run() -> zbus::Result<()> {
    let connection = Connection::session()?;
    let dbus = DBusProxy::new(&connection)?;
    let owner_changes_rule = MatchRule::builder()
        .msg_type(Type::Signal)
        .sender("org.freedesktop.DBus")?
        .interface("org.freedesktop.DBus")?
        .member("NameOwnerChanged")?
        .build();
    let owner_changes = MessageIterator::for_match_rule(owner_changes_rule, &connection, Some(16))?;
    let watcher_owner = reconcile_initial_owner(
        || dbus.name_has_owner(STATUS_NOTIFIER_WATCHER_SERVICE.try_into().unwrap()),
        || {
            dbus.get_name_owner(STATUS_NOTIFIER_WATCHER_SERVICE.try_into().unwrap())
                .map(|owner| owner.to_string())
        },
    )?;
    let initial_owner = reconcile_initial_owner(
        || dbus.name_has_owner(KWIN_SERVICE.try_into().unwrap()),
        || {
            dbus.get_name_owner(KWIN_SERVICE.try_into().unwrap())
                .map(|owner| owner.to_string())
        },
    )?;

    let endpoint = TrayEndpoint::new(initial_owner.as_deref());
    let projection = endpoint.projection();
    connection.object_server().at(OBJECT, endpoint.clone())?;
    connection.object_server().at(
        StatusNotifierItem::OBJECT,
        projection.status_notifier_item(),
    )?;
    connection
        .object_server()
        .at(DbusMenu::OBJECT, projection.menu())?;
    request_service_name(&connection)?;

    if let Err(error) = crate::tray_lifecycle::create_current_record() {
        let cleanup = crate::tray_lifecycle::cleanup_current_record();
        return Err(lifecycle_error(
            format!("create tray PID record: {error}"),
            cleanup,
        ));
    }
    let watcher_owner = watcher_owner.ok_or_else(|| {
        lifecycle_error(
            "status notifier watcher has no owner".to_owned(),
            crate::tray_lifecycle::cleanup_current_record(),
        )
    })?;
    if let Err(error) = register_status_notifier_item_with_retry(&connection, &watcher_owner) {
        let cleanup = crate::tray_lifecycle::cleanup_current_record();
        return Err(lifecycle_error(
            format!("register status notifier item: {error}"),
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
    let stop_watchdog = Arc::new(AtomicBool::new(false));
    let watchdog_stop = Arc::clone(&stop_watchdog);
    let watchdog_projection = projection.clone();
    let watchdog_connection = connection.clone();
    let watchdog = thread::spawn(move || {
        while !watchdog_stop.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_secs(1));
            if watchdog_stop.load(Ordering::Relaxed) {
                break;
            }
            let _ = zbus::block_on(watchdog_projection.emit_changed(watchdog_connection.inner()));
        }
    });
    let mut registered_watcher_owner = None;
    let result: zbus::Result<()> = (|| {
        registered_watcher_owner = Some(watcher_owner);
        for message in owner_changes {
            let message = message?;
            let signal = NameOwnerChanged::from_message(message).ok_or_else(|| {
                zbus::Error::Failure("owner-change iterator yielded a non-owner signal".to_owned())
            })?;
            let args = signal.args()?;
            let owner = args.new_owner().as_ref().map(ToString::to_string);
            match args.name().as_str() {
                KWIN_SERVICE => {
                    endpoint.owner_changed(owner.as_deref());
                    zbus::block_on(projection.emit_changed(connection.inner()))?;
                }
                STATUS_NOTIFIER_WATCHER_SERVICE => {
                    handle_watcher_owner_change(&mut registered_watcher_owner, owner, |owner| {
                        register_status_notifier_item_with_retry(&connection, owner)
                    })?
                }
                _ => {}
            }
        }
        Ok(())
    })();
    stop_watchdog.store(true, Ordering::Relaxed);
    let _ = watchdog.join();
    let cleanup = crate::tray_lifecycle::cleanup_current_record();
    finish_watcher(result, cleanup)
}

fn register_status_notifier_item(
    connection: &Connection,
    expected_owner: &str,
) -> zbus::Result<()> {
    connection
        .call_method(
            Some(STATUS_NOTIFIER_WATCHER_SERVICE),
            STATUS_NOTIFIER_WATCHER_OBJECT,
            Some(STATUS_NOTIFIER_WATCHER_INTERFACE),
            REGISTER_STATUS_NOTIFIER_ITEM,
            &(SERVICE,),
        )
        .map(|_| ())?;
    let owner = DBusProxy::new(connection)?
        .get_name_owner(STATUS_NOTIFIER_WATCHER_SERVICE.try_into().unwrap())?;
    if owner.as_str() != expected_owner {
        return Err(zbus::Error::Failure(
            "status notifier watcher owner changed during registration".to_owned(),
        ));
    }
    Ok(())
}

fn request_service_name(connection: &Connection) -> zbus::Result<()> {
    match connection.request_name_with_flags(SERVICE, RequestNameFlags::DoNotQueue.into())? {
        RequestNameReply::PrimaryOwner => Ok(()),
        reply => Err(zbus::Error::Failure(format!(
            "helper service name was not acquired: {reply}"
        ))),
    }
}

fn register_status_notifier_item_with_retry(
    connection: &Connection,
    expected_owner: &str,
) -> zbus::Result<()> {
    retry_registration(
        || register_status_notifier_item(connection, expected_owner),
        || thread::sleep(WATCHER_REGISTRATION_RETRY_DELAY),
    )
}

fn handle_watcher_owner_change<Register>(
    registered_owner: &mut Option<String>,
    new_owner: Option<String>,
    register: Register,
) -> zbus::Result<()>
where
    Register: FnOnce(&str) -> zbus::Result<()>,
{
    if new_owner.as_deref() == registered_owner.as_deref() {
        return Ok(());
    }

    *registered_owner = None;
    let Some(new_owner) = new_owner else {
        return Err(zbus::Error::Failure(
            "status notifier watcher ownership was lost after registration".to_owned(),
        ));
    };

    register(&new_owner)?;
    *registered_owner = Some(new_owner);
    Ok(())
}

async fn verify_kwin_publisher(
    connection: &zbus::Connection,
    publisher: &str,
) -> Option<PublisherIdentity> {
    let unique_name = zbus::names::UniqueName::try_from(publisher).ok()?;
    let Ok(dbus) = zbus::fdo::DBusProxy::new(connection).await else {
        return None;
    };
    let Ok(owner) = dbus
        .get_name_owner(KWIN_SERVICE.try_into().expect("valid KWin service name"))
        .await
    else {
        return None;
    };
    if owner.as_str() != publisher {
        return None;
    }
    let Ok(credentials) = dbus.get_connection_credentials(unique_name.into()).await else {
        return None;
    };
    if credentials.unix_user_id() != Some(rustix::process::geteuid().as_raw()) {
        return None;
    }
    let process_id = credentials.process_id()?;
    let process = ProcProcessControl {
        proc_root: Path::new("/proc").to_path_buf(),
    };
    let process_identity = process.identity(process_id).ok().flatten()?;
    let approved = resolve_approved_kwin_identities()
        .into_iter()
        .find(|approved| matches_approved_identity(&process_identity, approved))?;
    let current_owner = dbus
        .get_name_owner(KWIN_SERVICE.try_into().expect("valid KWin service name"))
        .await
        .ok()?;
    if current_owner.as_str() != publisher {
        return None;
    }
    Some(PublisherIdentity {
        process_id,
        process: process_identity,
        approved,
    })
}

fn retry_registration<T, E, Register, Delay>(
    mut register: Register,
    mut delay: Delay,
) -> Result<T, E>
where
    Register: FnMut() -> Result<T, E>,
    Delay: FnMut(),
{
    let mut last_error = None;
    for attempt in 0..WATCHER_REGISTRATION_ATTEMPTS {
        match register() {
            Ok(value) => return Ok(value),
            Err(error) => {
                last_error = Some(error);
                if attempt + 1 < WATCHER_REGISTRATION_ATTEMPTS {
                    delay();
                }
            }
        }
    }

    Err(last_error.expect("watcher registration attempts are non-empty"))
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
    use std::path::PathBuf;
    use std::rc::Rc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Barrier};
    use std::thread;
    use std::time::Duration;

    use super::{
        APPROVED_KWIN_ENTRYPOINTS, KWIN_SERVICE, REGISTER_STATUS_NOTIFIER_ITEM, SERVICE,
        STATUS_NOTIFIER_WATCHER_INTERFACE, STATUS_NOTIFIER_WATCHER_OBJECT,
        STATUS_NOTIFIER_WATCHER_SERVICE, authorized_publisher, handle_watcher_owner_change,
        reconcile_initial_owner, retry_registration,
    };

    fn approved_identity() -> super::ApprovedKwinIdentity {
        super::ApprovedKwinIdentity {
            canonical_path: PathBuf::from("/nix/store/host-kwin-6.7.4/bin/kwin_wayland"),
            executable: crate::tray_lifecycle::ProcessExecutableIdentity {
                dev: 1,
                ino: 1,
                content: b"host-kwin".to_vec(),
            },
        }
    }

    fn publisher_identity(process_id: u32) -> super::PublisherIdentity {
        let approved = approved_identity();
        super::PublisherIdentity {
            process_id,
            process: super::ProcessIdentity {
                start_tick: 1,
                resolved_executable_path: approved.canonical_path.clone(),
                executable: approved.executable.clone(),
            },
            approved,
        }
    }

    #[test]
    fn kwin_publisher_binding_requires_an_exact_canonical_host_identity() {
        assert_eq!(
            APPROVED_KWIN_ENTRYPOINTS,
            &[
                "/run/current-system/sw/bin/kwin_wayland",
                "/run/current-system/sw/bin/kwin_wayland_wrapper",
                "/run/current-system/sw/bin/kwin_x11",
                "/usr/bin/kwin_wayland",
                "/usr/bin/kwin_wayland_wrapper",
                "/usr/bin/kwin_x11",
            ]
        );

        let exact = publisher_identity(1);
        assert!(authorized_publisher(
            Some(":1.1"),
            Some(":1.1"),
            &exact,
            None,
            None,
        ));

        for path in [
            "/tmp/kwin_wayland",
            "/nix/store/unrelated-kwin-6.7.4/bin/kwin_wayland",
        ] {
            let mut copied = publisher_identity(1);
            copied.process.resolved_executable_path = PathBuf::from(path);
            assert!(!authorized_publisher(
                Some(":1.1"),
                Some(":1.1"),
                &copied,
                None,
                None,
            ));
        }

        let mut copied = publisher_identity(1);
        copied.process.executable.content = b"different-kwin".to_vec();
        assert!(!authorized_publisher(
            Some(":1.1"),
            Some(":1.1"),
            &copied,
            None,
            None,
        ));
    }

    #[test]
    fn snapshot_acceptance_requires_the_current_unique_kwin_publisher_and_rejects_pid_reuse() {
        let mut state = super::TrayState::default();
        state.owner_changed(Some(":org.kwin"));

        assert_eq!(
            state
                .publish_snapshot_from(
                    None,
                    None,
                    1,
                    super::Snapshot {
                        generation: "alpha".to_owned(),
                        revision: 1,
                        enabled: true,
                    },
                    0,
                )
                .unwrap_err(),
            super::TrayError::UnauthorizedPublisher
        );
        let mut incomplete_identity = publisher_identity(1);
        incomplete_identity.process.executable.content.clear();
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":org.kwin"),
                    Some(&incomplete_identity),
                    1,
                    super::Snapshot {
                        generation: "alpha".to_owned(),
                        revision: 1,
                        enabled: true,
                    },
                    0,
                )
                .unwrap_err(),
            super::TrayError::UnauthorizedPublisher
        );
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":other"),
                    Some(&publisher_identity(1)),
                    1,
                    super::Snapshot {
                        generation: "alpha".to_owned(),
                        revision: 1,
                        enabled: true,
                    },
                    0,
                )
                .unwrap_err(),
            super::TrayError::UnauthorizedPublisher
        );
        assert_eq!(
            state.publish_snapshot_from(
                Some(":org.kwin"),
                Some(&publisher_identity(1)),
                1,
                super::Snapshot {
                    generation: "alpha".to_owned(),
                    revision: 1,
                    enabled: true,
                },
                0,
            ),
            Ok(())
        );

        let mut changed_identity = publisher_identity(1);
        changed_identity.process.start_tick = 2;
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":org.kwin"),
                    Some(&changed_identity),
                    1,
                    super::Snapshot {
                        generation: "alpha".to_owned(),
                        revision: 2,
                        enabled: false,
                    },
                    1,
                )
                .unwrap_err(),
            super::TrayError::UnauthorizedPublisher
        );

        state.owner_changed(Some(":org.new-kwin"));
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":org.kwin"),
                    Some(&publisher_identity(1)),
                    1,
                    super::Snapshot {
                        generation: "beta".to_owned(),
                        revision: 1,
                        enabled: false,
                    },
                    1,
                )
                .unwrap_err(),
            super::TrayError::UnauthorizedPublisher
        );
    }

    #[test]
    fn snapshot_acceptance_rejects_ambiguous_owner_identity() {
        let mut state = super::TrayState::default();
        state.owner_changed(Some("not-a-unique-name"));

        assert_eq!(
            state
                .publish_snapshot_from(
                    Some("not-a-unique-name"),
                    Some(&publisher_identity(1)),
                    1,
                    super::Snapshot {
                        generation: "alpha".to_owned(),
                        revision: 1,
                        enabled: true,
                    },
                    0,
                )
                .unwrap_err(),
            super::TrayError::UnauthorizedPublisher
        );
    }

    #[test]
    fn replacement_owner_must_reuse_the_trusted_kwin_executable_identity() {
        let mut state = super::TrayState::default();
        state.owner_changed(Some(":old.kwin"));
        let original = publisher_identity(1);
        state
            .publish_snapshot_from(
                Some(":old.kwin"),
                Some(&original),
                1,
                super::Snapshot {
                    generation: "alpha".to_owned(),
                    revision: 0,
                    enabled: true,
                },
                0,
            )
            .unwrap();

        state.owner_changed(Some(":replacement.kwin"));
        let mut replacement = publisher_identity(2);
        replacement.process.executable.content = b"replacement".to_vec();
        assert_eq!(
            state
                .publish_snapshot_from(
                    Some(":replacement.kwin"),
                    Some(&replacement),
                    1,
                    super::Snapshot {
                        generation: "beta".to_owned(),
                        revision: 0,
                        enabled: false,
                    },
                    1,
                )
                .unwrap_err(),
            super::TrayError::UnauthorizedPublisher
        );
    }

    #[test]
    fn owner_transition_waits_for_in_flight_publication_authorization() {
        let endpoint = super::TrayEndpoint::new(Some(":old.kwin"));
        let started = Arc::new(Barrier::new(2));
        let finished = Arc::new(AtomicBool::new(false));
        let worker_endpoint = endpoint.clone();
        let worker_started = Arc::clone(&started);
        let worker_finished = Arc::clone(&finished);
        let worker = thread::spawn(move || {
            worker_started.wait();
            worker_endpoint.owner_changed(Some(":new.kwin"));
            worker_finished.store(true, Ordering::Release);
        });

        let operation_guard = endpoint.operation_lock.lock_blocking();
        started.wait();
        thread::yield_now();
        assert!(!finished.load(Ordering::Acquire));
        drop(operation_guard);
        worker.join().unwrap();
        assert!(finished.load(Ordering::Acquire));
        assert_eq!(
            endpoint.state.lock().unwrap().owner.as_deref(),
            Some(":new.kwin")
        );

        let operation_guard = endpoint.operation_lock.lock_blocking();
        let before = endpoint.started.elapsed().as_millis() as u64;
        thread::sleep(Duration::from_millis(5));
        endpoint
            .publish_authenticated_snapshot(
                ":new.kwin",
                &publisher_identity(1),
                1,
                super::Snapshot {
                    generation: "alpha".to_owned(),
                    revision: 1,
                    enabled: true,
                },
            )
            .unwrap();
        drop(operation_guard);
        let refreshed_at = endpoint.state.lock().unwrap().view(before).refreshed_at;
        assert!(refreshed_at.is_some_and(|refreshed_at| refreshed_at > before));
    }

    #[test]
    fn watcher_registration_retry_is_bounded_and_retries_transient_failures() {
        let mut attempts = 0;
        let mut delays = 0;
        let result = retry_registration(
            || {
                attempts += 1;
                if attempts < 3 {
                    Err("transient")
                } else {
                    Ok(())
                }
            },
            || delays += 1,
        );

        assert_eq!(result, Ok(()));
        assert_eq!(attempts, 3);
        assert_eq!(delays, 2);

        attempts = 0;
        delays = 0;
        let result = retry_registration(
            || {
                attempts += 1;
                Err::<(), _>("permanent")
            },
            || delays += 1,
        );
        assert_eq!(result, Err("permanent"));
        assert_eq!(attempts, 3);
        assert_eq!(delays, 2);
    }

    #[test]
    fn watcher_loss_after_registration_returns_a_terminal_error_without_reregistering() {
        let mut registered_owner = Some(":watcher".to_owned());
        let mut registration_attempts = 0;
        let result = handle_watcher_owner_change(&mut registered_owner, None, |_| {
            registration_attempts += 1;
            Ok(())
        });

        let error = super::finish_watcher(result, Ok(()))
            .unwrap_err()
            .to_string();
        assert!(error.contains("ownership was lost"));
        assert_eq!(registered_owner, None);
        assert_eq!(registration_attempts, 0);
    }

    #[test]
    fn status_notifier_registration_uses_the_standard_watcher_contract() {
        let message = zbus::message::Message::method_call(
            STATUS_NOTIFIER_WATCHER_OBJECT,
            REGISTER_STATUS_NOTIFIER_ITEM,
        )
        .unwrap()
        .destination(STATUS_NOTIFIER_WATCHER_SERVICE)
        .unwrap()
        .interface(STATUS_NOTIFIER_WATCHER_INTERFACE)
        .unwrap()
        .build(&(SERVICE,))
        .unwrap();

        assert_eq!(
            message.header().destination().unwrap().to_string(),
            STATUS_NOTIFIER_WATCHER_SERVICE
        );
        assert_eq!(
            message.header().path().unwrap().to_string(),
            STATUS_NOTIFIER_WATCHER_OBJECT
        );
        assert_eq!(
            message.header().interface().unwrap().to_string(),
            STATUS_NOTIFIER_WATCHER_INTERFACE
        );
        assert_eq!(
            message.header().member().unwrap().to_string(),
            REGISTER_STATUS_NOTIFIER_ITEM
        );
        assert_eq!(message.body().signature().to_string(), "s");
        let body: (String,) = message.body().deserialize().unwrap();
        assert_eq!(body, (SERVICE.to_owned(),));
    }

    #[test]
    fn helper_name_request_contract_disallows_replacement_and_queueing() {
        let flags = zbus::fdo::RequestNameFlags::DoNotQueue as u32;
        assert_eq!(flags, 0x04);
        assert_eq!(flags & (0x01 | 0x02), 0);
    }

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
