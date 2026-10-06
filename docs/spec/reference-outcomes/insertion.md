# Insertion (reference outcomes)

Part of the [outcome matrix index](../reference-outcomes.md). Notation, profiles, evidence legend, and variant hooks live in the index; `S()`/`D()` keys below resolve there. Wide tables moved here unchanged.

## 1. Insertion / splits

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | sway | qtile | awesome | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-INS-01 | `H[A,B*]`, B projected 1200x600 | Open C with B still focused | Split axis + position of C | Splits B's long edge (side-by-side), C appended after B, focus C; `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-mapfocus)` | Parent-geometry side-by-side split of B's long edge; C before/after B TBD (pointer half under follow_mouse); ordinary newcomer focused; `S(S-hyp-ins)` + `S(S-hyp-newfocus)` | Splits B's long edge side-by-side (1200x600 landscape), C second child after B, newcomer focused; `S(S-bsp-ins)` + `S(S-bsp-insert)`; exact pixels TBD | `H[A,B,C*]`: retains H (no geometry-driven axis under the splith embedding); C inserted after focused B, newcomer focused; `S(S-i3-ins)` | Start `H[A,B*]` is exactly two-window Tall (master A left, B stack right side-by-side); `insertUp` C above focused B yields StackSet order `[A,C*,B]` with newcomer focus, projected `H[A,V[C*,B]]` (master left half, C/B stacked right) via `tile`/`splitHorizontallyBy`+`splitVertically`, not a long-edge H split; exact pixel frames TBD; `S(S-xmo-ins)` + `S(S-xmo-layout)` + `S(S-xmo-admit)` | `H[A,B,C*]`: retains H (no geometry-driven axis; shipped landscape default H); C inserted after focused B via the focus-inactive anchor, ordinary newcomer focused; `S(S-sway-ins)` + `S(S-sway-wsdefault)` | Columns admits C into the focused column at the current position (insert_position=0 inserts at current, pushing B after) with newcomer focus; under the two-column default (num_columns=2, align right, split) C stacks with B vertically: projected `H[A,V[C*,B]]`; exact pixel frames TBD; `S(S-qti-default)` + `S(S-qti-add)` | Tile appends C last in tiled-client order (manage push) with newcomer focus (global rule); order [A,B,C] puts A master with B/C in the stack column (nmaster=1, mwfact 0.5), no geometry-driven axis; exact pixel frames TBD; `S(S-awe-tile)` + `S(S-awe-manage)` | Long-edge split at focused leaf; `D(D-dec-x)` (user statement); order TBD | V-INS-AXIS |
| R-INS-02 | Stack `S[A*,B]` (COSMIC) | Open C | Does C join the active stack | Joins active stack as appended tab, newcomer active, focus stays stack; `D(D-ref)` + `S(S-cos-mapfocus)` | No auto-created tab stack here: read as a Hyprland group analogue, C auto-joins the focused group as the tab after current (`insert_after_current`), newcomer current and focused; fresh groups still need a directional create/join; `S(S-hyp-group)` + `S(S-hyp-newfocus)` | No groups: one window per leaf, so C ordinary-tiles at the focused leaf instead of joining; `D(D-ref)` + `S(S-bsp-insert)` | `S[A,C*,B]` (tabbed embedding of the fixture stack): C joins the focused tabbed parent as the tab after focused A, newcomer active; `S(S-i3-ins)` + `S(S-i3-layout)` | TBD (no tabbed-stack group in the Tall/core/contrib profile; no join primitive here); `S(S-xmo-layout)` | `S[A,C*,B]` (tabbed embedding of the fixture stack): C joins the focused tabbed parent as the tab after focused A, newcomer active; stacked embedding analogous; `S(S-sway-ins)` + `S(S-sway-layout)` | No tab-stack join in this profile (split/unsplit columns only): C ordinary-admits at the focused position with newcomer focus, not as a tab; exact order/frames TBD; `S(S-qti-add)` | No tab-stack join in this profile: C ordinary-admits appending last in tiled order with newcomer focus, not as a tab; exact frames TBD; `S(S-awe-tile)` + `S(S-awe-manage)` | TBD (stacks unselected) | V-GROUP-STACK |

## New scenarios (GWT, piece B1; fixtures/actions/discriminators per the approved expansion record)

Notation, profiles, baselines, legend, and projection rules live in the
index. Each scenario below has exactly one Then bullet per profile (14).
`S()` tags attach only to the established sub-leg; anything else on that
line stays TBD. Column Given bullets are separate fixtures, never H/V
ancestry claims. Ours cells cite Engine + adapter source at `9241c94`
(`S(S-ours-ins)`); selected intent and doc assertions are never evidence.

