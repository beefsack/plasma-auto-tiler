# Drag-and-Drop Reorganisation: Native Custom-Tile Drop Research

Research for the drag-and-drop reorganisation change. This document records
prior findings A1-A4, their cited KWin 6.7.3 source locations, the explicit
consequence, the uninvestigated plugin-ownership question, and the open
architecture decision. Research only: no specification, plan, log, or state
document exists for this change yet.

## Source Pin

- Repository: `https://invent.kde.org/plasma/kwin` (KWin 6.7.3).
- Tag: `v6.7.3`.
- Commit: `45ec9a6d0ed312a803ff5658a2a3e61f221566c6` (HEAD, detached).
- Local checkout used for spot-checks: `/tmp/opencode/kwin`, clean working
  tree (`git status` = clean), full materialization. Verify with
  `git -C /tmp/opencode/kwin rev-parse HEAD` and
  `git -C /tmp/opencode/kwin describe --tags --exact-match HEAD`.
- Line numbers below are repository-relative at the pinned commit.
- No runtime work, D-Bus access, script loading, or live-session interaction
  was performed during this research.

## Findings A1-A4

### A1: Shift during native custom-tile drag/drop

- Claim: Shift held during a native custom-tile drag/drop displays only the
  candidate custom-tile outline while moving, and releasing the pointer
  manages the picked custom tile.
- Citations:
  - `src/window.cpp:1240-1249` - during interactive move with
    `Qt::ShiftModifier`, computes `quickTileGeometry(QuickTileFlag::Custom)`
    at the pointer and shows/hides `workspace()->outline()` for it.
  - `src/window.cpp:2566-2575` - `endInteractiveMoveResize()` calls
    `finishInteractiveMoveResize(false)` (not cancelled) on release.
  - `src/window.cpp:1069-1111` - `finishInteractiveMoveResize(bool cancel)`;
    at 1103-1105, on non-cancel move with Shift, calls
    `setQuickTileMode(QuickTileFlag::Custom, ...)`.
  - `src/window.cpp:3677-3703` - `setQuickTileMode(Custom)` picks the tile at
    the anchor via `workspace()->rootTile(...)->pick(...)` and manages it.
  - `src/tiles/customtile.cpp:460-483` - `RootTile::pick()` selects the
    nearest descendant non-layout tile by center distance.

### A2: Without Shift, no custom tile is applied

- Claim: without Shift the dragged window gets no custom tile applied and
  floats at the drop point. Tiling exits through `Tile::unmanage()` and
  `Window::requestTile(nullptr)`.
- Citations:
  - `src/tiles/tile.cpp:427-464` - `Tile::unmanage()` removes the window and,
    when it was the requested tile, calls `window->requestTile(nullptr)`.
  - `src/window.cpp:3750-3790` - `Window::requestTile(Tile *)`; the
    `nullptr` branch restores the window to its restore/floating geometry
    (interactive-move anchor handling at 3780-3785) before emitting
    `requestedTileChanged()`.
- Ownership question: **our plugin's ownership involvement in this path is
  UNINVESTIGATED.** Whether our plugin holds or relinquishes the dropped
  window's tile membership during this native path has not been established.

### A3: Scripting surface sees the drop only passively

- Claim: scripts receive interactive move/resize `started`/`stepped`/`finished`
  and can read geometry, but cannot veto, cancel, or redirect the native drop;
  they can only re-tile after finish via `tile.manage()` or `window.tile`.
- Citations:
  - `src/window.h:1483-1514` - `tileChanged`, `requestedTileChanged`, and the
    `interactiveMoveResizeStarted`/`interactiveMoveResizeStepped`/
    `interactiveMoveResizeFinished` signals.
  - `src/window.cpp:1205, 1236` - the two `interactiveMoveResizeStepped`
    emissions (resize and move paths).
  - `src/tiles/tile.h:127-128` - `Q_INVOKABLE bool manage(Window *)` and
    `Q_INVOKABLE bool unmanage(Window *)`.
- The no-veto/no-cancel/no-redirect reading follows from the cited surface:
  the scripting signals are notifications only; no scripting call can
  intercept the in-progress native drag.

### A4: Script rendering path and outline access

- Claim: script QML rendering is only available through the scene-replacing
  `ScriptedQuickSceneEffect`; `workspace().outline()` is C++ internal.
