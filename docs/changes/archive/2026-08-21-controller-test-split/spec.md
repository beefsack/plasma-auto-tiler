# Specification: Split `kwin/tests/controller.test.ts`

Ownership and approval:
- Owner: Lead
- Status: Approved (autonomous mode, delegated specification approval)

## Intent and Desired Outcome

`kwin/tests/controller.test.ts` is 17,075 lines, the largest source file in
the repository by a wide margin (`kwin/src/controller.ts` is 9,191 lines and
is explicitly out of scope here). The user's stated threshold is that source
files over ~1,000 lines are untenable. This change splits the test file into
multiple topic-scoped files under `kwin/tests/`, each covering one or a few
adjacent top-level `describe` blocks, plus one shared, non-test fixture module
for the helpers, fixtures, and constants every split file needs. No test
behavior, name, or ordering changes; no production code changes.

This was sequenced first (ahead of `controller.ts`) because it is mechanical
and self-verifying: the pre-change test/suite counts (838 tests, 78 suites,
confirmed by a baseline `npm test` run at HEAD `ecbf5ef`) establish the
original controller-suite baseline. The current execution gate is 924 tests
and 81 suites after the separately scoped move-conformance tests were added;
it remains a hard, cheap, unambiguous acceptance gate. Every `describe` in
this codebase is flat (no nested
`describe`s anywhere in `kwin/tests/`; total `describe(` occurrences across
all test files equals the reported suite count exactly), so file boundaries
can align exactly with `describe` boundaries with no internal restructuring.

## Scope and Non-Goals

In scope:

- Splitting `kwin/tests/controller.test.ts` into multiple `*.test.ts` files
  under `kwin/tests/`, one shared fixture module (`controller-fixtures.ts`),
  and deleting the original file.
- Adding the minimal import scaffolding (fixture imports, pruned `src/`
  imports) each new file needs to compile and run unchanged.

Non-goals:

- Splitting or otherwise touching `kwin/src/controller.ts` (separate, higher-
  risk change, tracked separately in `docs/backlog.md`).
- Any change to test names, test bodies, assertions, `describe`/`it` nesting,
  or execution order within a `describe`.
- Any change to production code, `package.json` scripts, or `tsconfig*.json`
  (verified unnecessary; see Test Runner Wiring below).
- Any behavioral, coverage, or performance change.

## Applicable Principles and Decisions

- No project `docs/decisions.md` clause governs test file layout; this is a
  maintainability change with no product or governance dimension.

## Constraints

- `kwin/contents/code/main.js` (the esbuild bundle of `src/entry.ts`) must be
  byte-identical before and after, since the `build` script only reads from
  `src/`, never `tests/`.
- Every file the Lead reads or edits must use bounded line ranges (`grep -n`
  to locate, `Read`/`sed` with explicit start/end) - no whole-file read of
  `controller.test.ts` (17,075 lines) or `controller.ts` (9,191 lines) is
  possible within one agent's context budget.
- `tsconfig.test.json`'s `noUnusedLocals`/`noUnusedParameters: true` means
  each new file's import list must be pruned to symbols it actually
  references; a blanket copy of the original 43-line import block into every
  file will fail typecheck.

## Test Runner Wiring (investigation finding, not a change)

- `npm test` (`kwin/package.json:9`) runs
  `esbuild "tests/*.test.ts" --bundle ... --outdir=dist/tests && node --test "dist/tests/**/*.test.js"`.
  Both the esbuild input and the `node --test` glob match any file directly
  under `kwin/tests/` ending in `.test.ts` - new split files are picked up
  automatically, no script or config change needed.
- The shared fixture module must be named without a `.test.ts` suffix (e.g.
  `controller-fixtures.ts`) so esbuild does not treat it as its own entry
  point; it is pulled in only via `import` from the files that use it, one
  independent bundled copy per test file (see Shared State below - this is
  safe because there is no module-level mutable state to duplicate).
- `tsconfig.test.json` (`kwin/tsconfig.test.json:6`) includes the whole
  `tests` directory, not named files - no config change needed for typecheck
  either.
- Baseline confirmed live at HEAD `ecbf5ef`: `npm test` inside `kwin/`
  reports `tests 838`, `suites 78`, `pass 838`, `fail 0`. `grep -c "describe("`
  across all `kwin/tests/*.test.ts` files also totals 78, confirming every
  `describe` is top-level (no nesting anywhere in the test suite).

## Shared State (investigation finding, corrected)

**Correction history:** the original version of this section analyzed only
lines 1-1015 and asserted this was the complete set of module-scope shared
state. That was false: 21 more top-level (column-zero) declarations exist
between lines 4112 and 8169, reachable from early `describe`s today only via
JS/TS function-declaration hoisting across the whole module - a mechanism
that disappears once the file is split. This was discovered live during
unit-01/attempt-01 (`TS2304: Cannot find name 'attachTileWriter'`), recorded
as a blocking Pending User Decision in `plan.md`, and the Orchestrator
authorized a full re-analysis. This section reflects that full analysis
(every top-level declaration in the file, not just the preamble) and
supersedes the original.

### Enumeration method

