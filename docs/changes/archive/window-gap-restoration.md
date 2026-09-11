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