### R-INS-03: first admission on an empty workspace

- Given (tree profiles): `WS1=H[]`, no focused window. Ordinary resizable
  windows, no rules, scale 1, zero gaps for reference geometry.
- Given (column profiles): empty column strip / empty Space row per
  profile; shipped defaults apply (`S(S-nir-base)`, `S(S-pap-base)`,
  `S(S-kar-base)`, `S(S-pan-base)`); record actual viewport before fill.
- When: open A. Native verbs/config per profile: COSMIC ordinary admission
  without explicit direction; Hyprland ordinary map under the Dwindle
  profile; bspwm ordinary manage; i3/sway ordinary manage; qtile Columns
  admit; awesome manage + tag arrange; niri/PaperWM/karousel/paneru
  ordinary open at shipped defaults; Ours Engine `insert_tiled` via the
  adapter `admit` op (`S(S-ours-ins)`).
- Observe: first tile size/anchor and focus vs leaving the app
  unmanaged/floating.
- Then COSMIC: anchor branch only - no-focus fallback splits root using
  output dimensions; `S(S-cos-axis)`; newcomer focus and exact frames TBD.
- Then Hyprland/Dwindle: anchor fallback branch only (mouse-hit, else
  active tiled, else first/closest node); `S(S-hyp-ins)`; ordinary newcomer
  focus per `S(S-hyp-newfocus)`; exact first frames TBD.
- Then bspwm: anchor at desktop focus; `S(S-bsp-insert)`; ordinary newcomer
  takes focus per the same branch; size scheme per `S(S-bsp-ins)`; exact
  first frames TBD.
- Then i3: TBD. Focused-branch `S(S-i3-ins)` (attach after focus, newcomer
  takes focus) does not cover the no-focus start; empty fallback TBD.
- Then xmonad/Tall+Navigation2D: TBD. Core manage path `S(S-xmo-admit)`
  plus `insertUp` `S(S-xmo-ins)` cover the focused case; empty Tall
  anchor/frames TBD.
- Then sway: fallback branch only - `workspace_add_tiling` when no
  focus-inactive node; `S(S-sway-ins)`; focus gate and geometry-default
  branches per `S(S-sway-ins)` + `S(S-sway-wsdefault)`; exact frames TBD.
- Then qtile/Columns: admission path only - focused-position insert with
  newcomer focus; `S(S-qti-add)` under `S(S-qti-default)`; no-focus current
  fallback and exact frames TBD.
- Then awesome/tile: manage-append path only - newcomer last in tiled
  order; `S(S-awe-tile)` + `S(S-awe-manage)`; empty-tag first frames TBD.
- Then niri: position leg - ordinary open wraps A in a new column at
  index active+1, or index 0 on the empty strip with the view offset
  reset; activated when told to; `S(S-nir-ins)`; settled width, viewport,
  and smart-activation remainder TBD.
- Then PaperWM: position and focus legs - A inserts at selected+1 under
  the shipped RIGHT default and activates on actor show;
  `S(S-pap-base)` + `S(S-pap-ins)`; settled frames TBD.
- Then karousel/Lazy: position leg - A opens a new column after the
  last-focused column (else the last column); a null left column inserts
  at the start of an empty grid, with A appended at the bottom;
  `S(S-kar-base)` + `S(S-kar-ins)`; KWin-side focus, viewport,
  and settled widths TBD.
- Then paneru: position-policy leg - A lands in the active strip at the
  config `insertion()` index, else the visually overlapped column, else
  the end, then reshuffles; `S(S-pan-base)` + `S(S-pan-ins)`; focus TBD.
- Then Ours KDE: topology and desired-focus legs - empty tree returns the
  single new leaf, and the admitted newcomer becomes the desired focus
  leaf with `last_active` updated; `S(S-ours-ins)` + `S(S-ours-admit)`;
  exact frames and adapter-side physical focus confirmation TBD.
- Then Ours Windows: same two legs as Ours KDE via the shared Engine
  plus the managed-claim gate and adapter admit application;
  `S(S-ours-ins)` + `S(S-ours-admit)`; frames and physical focus TBD.
- Variant hook: V-INS-AXIS.

### R-INS-04: chained admission with a fixed pointer

- Given (tree profiles): `H[A,B*]`, landscape work area, pointer fixed
  outside eligible windows. Ordinary windows, no refocus between legs.
