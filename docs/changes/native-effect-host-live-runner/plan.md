# Plan: Native Effect Host Validation

Ownership and approval:
- Owner: Lead
- Status: Reset for review, 2026-08-17.
- Scope: the five-phase one-off protocol in `spec.md`.

## Reset State

The generalized runner's state and preflight units, together with their
associated evidence, are discarded for this active change. Their fake
assertion totals are not accepted progress and are not retained as acceptance
evidence. No replacement implementation is started by this transaction.

The accepted exact host pin remains:

- `out=/nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3`
- `dev=/nix/store/483vmk08g6bjaa3bvf3abn10cwpw6ap9-kwin-6.7.3-dev`
- shared derivation:
  `/nix/store/ak2wg58bdpv0q7z3n5pjz6gj6s18bxm9-kwin-6.7.3.drv`

## Work Units

| ID | Objective | Scope and verification |
|---|---|---|
| doc-reset | Reconcile `spec.md`, this plan, and the active backlog entry with the approved one-off protocol. | Documentation review against the five phases, frozen matrix, safety constraints, discarded generalized work, and exact scope. No implementation or host action. |
| implementation | Implement only the exact-plugin, nonce-owned staging, two-boundary, `/Effects` lifecycle, restoration, and postflight protocol for the pinned host. | At most one implementation Worker. Verify each frozen acceptance item with retained evidence. No reusable runner, multi-host abstraction, generalized state machine, or prohibited host action. |
| independent-review | Review the implementation against the frozen acceptance matrix and safety constraints. | At most one independent reviewer. Scope is frozen acceptance and safety only; new hardening is parked. No host action. |
| user-attempt | The trusted single user performs one serial attempt through all five phases, including both session boundaries and manual visual observation. | User-run evidence covers the frozen matrix. Agents provide no host mutation and perform no session boundary. |

## Circuit Breaker

The plan permits at most one implementation Worker, one independent reviewer,
and one same-scope correction round. The reviewer scope is frozen acceptance
and safety only; new hardening is parked. Any repeated same-semantic finding,
correction-limit breach, no-progress retry, or increasing verification volume
without milestone movement stops the work and reports:

- accepted state
- discarded work
- blocker
- available options
- recommended reset

## Protocol Rules

The implementation and user attempt follow exactly the five ordered phases in
`spec.md`: read-only preflight/snapshot; exact plugin and temporary
`environment.d` staging; user boundary 1; exact `/Effects` support,
load, manual visual, unload, and unloaded validation; and exact restoration
with user boundary 2 and postflight verification.

The trusted single user runs commands serially and alone, owns host mutation,
and performs both session boundaries. On an unexpected or ambiguous result,
the attempt stops; evidence and nonce-owned paths remain, the exact plugin
state is queried, and manual recovery is discussed and completed before
removal. Broad cleanup is never used.

The prohibitions are `sudo`, system plugin paths, `/Compositor`, `/Scripting`,
automatic primary-session mutation, routine in-place KWin termination, broad
cleanup, unrelated state changes, and agent-executed host mutation.

## Execution Record

| Unit | Status | Evidence |
|---|---|---|
| doc-reset | accepted | Committed and pushed as `7064f47`; inspected diff against `82c497c`. |
| implementation | accepted | `implementation/attempt-01` accepted after `correction-01` fixed and retained the two review findings. |
| independent-review | accepted | `independent-review/attempt-01` found two concrete issues; its confirmation verified both corrections. |
| user-attempt | pending | User-run only after static acceptance and review disposition. |

## Acceptance-Evidence Map

| Acceptance items | Evidence | Status |
|---|---|---|
| 1 | Exact pins, exact derivation checks, and boundary-1 recheck in `scripts/live-native-effect-test.sh`; focused fake suite passes. | static/fake accepted |
| 2-5 | Exact `/Effects` support, load/loaded, manual acceptance record, unload/unloaded controls; focused fake suite passes. | static/fake accepted; user evidence pending |
| 6-9 | Nonce-owned staging, hash-checked normal restoration, boundary-2 and snapshot controls; focused fake suite passes. | static/fake accepted; user evidence pending |
| 10 | Focused fake suite rejects prohibited interfaces and verifies `/Effects`-only lifecycle calls. | static/fake accepted |

## Residual Risks

- Static/fake verification cannot establish the user-observed lifecycle, both session boundaries, or restoration on the live host.
- Crash/power-loss rollback and hostile same-user races are explicitly out of scope.

## Review Findings

| Finding | Disposition |
|---|---|
| A symlinked `~/.local/share/plasma-auto-tiler-native-effect` parent can redirect staging outside the nonce-owned path. | fixed and confirmation-verified in `implementation/attempt-01/correction-01` |
| A namespace parent created by staging remains after normal restoration. | fixed and confirmation-verified in `implementation/attempt-01/correction-01` |

## Attempt and Review Counts

| Unit | Attempts | Corrections | Independent reviews |
|---|---:|---:|---:|
| implementation | 1 | 1 | 1 |

## Outcome

- Static/fake implementation and its one required independent review are accepted.
- The `user-attempt` remains pending. It is the sole source of live acceptance evidence and is not authorized for agents.

## Pending User Decisions

- None.
