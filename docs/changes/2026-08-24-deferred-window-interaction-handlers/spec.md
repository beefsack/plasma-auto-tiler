# Specification: Deferred Window Interaction Handlers

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-25 by Orchestrator under autonomous mode
- Commit/push: allowed after all accepted units; Lead owns staging

## Intent and Desired Outcome

Fix the generic path where a window is added before its desktop membership is
settled, becomes eligible during deferred reevaluation, and is placed without
the interaction handlers attached for immediately eligible windows. Before any
move signal can be processed, deferred-eligible windows must receive the same
interaction handlers as immediately eligible additions.

The reported Steam behavior is the motivating observation, not an application
identity contract. No Steam-specific branch is permitted.

## Scope and Non-Goals

In scope:

- One atomic regression and generic controller fix for deferred eligibility.
- Static integration verification of the affected controller behavior.
- A user-run Steam move/placement journey as later acceptance evidence.

Non-goals:

- Steam identity, caption, desktop-file, or process-specific handling.
- Interactive resize implementation or changes to the current unsupported
  resize policy.
- COSMIC behavior, drag-gap work, or unrelated event refactoring.

## Acceptance Criteria

- [ ] A deterministic regression starts with a window whose desktop membership
      is unsettled, adds it, settles membership, runs deferred reevaluation,
      and proves its interaction handlers are attached before move signals.
- [ ] The generic fix gives a deferred-eligible window the same interaction
      handling as an immediately eligible window without altering identity
      behavior or resize policy.
- [ ] Static gates `G-01` through `G-05` pass at their recorded post-change
      expectations.
- [ ] User-run gate `L-01` records Steam move/placement evidence. This is
      parked while no user live work is available.

## Evidence and Constraints

- The deferred-placement path is at
  `kwin/src/controller-reflow-observers.ts:346-371`; the immediate add path is
  at `kwin/src/controller.ts:1594-1629`.
- Interactive resize is deliberately rejected at
  `kwin/src/controller-interactive-drag.ts:818-864`. Whether to support it is
  a pending user decision, not an implementation implication of this change.
- All work remains generic. The current boundary exposes no application
  identity suitable for a Steam special case.
- No live KWin/Plasma action occurs without user authorization and the typed
  prerequisites in `plan.md`.
