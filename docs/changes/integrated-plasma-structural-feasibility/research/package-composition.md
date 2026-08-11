# Package Composition and Version Boundary for Persistent Authored Layout

Source-only research for `unit-02/attempt-01`. This document identifies the
smallest coherent one-product package composition and the exact
supported-versus-version-coupled boundary for the approved
persistent-authored-layout workflow, without selecting an architecture, package
manager, or implementation language. It is review input only; it is not
acceptance evidence and makes no runtime claims.

## Source Pin and Evidence Method

- KWin repository: `https://invent.kde.org/plasma/kwin`, tag `v6.7.3`, commit
  `45ec9a6d0ed312a803ff5658a2a3e61f221566c6` (detached HEAD, clean working
  tree, sparse checkout identical to unit-01).
- Omitted trees (`src/tiles/`, `src/plugins/`, `src/kcms/`, `src/effect/` in
  part) were read with `git show HEAD:<path>`; whole-tree searches used
  `git grep HEAD -- <pattern>`. Line numbers derive from pinned blobs at the
  pinned commit.
- Official documentation used only to corroborate the packaging surface:
  - `https://develop.kde.org/docs/plasma/kwin/` (KWin scripting tutorial,
    accessed 2026-08-10).
  - `https://develop.kde.org/docs/plasma/kwineffect/` (KWin Effects,
    accessed 2026-08-10).
  - `https://develop.kde.org/docs/plasma/kwin/api/` (KWin scripting API
    reference, accessed 2026-08-10).
- No live interaction, install, package change, config change, KWin restart,
  D-Bus call, script load, or test window occurred.

## Scope Restatement

The mandatory workflow surfaces are the ten unit-01 capabilities. This unit
decides which minimal set of loadable KDE components can carry them, how that
set is installed/enabled/configured/upgraded/removed as one product, where
state lives, and what the version boundary is. It does not pick an architecture
(spec non-goal). Because this document recommends an exactly-one proof carrier
(a JavaScript `KWin/Script` KPackage), that recommendation is explicitly scoped
as the smallest reversible proof carrier and composition for the unit-03
protocol only, not a final production architecture, implementation language, or
packaging-manager selection (see "Recommendation for unit-03").

Unit-01 verdicts applied without re-derivation (accepted evidence):
supported = capability 1; version-coupled only = capabilities 2, 3, 7, 8, 9;
runtime-validation required = capabilities 4, 5, 6; absent as a supported
separate-process interface with a bounded native/private route = capability 10.

## Candidate Paths and Their Feasibility

### Path 1 - KWin JS product-owned layout tree plus direct geometry assignment

Rejected. A KWin JS/QML script cannot own a persistent structural tree:

- No tile construction surface exists. `CustomTile` and `Tile` are registered
  as uncreatable QML types (`src/scripting/scripting.cpp:718-719`); the plain-JS
  engine exposes no tile constructor (global set at
  `src/scripting/scripting.cpp:214-252`). A script can only obtain tiles from
  `workspace.rootTile(...)` and its children.
- No persistence write path exists. The script global surface provides
  `readConfig` only (`src/scripting/scripting.cpp:237-251`); a whole-tree search
  of `src/scripting/` found no `writeConfig`, no `QFile`/`QSaveFile`/`QDir`
  exposure to scripts, and no other file-write API (all `QFile` uses in
  `src/scripting/` are internal reads of the script and KConfigXT files).
  A JS-owned tree therefore cannot outlive the session unless a companion
  process persists it (Path 6), which is not "smallest".
- Direct geometry assignment via `window.frameGeometry` write (`WRITE
  moveResize`, `src/window.h:475-480`; `moveResize` at `src/window.h:775`) does
  not create a tile association and does not stop KWin's automatic placement
  (unit-01 capability 7), so authored structure and association semantics are
  lost. This is the anti-goal of capability 8 (preserve authored branches).
- Verdict: not coherent alone; strictly larger and weaker than Path 3.

### Path 3 - Custom Tile integration for persistence and splits (version-coupled)

Core. KWin owns the tree; the product mutates it through the reachable tile
surface and KWin persists it:

- Reachable root: `workspace.rootTile(output, desktop)` (documented
  `\qmlmethod`, `src/scripting/workspace_wrapper.h:396-401`; implementation
  `src/scripting/workspace_wrapper.cpp:495-498`).
