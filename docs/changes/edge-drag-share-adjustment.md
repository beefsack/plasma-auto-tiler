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
  before reconciliation. `kwin/src/plan-adapter.ts:1410-1500` writes only
  changed neighbours and records that expectation.

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

- The native effect loaded, its session D-Bus endpoint answered, strict
  demarshalling worked, and KWin remained stable during the first real-hardware
  exercise.
- Twelve committed drags each produced, in order,
  `route-diag:drag-pull action=dispatch`, a non-cancelled `drag-verdict` with
  `reason=ok-moved`, then one `pointer-resize` `planned-applied` plan for three
  windows. This proves the pull ordering, reply association, neighbour writes,
  and physical share reflow.
- Esc produced `cancelled=true correlation=drag-11 reason=no-change` and no
  pointer-resize plan. The strict cancellation no-op holds live.

## Echo-Fence Diagnosis

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
- The reported visible gap loss is not caused by the spurious reconcile. Both
  pointer-resize and reconcile project the retained domain's identical inset
  bounds and gap; reconcile rejects domain/gap changes and never adopts client
  rectangles. The static path therefore cannot reproject without the selected
  `(DOMAIN_GAP, OUTER_DOMAIN_GAP) = (8, 8)`. The screenshot symptom remains
  unestablished as a separate live issue.

## User-Owned Live Checks

- After the user rebuilds and enables the updated production bundle in a new
  session, perform committed single-edge resizes in a stable three-window scope
  and wait for geometry to settle. Each journal sequence must end with one
  `pointer-resize` `planned-applied` and no immediate reconcile. Then verify
  the affected sibling and outer gaps remain visibly 8px. If a gap is lost
  without a reconcile, capture the bounded plan diagnostics and geometry for a
  separate cause; this change does not establish that cause.
