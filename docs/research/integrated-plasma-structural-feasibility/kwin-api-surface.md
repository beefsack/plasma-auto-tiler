# KWin 6.7.3 API-Surface Matrix for Persistent Authored Layout

Source-only research for `unit-01/attempt-01`. This matrix classifies every
mandatory structural-workflow capability against the KWin 6.7.3 scripting/QML
binding surface, the public C++ plugin/effect surface, and the
private/internal-only implementation paths. It is review input only; it is not
acceptance evidence and makes no runtime claims.

## Source Pin and Verification

- Repository: `https://invent.kde.org/plasma/kwin` (KWin 6.7.3).
- Tag: `v6.7.3`.
- Commit: `45ec9a6d0ed312a803ff5658a2a3e61f221566c6` (HEAD, detached).
- Working tree at research time: clean (`git status` = clean, detached HEAD).
- Checkout state note: `/tmp/opencode/kwin-src` is a sparse checkout. Only
  `src/` root files plus `src/effect/`, `src/input/`, `src/scripting/`,
  `src/wayland/` and the effects autotest trees are materialized. `src/tiles/`,
  `src/plugins/`, `src/core/`, and several other trees are tracked at HEAD but
  not materialized.
- Evidence method: omitted files were read with `git show HEAD:<path>`; whole
  pinned tree searches used `git grep HEAD -- <pattern>`; omitted blobs were
  verified present with `git cat-file -e HEAD:<path>` and `git ls-files`.
  Line numbers were derived from the pinned blobs. All citations below are
  repository-relative at the pinned commit.
- No runtime work, D-Bus access, script loading, configuration change, or
  live-session interaction was performed.

## Binding-Surface Search Scope (recorded)

The complete binding/exposure surface was searched, not just implementations:

1. `org.kde.kwin.Scripting` D-Bus interface and ordinary KWin `.js` scripts
   (`X-Plasma-API=javascript`): `src/scripting/scripting.h`,
   `src/scripting/scripting.cpp`; global-object setup at
   `src/scripting/scripting.cpp:214-294`.
2. Declarative (QML) KWin scripts (`X-Plasma-API=declarativescript`):
   `src/scripting/scripting.cpp:565-601`; QML type registrations at
   `src/scripting/scripting.cpp:693-719`.
3. `.js` `ScriptedEffect` and QML `ScriptedQuickSceneEffect`
   (`declarativescript` effects): `src/scripting/scriptedeffect.h`,
   `src/scripting/scriptedeffect.cpp:256-272`, `src/effect/effectloader.cpp`.
4. Public C++ effects/plugins: installed header set at
   `src/CMakeLists.txt:478-552` (plus `effect/`, `core/`, `utils/`, `scene/`,
   `opengl/`, `vulkan/` install blocks at `src/CMakeLists.txt:554-680`); effect
   signals in `src/effect/effectwindow.h`, `src/effect/effecthandler.h`.
5. QJSEngine global-object registrations: `src/scripting/scripting.cpp:214-294`
   (scripts) and `src/scripting/scriptedeffect.cpp:256-272` (effects).
6. QML registrations: `src/scripting/scripting.cpp:693-719`;
   `src/plugins/private/plugin.cpp` (`org.kde.kwin.private.effects`).
7. D-Bus interfaces: every `registerObject` site in `src/` and every `*.xml`
   introspection file (`src/org.kde.kwin.Effects.xml`,
   `src/scripting/org.kde.kwin.Script.xml`, and the class-level
   `Q_CLASSINFO("D-Bus Interface", ...)` declarations).
8. Absence searches (all returned empty unless stated): `preselect` anywhere in
   `src/`; `tile` in `src/effect/effect.h`, `src/effect/effectwindow.h`,
   `src/effect/effecthandler.h`; tile/rootTile/tiling references in
   `src/scripting/documentation-global.xml` and
   `src/scripting/documentation-effect-global.xml`; any `qmldir`/QML module
   files for `org.kde.kwin` in the repository; tile in any `*.xml` D-Bus
   introspection file.

## Q_INVOKABLE Reachability Rule

