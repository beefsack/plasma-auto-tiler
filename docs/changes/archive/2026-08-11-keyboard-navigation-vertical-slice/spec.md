# Specification: Keyboard Navigation Vertical Slice

Ownership and approval:
- Owner: Lead (`lead-openai`).
- Change class: Standard.
- Status: Static scope completed and archived on 2026-08-11 after autonomous
  alignment and result approval.
- Artifact map: [plan](plan.md).
- Dependencies: accepted Custom Tile `unit-01`, `unit-02`, and `unit-04` foundations from [custom-tile-vertical-slice](../../custom-tile-vertical-slice/). Its `unit-03` runtime behavior and `unit-05` live acceptance remain unaccepted.

## Intent and Desired Outcome

Add four keyboard actions that move focus left, right, up, or down among
eligible managed windows in the active window's exact current output and
desktop scope. A successful action changes only KWin active focus; it does not
move a window or alter authored Custom Tile topology.

## Scope and Constraints

In scope:

- Pure, deterministic directional-neighbor selection over existing decoded
  Custom Tile leaves.
- Current-scope eligibility using the existing exact Output object reference
  plus virtual-desktop ID model.
- Four focus actions registered through the existing shortcut-registration
  gate: left `plasma-auto-tiler-focus-left` / `Focus window left` /
  `Meta+Alt+H`; down `plasma-auto-tiler-focus-down` / `Focus window down` /
  `Meta+Alt+J`; up `plasma-auto-tiler-focus-up` / `Focus window up` /
  `Meta+Alt+K`; and right `plasma-auto-tiler-focus-right` / `Focus window
  right` / `Meta+Alt+L`.
- A narrow KWin 6.7.3 declaration correction for writable
  `Workspace.activeWindow`, justified by `src/scripting/workspace_wrapper.h`:
  `Q_PROPERTY(KWin::Window *activeWindow READ activeWindow WRITE setActiveWindow NOTIFY windowActivated)` at pinned commit `45ec9a6d0ed312a803ff5658a2a3e61f221566c6`.
- Fixed, private diagnostics. Every rejection is a no-op; success assigns only
  the selected eligible window to active focus.
- Each focus callback emits `focus-invoked`, then exactly one first-failing
  rejection: `focus-rejected:no-active-window`,
  `focus-rejected:desktop-output-scope`,
  `focus-rejected:active-window-eligibility`,
  `focus-rejected:root-lookup`, `focus-rejected:topology-decode`,
  `focus-rejected:active-tile-association`,
  `focus-rejected:focused-occupancy-validity`, `focus-rejected:no-neighbor`,
  or `focus-rejected:target-occupancy-validity`. Guard order is the listed
  order. No focus-success diagnostic is required.

Constraints:

- Preserve the accepted Custom Tile architecture and authored topology. Do not
  add persistence, dependencies, a KDE component, unsafe casts, broad ambient
  declarations, `any`, non-null assertions, or manual generated-JavaScript
  edits.
- Continue strict runtime guarding and bounded decoding at every KWin/Qt
  boundary. Output identity remains session-local exact object identity and
  virtual-desktop ID only.
- A candidate must be a non-layout occupied leaf in the active scope. Its
  occupants must pass the existing eligible-window and scope checks; focus the
  deterministic eligible occupant selected by existing leaf/window ordering.
- The pure neighbor rule is geometry-only: its perpendicular half-open
  intervals must overlap, its facing edge must be strictly on the requested
  side, and the smallest facing-edge distance wins. Ties use existing
  `compareLeaves` y/x/id ordering. Gaps are permitted; no candidate means no
  wrap and no-op.

Non-goals:

- No window move, swap, split, manage/unmanage, topology mutation, workspace
  creation, output identity change, persistence model, effects, layouts,
  configuration UI, or live action.
- No change to the active Custom Tile specification or plan, the technical
  report, `docs/principles.md`, or `docs/decisions.md`.
- No claim that the unaccepted Custom Tile runtime behavior works in KWin.

## Acceptance Criteria

- [ ] Pure tests cover all four directions, nested authored topology leaves,
      perpendicular overlap, gaps, non-overlap rejection, no-wrap, equal
      distance ties, and immutable/no-mutation results.
- [ ] Controller tests prove only exact-scope eligible windows participate;
      invalid active window, topology, focused-leaf, target, and no-neighbor
      paths are fixed-diagnostic no-ops.
- [ ] A successful action assigns only the selected target to active focus and
      retains every window/tile association and topology input unchanged.
- [ ] The local KWin declaration expresses writable `Workspace.activeWindow`
      from the pinned source evidence without an unsafe type escape.
- [ ] The existing registration gate registers all four declared actions, emits
      fixed private observability, and disables inertly when any registration
      fails.
- [ ] Strict typecheck, generated-bundle build, and automated tests pass; live
      behavior remains manual-blocked and is not a static-delivery gate.