- Given (column profiles): `COL[C1[A],C2[B*]]` at shipped defaults;
  viewport recorded; pointer fixed outside eligible windows.
- When: open C, then D, then E; do not refocus. Native verbs/config: same
  ordinary-open verbs as R-INS-03 per profile; pointer/focus update policy
  per profile TBD (live-test leg).
- Observe: topology after each admission - spiral/orientation alternation,
  current-leaf long edge, flat insertion or master/stack; column sizes
  stable vs reflow. First leg reuses R-INS-01; legs 2-3 are live-test
  candidates (admission plus pointer/focus updates and repeated geometry
  recalculation).
- Fixture-equivalence qualifier: the landscape-work-area fixture does NOT
  establish B at 1200x600, so first-leg reuse below is policy-branch only
  (admission axis, anchor, and newcomer-focus rules); exact R-INS-01
  dimensions and pixel frames stay TBD and are never re-voted here.
- Then COSMIC: first leg per the R-INS-01 cell (`S(S-cos-last)` +
  `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-mapfocus)`); legs 2-3
  TBD.
- Then Hyprland/Dwindle: first leg per the R-INS-01 cell (`S(S-hyp-ins)` +
  `S(S-hyp-newfocus)`); pointer-half ordering and legs 2-3 TBD.
- Then bspwm: first leg per the R-INS-01 cell (`S(S-bsp-ins)` +
  `S(S-bsp-insert)`); legs 2-3 TBD.
- Then i3: first leg per the R-INS-01 cell (`S(S-i3-ins)`); legs 2-3 TBD.
- Then xmonad/Tall+Navigation2D: first leg per the R-INS-01 cell
  (`S(S-xmo-ins)` + `S(S-xmo-layout)` + `S(S-xmo-admit)`); legs 2-3 TBD.
- Then sway: first leg per the R-INS-01 cell (`S(S-sway-ins)` +
  `S(S-sway-wsdefault)`); legs 2-3 TBD.
- Then qtile/Columns: first leg per the R-INS-01 cell (`S(S-qti-default)`
  + `S(S-qti-add)`); legs 2-3 TBD.
- Then awesome/tile: first leg per the R-INS-01 cell (`S(S-awe-tile)` +
  `S(S-awe-manage)`); legs 2-3 TBD.
- Then niri: TBD (all three legs; links R-COL-01 rather than duplicating
  its chain).
- Then PaperWM: TBD (all three legs; links R-COL-01).
- Then karousel/Lazy: TBD (all three legs; links R-COL-01).
- Then paneru: TBD (all three legs; links R-COL-01).
- Then Ours KDE: first leg topology per `S(S-ours-ins)` (focused-leaf
  wrap, admission-axis split, equal shares); newcomer focus, order, and
  legs 2-3 TBD.
- Then Ours Windows: first leg topology per `S(S-ours-ins)`; focus, order,
  and legs 2-3 TBD.
- Variant hook: V-INS-AXIS.

### R-INS-05: admission while an ordinary float has focus

- Given (tree profiles): `H[A,B]` plus ordinary `F*` (float focused);
  prior tiled focus B. Record the actual pre-action anchor per profile.
- Given (column profiles): column fixture plus ordinary focused float;
  prior tiled focus recorded; shipped defaults apply.
- When: open C. Native verbs/config: same ordinary-open verbs as R-INS-03;
  eligible-anchor filtering per profile is the discriminating leg
  (source-clear route: do not assume floats split).
- Observe: float focus as anchor, fallback to last tile, root or pointer
  target; newcomer layer and focus.
- Then COSMIC: TBD. Last-active branch `S(S-cos-last)` covers MRU
  resolution, not the float-exclusion predicate; outcome TBD.
- Then Hyprland/Dwindle: TBD. Anchor branches in `S(S-hyp-ins)` name
  mouse-hit/active-tiled candidates; float-focus exclusion TBD.
- Then bspwm: TBD. Desktop-focus anchor `S(S-bsp-insert)` names the
  anchor domain; float-focus behavior TBD.
- Then i3: TBD. `S(S-i3-ins)` covers focused-parent attach; float-focus
  anchor TBD.
- Then xmonad/Tall+Navigation2D: TBD. Manage path `S(S-xmo-admit)` does
  not settle float-focus anchoring; TBD.
- Then sway: TBD. Focus-inactive anchor `S(S-sway-ins)` names the tiling
  anchor; float-focus exclusion TBD.
