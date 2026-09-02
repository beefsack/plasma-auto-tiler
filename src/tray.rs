use std::collections::HashMap;
use std::io;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use zbus::object_server::SignalEmitter;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, StructureBuilder, Type, Value};

use crate::tray_endpoint::TrayState;

pub const STATUS_NOTIFIER_ITEM_OBJECT: &str = "/StatusNotifierItem";
pub const MENU_OBJECT: &str = "/Menu";
const STATUS_NOTIFIER_ITEM_INTERFACE: &str = "org.kde.StatusNotifierItem";
const DBUS_PROPERTIES_INTERFACE: &str = "org.freedesktop.DBus.Properties";
const DBUS_MENU_INTERFACE: &str = "com.canonical.dbusmenu";
const NEW_STATUS_SIGNAL: &str = "NewStatus";
const PROPERTIES_CHANGED_SIGNAL: &str = "PropertiesChanged";
const LAYOUT_UPDATED_SIGNAL: &str = "LayoutUpdated";
const SETTINGS_EXECUTABLE: &str = match option_env!("PLASMA_AUTO_TILER_KCMSHELL6") {
    Some(path) => path,
    None => "kcmshell6",
};
const SETTINGS_MODULE: &str = "kwin/effects/configs/plasma-auto-tiler-active-border_config";

#[derive(Debug)]
enum SettingsLaunchError {
    Check(io::Error),
    Spawn(io::Error),
}

fn launch_settings_if_idle<Process, Status, Check, Launch>(
    process: &mut Option<Process>,
    mut check: Check,
    launch: Launch,
) -> Result<(), SettingsLaunchError>
where
    Check: FnMut(&mut Process) -> io::Result<Option<Status>>,
    Launch: FnOnce() -> io::Result<Process>,
{
    if let Some(child) = process.as_mut() {
        if check(child).map_err(SettingsLaunchError::Check)?.is_none() {
            return Ok(());
        }
        *process = None;
    }

    *process = Some(launch().map_err(SettingsLaunchError::Spawn)?);
    Ok(())
}

fn settings_command() -> Command {
    let mut command = Command::new(SETTINGS_EXECUTABLE);
    command.arg(SETTINGS_MODULE);
    command
}

fn menu_status(status: &str) -> &'static str {
    if status == "NeedsAttention" {
        "notice"
    } else {
        "normal"
    }
}

#[derive(Clone, Debug)]
pub struct TrayProjection {
    state: Arc<Mutex<TrayState>>,
    started: Instant,
    last_status: Arc<Mutex<Option<String>>>,
    notification_lock: Arc<async_lock::Mutex<()>>,
    menu_revision: Arc<AtomicU32>,
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
            notification_lock: Arc::new(async_lock::Mutex::new(())),
            menu_revision: Arc::new(AtomicU32::new(0)),
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

    fn view(&self) -> crate::tray_endpoint::StateView {
        let now_ms = self.started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        self.state
            .lock()
            .expect("tray state mutex poisoned")
            .view(now_ms)
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

    fn status_label(&self) -> &'static str {
        match self.status() {
            "Active" => "Enabled",
            "Passive" => "Disabled",
            "NeedsAttention" => "Unavailable",
            _ => unreachable!("status has a fixed SNI value"),
        }
    }

    fn should_emit_status(&self, status: &str) -> bool {
        self.last_status
            .lock()
            .expect("tray notification mutex poisoned")
            .as_deref()
            != Some(status)
    }

    fn remember_status(&self, status: String) {
        *self
            .last_status
            .lock()
            .expect("tray notification mutex poisoned") = Some(status);
    }

    pub async fn emit_changed(&self, connection: &zbus::Connection) -> zbus::Result<()> {
        let _notification_guard = self.notification_lock.lock().await;
        let status = self.status().to_owned();
        if !self.should_emit_status(&status) {
            return Ok(());
        }

        let mut changed = HashMap::new();
        changed.insert("Status".to_owned(), owned_string(&status));
        changed.insert(
            "Title".to_owned(),
            owned_string(&format!("Plasma Auto Tiler - {}", self.status_label())),
        );
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
        let mut menu_changed = HashMap::new();
        menu_changed.insert("Status".to_owned(), owned_string(menu_status(&status)));
        connection
            .emit_signal(
                None::<&str>,
                MENU_OBJECT,
                DBUS_PROPERTIES_INTERFACE,
                PROPERTIES_CHANGED_SIGNAL,
                &(DBUS_MENU_INTERFACE, menu_changed, Vec::<String>::new()),
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
        connection
            .emit_signal(
                None::<&str>,
                MENU_OBJECT,
                DBUS_MENU_INTERFACE,
                LAYOUT_UPDATED_SIGNAL,
                &(self.next_menu_revision(), 0_i32),
            )
            .await?;

        self.remember_status(status);
        Ok(())
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
        "preferences-system-windows"
    }

    #[zbus(property)]
    fn icon_pixmap(&self) -> Vec<(i32, i32, Vec<u8>)> {
        Vec::new()
    }

    #[zbus(property)]
    fn overlay_icon_name(&self) -> &'static str {
        ""
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
        (String::new(), Vec::new(), String::new(), String::new())
    }

