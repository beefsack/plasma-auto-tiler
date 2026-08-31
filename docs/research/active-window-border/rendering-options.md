# Upstream/Native KWin Rendering Options - Active Window Border

Research for `research-01`. Scope: authoritative current/upstream KWin-supported
and built-in approaches only. Findings are recorded; no final option is
recommended or selected.

- Access date for all citations: 2026-08-15.
- Installed host: KWin `6.7.3` (`kwin_wayland --version` reports `kwin 6.7.3`);
  dev headers under
  `/nix/store/483vmk08g6bjaa3bvf3abn10cwpw6ap9-kwin-6.7.3-dev/include/kwin/`;
  KDecoration dev headers under
  `/nix/store/j04pmdgm0hsm5f2ryzr95inx508p7zvc-kdecoration-6.7.3-dev/include/KDecoration3/`.
- Local upstream checkouts for exact-version verification:
  `/tmp/opencode/kwin-pinned` at `v6.7.3` (commit
  `45ec9a6d0ed312a803ff5658a2a3e61f221566c6`, 2026-07-14);
  `/tmp/opencode/kwin-6.7.4` at `v6.7.4` (commit
  `8438567a741826da8b7536a8b10eb3af8fc8820d`, 2026-08-04).

## Source Map

| # | Claim anchor | Source | URL | Verified |
|---|---|---|---|---|
| C1 | `OutlinedBorderItem` is a public `KWIN_EXPORT` scene `Item` | installed header | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/scene/outlinedborderitem.h | read local v6.7.3 header |
| C2 | `buildQuads()` emits up to 8 rectangles (4 corners + 4 edges) from a `BorderOutline` | local v6.7.3 source | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/scene/outlinedborderitem.cpp | read local `buildQuads()` |
| C3 | Rendered only by the OpenGL item renderer via `ShaderTrait::Border` | local v6.7.3 source | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/scene/itemrenderer_opengl.cpp (~302/309/493/526) | grep local source |
| C4 | QPainter item renderer has no `OutlinedBorderItem`/border handling | local v6.7.3 source | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/scene/itemrenderer_qpainter.cpp | grep local source (no match) |
| C5 | KWin uses `OutlinedBorderItem` internally for SSD decoration outline | local v6.7.3 source | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/scene/decorationitem.cpp (line 252) | read local source |
| C6 | `BorderOutline` (thickness/color/radius) has `from(KDecoration3::BorderOutline)` | installed header | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/scene/borderoutline.h | read local header |
| C7 | `Effect` is public; `blocksDirectScanout()` defaults to `true` | local v6.7.3 source | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/effect/effect.cpp (535-538) | read local source |
| C8 | Effect plugin ABI: no binary compatibility guarantee | installed header | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/effect/effect.h (factory macro doc) | read local header |
| C9 | `QuickSceneEffect`/`QuickSceneView` provide fullscreen QtQuick effects | installed header | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/effect/quickeffect.h | read local header |
| C10 | `EffectWindow::window()`/`windowItem()` expose the underlying scene item; `OutlinedBorderItem` accepts an `Item *parent` constructor argument, while `Item::addChild` is private | installed headers and local source | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/effect/effectwindow.h (668); https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/scene/outlinedborderitem.h; https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/scene/item.h | read local v6.7.3 headers/source |
| C11 | `Outline` is a QML-driven geometry outline (snap/edge previews) | installed header | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/outline.h | read local header |
| C12 | `highlightwindow` = built-in active-window highlight (animation, on demand) | local v6.7.3 source | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/plugins/highlightwindow/highlightwindow.cpp | grep local source |
| C13 | No Vulkan scene item renderer in 6.7.3 (renderers: `itemrenderer_opengl`, `itemrenderer_qpainter`) | local v6.7.3 source/headers | https://invent.kde.org/plasma/kwin/-/tree/v6.7.3/src/scene | ls local source/headers |
| C14 | Decoration API is `KDecoration3`; exposes `KDecoration3::BorderOutline` | installed header | https://invent.kde.org/plasma/kdecoration/-/blob/v6.7.3/src/decoration.h | ls local header |
| C15 | No change to border/outline scene files between `v6.7.3` and `v6.7.4` | local git diff | `git -C /tmp/opencode/kwin-6.7.4 diff v6.7.3 -- src/scene/outlinedborderitem.* src/scene/borderoutline.h src/scene/decorationitem.cpp src/scene/itemrenderer_qpainter.cpp` | empty diff |

The Invent URLs above are the canonical upstream locations for the cited paths;
content was verified against the local `v6.7.3` checkout, not re-fetched from
the web.

## Route 1: Built-in active-window / outline capability

- `KWin::Outline` (C11): draws a geometry outline via four windows or an effect,
  backed by a `QQmlComponent` (`OutlineVisual`). Used for snap/tile/edge
  previews, not tied to the active window, and is a QML helper rather than a
  native C++ effect border.
- `highlightwindow` effect (C12): the built-in highlight-windows feature
  (`Effect::Feature::HighlightWindows`). Dims/ghosts windows and animates
  opacity/saturation on demand; does not draw a persistent rectangular border.
- `diminactive` effect: dims inactive windows (inverse emphasis); no border.

Assessment per product criteria:

- Public/support: built-in and shipped, but none draws a persistent fixed
  rectangular border around the active window.
- Renderer/backend: `Outline` renders via QML overlay; `highlightwindow`/
  `diminactive` use the public `Effect` paint path (`EffectWindow` level,
  renderer-agnostic).
- SSD/CSD/Wayland/XWayland: `highlightwindow`/`diminactive` cover all window
  types; `Outline` is geometry-only.
- Direct scanout/fullscreen: they are effects; any active effect blocks direct
  scanout by default (C7).
- Ownership/resources: framework-managed; no custom shaders/textures.
- ABI/packaging: shipped upstream; nothing to package for this project.
- Testability: not reusable as a unit.
- Complexity/maintenance: minimal, but cannot express the required outcome.

Verdict: **available now, non-viable** for the product outcome (no reusable
persistent per-active-window border primitive).

