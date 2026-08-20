# Log: Split `kwin/tests/controller.test.ts`

Append-only. Append after a meaningful checkpoint: an accepted semantic unit,
verified partial result, blocker, pending user decision, unsuccessful host
attempt, context handover, semantic or governance change, independent review
finding, commit, or approved plan change. Each entry records timestamp, role
and work unit and attempt, result, changed files or commit, verification, and
any discovery, blocker, or required decision. No narration, copied output, or
speculation.

## 2026-08-20 (session start)

- Role / unit: Lead / investigation and specification (no work unit yet)
- Result: `spec.md` and `plan.md` produced and self-approved under
  autonomous mode (dispatch brief explicitly authorized creating these
  files); no implementation performed - hard constraint for this session
  forbade spawning subagents and moving any test code.
- Files / commit: `docs/changes/controller-test-split/{spec.md,plan.md,log.md}`
  created (untracked, not staged).
- Verification: baseline `npm test` run live at HEAD `ecbf5ef` inside
  `kwin/` confirmed `tests 838`, `suites 78`, `pass 838`, `fail 0`;
  `grep -c "describe(" kwin/tests/*.test.ts` totals 78, confirming no
  nested `describe`s exist anywhere in the suite. No module-level mutable
  state found in `controller.test.ts`'s preamble (`grep -n "^let \|^var
  \|static "` over lines 1-1015 returns nothing).
- Notes: 40 top-level `describe`s enumerated with exact line ranges (see
  `spec.md` Target File Set); grouped into 20 target files + 1 shared
  fixture module (`controller-fixtures.ts`). Three files (interactive drag,
  automatic dwindle ownership, dynamic virtual desktops) remain over the
  1,000-line threshold because each is a single oversized `describe` that
  cannot be split without adding new suite boundaries - disclosed as
  accepted in `spec.md`, not resolved. No pending user decision recorded.
  Next action: dispatch unit-01 (create `controller-fixtures.ts`) in a
  future session/Lead stint.

## 2026-08-20 (unit-01/attempt-01)

- Role / unit: Lead / unit-01 (create `controller-fixtures.ts`), executed
  directly per plan.md's sizing note (no subagent needed for a `sed`
  line-range copy).
