# Backlog

Only meaningful pending or active work is listed.

- P1 | static complete, residual manual/live acceptance; exhaustive harness
  recovery deferred | Retain stable Custom Tile runtime behavior, including
  drag/reflow and the existing float, fullscreen, maximize, and workspace paths |
  [change](changes/custom-tile-runtime.md)
- P1 | static complete, pending live | Accept COSMIC directional movement on
  KWin with separately authorized live bindings | [change](changes/cosmic-directional-movement.md)
- P1 | static complete, pending live | Accept pointer resize and neighbouring
  reflow on a disposable layout with fresh authorization | [change](changes/pointer-interactive-resize.md)
- P1 | static complete, pending manual visual smoke | Drag one tiled window over
  an occupied target leaf, confirm the whole-leaf rectangle preview, release,
  and visually confirm nested split placement; do not attempt stale-harness
  recovery | [change](changes/archive/nested-placement-affordance.md)
- P1 | pending implementation | Implement the native effect-scoped KCM now
  that the development session has been restarted and its committed dependency
  is available | [change](changes/native-effect-kcm.md)
- P1 | implementation present, pending live | Accept the active-window border
  using the required Nix-built native effect and exact host KWin ABI/session
  discovery | [decision](decisions.md#native-active-border)
- P1 | static partial, blocked integration | Route the tray lifecycle launcher
  through the accepted static harness before live carrier validation | [change](changes/tray-carrier.md)
- P1 | pending implementation and live | Complete tray MVP basic status and
  Settings, then validate SNI delivery, packaging, panel, and login-autostart
  behavior | [change](changes/tray-carrier.md)
- P1 | pending implementation | Add Nix-first current-host package and
  install/update outputs without changing the external consumer repository |
  [change](changes/nix-current-host-delivery.md)
- P1 | pending live | Validate clean install, update, rollback, and session
  lifecycle behavior on the current host | [change](changes/nix-current-host-delivery.md)

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
