# Log: Controller Source Split

Append-only record of artifact creation and approved execution checkpoints.

## 2026-08-23 - artifact creation

- Role / unit: Worker / planning artifacts / unit 01 not started.
- Result: created the approved Expanded `spec.md`, `plan.md`, `log.md`, and
  `state.md`; updated the active controller-split backlog entry with the change
  link and downstream COSMIC directional-move dependency wording.
- Files / commit: `docs/changes/controller-source-split/{spec.md,plan.md,log.md,state.md}`
  and `docs/backlog.md`; no commit.
- Verification: no production source, tests, generated bundle, dependencies, or
  live KWin state changed. No live KWin operations occurred.
- Notes / blocker: none.

## 2026-08-23 - unit 01 acceptance

- Role / unit: Lead / unit 01 - config and catalog.
- Result: extracted configuration interpretation, profile/catalog ownership,
  and pure automatic-target contracts to `kwin/src/controller-config.ts`.
  `controller.ts` remains the sole public facade and composition root, retaining
  its public exports through a direct re-export. Session/output state and
  shortcut registration callbacks remain in the controller.
- Review: corrected one same-scope drift so `TILING_ALGORITHMS` retains its
  direct `PRESET_KINDS` ownership rather than a copied catalog. Static import
  review found `controller-config.ts` depends only on `logic` and
  `preset-catalog`; no controller import, extracted-domain import, or cycle.
  The module is 536 lines. Static inspection retained one production
  `flashFocusedGroup()` invocation and did not alter structural mutation/flush.
- Verification: focused config/catalog tests 167 tests / 19 suites / 0 failures;
  both TypeScript configurations clean; full JS suite 965 tests / 91 suites /
  0 failures. Two normal bundle builds produced SHA-256
  `1fe1e11a959004a1d8a2636cf4148776b864257fbfe0d018efaa4faccc1e6ad3`.
  `npm test` also reported its current script-local check as 255 passes / 0
  failures; Unit 01 has no dogfood checkpoint gate. No live KWin operations.
- Notes / blocker: none. Circuit breakers remain 0.

## 2026-08-23 - unit 02 acceptance

- Role / unit: Lead / unit 02 - topology and workspace state.
- Result: extracted pure topology and occupancy helpers to
  `controller-topology.ts`, pure geometry predicates and drag diagnostics to
  `controller-geometry.ts`, and session output-key/workspace state helpers to
  `controller-workspace-state.ts`. `controller.ts` remains the sole facade and
  composition root, retaining all pre-existing public workspace exports.
- Review: topology imports only `boundary` and the existing split adapter at
  runtime; geometry and workspace modules import only `boundary` at runtime.
  Type-only imports erase from the bundle. No extracted module imports
  `controller.ts` or another extracted domain, and no cycle exists. Adapter
  ordering, opaque split return, zero-extent guard, N-ary direct-child decoding,
  occupancy identity, output-key identity, and literal-last-index trailing-empty
  handling remain unchanged. Static inspection retained one production
  `flashFocusedGroup()` invocation and did not alter structural mutation/flush.
- Verification: focused topology/workspace tests 47 tests / 8 suites / 0
  failures; both TypeScript configurations clean; full JS suite 965 tests / 91
  suites / 0 failures. The established `bash scripts/dogfood-install.test.sh`
  gate reported 347 passes / 0 failures; this is distinct from `npm test`'s
  script-local 255-pass / 0-failure check. Two normal bundle builds matched
  SHA-256 `778b54716f476f907373747d0c98f1519902362b9ae4dbb3433ffa7bb32e1c05`.
  No live KWin operations.
- Notes / blocker: modules are 372, 65, and 158 lines; no size exception or
  circuit breaker. Unit 03 has not started.

## 2026-08-23 - unit 03 acceptance

- Role / unit: Lead / unit 03 - narrow shared state and capabilities.
- Result: added private, named controller composition seams for only the
  later input/action, drag/reflow, reconstruction, and workspace state needs.
  `TileController` remains the sole state owner, composition root, and public
  facade. No dispatch/domain behavior or shortcut registration callbacks moved;
  no public API, test file, or product behavior changed.