Every top-level (column-zero) `function`/`const`/`let`/`var`/`class`/
`interface`/`type`/`enum` declaration in the file was enumerated with an
anchored `grep -n`, independent of `describe` adjacency (declarations are not
assumed contiguous or pre-first-use). Total: **52** - the 31 already
documented in the preamble (lines 1-1015: imports 1-43, 3 constants `RECT`/
`OUTPUT`/`DESKTOP`, 5 interfaces `TestWindow`/`TestSignal`/`TestTile`/
`RegisteredShortcut`/`YieldEntry`, 7 functions `tile`/`window`/
`setFullscreen`/`setSticky`/`setMaximized`/`signal`/`qv4MethodSignal`, class
`Harness`, and 15 more helpers `setup`/`ownTrailingEmpty`/
`prepareExcessOwnedEmpty`/`modeCleanupSetup`/`ownCleanupDesktops`/
`configureSwitchCleanupScenario`/`focusSetup`/`moveSetup`/`swapSetup`/
`presetSetup`/`configureThreeOccupantPreset`/`attachSetup`/`fillSetup`/
`currentScopeFor`/`invokeShortcut`), plus **21 more** declared later in the
file, in three physical clusters, each sitting in the gap between two
`describe` blocks (not inside either): a lone helper at line 4112
(`attachTileWriter`, between "selected overlay state" and "selected overlay
reflow"), a 9-function cluster at lines 4520-4813 (between "selected overlay
reflow" and "interactive drag"), a 3-function cluster at lines 6359-6479
(inside the "drag diagnostics and resize" describe group's own span, between
two of its five describes), and an 8-function cluster at lines 8002-8169
(between "focus-writer seam" and "parseTilingAlgorithm").

`globalUniqueSetup` (`:15738`), `twoOutputSetup` (`:14928`), and
`moveToTrailing` (`:14968`) remain confirmed declared **inside** their
`describe` block (indented, not column-zero) - correctly excluded from this
enumeration, travel with that block unchanged. `ownedDesktopIdSnapshot` named
in an earlier dispatch brief still does not exist as a declared symbol
anywhere in the file.

### Mutable state re-check (whole file, not just the preamble)

**No module-level mutable state exists anywhere in the file.** `grep -n
"^let \|^var "` over all 17,075 lines returns zero matches (re-run against
the whole file, not just lines 1-1015 as the original check scoped it). The
two whole-file matches for `static ` are both inside comments (`:5162`,
`:6358`), not declarations. Every helper's state is per-call or
per-`Harness`-instance; extraction to a separate module bundled once per
split file remains behaviorally identical to today.

### The 31 preamble declarations - verdict unchanged

Usage breadth (mapping every reference to the top-level `describe`/target
file it falls inside), re-verified at whole-file scope:

| Helper(s) | Target files touched | Verdict |
|---|---|---|
| `window`, `tile`, `RECT` | 19-20 of the 20 target files (near-universal) | must be shared |
| `Harness`, `invokeShortcut`, `TestTile`, `TestWindow`, `setup`, `OUTPUT` | 8-18 target files each | must be shared |
| `presetSetup`, `configureThreeOccupantPreset`, `currentScopeFor`, `setFullscreen`, `DESKTOP` | 5-8 target files each | must be shared |
| `setSticky`, `setMaximized`, `TestSignal`, `signal`, `qv4MethodSignal`, `moveSetup`, `swapSetup`, `ownTrailingEmpty` | 2-3 target files each | must be shared |
| `focusSetup`, `attachSetup`, `fillSetup`, `modeCleanupSetup`, `ownCleanupDesktops`, `configureSwitchCleanupScenario`, `prepareExcessOwnedEmpty`, `RegisteredShortcut`, `YieldEntry` | 0-1 target files each | technically single-consumer, kept shared anyway (see rationale below) |

Decision unchanged from the original: extract the **entire** preamble (all
31, including single-consumer ones) into `controller-fixtures.ts` rather than
hand-placing each next to its sole consumer, for the same risk-reduction
rationale as before. This part of the analysis is unaffected by the
correction below.

### The 21 non-preamble declarations - full corrected classification

Classification required two passes, not one: (1) bucket every reference of
each name by which target file's line range it falls in, and (2) because
several of these declarations call each other (the physical clusters are
themselves interdependent, e.g. `installDwindleSplitter` calls `makeTile`),
check whether a function classified "single-file-local" by pass 1 is actually
called from inside the body of a function that pass 1 already classified
"must be shared" - if so it must be promoted to shared too, since the shared
module is bundled independently and cannot import back from a single test
file. One promotion was found this way (`makeTile`, see below).

| Declaration | Line | Classification | Target files spanned |
|---|---|---|---|
| `attachTileWriter` | 4112 | cross-boundary -> fixtures | 10 (+ 2 preamble-region call sites, itself called by a preamble helper) |
| `countEvent` | 4740 | cross-boundary -> fixtures | 20 (universal) |
| `installDwindleSplitter` | 8002 | cross-boundary -> fixtures | 7 |
| `dragSetup` | 4520 | cross-boundary -> fixtures | 4 |
| `startDrag` | 4729 | cross-boundary -> fixtures | 4 |
| `movedGeometry` | 4736 | cross-boundary -> fixtures | 3 |
| `installCapacityRejectingSplitter` | 8028 | cross-boundary -> fixtures | 3 |
| `nativeDropSetup` | 4551 | cross-boundary -> fixtures | 2 |
| `collectLeaves` | 4698 | cross-boundary -> fixtures | 2 |
| `reconstructDropSetup` | 4748 | cross-boundary -> fixtures | 2 |
| `installStaleReturnSplitter` | 8098 | cross-boundary -> fixtures | 2 |
| `assertDwindleShape` | 8129 | cross-boundary -> fixtures | 2 |
| `assertPresetShape` | 8149 | cross-boundary -> fixtures | 2 |
| `makeTile` | 8089 | cross-boundary -> fixtures (**promoted**: 0 direct describe call sites, but called from inside the bodies of `installDwindleSplitter`, `installCapacityRejectingSplitter`, and `installStaleReturnSplitter` - all three already fixtures-bound, so `makeTile` must move with them) | 0 direct / 3 transitive |
| `rowsDropSetup` | 4626 | single-file-local -> `controller-interactive-drag.test.ts` (file 6); declared in the cluster before file 6's describe, must be physically relocated into file 6, not left with its physical neighbors | 1 |
| `assertLeafPartition` | 4709 | single-file-local -> `controller-interactive-drag.test.ts` (file 6); same relocation as `rowsDropSetup` | 1 |
| `normalizeSetup` | 6359 | single-file-local -> `controller-drag-diagnostics-and-resize.test.ts` (file 7); already physically inside file 7's own contiguous span, no relocation needed | 1 |
| `runNormalizeDrag` | 6447 | single-file-local -> file 7; no relocation needed | 1 |
| `resizeSetup` | 6463 | single-file-local -> file 7; no relocation needed | 1 |
| `takeoverTilingSetup` | 8169 | single-file-local -> `controller-pure-config-functions.test.ts` (file 10); declared in the cluster before file 10's describes, must be physically relocated into file 10 | 1 |
| `installInlineMutatingRejectingSplitter` | 8061 | single-file-local -> `controller-automatic-dwindle-insertion.test.ts` (file 12); declared in the cluster before file 12's describes, must be physically relocated into file 12 | 1 |

14 of the 21 are cross-boundary and must be added to `controller-fixtures.ts`
(bringing its total export count to 31 + 14 = 45). 7 are single-file-local;
4 of those 7 (`rowsDropSetup`, `assertLeafPartition`, `takeoverTilingSetup`,
`installInlineMutatingRejectingSplitter`) are physically declared in a
different location than the file they logically belong to and must be
extracted by name (individual `sed` range per function, not a single
contiguous block) into that target file rather than assumed to travel
automatically with a contiguous line-range extraction.

Cross-check performed: every single-file-local declaration's call graph was
checked for calls *into* it from a fixtures-bound declaration (which would
force promotion) - none found beyond the `makeTile` case above. Every
fixtures-bound declaration's call graph was checked for calls into any
preamble-only helper - none found (the preamble is uniformly shared already,
so this direction cannot break). No declaration outside these 52 (i.e. no
describe-local helper) calls or is called by any of the 21.

### Retained-source pruning

After a target file receives a describe or named single-file-local helper, its
retained source copy is removed when search proves it has no remaining
`controller.test.ts` consumer. This applies equally to imports, preamble
declarations, and fixtures-bound declarations physically located in later
clusters; the fixture export remains for split-file consumers. A typecheck
TS6133 corroborates, but never alone authorizes, the removal. Instructions to
exclude a cluster from a target file govern target-file relocation only and do
not preserve an orphaned source copy. No such pruning may alter a test body,
assertion, test name, describe name, or test ordering.

## Imports (investigation finding)

The preamble imports from four sibling `src/` modules via flat relative
paths: `../src/boundary`, `../src/controller`, `../src/layout-blueprint`,
`../src/logic`, `../src/preset-catalog` (`kwin/tests/controller.test.ts:1-43`).
No deep or nested import paths exist. `controller-fixtures.ts` re-exports (or
directly imports, per the pruning approach below) only what it itself needs;
each split `*.test.ts` file separately imports, from `../src/*`, only the
additional `src/` symbols its own `describe` body references directly (e.g.
`ensureTrailingEmptyDesktop`, `type TrailingEmptyDomainRequest`) that are not
already re-exported by the fixture module. This is a multiplication of import
statements (one line each, across ~20 files) but not of import paths or
semantics, and does not matter functionally.

## Precedent

`kwin/tests/` already has 10 other test files (`artifact-smoke.test.ts` 220
lines, `boundary.test.ts` 422, `bundle-output.test.ts` 70,
`layout-blueprint.test.ts` 261, `layout-executor.test.ts` 261,
`layout-instructions.test.ts` 107, `logic.test.ts` 1,067,
`preset-catalog.test.ts` 432, `toolchain.test.ts` 8, `topology-reset.test.ts`
96). Each covers one topic with several top-level `describe`s (e.g.
`logic.test.ts` has 13, `boundary.test.ts` has 5), named
`<topic-in-kebab-case>.test.ts`, and none has a shared-fixture sibling module
today (each is self-contained, low enough helper duplication to not need
one). The proposed `controller-*.test.ts` naming and one shared
`controller-fixtures.ts` module follow the same kebab-case convention scoped
under the `controller-` prefix so the family is visually grouped.

## Target File Set

One shared module, `kwin/tests/controller-fixtures.ts`, corrected estimate
**~1,340 lines**: the 1-1015 preamble (~972 lines excluding its `import`
block) plus the 14 non-preamble cross-boundary declarations from the Shared
State section above (~365 lines: `attachTileWriter` ~24 lines at its original
location, the 7-of-9 cross-boundary members of the 4520-4813 cluster ~202
lines, the 6-of-8 cross-boundary members of the 8002-8169 cluster ~139
lines). This itself now exceeds the file's own ~1,000-line target; disclosed
as accepted below (a shared fixture module is not a test suite and splitting
it further would mean re-deriving sub-groupings of mutually-dependent
helpers, which is unwarranted extra risk for a mechanical change).

The describe-to-file grouping below is unchanged by the correction (every
`describe` still lands in the same file); what changes is which physical
lines around the `describe`s move where. Four target files require
non-contiguous, named extraction rather than one simple line-range `sed` -
see the callouts in the table and in `plan.md`'s Work Units:

- File 6 (`controller-interactive-drag.test.ts`): also receives
  `rowsDropSetup` and `assertLeafPartition`, physically declared earlier (in
  the 4520-4813 cluster, itself otherwise fixtures-bound), extracted by name.
- File 7 (`controller-drag-diagnostics-and-resize.test.ts`): must be
  extracted as one contiguous range (5970-6950), not five separate
  per-`describe` extracts, so it naturally keeps `normalizeSetup`,
  `runNormalizeDrag`, and `resizeSetup`, which sit in gaps between its own
  internal `describe`s and are used only within this file.
- File 10 (`controller-pure-config-functions.test.ts`): also receives
  `takeoverTilingSetup`, physically declared earlier (in the 8002-8169
  cluster, otherwise fixtures-bound), extracted by name.
- File 12 (`controller-automatic-dwindle-insertion.test.ts`): also receives
  `installInlineMutatingRejectingSplitter`, physically declared earlier (same
  cluster), extracted by name.
- File 5 (`controller-selected-overlay-reflow.test.ts`) is the converse case:
  although the 4520-4813 cluster sits numerically inside its naive line span,
  none of that cluster is used by file 5's own `describe` body (confirmed:
  `collectLeaves`'s one same-region reference is internal self-recursion, not
  a call from the describe) - file 5 must extract only its `describe` body
  (ending before line 4520), not the cluster.

