# Native Effect Dev Staging

## Goal

- Stage the native active-border effect plus KCM via
  `just build-native-effect` into repo-local
  `target/kwin-native-effect-stage/` for `QT_PLUGIN_PATH` use.

## Scope

- Recipe only configures/builds against the pinned KWin CMake dir and freshly
  stages both `.so` files; no KWin, D-Bus, config, or
  user-path mutation.
- README documents manual env-script/`kwinrc` setup, undo, and the
  logout/login boundary; Nix checks build the existing `nativeEffect`
  derivation, which validates both plugin artifacts.

## Non-Goals

- No effect/KCM behavior, defaults, schema, dev-loop recipe, or
  `devenv.nix` change; no live session, reload, or rendering claim.

## Evidence

- `nativeEffect` built with its `installCheckPhase` asserting both plugin
  paths. It is now a `nix flake check` member; the full check remains blocked
  by an unrelated existing Home Manager service-attribute assertion.
- A rebuild needs logout/login; `just dev`, `just reload`, and controller
  reload are insufficient. No OpenGL backend means no border.

## KWin 6.7.4 Reload Verdict

- Source: KWin 6.7.4 `src/effect/effectloader.cpp:260,276,307-313,405`;
  `effecthandler.cpp:337-340,1173-1193,1567-1602`; Qt 6.11.1
  `qcoreapplication.cpp:libraryPathsLocked`, `qpluginloader.cpp:loadPlugin`,
  `qlibrary.cpp:QLibraryPrivate::findOrCreate`, `qlibrary_unix.cpp:unload_sys`;
  staging replacement is directory removal then rename (`justfile:973-981`).
- 1. Yes for `QT_PLUGIN_PATH`: KWin finds relative `kwin/effects/plugins`
  through Qt library paths, which Qt initializes from that environment once.
  Qt can add a path in-process, but KWin exposes no such effect-path operation.
- 2. Yes: a `[Plugins]` `*Enabled` change causes KWin to find/read-config then
  unload or load the effect; `reconfigure()` calls `queryAndLoadAll()`.
  It deletes the `Effect` object, but not the library: KWin never unloads its
  `QPluginLoader`, whose default `PreventUnloadHint` prevents `dlclose`.
- 3. No: disable/rebuild/re-enable at the same path reuses Qt's cached
  `QLibraryPrivate` and plugin instance. Its mapped old inode remains resident,
  so it does not load the replacement code.
- A unique file in the already discovered plugins directory avoids that cache
  and needs no new session; a unique directory repeats case 1.
- Practical loop: establish `QT_PLUGIN_PATH` then log in once; toggle existing
  code through `[Plugins]` plus reconfigure; after same-path rebuild, log in
  again before evaluating it.

## Hot Unique-Name Reload Verdict

- Source: KWin 6.7.4 `src/effect/effectloader.cpp:274-283,293-317,392-405`,
  `effecthandler.cpp:337-340,1567-1602`; KCoreAddons 6.29.0
  `src/lib/plugin/kpluginmetadata.cpp:56-95,163-191,253-306`; Qt 6.11.1
  `src/corelib/plugin/qfactoryloader.cpp:265-267,372-386,426-486`.
- 1. Yes: every native `findEffect()`, `findAllEffects()`, and
  `queryAndLoadAll()` calls `KPluginMetaData::findPlugins()` anew.
  `findPlugins()` runs a fresh `QDirIterator` over each Qt library path plus
  `kwin/effects/plugins`; `reconfigure()` calls `queryAndLoadAll()`. This is
  why a newly installed system native effect can be discovered without restart.
- Qt's `QFactoryLoader` does cache a seen directory, but KWin native effects
  do not use it for discovery; KWin constructs `QPluginLoader` from each found
  file path.
- 2. Native `pluginId` is the library complete basename; an embedded different
  `Id` only warns and does not override it. Therefore a unique filename also
  needs its own `[Plugins]` `<new-id>Enabled` key: `<old-id>Enabled` does not
  survive the rename (`effectloader.cpp:52-70`; `effecthandler.cpp:1576-1601`).
- Thus two distinct library filenames in one directory cannot share this ID.
- If identical IDs arise across search paths, `findPlugins()` silently retains
  the first `QDirIterator` result and ignores later copies (`:265-305`); do not
  rely on that order. Distinct unique basenames avoid this collision.
- Verdict: hot reload is achievable. Stage a fresh basename, retain the active
  old file, set old false and new true, then reconfigure; KWin unloads old
  before loading new. Only then remove stale files. Unlinking a resident old
  file leaves its mapped, unload-prevented library usable, but removing it
  before the transition stops `configChanged()` finding its ID to unload it.
