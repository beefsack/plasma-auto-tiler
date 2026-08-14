# Plan: Floor-Aware Rebalancing Feasibility

Ownership and approval:
- Owner: Lead `lead-openai`
- Status: Approved 2026-08-15 by parent Orchestrator under autonomous mode

## Technical Approach

One read-only research unit will trace the designated code and documentary
evidence, derive a floor-aware model and constrained ratio-only candidate, and
separate static conclusions from future host proof. The Lead will validate the
returned evidence, write durable findings, then complete the archive
transaction if all research acceptance criteria are met.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification |
|---|---|---|---|---|
| floor-rebalance-research-01 | Establish feasibility, algorithm boundary, evidence, and follow-up proof for ratio-only ancestor rebalancing. | - | Designated source/tests, `docs/handover.md` sections 8-10, archived insertion specs, up to two KWin references. | Lead evidence review against every specification acceptance criterion. |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Progress

- [x] floor-rebalance-research-01 Established feasibility, algorithm boundary,
  evidence, and follow-up proof for ratio-only ancestor rebalancing.

## Pending User Decisions

- Parked for a later implementation specification: opt-in behavior,
  configuration, refusal semantics, supported KWin versions, and ratio-write
  synchronization policy. These do not block this completed research boundary.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Pure floor model and candidate algorithm | `research/feasibility.md` sections "Pure Floor Model" and "Candidate Ratio-Only Planner". |
| Nonstructural invariants and failure boundary | `research/feasibility.md` section "Runtime Boundary And Invariants". |
| Ordering, fresh decode, and multi-output treatment | `research/feasibility.md` sections "Runtime Boundary And Invariants" and "Multi-Output Scope". |
| Exact static tests and live spike | `research/feasibility.md` sections "Required Tests Before Implementation" and "Future Live Proof Spike". |
| Bounded authoritative sources | `research/feasibility.md` section "Evidence Boundary" lists two references. |

## Residual Risks

- Multi-ancestor updates and ratio-only timing are unproven on a live host.
- Product policy must define opt-in and post-write refusal semantics.

## Final Outcome

- Accepted research-only conclusion: ratio-only ancestor rebalancing is
  mathematically feasible when the recursive floor model admits an allocation;
  live proof and parked product decisions are required before implementation.
