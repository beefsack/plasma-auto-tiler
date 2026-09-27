# Native Effect Rust And Group Highlighting Investigation

## Outcome

- Keep the KWin effect's ABI-facing layer in C++. Put OS/DE-agnostic policy,
  geometry, group membership, and highlight intent in the central Rust engine.
  A small C ABI with plain value types is the recommended Rust boundary.
- Native effects do not safely unblock production edge-drag share adjustment on
  KWin 6.7.4: they expose authoritative current and initial geometry, but not
  whether the finished interaction was cancelled.
- Group highlighting can proceed independently in the existing C++ effect. Its
  engine-side intent work is independent of the native-effect language choice.

## Q1: KWin ABI And Rust

### What The ABI Requires

- The current effect is a `KWin::Effect` `QObject` subclass with `Q_OBJECT`
  (`kwin/native-effect/activewindowborder.h:12-29`). Its factory is
  `KWIN_EFFECT_FACTORY(ActiveWindowBorderEffect, "metadata.json")` followed by
  generated moc inclusion (`activewindowborder.cpp:109-113`). CMake supplies
  the macro processing and builds a `kwin/effects/plugins` KCoreAddons plugin
  (`CMakeLists.txt:26-51`).
- In KWin 6.7.4, `src/effect/effect.h` defines `Effect` and
  `EffectPluginFactory` as Qt objects. `KWIN_EFFECT_FACTORY` emits the latter
  with `Q_OBJECT`, `Q_PLUGIN_METADATA`, `Q_INTERFACES`, and `createEffect()`.
  Its metadata IID incorporates `KWIN_PLUGIN_VERSION_STRING`.
- KWin's own header says this API has no binary-compatibility promise: the
  plugin must be compiled against the same `kwineffects` version as KWin.
  `src/plugin.h` likewise requires recompilation for every KWin release.
  `src/effect/effectloader.cpp` rejects a plugin whose IID differs before it
  creates the effect. This is a version-locked native adapter, not a portable
  binary.
- The existing caller-package build provides matching `kdePackages.kwin` and
  `kdePackages.kwin.dev` (`devenv.nix:21-22`), which is the correct delivery
  model. It reduces build friction, not the recompile requirement.

### Rust Options

- Recommended: retain a minimal C++ effect/factory/moc/metadata/rendering shim
  and call Rust through `extern "C"` functions over POD values. C++ owns Qt
  signal connections, `EffectWindow` and scene objects, `OutlinedBorderItem`,
  and KWin-version rebuilds. Rust owns all portable calculations. This avoids
  QObject ownership, Qt metaobject generation, C++ virtual dispatch, and KWin
  ABI layout across the language boundary.
- `cxx` alone does not implement a moc-generated QObject subclass or the KWin
  plugin factory. `cxx-qt` can bridge Qt subclasses in principle, but the
  effect and factory still need KWin-specific virtual inheritance, the exact
  versioned plugin IID, KWin factory macro semantics, and moc integration.
  There is no established KWin-effect factory route here. It adds Rust/CMake/
  Qt code-generation version coupling while leaving every KWin rebuild
  compulsory. It is higher-risk than a C ABI shim without a compensating gain.
- Hand-written full Rust bindings are not realistic. They would have to match
  Qt's QObject/moc metadata and the `Effect` and `EffectPluginFactory` C++
  vtables, including versioned plugin metadata. A KWin header change could
  break the plugin at load time.

### Recommendation And Migration

- Keep C++ as a dumb, version-locked native shim. Do not attempt to make the
  KWin effect wholly Rust. This honors the boundary: KWin/Qt interaction and
  rendering are native; engine policy is portable Rust for later Windows and
  macOS adapters.
- Do not port `activeBorderColor`, `activeBorderInnerRect`, or
  `activeBorderState` from `activeborderlogic.h`. Although their expressions
  are pure, they only consume KDE/KWin-derived values and are not a meaningful
  reusable portable unit. Keep their theme/color, frame/gap, and window-state
  semantics in the KWin implementation; do not add a shared abstraction for
  this trivial arithmetic. Reconsider only if independently meaningful
  OS/DE-agnostic logic arises.
- The recommended C-ABI path needs no new system dependency: Cargo and the
  current CMake/Qt/KF/KWin development environment suffice. Rust dependencies
  belong in `Cargo.toml`, if the migration is approved. `cxx-qt` would add
  crate/build integration and potentially toolchain requirements, but is not
  recommended. No `devenv.nix` change is proposed.

## Q2: Edge Drag

- **No.** The native effect route does not unblock a correct production
  edge-drag share adjustment on KWin 6.7.4.
- `KWin::Window::moveResizeGeometry()` is authoritative in-progress geometry
  (`src/window.h:636`, `src/window.cpp:3348-3351`), and
  `initialInteractiveMoveResizeGeometry()` provides the drag-start geometry
  (`src/window.h:1708-1711`; captured at `src/window.cpp:1053`). These are
  native-only integration facts, so obtaining and mapping their rectangles is
  native-adapter work.
- The critical cancel fact is missing. Core accepts
  `finishInteractiveMoveResize(bool cancel)` (`src/window.h:1742`), restoring
  the initial geometry for cancellation (`src/window.cpp:1069-1078`), but
  emits parameterless `Window::interactiveMoveResizeFinished()`
  (`src/window.h:1514`, `src/window.cpp:1110`). The public effect counterpart,
  `EffectWindow::windowFinishUserMovedResized`, is also parameterless
  (`src/effect/effectwindow.h:710`, `src/effect/effectwindow.cpp:89-91`).
- A final rectangle equal to the initial rectangle cannot distinguish cancel
  from a committed net-zero resize. Therefore the minimal otherwise-useful
  payload `{window_id, initial_rect, latest_rect, finished, cancelled}` cannot
  be completed: `cancelled` is unavailable. Classification, share calculation,
  and reconciliation remain Rust-engine work, but there is no safe native
  adapter signal to feed them yet.

## Q3: Group Highlighting

- Today the effect renders one outline for `effects->activeWindow()`. It tracks
  activation/deletion and the tracked window's frame/minimized/fullscreen
  changes (`activewindowborder.cpp:30-42,69-102`) using one
  `OutlinedBorderItem` (`activewindowborder.h:26-28`). It has no group or drag
  input.
- A true tiler-group highlight needs the engine to push resolved membership and
  highlight intent to the effect for the active move interval, then clear it.
  The current portable `Session` owns split trees and drag previews, including
  target-group information (`src/session.rs:483-595`); KWin's X11 client group
  and transient relationships are not tiler groups
  (`docs/research/active-window-border/grouped-window-options.md:65-86`).
- Engine side: decide source/target group membership and highlight intent, and
  map opaque engine IDs through the existing adapter. Native side: receive a
  bounded resolved set of native window identities or rectangles, track its
  lifetime, and render/repaint multiple outlines. The smallest new effect
  interface is one explicit set-or-clear push of that resolved highlight set;
  it must not transfer topology ownership to the effect.
- This is small-to-medium incremental work, mostly multiple-outline rendering,
  a bounded input and tests. It can proceed now in the existing C++ effect and
  is not gated on Q1. If a later Rust migration occurs, only the native
  renderer is reworked; the engine's membership/intent contract remains
  portable.

## Limits

- No live KWin action, build, plugin reload, D-Bus call, or scratch probe was
  performed. Header/source claims are static KWin 6.7.4 findings.
- The exact native identity encoding and chosen transport for group-highlight
  push are ungrounded until a product rendering choice and adapter path are
  selected. Whether highlighting means source group, target group, member
  borders, or a bounding outline is likewise unselected.
