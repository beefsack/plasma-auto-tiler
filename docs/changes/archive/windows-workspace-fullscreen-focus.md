# Windows remembered fullscreen focus on workspace return

## Goal and acceptance

- Explicit workspace return restores the remembered focused game (REQ-WS-09),
  preserving fullscreen/display mode and avoiding extra size/position writes.
- Diagnose the supplied dogfood trace and adapter selection/reveal/focus path;
  add a regression covering the actual focus-selection policy.

## Scope and plan

- Windows adapter only; fullscreen-send suppression stays separately scoped.
- Worker diagnoses and implements; Lead reviews trace/diff, gates and publishes.
- No live tests, owner/hook/window launches, input or dependency installs.

## Verification

- Offline regression and native four-crate gates, with the eight audited
  window-creating tests skipped. Post-push CI.
- User live check pending: focus a fullscreen game on WS1, switch to WS2 and
  back; game must regain focus without display-mode changes or geometry writes.

## Outcome and evidence (2026-10-11)

- Offline-delivered; live check pending. Code-proven defect: `last_focus` was
  recorded only after tiler-actuated focus. A game focused externally could
  therefore leave stale sibling focus remembered. `remember_select_departure`
  records the still-current, verified source member before hiding for numbered,
  previous/relative and CLI selects. Return uses existing retained-aware focus
  eligibility and actuation; fullscreen geometry remains excluded.
- Supplied trace at `7f407ca` is non-discriminating for the game target. Ordinary
  selects `act-701` through `act-729` report `focus-ok` without a target token;
  these are not evidence of the fullscreen-game switch. Separate segments show
  retained fullscreen and a fullscreen-foreground suspension. No claim that
  the trace proves which application took focus. Added bounded `select-departure`
  and `select-focus` events with opaque tokens, correlation and focus outcome.
- Regression exercises production departure memory, retained-aware return
  `eligible_focus_set`/`focus_target` and `writable_tokens`: game wins stale
  sibling memory and is geometry-exempt; changed foreground, wrong token/PID,
  other-workspace origin and vanished rows do not replace memory. Slotless
  born-fullscreen members use the same retained focus route.
- Independent review found missing CLI coverage; repaired before acceptance.
  Fresh observation and existing final native identity/lifetime/scope checks
  fence focus actuation. Fullscreen-send-follow suppression remains scoped to
  its separate tentative carry decision. No new tentative product decision.
- Native four-crate locked offline build/test/fmt/clippy (`-D warnings`) and
  whitespace gates pass, with the same eight audited window-creating tests
  skipped as [item (a)](windows-first-run-stop.md). No live actions ran.
  CI passed for delivery `ba92c01`
  ([run](https://github.com/beefsack/OmniTiler/actions/runs/38105464467)).
- Pending user check: externally focus the fullscreen game on WS1, press Win+2
  then Win+1. Verify the game regains focus and fullscreen/display mode is
  unchanged. Repeat via previous/relative selection. Trace should show the
  same game token remembered on departure and chosen on return, with no game
  geometry writes. Finish with ordinary graceful stop/restoration.
