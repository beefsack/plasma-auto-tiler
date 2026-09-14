# Intentional Floating

## Goal

- Ship the intentional COSMIC-grounded floating toggle MVP without live KWin or
  Plasma mutation. `Meta+G` toggles the active eligible window between the
  planner's tiled membership and session-local floating state.

## Scope

- Float detaches the window from its KWin tile, places it centered at 60% of
  the active work area, and removes it from the planner tree. Unfloat is fresh
  planner admission, never restoration of the prior leaf.
- Fullscreen and maximized active windows refuse. Sticky is not registered in
  this slice: source establishes a writable KWin property but not a static-only
  lifecycle contract sufficient to claim its restoration behavior.
- No KGlobalAccel mutation, KWin script lifecycle action, window action, or
  other live KWin/Plasma mutation is performed for this change.

## Evidence Plan

- Unit coverage proves shortcut registration, state transitions, geometry,
  planner removal/re-admission, and fullscreen/maximize refusals.
- Verify the cited COSMIC source at the supplied checkout and KWin's sticky
  scripting surface statically. Enumerate KGlobalAccel read-only for the two
  proposed chords.
- Run the repository baseline commands before and after the edit.

## Decision

- COSMIC's `ToggleWindowFloating` binding and its `tiling_layer.unmap` then
  `floating_layer.map` / fresh `tiling_layer.map` route select removal and
  fresh admission rather than retained tile-slot restoration.

## Outcome

- `kwin/src/plan-adapter-entry.ts` registers `plasma-auto-tiler-float-toggle`
  for `Meta+G`, tracks session-local floating identities, detaches and centers
  the target, then feeds the existing membership removal/admission path.
  `kwin/src/plan-adapter.ts` supports an empty surviving tiled set and refuses
  tiled commands while the active window is intentionally floating.
- Static KGlobalAccel enumeration called `allComponents`, then
  `allShortcutInfos("default")` on every returned component. `Meta+G`
  (`268435527`) is held by `kwin` / `Grid View`; `Meta+Shift+G`
  (`301989959`) has no holder. No shortcut write occurred.
- KWin source `src/window.h:354` exposes writable `onAllDesktops`; sticky is
  deferred because no static-only evidence establishes safe desktop-membership
  restoration.

## Accepted Evidence

- Before: `cargo test` 251 unit tests plus the existing integration suites;
  `npm test --prefix kwin` 523; typecheck and format passed; dev-loop
  `PASS=277`.
- After: `cargo test` 251 unit tests plus the same integration suites;
  `npm test --prefix kwin` 525; typecheck and format passed; dev-loop
  `PASS=277`.
- No live KWin/Plasma mutation, lifecycle action, physical shortcut, or visual
  observation occurred. Runtime shortcut delivery and KWin behavior remain
  live-unproven.
