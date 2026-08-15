# Research Plan: Declarative Active-Border Feasibility

Ownership and approval:
- Owner: Lead `lead-openai`
- Status: Approved 2026-08-15 by parent Orchestrator under user-authorized autonomous mode; finalized and archived

## Technical Approach

One bounded documentation synthesis records accepted declarative architecture
evidence, cites the preceding feasibility archive, and defines the live proof
required before any production decision. No transient execution log is needed.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification |
|---|---|---|---|---|
| active-border-declarative-research-01 | Preserve the declarative active-border feasibility boundary, live matrix, and parked decisions. | Accepted prior window-visual-effects feasibility archive | Research documentation only | Lead checks every acceptance criterion against `research/feasibility.md`, local links, and `git diff --check`. |

## Progress

- [x] active-border-declarative-research-01 Established and archived the bounded research result.

## Parked Decisions

- Declarative active-border production is parked because `SceneEffect` requires
  full-scene reconstruction rather than a transparent overlay.
- Native C++ remains the leading border and rounded-corner candidate, not a
  selected implementation. A separate toolchain/package/dependency decision is
  required before any `devenv.nix` change; that change requires a session
  restart before use.
- Border visuals and all coverage claims remain unselected and unproven.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Accepted declarative facts are durable. | `research/feasibility.md` sections "Accepted Architecture Facts" and "Declarative Conclusion". |
| Prior evidence is cited without fresh live claims. | `research/feasibility.md` section "Citations From Accepted Reports". |
| Exact future proof is defined. | `research/feasibility.md` section "Exact Live Proof Matrix". |
| Decisions and claim limits remain parked. | This plan's "Parked Decisions" and `research/feasibility.md` section "Parked Decisions and Claim Limits". |

## Residual Risks

- Full scene reconstruction can alter compositor rendering, stacking, and
  lifecycle behavior; it has no authorized live validation.
- Native C++ feasibility remains conditional on a separately approved
  development, packaging, and dependency decision.

## Final Outcome

- Accepted research-only conclusion: the declarative coordinate and active
  binding primitives are available, but `SceneEffect` makes a border a
  full-scene reconstruction problem. Production declarative work is parked;
  native C++ remains the leading unselected path for border and rounded-corner
  work.
