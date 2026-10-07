# Workspace send / follow / return (reference outcomes)

Part of the [outcome matrix index](../reference-outcomes.md). Notation, profiles, evidence legend, and variant hooks live in the index; `S()`/`D()` keys below resolve there. Scenarios below are GWT with one Then bullet per profile (14).

## 3. Workspace send / follow / return

<a id="scrolling-backfill-additive-existing-wide-tables-above-unchanged"></a>
<a id="r-ws-01-backfill-send-to-another-workspace-scrolling"></a>
### R-WS-01: send to another workspace

- Given (tree profiles): WS1 `H[A,B*]`, WS2 `H[C]`

- Given (column profiles): `WS1=COL[C1[A],C2[B*]]`, `WS2=COL[C1[C]]`, each
  0.5W at shipped defaults. Paneru uses one Space with two virtual
  rows (A/B-active row, C row).

- When: Move/send B to WS2 with the profile's shipped-default binding. From fresh fixtures, replay the alternate stay/follow verb, flag or composition where established; do not assume the default follows.

- When (column leg): move/send B to WS2 with the profile's shipped-default workspace-transfer binding; replay the established alternate from a fresh fixture. Record column vs window granularity and finish any navigator/drop journey before observing focus.

- Observe: Source collapse, target position, focus

- Observe (column leg): source collapse, target column position, focus
  (follow vs stay).

- Then COSMIC: Shipped `MoveToWorkspace` (Super+Shift+1..9) follows with B: source collapses to A; target splits C's long edge (C geometry unrecorded), B after C; alternate `SendToWorkspace` (unbound at shipped defaults) leaves focus (falls back to A); `S(S-cos-wskeys)` + `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-send)` + `S(S-cos-focusfix)`
- Then Hyprland/Dwindle: Shipped `hl.dsp.window.move({workspace=i})` (mainMod+Shift+n, follow absent so silent is false) follows: switches workspace and focuses mover; alternate `follow=false` stays (silent refocuses the source); source collapses via sibling promotion; target anchor is sole C regardless of cursor (only tiled candidate on WS2); splits C's long edge (C geometry unrecorded, so axis TBD), B before/after C TBD (cursor half); `S(S-hyp-wskeys)` + `S(S-hyp-movews)`
- Then bspwm: Shipped `node -d '^{1-9,10}'` (super+shift+n, no `--follow`) stays on the source; alternate `--follow` keeps focus on B; source unlinks with sibling promotion; target inserts at WS2 focus C, splitting C's long edge with B second child after C; exact axis (C geometry unrecorded)/frames TBD; `S(S-bsp-wskeys)` + `S(S-bsp-send)` + `S(S-bsp-xfer)`
- Then i3: Shipped `move container to workspace number N` (Mod1+Shift+n, no-follow, stays on WS1): source collapses to sole A; target C,B with B after focused C; focus stays A; alternate independent `workspace` command switches instead; `S(S-i3-wskeys)` + `S(S-i3-movews)`
- Then xmonad/Tall+Navigation2D: Shipped mod-shift-[1..9] `W.shift` stays (source view unchanged): shiftWin inserts above target focus via insertUp; alternate composition `W.greedyView . W.shift` views after the shift; `S(S-xmo-wskeys)` + `S(S-xmo-shift)`
- Then sway: Shipped `move container to workspace number N` ($mod+Shift+n, no-follow, stays on WS1): source collapses to sole A; target C,B with B after focus-inactive C; mover focus restored to source inactive (A); alternate independent `workspace` command switches instead; `S(S-sway-wskeys)` + `S(S-sway-movews)` + `S(S-sway-switch)`
- Then qtile/Columns: Shipped `togroup(i.name, switch_group=True)` (mod+shift+n) follows with mover focus: togroup removes B from the source (empty column dropped) and group.add admits it at the target Columns anchor; alternate `switch_group=False` stays; exact target order/frames TBD; `S(S-qti-wskeys)` + `S(S-qti-group)` + `S(S-qti-add)` + `S(S-qti-remove)`
- Then awesome/tile: Shipped mod+Shift+numrow `move_to_tag` stays (no view switch): source reflows via tile recalc with history refocus (A); target keeps B's retained global-client position (move_to_tag reinserts nothing); alternate `tag:view_only()` after the move switches; exact order/frames TBD; `S(S-awe-keys)` + `S(S-awe-tag)` + `S(S-awe-hist)` + `S(S-awe-tile)`
- Then niri: Shipped `move-column-to-workspace N` (Mod+Ctrl+N,
  column granularity) with `focus=true` (default) follows with B via
  Smart activation; alternate `focus=false` stays. B transfers to the
  target workspace as a new column after C (the sole target column is
  active). `S(S-nir-wskeys)` + `S(S-nir-ws)`.
- Then PaperWM: Shipped `move-down/up-workspace` (Super+Ctrl+PageDown/Up)
  and `take-window` (Super+t) follow: drop into the selected space
  plus `Main.activateWindow` (tiling.js:5528-5555 at 8bf6dd2);
  fresh-insertion no-steal on inactive spaces (`S-pap-ins`) is a
  different journey, not the shipped-send outcome; send-and-stay
  alternate TBD. `S(S-pap-take)` + `S(S-pap-ins)`.
- Then karousel/Lazy: the column moves grids and appends after the
  target's last column (after sole C); focus stays TBD. `S(S-kar-ws)`;
  focus queued.
