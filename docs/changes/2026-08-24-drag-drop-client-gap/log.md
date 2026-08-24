# Log: Drag-Drop Client Gap Diagnostics

Append-only. Entries record approved scope, evidence, and blockers.

## 2026-08-24

- Role / unit: Lead / parked-foundation cleanup and checkpoint
- Result: Accepted diagnostic and fixture foundation retained; rejected
  production attempt-02 candidate removed; change remains hard-parked.
- Files / commit: retained `kwin/src/controller-interactive-drag.ts`,
  `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`,
  `kwin/tests/controller-fixture-scenarios.ts`,
  `kwin/tests/controller-interactive-drag-reflow.test.ts`, and canonical
  `kwin/contents/code/main.js`; no commit yet.
- Verification: The fixture-only `term2` declaration and deferred-collapse
  assertion repairs restored the 13-test reflow contract. Build, diagnostics 45
  tests/5 suites/45 passed/0 failed/0 skipped, reflow 13 tests/1 suite/13
  passed/0 failed/0 skipped, and typecheck passed. Serialized broad TAP: 993
  tests/95 suites/993 passed/0
  failed/0 skipped; start-test 255 passed/0 failed. Dogfood: 347 passed/0
  failed, with its permitted missing temporary-data warning. `git diff --check`
  and ASCII/link checks passed. Candidate symbols and its two production test
  names are absent.
- Notes: The earlier 301/28/274/27 broad result is command-state interference,
  not acceptance evidence: concurrent dogfood invokes the canonical build and
  clears `kwin/dist`. Gates are recorded serially. No criterion moved; the
  production unit remains parked and no reset, correction, review, or live work
  is authorized.
- Change-wide telemetry: implementation dispatches 5, dispatch-invalids 1,
  pre-review corrections 1, finding-fix corrections 0, reviews 1, resets 0,
  broad gates 2, Worker/Lead tool-call proxies not reported, acceptance criteria
  moved 3, no-progress streak 3.

## 2026-08-24

- Role / unit: Lead / parked-foundation broad-gate reconciliation
- Result: The prior broad test failure is locally reconciled as command-state
  interference, not a product finding or broad acceptance run.
- Files / commit: `plan.md` and `log.md`; no commit.
- Verification: `kwin/package.json` defines `test` as canonical build, test
  bundle generation, Node TAP, and start-test verification. The concurrently
  run dogfood script invokes `npm --prefix <repo>/kwin run build` during its
  install checks; that build removes `kwin/dist` while Node is loading its test
  modules. The observed result was 301 tests, 28 suites, 274 passed, 27 failed
  with missing `dist/tests` modules.
- Notes: `gate.broad-dogfood-script` now records the required serial ordering.
  Reuse the already passing dogfood evidence; rerun only the self-contained
  `npm --prefix kwin test` command.

## 2026-08-24

- Role / unit: Lead / `unit-drag-gap-final-manage-production` / attempt 02
- Result: Rejected and parked under the three-dispatch no-progress breaker.
- Files / commit: `kwin/src/controller-interactive-drag.ts`,
  `kwin/tests/controller-interactive-drag-reflow.test.ts`, and canonical build
  output `kwin/contents/code/main.js`; no commit.
- Verification: Canonical build, focused reflow bundle, focused TAP (1 suite,
  15 tests, 15 passed, 0 failed, 0 skipped), and canonical typecheck passed.
  Lead inspection found that `recoverTransaction()` only invokes
  `restoreOrigin()` and optional invariant repair, rather than reconstructing
  the immutable topology snapshot or restoring focus. The seven-row regression
  invokes fixture operations directly rather than the production transaction,
  so it does not prove recovery or no final-manage retry after transactional
  failure.
- Notes: The attempt moved no acceptance criterion. The no-progress streak is
  now three; no correction, review, further Worker dispatch, broad/live gate,
  staging, commit, or push is authorized. Reset options require Orchestrator
  review: reduce scope, replace the reconstruction approach, or freeze the
  accepted diagnostic/fixture partial result.
- Change-wide telemetry: implementation dispatches 5, dispatch-invalids 1,
  pre-review corrections 1, finding-fix corrections 0, reviews 1, resets 0,
  broad gates 0, Worker/Lead tool-call proxies not reported, acceptance criteria
  moved 3, no-progress streak 3.

## 2026-08-24