A `Q_INVOKABLE` method is treated as scripting/QML-supported only when its
containing object is demonstrably reachable from the relevant binding. This
rule is applied per method below. Where an object is reachable but the method
is undocumented or the reachability depends on non-public registration, the
surface is classified `version-coupled only`.

## Capability Verdict Map

Verdict scale: `supported` (documented supported scripting/QML path);
`version-coupled only` (reachable in source but undocumented, deprecated, or
not part of a stable public surface); `absent` (no surface at all);
`runtime-validation required` (surface exists but lifecycle/event-ordering or
behavior must be proven live; unit-04 is the authorized place for that proof).

### 1. Obtain the correct Custom Tile root/manager by workspace and output, including virtual-desktop scope

- Scripting/QML surface (supported): the QML `Workspace` singleton
  (`\qmlsingletontype Workspace`, `\inqmlmodule org.kde.kwin`, registered at
  `src/scripting/scripting.cpp:706-708`) exposes `rootTile(LogicalOutput,
  VirtualDesktop)` as a documented `\qmlmethod`
  (`src/scripting/workspace_wrapper.h:396-401`, implementation
  `src/scripting/workspace_wrapper.cpp:495-498`), plus `screens`
  (`src/scripting/workspace_wrapper.h:99-101`, impl
  `src/scripting/workspace_wrapper.cpp:441-444`) and
  `currentDesktopForScreen(output)` (`src/scripting/workspace_wrapper.h:363-368`,
  impl `src/scripting/workspace_wrapper.cpp:88-95`). The plain-JS `workspace`
  global is the same wrapper class (`QtScriptWorkspaceWrapper`,
  `src/scripting/scripting.cpp:229-232`), so `workspace.rootTile(...)` is
  reachable from ordinary KWin `.js` scripts too. The shipped tiles editor
  demonstrates the exact call
  (`src/plugins/tileseditor/qml/Main.qml:42`).
- Virtual-desktop scope: `TileManager` keeps one `RootTile` per desktop
  (`src/tiles/tilemanager.cpp:78-80`) and one `QuickRootTile` per desktop
  (`src/tiles/tilemanager.cpp:69`); `rootTile(desktop)` selects by desktop
  (`src/tiles/tilemanager.h:51-54`).
- TileManager object (as opposed to root): reachable only through the
  deprecated `tilingForScreen(output)` / `tilingForScreen(name)`
  (`src/scripting/workspace_wrapper.h:383-394`, impl
  `src/scripting/workspace_wrapper.cpp:473-493`, both emit a deprecation
  warning). `Tile::manager()` exists but is not `Q_INVOKABLE`
  (`src/tiles/tile.h:138`).
- Public C++ plugin/effect surface: none for the tile object graph; see the
  header-install finding under Capability 10.
- Private/internal path: `Workspace::tileManager(output)` /
  `Workspace::rootTile(output, desktop)` (`src/workspace.h:220,225-230`);
  `TileManager` construction per output at `src/workspace.cpp:1430`.
- Lifecycle/event-ordering uncertainty: `TileManager` is created for every
  logical output at output-add time; root tiles are created per desktop on
  `desktopAdded` (`src/tiles/tilemanager.cpp:82`). A script must not cache
  these objects across output reconnect.
- Verdict: **supported** (documented QML method, in-process, shipped-component
  demonstrated). TileManager-by-name remains version-coupled through the
  deprecated route.

### 2. Enumerate leaves and read stable geometry/identity/parent-child structure

- Scripting/QML surface (version-coupled): `Tile` exposes `relativeGeometry`,
  `absoluteGeometry`, `absoluteGeometryInScreen`, `minimumSize`, `padding`,
  `positionInLayout`, `parent`, `tiles`, `windows`, `isLayout`,
  `canBeRemoved` (`src/tiles/tile.h:30-40`), `childTiles`/`childTile(row)`/
  `row()`/`parentTile()` (`src/tiles/tile.h:111-137`), and signals
  `childTilesChanged`, `windowAdded`, `windowRemoved`, `windowsChanged`,
  `rowChanged`, `isLayoutChanged` (`src/tiles/tile.h:151-163`). `RootTile.model`
  returns the `TileModel` `QAbstractItemModel` (`src/tiles/customtile.h:64`;
  `src/scripting/tilemodel.h:33-65`), usable in QML with a descendant proxy
  (`src/plugins/tileseditor/qml/Main.qml:123-124`).
