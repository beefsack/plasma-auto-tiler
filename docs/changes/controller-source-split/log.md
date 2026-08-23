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
