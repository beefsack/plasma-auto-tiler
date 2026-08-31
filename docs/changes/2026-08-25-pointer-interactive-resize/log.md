# Change Log: Pointer Interactive Resize

- 2026-08-25 | planning | User approved the separate pointer-resize
  specification. Orchestrator approved Standard artifact creation and the
  semantic plan. KWin 6.7.4 owns native divider selection, ratio/geometry
  mutation, reflow, floor, rounding, and final Escape/release state; controller
  scope is observation only. Startup policy: agent commits/pushes false, user
  commit required, staging prohibited until final completion, candidate
  preservation none unless triggered, cleanup owner Lead. Counters begin at
  zero. `unit-04`/`L-01` is blocked pending explicit live authorization and an
  exact disposable/restoration layout.
- 2026-08-25 | baseline-dispatch | Fresh read-only baseline Worker dispatched
  for R-02 through R-07. R-01 is not run because its fixture does not yet exist;
  L-01 is not run.
- 2026-08-25 | baseline | R-02 `npm --prefix kwin run typecheck` exited 2
  with 7 TypeScript errors in `tests/controller-cosmic-directional-movement.test.ts`.
  Per stop-on-first-failure, R-03 through R-07 did not run; no bundle byte/SHA
  baseline exists. No files changed and targeted `kwin/` tracked diff inspection
  was empty. This is an unattributed baseline blocker outside pointer-resize
  scope; no COSMIC material was read or changed.
- 2026-08-25 | baseline-retry | After the parked COSMIC Lead resolved ownership,
  fresh read-only baseline evidence passed: R-02 and R-03 exit 0; R-04 exit 0
  with 255 passes; R-05 exit 0 with 207 passes; R-06 exit 0 with 994 passes and
  0 failures; R-07 exit 0. The canonical bundle is 362668 bytes with SHA-256
  `8d547fe268cf3ed4ebc1345675a36b2d906318d6f4a501cdaba9f5b2ef6a4780` and has
  no tracked diff. Change-wide broad-gate runs: 1; read-only baseline dispatches:
  2. No source, test, plan, or log files were changed by the Worker.
- 2026-08-25 | unit-01/attempt-01 | Fixture-only Worker changed
  `kwin/tests/controller-fixtures.ts` and
  `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`. R-01 exited 0
  with 1 focused test passed and 0 failed; R-02 exited 0; the temporary focused
  bundle was cleaned up and no production bundle changed. Lead inspection found
  KWin-native fixture ownership, payload-free start/finish, no stepped signal,
  edges/corners, nested and multi-child divider selection, 15% floor, rounding,
  Escape final-state retention, and invalidation coverage. Mandatory independent
  fixture review is pending. Change-wide implementation dispatches: 1;
  no-progress streak: 1.
- 2026-08-25 | unit-01 independent-review | One read-only review found two
  medium findings. The edge/corner loop asserts event prefixes, write count, and
  owner but not per-direction geometry/ratios; it also exercises Escape only for
  `bottom-right`, leaving ordinary corner finish untested. It asserts only start
  then mutation order, while invalidation emits before clearing active state and
  is tested only before mutation, leaving callback-time finish and in-flight
  cancellation unproven. The finding set is valid after Lead reconciliation.
   Change-wide independent reviews: 1. One finding-fix correction remains within
   budget, but this Lead reaches the three-Worker scheduling threshold and does
   not dispatch it.
- 2026-08-25 | unit-01/finding-fix-01 | Fresh Worker changed only
  `kwin/tests/controller-fixtures.ts` and
  `kwin/tests/controller-drag-diagnostics-and-resize.test.ts` to add explicit
  per-edge/corner geometry and ratio assertions, ordinary finish ordering,
  Escape ordering, and in-flight invalidation clearing. R-01 failed: the new
  left-edge assertion expects native writes in neighbor-then-subject order, but
  the fixture writes subject `focus` then neighbor `focus-left`. R-02
  `npm --prefix kwin run typecheck` exited 0. Lead diff inspection confirmed no
  production/controller changes and that invalidation clears active state before
  signal emission. This consumes the sole finding-fix correction; no confirmation
  Worker was dispatched. Change-wide implementation dispatches: 2; finding-fix
  corrections: 1; no-progress streak: 2. Escalated with the failing fixture/test
  diff preserved and no staging, commit, push, live operation, or broad gate.
