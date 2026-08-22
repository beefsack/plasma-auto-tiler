# Specification: N-ary split container support

Ownership and approval:

- Owner: Lead
- Status: Approved by Orchestrator; unit-08 split into 08a and 08b

## Objective

Replace the project's structural assumption that every split has exactly two
children with support for ordered N-ary direct children. This is the shared
architectural prerequisite for the `controller.ts` source split and COSMIC
directional movement; it is not a COSMIC-only accommodation.

## Scope

In scope:

- Represent and validate an ordered list of direct split children. A nested
  group is exactly one direct child.
- Generalize split decoding, construction, reconstruction, validation,
  minimum-size checks, resize handling, and reflow normalization where their
  current contracts require two children.
- Support same-axis wrapping for existing-window insertion, parent escape,
  one-child collapse, and operations on splits with three or more direct
  children.
- Generalize supported new-window insertion locally: perpendicular insertion
  uses the requested keyboard direction, while automatic/dwindle insertion
  selects the focused cell's longest axis. The local split is approximately
  50/50, leaves sibling extents and parent weights unchanged, and preserves
  applicable parent escape, one-child collapse, and binary behavior.
- Reject new-window insertion before topology mutation when the selected or
  requested axis matches the target parent and no supported atomic local
  wrapper exists. The incoming window remains unassigned/floating.
- Make every 3+-child topology decision from direct-child count and order, never
  width, screen position, or other geometry.
- Characterize and preserve every binary-only behavior. For identical
  binary-only inputs, the existing native layout serialization and window
  assignments must be byte-identical to the pre-migration baseline. The
  comparison is not against a serialization of the new project model: that
  would not establish preserved observable behavior.
- Extend focused tests across the inventory in
  `research/binary-coupling.md`, without changing unrelated behavior.

## Non-Goals

- Implementing COSMIC directional-move runtime behavior, a model selector, or
  any other window-management strategy.
- Coupling or importing `kwin/tests/move-conformance-model.ts` into runtime
  code. It remains a pure, KWin-independent reference implementation.
- Claims about parity descent into a target nested more than one level deep.
- Claims about behavior after a manual split resize, beyond the resize contract
  selected under Pending User Decisions.
- Using geometry as a proxy for child count or child order in 3+-child
  operations.

## Constraints

- KWin native tiles are not assumed structurally binary. The current binary
  coupling is a project-layer concern.
- KWin's `split(direction)` input takes one direction. The available evidence
  does not establish native result cardinality; the project must not turn its
  current two-child decode policy into a native API claim.
- Existing binary-only strategies must retain byte-identical layout results.
- No runtime behavior may depend on the conformance model.
- New-window insertion must not float-then-move, substitute a perpendicular
  split, flip the requested direction, remove and rebuild topology, use private
  APIs, or use project-owned geometry to emulate a native split.
- Sequential new-window opens do not form wide N-ary rows. Existing-window
  unit-07 same-axis drag remains direct parent expansion with its accepted
  behavior unchanged.

## Acceptance Criteria

- [ ] The core split contract accepts and preserves ordered direct-child lists,
  including a nested group as one child, and rejects malformed lists
  deterministically.
- [ ] Focused structural tests cover same-axis wrapping and parent escape in
  3+-child containers, including immediate adjacency, one-child collapse, and
  geometry-independent child count/order decisions.
- [ ] Supported new-window insertion covers keyboard and automatic/dwindle
  local/perpendicular paths, including focused-cell longest-axis selection,
  requested keyboard direction, opaque native-return adapter re-decode, and
  applicable parent escape, one-child collapse, and binary preservation.
- [ ] Unsupported same-axis new-window insertion is rejected before any
  topology write, leaving the incoming window unassigned/floating with zero
  topology writes.
- [ ] Each of the 24 direct binary-coupled functions and both named
  structural-binary types in `research/binary-coupling.md` is migrated,
  removed, or retained behind an explicitly N-ary-safe contract.
- [ ] The 13 affected test files and shared fixture identified by the research
  inventory have appropriate updated or added coverage.
- [ ] Characterization tests prove byte-identical existing native layout
  serialization and window assignments for all existing binary-only fixtures
  before and after the migration, rather than comparing the new internal model
  with itself.
- [ ] `npm --prefix kwin test` passes, `npm --prefix kwin run typecheck` is
  clean for both tsconfigs, and `bash scripts/dogfood-install.test.sh` reports
  zero failures.

## User Decisions

- Settled - use a hard migration to ordered child arrays. Do not retain a
  compatibility shim. The project is pre-release, so breaking changes are
  acceptable to keep the design simple.
- Settled - represent N-ary proportions as per-child weights normalized at
  layout time. Do not introduce a sizing mode, scroll offset, or flow container
  until a strategy needs one. Sum-to-1 must not become a persisted invariant:
  keeping stored weights un-normalized is what keeps a later sizing mode cheap.
- Settled - resize is divider-based. The direction selects the divider; only
  the focused child and the sibling across that divider change weight. This
  degenerates to the current binary behavior at two children by construction.
- Settled by evidence - move-insertion normalization for an existing window
  entering a container through a directional move follows S1-S4 in
  `docs/cosmic-move-conformance.md#sizing`: the mover receives `1/n` of the
  target extent, a nested group counts as one direct child, and existing direct
  children retain their relative proportions while scaling by `(n-1)/n`. R2b's
  target-axis precondition is governed by
  `docs/cosmic-move-conformance.md#the-rules`, not by a design choice.
