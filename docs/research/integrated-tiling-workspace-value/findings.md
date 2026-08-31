# Accepted Product Justification

Status: accepted product and technical synthesis. This record preserves the
durable verdict from the integrated tiling and workspace value audit.

## Verdict

**Strong justification, scoped to the persistent-authored-layout target segment
(J9/J10), not to the general market.**

The stock Plasma plus Krohnkite baseline has repeatable blockers in the target
segment's normal workflow: authoring persistent structure, directly placing a
window into that structure, and retaining authored empty branches. The general
market scan does not claim a universal high-frequency blocker.

## Evidence Basis

- Stock Plasma 6.7.4 provides a persistent, recursive, both-axis Custom Tiling
  tree with retained empty regions and per-output/per-desktop scope.
- Krohnkite 0.9.9.2 derives layouts from the ordered window set. It has no
  authored-topology model, preselection, split-on-drop, or authored empty-branch
  semantics.
- Krohnkite is unaware of KWin Custom Tiling and re-commits its own geometry;
  the authored tree therefore becomes inert while Krohnkite controls layout.
- The missing target workflow is source-established, not inferred from a
  wishlist or from an unmeasured runtime failure. The baseline has no coherent
  documented rescue for J9/J10.
- COSMIC and Hyprland provide source-backed precedents for automatic insertion,
  pointer-directed splitting, and keyboard-directed insertion. The bounded
  bspwm reference provides persistent authored topology, receptacles,
  preselection, and state save/load, but not pointer drag-to-split.

Detailed evidence remains in [the evaluation rubric](evaluation-rubric.md),
[the Plasma/Krohnkite baseline](plasma-krohnkite-baseline.md),
[the comparator audit](cosmic-hyprland-comparison.md), and
[hands-on validation](hands-on-validation.md).

## Product Plausibility

An integrated Plasma product can plausibly close the target workflow without
replacing normal Plasma behavior. The closure requires a tile-aware dynamic
tiler that preserves authored Custom Tiling structure, keyboard-directed
insertion, pointer drag-to-split placement, automatic placement into authored
regions, explicit empty-branch semantics, correct multi-output behavior, and a
coherent install/enable/configure experience. No implementation language or
plugin architecture is selected by this verdict.

Multi-output behavior remains complementary evidence: per-output structural
scope is supported, while Krohnkite's per-output desktop handling and the
inert authored tree create documented friction. Unknown hotplug, session
restore, and repeated-action behavior are not converted into failures.

## Next Gate

The smallest next gate is a scoped technical feasibility validation of the
combined structural workflow and its coherent package boundary. Broader
sustained-workload validation remains paused pending that gate. This record
does not authorize live testing, implementation, installation, or publication.
