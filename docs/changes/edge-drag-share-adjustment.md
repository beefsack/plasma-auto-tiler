# Edge Drag Share Adjustment

## Scope

- Slice 1 adds a separate disabled-by-default inert `dragoracle` effect. It
  records KWin's authoritative start/final move-resize rectangles, exposes its
  last bounded verdict through one effect-owned read-only session D-Bus method,
  and makes the production script pull and strictly decode that verdict.
- Slice 2 uses only a non-cancelled verdict to send one strict production
  `DescribePlan` `pointer-resize` command. A cancelled verdict, including Esc
  and a committed net-zero drag, makes no planner call and changes no share.
- Slice 2 retains one correlation/source-keyed neighbour-write echo expectation.
  It is consumed only by same-scope planned neighbour rectangles; every other
  geometry mismatch follows bounded reconciliation.
- The initial implementation used no live KWin or Plasma action. This change
  selects no push transport, fallback, retry, timeout guess, or Planner
  pending-slot bypass.

## Evidence

- `kwin/native-effect/dragoracle.cpp:20-58` copies the Rust verdict under lock,
  registers the effect endpoint, reads `moveResizeGeometry()` on start/finish,
  and sends only POD data to Rust. `dragoracle.h:8-20` keeps the effect inactive
  with no paint hook.
- `kwin/native-effect/drag_oracle.rs:28-63` catches unwinds at each C ABI entry
  and emits bounded exact verdict reasons. `kwin/src/drag-oracle-pull.ts:30-106`
  strictly decodes those verdicts and prevents a cancelled one from routing.
- `kwin/src/plan-adapter-entry.ts:810-940` binds each asynchronous pull reply to
  its exact finish token and rejects a stale reply against a newer drag start.
  `kwin/src/plan-adapter.ts:825-865` constructs the one strict pointer command.
- `src/planner_protocol.rs:1533-1628` evaluates retained pointer resize through
  the normal acknowledgement and post-observation boundary.
- `kwin/src/plan-adapter.ts:1061-1131` consumes only the exact one-shot echo
  before reconciliation. `kwin/src/plan-adapter.ts:1410-1500` writes the
  retained projection and records a neighbour-only echo expectation.

## Static Verification

- Slice 1: `cargo test`, `npm test --prefix kwin` (409 pass),
  `npm run typecheck --prefix kwin`, `git diff --check`, CMake configure/build
  of `plasma-auto-tiler-drag-oracle`, and `ctest -R drag-oracle` (2 pass).
- Slice 2: `cargo test`, `npm test --prefix kwin` (426 pass),
  `npm run typecheck --prefix kwin`, and `git diff --check`.

## Follow-Up Diagnostics

- Every dispatched pull now logs exactly
  `plasma-auto-tiler:route-diag:drag-pull action=dispatch` before `callDBus`.
  The line is constant, bounded, redacted, and best-effort. It changes neither
  the no-timeout pull contract nor fail-closed routing; a dispatch without a
  later `drag-verdict` or `drag-unavailable` directly identifies a
  non-answering endpoint.
- Hermetic pull coverage proves the no-answer line, dispatch-before-reply
  ordering, bounded output, and that a throwing logger cannot prevent the
  D-Bus call.
- Follow-up static verification: `cargo test` (466 pass),
  `npm test --prefix kwin` (429 pass), `npm run typecheck --prefix kwin`, and
  `git diff --check` passed.

## Live Evidence

- One real-hardware KWin 6.7.4 session, in one three-window scope on one output,
  proved `isEffectSupported` true, explicit one-time enable with
  `EnabledByDefault: false`, effect load, endpoint response, strict
  demarshalling, pull ordering, and no KWin crash.
- Twelve committed drags each produced, in order,
  `route-diag:drag-pull action=dispatch`, then
  `route-diag:drag-verdict cancelled=false correlation=drag-N reason=ok-moved`,
  then `plan:cmd=plan-1-pN kind=pointer-resize windows=3 outcome=planned-applied`.
- One Esc-cancelled drag produced
  `drag-verdict cancelled=true correlation=drag-11 reason=no-change` and no
  pointer-resize plan. The strict no-op holds live.
- This evidence does not prove multi-output, more than three windows,
  non-horizontal splits, workspace/output boundaries, atomicity,
  acknowledgement, or stock-KWin parity.

## Later Static-Only Fixes

- The live evidence above predates both the echo-fence fix and the source
  reassertion fix. Neither has run live.

### Echo Fence

- The planned neighbour-write echo can equal `lastGood` exactly. The equality
  fast paths at `kwin/src/plan-adapter.ts:1016-1045` returned before the echo
  fence at `:1061-1085`, leaving its one-shot expectation armed. The next
  same-scope geometry observation then consumed that stale expectation or
  mismatched it and dispatched a reconcile. This timing-dependent ordering
  explains why the live failure was intermittent.
- The equality fast paths now clear the one-shot expectation. This retains the
  exact neighbour-rectangle match and one-shot semantics; it neither adds a
  tolerance nor changes the mismatch reconciliation policy. Hermetic coverage
  proves that a source-only drift following an exact echo reaches reconcile
  instead of being swallowed by the stale expectation.
- The user reported visible gap loss before the source reassertion fix. It has
  not been visually confirmed fixed.

### Source Reassertion

- The pointer-resize reply contains the complete retained projection, including
  the dragged source's gap-inset rectangle. `kwin/src/plan-adapter.ts:1412-1415`
  previously removed that source from the native write set, although KWin leaves
  it at its raw pointer rectangle after interactive resize. The adapter then
  recorded the retained source in `lastGood` at `:1480-1501` without writing it.
  This left the source flush against a correctly projected neighbour.
- Pointer application now writes the complete retained projection. The one-shot
  echo remains neighbour-only: it still expects only the geometry writes that
  can arrive asynchronously after the source reassertion. Hermetic KWin coverage
  applies a projection with an 8px sibling separation and asserts the applied
  source and neighbour rectangles retain exactly that gap.
- `deriveOracleEdge` correctly supplies the raw leading edge for left/up and
  trailing edge for right/down as the planner's preceding-sibling boundary. The
  retained projection applies the gap after that boundary, so no gap-coordinate
  conversion is needed.

## User-Owned Live Checks

- One consolidated gate covers the static-only echo-fence and source-reassertion
  fixes: after rebuilding and enabling the updated production bundle in a new
  session, perform committed left, right, up, and down single-edge resizes in a
  stable three-window scope and wait for geometry to settle. Each journal
  sequence must end with one `pointer-resize` `planned-applied` and no immediate
  reconcile. Verify each affected sibling and outer gap is visibly 8px. If a
  gap is lost, capture the bounded plan diagnostics and geometry for a separate
  cause.