- Review: one fresh independent review found 3 P1 broad-context issues: the
  original combined drag/watch/outline seam, combined workspace lifecycle seam,
  and a mutable pending-rebuild getter. The one permitted same-scope correction
  split the first two into focused contracts and removed the mutable getter.
  Findings: 3 total, 3 corrected, 0 open. No initialization/identity/order
  drift, cycles, mutation-observer duplication, speculative fields, public API
  drift, or missing-test finding remained. No second independent review ran.
- Verification: focused controller characterization 173 tests / 13 suites / 0
  failures; both TypeScript configurations clean; full JS suite 965 tests / 91
  suites / 0 failures with 0 skipped; `npm test` script-local 255 passes / 0
  failures; established dogfood `bash scripts/dogfood-install.test.sh` 347
  passes / 0 failures. Two normal bundle builds matched SHA-256
  `af5dfd49f430bc803d7289824201d2e1b421aab27bf28b318bd9cf13d82625a8`.
  Static import inspection found `entry.ts` is the sole runtime importer of
  `controller.ts`; no extracted domain imports the controller or a sibling
  domain. Static symbol inspection retained one production
  `flashFocusedGroup()` call and one `flushStructuralMutation()` implementation.
  No live KWin operations occurred.
- Notes / blocker: none. Circuit breakers remain 0. Unit 04 is next and has
  not started.

## 2026-08-23 - unit 04 attempt 1 reconciliation

- Role / unit: Lead / unit 04 / attempt 1 cancellation and recovery decision.
- Result: recorded one cancelled, non-resumable attempt. Reconciled the actual
  candidate instead of its handover summary: `controller.ts` delegates input
  and window actions to new narrow-capability domains, but retains obsolete
  commented legacy implementations. The generated bundle is unverified and
  `git diff --check` reports 22 trailing-whitespace findings in it.
- Files / commit: candidate ownership is `kwin/src/controller.ts`,
  `kwin/src/controller-input-actions.ts`,
  `kwin/src/controller-window-actions.ts`, and `kwin/contents/code/main.js`;
  no commit. Unrelated untracked paths were not inspected or changed.
- Verification: no valid candidate-specific verification exists. Static
  reconciliation found no runtime import from either action domain to
  `controller.ts` or the sibling domain, and one production
  `flashFocusedGroup()` implementation/call site with the existing structural
  mutation/flush implementation.
- Notes / blocker: Unit 04 counts are attempts 1, cancellations 1, corrections
  0, independent reviews 0. Change-wide independent reviews remain 1 for Unit
  03; circuit breakers remain 0. One bounded attempt 2 recovery is available.

## 2026-08-23 - unit 04 independent review

- Role / unit: independent Worker review / unit 04 / attempt 2.
- Result: found one P1 ownership breach: `controller.ts` retains resize-mode
  state, entry/exit, and focus-versus-resize routing while the input domain
  exposes only the resize step. This violates the approved input action boundary;
  build and behavioral evidence do not establish source ownership.
- Files / commit: review-only; no files changed and no commit.
- Verification: review inspected the actual candidate and the recovery evidence:
  two matching normal builds, clean dual typecheck, 965 tests / 91 suites / 0
  failures / 0 skipped, dogfood 347/0, and clean `git diff --check`.
- Notes / blocker: Unit 04 independent reviews are now 1; change-wide reviews
  are 2 including Unit 03. One same-scope correction pass is available for this
  sole finding. Circuit breakers remain 0.

## 2026-08-23 - unit 04 acceptance

- Role / unit: Lead / unit 04 / attempt 2 recovery and confirmation.
- Result: accepted the recovered extraction. The Worker removed the obsolete
  commented facade implementations and regenerated the bundle. The sole P1
  independent-review finding was corrected by moving resize-mode state,
  entry/exit, and focus-or-resize routing into the input domain; Lead
  confirmation checked only that finding. No second review ran.
- Files / commit: `kwin/src/controller.ts`,
  `kwin/src/controller-input-actions.ts`,
  `kwin/src/controller-window-actions.ts`, and `kwin/contents/code/main.js`;
  no test files changed and no commit.
