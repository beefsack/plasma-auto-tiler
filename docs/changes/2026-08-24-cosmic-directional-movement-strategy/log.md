# Change Log

## 2026-08-24

- User approved Standard change-artifact creation for the COSMIC directional
  movement strategy, without implementation authorization.
- Created the approved specification and plan. Existing bspwm and Hyprland
  shortcut-profile references remain catalog-only and unchanged.
- Unit 01 attempt 01 is blocked pending reconciliation of the approved 347/0
  dogfood threshold with the observed 255/0 result. No correction was run.
- Unit 01 is accepted after a same-scope verification correction: the approved
  `scripts/dogfood-install.test.sh` gate reported 347 assertions and 0
  failures. No independent review was triggered.
- Unit 02 is accepted: the pure ordered-topology planner, focused
  corpus-referenced coverage, fail-closed validation, and static gates passed
  without runtime integration. No independent review was triggered.
- Unit 03 is blocked after its one correction and mandatory independent review.
  The review found empty-output R4, maximized guard, partial-swap recovery,
  duplicate-occupancy, and COSMIC-only-path defects; a changed-path reset is
  required before further implementation. Required command records were also
  incomplete.
- User approved the semantic reset without implementation authorization.
  Original `unit-03` is frozen permanently at attempts 1, corrections 1,
  reviews 1, breaker 1: the mandatory findings would require prohibited
  correction 2 and potentially review 2 on the same semantic unit.
- Preserved rejected candidate evidence in path-scoped stash
  `8578bbf4f0e4e953be8c0128506c051de863fe0f`
  (`rejected cosmic unit-03 candidate`) containing only the five approved
  candidate production, test, and generated paths. It is not an accepted
  baseline and will be read-only comparison evidence for replacements.
- Approved replacement dependencies: `unit-03a-runtime-transaction-safety`
  depends on `unit-02`; `unit-03b-cosmic-integration-closure` depends on
  `unit-03a-runtime-transaction-safety`; `unit-04` depends on
  `unit-03b-cosmic-integration-closure`; `unit-05` remains dependent on
  `unit-04`. One independent review is reserved for Unit 03A transaction
  safety only. No product or enduring governance change.
- Unit 03A attempt 01 reached its mandatory independent review. Six accepted
  runtime-safety findings require one same-scope correction: mandatory planned
  postconditions, complete recovery verification, maximized target-occupant
  rejection, non-layout child rejection, post-mutation output/workspace
  validation, and fail-closed capability getter handling. Correction 01 is in
  progress; a second Unit 03A review is prohibited.
- Unit 03A is accepted after correction 01 and Lead confirmation of the six
  findings. Evidence: focused runtime tests 11/1 with 0 failures/skips; full
  suite 990/95 with 0 failures/skips; dual typecheck clean; dogfood 347/0;
  package contract checks passed; and build SHA-256
  `b90f9b23f9e2e290f7b581acaef9743a4ff48c320e895f7a06fa7de005d074dc`.
  No second review, live operation, staging, commit, or push occurred.
- User approved the changed-kind reset without replacement implementation
  authorization. Unit 03B is permanently frozen at attempts 1, corrections 1,
  reviews 0, breaker 1: correction 01 removed required focused coverage and did
  not prove actual R1-R4 structural realization or complete verified snapshot
  restoration. No correction 02 or Unit 03B review is permitted.
- Preserved the frozen 03B candidate as read-only evidence in path-scoped stash
  `f2553e69eefe0433ab0c1ae2a79c8c97756a18f4`
  (`rejected cosmic unit-03b candidate`) containing exactly `plan.md`,
  `log.md`, `kwin/src/controller.ts`, `kwin/src/controller-input-actions.ts`,
  and `kwin/tests/controller-keyboard-move-and-swap.test.ts` at their active
  change paths. Original read-only rejected evidence remains
  `8578bbf4f0e4e953be8c0128506c051de863fe0f`
  (`rejected cosmic unit-03 candidate`) at its shifted stash index. Neither is
  an accepted baseline.
- Restored the five 03B worktree paths to accepted Unit 03A commit
  `eebd535d9e7f7b32c261f8c03f24309226768fb7`; replacement implementation has
  not started.
- Approved `unit-03c-keyboard-contract-lock` after Unit 03A and
  `unit-03d-cosmic-runtime-adapter-integration` after 03C. Unit 04 now depends
  on 03D; Unit 05 remains dependent on Unit 04. Both replacement units start at
  zero attempts, corrections, reviews, and breakers. Unit 03D alone receives
  one independent review.
- Approved the four-suite, 37-test identity and coverage-category lock from
  baseline SHA-256 `2ec613d2c9ed7b8fc3c00981b6ee1e3e67ee88bf34ff6ac3169eb21ba99a2dc7`.
  Unit 03C must record one-to-one equivalent-or-stronger COSMIC assertion
  lineage; Unit 03D may not edit the locked test file. Required Unit 03D proof
  is controller-to-strategy-to-accepted-runtime-to-stateful-native-fixture
  execution of R1-R4 and complete re-decoded snapshot restoration, not
  mock-only route invocation. No product or enduring governance change.
