# Plan: N-ary split container support

Ownership and approval:

- Owner: Lead
- Status: Ready for Orchestrator approval after new-window insertion sizing resolves

## Baseline Gate

Verified on 2026-08-21 before planning, from `main` at `ad18cc9`:

- `npm --prefix kwin test` - 924 tests, 81 suites, 0 failures, 81 describes.
- `npm --prefix kwin run typecheck` - clean for `tsconfig.json` and
  `tsconfig.test.json`.
- `bash scripts/dogfood-install.test.sh` - 336 assertions, 0 failures.

Every implementation unit starts only while this baseline is reproducible or a
documented accepted change explains its replacement.

## Pre-start Resize Characterization

- Accepted 2026-08-21: `resizeActiveWindow` container-edge behavior is pinned
  in `kwin/tests/controller-drag-diagnostics-and-resize.test.ts` before any
  migration unit starts. The cases cover outward and inward mode-mapped climbs
  that resize the outer container by 5% of its extent, plus outermost refusal
  with no write.
- Static verification after the added tests: `npm --prefix kwin test` - 927
  tests, 87 suites, 0 failures; `npm --prefix kwin run typecheck` - clean for
  both tsconfigs.

## Technical Approach

After the remaining new-window insertion sizing decision and approval, migrate
the project contract from binary child roles to a project-owned ordered
direct-child model. Establish
binary characterization evidence against existing native serialization and
window assignments before changing it, then apply the contract in narrow
operation groups: core logic, native boundary and order, preset reconstruction,
resize, drag, keyboard insertion, automatic/dwindle insertion, and reflow.
Every order-sensitive site consumes the same canonical model order; no site
retains a geometry sort or raw native traversal. A separately scoped
native-binding evidence unit gates native-boundary work: its result may redesign
the adapter but not the project semantic model. Each group carries its focused
tests; the final gate reruns the complete static suite and dogfood installer
test. The conformance model remains reference documentation only. Structural
tests construct independent synthetic N-ary fixtures for ordered direct
children, same-axis wrapping, parent escape, one-child collapse, and existing
binary behavior.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification |
| --- | --- | --- | --- | --- |
| unit-01 | Record the seven settled decisions, including the joint ordered-child/native-boundary contract and reference-only conformance model, and resolve the remaining new-window-insertion-sizing decision before freezing the contracts. | Baseline gate | Approved spec and this plan | Decision record matches the approved spec; static document-link inspection. |
| unit-02 | Add binary characterization fixtures that serialize ordered layouts and window assignments before topology migration. | unit-01 | `kwin/tests/nary-characterization.test.ts`, `controller-fixture-scenarios.ts` seam | Focused characterization cases, then `npm --prefix kwin test` (static). |
| unit-03 | Generalize logic-layer split planning and equality contracts from pair roles to the approved ordered-child contract. | unit-02 | `kwin/src/logic.ts`, `kwin/tests/logic.test.ts` | N-ary structural cases plus existing logic tests; `npm --prefix kwin run typecheck` (static). |
| unit-04 | Generalize the pinned native adapter and canonical project-model order without claiming an unproven native result cardinality. | unit-01, unit-03 | `kwin/src/boundary.ts`, split adapter/executor seams, controller child-order helpers, related tests | Boundary cardinality and ordered-child tests prove every listed order-sensitive site consumes canonical model order; `npm --prefix kwin test` and typecheck (static). |
| unit-05 | Migrate preset collection, pathing, rebuild, overlay validation, and invariant shape checks to ordered direct children. | unit-04 | Controller preset/overlay functions; pure-config, selected-overlay, keyboard-move tests | Focused preset and overlay tests, binary serialization comparison, complete test suite (static). |
| unit-06 | Implement the approved N-ary resize, minimum-size, and ratio/weight semantics. | unit-01, unit-04 | Controller resize/minimum functions; resize diagnostics tests | 2-child regression and approved 3+-child resize cases; typecheck and complete test suite (static). |
| unit-07 | Generalize drag target selection, split application, and reflow normalization for N-ary direct children. | unit-03, unit-04 | Controller drag/reflow functions; interactive drag, diagnostics, overlay-reflow tests | Same-axis wrapping, order-only 3+-child cases, binary characterization checks, complete suite (static). |
| unit-08 | Generalize keyboard insertion and automatic/dwindle insertion to the approved N-ary construction contract. | unit-03, unit-04 | Controller keyboard and dwindle functions; keyboard-placement, automatic-dwindle, deferred-recovery tests | Parent escape/one-child collapse structural cases, existing binary cases, typecheck and complete suite (static). |
| unit-09 | Close the inventory sweep, add independent synthetic N-ary structural coverage, and run final regression gates. | unit-05, unit-06, unit-07, unit-08 | All 13 identified test files and shared fixture | Inventory-to-test audit; `npm --prefix kwin test`, typecheck, and `bash scripts/dogfood-install.test.sh` (all static). |

