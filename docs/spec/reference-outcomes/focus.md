# Focus (reference outcomes)

Part of the [outcome matrix index](../reference-outcomes.md). Notation, profiles, evidence legend, and variant hooks live in the index; `S()`/`D()` keys below resolve there. Scenarios below are GWT with one Then bullet per profile (14).

Tile/float directional-layer coverage stays in R-FLT-07..09 (floating area) and is reused here, not duplicated: tile-origin search excludes floats (R-FLT-07), float-origin search is layer/policy-dependent (R-FLT-08/09). Workspace-return focus belongs to R-WS-09.

## New scenarios (GWT; fixtures/actions/discriminators per the approved expansion record)

Notation, profiles, baselines, legend, and projection rules live in the
index. Each scenario below has exactly one Then bullet per profile (14).
`S()` tags attach only to the established sub-leg; anything else on that
line stays TBD. Column Given bullets are separate fixtures, never H/V
ancestry claims. Ours cells cite Engine + adapter source at `9241c94`
plus the new `S(S-ours-focus)` model key; selected intent and doc
assertions are never evidence.

### R-FOC-01: directional tie with two equally placed candidates

- Given (tree profiles): `H[V[A,B],C*]`, equal halves, C spans full
  height. Ordinary windows, no rules, scale 1, zero gaps for reference
  geometry. Two runs from fresh fixtures: history A,B,C, then history
  B,A,C. Record exact rectangles and per-profile history before acting.
- Given (column profiles): `COL[C1[A,B],C2[C*]]`, C1 holds A above B,
  both vertically visible where the model supports it; shipped defaults
  apply; viewport recorded. Same two histories, same runs.
- Given (qtile/Columns projection): two columns `C1[A,B]` (A above B)
  and `C2[C*]`; establish via ordinary admission plus `shuffle_right`
  if C lands in C1 (`S(S-qti-add)` + `S(S-qti-shuffle)`); record actual
  columns. Column-current tracking across the two history runs is the
  discriminating unknown, not a premise.
- When: focus left once in each run. Native verbs/config per profile:
  COSMIC `Focus(Left)`; Hyprland `movefocus l`; bspwm `node -f west`;
  i3 `focus left`; xmonad Navigation2D `windowGo L`; sway `focus left`;
  qtile Columns `left()`; awesome `focus.bydirection("left")`; niri
  `FocusColumnLeft`; PaperWM `switchLeft(false)`; karousel `focus-left`;
  paneru `Focus(West)`; Ours Engine directional focus via the adapter
  `focus` op (`S(S-ours-focus)`).
- Observe: which of A/B takes focus in each run - MRU-sensitive choice
  vs stable tree/order/geometric tie. No one-candidate pseudo-tie.
- Then COSMIC: A in both runs. Equal geometric distances select the first
  minimum (A) in child order; history is not consulted on this branch.
  `S(S-cos-tilefocus)`.
- Then Hyprland/Dwindle: selects geometrically via the directional query;
  exact A-vs-B TBD. `S(S-hyp-focus)`; tie metric queued.
- Then bspwm: run 1 B, run 2 A. Equal boundary distance, history rank
  breaks the tie. `S(S-bsp-flt-focus)`.
- Then i3: run 1 B, run 2 A. Sibling V group plus focus-descend inside
  it. `S(S-i3-flt-focus)`.
- Then xmonad/Tall+Navigation2D: fixture-inapplicable (flat
  master/stack, no nested V group; no counterpart). `S(S-xmo-layout)`.
- Then sway: run 1 B, run 2 A. Sibling V group plus focus-inactive view
  inside it. `S(S-sway-focus)`.
- Then qtile/Columns: selects the left column's current window via
  `left()`; exact run-to-member mapping TBD (column-current tracking
  across histories untraced). `S(S-qti-focus)`; mapping queued.
- Then awesome/tile: fixture-inapplicable (shipped `nmaster=1` tile
  partitions one master plus stack columns, so two left candidates
  plus a right full-height C has no counterpart). `S(S-awe-tile)`.
- Then niri: activates the left column via `focus_left`; member
  selection inside C1 TBD. `S(S-nir-focus)`; member queued.
- Then PaperWM: run 1 B, run 2 A. `switchLeft` takes the left column's
  topmost (`sortWindows` last), i.e. last-activated member.
  `S(S-pap-focus)`.
- Then karousel/Lazy: focuses the left column's focus-taker; exact
  member TBD. `S(S-kar-focus)`; member queued.
- Then paneru: TBD (directional `Focus` traversal untraced).
  `S(S-pan-cmds)`; traversal queued.
- Then Ours KDE: A in both runs. Perpendicular V descends to its first
  child; the Engine dispatches focus to A and the adapter calls
  `setActive`. `S(S-ours-focus)`.
