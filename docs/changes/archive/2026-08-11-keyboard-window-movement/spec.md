# Specification: Keyboard Window Movement

Status: static scope completed and archived on 2026-08-11.

## Intent

Add four keyboard management actions that move the active eligible tiled window
to the nearest empty eligible authored leaf in the requested visual direction.
The move performs one KWin tile assignment and is not a swap.

## Scope

- Register `plasma-auto-tiler-move-left` / `Move window left` /
  `Meta+Alt+Shift+H`, `plasma-auto-tiler-move-down` / `Move window down` /
  `Meta+Alt+Shift+J`, `plasma-auto-tiler-move-up` / `Move window up` /
  `Meta+Alt+Shift+K`, and `plasma-auto-tiler-move-right` / `Move window right` /
  `Meta+Alt+Shift+L` through the aggregate nine-action registration gate.
- Reuse the accepted directional facing-edge, overlap, distance, and tie rules.
  Movement candidates are distinct empty non-layout leaves only.
- Before the one tile assignment, validate the active window, exact output object
  and desktop scope, source association, target direction, target emptiness, and
  unchanged source/target occupancy and scope. Assignment failure is inert and
  emits only a fixed private diagnostic.
- On success, reconcile controller occupancy so later focus, movement, insertion,
  and automatic placement observe the source as empty and target as occupied.

## Exclusions

- No swap, topology mutation, cross-output or desktop movement, split creation,
  preset realization, persistence, UI/configuration, or live KWin work.
- Do not modify the parked live harness or the untracked technical report.

## Acceptance

- All nine actions register atomically at the existing gate and failed registration
  leaves callbacks inert.
- Directional selection skips occupied, layout, malformed, out-of-scope, and
  non-directional leaves, retaining focus-equivalent deterministic ties.
- Revalidation failures, no target, and assignment throws make no tile write and
  retain bookkeeping; diagnostics are fixed and private.
- A success makes exactly one assignment and subsequent controller behavior sees
  the active window at target with the source empty.
- Typecheck, build, complete tests, and generated-bundle hash are recorded.
