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
Unresolved shortcut-migration and opt-in decisions remain parked until the
corresponding live evidence or user decision is available. Active user-approved
decisions are recorded in [Current Decisions](decisions.md).

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
| 15 | `PARKED`: grouped/tabbed windows remain a future goal after active-border delivery and a live multi-window Custom Tile stability proof; group behavior, bindings, and header design remain unselected. | COSMIC offers stack precedent [C-Bas], but it cannot establish KWin shared-tile behavior or choose this product's group interaction. See [Current Decisions](decisions.md#grouped-windows). |
| 16 | `REVISITED - DECIDED`: the active border uses a standalone native C++ effect; Plasma 6.5+ decoration-driven corners are relied on; initial core distribution is one KPackage archive for KDE Store and an identical GitHub Release artifact. | The experimental disabled-by-default OpenGL-only effect and its toolchain are statically complete; user-run live acceptance, packaging, publication, and migration policy remain separate. See [Current Decisions](decisions.md). |

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

- **Parked product design:** grouped/tabbed windows are a future goal after
  active-border delivery and the live multi-window Custom Tile stability proof.
  Member presentation, controls, and bindings are not selected. The former
  shared-geometry proposal cannot be treated as a remedy for geometry-floor
  overflow before that proof ([Current Decisions](decisions.md#grouped-windows)).
- **Group indicator UI:** a header bar is a future product design, not yet a
  selected QML implementation. KWin provides no native tab/stack UI (handover
  section 12), and carrier selection follows the separate live proof.
- **Bindings:** no group binding is selected; `Meta+S` and the `Meta+Tab` pair
  are only prior candidates (see parked decision 15).
- **Implementation boundary:** do not assign a second window to a Custom Tile
  until active-border delivery and a live stability spike prove cardinality,
  geometry, stacking, focus, close, reconstruction, maximize, fullscreen, and
  float recovery
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
  A COSMIC-style trailing-empty invariant is layered on top: exactly one
  empty workspace is always maintained after the populated ones, per
  relevant domain, delivered by
  [trailing-empty-workspace](changes/trailing-empty-workspace/), reversing
  the intervening create-on-demand, no-reuse rule delivered by
  [workspace-management-fixes](changes/archive/2026-08-19-workspace-management-fixes/).
- **Navigation:** `Meta+1..9` focus workspace (Hyprland example `mainMod+[0-9]`
  [H-Ex]); `Meta+Shift+1..9` move focused window to workspace; `Meta+0`
  **reuses** the existing trailing empty workspace when one is present and
  switches to it - a no-op if it is already the current desktop - and
  creates a new one only when no trailing empty exists (registered as
  `plasma-auto-tiler-workspace-0` in every profile unless an exact
  in-profile conflict; reverses the intervening "always creates, never
  reuses" rule - see
  [trailing-empty-workspace](changes/trailing-empty-workspace/));
  `Meta+Shift+0` **reuses** the existing trailing empty to move the focused
  window onto it, creating one only when none exists, same reuse rule
  (backlog P2 `move-window-to-workspace`).
- **Implementation:** statically implemented in the controller via the
  documented scripting surface (`createDesktop`/`removeDesktop`,
  `setCurrentDesktopForScreen`, `Window.desktops`); the script keeps a
  session-only output-to-desktop map. Exactly one trailing empty is
  identified structurally (never cached across dispatches) on every
  `cleanupDesktops()` pass and protected from cleanup; a fresh trailing
  empty is appended only when the current one becomes occupied. All other
  empty-workspace cleanup remains ownership-independent (any non-trailing
  empty desktop that is invisible on every connected output is a removal
  candidate, regardless of who created it) and fires on every
  desktop-lifecycle dispatch event (window add/remove/move/float, drag
  finish, `desktopsChanged`, output disconnect), not only on workspace
  switch. The trailing-empty invariant is delivered by
  [trailing-empty-workspace](changes/trailing-empty-workspace/), reversing
  only the "always create, never reuse, no reserved trailing capacity" rule
  delivered by
  [workspace-management-fixes](changes/archive/2026-08-19-workspace-management-fixes/);
  that change's ownership-independent, broadened-trigger cleanup rule is
  otherwise unchanged and remains in force, itself superseding the earlier
  switch-only, ownership-gated cleanup and trailing-empty-reservation design
  statically delivered in `d6d52a5`
  ([empty-workspace switch cleanup](changes/archive/2026-08-15-empty-workspace-switch-cleanup/plan.md)).
- **Main KWin risk:** live-accepted on the user's real host (by
  [workspace-management-fixes](changes/archive/2026-08-19-workspace-management-fixes/))
  that enabling the plugin's startup sweep removes none of the user's real,
  populated desktops, and that a non-trailing empty desktop invisible on
  every output is auto-removed. The trailing-empty reuse/replenish behavior
  itself ([trailing-empty-workspace](changes/trailing-empty-workspace/)) is
  statically complete but not yet live-accepted on the user's host; whether
  the anti-oscillation design holds under KWin's actual event loop, signal
  re-entrancy, and D-Bus/QML event coalescing is an open residual risk (see
  that change's `plan.md`). Two further specific properties remain covered
  by static test evidence only, not live proof: an empty desktop that is
  currently visible is preserved (live-proving it would require switching
  the user's visible desktop, which is prohibited), and `Meta+0`/
  `Meta+Shift+0` reuse-vs-create behavior under an actual physical key press
  (D-Bus `invokeShortcut` bypasses the xkb layer and proves nothing).
- **Status:** `DECIDED`; the trailing-empty-reuse model and the
  ownership-independent, broadened-trigger cleanup rule are both statically
  implemented; the ownership-independent cleanup rule is live-accepted on
  the user's host; the trailing-empty-reuse behavior's own live acceptance,
  and the two properties above, remain `unproven-until-live`.

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
| Create + switch workspace | `plasma-auto-tiler-workspace-0` | `Meta+0` | registered; reuses the existing trailing empty workspace and switches to it when one is present (no-op if already current), creates a new one only when none exists |
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

### 8. Active window border and rounded corners

- **Decided semantics:** use a standalone native C++ KWin effect for the
  focus-coloured active-window border (Hyprland active/inactive border [H-Var];
  COSMIC "Active hint" [C-Bas]; bspwm border colour [B1]). Rely on Plasma 6.5+
  decoration-driven rounded corners. Universal compositor-enforced rounding for
  CSD, non-Qt, and XWayland clients is a product non-goal for now
  ([Current Decisions](decisions.md#active-window-border)).
- **Feasibility and mechanism:** script geometry writes cannot draw borders or
  corners. Declarative active-border research is archived because `SceneEffect`
  requires scene reconstruction; the selected direction is the native effect.
- **Documented limitation:** direct scanout or fullscreen surfaces may bypass a
  composited border. Decoration-driven corner coverage follows Plasma's
  supported decoration behavior rather than the native effect.
- **Toolchain and live gate:** the required toolchain work and static effect
  verification are complete. Prove effect discovery, enablement, reload,
  geometry, stacking, cleanup, and supported-client behavior through user-run
  live acceptance only.
- **Status:** product direction `DECIDED`; experimental effect and toolchain
  `COMPLETED` statically; package `PARKED`; live acceptance
  `unproven-until-live`.

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
- **Decided composition:** the active border is a standalone native C++ effect.
  The initial core distribution is one KPackage archive for KDE Store and an
  identical GitHub Release artifact ([Current Decisions](decisions.md#core-distribution)).
- **Package artifact work:** one reproducible KPackage archive and SHA-256
  sidecar are statically delivered for both KDE Store and GitHub Release
  publication; publication remains manual. See the [archived
  evidence](changes/archive/2026-08-15-kpackage-distribution/plan.md).
- **Parked user decision:** select only the policy for conflicting Plasma-global
  shortcut migration. No agent may make that decision from static evidence.
- **Status:** settings, dry-run, active-border implementation, and the
  reproducible KPackage artifact are statically `completed`; manual publication
  and shortcut migration remain `PARKED`.

## Feasibility spikes (PARKED)

Each preserves its decision; only implementation viability needs a KWin test.

| Spike | Feature | Why parked |
|---|---|---|
| PARKED-1 | Drop rectangle outline (feature 4) | The default-off plain outline is statically delivered; prove live drag input, outline behavior, XWayland, and cadence before deciding whether rich QML is needed or supported. |
| PARKED-2 | Multi-window tile stability (feature 5) | After active-border delivery, prove shared-tile membership and recovery before group behavior or header design; header carrier validation is a separate later proof. |
| PARKED-3 | Dynamic workspace create/remove (feature 6) | The static three-mode implementation in [multi-output-workspaces-and-shortcuts](changes/archive/2026-08-14-multi-output-workspaces-and-shortcuts/) covers create/remove; the spike would only confirm live-host behavior, which stays `unproven-until-live`. |
| PARKED-4 | Active-window border effect (feature 8) | The experimental standalone native C++ effect is statically complete; retained [evidence](changes/archive/2026-08-15-active-window-border-effect/plan.md) covers the toolchain and static checks. Only user-run supported-client behavior remains. |

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
| Active border and rounded corners | Run staged user acceptance for the statically completed experimental standalone border effect. | `unproven-until-live` |
| KPackage artifact | Publish the statically delivered reproducible archive to KDE Store and as the identical GitHub Release artifact. | `PARKED` |
| Shortcut migration | Select the Plasma-global shortcut migration policy. | `PARKED` |

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
