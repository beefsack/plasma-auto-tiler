# COSMIC Floating Navigation Research

## Goal And Scope

- Establish source-proven directional focus and movement for COSMIC ordinary
  and sticky floating windows, with reference-WM and current KDE/Windows comparisons.
- Clone the user-authorized prior-art inventory into the requested sibling
  folders; preserve existing folders and report failures.
- Add minimal discriminating rows and pinned evidence to
  `docs/spec/reference-outcomes.md`. Unsupported outcomes stay TBD.
- Research only: no product behavior or decisions, live desktop testing,
  builds in reference clones, commits, or pushes.
- Preserve the existing user changes in `devenv.nix`, `docs/backlog.md`,
  `docs/changes/archive/kde-post-windows-followups.md`,
  `kwin/src/plan-adapter.ts`, and `kwin/tests/plan-adapter.test.ts`.

## Acceptance And Verification

- Report each inventory/deferred clone folder, pinned HEAD, and clone status.
- Answer tiled-to-float focus, float-origin focus, and float movement,
  including sticky distinctions, using pinned file:line citations.
- Matrix rows use existing IDs/evidence conventions and distinguish
  source-proven outcomes from live-test TBDs.
- Verify citations against actual sources, inspect the final diff, and
  compare the protected-file diff hash with the initial value
  `4f4e617b34055c38b9d81cb166cde660b905560c24d60000c9f9b53ed87782cf`.

## Bounded Units And Dependencies

1. Clone inventory and deferred projects; return statuses and pins.
2. Investigate COSMIC focus/move and current KDE/Windows behavior.
3. Investigate reference-WM comparison for the agreed minimal rows.
4. Integrate the matrix evidence, verify, archive this note, and report
   differences/options for the user's decision.

## Decisions And Outcome

- No behavior decision is authorized; findings inform a later user choice.
- Completed the inventory/deferred clones: 32 new full default-branch clones,
  one existing repository preserved, no failures. Hyprland/FancyWM required
  submodules are populated. Clone locations/inventory remain machine-local,
  reported in the session rather than added to governance or prior-art notes.
- Added R-FLT-07 through R-FLT-10 with ordinary/sticky repeats and explicit
  zero-gap fixtures: tile-origin focus, lone-float focus, float-to-float focus,
  and unsnapped-float directional move.
- COSMIC `3d55cba06c9cf6f27609cdefb520f7857dba20af` searches tile-only
  from tiles and ordinary/sticky float-only from floats
  (`src/shell/mod.rs:4136-4210`). A local miss falls back to workspace/output
  navigation (`src/input/actions.rs:745-810`). Free-float move snaps to a
  half without joining the tile tree
  (`src/shell/layout/floating/mod.rs:1184-1288`).
- KDE/Windows exclude floats as targets, agreeing with COSMIC, but refuse
  float/sticky-origin focus and move. Pinned own-source evidence at
  `2bdd944536fa2608f60b68686f8ec57d61663726` uses unchanged lines:
  `kwin/src/plan-adapter.ts:2183-2186,2639-2642` and
  `crates/tiler-windows/src/tiling_sys.rs:5904-5954`.
- Hyprland `19fb395d45314960e6f79f17994a84094f1cd4f6` also keeps ordinary
  directional focus within layers, but floats move to an edge retaining size.
  bspwm `e11eff4cb3333216ad03c815609a4ed79e08929c` unqualified focus
  crosses layers; its configured move is a tree-node swap, not pixel movement.
  i3 `903bcd518df32b0e055b17f5da3f988a0187fd3d` cycles floats horizontally
  by list and moves them 10px by default. xmonad
  `284dd52c9c957cab6b6e5cc7580f2a63dafa00a7` directional implementation
  is unspecified in the core-only profile, so those cells remain TBD.
- Detailed pinned file:line evidence is in the matrix legend. Native delivery,
  unspecified ties/configurations, and bspwm B's exact post-swap frame stay TBD.

## Accepted Verification And Handover

- Relevant source/citations and final matrix diff inspected; zero-gap
  fixtures establish Hyprland adjacency without a gap-dependent inference.
- Verified all 33 repository HEADs and non-shallow status; all 32 new clones
  are clean. Verified recursive Hyprland/FancyWM submodule status and existing
  repository remotes without mutation.
- `git diff --check` passed. Protected-file diff SHA256 equals the initial
  value above; all five user-owned files are untouched.
- Research-only checks; no builds or live desktop tests were run.
- Research is complete; a future
  behavior change requires the user's choice between COSMIC parity (float-only
  focus and/or floating snap movement) and retaining current refusals.
