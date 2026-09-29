use std::collections::HashMap;
use std::future::Future;
use std::io;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use zbus::object_server::SignalEmitter;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, StructureBuilder, Type, Value};

use crate::tray_endpoint::{
    TrayState, emit_tray_diag, lock_tray_state, menu_projected_line, status_projected_line,
};

pub const STATUS_NOTIFIER_ITEM_OBJECT: &str = "/StatusNotifierItem";
pub const MENU_OBJECT: &str = "/Menu";
pub const ICON_NAME: &str = "plasma-auto-tiler";
pub const ICON_PIXMAP_WIDTH: i32 = 32;
pub const ICON_PIXMAP_HEIGHT: i32 = 32;
pub const TOOLTIP_TITLE: &str = "Plasma Auto Tiler";
const STATUS_NOTIFIER_ITEM_INTERFACE: &str = "org.kde.StatusNotifierItem";
const DBUS_PROPERTIES_INTERFACE: &str = "org.freedesktop.DBus.Properties";
const DBUS_MENU_INTERFACE: &str = "com.canonical.dbusmenu";
const NEW_STATUS_SIGNAL: &str = "NewStatus";
const NEW_OVERLAY_ICON_SIGNAL: &str = "NewOverlayIcon";
const PROPERTIES_CHANGED_SIGNAL: &str = "PropertiesChanged";
const LAYOUT_UPDATED_SIGNAL: &str = "LayoutUpdated";
const SETTINGS_EXECUTABLE: Option<&str> = option_env!("PLASMA_AUTO_TILER_KCMSHELL6");
const SETTINGS_MODULE: &str = "kwin/effects/configs/plasma-auto-tiler-active-border_config";

#[derive(Debug)]
enum SettingsLaunchError {
    Check(io::Error),
    Spawn(io::Error),
}

#[derive(Debug, PartialEq, Eq)]
enum SettingsLaunchOutcome {
    AlreadyOpen,
    Launched,
}

fn settings_outcome_line(outcome: &str) -> String {
    format!(
        "plasma-auto-tiler:route-diag component=tray-endpoint stage=settings event=open outcome={outcome}"
    )
}

fn launch_settings_if_idle<Process, Status, Check, Launch>(
    process: &mut Option<Process>,
    mut check: Check,
    launch: Launch,
) -> Result<SettingsLaunchOutcome, SettingsLaunchError>
where
    Check: FnMut(&mut Process) -> io::Result<Option<Status>>,
    Launch: FnOnce() -> io::Result<Process>,
{
    if let Some(child) = process.as_mut() {
        if check(child).map_err(SettingsLaunchError::Check)?.is_none() {
            return Ok(SettingsLaunchOutcome::AlreadyOpen);
        }
        *process = None;
    }

    *process = Some(launch().map_err(SettingsLaunchError::Spawn)?);
    Ok(SettingsLaunchOutcome::Launched)
}

fn settings_command_for(executable: Option<&str>) -> Option<Command> {
    let executable = executable.filter(|path| std::path::Path::new(path).is_absolute())?;
    let mut command = Command::new(executable);
    command.arg(SETTINGS_MODULE);
    Some(command)
}

/// Project-owned keyless KWin action for the current-workspace tiling toggle.
/// Registered by the KWin script with an empty key sequence (KWin 6.7.5
/// `src/scripting/scripting.cpp` keyless registration); invoked by the tray
/// over KGlobalAccel, never by a physical key.
pub const WORKSPACE_TOGGLE_ACTION: &str = "plasma-auto-tiler-toggle-workspace-tiling";
/// KGlobalAccel service/path/interface for shortcut invocation. The tray
/// resolves the `kwin` component via `getComponent` on `/kglobalaccel`, then
/// calls `Component.invokeShortcut(action, "default")`. That method returns
/// void even for a missing action, so dispatch is fire-and-forget: no receipt
/// proves the toggle applied, and the menu waits for the next KWin-published
/// snapshot rather than assuming it did.
pub const KGLOBALACCEL_SERVICE: &str = "org.kde.kglobalaccel";
pub const KGLOBALACCEL_PATH: &str = "/kglobalaccel";
pub const KGLOBALACCEL_IFACE: &str = "org.kde.KGlobalAccel";
pub const KGLOBALACCEL_GET_COMPONENT: &str = "getComponent";
pub const KGLOBALACCEL_COMPONENT_IFACE: &str = "org.kde.kglobalaccel.Component";
pub const KGLOBALACCEL_INVOKE: &str = "invokeShortcut";
pub const KGLOBALACCEL_COMPONENT: &str = "kwin";
pub const KGLOBALACCEL_CONTEXT: &str = "default";

/// Persisted new-workspace default: `kwinrc [Script-plasma-auto-tiler-kwin]
/// defaultTiled`, default true. Written through KConfig-compatible
/// `kwriteconfig6` (host Plasma runtime tool, no new dependency) and applied
/// via the existing KWin `org.kde.KWin /KWin reconfigure` route. KWin
/// declares `reconfigure` as `Q_NOREPLY void` (`src/dbusinterface.h`), so the
/// tray sends it with the D-Bus `NoReplyExpected` flag and never waits for a
/// reply: `sent-unconfirmed` means the send succeeded, not that KWin applied
/// it. KWin publishes the actual default on the next snapshot after
/// `configChanged`.
pub const KWINRC_GROUP: &str = "Script-plasma-auto-tiler-kwin";
pub const DEFAULT_TILED_KEY: &str = "defaultTiled";
pub const KWRITECONFIG_EXECUTABLE: &str = "kwriteconfig6";
/// Nix-baked absolute `kwriteconfig6` for immutable packaging. `None` in dev,
/// where the `PATH` fallback above is used.
const KWRITECONFIG_BAKED: Option<&str> = option_env!("PLASMA_AUTO_TILER_KWRITECONFIG6");
pub const KWIN_RECONFIGURE_SERVICE: &str = "org.kde.KWin";
pub const KWIN_RECONFIGURE_PATH: &str = "/KWin";
pub const KWIN_RECONFIGURE_IFACE: &str = "org.kde.KWin";
pub const KWIN_RECONFIGURE_METHOD: &str = "reconfigure";

/// DBusMenu item ids. Status (2) and Settings (1) retain their existing ids;
/// new ids follow.
pub const MENU_ID_SETTINGS: i32 = 1;
pub const MENU_ID_STATUS: i32 = 2;
pub const MENU_ID_TILE_TOGGLE: i32 = 3;
pub const MENU_ID_DEFAULT_HEADING: i32 = 4;
pub const MENU_ID_DEFAULT_TILED: i32 = 5;
pub const MENU_ID_DEFAULT_FLOATING: i32 = 6;
pub const MENU_ID_CONFLICT: i32 = 7;
pub const CONFLICT_LABEL: &str = "Conflicting KDE settings...";
/// Idiomatic KDE/Freedesktop warning overlay for the SNI `OverlayIconName`
/// while the `[Windows]` edge settings conflict. Empty otherwise.
pub const OVERLAY_ICON_WARNING: &str = "dialog-warning";

fn toggle_outcome_line(outcome: &str) -> String {
    format!(
        "plasma-auto-tiler:route-diag component=tray-endpoint stage=toggle event=invoke outcome={outcome}"
    )
}

/// Conflict transition record: once per change on success, silent otherwise.
fn conflict_projected_line(conflict: bool) -> String {
    format!(
        "plasma-auto-tiler:route-diag component=tray-endpoint stage=projection event=projected outcome=conflict-updated conflict={conflict}"
    )
}

fn default_outcome_line(stage: &str, outcome: &str, default_tiled: bool) -> String {
    format!(
        "plasma-auto-tiler:route-diag component=tray-endpoint stage={stage} event=persist outcome={outcome} defaultTiled={default_tiled}"
    )
}

/// KConfig-compatible `kwriteconfig6` argv for the persisted default. Returns
/// the full argv (including executable) for call-shape tests; the caller
/// spawns it.
fn kwriteconfig_argv(default_tiled: bool) -> Vec<String> {
    kwriteconfig_argv_for(kwriteconfig_executable(), default_tiled)
}

/// Nix-baked absolute writer when available, otherwise the dev `PATH`
/// `kwriteconfig6`. A relative baked value is rejected to the fallback so a
/// hostile `PATH`-relative build env cannot redirect the write.
fn kwriteconfig_executable() -> &'static str {
    KWRITECONFIG_BAKED
        .filter(|path| std::path::Path::new(path).is_absolute())
        .unwrap_or(KWRITECONFIG_EXECUTABLE)
}

fn kwriteconfig_argv_for(executable: &str, default_tiled: bool) -> Vec<String> {
    vec![
        executable.to_owned(),
        "--file".to_owned(),
        "kwinrc".to_owned(),
        "--group".to_owned(),
        KWINRC_GROUP.to_owned(),
        "--key".to_owned(),
        DEFAULT_TILED_KEY.to_owned(),
        if default_tiled { "true" } else { "false" }.to_owned(),
    ]
}

/// Host-conflict detection for `kwinrc [Windows]` edge settings. Read-only.
/// Other owner: `kwin/native-effect/unifiedsettings_module.cpp`.
pub const WINDOW_CONFLICT_GROUP: &str = "Windows";
pub const KREADCONFIG_EXECUTABLE: &str = "kreadconfig6";
const KREADCONFIG_BAKED: Option<&str> = option_env!("PLASMA_AUTO_TILER_KREADCONFIG6");

fn kreadconfig_executable() -> &'static str {
    KREADCONFIG_BAKED
        .filter(|path| std::path::Path::new(path).is_absolute())
        .unwrap_or(KREADCONFIG_EXECUTABLE)
}

fn read_kwin_bool(key: &str, default: bool) -> Option<bool> {
    let status = std::process::Command::new(kreadconfig_executable())
        .args([
            "--file",
            "kwinrc",
            "--group",
            WINDOW_CONFLICT_GROUP,
            "--key",
            key,
            "--type",
            "bool",
            "--default",
            if default { "true" } else { "false" },
            "--include-globals",
        ])
        .status()
        .ok()?;
    match status.code() {
        Some(0) => Some(true),
        Some(1) => Some(false),
        _ => None,
    }
}

