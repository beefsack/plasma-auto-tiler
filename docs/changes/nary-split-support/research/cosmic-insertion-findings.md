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
