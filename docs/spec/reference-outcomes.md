# Reference-WM Outcome Matrix

Purpose: canonical scenario/outcome evidence feeding a future
functional spec. It records observed or source-evidenced outcomes per
scenario for reference WMs and our KDE/Windows behavior. Variant hooks
are provisional, to discuss. Recorded decisions in
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
| awesome | Local checkout `0a5e50cf` (2026-08-28; describe `v4.3-1751-g0a5e50cf`) | Prospective tests: shipped `awesomerc.lua` otherwise unmodified; initial tag layout floating (`layouts[1]`); tiling scenarios select `suit.tile` (first tiling choice, `layouts[2]`); shipped defaults kept (nmaster=1, mwfact 0.5, ncol=1, fill expand, gap 0, no_overlap+no_offscreen placement, rules/focus filter); semantic focus/move use `focus.bydirection` / `swap.bydirection` locally and their `global_bydirection` equivalents for multi-output rows, not literal keys (shipped keys bind byidx focus/swap only); workspace-floating reads as the shipped floating layout, workspace enable/disable as per-tag `layout.set(tile)` / `layout.set(floating)`; `S(S-awe-default)` + `S(S-awe-tile)` + `S(S-awe-keys)` + `S(S-awe-focus)` + `S(S-awe-swap)` + `S(S-awe-layout)` |
| niri | Source `ed22699d99462f61ab171472d3ea67e844ea580d` | Shipped `resources/default-config.kdl`: default column width 1/2, presets 1/3-1/2-2/3, centering never (`S(S-nir-base)`); record display mode/rules before fill |
| PaperWM | Source `8bf6dd264f60d6c0c402b63df7b424b888959a48` | Shipped schema: `open-window-position` 0 (RIGHT of current window), `default-focus-mode` 0 (DEFAULT) (`S(S-pap-base)` plus README corroboration); verify per-case option overrides |
| karousel | Source `8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b` | Shipped `src/lib/config/definition.ts`: widths 50%/100%, Lazy scrolling on, Centered/Grouped off, no default stack (`S(S-kar-base)`); single-screen profile |
| paneru | Source `b1b6abbd3f1a4be138152b6f0389c9ff1b27a269` | Shipped config defaults (`S(S-pan-base)`); no custom rules; freeze virtual-workspace/native-tab options per case; macOS live evidence unavailable on this host |
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
  `stacked` parse) and :29-44 (`toggle_split_layout` flips HORIZ/VERT) and
  :117-199 (operates on the parent split like i3; single-child flatten,
  workspace wrap for new containers)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
  (tabbed/stacked are parent split layouts holding tabs; the path writes
  no focus, so focus stays on the previously focused child)
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
- `S-awe-tile` awesome:lib/awful/layout/suit/tile.lua:232-310
  (do_tile partitions tiled-client order: nmaster master at mwfact, rest into
  ncol stack columns with windowfact shares) + :164-169 (size-hint shaping
  when arranging) + awesome:lib/awful/tag.lua:49-64 (shipped defaults gap 0,
  gap_single_client, fill expand, mwfact 0.5, nmaster 1, ncol 1) +
  awesome:lib/awful/screen.lua:529-560 (tiled_clients ordered top-to-bottom;
  float/fullscreen/maximized excluded) + awesome:lib/awful/client.lua:219-251
  (client.tiled/visible over the unstacked get: insertion order, float/fullscreen/max excluded) + awesome:objects/client.c:2202 (manage appends the
  newcomer at the end) + :3084-3116 (unstacked get walks globalconf.clients in
  order) + :3269-3304 (swap exchanges positions)
  @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
  (tile order is global-client insertion order with the newcomer last; stacking order differs)
- `S-awe-focus` awesome:lib/awful/client/focus.lua:171-190
  (bydirection over visible plus filter geometries via get_in_direction; miss
  changes nothing) + :202-229 (global_bydirection crosses screens on miss) +
  awesome:lib/gears/geometry.lua:149-169 (nearest in-direction rect, nil when
  none) + awesome:lib/awful/screen.lua:164-171 (no next screen is no-op) @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
  (no float exclusion in the walk; shipped keys bind index focus only, see S-awe-keys)
- `S-awe-geodir` awesome:lib/gears/geometry.lua:95-106 (a direction means
  strictly greater/lesser x/y origin) and :149-168 (nearest in-direction
  rect wins, nil when none qualifies)
  @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
  (occlusion geometry is load-bearing here)
- `S-awe-swap` awesome:lib/awful/client.lua:308-323
  (swap.bydirection same-screen geometric swap; miss no-op) + :342-369
  (global cross-screen move/swap) + :385-391 (swap.byidx index primitive) @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
  (swap exchanges positions with no focus write; settled frames follow tile recalc)
- `S-awe-tag` awesome:lib/awful/client.lua:577-587
  (move_to_tag sets screen plus tags with no view switch; focused mover emits
  activate raise) + :609-629 (toggle_tag same-screen only) +
  awesome:lib/awful/tag.lua:1637-1651 (view_only explicit tag switch) +
  awesome:lib/awful/client.lua:186-210 (jump_to switches to first tag and
  focuses; sticky covered) + awesome:lib/awful/client/urgent.lua:53-59
  (urgent.jumpto) @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
- `S-awe-layout` awesome:lib/awful/layout/init.lua:115-123
  (get returns the tag layout, floating fallback) + :177-180 (set is per-tag)
  @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f (no workspace tiling flag; layout is always set per tag)
- `S-awe-manage` awesome:awesomerc.lua:467-502
  (global rule focus-filter plus raise with no_overlap plus no_offscreen
  placement; floating rule_any incl fixed/dialog roles) +
  awesome:lib/awful/permissions/init.lua:311-331 (tag handler:
  transient/sticky/selected-tags admission) +
  awesome:lib/awful/client.lua:1887-1901 (startup no_offscreen plus
  focus-history add) + awesome:lib/awful/layout/init.lua:354-375 (arrange on
  tagged/untagged/layout signals) @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
- `S-awe-float` awesome:lib/awful/client.lua:973-1003
  (explicit over implicit float incl type/fullscreen/max/fixed-size) +
  :837-853 (set_floating restores floating_geometry; no focus write) +
  :1031-1041 (toggle/delete) + :1957 (floating is a persistent property) +
  awesome:lib/awful/layout/suit/floating.lua:112-119 (floating arrange no-op)
  @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
- `S-awe-fs` awesome:lib/awful/permissions/init.lua:365-434
  (geometry handler refuses tiled geometry unless floating/floating-layout/
  fullscreen/maximized context; placement maximize/restore) +
  awesome:awesomerc.lua:418-458 (Mod4+f fullscreen and Mod4+m/Ctrl+m/Shift+m
  maximize toggles with raise) + awesome:ewmh.c:325-375 (client-message
  REMOVE/ADD/TOGGLE state atoms drive the same setters, REMOVE clears incl
  native unmaximize) + :588-650 (manage-time hint read applies maximized/
  fullscreen) + awesome:objects/client.c:2699-2790 (plain boolean sets, no
  attempted-state fence) @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f (plain boolean properties; no
  owner/preimage tracking or attempted-state fence)
- `S-awe-hist` awesome:lib/awful/client/focus.lua:96-144
  (MRU history add plus visible-with-fallback get) +
  awesome:lib/awful/permissions/init.lua:101-146 (check_focus prefers
  non-sticky history then sticky fallback) +
  awesome:lib/awful/client.lua:1902 (unmanage deletes history) +
  awesome:lib/awful/permissions/init.lua:809-814 (refocus hooks on
  unmanage/tag/hide/minimize/sticky) @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
- `S-awe-sticky` awesome:lib/awful/placement.lua:949-979
  (sticky reads on every selected tag) +
  awesome:lib/awful/permissions/init.lua:94-116 (focus prefers non-sticky,
  sticky fallback) + awesome:objects/client.c:1684-1694 (C sticky reads on
  selected tags) + :2644-2657 (set_sticky plain set) + awesome:ewmh.c:56-73,248
  (sticky echoed to _NET_WM_STATE on property::sticky) + :330-337,615-625
  (state re-read at manage) + awesome:awesome.c:257 with
  objects/client.c:2241 (startup re-manage re-reads hints)
  @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f (orthogonal property; no float-only guard in source)
- `S-awe-keys` awesome:awesomerc.lua:266-310
  (shipped focus/swap by index only plus urgent.jumpto; no directional
  binding, no switcher listing) + :323-326 (layout inc rotation) + :331-385
  (numrow view/move_to_tag/toggle_tag with no view switch on move) @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
- `S-awe-drag` awesome:lib/awful/layout/init.lua:400-420
  (move_handler tiled mouse.move swap with hovered tiled current_client plus
  screen follow) + lib/awful/mouse/client.lua:21-34 (move guard
  fullscreen/maximized/desktop/dock/splash) + lib/awful/mouse/resize.lua:151-223
  (grab ends on button release only, no key-cancel branch) + :227-244 (floating
  frame write vs tiled layout-resize dispatch) +
  lib/awful/mouse/snap.lua:108-155,268-286 (aerosnap placeholder/apply
  floating-only) + awesome:awesomerc.lua:401-413 (modkey/Mod4+Button1 move,
  modkey/Mod4+Button3 resize) + :525-534 (titlebar move/resize) +
  awesome:lib/awful/client.lua:1703-1736 (activate with mouse_move action) +
  awesome:lib/awful/permissions/init.lua:167-219 (activate focus plus raise)
  @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
  (tiled drag swaps on hover with no focus write; no stack/bar/preview/cancel model)
- `S-awe-ctl` awesome:awesome.c:111-141 (atexit saves client order to the root
  property) + :539-544 (awesome_restart re-execs) + awesome:awesomerc.lua:64,234
  (restart menu plus key) + :206 (wibox.widget.systray hosts client icons) +
  awesome:lib/wibox/widget/systray.lua:57-113 (bar-hosted tray, no owner icon
  lifecycle) + awesome:lib/awful/client.lua:1467-1477,1957 (floating persists
  across restarts; only floating registered)
  @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
  (no first-run/preset/staging/Force/Disable/Revert/preimage model in the inspected
  inventory; tag layouts recreated from rc on restart)
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
- `S-ours-ovref` overlay isolation parity: plasma-auto-tiler:
  crates/tiler-windows/src/tiling.rs:377-394 (`overlay_refusal` for
  directional/pointer routes; focus carries no write and stays allowed) +
  crates/tiler-windows/src/tiling_sys.rs:5983-5998 (maximized focused
  mover refuses before Engine mutation) + kwin/src/plan-adapter.ts:
  2538-2563 (KDE focus-exempt fullscreen/maximize isolation with carried
  applied rects)
  @9241c94