- Identity: there is no stable persistent identifier. Tile identity is the
  QObject pointer plus parent/row structure. Trees are rebuilt per
  (output, desktop) and rebuilt again from configuration on output reconnect
  (Capability 4/9), so pointer identity is session-only. `output.name`
  (`src/core/output.h:233`) is the stable output key exposed to bindings;
  `output.uuid()` is a plain non-invokable method (`src/core/output.h:329`).
  `VirtualDesktop.id` is a `Q_PROPERTY` (`src/virtualdesktops.h:50`).
- Public C++ effect surface: none (no tile symbols in effect headers).
- Verdict: **version-coupled only** (reachable and demonstrated by the shipped
  editor, but undocumented; no stable identity).

### 3. Split an arbitrary leaf horizontally/vertically and choose the split ratio

- Scripting/QML surface (version-coupled): `CustomTile::split(LayoutDirection)`
  is `Q_INVOKABLE` (`src/tiles/customtile.h:42`, implementation
  `src/tiles/customtile.cpp:193-257`), reachable on any tile obtained from the
  root (`Capability 1`). Ratio is chosen by writing `tile.relativeGeometry`
  (`WRITE` on `src/tiles/tile.h:30`), demonstrated in the shipped editor
  (`src/plugins/tileseditor/qml/Main.qml:236,249-251,263`; split buttons
  `src/plugins/tileseditor/qml/TileDelegate.qml:169-185`). Direction enum is
  reachable as `KWinComponents.Tile.Horizontal/Vertical/Floating`
  (`Q_ENUM(LayoutDirection)` at `src/tiles/tile.h:43-48`; uncreatable type
  registration `src/scripting/scripting.cpp:718-719`).
- Constraints: `CustomTile::setRelativeGeometry` adjusts adjacent siblings and
  enforces `minimumSize` (`src/tiles/customtile.cpp:53-182`; default minimum
  `QSizeF(0.15, 0.15)` at `src/tiles/tile.h:179`), so the chosen ratio is
  honored only within those constraints. `split()` itself re-flows geometry
  (half-width/height defaults) and creates either a sibling or nested children
  depending on parent direction (`src/tiles/customtile.cpp:199-253`).
- Public C++ effect surface: none (tiles not exposed in effect headers).
- Verdict: **version-coupled only**.

### 4. Persist and restore authored topology without private direct file manipulation

- Scripting/QML surface: no explicit save/load API is exposed to bindings.
  Persistence is automatic and internal: a single-shot 2000 ms timer is started
  on `RootTile::layoutModified`/`paddingChanged`
  (`src/tiles/tilemanager.cpp:61-64,72-73`) and serializes the tree to kwinrc
  group `Tiling`, subgrouped by desktop id then output uuid
  (`src/tiles/tilemanager.cpp:390-405`). Restore happens when the manager is
  (re)created for an output (`src/tiles/tilemanager.cpp:288-340`), including a
  legacy output-UUID fallback (`src/tiles/tilemanager.cpp:277-286,314`) and a
  default 3-column setup when nothing is stored
  (`src/tiles/tilemanager.cpp:300-309`).
- Coverage caveat: `layoutModified` is emitted from `setRelativeGeometry`
  through the parent (`src/tiles/customtile.cpp:178-180`) and propagated via
  `createChildAt` (`src/tiles/customtile.cpp:43`), but a pure
  `setLayoutDirection` emits only `layoutDirectionChanged`
  (`src/tiles/customtile.cpp:416-424`). Whether every authored mutation reliably
  reaches the root save timer is not guaranteed by an API contract.
- No save-complete signal and no flush call is exposed to bindings, so the
  product cannot confirm persistence from scripting.
- Window-to-tile associations are NOT serialized: `tileToJSon` writes only
  geometry/direction (`src/tiles/tilemanager.cpp:342-388`), and quick-tile mode
  restore explicitly drops `Custom` on output unplug
  (`src/placementtracker.cpp:97-99`).
