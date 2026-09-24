// Caller authorization is exactly the fail-closed same-UID check in
// [`crate::planner_service`] via `GetConnectionUnixUser`. The tray endpoint
// trusts same-UID session bus callers and authorizes snapshots only by
// sender unique name equal to the current `org.kde.KWin` owner.
pub mod planner_service;
pub mod tray;
pub mod tray_endpoint;
