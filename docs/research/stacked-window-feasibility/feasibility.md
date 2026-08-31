# Stacked Window Feasibility

Status: Bounded research complete. The existing script treats each owned Custom
Tile as one occupant. KWin's documented surface exposes a tile's windows as a
list, but neither the available API documentation nor this read-only review
proves that assigning multiple windows to one leaf is stable. A logical group
can be prototyped without KWin calls; direct shared-tile assignment, visibility,
focus, and header rendering require later, separately authorized proof.

## Evidence Quality And Scope

The only externally validated KWin reference is the official scripting API,
which identifies itself as KWin 6.0. It documents global stacking and focus
interfaces, a writable per-window `tile` association, and tile management
interfaces, but it does not state a cardinality guarantee or stacked-group
semantics. Current-code references below are a read-only map of the project
surface; they are useful for scoping a future prototype but are not runtime
proof. The conclusions here are deliberately limited to the independently
documented API boundary and the reported code locations that a future
implementation must revalidate.

## KWin Boundary

### Assignment

`KWin::Tile` exposes `manage(window)`, `unmanage(window)`, and a `windows`
collection, while `KWin::Window` has a writable `tile` association. This means
the scripting surface represents a tile-to-windows relation rather than an API
documented as a singleton property. It does not document whether a second
`manage()` on an unsplit Custom Tile is accepted, retained, or stable across
tile changes.

Conclusion: do not make a feature depend on KWin natively owning a group until
a live spike proves it on the selected KWin version. A static prototype may
model multiple logical members, but must not issue a second tile assignment.

Confidence: High for the API shape; low for multi-member runtime permission.

### Z-order, Visibility, And Focus

KWin documents `workspace.stackingOrder` as a list ordered by visibility, with
later windows covering earlier ones. It separately exposes `workspace.activeWindow`,
`windowActivated`, per-window stacking order, and window-at-position queries.
Thus, if multiple clients share geometry, ordinary global stacking determines
which client covers another; tile membership does not document a group-local
z-order, visibility policy, selected member, or focus-cycling contract.

Conclusion: a future group needs explicit logical member order and selected
member state. It must decide whether inactive members remain overlapped,
hidden, or otherwise transformed only after the live spike establishes what
KWin actually does. The current script cannot infer this from `Tile.windows`.

Confidence: High for global stacking and activation interfaces; low for their
behavior when multiple members are assigned to one Custom Tile.

## Current One-Occupant Boundary

The present model stores window arrays, but uses them as singleton leaves. The
following reported invariants must be redesigned rather than loosened locally:

| Area | Current singleton boundary | Group redesign requirement |
|---|---|---|
| Occupancy | `controller.ts` `dwindleOccupancyMatches` requires exactly one owned-population window per usable leaf. | Distinguish an occupied logical group from its member count. |
| Targeting | `targetOccupantForActive` requires `target.windows.length === 1`. | Resolve a target group and its selected member, not an arbitrary array entry. |
| Move and focus | `moveActiveWindow` rejects non-singleton sources; `focusNeighbor` uses `target.windows[0]`. | Define group-to-group movement and member-versus-group focus separately. |
| Drag and drop | `logic.ts` `planDragPlacement` and `planGeometryDrop` treat a second window only as a transient drag state. | Make group insertion/removal an explicit model operation, not a geometry-drop exception. |
| Preset ordering | `presetOccupants` maps one window to each preset leaf. | Persist logical member order and selection independently of leaf order. |
| Topology reset | `topology-reset.ts` `collapseToRootLeaf` unmanages every occupant before removing tiles. | Detach or preserve all group members deliberately; no member may be silently reassigned. |

Reported supporting locations include `controller.ts` fullscreen restoration,
maximization records, removal cleanup, and deferred reconstruction. They all
currently treat "the tile occupant" as one window and must be revalidated at
implementation time.

## Membership And Lifecycle

Safe group membership is logical application state, not inferred from KWin's
tile window order:

- Represent ordered member identities and an optional selected identity for
  each owned leaf/group.
- Persist that state only through an explicitly designed schema. Current
  records are session-local, so restart and output-reconstruction behavior is
  otherwise undefined.
