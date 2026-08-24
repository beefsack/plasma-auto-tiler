# COSMIC Directional Movement Strategy Plan

## Scope

This plan implements only the approved COSMIC directional keyboard-movement
strategy. Source scope is limited to the controller directional-movement seam,
its input-action collaborator, a narrow controller runtime adapter, and the
accepted runtime strategy modules:
`kwin/src/controller.ts`, `kwin/src/controller-input-actions.ts`,
`kwin/src/controller-directional-movement.ts`,
`kwin/src/directional-movement-strategy.ts`, and
`kwin/src/directional-movement-runtime.ts`.
`kwin/src/custom-tile-split.ts` is an adapter-contract dependency, not a
target for geometry-ordering changes. Test scope is limited to
`kwin/tests/directional-movement-runtime.test.ts`,
`kwin/tests/controller-keyboard-move-and-swap.test.ts`,
`kwin/tests/controller-cosmic-directional-runtime-integration.test.ts`,
`kwin/tests/controller-keyboard-placement.test.ts`,
`kwin/tests/controller-interactive-drag.test.ts`,
`kwin/tests/controller-interactive-drag-reflow.test.ts`,
`kwin/tests/nary-characterization.test.ts`, and
`kwin/tests/move-conformance.test.ts`.

## Units

| Stable ID | Dependency | Scope | Classification | Progress | Attempts | Corrections | Reviews | Breaker |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| `unit-01` | Approval | Define the narrow directional strategy seam and compose COSMIC only from `controller.ts`; retain facade, callbacks, guards, and capability boundaries. | Static implementation | Accepted | 1 | 1 | 0 | 0 |
| `unit-02` | `unit-01` | Build the COSMIC structural planner over ordered topology; consume adapter re-decode results and never infer native split shape. | Static implementation | Accepted | 1 | 0 | 0 | 0 |
| `unit-03` | `unit-02` | Original guarded R1-R4 runtime integration objective. | Static implementation | Frozen permanently: breaker tripped | 1 | 1 | 1 | 1 |
| `unit-03a-runtime-transaction-safety` | `unit-02` | Runtime topology decode, preflight, mutation transactions, recovery, and focused runtime tests. | Static implementation | Accepted | 1 | 1 | 1 | 0 |
| `unit-03b-cosmic-integration-closure` | `unit-03a-runtime-transaction-safety` | Original COSMIC-only controller composition, directional entry closure, legacy-path removal, and focused entry-test objective. | Static implementation | Frozen permanently: breaker tripped | 1 | 1 | 0 | 1 |
| `unit-03c-keyboard-contract-lock` | `unit-03a-runtime-transaction-safety` | Lock and migrate the accepted keyboard move/swap contract one-to-one, without deleting or weakening coverage. | Test-contract implementation | Approved, not started | 0 | 0 | 0 | 0 |
| `unit-03d-cosmic-runtime-adapter-integration` | `unit-03c-keyboard-contract-lock` | Fresh COSMIC controller/runtime adapter integration, legacy-route removal, and stateful end-to-end runtime evidence. | Static implementation | Approved, not started | 0 | 0 | 0 | 0 |
| `unit-04` | `unit-03d-cosmic-runtime-adapter-integration` | Extend focused keyboard and N-ary tests using authoritative P/F/G/M/U/S case references; keep the conformance model reference-only. | Static implementation | Not started | 0 | 0 | 0 | 0 |
| `unit-05` | `unit-04` | Run focused and full static acceptance, dual typechecks, dogfood, and deterministic bundle build; record the post-change bundle hash. | Static verification | Not started | 0 | 0 | 0 | 0 |

## Reset Unit Scope

- `unit-03a-runtime-transaction-safety` may change only
  `kwin/src/directional-movement-runtime.ts` and
  `kwin/tests/directional-movement-runtime.test.ts`. It must represent an
  empty root as an empty R4 output, reject native-maximized and duplicate
  active-window occupancy before mutation, preserve adapter re-decode and
  geometry-ordering locality, and make structural and occupied-swap mutation
  rollback or atomically fail closed with verified postconditions and recovery.
  It may not change controller composition, the strategy seam, input actions,
  planner semantics, `custom-tile-split.ts`, or the generated bundle.