- Citations:
  - `src/scripting/scripting.cpp:687-720` - QML type registrations, including
    `ScriptedQuickSceneEffect` as `org.kde.kwin` `SceneEffect` (line 704) and
    the `Workspace` singleton (706-708).
  - `examples/quick-effect/package/contents/ui/main.qml` - example declarative
    script rooted at `SceneEffect`.
- Refinement recorded during spot-check: the scripting `WorkspaceWrapper`
  exposes geometry-only `showOutline(QRect)` / `showOutline(x, y, w, h)` /
  `hideOutline()` slots (`src/scripting/workspace_wrapper.h:616-631`,
  `src/scripting/workspace_wrapper.cpp:323-335`). The `Workspace::outline()`
  accessor returning the internal `Outline` object (`src/workspace.h:419`) is
  not exposed to scripts. Scripts therefore cannot render or reuse the native
  candidate-tile outline object; they have only a geometry-only outline with
  no tile association or candidate preview semantics.

## Consequence

Native-fidelity reflow-on-drop requires compiled C++ integration, or a
post-finish script workaround that races floating-drop completion and has no
veto guarantee and no equivalent preview.

## Uninvestigated Question

- Our plugin's ownership involvement in the A2 exit path
  (`Tile::unmanage()` / `Window::requestTile(nullptr)`) is UNINVESTIGATED.

## Open Architecture Decision

- OPEN: how a native-fidelity reflow-on-drop should be achieved. The two
  candidate directions are (a) compiled C++ integration into the KWin
  drag/drop path and (b) a post-finish script workaround. This document makes
  NO recommendation; the choice remains open for a subsequent decision.

## Scope Limits

- Research only. `spec.md`, `plan.md`, `log.md`, and `state.md` are NOT created
  by this research.
- No edits to `kwin/contents/code/main.js`, production code, `devenv.nix`,
  `docs/principles.md`, `docs/decisions.md`, host settings, or protected
  untracked files.
- No live KWin/Plasma operations, D-Bus access, install/enable/disable, or
  nested compositor.
- No Git commits.
- The architecture decision above is recorded as open, not resolved here.

## Spot-Check Evidence

All twelve supplied citation groups were checked against the pinned source at
`/tmp/opencode/kwin` (HEAD `45ec9a6d0ed312a803ff5658a2a3e61f221566c6`, tag
`v6.7.3`).

| Citation | Checked | File/line evidence | Mismatch |
| --- | --- | --- | --- |
| `src/window.cpp:1240-1249` | Yes | Shift branch shows/hides `workspace()->outline()` for `QuickTileFlag::Custom` geometry | None |
| `src/window.cpp:2566-2575` | Yes | `endInteractiveMoveResize()` -> `finishInteractiveMoveResize(false)` | None |
| `src/window.cpp:1069-1111` | Yes | `finishInteractiveMoveResize`; Shift branch at 1103-1105 calls `setQuickTileMode(QuickTileFlag::Custom, ...)` | None |
| `src/window.cpp:3677-3703` | Yes | `setQuickTileMode(Custom)` picks via `RootTile::pick` and manages | None |
| `src/tiles/customtile.cpp:460-483` | Yes | `RootTile::pick` nearest non-layout descendant | None |
| `src/tiles/tile.cpp:427-464` | Yes | `Tile::unmanage` -> `requestTile(nullptr)`; `add`/`remove` | None |
| `src/window.cpp:3750-3790` | Yes | `Window::requestTile` nullptr branch restores floating geometry | None |
| `src/window.h:1483-1514` | Yes | tile/requestedTile signals; interactive move/resize started/stepped/finished | None |
| `src/window.cpp:1205, 1236` | Yes | `interactiveMoveResizeStepped` emissions | None |
| `src/tiles/tile.h:127-128` | Yes | `Q_INVOKABLE` `manage`/`unmanage` | None |
| `src/scripting/scripting.cpp:687-720` | Yes | QML registrations; `SceneEffect` = `ScriptedQuickSceneEffect` at 704 | None; refinement on outline below |
| `examples/quick-effect/package/contents/ui/main.qml` | Yes | Declarative script rooted at `SceneEffect` | None |

Mismatches: none. Refinement: A4's "workspace().outline() is C++ internal"
holds for the accessor/object; the scripting surface additionally exposes
geometry-only `showOutline`/`hideOutline` slots, which does not contradict the
claim but adds precision (recorded under A4).