## Progress

- [x] unit-01 Decision record and contracts frozen.
- [x] unit-02 Binary characterization.
- [x] unit-03 Closed by analysis: no code change. See "Unit-03 Finding" below.
- [x] unit-04 Native boundary and ordering.
- [x] unit-05 Preset and overlay reconstruction.
- [x] unit-06 Resize and minimum semantics.
- [x] unit-07 Drag and reflow migration.
- [ ] unit-08 Keyboard and automatic insertion migration.
- [ ] unit-09 Inventory closure and final gates.

## Unit-03 Finding

Closed 2026-08-22 by analysis; no code changed in `kwin/src/logic.ts` or
`kwin/tests/logic.test.ts`. `logic.ts` was read in full and contains no real
arity coupling to generalize: every apparently pair-shaped function operates
on a locally-always-exactly-2 relationship (a subdivision of one region into
two, e.g. a split proposal or an equality check between exactly two sibling
candidates) that remains correct under N-ary by construction, because it never
claims to enumerate or order a parent's full child set. The real arity
coupling that N-ary migration must address lives outside `logic.ts`:

- `kwin/src/custom-tile-split.ts:15` - `decodeChildren` hard-decodes exactly
  two children via `decodeSequential(value, isCustomTile, 2)`.
- `kwin/src/controller.ts:1481` (`orderedChildren`) and its three call sites
  (`controller.ts:5891`, `:6096`, `:2720`) - fixed two-child geometry
  ordering.
- `kwin/src/controller.ts:2715`, `:5886`, `:6089`, `:6588` -
  `decodeSequential(..., isCustomTile, 2)` calls that fix child count at 2.
- `kwin/src/boundary.ts:56` (`decodeSequential`) - the shared decode seam
  these sites all consume; it is already arity-parametric (`maxLength`) and
  requires no change itself.

## Unit-04 Native-Binding-Evidence Gate Dissolved

Dissolved 2026-08-22 by design change, not by evidence. unit-04's dependency
on the parked native-binding evidence traced to one architectural choice: the
blueprint split seam decoded `split()`'s native return value directly to
obtain the new children
(`kwin/src/custom-tile-split.ts:15` prior to this change, consumed through
`kwin/src/layout-executor.ts:150` prior to this change). That return shape is
native-unproven and parked
(`docs/changes/nary-split-support/research/native-binding-evidence.md:169-172`).