- Then qtile/Columns: TBD. `S(S-qti-add)` covers the tiled admit path;
  float-focus anchor TBD.
- Then awesome/tile: TBD. `S(S-awe-tile)` + `S(S-awe-manage)` cover the
  tiled arrange path; float-focus anchor TBD.
- Then niri: TBD.
- Then PaperWM: TBD.
- Then karousel/Lazy: TBD.
- Then paneru: TBD.
- Then Ours KDE: anchor-predicate leg - the admission anchor is the
  focused leaf only while the focused domain is the target domain and the
  leaf is still a linked tile leaf (`eligible_focus_in`), and the admitted
  newcomer becomes the desired focus leaf; `S(S-ours-admit)`; how an
  F*-focused state resolves through that predicate stays TBD.
- Then Ours Windows: same anchor-predicate leg as Ours KDE via the shared
  Engine; `S(S-ours-admit)`; float-focus resolution TBD.
- Variant hook: provisional/TBD (no suitable existing hook; do not reuse
  V-FLOAT-FOCUS, which covers directional search, not admission anchor).

### R-INS-06: open over an overlay (maximized, plus fresh fullscreen variant)

- Given (tree profiles): `H[A,B*]`; prepare `B:max`; record the actual
  pre-action tree per profile. Fresh variant leg: `B:full`. Maximize and
  fullscreen are separate fresh legs, not synonyms.
- Given (column profiles): `COL[C1[A],C2[B*]]`; prepare `B:max` where the
  profile has a native maximize; else applicability TBD; fresh `B:full`
  variant recorded separately.
- When: open C. Native verbs/config: ordinary open per profile; overlay
  verbs per profile TBD at pin (live-test leg: overlay admission, render,
  and focus paths).
- Observe: overlay retained, cleared, or covering a newly admitted window;
  newcomer focus/visibility and underlying layout.
- Then COSMIC: TBD (`B:max` preparable via the maximize-request path;
  `S(S-cos-maxpolicy)`; overlay admission/render/focus TBD; fresh `B:full`
  leg likewise TBD).
- Then Hyprland/Dwindle: TBD (pending-maximum consume/apply
  `S(S-hyp-bornmax)` covers born-max, not open-over-existing-max; the
  fresh `B:full` leg likewise TBD).
- Then bspwm: `B:max` leg no-counterpart - the state inventory has no
  maximize (tiled/pseudo_tiled/floating/fullscreen only; `S(S-bsp-fs)`,
  consistent with the existing R-FLT-06 no-native-max classification);
  fresh `B:full` leg applicable but TBD.
- Then i3: `B:max` leg no-counterpart - the command inventory has no
  maximize verb (`S(S-i3-max)`, consistent with R-FLT-06); fresh `B:full`
  leg applicable via `S(S-i3-fs)` but TBD.
- Then xmonad/Tall+Navigation2D: `B:max` leg no-counterpart - no maximize
  state in this profile (`S(S-xmo-layout)`, consistent with R-FLT-06);
  fresh `B:full` leg applicable via the EWMH fullscreen path
  (`S(S-xmo-ewmh)`) but TBD.
- Then sway: `B:max` leg no-counterpart - the command inventory has no
  maximize verb (`S(S-sway-max)`, consistent with R-FLT-06); fresh `B:full`
  leg applicable via `S(S-sway-full)` but TBD.
- Then qtile/Columns: TBD (`B:max` preparable as a maximized float state;
  `S(S-qti-fs)`; overlay admission TBD; fresh `B:full` leg likewise TBD).
- Then awesome/tile: TBD (`B:max` preparable as a boolean property;
  `S(S-awe-fs)`; overlay admission TBD; fresh `B:full` leg likewise TBD).
- Then niri: TBD (`B:max` preparable via `set_maximized`;
  pending-maximized tiles open in the scrolling layout per `S(S-nir-ins)`;
  overlay admission/render/focus TBD; fresh `B:full` leg likewise TBD).
- Then PaperWM: TBD (maximized state handled at admission per
  `S(S-pap-ins)`; open-over-existing-max TBD; fresh `B:full` leg: born
  fullscreen inserts normally then re-fullscreens, overlay interplay TBD).
- Then karousel/Lazy: TBD (maximized newcomers skip arrange per
  `S(S-kar-ins)`; open-over-existing-max TBD; fresh `B:full` leg likewise
  TBD).
- Then paneru: TBD (`Fullscren` is a column kind, `S(S-pan-model)`;
  native fullscreen preparation and native-zoom `B:max` applicability
  require confirmation; overlay admission TBD).
