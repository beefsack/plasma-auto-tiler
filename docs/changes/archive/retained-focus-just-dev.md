# Retained Focus And Just Dev

## Goal

- Diagnose the live directional-command stall, synchronize retained focus from
  authoritative KWin observation, and add a foreground development loop.

## Decisions

- A known tiled `focused_window` updates retained focus before directional
  planning; topology and membership remain independently validated.
- `just dev` refuses any non-DOWN state rather than adopting a session it did
  not create, then composes `dev-on` and receipt-bound `dev-off`.
- It labels Planner stderr and the bounded KWin plan journal lines. An
  unverified teardown makes no second unload attempt and directs logout/login.

## Evidence

- Live read-only inspection found no Planner crash, timeout, adapter exception,
  or D-Bus loss. The first fault was `focus-mismatch` after successful plans.
- `cargo build`, `cargo test` (447 passed), and `cargo clippy` passed with the
  existing `let_and_return` warning at `src/tray_endpoint.rs:386`.
- KWin test (375 passed), typecheck, build, and `dev-loop-split` (137 passed)
  passed. No live lifecycle command was run.

## Next Action

- None.