Fix: `BlueprintSplitSeam.decodeChildren` (`kwin/src/layout-executor.ts:4-9`)
now receives the split TARGET tile, not `split()`'s return value.
`executeBlueprintInstructions` (`kwin/src/layout-executor.ts:149-155`) still
calls `seam.split(target, orientation)` for its mutation side effect but
discards the return value, then calls `seam.decodeChildren(target)`, which
re-decodes the target's own `.tiles` (`kwin/src/custom-tile-split.ts:15-24`).
This matches the precedent already established for `removeCustomTile`
(`kwin/src/boundary.ts:431-433`: "Its caller must re-decode the root
immediately afterwards") and already implemented at the resize postcondition
(`kwin/src/controller.ts:2715`: `decodeSequential(target.split.tiles, ...)`).

Ordering is derived from `relativeGeometry` along the split axis
(`layoutDirection`), not from `tiles[]` index position, because multi-ordinal
array order is unestablished for the native binding
(`native-binding-evidence.md:149-176`: observed only on a one-child root).
`kwin/tests/layout-executor.test.ts` adds a dedicated case that stores two
children in reverse geometric order within `tiles` and asserts
`decodeChildren` still returns them ordered by geometry, proving index is not
trusted.

Behavior for the existing binary case is unchanged: `npm --prefix kwin test`
944 tests / 90 suites / 0 fail (up from 942, two new
`customTileSplitSeam` cases), typecheck clean on both tsconfigs.

Scope note: this dissolution covers only unit-04's own scope (the split
adapter/executor seam). Three other call sites still decode `split()`'s
return value directly rather than re-decoding the parent
(`kwin/src/controller.ts:5885-5886` drag, `:6088-6089` keyboard, `:6588`
preset-path construction) instead of going through this seam. None of them
list "native-binding evidence" as a plan dependency (only unit-04 did); they
belong to unit-07, unit-08, and unit-05 respectively and are unaffected by
this dissolution. Migrating them to the same re-decode pattern is in scope
for those units, not this one.

## Unit-04 Generalization Finding

Completed 2026-08-22, one Worker attempt, no correction round.

- `customTileSplitSeam.decodeChildren` (`kwin/src/custom-tile-split.ts:53-63`)
  now decodes up to `MAX_SEQUENTIAL_LENGTH` from `tile.tiles` instead of a
  hardcoded 2, and rejects only on fewer than 2 decoded children. Ordering is
  delegated to a new exported `orderCustomTilesByAxis`
  (`kwin/src/custom-tile-split.ts:18-46`), which orders any-length input by
  `relativeGeometry[axis]`, rejecting on a degenerate zero-extent child or a
  duplicate axis position. `BlueprintSplitSeam.decodeChildren`
  (`kwin/src/layout-executor.ts:10`) is retyped `readonly Tile[] | null`
  accordingly. `executeBlueprintInstructions`
  (`kwin/src/layout-executor.ts:164-183`) independently requires
  `children.length === 2`, commented as the blueprint executor's own
  binary-tree contract (every compiled `SplitInstruction` has exactly a
  `leftPath` and `rightPath`), not a native-cardinality claim. A dedicated
  test proves a synthetic 3-child seam result fails the executor
  deterministically rather than crashing or being silently truncated
  (`kwin/tests/layout-executor.test.ts:220-238`). No native result cardinality
  is asserted anywhere in this change.
- Convergence verdict on `orderedChildren` vs. the split seam: deleted
  `orderedChildren` (was `kwin/src/controller.ts:1481-1502`) and its
  `absoluteGeometry`-based sort entirely; its 5 call sites
  (`kwin/src/controller.ts` resize postcondition, resize-target resolution,
  drag split, keyboard split, dwindle insertion) now call
  `orderCustomTilesByAxis` directly, matching the spec's settled decision that
  "the geometry sort in `orderedChildren` is deleted rather than generalized"
  (`spec.md:104-108`). The zero-extent guard in the deleted `orderedChildren`
  (`width <= 0 || height <= 0`) was a real, load-bearing check, not dead
  defensiveness: it is what turns a KWin below-minimum-tile-size split
  (documented at the dwindle call site, `kwin/src/controller.ts:7043-7048`,
  and exercised by `installCapacityRejectingSplitter` in
  `kwin/tests/controller-fixture-scenarios.ts:672-693`) into a clean capacity
  rejection instead of an incorrectly-ordered pair. It is now ported into
  `orderCustomTilesByAxis` and covered directly at the adapter level
  (`kwin/tests/layout-executor.test.ts:266-274`), not only indirectly through
  controller integration tests. `absoluteGeometry` (deleted) vs.
  `relativeGeometry` (kept, matching the pre-existing adapter) differ only by
  a per-parent translation/scale common to all siblings, so axis order and the
  zero-extent test are unaffected; full-suite evidence below confirms no
  behavior change.
