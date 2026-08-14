# Drop Overlay Feasibility

Status: Completed documentation research, 2026-08-15. This records documented
surfaces and source inspection only. It does not establish live behavior on the
target KWin/Plasma runtime or XWayland.

## Package Facts

- `kwin/metadata.json` declares `KPackageStructure: KWin/Script` and
  `X-Plasma-API: javascript`; it is an ordinary JavaScript KWin Script, not a
  declarative effect.
- `kwin/package.json` builds `src/entry.ts` into the IIFE
  `contents/code/main.js`.

## Accepted Evidence

| Question | Accepted conclusion | Confidence |
| --- | --- | --- |
| Ordinary JavaScript outline | The current package is a `KWin/Script` with `X-Plasma-API: javascript`. The scripting API documents only `showOutline(QRect)` or four geometry arguments and `hideOutline()`: the outline is moved when already shown and needs explicit hiding. This is rectangle-only feedback, not a documented rich QML surface. | High |
| Current controller geometry | The controller captures an eligible drag and, on finish, resolves a point from `workspace.cursorPos` or frame center against decoded tile topology. It can therefore compute a candidate target geometry. Its stepped handler is empty, so source inspection does not establish per-motion target updates, delivery cadence, or outline cleanup. | High for source facts; live behavior unproven |
| Declarative effect drawing | KDE documents a declarative `KWin/Effect` package with `contents/ui/main.qml` and `SceneEffect` delegates built from QtQuick items such as `Rectangle` and `Text`. That surface supports QML drawing. | High |
| Ordinary-script/effect bridge | No direct ordinary-script-to-declarative-effect runtime bridge or shared drag-state surface was found in the three reviewed public documentation pages. This is not proof that no private mechanism exists. | High for the bounded documentation search |
| Declarative-effect Custom Tile mutation | No declarative-effect Custom Tile mutation surface was found in the reviewed public documentation. The scripting API documents `workspace`, `tilingForScreen()`, and tile APIs for scripts; the effect documentation does not document an equivalent effect API. | High for the bounded documentation search |

## Recommendation And Parked Decisions

- Recommend one minimal live outline spike before any rich overlay work.
- Do not select a QML carrier, an ordinary-script/effect bridge, or a
  declarative-script conversion from this documentation evidence.
- Do not treat the absence of a documented bridge as proof that no private
  mechanism exists; it is sufficient only to avoid choosing an undocumented
  architecture.

## Required Live Spike

1. Add only a bounded ordinary-JavaScript outline path: show the documented
   rectangle for a candidate target during a controlled drag and hide it on all
   terminal, invalidation, and disable paths.
2. Observe visible outline updates during motion, target-geometry correctness,
   cleanup after completion and cancellation, and that the original drag input
   path is preserved.
3. Record the target KWin/Plasma version and test one XWayland drag separately
   if that compatibility claim is needed.
4. Falsify the narrow path if motion delivery is unusable, cleanup is unreliable,
   or the outline interferes with the drag. A failed spike returns all visual
   carrier and bridge choices to research; it does not justify an undocumented
   QML-effect bridge.

## Remaining Unknowns

- Actual behavior on the target KWin/Plasma version, including motion cadence,
  input routing, stacking, cleanup, and XWayland drag behavior.
- Whether a rich QML carrier or any controller-to-visual bridge is needed after
  the narrow outline result, and whether it has a supported interface.

## Sources

1. KDE, [KWin scripting tutorial](https://develop.kde.org/docs/plasma/kwin/):
   `KWin/Script` package structure, JavaScript and declarative-script types,
   and script `workspace` access.
2. KDE, [KWin Effects](https://develop.kde.org/docs/plasma/kwineffect/):
   declarative `KWin/Effect` packaging, `SceneEffect`, custom QtQuick drawing,
   and QML input handling.
3. KDE, [KWin scripting API](https://develop.kde.org/docs/plasma/kwin/api/):
   `workspace`, rectangle-only `showOutline()` / `hideOutline()`,
   `tilingForScreen()`, and Custom Tile scripting surfaces.