- 2026-08-25 | unit-01/reset-01/attempt-02 pre-dispatch | User approved the
  Orchestrator-approved changed-kind reset. The semantic boundary now treats
  internal KWin tile-write sequence as non-contractual and accepts identity-keyed
  final per-tile geometry/ratios, unordered subject/neighbor ownership and
  counts, ordinary edge/corner finish, and in-flight invalidation cleanup. No
  specification clause required write order. Reset count is 1 before source
  dispatch; inherited implementation dispatches remain 2 and no-progress streak
  remains 2. R-01/R-02 literals and baselines are unchanged.
- 2026-08-25 | unit-01/reset-01/attempt-02 | Fresh Worker changed only
  `kwin/tests/controller-fixtures.ts` and
  `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`. The reset replaces
  ordered-write assertions with stable-identity final geometry/ratio checks and
  unordered selected subject/neighbor native ownership/count checks for every
  edge and corner. Ordinary finish, Escape final state, nested/multi-child
  selection, floor, rounding, no stepped signal, and callback-time invalidation
  clearing remain asserted. R-01 exited 0 with 1 focused test passed and 0
  failed; R-02 exited 0. Lead inspection found no production/controller change,
  no reset regression, and a clean scoped diff check. Change-wide implementation
  dispatches: 3; no-progress streak remains 2 pending limited confirmation.
- 2026-08-25 | unit-01/reset-01 confirmation and acceptance | Fresh read-only
  confirmation Worker inspected only the reset boundary and the two fixture/test
  paths. It confirmed the original finding set is clear: all eight edges/corners
  have identity-keyed final geometry/ratio evidence; native ownership and
  per-tile write counts are unordered; ordinary corner finish and lifecycle order
  are explicit; all invalidation callbacks observe cleared state and cannot
  finish. It found no reset regression in edge/corner/nested/multi-child/floor/
  rounding semantics, native ownership, or fixture-production separation. No
  files changed and no gates were run by confirmation. Lead accepts `unit-01`.
  Change-wide acceptance criteria moved: 1; no-progress streak resets to 0.
   This Lead reaches its three-Worker scheduling boundary and returns the exact
   `unit-02` handoff without dispatching it.
- 2026-08-25 | unit-02/attempt-01 | Fresh Worker added an isolated native
  pointer-resize observation state, payload-free start/finish adapter typing,
  KWin 6.7.4 declaration provenance, and focused controller coverage in the
  approved watcher/controller, adapter, declaration, fixture, and test paths.
  R-01 exited 0 with 1 focused test passed and 0 failed. R-02 stopped with four
  TypeScript errors at the accepted fixture's two payload-bearing start/finish
  callback assertions after those signals were correctly typed payload-free.
  Lead inspection classifies this as one same-scope pre-review test-only typing
  correction, not a native-contract mismatch or semantic expansion.
  Change-wide implementation dispatches: 4; pre-review corrections: 1;
  no-progress streak: 1. No broad/live gate, staging, commit, or push occurred.
- 2026-08-25 | unit-02/pre-review-correction-01 pre-dispatch | Lead classified
  the R-02 result as a test-only payload-free callback typing correction with
  unchanged semantic scope. Fresh Worker dispatch authorized; implementation
  dispatches become 5 and unit-02 attempts become 2. R-01/R-02 literals and
  baselines remain unchanged.
- 2026-08-25 | unit-02/pre-review-correction-01 | Fresh Worker changed only
  `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`, replacing the
  invalid payload parameters in payload-free start/finish assertions with
  invocation counters. R-01 exited 0 with 1 focused test passed and 0 failed;
  R-02 exited 0. Lead inspection confirms separate resize and drag state,
  payload-free adapter attachment, no resize stepped dependency, no controller
  geometry/ratio/focus/topology writes, guarded final decode/clear, focused
  scope and invalidation coverage, move-drag coverage, and KWin 6.7.4
  declaration provenance. The unit is technically review-ready.
  Change-wide no-progress streak: 2 pending acceptance; independent reviews:
  2 with unit-02's required read-only review in progress. No broad/live gate,
  staging, commit, or push occurred.
- 2026-08-25 | unit-02/independent-review-01 | Fresh read-only Worker changed
  no files and did not rerun gates. It accepted observer-state isolation,
  payload-free declaration/adapter/harness/test typing, KWin-native
  geometry/ratio/focus/topology/cancellation/reflow ownership, no tiled stepped
  dependency, move-drag non-regression, and KWin 6.7.4 declaration provenance.
  It found one bounded set: F-01 (medium) controller output/tile invalidation
  coverage is incomplete and the watcher does not attach tile changes; F-02
  (low) controller release completion lacks a direct assertion; F-03 (low) the
  plan retained a stale payload-typing risk. Lead accepts the classification,
  corrects F-03 as record-keeping, and leaves F-01/F-02 unaccepted for one
  possible finding-fix correction. Change-wide independent reviews: 2;
  unit-02 remains unaccepted. No broad/live gate, staging, commit, or push
  occurred.
