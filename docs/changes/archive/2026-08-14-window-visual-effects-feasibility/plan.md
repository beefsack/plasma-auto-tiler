# Research Plan: Window Visual Effects Feasibility

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-15 by Orchestrator under user-authorized autonomous mode; finalized and archived

## Technical Approach

A bounded source review of current project packaging and four authoritative
KDE/KWin references establishes the architecture boundary. The durable result
separates documented capability from live-only claims and leaves consequential
choices parked.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification |
|---|---|---|---|---|
| window-effects-research-01 | Establish the requested Plasma 6 feasibility evidence and architecture boundary. | - | Current project packaging; four authoritative KDE/KWin references; documentation only. | Lead validates every listed source URL, project metadata, claim-level confidence, and the explicit parked live-decision matrix. |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Progress

- [x] window-effects-research-01 Establish feasibility evidence and durable conclusions.

## Parked Decisions and Live Validation

- Visual policy for the highlight and rounded-corner treatment is parked as a
  product decision.
- Native C++ versus QML/declarative carrier is parked pending the live-decision
  matrix in `research/feasibility.md`; the research does not choose either.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Sourced architecture boundary is established with confidence and limits. | `research/feasibility.md` Findings, Architecture Boundary, and Sources; all four URLs resolved on 2026-08-15. |
| Candidate architectures and excluded decoration-only coverage are explicit. | `research/feasibility.md` Architecture Boundary and Candidate Architectures. |
| Packaging implications and live decisions are recorded without live claims. | `research/feasibility.md` Project Packaging and Dependencies and Live Decision Matrix. |
| Visual policy and carrier selection remain parked. | This plan's parked decisions and `research/feasibility.md` Parked Decisions. |

## Residual Risks

- Documentation and source inspection cannot prove compositor behavior,
  third-party native extension support, package behavior, or coverage across
  real clients; the live-decision matrix remains required before implementation.

## Final Outcome

- Research result accepted and archived. A compositor effect is viable for an
  active-window border or highlight with active-window tracking. Decoration-only
  treatment cannot establish the required coverage. Declarative QML clipping of
  arbitrary client content is undocumented. Native C++ is the leading rounded-
  corner candidate, not a selected or proven carrier. No feature was delivered.