- Mutation: `CustomTile::split(LayoutDirection)` (`Q_INVOKABLE`,
  `src/tiles/customtile.h:42`), ratio via `tile.relativeGeometry` (`WRITE
  setRelativeGeometry`, `src/tiles/tile.h:30`), assignment via
  `tile.manage(window)`/`unmanage` (`src/tiles/tile.h:127-128`).
- Persistence: automatic, internal to `TileManager` - a 2000 ms single-shot
  timer started by `paddingChanged`/`layoutModified` serializes to kwinrc group
  `Tiling`, keyed by desktop id then output uuid
  (`src/tiles/tilemanager.cpp:61-74`, `288-295`, `390-405`). Restore on manager
  creation includes a legacy Plasma-6.3 output-id fallback
  (`src/tiles/tilemanager.cpp:288-340`, `279-286`).
- Version-coupled boundary: every tile surface above is reachable in-process
  but is not a documented stable API, and the kwinrc JSON schema is internal
  (see "Version boundary" below).
- Verdict: the mandatory-workflow backbone for a single-package product.

### Path 2 - QML ScriptedEffect/effect surfaces for visual transform and interaction feedback

Optional enhancement, not a mandatory capability. Unit-01 capability 6 is
observation plus hit-testing (signals, `cursorPos`, `RootTile::pick`); no unit-01
mandatory capability requires rendering an overlay. If drag-to-split preview
feedback is later judged mandatory, the mechanism exists:

- Declarative (QML) effects are `KWin/Effect` KPackages with entry
  `contents/ui/main.qml` (`src/plugins/kpackage/effect/effect.cpp:23-42`;
  `src/scripting/scriptedeffect.cpp:246-255`).
- A QML `SceneEffect` renders one delegate per screen, takes QtQuick input
  (`TapHandler`, `MouseArea`), and registers shortcuts/screen edges
  (`src/scripting/scriptedquicksceneeffect.h`; official effect docs,
  accessed 2026-08-10).
- Crucially, effect QML shares the script engine:
  `EffectsHandler::qmlEngine()` returns `Scripting::self()->qmlEngine()`
  (`src/effect/effecthandler.cpp:1562-1564`); the `SceneEffect` delegate is
  created on that engine (`src/effect/quickeffect.cpp:535`). The `org.kde.kwin`
  module, including the `Workspace` singleton with `rootTile`, is therefore
  importable from effect QML (`src/scripting/scripting.cpp:693-719`). A QML
  effect can reach the same version-coupled tile surface a declarative script
  can.
- Limitation: JS scripted effects cannot reach tiles - their global object
  exposes `effects`/`effect`/`KWin`/`Globals` but no `workspace` and no
  `org.kde.kwin` module (`src/scripting/scriptedeffect.cpp:256-272`). Any
  effect-based composition must be QML.
- Robustness caveat: effects are gated on compositing/animation support
  (`ScriptedEffect::supported()` returns `effects->animationsSupported()`,
  `src/scripting/scriptedeffect.cpp:202-205`); scripts have no such gate.
- Verdict: feasible and bounded; not needed for the mandatory workflow.

### Path 4 - Native KWin effect/plugin

