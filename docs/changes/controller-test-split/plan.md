# Plan: Split `kwin/tests/controller.test.ts`

Ownership and approval:
- Owner: Lead
- Status: Approved (autonomous mode, delegated plan approval)

## Technical Approach

**Corrected this session** (see `spec.md` Shared State section): the
extraction unit is not always a whole `describe`. 14 non-preamble
declarations (in addition to the 31-declaration preamble) are cross-boundary
and belong in `controller-fixtures.ts`; 4 more are single-file-local but
physically declared away from the file they belong to and must be relocated
by name. The mechanism below accounts for both.

`controller.test.ts` retains its original preamble and the three non-preamble
declaration clusters (line 4112; lines 4520-4813; lines 8002-8169) until the
last local consumer of each declaration moves. When a unit extracts
`describe` blocks, it also removes exactly those source-preamble imports and
declarations whose last remaining consumer moved in that same unit. Before
removal, the unit proves by search that no remaining code in
`controller.test.ts` references the symbol; a typecheck error is a detector,
not sufficient justification. It does not prune a symbol that still has a
remaining source reference, and it never deletes or rewrites a test body,
assertion, describe name, or ordering. The duplicate helpers in the retained
file are expected residue from unit-01; they are removed only with their last
local consumer, not converged early.

This amendment is necessary because the original requirement to retain a
full, unmodified preamble until final cleanup contradicted the per-unit clean
typecheck requirement. The contradiction could surface only after the first
real extraction orphaned a preamble symbol. Every unit that moves a `describe`
also moves, by name (an individually located `sed` range per declaration, not
just per `describe`), any of the 21 non-preamble declarations that belongs
with it per the Shared State table - either into `controller-fixtures.ts`
(unit-01, for the 14 cross-boundary ones) or into its own target file (units
07, 08, 11, 13 - see their entries below). A unit extracts and deletes its
lines from `controller.test.ts` atomically, so the suite count stays at 81 and
the test count at 924 after every single unit, not just at the end. The final
unit deletes the now-empty `controller.test.ts` shell, once its preamble and
all three clusters are fully and correctly relocated.

Because every unit re-locates its target `describe`(s) by name via a fresh
`grep -n "^describe("` rather than trusting a previously-recorded line
number, units are order-independent and resumable across a crash, a Lead
succession, or an out-of-order execution - no unit depends on line numbers
computed by an earlier unit.

Per-file import pruning is mechanical, not judgment-based: a fixed candidate
list (the ~25 fixture export names and the ~25 `src/` import names, both
enumerated in `spec.md`) is grep-checked against the new file's body; only
names with at least one match are kept in the header. `npm run typecheck` is
the safety net - if pruning ever drops a name that's actually needed (e.g. a
name that also appears as a substring of an unrelated identifier confusing a
naive grep), typecheck fails immediately and the missing import is added by
inspecting only the compiler's specific error, not the file.

## Work Units

Every unit's verification block is the same three commands, run from `kwin/`:

```
npm run typecheck
npm test
grep -c "describe(" tests/*.test.ts | awk -F: '{s+=$2} END{print s}'   # must print 81
```

