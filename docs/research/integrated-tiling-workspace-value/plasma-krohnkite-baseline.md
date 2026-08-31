# Plasma and Krohnkite Baseline: Source Audit Report

- Unit: `unit-02/attempt-02` (reopened 2026-08-10 per plan Amendment Status;
  adds the structural-authoring/direct-placement workflow evidence: J9-J10,
  D9.1-D9.6, and D4.8-D4.11).
- Role: source/design research only. No live-session interaction, no
  installation, no configuration change, no package install, no KWin script
  load/enable, no compositor restart, no `sustained-workload-validation`
  contact.
- Evidence date: 2026-08-09 for the retained J1-J8 / D4.1-D4.7 evidence;
  2026-08-10 for the structural-workflow evidence added by attempt-02 (new
  records carry their own retrieval dates).
- Scope: audit stock Plasma 6.7.4 and the Krohnkite Plasma 6 fork baseline
  (anametologin 0.9.9.2) against the accepted rubric
  `research/evaluation-rubric.md`, applying its section 10 evidence-record
  model to every J1-J10 cell and to D4.1-D4.11, applying the section 4 companion
  standard, and separating stock Plasma capability, Krohnkite capability,
  companion capability, composition friction, and unknowns.
- Boundary: this is NOT a product conclusion. Decision Rule mapping is unit-05,
  including the section 9.1 target-segment frequency scoping for J9-J10.
  Unknowns are explicit; no comparator failure is assumed.
- Correction history (retained): unit-02/attempt-01 accepted 2026-08-09
  (log.md); attempt-02 re-authors the J9-J10 / D9 / D4.8-D4.11 cells under the
  amended rubric. No prior cell is removed; amended cells are added and two
  provisional factual descriptions are corrected with primary-source evidence
  (see X-05).

## 1. Scope, Versions, Evidence Date, and Source-Quality Rules

### 1.1 Comparators and pins (from rubric section 2)

| Comparator | Baseline | Pinned identity | Pin evidence |
|---|---|---|---|
| Stock Plasma | Plasma 6.7.4 (KWin + shell), Wayland session | KWin tag `v6.7.4`, commit `8438567a741826da8b7536a8b10eb3af8fc8820d` (2026-08-04); plasma-desktop tag `v6.7.4` commit `95e51519c44e6bc4aeee0cce998aba244fcd68f4`; plasma-workspace tag `v6.7.4` commit `fd05f4c88ab093aee23ce137bf6f2412437c9bba`; kdeplasma-addons tag `v6.7.4` commit `57ab0e90662dd258bf35d07c1c0503a260f7d16d` | P-01, P-03 (source clones of the tags) |
| Krohnkite baseline | KWin tiling script on the same Plasma 6.7.4 Wayland session | anametologin fork tag `0.9.9.2`, commit `1d7fd742edd58963c94a158217440b27dad963ef` (2025-07-25) | K-01 |
| Canonical Krohnkite (not the baseline) | esjeon/krohnkite, latest release `v0.8.1` (2022-02-14); reported non-functional on Plasma 6 | GitHub releases; GitHub issue #218 (open, 2024-03-08) | K-02 |

