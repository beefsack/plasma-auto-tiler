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
| Hyprland | Docs baseline `v0.56.2`; separate source `ae50c4d6` (commit date 2026-10-03) | Prospective tests: Dwindle, preserve_split=false, no preselect; directional move (not swap), send follows (not silent); Master needs a separate profile |
| bspwm | Docs baseline `0.9.12`; separate source `e11eff4` (commit date 2026-01-08) | Prospective tests: tiled, automatic_scheme=longest_side, initial_polarity=second_child, split_ratio=0.5, honor_size_hints=false; directional swap via `node -s DIR --follow`, send via `node -d N --follow` |
| i3 | Local checkout `903bcd51` (2026-09-21) | Prospective tests: splith unless fixture requires otherwise, no custom workspace/window rules; outcomes await versioned evidence |
| xmonad | Local checkout `a8055cd` (2026-09-27) | Prospective tests: Tall, one master, ratio 0.5; workspace send is StackSet.shift (no view/follow); tree fixtures may be inapplicable |
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
  (`last_active` resolved at admission, then `map_to_tree`) @3d55cba0
- `S-cos-axis` cosmic-comp:src/shell/layout/tiling/mod.rs:548-616
  (ordinary admission splits the selected leaf's long edge; no-focus
  fallback splits root using output dimensions) @3d55cba0
- `S-cos-seq` cosmic-comp:src/shell/workspace.rs:1441-1452
  (`set_tiling` maps floating windows sequentially) @3d55cba0
- `S-cos-zone` cosmic-comp:src/shell/layout/tiling/mod.rs:96-103
  (`TargetZone` zone names only) @3d55cba0
- `S-hyp-moveswap`
  Hyprland:src/config/shared/actions/ConfigActions.cpp:549-583
  (`moveInDirection` delegates to layout; `swapInDirection` errors with
  no target) @ae50c4d6
- `S-hyp-movews`
  Hyprland:src/config/shared/actions/ConfigActions.cpp:396-431
  (`moveToWorkspace` silent refocus vs follow) @ae50c4d6
- `S-hyp-pin`
  Hyprland:src/config/shared/actions/ConfigActions.cpp:286-294
  (`pinWindow` float-only guard) @ae50c4d6
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
- `S-xmo-ins` xmonad:src/XMonad/StackSet.hs:484-486 (`insertUp`
  above focus) @a8055cd
- `S-xmo-shift` xmonad:src/XMonad/StackSet.hs:572-585 (`shiftWin`
  via `insertUp`/`delete'`) @a8055cd
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
- `S-bsp-min` bspwm:src/tree.c:101-134,150-170 and src/window.c:699-701
  @e11eff4cb3333216ad03c815609a4ed79e08929c
  (opt-in leaf size-hint clamp on every reflow; constraint-fence wiring TBD)
- `S-bsp-admit` bspwm:src/rule.c:256-293 and src/tree.c:787-795
  @e11eff4cb3333216ad03c815609a4ed79e08929c
  (fullscreen state/fixed-size floating admission; maximum flags not admission state)
- `S-i3-min` i3:src/render.c:43-124 and src/manage.c:461-474,528-533
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (tiled render allocation; fixed-size admission floats separately)
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
  ordinary/sticky floats by top-left coordinate delta on the requested axis)
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
- `S-bsp-flt-focus` bspwm:src/query.c:583-584,
  src/tree.c:1124-1149,2250-2261, src/geometry.c:49-154 and
  src/settings.c:108 @e11eff4cb3333216ad03c815609a4ed79e08929c
  (unqualified directional selector includes tiles/floats; boundary distance
  first, history rank only breaks ties; default tightness HIGH)
- `S-bsp-flt-swap` bspwm:src/tree.c:101-134,1489-1623
  @e11eff4cb3333216ad03c815609a4ed79e08929c
  (same-desktop node swap retains client state/floating rectangle and focus;
  tiled arrangement is recomputed)
- `S-i3-flt-focus` i3:src/tree.c:503-577 and src/commands.c:1515-1542
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (tiled walk excludes floating list; floating left/right cycles that list
  with wrapping; up/down returns no target; sticky does not change this path)
- `S-i3-flt-move` i3:src/commands.c:1554-1588 and
  parser-specs/commands.spec:407-411
  @903bcd518df32b0e055b17f5da3f988a0187fd3d
  (bare directional move shifts floating frame by 10px, retains floating)