- `S-ours-winsend` plasma-auto-tiler:crates/tiler-windows/src/
  tiling_sys.rs:10532-10548 (tiled-to-tiled Engine send with source reflow
  and follow) and :10720-10731 (tiled maximized member sends; fullscreen
  mover refuses with no writes) and :10883-10910 (retained maximized
  mover proceeds with flag recheck; target allocation kept, overlay
  geometry never writes)
  @9241c94
- `S-ours-send-boundary` plasma-auto-tiler:kwin/src/plan-adapter.ts:661-666
  (retired `isSendActive` coordination hook only; R4 cross-output still
  writes `setDesktops` per :7778) + kwin/src/workspace-send-adapter.ts:1-9
  (standalone same-output prototype is dev-only, not a production route;
  the host-native desktop-send journey remains untraced)
  @9241c94
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
  HORIZ, stacked VERT) and src/con.c:1997-2013 (`con_set_layout` retargets
  the focused window's parent, same children) and src/con.c:2109-2142
  (`con_toggle_layout` retargets the parent; `split` flips
  L_SPLITH/L_SPLITV) @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (tabbed/stacked are parent split layouts holding tabs; neither path
  writes focus, so focus stays on the previously focused child)
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
- `S-nir-base` niri:resources/default-config.kdl:123
  (`center-focused-column "never"`) and :129-132 (default presets 1/3, 1/2,
  2/3 of output) and :142 (default column width proportion 0.5)
  @ed22699d99462f61ab171472d3ea67e844ea580d
- `S-pap-base` PaperWM:schemas/org.gnome.shell.extensions.paperwm.gschema.xml:663-665
  (`default-focus-mode` 0 DEFAULT) and :668-670 (`open-window-position` 0
  RIGHT of current window) @8bf6dd264f60d6c0c402b63df7b424b888959a48
- `S-kar-base` karousel:src/lib/config/definition.ts:108-111 (`presetWidths`
  "50%, 100%") and :133-136 (`stackColumnsByDefault` false) and :153-166
  (`scrollingLazy` true, `scrollingCentered`/`scrollingGrouped` false)
  @8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b
- `S-pan-base` paneru:src/config.rs:1282-1284 (default width presets
  0.25-2.0) and :799-808 (focus-follows-mouse and mouse-follows-focus
  enabled) and :822-828 (native tabs enabled) and :856-862 (one workspace,
  append admission) @b1b6abbd3f1a4be138152b6f0389c9ff1b27a269
- `S-ours-ins` plasma-auto-tiler:crates/tiler-core/src/session.rs:2124-2161
  (`insert_tiled`: empty tree returns the single new leaf; focused leaf
  wraps old/new in an ordered binary group, no same-axis N-ary append) and
  crates/tiler-core/src/cosmic_v1.rs:63-69 (`admission_axis`: wide selects
  Horizontal, else Vertical) and
  crates/tiler-core/src/session/ops/lifecycle.rs:237-261 (normal tiled
  admission dispatches through `admission_axis_for_rect` plus eligible
  focus into `insert_tiled`) and kwin/src/plan-adapter.ts:90 (`PlanOp`
  `admit`) and crates/tiler-windows/src/product_hide.rs:825
  (`admit_managed_claim` managed-claim gate) @9241c94
  (shared Engine plus adapter integration; newcomer focus, order, and exact
  frames are separate TBD sub-legs, never read from this tag)
- `S-ours-admit` plasma-auto-tiler:crates/tiler-core/src/session/world.rs:529-545
  (`eligible_focus_in`: anchor is the focused leaf only when the focused
  domain is the target domain and the leaf is still a linked tile leaf) and
  crates/tiler-core/src/session/ops/lifecycle.rs:249 (normal admission
  resolves that eligible focus) and :331-349 (admitted newcomer becomes
  the desired focus leaf with `last_active` updated, then dispatches) and
  kwin/src/plan-adapter.ts:6962-6967 (complete-reply binding covers the
  admit window set) and :8444-8467 (admit qualifies as a geometry-plan
  boundary with `planned-applied`) and
  crates/tiler-windows/src/tiling_sys.rs:4,21 (Windows retains the shared
  `tiler_core::engine::Engine` as layout) @9241c94
  (Engine desired-focus plus both adapters' admit application; adapter-side
  physical focus confirmation and exact frames stay TBD sub-legs)
- `S-nir-ins` niri:src/layout/scrolling.rs:903-923 (`add_tile` always wraps
  the tile in a new column) and :999-1017 (`add_column`: index defaults to
  active+1, 0 on an empty strip; the new column activates when told to) and
  src/layout/workspace.rs:636-676 (Auto target: no focus steal from an
  active pending fullscreen; pending maximized/fullscreen tiles open in
  the scrolling layout; plain floats go to the floating layer) and
  src/handlers/xdg_shell.rs:1107-1116 (`open_on_workspace` rule routes the
  target monitor) @ed22699d99462f61ab171472d3ea67e844ea580d
  (position and routing-mechanism legs; viewport, settled widths, and
  smart-activation remainder stay TBD)
- `S-pap-ins` PaperWM:tiling.js:3994-4008 (fresh windows redirect to the
  selected space) and :4048-4055 + :4105-4120 (winprop `spaceIndex` moves
  the window to that space and re-inserts it there) and :4155 (`addWindow`
  at `getOpenWindowPositionIndex`) and :4262-4280 (index: selected+1 under
  the shipped RIGHT default) and :4071-4086 (fullscreen newcomers insert
  normally, then re-fullscreen after a timeout) and :4157-4161 (maximized
  newcomers unmaximize, then maximize horizontally) and :4204-4224 (fresh
  windows activate on actor show) and :4241-4247 (inserts landing on an
  inactive space only ensure the viewport, never steal focus)
  @8bf6dd264f60d6c0c402b63df7b424b888959a48
  (position, routing, newcomer-state, and focus legs; settled frames and
  overlay remainder stay TBD)
- `S-kar-ins` karousel:src/lib/world/clientState/Tiled.ts:8-17 (ordinary
  admission opens a new column after the last-focused column, else the
  last column, appending the window at the bottom) and
  src/lib/layout/Grid.ts:150-158 (new column inserts after its left
  neighbor) and src/lib/layout/Column.ts:275-295 (`onWindowAdded`
  end-inserts and focuses only a window that is already focused) and
  src/lib/layout/Window.ts:8-24 (maximized/fullscreen newcomers skip
  arrange instead of fighting the user) and
  src/lib/layout/Column.ts:14,267-272 (stacked display exists behind
  `toggleStacked`, off unless `stackColumnsByDefault`)
  @8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b
  (new-column position leg; KWin-side focus, viewport, and settled widths
  stay TBD)
- `S-pan-ins` paneru:src/ecs/triggers.rs:1064-1145 (`spawn_window_trigger`
  spawns the managed entity and emits the spawn event) and :771-879
  (`window_managed_trigger`: re-inserts at the remembered previous strip
  index when it still exists, else into the active strip at the config
  `insertion()` index, else at the visually overlapped column, else at the
  end, then reshuffles) @b1b6abbd3f1a4be138152b6f0389c9ff1b27a269
  (insertion-position policy; focus outcome stays TBD)
- `S-pan-model` paneru:src/ecs/layout.rs:196-203 (`StackItem` distinguishes
  single windows from app-native tabs) and :256-265 (`Column::Stack` is
  ordered top-to-bottom, `Column::Tabs` holds native tabs, `Fullscren` is
  a separate kind) @b1b6abbd3f1a4be138152b6f0389c9ff1b27a269
- `S-hyp-pre` Hyprland:src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.cpp:715-748
  (`layoutmsg preselect <direction>` writes `m_overrideDirection`) and
  :153-182 (the override forces the admission axis and newcomer side, then
  resets after one opening unless `permanent_direction_override` is set) and
  src/config/values/ConfigValues.cpp:767 (`permanent_direction_override`
  default false, also covered by `S(S-hyp-defaults)`)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
  (verb, override, and one-shot-vs-persistent legs; exact fixture frames
  stay TBD)
- `S-bsp-pre` bspwm:doc/bspwm.1.asciidoc:431-434 (`node -p DIR` preselects
  the splitting area, `-o` its ratio: manual insertion mode) and
  src/messages.c:359-382 (verb parsing plus `~` cancel) and
  src/tree.c:215-223 (`presel_dir` stores the split direction)
  @e11eff4cb3333216ad03c815609a4ed79e08929c
  (verb and manual-mode legs; consumption and exact fixture geometry stay
  TBD)
- `S-i3-split` i3:parser-specs/commands.spec:254-257 (`split
  v|h|t|vertical|horizontal|toggle` into `cmd_split`) and
  src/commands.c:1174-1200 (`cmd_split` via `tree_split` VERT/HORIZ, `t`
  toggles the current orientation)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (verb and orientation-set legs; override interaction with automatic
  admission and persistence stay TBD)
- `S-cos-tilefocus` cosmic-comp:src/shell/layout/tiling/mod.rs:1835-2087
  (`next_focus`: `In` descends to the remembered else first child, `Out`
  returns the parent group, directional orientation walk with geometric
  descent, exhausted edges None)
  @3d55cba06c9cf6f27609cdefb520f7857dba20af
  (tiled directional/group focus; exact tie rectangles stay TBD)
- `S-cos-focuskeys` cosmic-comp:data/keybindings.ron:9-18 (shipped
  `Focus` verbs Left/Right/Up/Down/Out/In; no next/previous cycle verb;
  the switcher is an external `System` command)
  @3d55cba06c9cf6f27609cdefb520f7857dba20af
  (focus-verb inventory; switcher listing policy is external)
- `S-hyp-focus`
  Hyprland:src/config/shared/actions/ConfigActions.cpp:440-530
  (`moveFocus`: directional query, group-cycle, monitor fallback,
  full-size stay) and :1736-1785 (`cycleNext` verb plus workspace
  cycle) @19fb395d45314960e6f79f17994a84094f1cd4f6
  (focus verbs; tie metric and cycle order stay TBD)
- `S-bsp-cycle` bspwm:doc/bspwm.1.asciidoc:52 (`CYCLE_DIR` next|prev)
  and :82-116 (NODE_SEL incl `first_ancestor`) and :412-414 (`node -f`
  focus verb) and src/tree.c:891-930 (in-order `next_node`/
  `prev_node` walk) and :1729-1780 (`find_closest_node` desktop-wrap
  loop) @e11eff4cb3333216ad03c815609a4ed79e08929c
  (cycle selector/walk inventory; binary embedding and internal-node
  matching stay TBD)
- `S-i3-focusnext` i3:parser-specs/commands.spec:185-201 (`focus`
  direction/next|prev/sibling/parent|child grammar) and
  src/commands.c:1292-1340 (`cmd_focus_direction` auto-direction via
  parent orientation, `cmd_focus_sibling`)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (next/prev/sibling verbs; wrap config is `S(S-i3-flt-focus)`)
- `S-i3-focuslvl` i3:src/commands.c:1403-1430 (`cmd_focus_level`
  parent|child) and src/tree.c:386-409 (`level_up`/`level_down`)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (container focus scope)
- `S-sway-focusnext` sway:sway/commands/focus.c:17-60
  (`get_direction_from_next_prev` parent-layout mapping) and :440-450
  (next/prev/sibling dispatch)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
  (next/prev verbs; walk and wrap are `S(S-sway-focus)`)
- `S-sway-focuslvl` sway:sway/commands/focus.c:355-380
  (`focus_parent`/`focus_child` via parent node and active tiling
  child) and :432-438 (parent|child dispatch)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
  (container focus scope)
- `S-awe-cycle` awesome:lib/awful/client.lua:256-290 (`client.next`
  index cycle via `gmath.cycle` over visible clients with the focus
  filter) @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
  (cycle verb and wrap; exact order stays TBD)
- `S-nir-focus` niri:src/layout/scrolling.rs:1581-1600
  (`focus_left`/`focus_right` edge booleans) and
  src/layout/workspace.rs:938-990 (tiling/floating dispatch,
  first/last, `LeftOrLast`/`RightOrFirst` wrap variants)
  @ed22699d99462f61ab171472d3ea67e844ea580d
  (column focus verbs and edge policy; in-column member stays TBD)
- `S-nir-actions` niri:niri-ipc/src/lib.rs:322-390 (`FocusWindow`,
  `FocusWindowInColumn`, `FocusWindowPrevious`, `FocusColumnLeft/Right/
  First/Last/LeftOrLast/RightOrFirst`, `FocusWindowUp/Down` variants;
  no plain spatial next/previous cycle pair)
  @ed22699d99462f61ab171472d3ea67e844ea580d
  (focus-verb inventory)
- `S-pap-focus` PaperWM:tiling.js:1129-1200 (`switch` with `loop`,
  left/right column step, `sortWindows` topmost pick, up/down rows,
  `ensureViewport`) and :5562-5570 (`sortWindows` stacking order)
  @8bf6dd264f60d6c0c402b63df7b424b888959a48
  (directional switch incl MRU-topmost member pick; cycle verbs TBD)
- `S-kar-focus` karousel:src/lib/keyBindings/Actions.ts:6-60
  (`focusLeft/Right/Up/Down/Next/Previous/Start/End`, tiled-only
  dispatch via `doIfTiledFocused` in definition.ts:10-53)
  @8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b
  (focus-verb inventory; in-column member stays TBD)
- `S-pan-cmds` paneru:src/types/commands.rs:220-275 (`Operation`:
  directional `Focus`, `FocusOrVirtual`, `FocusManaged/Unmanaged`,
  `RaiseFloating`; no next/previous cycle pair, no parent verb)
  @b1b6abbd3f1a4be138152b6f0389c9ff1b27a269
  (focus-verb inventory; traversal stays TBD)
- `S-pan-axfs` paneru:src/util.rs:193-197 (AX `AXFullScreen`
  observation; no zoom/maximize AX attribute read in the inspected
  surface)
  @b1b6abbd3f1a4be138152b6f0389c9ff1b27a269
  (native fullscreen is observable; host zoom is not)
- `S-pan-fsfocus` paneru:src/commands.rs:292-318 (West focus on a native-
  fullscreen space raises the last column top instead of traversing) +
  src/ecs/workspace.rs:267-287 (native fullscreen pins a `Fullscren`
  strip with a restore marker)
  @b1b6abbd3f1a4be138152b6f0389c9ff1b27a269
  (fullscreen focus branch; exit journey untraced)
- `S-ours-focus` plasma-auto-tiler:crates/tiler-core/src/directional.rs:50-64
  (axis/step for direction) and :1068-1135 (`descend_focus_target`
  plus `plan_focus`: matching-axis climb, same-axis edge child else
  perpendicular first child, exhausted edges `Edge`; targets are
  leaves only, never containers) and
  crates/tiler-core/src/session/ops/focus.rs:26-115 (`propose_focus`:
  opaque match, `plan_focus` wrap, `Edge` refuses `Unchanged` with no
  plan and no pending; single-output cross-output attempts refuse the
  same way) and kwin/src/plan-adapter.ts:2351-2358 (tile-origin focus
  dispatch body) and :8167-8220 (`writeGeometries` actuates
  `planned.focus` via exactly one `setActive`, fail-closed) and
  crates/tiler-windows/src/tiling_sys.rs:5402 (`actuate_focus`) and
  :6111-6120 (`FocusDirectional` reply actuated, `focus-ok` outcome)
  @9241c94
  (leaf-only directional focus model plus both adapters' delivery;
  selected intent is never evidence)
- `S-cos-move` cosmic-comp:src/shell/layout/tiling/mod.rs:1507-1560
  (`move_current_node` entry, stack-internal move, R1 orientation
  mapping) and :1598-1830 (R1/R2/R3 branches plus output fallback)
  @3d55cba06c9cf6f27609cdefb520f7857dba20af
  (directional move implementation; unresolved predicates are identified in cells)
- `S-bsp-move-target` bspwm:src/tree.c:1124-1149 (directional candidates
  are leaves on all monitors' shown desktops; distance then history rank)
  and :1489-1620 (leaf exchange, same-desktop focus retention and
  cross-monitor follow) and src/geometry.c:49-154 (directional range and
  boundary distance) and src/history.c:311-323 (MRU rank) and
  src/settings.c:108 (default HIGH directional tightness)
  @e11eff4cb3333216ad03c815609a4ed79e08929c
- `S-qti-swap-inventory` qtile:libqtile/layout/columns.py:173-191
  (internal `swap` helper, not exposed) and :204-508 (exposed command
  inventory: directional shuffles, no standalone swap) and
  libqtile/backend/x11/window.py:2249 (interactive drag calls the helper)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-nir-move` niri:src/layout/scrolling.rs:1702-1800 (`move_left`/
  `move_right` column reorder, `move_down`/`move_up` in-column step)
  and :1795-2060 (`consume_or_expel`/`consume_into`/`expel_from`) and
  src/layout/workspace.rs:1072-1125 (tiling/floating move dispatch) and
  niri-ipc/src/lib.rs:389-442 (column/window move/consume verbs)
  @ed22699d99462f61ab171472d3ea67e844ea580d
  (column move inventory; tree-nesting legs have no counterpart)
- `S-pap-move` PaperWM:tiling.js:4440-4500 (`move_to` viewport placement,
  not membership reorder) and :5228-5260 (`slurp` join) and :3490 (`barf`
  expel path) and :1129-1200 (`switch` directional focus, not a move)
  @8bf6dd264f60d6c0c402b63df7b424b888959a48
  (column/row model and viewport/join paths; native directional inventory TBD)
- `S-kar-move` karousel:src/lib/keyBindings/Actions.ts:86-160
  (`windowMoveLeft/Right` shared-vs-single column paths,
  `windowMoveUp/Down` in-column step, `windowMoveNext/Previous`)
  and :184-200 (`columnMoveLeft/Right/Start/End`) and
  src/lib/layout/Column.ts:41-60 (`moveWindowUp/Down`) and
  src/lib/layout/Grid.ts:27-51 (`moveColumn`)
  @8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b
  (column/window move inventory; tree-nesting legs have no counterpart)
- `S-pan-move` paneru:src/types/commands.rs:220-270 (`Swap`,
  `VirtualMove`, `ToNextDisplay` verbs; directional `Focus` separate)
  and src/ecs/layout_ops.rs:89-130 (`Swap` same-strip exchange,
  `MoveToWorkspace` virtual-row marker)
  @b1b6abbd3f1a4be138152b6f0389c9ff1b27a269
  (swap/virtual-move inventory; split-tree reparent legs TBD)
- `S-i3-swap` i3:src/commands.c:1961-2011 (`cmd_swap`: target resolved by
  explicit `id`/`con_id`/`mark` only, no directional form) and
  src/con.c:2580-2659 (`con_swap` leaf exchange)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (targeted swap only; directional swap has no counterpart)
- `S-ours-move` plasma-auto-tiler:crates/tiler-core/src/directional.rs:786-929
  (`plan_local`: perpendicular R1 wrap, 2-child R2a leaf swap, R2b
  group insert/split, N-ary R2c wrap, R3 escape with same-axis insert
  vs R1 continuation) and :945-1021 (`plan_move_with_capabilities`:
  only Left/Right cross outputs, Up/Down never cross)
  and crates/tiler-core/src/session/ops/move.rs:529-601 (applied R1
  perpendicular wrap with mover at the directional end) and :737-828
  (applied R2b insertion and retained mover focus target)
  @9241c94
  (Engine move rules: every `MoveOperation` is directional; neighbor
  exchange occurs only as R2a inside a directional move, never as a
  standalone swap verb)
- `S-cos-resize` cosmic-comp:src/shell/layout/tiling/mod.rs:2443-2475
  (`possible_resizes` edge walk) and :2477-2512 (`resize_request` nearest
  matching-edge-axis ancestor) and :2514-2600 (pixel `resize` with
  pair/leaf minima) + data/keybindings.ron:91-92 (`Resizing`
  Outwards/Inwards) @3d55cba06c9cf6f27609cdefb520f7857dba20af
  (keyboard pixel resize; settled frames stay TBD)
- `S-hyp-resize`
  Hyprland:src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.cpp:312-360
  (`resizeTarget` pixel delta plus edge/smart-resizing path) +
  src/config/shared/actions/ConfigActions.cpp:670-683 (pixel `resize`
  dispatcher) @19fb395d45314960e6f79f17994a84094f1cd4f6
  (pixel-delta step; neighbor scope and reversal stay TBD)
- `S-bsp-resize` bspwm:doc/bspwm.1.asciidoc:439-442 (`-z` pixel handle)
  and :454-458 (`-E`/`-B`) + src/messages.c:432-447 (`-z` dispatch) and
  :557-569 (`-E`/`-B` dispatch to `equalize_tree`/`balance_tree`) +
  src/tree.c:1258-1283 (equalize/balance) + src/settings.h:44
  (shipped `SPLIT_RATIO` 0.5)
  @e11eff4cb3333216ad03c815609a4ed79e08929c
  (pixel-handle neighbor/reversal TBD; root equalize/balance evidenced)
- `S-i3-resize` i3:src/commands.c:451-467 (tiling-direction participants)
  and :544-581 (`resize grow|shrink`, shrink negates) and
  src/resize.c:72-144 (climb to the first matching orientation) and
  parser-specs/commands.spec:280-311 (grammar, default 10px/ppt)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
- `S-sway-resize` sway:sway/commands/resize.c:45-64 (resize-parent climb)
  and :237-280 (tiled adjust, default 10/ppt, unchanged error) and
  :554-576 (grow/shrink dispatch)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-xmo-resize` xmonad:src/XMonad/Layout.hs:77-78 (`Shrink`/`Expand`
  move `frac` by `delta` 3/100) and src/XMonad/Config.hs:211-212
  (`mod-h`/`mod-l`) @284dd52c9c957cab6b6e5cc7580f2a63dafa00a7
  (frac-only; no edge-targeted verb)
- `S-qti-resize` qtile:libqtile/layout/columns.py:134 (`grow_amount` 10)
  and :309-310 (width weights project proportionally to work-area pixels)
  and :509-561 (directional grows move width/height from the neighbor) and
  :563-570 (`normalize` equal widths)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-awe-resize` awesome:lib/awful/tag.lua:760-770 (`incmwfact`
  master-factor step) + awesomerc.lua:311-313 (`mod-l` +0.05 / `mod-h`
  -0.05) + lib/awful/layout/suit/tile.lua:232-310 (mwfact partition)
  @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
  (no edge-targeted verb)
- `S-nir-resize` niri:src/layout/scrolling.rs:4927-4973 (preset-cycle
  index plus preset apply) and :4990-5022 (`set_column_width`
  proportion/fixed/adjust) + src/layout/mod.rs:3020 (`toggle_width`) +
  src/input/mod.rs:1620-1623 (`SwitchPresetColumnWidth(Back)` dispatch) +
  niri-ipc/src/lib.rs:715-761 (width-action inventory: preset, maximize,
  set/adjust; no edge-targeted verb) +
  resources/default-config.kdl:556-558,589-590 (`Mod+R`/`Mod+Shift+R`
  binds) @ed22699d99462f61ab171472d3ea67e844ea580d
  (columns independent; no edge-targeted counterpart)
- `S-pap-resize` PaperWM:tiling.js:4873-4912 (`resizeWInc`/`resizeWDec`
  10% step) and :4937-4960 (width cycle direction) +
  keybindings.js:270-291 (registered action inventory: w/h inc/dec plus
  width/height cycling; no edge-targeted verb)
  @8bf6dd264f60d6c0c402b63df7b424b888959a48
  (grid-snapped step; neighbor reflow TBD; no edge counterpart)
- `S-kar-resize` karousel:src/lib/keyBindings/Actions.ts:160-175
  (height actions) and :203-247 (column width increase/decrease/cycle plus
  `columnsWidthEqualize` via `fillSpace`; no edge-targeted verb) +
  src/lib/world/World.ts:29 (shipped `scrollingCentered=false` selects
  `ContextualResizer`) +
  src/lib/behavior/columnResizer/ContextualResizer.ts:6-41
  (increase: smallest strictly greater width, recenters viewport) and
  :43-88 (decrease: separate contextual path) +
  src/lib/behavior/columnResizer/RawResizer.ts:6-30 (preset-step
  increase/decrease, centered-mode only)
  @8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b
  (contextual step; reversal not established; no edge counterpart)
- `S-pan-resize` paneru:src/types/commands.rs:152-180 (`ResizeDirection`
  Grow/Shrink) and :226-242
  (`Resize`/`SetWidth`/`Equalize`/`Balance`; no edge-targeted verb) +
  src/commands.rs:744-829 (`resize_window` preset cycle) and :1291-1330
  (`equalize_column`: `Stack`-only height evening) and :1331-1372
  (`balance_strip`: every column to the focused width) +
  src/ecs/layout.rs:258-266 (`Single` vs `Stack` columns)
  @b1b6abbd3f1a4be138152b6f0389c9ff1b27a269
  (neighbor mapping TBD; no edge counterpart)
- `S-ours-resize`
  plasma-auto-tiler:crates/tiler-core/src/session/ops/resize.rs:9-48
  (nearest matching-edge-axis ancestor, adjacent shares only, Unchanged
  refusal) and :49 (`propose_resize`) and :160-183 (step derivation via
  `derive_keyboard_pixel_shares` into `apply_resize_shares`; Unchanged and
  PairBelowMinimum refusals) and :1397-1533 (`derive_keyboard_pixel_shares`) +
  crates/tiler-core/src/cosmic_v1.rs:233 (`keyboard_step_px` 12 then +2)
  and :273 (`pair_admits_resize`) and :313
  (`clamp_keyboard_shrink_pair`) +
  crates/tiler-core/src/directional.rs:1297 (`apply_resize_shares`) +
  crates/tiler-core/src/session/ops/mod.rs:8-15 (operation families:
  drag/float/focus/lifecycle/move/resize/workspace, no equalize family) +
  kwin/src/plan-adapter.ts:90 (`PlanOp`: admit/remove/move/focus/resize/
  reconcile/update-gaps/pointer-resize/toggle-float/drag-drop/
  release-domain, no equalize op) and :3027-3090 (`requestResize`
  dispatches `op: "resize"` with direction/mode/press_index)
  @9241c94
  (shared Engine plus KDE adapter dispatch; no equalize verb in either
  inventory)
- `S-ours-winbind` plasma-auto-tiler:crates/tiler-windows/src/settings.rs:773-775
  (resize rows `implemented: false`) and :1892-1898 (resize rows are the
  only unimplemented ones) and :1167,1216 (unimplemented guards) +
  crates/tiler-windows/src/settings_ui.rs:284-287 (keyboard
  resize not intercepted; pointer resizing exists) +
  crates/tiler-windows/src/tiling_sys.rs:13026-13048 (pointer-resize
  gesture maps to `CoreCommand::PointerResize`, the Windows resize path)
  @9241c94
  (no Windows keyboard-resize trigger; keyboard legs have no counterpart)
- `S-nir-min` niri:src/layout/scrolling.rs:4589-4620 (tile width clamped
  to min/max) @ed22699d99462f61ab171472d3ea67e844ea580d
  (admission/focus remainder TBD)
- `S-kar-min` karousel:src/lib/layout/Column.ts:79-102 (`getMinWidth`/
  `getMaxWidth` clamp in `setWidth`)
  @8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b
  (admission frames TBD)
- `S-cos-orient` cosmic-comp:data/keybindings.ron:83 (Super+o
  `ToggleOrientation`) + :83-92 (layout-geometry bindings: orientation/
  stacking/tiling/float/swap/maximize/fullscreen/resize; no rotate/mirror/
  master verb) + src/input/actions.rs:962-976 (`ToggleOrientation`/
  `Orientation` dispatch to `update_orientation`) +
  src/shell/layout/tiling/mod.rs:2089-2130 (`update_orientation` flips the
  focused parent group's axis with proportional size rescale, no focus write)
  @3d55cba06c9cf6f27609cdefb520f7857dba20af
  (parent-axis toggle only)
- `S-cos-model` cosmic-comp:src/shell/layout/tiling/mod.rs:150-162
  (`Data` holds Group/Mapped nodes only)
  @3d55cba06c9cf6f27609cdefb520f7857dba20af
  (no master concept in the tiling model)
- `S-cos-wslay` cosmic-comp:cosmic-comp-config/src/workspace.rs:8-45
  (`WorkspaceConfig.workspace_layout` is a single global Vertical/Horizontal
  value) @3d55cba06c9cf6f27609cdefb520f7857dba20af
  (no runtime per-workspace layout-select verb)
- `S-hyp-lay`
  Hyprland:src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.cpp:676-702
  (`layoutmsg` dispatch: togglesplit/swapsplit/rotatesplit/movetoroot) +
  :774-868 (`toggleSplit` flips the parent `splitTop`; `swapSplit` exchanges
  the parent's children; `rotateSplit(angle)` flips the axis with the
  angle-conditional swap; `moveToRoot` swaps the node toward the root and
  returns false at the root; none writes focus) + :28-61 (immediate
  recalculation derives the axis from parent geometry at shipped
  preserve_split/smart_split/precise_mouse_move=false defaults, overriding
  the explicit toggle/rotation bit)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-hyp-layout` Hyprland:src/config/values/ConfigValues.cpp:179
  (`general:layout` is the global default layout value) +
  src/layout/supplementary/WorkspaceAlgoMatcher.cpp:30-35 (registered tiled
  algorithms: dwindle/master/scrolling/monocle) and :106-142
  (`tiledAlgoForWorkspace` prefers a workspace rule's layout override;
  `updateWorkspaceLayouts` switches a workspace's tiled algorithm on mismatch)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
  (per-workspace ownership sourced; order preservation through the switch TBD)
- `S-bsp-type` bspwm:doc/bspwm.1.asciidoc:442-443 (`node -y/--type` sets or
  cycles the splitting type of the selected node) + src/tree.c:193-203
  (`set_type` flips `split_type` with constraint rebuild, no focus write)
  @e11eff4 for the doc path,
  @e11eff4cb3333216ad03c815609a4ed79e08929c for src
- `S-bsp-rot` bspwm:doc/bspwm.1.asciidoc:448-452 (`node -R/--rotate`
  90|270|180, `-F/--flip` horizontal|vertical) + src/tree.c:1202-1256
  (`rotate_tree_rec` flips the split type at every level with the
  degree-conditional child swap; `flip_tree` swaps children where the split
  matches; neither writes focus)
  @e11eff4 for the doc path,
  @e11eff4cb3333216ad03c815609a4ed79e08929c for src
- `S-bsp-desklay` bspwm:doc/bspwm.1.asciidoc:505 (`desktop -l/--layout`
  CYCLE_DIR|monocle|tiled) + src/messages.c:765-780 (`set_layout` applies
  per desktop) @e11eff4 for the doc path,
  @e11eff4cb3333216ad03c815609a4ed79e08929c for src
- `S-i3-cmds` i3:parser-specs/commands.spec:23-34 (command dispatch inventory:
  layout/split/focus/move and others; no rotate/mirror/master/promote verb)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
- `S-sway-cmds` sway:sway/commands.c:114-143 (alphabetized runtime command
  table: layout/split/move/swap and others; no rotate/mirror/master verb)
  @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-xmo-master` xmonad:src/XMonad/StackSet.hs:540-556 (`swapMaster`/
  `shiftMaster` make the focused window the master; focus stays with the
  moved item) @284dd52c9c957cab6b6e5cc7580f2a63dafa00a7
- `S-xmo-wslay` xmonad:src/XMonad/StackSet.hs:157 (each `Workspace` carries
  its own layout) + src/XMonad/Config.hs:137 (`Tall ||| Mirror Tall ||| Full`)
  and :193 (mod-space sends `NextLayout` on the current workspace only)
  @284dd52c9c957cab6b6e5cc7580f2a63dafa00a7
- `S-awe-master` awesome:lib/awful/client.lua:460-477 (`getmaster` reads the
  first visible client; `setmaster` moves the client to the primary section
  via repeated `swap`, which writes no focus)
  @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
- `S-awe-tileleft` awesome:lib/awful/layout/suit/tile.lua:328-337
  (`tile.left` runs the tile algorithm mirrored via `do_tile "left"`) and
  :370-372 (plain `tile` aliases the right variant) +
  awesomerc.lua:83-97 (shipped layout list includes floating, tile,
  tile.left, and others) @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
- `S-qti-wslay` qtile:libqtile/group.py:15-45 (each group keeps its own
  `layouts` list plus `current_layout` index) and :77-90 (`layout`
  property/setter over that index) +
  libqtile/core/manager.py:1274-1302 (`next_layout`/`prev_layout` with an
  optional group name target the named group's index)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-nir-float` niri:niri-ipc/src/lib.rs:811-819 (`ToggleWindowFloating`
  moves one window; no workspace toggle verb) +
  src/layout/workspace.rs:55,660-677 (`floating_is_active` derives from
  admission/focus, not a command)
  @ed22699d99462f61ab171472d3ea67e844ea580d
- `S-nir-acts` niri:niri-ipc/src/lib.rs:194-946 (full `Action` enum:
  column/window focus, moves, consume/expel, width presets, tabbed display,
  float/floating-focus, workspace moves; no orientation/rotate/mirror/
  master/layout-select verb)
  @ed22699d99462f61ab171472d3ea67e844ea580d
- `S-nir-maxfs` niri:src/layout/workspace.rs:1288-1351
  (`set_fullscreen`/`toggle_fullscreen` with floating-restore memory) and
  :1353-1416 (`set_maximized`/`toggle_maximized` from the column pending
  flag, idempotent clear, unmaximize-into-floating) and :649-669
  (pending-maximized/fullscreen tiles open in the scrolling layout; new
  focus is fenced only against active fullscreen) and :896-905
  (configure maps Fullscreen to view size, Maximized to working-area
  size) + src/handlers/xdg_shell.rs:466-477,550-559,696,770 and
  src/handlers/mod.rs:551-591 (client maximize/fullscreen requests route
  into the same setters, mapped and unmapped) + src/input/mod.rs:1690-1700
  (`MaximizeColumn` is full-width, `MaximizeWindowToEdges` drives the
  native toggle) + src/layout/mod.rs:625-632 (Smart activation evaluates
  the supplied fullscreen fence rather than always declining focus)
  @ed22699d99462f61ab171472d3ea67e844ea580d
  (native maximized/fullscreen state; width actions are distinct)
- `S-nir-wscarry` niri:src/layout/tests.rs:3708-3725
  (`MoveColumnToWorkspace` keeps the column Maximized after transfer and
  unfullscreen) and :3728-3750 (`MoveWindowToWorkspace` drops the
  column-held flags so the window arrives Normal; FIXME documents the loss)
  @ed22699d99462f61ab171472d3ea67e844ea580d
  (window-send strips overlay state, column-send retains it)
- `S-pap-acts` PaperWM:keybindings.js:191-238 (switch/move-as-swap verbs) +
  :240-344 (scratch/slurp/barf/maximize-width/fullscreen/focus-mode/
  open-position; no orientation/rotate/mirror/master/layout-select/
  workspace-float verb) @8bf6dd264f60d6c0c402b63df7b424b888959a48
- `S-pap-unmov` PaperWM:tiling.js:1391-1398 (layout skips placement while
  easing and for fullscreen/maximized windows: `unMovable` returns early,
  leaving the frame alone)
  @8bf6dd264f60d6c0c402b63df7b424b888959a48
  (overlay-frame stability leg; focus/switch verbs stay TBD)
- `S-pap-widthmax` PaperWM:tiling.js:3514-3526 (maximize events convert
  to width-maximize when `maximize-within-tiling` holds: unmaximize,
  restore last layout frame, `toggleMaximizeHorizontally`) and :4155-4162
  (admission converts native-maximized newcomers the same way) and
  :4794-4830 (width toggle with `unmaximizedRect` memory; full work-area
  width at the shipped 100 percent) + schemas/org.gnome.shell.extensions.
  paperwm.gschema.xml:630-633 (width percent default 1.00) and :635-638
  (`maximize-within-tiling` default true)
  @8bf6dd264f60d6c0c402b63df7b424b888959a48
  (native maximize never overlays at shipped defaults)
- `S-pap-fsframe` PaperWM:tiling.js:3678-3685 (position updates skipped
  while fullscreen or fullscreen-locked) and :3793-3825 (fullscreen exit
  restores the saved frame and clears it; `saveFullscreenFrame` records
  frame plus tiled width)
  @8bf6dd264f60d6c0c402b63df7b424b888959a48
  (native fullscreen frame memory; entry itself is the Meta API flag)
- `S-pap-swap` PaperWM:tiling.js:1063-1094 (`swap` exchanges model
  positions with the directional neighbor, then layouts with no
  unmaximize branch; selection unchanged)
  @8bf6dd264f60d6c0c402b63df7b424b888959a48
  (move-left/right verb path; registration is `space.swap`)
- `S-pap-take` PaperWM:tiling.js:5407-5420 (`takeWindow` removes the
  window from its space for navigator cross-space moves)
  @8bf6dd264f60d6c0c402b63df7b424b888959a48
  (cross-space transfer verb; overlay-state carry untraced)
- `S-kar-acts` karousel:src/lib/keyBindings/Actions.ts:6-60 (focus verbs) +
  :86-175 (window/column move verbs) + :176-260 (`windowToggleFloating`
  per-window only, column move/stacked/width/preset verbs; no
  rotate/mirror/master/orientation/layout-select/workspace-toggle verb)
  @8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b
- `S-kar-maxfs` karousel:src/lib/world/clientState/Tiled.ts:66-70
  (`maximizedAboutToChange` observed) and :174-184 (`fullScreenChanged`
  observed; untileable-after-exit floats) and :222-242 (tiling admission
  force-unmaximizes; fullscreen kept with keepAbove) + src/lib/layout/
  Window.ts:91-126 (`restoreToTiled` clears both when unfocused;
  maximize/fullscreen handlers set `skipArrange` with layering) +
  src/lib/layout/Grid.ts:195-201 and Column.ts:335-341 (focusing another
  window restores the old one to tiled) + src/lib/config/definition.ts:
  141-147 (`reMaximize` default false) and :175-195 (`tiledKeepBelow`
  default true)
  @8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b
  (overlay membership kept with arrange skipped; focus change restores)
- `S-kar-tile` karousel:src/lib/world/Clients.ts:7-16 (`canTileEver`:
  moveable and resizeable, or fullscreen; popups and prohibited classes
  excluded) and :48-53 (`isFullScreenGeometry` coverage test)
  @8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b
  (shapeability decides tileability, not monitor coverage)
- `S-ours-planops` shared Engine operation inventory:
  plasma-auto-tiler:crates/tiler-core/src/session/ops/mod.rs:8-15 (families:
  drag/float/focus/lifecycle/move/resize/workspace only) +
  crates/tiler-core/src/directional.rs:236 (`MoveOperation` is
  directional-only) and :517 (`FocusPlan` is directional leaf-or-Edge only);
  KDE adapter dispatch: plasma-auto-tiler:kwin/src/plan-adapter.ts:90
  (`PlanOp`: admit/remove/move/focus/resize/reconcile/update-gaps/
  pointer-resize/toggle-float/drag-drop/release-domain);
  Windows dispatch: plasma-auto-tiler:crates/tiler-windows/src/snapkey.rs:104-107
  (`SnapOp`: Focus/Move only) and :427-430 (`WorkspaceOp`: Select/Send only)
  @a77dd341f311da080ba94347c82a34d1d1c57893
  (no layout/orient/rotate/mirror/master/layout-select verb in any of the three
  layers)
- `S-cos-ws` cosmic-comp:src/input/actions.rs:186-211
  (`Workspace(key)` index activate, `LastWorkspace` targets `len-1`) and
  :212-290 (`NextWorkspace`/`PreviousWorkspace` with `workspace_wraparound`
  plus output fallback) and :292-346 (`MoveTo`/`SendToWorkspace` index
  mapping with follow vs stay, plus Last variants) and :348-530
  (`MoveTo`/`SendToNextWorkspace` active+1 and `MoveTo`/
  `SendToPreviousWorkspace` active-1, wraparound cycle else output
  fallback) and :684-740 (`MigrateWorkspaceToOutput` migrates the active
  workspace, activates it there, then switches output; Next/Previous
  migrate actions are deprecated no-ops) and :1142-1200
  (`to_next_workspace`/`to_previous_workspace` wrap-or-stay) +
  src/shell/mod.rs:525-583 (`set.activate` refuses idx past the end,
  `activate_previous` gesture-only) + src/shell/mod.rs:652-704
  (`ensure_last_empty` adds only when the last is occupied/pinned) +
  cosmic-comp-config/src/workspace.rs:14-20 (`workspace_wraparound`
  defaults true) @3d55cba06c9cf6f27609cdefb520f7857dba20af for the
  compositor paths (config path per `S(S-cos-wslay)` repo split)
  (no history-toggle verb in the workspace action inventory)
- `S-hyp-ws`
  Hyprland:src/config/shared/actions/ConfigActions.cpp:170-198
  (`back_and_forth` resolve: re-invoking switch-to-current goes to the
  timeline previous, `=2` per-monitor) and :380-436 (`moveToWorkspace`
  follow focuses the mover, silent refocuses the source) and :1016-1083
  (`changeWorkspace`, cross-monitor focuses the focus candidate) and
  :1107-1117 (`moveToMonitor` whole-workspace verb) +
  src/output/Monitor.cpp:1398-1423 (workspace switch: remembered feeds
  focus only when floating, else the fullscreen cover; `follow_mouse=1`
  pointer-hit wins before the focus candidate; pointer fixture
  unspecified) + src/state/workspace/Resolver.cpp:181-205 (`prev` is
  MRU-history previous, `next` is numeric+1) +
  src/desktop/history/WorkspaceHistoryTracker.cpp:40-110 (MRU timeline
  track plus previous lookup) + src/workspace/HLWorkspace.cpp:122-135
  (`getLastFocusedWindow`/`rememberFocusedWindow`) +
  src/workspace/HLWorkspace.cpp:134-143 (`getFocusCandidate` prefers
  last-focused, else top-left, else first; `follow_mouse=0` variant) +
  src/config/values/ConfigValues.cpp:380 (`input:follow_mouse`
  default 1) + src/config/values/ConfigValues.cpp:615 (`workspace_back_and_forth`
  default 0 off) @19fb395d45314960e6f79f17994a84094f1cd4f6
  (numbered IDs are stable; empty-object destruction untraced)
- `S-bsp-ws` bspwm:doc/bspwm.1.asciidoc:52 (`CYCLE_DIR` next|prev) and
  :215 (DESKTOP_SEL grammar) and :233-234 (`last` is the previously
  focused desktop) and :418-422 (`node -d/-m` desktop/monitor send with
  `--follow`) and :486-512 (`desktop -f/-a/-m/-s/-l`, whole-desktop move
  via `-m`) and :514 (explicit `desktop -r` removal) +
  src/desktop.c:39-74 (`activate_desktop` show/hide) and :270-274
  (circular desktop list, so next/prev wrap) and :182-235 (desktop
  transfer with follow) and :336-360 (explicit removal only) +
  src/messages.c:656-666 (`desktop -f` focus plus absent-selector
  failure) and src/types.h:283-293 (`desktop_t.focus` memory) +
  `S(S-bsp-close)` (focus_node history fallback)
  @e11eff4 for the doc path,
  @e11eff4cb3333216ad03c815609a4ed79e08929c for src
- `S-i3-ws` i3:src/workspace.c:131-160 (`workspace_get` creates on
  demand) and :438-505 (`workspace_show` records the previous name,
  focuses the descended remembered focus, closes the empty old
  workspace) and :581-660 + :666-880 (`workspace_next`/`prev` wrap via
  first/last fallback) and :892-913 (single previous-name
  back-and-forth) and :1059-1150 (`workspace_move_to_output` whole-
  workspace detach/attach with source refill and displaced cleanup) +
  src/commands.c:1068-1115 (`move workspace to output` dispatch) and
  parser-specs/commands.spec:165-183 (next/prev/back_and_forth grammar)
  and :293-296 (relative move-to-workspace) and :375-433 (relative and
  whole-workspace move grammar)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
- `S-xmo-ws` xmonad:src/XMonad/StackSet.hs:182 (`Stack.focus` per
  workspace) and :231-260 (`view` keeps each workspace's focus,
  unknown tags return unchanged) and :262-275 (`greedyView` display
  swap across screens) and :572-600 (`shift`/`shiftWin` explicit-tag
  transfer only) + src/XMonad/Config.hs:50-57 (workspace list is static
  configuration) + `S(S-xmo-ctl)` (no back-and-forth, relative-switch,
  or relative-send verb in the profiled inventory)
  @284dd52c9c957cab6b6e5cc7580f2a63dafa00a7
- `S-sway-ws` sway:sway/tree/workspace.c:177-200 (`workspace_create`)
  and :299-334 (`workspace_consider_destroy` drops empty non-active)
  and :548-660 (`workspace_prev`/`next` wrap via last/first fallback)
  and :700-745 (`workspace_auto_back_and_forth` plus `workspace_switch`
  focusing the seat focus-inactive node) and :1131-1161
  (`workspace_move_to_output` detach/attach with source refill and
  displaced consider-destroy) + sway/commands/workspace.c:180-230
  (switch incl create plus back_and_forth) and sway/commands/move.c:419-480
  (`move to workspace` next/prev/number/back_and_forth) and :630-665
  (`move workspace to output` acts on the handler-context active
  workspace) @1652c54b73f67df17b7b4ab0b0f7048204aa8104
- `S-qti-ws` qtile:libqtile/config.py:578-625 (`set_group` assigns or
  cross-screen swaps, saving `previous_group`) and :626 (`_toggle_group`
  falls back to the previous group) and :715-735 (`next_group`/
  `prev_group` modulo wrap, `toggle_group` previous-or-named) +
  libqtile/group.py:110-145 (`layout_all` focuses the remembered
  `current_window` on the current screen) and :146-160 (`set_screen`
  show/hide) and :363-395 (`toscreen` pull with toggle) and :429-434
  (`get_next_group`/`get_previous_group` modulo) +
  libqtile/backend/x11/window.py:1946-1960 (`togroup` takes explicit
  group names only) + `S(S-qti-wsdef)` (static groups 1-9)
  @83c697a5621306c3586efca31867efcfa0482e2d
- `S-awe-ws` awesome:lib/awful/tag.lua:489-532 (`tag.history.update`
  per-screen MRU) and :534-566 (`history.restore` defaults to the
  previous-set toggle) and :1569-1586 (`viewidx` cycles, so viewnext/
  viewprev wrap) and :1637-1660 (`view_only` selects plus history
  update) and :607-645 (`set_screen` moves the tag plus all member
  clients, restoring old-screen history) and :409-485 (explicit
  `tag.delete` only) + static tags 1-9 per `S(S-awe-default)` and
  tag-switch refocus per `S(S-awe-hist)`
  @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
- `S-nir-ws` niri:src/layout/monitor.rs:442-495 (activate stores the
  previous id) and :650-679 (`clean_up_workspaces` drops empty
  non-active non-trailing workspaces) and :721-745 (`insert_workspace`
  clamps past the trailing empty, activates only when asked) and
  :800-900 (`move_to_workspace` up/down clamp plus follow activation) and
  :960-1010 (switch up/down clamp at the ends) and :1002-1030
  (`previous_workspace_idx`, `switch_workspace_previous`,
  `switch_workspace_auto_back_and_forth`, out-of-range switch clamps
  to last) + src/layout/mod.rs:2145-2169 (relative-move dispatch,
  `focus=true` Smart else No) and :2324-2344 (keyboard focus resolves
  to the active workspace's active window) and :3452-3520
  (`move_workspace_to_output_by_id` whole-workspace remove/insert,
  activation only when moved-active) + src/input/mod.rs:1329-1366
  (`MoveWindowToWorkspace` reference plus `focus` Smart/No) and
  :1437-1460 (`MoveColumnToWorkspace` reference plus `focus`) and
  :2134-2155 (`MoveWorkspaceToMonitorByRef` resolves hidden workspaces
  by reference) + niri-config/src/binds.rs:227-243 (`focus` defaults
  true) + src/layout/workspace.rs:49-55 (each workspace owns its scrolling
  state, floating space, and active flag) +
  src/input/mod.rs:1536 (`FocusWorkspacePrevious` binding) +
  src/ui/mru.rs:584-592 (MRU UI lists every workspace's windows)
  @ed22699d99462f61ab171472d3ea67e844ea580d
- `S-pap-space` PaperWM:tiling.js:1096-1127 (`switchLinear` column loop)
  and :2865-2925 (`selectSequenceSpace`: adjacent steps stop at the
  ends, `move` takes the window first) and :3034-3070
   (`selectStackSpace`: MRU-stack steps with wrap) and :3222-3230
  (`removeSpace`) and :2477-2510 (`workspacesChanged` mirrors GNOME
  add/remove) and :462-487 (`activate`/`activateWithFocus` call native
  activate with or without a focus target) and :900-912
  (`selectedWindow` retention) and :2576-2620 (`moveToMonitor` whole-
  space choreography with swap fallback) and :3281-3300 (MRU ordering)
  and :5361-5366 (`previous-workspace` / move-previous exports) +
  keybindings.js:153-154 (`previous-workspace` registrations) and
  :153-173 (workspace switch/move actions)
  @8bf6dd264f60d6c0c402b63df7b424b888959a48
  (workspace add/remove is GNOME-owned; loop variants are column-level)
- `S-kar-ws` karousel:src/lib/keyBindings/Actions.ts:469-504
  (`columnMoveToNextDesktop`/`columnMoveToPreviousDesktop` stop at the
  desktop ends) + src/lib/layout/Column.ts:20-31 (`moveToGrid`
  cross-desktop transfer) + src/lib/layout/Grid.ts:150-170
  (`onColumnAdded` appends, `onColumnRemoved` refreshes
  `lastFocusedColumn`) + src/lib/workspace.ts:27-29 (desktop switch
  only re-arranges) + `S(S-kar-acts)` (no desktop-switch, history, or
  select verb in the inventory)
  @8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b
  (desktops and their switching are KWin-native)
- `S-pan-ws` paneru:src/ecs/workspace.rs:882-1000 (switch: North stops,
  South steps or auto-creates, `First`/`Last` jump, `VirtualNumber`
  spawns the absent strip) and :1040-1120 (relative move with
  `MoveFocus` Follow/Stay; South needs len>1, North stops at 0) and
  :125-141 (`PreviousStripPosition` plus remembered-window restore
  guard) and :1120-1145 (center-column fallback for never-focused
  strips) and :1351-1390 (empty-row reaping, never index 0) +
  src/config.rs:815-819 (`reap_empty_workspaces` defaults off) +
  src/config.rs:868-872 (`create_virtual_workspace_automatically`
  defaults off) + `S(S-pan-cmds)` (no history verb; `Virtual` is directional)
  @b1b6abbd3f1a4be138152b6f0389c9ff1b27a269
- `S-ours-ws` workspace mechanics at this HEAD:
  plasma-auto-tiler:crates/tiler-core/src/session/ops/workspace.rs:37-47
  (explicit same-output send proposal only) and :92-101 (`Unchanged` /
  `CrossDomainMismatch` / `UnknownDomain` refusals) and :121-192
  (remembered-leaf / focus-MRU / root anchor plus follow-on-commit)
  + crates/tiler-core/src/session/world.rs:574-640 (`remembered_leaf`,
  `focus_stack_fallback`, `updated_last_active` per-domain memory) +
  Windows: crates/tiler-windows/src/tiling_sys.rs:9815 (`workspace_do_select`
  hide/reveal with `already-active` short-circuit) and
  crates/tiler-windows/src/workspace.rs:194-232 (mode pruning leaves
  workspace order intact; output seeding and workspace count) and
  :297-315 (index resolvers incl
  trailing) and :400-415 (`focus_target` prefers `last_focus`, else first
  visible) and crates/tiler-windows/src/snapkey.rs:427-447 (`WorkspaceOp`
  Select/Send, index only) + KDE:
  plasma-auto-tiler:kwin/src/plan-adapter.ts:7699 (`resolveDesktop`) and
  :7778 (`setDesktops` membership write; desktops themselves are
  Plasma-owned) @60771bd
  (Engine/KDE have no select verb; Windows has index-only Select;
  no history/relative/whole-workspace verb in these inventories)
- `S-cos-minimize` cosmic-comp:src/shell/mod.rs:4369-4410
  (`minimize_request`: sticky vs workspace dispatch into
  `minimized_windows`) and src/shell/workspace.rs:1045-1145 (`minimize`:
  fullscreen branch plus tiling/floating unmap storing
  `MinimizedWindow::Tiling/Floating` restore data) and :1148-1260
  (`unminimize`: fullscreen refocus plus floating remap and tiling old-slot
  `remap` with the stored state) and
  src/shell/layout/tiling/mod.rs:1414-1445 (`unmap_window_internal` with the
  minimizing flag removes the node and reflows siblings) and
  src/shell/focus/mod.rs:108-137 (`is_minimized` filter plus last
  unminimized MRU pick) @3d55cba0
  (tiling unmap/reflow plus stored restore slot; focus leg via the MRU
  skip-minimized filter)
- `S-hyp-mininv` Hyprland:src/config/shared/actions/ConfigActions.cpp:200-1824
  (dispatcher inventory at pin lists no minimize action) and
  src/desktop/view/window/X11Backend.cpp:196-201 (`requestsMinimize`
  consumed at commit) and :381-383 (`setMinimized` echoes to the surface)
  and src/desktop/view/window/WaylandBackend.cpp:366 (`setMinimized`
  no-op) @19fb395d45314960e6f79f17994a84094f1cd4f6
  (request consumed/echoed; layout/tree effect untraced)
- `S-bsp-mininv` bspwm:src/events.c:40-80 (`handle_event` dispatch) and
  :301-330 (`client_message` handles `_NET_WM_STATE`/`_NET_ACTIVE_WINDOW`/
  `_NET_CURRENT_DESKTOP` only; no `WM_CHANGE_STATE`/iconic branch) and
  src/window.c:899-909 (the WM itself sets `ICONIC` when it hides; no
  client-iconify verb) and src/messages.c:344-345 (`hidden` is a
  scriptable hide flag) @e11eff4cb3333216ad03c815609a4ed79e08929c
  (no native minimize request path or verb; `_NET_WM_STATE_HIDDEN`
  handling is WM-owned hide and never votes here)
- `S-i3-mininv` i3:src/handlers.c:847-857 (`WM_CHANGE_STATE` iconic
  request rejected and reverted to normal; other states unhandled) and
  src/commands.c:1921-1951 (`move scratchpad` plus `scratchpad show`
  dispatch, a separate mechanism)
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (native minimize request refused; window stays tiled)
- `S-xmo-mininv` xmonad:src/XMonad/Config.hs:188-227 (key inventory:
  spawn/kill/NextLayout/refresh/focus/swap/shrink/expand/sink/IncMasterN/
  quit/restart only; no minimize verb) and src/XMonad/Main.hs:432-438
  (startup scan notes `WM_STATE` iconified only) and
  xmonad-contrib:XMonad/Hooks/EwmhDesktops.hs:765 (advertises
  `_NET_WM_STATE_HIDDEN`, no runtime minimize handling traced) and
  src/XMonad/Operations.hs:278-290 (`hide` internal unmap primitive)
  @284dd52c9c957cab6b6e5cc7580f2a63dafa00a7
  (runtime request path untraced)
  (contrib path @5097a457e7a409bc9a7584dc5aa82b34c69d6dda)
- `S-sway-mininv` sway:sway/commands.c:114-143 (alphabetized runtime command
  table: layout/split/move/swap/scratchpad and others; no minimize verb)
  and sway/commands/scratchpad.c (separate scratchpad path) and
  sway/desktop/xwayland.c:622-634 (`handle_request_minimize` echoes the
  protocol flag only) @1652c54b73f67df17b7b4ab0b0f7048204aa8104
  (request echoed; tree effect untraced)
- `S-qti-minimize` qtile:libqtile/backend/x11/window.py:1802-1816
  (`minimized` setter via `toggle_minimize` into `MINIMIZED`) and
  :1890-1926 (`_reconfigure_floating`: `MINIMIZED` sets `IconicState` plus
  `hide()`, else-branch clears via `floating=false`) and :2110-2116
  (`WM_CHANGE_STATE` iconic honored under `auto_minimize`) and
  libqtile/resources/default_config.py:207 (`auto_minimize=true` shipped)
  and libqtile/backend/base/float_states.py (`MINIMIZED` enum member)
  @83c697a5621306c3586efca31867efcfa0482e2d
  (native request path plus hide path; slot/refocus stay TBD)
- `S-awe-minimize` awesome:objects/client.c:2554-2614
  (`client_set_minimized`: `ICONIC` unmap plus `NORMAL` remap, `banning`
  update, `property::minimized` signal) and ewmh.c:402-409
  (`_NET_WM_STATE_HIDDEN` ADD/REMOVE/TOGGLE drives the same setter) and
  lib/awful/permissions/init.lua:809-814 (refocus hooks on
  unmanage/tag/hide/minimize/sticky) @0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f
  (native request path plus unmap/ban with retained client order)
- `S-nir-mininv` niri:src/protocols/foreign_toplevel.rs:574-575
  (`SetMinimized`/`UnsetMinimized` explicit no-ops) and
  niri-ipc/src/lib.rs:194-946 (full `Action` enum at pin lists no minimize
  verb) @ed22699d99462f61ab171472d3ea67e844ea580d
- `S-pap-minimize` PaperWM:tiling.js:4720-4738 (`minimizeHandler`: tiled
  mark plus move to the scratch layer; unminimize via `unmakeScratch`) and
  :3487-3511 (`notify::minimized` wiring)
  @8bf6dd264f60d6c0c402b63df7b424b888959a48
  (scratch-layer path; reflow/position stay TBD)
- `S-kar-minimize` karousel:src/lib/world/ClientManager.ts:84-96
  (`minimizeClient`: `Tiled` to `TiledMinimized` with focus passing) and
  src/lib/world/Clients.ts:16-28 (`canTileNow` excludes minimized;
  `makeTileable` unminimizes) and
  src/lib/world/clientState/TiledMinimized.ts (minimizedChanged retile)
  @8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b
  (minimized state path; reflow/position stay TBD)
- `S-pan-minimize` paneru:src/ecs/triggers.rs:544-559 (`WindowMinimized`
  inserts `Unmanaged::Minimized`; `WindowDeminimized` removes it) and
  src/types/state.rs:126 (on-screen check excludes minimized) and
  src/types/commands.rs:220-275 (`Operation` inventory at pin lists no
  minimize verb) @b1b6abbd3f1a4be138152b6f0389c9ff1b27a269
  (minimize-mark path; strip position stays TBD)
- `S-ours-minkde` KDE production observer at this HEAD:
  plasma-auto-tiler:kwin/src/entry.ts:19 (production uses
  `startPlanAdapterEntry`; one bounded DescribePlan adapter owns
  observation) and kwin/src/plan-adapter-entry.ts:1484-1750
  (`observeNative`: `normalWindow`/output/desktop/frame gates only, no
  minimized filter; unreadable frame quarantines the whole domain to
  null, never a transient remove/re-admit; null/non-normal
  `activeWindow`, or active missing from entries, returns null) and
  kwin/src/kwin-globals.d.ts:185-189 (`minimized` Q_PROPERTY documented
  with NOTIFY `minimizedChanged`) @13dcb76
  (minimized frame readability and native active-window value decide
  between stale-frame observation and fail-closed null; Engine effect
  and focus stay TBD)
- `S-ours-minwin` Windows adapter minimize path at this HEAD:
  crates/tiler-windows/src/tiling_sys.rs:523-525 (doc: `IsIconic` read
  before frames; iconic returns known identity as `Minimized`) and
  :553-556 (code: iconic short-circuit with no frame read) plus
  :1569-1588 (no-frame retained row: Engine membership survives
  minimization) and :4424-4429 (retained row rides the last-known tile
  rect, hintless, no writes) and :9236-9245 (close cleanup drops only
  truly absent HWNDs) and crates/tiler-windows/src/tiling.rs:341-347
  (`minimized` classifies as a state skip) @13dcb76
  (slot retained without reflow; focus stays TBD)
- `S-cos-grpmove` cosmic-comp:src/shell/element/stack.rs:431-483
  (`handle_move`: in-stack Left/Right reorder when a neighbor exists,
  else `MoveOut` with the active index clamped to the survivor) and
  src/shell/layout/tiling/mod.rs:1507-1560 (`move_current_node`
  stack-internal branch plus `MoveOut` reinsert as a new tile beside
  the group) @3d55cba06c9cf6f27609cdefb520f7857dba20af
  (leave/reorder legs; semantic join from outside into a stack untraced)
- `S-cos-grpclose` cosmic-comp:src/shell/element/stack.rs:241-271
  (`remove_window`: active index clamped with `fetch_min`, single-member
  dissolve path) and :273-305 (`remove_idx` same index fixup)
  @3d55cba06c9cf6f27609cdefb520f7857dba20af
  (membership plus active-tab leg; semantic tab-bar membership suffices)
- `S-hyp-grpmove` Hyprland:src/config/shared/actions/ConfigActions.cpp:1338-1375
  (`moveWindowIntoGroupHelper` add plus `setCurrent` mover plus mover
  focus, `moveWindowOutOfGroupHelper` remove with direction focal plus
  `focus_removed_window` mover/group-current branch) and :1377-1416
  (`moveIntoGroup` needs a directional neighbor already in a group,
  `moveOutOfGroup` needs group membership) +
  src/desktop/view/Group.cpp:97-173 (`add` inserts after current by
  default and makes the newcomer current) and :233-298 (`remove`
  index fixup with single-member dissolve via target switch)
  @19fb395d45314960e6f79f17994a84094f1cd4f6
- `S-nir-consume` niri:src/layout/scrolling.rs:925-951
  (`add_tile_to_column`: `None` appends last with `activate_idx` plus
  column activation) and :1795-1901
  (`consume_or_expel_window_left`: single-tile joins the left column,
  multi-tile expels to a new left column) and :1903-1993 (right-side
  mirror) and :1995-2060 (`consume_into_column`/`expel_from_column`
  explicit verbs) and :2189-2226 (`toggle_column_tabbed_display`
  Normal/Tabbed flip) and :1626-1640 (`focus_down`/`focus_up` column
  member step) and :4865-4871 (`activate_idx` saturating step)
  @ed22699d99462f61ab171472d3ea67e844ea580d
  (membership/order/active legs; semantic tab-bar membership suffices)
- `S-pap-slurp` PaperWM:tiling.js:5228-5310 (`slurp` on the focused column
  consumes the directional neighbor per `open_window_position` at the
  ABOVE/BELOW/TOP/BOTTOM position, emptied columns removed; shipped
  RIGHT `slurp(B)` from the right column has no right neighbor) and
  :5317-5359 (`barf` expels the named or bottom window to a new column
  at the directional open position) @8bf6dd264f60d6c0c402b63df7b424b888959a48
  (membership legs; selection TBD where stated)
- `S-kar-grpmove` karousel:src/lib/keyBindings/Actions.ts:22-36
  (`focusUp`/`focusDown` member step via above/below window) and :90-120
  (`windowMoveLeft` single-window joins the left column, shared-column
  expels to a new left column; `windowMoveRight` mirror) and
  src/lib/layout/Window.ts:26-33 (`moveToColumn` remove plus add) and
  src/lib/layout/Column.ts:275-295 (`onWindowAdded` appends last or first
  with `isFocused` focus-taker update) and :297-325 (`onWindowRemoved`
  above/below focus-taker fixup plus column destroy) and :267-273
  (`toggleStacked` needs 2+ windows) and :225-250 (stacked overlapping
  arrange vs visible heights)
  @8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b
  (membership/order/focus-taker legs)
- `S-ours-grp` plasma-auto-tiler:crates/tiler-core/src/directional.rs:107-123
  (`Node` is Leaf or split-axis Group only, no tab/stack variant) +
  crates/tiler-core/src/session/ops/mod.rs:8-15 (families:
  drag/float/focus/lifecycle/move/resize/workspace only) +
  crates/tiler-core/src/session.rs:1810-1817 (Center never plans,
  unsupported stack behavior) and :3674-3699 (center preview/release
  fail closed as unsupported stack with no plan)
  @9241c94
  (no tab carrier and no semantic join/leave verb in any Engine layer)

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

## Area files

Scenario rows live in area files under `reference-outcomes/` (58 original
rows, preserved; plus 6 insertion scenarios from piece B1, 4 focus
scenarios from piece B2, 3 move scenarios from piece B3, 4 resize
scenarios from piece B4, and 4 layout-command scenarios from piece B5,
plus 7 workspace scenarios and 3 minimize scenarios, GWT only).
This index retains purpose, row-addition rule, notation,
profiles, evidence tags/legend, variant hooks, and deferred. Existing wide
tables moved unchanged; all new scenarios use the GWT form below.
Areas follow the approved priority order; column mechanics follows, and
minimum-size stays a supplemental file (not nested in resize).

| Area | File | Existing rows | Candidates |
|---|---|---|---|
| Insertion | [insertion.md](reference-outcomes/insertion.md) | R-INS-01..08 (8) | none (R-INS-03..08 landed in piece B1) |
| Focus | [focus.md](reference-outcomes/focus.md) | R-FOC-01..04 (4) | none (landed in piece B2) |
| Move | [move.md](reference-outcomes/move.md) | R-MOV-01..08 (8) | none (R-MOV-06..08 landed in piece B3) |
| Resize | [resize.md](reference-outcomes/resize.md) | R-RSZ-01..04 (4) | none (landed in piece B4) |
| Layout commands | [layout-commands.md](reference-outcomes/layout-commands.md) | R-LAY-01..04 (4) | none (landed in piece B5) |
| Workspaces | [workspaces.md](reference-outcomes/workspaces.md) | R-WS-01..14 (14) | none (R-WS-08..14 landed with scrolling backfill) |
| Minimize | [minimize.md](reference-outcomes/minimize.md) | R-MNZ-01..03 (3) | none (landed) |
| Maximise / fullscreen | [maximize-fullscreen.md](reference-outcomes/maximize-fullscreen.md) | R-MAX-01..07 (7) | R-MAX-08..09 |
| Groups / stacks | [groups-stacks.md](reference-outcomes/groups-stacks.md) | R-GRP-01..03 (3) | none (R-GRP-02..03 landed with scrolling backfill) |
| Floating | [floating.md](reference-outcomes/floating.md) | R-FLT-01..11 (11) | R-FLT-12..14 |
| Close / reflow | [close.md](reference-outcomes/close.md) | R-CLOSE-01..02 (2) | R-CLOSE-03..05 |
| Multi-output | [multi-output.md](reference-outcomes/multi-output.md) | R-OUT-01..02 (2) | R-OUT-03..06 |
| Mouse | [mouse.md](reference-outcomes/mouse.md) | R-DRAG-01..08 (8) | R-MOU-01..03 |
| Special windows | [special-windows.md](reference-outcomes/special-windows.md) | none yet | R-SPC-01..05 |
| Activation | [activation.md](reference-outcomes/activation.md) | none yet | R-ACT-01..02 |
| Restart / persistence | [restart-persistence.md](reference-outcomes/restart-persistence.md) | R-START-01..03 + R-CTL-01..07 (10) | R-RST-01..02 |
| Column mechanics | [column-mechanics.md](reference-outcomes/column-mechanics.md) | none yet | R-COL-01..10 |
| Minimum-size (supplemental) | [minimum-size.md](reference-outcomes/minimum-size.md) | R-MIN-01..03 (3) plus 3x4 scrolling backfill (piece B4) | none (R-MNZ icon-minimize is separate) |

## Scrolling column notation

Additive; the existing H/V/S notation is unchanged.

- `COL[C1[A],C2[B*,C],C3[D]]`: ordered columns, with C2's B/C vertically
  visible. Column identifiers persist through reordering.
- `COL[C1[A],C2[S[B*,C]]]`: tabbed-display column, distinct from both
  vertical visible stacking and a tree tab group. Accordion/overlapping
  display is an explicit profile-qualified rendering, never silently
  called tabs.
- Widths: `w(C1)=0.5W`, where W is viewport work-area width; absolute
  pixels only when load-bearing. Internal heights use ratios when needed.
- Viewport: `VP(x=0,W=2400)` is the strip-coordinate interval `[0,2400)`.
  State column positions/widths and gaps when clipping/ties matter; focus
  and viewport are separate state variables. No ambiguous inline boundary
  marker.
- Workspaces/outputs reuse `L:WS1=COL[...]`; paneru adds
  `Space1:{VW1=COL[...],VW2=COL[...]}`. Native Space and virtual row are
  separate domains.

## Cross-model projection rules

- H/V fixtures remain exact split-tree fixtures. A flat H has a matching
  projection to columns only if widths, visible windows, and viewport
  match; that proves rectangle-level behavior, not a split-tree. V can map
  to a visible multi-window column under the same qualification. Recursive
  H/V ancestry usually has no column counterpart.
- S maps only to a supported tabbed-display fixture with stated membership
  and active tab; PaperWM accordion and visible vertical columns are not
  exact S equivalents. Never flatten nesting just to obtain a result.
- Backfill assesses every existing row for each scrolling profile with a
  separately stated column Given; projections are marked explicitly and
  link any distinct column candidate.

## Outcome qualifiers

- `fixture-inapplicable`: no faithful start exists in that profile.
- `no-counterpart`: evidenced missing action or state (needs pinned
  inventory evidence).
- `owner-specific`: external journey outside the WM profile.
- None of these counts as an agreeing no-op. Applicable unknown outcomes
  stay TBD. Existing cells keep their current vocabulary.

## New-scenario format (GWT)

- New scenarios use Given/When/Then with one Then bullet per profile (14):
  COSMIC, Hyprland/Dwindle, bspwm, i3, xmonad/Tall+Navigation2D, sway,
  qtile/Columns, awesome/tile, niri, PaperWM, karousel/Lazy, paneru,
  Ours KDE, Ours Windows. Ours KDE and Ours Windows always have separate
  Then entries, never a combined verdict.
- Model-specific Given bullets and independently reset variant legs; never
  pretend every WM can instantiate one H/V fixture.
- This convention applies to every new scenario, including single-step
  predicates. Existing wide tables remain unchanged until a separate migration.
- Attach `S(real-key)`, `D(real-key)`, `UT(actual-date)` only to
  established predicates. Partial evidence qualifies its leg; TBD stays on
  the unsupported part. Never invent citation keys.

## Scrolling baselines (VERIFIED at pinned sources)

Pins are source-read anchors, never retroactive user-test versions. The
eight existing WM pins are unchanged. Checkouts verified at exactly these
commits; PaperWM.spoon stays corroboration only, never a separate profile.

- niri @ed22699d99462f61ab171472d3ea67e844ea580d `S(S-nir-base)`:
  resources/default-config.kdl:123 (`center-focused-column "never"`),
  :129-132 (default presets 1/3, 1/2, 2/3 of output), :142
  (`default-column-width { proportion 0.5; }`).
- PaperWM @8bf6dd264f60d6c0c402b63df7b424b888959a48 `S(S-pap-base)`:
  shipped schema `open-window-position` default 0 (RIGHT of current
  window), `default-focus-mode` default 0 (DEFAULT). README right-of-active
  and `tiling.js` FocusModes corroborate; the schema is authoritative.
- karousel @8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b `S(S-kar-base)`:
  src/lib/config/definition.ts:108-111 (`presetWidths` "50%, 100%"),
  :133-136 (`stackColumnsByDefault` false), :153-156 (`scrollingLazy`
  true), :158-166 (`scrollingCentered`/`scrollingGrouped` false).
- paneru @b1b6abbd3f1a4be138152b6f0389c9ff1b27a269 `S(S-pan-base)`:
  src/config.rs:1282-1284 (default width presets 0.25, 0.33333, 0.50,
  0.66667, 0.75, 1.0, 1.5, 2.0), :799-808 (focus-follows-mouse and
  mouse-follows-focus enabled), :822-828 (native tabs enabled), :856-862
  (one workspace, append admission).

## Deferred areas

- Ratio equalize/balance command: landed as R-RSZ-04 in piece B4
  (bspwm `-E`/`-B` evidenced `S-bsp-bal` + `S(S-bsp-resize)`; qtile
  `normalize` and karousel `columnsWidthEqualize` evidenced; other
  profiles TBD or no-counterpart). No product decision.
- Gaps/borders/corners/active indication: metrics exist (`D-ref`
  section 9) but are styling, not behavior variants; out of scope.
- Dynamic workspace create/remove/pin: covered by `D-ref` section 7;
  add rows only when trailing-empty/persist semantics are disputed.
- Fullscreen games bypass: all three agree cover-and-restore
  (`D-ref` section 10); no discriminating row needed now.
- Scrollable-column WMs (niri/PaperWM/karousel/paneru): column/viewport
  semantics live in [column-mechanics.md](reference-outcomes/column-mechanics.md)
  under the column model above, never as assumed H/V split-tree
  equivalence. PaperWM.spoon stays corroboration only, never a separate
  profile.