## Route 2: KDecoration2 / decoration route

Current API is `KDecoration3` (C14); `KDecoration3::BorderOutline` exists and is
the decoration-side outline KWin consumes via `BorderOutline::from(...)` (C6). A
decoration plugin draws the server-side frame, including any theme border.

Assessment:

- Public/support: public KDecoration3 plugin API, actively used by SSD themes,
  but it is a decoration plugin, not a KWin `Effect`.
- Renderer/backend: decoration pixels are rendered by KWin's `DecorationItem`
  (atlas-based; GL and QPainter both handled by the atlas path).
- SSD/CSD/Wayland/XWayland: **SSD only**. CSD clients (GTK/Firefox/most non-KDE
  apps) draw their own frame; a decoration plugin cannot border them, including
  XWayland CSD clients.
- Direct scanout/fullscreen: decoration is part of the window surface; no
  special scanout interaction beyond normal compositing.
- Ownership/resources: `DecorationItem` internally owns an `OutlinedBorderItem`
  for its outline (C5); the atlas uses KWin-managed textures.
- ABI/packaging: needs a separate KDecoration3 plugin package plus user theme
  selection; violates the "one native KWin effect" constraint.
- Testability: decoration plugins testable standalone, but outcome tied to SSD
  theme selection.
- Complexity/maintenance: full decoration plugin is a larger surface than a
  single effect; wrong trigger model.

Verdict: **available now, non-viable** for the product outcome (not an effect;
SSD-only; cannot border CSD active windows).

## Route 3: Public KWin Effect APIs (`Effect`)

The product already uses this container (accepted `unit-01`): a `KWin::Effect`
subclass, `KWIN_EFFECT_FACTORY` factory, native plugin metadata (C7, C8).

- Public/support: public, the standard effect extension point. The old
  monolithic `kwineffects.h` is gone; the API is split across
  `effect/effect.h`, `effect/effectwindow.h`, `effect/effecthandler.h`.
- Chaining: `paintWindow`/`paintScreen`/`prePaint*`/`postPaintScreen` chain via
  the global `effects` handler; the effect must forward to preserve normal
  painting (documented in `effect.h`).
- Renderer/backend: `EffectWindow`-level API is renderer-agnostic; effects may
  also use OpenGL directly when `isOpenGLCompositing()` is true.
- SSD/CSD/Wayland/XWayland: `EffectWindow` covers all window types.
- Direct scanout/fullscreen: `Effect::blocksDirectScanout()` defaults to `true`
  (C7), so an enabled effect disables direct scanout of opaque fullscreen
  windows; `isActive()` (default true) controls per-frame participation.
- Ownership/resources: no mandatory resources; effects drawing manually must
  manage their own GL resources (excluded by spec).
- ABI/packaging: no binary-compatibility guarantee; the plugin must be built
  against the same `kwineffects` library as KWin (C8). Known ABI rebuild risk.
- Testability: logic in a plain class is unit-testable; painting is not.
- Complexity/maintenance: minimal container; the actual border must come from a
  scene item or manual painting.

Verdict: **available now, viable as the container** but not self-sufficient for
drawing the border (spec forbids manual painting; border needs Route 4).

## Route 4: `OutlinedBorderItem` / scene route

This is the sole scene exception the specification already mandates.

- Public/support: `KWIN_EXPORT KWin::OutlinedBorderItem` is exposed in the KWin
  headers (C1), built from an `innerRect` and a `BorderOutline`; KWin itself
  uses it for decoration outlines (C5). Its exported declaration establishes
  availability to a native plugin built against the same KWin, not a stable
  third-party scene-extension commitment (C8). LGPL-licensed (header SPDX).
- Mechanism: `buildQuads()` emits up to 8 rectangles (4 corner squares when
  radius > 0, plus top/bottom/left/right edge bars) forming the frame (C2). The
  OpenGL renderer draws it with the built-in `ShaderTrait::Border` shader
  (rounded border box) (C3) - no custom shader or texture.
- Attachment/lifetime (critical): `Item::addChild(...)` is private, so an effect
  cannot attach an existing item through that API. `OutlinedBorderItem` can be
  constructed with a visual-parent `Item *` (C1, C10), but the observed KWin
  decoration code creates and retains its child with `std::unique_ptr` (C5).
  The inspected API provides no framework factory or effect-owned attachment
  slot. Thus a persistent effect-created item needs an ownership/lifetime design
  that the existing product constraints prohibit; visual parenting alone is not
  evidence of QObject ownership. `setVisible(bool)` and `setZ(int)` are public
  controls once an item exists.
- Renderer/backend coverage (critical): **OpenGL only in 6.7.3**. The QPainter
  item renderer has no `OutlinedBorderItem` handling (C4), so the border is not
  rendered under software/QPainter compositing. There is no Vulkan scene item
  renderer in 6.7.3 (C13); renderers are `itemrenderer_opengl` and
  `itemrenderer_qpainter` only. QPainter/Vulkan coverage is an
  **unknown/unsupported gap for 6.7.3**, not an assumption.
- SSD/CSD/Wayland/XWayland: a scene item parented to a window item appears
  window-type agnostic, but this research did not establish a supported effect
  lifecycle attachment for each window type. Coverage remains unproven pending
  a supported ownership route.
- Direct scanout/fullscreen: spec suppresses the border for fullscreen windows;
  the effect still blocks direct scanout while enabled (C7). No other fullscreen
  interaction.
- Ownership/resources/shaders/textures: the built-in border shader and item
  geometry are KWin resources, so no custom shader or texture is needed. The
  item itself is not shown to be framework-created for an effect; the required
  ownership is the unresolved constraint conflict.
- ABI/packaging: same as Route 3 (native plugin, ABI rebuild risk).
- Testability: eligibility logic unit-testable; `buildQuads` geometry is
  framework code (already exercised upstream).
- Complexity/maintenance: lowest-complexity drawing primitive, but it has a
  lifecycle/API-boundary risk rather than an established one-attachment route.

