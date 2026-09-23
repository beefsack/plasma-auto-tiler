# Plan Transport Activation Observability

## Goal

- Add normal, correlated diagnostics for the active Plan transport activation,
  owner pinning, and request-send sequence.

## Scope

- Instrument existing `PlanAdapter` callbacks for service presence, activation,
  unique-owner resolution/pinning, request handoff, and their bounded terminal
  outcomes.
- Reuse the existing Plan correlation, generation, request revision, component,
  route, normal KWin sink, and bounded fields.
- Add focused production-shaped adapter coverage for accepted transitions,
  malformed/throw/timeout/owner-loss paths, ordering, redaction, and logging
  noninterference.

## Non-Goals

- No change to D-Bus call order/count, activation, recovery, retries, owner
  selection, deadlines, callbacks, pending state, public replies, or native
  application.
- No workspace-send/R4 cancellation, ordinary apply/verify, tray, ambient
  topology, live-session, dependency, Rust, or capture-wiring behavior change.

## Normal Contract

- Every normal record uses the existing `plasma-auto-tiler:plan:cmd=` sink with
  `component`, `route`, `stage=activate`, `correlation`, `generation`,
  `revision`, `event`, `outcome`, and `cause`.
- Initiations are `presence/presence-requested`, `resolve/resolve-requested`,
  `start/start-requested`, and `send/send-requested`. Accepted progress is
  `presence/present|absent`, `resolve/owner-pinned`,
  `start-result/start-primary|start-already`, and `send/request-sent`.
- Bounded terminal detail is `presence-malformed|presence-throw|name-loss`,
  `owner-malformed|owner-changed|resolve-throw`, `start-throw`,
  `start-refused|start-malformed`, `send-throw`, or
  `timeout/timeout cause=presence|resolve|start|start-resolve`.
- Pre-call records mean only that KWin initiated the fixed transport call;
  `request-sent` means the existing Planner call returned. None claims Planner
  processing. All records reuse the Planner request correlation, which joins
  the current Rust `plan-summary` ingress and egress lines.

## Approach

- Use the current `lifecycleDiag` sink and only existing control-flow branches;
  represent unavailable revisions truthfully with its existing bounded value.
- Keep the assessment historical and update its completed recommendation only
  after evidence is accepted.

## Outcome And Evidence

- Added logging only in `kwin/src/plan-adapter.ts`; its existing best-effort
  logger guard preserves D-Bus calls/order, state, deadlines, recovery, and
  public responses. Accepted callback fencing remains before callback records;
  stale, late, and duplicate callbacks are silent.
- `just dev verbose` captures these normal KWin records as `[kwin]` and Planner
  summaries as `[planner]`; `just dev trace` retains that capture and adds its
  existing trace-only detail. No live capture was run.
- Passed: focused `plan-planner-loss-recovery` suite (22 tests), focused
  `plan-adapter` suite (133 tests), `npm run typecheck`, and `npm test`
  (919 tests, including the production bundle).
- Before acceptance, two stale lifecycle assertions were newly reobserved in
  `kwin/tests/plan-adapter.test.ts`, despite an earlier reported full-suite
  success. A fresh detached `aeeb846` worktree using the same esbuild and Node
  binaries reproduced 907 pass and the same two failures. The test-only
  correction now asserts exact `stage=request event=dispatch outcome=started`
  fields, correlation continuity, bounded vocabulary, and no owner echo; it
  does not change production behavior.