- Role / unit: Lead / scheduled handover
- Result: Handover after the accepted fixture typecheck fix; production attempt 02 is ready but not dispatched.
- Files / commit: `plan.md`, `log.md`, and `state.md`; no commit.
- Verification: Inherited state records the accepted fixture contract and independent review, accepted one-line typecheck repair, and passing focused reflow/typecheck evidence. Autonomous mode remains active; governance and user-run live work remain parked.
- Notes: No new implementation, review, broad/live gate, staging, commit, or push occurred at this boundary.
- Change-wide telemetry: implementation dispatches 4, dispatch-invalids 1, pre-review corrections 1, finding-fix corrections 0, reviews 1, resets 0, broad gates 0, Worker/Lead tool-call proxies not reported, acceptance criteria moved 3, no-progress streak 2.

## 2026-08-24

- Role / unit: Worker / `unit-drag-gap-fixture-typecheck-fix` / attempt 01
- Result: Accepted narrow fix-forward repair; production attempt 02 is ready for separate authorization.
- Files / commit: `kwin/tests/controller-interactive-drag-reflow.test.ts`; no commit.
- Verification: Lead inspected the exact call change from `fixture.origin.remove()` to `fixture.origin.remove?.()` and found no whitespace issue. The Worker ran only the approved gates: reflow bundle passed; reflow TAP reported 1 suite, 13 tests, 13 passed, 0 failed, 0 skipped; `npm --prefix kwin run typecheck` passed with exit 0. No production source, generated output, broad/live gate, staging, commit, or push occurred.
- Notes: Autonomous mode remains active. This is a dependency fix-forward unit, not a production attempt-01 correction; no acceptance criterion moved. Production attempt 02 was not dispatched.
- Change-wide telemetry: implementation dispatches 4, dispatch-invalids 1, pre-review corrections 1, finding-fix corrections 0, reviews 1, resets 0, broad gates 0, Worker/Lead tool-call proxies not reported, acceptance criteria moved 3, no-progress streak 2.

## 2026-08-24

- Role / unit: Worker / `unit-drag-gap-final-manage-production` / attempt 01
- Result: Decision needed before source work because the accepted fixture self-contract fails the required typecheck gate outside the authorized production scope.
- Files / commit: None; no commit.
- Verification: Canonical build passed; reflow bundle passed; reflow TAP reported 1 suite, 13 tests, 13 passed, 0 failed, 0 skipped. `npm --prefix kwin run typecheck` exited 1 with TS2722 at `kwin/tests/controller-interactive-drag-reflow.test.ts:371`: `fixture.origin.remove()` may be undefined because `TestTile.remove` is optional. Lead confirmed the call and optional declaration; no production source diff was introduced by this attempt.
- Notes: The minimal non-semantic repair is `fixture.origin.remove?.()`, but it is in the accepted fixture self-contract and was forbidden by this production Worker's scope. No correction, review, broad/live gate, staging, commit, or push occurred.
- Change-wide telemetry: implementation dispatches 3, dispatch-invalids 1, pre-review corrections 1, finding-fix corrections 0, reviews 1, resets 0, broad gates 0, Worker/Lead tool-call proxies not reported, acceptance criteria moved 3, no-progress streak 1.

## 2026-08-24

- Role / unit: Independent Worker review / `gate.final-manage-fixture-review`
- Result: One finding set with no serious finding; fixture contract accepted and production is ready for separate authorization.
- Files / commit: None; no commit.
- Verification: The reviewer inspected only `kwin/tests/controller-fixture-scenarios.ts` and `kwin/tests/controller-interactive-drag-reflow.test.ts`, the approved fixture constraints, the actual diff, and supplied focused evidence. It confirmed fixture-only operation tracing and observability, public start/finish boundary observation, immutable recursive snapshot/decode and membership/focus state, all seven isolated injectors, no reconstruction/final-manage retry/native-frame claim, and 13 deterministic top-level tests. No gate reran.
- Notes: Non-blocking review observations: `decode()` records a new failure observation on each post-failure call and `arm()` remains armed for a fixture lifetime; each current table row creates a fresh fixture and calls decode once. No finding-fix is needed; the one permitted finding-fix budget remains unused.
- Change-wide telemetry: implementation dispatches 2, dispatch-invalids 1, pre-review corrections 1, finding-fix corrections 0, reviews 1, resets 0, broad gates 0, Worker/Lead tool-call proxies not reported, acceptance criteria moved 3, no-progress streak 0.

