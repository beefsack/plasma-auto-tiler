# Specification: Floor-Aware Rebalancing Feasibility

Ownership and approval:
- Owner: Lead `lead-openai`
- Status: Approved 2026-08-15 by parent Orchestrator under autonomous mode

## Intent and Desired Outcome

Determine whether a future, configurable floor-aware rebalancing option could
adjust only existing ancestor ratios to make an intended leaf splittable under
KWin's 15% minimum-size floors. Preserve a durable, evidence-backed boundary
for later implementation work.

## Scope and Non-Goals

In scope:

- Model minimum-size floors through the existing owned-tree decoding, planning,
  reconstruction, and split-geometry behavior.
- Assess an ancestor-ratio adjustment candidate that remains nonstructural.
- Specify prerequisite sequencing, rollback or impossibility behavior, static
  planner tests, and a future live spike.

Non-goals:

- Change the current nearest-valid fallback or implement the future option.
- Add another structural insertion path.
- Run tests, access protected paths, install dependencies, mutate Git, or
  perform live KWin or Plasma mutation.

## Applicable Principles and Decisions

- No project `docs/principles.md` exists at research start.
- `docs/handover.md` sections 8-10 constrain the investigated host behavior
  and known structural crash class.

## Constraints

- Inspect only the current owned-tree decode, planning, reconstruction,
  split-geometry code and tests; the named handover sections; archived
  insertion specifications; and no more than two authoritative KWin
  API/source references.
- The outcome must distinguish mathematical feasibility from host-validated
  feasibility and identify product or host decisions that remain unresolved.

## Acceptance Criteria

- [ ] Durable research defines a pure subtree floor model and a risk-ranked
  candidate ancestor adjustment algorithm.
- [ ] Research states the invariants needed to keep ratio changes
  nonstructural, including failure and rollback boundaries.
- [ ] Research specifies ordering, yields, fresh decode requirements, and
  multi-output work-area interactions before a later split.
- [ ] Research lists exact static planner tests and a bounded live proof spike.
- [ ] Research cites inspected project evidence and no more than two
  authoritative KWin references.

## Unresolved Questions

- Is automatic rebalancing an acceptable future opt-in product behavior, and
  what user-visible refusal or rollback semantics should it expose?
- Can the target KWin versions reliably apply and expose ratio-only changes at
  the required synchronization boundary?

## Consequential Decisions

- Keep this as parked research. Current nearest-valid fallback behavior is
  unchanged unless separately specified and approved.
