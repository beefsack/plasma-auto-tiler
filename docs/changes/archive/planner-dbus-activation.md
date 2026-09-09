# Planner D-Bus Activation

## Goal

Deliver the Linux/KWin Planner as an on-demand session D-Bus service without
changing the public `engineAuthorityMode=legacy` default.

## Scope

- Package `plasma-auto-tiler planner-service` with a session D-Bus activation
  descriptor and Home Manager-owned user `systemd` `Type=dbus` unit.
- Make selected KWin Rust adapters request one bounded activation before their
  existing unique-owner pin and planner request when the Planner name is absent.
- Preserve owner, correlation, stale, loss, and fail-closed semantics. No
  selected Rust command may fall back to Legacy.

## Non-Goals

- Live KWin, systemd, D-Bus, rebuild, activation, or service testing.
- A portable IPC/delivery layer, a second Planner process mode, or a public
  Rust-authority default.

## Acceptance

- The activation descriptor names `org.plasmaautotiler.Planner` and links the
  exact user unit; that unit uses an immutable package `ExecStart`, `Type=dbus`,
  the exact `BusName`, no shell, and bounded failure restart behavior.
- Home Manager owns the user-session files and package discovery. Its explicit
  Planner activation option defaults enabled when the module is imported: the
  descriptor is inert until a selected Rust KWin command requests it, so it has
  no idle process cost and does not alter Legacy authority.
- KWin activates only once while commands are pending, then resolves and pins
  one unique owner before a planner method call. Activation and post-activation
  failure refuse the Rust route closed, with no plan rebind after owner loss.
- Static Rust, KWin, Nix/module, and package-closure checks prove the contract.

## Plan

1. Inspect the existing Planner service and select the systemd/D-Bus package and
   Home Manager ownership boundary.
2. Add the KWin one-flight D-Bus activation transport with focused regressions.
3. Add package descriptor, user unit, Home Manager option, and evaluation checks.
4. Review, run focused verification, record the approved decision/outcome, and
   stage only this slice.

## Outcome

- The existing Planner binary now ships its immutable session D-Bus descriptor.
  Home Manager's default-enabled-on-import Planner option installs that package
  for discovery and defines the matching on-demand `Type=dbus` user unit.
  `Restart=no` preserves terminal Planner name-loss semantics; no shell,
  autostart target, user `kwinrc`, PID, or receipt state was added.
- Focus, movement, keyboard resize, and pointer resize first resolve the
  well-known name. A missing name takes one bounded activation path, accepts
  only result `1` or `2`, re-resolves and pins one unique owner, and never
  falls back to Legacy or rebinds a pending plan after service loss.
- Static verification passed: `cargo fmt --check`, cargo check, 50 focused
  Planner-service tests, strict lib/bin Clippy, KWin typecheck and 193 focused
  adapter tests, offline Nix module evaluation/build, immutable descriptor
  inspection, and `git diff --check`. No live session action was performed.
