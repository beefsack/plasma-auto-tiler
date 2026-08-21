# Plan: Focused Group Outline

Ownership and approval:
- Owner: Lead
- Status: Approved by user, 2026-08-21

## Technical Approach

Superseded (2026-08-21): the single central hook in `settleScopeRebuild`
(unit-01/unit-02 below) is REPLACED by a mutation-transaction observer at the
`boundary.ts` primitive perimeter, per the amended `spec.md`
(`36b650f`). `manageTile`, `assignWindowToTile`, `splitCustomTile`, and
`removeCustomTile` report success through a shared reporter; the transaction
flushes once per `FeatureGate.run` dispatch (`controller.ts:1714`) and once per
yielded structural callback. Exactly one `flashFocusedGroup()` call site
remains, at `flushStructuralMutation()` (`controller.ts:5401`).

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification |
|---|---|---|---|---|
| unit-01 | (superseded) Add the single-hook focused group flash, stale seam-comment correction, exact gap record, and focused tests. | - | `kwin/src/controller.ts`, generated `kwin/contents/code/main.js`, `kwin/tests/controller-*.test.ts`, change artifacts, backlog | Static: focused tests, `npm --prefix kwin test`, `npm --prefix kwin run typecheck` |
| unit-02 | (superseded) Independently review unit-01 and rerun static verification. | unit-01 | unit-01 diff and evidence | Static: review findings plus both required commands |
| unit-03 | Replace the central hook with the mutation-transaction observer at the `boundary.ts` primitive perimeter (implementation already written, uncommitted); close the seven known coverage gaps with one end-to-end test per flow, asserting the outline actually flashes. | unit-01, unit-02 | `kwin/src/boundary.ts`, `kwin/src/controller.ts`, `kwin/tests/boundary.test.ts`, `kwin/tests/controller-group-outline.test.ts`, generated `kwin/contents/code/main.js` | Static: focused tests per flow, `npm --prefix kwin test`, `npm --prefix kwin run typecheck` |
| unit-04 | Lead-run full static verification and commit. | unit-03 | full test/typecheck/dogfood-install suites, commit | Static: `npm --prefix kwin test`, `npm --prefix kwin run typecheck`, `bash scripts/dogfood-install.test.sh` |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Progress

- [x] unit-01 single-hook implementation and tests (superseded)
- [x] unit-02 independent review and verification (superseded)
- [x] unit-03 mutation-transaction observer: seven-flow test-gap closure
- [x] unit-04 Lead-run verification and commit

## Attempt Accounting

- unit-03: 2 Worker checkpoint slices (slice 1: flows 1/2/4/5; slice 2: flows
  3/6/7), both accepted after Lead diff inspection and independent Lead-run
  test/typecheck; no correction round needed on either slice.

## Pending User Decisions

- None.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| A successful marked transaction shows one outline for the focused leaf's parent, then hides it after a fixed delay | `flashes the focused leaf parent after automatic reconstruction` (`kwin/tests/controller-group-outline.test.ts:30-51`) |
| Keyboard arrow moves (empty-target and occupied-target sibling swap) flash | `flashes once after an arrow move into an empty sibling`; `flashes once after swapping same-parent occupied siblings` (`:64-90`) |
| Root leaves and invalid parents do not flash | `does nothing for a focused root leaf without a layout parent`; `does nothing for a focused leaf with invalid layout parent geometry` (`:92-127`) |
| Drag preview precedence and stale-hide safety | `keeps stale group callbacks and group flashes from replacing a drag outline` (`:128-158`) |
| Seven known gap flows each flash end to end: `applyPreset`, keyboard insertion completion, `completeDrag` split, `completeDrag` deferred origin collapse, automatic direct insertion, owned freed-leaf collapse, cross-workspace source collapse, deferred destination adoption | `flashes the focused leaf parent after a manual preset split`; `flashes once after keyboard insertion completes on window-added`; `flashes once after automatic direct insertion into an owned empty leaf`; `flashes once after an owned freed-leaf collapse on window-removed`; `flashes after a native drop split and again after the deferred origin collapse`; `flashes the sibling's parent after a cross-workspace source collapse, then the mover's new parent after deferred adoption` (`:159-364`) |
| Exactly one `flashFocusedGroup()` call site (primitive-perimeter observer, not one-off hooks) | `grep -n "flashFocusedGroup(" kwin/src/controller.ts` -> `controller.ts:5401` (call site, inside `flushStructuralMutation`) and `:5404` (definition) only |
| Static correctness | `npm --prefix kwin test`: 940 tests, 89 suites, 940 pass, 0 fail (baseline at `604848f` was 931/88/0); `npm --prefix kwin run typecheck`: clean on both tsconfigs; `bash scripts/dogfood-install.test.sh`: 347 assertions, 0 fail (matches baseline) |

## Residual Risks

- None outstanding. The prior central-hook debt (unit-01/unit-02) is fully
  discharged by the unit-03 mutation-transaction observer; all seven
  previously-known gap flows now have direct, evidenced outline-flash
  coverage.

## Final Outcome

- Static implementation and test-gap closure accepted by the Lead: diffs
  inspected directly (not summaries), single-call-site invariant reconfirmed
  by grep, and all three required verification commands re-run independently
  by the Lead with 0 failures and no test count regression. User visual
  validation (live host) remains the intended live acceptance and was
  explicitly deferred to the Orchestrator/user for this stint.