- Result: blocked, not accepted. Copied `controller.test.ts` lines 1-1015
  verbatim to new `kwin/tests/controller-fixtures.ts`, added `export ` to
  all 31 top-level `const`/`interface`/`function`/`class` declarations in
  that range (confirmed by line-targeted `sed`, one insertion per confirmed
  declaration line, matches spec's enumerated count of 3+5+7+1+15=31).
  `npm run typecheck` then surfaced `TS2304: Cannot find name
  'attachTileWriter'` at two call sites inside `configureThreeOccupantPreset`
  (a preamble helper). Investigation traced this to a spec gap: at least 20
  more top-level (module-scope) helper functions exist later in the file
  (lines 4112-8169) that the spec's Shared State section never analyzed
  because it scoped its search to lines 1-1015 only. Two of them
  (`attachTileWriter`, `countEvent`) were confirmed by direct line-span
  evidence to be referenced across most or all of the 20 target files, on
  the same "must be shared" footing as the helpers the spec did enumerate;
  several more show cross-file-boundary usage on a first-pass check but were
  not exhaustively verified. Full details and impact recorded in
  `plan.md`'s new Pending User Decisions entry.
- Files / commit: `kwin/tests/controller-fixtures.ts` created, untracked,
  not staged - WIP evidence only, not typecheck-clean, not to be built upon
  until the Shared State section is corrected. `kwin/tests/controller.test.ts`
  untouched (confirmed via `git status --short` / `git diff --stat`: zero
  unstaged changes to any tracked file).
- Verification: `npm run typecheck` run, failed as described (not the
  acceptance gate - unit-01 was still investigation-in-progress when the
  finding surfaced).
- Notes: judged this discovery to exceed the Lead's existing delegated
  authority (spec.md's Unresolved Questions permits adjusting the Target
  File Set *grouping*, not correcting the Shared State *analysis* the
  grouping and fixture design are built on) - stopped rather than
  unilaterally expanding `controller-fixtures.ts`'s scope. No further unit
  dispatched. Returning `handover` to Orchestrator with this as a blocking
  Pending User Decision, not a routine threshold handover.

## 2026-08-20 (spec correction, Orchestrator-authorized)

- Role / unit: Lead / specification correction (no work unit executed
  directly; Orchestrator explicitly authorized a full cross-reference
  analysis and correction of `spec.md`/`plan.md`, framed as a specification
  correction, not a governance change).
- Result: analysis complete. Enumerated all 52 top-level (column-zero)
  declarations in `controller.test.ts` (`grep -n` anchored patterns for
  `function`/`const`/`let`/`var`/`class`/`interface`/`type`/`enum`; also
  checked for `export`/`enum`/`namespace`/`declare` at top level, zero
  found beyond the known 52) - 31 already documented in the preamble
  (lines 1-1015, unchanged from original spec), 21 more in three physical
  clusters (line 4112; lines 4520-4813; lines 6359-6479 inside an existing
  multi-describe target file's own span; lines 8002-8169). Bucketed every
  reference of all 21 by which of the 20 target-file line ranges it falls
  in, using a single awk-aggregated script (no raw line dumps consumed).
  Checked the internal call graph among the 21 for calls from a
  fixtures-bound declaration into a single-file-local one (would force
  promotion) - found one: `makeTile` (0 direct describe call sites, called
  only from inside `installDwindleSplitter`/`installCapacityRejectingSplitter`/
  `installStaleReturnSplitter`, all three already fixtures-bound) - promoted
  to fixtures. Re-ran the module-level mutable-state check
  (`grep -n "^let \|^var "`) against the whole 17,075-line file, not just
  lines 1-1015 as the original check scoped it: zero matches; the two
  whole-file `static ` hits are both inside comments. Extraction remains
  behaviorally safe.
- Files / commit: `docs/changes/controller-test-split/spec.md` (Shared
  State section rewritten with the full 52-declaration classification
  table and corrected fixture size estimate ~1,340 lines; Target File Set
  section annotated with the 4 target files needing named, non-contiguous
  relocation, and the 1 file needing a converse "describe body only, not
  the cluster" caution; Consequential Decisions appended) and `plan.md`
  (Technical Approach rewritten; units 01, 05, 06, 07, 08, 10, 11, 13, 22
  updated with the specific named-declaration relocations or contiguous-
  range requirements each now needs; Pending User Decision marked
  resolved) edited directly by the Lead (plan record-keeping and an
  Orchestrator-authorized spec correction, no separate approval round
  needed per governance). No test code touched.
  `kwin/tests/controller-fixtures.ts` (the untracked, not-yet-typecheck-
  clean WIP file from unit-01/attempt-01) left as-is pending unit-01's
  next attempt under the corrected scope.
- Verification: no runtime verification applicable to a documentation-only
  correction; the correctness of the classification itself was
  cross-checked twice (external-reference bucketing, then internal call-
  graph promotion check) before being written into `spec.md`.
- Notes: Target File Set *grouping* (which `describe` lands in which file)
  is unchanged - only the shared-declaration classification and the
  physical extraction mechanics for 5 of the 20 files (5, 6, 7, 10, 12)
  changed. No new governance conflict. Next action: attempt unit-01 under
  the corrected scope (dispatch to a `worker-anthropic`   Worker, since it is
  a large mechanical multi-location extraction well suited for delegation
  with Lead diff/typecheck verification after).

## 2026-08-20 (unit-01/attempt-02)

- Role / unit: Lead / unit-01 (create `controller-fixtures.ts`, corrected
  scope), dispatched to a `worker-anthropic` Worker per the Technical
  Approach's sizing note (large mechanical multi-location extraction).
- Result: accepted. `kwin/tests/controller-fixtures.ts` now contains the 31
  preamble declarations plus the 14 corrected cross-boundary declarations
  (45 total exports), pruned imports, 1,332 lines.
- Files / commit: `kwin/tests/controller-fixtures.ts` staged (`git add`,
  explicit path). `kwin/tests/controller.test.ts` untouched (confirmed
  empty `git diff --stat`/`git status --short` scoped to that path).
- Verification: Lead ran directly (not solely trusting the Worker's
  report): `grep -n '^export '` -> 45 matches, names and order match the
  corrected Shared State list exactly; grep for the 7 excluded single-
  file-local names -> zero matches; `wc -l` -> 1,332; `npm run typecheck`
  (both tsconfigs) -> zero errors.
- Notes: unit-01 complete. Units 02-22 (all describe moves and the 4 named
  single-file-local relocations into files 6, 7, 10, 12) remain for a
  future Lead stint - each is independently dispatchable per the Technical
  Approach's per-unit table.

## 2026-08-20 (reconciliation and baseline correction)

- Role / unit: Lead / reconciliation (no test-file split unit executed).
- Result: verified `0cf9982` contains the accepted unit-01 fixture: 1,332
  lines and exactly 45 exports, comprising the 31 preamble declarations and
  the 14 fixtures-bound later declarations. `controller.test.ts` remains
  unchanged. The committed Shared State correction fully accounts for all 21
  later top-level helpers: 14 move to fixtures and 7 remain single-file-local;
  this does not alter the 20-file describe grouping or fixture strategy.
- Files / commit: `spec.md`, `plan.md`, and `log.md` updated to replace stale
  current-gate references to 838 tests / 78 suites with 924 tests / 81 suites;
  historical 838/78 baseline evidence is retained. The empty untracked
  `docs/changes/cosmic-move-model-closure/` directory was removed.
- Verification: `npm --prefix kwin run typecheck` passed; `npm --prefix kwin
  test` reported 924 tests, 81 suites, 924 pass, and 0 fail.

## 2026-08-20 (unit-02/attempt-01)

- Role / unit: Lead / unit-02 (keyboard placement extraction), Worker
  attempt-01.
- Result: blocked pending a plan decision. The Worker moved exactly source
  lines 1016-1858 into `controller-keyboard-placement.test.ts`; independent
  byte comparison confirmed the three describe bodies are verbatim. The new
  file has 867 lines with pruned imports and needs no unplanned helper
  relocation.
- Files / commit: uncommitted WIP in `kwin/tests/controller.test.ts` and new
  `kwin/tests/controller-keyboard-placement.test.ts`; `plan.md` records the
  contradiction. No commit or push because the unit is unaccepted.
- Verification: `npm --prefix kwin run typecheck` fails only with TS6133 for
  now-unused source-preamble `DIRECTIONS`, `Direction`, and `focusSetup`.
  The Technical Approach requires that preamble remain unmodified until final
  cleanup, so the required cleanup is outside the approved unit scope. Full
  test gate not run after the failed typecheck.

## 2026-08-20 (unit-02/attempt-02)

- Role / unit: Lead / unit-02 (keyboard placement extraction), resumed
  Worker attempt-02 after the Orchestrator-approved Technical Approach
  amendment.
- Result: accepted. `controller-keyboard-placement.test.ts` contains the
  verbatim original lines 1016-1858 (865 lines, excluding the non-semantic
  trailing blank line). Source search proved the
  original `DIRECTIONS`, `Direction`, and `focusSetup` had no remaining local
  consumers, so only those two import specifiers and the 33-line duplicate
  helper were pruned from `controller.test.ts`; no helper relocation or test
  body edit occurred.
- Files / commit: `kwin/tests/controller-keyboard-placement.test.ts` added;
  `kwin/tests/controller.test.ts` reduced to 16,199 lines; `plan.md` and
  `log.md` updated in the unit commit.
- Verification: `npm --prefix kwin run typecheck` passed; `npm --prefix kwin
  test` reported 924 tests, 81 suites, 924 pass, and 0 fail; describe count
  was 81.

## 2026-08-20 (unit-03/attempt-01)

- Role / unit: Lead / unit-03 (keyboard move and swap extraction), Worker
  attempt-01.
- Result: accepted. `controller-keyboard-move-and-swap.test.ts` contains the
  verbatim original source lines 983-1938 (979 lines). Source search proved
  `moveSetup` and `swapSetup` still have later local consumers, so no source
  preamble pruning or helper relocation occurred and no test body was edited.
- Files / commit: `kwin/tests/controller-keyboard-move-and-swap.test.ts`
  added; `kwin/tests/controller.test.ts` reduced to 15,243 lines; `plan.md`
  and `log.md` updated in the unit commit.
- Verification: `npm --prefix kwin run typecheck` passed; `npm --prefix kwin
  test` reported 924 tests, 81 suites, 924 pass, and 0 fail; describe count
  was 81.

## 2026-08-20 (unit-04/attempt-01)

- Role / unit: Lead / unit-04 (tile attach and scope extraction), Worker
  attempt-01.
- Result: accepted. `controller-tile-attach-and-scope.test.ts` contains the
  verbatim original source lines 983-1908 (949 lines). Source search proved
  `attachSetup` and `fillSetup` had no remaining local consumers, so only
  those duplicate helpers were pruned; `currentScopeFor` and `invokeShortcut`
  retain consumers. No helper relocation or test body edit occurred.
- Files / commit: `kwin/tests/controller-tile-attach-and-scope.test.ts`
  added; `kwin/tests/controller.test.ts` reduced to 14,239 lines; `plan.md`
  and `log.md` updated in the unit commit.
- Verification: `npm --prefix kwin run typecheck` passed; `npm --prefix kwin
  test` reported 924 tests, 81 suites, 924 pass, and 0 fail; describe count
  was 81.

## 2026-08-20 (unit-05/attempt-01)

- Role / unit: Lead / unit-05 (selected overlay state extraction), Worker
  attempt-01.
- Result: accepted. `controller-selected-overlay-state.test.ts` contains the
  verbatim `selected overlay state` describe body; `attachTileWriter` remains
  in `controller.test.ts` as required. Source search showed `presetSetup`,
  `configureThreeOccupantPreset`, `invokeShortcut`, and `currentScopeFor`
  retain local consumers in selected overlay reflow, so no source-preamble
  pruning was justified or performed.
- Files / commit: `kwin/tests/controller-selected-overlay-state.test.ts`
  added; `kwin/tests/controller.test.ts` reduced to 13,873 lines; `plan.md`
  and `log.md` updated in the unit commit.
- Verification: Lead inspected the actual diff and new-file body; it is a pure
  describe move with import scaffolding only. `npm --prefix kwin run typecheck`
  passed; `npm --prefix kwin test` reported 924 tests, 81 suites, 924 pass,
  and 0 fail; describe count was 81.

## 2026-08-20 (unit-06/attempt-01)

- Role / unit: Lead / unit-06 (selected overlay reflow extraction), Worker
  attempt-01.
- Result: accepted. `controller-selected-overlay-reflow.test.ts` contains the
  verbatim `selected overlay reflow` describe body. `attachTileWriter` and the
  following 4520-4813 helper cluster remain in `controller.test.ts` as
  required. Source search proved all candidate preamble symbols retain local
  consumers, so no source-preamble pruning was justified or performed.
- Files / commit: `kwin/tests/controller-selected-overlay-reflow.test.ts`
  added; `kwin/tests/controller.test.ts` reduced to 13,490 lines; `plan.md`
  and `log.md` updated in the unit commit.
- Verification: Lead inspected the actual diff and new-file body; it is a pure
  describe move with import scaffolding only. `npm --prefix kwin run typecheck`
  passed; `npm --prefix kwin test` reported 924 tests, 81 suites, 924 pass,
  and 0 fail; describe count was 81.

## 2026-08-20 (unit-07/attempt-01)

- Role / unit: Lead / unit-07 (interactive drag extraction), Worker
  attempt-01.
- Result: blocked, unaccepted. The working diff moves the complete interactive
  drag describe plus the two approved file-local helpers, `rowsDropSetup` and
  `assertLeafPartition`, into `controller-interactive-drag.test.ts`; source
  search found zero retained consumers of both helpers. The test and describe
  gates hold, but the retained fixtures-bound `collectLeaves` declaration is
  now unused.
- Files / commit: uncommitted WIP in `kwin/tests/controller.test.ts` and
  `kwin/tests/controller-interactive-drag.test.ts`; `plan.md` and `log.md`
  record the blocker. No commit or push.
- Verification: Lead inspected the actual diff and confirmed the named helper
  relocation and verbatim describe move. `npm --prefix kwin run typecheck`
  fails only with `TS6133` for `collectLeaves` at
  `tests/controller.test.ts:1028`; `npm test` reported 924 tests, 81 suites,
  924 pass, and 0 fail; describe count was 81; `main.js` has no diff.
- Decision needed: reconcile the unit-specific prohibition on deleting the
  other 4520-4813 declarations with the Technical Approach's instruction to
  retain that cluster only until each declaration's last local consumer moves.
  The current diff is preserved for the successor Lead.

## 2026-08-20 (retained-source reconciliation)

- Role / unit: Lead / specification and plan correction (Orchestrator-authorized)
- Result: approved systemic reconciliation applied before resuming unit-07.
  The last-local-consumer rule now explicitly governs every retained source
  import and declaration, including fixtures-bound duplicates in later helper
  clusters. `collectLeaves` is authorized for removal from the retained source
  once search and TS6133 prove it orphaned; its fixture export remains.
- Audit: no remaining rule constrained scope, describe boundaries, target-file
  count, or fixture strategy. One general source-preamble-only phrase and the
  unit-05, unit-06, unit-07, unit-10, and unit-11 cluster-exclusion rules were
  stale because they could preserve orphaned source copies. They now prohibit
  relocation into the specified target only; each retained copy is deleted when
  its last local consumer moves.
- Files / commit: `spec.md`, `plan.md`, and `log.md` updated in the pending
  unit-07 commit. No test body or production code changed.

## 2026-08-20 (unit-07/attempt-02)

- Role / unit: Lead / unit-07 (interactive drag extraction), Worker
  attempt-02 under the Orchestrator-approved retained-source reconciliation.
- Result: accepted. Search found no retained consumers of `collectLeaves`; its
  retained 10-line source declaration was deleted while its fixture export
  remains for the new test file. The interactive drag describe and named
  `rowsDropSetup` and `assertLeafPartition` helper moves remain verbatim;
  `MAX_SEQUENTIAL_LENGTH`, `Point`, and `qv4MethodSignal` are the only other
  search-proven orphaned source symbols pruned.
- Files / commit: `kwin/tests/controller-interactive-drag.test.ts` added;
  `kwin/tests/controller.test.ts` reduced to 12,219 lines; `spec.md`,
  `plan.md`, and `log.md` updated in the unit commit.
- Verification: Lead inspected the preserved actual diff and final orphan
  deletion. `npm --prefix kwin run typecheck` passed; `npm --prefix kwin test`
  reported 924 tests, 81 suites, 924 pass, and 0 fail; describe count was 81.

## 2026-08-20 (unit-08/attempt-01)

- Role / unit: Lead / unit-08 (drag diagnostics and resize extraction), Worker
  attempt-01.
- Result: accepted. The contiguous range from `drag snapshot diagnostics`
  through `bspwm direct resize bindings` moved verbatim, including the in-range
  `normalizeSetup`, `runNormalizeDrag`, and `resizeSetup` helpers. Search
  proved `setFullscreen`, `setSticky`, `setMaximized`, and `nativeDropSetup`
  have no retained consumers, so only those declarations were pruned.
- Files / commit: `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`
  added; `kwin/tests/controller.test.ts` reduced to 11,149 lines; `plan.md`
  and `log.md` updated in the unit commit.
- Verification: Lead inspected the actual diff and new-file body. `npm
  --prefix kwin run typecheck` passed; `npm --prefix kwin test` reported 924
  tests, 81 suites, 924 pass, and 0 fail; describe count was 81.

## 2026-08-20 (unit-09/attempt-01)

- Role / unit: Lead / unit-09 (production diagnostics extraction), Worker
  attempt-01.
- Result: accepted. The `production diagnostics` describe moved verbatim into
  `controller-production-diagnostics.test.ts`. Search proved `movedGeometry`
  has no retained consumer, so it was the only source declaration pruned;
  `dragSetup` and `startDrag` remain.
- Files / commit: `kwin/tests/controller-production-diagnostics.test.ts` added;
  `kwin/tests/controller.test.ts` reduced to 10,778 lines; `plan.md` and
  `log.md` updated in the unit commit.
- Verification: Lead inspected the actual diff and new-file body. `npm
  --prefix kwin run typecheck` passed; `npm --prefix kwin test` reported 924
  tests, 81 suites, 924 pass, and 0 fail; describe count was 81.

## 2026-08-21 (unit-10/attempt-01)

- Role / unit: Lead / unit-10 (bindings and shortcuts extraction), Worker
  attempt-01.
- Result: accepted. The `binding profile catalog`, `shortcut registration`, and
  `focus-writer seam` describes moved verbatim into
  `controller-bindings-and-shortcuts.test.ts`; the target ends before the
  8002-8169 helper cluster. Search proved `readFileSync`, `PROFILE_CATALOGS`,
  `REGISTERED_PROFILE_ACTION_IDS`, `ShortcutOverrides`,
  `catalogValidationDiagnostics`, `validateProfile`, `resolveSequence`,
  `selectProfile`, `ProfileCatalog`, and `RowClassification` have no retained
  source consumers, so only those imports were pruned.
- Files / commit: `kwin/tests/controller-bindings-and-shortcuts.test.ts` added;
  `kwin/tests/controller.test.ts` reduced to 10,088 lines; `plan.md` and
  `log.md` updated in the unit commit.
- Verification: Lead inspected the actual addition and source deletion diffs;
  they contain only the approved describes, import scaffolding, and the
  search-proven orphan import removals. `npm --prefix kwin run typecheck`
  passed; `npm --prefix kwin test` reported 924 tests, 81 suites, 924 pass, and
  0 fail; describe count was 81.

## 2026-08-21 (unit-11/attempt-01)

- Role / unit: Lead / unit-11 (pure config functions extraction), Worker
  attempt-01.
- Result: blocked, no changes. The named `takeoverTilingSetup` helper now spans
  source lines 1,182-1,228 after prior accepted extractions, rather than its
  original approximately 8,169 location. The Worker stopped at the stated
  boundary mismatch without relocating or deleting anything.
- Files / commit: none; no gate run.
- Notes: the approved named-helper boundary is unchanged and unambiguous. A
  single same-scope correction will apply that helper at its current source
  location, found by name rather than the stale original line estimate.

## 2026-08-21 (unit-11/attempt-02)

- Role / unit: Lead / unit-11 (pure config functions extraction), Worker
  attempt-02, one same-scope correction.
- Result: accepted. The six approved pure-config describes moved verbatim into
  `controller-pure-config-functions.test.ts`, together with
  `takeoverTilingSetup` from its reconciled current source location. Search
  proved the moved direct-source imports and fixture-duplicated
  `assertPresetShape` had no retained source consumers, so only those source
  copies were pruned.
- Files / commit: `kwin/tests/controller-pure-config-functions.test.ts` added;
  `kwin/tests/controller.test.ts` reduced to 9,606 lines; `plan.md` and
  `log.md` updated in the unit commit.
- Verification: Lead inspected the actual addition and source deletion diffs;
  they contain only the approved describes, named-helper relocation, import
  scaffolding, and search-proven orphan pruning. `npm --prefix kwin run
  typecheck` passed; `npm --prefix kwin test` reported 924 tests, 81 suites,
  924 pass, and 0 fail; describe count was 81.

## 2026-08-21 (unit-12/attempt-01)

- Role / unit: Lead / unit-12 (automatic dwindle ownership extraction), Worker
  attempt-01.
- Result: accepted. The `automatic dwindle ownership` describe moved verbatim
  into `controller-automatic-dwindle-ownership.test.ts` without splitting its
  suite. Search proved `buildDwindleBlueprint`, `Blueprint`, `CurrentScope`,
  `presetSetup`, `configureThreeOccupantPreset`, `currentScopeFor`,
  `assertDwindleShape`, and `installStaleReturnSplitter` have no retained
  source consumers, so only those source copies were pruned;
  `installCapacityRejectingSplitter` remains for later source consumers.
- Files / commit: `kwin/tests/controller-automatic-dwindle-ownership.test.ts`
  added; `kwin/tests/controller.test.ts` reduced to 7,566 lines; `plan.md` and
  `log.md` updated in the unit commit.
- Verification: Lead inspected bounded actual-diff evidence including the new
  file's imports, opening describe, and closing brace, plus retained-source
  boundaries; the change contains only the approved describe, import
  scaffolding, and search-proven orphan pruning. `npm --prefix kwin run
  typecheck` passed; `npm --prefix kwin test` reported 924 tests, 81 suites,
  924 pass, and 0 fail; describe count was 81.

## 2026-08-21 (over-threshold remediation amendment)

- Role / unit: Lead / approved specification and plan amendment (no extraction
  unit executed).
- Result: recorded the Orchestrator ruling that the 20-file target is an
  estimate rather than acceptance criterion; four produced files above ~1,000
  lines are an open acceptance gap. Added `unit-23` after unit-21 and before
  unit-22 for pre-decided test describe-boundary sub-splits and a lower-priority
  fixture export-group split.
- Files / commit: `spec.md` and `plan.md` updated and committed separately as
  `b7283da` (`docs(controller-test-split): record threshold remediation`).
- Verification: documentation diff inspected; no implementation files changed.
- Notes: remediation must preserve exactly 924 tests, 81 suites, 0 failures,
  and 81 describes; suite-count behavior must be established empirically before
  a split is selected. Exact test-file boundaries are deferred for a successor
  Lead to record before `unit-23` dispatch.

## 2026-08-21 (unit-13/attempt-01)

- Role / unit: Lead / unit-13 (automatic dwindle insertion extraction), Worker
  attempt-01.
- Result: accepted. The `automatic dwindle insertion preflight` and `automatic
  split target insertion` describes moved verbatim into
  `controller-automatic-dwindle-insertion.test.ts`, with the approved named
  `installInlineMutatingRejectingSplitter` helper. Search proved
  `AUTOMATIC_SPLIT_TARGET_CONFIG_KEY` has no retained source consumer, so only
  that source import was pruned; `makeTile` and `installDwindleSplitter` remain
  for later local consumers.
- Files / commit: `kwin/tests/controller-automatic-dwindle-insertion.test.ts`
  added; `kwin/tests/controller.test.ts` reduced to 7,062 lines; `plan.md` and
  `log.md` updated in the unit commit.
- Verification: Lead inspected the actual source deletion and full new-file
  addition diff. `npm --prefix kwin run typecheck` passed; `npm --prefix kwin
  test` reported 924 tests, 81 suites, 924 pass, 0 fail, 0 cancelled, and 0
  skipped; describe count was 81.

## 2026-08-21 (unit-14/attempt-01)

- Role / unit: Lead / unit-14 (deferred recovery and fullscreen extraction),
  Worker attempt-01.
- Result: accepted. The `deferred invariant recovery` and `fullscreen
  passthrough` describes moved verbatim into
  `controller-deferred-recovery-and-fullscreen.test.ts`. Search proved
  `DROP_OUTLINE_PREVIEW_CONFIG_KEY`, `moveSetup`, `swapSetup`, `dragSetup`,
  `startDrag`, `reconstructDropSetup`, and
  `installCapacityRejectingSplitter` have no retained source consumers, so only
  those source copies were pruned.
- Files / commit: `kwin/tests/controller-deferred-recovery-and-fullscreen.test.ts`
  added; `kwin/tests/controller.test.ts` reduced to 6,003 lines; `plan.md` and
  `log.md` updated in the unit commit.
- Verification: Lead inspected the actual source deletion diff. `npm --prefix
  kwin run typecheck` passed; `npm --prefix kwin test` reported 924 tests, 81
  suites, 924 pass, 0 fail, 0 cancelled, and 0 skipped; describe count was 81.

## 2026-08-21 (unit-15/attempt-01)

- Role / unit: Lead / unit-15 (floating and sticky extraction), Worker
  attempt-01.
- Result: accepted. The `floating and sticky windows` describe moved verbatim
  into `controller-floating-and-sticky.test.ts`. Source search confirmed its
  base helpers and imports retain consumers in `controller.test.ts`, so no
  retained-source pruning was justified.
- Files / commit: `kwin/tests/controller-floating-and-sticky.test.ts` added;
  `kwin/tests/controller.test.ts` reduced to 5,469 lines; `plan.md` and
  `log.md` updated in the unit commit.
- Verification: Lead inspected the actual source deletion and full new-file
  addition diffs. `npm --prefix kwin run typecheck` passed; `npm --prefix kwin
  test` reported 924 tests, 81 suites, 924 pass, 0 fail, 0 cancelled, and 0
  skipped; describe count was 81.

## 2026-08-21 (unit-16/attempt-01)

- Role / unit: Lead / unit-16 (dynamic virtual desktops extraction), Worker
  attempt-01.
- Result: accepted. The `dynamic virtual desktops` describe moved verbatim into
  `controller-dynamic-virtual-desktops.test.ts`; its 1,391-line body
  byte-matches the `HEAD` source range through the next approved top-level
  describe. `ownTrailingEmpty` is imported from fixtures. Search proved
  `prepareExcessOwnedEmpty`, `modeCleanupSetup`,
  `configureSwitchCleanupScenario`, and `ownCleanupDesktops` have no retained
  source consumers, so only those duplicate helpers were pruned.
- Files / commit: `kwin/tests/controller-dynamic-virtual-desktops.test.ts`
  added; `kwin/tests/controller.test.ts` reduced to 4,006 lines; `plan.md` and
  `log.md` updated in the unit commit. The new test file is 1,414 lines and is
  recorded for `unit-23` remediation.
- Verification: Lead inspected the source deletion and new-file actual diffs,
  then independently ran `npm --prefix kwin run typecheck` (passed), `npm
  --prefix kwin test` (924 tests, 81 suites, 924 pass, 0 fail, 0 cancelled, 0
  skipped), and describe count (81).