- Then Ours KDE: TBD. Overlay-unfloat path `S(S-ours-overlay-unfloat)`
  covers toggle refusal, not admission over an overlay; both legs TBD.
- Then Ours Windows: TBD, same split as Ours KDE.
- Variant hook: V-MAX-MODEL for the `B:max` leg; V-FS-SLOT for the fresh
  `B:full` leg.

### R-INS-07: open with a destination rule into an inactive workspace/output

- Given: active `L:WS1=H[A*]`; inactive `R:WS2=H[B,C]`, WS2 prior focus C;
  pointer on L. Fixture-only destination rule (one case): the newly opened
  D belongs to WS2/R. The rule must be recorded with the run.
- Given (column profiles): same workspace/output split with column
  fixtures per workspace; shipped defaults apply; rule recorded.
- When: open D under that rule. Native verbs/config: launch routing plus
  inactive-workspace admission per profile TBD at pin (live-test leg).
- Observe: target-local anchor vs global focus; target admission without
  stealing source focus or switching output.
- Then COSMIC: TBD (routing plus inactive-workspace admission TBD at pin).
- Then Hyprland/Dwindle: TBD (routing TBD at pin).
- Then bspwm: TBD.
- Then i3: TBD.
- Then xmonad/Tall+Navigation2D: TBD.
- Then sway: TBD.
- Then qtile/Columns: TBD.
- Then awesome/tile: TBD.
- Then niri: routing-mechanism leg only - an `open_on_workspace` window
  rule can target the destination workspace (`S(S-nir-ins)`); whether the
  one-case fixture rule realizes through it, and the resulting anchor,
  focus-steal, and output-switch behavior, stay TBD.
- Then PaperWM: routing and no-steal legs - a winprop `spaceIndex` moves
  the window to that space and re-inserts it there, and inserts landing
  on an inactive space only ensure the viewport without stealing focus;
  `S(S-pap-ins)`; target-local anchor TBD.
- Then karousel/Lazy: TBD (single-screen profile; cross-output leg
  applicability TBD).
- Then paneru: TBD.
- Then Ours KDE: TBD.
- Then Ours Windows: TBD.
- Variant hook: provisional/TBD (contrast rule-targeted routing with
  R-OUT-05 pointer/focused-output routing when that row lands).

### R-INS-08: admission under an explicit preselected split direction

- Given (tree profiles): `H[A,B*]`, B landscape, no existing
  preselection. Record actual admission focus/anchor.
- Given (column profiles): applicability TBD per profile (explicit
  direction vs column insertion-index models); shipped defaults apply.
- When: preselect a vertical split at B; open C, then D without refocus.
  Native verbs per profile: Hyprland `layoutmsg preselect <direction>`
  (`S(S-hyp-pre)`); bspwm `node -p DIR` manual insertion mode
  (`S(S-bsp-pre)`); i3 `split vertical` (`S(S-i3-split)`);
  sway `splitv`/`split v` (`S(S-sway-default)` + `S(S-sway-split)`);
  COSMIC/xmonad/qtile/awesome/scrolling profiles/Ours: preselect-verb
  inventory TBD at pin (a missing verb is not a no-op; a layout
  approximation is not an exact fixture). Keep this distinct from an
  automatic chain.
- Observe: explicit direction overrides auto axis vs unsupported;
  consumed one-shot vs persistent direction on the next admission.
- Then COSMIC: TBD. The inspected direction-selection path is an
  interactive drop zone (`S(S-cos-drop)`), not preselection. A missing
  search term does not establish an absent native verb; inventory TBD.
- Then Hyprland/Dwindle: verb, override, and consumption legs - preselect
  writes the direction override, the next admission takes the forced axis
  and newcomer side, and the override resets after one opening under the
  shipped `permanent_direction_override=false` default;
  `S(S-hyp-pre)` + `S(S-hyp-defaults)`; exact C/D frames TBD.
- Then bspwm: verb and manual-mode legs - `-p DIR` preselects the
  splitting area (manual insertion mode) with `~` cancel;
  `S(S-bsp-pre)`; one-shot consumption and exact C/D geometry TBD.
- Then i3: verb and orientation-set legs - `split vertical` dispatches
  to `cmd_split`/`tree_split` VERT (`S(S-i3-split)`); override vs
  automatic admission and persistence TBD.
