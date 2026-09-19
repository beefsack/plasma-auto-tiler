# Multi-Output Domain Bounds

## Goal

- Size each production Plan `(output, workspace)` domain from that output's
  usable area, not the global multi-screen work area.

## Scope

- Use KWin `PlacementArea` (0), retaining the existing output and desktop
  arguments, for foreground and helper-backed background/workspace-change Plan
  observations.
- Correct the local `clientArea` declaration comment that described `WorkArea`
  as per-output.
- Cover two outputs whose global work area differs from their usable local
  rectangles, including a nonzero output origin.

## Non-Goals

- No scaling conversion, workspace-policy, output-transfer, hotplug, focus, or
  geometry-authority change.

## Evidence

- The focused regression proves startup foreground and background plans use
  their respective local bounds, write gap-bearing planned geometry only inside
  those bounds, retain maximized write isolation, and do not change native
  focus or desktop visibility. It also covers hidden-domain and
  workspace-change observations.
- With the pre-fix option 5 temporarily restored, all three regression cases
  failed by observing the shared global rectangle. Static verification passed:
  `npm run typecheck --prefix kwin`, `npm test --prefix kwin` (777 pass),
  `npm run build --prefix kwin`, and `git diff --check`.
- The user manually accepted the output-placement result: "the windows stopped
  jumping around between monitors." This accepts only the diagnosed
  per-output placement behavior, not scaling or general geometry convergence.
- The supplied trace and screenshot also show a separate DP-6 alignment issue:
  exact planned `8,52,2032,1092` writes are later observed as shorter frames.
  That post-write clamp is under investigation and is not evidence that this
  per-output bounds fix regressed. No live KWin, Plasma, or D-Bus testing was
  performed for this record.
- A user-owned bottom-edge drag observation may narrow the separate issue only
  if it records both during-drag growth and the post-release result; snapback
  alone is not proof of a hard client or native cap because existing tiler
  resize policy can also act after release.
