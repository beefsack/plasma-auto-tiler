# Roadmap: plasma-auto-tiler intended behaviour (Unit 02)

This file translates `docs/reference-wm-comparison.md` into a concrete
intended-behaviour roadmap. It is documentation only; no code, research, or
other files were changed. Decisions are made autonomously under
Hyprland/COSMIC precedent and recorded as `DECIDED AUTONOMOUSLY under
Hyprland/COSMIC precedent` with their source citation. The cited primary
sources prove reference-WM precedents only; they never prove KWin behaviour.
Every KWin-targeted claim stays `unproven-until-live` even where in-repo static
evidence supports API availability.

## Status labels

| Label | Meaning |
|---|---|
| `DECIDED` | Concrete intended behaviour, decided autonomously under Hyprland/COSMIC precedent (source cited). |
| `unproven-until-live` | KWin-targeted claim: correct per precedent but not proven on the live host; no live testing authorised. |
| `PARKED` | Decision preserved, but implementation viability needs a KWin feasibility spike; see Feasibility spikes. |
| `PROPOSED` | Further feature idea only; not decided. |

## Evidence basis

Primary sources are cited by tag and section from
`docs/reference-wm-comparison.md`, whose "Primary source list" (lines 14-31)
holds the URLs. The tags and their sources:

| Tag | Source (URL in reference doc lines 16-31) |
|---|---|
| [B1] | bspwm(1) man page source, `doc/bspwm.1.asciidoc` |
| [H-Disp]/[H-Var]/[H-WR]/[H-WS]/[H-Dw]/[H-Ma]/[H-Ex] | Hyprland wiki dispatchers/variables/window-rules/workspace-rules/dwindle/master + example config |
| [C-KB]/[C-Bas]/[C-KR]/[C-302]/[C-3377] | System76 COSMIC shortcuts/basics, cosmic-comp keybindings.ron, cosmic-epoch issues #302/#3377 |

In-repo KWin evidence is cited from
`docs/changes/integrated-plasma-structural-feasibility/research/kwin-api-surface.md`
("api-surface") and `.../package-composition.md` ("composition"), and
`docs/handover.md` ("handover"). KWin behaviours not established by those
records are `unproven-until-live`.

## Autonomous decision ledger

Continues the ledger in `reference-wm-comparison.md` lines 200-213 (decisions
1-10, all accepted here unchanged). New decisions specific to the roadmap:

| # | Decision | Justification |
|---|---|---|
| 11 | `plasma-auto-tiler-focus-right` becomes `Meta+L`, completing the `Meta+H/J/K/L` focus set; the collision with KDE's default lock-screen binding is flagged as a user decision (see Open questions). | Resolves backlog P3 `focus-right-keybinding`; H/J/K/L is the established vim-style scheme already used for the other three directions; COSMIC/Hyprland default to arrows and give no guidance on a KDE built-in collision. [C-KB] [H-Ex] |
| 12 | Float/tile toggle = `Meta+G`; sticky toggle = `Meta+Shift+G`, and sticky implies floating. | COSMIC `Super+G` = `ToggleWindowFloating` [C-KB] [C-KR]; Hyprland example `mainMod+V` float [H-Ex]; COSMIC sticky is "excluded from tiling" [C-302]. No reference-WM default binding exists for sticky, so `Meta+Shift+G` is our own mirror of `Meta+G`. |
| 13 | Maximize = `Meta+M` (per workspace, not sticky); fullscreen = `Meta+F11` (distinct). | COSMIC `Super+M` maximize / `Super+F11` fullscreen [C-KB] [C-KR]; Hyprland `fullscreen_state` 0/1/2/3 separates maximize from fullscreen [H-Disp]. |
| 14 | Split resizing via a resize mode: `Meta+R` enters, `H/J/K/L` (or arrows) step the focused split ratio, `Esc`/`Return` exits. | COSMIC `Super+R` resize [C-KB]; Hyprland `splitratio` delta/exact [H-Dw]; ratio written through `tile.relativeGeometry` (api-surface capability 3). |
| 15 | Group/stack toggle = `Meta+S`; group member switch = `Meta+Tab` / `Meta+Shift+Tab`. | COSMIC `Super+S` stack toggle and `Super+Left/Right` member switch [C-Bas]; our `Meta+Left/Right` is already focus-neighbour, so member switch uses the free `Meta+Tab` pair (no reference default; see Open questions). |
| 16 | Distribution = one system package carrying a `KWin/Script` (javascript) + a `KWin/Effect` (QML); generic KCM for settings; no systemd service or separate binary for v1. | composition.md C1/C2; one system package may hold several KPackages (upstream precedent `fadedesktop`); overlay preview and border/rounding require an effect (handover section 7). |