fn read_kwin_int(key: &str, default: i64) -> Option<i64> {
    let output = std::process::Command::new(kreadconfig_executable())
        .args([
            "--file",
            "kwinrc",
            "--group",
            WINDOW_CONFLICT_GROUP,
            "--key",
            key,
            "--default",
            &default.to_string(),
            "--include-globals",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()?.trim().parse().ok()
}

/// Effective `[Windows]` conflict: `Some(true)` on conflict, `Some(false)`
/// when all match, `None` when unavailable.
pub fn read_window_conflicts() -> Option<bool> {
    Some(
        read_kwin_bool("ElectricBorderTiling", true)?
            || read_kwin_bool("ElectricBorderMaximize", true)?
            || read_kwin_int("ElectricBorders", 0)? != 0,
    )
}

/// Real KGlobalAccel toggle dispatch: resolve the `kwin` component, then
/// invoke the keyless toggle action. Fire-and-forget; any transport failure
/// is a fixed redacted label, never raw D-Bus detail.
fn invoke_kglobalaccel_toggle() -> Result<(), &'static str> {
    let connection = zbus::blocking::Connection::session().map_err(|_| "invoke-failed")?;
    let component: zbus::zvariant::OwnedObjectPath = connection
        .call_method(
            Some(KGLOBALACCEL_SERVICE),
            KGLOBALACCEL_PATH,
            Some(KGLOBALACCEL_IFACE),
            KGLOBALACCEL_GET_COMPONENT,
            &(KGLOBALACCEL_COMPONENT,),
        )
        .map_err(|_| "resolve-failed")?
        .body()
        .deserialize()
        .map_err(|_| "resolve-failed")?;
    connection
        .call_method(
            Some(KGLOBALACCEL_SERVICE),
            component.as_str(),
            Some(KGLOBALACCEL_COMPONENT_IFACE),
            KGLOBALACCEL_INVOKE,
            &(WORKSPACE_TOGGLE_ACTION, KGLOBALACCEL_CONTEXT),
        )
        .map_err(|_| "invoke-failed")?;
    Ok(())
}

/// Build the no-reply KWin reconfigure message: `Q_NOREPLY void reconfigure`
/// (`src/dbusinterface.h`) never sends a reply, so zbus 5.19
/// `blocking::Connection::call_method` (which registers a pending call and
/// waits) would hang until the bus times out. The `NoReplyExpected` flag
/// sends fire-and-forget via `Connection::send` and returns after the send.
fn reconfigure_noreply_message() -> zbus::Result<zbus::message::Message> {
    zbus::message::Message::method_call(KWIN_RECONFIGURE_PATH, KWIN_RECONFIGURE_METHOD)?
        .destination(KWIN_RECONFIGURE_SERVICE)?
        .interface(KWIN_RECONFIGURE_IFACE)?
        .with_flags(zbus::message::Flags::NoReplyExpected)?
        .build(&())
}

/// Real default persistence: `kwriteconfig6` write, then KWin reconfigure
/// no-reply send. Returns the write outcome and the reconfigure send outcome
/// separately so the caller logs `sent-unconfirmed` (send succeeded, not
/// applied proof) distinctly from failure. Application is confirmed only by
/// the next KWin snapshot after `configChanged`.
fn persist_default_tiled(
    default_tiled: bool,
) -> (Result<(), &'static str>, Result<(), &'static str>) {
    let argv = kwriteconfig_argv(default_tiled);
    let write = std::process::Command::new(&argv[0])
        .args(&argv[1..])
        .status()
        .map(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("write-failed")
            }
        })
        .unwrap_or(Err("write-failed"));
    if write.is_err() {
        return (write, Err("reconfigure-skipped"));
    }
    let reconfigure = zbus::blocking::Connection::session()
        .map_err(|_| "reconfigure-failed")
        .and_then(|connection| {
            reconfigure_noreply_message()
                .map_err(|_| "reconfigure-failed")
                .and_then(|message| connection.send(&message).map_err(|_| "reconfigure-failed"))
        });
    (Ok(()), reconfigure)
}

pub fn icon_pixmap_bytes() -> Vec<u8> {
    let width = ICON_PIXMAP_WIDTH as usize;
    let height = ICON_PIXMAP_HEIGHT as usize;
    let mut bytes = Vec::with_capacity(width * height * 4);
    for y in 0..height {
        for x in 0..width {
            let border = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
            let v_divider = (x == width / 2 - 1 || x == width / 2) && y >= 2 && y < height - 2;
            let h_divider = (y == height / 2 - 1 || y == height / 2) && x >= 2 && x < width - 2;
            let (r, g, b) = if border || v_divider || h_divider {
                (0x7F, 0xB4, 0xD8)
            } else if x < width / 2 && y < height / 2 {
                (0xE6, 0x7E, 0x22)
            } else {
                (0x1E, 0x2A, 0x38)
            };
            bytes.extend_from_slice(&[0xFF, r, g, b]);
        }
    }
    bytes
}

pub fn icon_pixmap() -> Vec<(i32, i32, Vec<u8>)> {
    vec![(ICON_PIXMAP_WIDTH, ICON_PIXMAP_HEIGHT, icon_pixmap_bytes())]
}

fn owned_tooltip(label: &str) -> OwnedValue {
    StructureBuilder::new()
        .add_field(ICON_NAME)
        .add_field(icon_pixmap())
        .add_field(TOOLTIP_TITLE)
        .add_field(label)
        .build()
        .expect("tooltip is representable on D-Bus")
        .try_into()
        .expect("tooltip value is owned")
}

fn menu_status(status: &str) -> &'static str {
    if status == "NeedsAttention" {
        "notice"
    } else {
        "normal"
    }
}

/// Row P: bounded emission deadline. zbus 5.19 `emit_signal` has no timeout
/// (`method_timeout` defaults to `None`), so the four-signal block below runs
/// under this single deadline on the project async-io reactor (the same
/// executor `zbus::block_on` drives). On expiry the block future is dropped,
/// the notification lock releases, and the status stays unremembered.
pub(crate) const NOTIFICATION_TIMEOUT: Duration = Duration::from_secs(2);

async fn with_emit_deadline<T>(
    timeout: Duration,
    send: impl Future<Output = zbus::Result<T>>,
) -> zbus::Result<T> {
    use std::pin::pin;
    use std::task::Poll;
    let mut send = pin!(send);
    let mut timer = pin!(async_io::Timer::after(timeout));
    // Prefer the signal block when both are ready on the same poll; a timer
    // win drops `send` (cancelling the hung emit) via the returned `None`.
    std::future::poll_fn(|cx| {
        if let Poll::Ready(value) = send.as_mut().poll(cx) {
            return Poll::Ready(Some(value));
        }
        if timer.as_mut().poll(cx).is_ready() {
            return Poll::Ready(None);
        }
        Poll::Pending
    })
    .await
    .unwrap_or(Err(zbus::Error::Failure(
        "tray notification timed out".to_owned(),
    )))
}

/// Row Q: lock a poisoned `Option` cache, recovering at the boundary
/// instead of panicking. Recovery discards the cached value (forcing one
/// fresh re-emission or spawn) rather than trusting it.
fn lock_poisoned_option<T>(mutex: &Mutex<Option<T>>) -> std::sync::MutexGuard<'_, Option<T>> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poison) => {
            let mut guard = poison.into_inner();
            *guard = None;
            mutex.clear_poison();
            guard
        }
    }
}

#[derive(Clone, Debug)]
pub struct TrayProjection {
    state: Arc<Mutex<TrayState>>,
    started: Instant,
    last_status: Arc<Mutex<Option<String>>>,
    last_menu: Arc<Mutex<Option<(String, bool, bool)>>>,
    conflict: Arc<AtomicBool>,
    last_conflict: Arc<Mutex<Option<bool>>>,
    notification_lock: Arc<async_lock::Mutex<()>>,
    menu_revision: Arc<AtomicU32>,
    settings_process: Arc<Mutex<Option<Child>>>,
}

impl TrayProjection {
    #[cfg(test)]
    pub(crate) fn new(state: Arc<Mutex<TrayState>>, started: Instant) -> Self {
        Self::with_last_status(state, started, Arc::new(Mutex::new(None)))
    }

    pub(crate) fn with_last_status(
        state: Arc<Mutex<TrayState>>,
        started: Instant,
        last_status: Arc<Mutex<Option<String>>>,
    ) -> Self {
        Self {
            state,
            started,
            last_status,
            last_menu: Arc::new(Mutex::new(None)),
            conflict: Arc::new(AtomicBool::new(false)),
            // Clean startup already agrees with no-warning: a first
            // `Some(false)` stays silent, while an initial `true` logs once.
            last_conflict: Arc::new(Mutex::new(Some(false))),
            notification_lock: Arc::new(async_lock::Mutex::new(())),
            menu_revision: Arc::new(AtomicU32::new(0)),
            settings_process: Arc::new(Mutex::new(None)),
        }
    }

    /// Latest `[Windows]` conflict from the caller. Pure store; emission and
    /// logging stay change-driven in `emit_guarded`.
    pub fn set_conflict(&self, conflict: bool) {
        self.conflict.store(conflict, Ordering::Relaxed);
    }

    pub(crate) fn launch_settings(&self) -> zbus::fdo::Result<()> {
        self.launch_settings_with(SETTINGS_EXECUTABLE, emit_tray_diag)
    }

    fn launch_settings_with(
        &self,
        executable: Option<&str>,
        diag: impl FnOnce(&str),
    ) -> zbus::fdo::Result<()> {
        let mut settings = match settings_command_for(executable) {
            Some(command) => command,
            None => {
                diag(&settings_outcome_line("unavailable"));
                return Err(zbus::fdo::Error::Failed(
                    "Settings launcher is unavailable: baked absolute kcmshell6 path is missing"
                        .to_owned(),
                ));
            }
        };
        let result = {
            let mut process = self.lock_settings_process();
            launch_settings_if_idle(&mut process, |child| child.try_wait(), || settings.spawn())
        };
        match result {
            Ok(SettingsLaunchOutcome::AlreadyOpen) => {
                diag(&settings_outcome_line("already-open"));
                Ok(())
            }
            Ok(SettingsLaunchOutcome::Launched) => {
                diag(&settings_outcome_line("launched"));
                Ok(())
            }
            Err(SettingsLaunchError::Check(error)) => {
                diag(&settings_outcome_line("check-failed"));
                Err(zbus::fdo::Error::Failed(format!(
                    "check Settings process: {error}"
                )))
            }
            Err(SettingsLaunchError::Spawn(error)) => {
                diag(&settings_outcome_line("spawn-failed"));
                Err(zbus::fdo::Error::Failed(format!("open Settings: {error}")))
            }
        }
    }

    /// Fresh workspace menu state. `None` when stale/absent so the menu
    /// never projects a wrong checkmark.
    fn fresh_workspace_state(&self) -> Option<(bool, bool)> {
        let view = self.view();
        if !view.current {
            return None;
        }
        let snapshot = view.snapshot?;
        Some((snapshot.tiled, snapshot.default_tiled))
    }

    fn tile_toggle_checked(&self) -> bool {
        self.has_fresh_workspace_scope()
            && self.fresh_workspace_state().is_some_and(|(tiled, _)| tiled)
    }

    fn tile_toggle_enabled(&self) -> bool {
        self.has_fresh_workspace_scope()
    }

    /// Fresh non-empty scope gate for the toggle only.
    fn has_fresh_workspace_scope(&self) -> bool {
        let view = self.view();
        view.current
            && view
                .snapshot
                .as_ref()
                .is_some_and(|snapshot| !snapshot.current_scope.is_empty())
    }

    fn default_radio_enabled(&self) -> bool {
        self.fresh_workspace_state().is_some()
    }

    fn default_tiled_checked(&self) -> bool {
        self.fresh_workspace_state()
            .is_some_and(|(_, default_tiled)| default_tiled)
    }

    fn default_floating_checked(&self) -> bool {
        self.fresh_workspace_state()
            .is_some_and(|(_, default_tiled)| !default_tiled)
    }

    pub(crate) fn request_toggle(&self) -> zbus::fdo::Result<()> {
        self.request_toggle_with(invoke_kglobalaccel_toggle, emit_tray_diag)
    }

