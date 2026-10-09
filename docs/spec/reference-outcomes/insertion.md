# Insertion (reference outcomes)

Part of the [outcome matrix index](../reference-outcomes.md). Notation, profiles, evidence legend, and variant hooks live in the index; `S()`/`D()` keys below resolve there. Scenarios below are GWT with one Then bullet per profile (14).

## 1. Insertion / splits

<a id="scrolling-backfill-additive-existing-wide-tables-above-unchanged"></a>
<a id="r-ins-01-backfill-ordinary-third-window-admission-scrolling-profiles"></a>
### R-INS-01: ordinary third-window admission

- Given (tree profiles): `H[A,B*]`, B projected 1200x600

- Given (column profiles): `COL[C1[A],C2[B*]]`, each 0.5W, viewport showing both;
  shipped defaults per profile. The tree fixture `H[A,B*]` has no stated
  widths/viewport, so there is no exact projection - this is a separate
  column Given reusing the same A/B/C identities and open-C action.

- When: Open C with B still focused.

- When (column leg): open C (same ordinary-open verbs as R-INS-03 per profile).

- Observe: Split axis + position of C

- Observe (column leg): same-column vs new-column admission, position relative to
  focus, widths stable vs rescaled, newcomer focus and viewport.

- Then COSMIC: Splits B's long edge (side-by-side), C appended after B, focus C; `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-mapfocus)`
- Then Hyprland/Dwindle: Parent-geometry side-by-side split of B's long edge; C before/after B TBD (pointer half under follow_mouse); ordinary newcomer focused; `S(S-hyp-ins)` + `S(S-hyp-newfocus)`
- Then bspwm: Splits B's long edge side-by-side (1200x600 landscape), C second child after B, newcomer focused; `S(S-bsp-ins)` + `S(S-bsp-insert)`; exact pixels TBD
- Then i3: `H[A,B,C*]`: retains H (no geometry-driven axis under the splith embedding); C inserted after focused B, newcomer focused; `S(S-i3-ins)`
- Then xmonad/Tall+Navigation2D: Start `H[A,B*]` is exactly two-window Tall (master A left, B stack right side-by-side); `insertUp` C above focused B yields StackSet order `[A,C*,B]` with newcomer focus, projected `H[A,V[C*,B]]` (master left half, C/B stacked right) via `tile`/`splitHorizontallyBy`+`splitVertically`, not a long-edge H split; exact pixel frames TBD; `S(S-xmo-ins)` + `S(S-xmo-layout)` + `S(S-xmo-admit)`
- Then sway: `H[A,B,C*]`: retains H (no geometry-driven axis; shipped landscape default H); C inserted after focused B via the focus-inactive anchor, ordinary newcomer focused; `S(S-sway-ins)` + `S(S-sway-wsdefault)`
- Then qtile/Columns: Columns admits C into the focused column at the current position (insert_position=0 inserts at current, pushing B after) with newcomer focus; under the two-column default (num_columns=2, align right, split) C stacks with B vertically: projected `H[A,V[C*,B]]`; exact pixel frames TBD; `S(S-qti-default)` + `S(S-qti-add)`
- Then awesome/tile: Tile appends C last in tiled-client order (manage push) with newcomer focus (global rule); order [A,B,C] puts A master with B/C in the stack column (nmaster=1, mwfact 0.5), no geometry-driven axis; exact pixel frames TBD; `S(S-awe-tile)` + `S(S-awe-manage)`
- Then niri: C opens as a new column right after the active column; existing widths TBD (stable vs rescaled); focus and viewport TBD. `S(S-nir-ins)`.
- Then PaperWM: C inserts at selected+1 under the shipped RIGHT default, activated on show; existing widths TBD (stable vs rescaled); viewport TBD. `S(S-pap-ins)`.
- Then karousel/Lazy: C opens a new column after the last-focused column, appended at the bottom; existing widths TBD (stable vs rescaled); focus and viewport TBD. `S(S-kar-ins)`.
- Then paneru: C lands per the `window_managed` insertion policy (rule index, overlap column, or end); existing widths TBD (stable vs rescaled); focus and viewport TBD. `S(S-pan-ins)`.
- Then Ours KDE: Long-edge split at focused leaf; `D(D-dec-x)` (user statement); order TBD
- Then Ours Windows: Long-edge split at focused leaf; `D(D-dec-x)` (user statement); order TBD
- Variant hook: V-INS-AXIS.

