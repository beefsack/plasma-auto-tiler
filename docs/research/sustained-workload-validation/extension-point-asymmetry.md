# Research: Extension-point asymmetry (Q-A) -- unit-01, FINAL VERDICT

Status: complete. Source research only, no live KWin/D-Bus interaction.
Extends `js-baseline-measurement/research/geometry-batching.md`'s Q3
(native-plugin reachability) rather than repeating it.

Source: `/tmp/opencode/kwin-src`, git tag `v6.7.3`
(`45ec9a6d0ed312a803ff5658a2a3e61f221566c6`), sparse-checkout broadened
this stint (`git sparse-checkout add src/effect autotests/integration/
effects/scripts`) to cover the effects-API directories milestone 1's
narrower checkout (`src/scripting` only) did not include.

## Surface inventory: four relevant extension surfaces

Q-A's asymmetry question concerns which extension surfaces can drive a
per-frame window transform plus continuous gesture input. Keeping the
surfaces distinct (a prior draft incorrectly collapsed them):

1. **D-Bus `org.kde.kwin.Scripting`** -- the window-management scripting
   API milestone 1 measured. Reachable from JS, but window moves go
   through the `windowAdded`/`moveResize` geometry-write path; not the
   per-frame paint transform this verdict is about.
2. **`.js` ScriptedEffect** -- KWin's JS effects API, loaded through the
   scripted-effect loader (`src/effect/effectloader.cpp:117-165`).
   Exposes `animate()`, `set()`, and `retarget()` as `Q_SCRIPTABLE`
   (`src/scripting/scriptedeffect.h:135-150`). It has screen-edge
   registration methods (`scriptedeffect.h:129-133`) but no
   swipe-progress method (`scriptedeffect.h:127-165` confirmed).
3. **Native C++ effects** -- `Effect` subclasses loaded as dynamic
   plugins by `PluginEffectLoader`.
4. **QML declarative effects** -- a fourth, distinct non-native surface.
   `ScriptedEffectLoader::loadEffect` dispatches on `X-Plasma-API` to a
   `declarativescript` branch (`effectloader.cpp:130-139`, `:167-232`)
   that instantiates a `ScriptedQuickSceneEffect` from `main.qml`. This
   is not a `.js` ScriptedEffect; it is a separate QML surface.

## Finding 1: a geometry-write-avoiding, per-frame transform mechanism exists, and it is reachable from JS

KWin's effects API (`src/effect/effect.h`) defines `Effect::prePaintWindow`
and `Effect::paintWindow` (`src/effect/effect.h:739`, `:753`), taking a
`WindowPaintData &data` that supports `translate()` and the `+=`/`*=`
translation/scale operators (`src/effect/effect.h:381-402`). This is a
paint-time transform applied during compositing, distinct from the
`windowAdded`/`moveResize` geometry-write path milestone 1 measured.

`AnimationEffect::paintWindow` (`src/effect/animationeffect.cpp:505-594`)
implements `Attribute::Position`/`Attribute::Translation`/`Attribute::Scale`/
`Attribute::Size` by calling `data.translate(...)` and
`data.setXScale/setYScale(...)` directly inside the paint call (e.g. lines
530-588). **No call to `moveResize`, `setGeometry`, or any
window-geometry setter appears anywhere in this function** -- confirmed by
reading the full function body, not inferred. This is the
geometry-write-avoiding mechanism Q-A asked about.

`ScriptedEffect` (`src/scripting/scriptedeffect.h`), the class that loads
and exposes `.js`-based effects, extends `AnimationEffect` and exposes
`animate()`, `set()`, and `retarget()` as `Q_SCRIPTABLE`
(`src/scripting/scriptedeffect.h:135-150`). **This means a `.js` effect
script -- not a native plugin, and not the `org.kde.kwin.Scripting`
window-management API milestone 1 measured, but the distinct `.js`
ScriptedEffect surface -- can drive per-frame position/translation
transforms with no geometry write.** `retarget()` (`scriptedeffect.h:
147-150`) allows a running animation's target to be changed while it is in
flight, which is the mechanism a continuous (not fixed-duration) scroll
would need.

`.js` script creation/init runs through a `QJSEngine`
(`src/scripting/scriptedeffect.cpp:174-205`, `:229-273`), i.e. the `.js`
surface needs no compiled plugin at all.

## Finding 2: native effects load as version-pinned plugins, but that is a cost, not a capability