Twenty target test files, each a contiguous, order-preserving slice of the
original 40 top-level `describe`s (never split within a `describe`, never
reordered relative to each other):

| # | File | Describe(s) (original order) | Lines |
|---|---|---|---|
| 1 | `controller-keyboard-placement.test.ts` | keyboard insertion; ordinary placement and boundaries; keyboard focus | 843 |
| 2 | `controller-keyboard-move-and-swap.test.ts` | keyboard move; occupied-target move swap; tile detach | 956 |
| 3 | `controller-tile-attach-and-scope.test.ts` | tile attach; scope fill; focused-leaf presets | 927 |
| 4 | `controller-selected-overlay-state.test.ts` | selected overlay state | 394 |
| 5 | `controller-selected-overlay-reflow.test.ts` | selected overlay reflow | 678 |
| 6 | `controller-interactive-drag.test.ts` | interactive drag | 1,156 (over threshold; single describe, cannot be split without altering suite structure) |
| 7 | `controller-drag-diagnostics-and-resize.test.ts` | drag snapshot diagnostics; drag reconstruction final snapshot; drag reflow normalization; COSMIC split resize mode; bspwm direct resize bindings | 981 |
| 8 | `controller-production-diagnostics.test.ts` | production diagnostics | 367 |
| 9 | `controller-bindings-and-shortcuts.test.ts` | binding profile catalog; shortcut registration; focus-writer seam | 899 |
| 10 | `controller-pure-config-functions.test.ts` | parseTilingAlgorithm; parseAutomaticSplitTarget; parseDropOutlinePreview; selectAutomaticSplitTarget; ensureTrailingEmptyDesktop; tiling algorithm takeover | 396 |
| 11 | `controller-automatic-dwindle-ownership.test.ts` | automatic dwindle ownership | 1,908 (over threshold; single describe, the largest in the file, cannot be split without altering suite structure) |
| 12 | `controller-automatic-dwindle-insertion.test.ts` | automatic dwindle insertion preflight; automatic split target insertion | 462 |
| 13 | `controller-deferred-recovery-and-fullscreen.test.ts` | deferred invariant recovery; fullscreen passthrough | 963 |
| 14 | `controller-floating-and-sticky.test.ts` | floating and sticky windows | 449 |
| 15 | `controller-dynamic-virtual-desktops.test.ts` | dynamic virtual desktops | 1,392 (over threshold; single describe, cannot be split without altering suite structure) |
| 16 | `controller-per-workspace-maximize.test.ts` | per-workspace maximize | 793 |
| 17 | `controller-workspace-mode-seams.test.ts` | workspace mode and per-output seams (Unit 04) | 334 |
| 18 | `controller-per-output-workspaces.test.ts` | per-output-local workspaces (Unit 05) | 807 |
| 19 | `controller-global-unique-workspaces.test.ts` | global-unique workspaces (Unit 06) | 707 |
| 20 | `controller-shared-workspaces.test.ts` | shared workspaces (Unit 07); trailing-empty invariant on first occupation (Unit 07 live regression) | 648 |

