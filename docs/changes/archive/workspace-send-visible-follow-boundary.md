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

## Next User Evidence

- After one clean `just dev` restart, enable verbose diagnostics, select
  workspace 3, open one terminal, and press `Meta+Shift+2` once. Preserve the
  fresh `/tmp/dev.log` and report the visible workspace plus active-border
  state. This is one user-owned physical reproduction, not a visible repair
  claim.
