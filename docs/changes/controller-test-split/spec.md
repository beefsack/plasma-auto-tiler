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
and self-verifying: the test/suite counts (838 tests, 78 suites, confirmed by
a baseline `npm test` run at HEAD `ecbf5ef`) are a hard, cheap, unambiguous
acceptance gate, and every `describe` in this codebase is flat (no nested
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

## Shared State (investigation finding)

`kwin/tests/controller.test.ts` lines 1-1015 are the module-scope preamble:
imports (lines 1-43), 3 constants (`RECT`, `OUTPUT`, `DESKTOP`), 5 type/
interface declarations (`TestWindow`, `TestSignal`, `TestTile`,
`RegisteredShortcut`, `YieldEntry`), 7 top-level functions (`tile`, `window`,
`setFullscreen`, `setSticky`, `setMaximized`, `signal`, `qv4MethodSignal`),
one class (`Harness`, lines 224-618), and 15 more top-level helper functions
(`setup`, `ownTrailingEmpty`, `prepareExcessOwnedEmpty`, `modeCleanupSetup`,
`ownCleanupDesktops`, `configureSwitchCleanupScenario`, `focusSetup`,
`moveSetup`, `swapSetup`, `presetSetup`, `configureThreeOccupantPreset`,
`attachSetup`, `fillSetup`, `currentScopeFor`, `invokeShortcut`).

**No module-level mutable state exists** (`grep -n "^let \|^var \|static "`
over lines 1-1015 returns nothing) - every helper's state is per-call or
per-`Harness`-instance, so extracting the whole preamble into a separate
module and letting each split file's esbuild bundle carry its own copy is
behaviorally identical to today: zero cross-test interference risk from the
extraction itself.

Usage breadth (checked by mapping every reference of each helper name to the
top-level `describe` it falls inside):

| Helper(s) | Describes that use it | Verdict |
|---|---|---|
| `RECT`, `OUTPUT`, `DESKTOP`, `TestTile`, `tile()`, `window()`, `Harness`, `setup()`, `invokeShortcut()` | 11-33 of the 40 describes each (broadly cross-cutting) | must be shared |
| `presetSetup`, `configureThreeOccupantPreset`, `currentScopeFor` | 5-6 non-adjacent describes each, spanning from "keyboard insertion" near the top to "automatic dwindle ownership" near the middle | must be shared |
| `setFullscreen`, `setSticky`, `setMaximized` | 3-5 non-adjacent describes each | must be shared |
| `moveSetup`, `swapSetup` | 2 non-adjacent describes each | must be shared |
| `ownTrailingEmpty` | 2 adjacent describes (both land in the same target file) | shared for simplicity |
| `focusSetup`, `attachSetup`, `fillSetup`, `modeCleanupSetup`, `ownCleanupDesktops`, `configureSwitchCleanupScenario`, `prepareExcessOwnedEmpty` | exactly 1 describe each | technically single-consumer, kept shared anyway (see rationale below) |

Decision: extract the **entire** preamble (all of it, including the single-
consumer helpers) into one shared module, `kwin/tests/controller-fixtures.ts`,
rather than hand-placing each helper next to its sole consumer. Rationale:
per-helper placement is a judgment call that adds risk (misjudging a helper's
real consumer set) for no correctness benefit; one atomic, mechanical
extraction of a fixed, pre-enumerated line range is lower-risk and needs no
per-helper decision. The minor cost is that a few single-use helpers live one
hop from their sole caller.

`globalUniqueSetup` (`kwin/tests/controller.test.ts:15738`), `twoOutputSetup`
(`:14928`), and `moveToTrailing` (`:14968`) are declared **inside** their
`describe` block, not at module scope - they travel with that block
unchanged and are not part of the fixture extraction. `ownedDesktopIdSnapshot`
named in the dispatch brief does not exist as a declared symbol anywhere in
the file (verified by exact-word grep); it is not a real shared helper.

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

One shared module, `kwin/tests/controller-fixtures.ts` (~975 lines: the
1-1015 preamble minus the `import` block, which is replaced/pruned per the
files that need it - exact export list per the Shared State section above).

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

Three files (6, 11, 15) remain over the 1,000-line threshold because each is
a single `describe` block already over that size; splitting further would
require adding new `describe`/`it` boundaries inside existing tests, which
this change's non-goals forbid. This is disclosed as accepted, not resolved.

Sum of target file line counts (excluding the fixture module, excluding new
import-line overhead) = 16,060, matching lines 1016-17075 of the original
exactly.

## Acceptance Criteria

- [ ] `kwin/tests/controller.test.ts` no longer exists; its 40 `describe`
      blocks exist unchanged (same names, same bodies, same order within each
      block) across the 20 target files plus `controller-fixtures.ts`.
- [ ] `grep -c "describe(" kwin/tests/*.test.ts` totals exactly 78 (same as
      the pre-change baseline).
- [ ] `cd kwin && npm test` reports `tests 838`, `suites 78`, `pass 838`,
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
- Three files (6, 11, 15) accepted over the 1,000-line threshold rather than
  restructuring their single oversized `describe` - see Target File Set
  rationale above.
- `kwin/src/controller.ts` splitting is explicitly out of scope and remains a
  separate backlog item.
