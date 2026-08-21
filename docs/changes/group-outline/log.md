# Log: Focused Group Outline

## 2026-08-21

- Role / unit: Lead / planning / stage-02
- Result: approved specification, plan, and backlog entry created
- Files / commit: `docs/changes/group-outline/{spec,plan,log}.md`, `docs/backlog.md`
- Verification: user approval recorded; no implementation or live testing run
- Notes: one central hook is deliberate debt to be replaced, not extended

## 2026-08-21

- Role / unit: Worker / unit-01 / attempt-01
- Result: implementation complete; static verification passed; Worker paused on generated bundle scope
- Files / commit: `kwin/src/controller.ts`, `kwin/tests/controller-group-outline.test.ts`, generated `kwin/contents/code/main.js`
- Verification: focused 3/1/3 pass; full 930 tests, 88 suites, 0 failures; both typechecks clean
- Notes: central hook is `settleScopeRebuild` phase-two success; exact coverage gaps recorded in `spec.md`

## 2026-08-21

- Role / unit: Worker / unit-02 / attempt-01
- Result: independent review found missing invalid-parent-geometry coverage
- Files / commit: `kwin/tests/controller-group-outline.test.ts`
- Verification: 930 tests, 88 suites, 0 failures; both typechecks clean
- Notes: one same-scope unit-01 correction required

## 2026-08-21

- Role / unit: Worker and Lead / unit-01 / correction-01
- Result: accepted after focused invalid-parent-geometry test and Lead diff review
- Files / commit: `kwin/tests/controller-group-outline.test.ts`
- Verification: 931 tests, 88 suites, 931 pass, 0 fail; both typechecks clean; `git diff --check` clean
- Notes: unit-02 finding addressed; no further independent review dispatched

## 2026-08-21

- Role / unit: Lead / planning / stage-03
- Result: spec amended and approved by user (`36b650f`): central hook replaced
  by mutation-transaction observer at `boundary.ts` primitive perimeter;
  implementation pre-written uncommitted by a prior Worker, structurally
  verified by the Orchestrator, not yet test-run
- Files / commit: `docs/changes/group-outline/spec.md` (`36b650f`)
- Verification: none run yet at this stage
- Notes: unit-03/unit-04 added to `plan.md` for the seven-flow test-gap
  closure and Lead-run verification

## 2026-08-21

- Role / unit: Worker / unit-03 / attempt-01 (checkpoint slice 1 of 2)
- Result: added 4 end-to-end tests (`applyPreset`, keyboard insertion
  completion, automatic direct insertion, owned freed-leaf collapse); no
  implementation fix needed
- Files / commit: `kwin/tests/controller-group-outline.test.ts`
- Verification: Lead-run `npm --prefix kwin test`: 938 tests, 89 suites, 0
  fail; `npm --prefix kwin run typecheck`: clean
- Notes: Lead inspected the diff directly; checkpoint accepted, no correction

## 2026-08-21

- Role / unit: Worker / unit-03 / attempt-01 (checkpoint slice 2 of 2)
- Result: added 2 more end-to-end tests covering the remaining 3 flows
  (`completeDrag` split + deferred collapse; cross-workspace source collapse +
  deferred destination adoption); no implementation fix needed
- Files / commit: `kwin/tests/controller-group-outline.test.ts`
- Verification: Lead-run `npm --prefix kwin test`: 940 tests, 89 suites, 0
  fail; `npm --prefix kwin run typecheck`: clean; single-call-site invariant
  reconfirmed by grep
- Notes: Lead inspected the diff directly; accepted, no correction round

## 2026-08-21

- Role / unit: Lead / unit-04
- Result: full static verification re-run independently by the Lead
- Files / commit: none changed
- Verification: `npm --prefix kwin test`: 940/89/0 fail; `npm --prefix kwin
  run typecheck`: clean on both tsconfigs; `bash scripts/dogfood-install.test.sh`:
  347 assertions, 0 fail (matches baseline)
- Notes: all acceptance criteria met; proceeding to commit
