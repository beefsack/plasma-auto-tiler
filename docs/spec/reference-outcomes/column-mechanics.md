# Scrollable-column mechanics (reference outcomes)

Part of the [outcome matrix index](../reference-outcomes.md). Notation, profiles, evidence legend, and variant hooks live in the index; `S()`/`D()` keys below resolve there. No existing column rows to backfill (0 existing rows, 0 cells). Shared lifecycle actions reuse model-qualified existing/new IDs; no second column lifecycle inventory. Approved candidates and final queue are recorded in [reference-matrix-expansion.md](../../changes/archive/reference-matrix-expansion.md).

## New scenarios (GWT; fixtures/actions/discriminators per the approved expansion record)

Notation, profiles, baselines, legend, and projection rules live in the
index. Each scenario below has exactly one Then bullet per profile (14).
`S()` tags attach only to the established sub-leg; anything else on that
line stays TBD. Column Given bullets are separate fixtures, never H/V
ancestry claims. Ours cells cite actual Engine + adapter source via the
established `S(S-ours-*)` model keys; selected intent is never evidence.
A missing strip/column verb is `no-counterpart`, an unbuildable column
start is `fixture-inapplicable`; neither votes as an agreeing no-op.
Shipped scrolling baselines: niri half-width columns, 1/3-1/2-2/3
presets, centering never (`S(S-nir-base)`); PaperWM RIGHT insertion,
DEFAULT focus (`S(S-pap-base)`); karousel 50%/100% widths, Lazy
scrolling, Centered/Grouped off, no default stack (`S(S-kar-base)`);
paneru shipped defaults, width presets, resize-cycle on, auto-center
off, append admission (`S(S-pan-base)`).

### R-COL-01: open a window over three half-width columns

- Given (column profiles): `COL[C1[A],C2[B*],C3[C]]`, each 0.5W;
  `VP(x=0,W=2400)` shows C1/C2. Ordinary windows, scale 1, shipped
  defaults apply.
- When: open D.
- Observe: new column before/after focus or append vs same-column
  admission; existing widths stable vs rescaled; new focus viewport.
- Then COSMIC: fixture-inapplicable: no strip/column model; ordinary
  admission splits the focused leaf's long edge. `S(S-cos-model)`.
- Then Hyprland/Dwindle: fixture-inapplicable under the Dwindle
  profile: admission splits the anchor with pointer-ordered newcomer,
  no strip columns. `S(S-hyp-ins)`.
- Then bspwm: fixture-inapplicable: binary tree, anchor longest-side
  split with newcomer second child. `S(S-bsp-insert)`.
- Then i3: fixture-inapplicable: tree attach after the focused parent;
  no geometry-driven strip. `S(S-i3-ins)`.
- Then xmonad/Tall+Navigation2D: fixture-inapplicable: flat
  master/stack, no columns. `S(S-xmo-layout)`.
- Then sway: fixture-inapplicable: sibling attach after the focused
  tiling node. `S(S-sway-ins)`.
- Then qtile/Columns: fixture-inapplicable: the exact three-column
  fixture exceeds shipped `num_columns=2`; at the limit admission
  stays in the current column. `S(S-qti-add)`.
- Then awesome/tile: fixture-inapplicable: master/stack partition in
  insertion order, no strip. `S(S-awe-tile)`.
- Then niri: new column at active+1, activated when told; pending
  maximized/fullscreen tiles stay in the scrolling layout. Settled
  widths, newcomer focus and viewport stay TBD. `S(S-nir-ins)`; queued.
- Then PaperWM: D opens as a new column at selected+1 (between B and C) under the shipped RIGHT default, activated on show with inactive-space no-steal; existing columns keep widths (no rescale) and the viewport keeps D visible via minimal ensuredX scroll under DEFAULT. `S(S-pap-ins)` + `S(S-pap-layout)` + `S(S-pap-view)`.
- Then karousel/Lazy: new column after the last-focused column (else
  the last), window appended at the bottom. KWin-side focus, settled
  widths and viewport stay TBD. `S(S-kar-ins)`; queued.
