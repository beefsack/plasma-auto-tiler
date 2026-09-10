# Fractional Geometry Attach

## Goal

Restore packaged Rust-mode attach on KWin 6.7.4 fractional-scale displays so a
manual `Meta+Right` can reach the Planner.

## Scope

- Quantize finite public `QRectF` frame and work-area values at the movement,
  keyboard-resize, and pointer-resize KWin observation boundaries.
- Keep the Rust geometry wire contract integral and retain every existing
  all-or-nothing and fail-closed authority boundary.

## Evidence

- The current-boot logs first recorded `attach:result=unavailable:slices=4`
  with `failed=multiple`, then one consumed retry and no D-Bus or Planner line.
- KWin 6.7.4 on the Scale-1.25 `eDP-1` exposes public `QRectF` geometry. The
  three geometry adapters previously rejected each fractional component before
  transport; focus alone does not read geometry.

## Outcome

- The three observation boundaries now round finite, safe-integer geometry
  components. Non-finite and unsafe values remain rejected, so malformed input
  still leaves the whole Rust attach unavailable.
- Focused fractional-surface, adapter, and Rust tests pass; KWin typechecking
  passes in the current source and an isolated bundle contains the correction.
  An independent review found no required authority, cleanup, retry, scope,
  Session, D-Bus, or Legacy-fallback correction. No live mutation ran, and new
  KWin behavior is not claimed until the changed source is deployed.
