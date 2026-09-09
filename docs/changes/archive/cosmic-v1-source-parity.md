# COSMIC V1 Source Parity

## Goal

Correct `cosmic_v1` lifecycle, shares, resize, and drag placement to follow
production COSMIC source. Keep the portable engine and its versioned policy
boundary; platform adapters supply native observations and declared capabilities
only.

## Scope

- Replace project-selected admission, removal/focus, share, resize, and drop
  rules where production COSMIC source establishes behavior.
- Add source-evidenced conformance coverage through `cosmic_v1` and `Session`.
- Preserve frozen R1-R4 movement/navigation, opaque IDs, ordered N-ary topology,
  logical domains, complete plans, and one-pending reconciliation.

## Non-goals

- Live KWin work, runtime inspection, Custom Tile authority, stack rendering,
  native workspace emulation, plugin frameworks, or future policy modes.

## Accepted Source Evidence

- `pop-os/cosmic-comp` `81cd5fdbaa41c3973369ae85bccf829137836e20`:
  `src/shell/layout/tiling/mod.rs` `map_to_tree` (548-617),
  `TilingLayout::new_group` (2898-2936), `Data::new_group` (177-191),
  `add_window` (219-243), `remove_window` (255-283), `unmap_internal`
  (1446-1493), `next_focus` (1835-2087), `resize` (2514-2616),
  `update_pointer_position` (3373-3883), and `drop_window` (2666-2824).
- The same revision: `src/shell/mod.rs` `resize` (4550-4580) and
  `finish_resize` (4582-4617), plus `src/shell/layout/tiling/grabs/resize.rs`
  (270-332), establish keyboard/pointer resize constants, clamping, and finish
  state. The pinned `tiling/mod.rs` path was independently retrieved from
  GitHub at that full revision during this correction; the local source mirror
  is content evidence only because it has no `.git` metadata.

## Material Decisions

- Selected policy modes target strong source-evidenced behavioral parity.
  `cosmic_v1` deviates only for explicit infeasible platform capabilities, which
  must be named and reviewable. Future Hyprland and other semantics belong in
  separate versioned policies sharing the portable engine.
- COSMIC stack center drops require compositor stack support. The portable
  `cosmic_v1` split-tree policy classifies center but refuses it closed with no
  plan because stacks are unselected/compositor-owned; it must not reinterpret
  center as a no-op or split.
- COSMIC pixel resize depends on current child geometry. Its portable policy
  uses normalized current geometry and source policy minima (`360x240`), not
  arbitrary project constants or an invented native-minimum capability.

## Plan

1. Apply the smallest explicit `cosmic_v1` policy seam and source-evidenced
   lifecycle/resize/drop semantics.
2. Add focused durable conformance and Session tests, removing shortcut locks.
3. Independently review the resulting diff and run focused/full static checks.
4. Record outcome/evidence, update active governance, archive this record, and
   stage only reviewed change files.

## Acceptance

- Every parity claim has exact upstream revision, file, and symbol evidence.
- COSMIC-specific constants and choices are named under `cosmic_v1`; Session
  only orchestrates portable transactions.
- Missing compositor-only inputs or capabilities refuse closed.
- Focused conformance, lifecycle, resize, drag, reconciliation, trace, Rust,
  and relevant KWin static checks pass without live KWin work.

## Outcome And Evidence

- Source fact: automatic map chooses the last active tree node; a wide target
  uses COSMIC `Orientation::Vertical` and a tall/tied target `Horizontal`
  (`map_to_tree` 548-617). Portable `Axis::Horizontal` is the width axis, so
  `cosmic_v1::admission_axis` maps wide to portable horizontal and tall/tie to
  vertical. Empty domains remain a root leaf. The source does not establish
  the portable no-focus root fallback order.
- Source fact: `Data::new_group` creates equal pixel halves; `add_window` takes
  one `(n + 1)`th while scaling survivors proportionally; `remove_window`
  redistributes the removed extent proportionally with last-pixel correction
  (tiling `mod.rs` 177-191, 219-283). Adaptation: the ordered N-ary engine uses
  checked normalized integer shares to preserve those exact ratios; projector
  rounding remains a named portable approximation of source pixel rounding.
- Source fact: keyboard resize uses `ResizeDirection::{Inwards,Outwards}` plus
  an edge, `(previous.unwrap_or(10) + 2).min(20)`, and direct-pair `720/480`
  gates. Its shrink child alone clamps at `360/240`; the paired grow child takes
  exactly the removed extent (`tiling/mod.rs` `resize` 2514-2616; shell
  `mod.rs` 4550-4617). Pointer resize has a distinct two-sided minimum
  correction (`tiling/grabs/resize.rs` 270-332). The strict KWin keyboard
  payload carries edge, mode, and repeat index; pointer resize consumes its
  observed boundary and has no keyboard-step field.
- Source fact: group zones build and crop left, top, right, bottom in order;
  every nonmatching edge is 32px and only the exact prior
  `GroupEdge(group_id, direction)` is 80px (`tiling/mod.rs`
  `update_pointer_position` 3500-3608). Portable `PriorGroupEdge` carries only
  that group/edge identity; stale, different-edge, and non-group prior hovers
  are normal-depth. Group interiors use the source predecessor from child starts
  (3610-3625), and `drop_window` inserts at `min(len, predecessor + 1)`;
  group edges use same-axis first/last N-ary insertion or a perpendicular
  wrapper (2666-2824). Window center thirds are source stack drops and remain
  refused closed because compositor stacks are unselected; window edges retain
  normalized-distance split behavior (3646-3691).
- Source fact: `unmap_internal` recursively promotes/collapses survivors
  (1446-1493). Inference/limitation: its audited source has no removal-focus
  selection rule, so existing deterministic sibling/first fallback remains
  project behavior and is not asserted as COSMIC.
- Durable coverage: `cosmic_v1` zone/axis/share/resize vectors including
  same-edge hover stickiness and one-sided versus two-sided clamps; Session
  lifecycle, keyboard/pointer resize, group-edge/interior drag, stale capture,
  preview/drop agreement, reconciliation, invariant, and trace tests; KWin
  keyboard/pointer adapter contract tests.
- Verification: `cargo fmt --check`, `cargo check --all-targets`,
  `cargo clippy --lib -- -D warnings`, `cargo test --lib`, `cargo test --tests`,
  `cargo test --test poc1_vector_lock`, `cargo test --test trace_fixture_lock`,
  `npm run typecheck`, `npm run test:resize`, and the focused pointer-resize
  adapter suite passed. No live KWin work occurred.

## Next Action

- KWin drag-end delivery remains separate from this portable Session parity
  correction. It must route the already source-classified Session result and
  explicitly refuse unsupported center stacks without changing `cosmic_v1`
  policy.