## Feature-by-feature roadmap

### 1. Floating windows, float/tile toggle, default geometry

- **Decided semantics:** floating is a per-window state. A floating window
  leaves the tile arrangement but the tile tree is preserved intact (the leaf
  it left is retained, not collapsed). Floating windows render above tiled
  windows regardless of focus, matching COSMIC [C-3377]. There is no separate
  user-managed float layer, tree, or workspace; compositing z-order places
  floating windows above tiled windows (decision 2, reference doc line 205).
- **Toggle:** single binding `Meta+G` (COSMIC `Super+G` [C-KB] [C-KR];
  Hyprland example `mainMod+V` [H-Ex]). The existing separate
  `detach`/`attach` actions (`Meta+Shift+Space` / `Meta+Alt+Shift+Space`) stay
  as tile-tree membership operations; the float toggle is a distinct state.
- **Default geometry:** centered on the window's current output work area at
  60% x 60% of that area, remembering the last floated size per window for the
  session (Hyprland `persistent_size` [H-WR]; COSMIC default geometry is
  `unverified` in the reference doc line 64).
- **Implementation:** a session-local floating set; toggle floats via
  `tile.unmanage(window)` then writes `window.frameGeometry` to the centered
  rect; re-toggle reattaches via `tile.manage(window)` into an available leaf
  (api-surface capability 7).
- **Main KWin risk:** whether KWin's automatic placement or desktop-change
  re-requestTile re-tiles an unmanaged floating window is `unproven-until-live`.
- **Status:** `DECIDED`; KWin surface `unproven-until-live`.

### 2. Sticky floating across workspaces