- Settled - New-window insertion sizing: a new window subdivides the focused
  window's own cell approximately 50/50, splitting along the focused window's
  longest axis. No sibling's extent changes. The parent container is NOT
  re-weighted. Unlike move-insertion, which gives the mover an equal share and
  scales existing direct children by `(n-1)/n`, new-window insertion does not
  renormalise.
- Settled - Supported new-window insertion is local and atomic. Keyboard
  insertion preserves the requested direction; automatic/dwindle insertion
  selects the focused cell's longest axis. Same-axis selection/request against
  a target parent is unsupported when no supported local wrapper exists and
  must reject before topology mutation, leaving the incoming window
  unassigned/floating.
- Settled - Existing-window unit-07 same-axis drag remains direct parent
  expansion. New-window insertion is not allowed to obtain a wide N-ary row by
  sequential opens.
- Settled jointly with ordered child and native boundary - the project owns an
  ordered N-ary layout model as the semantic source of truth for direct-child
  order, weights, adjacency, and container meaning. No native KWin type or
  geometry-derived order appears in project semantics; the geometry sort in
  `orderedChildren` is deleted rather than generalized. A narrow, pinned adapter
  projects the project model onto native tiles. KWin is the rendering and
  mutation substrate, not the model. E4 establishes that, on an observed
  one-child root, `tile.tiles` is indexed and iterable array-like:
  `Array.isArray(tile.tiles)` is false despite prototype constructor name
  `"Array"` (`research/native-binding-evidence.md:156-170`). The adapter must
  not use `Array.isArray` guards or assume `Array.prototype` methods.
  Multi-ordinal native order remains unestablished;
  `CustomTile.split(direction)` JavaScript return shape, return order, and
  cardinality remain unproven and parked. Form N-ary semantics in the project
  model and never infer them from native geometry. If evidence contradicts that
  candidate contract, redesign only the adapter, not the project semantic model;
  this asymmetry is why approval can precede the evidence. Semantic authority is
  session-scoped; restart and manual-native-edit persistence remain evidence
  questions because they depend on native support for a 3+-child container.
- Settled - `move-conformance-model.ts` is reference documentation only, not a
  behavioral oracle for N-ary structural tests. Structural tests use independent
  synthetic N-ary fixtures covering ordered direct children, same-axis wrapping,
  parent escape, one-child collapse, and existing binary behavior.
- Rationale - this is a pure structural migration accepted by byte-identical
  native serialization and window assignments, not movement conformance
  (Scope 28-32; Non-Goals 38-41; Constraints 55-56). The archived move-model
  specification makes the live corpus ground truth and treats a model
  disagreement as a model defect, never a reason to alter corpus evidence
  (`docs/changes/archive/2026-08-20-cosmic-move-model-closure/spec.md:9-13`).
  Model-coupled expected results stay green when the model drifts with them from
  the corpus; that failure class has occurred three times.

## Frozen Cross-Unit Contracts

- New-window insertion is approximately 50/50 along the focused cell's
  longest axis, with no sibling extent change or parent reweighting except on
  rejection.
- A native split return is opaque and is decoded only by the approved adapter
  re-decode. Geometry ordering is adapter-only; project semantics do not infer
  native cardinality or order.
- No unproven native cardinality claims are permitted, and native bindings must
  not be guarded with `Array.isArray`.
- Existing comments and zero guards remain load-bearing and must be preserved.
- Dead drag-planning tests, types, and functions remain untouched, as do the
  resize characterization, unit-06 neighbor formula, unit-07 drag behavior,
  workspace invariants, the single `flashFocusedGroup` call site, and the
  controller's structure. No controller structural refactor is part of this
  amendment.

## Native Scope Note

- This is scope evidence, not a decision. Existing-window drag
  (`kwin/src/controller.ts:5826-5857`) and keyboard
  (`kwin/src/controller.ts:6025-6069`) and new-window insertion paths pass only
  their split direction to `splitCustomTile` without a parent-orientation
  check, while native same-axis `CustomTile::split()` inserts a sibling into
  the parent
  (`research/native-binding-evidence.md:21-26`). Columns/rows preset
  reconstruction (`kwin/src/preset-catalog.ts:39-52`) and blueprint
  construction (`kwin/src/layout-blueprint.ts:69-77`) also request directional
  native splits, so these paths can potentially reach N-ary native containers.
- Counterweight: QJSEngine marshalling is unproven, and both binding probes were
  invalidated. This does not establish that a script-visible N-ary tree arrives
  (`research/native-binding-evidence.md:54-57,58-74,122-139`). Structural tests
  must construct synthetic N-ary trees rather than depend on a native binding.

## Known Migration Defect

The current code applies four incompatible order rules: `orderedChildren`
(`kwin/src/controller.ts:1480-1501`) derives geometry order and rejects
non-pairs; `presetNodeMatches` (`kwin/src/controller.ts:1554-1581`) accepts
either decoded order; `presetTileAtPath`
(`kwin/src/controller.ts:6480-6498`) treats decoded indices as left/right; and
`deepestLeaf` (`kwin/src/controller.ts:6674-6713`) follows the last decoded
child. The migration resolves this only when every site consumes the same
canonical project-model order. Retaining a geometry sort or raw native
traversal at any of these sites relocates the conflict rather than resolving
it; this is an acceptance condition.

## Approval Boundary

Implementation of units 08a and 08b begins only after this amended
specification is approved. The parked unit-08 attempts remain historical and
unaccepted; this artifact reset does not accept their production, test, or
generated changes.
