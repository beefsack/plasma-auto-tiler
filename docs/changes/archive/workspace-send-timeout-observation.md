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
- The later exact authorized WwQ9G6 capture records `plan-1-w0` through
  `plan-1-w18` as committed sends, each followed by `follow-settled`; its last
  send, `plan-1-w19`, is planned at lines 720-721, has only intervening
  `busy-refused` entries at lines 728-735, then reports pre-commit
  `adapter-lost`/diverged at lines 738-739. It emits no `timeout-settle`
  diagnostic. This is a pre-ack loss category, not the pJOooO
  timeout-settlement `geometry-rect-mismatch`; it does not identify a native
  cause, establish a reliability improvement, or attribute the user's visible
  successes to any protocol change. The capture reports the default configured
  gaps, `gap=8` and `outer_gap=8`, throughout.
- w19 KWin emits dispatched (718), owner-pinned (719), pre-mover (722), and
  fence events (723-727), then no post-mover/plan/ack/verify/follow/
  timeout-settle/result; Rust reports planned (720-721) then `adapter-lost`
  (738)/diverged (739). Source admits `adapter-lost` after a valid plan via
  `pending.operation`, while `failFlight` always logs `event=result`; only
  direct pre-ack `disable()` reports loss with no result. The log/source pair
  therefore does not identify a product-native cause, an accepted ack, or a
  timeout predicate. w18 completes normally. pJOooO rect mismatch and
  committed-but-invisible follow remain distinct.
- Narrow diagnostic-only correction: silent pre-ack `disable()` now emits one
  best-effort redacted `event=disable-terminal` line before the bounded loss
  report, reusing the `timeoutFenceDetail`/`timeoutVerifyDetail` shapes
  (`fence_pending`/`fence_total`/`mover_seen`/`fence_idx` plus `verify_reason`/
  `verify_geo_idx`: `scope-*` for the `stale-revision` branch versus
  geometry/membership reasons for `post-observation-mismatch`, `none` when no
  fresh observation exists, `ok` when converged but echoes withheld). Presence
  of the line proves direct disable teardown versus unknown log delivery.
  Diagnostic failure is ignored and never changes teardown, timer, fence, or
  enablement. It does not reconstruct the historical w19 path and claims no
  source binding for it.
- The later exact authorized LNq6hA capture has a distinct terminal shape. Its
  `plan-1-w0` send is planned with two geometry entries, then consumes the mover
  and only one geometry fence; timeout settlement reports
  `geometry-rect-mismatch`, `verify_geo_idx=1`, `fence_pending=1`, and
  `fence_idx=1`. It has no post-mover observation, accepted acknowledgement,
  verify, commit, or follow event. Thus the user-reported unchanged visible
  workspace is not a failed follow: follow was not eligible to run. The
  plan-relative second geometry entry remained both pending and mismatched.
- The Planner and KWin sinks have no common ordering. The later target-domain
  observations establish only that a later observation saw the target geometry;
  they cannot verify the earlier send. The capture has no marker for the user's
  manual workspace visit or Ctrl-C, so it neither attributes the terminal loss
  to shutdown nor orders the visit against timeout settlement.
- Current source writes the target-domain geometry before mover membership and
  binds a `frameGeometryChanged` fence for every changed planned geometry. It
  cannot acknowledge, commit, or follow until the mover and every such geometry
  echo arrive (`kwin/src/workspace-send-adapter.ts:1630-1707,1797-1846,
  2136-2182`). The subscriptions are installed before writes, and unchanged
  geometry is excluded from the fence. No source or host-native evidence proves
  that KWin suppresses or defers a hidden-workspace geometry signal; that remains
  a possible native cause, not a supported correction. The existing one-shot
  exact timeout settlement is the only allowed signal-independent reconciliation
  (`kwin/src/workspace-send-adapter.ts:2515-2667`).
- Separately, ordinary observation selects the active output's current desktop.
  Startup, window addition, and a move into a non-current target therefore do
  not tile that hidden domain until it becomes current. This explains the
  reported stale hidden-domain layout/panel preview coverage, but does not prove
  the LNq6hA geometry fence cause
  (`kwin/src/plan-adapter-entry.ts:917-941,994-1018`). General hidden-domain
  tiling would broaden product behavior and is not selected here.

## Legacy Route Comparison

- The regression reference is `4605c61b7df9f738292037c46c32f000785e821c`
  (`be8e898^`), immediately before `be8e898` removed the legacy runtime. Its
  tiled route wrote only the mover's `[target]` desktop membership, scheduled
  deferred Custom Tile adoption, then switched that mover's output to the
  target desktop. It did not write `activeWindow` directly.
