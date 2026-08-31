# Current Decisions

Only active, user-approved product and project choices are recorded here.
Historical implementation detail is recoverable in Git history.

## Native Active Border

- Use an experimental, disabled-by-default, OpenGL-only native C++ KWin effect
  for the active-window border. Colour, width, outline radius, and gap are
  configurable; theme colour is preferred with a configured fallback.
- The outline never clips, reshapes, or changes window textures. Plasma 6.5+
  decoration-driven rounded corners remain the selected corner solution.
- C++ is limited to platform-required public-API adapters and effects. Manual
  ownership, threads, custom shaders or GL resources, QPainter, input,
  clipping, texture changes, and broader scene manipulation are excluded. The
  sole scene exception is one effect-owned automatic-lifetime
  `KWin::OutlinedBorderItem`.

## Settings And Distribution

- One native QWidget effect-scoped KCM owns tiling, workspace, shortcut,
  outline, and border settings through the Desktop Effects entry. Existing
  script groups, keys, values, and defaults remain unchanged. Native border
  settings hot-apply; script settings explain reload or session restart.
- The core distribution remains the script KPackage for KDE Store and an
  identical GitHub Release artifact. Platform-native packages for the native
  effect and KCM are permitted; their formats and publication are unselected.

## Live KWin/Plasma Boundary

- Reversible, project-owned, user-local dogfood operations are standing
  authorized. The user alone performs every logout, login, or new session
  boundary.
- This covers project builds; native-effect staging/removal; the project's
  `plasma-workspace/env` script and same-name legacy migration; KWin `/Effects`
  load/unload and read-only queries; KWin script install, enable, disable, and
  reconfigure; bounded `/Scripting` load/unload; project tray-helper lifecycle
  and session-D-Bus operations; and journal/status reads. Operations must be
  namespaced, fail closed, and have exact normal-path restoration.
- All other live mutation, including window journeys, Custom Tile structure,
  desktop creation/removal, shortcut reconciliation, production tray
  acceptance, and visual acceptance needs fresh, explicit, bounded user
  authorization. No broad cleanup, retry after failure, `sudo`, system path,
  Home Manager file, unrelated state, or session-boundary action is authorized.
- Deleting or restoring preserved candidates, containers, host artifacts, or
  ambiguous residue needs explicit user authorization plus exact path and
  identity or hash verification.

## Window And Workspace Behavior

- Pointer resize adjusts shared split boundaries or ratios and reflows
  neighbouring tiles.
- Floating is per-window, retains its tile leaf, and renders above tiled
  windows. `Meta+G` toggles it; `Meta+Shift+G` makes a floating window sticky.
- Maximize (`Meta+M`) is workspace-local. Fullscreen (`Meta+F11`) is separate:
  it is never tiled, resized, or reflowed, and preserves the tree for restore.
- `workspaceMode` supports `per-output-local`, `global-unique`, and `shared`.
  The active model maintains one structurally trailing empty workspace per
  relevant domain; `Meta+0` and `Meta+Shift+0` reuse it before creating one.

## Shortcuts

- The initial release supports standard US keyboards and preserves hardcoded
  shifted aliases. Layout detection, omission, opt-in configuration, migration,
  and KGlobalAccel reconciliation are deferred.
- Non-conflicting project shortcuts register by default. Conflicting
  Plasma-global shortcuts change only through explicit KCM Apply and Revert.
  Focus-right is `Meta+L`; the explicit override moves KDE lock to `Meta+Esc`.
  Recovery is explicit in the KCM, Revert restores only bindings still owned by
  that override, and unexpected conflicts are refused. Installation and startup
  never mutate global shortcuts.

## COSMIC Movement And Groups

- COSMIC directional movement replaces the legacy path; there is no legacy
  fallback. Production promotion and live acceptance remain gated by the active
  review findings.
- Grouped/tabbed windows remain deferred pending compositor-owned KWin support
  and a live multi-window Custom Tile stability proof. No group carrier,
  controls, bindings, or shared active-border behavior is selected.

## Tray

- Use a portable Rust StatusNotifierItem carrier with the KWin backend first;
  fail closed without a watcher. The bridge is whitelisted, outbound
  state-snapshot based, reconnecting, idempotent, and has no shell, input, or
  helper-to-KWin action route. The KCM remains the settings owner.
- The helper is not required for core tiler operation. Normal lifecycle
  rollback is exact and in-process; interrupted, crash, power-loss, malformed,
  replaced, or ambiguous state fails closed. Durable recovery and automatic
  post-crash retry are not selected.

## Deferred Scope

- Retain JavaScript for discrete window add/remove management. Portable
  cross-WM/OS engine research follows settlement of the COSMIC and pointer
  paths. Group behavior, inactive borders, Steam-specific handling, and
  complete keyboard-layout support remain deferred.