- The 5 call sites' own `decodeSequential(..., isCustomTile, 2)` decode calls
  are untouched and remain hardcoded to 2, matching the plan's assignment of
  their own N-ary generalization to unit-06 (resize), unit-07 (drag), and
  unit-08 (keyboard/dwindle). Only the ordering step they call was converged.
- Verification: `npm --prefix kwin test` 947 tests / 90 suites / 0 fail (up
  from the 944 baseline, 3 new focused cases: N=3 adapter decode/order, adapter
  zero-extent rejection, executor N=3 deterministic-failure); `npm --prefix
  kwin run typecheck` clean on both tsconfigs; `bash
  scripts/dogfood-install.test.sh` 347 assertions / 0 fail, unchanged from
  baseline. `kwin/contents/code/main.js` rebuilt via `npm --prefix kwin run
  build` and confirmed to match source.

## Unit-05 Finding

Completed 2026-08-22, one Worker attempt, no correction round on scope (one
mechanical existing-test correction made in-line by the Worker; see below).

- `collectPresetLeaves` (`kwin/src/controller.ts:1377-1408`, module-level) and
  `presetTileAtPath` (`kwin/src/controller.ts:6518-6555`, private method of
  `TileController`) both selected the "left"/"right" child by raw
  `decodeSequential` array index rather than by geometry. Both now derive the
  split axis from `layoutDirection` and call `orderCustomTilesByAxis`
  (`custom-tile-split.ts:24`), matching the pattern already established for
  the 5 sites converged in unit-04. `collectPresetLeaves` backs
  `selectedOverlayValid`'s leaf re-read; `presetTileAtPath` backs
  `rebuildPreset`'s split-target and leaf-path resolution. Both were reading
  back trees whose leaves were originally geometry-ordered at build time (via
  `customTileSplitSeam.decodeChildren`, already order-correct since unit-04),
  so a raw-index re-read could silently disagree with how the tree was built.
- `presetNodeMatches` (`controller.ts:1537`) was deliberately left untouched:
  it already tries both decoded-child permutations against
  `node.left`/`node.right`, so it is already order-tolerant without needing
  `orderCustomTilesByAxis`; its own comment says as much ("accepted in either
  decoded order"). Its hardcoded arity-2 decode matches the `Blueprint`
  type's own binary schema (`layout-blueprint.ts`), the same
  contract-not-native-claim pattern as the blueprint executor's own arity-2
  requirement (unit-04 finding). `rebuildPreset`'s own
  `decodeSequential(split, isCustomTile, 2)` post-split validation
  (`controller.ts:6573` pre-change) was also left untouched: it only checks
  split() produced 2 children before discarding the result, uninvolved in
  ordering.
- **Of the 5 `orderCustomTilesByAxis` call sites unit-04 left in
  `controller.ts`, none fall in unit-05's scope.** Verified by reading each
  site's containing function: `controller.ts:2697` (resize postcondition,
  inside `resizeActiveWindow`) and `:2748` (`resolveResizeSplit`) are
  unit-06's resize territory; `:5876` (`splitDropTarget`) is unit-07's drag
  territory; `:6081` (keyboard split) and `:7026` (dwindle insertion) are
  unit-08's keyboard/automatic-insertion territory. unit-05's actual coupling
  bug was a different, unconverged pattern entirely (raw array index with no
  `orderCustomTilesByAxis` call at all, in `collectPresetLeaves` and
  `presetTileAtPath`), not a leftover use of the already-converged helper.
  This tracks as fully resolved for unit-05; units 06-08 still own their
  respective sites unchanged.