- `S-xmo-core-nav` xmonad:src/XMonad/Config.hs:185-215
  @284dd52c9c957cab6b6e5cc7580f2a63dafa00a7
  (default core navigation is stack focus/swap; these directional scenarios
  require a separately specified custom/contrib implementation, hence TBD)
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

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|
| R-INS-01 | `H[A,B*]`, B projected 1200x600 | Open C with B still focused | Split axis + position of C | Ordinary admission chooses B's long edge (side-by-side); `S(S-cos-last)` + `S(S-cos-axis)`; order TBD | Dwindle parent-geometry split with preserve_split=false; `D(D-prof)`; order TBD | Longest_side with second_child polarity; `S(S-bsp-ins)`; exact order TBD | TBD | TBD | Long-edge split at focused leaf; `D(D-dec-x)` (user statement); order TBD | V-INS-AXIS |
| R-INS-02 | Stack `S[A*,B]` (COSMIC) | Open C | Does C join the active stack | Joins active stack; `D(D-ref)` | TBD (group vs split distinct; `D(D-prof)`) | No groups: one window per leaf; `D(D-ref)` | TBD | TBD | TBD (stacks unselected) | V-GROUP-STACK |

## 2. Focus / move

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|
| R-MOV-01 | `H[A,C,B*]` | Move B down | Restructure vs no-op | `V[H[A,C],B]` via R1; `UT(2026-08-20)` ver-unknown + [S1-07](../cosmic-move-conformance.md#sequence-s1---three-terminals) | moveInDirection delegates to layout, outcome TBD; `S(S-hyp-moveswap)` | Configured `-s south --follow` is node swap, not R1; no-target result TBD; `S(S-bsp-swap)` | TBD | TBD | `V[H[A,C],B]` R1 via shared Engine; selected `D(D-dec-cos)` | V-MOVE-PERP |
| R-MOV-02 | `H[A,V[C,B*]]` | Move B up | Swap vs wrap | `H[A,V[B,C]]` via R2a leaf swap; `UT(2026-08-20)` + [S1-11](../cosmic-move-conformance.md#sequence-s1---three-terminals) | moveInDirection layout result TBD; `S(S-hyp-moveswap)` | Configured `-s north --follow` swaps B/C; `S(S-bsp-swap)` | TBD | TBD | `H[A,V[B,C]]`; `D(D-dec-cos)` | V-MOVE-NARY |
| R-MOV-03 | `H[A,B*,C,D]` | Move B right | Wrap pair vs flat insert | `H[A,H[B,C],D]` R2c; [S18-01](../cosmic-move-conformance.md#sequence-s18---r2c-container-neighbour) authored observation, widths unrecorded | TBD | TBD | TBD | TBD | Same-orientation wrap per Engine; nested `H[H..]` distinct from flat; `D(D-dec-cos)` | V-MOVE-NARY |
| R-MOV-04 | `H[H[A,B*],C]` | Move B right | Escape vs stay nested | `H[A,B,C]` via R3 ascend + same-axis flatten; `UT(2026-08-20)` ver-unknown + [S1-03](../cosmic-move-conformance.md#sequence-s1---three-terminals) | TBD | TBD | TBD | TBD | R3 ascend; `D(D-dec-cos)` | V-MOVE-NARY |
| R-MOV-05 | `H[A*,B]` single output, no neighbor | Move left past edge | No-op vs cross-ws/output | Single-output no-op; [S5-01](../cosmic-move-conformance.md#sequence-s5---output-edge-no-op) + [S17](../cosmic-move-conformance.md#sequence-s17---single-output-directional-no-ops) authored observations; R4 never reached in UT | TBD | TBD | TBD | TBD | Local R1/R2/R3 first; exhausted horizontal R4 crosses output, never workspace; Up/Down excluded; `D(D-dec-cos)` (offline only) | V-R4-DIR |

## 3. Workspace send / follow / return

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|
| R-WS-01 | WS1 `H[A,B*]`, WS2 `H[C]` | Send B to WS2 | Source collapse, target position, focus | Admits at last_active match `S(S-cos-last)`; post-send focus TBD | moveToWorkspace focuses mover unless silent; target position TBD; `S(S-hyp-movews)` | `node -d` sends to desktop, `--follow` keeps focus; target position TBD; `S(S-bsp-send)` | TBD | shiftWin inserts above target focus via insertUp, source view unchanged; `S(S-xmo-shift)` | Source collapses; target admits at remembered-leaf/focus-history/root; follow on verified transfer; `D(D-dec-cos)` + step-3 `D(D-dec-ww)` | V-WS-FOLLOW |
| R-WS-02 | WS1 tall case `H[C,V[A,B*]]` or wide case `V[C,H[A,B*]]`; WS2 empty; inner area 2544x1364, gap 8: A becomes 1268x1364 (tall) or 2544x678 (wide) after B leaves | Focus A then B; send B to WS2; select WS1/focus A; select WS2/focus B; send B back to WS1 | Return anchor + side/order + axis, rather than old-slot restoration | Last-active leaf resolved, split by its long edge; `S(S-cos-last)` + `S(S-cos-axis)`; order/follow TBD | TBD | TBD | TBD | TBD | Remembered A: tall stacked, wide side-by-side; `D(D-place)` synthetic proof, physical feel pending; exact order TBD | V-WS-ANCHOR |
| R-WS-03 | WS1 `H[A,B*]`, trailing empty WS exists | Send B via the trailing-empty shortcut (`0` target) | Reuse existing empty vs create another; focus | TBD | TBD | TBD | TBD | TBD | Windows: reuse trailing empty; per-output-local mapping; `D(D-dec-win)` (2026-10-02); KDE mapping TBD | V-WS-FOLLOW |
| R-WS-04 | WS1 `H[A,B*]`; WS2 `H[C,D]` | On WS2 focus D then C; float C to remove the remembered leaf; select WS1/focus B; send B to WS2 | Memory invalidation; surviving D from history vs root; axis/order/follow | TBD | TBD | TBD | TBD | TBD | Valid focus-history after invalid remembered leaf, then genuine no-focus root; selected `D(D-dec-x)`; scenario result TBD | V-WS-ANCHOR |
| R-WS-05 | WS1 `H[A,B*]`, WS2 empty | Send B to WS2; select WS2/focus B; float B; request send B back to WS1; select WS1 | Whether floating B can transfer; retained float vs fresh tiled admission; focus | TBD | TBD | TBD | TBD | TBD | TBD (explicit send applies to focused tiled windows `D(D-dec-cos)`; floated roundtrip untested) | V-FLOAT-GEO |
| R-WS-06 | WS1 tiled `H[A,B*]`; WS2 floating | Send B to WS2; send B back to WS1 | Native membership/follow, source reflow and floating frame preservation vs two-domain plan | TBD | TBD | TBD | TBD | TBD | KDE: membership-only boundary send, only tiled side reflows `D(D-dec-ww)`; Windows: synthetic/native Paint roundtrip preserves floating frame, reflows source before hide and freshly admits on return [workspace mode record](../changes/archive/windows-workspace-tiling.md); physical feel TBD | V-WS-FOLLOW |
| R-WS-07 | WS1 `H[A,B*]`, WS2 `H[C*]` currently shown; KDE switcher includes all desktops | Select B in Alt+Tab | B listed vs omitted; switch to WS1 with B membership unchanged vs pull B into WS2 | TBD | TBD | TBD | TBD | TBD | KDE source: native filter permits B; TabBox activation follows configured policy, default switch to WS1, alternative bring-to-current; exact user-version live outcome TBD. Windows current `SW_HIDE`: B omitted; future inclusion/activation policy TBD. `D(D-alt-tab)` | V-WS-SHELL-ACTIVATE |

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

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|
| R-FLT-01 | `H[A,B*,C]` | Toggle float on B, then unfloat | Sibling reflow on float; unfloat placement + focus | Super+G toggle; `D(D-cosmic-kb)`; floats above tiles `D(D-ref)`; tree relation TBD | Float outside layout; `D(D-ref)`; geometry expressions | Stays in tree, uses no tiling space; `S(S-bsp-float)` | TBD | TBD | KDE: leaves tree, siblings reflow; first float centered 60%, then retained frame; unfloat fresh admission, focus retained; `D(D-dec-ww)`; Windows same + keep-above preimages; behavior rows user-owned `D(D-float)` | V-FLOAT-GEO |
| R-FLT-02 | `H[A,B*]` + WS2 | Sticky-on B, switch WS, sticky-off | Visibility across WS; off placement | Excluded from tiling, stays on top; `D(D-ref)` | Float-only guard `S(S-hyp-pin)`; all-workspaces per docs `D(D-ref)` | Monitor-desktop scope only; `S(S-bsp-sticky)` | TBD | TBD | All managed workspaces of output, float-only; Win+Shift+G; origin-honoring off (tiled fresh-admits, float stays float); `D(D-dec-ww)` KDE + `D(D-sticky)` Windows scoped proof | V-STICKY-SCOPE |
| R-FLT-03 | 1920px effective parent width; `H[A,B,C]` 50/30/20 (960/576/384) | Float A (50% child); do not unfloat | Survivor widths: ratio-preserve vs equalize | B/C become 60/40 at 1152/768, ratio preserved; `UT(2026-08-22)` + [Test C](../cosmic-move-conformance.md#follow-up-manual-observations-tests-a-c) | TBD | TBD | TBD | TBD | TBD (Engine removal reflow not checked here) | V-FLOAT-REFLOW |
| R-FLT-04 | Workspace tiled with A/B, optionally intentional per-window float C | Toggle workspace floating; move A; open D; toggle tiled | Untouched frames/native new window, fresh fit vs retained layout; C exception and effects | TBD | TBD | TBD | TBD | TBD | KDE: floating/tiled user-confirmed, no-write release/fresh fit selected `D(D-dec-ww)`; Windows: native move/new-window/frame preservation, release/fresh fit, independent border and floating drag underlay/preview suppression proven synthetically; C exception preserved by actual Engine regression, physical row TBD [record](../changes/archive/windows-workspace-tiling.md) | V-WS-TILING |
| R-FLT-05 | B sticky floating on WS1; WS2 exists | Restart tiler owner; select WS2 | B remains sticky-visible vs becomes ordinary float; remembered origin | TBD | TBD | TBD | TBD | TBD | KDE source adopts surviving native sticky as unknown-origin sticky float; Windows consumes surviving project marker into normal float on current managed workspace, discarding origin; `S(S-ours-sticky-restart)` + `D(D-sticky)`; exact restart/visibility journey TBD | V-STICKY-SCOPE |
| R-FLT-06 | Workspace tiled; B is intentional ordinary float, then natively maximized | With B focused, toggle ordinary float once | Overlay refusal vs logical unfloat beneath retained maximize; settled slot/frame/focus | TBD | TBD | TBD | TBD | TBD | KDE dispatch gate allows floating target despite maximize; unfloat transition clears floating intent while overlay writes are skipped, settled result TBD. Windows refuses `float-refused-maximize`; `S(S-ours-overlay-unfloat)`; physical outcome TBD | V-FLOAT-GEO / V-MAX-MODEL |
| R-FLT-07 | `H[A,B*]` + F floating `(1000,500,300,200)` | Focus left | Can tile-origin focus enter ordinary/sticky F | A; F excluded from tiled search, ordinary/sticky alike; `S(S-cos-flt-focus)` | A; ordinary/pinned F excluded; `S(S-hyp-flt-focus)` + `S(S-hyp-flt-pin)` | A; F is eligible but boundary distance A=1 < F=19; sticky same; `S(S-bsp-flt-focus)` | A; floating/sticky F outside tiled walk; `S(S-i3-flt-focus)` | TBD (directional implementation unspecified; `S(S-xmo-core-nav)`) | KDE/Windows: A; ordinary/sticky F has no tile leaf, hence never a target; `S(S-ours-flt-target)` | - |
| R-FLT-08 | `H[A,B]` + F* floating `(500,500,300,200)`; no other floats | Focus right | Float-origin focus enters tiles vs misses/refuses | No local target: tiles excluded; output fallback has no next output, F retained. Sticky same; `S(S-cos-flt-focus)` + `S(S-cos-focus-fallback)` | No-op: float-only search and edge retry find no other float; pinned same; `S(S-hyp-flt-focus)` + `S(S-hyp-flt-pin)` | B; unqualified selector crosses layers (distance B=481 < A=799); sticky same; `S(S-bsp-flt-focus)` | F retained: horizontal floating-list wrap selects self; sticky same; `S(S-i3-flt-focus)` | TBD (directional implementation unspecified; `S(S-xmo-core-nav)`) | KDE: refuses `focus-refused-floating` for ordinary/sticky F. Windows: refuses `focus-refused-floating` / `focus-refused-sticky`; F retained; `S(S-ours-flt-subject)` | - |
| R-FLT-09 | `H[A,B]` + F* floating `(500,500,300,200)` + ordinary float G `(1800,500,300,200)` | Focus right | Farther float G vs nearer tile B; sticky-to-ordinary focus | G; ordinary/sticky floats share candidates, tiles excluded; x-coordinate delta selects G; `S(S-cos-flt-focus)` | G by floating angle/distance search, not COSMIC's top-left-axis rule; pinned F same; `S(S-hyp-flt-focus)` + `S(S-hyp-flt-pin)` | B; all layers eligible, boundary distance B=481 < G=1001; sticky F same; `S(S-bsp-flt-focus)` | G; next floating-list entry (wrap if needed), not geometry; sticky F same; `S(S-i3-flt-focus)` | TBD (directional implementation unspecified; `S(S-xmo-core-nav)`) | KDE/Windows: F retained; same subject refusals as R-FLT-08, G never considered; `S(S-ours-flt-subject)` | - |
| R-FLT-10 | `H[A,B]` + free, unsnapped F* floating `(1000,500,300,200)` | Move right once | Move/resize geometry vs tree swap vs refusal; remains floating vs tiles | Right-half snap `(1280,0,1280,1440)` in floating layer, not tile-tree admission; sticky same. Later snap-state transitions can quarter/maximize or request workspace/output transfer; `S(S-cos-flt-move)` | Snap F to right work-area edge, retain size/y and floating state (reserved extents affect exact x); pinned same; `S(S-hyp-flt-move)` + `S(S-hyp-flt-pin)` | Profile swaps F/B tree nodes; F stays floating at its original frame/focus, tile arrangement recomputed (B exact frame TBD). Sticky same; `S(S-bsp-flt-focus)` + `S(S-bsp-flt-swap)`. Separate pixel `-v` moves F, not this profile action; `S(S-bsp-move)` | Bare `move right`: F.x += 10px, stays floating; sticky same; `S(S-i3-flt-move)` | TBD (directional implementation unspecified; `S(S-xmo-core-nav)`) | KDE: refuses `move-refused-floating` for ordinary/sticky F. Windows: refuses `move-refused-floating` / `move-refused-sticky`; frame/state retained; `S(S-ours-flt-subject)` | V-FLOAT-GEO |

## 5. Maximise / fullscreen

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|
| R-MAX-01 | `H[A,B*,C,D]` equal shares, effective width 2544px, gap 8; min widths 401/864/627/582 constrain actual allocation | Maximize B, then restore B | Sibling desired/actual stability, retained hints, exact slot, convergence delay | Super+M distinct from F11; `D(D-cosmic-kb)`; numeric sibling behavior TBD | `maximized` vs `fullscreen` modes; `D(D-ref)`; numeric result TBD | No maximize state (`monocle` is layout); `D(D-ref)` | TBD | TBD | KDE: slot/share kept, no writes, exact restore `D(D-dec-ww)`; Windows: same + retained hints + bounded async restore; synthetic proof `D(D-max)` + `D(D-place)`; physical feel pending | V-MAX-MODEL |
| R-MAX-02 | `H[A,B*]` | Fullscreen B; focus A; focus B; exit fullscreen | Tree mutation; focus enter/leave; restore | Separate focus surface; `D(D-ref)`; sequence outcome TBD | Covers, returns to slot; `D(D-ref)`; focus sequence TBD | Fills monitor, tree kept; `D(D-ref)`; focus sequence TBD | TBD | TBD | Retained slot overlay; focus may enter/leave; `D(D-dec-ww)` KDE + `D(D-fs)` Windows scoped proof; physical focus sequence pending | V-FS-SLOT |
| R-MAX-03 | Workspace floating, first-seen maximized A without a prior tile slot | Toggle tiled; restore A if still maximized | Preserve floating maximum, then one-shot native restore and actual fresh tiled plan/write/readback | TBD | TBD | TBD | TBD | TBD | KDE source: floating gate skips admission clear; first tiled admission restores unslotted maximum once and refetches normal state (`kwin/src/plan-adapter.ts:4883-4888,5330-5397`); Windows: slotless membership preserves floating maximum and hide/reveal, then one clear and fresh tiled plan/native write/matched target readback proven with Notepad/Paint; slotted overlays skip re-clear [accepted correction](../changes/archive/windows-workspace-tiling.md#r-max-03-accepted-correction); physical feel TBD | V-WS-TILING |
| R-MAX-04 | `H[A,B*]`; B normal and remains the same native window | Shortcut-maximize B; native-restore B; press the same shortcut again | New maximize attempt vs persistent attempted-state refusal | TBD | TBD | TBD | TBD | TBD | KDE repaired 2026-10-05: same-ref adapter regression issues a new native attempt after restore (and reverse ordering), `D(D-kde-follow)`; earlier refusal remains historical `S(S-ours-toggle)`. Windows dispatches one attempt per new discrete down, `D(D-dec-max)`; physical repeat/delivery outcome TBD | V-MAX-MODEL |
| R-MAX-05 | B entered app-owned fullscreen without a tiler fullscreen preimage | Focus B; request project fullscreen toggle | Native exit attempt vs refusal of app-owned fullscreen; slot/geometry after exit | TBD | TBD | TBD | TBD | TBD | KDE invokes public fullscreen setter toward normal; Windows refuses app-owned exit without its restoration preimage, never synthesizes app F11; `S(S-ours-fs-exit)` + `D(D-fs)`; app-specific native completion/slot outcome TBD | V-FS-SLOT |
| R-MAX-06 | Tiled workspace with B; first-seen eligible maximized A has no retained tile slot and is not fullscreen | Admit A; later natively restore A | One-shot launch restore vs reserved-slot overlay vs slotless hold; B allocation, A admission and focus | Tiles A then applies requested maximum as overlay with tile slot retained; other existing maxima unmaximized first; `S(S-cos-bornmax)`; exact focus/restore TBD | Pending maximum applied at map as maximized mode; `S(S-hyp-bornmax)`; exact siblings/focus TBD | Ordinary tile state; maximum flags not admission state, fullscreen handled separately; `S(S-bsp-admit)`; exact focus TBD | Ordinary tiling; maximum flags derive from layout; `S(S-i3-admit)`; exact focus TBD | Core ordinary manage/tile path; `S(S-xmo-admit)`; hooks/contrib and exact focus TBD | Current KDE/Windows make one admission-time clear attempt; retained slots/fullscreen/floating domains are exempt. Proposed preserve variants and later setting are unselected; exact native journey TBD, `D(D-min-games)` | V-MAX-MODEL |
| R-MAX-07 | Captionless window covers the full monitor; KDE native fullscreen and maximize flags are false | First observe/admit it | Fullscreen exemption vs ordinary tiling despite monitor coverage | TBD (size-inference path not fully established) | TBD (size-inference path not fully established) | Ordinary manage absent fullscreen atom/rule; `S(S-bsp-admit)`; exact fixture TBD | Ordinary manage absent fullscreen atom/override-redirect; `S(S-i3-admit)`; exact fixture TBD | Core ordinary manage path; `S(S-xmo-admit)`; hooks/contrib and exact fixture TBD | KDE does not infer fullscreen from size, so no maximize-clear but ordinary tiling is possible; Windows captionless monitor containment classifies fullscreen. Actual game presentation mode is not established by either shape; `D(D-min-games)` | V-FS-SLOT |

## 6. Startup adoption

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|
| R-START-01 | Tiling off; 2560x1380 work area, gaps 8; A(8,8,1268,678), B(1284,8,1268,678), C(8,694,1268,678), D(1284,694,1268,678); focus A,B,C,D; minima fit | Enable tiling; disable/re-enable | Identity/order/topology vs sequential remap; second-enable stability | Floating windows mapped sequentially via tiling_layer.map `S(S-cos-seq)`; resulting rects/order/focus TBD | TBD | TBD | TBD | TBD | Clean/tolerance-valid recursive-cut adoption preserved; `D(D-dec-x)` provisional; exact fixture TBD | V-START-SEED |
| R-START-02 | Tiling off; 2560x1380 work area, gaps 8; A(80,80,1000,700), B(120,120,1000,700), C(160,160,1000,700), D(200,200,1000,700); focus A,B,C,D; minima 400x200 each | Enable tiling | Centre-cut inference vs long-edge seed; final axes and identity order | TBD | TBD | TBD | TBD | TBD | Decline centre splits to deterministic long-edge bisection chain, not guaranteed 2x2; `D(D-place)` provisional, shared KDE+Windows; exact fixture TBD | V-START-SEED |
| R-START-03 | As START-02 plus E(240,240,1000,700); A/B/C minima 401x246, D(Paint) 864x617, E(Calc) 402x627; focus A,B,C,E,D; usable inner 2544x1364, gap 8 | Enable tiling | Feasibility fallback, skipped/floated/clamped writes, final origins, overlap/overflow | TBD | TBD (client-hint divergence noted; `D(D-prof)`) | Hints off, honor_size_hints opt-in; `S(S-bsp-hint)`; exact result TBD | TBD | TBD | Windows: tile origin, extent at least declared minimum (overlap/overflow possible); KDE still skips; `D(D-place)` + `D(D-dec-win)` provisional divergence; exact fixture TBD | V-START-MIN |

## 7. Close / reflow

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|
| R-CLOSE-01 | `H[A,B,C]`; focus A,C,B so B is active and C is next MRU | Close B | Collapse + focus selection (MRU vs spatial) | Share redistribution `S(S-cos-rem)`; focus selection TBD | Dwindle live-tree removal; `D(D-prof)`; focus TBD | Sibling subtree promoted; `D(D-prof)`; focus TBD | TBD | TBD | Leaf removed, C selected as source-MRU top; `D(D-dec-cos)` | V-CLOSE-FOCUS |
| R-CLOSE-02 | `H[A,B,C]` manual 50/30/20; focus A,C,B | Close B; focus C; open a new B with same app/rules | Survivor rescale; fresh admission vs old ratio/slot; reopened focus | TBD | TBD | TBD (balance command existence does not establish close/reopen) | TBD | TBD | TBD (close/reopen ratio memory and focus not checked here) | V-CLOSE-FOCUS |

## 8. Groups / stacks

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|
| R-GRP-01 | `H[A,B*]` | Toggle stack on the group, switch tabs | Split-to-stack conversion; tab switch | Super+S toggle; tabs at top; switch with Super+Left/Right; `D(D-ref)` | `into_group`/`out_of_group` tab group; `D(D-ref)` | No groups (`monocle` is layout, not tabs); `D(D-ref)` | TBD (tabbed/stacked containers per `D(D-prior)`) | TBD | Deferred: centre-stack drops refused fail-closed; no tab carrier/bindings; `D(D-dec-cos)` | V-GROUP-STACK |

## 9. Multi-output

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|
| R-OUT-01 | `L=X`, `R=H[A*,B]` | Move A left (occupied target) | Cross vs wrap; target split shape | `L=H[X,A]`, `R=B` R4; [S20-01](../cosmic-move-conformance.md#sequence-s20---horizontal-output-crossing) authored observation | TBD | `-m` transfer exists; exact split TBD; `S(S-bsp-send)` | TBD | TBD | Exhausted horizontal R4 into output's current workspace; same commit/fence protocol as send; `D(D-dec-cos)` offline only | V-R4-DIR |
| R-OUT-02 | `L=X`, `R=V[A*,B]` | Move A left (perpendicular) | In-output wrap wins vs cross | No cross; `R=H[A,B]` R1; [S21-01](../cosmic-move-conformance.md#sequence-s21---perpendicular-wrapno-cross-case) authored observation | TBD | TBD | TBD | TBD | Local R1 wins first; `D(D-dec-cos)` | V-R4-DIR |

## 10. Mouse drag

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|
| R-DRAG-01 | `H[A,B*,C]`, B tiled | Drag B onto C's centre (not an edge); release | Stack join vs refusal; source restoration | Zone names include WindowStack `S(S-cos-zone)`; centre-drop mapping TBD (community-only `D(D-ref)`) | Drag floats, drop re-tiles; centre mapping TBD; `D(D-ref)` | Pointer move floats only; no drag reflow; `D(D-ref)` | TBD | TBD | Centre stack request refused (snap-back); `D(D-dec-cos)` + `D(D-dec-nest)`; physical check pending | V-DRAG-ZONE |
| R-DRAG-02 | `H[A,B,C]` equal (640 each at 1920); existing N outside that group | Drag N to the between-child bar between A and B; release | Flat vs nested; mover share (n=4 after insertion) | Flat `H[A,N,B,C]`, all 480 (mover 1/n, peers scaled); `UT(2026-08-22)` + [Test B](../cosmic-move-conformance.md#follow-up-manual-observations-tests-a-c) | TBD | TBD | TBD | TBD | TBD (between-child drop not checked here) | V-DRAG-ZONE |
| R-DRAG-03 | `H[A,B*]`, both tiled | Title-bar drag B to A's top edge; repeat from the same start with Meta/Win+left client drag | Same drop topology and mover; no client click or sibling reflow before drop | TBD | TBD | TBD | TBD | TBD | KDE: same resolver selected `D(D-dec-drag)`; Windows: both producers delivered with three-window synthetic preview/drop agreement and mid-hold sibling stability; exact row TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-04 | `H[A,B*]`, both tiled | Start moving B; press Esc; release | Source topology/geometry retained; no drop plan; preview cleared | TBD | TBD | TBD | TBD | TBD | KDE: cancelled verdict makes no plan and clears preview `D(D-dec-drag)`; Windows: synthetic title/Win Esc restores all frames without mutation, Win preview hidden before Up; physical edge/exact row TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-05 | `H[A,B*]`, both tiled | Press/release the move gesture on B without moving | No topology/share change or preview residue | TBD | TBD | TBD | TBD | TBD | KDE: no-change verdict makes no plan `D(D-dec-drag)`; Windows: synthetic title/Win zero-move preserves all frames without mutation or preview residue on a three-window fixture; exact row TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-06 | `H[A,B*]`, one output with a panel/taskbar outside the work area | Move B; release over the panel/taskbar outside the work area | Source restoration vs off-area placement; preview cleared | TBD | TBD | TBD | TBD | TBD | KDE: unresolved target snaps back `D(D-dec-drag)`; Windows: title/Win taskbar-outside refusal restores all frames without mutation or preview residue on a three-window fixture; exact row TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-07 | `H[A,B*]`, both tiled | Meta/Win+left client drag B to A's edge; pause before release | Native frame follows pointer vs retained source allocation with target-slot preview; final placement unchanged | TBD | TBD | TBD | TBD | TBD | KDE: native frame moves and target-slot preview is selected `D(D-dec-drag)`; Windows: provisional stationary source with visible target-slot preview, three-window synthetic freeze/preview/drop proof; exact row TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-08 | `H[A*,B]`, B unfocused tiled | Meta/Win+left client press on B; move; release at A's edge | Native focus changes at press vs drop; dragged group visual without changing retained focus | TBD | TBD | TBD | TBD | TBD | KDE: exact focus timing TBD; Windows: provisional foreground retained during hold, B activated on valid drop; synthetic unfocused-mover proof, C parked `D(D-win-drag)` | V-DRAG-ZONE |

## 11. Owner controls and startup settings

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|
| R-CTL-01 | Windows settings absent | Start owner; choose Compatible; stop; restart | Preset persists; first-run prompt does not recur | TBD | TBD | TBD | TBD | TBD | Windows: authentic default offered, compatible saves 35 disabled rows; existing-file startup skips prompt; synthetic/native proof [tray record](../changes/archive/windows-tray-first-run.md); KDE first-run TBD | V-FIRST-RUN |
| R-CTL-02 | Owner's first-run prompt open, settings absent | Publish settings from another writer; accept stale prompt choice | Preserve newer settings vs overwrite | TBD | TBD | TBD | TBD | TBD | Windows: discard stale choice, load authoritative file, bytes unchanged; same record; other platforms TBD | V-FIRST-RUN |
| R-CTL-03 | Running owner with notification icon | Lose icon registration; post TaskbarCreated; stop from menu | Exactly one icon returns; Stop removes icon and owner effects | TBD | TBD | TBD | TBD | TBD | Windows: GUID-delete fixture then posted message re-adds one icon; actual menu Stop cleans up; same record. Real Explorer restart TBD; KDE lifecycle is separate | V-TRAY-LIFECYCLE |
| R-CTL-04 | Existing tiled workspace, new-workspace default Tiled | Save Floating default; create new workspace; restart owner | Existing override stays, new workspace floating, startup saved default | TBD | TBD | TBD | TBD | TBD | KDE selected `D(D-dec-ww)`, default live proof TBD; Windows tray/UI file readbacks, owner adoption, existing tiled/new floating checks and saved-default startup native proof [record](../changes/archive/windows-workspace-tiling.md); physical restart journey TBD | V-WS-TILING |
| R-CTL-05 | KDE focus-right kept; Lock Session on Meta+L | Stage Compatible; ordinary settings Save; Apply Shortcuts; reopen; restart session | Staging/Save leave shortcuts untouched; Disable survives; Lock Session unchanged | TBD | TBD | TBD | TBD | TBD | KDE selected: explicit own-action clear, native storage authoritative, no Lock relocation while disabled; live restart/physical delivery TBD [record](../changes/kde-shortcut-conflicts.md) | V-SHORTCUT-CONFLICT |
| R-CTL-06 | KDE foreign action has a project chord plus an unrelated chord | Keep conflicting row; Apply; preview Force; edit row to Disable; try Force; Apply | Draft edit invalidates preview; disabled row causes no foreign clearing; unrelated chord survives | TBD | TBD | TBD | TBD | TBD | KDE selected: exact draft/owner/presence/active-image revalidation, no disabled-key holder mutation; live outcome TBD [record](../changes/kde-shortcut-conflicts.md) | V-SHORTCUT-CONFLICT |
| R-CTL-07 | KDE Force previously cleared a noncompiled foreign default chord | Stage Compatible; Apply; Revert Shortcuts | Default conflict still disabled; no automatic restore; separate Revert restores foreign defaults and retains own Disable | TBD | TBD | TBD | TBD | TBD | KDE selected: compiled plus discovered defaults/current holders; Revert remains default restoration, not preimage recovery; live outcome TBD [record](../changes/kde-shortcut-conflicts.md) | V-SHORTCUT-CONFLICT |

## 12. Minimum-size transitions

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|
| R-MIN-01 | Tiled `H[A*,B]`, inner area 1080x300, gap 8; A/B minima 500x100 | Open C with minimum 100x100 | Newcomer vs existing member infeasibility; which window floats, skips or overlaps; alternative arrangement considered or not | Traced allocation/cropping without minimum enforcement; fixed-size admission floats separately; `S(S-cos-min)`; exact native fixture TBD | Tiled limits off by default; opt-in clamp/recenter may overlap/overflow, not auto-float; `S(S-hyp-min)`; exact fixture TBD | Hints default off `S(S-bsp-hint)`; opt-in clamps every leaf on reflow, including existing members `S(S-bsp-min)`; exact fixture/fence wiring TBD | Traced tiled render without minimum clamping; fixed-size admission floats separately; `S(S-i3-min)`; exact fixture TBD | Core tile sizing without hint clamp; fixed/transient admission floats separately; `S(S-xmo-admit)`; hooks/layout/exact fixture TBD | Shared projection reallocates within the selected tree, without alternative-arrangement search; overconstrained members keep slots, KDE skips writes, Windows uses origin+minimum. Exact fixture/result TBD; automatic victim/return policy unselected, `D(D-min-games)` | V-START-MIN |
| R-MIN-02 | Tiled `H[A,B]`, inner width 1220, gap 8; both minimum widths 600 | Shrink inner width to 1080 | Existing members become infeasible; native frames, focus, float intent and recovery after width grows | Same traced allocation/cropping `S(S-cos-min)`; native shrink/grow/focus TBD | Same tiled clamp setting `S(S-hyp-min)`; default unclamped, opt-in recentered clamp; exact shrink/grow/focus TBD | Same per-leaf hint clamp when enabled `S(S-bsp-min)`; off by default; exact recovery/fence TBD | Same tiled allocation `S(S-i3-min)`; exact shrink/grow/focus TBD | Core unconditional tile sizing `S(S-xmo-admit)`; hooks/exact shrink/grow/focus TBD | Same shared minimum projection; current KDE skip/Windows origin+minimum, neither auto-floats. Exact shrink/grow journey TBD. A hint-only change on KDE is not an independent dispatch trigger, `D(D-min-games)` | V-START-MIN |
| R-MIN-03 | Empty tiled domain, inner area 1080x600 | Open A with declared minimum 1200x500 | Tile/flag vs automatic float; overflow remains even without siblings | Same tile allocation/cropping; fixed-size exception not oversized-min policy; `S(S-cos-min)`; native sole-leaf result TBD | Same default-unclamped/opt-in-clamped tiling `S(S-hyp-min)`; native sole-leaf result TBD | Default hints off; honored hints grow leaf at origin `S(S-bsp-min)`; native exact frame TBD | Same tiled render for ordinary resizable client `S(S-i3-min)`; native exact result TBD | Core asks for sole tile rectangle regardless of minimum `S(S-xmo-admit)`; native/hooks result TBD | Core projects the sole leaf and flags its violated minimum; KDE skips, writable Windows raises width at tile origin. Floating cannot make this minimum fit the work area; exact native journey TBD, `D(D-min-games)` | V-START-MIN |

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
