# Drag-and-Drop Reorganisation: Native Custom-Tile Drop Research

Research for the drag-and-drop reorganisation change. This document records
prior findings A1-A4, their cited KWin 6.7.3 source locations, the explicit
consequence, the uninvestigated plugin-ownership question, the open
architecture decision, and the later documented-API findings B1-B5 below. It
predates the later `spec.md`, `plan.md`, and `state.md`; it remains historical
research rather than live acceptance evidence.

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

## Findings B1-B5 (documented API, mandated evidence hierarchy)

The primary source of truth is official KWin scripting documentation
(`https://develop.kde.org/docs/plasma/kwin/api/`), the binding layer second, and
C++ internals only as explanation.

### B1: The documented per-window drag signal set

The scripting API reference lists all four drag signals under `KWin::Window`
-> Signals, labelled `documented`:

- `interactiveMoveResizeStarted()`
- `interactiveMoveResizeStepped(const QRectF &geometry)`
- `interactiveMoveResizeFinished()`
- `moveResizedChanged()`

`moveResizedChanged` was previously not on the attachment boundary; it is now
attached and logged like the interactive move/resize signals.

### B2: The workspace-level hypothesis is refuted

The initial unverified hypothesis was that drag lifecycle might be
exposed at the workspace level as `windowStartUserMovedResized` /
`windowFinishUserMovedResized`. That hypothesis is refuted: those are
`EffectWindow` signals for effect plugins, not the scripting `Workspace` /
`Window` surface.

- Citation: `/tmp/opencode/kwin/src/effect/effectwindow.h:687` (start),
  `:703` (`windowStepUserMovedResized`), `:710` (finish), at pinned commit
  `45ec9a6d0ed312a803ff5658a2a3e61f221566c6` (v6.7.3). `EffectWindow` is the
  effects API, distinct from the scripting `Window` wrapper that scripts
  receive from `windowAdded` / `workspace.windowList()`.
- Consequence: no workspace-level drag signal exists for scripts; the
  per-window `interactiveMoveResize*` / `moveResizedChanged` signals are the
  only documented candidates, so the attachment boundary connects each of them
  defensively with distinct logs.

### B3: Diagnostics design and live-proof boundary

- Per-signal connect under `try/catch`, emitting exactly
  `plasma-auto-tiler:drag-attach-ok:<signal>` or
  `plasma-auto-tiler:drag-attach-failed:<signal>:<detail>` for each attempted
  connect, so "never attached" and "attached but never fires" stay distinct.
- Every attach guard skip logs `plasma-auto-tiler:drag-attach-skipped:<reason>`
  (window-list decode, max-windows, not-window, duplicate, no-scope,
  out-of-scope).
- Exactly one startup existing-window
  `plasma-auto-tiler:drag-attach-summary:<attempted>:<ok>:<failed>` after the
  initial attachment pass (`attempted = ok + failed`); later-window and
  scope-change attachments emit none, making the two kinds diagnosable.
- Diagnostic-only event logs `drag-started`, `drag-stepped`,
  `drag-move-resized-changed` prove delivery; only
  `interactiveMoveResizeFinished` drives reflow. No mid-drag tile mutation.
- Live-proof boundary: static suites exercise the instrumentation but cannot
  prove KWin delivers any signal. Only the user's journal
  (`journalctl --user -f`) is live proof, and the attach lines plus summary
  make a single live test decisive.
- Known unknown: Esc-cancellation is unverified. Whether a cancelled drag fires
  `interactiveMoveResizeFinished`, and its effect on the finish-only reflow,
  is not established and remains out of scope.

### B4: The false `no-interaction-signals` guard (live-proven)

The first live trial (unit-05/attempt-01) proved the attach path was inert
before any drag event was needed: **every** in-scope window was skipped by
`no-interaction-signals` and the startup summary was `0:0:0`. No `.connect()`
was ever attempted. KWin non-delivery of drag signals was therefore **never
tested**; the earlier "KWin delivers no drag event" framing was wrong.

- Root cause, source-derived: `isSignal` (`kwin/src/boundary.ts`) requires
  `isObject`, but QV4 exposes QObject signal properties as callable
  `QObjectMethod` functions, so `typeof` is `"function"` and the guard always
  short-circuited.
- Qt 6.10 source evidence: `qqmlpropertycache.cpp:90-101` (signals load with
  `FunctionType`), `:468-495` (signal method flags and handler cache);
  `qv4qobjectwrapper.cpp:322-323` (`Function.prototype` gains
  `connect`/`disconnect`), `:360-367` and `:367-368` (signal access returns
  `QObjectMethod::create`), `:1336-1418` (`method_connect` reads the Qt signal
  from `this`), `:2706-2712` (`QObjectMethod::create`).
- Official docs: `https://doc.qt.io/qt-6/qjsengine.html` (QObject Integration)
  and `https://doc.qt.io/qt-6/qtqml-syntax-signals.html` (Signal and Handler
  Event System) document that QObject signals are reachable from scripts and
  that QML signal syntax wraps them as callable members.
- KWin's window binding exposes the per-window signals to scripting at
  `src/scripting/workspace_wrapper.h:642` and `src/scripting/scripting.cpp:230,713`.
- Consequence: the whole-window `no-interaction-signals` guard is **removed**
  with no replacement pre-check. Attachment proceeds for every window passing
  the remaining guards; each individual `.connect()` either succeeds or throws
  under its own `try/catch`, and the per-signal failure line names the signal
  plus the observed `typeof`.
- `out-of-scope` uses exactly the same `scopeForWindow` + `windowInScope`
  predicates as `handleWindowAdded` tiling-eligibility and ownership; it is not
  widened. Known timing asymmetry only: `windowAdded` can be skipped during
  desktop settling and re-evaluated later, while attach simply waits for a
  later scope change.

### B5: QV4-shape test approximation

The function-valued signal regression test (controller) supplies signals as
functions whose `connect`/`disconnect`/`emit` live on a custom prototype or a
non-enumerable getter, approximating QV4's `QObjectMethod` shape in Node. The
test name and comment state explicitly that this approximates the QJSEngine
shape and is **not** live proof that KWin delivers these signals; its purpose
is to lock in the removal of the false pre-check. The artifact-smoke stub also
uses function-valued stub signals for the shipped bundle.

## Uninvestigated Question

- Our plugin's ownership involvement in the A2 exit path
  (`Tile::unmanage()` / `Window::requestTile(nullptr)`) is UNINVESTIGATED.

## Open Architecture Decision

- OPEN: how a native-fidelity reflow-on-drop should be achieved. The two
  candidate directions are (a) compiled C++ integration into the KWin
  drag/drop path and (b) a post-finish script workaround. This document makes
  NO recommendation; the choice remains open for a subsequent decision.

## Scope Limits

- Historical research scope only. This research did not create the later
  `spec.md`, `plan.md`, or `state.md` artifacts.
- No edits to production code, `devenv.nix`, project governance records, host
  settings, or protected untracked files.
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
