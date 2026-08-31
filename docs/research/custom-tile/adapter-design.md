# Adapter Design Checkpoint: KWin 6.7.3

Date: 2026-08-10. Source pin: KWin `v6.7.3`, commit
`45ec9a6d0ed312a803ff5658a2a3e61f221566c6`.

## Decision

Do not begin production adapter edits. The required objects and mutation
operations are source-reachable, but two core journeys cannot yet be made safe
from source alone: JavaScript collection marshalling for tile/window lists and
the readiness ordering of `workspace.windowAdded`. An authorized, minimal
runtime smoke must establish them before any call to `split()` can mutate a
real topology. This does not authorize that smoke.

## Production Package

`src/scripting/scripting.cpp`, `Scripting::queryScriptsToLoad()`, loads a
`KWin/Script` package whose metadata has `X-Plasma-API=javascript` from either
`kwin-wayland/scripts/<plugin-id>/contents/code/main.js` or
`kwin/scripts/<plugin-id>/contents/code/main.js`. It selects the plugin ID from
KPackage metadata. `Script::slotScriptLoadedFromFile()` evaluates that one
plain JavaScript file in a `QJSEngine`; it is not an ES module. Therefore the
production output must be a package `metadata.json` plus one generated IIFE at
`contents/code/main.js`. The current `kwin/dist/main.js` is build staging, not
the runtime package path. KWin source establishes the metadata API key and
payload path, but not the complete external KPackage metadata schema.

## Source Matrix

| Surface | Source-established reachability and semantics | Status |
| --- | --- | --- |
| Script globals | `scripting.cpp`, `Script::slotScriptLoadedFromFile()`, injects `workspace` as `QtScriptWorkspaceWrapper` and the global `registerShortcut`; `scripting.h`, `Script::registerShortcut`, returns `bool`. | Feasible |
| Current scope and clearing | `workspace_wrapper.h` exposes `activeWindow`, `screens`, `cursorPos`, `currentDesktop`, `currentDesktopForScreen(output)`, `rootTile(output, desktop)`, `windowAdded`, `windowRemoved`, `screensChanged`, and `currentDesktopChanged(previous, current, output)`. `workspace_wrapper.cpp` forwards output-list and per-output desktop changes. Scope can use exact output object identity plus desktop ID and clear on either signal, on window removal, or when the recorded window leaves scope. | Feasible |
| Eligibility | `window.h` exposes `normalWindow`, `managed`, `output`, `desktops`, `resizeable`, and `appletPopup`. `tile.cpp`, `Tile::manage`, rejects non-resizable or applet-popup windows and windows outside the tile desktop. Adapter eligibility must include all of these source conditions, then require each `manage()` result. | Feasible; declaration additions required |
| Focus and roots | `workspace_wrapper.h`, `rootTile`, is `Q_INVOKABLE`; `customtile.h` makes `RootTile` a `CustomTile`; `tile.h` exposes `tiles`, `windows`, `parent`, `absoluteGeometry`, and `isLayout` as QML properties. A focused leaf is `workspace.activeWindow.tile` after runtime guards. Recursion over `root.tiles`, not `root.model`, is the only source-supported design. `RootTile.model` is an opaque `QAbstractItemModel`; source does not establish JavaScript iteration or roles for it. | Runtime-smoke required for list marshalling; do not iterate `model` |
| Hit testing | `workspace_wrapper.h` / `workspace_wrapper.cpp` expose `cursorPos`; `RootTile::pick` is Q_INVOKABLE, but `customtile.cpp`, `RootTile::pick`, selects nearest non-layout tile even outside its geometry. The adapter must still validate half-open containment and use `logic.ts` for direction. | Feasible |
| Split and child order | `customtile.h` exposes Q_INVOKABLE `split(LayoutDirection)` returning `QList<CustomTile *>`. `customtile.cpp`, `CustomTile::split`, uses `Horizontal` for left/right and returns left then right; `Vertical` for top/bottom and returns top then bottom. In both sibling and child-layout branches the returned ordering has that physical meaning. | Feasible in C++; JavaScript list result requires smoke |
| Occupied split behavior | `tile.cpp`, `Tile::insertChild`, evacuates an existing leaf window when that leaf first becomes a layout, then repicks and manages it. The sibling branch leaves the existing target on the original leaf. This automatic result is branch-dependent. The adapter must explicitly `manage(targetWindow)` into the opposite returned leaf, then `manage(draggedWindow)` into the selected leaf, checking both `true` results. | Feasible |
| Manage and unmanage | `tile.cpp`, `Tile::manage`, returns `false` for the source eligibility failures, otherwise evacuates the window from every root tile before adding it and requests this tile when active. `unmanage` returns `false` when absent and otherwise removes the request. Successful drag therefore leaves the origin as an empty retained leaf without a collapse call. | Feasible |
| Interactive drag and Esc | `window.h` exposes started, stepped, and finished signals, plus readable/writable `frameGeometry`. `window.cpp`, `Window::finishInteractiveMoveResize(bool cancel)`, restores initial geometry before emitting parameterless `interactiveMoveResizeFinished()` when `cancel` is true. The script signal does not expose `cancel`; `workspace.cursorPos` can provide finish-time pointer position. Safe fallback is to retain the origin record, restore only with `origin.manage(window)`, never write frame geometry broadly, and clear without target mutation when geometry equals the captured origin or any guard fails. | Esc cause itself is runtime-unknown; source proves restored-geometry ordering |
| Ordinary placement | `workspace_wrapper.cpp` forwards `Workspace::windowAdded`, but the inspected scripting wrapper source does not establish whether output, desktop, and tile state are ready when JavaScript receives it. `Tile::manage` is the correct assignment-only operation for an already retained empty leaf. | Runtime-smoke required |

