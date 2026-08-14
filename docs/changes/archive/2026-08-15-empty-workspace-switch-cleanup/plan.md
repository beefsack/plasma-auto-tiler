# Plan: Empty Workspace Switch Cleanup

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-15 by Orchestrator

## Technical Approach

Keep reconciliation behavior unchanged while extending its invocation contract
with an explicit `switchCleanup` intent that defaults to `false`. Only the
completed current-desktop switch handler passes `true`. Later cleanup code will
consume that intent to perform mode-aware, fail-closed cleanup.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification |
|---|---|---|---|---|
| unit-01 | Propagate switch-cleanup intent from the current-desktop switch handler only, with default false elsewhere. | - | `kwin/src/controller.ts`, `kwin/tests/controller.test.ts` | Focused controller tests and `tsc -p kwin/tsconfig.test.json --noEmit` |
| unit-02 | Implement mode-aware cleanup with protected desktop, visibility, occupancy, and fresh-read safeguards. | unit-01 | `kwin/src/controller.ts`, controller tests | Targeted cleanup tests and typecheck |
| unit-03 | Independently review trigger plumbing, mode cleanup, tests, and static evidence. | unit-02 | Change scope | Review findings recorded in `log.md` |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Progress

- [x] unit-01 Trigger plumbing and focused tests
- [x] unit-02 Complete snapshot/fail-closed controller integration and mode-aware switch cleanup
- [x] unit-03 Independent review and static verification

## Pending User Decisions

- None.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Switch handler requests enhanced cleanup only after a completed switch | `controller.test.ts`: `requests enhanced cleanup only after a completed current-desktop switch` passed 2026-08-15 |
| All non-switch triggers disable enhanced cleanup | Same focused test passed for output/screen, window, and desktop-scope triggers |
| Trigger plumbing does not alter removal behavior | Inspected diff carries the intent to `cleanupDesktops` without branching on it; 499 controller tests passed |
| Pure removal-selection safeguards | `logic.test.ts`: 9 focused cases passed 2026-08-15 for ordered snapshots, ownership, visibility, occupancy, trailing protection, final-global-desktop rejection, deterministic earliest selection, and at-most-one result; `npm run typecheck` and `git diff --check` passed |
| Complete snapshot/fail-closed integration safeguards | `controller.test.ts`: 7 focused cases passed 2026-08-15 for multi-output visibility, unreadable output/global current desktops, floating occupancy, sticky exclusion, invalid window list, and invalid non-sticky membership; `npm run typecheck` and `git diff --check` passed |
| Mode-aware switch cleanup | `controller.test.ts`: 51 focused dynamic virtual-desktop tests passed 2026-08-15, including behavioral rereads between multiple removals, multi-output visibility in all modes, and invalid mapping deferral. `npm --prefix kwin run typecheck` and `git diff --check` passed. |
| Independent review | `empty-workspace-review-03/attempt-01`: independent read-only review and Lead diff inspection found no production defect. Replenishment on unreadable ordinary snapshots is non-destructive approved behavior; its three coverage gaps are closed below. |
| Shipped bundle and complete static verification | `empty-workspace-static-04/attempt-01`: focused planner 9/9, dynamic controller 51/51, `npm --prefix kwin run typecheck`, full `npm --prefix kwin test` (805 node tests and 271 start-test checks), and `git diff --check` passed. `empty-workspace-static-04/attempt-02`: the declared root build `npm --prefix kwin run build` twice produced identical `kwin/contents/code/main.js` SHA-256 `7d422cfec258edb2682d41c6abd0e5055c1ad562d28418689aa8bfff437fb4ba`; focused bundle-output test passed 5/5 and `git diff --check` passed. |

## Residual Risks

- The controller cannot make KWin's separate desktop, output, and window reads
  atomic; it fail-closes on any unreadable snapshot and rereads before another
  candidate.
- Focused controller coverage closes the deferred review gaps for multi-removal
  rereads, non-shared multi-output visibility, and invalid mapping deferral.
- No live KWin/Plasma test has run under this change's explicit constraint.

## Final Outcome

- Units 01-03 complete. Independent review accepted with no production
  correction; its deferred test-strengthening gaps are closed by focused tests.
- The generated KWin executable bundle is regenerated from the accepted source
  and reproducible across two declared builds.
