# Workspace Send Timeout Observation

## Goal

- Determine whether the exact completed WLS1RE observation supports a safe
  correction for the first workspace-send timeout and its later same-instance
  refusal.

## Scope

- Correlate only the authorized WLS1RE log with the current static send and
  acknowledgement paths.
- Preserve exact accepted acknowledgement, verified commit, follow, and focus
  semantics.

## Non-Goals

- No live KWin, D-Bus, window, desktop, focus, or session action.
- No replay, reset, rebind, reseed, polling, queue, recovery loop, or false
  commit of uncertain native state.

## Outcome And Evidence

- The exact authorized WLS1RE capture for `plan-1-w0` records pre-write mover
  membership at lines 57 and 59, a consumed mover echo at line 60, and one
  consumed geometry echo at line 63. It has no `send-post-mover`, accepted
  acknowledgement, verify, or follow event for that correlation. Its later
  request deadline reports `adapter-lost` at lines 64-65 and
  `timeout-request` at line 66. Lines 84-85 then record two same-instance
  `busy-refused` sends. The user-owned visible display and border observation
  is not attributed to these native protocol stages.
- Source requires both the mover echo and every changed-geometry echo before
  `completePostWrite` can verify, emit `send-post-mover`, and acknowledge
  (`kwin/src/workspace-send-adapter.ts:1584-1803`). The incomplete fence held
  this send pre-ack. At the original deadline, one fresh exact settlement is
  allowed only when the observation and `verifyPlannedPost` both succeed
  (`kwin/src/workspace-send-adapter.ts:2471-2561`). It did not yield an
  accepted acknowledgement here, so the terminal path reported loss, diverged
  Rust, and disabled the adapter.
- The terminal record cannot distinguish a missing fresh observation,
  `stale-revision`, `post-observation-mismatch`, owner loss, or the later
  bounded acknowledgement setup failure. No current redacted token separates
  those branches. It therefore does not support changing the echo fence or
  treating the later planner observation as an earlier native verification.
- `disable()` makes the established terminal result directly explain the later
  refusal: `requestSend` refuses while disabled and the entry logs
  `busy-refused` without another request
  (`kwin/src/workspace-send-adapter.ts:856-905`,
  `kwin/src/plan-adapter-entry.ts:2035-2055`). Rust maps `adapter-lost` to
  divergent acknowledgement state (`src/planner_protocol.rs:2760-2808`,
  `src/reconcile.rs:906-908`).
- The established terminal policy remains: only an exact fresh post-observation
  can settle this pre-ack flight, while uncertain post-plan state remains
  terminal (`docs/decisions.md:346-354`). This policy does not explain why the
  already-authorized exact settlement did not pass. The missing predicate is an
  ordinary diagnostic boundary, not evidence that a recovery redesign is
  required. No recovery behavior was selected or changed by this record.
- Independent static review confirms the conclusion and existing
  product-shaped coverage: successful planned/acknowledged/verified/committed
  send, follow/focus, and a later same-instance send
  (`kwin/tests/plan-send-coordination.test.ts:386-539`); timeout settlement
  after complete convergence and later usability
  (`kwin/tests/workspace-send-adapter.test.ts:2549-2610`); and partial-geometry
  terminal loss with no commit
  (`kwin/tests/workspace-send-adapter.test.ts:2612-2673`). Focused offline checks pass:
  `npm run typecheck`; workspace-send adapter tests (86); plan-send
  coordination tests (5); workspace-native tests (39); `cargo test workspace
  --lib` (17); and `cargo test --test session_send_to_workspace` (4). No live
  KWin, D-Bus, window, desktop, focus, or session action occurred.

## Product Decision

- None. The known terminal policy is retained without a governance change.
- The unresolved work is to identify why the exact pre-ack settlement rejected
  its fresh observation or could not arm its acknowledgement continuation.

## Backlog Recommendation

- Proposed factual update for the parent-owned backlog:
  `P0 | Workspace-send pre-ack timeout diagnosis | WLS1RE proves a partial
  echo-fenced pre-ack send reached terminal adapter-lost and subsequent
  same-instance refusal, but not why the authorized exact timeout settlement
  failed. Preserve the existing terminal policy while one correlated
  reproduction identifies the rejected settlement predicate and remaining
  geometry fences. Visible display and border causation remain unproven.`
  Retain the existing record link and leave P1 unchanged.