Verdict: **available now as an internal/exposed drawing primitive, but not
established as viable under the current no-manual-lifetime product constraint**.
Its concrete gaps are effect-item ownership/API support and OpenGL-only
renderer coverage. This is evidence for `research-03`, not a route decision.

## Route 5: Qt Quick / effect route

- `QuickSceneEffect` + `QuickSceneView` + `OffscreenQuickView` (C9) provide
  fullscreen QtQuick effects (QML `delegate`); the same machinery behind
  `SceneEffect` (KPackage declarative effects). `QuickSceneEffect` overrides
  `blocksDirectScanout()` and `isActive()`.
- Public/support: genuinely supported upstream; used by built-in effects
  (overview, logout, etc.).
- Renderer/backend: QML rendered through KWin's QML rendering path.
- SSD/CSD/Wayland/XWayland: fullscreen per-output overlay, not a per-window
  border; a border would have to be authored in QML.
- Ownership/resources: QML scene graph owned by the effect; `QuickSceneEffect`
  holds `std::unique_ptr<QuickSceneEffectPrivate>` internally.
- ABI/packaging: declarative form requires a KPackage; the C++ form is a native
  plugin. Spec excludes both `SceneEffect` and `kwin/contents/code/main.js`.
- Testability: QML UI testable; higher surface.
- Complexity/maintenance: heavier; brings QML assets and a different lifecycle.

Verdict: **available now, genuinely supported, but excluded by the
specification** (declarative `SceneEffect`/QML is a non-goal). Not a native C++
border route.

## Route 6: Renderer-specific routes (GL / Vulkan / QPainter)

- OpenGL: effects can use `ShaderManager`, `GLTexture`, `GLVertexBuffer`
  (headers under `opengl/`) when `isOpenGLCompositing()` is true. Requires
  custom shaders/textures and manual GL ownership - all excluded by spec
  non-goals. **Available now, excluded by specification.**
- Vulkan: no Vulkan scene item renderer in 6.7.3 (C13); `vulkan/` headers
  (`vulkan_swapchain.h`, `vulkan_texture.h`, `vulkan_device.h`) support Vulkan
  presentation/swapchain helpers, not a full effect rendering backend. A Vulkan
  effect route is **future/upstream-only (not available in 6.7.3)**; its status
  in mainline beyond 6.7.4 was not authoritatively established here and is
  marked unknown.
- QPainter: software compositing is supported (`attemptQPainterCompositing` in
  `compositor.h`), but `OutlinedBorderItem` has no QPainter rendering path (C4).
  A QPainter border would require manual painting, which the spec excludes.
  **Available now as a backend, non-viable for this product.**

## Route 7: Upstream direction newer than installed 6.7.3

- Newest release branch checked: `v6.7.4` (2026-08-04). A diff of the
  border/outline scene files (`outlinedborderitem.*`, `borderoutline.h`,
  `decorationitem.cpp`, `itemrenderer_qpainter.cpp`) against `v6.7.3` is empty
  (C15). No authoritative evidence of a change to this area in the newest
  release branch.
- Vulkan scene rendering and any future QPainter `OutlinedBorderItem` support
  are **unknown** without authoritative mainline evidence; not asserted here.

## Coverage Matrix

Legend: Y = yes, N = no, ? = unknown/not authoritatively established.

| Route | Public/supported | GL | QPainter | Vulkan | SSD | CSD | XWayland | Direct-scanout safe | Meets outcome |
|---|---|---|---|---|---|---|---|---|---|
| 1 Built-in outline/highlight | Y (built-in) | Y | Y | ? | Y | Y | Y | N (blocks) | N |
| 2 KDecoration3 decoration | Y | Y | Y | ? | Y | N | N (CSD) | ? | N |
| 3 Public `Effect` API (container) | Y | Y | Y | ? | Y | Y | Y | N (blocks by default) | partial (no drawing) |
| 4 `OutlinedBorderItem` scene item | exposed, ABI-bound | Y | N | ? | ? | ? | ? | N (blocks by default) | N under current lifetime constraint |
| 5 Qt Quick / `QuickSceneEffect` | Y | Y | Y | ? | overlay | overlay | overlay | N (overrides to block) | excluded by spec |
| 6a GL manual | Y | Y | N | N | Y | Y | Y | N | excluded by spec |
| 6b Vulkan | N (6.7.3) | N | N | ? | ? | ? | ? | ? | N (not available) |
| 6c QPainter manual | Y | N | Y | N | Y | Y | Y | N | excluded by spec |

Unknowns (not asserted): Vulkan scene rendering status in 6.7.3 and in mainline
beyond 6.7.4; whether `OutlinedBorderItem` gains a QPainter or Vulkan path in
future upstream releases.

## Key Findings

1. `KWin::OutlinedBorderItem` draws the required thin rectangular frame and is
   already used by KWin for decoration outlines (C1, C5). The inspected API does
   not establish a framework-managed, effect-created lifetime route; its only
   observed owner is KWin decoration code using `std::unique_ptr` (C5, C10).
2. It renders only under OpenGL in 6.7.3; there is no QPainter or Vulkan
   rendering path for it (C3, C4, C13). This is the main coverage gap and must
   not be assumed away.
3. A pure public-`Effect` route cannot draw the border without either the scene
   item (Route 4) or manual painting that the spec excludes (Route 3).
4. KDecoration3, built-in outline/highlight, and Qt Quick routes are available
   now but non-viable or excluded for this product's outcome (Routes 1, 2, 5).
   The exposed scene-item route also conflicts with the current lifetime
   constraint until authoritative supported attachment evidence exists.
5. No authoritative evidence of a change in this area in the newest release
   branch `v6.7.4`; Vulkan scene rendering is future/unknown (C15).

## research-02 - Ecosystem Reuse Options

Research for `research-02`. Scope: mature third-party effects, dependencies,
and reusable libraries relevant to the active-window border. Access date for
all citations: 2026-08-15. Findings are recorded; no final option is
recommended or selected.

### Source Map