- The current Rust route likewise writes only the mover's `[target]` desktop
  membership. Its full two-domain direct geometry writes, pre-write
  `desktopsChanged`/`frameGeometryChanged` fence, exact post-write observation,
  accepted ack, verify commit, then switch-and-focus order are required by the
  Rust transaction. They are not evidence that replacing the legacy group route
  itself caused either captured failure.
- Current production follows through `setCurrentDesktopForScreen` with stable
  desktop-id readback and then focuses the mover after commit. This preserves
  the legacy switch-before-focus observable order while avoiding the already
  corrected wrapper-identity mistake. The one committed resync replaces legacy
  inline cleanup/deferred adoption; no missing resync gate is evidenced.
- Legacy always selected the mover's output. Current follow can fall back to
  `activeScreen` and then the first screen when active-window output is absent.
  That is a possible multi-output parity difference, but the relevant captures
  provide no multi-output attribution and dispatch refuses absent/non-tiled
  focus. Pinning another output through the transaction would add state without
  a demonstrated defect.
- No supported behavior correction follows from this comparison. `w19` remains
  an unresolved pre-ack direct-disable/log-delivery boundary, while pJOooO
  remains a separately proven exact geometry mismatch.

## Product Decision

- Historical at the time: diagnostic only, with follow withheld until the full
  exact transaction. This is superseded by the authorized graceful native-move
  follow decision in `docs/decisions.md`: one fresh exact mover-membership
  observation may switch/focus before unrelated geometry convergence, while the
  original full acknowledgement/verification/commit gate remains unchanged.
- The unresolved work is still to identify why planned geometry entry 1 did not
  converge to its exact rectangle and did not produce its confirmation. This
  correction does not attribute or repair that native geometry cause, select
  recovery, or claim rendered success.
- Subsequent USER VISUAL/MANUAL acceptance is: "The issue appears to be fixed, I spam moved a window between many workspaces and it never failed. ... reinforces ... graceful handling ... actually feel really good even when spamming." The supplied
  `/run/user/1000/plasma-auto-tiler-dev.E2E0QJ.log` is NOT ANALYZED. This accepts
  move/follow usability only, not a machine protocol, native-cause, layout
  commit, rendered-visibility, or recovery claim.
- Background tiling for non-visible workspaces is now selected separately for
  startup and window open/move without visibility or focus changes. Its
  implementation remains pending.

## Latest Bounded Investigation

- The exact authorized ARTNue occurrence resolves only an entry-contract
  boundary behind its `write_return=1`: the entry discarded `Reflect.set`'s
  boolean and reported success whenever the assignment did not throw. ARTNue records the
  target-retained geometry write before the mover write (lines 56-57), both
  immediate readbacks unavailable, only the mover geometry echo consumed
  (line 62), then a target-retained height mismatch of `+486` with its fence
  still pending (line 65). The established 15-second user wait excludes a
  merely delayed follow; no accepted acknowledgement, verify, commit, or
  follow was eligible. The log does not establish whether KWin silently
  rejected or deferred that setter.
- The entry now propagates `Reflect.set(target, "frameGeometry", rect)`'s
  JavaScript property-write result. This makes an engine-level property
  rejection an immediate `write-failed` terminal path, preserving exact
  geometry equality, acknowledgement/verify/commit-before-follow, and terminal
  uncertainty policy. Its entry-level regression covers a non-writable
  JavaScript property, not a KWin native geometry refusal.
- Upstream KWin `v6.7.4` tag `8438567` leaves the relevant Window/Xdg files
  unchanged from 6.7.3 (the installed host package revision remains
  unverified). It declares `frameGeometry` with `WRITE moveResize`
  (`src/window.h:479`); `moveResize` returns `void`
  (`src/window.cpp:3412-3420`). For an xdg resize it schedules a configure,
  while current frame geometry and `frameGeometryChanged` await a client ack
  and buffer commit (`src/xdgshellwindow.cpp:262-289,140-245`;
  `src/waylandwindow.cpp:212-254`). Therefore `Reflect.set(...) === true`
  proves property-put dispatch, not native resize acceptance, geometry equality,
  or signal delivery. ARTNue cannot be attributed to a native setter refusal.
- The same source has no current-desktop or visibility prerequisite in the
  traced configure, ack, commit, or geometry-signal path. Hidden-desktop
  deferral remains compatible with client-driven configure/commit timing, but
  is not a source-supported cause or correction. Existing retained-target
  mismatch coverage still requires exact equality and refuses a later
  same-instance send.
- LNq6hA's full planned geometry makes plan-relative index 1 the retained
  target-domain window. Index 0 was unchanged and excluded from the geometry
  fence; index 2 was the mover. The failed entry is therefore neither a source
  survivor nor the mover.
