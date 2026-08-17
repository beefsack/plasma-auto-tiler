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