## 2026-08-24

- Role / unit: Lead / approved stable fixture semantic amendment and `unit-drag-gap-final-manage-fixture-contract` / attempt 01
- Result: The approved fixture capability amendment is recorded; attempt 01 implementation is accepted pending its required independent review.
- Files / commit: `spec.md`, `plan.md`, `state.md`, `kwin/tests/controller-fixture-scenarios.ts`, and `kwin/tests/controller-interactive-drag-reflow.test.ts`; no commit.
- Verification: The repaired packet reconciled `gate.focused-reflow-bundle` and `gate.focused-reflow-test` with the literal plan commands, baseline 1 suite/11 tests/11 passed/0 failed/0 skipped, and fixture expectation 1 suite/13 tests/13 passed/0 failed/0 skipped. The Worker ran both focused gates: bundle passed; TAP reported 1 suite, 13 tests, 13 passed, 0 failed, 0 skipped. Lead inspected the actual 506-line, two-file fixture diff and `git diff --check`: two top-level tests, fixture-only trace/snapshot/decode API, public-route boundary observation, and exactly seven injectors; no production source, generated output, reconstruction, final-manage retry, desired production-order assertion, native-frame claim, staging, commit, or push.
- Notes: The seven injectors are `unmanage-throws`, `split-throws`, `remove-fails`, `manage-fails`, `malformed-topology`, `duplicate-membership`, and `focus-failure`. The fixture criterion moved to met; `gate.final-manage-fixture-review` remains required before production and was not dispatched.
- Change-wide telemetry: implementation dispatches 2, dispatch-invalids 1, pre-review corrections 1, finding-fix corrections 0, reviews 0, resets 0, broad gates 0, Worker/Lead tool-call proxies not reported, acceptance criteria moved 3, no-progress streak 0.

## 2026-08-24

- Role / unit: Lead / `unit-drag-gap-final-manage-fixture-contract` / attempt 01 preflight
- Result: Dispatch invalid before source work.
- Files / commit: `plan.md`, `log.md`, and `state.md`; no commit.
- Verification: Role metadata reconciled as Lead / Lead / Orchestrator; parent selector `lead-openai`, model preference `openai/gpt-5.6-terra`, distinct OpenCode persona, depth 2, one hierarchy-wide Worker slot, task capability, and required Worker skill are available. Plan-owned fixture gates reconcile as `gate.focused-reflow-bundle` with its literal esbuild command and passing baseline, and `gate.focused-reflow-test` with its literal node command and 11-test baseline. The test gate specifies no exact post-change count, so the required pre-dispatch count reconciliation fails.
- Notes: No Worker dispatched; no source, generated bundle, host, staging, commit, push, or focused gate execution occurred. An Orchestrator-approved semantic plan amendment is required before the one permitted repaired dispatch.
- Change-wide telemetry: implementation dispatches 1, dispatch-invalids 1, pre-review corrections 1, finding-fix corrections 0, reviews 0, resets 0, broad gates 0, acceptance criteria moved 2, no-progress streak 0.

## 2026-08-24

- Role / unit: Worker / final-manage fixture gate baseline / static verification
- Result: The existing fixture entrypoint and canonical focused baseline are established for the approved fixture-contract unit.
- Files / commit: None; no commit.
- Verification: `npm --prefix kwin exec -- esbuild "kwin/tests/controller-interactive-drag-reflow.test.ts" --bundle --platform=node --format=cjs --target=es2020 --outfile=/tmp/plasma-auto-tiler-drag-reflow.test.js` and `node --test /tmp/plasma-auto-tiler-drag-reflow.test.js` both passed. TAP: 1 suite, 11 tests, 11 passed, 0 failed, 0 skipped, 0 todo.
- Notes: Public fixture route is `nativeDropSetup()` through `startDrag()` and `interactiveMoveResizeFinished.emit()`. This static baseline is not an implementation dispatch and made no project-file change.
- Change-wide telemetry: implementation dispatches 1, dispatch-invalids 0, pre-review corrections 1, finding-fix corrections 0, reviews 0, resets 0, broad gates 0, acceptance criteria moved 2, no-progress streak 0.

## 2026-08-24