- Verification: two normal `npm --prefix kwin run build` runs matched SHA-256
  `3434ccd9de8b264665083f83ba24485d0ba37ab78f78ea1dd34e88c4cf2b9e52`;
  `npm --prefix kwin run typecheck` clean for both configurations;
  `npm --prefix kwin test` 965 tests / 91 suites / 0 failures / 0 skipped;
  `bash scripts/dogfood-install.test.sh` 347 passes / 0 failures; `git diff
  --check` clean. Static inspection retained facade action/shortcut ownership,
  type-only topology imports, no forbidden runtime domain imports, one
  production `flashFocusedGroup()` invocation, and one structural
  reporting/flush path. No live KWin operations occurred.
- Notes / blocker: Unit 04 counts are attempts 2, cancellations 1, corrections
  1, independent reviews 1. Change-wide independent reviews are 2 including
  Unit 03; circuit breakers remain 0. The dogfood script emitted its existing
  non-fatal temporary-data `find` warning. Unit 05 is next after this accepted
  checkpoint is committed.

## 2026-08-23 - unit 05 attempt 1 reconciliation

- Role / unit: Lead / unit 05 / attempt 1 pre-dispatch reconciliation.
- Result: Unit 04 is accepted and committed at `641f4cf7c327f08cc156a9c19b3c19afcf7ca1cf`; Unit 05 is unblocked. The current facade retains a coherent reflow, observer/signal lifecycle, and interactive-drag extraction boundary. Reconstruction, dwindle, workspace flows, public facade ownership, and shortcut registration remain excluded.
- Baseline / scope: `git status --short` reported only the declared unrelated untracked `CMakeFiles/`, `test-output`, and `Project Technical Report and Implementation Plan.md`; these paths are not inspected or touched. Artifact accounting reconciles to Unit 04 attempts 2, cancellations 1, corrections 1, independent reviews 1; change-wide independent reviews 2; circuit breakers 0. The accepted source baseline is 965 tests / 91 suites / 0 failures / 0 skipped, clean dual typecheck, dogfood 347/0, and bundle SHA-256 `3434ccd9de8b264665083f83ba24485d0ba37ab78f78ea1dd34e88c4cf2b9e52`.
- Notes / blocker: none. Unit 05 attempt 1 is dispatched as one bounded implementation slice; its required independent review has not run.

## 2026-08-23 - unit 05 attempt 1 preflight stop

- Role / unit: implementation Worker / unit 05 / attempt 1.
- Result: stopped before code inspection or modification because the host Worker protocol required the parent Lead identity in its dispatch brief. No implementation or verification ran.
- Files / commit: no files changed and no commit.
- Notes / blocker: this counts as Unit 05 attempt 1 under semantic-unit accounting. No correction or independent review occurred. The one remaining attempt is re-briefed with the required identity; circuit breakers remain 0.

## 2026-08-23 - unit 05 attempt 2 preflight stop and circuit breaker

- Role / unit: implementation Worker / unit 05 / attempt 2.
- Result: stopped before code inspection or modification because its host treated the declared unrelated untracked `CMakeFiles/`, `test-output`, and `Project Technical Report and Implementation Plan.md` paths as an ownership conflict, despite explicit instructions not to inspect or touch them. It also reported a host role mismatch: actual Worker, configured Lead, parent Lead OpenCode.
- Files / commit: no implementation files changed, staged, committed, deleted, or built. No verification ran.
- Notes / blocker: Unit 05 now has attempts 2, corrections 0, independent reviews 0. Dispatching a third attempt would violate the semantic attempt limit, so the circuit breaker is 1. No independent review can run without a reviewable candidate. Escalate for an Orchestrator host-resolution/reset decision; no source recovery is required.

## 2026-08-23 - approved Unit 05 semantic circuit-breaker reset

