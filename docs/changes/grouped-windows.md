# Grouped Windows Feasibility

## Goal

Determine whether compositor-owned grouped windows are feasible without
violating Custom Tile lifecycle or active-border constraints.

## Scope And Dependencies

- No group carrier, controls, bindings, or shared border behavior is selected.
- A live multi-window Custom Tile stability proof is required first. Supporting
  research is retained at [stacked-window feasibility](../research/stacked-window-feasibility/).
- The focused group-outline static implementation is accepted, but its live
  flash did not appear after reload. Do not treat the static harness as live
  evidence or extend the replaceable outline MVP without a fresh live diagnosis.

## Next Action

Run the stability proof under fresh explicit live authorization.
