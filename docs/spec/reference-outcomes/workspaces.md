# Workspace send / follow / return (reference outcomes)

Part of the [outcome matrix index](../reference-outcomes.md). Notation, profiles, evidence legend, and variant hooks live in the index; `S()`/`D()` keys below resolve there. Wide tables moved here unchanged.

## 3. Workspace send / follow / return

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | sway | qtile | awesome | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-WS-01 | WS1 `H[A,B*]`, WS2 `H[C]` | Send B to WS2 | Source collapse, target position, focus | Source collapses to A; target splits C's long edge (C geometry unrecorded), B after C; `SendToWorkspace` leaves focus (falls back to A), `MoveToWorkspace` follows with B; `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-send)` + `S(S-cos-focusfix)` | Follow switches workspace and focuses mover, silent refocuses the source; source collapses via sibling promotion; target anchor is sole C regardless of cursor (only tiled candidate on WS2); splits C's long edge (C geometry unrecorded, so axis TBD), B before/after C TBD (cursor half); `S(S-hyp-movews)` | Source unlinks with sibling promotion; target inserts at WS2 focus C, splitting C's long edge with B second child after C; `--follow` keeps focus on B; exact axis (C geometry unrecorded)/frames TBD; `S(S-bsp-send)` + `S(S-bsp-xfer)` | `move container to workspace` (no-follow, stays on WS1): source collapses to sole A; target C,B with B after focused C; focus stays A; `S(S-i3-movews)` | shiftWin inserts above target focus via insertUp, source view unchanged; `S(S-xmo-shift)` | `move container to workspace` (no-follow, stays on WS1): source collapses to sole A; target C,B with B after focus-inactive C; mover focus restored to source inactive (A); independent `workspace` command switches instead; `S(S-sway-movews)` + `S(S-sway-switch)` | togroup removes B from the source (empty column dropped) and group.add admits it at the target Columns anchor with mover focus; the shipped binding follows via switch_group=True; exact target order/frames TBD; `S(S-qti-group)` + `S(S-qti-add)` + `S(S-qti-remove)` | move_to_tag transfers B with no view switch (no-follow, stays on WS1); source reflows via tile recalc with history refocus (A); target keeps B's retained global-client position (move_to_tag reinserts nothing); exact order/frames TBD; `S(S-awe-tag)` + `S(S-awe-hist)` + `S(S-awe-tile)` | Source collapses; target admits at remembered-leaf/focus-history/root; follow on verified transfer; `D(D-dec-cos)` + step-3 `D(D-dec-ww)` | V-WS-FOLLOW |
| R-WS-02 | WS1 tall case `H[C,V[A,B*]]` or wide case `V[C,H[A,B*]]`; WS2 empty; inner area 2544x1364, gap 8: A becomes 1268x1364 (tall) or 2544x678 (wide) after B leaves | Focus A then B; send B to WS2; select WS1/focus A; select WS2/focus B; send B back to WS1 | Return anchor + side/order + axis, rather than old-slot restoration | Returns at A (target MRU): tall `V[A,B]` stacked, wide `H[A,B]` side-by-side, B after A, no old-slot restore; `SendToWorkspace` stays on WS2 (kept because active, not as trailing empty) with focus none, `MoveToWorkspace` follows to WS1 with B; `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-send)` + `S(S-cos-focusfix)` | No remembered-leaf anchor in source (not MRU/slot restore): the target holds C and A (B's departure leaves both), so the return anchor is C vs A TBD (cursor closest-node; sends carry no focal, and the mover itself is excluded from anchor candidacy); only if A is selected does the given box resolve the axis (tall 1268x1364 portrait so `V`, wide 2544x678 landscape so `H`); order TBD (cursor half); follow switches workspace and focuses mover, silent refocuses the source; `S(S-hyp-movews)` | Return inserts at WS1 focus A (explicit selection), splitting A's long edge with B second child after A: tall `V[A,B]`, wide `H[A,B]`; no old-slot restore (fresh split); `--follow` focuses B; exact frames TBD; `S(S-bsp-xfer)` + `S(S-bsp-insert)` | `move container to workspace` (no-follow both legs, stays on source): B returns into the surviving single-child parent after A (tall `V[A,B]`, wide `H[A,B]`), old-slot coincidence via parent persistence, not MRU fresh-map; return leaves focus on the now-empty WS2; `S(S-i3-movews)` | Return inserts above live WS1 focus A via `insertUp` (target-stack order `[B,A]`, B focused there; source view unchanged, no follow; no old-slot store); Tall is fixed master/stack (no long-edge axis, no MRU/history anchor), so the tall `V`/wide `H` fixture distinction is inapplicable: exact axes/frames TBD; `S(S-xmo-shift)` + `S(S-xmo-layout)` | `move container to workspace` (no-follow both legs, stays on source): B returns into the surviving single-child parent after focus-inactive A (tall `V[A,B]`, wide `H[A,B]`), old-slot coincidence via parent persistence, not MRU fresh-map; axis from the surviving parent layout, not geometry; return leaves focus on the now-empty WS2; `S(S-sway-movews)` + `S(S-sway-cleanup)` | Return is fresh admission at live target focus (insert_position=0), no old-slot restore; Columns has no long-edge axis (in-column vertical stack, width-shared columns), so the tall/wide axis distinction is inapplicable; exact order/frames TBD; `S(S-qti-group)` + `S(S-qti-add)` | Both legs no-follow (move_to_tag never switches view); return keeps B's retained global-client position via move_to_tag (no reinsertion, no old-slot store; tile is stateless recalc); tall/wide long-edge distinction inapplicable (fixed master/stack partition); exact order/frames TBD; `S(S-awe-tag)` + `S(S-awe-tile)` | Remembered A: tall stacked, wide side-by-side; `D(D-place)` synthetic proof, physical feel pending; exact order TBD | V-WS-ANCHOR |
| R-WS-03 | WS1 `H[A,B*]`, trailing empty WS exists | Send B via the trailing-empty shortcut (`0` target) | Reuse existing empty vs create another; focus | Reuses the existing trailing empty (B lands sole; refresh then ensures a fresh trailing empty); `SendToLastWorkspace` leaves focus (falls back to A), `MoveToLastWorkspace` follows with B; numeric `0` is a separate binding (index 9), not the trailing-empty action; `S(S-cos-send)` + `S(S-cos-focusfix)` | Unsupported action parameter here: no trailing-empty shortcut exists in source (workspaces are explicit find-or-create; numeric `0` is an invalid workspace ID, so the `0` target has no valid counterpart); outcome TBD (no built-in equivalent for the trailing-empty parameter); `S(S-hyp-movews)` | Unsupported action parameter here: no trailing-empty shortcut in source (desktops are explicit); outcome TBD (no built-in equivalent); `S(S-bsp-send)` | Unsupported action parameter here: no trailing-empty shortcut in source (`move to workspace number` targets explicit workspaces); outcome TBD (no built-in equivalent for the trailing-empty parameter); `S(S-i3-movews)` | Unsupported action parameter here: no trailing-empty shortcut in source (workspaces explicit; `shiftWin` to a non-member tag is a no-op); outcome TBD (no built-in equivalent for the trailing-empty/`0` parameter); `S(S-xmo-shift)` | Unsupported action parameter here: no trailing-empty shortcut in source (`move to workspace number` targets explicit workspaces, no `0` branch); outcome TBD (no built-in equivalent for the trailing-empty parameter); `S(S-sway-movews)` | Unsupported action parameter here: no trailing-empty shortcut in source (groups are explicit 1-9; an unknown group raises); outcome TBD (no built-in equivalent); `S(S-qti-group)` | Unsupported action parameter here: tags are explicit per-screen (1-9) with explicit view_only, no trailing-empty shortcut or 0 target in source; outcome TBD (no built-in equivalent); `S(S-awe-tag)` | Windows: reuse trailing empty; per-output-local mapping; `D(D-dec-win)` (2026-10-02); KDE mapping TBD | V-WS-FOLLOW |
| R-WS-04 | WS1 `H[A,B*]`; WS2 `H[C,D]` | On WS2 focus D then C; float C to remove the remembered leaf; select WS1/focus B; send B to WS2 | Memory invalidation; surviving D from history vs root; axis/order/follow | Floated C leaves the tiling tree (D sole); MRU search skips C (no tiling node) and matches D, so B admits at surviving D from history (not root), splits D's long edge (D geometry unrecorded), B after D; `SendToWorkspace` leaves focus (falls back to A), `MoveToWorkspace` follows with B; `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-focusfix)` + `S(S-cos-send)` | No remembered-leaf or history anchor in source (floated C simply leaves the tiled set); target anchor is sole D regardless of cursor (only tiled candidate on WS2); splits D's long edge (D geometry unrecorded, so axis TBD), B before/after D TBD (cursor half); `S(S-hyp-movews)` | TBD (no remembered-leaf/history anchor in source; arrival inserts at live WS2 focus, and the split against the floated leaf is unevidenced here); `S(S-bsp-xfer)` | `move container to workspace` (no-follow): floated C sits in the WS2 floating list (floating-target fallback), so the anchor is sole D with B after D; source collapses; focus stays A; `S(S-i3-movews)` | Floated C stays in the stack with focus retained (`float` is a floating-map write only); B arrives via `shiftWin` as `insertUp` above live WS2 focus C (order `[B,C,D]`, B focused there; no floating-leaf split, Tall has no splits); source collapses to A with source view unchanged (no follow); C remains floating; exact frames TBD; `S(S-xmo-shift)` + `S(S-xmo-float)` | `move container to workspace` (no-follow): the workspace destination resolves via focus-inactive tiling only, so floated C never anchors; B lands after sole D; source collapses; focus stays A; `S(S-sway-movews)` | No remembered-leaf/history anchor in source (floated C leaves the layouts for the floating list); B admits at live WS2 focus via the ordinary anchor; exact order TBD (D geometry and live focus unrecorded); `S(S-qti-group)` + `S(S-qti-add)` + `S(S-qti-float)` | No remembered-leaf/history admission anchor in source (tile recalc over live tiled order); floated C leaves the tiled set; B admits via the ordinary path with no view switch; exact order/frames TBD; `S(S-awe-tag)` + `S(S-awe-float)` + `S(S-awe-tile)` | Valid focus-history after invalid remembered leaf, then genuine no-focus root; selected `D(D-dec-x)`; scenario result TBD | V-WS-ANCHOR |
| R-WS-05 | WS1 `H[A,B*]`, WS2 empty | Send B to WS2; select WS2/focus B; float B; request send B back to WS1; select WS1 | Whether floating B can transfer; retained float vs fresh tiled admission; focus | Floating B transfers; fresh tiled admission at A (splits A's long edge, B after A), float not retained; `SendToWorkspace` + select focuses A (WS1 MRU; B admitted unfocused), `MoveToWorkspace` focuses B; `S(S-cos-send)` + `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-focusfix)` | Forward B takes a full-work-area tile box on empty WS2 (sole tiled tile, not maximized mode); floated B transfers retaining float state at monitor-relative position (never fresh-tiled on arrival); the floated return makes no new tiling admission, so no anchor/axis/order applies: sole A stays the unchanged tiled tile; follow/silent focus per `S(S-hyp-movews)`; exact frames TBD; `S(S-hyp-movews)` | Forward B sole on WS2; floated B transfers retaining float (node moves with client state, no fresh tiling; sole A unchanged); `--follow` keeps focus on B; exact frames TBD; `S(S-bsp-xfer)` + `S(S-bsp-float)` | `move container to workspace` (no-follow both legs): forward B sole on WS2; floated B transfers as a floating wrapper to WS1 (float retained, no fresh tiling; sole A unchanged); return stays on the now-empty WS2; `S(S-i3-movews)` | Forward B sole on WS2; floated B transfers retaining float (`shiftWin` uses `delete'` preserving the floating map, no fresh tiling; sole A unchanged); source view unchanged (no follow); exact frames TBD; `S(S-xmo-shift)` + `S(S-xmo-float)` | `move container to workspace` (no-follow both legs): forward B sole on WS2; floated B transfers as floating to WS1 (float retained, no fresh tiling; coordinate fix only on output change, same-output leg performs no rewrite; sole A unchanged); return stays on the now-empty WS2; `S(S-sway-movews)` | Floated B transfers retaining float (removed from the floating list, re-added floating via the float state path, never fresh-tiled; sole A unchanged); the shipped binding follows via switch_group=True; exact frames TBD; `S(S-qti-group)` + `S(S-qti-float)` | Forward B sole on WS2 (single tile expands full width); floated B transfers retaining float (persistent client property, no fresh tiling; sole A unchanged); no view switch either leg; exact frames/focus TBD; `S(S-awe-tag)` + `S(S-awe-float)` | TBD (explicit send applies to focused tiled windows `D(D-dec-cos)`; floated roundtrip untested) | V-FLOAT-GEO |
| R-WS-06 | WS1 tiled `H[A,B*]`; WS2 floating | Send B to WS2; send B back to WS1 | Native membership/follow, source reflow and floating frame preservation vs two-domain plan | Forward B arrives floating reusing its last tiled origin with clamped size (exact frame TBD); source reflows; return is fresh tiled admission at A (B after A); `SendToWorkspace` leaves focus (source-MRU fallback each leg), `MoveToWorkspace` follows with B; `S(S-cos-send)` + `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-focusfix)` | Forward TBD: no workspace floating mode exists in source to map `WS2 floating` onto (arrival dispatch is per-window by the mover's own float state, which this fixture never changes), so no floating arrival is recorded; return anchor is sole A (A geometry unrecorded, so axis TBD), B before/after A TBD (cursor half); exact frames TBD; `S(S-hyp-movews)` | Forward TBD: no workspace floating mode exists in source (float is per-window; desktop layout tiled/monocle only), so the return leg is conditional on an unestablished forward; `S(S-bsp-float)` + `S(S-bsp-layout)` | Forward TBD: no workspace floating mode exists in source to map `WS2 floating` onto (float is per-window); arrival dispatch for that parameter unevidenced, so the return leg is conditional on an unestablished forward; `S(S-i3-movews)` | Forward TBD: no workspace floating mode in source (float is per-window; layout Tall/Mirror/Full plus floating layer only), so the return leg is conditional on an unestablished forward; `S(S-xmo-float)` + `S(S-xmo-layout)` | Forward TBD: no workspace floating mode exists in source to map `WS2 floating` onto (float is per-window; `workspace_layout` default/stacked/tabbed only); arrival dispatch for that parameter unevidenced, so the return leg is conditional on an unestablished forward; `S(S-sway-wsmode)` | Forward TBD: no workspace floating mode exists in source (float is per-window; Columns always tiles plus a floating layer), so a tiled B admits tiled via the ordinary anchor; the return leg is likewise ordinary togroup; exact frames TBD; `S(S-qti-group)` + `S(S-qti-float)` + `S(S-qti-add)` | WS2 floating reads as the shipped floating layout on that tag (layout is per-tag); forward B arrives unarranged (floating arrange no-op, incoming geometry kept); return re-admits via tile partition; no view switch either leg; exact frames/focus TBD; `S(S-awe-tag)` + `S(S-awe-layout)` + `S(S-awe-float)` | KDE: membership-only boundary send, only tiled side reflows `D(D-dec-ww)`; Windows: synthetic/native Paint roundtrip preserves floating frame, reflows source before hide and freshly admits on return [workspace mode record](../../changes/archive/windows-workspace-tiling.md); physical feel TBD | V-WS-FOLLOW |
| R-WS-07 | WS1 `H[A,B*]`, WS2 `H[C*]` currently shown; KDE switcher includes all desktops | Select B in Alt+Tab | B listed vs omitted; switch to WS1 with B membership unchanged vs pull B into WS2 | B listed: the Alt+Tab empty-query search appends every compositor-published toplevel with no workspace/visibility filter; selecting B calls `manager.activate`, and the compositor unminimizes B, switches to WS1 via `shell.activate`, and focuses B with membership unchanged (never pulled into WS2; sticky windows focus in place); `S(S-cos-sysact)` + `S(S-cos-syscmd)` + `S(S-lch-altab)` + `S(S-pop-toplevel)` + `S(S-cos-topact)`; exact switcher visuals/key-repeat timing TBD | TBD (no Alt+Tab switcher/listing source established at this pin; membership/focus effect unevidenced) | TBD (no switcher/listing source at this pin; membership/focus effect unevidenced) | TBD (no Alt+Tab switcher/listing source established at this pin; membership/focus effect unevidenced) | TBD (no Alt+Tab switcher/listing source at this pin; membership/focus effect unevidenced) | TBD (no Alt+Tab switcher/listing source established at this pin; switcher is external, membership/focus effect unevidenced) | TBD (no Alt+Tab switcher/listing in the shipped key inventory at this pin; membership/focus effect unevidenced); `S(S-qti-keys)` | TBD (no Alt+Tab switcher/listing in the shipped key inventory at this pin; jump_to/urgent.jumpto switch-to-tag path unevidenced for switcher listing); `S(S-awe-keys)` + `S(S-awe-tag)` | KDE source: native filter permits B; TabBox activation follows configured policy, default switch to WS1, alternative bring-to-current; exact user-version live outcome TBD. Windows current `SW_HIDE`: B omitted; future inclusion/activation policy TBD. `D(D-alt-tab)` | V-WS-SHELL-ACTIVATE |

## New scenarios (GWT; fixtures/actions/discriminators per the approved expansion record)

Notation, profiles, baselines, legend, and projection rules live in the
index. Each scenario below has exactly one Then bullet per profile (14).
`S()` tags attach only to the established sub-leg; anything else on that
line stays TBD. Column Given bullets are separate fixtures, never H/V
ancestry claims. Ours cells cite Engine + adapter code at `60771bd`
(`S(S-ours-ws)` for workspace mechanics, `S(S-ours-planops)` for the
verb inventory); selected intent and doc assertions are never evidence.

### R-WS-08: back-and-forth workspace twice

- Given (tree profiles): occupied WS1, WS2, WS3; visit WS1, then WS2,
  then WS3 (WS3 shown). Ordinary windows, no rules, shipped defaults
  unless the back-and-forth verb itself needs enabling (named per
  profile; Hyprland `binds:workspace_back_and_forth` defaults off).
- Given (column profiles): same three-workspace visit with
  `COL[C1[A]]`-style single columns per workspace at shipped defaults;
  paneru uses one native Space with virtual rows VW1..VW3. The
  Hyprland Then names its enabling variant explicitly; that variant
  never votes as a shipped-baseline outcome.
- When: invoke the profile's back-and-forth / previous-workspace verb
  twice from fresh switch state (native verbs named per profile below).
  A missing verb is not a no-op.
- Observe: which workspace is shown after each press; last-view toggle
  between two vs MRU-list traversal vs absent verb.
- Then COSMIC: no-counterpart (no history-toggle verb exists; switching
  to the current workspace is a plain re-activate, and `LastWorkspace`
  targets the last index `len-1`, not the last-viewed workspace).
  `S(S-cos-ws)`.
- Then Hyprland/Dwindle: single previous-view toggle once enabled
  (`binds:workspace_back_and_forth=1`): re-invoking switch-to-current
  gives WS2 then WS3. Shipped default 0 only re-activates WS3;
  `=2` restricts the previous lookup to this monitor.
  `S(S-hyp-ws)`.
- Then bspwm: last-view toggle via the `last` desktop selector
  (`desktop -f last`): first press shows WS2, second returns to WS3.
  `S(S-bsp-ws)`.
- Then i3: single previous-name toggle (`workspace back_and_forth`
  shows `previous_workspace_name`, refreshed on every switch): first
  press shows WS2, second returns to WS3. `S(S-i3-ws)`.
- Then xmonad/Tall+Navigation2D: no-counterpart (no back-and-forth or
  previous-workspace verb in the core key inventory; directional verbs
  are Navigation2D only). `S(S-xmo-ctl)`.
- Then sway: single previous-name toggle (`workspace back_and_forth`
  via `prev_workspace_name`, plus the auto variant): first press shows
  WS2, second returns to WS3. `S(S-sway-ws)`.
- Then qtile/Columns: previous-group toggle (`toggle_group()` with no
  name falls back to `previous_group`, saved on every `set_group`):
  first press shows WS2, second returns to WS3. `S(S-qti-ws)`.
- Then awesome/tile: previous-set toggle (`tag.history.restore()`
  defaults to the special `"previous"` index swapping the last two
  selected sets): first press shows WS2, second returns to WS3.
  `S(S-awe-ws)`.
- Then niri: single previous-id toggle (`FocusWorkspacePrevious` /
  `switch_workspace_previous` goes to `previous_workspace_id`, stored
  on every activate): first press shows WS2, second returns to WS3;
  `switch_workspace_auto_back_and_forth` is the same single-toggle
  variant. `S(S-nir-ws)`.
- Then PaperWM: MRU-list traversal with wrap, not a two-state toggle
  (`previous-workspace` steps DOWN an MRU stack and wraps around, so a
  double press keeps walking down the list). `S(S-pap-space)`.
- Then karousel/Lazy: no-counterpart (no desktop-switch or history
  verb in the Actions inventory; desktop switching is KWin-native).
  `S(S-kar-acts)`.
- Then paneru: no-counterpart (no history verb in the `Operation`
  inventory; `Virtual` is directional North/South only).
  `S(S-pan-cmds)`.
- Then Ours KDE: no-counterpart (no select or history verb in the
  Engine + adapter op inventory). `S(S-ours-planops)`.
- Then Ours Windows: no-counterpart (index-only `Select`; no
  previous/history verb). `S(S-ours-planops)`.
- Variant hook: provisional/TBD (history-toggle hook, to discuss).

### R-WS-09: select WS2; select WS1 (return focus and viewport)

- Given (tree profiles): `WS1=H[A,B*]`, `WS2=H[C]`; WS1 history A,B
  (focus A then B before leaving). Ordinary windows, no rules,
  shipped defaults.
- Given (column profiles): `WS1=COL[C1[A],C2[B*]]` each 0.5W with the
  viewport showing both columns; `WS2=COL[C1[C]]`. Paneru:
  `Space1:{VW1=COL[C1[A*]],VW2=COL[C2[B]]}`-style rows are not this
  fixture; use two virtual rows holding A-then-B history on row 1 and C
  on row 2.
- When: select WS2; select WS1 (the profile's native workspace
  switch, named per profile below). No sends and no refocus between
  the switches, unlike R-WS-02.
- Observe: focused window on return (remembered B vs first/master/
  root); column profiles additionally observe the saved viewport.
- Then COSMIC: focuses B (per-workspace MRU focus stack; the valid
  MRU-last target wins, else the first mapped). `S(S-cos-focusfix)`.
- Then Hyprland/Dwindle: pointer-dependent (tiled remembered B is not
  consulted: `getLastFocusedWindow` feeds focus only when floating, else
  the fullscreen cover; `input:follow_mouse=1` pointer-hit wins before
  the focus candidate, and the pointer fixture is unspecified, so B vs
  pointer-hit window stays TBD). Named `input:follow_mouse=0` variant
  focuses B via `getFocusCandidate` (last-focused, else top-left, else
  first). `S(S-hyp-ws)`; pointer-position queued.
- Then bspwm: focuses WS1's remembered `d->focus` (B) via the
  focus/history fallback. `S(S-bsp-ws)`.
- Then i3: focuses the descended remembered focus of WS1 (B).
  `S(S-i3-ws)`.
- Then xmonad/Tall+Navigation2D: each workspace keeps its own Stack
  focus, so `view` back restores WS1 with B focused. `S(S-xmo-ws)`.
- Then sway: focuses the seat focus-inactive node of WS1 (B); empty
  workspaces fall back to the workspace node. `S(S-sway-switch)`.
- Then qtile/Columns: `layout_all` focuses the group's remembered
  `current_window` (B) on the current screen. `S(S-qti-ws)`.
- Then awesome/tile: tag-switch refocus prefers history (B) with a
  sticky fallback. `S(S-awe-hist)`.
- Then niri: focus resolves to the newly active workspace's active
  window (B); each workspace owns its ScrollingSpace, so the saved
  viewport returns too. `S(S-nir-ws)`.
- Then PaperWM: the space retains `selectedWindow` (B), but native
  `workspace.activate` carries no focus target, so the GNOME-side
  restore on return stays TBD. `S(S-pap-space)`; return-focus queued.
- Then karousel/Lazy: mixed (the switch and its focus are
  owner-specific: Plasma performs both while karousel only re-arranges
  and tracks activation with a per-grid `lastFocusedColumn`; whether
  the viewport returns to the saved offset stays TBD). `S(S-kar-ws)`;
  viewport queued.
- Then paneru: refocuses the restored strip's remembered window with
  a restore guard (a never-focused strip falls back to the column
  closest to the display centre); the strip keeps its saved origin.
  `S(S-pan-ws)`.
- Then Ours KDE: mixed (no select verb exists, so the switch journey
  is shell-driven; the Engine keeps per-domain `last_active`, but
  native focus on a shell-driven return stays TBD).
  `S(S-ours-planops)` + `S(S-ours-ws)`; return-focus queued.
- Then Ours Windows: focuses the remembered `last_focus` member (B),
  else the first visible member, via `focus_target` on select.
  `S(S-ours-ws)`.
- Variant hook: provisional/TBD (return-focus hook, to discuss).

### R-WS-10: send B away; empty middle retained vs removed

- Given (tree profiles): occupied WS1, WS2, WS3; shown `WS2=H[B*]`.
  Ordinary windows, no rules, shipped defaults.
- Given (column profiles): `WS2=COL[C1[B*]]` shown; WS1 and WS3
  occupied single-column workspaces (paneru: virtual rows VW1..VW3
  with B alone on VW2).
- When: send B to WS1 (the profile's native send, follow variant
  noted per profile); select WS3.
- Observe: emptied middle workspace retained vs removed/renumbered;
  active-empty protection vs immediate cleanup.
- Then COSMIC: removed (non-active non-last empties are removed while
  a trailing empty is ensured, so the middle collapses out).
  `S(S-cos-send)`.
- Then Hyprland/Dwindle: numbered IDs never renumber, but whether the
  emptied middle object is destroyed vs retained stays TBD
  (persistent-rule ownership untraced). `S(S-hyp-ws)`; destruction
  queued.
- Then bspwm: retained (desktops persist until the explicit
  `desktop -r`; emptiness never auto-removes). `S(S-bsp-ws)`.
- Then i3: removed (the empty non-visible old workspace is closed on
  the switch away). `S(S-i3-ws)`.
- Then xmonad/Tall+Navigation2D: retained (the configured workspace
  list is static; StackSet never removes entries). `S(S-xmo-ws)`.
- Then sway: removed (`workspace_consider_destroy` drops empty
  non-active workspaces). `S(S-sway-ws)`.
- Then qtile/Columns: retained (static groups 1-9; emptiness never
  removes). `S(S-qti-wsdef)`.
- Then awesome/tile: retained (static per-screen tags; only the
  explicit `tag.delete` removes). `S(S-awe-ws)`.
- Then niri: removed (cleanup drops empty non-active workspaces except
  the trailing one, so later indices shift; the
  `empty_workspace_above_first` option changes the kept end).
  `S(S-nir-ws)`.
- Then PaperWM: owner-specific (GNOME owns workspace add/remove;
  PaperWM only mirrors via `workspacesChanged`). `S(S-pap-space)`.
- Then karousel/Lazy: owner-specific (KWin owns desktops; karousel
  only tracks them). `S(S-kar-ws)`.
- Then paneru: retained at shipped defaults (`reap_empty_workspaces`
  defaults off and index 0 is never reaped; enabling it despawns empty
  non-active rows). `S(S-pan-ws)`.
- Then Ours KDE: owner-specific (Plasma owns desktop add/remove; the
  adapter only writes membership). `S(S-ours-ws)`.
- Then Ours Windows: retained (order model has no workspace-removal
  path; close cleanup drops member state only). `S(S-ours-ws)`.
- Variant hook: provisional/TBD (empty-workspace lifecycle hook).

### R-WS-11: next workspace; previous workspace

- Given (all profiles): occupied WS1, WS2, WS3 with WS3 shown; other
  outputs absent. Trailing inventory is profile-native and part of the
  fixture: COSMIC and niri keep a trailing empty workspace, qtile and
  awesome carry static 1-9 inventories (4-9 empty); bspwm/i3/sway hold
  exactly WS1..WS3. Shipped defaults (COSMIC `workspace_wraparound`
  defaults true; qtile skip options default off).
- Given (column profiles): same three workspaces as single-column
  strips; paneru uses virtual rows VW1..VW3 in one Space.
- Given (edge leg, fresh reset per profile): the faithful native last
  inventory (COSMIC/niri trailing-last workspace; qtile group 9;
  awesome tag 9; bspwm/i3/sway last list entry) shown, then next;
  plus the first entry shown, then previous. bspwm/i3/sway have no
  trailing inventory, so their primary leg already is the edge.
- When: primary leg next from WS3, then previous back (the profile's
  native relative switch, named per profile); edge leg per the Given
  above. Hyprland's `e+1`/`e-1` ordered-index variant is independent
  and never substituted for plain next/previous.
- Observe: primary landing (existing empty vs wrap vs create) and the
  return; edge wrap vs stop/clamp/create. Wrap consensus is scored on
  the edge leg only, never on the mid-inventory primary.
- Then COSMIC: primary next lands on the existing trailing empty WS4,
  previous returns to WS3; edge wraps at the shipped default (last next
  goes to WS1, first previous to the last), else stays with output
  fallback. `S(S-cos-ws)`.
- Then Hyprland/Dwindle: plain next goes to numeric+1 (WS4 via
  find-or-create) and plain previous goes to the MRU-history previous
  (back to WS3 here); no wrap on either verb at any index.
  `S(S-hyp-ws)`.
- Then bspwm: wraps with no trailing stop (`CYCLE_DIR` next/prev walk
  the circular desktop list, so WS3 next goes to WS1 and previous
  returns to WS3; primary and edge coincide). `S(S-bsp-ws)`.
- Then i3: wraps with no trailing stop (`workspace next`/`prev` fall
  back to the first/last workspace, so WS3 next goes to WS1 and
  previous returns to WS3; primary and edge coincide). `S(S-i3-ws)`.
- Then xmonad/Tall+Navigation2D: no-counterpart (no relative-
  workspace verb in the core key inventory). `S(S-xmo-ctl)`.
- Then sway: wraps with no trailing stop (same first/last fallback,
  WS3 next goes to WS1 and previous returns to WS3; primary and edge
  coincide). `S(S-sway-ws)`.
- Then qtile/Columns: primary next lands on existing group 4 and
  previous returns to group 3; edge wraps modulo the static list
  (group 9 next goes to group 1). `S(S-qti-ws)`.
- Then awesome/tile: primary next lands on existing tag 4 and
  previous returns to tag 3; edge wraps with cycling (tag 9 next goes
  to tag 1). `S(S-awe-ws)`.
- Then niri: primary next lands on the existing trailing empty WS4
  and previous returns to WS3; edge stops at both ends (up saturates
  at 0, down clamps at the last index; gesture DnD clamps the same
  way). `S(S-nir-ws)`.
- Then PaperWM: primary next lands on the adjacent existing space when
  present, else stays at the actual last; edge stops at the actual
  first/last (out-of-range sequence steps return; the looping variants
  are column-level, not workspace). `S(S-pap-space)`.
- Then karousel/Lazy: no-counterpart (no desktop-switch verb in the
  Actions inventory). `S(S-kar-acts)`.
- Then paneru: South steps or auto-creates at the last row (VW3 South
  creates VW4 when the strip is non-empty and `create_workspace_automatically`
  is on, shipped default off, else stays; North from a created VW4 returns
  to VW3) while North saturates at the first row; never a cyclic wrap.
  `S(S-pan-ws)`.
- Then Ours KDE: no-counterpart (no select/next/previous verb in the
  Engine + adapter op inventory). `S(S-ours-planops)`.
- Then Ours Windows: no-counterpart (index-only `Select`; no
  next/previous verb). `S(S-ours-planops)`.
- Variant hook: provisional/TBD (relative-switch hook, to discuss).

### R-WS-12: move whole WS2 to R

- Given (all profiles): L shows WS1; occupied WS2 belongs to L but is
  hidden; R shows WS3. Ordinary windows, no rules, shipped defaults.
  The hidden baseline is kept everywhere: no profile may pre-select
  WS2 to satisfy an active-only verb. Active-only verbs therefore get
  an evidenced no-counterpart on the fixture plus one independent
  explicitly-selected active leg each.
- Given (column profiles): same output/workspace assignment with
  single-column strips; karousel has no second output in its
  single-screen profile, so its Then is a fixture qualification;
  paneru's native Space and virtual rows are separate domains.
- When: move the whole WS2 to R (the profile's native
  workspace-to-output verb, named per profile below). Window-only
  sends never substitute.
- Observe: whole-workspace reassignment vs view switch or window-only
  transfer; displaced destination view; focus.
- Then COSMIC: mixed (the fixture verb `MigrateWorkspaceToOutput`
  moves the active workspace only, so the hidden WS2 has
  no-counterpart on this fixture; an independent leg with WS2
  explicitly selected migrates, activates, and switches output, while
  the displaced-view remainder stays TBD). `S(S-cos-ws)`;
  displaced-view queued.
- Then Hyprland/Dwindle: whole-workspace reassignment via
  `moveToMonitor`; displaced destination view and focus stay TBD.
  `S(S-hyp-ws)`; displaced-view queued.
- Then bspwm: whole-desktop reassignment via `desktop -m MONITOR`
  (`--follow` keeps the desktop focused); the displaced source view
  stays TBD. `S(S-bsp-ws)`; displaced-view queued.
- Then i3: whole-workspace detach/attach via the matched-window form
  `[workspace="^WS2$"] move workspace to output R` (criteria targeting
  iterates matched windows' workspaces; the bare
  current-workspace invocation never substitutes); the emptied source
  shows its next focus-stack entry, created if last; destination focus
  when the source was hidden stays TBD. `S(S-i3-ws)`;
  hidden-source focus queued.
- Then xmonad/Tall+Navigation2D: no-counterpart on the ownership
  fixture (no workspace-ownership move verb exists); independently,
  `greedyView` reassigns display/view with a hidden swap, never an
  ownership vote. `S(S-xmo-ws)`.
- Then sway: mixed (the fixture verb `move workspace to output` acts on
  the handler-context active workspace only, so the hidden WS2 has
  no-counterpart on this fixture; an independent leg with WS2
  explicitly selected detaches/attaches with source refill, while the
  displaced-view/focus remainder stays TBD). `S(S-sway-ws)`;
  displaced-view queued.
- Then qtile/Columns: shared group/view-ownership reassignment via
  `toscreen` on R (a swap runs only when the group already had a
  screen; WS3 is unscreened and hidden; this is view ownership, not a
  container-tree move, and is labeled as such); focus stays TBD.
  `S(S-qti-ws)`; focus queued.
- Then awesome/tile: shared tag/view-ownership reassignment via
  `tag.screen` (all member clients move; the old screen restores from
  history; labeled as view ownership, not a tree move); destination
  view and focus stay TBD. `S(S-awe-ws)`; destination queued.
- Then niri: whole-workspace reassignment via
  `MoveWorkspaceToMonitorByRef` (explicit output-plus-reference
  resolves the hidden WS2; hidden move inserts after R's active entry
  with no activation, so displaced WS3 stays shown; the active-workspace
  variant activates the target). `S(S-nir-ws)`.
- Then PaperWM: whole-space reassignment choreography via
  `move-space-monitor` (swap fallback when it is the monitor's last
  space); hidden-workspace applicability stays TBD. `S(S-pap-space)`;
  hidden-applicability queued.
- Then karousel/Lazy: fixture-inapplicable (single-screen profile has
  no second output to receive WS2). `S(S-kar-base)`.
- Then paneru: no-counterpart (`ToNextDisplay` moves the focused
  window only, never a whole strip or Space). `S(S-pan-cmds)`.
- Then Ours KDE: no-counterpart (same-output explicit sends only;
  cross-output targets refuse). `S(S-ours-ws)`.
- Then Ours Windows: no-counterpart (index `Select`/`Send` only; no
  whole-workspace verb). `S(S-ours-planops)`.
- Variant hook: provisional/TBD (workspace-output hook, to discuss).

### R-WS-13: select absent WS9

- Given (all profiles): WS1 occupied; the target name/ordinal WS9 is
  absent (qtile/awesome carry a fixture difference noted below:
  their shipped static 1-9 inventories cannot construct an absent
  WS9). Shipped defaults.
- Given (column profiles): same single-workspace start as strips;
  paneru holds one Space with a single virtual row.
- When: select WS9 (the profile's native select by index/name).
- Observe: create/select vs refusal/no-op; static inventories vs
  dynamic creation. Never infer from a send.
- Then COSMIC: refuses (activate with idx past the end returns
  `InvalidWorkspaceIndex`; no creation path). `S(S-cos-ws)`.
- Then Hyprland/Dwindle: creates and selects (the switch path runs
  find-or-create). `S(S-hyp-ws)`.
- Then bspwm: refuses (an absent selector fails instead of creating).
  `S(S-bsp-ws)`.
- Then i3: creates and selects (`workspace_get` creates on demand).
  `S(S-i3-ws)`.
- Then xmonad/Tall+Navigation2D: no-op (`view` of a non-member tag
  returns the stackset unchanged). `S(S-xmo-ws)`.
- Then sway: creates and selects (the switch path creates on demand).
  `S(S-sway-ws)`.
- Then qtile/Columns: fixture-inapplicable (shipped static groups 1-9
  already contain 9, so an absent WS9 cannot be constructed).
  `S(S-qti-wsdef)`.
- Then awesome/tile: fixture-inapplicable (shipped static tags 1-9
  already contain tag 9, so an absent WS9 cannot be constructed; no
  creation path exists). `S(S-awe-ws)`.
- Then niri: clamps to the last workspace (no creation path).
  `S(S-nir-ws)`.
- Then PaperWM: owner-specific (GNOME dynamic-workspace policy owns
  creation; PaperWM only mirrors). `S(S-pap-space)`.
- Then karousel/Lazy: owner-specific (KWin owns desktops; no select
  verb exists). `S(S-kar-acts)`.
- Then paneru: creates and selects (`VirtualNumber` spawns the absent
  strip and switches to it). `S(S-pan-ws)`.
- Then Ours KDE: no-counterpart (no select verb exists in the Engine
  + adapter op inventory, so the select journey is shell-driven).
  `S(S-ours-planops)`.
- Then Ours Windows: refuses (`unknown-target`: the index resolves
  against the existing order only). `S(S-ours-ws)`.
- Variant hook: provisional/TBD (absent-select hook, to discuss).

### R-WS-14: send B to next; fresh run send B to previous

- Given (tree profiles): occupied WS1..WS3 with `WS2=H[A,B*]` shown.
  Ordinary windows, no rules, shipped defaults. Two legs from fresh
  fixtures with a reset between: leg 1 send B to the next workspace,
  leg 2 send B to the previous workspace. Edge wrap is a later
  qualified leg of R-WS-11, never combined here.
- Given (column profiles): `WS2=COL[C1[A],C2[B*]]` shown with the
  viewport on both columns; paneru uses an active strip holding
  columns A and focused B.
- When: the profile's native relative-send verb per leg (named per
  profile below); explicit-only inventories never substitute an
  absolute send.
- Observe: relative target resolution and follow policy.
- Then COSMIC: resolves to active plus/minus one (next cycles to
  index 0 and previous to the last with wraparound, else output
  fallback); `MoveTo` follows with B, `SendTo` leaves focus.
  `S(S-cos-ws)`.
- Then Hyprland/Dwindle: plain `next` targets WS3; plain `previous`
  targets the MRU previous workspace, not necessarily WS1. Follow
  focuses B; silent refocuses the source. `S(S-hyp-movews)` +
  `S(S-hyp-ws)`.
- Then bspwm: `node -d next`/`prev` resolves the relative desktop
  (`--follow` keeps focus on B). `S(S-bsp-ws)`.
- Then i3: `move to workspace next`/`prev` resolves through the same
  no-follow path (focus restored to the source). `S(S-i3-movews)` +
  `S(S-i3-ws)`.
- Then xmonad/Tall+Navigation2D: no-counterpart (relative shift
  needs CycleWS, outside the core+Navigation2D profile).
  `S(S-xmo-ctl)`.
- Then sway: `move to workspace next`/`prev` resolves through the
  same no-follow path (mover focus restored to the source inactive).
  `S(S-sway-movews)` + `S(S-sway-ws)`.
- Then qtile/Columns: no-counterpart (`togroup` takes explicit group
  names only; next/previous are view verbs that transfer nothing).
  `S(S-qti-ws)`.
- Then awesome/tile: TBD (move_to_tag is explicit; no relative-send
  verb established in the traced inventory; directional swap is
  same-screen only). Queued.
- Then niri: resolves to the adjacent index with clamping at both
  ends (same-index is a no-op, never a wrap); Smart follow activates
  the target when the mover was active. `S(S-nir-ws)`.
- Then PaperWM: resolves to the adjacent space with take-window and
  stops at the ends; take/follow/insert completion stays TBD.
  `S(S-pap-space)`; completion queued.
- Then karousel/Lazy: resolves to the adjacent desktop with an edge
  stop and moves the whole column C2 (appended after the target's
  last column); follow stays TBD. `S(S-kar-ws)`; follow queued.
- Then paneru: South moves with the len-greater-than-one gate and
  North stops at index 0, each carrying the `MoveFocus`
  Follow/Stay policy. `S(S-pan-ws)`.
- Then Ours KDE: no-counterpart (explicit-target sends only; no
  relative verb). `S(S-ours-planops)`.
- Then Ours Windows: no-counterpart (index-only `Send`; no relative
  verb). `S(S-ours-planops)`.
- Variant hook: V-WS-FOLLOW (follow policy for relative sends).

## Scrolling backfill (additive; existing wide tables above unchanged)

### R-WS-06 backfill: send to a floating workspace (scrolling)

- Given (columns): attempted mapping is WS1 with `COL[C1[A],C2[B*]]` at
  shipped defaults plus a `WS2 floating` target. No scrolling profile has
  a workspace-wide floating mode, so the target parameter has no faithful
  start; the Thens below are applicability qualifications, never an
  ordinary transfer with a substituted target. No send/return journey runs
  on an impossible target.
- Observe: whether the `WS2 floating` target exists natively.
- Then niri: fixture-inapplicable (no workspace floating mode exists to
  construct WS2 with; `ToggleWindowFloating` is per-window only and
  `floating_is_active` derives from admission/focus, not a mode).
  `S(S-nir-float)`.
- Then PaperWM: fixture-inapplicable (no floating workspace mode and no
  workspace toggle in the registered action inventory). `S(S-pap-acts)`.
- Then karousel/Lazy: fixture-inapplicable (float is per-window only; no
  floating desktop mode). `S(S-kar-acts)`.
- Then paneru: fixture-inapplicable (no floating workspace mode; `Manage`
  is per-window and the tier flip is focus-only). `S(S-pan-cmds)`.

### R-WS-01 backfill: send to another workspace (scrolling)

- Given (columns): `WS1=COL[C1[A],C2[B*]]`, `WS2=COL[C1[C]]`, each
  0.5W at shipped defaults. Paneru uses one Space with two virtual
  rows (A/B-active row, C row).
- When: send B to WS2 (the profile's native workspace send).
- Observe: source collapse, target column position, focus
  (follow vs stay).
- Then niri: B transfers to the target workspace as a new column after
  C (the sole target column is active); `move-window-to-workspace`
  with `focus=true` (shipped default) follows with B via Smart
  activation, `focus=false` stays on the source. `S(S-nir-ws)`.
- Then PaperWM: B moves and re-inserts after C at the open position,
  and inserts landing on an inactive space never steal focus (the
  source collapses to sole A). `S(S-pap-ins)`.
- Then karousel/Lazy: the column moves grids and appends after the
  target's last column (after sole C); focus stays TBD. `S(S-kar-ws)`;
  focus queued.
- Then paneru: `VirtualMoveNumber` carries the focused window to the
  indexed row under the `MoveFocus` Follow/Stay policy; target column
  position stays TBD. `S(S-pan-ws)`; target position queued.

### R-WS-02 backfill: send back and return anchor (scrolling)

- Given (columns): the original `H[C,V[A,B]]` ancestry has no exact
  column counterpart, so that ancestry is fixture-inapplicable; the
  model-qualified rerun below reproduces the predicate with the same
  explicit preparation. `WS1=COL[C1[C],C2[A],C3[B*]]`, WS2 empty.
  Focus A then B (WS1 history A,B); send B to WS2; select WS1 and
  focus A; select WS2 and focus B; send B back to WS1. No step is
  omitted and C is never dropped from the fixture.
- When: both selections and both sends run through the profile's
  native verbs.
- Observe: return anchor and order, focus, viewport.
- Then niri: B re-admits after the explicitly focused A with Smart
  follow; viewport stays TBD. `S(S-nir-ins)` + `S(S-nir-ws)`;
  viewport queued.
- Then PaperWM: B re-inserts after the explicitly focused A at the open
  position (selected+1 RIGHT at the shipped default); focus and viewport
  stay TBD. `S(S-pap-ins)`; focus/viewport queued.
- Then karousel/Lazy: B's column re-admits after the explicitly focused
  A (last-focused, else last); KWin-side focus and viewport stay TBD.
  `S(S-kar-ins)`; focus/viewport queued.
- Then paneru: B re-inserts at the remembered strip index for A, else
  the config insertion index, overlap, or end; focus stays TBD.
  `S(S-pan-ins)`; focus queued.

### R-WS-03 backfill: trailing-empty shortcut (scrolling)

- Given (columns): `COL[C1[A],C2[B*]]` with a trailing empty
  workspace/strip present; the action names the trailing-empty
  shortcut (`0` target).
- When: send B via the trailing-empty parameter.
- Observe: reuse of the existing empty vs another creation; focus.
- Then niri: no-counterpart (no trailing-empty shortcut exists;
  indices address existing workspaces only and cleanup keeps the
  last). `S(S-nir-acts)`.
- Then PaperWM: no-counterpart (no trailing-empty shortcut in the
  registered action inventory). `S(S-pap-acts)`.
- Then karousel/Lazy: owner-specific (desktops are KWin-native and
  no shortcut verb exists). `S(S-kar-acts)`.
- Then paneru: no-counterpart (no trailing concept exists; explicit
  `VirtualAdd` creates instead). `S(S-pan-cmds)`.

### R-WS-04 backfill: memory invalidation (scrolling)

- Given (columns): `WS1=COL[C1[A],C2[B*]]`, `WS2=COL[C1[C],C2[D]]`.
  On WS2 focus D then C (history D,C); float C to remove the
  remembered leaf; select WS1 and focus B; then send B to WS2.
  No step is reordered: C is floated only after holding focus.
- When: the float removal runs first, then the native send.
- Observe: surviving anchor for B (history vs sole candidate), float
  exit, target position.
- Then niri: floated C leaves the strip (floating state is
  per-workspace), and B admits through the ordinary column path with
  no leaf memory to invalidate; exact anchor stays TBD.
  `S(S-nir-ws)`; anchor queued.
- Then PaperWM: anchoring is open-position index only, so no
  remembered-leaf memory exists to invalidate; the float path stays
  TBD. `S(S-pap-ins)`; float leg queued.
- Then karousel/Lazy: B's column admits after the last-focused (else
  last) column with `lastFocusedColumn` fixup on removal; the float
  leg stays TBD. `S(S-kar-ins)` + `S(S-kar-ws)`; float leg queued.
- Then paneru: B admits at the insertion-index/overlap/end policy
  with no remembered-leaf anchor; the unmanaged-float leg stays TBD.
  `S(S-pan-ins)`; float leg queued.

### R-WS-05 backfill: floating transfer (scrolling)

- Given (columns): `WS1=COL[C1[A],C2[B*]]`, WS2 empty; send B to WS2,
  float B there, then request B back on WS1.
- When: both transfers run through the profile's native send verb.
- Observe: whether the floating B transfers; retained float vs fresh
  admission; focus.
- Then niri: B transfers with its floating state carried through the
  remove/add path (never fresh-tiled on arrival) and sole A is
  unchanged; `focus=true` (default) follows with B, `focus=false`
  stays. `S(S-nir-ws)`.
- Then PaperWM: TBD (float cross-space path untraced; floats are
  GNOME-native). Queued.
- Then karousel/Lazy: TBD (the sourced per-column tiled transfer does
  not prove the whole float journey; unmanaged float transfer
  untraced). Queued.
- Then paneru: TBD (unmanaged cross-row path untraced). Queued.

### R-WS-07 backfill: shell switcher listing (scrolling)

- Given (columns): `WS1=COL[C1[A],C2[B*]]`, `WS2=COL[C1[C*]]` shown.
  Use niri's default All MRU scope; Workspace-only is a separate variant.
- When: select B in the profile's window switcher.
- Observe: B listed vs omitted; switch to WS1 with membership
  unchanged vs pull into WS2.
- Then niri: B is listed in the default All scope (the MRU UI collects
  every workspace's windows); activation
  switch/focus stays TBD. `S(S-nir-ws)`; activation queued.
- Then PaperWM: owner-specific (the GNOME switcher owns listing and
  activation; no switcher verb in the PaperWM inventory).
  `S(S-pap-acts)`.
- Then karousel/Lazy: owner-specific (the KWin switcher owns listing
  and activation; no switcher verb in the Actions inventory).
  `S(S-kar-acts)`.
- Then paneru: owner-specific (the macOS switcher owns listing and
  activation; no switcher op exists). `S(S-pan-cmds)`.