- Then paneru: reinsertion at the remembered strip index, else the
  active strip at the configured insertion index, else overlap/end,
  then reshuffle. Focus stays TBD. `S(S-pan-ins)`; queued.
- Then Ours KDE: no-counterpart: Engine has no column/strip admission;
  `Node` is Leaf or split-axis Group only. `S(S-ours-planops)` +
  `S(S-ours-grp)`.
- Then Ours Windows: no-counterpart: same shared Engine; no column
  admission verb in any layer. `S(S-ours-planops)` + `S(S-ours-grp)`.
- Variant hook: provisional/TBD (column-insertion hook, to discuss).

### R-COL-02: cycle column width through presets and back

- Given (column profiles): `COL[C1[A*],C2[B]]`, C1 at the smallest
  declared preset. Shipped presets apply; no manual widths.
- When: cycle column width through one full preset cycle, then reverse
  once, with each profile's native verb.
- Observe: ratio/pixel presets, wrap/stop and window vs column scope;
  oversized columns only where a native preset exists.
- Then COSMIC: no-counterpart: pixel resize only, no width presets or
  cycle verb. `S(S-cos-resize)`.
- Then Hyprland/Dwindle: no-counterpart: pixel-delta resize only, no
  preset cycle. `S(S-hyp-resize)`.
- Then bspwm: no-counterpart: `-z` pixel handle plus root `-E`/`-B`,
  no preset cycle. `S(S-bsp-resize)`.
- Then i3: no-counterpart: grow/shrink shares only, no preset cycle.
  `S(S-i3-resize)`.
- Then xmonad/Tall+Navigation2D: no-counterpart: `Shrink`/`Expand`
  move `frac` only, no edge or preset verb. `S(S-xmo-resize)`.
- Then sway: no-counterpart: tiled share adjust only, no preset cycle.
  `S(S-sway-resize)`.
- Then qtile/Columns: no-counterpart for the preset cycle: directional
  grows move width/height from the neighbor plus `normalize`; no
  preset-step verb. `S(S-qti-resize)`.
- Then awesome/tile: no-counterpart: `incmwfact` master-factor step
  only, no preset cycle. `S(S-awe-resize)`.
- Then niri: steps the preset index through 1/3-1/2-2/3 forward and
  with `SwitchPresetColumnWidth(Back)`, wrapping at the ends;
  columns independent. `S(S-nir-resize)` + `S(S-nir-base)`.
- Then PaperWM: 10% grid step plus width-cycle direction with
  registered forward/backward verbs, wrapping on exhaust;
  neighbor columns keep their widths (per-column targetWidth, no rescale).
  `S(S-pap-resize)` + `S(S-pap-layout)`.
- Then karousel/Lazy: forward steps to the next strictly greater
  preset and wraps to the first on exhaust; reverse mirrors. Shipped
  presets 50%/100%. `S(S-kar-cycle)`.
- Then paneru: Grow/Shrink step through the shipped presets and wrap
  by default (`window_resize_cycle` true); `SetWidth` takes an exact
  ratio. `S(S-pan-colops)`.
- Then Ours KDE: no-counterpart: nearest-ancestor share resize only,
  no presets or equalize family. `S(S-ours-resize)`.
- Then Ours Windows: no-counterpart: no keyboard resize trigger at
  all; pointer resize maps to shares, never presets.
  `S(S-ours-resize)` + `S(S-ours-winbind)`.
- Variant hook: provisional/TBD (column-width hook, to discuss).

### R-COL-03: consume a column, then expel it

- Given (column profiles): `COL[C1[A*],C2[B]]`, separate equal-width
  columns. Shipped defaults apply.
- When: consume B into C1 with the native verb; then expel B with the
  native verb.
- Observe: which adjacent window/column is consumed, visible vertical
  allocation vs tabs, new column side and width recovery.
- Then COSMIC: no-counterpart: move R1/R2/R3 branches only, no
  consume/expel verb. `S(S-cos-move)`.
- Then Hyprland/Dwindle: no-counterpart: remove/reinsert focal move
  only, no consume/expel verb. `S(S-hyp-move)`.