- 2026-08-25 | unit-02/finding-fix-01 | User-authorized fresh Worker changed
  only `kwin/src/entry.ts`, `kwin/tests/controller-fixtures.ts`, and
  `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`. It attached
  `tileChanged` to the invalidation watcher and added focused controller
  output/tile cleanup and release/Escape finish coverage. R-01 exited 0 with 1
  focused test passed and 0 failed. R-02 failed because the test setup assigns
  the native fixture's payload-free `outputChanged` and `tileChanged` signals
  to `TestSignal1<unknown>` fields. Lead diff inspection finds no geometry,
  ratio, focus, topology, cancellation/restoration, tiled-stepped, move/drop,
  or native-reimplementation regression, but the failed canonical gate leaves
  F-01/F-02 unaccepted. This consumes unit-02's only finding-fix correction.
  Change-wide implementation dispatches: 6; finding-fix corrections: 2;
  no-progress streak: 3. The third unit-02 implementation attempt without an
  acceptance movement trips the attempt/no-progress breakers: unit-02 is
   parked and escalated with the diff preserved. No confirmation Worker,
   broad/live gate, staging, commit, or push occurred.
- 2026-08-25 | reset-02 approval | Orchestrator approved and user explicitly
  approved an exceptional second changed-kind reset, checkpoint-C recovery, one
  ordered preservation container through 2026-09-08, restoration of only the
  five pointer candidate paths to verified checkpoint C, and exactly one
  no-progress-waived semantic dispatch for `unit-02a-signal-contract`. This is
  not a repair, correction, relabelled `unit-02` attempt, or no-progress reset.
  Historical source dispatch classification is: semantic `unit-01/attempt-01`,
  `unit-01/reset-01/attempt-02`, and `unit-02/attempt-01`; finding-fix
  corrections `unit-01/finding-fix-01` and `unit-02/finding-fix-01`; and
  pre-review correction `unit-02/pre-review-correction-01`. Preserve the
  recorded no-progress streak 3 rather than retroactively recalculating it.
  No source, preservation, staging, commit, push, or live operation has yet
  occurred under reset-02.
- 2026-08-25 | recovery-c | Fresh Worker constructed checkpoint C in an
  isolated base `6466c99dd497779d8499e0fef41cc5618593bff2` context. The
  base-to-C component (`88da3cdba5cbdb6bd3a40f070279c943ce090dfda91024da7f4c2ea6aab1743e`)
  changes only the accepted unit-01 test paths; R-01 passed with 1 focused test
  and 0 failures and R-02 exited 0. Lead inspection confirmed accepted native
  fixture coverage. Ordered base-to-C then C-to-current application reproduced
  the complete five-path candidate. The single retained container
  `unit-02-reset-02-candidate.tar` has SHA-256
  `20459f88e167342f175923322c57fde0e1f9104e288e7f89e85039ede4f2010a` and
  expires 2026-09-08. Under explicit destructive authorization, Lead restored
  only the five candidate paths to C; index, backlog, process artifacts,
  COSMIC preservation, and unrelated untracked paths remain untouched.
- 2026-08-25 | unit-02a-signal-contract/attempt-01 | The sole user-approved
  no-progress-waived semantic Worker changed only
  `kwin/tests/controller-fixtures.ts` and
  `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`. R-08 exited 1:
  the new signal-contract assertion expected `{ ok: 7, failed: 0 }`, while the
  harness returns `{ ok: 7, failed: 0, disconnect }`. No R-01 or R-02 rerun,
  correction, retry, finding-fix, review, broad/live gate, staging, commit, or
  push occurred. The source snapshot is Git revision
  `6466c99dd497779d8499e0fef41cc5618593bff2` plus retained scoped diff and
  after-source files under `/tmp/opencode/unit-02a-signal-contract/`. This
  failure consumes the waiver without an acceptance credit; change-wide
  implementation dispatches are 7 and recorded no-progress remains 3. Parked
  pending escalation. The existing single container remains the pre-waiver
   candidate; no second container or destructive restoration was authorized.
- 2026-08-25 | successor Lead / pointer parking reconciliation | Confirmed the
  retained `unit-02-reset-02-candidate.tar` SHA-256 remains
  `20459f88e167342f175923322c57fde0e1f9104e288e7f89e85039ede4f2010a` and its
  manifest layout remains the sole authorized preservation record. The failed
  active `unit-02a` delta is limited to tracked
  `kwin/tests/controller-fixtures.ts` and
  `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`; it remains
  unsealed and protected. No pointer source, archive, restoration, deletion,
   staging, commit, push, test, or follow-on dispatch occurred. `unit-02a`,
   `unit-02b`, and downstream pointer work remain parked.
