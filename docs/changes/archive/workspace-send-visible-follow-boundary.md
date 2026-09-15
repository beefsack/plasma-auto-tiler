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