- Then bspwm: no-counterpart: leaf exchange only, no consume/expel
  verb. `S(S-bsp-move-target)`.
- Then i3: no-counterpart: `tree_move`/reinsert only, no
  consume/expel verb. `S(S-i3-move)`.
- Then xmonad/Tall+Navigation2D: no-counterpart: same-layer stack swap
  only, no consume/expel verb. `S(S-xmo-nav)`.
- Then sway: no-counterpart: same-parent swap/reparent only, no
  consume/expel verb. `S(S-sway-move)`.
- Then qtile/Columns: directional shuffle carries B across columns
  or splits a shared-edge column; sole-column sole-window no-op.
  Allocation and width recovery stay TBD. `S(S-qti-shuffle)`; queued.
- Then awesome/tile: no-counterpart: geometric position swap only, no
  consume/expel verb. `S(S-awe-swap)`.
- Then niri: left consume joins B into the left column (single-tile
  case) without activating inactive B; expel opens a new adjacent
  column. `S(S-nir-consume)`.
- Then PaperWM: `slurp` consumes the directional neighbor per
  `open-window-position` (RIGHT: B joins C1 at BOTTOM with an equal-height
  pass, emptied C2 removed); `barf` expels to a new column at the
  directional open position. Selection stays on the focused window on
  both steps (neither path writes selectedWindow; slurp skips ensure,
  barf re-ensures the same selection). `S(S-pap-slurp)` + `S(S-pap-view)`.
- Then karousel/Lazy: sole-window B joins the left column at the
  bottom; shared-column B expels to a new adjacent column, with
  focus-taker fixup. `S(S-kar-grpmove)`.
- Then paneru: `Stack(true)` merges B's column into the left neighbor;
  `Stack(false)` splits B back to an adjacent own column. Visible
  split-vs-tabbed allocation stays TBD. `S(S-pan-colops)`; queued.
- Then Ours KDE: no-counterpart: directional move only, no
  consume/expel or tab carrier. `S(S-ours-move)` + `S(S-ours-grp)`.
- Then Ours Windows: no-counterpart: same Engine; no consume/expel
  verb. `S(S-ours-move)` + `S(S-ours-grp)`.
- Variant hook: provisional/TBD (consume/expel hook, to discuss).

### R-COL-04: focus an off-screen window by identity

- Given (column profiles): `COL[C1[A],C2[B*],C3[C],C4[D]]`, each 0.5W;
  `VP(x=0,W=2400)` shows A/B, D off-screen. Shipped scroll policy;
  fresh named Centered/Grouped (karousel) and CENTER/EDGE (PaperWM)
  variants.
- When: focus D by identity.
- Observe: minimal scroll vs centering/grouped scroll,
  partial-visibility threshold and offscreen input focus.
- Then COSMIC: fixture-inapplicable: no strip viewport; directional
  focus walks the tree, exhausted edges fall through. `S(S-cos-tilefocus)`.
- Then Hyprland/Dwindle: fixture-inapplicable: directional query plus
  monitor fallback, no strip viewport. `S(S-hyp-focus)`.
- Then bspwm: fixture-inapplicable: leaf selector over shown desktops,
  no strip viewport. `S(S-bsp-flt-focus)`.
- Then i3: fixture-inapplicable: tiled walk excluding floats, no strip
  viewport. `S(S-i3-flt-focus)`.
- Then xmonad/Tall+Navigation2D: fixture-inapplicable: same-layer
  line/side navigation, no strip viewport. `S(S-xmo-nav)`.
- Then sway: fixture-inapplicable: sibling-walk focus, no strip
  viewport. `S(S-sway-focus)`.
- Then qtile/Columns: fixture-inapplicable for the viewport leg: column
  left/right step with wrap, but all columns share the group width with
  no scrolling viewport. `S(S-qti-focus)` + `S(S-qti-resize)`.
- Then awesome/tile: fixture-inapplicable: nearest in-direction rect,
  no strip viewport. `S(S-awe-focus)`.
- Then niri: activating D's column animates the view with the minimal
  fit under shipped `Never`; Always/OnOverflow center instead.
  `S(S-nir-view)` + `S(S-nir-base)`.
