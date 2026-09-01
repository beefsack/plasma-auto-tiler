# Plasma Auto Tiler

Guarded Custom Tile automation for KWin.

## Quickstart

Package and manage the `plasma-auto-tiler-kwin` KWin script from this
repository with `scripts/dogfood-install.sh`. There is no build step other than
what the script performs; `install` builds the bundle first. The same script
also builds, stages, and reloads the experimental native active-border
effect; see [Native effect (dogfood)](#native-effect-dogfood) below.

### Distribution archive

Create the reproducible KPackage release artifact and its checksum sidecar:

```sh
bash scripts/build-kpackage.sh
sha256sum -c dist/plasma-auto-tiler-kwin.kwinscript.sha256
```

The command writes `dist/plasma-auto-tiler-kwin.kwinscript` and
`dist/plasma-auto-tiler-kwin.kwinscript.sha256`; both are ignored. The current
archive is 69642 bytes with SHA-256
`99afa2657f6707c6e19399ff7fd6a7d872baf333a03e495cad471e53f616fd75` and
contains only `metadata.json`, `contents/code/main.js`,
`contents/config/main.xml`, and `contents/ui/config.ui`. Use
`--output-dir <dir>` to write elsewhere. The build validates only in disposable
temporary roots; it does not install, enable, configure, or reconfigure a live
KWin session.

### Live test

The primary repeated live path is `scripts/live-test.sh run`: one nonce-owned
run that performs a concise preflight (typecheck, build, tests, static scan;
one pass/fail line per step with each step's combined output retained in
`typecheck.txt`/`build.txt`/`tests.txt`/`static-scan.txt`), captures the exact
baseline, then establishes and tears down only the inert checkout provenance
carrier through `start-test.sh`. It does not load or run the controller or
follow KWin logs.

```sh
bash scripts/live-test.sh run                  # full preflight
bash scripts/live-test.sh run --quick          # skip the full test suite
bash scripts/live-test.sh run --verbose        # stream preflight step output
bash scripts/live-test.sh run --quick --verbose
```

Ctrl-C or SIGTERM stops only the exact carrier whose nonce-owned receipt was
retained by the run, prints final status/diagnostics/desktops, and verifies
exact project baseline restoration. The installed controller plugin state is
observed and verified, never disabled, enabled, or reconfigured. The checkout
carrier is bound operationally through its unguessable per-attempt plugin
identity, exact `Script<ID>`, receipt, diagnostic, and unchanged KWin identity;
this is not direct evaluated-memory source proof. Evidence is retained under
`${XDG_RUNTIME_DIR:-/tmp}/plasma-auto-tiler-live/<nonce>`. The carrier setup
output is retained at `provenance.txt`; if no exact script ID is returned,
cleanup refuses stale handle use. A `manifest.txt` retains the nonce, KWin PID,
journal cursor, mode, observed controller state, carrier identity and cleanup,
and exact baseline restoration result even when stdout is redirected away. The
run never mutates shortcut records (drift is reported, not auto-applied) and
never rolls back Custom Tile topology changes or persisted shortcuts made
during the session. No Custom Tile runtime acceptance or journey is performed
or claimed. Read
`docs/live-kwin-testing.md` before any live run; the low-level
`scripts/start-test.sh` commands remain the manual reference.

After static checks, the next gate is a successful bounded carrier
lifecycle setup/restore smoke. It establishes only operational binding, not
direct evaluated-memory source proof. A separately authorized Custom Tile
journey is a later gate and has not occurred.

### Prerequisites

Build prerequisite:

- `npm` - used by `install` to build the KWin bundle; provided by the devenv
  environment

Host Plasma runtime requirements (used at runtime against your running
session):

- `kwriteconfig6` - used by `enable` and `disable` to write the plugin setting
- `kreadconfig6` - used by `status` and `dry-run` to read the plugin setting
- `qdbus` - used by `enable` and `disable` to ask the running KWin to
  reconfigure

Other runtime tool requirements:

- `jq` - used by `dry-run` to validate the source package metadata

`kwriteconfig6`, `kreadconfig6`, and `qdbus` are host Plasma runtime tools, not
devenv dependencies. The script detects each required tool at runtime per
command and fails with an error naming a missing tool and its `*_BIN` override
if it is missing or not executable.

### One-command install

The primary path for a fresh checkout is `setup`, which composes exactly the
`install`, `enable`, `effect-install`, and `effect-reload` commands documented
individually below into one invocation; the granular commands remain
available below for finer control or diagnosis.

```sh
devenv shell --impure -- bash scripts/dogfood-install.sh setup
```

`setup` always runs `install` then `enable` first; a real failure in either
aborts the whole command with a non-zero exit, exactly as running that
command standalone would. It then attempts `effect-install` and
`effect-reload`. If a native build prerequisite (for example `cmake`) is
unavailable - for example when not run inside `devenv shell --impure` - it
skips the native-effect half, reports that plainly, and still completes
successfully (exit 0) with the KWin script installed and enabled. `setup`
always ends with a summary naming every stage's outcome and exactly what
remains manual.

One thing always remains manual, regardless of how many times `setup` is
run:

- The first time `effect-install` creates its
  `~/.config/plasma-workspace/env/` script, the native effect is staged but
  not yet loadable: log out and back in once (or start a new session), then
  run `setup` again (or just `effect-reload`) to load it for the first
  time.

After that one-time boundary, `effect-install` also writes a persistent
`[Plugins] plasma-auto-tiler-active-borderEnabled=true` key to `kwinrc` -
the same mechanism KWin already uses to auto-enable the KWin script - so the
effect should auto-load again at every later reboot or logout/login with no
manual step. This has been confirmed by an actual reboot on this host: after
a real session boundary, `effect-status` reported the effect discovered and
loaded with no manual `effect-reload`. `effect-reload` (or `setup`) remains
the manual step whenever you rebuild the effect from a code change within an
already-running session - a live in-session rebuild is never picked up
automatically. See [Native effect (dogfood)](#native-effect-dogfood) below
for the full mechanism.

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

### Reload

After rebuilding and installing a script code change, reload it without a
session boundary. This disables then re-enables the plugin, reconfiguring KWin
after each change so KWin replaces the in-memory script instance. It finishes
with the plugin enabled.

```sh
bash scripts/dogfood-install.sh reload
```

### Status

Read-only report of installed and enabled state. It never reconfigures KWin.

```sh
bash scripts/dogfood-install.sh status
```

### Dry-run

Read-only inspection before a mutating install. Reports whether the source
package metadata is valid (the `KPlugin.Id` in `kwin/metadata.json` is parsed
and must match `plasma-auto-tiler-kwin`), whether the built bundle and the
required KCM schema/UI (`kwin/contents/code/main.js`,
`kwin/contents/config/main.xml`, `kwin/contents/ui/config.ui`) are present,
the current destination install state, the enabled state through the same
`kreadconfig6` read path as `status`, and the actions `install` would take.

It never builds, copies, writes configuration, reconfigures KWin, or
reconciles shortcuts, and it fails closed with an actionable error when a
required read tool (`jq`, `kreadconfig6`) or required source data is
unavailable.

```sh
bash scripts/dogfood-install.sh dry-run
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
before claiming activation. `Meta+0` (workspace-append/focus) registers in every
profile as `plasma-auto-tiler-workspace-0` unless an exact in-profile conflict
exists; `Meta+Shift+0` (move-workspace-append) remains a
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
| plasma-auto-tiler-workspace-0 | Meta+0 |
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

`Meta+1..9` focuses the existing 1-based workspace; `Meta+0` focuses or creates
the trailing empty workspace (idempotent when already trailing empty, no hard
count bound); `Meta+Shift+1..9` moves the focused window to the existing
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

### Native effect (dogfood)

`scripts/dogfood-install.sh` also builds, stages, and reloads the
experimental, disabled-by-default native `plasma-auto-tiler-active-border`
effect on your real Plasma session. The KWin script commands above need no
session boundary; the native effect needs exactly one logout/login (or new
session), once, after the first `effect-install` creates its
`~/.config/plasma-workspace/env/` script. After that one boundary, every
later rebuild and `effect-reload` is live over D-Bus with no further
boundary.

**Two related but separate things are involved: the env-script delivery
mechanism above, and the effect's own enabled state.** The env-script
mechanism only ever needed the one boundary described above. The effect's
*enabled state* used to be fully manual: `kwin/native-effect/metadata.json`
sets `"EnabledByDefault": false`, so KWin never loads it on its own. As of
this repository, `effect-install` also writes `[Plugins]
plasma-auto-tiler-active-borderEnabled=true` to `kwinrc` - the same
`kwriteconfig6`-written `[Plugins]` mechanism the KWin script above already
uses to re-enable itself every session, and KWin's effect loader reads this
exact key the same way it reads the KWin script's. So once the effect has
been discovered (the one-time boundary above), it should also auto-load
again at every later reboot or logout/login with no manual `effect-reload`.
This is verified against KWin's own plugin-loader source, a documented
out-of-tree precedent, and an actual reboot on this host, which confirmed
discovery and load with no manual `effect-reload`; see
[Eyeball check](#eyeball-check) for the repeatable per-session check, and
fall back to `effect-reload`/`effect-status` if it ever does not hold.
`effect-reload` remains required, exactly as before, whenever you
rebuild the effect from a code change within an already-running session:
persistence only covers session starts, never a live in-session rebuild.
`effect-remove` removes the staged plugin, the env script, and (when
present) this `kwinrc` key, restoring the pre-install state exactly.

```sh
devenv shell --impure -- bash scripts/dogfood-install.sh effect-install
bash scripts/dogfood-install.sh effect-status
bash scripts/dogfood-install.sh effect-reload
bash scripts/dogfood-install.sh effect-remove
```

`effect-install` builds the plugin against the pinned KWin ABI (needs `devenv
shell --impure` for the pinned dev store paths) and stages it under
`$XDG_DATA_HOME/plasma-auto-tiler-native-effect/kwin/effects/plugins/` (or
the `$HOME/.local/share` equivalent), then writes a `QT_PLUGIN_PATH` export
to `$XDG_CONFIG_HOME/plasma-workspace/env/60-plasma-auto-tiler-native-effect.sh`
(sourced by `startplasma-wayland` at session start) so the staged directory
is discoverable, and finally writes `[Plugins]
plasma-auto-tiler-active-borderEnabled=true` to `kwinrc` so the effect
persists across future session starts once discovered; idempotent.
`effect-status` is a staged diagnostic: it reports staging, the env script,
session delivery (read directly from the running `kwin_wayland` process's
own environment), D-Bus discovery, and D-Bus loaded state, each as a clear
pass/fail with guidance, so one run after logging back in is conclusive;
read-only. `effect-reload` mutates the running KWin session via D-Bus: it
queries D-Bus for effect support and, once supported, unloads and reloads
the effect live; before the boundary it reports the pending requirement
plainly and exits non-zero rather than attempting a load. `effect-remove`
unstages the plugin, deletes the env script, removes the `kwinrc` key above
when present, and (migration cleanup) also deletes any legacy
`environment.d` entry this project wrote previously; idempotent.
`effect-install` and `effect-remove` write only that one `kwinrc` key and
never use D-Bus. See `docs/live-kwin-testing.md` for the full
session-boundary contract.

### Building without Nix/devenv

`scripts/dogfood-install.sh effect-install` normally runs inside `devenv
shell --impure` so `cmake` can find KWin's dev package via a pinned Nix
store path (`-DKWin_DIR=...`), matching the exact KWin build this repo's
`devenv.nix` targets. `kwin/native-effect/CMakeLists.txt` itself only needs
a plain `find_package(KWin REQUIRED)` - the pinned override is layered on
top by the install script and used only when that exact pinned path exists
on disk; on any other host `cmake` falls through to this plain
`find_package` resolution automatically, with no script change needed.

To build the native effect on a non-Nix host, install your distribution's
KWin development package first - typically `kwin` on Arch (headers and
CMake config ship in the main package), `kwin-devel` on Fedora, `kwin-dev`
on Debian/Ubuntu, or a Wayland-variant `kwin6-*-devel`-style package on
openSUSE (verify the exact package name and version for your distribution;
these are not directly verified against current distro package pages).
Then run `cmake` directly, with no `-DKWin_DIR` override:

```sh
cmake -S kwin/native-effect -B kwin/native-effect/build -DBUILD_TESTING=OFF
cmake --build kwin/native-effect/build
```

**KWin C++ effects have no upstream API/ABI compatibility guarantee** - this
is current KWin maintainer policy, not a historical artifact. A rebuild is
required after essentially every KWin/Plasma release, on every host, Nix or
not. No prebuilt binary of this effect is portable across distributions or
KWin versions; always rebuild against the KWin development headers actually
installed on the target host, and expect to rebuild again after your next
Plasma upgrade.

### Eyeball check

After dogfooding, confirm by eye:

- `bash scripts/dogfood-install.sh status` reports installed and enabled,
  and windows on your session actually tile.
- `bash scripts/dogfood-install.sh effect-status` reports the effect
  supported and loaded (after the one-time logout/login). After any later
  reboot or logout/login, the persisted `kwinrc` key makes `effect-status`
  report loaded again automatically with no manual `effect-reload` -
  confirmed on this host by a real reboot. If it ever reports `[e]` not
  loaded after a fresh session start, run `effect-reload` (or `setup`) to
  recover and treat it as worth investigating, not an expected steady
  state.
- The active window shows the border effect rendering.
- After a code change, `effect-install` (rebuild) then `effect-reload`
  completes and the border reflects it, with no session boundary.
- After `effect-remove`, `effect-status` reports not staged and the border
  is gone.

## Scope of each command

- `install` and `uninstall` affect only the local package directory
  (`$XDG_DATA_HOME`/`$HOME/.local/share` under `kwin/scripts/`).
- `enable` and `disable` touch only the exact `[Plugins]
   plasma-auto-tiler-kwinEnabled` setting in `kwinrc` and request KWin
   reconfiguration; they never modify the installed package.
- `reload` composes `disable` then `enable` to replace the running KWin script
  instance, leaving the plugin enabled.
- `status` is read-only.
- `dry-run` is read-only and never mutates anything.
- `effect-install` and `effect-remove` build/stage/unstage the native effect
  plugin under its own namespaced user-local directory, create/remove only
  the project's own `plasma-workspace/env/` script (`effect-remove` also
  migrates away any legacy `environment.d` entry), and write/remove exactly
  the one `kwinrc [Plugins] plasma-auto-tiler-active-borderEnabled` key
  (`effect-remove` deletes it only when present); neither ever uses D-Bus.
- `effect-reload` reconfigures the running KWin session live via D-Bus
  `/Effects` `loadEffect`/`unloadEffect`.
- `effect-status` is read-only.
