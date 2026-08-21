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
- One central structural-completion hook only: the successful phase-two rebuild
  in `TileController.settleScopeRebuild`, with drag destination preview taking
  precedence over a group flash.

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
- **The single central hook is deliberate quick-and-dirty debt. It must be
  REPLACED, not extended with additional call sites, when its known coverage
  gaps need to be closed.**
- Known gaps: `applyPreset` manual preset splits; keyboard insertion completion;
  `completeDrag` split and collapse flows; automatic direct insertion; owned
  freed-leaf collapse; and cross-workspace source collapse plus deferred
  destination adoption. These flows bypass `settleScopeRebuild`'s successful
  phase-two rebuild, so they do not flash. This is an accepted limitation of
  the central-hook debt, not authorization to add hook call sites.

## Acceptance Criteria

- [ ] A successful operation reaching the chosen central completion hook shows
      one outline for the focused leaf's parent split, then hides it after a
      short fixed delay.
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
- The minimal central hook knowingly leaves gaps. Closing them later requires
  replacing the hook mechanism, not adding one-off call sites.
