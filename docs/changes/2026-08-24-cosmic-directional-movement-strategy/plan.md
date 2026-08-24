# COSMIC Directional Movement Strategy Plan

## Scope

This plan implements only the approved COSMIC directional keyboard-movement
strategy. Source scope is limited to the controller directional-movement seam,
its input-action collaborator, and a narrow runtime strategy module:
`kwin/src/controller.ts`, `kwin/src/controller-input-actions.ts`,
`kwin/src/directional-movement-strategy.ts`, and
`kwin/src/directional-movement-runtime.ts`.
`kwin/src/custom-tile-split.ts` is an adapter-contract dependency, not a
target for geometry-ordering changes. Test scope is limited to
`kwin/tests/directional-movement-runtime.test.ts`,
`kwin/tests/controller-keyboard-move-and-swap.test.ts`,
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
| `unit-03a-runtime-transaction-safety` | `unit-02` | Runtime topology decode, preflight, mutation transactions, recovery, and focused runtime tests. | Static implementation | Not started | 0 | 0 | 0 | 0 |
| `unit-03b-cosmic-integration-closure` | `unit-03a-runtime-transaction-safety` | COSMIC-only controller composition, directional entry closure, legacy-path removal, and focused entry tests. | Static implementation | Not started | 0 | 0 | 0 | 0 |
| `unit-04` | `unit-03b-cosmic-integration-closure` | Extend focused keyboard and N-ary tests using authoritative P/F/G/M/U/S case references; keep the conformance model reference-only. | Static implementation | Not started | 0 | 0 | 0 | 0 |
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
- `unit-03b-cosmic-integration-closure` may change only
  `kwin/src/controller.ts`, `kwin/src/directional-movement-strategy.ts`,
  `kwin/src/controller-input-actions.ts`, and
  `kwin/tests/controller-keyboard-move-and-swap.test.ts`. It must retain the
  controller facade as composition owner and prove every valid directional
  entry reaches COSMIC or fails closed. It removes the legacy directional
  movement path rather than retaining it as fallback. It may not change runtime
  implementation, planner semantics, `custom-tile-split.ts`, selectors,
  settings, shortcut catalogs, or the generated bundle.
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
| Legacy internal non-COSMIC fallback remains | `unit-03b-cosmic-integration-closure` | It is controller entry and strategy closure. |

- Rejected evidence is preserved in stash
  `8578bbf4f0e4e953be8c0128506c051de863fe0f`
  (`rejected cosmic unit-03 candidate`). Replacement work starts from accepted
  Unit 02 and may use the stash only as read-only comparison evidence. No
  candidate code, test, or generated behavior is an accepted baseline or may
  be copied wholesale.

## Acceptance-Evidence Map

| Acceptance criterion | Evidence |
| --- | --- |
| Runtime preflight, empty R4, maximized/duplicate rejection, transaction rollback, postconditions, recovery, and focus | `kwin/tests/directional-movement-runtime.test.ts`. |
| COSMIC-only directional entry closure | `kwin/tests/controller-keyboard-move-and-swap.test.ts`. |
| COSMIC R1-R4 behavior and S1-S4 sizing | Focused keyboard coverage mapped to `docs/cosmic-move-conformance.md` case groups P1-P5, F1-F3, G1-G2, M1-M4, U1-U2, and S1-S23. |
| Current keyboard guards, empty/occupied behavior, focus, and restoration | `kwin/tests/controller-keyboard-move-and-swap.test.ts`. |
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
- Each replacement implementation unit starts at attempts 0, corrections 0,
  and reviews 0, with at most two attempts, one correction, and one independent
  review. A third attempt, second correction, or second review trips its
  breaker and returns `decision-needed`.
- One independent review occurs only for
  `unit-03a-runtime-transaction-safety`, after focused evidence and before
  acceptance, because rollback and fail-closed recovery are costly to unwind.
  No independent review is preplanned for `unit-03b`, `unit-04`, or `unit-05`.
- `unit-04` may correct test-only work once. `unit-05` records failures but
  never repairs code. A failed required gate returns a concrete finding to a
  newly approved unit.

## Stop Conditions

- Any existing test failure, binary serialization drift, malformed or stale
  topology, failed postcondition, focus loss, or workspace crossing.
- Any changed drag or new-window insertion behavior.
- Any evidence gap filled by inference rather than an accepted source or test.
- Any scope expansion beyond directional keyboard movement.
- Any unverified transaction recovery, non-COSMIC directional route, or failed
  authoritative corpus case.

## Initial State

- Units 01-02 are accepted. Original `unit-03` is frozen with breaker 1.
  `unit-03a-runtime-transaction-safety` and
  `unit-03b-cosmic-integration-closure` are approved but not started; Units
  04-05 remain unauthorized and not started.
- The two replacement units and Units 04-05 start at zero attempts, correction
  rounds, independent reviews, and breakers.
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