- Role / unit: Lead / frozen unit 05; approved replacement units `unit-05a-reflow-observers` and `unit-05b-drag-deferred-work`.
- Result: the Orchestrator approved the semantic reset without a specification or governance change. Original Unit 05 is permanently frozen at attempts 2, cancellations 0, corrections 0, independent reviews 0, and circuit breaker 1 because both malformed preflights ended before source work, verification, or a candidate existed.
- Plan / dependencies: Unit 05A owns reflow and non-interactive lifecycle observers, including eligibility token cancellation; Unit 05B owns interactive drag and deferred-work coordination. Unit 06 now waits for accepted 05A and accepted, independently reviewed 05B; Unit 07 waits for both replacements and Unit 06. The Unit 05 independent-review checkpoint is placed after 05B only.
- Ownership: `controller.ts` remains the sole composition root and owner of structural mutation reporting/flush state and the single production `flashFocusedGroup()` invocation. The replacements use only existing narrow capabilities.
- Files / commit: updated `plan.md`, `state.md`, and this append-only log; no production files, tests, generated bundle, staging, commit, push, or live operation.

## 2026-08-23 - unit-05a-reflow-observers attempt 01 acceptance

- Role / unit: Lead / `unit-05a-reflow-observers` / attempt 01.
- Result: accepted. The Worker extracted selected-overlay reflow state and execution, lifecycle reflow callbacks, and one-shot eligibility reevaluation/cancellation into `controller-reflow-observers.ts`. `controller.ts` remains the composition root and retains facade fan-out order.
- Lead inspection: the new 393-line module imports only boundary plus type-only logic/catalog dependencies and has no runtime extracted-domain sibling import. The facade cancels deferred eligibility before its existing reflow/removal processing; deferred eligibility calls the existing placement, cleanup, and intent-drain sequence. The sole structural pending/flush implementation and sole production `flashFocusedGroup()` invocation remain in `controller.ts`.
- Verification: focused existing reflow/observer and eligibility suites 46 tests / 3 suites / 0 failures; dual typecheck clean; full suite 965 tests / 91 suites / 0 failures / 0 skipped; dogfood 347/0; `git diff --check` clean; two normal builds matched generated-bundle SHA-256 `fbbfb573f9e5ab3e57a2edcedd9a424112a66da71afd7f2b768719fdd10275c0`.
- Files / commit: added `kwin/src/controller-reflow-observers.ts`; modified `kwin/src/controller.ts` and generated `kwin/contents/code/main.js`; updated `plan.md`, `state.md`, and this log. No tests changed, no independent review is due, and no staging, commit, push, or live operation occurred.
- Notes / blocker: Unit 05A counts are attempts 1, cancellations 0, corrections 0, independent reviews 0. Unit 05B is next but not dispatched. Dogfood emitted its existing non-fatal temporary-data `find` warning.

## 2026-08-23 - unit-05b-drag-deferred-work acceptance

- Role / unit: Lead / `unit-05b-drag-deferred-work` / attempt 01 and correction 01.
- Result: accepted. The implementation extracted interactive watches, drag state, outlines, geometry/drop recovery, snapshots, and drag-specific deferred-work coordination into `controller-interactive-drag.ts`. `controller.ts` remains the public facade and composition root, retains deferred removal-collapse execution/yield, and exposes it to the drag domain only through a narrow callback.
- Independent review: three findings: P1 missing explicit QRectF geometry capture, P2 runtime extracted-domain imports, and P2 disabled-path drag-state clearing. The sole same-scope correction restored explicit `x`, `y`, `width`, and `height` capture, replaced all runtime sibling imports with narrow facade helper callbacks while retaining type-only references, and restored outline-only disabled cleanup. Lead confirmation checked only these findings; no second independent review ran or is available.
- Process compliance: the implementation Worker omitted its required identity-preflight line. No role mismatch was reported or found; the Lead inspected the actual diff and evidence, and this defect is recorded without reducing technical acceptance.
- Lead inspection: interactive lifecycle fan-out remains in the facade; the drag domain owns signal disconnects, outline cleanup, live-drag detection, owed invariants, and `armedDeferredRemoval`. `controller.ts` remains the sole owner of the structural pending flag, reporting/flush implementation, and production `flashFocusedGroup()` invocation. Static inspection found `entry.ts` is the sole runtime importer of `controller.ts` and no runtime extracted-domain sibling import from the drag module.
- Verification: focused existing interactive-watch, drag, and outline suites 43 tests / 3 suites / 0 failures; `npm --prefix kwin run typecheck` clean for both configurations; `npm --prefix kwin test` 965 tests / 91 suites / 0 failures / 0 skipped; `bash scripts/dogfood-install.test.sh` 347 passes / 0 failures; `git diff --check` clean; two normal builds matched generated-bundle SHA-256 `cd4145bd8b0d2b27d1e634483ab6ddb7936abb548a66382da72f268842c242cc`.
- Files / commit: added `kwin/src/controller-interactive-drag.ts`; modified `kwin/src/controller.ts` and generated `kwin/contents/code/main.js`; updated `plan.md`, `state.md`, and this log. No tests changed, no staging, commit, push, dependency edit, or live operation occurred.
- Accounting: Unit 05B attempts 1, cancellations 0, corrections 1, independent reviews 1; change-wide independent reviews 3; circuit breakers remain 1 for frozen original Unit 05 only. Unit 06 is the next approved successor.