    fn request_toggle_with(
        &self,
        invoke: impl FnOnce() -> Result<(), &'static str>,
        mut diag: impl FnMut(&str),
    ) -> zbus::fdo::Result<()> {
        // One fire-and-forget dispatch per click; the menu waits for the next
        // fresh snapshot. Stale or empty scope refuses.
        if !self.has_fresh_workspace_scope() {
            diag(&toggle_outcome_line("stale-refused"));
            return Err(zbus::fdo::Error::Failed(
                "workspace state is stale; toggle refused".to_owned(),
            ));
        }
        diag(&toggle_outcome_line("intent"));
        match invoke() {
            Ok(()) => {
                // Sent, not applied: void reply even for a missing action.
                diag(&toggle_outcome_line("sent-unconfirmed"));
                Ok(())
            }
            Err(reason) => {
                diag(&toggle_outcome_line(reason));
                Err(zbus::fdo::Error::Failed(
                    "workspace toggle dispatch failed".to_owned(),
                ))
            }
        }
    }

    pub(crate) fn request_default(&self, default_tiled: bool) -> zbus::fdo::Result<()> {
        self.request_default_with(default_tiled, persist_default_tiled, emit_tray_diag)
    }

    fn request_default_with(
        &self,
        default_tiled: bool,
        persist: impl FnOnce(bool) -> (Result<(), &'static str>, Result<(), &'static str>),
        mut diag: impl FnMut(&str),
    ) -> zbus::fdo::Result<()> {
        // No optimistic flip: KWin publishes the default after configChanged.
        diag(&default_outcome_line("persist", "intent", default_tiled));
        let (write, reconfigure) = persist(default_tiled);
        match write {
            Ok(()) => {
                diag(&default_outcome_line("persist", "written", default_tiled));
            }
            Err(reason) => {
                diag(&default_outcome_line("persist", reason, default_tiled));
                return Err(zbus::fdo::Error::Failed("default write failed".to_owned()));
            }
        }
        match reconfigure {
            Ok(()) => {
                // Sent, not applied: the send succeeding never proves KWin applied it.
                diag(&default_outcome_line(
                    "reconfigure",
                    "sent-unconfirmed",
                    default_tiled,
                ));
                Ok(())
            }
            Err(reason) => {
                diag(&default_outcome_line("reconfigure", reason, default_tiled));
                // Write persisted; reconfigure failure keeps the click ok.
                Ok(())
            }
        }
    }

    pub fn status_notifier_item(&self) -> StatusNotifierItem {
        StatusNotifierItem {
            projection: self.clone(),
        }
    }

    pub fn menu(&self) -> DbusMenu {
        DbusMenu::new(self.clone())
    }

    fn lock_last_status(&self) -> std::sync::MutexGuard<'_, Option<String>> {
        lock_poisoned_option(&self.last_status)
    }

    fn lock_last_menu(&self) -> std::sync::MutexGuard<'_, Option<(String, bool, bool)>> {
        lock_poisoned_option(&self.last_menu)
    }

    fn lock_settings_process(&self) -> std::sync::MutexGuard<'_, Option<Child>> {
        lock_poisoned_option(&self.settings_process)
    }

    fn conflict_state(&self) -> bool {
        self.conflict.load(Ordering::Relaxed)
    }

    fn should_emit_conflict(&self, conflict: bool) -> bool {
        lock_poisoned_option(&self.last_conflict).as_ref() != Some(&conflict)
    }

    fn remember_conflict(&self, conflict: bool) {
        *lock_poisoned_option(&self.last_conflict) = Some(conflict);
    }

    fn overlay_icon_name_for(conflict: bool) -> &'static str {
        if conflict { OVERLAY_ICON_WARNING } else { "" }
    }

    fn view(&self) -> crate::tray_endpoint::StateView {
        let now_ms = self.started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        lock_tray_state(&self.state).view(now_ms)
    }

    fn status(&self) -> &'static str {
        let view = self.view();
        if view.current
            && view
                .snapshot
                .as_ref()
                .is_some_and(|snapshot| snapshot.enabled)
        {
            "Active"
        } else if view.current {
            "Passive"
        } else {
            "NeedsAttention"
        }
    }

    fn status_label_for(status: &str) -> &'static str {
        match status {
            "Active" => "Enabled",
            "Passive" => "Disabled",
            "NeedsAttention" => "Unavailable",
            _ => unreachable!("status has a fixed SNI value"),
        }
    }

    fn status_label(&self) -> &'static str {
        Self::status_label_for(self.status())
    }

    fn should_emit_status(&self, status: &str) -> bool {
        self.lock_last_status().as_deref() != Some(status)
    }

    fn remember_status(&self, status: String) {
        *self.lock_last_status() = Some(status);
    }

    /// Fresh menu fingerprint for LayoutUpdated idempotence: `None` when
    /// stale/absent, otherwise the live triple. Scope is never logged.
    fn menu_fingerprint(&self) -> Option<(String, bool, bool)> {
        let view = self.view();
        if !view.current {
            return None;
        }
        let snapshot = view.snapshot?;
        Some((
            snapshot.current_scope,
            snapshot.tiled,
            snapshot.default_tiled,
        ))
    }

    fn should_emit_menu(&self, fingerprint: &Option<(String, bool, bool)>) -> bool {
        *self.lock_last_menu() != *fingerprint
    }

    fn remember_menu(&self, fingerprint: Option<(String, bool, bool)>) {
        *self.lock_last_menu() = fingerprint;
    }

    fn sni_changed(&self, status: &str, conflict: bool) -> HashMap<String, OwnedValue> {
        let label = Self::status_label_for(status);
        let mut changed = HashMap::new();
        changed.insert("Status".to_owned(), owned_string(status));
        changed.insert(
            "Title".to_owned(),
            owned_string(&format!("Plasma Auto Tiler - {label}")),
        );
        changed.insert("IconName".to_owned(), owned_string(ICON_NAME));
        changed.insert(
            "OverlayIconName".to_owned(),
            owned_string(Self::overlay_icon_name_for(conflict)),
        );
        changed.insert("ToolTip".to_owned(), owned_tooltip(label));
        changed
    }

    /// Locked projection step for emission and tests: remembers status,
    /// menu, and conflict only on success; steady state stays silent.
    async fn emit_guarded<F, Fut>(&self, timeout: Duration, send: F) -> zbus::Result<()>
    where
        F: FnOnce(String, Option<(String, bool, bool)>, bool, bool, bool, bool) -> Fut,
        Fut: Future<Output = zbus::Result<()>>,
    {
        let _notification_guard = self.notification_lock.lock().await;
        let status = self.status().to_owned();
        let menu = self.menu_fingerprint();
        let conflict = self.conflict_state();
        let status_changed = self.should_emit_status(&status);
        let menu_changed = self.should_emit_menu(&menu);
        let conflict_changed = self.should_emit_conflict(conflict);
        if !status_changed && !menu_changed && !conflict_changed {
            return Ok(());
        }
        with_emit_deadline(
            timeout,
            send(
                status.clone(),
                menu.clone(),
                conflict,
                status_changed,
                menu_changed,
                conflict_changed,
            ),
        )
        .await?;

        // Best-effort projection lines for the emitted signals only.
        let status_line = status_changed.then(|| status_projected_line(&status));
        let menu_line = menu_changed.then(|| match &menu {
            Some((_, tiled, default_tiled)) => {
                menu_projected_line(*tiled, *default_tiled)
            }
            None => "plasma-auto-tiler:route-diag component=tray-endpoint stage=projection event=projected outcome=menu-updated stale=true"
                .to_string(),
        });
        let conflict_line = conflict_changed.then(|| conflict_projected_line(conflict));
        self.remember_status(status);
        self.remember_menu(menu);
        self.remember_conflict(conflict);
        drop(_notification_guard);
        if let Some(line) = status_line {
            emit_tray_diag(&line);
        }
        if let Some(line) = menu_line {
            emit_tray_diag(&line);
        }
        if let Some(line) = conflict_line {
            emit_tray_diag(&line);
        }
        Ok(())
    }

    pub async fn emit_changed(&self, connection: &zbus::Connection) -> zbus::Result<()> {
        // Status changes keep the SNI block; conflict changes add the overlay
        // block; menu-only changes emit LayoutUpdated alone.
        self.emit_guarded(
            NOTIFICATION_TIMEOUT,
            |status, _menu, conflict, status_changed, menu_changed, conflict_changed| async move {
                if status_changed {
                    let changed = self.sni_changed(&status, conflict);
                    connection
                        .emit_signal(
                            None::<&str>,
                            STATUS_NOTIFIER_ITEM_OBJECT,
                            DBUS_PROPERTIES_INTERFACE,
                            PROPERTIES_CHANGED_SIGNAL,
                            &(
                                STATUS_NOTIFIER_ITEM_INTERFACE,
                                changed,
                                Vec::<String>::new(),
                            ),
                        )
                        .await?;
                    let mut menu_status_changed = HashMap::new();
                    menu_status_changed
                        .insert("Status".to_owned(), owned_string(menu_status(&status)));
                    connection
                        .emit_signal(
                            None::<&str>,
                            MENU_OBJECT,
                            DBUS_PROPERTIES_INTERFACE,
                            PROPERTIES_CHANGED_SIGNAL,
                            &(
                                DBUS_MENU_INTERFACE,
                                menu_status_changed,
                                Vec::<String>::new(),
                            ),
                        )
                        .await?;
                    connection
                        .emit_signal(
                            None::<&str>,
                            STATUS_NOTIFIER_ITEM_OBJECT,
                            STATUS_NOTIFIER_ITEM_INTERFACE,
                            NEW_STATUS_SIGNAL,
                            &(status.as_str(),),
                        )
                        .await?;
                } else if conflict_changed {
                    let mut overlay_changed = HashMap::new();
                    overlay_changed.insert(
                        "OverlayIconName".to_owned(),
                        owned_string(Self::overlay_icon_name_for(conflict)),
                    );
                    connection
                        .emit_signal(
                            None::<&str>,
                            STATUS_NOTIFIER_ITEM_OBJECT,
                            DBUS_PROPERTIES_INTERFACE,
                            PROPERTIES_CHANGED_SIGNAL,
                            &(
                                STATUS_NOTIFIER_ITEM_INTERFACE,
                                overlay_changed,
                                Vec::<String>::new(),
                            ),
                        )
                        .await?;
                }
                if conflict_changed {
                    connection
                        .emit_signal(
                            None::<&str>,
                            STATUS_NOTIFIER_ITEM_OBJECT,
                            STATUS_NOTIFIER_ITEM_INTERFACE,
                            NEW_OVERLAY_ICON_SIGNAL,
                            &(),
                        )
                        .await?;
                }
                if status_changed || menu_changed || conflict_changed {
                    connection
                        .emit_signal(
                            None::<&str>,
                            MENU_OBJECT,
                            DBUS_MENU_INTERFACE,
                            LAYOUT_UPDATED_SIGNAL,
                            &(self.next_menu_revision(), 0_i32),
                        )
                        .await?;
                }
                Ok(())
            },
        )
        .await
    }

    fn next_menu_revision(&self) -> u32 {
        self.menu_revision
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1)
    }

    fn current_menu_revision(&self) -> u32 {
        self.menu_revision.load(Ordering::Relaxed)
    }
}

#[derive(Clone, Debug)]
pub struct StatusNotifierItem {
    projection: TrayProjection,
}

impl StatusNotifierItem {
    pub const OBJECT: &str = STATUS_NOTIFIER_ITEM_OBJECT;

    pub fn menu_path(&self) -> OwnedObjectPath {
        MENU_OBJECT.try_into().expect("static D-Bus object path")
    }
}