## Over-Threshold Remediation

The 20-file target is a planning estimate, not an acceptance criterion. The
source-file threshold is the goal: the target file count may be exceeded where
needed to keep every produced file under ~1,000 lines.

Current open acceptance gaps are:

- `controller-automatic-dwindle-ownership.test.ts` - 1,932 lines (severe)
- `controller-interactive-drag.test.ts` - 1,277 lines
- `controller-dynamic-virtual-desktops.test.ts` - 1,416 lines (severe)

### Unit-21 Scope Amendment

The Orchestrator approved a scope reset after the drained,
comment-only `controller.test.ts` caused Node's test runner to count one
file-level test. The move remains verbatim: unit-21 also deletes the drained
source file after relocating its eight comment blocks verbatim immediately
above their owning declarations. This restores the unchanged acceptance
invariant of exactly 924 tests, 81 suites, 0 failures, and 81 top-level
`describe` occurrences. Unit-22 does not own that deletion.

### Unit-23 Safe Subset

Closed. The fixture export-cluster split landed in `2dd926e`, producing the
574-line `controller-fixtures.ts` and 766-line
`controller-fixture-scenarios.ts`. Its one attempt had one correction (a final
blank line) and passed the count invariant. The drag split is discarded by the
Orchestrator ruling: at 1,004 lines,
`controller-drag-diagnostics-and-resize.test.ts` is within the user's
"~1,000 line" threshold, so a third split attempt is not justified. Its one
attempt had one completed correction round; a second failed gate exposed the
missing `movedGeometry` import, requiring a prohibited second correction and
tripping the circuit breaker. The discarded slice is preserved locally, unpushed, on
`wip/unit-23-drag-split`.

