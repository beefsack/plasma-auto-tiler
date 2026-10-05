# Reference-WM Outcome Matrix (provisional)

Purpose: canonical scenario/outcome evidence feeding a future
functional spec. It records observed or source-evidenced outcomes per
scenario for reference WMs and our KDE/Windows behavior. Format and
hooks are provisional, to discuss. Recorded decisions in
[decisions.md](../decisions.md) select supported variants and pending
configuration; a foreign outcome here does not automatically become
supported, and variants are spec hooks only, not implemented settings.

Row addition rule: add the shortest action sequence for an uncovered
behavior or ambiguity (reference WMs disagree, or our behavior is undecided).
Reuse existing coverage rather than duplicating a scenario with a
trivially different start state.

## Notation

- `H[a,b,c]` horizontal split, children left to right.
- `V[a,b,c]` vertical split, children top to bottom.
- Splits may hold 3+ children (N-ary). `H[H[a,b],c]` is a nested group.
- Focus marked with `*`, e.g. `H[A,B*]`. Order is identity order.
- Ratios shown only where load-bearing (e.g. `1/n` mover share).
- Actions are semantic (move/focus/send/float/maximize), not WM
  bindings; bindings differ per WM and are out of scope here.
- "no-op" means tree and focus unchanged. "TBD" means not established
  by the cited evidence; never read as a negative claim.
- Focus history means the per-domain MRU stack. Tests establish it by
  focusing windows in a stated order with focus moves before the action.
- Unspecified splits are equal, with no manual preselection, rules or
  minimum-size constraints. `S[A*,B]` means one tabbed tile, A active.
- Binary WMs cannot construct flat N-ary trees. For those rows use the
  same rectangles with a binary embedding and record that embedding;
  outcomes for the exact N-ary start remain TBD unless qualified.
- Startup fixtures below are proposed repeatable inputs, not recovered
  historical rectangles. Existing proof cells establish the policy,
  not a live execution of every new fixture. Rectangles are `(x,y,w,h)`
  in work-area-relative physical pixels, excluding decorations.

## WM profiles and config assumptions

| WM | Version / source | Config assumption |
|---|---|---|
| COSMIC (cosmic-comp) | User-tested version/config unknown; source `3d55cba0` (commit date 2026-10-01) | Prospective tests: tiled mode, ordinary admission without explicit direction; record orientation/gaps |
| Hyprland | Docs baseline `v0.56.2`; separate source `19fb395d` (commit date 2026-10-04) | Prospective tests: Dwindle (`general:layout`), preserve_split=false, force_split=0 follow_mouse, smart_split=false, split_width_multiplier=1, use_active_for_splits=true, default_split_ratio=1, split_bias=0 directional, permanent_direction_override=false, precise_mouse_move=false, no preselect; semantic directional move (not swap), send follows (not silent), window_direction_monitor_fallback=true; group auto_group=true (join-only), group_on_movetoworkspace=false; size_limits_tiled=false; ordinary config, no custom rules (defaults evidenced `S(S-hyp-defaults)`); Master needs a separate profile |
| bspwm | Docs baseline `0.9.12`; separate source `e11eff4` (commit date 2026-01-08) | Prospective tests: tiled, automatic_scheme=longest_side, initial_polarity=second_child, split_ratio=0.5, honor_size_hints=false; directional swap via `node -s DIR --follow`, send via `node -d N --follow` |
| i3 | Local checkout `903bcd51` (2026-09-21) | Prospective tests: splith unless fixture-directed, no custom workspace/window rules; semantic `move <direction>` vs separate `swap`, native `move to workspace` is no-follow (`S(S-i3-move)` + `S(S-i3-movews)`); no implicit maximize/workspace float mode (`S(S-i3-max)` + `S(S-i3-wsmode)`); tiled-drag producer conditional/TBD where stated (shipped `etc/config` `tiling_drag modifier titlebar` vs code default modifier-only); semantic gestures, not literal keys |
| xmonad | Local checkout `284dd52c9c957cab6b6e5cc7580f2a63dafa00a7` (2026-10-03); contrib `5097a457e7a409bc9a7584dc5aa82b34c69d6dda` (2026-10-03) | Prospective tests: core `Tall nmaster=1 ratio=1/2 delta=3/100`, layout choice (Tall, Mirror Tall, Full) with Tall active; core keys stack focus (`focusUp`/`focusDown`/`focusMaster`) and stack swap (`swapUp`/`swapDown`/`swapMaster`) only, no directional core verb; workspace send is `StackSet.shift`/`shiftWin` via `insertUp`/`delete'` with source view unchanged (no view/follow); manage is `Operations.manage` `insertUp` plus fixed-size/transient float only, core `manageHook` MPlayer-only, core `handleEventHook` default-true; directional focus/move is contrib `Navigation2D` `windowGo`/`windowSwap` with `withNavigation2DConfig def` (tiled hybrid line/side, float center, screen line, no custom layout, wrap False; tiled/float separate layers, miss is no-op); EWMH is `ewmh` + `ewmhFullscreen` with `fullscreenEventHook` and default `fullscreenHooks` (`doFullFloat`/`doSink`), no fullscreen manage hook (admission itself tiles; fullscreen is post-map `ClientMessage` only); no tab stacks, no sticky, no maximize state, no workspace tiling toggle in this profile; tree fixtures may be inapplicable (Tall is flat master/stack, not N-ary H/V) |
| sway | Local checkout `1652c54b` (2026-09-21; describe `1.11-rc2-165-g1652c54b`) | Prospective tests: shipped `config.in`, no custom rules (`default_orientation` unset `L_NONE`, `workspace_layout` default); manual `splith`/`splitv` (`$mod+b`/`$mod+v`), layout toggle styles; fixture-directed splits, new-workspace layout follows output geometry (H unless portrait output); semantic `move <direction>` vs separate `swap container with ...`; native `move ... to workspace` is no-follow (source-inactive refocus), independent `workspace` command switches; `S(S-sway-default)` + `S(S-sway-wsdefault)` + `S(S-sway-move)` + `S(S-sway-movews)` + `S(S-sway-switch)` |
| qtile | Local checkout `83c697a5` = tag `v0.37.1` (2026-09-20) | Prospective tests: shipped `default_config.py`, initial active layout Columns (`layouts[0]`), Max available; `S(S-qti-default)` |
| awesome | Local checkout `0a5e50cf` (2026-08-28; describe `v4.3-1751-g0a5e50cf`) | Prospective tests: shipped `awesomerc.lua`, initial tag layout floating (`layouts[1]`); tile/fair/spiral/max available via inc; outcomes TBD; `S(S-awe-default)` |
| Ours KDE | Current `kwin/` adapter + shared Engine (`cosmic_v1`) | `per-output-local` default; gaps 8/8 |
| Ours Windows | Current `tiler-windows` + shared Engine | One 2560x1440 output, DPI 120/125%, gaps 8 |

Existing user tests often have unknown tested versions/config. Where
the tested version is unknown this file says so; today's source pins
are never applied retroactively to user-test cells.

## Evidence tags

Per-cell tags, kept terse via citation keys (legend below):

- `UT(date)` user-tested on that date (repo explicitly records the
  user ran that test). `UT(date-unrecorded)` where the repo records a
  user test but no date. Tested WM versions/config are unknown unless
  the source says otherwise. The 2026-08-20 date is repo-evidenced in
  `D-ref` (`[C-OBS-1]` screenshots, `[C-OBS-3]` transcript); the
  2026-08-22 date comes from screenshot filenames quoted in `D-move`
  Tests A-C.
- `S(key)` source read at a pinned commit, `key` maps to
  repo:path:line@commit in the legend.
- `D(key)` docs link/anchor, `key` maps to a repo doc path.
  This preserves the cited document's confidence level; an unverified
  community claim is not upgraded by copying it here. Linked corpus
  steps without UT are documentation evidence, not user tests.
- `TBD` unknown source behavior; stays TBD until evidenced.
- Mixed cells count once per evidence class present (e.g. a cell with
  `UT+S` counts 1 user-tested and 1 source).

Legend:

- `S-cos-add` cosmic-comp:src/shell/layout/tiling/mod.rs:219-244
  (`add_window`) @3d55cba0
- `S-cos-rem` cosmic-comp:src/shell/layout/tiling/mod.rs:255-282
  (`remove_window`) @3d55cba0
- `S-cos-last` cosmic-comp:src/shell/layout/tiling/mod.rs:417-433
  (`last_active` resolved at admission, then `map_to_tree`) and :2826-2845
  (`last_active_window` matches the MRU-first focus entry present in the
  tree) @3d55cba0
- `S-cos-axis` cosmic-comp:src/shell/layout/tiling/mod.rs:548-616
  (ordinary admission splits the selected leaf's long edge; no-focus
  fallback splits root using output dimensions) @3d55cba0
- `S-cos-seq` cosmic-comp:src/shell/workspace.rs:1441-1452
  (`set_tiling` maps floating windows sequentially) @3d55cba0
- `S-cos-zone` cosmic-comp:src/shell/layout/tiling/mod.rs:96-103
  (`TargetZone` zone names only) @3d55cba0
- `S-cos-stack` cosmic-comp:data/keybindings.ron:84 (Super+S
  `ToggleStacking`) + src/shell/layout/tiling/mod.rs:2132-2160
  (focused window converts to a single-tab stack, focus appended) and
  :2161-2250 (stack splits back to tiles) and :2260-2330
  (group-focused branch converts the whole group into one stack, first
  pre-order surface initially active) +
  src/shell/element/stack.rs:156-180 (`CosmicStack::new` sets active tab 0)
  and :325-375 (`handle_focus` steps the active tab on Focus Left/Right)
  @3d55cba06c9cf6f27609cdefb520f7857dba20af
- `S-cos-drop` cosmic-comp:src/shell/layout/tiling/mod.rs:1383-1400
  (`unmap_as_placeholder` stores `InitialPlaceholder` so a no-move drop
  restores the source slot) and :2677-2800 (`drop_window` zone branches
  GroupEdge/GroupInterior/WindowSplit/WindowStack plus fresh-map fallback)
  and src/shell/layout/floating/mod.rs:717-740 (floating drop with
  hovered-stack join) @3d55cba06c9cf6f27609cdefb520f7857dba20af
- `S-cos-dragstart` cosmic-comp:src/shell/mod.rs:3779-3814
  (`move_request`; client-initiated sub-pixel moves defer to a Delayed
  grab) and :4017-4030 (tiling grabs open overview mode, `Focus::Clear`)
  + src/shell/element/window.rs:743-770 (title-bar `DragStart` enters the
  same `NoMouseButtons` path) + src/input/mod.rs:928-960,1036
  (Super+Left enters move, press focuses the target)
  @3d55cba06c9cf6f27609cdefb520f7857dba20af
- `S-cos-dragesc` cosmic-comp:src/input/mod.rs:2356-2364 (pointer-grab
  detection includes `MoveGrab`) and :2525-2543 (bare Escape intercepts to
  `PrivateAction::Escape`) + src/input/actions.rs:80-98 (Escape unsets
  pointer/keyboard grabs and clears overview/resize) +
  src/shell/grabs/moving.rs:656 (`PointerGrab::unset` is a no-op) and
  :901-960 (`impl Drop for MoveGrab` runs the normal `drop_window`
  resolution when the grab is dropped, so Escape drops rather than cancels)
  @3d55cba06c9cf6f27609cdefb520f7857dba20af
- `S-cos-dragthresh` cosmic-comp:src/shell/grabs/delay.rs:82-84
  (Delayed pointer grab activates at 1px motion distance) +
  `S(S-cos-dragstart)` client-defer branch and `S(S-cos-drop)`
  no-move-restore branch @3d55cba06c9cf6f27609cdefb520f7857dba20af
- `S-cos-dragframe` cosmic-comp:src/shell/grabs/moving.rs:100-145
  (tiling mover rescales 0.6->1.0 over 150ms, 0.4 alpha on other outputs;
  render translates the retained window geometry by location+offset)
  and :474-492 (`StackHover` indicator) and :386-421 (pointer motion
  writes `grab_state.location`; per-output tracking, outside all outputs
  leaves cursor output/location unchanged)
  and :902-1080 (`Drop` lands in the cursor output's space and focuses the
  dropped mapped) @3d55cba06c9cf6f27609cdefb520f7857dba20af
- `S-cos-dragpress` cosmic-comp:src/input/mod.rs:881-887 (pointer press
  changes keyboard focus unless the pointer is grabbed) + `S(S-cos-dragstart)`
  (Super+Left press focuses the move target)
  @3d55cba06c9cf6f27609cdefb520f7857dba20af