<a id="r-ins-02-backfill-stack-admission-scrolling-profiles"></a>
### R-INS-02: stack admission

- Given (tree profiles): Stack `S[A*,B]` (COSMIC)

- Given (column profiles): the same A/B identities and open-C action as the tree
  fixture `S[A*,B]`, column-qualified to `COL[C1[S[A*,B]]]` only where the
  profile supports a tabbed-display column with stated membership and
  active tab. PaperWM accordion and visible vertical stacking are not
  exact S equivalents; paneru native tabs are a distinct nesting
  predicate (see R-COL-10).

- When: Open C.

- When (column leg): open C (ordinary open per profile).

- Observe: Does C join the active stack

- Observe (column leg): C joins the tabbed display as a tab vs ordinary column
  admission; membership, order, active tab, and focus.

- Then COSMIC: Joins active stack as appended tab, newcomer active, focus stays stack; `D(D-ref)` + `S(S-cos-mapfocus)`
- Then Hyprland/Dwindle: No auto-created tab stack here: read as a Hyprland group analogue, C auto-joins the focused group as the tab after current (`insert_after_current`), newcomer current and focused; fresh groups still need a directional create/join; `S(S-hyp-group)` + `S(S-hyp-newfocus)`
- Then bspwm: No groups: one window per leaf, so C ordinary-tiles at the focused leaf instead of joining; `D(D-ref)` + `S(S-bsp-insert)`
- Then i3: `S[A,C*,B]` (tabbed embedding of the fixture stack): C joins the focused tabbed parent as the tab after focused A, newcomer active; `S(S-i3-ins)` + `S(S-i3-layout)`
- Then xmonad/Tall+Navigation2D: TBD (no tabbed-stack group in the Tall/core/contrib profile; no join primitive here); `S(S-xmo-layout)`
- Then sway: `S[A,C*,B]` (tabbed embedding of the fixture stack): C joins the focused tabbed parent as the tab after focused A, newcomer active; stacked embedding analogous; `S(S-sway-ins)` + `S(S-sway-layout)`
- Then qtile/Columns: No tab-stack join in this profile (split/unsplit columns only): C ordinary-admits at the focused position with newcomer focus, not as a tab; exact order/frames TBD; `S(S-qti-add)`
- Then awesome/tile: No tab-stack join in this profile: C ordinary-admits appending last in tiled order with newcomer focus, not as a tab; exact frames TBD; `S(S-awe-tile)` + `S(S-awe-manage)`
- Then niri: C does not join as a tab - ordinary open always wraps a new column. `S(S-nir-ins)`; active-tab and focus TBD.
- Then PaperWM: TBD (no tabbed-display column evidenced at pin; applicability unresolved).
- Then karousel/Lazy: C does not join as a tab - ordinary open creates a new column (stacked display exists behind `toggleStacked`, off by default). `S(S-kar-ins)`; active-tab and focus TBD.
- Then paneru: fixture-inapplicable - `Stack` is ordered visible stacking while `Tabs` holds app-native tabs, so the S fixture has no counterpart here; native-tab nesting stays under R-COL-10. `S(S-pan-model)`.
- Then Ours KDE: TBD (stacks unselected)
- Then Ours Windows: TBD (stacks unselected)
- Variant hook: V-GROUP-STACK.


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
- Then COSMIC: A tiles full work area, focused. `S(S-cos-axis)` + `S(S-cos-mapfocus)`.
- Then Hyprland/Dwindle: A tiles full work area, focused. `S(S-hyp-ins)` + `S(S-hyp-newfocus)`.
- Then bspwm: A tiles full desktop, focused. `S(S-bsp-insert)` + `S(S-bsp-ins)`.
- Then i3: A tiles workspace, focused. `S(S-i3-ins)`.
- Then xmonad/Tall+Navigation2D: A tiles as sole stack entry, focused. `S(S-xmo-admit)` + `S(S-xmo-ins)`.
- Then sway: A tiles workspace, focused. `S(S-sway-ins)` + `S(S-sway-wsdefault)`.
- Then qtile/Columns: A tiles, focused. `S(S-qti-add)` under `S(S-qti-default)`.
- Then awesome/tile: A tiles full tag, focused. `S(S-awe-tile)` + `S(S-awe-manage)`.
- Then niri: A opens a new column at index 0 at the default column width. `S(S-nir-base)` + `S(S-nir-ins)`; activation/focus TBD.
- Then PaperWM: A inserts as a new column at selected+1 under the shipped RIGHT default, activated on show. `S(S-pap-base)` + `S(S-pap-ins)`; settled width TBD.
- Then karousel/Lazy: A opens a new column at the start of the empty grid, width from the client preferred width. `S(S-kar-base)` + `S(S-kar-ins)`; KWin-side focus TBD.
- Then paneru: A lands in the active strip per the `insertion()` index path, then reshuffles. `S(S-pan-base)` + `S(S-pan-ins)`; width and focus TBD.
- Then Ours KDE: A is the single new leaf with full-work-area geometry applied via the admit geometry plan; newcomer is the desired focus leaf. `S(S-ours-ins)` + `S(S-ours-admit)`; native activation TBD.
- Then Ours Windows: same single-leaf leg as Ours KDE via the shared Engine plus the managed-claim gate. `S(S-ours-ins)` + `S(S-ours-admit)`; native activation TBD.
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
  establish B at 1200x600, so first-leg reuse below is policy-branch only;
  pixel dimensions stay TBD and are never re-voted here.
