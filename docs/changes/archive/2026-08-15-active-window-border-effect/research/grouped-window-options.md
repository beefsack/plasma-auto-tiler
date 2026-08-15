# Grouped/Tabbed Window Presentation And Input-Carrier Options

Research for `research-04a`. Scope: authoritative current and historical KWin
core tabbing/group architecture, public and internal boundaries, KDecoration,
effect and Qt Quick scene carriers, controller-to-carrier communication,
renderer/backend constraints, and upstream direction. Findings are recorded; no
group gesture, binding, header carrier, interaction model, or implementation is
selected.

- Access date for all citations: 2026-08-15.
- Installed host: KWin `6.7.3` (per accepted `research/rendering-options.md`);
  local pinned checkout `/tmp/opencode/kwin-pinned` at `v6.7.3` (commit
  `45ec9a6d0ed312a803ff5658a2a3e61f221566c6`). Content below verified against
  that checkout where marked "local", not re-fetched from the web.
- Blogs are used only as non-authoritative leads; KDE bug/phabricator/GitLab
  records are the evidence.

## Purpose And Boundary

This research establishes the authoritative landscape for a future
grouped/tabbed-window presentation and input carrier. It informs the deferred
active-border route decision but does not authorize grouped-window design or
implementation.

Grouped/tabbed windows remain gated by active-border delivery and a user-run
multi-window Custom Tile stability proof. No group gesture, shortcut, binding,
header carrier, control, interaction model, or implementation is selected.

## Source Map

| # | Claim anchor | Source | URL | Verified |
|---|---|---|---|---|
| G1 | `Group` (ICCCM client-leader window group) is X11-only, guarded by `#if !KWIN_BUILD_X11`; tracks leader, members, icon, user-time, and an `EffectWindowGroup` | local v6.7.3 source | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/group.h ; https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/group.cpp | read local |
| G2 | `EffectWindow::group()` returns `EffectWindowGroup`; `EffectWindow::transientFor()` exposes the transient parent; `EffectWindowGroup::members()` lists X11 group members | local v6.7.3 source | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/effect/effectwindow.h (442, 566, 958-967) ; https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/effect/effectwindow.cpp (226-230, 361-365, 465-469) | read local |
| G3 | `Window` has `transientFor`/`setTransientFor`/`hasTransient`/`mainWindows`; no tab container or tab-group member relation exists on `Window` | local v6.7.3 source | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/window.h (461-468, 1047-1060, 1874) | read local |
| G4 | X11 tabbing code is gone: `x11window.cpp` contains only `cleanTabBox()` and `wantsTabFocus()` (alt-tab focus policy); no `tabTo`/`isTabbed`/`tabGroup`/`TabGroup` remains | local v6.7.3 source | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/x11window.cpp | grep local |
| G5 | Effect input interception: `grabKeyboard`/`ungrabKeyboard`, `startMouseInterception` (delivers to `Effect::windowInputMouseEvent`), and `touchDown/Motion/Up`/`touchCancel` | local v6.7.3 source | https://invent.kde.org/plasma/kwin/-/blob/v6.7.3/src/effect/effecthandler.h (193-212, 744-747) | read local |
| G6 | `src/tabbox/` is the Alt+Tab task switcher (`clientmodel`, `switcheritem`, `tabboxhandler`), not window tabbing | local v6.7.3 source | https://invent.kde.org/plasma/kwin/-/tree/v6.7.3/src/tabbox | ls local |
| W1 | Canonical "Missing windows tabbing" bug; developer: tabbing "isn't enabled in the core (the code is cut short)"; later "We are not reviving this feature. The prevalence of CSDs makes this impossible to do well." | bugs.kde.org | https://bugs.kde.org/show_bug.cgi?id=343690 | fetched 2026-08-15 |
| W2 | Breeze/Plasma 5 never shipped tab support; marked dependent/duplicate of W1; KDecoration2 tab support absent | bugs.kde.org | https://bugs.kde.org/show_bug.cgi?id=340137 | fetched 2026-08-15 |
| W3 | `D23069` "Remove disabled TabGroup feature" (2019): the disabled TabGroup core code was removed; graesslin notes a decoration patch `D13459` plus "window tabs kind of working" | phabricator.kde.org / kwin mailing list | https://phabricator.kde.org/D23069 ; https://mail.kde.org/pipermail/kwin/2019-August/001061.html | fetched 2026-08-15 |
| W4 | `D3472` "API for window tabbing" (2016): proposed KDecoration2 tab API, never landed; reviewer warned it duplicated KDE 4 core tab logic | phabricator.kde.org | https://phabricator.kde.org/D3472 | fetched 2026-08-15 |
| W5 | `D12730` "Port TabGroup from Client to AbstractClient" (2018): first step toward a return, later closed | phabricator.kde.org | https://phabricator.kde.org/D12730 | fetched 2026-08-15 |
| W6 | `T17417` "Bring back tabbed windows (like from Plasma 4)": feature request redirected to the bug tracker; no owner, engineering-heavy | phabricator.kde.org | https://phabricator.kde.org/T17417 | fetched 2026-08-15 |