    #[zbus(property)]
    fn item_is_menu(&self) -> bool {
        false
    }

    #[zbus(property, name = "Menu")]
    fn menu(&self) -> OwnedObjectPath {
        self.menu_path()
    }

    fn activate(&self, _x: i32, _y: i32) {}

    fn secondary_activate(&self, _x: i32, _y: i32) {}

    fn context_menu(&self, _x: i32, _y: i32) {}

    fn scroll(&self, _delta: i32, _orientation: &str) {}

    #[zbus(signal)]
    async fn new_status(emitter: SignalEmitter<'_>, status: &str) -> zbus::Result<()>;
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
    settings_process: Arc<Mutex<Option<Child>>>,
}

impl DbusMenu {
    pub const OBJECT: &str = MENU_OBJECT;

    pub(crate) fn new(projection: TrayProjection) -> Self {
        Self {
            projection,
            settings_process: Arc::new(Mutex::new(None)),
        }
    }

    pub fn layout(&self) -> MenuLayout {
        MenuLayout {
            id: 0,
            properties: HashMap::new(),
            children: vec![menu_value(self.status_item()), menu_value(self.menu_item())],
        }
    }

    fn status_item(&self) -> MenuLayout {
        MenuLayout {
            id: 2,
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

    fn menu_item(&self) -> MenuLayout {
        MenuLayout {
            id: 1,
            properties: HashMap::from([
                ("label".to_owned(), owned_string("Settings")),
                ("enabled".to_owned(), OwnedValue::from(true)),
                ("visible".to_owned(), OwnedValue::from(true)),
            ]),
            children: Vec::new(),
        }
    }
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
            1 => self.menu_item(),
            2 => self.status_item(),
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
        if id != 1 || event_id != "clicked" {
            return Ok(());
        }
        let mut process = self
            .settings_process
            .lock()
            .expect("settings process mutex poisoned");
        launch_settings_if_idle(
            &mut process,
            |child| child.try_wait(),
            || settings_command().spawn(),
        )
        .map_err(|error| match error {
            SettingsLaunchError::Check(error) => {
                zbus::fdo::Error::Failed(format!("check Settings process: {error}"))
            }
            SettingsLaunchError::Spawn(error) => {
                zbus::fdo::Error::Failed(format!("open Settings: {error}"))
            }
        })
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

    fn projection(enabled: Option<bool>, started: Instant) -> TrayProjection {
        let state = Arc::new(Mutex::new(TrayState::default()));
        let mut guard = state.lock().unwrap();
        guard.owner_changed(Some(":kwin"));
        if let Some(enabled) = enabled {
            guard
                .publish_snapshot(1, "generation".to_owned(), 0, enabled, 0)
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
    fn menu_layout_has_status_and_one_settings_action() {
        let menu = projection(Some(true), Instant::now()).menu();
        assert_eq!(menu.layout().children.len(), 2);
        let status = menu.status_item();
        assert_eq!(
            status.properties["label"].downcast_ref::<String>().ok(),
            Some("Enabled".to_owned())
        );
        assert_eq!(
            status.properties["enabled"].downcast_ref::<bool>().ok(),
            Some(false)
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
        for _ in 0..64 {
            launch_settings_if_idle(
                &mut process,
                |_process: &mut FakeProcess| Ok::<Option<()>, io::Error>(None),
                || {
                    launches += 1;
                    Ok::<_, io::Error>(FakeProcess)
                },
            )
            .unwrap();
        }

        assert_eq!(launches, 1);
        assert!(process.is_some());
    }

    #[test]
    fn settings_command_ignores_hostile_path_lookup() {
        let mut settings = settings_command();
        let command = settings.env("PATH", "/tmp/hostile");
        assert_eq!(
            command.get_program(),
            std::path::Path::new(SETTINGS_EXECUTABLE)
        );
        assert_eq!(command.get_args().collect::<Vec<_>>(), [SETTINGS_MODULE]);
    }

    #[test]
    fn dbus_menu_status_matches_the_dynamic_sni_state() {
        assert_eq!(menu_status("Active"), "normal");
        assert_eq!(menu_status("Passive"), "normal");
        assert_eq!(menu_status("NeedsAttention"), "notice");
    }
}
