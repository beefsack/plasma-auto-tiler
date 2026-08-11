# Research: Geometry-Batching / Coalescing API Asymmetry (JS vs Native)

Status: Non-invasive source research only. No live KWin/D-Bus interaction, no
script loading, no window spawning. Resolves the one surviving argument for a
native plugin after `timing-attribution.md`: whether native C++ has a
geometry-batching/coalescing primitive that the JS scripting API lacks, and
whether that asymmetry is real. Supersedes the open questions in
`timing-attribution.md` Sections 4 and 6 regarding `GeometryUpdatesBlocker`.

## Method

- Source: a prior KWin clone was found on disk at `/tmp/opencode/kwin-src`.
  It is a **sparse checkout** (git sparse-checkout, 8% of files) but it
  contains the exact files needed (`src/x11window.{h,cpp}`,
  `src/window.{h,cpp}`, `src/waylandwindow.{h,cpp}`, `src/xdgshellwindow.cpp`,
  `src/workspace.h`, `src/plugin.h`, `src/scripting/*`,
  `src/CMakeLists.txt`). Working tree is clean (`git status`).
- Exact revision: `git rev-parse HEAD` = `45ec9a6d0ed312a803ff5658a2a3e61f221566c6`,
  which is exactly tag `v6.7.3` (`git describe --tags` = `v6.7.3`), commit
  message "Update version for new release 6.7.3". All file:line citations
  below are from this tag.
- The running KWin build on this host is
  `/nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3`; its
  `lib/libkwin.so.6.7.3` confirms the 6.7.3 patch level, matching tag `v6.7.3`.
- Host facts checked directly (Q3): installed headers, nix store, and the
  nixpkgs 26.11 channel source (see Section 3).

Note on naming: the class the prior research found by name as
`GeometryUpdatesBlocker` does not exist under that name in 6.7.3. A
repo-wide grep of `src/` finds only `X11GeometryUpdatesBlocker`
(`src/x11window.h:419`). All analysis below is of that class.

## Q1. What `X11GeometryUpdatesBlocker` actually does

It is a **per-window RAII deferral helper**, not a cross-window batching
primitive.

- Definition, `src/x11window.h:416-434`: a tiny RAII class whose constructor
  calls `cl->blockGeometryUpdates(true)` on a *single* `X11Window*` and whose
  destructor calls `blockGeometryUpdates(false)`. It takes exactly one window.
- `blockGeometryUpdates(bool)`, `src/x11window.cpp:3488-3497`: increments a
  per-window counter `m_blockGeometryUpdates`; on unblock, only when the
  counter returns to 0, calls `configure(Xcb::toXNative(m_bufferGeometry))`.
  The member is documented at `src/x11window.h:408`:
  "> 0 = New geometry is remembered, but not actually set".
- The geometry mutation path, `X11Window::moveResizeInternal`,
  `src/x11window.cpp:3502-3558`: new geometry is written to in-memory fields
  (`m_frameGeometry`/`m_clientGeometry`/`m_bufferGeometry`, lines 3525-3528)
  and `configure()` is issued **only if `!areGeometryUpdatesBlocked()`**
  (lines 3531-3533). So while blocked, repeated `moveResize` calls on the
  same window update memory each time but send zero protocol messages; one
  `configure()` is sent at unblock with the final geometry.
- `configure()`, `src/x11window.cpp:3560-3593`, is the X11 protocol
  interaction: it calls `m_client.setGeometry(...)` / `m_client.move(...)`,
  i.e. issues XCB `ConfigureWindow` requests to the X server (via Xwayland,
  since X11 windows run through Xwayland here). This is the round trip that
  `timing-attribution.md` Section 3 identified as the dominant measured cost.
- Scope of the mechanism: `blockGeometryUpdates`, `areGeometryUpdatesBlocked`,
  and `X11GeometryUpdatesBlocker` appear **only** in `src/x11window.{h,cpp}`.
  No usage in `workspace.cpp`, `placement.cpp`, `stackingorder.cpp`, or
  `src/scripting/*`. The `X11GeometryUpdatesBlocker` usage sites are all
  inside `X11Window`'s own methods: `manage()` (`src/x11window.cpp:353`,
  unblock at 871), `updateDecoration()` (`:945-958`), `maximize()`
  (`:3625`), `setFullScreen()` (`:3789`, `X11GeometryUpdatesBlocker` at
  `:3824`).