- The user-approved 03C/03D reset was committed before this simplification as
  `f7683563d32c6c4566cf971c91defe21a7aa7998`
  (`docs: reset COSMIC directional integration plan`), containing only this
  plan and log. Units 03C and 03D were never dispatched and are superseded
  before start at attempts 0, corrections 0, reviews 0, breaker 0; their
  committed record remains historical.
- User approved `unit-03c-checkpointed-integration-recovery`, dependent on
  accepted Unit 03A. Unit 04 now depends on the replacement and Unit 05 remains
  dependent on Unit 04. This reduces process and token overhead, locks the
  accepted tests before production work, and runs broad gates once after the
  complete candidate. It introduces no spec, product, or governance change.
- The accepted keyboard move/swap file is immutable at four suites, 37 test
  identities and coverage categories, and SHA-256
  `2ec613d2c9ed7b8fc3c00981b6ee1e3e67ee88bf34ff6ac3169eb21ba99a2dc7`.
  Checkpoint A adds only the stateful integration fixture and records focused
  pre-integration failures as falsifiable evidence after Lead inspection.
  Checkpoint B may edit only the controller, input actions, and new controller
  directional-movement module; it cannot edit either checkpoint test or the
  locked accepted test file.
- The replacement permits one Worker attempt across both checkpoints and one
  correction total, allocated to Checkpoint A or B but never both. One
  independent review occurs once after Checkpoint B. No attempt 02, second
  correction, second review, or post-review broad correction is permitted.
  Full suite, typecheck, dogfood, package/build, and deterministic bundle
  evidence remain Unit 05 gates and run once after the complete candidate.
- `unit-03c-checkpointed-integration-recovery/attempt-01` is frozen at attempts
  1, corrections 1, reviews 0, breaker 1. Its first fixture bypassed the
  controller-owned runtime; correction 01 restored public registered-shortcut
  routing, but newly split children retained default non-stateful native methods.
  Permitted production integration cannot create re-decodable occupancy without
  prohibited correction 02.
- User authorized one final changed-kind reset without implementation
  authorization: `unit-03e-stateful-custom-tile-fixture-foundation`, dependent
  on accepted Unit 03A. It may edit only
  `kwin/tests/controller-fixture-scenarios.ts` and
  `kwin/tests/controller-cosmic-directional-runtime-integration.test.ts`, reuse
  the established controller fixtures and recursive splitter pattern, and run
  only focused fixture tests, test typecheck, diff check, and static scope checks.
  It has one attempt, zero corrections, and zero independent reviews. Any failed
  acceptance check, required production edit, or fixture ambiguity parks this
  COSMIC change with no further reset or integration dispatch. Unit 04 and Unit
  05 remain blocked; production integration requires separate user approval.
- Preserved the blocked checkpointed candidate as rejected read-only evidence in
  path-scoped stash `2c15d895b128200070f7f772e2f98b6e8fe96b90`
  (`rejected cosmic checkpointed integration fixture candidate`) containing
  exactly `plan.md`, `log.md`, and
  `kwin/tests/controller-cosmic-directional-runtime-integration.test.ts` at
  their active change paths. The older rejected evidence remains
  `f2553e69eefe0433ab0c1ae2a79c8c97756a18f4` (`rejected cosmic unit-03b
  candidate`) and `8578bbf4f0e4e953be8c0128506c051de863fe0f` (`rejected cosmic
  unit-03 candidate`); all three are rejected evidence only.
- `unit-03e-stateful-custom-tile-fixture-foundation/attempt-01` is parked at
  attempts 1, corrections 0, reviews 0, breaker 1. The Worker added the
  recursive stateful fixture within the two test paths and reported focused tests
  (4 tests in 2 suites, 0 failures/skips), typecheck, diff check, and static
  scope checks. Lead inspection found that the rollback assertion directly
  constructs `createDirectionalMovementRuntime` with a replacement environment.
  This is prohibited behavior integration, not fixture-only evidence. No
  correction, further reset, review, or integration dispatch is permitted; Unit
  04 and Unit 05 remain blocked.
- Read-only inspection of rejected stash
  `8578bbf4f0e4e953be8c0128506c051de863fe0f` confirms its focused keyboard
  test added a separate `runtimeHarness` that directly constructs
  `createDirectionalMovementRuntime`, bypassing the controller-owned
  composition. Its production candidate also retained a `legacyMove` fallback.
  Alongside the already recorded empty-output R4, maximized-occupant,
  duplicate-occupancy, and partial-swap recovery defects, this rejected the
  candidate as an integration and process-proof failure, not product
  infeasibility.
- Read-only inspection of rejected stash
  `f2553e69eefe0433ab0c1ae2a79c8c97756a18f4` confirms the 03B focused test
  replacement removed substantial accepted keyboard coverage and used direct
  planner operation-kind assertions plus weak non-equality checks for several
  movement cases. It therefore did not prove controller-to-runtime R1-R4
  structural realization or complete snapshot restoration. This is a
  coverage and integration-proof rejection, not evidence that COSMIC is
  technically infeasible.
