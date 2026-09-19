# Window Alignment Drag Investigation

## Finding

- Firefox accepts full-height admission and restart restoration; Ghostty's
  persistent short frame remains a separate native per-window constraint
  candidate.
- The replaced `/tmp/dev.log` is `just dev trace`, not `just dev verbose`
  output (`:2,83-84`). It records normal two-window `DP-6` same-scope
  reconcile replies at `:190-257` and writes Firefox back to the retained
  right-hand rectangle while the user holds the shared edge.
- The trace has `drag-pull action=dispatch` at `:230,259`, but no callback,
  verdict, refusal, or `pointer-resize` plan. Ordinary reconciliation, not
  oracle routing, fought the held native resize and parked at `:209,256`.
- The rebuilt-effect warning at `/tmp/dev.log:35-39` is an unconditional
  `justfile:883` staging message, not current effect/service state.

## Correction

- `PlanAdapter` now suppresses only foreground ordinary `reconcile` flights
  while the entry tracks an exact `move === false && resize === true` native
  interaction. A pre-start foreground reconcile is invalidated without a
  geometry write or reconciliation-budget consumption; late callbacks are
  ignored. Background reconciliation and selected work-area reprojection
  remain outside this guard.
- This cancellation drops only KWin's local reply application. `DescribePlan`
  is stateful, but same-bounds `reconcile` is a completed retained projection:
  it stages no Session pending transaction or share/topology change before its
  reply. A later finish resync therefore remains a normal same-session plan.
- The entry requires paired `interactiveMoveResizeStarted` and
  `interactiveMoveResizeFinished` subscriptions before tracking a window.
  Finish clears the exact object-reference guard and uses the adapter's
  existing debounced normal resync. That reasserts retained allocation only;
  it never derives split shares from final native geometry.
- A valid oracle pointer route clears the queued finish resync before it
  dispatches `pointer-resize`, retaining selected native-final-geometry
  authority for intentional shared-boundary changes. If its reply arrives
  after the finish resync dispatches, it cancels that local reconcile reply;
  if the reconcile already wrote, the pointer route still plans and applies
  the oracle-derived boundary.

## Evidence

- A callback must log `drag-verdict` or `drag-reply-invalid`
  (`kwin/src/drag-oracle-pull.ts:77-101`); only a parsed, non-cancelled
  verdict can reach pointer resize (`plan-adapter-entry.ts:2937-2988`).
- The ordinary path is `frameGeometryChanged` subscription
  (`plan-adapter-entry.ts:1743-1803,2192-2199`), foreground drift scheduling
  (`plan-adapter.ts:1728-1998`), and reply-bound geometry writes
  (`:3077-3214`). The guard is local to foreground reconcile operations;
  paired native interaction tracking stays alongside existing oracle starts.
- The active effect's `LastVerdict()` endpoint is read-only
  (`kwin/native-effect/dragoracle.cpp:20-35`).

## Verification

- Hermetic adapter replay covers a pre-start in-flight reconcile, three held
  geometry changes, no held writes or budget consumption, finish correction,
  and pointer-route preemption (`kwin/tests/plan-adapter.test.ts`).
- Hermetic production-entry replay covers paired native start/finish signals,
  held `frameGeometryChanged`, an oracle pull with no callback, and one
  retained finish reconcile. It also covers delayed valid oracle callbacks
  before and after a finish-reconcile reply
  (`kwin/tests/slice2-pointer-route.test.ts`).
- Planner protocol coverage proves a discarded reconcile reply leaves the
  retained session ready for a finish reconcile and a later pointer-resize
  share adjustment (`src/planner_protocol.rs`).
- `npm run typecheck --prefix kwin` passed.
- `cargo test --lib planner_protocol` passed: 84 tests.
- `npm run build --prefix kwin` passed.
- `npm test --prefix kwin` passed: 782 tests.
- `git diff --check` passed.

## Limits

- No live KWin, Plasma, D-Bus, or host mutation was performed. Current native
  signal timing and the inactive oracle remain unverified on-device.