- There is a workspace-scoped `StackingUpdatesBlocker`
  (`src/workspace.h:768-783`, wrapping `Workspace::blockStackingUpdates`,
  counter at `src/workspace.h:718`) but it defers **stacking order** updates
  only, not geometry, and likewise applies within a single call scope; it
  does not coalesce geometry round trips.

**Q1 verdict: per-window deferral only.** The blocker coalesces a *single*
window's repeated geometry mutations within one call scope into fewer X11
round trips. It does **not** batch multiple *different* windows' geometry
changes into fewer compositor/protocol round trips; there is no shared queue,
flush point, or multi-window transaction anywhere in the mechanism.

## Q2. Is there an equivalent in the KWin JS scripting API?

No. The JS-exposed surface has no geometry deferral/batching/transaction
primitive of any kind.

- The JS global environment is built in `Scripting::init`,
  `src/scripting/scripting.cpp:218-251`: it exposes `options`,
  `workspace` (the `QtScriptWorkspaceWrapper`), and a fixed list of global
  functions (`readConfig`, `callDBus`, `registerShortcut`,
  `registerScreenEdge`, etc.). None of these relate to geometry batching.
- Windows reachable from JS come as `KWin::Window*` QObjects:
  `workspace.windowList()` returns `QList<KWin::Window *>`
  (`src/scripting/workspace_wrapper.cpp:505-508`, declaration
  `src/scripting/workspace_wrapper.h:642`). QJSEngine wraps these as plain
  QObjects, exposing only Q_PROPERTY members, public slots, Q_INVOKABLE
  methods, and signals.
- The only geometry-mutation surface a JS script gets is the `frameGeometry`
  property, whose WRITE accessor is `Window::moveResize`
  (`src/window.h:479`; implementation `src/window.cpp:3412-3420`, which calls
  the virtual `moveResizeInternal`). `Window` exposes no blocking method at
  all: a repo-wide grep finds `blockGeometryUpdates` only on `X11Window`.
- On `X11Window` itself, `blockGeometryUpdates(bool)`,
  `blockGeometryUpdates()`, `unblockGeometryUpdates()`,
  `areGeometryUpdatesBlocked()` are plain public C++ methods
  (`src/x11window.h:70-73`). They are **not** `Q_INVOKABLE` and are **not** in
  the `public Q_SLOTS:` section, which contains only `closeWindow` and
  `updateCaption` (`src/x11window.h:235-237`). X11Window has no Q_PROPERTY
  entries at all. Plain public methods are not callable from QJSEngine, so
  these four methods are unreachable from `Scripting.start()`-loaded scripts
  even if a script held a reference to an `X11Window`.
- For completeness: `X11Window` has `Q_OBJECT` (`src/x11window.h:45`), and
  the only `Q_INVOKABLE` on the base `Window` class is `setMaximize`
  (`src/window.h:1107`). The `WorkspaceWrapper` Q_INVOKABLE list
  (`src/scripting/workspace_wrapper.h:368-533,642`) is window-management only
  (`raiseWindow`, `constrain`, `unconstrain`, `windowAt`, `windowList`,
  tiling accessors, etc.) - no blocking or batching.

**Q2 verdict: nothing equivalent is reachable from JS.** The specific
internal API that would be needed is `X11Window::blockGeometryUpdates(bool)`
(the backing of `X11GeometryUpdatesBlocker`), confirmed absent from the
JS-exposed surface. A script's geometry write (`window.frameGeometry = rect`)
always reaches `X11Window::moveResizeInternal` with the block counter at 0,
so every genuine geometry change issues an immediate X11 configure round
trip.

## Q3. Can a `KWin::Plugin`-based binary plugin actually reach it?

In principle, yes - but with two practical caveats, one of which is decisive
on this host.

