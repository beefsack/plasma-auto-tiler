# Grouped Windows Feasibility

## Goal

Determine whether compositor-owned grouped windows are feasible without
violating Custom Tile lifecycle or active-border constraints.

## Scope And Dependencies

- No group carrier, controls, bindings, or shared border behavior is selected.
- A live multi-window Custom Tile stability proof is not a route: Custom Tiles
  were not adopted (User decision 2026-10-09; see the archived
  [integrated Plasma verdict](integrated-plasma-structural-feasibility.md)).
  Supporting research is retained at
  [stacked-window feasibility](../../research/stacked-window-feasibility/).
- The focused group-outline static implementation is accepted, but its live
  flash did not appear after reload. Do not treat the static harness as live
  evidence or extend the replaceable outline MVP without a fresh live diagnosis.

## Closure 2026-10-09

- User decision 2026-10-09: CLOSED as moot; Custom Tiles are not a route.
  Tabbed stacks carry Rust-engine evidence of their own when designed. The
  js-workload record stays parked. No live mutation was run.
