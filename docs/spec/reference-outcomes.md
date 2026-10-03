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
  [windows-mouse-drag.md](../changes/windows-mouse-drag.md)
  (reopened after blocked native-loop experiment; producer slices under verification)
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
- `D-cosmic-kb` COSMIC keybindings.ron / support articles via `D-ref`
  (Super+O/S/G/M/F11 bindings)

## Variant hooks (provisional, not commitments)

| Hook | Meaning | Status |
|---|---|---|
| V-INS-AXIS | New-window split axis: long-edge vs orientation-toggle vs alternate | Selected as user statement `D-dec-x` |
| V-MOVE-PERP | Perpendicular move: COSMIC restructure vs no-op/swap | COSMIC R1 selected; foreign swap/no-op unselected (`D-dec-cos`) |
| V-MOVE-NARY | 3+-child wrap vs flat insert; same-orientation nesting allowed | Ordered N-ary + R2b/R2c/R3 selected (`D-dec-cos`) |
| V-WS-FOLLOW | Send follows focus vs leaves focus in source | `D-dec-cos` selects follow-on-verified-transfer; step-3 |
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

## 4. Float / sticky

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|
| R-FLT-01 | `H[A,B*,C]` | Toggle float on B, then unfloat | Sibling reflow on float; unfloat placement + focus | Super+G toggle; `D(D-cosmic-kb)`; floats above tiles `D(D-ref)`; tree relation TBD | Float outside layout; `D(D-ref)`; geometry expressions | Stays in tree, uses no tiling space; `S(S-bsp-float)` | TBD | TBD | KDE: leaves tree, siblings reflow; first float centered 60%, then retained frame; unfloat fresh admission, focus retained; `D(D-dec-ww)`; Windows same + keep-above preimages; behavior rows user-owned `D(D-float)` | V-FLOAT-GEO |
| R-FLT-02 | `H[A,B*]` + WS2 | Sticky-on B, switch WS, sticky-off | Visibility across WS; off placement | Excluded from tiling, stays on top; `D(D-ref)` | Float-only guard `S(S-hyp-pin)`; all-workspaces per docs `D(D-ref)` | Monitor-desktop scope only; `S(S-bsp-sticky)` | TBD | TBD | All managed workspaces of output, float-only; Win+Shift+G; origin-honoring off (tiled fresh-admits, float stays float); `D(D-dec-ww)` KDE + `D(D-sticky)` Windows scoped proof | V-STICKY-SCOPE |
| R-FLT-03 | 1920px effective parent width; `H[A,B,C]` 50/30/20 (960/576/384) | Float A (50% child); do not unfloat | Survivor widths: ratio-preserve vs equalize | B/C become 60/40 at 1152/768, ratio preserved; `UT(2026-08-22)` + [Test C](../cosmic-move-conformance.md#follow-up-manual-observations-tests-a-c) | TBD | TBD | TBD | TBD | TBD (Engine removal reflow not checked here) | V-FLOAT-REFLOW |

## 5. Maximise / fullscreen

| ID | Start | Action | Observe | COSMIC | Hyprland | bspwm | i3 | xmonad | Ours (KDE/Windows) | Variant |
|---|---|---|---|---|---|---|---|---|---|---|
| R-MAX-01 | `H[A,B*,C,D]` equal shares, effective width 2544px, gap 8; min widths 401/864/627/582 constrain actual allocation | Maximize B, then restore B | Sibling desired/actual stability, retained hints, exact slot, convergence delay | Super+M distinct from F11; `D(D-cosmic-kb)`; numeric sibling behavior TBD | `maximized` vs `fullscreen` modes; `D(D-ref)`; numeric result TBD | No maximize state (`monocle` is layout); `D(D-ref)` | TBD | TBD | KDE: slot/share kept, no writes, exact restore `D(D-dec-ww)`; Windows: same + retained hints + bounded async restore; synthetic proof `D(D-max)` + `D(D-place)`; physical feel pending | V-MAX-MODEL |
| R-MAX-02 | `H[A,B*]` | Fullscreen B; focus A; focus B; exit fullscreen | Tree mutation; focus enter/leave; restore | Separate focus surface; `D(D-ref)`; sequence outcome TBD | Covers, returns to slot; `D(D-ref)`; focus sequence TBD | Fills monitor, tree kept; `D(D-ref)`; focus sequence TBD | TBD | TBD | Retained slot overlay; focus may enter/leave; `D(D-dec-ww)` KDE + `D(D-fs)` Windows scoped proof; physical focus sequence pending | V-FS-SLOT |

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
| R-DRAG-03 | `H[A,B*]`, both tiled | Title-bar drag B to A's top edge; repeat from the same start with Meta/Win+left client drag | Same drop topology and mover; no client click or sibling reflow before drop | TBD | TBD | TBD | TBD | TBD | KDE: same resolver selected `D(D-dec-drag)`; Windows: title producer delivered with feasible three-window synthetic proof and mid-hold sibling stability; exact row/Win equivalence TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-04 | `H[A,B*]`, both tiled | Start moving B; press Esc; release | Source topology/geometry retained; no drop plan; preview cleared | TBD | TBD | TBD | TBD | TBD | KDE: cancelled verdict makes no plan and clears preview `D(D-dec-drag)`; Windows: synthetic title Esc restores all frames with no mutation on a three-window fixture; physical edge/exact row/preview TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-05 | `H[A,B*]`, both tiled | Press/release the move gesture on B without moving | No topology/share change or preview residue | TBD | TBD | TBD | TBD | TBD | KDE: no-change verdict makes no plan `D(D-dec-drag)`; Windows: synthetic title zero-move preserves all frames with no mutation on a three-window fixture; exact row/preview TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-06 | `H[A,B*]`, one output with a panel/taskbar outside the work area | Move B; release over the panel/taskbar outside the work area | Source restoration vs off-area placement; preview cleared | TBD | TBD | TBD | TBD | TBD | KDE: unresolved target snaps back `D(D-dec-drag)`; Windows: taskbar-outside refusal restores all frames with no mutation on a three-window fixture; exact row/preview TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-07 | `H[A,B*]`, both tiled | Meta/Win+left client drag B to A's edge; pause before release | Native frame follows pointer vs retained source allocation with target-slot preview; final placement unchanged | TBD | TBD | TBD | TBD | TBD | KDE: native frame moves and target-slot preview is selected `D(D-dec-drag)`; Windows: provisional stationary mover delivered, three-window synthetic freeze/drop proof; exact row/preview TBD `D(D-win-drag)` | V-DRAG-ZONE |
| R-DRAG-08 | `H[A*,B]`, B unfocused tiled | Meta/Win+left client press on B; move; release at A's edge | Native focus changes at press vs drop; dragged group visual without changing retained focus | TBD | TBD | TBD | TBD | TBD | KDE: exact focus timing TBD; Windows: provisional foreground retained during hold, B activated on valid drop; synthetic unfocused-mover proof, C parked `D(D-win-drag)` | V-DRAG-ZONE |

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