**(a) Header availability:** KWin's install rules ship `x11window.h`,
`window.h`, `workspace.h`, `waylandwindow.h`, and `plugin.h` as part of the
public/plugin-facing Devel header set:
- `src/CMakeLists.txt:478-552` installs the Devel headers, including
  `window.h` (line 544), `workspace.h` (545), `x11window.h` (547),
  `waylandwindow.h` (543), `plugin.h` (525), `config-kwin.h` and
  `kwin_export.h` (479-480), plus `atoms.h` (475) and `utils/xcbutils.h`
  (614) which `x11window.h` includes.
- `X11GeometryUpdatesBlocker` is fully inline in the installed
  `x11window.h` (`src/x11window.h:416-434`), so it needs no extra header.
- `x11window.h`'s other includes (`<NETWM>`, `<xcb/res.h>`, `<xcb/sync.h>`,
  Qt) come from dev packages of KF6/kwindowsystem and libxcb.

**(b) Symbol availability:** the `kwin` library is SHARED
(`src/CMakeLists.txt:20-25`) and exports a CMake package (`KWinConfig.cmake.in`,
`KWinTargets.cmake` at `src/CMakeLists.txt:401,472`). Classes used by plugins
are `KWIN_EXPORT`. Verified against the running binary:
`nm -DC /nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3/lib/libkwin.so.6.7.3`
shows exported text symbols `KWin::X11Window::blockGeometryUpdates(bool)`,
`KWin::X11Window::configure(KWin::Rect const&)`,
`KWin::X11Window::moveResizeInternal(...)`, `KWin::Window::moveResize(...)`,
`KWin::Workspace::blockStackingUpdates(bool)` (277 `X11Window` symbols in
total). A plugin could `qobject_cast<X11Window*>` (Q_OBJECT, `src/x11window.h:45`)
a `Window*` and drive the blocker. Plugin loading is
KPluginFactory/IID-based (`PluginFactory_iid`, `src/plugin.h:19`;
`src/pluginmanager.cpp:104-109`).

**Caveat 1 (decisive for this host): no dev headers are installed.**
- No `/usr/include/kwin`, no `/nix/store/*kwin*dev*` path, and the running
  `kwin-6.7.3` output has no `include/` dir (only `bin`, `lib`, `libexec`,
  `share`).
- nixpkgs **does** define a dev output: the system channel is nixpkgs 26.11
  (flake registry resolves `nixpkgs` to
  `/nix/store/aiapnjc6w07cz0jxy8s3j8cg1vfh1k8b-source`). The kwin package
  (`pkgs/kde/plasma/kwin/default.nix`) uses `mkKdeDerivation`, which sets
  `outputs = [ "out" "dev" "devtools" ]` (`pkgs/kde/lib/mk-kde-derivation.nix:135-140`);
  the built kwin derivation records outputs `out`, `dev`, `devtools`, `debug`.
  So a usable dev output could be built, but it is **not materialized on this
  host** - only the `out` output is present in the store. Building a plugin
  would require first building/fetching `kwin.dev` (plus the kwin `dev` deps
  like libxcb-dev, Qt6/KF6 dev) and compiling the plugin against that exact
  version's headers and `libkwin.so`.

**Caveat 2: version pinning.** `src/plugin.h:24` states a binary extension
"must be recompiled with every new KWin release" (IID is
`org.kde.kwin.PluginFactoryInterface` + `KWIN_PLUGIN_VERSION_STRING`).

**Q3 verdict:** a binary `KWin::Plugin` *could* in principle reach
`X11Window`, `X11GeometryUpdatesBlocker`, and `Workspace` - the headers are
part of KWin's installed Devel (plugin-facing) set and the symbols are
exported from `libkwin.so`. But on this host this requires building the
nixpkgs `kwin.dev` output first (not present today) and recompiling per KWin
release. It would NOT require building against KWin's internal (non-installed)
source tree, since all needed headers are installed.

## Q4. Do Wayland windows have an analogous batching/deferral path?

`X11GeometryUpdatesBlocker` and `blockGeometryUpdates` are **X11-specific** -
they exist only on `X11Window`. But Wayland windows have a *different,
pre-existing per-window* deferral built into the xdg-shell protocol handling,
and it too is per-window only.