#[zbus::interface(name = "org.kde.StatusNotifierItem")]
impl StatusNotifierItem {
    #[zbus(property)]
    fn category(&self) -> &'static str {
        "SystemServices"
    }

    #[zbus(property)]
    fn id(&self) -> &'static str {
        "plasma-auto-tiler"
    }

    #[zbus(property)]
    fn title(&self) -> String {
        format!("Plasma Auto Tiler - {}", self.projection.status_label())
    }

    #[zbus(property)]
    fn status(&self) -> &'static str {
        self.projection.status()
    }

    #[zbus(property)]
    fn window_id(&self) -> i32 {
        0
    }

    #[zbus(property)]
    fn icon_name(&self) -> &'static str {
        ICON_NAME
    }

    #[zbus(property)]
    fn icon_pixmap(&self) -> Vec<(i32, i32, Vec<u8>)> {
        icon_pixmap()
    }

    #[zbus(property)]
    fn overlay_icon_name(&self) -> &'static str {
        TrayProjection::overlay_icon_name_for(self.projection.conflict_state())
    }

    #[zbus(property)]
    fn overlay_icon_pixmap(&self) -> Vec<(i32, i32, Vec<u8>)> {
        Vec::new()
    }

    #[zbus(property)]
    fn attention_icon_name(&self) -> &'static str {
        ""
    }

    #[zbus(property)]
    fn attention_icon_pixmap(&self) -> Vec<(i32, i32, Vec<u8>)> {
        Vec::new()
    }

    #[zbus(property)]
    fn attention_movie_name(&self) -> &'static str {
        ""
    }

    #[zbus(property)]
    #[allow(clippy::type_complexity)]
    fn tool_tip(&self) -> (String, Vec<(i32, i32, Vec<u8>)>, String, String) {
        (
            ICON_NAME.to_owned(),
            icon_pixmap(),
            TOOLTIP_TITLE.to_owned(),
            self.projection.status_label().to_owned(),
        )
    }

    #[zbus(property)]
    fn item_is_menu(&self) -> bool {
        // Left-click opens the menu; Activate stays a no-op.
        true
    }

    #[zbus(property, name = "Menu")]
    fn menu(&self) -> OwnedObjectPath {
        self.menu_path()
    }

    fn activate(&self, _x: i32, _y: i32) -> zbus::fdo::Result<()> {
        Ok(())
    }

    fn secondary_activate(&self, _x: i32, _y: i32) {}

    fn context_menu(&self, _x: i32, _y: i32) {}

    fn scroll(&self, _delta: i32, _orientation: &str) {}

    #[zbus(signal)]
    async fn new_status(emitter: SignalEmitter<'_>, status: &str) -> zbus::Result<()>;

    #[zbus(signal)]
    async fn new_overlay_icon(emitter: SignalEmitter<'_>) -> zbus::Result<()>;
}

#[derive(Clone, Debug, Serialize, Type)]
pub struct MenuLayout {
    pub id: i32,
    pub properties: HashMap<String, OwnedValue>,
    pub children: Vec<OwnedValue>,
}

#[derive(Clone, Debug)]
pub struct DbusMenu {
    projection: TrayProjection,
}

impl DbusMenu {
    pub const OBJECT: &str = MENU_OBJECT;

    pub(crate) fn new(projection: TrayProjection) -> Self {
        Self { projection }
    }

    pub fn layout(&self) -> MenuLayout {
        MenuLayout {
            id: 0,
            properties: HashMap::new(),
            children: vec![
                menu_value(self.conflict_item()),
                menu_value(self.status_item()),
                menu_value(self.tile_toggle_item()),
                menu_value(self.default_heading_item()),
                menu_value(self.default_tiled_item()),
                menu_value(self.default_floating_item()),
                menu_value(self.menu_item()),
            ],
        }
    }

    fn conflict_item(&self) -> MenuLayout {
        let conflict = self.projection.conflict_state();
        MenuLayout {
            id: MENU_ID_CONFLICT,
            properties: HashMap::from([
                ("label".to_owned(), owned_string(CONFLICT_LABEL)),
                ("enabled".to_owned(), OwnedValue::from(true)),
                ("visible".to_owned(), OwnedValue::from(conflict)),
            ]),
            children: Vec::new(),
        }
    }

    fn status_item(&self) -> MenuLayout {
        MenuLayout {
            id: MENU_ID_STATUS,
            properties: HashMap::from([
                (
                    "label".to_owned(),
                    owned_string(self.projection.status_label()),
                ),
                ("enabled".to_owned(), OwnedValue::from(false)),
                ("visible".to_owned(), OwnedValue::from(true)),
            ]),
            children: Vec::new(),
        }
    }

    fn tile_toggle_item(&self) -> MenuLayout {
        let checked = self.projection.tile_toggle_checked();
        let enabled = self.projection.tile_toggle_enabled();
        MenuLayout {
            id: MENU_ID_TILE_TOGGLE,
            properties: HashMap::from([
                ("label".to_owned(), owned_string("Tile current workspace")),
                ("enabled".to_owned(), OwnedValue::from(enabled)),
                ("visible".to_owned(), OwnedValue::from(true)),
                ("toggle-type".to_owned(), owned_string("checkmark")),
                (
                    "toggle-state".to_owned(),
                    OwnedValue::from(if checked { 1_i32 } else { 0_i32 }),
                ),
            ]),
            children: Vec::new(),
        }
    }

    fn default_heading_item(&self) -> MenuLayout {
        MenuLayout {
            id: MENU_ID_DEFAULT_HEADING,
            properties: HashMap::from([
                ("label".to_owned(), owned_string("New workspace behavior")),
                ("enabled".to_owned(), OwnedValue::from(false)),
                ("visible".to_owned(), OwnedValue::from(true)),
            ]),
            children: Vec::new(),
        }
    }

    fn default_tiled_item(&self) -> MenuLayout {
        let checked = self.projection.default_tiled_checked();
        let enabled = self.projection.default_radio_enabled();
        MenuLayout {
            id: MENU_ID_DEFAULT_TILED,
            properties: HashMap::from([
                ("label".to_owned(), owned_string("Tiled")),
                ("enabled".to_owned(), OwnedValue::from(enabled)),
                ("visible".to_owned(), OwnedValue::from(true)),
                ("toggle-type".to_owned(), owned_string("radio")),
                (
                    "toggle-state".to_owned(),
                    OwnedValue::from(if checked { 1_i32 } else { 0_i32 }),
                ),
            ]),
            children: Vec::new(),
        }
    }

    fn default_floating_item(&self) -> MenuLayout {
        let checked = self.projection.default_floating_checked();
        let enabled = self.projection.default_radio_enabled();
        MenuLayout {
            id: MENU_ID_DEFAULT_FLOATING,
            properties: HashMap::from([
                ("label".to_owned(), owned_string("Floating")),
                ("enabled".to_owned(), OwnedValue::from(enabled)),
                ("visible".to_owned(), OwnedValue::from(true)),
                ("toggle-type".to_owned(), owned_string("radio")),
                (
                    "toggle-state".to_owned(),
                    OwnedValue::from(if checked { 1_i32 } else { 0_i32 }),
                ),
            ]),
            children: Vec::new(),
        }
    }

    fn menu_item(&self) -> MenuLayout {
        MenuLayout {
            id: MENU_ID_SETTINGS,
            properties: HashMap::from([
                ("label".to_owned(), owned_string("Settings")),
                ("enabled".to_owned(), OwnedValue::from(true)),
                ("visible".to_owned(), OwnedValue::from(true)),
            ]),
            children: Vec::new(),
        }
    }
}

fn is_menu_event(id: i32, event_id: &str) -> bool {
    event_id == "clicked"
        && matches!(
            id,
            MENU_ID_SETTINGS
                | MENU_ID_CONFLICT
                | MENU_ID_TILE_TOGGLE
                | MENU_ID_DEFAULT_TILED
                | MENU_ID_DEFAULT_FLOATING
        )
}

#[zbus::interface(name = "com.canonical.dbusmenu")]
impl DbusMenu {
    #[zbus(property)]
    fn version(&self) -> u32 {
        3
    }

    #[zbus(property)]
    fn text_direction(&self) -> &'static str {
        "ltr"
    }

    #[zbus(property)]
    fn status(&self) -> &'static str {
        menu_status(self.projection.status())
    }

    #[zbus(property)]
    fn icon_theme_path(&self) -> Vec<String> {
        Vec::new()
    }

    fn get_layout(
        &self,
        parent_id: i32,
        recursion_depth: i32,
        _property_names: Vec<String>,
    ) -> zbus::fdo::Result<(u32, MenuLayout)> {
        let mut layout = match parent_id {
            0 => self.layout(),
            MENU_ID_SETTINGS => self.menu_item(),
            MENU_ID_CONFLICT => self.conflict_item(),
            MENU_ID_STATUS => self.status_item(),
            MENU_ID_TILE_TOGGLE => self.tile_toggle_item(),
            MENU_ID_DEFAULT_HEADING => self.default_heading_item(),
            MENU_ID_DEFAULT_TILED => self.default_tiled_item(),
            MENU_ID_DEFAULT_FLOATING => self.default_floating_item(),
            _ => return Err(zbus::fdo::Error::Failed("unknown menu item".to_owned())),
        };
        if recursion_depth == 0 {
            layout.children.clear();
        }
        Ok((self.projection.current_menu_revision(), layout))
    }

    fn event(
        &self,
        id: i32,
        event_id: &str,
        _data: OwnedValue,
        _timestamp: u32,
    ) -> zbus::fdo::Result<()> {
        if !is_menu_event(id, event_id) {
            return Ok(());
        }
        match id {
            MENU_ID_SETTINGS => self.projection.launch_settings(),
            MENU_ID_CONFLICT => {
                // The row is hidden without conflict; ignore stray clicks.
                if !self.projection.conflict_state() {
                    return Ok(());
                }
                self.projection.launch_settings()
            }
            MENU_ID_TILE_TOGGLE => self.projection.request_toggle(),
            MENU_ID_DEFAULT_TILED => self.projection.request_default(true),
            MENU_ID_DEFAULT_FLOATING => self.projection.request_default(false),
            _ => Ok(()),
        }
    }

    fn about_to_show(&self, _id: i32) -> bool {
        false
    }

    #[zbus(signal)]
    async fn layout_updated(
        emitter: SignalEmitter<'_>,
        revision: u32,
        parent_id: i32,
    ) -> zbus::Result<()>;
}

fn menu_value(layout: MenuLayout) -> OwnedValue {
    StructureBuilder::new()
        .add_field(layout.id)
        .add_field(layout.properties)
        .add_field(layout.children)
        .build()
        .expect("menu layout is representable on D-Bus")
        .try_into()
        .expect("menu layout value is owned")
}