Not required. Unit-01 found no mandatory capability absent from both the
scripting/QML route and a bounded route except capability 10 (separate-process
indicator), which is not mandatory for the approved workflow (see "Panel
indicator" below). Per the brief, native C++ is not a performance preference.
A native component would additionally require compiling against the pinned
KWin source because the tile headers are not installed
(`src/CMakeLists.txt:478-552` installs no `tiles/*.h`;
`src/workspace.h:88-90` and `src/window.h:57` only forward-declare the tile
types). It remains the bounded route only if an optional structural indicator
is added.

### Path 5 - Separately packaged Plasma panel applet/indicator

Optional and separable. The approved workspace indicator (per-output current
workspace, archived D4.5/D5.1) is satisfied by the shipped Plasma `Pager`
widget on per-output panels - baseline Plasma, no product component, no
structural-tree state (accepted archived findings; P-18/P-19/P-24 at Plasma
6.7.4). A structural panel indicator (archived D4.11) is optional product
value and is clearly distinct: it would require capability 10, which has no
supported separate-process interface (unit-01; no tile data in the
`org.kde.plasma.window_management` Wayland protocol,
`src/wayland/plasmawindowmanagement.cpp:30`; `org.kde.KWin.getWindowInfo`/
`queryWindowInfo` return geometry/state only, `src/dbusinterface.h:78-87`).

### Path 6 - Bounded shared-state/IPC

Needed only if the optional structural indicator is included. A KWin script
can push state out with `callDBus` (documented global; `src/scripting/scripting.h:115-125`,
implementation `src/scripting/scripting.cpp:301-374`), but it can only make
session-bus method calls; it cannot register a D-Bus object or listen
(no such surface in `src/scripting/`). A receiver is therefore required:
a bespoke session D-Bus service, a plasmashell plasmoid with a native backend,
or shared kwinrc state (an applet can read the `Tiling` JSON directly via
KConfig, version-coupled to the internal schema). For the mandatory workflow,
no IPC is needed at all.

## Composition Matrix

Rows are candidate single-product compositions. Capability cells use the
unit-01 verdict scale; "n/a" means the capability is not mandatory for that
composition's scope. "Lifecycle" summarizes the enable/configure surface count.

| # | Composition (members) | Mandatory capabilities 1-9 | Cap 10 | Lifecycle | State ownership | Verdict |
|---|---|---|---|---|---|---|
| C1 | One `KWin/Script`, javascript (Path 3) | 1 supported; 2,3,7,8,9 version-coupled; 4,5,6 runtime-validation | Not mandatory; Pager covers workspace indication | One KCM entry (KWin scripts) + kwinrc `[Plugins]` key | KWin-native tree persistence (kwinrc `Tiling`); script config via KConfigXT; transient state in-memory | Recommended smallest path |
| C2 | `KWin/Script` + `KWin/Effect` (QML) (Paths 3+2) | Same as C1 | Same as C1 | Two KCM entries (scripts + desktop effects) | Same as C1; effect adds transient visual state | Feasible; only if drag preview feedback becomes mandatory |
| C3 | One `KWin/Effect` (QML) (Path 2 as sole host) | All reachable via shared engine (`Workspace.rootTile`) | Same as C1 | One entry but in Desktop Effects KCM; compositing-gated | Same tree persistence; effect-owned logic | Plausible single package; rejected as smallest (see below) |
| C4 | Script + QML effect + applet + IPC (Paths 3+2+5+6) | Same as C1 | Absent as supported; bounded IPC/native route | Three surfaces + panel add | Adds indicator read path | Optional full product; not smallest |
| C5 | JS-owned tree + direct geometry (Path 1) | Fails 2,4,7,8 (no construction, no persistence, no association) | n/a | One KCM entry | No durable home | Rejected |
| C6 | Native C++ component (Path 4) | No mandatory gap to fill | Not mandatory | Native plugin + potential KCM | - | Not needed; compile-against-source only if Cap 10 indicator added |

C3 rejection detail: a QML effect can technically host the whole workflow, but
it is the visual-effects framework (compositing-gated,
`src/scripting/scriptedeffect.cpp:202-205`), its enablement surface is the
Desktop Effects KCM rather than the window-management scripting KCM, and it is
not the documented home for persistent window-management logic. It is a
superset (rendering) without a mandatory benefit. C1 is smaller and more
robust.

## Recommended Composition: One `KWin/Script` (javascript) Package

### Capability-by-capability classification

| Cap | Surface | Classification | Citation |
|---|---|---|---|
| 1 root/manager lookup | `workspace.rootTile(output, desktop)`; `screens`; `currentDesktopForScreen`; `windowAdded` | Supported (documented QML/JS wrapper) | `src/scripting/workspace_wrapper.h:99-101,156-158,363-368,396-401`; impl `workspace_wrapper.cpp:88-95,441-444,495-498`; shipped-editor precedent `src/plugins/tileseditor/qml/Main.qml:42` |
| 2 enumerate/read structure | `Tile` Q_PROPERTYs/signals (`relativeGeometry`, `tiles`, `windows`, `childTiles`, ...) | Version-coupled | `src/tiles/tile.h:30-40,111-137,151-163`; `RootTile.model` `src/tiles/customtile.h:64` |
| 3 split leaf + ratio | `CustomTile::split`; `tile.relativeGeometry` write | Version-coupled | `src/tiles/customtile.h:42`; `src/tiles/tile.h:30`; editor precedent `Main.qml:236,249-251,263` |
| 4 persist/restore topology | `TileManager` auto-save 2000 ms timer to kwinrc `Tiling`; restore on manager create | Runtime-validation required (version-coupled persistence) | `src/tiles/tilemanager.cpp:61-74,288-340,390-405` |
| 5 keyboard preselection | `registerShortcut` + `workspace.windowAdded` + `tile.manage` | Runtime-validation required | `src/scripting/scripting.h:127`; `src/scripting/scripting.cpp:376-395`; `src/scripting/workspace_wrapper.h:156-158`; `src/tiles/tile.h:127` |
| 6 observe move/resize + hit-test | `Window.interactiveMoveResize*`; `workspace.cursorPos`; `RootTile::pick` | Runtime-validation required | `src/window.h:1512-1514`; emissions `src/window.cpp:1062,1105-1110,1205,1236`; `src/scripting/workspace_wrapper.h:145-149`; `src/tiles/customtile.h:73-74` |
| 7 assign vs raw geometry | `tile.manage/unmanage`; `window.tile` (requested tile); deprecation of `window.tile =` | Version-coupled | `src/tiles/tile.h:127-128`; `src/window.h:595`; `src/window.cpp:3803-3819` |
| 8 preserve authored branches + empty-branch semantics | automatic placement never mutates trees; removal re-flow/evacuation/promotion in-tree; empty-leaf retention | Version-coupled | `src/placement.cpp:34-58`; `src/tiles/customtile.cpp:273-343`; `src/window.cpp:1096-1110` |
| 9 cross-desktop/output rebind | built-in desktop re-requestTile; output hooks `screensChanged`; cross-output custom rebind absent | Version-coupled | `src/workspace.cpp:1101-1114,1431-1452`; `src/window.cpp:3896-3903`; `src/placementtracker.cpp:97-99` |
| 10 separate-process indicator | absent as supported; not mandatory | n/a for C1 | unit-01 capability 10; `src/dbusinterface.h:78-87,182-249`; `src/wayland/plasmawindowmanagement.cpp:30` |

### One-product install/enable/configure/upgrade/removal

Attribution split: what the pinned KWin source documents, what official KWin
documentation documents, and what requires protocol/runtime confirmation. No
side effect is asserted as guaranteed unless a cited source or the official
documentation states it.

- Package format (pinned source): `KWin/Script` KPackage, default root
  `kwin/scripts/`, entry `contents/code/main.js` required for
  `X-Plasma-API=javascript` (`src/plugins/kpackage/scripts/scripts.cpp:13-34`);
  per-session load scans the `kwin-wayland/scripts/` and `kwin/scripts/` data
  dirs (`src/scripting/scripting.cpp:757-784`).
- Install (official docs + pinned source): official KWin documentation
  (accessed 2026-08-10) documents `kpackagetool6 --type=KWin/Script -i <dir>`
  for per-user installation and shows the global data dir as
  `/usr/share/kwin/scripts/` via `kpackagetool6 --type=KWin/Script --list
  --global`; the same page documents listing and installation from System
  Settings > Window Management > KWin scripts. Pinned source documents the
  KCM's package discovery (`src/kcms/scripts/kwinscriptsdata.cpp:25-26`).
  Distro-package placement and upgrade behavior (how a distro system package
  drops files into the global dir, and what an upgrade does to existing files
  and config) is not documented by either source and needs protocol/runtime
  confirmation.
- Enable (official docs + pinned source): official KWin documentation
  documents enabling by writing kwinrc and reconfiguring (`kwriteconfig6 --file
  kwinrc --group Plugins --key <id>Enabled true` followed by `qdbus
  org.kde.KWin /KWin reconfigure`) or via the System Settings toggle. Pinned
  source documents the kwinrc `[Plugins]` `Enabled` key handling, script
  unloading when disabled, and the reload-on-config wiring
  (`src/scripting/scripting.cpp:755,766-779`; reload on `configChanged` at
  `src/scripting/scripting.cpp:683`; the `org.kde.KWin` `/KWin` `reconfigure`
  slot at `src/dbusinterface.h:57`). Whether a reconfigure reliably reloads the
  script within a bounded time without a session restart is not guaranteed by
  the source and needs protocol/runtime confirmation.
- Configure (official docs + pinned source): official KWin documentation
  documents `contents/config/main.xml` (KConfigXT), optional
  `contents/ui/config.ui`, and the `X-KDE-ConfigModule: kcm_kwin4_genericscripted`
  metadata. Pinned source documents the generic config KCM
  (`src/kcms/common/CMakeLists.txt:33-42`), the kwinrc group
  `Script-<pluginName>` (`src/scripting/scripting.cpp:119-122`), and
  `readConfig` (`src/scripting/scripting.cpp:296-299`).
- Upgrade (needs confirmation): neither the pinned source nor the fetched
  official documentation specifies `kpackagetool6` upgrade semantics, whether
  overwriting a package directory is supported, or what happens to kwinrc
  `[Plugins]`/`Script-<id>` keys on upgrade. This requires protocol/runtime
  confirmation; the source only establishes that script config keys live in
  `Script-<id>` and persist independently of package files
  (`src/scripting/scripting.cpp:119-122`).
- Removal (needs confirmation): the pinned source documents script unload on
  disable (`src/scripting/scripting.cpp:774-779`) but not `kpackagetool6`
  removal semantics. Whether package-file removal clears the kwinrc
  `[Plugins]<id>Enabled` and `Script-<id>` keys is not documented by either the
  pinned source or the fetched official documentation; leftover keys are
  expected to remain inert but this needs protocol/runtime confirmation.

### State ownership, persistence, and communications (no unsupported filesystem assumptions)

- Authored topology: owned and persisted by KWin. The script mutates the
  KWin-owned tree; `TileManager` auto-saves to kwinrc `Tiling` (desktop id then
  output uuid, `tiles`/`padding` entries) on a 2000 ms timer
  (`src/tiles/tilemanager.cpp:61-74,288-295,390-405`). The script needs no
  file access and cannot write config files (no `writeConfig`/file API in
  `src/scripting/`).
- Script-configurable product settings: KConfigXT via the generic KCM
  (`Script-<id>` group). These are user-driven; the script cannot
  programmatically persist its own mutable settings.
- Transient state (preselect queue, drag tracking): in-memory JS only,
  session-scoped.
- Communications: outbound session-bus calls only. `callDBus` is documented and
  supported (official API reference; `src/scripting/scripting.cpp:301-374`);
  it needs a receiver/service for any pushed state. Not needed for the
  mandatory workflow.

### callDBus feasibility and receiver/service

- Feasible: yes, documented global, async, up to 9 args plus optional callback,
  reply values passed to the callback; errors are logged
  (`src/scripting/scripting.cpp:301-374`).
- Limitation: outbound only. A script cannot register a D-Bus object or name;
  its own object `/Scripting/Script<id>` exposes `stop`/`run` only
  (`src/scripting/org.kde.kwin.Script.xml`). Any indicator state therefore
  needs a receiver: (a) a bespoke session D-Bus service, (b) a plasmoid with a
  native backend, or (c) the applet reading kwinrc `Tiling` JSON directly
  (shared-config route, version-coupled to the internal schema).
- Not needed for the mandatory workflow; only for an optional structural
  indicator.

### Pager/workspace model versus structural indication

- Workspace indicator (approved, per-output current workspace): satisfied by
  baseline Plasma `Pager` on per-output panels; no product component and no
  structural-tree state (accepted archived findings D4.5/D5.1, P-18/P-19/P-24).
  The `org.kde.KWin.VirtualDesktopManager` D-Bus interface exposes global
  desktop count/ids/current/names (`src/dbusinterface.h:182-249`); per-output
  current desktop is exposed to scripting via
  `workspace.currentDesktopForScreen(output)` (supported,
  `src/scripting/workspace_wrapper.h:363-368`). Neither surface exposes tile
  data.
- Structural indication (tile tree in a panel) is optional and requires
  capability 10 (absent as supported; bounded routes only). The two are kept
  distinct: workspace indication is in-scope and satisfied; structural
  indication is out-of-scope for the smallest composition.

### KDE release coupling and multiple components in one system package

- Version boundary: the product's functional coupling is to KWin's scripting
  and tiles surface at a pinned KWin (6.7.3, Plasma 6.7.x). The tiles
  subsystem is KWin-internal: no `tiles/*.h` is installed
  (`src/CMakeLists.txt:478-552`); `workspace.h`/`window.h` forward-declare only
  (`src/workspace.h:88-90`, `src/window.h:57`). It is a young, evolving API
  (Plasma-6.3 legacy output-id fallback `src/tiles/tilemanager.cpp:279-286`;
  deprecated `window.tile =` compat `src/window.cpp:3803-3819`). Scripts and
  effects have no compile coupling but runtime-couple to the installed KWin.
- One system package, multiple KDE components: yes. KPackage payloads are
  directories; a single distro/system package can carry several
  (`kwin/scripts/<id>/`, `kwin/effects/<id>/`, `plasma/plasmoids/<id>/`).
  Precedent: upstream kwin ships many `KWin/Effect` KPackages in one system
  package (e.g. `src/plugins/fadedesktop/package/metadata.json`,
  installed by `kwin_add_scripted_effect`). The recommended single-script
  composition preserves one user experience because enablement and
  configuration collapse to one KCM entry; adding an effect or applet splits
  the user experience across more surfaces.

### Minimal reversible proof testability

- A single `KWin/Script` package has the smallest reversible footprint: install
  or place the package, set one kwinrc `[Plugins]` key, reconfigure; verify
  capabilities 1-9; then disable by removing the key and reconfigure - the
  source-documented reversible step, since disabled scripts are unloaded
  (`src/scripting/scripting.cpp:774-779`). Package-file removal semantics are
  not source-documented and need protocol confirmation (see lifecycle section).
  Alternatively the script can be loaded and unloaded through the
  `org.kde.kwin.Scripting` D-Bus interface (`loadScript(filePath, pluginName)`
  / `unloadScript(pluginName)`, `src/scripting/scripting.h:333-336`; object
  registered at `src/scripting/scripting.cpp:682`), which leaves no package or
  config residue on the KWin side; live invocation of either route is a
  session interaction requiring unit-04 authorization.
- The optional effect and applet components each add a second enable/configure
  surface (Desktop Effects KCM, panel containment) to revert; the applet is
  the most invasive (panel config changes).
- Any live proof remains gated on unit-03 protocol plus fresh user
  authorization per `spec.md`/`plan.md`; this unit makes no runtime claims.

## Alternatives and Rejection Reasons

- C5 (Path 1, JS-owned tree + direct geometry): rejected - no tile
  construction, no persistence write path, no tile association
  (`src/scripting/scripting.cpp:214-252,718-719`; `src/window.h:475-480,775`).
- C3 (single QML effect): rejected as the smallest - compositing-gated
  (`src/scripting/scriptedeffect.cpp:202-205`), hosted in the visual-effects
  framework and KCM rather than the scripting KCM, with no mandatory benefit
  over C1.
- C2 (script + effect): deferred, not rejected - adopt only if drag-preview
  feedback is made mandatory.
- C4 (full stack with applet + IPC): deferred - only if optional structural
  indication is required.
- C6 (native): not needed; only the bounded route for an optional capability
  10 indicator (compile-against-source because tile headers are not installed).

## Fail-Fast Blocker Assessment

No fail-fast blocker. No mandatory capability is absent from both routes, and
the smallest composition (C1) is coherent: every mandatory surface maps to a
supported or version-coupled in-process route, persistence is KWin-native,
enable/configure is one KCM entry, and no IPC or panel component is required.
Capabilities 4, 5, and 6 remain runtime-validation required and are the proof's
subject; a failed proof would not be a package-composition failure.

## Recommendation for unit-03

Design the minimal reversible proof around exactly one `KWin/Script`
(javascript) package driving the version-coupled Custom Tile surface, with
Pager covering the workspace-indicator side and no effect, applet, native
component, or IPC. This is the explicit version-coupled route, consistent with
unit-01's guidance that no supported-scripting-only proof is claimed; the
script package is the smallest coherent carrier of the version-coupled
surface, not a claim that the tiles surface is a supported scripting API.

Scope of the recommendation: the single JavaScript `KWin/Script` KPackage is
recommended strictly as the smallest reversible proof carrier and composition
for the unit-03 protocol. It is not a final production architecture,
implementation language, or packaging-manager selection. Consistent with
`spec.md`'s architecture-neutral outcome rule, the feasible classification
remains "version-coupled native feasible" with an explicit boundary; unit-03
must produce the protocol for this exactly-one proof carrier, and any later
production packaging decision (distro package, language, plugin form) is a
separate, out-of-scope selection. This reconciliation does not weaken the
exactly-one-path recommendation above.

Include optional, clearly separated addenda only if the Lead/user decides
drag-preview feedback (one QML `KWin/Effect`) or structural panel indication
(capability 10 bridge) are in scope.

## Evidence Map

| Claim | Evidence |
|---|---|
| Single JS script can reach all mandatory capabilities | Capability table above; unit-01 matrix |
| Scripts cannot create tiles or write config/files | `src/scripting/scripting.cpp:214-252,718-719`; no `writeConfig`/file API in `src/scripting/` |
| Persistence is KWin-native and version-coupled | `src/tiles/tilemanager.cpp:61-74,288-340,390-405` |
| `callDBus` documented and outbound-only | official API reference; `src/scripting/scripting.h:115-125`; `src/scripting/scripting.cpp:301-374`; script D-Bus object `org.kde.kwin.Script.xml` |
| Effects share the script QML engine | `src/effect/effecthandler.cpp:1562-1564`; `src/effect/quickeffect.cpp:535` |
| JS effects cannot reach tiles; QML effects can | `src/scripting/scriptedeffect.cpp:256-272` vs `src/scripting/scripting.cpp:693-719` |
| Effect compositing gate | `src/scripting/scriptedeffect.cpp:202-205` |
| Package formats and install paths | `src/plugins/kpackage/scripts/scripts.cpp`; `src/plugins/kpackage/effect/effect.cpp`; `src/scripting/scripting.cpp:757-784`; official KWin docs (`kpackagetool6 -i`, `--list --global` = `/usr/share/kwin/scripts/`, System Settings install) |
| Enable/configure surfaces | kwinrc `[Plugins]` (`src/scripting/scripting.cpp:755,766-779`; `src/kcms/scripts/kwinscriptsdata.cpp:34`); reconfigure slot `src/dbusinterface.h:57`; reload wiring `src/scripting/scripting.cpp:683`; generic config KCM `src/kcms/common/CMakeLists.txt:33-42`; `readConfig` `src/scripting/scripting.cpp:296-299`; `Script-<id>` group `src/scripting/scripting.cpp:119-122`; official KWin docs (kwriteconfig6 + reconfigure, System Settings toggle) |
| Upgrade/removal side effects unverified | not documented in pinned source (`src/scripting/`, `src/plugins/kpackage/`) nor in fetched official KWin docs; requires protocol/runtime confirmation |
| Workspace indicator satisfied by Pager | accepted archived findings D4.5/D5.1, P-18/P-19/P-24 (Plasma 6.7.4) |
| No tile data in supported separate-process interfaces | `src/dbusinterface.h:78-87,182-249`; `src/wayland/plasmawindowmanagement.cpp:30` |
| One system package can hold many KPackages | `src/plugins/fadedesktop/package/metadata.json` + `kwin_add_scripted_effect`; official effect docs |
| Version boundary / headers not installed | `src/CMakeLists.txt:478-552`; `src/workspace.h:88-90`; `src/window.h:57`; `src/tiles/tilemanager.cpp:279-286`; `src/window.cpp:3803-3819` |

## Residual Risks and Uncertainties

- Package lifecycle: `kpackagetool6` upgrade and removal semantics are not
  documented by the pinned source or the fetched official documentation
  (install/`--list` are documented; upgrade/removal are not). Whether package
  files are removed or overwritten, and whether kwinrc `[Plugins]<id>Enabled`
  and `Script-<id>` keys are cleared, requires protocol/runtime confirmation;
  leftover keys are expected to be inert but this is unverified.
- Enablement needs a reconfigure (or session restart) after kwinrc changes;
  the source wires reload on `configChanged`
  (`src/scripting/scripting.cpp:683`), but bounded-time reload behavior is not
  guaranteed and needs protocol/runtime confirmation. During a proof this is a
  live-session interaction requiring unit-04 authorization.
- Version coupling: any KWin update can change the scripting/tiles surface;
  the product must retest per KWin release. Capabilities 4, 5, 6 are
  runtime-validation required and unproven here by design.
- The `kwinrc` `Tiling` JSON schema (group/subgroup keys, `tiles`/`padding`
  entries) is internal; any component reading it directly (optional indicator
  route) couples to that schema and to the 2000 ms save cadence.
- Filename note for the Lead: `plan.md` unit-02 row names the output
  `research/package-composition-boundary.md`; this brief names
  `research/package-composition.md`. This file uses the brief's name; `plan.md`
  was not edited per constraints.

## Scope Compliance

No source application edits. `spec.md`, unit-01 research, backlog, sustained
validation, archive, decisions, technical report, dependencies, `devenv.nix`,
`plan.md`, `state.md`, and `log.md` were not edited. No live interaction,
install, package change, config change, KWin restart, D-Bus call, script load,
or test window occurred. Only this research file was created. No architecture,
package manager, or implementation language was selected.
