# Stage 1: Post-Drop Reflow

## Intent

Preserve KWin's native Shift custom-tile drag target selection, then resolve its
post-drop overlap into a usable tiled layout without changing tiles during the
interactive drag.

## Scope

- On `interactiveMoveResizeFinished`, detect a native Shift drop whose target
  leaf contains the dragged window and exactly one other managed window.
- Split that target leaf and assign its original occupant and the dragged window
  to the resulting children according to the final pointer position in the
  target geometry.
- Collapse the dragged window's now-empty origin leaf through the existing
  ownership/reconstruction pipeline.
- Add focused unit tests, including the accepted three-window tree-shape
  example.

## Non-Goals

- No structural changes during `interactiveMoveResizeStepped`.
- No drag cancellation work, outline/preview rendering, C++ or Rust work,
  stacked/tabbed tiles, or workspace features.

## Constraints

- Reuse the existing reconstruction and ownership pipeline.
- A removal and a split must be in separate phases, with the established
  one-shot event-loop yield between them.
- After a removal, decode the whole root again before resolving any tile.
- Do not edit generated `kwin/contents/code/main.js`.
- No live-host mutation or nested-compositor validation is required for this
  stage.

## Behaviour

- A drop in the upper, lower, left, or right portion of the target creates the
  corresponding split and places the dragged window in that portion.
- A drop in the central dead zone defaults to a vertical split with the original
  occupant above and the dragged window below. This is the initial ergonomic
  default and may be refined from real use.
- Given `Left=term1`, `Right=[Top=term2, Bottom=term3]`, dropping `term2` in
  the lower portion of `Left` produces `Left=[Top=term1, Bottom=term2]` and
  `Right=term3`.

## Acceptance Criteria

1. Native post-drop two-window target overlaps are detected only after
   `interactiveMoveResizeFinished`.
2. The target is reflowed by a position-directed split, not a swap.
3. The vacated origin is collapsed after the required yield, leaving its sibling
   to reclaim the space.
4. The accepted three-window example is asserted as a tree shape by a unit test.
5. New tests fail without the implementation and the static verification suite
   passes.
