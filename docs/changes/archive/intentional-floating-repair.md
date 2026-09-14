# Intentional Floating Repair

## Goal

- Complete the intentional-floating MVP through the existing `DescribePlan`
  pull request/response route without live KWin or Plasma mutation.

## Scope

- `toggle-float` is an explicit Rust Session and protocol transition. Floating
  state and its centered 60% work-area geometry are retained outside the tile
  tree. Unfloat is a fresh tiled admission, never leaf restoration.
- The KWin adapter writes float frame geometry only after a validated planned
  response. It does not write `Window.tile`. Fullscreen, maximized, busy,
  invalid, and non-tiled float targets refuse without a state transition.
- `Meta+G` is not registered because KWin Grid View owns it. The internal
  handle request remains for static coverage. Sticky remains deferred and is
  not registered.

## Acceptance

- Rust Session and protocol tests cover tiled-to-float, float-to-tiled,
  retained geometry, empty surviving trees, fresh admission, and refusal
  transitions.
- KWin tests cover request/reply transport, exact frame-write diagnostics,
  floating tiled-command guards, no implicit float path, and no Meta+G
  registration.
- Required static battery passes. No live mutation occurs.

## Outcome

- Accepted. `toggle-float` now traverses the Rust Session/protocol route and
  applies a validated reply before changing the KWin-side frame or floating
  marker. `Meta+G` and sticky remain unregistered.
- The parent-owned backlog line to advance or remove is the P1
  intentional-floating entry in `docs/backlog.md`.

## Accepted Evidence

- Before (inherited archive evidence): `cargo test` reported 251 library tests
  plus existing integration suites; `npm test --prefix kwin` reported 523
  tests; `bash scripts/dev-loop-split.test.sh` reported `PASS=277`.
- After: `cargo fmt --check`; `cargo test --no-fail-fast` (252 library and 235
  integration tests); `npm run typecheck --prefix kwin`; `npm test --prefix
  kwin` (525 tests); and `bash scripts/dev-loop-split.test.sh` (`PASS=277`)
  passed.
- No live KWin/Plasma mutation, lifecycle action, physical shortcut, or visual
  observation occurred. Runtime KWin behavior remains live-unproven.