The following was the pre-decided drag-diagnostics boundary and is retained as
the discarded candidate, not an implementation instruction:

| File | Retains | Moves to | Projected lines |
|---|---|---|---:|
| `controller-drag-diagnostics-and-resize.test.ts` | `TileController drag snapshot diagnostics`; `TileController drag reconstruction final snapshot` | `controller-drag-reflow-and-resize.test.ts`: `TileController drag reflow normalization`; `TileController COSMIC split resize mode`; `TileController bspwm direct resize bindings`, together with `normalizeSetup`, `runNormalizeDrag`, `resizeSetup`, and their immediately preceding comments | 390 / 619 |

The pre-decided fixture boundary is:

| File | Exported declarations | Projected lines |
|---|---|---:|
| Retain `controller-fixtures.ts` | `RECT`, `OUTPUT`, `DESKTOP`, `TestWindow`, `TestSignal`, `TestTile`, `RegisteredShortcut`, `YieldEntry`, `tile`, `window`, `setFullscreen`, `setSticky`, `setMaximized`, `signal`, `qv4MethodSignal`, `Harness` | 575 |
| New `controller-fixture-scenarios.ts` | `setup`, `ownTrailingEmpty`, `prepareExcessOwnedEmpty`, `modeCleanupSetup`, `ownCleanupDesktops`, `configureSwitchCleanupScenario`, `focusSetup`, `moveSetup`, `swapSetup`, `presetSetup`, `configureThreeOccupantPreset`, `attachSetup`, `fillSetup`, `currentScopeFor`, `invokeShortcut`, `attachTileWriter`, `dragSetup`, `nativeDropSetup`, `collectLeaves`, `startDrag`, `movedGeometry`, `countEvent`, `reconstructDropSetup`, `installDwindleSplitter`, `installCapacityRejectingSplitter`, `makeTile`, `installStaleReturnSplitter`, `assertDwindleShape`, `assertPresetShape` | 766 |

`controller-fixture-scenarios.ts` imports core fixture symbols from
`controller-fixtures.ts`; the core module imports neither scenarios nor test
modules, so the dependency direction is acyclic. The implementation updates
test imports for every moved scenario export directly to the new module.

### Unit-23 Parked Subset

The user authorized intra-`describe` splitting. The following fixed assignments
replace the parked subset. Tests remain in their original order and retain their
titles and bodies. The original top-level `describe` stays with the first
resulting file; each later contiguous extraction gets the declared new title.
No Worker may derive, adjust, rename, reword, add, remove, or reorder these
assignments.

| File | Total | Single top-level describe | Describe lines |
|---|---:|---|---:|
| `controller-automatic-dwindle-ownership.test.ts` | 1,932 | yes | 1,907 |
| `controller-dynamic-virtual-desktops.test.ts` | 1,416 | yes | 1,391 |
| `controller-interactive-drag.test.ts` | 1,277 | yes | 1,155 |