- Then COSMIC: C splits B's long edge after B, focused (axis follows B's actual frame); legs 2-3 TBD. `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-mapfocus)`.
- Then Hyprland/Dwindle: C splits B's long-edge axis, focused; newcomer side follows the pointer half under follow_mouse (pointer outside eligible windows, side TBD); legs 2-3 TBD. `S(S-hyp-ins)` + `S(S-hyp-newfocus)`.
- Then bspwm: C splits B's long edge as second child after B, focused (axis follows B's actual frame); legs 2-3 TBD. `S(S-bsp-ins)` + `S(S-bsp-insert)`.
- Then i3: flat `H[A,B,C*]`, C after B, focused; legs 2-3 TBD. `S(S-i3-ins)`.
- Then xmonad/Tall+Navigation2D: StackSet `[A,C*,B]` projected `H[A,V[C*,B]]`, newcomer focused; legs 2-3 TBD. `S(S-xmo-ins)` + `S(S-xmo-layout)` + `S(S-xmo-admit)`.
- Then sway: flat `H[A,B,C*]`, C after B, focused; legs 2-3 TBD. `S(S-sway-ins)` + `S(S-sway-wsdefault)`.
- Then qtile/Columns: C joins the focused column at the current position pushing B after, focused; legs 2-3 TBD. `S(S-qti-default)` + `S(S-qti-add)`.
- Then awesome/tile: C appended last (`[A,B,C]`, A master, B/C stacked), focused; legs 2-3 TBD. `S(S-awe-tile)` + `S(S-awe-manage)`.
- Then niri: TBD (all three legs; links R-COL-01 rather than duplicating its chain).
- Then PaperWM: TBD (all three legs; links R-COL-01).
- Then karousel/Lazy: TBD (all three legs; links R-COL-01).
- Then paneru: TBD (all three legs; links R-COL-01).
- Then Ours KDE: leg-1 topology per `S(S-ours-ins)` (focused-leaf wrap old/new, admission-axis split, equal shares), newcomer desired focus; legs 2-3 TBD.
- Then Ours Windows: leg-1 topology per `S(S-ours-ins)` (same old/new wrap), newcomer desired focus; legs 2-3 TBD.
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
- Then COSMIC: C tiles at the last-active tile (float focus is not in the tiling tree, so B anchors), newcomer focused. `S(S-cos-last)` + `S(S-cos-mapfocus)`.
- Then Hyprland/Dwindle: float focus excluded from the active-tiled candidate, but the anchor is the pointer-hit window under shipped follow_mouse else the active tile - pointer unstated here, so B vs pointer-hit TBD; newcomer tiles focused. `S(S-hyp-ins)` + `S(S-hyp-newfocus)` + `S(S-hyp-defaults)`.
- Then bspwm: C splits the focused float F at its own tree slot - floats stay vacant in place with the slot kept, `manage_window` anchors at the desktop focus with no float exclusion, and `insert_node` wraps F plus the newcomer with C as second child under the shipped polarity; C tiles (ordinary, no float/fullscreen/hidden state) and takes focus. `S(S-bsp-insert)` + `S(S-bsp-ins)` + `S(S-bsp-fltanchor)`.
- Then i3: C tiles at the tiling-focused descendant (float focus excluded), newcomer focused. `S(S-i3-ins)`.
- Then xmonad/Tall+Navigation2D: C inserts above the focused float F via `insertUp` with newcomer focus - `manage` has no float-focus exclusion and F stays in both the stack and the floating map; C tiles (ordinary resizable, neither fixed-size nor transient). `S(S-xmo-admit)` + `S(S-xmo-ins)` + `S(S-xmo-float)`.
- Then sway: C tiles at the focus-inactive tiling anchor (float focus excluded), newcomer focused. `S(S-sway-ins)`.
- Then qtile/Columns: ordinary C admits to the tiled path (no float-rule match) at the current tiled position - a new column opens only while the focused column is non-empty below `num_columns`, otherwise C inserts at current pushing later clients after; focusing float F only blurs the tiled layouts without moving `Columns.current`, so the eligible anchor stays the last tiled current (B); C tiles with newcomer focus. `S(S-qti-add)` + `S(S-qti-fltanchor)`.
- Then awesome/tile: C appends last in global client order regardless of F's focus - `manage` pushes the newcomer at the end (anchor-independent) while the tile partition excludes the float F; C tiles (ordinary) with newcomer focus via the shipped global rule. `S(S-awe-tile)` + `S(S-awe-manage)`.
- Then niri: ordinary C (no floating rule, normal sizing) takes the workspace Auto scrolling branch into a new column after the scrolling-active column - focusing float F only sets the floating-active flag and never moves the scrolling active column, so the anchor stays B; under the fixture's Smart activation (no pending fullscreen) the new column activates, the floating layer deactivates, and keyboard focus follows the layout active window to C; C tiles in the scrolling layer. `S(S-nir-ins)` + `S(S-nir-fltanchor)`.
- Then PaperWM: C inserts tiled at selected+1 under the shipped RIGHT default - ordinary C passes the Normal-only admit filter, and the focused float lives in the separate floating list with focusing it returning before any selection write, so the selected anchor stays B; newcomer activated on show. `S(S-pap-ins)` + `S(S-pap-fltanchor)`.
- Then karousel/Lazy: C opens a new column after the last-focused column - `lastFocusedColumn` is written only by the tiled column-focus path, so focusing float F leaves it at B's column; KWin-side newcomer focus TBD. `S(S-kar-ins)` + `S(S-kar-fltanchor)`.
- Then paneru: fresh C stays managed in the active strip and appends at the end - no rule index or `dont_focus` applies under the shipped defaults, and the focused ordinary float is unmanaged outside the strip so the after-focus lookup misses; newcomer focus is synthesized. `S(S-pan-fresh)` + `S(S-pan-base)`.
- Then Ours KDE: no eligible tile focus (float holds an exception, not a tile leaf), so C wraps the whole root old/new via the fallback, desired focus newcomer. `S(S-ours-ins)` + `S(S-ours-admit)` + `S(S-ours-flt-target)`; native activation TBD.
- Then Ours Windows: same fallback root-wrap as Ours KDE via the shared Engine. `S(S-ours-admit)` + `S(S-ours-flt-target)` + `S(S-ours-ins)`; native activation TBD.
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
- Then COSMIC: TBD (both legs; overlay admission/render/focus unresolved). `B:max` preparable via `S(S-cos-maxpolicy)`.
- Then Hyprland/Dwindle: TBD (both legs; born-max `S(S-hyp-bornmax)` is not open-over-existing-max).
- Then bspwm: `B:max` leg no-counterpart (no maximize in the state inventory; `S(S-bsp-fs)`); fresh `B:full` leg applicable but TBD.
- Then i3: `B:max` leg no-counterpart (no maximize verb; `S(S-i3-max)`); fresh `B:full` leg applicable via `S(S-i3-fs)` but TBD.
- Then xmonad/Tall+Navigation2D: `B:max` leg no-counterpart (no maximize state; `S(S-xmo-layout)`); fresh `B:full` leg applicable via `S(S-xmo-ewmh)` but TBD.
- Then sway: `B:max` leg no-counterpart (no maximize verb; `S(S-sway-max)`); fresh `B:full` leg applicable via `S(S-sway-full)` but TBD.
- Then qtile/Columns: TBD (both legs; `B:max` preparable as a maximized float state per `S(S-qti-fs)`).
- Then awesome/tile: TBD (both legs; `B:max` preparable as a boolean property per `S(S-awe-fs)`).
- Then niri: TBD (both legs; pending-maximized tiles open in the scrolling layout per `S(S-nir-ins)`).
- Then PaperWM: TBD (both legs; maximized/born-fullscreen admission per `S(S-pap-ins)`, open-over-existing-max TBD).
- Then karousel/Lazy: TBD (both legs; maximized newcomers skip arrange per `S(S-kar-ins)`).
- Then paneru: TBD (both legs; `Fullscren` is a column kind per `S(S-pan-model)`, native preparation requires confirmation).
- Then Ours KDE: TBD (both legs; overlay-unfloat `S(S-ours-overlay-unfloat)` covers toggle refusal, not admission over an overlay).
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
- Then COSMIC: D routes to WS2 via the fixture-declared workspace-target activation token and admits at the target MRU anchor (C), D after C on C's long-edge split; source focus stays A with an urgent mark on WS2 and no workspace/output switch; exact nested embedding and frames TBD (genuinely require the unknown target geometry). `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-mapfocus)` + `S(S-cos-wsroute)`.
- Then Hyprland/Dwindle: a fixture-declared silent `workspace` windowrule routes D to WS2 with no workspace switch and no newcomer focus (source focus stays A); the target anchor falls to `getClosestNode` for the mouse-on-L point (PWORKSPACE is inactive, so the mouse-hit and same-workspace active branches do not apply), leaving D before/after C and exact geometry TBD. `S(S-hyp-ins)` + `S(S-hyp-newfocus)` + `S(S-hyp-winws)`.
- Then bspwm: a fixture-declared `desktop=WS2` rule routes D to WS2 at the desktop focus C, inserted as second child at the anchor (D after C); the inactive target is hidden (no switch) and activated-not-focused under the shipped follow-off default, so source focus stays A. `S(S-bsp-insert)` + `S(S-bsp-ins)` + `S(S-bsp-wsroute)`.
- Then i3: a fixture-declared `assign` (workspace or number) routes D to WS2 at the tiling-focused descendant C, opened after focus (D after C); the invisible target marks urgency with no focus steal (source focus stays A) and no workspace switch in the manage path. `S(S-i3-ins)` + `S(S-i3-assign)`.
- Then xmonad/Tall+Navigation2D: under a fixture-declared custom `doShift WS2` (shipped core `manageHook` is MPlayer-only), D shifts to WS2 and inserts above the target focus C via `insertUp` (D above C, newcomer current on that stack); `onWorkspace` restores the current view, so no workspace switch and visible focus stays A. `S(S-xmo-admit)` + `S(S-xmo-shift)` + `S(S-xmo-doshift)`.
- Then sway: a fixture-declared `assign` routes D to WS2 (created if needed); admission anchors after the target focus-inactive node C with the ordinary sibling policy, but the newcomer takes no focus on the inactive workspace and no workspace switch occurs in the map path, so source focus stays A. `S(S-sway-ins)` + `S(S-sway-assign)`.
- Then qtile/Columns: a fixture-declared Group `matches` rule assigns D to the WS2 group via `togroup` without `switch_group` (stays, no screen switch); Columns opens a new column if below `num_columns=2`, otherwise inserts in the current column at `insert_position=0`, making D current in that group while visible focus stays A; exact embedding TBD because this row does not declare column membership or setup order. `S(S-qti-add)` + `S(S-qti-dgroup)`.
- Then awesome/tile: a fixture-declared ruled tag routes D to the WS2 tag where it appends last (D after C); activation only focuses when visible, so the inactive D takes no focus (urgent instead) and nothing switches tags under the shipped rule (`switch_to_tags` opt-in, unset); visible focus stays A. `S(S-awe-tile)` + `S(S-awe-manage)` + `S(S-awe-wsroute)`.
- Then niri: a fixture-declared `open_on_workspace` rule resolves the target monitor and named workspace at initial configure and maps D there as a new column after the fixture-declared active C; under the shipped `Smart` activation the inactive workspace is not activated (no switch) and visible focus stays A while D activates within the target workspace. `S(S-nir-ins)` + `S(S-nir-wsopen)`.
- Then PaperWM: a fixture-declared winprop `spaceIndex` moves D to WS2 and re-inserts it there via the existing-window path, landing after the fixture-declared selected C under the shipped RIGHT default; inactive-space inserts only ensure the viewport without stealing focus or switching, so source focus stays A. `S(S-pap-ins)`.
- Then karousel/Lazy: cross-output leg fixture-inapplicable under the single-screen scope (`S(S-kar-single)`); workspace leg has no plugin launch-rule route (window rules cover tile/float/caption only), while a native single-desktop D tiles on the WS2 grid after the last-focused column per the ordinary admission path; target focus, no-steal, and switch TBD. `S(S-kar-single)` + `S(S-kar-ins)` + `S(S-kar-wsroute)`.
- Then paneru: no-counterpart - fresh spawn admits only into the active strip at the config `insertion()` index or after focus, with no workspace-targeted launch rule in the inspected spawn/config inventory (remembered-strip re-insert is a re-manage path, not fresh routing); anchor/focus/switch have no fresh-routing leg. `S(S-pan-ins)` + `S(S-pan-spawn)`.
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
- Then COSMIC: TBD (no preselection verb evidenced; drop-zone `S(S-cos-drop)` is a different path, not absence proof).
- Then Hyprland/Dwindle: preselect forces the next admission axis and newcomer side, then resets under the shipped default. `S(S-hyp-pre)` + `S(S-hyp-defaults)`.
- Then bspwm: `-p DIR` preselects the splitting area with `~` cancel (manual insertion mode). `S(S-bsp-pre)`; consumption and geometry TBD.
- Then i3: `split vertical` sets VERT orientation. `S(S-i3-split)`; override and persistence TBD.
- Then xmonad/Tall+Navigation2D: no-counterpart - fixed master/stack algorithm has no split-direction verb. `S(S-xmo-layout)` + `S(S-xmo-core-nav)`.
- Then sway: `splitv` dispatches through `do_split`. `S(S-sway-default)` + `S(S-sway-split)`; override and persistence TBD.
- Then qtile/Columns: TBD (verb inventory TBD; `toggle_split` is a different concept per `S(S-qti-split)`).
- Then awesome/tile: TBD (verb inventory TBD in the shipped layout sources).
- Then niri: TBD (insertion-index model per `S(S-nir-ins)`, not a direction preselect).
- Then PaperWM: TBD (open-position index model per `S(S-pap-ins)`, not a direction preselect).
- Then karousel/Lazy: TBD (column model only, no preselect evidenced).
- Then paneru: TBD (insertion-index model per `S(S-pan-ins)`, not a direction preselect).
- Then Ours KDE: TBD (no preselection concept evidenced at `9241c94`; not claimed absent).
- Then Ours Windows: TBD, same as Ours KDE.
- Variant hook: V-INS-AXIS.