- Then paneru: `VirtualMoveNumber` carries the focused window to the
  indexed row under the `MoveFocus` Follow/Stay policy; target column
  position stays TBD. `S(S-pan-ws)`; target position queued.
- Then Ours KDE: source collapses; target admits at remembered-leaf/focus-history/root
  identically for follow/stay. Numbered follow defaults unchanged; explicit
  stay is registered unbound, preserves source selection and applies source
  focused-removal MRU (A here). Floating boundaries transfer membership only,
  default follows and explicit stay preserves source view/native boundary focus.
  Item 2 implemented offline, native journey pending.
  [Core/protocol](../../../crates/tiler-core/tests/session_send_to_workspace.rs),
  [adapter fixtures](../../../kwin/tests/workspace-send-follow-stay.test.ts),
  [record](../../changes/archive/kde-workspace-send-follow-stay.md);
  `D(D-dec-cos)` + step-3 `D(D-dec-ww)`.
- Then Ours Windows: Source collapses; target admits at remembered-leaf/focus-history/root; follow on verified transfer; `D(D-dec-cos)` + step-3 `D(D-dec-ww)`
- Variant hook: V-WS-FOLLOW.

<a id="r-ws-02-backfill-send-back-and-return-anchor-scrolling"></a>
### R-WS-02: send back and return anchor

- Given (tree profiles): WS1 tall case `H[C,V[A,B*]]` or wide case `V[C,H[A,B*]]`; WS2 empty; inner area 2544x1364, gap 8: A becomes 1268x1364 (tall) or 2544x678 (wide) after B leaves

- Given (column profiles): the original `H[C,V[A,B]]` ancestry has no exact
  column counterpart, so that ancestry is fixture-inapplicable; the
  model-qualified rerun below reproduces the predicate with the same
  explicit preparation. `WS1=COL[C1[C],C2[A],C3[B*]]`, WS2 empty.
  Focus A then B (WS1 history A,B); send B to WS2; select WS1 and
  focus A; select WS2 and focus B; send B back to WS1. No step is
  omitted and C is never dropped from the fixture.

- When: Focus A then B; send B to WS2; select WS1/focus A; select WS2/focus B; send B back to WS1

- When (column leg): both selections and both sends run through the profile's
  native verbs.

- Observe: Return anchor + side/order + axis, rather than old-slot restoration

- Observe (column leg): return anchor and order, focus, viewport.