- On a member's close, float, or external detachment, remove that identity only;
  retain the group while members remain and transition to the existing vacant
  leaf behavior only when it becomes empty.
- On tile removal or reconstruction, snapshot membership, selected member, and
  intent before changing topology. Restore only after physical tile ownership
  has been re-established and KWin behavior is proven.
- Treat duplicate identities, a selected identity absent from membership, and a
  group owned by a foreign or detached window as invalid states.

The current removal path and identity sets are per-window. They need a group
membership lifecycle before any feature can safely retain a shared logical
tile.

## Reconstruction And Window Modes

- Reconstruction: current deferred collapse-and-rebuild verifies a one-window
  bijection. It must preserve logical groups as first-class state and never
  reconstruct by trusting a multi-member physical leaf before the live proof.
- Maximize: current cover geometry records are window-scoped. A future policy
  must preserve group membership while applying maximize only to the selected
  member, with restoration validated against the group snapshot.
- Fullscreen: current scope-level fullscreen protection blocks reconstruction
  and mutation. Group behavior must remain blocked until a later policy and
  live spike establish whether inactive members remain tiled, covered, or
  detached.
- Float: floating one member must detach only that member. A remaining group
  stays occupied; only an empty group may follow existing vacant-leaf or
  topology-collapse rules.

These are architecture boundaries, not selected behavior policies.

## Header Dependency

The prior [window visual-effects feasibility](../window-visual-effects-feasibility/feasibility.md)
found that the current package is a JavaScript KWin script, not a rendering
effect. It also found that a declarative `SceneEffect` is not proven to render
over arbitrary client content and that native C++ is only a candidate, not a
selected carrier. A custom group header over Qt, client-side-decorated,
non-Qt, or XWayland clients therefore inherits that unresolved visual-carrier
gate. This research does not select a carrier or header policy.

## Risk-Ranked Architecture

1. Lowest risk - non-mutating static prototype: add a pure logical group model
   above the existing leaf shape, using fixtures only. It records ordered member
   IDs, selected member, insertion, member removal, and reconstruction snapshots
   without reading or writing KWin tile state. This is the only prototype that
   can proceed before live authorization.
2. High risk - native shared-tile experiment: assign more than one real window
   to one Custom Tile only in a separately authorized live stability spike. It
   must prove `manage()` cardinality, geometry, stacking, focus, detach, close,
   reconstruction, maximize, fullscreen, and float behavior.
3. High risk - group header: select and validate a visual carrier only after the
   separate visual-effects decision matrix proves it can cover the required
   client classes. Header rendering is not part of tile membership proof.

## Static Prototype And Live Spike Boundaries

Static prototype, not authorized by this change:

- Pure data model and fixture-driven state transitions only.
- No KWin API calls, package changes, live session commands, or renderer.
- No claim that logical members can become physical `Tile.windows` members.

Live stability spike, separately authorized:

- Read and follow `docs/live-kwin-testing.md` before any live work, after
  explicit mutation authorization.
- On the selected KWin version, attempt a second `manage()` for one unsplit
  Custom Tile and observe its resulting `windows`, geometry, `stackingOrder`,
  `windowAt`, `activeWindow`, and activation signals.
- Exercise close, unmanage, drag, reconstruction, maximize, fullscreen, and
  float transitions while checking that every member is recoverable.
- Independently test candidate header carriers for stacking, geometry, cleanup,
  and client coverage. Do not combine this with the membership spike.

## Parked Product Decisions

- Member order, selection model, activation and keyboard navigation.
- Whether non-selected members overlap, hide, minimize, or use another visual
  presentation.
- Drag insertion, extraction, split, merge, and close affordances.
- Header presence, controls, content, geometry, and visual style.
- Visual carrier selection and target KWin compatibility floor.

## Sources

1. [KWin scripting API](https://develop.kde.org/docs/plasma/kwin/api/) - KWin
   6.0 API documentation for `KWin::Tile`, `KWin::Window::tile`,
   `workspace.stackingOrder`, `workspace.activeWindow`, `windowActivated`,
   `windowAt`, and stacking visibility ordering.
2. [Window visual-effects feasibility](../window-visual-effects-feasibility/feasibility.md) - prior project research establishing the unresolved rendering-carrier boundary for a header.