| # | Claim anchor | Source | URL | Verified |
|---|---|---|---|---|
| E1 | KDE-Rounded-Corners: native C++ `Effect`, GPL-3.0, rounds corners + adds outline via GLSL shaders | GitHub repo | https://github.com/matinlotfali/KDE-Rounded-Corners | fetched 2026-08-15 |
| E2 | KDE-Rounded-Corners v0.9.0 (2026-06-06); 6.7 core-profile shader fix PR #515 (2026-06-25) | GitHub releases/PR | https://github.com/matinlotfali/KDE-Rounded-Corners/releases ; https://github.com/matinlotfali/KDE-Rounded-Corners/pull/515 | fetched 2026-08-15 |
| E3 | "After each KWin package update, the effect becomes incompatible. So it won't load without a rebuild." | README | https://github.com/matinlotfali/KDE-Rounded-Corners | fetched 2026-08-15 |
| E4 | Upstreaming request open: issue #198; MR !6024 (2024-07) | Invent/GitLab | https://invent.kde.org/plasma/kwin/-/issues/198 ; https://invent.kde.org/plasma/kwin/-/merge_requests/6024 | fetched 2026-08-15 |
| E5 | LightlyShaders: GPL-2.0-or-later; `plasma6` branch WIP ("may crash"); v3.0.0 (2025-02-18); shader shaping + bundled patched Blur | GitHub / AUR | https://github.com/a-parhom/LightlyShaders ; https://aur.archlinux.org/packages/lightlyshaders-git | fetched 2026-08-15 |
| E6 | ShapeCorners (ancestor) abandoned; last activity a Plasma 5.21 compile-failure ticket | SourceForge | https://sourceforge.net/p/shapecorners/tickets/7/ | fetched 2026-08-15 |
| E7 | Klassy: fork of KDE Breeze; v6.5.3 (2026-02-21); requires Plasma 6.3+ | GitHub | https://github.com/paulmcauley/klassy | fetched 2026-08-15 |
| E8 | Plasma 6.3 KDecoration2 -> KDecoration3 API break disabled unported decorations | Klassy issue #163 / PR #178 | https://github.com/paulmcauley/klassy/issues/163 ; https://github.com/paulmcauley/klassy/pull/178 | fetched 2026-08-15 |
| E9 | SierraBreezeEnhanced: GPL-3; community-ported to Plasma 6 and 6.3 | GitHub / AUR | https://github.com/kupiqu/SierraBreezeEnhanced ; https://aur.archlinux.org/packages/kwin-decoration-sierra-breeze-enhanced-git | fetched 2026-08-15 |
| E10 | Public QML effects: `SceneEffect`/`QuickSceneEffect`/`WindowThumbnail`; KPackage `KWin/Effect` | develop.kde.org | https://develop.kde.org/docs/plasma/kwineffect/ ; https://develop.kde.org/docs/plasma/kwin/api/ | fetched 2026-08-15 |
| E11 | Window-management scripts expose no painting API; effect scripts have a separate painting API | develop.kde.org | https://develop.kde.org/docs/plasma/kwin/ | fetched 2026-08-15 |
| E12 | C++ effects are "a distribution nightmare"; libkwin breaks ABI/API each release; Plasma 6 added KPackage QML effects to fix | Vlad Zahorodnii blog | https://blog.vladzahorodnii.com/2024/03/18/how-to-write-a-qml-effect-for-kwin/ | fetched 2026-08-15 |
| E13 | Effect plugin "not providing binary compatibility ... compiled against the same kwineffects library version as KWin" | api.kde.org | https://api.kde.org/kwin-effect.html | fetched 2026-08-15 |
| E14 | `libkwineffects` merged into `libkwin`; binary effects recompiled every release | KDE/kwin commit | https://github.com/KDE/kwin/commit/d7b1661e080db48d1b8211562e5e86c585e065dc | fetched 2026-08-15 |
| E15 | `WindowHeap` helper is private/unstable API | develop.kde.org | https://develop.kde.org/docs/plasma/kwineffect/ | fetched 2026-08-15 |

### Ecosystem 1: Native third-party rounded-corner / outline effects

