# Custom Tile Runtime Acceptance

## Goal

Validate the delivered Custom Tile, drag/reflow, floating, fullscreen, and
workspace behavior on KWin without widening the live safety boundary.

## Scope And Acceptance

- Static implementation is delivered; live claims require the procedures in
  [the live testing guide](../live-kwin-testing.md).
- Drag signal delivery, reflow, motion cleanup, cadence, and XWayland behavior
  remain unproven. The KWin client-realization drag gap is not an engine defect.
- Deferred window eligibility now attaches the same interaction handlers as the
  immediate path; its static evidence is accepted, while the generic Steam
  move/placement journey remains parked.

## Material Safety Finding

- Never run `remove()` followed by `split()` against a changed tile tree, use a
  timer as a deferred-deletion barrier, or run structural probes in a persistent
  user scope. Re-resolve tile handles after removal.
- Isolated nested evidence supports deferred reconstruction that re-resolves
  after removal. It proved 4-to-3 and 3-to-2 rebuilds, but did not establish
  one-to-zero cases, detached-window close, physical shortcuts, or host live
  acceptance.

## Next Action

Obtain bounded user authorization for the relevant manual journey.