- Verdict: **runtime-validation required** (the topology-persistence surface is
  automatic and version-coupled; save timing, coverage, and no-ack behavior
  need live proof).

### 5. Register keyboard preselection and consume it on the next eligible `windowAdded` placement

- Scripting/QML surface (composable, no dedicated API): a tree-wide search for
  any "preselect" mechanism returned nothing. The product must compose three
  supported primitives: `registerShortcut(name, text, sequence, callback)`
  (`src/scripting/scripting.h:127`, impl `src/scripting/scripting.cpp:376-395`),
  the `workspace.windowAdded` signal
  (`src/scripting/workspace_wrapper.h:156-158`, forwarded from
  `Workspace::windowAdded` at `src/scripting/workspace_wrapper.cpp:39`), and
  `tile.manage(window)` (`src/tiles/tile.h:127`, impl
  `src/tiles/tile.cpp:377-425`).
- Ordering: `windowAdded` is emitted after automatic placement. For Wayland:
  placement at `src/workspace.cpp:920-925`, emit at `src/workspace.cpp:954`.
  For X11: placement inside `X11Window::manage` (`src/x11window.cpp:569-570`),
  emit after `addX11Window` (`src/workspace.cpp:829`). `manage()` therefore
  repositions an already-placed window via `requestTile`
  (`src/tiles/tile.cpp:418-422`, `src/window.cpp:3750-3790`), and the tile is
  committed through the Wayland configure ack
  (`src/xdgshellwindow.cpp:851-855`) or immediately on X11
  (`src/x11window.cpp:1861-1864`).
- Eligibility checks available to the handler: `managed`
  (`src/window.h:284`), `resizeable` (`src/window.h:546`), `popupWindow`
  (`src/window.h:301`), `normalWindow` (`src/window.h:201`).
- Verdict: **runtime-validation required** (composition is feasible via
  supported primitives, but there is no dedicated preselection surface and the
  post-placement override ordering/flicker behavior must be proven live).

### 6. Observe interactive move/resize start, step, and finish; obtain pointer/drop position; hit-test the target leaf; detect cancellation or reversal

- Scripting/QML surface (runtime): `Window` emits
  `interactiveMoveResizeStarted`, `interactiveMoveResizeStepped(geometry)`,
  `interactiveMoveResizeFinished` (`src/window.h:1512-1514`; emissions at
  `src/window.cpp:1062`, `src/window.cpp:1205,1236`, `src/window.cpp:1110`).
  Window objects are reachable from `workspace.windowAdded`,
  `workspace.activeWindow`, `workspace.stackingOrder`
  (`src/scripting/workspace_wrapper.h:142,156-168`), or the `window` role of
  `WindowModel` (`src/scripting/windowmodel.h:44-49`). Pointer/drop position:
  `workspace.cursorPos` (`src/scripting/workspace_wrapper.h:149`, impl
  `src/scripting/workspace_wrapper.cpp:148-151`). Hit-test: `RootTile::pick(x,
  y)`/`pick(QPointF)` (`src/tiles/customtile.h:73-74`, impl
  `src/tiles/customtile.cpp:460-488`, nearest non-layout tile with strong
  containment preference) or `TileManager::bestTileForPosition(x, y)`
  (`src/tiles/tilemanager.h:50`, impl `src/tiles/tilemanager.cpp:113-116`).
- Public C++ effect surface (different, documented): `EffectWindow` emits
  `windowStartUserMovedResized`, `windowStepUserMovedResized(w, geometry)`,
  `windowFinishUserMovedResized(w)` (`src/effect/effectwindow.h:687,703,710`);
  pointer via `EffectsHandler::mouseChanged(pos, oldpos)`
  (`src/effect/effecthandler.h:914`). Note effects operate on `EffectWindow`,
  not `KWin::Window`, and the effect headers expose no tile API; the effect
  route can hit-test only by re-deriving geometry itself.