## 2026-08-23 - unit-06-reconstruction-dwindle-workspaces attempt 01 host stop

- Role / unit: Lead / `unit-06-reconstruction-dwindle-workspaces` / attempt 01.
- Result: the fresh implementation Worker stopped at the mandatory identity preflight. It reported actual role Worker and parent role Lead, but host configured role `OpenCode` rather than required `worker-openai`. The parent Lead host configuration likewise reports `OpenCode` rather than requested `lead-openai`; this mismatch was disclosed before dispatch.
- Files / commit: no source, test, generated bundle, staging, commit, push, or live operation occurred. No candidate exists for inspection or recovery.
- Verification: none - the preflight stop occurred before code inspection or modification.
- Notes / blocker: Unit 06 accounting is attempts 1, cancellations 0, corrections 0, independent reviews 0. Re-dispatch under the unchanged host configuration would repeat the same preflight mismatch and is not authorized as a same-class loop. Escalate to the Orchestrator for host-resolution or a materially different execution reset. Change-wide independent reviews remain 3; the sole circuit breaker remains frozen original Unit 05.

## 2026-08-23 - unit-06-reconstruction-dwindle-workspaces attempt 02 resolution

- Role / unit: Lead / `unit-06-reconstruction-dwindle-workspaces` / attempt 02.
- Result: Orchestrator resolved attempt 01 as a malformed role-preflight contract, not an unavailable `worker-openai` selector. The Task selector remains `worker-openai`; the required child configured process role is Worker, actual role is Worker, and parent role is Lead. An `OpenCode` host persona label is reportable but not blocking.
- Files / commit: record-keeping only; no source, test, generated bundle, staging, commit, push, or live operation occurred.
- Notes / blocker: attempt 02 is dispatched as the final authorized Unit 06 attempt. No third attempt is available. Parent provenance is configured Lead selector `lead-openai`, task/session `ses_fd14d46c3ffeDfiBTWCzNtq5Vo`.

## 2026-08-23 - unit-06-reconstruction-dwindle-workspaces independent review

- Role / unit: independent Worker review / `unit-06-reconstruction-dwindle-workspaces` / attempt 02.
- Result: three findings in the actual candidate: P1 inert-scope removal no longer emits `ownership-inert-ignored:removal`; P2 duplicate unreachable reconstruction methods remain in `controller.ts`; P2 extracted layout/workspace domains expose mutable state bags and widened/unused capabilities.
- Files / commit: review-only; no files changed and no commit.
- Verification: reviewed the actual source and candidate evidence: dual typecheck clean; 965 tests / 91 suites / 0 failures / 0 skipped; dogfood 347/0; two normal builds matched SHA-256 `09b2ee5f0a89d6e4b772699081f96971afe0d1856af8255a3a37067d300fc9a8`; `git diff --check` clean.
- Notes / blocker: Unit 06 independent reviews are 1 and no second review is available. The single same-scope correction is dispatched solely for this finding set; no third attempt is available.

