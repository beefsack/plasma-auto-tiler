# Plan: Tiling Recovery Robustness

## Approach

Use source evidence to isolate the session-scoped inert transition, reproduce
the topology in an isolated nested compositor at most twice, then make the
smallest recovery-oriented controller and test change.

## Work Units

| ID | Work | Status | Verification |
|---|---|---|---|
| unit-01 | Map inert transitions and dwindle bounds. | accepted | Source citations and controller test seam review. |
| unit-02 | Attempt a 10+ window isolated nested topology reproduction. | pending | Private-config isolation plus topology evidence; two attempts maximum. |
| unit-03 | Implement the minimal recovery fix and discriminating regression tests. | pending | Pre-fix test failure, static suite, and affected tests. |

## Acceptance Evidence

| Criterion | Evidence |
|---|---|
| No permanent inert scope after geometry failure | unit-03 controller regression with an empty-child split seam. |
| Later lifecycle recovery | unit-03 lifecycle regression that proves a subsequent dispatch occurs. |
| Bounded nested validation | unit-02 log entry with private-XDG launcher and topology result. |
| Static baseline | unit-03 commands recorded in `log.md`. |

## Pending User Decisions

- If the minimal correction changes `markInert` policy beyond the failing
  geometry path, request Orchestrator approval before commit.

## Residual Risks

- KWin's minimum tile geometry limits deep dwindle capacity; recovery cannot
  create a viable child where KWin provides none.