## 1. Historical client tabbing / window grouping

- KDE 4 / KWin 4 shipped user-visible window tabbing ("Attach as tab to...",
  middle-click grouping), implemented in the `Client`/`TabGroup` core and
  rendered by the Oxygen decoration (W1, W3, W4).
- It did not survive the Plasma 5 rewrite. Core tabbing was disabled (the code
  was left "cut short"), the KDecoration2 API never gained tab support, and
  Breeze never rendered tabs (W1, W2). A 2016 attempt to add a KDecoration2 tab
  API (`D3472`) was never merged; its own reviewer observed it re-implemented
  the same local tab state that had made KDE 4 tabbing "incredibly buggy" (W4).
- A 2018 port of `TabGroup` to `AbstractClient` (`D12730`) was a first step
  toward revival but was closed (W5). In 2019 the remaining disabled `TabGroup`
  core code was deleted (`D23069`); the same thread records that a decoration
  patch (`D13459`) plus uncommitted changes had "window tabs kind of working"
  (W3).
- Upstream's stated reason for not reviving the feature is client-side
  decorations: "We are not reviving this feature. The prevalence of CSDs makes
  this impossible to do well." (W1). This is the authoritative removal
  rationale.
- Reusable public API remaining in 6.7.3: none for tabbing. The only surviving
  grouping notions are the X11 ICCCM `Group` (G1) and transient parenting (G3).
  `EffectWindowGroup` and `EffectWindow::transientFor()` are the only effect-side
  grouping surfaces and they are read-only membership/relationship views, not a
  tab container (G2).
- `src/tabbox/` is the Alt+Tab window switcher, unrelated to window tabbing
  (G6). Taskbar "window grouping" (Task Manager applet, Plasma) is a separate
  Plasmashell concept, not KWin window grouping.

## 2. Current meanings of "group" and "transient group"

- `Group` (G1): ICCCM/NETWM client-leader window group, X11-only. Members share
  an icon, startup-id, and user-time; the group owns an `EffectWindowGroup`.
  It is a per-application affiliation for taskbar/icon/focus heuristics, not a
  user-visible tab container, and it is compiled out on non-X11 builds.
- Transient relationship (G3): `transientFor`/`hasTransient`/`mainWindows` model
  dialog/popup parenting to a main window. It carries stacking/focus
  consequences (a transient follows/activates with its parent) but is not a
  peer tab group; a transient is a child, not a sibling in a tab strip.
- A user-visible tab container (peer windows sharing one frame with a header
  strip) does not exist in KWin 6.7.3. No `Window` field, scene item, or public
  API expresses "these N peer windows are tabbed together" (G3, G4).

## 3. Current public script/native surfaces

Effect-side (native plugin), verified in the `effect/` headers (G2, G5; plus
accepted `rendering-options.md` C7-C10):

- Shared geometry: `EffectWindow` exposes `geometry`/`frameGeometry`; there is
  no API to co-move or co-resize a set of windows as one unit. Grouping layout
  is not an effect capability.
- Stacking/focus: `effects->activateWindow`/stacking helpers exist at the
  `EffectsHandler` level, but no group-level stacking or "raise whole group"
  primitive; `EffectWindowGroup` is read-only (G2).
- Visibility: per-window `EffectWindow::isMinimized`/`isDeleted`/`isFullScreen`
  are queryable (used by the border research); no group visibility API.
- Lifecycle: effects observe window added/closed/minimized via signals; no
  container lifecycle.
- Scene items: `EffectWindow::windowItem()` exposes the scene item; `Item`
  children are attachable only through private `addChild` (see accepted
  `rendering-options.md` C10). No group scene node exists.
