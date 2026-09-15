# Workspace Send Fences And Terminal Empty

## Goal

- Prevent a valid same-output send from being rejected while KWin has exposed
  membership but not all requested geometry, while retaining exact Rust-planned
  source and target reflow verification.

## Scope

- Fence the existing same-output tiled send transaction on the mover's public
  `desktopsChanged` and each changed window's `frameGeometryChanged` signals
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
  `desktopsChanged` and changed-window `frameGeometryChanged`. Exact
  post-observation, acknowledgement, verify, and follow remain ordered.
- Extra preexisting terminal empties can now retire only from the mapped
  native-order terminal run once every member is nonvisible and unoccupied;
  the first remains. No native border change was needed: `vye2tM` has no active
  border evidence, and missing follow explains the reported source view.
- Static verification passed. Live KWin behavior remains unverified; no desktop
  or session mutation occurred.

## 2026-09-15 P0 Update

- The exact `plC3QN` run rules out lone-window status as the sole cause. Its
  two-window `plan-1-w0` send is planned at lines 28-29; membership is consumed
  at line 32, one geometry wait is logged at line 34 and only one geometry echo
  is consumed at line 38. No accepted acknowledgement, verify, commit, or
  follow occurs before the adapter-lost acknowledgement at lines 42-43 and
  timeout at line 44. Later observations show the planned source survivor and
  moved target, so native writes did occur.
- KWin source corrects the old fence premise: `src/window.h:476-491,1467-1510`
  exposes writable `frameGeometry` with `frameGeometryChanged`, while
  `src/window.cpp:71-72` wires `moveResizedChanged` only to interactive
  start/finish. `src/window.cpp:3412-3420` routes a property write through
  `moveResize`; `src/waylandwindow.cpp:220-250` emits
  `frameGeometryChanged` when the actual frame changes. Both send entries now
  fence changed geometry on that public frame signal, retaining exact
  post-observation and terminal divergence behavior.
- Static tests reproduce the old interactive-signal deadlock and settle only on
  frame signals, cover same-adapter repeated `2->3->2->3` flights with source
  survivor and empty-source cases, and reject duplicate echoes. The production
  entry integration covers delayed `3->2->3`, follow/focus, populated target,
  and terminal-empty retirement. No live acceptance is claimed.
- Dynamic workspace lifecycle has partial user manual evidence of improvement;
  no unrelated trailing-empty cleanup is reopened. User pickup: clean Rust/TS
  teardown with Ctrl-C, then `just dev verbose` without logout; reproduce the
  unchanged workspace 2 -> 3 -> 2 -> 3 send/follow sequence.

## 2026-09-15 Later Lockup Outcome

- The exact `YlYhh5` incident records eight accepted, verified, and followed
  sends (`w0` through `w7`) before the first failure: a pre-flight
  `same-workspace` refusal at line 337, followed only by
  `workspace-move` busy refusals at lines 338-343 and 378-382. No later send
  activation, plan, acknowledgement, or verify appears. This confirms the
  same-target shortcut as the trigger for this lockup, not a geometry-fence
  regression.
- The KWin adapter had treated every pre-flight ineligible request as terminal:
  `refuse()` logged then disabled its one-shot startup instance. The entry then
  reported the disabled adapter as busy. Rust's same-domain `Unchanged` refusal
  creates no pending lifecycle state, so no Rust policy or transaction change
  was needed.
- Pre-flight refusal now records its exact token and returns without changing
  adapter availability. Bound-flight planner, stale, owner, generation,
  partial, and timeout divergence remains terminal. Offline adapter and
  production-entry tests cover valid send, same-target no-op with no native
  writes or follow, then a usable distinct send; terminal post-plan divergence
  remains disabled. No live acceptance is claimed.
