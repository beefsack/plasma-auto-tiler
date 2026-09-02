# Tray Carrier And Bridge

## Goal

Deliver the tray MVP: basic status and Settings through one portable Rust
StatusNotifierItem carrier with a KWin-first backend and a safe fixed D-Bus
bridge.

## Scope And Non-Goals

- The carrier has one SNI identity, icon, and title. It reports `Active` when
  enabled, `Passive` when disabled, and `NeedsAttention` when unavailable or
  stale.
- The bridge permits only authenticated, whitelisted state snapshots and the
  guarded fixed Settings action. It has no shell, input, or helper-to-KWin
  action/control route.
- The helper remains optional for core tiling. Lifecycle operations fail closed
  and restore only exact project-owned artifacts.
- The MVP has no direct tiling controls and does not expand the helper boundary.
- Hostile same-user copied-binary attack scenarios remain out of scope; the
  identity checks do not claim protection against a copied trusted binary.

## Acceptance

- Static MVP implementation and validation are accepted.
- KWin-origin live SNI, the real panel, fixed KCM discovery/launch, native ABI
  build/load, real install/packaging, and login/autostart remain pending.
- No live test result is claimed.

## Approach And Dependencies

- KWin owns authenticated snapshots; freshness watchdog, ordering/generation
  protections, idempotent SNI/DBusMenu notifications, and bounded watcher
  retry/fail-closed behavior protect the carrier boundary.
- The sender must own `org.kde.KWin` and match the canonical executable
  identity of an exact current-system or `/usr/bin` KWin entrypoint. Other
  same-user basename or Nix-store matches are rejected.
- Settings is exactly one guarded fixed
  `kcmshell6 kwin/effects/configs/plasma-auto-tiler-active-border_config`
  action.
- Packaging and user-local binary lifecycle remain dependencies of live and
  release acceptance; the helper is not required for core tiling.

## Outcome And Evidence

- The static tray MVP provides the single portable Rust SNI identity/icon/title,
  the three accepted status states, basic status, and the fixed Settings action.
- Source includes authenticated KWin snapshot ownership, freshness watchdog,
  ordering/generation protections, idempotent SNI/DBusMenu notifications, and
  bounded watcher retry/fail-closed behavior.
- The helper has no KWin action/control route.
- Independent security review found that basename-only KWin authorization could
  accept an arbitrary same-user binary. The final exact-entrypoint identity
  binding repairs that finding; the broad Nix-store allowlist approach was
  rejected as insufficient.
- Static evidence passed: `cargo fmt --check`, 69 Rust tests (40 unit, 9
  endpoint integration, 20 lifecycle integration), and `cargo build --release`.
  The hermetic 05a harness passed 19 lifecycle and 4 self checks. KWin static
  tests passed 1051 tests; TypeScript typecheck and bundle build passed.
- These are static checks only. KWin-origin live SNI, the real panel, fixed KCM
  discovery/launch, native ABI build/load, real install/packaging, and
  login/autostart have not been tested.

## Next Action

Retain the six residual live/release gates: KWin-origin live SNI, real panel,
fixed KCM discovery/launch, native ABI build/load, real install/packaging, and
login/autostart. Perform them only with the required separate authorization;
until then, make no live-test claim.

## Material Decisions And Accepted Evidence

- The helper remains optional to core tiling, and the MVP boundary is basic
  status plus Settings with no direct tiling controls or helper-to-KWin route.
- KWin snapshot authority is tied to exact host-system executable identities,
  not a process basename or arbitrary Nix-store package.
- Static completion is accepted. The residual live and release gates remain
  explicitly pending.
