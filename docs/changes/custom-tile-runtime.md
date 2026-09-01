# Custom Tile Runtime Acceptance

## Goal

Establish a stable Custom Tile runtime for the MVP, including drag/reflow,
floating, fullscreen, maximize, and workspace behavior on KWin.

## Scope And Non-Goals

- Static implementation is delivered. Live claims require the procedures in
  [the live testing guide](../live-kwin-testing.md) and the reviewed standing
  live-test boundary/protocol in [the project decisions](../decisions.md).
- Drag signal delivery, reflow, motion cleanup, cadence, and XWayland behavior
  remain unproven. The KWin client-realization drag gap is not an engine defect.
- Deferred window eligibility now attaches the same interaction handlers as the
  immediate path; its static evidence is accepted, while the generic Steam
  move/placement journey remains parked.
- True tabs, stacked windows, shared tiles (multiple windows per tile), and
  compositor-owned groups are outside this MVP record; nested split-tree
  structure remains in scope.

## Acceptance

- On disposable, project-owned topology with exact restoration, Custom Tile
  structure remains stable through window add/remove, drag/reflow, floating,
  fullscreen, maximize, and workspace journeys.
- Live runtime acceptance requires user-performed physical or manual
  observations; session boundaries require user action; no unperformed live
  result is claimed.

## Approach And Dependencies

- Re-resolve tile handles after structural removal and reconstruct only through
  the accepted deferred path.
- The COSMIC movement and nested-placement records depend on this runtime's
  stable tree behavior.

## Material Safety Finding

- Never run `remove()` followed by `split()` against a changed tile tree, use a
  timer as a deferred-deletion barrier, or run structural probes in a persistent
  user scope. Re-resolve tile handles after removal.
- Isolated nested evidence supports deferred reconstruction that re-resolves
  after removal. It proved 4-to-3 and 3-to-2 rebuilds, but did not establish
  one-to-zero cases, detached-window close, physical shortcuts, or host live
  acceptance.

## Read-Only Preflight

- The installed enabled and loaded controller differs from the checkout
  bundle.
- One project shortcut had drifted.
- Exact restoration of the existing Custom Tile topology cannot currently be
  verified.
- No live runtime acceptance occurred; these preflight findings are not
  acceptance evidence.

## Verification

- Static evidence is accepted. Live Custom Tile, drag/reflow, and related
  journeys remain unrun.

## Material Decisions And Accepted Evidence

- Stable nested split-tree behavior is an MVP dependency for COSMIC movement
  and nested placement.
- Accepted isolated evidence covers deferred reconstruction after removal, but
  does not establish one-to-zero cases, detached-window close, physical
  shortcuts, or host live acceptance.

## Next Action

User action is required for physical or manual observations and any logout,
login, or new-session boundary. Further live tests must use disposable,
project-owned topology with exact restoration; do not mutate the existing
topology.