- `matinlotfali/KDE-Rounded-Corners` ("ShapeCorners" effect) - the dominant
  maintained example (E1). License GPL-3.0. Latest release v0.9.0 (2026-06-06);
  23 releases; ~40 contributors; last push 2026-06-06 (E2). Compatible with
  Plasma 5.27-6.6+, with a 6.7 core-profile shader fix (PR #515, 2026-06-25)
  (E2).
  - Mechanism: native C++ `Effect` subclass that draws the rounded frame and
    outline with custom GLSL fragment shaders (legacy + core profile), inspired
    by KWin's `invert` effect. It does not use the `OutlinedBorderItem` scene
    item; the outline is shader-painted. Build deps include `kwin-dev`,
    `qt6-base-private-dev`, `libdrm-dev`, KCMUtils (E1).
  - Renderer: OpenGL-only, custom shaders + manual GL resource handling -
    excluded by the spec non-goals. SSD/CSD/Wayland/XWayland: window-type
    agnostic in principle (effect level), but CSD/XWayland coverage is not
    independently documented.
  - ABI/build: "After each KWin package update, the effect becomes
    incompatible. So it won't load without a rebuild" (E3); ships an
    auto-rebuild autorun script; tracks the 6.4 split-codebase change
    (PR #383).
  - Health/tests: actively maintained and widely packaged (COPR/AUR/.deb);
    security posture not audited here; no public CI/test claims established.
  - Reuse feasibility: copying its technique imports custom shaders, manual GL
    ownership, private-API version guards, and GPL-3.0 copyleft. It removes no
    C++/renderer/lifetime complexity and imports a larger fragile stack.
- `a-parhom/LightlyShaders` (E5). License GPL-2.0-or-later. Latest release
  v3.0.0 (2025-02-18); `plasma6` branch self-described "work in progress...
  may crash... may not compile". Shader-based window shaping; also bundles a
  forked/patched KWin Blur effect + `lshelper` library for the "korner bug";
  relies on decoration-side corner-radius fixes.
  - Verdict: **abandoned/lagging and fragile for Plasma 6**; experimental
    Plasma 6 support plus patched-blur bundling imports a larger fragile stack.
    Explicitly incompatible with current product constraints.
- `ShapeCorners` (original, SourceForge) (E6): ancestor of both; abandoned;
  last activity a Plasma 5.21 compile-failure ticket; no Plasma 6 support.
  **Abandoned/incompatible.**

### Ecosystem 2: KDecoration2 / KDecoration3 decoration plugins

- `paulmcauley/klassy` (E7). Fork of KDE Breeze; license GPL (Breeze base is
  GPL-2.0-or-later; not independently re-verified here). Latest release v6.5.3
  (2026-02-21); requires Plasma 6.3+; default branch `plasma6.3`. Active
  (~100 contributors), with a maintenance gap during the Plasma 6.3 break.
- `kupiqu/SierraBreezeEnhanced` (E9). License GPL-3. Community-ported to Plasma
  6 and 6.3 (ChangeLog V2.0.0; AUR "works now with Plasma 6.3", 2025-02-24).
- Key ecosystem fact: **Plasma 6.3 switched from KDecoration2 to
  KDecoration3**, a source/ABI break that disabled every unported KDecoration2
  decoration (E8). This documents the same ABI-break risk this project already
  accepts for native plugins.
- Mechanism: both are KDecoration3 server-side-decoration plugins. SSD only;
  they cannot border CSD clients (GTK/Firefox/non-Qt), including XWayland CSD.
  Not a KWin `Effect`. Verdict: **wrong mechanism for the product**; reuse does
  not reduce effect-side C++ complexity.

### Ecosystem 3: KWin scripts / QML overlays

- Declarative QML effects (`SceneEffect`, `QuickSceneEffect`,
  `WindowThumbnail`, `org.kde.kwin`) are public and KPackage-distributable
  (`KPackageStructure: KWin/Effect`, installed via `kpackagetool6`) (E10).
  Introduced in Plasma 6 precisely to avoid the C++ ABI "distribution
  nightmare" (E12).
- Window-management scripts (JS/QML under `kwin/scripts/`) can read
  `workspace.activeWindow` and geometry but expose **no painting API**;
  painting lives in the separate effect-script API (`effect`/`effects`) (E11).
  A per-active-window border is not expressible as a window-management script.
- A QML-effect border requires a fullscreen `SceneEffect`/`QuickSceneEffect`
  overlay or `WindowThumbnail` composition, not a per-window native border.
  `WindowHeap` (the only per-window helper) is documented private/unstable
  (E15). Verdict: public and ABI-stable, but **excluded by the spec**
  (declarative `SceneEffect`/QML is a non-goal) and wrong shape for a thin
  per-window frame.

### Ecosystem 4: Qt/KDE rendering libraries

- No reusable compositor-level border primitive exists outside KWin's own
  scene/decoration code (covered by research-01). Qt (QPainter, Qt Quick scene
  graph) and KF6 (Kirigami, Plasma `FrameSvg`) are application/toolkit-level
  renderers; they compose into the KWin scene only through the effect/scene
  APIs already analyzed. No standalone library draws a per-window compositor
  border without re-entering the KWin effect or decoration API. Nothing here
  removes C++/renderer/lifetime complexity.

### ABI / packaging / supply-chain cross-cutting evidence

- Effect plugin binary compatibility: "This API is not providing binary
  compatibility and thus the effect plugin must be compiled against the same
  kwineffects library version as KWin" (E13). `libkwineffects` was merged into
  `libkwin`, so binary effects must be recompiled every KWin release (E14) -
  consistent with research-01 (C8) and the decisions.md ABI risk.
- Licenses: KDE-Rounded-Corners GPL-3.0; LightlyShaders GPL-2.0-or-later;
  SierraBreezeEnhanced GPL-3; Klassy Breeze-derived GPL. All copyleft. Reusing
  their code would impose GPL terms on this native plugin, in contrast to
  KWin's own LGPL headers. License-compatibility and supply-chain concern, not
  a recommendation.
- Every mature native third-party effect exists because upstream KWin has not
  shipped a rounded/outline primitive (E4), and all implement it with custom
  shaders rather than a reusable public border API - confirming the research-01
  finding that the exposed `OutlinedBorderItem` route is not the
  battle-tested ecosystem technique. No candidate removes the effect-side
  C++/renderer/lifetime complexity; each either is the wrong mechanism
  (decoration, script), excluded by spec (QML, custom shaders), or imports a
   larger fragile stack (LightlyShaders, KDE-Rounded-Corners technique).

## research-03 - Synthesis And Recommendation

Research for `research-03`. Scope: compare `research-01` (C1-C15) and
`research-02` (E1-E15) against the product and governance criteria, reject
unsupported or high-risk options, and recommend a route plus a bounded user
decision. Access date 2026-08-15. No route is selected; this is a
recommendation, not approval.

### Core distinction

Two different claims are being conflated in the phrase "public/supported":

- **Battle-hardened component**: code KWin runs in production, e.g. the
  decoration `OutlinedBorderItem` usage (C5), the built-in `ShaderTrait::Border`
  shader (C3), and `highlightwindow` (C12). This proves the component *works*,
  not that third parties may rely on it as a versioned extension.
- **Supported extension API**: a documented, versioned surface plugins can
  depend on. KWin's effect plugin ABI has *no binary-compatibility guarantee*
  (C8, E13, E14) and there is no framework-owned effect-attachment factory for
  `OutlinedBorderItem` (C10). `KWIN_EXPORT` (C1) is symbol visibility, not an
  extension-API stability commitment.

Conclusion: `OutlinedBorderItem` is a battle-hardened *component*, not a
supported *extension API*. Neither research unit establishes a stable
third-party attachment route. This is a finding, not a recommendation.

### Option matrix

Legend: G = good, A = acceptable/partial, P = poor, X = excluded/unusable,
? = unknown/not authoritatively established.

| # | Option | Product coverage | Public/support | Renderer/future | SSD/CSD/XW | Ownership safety | Deps/license | ABI/packaging | Tests | C++ surface | Maturity | Live-risk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Upstream built-in / transient outline (Route 1) | X | G | G | G | G | G | G | P | G | G | G |
| 2 | KDecoration3 decoration (Route 2) | X | G | G | P (SSD only) | G | G | P | A | P | G | G |
| 3 | Native `Effect` + `OutlinedBorderItem` (Route 4) | A (GL only) | P | P (GL only) | ? (inference) | P (no factory) | G | P | A | G | G | A |
| 4 | Dual renderer-specific native paths (Route 6a+6c) | A | G | G (no Vulkan) | G | X (manual) | G | P | A | P | G | A |
| 5 | Custom shader native effect (r-02 technique) | A (GL only) | P | P (GL only) | ? | X (manual) | P (GPL) | P | P | P | A | P |
| 6 | Qt Quick / QML scene route (Route 5) | A | G | A (? non-GL) | P (overlay) | G | G | A | A | P | G | A |
| 7 | External effects/themes/libraries (r-02) | X | mixed | P | mixed | X | P (GPL) | P | P | P | mixed | P |
| 8 | Upstream contribution / wait (Route 7) | X now / A later | A | A (later) | A | G | G | G | A | G | n/a | G |

Per-option judgements:

1. **Upstream built-in / transient outline** (C11, C12). Available now, zero
   C++/dependency, renderer-agnostic at `EffectWindow` level, but no persistent
   rectangular border primitive exists. Non-viable for the outcome; only a
   reference for "highlight active window" behavior.
2. **KDecoration3 decoration** (C14, C6, E7-E9). Public and battle-hardened
   (atlas renders GL and QPainter), but SSD-only and a decoration plugin, not an
   effect. Cannot border CSD/XWayland clients. Wrong mechanism.
3. **Native `Effect` + `OutlinedBorderItem`** (C1-C8, C10). Lowest C++ surface,
   no custom shader/texture, no dependency, thin native frame, exactly the
   mechanism KWin uses internally (C5). Blocked by two evidenced gaps: no
   framework attachment factory (C10) and OpenGL-only rendering (C3/C4/C13).
4. **Dual renderer-specific native paths** (Route 6a/6c). Full coverage in
   principle but requires manual GL/QPainter ownership and custom shaders -
   all spec non-goals. Excluded.
5. **Custom shader native effect** (E1-E6). The dominant ecosystem technique;
   GPL-3.0, OpenGL-only, rebuild-sensitive, private-API version guards. Imports
   a larger fragile stack and copyleft. Excluded.
6. **Qt Quick / QML scene route** (C9, E10-E12). Public and packaged, and it
   avoids the native C++ ABI distribution burden (Plasma 6 added QML effects for
   that reason, E12). But it is a fullscreen per-output overlay, not a per-window
   native frame, so it cannot establish the required outcome; it is a heavier
   QML+asset surface and a spec non-goal. Its stability claim is limited to
   avoiding the native C++ ABI rebuild (E12); product suitability is inadequate.
   Non-GL coverage unknown.
7. **External effects/themes/libraries** (E1-E15). No candidate is a drop-in
   reusable border primitive; each is the wrong mechanism, spec-excluded, or a
   fragile shader stack. Removes no constraint.
8. **Upstream contribution / wait** (Route 7, E4). No immediate product; no
   feature is delivered now. It is the only forward-compatible path: a supported
   backend-portable per-window border/attachment API would be maintained upstream
   and impose zero project C++. E4 shows a rounding/outline upstreaming request
   already open (issue #198, MR !6024) - context only, no timeline.

### Recommendation

**Primary: Option 8 - pursue/await an upstream supported, backend-portable
per-window border/attachment API.** The synthesis establishes no current route
is a supported extension API: `OutlinedBorderItem` is a battle-hardened
component with no documented effect attachment factory (C10), unproven
effect-owned lifetime, and OpenGL-only rendering (C3/C4/C13). The only route
that is forward-compatible, minimal-project-C++, and lowest-maintenance is to
not resume native implementation now and instead pursue or await upstream
support (E4). It delivers no immediate feature and requires explicit user
product approval to accept deferred delivery.

**Fallback: Option 3 - an explicitly user-approved, OpenGL-only native
experimental route** using an effect-owned `std::unique_ptr<OutlinedBorderItem>`
(C5). It may proceed only after all of the following: the governance/spec
changes below are approved; effect-owned child lifetime is verified against
evidence; capability gating and unsupported-renderer behavior are specified;
the native ABI/rebuild risk (C8, E13, E14) is accepted; and user-live evidence
is obtained. It is a constrained fallback, not a resolution of the API gap, and
must not be described as clean, supported, stable, or framework-managed.

**Why QML (Option 6) is not the primary fallback:** it is public and packaged
and avoids the native C++ ABI distribution burden (E12), but its geometry model
is a fullscreen per-output overlay and it cannot establish the per-window native
frame outcome. Product suitability is inadequate, not merely a surface concern.

**Dependency decision: add no dependency.** Neither route needs an external
library; no GPL import (E1-E9) is justified.

Options 1, 2, 4, 5, and 7 are not recommended: non-viable, wrong mechanism,
spec-excluded, or fragile/GPL.

### Governance/spec changes required before the fallback may proceed

These are exact required edits for the Option 3 fallback, proposed for user
approval; none is made here. They do not apply to the primary Option 8 path.

1. `spec.md` Scope and Constraints And Decisions: replace "one
   framework-managed `KWin::OutlinedBorderItem` scene attachment" with
   "one effect-owned `KWin::OutlinedBorderItem` scene attachment" - the
   inspected API provides no framework attachment factory (C10); the only
   observed owner pattern is KWin decoration's `std::unique_ptr` (C5).
2. `spec.md` Non-Goals: relax "manual ownership / raw owning pointers /
   `new`/`delete`" to permit exactly one effect-owned
   `std::unique_ptr<OutlinedBorderItem>` (created via `std::make_unique`); keep
   custom shaders, manual GL ownership, and QPainter rendering as non-goals.
3. `spec.md` Constraints And Decisions: add capability gating - enable and show
   the border only when `isOpenGLCompositing()` is true (public `Effect` query,
   Route 3/6a); otherwise the effect is inactive and draws nothing.
4. `spec.md` Acceptance Criteria: reword #2 to effect-owned, and add "no border
   is shown under non-OpenGL compositing."

### Capability gating and unsupported-renderer behavior (fallback)

- Gate on `isOpenGLCompositing()`. Under QPainter (C4) or a future Vulkan
  renderer (C13), `OutlinedBorderItem` has no rendering path, so the effect must
  not attach or show the border.
- Unsupported-renderer behavior: effect remains loaded but inactive; no border,
  no artifacts, normal scene painting unaffected. No fallback drawing is added
  (QPainter manual painting is a spec non-goal).
- Direct scanout: `Effect::blocksDirectScanout()` defaults to `true` (C7), so an
  enabled effect disables direct scanout regardless of gating; this is existing,
  documented behavior.

### What remains user-live evidence (fallback)

Visible border on the eligible active window; repaint on activate/resize/
minimize/fullscreen/close; no border for absent/deleted/minimized/fullscreen
active windows; normal scene painting preserved; no border under software
(QPainter) compositing; direct-scanout of opaque fullscreen now blocked while
the effect is enabled.

### Required user decisions

1. Accept the primary Option 8 path, i.e. defer any feature until upstream
   provides a supported backend-portable per-window border/attachment API, or
   reject it in favour of the fallback.
2. If the fallback is chosen, approve each governance/spec change above and the
   constrained OpenGL-only experimental scope.
3. Confirm no external dependency is added.

### Unanswered facts and confidence

- OpenGL-only rendering of `OutlinedBorderItem` in 6.7.x: evidence (C3/C4/C13),
  high confidence.
- No framework attachment factory for effects: evidence (C10), high confidence;
  "no factory exists anywhere" is inference from inspected headers, medium-high.
- Effect-owned `std::unique_ptr` child lifetime across all window types is
  unproven; it is inferred from the decoration pattern (C5), whose lifetime
  differs from an effect window's. Medium confidence.
- Whether `OutlinedBorderItem` gains a QPainter or Vulkan path in future
  upstream: unknown (C15 shows no 6.7.3 to 6.7.4 change), high uncertainty.
- QML route non-GL renderer coverage: unknown.
- Whether the "framework-managed" reading permits effect-owned
  `std::unique_ptr`: a governance decision, not an evidence
  question.

## research-05 - Joint Border And Grouped-Window Synthesis

Research for `research-05`. Scope: joint synthesis of the accepted border
evidence (`research-01`..`research-03`, anchors C1-C15, E1-E15) and the accepted
grouped evidence (`research-04a`/`04b`, anchors G1-G6, W1-W6, B1-B22). Detailed
group matrices remain in `grouped-window-options.md`; detailed border matrices
remain above. Access date 2026-08-15. No route is selected; this is a
recommendation, not approval. No group gesture, shortcut, binding, header
carrier, control, or interaction semantic is selected.

### Shared carrier versus separate carriers

The two outcomes are different kinds of thing:

- Active-border = non-interactive, thin, fixed frame around one existing
  window. Evidence: `OutlinedBorderItem` is a scene item that paints a border
  and has no input surface (C1, C2, C3); it is OpenGL-only (C3, C4, C13) with
  no supported effect attachment factory (C10).
- Grouped presentation = an interactive, compositor-owned container with shared
  geometry, focus, stacking, visibility, per-window hit testing, and a header
  input surface. Evidence: no such container or public API exists in KWin 6.7.3
  (G1-G4); effect input interception is effect-global, not per-window-region
  hit testing (G5); reference compositors own grouping as a first-class
  layout/scene object (B1-B4, B7-B9, B10-B13).

Decision: **separate carriers**. Sharing a carrier would couple non-interactive
painting to an interactive compositor-owned group lifecycle and does not reduce
complexity:

- The border primitive provides none of the group carrier's requirements
  (input, hit testing, focus/stacking/visibility, shared geometry). A shared
  carrier would still have to build all of those from effect-level interception
  (G5), which is the hard, unowned part - so sharing removes none of the cost.
- Conversely the group's constraints (interactive, input-bearing) would, if
  shared, drag the border into a lifecycle and input surface it does not need,
  worsening the border's already-poor ownership/attachment posture (C10) and
  its OpenGL-only coverage (C3/C4/C13).
- The reference-compositor lesson is that presentation is compositor-owned and
  members are forced undecorated / hidden (B2, B7, B11). A thin per-window
  border is not that presentation model; conflation is an inference risk, not a
  simplification.

The border stays a minimal painting concern; the group is a future
compositor-owned interactive concern. They are evaluated and recommended
separately below.

### Joint option evaluation

| # | Route | Border outcome | Group outcome | Verdict |
|---|---|---|---|---|
| 1 | Upstream-supported API / core contribution | backend-portable border/attachment API (E4 context) | compositor-owned group container + header surface | **primary**, no immediate delivery |
| 2 | Independent minimal experimental `OutlinedBorderItem` border; groups parked | OpenGL-only experimental border (C1-C10) | none now; group still blocked | **bounded fallback** |
| 3 | One shared native effect / Qt Quick carrier with controller bridge | inherits GL-only + no-attachment limits (C10, C3/C4/C13) | wrong shape: fullscreen overlay or private-API scene, no input carrier (C9, E15, G5) | **non-recommended** (couples incompatible concerns) |
| 4 | KDecoration common surface | SSD-only, not an effect (C14, Route 2) | SSD-only, no tab API, no group model (W4, G4) | **non-recommended** (cannot cover CSD peers) |
| 5 | External dependency route | no reusable border primitive (E1-E15) | no dependency supplies group ownership (B20-B22) | **non-recommended** |
| 6 | Deferral without engagement | nothing now | nothing now | **non-recommended** as a passive default; active engagement (route 1) is preferred |

### Recommendation

**Primary: separate upstream-supported surfaces, engaged actively, with
deferral of implementation.** Two different upstream needs, one engagement
posture: (a) a backend-portable per-window border/attachment API - the
`research-03` primary, unchanged; (b) a compositor-owned group container with a
header presentation and input surface - the capability KWin 6.7.3 demonstrably
lacks (G1-G4, B1-B13). Both require compositor ownership and stable extension
APIs; neither exists today. Sharing one carrier is rejected (above), so the
recommended path is two separate upstream tracks, not one shared API.

**Bounded fallback: independent minimal experimental `OutlinedBorderItem`
border while groups are parked and upstream is engaged.** This is the
`research-03` fallback unchanged: an explicitly user-approved, OpenGL-only
effect-owned border (C5) after the recorded governance/spec changes, lifetime
evidence, and capability gating. It does not and cannot seed a group carrier
(`OutlinedBorderItem` has no input/hit-test surface, C1-C3, G5), so it adds no
group scope.

**Explicit non-recommendations:** one shared native effect/Qt Quick carrier
(route 3); KDecoration common surface (route 4); any external dependency
(route 5); passive deferral without upstream engagement (route 6). Also
non-recommended as group carriers: KWin scripts (geometry-only, no paint or
hit-test, E11, B15-B19) and layer-shell/foreign-toplevel (panel/taskbar
surfaces, not group ownership, B20-B22).

**Dependency decision: add no dependency now.** Neither track needs an external
library; no GPL import (E1-E9) is justified, and no examined dependency
supplies group ownership (B20-B22).

### Sequencing and gates

Before active-border delivery, the following may proceed (no new evidence
gate): drafting and filing upstream engagement (see below), the
product/governance decisions listed below, and the independent experimental
border fallback if separately approved. The active-border implementation route
itself stays blocked on the user's border-route decision.

The user-run multi-window Custom Tile stability proof remains **necessary but
not sufficient** for grouped-window design or implementation. It can establish
only live geometry/co-management behavior - the exact facts `research-04a`
section 7 lists. It cannot establish compositor ownership, a painted header
carrier, or per-window hit testing, because those capabilities do not exist in
KWin 6.7.3 (G1-G4, G5) and are upstream work. The proof gates the *Custom Tile
integration* claim, not the missing upstream container; a passing proof does
not unblock grouped-window implementation on its own.

### Upstream engagement path (recommended)

1. Border track: pursue the existing rounding/outline upstreaming request
   (issue #198 / MR !6024, E4) or file a scoped companion requesting a
   backend-portable (GL/QPainter, and Vulkan when it lands) per-window
   border/attachment API, distinct from the interactive group surface.
2. Group track: file a scoped upstream feature request for a compositor-owned
   group/tab container and header surface, referencing the 2019 removal and its
   CSD rationale (W1, W3) and the reference-compositor ownership model (B1-B13).
3. Keep the two tracks separate and unblocked by each other; do not tie the
   border API to the group container.

Local prototype path: only the independent experimental border (the fallback)
is a realistic local prototype, and only if separately approved and only under
the `research-03` governance/spec changes and capability gating. There is no
realistic local group-header prototype on KWin 6.7.3: no public container,
paint, or hit-test surface exists (G1-G5, E11, B15-B19).

### Required user product/governance decisions

1. Accept the border primary (defer for an upstream supported border/attachment
   API with active engagement) or approve the OpenGL-only experimental fallback.
2. If the fallback: approve each exact `research-03` spec/governance change
   (effect-owned `std::unique_ptr` wording, non-goal relaxation, capability
   gating, acceptance-criteria reword) and confirm `unit-02` may resume.
3. Confirm no external dependency is added now.
4. Confirm whether to pursue the two separate upstream tracks (border API and
   group container) - the recommended posture - or decline active engagement.
5. Confirm grouped-window design/implementation remains deferred behind
   active-border delivery and the (necessary, not sufficient) user-run
   multi-window Custom Tile stability proof.

### Spec/plan consequences

- No spec edit is required by the primary path. The fallback requires the exact
  `research-03` spec/governance edits (listed above) before `unit-02` resumes.
- A future grouped-window change is not specified here and must not be added to
  the active-border spec; it would be a separate change, gated by active-border
  delivery and the stability proof.
- Plan: after the user's decision, `unit-02` either resumes (fallback) or the
  route decision is recorded as deferred and implementation stays paused
  (primary). No new work unit is added by this synthesis.

### Evidence gates

- Static: the retained `unit-02` diff and the cited research in these two files
  remain the sole static evidence; this synthesis adds no new primary-source
  claims and reuses anchors C*, E*, G*, W*, B*.
- Live: user-run active-border acceptance (visible border, repaint, suppression,
  normal scene, no border under QPainter, direct-scanout blocked) for the
  fallback; the user-run multi-window Custom Tile stability proof as a
  necessary-but-not-sufficient gate for any group work.

### Confidence and residual unknowns

- Shared carrier is improper coupling: high confidence, grounded in the
  divergent requirements above (C1-C3 vs G5) and reference-compositor ownership
  (B1-B13). It is a synthesis judgement, not a new source claim.
- No KWin group container or per-window hit-test surface in 6.7.3: high
  confidence (G1-G5).
- Border OpenGL-only, no effect attachment factory: high confidence (C3/C4/C10,
  C13); unchanged.
- Whether `OutlinedBorderItem` gains QPainter/Vulkan paths, and any upstream
  timeline for either track: unknown (C15; E4 is context only).
- Fallback effect-owned lifetime across window types remains unproven (medium
  confidence, C5 pattern only), as recorded in `research-03`.

The accepted border evidence and `research-03` recommendation are preserved
unchanged; the joint evidence requires no revision to them, only the separation
and sequencing stated here. Detailed grouped evidence and matrices remain in
`grouped-window-options.md`.