- Then PaperWM: `switch` runs `ensureViewport` for minimal/margin
  scroll under DEFAULT; CENTER centers, EDGE aligns. `S(S-pap-focus)` +
  `S(S-pap-view)` + `S(S-pap-focusmode)`.
- Then karousel/Lazy: focusing D calls `scrollToColumn`, and Lazy
  applies the minimal `scrollIntoView`; Centered/Grouped variants
  center instead. `S(S-kar-scroll)` + `S(S-kar-base)`.
- Then paneru: focusing D reshuffles the strip to bring it into view;
  shipped `auto_center` off means no centering. `S(S-pan-colops)` +
  `S(S-pan-cmds)`.
- Then Ours KDE: fixture-inapplicable: leaf-only directional focus, no
  strip or viewport. `S(S-ours-focus)`.
- Then Ours Windows: fixture-inapplicable: same Engine; no viewport
  concept. `S(S-ours-focus)`.
- Variant hook: provisional/TBD (focus-scroll hook, to discuss).

### R-COL-05: explicitly center the focused column/window

- Given (column profiles): `COL[C1[A],C2[B*],C3[C],C4[D]]`, each 0.5W,
  zero gaps; `VP(x=0,W=2400)`, B fully visible off-center. Shipped
  scroll policy.
- When: explicitly center the focused column/window with the native
  verb.
- Observe: one-shot viewport change vs persistent centering policy,
  whole-column vs single-window target.
- Then COSMIC: fixture-inapplicable: no strip viewport to center.
  `S(S-cos-model)`.
- Then Hyprland/Dwindle: fixture-inapplicable: Dwindle has no strip
  viewport. `S(S-hyp-ins)`.
- Then bspwm: fixture-inapplicable: binary tree, no viewport.
  `S(S-bsp-insert)`.
- Then i3: fixture-inapplicable: tree attach model, no viewport.
  `S(S-i3-ins)`.
- Then xmonad/Tall+Navigation2D: fixture-inapplicable: flat layout, no
  viewport. `S(S-xmo-layout)`.
- Then sway: fixture-inapplicable: tree model, no viewport.
  `S(S-sway-ins)`.
- Then qtile/Columns: fixture-inapplicable: columns share the group
  width, no viewport to center. `S(S-qti-resize)`.
- Then awesome/tile: fixture-inapplicable: master/stack partition, no
  viewport. `S(S-awe-tile)`.
- Then niri: `CenterColumn` one-shot centers the active column only;
  the `Never` policy is unchanged and focus is untouched.
  `S(S-nir-view)` + `S(S-nir-base)`.
- Then PaperWM: `centerWindow` one-shot centers the frame in the work
  area via `move_to`; distinct from the persistent CENTER focus mode.
  `S(S-pap-view)` + `S(S-pap-focusmode)`.
- Then karousel/Lazy: `gridScrollFocused` one-shot scrolls to the
  focused column without touching focus; distinct from the
  Centered/Grouped scrollers. `S(S-kar-scroll)`.
- Then paneru: `Center` one-shot repositions the strip and records a
  manual offset so later reshuffles do not undo it; focus untouched.
  `S(S-pan-colops)`.
- Then Ours KDE: no-counterpart: no viewport or center verb in any
  Engine/adapter layer. `S(S-ours-planops)`.
- Then Ours Windows: no-counterpart: same Engine; no center verb.
  `S(S-ours-planops)`.
- Variant hook: provisional/TBD (viewport-center hook, to discuss).

### R-COL-06: toggle column tabbed/stacked display, then select

- Given (column profiles): `COL[C1[A],C2[B*,C]]`, B/C both visible.
  Shipped defaults apply (karousel no default stack).
- When: toggle the column tabbed/stacked display with the native verb;
  then select C.
- Observe: display-only membership/height retention vs actual grouping,
  single-visible tabs vs accordion.
- Then COSMIC: fixture-inapplicable: no strip columns; its stack
  convert/flatten is a different model. `S(S-cos-stack)`.
