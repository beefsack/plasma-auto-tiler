# Specification: Minimum Two Workspaces

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-26 by Orchestrator under autonomous mode

## Intent and Desired Outcome

Workspace cleanup must retain at least two global desktops. An eligible empty,
invisible desktop may be removed only when a fresh global desktop count is
greater than two.

## Scope and Non-Goals

In scope:
- Replace the cleanup floor of one with a fixed floor of two.
- Cover the exact two-empty-desktop switch and preserve all workspace modes.

Non-goals:
- Runtime configuration of the floor.
- Live KWin/Plasma work, unrelated cleanup, or changes to ownership rules.

## Applicable Principles and Decisions

- No `docs/principles.md` exists in the repository.
- Orchestrator-approved intent: fixed global minimum of two workspaces.

## Constraints

- Preserve trailing-empty reuse, visibility protection, ownership-independent
  eligibility above the floor, all three workspace modes, and dispatch
  idempotence.
- Production scope is limited to `kwin/src/controller-workspace-state.ts`;
  tests to `kwin/tests/controller-shared-workspaces.test.ts`; use
  `kwin/src/controller.ts` only on evidence and record why.
- Do not alter protected dirty paths, containers, process records, or unrelated
  untracked paths. Do not stage, commit, push, run live work, or delete files.

## Acceptance Criteria

- [ ] With exactly two eligible empty invisible desktops, cleanup removes none.
- [ ] With more than two global desktops, cleanup can remove eligible empty,
  invisible desktops without reducing the global count below two.
- [ ] Existing behavior for trailing-empty reuse, visibility protection,
  ownership-independent eligibility, all three workspace modes, and idempotent
  dispatch remains covered and passing.
- [ ] Focused bundled Node regression test, `npm --prefix kwin run typecheck`,
  and one final `npm --prefix kwin test` pass on fresh evidence.

## Unresolved Questions

- None. Stop and report if the existing workspace fixture cannot express the
  two-empty switch without a new harness contract.

## Consequential Decisions

- The floor is fixed at two because the approved global safety minimum takes
  precedence over archived floor-of-one behavior.
