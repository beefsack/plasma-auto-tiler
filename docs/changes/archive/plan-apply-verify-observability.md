# Plan Apply And Verify Observability

## Goal

- Add normal, correlated lifecycle evidence for ordinary active Plan reply
  validation and native application without inventing acknowledgement or verify
  phases where the route has none.

## Scope

- Instrument existing ordinary Plan reply, validation, native application, and
  terminal boundaries in `PlanAdapter`.
- Reuse existing correlation, generation, revision, component, route, KWin sink,
  bounded fields, and trace-only geometry detail.
- Add production-shaped tests for ordinary success, refusal/malformed/stale
  replies, native skips/failures, observation uncertainty, logging safety, and
  callback fencing.

## Non-Goals

- No transport/activation behavior change, native reads or writes, D-Bus calls,
  retry/recovery/timer/pending changes, or public-response change.
- No specialized workspace-send/R4 cancellation rewrite, tray work, ambient
  topology lineage, live testing, dependency, Rust, or native changes.

## Acceptance

- Normal records truthfully distinguish received/validated replies, application
  start/outcome, existing observation boundaries, and terminal certainty or
  uncertainty with bounded reasons and no sensitive values.
- Logs remain best-effort and stale/duplicate callbacks remain non-transitions.
- Focused KWin coverage, typecheck, full KWin tests, and production build pass.

## Normal Contract

- Records use the existing
  `plasma-auto-tiler:plan:cmd=<correlation> ... component=<component>
  route=<route> stage=<stage> correlation=<correlation>
  generation=<generation> revision=<revision> event=<event>
  outcome=<outcome> cause=<cause>` KWin sink.
- After the existing Planner send and accepted callback fence, `reply/received`
  precedes `reply/validate` as `validated`, `rejected`, `malformed`, or `stale`.
  Pre-plan records retain request revision; a validated plan carries its base
  revision, or `unavailable` when the reply truthfully has none.
- A validated ordinary plan records fresh `observe/matched|mismatched`, then
  `apply/started`. One aggregate `apply/setters` record summarizes normal
  setter success, write failure, or a bounded skip category without window ids
  or geometry.
- `terminal/settled` records `applied`, `rejected`, `uncertain`, or reply-wait
  `timeout` with its actual last phase. `applied` means the existing KWin-side
  application path completed; it does not assert a compositor pixel result.
- Ordinary routes have no ack/verify protocol. No ack, verify, or verified
  record is emitted. R4 transfer/cancel paths remain owned by their existing
  specialized diagnostics.

## Outcome And Evidence

- Added logging only in `kwin/src/plan-adapter.ts`. All records use the existing
  best-effort logger guard; no D-Bus/native calls, state, timer, recovery,
  callback, or public-response behavior changed.
- `just dev verbose` captures normal KWin records as `[kwin]` and Planner
  summaries as `[planner]`; `just dev trace` adds existing trace-only detail.
  No live capture occurred.
- Passed: focused `plan-adapter` suite (143 tests), `npm run typecheck`,
  production build, and full `npm test` (929 tests).
- Behavioral evidence covers exact reply/application order, rejection/malformed
  and stale fences, aggregate exceptional skips, write failure, observation and
  reply timeout uncertainty, duplicate/late inertness, logger noninterference,
  correlation continuity, and R4/cancel exclusion.
