# Specification: Empty Workspace Switch Cleanup

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-15 by Orchestrator and user

## Intent and Desired Outcome

After a completed workspace switch, remove controller-owned empty desktops that
are invisible on every output, while retaining required trailing capacity and
all protected desktop types.

## Scope and Non-Goals

In scope:

- Pass an explicit switch-cleanup intent only from the completed current-desktop
  switch signal into desktop reconciliation.
- Later units will implement cleanup of controller-owned empty desktops at any
  position when invisibility and fresh-read safety conditions are met.
- Preserve one trailing owned empty desktop per mode/domain and the last global
  desktop.

Non-goals:

- Change candidate selection or desktop removal behavior in this unit.
- Clean up middle desktops for non-switch triggers.
- Treat unowned desktops, floating-window occupancy, or sticky windows as
  removable occupancy signals contrary to the approved semantics.

## Applicable Principles and Decisions

- `docs/principles.md` is absent.
- Approved semantics: fail closed when desktop visibility or membership cannot
  be read; sticky windows do not occupy desktops; fresh-read desktop, mode,
  visibility, and occupancy state after each removal.

## Constraints

- Edit only controller code, controller tests, and this change's artifacts.
- Do not run live KWin/Plasma tests, installation, staging, commits, or full
  build paths, except the explicitly authorized declared bundle build needed to
  regenerate KWin's tracked executable artifact.
- The trigger-plumbing implementation must default cleanup intent to false for
  every non-switch caller.

## Acceptance Criteria

- [x] `handleCurrentDesktopChanged` requests enhanced cleanup through desktop
  reconciliation only after its completed switch path.
- [x] Output, screen, window, and generic scope-change triggers reconcile with
  switch-cleanup intent disabled.
- [x] This unit does not change desktop cleanup candidate selection or removal
  behavior.
- [x] Focused tests and TypeScript typechecking pass.
- [x] Later cleanup implementation removes only controller-owned empty desktops
  invisible on every output, preserves unowned desktops and floating occupancy,
  ignores sticky windows, retains trailing capacity and the last global desktop,
  fails closed on unreadable visibility/membership, and fresh-reads state after
  each removal.

## Unresolved Questions

- None for trigger plumbing. Mode cleanup behavior is deferred to its planned
  unit.

## Consequential Decisions

- An explicit boolean intent is preferred over inferring cleanup eligibility
  from a reconciliation caller, so non-switch paths remain unchanged by
  default.