`PluginEffectLoader` discovers plugins under `kwin/effects/plugins`
(`src/effect/effectloader.cpp:258-261`, `:274-283`). For dynamic plugins,
`factory()` loads the shared library with `QPluginLoader`, rejects any
whose `IID` does not equal `EffectPluginFactory_iid` (`:307-322`), and
calls `createEffect()` on the factory to build the `Effect` (`:357-388`).
`EffectPluginFactory` is a `KPluginFactory` with a KWin-version-embedded
IID (`src/effect/effect.h:1091-1131`); its API explicitly lacks binary
compatibility and requires the same `kwineffects` library version
(`:1144-1145`).

This is the same version-pinning/devel-header burden `geometry-batching.md`
Q3 established for native plugins, now confirmed for the effects loader
path too. It is a *cost* of the native surface, not a *capability*.

## Finding 3: continuous swipe *progress* is not native-only

Both touchpad and touchscreen swipe *progress* (0..1, in-flight) are
reachable from non-native surfaces:

- **Native** `EffectsHandler` provides
  `registerTouchpadSwipeShortcut`/`registerTouchscreenSwipeShortcut` taking
  a `std::function<void(qreal)>` progress callback
  (`src/effect/effecthandler.h:239-256`); native `SwipeGesture` also
  emits `progress(qreal)` (`src/gestures.h:67-77`).
- **QML declarative** `SwipeGestureHandler` exposes a 0..1 `progress`
  property with `progressChanged`, plus Touchpad/Touchscreen `deviceType`
  (`src/scripting/gesturehandler.h:34-148`). It wires the native
  `SwipeGesture` progress and registers touchpad/touchscreen gestures in
  `componentComplete` (`src/scripting/gesturehandler.cpp:28-45`). These
  QML types are registered in `org.kde.kwin` at
  `src/scripting/scripting.cpp:693-705` (`SwipeGestureHandler` at `:698`).

The QML surface therefore reproduces the native swipe-progress input model.
The `.js` ScriptedEffect surface has screen-edge methods but no
swipe-progress method (`scriptedeffect.h:127-165`), so the earlier
"native-only gesture progress" candidate was wrong: it is native *or QML*,
not native-only.

## Q-A Decision Rule verdict

**No decisive or narrow native-only capability is established.**

- The per-frame paint transform is reachable from `.js` ScriptedEffect
  (`animate`/`set`/`retarget`), so the core per-frame-transform question
  closes against reviving native.
- Continuous gesture progress is reachable from the QML declarative
  surface (`SwipeGestureHandler.progress`), so the gesture-input question
  also closes against reviving native.
- **Caveat, not evidence:** `.js` transforms and QML gesture progress have
  not been demonstrated together in a single effect. Co-using QML gesture
  progress and `.js` transforms in one effect was not demonstrated, so
  combining them remains implementation/open feasibility, not evidence of
  a native-only capability.

## Weighing the absence of asymmetry against the native cost

No demonstrated API asymmetry exists, so the decision rule's native-revival
branch is not triggered. Meanwhile the native surface carries the confirmed
cost: a version-pinned `EffectPluginFactory_iid` plugin that must be
compiled against the exact `kwineffects` library version
(`effect.h:1144-1145`), which on this host collides with the
milestone-1-established impracticality of a native build (unmaterialized
`kwin.dev`, plus rebuild/recompile coordination on every KWin release).

No performance claims are made beyond source evidence. Because the
native-only condition is refuted, the external-libinput and
separate-process alternatives are moot and are not weighed here.

## Symbol check on installed KWin library

Focused `nm -DC` on the installed library at
`/nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3/lib/libkwin.so.6.7.3`
filtered with `rg 'EffectPluginFactory|PluginEffectLoader'`:

- Exported: `KWin::EffectPluginFactory` constructor, destructor,
  `isSupported`, `enabledByDefault`, Qt meta-object methods
  (`metaObject`, `qt_metacast`, `qt_metacall`, `staticMetaObject`),
  typeinfo, and vtable.
- Not exported: no `PluginEffectLoader` symbols.

What this supports: the base `EffectPluginFactory` is exported from the
installed library. It does not, by itself, show how plugins load; the
plugin-loader behavior (`QPluginLoader` IID check, `createEffect`
invocation) is established by the cited `effectloader.cpp` source, not by
this symbol result. No performance or runtime claim is drawn from the
symbol output alone.