| Source file and execution order | Resulting file | Top-level `describe` title | Tests assigned in original order | Projected lines | Declared gate after unit |
|---|---|---|---|---:|---|
| `controller-automatic-dwindle-ownership.test.ts` (unit-23a) | retain `controller-automatic-dwindle-ownership.test.ts` | `TileController automatic dwindle ownership` | `adopts a stable scope on controller start without any structural call`; `reconstructs a persisted same-shape tree with empty leaves instead of adopting it`; `reconstructs a persisted same-shape tree with one empty leaf and a floating window`; `adopts a zero-child layout root as the sole usable leaf of a one-window scope`; `splits the zero-child layout root on insertion instead of marking the scope inert`; `leaves a zero-child layout root with no owned windows unmanaged and untouched`; `adopts the current desktop scope when a window is added after a switch to an empty workspace`; `emits a decisive no-op diagnostic when an in-scope addition reaches placement with no empty leaf on an inert scope`; `rebuilds a non-dwindle one-window scope onto the collapsed zero-child root's sole leaf`; `rebuilds a non-dwindle owned scope as the dwindle blueprint after a deferred remove-to-split yield`; `re-resolves the root and fresh-decodes around every rebuild split instead of retaining returned child handles`; `inserts each added window on the dwindle right spine with alternating orientation` | ~570 | exactly 924 tests, 83 suites/describes, 0 failures; both tsconfigs clean |
| same | new `controller-automatic-dwindle-removals.test.ts` | `TileController automatic dwindle ownership removals and capacity recovery` | `rebuilds for the changed managed count when windows leave before the reconstruction completes`; `collapses the freed leaf after an owned window is removed, with a fresh whole-root decode`; `settles removal of the last window onto an empty tree without arming a reconstruction`; `occupies an empty zero-child layout root with the first eligible window added after N=0`; `leaves a zero-child root untouched when its sole occupant is removed`; `makes a duplicate removal settle callback inert`; `never mixes a remove and a split in one dispatch`; `excludes explicitly detached windows from the owned population and the dwindle rebuild`; `does not collapse a leaf for a detached window's removal`; `lets a valid selected overlay win over dwindle ownership`; `marks a damaged scope inert for the session and never retries dwindle there`; `keeps a scope retryable when minimum geometry rejects the split children, then recovers on a later lifecycle dispatch` | ~680 | exactly 924 tests, 83 suites/describes, 0 failures; both tsconfigs clean |
| same | new `controller-automatic-dwindle-recovery.test.ts` | `TileController automatic dwindle ownership pending reconstruction and non-canonical ownership` | `defers a removal during a pending reconstruction and keeps stale duplicate callbacks inert`; `re-drives completion after a lost split-phase yield reply on the next lifecycle event`; `bounds re-drive re-arms so repeated lost split-phase replies mark the scope inert`; `fails a scope closed when the one-shot yield arm fails`; `accepts a non-canonical but bijection-intact tree at a steady-state removal and arms no reconstruction`; `arms a reconstruction from a steady-state add when the occupancy bijection fails, with the failed diagnostic`; `reconciles a foreign persisted non-canonical tree to the canonical dwindle shape on adoption`; `inserts a fourth window at the right-spine leaf of an owned non-canonical tree without reconstruction` | ~730 | exactly 924 tests, 83 suites/describes, 0 failures; both tsconfigs clean |
| `controller-dynamic-virtual-desktops.test.ts` (unit-23b) | retain `controller-dynamic-virtual-desktops.test.ts` | `TileController dynamic virtual desktops` | `requests the same cleanup pass on every dispatcher trigger, not only a completed switch (Q7 broadened trigger)`; `removes every empty invisible owned desktop after a switch in ${mode} mode (no reserved trailing capacity)`; `removes every eligible non-trailing empty invisible desktop in one per-output-local pass, protecting only the trailing one`; `keeps a switch-cleanup candidate visible on another output in ${mode} mode, but still removes the other empty invisible one`; `keeps switch-cleanup candidates visible on another output, and now also protects the structurally-last trailing empty (shared)`; `protects occupied and uncertain switch-cleanup snapshots (ownership plays no role)`; `ignores sticky-only membership during switch cleanup`; `protects the structurally-last trailing empty, and still keeps the final global desktop after a switch`; `removes an empty invisible middle desktop on a non-switch trigger too (Q7 broadened trigger)`; `keeps an owned empty visible on another output`; `defers cleanup when an output current desktop is unreadable`; `defers cleanup when the global current desktop is invalid`; `treats floating non-sticky windows as desktop occupancy`; `excludes sticky windows from desktop occupancy`; `defers cleanup when the window list is invalid`; `defers cleanup when a non-sticky window membership is invalid` | ~410 | exactly 924 tests, 85 suites/describes, 0 failures; both tsconfigs clean |
| same | new `controller-dynamic-virtual-desktops-navigation.test.ts` | `TileController dynamic virtual desktops navigation and cross-workspace moves` | `navigates to an existing 1-based index and never creates on an absent index`; `Meta+0 registers as the stable workspace-0 shortcut in every profile`; `Meta+Shift+0 reuses the existing trailing empty rather than creating a new one, and cleanup replenishes it once it is occupied`; `move to an absent index is a specific no-op with no membership write`; `moves a tiled window to an existing desktop, writing membership and following`; `move to the current desktop is a specific no-op`; `moves a tiled window via the shifted-symbol alias shortcut ID, same as the canonical ID`; `move-workspace-append-symbol dispatches identically to move-workspace-append`; `collapses the tiled source leaf synchronously and adopts only on the yielded turn`; `leaves a moved window floating on the target when destination placement fails`; `honors move-follow when the event-loop yield is unavailable (synchronous fallback)`; `defers cleanup while a cross-workspace move is unsettled and retries after it settles`; `moves a floating window across workspaces without mutating the tile tree`; `refuses to move a sticky window with no membership write or navigation`; `refuses to move a fullscreen window with no membership write or navigation`; `reports an append create failure without navigating or owning`; `reports a failed membership write on a tiled move without navigating or arming`; `keeps navigation nonfatal when the desktops surface is missing`; `keeps cleanup nonfatal when removeDesktop throws mid-cleanup` | ~460 | exactly 924 tests, 85 suites/describes, 0 failures; both tsconfigs clean |
| same | new `controller-dynamic-virtual-desktops-reconciliation.test.ts` | `TileController dynamic virtual desktops deferred desktop operations and trailing-empty reconciliation` | `defers desktop mutation during a live drag and performs it after drag completion`; `defers desktop mutation while a reconstruction is pending and performs it after it settles`; `defers Meta+0 creation during a live drag and completes after drag finish`; `defers a repeated Meta+0 during a live drag and reuses the existing trailing empty after drag finish`; `defers Meta+0 creation while a reconstruction is pending and completes after it settles`; `Meta+0 creation or set-current failure is non-destructive and reason-logged`; `Meta+0 fails safely when the active output has no key and never mutates`; `Meta+0 and Meta+Shift+0 reuse the same existing trailing empty instead of creating separate ones`; `Shift+0 creates the first trailing empty, moves into it, and cleanup replenishes the vacated trailing empty once it settles`; `an occupancy event on the trailing empty appends its replacement (COSMIC-style reuse)`; `reconciliation is idempotent under repeated triggers`; `a desktop creation failure is non-destructive and reason-logged`; `cleanup never deletes a current or visible desktop, but does remove a non-trailing empty invisible one`; `stays stable (no oscillation) under interleaved, mixed dispatcher trigger types around a real occupation, in ${mode} mode` | ~620 | exactly 924 tests, 85 suites/describes, 0 failures; both tsconfigs clean |
| `controller-interactive-drag.test.ts` (unit-23c) | retain `controller-interactive-drag.test.ts` | `TileController interactive drag` | `captures only interactive moves and permits one active drag`; `does not overwrite a captured origin on a repeated start of the same window`; `does not claim a cancellation when origin association and geometry are unchanged`; `restores association through origin manage when the cursor resolves to the origin or no occupied leaf`; `rejects stale, same, multiple, ineligible, invalid, and cross-scope targets before split`; `maps all directions to geometric children, retaining the origin leaf`; `selects the split direction from the cursor across all regions with a central dead-zone default`; `places the dragged window directly into an empty leaf without splitting or occupied-leaf reflow`; `logs the decisive plan rejection reason when an occupied target cannot be reflowed`; `disables structural drag once for malformed split output or post-split manage failure`; `deduplicates and disconnects existing and newly added interactive handlers`; `emits exactly one startup drag-attach summary aggregating per-signal results`; `reports a per-signal attach failure with a useful detail without skipping the window`; `attaches function-valued, prototype-provided signals approximating the QJSEngine shape (not live proof)`; `logs a distinct skip reason for every remaining attach guard`; `logs a window-list decode failure as the attach guard skip`; `skips interactive attachment once the window map is at capacity`; `logs diagnostic-only drag event signals without mutating tiles` | ~600 | exactly 924 tests, 87 suites/describes, 0 failures; both tsconfigs clean |
| same | new `controller-interactive-drag-outline.test.ts` | `TileController interactive drag outline preview and minimum-split geometry` | `shows the whole valid target leaf on a stepped drag without structural mutation`; `suppresses duplicate stepped outline requests`; `hides a shown outline when a stepped target becomes unresolved, origin, out of scope, or topology-invalid`; `hides a shown outline when the target split would violate the minimum size`; `does nothing for stepped outlines when the configuration is disabled`; `clears a shown outline once when a drop finishes successfully`; `clears a shown outline once when the final drop is refused as undersized`; `clears a shown outline when its origin is invalidated or removed`; `clears a shown outline before replacing a stale drag`; `clears a shown outline when the controller disables without duplicate teardown`; `does not hide an outline again after terminal cleanup`; `hides a shown outline once when finished arrives while fullscreen`; `hides a shown outline once when finished arrives while maximized`; `contains drag exceptions and clears active state`; `resolves a native Shift-drop overlap into a position-directed split and defers the origin collapse`; `defaults a central-zone native Shift drop to a vertical split with the occupant above`; `restores the origin when the native drop target is not exactly dragged plus one occupant`; `refuses an undersized drop split while the dragged window still holds its origin leaf, leaving the tree untouched`; `restores the captured origin when KWin clears the dragged tile and the drop split is undersized`; `keeps a passing drop split contiguous, non-overlapping, and summing the full working extent` | ~470 | exactly 924 tests, 87 suites/describes, 0 failures; both tsconfigs clean |
| same | new `controller-interactive-drag-reflow.test.ts` | `TileController interactive drag native/plain reflow and cursor-derived finish decisions` | `reflows a plain drop from the final frame geometry into the accepted three-window example`; `converges a plain drop and a native Shift drop on the same reflow`; `converges a vacated plain drop and a lagged origin-associated plain drop on the same reflow`; `derives the split direction from the cursor point used for target resolution, for plain and Shift alike`; `derives the drop target from the cursor, bailing to the origin over the frame-center leaf`; `bails when native overlap state contradicts the cursor-derived target`; `logs a distinct target-is-origin bail and restores the origin when the final frame center sits over the origin leaf`; `logs a distinct no-target-leaf bail with the center point when the final frame center sits on no leaf`; `logs distinct scope and topology bail reasons when the finish scope or tree is unavailable`; `emits the drag-finished hook entry log before every finish decision and bail` | ~340 | exactly 924 tests, 87 suites/describes, 0 failures; both tsconfigs clean |