- Then Ours Windows: A in both runs via the shared Engine, actuated via
  `actuate_focus`. `S(S-ours-focus)`.
- Variant hook: provisional/TBD (no suitable existing hook; do not reuse
  V-FLOAT-FOCUS, which covers tile/float layers, not tile-tile ties).

### R-FOC-02: directional focus at a single-output edge

- Given (all profiles): `H[A*,B]`, single output, no adjacent output.
  Declared wrap policy per profile (no overrides beyond shipped
  defaults). Column profiles use `COL[C1[A*],C2[B]]` at shipped
  defaults; viewport recorded.
- When: focus left. Native verbs/config: same directional verbs as
  R-FOC-01 per profile.
- Observe: edge wrap within the workspace, stay, or workspace/output
  fallback. Independent of move edge policy (R-MOV-05/R4).
- Then COSMIC: A retained (no local target, no next output).
  `S(S-cos-tilefocus)` + `S(S-cos-focus-fallback)`.
- Then Hyprland/Dwindle: A retained (no directional target, no monitor
  fallback on one output, full-size stay covers the spanning case).
  `S(S-hyp-focus)`.
- Then bspwm: A retained (no west candidate in the unqualified
  selector). `S(S-bsp-flt-focus)`.
- Then i3: B (wraps within the workspace under the default wrapping
  policy). `S(S-i3-flt-focus)`.
- Then xmonad/Tall+Navigation2D: A retained (miss is no-op under
  `wrap False`). `S(S-xmo-nav)`.
- Then sway: B (wraps within the workspace under shipped `WRAP_YES`).
  `S(S-sway-focus)`.
- Then qtile/Columns: B (wraps across columns under shipped
  `wrap_focus_columns=true`). `S(S-qti-focus)`.
- Then awesome/tile: A retained (bydirection miss changes nothing).
  `S(S-awe-focus)`.
- Then niri: A retained (`focus_left` returns false at index 0; the
  wrapping `FocusColumnLeftOrLast` is a separate verb, not this leg).
  `S(S-nir-focus)`.
- Then PaperWM: A retained (`switchLeft(false)` returns false at the
  first column). `S(S-pap-focus)`.
- Then karousel/Lazy: A retained (no left column returns without
  acting). `S(S-kar-focus)`.
- Then paneru: TBD (edge behavior untraced). `S(S-pan-cmds)`; queued.
- Then Ours KDE: A retained (`Edge`, no focus write on one output).
  `S(S-ours-focus)`.
- Then Ours Windows: same Edge-retain leg as Ours KDE via the shared
  Engine. `S(S-ours-focus)`.
- Variant hook: provisional/TBD (wrap-policy hook, to discuss; V-R4-DIR
  covers moves, not focus).

### R-FOC-03: next/previous window cycle order

- Given (tree profiles): `H[A,B,C]` with B focused (history A,C,B
  establishes it). Fresh float-variant leg: same plus ordinary F.
  No shell switcher (external Alt+Tab stays R-WS-07).
- Given (column profiles): three single-window columns/strip order
  A,B,C with B focused; fresh float-variant leg adds ordinary F.
  Shipped defaults apply.
- Given (layout-driven projections): xmonad/awesome use native tiled
  order A,B,C (A master, B/C stacked), not a flat three-leaf H tree.
  qtile uses three single-window columns prepared with `shuffle_right`
  as needed (`S(S-qti-shuffle)`); bspwm binary embedding remains TBD.
- When: next window from B; then previous window from the new focus
  (reversibility leg, no reset between the two); then a fresh edge leg
  (next from C; previous from A, each from an explicitly reset fixture)
  to establish wrap; then a fresh float-variant leg (same plus ordinary
  F) for float inclusion. Native verbs/config per profile: bspwm
  `node -f next|prev`; i3 `focus next|prev`; xmonad core
  `focusDown`/`focusUp`; sway `focus next|prev`; qtile `next()`/
  `previous()`; awesome `focus.byidx(1)`/`(-1)`; karousel
  `focus-next`/`focus-previous`. COSMIC/niri/paneru/Ours inventory
  below; Hyprland `cyclenext`; PaperWM inventory TBD.
- Observe: order plus reversibility (legs 1-2), wrap (edge leg), and
  float inclusion (float-variant leg: F in-cycle vs excluded).
- Then COSMIC: no-counterpart (shipped `Focus` verbs are
  directional plus In/Out only; the switcher is an external System
  command). `S(S-cos-focuskeys)` + `S(S-cos-sysact)`.
- Then Hyprland/Dwindle: TBD (previous invocation, order, wrap and float
  inclusion). `cyclenext` exists via `cycleNext`; previous invocation
  untraced. `S(S-hyp-focus)`; queued.
- Then bspwm: TBD (binary embedding and internal-node matching).
  In-order next/previous walk and desktop wrap are sourced, but not this
  fixture's focus sequence. `S(S-bsp-cycle)`; queued.