- `unit-03b-cosmic-integration-closure` is permanently frozen at attempts 1,
  corrections 1, reviews 0, breaker 1. Correction 01 removed required focused
  coverage and did not prove actual R1-R4 structural realization or verified
  snapshot restoration. A second correction is prohibited and no review is
  dispatched.
- `unit-03c-keyboard-contract-lock` may change only
  `kwin/tests/controller-keyboard-move-and-swap.test.ts`. It locks the accepted
  Unit 03A baseline at SHA-256
  `2ec613d2c9ed7b8fc3c00981b6ee1e3e67ee88bf34ff6ac3169eb21ba99a2dc7`,
  four suites, and 37 test identities. It must preserve every test identity and
  coverage category. Each legacy geometry assertion must have a one-to-one
  recorded COSMIC successor with equivalent-or-stronger coverage; deletion,
  skipped coverage, weakened assertions, and reduced counts are prohibited.
  It may not change production code, generated output, or any non-directional
  test behavior.
- `unit-03d-cosmic-runtime-adapter-integration` may change only
  `kwin/src/controller.ts`, `kwin/src/controller-input-actions.ts`, new
  `kwin/src/controller-directional-movement.ts`, and new
  `kwin/tests/controller-cosmic-directional-runtime-integration.test.ts`.
  `controller.ts` remains the facade and composition root; the new module
  receives narrow controller capabilities rather than controller state. Unit
  03D must not edit the locked
  `kwin/tests/controller-keyboard-move-and-swap.test.ts`. It removes the legacy
  directional path rather than retaining it as fallback. It may not change the
  accepted runtime, planner semantics, strategy seam, `custom-tile-split.ts`,
  selectors, settings, shortcut catalogs, or the generated bundle.
- `unit-04` is test-only within the approved test scope. `unit-05` owns static
  verification and generated-bundle evidence only. Neither may repair runtime
  behavior.
- Both replacement units preserve R1-R4/S1-S4 intent, no workspace crossing,
  focus on success, opaque native split results, adapter re-decode,
  geometry-ordering locality in `custom-tile-split.ts`, controller facade
  ownership, COSMIC-only/no-selector behavior, and all non-directional
  invariants.

## Finding Allocation And Salvage

| Finding | Replacement unit | Rationale |
| --- | --- | --- |
| Empty-output R4 is unreachable | `unit-03a-runtime-transaction-safety` | It is runtime topology decoding and target-tree semantics. |
| Native-maximized guard is bypassed | `unit-03a-runtime-transaction-safety` | It must reject before mutation. |
| Failed occupied-swap second assignment is unrecovered | `unit-03a-runtime-transaction-safety` | It is multi-step assignment transaction safety. |
| Duplicate active-window occupancy is accepted | `unit-03a-runtime-transaction-safety` | It is preflight and decoded postcondition validity. |
| Legacy internal non-COSMIC fallback remains | `unit-03d-cosmic-runtime-adapter-integration` | It is controller entry and strategy closure. |
| Deleted or weakened accepted keyboard coverage | `unit-03c-keyboard-contract-lock` | The contract is locked before production integration and cannot be rewritten by Unit 03D. |

- Rejected evidence is preserved in stash
  `8578bbf4f0e4e953be8c0128506c051de863fe0f`
  (`rejected cosmic unit-03 candidate`):
  `kwin/contents/code/main.js`, `kwin/src/controller-input-actions.ts`,
  `kwin/src/controller.ts`, `kwin/src/directional-movement-strategy.ts`, and
  `kwin/tests/controller-keyboard-move-and-swap.test.ts`.
- The frozen 03B candidate is preserved separately in stash
  `f2553e69eefe0433ab0c1ae2a79c8c97756a18f4`
  (`rejected cosmic unit-03b candidate`):
  `docs/changes/2026-08-24-cosmic-directional-movement-strategy/log.md`,
  `docs/changes/2026-08-24-cosmic-directional-movement-strategy/plan.md`,
  `kwin/src/controller-input-actions.ts`, `kwin/src/controller.ts`, and
  `kwin/tests/controller-keyboard-move-and-swap.test.ts`.
- Both stashes are read-only comparison evidence, never accepted baselines.
  Replacement work starts from accepted Unit 03A and may not copy either
  candidate wholesale.

