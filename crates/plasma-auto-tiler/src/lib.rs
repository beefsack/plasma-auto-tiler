// Caller authorization is exactly the fail-closed same-UID check in
// [`crate::planner_service`] via `GetConnectionUnixUser`.
pub mod planner_service;
pub mod tray;
pub mod tray_endpoint;
pub mod tray_lifecycle;
