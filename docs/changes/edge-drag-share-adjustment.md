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

## Live-Unproven Claims

- Slice 1 has not proved KWin loads the packaged effect, exposes its session
  D-Bus endpoint, or delivers authoritative start/final geometry to it.
- Slice 2 has not proved real KWin D-Bus demarshalling/order, script-to-effect
  reply association, native neighbour writes, or physical share reflow.
- The first edge-drag test did not load the disabled-by-default oracle effect.
  It therefore did not exercise a verdict callback or the pointer route; the
  new dispatch line distinguishes that non-answering case without inferring a
  timeout.

## User-Owned Live Checks

- Slice 1: rebuild the KWin script and native effect in a new user session;
  enable only `plasma-auto-tiler-drag-oracle`; perform one committed single-edge
  resize and one Esc-cancelled resize; confirm one redacted `drag-verdict` line
  for each and `cancelled=true reason=no-change` for Esc. Confirm neither drag
  changes tile shares in Slice 1.
- Slice 2: after the Slice 1 check, enable the production script and repeat a
  deliberate single-edge resize in a stable tiled scope; confirm exactly one
  `pointer-resize` plan and the neighbouring share reflows. Repeat with Esc;
  confirm no `DescribePlan` pointer command and no share change. Confirm the
  planned neighbour-write echo produces no reconcile, while a constrained or
  mismatched neighbour write follows the existing maximum-three reconciliation
  policy.
