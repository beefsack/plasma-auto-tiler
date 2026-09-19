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
- No live KWin, Plasma, or D-Bus testing occurred. User live acceptance remains
  a repeat of the diagnosed multi-output setup.
