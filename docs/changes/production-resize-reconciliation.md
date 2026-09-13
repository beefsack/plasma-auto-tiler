# Production Resize Reconciliation

## Goal

- Stop same-membership geometry changes from silently replacing the production
  tiling baseline while preserving COSMIC allocation authority and the existing
  single-flight and fresh-observation fences.

## Evidence

- The production `DescribePlan` adapter records same-membership geometry drift
  as `lastGood` and sends no command.
- The isolated pointer-resize adapter cannot be wired directly: its backend
  `DescribePointerResize` route was removed and it requires exclusive authority
  plus interactive start/step/finish signals that production does not consume.
- Production's lone `moveResizedChanged` signal cannot distinguish a user edge
  drag, a client self-resize, or an adapter geometry-write echo.

## Accepted Scope

- Add the strict `{ "op": "reconcile" }` `DescribePlan` command. The retained
  Rust session projects its approved topology and allocation; it does not
  derive a new layout from client-drifted rectangles.
- Reconcile only same-scope geometry drift. Fresh membership, output, workspace,
  or domain changes remain normal baseline/admit/remove handling. Focus-only and
  fingerprint-only changes do not allow drifted geometry to become `lastGood`.
- Reassert the retained allocation at most three terminal reconcile attempts,
  then park that scope. Planned apply, rejection, timeout, service fault, stale
  result, and geometry-write failure all consume an attempt. Parking makes later
  repeated geometry signals no-ops: it neither adopts the client rectangle nor
  changes sibling shares.
- The exact three-attempt threshold is an explicit KWin policy, not a COSMIC
  constant. KWin has no verified post-write acknowledgement for constrained
  `frameGeometry` requests, so the policy bounds visible retries rather than
  claiming convergence.

## Interactive Edge Drag

- Production edge-drag share adjustment is blocked by KWin scripting's missing
  cancellation and drag-geometry API. The preserved, unshippable work is on
  `wip/production-edge-drag-scripting-route` at
  `5a760a09666c16ef36a70484446c4c6d96d9a1b6`; see the
  [archived record](archive/production-edge-drag-scripting-route.md).
- Until an unblocking route is selected, a deliberate edge drag remains
  geometry drift: the retained allocation is reasserted up to three times and
  then parked. It does not change shares.
- Client self-resize retention in `2c35435` shipped and works. It is unaffected
  by the production edge-drag blocker.

## COSMIC Reference

- COSMIC assigns tiled geometry from the layout and configures the surface; it
  does not derive sibling allocation from the surface's committed size
  ([allocation authority](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L3115-L3143)).
- COSMIC gates configure progression on the latest requested size with bounded
  blockers ([latest-size gate](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/element/surface.rs#L628-L667),
  [blocker](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/blocker.rs#L15-L53)).
  This supports retaining allocation authority and bounded progression only; it
  does not establish KWin acknowledgement semantics or the three-attempt value.

## Static Verification

- `cargo test --lib planner_protocol`
- `npm test --prefix kwin` - 393 passing
- `npm run typecheck --prefix kwin`
- `cargo test`
- `git diff --check`

## User-Owned Rebuild And Live Check

- Rebuild the generated KWin bundle with
  `devenv shell --impure -- npm run build --prefix kwin`.
- Rebuild and swap the recorded worktree Planner with
  `devenv shell --impure -- just reload`. This does not reload the KWin script.
- Applying the new bundle to an already loaded script requires a user-authorized
  exact controller lifecycle action. No agent lifecycle action occurred.
- After the user applies the bundle, test a normal Wayland constrained client,
  a client self-resize, and an edge drag. Confirm no more than three reconcile
  writes occur for persistent drift, later drift produces no writes, and no
  sibling-share change is claimed from the edge drag.
