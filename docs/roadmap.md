# Roadmap: plasma-auto-tiler intended behaviour (Unit 02)

This file translates `docs/reference-wm-comparison.md` into a concrete
intended-behaviour roadmap. It is documentation only; no code, research, or
other files were changed. Decisions are made autonomously under
Hyprland/COSMIC precedent and recorded as `DECIDED AUTONOMOUSLY under
Hyprland/COSMIC precedent` with their source citation. The cited primary
sources prove reference-WM precedents only; they never prove KWin behaviour.
Every KWin-targeted claim stays `unproven-until-live` even where in-repo static
evidence supports API availability.

Live KWin/Plasma mutations are user-run only: agents cannot perform them.
Carrier, distribution, shortcut-migration, and opt-in decisions remain parked
until the corresponding live evidence or user decision is available.

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
Reference-profile source invariants are statically enforced by `ec07485`; this
does not replace validation against actual reference-WM runtimes.

## Autonomous decision ledger

Continues the ledger in `reference-wm-comparison.md` lines 200-213 (decisions
1-10, all accepted here unchanged). New decisions specific to the roadmap:

| # | Decision | Justification |
|---|---|---|
| 11 | `plasma-auto-tiler-focus-right` targets `Meta+L`, completing the `Meta+H/J/K/L` focus set; the collision with KDE's default lock-screen binding is flagged as a user decision (see Open questions). | The P3 `focus-right-keybinding` entry remains paused pending that user decision; H/J/K/L is the established vim-style scheme already used for the other three directions; COSMIC/Hyprland default to arrows and give no guidance on a KDE built-in collision. [C-KB] [H-Ex] |
| 12 | Float/tile toggle = `Meta+G`; sticky toggle = `Meta+Shift+G`, and sticky implies floating. | COSMIC `Super+G` = `ToggleWindowFloating` [C-KB] [C-KR]; Hyprland example `mainMod+V` float [H-Ex]; COSMIC sticky is "excluded from tiling" [C-302]. No reference-WM default binding exists for sticky, so `Meta+Shift+G` is our own mirror of `Meta+G`. |
| 13 | Maximize = `Meta+M` (per workspace, not sticky); fullscreen = `Meta+F11` (distinct). | COSMIC `Super+M` maximize / `Super+F11` fullscreen [C-KB] [C-KR]; Hyprland `fullscreen_state` 0/1/2/3 separates maximize from fullscreen [H-Disp]. |
| 14 | Split resizing via a resize mode: `Meta+R` enters, `H/J/K/L` (or arrows) step the focused split ratio, `Esc`/`Return` exits. | COSMIC `Super+R` resize [C-KB]; Hyprland `splitratio` delta/exact [H-Dw]; ratio written through `tile.relativeGeometry` (api-surface capability 3). |
| 15 | `PARKED`: group/stack behavior, bindings, and header design await multi-window tile stability proof. | COSMIC offers stack precedent [C-Bas], but it cannot establish KWin shared-tile behavior or choose this product's group interaction. |
| 16 | `REVISITED - PARKED`: generic KCM settings are delivered, but the visual carrier, distribution channel, and Plasma-global shortcut migration are not selected. | Static package research does not prove a supported script/effect bridge, complete client coverage, or a user-acceptable shortcut migration. |

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
- **Implementation boundary:** the default-off plain rectangle outline is
  statically delivered in `83c605a`, using cursor-derived target selection and
  the existing supported outline API; it makes no rich-preview or structural
  mutation claim ([drag destination outline](changes/archive/2026-08-15-drag-destination-outline/plan.md)). Finish-only post-drop reflow and attach diagnostics are also statically delivered in [drag-and-drop reorganisation](changes/drag-and-drop-reorganisation/plan.md), but require user journal evidence before any KWin signal-delivery or reflow acceptance claim. Do not choose a QML carrier, bridge, or declarative conversion before live input and outline evidence.
- **Main KWin risk:** the former zero-event observation was a false attachment
  guard, not proof of KWin non-delivery; documented per-window signal
  attachment and delivery, motion cleanup, stacking, and XWayland behavior
  remain `unproven-until-live`.
