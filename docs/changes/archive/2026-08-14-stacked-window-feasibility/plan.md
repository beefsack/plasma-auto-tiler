# Research Plan: Stacked Window Feasibility

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-15 by Orchestrator under user-authorized autonomous mode; finalized and archived

## Technical Approach

One bounded, read-only Worker investigation establishes current project
invariants and no more than three authoritative KWin references. The Lead
validates citations and claim boundaries, then writes durable feasibility
research. Product interaction policy and all live behavior remain parked.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification |
|---|---|---|---|---|
| stacked-window-research-01 | Establish the documented and current-code feasibility boundary for multiple windows sharing one owned Custom Tile. | Approved research specification | Ownership, occupancy, drag, focus, reconstruction, lifecycle, tests, prior visual-carrier research, and at most three KWin references. | Lead validates citations, scope compliance, invariant map, risk ranking, and explicit static-versus-live boundary. |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Progress

- [x] stacked-window-research-01 Bounded feasibility evidence and architecture boundary recorded.

## Pending User Decisions

- Group ordering, selection, activation, keyboard behavior, header controls,
  and visual policy are product decisions and remain parked.
- Any live stability spike requires separate authorization after reading
  `docs/live-kwin-testing.md`.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| KWin capability and its limits are sourced. | `research/feasibility.md` KWin Boundary and Sources; assignment cardinality is explicitly unproven. |
| One-occupant redesign boundary is explicit. | `research/feasibility.md` Current One-Occupant Boundary and Membership And Lifecycle. |
| Header, architecture, prototype, live spike, and parked decisions are explicit. | `research/feasibility.md` Header Dependency, Risk-Ranked Architecture, Static Prototype And Live Spike Boundaries, and Parked Product Decisions. |
| No mutation occurred. | Lead inspection and final Git status show documentation-only changes; the Worker changed no files. |

## Residual Risks

- Tile cardinality, live stacking, activation, visibility, and effect-carrier
  behavior remain unproven on the target KWin version.
- The sole Worker exceeded its hard call budget; its source-map report is
  recorded only as a revalidation map, not standalone acceptance evidence.

## Final Outcome

- Research accepted and archived. A logical multi-member group is safe only as
  a non-mutating static model until a live spike proves KWin shared-tile
  behavior. No product interaction policy, visual carrier, or feature was selected.