- Then i3: next C, previous B; edges wrap C-to-A and A-to-C; F excluded
  from the tiled walk. `S(S-i3-focusnext)` + `S(S-i3-flt-focus)`.
- Then xmonad/Tall+Navigation2D: stack-order cycle (next C, previous
  back to B; documented wrapping covers the edge leg); float-variant
  stack position TBD. `S(S-xmo-core-nav)`; float leg queued.
- Then sway: next C, then previous back to B (reversible); edge leg
  next-from-C wraps to A and previous-from-A wraps to C; F excluded,
  same legs. `S(S-sway-focusnext)` + `S(S-sway-focus)`.
- Then qtile/Columns: next C, previous B; edges wrap C-to-A and A-to-C
  across columns; F excluded from these tiled verbs. `S(S-qti-focus)`.
- Then awesome/tile: index cycle via `client.next` (`gmath.cycle`
  wraps, which covers the edge leg once order is known); exact order
  and float-variant step TBD. `S(S-awe-cycle)`; order queued.
- Then niri: no-counterpart for a plain spatial next/previous pair
  (directional column/window verbs plus MRU `FocusWindowPrevious`
  only). `S(S-nir-actions)`.
- Then PaperWM: TBD (cycle-verb inventory untraced; `switch` verbs in
  `S(S-pap-focus)` are directional only). Queued.
- Then karousel/Lazy: next C, previous B; edges stay C and A respectively
  (no wrap); tiled-only verbs exclude F. `S(S-kar-focus)`.
- Then paneru: no-counterpart for a next/previous cycle pair
  (`Operation` lists directional `Focus` plus managed/unmanaged focus
  only). `S(S-pan-cmds)`.
- Then Ours KDE: no-counterpart (focus plans are directional
  leaf-or-Edge only; no cycle verb in the inspected inventory).
  `S(S-ours-focus)`.
- Then Ours Windows: same no-cycle leg as Ours KDE via the shared
  Engine. `S(S-ours-focus)`.
- Variant hook: provisional/TBD (cycle-order hook, to discuss).

### R-FOC-04: parent/child focus scope

- Given (tree profiles): `H[V[A,B*],C]`, leaf B focused.
- Given (column profiles): `COL[C1[A,B*],C2[C]]` (or the profile's
  native two-group fixture); shipped defaults apply.
- When: focus parent; focus child. Native verbs/config per profile:
  COSMIC `Focus(Out)`/`Focus(In)`; i3/sway `focus parent`/`focus
  child`. Other profiles per inventory below; tab stepping stays
  R-GRP-01.
- Observe: group focus scope and child selection vs
  leaf-only/no-counterpart. Does not duplicate tab stepping.
- Then COSMIC: parent focuses the V group container; child returns to
  B (remembered member, else first child). `S(S-cos-tilefocus)`.
- Then Hyprland/Dwindle: TBD (container-focus inventory untraced; a
  missing search term is not absence evidence). Queued.
- Then bspwm: TBD (parent-traversal outcome untraced; the
  `first_ancestor` selector alone does not settle focus scope).
  `S(S-bsp-flt-focus)`; queued.
- Then i3: parent focuses V (`level_up`); child returns to B
  (`level_down` to the focused descendant). `S(S-i3-focuslvl)`.
- Then xmonad/Tall+Navigation2D: no-counterpart (flat Tall, no
  container focus). `S(S-xmo-layout)`.
- Then sway: parent focuses V; child returns to B (active tiling
  child). `S(S-sway-focuslvl)`.
- Then qtile/Columns: no-counterpart (directional plus next/previous
  verbs and `toggle_split` only; no container-focus verb).
  `S(S-qti-focus)` + `S(S-qti-split)`.
- Then awesome/tile: no-counterpart (bydirection/byidx/history verbs
  only; layouts have no focusable containers). `S(S-awe-focus)`.
- Then niri: no-counterpart (flat column/window verbs; no parent
  verb in the scrolling/workspace inventory). `S(S-nir-focus)`.
- Then PaperWM: no-counterpart (column/row switch verbs only; no
  parent verb). `S(S-pap-focus)`.
- Then karousel/Lazy: no-counterpart (column/window focus verbs only;
  no parent verb). `S(S-kar-focus)`.
- Then paneru: TBD (Stack/Column parent-focus outcome untraced).
  `S(S-pan-model)`; queued.
- Then Ours KDE: no-counterpart (leaf-only focus model: `Focused`
  leaf or `Edge`; containers are never focus targets).
  `S(S-ours-focus)`.
- Then Ours Windows: same leaf-only leg as Ours KDE via the shared
  Engine. `S(S-ours-focus)`.
- Variant hook: provisional/TBD (container-focus hook, to discuss).