- The production path writes each changed `frameGeometry` through `Reflect.set`,
  then writes only the mover desktop membership. Its current boolean reports an
  exception-free adapter call, while the new immediate public `frameGeometry`
  readback distinguishes exact, mismatched, and unavailable state without
  changing that behavior. The fence still consumes one signal per changed
  window and the verifier remains the only acceptance gate.
- The exact file has no event timestamp or KWin PID; filesystem mtime is only
  a terminal boundary. Narrow `journalctl --user -u plasma-kwin_wayland.service`
  queries ending at that mtime, restricted to project/scripting/geometry/
  configure/move-resize messages, returned no matching entry. This neither
  confirms nor excludes a KWin race, and journal proximity cannot establish
  cause.
- Diagnostic-only geometry records now carry a flight-local monotonic order,
  plan-relative index, derived mover/source-retained/target-retained role,
  write order and adapter return, immediate readback or echo classification,
  and bounded signed delta fields. Timeout and direct-disable verifier records
  carry the same role and deltas. No raw identifiers, rectangles, payloads,
  captions, or native references are emitted. No fence, timeout, transaction,
  follow, or focus behavior changed.
- The source mirror confirms `frameGeometry` routes to `moveResize`; its xdg
  implementation can defer a size change through configure handling and has
  min/max constraints. The mirror revision is unverified against the host, and
  public Script declarations expose no min/max values for this record. It is
  compatible background, not a cause attribution.

## Backlog Recommendation

- Proposed factual update for the parent-owned backlog:
  `P0 | Workspace-send reliability | Legacy comparison found no supported
  parity correction: Rust direct geometry, echo fencing, exact commit gating,
  and post-commit follow are intentional. Diagnose pJOooO's geometry index 1
  nonconvergence and WwQ9G6's pre-ack disable boundary separately; visible
  display and border causation remain unproven.`

## Latest First-Move Capture

- The exact authorized `KRpByw` first-move capture has one dispatched planned
  flight, `plan-1-w0`, zero accepted acknowledgements, and no correlated
  request refusal. KWin diagnostics order the route as `send-dispatched` (seq
  1), owner pin (2), retained-target and mover geometry writes (3-4),
  `send-pre-mover` (5), mover echo consumed (6), geometry fence
  waiting/consumed for plan index 0 mover (7-9), then timeout settlement (10)
  and terminal timeout (11). The Planner independently emits `planned`, then
  the adapter-loss acknowledgement and `diverged`; it emits no accepted
  acknowledgement or commit for this correlation.
- This is not a called or refused follow. Seq 11 explicitly reports
  `follow=not-reached gate=pre-commit phase=timeout reason=timeout-request`.
  There is no ack, verify, committed, `follow-pre`, native-switch, native-focus,
  or post-resync follow record. The earlier `stage=follow` records are dispatch
  and pre-mover observations, not `followAfterCommit` invocation.
- Seq 10's first exact settlement failure is
  `geometry-rect-mismatch` at plan index 1, role `target-retained`, with only
  its height delta nonzero. The mover was seen, while one of two geometry fences
  remained pending at index 1. `verifyPlannedPost` checks captured scope, then
  planned geometry, then observed count and mover/retained memberships
  (`kwin/src/workspace-send-adapter.ts:2085-2164`); this failure proves neither
  a post-write membership failure nor that consumed event records verified a
  rectangle or membership.
- The prior `verify_gates=untested` wording was misleading because this path
  had already evaluated scope and reached geometry before short-circuiting.
  It now reports `verify_gates=incomplete` for any non-`ok` mirror result;
  `complete` remains the exact-success value. This diagnostic-only correction
  changes no write, fence, acknowledgement, commit, follow, focus, timeout, or
  enablement behavior.
- KWin v6.7.4 source material remains compatible with deferred or constrained
  Wayland frame-geometry convergence, but does not attribute this retained
  target mismatch to a native setter refusal, hidden workspace, client, or
  write order. The host revision is unverified. The current geometry-before-
  membership ordering therefore has no supported correction from this capture.

## Latest Rapid-Send And Client-Trace Review

- The authorized rapid-send project capture has 201 correlated flights: 100
  target KWin desktop number 4, 56 target number 5, and 45 other targets.
  Every flight reaches Planner commit and KWin `follow state-confirmed`; no
  correlation has a geometry mismatch, timeout settlement, direct disable,
  adapter loss, or divergence. The 64 separate `busy-refused` entries have no
  correlation, so they cannot be assigned to individual physical key presses
  or an active flight by merged log order. They are the code-defined in-flight
  shortcut, not accepted transactions or completed commands.
