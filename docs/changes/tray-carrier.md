# Tray Carrier And Bridge

## Goal

Deliver a portable StatusNotifierItem carrier with a KWin-first backend and a
safe fixed D-Bus bridge.

## Scope And Acceptance

- The bridge permits only whitelisted state snapshots and approved actions;
  it has no shell, input, or helper-to-KWin action route.
- The helper remains optional for core tiling. Lifecycle operations must fail
  closed and restore only exact project-owned artifacts.

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