- Qt Quick / effect views: `QuickSceneEffect`/`QuickSceneView` (fullscreen
  overlay) - see accepted `rendering-options.md` C9 and Route 5.
- Input interception / hit testing: `grabKeyboard`/`ungrabKeyboard`,
  `startMouseInterception` (routes to `Effect::windowInputMouseEvent`, cursor
  change, no X11 pointer grab per the header note), and touch delivery
  `touchDown/Motion/Up/Cancel` (G5). These are effect-global interception
  mechanisms, not per-window-region hit testing; there is no public
  per-window "input region" or tab-header hit-test primitive.
- Controller-to-carrier communication: none exists for groups. Effects and
  window-management scripts are separate surfaces; a window-management script
  can read `workspace.activeWindow` and geometry but cannot paint (see accepted
  `rendering-options.md` E11). There is no public channel for a tiling
  controller to instruct an effect/scene carrier to render a group header.

Window-management script (JS/QML) side: geometry/active-window reads only; no
painting; already established in accepted `rendering-options.md` E11.

## 4. KDecoration2/KDecoration3 feasibility

- A decoration plugin (`KDecoration3`) draws the server-side frame, SSD only.
  CSD clients (GTK/Firefox/most non-Qt apps, including XWayland CSD) draw their
  own frame and cannot be decorated (accepted `rendering-options.md` C14, Route
  2, E7-E9).
- It cannot implement actual grouping: the KDecoration2 tab API was proposed
  (`D3472`) but never landed, and KWin core has no tab container to bind to
  (G4, W1-W4). KDecoration3 exposes no tab/group surface in 6.7.3.
- As a tab-header carrier it is therefore SSD-only and has no backing grouping
  model. A decoration can draw borders/headers only on windows it decorates;
  it cannot present a unified header across CSD peers. Not viable for a
  cross-window group header across SSD/CSD/Wayland/XWayland.

## 5. Native Effect / scene / Qt Quick carrier feasibility

- Native `Effect` plugin: public, the standard extension point, renderer-
  agnostic at the `EffectWindow` level, but ABI-uncoupled (recompile per KWin
  release) - established in accepted `rendering-options.md` C7/C8, E13/E14.
- Scene item: `OutlinedBorderItem` is exposed but OpenGL-only and has no
  supported effect attachment factory; `Item::addChild` is private (accepted
  `rendering-options.md` C1-C5, C10). The same ownership/attachment gap applies
  to any effect-created group header item.
- Qt Quick: `QuickSceneEffect` is a genuinely supported fullscreen per-output
  overlay (accepted `rendering-options.md` C9), not a per-window or per-group
  node; it avoids the native C++ ABI burden via KPackage (accepted E10, E12).
- Input security/focus: effect input interception is opt-in and explicit
  (`grabKeyboard`, `startMouseInterception`), with the header noting
  `windowInputMouseEvent` performs no X11 pointer grab (G5). An effect-created
  input surface must route through these, not through a per-window hit-test
  API that does not exist publicly.
- Public supported extension points vs internal exports: the `Effect`/scene
  headers are exported (`KWIN_EXPORT`) but carry no binary/API stability
  guarantee (accepted C8, E13/E14). Grouping code that would be needed
  (container lifecycle, shared geometry, hit testing) is not a public extension
  point in 6.7.3.

## 6. Current upstream direction / open work

- The `TabGroup` feature was removed in 2019 (`D23069`, W3); the canonical
  request to restore tabbing is open with no owner and no target release (W1,
  W6). The stated blocker is CSD prevalence (W1).
- No open, in-progress MR restoring window tabbing or adding a group/tab
  container was identified in this search (W1-W6); the surviving records are
  closed attempts (W4, W5) and redirected feature requests (W6).
- No backend-portable per-window border/attachment or group-header overlay API
  exists in 6.7.3; the border research already records the one open rounding/
  outline upstreaming request as context only (accepted `rendering-options.md`
  E4).

## 7. Facts unknown until the user-run multi-window Custom Tile proof

- Whether the Custom Tile integration can reliably co-manage multiple windows
  as one unit (shared geometry, activation, stacking) in a live session.
- Live focus/stacking/activation behavior across Wayland and XWayland windows
  when moved/activated as a group.
- Whether a user-visible group header can be composited and hit-tested without
  intercepting or breaking normal input to the grouped windows.
- Renderer coverage (QPainter/Vulkan) of any future group-header drawing
  primitive, mirroring the unknown in the border research (accepted
  `rendering-options.md` C4/C13).
