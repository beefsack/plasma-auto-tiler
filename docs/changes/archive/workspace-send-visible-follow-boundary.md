# Workspace Send Visible Follow Boundary

## Goal

- Diagnose the reported committed-send follow that moved the window but left the
  target workspace invisible, without claiming that current-desktop state alone
  proves compositor visibility.

## Scope

- Preserve the selected exact Rust ack/verify/commit, target follow, mover-focus,
  and later-send availability behavior.
- Make correlated follow diagnostics name only the native state they establish.

## Non-Goals

- No retry, polling, replay, reset, reseed, queue, scene/effect rewrite, or
  border attribution.

## Outcome And Evidence

- The current `plan-1-w0` occurrence committed at `/tmp/dev.log:239` and logged
  `follow outcome=completed` at line 256, while the user observed the terminal
  on workspace 2 and the visible output on blank workspace 3. The log therefore
  proves neither physical visibility nor border causation.
- The KWin 6.7.3 source mirror, whose exact revision is unavailable and which is
  not asserted to match the historical 6.7.4 host, shows that the scripting
  setter delegates to `VirtualDesktopManager::setCurrent`
  (`src/scripting/workspace_wrapper.cpp:97-108`). `setCurrent` synchronously
  changes the output map and emits `currentChanged`
  (`src/virtualdesktops.cpp:577-600`); the connected workspace slot then runs
  `updateWindowVisibilityAndActivateOnDesktopChange`
  (`src/workspace.cpp:1039-1119`). This is the supported normal switch path,
  not evidence that native integration expansion is necessary. Rendered frame
  completion remains unexposed to the script, so it still cannot prove physical
  visibility.
- Successful immediate map confirmation plus the existing mover-focus request
  logs `event=follow outcome=state-confirmed`, never `completed`. The correlated
  token contains no raw native identifiers. It does not claim a visible switch
  or alter commit, focus request, or later-send usability.
- The immediate confirmation must compare stable desktop ids, not JavaScript
  wrapper identity. `36cb691` accidentally replaced the earlier id comparison
  with `current === desktopRef`; a distinct wrapper for the same native desktop
  then skipped focus after a successful setter. The correction restores the id
  comparison at `kwin/src/plan-adapter-entry.ts:1813-1832`.
- A production-entry regression drives planned/acknowledged/verified/committed
  send with a distinct same-id current-desktop wrapper and proves the target map
  confirmation reaches mover focus and `state-confirmed`, never `completed`
  (`kwin/tests/plan-send-coordination.test.ts:831-963`). It fails with the
  identity comparison. No-op setters, rejected/timeout follows, and later
  distinct sends retain their prior coverage.
- This wrapper correction is not attributed to the reported visual symptom:
  its historical follow readback passed, and the exact occurrence already
  observes the mover and all target windows in target domain `5b55...` at
  `/tmp/dev.log:240-243`. Source and log evidence do not identify a remaining
  visible-switch cause. The smallest discriminating future diagnostics are the
  resolved target/current desktop ids and output, wrapper-identity result,
  logical-map order with KWin desktop numbers, and focus state immediately
  before and after follow. They require a separately source-bound user-owned
  observation; no physical claim is made here.
- `npm run typecheck` and the focused production-entry coordination test pass
  (5 tests). No live KWin, D-Bus, window, focus, workspace, or session action
  occurred. Physical follow remains user-owned evidence; neither mocks nor
  current-map readback establish rendered acceptance.
- The follow route now emits best-effort correlated redacted observations at
  `event=follow-pre`, `follow-switched`, `follow-focused`, and
  `follow-settled`. The first three bound the existing pre-setter, immediate
  post-setter, and post-focus reads. `follow-settled` is one synchronous
  re-observation after the existing committed-send resync edge; it adds no
  signal, timer, poll, retry, or behavior gate.
- Each observation carries only `req_ord` (requested logical ordinal),
  `tgt_ord`/`tgt_num` (target native desktop list order and KWin desktop
  number), `cur_ord`/`cur_num`, `cur_id_eq`, `cur_ref_eq`, `out_ord`,
  `out_eq`, `desktops`, `mover_in_target`, `active_is_mover`, `switched`, and
  `focused`. Ordinals, counts, and equality flags are session-local redacted
  values. Raw desktop/output/window identifiers, wrapper references, captions,
  application data, payloads, environment, and native raw identifiers remain
  excluded. `cur_ref_eq` is diagnostic only; stable desktop-id equality remains
  the native current-map comparison.
- `req_ord` versus `tgt_ord`/`tgt_num` records the logical-to-native target
  binding. `out_ord`/`out_eq` plus `cur_*` records whether the selected output
  has the requested current desktop. A changed `cur_*`, `mover_in_target`, or
  `active_is_mover` between `follow-switched` and `follow-focused`/`settled`
  identifies a focus or later lifecycle reversal. These fields do not prove a
  composited frame or physical visibility.
- Focused offline checks pass: `npm run typecheck`; bundled
  `workspace-send-adapter.test.ts` (82), `workspace-native.test.ts` (39), and
  `plan-send-coordination.test.ts` (5). They cover logical-ordinal handoff,
  current-target divergence, fresh-wrapper id-versus-reference evidence,
  post-focus reversal, and observation/log failure without behavior change.
