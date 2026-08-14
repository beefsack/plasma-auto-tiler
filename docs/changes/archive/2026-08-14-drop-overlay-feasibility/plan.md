# Plan: Drop Overlay Feasibility

Ownership and approval:
- Owner: Lead `lead-openai`
- Status: Completed and archived 2026-08-15 under explicit autonomous authorization

## Technical Approach

One bounded, read-only research unit inspected the existing controller's drag state and package metadata, then correlated those facts with three authoritative KDE/KWin documentation pages. The accepted outcome preserves only documented capabilities and clearly marks all runtime behavior unproven.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification |
|---|---|---|---|---|
| drop-overlay-research-01 | Determine the documented outline and QML-effect surfaces, and the smallest live proof before architecture selection. | - | Existing controller drag state, package metadata, and three KDE/KWin documentation pages. | Lead validated citations, scope compliance, source facts, and final claims against the repository and documentation. |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution slices use `unit-<n>/attempt-<n>`.

## Progress

- [x] drop-overlay-research-01 - accepted 2026-08-15. See `research/feasibility.md`.

## Pending User Decisions

- None for this completed research change. Rich QML carrier and controller-to-visual bridge selection remain parked for a later change after the live outline spike.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Ordinary JavaScript outline surface and QML effect drawing are documented. | KDE [KWin scripting API](https://develop.kde.org/docs/plasma/kwin/api/) documents rectangle-only `showOutline()` / `hideOutline()`; KDE [KWin Effects](https://develop.kde.org/docs/plasma/kwineffect/) documents `KWin/Effect`, `SceneEffect`, and QtQuick drawing. |
| Current controller geometry, motion, and cleanup claims are bounded. | `kwin/contents/code/main.js` captures eligible drag state and resolves a finish target from cursor/frame and decoded topology; its stepped handler is empty. `research/feasibility.md` records motion cadence and cleanup as live-only. |
| Bridge and Custom Tile claims do not exceed reviewed documentation. | The three cited public pages document the separate script and declarative-effect surfaces; no ordinary-script-to-effect bridge or declarative-effect Custom Tile mutation surface was found. The research does not claim absence of private mechanisms. |
| Recommendation, parked decisions, unknowns, and live proof are durable. | `research/feasibility.md` recommends the minimal live outline spike and parks rich QML carrier and bridge architecture. |
| No prohibited production or host mutation occurred. | Scoped Git inspection found documentation-only change artifacts. No live test, package, dependency, or host operation was run. |

## Residual Risks

- The target KWin/Plasma runtime may not provide usable motion cadence or reliable cleanup for the ordinary outline.
- XWayland behavior has not been tested or established.
- A QML carrier and controller-to-visual bridge remain unselected and unsupported by a documented ordinary-script/effect bridge.

## Final Outcome

- Documentation supports a minimal ordinary-JavaScript outline spike only. It does not establish live overlay feasibility. Rich QML carrier and bridge architecture are parked.
