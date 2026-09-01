# Pointer Interactive Resize

## Goal

Resize tiled windows by adjusting shared split boundaries or ratios and
reflowing neighbouring tiles.

## Scope And Non-Goals

- Static behavior and focused regression coverage must preserve tile topology
  and neighboring reflow.
- This record covers pointer resize, not keyboard layout expansion or
  multi-output proof.

## Acceptance

- A pointer drag adjusts a shared split boundary or ratio, reflows neighbouring
  tiles, and preserves the Custom Tile tree.
- Live acceptance requires a disposable layout, fresh user authorization, and
  manual confirmation of pointer behavior.

## Approach And Dependencies

- The static path depends on stable Custom Tile topology and may be accepted
  from static evidence without live proof. Live acceptance remains gated on
  L-01 and separate bounded authorization.

## Outcome And Next Action

- The static implementation and review are accepted. The live L-01 proof is
  unrun.
- Next action: obtain a bounded live authorization and run the manual proof.

## Verification

- Static implementation and focused regression coverage are accepted. No live
  pointer result is claimed.

## Material Decisions And Accepted Evidence

- Shared split boundaries and ratios remain the selected resize behavior;
  neighbouring reflow is required.
- The static path is accepted, while the live L-01 proof remains unrun.