- **Status:** intended feedback `DECIDED`; default-off plain outline and
  finish-only post-drop reflow are statically completed; live input, signal
  delivery, reflow, cadence, and rich-carrier acceptance remain `PARKED` (see
  Feasibility spikes).

### 5. Stacked / grouped windows and group indicator UI

- **Parked product design:** tabbed groups are a candidate tile-level construct
  (decision 5, reference doc line 208), but member presentation, controls, and
  bindings are not selected. The former shared-geometry proposal cannot be
  treated as a remedy for geometry-floor overflow before live stability proof.
- **Group indicator UI:** a header bar is a future product design, not yet a
  selected QML implementation. KWin provides no native tab/stack UI (handover
  section 12), and carrier selection follows the separate live proof.
- **Bindings:** no group binding is selected; `Meta+S` and the `Meta+Tab` pair
  are only prior candidates (see parked decision 15).
- **Implementation boundary:** do not assign a second window to a Custom Tile
  until a live stability spike proves cardinality, geometry, stacking, focus,
  close, reconstruction, maximize, fullscreen, and float recovery
  ([stacked-window feasibility](changes/archive/2026-08-14-stacked-window-feasibility/research/feasibility.md)).
- **Main KWin risk:** multi-window-per-tile stability is `unknown` and the
  pinned source carries an evacuation-design TODO (handover section 12).
- **Status:** group/header implementation `PARKED` pending the stability spike
  and later group/header design.

### 6. Dynamic workspaces

- **Decided semantics:** workspaces created on demand and removed when empty
  and inactive, with pin/persist opt-in (decision 7, reference doc line 210;
  Hyprland `persistent` [H-WS], COSMIC "pin workspaces" [C-Bas], bspwm fixed
  [B1]). Implemented statically as the three-mode `workspaceMode` model
  (`per-output-local` default, `global-unique`, `shared`) in
  [multi-output-workspaces-and-shortcuts](changes/archive/2026-08-14-multi-output-workspaces-and-shortcuts/).
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
  per mode. Switch-only cleanup of eligible invisible empty workspaces is
  statically delivered in `d6d52a5`
  ([empty-workspace switch cleanup](changes/archive/2026-08-15-empty-workspace-switch-cleanup/plan.md)); live multi-output and pager confirmation remains separate.
- **Main KWin risk:** static tests cover create/remove and switch-only removal
  of an owned empty non-active-non-visible desktop, but live KWin/Plasma
  multi-output and pager behavior remains `unproven-until-live`.
- **Status:** `DECIDED`; create/remove statically implemented; live
  confirmation `unproven-until-live`.

### 7. Full keyboard shortcut scheme, including split resizing

Documents the target for paused backlog P3 `focus-right-keybinding`. Replaces
`plasma-auto-tiler-focus-right` = `Meta+Alt+Ctrl+L` with `Meta+L`
(`kwin/src/controller.ts:835-840`). The full directional scheme is H/J/K/L
first, arrows as aliases, `Shift` for move, per COSMIC shipped-defaults
precedent with Hyprland-style `move = focus + Shift` (reference doc line 164).
Registration is catalog-driven under the selected profile (default `cosmic`;
config key `shortcutProfile`), so the selected-profile catalog replaces the
earlier blended project shortcut decision: only validated catalog rows
register, and rows colliding with Plasma stay shadowed until the separately
gated installer/KCM migration exists
([multi-output-workspaces-and-shortcuts](changes/archive/2026-08-14-multi-output-workspaces-and-shortcuts/)).

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
- **Feasibility and mechanism:** script geometry writes cannot draw borders or
  corners. Declarative active-border research finds that `SceneEffect` replaces
  the scene, making a declarative border a full scene-reconstruction task rather
  than a transparent overlay; it is parked, not a selected carrier
  ([research](changes/archive/2026-08-15-active-border-declarative-feasibility/research/feasibility.md)). Native C++ compositor effects remain the leading path, not a carrier selection or proof of rounding.
- **Documented limitation:** the effect is compositing-gated and direct-scanout
  / fullscreen surfaces may bypass it, so borders/corners may not appear on
  fullscreen games (consistent with feature 9). KWin's own native "Rounded
  corners" effect is community-known but not primary-verified in this repo
  (`unverified`).
