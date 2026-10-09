# Remaining reference source-fill triage

## Goal and scope

Triage all remaining reference TBD cells by WM to select high-yield,
context-bounded source passes. The initial triage classified existing evidence;
the counts and ledgers now include the completed PaperWM and karousel source
passes recorded in [PaperWM's outcome note](archive/paperwm-reference-source-fill.md)
and [karousel's outcome note](archive/karousel-reference-source-fill.md). No scenarios
were tightened. Documentation only; no live
testing, cloning, new source pins, source-checkout changes, or stash changes.
Ours is counted separately and is out of scope for reference source tracing.

## Initial triage acceptance and approach

- Reconcile every reference TBD cell to one primary blocker class, using
  existing cell/row/profile text and light pinned-source inspection for ambiguity.
- Report per-WM totals/classes, not-attempted area splits, missing-host-source
  and fixture-gap aggregates, and ranked expected source-pass yields.
- Independently spot-check a classification sample with a separate Worker.
- Verify coverage, counts, unchanged matrix/scenarios, diff scope and whitespace;
  commit and push this report only.

## Initial triage bounded units

1. Inventory plus one bounded per-WM classification unit at a time.
2. Reconcile aggregates and rank per-WM passes split by area.
3. Independent spot-check, report integration, checks, commit and push.

Workers use muse-spark, one active at a time. The Lead owns this note.

## Current evidence and classification method

- Initial triage baseline: `f4ad288`, 2026-10-09, committed as `abf7f26`.
  All 1,006 TBD reference cells out of 1,896 classified; triage alone closed
  zero cells. Current: **927 reference TBD**, after 42 PaperWM and 37 karousel closures.
  **Ours: 169 TBD**, excluded.
- Twelve reference profiles, as pinned in the [matrix index](../spec/reference-outcomes.md#wm-profiles-and-config-assumptions).
  KWin is not a separate column. Karousel's host KWin is already pinned at
  `8438567a` (`S-kwin-resizeable`, `S-kwin-tabbox`, `S-kwin-act`); unfinished
  tracing at that revision is not missing-host-source.
- Each cell counts once if it contains TBD, regardless of the number of TBD
  tokens. Separate explicit-swap cells under MOV-01/MOV-03 count separately.
  Five repeated WM/area/row triples give 1,006 cells but 1,001 distinct triples:
  Hyprland MOV-01/03, PaperWM MOV-01/03, paneru MOV-01.
- Workers read each remaining cell, its Given/When/Observe, global profile and
  existing notes; ambiguous cases received light source inspection, not full
  tracing. Existing source citations support triage but do not prove closure.
  A primary class identifies the selected remaining blocker; compound cells
  retain secondary limitations in the yield qualification below.
- **N, not-attempted:** the unresolved leg has not received adequate tracing
  and is likely answerable from pinned source. A partially sourced cell can
  still be N; the label concerns its remaining leg, not absence of source tags.
- **H, missing-host-source:** decisive policy resides in an unpinned external
  codebase, named below. Already-pinned dependencies do not qualify.
- **F, fixture-gap:** scenario/profile/action wording omits an input the code
  depends on, named below. Observe controls required precision.
- **L, live-only:** remaining outcome depends on runtime timing, client
  response or observation, rather than an unfinished deterministic policy trace.
- **U, unsupported-pending:** cited inventories establish no in-profile
  counterpart; explicit unsupported-outcome wording is the cheap closure.
- Reusable prior evidence: six preceding source groups reduced TBDs
  1,050 -> 1,006 (44 net); their detailed changes remain in git history.
  Qtile minimize/refocus still needs tracing. PaperWM selected-window
  reinsertion is now traced: selected+1 RIGHT; host-selected anchors remain
  qualified where needed. PaperWM has native live-alt-tab; do not repeat
  the old absence claim.
  Preserve unknown user-tested versions and the distinction between policy
  evidence and runtime acceptance. Approved deliberate deviations remain intact.
- Source access: some `/tmp/opencode` COSMIC/Hyprland/bspwm exports were
  empty or mismatched and were not accepted as pinned evidence. Workers used
  existing pinned citations, verified sibling checkouts where available, and
  pinned raw files for light checks. No sources were cloned or newly pinned.

## Per-WM summary

| WM/profile | TBD | N | H | F | L | U |
|---|---:|---:|---:|---:|---:|---:|
| COSMIC | 82 | 41 | 0 | 19 | 14 | 8 |
| Hyprland/Dwindle | 110 | 44 | 0 | 41 | 8 | 17 |
| bspwm | 90 | 42 | 0 | 20 | 8 | 20 |
| i3 | 66 | 13 | 0 | 13 | 18 | 22 |
| xmonad/Tall+Navigation2D | 75 | 41 | 0 | 7 | 4 | 23 |
| sway | 71 | 12 | 2 | 16 | 17 | 24 |
| qtile/Columns | 91 | 37 | 0 | 25 | 8 | 21 |
| awesome/tile | 89 | 50 | 0 | 19 | 8 | 12 |
| niri | 64 | 41 | 0 | 6 | 5 | 12 |
| PaperWM | 61 | 0 | 38 | 14 | 9 | 0 |
| karousel/Lazy | 36 | 0 | 1 | 27 | 8 | 0 |
| paneru | 92 | 57 | 18 | 3 | 1 | 13 |
| **Total references** | **927** | **378** | **59** | **210** | **108** | **172** |

## Not-attempted by area

All files are under `docs/spec/reference-outcomes/`. Abbreviations used here
and in the fixture ledger: COS=COSMIC, HYP=Hyprland/Dwindle, BSP=bspwm,
I3=i3, XMO=xmonad/Tall+Navigation2D, SWY=sway, QTI=qtile/Columns,
AWE=awesome/tile, NIR=niri, PAP=PaperWM, KAR=karousel/Lazy, PAN=paneru.

| Area file | COS | HYP | BSP | I3 | XMO | SWY | QTI | AWE | NIR | PAP | KAR | PAN | Total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| activation.md | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 2 |
| close.md | 1 | 2 | 2 | 0 | 5 | 0 | 0 | 0 | 1 | 0 | 0 | 4 | 15 |
| column-mechanics.md | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 3 | 0 | 0 | 6 | 11 |
| floating.md | 3 | 4 | 4 | 1 | 3 | 0 | 5 | 4 | 2 | 0 | 0 | 8 | 34 |
| focus.md | 0 | 3 | 2 | 0 | 1 | 0 | 1 | 1 | 1 | 0 | 0 | 3 | 12 |
| groups-stacks.md | 1 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 2 | 6 |
| insertion.md | 3 | 2 | 4 | 2 | 3 | 2 | 4 | 4 | 6 | 0 | 0 | 4 | 34 |
| layout-commands.md | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 3 |
| maximize-fullscreen.md | 4 | 5 | 4 | 2 | 5 | 2 | 5 | 5 | 1 | 0 | 0 | 1 | 34 |
| minimize.md | 2 | 0 | 0 | 0 | 0 | 0 | 3 | 2 | 0 | 0 | 0 | 3 | 10 |
| minimum-size.md | 3 | 2 | 3 | 0 | 3 | 0 | 3 | 3 | 3 | 0 | 0 | 3 | 23 |
| mouse.md | 3 | 2 | 4 | 0 | 6 | 1 | 0 | 5 | 9 | 0 | 0 | 2 | 32 |
| move.md | 5 | 3 | 3 | 1 | 6 | 1 | 2 | 1 | 0 | 0 | 0 | 6 | 28 |
| multi-output.md | 2 | 3 | 2 | 2 | 3 | 2 | 3 | 3 | 3 | 0 | 0 | 2 | 25 |
| resize.md | 0 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 7 |
| restart-persistence.md | 5 | 1 | 1 | 0 | 1 | 0 | 2 | 2 | 1 | 0 | 0 | 1 | 14 |
| special-windows.md | 6 | 2 | 3 | 1 | 2 | 1 | 2 | 5 | 4 | 0 | 0 | 4 | 30 |
| workspaces.md | 3 | 11 | 7 | 3 | 3 | 2 | 5 | 15 | 5 | 0 | 0 | 4 | 58 |
| **Total** | **41** | **44** | **42** | **13** | **41** | **12** | **37** | **50** | **41** | **0** | **0** | **57** | **378** |

Duplicate remaining N cells occur only in paneru MOV-01. PaperWM MOV-01/03
main and explicit-swap cells are now closed. Both Hyprland MOV-01/03 legs
are F, not N.

## Missing-host-source aggregate

Counts are unique **primary H cells per external source group**, indicating
source legs that could be unlocked, not guaranteed whole-cell completion.
GNOME Shell includes its `org.gnome.shell.app-switcher` schema; Shell/Mutter
are grouped because several PaperWM cells span both. Their union is now 38
(17 existing plus 21 reclassified after extension tracing). The other primary
H cells are sway 2, paneru 18 and karousel 1: total 59.

| External codebase/platform | Cells | WMs | Missing policy | Suggested revision approach, no pin performed |
|---|---:|---|---|---|
| GNOME Shell/Mutter, including app-switcher schema | 38 | PaperWM | Workspace lifecycle/session wiring, activation/urgency/refocus, native move/resize, sticky/float/overlay visibility and stacking, startup stacking/tab-list policy, type/fence behavior, hotplug and output-neighbor tie order | Select a PaperWM-compatible GNOME release; record exact paired Shell/Mutter distro revisions/patches and deployed build; freeze `current-workspace-only` value/schema. |
| wlroots | 2 | sway | Adjacent-output equal-distance tie selection | Read sway `1652c54b` dependency/build declarations; pin the exact compatible deployed wlroots revision, not unrelated latest. |
| macOS proprietary host platform | 18 | paneru | WindowServer/native window policy (16), menu bar/NSStatusItem (1), native switcher (1) | No public implementation source to pin. Record macOS build, SDK and documented AX/CoreGraphics/AppKit contracts; opaque host policy still needs later observation. A new source pin cannot promise these closures. |
| Plasma session manager (ksmserver), plus app session participation | 1 | karousel | Post-session restored app set/order, rematching and layout recovery; karousel's fresh adoption is traced | Select the deployed Plasma-compatible ksmserver revision and app/session restore inputs; KWin `8438567a` is already pinned and is not this missing dependency. |

Primary H cell ledger (IDs below retain their `R-` prefix):

- GNOME Shell/PaperWM: R-CLOSE-04; R-FLT-14; R-MNZ-03; R-MOU-01;
  R-CTL-03; R-RST-02; R-WS-07/09/16/17/18/20/23.
- Mutter/PaperWM: R-FLT-14; R-DRAG-08; R-MOU-01; R-MOV-12;
  R-SPC-01; R-WS-17/27.
- Newly primary H/PaperWM (21, Shell/Mutter union): R-ACT-01/02;
  R-CLOSE-05; R-FLT-02/05/12/13; R-GRP-03; R-MAX-09;
  R-MNZ-01/02; R-DRAG-03; R-MOU-02; R-OUT-06; R-START-01/02/03;
  R-SPC-02; R-WS-05/24/25. These extension legs are traced; the cells
  name their remaining host policy. Startup cells retain secondary viewport
  fixture limits; R-START-03 also retains client-settlement limits.
- wlroots/sway: R-MOV-12; R-WS-27 (`wlr_output_layout_adjacent_output`
  after pinned sway output-direction delegation).
- macOS WindowServer/native policy/paneru: R-CLOSE-05; R-FLT-02/05/06/14;
  R-MAX-01/04/06/08/09; R-DRAG-08; R-MOU-01; R-MOV-12; R-OUT-06;
  R-RST-02; R-SPC-11. Menu bar: R-CTL-03. Switcher: R-WS-07.
- Plasma session manager/karousel: R-RST-02 (startup re-adoption traced;
  session-restored app participation/order and rematching remain unpinned).
- Secondary host limits are excluded from primary unlock counts. PaperWM's
  newly F cells R-WS-12/22, R-RST-01 and R-SPC-03/13 retain host
  qualifications; R-DRAG-04 retains host Esc-interception uncertainty.
  COSMIC's pinned `cosmic-comp` references are not external missing hosts.

## Fixture-gap aggregate

**210 cells across 75 scenario rows.** This ledger identifies wording to
tighten in Given, When or the profile; it does not edit scenarios or choose
the missing values. Counts include two HYP explicit-swap extras. The existing
profile defaults remain fixed; projection entries ask how a foreign fixture
maps to that profile, not permission to change defaults.

| Area / row (cells) | WMs | Missing input(s) |
|---|---|---|
| activation.md / R-ACT-01 (1) | KAR | Activation request timestamp (stale/zero vs unknown) selecting the allowWindowActivation fork. |
| close.md / R-CLOSE-01 (3) | HYP, QTI, AWE | Flat H[A,B,C] projection: HYP binary embedding + output geometry for collapse widths; QTI Columns embedding (num_columns=2, third stacks in-column); AWE master/stack projection + list order + work-area shares. |
| close.md / R-CLOSE-02 (5) | HYP, BSP, QTI, AWE, KAR | 50/30/20 start: HYP binary + output width + pointer half for reopened B; BSP binary holding shares; QTI Columns + manual width mapping; AWE master/stack/windowfact mapping. KAR: newcomer protocol selecting X11-manage vs Wayland-add activation. |
| column-mechanics.md / R-COL-01 (1) | KAR | Newcomer activation protocol/timestamp/token inputs and preferred frame/min/max for exact widths. |
| floating.md / R-FLT-01 (2) | COS, HYP | COS: B prior float geometry or output/work-area geometry for cascade/center fallback. HYP: binary embedding + B float size/output geometry + pointer for unfloat anchor. |
| floating.md / R-FLT-03 (3) | BSP, QTI, AWE | Flat 50/30/20 projection: BSP binary for ratio-vs-equalize; QTI Columns 960/576/384 mapping; AWE 1920px tile mapping under nmaster=1, mwfact=0.5 and equal stack shares. |
| floating.md / R-FLT-04 (1) | COS | Move-A parameters (pointer path/semantic target) + workspace/output geometry. |
| floating.md / R-FLT-06 (1) | COS | Workspace/output/tree geometry for settled post-admit frame. |
| floating.md / R-FLT-08 (1) | PAP | Remembered tiled selectedWindow at F-focus time (switchRight target). |
| floating.md / R-FLT-09 (1) | PAP | Remembered tiled selectedWindow at F-focus time. |
| floating.md / R-FLT-10 (1) | BSP | Output/work-area geometry for recomputed B tile frame after F/B swap. |
| floating.md / R-FLT-11 (1) | BSP | Focus/visit-history rank breaking equal-distance A/B north tie for second-leg swap. |
| floating.md / R-FLT-12 (1) | KAR | Raise/lower step producer selecting the native host path (no script verb). |
| floating.md / R-FLT-13 (1) | HYP | Pointer at WS1 return (focus under follow_mouse=1). |
| groups-stacks.md / R-GRP-01 (2) | I3, SWY | Which stack-toggle verb/gesture: tabbed, stacked, toggle split/all. |
| insertion.md / R-INS-01 (2) | HYP, KAR | HYP: pointer half of B determining C before/after B. KAR: newcomer activation protocol/timestamp/token inputs and preferred frame/min/max for exact widths. |
| insertion.md / R-INS-02 (3) | QTI, AWE, KAR | A/B membership projection of S[A*,B]: QTI Columns; AWE tile list (no tab-stack counterpart). KAR: newcomer activation protocol/timestamp/token inputs. |
| insertion.md / R-INS-03 (1) | KAR | Newcomer protocol, input/tabfocus eligibility and activation policy inputs. |
| insertion.md / R-INS-04 (1) | KAR | Activation inputs for successive newcomers selecting the remembered insertion-anchor chain. |
| insertion.md / R-INS-05 (2) | HYP, KAR | HYP: pointer position, pointer-hit vs active-tile anchor. KAR: newcomer activation inputs with F already active. |
| insertion.md / R-INS-06 (1) | KAR | Newcomer activation inputs selecting later-focus overlay clearing and viewport movement. |
| insertion.md / R-INS-07 (4) | COS, HYP, QTI, KAR | COS: WS2 B/C rectangles + output dimensions. HYP: same + mouse point for anchor and D/C order. QTI: WS2 column membership + setup order. KAR: newcomer activation inputs selecting focus/no-steal/desktop switch. |
| layout-commands.md / R-LAY-05 (1) | HYP | Node/parent rectangles for axis recalculation after each toggle. |
| layout-commands.md / R-LAY-06 (2) | HYP, KAR | HYP: pointer half for newcomer A/B order. KAR: newcomer activation inputs and preferred frame/min/max for exact widths. |
| maximize-fullscreen.md / R-MAX-01 (1) | HYP | Binary embedding of H[A,B*,C,D] + output geometry. |
| maximize-fullscreen.md / R-MAX-06 (1) | KAR | Newcomer protocol selecting X11-manage vs Wayland-add activation. |
| maximize-fullscreen.md / R-MAX-07 (6) | COS, HYP, QTI, AWE, I3, SWY | COS/HYP/QTI/AWE: monitor/work-area geometry. I3: captionless type + fullscreen atom/override-redirect. SWY: protocol path + xdg-fullscreen vs Xwayland type/override state. |
| minimum-size.md / R-MIN-01 (2) | HYP, KAR | HYP: pointer for Dwindle admission anchor. KAR: newcomer protocol selecting X11-manage vs Wayland-add activation. |
| minimum-size.md / R-MIN-03 (1) | KAR | Newcomer protocol selecting X11-manage vs Wayland-add activation. |
| mouse.md / R-DRAG-01 (5) | HYP, I3, SWY, QTI, PAP | HYP: release geometry. I3: center pixel/band + Shift swap state. SWY: center band (swap/tabify/30% split). QTI: hover pixel + drop-side geometry. PAP: pointer y selecting the within-column row. |
| mouse.md / R-DRAG-02 (6) | HYP, BSP, I3, SWY, QTI, AWE | N start state + between-child bar/drop pixel. BSP: initial monitor/position and same/cross-monitor branch. AWE: N initial frame. HYP/I3/SWY/QTI: bar-to-drop mapping. |
| mouse.md / R-DRAG-03 (5) | COS, HYP, QTI, I3, SWY | COS: workspace/output geometry. HYP/QTI: release geometry. I3: top-edge pixel + DT_PARENT/DT_SIBLING band. SWY: top-edge pixel + layout-border parent band. |
| mouse.md / R-DRAG-04 (9) | COS, HYP, BSP, XMO, SWY, QTI, AWE, NIR, PAP | Pointer hover/drop point at Esc. BSP/XMO: moved-then-Esc topology. SWY: Esc/release position for NULL-abort vs finalize. AWE/NIR: Esc and release points. PAP: hover/drop selecting end() branch; secondary host Esc interception. |
| mouse.md / R-DRAG-05 (2) | HYP, KAR | HYP: press/drop point for no-motion rebuilt topology. KAR: title-bar press-hold duration relative to startDragTime. |
| mouse.md / R-DRAG-06 (8) | COS, HYP, BSP, I3, SWY, QTI, AWE, PAP | Panel/taskbar and pointer containment: COS work area + cursor-output contents; HYP panel/monitor; BSP/I3/SWY on-output vs off-all-outputs; QTI producer branch + panel; AWE panel/taskbar geometry. PAP: pointer path, including whether a last DnD zone was acquired. |
| mouse.md / R-DRAG-07 (4) | HYP, I3, SWY, QTI | HYP: drop point. I3/SWY: edge of A + pixel/branch. QTI: drop + pause-point pixels. |
| mouse.md / R-DRAG-08 (4) | HYP, I3, SWY, QTI | HYP: drop edge. I3: release pixel + DT branch. SWY: release pixel + drop branch. QTI: edge/side for drop-side focus. |
| mouse.md / R-MOU-03 (1) | QTI | Hovered window/edge target + cross-output drop geometry. |
| move.md / R-MOV-01 (4) | HYP x2, QTI, AWE | HYP main: binary H[A,C,B*] + output geometry for focal anchor/ratios; swap: embedding for target existence. QTI/AWE: Columns/tile projection of COL[C1[A],C2[C],C3[B*]]. |
| move.md / R-MOV-03 (4) | HYP x2, QTI, AWE | HYP main: binary H[A,B*,C,D] + geometry; swap: embedding for target existence. QTI/AWE: four single-window-column projection. |
| move.md / R-MOV-04 (2) | HYP, QTI | HYP: geometry for focal y-half at square tie. QTI: Columns counterpart of H[H[A,B*],C]. |
| move.md / R-MOV-09 (9) | COS, HYP, BSP, QTI, AWE, NIR, PAP, KAR, PAN | COS: output width. HYP/BSP: binary embedding + width/shares. QTI/AWE: Columns/tile share mapping. NIR/KAR: column fixture with 1/10-4/10 widths. PAP/PAN: strip order + widths; PAN WidthRatio mapping. |
| move.md / R-MOV-10 (6) | COS, HYP, BSP, I3, SWY, QTI | COS: shares + V remembered child. HYP: binary H[A,B,V,E] + shares/geometry. BSP: V shares/child + boundary geometry/history. I3/SWY: V remembered child C/D. QTI: Columns counterpart. |
| move.md / R-MOV-11 (5) | COS, HYP, BSP, XMO, AWE | COS: source workspace index + destination contents. HYP: U contents. BSP/XMO/AWE: U contents/focus for empty vs swap; XMO target geometry. |
| move.md / R-MOV-12 (5) | COS, BSP, I3, XMO, AWE | COS: source index + output order + destination contents. BSP: U1/U2 contents. I3: output order for y=0 tie. XMO: U1/U2 contents + geometry. AWE: contents + enumeration order. |
| move.md / R-MOV-13 (3) | COS, HYP, XMO | COS: source index + destination contents. HYP: target contents. XMO: per-leg contents + target geometry. |
| multi-output.md / R-OUT-01 (3) | HYP, BSP, XMO | HYP: L work area/X geometry + alignment + drop half. BSP: L/X geometry. XMO: L/R Tall window and output geometry. |
| multi-output.md / R-OUT-02 (4) | HYP, BSP, XMO, AWE | HYP: arrangement/adjacency + alignment. BSP: L/X geometry + alignment. XMO: output geometry for cross/local selection. AWE: tile projection of V[A,B]. |
| multi-output.md / R-OUT-07 (2) | COS, HYP | COS: work area + decoration sizes. HYP: cursor + L work area. |
| resize.md / R-RSZ-01 (1) | KAR | Recorded but unstated viewport width selecting contextual grow/shrink step. |
| restart-persistence.md / R-RST-01 (2) | PAP, KAR | PAP: F float mechanism, above-flag, minimized-scratch or list-only; secondary host tab-list selection. KAR: creation/manage order selecting fresh column adoption. |
| restart-persistence.md / R-RST-03 (2) | PAP, KAR | PAP: F float mechanism, above-flag, minimized-scratch or list-only. KAR: creation/manage order, moved F frame width and pre-adoption focus state. |
| restart-persistence.md / R-START-01 (2) | AWE, KAR | AWE: global-client manage/swap list order for 2x2 field (fixture gives focus order only). KAR: creation/manage order (focus order does not reorder Workspace.windows). |
| restart-persistence.md / R-START-02 (2) | AWE, KAR | AWE: global-client manage/swap list order for A-D cascade. KAR: creation/manage order selecting fresh columns, not cascade position. |
| restart-persistence.md / R-START-03 (2) | AWE, KAR | AWE: global-client manage/swap list order for A-E infeasible-minima cascade. KAR: creation/manage order and minimum-dependent origins. |
| special-windows.md / R-SPC-01 (1) | KAR | Native newcomer activation timestamp/token inputs for the eligible dialog. |
| special-windows.md / R-SPC-02 (3) | I3, SWY, KAR | I3/SWY: external task-switcher identity for listing/presence. KAR: utility X11 activation inputs selecting denied-activation attention. |
| special-windows.md / R-SPC-03 (12) | COS, HYP, BSP, I3, XMO, SWY, QTI, AWE, NIR, PAP, KAR, PAN | Media/PiP app, toolkit/version, actual flags/rules. PAN: title/subrole and trigger flags for windows.pip matching. PAP: Normal/non-transient antecedent; secondary host/app above-flag behavior. |
| special-windows.md / R-SPC-13 (2) | PAP, KAR | PAP: A's live frame for exact widths; secondary host tab-list selection. KAR: creation/manage order, frames/min/max and pre-startup focus state. |
| workspaces.md / R-WS-01 (2) | HYP, BSP | HYP: C long-edge geometry + cursor half. BSP: C/output geometry. |
| workspaces.md / R-WS-02 (2) | HYP, PAN | HYP: return cursor for anchor/order. PAN: MoveFocus Follow/Stay policy. |
| workspaces.md / R-WS-04 (3) | HYP, QTI, AWE | HYP: D geometry + cursor half. QTI/AWE: D geometry + WS2 focus after floated-C removal. |
| workspaces.md / R-WS-05 (1) | HYP | Window/output geometry for forward/return frames. |
| workspaces.md / R-WS-06 (2) | COS, HYP | COS: WS1 rectangles/output for float frame/clamp. HYP: WS2 contents + A geometry + cursor half. |
| workspaces.md / R-WS-09 (1) | HYP | Return pointer position for focus. |
| workspaces.md / R-WS-12 (1) | PAP | Live stack/tab order selecting displaced views/focus; secondary host neighbor/index policy. |
| workspaces.md / R-WS-15 (3) | HYP, BSP, PAP | HYP: arrival pointer. BSP: visit/focus history. PAP: MRU visit sequence. |
| workspaces.md / R-WS-17 (1) | BSP | Visit history for last-walk targets in removal variant. |
| workspaces.md / R-WS-18 (2) | COS, HYP | COS: geometry. HYP: geometry + E numeric ID/position. |
| workspaces.md / R-WS-19 (1) | COS | Post-transfer window/output geometry. |
| workspaces.md / R-WS-21 (2) | SWY, QTI | SWY: L remaining workspace order/history. QTI: WS3 remembered current_window. |
| workspaces.md / R-WS-22 (3) | SWY, QTI, PAP | SWY: WS1 contents/focus-memory node. QTI: WS3 current_window and frames. PAP: live stack/tab order selecting shown views/moved-active focus; secondary host neighbor/index policy. |
| workspaces.md / R-WS-23 (4) | BSP, SWY, QTI, NIR | BSP: WS1/spare E visit history. SWY: WS1 contents/focus-memory. QTI: WS3 current_window. NIR: E spare index/order. |
| workspaces.md / R-WS-26 (6) | BSP, I3, SWY, QTI, NIR, PAP | BSP: history older than WS2. I3: refill identity + W_prev. SWY: W_prev. QTI/NIR: W_prev + return scope. PAP: MRU visit order. |
| workspaces.md / R-WS-27 (3) | COS, BSP, NIR | COS: output order. BSP: monitor order + follow/stay. NIR: output order for 1080 center-y tie + focused windows/views. |

## Unsupported-pending and live-only ledger

This ledger, the H/F lists and the area counts provide the durable
classification audit. N cells are the remaining TBDs after these exclusions.
Ranges denote contiguous IDs; slash-separated numbers denote only those IDs.
All IDs have prefix `R-`; none of these U/L entries are duplicated swap cells.

| WM | U rows | L rows |
|---|---|---|
| COSMIC | CTL-01..03/05..07; RST-01; SPC-13 | GRP-01; MAX-02..04/06; DRAG-01/05/07..08; RST-03..04; SPC-08/11; WS-07 |
| Hyprland | FLT-04..05; MAX-03; CTL-01..07; RST-03; START-01..03; SPC-12..13; WS-03 | FLT-11; GRP-01; MAX-04; RST-04; SPC-08..11 |
| bspwm | FLT-04/06; GRP-01; MAX-01/03; DRAG-03; CTL-01..07; START-01..03; SPC-10/12; WS-03/06 | MAX-04; DRAG-08; RST-03..04; SPC-08..09/11; WS-25 |
| i3 | FLT-04; INS-06; MAX-01/03..04; CTL-01..07; RST-02; START-01..03; SPC-10/12..13; WS-03/06/27 | FLT-01..03/06/11; MAX-05; MIN-01..03; DRAG-05; OUT-07; RST-03..04; SPC-08..09/11; WS-18..19 |
| xmonad | FLT-02/04/06; GRP-01; INS-02; MAX-01/03; DRAG-03; CTL-01..07; START-01..03; SPC-02/12; WS-03/06/27 | RST-03..04; SPC-08..09 |
| sway | FLT-04..05; INS-06; MAX-01/03..04; CTL-01..07; RST-02..03; START-01..03; SPC-10/12..13; WS-03/06/12 | FLT-01..03/06/11; MAX-05; MIN-01..03; DRAG-05; OUT-07; RST-04; SPC-08..09/11; WS-18..19 |
| qtile | FLT-02/04/10..11; GRP-01; MAX-03; CTL-01..07; START-01..03; SPC-12; WS-03/06/24/27 | MAX-04; RST-03..04; SPC-08..11; WS-25 |
| awesome | GRP-01; MOV-04/10; CTL-01..07; WS-03/27 | FLT-02/05..06; MAX-04; RST-03..04; SPC-10..11 |
| niri | CTL-01..07; START-01..03; SPC-12..13 | FLT-06; RST-03..04; SPC-08..09 |
| PaperWM | None (all 8 closed) | MAX-01; MIN-01..03; SPC-05/08..11 |
| karousel | None (all 8 closed) | FLT-06; MAX-01; RST-04; SPC-05/08..11 |
| paneru | FLT-12; INS-08; CTL-01..02/04..07; RST-04; SPC-04/10/12; WS-27 | RST-03 |

## Ranked per-WM passes and expected yield

Rank by unfinished source-candidate count N, then N+U for ties. These are
triage candidate pools, not measured completion forecasts. N+U is the
upper candidate yield for a pass also closing unsupported statements;
39 remaining N cells have recorded secondary fixture/host/live limitations.
There are 339 N cells without those recorded secondary barriers. Further tracing
can discover additional limits, so neither number guarantees closure.

| Rank | WM | Source candidates N | Cheap U | N+U ceiling | N with F/H/L secondary |
|---|---|---:|---:|---:|---:|
| 1 | paneru | 57 | 13 | 70 | 1 |
| 2 | awesome | 50 | 12 | 62 | 1 |
| 3 | Hyprland | 44 | 17 | 61 | 7 |
| 4 | bspwm | 42 | 20 | 62 | 3 |
| 5 | xmonad | 41 | 23 | 64 | 6 |
| 6 | niri | 41 | 12 | 53 | 4 |
| 7 | COSMIC | 41 | 8 | 49 | 12 |
| 8 | qtile | 37 | 21 | 58 | 0 |
| 9 | i3 | 13 | 22 | 35 | 3 |
| 10 | sway | 12 | 24 | 36 | 2 |
| Complete | PaperWM | 0 | 0 | 0 | 0 |
| Complete | karousel | 0 | 0 | 0 | 0 |

Context-sized area splits are given in the N table. The completed PaperWM
pass used navigation/admission, window states, workspaces/output, mouse/groups,
and persistence/special-window slices; U cells were evaluated with their area.

## PaperWM source-pass outcome

- All **70 N + 8 U attempted**, with independent source verification of
  every slice after corrections. **34 N + 8 U closed (42 cells)**;
  **36 N reclassified: 21 H, 8 F, 7 L**. No N/U candidates remain.
- New H cells are listed in the host ledger. New F: R-DRAG-01/04/06,
  R-RST-01, R-SPC-03/13, R-WS-12/22. New L: R-MAX-01,
  R-MIN-01/02/03, R-SPC-05/10/11. Secondary limits remain explicit in cells.
- Existing 17 H, 6 F and 2 L cells were left unchanged. Current PaperWM
  residual is **61: H38/F14/L9**. Other profiles, scenario wording and
  approved rules were preserved; no material approved-rule contradictions.
- Evidence is pinned extension policy, not live runtime acceptance. No live
  testing, source-checkout changes or stash changes were performed.

## karousel source-pass outcome

- All **58 N + 8 U attempted**, with independent source verification of
  every slice after corrections. **29 N + 8 U closed (37 cells)**;
  **29 N reclassified: 1 H, 24 F, 4 L**. No N/U candidates remain.
- New H: R-RST-02 (unpinned Plasma session manager ksmserver and app
  participation). New F: R-COL-01; R-FLT-12; R-INS-01..07; R-LAY-06;
  R-CLOSE-02; R-MAX-06; R-MIN-01/03; R-RSZ-01; R-DRAG-05;
  R-START-01..03; R-RST-01/03; R-SPC-01/02/13. New L: R-MAX-01;
  R-SPC-05/10/11. Secondary limits remain explicit in cells.
- Existing 3 F and 4 L cells were unchanged. Current karousel residual is
  **36: H1/F27/L8**. Other profiles, scenarios and approved rules were
  preserved; no material approved-rule contradictions.
- Pinned KWin native paths were traced using raw `KDE/kwin@8438567a`
  citations, including script focus, native switching, fixed desktops,
  sticky, close/minimize, move/resize, new-window activation and window order.
  No live testing, source-checkout changes or stash changes were performed.

## Verification and next action

- Initial triage independent occurrence-aware recount: 1,896 reference cells, 1,006 TBD;
  no KWin column; Ours TBD 169. Classification multiset exactly matches
  all TBD occurrences, including five duplicated row/profile keys.
- Initial triage aggregates reconciled: WM/area N totals 506; H 37; F 178 across 63 rows;
  L 97; U 188. The fixture table's cell counts sum to 178.
- Initial triage independent Worker sampled 48 cells, at least three per WM, spanning all
  classes (N17/H9/F15/L4/U3). Forty-seven rationales confirmed; paneru
  MOV-03 was corrected to refer to the actual TBD explicit-swap leg rather
  than the resolved main leg. Its N class is unchanged. Three secondary
  notes were corrected: Hyprland LAY-06 client timing, sway MOU-03's
  input-less fixture qualification, awesome SPC-03's unpinned app source.
- Initial triage temporary evidence: `/tmp/opencode/reference-triage-inventory.json`,
  twelve `reference-triage-<WM>.json` files, `reference-triage-aggregate.json`
  and `reference-triage-spot-check.json`. These are session artifacts, not
  repository dependencies; the durable classification ledgers are above.
- Current aggregates: 1,896 reference cells, 927 TBD; N378/H59/F210/L108/U172.
  Area N totals sum to 378; fixture ledger sums to 210 across 75 rows.
  The PaperWM and karousel outcomes and independent verification are recorded
  above and in their archived notes; final occurrence-aware and diff-scope
  checks accompany each pass.
- Exact next action for PaperWM: none. Host-source pinning, fixture inputs
  and live-only observations remain user-owned; another WM pass is separate.
- Exact next action for karousel: none. Its remaining session-manager source,
  fixture inputs and live-only observations remain user-owned.
