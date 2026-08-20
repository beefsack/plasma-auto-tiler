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
declaration clusters (line 4112; lines 4520-4813; lines 8002-8169) only until
the last local consumer of each declaration moves. When a unit extracts
`describe` blocks, it also removes every retained source import or declaration
whose last remaining consumer moved in that same unit, including a
fixtures-bound declaration's retained duplicate. Before removal, the unit
proves by search that no remaining code in
`controller.test.ts` references the symbol; a typecheck error is a detector,
not sufficient justification. It does not prune a symbol that still has a
remaining source reference, and it never deletes or rewrites a test body,
assertion, describe name, or ordering. The duplicate helpers in the retained
file are expected residue from unit-01; they are removed only with their last
local consumer, not converged early.

**Systemic retained-source reconciliation (Orchestrator-authorized):** a
unit-specific instruction to not include a physical helper cluster in a target
file controls relocation only. It never preserves a source declaration after
its last retained consumer moves. Such a source copy is deleted under the
rule above when search proves it orphaned and TS6133 corroborates the finding.
This clarification was required when unit-07 orphaned the retained
fixtures-bound `collectLeaves` copy while its fixture export remained required
by the new file.

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
| unit-05 | Move describe: selected overlay state -> `controller-selected-overlay-state.test.ts`; extract **only the describe body** (ends before line 4112) - do not relocate `attachTileWriter` (~4112-4135) into this target, because it is fixtures-bound (unit-01); delete its retained source copy only if orphaned | unit-01 | same pattern | full 3-command block |
| unit-06 | Move describe: selected overlay reflow -> `controller-selected-overlay-reflow.test.ts`; extract **only the describe body** (ends before line 4520) - do not relocate the following 4520-4813 cluster into this target; it is fixtures/file-6-bound (unit-01/unit-07), and each retained source declaration is deleted only when orphaned | unit-01 | same pattern | full 3-command block |
| unit-07 | Move describe: interactive drag (1,156 lines; single describe, over threshold, disclosed in spec) -> `controller-interactive-drag.test.ts`; also relocate `rowsDropSetup` (~4626) and `assertLeafPartition` (~4709) by name from the 4520-4813 cluster; do not relocate its other declarations into this target, but delete any retained source copy that is orphaned (the fixtures-bound `collectLeaves` copy is the first case) | unit-01 | same pattern, plus 2 named declarations | full 3-command block |
| unit-08 | Move describes: drag snapshot diagnostics; drag reconstruction final snapshot; drag reflow normalization; COSMIC split resize mode; bspwm direct resize bindings -> `controller-drag-diagnostics-and-resize.test.ts`; extract as **one contiguous range** (first describe start to last describe end, ~5970-6950), not five separate per-describe extracts, so `normalizeSetup`, `runNormalizeDrag`, and `resizeSetup` (declared in gaps between this group's own describes, used only within this group) come along automatically | unit-01 | same pattern (contiguous range, not per-describe) | full 3-command block |
| unit-09 | Move describe: production diagnostics -> `controller-production-diagnostics.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-10 | Move describes: binding profile catalog; shortcut registration; focus-writer seam -> `controller-bindings-and-shortcuts.test.ts`; extract **only through the last describe's closing brace** (ends before line 8002) - do not relocate the following 8002-8169 cluster into this target; it is split between fixtures (unit-01), file 10 (unit-11), and file 12 (unit-13), and retained copies are deleted only when orphaned | unit-01 | same pattern | full 3-command block |
| unit-11 | Move describes: parseTilingAlgorithm; parseAutomaticSplitTarget; parseDropOutlinePreview; selectAutomaticSplitTarget; ensureTrailingEmptyDesktop; tiling algorithm takeover -> `controller-pure-config-functions.test.ts`; also relocate `takeoverTilingSetup` (~8169) by name from the 8002-8169 cluster; do not relocate its other declarations into this target, but delete any retained source copy that is orphaned (the rest is fixtures-bound except `installInlineMutatingRejectingSplitter`, which goes to unit-13) | unit-01 | same pattern, plus 1 named declaration | full 3-command block |
| unit-12 | Move describe: automatic dwindle ownership (1,908 lines; single describe, over threshold, largest in the file, disclosed in spec) -> `controller-automatic-dwindle-ownership.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-13 | Move describes: automatic dwindle insertion preflight; automatic split target insertion -> `controller-automatic-dwindle-insertion.test.ts`; also relocate `installInlineMutatingRejectingSplitter` (~8061) by name from the 8002-8169 cluster | unit-01 | same pattern, plus 1 named declaration | full 3-command block |
| unit-14 | Move describes: deferred invariant recovery; fullscreen passthrough -> `controller-deferred-recovery-and-fullscreen.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-15 | Move describe: floating and sticky windows -> `controller-floating-and-sticky.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-16 | Move describe: dynamic virtual desktops (1,392 lines; single describe, over threshold, disclosed in spec; contains locally-scoped `ownTrailingEmpty`-consuming logic - verify `ownTrailingEmpty` import from fixtures is included) -> `controller-dynamic-virtual-desktops.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-17 | Move describe: per-workspace maximize -> `controller-per-workspace-maximize.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-18 | Move describe: workspace mode and per-output seams (Unit 04); verify local helper `ownTrailingEmpty` import from fixtures is included -> `controller-workspace-mode-seams.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-19 | Move describe: per-output-local workspaces (Unit 05) (contains its own locally-scoped `twoOutputSetup`/`moveToTrailing` - these travel with the block untouched, not part of fixtures) -> `controller-per-output-workspaces.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-20 | Move describe: global-unique workspaces (Unit 06) (contains its own locally-scoped `globalUniqueSetup` - travels with the block untouched) -> `controller-global-unique-workspaces.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-21 | Move describes: shared workspaces (Unit 07); trailing-empty invariant on first occupation (Unit 07 live regression) -> `controller-shared-workspaces.test.ts`; relocate the eight drained-source comment blocks verbatim above their owning declarations and delete `controller.test.ts` | unit-01 | same pattern plus drained-source deletion | full 3-command block; exactly 924 tests, 81 suites, 0 fail, 81 describes |
| unit-23 safe subset | Remediate `controller-fixtures.ts` (1,332) by export cluster and `controller-drag-diagnostics-and-resize.test.ts` (1,004) by moving whole top-level `describe` blocks. Workers only apply boundaries pre-decided in `spec.md`. These operations are count-neutral: fixture modules have no describes and whole-describe moves retain the total of 81. Stop and escalate if a candidate changes exactly 924 tests, 81 suites, 0 failures, or 81 describes. | unit-21 | `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`, `kwin/tests/controller-fixtures.ts`, derived target test files, and approved docs only | full 3-command block; exact counts are invariant |
| unit-23 parked subset | Do not implement remediation for `controller-automatic-dwindle-ownership.test.ts` (1,930), `controller-interactive-drag.test.ts` (1,275), or `controller-dynamic-virtual-desktops.test.ts` (1,414). Each contains one top-level `describe` that alone exceeds ~1,000 lines, so a describe-boundary-preserving split cannot meet the threshold. | user decision | no implementation scope | parked pending the documented user decision |
| unit-22 | Final cleanup: run the full acceptance gate after unit-23 remediation (3-command block plus `git diff --stat -- kwin/contents/code/main.js` must be empty, plus a diff of sorted `it(`/`describe(` string literals before (from git history) and after confirming no name changed). Unit-21 owns deletion of the drained `kwin/tests/controller.test.ts`; this unit does not delete it. | unit-02 .. unit-21, unit-23 | final acceptance verification | full 3-command block + `main.js` diff check + test-name diff check |

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
- [x] unit-05 selected overlay state
- [x] unit-06 selected overlay reflow
- [x] unit-07 interactive drag
- [x] unit-08 drag diagnostics and resize
- [x] unit-09 production diagnostics
- [x] unit-10 bindings and shortcuts
- [x] unit-11 pure config functions
- [x] unit-12 automatic dwindle ownership
- [x] unit-13 automatic dwindle insertion
- [x] unit-14 deferred recovery and fullscreen
- [x] unit-15 floating and sticky
- [x] unit-16 dynamic virtual desktops
- [x] unit-17 per-workspace maximize
- [x] unit-18 workspace mode seams
- [x] unit-19 per-output workspaces
- [x] unit-20 global-unique workspaces
- [x] unit-21 shared workspaces
- [ ] unit-23 safe subset over-threshold remediation
- [ ] unit-23 parked subset user decision
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
- unit-05/attempt-01: **accepted**. The `selected overlay state` describe
  moved verbatim into `controller-selected-overlay-state.test.ts`; the
  following `attachTileWriter` fixture-bound helper remained in the retained
  file. Source search showed `presetSetup`, `configureThreeOccupantPreset`,
  `invokeShortcut`, and `currentScopeFor` retain consumers in selected overlay
  reflow, so no source-preamble pruning was justified or performed. `npm run
  typecheck`, `npm test` (924 tests, 81 suites, 924 pass, 0 fail), and the
  describe count (81) all passed.
- unit-06/attempt-01: **accepted**. The `selected overlay reflow` describe
  moved verbatim into `controller-selected-overlay-reflow.test.ts`; the
  preceding `attachTileWriter` and following 4520-4813 helper cluster remained
  in the retained file. Source search showed all candidate preamble symbols
  retain later consumers, so no source-preamble pruning was justified or
  performed. `npm run typecheck`, `npm test` (924 tests, 81 suites, 924 pass,
  0 fail), and the describe count (81) all passed.
- unit-07/attempt-01: **blocked**. The interactive drag describe and named
  `rowsDropSetup` and `assertLeafPartition` helpers moved verbatim, and search
  confirmed neither has a retained consumer. The remaining source copy of the
  fixtures-bound `collectLeaves` helper is now orphaned, causing TS6133. The
  unit brief prohibited deleting any other 4520-4813 declaration, while the
  Technical Approach says such clusters remain only until their last local
  consumer moves. Diff preserved; no acceptance, commit, or push.
- unit-07/attempt-02: **accepted**. Under the Orchestrator-approved retained-
  source reconciliation, search and TS6133 proved the fixtures-bound
  `collectLeaves` source copy orphaned, so it was removed while its fixture
  export remained. The interactive drag describe plus `rowsDropSetup` and
  `assertLeafPartition` moved verbatim; `MAX_SEQUENTIAL_LENGTH`, `Point`, and
  `qv4MethodSignal` were the only other search-proven orphaned source symbols
  pruned. `npm run typecheck`, `npm test` (924 tests, 81 suites, 924 pass, 0
  fail), and the describe count (81) all passed.
- unit-08/attempt-01: **accepted**. The contiguous range from `drag snapshot
  diagnostics` through `bspwm direct resize bindings` moved verbatim into
  `controller-drag-diagnostics-and-resize.test.ts`, carrying `normalizeSetup`,
  `runNormalizeDrag`, and `resizeSetup` unchanged. Search proved
  `setFullscreen`, `setSticky`, `setMaximized`, and `nativeDropSetup` had no
  retained consumers, so only those declarations were pruned. `npm run
  typecheck`, `npm test` (924 tests, 81 suites, 924 pass, 0 fail), and the
  describe count (81) all passed.
- unit-09/attempt-01: **accepted**. The `production diagnostics` describe
  moved verbatim into `controller-production-diagnostics.test.ts`. Search
  proved `movedGeometry` had no retained consumer, so it was the only source
  declaration pruned. `dragSetup` and `startDrag` retain consumers. `npm run
  typecheck`, `npm test` (924 tests, 81 suites, 924 pass, 0 fail), and the
  describe count (81) all passed.
- unit-10/attempt-01: **accepted**. The `binding profile catalog`, `shortcut
  registration`, and `focus-writer seam` describes moved verbatim into
  `controller-bindings-and-shortcuts.test.ts`, ending before the 8002-8169
  helper cluster. Search proved `readFileSync`, `PROFILE_CATALOGS`,
  `REGISTERED_PROFILE_ACTION_IDS`, `ShortcutOverrides`,
  `catalogValidationDiagnostics`, `validateProfile`, `resolveSequence`,
  `selectProfile`, `ProfileCatalog`, and `RowClassification` have no retained
  source consumers, so only those imports were pruned. `npm run typecheck`,
  `npm test` (924 tests, 81 suites, 924 pass, 0 fail), and the describe count
  (81) all passed.
- unit-11/attempt-01: **blocked**, no changes. The approved named
  `takeoverTilingSetup` helper's original approximately 8,169 line location was
  stale after prior extractions; it was found at the current source lines
  1,182-1,228. The Worker stopped at that mismatch rather than deriving a new
  boundary.
- unit-11/attempt-02: **accepted**. The `parseTilingAlgorithm`,
  `parseAutomaticSplitTarget`, `parseDropOutlinePreview`,
  `selectAutomaticSplitTarget`, `ensureTrailingEmptyDesktop`, and `tiling
  algorithm takeover` describes moved verbatim into
  `controller-pure-config-functions.test.ts`, together with the approved named
  `takeoverTilingSetup` helper from its reconciled current location. Search
  proved the moved direct-source imports and the fixture-duplicated
  `assertPresetShape` had no retained consumers, so only those source copies
  were pruned. `npm run typecheck`, `npm test` (924 tests, 81 suites, 924 pass,
  0 fail), and the describe count (81) all passed.
- unit-11: attempts 2; correction rounds 1; independent reviews 0.
- unit-12/attempt-01: **accepted**. The `automatic dwindle ownership` describe
  moved verbatim into `controller-automatic-dwindle-ownership.test.ts` as one
  oversized describe. Search proved `buildDwindleBlueprint`, `Blueprint`,
  `CurrentScope`, `presetSetup`, `configureThreeOccupantPreset`,
  `currentScopeFor`, `assertDwindleShape`, and `installStaleReturnSplitter`
  have no retained consumers, so only those source copies were pruned.
   `installCapacityRejectingSplitter` retains source consumers. `npm run
   typecheck`, `npm test` (924 tests, 81 suites, 924 pass, 0 fail), and the
   describe count (81) all passed.
- unit-13/attempt-01: **accepted**. The `automatic dwindle insertion
  preflight` and `automatic split target insertion` describes moved verbatim
  into `controller-automatic-dwindle-insertion.test.ts`, together with the
  approved named `installInlineMutatingRejectingSplitter` helper. Search proved
  `AUTOMATIC_SPLIT_TARGET_CONFIG_KEY` has no retained source consumer, so only
  that source import was pruned; `makeTile` and `installDwindleSplitter` retain
  source consumers. `npm run typecheck`, `npm test` (924 tests, 81 suites, 924
  pass, 0 fail), and the describe count (81) all passed.
- unit-14/attempt-01: **accepted**. The `deferred invariant recovery` and
  `fullscreen passthrough` describes moved verbatim into
  `controller-deferred-recovery-and-fullscreen.test.ts`. Search proved
  `DROP_OUTLINE_PREVIEW_CONFIG_KEY`, `moveSetup`, `swapSetup`, `dragSetup`,
  `startDrag`, `reconstructDropSetup`, and `installCapacityRejectingSplitter`
  have no retained source consumers, so only those source copies were pruned.
  `npm run typecheck`, `npm test` (924 tests, 81 suites, 924 pass, 0 fail), and
  the describe count (81) all passed.
- unit-15/attempt-01: **accepted**. The `floating and sticky windows` describe
  moved verbatim into `controller-floating-and-sticky.test.ts`. Source search
  confirmed its base helpers and imports retain consumers in
  `controller.test.ts`, so no retained-source pruning was justified. `npm run
  typecheck`, `npm test` (924 tests, 81 suites, 924 pass, 0 fail), and the
  describe count (81) all passed.
- unit-16/attempt-01: **accepted**. The `dynamic virtual desktops` describe
  moved verbatim into `controller-dynamic-virtual-desktops.test.ts`.
  `ownTrailingEmpty` is imported from fixtures as required. Search proved
  `prepareExcessOwnedEmpty`, `modeCleanupSetup`,
  `configureSwitchCleanupScenario`, and `ownCleanupDesktops` have no retained
  source consumers, so only those duplicate source helpers were pruned. The
  moved 1,391-line body byte-matches its `HEAD` source boundary. `npm run
  typecheck`, `npm test` (924 tests, 81 suites, 924 pass, 0 fail), and the
  describe count (81) all passed.
- unit-17/attempt-01: **accepted**. The `per-workspace maximize` describe
  moved verbatim into `controller-per-workspace-maximize.test.ts`. Search
  proved `attachTileWriter`, `installDwindleSplitter`, and `makeTile` have no
  retained source consumers, so only those duplicate source helpers were
  pruned. The moved 792-line body byte-matches its `HEAD` source boundary.
  `npm run typecheck`, `npm test` (924 tests, 81 suites, 924 pass, 0 fail), and
  the describe count (81) all passed.
- unit-18/attempt-01: **accepted**. The `workspace mode and per-output seams
  (Unit 04)` describe moved verbatim into
  `controller-workspace-mode-seams.test.ts`; `ownTrailingEmpty` is imported
  from fixtures as required. Search proved `DEFAULT_WORKSPACE_MODE`,
  `SessionOutputKeys`, `WORKSPACE_MODES`, `outputTuple`, `parseWorkspaceMode`,
  and `ownTrailingEmpty` have no retained source consumers, so only those
  duplicate source imports and helper were pruned. The moved 333-line body
  byte-matches its `HEAD` source boundary. `npm run typecheck`, `npm test` (924
  tests, 81 suites, 924 pass, 0 fail), and the describe count (81) all passed.
- unit-19/attempt-01: **accepted**. The `per-output-local workspaces (Unit
  05)` describe, including its describe-local `twoOutputSetup` and
  `moveToTrailing` helpers, moved verbatim into
  `controller-per-output-workspaces.test.ts`. Search proved `setup` had no
  remaining source consumer, so only that duplicate source helper was pruned.
  Lead review confirmed the source deletion and target content; `npm run
  typecheck`, `npm test` (924 tests, 81 suites, 924 pass, 0 fail), and the
  describe count (81) all passed.
- unit-20/attempt-01: **accepted**. The `global-unique workspaces (Unit 06)`
  describe, including its describe-local `globalUniqueSetup` helper, moved
  verbatim into `controller-global-unique-workspaces.test.ts`. Source search
  confirmed all candidate dependencies retain consumers in the remaining shared
  workspace and regression describes, so no retained-source pruning was
  justified. Lead review confirmed the source deletion and target content;
  `npm run typecheck`, `npm test` (924 tests, 81 suites, 924 pass, 0 fail),
  and the describe count (81) all passed.
- unit-21 prior scope attempt: **reset by Orchestrator-approved scope change**.
  The verbatim move left a 67-line comment-only source file; Node counted that
  file as one file-level test, producing 925 tests/pass. The diagnosis is not a
  move defect, and the reset adds deletion of the drained source file to
  unit-21 to restore the unchanged 924/81/0/81 acceptance invariant.
- unit-21/attempt-01: **blocked by circuit breaker**. Before deleting the
  drained file, the Worker classified its comments as durable fixture/test
  rationale. Six blocks map to fixture exports, but `rowsDropSetup` and
  `singleDesktopModeSetup` are target-local helpers rather than fixture
  exports. The one authorized correction round stopped on that destination
  ambiguity without changing files. Attempts 1; correction rounds 1;
  independent reviews 0.
- unit-21/attempt-02: **accepted** under the Orchestrator's scope reset. All
  eight comment blocks were preserved verbatim immediately above their owning
  declarations: `swapSetup`, `attachTileWriter`, `reconstructDropSetup`,
  `installDwindleSplitter`, `installCapacityRejectingSplitter`, and
  `installStaleReturnSplitter` in `controller-fixtures.ts`; `rowsDropSetup` in
  `controller-interactive-drag.test.ts`; and `singleDesktopModeSetup` in
  `controller-shared-workspaces.test.ts`. The drained source file was deleted.
  Lead re-gate: `npm test` 924 tests, 81 suites, 924 pass, 0 fail; 81
  describes; both typecheck tsconfigs passed. Attempts 2; correction rounds 1;
  independent reviews 0.

## Pending User Decisions

- **Parked unit-23 threshold decision.** The safe subset may proceed after its
  boundaries are pre-decided: `controller-fixtures.ts` (1,332 lines) by export
  cluster and `controller-drag-diagnostics-and-resize.test.ts` (1,004 lines) by
  whole top-level `describe`. The parked subset is
  `controller-automatic-dwindle-ownership.test.ts` (1,930 lines),
  `controller-interactive-drag.test.ts` (1,275 lines), and
  `controller-dynamic-virtual-desktops.test.ts` (1,414 lines). Each has one
  top-level `describe` that alone exceeds ~1,000 lines, so preserving describe
  boundaries cannot meet the threshold. User options: allow intra-describe
  splitting with a re-grounded count invariant; accept these files over
  threshold as documented exceptions; or choose another resolution. No parked
  subset implementation may begin. Because this is an acceptance gap, unit-22
  completion/archive work remains prohibited.

The previously blocking module-scope and source-preamble decisions below are
resolved.

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
| `grep -c "describe("` totals 81 | units 02-21 passed; Lead rechecked after unit-21 |
| `npm test`: 924/81/924 pass/0 fail | units 02-21 passed; Lead rechecked after unit-21 |
| `npm run typecheck` clean on both tsconfigs | units 02-21 passed; Lead rechecked after unit-21 |
| `main.js` byte-identical | pending - checked in unit-22 (also true trivially after every unit, since `src/` is never touched) |
| No test name changed | pending - checked in unit-22 via sorted-literal diff |
| No describe split, reordered, or renested | pending - by construction (units move whole, named describes; no unit edits describe/it syntax) |
| Only `kwin/tests/controller*.ts` and `docs/` change | pending - checked in unit-22 via `git diff --stat` |

## Residual Risks

- The unit-23 safe subset remains unimplemented: `controller-fixtures.ts`
  (1,332) and `controller-drag-diagnostics-and-resize.test.ts` (1,004) need
  pre-decided boundaries before a Worker can apply them.
- The unit-23 parked subset is an open acceptance gap:
  `controller-automatic-dwindle-ownership.test.ts` (1,930),
  `controller-interactive-drag.test.ts` (1,275), and
  `controller-dynamic-virtual-desktops.test.ts` (1,414) cannot meet the
  threshold while preserving their single top-level describes. Unit-22 and
  completion/archive work remain blocked pending the user decision.
- Grep-based import pruning could theoretically under- or over-prune on an
  edge case (e.g. a name matching inside a string literal or comment rather
  than a real reference); the `npm run typecheck` step in every unit is the
  designed catch for this, so the risk is caught immediately, not silently.
- `controller.test.ts` was deleted by unit-21 after its eight orphaned comments
  were relocated verbatim; unit-22 does not own further source-file cleanup.

## Final Outcome

- Pending. This session: corrected `spec.md`'s Shared State analysis to the
  whole file (Orchestrator-authorized), revised `plan.md` accordingly, and
  completed units 01-21. Unit-23's safe subset remains unexecuted pending
  boundary recording; its parked subset blocks unit-22 final cleanup and
  completion/archive pending a user decision.
