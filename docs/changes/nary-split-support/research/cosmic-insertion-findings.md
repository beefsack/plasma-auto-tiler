# COSMIC insertion findings

Promoted evidence for new-window insertion. It establishes focused-cell
subdivision, not the directional move-insertion sizing rules.

## Test 2 - focused-cell subdivision

- Before `Screenshot_2026-08-21_18-22-52.png`, A was approximately 23.3%, B
  approximately 52.6%, and C approximately 23.0% of screen width.
- After `Screenshot_2026-08-21_18-23-30.png`, A, B, and C widths were
  unchanged. Within B's column, B was approximately 49.4% and D approximately
  50.6% of work-area height, separated by a gap.
- These values are approximate because they were measured from a downscaled
  render, not source PNGs at native resolution. The established fact is
  unchanged siblings plus an even focused-cell split within measurement error,
  not an exact 50/50 result.
- The faint segmented strip in `Screenshot_2026-08-21_18-23-30.png` is desktop
  background visible through, not a handle, tab, or stacking indicator.

## Structural Observations

- Sequential opens dwindle into nested pairs, never a wide N-ary row. C was
  initially below B and had to move right twice; see
  `Screenshot_2026-08-21_18-21-45.png` and
  `Screenshot_2026-08-21_18-18-33.png`.
- Longest-axis corroboration: B was deliberately wider than tall, and opening D
  placed D on the right; see `Screenshot_2026-08-21_18-24-32.png` followed by
  `Screenshot_2026-08-21_18-24-58.png`.
- Close inverse: closing D restored B's former full cell with siblings
  untouched; see `Screenshot_2026-08-21_18-26-41.png`.

## Earlier Session Observations

- Start `H[A,V[B,C],D]`, A/D portrait, B/C landscape.
- Focusing A then opening E split A vertically with E below:
  `H[V[A,E],V[B,C],D]`.
- Focusing C then opening E split C horizontally with E right:
  `H[A,V[B,H[C,E]],D]`.
- An arriving window moved from another workspace behaved identically to a new
  window. This is distinct from directional move-insertion.
- The workspace remembered its last-focused window; an arriving window split
  that remembered window.
- Moving between workspaces on an output differed from output-edge move (R4).

## Follow-up manual sizing observations (Tests A-C)

These observations were made at 1920x1080 with 100% scale. They record sizing
results without extending the new-window insertion finding or changing the
approved directional-move rules.

- **Test A - float removals.** The equal A/B/C/D row in
  `Screenshot_2026-08-22_21-37-56.png`,
  `Screenshot_2026-08-22_21-38-48.png`, and
  `Screenshot_2026-08-22_21-40-50.png` was reduced by floating B and then C.
  After floating B, A/C/D were uniform at 640px each; after floating C, A/D
  remained uniform. This records equal-survivor normalization after removal,
  not directional escape S3.
- **Test B - existing-window between-child insertion.** From an equal A/B/C
  row, an existing N was dragged to the between-child bar between A and B in
  `Screenshot_2026-08-22_21-44-13.png` and
  `Screenshot_2026-08-22_21-45-05.png`. The four direct children were all
  480px. This corroborates existing move-insertion sizing: the mover takes
  `1/n` and existing direct children scale uniformly. It does not establish
  new-window insertion. The child-drop affordance is distinct and yields a
  nested split rather than a flat four-child insertion.
- **Test C - ratio-preserving float removal.** The 50/30/20 row was
  960/576/384px before floating the 50% child, as shown in
  `Screenshot_2026-08-22_21-47-56.png` and
  `Screenshot_2026-08-22_21-48-37.png`. The remaining children became 60/40 at
  1152/768px, preserving the original 30:20 ratio and normalizing to fill the
  parent. This is an observed float-removal result, not a generalized
  directional-move or new-window rule.
