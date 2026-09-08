# Rust Drag Drop Placement

## Goal

Add portable transactional Session drag/drop placement for ordered N-ary nested
split trees while adapters retain native pointer motion and rendering.

## Scope

- Edge-only logical pointer normalization, preview, begin/drop/cancel lifecycle,
  same-axis insertion, perpendicular target-subtree nesting, and snap-back.
- Drag dispatch/reconciliation uses the existing shared one-pending
  acknowledgement and post-observation boundary.

## Non-Goals

- No KWin/native adapter, native pointer extraction, visual effect, live test,
  tab, stack, shared tile, compositor group, or cross-domain placement.

## Acceptance And Outcome

- `Session::begin_drag` retains accepted topology during free movement.
- `preview_drag` returns opaque IDs, target/proposed rectangles, axis/order, and
  structural relation without committing state.
- `drop_drag` commits only after acknowledgement and matching drag
  post-observation; invalid or cancelled releases return snap-back with no
  topology change.
- Edge insertion, nesting, collapse/shares, focus, complete geometry,
  reconciliation, deterministic replay, and bounded topology invariants are
  covered by Rust tests.

## Evidence

- `cargo fmt --check`, `cargo check --all-targets`, and `cargo test` pass.
- `cargo clippy --lib --no-deps` passes without warnings.
- The full Rust suite passes `tests/trace_fixture_lock.rs` and
  `tests/poc1_vector_lock.rs`.