- Then xmonad/Tall+Navigation2D: no-counterpart - Tall tiles by a fixed
  master/stack algorithm with stack-only core verbs (`S(S-xmo-layout)` +
  `S(S-xmo-core-nav)`); an explicit split direction has no counterpart.
- Then sway: verb and dispatch legs - `splitv` ships on `$mod+v` (`$mod+b`
  is `splith`)
  and dispatches through `do_split` (`S(S-sway-default)` +
  `S(S-sway-split)`); override outcome and persistence TBD.
- Then qtile/Columns: TBD (tiny search finds no "preselect" in libqtile;
  `toggle_split` is a different concept per `S(S-qti-split)`; verb
  inventory TBD).
- Then awesome/tile: TBD (tiny search finds no "preselect" in the shipped
  layout sources; verb inventory TBD).
- Then niri: TBD (no "preselect" hits in `src/`; insertion-index model in
  `S(S-nir-ins)` is rule/target-driven, not a direction preselect).
- Then PaperWM: TBD (no "preselect" hits; position model is the
  open-position index per `S(S-pap-ins)`).
- Then karousel/Lazy: TBD (no "preselect" hits; column model only).
- Then paneru: TBD (no "preselect" hits; insertion-index model per
  `S(S-pan-ins)`).
- Then Ours KDE: TBD (no preselection concept evidenced at `9241c94`;
  not claimed absent - verb inventory TBD).
- Then Ours Windows: TBD, same as Ours KDE.
- Variant hook: V-INS-AXIS.

## Scrolling backfill (additive; existing wide tables above unchanged)

Projections are explicit rectangle-level links only, never split-tree
proof. Distinct column behavior links R-COL-01; no second lifecycle
inventory here.

### R-INS-01 backfill: ordinary third-window admission (scrolling profiles)

- Given (columns): `COL[C1[A],C2[B*]]`, each 0.5W, viewport showing both;
  shipped defaults per profile. The tree fixture `H[A,B*]` has no stated
  widths/viewport, so there is no exact projection - this is a separate
  column Given reusing the same A/B/C identities and open-C action.
- When: open C (same ordinary-open verbs as R-INS-03 per profile).
- Observe: same-column vs new-column admission, position relative to
  focus, widths stable vs rescaled, newcomer focus and viewport.
- Then niri: position leg - C opens as a new column right after the
  active (B) column per `S(S-nir-ins)`; widths, focus, and viewport TBD
  (links R-COL-01 for the viewport leg).
- Then PaperWM: position leg - C inserts at selected+1 under the shipped
  RIGHT default per `S(S-pap-ins)`; settled frames, focus remainder, and
  viewport TBD (links R-COL-01).
- Then karousel/Lazy: position leg - C opens a new column after the
  last-focused (B) column with C appended at the bottom per
  `S(S-kar-ins)`; KWin-side focus, widths, and viewport TBD (links
  R-COL-01).
- Then paneru: position-policy leg - C lands per the `window_managed`
  insertion policy (rule index, overlap column, or end) per
  `S(S-pan-ins)`; focus and viewport TBD (links R-COL-01).

### R-INS-02 backfill: stack admission (scrolling profiles)

- Given (columns): the same A/B identities and open-C action as the tree
  fixture `S[A*,B]`, column-qualified to `COL[C1[S[A*,B]]]` only where the
  profile supports a tabbed-display column with stated membership and
  active tab. PaperWM accordion and visible vertical stacking are not
  exact S equivalents; paneru native tabs are a distinct nesting
  predicate (see R-COL-10).
- When: open C (ordinary open per profile).
- Observe: C joins the tabbed display as a tab vs ordinary column
  admission; membership, order, active tab, and focus.
- Then niri: ordinary open wraps C in a new column (`add_tile` always
  creates a column per `S(S-nir-ins)`), so C does not join the tabbed
  display as a tab; active-tab and focus remainder TBD.
- Then PaperWM: TBD. Accordion is not an exact tabbed-display fixture;
  fixture applicability and admission require separate confirmation.
- Then karousel/Lazy: ordinary open creates a new column after the
  last-focused column per `S(S-kar-ins)`, so C does not join a stacked
  column as a tab (stacked display itself exists behind `toggleStacked`,
  off by default); active-tab and focus remainder TBD.
- Then paneru: TBD. `Stack` is ordered top-to-bottom, while `Tabs` holds
  app-native tabs (`S(S-pan-model)`); a visible stack is not this S fixture.
  Applicability and admission for an app-native-tab variant require
  confirmation; native-tab nesting stays separate under R-COL-10.
