# Plan: Focused Group Outline

Ownership and approval:
- Owner: Lead
- Status: Approved by user, 2026-08-21

## Technical Approach

Use the existing script-layer outline seam for the focused leaf's parent split.
Unit-01 uses the successful phase-two rebuild in `settleScopeRebuild` as its
one existing structural-completion point and adds one direct helper there. The
helper shows the parent geometry, schedules one fixed delay, and identity-guards
the hide. Drag preview takes precedence.

This central hook is approved quick-and-dirty debt: it must be REPLACED, not
extended with further hooks, when the known coverage gaps are addressed.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification |
|---|---|---|---|---|
| unit-01 | Add the single-hook focused group flash, stale seam-comment correction, exact gap record, and focused tests. | - | `kwin/src/controller.ts`, generated `kwin/contents/code/main.js`, `kwin/tests/controller-*.test.ts`, change artifacts, backlog | Static: focused tests, `npm --prefix kwin test`, `npm --prefix kwin run typecheck` |
| unit-02 | Independently review unit-01 and rerun static verification. | unit-01 | unit-01 diff and evidence | Static: review findings plus both required commands |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Progress

- [x] unit-01 single-hook implementation and tests
- [x] unit-02 independent review and verification

## Attempt Accounting

No entries.

## Pending User Decisions

- None.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Focused parent split flashes after the chosen central completion flow | `flashes the focused leaf parent after automatic reconstruction` |
| Root leaves and invalid parents do not flash | `does nothing for a focused root leaf without a layout parent`; `does nothing for a focused leaf with invalid layout parent geometry` |
| Drag preview precedence and stale-hide safety | `keeps stale group callbacks and group flashes from replacing a drag outline` |
| Static correctness | `npm --prefix kwin test`: 931 tests, 88 suites, 931 pass, 0 fail; `npm --prefix kwin run typecheck`: clean |

## Residual Risks

- The single central hook intentionally does not cover every structural path.
  Its exact omitted paths are recorded by unit-01 and require a replacement
  mechanism rather than additional hooks.

## Final Outcome

- Static implementation accepted. User visual validation remains the intended
  live acceptance and was not run by agents.
