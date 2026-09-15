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

- The later exact authorized capture
  `/run/user/1000/plasma-auto-tiler-dev.pJOooO.log` resolves the former opaque
  settlement branch. `plan-1-w0` and `plan-1-w1` both commit and complete
  state-confirmed follow (lines 27, 44, 51-52 and 65, 80, 87-88). The later
  `plan-1-w2` has two planned geometry entries (line 91), consumes its mover
  and one geometry fence (lines 95-98), then rejects its one-shot settlement
  with `verify_reason=geometry-rect-mismatch verify_geo_idx=1
  fence_pending=1 fence_total=2 mover_seen=1 fence_idx=1` (line 101). It
  reports `adapter-lost`/diverged and timeout (lines 99-102). The file has no
  same-instance retry, availability, or refusal after the reported 15-second
  wait, so that later availability is not evidenced by this capture.
- `fence_idx=1` and `verify_geo_idx=1` are both plan-relative indices:
  `geoPending` maps its remaining window back to frozen `planned.geometry`,
  while the exact verifier iterates that same order. Thus entry 1 was still
  armed and its fresh rectangle differed from its planned rectangle; entry 0
  was the sole consumed geometry echo. This rules out a missing mover callback,
  unavailable settlement observation, and a focus verifier as the failure
  predicate. The redacted capture does not identify whether the unfulfilled
  geometry write was native adjustment, deferred convergence, or external
  drift.
- KWin 6.7.3 source confirms `frameGeometry` writes call `moveResize` and
  `frameGeometryChanged` reports actual geometry changes, while Wayland xdg
  configure application can be deferred and coalesced. That is compatible with
  the observed race but does not identify this unfulfilled entry's native
  cause. A candidate change to retain a geometry subscription across an
  intermediate echo was rejected: it cannot affect the captured entry 1,
  which emitted no consumable echo and remained mismatched at timeout. No code
  or behavior changed.

## Product Decision

- None. The known terminal policy is retained without a governance change.
- The unresolved work is to identify why planned geometry entry 1 did not
  converge to its exact rectangle and did not produce its confirmation. No
  recovery or terminal-policy redesign is selected.

## Backlog Recommendation

- Proposed factual update for the parent-owned backlog:
  `P0 | Workspace-send pre-ack timeout diagnosis | The pJOooO capture proves
  timeout settlement rejected plan geometry index 1 on exact rect mismatch
  while that same index remained the sole armed fence; mover was seen. Determine
  why that native geometry write neither converged nor confirmed before changing
  exact terminal policy. Visible display and border causation remain unproven.`
  Retain the existing record link and leave P1 unchanged.
