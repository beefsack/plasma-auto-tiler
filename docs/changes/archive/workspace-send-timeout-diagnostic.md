# Workspace Send Timeout Diagnostic

## Goal

- Identify the exact rejected pre-ack timeout-settlement predicate for one
  correlated workspace send without changing its safety or terminal behavior.

## Scope

- Add one best-effort, redacted timeout-settlement observation at the existing
  deadline boundary.
- Record the fence count and remaining stable plan-relative geometry indices,
  settlement gate, fresh-observation availability, and exact verification
  category.
- Correct the prior timeout record to separate the established terminal policy
  from the unresolved settlement cause.

## Non-Goals

- No change to exact acknowledgement, verification, commit, native writes,
  echo fencing, retry, replay, recovery, re-enable, polling, or follow.
- No raw native identifiers, captions, application data, payloads, or geometry
  values in diagnostics.

## Acceptance

- A planned pre-ack timeout reports one bounded correlated diagnostic that
  distinguishes owner-gate failure, unavailable observation, exact verification
  category, invalid payload, timer setup, and post-setup owner loss.
- Geometry fence diagnostics retain only count and stable opaque plan-relative
  indices.
- Focused tests prove the diagnostic branches and that settlement/terminal
  outcomes are unchanged.

## Outcome And Evidence

- WLS1RE proves the planned pre-ack flight reached its deadline with mover echo
  consumed and one geometry echo consumed, but no completed post-write
  observation or normal acknowledgement. It does not establish which exact
  timeout-settlement predicate rejected the flight. Later planner observations
  cannot be used as an earlier settlement observation because combined sinks
  have no total causal order.
- The timeout path now emits one best-effort `event=timeout-settle` line only
  for a planned, unverified, unacknowledged pre-ack flight. It names
  `fresh-unavailable`, `verify-failed`, `payload-invalid`,
  `schedule-unavailable`, `owner-invalid`, or `settled`. Verification detail is
  a redacted scope, geometry, observed-count, mover-membership, or retained
  membership category, with a plan-relative geometry index where applicable.
- `fence_total`, `fence_pending`, and `fence_idx` identify only the actually
  armed changed-geometry fence, not all planned geometry. `mover_seen` reports
  the existing membership fence. The line contains no native ids, geometry
  values, captions, app data, payloads, owner, focus data, or object refs.
- Focus is not a `verifyPlannedPost` comparator in this pre-ack path, so no
  focus mismatch token is emitted; its absence is source-defined rather than
  an unobserved diagnostic branch.
- Exact acknowledgement, verification, commit, follow, native writes, echo
  fencing, deadlines, and terminal disablement remain unchanged. Diagnostic
  failures are caught before they can change settlement.
- Focused offline checks pass: `npm run typecheck`; bundled
  `workspace-send-adapter.test.ts` (92 tests). Tests cover unavailable
  observation, scope, geometry, membership, successful settlement with a
  two-of-three armed fence, and a throwing timeout diagnostic with successful
  exact commit. No live KWin, D-Bus, window, desktop, focus, or session action
  occurred.
