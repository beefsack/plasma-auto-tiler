# Plan: Reference Profile Invariants

Ownership and approval:
- Owner: Lead `lead-openai`
- Status: Approved 2026-08-15 by autonomous-mode instruction

## Technical Approach

Verify catalog source tags against the comparison document's primary-source
table. Correct the verified documentation drift, then cover the invariant in
the smallest existing catalog test file without changing runtime behavior.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification |
|---|---|---|---|---|
| reference-profile-invariant-01 | Correct the verified bspwm source declaration. | - | `docs/reference-wm-comparison.md` | `git diff --check` |
| reference-profile-invariant-test-02 | Enforce catalog-source-tag declarations. | reference-profile-invariant-01 | `kwin/tests/controller.test.ts` | Focused compiled regression test; typecheck; `git diff --check` |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Progress

- [x] reference-profile-invariant-01/attempt-01 checkpointed: documentation
  correction inspected.
- [x] reference-profile-invariant-test-02/attempt-01 accepted: focused
  catalog-source-tag regression and required checks completed. The Worker
  exceeded its 20-call limit, so no further Worker work was scheduled.
- [x] reference-profile-static-03/attempt-01 accepted: fresh read-only
  verification completed within its requested limit. The focused test,
  typecheck, full suite, and whitespace check passed.

## Pending User Decisions

- None.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| `[B1-EX]` is declared and the stale statement is removed. | Lead inspection: `kwin/src/controller.ts` declares `BSPWM_REF = "[B1-EX] bspwm examples/sxhkdrc"`; the comparison document now declares the matching pinned static fixture as static evidence, not a live run, and has no not-fetched bspwm limitation. |
| Undeclared catalog tags fail a regression test. | `kwin/tests/controller.test.ts` derives tags from `PROFILE_CATALOGS` and declarations independently from the comparison document's primary-source table. Fresh verification removed `[B1-EX]` in memory and observed the expected undeclared-tag assertion. |
| Required checks pass. | Fresh verification: focused compiled test passed (1/1), typecheck passed, full `npm --prefix kwin test` passed (759 tests, 74 suites), and `git diff --check` passed. |

## Residual Risks

- No live KWin/Plasma validation was run; it remains outside the approved
  scope.

## Final Outcome

- Accepted for completion and archival; runtime validation remains parked.