## Minimal State Machine

1. On startup, register the keyboard shortcut only if `registerShortcut` returns
   `true`; attach workspace scope-clearing handlers. Enumerate existing windows
   only after the list-marshalling smoke passes, then attach each window's
   interactive handlers.
2. On keyboard arm, capture the guarded active occupied leaf and scope. On the
   next eligible, scope-valid `windowAdded`, use the right-only plan, split
   horizontally, verify the two leaves, explicitly manage focused to left and
   incoming to right, then clear state.
3. On interactive start, capture the window, exact origin tile object, scope,
   and frame geometry. On finish, revalidate scope, origin parent chain, and
   eligibility before reading the guarded cursor position and target leaf.
4. If finish geometry equals the captured geometry, the pointer is outside, the
   target is the origin or empty, the center region applies, or any guard fails:
   call only `origin.manage(window)` when still valid, check its result, clear
   state, and do not mutate the target.
5. For a directional drag, split the target only after all prior guards pass;
   map left/right to `Horizontal` and up/down to `Vertical`; explicitly manage
   the target and dragged windows into the source-ordered opposite/selected
   children. On any false result, clear state and do not attempt broad geometry
   restoration.
6. On unarmed eligible `windowAdded`, traverse current leaves, choose the
   deterministic retained empty leaf from `logic.ts`, and call only
   `leaf.manage(window)`. Clear pending state on `screensChanged`,
   `currentDesktopChanged`, `windowRemoved`, and all terminal paths; disconnect
   stored per-window handlers when their window record clears.

## Declaration Corrections Needed

- Add `Workspace.cursorPos`, `currentDesktopForScreen(output)`,
  `screensChanged`, and the three-argument `currentDesktopChanged` signal.
- Add `Window.resizeable` and `Window.appletPopup`; document that
  `outputChanged` supplies the old output and re-read `window.output`.
- Add the JavaScript-only `QtScriptWorkspaceWrapper.windowList()` only if the
  smoke proves its list representation. Do not add model iteration APIs.
- Keep `frameGeometry` read-only in the adapter declaration unless a later
  approved requirement needs direct geometry writes; source-supported restore
  is `origin.manage(window)`, not broad `moveResize` use.

## Required Runtime Smoke

- Verify `workspace.rootTile(...).tiles`, `tile.windows`, `split()` results,
  and JavaScript-only `workspace.windowList()` are usable arrays or otherwise
  provide a documented, guardable iteration contract.
- Verify a `windowAdded` callback sees a valid output, applicable desktop, and
  a safely assignable retained empty leaf; record its ordering relative to
  ordinary KWin placement.
- Verify the finish callback observes restored frame geometry after Esc and
  distinguish whether geometry equality is reliable enough for the proposed
  safe no-mutation gate. Source provides no cancellation flag.
- Verify KPackage metadata accepted by the installed KWin while retaining the
  source-required `contents/code/main.js` payload layout.