- `X11GeometryUpdatesBlocker`/`blockGeometryUpdates` are absent from
  `src/waylandwindow.{h,cpp}` (grep confirms X11-only).
- `WaylandWindow`'s own geometry path (`WaylandWindow::updateGeometry`,
  `src/waylandwindow.cpp:212-254`) only updates in-memory geometry and emits
  signals; it sends no protocol message directly.
- The real Wayland path is `XdgSurfaceWindow::moveResizeInternal`
  (`src/xdgshellwindow.cpp:262-289`): on a size change it calls
  `scheduleConfigure()`, which starts a single-shot `m_configureTimer`
  (`src/xdgshellwindow.cpp:107-112`); on timeout, `sendConfigure()`
  (`:114-133`) sends **one** `xdg_surface.configure` event carrying the
  accumulated state (`m_configureFlags`, `m_nextGravity`, `m_nextTargetScale`,
  next client size). The code comment at `src/xdgshellwindow.cpp:85-87`
  states this explicitly: "Configure events are not sent immediately, but
  rather scheduled to be sent when the event loop is about to be idle. By
  doing this, we can avoid sending configure events that do nothing."
- So multiple geometry changes to the *same* Wayland window within one
  event-loop turn coalesce into one configure message - an analogous
  per-window deferral, but timed by the event loop rather than by an explicit
  C++ call scope. There is likewise no cross-window batching.

**Q4 verdict:** the `X11GeometryUpdatesBlocker` mechanism is X11-only.
Wayland/xdg-shell has an analogous *per-window* coalescing mechanism built
into its configure-event scheduling, but neither backend has any
cross-window batching/transaction primitive.

## Final verdict

For the geometry-batching argument specifically:

**no asymmetry exists.**

The suspected native-only primitive (`X11GeometryUpdatesBlocker`) is real but
per-window-only: it coalesces repeated geometry mutations of a *single* X11
window within one call scope into fewer X11 configure round trips. It does
not batch multiple different windows' geometry changes into fewer
compositor/protocol round trips in either backend, and no cross-window
batching/transaction/queue primitive exists anywhere in KWin 6.7.3. A tiler
that repositions many distinct windows once per reconcile pass (the
`timing-attribution.md` CHANGE-group scenario) would gain nothing from it.
The JS API lacks the per-window deferral too, but that asymmetry is
immaterial: the primitive exists only for KWin's own multi-step internal
operations (`manage`, `maximize`, `setFullScreen`, decoration changes) on a
single X11 window, not for tiling-style multi-window writes. A native plugin
could in principle call `X11Window::blockGeometryUpdates` (headers are
installed and symbols exported), but doing so requires building nixpkgs's
`kwin.dev` output on this host and, per `src/plugin.h:24`, recompiling on
every KWin release - for zero cross-window benefit.

## Summary

| Item | Finding | Evidence |
|---|---|---|
| Q1. `X11GeometryUpdatesBlocker` scope | Per-window deferral only; no cross-window batching | `src/x11window.h:416-434`, `src/x11window.cpp:3488-3497, 3502-3558, 3560-3593`; all usage inside `X11Window` methods only |
| Q2. JS-equivalent primitive | None; `blockGeometryUpdates` not exposed (plain method, not slot/invokable) | `src/scripting/scripting.cpp:218-251`, `src/scripting/workspace_wrapper.cpp:505-508`, `src/x11window.h:70-73, 235-237`, `src/window.h:479` |
| Q3. Native plugin reachability | Yes in principle (Devel headers + exported symbols); dev output absent on this host; version-pinned | `src/CMakeLists.txt:478-552, 401, 472`, `src/plugin.h:19-24`, `nm` on `libkwin.so.6.7.3`, nixpkgs 26.11 `mk-kde-derivation.nix:135-140` |
| Q4. Wayland analog | X11-only blocker; Wayland has analogous per-window configure coalescing; no cross-window batching either | `src/waylandwindow.cpp:212-254`, `src/xdgshellwindow.cpp:85-133, 262-289` |