fn owned_string(value: &str) -> OwnedValue {
    Value::from(value.to_owned())
        .try_into()
        .expect("menu string value is owned")
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use crate::tray_endpoint::FRESHNESS_MS;

    use super::*;

    type IconPixmap = Vec<(i32, i32, Vec<u8>)>;
    type ToolTip = (String, IconPixmap, String, String);

    fn projection(enabled: Option<bool>, started: Instant) -> TrayProjection {
        projection_full(enabled, Some(true), Some(true), started)
    }

    fn projection_full(
        enabled: Option<bool>,
        tiled: Option<bool>,
        default_tiled: Option<bool>,
        started: Instant,
    ) -> TrayProjection {
        let state = Arc::new(Mutex::new(TrayState::default()));
        let mut guard = state.lock().unwrap();
        guard.owner_changed(Some(":kwin"));
        if let (Some(enabled), Some(tiled), Some(default_tiled)) = (enabled, tiled, default_tiled) {
            guard
                .publish_snapshot(
                    2,
                    "generation".to_owned(),
                    0,
                    enabled,
                    "ws-1".to_owned(),
                    tiled,
                    default_tiled,
                    0,
                )
                .unwrap();
        }
        drop(guard);
        TrayProjection::new(state, started)
    }

    #[test]
    fn status_follows_fresh_endpoint_state() {
        let enabled = projection(Some(true), Instant::now());
        assert_eq!(enabled.status(), "Active");

        let disabled = projection(Some(false), Instant::now());
        assert_eq!(disabled.status(), "Passive");

        let absent = projection(None, Instant::now());
        assert_eq!(absent.status(), "NeedsAttention");
    }

    #[test]
    fn stale_endpoint_state_is_passive_and_unavailable() {
        let started = Instant::now() - Duration::from_millis(FRESHNESS_MS);
        let stale = projection(Some(true), started);
        assert_eq!(stale.status(), "NeedsAttention");
    }

    #[test]
    fn expired_active_state_is_not_suppressed_by_the_status_cache() {
        let started = Instant::now() - Duration::from_millis(FRESHNESS_MS);
        let stale = projection(Some(true), started);
        stale.remember_status("Active".to_owned());

        assert_eq!(stale.status(), "NeedsAttention");
        assert!(stale.should_emit_status("NeedsAttention"));
    }

    #[test]
    fn status_notifications_are_idempotent_until_status_changes() {
        let projection = projection(Some(true), Instant::now());
        assert!(projection.should_emit_status("Active"));
        projection.remember_status("Active".to_owned());
        assert!(!projection.should_emit_status("Active"));
        assert!(projection.should_emit_status("Passive"));
    }

    #[test]
    fn poisoned_tray_locks_recover_to_fresh_observation_and_round_trip() {
        // Row Q: poisoned tray locks recover at the boundary instead of
        // panicking; the recovered projection serves no stale snapshot and
        // a fresh publish round-trips back to Active.
        let made = projection(Some(true), Instant::now());
        assert_eq!(made.status(), "Active");
        made.remember_status("Active".to_owned());
        for poison in [
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _guard = made.state.lock().unwrap();
                panic!("inject tray state poison");
            })),
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _guard = made.last_status.lock().unwrap();
                panic!("inject status cache poison");
            })),
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _guard = made.settings_process.lock().unwrap();
                panic!("inject settings handle poison");
            })),
        ] {
            assert!(poison.is_err());
        }
        assert!(made.state.is_poisoned());
        assert!(made.last_status.is_poisoned());
        assert!(made.settings_process.is_poisoned());
        assert_eq!(
            made.status(),
            "NeedsAttention",
            "recovered state must not serve the pre-poison snapshot"
        );
        assert!(!made.state.is_poisoned());
        assert!(
            made.should_emit_status("NeedsAttention"),
            "recovered cache forces one fresh re-emission"
        );
        assert!(!made.last_status.is_poisoned());
        made.remember_status("NeedsAttention".to_owned());
        assert!(!made.should_emit_status("NeedsAttention"));
        assert!(
            made.lock_settings_process().is_none(),
            "recovered handle store is usable and empty"
        );
        assert!(!made.settings_process.is_poisoned());
        made.state
            .lock()
            .unwrap()
            .publish_snapshot(
                2,
                "generation".to_owned(),
                1,
                true,
                "ws-1".to_owned(),
                true,
                true,
                0,
            )
            .expect("next fresh publish converges");
        assert_eq!(made.status(), "Active");
    }

    #[test]
    fn emission_deadline_releases_lock_and_leaves_status_unremembered_for_retry() {
        // Row P: a hung signal block under the notification lock times out,
        // releases the lock, and leaves the status unremembered so a later
        // fresh projection retries; the retry then remembers normally.
        let made = projection(Some(true), Instant::now());
        assert!(made.should_emit_status("Active"));
        let hung = zbus::block_on(
            made.emit_guarded(Duration::from_millis(20), |_, _, _, _, _, _| {
                std::future::pending::<zbus::Result<()>>()
            }),
        );
        assert!(hung.is_err(), "hung emission must time out");
        assert!(
            made.notification_lock.try_lock().is_some(),
            "deadline must release the notification lock"
        );
        assert!(
            made.should_emit_status("Active"),
            "timed-out status stays unremembered for a later retry"
        );
        zbus::block_on(
            made.emit_guarded(Duration::from_secs(2), |_, _, _, _, _, _| async { Ok(()) }),
        )
        .expect("later fresh projection retries");
        assert!(!made.should_emit_status("Active"));
    }

    #[test]
    fn status_notification_signal_contract_includes_sni_updates() {
        let new_status = zbus::message::Message::signal(
            STATUS_NOTIFIER_ITEM_OBJECT,
            STATUS_NOTIFIER_ITEM_INTERFACE,
            NEW_STATUS_SIGNAL,
        )
        .unwrap()
        .build(&("Active",))
        .unwrap();
        assert_eq!(new_status.body().signature().to_string(), "s");

        let properties_changed = zbus::message::Message::signal(
            STATUS_NOTIFIER_ITEM_OBJECT,
            DBUS_PROPERTIES_INTERFACE,
            PROPERTIES_CHANGED_SIGNAL,
        )
        .unwrap()
        .build(&(
            STATUS_NOTIFIER_ITEM_INTERFACE,
            HashMap::<String, OwnedValue>::new(),
            Vec::<String>::new(),
        ))
        .unwrap();
        assert_eq!(
            properties_changed.body().signature().to_string(),
            "(sa{sv}as)"
        );

        let layout_updated =
            zbus::message::Message::signal(MENU_OBJECT, DBUS_MENU_INTERFACE, LAYOUT_UPDATED_SIGNAL)
                .unwrap()
                .build(&(1_u32, 0_i32))
                .unwrap();
        assert_eq!(layout_updated.body().signature().to_string(), "(ui)");

        let mut menu_changed = HashMap::new();
        menu_changed.insert("Status".to_owned(), owned_string("normal"));
        let menu_properties_changed = zbus::message::Message::signal(
            MENU_OBJECT,
            DBUS_PROPERTIES_INTERFACE,
            PROPERTIES_CHANGED_SIGNAL,
        )
        .unwrap()
        .build(&(DBUS_MENU_INTERFACE, menu_changed, Vec::<String>::new()))
        .unwrap();
        assert_eq!(
            menu_properties_changed.body().signature().to_string(),
            "(sa{sv}as)"
        );
        let body: (String, HashMap<String, OwnedValue>, Vec<String>) =
            menu_properties_changed.body().deserialize().unwrap();
        assert_eq!(body.0, DBUS_MENU_INTERFACE);
        assert!(body.1.contains_key("Status"));
        assert_eq!(
            body.1["Status"].downcast_ref::<String>().ok(),
            Some("normal".to_owned())
        );
    }

    #[test]
    fn menu_layout_has_status_toggle_default_radios_and_settings() {
        let menu = projection_full(Some(true), Some(true), Some(true), Instant::now()).menu();
        assert_eq!(menu.layout().children.len(), 7);
        // Conflict row stays hidden without conflict; old ids keep order.
        let conflict = menu.conflict_item();
        assert_eq!(conflict.id, MENU_ID_CONFLICT);
        assert_eq!(
            conflict.properties["visible"].downcast_ref::<bool>().ok(),
            Some(false)
        );
        let status = menu.status_item();
        assert_eq!(
            status.properties["label"].downcast_ref::<String>().ok(),
            Some("Enabled".to_owned())
        );
        assert_eq!(
            status.properties["enabled"].downcast_ref::<bool>().ok(),
            Some(false)
        );
        let toggle = menu.tile_toggle_item();
        assert_eq!(toggle.id, MENU_ID_TILE_TOGGLE);
        assert_eq!(
            toggle.properties["label"].downcast_ref::<String>().ok(),
            Some("Tile current workspace".to_owned())
        );
        assert_eq!(
            toggle.properties["toggle-type"]
                .downcast_ref::<String>()
                .ok(),
            Some("checkmark".to_owned())
        );
        assert_eq!(
            toggle.properties["toggle-state"].downcast_ref::<i32>().ok(),
            Some(1)
        );
        assert_eq!(
            toggle.properties["enabled"].downcast_ref::<bool>().ok(),
            Some(true)
        );
        let heading = menu.default_heading_item();
        assert_eq!(heading.id, MENU_ID_DEFAULT_HEADING);
        assert_eq!(
            heading.properties["label"].downcast_ref::<String>().ok(),
            Some("New workspace behavior".to_owned())
        );
        assert_eq!(
            heading.properties["enabled"].downcast_ref::<bool>().ok(),
            Some(false)
        );
        let tiled = menu.default_tiled_item();
        assert_eq!(
            tiled.properties["label"].downcast_ref::<String>().ok(),
            Some("Tiled".to_owned())
        );
        assert_eq!(
            tiled.properties["toggle-type"]
                .downcast_ref::<String>()
                .ok(),
            Some("radio".to_owned())
        );
        assert_eq!(
            tiled.properties["toggle-state"].downcast_ref::<i32>().ok(),
            Some(1)
        );
        let floating = menu.default_floating_item();
        assert_eq!(
            floating.properties["toggle-state"]
                .downcast_ref::<i32>()
                .ok(),
            Some(0)
        );
        let settings = menu.menu_item();
        assert_eq!(
            settings.properties["label"].downcast_ref::<String>().ok(),
            Some("Settings".to_owned())
        );
        assert_eq!(
            settings.properties["enabled"].downcast_ref::<bool>().ok(),
            Some(true)
        );
        assert_eq!(<MenuLayout as Type>::SIGNATURE.to_string(), "(ia{sv}av)");
    }

    #[test]
    fn menu_state_reflects_fresh_snapshot_tiled_and_default() {
        let tiled = projection_full(Some(true), Some(true), Some(false), Instant::now());
        assert!(tiled.tile_toggle_checked());
        assert!(!tiled.default_tiled_checked());
        assert!(tiled.default_floating_checked());
        let menu = tiled.menu();
        assert_eq!(
            menu.tile_toggle_item().properties["toggle-state"]
                .downcast_ref::<i32>()
                .ok(),
            Some(1)
        );
        assert_eq!(
            menu.default_tiled_item().properties["toggle-state"]
                .downcast_ref::<i32>()
                .ok(),
            Some(0)
        );
        assert_eq!(
            menu.default_floating_item().properties["toggle-state"]
                .downcast_ref::<i32>()
                .ok(),
            Some(1)
        );

        let floating = projection_full(Some(true), Some(false), Some(true), Instant::now());
        assert!(!floating.tile_toggle_checked());
        assert!(floating.default_tiled_checked());
        assert!(!floating.default_floating_checked());
    }

    #[test]
    fn stale_snapshot_disables_toggle_and_radios_but_keeps_settings() {
        let stale = TrayProjection::new(
            {
                let state = Arc::new(Mutex::new(TrayState::default()));
                state.lock().unwrap().owner_changed(Some(":kwin"));
                state
            },
            Instant::now(),
        );
        assert!(stale.fresh_workspace_state().is_none());
        assert!(!stale.tile_toggle_enabled());
        assert!(!stale.default_radio_enabled());
        let menu = stale.menu();
        assert_eq!(
            menu.tile_toggle_item().properties["enabled"]
                .downcast_ref::<bool>()
                .ok(),
            Some(false)
        );
        assert_eq!(
            menu.default_tiled_item().properties["enabled"]
                .downcast_ref::<bool>()
                .ok(),
            Some(false)
        );
        assert_eq!(
            menu.default_floating_item().properties["enabled"]
                .downcast_ref::<bool>()
                .ok(),
            Some(false)
        );
        assert_eq!(
            menu.menu_item().properties["enabled"]
                .downcast_ref::<bool>()
                .ok(),
            Some(true)
        );

        let expired = projection_full(
            Some(true),
            Some(true),
            Some(true),
            Instant::now() - Duration::from_millis(FRESHNESS_MS),
        );
        assert!(expired.fresh_workspace_state().is_none());
        assert!(!expired.tile_toggle_enabled());
    }

    #[test]
    fn get_layout_reports_the_current_layout_updated_revision() {
        let menu = projection(Some(true), Instant::now()).menu();
        assert_eq!(menu.get_layout(0, -1, Vec::new()).unwrap().0, 0);

        let revision = menu.projection.next_menu_revision();
        assert_eq!(revision, 1);
        assert_eq!(menu.get_layout(0, -1, Vec::new()).unwrap().0, revision);
    }

    #[test]
    fn title_uses_the_same_status_labels_as_the_menu() {
        for (enabled, label) in [
            (Some(true), "Enabled"),
            (Some(false), "Disabled"),
            (None, "Unavailable"),
        ] {
            let projection = projection(enabled, Instant::now());
            assert_eq!(
                projection.status_notifier_item().title(),
                format!("Plasma Auto Tiler - {label}")
            );
            assert_eq!(projection.status_label(), label);
        }
    }

    #[test]
    fn settings_click_storm_launches_only_once_while_process_is_running() {
        #[derive(Default)]
        struct FakeProcess;

        let mut process = None;
        let mut launches = 0;
        for index in 0..64 {
            let outcome = launch_settings_if_idle(
                &mut process,
                |_process: &mut FakeProcess| Ok::<Option<()>, io::Error>(None),
                || {
                    launches += 1;
                    Ok::<_, io::Error>(FakeProcess)
                },
            )
            .unwrap();
            if index == 0 {
                assert_eq!(outcome, SettingsLaunchOutcome::Launched);
            } else {
                assert_eq!(outcome, SettingsLaunchOutcome::AlreadyOpen);
            }
        }

        assert_eq!(launches, 1);
        assert!(process.is_some());
    }

    #[test]
    fn settings_launch_idle_reports_check_and_spawn_failures() {
        #[derive(Default)]
        struct FakeProcess;

        let mut process: Option<FakeProcess> = Some(FakeProcess);
        let check = launch_settings_if_idle(
            &mut process,
            |_| Err::<Option<()>, io::Error>(io::Error::other("check boom")),
            || Ok::<_, io::Error>(FakeProcess),
        );
        assert!(matches!(check, Err(SettingsLaunchError::Check(_))));

        let mut process: Option<FakeProcess> = None;
        let spawn = launch_settings_if_idle(
            &mut process,
            |_: &mut FakeProcess| Ok::<Option<()>, io::Error>(Some(())),
            || Err::<FakeProcess, io::Error>(io::Error::other("spawn boom")),
        );
        assert!(matches!(spawn, Err(SettingsLaunchError::Spawn(_))));
        assert!(process.is_none());
    }

    #[test]
    fn settings_outcome_lines_are_bounded_without_identity() {
        for outcome in [
            "launched",
            "already-open",
            "unavailable",
            "spawn-failed",
            "check-failed",
        ] {
            assert_eq!(
                settings_outcome_line(outcome),
                format!(
                    "plasma-auto-tiler:route-diag component=tray-endpoint stage=settings event=open outcome={outcome}"
                )
            );
        }
        for line in [
            settings_outcome_line("launched"),
            settings_outcome_line("already-open"),
            settings_outcome_line("unavailable"),
            settings_outcome_line("spawn-failed"),
            settings_outcome_line("check-failed"),
        ] {
            assert!(!line.contains('\n'));
            assert!(!line.contains('/'));
            assert!(!line.contains("kcmshell"));
        }
    }

    #[test]
    fn launch_settings_without_launcher_reports_unavailable() {
        let made = projection(Some(true), Instant::now());
        let mut emitted = None;
        let result = made.launch_settings_with(None, |line| {
            emitted = Some(line.to_owned());
        });
        match result {
            Err(zbus::fdo::Error::Failed(message)) => {
                assert!(message.contains("Settings launcher is unavailable"));
            }
            other => panic!("expected unavailable Failed, got {other:?}"),
        }
        assert_eq!(
            emitted.as_deref(),
            Some(settings_outcome_line("unavailable").as_str())
        );
    }

    #[test]
    fn settings_command_requires_nix_baked_absolute_launcher() {
        assert!(settings_command_for(None).is_none());
        assert!(settings_command_for(Some("kcmshell6")).is_none());
        assert!(settings_command_for(Some("relative/kcmshell6")).is_none());

        let mut absolute = settings_command_for(Some("/run/current-system/sw/bin/kcmshell6"))
            .expect("absolute baked launcher builds a command");
        let command = absolute.env("PATH", "/tmp/hostile");
        assert_eq!(
            command.get_program(),
            std::path::Path::new("/run/current-system/sw/bin/kcmshell6")
        );
        assert_eq!(command.get_args().collect::<Vec<_>>(), [SETTINGS_MODULE]);

        match SETTINGS_EXECUTABLE.filter(|path| std::path::Path::new(path).is_absolute()) {
            Some(path) => {
                let mut baked =
                    settings_command_for(SETTINGS_EXECUTABLE).expect("baked launcher is usable");
                assert_eq!(baked.get_program(), std::path::Path::new(path));
                let command = baked.env("PATH", "/tmp/hostile");
                assert_eq!(command.get_args().collect::<Vec<_>>(), [SETTINGS_MODULE]);
            }
            None => {
                assert!(settings_command_for(SETTINGS_EXECUTABLE).is_none());
                let made = projection(Some(true), Instant::now());
                assert!(made.launch_settings().is_err());
            }
        }
    }

    #[test]
    fn dbus_menu_status_matches_the_dynamic_sni_state() {
        assert_eq!(menu_status("Active"), "normal");
        assert_eq!(menu_status("Passive"), "normal");
        assert_eq!(menu_status("NeedsAttention"), "notice");
    }

    #[test]
    fn icon_name_is_project_owned_with_valid_pixmap_fallback() {
        let item = projection(Some(true), Instant::now()).status_notifier_item();
        assert_eq!(item.icon_name(), ICON_NAME);
        assert_eq!(ICON_NAME, "plasma-auto-tiler");
        let pixmap = item.icon_pixmap();
        assert_eq!(pixmap.len(), 1);
        assert_eq!(pixmap[0].0, ICON_PIXMAP_WIDTH);
        assert_eq!(pixmap[0].1, ICON_PIXMAP_HEIGHT);
        const _: () = assert!(ICON_PIXMAP_WIDTH > 0 && ICON_PIXMAP_HEIGHT > 0);
        assert_eq!(
            pixmap[0].2.len(),
            4 * ICON_PIXMAP_WIDTH as usize * ICON_PIXMAP_HEIGHT as usize
        );
        assert!(
            pixmap[0]
                .2
                .as_chunks::<4>()
                .0
                .iter()
                .all(|pixel| pixel[0] == 0xFF)
        );
        assert_eq!(
            <Vec<(i32, i32, Vec<u8>)> as Type>::SIGNATURE.to_string(),
            "a(iiay)"
        );
    }

    #[test]
    fn tooltip_carries_project_name_and_status_label() {
        for (enabled, label) in [
            (Some(true), "Enabled"),
            (Some(false), "Disabled"),
            (None, "Unavailable"),
        ] {
            let item = projection(enabled, Instant::now()).status_notifier_item();
            let tooltip = item.tool_tip();
            assert_eq!(tooltip.0, ICON_NAME);
            assert_eq!(tooltip.1, icon_pixmap());
            assert!(!tooltip.1.is_empty());
            assert_eq!(tooltip.2, TOOLTIP_TITLE);
            assert_eq!(tooltip.2, "Plasma Auto Tiler");
            assert_eq!(tooltip.3, label);
        }
    }

    #[test]
    fn status_change_properties_include_status_title_icon_and_tooltip() {
        for (enabled, status, label) in [
            (Some(true), "Active", "Enabled"),
            (Some(false), "Passive", "Disabled"),
            (None, "NeedsAttention", "Unavailable"),
        ] {
            let made = projection(enabled, Instant::now());
            let changed = made.sni_changed(status, false);
            assert_eq!(
                changed["Status"].downcast_ref::<String>().ok(),
                Some(status.to_owned())
            );
            assert_eq!(
                changed["Title"].downcast_ref::<String>().ok(),
                Some(format!("Plasma Auto Tiler - {label}"))
            );
            assert_eq!(
                changed["IconName"].downcast_ref::<String>().ok(),
                Some(ICON_NAME.to_owned())
            );
            assert_eq!(
                changed["OverlayIconName"].downcast_ref::<String>().ok(),
                Some(String::new()),
                "no conflict means no overlay"
            );
            let tooltip = changed.get("ToolTip").expect("ToolTip is signalled");
            assert_eq!(tooltip.value_signature().to_string(), "(sa(iiay)ss)");
            let decoded: ToolTip = tooltip.downcast_ref().expect("ToolTip decodes");
            assert_eq!(decoded.0, ICON_NAME);
            assert_eq!(decoded.1, icon_pixmap());
            assert!(!decoded.1.is_empty());
            assert_eq!(decoded.2, TOOLTIP_TITLE);
            assert_eq!(decoded.3, label);
            let signal = zbus::message::Message::signal(
                STATUS_NOTIFIER_ITEM_OBJECT,
                DBUS_PROPERTIES_INTERFACE,
                PROPERTIES_CHANGED_SIGNAL,
            )
            .unwrap()
            .build(&(
                STATUS_NOTIFIER_ITEM_INTERFACE,
                changed,
                Vec::<String>::new(),
            ))
            .unwrap();
            assert_eq!(signal.body().signature().to_string(), "(sa{sv}as)");
        }
    }

    #[test]
    fn menu_events_accept_toggle_default_and_settings_only() {
        assert!(is_menu_event(MENU_ID_SETTINGS, "clicked"));
        assert!(is_menu_event(MENU_ID_CONFLICT, "clicked"));
        assert!(is_menu_event(MENU_ID_TILE_TOGGLE, "clicked"));
        assert!(is_menu_event(MENU_ID_DEFAULT_TILED, "clicked"));
        assert!(is_menu_event(MENU_ID_DEFAULT_FLOATING, "clicked"));
        assert!(!is_menu_event(MENU_ID_STATUS, "clicked"));
        assert!(!is_menu_event(MENU_ID_DEFAULT_HEADING, "clicked"));
        assert!(!is_menu_event(0, "clicked"));
        assert!(!is_menu_event(MENU_ID_SETTINGS, "pressed"));
        assert!(!is_menu_event(MENU_ID_CONFLICT, "pressed"));
        assert!(!is_menu_event(MENU_ID_SETTINGS, ""));
        let menu = projection(Some(true), Instant::now()).menu();
        assert!(
            menu.event(MENU_ID_STATUS, "clicked", owned_string("x"), 0)
                .is_ok()
        );
        assert!(
            menu.event(MENU_ID_DEFAULT_HEADING, "clicked", owned_string("x"), 0)
                .is_ok()
        );
        assert!(
            menu.event(MENU_ID_SETTINGS, "pressed", owned_string("x"), 0)
                .is_ok()
        );
        assert!(menu.get_layout(99, -1, Vec::new()).is_err());
    }

    #[test]
    fn sni_activation_is_menu_noop_and_item_is_menu() {
        let made = projection(Some(true), Instant::now());
        let item = made.status_notifier_item();
        assert!(item.item_is_menu());
        // Left-click opens the menu via ItemIsMenu; Activate never launches
        // Settings (the Settings row does).
        assert!(item.activate(0, 0).is_ok());
    }

    #[test]
    fn toggle_click_invokes_kglobalaccel_without_optimistic_flip() {
        let made = projection_full(Some(true), Some(true), Some(true), Instant::now());
        let mut invoked = 0;
        let mut lines = Vec::new();
        let result = made.request_toggle_with(
            || {
                invoked += 1;
                Ok(())
            },
            |line| lines.push(line.to_owned()),
        );
        assert!(result.is_ok());
        assert_eq!(invoked, 1);
        assert!(lines.iter().any(|line| line.contains("outcome=intent")));
        assert!(
            lines
                .iter()
                .any(|line| line.contains("outcome=sent-unconfirmed"))
        );
        for line in &lines {
            assert!(!line.contains('\n'));
            assert!(!line.contains("ws-1"));
        }
        // No optimistic toggling: the fresh snapshot still projects tiled.
        assert!(made.tile_toggle_checked());
        assert_eq!(made.fresh_workspace_state(), Some((true, true)));
    }

    #[test]
    fn toggle_click_refuses_when_stale_without_invoking() {
        let stale = TrayProjection::new(
            {
                let state = Arc::new(Mutex::new(TrayState::default()));
                state.lock().unwrap().owner_changed(Some(":kwin"));
                state
            },
            Instant::now(),
        );
        let mut invoked = 0;
        let mut lines = Vec::new();
        let result = stale.request_toggle_with(
            || {
                invoked += 1;
                Ok(())
            },
            |line| lines.push(line.to_owned()),
        );
        assert!(result.is_err());
        assert_eq!(invoked, 0);
        assert!(lines.iter().any(|line| line.contains("stale-refused")));
    }

    #[test]
    fn toggle_dispatch_failure_logs_and_returns_err() {
        let made = projection_full(Some(true), Some(false), Some(true), Instant::now());
        let mut lines = Vec::new();
        let result =
            made.request_toggle_with(|| Err("invoke-failed"), |line| lines.push(line.to_owned()));
        assert!(result.is_err());
        assert!(
            lines
                .iter()
                .any(|line| line.contains("outcome=invoke-failed"))
        );
        // Failed dispatch never flips the menu either.
        assert!(!made.tile_toggle_checked());
    }

    #[test]
    fn kglobalaccel_and_persistence_call_shapes_use_fixed_contracts() {
        assert_eq!(KGLOBALACCEL_SERVICE, "org.kde.kglobalaccel");
        assert_eq!(KGLOBALACCEL_PATH, "/kglobalaccel");
        assert_eq!(KGLOBALACCEL_IFACE, "org.kde.KGlobalAccel");
        assert_eq!(KGLOBALACCEL_GET_COMPONENT, "getComponent");
        assert_eq!(
            KGLOBALACCEL_COMPONENT_IFACE,
            "org.kde.kglobalaccel.Component"
        );
        assert_eq!(KGLOBALACCEL_INVOKE, "invokeShortcut");
        assert_eq!(
            WORKSPACE_TOGGLE_ACTION,
            "plasma-auto-tiler-toggle-workspace-tiling"
        );
        assert_eq!(KGLOBALACCEL_COMPONENT, "kwin");
        assert_eq!(KGLOBALACCEL_CONTEXT, "default");

        assert_eq!(
            kwriteconfig_argv_for("kwriteconfig6", true),
            vec![
                "kwriteconfig6".to_owned(),
                "--file".to_owned(),
                "kwinrc".to_owned(),
                "--group".to_owned(),
                "Script-plasma-auto-tiler-kwin".to_owned(),
                "--key".to_owned(),
                "defaultTiled".to_owned(),
                "true".to_owned(),
            ]
        );
        assert_eq!(
            kwriteconfig_argv_for("kwriteconfig6", false)
                .last()
                .map(String::as_str),
            Some("false")
        );
        assert_eq!(KWIN_RECONFIGURE_SERVICE, "org.kde.KWin");
        assert_eq!(KWIN_RECONFIGURE_PATH, "/KWin");
        assert_eq!(KWIN_RECONFIGURE_IFACE, "org.kde.KWin");
        assert_eq!(KWIN_RECONFIGURE_METHOD, "reconfigure");
    }

    #[test]
    fn default_click_persists_without_optimistic_flip() {
        let made = projection_full(Some(true), Some(true), Some(true), Instant::now());
        let mut seen = None;
        let mut lines = Vec::new();
        let result = made.request_default_with(
            false,
            |value| {
                seen = Some(value);
                (Ok(()), Ok(()))
            },
            |line| lines.push(line.to_owned()),
        );
        assert!(result.is_ok());
        assert_eq!(seen, Some(false));
        assert!(lines.iter().any(|line| line.contains("stage=persist")
            && line.contains("outcome=intent")
            && line.contains("defaultTiled=false")));
        assert!(lines.iter().any(|line| line.contains("outcome=written")));
        assert!(lines.iter().any(|line| line.contains("sent-unconfirmed")));
        for line in &lines {
            assert!(!line.contains("ws-1"));
            assert!(!line.contains('\n'));
        }
        // No optimistic radio flip: the snapshot still projects default true.
        assert!(made.default_tiled_checked());
    }

    #[test]
    fn default_write_failure_returns_err_without_reconfigure() {
        let made = projection_full(Some(true), Some(true), Some(true), Instant::now());
        let mut reconfig_called = false;
        let result = made.request_default_with(
            true,
            |_| {
                reconfig_called = true;
                (Err("write-failed"), Err("reconfigure-skipped"))
            },
            |_| {},
        );
        assert!(result.is_err());
        assert!(reconfig_called);
    }

    #[test]
    fn default_reconfigure_failure_still_ok_after_persist() {
        let made = projection_full(Some(true), Some(true), Some(true), Instant::now());
        let mut lines = Vec::new();
        let result = made.request_default_with(
            true,
            |_| (Ok(()), Err("reconfigure-failed")),
            |line| lines.push(line.to_owned()),
        );
        assert!(result.is_ok());
        assert!(
            lines
                .iter()
                .any(|line| line.contains("outcome=reconfigure-failed"))
        );
    }

    #[test]
    fn toggle_and_default_outcome_lines_are_bounded_without_identity() {
        for line in [
            toggle_outcome_line("intent"),
            toggle_outcome_line("sent-unconfirmed"),
            toggle_outcome_line("stale-refused"),
            toggle_outcome_line("invoke-failed"),
            default_outcome_line("persist", "intent", true),
            default_outcome_line("persist", "written", false),
            default_outcome_line("reconfigure", "sent-unconfirmed", true),
            default_outcome_line("reconfigure", "reconfigure-failed", false),
        ] {
            assert!(!line.contains('\n'));
            assert!(!line.contains("ws-1"));
            assert!(!line.contains("/component/"));
        }
        assert_eq!(
            toggle_outcome_line("intent"),
            "plasma-auto-tiler:route-diag component=tray-endpoint stage=toggle event=invoke outcome=intent"
        );
    }

    fn publish_fresh(
        state: &Arc<Mutex<TrayState>>,
        revision: i32,
        scope: &str,
        tiled: bool,
        default_tiled: bool,
    ) {
        state
            .lock()
            .unwrap()
            .publish_snapshot(
                2,
                "generation".to_owned(),
                revision,
                true,
                scope.to_owned(),
                tiled,
                default_tiled,
                0,
            )
            .unwrap();
    }

    #[test]
    fn menu_fingerprint_tracks_scope_tiled_default_and_stale() {
        let state = Arc::new(Mutex::new(TrayState::default()));
        state.lock().unwrap().owner_changed(Some(":kwin"));
        let made = TrayProjection::new(Arc::clone(&state), Instant::now());
        assert_eq!(made.menu_fingerprint(), None);
        publish_fresh(&state, 0, "ws-1", true, true);
        assert_eq!(
            made.menu_fingerprint(),
            Some(("ws-1".to_owned(), true, true))
        );
        // Same Active status, different tiled: fingerprint must differ so the
        // menu emits even though SNI stays Active.
        publish_fresh(&state, 1, "ws-1", false, true);
        assert_eq!(made.status(), "Active");
        assert_eq!(
            made.menu_fingerprint(),
            Some(("ws-1".to_owned(), false, true))
        );
        publish_fresh(&state, 2, "ws-2", false, true);
        assert_eq!(
            made.menu_fingerprint(),
            Some(("ws-2".to_owned(), false, true))
        );
        publish_fresh(&state, 3, "ws-2", false, false);
        assert_eq!(
            made.menu_fingerprint(),
            Some(("ws-2".to_owned(), false, false))
        );
    }

    #[test]
    fn emit_guarded_emits_menu_update_when_only_menu_changes() {
        let state = Arc::new(Mutex::new(TrayState::default()));
        state.lock().unwrap().owner_changed(Some(":kwin"));
        publish_fresh(&state, 0, "ws-1", true, true);
        let made = TrayProjection::new(Arc::clone(&state), Instant::now());
        let mut sends = 0;
        zbus::block_on(
            made.emit_guarded(Duration::from_secs(2), |status, menu, _, _, _, _| {
                sends += 1;
                assert_eq!(status, "Active");
                assert_eq!(menu, Some(("ws-1".to_owned(), true, true)));
                async { Ok(()) }
            }),
        )
        .unwrap();
        assert_eq!(sends, 1);
        // Steady state: same status and same menu stays silent.
        zbus::block_on(
            made.emit_guarded(Duration::from_secs(2), |_, _, _, _, _, _| async {
                panic!("steady state must not send");
                #[allow(unreachable_code)]
                Ok(())
            }),
        )
        .unwrap();
        // Accepted fresh snapshot flips only tiled: status stays Active but
        // the menu must emit again.
        publish_fresh(&state, 1, "ws-1", false, true);
        assert_eq!(made.status(), "Active");
        let mut menu_sends = 0;
        zbus::block_on(
            made.emit_guarded(Duration::from_secs(2), |status, menu, _, _, _, _| {
                menu_sends += 1;
                assert_eq!(status, "Active");
                assert_eq!(menu, Some(("ws-1".to_owned(), false, true)));
                async { Ok(()) }
            }),
        )
        .unwrap();
        assert_eq!(menu_sends, 1, "tiled-only change must emit menu update");
        // Duplicate after remembering stays silent again.
        zbus::block_on(
            made.emit_guarded(Duration::from_secs(2), |_, _, _, _, _, _| async {
                panic!("duplicate menu must stay silent");
                #[allow(unreachable_code)]
                Ok(())
            }),
        )
        .unwrap();
        // Scope-only change also emits.
        publish_fresh(&state, 2, "ws-2", false, true);
        let mut scope_sends = 0;
        zbus::block_on(
            made.emit_guarded(Duration::from_secs(2), |_, menu, _, _, _, _| {
                scope_sends += 1;
                assert_eq!(menu, Some(("ws-2".to_owned(), false, true)));
                async { Ok(()) }
            }),
        )
        .unwrap();
        assert_eq!(scope_sends, 1);
    }

    #[test]
    fn reconfigure_message_sets_noreply_expected_without_waiting() {
        // Behavior, not call shape: the built message carries the D-Bus
        // NoReplyExpected flag, targets the KWin reconfigure route, and has
        // an empty body, so `Connection::send` fire-and-forget never waits
        // for the reply Q_NOREPLY never sends (KWin src/dbusinterface.h).
        let message = reconfigure_noreply_message().expect("reconfigure message builds");
        assert!(
            message
                .primary_header()
                .flags()
                .contains(zbus::message::Flags::NoReplyExpected)
        );
        let header = message.header();
        assert_eq!(
            header.path().map(|path| path.to_string()).as_deref(),
            Some(KWIN_RECONFIGURE_PATH)
        );
        assert_eq!(
            header.interface().map(|iface| iface.to_string()).as_deref(),
            Some(KWIN_RECONFIGURE_IFACE)
        );
        assert_eq!(
            header.member().map(|member| member.to_string()).as_deref(),
            Some(KWIN_RECONFIGURE_METHOD)
        );
        let body: () = message.body().deserialize().expect("empty body");
        assert_eq!(body, ());
    }

    #[test]
    fn menu_projected_line_is_bounded_without_scope_identity() {
        let line = crate::tray_endpoint::menu_projected_line(false, true);
        assert!(line.contains("outcome=menu-updated"));
        assert!(line.contains("tiled=false"));
        assert!(line.contains("defaultTiled=true"));
        assert!(!line.contains("ws-1"));
        assert!(!line.contains('\n'));
    }

    #[test]
    fn empty_scope_disables_toggle_but_keeps_default_radios() {
        let state = Arc::new(Mutex::new(TrayState::default()));
        state.lock().unwrap().owner_changed(Some(":kwin"));
        publish_fresh(&state, 0, "", true, true);
        let made = TrayProjection::new(Arc::clone(&state), Instant::now());
        // Fresh snapshot still projects the persisted default.
        assert_eq!(made.fresh_workspace_state(), Some((true, true)));
        assert!(!made.has_fresh_workspace_scope());
        assert!(!made.tile_toggle_enabled());
        assert!(!made.tile_toggle_checked());
        assert!(made.default_radio_enabled());
        assert!(made.default_tiled_checked());
        assert!(!made.default_floating_checked());
        let menu = made.menu();
        assert_eq!(
            menu.tile_toggle_item().properties["enabled"]
                .downcast_ref::<bool>()
                .ok(),
            Some(false)
        );
        assert_eq!(
            menu.default_tiled_item().properties["enabled"]
                .downcast_ref::<bool>()
                .ok(),
            Some(true)
        );
        assert_eq!(
            menu.default_floating_item().properties["enabled"]
                .downcast_ref::<bool>()
                .ok(),
            Some(true)
        );
    }

    #[test]
    fn empty_scope_toggle_refuses_without_invoking_while_default_persists() {
        let state = Arc::new(Mutex::new(TrayState::default()));
        state.lock().unwrap().owner_changed(Some(":kwin"));
        publish_fresh(&state, 0, "", true, false);
        let made = TrayProjection::new(Arc::clone(&state), Instant::now());
        let mut invoked = 0;
        let mut lines = Vec::new();
        let result = made.request_toggle_with(
            || {
                invoked += 1;
                Ok(())
            },
            |line| lines.push(line.to_owned()),
        );
        assert!(result.is_err());
        assert_eq!(invoked, 0);
        assert!(lines.iter().any(|line| line.contains("stale-refused")));
        // Default radios stay usable on empty scope: persist path still runs.
        let result = made.request_default_with(
            true,
            |value| {
                assert!(value);
                (Ok(()), Ok(()))
            },
            |_| {},
        );
        assert!(result.is_ok());
    }

    #[test]
    fn emit_guarded_flags_distinguish_menu_only_from_status_change() {
        let state = Arc::new(Mutex::new(TrayState::default()));
        state.lock().unwrap().owner_changed(Some(":kwin"));
        publish_fresh(&state, 0, "ws-1", true, true);
        let made = TrayProjection::new(Arc::clone(&state), Instant::now());
        // First emission is both status and menu (fresh cache).
        let mut first = None;
        zbus::block_on(
            made.emit_guarded(Duration::from_secs(2), |status, menu, _, sc, mc, _| {
                first = Some((status, menu, sc, mc));
                async { Ok(()) }
            }),
        )
        .unwrap();
        let (_, _, status_changed, menu_changed) = first.expect("first emits");
        assert!(status_changed);
        assert!(menu_changed);
        // Tiled-only flip: status unchanged, menu changed.
        publish_fresh(&state, 1, "ws-1", false, true);
        let mut second = None;
        zbus::block_on(
            made.emit_guarded(Duration::from_secs(2), |status, menu, _, sc, mc, _| {
                second = Some((status, menu, sc, mc));
                async { Ok(()) }
            }),
        )
        .unwrap();
        let (status, menu, status_changed, menu_changed) = second.expect("menu-only emits");
        assert_eq!(status, "Active");
        assert_eq!(menu, Some(("ws-1".to_owned(), false, true)));
        assert!(!status_changed, "Active unchanged must not re-emit status");
        assert!(menu_changed);
    }

    #[test]
    fn kwriteconfig_resolves_baked_absolute_or_path_fallback() {
        // Fixed call shape for an explicit executable (Nix absolute or dev).
        let nix_argv = kwriteconfig_argv_for("/run/current-system/sw/bin/kwriteconfig6", true);
        assert_eq!(nix_argv[0], "/run/current-system/sw/bin/kwriteconfig6");
        assert_eq!(nix_argv[1..4], ["--file", "kwinrc", "--group"]);
        // Runtime resolver: baked absolute in Nix, PATH fallback in dev.
        let resolved = kwriteconfig_executable();
        let is_baked_absolute = std::path::Path::new(resolved).is_absolute();
        assert!(
            is_baked_absolute || resolved == KWRITECONFIG_EXECUTABLE,
            "resolver must be absolute baked or PATH fallback"
        );
        assert_eq!(
            kwriteconfig_argv(true)[0],
            resolved,
            "argv must use the resolved writer"
        );
        assert_eq!(KWRITECONFIG_EXECUTABLE, "kwriteconfig6");
    }

    fn conflict_visible(menu: &DbusMenu) -> Option<bool> {
        menu.conflict_item().properties["visible"]
            .downcast_ref::<bool>()
            .ok()
    }

    #[test]
    fn conflict_overlay_menu_and_status() {
        let made = projection(Some(true), Instant::now());
        assert_eq!(made.status_notifier_item().overlay_icon_name(), "");
        assert_eq!(conflict_visible(&made.menu()), Some(false));
        made.set_conflict(true);
        assert_eq!(
            made.status_notifier_item().overlay_icon_name(),
            OVERLAY_ICON_WARNING
        );
        assert_eq!(conflict_visible(&made.menu()), Some(true));
        assert_eq!(made.status(), "Active");
        // A stale snapshot keeps the warning without changing status.
        let stale = projection(None, Instant::now());
        stale.set_conflict(true);
        assert_eq!(stale.status(), "NeedsAttention");
        assert_eq!(
            stale.status_notifier_item().overlay_icon_name(),
            OVERLAY_ICON_WARNING
        );
        assert_eq!(conflict_visible(&stale.menu()), Some(true));
        made.set_conflict(false);
        assert_eq!(made.status_notifier_item().overlay_icon_name(), "");
        assert_eq!(conflict_visible(&made.menu()), Some(false));
    }

    #[test]
    fn conflict_refresh_progression_emits_only_on_change() {
        let made = projection(Some(true), Instant::now());
        // Settle status/menu; clean startup already agrees on no-warning.
        zbus::block_on(
            made.emit_guarded(Duration::from_secs(2), |_, _, _, _, _, _| async { Ok(()) }),
        )
        .unwrap();
        // One watchdog tick: store on Some (None keeps state), then emit.
        let tick = |read: Option<bool>| {
            if let Some(conflict) = read {
                made.set_conflict(conflict);
            }
            let mut sent = false;
            zbus::block_on(
                made.emit_guarded(Duration::from_secs(2), |_, _, _, _, _, _| {
                    sent = true;
                    async { Ok(()) }
                }),
            )
            .unwrap();
            sent
        };

        assert!(tick(Some(true)));
        assert_eq!(
            made.status_notifier_item().overlay_icon_name(),
            OVERLAY_ICON_WARNING
        );
        assert!(!tick(Some(true)), "identical repeat must stay silent");
        assert!(!tick(None), "unknown read must keep state silently");
        assert_eq!(
            made.status_notifier_item().overlay_icon_name(),
            OVERLAY_ICON_WARNING
        );
        assert!(tick(Some(false)));
        assert_eq!(made.status_notifier_item().overlay_icon_name(), "");
        assert!(!tick(Some(false)));
        assert!(tick(Some(true)));
        assert_eq!(made.status(), "Active");
        let line = conflict_projected_line(true);
        assert!(line.contains("outcome=conflict-updated"));
        assert!(line.contains("conflict=true"));
        assert!(!line.contains('\n'));
    }

    #[test]
    fn sni_payload_uses_captured_conflict_not_live_state() {
        // The emission snapshot must win over a mid-send shared-state flip.
        let made = projection(Some(true), Instant::now());
        made.set_conflict(true);
        let captured_clear = made.sni_changed("Active", false);
        assert_eq!(
            captured_clear["OverlayIconName"]
                .downcast_ref::<String>()
                .ok(),
            Some(String::new()),
            "captured false must render no overlay even while shared is set"
        );
        made.set_conflict(false);
        let captured_set = made.sni_changed("Active", true);
        assert_eq!(
            captured_set["OverlayIconName"]
                .downcast_ref::<String>()
                .ok(),
            Some(OVERLAY_ICON_WARNING.to_owned()),
            "captured true must render the warning even after shared clears"
        );
    }

    #[test]
    fn conflict_row_routes_to_settings() {
        assert!(is_menu_event(MENU_ID_CONFLICT, "clicked"));
        assert!(!is_menu_event(MENU_ID_CONFLICT, "pressed"));
        let menu = projection(Some(true), Instant::now()).menu();
        assert!(menu.get_layout(MENU_ID_CONFLICT, -1, Vec::new()).is_ok());
    }

    #[test]
    fn hidden_conflict_click_is_ignored() {
        // No conflict: the row is hidden, so a stray click must not route
        // to Settings (in dev this would otherwise surface a launcher
        // error; with a baked launcher it would spawn).
        let menu = projection(Some(true), Instant::now()).menu();
        assert_eq!(conflict_visible(&menu), Some(false));
        assert!(
            menu.event(MENU_ID_CONFLICT, "clicked", owned_string("x"), 0)
                .is_ok()
        );
    }
}
