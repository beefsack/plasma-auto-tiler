# Mouse (reference outcomes)

Part of the [outcome matrix index](../reference-outcomes.md). Notation, profiles, evidence legend, and variant hooks live in the index; `S()`/`D()` keys below resolve there. Wide tables moved here unchanged.

## 10. Mouse drag

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | sway | qtile | awesome | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-DRAG-01 | `H[A,B*,C]`, B tiled | Drag B onto C's centre (not an edge); release | Stack join vs refusal; source restoration | Centre WindowStack drop converts the target to a stack and appends the mover's surfaces; tiling drags run in overview mode with drop-zone placeholders. The centre region is the rounded central thirds of the target frame, outside it the nearest edge picks the `WindowSplit` direction; `S(S-cos-drop)` + `S(S-cos-zone)` + `S(S-cos-dragedge)`; native preview delivery TBD | No centre-stack mapping: ungrouped C cannot accept a group join (join needs a grouped hover + `drag_into_group` + grouping gates); B floats at threshold (siblings refill) then re-tiles via fresh Dwindle admission, no old-slot restore; exact re-admission position TBD (release geometry unrecorded); `S(S-hyp-drag)` + `S(S-hyp-dragend)` + `S(S-hyp-ins)` | No stack join: pointer ACTION_MOVE over tiled C swaps B/C in place (`H[A,C,B]`, focus stays B; same-desktop swap writes borders only); centre-vs-edge not distinguished, no group counterpart; exact hover pixel TBD; `S(S-bsp-drag)` + `S(S-bsp-flt-swap)` | No COSMIC stack join: centre DT_CENTER (cursor outside 30% edge bands) runs `con_move_to_target` without swap (Shift swap-modifier `con_swap` instead); tiled producer needs an enabled `tiling_drag` path (shipped modifier+titlebar, code default modifier-only) with >1 drop target, else no drag starts; self-centre/Esc/NULL-target aborts with indicator destroy and no mutation; `S(S-i3-tdrag)` + `S(S-i3-tdrop)`; exact centre pixel/swap state and native preview TBD | No centre-stack mapping in source: no stack/tab join verb in this profile; `mod-button1` drag floats B on motion (survivors refill via Tall recalc) and floats again on release, then `shiftMaster`; no peer mutation, no slot restore; exact release frame TBD; `S(S-xmo-mouse)` + `S(S-xmo-layout)` | No COSMIC stack join: content-centre (outside 30% edge bands, not a titlebar) runs centre `container_swap` with the hovered target (titlebar hover instead tabifies via `container_split` L_TABBED + indexed insert); needs enabled `tiling_drag` (shipped enabled, threshold 9) with >1 tiling view, else NULL abort; self/descendant-centre NULL aborts with indicator destroy and no mutation; swap preserves mover focus on the same workspace; `S(S-sway-tdrag)` + `S(S-sway-tdrop)`; exact centre pixel and native preview TBD | No stack join: pointer over C runs the explicit set_position swap (B/C exchange places with heights, no centre/edge distinction); shipped Mod+Button1 instead runs set_position_floating (floating tweak, not the tiled swap); exact hover pixel and drop-side focus TBD; `S(S-qti-drag)` + `S(S-qti-tweak)` | No centre-stack mapping: tiled mouse.move over C swaps B/C list positions via move_handler (centre-vs-edge not distinguished; swap with no focus write, tile recalc settles frames); floating path would move the frame instead; shipped modkey/Mod4+Button1 and titlebar Button1 share the same move path; exact hover pixel/frames TBD; `S(S-awe-drag)` + `S(S-awe-swap)` + `S(S-awe-tile)` | Centre stack request refused (snap-back); `D(D-dec-cos)` + `D(D-dec-nest)`; physical check pending | V-DRAG-ZONE |
| R-DRAG-02 | `H[A,B,C]` equal (640 each at 1920); existing N outside that group | Drag N to the between-child bar between A and B; release | Flat vs nested; mover share (n=4 after insertion) | Flat `H[A,N,B,C]`, all 480 (mover 1/n, peers scaled); `UT(2026-08-22)` + [Test B](../../cosmic-move-conformance.md#follow-up-manual-observations-tests-a-c); GroupInterior drop inserts at the hovered index; `S(S-cos-drop)` | No between-child bar/index mapping in source; if N starts tiled it floats at threshold then re-tiles via the Dwindle admission anchor at the drop point, while ordinary floating N stays floating absent a successful group join (ungrouped A/B/C offer none); exact outcome TBD (N initial state, binary embedding/bar equivalent, and drop geometry unspecified); `S(S-hyp-drag)` + `S(S-hyp-dragend)` + `S(S-hyp-ins)` | No between-child bar/index mapping: a bar hover is unmanaged (root/gap), so no swap/insert occurs and N stays put on the same monitor (off all monitors likewise no-ops); a cross-monitor point instead transfers to that monitor's focus; exact bar pixel/N start state TBD; `S(S-bsp-drag)` | No between-child bar/index mapping: the bar x resolves via nearest-edge direction into DT_SIBLING (inside the 30% edge band, split if parent orientation differs then `insert_con_into`) or DT_CENTER (`con_move_to_target`, or `con_swap` with Shift); orientation comes from the edge direction, not splith default; focus preserved; `S(S-i3-tdrag)` + `S(S-i3-tdrop)`; exact bar pixel, N start state (tiled vs floating) and mover share/frames TBD (drop geometry unspecified) | No between-child bar/index mapping in source: the pointer path writes one floating frame and never inserts at an index; N stays floating at its dragged frame plus `shiftMaster`, no flat/nested admission, no 1/n share; exact bar pixel/N start TBD; `S(S-xmo-mouse)` | No between-child bar mapping as such: a titlebar hover inserts flat at the computed bar index via `split_titlebar`/`split_border` (`H[A,N,B,C]` shape when bars are the hover); content hover resolves via nearest-edge into edge split+insert vs centre swap, orientation from the edge direction; the mover adopts a sibling share (finalize copies sibling fractions); `S(S-sway-tdrag)` + `S(S-sway-tdrop)`; exact bar pixel, N start state and frames TBD (drop geometry unspecified) | No between-child bar/index mapping in source: a bar hover hits no window, so set_position swaps nothing and N stays; shipped Mod+Button1 instead tweaks N's frame on the floating path; exact outcome TBD (producer, N float state, and bar pixel unspecified); `S(S-qti-drag)` + `S(S-qti-tweak)` | No between-child bar/index mapping in source: bar/gap hover hits no tiled client, so move_handler swaps nothing and N stays (no flat insert, no 1/n share; shares are master/stack plus windowfact); exact bar pixel/N start/focus TBD; `S(S-awe-drag)` + `S(S-awe-tile)` | TBD (between-child drop not checked here) | V-DRAG-ZONE |
| R-DRAG-03 | `H[A,B*]`, both tiled | Title-bar drag B to A's top edge; repeat from the same start with Meta/Win+left client drag | Same drop topology and mover; no client click or sibling reflow before drop | No client click on either path: Super-held presses are suppressed in the compositor, title-bar drags start server-side; the grabbed source unmaps to a `GrabbedWindow` placeholder holding its slot (siblings do not reflow into it). A's top edge resolves to `WindowSplit` Up (nearest-edge pick; centre-thirds would stack instead); `S(S-cos-dragstart)` + `S(S-cos-dragedge)`; native reflow frames TBD | Dispatcher support only, not a default-binding claim: `mouse:movewindow` begins a drag on hit, decoration `DRAG_START` hit skips it; threshold default 0 floats B at grab so siblings refill mid-hold (no slot placeholder); drop re-tiles via fresh admission; same-topology across producers and client-click behavior TBD (release geometry/client ack unrecorded); `S(S-hyp-keyend)` + `S(S-hyp-drag)` + `S(S-hyp-dragend)` | Producers differ: Meta/Win+button1 ACTION_MOVE drags B with per-motion hover swaps (top-edge hover over A swaps A/B, edge-vs-centre not distinguished; the grab itself writes no focus); a bare title-bar drag without the pointer modifier has no counterpart in source; cross-producer same-topology TBD (title-bar leg unevidenced); `S(S-bsp-drag)` | Both producers start the same tiled drag under shipped `tiling_drag modifier titlebar` (modifier+left anywhere incl client; titlebar left without modifier; code default modifier-only refuses the titlebar-only path): modifier path starts immediately before focus, titlebar path focuses first then drags thresholded (~15px) with no client click in either case; grabbed source stays mapped with indicator-only preview (siblings do not reflow mid-hold); A's top edge is nearest-edge DT_SIBLING Up (outer thin band would be DT_PARENT instead); `S(S-i3-tdrag)` + `S(S-i3-tdrop)`; exact edge pixel/parent-band and native frames TBD | Producers share no drop topology: only `mod-button1` (move) and `mod-button3` (resize) drags exist, both float on motion/release plus `shiftMaster`; a bare title-bar drag without the modifier has no counterpart in source; no edge/centre topology, no placeholder; same-topology TBD (title-bar leg unevidenced); `S(S-xmo-mouse)` | Both producers start the same tiled drag under settled-enabled `tiling_drag` (modifier+left anywhere incl client; titlebar left without modifier; code defaults enabled/threshold 9, unlike the i3 modifier-only default): press focuses first via the generic click-focus path with no client button forwarded before the grab, then modifier begins immediately while titlebar waits for the output-scaled 9px threshold; the grabbed source stays attached with indicator-only preview (detach only at finalize; siblings do not reflow mid-hold); A's top edge is a 30px/30% edge split Up (the outer layout-border walk may take a layout parent instead); `S(S-sway-tdrag)` + `S(S-sway-tdrop)`; exact edge pixel/parent-band and native frames TBD | Producers differ: shipped Mod+Button1/Button3 are floating tweaks (frame write plus closest-screen transfer, never the tiled set_position swap); a bare title-bar drag has no counterpart in the shipped bindings; cross-producer same-topology TBD (title-bar leg unevidenced); `S(S-qti-tweak)` + `S(S-qti-drag)` | Both producers share the same tiled move path (shipped modkey/Mod4+Button1 client move and titlebar Button1 move both activate with mouse_move action); press activates B (focus plus raise via permissions.activate); source stays mapped mid-hold, siblings reflow only on hover-swap via recalc (no placeholder/scale/preview in the tiled path; snap placeholder is floating aerosnap only); A's top edge still hovers A, so drop swaps B/A; exact edge pixel/frames TBD; `S(S-awe-drag)` + `S(S-awe-swap)` | KDE: same resolver selected `D(D-dec-drag)`; Windows: both producers delivered with three-window synthetic preview/drop agreement and mid-hold sibling stability; exact row TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-04 | `H[A,B*]`, both tiled | Start moving B; press Esc; release | Source topology/geometry retained; no drop plan; preview cleared | Bare Escape intercepts to `PrivateAction::Escape`, which unsets the pointer grab; the move-grab `unset` is a no-op so dropping the grab runs the normal `Drop` `drop_window` at the current hover: no cancel path exists, and a zero-move drop restores via the `InitialPlaceholder`; `S(S-cos-dragesc)` + `S(S-cos-drop)`; moved-then-Escaped exact topology TBD (fixture states no hover/drop point, so which `drop_window` branch runs is unspecified; the normal-drop mechanism itself is proven) | No Esc cancel path: any key press (Esc included) runs the normal `endDragTarget` drop, never a restore; moved-then-Esc exact topology TBD (hover/drop point unrecorded); `S(S-hyp-keyend)` + `S(S-hyp-dragend)` | No Esc/key cancel path: pointer grabs end only on button release; key presses run the generic event switch with no grab-cancel branch, so performed hover swaps persist and release ends normally; moved-then-Esc exact topology TBD (hover/drop point unspecified); `S(S-bsp-drag)` | Any key press (Esc included) during the drag reverts: `tiling_drag` aborts with indicator destroy and no tree/focus mutation, never a drop-at-hover; `S(S-i3-tdrag)`; no drop plan and no preview residue by source | No Esc/key cancel path in source: the pointer grab ends only on button release, which runs release `done` (`float`, never a restore); performed motion persists as B floating at its written frame plus `shiftMaster`; moved-then-Esc exact topology TBD (hover/drop point unspecified; the normal-release mechanism itself is sourced); `S(S-xmo-mouse)` | No key-press cancellation hook: bare Esc does not revert or end the tiled drag; release runs the normal `finalize_move` at the current hover (NULL hover aborts with no mutation, otherwise drops); diverges from the i3 any-key revert; `S(S-sway-tdrag)` + `S(S-sway-tdrop)`; moved-then-Esc exact topology TBD (hover/drop point unspecified; the normal-drop mechanism itself is sourced) | No key-cancel branch in the inspected drag inventory (set_position swap, floating tweaks, shipped Drag/Click bindings only): release runs the normal swap-or-tweak at the current pointer, so performed motion persists; moved-then-Esc exact topology TBD (hover/drop point unspecified); `S(S-qti-drag)` + `S(S-qti-tweak)` | No key-cancel branch in the inspected drag inventory (grab ends on button release only; leave callbacks run the normal geometry emit); release drops at the current hover (swap-or-move), so performed motion persists; moved-then-Esc exact topology TBD (hover/drop point unspecified); `S(S-awe-drag)` | KDE: cancelled verdict makes no plan and clears preview `D(D-dec-drag)`; Windows: synthetic title/Win Esc restores all frames without mutation, Win preview hidden before Up; physical edge/exact row TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-05 | `H[A,B*]`, both tiled | Press/release the move gesture on B without moving | No topology/share change or preview residue | Client-initiated moves stay `Delayed` below 1px motion; a no-move tiling drop restores the source slot via `InitialPlaceholder`; `S(S-cos-dragthresh)`; native residue TBD | Threshold default 0 picks B up immediately (float + sibling refill), so release re-tiles via fresh admission rather than slot restore; exact rebuilt topology TBD (no motion/drop point recorded); no preview/placeholder residue path established in source; `S(S-hyp-drag)` + `S(S-hyp-dragend)` | No mutation: zero-move press/release runs no MOTION path so `move_client` is never called; any sub-threshold motion over B's own window returns false (pointer still over self), so no swap/transfer occurs; no threshold pickup, placeholder, or indicator residue path in source; `S(S-bsp-drag)` | No mutation: titlebar-path press/release stays under the ~15px threshold so the callback never runs (NULL target abort); modifier-path immediate pick-up released over its own centre hits the self-centre no-draw abort; both destroy the indicator with no preview residue; `S(S-i3-tdrag)` + `S(S-i3-tdrop)`; native residue TBD only outside this source path | Not no-mutation here: even zero-move press/release runs release `done` (`float w`) plus `shiftMaster`, so B floats at its unchanged frame and becomes master (survivors refill around the floater via Tall recalc); no threshold distinction, no preview/placeholder residue path; exact frame TBD; `S(S-xmo-mouse)` + `S(S-xmo-layout)` | No mutation: titlebar press/release under the output-scaled 9px threshold never reaches post-threshold targeting (`finalize_move` with NULL target returns to default with indicator destroy); modifier immediate pick-up released over its own centre/titlebar hits the self/descendant NULL abort (source-titlebar cancel + self-centre guard); both destroy the indicator with no preview residue; `S(S-sway-tdrag)` + `S(S-sway-tdrop)`; native residue TBD only outside this source path | No mutation: with the pointer still over B's own frame set_position skips self and finds no other hit, so no swap occurs; a zero-delta floating tweak rewrites the same frame; no threshold pickup, placeholder, or indicator residue path in source; `S(S-qti-drag)` + `S(S-qti-tweak)` | No mutation on zero-move: pointer still over B's own frame gives no other hovered tiled client, so move_handler swaps nothing (self guarded); floating path rewrites the same frame; grab ends on release with no threshold pickup/placeholder/preview residue in source; `S(S-awe-drag)` | KDE: no-change verdict makes no plan `D(D-dec-drag)`; Windows: synthetic title/Win zero-move preserves all frames without mutation or preview residue on a three-window fixture; exact row TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-06 | `H[A,B*]`, one output with a panel/taskbar outside the work area | Move B; release over the panel/taskbar outside the work area | Source restoration vs off-area placement; preview cleared | Drop geometries come from the work-area `non_exclusive_zone`, so a pointer over the panel matches no tile geometry and yields no zone: the hover placeholders clear and the drop falls back to a fresh `map_to_tree` admission inside the work area (neither off-area placement nor source-slot restore); `S(S-cos-dropzone)`; realized native frames TBD | No off-area placement and no slot restore: release re-tiles inside the work area via fresh admission (floating-middle monitor check only moves workspaces, never parks on panels); exact frames TBD (panel/monitor geometry unrecorded); `S(S-hyp-drag)` + `S(S-hyp-dragend)` | No off-area placement and no source-restore step: panel hover is unmanaged on the same monitor (no swap), off all monitors likewise no-ops; tiled B never leaves the tree mid-hold; which branch runs TBD (panel geometry/containment unrecorded); no preview residue path; `S(S-bsp-drag)` | No off-area placement: pointer off all outputs yields NULL target and aborts with no mutation; pointer inside the output but outside tiles falls back to the visible-workspace admission inside the work area; `S(S-i3-tdrop)`; which branch runs is TBD (panel/taskbar geometry and output containment unrecorded); indicator destroyed either way | Off-workarea frame retained and no source-restore step: the pointer path writes the raw frame with no zone check and release floats there plus `shiftMaster`; no admission fallback parks it back inside; exact panel/drop containment TBD (panel geometry unrecorded); no preview residue path; `S(S-xmo-mouse)` | No off-area placement: pointer over a layer surface (panel/taskbar) yields a NULL node and NULL target, and release aborts with no mutation (indicator destroyed at seatop end); only workspace/edge targets inside the output admit, never parking on the panel; `S(S-sway-tdrop)`; which branch runs is TBD (panel/taskbar geometry and output containment unrecorded); indicator destroyed either way | No off-area placement via set_position (panel hover hits no tiled window, so no swap; tiled B never leaves the layout mid-hold); floating tweak_float transfers across screens by closest-screen only, never parks on panels; which branch runs TBD (producer and panel geometry unrecorded); no preview residue path; `S(S-qti-drag)` + `S(S-qti-tweak)` | No off-area placement via the tiled path: panel/taskbar hover hits no tiled client so no swap occurs and tiled B never leaves the layout mid-hold (screen follow only on actual screen change); which branch runs TBD (panel geometry/containment unrecorded); no preview residue path; `S(S-awe-drag)` | KDE: unresolved target snaps back `D(D-dec-drag)`; Windows: title/Win taskbar-outside refusal restores all frames without mutation or preview residue on a three-window fixture; exact row TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-07 | `H[A,B*]`, both tiled | Meta/Win+left client drag B to A's edge; pause before release | Native frame follows pointer vs retained source allocation with target-slot preview; final placement unchanged | Tiling mover image follows the pointer at retained client size (pointer motion writes the grab location, render translates retained geometry by location+offset), scaled 0.6->1.0 over 150ms (0.4 alpha on other outputs), with a `StackHover` indicator and overview drop-zone placeholders; the source unmaps to a `GrabbedWindow` placeholder at grab start; `S(S-cos-dragframe)`; native pixels/timing TBD | Dragged frame follows the pointer (floating position writes + warp) while the tiled source already refilled at pick-up; no target-slot preview/placeholder established in source; final placement is the drop re-tile, exact position TBD; `S(S-hyp-drag)` + `S(S-hyp-dragend)`; visuals/timing TBD | Retained allocation mid-hold: the tiled mover stays in tree until a hover swap/transfer (no pointer-following frame write, no scale/alpha/indicator or target-slot preview in source); siblings reflow only on swap/transfer; exact final position TBD; `S(S-bsp-drag)` | Retained allocation mid-hold: tiled `tiling_drag` never writes the source frame, it only draws the `i3-drag` drop indicator at the target slot (siblings do not reflow until drop); this is the floating-modifier client path, distinct from `floating_drag_window` which moves the floating frame; final placement follows the DT_SIBLING/CENTER/PARENT branch for A's edge; `S(S-i3-tdrag)` + `S(S-i3-tdrop)`; native pixels/timing TBD | Frame follows the pointer: per-motion `moveWindow` at retained size with `float` on each motion (survivors refill mid-hold, no slot placeholder); no target-slot preview; final placement is the floated frame plus `shiftMaster`, never a drop branch; visuals/timing TBD; `S(S-xmo-mouse)` | Retained allocation mid-hold: the mover stays attached until finalize (`container_detach` only on the non-swap drop; the swap path re-links in place), so siblings do not reflow; only the indicator rect moves (drop-box positioned/sized per target) with pointer focus cleared at begin; final placement follows the titlebar-tabbed/edge-split/centre-swap/empty-workspace branch for A's edge; `S(S-sway-tdrag)` + `S(S-sway-tdrop)`; native pixels/timing TBD | Shipped producer follows the pointer by floating tweak (frame writes on motion, then closest-screen transfer only; no slot preview, scale, or indicator in source); explicit set_position swaps only at invocation with no mid-hold preview either; exact pixels and final placement TBD; `S(S-qti-tweak)` + `S(S-qti-drag)` | Retained allocation mid-hold: tiled mouse.move never writes the source frame, it only swaps on hover via move_handler (siblings reflow only on swap via recalc); no target-slot preview/scale/indicator in the tiled path (snap placeholder is floating aerosnap only); final placement is the hover-swap, exact position TBD; `S(S-awe-drag)` + `S(S-awe-tile)` | KDE: native frame moves and target-slot preview is selected `D(D-dec-drag)`; Windows: provisional stationary source with visible target-slot preview, three-window synthetic freeze/preview/drop proof; exact row TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-08 | `H[A*,B]`, B unfocused tiled | Meta/Win+left client press on B; move; release at A's edge | Native focus changes at press vs drop; dragged group visual without changing retained focus | Pointer press changes keyboard focus unless the pointer is grabbed; the Super+Left move path focuses the target at press and the drop focuses the dropped mapped; `S(S-cos-dragpress)` + `S(S-cos-dragframe)`; dragged-group visuals TBD | Press focuses B (`rawWindowFocus` + raise at `dragBegin`), drop focuses the dragged; dispatcher/begin-drag policy only, not a default-binding claim; exact edge position and group visuals TBD; `S(S-hyp-drag)` + `S(S-hyp-dragend)` + `S(S-hyp-keyend)` | Press writes no focus (the ACTION_MOVE grab path has no focus write; focus only via the separate ACTION_FOCUS/click path); same-monitor hover swap writes borders only, so B stays unfocused mid-hold and after; exact visuals TBD; `S(S-bsp-drag)` | Modifier-client press does not focus before the drag (tiling drag masks enter-window; end restores focus/fullscreen, with old-focus restore on the DT_PARENT `tree_move` path), so B stays unfocused mid-hold; drop-side focus follows the branch taken, not a promised mover-focus; `S(S-i3-tdrag)` + `S(S-i3-tdrop)`; exact press-vs-drop focus and dragged-group visuals TBD (edge pixel and branch unspecified; titlebar producer would focus first instead) | Press focuses B (`focus w` runs before `mouseMoveWindow`), mid-hold retains B (no focus write in the motion path), release `shiftMaster` keeps focus on B; no dragged-group visual path; exact edge position TBD; `S(S-xmo-mouse)` | Press focuses B first via the generic click-focus path (titlebar press selects the inactive view; client press focuses the container), then the drag begins with pointer focus cleared; mid-hold retains B's seat focus (no focus write in the motion path); drop-side focus follows the branch taken - non-swap inserts keep seat focus, centre `container_swap` preserves the mover focus on the same workspace via `swap_focus`; diverges from the i3 modifier-no-focus path; `S(S-sway-tdrag)` + `S(S-sway-tdrop)`; exact press-vs-drop focus and dragged-group visuals TBD (edge pixel and branch unspecified) | Press focuses B first via follow_mouse_focus=true (shipped; bring_front_click=false, only Mod+Button2 bring_to_front bound); mid-hold retains B; drop-side focus TBD (Columns swap writes no focus; exact branch/edge unspecified); `S(S-qti-tweak)` + `S(S-qti-drag)` | Press activates B (focus plus raise via permissions.activate for both modkey/Mod4+client and titlebar producers); mid-hold retains B (no focus write in move_handler/swap); drop-side focus follows the swap with mover retained (swap exchanges positions with no focus write; global re-activates mover only on cross-screen); dragged-group visuals have no counterpart; exact edge/focus journey TBD; `S(S-awe-drag)` + `S(S-awe-swap)` | KDE: exact focus timing TBD; Windows: provisional foreground retained during hold, B activated on valid drop; synthetic unfocused-mover proof, C parked `D(D-win-drag)` | V-DRAG-ZONE |

## New scenarios (GWT; fixtures/actions/discriminators per the approved expansion record)

Notation, profiles, baselines, legend, and projection rules live in the
index. Each scenario below has exactly one Then bullet per profile (14).
`S()` tags attach only to the established sub-leg; anything else on that
line stays TBD. Column Given bullets are separate fixtures, never H/V
ancestry claims. Ours cells cite Engine + adapter source at `9241c94`
plus established `S(S-ours-*)` keys and the new `S(S-ours-mou)` pointer
paths; selected intent and doc assertions are never evidence.

### R-MOU-01: pointer hover vs click focus

- Given (tree profiles): `H[A*,B]`, pointer on A. Hover leg names its
  exact variant per profile (shipped ffm default, explicit
  enabled/disabled override, or no-counterpart); click leg runs from a
  fresh click-focus fixture. Ordinary windows, no rules.
- Given (column profiles): `COL[C1[A*],C2[B]]`, pointer on C1; same
  two legs; shipped defaults apply; viewport recorded.
- When: move the pointer into B (hover leg); plain left-click B
  without modifiers (click leg, never a mod-drag).
- Observe: hover vs click focus, delayed/sloppy policy, and click
  delivery vs focus-only consumption. Modifier-drag press focus stays
  R-DRAG-08.
- Then COSMIC: click presses focus B and deliver to the client unless
  Super-held (compositor consumes) or on the resize fork (focus kept);
  hover-focus relationship beyond the press path TBD.
  `S(S-cos-dragpress)`; hover queued.
- Then Hyprland/Dwindle: hover focuses B under shipped
  `input:follow_mouse=1` (FFM reason); plain press refocuses B with
  raise (CLICK reason, unless `follow_mouse=3`). `S(S-hyp-follow)` +
  `S(S-hyp-drag)`.
- Then bspwm: plain button1 click focuses B via ACTION_FOCUS (shipped
  `click_to_focus` default); hover leg needs the explicit
  `focus_follows_pointer=true` variant (shipped false), whose
  enter-to-focus journey stays TBD. `S(S-bsp-ptrfocus)`; hover queued.
- Then i3: hover focuses B under shipped enabled
  focus-follows-mouse; plain click focuses via `con_activate` in the
  click path. `S(S-i3-ffm)` + `S(S-i3-click)`.
- Then xmonad/Tall+Navigation2D: hover focuses B on entry under
  shipped `focusFollowsMouse=True`; plain click focuses B under
  shipped `clickJustFocuses=True`. `S(S-xmo-ffm)`.
- Then sway: hover focuses B under shipped `focus_follows_mouse=yes`;
  plain click focuses the clicked container. `S(S-sway-ffm)`.
- Then qtile/Columns: hover focuses B via EnterNotify under shipped
  `follow_mouse_focus=True`; plain click focuses via `focus_by_click`
  without raising under shipped `bring_front_click=False`.
  `S(S-qti-click)`.
- Then awesome/tile: hover focuses B without raising via shipped
  `mouse::enter` sloppy activate; plain button1 click activates
  focus plus raise. `S(S-awe-sloppy)`.
- Then niri: shipped hover-focus is off; the named
  `focus-follows-mouse max-scroll-amount="0%"` variant focuses fully
  visible B without raising. Plain click activates B and forwards the
  button event. `S(S-nir-ffm)`.
- Then PaperWM: CENTER/EDGE are viewport modes, not pointer-focus
  policy; host hover/click producers and delivery remain TBD.
  `S(S-pap-focusmode)`; queued.
- Then karousel/Lazy: hover/click focus is the host KWin journey
  (no focus policy in the profile source). Queued.
- Then paneru: hover focuses B under shipped enabled
  `focus_follows_mouse`; click marks held and
  reshuffles on release while host macOS click focuses, journey TBD.
  `S(S-pan-base)` + `S(S-pan-mouse)`; click-focus queued.
- Then Ours KDE: native host click/hover focus journey untraced
  (adapter verbs are inventory only, not the host producer path).
  `S(S-ours-mou)`; queued.
- Then Ours Windows: same host-producer journey TBD as Ours KDE.
  `S(S-ours-mou)`; queued.
- Variant hook: provisional/TBD (pointer-focus hook, to discuss).

### R-MOU-02: drag the shared edge to resize

- Given (tree profiles): `H[A*,B]` 50/50, fixed work area. Ordinary
  windows, no rules, scale 1.
- Given (column profiles): two 0.5W single-window columns at shipped
  defaults; viewport recorded. Bare edge drag first; profile-required
  modifier grabs named per profile, never silently substituted.
- When: drag the shared edge right 100px with the profile's
  applicable producer (named per Then; bare edge first, modifier
  grabs only where the profile requires one); release.
- Observe: ratio/share change vs frame-only/no resize, sibling clamp
  and ratio retention. Float drag/resize stays R-FLT-14.
- Then COSMIC: tiling resize fork exists between tiles and the pixel
  resize path adjusts the nearest matching-edge-axis ancestor;
  dragged share outcome TBD. `S(S-cos-resize)`; queued.
- Then Hyprland/Dwindle: bare-edge drag starts no resize under
  shipped `resize_on_border=false` (falls to the click-focus path);
  enabled variant begins an MBIND_RESIZE drag with min/max clamp;
  tiled share outcome TBD. `S(S-hyp-edgeresize)`; queued.
- Then bspwm: `pointer_modifier=Mod4` resize_side/corner grab adjusts the fence
  split_ratio by dx/fence-width clamped to [0,1] with reflow; 100px
  moves the shared fence by 100/fence-width. `S(S-bsp-ptrresize)`.
- Then i3: border drag moves percent shares between the pair with a
  1px minimum clamp; 100px grows A and shrinks B by that amount.
  `S(S-i3-border)`.
- Then xmonad/Tall+Navigation2D: bare edge drag starts nothing
  (inspected bindings list only mod-button1 move and mod-button3
  resize); mod-button3 leg floats B instead of resizing shares, so
  tile shares never change on either producer. `S(S-xmo-mouse)`.
- Then sway: border BTN_LEFT press begins the tiling edge resize;
  motion resizes the pair's width fractions with a sane-minimum
  clamp. `S(S-sway-rszedge)`.
- Then qtile/Columns: no-counterpart (shipped Drag binds are
  floating-only; the tiled mod-drag swaps instead of resizing, so no
  pointer verb changes tile shares). `S(S-qti-drag)`.
- Then awesome/tile: edge drag reaches the tile layout's
  mouse_resize_handler, which moves master_width_factor to the
  pointer x; master and stack reflow. `S(S-awe-tresize)`.
- Then niri: Mod+Right and valid client edge-resize requests open an
  interactive resize; dragged width/neighbor outcome TBD.
  `S(S-nir-ptr)` + `S(S-nir-clientgrab)`; queued.
- Then PaperWM: RESIZING_* grabs construct a marker ResizeGrab whose
  end is a no-op (native Mutter resize proceeds, re-tiled after);
  share outcome TBD. `S(S-pap-grab)`; queued.
- Then karousel/Lazy: edge drag writes the dragged column width via
  onUserResizeWidth while the neighbor keeps its width under shipped
  `resizeNeighborColumn=false`. `S(S-kar-ptr)`.
- Then paneru: modifier-hold move resizes the window width by 5x the
  pointer delta; managed-column sibling shares TBD. `S(S-pan-mouse)`;
  queued.
- Then Ours KDE: pointer-resize verb exists in the adapter inventory
  but proves no share outcome; host journey TBD. `S(S-ours-mou)`;
  queued.
- Then Ours Windows: same inventory-only verb, host journey TBD.
  `S(S-ours-mou)`; queued.
- Variant hook: provisional/TBD (edge-resize hook, to discuss).

### R-MOU-03: drag across outputs and onto a workspace target

- Given (tree profiles): `L:WS1=H[A,B*]`, `R:WS2=H[C]`, hidden WS3
  exists. Ordinary windows, no rules.
- Given (column profiles): per-output strips at shipped defaults;
  karousel two-output fixture inapplicable (single-screen scope).
- When: drag B to C's edge on R; release. Fresh fixture: drag B onto
  the WS3 switcher/overview target.
- Observe: cross-output insertion/follow vs float/cancel;
  hidden-workspace hover-switch/drop vs unavailable target. Two
  explicit targets, not a generic off-area drop (R-DRAG-06).
- Then COSMIC: drop lands in the cursor output's space and focuses the
  dropped window; overview-switcher target journey TBD (tiling grabs
  open overview mode but no switcher drop branch is traced).
  `S(S-cos-dragframe)` + `S(S-cos-drop)`; queued.
- Then Hyprland/Dwindle: tiled-origin drag floats at pick-up, a
  middle crossing reassigns to that monitor's active workspace, and
  the drop re-tiles via fresh admission with mover focus; exact
  insert position and switcher target TBD. `S(S-hyp-drag)` +
  `S(S-hyp-dragend)`; queued.
- Then bspwm: ACTION_MOVE drag across monitors transfers the node
  (tiled hover-swap path spans monitors); target desktop and focus
  plus switcher journey TBD. `S(S-bsp-drag)`; queued.
- Then i3: cross-output leg inserts B beside C on R through the same
  rect-hit DT mechanics (the walk spans all outputs) and, B focused,
  shows the new workspace with mover focus; hidden-WS3 switcher leg
  has no counterpart (drop targets are visible-workspace tiles only).
  `S(S-i3-tdrop)`.
- Then xmonad/Tall+Navigation2D: cross-output drop journey untraced
  (pointer path writes raw frames plus shiftMaster; no drop-branch
  model in this profile). `S(S-xmo-mouse)`; queued.
- Then sway: same-output finalize mechanics (edge split+insert,
  centre swap) apply at any found target; cross-output target walk
  and switcher journey TBD. `S(S-sway-tdrop)`; queued.
- Then qtile/Columns: tiled cross-output outcome TBD (tiled mod-drag
  swaps with the hovered window while only the float branch carries
  across screens). `S(S-qti-drag)`; queued.
- Then awesome/tile: tiled move follows the screen under the pointer;
  insertion index and focus plus switcher journey TBD.
  `S(S-awe-drag)`; queued.
- Then niri: the moving tile tracks output changes with output focus
  and drops at the pointer insert position on R; exact column index
  and switcher target TBD. `S(S-nir-drag)`; queued.
- Then PaperWM: DnD zones span all spaces and entering R begins DnD;
  the drop inserts at the R zone and activates; WS3 switcher leg has
  no counterpart (minimaps hide during DnD). `S(S-pap-grab)`.
- Then karousel/Lazy: cross-output leg fixture-inapplicable
  (single-screen scope, `S(S-kar-single)`); switcher-target drop
  journey TBD. Queued.
- Then paneru: pointer drag is the host macOS journey (no engine
  drag model; MouseDragged forwards to Lua only); display verbs are
  keyboard-only. `S(S-pan-mouse)`; queued.
- Then Ours KDE: drag-drop verb exists in the adapter inventory but
  proves no outcome; host journey TBD. `S(S-ours-mou)`; queued.
- Then Ours Windows: same inventory-only verb, host journey TBD.
  `S(S-ours-mou)`; queued.
- Variant hook: provisional/TBD (cross-output-drop hook, to discuss).

## Scrolling backfill (additive; existing wide tables above unchanged)

### R-DRAG-01 backfill: drag onto a column centre (scrolling)

- Given (columns): `COL[C1[A],C2[B*],C3[C]]`, each 0.5W; VP recorded.
  Same identities and action as the original row: drag B onto C's
  centre; release.
- Observe: column join vs swap/move/float-out; source restoration.
- Then niri: drop re-inserts at the pointer insert position; the
  pointer path carries no consume/join (consume/expel is a separate
  keyboard Action). Exact insert column TBD. `S(S-nir-drag)` +
  `S(S-nir-consume)`; queued.
- Then PaperWM: centre resolves to a within-column or column DnD
  zone, never a join (slurp/barf are separate); exact row TBD.
  `S(S-pap-grab)` + `S(S-pap-slurp)`; queued.
- Then karousel/Lazy: pointer drag untiles B to float under shipped
  `untileOnDrag=true`, so no column join or source-slot restoration
  occurs. `S(S-kar-ptr)`.
- Then paneru: pointer drag is the host macOS journey (no engine
  drag model; MouseDragged forwards to Lua only). `S(S-pan-mouse)`;
  queued.

### R-DRAG-02 backfill: drag to a between-column bar (scrolling)

- Given (columns): `H[A,B,C]` equal (640 each at 1920) projected to
  `COL[C1[A],C2[B],C3[C]]` plus existing N outside that group; VP
  recorded. Same action: drag N to the bar between A and B.
- Observe: flat insert at index vs nested/no-op; mover share (n=4
  after insertion in the original predicate).
- Then niri: drop re-inserts N at the pointer insert position;
  exact index and shares TBD. `S(S-nir-drag)`; queued.
- Then PaperWM: the bar resolves to a column DnD zone inserting a
  new column at that index; mover share TBD. `S(S-pap-grab)`; queued.
- Then karousel/Lazy: a tiled N untiles under shipped
  `untileOnDrag=true`, so no index insert occurs; N's unspecified
  initial layer and resulting share outcome remain TBD.
  `S(S-kar-ptr)`; queued.
- Then paneru: pointer drag is the host macOS journey (no engine
  drag model). `S(S-pan-mouse)`; queued.

### R-DRAG-03 backfill: two drag producers, same drop (scrolling)

- Given (columns): `COL[C1[A],C2[B*]]`; VP recorded. Same action:
  title-bar drag B to A's top edge; repeat with Mod+Left client drag.
- Observe: same drop topology across producers; no client click or
  reflow before drop.
- Then niri: Mod+Left and valid client titlebar move requests use
  MoveGrab; the client path also permits horizontal viewport scrolling,
  unlike Mod+Left. Top-edge drop parity/click delivery remain TBD.
  `S(S-nir-drag)` + `S(S-nir-clientgrab)`; queued.
- Then PaperWM: both producers enter the shared MOVING grab with the
  same DnD zones; click TBD. `S(S-pap-grab)`; queued.
- Then karousel/Lazy: move/resize session hooks fire for any host
  producer, so both funnel to untile-or-snap-back; host initiation
  TBD. `S(S-kar-ptr)`; queued.
- Then paneru: pointer drag is the host macOS journey (no engine
  drag model). `S(S-pan-mouse)`; queued.

### R-DRAG-04 backfill: Esc during a column drag (scrolling)

- Given (columns): `COL[C1[A],C2[B*]]`; VP recorded. Same action:
  start moving B; press Esc; release.
- Observe: source restoration vs drop/persist; no drop plan.
- Then niri: the pointer-grab impl carries no key path
  (motion/button/axis/frame only), so Esc cannot cancel; release
  commits via interactive_move_end. Exact topology TBD (hover/drop
  point unspecified). `S(S-nir-drag)`; queued.
- Then PaperWM: MoveGrab ends on button release only, so Esc cannot
  cancel; release commits via end(). Exact branch TBD. `S(S-pap-grab)`;
  queued.
- Then karousel/Lazy: host KWin move-session cancel untraced in the
  profile source (karousel finish only retiles). Queued.
- Then paneru: pointer drag is the host macOS journey. `S(S-pan-mouse)`;
  queued.

### R-DRAG-05 backfill: zero-move press/release (scrolling)

- Given (columns): `COL[C1[A],C2[B*]]`; VP recorded. Same action:
  press/release the move gesture on B without moving.
- Observe: no mutation or preview residue.
- Then niri: the 8px gesture threshold is never reached, so the tile
  is never removed; release only activates B. Preview TBD.
  `S(S-nir-drag)`; queued.
- Then PaperWM: DnD never begins, so B stays in place; end always
  activates B. `S(S-pap-grab)`.
- Then karousel/Lazy: a started move session untiles immediately even
  without geometry motion; whether the host starts that session on a
  zero-move press/release is TBD. `S(S-kar-ptr)`; queued.
- Then paneru: host click marks held and reshuffles on release;
  topology effect TBD. `S(S-pan-mouse)`; queued.

### R-DRAG-06 backfill: release outside the work area (scrolling)

- Given (columns): `COL[C1[A],C2[B*]]` with a panel/taskbar outside
  the work area; VP recorded. Same action: move B; release over the
  panel.
- Observe: source restoration vs off-area placement; preview cleared.
- Then niri: the grab survives off-output pointer positions and the
  end re-inserts at the last tracked output (no restore path);
  exact placement TBD. `S(S-nir-drag)`; queued.
- Then PaperWM: off-zone release moves the frame out and temporarily
  makes B scratch; animation completion unmakes scratch, so final
  re-admission/restoration remains TBD. `S(S-pap-grab)`; queued.
- Then karousel/Lazy: untile at grab start means no restoration;
  off-area drop frame TBD. `S(S-kar-ptr)`; queued.
- Then paneru: pointer drag is the host macOS journey. `S(S-pan-mouse)`;
  queued.

### R-DRAG-07 backfill: dragged frame vs retained allocation (scrolling)

- Given (columns): `COL[C1[A],C2[B*]]`; VP recorded. Same action:
  Mod+Left client drag B to A's edge; pause before release.
- Observe: native frame follows pointer vs retained allocation with
  preview; final placement unchanged.
- Then niri: the tile is removed and pinned to the cursor during the
  move; zone preview and final placement TBD. `S(S-nir-drag)`; queued.
- Then PaperWM: the clone follows the pointer with DnD zone actors
  as preview; final placement TBD. `S(S-pap-grab)`; queued.
- Then karousel/Lazy: the host frame follows mid-hold while karousel
  untiles at session start (shipped default); release is outside the
  pause fixture. `S(S-kar-ptr)`; queued.
- Then paneru: pointer drag is the host macOS journey. `S(S-pan-mouse)`;
  queued.

### R-DRAG-08 backfill: press focus on an unfocused column (scrolling)

- Given (columns): `COL[C1[A*],C2[B]]`, B unfocused; VP recorded.
  Same action: Mod+Left client press on B; move; release at A's edge.
- Observe: focus changes at press vs drop.
- Then niri: Mod+Left press activates B before the grab; drop-side
  focus TBD. `S(S-nir-drag)`; queued.
- Then PaperWM: grab begin does not focus; the drop end activates;
  press-focus journey TBD (GNOME default untraced at pin).
  `S(S-pap-grab)`; queued.
- Then karousel/Lazy: press focus is the host KWin journey (no
  focus policy in the profile source). Queued.
- Then paneru: FFM focuses B on pointer entry before the press;
  press delivery and drop-side focus TBD. `S(S-pan-mouse)`; queued.
