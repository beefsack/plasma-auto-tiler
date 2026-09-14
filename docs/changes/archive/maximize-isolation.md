# Maximize Isolation

## Goal

- Mirror the existing fullscreen adapter-local isolation for maximize: a
  maximized window keeps its leaf/tree position and share, receives no geometry
  write, and unmaximize restores the exact retained allocation. No Rust
  protocol/session state is added for maximize.

## Decisions

- A nonzero KWin `maximizeMode` (1 vertical, 2 horizontal, 3 full) collapses to
  one adapter boolean. No horizontal or vertical maximize concept enters the
  Rust engine; COSMIC records the pre-maximize layer and geometry and has no
  maximize managed layer (`ManagedLayer` enum
  `src/shell/workspace.rs:243-248`), so H/V maximize is deliberately not
  modeled in the engine.
- Fullscreen takes precedence when a window is both fullscreen and maximized:
  fullscreen refusal tokens and the `skip-fullscreen` disposition win.
- Maximize observation is a hard startup requirement: a missing per-window
  `maximizedChanged` attachment refuses with the exact
  `plasma-auto-tiler:plan:maximize-refused-signal` token, unlike best-effort
  fullscreen.

## Implementation

- `kwin/src/plan-adapter.ts` observes `maximized` like `fullscreen`: carried
  retained rects for maximized members, exclusion from drift comparison and
  reconcile targets, no geometry writes, and `skip-maximized` disposition
  (fullscreen wins). New refusal tokens `move-refused-maximize`,
  `resize-refused-maximize`, `pointer-refused-maximize`.
- `kwin/src/plan-adapter-entry.ts` observes `maximizeMode !== 0`, subscribes
  `maximizedChanged` per window with windowAdded/windowRemoved sync, and refuses
  fail-closed whenever any eligible observed normal window lacks the signal,
  both at startup and for a window added after enable.

## Static Verification

- `npm test --prefix kwin` - 517 passing
- `npm run typecheck --prefix kwin`
- `cargo test`
- `scripts/dev-loop-split.test.sh` - PASS=277
- `just --fmt --check`
- `git diff --check`

## Limits

- Static-only: no live KWin, Plasma, D-Bus, or physical maximize action was
  run. Unmaximize restoration correctness and the maximize-mode collapse
  behavior remain live-unproven pending a user-owned live check.