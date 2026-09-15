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
  setter delegates to `VirtualDesktopManager::setCurrent`; that manager updates
  its current-desktop map and emits its signal, but does not hide or show
  windows. Workspace visibility, activation, effects, and scene visibility are
  downstream and have no public scripting completion API.
- Successful immediate map confirmation plus the existing mover-focus request
  now logs `event=follow outcome=state-confirmed`, never `completed`. The
  correlated token contains no raw native identifiers. It does not claim a
  visible switch or alter commit, focus request, or later-send usability.
- Production-shaped Plan-entry tests cover exact planned/acknowledged/verified
  commit with target map confirmation and mover focus, and fail on the prior
  `completed` token. No-op setters, rejected/timeout follows, and later distinct
  sends retain their prior coverage.
- `npm run typecheck` and `npm test` pass with 655 tests. No live KWin, D-Bus,
  window, focus, workspace, or session action occurred. Physical follow remains
  user-owned evidence and requires a public visibility boundary or a separately
  selected design.
