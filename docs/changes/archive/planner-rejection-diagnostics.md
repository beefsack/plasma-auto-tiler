# Planner Rejection Diagnostics

## Goal

Make every Planner rejection on the focus, movement, keyboard-resize, and
pointer-resize routes self-explaining with a bounded diagnostic token.

## Scope

- Append one validated `detail` token to rejected route and session diagnostics,
  plus the existing bounded cause for terminal divergence.
- Preserve Planner decisions, wire outcomes, correlation handling, and KWin code.
- Cover each distinct Planner rejection branch with focused Rust tests.

## Non-goals

- KWin bundle changes, live shortcut input, or any authority/eligibility change.
- Legacy fallback, bootstrap behavior, geometry, or retry changes.

## Acceptance

- `route=focus|movement|resize|pointer` and matching `route=session` rejection
  lines carry a closed, branch-specific `detail` token.
- No raw request data or unvalidated reply content appears in diagnostics.
- The two-window focus rejection has a distinguishable token.

## Approach

- Carry a bounded diagnostic detail alongside existing rejected replies.
- Have `route_diag` validate and append that detail only for rejected or
  diverged outcomes.
- Keep the existing fields and their order unchanged; append `detail` after the
  optional revision.

## Evidence

- Static trace: focus with two observed windows rejects at
  `src/manual_runtime.rs` count validation before correlation claim, unseeded,
  membership, or Session proposal.
- The rejection is now `detail=window-count-mismatch` on both `route=focus`
  and `route=session` lines. Rejected details are closed and branch-specific;
  existing bounded divergence kinds are also emitted as details so no terminal
  transaction failure on these routes remains reasonless.
- `cargo fmt --check`, `cargo test --lib` (423 passed), and
  `cargo clippy --lib -- -D warnings` passed.