- **Decided semantics:** sticky = pinned across all workspaces, floating only
  (Hyprland `pin` "show it on all workspaces" and "pinning is ignored for
  non-floating windows" [H-WR]; COSMIC sticky "excluded from tiling" [C-302]).
  Sticky implies floating: toggling sticky on a tiled window floats it first,
  then pins it. Monitor-scoped bspwm sticky is rejected [B1].
- **Binding:** `Meta+Shift+G` (our choice; no reference-WM default binding
  exists, so this is `unverified` as a precedent).
- **Implementation:** set the window's desktop membership to all desktops via
  the scripting desktop surface; mark `unproven-until-live` whether a KWin
  script can set multi-desktop membership for a window on a Wayland session
  with per-screen virtual desktops.
- **Main KWin risk:** multi-desktop window assignment from scripting is
  `unproven-until-live`; per-screen desktops complicate "all workspaces".
- **Status:** `DECIDED`; KWin surface `unproven-until-live`.

### 3. Maximize per workspace, distinct fullscreen

- **Decided semantics:** maximize and fullscreen are distinct states (decision
  4, reference doc line 207). Maximize fills the current workspace/tile area
  only, is explicitly not sticky, and returns the window to its tile on
  un-maximize. Fullscreen is a separate cover-everything state that exits the
  tile arrangement without destroying the tree and restores on exit
  ([B1] [H-Disp] [C-3377]).
- **Bindings:** maximize `Meta+M`, fullscreen `Meta+F11` (COSMIC `Super+M` /
  `Super+F11` [C-KB] [C-KR]).
- **Implementation:** maximize = remember tile assignment then write
  `window.frameGeometry` to workspace bounds; fullscreen = set the window
  fullscreen state and skip it in placement/reflow while set.
- **Main KWin risk:** distinguishing maximize vs fullscreen through the
  scripting surface is `unproven-until-live`; KWin's own maximize/fullscreen
  default bindings may collide (see Open questions).
- **Status:** `DECIDED`; KWin surface `unproven-until-live`.

### 4. Drop destination overlay / preview rectangle

- **Decided semantics:** during a drag, draw a highlighted rectangle over the
  candidate drop-target tile; on drop, reflow the affected subtree. This
  overlay is a product requirement, not a reference-WM precedent (decision 6,
  reference doc line 209); its nearest grounded analogue is bspwm's
  `presel_feedback` area [B1], with drop-time reflow per Hyprland [H-Disp].
  Live-reflow-as-preview stays deferred (handover section 6).
- **Implementation:** the script computes the target tile by hit-testing
  `RootTile::pick(cursorPos)` (api-surface capability 6); a QML `KWin/Effect`
  (`SceneEffect`) renders the preview rectangle using the shared QML engine
  (composition.md Path 2). This raises the composition to C2 (script + effect).
- **Main KWin risk:** drag events do not yet reach the script (handover
  section 5); the overlay rendering is compositing-gated
  (`scriptedeffect.cpp:202-205`).
- **Status:** `DECIDED`; input coupling `PARKED` (see Feasibility spikes).

### 5. Stacked / grouped windows and group indicator UI

- **Decided semantics:** tabbed groups as a tile-level construct (decision 5,
  reference doc line 208). Members of a group share one tile and overlap at
  identical geometry; the active member fills the tile. This is the chosen
  remedy for KWin's geometry-floor overflow (handover section 12).
- **Group indicator UI:** a header bar drawn across the top of the group tile,
  listing each member's icon/title, with the active member highlighted and
  click-to-switch. KWin provides no native tab/stack UI (handover section 12),
  so the product draws its own via the same QML `KWin/Effect`.
- **Bindings:** toggle `Meta+S` (COSMIC `Super+S` [C-Bas]); member switch
  `Meta+Tab` / `Meta+Shift+Tab` (see decision 15).
- **Implementation:** group membership via `Tile::add()` on the multi-window
  `m_windows` list (handover section 12); the header overlay reads membership
  from the shared-engine `Tile.windows` property (api-surface capability 2).
- **Main KWin risk:** multi-window-per-tile stability is `unknown` and the
  pinned source carries an evacuation-design TODO (handover section 12).
- **Status:** `DECIDED`; multi-window stability and header overlay `PARKED`.

### 6. Dynamic workspaces

- **Decided semantics:** workspaces created on demand and removed when empty
  and inactive, with pin/persist opt-in (decision 7, reference doc line 210;
  Hyprland `persistent` [H-WS], COSMIC "pin workspaces" [C-Bas], bspwm fixed
  [B1]). Implemented statically as the three-mode `workspaceMode` model
  (`per-output-local` default, `global-unique`, `shared`) in
  [multi-output-workspaces-and-shortcuts](changes/multi-output-workspaces-and-shortcuts/).
- **Navigation:** `Meta+1..9` focus workspace (Hyprland example `mainMod+[0-9]`
  [H-Ex]); `Meta+Shift+1..9` move focused window to workspace; `Meta+0` focuses
  or creates the mode-defined trailing empty (registered as
  `plasma-auto-tiler-workspace-0` in every profile unless an exact in-profile
  conflict); `Meta+Shift+0` moves the focused window to a newly appended
  workspace (backlog P2 `move-window-to-workspace`).
- **Implementation:** statically implemented in the controller via the
  documented scripting surface (`createDesktop`/`removeDesktop`,
  `setCurrentDesktopForScreen`, `Window.desktops`); the script keeps a
  session-only output-to-desktop map and automatic trailing-empty maintenance
  per mode. Live-host confirmation remains separate.
- **Main KWin risk:** static tests cover create/remove and the auto-remove of
  an owned empty non-active-non-visible desktop, but live KWin/Plasma behavior
  remains `unproven-until-live`.
- **Status:** `DECIDED`; create/remove statically implemented; live
  confirmation `unproven-until-live`.

### 7. Full keyboard shortcut scheme, including split resizing

Resolves backlog P3 `focus-right-keybinding`. Replaces
`plasma-auto-tiler-focus-right` = `Meta+Alt+Ctrl+L` with `Meta+L`
(`kwin/src/controller.ts:835-840`). The full directional scheme is H/J/K/L
first, arrows as aliases, `Shift` for move, per COSMIC shipped-defaults
precedent with Hyprland-style `move = focus + Shift` (reference doc line 164).
Registration is catalog-driven under the selected profile (default `cosmic`;
config key `shortcutProfile`), so the selected-profile catalog replaces the
earlier blended project shortcut decision: only validated catalog rows
register, and rows colliding with Plasma stay shadowed until the separately
gated installer/KCM migration exists
([multi-output-workspaces-and-shortcuts](changes/multi-output-workspaces-and-shortcuts/)).

| Action | Identifier | Sequence | Precedent |
|---|---|---|---|
| Focus left/down/up/right | `plasma-auto-tiler-focus-{left,down,up,right}` | `Meta+H` / `Meta+J` / `Meta+K` / `Meta+L` | vim-style H/J/K/L; `Meta+L` replaces `Meta+Alt+Ctrl+L` |
| Focus (arrow aliases) | `plasma-auto-tiler-focus-{left,down,up,right}-arrow` | `Meta+Left` / `Meta+Down` / `Meta+Up` / `Meta+Right` | COSMIC Super+arrows [C-Bas] |
| Move left/down/up/right | `plasma-auto-tiler-move-{left,down,up,right}` | `Meta+Shift+H/J/K/L` | Hyprland move = focus + Shift [H-Ex] |
| Move (arrow aliases) | `plasma-auto-tiler-move-{left,down,up,right}-arrow` | `Meta+Shift+Left/Down/Up/Right` | COSMIC Super+Shift+arrows [C-Bas] |
| Insert next window | `plasma-auto-tiler-insert-{right,left,up,down}` | `Meta+Alt+Right/Left/Up/Down` | existing (controller.ts:793-816) |
| Split resize mode | `plasma-auto-tiler-resize-mode` | `Meta+R` | COSMIC `Super+R` [C-KB] |
| Split resize step | (within mode) | `Meta+H/J/K/L` or arrows grow/shrink split ratio; `Esc`/`Return` exit | Hyprland `splitratio` delta [H-Dw] |
| Float/tile toggle | `plasma-auto-tiler-float-toggle` | `Meta+G` | COSMIC `Super+G` [C-KR] |
| Sticky toggle | `plasma-auto-tiler-sticky-toggle` | `Meta+Shift+G` | our choice (decision 12) |
| Group toggle | `plasma-auto-tiler-group-toggle` | `Meta+S` (component requirement; not registered) | COSMIC `Super+S` [C-Bas] |
| Group next/prev | `plasma-auto-tiler-group-{next,prev}` | `Meta+Tab` / `Meta+Shift+Tab` (component requirement; not registered) | our choice (decision 15) |
| Maximize | `plasma-auto-tiler-maximize` | `Meta+M` | COSMIC `Super+M` [C-KR] |
| Fullscreen | `plasma-auto-tiler-fullscreen` | `Meta+F11` (component requirement; not registered) | COSMIC `Super+F11` [C-KR] |
| Focus workspace | `plasma-auto-tiler-workspace-{1..9}` | `Meta+1..9` | Hyprland `mainMod+[0-9]` [H-Ex] |
| Append + focus workspace | `plasma-auto-tiler-workspace-0` | `Meta+0` | registered; per-mode append/focus trailing empty |
| Move to workspace | `plasma-auto-tiler-move-workspace-{1..9}` | `Meta+Shift+1..9` | Hyprland example [H-Ex] |
| Move to appended workspace | `plasma-auto-tiler-move-workspace-append` | `Meta+Shift+0` | backlog P2 |
| Detach / attach | `plasma-auto-tiler-detach` / `-attach` | `Meta+Shift+Space` / `Meta+Alt+Shift+Space` | existing (controller.ts:913-924) |
| Fill scope | `plasma-auto-tiler-fill-scope` | `Meta+Alt+Return` | existing (controller.ts:925-930) |
| Presets | `plasma-auto-tiler-apply-{columns,rows,balanced-grid,dwindle}` | `Meta+Alt+1..4` | existing (controller.ts:931-954) |

- **Split resizing mechanics:** entering resize mode arms ratio stepping on the
  focused leaf's ancestor split; each `H/J/K/L` press writes
  `tile.relativeGeometry` by a fixed step (e.g. 0.05) toward that direction,
  subject to KWin's `minimumSize` (api-surface capability 3).
- **Main KWin risk:** `Meta+L`, `Meta+M`, `Meta+F11`, `Meta+S`, `Meta+Tab` may
  collide with KWin/Plasma built-ins; only `Meta+L` (lock screen) is a
  well-known default, the rest are `unproven-until-live`.
- **Not registered in this change:** `group-toggle`, `group-{next,prev}`, and
  `fullscreen` are component requirements only - they are catalogued (never
  implemented) and never register or resolve in any profile; previous/next
  workspace needs a workspace-mode unit. Registration of these bindings awaits
  the corresponding feature components (features 3, 5).
- **Status:** `DECIDED`; built-in collisions `unproven-until-live`.

### 8. Active window border and curved corners for ALL windows

- **Decided semantics:** an active-window border (focus-coloured) plus rounded
  corners, applied uniformly to every managed window including X11/XWayland and
  non-Qt clients (Ghostty). Active colour follows focus (Hyprland active/
  inactive border [H-Var]; COSMIC "Active hint" [C-Bas]; bspwm border colour
  [B1] - decision 9, reference doc line 212).
- **Feasibility and mechanism:** only a compositor-level `KWin/Effect` reaches
  every window regardless of client engine, because effects operate on
  `EffectWindow` (api-surface capability 6 note). Script geometry writes cannot
  draw borders or corners. The effect is a QML `SceneEffect` in the same system
  package (composition.md C2); if QML cannot clip per-window corners on
  XWayland content, a native C++ effect compiled against pinned KWin is the
  fallback (composition.md Path 4).
- **Documented limitation:** the effect is compositing-gated and direct-scanout
  / fullscreen surfaces may bypass it, so borders/corners may not appear on
  fullscreen games (consistent with feature 9). KWin's own native "Rounded
  corners" effect is community-known but not primary-verified in this repo
  (`unverified`).
- **Distribution mechanism:** shipped as a `KWin/Effect` KPackage in the one
  system package (decision 16); enabled via Desktop Effects KCM or by the
  installer.
- **Main KWin risk:** per-window corner clipping of XWayland content is
  `unproven-until-live`.
- **Status:** `DECIDED`; QML-clipping viability `PARKED`.

### 9. Fullscreen games never tiled / resized / disturbed

- **Decided semantics:** fullscreen is cover-and-restore; the controller never
  tiles, resizes, or reflows a fullscreen window and never mutates the tile
  tree while fullscreen (decision 10, reference doc line 213; all three WMs
  agree [B1] [H-Disp] [C-3377]). Hyprland's game-content/VRR handling is
  deferred [H-WR] [H-Var].
- **Implementation:** fullscreen windows are treated as ineligible in the
  placement/reflow gate (alongside popups/dialogs), and fullscreen state
  transitions trigger no geometry write.
- **Main KWin risk:** KWin's own fullscreen handling may already unmanage the
  window from the tile; the controller must not fight it - `unproven-until-live`.
- **Status:** `DECIDED`; KWin surface `unproven-until-live`.

### 10. Unified settings dialog

- **Decided semantics:** one settings surface controlling: tiling algorithm
  (preset/dwindle selection), dynamic workspaces (on/off and pin), shortcuts
  (view/remap), and overrides (e.g. class rules auto-float, gaps). A bespoke
  native C++ KCM is not required for v1.
- **Implementation:** KConfigXT via `contents/config/main.xml` plus the generic
  script KCM (`X-KDE-ConfigModule: kcm_kwin4_genericscripted`), storing settings
  in the kwinrc `Script-<id>` group and reading via `readConfig`
  (composition.md lines 237-243). `registerShortcut` actions already surface in
  the standard Shortcuts KCM (api-surface capability 5).
- **Main KWin risk:** the generic KCM supports only simple KConfigXT widgets;
  a rich multi-tab dialog with live shortcut capture would need a custom C++
  KCM (later/optional). Hot-apply without reconfigure is `unproven-until-live`.
- **Status:** `DECIDED`; hot-apply `unproven-until-live`.

### 11. Distribution and one-step install

- **Decided semantics:** primary composition is one system package carrying a
  `KWin/Script` (javascript, tiling logic) plus a `KWin/Effect` (QML, preview +
  border/rounding). One system package may hold several KPackages (upstream
  precedent, composition.md line 316-324). This supersedes script-only C1
  because the roadmap makes the overlay preview and border/rounding mandatory.
- **Rejected for v1:** systemd user service (no IPC needed - `callDBus` is
  outbound-only and the mandatory workflow has no receiver, composition.md
  Path 6); a separate binary / native C++ component (only the fallback for
  border/rounding or an optional KCM/indicator, composition.md Path 4); a
  bespoke C++ KCM (generic KCM suffices).
- **One-step install:** extend `scripts/dogfood-install.sh` to install both
  KPackages (`kwin/scripts/...` and `kwin/effects/...`), write both enable keys,
  and reconfigure once - a single command mirroring the existing
  `install` + `enable` flow.
- **Main KWin risk:** effect enablement and reconfigure reliability, and
  `kpackagetool6` upgrade/removal side effects, are `unproven-until-live`
  (composition.md residual risks).
- **Status:** `DECIDED`; lifecycle `unproven-until-live`.

## Feasibility spikes (PARKED)

Each preserves its decision; only implementation viability needs a KWin test.

| Spike | Feature | Why parked |
|---|---|---|
| PARKED-1 | Drop overlay input coupling (feature 4) | Drag events do not reach the script yet (handover section 5). The C2 effect overlay stays decided; the drag-to-target wiring cannot be implemented until signal delivery is proven. |
| PARKED-2 | Multi-window tile stability + group header (feature 5) | Multi-window-per-tile stability is `unknown` with an evacuation-design TODO (handover section 12); the QML header overlay must be proven to render over shared-geometry members. |
| PARKED-3 | Dynamic workspace create/remove (feature 6) | The static three-mode implementation in [multi-output-workspaces-and-shortcuts](changes/multi-output-workspaces-and-shortcuts/) covers create/remove; the spike would only confirm live-host behavior, which stays `unproven-until-live`. |
| PARKED-4 | All-window corner clipping (feature 8) | Whether a QML `SceneEffect` can clip rounded corners uniformly on XWayland/non-Qt windows is `unproven-until-live`; fallback is a native effect (composition.md Path 4). |

## Further feature ideas (PROPOSED, not decided)

Each is grounded in a real reference-WM feature and is distinct from anything
decided above.

| Idea | Reference-WM support | Status |
|---|---|---|
| Configurable gaps between tiled windows | Hyprland `gaps_in`/`gaps_out` [H-Var]; COSMIC gaps `unverified` | `PROPOSED` |
| Swap vs focus directional bindings | Hyprland `swapwindow` dispatcher; bspwm `-s` swap [B1] | `PROPOSED` |
| Monocle / fullscreen-layout mode | bspwm `monocle` desktop layout [B1] | `PROPOSED` |
| Per-workspace layouts | Hyprland workspace rules / per-workspace override [H-WS] | `PROPOSED` |
| Scratchpad / special workspace | Hyprland `togglespecialworkspace` dispatcher | `PROPOSED` |
| Class rules auto-float | Hyprland window rule `float` [H-WR]; bspwm `state=floating` rule [B1] | `PROPOSED` |
| Multi-output policy | bspwm monitor-scoped sticky [B1]; Hyprland/COSMIC per-monitor workspaces | `PROPOSED` (handover section 15: needs a fresh user decision) |
| Session layout persistence | KWin already persists tile topology to kwinrc `Tiling` (api-surface capability 4); window-to-tile assignment is not persisted | `PROPOSED` |
| Workspace overview | COSMIC `Super+W` overview [C-Bas] | `PROPOSED` |

## Open questions for the user

Only decisions that cannot be made within the Hyprland/COSMIC constraint.

1. **KDE built-in shortcut collisions.** `Meta+L` (focus-right) collides with
   KDE's default lock-screen binding; `Meta+M`, `Meta+F11`, `Meta+S`, and
   `Meta+Tab` may also collide with Plasma built-ins. Hyprland/COSMIC precedent
   does not govern KDE built-ins, and remapping a built-in the user actively
   uses is their call. Either (a) keep these bindings and instruct the user to
    remap the built-ins, or (b) choose alternates. Everything else in the scheme
    is decided.