Identity decision (rubric 2.1): the canonical esjeon line is Plasma 6
incompatible (issue #218, 2024-03-08; last release v0.8.1 2022-02-14). The
actively maintained Plasma 6 line is the anametologin fork, released
`.kwinscript` artifacts on codeberg (release `0.9.9.2`), and packaged on AUR
(`kwin-scripts-krohnkite-git`) with that fork as upstream (K-13). The baseline
therefore uses the fork line pinned at `0.9.9.2`.

### 1.2 Source-quality rules applied

- Prefer current upstream source and official documentation; record version,
  retrieval date, source type, and exact capability semantics per claim.
- Secondary sources (news coverage, third-party scripts) provide discovery
  context only and never sole-support a capability result. Where used, they are
  cross-checked against primary source or the claim is recorded UK.
- Every favorable and every unfavorable result carries a direct evidence
  record. Documentation silence is recorded as UK, never as a negative finding.
- No live desktop/session interaction of any kind was performed.

## 2. Baseline Install-Enable-Configure Paths

### 2.1 Stock Plasma 6.7.4 (baseline per rubric 3.1)

Stock Plasma is a shipped product; there is nothing to install for the
features exercised by the journeys. Each step is the shipped default or a
System Settings surface:

| Step | Evidence |
|---|---|
| Session: Plasma 6.7.4 Wayland (per-screen virtual desktops are Wayland-only; rubric 2.2) | P-04 |
| Default virtual desktop count: kwinrc `[Desktops]` `Number` defaults to `1` when unset (`readEntry("Number", 1)`); count, names, rows persisted on change | P-05, P-15 |
| Create/remove/reorder desktops: System Settings > Virtual Desktops (`Add Desktop`, per-desktop `Remove`, grid reorder); Overview desktop bar | P-06, P-16 |
| Per-output desktop switching: opt-in checkbox `Switch desktops independently for each screen` (System Settings > Virtual Desktops); default OFF | P-05, P-06 |
| Keyboard navigation: `Switch to Desktop 1-4` = Meta+F1-F4 (+ legacy Ctrl+F1-F4); `Switch One Desktop Right/Left/Up/Down` = Ctrl+Meta+arrows; `Switch to Next/Previous Desktop` unbound by default; touchpad/touchscreen swipe gestures | P-08 |
| Overview / Grid: Meta+W (Overview), Meta+G (desktop grid); scroll / PageUp / PageDown switches desktops in Overview | P-02, P-16 |
| Manual tiling: Quick Tile = Meta+arrows; Custom Tiling editor = Meta+T (`Edit Tiles`); Untile window operation | P-07, P-11 |
| Directional focus: `Switch Window Up/Down/Left/Right` = Meta+Alt+arrows; Alt+Tab walk-through via tabbox | P-07, P-09 |
| Cross-output: `Window to Next/Previous Screen` = Meta+Shift+Right/Left; `Switch to Screen Right/Left/Up/Down`, `Switch to Next/Previous Screen`, `Move Window to Screen N` (latter group unbound by default) | P-07 |
| Window-to-desktop: `Window to Desktop 1-4` = Meta+Alt+F1-F4; `Window One Desktop Right/Left/Up/Down` = Meta+Ctrl+Shift+arrows | P-07 |
| Indication: default panel includes the Pager widget, but the default panel is primary-only (new outputs get no panel); desktop-switch OSD effect default OFF | P-17, P-18, P-19, P-24 |
| Window rules/exceptions: System Settings > Window Management > Window Rules (shipped) | P-21 |

### 2.2 Krohnkite baseline (rubric 3.2: Plasma 6.7.4 Wayland + fork 0.9.9.2)

| Step | Documented path | Evidence |
|---|---|---|
| Install: `.kwinscript` file from the `0.9.9.2` release, imported via System Settings > Window Management > KWin Scripts > `Import KWin script...` (top-right); or `kpackagetool6 -t KWin/Script -i krohnkite-0.9.9.2-*.kwinscript`; or AUR `kwin-scripts-krohnkite-git`; or build from git (`go-task install`, requires go-task, npm, 7z) | K-01, K-03, K-13 |
| Enable: tick Krohnkite in System Settings > Window Management > KWin Scripts (kwinrc `[Plugins] krohnkiteEnabled=true`); script starts, iterates current stacking order and tiles | P-21, K-05 |
| Configure: `Configure` button in the KWin Scripts dialog opens the script's KConfigXT dialog (`res/config.xml`, `res/config.ui`); covers ignore/float class/title/role, per-screen default layout, layout-per-activity/desktop, gaps, directional key mode, etc. | K-11, K-12 |
| Shortcuts: registered on enable via `ShortcutHandler` (res/shortcuts.qml); reassignable in System Settings > Shortcuts | K-04 |
| Apply config: documented requirement to reboot after configuration changes; do NOT toggle the script off/on ("this will start multiple instances of it") | K-03, K-14 |
| Multi-screen setup (README): enable Separate Screen Focus; bind KWin `Switch to Next/Previous Screen` (recommended Meta+, / Meta+.); bind KWin `Window to Next/Previous Screen` (recommended Meta+< / Meta+>); optional per-screen default layout string `OutputName:ActivityId:VirtualDesktopName:layoutName` | K-03, K-11 |
| Filter/float: default `ignoreClass` list includes krunner, yakuake, spectacle, xwaylandvideobridge, plasmashell, ksplashqml, kwin_wayland, polkit agent, kruler; utility/dialog/splash float by default (`floatUtility`); plasmashell always ignored | K-07, K-08 |

Baseline build-path friction (unknown U1 resolved with source): the AUR
`PKGBUILD` `prepare()` applies two `sed` patches to `tsconfig.json`
(`"rootDir": "src"`, `"ignoreDeprecations": "6.0"`), indicating the fork
requires TypeScript 6-era build workarounds. The `.kwinscript` route avoids any
build. Fragile-but-documented build path recorded as configuration friction
(K-13), not assumed.

### 2.3 Companion eligibility (rubric section 4, four tests)

| Candidate | (a) Necessity | (b) Common-recommendation evidence | (c) Coherent enablement | (d) Bounded set | Verdict |
|---|---|---|---|---|---|
| Pager / workspace-indication widget beyond shipped defaults | FAIL: the D4.5/D5.1 per-output indication gap is real (MF) but is closed by the shipped `org.kde.plasma.pager` placed on per-output panels; no widget beyond Plasma's shipped affordances is required, so the component is not needed to close the gap | n/a | n/a | n/a | Rejected. The shipped Pager widget is baseline Plasma (rubric 4: "shipped default widgets are baseline Plasma"); the friction is a setup step, not a missing component |
| Window rule / exception management beyond Krohnkite ignore/float rules | FAIL: Krohnkite's documented config dialog covers ignore/float per class/title/role (K-08, K-11); stock Window Rules KCM is baseline Plasma | n/a | n/a | n/a | Rejected |
| Helper to make a documented shortcut/lifecycle action reachable | FAIL: all Krohnkite shortcuts are registered by the script itself (K-04); cross-screen focus/move uses stock KWin shortcuts, documented in the README (K-03) | n/a | n/a | n/a | Rejected |

Result: the Krohnkite companion set is **empty**. Every candidate fails test
(a) or is already baseline Plasma. No companion contributes capability to this
baseline. Journey gaps are assessed against the raw Krohnkite + stock Plasma
stack and recorded as such; none are absorbed by an unbounded companion set.

## 3. Complete J1-J10 Comparison Matrix

Classifications: CB (critical blocker), MF (material friction), PD (preference
difference), FT (feature trivia), UK (unknown). Ownership:
P = stock Plasma, K = Krohnkite, C = composition (Krohnkite + KWin/Plasma
documented interaction), U = unknown.

### J1 Onboard and enable

| Criterion | Stock Plasma (class / evidence / ownership) | Krohnkite baseline (class / evidence / ownership) |
|---|---|---|
| D2.1 First app tiles on launch | MF. No automatic tiling in stock 6.7.4; new windows open centered (default `Placement=Centered`); manual Quick Tile (Meta+arrows) and Custom Tiling (Meta+T) are the documented tiling paths, applied per window. P-07, P-11, P-20 / P | PD. Automatic dynamic tiling on window add; first app tiles on launch through the documented enable path. K-03, K-05, K-06 / K |
| D6.1 Install/enable/configure coherence | PD. Everything shipped; System Settings surfaces (Virtual Desktops, KWin Scripts, Window Rules, Shortcuts); no undocumented file edits. P-06, P-21 / P | MF. `.kwinscript` import path is coherent (K-03); AUR path requires a patched TypeScript build (K-13); canonical wiki documents a manual `Enable Script Configuration` step for the config dialog (K-14); config applies only after reboot (K-03). / K |
| D6.2 Config applies without session restart where documented | PD. Desktop count and per-output toggle apply live (setCount; `Options::syncFromKcfgc` on reconfigure). P-05, P-06 / P | MF. `configChanged` is not bound (source comment: "This doesn't work at all"); README requires a reboot after configuration changes; canonical wiki requires script restart. K-03, K-05, K-14 / K |
| D7.1 No manual rescue step in normal use | PD. No rescue step. / P | MF. Onboarding configuration requires a reboot (K-03); script toggling is explicitly discouraged (K-03). In normal non-config use no rescue is needed; the config step makes J1 MF. / K |
| D8.5 Temporary disablement | FT. No auto-tiling mode to pause; per-window Untile operation is documented; absence has no workflow consequence for stock. P-11 / P | PD. Meta+F toggles float per window; Meta+Shift+F floats all; `FloatingLayout`; un-float restores the window to its tile order (order preserved in the store). K-04, K-06 / K |

### J2 Daily launch and placement

| Criterion | Stock Plasma | Krohnkite baseline |
|---|---|---|
| D1.2 Workspace retention on close-all | PD. Desktops are explicit objects; closing all windows does not remove a desktop; count/names persist in kwinrc `[Desktops]`. P-05, P-15 / P | PD. Same Plasma model; Krohnkite does not auto-remove desktops; per-surface layout entries persist in memory for the session. K-10 / K |
| D1.6 Recovery after session restart | UK. Workspace count/names persist (P-15). Window geometry/desktop-assignment restore: complete for X11 (P-14 sm.cpp); on Wayland, KWin implements the `xdg-session-management-v1` compositor side and the legacy `org.kde.KWin.Session` D-Bus, but apps must implement the client side (P-14). Whether a typical Wayland session returns windows to the pre-restart arrangement is not established. / U | UK. Krohnkite per-surface layout selections are in-memory and reset to documented defaults on restart (K-10); windows are re-tiled on script start (K-05); window-set restore inherits the same Plasma/app dependence as stock. / U |
| D2.1 Initial placement | MF. New windows open centered (overlapping for multiple windows); no auto-tiling; manual tiling per window. P-20 / P | PD. Windows inserted and tiled automatically; placement predictable and gapless by layout. K-03, K-05, K-06 / K |
| D2.3 Insertion | MF. No layout insertion; new windows stack centered; quick-tile placement is per-window manual. P-07, P-20 / P | PD. New window appended to the surface window list and the layout reflows (configurable position). K-06 / K |
| D3.1 Directional focus | PD. `Switch Window Up/Down/Left/Right` (Meta+Alt+arrows); candidate set spans the full workspace geometry on the active desktop, so focus can land across outputs; lands on visible windows. P-07, P-22 / P | PD. Meta+J/K/H/L focus within the current output's surface using layout-relative geometry; cross-output focus is delegated to KWin screen-switch shortcuts (documented). K-04, K-06, K-03 / C |
| D7.2 No observable degradation under repeated actions | UK. No source/docs evidence; performance measurement is a non-goal of this audit (spec Non-goals). / U | UK. No source/docs evidence; `enter()` re-entry guard is a design safeguard, not a performance claim. / U |

### J3 Focus and relocate during a task

| Criterion | Stock Plasma | Krohnkite baseline |
|---|---|---|
| D1.5 Migration to another workspace | UK. Quick-tile mode persists with the window (P-12); exact re-tiling/refill of the target desktop's tile tree for custom-tiled windows is not established from source. / U | PD. `desktopsChanged` triggers re-arrange; window moves to the target surface and is tiled there; tiled/floating state persists. K-05, K-06 / K |
| D2.2 Layout changes reflow | FT. Stock has no switchable tiling layout; Quick Tile reflow is per-window manual; Custom Tiling editor reflows managed windows on edit. P-07, P-11 / P | PD. Meta+\ / Meta+| cycle layouts; `cycleLayout`/`setLayout` re-arrange visible windows predictably. K-04, K-06 / K |
| D3.1 Directional focus | PD (see J2). / P | PD (see J2). / C |
| D3.2 Move/swap window | PD. No layout slots to swap; documented moves to another workspace (Meta+Alt+F1-F4 / Window to Desktop N) and to another output (Meta+Shift+arrows) complete the criterion. P-07 / P | PD. Meta+Shift+J/K/H/L swaps within the current surface; moving across desktops/outputs is done via documented KWin shortcuts (Window to Desktop N, Window to Next/Previous Screen), after which the window re-tiles on the target surface. K-04, K-06, K-03 / C |
| D3.3 Cross-workspace focus | PD. Switching desktops activates the target and focuses its previous window; directional focus does not cross desktop boundaries (candidates on the active desktop only). P-08, P-22 / P | PD. Focus actions operate within the current surface; cross-workspace/cross-output focus uses KWin screen-switch shortcuts (documented). K-06, K-03 / C |
| D3.4 Focus/click consistency | PD. Keyboard and pointer focus consistent; focus chain is per-output by default (`SeparateScreenFocus` default true). P-10 / P | PD. Focus follows activation events; window state and geometry derived from the KWin window model. K-05, K-07 / K |
| D7.1 No rescue step | PD. / P | PD. Focus/relocate actions have no documented rescue step. / K |

### J4 Multi-window session with mixed types

| Criterion | Stock Plasma | Krohnkite baseline |
|---|---|---|
| D2.4 Stack/tab behavior | Out of scope, recorded: stock exposes no stacking/tabbed layout (rubric D2.4). Not scored as absent. P-11 / P | PD. Exposes a `Stacked` layout (dwm-style master + stack, non-tabbed) plus Monocle; opening windows in those layouts produces the documented stacking result. K-06 / K |
| D2.5 Mixed tiling/floating | PD. Dialogs/utilities float naturally (no auto-tiling to force them); quick-tiled windows stay until un-tiled. P-20 / P | PD. Utility/dialog/splash float by default (`floatUtility` true); modal/transient/non-resizable float; floating survives focus and layout changes. K-07, K-08 / K |
| D8.1 Float a window | PD. Untile operation releases a window from a tile. P-11 / P | PD. Meta+F toggles floating. K-04 / K |
| D8.2 Fullscreen | PD. `Window Fullscreen` action exists (unbound by default); no auto-tiler forces fullscreen windows back into tiles. P-07 / P | PD. Fullscreen windows get `NativeFullscreen` state and are not re-tiled while fullscreen; returning restores tiled state. K-06 / K |
| D8.3 Manual override | PD. Free move/resize; no auto-tiler fights manual placement. P-07 / P | MF. `keepTilingOnDrag` defaults true, so dragging a tiled window performs an in-layout operation or snapback rather than free placement; free manual placement requires floating the window first (documented) or changing the config. K-06, K-08 / K |
| D8.5 Temporary disablement | FT. (See J1.) / P | PD. Meta+F / Meta+Shift+F per-window or all-window float. / K |
| D7.1 No rescue step | PD. / P | PD. No rescue step in normal mixed-session use. / K |

### J5 Multi-output working session

| Criterion | Stock Plasma | Krohnkite baseline |
|---|---|---|
| D3.2 Cross-output move | PD. Meta+Shift+Right/Left moves window to next/previous screen; window lands on that output's active workspace and gains focus. P-07 / P | PD. Cross-output move via KWin `Window to Next/Previous Screen` (documented in README); `outputChanged` triggers re-arrange so the window tiles on the target output. K-03, K-05 / C |
| D4.1 Workspace model global vs output-local | PD. Global by default (`perOutputVirtualDesktops` default false; all outputs switch together); per-output switching is an explicit opt-in checkbox; the model is visible and documented. P-05, P-06 / P | PD for the global default; MF for per-output mode. Krohnkite does not define the model; it keys surfaces on the active output's current desktop (K-06, K-09), so it follows Plasma's global default. With per-output mode enabled and differing per-output desktops, the interaction is now source-established as a mis-key: every surface is arranged against the active output's desktop, so non-active outputs' actual desktops are never tiled and issue-documented focus-steal / stranded-window failures follow; the fix exists only post-0.9.9.2 (X-03, K-15). / C |
| D4.2 Directional focus/move across outputs | PD. Directional focus candidates span the full workspace geometry, so focus crosses outputs on the same desktop; dedicated screen-switch actions exist. P-07, P-22 / P | MF. Directional focus and move are confined to the current output surface; crossing to another output requires first switching screens with KWin's (user-bound) screen shortcuts - an extra documented step repeated on every cross. K-06, K-03 / C |
| D4.3 Lifecycle across outputs | PD. Desktops are global; each output tracks its own current desktop; removing a desktop clamps affected outputs' current desktop and migrates its windows to a defined target; windows on other outputs are not silently moved. P-05, P-13 / P | PD. Inherits Plasma lifecycle; desktop changes fire `currentDesktopChanged` and re-arrange all surfaces. K-05, K-06 / K |
| D4.5 Per-output indication | MF. The shipped default panel (with the Pager widget) exists only on the primary output; `ShellCorona::addOutput` creates a desktop containment but no panel for new screens, so at-a-glance per-output indication is not provided by default. Per-output indication is achievable by adding a panel (which contains the Pager) on each output - a documented, discoverable setup (`Add Panel`, `Manage Desktops and Panels...`), but an extra setup step for the journey. Desktop-switch OSD effect exists (default off); Overview is per-screen. P-16, P-17, P-18, P-19, P-24 / P | MF. Indication is Plasma's; the same per-output panel/Pager setup is required as for stock, so the composed baseline carries the same friction. Krohnkite adds OSD notifications on layout change (`notificationDuration` default 1000 ms), which give layout feedback but not a per-output workspace-at-a-glance indication. K-06, K-08 / C |
| D4.6 Window/layout preservation | PD. PlacementTracker persists per-window output, geometry, quick-tile, maximize, fullscreen across output-layout changes and restores on return. P-12 / P | PD. Window tiled/floating/fullscreen state survives output and desktop changes; arrange re-tiles on the target surface. K-06, K-07 / K |
| D5.1 See/name workspaces, know current per output | MF. Workspace naming and the per-panel Pager work as shipped, but the default panel is primary-only, so knowing the current workspace per output requires the same per-output panel/Pager setup as D4.5 (documented, discoverable; extra setup step). Overview shows all desktops/windows. P-06, P-16, P-18, P-19, P-24 / P | MF. Same Plasma surfaces and the same per-output panel/Pager setup; Krohnkite's OSD reports the current layout, not the per-output workspace. K-06, K-08 / C |
| D5.2 Navigation without state loss | PD. Meta+F1-F4, Ctrl+Meta+arrows, Overview (scroll/PageUp/PageDown), touchpad gestures. P-02, P-08, P-16 / P | PD. Same Plasma navigation; focus/layout persist across switches. / C |
| D7.2 Repeated high-frequency actions | UK (see J2). / U | UK (see J2). / U |

### J6 Dock, undock, hotplug

| Criterion | Stock Plasma | Krohnkite baseline |
|---|---|---|
| D1.6 Recovery | UK (see J2). / U | UK (see J2). / U |
| D4.4 Connect/disconnect/reconnect | PD. On output removal, KWin evacuates defunct tile trees, migrates quick-tiled windows to the output at the removed geometry's center, and runs PlacementTracker restore; on reconnect the per-output last desktop is remembered (`Activities` `PerOutputLastVirtualDesktop`) and PlacementTracker restores saved geometry/quick-tile/maximize/fullscreen by output-layout hash. P-12, P-13, P-23 / P | UK. Driver reacts to `screensChanged` only by re-arranging (K-05); no window-migration logic for connect/disconnect exists in Krohnkite, so end-to-end behavior (no lost/mis-tiled windows, coherent layout) is not established from source. Risk evidence only: upstream issue #43 documents a stale-Output crash/mis-tile path in pre-fix code, fixed only after 0.9.9.2 (K-16); no pinned upstream integration test was run and no authorized live hotplug observation occurred, so the runtime outcome is unavailable, not proven. K-05, K-16 / U |
| D4.6 Preservation | PD. PlacementTracker preserves window placement across the output change. P-12 / P | PD. Windows re-tile on the surface after `screensChanged`/`outputChanged`. K-05 / K |

### J7 Workspace lifecycle management

| Criterion | Stock Plasma | Krohnkite baseline |
|---|---|---|
| D1.1 Creation | PD. System Settings > Virtual Desktops `Add Desktop`, or Overview desktop bar; new windows open on the current desktop. P-06, P-16 / P | PD. Creation is Plasma's; Krohnkite has no auto-creation (surface `next()` returns null - no overflow desktop). K-09 / K |
| D1.2 Retention | PD (see J2). / P | PD (see J2). / K |
| D1.3 Removal | PD. KCM/Overview remove; windows on the removed desktop migrate to `min(removedNumber, count)` target; no window is lost. P-05, P-13 / P | PD. Inherits Plasma migration; `desktopRemoved` triggers re-arrange. / K |
| D1.4 Ordering/reordering | PD. Grid layout (`VirtualDesktopGrid`); KCM reorder; navigation and indicators follow the grid. P-05 / P | PD. Surface keys use desktop names; reordering keeps surface entries keyed by name/id. K-09, K-10 / K |
| D1.5 Migration | UK (see J3). / U | PD (see J3). / K |
| D4.3 Lifecycle across outputs | PD (see J5). / P | PD (see J5). / K |

### J8 Configure and tune

| Criterion | Stock Plasma | Krohnkite baseline |
|---|---|---|
| D6.1 Install/config coherence | PD (see J1). / P | MF (see J1). / K |
| D6.2 Config applies coherently | PD (see J1). / P | MF (see J1). / K |
| D4.7 No hidden per-output setup | PD. Default behaves sensibly on a second output (tiling per output is automatic; per-output desktops are opt-in, documented). P-05, P-06 / P | PD. Multi-screen setup is documented in the README (Separate Screen Focus, screen-switch shortcut bindings, per-screen default layout); the required setup is discoverable, not hidden. One instruction references `ActiveMouseScreen`, which does not exist in KWin 6.7.4 (stale doc, X-04). K-03 / C |
| D8.4 Exceptions | PD. Window Rules KCM (shipped baseline Plasma) excludes windows by app/title/role. P-21 / P | PD. Config dialog ignore/float rules by class/resource/title/role; regex bracket syntax documented. K-03, K-08, K-11 / K |

### J9 Author a persistent structure (TS; D9.1, D9.2, D9.4, D9.5, D9.6)

Root-cause note (rubric 9.1 non-double-count rule): every negative D9 cell for
the Krohnkite baseline column shares ONE root limitation - the composed
baseline has no functioning persistent authored region topology (see the D9
matrix below and X-06). These cells are scored individually but must be
counted as facets of that single limitation, never as independent blockers.

| Criterion | Stock Plasma | Krohnkite baseline (Krohnkite + stock Plasma composed) |
|---|---|---|
| D9.1 Arbitrary-leaf split (both axes) | PD. Recursive per-leaf split in the Tiling Editor (Meta+T): every leaf exposes `Split Left/Right` (horizontal) and `Split Top/Bottom` (vertical); `CustomTile::split` creates child regions or a nested layout at any depth; the surrounding tree is preserved or predictably re-derived and windows in the split leaf are re-picked by center. P-25, P-32 / P | CB. Krohnkite layouts are fixed templates or derived geometry: Tile is a fixed master+stack shape, BTree builds a balanced tree from the window count on every apply, Columns is a one-axis column strip; no layout or action splits an arbitrary leaf in both axes at arbitrary depth (K-18). Stock's Tiling Editor still runs, but Krohnkite re-asserts its own geometry over custom-tile windows on the next arrange, so the authored tree does not function as the active structure (K-20, X-06). / K + C |
| D9.2 Keyboard-directed insertion | CB. No preselect/target-leaf+side mechanism exists for directing where the NEXT window opens: the unbound-by-default `Window Custom Quick Tile Left/Right/Top/Bottom` actions re-assign only the CURRENT window to a custom tile after it opens, and Meta+arrows Quick Tile targets the standard quick-tile zones, not authored leaves; the scripting API can drive `Tile::manage`/`CustomTile::split` but a bespoke KWin script is not part of the baseline's documented configuration. P-26, P-28, P-31 / P | CB. New windows are appended to the surface window list at a configurable position (`newWindowPosition`) and the layout reflows; there is no way to select a target leaf and insertion side before a window opens. K-18, K-06 / K |
| D9.4 Structure independent of window ordering | PD. Authored custom-tile trees persist independently of windows: the tree is saved to kwinrc `[Tiling]` keyed by desktop id and output uuid and loaded on TileManager creation; regions are never re-derived from window order; closing a window leaves the tile in place. P-25 / P | CB. Krohnkite layout geometry derives from the ordered window list (live-window structure): BTree/Tile recompute regions from tileable count/order on every arrange; there is no authored topology whose persistence could be observed. Stock's authored tree persists in config but is inert under Krohnkite (K-20, X-06). K-18, K-19 / K + C |
| D9.5 Automatic placement preserving authored structure | CB. New windows without explicit direction are placed by the standard placement policy (default centered), NOT into authored regions; there is no documented default region and no auto-fill of empty custom tiles. P-20, P-29 / P | CB. Krohnkite auto-places new windows into its generated layout (append + reflow; Columns keeps window-to-column membership while a column is non-empty), but there are no authored branches to preserve; the placement targets a derived structure, not authored regions. K-18 / K |
| D9.6 Empty-branch semantics | PD. Empty regions are retained: closing the last window of a custom-tile branch leaves the (empty) region in place and does not shift other windows; collapse only happens through the explicit Delete action in the editor. Retention is source-evident but not separately user-documented. P-25 / P | CB. Branches collapse by construction: Columns removes a column when it empties and re-inserts a default single column when all are empty; Tile/BTree rebalance when a leaf's window closes. This is collapse of a derived structure, not of an authored branch, so the criterion's authored-branch sequence cannot be observed in the composed baseline. K-18 / K |

### J10 Direct placement and empty-branch handling in a live task (TS; D9.3, D9.5, D9.6)

| Criterion | Stock Plasma | Krohnkite baseline (Krohnkite + stock Plasma composed) |
|---|---|---|
| D9.3 Pointer-directed drag-to-split placement | CB. Shift+drag over a custom tile shows that tile's outline and assigns the window to the EXISTING tile under the drop point on release (`finishInteractiveMoveResize` -> `setQuickTileMode(Custom, anchor)` -> `rootTile()->pick()` -> `Tile::manage`); no code path splits the target tile on drop. The missing dynamic split-on-drop is exactly the open KDE wishlist bug 466057 (CONFIRMED, no fix, retrieved 2026-08-10). Drop result (existing-tile assignment) is predictable and reversible via Untile. P-26, P-27, P-11 / P | CB. Only the Columns layout implements `drag()` (edge-zone new-column creation, before/after insertion into an existing column); Tile/BTree perform swap-on-release and float-on-drag behaviors only. This is single-axis column rearrangement, not a target-splitting placement, and does not apply to the other layouts. K-17, K-06 / K |
| D9.5 Automatic placement preserving authored structure | CB (see J9). / P | CB (see J9). / K |
| D9.6 Empty-branch semantics | PD (see J9: retention). / P | CB (see J9: derived-structure collapse). / K |

### 3.1 Journey status per comparator (rubric section 9 Step 2, input only)

Most severe evidenced classification per journey (UK never counts toward
CB/MF; Decision Rule application is unit-05):

| Journey | Stock Plasma | Krohnkite baseline |
|---|---|---|
| J1 | MF | MF |
| J2 | UK (D1.6) with MF (D2.1, D2.3) | UK (D1.6) |
| J3 | UK (D1.5) | PD |
| J4 | PD (FT D2.4/D8.5) | MF (D8.3) |
| J5 | MF (D4.5, D5.1) | MF (D4.1 per-output, D4.2, D4.5, D5.1) |
| J6 | UK (D1.6) | UK (D1.6, D4.4) |
| J7 | UK (D1.5) | PD |
| J8 | PD | MF |
| J9 (TS) | CB (D9.2, D9.5) | CB (D9.1, D9.2, D9.4, D9.5, D9.6 - one root limitation, see J9 note) |
| J10 (TS) | CB (D9.3, D9.5) | CB (D9.3, D9.5, D9.6 - one root limitation) |

Neither comparator has an evidenced CB in any J1-J8 cell; the amended
structural journeys J9-J10 now evidence CB cells for both comparators. Per
rubric 9.1 these are target-segment (TS) cells: whether a TS CB makes baseline
coverage "broken" depends on the target-segment scoping (failure in the
documented normal daily workflow, not rescued by a documented step), which is a
unit-05 Decision Rule determination built on the evidence below - not a
conclusion drawn here. For stock Plasma the J9/J10 gaps are D9.2 (no
preselect), D9.3 (no split-on-drop), D9.5 (no auto-placement into authored
regions). For the Krohnkite baseline column every negative D9 cell is a facet
of the single root limitation in X-06 (no functioning persistent authored
topology in the composed baseline). Material frictions are also evidenced in
high-frequency journeys for both comparators (stock: J1, J2, J5; Krohnkite:
J1, J4, J5, J8). This is input for unit-05; no baseline-coherence
conclusion is drawn here.

## 4. Dedicated D4.1-D4.11 Matrix

| Criterion | Stock Plasma (class / evidence) | Krohnkite baseline (class / evidence) |
|---|---|---|
| D4.1 Workspace model global vs output-local | PD. Global by default; per-output opt-in checkbox; `VirtualDesktopManager` tracks one current desktop per output (`m_currentDesktops`); default `perOutputVirtualDesktops=false`; Wayland only. P-05, P-06, P-04 | PD for the global default; MF for per-output mode. Krohnkite keys every screen's surface on the active output's current desktop, so the global mode follows Plasma's global default. With per-output mode enabled, source + issue #37 establish that non-active outputs are arranged against the active output's desktop and their real desktops are never tiled (X-03, K-15). K-06, K-09 |
| D4.2 Directional focus and move across outputs | PD. Directional focus crosses outputs within the same desktop (candidates over full workspace geometry); dedicated screen-switch and window-to-screen actions exist (Meta+Shift+arrows default). P-07, P-22 | MF. Directional focus/move confined to current output; crossing requires user-bound KWin screen shortcuts (documented extra step). K-06, K-03 |
| D4.3 Lifecycle across outputs | PD. Global desktop set; per-output current desktop; removal migrates windows to defined target and clamps affected outputs; other outputs untouched. P-05, P-13 | PD. Inherits Plasma lifecycle; desktop changes re-arrange surfaces. K-05, K-06 |
| D4.4 Connect/disconnect/hotplug recovery | PD. Tile-tree evacuation + quick-tile migration on removal; PlacementTracker restore by output-layout hash on reconnect; per-output last-desktop memory in `Activities`. P-12, P-13, P-23 | UK. Driver only re-arranges on `screensChanged`; no migration/preservation logic in Krohnkite; end-to-end hotplug outcome not established from source. Risk evidence only: issue #43 documents a stale-Output crash/mis-tile path in pre-fix code, fixed after 0.9.9.2 (K-16); no pinned integration test was run and no authorized observation occurred. Unit-04 candidate U04-3 remains open. K-05, K-16 |
| D4.5 Per-output indication | MF. Shipped default panel (with Pager) is primary-only; new outputs receive a desktop containment but no panel, so the default does not indicate which workspace each output is showing. Per-output indication requires adding a panel (with Pager) per output - documented, discoverable, extra setup. OSD effect default off; Overview per screen. P-16, P-17, P-18, P-19, P-24 | MF. Indication inherits the same per-output panel/Pager setup; Krohnkite OSD reports layout changes, not per-output workspaces. K-06 |
| D4.6 Window/layout preservation | PD. PlacementTracker preserves geometry/quick-tile/maximize/fullscreen per window across output-layout changes. P-12 | PD. Tiled/floating/fullscreen state survives output/desktop changes; re-tile on target surface. K-06, K-07 |
| D4.7 No hidden per-output setup | PD. Second output behaves by default; per-output desktops opt-in and documented; no hidden per-output config. P-05, P-06 | PD. README documents the multi-screen setup; per-screen default layout documented; stale `ActiveMouseScreen` reference (X-04). K-03 |
| D4.8 Structural scope per output | PD. Authored structure is per output per desktop: each `LogicalOutput` owns a `TileManager`, which holds one `RootTile` tree per virtual desktop (`m_rootTiles` keyed by desktop); the Tiling Editor operates on the target screen's root tile; the model is explicit and consistent with D4.1. P-25, P-30 | PD for scope. The composed baseline inherits the same per-output per-desktop custom-tile trees, and Krohnkite additionally keys layout state per surface (output x activity x desktop). But the authored structure is inert under Krohnkite's geometry control (X-06); per-output scope remains explicit even though the structure does not govern windows. K-18, K-19, K-20 |
| D4.9 Structural cross-output moves | MF. A keyboard cross-output move of a custom-tiled window (`sendToOutput`) calls `forgetWindow`, dropping the window from its tile, and the window is then re-placed on the target output by the placement policy without re-entering an authored tile; only a Shift+drag drop onto the target tile re-assigns it (`setQuickTileMode(Custom, anchor)` picks the target output's tree). Focus/indication update deterministically. P-26, P-13 | MF. Krohnkite re-tiles a moved window predictably into the target surface's generated layout on `outputChanged`/arrange, but no authored position is preserved (there is no authored position to preserve), and the composed custom tiles do not govern the window. K-05, K-18, K-20 |
| D4.10 Structural persistence/recovery | UK. Evidence-backed detail: custom-tile trees are serialized to kwinrc `[Tiling]` per desktop id and output uuid and reloaded on (re)connect, so authored structure survives hotplug and session restart; on output-layout change `PlacementTracker::restore` re-picks the custom tile at the restored geometry (the `checkQuickTileMode` special case exists for this), so window assignments survive output unplug/reconnect. Window-to-tile assignments do not survive a full session restart (PlacementTracker is runtime-only), which inherits the D1.6 Wayland session-restore dependence. Because the full persistence/recovery criterion includes session-restart window-to-tile assignment and that sub-part is not established, the cell is classified UK overall, not PD (the source-evidenced sub-parts above remain recorded, not scored as PD). P-25, P-30, P-12 | MF. Stock's persistent custom-tile trees survive as above but are inert while Krohnkite runs, so authored positions do not survive a restart as functional structure; Krohnkite's own per-surface layout/column state is in-memory only and resets to documented defaults on script start (K-19), so the composed baseline's active structure resets on restart. K-19, K-20, X-06 |
| D4.11 Structural indication | MF. Default affordances do not reveal authored structure per output at a glance: the tree is visible only inside the Tiling Editor overlay (invoked per screen), and the Pager/panel surfaces show desktops, not tile structure; no persistent on-screen tile-structure indicator exists. P-25, P-16 | MF. The composed baseline offers the same editor-only custom-tile visibility; Krohnkite's OSD reports layout-change notifications, not authored structure or per-output structural state. K-06 |

## 4A. D9 Structural Authoring and Direct Placement Matrix

Operational-model grounding (rubric section 5, "Operational semantics"):
KWin 6.7.4 Custom Tiling is a persistent saved topology (a recursive binary
tree, not a flat preset grid - factual correction X-05) whose empty leaf
regions persist but carry no bspwm-style preselection/insertion-point
semantics; Krohnkite layouts are live-window structures derived from the
ordered client list plus, for Columns, in-memory column membership. Neither
exposes bspwm-style receptacles-with-preselection. Each criterion is scored on
its own sequence; automatic reflow alone evidences nothing (rubric section 5
D9 preamble).

| Criterion | Stock Plasma (class / evidence / ownership) | Krohnkite baseline (class / evidence / ownership) |
|---|---|---|
| D9.1 Arbitrary-leaf split (both axes) | PD. Recursive per-leaf split in the Tiling Editor (Meta+T, enabled by default): each leaf exposes `Split Left/Right` and `Split Top/Bottom`; `CustomTile::split` adds a sibling cell or nests a new sub-layout; splitting a leaf that holds a window re-picks that window by center. P-25, P-32 / P | CB. Tile = fixed master+stack, BTree = balanced tree rebuilt from window count every apply, Columns = one-axis strip; no operation splits an arbitrary leaf in both axes at any depth. Stock's editor is still present but its tree does not govern windows under Krohnkite (K-20, X-06). K-18 / K + C |
| D9.2 Keyboard-directed insertion | CB. No mechanism selects a target leaf + insertion side for the NEXT window before it opens; the unbound-by-default `Window Custom Quick Tile` actions re-assign only the current window, and Meta+arrows Quick Tile targets standard zones, not authored leaves; a bespoke script driving the tile scripting API is not baseline configuration. P-26, P-28, P-31 / P | CB. New windows append at a configurable list position and reflow; no preselect surface exists. K-18, K-06 / K |
| D9.3 Pointer-directed drag-to-split placement | CB. Shift+drag assigns the window to the existing tile under the drop point (`finishInteractiveMoveResize` -> `setQuickTileMode(Custom, anchor)` -> `RootTile::pick` -> `Tile::manage`); no path splits the target on drop; the dynamic split-on-drop is the open KDE wishlist bug 466057 (CONFIRMED, no fix; retrieved 2026-08-10). P-26, P-27, P-11 / P | CB. Only Columns has `drag()` (edge-zone column creation, before/after insertion into an existing column); Tile/BTree swap on release or float on drag. Single-axis column rearrangement, not target-splitting placement. K-17, K-06 / K |
| D9.4 Structure independent of window ordering | PD. Authored trees persist independently of windows (kwinrc `[Tiling]`, keyed by desktop id + output uuid); regions are never re-derived from window order; closing a window leaves its tile in place. P-25 / P | CB. Layout geometry derives from the ordered client list (Tile/BTree) with no authored topology; Columns column membership is the only persistent facet and is single-axis. K-18, K-19 / K |
| D9.5 Automatic placement preserving authored structure | CB. New windows are placed by the standard policy (default centered), not into authored regions; no documented default region and no auto-fill of empty tiles. P-20, P-29 / P | CB. Krohnkite auto-places into its generated layout (append + reflow; Columns preserves column membership while non-empty), but there are no authored regions to preserve. K-18 / K |
| D9.6 Empty-branch semantics | PD. Empty regions are retained (no auto-collapse on window close); Delete in the editor collapses explicitly; other windows are not shifted. Retention is source-evident, not separately user-documented. P-25 / P | CB. Branches collapse by construction: Columns removes empty columns and re-inserts a default single column when all are empty; Tile/BTree rebalance on leaf close. Derived-structure collapse, not authored-branch semantics. K-18 / K |

Completeness statement: every D9.1-D9.6 and D4.8-D4.11 cell above has a
classification and a direct evidence record (section 6); no cell relies on
documentation silence. The one structural UK cell is D4.10 (stock): its
session-restart window-to-tile assignment recovery is not established (it
inherits the D1.6 Wayland session-restore dependence, P-14), so the full
persistence/recovery criterion is classified UK rather than PD; the
source-evidenced structure and hotplug-assignment sub-parts remain recorded in
the cell without being scored as PD.

## 5. Findings

### 5.1 Favorable findings (evidenced capabilities)

- Stock Plasma 6.7.4 ships per-screen virtual desktops (opt-in), a per-output
  current-desktop model, per-output tile managers, PlacementTracker-based
  window preservation across output-layout changes, and per-output
  last-desktop memory. (P-04, P-05, P-06, P-12, P-23)
- The Pager widget is per-panel/per-screen and is included in the shipped
  default panel, so on any output where the user places a panel it indicates
  that output's current desktop. (P-18, P-19)
- Stock Plasma documents complete keyboard coverage for the journeys: Meta+Alt
  directional focus (cross-output capable), Meta+Shift window-to-screen,
  Meta+Ctrl+Shift window-to-desktop, Meta+F1-F4 desktop switch. (P-07, P-08)
- Krohnkite 0.9.9.2 delivers automatic dynamic tiling on window add with
  multiple layouts, per-surface (output x activity x desktop) layout state,
  documented per-window float/ignore rules, native fullscreen handling, and a
  coherent `.kwinscript` install/enable/configure path. (K-03, K-05, K-06,
  K-07, K-10, K-11)
- Krohnkite's multi-output story is documented (per-screen surfaces and
  layouts, README multi-screen setup) even though its directional focus is
  per-output. (K-03, K-09, K-10)
- Stock Plasma's Custom Tiling is a genuine persistent authored topology, not
  a flat preset grid: `CustomTile::split` builds recursive binary sub-trees in
  both axes at any depth; each leaf in the Meta+T editor exposes horizontal
  and vertical split buttons; trees are serialized to kwinrc `[Tiling]` keyed
  by desktop id and output uuid and reloaded per output; empty regions are
  retained when windows close. (P-25, P-32; factual correction X-05)
- Stock Plasma documents existing-tile assignment by Shift+drag (outline +
  pick on release) and per-output, per-desktop structural scope. (P-26, P-30)

### 5.2 Unfavorable findings (evidenced frictions)

- Shortcut conflicts between stock KWin 6.7.4 defaults and Krohnkite defaults:
  Meta+T (KWin `Edit Tiles` vs Krohnkite `Tile Layout`), Meta+D (KWin `Show
  Desktop` vs Krohnkite `Decrease`), and probable Meta+Return (KRunner scheme
  `Run Command` vs Krohnkite `Set Master`). Runtime resolution (which binding
  wins) is not established from source - unit-04. (P-07, P-09, P-11, K-04;
  X-01)
- Krohnkite configuration changes require a reboot; the script does not bind
  KWin's `configChanged` (source comment: "This doesn't work at all"), and
  toggling the script off/on is warned against (multiple instances). (K-03,
  K-05, K-14)
- Krohnkite directional focus/move does not cross outputs; cross-output work
  needs KWin screen-switch shortcuts (documented but extra steps on a
  high-frequency journey). (K-06, K-03)
- Krohnkite's default `keepTilingOnDrag=true` constrains free manual placement;
  floating-first is the documented manual-override path. (K-06, K-08)
- The AUR build path requires `tsconfig.json` sed patches (TypeScript 6-era
  workarounds); the `.kwinscript` path avoids building. (K-13; U1 resolved)
- Krohnkite README's multi-screen instructions reference `ActiveMouseScreen`,
  which no longer exists in KWin 6.7.4; the other recommended settings
  (Separate Screen Focus) are already the 6.7.4 defaults. (K-03, X-04)
- Per-output workspace indication is not provided by the shipped default: the
  default panel (with its Pager) exists only on the primary output, and
  `ShellCorona::addOutput` gives new screens a desktop containment but no
  panel. At-a-glance per-output indication therefore requires the documented,
  discoverable step of adding a panel/Pager on each output (MF for D4.5 and
  D5.1). (P-19, P-24)
- Version metadata inconsistency: the `0.9.9.2` tag ships `package.json`
  version `0.9.8.5`. (K-01)
- Per-output virtual desktops (Plasma 6.7 opt-in) mis-key Krohnkite 0.9.9.2:
  every screen's surface is built from the active output's
  `workspace.currentDesktop`, so with differing per-output desktops the
  non-active outputs' real desktops are never arranged and windows there are
  not tiled; upstream issue #37 documents the focus-steal / stranded-window /
  no-source-re-tile symptoms, and the fix (`currentDesktopForScreen`/
  `setCurrentDesktopForScreen`) exists only post-0.9.9.2. (K-15; MF for
  D4.1-per-output, X-03)
- Stock Plasma Custom Tiling cannot complete three of the six D9 sequences:
  no preselect of a target leaf + side for the next window (D9.2), no
  target-splitting placement on drop - Shift+drag assigns to the existing tile
  only (D9.3; open KDE wishlist bug 466057, CONFIRMED, no fix), and no
  automatic placement of new windows into authored regions (D9.5; default
  placement is centered). These are distinct source-evidenced gaps, not one
  repeated label. (P-26, P-27, P-20, P-29)
- Krohnkite 0.9.9.2 has no authored-topology model at all: Tile is a fixed
  master+stack shape, BTree rebuilds a balanced tree from window count each
  apply, Columns is a one-axis column strip whose membership is in-memory;
  there is no preselect, no leaf-split operation, and no serialization
  (LayoutStore/WindowStore are memory-only). This is the single root limitation
  behind every negative D9 cell for the Krohnkite baseline column (X-06); it is
  recorded once and must not be double-counted as independent blockers. (K-18,
  K-19)
- Composition: Krohnkite is unaware of KWin's custom tiles - `shouldIgnore`/
  `shouldFloat`/`commit` never reference tiles and set `frameGeometry` directly,
  while KWin's tile geometry is re-asserted only on tile changes; on the next
  Krohnkite arrange (`enforceSize`/`arrangeScreen`) a custom-tile window is
  snapped back to Krohnkite's layout geometry, so the composed baseline's
  authored custom-tile structure does not function as the active structure. A
  coherent built-in configuration of the composed baseline therefore cannot
  satisfy the J9/J10 authored-structure workflow end to end. (K-20, K-05, X-06)

### 5.3 Unknowns

- U2 (rubric): codeberg master snapshot - pinned to tag `0.9.9.2` commit
  `1d7fd74`. Master diverges; the tag is the baseline.
- D1.6 (both comparators, Wayland session restart): whether typical apps
  restore window geometry via `xdg-session-management-v1` (compositor side
  present; client adoption unknown). P-14
- D4.4 Krohnkite hotplug end-to-end outcome (no lost/mis-tiled windows,
  coherent retiling) on a live Plasma 6.7.4 Wayland session: not established
  from source; no pinned upstream integration test was run and no authorized
  live hotplug observation occurred. Risk evidence only: issue #43 documents a
  stale-Output crash/mis-tile path in pre-fix code, fixed after 0.9.9.2 (K-16);
  a PR/issue description cannot establish the normal runtime outcome. K-05,
  K-16
- Per-output desktops + Krohnkite (X-03): the mis-keying mechanism and its
  failure modes are established from source + KWin integration-test semantics +
  issue #37; the observable behavior on a real multi-output session remains a
  candidate for authorized observation, not an open unknown.
- Shortcut conflict runtime resolution (X-01).
- Krohnkite "multiple instances on toggle" claim. K-03
- Config-dialog enablement manual step on the fork/6.7.4 (canonical wiki
  statement may not apply to the fork). K-14
- D7.2 observable degradation for both comparators (no source/docs evidence;
  performance measurement out of scope).
- D4.10 (stock) session-restart window-to-tile assignment recovery: custom-tile
  trees persist in kwinrc, but PlacementTracker is runtime-only, so whether a
  typical Wayland session restart returns windows into their prior custom tiles
  is not established (inherits the D1.6 `xdg-session-management-v1` client-side
  dependence). P-25, P-12, P-14
- J9/J10 runtime severity in the composed baseline: the source evidence above
  establishes what each affordance does, but no pinned integration test and no
  authorized live observation measured the observed behavior of the Krohnkite +
  custom-tile conflict on a real session (candidate U04-7) or the effective
  workflow friction on a daily target-segment session (candidate U04-8). The
  cell classifications above are source-based; the unit-05 target-segment
  scoping (rubric 9.1) uses this evidence without converting these candidates
  into proven runtime outcomes.

### 5.4 Unit-04 validation candidates (state-changing; behind the plan gate)

| ID | Precise unresolved claim | Why source evidence is insufficient |
|---|---|---|
| U04-1 | Which global shortcut wins when stock KWin 6.7.4 defaults (Meta+T `Edit Tiles`, Meta+D `Show Desktop`) collide with Krohnkite's `ShortcutHandler` defaults (`Tile Layout`, `Decrease`); whether both fire or one is shadowed. | KGlobalAccel conflict resolution (first-vs-last write, ambiguous-key handling) is runtime behavior not determinable from source. |
| U04-2 | RESOLVED in unit-04/attempt-01: with per-output virtual desktops enabled, Krohnkite 0.9.9.2 mis-keys surfaces. Every screen's surface is built from the active output's `workspace.currentDesktop` (K-06, K-09), so with differing per-output desktops the non-active outputs' real desktops are never arranged; upstream issue #37 documents the focus-steal / stranded-window / no-source-re-tile consequences, fixed only post-0.9.9.2 (K-15). Residual: observable behavior on a live session remains an authorized-observation candidate. | |
| U04-3 | On output connect/disconnect/reconnect, are windows preserved and correctly re-tiled by Krohnkite with no loss? | Krohnkite driver handles `screensChanged` by arrange only; no migration logic; end-to-end outcome needs observation. Risk evidence only: issue #43 documents a stale-Output crash/mis-tile path in pre-fix code (K-16), but no pinned integration test was run and no authorized live hotplug observation occurred, so the runtime outcome is unavailable, not proven. |
| U04-4 | Does toggling Krohnkite off/on in the KWin Scripts KCM actually start multiple script instances, as the README warns? | Author-claimed behavior; KWin script lifecycle on toggle is not determinable from source. |
| U04-5 | On a Plasma 6.7.4 Wayland session restart, do common apps restore their windows (geometry/desktop) via `xdg-session-management-v1`? | Compositor-side protocol support is present; client adoption is not. |
| U04-6 | Is a manual `Enable Script Configuration` step required for Krohnkite's config dialog on Plasma 6.7.4 (canonical wiki claim)? | The fork ships `X-KDE-ConfigModule`; runtime requirement differs from canonical wiki context and is not determinable from source. |
| U04-7 | On a live Plasma 6.7.4 Wayland session with Krohnkite enabled, does a window assigned to a KWin custom tile stay in that tile, or does Krohnkite's next arrange/enforceSize snap it back to the layout geometry? | The conflict is fully established from source (K-20, K-05, P-26), but the observed per-session behavior and any degradation (geometry flicker, focus artifacts) are runtime outcomes not determinable from source. |
| U04-8 | What is the observed friction of the J9/J10 target-segment daily workflow on the composed baseline (editor-driven authoring + per-window assignment vs absent preselect/split-on-drop)? | Cell-level ability is established from source (section 4A); the daily-workflow severity that rubric 9.1 needs for the TS Decision Rule scoping is a runtime/observation question for a safe unit-04 check. |

## 6. Evidence Record / Citation Register

Rules (rubric section 10): one record per claim; source type is
source-doc / source-code / official-doc / issue-tracker / packaging / unknown;
records P-01..P-24, K-01..K-16, C-01..C-03, X-01..X-04 retrieved 2026-08-09;
records P-25..P-32, K-17..K-21, X-05..X-06 retrieved or verified 2026-08-10
(attempt-02); version = pinned tag/commit. All structural source reads used the
local tag clones: kwin v6.7.4 at commit 8438567 (with v6.7.3 tag 45ec9a6
fetched and diffed empty against v6.7.4 for `src/tiles`,
`src/plugins/tileseditor`, `src/window.cpp`, `src/workspace.cpp`, and
`src/placement.cpp`, so all structural claims apply to the full 6.7.3-6.7.4
range) and Krohnkite tag 0.9.9.2 at commit 1d7fd74.

### 6.1 Stock Plasma

| ID | Claim summary | Type | Source | Version / snapshot |
|---|---|---|---|---|
| P-01 | Plasma 6.7.4 released 2026-08-04 as a bugfix release of the 6.7 series (6.7.0 2026-06-16) | official-doc | https://kde.org/announcements/plasma/6/6.7.4/ | 6.7.4 |
| P-02 | 6.7 ships per-screen virtual desktops, Overview via Meta+W, Overview desktop switching by scroll/PageUp/PageDown | official-doc | https://kde.org/announcements/plasma/6/6.7.0/ | 6.7.0 |
| P-03 | KWin 6.7.4 source identity; used for all P-05..P-23 source reads | source-code | https://invent.kde.org/plasma/kwin.git tag v6.7.4 | commit 8438567a (2026-08-04) |
| P-04 | Per-output desktops: Wayland only; default switches all outputs together; opt-in per-output; switching affects active screen; does not pull focus to the target screen; `VirtualDesktopManager` tracks current desktop per output | source-doc + issue-tracker | https://invent.kde.org/plasma/kwin/-/merge_requests/8602 (merged ~2026-04-14); https://bugs.kde.org/show_bug.cgi?id=107302; Phoronix 2026-04-14 (secondary context) | merged for 6.7 |
| P-05 | `virtualdesktops.h/.cpp`: `perOutputVirtualDesktops` default false; `m_currentDesktops` per-output hash; `current(output)`/`setCurrent(output)`; `maximum()`=25; default count `readEntry("Number", 1)`; save/load `kwinrc [Desktops]`; `initialDesktopForNewOutput` (global mode clones an existing output's desktop; per-output mode uses `Activities` last-desktop or desktop 1); `setCount` clamps affected outputs on shrink | source-code | kwin/src/virtualdesktops.h, virtualdesktops.cpp | v6.7.4 |
| P-06 | `kwin.kcfg` `PerOutputVirtualDesktops` default false; System Settings Virtual Desktops KCM checkbox `Switch desktops independently for each screen`; `Add Desktop` / remove buttons | source-code | kwin/src/kwin.kcfg; kwin/src/kcms/desktop/ui/main.qml; kcms/desktop/virtualdesktopssettings.kcfg | v6.7.4 |
| P-07 | Window-management shortcuts: Meta+Alt+arrows directional focus; Meta+arrows Quick Tile; Window to Desktop N; Window to Next/Previous Screen = Meta+Shift+Right/Left; Move Window to Screen N; Switch to Screen N / Next/Previous / directional (unbound); Show Desktop = Meta+D; Window Fullscreen (unbound); Window operations (move/resize/pack/grow/shrink) | source-code | kwin/src/useractions.cpp | v6.7.4 |
| P-08 | Desktop-switch shortcuts: Ctrl+Meta+arrows one desktop right/left/up/down; Switch to Next/Previous Desktop unbound; Meta+F1-F4 (and Ctrl+F1-F4) switch to desktop 1-4; swipe/axis gestures | source-code | kwin/src/virtualdesktops.cpp `initShortcuts` | v6.7.4 |
| P-09 | Shortcut schemes: `Walk Through Desktops` = Meta+Tab; `Walk Through Windows` = Alt+Tab; `Run Command` = Meta+Return / Alt+F2 (scheme-applied defaults) | source-code | plasma-desktop kcms/keys/schemes/kde4.kksrc, win4.kksrc | v6.7.4 |
| P-10 | `SeparateScreenFocus` default true (focus chain per output); `NextFocusPrefersMouse` default false | source-code | kwin/src/kwin.kcfg; options.cpp; focuschain.cpp | v6.7.4 |
| P-11 | Native tiling subsystem: `TileManager` per output; custom tile trees per desktop per output; quick tiles; tiles editor effect `Edit Tiles` = Meta+T; Untile window operation; tiling config in `kwinrc [Tiling]`; tiling is user-initiated, not automatic | source-code | kwin/src/tiles/*.h/.cpp; kwin/src/plugins/tileseditor/tileseditoreffect.cpp; kwin/src/useractions.cpp | v6.7.4 |
| P-12 | `PlacementTracker`: persists per-window outputUuid/geometry/maximize/quickTile/fullscreen keyed by output-layout hash; restores on output-layout change and when a window's output was removed | source-code | kwin/src/placementtracker.cpp | v6.7.4 |
| P-13 | Output add/remove: new output gets TileManager + current desktop; on removal, evacuates defunct tile trees, migrates quick-tiled windows to the output at the removed center, restores via PlacementTracker | source-code | kwin/src/workspace.cpp (output change handler ~1415-1500; `slotDesktopRemoved`) | v6.7.4 |
| P-14 | Session: X11 path saves per-window geometry/desktop/maximize/fullscreen/stacking (sm.cpp); Wayland `xdg-session-management-v1` compositor side + `org.kde.KWin.Session` D-Bus; ksmserver restore (`tryRestore`/`restoreLegacySession`); blog: apps/toolkits must implement the client side | source-code + official blog | kwin/src/sm.cpp, wayland/xdgsession_v1.cpp, org.kde.KWin.Session.xml; plasma-workspace ksmserver/server.cpp; https://blogs.kde.org/2026/04/18/this-week-in-plasma-per-screen-virtual-desktops-and-wayland-session-restore/ | v6.7.4 |
| P-15 | Default desktop count = 1 when kwinrc `[Desktops]` unset; count/names/rows persisted | source-code | kwin/src/virtualdesktops.cpp load/save | v6.7.4 |
| P-16 | Overview effect: Meta+W, Meta+G; per-screen DesktopBar; desktop add/remove in Overview; scroll/PageUp/PageDown switching (6.7 announcement) | source-code + official-doc | kwin/src/plugins/overview/qml/*.qml, overvieweffect.cpp; P-02 | v6.7.4 |
| P-17 | Desktop-switch OSD effect default OFF (`desktopchangeosdEnabled` default false) | source-code | kwin/src/kcms/desktop/virtualdesktopssettings.kcfg | v6.7.4 |
| P-18 | Pager widget `org.kde.plasma.pager` is per-panel/per-screen, ships in the default panel | source-code | plasma-desktop applets/pager/qml/main.qml; layout-templates/.../defaultPanel/contents/layout.js | v6.7.4 |
| P-19 | Default panel contents: kickoff, pager, icontasks, marginsseparator, systemtray, digitalclock, showdesktop | source-code | plasma-desktop layout-templates/org.kde.plasma.desktop.defaultPanel/contents/layout.js | v6.7.4 |
| P-20 | Default placement policy = `PlacementCentered` (with decorations) | source-code | kwin/src/kwin.kcfg (Placement default) | v6.7.4 |
| P-21 | KWin Scripts KCM: import button, KDE Store (NewStuff), enable checkboxes, configure; Window Rules KCM shipped | source-code | kwin/src/kcms/scripts/ui/main.qml, module.cpp, kwinscriptsdata.cpp | v6.7.4 |
| P-22 | `Workspace::switchWindow` directional focus: candidates over full stacking order on the active output's current desktop, not filtered by output; can cross outputs | source-code | kwin/src/useractions.cpp `switchWindow` (~1541) | v6.7.4 |
| P-23 | Per-output last desktop memory in `Activities` (`PerOutputLastVirtualDesktop`); used by `initialDesktopForNewOutput` in per-output mode | source-code | kwin/src/activities.cpp; virtualdesktops.cpp | v6.7.4 |
| P-24 | Panel model: `ShellCorona::addOutput` creates a desktop containment (`DesktopView`) but no panel for a new screen, so the shipped default panel is primary-only; per-output panels are created via the documented `Add Panel` action (`m_addPanelAction`, i18n `Add Panel`) and `Manage Desktops and Panels...` (`manageContainmentsAction`, visible when >1 screen) | source-code | plasma-workspace shell/shellcorona.cpp (addOutput ~1486; action setup ~2283-2308) | v6.7.4 |
| P-25 | Custom Tiling is a recursive persistent binary tree: `CustomTile::split` adds a sibling cell or nests a new sub-layout in either axis at any depth; `TileManager::saveSettings`/`readSettings` serialize the full tree to kwinrc `[Tiling]` keyed by desktop id + output uuid (legacy 6.3 output-uuid fallback in `generateOutputId`); per-leaf windows are re-picked by center on split/insert; closing a window calls `Tile::unmanage` and leaves the (possibly empty) tile in place (retention, no auto-collapse); Delete in the editor is the explicit collapse path | source-code | kwin/src/tiles/customtile.cpp (`split` ~193, `remove` ~273), tile.cpp (`unmanage` ~427), tilemanager.cpp (`saveSettings` ~390, `readSettings` ~288, `parseTilingJSon` ~197), plugins/tileseditor/qml/TileDelegate.qml (split/delete buttons), qml/Main.qml | v6.7.4 (identical at v6.7.3) |
| P-26 | Existing-tile Shift+drag assignment and absence of split-on-drop: during interactive move with Shift, `quickTileGeometry(Custom, ...)` shows the tile under the cursor outline; on release `finishInteractiveMoveResize` -> `setQuickTileMode(QuickTileFlag::Custom, anchor)` -> `workspace()->rootTile(outputAt(anchor))->pick(anchor)` -> `Tile::manage`, assigning to the EXISTING leaf; no code path calls `split` during placement | source-code | kwin/src/window.cpp (`finishInteractiveMoveResize` ~1069-1105, interactive-move outline ~1239-1250, `setQuickTileMode` ~3677, `quickTileGeometry` ~3463), customtile.cpp `RootTile::pick` ~460 | v6.7.4 (identical at v6.7.3) |
| P-27 | KDE bug 466057 "Suggestion: Ctrl+Shift+Drag a window to quickly split a tile" (kwin, component Custom Tiling, reported 2023-02-19, wishlist NOR, first reported in 5.27.0, last modified 2024-08-22): requests exactly the D9.3 dynamic split-on-drop (drag window over another window; target shrinks; new window fills the new region); status CONFIRMED, `Version Fixed/Implemented In` empty (no fix); see-also 464611 and 483759 both RESOLVED INTENTIONAL and do not provide it. Independently retrieved 2026-08-10; not accepted as anything beyond an open wishlist + corroboration of the source-level absence | issue-tracker | https://bugs.kde.org/show_bug.cgi?id=466057 (primary; retrieved 2026-08-10); see-also https://bugs.kde.org/show_bug.cgi?id=464611 and https://bugs.kde.org/show_bug.cgi?id=483759 | as retrieved 2026-08-10 |
| P-28 | Tile scripting API exists but is not baseline configuration: `Workspace.tilingForScreen(output)` and `Workspace.rootTile(output, desktop)` are Q_INVOKABLE; `TileManager.bestTileForPosition(x, y)` is documented "For scripting"; `Tile::manage`, `CustomTile::split`/`remove`/`setRelativeGeometry` are Q_INVOKABLE; driving authored structure requires writing a bespoke KWin script, which is not part of the baseline's documented install/enable/configure path | source-code | kwin/src/scripting/workspace_wrapper.h (`tilingForScreen` ~383-394, `rootTile` ~397-401), tiles/tilemanager.h (`bestTileForPosition` ~50), scripting.cpp qml type registration ~716-719 | v6.7.4 |
| P-29 | No automatic placement of new windows into authored custom tiles: `Window::place`/`Placement` uses the standard placement policy only (default `PlacementCentered`); nothing calls `Tile::manage`/`pick` for a newly opened window without explicit direction | source-code | kwin/src/placement.cpp, kwin/src/window.cpp (`place` ~3427), tiles/tilemanager.cpp; P-20 default | v6.7.4 |
| P-30 | Per-output per-desktop structural scope and persistence/recovery: each `LogicalOutput` gets its own `TileManager` (`Workspace` output add handler); `m_rootTiles` is keyed by `VirtualDesktop`; Tiling Editor operates per target screen (`Main.qml` rootTile(targetScreen, currentDesktop)); on output removal trees are evacuated and on re-add a new `TileManager` reloads the saved config; `PlacementTracker::restore` re-picks the custom tile at the restored geometry for custom-tiled windows after an output-layout change (including the unplug special case at ~97-99) | source-code | kwin/src/workspace.cpp (output change handler ~1430-1480), tiles/tilemanager.cpp (~66-96), placementtracker.cpp (`restore` ~78-141), plugins/tileseditor/qml/Main.qml | v6.7.4 |
| P-31 | Custom quick-tile shortcuts (`customQuickTileWindow`) for Left/Right/Top/Bottom are registered with no default key (0 = unbound); they re-assign the CURRENT window between custom tiles (`handleCustomQuickTileShortcut` -> `nextNonLayoutTileAt`) and do not preselect a target for future windows | source-code | kwin/src/useractions.cpp (~912-918), kwin/src/window.cpp (`handleCustomQuickTileShortcut` ~3634) | v6.7.4 |
| P-32 | Tiling Editor effect: name "Edit Tiles", global shortcut Meta+T (`KGlobalAccel::setGlobalShortcut`), `EnabledByDefault` true; KCM `kwin_tileseditor_config` | source-code | kwin/src/plugins/tileseditor/tileseditoreffect.cpp (~30-34), plugins/tileseditor/metadata.json | v6.7.4 |

### 6.2 Krohnkite

| ID | Claim summary | Type | Source | Version / snapshot |
|---|---|---|---|---|
| K-01 | Fork tag 0.9.9.2 identity; release assets `krohnkite-0.9.9.2-1d7fd74.kwinscript` and `krohnkite.kwinscript`; `package.json` version reads 0.9.8.5 | source-code + packaging | https://codeberg.org/anametologin/Krohnkite.git tag 0.9.9.2; https://codeberg.org/api/v1/repos/anametologin/Krohnkite/releases/tags/0.9.9.2 | commit 1d7fd742 (2025-07-25) |
| K-02 | Canonical esjeon: v0.8.1 (2022-02-14) last release; issue #218 `Krohnkite not functioning on KDE6` (open, 2024-03-08); GitHub fork archived, moved to codeberg | issue-tracker + official-doc | https://github.com/esjeon/krohnkite/releases; https://github.com/esjeon/krohnkite/issues/218 | v0.8.1 / issue as of 2026-08-09 |
| K-03 | README: dynamic tiling; features incl. multi-screen, activities & virtual desktop; layouts; `.kwinscript` install via System Settings; kpackagetool6; git build (go-task/npm/7z); config change requires reboot; do-not-toggle warning; filter recommendations; multi-screen setup; per-screen default layout syntax | official-doc | https://codeberg.org/anametologin/Krohnkite/README.md (tag 0.9.9.2) | 0.9.9.2 |
| K-04 | Shortcut defaults via `ShortcutHandler`: Meta+. / Meta+, ; Meta+J/K/H/L; Meta+Shift+J/K/H/L; Meta+Ctrl+J/K/H/L; Meta+I / Meta+D; Meta+F / Meta+Shift+F; Meta+\ / Meta+\|; Meta+R / Meta+Shift+R; Meta+Return; Meta+T (Tile Layout); Meta+M (Monocle) | source-code | res/shortcuts.qml | 0.9.9.2 |
| K-05 | Driver: binds windowAdded/windowActivated/windowRemoved/currentDesktopChanged/currentActivityChanged/screensChanged/virtualScreenGeometryChanged; `configChanged` not bound ("This doesn't work at all"); `main()` iterates stacking order; un-maximizes newly added windows; `enter()` re-entry guard | source-code | src/driver/kwin/kwindriver.ts | 0.9.9.2 |
| K-06 | Controller/engine: manage/unmanage on add/remove; arrange per screen; directional focus/move confined to current surface (`getNeighborByDirection` on `ctx.currentSurface`); fullscreen -> `NativeFullscreen` (not re-tiled); swap/order within surface; float on drag when `keepTilingOnDrag` off; layout cycle/set; OSD notification | source-code | src/engine/control.ts, engine.ts, window.ts | 0.9.9.2 |
| K-07 | Window wrapper: `visible(srf)` requires `window.output === srf.output`; surface = output + activity + desktop; `shouldIgnore` (specialWindow, plasmashell, ignore lists); `shouldFloat` (float lists, skipPager, modal, transient, non-resizable, utility/dialog/splash) | source-code | src/driver/kwin/kwinwindow.ts | 0.9.9.2 |
| K-08 | Config defaults: layoutPerActivity true, layoutPerDesktop true, floatUtility true, preventProtrusion true, keepTilingOnDrag true, adjustLayout true, monocleMaximize true, directionalKeyFocus true, notificationDuration 1000; default ignoreClass list | source-code | src/driver/kwin/kwinconfig.ts | 0.9.9.2 |
| K-09 | Surface model: id = hash(output name [+@activity][+#desktop]); ignore per screen/activity/desktop; workingArea = clientArea(PlacementArea, output, desktop); `next()` returns null (no auto desktop) | source-code | src/driver/kwin/kwinsurface.ts | 0.9.9.2 |
| K-10 | LayoutStore: per-surface layout entries in memory (not persisted); current layout = `screenDefaultLayout` match or `layoutOrder[0]`; cycle/set | source-code | src/engine/layoutstore.ts | 0.9.9.2 |
| K-11 | Config surface: KConfigXT `config.xml` + `config.ui` (ignore/float/rules, screenDefaultLayout, layoutPerActivity/Desktop, directionalKey, gaps, dock) | source-code | res/config.xml, res/config.ui | 0.9.9.2 |
| K-12 | Metadata: KPackageStructure KWin/Script; Id krohnkite; X-Plasma-API declarativescript 6.0; X-KDE-ConfigModule kcm_kwin4_genericscripted | source-code | res/metadata.json | 0.9.9.2 |
| K-13 | AUR `kwin-scripts-krohnkite-git` 0.9.9.2.r97.g7b53860-1 (maintainer xiota), upstream = codeberg fork; PKGBUILD applies `rootDir` + `ignoreDeprecations: "6.0"` sed patches to tsconfig.json | packaging | https://aur.archlinux.org/packages/kwin-scripts-krohnkite-git (RPC info) + PKGBUILD | 0.9.9.2.r97.g7b53860-1 |
| K-14 | Canonical wiki Installation: `.kwinscript` from KDE Store/Releases; manual `Enable Script Configuration` step reported; settings changes require script restart | official-doc (canonical) | https://github.com/esjeon/krohnkite/wiki/Installation | wiki snapshot 2026-08-09 |
| K-15 | Issue #37 "Support per-screen virtual desktops (KWin 6.7)": documents that `workspace.currentDesktop` only reflects the active output and that `currentSurfaces` built every output's surface from that one desktop, so `arrange()` tiled non-active outputs against the wrong desktop once per-output desktops differ; symptoms: focus steal to another output, stranded/invisible windows on cross-output moves, no source-output re-tile; merged 2026-06-21 (PR #37, merge commit 512e2db, fix 60c4607 using `currentDesktopForScreen`/`setCurrentDesktopForScreen`); fix NOT in tag 0.9.9.2 (verified `git merge-base`), present in master and 0.9.9.3_beta | issue-tracker | https://codeberg.org/anametologin/Krohnkite/issues/37 | issue closed 2026-06-21; tag 0.9.9.2 2025-07-25 |
| K-16 | Issue #43 "FIX: don't touch destroyed Output objects on hotplug/resume" (PR description): reports that KWin destroys Output QObjects on unplug/resume/reconfigure and that stale references could crash KWin (`workspace.clientArea()` via `KWinSurface.workingArea`) or make tiling misbehave afterwards (thrown property read aborts `arrange()`; stale output identity in `KWinWindow.visible()` makes windows invisible to the engine); merged 2026-07-04 (PR #43, merge commit f374250, fix c0ea26f); fix NOT in tag 0.9.9.2 (verified `git merge-base`), present in master and 0.9.9.3_beta. Risk evidence for the pinned baseline only; it does not by itself prove a normal runtime hotplug failure (no pinned integration test run, no authorized observation) | issue-tracker | https://codeberg.org/anametologin/Krohnkite/issues/43 | issue closed 2026-07-04; tag 0.9.9.2 2025-07-25 |
| K-17 | Columns drag surface (the ONLY `drag()` implementation in any layout): `ColumnsLayout::drag` creates a new column at the screen's primary/secondary edge or moves the dragged window before/after a window in an existing column by cursor half; it never splits a target region into two regions; `TilingController::onWindowDragging` calls `layout.drag` only when the current layout implements it; on release Tile/BTree fall back to `onWindowMoveOver` swap-with-window-under-cursor or float-on-drag | source-code | src/layouts/columns.ts (`drag` ~135-244), src/engine/control.ts (`onWindowDragging` ~93-128, `onWindowMoveOver` ~130-169) | 0.9.9.2 |
| K-18 | No authored topology; structure derived from the ordered client set: TileLayout is a fixed Rotate(HalfSplit(Stack,Stack)) master+stack shape (primarySize=numMaster, ratio adjustable); BTreeLayout rebuilds a balanced binary tree from `tileables.length` on every `apply` (`create_parts`); ColumnsLayout is a one-axis column strip with in-memory `windowIds` membership; new windows are appended at a configurable position (`manage` -> `push`/`unshift`/`beside_first` per `newWindowPosition`); there is no leaf-split operation and no preselect/receptacle mechanism anywhere | source-code | src/layouts/tilelayout.ts, btreelayout.ts (`create_parts` ~58), columns.ts, engine/windowstore.ts, engine/control.ts (`onWindowAdded` ~50-69), driver/kwin/kwinconfig.ts (`newWindowPosition`) | 0.9.9.2 |
| K-19 | Persistence: `LayoutStore` (per-surface layout entries) and `WindowStore` (ordered window list) are in-memory only; nothing serializes layout choice, column membership, or window order to disk; on script start the store is rebuilt from config defaults (`layoutOrder[0]` or `screenDefaultLayout`) and the current stacking order | source-code | src/engine/layoutstore.ts (`LayoutStoreEntry` ~21-126, `LayoutStore` ~128-173), src/engine/windowstore.ts, driver/kwin/kwindriver.ts `main()` iteration | 0.9.9.2 |
| K-20 | KWin custom-tile unawareness (composition): `KWinWindow.shouldIgnore`/`shouldFloat`/`commit` never reference KWin tiles or `requestedTile`; `commit` sets `window.frameGeometry` directly; `enforceSize`/`arrangeScreen` re-commit layout geometry for every tiled window on buffer changes, so a window assigned to a KWin custom tile is snapped back to Krohnkite's geometry on the next arrange | source-code | src/driver/kwin/kwinwindow.ts (`shouldIgnore` ~44, `shouldFloat` ~53, `commit` ~148-210), engine/engine.ts (`enforceSize` ~330, `arrangeScreen` ~231-321) | 0.9.9.2 |
| K-21 | README features claim only DWM-like dynamic tiling, floating windows, multi-screen, activities & virtual desktop, and multiple layouts; no authored-structure, preselect, drag-to-split, or persistence claims appear anywhere in the document | official-doc | https://codeberg.org/anametologin/Krohnkite/README.md (tag 0.9.9.2) | 0.9.9.2 |

### 6.3 Companion and composition records

| ID | Claim summary | Type | Source |
|---|---|---|---|
| C-01 | Pager candidate rejected: the D4.5/D5.1 per-output indication gap is closed by the shipped Pager widget on per-output panels (baseline Plasma); no beyond-default widget is required | source-code | P-18, P-19, P-24 |
| C-02 | Window-rule companion rejected: Krohnkite config dialog covers ignore/float; stock Window Rules is baseline Plasma | source-code | K-08, K-11, P-21 |
| C-03 | Shortcut helper rejected: all Krohnkite shortcuts self-registered; cross-screen uses stock KWin shortcuts (README) | source-code | K-04, K-03 |
| X-01 | Shortcut conflicts: Meta+T (KWin Edit Tiles vs Krohnkite Tile Layout), Meta+D (KWin Show Desktop vs Krohnkite Decrease), probable Meta+Return (KRunner scheme vs Krohnkite Set Master); runtime resolution unknown | composition | P-07, P-09, P-11, K-04 |
| X-02 | Krohnkite config application requires reboot; `configChanged` unbound | composition | K-03, K-05, K-14 |
| X-03 | Per-output desktops + Krohnkite: surfaces keyed on active output's current desktop; interaction now established as a mis-key in per-output mode (non-active outputs arranged against the active output's desktop; issue #37 symptoms; fix only post-0.9.9.2); global default unaffected | composition | K-06, K-09, P-05, K-15 |
| X-04 | README references `ActiveMouseScreen` (absent in KWin 6.7.4); Separate Screen Focus already default | composition | K-03, P-10 |
| X-05 | Factual correction of rubric section 5 "Operational semantics": the rubric's provisional description of "Manually predefined Plasma custom tiles" (flat preset grid, not a binary tree, not persistent per-window) does not match KWin 6.7.4 source. Primary source shows recursive both-axis binary sub-trees (`CustomTile::split`), serialization to kwinrc `[Tiling]` per desktop/output, and per-window membership that survives lifecycle. The rubric itself framed the mapping as an evidence question ("never assumed here"), so this correction belongs in the baseline report; the rubric is not edited | composition | P-25, P-26, P-30 |
| X-06 | Single root limitation behind all negative D9 cells for the Krohnkite baseline column: the composed baseline has no functioning persistent authored region topology. Krohnkite provides no authored-structure model (K-18, K-19); stock KWin custom tiles are a persistent topology but are inert under Krohnkite's geometry control (K-20, K-05). Recorded once here; D9.1, D9.2, D9.4, D9.5, D9.6 for that column are facets of this one limitation and must not be double-counted as independent blockers (rubric 9.1 / brief) | composition | K-18, K-19, K-20, K-05, P-25, P-26 |

## 7. Verification Against plan.md unit-02 Acceptance

plan.md reopened `unit-02` verification clause (`## Work Units` table, unit-02
row): "Current source/docs support every capability claim; every structural
workflow element has evidence or an explicit unknown; each required companion
component is justified or recorded unknown; unverified baseline behavior is not
called a failure."

| Clause element | This report |
|---|---|
| Current source/docs support every capability claim | Every cell in sections 3-4A carries evidence IDs from the register (section 6), each with a pinned version/snapshot and retrieval date; all claims derived from source code, official documentation, issue tracker, or packaging. Attempt-02 structural claims (P-25..P-32, K-17..K-21, X-05..X-06) were read from the pinned tag clones (kwin v6.7.4 = v6.7.3 for the tiling/placement surfaces; Krohnkite 0.9.9.2) on 2026-08-10; KDE bug 466057 was independently retrieved 2026-08-10 |
| Every structural workflow element has evidence or an explicit unknown | Section 4A records every D9.1-D9.6 cell with a classification and direct evidence; D4.8-D4.11 are recorded in section 4; the one structural UK cell is D4.10 (stock) because the full persistence/recovery criterion includes the unestablished session-restart window-to-tile assignment (inherits D1.6); no cell relies on documentation silence |
| Each required companion component is justified or recorded unknown | Section 2.3 applies all four rubric tests to the three candidate hypotheses; all rejected with the failing test; companion set is empty; no component was admitted without evidence |
| Unverified baseline behavior is not called a failure | UK cells (D1.6, D4.4 Krohnkite, D4.10 stock, D7.2, X-01, U04-1, U04-3..8) state precisely what evidence is missing; X-03 was resolved by unit-04/attempt-01 with source + issue-tracker evidence (K-15) and is classified MF with a direct evidence record; J9/J10 CB cells are source-evidenced with their root-limitation accounting (X-06); no cell classifies a behavior as CB/MF without a direct evidence record |

Additional plan constraints honored: no live-session interaction or state
change of any kind (no install, no settings read/write, no script load, no
compositor restart); no edits outside this report's scope; no
`sustained-workload-validation` contact; no commit.

## 8. Risks and Notes

- The rubric's stock-Plasma baseline (rubric 3.1, "default install, default
  global shortcuts") does not anticipate two shipped 6.7.4 KWin defaults that
  collide with Krohnkite's documented defaults (Meta+T `Edit Tiles`, Meta+D
  `Show Desktop`). These are runtime conflicts that surface only in the
  composed baseline; unit-05 should treat them as composition friction, not
  either component's isolated capability.
- Source default virtual-desktop count is 1 (`readEntry("Number", 1)`), which
  resolves rubric unknown U4 but may differ from a commonly held expectation
  of 2; the shipped `kwinrc` default on a fresh install is not otherwise
  evidenced.
- KWin 6.7.4 contains a native, user-initiated tiling subsystem (quick tiles,
  custom tile trees, Meta+T tiles editor) that is distinct from dynamic
  automatic tiling; it is stock Plasma capability for D2 and must not be
  conflated with a dynamic tiler in unit-05. Attempt-02 additionally
  established that this subsystem is a recursive persistent binary tree with
  real per-output serialization (P-25), which contradicts the provisional
  "flat preset grid" phrasing in rubric section 5's operational-semantics
  list; the correction is recorded here (X-05) and the rubric is not edited.
  Unit-05 must use the corrected operational model when applying D9.
- Structural gap ownership for unit-05: the J9/J10 gaps are split across the
  comparators - D9.2 (no preselect), D9.3 (no split-on-drop, bug 466057), and
  D9.5 (no auto-placement into authored regions) are stock Plasma/KWin gaps
  (each also absent in Krohnkite); D9.1/D9.4/D9.6 are satisfied by stock Plasma
  and absent in Krohnkite; and the composition adds the finding that Krohnkite
  makes the stock authored topology inert (X-06), so the combined baseline
  cannot satisfy the J9/J10 authored-structure workflow through coherent
  built-in configuration. One root limitation (X-06) underpins all negative
  Krohnkite-baseline D9 cells; unit-05 must not count it more than once.
- The stock-Plasma J9/J10 cells are classified CB from source (D9.2, D9.3,
  D9.5). Under rubric 9.1 a TS journey CB elevates the opportunity from narrow
  to strong only when the evidence shows the failure occurs in the target
  segment's documented normal daily workflow and is not rescued by a
  documented step. The cell-level facts are established here; the daily-workflow
  severity is unit-05's Decision Rule application and may not be assumed from
  this report. A safe unit-04 observation (candidate U04-8) could close the
  remaining runtime question if separately authorized.
- The canonical wiki's `Enable Script Configuration` manual step (K-14) may or
  may not apply to the fork on 6.7.4; recorded UK until unit-04.
- unit-04/attempt-01 resolved U04-2 statically (K-15): per-output desktops
  mis-key 0.9.9.2 surfaces, fixed only post-0.9.9.2; the live per-output
  behavior remains a candidate for a future authorized observation. U04-3/D4.4
  hotplug remains an explicit UK: issue #43 (K-16) is risk evidence for a
  stale-Output crash/mis-tile path in pre-fix code, but no pinned integration
  test was run and no authorized hotplug observation occurred, so the end-to-end
  runtime outcome is unavailable and is not converted into a failure claim.
- All remaining unit-04 candidates are non-destructive observations requiring a
  safe environment and the plan safety gate; none were performed.