- Cancellation/reversal: `finishInteractiveMoveResize(cancel)` restores the
  initial geometry and quick-tile state on cancel
  (`src/window.cpp:1069-1111`, cancel branch `src/window.cpp:1077-1085`) but
  `interactiveMoveResizeFinished` carries no cancel flag
  (`src/window.cpp:1110`); `windowFinishUserMovedResized` likewise
  (`src/effect/effectwindow.h:710`). Reversal can only be inferred indirectly
  (geometry returned to start, requested-tile state restored).
- Preemption: KWin's own Shift-drag custom-tile assignment
  (`src/window.cpp:1103-1105`) and screen-edge quick-tile handling
  (`src/window.cpp:1096-1102`) run inside the same finish path and may already
  have assigned or de-assigned the window before the product reacts.
- Verdict: **runtime-validation required** (start/step/finish, pointer, and
  hit-test are reachable; cancellation/reversal detection is indirect and
  unproven, and built-in assignment paths can preempt).

### 7. Assign a window to a selected tile without fighting automatic placement, and distinguish Custom Tile association from raw geometry writes

- Scripting/QML surface (version-coupled): the supported assignment primitive
  is `tile.manage(window)` / `tile.unmanage(window)`
  (`src/tiles/tile.h:127-128`). `manage` checks `isResizable()`/`isAppletPopup`
  and desktop membership (`src/tiles/tile.cpp:379-391`), evacuates any prior
  association across all outputs (`src/tiles/tile.cpp:395-412`), and calls
  `window->requestTile(this)` when active (`src/tiles/tile.cpp:418-422`).
- Distinguishing association from geometry writes: writing `window.frameGeometry`
  (`Q_PROPERTY ... WRITE moveResize`, `src/window.h:479`) repositions without
  creating a tile association. The association is read via `window.tile`
  (`READ requestedTile`, `src/window.h:595`); note this is the requested, not
  the client-acknowledged, tile (`m_requestedTile` vs `m_tile`,
  `src/window.cpp:3723-3790`). Custom-vs-quick is read from
  `requestedTile()->quickTileMode()` / `QuickTileFlag::Custom`
  (`src/window.cpp:3705-3721`, mode set in `CustomTile` constructor
  `src/tiles/customtile.cpp:33-38`). `Tile::quickTileMode()` is a plain method,
  reachable only through the tile object (`src/tiles/tile.h:103-104`).
- Deprecated path: `window.tile = t` writes through `setTileCompatibility`,
  which logs a deprecation warning (`src/window.cpp:3803-3819`).
- Window-side `requestTile`/`forgetTile`/`commitTile` are plain methods, not
  `Q_INVOKABLE` (`src/window.h:1154-1157`), so assignment must go through
  `tile.manage`/`unmanage`.
- Automatic-placement fight: placement completes before `windowAdded` (see
  Capability 5); `manage` overrides it by repositioning. KWin's built-in move
  finish logic may assign or de-assign first (Capability 6).
- Verdict: **version-coupled only** (tile.manage is reachable and used in-tree;
  the window-side write path is deprecated; post-placement fighting is a
  runtime concern).

### 8. Preserve authored branches during automatic placement, and define close/removal/empty-leaf behavior

- Scripting/QML surface (version-coupled): automatic placement never mutates
  tile trees: `Placement::place` computes a geometry only
  (`src/placement.cpp:34-58` and whole-file scan found no tile writes).
  Desktop change re-requestTile preserves the association
  (`src/workspace.cpp:1101-1114`). Output removal evacuates windows from the
  custom tree and deletes the manager, with the tree restored from config on
  reconnect (`src/workspace.cpp:1437-1452`; `src/tiles/tilemanager.cpp:288-340`).
- Close/removal/empty-leaf: window close is connected to `Tile::unmanage`
  (`src/tiles/tile.cpp:34`, impl `src/tiles/tile.cpp:427-437`); a removed tile
  re-flows siblings, evacuates windows to the nearest tile, and promotes a
  single-child non-root layout back to a leaf
  (`CustomTile::remove`, `src/tiles/customtile.cpp:273-343`, promotion at
  `src/tiles/customtile.cpp:326-332`). `canBeRemoved` is false for the root and
  true otherwise (`src/tiles/tile.h:40`, impl `src/tiles/tile.cpp:223-227`).
  KWin retains empty leaves; there is no automatic empty-collapse, so
  empty-branch retention/collapse semantics are the product's to define on top
  of these primitives.