- Then COSMIC: Returns at A (target MRU): tall `V[A,B]` stacked, wide `H[A,B]` side-by-side, B after A, no old-slot restore; `SendToWorkspace` stays on WS2 (kept because active, not as trailing empty) with focus none, `MoveToWorkspace` follows to WS1 with B; `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-send)` + `S(S-cos-focusfix)`
- Then Hyprland/Dwindle: No remembered-leaf anchor in source (not MRU/slot restore): the target holds C and A (B's departure leaves both), so the return anchor is C vs A TBD (cursor closest-node; sends carry no focal, and the mover itself is excluded from anchor candidacy); only if A is selected does the given box resolve the axis (tall 1268x1364 portrait so `V`, wide 2544x678 landscape so `H`); order TBD (cursor half); follow switches workspace and focuses mover, silent refocuses the source; `S(S-hyp-movews)`
- Then bspwm: Return inserts at WS1 focus A (explicit selection), splitting A's long edge with B second child after A: tall `V[A,B]`, wide `H[A,B]`; no old-slot restore (fresh split); shipped `node -d` without `--follow` stays on the source, `--follow` focuses B; exact frames TBD; `S(S-bsp-xfer)` + `S(S-bsp-insert)`
- Then i3: `move container to workspace` (no-follow both legs, stays on source): B returns into the surviving single-child parent after A (tall `V[A,B]`, wide `H[A,B]`), old-slot coincidence via parent persistence, not MRU fresh-map; return leaves focus on the now-empty WS2; `S(S-i3-movews)`
- Then xmonad/Tall+Navigation2D: Return inserts above live WS1 focus A via `insertUp` (target-stack order `[B,A]`, B focused there; source view unchanged, no follow; no old-slot store); Tall is fixed master/stack (no long-edge axis, no MRU/history anchor), so the tall `V`/wide `H` fixture distinction is inapplicable: exact axes/frames TBD; `S(S-xmo-shift)` + `S(S-xmo-layout)`
- Then sway: `move container to workspace` (no-follow both legs, stays on source): B returns into the surviving single-child parent after focus-inactive A (tall `V[A,B]`, wide `H[A,B]`), old-slot coincidence via parent persistence, not MRU fresh-map; axis from the surviving parent layout, not geometry; return leaves focus on the now-empty WS2; `S(S-sway-movews)` + `S(S-sway-cleanup)`
- Then qtile/Columns: Return is fresh admission at live target focus (insert_position=0), no old-slot restore; Columns has no long-edge axis (in-column vertical stack, width-shared columns), so the tall/wide axis distinction is inapplicable; exact order/frames TBD; `S(S-qti-group)` + `S(S-qti-add)`
- Then awesome/tile: Both legs no-follow (move_to_tag never switches view); return keeps B's retained global-client position via move_to_tag (no reinsertion, no old-slot store; tile is stateless recalc); tall/wide long-edge distinction inapplicable (fixed master/stack partition); exact order/frames TBD; `S(S-awe-tag)` + `S(S-awe-tile)`
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
- Then Ours KDE: Remembered A: tall stacked, wide side-by-side; `D(D-place)` synthetic proof, physical feel pending; exact order TBD
- Then Ours Windows: Remembered A: tall stacked, wide side-by-side; `D(D-place)` synthetic proof, physical feel pending; exact order TBD
- Variant hook: V-WS-ANCHOR.

<a id="r-ws-03-backfill-trailing-empty-shortcut-scrolling"></a>
### R-WS-03: trailing-empty shortcut

- Given (tree profiles): WS1 `H[A,B*]`, trailing empty WS exists

- Given (column profiles): `COL[C1[A],C2[B*]]` with a trailing empty
  workspace/strip present; the action names the trailing-empty
  shortcut (`0` target).

- When: Send B via the trailing-empty shortcut (`0` target)

- When (column leg): send B via the trailing-empty parameter.

- Observe: Reuse existing empty vs create another; focus

- Observe (column leg): reuse of the existing empty vs another creation; focus.

- Then COSMIC: Reuses the existing trailing empty (B lands sole; refresh then ensures a fresh trailing empty); `SendToLastWorkspace` leaves focus (falls back to A), `MoveToLastWorkspace` follows with B; numeric `0` is a separate binding (index 9), not the trailing-empty action; `S(S-cos-send)` + `S(S-cos-focusfix)`
- Then Hyprland/Dwindle: Unsupported action parameter here: no trailing-empty shortcut exists in source (workspaces are explicit find-or-create; numeric `0` is an invalid workspace ID, so the `0` target has no valid counterpart); outcome TBD (no built-in equivalent for the trailing-empty parameter); `S(S-hyp-movews)`
- Then bspwm: Unsupported action parameter here: no trailing-empty shortcut in source (desktops are explicit); outcome TBD (no built-in equivalent); `S(S-bsp-send)`
- Then i3: Unsupported action parameter here: no trailing-empty shortcut in source (`move to workspace number` targets explicit workspaces); outcome TBD (no built-in equivalent for the trailing-empty parameter); `S(S-i3-movews)`
- Then xmonad/Tall+Navigation2D: Unsupported action parameter here: no trailing-empty shortcut in source (workspaces explicit; `shiftWin` to a non-member tag is a no-op); outcome TBD (no built-in equivalent for the trailing-empty/`0` parameter); `S(S-xmo-shift)`
- Then sway: Unsupported action parameter here: no trailing-empty shortcut in source (`move to workspace number` targets explicit workspaces, no `0` branch); outcome TBD (no built-in equivalent for the trailing-empty parameter); `S(S-sway-movews)`
- Then qtile/Columns: Unsupported action parameter here: no trailing-empty shortcut in source (groups are explicit 1-9; an unknown group raises); outcome TBD (no built-in equivalent); `S(S-qti-group)`
- Then awesome/tile: Unsupported action parameter here: tags are explicit per-screen (1-9) with explicit view_only, no trailing-empty shortcut or 0 target in source; outcome TBD (no built-in equivalent); `S(S-awe-tag)`
- Then niri: no-counterpart (no trailing-empty shortcut exists;
  indices address existing workspaces only and cleanup keeps the
  last). `S(S-nir-acts)`.
- Then PaperWM: no-counterpart (no trailing-empty shortcut in the
  registered action inventory). `S(S-pap-acts)`.
- Then karousel/Lazy: owner-specific (desktops are KWin-native and
  no shortcut verb exists). `S(S-kar-acts)`.
- Then paneru: no-counterpart (no trailing concept exists; explicit
  `VirtualAdd` creates instead). `S(S-pan-cmds)`.
- Then Ours KDE: KDE mapping TBD
- Then Ours Windows: Reuse trailing empty; per-output-local mapping; `D(D-dec-win)` (2026-10-02)
- Variant hook: V-WS-FOLLOW.

<a id="r-ws-04-backfill-memory-invalidation-scrolling"></a>
### R-WS-04: memory invalidation

- Given (tree profiles): WS1 `H[A,B*]`; WS2 `H[C,D]`

- Given (column profiles): `WS1=COL[C1[A],C2[B*]]`, `WS2=COL[C1[C],C2[D]]`.
  On WS2 focus D then C (history D,C); float C to remove the
  remembered leaf; select WS1 and focus B; then send B to WS2.
  No step is reordered: C is floated only after holding focus.

- When: On WS2 focus D then C; float C to remove the remembered leaf; select WS1/focus B; send B to WS2

- When (column leg): the float removal runs first, then the native send.

- Observe: Memory invalidation; surviving D from history vs root; axis/order/follow

- Observe (column leg): surviving anchor for B (history vs sole candidate), float
  exit, target position.

- Then COSMIC: Floated C leaves the tiling tree (D sole); MRU search skips C (no tiling node) and matches D, so B admits at surviving D from history (not root), splits D's long edge (D geometry unrecorded), B after D; `SendToWorkspace` leaves focus (falls back to A), `MoveToWorkspace` follows with B; `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-focusfix)` + `S(S-cos-send)`
- Then Hyprland/Dwindle: No remembered-leaf or history anchor in source (floated C simply leaves the tiled set); target anchor is sole D regardless of cursor (only tiled candidate on WS2); splits D's long edge (D geometry unrecorded, so axis TBD), B before/after D TBD (cursor half); `S(S-hyp-movews)`
- Then bspwm: TBD (no remembered-leaf/history anchor in source; arrival inserts at live WS2 focus, and the split against the floated leaf is unevidenced here); `S(S-bsp-xfer)`
- Then i3: `move container to workspace` (no-follow): floated C sits in the WS2 floating list (floating-target fallback), so the anchor is sole D with B after D; source collapses; focus stays A; `S(S-i3-movews)`
- Then xmonad/Tall+Navigation2D: Floated C stays in the stack with focus retained (`float` is a floating-map write only); B arrives via `shiftWin` as `insertUp` above live WS2 focus C (order `[B,C,D]`, B focused there; no floating-leaf split, Tall has no splits); source collapses to A with source view unchanged (no follow); C remains floating; exact frames TBD; `S(S-xmo-shift)` + `S(S-xmo-float)`
- Then sway: `move container to workspace` (no-follow): the workspace destination resolves via focus-inactive tiling only, so floated C never anchors; B lands after sole D; source collapses; focus stays A; `S(S-sway-movews)`
- Then qtile/Columns: No remembered-leaf/history anchor in source (floated C leaves the layouts for the floating list); B admits at live WS2 focus via the ordinary anchor; exact order TBD (D geometry and live focus unrecorded); `S(S-qti-group)` + `S(S-qti-add)` + `S(S-qti-float)`
- Then awesome/tile: No remembered-leaf/history admission anchor in source (tile recalc over live tiled order); floated C leaves the tiled set; B admits via the ordinary path with no view switch; exact order/frames TBD; `S(S-awe-tag)` + `S(S-awe-float)` + `S(S-awe-tile)`
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
- Then Ours KDE: Valid focus-history after invalid remembered leaf, then genuine no-focus root; selected `D(D-dec-x)`; scenario result TBD
- Then Ours Windows: Valid focus-history after invalid remembered leaf, then genuine no-focus root; selected `D(D-dec-x)`; scenario result TBD
- Variant hook: V-WS-ANCHOR.

<a id="r-ws-05-backfill-floating-transfer-scrolling"></a>
### R-WS-05: floating transfer

- Given (tree profiles): WS1 `H[A,B*]`, WS2 empty

- Given (column profiles): `WS1=COL[C1[A],C2[B*]]`, WS2 empty; send B to WS2,
  float B there, then request B back on WS1.

- When: Send B to WS2; select WS2/focus B; float B; request send B back to WS1; select WS1

- When (column leg): both transfers run through the profile's native send verb.

- Observe: Whether floating B can transfer; retained float vs fresh tiled admission; focus

- Observe (column leg): whether the floating B transfers; retained float vs fresh
  admission; focus.

- Then COSMIC: Floating B transfers; fresh tiled admission at A (splits A's long edge, B after A), float not retained; `SendToWorkspace` + select focuses A (WS1 MRU; B admitted unfocused), `MoveToWorkspace` focuses B; `S(S-cos-send)` + `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-focusfix)`
- Then Hyprland/Dwindle: Forward B takes a full-work-area tile box on empty WS2 (sole tiled tile, not maximized mode); floated B transfers retaining float state at monitor-relative position (never fresh-tiled on arrival); the floated return makes no new tiling admission, so no anchor/axis/order applies: sole A stays the unchanged tiled tile; follow/silent focus per `S(S-hyp-movews)`; exact frames TBD; `S(S-hyp-movews)`
- Then bspwm: Forward B sole on WS2; floated B transfers retaining float (node moves with client state, no fresh tiling; sole A unchanged); shipped send without `--follow` stays on the source, `--follow` keeps focus on B; exact frames TBD; `S(S-bsp-xfer)` + `S(S-bsp-float)`
- Then i3: `move container to workspace` (no-follow both legs): forward B sole on WS2; floated B transfers as a floating wrapper to WS1 (float retained, no fresh tiling; sole A unchanged); return stays on the now-empty WS2; `S(S-i3-movews)`
- Then xmonad/Tall+Navigation2D: Forward B sole on WS2; floated B transfers retaining float (`shiftWin` uses `delete'` preserving the floating map, no fresh tiling; sole A unchanged); source view unchanged (no follow); exact frames TBD; `S(S-xmo-shift)` + `S(S-xmo-float)`
- Then sway: `move container to workspace` (no-follow both legs): forward B sole on WS2; floated B transfers as floating to WS1 (float retained, no fresh tiling; coordinate fix only on output change, same-output leg performs no rewrite; sole A unchanged); return stays on the now-empty WS2; `S(S-sway-movews)`
- Then qtile/Columns: Floated B transfers retaining float (removed from the floating list, re-added floating via the float state path, never fresh-tiled; sole A unchanged); the shipped binding follows via switch_group=True; exact frames TBD; `S(S-qti-group)` + `S(S-qti-float)`
- Then awesome/tile: Forward B sole on WS2 (single tile expands full width); floated B transfers retaining float (persistent client property, no fresh tiling; sole A unchanged); no view switch either leg; exact frames/focus TBD; `S(S-awe-tag)` + `S(S-awe-float)`
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
- Then Ours KDE: TBD (explicit send applies to focused tiled windows `D(D-dec-cos)`; floated roundtrip untested)
- Then Ours Windows: TBD (explicit send applies to focused tiled windows `D(D-dec-cos)`; floated roundtrip untested)
- Variant hook: V-FLOAT-GEO.

<a id="r-ws-06-backfill-send-to-a-floating-workspace-scrolling"></a>
### R-WS-06: send to a floating workspace

- Given (tree profiles): WS1 tiled `H[A,B*]`; WS2 floating

- Given (column profiles): attempted mapping is WS1 with `COL[C1[A],C2[B*]]` at
  shipped defaults plus a `WS2 floating` target. No scrolling profile has
  a workspace-wide floating mode, so the target parameter has no faithful
  start; the Thens below are applicability qualifications, never an
  ordinary transfer with a substituted target. No send/return journey runs
  on an impossible target.

- When: Send B to WS2; send B back to WS1

- Observe: Native membership/follow, source reflow and floating frame preservation vs two-domain plan

- Observe (column leg): whether the `WS2 floating` target exists natively.

- Then COSMIC: Forward B arrives floating reusing its last tiled origin with clamped size (exact frame TBD); source reflows; return is fresh tiled admission at A (B after A); `SendToWorkspace` leaves focus (source-MRU fallback each leg), `MoveToWorkspace` follows with B; `S(S-cos-send)` + `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-focusfix)`
- Then Hyprland/Dwindle: Forward TBD: no workspace floating mode exists in source to map `WS2 floating` onto (arrival dispatch is per-window by the mover's own float state, which this fixture never changes), so no floating arrival is recorded; return anchor is sole A (A geometry unrecorded, so axis TBD), B before/after A TBD (cursor half); exact frames TBD; `S(S-hyp-movews)`
- Then bspwm: Forward TBD: no workspace floating mode exists in source (float is per-window; desktop layout tiled/monocle only), so the return leg is conditional on an unestablished forward; `S(S-bsp-float)` + `S(S-bsp-layout)`
- Then i3: Forward TBD: no workspace floating mode exists in source to map `WS2 floating` onto (float is per-window); arrival dispatch for that parameter unevidenced, so the return leg is conditional on an unestablished forward; `S(S-i3-movews)`
- Then xmonad/Tall+Navigation2D: Forward TBD: no workspace floating mode in source (float is per-window; layout Tall/Mirror/Full plus floating layer only), so the return leg is conditional on an unestablished forward; `S(S-xmo-float)` + `S(S-xmo-layout)`
- Then sway: Forward TBD: no workspace floating mode exists in source to map `WS2 floating` onto (float is per-window; `workspace_layout` default/stacked/tabbed only); arrival dispatch for that parameter unevidenced, so the return leg is conditional on an unestablished forward; `S(S-sway-wsmode)`
- Then qtile/Columns: Forward TBD: no workspace floating mode exists in source (float is per-window; Columns always tiles plus a floating layer), so a tiled B admits tiled via the ordinary anchor; the return leg is likewise ordinary togroup; exact frames TBD; `S(S-qti-group)` + `S(S-qti-float)` + `S(S-qti-add)`
- Then awesome/tile: WS2 floating reads as the shipped floating layout on that tag (layout is per-tag); forward B arrives unarranged (floating arrange no-op, incoming geometry kept); return re-admits via tile partition; no view switch either leg; exact frames/focus TBD; `S(S-awe-tag)` + `S(S-awe-layout)` + `S(S-awe-float)`
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
- Then Ours KDE: membership-only boundary send, only tiled side reflows,
  floating frames untouched. Default follows with verified arrival/switch/focus
  readback; explicit stay preserves source view/native boundary focus. Item 2
  implemented offline; physical feel/native journey pending.
  [Fixtures](../../../kwin/tests/workspace-send-follow-stay.test.ts),
  [record](../../changes/archive/kde-workspace-send-follow-stay.md); `D(D-dec-ww)`.
- Then Ours Windows: Synthetic/native Paint roundtrip preserves floating frame, reflows source before hide and freshly admits on return; [workspace mode record](../../changes/archive/windows-workspace-tiling.md); physical feel TBD
- Variant hook: V-WS-FOLLOW.

<a id="r-ws-07-backfill-shell-switcher-listing-scrolling"></a>
### R-WS-07: shell switcher listing

- Given (tree profiles): WS1 `H[A,B*]`, WS2 `H[C*]` currently shown; KDE switcher includes all desktops

- Given (column profiles): `WS1=COL[C1[A],C2[B*]]`, `WS2=COL[C1[C*]]` shown.
  Use niri's default All MRU scope; Workspace-only is a separate variant.

- When: Select B in Alt+Tab

- When (column leg): select B in the profile's window switcher.

- Observe: B listed vs omitted; switch to WS1 with B membership unchanged vs pull B into WS2

- Observe (column leg): B listed vs omitted; switch to WS1 with membership
  unchanged vs pull into WS2.

- Then COSMIC: B listed: the Alt+Tab empty-query search appends every compositor-published toplevel with no workspace/visibility filter; selecting B calls `manager.activate`, and the compositor unminimizes B, switches to WS1 via `shell.activate`, and focuses B with membership unchanged (never pulled into WS2; sticky windows focus in place); `S(S-cos-sysact)` + `S(S-cos-syscmd)` + `S(S-lch-altab)` + `S(S-pop-toplevel)` + `S(S-cos-topact)`; exact switcher visuals/key-repeat timing TBD
- Then Hyprland/Dwindle: TBD (no Alt+Tab switcher/listing source established at this pin; membership/focus effect unevidenced)
- Then bspwm: TBD (no switcher/listing source at this pin; membership/focus effect unevidenced)
- Then i3: TBD (no Alt+Tab switcher/listing source established at this pin; membership/focus effect unevidenced)
- Then xmonad/Tall+Navigation2D: TBD (no Alt+Tab switcher/listing source at this pin; membership/focus effect unevidenced)
- Then sway: TBD (no Alt+Tab switcher/listing source established at this pin; switcher is external, membership/focus effect unevidenced)
- Then qtile/Columns: TBD (no Alt+Tab switcher/listing in the shipped key inventory at this pin; membership/focus effect unevidenced); `S(S-qti-keys)`
- Then awesome/tile: TBD (no Alt+Tab switcher/listing in the shipped key inventory at this pin; jump_to/urgent.jumpto switch-to-tag path unevidenced for switcher listing); `S(S-awe-keys)` + `S(S-awe-tag)`
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
- Then Ours KDE: Per the KDE source, native filter permits B; TabBox activation follows configured policy, default switch to WS1, alternative bring-to-current; exact user-version live outcome TBD; `D(D-alt-tab)`
- Then Ours Windows: Current `SW_HIDE`: B omitted; future inclusion/activation policy TBD; `D(D-alt-tab)`
- Variant hook: V-WS-SHELL-ACTIVATE.

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
- Then Ours KDE: WS2 then WS3, stable-ID two-view toggle via Meta+Ctrl+Tab;
  implemented; single-output native journey user-confirmed 2026-10-07
  ("worked perfectly"). Individual cases/presets were not specified;
  multi-output/hotplug/preset checks remain pending. Scoped observed-change history in
  [adapter](../../../kwin/src/workspace-native.ts),
  [fixtures](../../../kwin/tests/workspace-previous-relative.test.ts),
  [record](../../changes/archive/kde-workspace-history-ring.md).
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
- Then Ours Windows: emptied-middle removal route exists (corrected
  2026-10-08 at `db31234`): `crates/tiler-windows/src/workspace.rs:508`
  `apply_cleanup` removes stable IDs, invoked from retirement cleanup at
  `crates/tiler-windows/src/tiling_sys.rs:9228-9234` and selection at :10074-10080;
  `crates/tiler-core/src/workspace.rs:35` removes eligible invisible
  empties, preserving the trailing spare and minimum count. Eligible invisible
  empties can be removed; visible, occupied, or retained-policy-excluded ids
  stay. Whether this exact given (emptied
  middle WS2 after a send, then select WS3) retains or removes on Windows
  is TBD; no live acceptance recorded here. `S(S-ours-ws)`.
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
- Then Ours KDE: next from WS3 selects existing trailing empty, previous
  returns to WS3; last next wraps to first, first previous to last. Scoped
  existing order includes ordinals beyond 9; selection creates nothing.
  H/K/Left/Up previous, J/L/Down/Right next, all Meta+Ctrl. Authentic clears
  stock KWin desktop-switch arrows through confirmed shortcut application;
  Compatible disables our arrows, letters remain. Single-output native journey
  user-confirmed 2026-10-07 ("worked perfectly"); individual edge/>9 cases and
  presets unspecified, multi-output/presets pending. [Adapter](../../../kwin/src/workspace-native.ts),
  [fixtures](../../../kwin/tests/workspace-previous-relative.test.ts),
  [reconciler](../../../kwin/native-effect/shortcutreconciler.cpp),
  [record](../../changes/archive/kde-workspace-history-ring.md).
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
- Then COSMIC: Shipped `MoveToNextWorkspace`/`MoveToPreviousWorkspace`
  resolve to active plus/minus one (next cycles to index 0 and previous
  to the last with wraparound, else output fallback) and follow with B;
  `SendToNextWorkspace`/`SendToPreviousWorkspace` leave focus.
  `S(S-cos-ws)` + `S(S-cos-wskeys)`.
- Then Hyprland/Dwindle: plain `next` targets WS3; plain `previous`
  targets the MRU previous workspace, not necessarily WS1. Follow
  focuses B; silent refocuses the source. `S(S-hyp-movews)` +
  `S(S-hyp-ws)`.
- Then bspwm: unflagged relative form `node -d next`/`prev` resolves the relative desktop (without `--follow` stays on the source; `--follow` keeps focus on B). `S(S-bsp-ws)`.
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
  the target when the mover was active (`focus=false` stays).
  `S(S-nir-ws)`.
- Then PaperWM: resolves to the adjacent space with take-window and
  stops at the ends; drop completes with insert plus `Main.activateWindow`
  (follow per take finalization), insert position stays TBD.
  `S(S-pap-space)` + `S(S-pap-take)`; position queued.
- Then karousel/Lazy: resolves to the adjacent desktop with an edge
  stop and moves the whole column C2 (appended after the target's
  last column); follow stays TBD. `S(S-kar-ws)`; follow queued.
- Then paneru: South moves with the len-greater-than-one gate and
  North stops at index 0, each carrying the `MoveFocus`
  Follow/Stay policy. `S(S-pan-ws)`.
- Then Ours KDE: next resolves WS3, previous WS1 from the existing scoped
  ordinal ring (not MRU), once before transfer. Default relative follow
  Meta+Ctrl+Shift+H/K/Left/Up previous, J/L/Down/Right next; stay registered
  unbound, keeps WS2 selected and source MRU focus. Admission unchanged.
  Authentic clears stock KWin Window One Desktop arrows; Compatible disables
  our four arrows, keeps letters. Implemented offline, native journey pending.
  [Fixtures](../../../kwin/tests/workspace-send-follow-stay.test.ts),
  [reconciler](../../../kwin/native-effect/shortcutreconciler.cpp),
  [record](../../changes/archive/kde-workspace-send-follow-stay.md).
- Then Ours Windows: no-counterpart (index-only `Send`; no relative
  verb). `S(S-ours-planops)`.
- Variant hook: V-WS-FOLLOW (follow policy for relative sends).

## Selected additions (USER 2026-10-07; KDE items 1/2 delivered)

Targets follow [items 1/2 and decision 1.5](../../decisions.md#cross-platform-behavior).
KDE R-WS-08/11 and R-WS-15..17 carry offline adapter/fixture evidence;
the user confirmed item 1's single-output native journey on 2026-10-07
("worked perfectly"), without specifying individual cases or presets.
Multi-output/hotplug and preset checks remain pending. Item 2 R-WS-01/14 and
R-WS-18..20 carry offline evidence only; native journeys pending.
Other source cells retain their pinned-current meaning.
R-WS-08 selects two-view previous-ID toggle, per-output local/global-unique
history or one shared history; record all successful observed changes, not
same-workspace activation/output focus alone. Removed/unassigned/out-of-scope
IDs clear; disconnected output history is discarded. Hotplug records without
history-driven reconnect selection. R-WS-11 selects the scoped existing-order
ring, wrapping including trailing empty and ordinals beyond 9, selection
creates nothing. R-WS-01/14 select numbered/relative follow defaults plus
bindable unbound stay, same ring resolved once before transfer, normal spare
maintenance; item 2 repairs KDE's source-view-preserving floating-boundary
path to the already-decided follow default. Item 2 is implemented offline on
shared core/KDE; both adapters' additions remain pending on Windows. Decision
2.3's compile-only `follow: true` fix preserves current Windows behavior;
stay/relative wiring remains in the [handoff](../../backlog.md).

### R-WS-15: previous on L after a workspace change on R

- Given (local/global-unique leg): occupied WS1/WS2 on L and two occupied
  workspaces on R; stable IDs, separate scoped orders. Start on L WS1.
- Given (shared leg): one shared workspace set shown across L/R; the
  corresponding observed changes are to WS1, WS2, then WS3, not independent
  per-output views. Reference native scope/model applicability stays TBD.
- When: visit L WS1 -> WS2; change R's workspace; focus L without changing
  its workspace; invoke previous twice. Shared leg: visit WS1 -> WS2 ->
  WS3, then invoke previous twice.
- Observe: per-output isolation vs shared two-view history; output-focus
  alone vs workspace change as a history producer.
- Then COSMIC: TBD.
- Then Hyprland/Dwindle: TBD.
- Then bspwm: TBD.
- Then i3: TBD.
- Then xmonad/Tall+Navigation2D: TBD.
- Then sway: TBD.
- Then qtile/Columns: TBD.
- Then awesome/tile: TBD.
- Then niri: TBD.
- Then PaperWM: TBD.
- Then karousel/Lazy: TBD.
- Then paneru: TBD.
- Then Ours KDE: local/global-unique L WS1 then WS2, R unchanged;
  shared WS2 then WS3. Implemented offline, native journey TBD; item 1.2.
  [Fixtures](../../../kwin/tests/workspace-previous-relative.test.ts).
- Then Ours Windows: same selected scope/toggle target; implementation
  pending, including non-local modes; item 1.2.
- Variant hook: provisional/TBD (R-WS-08 history scope).

### R-WS-16: previous after the visited empty workspace is removed

- Given: a scoped trailing empty E and occupied W with stable IDs.
- When: visit E -> W; let E be removed by the native/managed lifecycle;
  invoke previous. Do not substitute another ordinal for E. If the profile
  cannot remove E, removal applicability/outcome stays TBD.
- Observe: removed-ID invalidation vs ordinal reinterpretation/recreation;
  separately record whether the empty ID actually survives.
- Then COSMIC: TBD.
- Then Hyprland/Dwindle: TBD.
- Then bspwm: TBD.
- Then i3: TBD.
- Then xmonad/Tall+Navigation2D: TBD.
- Then sway: TBD.
- Then qtile/Columns: TBD.
- Then awesome/tile: TBD.
- Then niri: TBD.
- Then PaperWM: TBD.
- Then karousel/Lazy: TBD.
- Then paneru: TBD.
- Then Ours KDE: removal clears previous E; no-op until next
  recorded change, no recreation/reinterpretation. Surviving empty E stays
  valid. Implemented offline, native journey TBD; item 1.3.
  [Fixtures](../../../kwin/tests/workspace-previous-relative.test.ts).
- Then Ours Windows: same selected stable-ID rule; implementation pending.
  A removal route exists (`crates/tiler-windows/src/workspace.rs:508`;
  `crates/tiler-windows/src/tiling_sys.rs:9228-9234`, :10074-10080);
  whether the exact given (removed trailing empty E as previous) clears on
  Windows is TBD; no live acceptance recorded here (corrected 2026-10-08
  at `db31234`).
- Variant hook: provisional/TBD (R-WS-08 previous-ID validity).

### R-WS-17: previous around disconnect displacement and reconnect return

- Given: local/global-unique L shows occupied WS2, previous WS1; R has an
  active window on workspace D whose disconnect displacement will show D
  on L. Record session-local output IDs and workspace scope.
- When: disconnect R; observe D shown on L; invoke previous on L;
  reconnect R; observe D's return scope; invoke previous on L again.
- Observe: hotplug history recording, reconnect selection independent of
  history, and clearing a previous ID when it returns to another output.
- Then COSMIC: TBD.
- Then Hyprland/Dwindle: TBD.
- Then bspwm: TBD.
- Then i3: TBD.
- Then xmonad/Tall+Navigation2D: TBD.
- Then sway: TBD.
- Then qtile/Columns: TBD.
- Then awesome/tile: TBD.
- Then niri: TBD.
- Then PaperWM: TBD.
- Then karousel/Lazy: TBD.
- Then paneru: TBD.
- Then Ours KDE: disconnect WS2 -> D records previous WS2;
  first toggle selects WS2, previous D. D's return to R clears L's previous
  D; if reconnect preserves L WS2 with no further recorded change, second
  toggle is a no-op. Reconnect never consults/restores history; any observed
  workspace change records normally; R's disconnected history is discarded.
  Implemented offline, native journey TBD (1.5).
  [Fixtures](../../../kwin/tests/workspace-previous-relative.test.ts).
- Then Ours Windows: same selected 1.5 history/scope rule and conditional
  second toggle; implementation pending, multi-output parked; native journey TBD.
- Variant hook: provisional/TBD (R-WS-08 hotplug history).

### R-WS-18: relative next send fills the trailing empty

- Given (tree leg): scoped order occupied WS1..WS10, shown last occupied
  WS10 `H[A,B*]`, trailing empty E. WS10 establishes an ordinal beyond 9.
- Given (column leg): same order with WS10 `COL[C1[A],C2[B*]]`;
  trailing-empty/model applicability TBD per reference.
- When: send B next with follow; inspect E and the spare; fresh reset,
  repeat with stay. Resolve the pre-transfer order once each run.
- Observe: E reused/filled vs new target; next trailing spare; follow/stay.
- Then COSMIC: TBD.
- Then Hyprland/Dwindle: TBD.
- Then bspwm: TBD.
- Then i3: TBD.
- Then xmonad/Tall+Navigation2D: TBD.
- Then sway: TBD.
- Then qtile/Columns: TBD.
- Then awesome/tile: TBD.
- Then niri: TBD.
- Then PaperWM: TBD.
- Then karousel/Lazy: TBD.
- Then paneru: TBD.
- Then Ours KDE: selected B fills existing E; normal lifecycle supplies
  next empty; source A survives. Follow goes with B, stay preserves source
  view with focused-removal MRU. Implemented offline (item 2.2), native journey
  pending. Ring/spare and send-flight [fixtures](../../../kwin/tests/workspace-send-follow-stay.test.ts).
- Then Ours Windows: same selected ring/spare/follow/stay target;
  implementation pending; items 1.4/2.2.
- Variant hook: V-WS-FOLLOW.

### R-WS-19: relative previous send wraps from the first workspace

- Given (tree leg): scoped occupied WS1..WS3, shown first WS1 `H[A,B*]`,
  trailing empty E last; history does not redefine the ordinal order.
- Given (column leg): WS1 `COL[C1[A],C2[B*]]` with the same order;
  trailing-empty/model applicability TBD per reference.
- When: send B previous with follow; fresh reset, repeat with stay.
- Observe: ordinal wrap to E vs MRU target; target resolved before transfer;
  spare maintenance and follow/stay.
- Then COSMIC: TBD.
- Then Hyprland/Dwindle: TBD.
- Then bspwm: TBD.
- Then i3: TBD.
- Then xmonad/Tall+Navigation2D: TBD.
- Then sway: TBD.
- Then qtile/Columns: TBD.
- Then awesome/tile: TBD.
- Then niri: TBD.
- Then PaperWM: TBD.
- Then karousel/Lazy: TBD.
- Then paneru: TBD.
- Then Ours KDE: selected previous wraps to pre-transfer E, fills it;
  normal lifecycle supplies next empty. Follow with B, stay on WS1 with A.
  Implemented offline; item 2.2, native journey pending.
  [Fixtures](../../../kwin/tests/workspace-send-follow-stay.test.ts).
- Then Ours Windows: same selected ordinal-wrap/follow/stay target;
  implementation pending; item 2.2.
- Variant hook: V-WS-FOLLOW.

### R-WS-20: relative edge sends when the source becomes empty

- Given: fresh fixtures from R-WS-18 and R-WS-19, but source holds sole B*
  (column leg `COL[C1[B*]]`); all other scope/order preparation unchanged.
- When: send B next from last occupied; reset, send B previous from first;
  repeat each from fresh fixtures with stay instead of follow.
- Observe: source emptiness vs target/spare resolution and follow/stay;
  record source retention/removal and exact empty-source focus separately.
- Then COSMIC: TBD.
- Then Hyprland/Dwindle: TBD.
- Then bspwm: TBD.
- Then i3: TBD.
- Then xmonad/Tall+Navigation2D: TBD.
- Then sway: TBD.
- Then qtile/Columns: TBD.
- Then awesome/tile: TBD.
- Then niri: TBD.
- Then PaperWM: TBD.
- Then karousel/Lazy: TBD.
- Then paneru: TBD.
- Then Ours KDE: selected target is pre-transfer E in both legs; fills E,
  normal lifecycle supplies next empty. Follow with B; stay preserves source
  view. Core emptied-source desired focus is null (adapter issues no focus
  setter); native focus and exact source retention/removal remain TBD.
  Implemented offline (item 2.2); native journey pending.
  [Core](../../../crates/tiler-core/tests/session_send_to_workspace.rs),
  [ring/flight fixtures](../../../kwin/tests/workspace-send-follow-stay.test.ts).
- Then Ours Windows: same selected target/spare/follow/stay rule;
  implementation pending; exact source lifecycle/native focus TBD.
- Variant hook: V-WS-FOLLOW.