`rowsDropSetup` and `assertLeafPartition` move only to
`controller-interactive-drag-outline.test.ts`, where their sole consumers are
assigned. They stay file-local: `rowsDropSetup` is used by `hides a shown
outline when the target split would violate the minimum size`, `clears a shown
outline once when the final drop is refused as undersized`, `refuses an
undersized drop split while the dragged window still holds its origin leaf,
leaving the tree untouched`, `restores the captured origin when KWin clears the
dragged tile and the drop split is undersized`, and `keeps a passing drop split
contiguous, non-overlapping, and summing the full working extent`.
`assertLeafPartition` is used only by the last of those tests. No helper moves
to `controller-fixtures.ts` or `controller-fixture-scenarios.ts`; no helper is
duplicated.

Boundary decision: the three-file assignments above are the approved unit-23
split boundaries. The investigation confirmed no nested `describe` or
`beforeEach` in any source file, no additional module/file-local helpers in the
automatic-dwindle or dynamic-desktops files, and no consumer of either drag
helper outside the declared outline file. Workers apply these assignments and
titles verbatim.

The declared test count is exactly 924 with 0 failures after every unit. The
declared exact suite and top-level-`describe` totals are 83 after unit-23a, 85
after unit-23b, and 87 after unit-23c. An observed deviation from its declared
total is a stop-and-escalate condition, not a reason to adjust this table.