- **Toolchain and live gate:** select the native effect/toolchain and dependency
  scope before implementation. If that changes `devenv.nix`, restart the session
  before assuming the dependencies are available. Then prove discovery,
  enablement, reload, geometry, stacking, cleanup, and the complete Qt, CSD,
  non-Qt, XWayland, maximized, and fullscreen matrix.
- **Status:** intended all-window treatment `DECIDED`; active border, rounded
  corners, carrier selection, and the complete client matrix `PARKED`.

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

- **Delivered static work:** generic KCM settings are delivered in `2198382`;
  the installer dry-run is delivered in `f5e6907` and is inspection-only. The
  latter did not select a release channel, apply mode, uninstall policy, or
  shortcut migration ([installer evidence](changes/archive/2026-08-14-installer-dry-run/plan.md)).
- **Parked composition:** do not select one package, a QML effect, native C++,
  or a script/effect bridge until the rectangle-outline and visual carrier
  spikes establish the supported path.
- **Package artifact blocker:** package-feasibility research defines a future
  deterministic four-file artifact only; no package artifact is built or
  delivered. The selected install path must first accept its archive extension,
  and `kpackagetool6` plus ZIP creation/inspection tooling must be added to
  `devenv.nix`; restart the session before using newly declared dependencies
  ([research](changes/archive/2026-08-15-distribution-package-feasibility/research/feasibility.md)).
- **Parked user decision:** select the distribution channel and policy for
  conflicting Plasma-global shortcut migration. No agent may make either
  decision from static evidence.
- **Status:** settings and dry-run `completed`; composition, distribution, and
  shortcut migration `PARKED`.

## Feasibility spikes (PARKED)

Each preserves its decision; only implementation viability needs a KWin test.

| Spike | Feature | Why parked |
|---|---|---|
| PARKED-1 | Drop rectangle outline (feature 4) | The default-off plain outline is statically delivered; prove live drag input, outline behavior, XWayland, and cadence before deciding whether rich QML is needed or supported. |
| PARKED-2 | Multi-window tile stability (feature 5) | Prove shared-tile membership and recovery before deciding group behavior or header design; header carrier validation is a separate later proof. |
| PARKED-3 | Dynamic workspace create/remove (feature 6) | The static three-mode implementation in [multi-output-workspaces-and-shortcuts](changes/archive/2026-08-14-multi-output-workspaces-and-shortcuts/) covers create/remove; the spike would only confirm live-host behavior, which stays `unproven-until-live`. |
| PARKED-4 | All-window border/corner carrier (feature 8) | Declarative active-border research is archived and parked at the scene-reconstruction boundary. Select the native effect/toolchain and dependencies, restart after any `devenv.nix` change, then prove the full client matrix before selecting a carrier. |

## Pending Live Acceptance And Parked Decisions

All live entries require a user-run session and separate mutation authorization;
agents cannot perform host mutations.

| Item | Required evidence or decision | State |
|---|---|---|
| Delivered KCM/config and split targets | Exercise generic KCM rendering, configuration reload, and automatic split-target selection on the target host. | `unproven-until-live` |
| Core behavior | Stage live acceptance for resize, float/sticky, fullscreen, maximize, workspace modes/shortcuts, and two-output isolation. | `unproven-until-live` |
| Switch-only empty-workspace cleanup | Confirm delivered cleanup behavior across live multi-output and pager states. | `unproven-until-live` |
| Floor-aware rebalancing | In a nested compositor, prove safe single and multi-ancestor ratio writes with fresh decode, then make the opt-in decision. | `PARKED` |
| Reference precedents | Validate intended behavior at actual bspwm, Hyprland, and COSMIC runtimes rather than source/documentation alone. | `PARKED` |
| Active border and rounded corners | Select the native effect/toolchain and dependency scope, then run the full staged live client matrix; restart after any `devenv.nix` change. | `PARKED` |
| Package artifact | Confirm archive extension/install behavior and add the required package and ZIP tooling to `devenv.nix`; restart before using newly declared dependencies. | `PARKED` |
| Distribution and shortcuts | Select a distribution channel and the Plasma-global shortcut migration policy. | `PARKED` |

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