- Then Hyprland/Dwindle: fixture-inapplicable: group create/destroy
  only, no column display. `S(S-hyp-groupop)`.
- Then bspwm: fixture-inapplicable: no column or tabbed display.
  `S(S-bsp-insert)`.
- Then i3: fixture-inapplicable: parent tabbed/stacked layouts exist
  but the strip column fixture has no counterpart. `S(S-i3-layout)`.
- Then xmonad/Tall+Navigation2D: fixture-inapplicable: no tabs or
  columns in this profile. `S(S-xmo-layout)`.
- Then sway: fixture-inapplicable: parent tabbed/stacked splits exist
  but the strip column fixture has no counterpart. `S(S-sway-layout)`.
- Then qtile/Columns: `toggle_split` flips the current column
  between all-visible split and single-visible stacked; selecting C
  in stacked mode stays TBD. `S(S-qti-split)` + `S(S-qti-focus)`; queued.
- Then awesome/tile: fixture-inapplicable: tile partition only, no
  tabbed display. `S(S-awe-tile)`.
- Then niri: `ToggleColumnTabbedDisplay` flips Normal/Tabbed with
  membership/order/active retained; `focus_down`/`focus_up` step
  members. `S(S-nir-consume)`.
- Then PaperWM: no-counterpart: columns always show all windows
  vertically; no tabbed/stacked display verb in the action inventory.
  `S(S-pap-acts)`.
- Then karousel/Lazy: `toggleStacked` needs 2+ windows and switches
  between visible heights and overlapping arrange; `focusUp`/`focusDown`
  step members. `S(S-kar-grpmove)`.
- Then paneru: `ToggleTabbedDisplay` flips a multi-window Stack
  between visible split and single-visible tabs; tabs cycle with Focus
  North/South. `S(S-pan-colops)`.
- Then Ours KDE: no-counterpart: no tab carrier and no display-toggle
  verb. `S(S-ours-grp)`.
- Then Ours Windows: no-counterpart: same Engine; no display toggle.
  `S(S-ours-grp)`.
- Variant hook: provisional/TBD (column-display hook, to discuss).

### R-COL-07: send a whole column to another workspace

- Given (column profiles): WS1 has `COL[C1[A],C2[B*,C]]`, WS2 has one
  occupied column. Shipped defaults; native send/follow policy named.
- When: send whole C2 to WS2 with the native verb.
- Observe: atomic column transfer vs one-window send/no verb,
  membership/width preservation and target column position.
- Then COSMIC: column-atomic leg fixture-inapplicable: single-window
  send follows (Move) or stays (Send); reuse R-WS-01. `S(S-cos-send)`.
- Then Hyprland/Dwindle: column-atomic leg fixture-inapplicable:
  single-window transfer with follow/silent refocus; reuse R-WS-01.
  `S(S-hyp-movews)`.
- Then bspwm: column-atomic leg fixture-inapplicable: node send with
  `--follow`; reuse R-WS-01. `S(S-bsp-xfer)`.
- Then i3: column-atomic leg fixture-inapplicable: no-follow container
  send; reuse R-WS-01. `S(S-i3-movews)`.
- Then xmonad/Tall+Navigation2D: column-atomic leg
  fixture-inapplicable: `shiftWin` explicit-tag transfer only; reuse
  R-WS-01. `S(S-xmo-shift)`.
- Then sway: column-atomic leg fixture-inapplicable: no-follow tiled
  append; reuse R-WS-01. `S(S-sway-movews)`.
- Then qtile/Columns: column-atomic leg fixture-inapplicable:
  per-window `togroup` transfer; reuse R-WS-01. `S(S-qti-group)`.
- Then awesome/tile: column-atomic leg fixture-inapplicable:
  per-client tag move; reuse R-WS-01. `S(S-awe-tag)`.
- Then niri: `MoveColumnToWorkspace` carries the whole column and
  keeps Maximized while dropping fullscreen. Target column position
  stays TBD. `S(S-nir-wscarry)`; queued.
