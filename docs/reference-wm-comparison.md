# Reference: Window Manager Behaviour Comparison (bspwm / Hyprland / COSMIC)

Purpose: decision-support reference for the plasma-auto-tiler product surface.
Compares bspwm, Hyprland, and COSMIC across ten window-management behaviours so
that roadmap decisions in `docs/roadmap.md` (Unit 02) follow established
Hyprland/COSMIC precedent over bspwm.

Scope and status: research-only. No live KWin/Plasma testing was authorised and
none was performed. Every KWin-targeted behaviour is labelled
`unproven-until-live`. Claims are labelled `verified` (primary source cited) or
`unverified` (community/secondary source, negative inference, or not confirmed
against a primary source).

## Primary source list

| Tag | Source |
|---|---|
| [B1] | bspwm(1) man page source, `doc/bspwm.1.asciidoc`, https://github.com/baskerville/bspwm/blob/master/doc/bspwm.1.asciidoc |
| [B1-EX] | bspwm example config, baskerville/bspwm master `examples/sxhkdrc` (pinned static fixture, retrieved 2026-08-14; static evidence, not a live run), https://github.com/baskerville/bspwm/blob/master/examples/sxhkdrc |
| [H-Disp] | Hyprland Dispatchers, https://wiki.hypr.land/Configuring/Basics/Dispatchers/ |
| [H-Var] | Hyprland Variables, https://wiki.hypr.land/Configuring/Basics/Variables/ |
| [H-Binds] | Hyprland Binds, https://wiki.hypr.land/Configuring/Basics/Binds/ |
| [H-WR] | Hyprland Window Rules, https://wiki.hypr.land/Configuring/Basics/Window-Rules/ |
| [H-WS] | Hyprland Workspace Rules, https://wiki.hypr.land/Configuring/Basics/Workspace-Rules/ |
| [H-Dw] | Hyprland Dwindle Layout, https://wiki.hypr.land/Configuring/Layouts/Dwindle-Layout/ |
| [H-Ma] | Hyprland Master Layout, https://wiki.hypr.land/Configuring/Layouts/Master-Layout/ |
| [H-Ex] | Hyprland example config, https://github.com/hyprwm/Hyprland/blob/v0.55.2-b/example/hyprland.lua |
| [C-KB] | System76 COSMIC keyboard shortcuts, https://system76.com/support/articles/pop-cosmic-keyboard-shortcuts |
| [C-Bas] | System76 Pop!_OS Basics, https://system76.com/support/articles/pop-basics |
| [C-KR] | cosmic-comp default keybindings, https://github.com/pop-os/cosmic-comp/blob/master/data/keybindings.ron |
| [C-302] | cosmic-epoch issue #302 (sticky windows), https://github.com/pop-os/cosmic-epoch/issues/302 |
| [C-3377] | cosmic-epoch issue #3377 (floating layering), https://github.com/pop-os/cosmic-epoch/issues/3377 |
| [PAT-Shift] | Project-internal source, not an external WM reference: KWin 6.7.3 `src/xkb.cpp` `Xkb::modifiersRelevantForGlobalShortcuts`/`toQtKey` strip the Shift modifier from `Meta+Shift+<digit>` global-shortcut delivery on QWERTY-family layouts (the digit key's Shift level produces a non-letter symbol, so Shift is "consumed" and the letter-only exemption for BUG 370341 does not apply); see `docs/changes/workspace-management-fixes/` for the diagnosis and fix. |

---

## 1. Split/insert on drop and new-window creation; ratio rebalance and balance commands

| Aspect | bspwm | Hyprland | COSMIC |
|---|---|---|---|
| New-window insert | Inserts at focused node or preselection; scheme `automatic_scheme` (`longest_side`/`alternate`/`spiral`) and `initial_polarity` choose direction; `split_ratio` sets ratio. `verified` [B1] | Layout-driven: Dwindle `default_split_ratio`, `split_bias`, `force_split`, `smart_split`, `preserve_split`, `preselect`; Master `new_status`, `new_on_top`, `new_on_active`. `verified` [H-Dw] [H-Ma] | Super+O orientation toggle (`ToggleOrientation`) `verified` [C-KR]; auto-tile insertion into a tile tree `unverified` (community-documented) |
| Drop/insert | No drag reflow; mouse move is `pointer_modifier`+button1 (floating move only). Insertion via `node -n` (to-node), `-s` swap, `-i` receptacle. `verified` [B1] | Drag floats the window, drop re-tiles (`window.drag`); Master `drop_at_cursor`; `move into_group`. `verified` [H-Disp] [H-Ma] | Drag title bar into a tiled zone to dock; drag into a stack to join it. `unverified` (community-documented; not confirmed in a primary source) |
| Ratio rebalance | `-E` (equalize, reset to default) and `-B` (balance) on a node. `verified` [B1] | Dwindle `splitratio` (delta/exact), `togglesplit`, `swapsplit`, `rotatesplit`; Master `mfact`. No "equalize all" command. `verified` [H-Dw] [H-Ma] | No ratio-rebalance command documented. `unverified` (negative inference) |

**`bspc node @/ -B` - VERIFIED TRUE.** `node` is the domain, `@/` is a PATH selector
that selects the root node of the focused desktop ("the root if the path starts
with `/`"), and `-B`/`--balance` is defined as "Adjust the split ratios of the
tree rooted at the selected node so that all windows occupy the same area." [B1]

Agreements: bspwm and Hyprland insert new windows by splitting a tile and both
expose ratio control on the split (`verified`); COSMIC auto-tile insertion is
community-documented only (`unverified`). Differences: only bspwm offers an
explicit one-shot "balance/equalize" of an existing subtree; Hyprland exposes
per-split ratio deltas; COSMIC documents no explicit ratio command (whether it
rebalances implicitly on drop or orientation is `unverified`). Adoption
recommendation: implement a drop reflow that rebalances the affected subtree
(Hyprland behaviour) and do not ship a global "balance" command as a primary
affordance; a future explicit equalize-an-ancestor helper is acceptable but
secondary.

## 2. Floating entry, default geometry, tree relation, focus/stack

| Aspect | bspwm | Hyprland | COSMIC |
|---|---|---|---|
| Floating entry | `state=floating` via rule or `node -t floating`; floating window stays in the tree but "doesn't use any tiling space". `verified` [B1] | `float` rule/effect or `window.float` dispatcher; `move`/`size`/`center` expressions set default geometry. `verified` [H-Disp] [H-WR] | Super+G (`ToggleWindowFloating`). `verified` [C-KB] [C-KR] |
| Default geometry | `rectangle=WxH+X+Y` rule; `honor_size_hints`; `center` rule flag. `verified` [B1] | Expression-based `move`/`size` (e.g. `window_w*0.5`, `monitor_w*0.5`); `persistent_size` remembers last size. `verified` [H-WR] | Not primary-documented. `unverified` |
| Tree relation | Floating window is a leaf; layered `below`/`normal`/`above`, order tiled < floating < fullscreen. `verified` [B1] | Floating windows are outside the tiling layout but in the window stack; z-order via `alter_zorder`. `verified` [H-Disp] | Floating windows always render above tiled windows regardless of focus (intended UX per maintainer). `verified` [C-3377] |
| Focus/stack | Focus follows pointer (`focus_follows_pointer`) or click; per-desktop focus history. `verified` [B1] | `window.focus`, `cycle_next`, focus-follows-mouse opt-in. `verified` [H-Disp] | Per-workspace focus stack (LIFO `IndexSet`). `verified` [C-3377] |

Agreements: floating is a per-window state that coexists with a tiled layout.
Differences: COSMIC hard-fixes floating windows above tiled windows; bspwm keeps
float in-tree with layers; Hyprland is z-order flexible. Adoption
recommendation: float/tile is a per-window toggle (backlog P3 `float-tile-toggle`)
that leaves the tile tree intact; do not tie floating to a distinct layer.

## 3. Sticky / pinned

| Aspect | bspwm | Hyprland | COSMIC |
|---|---|---|---|
| Semantics | `sticky` flag = "Stays in the focused desktop of its monitor" (monitor-scoped, not global). `verified` [B1] | `pin` = "show it on all workspaces"; "pinning is ignored for non-floating windows". `verified` [H-WR] | Sticky windows always stay on top and are excluded from tiling (design intent). `verified` [C-302] |
| Tiling interaction | Sticky is orthogonal to state; no exclusion from tiling stated. `verified` [B1] | Pin requires floating. `verified` [H-WR] | Sticky windows are not tiled. `verified` [C-302] |

Agreements: all three have a per-window persistence concept. Differences: scope
(bspwm monitor-level vs Hyprland/COSMIC all-workspaces) and tiling interaction
(COSMIC excludes sticky from tiling; Hyprland requires floating). Adoption
recommendation: sticky means "pinned across all workspaces, floating only"
(Hyprland/COSMIC), matching backlog P3 `sticky-floating-windows`.

## 4. Maximize vs fullscreen; workspace scope; tree/tile effect

| Aspect | bspwm | Hyprland | COSMIC |
|---|---|---|---|
| Fullscreen | `fullscreen` state "Fills its monitor rectangle and has no borders". `verified` [B1] | `window.fullscreen` mode `fullscreen`; `fullscreen_state` internal/client `0 none/1 maximize/2 fullscreen/3 both`. `verified` [H-Disp] | Super+F11 `Fullscreen`. `verified` [C-KB] [C-KR] |
| Maximize | None (no maximize state; `monocle` is a desktop layout, not per-window). `verified` [B1] | `window.fullscreen` mode `maximized` (distinct from fullscreen); `layout_aware` selects layout vs default handling. `verified` [H-Disp] | Super+M `Maximize` (distinct from Super+F11). `verified` [C-KB] [C-KR] |
| Workspace scope | Fullscreen per monitor/desktop. `verified` [B1] | Fullscreen is per-monitor; `layout_aware=false` covers bars, `true` respects layout. `verified` [H-Disp] | Per-workspace/window. `unverified` (maximize semantics not primary-documented) |
| Tree/tile effect | Fullscreen exits the tile arrangement without destroying the tree. `verified` [B1] | Fullscreen covers; on exit returns to tile position. `verified` [H-Disp] | Fullscreen is a separate focus surface (`KeyboardFocusTarget` fullscreen variant). `verified` [C-3377] |

Agreements: fullscreen is a separate, monitor-filling state orthogonal to the
tile tree. Differences: Hyprland and COSMIC expose maximize as a distinct state;
bspwm does not. Adoption recommendation: implement maximize (respects the tile
area/workspace) and fullscreen (covers everything) as distinct states, matching
Hyprland `fullscreen_state` and COSMIC Super+M/Super+F11.

## 5. Groups / stacked / tabbed; membership and active affordance

| Aspect | bspwm | Hyprland | COSMIC |
|---|---|---|---|
| Support | None. One window per node; `monocle` shows one window at a time, no tabs. `verified` [B1] | Groups: `group.toggle/next/prev/active/lock`, `move into_group/out_of_group`; group window rules (`set`/`new`/`barred`/`lock`). `verified` [H-Disp] [H-WR] | Stacks: Super+S toggles; tabs at top of stack; Super+Left/Right switch; new windows join active stack. `verified` [C-Bas] |
| Active affordance | N/A | Group header/tab (group bar). `verified` [H-Disp] | Tabs at top of stack. `verified` [C-Bas] |

Agreements: Hyprland and COSMIC both provide tabbed grouping as a tile-level
construct. Differences: bspwm has none (monocle only). Adoption recommendation:
adopt tabbed groups/stacks with an active-tab affordance as the remedy for the
KWin geometry-floor overflow (see `docs/handover.md` section 12), following
COSMIC stacks and Hyprland groups.

## 6. Drag/drop previews

| Aspect | bspwm | Hyprland | COSMIC |
|---|---|---|---|
| Visual preview | No drop preview; `presel_feedback`/`presel_feedback_color` draws the preselection area only. `verified` [B1] | No overlay drop preview documented; drag floats and drop re-tiles live. `unverified` (negative inference) | Zone/stack drop target implied; visual split highlight not primary-documented. `unverified` |
| Drop model | Insert/preselect by command; pointer move only. `verified` [B1] | Live reflow on drop (`window.drag`); `drop_at_cursor` for master. `verified` [H-Disp] [H-Ma] | Drag into zone docks; drag into stack joins. `unverified` |

Agreements: reflow/dock happens at drop; bspwm's `presel_feedback` is the only
primary-verified visual insertion affordance among the three. Whether Hyprland or
COSMIC draw a drop overlay is `unverified` (negative inference / community only),
so no reference-WM precedent for a drop preview is established here.
Differences: bspwm is command/preselect-driven, Hyprland reflows live, COSMIC
docks into zones/stacks (COSMIC `unverified`). Adoption recommendation
(autonomous, per Unit 02 roadmap): ship a drop-destination overlay/preview
rectangle plus drop-time reflow. The preview rectangle is a product requirement,
not a reference-WM precedent; its nearest grounded analogue is bspwm's
preselection feedback area ([B1]). Live-reflow-as-preview remains deferred
(`docs/handover.md` section 6).

## 7. Dynamic workspaces

| Aspect | bspwm | Hyprland | COSMIC |
|---|---|---|---|
| Creation | Fixed desktops; add via `monitor -a`/`--add-desktops`/`--reset-desktops`. `verified` [B1] | Created on demand (`focus workspace`, `move workspace`); `on_created_empty` hook. `verified` [H-Disp] [H-WS] | Dynamic creation community-described; not stated in [C-Bas]. `unverified` |
| Removal | Manual only (`desktop -r`); no auto-remove. `verified` [B1] | Removed when empty unless `persistent` rule. `verified` [H-WS] | Pin keeps a workspace alive when empty ([C-Bas]); auto-remove of empty unpinned not stated (`unverified`) |

Agreements: Hyprland is dynamic with a `persistent` opt-in (`verified`); COSMIC
supports pinning a workspace to keep it alive when empty ([C-Bas], `verified`),
but its auto-create/remove of empty workspaces is `unverified`. bspwm is fixed.
Adoption recommendation: dynamic workspaces created on demand and removed when
empty-and-inactive, with pin/persist, matching Hyprland `persistent` and COSMIC
"pin workspaces" (backlog P2 `dynamic-workspaces`).

## 8. Default shortcuts (focus / move / resize / orientation / float / fullscreen / maximize / workspace)

| Action | bspwm | Hyprland | COSMIC (default, enforced) |
|---|---|---|---|
| Focus | No built-in bind; via sxhkd example. `unverified` (not fetched) | No built-in bind; example uses `mainMod + arrows`. `verified` [H-Ex] | Super + arrows. `verified` [C-Bas] |
| Move | sxhkd example. `unverified` | Example `mainMod + SHIFT + [0-9]` to workspace. `verified` [H-Ex] | Super + Shift + arrows. `verified` [C-Bas] |
| Resize | `pointer_modifier`+button2/3. `verified` [B1] | `mainMod + mouse:RMB` resize bind (example). `verified` [H-Ex] | Super + R / Super + Shift + R. `verified` [C-KB] |
| Orientation | `node -y` cycle split type. `verified` [B1] | `togglesplit` (Dwindle). `verified` [H-Dw] | Super + O (`ToggleOrientation`). `verified` [C-KR] |
| Float | `node -t floating`. `verified` [B1] | `mainMod + V` float toggle (example). `verified` [H-Ex] | Super + G (`ToggleWindowFloating`). `verified` [C-KR] |
| Fullscreen | `node -t fullscreen`. `verified` [B1] | `fullscreen` dispatcher. `verified` [H-Disp] | Super + F11 (`Fullscreen`). `verified` [C-KR] |
| Maximize | none. `verified` [B1] | `fullscreen` mode maximized. `verified` [H-Disp] | Super + M (`Maximize`). `verified` [C-KR] |
| Workspace | `desktop -f`. `verified` [B1] | `focus workspace` (example `mainMod + [0-9]`). `verified` [H-Ex] | Super + W (overview), Super + Ctrl + up/down. `verified` [C-Bas] |

Agreements: orientation/float/fullscreen/maximize all exist in Hyprland and
COSMIC. Differences: only COSMIC ships enforced defaults; bspwm and Hyprland are
config-driven (sxhkd / lua). Adoption recommendation: ship a sane default
H/J/K/L-compatible catalog (resolving backlog P3 `focus-right-keybinding`),
following COSMIC's shipped-defaults precedent while keeping Hyprland-style
`move = focus + shift` and `workspace = mod + number`.

## 9. Gaps, borders, rounded corners, active indication

| Aspect | bspwm | Hyprland | COSMIC |
|---|---|---|---|
| Gaps | `window_gap`; monocle padding settings. `verified` [B1] | `gaps_in`, `gaps_out`, `gaps_workspaces`; per-workspace override. `verified` [H-Var] [H-WS] | Configurable gaps between tiled windows. `unverified` (community-documented; no numeric primary source) |
| Borders | `border_width`; `normal/active/focused_border_color`. `verified` [B1] | `border_size` (default 1); `col.active_border`/`col.inactive_border`. `verified` [H-Var] | Window decorations; active window border highlight ("Active hint"). `verified` [C-Bas] |
| Rounded corners | None (no config key). `verified` (absence in [B1] settings) | `decoration:rounding`; per-window `rounding` override. `verified` [H-Var] [H-WR] | Corner-radius theme setting. `unverified` (community-documented) |
| Active indication | Border colour per focus (normal/active/focused). `verified` [B1] | Active/inactive border gradient + focus. `verified` [H-Var] | "Active hint" highlights active-window border in a chosen colour. `verified` [C-Bas] |

Agreements: gaps and borders are universal. Active indication differs in
mechanism: bspwm and Hyprland colour the active window's border; COSMIC uses a
dedicated opt-in "Active hint" border highlight (user-chosen colour) rather than
a per-focus border-colour scheme. Differences: bspwm lacks rounded corners;
Hyprland supports rounding (`verified`); COSMIC corner-radius is
community-documented (`unverified`). Adoption recommendation: gaps + borders +
rounded corners + active indication (border colour and/or an Active-hint
highlight), following Hyprland/COSMIC.

## 10. Fullscreen games bypassing tiling

| Aspect | bspwm | Hyprland | COSMIC |
|---|---|---|---|
| Behaviour | `fullscreen` state fills monitor, no borders; `ignore_ewmh_fullscreen` blocks app-driven transitions. `verified` [B1] | Fullscreen covers; `content` type `game`; VRR/tearing/direct-scanout paths for games. `verified` [H-WR] [H-Var] | Fullscreen is a separate surface (focus target variant), distinct from tiled windows. `verified` [C-3377] |

Agreements: fullscreen is a bypass state orthogonal to the tile tree in all
three; no Wm tears down the tree to show a game. Differences: Hyprland adds
game-specific content/VRR handling. Adoption recommendation: treat fullscreen as
a cover-and-restore state that never mutates the tile tree (`unproven-until-live`
for KWin), matching all three but with Hyprland's game-content nuance deferred.

---

## Decision ledger (autonomous decisions under Hyprland/COSMIC precedent)

| # | Decision | Justification |
|---|---|---|
| 1 | Drop reflow rebalances the affected subtree; no global balance command. | Hyprland reflows on drop [H-Disp]; bspwm's `-B` is command-only [B1]; COSMIC has no explicit balance command (unverified). |
| 2 | Float/tile is a per-window toggle preserving the tile tree; no separate float layer. | Hyprland and COSMIC both float per-window; bspwm floats in-tree. [H-Disp] [C-KR] [B1] |
| 3 | Sticky = pinned across all workspaces, floating only. | Hyprland `pin` and COSMIC sticky; bspwm sticky is monitor-scoped. [H-WR] [C-302] [B1] |
| 4 | Maximize and fullscreen are distinct states. | Hyprland `fullscreen_state` (1/2/3) and COSMIC Super+M vs Super+F11; bspwm has no maximize. [H-Disp] [C-KR] |
| 5 | Tabbed groups/stacks with active-tab affordance for overflow. | COSMIC stacks and Hyprland groups; bspwm offers only monocle. [C-Bas] [H-Disp] |
| 6 | Drop-destination overlay/preview rectangle plus drop-time reflow (live-reflow deferred). | Overlay is a Unit 02 product requirement, not a reference-WM precedent; nearest grounded analogue is bspwm's `presel_feedback` [B1]; Hyprland reflows on drop [H-Disp]; COSMIC dock unverified. |
| 7 | Dynamic workspaces, removed when empty-and-inactive, with pin/persist. | Hyprland `persistent` and COSMIC "pin workspaces"; bspwm is fixed-desktop. [H-WS] [C-Bas] |
| 8 | Ship default shortcuts; use COSMIC-style shipped defaults with Hyprland-style move/workspace modifiers. | Only COSMIC ships enforced defaults; Hyprland/bspwm are config-only. [C-KR] [H-Ex] |
| 9 | Gaps + borders + rounded corners + active indication (border colour and/or Active-hint highlight). | Hyprland supports rounding [H-Var]; COSMIC corner-radius community-documented (unverified); bspwm does not [B1]. |
| 10 | Fullscreen is cover-and-restore, never mutates the tile tree. | All three agree; Hyprland adds game-content handling (deferred). [B1] [H-Disp] [C-3377] |

## Limitations / not primary-source verified

- COSMIC drag-to-dock/drop-split mechanics and any drop preview: community-documented only.
- COSMIC floating default geometry, maximize semantics, gap/rounding numeric settings, and auto-create/remove of empty workspaces: not primary-documented.
- Hyprland "no overlay drop preview" and bspwm "no dynamic workspaces": negative inferences.
- All KWin-targeted behaviours above are `unproven-until-live`.
