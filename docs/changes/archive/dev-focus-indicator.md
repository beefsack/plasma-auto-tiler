# Dev Focus Indicator

## Goal

Make the focused window immediately visible during development without adding
project code or reintroducing the experimental native active-border effect.

## Outcome

- Select KWin's built-in, disabled-by-default `Dim Inactive` effect: active
  windows stay bright and inactive windows are darkened.
- User action: System Settings, search `Desktop Effects`, under `Focus` enable
  `Dim Inactive`, then Apply. Disable it and Apply to undo.
- Equivalent user-run command: `kwriteconfig6 --file ~/.config/kwinrc --group Plugins --key diminactiveEnabled true && qdbus org.kde.KWin /KWin reconfigure`.
  Replace `true` with `false` to undo.

## Scope And Evidence

- This is an upstream KWin effect, not project code; no controller reload,
  project configuration mutation, native-effect build, load, or installation is
  required.
- KWin 6.7.4 metadata places it in `Focus`, defaults it disabled, and describes
  darkening inactive windows (`src/plugins/diminactive/metadata.json:3-4,51-53`).
- Its paint path leaves the active window undimmed and changes inactive-window
  brightness and saturation (`src/plugins/diminactive/diminactive.cpp:151-204`).
- The `diminactiveEnabled` key follows KWin's `[Plugins]` `<effect>Enabled`
  loader contract (`src/effect/effectloader.cpp:52-69`). Static source evidence
  only; the user owns live confirmation.

## Active-Border Investigation (2026-09-11)

### Question 1: Scripted Or QML Effects

- Verdict: no viable scripted or QML effect can provide an always-on active
  border while preserving normal desktop interaction. Confidence: high.
- JavaScript effects (`X-Plasma-API=javascript`) load `ScriptedEffect`, an
  `AnimationEffect`; its documented API exposes animation, shader, and config
  operations, while `AnimationEffect::paintWindow()` transforms existing window
  quads. It has no arbitrary draw/overlay primitive
  (`src/effect/effectloader.cpp:258-390`, `src/scripting/scriptedeffect.h:26-225`,
  `src/effect/animationeffect.cpp:469-713`).
- Declarative effects (`X-Plasma-API=declarativescript`) load
  `ScriptedQuickSceneEffect` from `contents/ui/main.qml`. Their `SceneEffect`
  delegate can draw arbitrary QML `Rectangle` items in an `OffscreenQuickView`,
  composited through the scene `overlayItem` above CSD and SSD windows
  (`src/effect/effectloader.cpp:167-205`, `examples/quick-effect/package/contents/ui/main.qml`,
  `src/effect/offscreenquickview.cpp:151-204`, `src/scene/workspacescene.cpp:699-760`).
- That paint capability is unusable for this purpose: running a
  `QuickSceneEffect` unconditionally grabs keyboard, starts mouse interception,
  and becomes the singleton active fullscreen effect; it has no QML or metadata
  pass-through opt-out (`src/effect/quickeffect.cpp:523-567`,
  `src/scripting/scriptedquicksceneeffect.h:48-70`). KWin then consumes keyboard
  and pointer input for the effect and ends interactive move/resize
  (`src/input.cpp:560-579,3443-3453`, `src/effect/effecthandler.cpp:513-565`).
- QML can observe `Workspace.activeWindow` and technically bind an exposed
  `Window.frameGeometry` to an outline, but the latter is an anonymous,
  undocumented QML type with no supported per-frame resize guarantee
  (`src/scripting/workspace_wrapper.h:58-60,154-168`,
  `src/scripting/scripting.cpp:706-708,713`, `src/window.h:479,1469`).
- JavaScript/QML evaluation or component-load errors are logged and the effect
  fails to load, rather than executing unsafe native code
  (`src/scripting/scriptedeffect.cpp:302-309`,
  `src/effect/effectloader.cpp:182-193`). They can still cause no display,
  fullscreen-effect contention, stale UI, and, for QML scenes, input capture;
  this is not a guarantee that a compositor cannot crash through KWin/Qt bugs.
- A declarative package would need `metadata.json` plus `contents/ui/main.qml`,
  KPackage discovery under `kwin-wayland/effects` or `kwin/effects`, and an
  explicit `[Plugins] <id>Enabled=true` KWin configuration change
  (`src/plugins/kpackage/effect/effect.cpp:15-45`,
  `src/effect/effectloader.cpp:52-70,228-249`). It needs no compilation, but the
  existing dev loop has no package staging, enablement, or effect reload path.
  A minimal package is roughly 60-140 lines across metadata and QML, but is not
  recommended because its required scene lifecycle breaks focus and pointer use.

### Question 2: Native-Effect Crash Evidence

- Verdict: exonerated under the requested fault-stack criterion. Two retained
  live-compositor dumps list `plasma-auto-tiler-active-border.so` only as a
  loaded module, never in a faulting frame or any thread backtrace.
- PID 2090 (2026-09-11, SIGSEGV) reaches `KCrash::defaultCrashHandler` from
  Qt QML `QV4::Value::sameValueZero`, `QV4::ESTable::get`, and
  `QV4::WeakMapPrototype::method_get`; PID 3568836 (2026-09-07, SIGABRT) reaches
  `abort` through libdbus marshalling and `QKeySequence` DBus deserialization.
  `coredumpctl info` reports no active-border stack frame for either dump.

### Native Development Loop

- The native effect is buildable in the devenv shell: `devenv.nix:8-30` provides
  KWin and `kwin.dev`, and `flake.nix:64-108` supplies the matching CMake path
  and verifies the effect/KCM plugin outputs. It is OpenGL-gated and already
  tracks `activeWindow()` plus `windowFrameGeometryChanged` into `overlayItem`
  (`kwin/native-effect/activewindowborder.cpp:17-42,69-101`).
- To load it in a development session after the host installation removal, the
  loop needs an explicit native-effect build, staging its two `.so` outputs in a
  `QT_PLUGIN_PATH` root, a new Plasma session boundary to consume that env
  script, and the separate `[Plugins] plasma-auto-tiler-active-borderEnabled`
  setting. The existing `just` loop manages only the Planner and KWin script
  (`docs/dev-loop.md:38-89`); `effect-install` describes the missing staging
  lifecycle but has not been live-verified (`scripts/dogfood-install.sh:428-449`,
  `README.md:393-435`).

### Recommendation

- Rank 1 and only surviving route: make the existing native effect buildable and
  loadable in the dev loop, then live-verify it separately. The retained crashes
  do not implicate it, but native ABI and compositor-crash risk remain.
- Do not implement a JavaScript effect, a declarative `SceneEffect`, window
  decorations, a separate overlay process, or a plain KWin script.
