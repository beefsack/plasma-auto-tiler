# KDE floating directional navigation

## Goal and scope

- User decision 2026-10-05: KDE float-origin directional focus follows COSMIC;
  ordinary and sticky floats share the floating candidate layer. Tile-origin
  behavior stays unchanged. Windows implementation waits for the next PC session.
- Deliver focus, then explicit stateless half-screen floating snaps. Stop before
  persistent half/quarter/maximize/transfer state or new transfer machinery.
- No live KWin/Plasma testing; laptop acceptance is user-owned. Never modify or
  stage the user-owned `devenv.nix` change.

## Accepted source findings and design

- COSMIC `3d55cba0`: float focus compares top-left positions on the requested
  axis, ignoring perpendicular distance. Up/Left include equal positions and
  choose first minimum; Down/Right require positive movement and choose last
  nearest tie. Candidate iteration is sticky first, then ordinary floats.
- KWin uses native observation encounter order within those layers; ties can
  differ from COSMIC's native Space ordering. Tiles are never local candidates.
- COSMIC misses navigate workspaces on the configured axis, otherwise outputs.
  Preserve our existing edge policy: no workspace cycling; Up/Down retain;
  Left/Right use reciprocal adjacent output remembered eligible tiled focus,
  or retain if unavailable. Tile-origin focus/move are unchanged.
- Local float search uses existing native observations synchronously. A minimal
  internal focus flag is required for cross-output fallback because the existing
  tiled-focus command rejects floating subjects before consulting remembered
  target focus. Float replies carry `from_leaf: null` and a
  `focused-floating-window` precondition, preserving an honest leafless source
  even when the source has no tiles. Preserve reply fences and core
  remembered-focus authority.
- Half-snaps are explicit user geometry actions within the floating layer, not
  tile admission. Repeated arrows request that half again. COSMIC's later snap
  transitions need per-window state, maximize integration and workspace/output
  transfer handling, and are deferred.

## Units and acceptance

1. Research: confirm source metrics, ties, fallback and ownership. Accepted.
2. Focus: implementation and tests for float/sticky candidates, misses,
   cross-output fallback, tile exclusion and unchanged tiled navigation.
   Independent review found false source-leaf binding and float-only source
   retention in the first implementation; repaired once with the leafless
   contract and immediate ineligible-subject refusal. Review accepted the repair;
   output-local sticky visibility and duplicate-observation fencing confirmed.
3. Half-snap: bounded explicit geometry writes with identity, single-flight,
   overlay and anti-fighting fences, tested for all four directions and sticky.
4. Independent review of native writes and internal contract, then records and
   requested gates. Commit only intended files and push main after acceptance.

## Verification

- `kwin/`: `npm test`, `npm run typecheck`, `just build-kwin-script`.
- With Rust changes: `cargo test --workspace --offline`,
  `cargo fmt --all -- --check`,
  `cargo clippy --workspace --all-targets -- -D warnings`, `just check-portable`.
- Root `git diff --check`. Live checks remain pending and are not run here.

## Outcome

- Focus gates: 873 KWin and 1107 Rust tests passed; typecheck, script build,
  formatting, strict clippy, portable check and diff check passed. Independent
  review accepted the focus repairs. Half-snap implementation pending.