- Test correction disclosed by the Worker and independently verified by the
  Lead: the pre-existing case in
  `kwin/tests/controller-selected-overlay-state.test.ts` ("discards when the
  overlay root leaves, its topology drifts, or leaf order changes") asserted
  that swapping only raw `tiles[]` array order (geometry unchanged)
  invalidated the overlay - i.e. it encoded the exact bug being fixed as
  expected behavior. The Worker changed that one sub-case to swap
  `relativeGeometry` between the two children instead (a genuine reorder),
  preserving the test's original intent (detect real leaf reordering)
  without weakening coverage; the Lead confirmed by diff that no assertion
  was deleted or loosened, only its trigger mechanism corrected to match the
  now-authoritative ordering rule. Two new tests were added (not a
  substitution for count purposes): `controller-pure-config-functions.test.ts`
  ("resolves preset split targets and leaves by geometry order, not by raw
  tiles[] array index") and `controller-selected-overlay-state.test.ts`
  ("stays valid when a branch reports its children reversed in tiles[]
  relative to geometry"), both using a new `installReversedOrderSplitter`
  fixture (`controller-fixture-scenarios.ts`) that stores children reversed
  in `tiles[]` while geometry stays correct. Both were confirmed by the
  Worker (via `git stash` of only `controller.ts`) to fail against the
  pre-fix code and pass against the fix.
- Verification: `npm --prefix kwin test` 949 tests / 90 suites / 0 fail (up
  from the 947 baseline, 2 new cases); `npm --prefix kwin run typecheck`
  clean on both tsconfigs; `bash scripts/dogfood-install.test.sh` 347
  assertions / 0 fail, unchanged from baseline. All four numbers independently
  reproduced by the Lead, not just the Worker's report.
  `kwin/contents/code/main.js` rebuilt via `npm --prefix kwin run build` by
  the Lead after acceptance; a second rebuild produced no further diff,
  confirming the tracked bundle matches source.

## Unit-06 Finding

Completed 2026-08-22, one Worker attempt, no correction round.

- Implements the settled divider-based resize contract (`spec.md:88-90`):
  "the direction selects the divider; only the focused child and the sibling
  across that divider change weight. This degenerates to the current binary
  behavior at two children by construction." `resolveResizeSplit`
  (`controller.ts:2748-2799`) now decodes up to `MAX_SEQUENTIAL_LENGTH`
  children (was hardcoded to 2) and locates the focused child's index in the
  geometry-ordered array; the divider neighbor is `focusedIndex + dirSign`
  (outwards) or `focusedIndex - dirSign` (inwards), only returning when that
  index is in range, else the existing climb-to-ancestor loop continues
  unchanged. This is a proven generalization of the prior `first`/`second`
  identity check, not a new design: at exactly two children `dirSign`-based
  neighbor selection reduces to the same side/pressedTowardNeighbor result the
  removed code computed, by construction.
- `resizeActiveWindow` (`controller.ts:2597-2735`) fixes a real N-ary bug that
  would otherwise have shipped silently: `neighborProposed` was
  `parentExtent - focusedProposed`, which is only correct at exactly two
  children. With 3+ children this would have absorbed space from non-adjacent
  siblings the spec requires to stay untouched. It is now
  `(focusedExtent + neighborExtent) - focusedProposed`, degenerating to the
  old formula when the pair fills the whole parent (the two-child case).
  `positionShift` and the postcondition structural-identity check are
  generalized the same way, from `target.first`/`target.second` equality to
  `target.ordered`/`target.focusedIndex`/`target.neighborIndex`, preserving
  every existing diagnostic and rejecting exactly as before when the
  postcondition's ordered child list drifts from the pre-write snapshot.
- `resizeWouldViolateMinimum` (`controller.ts:2803-2826`) is unchanged: it
  already takes two proposed extents generically and has no child-count
  coupling.
- fc69698 characterization preserved, each behavior still pinned by its
  existing (untouched) test: climb-to-nearest-matching-ancestor
  ("climbs to an outer split when the focused leaf has no sibling in the
  pressed direction", `controller-drag-diagnostics-and-resize.test.ts:995`);
  exactly 5% of the ancestor's extent ("outwards crosses a right boundary by
  resizing the containing outer child by 5% of the outer split" and its
  inwards counterpart, `:1051` and `:1065`); no controller-side clamping (the
  15%-floor case rejects outright rather than clamping, `:894`); outermost
  case emits `resize-rejected:no-parent` with zero writes (`:1079`, `:1091`).
  None of these four tests were modified; all still pass unmodified.
- Two new focused tests added
  (`controller-drag-diagnostics-and-resize.test.ts:1099-1181`) using a
  synthetic 3-child single-level row (not nested), the topology absent from
  existing coverage: "only adjusts the focused child and its divider neighbor
  in a 3-child row, leaving the third child untouched" proves the
  `pairExtent` fix by asserting the non-adjacent third child's
  `relativeGeometry` is byte-identical before and after; "rejects at the outer
  edge of a 3-child row with no further neighbor or ancestor" proves the
  climb/rejection behavior generalizes past two children.
- Of unit-06's two assigned `orderCustomTilesByAxis` call sites
  (`controller.ts:2697`/`:2748` pre-change, now `:2714`/`:2772` post-change,
  inside the resize postcondition and `resolveResizeSplit`), both are
  migrated to the ordered-child model. The other three sites unit-04 left
  (`controller.ts:5904` drag, `:6109` keyboard, `:7062` dwindle) are untouched
  and remain unit-07's and unit-08's, per the unit-05 finding's inventory.
- No narrow trigger-correction exception was invoked: no existing test's
  expectation was touched.
- Verification (Lead-independent, not just Worker-reported): `npm --prefix
  kwin test` 951 tests / 90 suites / 0 fail (up from 949, 2 new cases); `npm
  --prefix kwin run typecheck` clean on both tsconfigs; `bash
  scripts/dogfood-install.test.sh` 347 assertions / 0 fail, unchanged from
  baseline. `kwin/contents/code/main.js` rebuilt by the Lead after acceptance;
  a second rebuild produced a byte-identical file, confirming determinism and
  that the tracked bundle matches source.

## Unit-07 Finding

Completed 2026-08-22, one Worker attempt, one narrow trigger-correction round
(see below; not a design-scope correction).

- `splitDropTarget` (`controller.ts:5888-5946`) now branches on whether
  `target.decoded.tile.parent` is a layout tile whose `layoutDirection`
  matches the requested direction's axis (same-axis) or not (cross-axis),
  mirroring the parent-check style already established in
  `normalizeReflowLeaves` (`controller.ts:7376-7390`).
  - **Cross-axis** (including no parent, non-layout parent, or a different
    axis): behavior is unchanged and byte-identical for every existing
    binary-only fixture. The only change is internal: `splitCustomTile`'s
    return value is discarded and `target.decoded.tile.tiles` is re-decoded
    afterward instead, matching the re-decode-after-mutation pattern already
    established for `customTileSplitSeam.decodeChildren`
    (`custom-tile-split.ts:62-69`) and the resize postcondition
    (`controller.ts:2714`). The existing `decodeSequential(..., 2)` arity
    requirement is unchanged: it is the drop-split feature's own structural
    contract (one occupied leaf becomes occupant-vs-dragged), the same
    contract-not-native-claim status as the blueprint executor's arity-2
    requirement (unit-04 finding), not a native cardinality claim.
  - **Same-axis** (new `splitDropTargetSameAxis`, `controller.ts:5926-5966`):
    established fact `native-binding-evidence.md:26` is that same-axis
    `split()` takes the add-cell branch and inserts exactly one new direct
    sibling into the PARENT (`row() + 1`), not a two-child wrap under the
    target. Because multi-ordinal native array order is unproven
    (`custom-tile-split.ts:18-23`) and the C++ insertion index is not
    guaranteed to survive marshalling or match project-model order, the new
    sibling is identified by geometry-order **set difference**: the parent's
    ordered children are decoded via `orderCustomTilesByAxis` both before and
    after the native `split()` call, and the sole tile present after but not
    before is the new sibling. No direction-to-side (left-inserts-before /
    right-inserts-after) mapping is used or assumed anywhere - the evidence
    does not support one, and inventing one was explicitly avoided. The
    dragged window is managed onto the new sibling; the occupant is never
    re-managed since it never left the (unchanged) target tile.
  - **No sizing or reweighting logic was added** for the same-axis case. This
    is a deliberate scope boundary, not an oversight: `docs/cosmic-move-
    conformance.md:105-106` explicitly lists "which sibling absorbs a user
    drag in a 3+ split" as **not observed** in the COSMIC conformance corpus
    that is the sole evidentiary source for the spec's move-insertion sizing
    decision (`spec.md:91-97`), and implementing COSMIC directional-move
    runtime behavior is an explicit Non-Goal of this change (`spec.md:38-39`).
    Applying that sizing formula to the pre-existing mouse-drag feature here
    would have been invented, unevidenced behavior change to a live user-
    facing feature, not a structural migration. Whatever `relativeGeometry`
    native's own `split()` produced for the new sibling and the other
    existing siblings stands untouched; `normalizeReflowLeaves` /
    `planEqualSplit` (`logic.ts:305-341`) already safely refuse to equalize
    (return `null`) unless exactly two children fill the whole parent along
    the axis, so they correctly no-op for any 3+-child same-axis result
    without any code change - confirmed by a new direct test, not modified.
- Narrow trigger-correction round (single round, not a second Worker attempt):
  two pre-existing tests (`controller-interactive-drag.test.ts:335-343`
  `failedManage` case; `controller-production-diagnostics.test.ts:331-341`
  `completed` case) mocked `target.split = () => [first, second]` without
  ever writing `target.tiles`, an authoring oversight (every other split
  fixture in the suite sets `.tiles`) that happened to encode the exact
  anti-pattern being fixed (trusting `split()`'s return value). Lead-verified
  by direct diff read, not the Worker's report: the fix is exactly one added
  line per test (`target.tiles = [first, second];`), every existing assertion
  in both tests is byte-for-byte unchanged, and the corrected behavior is
  independently pinned by a new test in the same unit ("reads the live
  post-split tiles rather than trusting split()'s return value (cross-axis
  anti-pattern regression)", `controller-interactive-drag.test.ts:200-231`),
  satisfying the narrow-exception proviso (precedent: `git show aed0e32 --
  kwin/tests/controller-selected-overlay-state.test.ts`).
- Three new tests added, Lead-verified by direct diff read:
  `controller-interactive-drag.test.ts` gains the cross-axis anti-pattern
  regression case above and "same-axis wraps: adds a new direct sibling to a
  3-child row parent instead of wrapping the target, identified by geometry-
  order set difference over a scrambled raw tiles[] array" (new
  `sameAxisRowDropSetup` fixture, `controller-fixture-scenarios.ts:723-793`,
  modeled on `installReversedOrderSplitter`; covers same-axis wrapping and
  order-only 3+-child lookup in one fixture, and asserts pre-existing
  siblings' geometry and windows are untouched);
  `controller-interactive-drag-reflow.test.ts` gains the `planEqualSplit`
  reflow no-op proof described above.
- Of unit-07's one assigned `orderCustomTilesByAxis` call site
  (`controller.ts:5904` pre-change, now `:5911` cross-axis plus two new uses
  at `:5947`/`:5954` same-axis before/after, post-change), it is migrated.
  The other two sites unit-04 left (keyboard, now `controller.ts:6160`;
  dwindle, now `:7113`; line numbers shifted only by this unit's insertion)
  are confirmed untouched by a zero-diff check on their surrounding hunks -
  they remain unit-08's.
- `resizeActiveWindow`/`resolveResizeSplit`, `normalizeReflowLeaves`/
  `planEqualSplit`, and `flashFocusedGroup` were read for context but not
  modified, per this unit's constraints.
- Verification (Lead-independent, not just Worker-reported): `npm --prefix
  kwin test` 954 tests / 90 suites / 0 fail (up from 951, 3 new cases); `npm
  --prefix kwin run typecheck` clean on both tsconfigs; `bash
  scripts/dogfood-install.test.sh` 347 assertions / 0 fail, unchanged from
  baseline. `kwin/contents/code/main.js` rebuilt by the Lead after
  acceptance; a second rebuild produced a byte-identical diff, confirming
  determinism and that the tracked bundle matches source.

## Attempt Accounting

No implementation units have started. Counts will be recorded by stable unit ID
once any count exceeds 1. A third attempt, a second correction round, a second
independent review, or a repeated failure class with no acceptance progress
trips the circuit breaker and requires escalation with a loop report.

| Unit | Attempts | Corrections | Independent reviews |
| --- | --- | --- | --- |
| native-evidence-phase-2 | 2 | 0 | 0 |
| unit-03b (E4 read-only host probe) | 3 (final) | 0 | 0 |

- `unit-03b/attempt-01` and `attempt-02` stopped in bespoke harness setup
  before a D-Bus load call. The user-approved reset removed that harness.
- `unit-03b/attempt-03` loaded signed ID `1` directly on the host, ran the
  read-only probe, found its sentinel, unloaded successfully, and left the host
  `kwinrc` SHA-256 and mtime unchanged. It establishes only the scoped
  read-only E4 facts in `research/native-binding-evidence.md`; `split()` was
  intentionally not called and remains unproven.

## Pending User Decisions

None.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
| --- | --- |
| Seven settled decisions and frozen contracts | unit-01 approved record in `spec.md#user-decisions`, promoted replay vectors in `research/cosmic-insertion-findings.md`, and static citation inspection. |
| Ordered direct children and deterministic malformed-list handling | unit-03 and unit-04 focused structural tests. unit-04 additionally proves the blueprint executor fails deterministically, not silently, on a non-2 seam decode ("Unit-04 Generalization Finding"). |
| Same-axis wrapping, parent escape, collapse, and geometry independence | Independent synthetic N-ary structural tests in units 07 through 09. |
| Inventory coupling removed or made N-ary-safe | unit-09 audit against `research/binary-coupling.md`. |
| 13 test files and shared fixture covered | unit-09 test-surface audit. |
| Binary-only layouts remain byte-identical | unit-02 fixtures compare existing native serialization and window assignments, then rerun in units 03 through 09. |
| Complete test, typecheck, and dogfood gates | unit-09 command results. |
| unit-02 binary "before" characterization baseline | `serializeTileTree` helper in `kwin/tests/controller-fixture-scenarios.ts`; two pinned-golden tests driving the real controller through a dwindle chain and a preset-shortcut insertion in `kwin/tests/nary-characterization.test.ts`; `npm --prefix kwin test`: 942 tests, 90 suites, 0 fail (up from the 940/89/0 baseline); typecheck clean on both tsconfigs. |

## Residual Risks

- Native result cardinality and whether a native 3+-child container survives
  restart or manual native edits remain unestablished. The separately scoped
  evidence unit gates unit-04; its outcome may redesign the adapter only.
- The project model's semantic authority is session-scoped until that evidence
  resolves restart and manual-native-edit behavior.
- The nested native-binding evidence path remains blocked and frozen: attempt-02
  observed a host `kwinrc` SHA-256 change and its strict loader parser rejected
  an `i 0` reply before the probe ran. The direct read-only host reset produced
  only scoped `tiles` marshalling facts, not native result cardinality.
- `unit-03b/attempt-03` is final. The adapter must not require a JavaScript
  array or two children; it may use defensive indexed/iterable enumeration for
  the observed host binding. `split()` return shape remains unproven and parked.
- The controller is 9,191 lines and the inventory spans 24 functions and 13
  test files; narrow units reduce but do not eliminate regression risk.

## Final Outcome

- `unit-03b/attempt-03` completed as the final E4 read-only host probe. Its
  scoped facts are recorded in `research/native-binding-evidence.md`; no
  `split()` fact was sought or obtained.