- 2026-08-26 | unit-02a-signal-contract pre-review correction authorization |
  User amended the failed-waiver outcome to authorize exactly one bounded
  pre-review correction for the frozen signal-contract target. The correction
  may edit only `kwin/tests/controller-fixtures.ts` and
  `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`; it must reproduce
  R-08 before editing and then run R-08, R-01, and R-02 with fresh
  source/output correspondence. No semantic retry, reset, repair
  reclassification, broader waiver, production edit, follow-on unit, live
  operation, staging, commit, push, preservation-container action, or second
  correction is authorized. The correction is pending and has not incremented
  any counter.
- 2026-08-26 | unit-02a-signal-contract/pre-review-correction-01 | Fresh
  Worker reproduced R-08 before editing: the assertion expected the complete
  watcher result to equal `{ ok: 7, failed: 0 }`, but the valid result also
  contains `disconnect`. The bounded correction changes that assertion to the
  two contract fields and adjusts only test-fixture emitter typing required by
  existing no-argument stepped-emitter calls while preserving payload callback
  arity. The changed paths remain exactly
  `kwin/tests/controller-fixtures.ts` and
  `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`. The Worker used
  noncanonical focused-bundle output names, so the Lead did not retain those
  outputs as gate evidence. The Lead reran literal R-08 and R-01 in fresh
  isolated snapshot `/tmp/opencode/unit-02a-canonical-20260826/` with only the
  two corrected paths and repository-managed `kwin/node_modules` as read-only
  input: both exited 0 with 1 focused test passed and 0 failed. R-02
  `npm --prefix kwin run typecheck` exited 0 in the same snapshot; canonical
  outputs are `/tmp/opencode/pointer-resize-signal-contract.cjs` and
  `/tmp/opencode/pointer-resize-focused.cjs`. Snapshot Git revision is
  `6466c99dd497779d8499e0fef41cc5618593bff2`, source hashes are recorded in
  plan evidence, active source matches the snapshot, and `git diff --check`
  passed. This consumes the sole authorized pre-review correction. Change-wide
  implementation dispatches: 8; pre-review corrections: 2; unit-02a: 1
  semantic attempt and 1 pre-review correction. No acceptance credit applies;
  recorded no-progress remains 3. Mandatory independent review is next. No
  production edit, archive/container action, staging, commit, push, or live
  operation occurred.
- 2026-08-26 | unit-02a-signal-contract/independent-review-01 and acceptance |
  Fresh independent review of only the frozen two test paths found no finding in
  signal arity, deterministic cleanup, correction scope, ownership, or
  source/output correspondence. Review made no edits and source hashes remain
  `118c29b6cbfc216e743c1e5c3ba01820cc23d8cc9ab446be2cd4740106dfdec9`
  (`controller-fixtures.ts`) and
  `d4b5a8725f75c079ca71e048710d03984a217a93f52f2be99c3d776a4336a91f`
  (`controller-drag-diagnostics-and-resize.test.ts`), matching the fresh
  canonical-gate snapshot. Lead accepts `unit-02a-signal-contract`: R-08 and
  R-01 each passed with 1 focused test and 0 failures, R-02 exited 0, and the
  mandatory review is clean. Change-wide independent reviews: 3; acceptance
  criteria moved: 2. The first-time signal-contract acceptance earns
  `acceptance_criterion_newly_met`, resetting no-progress from 3 to 0.
  `unit-02b-observer-integration` is dependency-eligible but not started. No
  further correction, reset, repair, source dispatch, staging, commit, push,
  live operation, archive, or preservation action occurred.
- 2026-08-26 | Lead handover | Successor Lead reconciled the frozen correction,
  inspected the scoped source and evidence, reran canonical gates where the
  Worker used noncanonical bundle output names, and accepted `unit-02a` after
  the clean mandatory review. This Lead reached the scheduling boundary after
  two fresh Workers and a 40-tool-call proxy. Active ownership returns to the
  Orchestrator for a fresh Lead. `unit-02b` is process-valid by dependency but
  remains undispatched; all protected preservation, archive, COSMIC,
   layout/tray, backlog, and unrelated paths remain untouched.
