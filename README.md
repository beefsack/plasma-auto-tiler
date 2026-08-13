# Plasma Auto Tiler

Guarded Custom Tile automation for KWin.

## Quickstart

Package and manage the `plasma-auto-tiler-kwin` KWin script from this
repository with `scripts/dogfood-install.sh`. There is no build step other than
what the script performs; `install` builds the bundle first.

### Prerequisites

Build prerequisite:

- `npm` - used by `install` to build the KWin bundle; provided by the devenv
  environment

Host Plasma runtime requirements (used at runtime against your running
session):

- `kwriteconfig6` - used by `enable` and `disable` to write the plugin setting
- `kreadconfig6` - used by `status` to read the plugin setting
- `qdbus` - used by `enable` and `disable` to ask the running KWin to
  reconfigure

`kwriteconfig6`, `kreadconfig6`, and `qdbus` are host Plasma runtime tools, not
devenv dependencies. The script detects each required tool at runtime per
command and fails with an error naming a missing tool and its `*_BIN` override
if it is missing or not executable.

### Install

Builds the bundle and copies the package into
`$XDG_DATA_HOME/kwin/scripts/plasma-auto-tiler-kwin/` (or
`$HOME/.local/share/kwin/scripts/plasma-auto-tiler-kwin/` when `XDG_DATA_HOME`
is unset), replacing any existing plugin directory. It does not enable the
plugin.

```sh
bash scripts/dogfood-install.sh install
```

### Enable

Writes `[Plugins] plasma-auto-tiler-kwinEnabled=true` through `kwriteconfig6`
and reconfigures the running KWin via `qdbus org.kde.KWin /KWin reconfigure`.

```sh
bash scripts/dogfood-install.sh enable
```

### Status

Read-only report of installed and enabled state. It never reconfigures KWin.

```sh
bash scripts/dogfood-install.sh status
```

### Shortcut catalog

The controller registers these 49 shortcuts (identifiers and sequences as
authored in `kwin/src/controller.ts`):

| Identifier | Shortcut |
|---|---|
| plasma-auto-tiler-insert-right | Meta+Alt+Right |
| plasma-auto-tiler-insert-left | Meta+Alt+Left |
| plasma-auto-tiler-insert-up | Meta+Alt+Up |
| plasma-auto-tiler-insert-down | Meta+Alt+Down |
| plasma-auto-tiler-focus-left | Meta+H |
| plasma-auto-tiler-focus-down | Meta+J |
| plasma-auto-tiler-focus-up | Meta+K |
| plasma-auto-tiler-focus-right | Meta+Alt+Ctrl+L |
| plasma-auto-tiler-focus-left-arrow | Meta+Left |
| plasma-auto-tiler-focus-down-arrow | Meta+Down |
| plasma-auto-tiler-focus-up-arrow | Meta+Up |
| plasma-auto-tiler-focus-right-arrow | Meta+Right |
| plasma-auto-tiler-move-left | Meta+Shift+H |
| plasma-auto-tiler-move-down | Meta+Shift+J |
| plasma-auto-tiler-move-up | Meta+Shift+K |
| plasma-auto-tiler-move-right | Meta+Shift+L |
| plasma-auto-tiler-move-left-arrow | Meta+Shift+Left |
| plasma-auto-tiler-move-down-arrow | Meta+Shift+Down |
| plasma-auto-tiler-move-up-arrow | Meta+Shift+Up |
| plasma-auto-tiler-move-right-arrow | Meta+Shift+Right |
| plasma-auto-tiler-detach | Meta+Shift+Space |
| plasma-auto-tiler-attach | Meta+Alt+Shift+Space |
| plasma-auto-tiler-float-toggle | Meta+G |
| plasma-auto-tiler-sticky-toggle | Meta+Shift+G |
| plasma-auto-tiler-fill-scope | Meta+Alt+Return |
| plasma-auto-tiler-apply-columns | Meta+Alt+1 |
| plasma-auto-tiler-apply-rows | Meta+Alt+2 |
| plasma-auto-tiler-apply-balanced-grid | Meta+Alt+3 |
| plasma-auto-tiler-apply-dwindle | Meta+Alt+4 |
| plasma-auto-tiler-workspace-1..9 | Meta+1..9 |
| plasma-auto-tiler-workspace-append | Meta+0 |
| plasma-auto-tiler-move-workspace-1..9 | Meta+Shift+1..9 |
| plasma-auto-tiler-move-workspace-append | Meta+Shift+0 |

### What this does to your session

Enabling grants the controller automatic session-local dwindle ownership of the
managed scope: on start it takes over the current scope and keeps it owned for
the session unless it becomes inert. This is proven by static tests and
nested-compositor probing only; live-host validation was not performed, so
treat live session behavior as unverified.

`Meta+G` floats the active window at a centered 60% x 60% of its current output
work area (remembered per window for the session) or tiles it back;
`Meta+Shift+G` pins a floating window across all workspaces (sticky implies
floating, and disabling sticky leaves it floating). Floating windows are
excluded from automatic placement, the tile-tree bijection, drag retiling, and
reconstruction, and their vacated tile leaf is retained rather than collapsed.
At startup, windows that are already on all desktops are treated as session-local
sticky floating windows; this heuristic cannot distinguish a user-pinned window
from an application-requested one, so it applies only within the session.

`Meta+1..9` focuses the existing 1-based workspace; `Meta+0` always appends a
new workspace and focuses it; `Meta+Shift+1..9` moves the focused window to the
existing workspace and follows it; `Meta+Shift+0` appends a workspace, moves the
focused window, and follows it. Workspaces appended by the controller are
session-local script-owned desktops: on a session restart no desktop is treated
as owned and existing desktops are never removed. Cleanup only ever removes an
owned trailing empty desktop after the highest occupied workspace, keeping
exactly one trailing empty desktop, and never removes a non-owned, current, or
per-output-visible desktop.

### Disable

Writes `[Plugins] plasma-auto-tiler-kwinEnabled=false` through `kwriteconfig6`
and reconfigures the running KWin. It does not remove the installed package.

```sh
bash scripts/dogfood-install.sh disable
```

### Uninstall

Removes only the installed `plasma-auto-tiler-kwin` directory; it never touches
KWin configuration.

```sh
bash scripts/dogfood-install.sh uninstall
```

## Scope of each command

- `install` and `uninstall` affect only the local package directory
  (`$XDG_DATA_HOME`/`$HOME/.local/share` under `kwin/scripts/`).
- `enable` and `disable` touch only the exact `[Plugins]
  plasma-auto-tiler-kwinEnabled` setting in `kwinrc` and request KWin
  reconfiguration; they never modify the installed package.
- `status` is read-only.