| ID | Objective | Depends on | File or subsystem scope | Verification |
|---|---|---|---|---|
| unit-01 | Create `kwin/tests/controller-fixtures.ts`: (a) copy lines 1-1015 verbatim except adding `export ` to each of the 31 top-level declarations, (b) additionally copy, by name (individual `sed` range per declaration, located via fresh `grep -n`), these 14 non-preamble declarations with `export ` added: `attachTileWriter` (~4112), `dragSetup`, `nativeDropSetup`, `collectLeaves`, `startDrag`, `movedGeometry`, `countEvent`, `reconstructDropSetup` (the cross-boundary members of the 4520-4813 cluster - skip `rowsDropSetup` and `assertLeafPartition`, those go to file 6), `installDwindleSplitter`, `installCapacityRejectingSplitter`, `makeTile`, `installStaleReturnSplitter`, `assertDwindleShape`, `assertPresetShape` (the cross-boundary members of the 8002-8169 cluster - skip `takeoverTilingSetup` and `installInlineMutatingRejectingSplitter`, those go to files 10 and 12); do not touch `controller.test.ts` yet | - | new file `kwin/tests/controller-fixtures.ts` (~1,340 lines before import pruning) | `npm run typecheck` only (no consumer exists yet to exercise it at runtime) |
| unit-02 | Move describes: keyboard insertion; ordinary placement and boundaries; keyboard focus -> `controller-keyboard-placement.test.ts` | unit-01 | new file + delete matching lines from `controller.test.ts` | full 3-command block |
| unit-03 | Move describes: keyboard move; occupied-target move swap; tile detach -> `controller-keyboard-move-and-swap.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-04 | Move describes: tile attach; scope fill; focused-leaf presets -> `controller-tile-attach-and-scope.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-05 | Move describe: selected overlay state -> `controller-selected-overlay-state.test.ts`; extract **only the describe body** (ends before line 4112) - do not include `attachTileWriter` (~4112-4135), which is fixtures-bound (unit-01) | unit-01 | same pattern | full 3-command block |
| unit-06 | Move describe: selected overlay reflow -> `controller-selected-overlay-reflow.test.ts`; extract **only the describe body** (ends before line 4520) - do not include the 4520-4813 cluster that follows it, which is fixtures/file-6-bound (unit-01/unit-07), not used by this describe | unit-01 | same pattern | full 3-command block |
| unit-07 | Move describe: interactive drag (1,156 lines; single describe, over threshold, disclosed in spec) -> `controller-interactive-drag.test.ts`; also relocate `rowsDropSetup` (~4626) and `assertLeafPartition` (~4709) by name from the 4520-4813 cluster (do not include the rest of that cluster - it goes to fixtures in unit-01) | unit-01 | same pattern, plus 2 named declarations | full 3-command block |
| unit-08 | Move describes: drag snapshot diagnostics; drag reconstruction final snapshot; drag reflow normalization; COSMIC split resize mode; bspwm direct resize bindings -> `controller-drag-diagnostics-and-resize.test.ts`; extract as **one contiguous range** (first describe start to last describe end, ~5970-6950), not five separate per-describe extracts, so `normalizeSetup`, `runNormalizeDrag`, and `resizeSetup` (declared in gaps between this group's own describes, used only within this group) come along automatically | unit-01 | same pattern (contiguous range, not per-describe) | full 3-command block |
| unit-09 | Move describe: production diagnostics -> `controller-production-diagnostics.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-10 | Move describes: binding profile catalog; shortcut registration; focus-writer seam -> `controller-bindings-and-shortcuts.test.ts`; extract **only through the last describe's closing brace** (ends before line 8002) - do not include the 8002-8169 cluster that follows, which is split between fixtures (unit-01), file 10 (unit-11), and file 12 (unit-13) | unit-01 | same pattern | full 3-command block |
| unit-11 | Move describes: parseTilingAlgorithm; parseAutomaticSplitTarget; parseDropOutlinePreview; selectAutomaticSplitTarget; ensureTrailingEmptyDesktop; tiling algorithm takeover -> `controller-pure-config-functions.test.ts`; also relocate `takeoverTilingSetup` (~8169) by name from the 8002-8169 cluster (do not include the rest of that cluster - it goes to fixtures in unit-01, except `installInlineMutatingRejectingSplitter` which goes to unit-13) | unit-01 | same pattern, plus 1 named declaration | full 3-command block |
| unit-12 | Move describe: automatic dwindle ownership (1,908 lines; single describe, over threshold, largest in the file, disclosed in spec) -> `controller-automatic-dwindle-ownership.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-13 | Move describes: automatic dwindle insertion preflight; automatic split target insertion -> `controller-automatic-dwindle-insertion.test.ts`; also relocate `installInlineMutatingRejectingSplitter` (~8061) by name from the 8002-8169 cluster | unit-01 | same pattern, plus 1 named declaration | full 3-command block |
| unit-14 | Move describes: deferred invariant recovery; fullscreen passthrough -> `controller-deferred-recovery-and-fullscreen.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-15 | Move describe: floating and sticky windows -> `controller-floating-and-sticky.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-16 | Move describe: dynamic virtual desktops (1,392 lines; single describe, over threshold, disclosed in spec; contains locally-scoped `ownTrailingEmpty`-consuming logic - verify `ownTrailingEmpty` import from fixtures is included) -> `controller-dynamic-virtual-desktops.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-17 | Move describe: per-workspace maximize -> `controller-per-workspace-maximize.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-18 | Move describe: workspace mode and per-output seams (Unit 04); verify local helper `ownTrailingEmpty` import from fixtures is included -> `controller-workspace-mode-seams.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-19 | Move describe: per-output-local workspaces (Unit 05) (contains its own locally-scoped `twoOutputSetup`/`moveToTrailing` - these travel with the block untouched, not part of fixtures) -> `controller-per-output-workspaces.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-20 | Move describe: global-unique workspaces (Unit 06) (contains its own locally-scoped `globalUniqueSetup` - travels with the block untouched) -> `controller-global-unique-workspaces.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-21 | Move describes: shared workspaces (Unit 07); trailing-empty invariant on first occupation (Unit 07 live regression) -> `controller-shared-workspaces.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-22 | Final cleanup: confirm `controller.test.ts` now contains only the preamble (lines 1-1015) with zero `describe(` occurrences and zero remaining non-preamble top-level declarations (the 4112, 4520-4813, and 8002-8169 clusters must all be gone, fully relocated by unit-01/unit-05/unit-06/unit-07/unit-10/unit-11/unit-13), delete `kwin/tests/controller.test.ts`, run the full acceptance gate (3-command block plus `git diff --stat -- kwin/contents/code/main.js` must be empty, plus a diff of sorted `it(`/`describe(` string literals before (from git history) and after confirming no name changed) | unit-02 .. unit-21 | delete `kwin/tests/controller.test.ts` | full 3-command block + `main.js` diff check + test-name diff check |

Only the Lead mutates plans and state. Semantic unit IDs above are stable;
execution slices use `unit-<n>/attempt-<n>`.

Sizing note: units unit-02 through unit-21 are each independently executable
by one Lead without spawning a subagent, because none of them requires a
whole-file `Read` - the extraction is a `sed` line-range operation located by
`grep -n`, and the only `Read` calls needed are small spot-checks (first/last
~15 lines of the new file, to confirm the boundary and the closing `});`).
Even unit-12 (1,908 lines moved) never requires holding that many lines in
context, since `sed` performs the move without the content passing through
the Lead's context window at all.

## Baseline Note (record-keeping, added by `cosmic-evidence-mining`'s Lead)

**The 838-test/78-suite baseline this plan's every verification step gates
on has moved twice.** `cosmic-evidence-mining` added
`kwin/tests/move-conformance-model.ts` and
`kwin/tests/move-conformance.test.ts` (41 new tests, 1 new suite, none of
them touching `controller.test.ts` or any file this change's units scope
over). `cosmic-move-model-closure` then extended that pure conformance work.
Before starting execution, the correct target is:

- `npm test`: **924 tests / 81 suites / 924 pass / 0 fail** (not 838/78).
- `grep -c "describe(" tests/*.test.ts` totals **81** (not 78).

The 838/78 baseline was itself re-measured and confirmed correct on this
machine, immediately before `move-conformance.test.ts` was added -
`docs/changes/archive/2026-08-20-cosmic-evidence-mining/plan.md`, unit-F
Acceptance-Criterion Evidence entry. It was
not stale before this change; this change is what moved it.

This follows the baseline-update precedent in `7ec91af`: it is a numeric
shift only. `move-conformance.test.ts` is not a `controller.test.ts` describe
block and is out of scope for every unit above; no work unit, file target, or
grouping in this plan needs to change, only the target numbers quoted in
`spec.md` and this plan's own verification commands, at the point execution
actually starts.

## Progress

- [x] unit-01 create controller-fixtures.ts
- [x] unit-02 keyboard placement
- [x] unit-03 keyboard move and swap
- [x] unit-04 tile attach and scope
- [ ] unit-05 selected overlay state
- [ ] unit-06 selected overlay reflow
- [ ] unit-07 interactive drag
- [ ] unit-08 drag diagnostics and resize
- [ ] unit-09 production diagnostics
- [ ] unit-10 bindings and shortcuts
- [ ] unit-11 pure config functions
- [ ] unit-12 automatic dwindle ownership
- [ ] unit-13 automatic dwindle insertion
- [ ] unit-14 deferred recovery and fullscreen
- [ ] unit-15 floating and sticky
- [ ] unit-16 dynamic virtual desktops
- [ ] unit-17 per-workspace maximize
- [ ] unit-18 workspace mode seams
- [ ] unit-19 per-output workspaces
- [ ] unit-20 global-unique workspaces
- [ ] unit-21 shared workspaces
- [ ] unit-22 final cleanup and full gate

## Attempt Accounting

- unit-01/attempt-01: not accepted, blocked. Fixture file created and
  `export` added to all 31 top-level declarations in lines 1-1015 per the
  work unit's instructions; `npm run typecheck` failed with `TS2304: Cannot
  find name 'attachTileWriter'` (a preamble helper calls a function declared
  outside the analyzed range) plus ~30 unused-import errors (expected -
  unit-01 does not prune imports). The `TS2304` finding escalated into the
  blocking Pending User Decision above rather than being patched locally,
  since it evidences the Shared State section's incompleteness rather than a
  simple missing import.
- unit-01/attempt-02: **accepted**. Dispatched to a `worker-anthropic`
  Worker under the corrected scope (31 preamble + 14 cross-boundary
  declarations, see Shared State section of `spec.md`). Lead-verified
  directly (not from the Worker's summary): `grep -n '^export '` on the
  result confirms exactly 45 exported declarations, names matching the
  corrected list exactly, in order; grepped for the 7 excluded single-file-
  local names (`rowsDropSetup`, `assertLeafPartition`, `takeoverTilingSetup`,
  `installInlineMutatingRejectingSplitter`, `normalizeSetup`,
  `runNormalizeDrag`, `resizeSetup`) - zero matches, confirming none leaked
  in; `wc -l` confirms 1,332 lines (close to the ~1,340 estimate);
   `git diff --stat`/`git status --short` scoped to `controller.test.ts`
   both empty, confirming it is untouched; `npm run typecheck` run directly
   by the Lead (not just re-quoted from the Worker) - both `tsconfig.json`
   and `tsconfig.test.json` pass with zero errors.
- unit-02/attempt-01: blocked pending a plan decision. The approved move of
  source lines 1016-1858 into `controller-keyboard-placement.test.ts` is a
  verbatim body move with correctly pruned new-file imports, but typecheck
  reports now-unused `DIRECTIONS`, `Direction`, and `focusSetup` in the
  retained source preamble. The Technical Approach requires that preamble to
  remain full and unmodified until final cleanup, so the required source
  pruning/removal cannot be applied without resolving the contradiction.
- unit-02/attempt-02: **accepted**. After the approved Technical Approach
  amendment, source search proved `DIRECTIONS`, `Direction`, and `focusSetup`
  had no remaining source consumers; the two import specifiers and the
  33-line local helper were removed with the moved describe blocks. The new
  file's body byte-compares to original lines 1016-1858; no helper relocation
  or test-body change occurred. `npm run typecheck`, `npm test` (924 tests,
  81 suites, 924 pass, 0 fail), and the describe count (81) all passed.
- unit-03/attempt-01: **accepted**. Original source lines 983-1938 moved
  verbatim into `controller-keyboard-move-and-swap.test.ts`; source search
  showed `moveSetup` and `swapSetup` retain later consumers, so no source
  preamble pruning was justified or performed. No helper relocation or test
  body change occurred. `npm run typecheck`, `npm test` (924 tests, 81 suites,
  924 pass, 0 fail), and the describe count (81) all passed.
- unit-04/attempt-01: **accepted**. Original source lines 983-1909 moved
  verbatim into `controller-tile-attach-and-scope.test.ts`; source search
  proved `attachSetup` and `fillSetup` had no remaining local consumers, so
  only those duplicate preamble helpers were pruned. `currentScopeFor` and
  `invokeShortcut` retain consumers and remain. No helper relocation or test
  body change occurred. `npm run typecheck`, `npm test` (924 tests, 81 suites,
  924 pass, 0 fail), and the describe count (81) all passed.

## Pending User Decisions

None open. The previously blocking module-scope and source-preamble decisions
below are resolved.

- **Resolved - source preamble cleanup during extraction.** The Orchestrator
  approved the Technical Approach amendment above after unit-02 exposed its
  internal contradiction. Each extraction now removes only imports and
  declarations proven to have no remaining source consumer; no test body or
  helper relocation is implicated in unit-02: `focusSetup` already exists in
  fixtures, and `DIRECTIONS`/`Direction` are direct source imports used only
  by that unit.

- **Resolved.** Originally raised during unit-01/attempt-01: `spec.md`'s
  Shared State section analyzed only lines 1-1015 and asserted this was the
  complete set of cross-cutting test helpers - false, as the `TS2304`
  failure on `attachTileWriter` evidenced. The Orchestrator authorized a full
  cross-reference analysis of every top-level declaration in the file and
  correction of `spec.md` and `plan.md` accordingly (not a governance
  change - a specification correction, per the Orchestrator's explicit
  framing). That analysis is complete: all 52 top-level declarations
  (31 preamble + 21 more, in three physical clusters at lines 4112,
  4520-4813, and 8002-8169) were enumerated, every reference bucketed by
  target file, and the internal call graph among the 21 checked for
  transitive promotions (one found: `makeTile`). Full corrected
  classification is in `spec.md`'s Shared State section; the resulting
  changes to `controller-fixtures.ts`'s scope and to units 01, 05, 06, 07,
  08, 10, 11, 13, and 22 are in this file's Work Units table above. The
  whole-file mutable-state re-check (not just lines 1-1015) also confirms
  zero module-level `let`/`var` anywhere in the file - extraction remains
  behaviorally safe.

## Acceptance-Criterion Evidence

| Acceptance criterion (from spec.md) | Evidence |
|---|---|
| All 40 describes preserved unchanged across 20 files + fixtures | pending - established by unit-22's full gate |
| `grep -c "describe("` totals 81 | units 02-04 passed; checked after every unit, not just the last |
| `npm test`: 924/81/924 pass/0 fail | units 02-04 passed; checked after every unit from unit-02 onward |
| `npm run typecheck` clean on both tsconfigs | units 02-04 passed; checked after every unit |
| `main.js` byte-identical | pending - checked in unit-22 (also true trivially after every unit, since `src/` is never touched) |
| No test name changed | pending - checked in unit-22 via sorted-literal diff |
| No describe split, reordered, or renested | pending - by construction (units move whole, named describes; no unit edits describe/it syntax) |
| Only `kwin/tests/controller*.ts` and `docs/` change | pending - checked in unit-22 via `git diff --stat` |

## Residual Risks

- The three over-threshold single-`describe` files (interactive drag,
  automatic dwindle ownership, dynamic virtual desktops) remain above 1,000
  lines; this is disclosed in `spec.md` as an accepted, not resolved, gap.
- Grep-based import pruning could theoretically under- or over-prune on an
  edge case (e.g. a name matching inside a string literal or comment rather
  than a real reference); the `npm run typecheck` step in every unit is the
  designed catch for this, so the risk is caught immediately, not silently.
- `controller.test.ts`'s temporary duplicate-preamble state (unit-01 through
  unit-21) means the repository is in a slightly unusual intermediate state
  for the duration of execution; this is intentional (it is what keeps every
  intermediate checkpoint self-verifying) and is fully resolved by unit-22.

## Final Outcome

- Pending. This session: corrected `spec.md`'s Shared State analysis to the
  whole file (Orchestrator-authorized), revised `plan.md` accordingly, and
  completed unit-01 (`controller-fixtures.ts`, accepted, typecheck-clean).
  Units 02-22 (moving `describe` blocks and the four named single-file-local
  relocations) remain unexecuted.