- Role / unit: Lead / approved final-topology-management semantic amendment / none
- Result: User and Orchestrator approved the supported final-topology-management correction and its independently accepted fixture-first dependency.
- Files / commit: `spec.md`, `plan.md`, `log.md`, and `state.md`; no commit.
- Verification: Read-only KWin v6.7.3 capability evidence establishes changed final association through `manage()` as the supported private geometry-request path. Artifact links, ASCII content, tracked state, and diff whitespace are pending final Lead verification.
- Notes: The amendment excludes direct frame writes, private geometry replication, timers, polling, overlays, COSMIC work, and fixture claims of native frame realization. Broad gates are reserved for the named integration unit. No production or test implementation occurred.
- Change-wide telemetry: implementation dispatches 1, dispatch-invalids 0, pre-review corrections 1, finding-fix corrections 0, reviews 0, resets 0, broad gates 0, acceptance criteria moved 2, no-progress streak 0.

## 2026-08-24

- Role / unit: Lead / semantic-amendment artifact verification / none
- Result: Authorized artifacts are internally consistent and the fixture-contract unit is ready for its first implementation dispatch.
- Files / commit: `spec.md`, `plan.md`, `log.md`, and `state.md`; no commit.
- Verification: `git diff --check` and per-artifact no-index whitespace checks produced no whitespace findings. ASCII scan produced no findings. The `docs/live-kwin-testing.md` reference resolves. Targeted Git index inspection confirms these four change artifacts are untracked, so the tracked diff is empty; no staging was authorized. Existing tracked changes outside this artifact set were left untouched.
- Notes: All implementation-unit gates have stable IDs, literal commands or review observations, and baseline/post-change expectations. Broad static gates remain exclusive to the integration checkpoint.
- Change-wide telemetry: implementation dispatches 1, dispatch-invalids 0, pre-review corrections 1, finding-fix corrections 0, reviews 0, resets 0, broad gates 0, acceptance criteria moved 2, no-progress streak 0.

## 2026-08-24

- Role / unit: Lead / pre-change read-only host attempt / none
- Result: Cancelled before evidence; recorded separately from implementation dispatches.
- Files / commit: None.
- Verification: No source, test, host, staging, commit, or push action occurred.
- Notes: One cancelled read-only Lead host attempt; user observation remains ground truth.
- Change-wide telemetry: implementation dispatches 0, corrections 0, reviews 0, resets 0, acceptance criteria moved 0, no-progress streak 0.

## 2026-08-24

- Role / unit: Lead / artifact creation and baseline observation / none
- Result: User and Orchestrator approved Expanded diagnostic-first artifacts; no implementation authorized.
- Files / commit: `spec.md`, `plan.md`, `log.md`, `state.md`, and `docs/backlog.md`; no commit.
- Verification: Build and typecheck passed; full suite 990 tests/95 suites, 990 passed/0 failed; dogfood script 347 passed/0 failed with a `/tmp/.../data` missing-path warning; exact focused bundles failed root-relative test-path resolution; tracked diff was clean after baseline commands.
- Notes: The focused-command blocker prevents the first implementation dispatch until an approved semantic amendment. The baseline observation is not an implementation dispatch.
- Change-wide telemetry: implementation dispatches 0, dispatch-invalids 0, corrections 0, reviews 0, resets 0, broad gates 0, acceptance criteria moved 0, no-progress streak 0.

## 2026-08-24

- Role / unit: Worker / `unit-drag-gap-live-evidence` and `unit-drag-gap-mechanism-checkpoint` / read-only reconciliation
- Result: Live evidence accepted; mechanism checkpoint requires a semantic decision.
- Files / commit: None.
- Verification: Exactly two `drag-diagnostic` transactions at `/run/user/1000/plasma-auto-tiler-live/live-20260824T215510-62409` log lines 59 and 78 partition `(0,44,1536,980)` into four occupied leaves. Transaction 2 assigns `window-2` to `(0,534,768,490)` while its frame remains `(0,98.74004585082497,800.0000000000002,600)` after origin removal, collapse, normalization, and after snapshot. Focused static fixtures/tests were inspected only; no test, host, broad, or live rerun occurred.
- Notes: Other occupied frames align with inset leaf frames; client geometry and supported post-settle event evidence are unavailable. The approved table therefore yields inconclusive for delayed realization, while persistent user observation and the existing code path evidence identify omitted post-normalization dragged-client realization as the correction candidate. No semantic amendment or correction was made.
- Change-wide telemetry: implementation dispatches 1, dispatch-invalids 0, pre-review corrections 1, finding-fix corrections 0, reviews 0, resets 0, broad gates 0, acceptance criteria moved 2, no-progress streak 0.

