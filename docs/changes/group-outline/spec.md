# Specification: Focused Group Outline

Ownership and approval:
- Owner: Lead
- Status: Approved by user, 2026-08-21

## Intent and Desired Outcome

COSMIC movement primarily reorganises windows into and out of groups and splits,
often without moving them far. Show the focused window's group boundary briefly
after structural operations so the user can validate those operations by eye.

**This is a deliberate, replaceable MVP, not the intended group-rendering
architecture.** It exists to support immediate COSMIC-model validation and is
expected to be replaced by a later design.

## Scope and Non-Goals

In scope:

- One KWin script-layer outline around the focused leaf's parent split geometry.
- Always-on, fixed-duration flashes using the existing `showOutline` and
  `hideOutline` seam.
- A mutation-transaction observer at the `boundary.ts` primitive perimeter. A
  successful return from `manageTile`, `assignWindowToTile`, `splitCustomTile`,
  or `removeCustomTile` marks the transaction. It flushes once per controller
  dispatch and once per each yielded structural callback at
  `controller.ts:6379-6387`, `controller.ts:7201-7204`, and
  `controller.ts:8186-8189`, because transaction state cannot span a yield.
- Drag destination preview takes precedence over a group flash.

Non-goals:

- Native/C++ rendering, scene items, or native-effect changes.
- Multiple or nested group outlines, style control, input handling, Meta-hold,
  configuration, or N-ary split migration.

## Applicable Principles and Decisions

- The user selected KWin `Workspace.showOutline`/`hideOutline`, focused-parent
  split geometry, and a transient post-structural-operation flash.
- The global outline is singular. Drag destination preview owns it while shown;
  a group flash must not replace or later hide a drag preview.

## Constraints

- The current binary tree defines a group as the focused leaf's parent split.
  A root leaf has no parent split and therefore no group outline.
- A delayed hide uses `scheduleOnce` outside the anti-oscillation domain and
  verifies that its flash still owns the outline before calling `hideOutline`.
- The primitive perimeter is the single hook. The `controller.ts:6505`
  `flashFocusedGroup()` call is removed, not supplemented.
- A flash fires on reported primitive success regardless of the enclosing
  operation's outcome. Geometry is read at flush time after the dispatch
  settles, so the outline is never geometrically stale.
- Shared primitives are not restricted. Transaction state sits beside
  `shownDropOutline` and `groupOutlineIdentity` at `controller.ts:1717-1718`
  and stays outside the anti-oscillation domain at `controller.ts:1638-1710`:
  no caching or timers are permitted in that domain.

## Acceptance Criteria

- [ ] A successful marked transaction shows one outline for the focused leaf's
      parent split, then hides it after a short fixed delay.
- [ ] Keyboard arrow window moves flash for both the empty-target `manageTile`
      path at `controller.ts:2543` and the occupied-target swap paths at
      `controller.ts:2862` and `controller.ts:2876`, including sibling swaps
      that retain the same parent.
- [ ] A root focused leaf and invalid parent geometry do not show an outline.
- [ ] A drag destination preview wins contention, and an expired group flash
      cannot hide a newer drag preview.
- [ ] Focused tests cover the flash geometry, no-parent case, stale hide guard,
      and drag precedence.
- [ ] `npm --prefix kwin test` and `npm --prefix kwin run typecheck` pass.

## Unresolved Questions

- None.

## Consequential Decisions

- The feature is always on with no setting because it is a transient validation
  tool expected to be replaced.
- A flash fires on reported primitive success even when the enclosing high-level
  operation later partially fails.
- Shared primitives remain unrestricted, including non-structural flows that
  use them.
- The central-hook debt is discharged by the mutation-transaction observer at
  the primitive perimeter.
