# Window Gap Restoration

## Goal

Restore visible spacing between tiled windows and work-area edges.

## Outcome

- `kwin/src/domain-gap.ts` supplies the fixed `DOMAIN_GAP = 8` default to the
  plan and explicit opt-in resize observation routes.
- No user configuration source remains. The prior fixed 8px custom-tile padding
  was removed with the scope reduction; a future setting needs a KCM schema and
  UI plus a KWin `readConfig` binding.
- `cargo test geometry`, focused plan-adapter harness, KWin typecheck, and KWin
  build passed. Live confirmation requires a full controller reload.
- `OUTER_DOMAIN_GAP = 8` is carried by the plan, keyboard-resize, and
  pointer-resize routes. Rust insets their work-area bounds before projection;
  exhausted insets and sibling gap-budget overflow reject fail-closed.
- COSMIC parity: `cosmic-comp` `81cd5fdbaa41c3973369ae85bccf829137836e20`
  reads `(outer, inner)` from theme gaps and insets its non-exclusive work area;
  the pinned `libcosmic` default is `(0, 8)`. This controller's `(8, 8)` is the
  effective rendered edge and sibling-gap geometry: source leaf-edge insets add
  the inner 8px on unadjacent work-area edges. See
  [COSMIC Geometry Parity](cosmic-geometry-parity.md).