- Verdict: **version-coupled only** (structural preservation is inherent, not
  controllable; removal/evacuation behavior is demonstrated in-tree; empty-leaf
  semantics are product-defined).

### 9. Move/rebind structural state across workspaces and outputs; identify output removal/reconnect hooks

- Scripting/QML surface (version-coupled): trees are scoped per (desktop,
  output): `TileManager` per output (`src/workspace.cpp:1430`), `m_rootTiles`
  per desktop (`src/tiles/tilemanager.cpp:78-80`). Cross-desktop rebinding is
  built in: on desktop change each window is re-`requestTile`d to its tile on
  the new desktop (`src/workspace.cpp:1101-1114`). Cross-output: moving a
  custom-tiled window forgets its custom association
  (`src/window.cpp:3896-3897`); quick tiles rebind to the target output
  (`src/window.cpp:3898-3903`); custom associations are not restored after
  output unplug (`src/placementtracker.cpp:97-99`).
- Output removal/reconnect hooks: `Workspace::outputRemoved`/`outputAdded`
  (`src/workspace.cpp:1439,1431`) surface to QML/JS as
  `screensChanged`/`screenOrderChanged`
  (`src/scripting/workspace_wrapper.h:192,199`,
  `src/scripting/workspace_wrapper.cpp:59-60`). Reconnect recreates the manager
  and reloads the persisted tree, including the legacy UUID fallback
  (`src/workspace.cpp:1430`; `src/tiles/tilemanager.cpp:288-340,314`).
- Verdict: **version-coupled only** (hooks exist; cross-desktop rebind is
  built-in; cross-output custom rebind is absent and must be re-applied by the
  product; reconnect topology persistence exists).

### 10. Expose read-only structural/current-window state to a separately packaged Plasma panel indicator through a supported interface

- Scoped search result (recorded, empty unless noted):
  - No D-Bus interface exposes tiles. `registerObject` sites in `src/`:
    `/FTrace`, keyboard-layout, `/KWin` (`org.kde.KWin`,
    `src/dbusinterface.h:39-100`), `/Compositor`
    (`org.kde.kwin.Compositing`, `src/dbusinterface.h:105`),
    `/VirtualDesktopManager` (`org.kde.KWin.VirtualDesktopManager`,
    `src/dbusinterface.h:182-249`), `/Plugins` (`org.kde.KWin.Plugins`,
    `src/dbusinterface.h:254-271`), `/Session`, a11y, tablet-mode
    `/org/kde/KWin`, `/VirtualKeyboard`, `/Scripting`
    (`org.kde.kwin.Scripting`, `src/scripting/scripting.h:317`,
    `src/scripting/scripting.cpp:682`), `/Scripting/Script<id>`
    (`org.kde.kwin.Script`: `stop`/`run` only, `src/scripting/org.kde.kwin.Script.xml:4-9`,
    `src/scripting/scripting.cpp:111-112`), `/Effects`
    (`org.kde.kwin.Effects`, effect management only,
    `src/effect/effecthandler.cpp:138`, `src/org.kde.kwin.Effects.xml`).
    A `tile` search across all `*.xml` files returned nothing.
  - The `org.kde.kwin` QML module is registered only inside the KWin process
    (`src/scripting/scripting.cpp:693-719`); no `qmldir`/QML module files for
    `org.kde.kwin` exist in the repository, so a plasmashell-hosted plasmoid
    cannot import it. The only kwin-installed QML module is the internal
    `org.kde.kwin.private.effects`
    (`src/plugins/private/CMakeLists.txt`, types in `src/plugins/private/plugin.cpp`).
  - The `org.kde.plasma.window_management` Wayland protocol implemented by KWin
    (`src/wayland/plasmawindowmanagement.h`) exposes no tile data.
  - `org.kde.KWin.getWindowInfo(uuid)` / `queryWindowInfo()`
    (`src/dbusinterface.h:78-87`) return window geometry/state only, not tile
    membership.
