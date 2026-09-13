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

- A separate inert native `dragoracle` effect supplies the authoritative final
  move-resize rectangle and cancellation verdict over one read-only effect-owned
  session D-Bus endpoint. The production script pulls it only after finish.
- A non-cancelled single-edge verdict sends one retained `DescribePlan`
  `pointer-resize` command. Esc cancellation and committed net-zero drags are
  strict no-ops: no pointer command and no share change.
- The adapter writes changed neighbours only and retains one exact one-shot
  correlation/source-keyed echo expectation. Matching same-scope neighbour
  echoes update `lastGood`; every mismatch continues through this document's
  bounded reconciliation path.
- The former scripting-only route remains historical reference at
  `wip/production-edge-drag-scripting-route` commit
  `5a760a09666c16ef36a70484446c4c6d96d9a1b6`. Runtime behavior remains pending
  the user-owned checks in [edge-drag-share-adjustment.md](edge-drag-share-adjustment.md).

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
- `npm test --prefix kwin` - 426 passing
- `npm run typecheck --prefix kwin`
- `cargo test`
- `git diff --check`

## User-Owned Rebuild And Live Check

- Follow the separate Slice 1 and Slice 2 user-owned checks in
  [edge-drag-share-adjustment.md](edge-drag-share-adjustment.md). Applying a new
  bundle/effect to an already loaded session remains a user-owned lifecycle
  action; no agent lifecycle action occurred.