## 2026-08-24

- Role / unit: Lead / `unit-drag-gap-diagnostic-contract` / attempt 01 correction 01
- Result: Accepted after the one authorized same-scope pre-review correction.
- Files / commit: `kwin/src/controller-interactive-drag.ts`, `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`, and deterministic build output `kwin/contents/code/main.js`; no commit.
- Verification: Build, typecheck, diagnostics bundle/test (45 tests/5 suites, 45 passed/0 failed/0 skipped), and reflow bundle/test (11 tests/1 suite, 11 passed/0 failed/0 skipped) passed. The inspected bundle diff matches the source diagnostic additions and was not hand-edited.
- Notes: `finalLeaves` now records every final leaf ID, rectangle, occupancy, and occupant IDs. Target, output/work area, dragged client, occupied-client frame geometry or unavailable, ordering, and explicit unsupported-event `postSettle` remain present. Independent-review trigger assessed: none; focused static coverage is proportionate and no security, migration, public contract, destructive, or broad-subtle change was introduced.
- Change-wide telemetry: implementation dispatches 1, dispatch-invalids 0, pre-review corrections 1, finding-fix corrections 0, reviews 0, resets 0, broad gates 0, Worker/Lead tool-call proxies not reported, acceptance criteria moved 2, no-progress streak 0.

## 2026-08-24

- Role / unit: Worker / `unit-drag-gap-diagnostic-contract` / attempt 01
- Result: Decision needed before acceptance or the one available same-scope correction.
- Files / commit: `kwin/src/controller-interactive-drag.ts` and `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`; required build regenerated `kwin/contents/code/main.js`; no commit.
- Verification: Build, typecheck, diagnostics bundle/test (45 tests, 45 passed), and reflow bundle/test (11 tests, 11 passed) passed. No broad or live gate ran.
- Notes: The payload includes only the dragged client's final leaf, rather than every final leaf's rectangle and occupancy. The required deterministic build changed tracked `kwin/contents/code/main.js`, which is outside the approved implementation-path list. No restore or correction was authorized.
- Change-wide telemetry: implementation dispatches 1, dispatch-invalids 0, corrections 0, reviews 0, resets 0, broad gates 0, Worker/Lead tool-call proxies not reported, acceptance criteria moved 0, no-progress streak 1.

## 2026-08-24

- Role / unit: Lead / `unit-drag-gap-diagnostic-contract` / correction 01 authorized
- Result: Orchestrator approved the deterministic generated bundle as an allowed build-output path and authorized the first and only same-scope pre-review correction.
- Files / commit: `plan.md`, `log.md`, and `state.md`; no commit.
- Verification: Scope permits `kwin/contents/code/main.js` only through the canonical build, never by hand; the correction must complete every-final-leaf payload coverage and rerun only focused gates.
- Notes: This is not a production behavior correction, a new implementation attempt, or an independent review.
- Change-wide telemetry: implementation dispatches 1, dispatch-invalids 0, corrections 0 before correction execution, reviews 0, resets 0, broad gates 0, acceptance criteria moved 0, no-progress streak 1.

## 2026-08-24

- Role / unit: Lead / focused-gate planning reconciliation / none
- Result: Orchestrator approved the repository-root `kwin/tests/...` esbuild input paths; this is planning-command reconciliation, not implementation or a correction.
- Files / commit: `plan.md`, `log.md`, and `state.md`; no commit.
- Verification: Build passed; diagnostics bundle passed and its focused test reported 44 tests/5 suites, 44 passed/0 failed/0 skipped; reflow bundle passed and its focused test reported 11 tests/1 suite, 11 passed/0 failed/0 skipped; no generated `kwin/contents/code/main.js` diff.
- Notes: The baseline Worker stopped after its final repository-wide diff check saw the expected documentation change; its focused gate evidence is complete. `unit-drag-gap-diagnostic-contract` is ready for first dispatch. Broad gates were not rerun.
- Change-wide telemetry: implementation dispatches 0, dispatch-invalids 0, corrections 0, reviews 0, resets 0, broad gates 0, acceptance criteria moved 0, no-progress streak 0.