- Verdict: **absent** as a supported interface for a separate process.
- Bounded routes for a separate indicator:
  1. In-process KWin script (QML/JS) pushes state over D-Bus to a service the
     indicator reads; the script's tile reads are version-coupled (this
     matrix), and the transport is `callDBus`
     (`src/scripting/scripting.cpp:301-374`) or a script-hosted service only if
     provided natively.
  2. Version-coupled native bridge: a kwin-side plugin/effect registering a
     custom D-Bus object. This requires the private tile headers, which are NOT
     installed: `src/tiles/*.h` do not appear in any install block
     (`src/CMakeLists.txt:478-552` and the `core/`/`effect/`/`scene/` blocks),
     and the installed `src/workspace.h` and `src/window.h` forward-declare
     `TileManager`/`RootTile` (`src/workspace.h:88-89`) and `Tile`
     (`src/window.h:57`) only, so out-of-tree code gets incomplete types.
     Building the bridge therefore means compiling against the pinned KWin
     source tree.
  - Per the fail-fast rule in the brief, this is a bounded native/private route;
    the boundary is explicit (kwin-internal state, no supported interface), so
    unit-02 may proceed, and no scripting/QML-only proof is claimed for this
    capability.

## Aggregate Fail-Fast Result

- Every one of the 10 mandatory capabilities has at least one bounded route
  (supported scripting/QML or version-coupled native/private). No mandatory
  capability is `absent` with no route:
  - Supported scripting/QML, documented: Capability 1 (root/manager lookup).
  - Reachable via in-process `org.kde.kwin` QML/JS, version-coupled,
    demonstrated by the shipped tiles editor: Capabilities 2, 3, 7, 8, 9.
  - Runtime-validation required (surface exists; ordering/behavior unproven):
    Capabilities 4, 5, 6.
  - Absent as a supported separate-process interface but with a bounded
    version-coupled native/private route: Capability 10.
- The decisive blocker test is negative: no mandatory capability lacks both a
  scripting/QML route and a viable native/private route. Therefore units 02-05
  are NOT parked.
- Recommendation to unit-02: treat the composition boundary as the in-process
  `org.kde.kwin` QML/JS module (version-coupled) for Capabilities 2-9, the
  documented Workspace root lookup for Capability 1, and a custom
  D-Bus-bridge/script-push composition for Capability 10. Do not claim a
  scripting-only proof; the feasible classification is version-coupled native
  feasible with explicit boundaries.

## Residual Uncertainties (source-level, by design)

- Event ordering: `windowAdded` relative to placement is source-derived
  (`src/workspace.cpp:920-925,954`; `src/x11window.cpp:569-570,829`) but not
  runtime-verified; Wayland tile commit rides the xdg configure ack
  (`src/xdgshellwindow.cpp:851-855`).
- Persistence coverage: whether every authored mutation reaches the 2 s save
  timer is not an API guarantee; `setLayoutDirection` alone emits only
  `layoutDirectionChanged` (`src/tiles/customtile.cpp:416-424`).
- Configuration round-trip fidelity (`tileToJSon`/`parseTilingJSon`) for
  single-child arrays, floating geometry, and minimum-size edge cases is not
  exercised.
- Binding nuances (QJSEngine vs QQmlEngine signal connection, enum/Rect
  conversion for `LayoutDirection` and geometry arguments) are backed by
  converters (`src/scripting/scripting.cpp:636-677`) but not runtime-proven.
- Cross-output rebind of custom associations is absent by design
  (`src/window.cpp:3896-3897`, `src/placementtracker.cpp:97-99`); the product
  must re-apply assignment, which is unproven timing-wise.
- Cancellation/reversal detection is indirect (no cancel flag on either
  scripting or effect finish signals).
- Sparse-checkout evidence method (pinned `git show`/`git grep`) is exact at
  the pinned commit; line numbers were derived from pinned blobs and are
  reproducible.

## Blockers

- No source blocker prevents completion of the matrix.
- Live validation of the four `runtime-validation required` capabilities
  (4, 5, 6) and of Capability 10's bridge latency/ordering is deferred to the
  authorized unit-04 proof; it must not run before fresh user authorization
  per `spec.md` and `plan.md`.