## Acceptance-Evidence Map

| Acceptance criterion | Evidence |
| --- | --- |
| Runtime preflight, empty R4, maximized/duplicate rejection, transaction rollback, postconditions, recovery, and focus | `kwin/tests/directional-movement-runtime.test.ts`. |
| Accepted keyboard test preservation | Unit 03C lineage matrix, baseline SHA-256, four-suite/37-test count, and focused test evidence before Unit 03D starts. |
| COSMIC-only directional entry and R1-R4 realization | `kwin/tests/controller-cosmic-directional-runtime-integration.test.ts` drives `TileController` shortcuts through the COSMIC strategy, accepted runtime, and stateful native-capability fixture. |
| R1-R4 structure and S1-S4 sizing | The Unit 03D integration fixture re-decodes and asserts actual R1, R2a, both R2b operations, R2c, R3, and occupied/empty R4 topology, assignment, focus, output, and workspace results; it maps cases to `docs/cosmic-move-conformance.md` groups P1-P5, F1-F3, G1-G2, M1-M4, U1-U2, and S1-S23. |
| Complete snapshot restoration | Unit 03D injects structural, occupied-swap, and cross-output partial failures through the controller adapter, then proves the accepted runtime re-decodes an exact pre-mutation snapshot. Mock-only planner or route invocation is insufficient. |
| Opaque split re-decode, direct-child N-ary behavior, and new-window preservation | `kwin/tests/controller-keyboard-placement.test.ts` and archived N-ary frozen contracts. |
| Drag behavior remains distinct and stable | `kwin/tests/controller-interactive-drag.test.ts` and `kwin/tests/controller-interactive-drag-reflow.test.ts`. |
| Binary preservation | `kwin/tests/nary-characterization.test.ts`. |
| Reference-model boundary remains static-only | `kwin/tests/move-conformance.test.ts`. |
| Static quality gate | Focused tests, full `kwin` suite, dual typechecks, dogfood, and deterministic bundle build against the recorded baseline. |

`unit-05` records literal invocations, observed test/suite/failure/skipped
counts, dogfood assertions, and two independent bundle hashes for
`npm --prefix kwin test`, `npm --prefix kwin run typecheck`,
`bash scripts/dogfood-install.test.sh`, `bash scripts/build-kpackage.test.sh`,
and two `npm --prefix kwin run build` plus
`sha256sum kwin/contents/code/main.js` observations.

## Live Checkpoint

A COSMIC-only runtime corpus replay is a later, separately approved live
checkpoint. It is outside this plan's static implementation acceptance and
does not block Unit 05.

## Review Triggers

- A selector, strategy setting, migration, default, or KCM control is added.
- A bspwm or Hyprland directional-movement runtime path or advertising is
  added.
- Shortcut registration or existing shortcut-profile catalogs change.
- Runtime code imports the pure conformance model.
- Code assumes native split return cardinality or child order.
- Mutation occurs before preflight, or a focused preservation test regresses.

## Replacement Counters And Review

- Original `unit-03` is permanently frozen at attempts 1, corrections 1,
  reviews 1, breaker 1. The breaker reason is that the mandatory findings would
  require prohibited correction 2 and potentially review 2 on the same
  semantic unit.
- `unit-03c-keyboard-contract-lock` and
  `unit-03d-cosmic-runtime-adapter-integration` start at attempts 0,
  corrections 0, reviews 0, and breaker 0. Each permits at most two attempts
  and one correction. A third attempt, second correction, second review,
  repeated invariant failure, or no acceptance progress trips its breaker and
  returns `decision-needed`.
- No independent review applies to frozen Unit 03B. Unit 03C has no independent
  review. Unit 03D receives one independent review after focused evidence and
  before acceptance because native structural mutation and recovery are costly
  to unwind. No independent review is preplanned for Unit 04 or Unit 05.
- `unit-04` may correct test-only work once. `unit-05` records failures but
  never repairs code. A failed required gate returns a concrete finding to a
  newly approved unit.

## Unit 03A Review Record