- Then PaperWM: single-window `takeWindow` only (no whole-column verb
  in the registered inventory): B transfers and reinserts at the target
  open position (selected+1 RIGHT, after the single occupied column)
  with shipped completion follow; C stays. No overlay in this fixture;
  overlay carry follows the ordinary existing-window admission leg.
  `S(S-pap-take)` + `S(S-pap-acts)` + `S(S-pap-ins)`.
- Then karousel/Lazy: `columnMoveToDesktop` moves the whole column
  object to the target grid appended after its last column.
  `S(S-kar-ws)`.
- Then paneru: virtual-row move carries the window's tab group,
  appending (or the mid-strip slot under the named option); stack
  atomicity and follow focus stay TBD. `S(S-pan-colops)` + `S(S-pan-ws)`; queued.
- Then Ours KDE: no-counterpart: Engine send is same-output,
  single-window only. `S(S-ours-ws)`.
- Then Ours Windows: no-counterpart: same Engine boundary; index-only
  Select/Send, no column unit. `S(S-ours-ws)`.
- Variant hook: provisional/TBD (column-send hook, to discuss).

### R-COL-08: scroll the viewport without a focus command

- Given (column profiles): four 0.5W columns, focus A, VP at the strip
  start. Shipped scroll policy.
- When: scroll the viewport right by one native step without a focus
  command (keyboard step first, gesture leg only if source is unclear).
- Observe: viewport independent of focus vs automatic refocus; clamp
  and offscreen-focused-window policy.
- Then COSMIC: fixture-inapplicable: no strip viewport.
  `S(S-cos-model)`.
- Then Hyprland/Dwindle: fixture-inapplicable: no strip viewport.
  `S(S-hyp-ins)`.
- Then bspwm: fixture-inapplicable: no strip viewport.
  `S(S-bsp-insert)`.
- Then i3: fixture-inapplicable: no strip viewport. `S(S-i3-ins)`.
- Then xmonad/Tall+Navigation2D: fixture-inapplicable: no strip
  viewport. `S(S-xmo-layout)`.
- Then sway: fixture-inapplicable: no strip viewport. `S(S-sway-ins)`.
- Then qtile/Columns: fixture-inapplicable: columns share the group
  width, no viewport to scroll. `S(S-qti-resize)`.
- Then awesome/tile: fixture-inapplicable: no strip viewport.
  `S(S-awe-tile)`.
- Then niri: touchpad gesture scrolls the view without changing focus.
  A keyboard scroll-step verb inventory stays TBD. `S(S-nir-view)`;
  queued.
- Then PaperWM: swipe moves the view but reselects the swipe target,
  and background scroll only switches focus during grab/navigation.
  Keyboard drift-left/right move the view but also reselect - no
  focus-preserving keyboard scroll-step verb in the registered inventory.
  `S(S-pap-view)` + `S(S-pap-scroll)`.
- Then karousel/Lazy: `gridScrollLeft/Right` shift the viewport by the
  200px manual step with no focus call; clamped unless forced.
  `S(S-kar-scroll)`.
- Then paneru: TBD (no manual-scroll path traced; strip motion is
  focus/reshuffle-driven). Queued.
- Then Ours KDE: fixture-inapplicable: no strip viewport.
  `S(S-ours-planops)`.
- Then Ours Windows: fixture-inapplicable: no strip viewport.
  `S(S-ours-planops)`.
- Variant hook: provisional/TBD (manual-scroll hook, to discuss).

### R-COL-09: paneru virtual rows, send across rows

- Given (paneru): `Space1:{VW1=COL[C1[A*]],VW2=COL[C2[B]]}`. Shipped
  defaults; no custom rules.
- When: send A to VW2 without changing the native Space, with the
  native virtual-move verb and follow policy named.
- Observe: native Space vs internal row membership, empty-row reaping
  and append vs positional admission.
- Then COSMIC: no-counterpart: workspaces are the only domain; no
  virtual rows inside a native container. `S(S-cos-ws)`.
- Then Hyprland/Dwindle: no-counterpart: numbered workspaces only, no
  virtual rows. `S(S-hyp-ws)`.
- Then bspwm: no-counterpart: monitor/desktop scope only, no virtual
  rows. `S(S-bsp-ws)`.