- These remain user-live evidence; this static research cannot substitute for
  it and does not relax the gate.

## Core distinction (battle-hardened vs supported API)

- Battle-hardened internal: the X11 `Group` and the effect `EffectWindowGroup`
  run in production but are X11-only affiliations, not a tab container (G1, G2).
- Removed/absent internal: the KDE 4 `TabGroup` was battle-tested, then
  disabled and deleted (W1, W3); nothing replaced it.
- Supported extension API: no grouping/tab extension API exists in 6.7.3. The
  effect plugin ABI carries no stability guarantee (accepted C8, E13/E14), and
  effect input interception (G5) is the only public input extension surface.

## research-04b - Ecosystem And Reference-Compositor Grouping Architectures

Research for `research-04b`. Scope: mature ecosystem implementations and
reference-compositor grouping/tab/stack architectures, plus the Qt
Quick/Kirigami/KDecoration/layer-shell/foreign-toplevel dependency landscape.
Findings recorded; no gesture, route, carrier, or dependency is selected.
Access date for all citations: 2026-08-15.

### Source Map (04b)

| # | Claim anchor | Source | URL | Verified |
|---|---|---|---|---|
| B1 | Hyprland group data model: `CGroup` holds `m_windows` + `m_current`, is created as a `Layout::CWindowGroupTarget` occupying one layout slot; each member window holds `m_group` + `m_groupRules` bitmask; inactive members get `setInputBlocked(INPUT_BLOCK_GROUP_INACTIVE)` and alpha 0 | Hyprland source | https://github.com/hyprwm/Hyprland/blob/5e441cae/src/desktop/view/Group.cpp | fetched 2026-08-15 |
| B2 | Hyprland groupbar presentation: `CHyprGroupBarDecoration` (an `IHyprWindowDecoration`) draws per-member bars/titles from `group:groupbar:*` config; drawn in the compositor render pass | Hyprland source | https://github.com/hyprwm/Hyprland/blob/0002f148/src/render/decorations/CHyprGroupBarDecoration.cpp | fetched 2026-08-15 |
| B3 | Hyprland group dispatchers: `togglegroup`, `changegroupactive`, `moveintogroup`/`moveoutofgroup`, `lockgroups`, `denywindowfromgroup` | Hyprland wiki | https://wiki.hypr.land/0.46.0/Configuring/Dispatchers/ | fetched 2026-08-15 |
| B4 | Hyprland `group`/`group:groupbar` config vars; "A group is like i3wm's tabbed container" | Hyprland wiki | https://wiki.hypr.land/0.54.0/Configuring/Variables/ | fetched 2026-08-15 |
| B5 | Hyprland license BSD-3-Clause ("Copyright (c) 2022-2026, vaxerski"); latest release v0.56.2 (2026-08-05) | GitHub | https://github.com/hyprwm/Hyprland/blob/main/LICENSE ; https://github.com/hyprwm/Hyprland/releases/tag/v0.56.2 | fetched 2026-08-15 |
| B6 | COSMIC compositor `cosmic-comp`: GPL-3.0 (SPDX `GPL-3.0-only` in source), built on `smithay` + `libcosmic` (iced-based SSD/UI); pinned commit `9feaa865ab0aa16c5461734b324d0827981d7483` was committed 2026-07-15 | GitHub | https://github.com/pop-os/cosmic-comp ; https://github.com/pop-os/cosmic-comp/commit/9feaa865ab0aa16c5461734b324d0827981d7483 ; https://github.com/pop-os/cosmic-comp/blob/9feaa865ab0aa16c5461734b324d0827981d7483/src/shell/layout/tiling/mod.rs | fetched 2026-08-15 |
| B7 | COSMIC stack data model: `CosmicStack` element holds `Vec<windows>` + `active: AtomicUsize`; forces members `try_force_undecorated(true)`/`set_tiled(true)`; reserves `TAB_HEIGHT`; renders tab bar via `IndicatorShader`/`ShadowShader` | cosmic-comp source | https://github.com/pop-os/cosmic-comp/blob/9feaa865ab0aa16c5461734b324d0827981d7483/src/shell/element/stack.rs | fetched 2026-08-15 |
| B8 | COSMIC tiling tree: internal nodes `Data::Group` (orientation, sizes), leaves `Data::Mapped` holding `CosmicWindow` OR `CosmicStack` | cosmic-comp source | https://github.com/pop-os/cosmic-comp/blob/9feaa865ab0aa16c5461734b324d0827981d7483/src/shell/layout/tiling/mod.rs | fetched 2026-08-15 |
| B9 | COSMIC stacking UX: "Window stacks combine windows ... like tabs in a web browser", icon on header, accent-colored active tab, arrow to cycle | System76 blog | https://system76.com/blog/post/cosmic-de-tiling-redesign-and-libcosmic-rebasing | fetched 2026-08-15 |
| B10 | i3: n-ary tree; `tabbed`/`stacked` container layouts; title bar drawn by the WM (`x_draw_decoration`); X11-only; BSD-3-Clause; v4.24 (2024-11-06) | GitHub / i3 source | https://github.com/i3/i3 ; https://github.com/i3/i3/blob/44b67d11/RELEASE-NOTES-4.24 | fetched 2026-08-15 |
| B11 | i3 `split tabbed|stacked` (PR #4208, 2020-09-23); i3 sets `_NET_WM_STATE_HIDDEN` on windows in the non-focused tab of a stacked/tabbed container | GitHub | https://github.com/i3/i3/pull/4208 ; https://github.com/i3/i3/blob/44b67d11/RELEASE-NOTES-4.24 | fetched 2026-08-15 |
| B12 | sway: i3-compatible Wayland compositor; `tabbed` layout via PR #2005 (2018-05-19) with `container_at` tree descent; MIT; v1.11 (2025-06-08) on wlroots 0.19 | GitHub | https://github.com/swaywm/sway/pull/2005 ; https://github.com/swaywm/sway/releases/tag/1.11 | fetched 2026-08-15 |
| B13 | sway `title_format` for containers (PR #8324, 2024-09); man pages document `tabbed`/`stacked` | GitHub | https://github.com/swaywm/sway/pull/8324 ; https://github.com/swaywm/sway/issues/5918 | fetched 2026-08-15 |
| B14 | bspwm: full binary tree (each node max 2 children); i3-style tabs "not possible in bspwm by nature"; monocle layout is the hide-others approximation; alternatives are XEmbed `tabbed` or external scripts | GitHub issue / manpage | https://github.com/baskerville/bspwm/issues/970 ; https://github.com/baskerville/bspwm | fetched 2026-08-15 |
| B15 | Karousel: KWin script (TS compiled to JS/QML, `org.kde.kwin 3.0`); GPL-3.0; "Reimplemented stacked columns without using window shading, so it works on Wayland as well"; v0.17 (2026-06-07) fixes stacked-column z-order | GitHub | https://github.com/peterfajdiga/karousel ; https://github.com/peterfajdiga/karousel/releases/tag/v0.17 | fetched 2026-08-15 |
| B16 | Krohnkite: maintained Plasma 6 dynamic tiling KWin script (JS); monocle/tiled/floating | GitHub | https://github.com/anametologin/krohnkite ; https://krohnkite.com/ | fetched 2026-08-15 |
| B17 | Polonium: MIT; author declared it dead ("consider the present Polonium project ... dead", 2024-08-18) | GitHub issue | https://github.com/zeroxoneafour/polonium/issues/195 | fetched 2026-08-15 |
| B18 | Bismuth: archived; last release v3.1.4 (2022-09-23), last push 2024-05-23 | GitHub | https://github.com/Bismuth-Forge/bismuth | fetched 2026-08-15 |
| B19 | `kwin-window-tabbing`: "Attempt at approximating window-tabbing with KWin ... not yet usable"; only co-resizes grouped windows | GitHub | https://github.com/Aziroshin/kwin-window-tabbing | fetched 2026-08-15 |
| B20 | layer-shell-qt: client-side Qt wrapper for `wlr-layer-shell`; KWin implements the compositor side (`LayerShellV1Window`) | GitHub / KWin source | https://github.com/KDE/layer-shell-qt ; https://github.com/KDE/kwin/commit/0f5e719 | fetched 2026-08-15 |
| B21 | KWin does NOT implement `wlr-foreign-toplevel-management-unstable-v1`; bug 502647 open (last modified 2025-12-10) | bugs.kde.org | https://bugs.kde.org/show_bug.cgi?id=502647 | fetched 2026-08-15 |
| B22 | Compositor protocol support: layer-shell KWin=5 / COSMIC=5; foreign-toplevel KWin=x / COSMIC=x | wayland.app | https://wayland.app/protocols/wlr-layer-shell-unstable-v1 ; https://wayland.app/protocols/wlr-foreign-toplevel-management-unstable-v1 | fetched 2026-08-15 |

### 1. Battle-hardened reference compositors (direct implementation model)

Every mature tab/stack system is compositor-owned: the group/stack is a
first-class layout or scene object inside the compositor, never a third-party
script or external dependency.

- **Hyprland native groups + groupbar** (B1-B5). A `CGroup` is a layout target
  that occupies one slot in the layout; member windows keep a `m_group`
  reference plus a `m_groupRules` bitmask. Inactive members are
  `setInputBlocked(INPUT_BLOCK_GROUP_INACTIVE)` with alpha 0; only the current
  member is visible and focused. The tab strip is a per-window decoration
  (`CHyprGroupBarDecoration`), drawn by the compositor in its own render pass
  (OpenGL), with per-member bars, gradients, and titles. Group controls are
  compositor dispatchers (`togglegroup`, `changegroupactive`,
  `moveintogroup`/`moveoutofgroup`, `lockgroups`) (B3). Wayland-native with
  XWayland support; BSD-3-Clause; actively maintained (v0.56.2, 2026-08-05).
- **COSMIC stacks** (B6-B9). `cosmic-comp` (Rust, smithay + libcosmic) models a
  stack as a `CosmicStack` element that is a leaf of the tiling tree
  (`Data::Mapped` wraps either a `CosmicWindow` or a `CosmicStack`) (B8). A
  stack holds `Vec<windows>` and an `active` index; on membership it forces
  every member undecorated and tiled (`try_force_undecorated(true)`), reserves a
  `TAB_HEIGHT` strip, and renders the tab bar inside the stack element via
  `IndicatorShader`/`ShadowShader` (B7). Focus/pointer target is the stack as a
  unit; the accent-colored active tab and a header icon/arrow are the
  presentation (B9). Wayland via smithay (glow/OpenGL renderer); GPL-3.0-only;
  active development at the pinned 2026-07-15 commit (B6). Same ownership model
  as Hyprland, but the tab bar is a scene element rather than a per-window
  decoration.
- **i3 / Sway tabbed + stacked containers** (B10-B13). Both use an n-ary tree
  where `tabbed` and `stacked` are container layouts, not window attributes.
  The title bar is drawn by the WM/compositor (i3 `x_draw_decoration`; sway
  scene titles), and clicking a tab focuses that child (`container_at` tree
  descent in sway PR #2005). i3 marks non-focused-tab windows
  `_NET_WM_STATE_HIDDEN` (B11). i3 is X11/XCB-only, BSD-3-Clause (v4.24,
  2024-11-06); sway is Wayland via wlroots, MIT (v1.11, 2025-06-08). This is
  the canonical "tab = container layout + WM-drawn title bar" pattern.
- **bspwm: absence is the lesson** (B14). bspwm uses a full binary tree (max 2
  children per node), so n-ary tabbed/stacked containers are "not possible in
  bspwm by nature"; the closest primitive is `monocle` (hide all but the
  focused window). Workarounds are external and X11-limited: suckless `tabbed`
  (XEmbed, cannot mix arbitrary apps) and shell scripts such as `bsptab`. The
  data model determines whether tabbing is expressible at all.

### 2. Maintained Plasma 6 KWin tilers/effects/scripts (carrier candidates)

The examined projects are KWin window-management scripts operating on geometry
only; none can paint or hit-test (consistent with the accepted
`rendering-options.md` E11 - window-management scripts expose no painting API).

- **Karousel** (B15): the closest existing "stack" carrier on Plasma. A KWin
  script (TypeScript compiled to JS/QML against `org.kde.kwin 3.0`); its
  "stacked columns" were re-implemented without window shading specifically so
  they work on Wayland, and v0.17 fixes stacked-column z-order. GPL-3.0;
  active (v0.17, 2026-06-07). It co-arranges and re-z-orders windows; it does
  not draw a tab header or intercept per-window input.
- **Krohnkite** (B16): maintained Plasma 6 dynamic tiling script (JS, dwm-
  inspired; monocle/tiled/floating layouts). Geometry only.
- **Polonium** (B17): MIT; author declared it dead (2024-08-18); Wayland-only.
- **Bismuth** (B18): archived; last release v3.1.4 (2022-09-23). Krohnkite
  fork.
- **kwin-window-tabbing** (B19): an explicit experiment at window tabbing via
  KWin script; self-described "initial stage of development and not yet
  usable"; the only achieved effect is co-resizing grouped windows. Direct
  evidence that KWin scripts cannot reach more than geometry grouping.

Assessment: no examined Plasma 6 KWin tiler/effect/decorator implements a
compositor-owned group container or a painted, input-carrier tab header. The
nearest (Karousel) proves geometry co-management is achievable from a script,
but the tab/header presentation and input remain absent.

### 3. Qt Quick / Kirigami / KDecoration / layer-shell / foreign-toplevel

These are widgets, renderers, or client/protocol surfaces. None provides a
group container, and none solves compositor ownership, shared geometry, focus,
hit testing, stacking, or lifecycle for grouped toplevel windows.

- **Qt Quick / Kirigami**: application/UI toolkits (QML scene graph, KDE
  convergent UI widgets). They render UI inside their own runtime; they enter
  the KWin scene only through the effect/scene surfaces already analyzed in
  04a/`rendering-options.md` (e.g. `QuickSceneEffect` fullscreen overlay).
  Widgets/rendering only, not KWin integration.
- **KDecoration2/KDecoration3**: SSD decoration plugin API. Already established
  in 04a as SSD-only with no tab/group surface (D3472 never landed); a
  decoration cannot present a unified header across CSD peers and has no group
  model to bind. Widget/rendering only.
- **layer-shell-qt / wlr-layer-shell** (B20, B22): layer-shell is a protocol
  for panel/dock/OSD surfaces with layer z-ordering, anchored margins, and
  keyboard interactivity. `layer-shell-qt` is the client-side Qt wrapper; KWin
  implements the compositor side (`LayerShellV1Window`). It solves layer
  placement for panel-like surfaces, not grouping; it cannot co-own, co-move,
  or co-focus toplevel windows, and it is not a tab container. Closest
  "presentation surface" dependency, but the wrong object model.
- **wlr-foreign-toplevel-management** (B21, B22): a taskbar/dock protocol that
  lists toplevels and permits activate/minimize/close. KWin does NOT implement
  it (bug 502647 open; wayland.app lists KWin support as "x"), so it is not
  even an available dependency here; and where implemented it enumerates
  individual toplevels, not groups. Not a carrier.

### Comparison tables

Reference-compositor grouping implementations (direct implementation model):

| System | Data model | Presentation | Input/focus ownership | Lifecycle | Wayland/XWayland | Renderer/dependencies | Extension stability and tests | License/maturity |
|---|---|---|---|---|---|---|---|---|
| Hyprland | `CGroup` = layout target; per-window `m_group` + rules | `CHyprGroupBarDecoration` per-window deco (bars/titles) | compositor; inactive input-blocked | group target is created, swapped into layout, then destroyed with membership (B1) | Wayland + XWayland | OpenGL; native core | internal core, not a reusable extension; test suite not separately examined | BSD-3-Clause; active (v0.56.2) |
| COSMIC | `CosmicStack` element = tiling-tree leaf; `Vec<windows>` + active idx | tab bar drawn in stack element (`TAB_HEIGHT`) | stack UI owns pointer target; active surface receives client input | membership configures members; final removal restores undecorated/tiled state (B7) | Wayland + XWayland | smithay glow (OpenGL), libcosmic | internal core, not a reusable extension; test suite not separately examined | GPL-3.0-only; pinned 2026-07-15 commit |
| i3 | n-ary tree; `tabbed`/`stacked` container layout | WM-drawn title bar | focus parent/child; tab click focuses | tree/container reconstruction not separately examined | X11 only | XCB | internal core; test suite not separately examined | BSD-3-Clause; v4.24 |
| sway | n-ary tree (same model) | WM-drawn title bar (scene) | same | tree/container reconstruction not separately examined | Wayland (wlroots) | wlroots | internal core; test suite not separately examined | MIT; v1.11 |
| bspwm | full binary tree | none (monocle hides others) | n/a | binary-tree lifecycle not separately examined | X11 | XCB | internal core; test suite not separately examined | BSD-2-Clause; maintained, no tabs |

Plasma 6 KWin scripts (geometry-only; no painting/hit-test):

| Project | Mechanism | Carrier capability | License | Status |
|---|---|---|---|---|
| Karousel | stacked columns, z-order (no window shading on Wayland) | geometry co-arrange only | GPL-3.0 | active (v0.17, 2026-06-07) |
| Krohnkite | dynamic tiling, monocle/tiled/floating | geometry only | not verified here | active (v0.10) |
| Polonium | tiling engine | geometry only | MIT | dead (2024-08-18) |
| Bismuth | tiling | geometry only | NOASSERTION | archived (v3.1.4, 2022-09-23) |
| kwin-window-tabbing | co-resize grouped windows | geometry only, "not yet usable" | not verified here | experimental |

Dependency assessment (non-solving UI/protocol vs KWin integration):

| Dependency | Kind | Solves grouping? | What it actually solves |
|---|---|---|---|
| Qt Quick | app/UI toolkit | No | renders app/QML UI |
| Kirigami | KDE UI framework | No | convergent widgets |
| KDecoration2/3 | SSD plugin API | No | server-side frame (SSD only, no tab API) |
| layer-shell-qt / wlr-layer-shell | panel protocol + Qt wrapper | No | layer z-order/anchoring for panels, docks, OSD |
| wlr-foreign-toplevel | taskbar/dock protocol | No (and absent on KWin) | list/activate individual toplevels |

### Reusable lessons

1. The compositor owns grouping. Hyprland, COSMIC, i3, and sway all make the
   group/stack a first-class layout/scene object with its own geometry slot,
   focus, and visibility. This is exactly the capability KWin 6.7.3 lacks
   (04a G1-G4).
2. Presentation is compositor-drawn and members are forced undecorated
   (COSMIC `try_force_undecorated(true)`) or the bar is a per-window decoration
   (Hyprland). The tab/header strip is never client-drawn and never a script.
3. The "one visible window" illusion is enforced by the compositor: inactive
   members are input-blocked and hidden (Hyprland alpha 0 + input block; i3
   `_NET_WM_STATE_HIDDEN`).
4. Data model is decisive: bspwm's binary tree cannot express n-ary tabs;
   i3/sway's n-ary tree can. KWin's `Window` has neither (04a G3).
5. On Plasma, scripts can only co-manage geometry (Karousel, kwin-window-
   tabbing); they cannot paint or hit-test. Any future group carrier on KWin
   must come from a native effect/scene or a future KWin core container, not
   from a script or an external dependency.
6. Qt Quick, Kirigami, KDecoration, layer-shell-qt, and foreign-toplevel are
   widgets, renderers, or protocol surfaces. None provides a group container;
   layer-shell is the closest presentation surface but is panel-scoped and
   cannot co-own toplevels. These are non-solving UI dependencies, not KWin
   grouping integration.

## Evidence Status

- Sources and findings: recorded above (`research-04a` complete).
- Ecosystem/reference-compositor research: `research-04b` complete (above).
- Joint synthesis and exact future user decisions: completed by `research-05`
  in `rendering-options.md` (section "research-05 - Joint Border And Grouped-
  Window Synthesis"); the border matrices and `research-03` recommendation are
  retained there, and the joint carrier separation and user decisions are
  recorded there rather than duplicated here.

### Joint recommendation (non-duplicative summary)

The grouped evidence converges with the border evidence on one conclusion: a
group carrier and the active-border carrier are different concerns and must be
**separate carriers**. The border is non-interactive painting over an existing
window (`OutlinedBorderItem`, C1-C3; OpenGL-only C3/C4/C13, no effect attachment
factory C10); a group carrier is an interactive, compositor-owned container
requiring input, hit testing, focus, stacking, visibility, and shared geometry
that do not exist in KWin 6.7.3 (G1-G5) and are owned by the compositor in every
mature reference implementation (B1-B13). A shared carrier would couple
non-interactive painting to an interactive compositor-owned group lifecycle
without removing any cost, and would drag the border into an input surface it
does not need. No examined KWin script (geometry-only, E11, B15-B19) or external
dependency (B20-B22) supplies group ownership or a tab-header input carrier.

Primary: two separate upstream tracks - a backend-portable border/attachment API
and a compositor-owned group container/header surface - with implementation
deferred. Bounded fallback: the independently approved OpenGL-only experimental
`OutlinedBorderItem` border while groups stay parked. Non-recommended: a shared
native effect/Qt Quick carrier, KDecoration common surface, any external
dependency, and passive deferral. Add no dependency now. The user-run
multi-window Custom Tile stability proof remains necessary but not sufficient
for grouped-window work. Full option matrix, sequencing, upstream engagement
path, and exact user decisions are in `rendering-options.md`.
