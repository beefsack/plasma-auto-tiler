# Workspace Send Fences And Terminal Empty

## Goal

- Prevent a valid same-output send from being rejected while KWin has exposed
  membership but not all requested geometry, while retaining exact Rust-planned
  source and target reflow verification.

## Scope

- Fence the existing same-output tiled send transaction on the mover's public
  `desktopsChanged` and each changed window's `moveResizedChanged` signals
  before its accepted acknowledgement.
- Collapse only safe extra desktops in the mapped literal terminal empty run,
  including preexisting terminal empties, while retaining its first desktop.
- Keep the existing one-flight timeout and every stale, owner, generation,
  partial-write, and postcondition failure terminal and fail-closed.

## Non-Goals

- Retries, polling, fallback topology, automatic rebind, native rollback, or
  changes to selection, eligibility, and follow policy.

## Incident Evidence

- Previous `TeFwil` evidence motivated the mover membership fence only.
- Primary `vye2tM` evidence records `plan-1-w0` planned at lines 42-43, then
  synthetic `adapter-lost` at line 44 and TS `post-observation-mismatch` at
  line 48 before acknowledgement, verify, or follow. Lines 124-129 later show
  the mover and populated target at the exact planned membership and geometry.
  The empty source is therefore valid; membership became visible before all
  geometry was observable.

## Approach

- Arm one-shot mover membership and changed-window geometry subscriptions
  before native writes. Verify and acknowledge only after every required echo;
  unchanged geometry requires no echo.
- Detach all subscriptions on completion and terminal paths. Keep exact
  geometry and membership equality checks unchanged.
- After native follow makes the target current, retire only extra safe members
  of the native-order terminal empty run. Do not retire occupied, visible,
  current, intermediate, or unmapped desktops.

## Verification

- Typecheck and direct KWin tests cover delayed membership and geometry echoes,
  exact target/source geometry, empty source, commit-before-follow, terminal
  retirement after follow, safety bounds, and repeated sends.

## Outcome And Evidence

- The production Plan and standalone entries subscribe to mover
  `desktopsChanged` and changed-window `moveResizedChanged`. Exact
  post-observation, acknowledgement, verify, and follow remain ordered.
- Extra preexisting terminal empties can now retire only from the mapped
  native-order terminal run once every member is nonvisible and unoccupied;
  the first remains. No native border change was needed: `vye2tM` has no active
  border evidence, and missing follow explains the reported source view.
- Static verification passed. Live KWin behavior remains unverified; no desktop
  or session mutation occurred.
