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

- Static publisher and normal lifecycle behavior are accepted in the available
  harness; lifecycle launcher routing must be completed before live validation.
- Live acceptance covers KWin-origin state, SNI delivery, packaging, panel, and
  login-autostart behavior without claiming unrun results.

## Approach And Dependencies

- Route the lifecycle launcher through the accepted static harness before live
  carrier validation.
- Packaging and user-local binary lifecycle are dependencies of the tray MVP;
  the helper is not required for core tiling.

## Current Approach And Evidence

- The immediate publisher on main and normal lifecycle work are accepted. The canonical
  bundle is `b399ba6`, 369823 bytes, SHA-256
  `d80744656b464153785bb92dae5c96bf4c1f639ee4c63f8fdd408a7119c0bccc`.
- The reconstructed 05a static harness passed, but lifecycle launcher routing
  blocks that accepted evidence from its normal route. 05b KWin-origin live
  acceptance, SNI delivery, packaging, and the manual panel and login-autostart
  release gates are unrun.

## Next Action

Route the lifecycle launcher into the accepted static harness before any live
carrier validation.

## Verification

- The immediate publisher on main and normal lifecycle work are accepted. The
  reconstructed 05a static harness passed, but its normal launcher route is
  blocked; 05b live acceptance and release gates remain unrun.

## Material Decisions And Accepted Evidence

- The helper remains optional to core tiling, and the MVP boundary is basic
  status plus Settings with no direct tiling controls.
- The 05a harness evidence is accepted; launcher routing, live carrier checks,
  and release gates are not performed.
