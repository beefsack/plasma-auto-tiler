# Pointer Interactive Resize

## Goal

Resize tiled windows by adjusting shared split boundaries or ratios and
reflowing neighbouring tiles.

## Scope And Acceptance

- Static behavior and focused regression coverage must preserve tile topology
  and neighboring reflow.
- Live acceptance requires a disposable layout, fresh user authorization, and
  manual confirmation of pointer behavior.

## Outcome And Next Action

- The static implementation and review are accepted. The live L-01 proof is
  unrun.
- Next action: obtain a bounded live authorization and run the manual proof.
