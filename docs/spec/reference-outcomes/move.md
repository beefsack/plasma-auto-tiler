# Move (reference outcomes)

Part of the [outcome matrix index](../reference-outcomes.md). Notation, profiles, evidence legend, and variant hooks live in the index; `S()`/`D()` keys below resolve there. Scenarios below are GWT with one Then bullet per profile (14).

## 2. Move

### R-MOV-01: perpendicular move of a flat triple

- Given (tree profiles): `H[A,C,B*]`

- Given (column profiles): `COL[C1[A],C2[C],C3[B*]]`, three single-window columns
  in strip order; shipped defaults apply. This is a native model leg,
  not an equal-third rectangle projection; there is no shared column.

- When: Move B down.

- When (column leg): move B down. Native verbs: niri `MoveWindowDown`, karousel
  `windowMoveDown`, paneru `Swap(South)`; PaperWM down-move inventory
  unresolved.

- Observe: Restructure vs no-op

- Observe (column leg): perpendicular restructure vs in-column reorder vs stay.

- Then COSMIC: `V[H[A,C],B]` via R1; `UT(2026-08-20)` ver-unknown + [S1-07](../../cosmic-move-conformance.md#sequence-s1---three-terminals)
- Then Hyprland/Dwindle: Semantic remove+reinsert move, not swap (swap is a separate action erroring with no target); flat 3-child start has no ordinary binary form (default ratio 1 yields halves, not thirds); exact outcome TBD (ratios, focal anchor, geometry recalc); `S(S-hyp-move)` + `S(S-hyp-moveswap)`
- Then bspwm: Configured `-s south --follow` is node swap, not R1; no south target in a single row, so no swap occurs and tree/focus stay unchanged; `S(S-bsp-swap)` + `S(S-bsp-flt-focus)`
- Then i3: `V[H[A,C],B*]`: no same-orientation parent, so the workspace force-wraps to V, then B inserts after the H at workspace level; focus stays B; `S(S-i3-move)`
- Then xmonad/Tall+Navigation2D: Exact flat 3-child H has no ordinary Tall binary form (Tall `frac=1/2` partitions master/stack with the stack split equally, no thirds); analogous policy only: core swap is stack-order (`swapUp`/`swapDown`), directional move/swap is Navigation2D `windowGo`/`windowSwap` same-layer with miss no-op; exact outcome TBD (focal, ratios, geometry recalc); `S(S-xmo-layout)` + `S(S-xmo-nav)` + `S(S-xmo-core-nav)`
- Then sway: `V[H[A,C],B*]`: no parallel V parent, so the workspace force-wraps to V, then B inserts after the H at workspace level; focus stays B; `S(S-sway-move)`
- Then qtile/Columns: Flat 3-child start has no ordinary Columns form (default num_columns=2, third window stacks in-column); exact outcome TBD. Policy: shuffle_down reorders within the column only (edge is no-op), no R1 restructure; `S(S-qti-shuffle)` + `S(S-qti-add)`
- Then awesome/tile: Flat 3-child start has no ordinary tile form (master plus one vertical stack column, not flat thirds); exact outcome TBD. Policy: semantic move is geometric swap.bydirection with no R1 restructure (miss is no-op); `S(S-awe-swap)` + `S(S-awe-tile)`
- Then niri: B is the sole tile, so `move_down` returns false and B stays.
  `S(S-nir-move)`.
- Then PaperWM: TBD; down-move verb inventory unresolved. `S(S-pap-move)`.
- Then karousel/Lazy: B is the sole window, so `windowMoveDown` is a
  no-op and B stays. `S(S-kar-move)`.
- Then paneru: TBD; south peer resolution untraced. `S(S-pan-move)`.
- Then Ours KDE: `V[H[A,C],B]` R1 via shared Engine; selected `D(D-dec-cos)`
- Then Ours Windows: `V[H[A,C],B]` R1 via shared Engine; selected `D(D-dec-cos)`
- Variant hook: V-MOVE-PERP.

### R-MOV-02: in-group vertical swap

- Given (tree profiles): `H[A,V[C,B*]]`

- Given (column profiles): `COL[C1[A],C2[C,B*]]` with C above B, both visible
  where supported; shipped defaults apply.

- When: Move B up.

- When (column leg): move B up. Native verbs: niri `MoveWindowUp`, karousel
  `windowMoveUp`, paneru `Swap(North)`; PaperWM up-move inventory
  unresolved.

- Observe: Swap vs wrap

- Observe (column leg): B swaps above C in place.

- Then COSMIC: `H[A,V[B,C]]` via R2a leaf swap; `UT(2026-08-20)` + [S1-11](../../cosmic-move-conformance.md#sequence-s1---three-terminals)
- Then Hyprland/Dwindle: Binary-compatible start; yields `H[A,V[B,C]]`: focal 1px above B sits inside C's expanded full-V box (distance 0; ideal-BB reserved expansion at work-area edges stays within C's span, strictly closest either way), direct-partner override orders B first with top/bottom split at default ratio 1 (halves); focus stays B (non-silent); V persists through recalc under the same portrait condition the starting `V[C,B]` exhibits; `S(S-hyp-move)`
- Then bspwm: Configured `-s north --follow` swaps B/C (same-desktop swap retains focus on B; `--follow` inert here); `S(S-bsp-swap)` + `S(S-bsp-flt-focus)`
- Then i3: `H[A,V[B*,C]]`: in-parent leaf swap with C; focus stays B; `S(S-i3-move)`
- Then xmonad/Tall+Navigation2D: `H[A,V[C,B]]` is Tall's projected geometry for StackSet `[A,C,B*]` (`nmaster=1`, `frac=1/2`: master A takes the left half via `splitHorizontallyBy`, stack C/B takes the right half split equally via `splitVertically`), not a structural tree; `windowSwap` U `False` from B selects C by tiled line/side geometry (C sits above sharing the x-range while A spans full height and fails the above test), and `swap` exchanges stack positions retaining mover focus (StackSet `[A,B*,C]`, projected `H[A,V[B*,C]]`); exact pixel frames TBD; `S(S-xmo-layout)` + `S(S-xmo-nav)` + `S(S-xmo-out)`
- Then sway: `H[A,V[B*,C]]`: in-parent leaf swap with C; focus stays B; `S(S-sway-move)`
- Then qtile/Columns: Column-embedding analogue: B below C in one column, shuffle_up swaps B above C with focus retained; exact frames TBD; `S(S-qti-shuffle)`
- Then awesome/tile: Tile-projected start for order [A,C,B] (master A, stack C/B); geometric swap up selects C, yielding order [A,B,C] projected `H[A,V[B*,C]]` with mover focus retained (no focus write); exact pixel frames TBD; `S(S-awe-swap)` + `S(S-awe-tile)`
- Then niri: B swaps with C and the active index follows B, so B stays
  focused. `S(S-nir-move)`.
- Then PaperWM: TBD; up-move verb inventory unresolved. `S(S-pap-move)`.
- Then karousel/Lazy: B swaps above C with no focus write, so focus stays
  B. `S(S-kar-move)`.
- Then paneru: B swaps with C above in the same strip. `S(S-pan-move)`.
- Then Ours KDE: `H[A,V[B,C]]`; `D(D-dec-cos)`
- Then Ours Windows: `H[A,V[B,C]]`; `D(D-dec-cos)`
- Variant hook: V-MOVE-NARY.

### R-MOV-03: same-row carry to the right

- Given (tree profiles): `H[A,B*,C,D]`

- Given (column profiles): `COL[C1[A],C2[B*],C3[C],C4[D]]`, four single-window
  columns in strip order; shipped defaults apply. This is a native model
  leg, not an equal-quarter rectangle projection.

- When: Move B right.

- When (column leg): move B right. Native verbs: niri `MoveColumnRight`, karousel
  `windowMoveRight`, paneru `Swap(East)`; PaperWM right-move inventory
  unresolved.

- Observe: Wrap pair vs flat insert

- Observe (column leg): pair wrap vs flat reorder, column join, or stay.

- Then COSMIC: `H[A,H[B,C],D]` R2c; [S18-01](../../cosmic-move-conformance.md#sequence-s18---r2c-container-neighbour) authored observation, widths unrecorded
- Then Hyprland/Dwindle: Flat 4-child start has no ordinary binary form (default ratio 1 yields halves, not quarters); wrap-vs-insert anchor TBD (focal, ratios, geometry recalc); `S(S-hyp-move)`
- Then bspwm: East-neighbor node swap with C (not a nested wrap); focus stays B; exact partner/frames TBD without the binary embedding; `S(S-bsp-swap)` + `S(S-bsp-flt-focus)`
- Then i3: `H[A,C,B*,D]`: flat sibling swap with C, not a nested wrap; focus stays B; `S(S-i3-move)`
- Then xmonad/Tall+Navigation2D: Exact flat 4-child H has no ordinary Tall binary form; wrap-vs-insert anchor TBD; analogous policy only: stack-order swap vs same-layer directional `windowSwap`; exact outcome TBD; `S(S-xmo-layout)` + `S(S-xmo-nav)`
- Then sway: `H[A,C,B*,D]`: flat sibling swap with C, not a nested wrap (separate `swap` verb unused); focus stays B; `S(S-sway-move)`
- Then qtile/Columns: Flat 4-child start has no ordinary Columns form; exact outcome TBD. Policy: shuffle_right carries B into the adjacent column (new column at a shared-column edge, no-op only for a sole-column sole window); focus stays B; `S(S-qti-shuffle)`
- Then awesome/tile: Flat 4-child start has no ordinary tile form (1 master plus 3 in one column); exact outcome TBD. Policy: geometric swap-or-miss with no nested wrap/insert; focus retained; `S(S-awe-swap)` + `S(S-awe-tile)`
- Then niri: C2 moves after C3, B stays focused. `S(S-nir-move)`.
- Then PaperWM: TBD; right-move verb inventory unresolved.
  `S(S-pap-move)`.
- Then karousel/Lazy: single-window B joins C3 at the bottom via the
  single-window path. `S(S-kar-move)`.
- Then paneru: B swaps east with C in the same strip. `S(S-pan-move)`.
- Then Ours KDE: Same-orientation wrap per Engine; nested `H[H..]` distinct from flat; `D(D-dec-cos)`
- Then Ours Windows: Same-orientation wrap per Engine; nested `H[H..]` distinct from flat; `D(D-dec-cos)`
- Variant hook: V-MOVE-NARY.

### R-MOV-04: same-axis ancestor escape

- Given (tree profiles): `H[H[A,B*],C]`

- Given (column profiles): `H[H[A,B*],C]`; recursive same-axis ancestry has no faithful
  column fixture. Column consume/expel mechanics belong to R-COL-03.

- When: Move B right.

- When (column leg): move B right.

- Observe: Escape vs stay nested

- Observe (column leg): escape vs stay nested, as in the original row.

- Then COSMIC: `H[A,B,C]` via R3 ascend + same-axis flatten; `UT(2026-08-20)` ver-unknown + [S1-03](../../cosmic-move-conformance.md#sequence-s1---three-terminals)
- Then Hyprland/Dwindle: No flat escape: removes B then splits C, retaining binary nesting and focus B. Equal halves make C the same shape as the original inner H: if wider than tall, yields `H[A,H[B,C]]`; exact order TBD at the square tie (admission orders by the focal y half, but recalc uses H because only height greater than width selects V). No live-cursor dependence; `S(S-hyp-move)` + `S(S-hyp-ins)`
- Then bspwm: Swaps B east with C to `H[H[A,C],B]`; same-desktop swap retains focus on B; exact frames TBD; `S(S-bsp-swap)` + `S(S-bsp-flt-focus)`
- Then i3: `H[H[A],B*,C]`: B extracted after the inner H at the outer level; single-child `H[A]` wrapper persists (empty-only close, narrow flatten); focus stays B; `S(S-i3-move)`
- Then xmonad/Tall+Navigation2D: Exact nested `H[H[A,B],C]` escape has no Tall counterpart (no nesting levels; flat master/stack only); analogous policy only: Navigation2D geometric target selection via `navigableWindows` with stack-position `windowSwap` retaining mover focus (miss no-op), no flat escape via Tall; exact order TBD; `S(S-xmo-layout)` + `S(S-xmo-nav)` + `S(S-xmo-out)`
- Then sway: `H[H[A],B*,C]`: B promoted out of the inner H into C's outer sibling list immediately before C; single-child `H[A]` wrapper persists (empty-only reap, redundant-pair squash only); focus stays B; `S(S-sway-move)` + `S(S-sway-cleanup)`
- Then qtile/Columns: No nesting in Columns: shuffle_right carries B into C's column (a shared-column edge creates a new column instead); focus stays B; exact order/frames TBD; `S(S-qti-shuffle)`
- Then awesome/tile: Nested `H[H[A,B],C]` has no tile counterpart (flat tiled-client list, no nesting levels); exact outcome TBD. Policy: geometric swap-or-miss with no flat escape; focus retained; `S(S-awe-swap)` + `S(S-awe-tile)`
- Then niri: fixture-inapplicable; ordered columns have no nested H
  ancestor to escape. `S(S-nir-move)`.
- Then PaperWM: fixture-inapplicable; column/row membership has no nested
  H ancestor. `S(S-pap-move)`.
- Then karousel/Lazy: fixture-inapplicable; Grid/Column membership has no
  nested H ancestor. `S(S-kar-move)`.
- Then paneru: fixture-inapplicable; the strip/column model has no nested
  H ancestor. `S(S-pan-model)`.
- Then Ours KDE: R3 ascend; `D(D-dec-cos)`
- Then Ours Windows: R3 ascend; `D(D-dec-cos)`
- Variant hook: V-MOVE-NARY.

### R-MOV-05: edge move with no left neighbor

- Given (tree profiles): `H[A*,B]` single output, no neighbor

- Given (column profiles): `COL[C1[A*],C2[B]]`, each one window; shipped
  defaults apply; single output.

- When: Move left past edge.

- When (column leg): move A left. Native verbs: niri `MoveColumnLeft`, karousel
  `windowMoveLeft`, paneru `Swap(West)`; PaperWM left-move inventory
  unresolved.

- Observe: No-op vs cross-ws/output

- Observe (column leg): stay vs cross-output/workspace.

- Then COSMIC: Single-output no-op; [S5-01](../../cosmic-move-conformance.md#sequence-s5---output-edge-no-op) + [S17](../../cosmic-move-conformance.md#sequence-s17---single-output-directional-no-ops) authored observations; R4 never reached in UT
- Then Hyprland/Dwindle: No observable change: the off-edge focal still resolves to the same single monitor (nearest fallback), so A is removed (B fills the workspace) then reinserted ahead of B at the beyond-left focal half, not the live cursor, rebuilding equal `H[A,B]` with focus on A (nodes rebuilt, tree and focus identical); `S(S-hyp-move)`
- Then bspwm: No-op: no west target, so the swap refuses with tree and focus unchanged; `S(S-bsp-swap)` + `S(S-bsp-flt-focus)`
- Then i3: No-op: workspace-level H with A first (no left swap) and the parent is the workspace, so the output-directed attempt finds no output on a single output; tree and focus unchanged; `S(S-i3-move)`
- Then xmonad/Tall+Navigation2D: Analogous flat 2-window Tall embedding (A master, B stack side-by-side): west `windowGo`/`windowSwap` from A has no directional target with wrap False, so miss is no-op with tree/focus unchanged; core stack verbs are not directional; `S(S-xmo-layout)` + `S(S-xmo-nav)` + `S(S-xmo-core-nav)`
- Then sway: No-op: workspace-level H with A first (no left swap), and the next-output lookup finds no adjacent output on a single output; tree and focus unchanged; `S(S-sway-move)` + `S(S-sway-outmove)`
- Then qtile/Columns: No-op: leftmost sole-column A has no adjacent column and no shared column to split, so shuffle_left returns with tree and focus unchanged; `S(S-qti-shuffle)`
- Then awesome/tile: No-op: bydirection miss leaves tree and focus unchanged, and global_bydirection finds no next screen on a single output; `S(S-awe-focus)`
- Then niri: index 0 `move_left` returns false, so A stays.
  `S(S-nir-move)`.
- Then PaperWM: TBD; left-move verb inventory unresolved.
  `S(S-pap-move)`.
- Then karousel/Lazy: no left column on the single-window path, so the
  move returns without acting and A stays. `S(S-kar-move)`.
- Then paneru: TBD; west peer resolution untraced. `S(S-pan-move)`.
- Then Ours KDE: Local R1/R2/R3 first; exhausted horizontal R4 crosses output, never workspace; Up/Down excluded; `D(D-dec-cos)` (offline only)
- Then Ours Windows: Local R1/R2/R3 first; exhausted horizontal R4 crosses output, never workspace; Up/Down excluded; `D(D-dec-cos)` (offline only)
- Variant hook: V-R4-DIR.


## New scenarios (GWT; fixtures/actions/discriminators per the approved expansion record)

Notation, profiles, baselines, legend, and projection rules live in the
index. Each scenario below has exactly one Then bullet per profile (14).
`S()` tags attach only to the established sub-leg; anything else on that
line stays TBD. Column Given bullets are separate fixtures, never H/V
ancestry claims. Ours cells cite the Engine move rules at `9241c94`
(`S(S-ours-move)`); selected intent and doc assertions are never evidence.

### R-MOV-06: move into a nested perpendicular neighbor with remembered child

- Given (tree profiles): `H[A*,V[B,C]]`, V prior focused child C.
  Ordinary windows, no rules, scale 1, zero gaps for reference geometry.
- Given (column profiles): `COL[C1[A*],C2[B,C]]` with B above C, both
  vertically visible where supported; shipped defaults apply. Same
  identities; move-right is the native column right-move per profile.
- When: move A right. Native verbs per profile: COSMIC directional move;
  Hyprland `movewindow r`; bspwm `node -s east --follow`; i3 `move right`;
  xmonad Navigation2D `windowSwap R`; sway `move right`; qtile
  `shuffle_right()`; awesome `swap.bydirection("right")`; niri
  `MoveColumnRight`; karousel `windowMoveRight`; PaperWM inventory TBD;
  paneru `Swap(East)`; Ours Engine `plan_move` Right.
- Observe: enter nested neighbor at remembered child vs swap whole
  neighbor, wrap beside it, or geometric leaf swap. Keep group history
  explicit.
- Then COSMIC: TBD; nested entry target unresolved. `S(S-cos-move)`.
- Then Hyprland/Dwindle: TBD; reinsert anchor unresolved. `S(S-hyp-move)`.
- Then bspwm: A swaps with leaf C, not the whole V group; C wins the
  equal-distance tie by history, and focus stays A. `S(S-bsp-move-target)`.
- Then i3: A enters the V group; exact index (remembered C vs edge) TBD.
  `S(S-i3-move)`.
- Then xmonad/Tall+Navigation2D: fixture-inapplicable (flat Tall has no
  nested V group). `S(S-xmo-layout)`.
- Then sway: A enters the V group; exact index TBD. `S(S-sway-move)`.
- Then qtile/Columns: under `COL[C1[A*],C2[B,C]]` A carries into C2;
  exact row TBD. `S(S-qti-shuffle)`.
- Then awesome/tile: tile projection (master A, stack B/C) swaps A with B
  geometrically, focus retained. `S(S-awe-swap)` + `S(S-awe-tile)`.
- Then niri: C1 moves after C2, A stays focused. `S(S-nir-move)`.
- Then PaperWM: TBD; native directional-right move inventory unresolved.
  `move_to` scrolls the viewport, not membership. `S(S-pap-move)`.
- Then karousel/Lazy: A joins C2 at the bottom via the single-window path.
  `S(S-kar-move)`.
- Then paneru: TBD; east peer resolution untraced. `S(S-pan-move)`.
- Then Ours KDE: A leaves the root and enters V at index 1; tree
  `V[B,A*,C]`, focus A. `S(S-ours-move)`.
- Then Ours Windows: same `V[B,A*,C]` insert as Ours KDE via the shared
  Engine. `S(S-ours-move)`.
- Variant hook: V-MOVE-NARY.

### R-MOV-07: orthogonal escape across a perpendicular parent

- Given (tree profiles): `V[H[A,B*],C]`. Ordinary windows, no rules,
  scale 1, zero gaps for reference geometry.
- Given (column profiles): none exists. Side-by-side A,B with full-width
  C below has no column counterpart, so there is no faithful column
  Given; scrolling Thens below are fixture-inapplicable qualifications.
- When: move B down. Native verbs per profile: COSMIC directional move;
  Hyprland `movewindow d`; bspwm `node -s south --follow`; i3 `move down`;
  xmonad Navigation2D `windowSwap D`; sway `move down`; qtile Columns
  model inapplicable below; awesome `swap.bydirection("down")` in the
  tile projection; Ours Engine `plan_move` Down.
- Observe: escape across an orthogonal parent vs move into C, swap, or
  carry group. R-MOV-04 already covers same-axis escape.
- Then COSMIC: TBD; orthogonal escape outcome unresolved. `S(S-cos-move)`.
- Then Hyprland/Dwindle: TBD; reinsert anchor unresolved. `S(S-hyp-move)`.
- Then bspwm: B swaps with the south leaf C, yielding `V[H[A,C],B*]`;
  focus stays B. `S(S-bsp-move-target)`.
- Then i3: B escapes H to the outer V with R1 continuation, focus stays B.
  `S(S-i3-move)`.
- Then xmonad/Tall+Navigation2D: fixture-inapplicable (flat Tall has no
  nesting levels). `S(S-xmo-layout)`.
- Then sway: B escapes H to the outer V with R1 continuation, focus stays
  B. `S(S-sway-move)`.
- Then qtile/Columns: fixture-inapplicable (side-by-side H has no Columns
  counterpart; down verbs step in-column only). `S(S-qti-shuffle)` +
  `S(S-qti-add)`.
- Then awesome/tile: tile projection (master A, stack B/C) swaps B down
  with C geometrically, focus retained. `S(S-awe-swap)` + `S(S-awe-tile)`.
- Then niri: fixture-inapplicable (no column counterpart for side-by-side
  A,B under spanning C). `S(S-nir-move)`.
- Then PaperWM: fixture-inapplicable (same missing counterpart).
  `S(S-pap-move)`.
- Then karousel/Lazy: fixture-inapplicable (same missing counterpart).
  `S(S-kar-move)`.
- Then paneru: fixture-inapplicable (same missing counterpart).
  `S(S-pan-model)`.
- Then Ours KDE: B leaves the inner H with A as the sole remainder, and
  the inner H is replaced by V[A,B] mover-last; tree `V[V[A,B*],C]`,
  focus B. `S(S-ours-move)`.
- Then Ours Windows: same `V[V[A,B*],C]` wrap as Ours KDE via the shared
  Engine. `S(S-ours-move)`.
- Variant hook: V-MOVE-NARY.

### R-MOV-08: exhausted vertical move across stacked outputs

- Given (all profiles): `U=H[X]`, `L=V[A*,B]`; U directly above L.
  Ordinary windows, no rules, single workspace per output. Fresh mirrored
  down-edge leg only if asymmetric.
- Given (column profiles): same output split with `U=COL[CX[X]]` and
  `L=COL[C1[A*,B]]` at shipped defaults; viewport recorded per output.
- Given (layout-driven native legs): xmonad/Tall and awesome/tile use
  A as left master and B as right stack on L, with X alone on U.
  This is not a V projection; A is at the upper edge in either layout.
  qtile prepares one visible column A above B. `S(S-xmo-layout)` +
  `S(S-awe-tile)` + `S(S-qti-shuffle)`.
- When: move A up. Native verbs per profile: COSMIC directional move;
  Hyprland `movewindow u`; bspwm `node -s north --follow`; i3 `move up`; xmonad
  Navigation2D `windowSwap U`; sway `move up`; qtile `shuffle_up()`;
  awesome `swap.global_bydirection("up")`; niri `MoveWindowUp`; PaperWM
  up-move inventory below; karousel inapplicable below; paneru
  `Swap(North)` inventory below; Ours Engine `plan_move` Up.
  Explicit output-transfer verbs are not this leg (R-OUT-04 covers those).
- Observe: exhausted vertical move crosses output vs stays/restructures
  locally. Existing R4 hook excludes Up/Down for Ours.
- Then COSMIC: TBD; vertical output fallback unresolved. `S(S-cos-move)`.
- Then Hyprland/Dwindle: crosses to U via the monitor fallback.
  `S(S-hyp-move)`.
- Then bspwm: A swaps north with X across outputs, yielding `U=A*` and
  `L=V[X,B]`; `--follow` focuses A on U. `S(S-bsp-move-target)`.
- Then i3: crosses to U via the output-directed fallback with mover
  follow. `S(S-i3-move)` + `S(S-i3-outmove)`.
- Then xmonad/Tall+Navigation2D: TBD (`windowSwap` same-layer vs the
  separate `windowToScreen` carry verb unresolved). `S(S-xmo-nav)` +
  `S(S-xmo-out)`.
- Then sway: crosses to the output above via the directional attach path.
  `S(S-sway-move)` + `S(S-sway-outmove)`.
- Then qtile/Columns: A is first in C1, so `shuffle_up` is an edge no-op
  and A stays. `S(S-qti-shuffle)`.
- Then awesome/tile: crosses to U via `swap.global_bydirection`.
  `S(S-awe-swap)`.
- Then niri: A is first in C1, so `move_up` returns false and A stays.
  `S(S-nir-move)`.
- Then PaperWM: TBD; up-move verb inventory unresolved. `S(S-pap-move)`.
- Then karousel/Lazy: fixture-inapplicable for cross-output (single-screen
  profile). `S(S-kar-base)`.
- Then paneru: TBD; up-crossing peer resolution untraced. `S(S-pan-move)`.
- Then Ours KDE: stays local (Up never crosses; Boundary no-op, no R4).
  `S(S-ours-move)`.
- Then Ours Windows: same local no-op as Ours KDE (Up/Down excluded from
  R4). `S(S-ours-move)`.
- Variant hook: V-R4-DIR.

## Explicit-swap fresh legs (additive reuse; no duplicated start/action row)

Each leg replays the explicit swap verb from the same fixture as the
named move row, from a fresh fixture. Move-vs-swap reuse per the
expansion record; outcomes are qualified legs, not second scenarios.

### R-MOV-01 explicit-swap leg: swap B down from `H[A,C,B*]`

- When (fresh): the profile's explicit swap verb with its native target
  resolution. Hyprland `swapInDirection down` (directional focal target);
  bspwm `node -s south` (directional node target); i3/sway
  `swap container with mark|con_id` naming C (targeted only, no
  directional form); xmonad `windowSwap D` in the Tall projection
  (master A, stack C/B); qtile standalone swap inventory below;
  awesome `swap.bydirection("down")` in the tile projection; paneru
  `Swap(South)`; COSMIC/PaperWM swap inventory unresolved; niri,
  karousel, and Ours have no standalone swap verb (see Thens).
- Observe: swap exchanges vs no-op. Same fixture as R-MOV-01, fresh run.
- Then COSMIC: TBD; swap-verb inventory unresolved.
- Then Hyprland/Dwindle: TBD; flat triple has no ordinary binary swap
  target. `S(S-hyp-moveswap)`.
- Then bspwm: no south target in a single row, so no swap; tree and focus
  unchanged. `S(S-bsp-swap)`.
- Then i3: C named by mark/con_id; B and C exchange.
  `S(S-i3-swap)`.
- Then xmonad/Tall+Navigation2D: nothing geometrically below B in the
  Tall projection, so the miss is a no-op. `S(S-xmo-nav)` +
  `S(S-xmo-layout)`.
- Then sway: C named by mark/con_id; B and C exchange.
  `S(S-sway-move)`.
- Then qtile/Columns: no-counterpart; `swap(c1,c2)` is an internal drag
  helper, not an exposed standalone command. `S(S-qti-swap-inventory)`.
- Then awesome/tile: nothing geometrically below B in the tile
  projection, so the miss is a no-op. `S(S-awe-swap)` + `S(S-awe-tile)`.
- Then niri: no-counterpart (move/consume verbs in `S(S-nir-move)` plus
  the focus-verb inventory in `S(S-nir-actions)` list no swap verb).
- Then PaperWM: TBD; swap-verb inventory unresolved. `S(S-pap-move)`.
- Then karousel/Lazy: no-counterpart (window/column moves in
  `S(S-kar-move)` plus the focus verbs in `S(S-kar-focus)` list no swap
  verb).
- Then paneru: TBD; south peer resolution untraced. `S(S-pan-move)`.
- Then Ours KDE: no-counterpart (every `MoveOperation` is directional;
  exchange occurs only as R2a inside a directional move).
  `S(S-ours-move)`.
- Then Ours Windows: no-counterpart; no standalone swap verb in the shared
  directional operation inventory.
  `S(S-ours-move)`.

### R-MOV-03 explicit-swap leg: swap B right from `H[A,B*,C,D]`

- When (fresh): same per-profile swap inventory as the R-MOV-01 swap leg,
  right direction; i3/sway name C, xmonad and
  awesome use the flat-four projections below.
- Observe: swap exchanges vs no-op. Same fixture as R-MOV-03, fresh run.
- Then COSMIC: TBD; swap-verb inventory unresolved.
- Then Hyprland/Dwindle: TBD; flat four-child start has no ordinary
  binary swap target. `S(S-hyp-moveswap)`.
- Then bspwm: B swaps east with C, focus stays B. `S(S-bsp-swap)` +
  `S(S-bsp-flt-focus)`.
- Then i3: C named by mark/con_id; B and C exchange.
  `S(S-i3-swap)`.
- Then xmonad/Tall+Navigation2D: nothing geometrically right of B in the
  Tall projection (B tops the stack column), so the miss is a no-op.
  `S(S-xmo-nav)` + `S(S-xmo-layout)`.
- Then sway: C named by mark/con_id; B and C exchange.
  `S(S-sway-move)`.
- Then qtile/Columns: no-counterpart; only the internal drag helper
  exchanges clients, not a standalone swap command. `S(S-qti-swap-inventory)`.
- Then awesome/tile: nothing geometrically right of B in the tile
  projection, so the miss is a no-op. `S(S-awe-swap)` + `S(S-awe-tile)`.
- Then niri: no-counterpart (same verb inventories as the R-MOV-01 swap
  leg list no swap verb). `S(S-nir-move)` + `S(S-nir-actions)`.
- Then PaperWM: TBD; swap-verb inventory unresolved. `S(S-pap-move)`.
- Then karousel/Lazy: no-counterpart (same verb inventories list no swap
  verb). `S(S-kar-move)` + `S(S-kar-focus)`.
- Then paneru: TBD; east peer resolution untraced. `S(S-pan-move)`.
- Then Ours KDE: no-counterpart (same directional-only operation
  inventory). `S(S-ours-move)`.
- Then Ours Windows: no-counterpart; no standalone swap verb in the shared
  directional operation inventory.
  `S(S-ours-move)`.
