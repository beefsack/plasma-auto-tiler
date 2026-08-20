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