- The log's plan-relative geometry diagnostics show completed moves into the
  workspace-4 direction with a target-retained peer and completed moves back
  to the workspace-5 direction with a source-retained peer. Both include the
  mover and complete their fences. Later ordinal changes mean these labels do
  not establish stable workspace identity, and neither direction has a logged
  failure predicate.
- The same instance remains available throughout the capture: each completed
  flight through the penultimate one is followed by another dispatch in the
  same generation, and no disable appears. The final flight also completes,
  but the file contains no subsequent send. This establishes later logical
  usability after the observed busy shortcuts, not recovery from a terminal
  loss.
- The authorized isolated Ghostty client trace records configure, matching
  acknowledgement, and continuing buffer-commit progress for the traced
  workspace-4 terminal. It contains no unacknowledged configure or apparent
  client refusal. It does not establish the full pasted launch command,
  workspace placement, mover identity, a planner correlation, KWin frame
  geometry, rendered visibility, or any workspace-5 mover failure. Content
  size and buffer size are not KWin decorated frame geometry.
- The two captures therefore support no ordinary code correction. They leave
  the reported few back-to-5 visible failures uncorrelated: an intentional
  busy refusal is observed and plausible for some rapid attempts, while wrong
  target selection during an unfinished flight and committed-but-invisible
  follow are neither proven nor excluded for an unlabeled physical attempt.
  The minimal next discriminating user-owned observation is one labeled rapid
  sequence that records every physical direction and interval, identifies the
  perceived failure, retains the existing verbose log through that flight's
  terminal outcome, and traces the workspace-5 mover rather than the
  workspace-4 peer.

## Retained-Window Client Trace Follow-Up

- Evidence: `/run/user/1000/plasma-auto-tiler-dev.UDmtET.log` and
  `/tmp/opencode/ghostty-wayland-sibFLh.log`, with the user's workspace-2
  retained-terminal and workspace-4 mover reproduction.
- The user identifies the authorized isolated Ghostty trace as the retained
  target terminal, not the mover. That manual process/window attribution is
  retained. The trace itself has no machine-checkable KWin native-window binding
  or shared clock with the combined log, so it independently establishes only
  that retained client's configure, acknowledgement, and buffer-commit progress,
  not KWin frame placement or the mover state.
- The combined-log timeout's exact first verifier failure is
  `geometry-rect-mismatch` at plan geometry index 1, role `mover`: the fresh
  observation still had the mover's pre-send full-height rectangle instead of
  its planned half-tile rectangle. Membership predicates were not evaluated:
  the verifier returns at the first geometry mismatch before its mover and
  retained membership branches. The earlier dispatch diagnostic saying the mover
  was outside the target is a frozen pre-write basis, not a post-write failure.
- `plan-echo consumed` means only that the subscribed mover-desktop signal fired
  and its one-shot fence was detached. `plan-geometry consumed` for index 0
  similarly means the retained target's geometry signal fired and its fence was
  removed. Neither event compares a rectangle or membership. Index 1 remained
  pending at timeout, so `completePostWrite` never performed the normal fresh
  exact geometry-and-membership verification before acknowledgement.
- `desktop-mismatch` is emitted by the separate Plan admission observer, not by
  the send verifier. It means the window was not on that observer's selected
  desktop, so it is compatible with the mover leaving the desktop where the user
  remained; it does not establish a send membership failure. That observer uses
  desktop-wrapper equality and can fail closed if KWin re-wraps a desktop, but
  this flight's fresh send observation still contained the mover and failed first
  on its rectangle, not absence or identity. Native ids are normalized and
  interned, fresh observations rebuild reference maps, and retained snapshots
  contain primitive state. No static aliasing, active-desktop filtering,
  generation, or synchronous-callback defect is established by this record.
- KWin v6.7.4 source routes `frameGeometry` through `moveResize`; its scripting
  surface does not promise synchronous or one-per-write geometry signals, an
  atomic geometry-plus-membership transaction, or a membership-before-geometry
  ordering. The current geometry, membership, exact observation, acknowledgement,
  then follow ordering is the current implementation. This source evidence alone
  does not establish that changing native-write order would fix the mismatch;
  an extra post-membership write would introduce a retry. The remaining causal
  fact is why the mover's accepted JavaScript property assignment did not reach
  the planned KWin frame geometry during
  this flight: the existing record distinguishes that state from the retained
  client's progress, but not deferred/coalesced native delivery, a native
  constraint, or another compositor-side cause. At the time no production
  correction was supported. The subsequent authorized native-move follow
  correction preserves exact verification and terminal uncertainty for layout
  while no longer withholding a confirmed mover transfer for unrelated geometry.
