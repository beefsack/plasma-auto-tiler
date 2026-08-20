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

- `controller-automatic-dwindle-ownership.test.ts` - 1,930 lines (severe)
- `controller-fixtures.ts` - 1,332 lines
- `controller-interactive-drag.test.ts` - 1,271 lines
- `controller-drag-diagnostics-and-resize.test.ts` - 1,004 lines
- `controller-dynamic-virtual-desktops.test.ts` - 1,414 lines (severe)

### Unit-21 Scope Amendment

The Orchestrator approved a scope reset after the drained,
comment-only `controller.test.ts` caused Node's test runner to count one
file-level test. The move itself remains accepted as verbatim: unit-21 now
also deletes the drained source file after relocating any durable comment
information. This is the only change needed to restore the unchanged
acceptance invariant of exactly 924 tests, 81 suites, 0 failures, and 81
top-level `describe` occurrences. Unit-22 no longer owns that deletion.

After all ordinary extractions complete, remediation `unit-23` runs after
unit-21 and before unit-22. A successor Lead must first derive and record in
this specification the exact, pre-decided top-level `describe` boundaries for
each over-threshold test-file sub-split. Workers apply those recorded
boundaries only; they must not derive, choose, or adjust them. The fixture
module is split by export group rather than `describe` boundary and is lower
priority; it must be flagged and escalated if a safe export-group split cannot
be established.

Every remediation split must preserve exactly 924 tests, 81 suites, 0 failures,
and 81 top-level `describe` occurrences. Before selecting a suite-count-neutral
split, establish empirically what the harness counts as a suite. If any
candidate sub-split changes one of those values, stop and escalate without
adjusting the expected values.

Sum of target file line counts (excluding the fixture module, excluding new
import-line overhead) = 16,060, matching lines 1016-17075 of the original
exactly.

## Acceptance Criteria

- [ ] `kwin/tests/controller.test.ts` no longer exists; its 40 `describe`
      blocks exist unchanged (same names, same bodies, same order within each
      block) across the 20 target files plus `controller-fixtures.ts`.
- [ ] `grep -c "describe(" kwin/tests/*.test.ts` totals exactly 81 (the
      current pre-split baseline).
- [ ] `cd kwin && npm test` reports `tests 924`, `suites 81`, `pass 924`,
      `fail 0`, `cancelled 0`, `skipped 0`.
- [ ] `cd kwin && npm run typecheck` (both `tsconfig.json` and
      `tsconfig.test.json`) passes with zero errors.
- [ ] `kwin/contents/code/main.js` is byte-identical before and after (`git
      diff --stat -- kwin/contents/code/main.js` empty, or explicit checksum
      comparison since `npm test` regenerates it via `npm run build`).
- [ ] No test name changed (spot-checkable via a diff of sorted `it(`/
      `describe(` string literals before and after).
- [ ] No `describe` was split across files, reordered relative to its
      original position, or nested differently.
- [ ] `kwin/src/controller.ts` and every other file outside
      `kwin/tests/controller*.ts` is untouched (`git diff --stat` shows only
      the deleted original file, the new `kwin/tests/controller-*.ts` files,
      and this change's `docs/` artifacts).

Exact commands:

```
cd kwin && npm run typecheck
cd kwin && npm test
grep -c "describe(" kwin/tests/*.test.ts | awk -F: '{s+=$2} END{print s}'   # expect 78
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
- The 20-file target is an estimate rather than acceptance criterion. The four
  currently over-threshold produced files require the pre-decided remediation
  recorded in Over-Threshold Remediation before final acceptance.
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