- Then i3: no-counterpart: static-named workspaces only, no virtual
  rows. `S(S-i3-ws)`.
- Then xmonad/Tall+Navigation2D: no-counterpart: static workspace
  list, no virtual rows. `S(S-xmo-ws)`.
- Then sway: no-counterpart: output-owned workspaces only, no virtual
  rows. `S(S-sway-ws)`.
- Then qtile/Columns: no-counterpart: static groups 1-9 only, no
  virtual rows. `S(S-qti-ws)`.
- Then awesome/tile: no-counterpart: static tags only, no virtual
  rows. `S(S-awe-ws)`.
- Then niri: no-counterpart: each workspace owns one scrolling strip;
  no sub-rows. `S(S-nir-ws)`.
- Then PaperWM: no-counterpart: spaces are GNOME workspaces; no
  virtual rows. `S(S-pap-space)`.
- Then karousel/Lazy: no-counterpart: desktops are KWin-native; no
  virtual rows. `S(S-kar-ws)`.
- Then paneru: `VirtualMove` carries A's tab group to VW2, appending
  (or the mid-strip slot under the named option); absent-row spawn
  and reaping per config. Follow focus stays TBD. `S(S-pan-colops)` + `S(S-pan-ws)`; queued.
- Then Ours KDE: no-counterpart: Engine workspaces have no row
  subdivision. `S(S-ours-ws)`.
- Then Ours Windows: no-counterpart: index-only workspaces, no rows.
  `S(S-ours-ws)`.
- Variant hook: provisional/TBD (virtual-row hook, to discuss).

### R-COL-10: app-native tabs nested in a vertical stack

- Given (paneru): `COL[C1[A*,B]]`, B an ordinary visible stack item;
  the same app supports native tabs. Shipped defaults; macOS host only.
- When: the app creates a native tab for A; then select B.
- Observe: native tabs nested inside a vertical stack vs all windows
  as peers, ownership/focus and column width stability.
- Then COSMIC: no-counterpart: per-window admission; no app-tab
  nesting. `S(S-cos-mapfocus)`.
- Then Hyprland/Dwindle: no-counterpart: per-window map/focus; no
  app-tab nesting. `S(S-hyp-newfocus)`.
- Then bspwm: no-counterpart: per-node insert/focus; no app-tab
  nesting. `S(S-bsp-insert)`.
- Then i3: no-counterpart: per-container attach/focus; no app-tab
  nesting. `S(S-i3-ins)`.
- Then xmonad/Tall+Navigation2D: no-counterpart: `insertUp` per window;
  no app-tab nesting. `S(S-xmo-ins)`.
- Then sway: no-counterpart: per-sibling admission; no app-tab
  nesting. `S(S-sway-ins)`.
- Then qtile/Columns: no-counterpart: per-client admission; no
  app-tab nesting. `S(S-qti-add)`.
- Then awesome/tile: no-counterpart: newcomer appended per client; no
  app-tab nesting. `S(S-awe-tile)`.
- Then niri: no-counterpart: tiler-owned tabbed display only;
  admission is per window. `S(S-nir-consume)` + `S(S-nir-ins)`.
- Then PaperWM: no-counterpart: per-window columns, transients float;
  no app-tab nesting. `S(S-pap-ins)` + `S(S-pap-spc)`.
- Then karousel/Lazy: no-counterpart: per-window tileability gate; no
  app-tab nesting. `S(S-kar-spc)`.
- Then paneru: same-app same-frame newcomer groups with the hidden
  leader via `convert_to_tabs` and takes focus; strays refold.
  Width stability and selecting B stay TBD. `S(S-pan-tabs)` + `S(S-pan-colops)`; queued.
- Then Ours KDE: no-counterpart: per-window observation; no tab
  nesting. `S(S-ours-spc-kde)` + `S(S-ours-grp)`.
- Then Ours Windows: no-counterpart: per-window admission gates; no
  tab nesting. `S(S-ours-spc-win)` + `S(S-ours-grp)`.
- Variant hook: provisional/TBD (native-tab hook, to discuss).
