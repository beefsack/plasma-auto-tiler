# COSMIC Directional Movement Strategy Plan

## Scope

This plan implements only the approved COSMIC directional keyboard-movement
strategy. Source scope is limited to the controller directional-movement seam
and its input-action and geometry-selector collaborators:
`kwin/src/controller.ts`, `kwin/src/controller-input-actions.ts`, and
`kwin/src/logic.ts`, plus one new narrow strategy module if required.
`kwin/src/custom-tile-split.ts` is an adapter-contract dependency, not a
target for geometry-ordering changes. Test scope is limited to
`kwin/tests/controller-keyboard-move-and-swap.test.ts`,
`kwin/tests/controller-keyboard-placement.test.ts`,
`kwin/tests/controller-interactive-drag.test.ts`,
`kwin/tests/controller-interactive-drag-reflow.test.ts`,
`kwin/tests/nary-characterization.test.ts`, and
`kwin/tests/move-conformance.test.ts`.

## Units

| Unit | Dependency | Scope | Classification | Progress | Attempts | Corrections | Reviews |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| 01 | Approval | Define the narrow directional strategy seam and compose COSMIC only from `controller.ts`; retain facade, callbacks, guards, and capability boundaries. | Static implementation | Accepted | 1 | 1 | 0 |
| 02 | 01 | Build the COSMIC structural planner over ordered topology; consume adapter re-decode results and never infer native split shape. | Static implementation | Accepted | 1 | 0 | 0 |
| 03 | 02 | Integrate guarded R1-R4 mutations, S1-S4 sizing, focus preservation, workspace limits, and fail-closed postconditions. | Static implementation | Not started | 0 | 0 | 0 |
| 04 | 03 | Extend focused keyboard and N-ary tests using authoritative P/F/G/M/U/S case references; keep the conformance model reference-only. | Static implementation | Not started | 0 | 0 | 0 |
| 05 | 04 | Run focused and full static acceptance, dual typechecks, dogfood, and deterministic bundle build; record the post-change bundle hash. | Static verification | Not started | 0 | 0 | 0 |

## Acceptance-Evidence Map

| Acceptance criterion | Evidence |
| --- | --- |
| COSMIC R1-R4 behavior and S1-S4 sizing | Focused keyboard coverage mapped to `docs/cosmic-move-conformance.md` case groups P1-P5, F1-F3, G1-G2, M1-M4, U1-U2, and S1-S23. |
| Current keyboard guards, empty/occupied behavior, focus, and restoration | `kwin/tests/controller-keyboard-move-and-swap.test.ts`. |
| Opaque split re-decode, direct-child N-ary behavior, and new-window preservation | `kwin/tests/controller-keyboard-placement.test.ts` and archived N-ary frozen contracts. |
| Drag behavior remains distinct and stable | `kwin/tests/controller-interactive-drag.test.ts` and `kwin/tests/controller-interactive-drag-reflow.test.ts`. |
| Binary preservation | `kwin/tests/nary-characterization.test.ts`. |
| Reference-model boundary remains static-only | `kwin/tests/move-conformance.test.ts`. |
| Static quality gate | Focused tests, full `kwin` suite, dual typechecks, dogfood, and deterministic bundle build against the recorded baseline. |

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

## Stop Conditions

- Any existing test failure, binary serialization drift, malformed or stale
  topology, failed postcondition, focus loss, or workspace crossing.
- Any changed drag or new-window insertion behavior.
- Any evidence gap filled by inference rather than an accepted source or test.
- Any scope expansion beyond directional keyboard movement.

## Initial State

- Units 01-02 are accepted. Units 03-05 remain unauthorized and not started.
- Units 01-02 have one attempt each; Units 03-05 have zero attempts,
  correction rounds, and independent reviews.
- No circuit breaker is active.

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
