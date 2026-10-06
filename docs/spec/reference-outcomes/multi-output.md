# Multi-output (reference outcomes)

Part of the [outcome matrix index](../reference-outcomes.md). Notation, profiles, evidence legend, and variant hooks live in the index; `S()`/`D()` keys below resolve there. Scenarios below are GWT with one Then bullet per profile (14).

## 9. Multi-output

Column Given bullets are separate fixtures, never H/V ancestry claims.
karousel two-output fixtures are inapplicable per `S(S-kar-single)`;
paneru legs distinguish the native Space from virtual rows.

### R-OUT-01: move left onto an occupied output

- Given (tree profiles): `L=X`, `R=H[A*,B]`

- Given (column profiles): `L=COL[C0[X]]`, `R=COL[C1[A*],C2[B]]` at shipped
  defaults; viewport recorded. Native verbs (same semantic
  directional move-left as the tree leg above, not explicit
  monitor transfer): niri `MoveColumnLeft`; PaperWM `move-left`;
  paneru `Swap(West)`.

- When: Move A left (occupied target)

- Observe: Cross vs wrap; target split shape

- Then COSMIC: `L=H[X,A]`, `R=B` R4; [S20-01](../../cosmic-move-conformance.md#sequence-s20---horizontal-output-crossing) authored observation
- Then Hyprland/Dwindle: Off-monitor focal transfers via `assignToSpace` to the focal monitor's active workspace; exact L split shape TBD (L work area/X geometry, vertical alignment, and drop half unrecorded). Mechanism: 1px-beyond-edge focal, containing-else-nearest monitor query, fallback default true, then Dwindle re-admission anchor; `S(S-hyp-move)`
- Then bspwm: Crosses to L via configured `-s west --follow`: the west-neighbor search spans all monitors' focused desktops, so X qualifies; cross-monitor node swap puts A sole on L and X in A's R slot (`L=A`, `R=H[X,B]`), `--follow` focuses A on L; exact L split/frames TBD (monitor/X geometry unrecorded); `S(S-bsp-flt-focus)` + `S(S-bsp-flt-swap)`
- Then i3: Crosses to L: workspace-level H has no left swap, so `move_to_output_directed` attaches A to L's visible workspace at TAIL (nodes `[X,A]`, splith embedding `H[X,A]` under default `workspace_layout`); R collapses to sole B; mover-focused follow via `workspace_show` focuses A on L; `S(S-i3-move)` + `S(S-i3-outmove)`; exact L wrapper if L has non-default `workspace_layout` TBD (no custom rules here)
- Then xmonad/Tall+Navigation2D: Exact occupied-target crossing TBD (Tall target geometry unrecorded); analogous policy only: profile move is same-layer `windowSwap` (geometric target via `navigableWindows`; `swap` exchanges stack positions retaining mover focus, miss is no-op with wrap False); cross-screen carry via the separate `windowToScreen` (`W.shift`) verb is not exercised here; exact L split/frames TBD; `S(S-xmo-out)` + `S(S-xmo-nav)` + `S(S-xmo-layout)`
- Then sway: Crosses to L: workspace-level H has no left swap, so the next-output attach moves A to L's active workspace at TAIL (nodes `[X,A]`, splith embedding `H[X,A]` under default `workspace_layout`); R collapses to sole B; focus stays on the mover A on L (no workspace-switch call in this path); `S(S-sway-move)` + `S(S-sway-outmove)`; exact L wrapper if L has non-default `workspace_layout` TBD (no custom rules here)
- Then qtile/Columns: No-op: leftmost sole-column A has no adjacent column and no shared column to split, so shuffle_left returns with tree and focus unchanged; no directional cross-screen carry in Columns (screen placement is togroup/toscreen, not exercised here); `S(S-qti-shuffle)` + `S(S-qti-group)`
- Then awesome/tile: Profile directional move is `swap.global_bydirection` (local `swap.bydirection` miss then screen cross; single-output miss is no-op). From A west local misses (A leftmost), global crosses to L: A/X screen exchange with tile recalc on both screens (L becomes A sole full tile, R admits X into A's slot); mover focus retained (swap has no focus write; global re-activates mover); exact R order/frames and tag-visibility journey TBD; `S(S-awe-swap)` + `S(S-awe-focus)` + `S(S-awe-tile)`
- Then niri: stays (`move_left` reorders strip columns and returns
  false at index 0; A is already first, so no reorder and no cross;
  crossing needs the separate `MoveColumnToMonitor*` verb, an
  R-OUT-04 leg). `S(S-nir-move)` + `S(S-nir-mon)`.
- Then PaperWM: stays (`move-left` is same-space `swap(LEFT)` and
  returns at the first column; no cross; crossing needs
  `switchMonitor`/`moveToMonitor`, R-OUT-04 legs).
  `S(S-pap-mon)`.
- Then karousel/Lazy: fixture-inapplicable (single-screen profile; no
  counterpart). `S(S-kar-single)`.
- Then paneru: stays (`Swap(West)` resolves a same-strip peer and A
  has none; West/East never fall through to another display, only
  North/South do). `D1`/`D2` displays keep their strips.
  `S(S-pan-swap)`.
- Then Ours KDE: Exhausted horizontal R4 into output's current workspace; same commit/fence protocol as send; `D(D-dec-cos)` offline only
- Then Ours Windows: Exhausted horizontal R4 into output's current workspace; same commit/fence protocol as send; `D(D-dec-cos)` offline only
- Variant hook: V-R4-DIR.

### R-OUT-02: perpendicular move at an output edge

- Given (tree profiles): `L=X`, `R=V[A*,B]`

- Given (column profiles): `R=COL[C1[A*,B]]` with A above B both visible,
  `L=COL[C0[X]]`; shipped defaults; viewport recorded. Same
  directional verbs as the R-OUT-01 column leg.

- When: Move A left (perpendicular)

- Observe: In-output wrap wins vs cross

- Then COSMIC: No cross; `R=H[A,B]` R1; [S21-01](../../cosmic-move-conformance.md#sequence-s21---perpendicular-wrapno-cross-case) authored observation
- Then Hyprland/Dwindle: Exact cross-vs-local TBD (monitor arrangement/edge adjacency and vertical alignment unrecorded, so the 1px focal may sit on L or R). Policy: focal off-monitor with fallback crosses via `assignToSpace`, else local remove+reinsert ordered by focal half; `S(S-hyp-move)`
- Then bspwm: Crosses rather than local-wrapping under `-s west --follow`: the west search spans monitors, so full-height X qualifies west of A (shared vertical range) while B sits south; A swaps with X (`L=A`, `R=V[X,B]`), `--follow` focuses A on L; no R1-style local wrap in source; exact frames TBD; `S(S-bsp-flt-focus)` + `S(S-bsp-flt-swap)`
- Then i3: No cross: perpendicular LEFT finds no HORIZ parent, so the workspace force-wraps to H and A inserts above its V parent (`H[A,V[B]]`, lone `V[B]` wrapper persists); focus stays A; `S(S-i3-move)` + `S(S-i3-outmove)`
- Then xmonad/Tall+Navigation2D: Exact perpendicular `V` fixture has no active-Tall counterpart (no nested V; Tall is fixed master/stack side-by-side, `Mirror Tall` not assumed in this profile); analogous policy only: no local-wrap primitive exists (selection is purely geometric line/side/center, never tree-orientation), so a qualifying western X still swaps rather than wrapping locally; exact cross-vs-local TBD (output/monitor geometry unrecorded); `S(S-xmo-out)` + `S(S-xmo-nav)`
- Then sway: No cross: perpendicular LEFT finds no HORIZ parent, so the workspace force-wraps to H and A inserts above its V parent (`H[A,V[B]]`, lone `V[B]` wrapper persists); focus stays A; `S(S-sway-move)` + `S(S-sway-outmove)`
- Then qtile/Columns: No cross: shuffle_left on the single column carrying A above B prepends a new column holding A (local split into two columns), never crossing screens; exact frames and drop-side focus TBD; `S(S-qti-shuffle)`
- Then awesome/tile: Exact `V[A,B]` fixture has no ordinary tile counterpart (tile with 2 clients is side-by-side master/stack, not top/bottom V); exact axes/frames TBD. Policy: no local-wrap primitive (move is geometric swap only); west local from A misses, so profile `swap.global_bydirection` crosses to L (A/X screen exchange, focus retained on A) rather than wrapping locally; `S(S-awe-swap)` + `S(S-awe-focus)` + `S(S-awe-tile)`
- Then niri: stays (`move_left` is strip-local column reorder with
  edge-false; single-column fixture has no reorder and no monitor
  leg). `S(S-nir-move)` + `S(S-nir-mon)`.
- Then PaperWM: stays (`swap(LEFT)` swaps columns within the space
  and returns at the first column; no row/column cross).
  `S(S-pap-mon)`.
- Then karousel/Lazy: fixture-inapplicable (single-screen profile; no
  counterpart). `S(S-kar-single)`.
- Then paneru: stays (single-column strip has no western peer for
  `Swap(West)`; no display fall-through on West). `S(S-pan-swap)`.
- Then Ours KDE: Local R1 wins first; `D(D-dec-cos)`
- Then Ours Windows: Local R1 wins first; `D(D-dec-cos)`
- Variant hook: V-R4-DIR.

## New scenarios (GWT; fixtures/actions/discriminators per the approved expansion record)

Notation, profiles, baselines, legend, and projection rules live in the
index. Each scenario below has exactly one Then bullet per profile (14).
`S()` tags attach only to the established sub-leg; anything else on that
line stays TBD. Column Given bullets are separate fixtures, never H/V
ancestry claims. karousel two-output fixtures are inapplicable per
`S(S-kar-single)` (single-screen profile). paneru legs distinguish the
native macOS Space from virtual rows. Ours cells cite Engine + adapter
source at `9241c94` plus the new `S(S-ours-out)` model key; selected
intent and doc assertions are never evidence.

Output-send verbs (shared inventory for R-OUT-04; each When below sends
the responsive client via its native explicit output-transfer route, not
an edge move): COSMIC `MoveToOutput` (follow) / `SendToOutput` (stay)
(`S(S-cos-out)`); Hyprland `movetoworkspace` to L's workspace in follow
form, silent refocuses the source (`S(S-hyp-movews)`); bspwm
`node -m west --follow` (`S(S-bsp-send)` + `S(S-bsp-xfer)`); i3
`move container to output` (`S(S-i3-move)` + `S(S-i3-outmove)`); xmonad
`windowToScreen` (`S(S-xmo-scope)`); sway `move container to output`
(`S(S-sway-move)` + `S(S-sway-outmove)`); qtile `togroup` to L's group
in the shipped follow form (`S(S-qti-group)`); awesome `move_to_tag`
with screen (`S(S-awe-tag)`); niri `MoveWindowToMonitorLeft`
(`S(S-nir-mon)`); PaperWM `switchMonitor` with window carry, not the
whole-space `moveToMonitor` (`S(S-pap-mon)`); karousel has no output
verb (single-screen, `S(S-kar-single)`); paneru `window nextdisplay`
(Follow; `nextdisplaysend` is the Stay variant) (`S(S-pan-display)`);
Ours Engine workspace send refuses cross-output (`S(S-ours-out)`).

### R-OUT-03: focus left across outputs

- Given (tree profiles): `L=H[X]`, `R=H[A*,B]`, equal aligned outputs.
  Ordinary windows, no rules. Record target workspace MRU before acting.
- Given (column profiles): `L=COL[C0[X]]`, `R=COL[C1[A*],C2[B]]` at
  shipped defaults; viewport recorded.
- Given (paneru): display `D1` owns strip `S1=COL[C0[X]]`, display
  `D2` owns strip `S2=COL[C1[A*],C2[B]]`; each display keeps its own
  strip and native Space. A focused on D2.
- When: focus left from A. Native verbs per profile: COSMIC
  `Focus(Left)`; Hyprland `movefocus l`; bspwm `node -f west`; i3
  `focus left`; xmonad Navigation2D `windowGo L`; sway `focus left`;
  qtile Columns `left()`; awesome `focus.global_bydirection("left")`;
  niri `FocusColumnLeft`; PaperWM `switchLeft(false)`; karousel
  `focus-left`; paneru `Focus(West)`; Ours Engine directional focus
  via the adapter `focus` op (`S(S-ours-focus)` + `S(S-ours-out)`).
- Observe: cross-output target and focus history vs local wrap or stay.
  Compare geometry with target workspace MRU.
- Then COSMIC: falls through to workspace/output navigation; exact
  branch (workspace step vs output switch) TBD under the shipped
  layout. `S(S-cos-tilefocus)` + `S(S-cos-focus-fallback)`; queued.
- Then Hyprland/Dwindle: crosses to L via the monitor fallback; exact
  focus target TBD. `S(S-hyp-focus)`; queued.
- Then bspwm: focuses X on L (west search spans all monitors'
  focused desktops; X is the sole western candidate).
  `S(S-bsp-flt-focus)` + `S(S-bsp-move-target)`.
- Then i3: crosses to L (A is leftmost, so the walk climbs to the
  workspace level and `get_tree_next_workspace` returns L's visible
  workspace; `tree_next` shows it and focuses descended X).
  `S(S-i3-outfocus)` + `S(S-i3-flt-focus)`.
- Then xmonad/Tall+Navigation2D: crosses to X (`navigableWindows`
  covers all visible screens via `sortedScreens`, so the western X
  is a directional candidate of `windowGo L`). `S(S-xmo-scope)`.
- Then sway: crosses to L (output fallback after the tree walk;
  L sole X is the directional node). `S(S-sway-focus)`.
- Then qtile/Columns: A retained (`left()` steps in-group columns
  only; cross-screen needs `toscreen`, not this leg).
  `S(S-qti-focus)` + `S(S-qti-group)`.
- Then awesome/tile: crosses to X via `global_bydirection` (local
  miss then screen cross with mover re-activation). `S(S-awe-focus)`.
- Then niri: A retained (`FocusColumnLeft` returns false at index 0;
  cross-monitor needs the separate `FocusMonitor*` verb, not this
  leg). `S(S-nir-focus)` + `S(S-nir-mon)`.
- Then PaperWM: A retained (`switchLeft(false)` returns false at the
  first column; cross-monitor needs `switchMonitor`, not this leg).
  `S(S-pap-focus)` + `S(S-pap-mon)`.
- Then karousel/Lazy: fixture-inapplicable (single-screen profile).
  `S(S-kar-single)`.
- Then paneru: TBD (directional `Focus` traversal across displays
  untraced); inventory inspected: `S(S-pan-cmds)` (no established
  outcome leg); queued.
- Then Ours KDE: crosses to X on L (Engine cross-output proposal
  selects the adjacent output domain's last-focused tiled leaf, and
  sole X is that leaf; actuated via `setActive`).
  `S(S-ours-focus)` + `S(S-ours-out)`.
- Then Ours Windows: same Engine cross to X as Ours KDE, actuated
  via `actuate_focus`. `S(S-ours-focus)` + `S(S-ours-out)`.
- Variant hook: provisional/TBD (no suitable existing hook; V-R4-DIR
  covers moves, not focus).

### R-OUT-04: explicitly send a window to the other output

- Given (tree profiles): `L=H[X]`, `R=H[A*,B]` with A focused.
  Ordinary windows, no rules.
- Given (column profiles): `L=COL[C0[X]]`, `R=COL[C1[A*],C2[B]]` at
  shipped defaults; viewport recorded.
- Given (paneru): display `D1` owns strip `S1=COL[C0[X]]`, display
  `D2` owns strip `S2=COL[C1[A*],C2[B]]`; each display keeps its own
  strip and native Space.
- When: explicitly send A to L with the profile verb from the
  inventory above (not an edge move).
- Observe: carry/re-admit vs cross-output swap; follow vs retained
  source focus. Action differs from edge move.
- Then COSMIC: carries A to L's active workspace via `move_current`;
  `MoveToOutput` follows with focus on A, `SendToOutput` retains
  source focus (same send anchor as workspace send). `S(S-cos-out)`
  + `S(S-cos-send)`.
- Then Hyprland/Dwindle: carries A to L's workspace via
  `movetoworkspace`; follow switches monitor and focuses A,
  silent refocuses the source. `S(S-hyp-movews)`.
- Then bspwm: carries via `transfer_node` (unlink plus insert at L's
  focus X, second child, not a swap); `--follow` focuses A on L.
  `S(S-bsp-send)` + `S(S-bsp-xfer)`.
- Then i3: carries A to L's visible workspace at TAIL (nodes
  `[X,A]`); mover-focused follow via `workspace_show` focuses A on
  L, same default wrapper/follow as the R-OUT-01 crossing.
  `S(S-i3-move)` + `S(S-i3-outmove)`.
- Then xmonad/Tall+Navigation2D: carries via `windowToScreen`
  (`W.shift` leaves A as the focused element on L's stack with no
  view switch); source refocus after `delete'` TBD. `S(S-xmo-scope)`;
  queued.
- Then sway: carries A to L's active workspace at TAIL; focus stays
  on the mover A on L, same default wrapper/follow as the R-OUT-01
  crossing. `S(S-sway-move)` + `S(S-sway-outmove)`.
- Then qtile/Columns: carries via `togroup` (source `remove`, target
  `add`, not a swap); shipped follow form switches via `toscreen`
  with mover focus. `S(S-qti-group)` + `S(S-qti-add)`.
- Then awesome/tile: carries via `move_to_tag` (sets screen plus
  tags, no view switch); focused mover emits activate raise, so
  focus stays A. `S(S-awe-tag)`.
- Then niri: carries via `move_to_output` to L's active workspace
  plus `focus_output`, following A rather than swapping with X.
  `S(S-nir-mon)`.
- Then PaperWM: carries via `switchMonitor` with window carry
  (removes from the R space, changes to L's space, activates with
  focus on A); not the whole-space `moveToMonitor` swap fallback.
  `S(S-pap-mon)`.
- Then karousel/Lazy: fixture-inapplicable (single-screen profile;
  no output verb). `S(S-kar-single)`.
- Then paneru: carries by appending A to D1's selected strip with
  width-ratio preserved; Follow keeps A focused with the mouse
  warped to it. `S(S-pan-display)`.
- Then Ours KDE: no counterpart (Engine workspace send is
  same-output only and refuses cross-output; directional
  `CrossOutput` move is a separate verb, not this send leg).
  `S(S-ours-out)` + `S(S-ours-ws)`.
- Then Ours Windows: same qualified no counterpart outcome as Ours KDE
  via the shared Engine refusal. `S(S-ours-out)` + `S(S-ours-ws)`.
- Variant hook: V-WS-FOLLOW (follow vocabulary reused from
  R-WS-01; follow/stay outcomes remain profile-specific).

### R-OUT-05: open a window with two occupied outputs

- Given (tree profiles): L focused `H[A*]`, R `H[B]`; pointer on R,
  no destination rules. Ordinary windows, scale 1.
- Given (column profiles): L focused `COL[C1[A*]]`, R
  `COL[C2[B]]` at shipped defaults; pointer on R; viewport recorded.
- Given (paneru): display `D1` focused with strip `S1=COL[C1[A*]]`,
  display `D2` with strip `S2=COL[C2[B]]`; pointer on D2; each
  display keeps its own strip and native Space.
- When: open C (ordinary admission, no rules).
- Observe: focused output vs pointer output vs app/startup
  assignment; newcomer focus and source view.
- Then COSMIC: lands on the focused output L (admission defaults to
  the seat active output) with newcomer focus. `S(S-cos-out)` +
  `S(S-cos-mapfocus)`.
- Then Hyprland/Dwindle: exact output routing TBD (cursor vs active
  monitor at map untraced); inventory inspected: `S(S-hyp-newfocus)`
  (no established routing leg); queued.
- Then bspwm: lands on the focused desktop L with newcomer focus
  (ordinary admission anchors at the desktop focus). `S(S-bsp-insert)`.
- Then i3: lands on the focused workspace with newcomer focus
  (manage admits to focus unless assigned). `S(S-i3-admit)`.
- Then xmonad/Tall+Navigation2D: lands on the current screen with
  newcomer focus (`Operations.manage` on the focused workspace).
  `S(S-xmo-admit)`.
- Then sway: lands on the focused workspace with newcomer focus
  (seat focus-inactive anchor). `S(S-sway-ins)`.
- Then qtile/Columns: lands on the current group (L's screen) with
  newcomer focus (`group.add`). `S(S-qti-add)` + `S(S-qti-group)`.
- Then awesome/tile: lands on the selected tags (focused screen L)
  with newcomer focus (manage rule focus plus raise).
  `S(S-awe-manage)`.
- Then niri: exact output routing TBD (`open_on_workspace` rule
  routes, default output untraced); inventory inspected: `S(S-nir-ins)`
  (no established routing leg); queued.
- Then PaperWM: lands on the selected space (focused L; fresh
  windows redirect there) and activates on show. `S(S-pap-ins)`.
- Then karousel/Lazy: fixture-inapplicable (single-screen profile;
  no second output). `S(S-kar-single)`.
- Then paneru: exact display routing TBD (active-strip insertion
  vs target display's selected strip); inventory inspected: `S(S-pan-ins)`
  (no established routing leg); queued.
- Then Ours KDE: admission anchor and newcomer desired focus are
  sourced; output routing plus native activation TBD.
  `S(S-ours-admit)` + `S(S-ours-out)`; queued.
- Then Ours Windows: same Engine anchor leg as Ours KDE; output
  routing plus native activation TBD. `S(S-ours-admit)` +
  `S(S-ours-out)`; queued.
- Variant hook: provisional/TBD (contrast rule-targeted R-INS-07,
  which uses an explicit destination rule).

### R-OUT-06: disconnect and reconnect an occupied output

- Given (all profiles): L and R occupied with distinct workspaces;
  R focused. Record output identity and workspace mapping before
  acting. karousel excluded (single-screen, `S(S-kar-single)`).
- When: disconnect R (host output removal); then reconnect the same
  output. No agent hotplug; user host only.
- Observe: window/workspace evacuation, destination and focus; return
  affinity vs fresh reassignment on reconnect.
- Then COSMIC: evacuation destination and return affinity TBD
  (output add/remove workspace ownership untraced). TBD; queued.
- Then Hyprland/Dwindle: evacuation and return TBD (monitor-removal
  workspace migration untraced). TBD; queued.
- Then bspwm: retains R's monitor/desktops at shipped
  `remove_unplugged_monitors=false`; reconnect with the same RandR
  identity reuses that monitor. Focus/visibility while disconnected
  TBD. Named remove-unplugged=true variant merges desktops into L
  before removing R, not destruction. `S(S-bsp-monrm)`; queued.
- Then i3: evacuation and return TBD (output-destroy workspace
  migration untraced). TBD; queued.
- Then xmonad/Tall+Navigation2D: evacuation and return TBD
  (static screen zipper; plug-event migration untraced). TBD; queued.
- Then sway: workspaces evacuate to the highest-available else
  fallback output (empties destroyed); focus and reconnect affinity
  TBD. `S(S-sway-evac)`; queued.
- Then qtile/Columns: evacuation and return TBD (screen-removal
  group migration untraced). TBD; queued.
- Then awesome/tile: evacuation and return TBD (screen-removal
  client migration untraced). TBD; queued.
- Then niri: evacuation and return TBD (monitor-removal workspace
  ownership untraced). TBD; queued.
- Then PaperWM: evacuation and return TBD (window hotplug journey
  untraced; the GNOME workspace add/remove mirror alone establishes
  no window outcome). TBD; queued.
- Then karousel/Lazy: fixture-inapplicable (single-screen profile;
  no hotplug counterpart). `S(S-kar-single)`.
- Then paneru: TBD (macOS display disconnect is host-owned;
  virtual-row vs native-Space fate untraced). TBD; queued.
- Then Ours KDE: TBD (host output-removal domain journey plus
  Engine re-seed untraced). TBD; queued.
- Then Ours Windows: TBD (host topology journey untraced; single
  configured output in this profile). TBD; queued.
- Variant hook: provisional/TBD (host-topology hook, to discuss;
  distinct from R-WS-12 whole-workspace reassignment).
