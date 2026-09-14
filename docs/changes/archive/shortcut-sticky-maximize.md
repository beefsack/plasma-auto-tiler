# Shortcut, Sticky, And Maximize

## Outcome

- Registered `Meta+G`, `Meta+Shift+G`, and `Meta+M` project actions. No existing
  KGlobalAccel record is written, reassigned, or removed.
- Read-only enumeration found `kwin/Grid View` on `Meta+G`,
  `kwin/KrohnkiteMonocleLayout` on `Meta+M`, and no `Meta+Shift+G` holder.
  KGlobalAccel permits duplicate active records and dispatches the lower serial
  holder, so the two collisions are registered but shadowed until manual System
  Settings resolution. Startup records exact `shortcut-dispatch-shadowed` lines.
- Sticky follows COSMIC layer semantics within the selected float model: tiled
  first floats, then becomes all-desktops; sticky-off returns prior floating
  placement or fresh tiled admission. `onAllDesktops` writes are armed and
  consumed through one object-identity `desktopsChanged` fence only.
- `Meta+M` calls `setMaximize(true, true)` or `setMaximize(false, false)` and
  uses a separate object-identity `maximizedChanged` fence. Fullscreen refuses.
  Post-admission maximize is not an admission clear.

## Evidence

- KWin source: `src/window.h:346-354` exposes writable `onAllDesktops` and
  `desktopsChanged`; `src/window.h:520-525,1103-1107` exposes read-only
  `maximizeMode` and supported `setMaximize`.
- COSMIC source: `src/shell/mod.rs:4701-4782` maps tiled sticky windows through
  floating and restores their prior layer; `src/shell/mod.rs:4285-4299` toggles
  maximize and refuses fullscreen.
- KGlobalAccel source: `kglobalaccel.cpp:611-623` registers the action, while
  `globalshortcutsregistry.cpp:410-445,869-924` retains duplicate keys and
  dispatches the lowest serial shortcut.
- Static tests cover collision diagnostics, catalog delivery, fullscreen and
  maximize refusals, tiled sticky on/off fresh admission, fence consume, and
  no-echo no-retry behavior. Native writes remain live-unproven.