- The next diagnostic extension adds best-effort correlated observations at
  `send-dispatched` (the real command-dispatch boundary, revision 0),
  `send-pre-mover` (immediately before the only mover desktop-membership
  write), and `send-post-mover` (the verified post-write observation before
  ack). Existing plan/geometry echo, ack, verify, commit, and
  follow-pre/switched/focused/settled lines remain their existing boundaries.
  The new lines retain the existing redacted current/target/output and
  mover/active fields and add `src_in_src`/`src_in_tgt`, immutable
  dispatch-snapshot membership flags. They distinguish the first observed
  target-current map from the mover membership write without claiming a
  rendered desktop. No static source cause is firmly demonstrated.
- Focused offline verification passes: `npm run typecheck` and the bundled
  workspace-send adapter test (86 tests). They cover a
  source-current to target-current ordering case, immutable source membership,
  diagnostic log/observer failure without transaction behavior change, and
  production-entry wiring. No live KWin or D-Bus action occurred.

## Next User Evidence

- After one clean foreground `just dev` restart with verbose diagnostics on
  workspace 2, switch to workspace 3, open one terminal, and press
  `Meta+Shift+2` once. Supply the fresh exact log path and the visible
  workspace plus active-border state. This is one user-owned physical
  reproduction, not a visible repair claim.

## Latest Exact-Log Review

- The exact ARTNue reproduction is a pre-commit geometry failure, not a
  committed-but-invisible follow. Its target-retained geometry write and mover
  write are logged at lines 56-57, the mover geometry echo alone is consumed
  at line 62, and timeout settlement retains the target geometry fence with a
  height mismatch of `+486` at line 65. The user-established 15-second wait
  means no later follow was pending; no ack, verify, commit, or follow event
  exists for the correlation. The active border remains outside this native
  protocol attribution.
- ARTNue also exposed that `write_return=1` previously meant only that the
  entry discarded `Reflect.set(frameGeometry, ...)`'s JavaScript result. The
  entry now propagates that result, so an engine-level property rejection
  terminates as `write-failed` before mover membership, ack, verify, or follow.
  This is not a native geometry-acceptance result: upstream KWin `v6.7.4` tag
  `8438567` leaves this path unchanged from 6.7.3 (the installed host package
  revision remains unverified) and binds `frameGeometry` to the `void`
  `moveResize` setter (`src/window.h:479`; `src/window.cpp:3412-3420`). An xdg
  size change may await configure acknowledgement and buffer commit before it
  changes current geometry (`src/xdgshellwindow.cpp:262-289,140-245`). The
  staged entry test covers a non-writable JavaScript property only, not a
  native silent refusal, and neither identifies the ARTNue cause nor changes
  the exact post-commit follow route.
- The same reference source contains no visibility/current-desktop gate in the
  traced configure, ack, commit, or `frameGeometryChanged` path. It does not
  establish that an active workspace visit is required. Deferred hidden-window
  convergence remains one compatible explanation, alongside client constraints
  or other native state not exposed by this record.
- The authorized `/run/user/1000/plasma-auto-tiler-dev.Aoekoz.log` does not
  label which correlations were physically visible successes or failures, so it
  cannot correlate the reported intermittent visible failure to a particular
  flight. `plan-1-w0`, `plan-1-w1`, and `plan-1-w2` each reach the normal
  post-mover, ack/verify, and follow-settled stages (lines 74-93, 110-131, and
  143-162). This is protocol completion, not rendered-visibility proof.
- `plan-1-w3` diverges after `send-dispatched` and `send-pre-mover` (lines
  171 and 174): it has no post-mover, ack, verify, or follow stage. The only
  later correlated production events are the request/plan at lines 169-170,
  geometry consumption at line 173, and `busy-refused kind=workspace-move` at
  lines 179-180. The earliest reliable difference is therefore an incomplete
  mover-echo flight, not a demonstrated visible-follow reversal.
- Combined Planner and KWin sinks have no timestamps and are grouped out of
  causal order: Planner ack/verify/commit lines precede the KWin dispatch that
  necessarily caused them for each completed flight. Cross-sink ordering and
  unrelated interleavings cannot establish a race. Within the single correlated
  KWin sequence, the missing post-mover stage is reliable. Intermittency alone
  does not establish a race.
- Current source defines the busy refusal as the in-flight fence. A workspace
  send subscribes before its geometry and mover writes, consumes those echoes
  independently, and cannot acknowledge until both are seen. The flight clears
  only after commit or a defined terminal path. No source-defined ordering or
  ownership defect explains the absent mover echo, so no speculative correction
  or telemetry-only change was made at that time. The later authorized
  native-move follow behavior is narrower: a fresh stable-id membership proof
  after the membership setter returns may follow once before unrelated geometry
  settles; it does not infer a missing mover echo, commit, or rendered result.
- The bounded unknown is whether the log ended before the flight's terminal
  timeout or KWin withheld/coalesced the mover or remaining geometry echo. The
  next useful user-owned observation is one labeled physical attempt, retaining
  this exact-log capture through the terminal timeout, with the visible
  workspace and active-border state recorded against its correlation. This adds
  the missing outcome and terminal-state evidence rather than repeating the
  prior unlabeled observation.
- Offline checks on the unchanged source pass: `npm run typecheck` and the
  bundled workspace-send adapter suite (86 tests). They confirm the modeled
  fence and later same-instance sends, but cannot prove native signal delivery
  or rendered visibility.

## Closure

- Subsequent USER VISUAL/MANUAL acceptance is: "The issue appears to be fixed, I spam moved a window between many workspaces and it never failed. ... reinforces ... graceful handling ... actually feel really good even when spamming." It accepts repeated same-session move/follow usability across many workspaces. The supplied `/run/user/1000/plasma-auto-tiler-dev.E2E0QJ.log` is NOT ANALYZED, so it does not alter this record's native-cause, protocol, or rendered-visibility limits.
