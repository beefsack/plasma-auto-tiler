# Research Specification: Stacked Window Feasibility

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-15 by Orchestrator under user-authorized autonomous mode; finalized as bounded research

## Intent and Desired Outcome

Establish the technical boundary for multiple windows sharing one owned Custom
Tile and for a future custom group header. The result must distinguish current
code and documented KWin capability from behavior requiring a later live
stability spike. It does not select an interaction design or implement a
stacked-window feature.

## Scope and Non-Goals

In scope:

- Inspect current ownership, occupancy, drag, focus, reconstruction, and
  lifecycle behavior plus their focused tests.
- Use at most three authoritative KWin API or source references to determine
  assignment, stacking, visibility, and focus boundaries.
- Identify redesigned one-occupant invariants, membership persistence and
  removal requirements, and behavior boundaries for maximize, fullscreen, and
  floating windows.
- State how a custom group header depends on prior visual-carrier research.
- Define a non-mutating static prototype and a separate live stability spike.

Non-goals:

- Production code, test, package, dependency, installation, or configuration
  changes.
- Live KWin or Plasma mutation, commands, or behavior claims.
- Selecting group navigation, ordering, activation, header controls, or any
  other product interaction policy.

## Applicable Principles and Decisions

- `docs/principles.md` is absent at repository inspection time.
- No `docs/decisions.md` is changed or interpreted by this research.
- Prior visual-carrier evidence is a dependency for header rendering, not a
  carrier selection.

## Constraints

- Research only; no code edits, tests, live commands, protected-path changes,
  dependency installation, or Git mutation.
- One Worker only, using `stacked-window-research-01/attempt-01`, with a hard
  maximum of 20 Worker calls and mandatory return by its 16th call.
- Limit external evidence to at most three authoritative KWin API or source
  references.

## Acceptance Criteria

- [x] Durable research gives sourced, claim-limited answers on whether KWin
  permits multiple windows assigned to one Custom Tile and the resulting
  z-order, visibility, and focus implications.
- [x] The research identifies every relevant current one-occupant invariant and
  the persistence, removal, reconstruction, maximize, fullscreen, and float
  redesign boundary.
- [x] The header dependency, risk-ranked architecture, parked product choices,
  static prototype, and live stability spike are explicit.
- [x] No production or live-environment mutation is made.

## Unresolved Questions

- Which group interaction and ordering policy should a future feature provide?
- Which previously researched visual carrier, if any, can safely render a
  custom group header on the target KWin version?

## Consequential Decisions

- Product interaction choices remain parked; this research may only describe
  technical constraints they must satisfy.
- A static, non-mutating prototype and a live stability spike remain separate
  gates; neither is authorized by this change.