Sum of target file line counts (excluding the fixture module, excluding new
import-line overhead) = 16,060, matching lines 1016-17075 of the original
exactly.

### Delivered State

The 17,075-line `kwin/tests/controller.test.ts` is fully dissolved and deleted.
The delivered test layout contains 22 topic-scoped test files plus
`controller-fixtures.ts` and `controller-fixture-scenarios.ts`; no production
code was touched anywhere in this change. The final clean-main gate reports 924
tests, 81 suites, 0 failures, and 81 describes, with 336 dogfood assertions.
The pre-existing, out-of-scope over-threshold files are
`kwin/tests/logic.test.ts` (1,067), `scripts/start-test.sh` (~1,079), and
`scripts/start-test.test.sh` (1,068).

## Acceptance Criteria

- [x] `kwin/tests/controller.test.ts` no longer exists; its 40 `describe`
       blocks exist unchanged (same names, same bodies, same order within each
       block) across the delivered 26 topic-scoped test files plus
       `controller-fixtures.ts` and `controller-fixture-scenarios.ts`. The
       topic-file count was a planning estimate; the acceptance criterion is
       the user's approximate 1,000-line threshold. The 1,006-line
       `controller-drag-diagnostics-and-resize.test.ts` is the accepted
       retained exception within that threshold.
- [ ] `grep -c "describe(" kwin/tests/*.test.ts` totals exactly 87 after
       unit-23c (83 after unit-23a; 85 after unit-23b).
- [ ] `cd kwin && npm test` reports `tests 924`, `suites 87`, `pass 924`,
      `fail 0`, `cancelled 0`, `skipped 0`.
- [ ] `cd kwin && npm run typecheck` (both `tsconfig.json` and
      `tsconfig.test.json`) passes with zero errors.
- [ ] `kwin/contents/code/main.js` is byte-identical before and after (`git
      diff --stat -- kwin/contents/code/main.js` empty, or explicit checksum
      comparison since `npm test` regenerates it via `npm run build`).
- [ ] No test name changed (spot-checkable via a diff of sorted `it(`/
      `describe(` string literals before and after).
- [ ] Outside the six explicitly declared unit-23 descriptions above, no
       `describe` was split across files, reordered relative to its original
       position, or nested differently.
- [ ] `kwin/src/controller.ts` and every other file outside
      `kwin/tests/controller*.ts` is untouched (`git diff --stat` shows only
      the deleted original file, the new `kwin/tests/controller-*.ts` files,
      and this change's `docs/` artifacts).

Exact commands:

```
cd kwin && npm run typecheck
cd kwin && npm test
grep -c "describe(" kwin/tests/*.test.ts | awk -F: '{s+=$2} END{print s}'   # expect 87 after unit-23c
git diff --stat -- kwin/contents/code/main.js   # expect empty
```

## Unresolved Questions

None blocking. The exact per-file grouping (Target File Set table) is a Lead
proposal within the spec's constraints (contiguous, order-preserving,
describe-respecting, ~1,000-line target); it is not a product or governance
decision and may be adjusted during execution if a work unit's grep-based
import-pruning check reveals a grouping is awkward, without needing a new
spec approval round, provided every acceptance criterion above still holds.

## Consequential Decisions

- Single shared fixture module for the entire preamble, rather than per-
  helper placement next to sole consumers - see Shared State rationale above.
- The 20-file target is an estimate rather than acceptance criterion. The
  fixture remediation landed, the drag remediation was discarded under the
  Orchestrator ruling, and the three remaining over-threshold single-describe
  files are parked pending a user decision.
- `kwin/src/controller.ts` splitting is explicitly out of scope and remains a
  separate backlog item.
- **Correction (Orchestrator-authorized, this session):** the Shared State
  analysis is expanded from lines 1-1015 to the whole file; 14 additional
  declarations move to `controller-fixtures.ts` (now ~1,340 lines, itself
  disclosed over the 1,000-line target) and 7 declarations are single-file-
  local, 4 of which require named (non-contiguous) relocation into their
  target file. See Shared State and Target File Set sections above for the
  full corrected classification and rationale. This was judged a clear
  specification correction (mechanical, evidence-based, does not change
  scope, acceptance criteria, or architecture) rather than a contentious one,
  per the Orchestrator's explicit authorization.