- `S-cos-ctl-tile` cosmic-comp:cosmic-comp-config/src/lib.rs:88-95
  (`autotile` + `TileBehavior` Global/PerWorkspace) +
  src/shell/mod.rs:1468-1512 (`update_autotile[_behavior]` sets
  `tiling_enabled`; Global retoggles existing workspaces) and :632-648
  (new workspaces inherit the set's `tiling_enabled`)
  @3d55cba06c9cf6f27609cdefb520f7857dba20af
- `S-cos-syscmd` cosmic-settings-daemon:config/src/shortcuts/mod.rs:53-76
  (`system_actions` merges system then user config) +
  data/system_actions.ron:52-55 (`WindowSwitcher: "cosmic-launcher
  alt-tab"`, `WindowSwitcherPrevious: "cosmic-launcher shift-alt-tab"`,
  `WorkspaceOverview: "cosmic-workspaces"`)
  @e37160f14d1e7ee428f973cd2848b4e95f83dfe1
  (pin from cosmic-comp `Cargo.lock`)
- `S-lch-altab` cosmic-launcher:src/app.rs:74-77 (`AltTab`/`ShiftAltTab`
  tasks) and :783-816 (Tab stepping, Alt-release activates the focused
  item) and :474-477 + src/subscriptions/launcher.rs:114-116 (activation
  forwards `Activate(item)` to the pop-launcher service)
  @49d11203116c43419d2b64844ac5c457124a8571
- `S-pop-toplevel` launcher:plugins/src/cosmic_toplevel/mod.rs:186-218
  (empty-query search appends every tracked toplevel, no
  workspace/visibility filter) and :145-160 (`Activate(id)` forwards the
  foreign handle) + plugins/src/cosmic_toplevel/toplevel_handler.rs:171-181
  (`Activate` calls `manager.activate` on the cosmic toplevel for each seat)
  @6390080a98a4a59b4e8196d28de97d3cb4d138ec
  (pin from cosmic-launcher `Cargo.lock`)
- `S-cos-topact` cosmic-comp:src/wayland/handlers/toplevel_management.rs:31-99
  (`activate` unminimizes, locates the window across all outputs/spaces,
  switches to its workspace via `shell.activate`, focuses it; sticky branch
  focuses in place) @3d55cba06c9cf6f27609cdefb520f7857dba20af
- `S-cos-dropzone` cosmic-comp:src/shell/layout/tiling/mod.rs:3436-3462
  (drop geometries from the work-area `non_exclusive_zone`, contains-walk)
  and :3416-3423 (hover cleared when overview is inactive or the pointer
  reports no location) and :3632-3640 (no containing geometry yields no
  zone) and :2789-2800 (`drop_window` with no hover fresh-maps via
  `map_to_tree`)
  @3d55cba06c9cf6f27609cdefb520f7857dba20af
- `S-cos-dragedge` cosmic-comp:src/shell/layout/tiling/mod.rs:3660-3707
  (centre-thirds stack region, else nearest-edge `WindowSplit` direction)
  + src/shell/mod.rs:3915-3922 (grabbed tiled source unmaps to a
  `GrabbedWindow` placeholder holding its slot) + src/input/mod.rs:908-913
  (Super-held press is suppressed, never passed to the client)
  @3d55cba06c9cf6f27609cdefb520f7857dba20af
- `S-cos-shortcut` cosmic-settings-daemon:config/src/shortcuts/action.rs:15-16
  (`Disable` masks a default binding) + config/src/shortcuts/mod.rs:91-99
  (user `custom` overlays system `defaults`) + cosmic-comp:src/config/mod.rs:262-285
  (compositor loads and hot-reloads `shortcuts`/`system_actions` on config change)
  @e37160f14d1e7ee428f973cd2848b4e95f83dfe1 for the daemon paths
  (pin from cosmic-comp `Cargo.lock`),
  @3d55cba06c9cf6f27609cdefb520f7857dba20af for cosmic-comp
- `S-hyp-moveswap`
  Hyprland:src/config/shared/actions/ConfigActions.cpp:549-563
  (`moveInDirection` delegates to layout) and :565-583
  (`swapInDirection` errors with no target) @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-hyp-movews`
  Hyprland:src/config/shared/actions/ConfigActions.cpp:380-437
  (`moveToWorkspace` silent source-refocus vs follow workspace-switch+mover-focus;
  :150-166 explicit find-or-create workspaces, no trailing-empty semantic) +
  src/state/workspace/Resolver.cpp:324-331 (numeric `0` is an invalid
  workspace ID) +
  src/desktop/state/GlobalWindowController.cpp:38-80 (transfer: float
  monitor-relative retain, `group_on_movetoworkspace=false` gate, `newTarget`
  re-admission) + src/layout/target/Target.cpp:20-35
  (`assignToSpace` had-space move path) + src/layout/space/Space.cpp:50-59 +
  src/layout/algorithm/Algorithm.cpp:62-78 (move vs add dispatch) +
  src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.cpp:67-107,262-266
  (re-admission anchor: active window on that workspace else mouse
  closest-node; a sole tiled window is the only candidate regardless of
  cursor) +
  src/layout/algorithm/floating/default/DefaultFloatingAlgorithm.cpp:127-182
  (float workspace move retains monitor-relative position)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-hyp-pin`
  Hyprland:src/config/shared/actions/ConfigActions.cpp:286-294
  (`pinWindow` float-only guard) @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-hyp-ins`
  Hyprland:src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.cpp:28-61
  (`preserve_split=false` recomputes split axis from parent geometry) and
  :63-107 (anchor: mouse-hit window on the active workspace, else active tiled
  window via `use_active_for_splits`, else first/closest node) and :146-160
  (parent-geometry long-edge axis via `split_width_multiplier`) and :213-229
  (`force_split=0` follow_mouse orders newcomer by pointer half) and :244-260
  (initial half-boxes plus geometry recalc)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-hyp-move`
  Hyprland:src/layout/LayoutManager.cpp:136-147 (delegates to space) +
  src/layout/algorithm/ModeAlgorithm.cpp:26-54 (1px-beyond-edge focal point) +
  src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.cpp:558-610
  (remove + reinsert at focal point; direct single-window split-partner
  override; silent refocuses old position; off-monitor focal with
  `binds:window_direction_monitor_fallback` crosses monitors) and :85
  (the ordering cursor is the override focal while a move sets it) and
  :262-266 (`movedTarget` carries the focal as that override) and
  :213-229 (`force_split=0` orders the mover by that focal half) +
  src/state/MonitorQueryCore.cpp:64-66,99-131 (vec-only query returns the
  containing else nearest monitor, so a single-output off-edge focal resolves
  to the same monitor) +
  src/config/values/ConfigValues.cpp:626-627 (fallback defaults true)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-hyp-newfocus`
  Hyprland:src/desktop/view/window/Window.cpp:1481-1520 (ordinary newcomer
  takes focus unless no-focus rule/state, layer grab, or workspace/monitor
  silent) and :1553-1559 (silent restores the previous focus)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-hyp-group`
  Hyprland:src/desktop/view/window/Window.cpp:1436-1447 (`group:auto_group`
  joins the focused window's existing group on ordinary open, never creates) +
  src/desktop/view/Group.cpp:97-173 (`add` inserts after current by default
  and makes the newcomer current) +
  src/config/shared/actions/ConfigActions.cpp:1783-1819
  (`moveIntoOrCreateGroup` needs a directional neighbor; creates a group on it
  first) and :1338-1354 (join helper focuses the mover) +
  src/config/values/ConfigValues.cpp:502,510,514 (`insert_after_current=true`,
  `auto_group=true`, `group_on_movetoworkspace=false`)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-hyp-defaults`
  Hyprland:src/config/values/ConfigValues.cpp:179 (`general:layout=dwindle`)
  and :763-774 (`dwindle:force_split=0` follow_mouse, `preserve_split=false`,
  `smart_split=false`, `permanent_direction_override=false`,
  `split_width_multiplier=1`, `use_active_for_splits=true`,
  `default_split_ratio=1`, `split_bias=0` directional,
  `precise_mouse_move=false`) and :626-627
  (`binds:window_direction_monitor_fallback=true`) and :502-504,510-511
  (`insert_after_current=true`, `focus_removed_window=true`,
  `merge_groups_on_drag=true`, `auto_group=true`, `drag_into_group=1`)
  and :514 (`group_on_movetoworkspace=false`) and :629
  (`binds:drag_threshold=0`) and :604 (`misc:size_limits_tiled=false`)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-bsp-float` bspwm:doc/bspwm.1.asciidoc:355-356
  (floating uses no tiling space, stays in tree) @e11eff4
- `S-bsp-sticky` bspwm:doc/bspwm.1.asciidoc:368-369
  (sticky is monitor-desktop scoped) @e11eff4
- `S-bsp-bal` bspwm:doc/bspwm.1.asciidoc:454-458
  (`-E` equalize / `-B` balance) @e11eff4
- `S-bsp-ins` bspwm:doc/bspwm.1.asciidoc:706-719
  (`split_ratio`/`automatic_scheme`/`initial_polarity`) @e11eff4
- `S-bsp-swap` bspwm:doc/bspwm.1.asciidoc:424-428
  (`-n` send to node / `-s` swap nodes) @e11eff4
- `S-bsp-move` bspwm:doc/bspwm.1.asciidoc:436-437
  (`-v` moves by pixels) @e11eff4
- `S-bsp-send` bspwm:doc/bspwm.1.asciidoc:418-422
  (`-d` send to desktop / `-m` send to monitor) @e11eff4
- `S-bsp-hint` bspwm:doc/bspwm.1.asciidoc:819-820
  (`honor_size_hints` defaults false) @e11eff4
- `S-bsp-insert` bspwm:src/tree.c:291-380 (`insert_node` automatic
  split at the anchor: longest-side axis from the anchor rectangle,
  newcomer second child under `second_child`) and src/window.c:74-82,166
  (ordinary admission anchors at the desktop focus) and :210-222
  (ordinary newcomer takes focus) @e11eff4cb3333216ad03c815609a4ed79e08929c
- `S-bsp-xfer` bspwm:src/tree.c:1629-1652 (`transfer_node` unlinks with
  sibling promotion and inserts at the destination focus) and
  src/messages.c:180-186,255-261 (`-d`/`-s` with `--follow` dispatch)
  @e11eff4cb3333216ad03c815609a4ed79e08929c
- `S-bsp-state` bspwm:src/tree.c:1945-1982 (`set_floating`/`set_fullscreen`
  toggle vacant in place: tree slot kept, no focus write) and :2151-2184
  (`set_sticky` has no float-only guard; off-desktop sticky transfers to
  the focused desktop) @e11eff4cb3333216ad03c815609a4ed79e08929c
- `S-bsp-layout` bspwm:doc/bspwm.1.asciidoc:350-360 (floating/fullscreen
  are per-window states) and :505 (desktop layout is tiled/monocle only)
  @e11eff4
- `S-xmo-ins` xmonad:src/XMonad/StackSet.hs:484-486 (`insertUp`
  above focus) @284dd52c9c957cab6b6e5cc7580f2a63dafa00a7
- `S-xmo-shift` xmonad:src/XMonad/StackSet.hs:572-585 (`shiftWin`
  via `insertUp`/`delete'`) @284dd52c9c957cab6b6e5cc7580f2a63dafa00a7
- `S-sway-default` sway:config.in:142-151 (shipped default
  `splith`/`splitv` on `$mod+b`/`$mod+v`, `layout stacking`/`tabbed`/`toggle split`)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-sway-ins` sway:sway/tree/view.c:848-901 (admission anchors on the
  seat focus-inactive node: `container_add_sibling` after the focused
  tiling sibling, `workspace_add_tiling` fallback) and :696-730,944-955
  (`should_focus` gate: active-workspace, no `no_focus` match; ordinary
  newcomer takes focus) @1652c54b73f67df17b7b4ab0b0f7048204aa8104
  (ordinary admission inserts after focus; no geometry-driven axis)
- `S-sway-split` sway:sway/commands/split.c:12-24 (`do_split` via
  `container_split`/`workspace_split`) and sway/tree/container.c:1565-1621
  (`container_split`: singleton H/V containers re-layout instead of
  nesting) and sway/tree/workspace.c:1058-1079 (`workspace_split`)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-sway-layout` sway:sway/commands/layout.c:11-22 (`layout tabbed`/
  `stacked` parse) and :117-199 (operates on the parent split like i3;
  single-child flatten, workspace wrap for new containers)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
  (tabbed/stacked are parent split layouts holding tabs)
- `S-sway-move` sway:sway/commands/move.c:112-166
  (`container_move_to_container_from_direction`: same-parent same-workspace
  sibling swap, cousin promotion, parallel/perpendicular reparent) and
  :301-415 (`container_move_in_direction`: lone-workspace force-wrap,
  singleton-child workspace-level fallback mirroring i3, promotion insert;
  off-edge falls through to next-output) and :672-711
  (`cmd_move_in_direction`: floating movers shift the frame by 10px default,
  retaining floating) and sway/commands/swap.c:37-63
  (`swap container with id|con_id|mark` is a separate explicit-target verb)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
  (semantic `move <direction>` keeps focus on the mover)
- `S-sway-cleanup` sway:sway/tree/container.c:525-555
  (`container_reap_empty` destroys empty-only cons; single-child wrappers
  persist; explicit `container_flatten` only) and :1727-1773
  (`container_squash` merges only redundant H/V pairs) and
  sway/commands/move.c:410-412,612-614,722-724 (reap/consider-destroy after
  moves) @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-sway-movews` sway:sway/commands/move.c:198-275
  (`container_move_to_workspace`: floating movers stay floating with
  coordinate fix, tiled movers append; `container_move_to_container`:
  attach after the destination) and :470-480 (`move to workspace number`
  targets explicit workspaces, no trailing-empty/`0` shortcut) and :516-517
  (workspace destination resolves via focus-inactive tiling only) and
  :599-608 (mover focus restored to source inactive: no-follow, no switch)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
  (`move container to workspace` is no-follow; order is after the target focus)
- `S-sway-outmove` sway:sway/commands/move.c:277-298
  (`container_move_to_next_output` to the active workspace via directional
  attach) and sway/tree/output.c:316-331 (`output_get_in_direction` uses
  adjacent output only, NULL when none)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-sway-wsdefault` sway:sway/tree/output.c:441-450
  (`output_get_default_layout`: configured `default_orientation`, else
  V iff output taller than wide, else H) and sway/config.c:252-253
  (code defaults `default_layout`/`default_orientation` are `L_NONE`) and
  sway/tree/workspace.c:217-219 (new workspaces take the output default)
  and :939-995 (`workspace_add/insert_tiling` splits only under a configured
  `default_layout`) @1652c54b73f67df17b7b4ab0b0f7048204aa8104
  (shipped baseline: geometry-following workspace layout, no auto-split)
- `S-sway-switch` sway:sway/tree/workspace.c:731-743 (`workspace_switch`
  is the independent switch verb, focusing the target's focus-inactive node;
  never called by the move-to-workspace path)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-sway-wsmode` sway:sway/commands/workspace_layout.c:5-18
  (`workspace_layout` values default/stacking/tabbed only, no tiling on/off)
  and sway/tree/container.c:955-965 (`container_set_floating` is per-window)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-sway-float` sway:sway/tree/container.c:910-931
  (`container_floating_set_default_size`: half-width/three-quarter-height
  clamped to config floating min/max) and :864-908
  (`container_floating_resize_and_center`: center on workspace/output) and
  :955-1030 (`container_set_floating`: float detach+reap, unfloat after
  focus-inactive tiling with fractions reset, no old-slot restore) and
  sway/commands/floating.c:14-59 (toggle dispatch, scratchpad guard) and
  sway/config.c:266-269 (floating max auto, min 75x50)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-sway-sticky` sway:sway/commands/sticky.c:15-49 (`sticky` sets
  `is_sticky` unconditionally, moves to the active workspace floating list
  only when sticky-or-child) and sway/tree/container.c:1705-1711
  (`container_is_sticky` requires floating)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-sway-focus` sway:sway/commands/focus.c:138-224
  (`node_get_in_direction_tiling`: sibling walk only, fullscreen drops to
  outputs) and :226-271 (`node_get_in_direction_floating`: center-delta
  search among workspace floats only, wrap to furthest opposite) and
  :473-479 (floating subjects use float search, tiled use tile search)
  and sway/commands/focus_wrapping.c:6-19 + sway/config.c:274
  (default `WRAP_YES`) @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-sway-full` sway:sway/tree/container.c:1200-1232
  (workspace-fullscreen sets `ws->fullscreen` and focuses, tree retained)
  and :1260-1341 (disable clears mode; `container_set_fullscreen` swaps
  existing workspace/global fullscreen) and sway/commands/fullscreen.c:12-58
  (no refusal branch) and sway/desktop/xdg_shell.c:395-424 +
  sway/desktop/xwayland.c:608-620 (client fullscreen converges on the same
  mode path) @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-sway-max` sway:sway/commands.c:118-129 (command inventory: `exit`/
  `reload`, no maximize verb) and sway/desktop/xdg_shell.c:385-393
  (maximize request only schedules a configure, no mode change) and
  :228-235 + sway/desktop/xwayland.c:310-340 (`wants_floating` is fixed-size
  min==max or dialog/parent/type only)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-sway-min` sway:sway/tree/arrange.c:15-98,100-183 (fraction normalize +
  10px zeroing bound at :91-95,177-180; `MIN_SANE` 100x60 gap reservation
  only per include/sway/tree/node.h:8-9; no client-hint consult) and
  sway/tree/view.c:260-271 + sway/desktop/xdg_shell.c:149-157 +
  sway/desktop/xwayland.c:382-399 (per-protocol min/max getters) and
  sway/tree/view.c:908 (float admission evaluated at map) +
  sway/desktop/xwayland.c:756-775 (runtime hint path handles urgency only,
  no re-admission) and sway/tree/container.c:793-830
  (float clamp is config `floating_min/maximum_size`, not client hints) and
  sway/input/seatop_resize_floating.c:77-96 (client hints enforced on
  floating resize only) @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-sway-close` sway:sway/input/seat.c:234-325 (destroyed-node focus falls
  to the focus-inactive view of the parent, else workspace/last workspace)
  and :219-232 + :1378-1393 (focus-inactive is MRU order) and
  sway/tree/view.c:991-1006 (unmap detaches, reaps empty parent, rearranges)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-sway-reload` sway:sway/commands.c:118-129 (`reload` + `exit`, no
  `restart` verb) and sway/commands/reload.c:15-34,54-71 (in-place config
  reload, not a process restart)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-sway-bind` sway:sway/commands.c:47,50,94,97
  (`bindsym`/`bindcode`/`unbindsym`/`unbindcode` registration) and
  sway/commands/bind.c:579-594 (bind/unbind definition dispatch)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
  (binding definition/removal only; no staging/Compatible/Apply/Force/
  Disable/Revert or preimage model in the inspected command inventory)
- `S-sway-tray` sway:sway/commands/bar.c:31-34
  (`tray_bindcode`/`tray_bindsym`/`tray_output`/`tray_padding` registration) +
  sway/commands/bar/tray_output.c:8-27 + sway/commands/bar/tray_padding.c:8-33
  + sway/commands/bar/tray_bind.c:8-76 (`HAVE_TRAY` bar-hosted tray)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
  (bar-hosted tray; no owner notification-icon lifecycle in the inspected
  inventory)
- `S-sway-tdrag` sway:sway/config.c:283-284 (code defaults
  `tiling_drag` true, threshold 9; shipped `config.in` sets neither, so
  enablement is settled enabled) + sway/input/seatop_default.c:359-364
  (modifier vs titlebar producer predicates) and :439-456 (press focuses
  before drag begin) and :491-501 (tiling begin: titlebar thresholded vs
  modifier immediate; tiled non-fullscreen guard) +
  sway/input/seatop_move_tiling.c:60-82 (titlebar threshold scaled by
  output; indicator/cursor only after exceed) and :504-512 (modifier
  immediate begin) and :467-502 (begin keeps the source attached, clears
  pointer focus, no detach)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-sway-tdrop` sway:sway/input/seatop_move_tiling.c:182-216
  (layer-surface NULL and sole-child guards; empty-workspace box) and
  :218-241 (titlebar split vs source-titlebar cancel) and :243-290 (30px
  `DROP_LAYOUT_BORDER` layout-edge walk) and :292-330 (30% closest-edge
  else centre) and :349-431 (`finalize_move`: NULL abort, empty-workspace
  add, titlebar tabbed split+indexed insert, centre `container_swap` else
  edge split+insert, sibling-share adopt, reap/arrange; no seat focus
  write except via swap) + sway/tree/container.c:1857-1921
  (`container_swap` preserves mover focus on the same workspace) and
  sway/input/seat.c:1563-1570 (move-tiling seatop handles button/motion
  only; no automatic Esc/key-press revert path) and
  include/sway/input/seat.h:17-50 (`sway_seatop_impl` has no keyboard
  callback) + sway/input/keyboard.c:433-591 (key dispatch runs
  bindings/compositor/client paths, no seatop path) and :267-285
  (compositor helper is VT-switch only) and :287-315 (pointer-keysym
  helper maps mouse-keys keysyms/motion only) +
  sway/input/cursor.c:206-230 (key press only drives hide-when-typing) +
  sway/input/seatop_move_tiling.c:459-465 (impl is button/pointer-motion/
  tablet-tip/unref/end only)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-qti-default` qtile:libqtile/resources/default_config.py:101-103
  (shipped `layouts = [Columns(...), Max()]`, initial active Columns)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-add` qtile:libqtile/layout/columns.py:132-152
  (split/num_columns/insert_position/wrap/align/initial_ratio defaults) and :266-276
  (`add_client` new-column/focused-position admission) + libqtile/layout/base.py:275-303
  (`_ClientList.add_client` insert at current, newcomer focused) + libqtile/group.py:226-244
  (`add` float-rule match, tiled layouts admit, newcomer focused when stealable)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-focus` qtile:libqtile/layout/columns.py:142-144 (wrap defaults) and :385-450
  (`left`/`right` column step, `up`/`down` in-column step, `next`/`previous`; tiled columns only)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-shuffle` qtile:libqtile/layout/columns.py:452-506
  (`shuffle_left`/`shuffle_right` carry across columns or split a shared edge column,
  sole-column sole window no-op; `shuffle_up`/`shuffle_down` reorder in-column only)
  + :173-191 (`swap` exchanges two clients with heights)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-remove` qtile:libqtile/layout/columns.py:278-288
  (`remove` drops emptied columns, returns current) + libqtile/layout/base.py:317-330
  (`_ClientList.remove` positional current adjust) + libqtile/group.py:246-302
  (`remove` floating vs tiled next-focus, close refocus when the closed window had focus)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-group` qtile:libqtile/backend/x11/window.py:1946-1987
  (`togroup` hide, source `remove`, target `add`, `switch_group` follows via `toscreen`)
  + libqtile/backend/wayland/window.py:526-571 (same transfer path)
  + libqtile/resources/default_config.py:75-98 (groups 1-9, `togroup` with `switch_group=True`)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-float` qtile:libqtile/backend/x11/window.py:1712-1769
  (floating setter keeps tile frame, `toggle_floating` flips) + libqtile/group.py:304-332
  (`mark_floating` removes from layouts on float, re-adds via `add_client` on unfloat)
  + libqtile/layout/floating.py:14-30,82-84 (default float rules incl fixed-size) and :169-204
  (unplaced floats center)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-fs` qtile:libqtile/backend/x11/window.py:1789-1800
  (`fullscreen` float state) and :2221-2236 (`toggle_maximize`/`toggle_fullscreen`)
  + libqtile/backend/base/window.py:262-285 (`maximized` float state at work-area size)
  + libqtile/group.py:231-232 (`auto_fullscreen` admission)
  + libqtile/backend/x11/window.py:1758-1766
  (`wants_to_fullscreen`) + libqtile/backend/wayland/window.py:432-433
  (native `handle_request_maximize` drives the maximized state)
  + libqtile/backend/x11/window.py:636-654 (`update_state` syncs
  urgent/fullscreen only, not maximized) and :2083-2101 (client
  `_NET_WM_STATE` messages echoed to the property only, no maximized drive)
  + libqtile/resources/default_config.py:47-55
  (`Mod+f` fullscreen, `Mod+t` floating)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-drag` qtile:libqtile/backend/x11/window.py:2238-2250
  (unbound tiled `set_position`: floating tweaks frame, tiled swaps with the
  window under the pointer) and :2203-2205 (shipped `set_position_floating`
  floating tweak) + libqtile/backend/wayland/window.py:841-856 (same swap
  policy) and :837-839 (same floating tweak)
  + libqtile/resources/default_config.py:172-176 (shipped `Mod+Button1` move
  binds `set_position_floating`, `Mod+Button3` resize)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-layout` qtile:libqtile/layout/max.py:31-51 (only the focused window shown)
  + libqtile/core/manager.py:1274-1303 (`next_layout`/`prev_layout` rotation)
  + libqtile/resources/default_config.py:47,101-103 (`Mod+Tab` rotates; `Max` available)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-reload` qtile:libqtile/core/manager.py:326-345 (`reload_config`
  rebuilds groups/screens from config) and :1553 (`shutdown`)
  + libqtile/core/state.py:23-40 (dump carries groups/layouts/screens/
  scratchpads only, no per-window float state)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-close` qtile:libqtile/group.py:246-302 (`remove` MRU-gated
  `previous_win`, floating vs tiled next-focus, close refocus when the closed
  window had focus) + libqtile/resources/default_config.py:198 (shipped
  `focus_previous_on_window_remove=false`)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-split` qtile:libqtile/layout/columns.py:71-80 (split/stacked column
  modes) and :380-383 (`toggle_split` flips the current column) +
  libqtile/resources/default_config.py:101-115 (profile layouts Columns plus
  Max only) @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-tweak` qtile:libqtile/backend/x11/window.py:1850-1880 (`tweak_float`
  frame write plus closest-screen transfer) and :1890-1926
  (`_reconfigure_floating` FLOATING plus `mark_floating`) +
  libqtile/resources/default_config.py:172-176 (shipped Drag binds
  `set_position_floating`/size) and :180-182 (`follow_mouse_focus` true,
  `bring_front_click` false)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-state` qtile:libqtile/core/manager.py:293-313 (`restart` dumps
  `QtileState`, backend-gated) and :326-352 (`reload_config` rebuilds
  groups/screens from config) and :1553 (`shutdown`) +
  libqtile/core/state.py:23-40 (state carries groups/layouts/screens/
  scratchpads only) + libqtile/backend/base/core.py:23 (restart supported by
  default) and libqtile/backend/wayland/core.py:242 (Wayland opts out)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-min` qtile:libqtile/backend/x11/window.py:553-564 (fixed-size is
  min==max only) and :805-815 (`place` `respect_hints` defaults false) and
  :860-889 (hint clamp only when requested) +
  libqtile/layout/columns.py:312-323 (tiled place without hints) +
  libqtile/layout/floating.py:240-249 (float place `respect_hints=true`) +
  libqtile/backend/wayland/window.py:189-192 (`respect_hints` TODO)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-keys` qtile:libqtile/config.py:25 (`Key` static definition) +
  libqtile/core/manager.py:569-599 (grab/ungrab/regrab keys) +
  libqtile/resources/default_config.py:13-59 (static key list; reload/shutdown
  bound, no restart binding, no first-run/preset/staging verbs)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-tray` qtile:libqtile/widget/systray.py:68-104 (bar-hosted Systray,
  `supported_backends` x11 only; hosts client icons, no owner icon lifecycle)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-qti-wsdef` qtile:libqtile/resources/default_config.py:75-99 (static
  groups 1-9 plus togroup bindings) and :184-196 (global `floating_layout`
  rules, `auto_fullscreen`; no per-group tiling default)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-awe-default` awesome:awesomerc.lua:83-98 (`request::default_layouts`
  with `suit.floating` first) + :134 (tags use `awful.layout.layouts[1]`,
  so initial tag layout is floating)
  @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
- `S-cos-min` cosmic-comp:src/shell/layout/tiling/mod.rs:3119-3128,3183-3185
  and src/shell/layout/mod.rs:46-52 @3d55cba06c9cf6f27609cdefb520f7857dba20af
  (tile allocation/cropping without minimum enforcement; fixed-size admission floats)
- `S-cos-bornmax` cosmic-comp:src/shell/mod.rs:3001-3022,4461-4500
  and src/shell/workspace.rs:1002-1043 @3d55cba06c9cf6f27609cdefb520f7857dba20af
  (newcomer tiles then requested maximum overlays retained slot;
  preceding unmaximize loop targets other existing maxima)
- `S-hyp-min` Hyprland:src/layout/target/WindowTarget.cpp:236-247
  and src/config/values/ConfigValues.cpp:604 @19fb395d45314960e6f79f17994a84094f1cd4f6
  (tiled size limits default off; opt-in size clamp/recenter, not auto-float)
- `S-hyp-bornmax` Hyprland:src/desktop/view/window/Window.cpp:883-897,1230-1233,1527-1562
  @19fb395d45314960e6f79f17994a84094f1cd4f6
  (pending client maximum consumed/applied at map)
- `S-hyp-float`
  Hyprland:src/config/shared/actions/ConfigActions.cpp:236-267
  (`floatWindow` toggle via `changeFloatingMode`, no refusal branch) +
  src/layout/LayoutManager.cpp:32-53 (`changeFloatingMode` clears then
  re-applies fullscreen around the toggle) +
  src/layout/space/Space.cpp:117-125 (`toggleTargetFloating` flips
  `wasTiling`) + src/layout/algorithm/Algorithm.cpp:17-39,62-94
  (per-window float dispatch for add/move/set; no workspace tiling flag) +
  src/layout/algorithm/floating/default/DefaultFloatingAlgorithm.cpp:158-182,217-220
  (`wasTiling` center retain with last size; remembers size on remove) +
  src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.cpp:262-310
  (unfloat re-admits via `addTarget` anchor; float removal promotes the
  sibling and recalculates) + src/layout/target/WindowTarget.cpp:285-295
  (`setFloating` clears pinned) + src/desktop/view/window/Window.cpp:1026-1038,1220-1222
  (`suggestsFloat`: traits or min==max hint; applied at initial map)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-hyp-fs`
  Hyprland:src/config/shared/actions/ConfigActions.cpp:338-378
  (`fullscreenWindow` toggle/set with internal/client modes) +
  src/managers/fullscreen/FullscreenController.cpp:292-421
  (`setFullscreenMode` internal/client/pinned handling) +
  src/managers/fullscreen/handler/FullscreenHandler.cpp:93-127,129-148,191-217
  (`FULLSCREEN` covers the monitor box, `MAXIMIZED` covers the work area;
  float size remembered on entry; exit leaves placement to recalc) +
  src/desktop/view/window/Window.cpp:848-897 (client fullscreen/maximize
  routes to `setFullscreenMode`, pending when unmapped, echo swallow) and
  :1498-1545 (map applies requested FS and replaces existing workspace FS)
  + src/desktop/view/window/WindowFullscreenPolicy.cpp:29-47,58-64
  (pending request store/consume; maximize-echo guard)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-bsp-min` bspwm:src/tree.c:101-134,150-170 and src/window.c:699-701
  @e11eff4cb3333216ad03c815609a4ed79e08929c
  (opt-in leaf size-hint clamp on every reflow; constraint-fence wiring TBD)
- `S-bsp-admit` bspwm:src/rule.c:256-293 and src/tree.c:787-795
  @e11eff4cb3333216ad03c815609a4ed79e08929c
  (fullscreen state/fixed-size floating admission; maximum flags not admission state)
- `S-bsp-close` bspwm:src/tree.c:1337-1405 (`unlink_node` sibling promotion) and :1407-1421 (`close_node` delete/kill) and :1441-1474 (`remove_node` + focus guess) and :538-578 (`focus_node` history fallback) and src/history.c:171-180 (`history_last_node` MRU) @e11eff4cb3333216ad03c815609a4ed79e08929c
  (close removal + MRU refocus, no spatial rule)
- `S-bsp-drag` bspwm:src/window.c:487-545 (`move_client` tiled hover-swap vs float move, cross-monitor transfer) and src/pointer.c:58-68 (buttons grabbed with the modifier) and :248-307 (ACTION_MOVE grab/track, button-release end only) and src/events.c:40-89 (`handle_event` switch has no key-press cancel branch) @e11eff4cb3333216ad03c815609a4ed79e08929c
  (pointer drag swaps on hover; no zones/cancel/preview)
- `S-bsp-restore` bspwm:src/query.c:38-67 (`query_state` dump incl history/stack) and :116-183 (node/client dump incl sticky/state) and src/restore.c:111-162 (restart replaces monitors, restores history/stack) and :345-409 (node sticky restore) and :436-474 (client state restore) and src/bspwm.c:154-156 (startup `-s` restore) and :275-326 (restart dump + re-exec) and src/messages.c:1250-1263,1317-1320 (`-d`/`-l`/`-r` verbs) @e11eff4cb3333216ad03c815609a4ed79e08929c
  (restart persists sticky/state/focus)
- `S-bsp-fs` bspwm:src/messages.c:287-318 (`node -t --state` incl `~` alternate) and src/tree.c:1889-1943 (`set_state` last_state memory, vacant in place) and :1963-1987 (`set_fullscreen`) and src/events.c:474-490 (EWMH fullscreen ADD/REMOVE/TOGGLE with ignore gates) and src/settings.h:60 (default 0, honored both ways) @e11eff4cb3333216ad03c815609a4ed79e08929c
  (project toggle and EWMH converge; no refusal branch)
- `S-bsp-ctl` bspwm:src/messages.c:287-358 (node `-t` state incl `~` alternate, `-g` flags hidden/sticky/private/locked/marked only) and :1250-1327 (wm `-d` dump/`-l` load/`-a` add-monitor/`-O` reorder/`-o` adopt-orphans/`-g` status/`-h` history/`-r` restart only) @e11eff4cb3333216ad03c815609a4ed79e08929c
  (no preset/tray/binding-staging model in the inspected inventory)
- `S-i3-min` i3:src/render.c:43-124 (tiled `render_con` allocation
  with size-hint ignore note, no minimum clamp) and
  src/manage.c:461-474,528-533 (fixed-size min==max admission floats) and
  src/floating.c:76-130,187-229 (`floating_check_size` float-only min/max
  clamp) @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (tiled allocation unclamped; float clamp and fixed-size float admission separate)
- `S-i3-admit` i3:src/manage.c:139-143,402-421 and src/con.c:428-474,
  src/x.c:834-864 @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (fullscreen atom admission; maximize flags derived from layout)
- `S-xmo-admit` xmonad:src/XMonad/Operations.hs:90-124,328-335
  @284dd52c9c957cab6b6e5cc7580f2a63dafa00a7
  (core-only ordinary manage/tile path; configured hooks/contrib remain TBD)
- `D-move` [cosmic-move-conformance.md](../cosmic-move-conformance.md)
  (S1-S3 UT 2026-08-20, version unknown; S4-S23 authored observations;
  S1-17/S3-05 unconfirmed corrections)
- `D-ref` [reference-wm-comparison.md](../reference-wm-comparison.md)
  sections 1-10
- `D-ref11` [reference-wm-comparison.md section
  11](../reference-wm-comparison.md#11-directional-window-movement-with-no-candidate-window-cosmic)
  (COSMIC move model; bspwm/Hyprland move notes unverified tier)
- `D-prof`
  [reference-wm-profile-support.md](../research/reference-wm-profile-support.md)
  (pins v0.56.2 / 0.9.12 / v50.0.1, 2026-09-17)
- `D-prior` [prior-art.md](../research/prior-art.md) (2026-10-03
  inventory)
- `D-dec-ww` [decisions.md](../decisions.md#window-and-workspace-behavior)
  ("Window And Workspace Behavior")
- `D-dec-cos`
  [decisions.md](../decisions.md#cosmic-movement-and-groups) ("COSMIC
  Movement And Groups")
- `D-dec-x`
  [decisions.md](../decisions.md#cross-platform-behavior)
  ("Cross-Platform Behavior")
- `D-dec-win` [decisions.md](../decisions.md#windows-port) ("Windows
  Port": managed workspaces, minimums)
- `D-dec-nest`
   [decisions.md](../decisions.md#nested-placement-affordance) ("Nested
   Placement Affordance")
- `D-dec-drag`
  [decisions.md](../decisions.md#production-interactive-edge-drag)
  ("Production Interactive Edge Drag")
- `D-win-drag`
  [windows-mouse-drag.md](../changes/archive/windows-mouse-drag.md)
  (accepted same-output title/Win producers and preview; synthetic proof,
  physical checks and exact unexecuted fixtures remain explicit)
- `D-dec-max` [decisions.md](../decisions.md#windows-maximise)
  ("Windows maximise")
- `D-place`
  [placement-correctness.md](../changes/archive/windows-placement-correctness.md#evidence-and-current-state)
  (synthetic/API proof 2026-10-03, physical feel user-owned;
  [candidate rows](../changes/archive/windows-placement-correctness.md#candidate-matrix-rows))
- `D-max`
  [windows-maximise.md](../changes/archive/windows-maximise.md#accepted-evidence)
  (synthetic proof)
- `D-fs` [windows-fullscreen.md](../changes/archive/windows-fullscreen.md)
  (scoped proof)
- `D-float` [windows-float.md](../changes/archive/windows-float.md)
  (gates pass, behavior rows user-owned)
- `D-sticky`
  [windows-sticky-float.md](../changes/archive/windows-sticky-float.md)
  (scoped helper proof, remainder user-owned)
- `D-kde-follow` [KDE post-Windows follow-ups](../changes/archive/kde-post-windows-followups.md)
  (2026-10-05 fixture-first explicit toggle repair and KDE/Engine coverage;
  offline evidence, physical delivery remains TBD)
- `D-min-games` [minimums and game admission](../research/cross-platform-core/post-windows-audit.md#2026-10-05-follow-up-q2-minimum-infeasibility--q3-games)
  (2026-10-05 current project source and pinned upstream comparison;
  unsupported exact native outcomes remain TBD, not inferred from source policy)
- `S-ours-toggle` plasma-auto-tiler:kwin/src/plan-adapter.ts:2873-2899,4793-4801
  and crates/tiler-windows/src/tiling_sys.rs:6482-6491 @ad6d69c
  (persistent KDE attempted-state fence vs discrete Windows dispatch;
  source paths, not physical repeat-delivery proof)
- `S-ours-fs-exit` plasma-auto-tiler:kwin/src/plan-adapter.ts:2926-2938
  and crates/tiler-windows/src/tiling.rs:635-677 @ad6d69c
  (public KDE fullscreen setter vs Windows project-preimage exit gate)
- `S-ours-sticky-restart` plasma-auto-tiler:kwin/src/plan-adapter.ts:3007-3036
  and crates/tiler-windows/src/tiling_sys.rs:8867-8898,8981-8999 @ad6d69c
  (native-sticky unknown-float adoption vs marker consumption into normal float)
- `S-ours-overlay-unfloat` plasma-auto-tiler:kwin/src/plan-adapter.ts:2815-2841,7645-7648,7750-7765
  and crates/tiler-windows/src/tiling.rs:395-410,
  crates/tiler-windows/src/tiling_sys.rs:7788-7813 @ad6d69c
  (KDE floating target bypasses overlay dispatch refusal; Windows refuses;
  settled KDE native outcome remains TBD)
- `D-alt-tab`
  [hidden-workspace Alt+Tab research](../research/windows-port/alt-tab-hidden-workspaces.md)
  (official docs, pinned KWin/reference source and upstream reports; no live probe)
- `D-cosmic-kb` COSMIC keybindings.ron / support articles via `D-ref`
  (Super+O/S/G/M/F11 bindings)
- `S-cos-flt-focus` cosmic-comp:src/shell/mod.rs:4136-4210 and
  src/shell/layout/tiling/mod.rs:1835-1852,1899-2087
  @3d55cba06c9cf6f27609cdefb520f7857dba20af
  (ordinary tiled subjects search the tile tree; floating subjects search
  ordinary/sticky floats by top-left coordinate delta on the requested axis;
  Up/Left include equal positions, first minimum tie; Down/Right strictly
  positive movement, last nearest tie; sticky Space precedes ordinary Space)
- `S-cos-focus-fallback` cosmic-comp:src/input/actions.rs:535-541,745-810
  and src/shell/mod.rs:2273-2302
  @3d55cba06c9cf6f27609cdefb520f7857dba20af
  (no local focus target falls through to workspace/output navigation;
  no next output means no output switch)
- `S-cos-flt-move` cosmic-comp:src/shell/mod.rs:4225-4253,
  src/shell/layout/floating/mod.rs:184-189,252-265,1184-1288 and
  src/input/actions.rs:812-881 @3d55cba06c9cf6f27609cdefb520f7857dba20af
  (free float snaps to a half; quarter/maximize transitions and repeated
  outward movement use floating snap state, not tiling-tree admission)
- `D-float-nav`
  [KDE floating directional navigation](../changes/archive/kde-floating-directional-navigation.md)
  (2026-10-05 user decision; offline focus/half-snap and reconcile regressions,
  live acceptance pending; Windows and stateful snap transitions pending)
- `S-cos-sticky-layer` cosmic-comp:src/shell/mod.rs:4769-4800,4834-4849
  and src/shell/workspace.rs:418-471
  @3d55cba06c9cf6f27609cdefb520f7857dba20af
  (sticky windows use a separate floating layer; pinned denotes workspaces)
- `S-hyp-flt-focus` Hyprland:src/desktop/state/WindowQuery.cpp:23-46,67-99,130-207,209-256
  and src/config/shared/actions/ConfigActions.cpp:476-526
  @19fb395d45314960e6f79f17994a84094f1cd4f6
  (tiled search excludes ordinary floats even on retry; float search uses
  angle/distance among floats, with monitor/edge fallback)
- `S-hyp-flt-move` Hyprland:src/layout/algorithm/Algorithm.cpp:163-168
  and src/layout/algorithm/floating/default/DefaultFloatingAlgorithm.cpp:255-272
  @19fb395d45314960e6f79f17994a84094f1cd4f6
  (floating directional move snaps position to work-area edge, retains size)
- `S-hyp-flt-pin` Hyprland:src/config/shared/actions/ConfigActions.cpp:286-294
  @19fb395d45314960e6f79f17994a84094f1cd4f6 (pin is float-only)
- `S-hyp-close`
  Hyprland:src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.cpp:268-310
  (live-tree removal: sibling promotion + recalc; last-node erase) +
  src/desktop/view/window/Window.cpp:1668-1703 (unmap removes group
  membership and layout target, then refocuses only if the closed window
  was focused: grouped next else `focus_on_close` cursor/next/MRU branch) +
  src/layout/algorithm/Algorithm.cpp:231-261 (`getNextCandidate`: tiled
  closest-node else tiled-back/float-back; floating/MRU mode uses reverse
  window history) +
  src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.cpp:481-491
  (tiled next is closest node by old middle, else first) +
  src/config/values/ConfigValues.cpp:383-384 (`input:focus_on_close`
  default `next`=0, cursor=1, mru=2)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-hyp-groupop`
  Hyprland:src/config/shared/actions/ConfigActions.cpp:963-977
  (`toggleGroup` creates a one-window group else destroys) and :979-993
  (`changeGroupActive` steps current, errors on single-member group) +
  src/desktop/view/Group.cpp:27-69 (create replaces head target) and
  :300-315 (`moveCurrent` wraps) and :317-342 (`setCurrent` swaps visible
  tab, refocuses only if the group was focused)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-hyp-drag`
  Hyprland:src/layout/supplementary/DragController.cpp:135-157
  (threshold-reached tiled pick-up floats via `changeFloatingMode`,
  remembers 0.8489 tile-size float size) and :159-251 (`dragBegin`
  threshold init, `rawWindowFocus` + raise at press) and :336-357
  (threshold gate on motion) and :401-412 (move writes floating
  position + warp, snap when enabled) and :486-491 (floating middle
  crossing a monitor reassigns to that monitor's active workspace) +
  src/config/values/ConfigValues.cpp:629-631 (`binds:drag_threshold`
  default 0 immediate, `drag_center_window` default true)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-hyp-dragend`
  Hyprland:src/layout/supplementary/DragController.cpp:252-334
  (drop: decoration `DRAG_END` hit consumes; grouped hover +
  `drag_into_group` + `canBeGroupedInto` joins, else still-floating
  tiled-origin re-tiles via `changeFloatingMode` with original float
  size remembered; `setTargetGeom` is floating-only; drop focuses the
  dragged) +
  src/desktop/view/window/WindowGroupMembership.cpp:75-90
  (`canBeGroupedInto` lock/deny/merge gates) +
  src/render/decorations/CHyprGroupBarDecoration.cpp:425-449
  (groupbar drop inserts at bar index and focuses the dragged) +
  src/config/values/ConfigValues.cpp:502-514 (`insert_after_current`,
  `focus_removed_window`, `merge_groups_on_drag`, `drag_into_group`
  0/1/2, `group_on_movetoworkspace=false`)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-hyp-keyend`
  Hyprland:src/keybinds/Manager.cpp:226 (any key press runs
  `endDragTarget` before dispatch) and :356 (mouse press ends a prior
  drag; no Esc-specific branch) +
  src/config/shared/actions/ConfigActions.cpp:1673-1715
  (`mouse:movewindow` dispatcher support: release ends drag, press
  hit-tests with reserved/input/floating extents and begins a drag;
  decoration `DRAG_START` hit skips compositor drag)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-hyp-wsrule`
  Hyprland:src/config/shared/workspace/WorkspaceRule.hpp:11-45
  (workspace rule fields: monitor/persistent/gaps/border/layout, no
  tiling/floating default) + `S(S-hyp-float)` per-window float
  dispatch (no workspace tiling flag)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-hyp-shortcut`
  Hyprland:src/keybinds/Registry.cpp:57 +
  src/keybinds/Manager.cpp:800-801 (`findShortcutConflict` lookup) +
  src/config/lua/bindings/LuaBindingsToplevel.cpp:399-407 (`unbind`) +
  src/config/shared/actions/ConfigActions.cpp:200-1824 (dispatcher
  inventory at pin lists no first-run/preset/tray/staging/Force
  actions); tray/first-run search hits only xwayland tray atoms and
  unrelated `compatible` strings, not owner controls
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-bsp-flt-focus` bspwm:src/query.c:583-584,
  src/tree.c:1124-1149,2250-2261, src/geometry.c:49-154 and
  src/settings.c:108 @e11eff4cb3333216ad03c815609a4ed79e08929c
  (unqualified directional selector includes tiles/floats; boundary distance
  first, history rank only breaks ties; default tightness HIGH)
- `S-bsp-flt-swap` bspwm:src/tree.c:101-134,1489-1623
  @e11eff4cb3333216ad03c815609a4ed79e08929c
  (same-desktop node swap retains client state/floating rectangle and focus;
  tiled arrangement is recomputed)
- `S-i3-flt-focus` i3:src/tree.c:503-577 and src/commands.c:1292-1324
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (directional `focus` dispatches via `tree_next`; tiled walk excludes
  floating list; floating left/right cycles that list with wrapping; up/down
  returns no target; sticky does not change this path)
- `S-i3-flt-move` i3:src/commands.c:1554-1588 and
  parser-specs/commands.spec:407-411
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (bare directional move shifts floating frame by 10px, retains floating)
- `S-i3-ins` i3:src/tree.c:149-181 (`tree_open_con` attaches to the
  focused parent) and src/con.c:165-205 (`_con_attach` inserts after the
  first tiling container in the parent focus stack) and src/manage.c:423-459,
  661-664 (visible-workspace newcomer takes focus via `con_activate`)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (ordinary admission inserts after focus; no geometry-driven axis)
- `S-i3-layout` i3:src/commands.c:1599-1624 (`layout tabbed`/`stacked`
  sets the parent split layout) and src/con.c:1620-1630 (tabbed behaves
  HORIZ, stacked VERT) @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (tabbed/stacked are parent split layouts holding tabs)
- `S-i3-move` i3:src/move.c:259-353 (`tree_move` same-orientation swap,
  force-orientation wrap, lone-workspace output-directed fallback) and
  :355-404 (move into the container above via `insert_con_into`) and
  src/move.c:65-171 (`insert_con_into` detach/reinsert) and
  src/workspace.c:953-984 (`ws_force_orientation` wraps the workspace) and
  src/tree.c:657-685 + src/con.c:2241-2245 (only empty cons close; narrow
  flatten needs a redundant orientation pair, so single-child wrappers persist)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (semantic `move <direction>` keeps focus on the mover)
- `S-i3-movews` i3:src/con.c:1569-1580 (`con_move_to_workspace` targets the
  focused descendant) and :1321-1324,1367-1386 (floating movers move as
  wrappers; floating targets fall back to the workspace) and :1415-1464
  (after-focused attach; focus restored to the source: no-follow) and
  src/commands.c:223-229,316-369 (`move to workspace` name/number via the
  same path) @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (`move container to workspace` is no-follow; order is after the target focus)
- `S-i3-flt-toggle` i3:src/floating.c:277-281,328-342,367 (`floating_enable`
  detaches to a workspace floating wrapper framed from stored geometry with
  size clamp) and :419-447 (`floating_disable` inserts after the
  tiling-focused descendant with percent reset, no old-slot restore) and
  src/commands.c:1142-1168 (float toggle dispatch)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
- `S-i3-sticky` i3:src/commands.c:1515-1548 (sticky sets on any window con,
  no float-only guard, then pushes) and src/output.c:87-123 (only floating
  stickies move to the visible workspace) and src/ewmh.c:146-155 (sticky
  effective only when floating) and src/manage.c:476-487 (admission sticky
  hints) and src/load_layout.c:578-580 (serialized `sticky` on restart)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
- `S-i3-fs` i3:src/con.c:1188-1309 (fullscreen toggle/enable/disable is a
  mode flag, tree retained; enable focuses the target) and
  src/commands.c:1488-1509 (command path) and src/handlers.c:681-690
  (client FULLSCREEN message uses the same toggle) and
  src/render.c:126-138,253-268 (overlay render; floating blocked except popup
  modes) and src/tree.c:515-520 (directional focus from fullscreen drops to
  workspace level) @903bcd518df32b0e055b17f5da3f988a0187fd3d
- `S-i3-max` i3:parser-specs/commands.spec:226-262 (fullscreen/sticky/
  floating verbs, no maximize verb) and src/con.c:428-485 (maximized derived
  from layout) and src/x.c:831-866 (hints written to the client only)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
- `S-i3-wsmode` i3:src/commands.c:1142-1168 (float is per-window) and
  src/workspace.c:996-1020 (`workspace_attach_to`: layout only
  default/stacked/tabbed) and parser-specs/config.spec:157-160
  (`workspace_layout` values, no tiling on/off)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
- `S-i3-close` i3:src/tree.c:263-311 (close detaches with percent fix; focus
  next only if the closed con was focused) and src/con.c:1651-1685
  (`con_next_focused`: non-head keeps head, head takes next sibling else
  parent; floating maps to its wrapper)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
- `S-i3-grp` i3:src/con.c:1997-2006 (`con_set_layout` retargets non-workspace
  cons to the parent split) and :2109-2196 (`con_toggle_layout`
  stacked/tabbed/split/all) and :1620-1630 (tabbed HORIZ, stacked VERT) and
  src/tree.c:503-577,593-628 (`tree_next` walks matching-orientation parents;
  tabbed left/right and stacked up/down step tabs, wrap per `focus_wrapping`)
  and src/click.c:232-247,263-273 (stacked/tabbed decoration scroll steps tabs;
  decoration tab click switches to that tab)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (no single toggle-stack verb; `layout tabbed`/`stacked` converts the parent)
- `S-i3-outmove` i3:src/move.c:206-253 (`move_to_output_directed`: closest output
  in direction, visible workspace, `attach_to_workspace`, mover-focused follow via
  `workspace_show`) and :179-199 (`attach_to_workspace`: RIGHT/DOWN to HEAD,
  else TAIL; focus TAIL; `workspace_layout` wrapper honored) and :259-282,342-347
  (lone/single-child workspace falls back to output-directed; workspace-level
  no-swap falls back to output-directed)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
- `S-i3-tdrag` i3:src/click.c:250-259 (floating-modifier+left starts `tiling_drag`
  before focus) and :332-340 (titlebar/modifier-or-titlebar `tiling_drag` after
  focus) and :284-285,322-324 (floating-modifier/titlebar producers for
  `floating_drag_window`, not tiled drag) and src/config.c:231-232 (code default
  `tiling_drag` modifier-only, swap Shift) and etc/config:50,54 (shipped
  `floating_modifier Mod1`, `tiling_drag modifier titlebar`) and
  src/config_directives.c:366-372,711-723 (both directives) and
  src/drag.c:43-48,156-167 (15px threshold gate; titlebar path thresholded,
  modifier path immediate) and :88-91 (key press reverts) and
  src/tiling_drag.c:304-311,320-331,402-425 (no focus change mid-drag; REVERT /
  NULL target / self-centre aborts with indicator destroy; focus/fullscreen
  restore at end)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
- `S-i3-tdrop` i3:src/tiling_drag.c:13-35,42-67 (tiling-only drop targets exclude
  floating/hidden/internal/fullscreen-covered; drag needs >1 target) and :73-94
  (`find_drop_target` rect hit else visible-workspace fallback, NULL off-output)
  and :158-244 (nearest-edge direction; outer thin band DT_PARENT, 30% edge band
  DT_SIBLING, remainder DT_CENTER; self-centre draws nothing) and :333-396
  (CENTER: swap-modifier `con_swap` else `con_move_to_target`; SIBLING: split if
  parent orientation differs then `insert_con_into`; PARENT: edge-of-tabbed/stack
  retarget then `tree_move` with old-focus restore; orientation from direction)
  and src/con.c:1498-1532 (`con_move_to_target` split-target descends to focus)
  and src/con.c:2580-2659 (`con_swap` leaf swap)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
- `S-i3-wiz` i3:i3-config-wizard/main.c:827-832 (existing-config exits,
  no overwrite) @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (first-run writer guard; no Compatible preset/stale-choice model in the
  inspected inventory)
- `S-i3-tray` i3:parser-specs/config.spec:553-554,640-652
  (`tray_output`/`tray_padding` bar options) + i3bar/src/xcb.c:46-48
  (selection window for tray support) + i3bar/include/trayclients.h (client
  list) @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (bar-hosted XEMBED tray; no owner notification-icon lifecycle in the
  inspected inventory)
- `S-i3-bind` i3:parser-specs/config.spec:437-464 (`bindsym`/`bindcode` to
  `cfg_binding`) + src/bindings.c:59-111 (`configure_binding`)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (binding definition only; no staging/Compatible/Apply/Force/Disable/Revert
  or preimage model in the inspected command/config inventory)
- `S-xmo-core-nav` xmonad:src/XMonad/Config.hs:185-215
  @284dd52c9c957cab6b6e5cc7580f2a63dafa00a7
  (default core navigation is stack focus/swap with no directional core verb; directional scenarios in this profile use contrib Navigation2D, see S-xmo-nav)
- `S-xmo-layout` xmonad:src/XMonad/Config.hs:137-149 (layout
  `Tall ||| Mirror Tall ||| Full`, `nmaster=1`, `ratio=1/2`, `delta=3/100`) and
  src/XMonad/Layout.hs:50-70,95-98 (`Full` focused-fullscreen, `Tall` master/stack
  `tile`/`splitVertically`) @284dd52c9c957cab6b6e5cc7580f2a63dafa00a7
  (flat two-pane tiling; no N-ary H/V tree, no tab stacks, no maximize state)
- `S-xmo-float` xmonad:src/XMonad/StackSet.hs:527-532 (`float`/`sink`
  floating map only, stack retained) and src/XMonad/Operations.hs:107-119
  (`manage` fixed-size/transient float via `insertUp`+`float`, else `insertUp`)
  and :719-753 (`floatLocation`: managed native geometry plus size hints;
  error fallback is full-screen `RationalRect 0 0 1 1`; unmanaged centering
  is admission-only) and :774-781 (`float` recomputes from current geometry,
  focus retained)
  @284dd52c9c957cab6b6e5cc7580f2a63dafa00a7
- `S-xmo-restart` xmonad:src/XMonad/Operations.hs:646-712 (`StateFile` carries
  the whole `StackSet` including the floating map; `writeStateToFile`/
  `readStateFile`; `restart prog True` resumes with the current window state)
  @284dd52c9c957cab6b6e5cc7580f2a63dafa00a7
  (owner restart preserves floats as ordinary floats; no sticky concept)
- `S-xmo-nav` xmonad-contrib:XMonad/Actions/Navigation2D.hs:462-473
  (`withNavigation2DConfig` + `def`: tiled hybrid line/side, float center,
  screen line, no custom layout) and :493-512 (`windowGo` focus-target,
  `windowSwap` same-layer swap retaining mover focus via `swap` :856-898; miss is no-op)
  and :467-473 (`def` strategy defaults: `defaultTiledNavigation`
  `hybridOf lineNavigation sideNavigation`, `floatNavigation`
  `centerNavigation`, `screenNavigation` `lineNavigation`,
  `layoutNavigation`/`unmappedWindowRect` empty) and :570-600 (`actOnLayer`
  `thisLayer` same-layer operation; `navigableWindows` partitions
  floating/tiled by the `floating` map, unmapped windows skipped) and
  :663-711 (`doTiledNavigation`/`doFloatNavigation`/`doScreenNavigation`
  via `runNav`; miss returns the input unchanged, i.e. no-op) and :713-751,
  :752-816, :818-855 (line/side/center algorithms: directional edge overlap
  plus center distance, stack-order tie preference) and :523-534
  (`windowToScreen` moves via `W.shift`, `screenGo` focuses via `W.view`;
  separate verbs from `windowSwap`)
  @5097a457e7a409bc9a7584dc5aa82b34c69d6dda
  (tiled/float separate layers via `thisLayer`; profile wrap False)
- `S-xmo-close` xmonad:src/XMonad/StackSet.hs:336-339 (`filter`
  focus moves down else up, order preserved) and :511-532 (`delete` is
  `sink` plus `delete'`; `float`/`sink` are floating-map writes only)
  and src/XMonad/Operations.hs:129-152 (`unmanage` via `W.delete`;
  `killWindow`/`kill`) @284dd52c9c957cab6b6e5cc7580f2a63dafa00a7
  (close removes from the stack with positional down-else-up refocus, no
  MRU rule; Tall reflows unconditionally via recalc)
- `S-xmo-mouse` xmonad:src/XMonad/Operations.hs:787-841
  (`mouseDragCursor` grab with release `done`; `mouseMoveWindow` writes the
  raw frame plus `float` on motion and `float` on release with no clamp/zone
  check; `mouseResizeWindow` resizes via `applySizeHintsContents` plus `float`
  on motion/release; no key-cancel branch) and src/XMonad/Config.hs:246-256
  (`mod-button1` focus + move + `shiftMaster`; `mod-button3` focus +
  resize + `shiftMaster`) @284dd52c9c957cab6b6e5cc7580f2a63dafa00a7
  (any release floats, even zero-move; raw frames retained off-workarea;
  hints can shape extents; no zones, preview, or restore)
- `S-xmo-out` xmonad-contrib:XMonad/Actions/Navigation2D.hs:511-534
  (`windowSwap` same-layer stack-position swap via `swap` :856-898
  retaining mover focus; `windowToScreen` moves via `W.shift`; `screenGo`
  focuses via `W.view`; empty-workspace branch is no-op)
  @5097a457e7a409bc9a7584dc5aa82b34c69d6dda
  (profile cross-output move is `windowSwap`; `windowToScreen` is the
  separate carry verb, not exercised here)
- `S-xmo-ctl` xmonad:src/XMonad/Config.hs:188-227 (key inventory:
  spawn/kill/NextLayout/refresh/focus/swap/shrink/expand/sink/IncMasterN/
  quit/restart only; no first-run/preset/prompt/tray/staging/Force/Disable/
  Revert/preimage verbs) @284dd52c9c957cab6b6e5cc7580f2a63dafa00a7
  (owner-specific control outcomes have no counterpart here)
- `S-xmo-ewmh` xmonad-contrib:XMonad/Hooks/EwmhDesktops.hs:107-112,664-680
  (`ewmh`, `ewmhFullscreen`, `fullscreenEventHook` ClientMessage add/remove/toggle)
  and :143 (`fullscreenHooks` defaults) + XMonad/Hooks/ManageHelpers.hs:289-290,329-330
  (`doFullFloat` fullscreen float `RationalRect 0 0 1 1`, `doSink`)
  @5097a457e7a409bc9a7584dc5aa82b34c69d6dda
  (event-path fullscreen only; `ewmh` alone excludes fullscreen handling)
- `S-ours-flt-target` plasma-auto-tiler:crates/tiler-core/src/session/world.rs:769-835
  and crates/tiler-core/src/directional.rs:1108-1135
  @2bdd944536fa2608f60b68686f8ec57d61663726
  (floating windows hold exceptions, not tile leaves; directional focus
  selects only tree siblings/descendants)
- `S-ours-flt-subject` plasma-auto-tiler:kwin/src/plan-adapter-entry.ts:1697,
  kwin/src/plan-adapter.ts:2155-2200,2639-2645 and
  crates/tiler-windows/src/tiling_sys.rs:5904-5954
  @2bdd944536fa2608f60b68686f8ec57d61663726
  (KDE excludes floating/sticky subjects; Windows refuses each explicitly;
  cited lines are unchanged by the current uncommitted KDE reconcile fix)
- `S-cos-newgroup` cosmic-comp:src/shell/layout/tiling/mod.rs:2898-2937
  @3d55cba0
  (new_group moves the split leaf first, then appends the newcomer, and
  keeps the old position; child order is insertion order)
- `S-cos-mapfocus` cosmic-comp:src/shell/mod.rs:2970-2984
  (new window joins the focused stack), :3001-3014 (fresh tiling map at
  target MRU, no restore state), :3028-3041 (newcomer is the focus target
  on the active workspace) and src/shell/element/stack.rs:200-234
  (join with no index appends the tab and makes it active) @3d55cba0
- `S-cos-send` cosmic-comp:src/shell/mod.rs:3541-3622
  (follow activates the target and focuses the mover; no-follow returns no
  target; floating workspaces map arrivals to the floating layer while
  tiled workspaces fresh-map them) and src/input/actions.rs:292-345
  (`SendToWorkspace` is no-follow, `MoveToWorkspace` follows;
  `SendToLastWorkspace`/`MoveToLastWorkspace` target `len-1`) and
  src/shell/mod.rs:652-704 (trailing empty workspace ensured; non-active
  non-last empties removed) and
  src/shell/layout/floating/mod.rs:474-476 (arrival with no position
  reuses last geometry loc, else cascade) @3d55cba0
- `S-cos-sysact` cosmic-comp:src/input/actions.rs:1034-1039
  @3d55cba0
  (`System` shortcut actions, which include the Alt+Tab window switcher,
  spawn a configured external command; listing/activation policy is not in
  the pinned compositor source)
- `S-cos-focusfix` cosmic-comp:src/shell/focus/mod.rs:126-147
  (focus-stack iteration is MRU-first), :553-616 (dead/missing focus runs
  fixup), :684-790 (validity plus MRU-last target, else first mapped) and
  src/shell/workspace.rs:655-688 (send/close drops the window from focus
  sets), :1491-1504 (float toggle leaves the tiling tree but keeps the
  focus entry) @3d55cba0
- `S-cos-flttoggle` cosmic-comp:src/shell/workspace.rs:1491-1506
  (toggle unmaximizes first, then swaps tiling<->floating; unfloat
  fresh-maps at focus MRU, no old-slot restore) and :1508-1519 (focused
  variant refuses while fullscreen is focused) and
  src/shell/layout/floating/mod.rs:341-350,474-476 (float frame reuses
  last geometry, else cascade/center) @3d55cba0
- `S-cos-wstile` cosmic-comp:src/shell/workspace.rs:1433-1489
  (`set_tiling`: disable moves every tiled window to floating, enable
  fresh-maps every floater sequentially at focus MRU with the pre-enable
  focus stack held across the loop; maximized windows unmaximized first,
  then re-overlaid with retargeted layer) and
  src/shell/layout/floating/mod.rs:1325-1327 (`mapped` iterates
  `space.elements().rev()`, z-order front-to-back) and `S(S-cos-raise)`
  (fixture focus order raises D last, so D is topmost regardless of map
  order) @3d55cba0
- `S-cos-raise` cosmic-comp:src/shell/focus/mod.rs:198-224 (`set_focus`
  appends the target to the focus stack) and :288-345 (`update_active`
  collects the focused windows, then raises focused sticky and ordinary
  floaters) and :479-481 (`raise_with_children` calls
  `space.raise_element(focused, true)`) @3d55cba0
- `S-cos-restore` cosmic-comp:src/shell/layout/tiling/mod.rs:1309-1340
  (`unmap` saves `RestoreTilingState`: parent/sibling/orientation/idx/sizes)
  and :438-540 (`remap` restores the old slot from that state, sibling
  path included) @3d55cba0
- `S-cos-maxtoggle` cosmic-comp:src/shell/mod.rs:4353-4367
  (`maximize_toggle`: maximized unmaximizes, fullscreen is a no-op,
  otherwise a new `maximize_request`) @3d55cba0
- `S-cos-fsreq` cosmic-comp:src/shell/workspace.rs:1255-1282
  (`map_fullscreen` at output geometry with focus append) and
  src/shell/mod.rs:4891-5021 (`fullscreen_request` sticky/tiling/floating
  branches capture restore state; focus target is Fullscreen) @3d55cba0
- `S-cos-fsrestore` cosmic-comp:src/shell/mod.rs:5023-5048
  (`unfullscreen_request` remaps from saved state, returns the restored
  window as focus) and :2755-2863 (restore branches: floating geometry
  restore, tiling old-slot remap, maximized re-overlay) @3d55cba0
- `S-cos-sticky` cosmic-comp:src/shell/mod.rs:4769-4800 (to-sticky:
  focus-stack cleanup, tiled subjects float first, map to the output-set
  sticky layer) and :4827-4871 (un-sticky restores the remembered
  Tiling/Floating layer at the active workspace, appends focus) @3d55cba0
- `S-cos-persist` cosmic-comp:src/shell/mod.rs:853-864 (only
  pinned-workspace config carried into a new session) and :1511-1524
  (`persist` writes pinned workspaces only) @3d55cba0
- `S-cos-native-unmax` cosmic-comp:src/wayland/handlers/xdg_shell/mod.rs:265-276
  (Wayland client unmaximize routes to `shell.unmaximize_request`, or clears
  the pending flag) and src/xwayland.rs:1135-1146 (X11 same) and
  src/wayland/handlers/toplevel_management.rs:218-223 (external client same)
  and src/shell/mod.rs:4502-4544 (sticky/workspace dispatch; state taken,
  original geometry/layer restored) @3d55cba0
- `S-cos-fsact` cosmic-comp:src/input/actions.rs:927-953 (project Fullscreen
  toggle dispatches on focus kind: Element enters, Fullscreen exits, focus
  set to result) and src/wayland/handlers/xdg_shell/mod.rs:278-304 (client
  fullscreen routes to the same shell request plus focus, pending fallback)
  and src/xwayland.rs:1159-1181 (X11 same) @3d55cba0
- `S-cos-admit` cosmic-comp:src/shell/mod.rs:2886-2913 (admission consumes
  pending protocol flags; fullscreen iff flag present) and :2960-2999
  (flagged fullscreen maps fullscreen; dialog/exception/tiling-disabled maps
  floating; otherwise tiling) and src/xwayland.rs:812-823 (X11 flags from
  protocol state, including `is_fullscreen`) and
  src/shell/layout/mod.rs:17-44 (dialog is parent/window-type checks) @3d55cba0
- `S-cos-maxpolicy` cosmic-comp:src/shell/mod.rs:4461-4500 (`maximize_request`
  records original geometry+layer and overlays the work area; no-op if already
  maximized) and :4502-4544 (`unmaximize_request` dispatches sticky/workspace,
  restores original geometry/layer, re-applies snap) @3d55cba0

## Variant hooks (provisional, not commitments)

| Hook | Meaning | Status |
|---|---|---|
| V-INS-AXIS | New-window split axis: long-edge vs orientation-toggle vs alternate | Selected as user statement `D-dec-x` |
| V-MOVE-PERP | Perpendicular move: COSMIC restructure vs no-op/swap | COSMIC R1 selected; foreign swap/no-op unselected (`D-dec-cos`) |
| V-MOVE-NARY | 3+-child wrap vs flat insert; same-orientation nesting allowed | Ordered N-ary + R2b/R2c/R3 selected (`D-dec-cos`) |
| V-WS-FOLLOW | Send follows focus vs leaves focus in source | `D-dec-cos` selects follow-on-verified-transfer; step-3 |
| V-WS-SHELL-ACTIVATE | Shell selection of another workspace's window: switch workspace vs pull window | KDE native configured policy (default switch); Windows option unselected (`D-alt-tab`) |
| V-WS-ANCHOR | Target anchor: remembered-leaf vs focus-history vs root; axis by long edge | Selected rule (`D-dec-x` + `D-place` synthetic proof) |
| V-FLOAT-GEO | First-float geometry: centered 60% vs app frame vs tile share | `D-dec-ww` selects centered-60% first, retained after |
| V-FLOAT-FOCUS | Separate tile/float directional layers vs cross-layer targets vs refusal | User 2026-10-05 selects COSMIC float/sticky top-left-axis search, existing project edge behavior; KDE offline delivered, Windows pending `D-float-nav` |
| V-FLOAT-SNAP | Float directional move: half/quarter/maximize/transfer vs pixel move vs refusal | User 2026-10-05 selects COSMIC; KDE first half-snap delivered, later stateful transitions and Windows pending `D-float-nav` |
| V-FLOAT-REFLOW | Float-removal survivor reflow: equalize vs ratio-preserve | Provisional, to discuss |
| V-STICKY-SCOPE | Sticky scope: all-workspaces floating-only vs monitor-desktop | `D-ref` recommends Hyprland/COSMIC; ours selects all-ws float-only |
| V-MAX-MODEL | Maximize: retained-slot overlay vs layout reflow vs no state | Selected: retained-slot overlay (`D-dec-ww` KDE + `D-dec-max`) |
| V-FS-SLOT | In-place fullscreen: retain slot vs remove/reflow | Retained slot selected (`D-dec-ww`); born-fullscreen is a separate future row |
| V-START-SEED | Startup non-fitting topology: centre-cut inference vs long-edge seed | Provisional long-edge seed, to discuss (`D-place`) |
| V-START-MIN | Minimum-infeasible writes: clamp-at-origin vs skip vs float | Provisional Windows clamp / KDE skip divergence (`D-place`) |
| V-CLOSE-FOCUS | Removal focus: source-MRU top vs spatial neighbor vs target history | `D-dec-cos` selects source-MRU top |
| V-GROUP-STACK | Tabbed stacks: supported vs fail-closed refuse | Deferred; refuse closed (`D-dec-cos`) |
| V-R4-DIR | Exhausted horizontal move: cross-output vs no-op vs workspace cycle | `D-dec-cos` selects cross-output R4; Up/Down excluded |
| V-DRAG-ZONE | Drop zones: edge/interior/stack mapping; centre-stack refused | `D-dec-cos` + `D-dec-nest` select split-only |

## 1. Insertion / splits

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | sway | qtile | awesome | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-INS-01 | `H[A,B*]`, B projected 1200x600 | Open C with B still focused | Split axis + position of C | Splits B's long edge (side-by-side), C appended after B, focus C; `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-mapfocus)` | Parent-geometry side-by-side split of B's long edge; C before/after B TBD (pointer half under follow_mouse); ordinary newcomer focused; `S(S-hyp-ins)` + `S(S-hyp-newfocus)` | Splits B's long edge side-by-side (1200x600 landscape), C second child after B, newcomer focused; `S(S-bsp-ins)` + `S(S-bsp-insert)`; exact pixels TBD | `H[A,B,C*]`: retains H (no geometry-driven axis under the splith embedding); C inserted after focused B, newcomer focused; `S(S-i3-ins)` | Start `H[A,B*]` is exactly two-window Tall (master A left, B stack right side-by-side); `insertUp` C above focused B yields StackSet order `[A,C*,B]` with newcomer focus, projected `H[A,V[C*,B]]` (master left half, C/B stacked right) via `tile`/`splitHorizontallyBy`+`splitVertically`, not a long-edge H split; exact pixel frames TBD; `S(S-xmo-ins)` + `S(S-xmo-layout)` + `S(S-xmo-admit)` | `H[A,B,C*]`: retains H (no geometry-driven axis; shipped landscape default H); C inserted after focused B via the focus-inactive anchor, ordinary newcomer focused; `S(S-sway-ins)` + `S(S-sway-wsdefault)` | Columns admits C into the focused column at the current position (insert_position=0 inserts at current, pushing B after) with newcomer focus; under the two-column default (num_columns=2, align right, split) C stacks with B vertically: projected `H[A,V[C*,B]]`; exact pixel frames TBD; `S(S-qti-default)` + `S(S-qti-add)` | TBD | Long-edge split at focused leaf; `D(D-dec-x)` (user statement); order TBD | V-INS-AXIS |
| R-INS-02 | Stack `S[A*,B]` (COSMIC) | Open C | Does C join the active stack | Joins active stack as appended tab, newcomer active, focus stays stack; `D(D-ref)` + `S(S-cos-mapfocus)` | No auto-created tab stack here: read as a Hyprland group analogue, C auto-joins the focused group as the tab after current (`insert_after_current`), newcomer current and focused; fresh groups still need a directional create/join; `S(S-hyp-group)` + `S(S-hyp-newfocus)` | No groups: one window per leaf, so C ordinary-tiles at the focused leaf instead of joining; `D(D-ref)` + `S(S-bsp-insert)` | `S[A,C*,B]` (tabbed embedding of the fixture stack): C joins the focused tabbed parent as the tab after focused A, newcomer active; `S(S-i3-ins)` + `S(S-i3-layout)` | TBD (no tabbed-stack group in the Tall/core/contrib profile; no join primitive here); `S(S-xmo-layout)` | `S[A,C*,B]` (tabbed embedding of the fixture stack): C joins the focused tabbed parent as the tab after focused A, newcomer active; stacked embedding analogous; `S(S-sway-ins)` + `S(S-sway-layout)` | No tab-stack join in this profile (split/unsplit columns only): C ordinary-admits at the focused position with newcomer focus, not as a tab; exact order/frames TBD; `S(S-qti-add)` | TBD | TBD (stacks unselected) | V-GROUP-STACK |

## 2. Focus / move

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | sway | qtile | awesome | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-MOV-01 | `H[A,C,B*]` | Move B down | Restructure vs no-op | `V[H[A,C],B]` via R1; `UT(2026-08-20)` ver-unknown + [S1-07](../cosmic-move-conformance.md#sequence-s1---three-terminals) | Semantic remove+reinsert move, not swap (swap is a separate action erroring with no target); flat 3-child start has no ordinary binary form (default ratio 1 yields halves, not thirds); exact outcome TBD (ratios, focal anchor, geometry recalc); `S(S-hyp-move)` + `S(S-hyp-moveswap)` | Configured `-s south --follow` is node swap, not R1; no south target in a single row, so no swap occurs and tree/focus stay unchanged; `S(S-bsp-swap)` + `S(S-bsp-flt-focus)` | `V[H[A,C],B*]`: no same-orientation parent, so the workspace force-wraps to V, then B inserts after the H at workspace level; focus stays B; `S(S-i3-move)` | Exact flat 3-child H has no ordinary Tall binary form (Tall `frac=1/2` partitions master/stack with the stack split equally, no thirds); analogous policy only: core swap is stack-order (`swapUp`/`swapDown`), directional move/swap is Navigation2D `windowGo`/`windowSwap` same-layer with miss no-op; exact outcome TBD (focal, ratios, geometry recalc); `S(S-xmo-layout)` + `S(S-xmo-nav)` + `S(S-xmo-core-nav)` | `V[H[A,C],B*]`: no parallel V parent, so the workspace force-wraps to V, then B inserts after the H at workspace level; focus stays B; `S(S-sway-move)` | Flat 3-child start has no ordinary Columns form (default num_columns=2, third window stacks in-column); exact outcome TBD. Policy: shuffle_down reorders within the column only (edge is no-op), no R1 restructure; `S(S-qti-shuffle)` + `S(S-qti-add)` | TBD | `V[H[A,C],B]` R1 via shared Engine; selected `D(D-dec-cos)` | V-MOVE-PERP |
| R-MOV-02 | `H[A,V[C,B*]]` | Move B up | Swap vs wrap | `H[A,V[B,C]]` via R2a leaf swap; `UT(2026-08-20)` + [S1-11](../cosmic-move-conformance.md#sequence-s1---three-terminals) | Binary-compatible start; yields `H[A,V[B,C]]`: focal 1px above B sits inside C's expanded full-V box (distance 0; ideal-BB reserved expansion at work-area edges stays within C's span, strictly closest either way), direct-partner override orders B first with top/bottom split at default ratio 1 (halves); focus stays B (non-silent); V persists through recalc under the same portrait condition the starting `V[C,B]` exhibits; `S(S-hyp-move)` | Configured `-s north --follow` swaps B/C (same-desktop swap retains focus on B; `--follow` inert here); `S(S-bsp-swap)` + `S(S-bsp-flt-focus)` | `H[A,V[B*,C]]`: in-parent leaf swap with C; focus stays B; `S(S-i3-move)` | `H[A,V[C,B]]` is Tall's projected geometry for StackSet `[A,C,B*]` (`nmaster=1`, `frac=1/2`: master A takes the left half via `splitHorizontallyBy`, stack C/B takes the right half split equally via `splitVertically`), not a structural tree; `windowSwap` U `False` from B selects C by tiled line/side geometry (C sits above sharing the x-range while A spans full height and fails the above test), and `swap` exchanges stack positions retaining mover focus (StackSet `[A,B*,C]`, projected `H[A,V[B*,C]]`); exact pixel frames TBD; `S(S-xmo-layout)` + `S(S-xmo-nav)` + `S(S-xmo-out)` | `H[A,V[B*,C]]`: in-parent leaf swap with C; focus stays B; `S(S-sway-move)` | Column-embedding analogue: B below C in one column, shuffle_up swaps B above C with focus retained; exact frames TBD; `S(S-qti-shuffle)` | TBD | `H[A,V[B,C]]`; `D(D-dec-cos)` | V-MOVE-NARY |
| R-MOV-03 | `H[A,B*,C,D]` | Move B right | Wrap pair vs flat insert | `H[A,H[B,C],D]` R2c; [S18-01](../cosmic-move-conformance.md#sequence-s18---r2c-container-neighbour) authored observation, widths unrecorded | Flat 4-child start has no ordinary binary form (default ratio 1 yields halves, not quarters); wrap-vs-insert anchor TBD (focal, ratios, geometry recalc); `S(S-hyp-move)` | East-neighbor node swap with C (not a nested wrap); focus stays B; exact partner/frames TBD without the binary embedding; `S(S-bsp-swap)` + `S(S-bsp-flt-focus)` | `H[A,C,B*,D]`: flat sibling swap with C, not a nested wrap; focus stays B; `S(S-i3-move)` | Exact flat 4-child H has no ordinary Tall binary form; wrap-vs-insert anchor TBD; analogous policy only: stack-order swap vs same-layer directional `windowSwap`; exact outcome TBD; `S(S-xmo-layout)` + `S(S-xmo-nav)` | `H[A,C,B*,D]`: flat sibling swap with C, not a nested wrap (separate `swap` verb unused); focus stays B; `S(S-sway-move)` | Flat 4-child start has no ordinary Columns form; exact outcome TBD. Policy: shuffle_right carries B into the adjacent column (new column at a shared-column edge, no-op only for a sole-column sole window); focus stays B; `S(S-qti-shuffle)` | TBD | Same-orientation wrap per Engine; nested `H[H..]` distinct from flat; `D(D-dec-cos)` | V-MOVE-NARY |
| R-MOV-04 | `H[H[A,B*],C]` | Move B right | Escape vs stay nested | `H[A,B,C]` via R3 ascend + same-axis flatten; `UT(2026-08-20)` ver-unknown + [S1-03](../cosmic-move-conformance.md#sequence-s1---three-terminals) | No flat escape: removes B then splits C, retaining binary nesting and focus B. Equal halves make C the same shape as the original inner H: if wider than tall, yields `H[A,H[B,C]]`; exact order TBD at the square tie (admission orders by the focal y half, but recalc uses H because only height greater than width selects V). No live-cursor dependence; `S(S-hyp-move)` + `S(S-hyp-ins)` | Swaps B east with C to `H[H[A,C],B]`; same-desktop swap retains focus on B; exact frames TBD; `S(S-bsp-swap)` + `S(S-bsp-flt-focus)` | `H[H[A],B*,C]`: B extracted after the inner H at the outer level; single-child `H[A]` wrapper persists (empty-only close, narrow flatten); focus stays B; `S(S-i3-move)` | Exact nested `H[H[A,B],C]` escape has no Tall counterpart (no nesting levels; flat master/stack only); analogous policy only: Navigation2D geometric target selection via `navigableWindows` with stack-position `windowSwap` retaining mover focus (miss no-op), no flat escape via Tall; exact order TBD; `S(S-xmo-layout)` + `S(S-xmo-nav)` + `S(S-xmo-out)` | `H[H[A],B*,C]`: B promoted out of the inner H into C's outer sibling list immediately before C; single-child `H[A]` wrapper persists (empty-only reap, redundant-pair squash only); focus stays B; `S(S-sway-move)` + `S(S-sway-cleanup)` | No nesting in Columns: shuffle_right carries B into C's column (a shared-column edge creates a new column instead); focus stays B; exact order/frames TBD; `S(S-qti-shuffle)` | TBD | R3 ascend; `D(D-dec-cos)` | V-MOVE-NARY |
| R-MOV-05 | `H[A*,B]` single output, no neighbor | Move left past edge | No-op vs cross-ws/output | Single-output no-op; [S5-01](../cosmic-move-conformance.md#sequence-s5---output-edge-no-op) + [S17](../cosmic-move-conformance.md#sequence-s17---single-output-directional-no-ops) authored observations; R4 never reached in UT | No observable change: the off-edge focal still resolves to the same single monitor (nearest fallback), so A is removed (B fills the workspace) then reinserted ahead of B at the beyond-left focal half, not the live cursor, rebuilding equal `H[A,B]` with focus on A (nodes rebuilt, tree and focus identical); `S(S-hyp-move)` | No-op: no west target, so the swap refuses with tree and focus unchanged; `S(S-bsp-swap)` + `S(S-bsp-flt-focus)` | No-op: workspace-level H with A first (no left swap) and the parent is the workspace, so the output-directed attempt finds no output on a single output; tree and focus unchanged; `S(S-i3-move)` | Analogous flat 2-window Tall embedding (A master, B stack side-by-side): west `windowGo`/`windowSwap` from A has no directional target with wrap False, so miss is no-op with tree/focus unchanged; core stack verbs are not directional; `S(S-xmo-layout)` + `S(S-xmo-nav)` + `S(S-xmo-core-nav)` | No-op: workspace-level H with A first (no left swap), and the next-output lookup finds no adjacent output on a single output; tree and focus unchanged; `S(S-sway-move)` + `S(S-sway-outmove)` | No-op: leftmost sole-column A has no adjacent column and no shared column to split, so shuffle_left returns with tree and focus unchanged; `S(S-qti-shuffle)` | TBD | Local R1/R2/R3 first; exhausted horizontal R4 crosses output, never workspace; Up/Down excluded; `D(D-dec-cos)` (offline only) | V-R4-DIR |

## 3. Workspace send / follow / return

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | sway | qtile | awesome | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-WS-01 | WS1 `H[A,B*]`, WS2 `H[C]` | Send B to WS2 | Source collapse, target position, focus | Source collapses to A; target splits C's long edge (C geometry unrecorded), B after C; `SendToWorkspace` leaves focus (falls back to A), `MoveToWorkspace` follows with B; `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-send)` + `S(S-cos-focusfix)` | Follow switches workspace and focuses mover, silent refocuses the source; source collapses via sibling promotion; target anchor is sole C regardless of cursor (only tiled candidate on WS2); splits C's long edge (C geometry unrecorded, so axis TBD), B before/after C TBD (cursor half); `S(S-hyp-movews)` | Source unlinks with sibling promotion; target inserts at WS2 focus C, splitting C's long edge with B second child after C; `--follow` keeps focus on B; exact axis (C geometry unrecorded)/frames TBD; `S(S-bsp-send)` + `S(S-bsp-xfer)` | `move container to workspace` (no-follow, stays on WS1): source collapses to sole A; target C,B with B after focused C; focus stays A; `S(S-i3-movews)` | shiftWin inserts above target focus via insertUp, source view unchanged; `S(S-xmo-shift)` | `move container to workspace` (no-follow, stays on WS1): source collapses to sole A; target C,B with B after focus-inactive C; mover focus restored to source inactive (A); independent `workspace` command switches instead; `S(S-sway-movews)` + `S(S-sway-switch)` | togroup removes B from the source (empty column dropped) and group.add admits it at the target Columns anchor with mover focus; the shipped binding follows via switch_group=True; exact target order/frames TBD; `S(S-qti-group)` + `S(S-qti-add)` + `S(S-qti-remove)` | TBD | Source collapses; target admits at remembered-leaf/focus-history/root; follow on verified transfer; `D(D-dec-cos)` + step-3 `D(D-dec-ww)` | V-WS-FOLLOW |
| R-WS-02 | WS1 tall case `H[C,V[A,B*]]` or wide case `V[C,H[A,B*]]`; WS2 empty; inner area 2544x1364, gap 8: A becomes 1268x1364 (tall) or 2544x678 (wide) after B leaves | Focus A then B; send B to WS2; select WS1/focus A; select WS2/focus B; send B back to WS1 | Return anchor + side/order + axis, rather than old-slot restoration | Returns at A (target MRU): tall `V[A,B]` stacked, wide `H[A,B]` side-by-side, B after A, no old-slot restore; `SendToWorkspace` stays on WS2 (kept because active, not as trailing empty) with focus none, `MoveToWorkspace` follows to WS1 with B; `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-send)` + `S(S-cos-focusfix)` | No remembered-leaf anchor in source (not MRU/slot restore): the target holds C and A (B's departure leaves both), so the return anchor is C vs A TBD (cursor closest-node; sends carry no focal, and the mover itself is excluded from anchor candidacy); only if A is selected does the given box resolve the axis (tall 1268x1364 portrait so `V`, wide 2544x678 landscape so `H`); order TBD (cursor half); follow switches workspace and focuses mover, silent refocuses the source; `S(S-hyp-movews)` | Return inserts at WS1 focus A (explicit selection), splitting A's long edge with B second child after A: tall `V[A,B]`, wide `H[A,B]`; no old-slot restore (fresh split); `--follow` focuses B; exact frames TBD; `S(S-bsp-xfer)` + `S(S-bsp-insert)` | `move container to workspace` (no-follow both legs, stays on source): B returns into the surviving single-child parent after A (tall `V[A,B]`, wide `H[A,B]`), old-slot coincidence via parent persistence, not MRU fresh-map; return leaves focus on the now-empty WS2; `S(S-i3-movews)` | Return inserts above live WS1 focus A via `insertUp` (target-stack order `[B,A]`, B focused there; source view unchanged, no follow; no old-slot store); Tall is fixed master/stack (no long-edge axis, no MRU/history anchor), so the tall `V`/wide `H` fixture distinction is inapplicable: exact axes/frames TBD; `S(S-xmo-shift)` + `S(S-xmo-layout)` | `move container to workspace` (no-follow both legs, stays on source): B returns into the surviving single-child parent after focus-inactive A (tall `V[A,B]`, wide `H[A,B]`), old-slot coincidence via parent persistence, not MRU fresh-map; axis from the surviving parent layout, not geometry; return leaves focus on the now-empty WS2; `S(S-sway-movews)` + `S(S-sway-cleanup)` | Return is fresh admission at live target focus (insert_position=0), no old-slot restore; Columns has no long-edge axis (in-column vertical stack, width-shared columns), so the tall/wide axis distinction is inapplicable; exact order/frames TBD; `S(S-qti-group)` + `S(S-qti-add)` | TBD | Remembered A: tall stacked, wide side-by-side; `D(D-place)` synthetic proof, physical feel pending; exact order TBD | V-WS-ANCHOR |
| R-WS-03 | WS1 `H[A,B*]`, trailing empty WS exists | Send B via the trailing-empty shortcut (`0` target) | Reuse existing empty vs create another; focus | Reuses the existing trailing empty (B lands sole; refresh then ensures a fresh trailing empty); `SendToLastWorkspace` leaves focus (falls back to A), `MoveToLastWorkspace` follows with B; numeric `0` is a separate binding (index 9), not the trailing-empty action; `S(S-cos-send)` + `S(S-cos-focusfix)` | Unsupported action parameter here: no trailing-empty shortcut exists in source (workspaces are explicit find-or-create; numeric `0` is an invalid workspace ID, so the `0` target has no valid counterpart); outcome TBD (no built-in equivalent for the trailing-empty parameter); `S(S-hyp-movews)` | Unsupported action parameter here: no trailing-empty shortcut in source (desktops are explicit); outcome TBD (no built-in equivalent); `S(S-bsp-send)` | Unsupported action parameter here: no trailing-empty shortcut in source (`move to workspace number` targets explicit workspaces); outcome TBD (no built-in equivalent for the trailing-empty parameter); `S(S-i3-movews)` | Unsupported action parameter here: no trailing-empty shortcut in source (workspaces explicit; `shiftWin` to a non-member tag is a no-op); outcome TBD (no built-in equivalent for the trailing-empty/`0` parameter); `S(S-xmo-shift)` | Unsupported action parameter here: no trailing-empty shortcut in source (`move to workspace number` targets explicit workspaces, no `0` branch); outcome TBD (no built-in equivalent for the trailing-empty parameter); `S(S-sway-movews)` | Unsupported action parameter here: no trailing-empty shortcut in source (groups are explicit 1-9; an unknown group raises); outcome TBD (no built-in equivalent); `S(S-qti-group)` | TBD | Windows: reuse trailing empty; per-output-local mapping; `D(D-dec-win)` (2026-10-02); KDE mapping TBD | V-WS-FOLLOW |
| R-WS-04 | WS1 `H[A,B*]`; WS2 `H[C,D]` | On WS2 focus D then C; float C to remove the remembered leaf; select WS1/focus B; send B to WS2 | Memory invalidation; surviving D from history vs root; axis/order/follow | Floated C leaves the tiling tree (D sole); MRU search skips C (no tiling node) and matches D, so B admits at surviving D from history (not root), splits D's long edge (D geometry unrecorded), B after D; `SendToWorkspace` leaves focus (falls back to A), `MoveToWorkspace` follows with B; `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-focusfix)` + `S(S-cos-send)` | No remembered-leaf or history anchor in source (floated C simply leaves the tiled set); target anchor is sole D regardless of cursor (only tiled candidate on WS2); splits D's long edge (D geometry unrecorded, so axis TBD), B before/after D TBD (cursor half); `S(S-hyp-movews)` | TBD (no remembered-leaf/history anchor in source; arrival inserts at live WS2 focus, and the split against the floated leaf is unevidenced here); `S(S-bsp-xfer)` | `move container to workspace` (no-follow): floated C sits in the WS2 floating list (floating-target fallback), so the anchor is sole D with B after D; source collapses; focus stays A; `S(S-i3-movews)` | Floated C stays in the stack with focus retained (`float` is a floating-map write only); B arrives via `shiftWin` as `insertUp` above live WS2 focus C (order `[B,C,D]`, B focused there; no floating-leaf split, Tall has no splits); source collapses to A with source view unchanged (no follow); C remains floating; exact frames TBD; `S(S-xmo-shift)` + `S(S-xmo-float)` | `move container to workspace` (no-follow): the workspace destination resolves via focus-inactive tiling only, so floated C never anchors; B lands after sole D; source collapses; focus stays A; `S(S-sway-movews)` | No remembered-leaf/history anchor in source (floated C leaves the layouts for the floating list); B admits at live WS2 focus via the ordinary anchor; exact order TBD (D geometry and live focus unrecorded); `S(S-qti-group)` + `S(S-qti-add)` + `S(S-qti-float)` | TBD | Valid focus-history after invalid remembered leaf, then genuine no-focus root; selected `D(D-dec-x)`; scenario result TBD | V-WS-ANCHOR |
| R-WS-05 | WS1 `H[A,B*]`, WS2 empty | Send B to WS2; select WS2/focus B; float B; request send B back to WS1; select WS1 | Whether floating B can transfer; retained float vs fresh tiled admission; focus | Floating B transfers; fresh tiled admission at A (splits A's long edge, B after A), float not retained; `SendToWorkspace` + select focuses A (WS1 MRU; B admitted unfocused), `MoveToWorkspace` focuses B; `S(S-cos-send)` + `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-focusfix)` | Forward B takes a full-work-area tile box on empty WS2 (sole tiled tile, not maximized mode); floated B transfers retaining float state at monitor-relative position (never fresh-tiled on arrival); the floated return makes no new tiling admission, so no anchor/axis/order applies: sole A stays the unchanged tiled tile; follow/silent focus per `S(S-hyp-movews)`; exact frames TBD; `S(S-hyp-movews)` | Forward B sole on WS2; floated B transfers retaining float (node moves with client state, no fresh tiling; sole A unchanged); `--follow` keeps focus on B; exact frames TBD; `S(S-bsp-xfer)` + `S(S-bsp-float)` | `move container to workspace` (no-follow both legs): forward B sole on WS2; floated B transfers as a floating wrapper to WS1 (float retained, no fresh tiling; sole A unchanged); return stays on the now-empty WS2; `S(S-i3-movews)` | Forward B sole on WS2; floated B transfers retaining float (`shiftWin` uses `delete'` preserving the floating map, no fresh tiling; sole A unchanged); source view unchanged (no follow); exact frames TBD; `S(S-xmo-shift)` + `S(S-xmo-float)` | `move container to workspace` (no-follow both legs): forward B sole on WS2; floated B transfers as floating to WS1 (float retained, no fresh tiling; coordinate fix only on output change, same-output leg performs no rewrite; sole A unchanged); return stays on the now-empty WS2; `S(S-sway-movews)` | Floated B transfers retaining float (removed from the floating list, re-added floating via the float state path, never fresh-tiled; sole A unchanged); the shipped binding follows via switch_group=True; exact frames TBD; `S(S-qti-group)` + `S(S-qti-float)` | TBD | TBD (explicit send applies to focused tiled windows `D(D-dec-cos)`; floated roundtrip untested) | V-FLOAT-GEO |
| R-WS-06 | WS1 tiled `H[A,B*]`; WS2 floating | Send B to WS2; send B back to WS1 | Native membership/follow, source reflow and floating frame preservation vs two-domain plan | Forward B arrives floating reusing its last tiled origin with clamped size (exact frame TBD); source reflows; return is fresh tiled admission at A (B after A); `SendToWorkspace` leaves focus (source-MRU fallback each leg), `MoveToWorkspace` follows with B; `S(S-cos-send)` + `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-focusfix)` | Forward TBD: no workspace floating mode exists in source to map `WS2 floating` onto (arrival dispatch is per-window by the mover's own float state, which this fixture never changes), so no floating arrival is recorded; return anchor is sole A (A geometry unrecorded, so axis TBD), B before/after A TBD (cursor half); exact frames TBD; `S(S-hyp-movews)` | Forward TBD: no workspace floating mode exists in source (float is per-window; desktop layout tiled/monocle only), so the return leg is conditional on an unestablished forward; `S(S-bsp-float)` + `S(S-bsp-layout)` | Forward TBD: no workspace floating mode exists in source to map `WS2 floating` onto (float is per-window); arrival dispatch for that parameter unevidenced, so the return leg is conditional on an unestablished forward; `S(S-i3-movews)` | Forward TBD: no workspace floating mode in source (float is per-window; layout Tall/Mirror/Full plus floating layer only), so the return leg is conditional on an unestablished forward; `S(S-xmo-float)` + `S(S-xmo-layout)` | Forward TBD: no workspace floating mode exists in source to map `WS2 floating` onto (float is per-window; `workspace_layout` default/stacked/tabbed only); arrival dispatch for that parameter unevidenced, so the return leg is conditional on an unestablished forward; `S(S-sway-wsmode)` | Forward TBD: no workspace floating mode exists in source (float is per-window; Columns always tiles plus a floating layer), so a tiled B admits tiled via the ordinary anchor; the return leg is likewise ordinary togroup; exact frames TBD; `S(S-qti-group)` + `S(S-qti-float)` + `S(S-qti-add)` | TBD | KDE: membership-only boundary send, only tiled side reflows `D(D-dec-ww)`; Windows: synthetic/native Paint roundtrip preserves floating frame, reflows source before hide and freshly admits on return [workspace mode record](../changes/archive/windows-workspace-tiling.md); physical feel TBD | V-WS-FOLLOW |
| R-WS-07 | WS1 `H[A,B*]`, WS2 `H[C*]` currently shown; KDE switcher includes all desktops | Select B in Alt+Tab | B listed vs omitted; switch to WS1 with B membership unchanged vs pull B into WS2 | B listed: the Alt+Tab empty-query search appends every compositor-published toplevel with no workspace/visibility filter; selecting B calls `manager.activate`, and the compositor unminimizes B, switches to WS1 via `shell.activate`, and focuses B with membership unchanged (never pulled into WS2; sticky windows focus in place); `S(S-cos-sysact)` + `S(S-cos-syscmd)` + `S(S-lch-altab)` + `S(S-pop-toplevel)` + `S(S-cos-topact)`; exact switcher visuals/key-repeat timing TBD | TBD (no Alt+Tab switcher/listing source established at this pin; membership/focus effect unevidenced) | TBD (no switcher/listing source at this pin; membership/focus effect unevidenced) | TBD (no Alt+Tab switcher/listing source established at this pin; membership/focus effect unevidenced) | TBD (no Alt+Tab switcher/listing source at this pin; membership/focus effect unevidenced) | TBD (no Alt+Tab switcher/listing source established at this pin; switcher is external, membership/focus effect unevidenced) | TBD (no Alt+Tab switcher/listing in the shipped key inventory at this pin; membership/focus effect unevidenced); `S(S-qti-keys)` | TBD | KDE source: native filter permits B; TabBox activation follows configured policy, default switch to WS1, alternative bring-to-current; exact user-version live outcome TBD. Windows current `SW_HIDE`: B omitted; future inclusion/activation policy TBD. `D(D-alt-tab)` | V-WS-SHELL-ACTIVATE |

## 4. Float / sticky

R-FLT-07 through R-FLT-10 use one output, scale 1, a tiled workspace,
zero gaps, and work-area/frame geometry in a 2560x1440 area: A
`(0,0,1280,1440)`, B `(1280,0,1280,1440)`. No fullscreen, maximized,
stacked or input-blocked windows. COSMIC uses Vertical workspace layout,
so a missed horizontal focus target tries another output, not workspace
cycling. Each row starts afresh; run once with F ordinary floating, then
repeat with F sticky floating where supported (Hyprland calls this pinned).
COSMIC pinned *workspaces* are unrelated to sticky windows
`S(S-cos-sticky-layer)`. i3 has only F/G in its floating list in R-FLT-09;
its choice there cannot establish geometric ordering. bspwm uses unqualified
`node -f DIR` for focus and the profile's `node -s DIR --follow` for move.
These are source predictions, not live executions; frame delivery and
unspecified tie/config-dependent outcomes remain TBD.

KDE's selected float-focus variant uses COSMIC's axis metric and asymmetric
ties, with sticky candidates first and KWin native encounter order within
each layer. Its miss behavior deliberately retains the existing project edge
policy: Up/Down retain; Left/Right may focus the adjacent output's remembered
eligible tile, never cycle workspaces. KDE's selected move variant currently
delivers stateless halves only; R-FLT-11 discriminates the deferred snap state.

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | sway | qtile | awesome | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-FLT-01 | `H[A,B*,C]` | Toggle float on B, then unfloat | Sibling reflow on float; unfloat placement + focus | Float leaves the tiling tree (survivors rescale proportionally), floating frame reuses last geometry else cascade/center; unfloat fresh-admits at focus MRU with no old-slot restore, focus entry kept; Super+G binding, floats above tiles; `S(S-cos-flttoggle)` + `S(S-cos-rem)` + `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-focusfix)` + `D(D-cosmic-kb)` + `D(D-ref)`; exact float frame/native focus TBD | Flat 3-child start has no ordinary binary form (default ratio 1 yields halves, not thirds); exact N-ary outcome TBD. Policy: toggle floats B via sibling promotion + recalc (survivors refill); float frame centers on the old center with the last size; untoggle fresh-admits via the Dwindle anchor (not old-slot restore) and clears pin; exact frames/focus TBD; `S(S-hyp-float)` + `S(S-hyp-ins)` | Float keeps B in tree at its slot as vacant (survivors refill); unfloat restores the same slot, not fresh admission; focus stays B; exact frames TBD; `S(S-bsp-float)` + `S(S-bsp-state)` | Float detaches B into a workspace floating wrapper framed from stored geometry (exact frame TBD); survivors rescale via percent fix; unfloat inserts after the tiling-focused descendant with percent reset, no old-slot restore; focus stays B; `S(S-i3-flt-toggle)` | Float adds B to the floating map (stack retained; tiling excludes floats so survivors refill via Tall recalc); float frame is the managed native geometry plus size hints via `floatLocation` (error fallback is full-screen `RationalRect 0 0 1 1`, not a centering fallback; unmanaged centering and `adjust` are admission-only); `sink` clears floating with stack order retained (same-slot coincidence, not fresh admission); focus stays B (map-only writes); exact frames TBD; `S(S-xmo-float)` + `S(S-xmo-layout)` | Float detaches B to a default half-width/three-quarter-height centered frame (not stored geometry); survivors refill via fraction renormalize with empty-only reap; unfloat inserts after focus-inactive tiling with fractions reset, no old-slot restore; focus stays B; exact frame TBD; `S(S-sway-float)` + `S(S-sway-cleanup)` | Float removes B from the layouts (survivors refill); unfloat re-adds via add_client at the focused position (fresh admission, no old-slot restore) with focus retained; exact float frame TBD; `S(S-qti-float)` | TBD | KDE: leaves tree, siblings reflow; first float centered 60%, then retained frame; unfloat fresh admission, focus retained; `D(D-dec-ww)`; Windows same + keep-above preimages; behavior rows user-owned `D(D-float)` | V-FLOAT-GEO |
| R-FLT-02 | `H[A,B*]` + WS2 | Sticky-on B, switch WS, sticky-off | Visibility across WS; off placement | Sticky moves to the output-set layer (separate from per-workspace layers), tiled subjects float first; un-sticky restores the remembered Tiling/Floating layer at the active workspace, not the origin, and appends focus; stays on top; `S(S-cos-sticky)` + `D(D-ref)`; exact cross-switch visibility journey TBD | Refused no-op: tiled B fails the float-only pin guard (warning, no state change, no auto-float); B stays tiled on its workspace, sticky-off N/A; floating-pin cross-WS visibility TBD for a floating subject; `S(S-hyp-pin)` | Sticky sets on tiled B with no float-only guard; B follows the monitor's focused desktop across the switch; sticky-off clears in place; exact visibility journey TBD; `S(S-bsp-sticky)` + `S(S-bsp-state)` | Sticky sets on tiled B with no float-only guard, but the push moves only floating stickies, so tiled B stays on its workspace and is not visible after the switch; sticky-off clears the flag in place; `S(S-i3-sticky)`; exact native journey TBD | TBD (no sticky in the core/contrib profile; float is per-window with no all-workspace floating-only sticky verb); `S(S-xmo-float)` | Sticky sets `is_sticky` on tiled B (no float-only guard) but effective-sticky requires floating, so only floating stickies relocate to the active workspace floating list; tiled B stays on its workspace and is not visible after the switch; sticky-off clears the flag in place; exact journey TBD; `S(S-sway-sticky)` | TBD (no sticky verb in source at this pin; float is per-window with no all-workspace sticky flag); `S(S-qti-float)` | TBD | All managed workspaces of output, float-only; Win+Shift+G; origin-honoring off (tiled fresh-admits, float stays float); `D(D-dec-ww)` KDE + `D(D-sticky)` Windows scoped proof | V-STICKY-SCOPE |
| R-FLT-03 | 1920px effective parent width; `H[A,B,C]` 50/30/20 (960/576/384) | Float A (50% child); do not unfloat | Survivor widths: ratio-preserve vs equalize | B/C become 60/40 at 1152/768, ratio preserved; `UT(2026-08-22)` + [Test C](../cosmic-move-conformance.md#follow-up-manual-observations-tests-a-c) | Flat 3-child start has no ordinary binary form; exact N-ary widths TBD. Policy: float A out via sibling promotion + recalc (survivors refill the work area); exact B/C widths TBD (ratio vs equalize not established); `S(S-hyp-float)` | TBD (binary embedding of the flat 3-child start unevidenced; float-out refill follows per-node ratios, ratio-vs-equalize for this fixture not established); `S(S-bsp-float)` + `S(S-bsp-bal)` | B/C become 60/40 via percent normalization after A detaches; `S(S-i3-flt-toggle)`; exact client pixels (borders/deco) TBD | Exact 50/30/20 flat-H fixture has no Tall counterpart (Tall splits master/stack at `frac`, stack splits equally); analogous policy: float A out via tiling exclusion + Tall recalc; exact B/C widths TBD; `S(S-xmo-float)` + `S(S-xmo-layout)` | Float A out via detach + fraction renormalize: survivors keep 30/20 fractions normalized to 60/40 (1152/768 pre-gap/deco), ratio preserved; tiled arrange applies no client-hint clamp; exact client pixels TBD; `S(S-sway-float)` + `S(S-sway-min)` | Flat 3-column start has no ordinary Columns form (default num_columns=2); exact widths TBD. Policy: removal redistributes the removed width/height share across survivors (integer growth, remainder first); `S(S-qti-remove)` | TBD | TBD (Engine removal reflow not checked here) | V-FLOAT-REFLOW |
| R-FLT-04 | Workspace tiled with A/B, optionally intentional per-window float C | Toggle workspace floating; move A; open D; toggle tiled | Untouched frames/native new window, fresh fit vs retained layout; C exception and effects | Disable moves every tiled window to floating (last-geometry else cascade frames; maximized ones unmaximized then re-overlaid as Floating); move A is an unspecified pointer/semantic move while floating-only, outcome TBD; D admits floating while floating-only; re-enable fresh-admits every floater (intentional C included) sequentially at focus-MRU long-edge anchors, re-overlaying maxima as Tiling; `S(S-cos-wstile)` + `S(S-cos-last)` + `S(S-cos-axis)`; exact frames/focus TBD | Unsupported action parameter here: no workspace tiling flag/toggle in source (float is per-window dispatch); move/open/re-enable outcomes TBD (no built-in equivalent for the workspace toggle); `S(S-hyp-float)` | Unsupported action parameter here: no workspace tiling flag in source (desktop layout tiled/monocle only; float is per-window); move/open/re-enable outcomes TBD; `S(S-bsp-layout)` + `S(S-bsp-float)` | Unsupported action parameter here: no workspace tiling flag/toggle in source (float is per-window); move/open/re-enable outcomes TBD (no built-in equivalent for the workspace toggle); `S(S-i3-wsmode)` | Unsupported action parameter here: no workspace tiling flag/toggle in source (float per-window; layout always tiles plus floating layer); move/open/re-enable outcomes TBD; `S(S-xmo-float)` + `S(S-xmo-layout)` | Unsupported action parameter here: no workspace tiling flag/toggle in source (float is per-window; `workspace_layout` default/stacked/tabbed only); move/open/re-enable outcomes TBD (no built-in equivalent); `S(S-sway-wsmode)` | Unsupported action parameter here: no workspace tiling flag/toggle in source (float is per-window; Columns always tiles plus a floating layer); move/open/re-enable outcomes TBD; `S(S-qti-float)` | TBD | KDE: floating/tiled user-confirmed, no-write release/fresh fit selected `D(D-dec-ww)`; Windows: native move/new-window/frame preservation, release/fresh fit, independent border and floating drag underlay/preview suppression proven synthetically; C exception preserved by actual Engine regression, physical row TBD [record](../changes/archive/windows-workspace-tiling.md) | V-WS-TILING |
| R-FLT-05 | B sticky floating on WS1; WS2 exists | Restart tiler owner; select WS2 | B remains sticky-visible vs becomes ordinary float; remembered origin | Pinned source persists only pinned-workspace config, no window/sticky carry-over established there; compositor/owner restart differs from script restart; `S(S-cos-persist)`; exact B visibility/origin journey TBD | TBD (no owner-restart persistence source at this pin; in-memory pin/float carry-over unevidenced) | Sticky floating B persists: owner `wm -r` dumps full state (monitors/desktops/nodes incl sticky, client state/lastState, focus history, stacking) and re-execs restoring it; `wm -l` loads the same image; B stays sticky floating with its node kept, visible on the selected WS2 via live sticky scope; exact restart/visibility journey TBD; `S(S-bsp-restore)` + `S(S-bsp-state)` | Sticky re-established from serialized layout or state hints, then pushed to the visible workspace, so B stays sticky-visible; `S(S-i3-sticky)`; exact restart/visibility journey and origin placement TBD | Restart preserves the windowset including the floating map, so B's float carries as an ordinary float; sticky cross-workspace visibility has no counterpart here (no sticky verb in this profile); remembered origin/visibility journey TBD; `S(S-xmo-restart)` + `S(S-xmo-float)` | Unsupported action parameter here: no owner-restart verb in source (`reload` in-place + `exit` only); sticky/float carry-over across owner restart unevidenced in the inspected inventory; outcome TBD (no built-in equivalent for the restart step); `S(S-sway-reload)` + `S(S-sway-sticky)` | TBD (no sticky concept; restart dump carries group/layout/screen/scratchpad state only, no per-window float state, so B's sticky/float visibility is not preserved as state; re-manage placement and WS2-select focus TBD); `S(S-qti-reload)` + `S(S-qti-state)` | TBD | KDE source adopts surviving native sticky as unknown-origin sticky float; Windows consumes surviving project marker into normal float on current managed workspace, discarding origin; `S(S-ours-sticky-restart)` + `D(D-sticky)`; exact restart/visibility journey TBD | V-STICKY-SCOPE |
| R-FLT-06 | Workspace tiled; B is intentional ordinary float, then natively maximized | With B focused, toggle ordinary float once | Overlay refusal vs logical unfloat beneath retained maximize; settled slot/frame/focus | Toggle unmaximizes B first, then the floating occupant fresh-admits to tiling at focus MRU (maximize not retained); `S(S-cos-flttoggle)` + `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-focusfix)`; settled frame/focus and native journey TBD | No refusal: toggle runs `changeFloatingMode`, which temporarily clears FS then re-applies it, flipping float while retaining maximized (tiled maximized at the work area); settled frame/focus TBD; `S(S-hyp-float)` + `S(S-hyp-fs)` | TBD (no maximize state in source: monocle is layout, maximize flags are client hints not tree state); `S(S-bsp-layout)` + `S(S-bsp-admit)` | No refusal: `floating disable` on already-floating B proceeds (only internal-workspace guard), inserting after the tiling-focused descendant; maximize is derived-only so no maximize interplay; settled frame/focus TBD; `S(S-i3-flt-toggle)` + `S(S-i3-max)` | TBD (no maximize state in source: `Full` is a workspace layout rendering focus fullscreen, maximize flags are not tree state); toggle path is float/`sink` only; `S(S-xmo-layout)` + `S(S-xmo-float)` | Maximized precondition has no counterpart here (no maximize state; client request only schedules a configure); toggle path has no maximize/refusal branch, so an ordinary float B toggles via the standard float path; settled slot/frame/focus TBD; `S(S-sway-float)` + `S(S-sway-max)` | Maximized is a float state, so toggling float on maximized B runs the unfloat path (fresh tiled admission, maximize not retained); settled frame/focus TBD; `S(S-qti-float)` + `S(S-qti-fs)` | TBD | KDE dispatch gate allows floating target despite maximize; unfloat transition clears floating intent while overlay writes are skipped, settled result TBD. Windows refuses `float-refused-maximize`; `S(S-ours-overlay-unfloat)`; physical outcome TBD | V-FLOAT-GEO / V-MAX-MODEL |
| R-FLT-07 | `H[A,B*]` + F floating `(1000,500,300,200)` | Focus left | Can tile-origin focus enter ordinary/sticky F | A; F excluded from tiled search, ordinary/sticky alike; `S(S-cos-flt-focus)` | A; ordinary/pinned F excluded; `S(S-hyp-flt-focus)` + `S(S-hyp-flt-pin)` | A; F is eligible but boundary distance A=1 < F=19; sticky same; `S(S-bsp-flt-focus)` | A; floating/sticky F outside tiled walk; `S(S-i3-flt-focus)` | A; tiled subjects navigate the tiled layer only (floats excluded, ordinary/sticky alike in profile terms); `S(S-xmo-nav)` | A; F excluded from the tiled search (tiled subjects use the tile walk, which never consults the floating list); ordinary/sticky alike; `S(S-sway-focus)` | A; tiled-column verbs never consult the floating list, ordinary/sticky alike (no sticky concept); `S(S-qti-focus)` + `S(S-qti-float)` | TBD | KDE/Windows: A; ordinary/sticky F has no tile leaf, hence never a target; unchanged, KDE regression `D(D-float-nav)` + `S(S-ours-flt-target)` | V-FLOAT-FOCUS |
| R-FLT-08 | `H[A,B]` + F* floating `(500,500,300,200)`; no other floats | Focus right | Float-origin focus enters tiles vs misses/refuses | No local target: tiles excluded; output fallback has no next output, F retained. Sticky same; `S(S-cos-flt-focus)` + `S(S-cos-focus-fallback)` | No-op: float-only search and edge retry find no other float; pinned same; `S(S-hyp-flt-focus)` + `S(S-hyp-flt-pin)` | B; unqualified selector crosses layers (distance B=481 < A=799); sticky same; `S(S-bsp-flt-focus)` | F retained: horizontal floating-list wrap selects self; sticky same; `S(S-i3-flt-focus)` | F retained: float-only search finds no other float (self skipped), miss is no-op so no focus change; tiles excluded; `S(S-xmo-nav)` | F retained: float-only center-delta search finds no other float (self skipped, no furthest for wrap), returns NULL so no focus change; sticky same (no sticky filter in the float search); `S(S-sway-focus)` | Float-origin directional verbs still run the tiled-column walk (floats are never targets), so focus leaves F for a tiled window; exact target TBD (live column current unrecorded); `S(S-qti-focus)` | TBD | KDE: F retained, no local float or adjacent output, tiles excluded; ordinary/sticky same; offline `D(D-float-nav)`, live TBD. Windows: existing `focus-refused-floating` / `focus-refused-sticky`; parity pending; `S(S-ours-flt-subject)` | V-FLOAT-FOCUS |
| R-FLT-09 | `H[A,B]` + F* floating `(500,500,300,200)` + ordinary float G `(1800,500,300,200)` | Focus right | Farther float G vs nearer tile B; sticky-to-ordinary focus | G; ordinary/sticky floats share candidates, tiles excluded; x-coordinate delta selects G; `S(S-cos-flt-focus)` | G by floating angle/distance search, not COSMIC's top-left-axis rule; pinned F same; `S(S-hyp-flt-focus)` + `S(S-hyp-flt-pin)` | B; all layers eligible, boundary distance B=481 < G=1001; sticky F same; `S(S-bsp-flt-focus)` | G; next floating-list entry (wrap if needed), not geometry; sticky F same; `S(S-i3-flt-focus)` | G by float-layer center navigation (F center 650 vs G center 1950, positive-delta nearest), not tile geometry nor list order; tiles excluded; `S(S-xmo-nav)` | G by center-delta float search (F center 650 vs G center 1950, positive delta nearest), not COSMIC top-left rule nor list order; tiles excluded; sticky shares candidates (no sticky filter); `S(S-sway-focus)` | Tiles only: G is never a candidate (no float-only search exists; directional verbs walk tiled columns), so focus lands on a tile, not G; exact target TBD; `S(S-qti-focus)` | TBD | KDE: G by top-left x delta; ordinary/sticky share candidates, nearer B excluded; offline `D(D-float-nav)`, live TBD. Windows: F retained, existing subject refusal; parity pending; `S(S-ours-flt-subject)` | V-FLOAT-FOCUS |
| R-FLT-10 | `H[A,B]` + free, unsnapped F* floating `(1000,500,300,200)` | Move right once | Move/resize geometry vs tree swap vs refusal; remains floating vs tiles | Right-half snap `(1280,0,1280,1440)` in floating layer, not tile-tree admission; sticky same. Later snap-state transitions can quarter/maximize or request workspace/output transfer; `S(S-cos-flt-move)` | Snap F to right work-area edge, retain size/y and floating state (reserved extents affect exact x); pinned same; `S(S-hyp-flt-move)` + `S(S-hyp-flt-pin)` | Profile swaps F/B tree nodes; F stays floating at its original frame/focus, tile arrangement recomputed (B exact frame TBD). Sticky same; `S(S-bsp-flt-focus)` + `S(S-bsp-flt-swap)`. Separate pixel `-v` moves F, not this profile action; `S(S-bsp-move)` | Bare `move right`: F.x += 10px, stays floating; sticky same; `S(S-i3-flt-move)` | F stays floating at its original frame: sole float F has no directional float-layer target, so the swap returns `id` with frame/floating retained; no tile-tree admission, no snap; `S(S-xmo-nav)` | Bare `move right`: F.x 1000->1010 (+10px default), stays floating via frame move (single output, no workspace change); sticky same (no guard); `S(S-sway-move)` | TBD (no directional float-move verb in source: shuffle operates on the tiled current, set_position moves floats only by explicit coordinates; no snap/half mapping); `S(S-qti-shuffle)` + `S(S-qti-drag)` | TBD | KDE: right-half `(1280,0,1280,1440)`, remains floating/focused, sticky same; signal/reconcile retention regression `D(D-float-nav)`, live TBD. Windows: existing `move-refused-floating` / `move-refused-sticky`; parity pending; `S(S-ours-flt-subject)` | V-FLOAT-SNAP |
| R-FLT-11 | Same free F* and zero-gap fixture as R-FLT-10 | Move right, then move up | Stateful quarter-snap vs stateless requested half | Top-right quarter `(1280,0,1280,720)`; stays floating, sticky same; `S(S-cos-flt-move)` | Top-right corner `(2260,0,300,200)` on the 2560x1440 work area with zero reserved decoration extents (x=2260-right extent, y=top extent; right snaps x retaining y/size, up then snaps y retaining x/size), remains floating; pinned same; non-zero extents/client ack/visuals TBD; `S(S-hyp-flt-move)` + `S(S-hyp-flt-pin)` | First leg swaps F/B per R-FLT-10; second leg (up from F's floating frame) sees A and B north at equal boundary distance, tie broken by history rank, so the swap partner is unevidenced here: TBD; `S(S-bsp-flt-focus)` + `S(S-bsp-flt-swap)` | Two bare pixel moves (right x += 10, then up y -= 10), size and floating state retained, no snap state; sticky same; exact frame TBD (output clamp); `S(S-i3-flt-move)` | Both legs no-op: sole float F has no directional float-layer target either leg, so swaps return `id` with frame/floating retained; no snap state; `S(S-xmo-nav)` | Two bare pixel moves: (1000,500)->(1010,500)->(1010,490), size and floating state retained, no snap state; sticky same; exact clamp TBD; `S(S-sway-move)` | TBD (no snap state in source; same verb gap as R-FLT-10 on both legs); `S(S-qti-shuffle)` + `S(S-qti-drag)` | TBD | KDE: top half `(0,0,2560,720)`, remains floating/focused, sticky same; stateless subset tested `D(D-float-nav)`; stateful transitions deferred, live TBD. Windows: implementation pending | V-FLOAT-SNAP |

## 5. Maximise / fullscreen

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | sway | qtile | awesome | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-MAX-01 | `H[A,B*,C,D]` equal shares, effective width 2544px, gap 8; min widths 401/864/627/582 constrain actual allocation | Maximize B, then restore B | Sibling desired/actual stability, retained hints, exact slot, convergence delay | Maximize records original geometry+layer and overlays the work area; B stays in the tiling tree so siblings keep allocation with no reflow; restore dispatches by layer and restores original geometry/layer, revealing the retained slot; Super+M distinct from F11; `S(S-cos-maxtoggle)` + `S(S-cos-maxpolicy)` + `S(S-cos-bornmax)` + `D(D-cosmic-kb)`; exact native frames/focus/timing TBD | Flat 4-child start has no ordinary binary form; exact N-ary frames TBD. Policy: internal `FSMODE_MAXIMIZED` covers the work area (siblings stay in tree but obscured/blocked); restore to `NONE` lets recalc reveal retained slots; exact frames/focus TBD; `S(S-hyp-fs)` | Unsupported action parameter here: no maximize command/state in source (monocle is a desktop layout, maximize flags are not tree state); maximize/restore outcomes TBD (no built-in equivalent); `S(S-bsp-layout)` + `S(S-bsp-admit)` | Unsupported action parameter here: no maximize command/state in source (maximize is a derived client hint only); maximize/restore outcomes TBD (no built-in equivalent); `S(S-i3-max)` | Unsupported action parameter here: no maximize command/state in source (`Full` is a workspace focused-fullscreen layout, not per-window maximize); maximize/restore outcomes TBD (no built-in equivalent); `S(S-xmo-layout)` | Unsupported action parameter here: no maximize command/state in source (inventory has no maximize verb; client maximize request only schedules a configure); maximize/restore outcomes TBD (no built-in equivalent); `S(S-sway-max)` | Maximized is a floating-layer state at work-area size: B leaves the tiling (survivors refill, no retained-slot overlay) and restore re-adds via fresh admission; exact frames/focus TBD; `S(S-qti-fs)` + `S(S-qti-float)` | TBD | KDE: slot/share kept, no writes, exact restore `D(D-dec-ww)`; Windows: same + retained hints + bounded async restore; synthetic proof `D(D-max)` + `D(D-place)`; physical feel pending | V-MAX-MODEL |
| R-MAX-02 | `H[A,B*]` | Fullscreen B; focus A; focus B; exit fullscreen | Tree mutation; focus enter/leave; restore | Fullscreen removes B's node with no placeholder (A reflows to full width by proportional rescale) but saves sibling/idx/sizes; focus moves to a separate Fullscreen target. Focus A/B changes focus while the overlay remains until explicit exit. Exit re-inserts B beside A at the saved idx with saved sizes and returns the restored window as focus; separate focus surface; `S(S-cos-fsreq)` + `S(S-cos-fsrestore)` + `S(S-cos-restore)` + `S(S-cos-fsact)` + `S(S-cos-rem)` + `D(D-ref)`; intermediate visible-focus and native sequence TBD | `FSMODE_FULLSCREEN` covers the monitor box (tree kept, siblings blocked, no node removal); exit to `NONE` lets recalc restore tile boxes; focus enter/leave sequence TBD; `S(S-hyp-fs)` | Fills monitor, node stays in tree as vacant; `D(D-ref)` + `S(S-bsp-state)`; focus enter/leave sequence TBD | Fullscreen is a mode flag: tree retained, B overlays via render; enable focuses B; same-workspace directional focus outside B is fenced (drops to workspace level), exact A/B focus sequence TBD; exit clears the mode and recalc reveals tiles; `S(S-i3-fs)` | EWMH fullscreen in profile is float-based (`doFullFloat` fullscreen float via ClientMessage, `doSink` on exit; stack retained); core `Full` is workspace focused-fullscreen instead; exact A/B focus enter/leave/restore sequence TBD; `S(S-xmo-ewmh)` + `S(S-xmo-layout)` | Fullscreen is a mode flag: tree retained, `ws->fullscreen` set, enable focuses B on its workspace; directional focus from workspace-fullscreen drops to outputs (global returns no target); exit clears the mode and recalc reveals tiles; exact A/B sequence TBD; `S(S-sway-full)` + `S(S-sway-focus)` | Fullscreen is a floating-layer state: B leaves the tiling (A refills, no placeholder) and exit re-adds via fresh admission; focus enter/leave sequence TBD; `S(S-qti-fs)` + `S(S-qti-float)` | TBD | Retained slot overlay; focus may enter/leave; `D(D-dec-ww)` KDE + `D(D-fs)` Windows scoped proof; physical focus sequence pending | V-FS-SLOT |
| R-MAX-03 | Workspace floating, first-seen maximized A without a prior tile slot | Toggle tiled; restore A if still maximized | Preserve floating maximum, then one-shot native restore and actual fresh tiled plan/write/readback | Enable tiles every floater sequentially at focus-MRU long-edge anchors (A included, no slotless hold); maximized floaters re-overlay with original layer retargeted to Tiling; restore A reveals the retained fresh slot; `S(S-cos-wstile)` + `S(S-cos-last)` + `S(S-cos-axis)`; exact native frames/journey TBD | Unsupported action parameter here: no workspace floating/tiled toggle in source (per-window float dispatch); slotless-maximum hold/re-overlay outcomes TBD (no built-in equivalent for the workspace toggle); `S(S-hyp-float)` | Unsupported action parameter here: no workspace tiling toggle and no slotless-maximum hold in source; outcomes TBD; `S(S-bsp-layout)` + `S(S-bsp-admit)` | Unsupported action parameter here: no workspace tiling toggle and no maximize hold state in source (maximize derived-only); slotless-hold/re-overlay outcomes TBD; `S(S-i3-wsmode)` + `S(S-i3-max)` | Unsupported action parameter here: no workspace tiling toggle and no slotless-maximum hold in source; outcomes TBD; `S(S-xmo-layout)` | Unsupported action parameter here: no workspace tiling toggle and no maximize hold state in source (no maximize verb; maximize request only schedules a configure); slotless-hold/re-overlay outcomes TBD; `S(S-sway-wsmode)` + `S(S-sway-max)` | Unsupported action parameter here: no workspace floating/tiled toggle in source; slotless-hold outcomes TBD. Policy: admission applies pending fullscreen via auto_fullscreen; `S(S-qti-float)` + `S(S-qti-fs)` | TBD | KDE source: floating gate skips admission clear; first tiled admission restores unslotted maximum once and refetches normal state (`kwin/src/plan-adapter.ts:4883-4888,5330-5397`); Windows: slotless membership preserves floating maximum and hide/reveal, then one clear and fresh tiled plan/native write/matched target readback proven with Notepad/Paint; slotted overlays skip re-clear [accepted correction](../changes/archive/windows-workspace-tiling.md#r-max-03-accepted-correction); physical feel TBD | V-WS-TILING |
| R-MAX-04 | `H[A,B*]`; B normal and remains the same native window | Shortcut-maximize B; native-restore B; press the same shortcut again | New maximize attempt vs persistent attempted-state refusal | Native client restore routes to compositor unmaximize_request on all three protocol paths (Wayland, X11, toplevel-management), taking and clearing maximized_state; the repress then sees un-maximized and issues a new maximize_request with re-recorded overlay; `S(S-cos-native-unmax)` + `S(S-cos-maxtoggle)`; native ack/focus visuals TBD | New maximize attempt: client native restore routes to `setFullscreenMode` `NONE` (taking/clearing maximized state), so the repress sees un-maximized and issues a new maximize with re-recorded overlay; native ack/focus visuals TBD; `S(S-hyp-fs)` | No state-change path: no maximize command/state for a shortcut press or native restore to act on, so tree state is a no-op; client ack TBD; `S(S-bsp-layout)` + `S(S-bsp-admit)` | No state change path: no maximize command to press and no maximize state for native restore to clear (maximize hints are output-only); outcome is a no-op, client ack TBD; `S(S-i3-max)` + `S(S-i3-fs)` | No state-change path: no maximize command/state for a shortcut press or native restore to act on, so tree state is a no-op; `S(S-xmo-layout)` | No state change path: no maximize command to press and no maximize state for native restore to clear (maximize request only schedules a configure); outcome is a no-op, client ack TBD; `S(S-sway-max)` | Toggles flip state with no attempted-state fence in source. Backend-qualified: on X11 the native restore is echoed only and never drives maximized, so MAXIMIZED is retained and the repress toggles off (unmaximize); on Wayland the native `handle_request_maximize` drives the state, so native restore clears and the repress re-applies maximize; native ack/focus visuals TBD; `S(S-qti-fs)` | TBD | KDE repaired 2026-10-05: same-ref adapter regression issues a new native attempt after restore (and reverse ordering), `D(D-kde-follow)`; earlier refusal remains historical `S(S-ours-toggle)`. Windows dispatches one attempt per new discrete down, `D(D-dec-max)`; physical repeat/delivery outcome TBD | V-MAX-MODEL |
| R-MAX-05 | B entered app-owned fullscreen without a tiler fullscreen preimage | Focus B; request project fullscreen toggle | Native exit attempt vs refusal of app-owned fullscreen; slot/geometry after exit | Project toggle dispatches on focus kind: Element enters fullscreen_request with restore captured from its layer, Fullscreen exits via unfullscreen_request with old-slot remap; client-initiated fullscreen (Wayland/X11) routes to the same shell request, so a mapped client fullscreen carries a restore entry; no refusal branch in pinned dispatch; `S(S-cos-fsact)` + `S(S-cos-fsreq)` + `S(S-cos-fsrestore)`; app-specific completion and settled slot/geometry TBD | No refusal branch: client fullscreen maps via the same `setFullscreenMode` path (mapped immediate, unmapped pending); project toggle exits via `NONE` when FS else enters, tree retained; app-specific completion/slot TBD; `S(S-hyp-fs)` | No refusal branch: app EWMH ADD maps via the same set_state with last_state remembered (honored both ways by default); project `node -t ~fullscreen` toggles FULLSCREEN back to last_state (same-state no-op only); EWMH REMOVE/TOGGLE converge on the same restore; slot retained vacant in place, tree kept; app-specific completion/settled geometry TBD; `S(S-bsp-fs)` + `S(S-bsp-admit)` | No refusal: client FULLSCREEN messages and the `fullscreen` command converge on the same mode toggle; tree retained, exit via mode clear plus recalc; app-specific completion/slot TBD; `S(S-i3-fs)` | No refusal branch on the event path: ClientMessage fullscreen add/remove/toggle maps via `fullscreenHooks` (`doFullFloat`/`doSink`), tree stack retained; app-specific completion/slot TBD; `S(S-xmo-ewmh)` | No refusal: client fullscreen requests (xdg/xwayland) and the `fullscreen` command converge on `container_set_fullscreen`; tree retained, exit via mode clear plus recalc; app-specific completion/slot TBD; `S(S-sway-full)` | No refusal branch: toggle_fullscreen flips the state regardless of origin; exit clears via the same path; settled slot/geometry TBD; `S(S-qti-fs)` | TBD | KDE invokes public fullscreen setter toward normal; Windows refuses app-owned exit without its restoration preimage, never synthesizes app F11; `S(S-ours-fs-exit)` + `D(D-fs)`; app-specific native completion/slot outcome TBD | V-FS-SLOT |
| R-MAX-06 | Tiled workspace with B; first-seen eligible maximized A has no retained tile slot and is not fullscreen | Admit A; later natively restore A | One-shot launch restore vs reserved-slot overlay vs slotless hold; B allocation, A admission and focus | Tiles A then applies requested maximum as overlay with tile slot retained; other existing maxima unmaximized first; A is the focus target on the active workspace; later native restore clears compositor maximized state and reveals the retained slot without touching focus; B allocation follows ordinary admission anchoring (fixture focus unspecified); `S(S-cos-bornmax)` + `S(S-cos-mapfocus)` + `S(S-cos-native-unmax)`; exact native ack/visuals TBD | Pending client maximum consumed/applied at map as `FSMODE_MAXIMIZED` at the work area (replaces existing workspace FS); B allocation follows the ordinary Dwindle anchor; exact siblings/focus TBD; `S(S-hyp-bornmax)` + `S(S-hyp-fs)` + `S(S-hyp-ins)` | Ordinary tile state; maximum flags not admission state, fullscreen handled separately; `S(S-bsp-admit)`; exact focus TBD | Ordinary tiling; maximum flags derive from layout; `S(S-i3-admit)`; exact focus TBD | Ordinary manage/tile (fixed/transient float only; no size/maximize/fullscreen inference); profile uses the `ewmhFullscreen` event hook (`fullscreenEventHook`) with default `doFullFloat`/`doSink` and no fullscreen manage hook, so admission itself tiles; exact siblings/focus TBD; `S(S-xmo-admit)` + `S(S-xmo-ewmh)` | Ordinary tiling: no maximize admission state (maximize request only schedules a configure; `wants_floating` is fixed-size/dialog/parent only); fullscreen flag alone maps fullscreen; exact siblings/focus TBD; `S(S-sway-max)` + `S(S-sway-ins)` | Fullscreen-flagged admits fullscreen via auto_fullscreen; fixed-size admits floating via float rules; otherwise ordinary tiling (no maximize-pending admission state); exact siblings/focus TBD; `S(S-qti-float)` + `S(S-qti-fs)` | TBD | Current KDE/Windows make one admission-time clear attempt; retained slots/fullscreen/floating domains are exempt. Proposed preserve variants and later setting are unselected; exact native journey TBD, `D(D-min-games)` | V-MAX-MODEL |
| R-MAX-07 | Captionless window covers the full monitor; KDE native fullscreen and maximize flags are false | First observe/admit it | Fullscreen exemption vs ordinary tiling despite monitor coverage | Fullscreen requires the protocol flag (Wayland request or X11 state, consumed at admission); dialog checks (parent/window-type, min==max) admit floating, otherwise ordinary tiling; size plays no role in the cited admission path; `S(S-cos-admit)` + `S(S-cos-min)`; exact admitted frame and game presentation mode TBD | No size inference: fullscreen/maximize require a protocol flag/pending request or rule; captionless cover alone admits ordinary tiling (fixed-size min==max floats instead); exact frame/presentation TBD; `S(S-hyp-float)` + `S(S-hyp-fs)` | Ordinary manage absent fullscreen atom/rule; `S(S-bsp-admit)`; exact fixture TBD | Ordinary manage absent fullscreen atom/override-redirect; `S(S-i3-admit)`; exact fixture TBD | Ordinary tiling absent a protocol float cause (fixed/transient only; size plays no role); profile fullscreen handling is post-map ClientMessage only with no fullscreen manage hook; exact fixture TBD; `S(S-xmo-admit)` + `S(S-xmo-ewmh)` | Ordinary tiling absent a protocol fullscreen flag (admission maps fullscreen only from the request flag; `wants_floating` is fixed-size/dialog/parent only; size plays no role); exact fixture TBD; `S(S-sway-max)` | No size inference: fullscreen needs the protocol flag, fixed-size floats instead, otherwise ordinary tiling; exact frame/presentation TBD; `S(S-qti-float)` + `S(S-qti-fs)` | TBD | KDE does not infer fullscreen from size, so no maximize-clear but ordinary tiling is possible; Windows captionless monitor containment classifies fullscreen. Actual game presentation mode is not established by either shape; `D(D-min-games)` | V-FS-SLOT |

## 6. Startup adoption

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | sway | qtile | awesome | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-START-01 | Tiling off; 2560x1380 work area, gaps 8; A(8,8,1268,678), B(1284,8,1268,678), C(8,694,1268,678), D(1284,694,1268,678); focus A,B,C,D; minima fit | Enable tiling; disable/re-enable | Identity/order/topology vs sequential remap; second-enable stability | Fixture focus A->D raises each floater in turn, so D is topmost regardless of map order; enable admits front-to-back (D,C,B,A), each fresh at focus-MRU long-edge anchors. D seeds the root (empty tree, output-dimension fallback); C/B/A each split D's leaf under the frozen MRU: first split side-by-side `H` (`Orientation::Vertical` on the 2544-wide area), then alternating long-edge bisection, so the 2x2 becomes a nested chain. Disable/re-enable roundtrips (tiling order out, reverse-z back in), identity not guaranteed; `S(S-cos-wstile)` + `S(S-cos-raise)` + `S(S-cos-seq)` + `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)`; realized pixel rects TBD | Unsupported action parameter here: no tiling-off/workspace-enable toggle in source (workspaces always carry both algorithms; admission is per-window Dwindle anchor, no centre-cut inference); 2x2/nested-chain outcome TBD (no built-in equivalent for the enable toggle); `S(S-hyp-float)` + `S(S-hyp-ins)` | Unsupported action parameter here: no tiling-off/enable toggle in source (desktops always lay out tiles; float is per-window); 2x2/nested-chain outcome TBD; `S(S-bsp-layout)` | Unsupported action parameter here: no tiling-off/enable toggle in source (workspaces always lay out tiles; float is per-window); 2x2/nested-chain outcome TBD (no built-in equivalent for the enable toggle); `S(S-i3-wsmode)` | Unsupported action parameter here: no tiling-off/enable toggle in source (workspaces always tile via layout plus floating layer; admission is per-window `insertUp`, no centre-cut inference); 2x2/nested-chain outcome TBD; `S(S-xmo-layout)` + `S(S-xmo-ins)` | Unsupported action parameter here: no tiling-off/enable toggle in source (workspaces always lay out tiles; float is per-window); 2x2/nested-chain outcome TBD (no built-in equivalent); `S(S-sway-wsmode)` | Unsupported action parameter here: no tiling-off/enable toggle in source (Columns always tiles plus a floating layer; admission is per-window at the live focus anchor); 2x2/nested-chain outcome TBD; `S(S-qti-add)` + `S(S-qti-float)` | TBD | Clean/tolerance-valid recursive-cut adoption preserved; `D(D-dec-x)` provisional; exact fixture TBD | V-START-SEED |
| R-START-02 | Tiling off; 2560x1380 work area, gaps 8; A(80,80,1000,700), B(120,120,1000,700), C(160,160,1000,700), D(200,200,1000,700); focus A,B,C,D; minima 400x200 each | Enable tiling | Centre-cut inference vs long-edge seed; final axes and identity order | No centre-cut inference in source. Same mechanism: focus raises make D topmost and MRU, so D seeds the root and C/B/A each split D's leaf at its long edge (frozen MRU), yielding a nested bisection chain, not a 2x2; `S(S-cos-wstile)` + `S(S-cos-raise)` + `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)`; exact axes/rects TBD | Unsupported enable action as above (no tiling-off toggle; per-window Dwindle anchor, no centre-cut inference); cascade-chain outcome TBD (no built-in equivalent for the enable toggle); `S(S-hyp-float)` + `S(S-hyp-ins)` | Unsupported action parameter here: no tiling-off/enable toggle in source (desktops always lay out tiles; float is per-window); cascade-chain outcome TBD; `S(S-bsp-layout)` | Unsupported action parameter here: no tiling-off/enable toggle in source (workspaces always lay out tiles; float is per-window); cascade-chain outcome TBD (no built-in equivalent for the enable toggle); `S(S-i3-wsmode)` | Unsupported enable action as above (no tiling-off toggle; per-window `insertUp` anchor, no centre-cut inference); cascade-chain outcome TBD; `S(S-xmo-layout)` + `S(S-xmo-ins)` | Unsupported action parameter here: no tiling-off/enable toggle in source (workspaces always lay out tiles; float is per-window); cascade-chain outcome TBD (no built-in equivalent); `S(S-sway-wsmode)` | Unsupported enable action as above (no tiling-off toggle; per-window anchor, no centre-cut inference); cascade-chain outcome TBD; `S(S-qti-add)` | TBD | Decline centre splits to deterministic long-edge bisection chain, not guaranteed 2x2; `D(D-place)` provisional, shared KDE+Windows; exact fixture TBD | V-START-SEED |
| R-START-03 | As START-02 plus E(240,240,1000,700); A/B/C minima 401x246, D(Paint) 864x617, E(Calc) 402x627; focus A,B,C,E,D; usable inner 2544x1364, gap 8 | Enable tiling | Feasibility fallback, skipped/floated/clamped writes, final origins, overlap/overflow | Same admission mechanism (focus raises make D topmost/MRU, admitted first); tiling allocation/cropping ignores minima and admission maps once at the resolved anchor with no alternative search; fixed-size (min==max) admits floating instead. Whether native clients overlap, overflow, clamp, or misrender in response is not established by allocation source; `S(S-cos-min)` + `S(S-cos-wstile)` + `S(S-cos-raise)` + `S(S-cos-axis)`; exact origins/frames/response TBD | Unsupported enable action as above; tiled limits default off (unclamped, no auto-float) but the admission anchor for this fixture is unevidenced; exact origins/frames TBD; `S(S-hyp-float)` + `S(S-hyp-min)` + `S(S-hyp-ins)` | Unsupported enable action as in START-01/02 (no tiling-off toggle; desktops always lay out tiles, float is per-window); hints off by default (opt-in leaf clamp on every reflow); exact origins/frames/fence wiring TBD; `S(S-bsp-layout)` + `S(S-bsp-hint)` + `S(S-bsp-min)` | Unsupported action parameter here: no tiling-off/enable toggle in source (workspaces always lay out tiles; float is per-window); tiled render ignores size hints while float clamps, exact origins/frames TBD; `S(S-i3-wsmode)` + `S(S-i3-min)` | Unsupported enable parameter as above (no tiling-off toggle); Tall sizing is unconditional (no minimum clamp in the tile path; fixed-size floats separately); exact origins/frames TBD; `S(S-xmo-layout)` + `S(S-xmo-admit)` | Unsupported enable parameter as above (no tiling-off toggle); tiled arrange ignores client hints (fraction normalize + 10px zeroing bound; `MIN_SANE` 100x60 gap-reservation only, no hint consult) while float clamp is config min/max (client hints on floating resize only); fixed-size min==max admits floating instead; exact origins/frames TBD; `S(S-sway-wsmode)` + `S(S-sway-min)` + `S(S-sway-max)` | Unsupported enable action as above; exact origins/frames TBD (tiled size-hint handling unevidenced in the inspected path); `S(S-qti-add)` + `S(S-qti-float)` | TBD | Windows: tile origin, extent at least declared minimum (overlap/overflow possible); KDE still skips; `D(D-place)` + `D(D-dec-win)` provisional divergence; exact fixture TBD | V-START-MIN |

## 7. Close / reflow

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | sway | qtile | awesome | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-CLOSE-01 | `H[A,B,C]`; focus A,C,B so B is active and C is next MRU | Close B | Collapse + focus selection (MRU vs spatial) | Survivors `[A,C]` keep order, proportional rescale; focus C (MRU top via fixup); `S(S-cos-rem)` + `S(S-cos-focusfix)` | Flat 3-child start has no ordinary binary form (default ratio 1 yields halves, not thirds); exact N-ary collapse TBD. Policy: live-tree removal promotes the sibling and recalcs; closed-focused refocus defaults to spatial `next` (closest node by old middle, else first/back fallback), not MRU C; cursor/MRU modes only via explicit `focus_on_close=1/2`; `S(S-hyp-close)` | Survivors `[A,C]` keep order with sibling promotion + arrange; focus C (history MRU via the focus guess, coinciding with MRU here, not a spatial rule); close asks the client (delete/kill), removal unlinks + drops history; exact frames TBD; `S(S-bsp-close)` | Survivors `[A,C]` keep nodes order with percent rescale; focus C (second in the focus stack via `con_next_focused`, coinciding with MRU here, not a spatial rule); `S(S-i3-close)` | Exact flat 3-child H has no Tall counterpart (flat N-ary H vs master/stack two-pane); analogous policy only: close removes B via `delete` (`sink` + `delete'`/`filter`, focus down else up, so C; positional, not MRU); survivors `[A,C]` keep stack order and refill via Tall recalc; exact frames TBD; `S(S-xmo-close)` + `S(S-xmo-layout)` | Survivors `[A,C]` keep order with fraction renormalize; focus C (focus-inactive view of the parent in MRU order, coinciding with MRU here, not a spatial rule); unmap detaches + reaps + rearranges; `S(S-sway-close)` | Flat 3-child start has no ordinary Columns form (default num_columns=2, third window stacks in-column); exact collapse/focus TBD. Policy: tiled close unlinks with sibling promotion, drops emptied columns with width-share redistribute, and refocuses positionally via the layout return (shipped focus_previous_on_window_remove=false, so no MRU previous_win); `S(S-qti-close)` | TBD | Leaf removed, C selected as source-MRU top; `D(D-dec-cos)` | V-CLOSE-FOCUS |
| R-CLOSE-02 | `H[A,B,C]` manual 50/30/20; focus A,C,B | Close B; focus C; open a new B with same app/rules | Survivor rescale; fresh admission vs old ratio/slot; reopened focus | Survivors rescale proportionally (ratio preserved); reopened B is fresh admission at C (after C, old slot not restored); focus newcomer; `S(S-cos-rem)` + `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)` + `S(S-cos-mapfocus)` | Flat 3-child start has no ordinary binary form; exact survivor widths and reopened frames TBD. Policy: close promotes sibling + recalc (ratios live on ancestors, no old-slot store); reopened B fresh-admits via the Dwindle anchor with newcomer focus, before/after by pointer half; `S(S-hyp-close)` + `S(S-hyp-ins)` + `S(S-hyp-newfocus)` | Survivors refill via sibling promotion + arrange (ratios live on ancestors, no old-slot store; exact 50/30/20 widths TBD without the binary embedding); reopened B fresh-inserts at the desktop focus after C with newcomer focus; `S(S-bsp-close)` + `S(S-bsp-insert)` | Survivors rescale proportionally via percent fix; reopened B fresh-admits after focused C with newcomer focus, no old-slot store; `S(S-i3-close)` + `S(S-i3-ins)` | Exact 50/30/20 flat-H fixture has no Tall counterpart (Tall splits master/stack at `frac`, stack splits equally); analogous policy only: survivors refill via removal + Tall recalc (no old-slot store; ratios live in `frac`/`nmaster`, not per-slot); reopened B fresh-admits via `insertUp` above focused C with newcomer focus; exact widths/frames TBD; `S(S-xmo-close)` + `S(S-xmo-ins)` + `S(S-xmo-layout)` | Survivors rescale proportionally via fraction renormalize; reopened B fresh-admits after focused C via the focus-inactive anchor with newcomer focus, no old-slot store; `S(S-sway-close)` + `S(S-sway-ins)` | Same non-ordinary start; exact survivor widths and reopened frames TBD. Policy: close redistributes the removed height/width share across survivors (no old-slot store); reopened B fresh-admits at the focused position with newcomer focus; `S(S-qti-close)` + `S(S-qti-add)` | TBD | TBD (close/reopen ratio memory and focus not checked here) | V-CLOSE-FOCUS |

## 8. Groups / stacks

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | sway | qtile | awesome | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-GRP-01 | `H[A,B*]` | Toggle stack on the group, switch tabs | Split-to-stack conversion; tab switch | Super+S toggles the focused node: fixture B is window-focused, so B alone becomes a single-tab stack (`H[A,S[B]]`, B active); group-focused converts the whole group to `S[A,B]` (A initially active). Stack splits back to tiles; tabs step with Focus Left/Right (Up/Down enters/leaves the group); `S(S-cos-stack)` + `D(D-ref)`; tab-bar visuals/native timing TBD | `toggleGroup` on focused B creates a one-window group at B's slot (`H[A,G[B]]`), no whole-group conversion counterpart; tab step on the single-member group errors/leaves current unchanged; multi-tab stepping wraps current and refocuses only if the group was focused; `S(S-hyp-groupop)`; bar visuals/native timing TBD | Unsupported action parameter here: no stack/tab group in source (monocle is a desktop layout, not tabs); toggle/tab-step outcomes TBD (no built-in equivalent); `S(S-bsp-layout)` | `layout tabbed` (or `stacked`) retargets the H parent, so `H[A,B*]` becomes a 2-tab tabbed (or stacked) parent with B active; `toggle` cycles stacked/tabbed/split; tabs step via directional focus (tabbed HORIZ left/right, stacked VERT up/down) or decoration tab click/scroll; `S(S-i3-layout)` + `S(S-i3-grp)`; exact toggle verb (tabbed vs stacked vs toggle split/all) and bar visuals/native timing TBD (gesture unspecified) | Unsupported action parameter here: no stack/tab group in source (core layouts Tall, Mirror Tall, Full only; `NextLayout` rotates layouts, no tab-toggle/tab-step verb in this profile); toggle/tab-step outcomes TBD (no built-in equivalent); `S(S-xmo-layout)` + `S(S-xmo-core-nav)` | `layout tabbed` (or `stacked`) retargets the H parent, so `H[A,B*]` becomes a 2-tab tabbed (or stacked) parent with B active (single-child flatten/workspace wrap like i3); tabs step via directional focus (tabbed left/right, stacked up/down, wrap per config); `S(S-sway-layout)` + `S(S-sway-focus)`; exact toggle verb (tabbed vs stacked vs toggle split/all) and bar visuals/native timing TBD (gesture unspecified) | Unsupported action parameter here: no tab-stack group in this profile (layouts are Columns plus Max only); the counterpart toggle_split flips the current column split/unsplit (unsplit shows one window, not tabs) with no tab-step verb; toggle/tab-step outcomes TBD (no built-in equivalent); `S(S-qti-split)` + `S(S-qti-default)` | TBD | Deferred: centre-stack drops refused fail-closed; no tab carrier/bindings; `D(D-dec-cos)` | V-GROUP-STACK |

## 9. Multi-output

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | sway | qtile | awesome | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-OUT-01 | `L=X`, `R=H[A*,B]` | Move A left (occupied target) | Cross vs wrap; target split shape | `L=H[X,A]`, `R=B` R4; [S20-01](../cosmic-move-conformance.md#sequence-s20---horizontal-output-crossing) authored observation | Off-monitor focal transfers via `assignToSpace` to the focal monitor's active workspace; exact L split shape TBD (L work area/X geometry, vertical alignment, and drop half unrecorded). Mechanism: 1px-beyond-edge focal, containing-else-nearest monitor query, fallback default true, then Dwindle re-admission anchor; `S(S-hyp-move)` | Crosses to L via configured `-s west --follow`: the west-neighbor search spans all monitors' focused desktops, so X qualifies; cross-monitor node swap puts A sole on L and X in A's R slot (`L=A`, `R=H[X,B]`), `--follow` focuses A on L; exact L split/frames TBD (monitor/X geometry unrecorded); `S(S-bsp-flt-focus)` + `S(S-bsp-flt-swap)` | Crosses to L: workspace-level H has no left swap, so `move_to_output_directed` attaches A to L's visible workspace at TAIL (nodes `[X,A]`, splith embedding `H[X,A]` under default `workspace_layout`); R collapses to sole B; mover-focused follow via `workspace_show` focuses A on L; `S(S-i3-move)` + `S(S-i3-outmove)`; exact L wrapper if L has non-default `workspace_layout` TBD (no custom rules here) | Exact occupied-target crossing TBD (Tall target geometry unrecorded); analogous policy only: profile move is same-layer `windowSwap` (geometric target via `navigableWindows`; `swap` exchanges stack positions retaining mover focus, miss is no-op with wrap False); cross-screen carry via the separate `windowToScreen` (`W.shift`) verb is not exercised here; exact L split/frames TBD; `S(S-xmo-out)` + `S(S-xmo-nav)` + `S(S-xmo-layout)` | Crosses to L: workspace-level H has no left swap, so the next-output attach moves A to L's active workspace at TAIL (nodes `[X,A]`, splith embedding `H[X,A]` under default `workspace_layout`); R collapses to sole B; focus stays on the mover A on L (no workspace-switch call in this path); `S(S-sway-move)` + `S(S-sway-outmove)`; exact L wrapper if L has non-default `workspace_layout` TBD (no custom rules here) | No-op: leftmost sole-column A has no adjacent column and no shared column to split, so shuffle_left returns with tree and focus unchanged; no directional cross-screen carry in Columns (screen placement is togroup/toscreen, not exercised here); `S(S-qti-shuffle)` + `S(S-qti-group)` | TBD | Exhausted horizontal R4 into output's current workspace; same commit/fence protocol as send; `D(D-dec-cos)` offline only | V-R4-DIR |
| R-OUT-02 | `L=X`, `R=V[A*,B]` | Move A left (perpendicular) | In-output wrap wins vs cross | No cross; `R=H[A,B]` R1; [S21-01](../cosmic-move-conformance.md#sequence-s21---perpendicular-wrapno-cross-case) authored observation | Exact cross-vs-local TBD (monitor arrangement/edge adjacency and vertical alignment unrecorded, so the 1px focal may sit on L or R). Policy: focal off-monitor with fallback crosses via `assignToSpace`, else local remove+reinsert ordered by focal half; `S(S-hyp-move)` | Crosses rather than local-wrapping under `-s west --follow`: the west search spans monitors, so full-height X qualifies west of A (shared vertical range) while B sits south; A swaps with X (`L=A`, `R=V[X,B]`), `--follow` focuses A on L; no R1-style local wrap in source; exact frames TBD; `S(S-bsp-flt-focus)` + `S(S-bsp-flt-swap)` | No cross: perpendicular LEFT finds no HORIZ parent, so the workspace force-wraps to H and A inserts above its V parent (`H[A,V[B]]`, lone `V[B]` wrapper persists); focus stays A; `S(S-i3-move)` + `S(S-i3-outmove)` | Exact perpendicular `V` fixture has no active-Tall counterpart (no nested V; Tall is fixed master/stack side-by-side, `Mirror Tall` not assumed in this profile); analogous policy only: no local-wrap primitive exists (selection is purely geometric line/side/center, never tree-orientation), so a qualifying western X still swaps rather than wrapping locally; exact cross-vs-local TBD (output/monitor geometry unrecorded); `S(S-xmo-out)` + `S(S-xmo-nav)` | No cross: perpendicular LEFT finds no HORIZ parent, so the workspace force-wraps to H and A inserts above its V parent (`H[A,V[B]]`, lone `V[B]` wrapper persists); focus stays A; `S(S-sway-move)` + `S(S-sway-outmove)` | No cross: shuffle_left on the single column carrying A above B prepends a new column holding A (local split into two columns), never crossing screens; exact frames and drop-side focus TBD; `S(S-qti-shuffle)` | TBD | Local R1 wins first; `D(D-dec-cos)` | V-R4-DIR |

## 10. Mouse drag

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | sway | qtile | awesome | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-DRAG-01 | `H[A,B*,C]`, B tiled | Drag B onto C's centre (not an edge); release | Stack join vs refusal; source restoration | Centre WindowStack drop converts the target to a stack and appends the mover's surfaces; tiling drags run in overview mode with drop-zone placeholders. The centre region is the rounded central thirds of the target frame, outside it the nearest edge picks the `WindowSplit` direction; `S(S-cos-drop)` + `S(S-cos-zone)` + `S(S-cos-dragedge)`; native preview delivery TBD | No centre-stack mapping: ungrouped C cannot accept a group join (join needs a grouped hover + `drag_into_group` + grouping gates); B floats at threshold (siblings refill) then re-tiles via fresh Dwindle admission, no old-slot restore; exact re-admission position TBD (release geometry unrecorded); `S(S-hyp-drag)` + `S(S-hyp-dragend)` + `S(S-hyp-ins)` | No stack join: pointer ACTION_MOVE over tiled C swaps B/C in place (`H[A,C,B]`, focus stays B; same-desktop swap writes borders only); centre-vs-edge not distinguished, no group counterpart; exact hover pixel TBD; `S(S-bsp-drag)` + `S(S-bsp-flt-swap)` | No COSMIC stack join: centre DT_CENTER (cursor outside 30% edge bands) runs `con_move_to_target` without swap (Shift swap-modifier `con_swap` instead); tiled producer needs an enabled `tiling_drag` path (shipped modifier+titlebar, code default modifier-only) with >1 drop target, else no drag starts; self-centre/Esc/NULL-target aborts with indicator destroy and no mutation; `S(S-i3-tdrag)` + `S(S-i3-tdrop)`; exact centre pixel/swap state and native preview TBD | No centre-stack mapping in source: no stack/tab join verb in this profile; `mod-button1` drag floats B on motion (survivors refill via Tall recalc) and floats again on release, then `shiftMaster`; no peer mutation, no slot restore; exact release frame TBD; `S(S-xmo-mouse)` + `S(S-xmo-layout)` | No COSMIC stack join: content-centre (outside 30% edge bands, not a titlebar) runs centre `container_swap` with the hovered target (titlebar hover instead tabifies via `container_split` L_TABBED + indexed insert); needs enabled `tiling_drag` (shipped enabled, threshold 9) with >1 tiling view, else NULL abort; self/descendant-centre NULL aborts with indicator destroy and no mutation; swap preserves mover focus on the same workspace; `S(S-sway-tdrag)` + `S(S-sway-tdrop)`; exact centre pixel and native preview TBD | No stack join: pointer over C runs the explicit set_position swap (B/C exchange places with heights, no centre/edge distinction); shipped Mod+Button1 instead runs set_position_floating (floating tweak, not the tiled swap); exact hover pixel and drop-side focus TBD; `S(S-qti-drag)` + `S(S-qti-tweak)` | TBD | Centre stack request refused (snap-back); `D(D-dec-cos)` + `D(D-dec-nest)`; physical check pending | V-DRAG-ZONE |
| R-DRAG-02 | `H[A,B,C]` equal (640 each at 1920); existing N outside that group | Drag N to the between-child bar between A and B; release | Flat vs nested; mover share (n=4 after insertion) | Flat `H[A,N,B,C]`, all 480 (mover 1/n, peers scaled); `UT(2026-08-22)` + [Test B](../cosmic-move-conformance.md#follow-up-manual-observations-tests-a-c); GroupInterior drop inserts at the hovered index; `S(S-cos-drop)` | No between-child bar/index mapping in source; if N starts tiled it floats at threshold then re-tiles via the Dwindle admission anchor at the drop point, while ordinary floating N stays floating absent a successful group join (ungrouped A/B/C offer none); exact outcome TBD (N initial state, binary embedding/bar equivalent, and drop geometry unspecified); `S(S-hyp-drag)` + `S(S-hyp-dragend)` + `S(S-hyp-ins)` | No between-child bar/index mapping: a bar hover is unmanaged (root/gap), so no swap/insert occurs and N stays put on the same monitor (off all monitors likewise no-ops); a cross-monitor point instead transfers to that monitor's focus; exact bar pixel/N start state TBD; `S(S-bsp-drag)` | No between-child bar/index mapping: the bar x resolves via nearest-edge direction into DT_SIBLING (inside the 30% edge band, split if parent orientation differs then `insert_con_into`) or DT_CENTER (`con_move_to_target`, or `con_swap` with Shift); orientation comes from the edge direction, not splith default; focus preserved; `S(S-i3-tdrag)` + `S(S-i3-tdrop)`; exact bar pixel, N start state (tiled vs floating) and mover share/frames TBD (drop geometry unspecified) | No between-child bar/index mapping in source: the pointer path writes one floating frame and never inserts at an index; N stays floating at its dragged frame plus `shiftMaster`, no flat/nested admission, no 1/n share; exact bar pixel/N start TBD; `S(S-xmo-mouse)` | No between-child bar mapping as such: a titlebar hover inserts flat at the computed bar index via `split_titlebar`/`split_border` (`H[A,N,B,C]` shape when bars are the hover); content hover resolves via nearest-edge into edge split+insert vs centre swap, orientation from the edge direction; the mover adopts a sibling share (finalize copies sibling fractions); `S(S-sway-tdrag)` + `S(S-sway-tdrop)`; exact bar pixel, N start state and frames TBD (drop geometry unspecified) | No between-child bar/index mapping in source: a bar hover hits no window, so set_position swaps nothing and N stays; shipped Mod+Button1 instead tweaks N's frame on the floating path; exact outcome TBD (producer, N float state, and bar pixel unspecified); `S(S-qti-drag)` + `S(S-qti-tweak)` | TBD | TBD (between-child drop not checked here) | V-DRAG-ZONE |
| R-DRAG-03 | `H[A,B*]`, both tiled | Title-bar drag B to A's top edge; repeat from the same start with Meta/Win+left client drag | Same drop topology and mover; no client click or sibling reflow before drop | No client click on either path: Super-held presses are suppressed in the compositor, title-bar drags start server-side; the grabbed source unmaps to a `GrabbedWindow` placeholder holding its slot (siblings do not reflow into it). A's top edge resolves to `WindowSplit` Up (nearest-edge pick; centre-thirds would stack instead); `S(S-cos-dragstart)` + `S(S-cos-dragedge)`; native reflow frames TBD | Dispatcher support only, not a default-binding claim: `mouse:movewindow` begins a drag on hit, decoration `DRAG_START` hit skips it; threshold default 0 floats B at grab so siblings refill mid-hold (no slot placeholder); drop re-tiles via fresh admission; same-topology across producers and client-click behavior TBD (release geometry/client ack unrecorded); `S(S-hyp-keyend)` + `S(S-hyp-drag)` + `S(S-hyp-dragend)` | Producers differ: Meta/Win+button1 ACTION_MOVE drags B with per-motion hover swaps (top-edge hover over A swaps A/B, edge-vs-centre not distinguished; the grab itself writes no focus); a bare title-bar drag without the pointer modifier has no counterpart in source; cross-producer same-topology TBD (title-bar leg unevidenced); `S(S-bsp-drag)` | Both producers start the same tiled drag under shipped `tiling_drag modifier titlebar` (modifier+left anywhere incl client; titlebar left without modifier; code default modifier-only refuses the titlebar-only path): modifier path starts immediately before focus, titlebar path focuses first then drags thresholded (~15px) with no client click in either case; grabbed source stays mapped with indicator-only preview (siblings do not reflow mid-hold); A's top edge is nearest-edge DT_SIBLING Up (outer thin band would be DT_PARENT instead); `S(S-i3-tdrag)` + `S(S-i3-tdrop)`; exact edge pixel/parent-band and native frames TBD | Producers share no drop topology: only `mod-button1` (move) and `mod-button3` (resize) drags exist, both float on motion/release plus `shiftMaster`; a bare title-bar drag without the modifier has no counterpart in source; no edge/centre topology, no placeholder; same-topology TBD (title-bar leg unevidenced); `S(S-xmo-mouse)` | Both producers start the same tiled drag under settled-enabled `tiling_drag` (modifier+left anywhere incl client; titlebar left without modifier; code defaults enabled/threshold 9, unlike the i3 modifier-only default): press focuses first via the generic click-focus path with no client button forwarded before the grab, then modifier begins immediately while titlebar waits for the output-scaled 9px threshold; the grabbed source stays attached with indicator-only preview (detach only at finalize; siblings do not reflow mid-hold); A's top edge is a 30px/30% edge split Up (the outer layout-border walk may take a layout parent instead); `S(S-sway-tdrag)` + `S(S-sway-tdrop)`; exact edge pixel/parent-band and native frames TBD | Producers differ: shipped Mod+Button1/Button3 are floating tweaks (frame write plus closest-screen transfer, never the tiled set_position swap); a bare title-bar drag has no counterpart in the shipped bindings; cross-producer same-topology TBD (title-bar leg unevidenced); `S(S-qti-tweak)` + `S(S-qti-drag)` | TBD | KDE: same resolver selected `D(D-dec-drag)`; Windows: both producers delivered with three-window synthetic preview/drop agreement and mid-hold sibling stability; exact row TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-04 | `H[A,B*]`, both tiled | Start moving B; press Esc; release | Source topology/geometry retained; no drop plan; preview cleared | Bare Escape intercepts to `PrivateAction::Escape`, which unsets the pointer grab; the move-grab `unset` is a no-op so dropping the grab runs the normal `Drop` `drop_window` at the current hover: no cancel path exists, and a zero-move drop restores via the `InitialPlaceholder`; `S(S-cos-dragesc)` + `S(S-cos-drop)`; moved-then-Escaped exact topology TBD (fixture states no hover/drop point, so which `drop_window` branch runs is unspecified; the normal-drop mechanism itself is proven) | No Esc cancel path: any key press (Esc included) runs the normal `endDragTarget` drop, never a restore; moved-then-Esc exact topology TBD (hover/drop point unrecorded); `S(S-hyp-keyend)` + `S(S-hyp-dragend)` | No Esc/key cancel path: pointer grabs end only on button release; key presses run the generic event switch with no grab-cancel branch, so performed hover swaps persist and release ends normally; moved-then-Esc exact topology TBD (hover/drop point unspecified); `S(S-bsp-drag)` | Any key press (Esc included) during the drag reverts: `tiling_drag` aborts with indicator destroy and no tree/focus mutation, never a drop-at-hover; `S(S-i3-tdrag)`; no drop plan and no preview residue by source | No Esc/key cancel path in source: the pointer grab ends only on button release, which runs release `done` (`float`, never a restore); performed motion persists as B floating at its written frame plus `shiftMaster`; moved-then-Esc exact topology TBD (hover/drop point unspecified; the normal-release mechanism itself is sourced); `S(S-xmo-mouse)` | No key-press cancellation hook: bare Esc does not revert or end the tiled drag; release runs the normal `finalize_move` at the current hover (NULL hover aborts with no mutation, otherwise drops); diverges from the i3 any-key revert; `S(S-sway-tdrag)` + `S(S-sway-tdrop)`; moved-then-Esc exact topology TBD (hover/drop point unspecified; the normal-drop mechanism itself is sourced) | No key-cancel branch in the inspected drag inventory (set_position swap, floating tweaks, shipped Drag/Click bindings only): release runs the normal swap-or-tweak at the current pointer, so performed motion persists; moved-then-Esc exact topology TBD (hover/drop point unspecified); `S(S-qti-drag)` + `S(S-qti-tweak)` | TBD | KDE: cancelled verdict makes no plan and clears preview `D(D-dec-drag)`; Windows: synthetic title/Win Esc restores all frames without mutation, Win preview hidden before Up; physical edge/exact row TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-05 | `H[A,B*]`, both tiled | Press/release the move gesture on B without moving | No topology/share change or preview residue | Client-initiated moves stay `Delayed` below 1px motion; a no-move tiling drop restores the source slot via `InitialPlaceholder`; `S(S-cos-dragthresh)`; native residue TBD | Threshold default 0 picks B up immediately (float + sibling refill), so release re-tiles via fresh admission rather than slot restore; exact rebuilt topology TBD (no motion/drop point recorded); no preview/placeholder residue path established in source; `S(S-hyp-drag)` + `S(S-hyp-dragend)` | No mutation: zero-move press/release runs no MOTION path so `move_client` is never called; any sub-threshold motion over B's own window returns false (pointer still over self), so no swap/transfer occurs; no threshold pickup, placeholder, or indicator residue path in source; `S(S-bsp-drag)` | No mutation: titlebar-path press/release stays under the ~15px threshold so the callback never runs (NULL target abort); modifier-path immediate pick-up released over its own centre hits the self-centre no-draw abort; both destroy the indicator with no preview residue; `S(S-i3-tdrag)` + `S(S-i3-tdrop)`; native residue TBD only outside this source path | Not no-mutation here: even zero-move press/release runs release `done` (`float w`) plus `shiftMaster`, so B floats at its unchanged frame and becomes master (survivors refill around the floater via Tall recalc); no threshold distinction, no preview/placeholder residue path; exact frame TBD; `S(S-xmo-mouse)` + `S(S-xmo-layout)` | No mutation: titlebar press/release under the output-scaled 9px threshold never reaches post-threshold targeting (`finalize_move` with NULL target returns to default with indicator destroy); modifier immediate pick-up released over its own centre/titlebar hits the self/descendant NULL abort (source-titlebar cancel + self-centre guard); both destroy the indicator with no preview residue; `S(S-sway-tdrag)` + `S(S-sway-tdrop)`; native residue TBD only outside this source path | No mutation: with the pointer still over B's own frame set_position skips self and finds no other hit, so no swap occurs; a zero-delta floating tweak rewrites the same frame; no threshold pickup, placeholder, or indicator residue path in source; `S(S-qti-drag)` + `S(S-qti-tweak)` | TBD | KDE: no-change verdict makes no plan `D(D-dec-drag)`; Windows: synthetic title/Win zero-move preserves all frames without mutation or preview residue on a three-window fixture; exact row TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-06 | `H[A,B*]`, one output with a panel/taskbar outside the work area | Move B; release over the panel/taskbar outside the work area | Source restoration vs off-area placement; preview cleared | Drop geometries come from the work-area `non_exclusive_zone`, so a pointer over the panel matches no tile geometry and yields no zone: the hover placeholders clear and the drop falls back to a fresh `map_to_tree` admission inside the work area (neither off-area placement nor source-slot restore); `S(S-cos-dropzone)`; realized native frames TBD | No off-area placement and no slot restore: release re-tiles inside the work area via fresh admission (floating-middle monitor check only moves workspaces, never parks on panels); exact frames TBD (panel/monitor geometry unrecorded); `S(S-hyp-drag)` + `S(S-hyp-dragend)` | No off-area placement and no source-restore step: panel hover is unmanaged on the same monitor (no swap), off all monitors likewise no-ops; tiled B never leaves the tree mid-hold; which branch runs TBD (panel geometry/containment unrecorded); no preview residue path; `S(S-bsp-drag)` | No off-area placement: pointer off all outputs yields NULL target and aborts with no mutation; pointer inside the output but outside tiles falls back to the visible-workspace admission inside the work area; `S(S-i3-tdrop)`; which branch runs is TBD (panel/taskbar geometry and output containment unrecorded); indicator destroyed either way | Off-workarea frame retained and no source-restore step: the pointer path writes the raw frame with no zone check and release floats there plus `shiftMaster`; no admission fallback parks it back inside; exact panel/drop containment TBD (panel geometry unrecorded); no preview residue path; `S(S-xmo-mouse)` | No off-area placement: pointer over a layer surface (panel/taskbar) yields a NULL node and NULL target, and release aborts with no mutation (indicator destroyed at seatop end); only workspace/edge targets inside the output admit, never parking on the panel; `S(S-sway-tdrop)`; which branch runs is TBD (panel/taskbar geometry and output containment unrecorded); indicator destroyed either way | No off-area placement via set_position (panel hover hits no tiled window, so no swap; tiled B never leaves the layout mid-hold); floating tweak_float transfers across screens by closest-screen only, never parks on panels; which branch runs TBD (producer and panel geometry unrecorded); no preview residue path; `S(S-qti-drag)` + `S(S-qti-tweak)` | TBD | KDE: unresolved target snaps back `D(D-dec-drag)`; Windows: title/Win taskbar-outside refusal restores all frames without mutation or preview residue on a three-window fixture; exact row TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-07 | `H[A,B*]`, both tiled | Meta/Win+left client drag B to A's edge; pause before release | Native frame follows pointer vs retained source allocation with target-slot preview; final placement unchanged | Tiling mover image follows the pointer at retained client size (pointer motion writes the grab location, render translates retained geometry by location+offset), scaled 0.6->1.0 over 150ms (0.4 alpha on other outputs), with a `StackHover` indicator and overview drop-zone placeholders; the source unmaps to a `GrabbedWindow` placeholder at grab start; `S(S-cos-dragframe)`; native pixels/timing TBD | Dragged frame follows the pointer (floating position writes + warp) while the tiled source already refilled at pick-up; no target-slot preview/placeholder established in source; final placement is the drop re-tile, exact position TBD; `S(S-hyp-drag)` + `S(S-hyp-dragend)`; visuals/timing TBD | Retained allocation mid-hold: the tiled mover stays in tree until a hover swap/transfer (no pointer-following frame write, no scale/alpha/indicator or target-slot preview in source); siblings reflow only on swap/transfer; exact final position TBD; `S(S-bsp-drag)` | Retained allocation mid-hold: tiled `tiling_drag` never writes the source frame, it only draws the `i3-drag` drop indicator at the target slot (siblings do not reflow until drop); this is the floating-modifier client path, distinct from `floating_drag_window` which moves the floating frame; final placement follows the DT_SIBLING/CENTER/PARENT branch for A's edge; `S(S-i3-tdrag)` + `S(S-i3-tdrop)`; native pixels/timing TBD | Frame follows the pointer: per-motion `moveWindow` at retained size with `float` on each motion (survivors refill mid-hold, no slot placeholder); no target-slot preview; final placement is the floated frame plus `shiftMaster`, never a drop branch; visuals/timing TBD; `S(S-xmo-mouse)` | Retained allocation mid-hold: the mover stays attached until finalize (`container_detach` only on the non-swap drop; the swap path re-links in place), so siblings do not reflow; only the indicator rect moves (drop-box positioned/sized per target) with pointer focus cleared at begin; final placement follows the titlebar-tabbed/edge-split/centre-swap/empty-workspace branch for A's edge; `S(S-sway-tdrag)` + `S(S-sway-tdrop)`; native pixels/timing TBD | Shipped producer follows the pointer by floating tweak (frame writes on motion, then closest-screen transfer only; no slot preview, scale, or indicator in source); explicit set_position swaps only at invocation with no mid-hold preview either; exact pixels and final placement TBD; `S(S-qti-tweak)` + `S(S-qti-drag)` | TBD | KDE: native frame moves and target-slot preview is selected `D(D-dec-drag)`; Windows: provisional stationary source with visible target-slot preview, three-window synthetic freeze/preview/drop proof; exact row TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-08 | `H[A*,B]`, B unfocused tiled | Meta/Win+left client press on B; move; release at A's edge | Native focus changes at press vs drop; dragged group visual without changing retained focus | Pointer press changes keyboard focus unless the pointer is grabbed; the Super+Left move path focuses the target at press and the drop focuses the dropped mapped; `S(S-cos-dragpress)` + `S(S-cos-dragframe)`; dragged-group visuals TBD | Press focuses B (`rawWindowFocus` + raise at `dragBegin`), drop focuses the dragged; dispatcher/begin-drag policy only, not a default-binding claim; exact edge position and group visuals TBD; `S(S-hyp-drag)` + `S(S-hyp-dragend)` + `S(S-hyp-keyend)` | Press writes no focus (the ACTION_MOVE grab path has no focus write; focus only via the separate ACTION_FOCUS/click path); same-monitor hover swap writes borders only, so B stays unfocused mid-hold and after; exact visuals TBD; `S(S-bsp-drag)` | Modifier-client press does not focus before the drag (tiling drag masks enter-window; end restores focus/fullscreen, with old-focus restore on the DT_PARENT `tree_move` path), so B stays unfocused mid-hold; drop-side focus follows the branch taken, not a promised mover-focus; `S(S-i3-tdrag)` + `S(S-i3-tdrop)`; exact press-vs-drop focus and dragged-group visuals TBD (edge pixel and branch unspecified; titlebar producer would focus first instead) | Press focuses B (`focus w` runs before `mouseMoveWindow`), mid-hold retains B (no focus write in the motion path), release `shiftMaster` keeps focus on B; no dragged-group visual path; exact edge position TBD; `S(S-xmo-mouse)` | Press focuses B first via the generic click-focus path (titlebar press selects the inactive view; client press focuses the container), then the drag begins with pointer focus cleared; mid-hold retains B's seat focus (no focus write in the motion path); drop-side focus follows the branch taken - non-swap inserts keep seat focus, centre `container_swap` preserves the mover focus on the same workspace via `swap_focus`; diverges from the i3 modifier-no-focus path; `S(S-sway-tdrag)` + `S(S-sway-tdrop)`; exact press-vs-drop focus and dragged-group visuals TBD (edge pixel and branch unspecified) | Press focuses B first via follow_mouse_focus=true (shipped; bring_front_click=false, only Mod+Button2 bring_to_front bound); mid-hold retains B; drop-side focus TBD (Columns swap writes no focus; exact branch/edge unspecified); `S(S-qti-tweak)` + `S(S-qti-drag)` | TBD | KDE: exact focus timing TBD; Windows: provisional foreground retained during hold, B activated on valid drop; synthetic unfocused-mover proof, C parked `D(D-win-drag)` | V-DRAG-ZONE |

## 11. Owner controls and startup settings

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | sway | qtile | awesome | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-CTL-01 | Windows settings absent | Start owner; choose Compatible; stop; restart | Preset persists; first-run prompt does not recur | Not applicable to the pinned compositor source: no first-run prompt or preset writer in cosmic-comp; tiling default is the `autotile` config key (`S(S-cos-ctl-tile)`); preset/prompt journey TBD (owner-specific) | No counterpart in source: dispatcher inventory at pin lists no first-run/preset/prompt actions; outcome TBD (owner-specific); `S(S-hyp-shortcut)` | No counterpart in source: wm command inventory lists dump/load-state/add-monitor/reorder-monitors/adopt-orphans/get-status/record-history/restart only, no first-run/preset/prompt writer; outcome TBD (owner-specific); `S(S-bsp-ctl)` | No Compatible preset/prompt model in inspected source: closest writer `i3-config-wizard` exits when a config exists (no overwrite, fresh-write only); preset choice/restart persistence TBD (owner-specific, no counterpart); `S(S-i3-wiz)` | No counterpart in source: key inventory at pin lists spawn/kill/layout/focus/swap/sink/quit/restart only, no first-run/preset/prompt writer; preset choice/restart persistence TBD (owner-specific, no counterpart); `S(S-xmo-ctl)` | No counterpart in source: command inventory at pin lists `reload`/`exit`/`bindsym`/`bindcode`/`unbindsym`/`unbindcode` but no first-run/preset/prompt actions and no `restart` verb (in-place reload only); preset choice/restart persistence TBD (owner-specific, no counterpart); `S(S-sway-reload)` + `S(S-sway-bind)` | No counterpart in source: no first-run prompt or preset writer (static Keys/config loaded at startup; restart only dumps group/layout/screen state, reload rebuilds from config); preset choice/restart persistence TBD (owner-specific, no counterpart); `S(S-qti-keys)` + `S(S-qti-state)` | TBD | Windows: authentic default offered, compatible saves 35 disabled rows; existing-file startup skips prompt; synthetic/native proof [tray record](../changes/archive/windows-tray-first-run.md); KDE first-run TBD | V-FIRST-RUN |
| R-CTL-02 | Owner's first-run prompt open, settings absent | Publish settings from another writer; accept stale prompt choice | Preserve newer settings vs overwrite | Not applicable to the pinned compositor source: no prompt/settings-race UI in cosmic-comp; `system_actions`/shortcut maps merge system then user config (`S(S-cos-syscmd)`); stale-choice outcome TBD (owner-specific) | No counterpart in source: no prompt/settings-race UI or stale-choice path; outcome TBD (owner-specific); `S(S-hyp-shortcut)` | No counterpart in source: no prompt/settings-race UI or stale-choice path in the inspected inventory; stale-choice preserve/overwrite TBD (owner-specific, no counterpart); `S(S-bsp-ctl)` | No settings-race/stale-choice path in inspected source: wizard guard exits on existing config without comparing writers; stale-choice preserve/overwrite TBD (owner-specific, no counterpart); `S(S-i3-wiz)` | No counterpart in source: no prompt/settings-race UI or stale-choice path in the inspected key inventory; stale-choice preserve/overwrite TBD (owner-specific, no counterpart); `S(S-xmo-ctl)` | No counterpart in source: no prompt/settings-race UI or stale-choice path in the inspected command/config inventory; stale-choice preserve/overwrite TBD (owner-specific, no counterpart); `S(S-sway-reload)` + `S(S-sway-bind)` | No counterpart in source: no prompt/settings-race UI or stale-choice path in the inspected key/config inventory; stale-choice preserve/overwrite TBD (owner-specific, no counterpart); `S(S-qti-keys)` | TBD | Windows: discard stale choice, load authoritative file, bytes unchanged; same record; other platforms TBD | V-FIRST-RUN |
| R-CTL-03 | Running owner with notification icon | Lose icon registration; post TaskbarCreated; stop from menu | Exactly one icon returns; Stop removes icon and owner effects | Not applicable to the pinned compositor source: no tray icon lifecycle in cosmic-comp; outcome TBD (owner-specific) | No counterpart in source: no tray icon lifecycle (only unrelated xwayland tray atoms); outcome TBD (owner-specific); `S(S-hyp-shortcut)` | No counterpart in source: no tray icon lifecycle in the inspected inventory (wm verbs as in CTL-01); single-icon return/Stop cleanup TBD (owner-specific, no counterpart); `S(S-bsp-ctl)` | No owner notification-icon lifecycle in inspected source: tray inventory is bar-hosted XEMBED (`tray_output`/`tray_padding`, selection window, trayclients); single-icon return/Stop cleanup TBD (owner-specific, no counterpart); `S(S-i3-tray)` | No counterpart in source: no tray icon lifecycle in the inspected key/mouse inventory; single-icon return/Stop cleanup TBD (owner-specific, no counterpart); `S(S-xmo-ctl)` | No owner notification-icon lifecycle in inspected source: tray inventory is bar-hosted (`tray_output`/`tray_padding`/`tray_bindcode`/`tray_bindsym`, `HAVE_TRAY`); single-icon return/Stop cleanup TBD (owner-specific, no counterpart); `S(S-sway-tray)` | No owner notification-icon lifecycle in inspected source: tray inventory is the bar-hosted X11-only Systray widget (hosts client icons); single-icon return/Stop cleanup TBD (owner-specific, no counterpart); `S(S-qti-tray)` | TBD | Windows: GUID-delete fixture then posted message re-adds one icon; actual menu Stop cleans up; same record. Real Explorer restart TBD; KDE lifecycle is separate | V-TRAY-LIFECYCLE |
| R-CTL-04 | Existing tiled workspace, new-workspace default Tiled | Save Floating default; create new workspace; restart owner | Existing override stays, new workspace floating, startup saved default | Tiling default is the `autotile` config: new workspaces inherit the set's `tiling_enabled`; `Global` behavior retoggles existing workspaces, `PerWorkspace` applies to new windows/workspaces only; `S(S-cos-ctl-tile)`; saved-default restart journey and per-workspace override persistence TBD | Unsupported action parameter here: no workspace tiling flag or floating default in source (float is per-window; workspace rules carry no tiling default); new workspaces admit per-window, existing overrides N/A; saved-default restart journey TBD (owner-specific); `S(S-hyp-wsrule)` | Unsupported action parameter here: no workspace tiling flag or floating default in source (desktop layout tiled/monocle only; float is per-window); new-workspace/existing-override/saved-default restart TBD (no built-in equivalent); `S(S-bsp-layout)` + `S(S-bsp-ctl)` | Unsupported action parameter here: no workspace tiling flag or floating default in source (float is per-window; `workspace_layout` default/stacked/tabbed only); new-workspace/existing-override/saved-default restart TBD (no built-in equivalent); `S(S-i3-wsmode)` | Unsupported action parameter here: no workspace tiling flag or floating default in source (layout always tiles plus a floating layer; float is per-window); new-workspace/existing-override/saved-default restart TBD (no built-in equivalent); `S(S-xmo-layout)` + `S(S-xmo-ctl)` | Unsupported action parameter here: no workspace tiling flag or floating default in source (float is per-window; `workspace_layout` default/stacked/tabbed only); new-workspace/existing-override/saved-default restart TBD (no built-in equivalent); `S(S-sway-wsmode)` | Unsupported action parameter here: no per-group tiling flag or floating default in source (static groups, one global floating_layout, float is per-window); new-group/existing-override/saved-default restart TBD (no built-in equivalent); `S(S-qti-wsdef)` | TBD | KDE selected `D(D-dec-ww)`, default live proof TBD; Windows tray/UI file readbacks, owner adoption, existing tiled/new floating checks and saved-default startup native proof [record](../changes/archive/windows-workspace-tiling.md); physical restart journey TBD | V-WS-TILING |
| R-CTL-05 | KDE focus-right kept; Lock Session on Meta+L | Stage Compatible; ordinary settings Save; Apply Shortcuts; reopen; restart session | Staging/Save leave shortcuts untouched; Disable survives; Lock Session unchanged | Closest COSMIC equivalent: shortcut state is system `defaults` plus user `custom`, `Disable` masks a default binding, and the compositor hot-reloads on config change; there is no staging/Compatible/Force model in the sourced components, so Save/Apply/restart semantics have no counterpart here; `S(S-cos-shortcut)`; owner-specific outcome TBD | Closest Hyprland equivalent: conflict lookup plus `unbind` exist, but no Compatible staging/Save/Apply/Force model in source, so Save/Apply/restart semantics have no counterpart here; owner-specific outcome TBD; `S(S-hyp-shortcut)` | Closest bspwm equivalent: node `-t` state (incl `~` alternate) and `-g` flags exist, but no Compatible staging/Save/Apply/Force model in source, so Save/Apply/restart semantics have no counterpart here; owner-specific outcome TBD; `S(S-bsp-ctl)` | Closest i3 equivalent: `bindsym`/`bindcode` defines bindings via `configure_binding`, applied on reload/restart; no Compatible staging/Save/Apply/Force model in the inspected command/config inventory, so Save/Apply/restart semantics have no counterpart here; owner-specific outcome TBD; `S(S-i3-bind)` | Closest xmonad equivalent: keys/mouseBindings define bindings applied on restart/recompile; no Compatible staging/Save/Apply/Force model in source, so Save/Apply/restart semantics have no counterpart here; owner-specific outcome TBD; `S(S-xmo-ctl)` | Closest sway equivalent: `bindsym`/`bindcode` defines bindings, applied on reload; no Compatible staging/Save/Apply/Force model in the inspected command inventory, so Save/Apply/restart semantics have no counterpart here; owner-specific outcome TBD; `S(S-sway-bind)` + `S(S-sway-reload)` | Closest qtile equivalent: static Key bindings grabbed at startup and re-grabbed on reload (ungrab/clear/regrab, no staging/Compatible/Apply/Force model); Save/Apply/restart semantics have no counterpart here; owner-specific outcome TBD; `S(S-qti-keys)` | TBD | KDE selected: explicit own-action clear, native storage authoritative, no Lock relocation while disabled; live restart/physical delivery TBD [record](../changes/kde-shortcut-conflicts.md) | V-SHORTCUT-CONFLICT |
| R-CTL-06 | KDE foreign action has a project chord plus an unrelated chord | Keep conflicting row; Apply; preview Force; edit row to Disable; try Force; Apply | Draft edit invalidates preview; disabled row causes no foreign clearing; unrelated chord survives | Closest COSMIC equivalent: writing `Disable` for one binding in `custom` masks only that default while unrelated chords keep resolving from `defaults`; there is no preview/Force step in the sourced components; `S(S-cos-shortcut)`; owner-specific outcome TBD | Closest Hyprland equivalent: conflict lookup plus `unbind` exist, but no preview/Force/draft step in source; owner-specific outcome TBD; `S(S-hyp-shortcut)` | Closest bspwm equivalent: node `-t`/`-g` exist, but no preview/Force/draft/Disable-masking model in the inspected inventory; draft/Disable/unrelated-chord outcome TBD (owner-specific, no counterpart); `S(S-bsp-ctl)` | Closest i3 equivalent: `bindsym`/`bindcode` defines bindings via `configure_binding`; no preview/Force/draft/Disable-masking model in the inspected inventory; draft/Disable/unrelated-chord outcome TBD (owner-specific, no counterpart); `S(S-i3-bind)` | Closest xmonad equivalent: `keys` defines bindings; no preview/Force/draft/Disable-masking model in the inspected inventory; draft/Disable/unrelated-chord outcome TBD (owner-specific, no counterpart); `S(S-xmo-ctl)` | Closest sway equivalent: `bindsym`/`bindcode` defines bindings, `unbindsym`/`unbindcode` removes; no preview/Force/draft/Disable-masking model in the inspected inventory; draft/Disable/unrelated-chord outcome TBD (owner-specific, no counterpart); `S(S-sway-bind)` | Closest qtile equivalent: Key definitions only, no preview/Force/draft/Disable-masking model in the inspected inventory; draft/Disable/unrelated-chord outcome TBD (owner-specific, no counterpart); `S(S-qti-keys)` | TBD | KDE selected: exact draft/owner/presence/active-image revalidation, no disabled-key holder mutation; live outcome TBD [record](../changes/kde-shortcut-conflicts.md) | V-SHORTCUT-CONFLICT |
| R-CTL-07 | KDE Force previously cleared a noncompiled foreign default chord | Stage Compatible; Apply; Revert Shortcuts | Default conflict still disabled; no automatic restore; separate Revert restores foreign defaults and retains own Disable | Closest COSMIC equivalent: removing a `custom` entry re-exposes the system default (no separate restore action in the sourced components); there is no preimage/automatic-restore model here; `S(S-cos-shortcut)`; owner-specific outcome TBD | Closest Hyprland equivalent: `unbind`/conflict lookup exist, but no preimage/automatic-restore or separate Revert model in source; owner-specific outcome TBD; `S(S-hyp-shortcut)` | Closest bspwm equivalent: node `-t`/`-g` exist, but no preimage/automatic-restore or separate Revert model in the inspected inventory; default-conflict restore outcome TBD (owner-specific, no counterpart); `S(S-bsp-ctl)` | Closest i3 equivalent: `bindsym`/`bindcode` defines bindings via `configure_binding`; no preimage/automatic-restore or separate Revert model in the inspected inventory; default-conflict restore outcome TBD (owner-specific, no counterpart); `S(S-i3-bind)` | Closest xmonad equivalent: `keys` defines bindings; no preimage/automatic-restore or separate Revert model in the inspected inventory; default-conflict restore outcome TBD (owner-specific, no counterpart); `S(S-xmo-ctl)` | Closest sway equivalent: `bindsym`/`bindcode` plus `unbindsym`/`unbindcode`; no preimage/automatic-restore or separate Revert model in the inspected inventory; default-conflict restore outcome TBD (owner-specific, no counterpart); `S(S-sway-bind)` | Closest qtile equivalent: Key definitions only; no preimage/automatic-restore or separate Revert model in the inspected inventory; default-conflict restore outcome TBD (owner-specific, no counterpart); `S(S-qti-keys)` | TBD | KDE selected: compiled plus discovered defaults/current holders; Revert remains default restoration, not preimage recovery; live outcome TBD [record](../changes/kde-shortcut-conflicts.md) | V-SHORTCUT-CONFLICT |

## 12. Minimum-size transitions

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | sway | qtile | awesome | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-MIN-01 | Tiled `H[A*,B]`, inner area 1080x300, gap 8; A/B minima 500x100 | Open C with minimum 100x100 | Newcomer vs existing member infeasibility; which window floats, skips or overlaps; alternative arrangement considered or not | Traced allocation/cropping without minimum enforcement; fixed-size admission floats separately; admission maps once at the resolved MRU anchor, no alternative search; `S(S-cos-min)` + `S(S-cos-last)`; exact native fixture TBD | Tiled limits off by default; opt-in clamp/recenter may overlap/overflow, not auto-float; `S(S-hyp-min)`; exact fixture TBD | Hints default off `S(S-bsp-hint)`; opt-in clamps every leaf on reflow, including existing members `S(S-bsp-min)`; exact fixture/fence wiring TBD | Traced tiled render without minimum clamping; fixed-size min==max admits floating while ordinary resizable tiles; float min/max clamp is float-only; exact fixture frames/native response TBD; `S(S-i3-min)` | Tall `tile` allocates unconditionally with no hint consult in the cited tile path; ordinary resizable C tiles even when minima exceed shares (fixed-size/transient admission floats separately; size hints shape only float frames); no alternative-arrangement search; exact fixture frames/native response TBD; `S(S-xmo-layout)` + `S(S-xmo-admit)` | Ordinary resizable C tiles unclamped even when minima exceed shares: tiled arrange fraction-normalizes with no client-hint consult (10px zeroing only, `MIN_SANE` 100x60 gap reservation only); fixed-size min==max admits floating instead (xdg parent/fixed-size; xwayland modal/dialog/utility/toolbar/splash/fixed-size at map, runtime hints urgency-only); float clamp is config min/max plus client hints on floating resize only; exact fixture frames/native response TBD; `S(S-sway-min)` + `S(S-sway-max)` | Ordinary resizable C tiles unclamped even when minima exceed shares: tiled place runs with respect_hints=false (no client-hint consult in the Columns path); fixed-size min==max admits floating instead (X11 hint check; Wayland respect_hints is an unhandled TODO); exact fixture frames/native response TBD; `S(S-qti-min)` + `S(S-qti-float)` | TBD | Shared projection reallocates within the selected tree, without alternative-arrangement search; overconstrained members keep slots, KDE skips writes, Windows uses origin+minimum. Exact fixture/result TBD; automatic victim/return policy unselected, `D(D-min-games)` | V-START-MIN |
| R-MIN-02 | Tiled `H[A,B]`, inner width 1220, gap 8; both minimum widths 600 | Shrink inner width to 1080 | Existing members become infeasible; native frames, focus, float intent and recovery after width grows | Same traced allocation/cropping `S(S-cos-min)`; native shrink/grow/focus TBD | Same tiled clamp setting `S(S-hyp-min)`; default unclamped, opt-in recentered clamp; exact shrink/grow/focus TBD | Same per-leaf hint clamp when enabled `S(S-bsp-min)`; off by default; exact recovery/fence TBD | Same unclamped tiled allocation (float clamp float-only); exact shrink/grow frames/focus/float intent TBD (native response not in allocation source); `S(S-i3-min)` | Same unconditional Tall sizing on shrink (no reflow clamp; the float map is untouched); exact shrink/grow frames/focus/float intent TBD (native response not in the tile path); `S(S-xmo-layout)` | Same unclamped tiled allocation on shrink (fraction renormalize, 10px zeroing only; float clamp float-only including client hints on floating resize); exact shrink/grow frames/focus/float intent TBD (native response not in allocation source); `S(S-sway-min)` | Same unclamped tiled allocation on shrink (no reflow clamp in the Columns path; hint clamp is float-only via respect_hints=true); exact shrink/grow frames, focus, and float intent TBD; `S(S-qti-min)` | TBD | Same shared minimum projection; current KDE skip/Windows origin+minimum, neither auto-floats. Exact shrink/grow journey TBD. A hint-only change on KDE is not an independent dispatch trigger, `D(D-min-games)` | V-START-MIN |
| R-MIN-03 | Empty tiled domain, inner area 1080x600 | Open A with declared minimum 1200x500 | Tile/flag vs automatic float; overflow remains even without siblings | Same tile allocation/cropping; fixed-size exception not oversized-min policy; `S(S-cos-min)`; native sole-leaf result TBD | Same default-unclamped/opt-in-clamped tiling `S(S-hyp-min)`; native sole-leaf result TBD | Default hints off; honored hints grow leaf at origin `S(S-bsp-min)`; native exact frame TBD | Ordinary resizable A tiles unclamped even when its minimum exceeds the work area (fixed-size exception is min==max, not oversized-min); float clamp float-only; exact sole-leaf native frame TBD; `S(S-i3-min)` | Ordinary resizable A tiles unconditionally even when its minimum exceeds the work area (the fixed-size/transient float exception is not an oversized-min policy); exact sole-leaf native frame TBD; `S(S-xmo-layout)` + `S(S-xmo-admit)` | Ordinary resizable A tiles unclamped even when its minimum exceeds the work area (fixed-size exception is min==max, not oversized-min; xwayland type/modal branches likewise admission-only); float clamp float-only; exact sole-leaf native frame TBD; `S(S-sway-min)` + `S(S-sway-max)` | Ordinary resizable A tiles unclamped even when its minimum exceeds the work area (the fixed-size float exception is min==max, not oversized-min); exact sole-leaf native frame TBD; `S(S-qti-min)` + `S(S-qti-float)` | TBD | Core projects the sole leaf and flags its violated minimum; KDE skips, writable Windows raises width at tile origin. Floating cannot make this minimum fit the work area; exact native journey TBD, `D(D-min-games)` | V-START-MIN |

## Deferred areas

- Ratio equalize/balance command: bspwm `-E`/`-B` evidenced
  (`S-bsp-bal`); Hyprland per-split deltas only; COSMIC none
  documented. No product decision; add a row only if an equalize
  affordance becomes decision-relevant.
- Gaps/borders/corners/active indication: metrics exist (`D-ref`
  section 9) but are styling, not behavior variants; out of scope.
- Dynamic workspace create/remove/pin: covered by `D-ref` section 7;
  add rows only when trailing-empty/persist semantics are disputed.
- Fullscreen games bypass: all three agree cover-and-restore
  (`D-ref` section 10); no discriminating row needed now.
- Scrollable-column WMs (niri/PaperWM): column/viewport semantics
  need a separate model (`D-prof`); not rows in this split-tree
  matrix.
