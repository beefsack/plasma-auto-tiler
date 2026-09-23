pub mod active_group;
pub mod contract;
pub mod cosmic_v1;
pub mod directional;
pub mod geometry;
pub mod ids;
// Linux-only KWin identity boundary removed (Group E single-engine cleanup).
// Caller authorization is exactly the fail-closed same-UID check in
// [`crate::planner_service`] via `GetConnectionUnixUser`.
pub mod planner_protocol;
pub mod planner_service;
pub mod reconcile;
pub mod session;
pub mod tray;
pub mod tray_endpoint;
pub mod tray_lifecycle;