- 2026-08-27 | unit-02b-observer-integration/attempt-01 | Fresh Worker added
  a reset-02 observer candidate only in `controller-interactive-drag.ts`,
  `entry.ts`, `kwin-globals.d.ts`, and the closest controller test. The new
  direct controller test failed R-09 before implementation, then passed R-09
  with 1 focused pass/0 failures, R-02 exited 0, and original-target R-01
  passed with 1 focused pass/0 failures. Evidence is bound to the isolated
  post-edit snapshot under `/tmp/opencode/unit-02b-observer-integration/post/`;
  its source hashes and dirty-worktree inventory match active source. No
  fixture, generated bundle, live, staging, commit, push, archive, or container
  path changed. Change-wide implementation dispatches: 9; unit-02b semantic
  attempts: 1; no-progress streak: 1.
- 2026-08-27 | unit-02b-observer-integration/independent-review-01 | Mandatory
  fresh review made no edits and froze F-01: resize lifecycle can cross into
  shared move-drag cleanup/completion; and F-02: stepped delivery lacks explicit
  resize suppression and direct emitted-stepped evidence. Review verified R-09,
  R-02, R-01, and `git diff --check` evidence correspondence. Change-wide
  independent reviews: 4.
- 2026-08-27 | unit-02b-observer-integration/finding-fix-01 and confirmation |
  Fresh Worker changed only the allowed controller drag file and closest test.
  It added source-window stepped suppression and resize-only finish/invalidation
  cleanup; R-09, R-02, and R-01 passed from
  `/tmp/opencode/unit-02b-observer-integration/finding-fix-01/post/`, with
  active hashes matching the snapshot and `git diff --check` clean. Lead
  confirmation closes F-02 but finds F-01 still open: resize start adds the
  observation then can enter the shared stale-drag clear/invariant branch. A
  second finding-fix correction would trip the correction breaker, so
  `unit-02b` is parked unaccepted. Change-wide implementation dispatches: 10;
  finding-fix corrections: 3; unit-02b finding-fix corrections: 1; no
  acceptance credit; no-progress streak remains 1. No live, staging, commit,
  push, archive, container, fixture, or unrelated-path action occurred.
- 2026-08-27 | Lead reconciliation | `unit-02a-signal-contract` is accepted,
  committed, and pushed as `e9f71aa35c4058ca37fc31cce7753b6f949597ae`.
  `unit-02b-observer-integration` remains parked unaccepted: F-01 is frozen at
  the `handleStarted` stale-drag invariant after its sole finding-fix correction.
  No retry, correction, repair, unit-03 dispatch, or live work is authorized.

## Current Authorization - 2026-08-30

- The prior no-retry status is superseded only for one F-01-only correction.
  The required sequence after that correction is R-09, R-02, R-01, then
  independent review; any failure parks the unit.
- No second correction, broader retry, production expansion, broad gate, live
  operation, staging, commit, or push is authorized.

- 2026-08-30 | unit-02b-observer-integration/F-01 correction and acceptance |
  Fresh implementation changed only `kwin/src/controller-interactive-drag.ts`
  and `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`. Tiled resize
  start now returns immediately after recording the resize observation, before
  shared stale move-drag cleanup and invariant settlement. The closest
  controller regression test proves a tiled resize start does not clear an
  existing stale move drag. Fresh active-source gates passed in order: R-09
  exited 0 with 2 passed/0 failed, R-02 exited 0, and R-01 exited 0 with 1
  passed/0 failed. The promotion-only R-01/R-02 snapshot commands were not
  source-correspondent for this F-01 correction, so the gate command forms ran
  against current active source; the four observer source hashes were unchanged
  before and after every gate. Fresh independent review made no edits and found
  no F-01 or regression-boundary findings. It confirms KWin retains divider,
  ratio/geometry, reflow, floor, rounding, and final Escape/release ownership.
  Unit-02b is accepted. Change-wide implementation dispatches: 11;
  finding-fix corrections: 4; independent reviews: 5; acceptance criteria
  moved: 3; no-progress streak resets to 0. No Unit-03, broad gate, live work,
  preservation action, or unrelated pointer semantic change occurred.
- 2026-08-30 | unit-03 static integration attempt | After accepted
   Unit-02b/F-01, R-02 through R-05 passed, but R-06 failed in a clean
   current-main attribution context. R-07 and independent static review did not
   run under stop-on-failure. No pointer source/test correction, preservation,
   staging, commit, push, or live operation occurred. This intermediate failure
   does not supersede the authoritative later R-06/R-07 static completion.
- 2026-09-01 | user-authorized Reset-02 preservation cleanup |
  `unit-02-reset-02-candidate.tar` was retired before its retention deadline
  and deleted after its recorded SHA-256
  `20459f88e167342f175923322c57fde0e1f9104e288e7f89e85039ede4f2010a`
  matched. The deletion has no acceptance or evidence effect. Pointer static
  work remains accepted and pushed; separate L-01 remains unchanged.
