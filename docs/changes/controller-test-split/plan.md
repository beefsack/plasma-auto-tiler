# Plan: Split `kwin/tests/controller.test.ts`

Ownership and approval:
- Owner: Lead
- Status: Approved (autonomous mode, delegated plan approval)

## Technical Approach

`controller.test.ts` keeps a **full, unmodified copy of its own preamble**
(imports, constants, types, `Harness`, all helpers) until the very last work
unit. Every other unit only ever moves `describe` blocks: it extracts one
target file's `describe`(s) via `sed` line ranges (never a whole-file
`Read`), writes the new file with a minimal pruned import header, and deletes
those same lines from `controller.test.ts` in the same unit. Because the
extraction and the deletion happen atomically together, `controller.test.ts`
never holds a `describe` that also exists in a new file - the suite count
stays at 78 and the test count at 838 after every single unit, not just at
the end. The final unit deletes the now-`describe`-less `controller.test.ts`
shell, since its preamble is by then fully and correctly duplicated in
`controller-fixtures.ts`.

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
grep -c "describe(" tests/*.test.ts | awk -F: '{s+=$2} END{print s}'   # must print 78
```

| ID | Objective | Depends on | File or subsystem scope | Verification |
|---|---|---|---|---|
| unit-01 | Create `kwin/tests/controller-fixtures.ts`: copy lines 1 to (first `^describe(` line - 1) of `controller.test.ts` verbatim except adding `export ` to each top-level `const`/`function`/`class`/`interface`/`type` declaration; do not touch `controller.test.ts` yet | - | new file `kwin/tests/controller-fixtures.ts` | `npm run typecheck` only (no consumer exists yet to exercise it at runtime) |
| unit-02 | Move describes: keyboard insertion; ordinary placement and boundaries; keyboard focus -> `controller-keyboard-placement.test.ts` | unit-01 | new file + delete matching lines from `controller.test.ts` | full 3-command block |
| unit-03 | Move describes: keyboard move; occupied-target move swap; tile detach -> `controller-keyboard-move-and-swap.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-04 | Move describes: tile attach; scope fill; focused-leaf presets -> `controller-tile-attach-and-scope.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-05 | Move describe: selected overlay state -> `controller-selected-overlay-state.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-06 | Move describe: selected overlay reflow -> `controller-selected-overlay-reflow.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-07 | Move describe: interactive drag (1,156 lines; single describe, over threshold, disclosed in spec) -> `controller-interactive-drag.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-08 | Move describes: drag snapshot diagnostics; drag reconstruction final snapshot; drag reflow normalization; COSMIC split resize mode; bspwm direct resize bindings -> `controller-drag-diagnostics-and-resize.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-09 | Move describe: production diagnostics -> `controller-production-diagnostics.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-10 | Move describes: binding profile catalog; shortcut registration; focus-writer seam -> `controller-bindings-and-shortcuts.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-11 | Move describes: parseTilingAlgorithm; parseAutomaticSplitTarget; parseDropOutlinePreview; selectAutomaticSplitTarget; ensureTrailingEmptyDesktop; tiling algorithm takeover -> `controller-pure-config-functions.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-12 | Move describe: automatic dwindle ownership (1,908 lines; single describe, over threshold, largest in the file, disclosed in spec) -> `controller-automatic-dwindle-ownership.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-13 | Move describes: automatic dwindle insertion preflight; automatic split target insertion -> `controller-automatic-dwindle-insertion.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-14 | Move describes: deferred invariant recovery; fullscreen passthrough -> `controller-deferred-recovery-and-fullscreen.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-15 | Move describe: floating and sticky windows -> `controller-floating-and-sticky.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-16 | Move describe: dynamic virtual desktops (1,392 lines; single describe, over threshold, disclosed in spec; contains locally-scoped `ownTrailingEmpty`-consuming logic - verify `ownTrailingEmpty` import from fixtures is included) -> `controller-dynamic-virtual-desktops.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-17 | Move describe: per-workspace maximize -> `controller-per-workspace-maximize.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-18 | Move describe: workspace mode and per-output seams (Unit 04); verify local helper `ownTrailingEmpty` import from fixtures is included -> `controller-workspace-mode-seams.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-19 | Move describe: per-output-local workspaces (Unit 05) (contains its own locally-scoped `twoOutputSetup`/`moveToTrailing` - these travel with the block untouched, not part of fixtures) -> `controller-per-output-workspaces.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-20 | Move describe: global-unique workspaces (Unit 06) (contains its own locally-scoped `globalUniqueSetup` - travels with the block untouched) -> `controller-global-unique-workspaces.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-21 | Move describes: shared workspaces (Unit 07); trailing-empty invariant on first occupation (Unit 07 live regression) -> `controller-shared-workspaces.test.ts` | unit-01 | same pattern | full 3-command block |
| unit-22 | Final cleanup: confirm `controller.test.ts` now contains only the preamble and zero `describe(` occurrences, delete `kwin/tests/controller.test.ts`, run the full acceptance gate (3-command block plus `git diff --stat -- kwin/contents/code/main.js` must be empty, plus a diff of sorted `it(`/`describe(` string literals before (from git history) and after confirming no name changed) | unit-02 .. unit-21 | delete `kwin/tests/controller.test.ts` | full 3-command block + `main.js` diff check + test-name diff check |

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
on has moved.** `cosmic-evidence-mining` added
`kwin/tests/move-conformance-model.ts` and
`kwin/tests/move-conformance.test.ts` (41 new tests, 1 new suite, none of
them touching `controller.test.ts` or any file this change's units scope
over). Before starting execution, the correct target is:

- `npm test`: **879 tests / 79 suites / 879 pass / 0 fail** (not 838/78).
- `grep -c "describe(" tests/*.test.ts` totals **79** (not 78).

The 838/78 baseline was itself re-measured and confirmed correct on this
machine, immediately before `move-conformance.test.ts` was added -
`docs/changes/archive/2026-08-20-cosmic-evidence-mining/plan.md`, unit-F
Acceptance-Criterion Evidence entry. It was
not stale before this change; this change is what moved it.

This is a numeric baseline shift only. `move-conformance.test.ts` is not a
`controller.test.ts` describe block and is out of scope for every unit
above; no work unit, file target, or grouping in this plan needs to change,
only the target numbers quoted in `spec.md` and this plan's own verification
commands, at the point execution actually starts.

## Progress

- [ ] unit-01 create controller-fixtures.ts
- [ ] unit-02 keyboard placement
- [ ] unit-03 keyboard move and swap
- [ ] unit-04 tile attach and scope
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

No entries (no units have been dispatched or attempted yet; this plan was
produced by investigation only, per the dispatch brief's hard constraint
against spawning subagents or moving test code in this session).

## Pending User Decisions

None. The Target File Set grouping in `spec.md` is a Lead proposal within
approved constraints, not a product decision.

## Acceptance-Criterion Evidence

| Acceptance criterion (from spec.md) | Evidence |
|---|---|
| All 40 describes preserved unchanged across 20 files + fixtures | pending - established by unit-22's full gate |
| `grep -c "describe("` totals 78 | pending - checked after every unit, not just the last |
| `npm test`: 838/78/838 pass/0 fail | pending - checked after every unit from unit-02 onward |
| `npm run typecheck` clean on both tsconfigs | pending - checked after every unit |
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

- Pending. No unit has been executed; this session produced `spec.md`,
  `plan.md`, and `log.md` only, per the dispatch brief's investigation-and-
  specification-only scope.