## 2026-08-23 - unit-06-reconstruction-dwindle-workspaces acceptance

- Role / unit: Lead / `unit-06-reconstruction-dwindle-workspaces` / attempt 02, correction 01.
- Result: accepted. Extracted reconstruction/dwindle/layout coordination and deferred workspace queues to `controller-layout-domain.ts` and `controller-workspace-domain.ts`, with `controller.ts` retained as facade, composition root, and semantic state authority. The sole independent review found a missing inert-removal diagnostic, duplicate reconstruction methods, and mutable/widened domain contracts; correction 01 resolved all three and Lead inspection confirmed the finding set only.
- Lead inspection: layout domain is 387 lines and workspace domain 64 lines. They have no runtime controller or sibling-domain import, expose no mutable collections, and use facade-owned state through explicit operations. The facade retains shortcut callbacks, the sole `flushStructuralMutation()` implementation, and the sole production `flashFocusedGroup()` invocation. Geometry ordering remained confined to the existing `custom-tile-split.ts` implementation. Deferred removal retains the 05B callback ordering while Unit 06 owns its collapse/reconstruction execution and yield.
- Verification: focused reconstruction, dwindle/insertion/removal, deferred-recovery, workspace-mode, trailing-empty, output-isolation, and deferred-removal coverage was included in the reported full suite; dual typecheck clean; full suite 965 tests / 91 suites / 0 failures / 0 skipped; dogfood 347/0; `git diff --check` clean; two normal builds matched SHA-256 `468ddf82db849c7d9ea50a1234709106ea2903353dc16bdc737d2c7f87b816a1`.
- Files / commit: added `kwin/src/controller-layout-domain.ts` and `kwin/src/controller-workspace-domain.ts`; modified `kwin/src/controller.ts` and generated `kwin/contents/code/main.js`; updated `plan.md`, `state.md`, and this log. No tests, dependencies, public APIs, staging, commit, push, or live operation changed.
- Notes / blocker: Unit 06 counts are attempts 2, cancellations 0, corrections 1, independent reviews 1; change-wide independent reviews are 4. Original Unit 05 remains the sole circuit breaker. The implementation Worker omitted its required process-role first line in both attempt 02 and correction 01 reports; recorded as a process-compliance defect with no technical acceptance gap. Unit 07 is the approved successor.

## 2026-08-23 - unit-07-facade-bundle-finalization acceptance

- Role / unit: Lead / `unit-07-facade-bundle-finalization` / attempt 01, review 01.
- Result: accepted. Removed only obsolete direct facade pass-throughs from `controller.ts`; retained it as the sole public facade and composition root; regenerated the bundle normally. No test, package, typecheck, public-export, or extracted-domain implementation changed.
- Lead inspection: actual finalization diff is 44 additions / 177 deletions in the 5,053-line facade and 44 additions / 154 deletions in the generated bundle. `entry.ts` remains the sole runtime controller importer; extracted-domain imports are type-only; shortcut callbacks remain in the facade; one production `flashFocusedGroup()` invocation and one structural reporting/flush path remain; geometry ordering remains localized to `custom-tile-split.ts`.
- Verification: `npm --prefix kwin run typecheck` clean for both configurations; `npm --prefix kwin test` 965 tests / 91 suites / 0 failures / 0 skipped; `bash scripts/dogfood-install.test.sh` 347 assertions / 0 failures; `git diff --check` clean; two normal builds matched generated-bundle SHA-256 `51af50efc153ba82dfaa2543ba973b443ef6b92f2c098409ae46e9a197c8f02b`. No live operation ran.
- Independent review: review 01 inspected the full active-change and finalization diffs with the final evidence and returned no findings. No correction or confirmation was required.
- Notes / blocker: Unit 07 counts are attempts 1, cancellations 0, corrections 0, independent reviews 1; change-wide independent reviews are 5. Original Unit 05 remains the sole frozen circuit breaker and is outside Unit 07 accounting. Both Unit 07 Workers omitted their required process-role assertion first line; this is a process-compliance defect without a role mismatch or technical acceptance gap. No blocker remains; return to Orchestrator for alignment and the later completion transaction.