- `unit-03a-runtime-transaction-safety/attempt-01` reached mandatory
  independent review 01. The review found: optional planned postconditions;
  incomplete topology and assignment recovery verification; missing
  native-maximized target-occupant rejection; non-layout tiles accepted with
  children; incomplete post-mutation output/workspace validation; and escaping
  capability getter failures. All six findings are accepted as fixes within the
  approved runtime/test scope. Correction 01 is the sole permitted same-scope
  correction; no further independent review is permitted.
- Correction 01 made planned postconditions mandatory, expanded verified
  recovery snapshots, rejected native-maximized occupants and non-layout child
  topologies, validated every post-mutation tile/output/workspace association,
  and contained capability getter failures. Lead confirmation inspected those
  changes and the focused regression evidence. The finding set is accepted;
  no confirmation review was dispatched.

## Stop Conditions

- Any existing test failure, binary serialization drift, malformed or stale
  topology, failed postcondition, focus loss, or workspace crossing.
- Any changed drag or new-window insertion behavior.
- Any evidence gap filled by inference rather than an accepted source or test.
- Any scope expansion beyond directional keyboard movement.
- Any unverified transaction recovery, non-COSMIC directional route, or failed
  authoritative corpus case.
- Any Unit 03D edit to the locked keyboard move/swap test file, test-identity
  loss, coverage-category loss, test weakening, or count reduction.
- Any R1-R4 assertion that does not traverse the controller, COSMIC strategy,
  accepted runtime, and stateful native-capability fixture, or any restoration
  assertion that does not prove a complete re-decoded snapshot.

## Initial State

- Units 01-02 and `unit-03a-runtime-transaction-safety` are accepted. Original
  `unit-03` is frozen with breaker 1.
  `unit-03b-cosmic-integration-closure` is permanently frozen with breaker 1.
  Units 03C and 03D are approved but not started; Unit 04 depends on 03D and
  Unit 05 depends on Unit 04.
- Units 03C, 03D, 04, and 05 start at zero attempts, correction rounds,
  independent reviews, and breakers.
- No product or enduring governance change is introduced by this reset.

## Attempt Record

- `unit-01/attempt-01` is accepted after one same-scope verification
  correction. The initial `scripts/start-test.test.sh` result was not dogfood
  evidence. The approved `bash scripts/dogfood-install.test.sh` gate passed
  with 347 assertions and 0 failures. Focused seam coverage, dual typecheck,
  the full suite, two matching builds, and static audit passed. No independent
  review was triggered.
- `unit-02/attempt-01` is accepted. Pure planner coverage referenced the
  approved P/F/G/M/U/S case groups and fail-closed malformed topology paths.
  Dual typecheck, full suite, dogfood, two matching builds, and static purity
  checks passed. No independent review was triggered.
- `unit-03/attempt-01` is blocked after its single correction and mandatory
  independent review. The reviewer found unreachable empty-output R4,
  missing native-maximized guarding, unrecovered partial occupied swaps,
  duplicate-occupancy acceptance, and a legacy fallback that violates the
  COSMIC-only internal path. The Worker return also omitted complete literal
  command records for several required gates. No further correction is
  permitted without a changed-path reset.
- The approved changed-path reset permanently freezes `unit-03`; it does not
  relabel or clear its counters. The named stash is rejected evidence only.
- `unit-03a-runtime-transaction-safety/attempt-01` is accepted after one
  independent review and correction 01. `node --test
  kwin/dist/tests/directional-movement-runtime.test.js` passed 11 tests in 1
  suite with 0 failures and 0 skipped. `npm --prefix kwin test` passed 990
  tests in 95 suites with 0 failures and 0 skipped; `npm --prefix kwin run
  typecheck`, `bash scripts/dogfood-install.test.sh` (347/0), and `bash
  scripts/build-kpackage.test.sh` passed. `npm --prefix kwin run build` produced
  `b90f9b23f9e2e290f7b581acaef9743a4ff48c320e895f7a06fa7de005d074dc` for
  `kwin/contents/code/main.js`; `git diff --check` passed. No live operation
  was run.
- `unit-03b-cosmic-integration-closure/attempt-01` and correction 01 are
  permanently frozen: focused coverage was removed and the candidate did not
  prove actual R1-R4 structural realization or complete verified snapshot
  restoration. Its counters remain attempts 1, corrections 1, reviews 0,
  breaker 1. No correction 02 or Unit 03B review is permitted.
