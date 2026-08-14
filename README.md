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

Shortcut registration is catalog-driven under the selected profile (default
`cosmic`; config key `shortcutProfile`). Every implemented catalog row registers
under a stable `plasma-auto-tiler-*` shortcut ID, so reload/restart re-registers
the same IDs and a user-customized KGlobalAccel sequence survives without being
silently overwritten. This is KWin-local registration: it never displaces or
reassigns a Plasma-global binding, and a row that collides with Plasma stays
shadowed until a separately gated installer/KCM migration exists. That migration
is not implemented here; it must assign a displaced Plasma action only to the
selected reference environment's documented equivalent (otherwise record it
unassigned), take an atomic snapshot with rollback, and require live evidence
before claiming activation. `Meta+0` (workspace-append) is deferred and never
registered in any profile; `Meta+Shift+0` (move-workspace-append) remains a
catalog row.

Some catalog rows are present only as truthful component requirements and are
never registered or sequence-resolvable in any profile: `fullscreen`
(Meta+F11 on `cosmic`, Meta+F on `bspwm`), `previous-workspace` /
`next-workspace`, and `group-toggle`. They need a KWin capability, an external
Plasma component, or a workspace-mode unit and are catalogued with the
`component-requirement` classification - they are not implemented and never
appear in the registered shortcut set below.

| Identifier | Shortcut |
|---|---|
| plasma-auto-tiler-insert-right | Meta+Alt+Right |
| plasma-auto-tiler-insert-left | Meta+Alt+Left |
| plasma-auto-tiler-insert-up | Meta+Alt+Up |
| plasma-auto-tiler-insert-down | Meta+Alt+Down |
| plasma-auto-tiler-focus-left | Meta+H |
| plasma-auto-tiler-focus-down | Meta+J |
| plasma-auto-tiler-focus-up | Meta+K |
| plasma-auto-tiler-focus-right | Meta+L |
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
| plasma-auto-tiler-workspace-append | unbound (deferred) |
| plasma-auto-tiler-move-workspace-1..9 | Meta+Shift+1..9 |
| plasma-auto-tiler-move-workspace-append | Meta+Shift+0 |

Sequences above are the `cosmic` profile default; `hyprland` and `bspwm`
select different catalog rows for shared actions (for example
`plasma-auto-tiler-float-toggle` is Meta+V on `hyprland` and Meta+S on
`bspwm`).

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

`Meta+1..9` focuses the existing 1-based workspace; `Meta+0` is unbound
(deferred); `Meta+Shift+1..9` moves the focused window to the existing
workspace and follows it; `Meta+Shift+0` appends a workspace, moves the focused
window, and follows it. Workspaces appended by the controller are
session-local script-owned desktops: on a session restart no desktop is treated
as owned and existing desktops are never removed. Cleanup only ever removes an
owned trailing empty desktop after the highest occupied workspace, keeping
exactly one trailing empty desktop, and never removes a non-owned, current, or
per-output-visible desktop.

The config key `workspaceMode` selects the multi-output workspace model
(default `per-output-local`; invalid values fall back to it with a diagnostic):

- `per-output-local` (default): each output owns an independent ordered set of
  logical workspaces, so `Meta+n` switches only the active output. With one
  output this is today's model. Each output's logical workspace 1 is a distinct
  desktop from every other output's, so N outputs x M workspaces appear as N*M
  desktops in Plasma's pager/overview.
- `global-unique`: desktops are global; each output shows an ordered assigned
  subset, and `Meta+n` selects the nth assigned desktop of the active output,
  moving a target shown elsewhere to that output.
- `shared`: one logical workspace set synchronized across every output;
  `Meta+n` switches all outputs to the same desktop.

Output identity is session-local: outputs are matched by their
manufacturer/model/serial/name tuple, so an identical-tuple output pair is
disambiguated by first-seen order (stable within a session, not across a
plug/replug reorder) and no per-output mapping survives a restart. This is a
documented limitation, not an error.

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
