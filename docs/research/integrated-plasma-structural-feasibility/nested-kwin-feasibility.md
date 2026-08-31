# Nested KWin Feasibility Spike

## Pin and Method

- KWin source: `v6.7.3`, commit `45ec9a6d0ed312a803ff5658a2a3e61f221566c6`.
- Method: Git-object inspection and `--help`/command-presence checks only. No
  compositor, client, proof harness, session-bus, config, window, or process
  query was run. The investigation stopped before a deliverable and reported
  one scope deviation: reading inherited XDG/Wayland
  environment values. That observation is not evidence.

## Feasibility Matrix

| Question | Evidence | Result |
|---|---|---|
| Nested Wayland backend | `src/main_wayland.cpp:326-336,484-485,573-585` defines `--wayland-display <display>` and passes its value, or `WAYLAND_DISPLAY` when omitted, to `WaylandBackend`; `src/backends/wayland/wayland_display.cpp:220-225` calls `wl_display_connect(socketName)`. `--socket <socket>` names the child listener; empty defaults to `wayland-0` (`src/main_wayland.cpp:602-620`). Installed `kwin_wayland --help` reports both flags. | Yes for a shared-runtime nested child: `kwin_wayland --wayland-display <parent-socket> --socket <unique-child-socket> --output-count 2`. A default child socket can collide with `wayland-0`. |
| Headless two outputs | `--virtual`, `--width`, `--height`, `--scale`, and `--output-count` are defined at `src/main_wayland.cpp:337-359`; count is clamped to at least one and the virtual backend adds that many outputs with the same startup size and scale at `:530-550`. Installed help reports the same flags. | Yes: `--virtual --output-count 2 --width <w> --height <h> --scale <s>` creates two equal-geometry virtual outputs. |
| XDG and parent socket isolation | KWin gives `--wayland-display` verbatim to `wl_display_connect` and creates its server socket through KWaylandServer `addSocketName` (`src/main_wayland.cpp:573-585,602-620`). The pinned KWin tree does not contain KWaylandServer or libwayland's runtime-directory/path-resolution implementation. | Not established. Separate `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`, and `XDG_RUNTIME_DIR` are the needed isolation design, but moving `XDG_RUNTIME_DIR` may make a parent socket name unavailable. Whether an absolute parent socket path is accepted is external-library behavior not verified here. Shared runtime directories carry socket-name collision risk. |
| Isolated D-Bus ownership | KWin registers `/KWin` and `org.kde.KWin` on `QDBusConnection::sessionBus()` and unregisters it on destruction (`src/dbusinterface.cpp:39-57`). `dbus-run-session --help` shows it runs a program and can select `dbus-daemon`; `command -v` found `/run/current-system/sw/bin/dbus-run-session` and `/run/current-system/sw/bin/dbus-daemon`. | Plausible but not smoke-ready. A separate session bus would avoid name conflict, but this spike did not establish the exact environment/launcher composition or registration-failure behavior. |
| Scripts, clients, and services | KWin's accepted earlier source evidence exposes script load/start/unload through `org.kde.kwin.Scripting` (`src/scripting/scripting.cpp:722-744,819-872`). Test clients require only a reachable child Wayland socket; installed `xterm` and `konsole` exist. `--no-global-shortcuts` disables global-shortcut support (`src/main_wayland.cpp:422-424,598-600`). | Custom Tiles and virtual desktops are KWin in-process capabilities, not Plasma Shell services. Plasma Shell is not required for an ordinary test client. KGlobalAccel is required to test shortcut behavior and is deliberately unavailable with `--no-global-shortcuts`; no isolated daemon arrangement was established. |
| Teardown and global resources | `--exit-with-session <path>` makes KWin exit when its launched session application closes (`src/main_wayland.cpp:432-435`); signal handling exits the application (`src/main_wayland.cpp:312-316`). `setsid` is installed at `/run/current-system/sw/bin/setsid`. | A child process-group kill plus deletion of dedicated temporary paths is plausible. It cannot yet be claimed deterministic without the missing isolated-runtime/bus composition. A nested child necessarily creates parent-visible child-output windows; shared runtime or bus resources would also be global. |
| Multi-output and hotplug | Startup count/geometry is source-established above. Internal virtual output create/remove methods exist (`src/backends/virtual/virtual_backend.cpp:120-132,141-163`), but no stable external control surface was established. A nested backend maps outputs to parent-managed windows (`src/main_wayland.cpp:579-585`). | Suitable for static two-output geometry only. This spike does not establish meaningful external hotplug coverage. |
| Dependencies and configuration | Installed command evidence: `kwin_wayland`, `dbus-run-session`, `dbus-daemon`, `xterm`, `konsole`, and `setsid` are present. `kwin_wayland --help` exposes nested and virtual options. | No new dependency is indicated for a basic launch, but runtime service and isolated-XDG uncertainty means no claim that system configuration is unnecessary. |

## Isolation and Teardown Assessment

- The virtual path has the clearest two-output capability but does not test a
  parent Wayland connection.
- The nested path has explicit parent-display and child-socket flags, but a
  fully isolated child needs an unverified bridge from its private runtime
  directory to the parent socket.
- A private D-Bus session is necessary to avoid `org.kde.KWin` contention. Its
  launcher is installed, but the combined child environment remains unproven.
- Parent-visible nested output windows, graphics/input resources, and any shared
  runtime or bus resource are unavoidable. Therefore deterministic teardown
  cannot yet be limited confidently to one child process group and temporary
  paths.

## Verdict

- Value verdict: blocked. The path is promising but not obvious enough to be
  reusable, isolated test infrastructure under the required threshold.
- Smoke launch: not recommended. Do not authorize one from this evidence.
- Missing evidence: exact parent-socket access after private `XDG_RUNTIME_DIR`,
  complete isolated D-Bus launcher behavior, isolated KGlobalAccel service
  behavior, and an external hotplug control path.
- Next action: continue the production vertical slice without nested-KWin test
  infrastructure. Any later smoke proposal needs fresh authorization and must
  first supply those missing source or non-launching CLI facts.
