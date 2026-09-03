# Backlog

Only meaningful pending or active work is listed.

- P1 | static complete, residual manual/live acceptance; exhaustive harness
  recovery deferred | Retain stable Custom Tile runtime behavior, including
  drag/reflow and the existing float, fullscreen, maximize, and workspace
  paths |
  [change](changes/custom-tile-runtime.md)
- P1 | next action, separately authorized live | Accept COSMIC directional
  movement on KWin with live bindings | [change](changes/cosmic-directional-movement.md)
- P1 | static complete, pending live | Accept pointer resize and neighbouring
  reflow on a disposable layout with fresh authorization | [change](changes/pointer-interactive-resize.md)
- P1 | static complete, pending manual visual smoke | Drag one tiled window over
  an occupied target leaf, confirm the whole-leaf rectangle preview, release,
  and visually confirm nested split placement; do not attempt stale-harness
  recovery | [change](changes/archive/nested-placement-affordance.md)
- P1 | static complete; current-session user-local dogfood attempt made no
  mutation and stopped fail-closed because authoritative current-session
  discovery evidence was unavailable; no live identity/config/plugin/PID/proc
  claim is accepted | Accept the active-window border and Desktop Effects KCM
  using a consumer-host-pkgs Nix build that explicitly supplies and verifies
  the `kwin` package matching the running KWin plus its `kwin.dev`;
  `UseThemeColor` (default true, migration-free) is implemented with native
  KCM control and existing hot-apply/repaint coverage, static/native/Nix
  package evidence passed with no live Plasma action; the verified
  output handoff to the documented user-local dogfood root remains pending
   with preimage/rollback checks; the user-owned manual visual border/KCM check,
   including width hot-apply and theme-override behavior, is accepted after a
   rebuild/new session; runtime/config/reload/restoration gates remain future
   gates; external NixOS/Home Manager activation remains outside this change |
  [decision](decisions.md#native-active-border)
  [change](changes/archive/active-border-colour-override.md)
- P1 | static complete, pending live/release | Manual tray visual/Settings-click
  is accepted after rebuild/new session; residual gates are KWin-origin SNI
  authority, watcher ordering, native ABI load, real install/packaging,
  login/autostart, and update/rollback generation |
  [change](changes/archive/tray-carrier.md)
- P1 | Nix-only script resolution/session activation accepted; pending external
  current-host live | Consume the Nix flake from an external NixOS/Home Manager
  configuration, then validate clean install, update, and Nix generation
  rollback. The user-owned restart resolved only the active-generation store
  script with the local shadow absent; it does not accept Custom Tile behavior,
  physical behavior, tray/effect behavior, or loaded-memory byte identity.
  Static outputs, immutable managed tray startup, ownership, source filtering,
  and lockfile evidence are accepted |
  [change](changes/archive/nix-current-host-delivery.md)

- P2 | parked | Retain the floor-ratio fallback unless a qualifying isolated
  nested KWin proof establishes a safe improvement | [change](changes/floor-ratio-feasibility.md)
- P2 | parked | Establish a safe Integrated Plasma structural feasibility
  verdict; the unsafe nested path remains stopped | [change](changes/integrated-plasma-structural-feasibility.md)
- P2 | parked | Complete sustained JavaScript workload evidence before choosing
  a native replacement for discrete window management | [change](changes/js-workload.md)
- P2 | parked | Prove multi-window Custom Tile stability before choosing true
  grouped or tabbed window behavior | [change](changes/grouped-windows.md)
- P2 | parked | Resolve complete keyboard-layout support after initial release |
  [change](changes/shortcuts.md)
- P2 | parked | Verify trailing-empty workspace anti-oscillation on a multi-output
  machine | [runbook](live-oscillation-verification.md)
- P3 | parked | Validate bspwm, Hyprland, and COSMIC behavior at their actual
  runtimes | [comparison](reference-wm-comparison.md)
- P3 | parked | Publish the reproducible KPackage artifact to KDE Store and
  GitHub Release after MVP delivery dependencies are complete | [delivered foundations](changes/archive/delivered-foundations.md)
