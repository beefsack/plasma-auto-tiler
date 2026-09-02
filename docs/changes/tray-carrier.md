# Tray Carrier And Bridge

## Goal

Deliver the tray MVP: basic status and Settings through a portable
StatusNotifierItem carrier with a KWin-first backend and a safe fixed D-Bus
bridge.

## Scope And Non-Goals

- The bridge permits only whitelisted state snapshots and approved actions;
  it has no shell, input, or helper-to-KWin action route.
- The helper remains optional for core tiling. Lifecycle operations must fail
  closed and restore only exact project-owned artifacts.
- The MVP has no direct tiling controls and does not expand the helper boundary.

## Acceptance

- Fresh current-main 05a static evidence accepts the direct lifecycle launcher
  route under a hermetic fixture.
- Tray MVP basic status and Settings implementation, plus live validation,
  remain pending. Live validation includes KWin-origin state, SNI delivery,
  packaging, panel, and login-autostart behavior.

## Approach And Dependencies

- Use direct current Rust binary commands under a hermetic fixture for the
  lifecycle launcher route before live carrier validation.
- Packaging and user-local binary lifecycle are dependencies of the tray MVP;
  the helper is not required for core tiling.

## Current Approach And Evidence

- The fresh current-main 05a static harness accepts direct current Rust binary
  commands under a hermetic fixture.
- Process identity correction and fail-closed lifecycle coverage are accepted;
  the harness accepted 18 lifecycle checks and 4 self-checks.
- All-target Rust: 45 passed.
- The installer fixture ran only from an isolated archived HEAD and is not tray
  evidence.
- Tray MVP basic status and Settings implementation remain pending. KWin-origin
  05b, live SNI, panel, packaging, and login-autostart acceptance remain
  pending.

## Next Action

Complete the tray MVP basic status and Settings implementation, then perform
the separately pending live validation.

## Verification

- Fresh current-main 05a direct lifecycle launcher commands ran under a
  hermetic fixture, with accepted process identity correction and fail-closed
  lifecycle coverage.
- The static harness accepted 18 lifecycle checks and 4 self-checks; all-target
  Rust had 45 passed.
- The installer fixture ran only from an isolated archived HEAD and is not tray
  evidence. Tray MVP implementation and live acceptance remain pending.

## Material Decisions And Accepted Evidence

- The helper remains optional to core tiling, and the MVP boundary is basic
  status plus Settings with no direct tiling controls.
- The fresh current-main 05a direct lifecycle launcher route is accepted under
  a hermetic fixture; live carrier checks and release gates remain pending.
