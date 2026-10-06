# Cross-Platform Functional Specification

Status: Provisional, to discuss. First concise cut; single file by design.

Scope: NORMATIVE only for user-selected recorded decisions in
[decisions.md](../decisions.md) (row-level Source anchor). PROVISIONAL only
for recorded provisional clauses. Everything else is OPEN: `current:`
describes observed behavior without asserting it as required, plus the TBD
decision. Reference outcomes in [reference-outcomes.md](reference-outcomes.md)
and [reference-outcomes/](reference-outcomes/) are evidence only. Consensus
analysis in [reference-wm-consensus.md](../research/reference-wm-consensus.md)
selects nothing. Table A predicates each get an explicit OPEN row
(`Table A R-xxx`), even where current selected behavior stays normative.

Counting: each `REQ-*` row counts once under Status. `gap` marks a selected
requirement currently unmet (cited); OPEN possibility is never a gap. macOS:
portable NORMATIVE rows use `same target; implementation gap (adapter absent)`;
OPEN rows use `behavior OPEN; implementation absent`; KDE/Windows-only rows use
`applicability OPEN`; shortcuts use `mapping OPEN`. Never imply platform parity
(no macOS implementation exists). The known macOS adapter absence counts once
platform-wide, not per row. Intentional differences cite
a recorded choice; uncited divergence is `observed divergence`, not intentional.
Table A predicate rows carry literal status `OPEN (Table A R-xxx)`.

Draft totals: 49 NORMATIVE, 84 OPEN, 11 PROVISIONAL requirement rows;
12 selected requirement rows have KDE/Windows implementation gaps, plus one
platform-wide macOS adapter gap. Coverage: 125 scenarios, 24 Table A predicates.

<a id="insertion"></a>
## 1. Insertion ([R-INS](reference-outcomes/insertion.md#insertion-reference-outcomes))

Hooks (real matrix names; PROVISIONAL indexing, not chosen configuration): V-INS-AXIS.

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-INS-01 | [R-INS-01](reference-outcomes/insertion.md#r-ins-01-ordinary-third-window-admission) ordinary third-window admission | Long-edge split at focused leaf (tall splits vertically, wide horizontally), incl. send arrivals | current: long-edge | current: long-edge | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cross-platform-behavior) user statement 2026-10-03 |
| REQ-INS-01b | [R-INS-01](reference-outcomes/insertion.md#r-ins-01-ordinary-third-window-admission) newcomer position | current: order after/before focus TBD both | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U R-INS-01 position |
| REQ-INS-02 | [R-INS-02](reference-outcomes/insertion.md#r-ins-02-stack-admission) stack admission | No tab/stack carrier; ordinary admission only | current: ordinary admission | current: ordinary admission | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cosmic-movement-and-groups) tabs/stacks unselected |
| REQ-INS-03 | [R-INS-03](reference-outcomes/insertion.md#r-ins-03-first-admission-on-an-empty-workspace) first admission on empty workspace | current: single leaf full work area, newcomer desired focus; native activation TBD | current: TBD activation | current: TBD activation | behavior OPEN; implementation absent | OPEN | Table B pending explicit; native TBD |
| REQ-INS-04 | [R-INS-04](reference-outcomes/insertion.md#r-ins-04-chained-admission-with-a-fixed-pointer) chained admission | current: legs 2-3 topology/focus/geometry TBD | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | no selection |
| REQ-INS-05 | [R-INS-05](reference-outcomes/insertion.md#r-ins-05-admission-while-an-ordinary-float-has-focus) admission with float focused | current: float holds no tile leaf; fallback TBD | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | no selection |
| REQ-INS-06 | [R-INS-06](reference-outcomes/insertion.md#r-ins-06-open-over-an-overlay-maximized-plus-fresh-fullscreen-variant) open over overlay | current: admission over maximized/fullscreen TBD | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | no selection |
| REQ-INS-07 | [R-INS-07](reference-outcomes/insertion.md#r-ins-07-open-with-a-destination-rule-into-an-inactive-workspaceoutput) open into inactive workspace | No switch, no visibility/focus steal on tiling startup/open/move into inactive workspace | current: no-switch/no-steal | current: no-switch/no-steal | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) approved 2026-09-16 lines 1190-1194 |
| REQ-INS-07b | [R-INS-07](reference-outcomes/insertion.md#r-ins-07-open-with-a-destination-rule-into-an-inactive-workspaceoutput) exact routing | Pending: exact inactive-workspace routing/admission detail | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U R-INS-07 routing |
| REQ-INS-08 | [R-INS-08](reference-outcomes/insertion.md#r-ins-08-admission-under-an-explicit-preselected-split-direction) preselected direction | No preselection verb or concept selected | n/a | n/a | applicability OPEN | OPEN | Table C; no selection |

<a id="focus"></a>
## 2. Focus ([R-FOC](reference-outcomes/focus.md#focus-reference-outcomes))

Hooks: none recorded; focus wrap remains OPEN.

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-FOC-01 | [R-FOC-01](reference-outcomes/focus.md#r-foc-01-directional-tie-with-two-equally-placed-candidates) directional tie | current: deterministic first-child descent selects A both runs; MRU alternative unresolved | current: stable-A | current: stable-A | behavior OPEN; implementation absent | OPEN | Table W tie-MRU; no recorded choice |
| REQ-FOC-02 | [R-FOC-02](reference-outcomes/focus.md#r-foc-02-directional-focus-at-a-single-output-edge) single-output edge | current: Edge retain, no focus write; no user decision found, not inferred | current: Edge retain | current: Edge retain | behavior OPEN; implementation absent | OPEN | Table B pending explicit; no selection |
| REQ-FOC-03 | [R-FOC-03](reference-outcomes/focus.md#r-foc-03-nextprevious-window-cycle-order) next/previous cycle | No cycle verb | n/a | n/a | applicability OPEN | OPEN | Table W order; no selection |
| REQ-FOC-04 | [R-FOC-04](reference-outcomes/focus.md#r-foc-04-parentchild-focus-scope) parent/child scope | Leaf-only focus; no container-focus verb | n/a | n/a | applicability OPEN | OPEN | Table W scope; no selection |

<a id="move"></a>
## 3. Move ([R-MOV](reference-outcomes/move.md#move-reference-outcomes))

Hooks: V-MOVE-NARY, V-MOVE-PERP, V-R4-DIR. PROVISIONAL indexing, not chosen configuration.

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-MOV-01 | [R-MOV-01](reference-outcomes/move.md#r-mov-01-perpendicular-move-of-a-flat-triple) perpendicular move of flat triple | current: behavior TBD against implementations | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | no selection |
| REQ-MOV-02 | [R-MOV-02](reference-outcomes/move.md#r-mov-02-in-group-vertical-swap) in-group vertical swap | current: in-place swap, focus follows mover | current: swap | current: swap | behavior OPEN; implementation absent | OPEN | Table B pending explicit |
| REQ-MOV-03 | [R-MOV-03](reference-outcomes/move.md#r-mov-03-same-row-carry-to-the-right) same-row carry right | current: Engine wrap; flat-swap consensus unresolved | current: wrap | current: wrap | behavior OPEN; implementation absent | OPEN (Table A R-MOV-03) | Table A R-MOV-03 |
| REQ-MOV-04 | [R-MOV-04](reference-outcomes/move.md#r-mov-04-same-axis-ancestor-escape) same-axis ancestor escape | current: escape/retain TBD | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | no selection |
| REQ-MOV-05 | [R-MOV-05](reference-outcomes/move.md#r-mov-05-edge-move-with-no-left-neighbor) edge move, no left neighbor | current: edge no-op | current: no-op | current: no-op | behavior OPEN; implementation absent | OPEN | Table B pending explicit |
| REQ-MOV-06 | [R-MOV-06](reference-outcomes/move.md#r-mov-06-move-into-a-nested-perpendicular-neighbor-with-remembered-child) move into nested neighbor | current: midpoint insert, exact index TBD | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | no selection |
| REQ-MOV-07 | [R-MOV-07](reference-outcomes/move.md#r-mov-07-orthogonal-escape-across-a-perpendicular-parent) orthogonal escape | current: wrap outcome, no strong consensus | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | no selection |
| REQ-MOV-08 | [R-MOV-08](reference-outcomes/move.md#r-mov-08-exhausted-vertical-move-across-stacked-outputs) exhausted vertical move | Up/Down excluded from cross-output; stays local | current: stays local | current: stays local | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cosmic-movement-and-groups) USER step-3 2026-09-25; R4 horizontal-only |
| REQ-MOV-08b | [R-MOV-08](reference-outcomes/move.md#r-mov-08-exhausted-vertical-move-across-stacked-outputs) cross-after-exhaustion | Pending: cross to output above after local exhaustion | current: stays local | current: stays local | behavior OPEN; implementation absent | OPEN (Table A R-MOV-08) | Table A R-MOV-08 |

<a id="resize"></a>
## 4. Resize ([R-RSZ](reference-outcomes/resize.md#resize-reference-outcomes))

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-RSZ-01 | [R-RSZ-01](reference-outcomes/resize.md#r-rsz-01-keyboard-growshrink-of-a-tiled-pair) keyboard grow/shrink | Explicit pixel-step grow/shrink path exists | current: pixel path | gap: no keyboard trigger ([settings.rs](../../crates/tiler-windows/src/settings.rs):769-777 `implemented:false`; [backlog](../backlog.md) P1 parity) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cosmic-movement-and-groups) `cosmic_v1` physical-pixel resize, auth 2026-09-09 |
| REQ-RSZ-01b | [R-RSZ-01](reference-outcomes/resize.md#r-rsz-01-keyboard-growshrink-of-a-tiled-pair) Windows trigger | Pending Table A review of Windows keyboard-resize trigger; existing selected resize target remains REQ-RSZ-01 | n/a | current: no trigger | behavior OPEN; implementation absent | OPEN (Table A R-RSZ-01) | Table A R-RSZ-01 |
| REQ-RSZ-02 | [R-RSZ-02](reference-outcomes/resize.md#r-rsz-02-outward-resize-at-the-work-area-edge) outward edge | current: outward no-op TBD | current: TBD | current: no trigger | behavior OPEN; implementation absent | OPEN | Table W no-op; no selection |
| REQ-RSZ-03 | [R-RSZ-03](reference-outcomes/resize.md#r-rsz-03-nested-resize-scope-nearest-split-vs-ancestor) nested scope | current: nearest-split scope TBD | current: TBD | current: no trigger | behavior OPEN; implementation absent | OPEN | Table W nearest; no selection |
| REQ-RSZ-04 | [R-RSZ-04](reference-outcomes/resize.md#r-rsz-04-equalizebalance-once) equalize/balance | No equalize verb in any Engine/adapter layer | n/a | n/a | applicability OPEN | OPEN | Table C; no selection |

<a id="layout"></a>
## 5. Layout commands ([R-LAY](reference-outcomes/layout-commands.md#layout-commands-reference-outcomes))

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-LAY-01 | [R-LAY-01](reference-outcomes/layout-commands.md#r-lay-01-toggle-parent-split-orientation) toggle parent orientation | No orientation verb (pending: add parent-axis toggle) | n/a | n/a | applicability OPEN | OPEN (Table A R-LAY-01) | Table A R-LAY-01 |
| REQ-LAY-02 | [R-LAY-02](reference-outcomes/layout-commands.md#r-lay-02-rotate-90-degrees-mirror-leftright-separate-fresh-legs) rotate/mirror | No rotate/mirror verb | n/a | n/a | applicability OPEN | OPEN | no selection |
| REQ-LAY-03 | [R-LAY-03](reference-outcomes/layout-commands.md#r-lay-03-promote-b-to-master) promote B to master | No master verb or state | n/a | n/a | applicability OPEN | OPEN | no selection |
| REQ-LAY-04 | [R-LAY-04](reference-outcomes/layout-commands.md#r-lay-04-select-a-native-alternative-layout-on-ws2-return-to-ws1) select native layout | No layout-select verb (pending: workspace-local selection) | n/a | n/a | applicability OPEN | OPEN (Table A R-LAY-04) | Table A R-LAY-04 |

<a id="workspaces"></a>
## 6. Workspaces ([R-WS](reference-outcomes/workspaces.md#workspace-send--follow--return-reference-outcomes))

Hooks: V-WS-FOLLOW, V-WS-ANCHOR, V-WS-TILING, V-WS-SHELL-ACTIVATE. PROVISIONAL indexing, not chosen configuration.

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-WS-01 | [R-WS-01](reference-outcomes/workspaces.md#r-ws-01-send-to-another-workspace) send to another workspace | Send moves focused tiled window, source collapses, follow on verified transfer | current: follow | current: follow | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cosmic-movement-and-groups) approved 2026-09-20 + USER step-3 2026-09-25 |
| REQ-WS-01b | [R-WS-01](reference-outcomes/workspaces.md#r-ws-01-send-to-another-workspace) Send-stays variant | Pending: declared-profile Send-stays (N5 consensus) vs selected follow | current: follow | current: follow | behavior OPEN; implementation absent | OPEN (Table A R-WS-01) | Table A R-WS-01 |
| REQ-WS-02 | [R-WS-02](reference-outcomes/workspaces.md#r-ws-02-send-back-and-return-anchor) send back, return anchor | Return lands at remembered A via validated last-active leaf | current: remembered A | current: remembered A | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cosmic-movement-and-groups) approved 2026-09-20 |
| REQ-WS-02b | [R-WS-02](reference-outcomes/workspaces.md#r-ws-02-send-back-and-return-anchor) after-order | Pending: exact after-order of B | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U R-WS-02 after |
| REQ-WS-03 | [R-WS-03](reference-outcomes/workspaces.md#r-ws-03-trailing-empty-shortcut) trailing-empty shortcut | Reuse trailing empty before creating (`Meta+0`/`Meta+Shift+0`) | current: reuse | current: reuse ([decisions](../decisions.md#windows-port) 2026-10-02) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) USER step-3 2026-09-25 |
| REQ-WS-04 | [R-WS-04](reference-outcomes/workspaces.md#r-ws-04-memory-invalidation) memory invalidation | Resolve valid remembered leaf, then valid focus history, then genuine no-focus root fallback; scenario result TBD | current: TBD | current: TBD | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cross-platform-behavior) fallback chain selected |
| REQ-WS-05 | [R-WS-05](reference-outcomes/workspaces.md#r-ws-05-floating-transfer) floating transfer | current: floated roundtrip untested | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U R-WS-05 |
| REQ-WS-06 | [R-WS-06](reference-outcomes/workspaces.md#r-ws-06-send-to-a-floating-workspace) send to a floating workspace | Membership-only boundary send, only tiled side reflows; sticky movers refuse; intentional floats ineligible | current: boundary send | current: boundary send (synthetic Paint proof) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#windows-workspace-tiling-mode) 2026-10-04 |
| REQ-WS-07 | [R-WS-07](reference-outcomes/workspaces.md#r-ws-07-shell-switcher-listing) shell switcher listing | Windows SW_HIDE omission observed; listing/activation policy undecided | current: shell-driven (KDE TabBox policy) | current: SW_HIDE omission observed | behavior OPEN; implementation absent | OPEN | Table U R-WS-07; no design selected (research: [alt-tab note](../research/windows-port/alt-tab-hidden-workspaces.md)) |
| REQ-WS-08 | [R-WS-08](reference-outcomes/workspaces.md#r-ws-08-back-and-forth-workspace-twice) previous-view toggle | No history verb (pending: add toggle) | n/a | n/a | applicability OPEN | OPEN (Table A R-WS-08) | Table A R-WS-08 |
| REQ-WS-09 | [R-WS-09](reference-outcomes/workspaces.md#r-ws-09-select-ws2-select-ws1-return-focus-and-viewport) select WS2 / select WS1 | current: select WS2 then select WS1 with no sends; return-focus detail TBD (current KDE shell-driven TBD; current Windows remembered last_focus) | current: shell-driven TBD | current: remembered last_focus | behavior OPEN; implementation absent | OPEN | Table U R-WS-09; source matrix only (verified-follow stays normative under REQ-WS-01/02) |
| REQ-WS-10 | [R-WS-10](reference-outcomes/workspaces.md#r-ws-10-send-b-away-empty-middle-retained-vs-removed) empty middle retained/removed | current: KDE owner-specific (Plasma owns add/remove); Windows retained (no removal path) | current: owner-specific | current: retained | behavior OPEN; implementation absent | OPEN | Table C; no selection |
| REQ-WS-11 | [R-WS-11](reference-outcomes/workspaces.md#r-ws-11-next-workspace-previous-workspace) next/previous workspace | No relative-switch verb (pending: add, edge-wrap leg) | n/a | n/a | applicability OPEN | OPEN (Table A R-WS-11) | Table A R-WS-11 |
| REQ-WS-12 | [R-WS-12](reference-outcomes/workspaces.md#r-ws-12-move-whole-ws2-to-r) move whole WS2 | No whole-workspace reassignment verb (pending: add) | n/a | n/a | applicability OPEN | OPEN (Table A R-WS-12) | Table A R-WS-12 |
| REQ-WS-13 | [R-WS-13](reference-outcomes/workspaces.md#r-ws-13-select-absent-ws9) select absent WS9 | Select existing only, no creation; KDE shell-driven, Windows refuses unknown target | current: shell-driven | current: refuses | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#windows-port) existing-only 2026-10-02 |
| REQ-WS-14 | [R-WS-14](reference-outcomes/workspaces.md#r-ws-14-send-b-to-next-fresh-run-send-b-to-previous) relative send | No relative-send verb (pending: add) | n/a | n/a | applicability OPEN | OPEN (Table A R-WS-14) | Table A R-WS-14 |

Note: Windows global-unique/shared mappings await runtime implementation
([decisions](../decisions.md#windows-port) provision 2026-10-04;
[backlog](../backlog.md) P1 parity); no match claimed for those modes.

<a id="floating"></a>
## 7. Floating ([R-FLT](reference-outcomes/floating.md#float--sticky-reference-outcomes))

Hooks: V-FLOAT-FOCUS, V-FLOAT-SNAP, V-FLOAT-GEO, V-FLOAT-REFLOW, V-STICKY-SCOPE. PROVISIONAL indexing, not chosen configuration.

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-FLT-01 | [R-FLT-01](reference-outcomes/floating.md#r-flt-01-toggle-float-then-unfloat) toggle float then unfloat | Unfloat is fresh admission (new-window rule, no old slot); first float centered 60% only as fallback, previously floated retains placement, exact live-frame carried on unfloat | current: fresh admission | current: fresh admission (parity 2026-10-03) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) option A 2026-09-28 + retained placement [decisions](../decisions.md#window-and-workspace-behavior) lines 1197-1204; [decisions](../decisions.md#windows-port) parity 5 |
| REQ-FLT-02 | [R-FLT-02](reference-outcomes/floating.md#r-flt-02-sticky-across-a-workspace-switch) sticky across switch | Intentional float session-local outside tree; sticky via all-desktops; exact-toggle focus retention | current: sticky float | current: sticky float (parity 2026-10-03) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) 2026-09-21 adoption, option A 2026-09-25, focus retention |
| REQ-FLT-03 | [R-FLT-03](reference-outcomes/floating.md#r-flt-03-float-out-survivor-widths) float-out survivor widths | current: removal reflow TBD | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table W; no selection |
| REQ-FLT-04 | [R-FLT-04](reference-outcomes/floating.md#r-flt-04-workspace-floating-toggle) workspace floating toggle | Per-workspace tiled/floating flag; floating stops domain tiling; retile releases domain without writes then fresh-adopts | current: toggle | current: toggle (2026-10-04) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#windows-workspace-tiling-mode) KDE parity 2026-10-04 |
| REQ-FLT-05 | [R-FLT-05](reference-outcomes/floating.md#r-flt-05-restart-with-a-sticky-float) restart with sticky float | Pending: restart retains sticky visibility (thin 3/3ev); native journey TBD | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN (Table A R-FLT-05) | Table A R-FLT-05 |
| REQ-FLT-06 | [R-FLT-06](reference-outcomes/floating.md#r-flt-06-float-toggle-over-a-maximized-window) float toggle over maximized | Provisionally unfloats beneath maximize and stays maximized; KDE dispatches (settled result unverified); Windows keeps refusal | current: dispatched, unverified | current: refuses `float-refused-maximize` | behavior OPEN; implementation absent | PROVISIONAL | [decisions](../decisions.md#cross-platform-behavior) B9 2026-10-05 |
| REQ-FLT-06b | [R-FLT-06](reference-outcomes/floating.md#r-flt-06-float-toggle-over-a-maximized-window) no-refusal direction | Pending: Windows drops refusal after user COSMIC live check (retain vs unmaximize) | n/a | current: refuses | behavior OPEN; implementation absent | OPEN (Table A R-FLT-06) | Table A R-FLT-06 refusal |
| REQ-FLT-07 | [R-FLT-07](reference-outcomes/floating.md#r-flt-07-tile-origin-focus-over-floats) tile-origin focus over floats | Tile-origin focus lands on tile A; floats never targets | current: tile A | current: tile A | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) float-nav 2026-10-05 |
| REQ-FLT-08 | [R-FLT-08](reference-outcomes/floating.md#r-flt-08-float-origin-focus-miss) float-origin miss | Float-origin miss retains F (KDE delivered offline, live TBD); cross-platform consistency selected, Windows pending | current: retains | gap: subject refusal ([backlog](../backlog.md) P1 parity (a) lines 197-209; [decisions](../decisions.md#window-and-workspace-behavior) 2026-10-05 lines 1242-1245) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) float-nav 2026-10-05 |
| REQ-FLT-09 | [R-FLT-09](reference-outcomes/floating.md#r-flt-09-float-origin-focus-toward-a-farther-float) focus toward farther float | Float-origin focus selects far float G by top-left axis, sticky first (KDE offline, live TBD); cross-platform consistency selected, Windows pending | current: selects G | gap: subject refusal ([backlog](../backlog.md) P1 parity (a) lines 197-209) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) float-nav 2026-10-05 |
| REQ-FLT-09b | [R-FLT-09](reference-outcomes/floating.md#r-flt-09-float-origin-focus-toward-a-farther-float) consensus review | Pending Table A review of float-origin focus; selected parity target remains REQ-FLT-09 | current: selects G | current: refuses | behavior OPEN; implementation absent | OPEN (Table A R-FLT-09) | Table A R-FLT-09 |
| REQ-FLT-10 | [R-FLT-10](reference-outcomes/floating.md#r-flt-10-semantic-float-move) semantic float move | Meta+Shift+arrow snaps float to work-area half (inner-gap formula), stays floating/focused (KDE offline, live TBD); cross-platform consistency selected, Windows pending | current: half-snap | gap: `move-refused-floating` ([backlog](../backlog.md) P1 parity (a) lines 197-209) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) float-nav 2026-10-05 |
| REQ-FLT-11 | [R-FLT-11](reference-outcomes/floating.md#r-flt-11-second-float-move-and-snap-state) second move, snap state | Stateless halves only; quarter/maximize/outward-transfer deferred (same deferred-transitions decision as backlog P1 parity) | current: stateless | gap: Windows deferred ([backlog](../backlog.md) P1 parity (a) lines 197-209) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) float-nav 2026-10-05 deferral |
| REQ-FLT-12 | [R-FLT-12](reference-outcomes/floating.md#r-flt-12-raise-and-lower-overlapping-floats) raise/lower floats | current: raise path and order TBD both; no lower path | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U; no selection |
| REQ-FLT-13 | [R-FLT-13](reference-outcomes/floating.md#r-flt-13-ordinary-float-across-a-workspace-switch) ordinary float across switch | current: KDE native journey TBD; Windows hides while away | current: TBD | current: hidden while away | behavior OPEN; implementation absent | OPEN | Table U KDE leg; no selection |
| REQ-FLT-14 | [R-FLT-14](reference-outcomes/floating.md#r-flt-14-drag-and-resize-a-float-by-pointer) drag/resize float by pointer | current: host journey TBD both; project resize refuses | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U; no selection |

<a id="maximize"></a>
## 8. Maximize and fullscreen ([R-MAX](reference-outcomes/maximize-fullscreen.md#maximise--fullscreen-reference-outcomes))

Hooks: V-MAX-MODEL selects retained-slot overlay, including Q3 born-maximized admission (KDE delivered offline, live TBD). V-FS-SLOT retains the in-place fullscreen slot; born-fullscreen is a separate scenario.

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-MAX-01 | [R-MAX-01](reference-outcomes/maximize-fullscreen.md#r-max-01-maximize-then-restore) maximize then restore | Maximize is recorded overlay over retained slot/share; no geometry writes; unmaximize restores allocation | current: overlay | current: overlay (parity 2026-10-03) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) isolation auth 2026-09-14 |
| REQ-MAX-02 | [R-MAX-02](reference-outcomes/maximize-fullscreen.md#r-max-02-fullscreen-focus-and-exit) fullscreen focus and exit | Fullscreen keeps tree allocation, no writes, restores on exit | current: keeps tree | current: keeps tree (parity 2026-10-03) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) fullscreen rule; [decisions](../decisions.md#windows-port) parity 4 |
| REQ-MAX-03 | [R-MAX-03](reference-outcomes/maximize-fullscreen.md#r-max-03-workspace-floating-toggle-over-a-slotless-maximum) floating toggle over slotless maximum | Floating-workspace slotless hold selected; floating skips clear/slot seeding | current: slotless hold | current: slotless hold (2026-10-04) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#windows-workspace-tiling-mode) R-MAX-03 resolved 2026-10-04 |
| REQ-MAX-03b | [R-MAX-03](reference-outcomes/maximize-fullscreen.md#r-max-03-workspace-floating-toggle-over-a-slotless-maximum) Q3 scope | Pending: whether Q3 reserved-slot overlay replaces the one-shot restore on floating-to-tiled retile; one-shot first tiled restore remains pending Q3 scope | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | [decisions](../decisions.md#cross-platform-behavior) Q3 open scope; [backlog](../backlog.md) P1 parity (b) |
| REQ-MAX-04 | [R-MAX-04](reference-outcomes/maximize-fullscreen.md#r-max-04-shortcut-maximize-native-restore-repress) repress after restore | One native attempt per discrete activation, no persistent attempted-state map | current: new attempt (repaired 2026-10-05) | current: one attempt per down (2026-10-03) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) toggle activation 2026-10-05; [decisions](../decisions.md#windows-port) maximize rule |
| REQ-MAX-05 | [R-MAX-05](reference-outcomes/maximize-fullscreen.md#r-max-05-app-owned-fullscreen-without-a-preimage) app-owned fullscreen | Windows refuses project toggle without its restoration preimage; never synthesizes app F11 | intentional difference: public native setter | current: refuses (selected) | applicability OPEN | NORMATIVE | [decisions](../decisions.md#windows-fullscreen) accepted for now 2026-10-03; [KDE setter](../decisions.md#window-and-workspace-behavior) |
| REQ-MAX-05b | [R-MAX-05](reference-outcomes/maximize-fullscreen.md#r-max-05-app-owned-fullscreen-without-a-preimage) no-refusal direction | Pending: unanimous no-refusal consensus vs standing refusal; KDE outcome TBD | current: TBD | current: refuses | behavior OPEN; implementation absent | OPEN (Table A R-MAX-05) | Table A R-MAX-05 |
| REQ-MAX-06 | [R-MAX-06](reference-outcomes/maximize-fullscreen.md#r-max-06-admit-a-first-seen-maximized-window) admit first-seen maximized | Born-maximized tiles with reserved slot, maximize kept as overlay; no launch unmaximize (Q3); ordinary tiled born-max Q3 scope, floating-to-tiled scope stays REQ-MAX-03b | delivered offline: gap closed; first-origin admission gate plus retained overlay, native restore to reserved slot ([adapter](../../kwin/src/plan-adapter.ts), [fixtures](../../kwin/tests/plan-adapter.test.ts), [record](../changes/archive/kde-born-maximized-overlay.md)); live TBD | gap: one-shot clear still in code ([backlog](../backlog.md) P1 parity b) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cross-platform-behavior) Q3 2026-10-05 |
| REQ-MAX-07 | [R-MAX-07](reference-outcomes/maximize-fullscreen.md#r-max-07-captionless-full-monitor-cover) captionless cover | Borderless output-sized windows are not inferred fullscreen | current: no inference | gap: containment classifies fullscreen ([tiling_sys.rs](../../crates/tiler-windows/src/tiling_sys.rs):528,596-606 and [tiling.rs](../../crates/tiler-windows/src/tiling.rs):335,365; observed gap pending Table A choice) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) lines 1290-1291 (KDE-scoped no-inference; cross-platform consistency extends portable behavior) |
| REQ-MAX-07b | [R-MAX-07](reference-outcomes/maximize-fullscreen.md#r-max-07-captionless-full-monitor-cover) Windows state basis | Pending: classify by window state, not inferred containment | n/a | current: containment | behavior OPEN; implementation absent | OPEN (Table A R-MAX-07) | Table A R-MAX-07 |
| REQ-MAX-08 | [R-MAX-08](reference-outcomes/maximize-fullscreen.md#r-max-08-focus-and-move-while-maximized) focus/move while maximized | current: focus may enter/leave, move wraps (R2c); no suppression policy selected | current: unselected | current: matches KDE code (unselected) | behavior OPEN; implementation absent | OPEN | [backlog](../backlog.md) navigation-while-maximised undecided |
| REQ-MAX-09 | [R-MAX-09](reference-outcomes/maximize-fullscreen.md#r-max-09-send-a-maximizedfullscreen-window-to-another-workspace) send maximized/fullscreen | Pending: fullscreen carries state to target; Windows refuses fullscreen sends; KDE native-send untraced | current: TBD | current: refuses fullscreen | behavior OPEN; implementation absent | OPEN (Table A R-MAX-09) | Table A R-MAX-09 |

<a id="minimize"></a>
## 9. Minimize ([R-MNZ](reference-outcomes/minimize.md#minimize-native-icon-minimize-reference-outcomes))

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-MNZ-01 | [R-MNZ-01](reference-outcomes/minimize.md#r-mnz-01-native-minimize-of-a-middle-tile) native minimize of middle tile | current: minimized allocation TBD; Windows retains | current: TBD | current: retains | behavior OPEN; implementation absent | OPEN | Table W; no selection |
| REQ-MNZ-02 | [R-MNZ-02](reference-outcomes/minimize.md#r-mnz-02-native-restore-of-the-minimized-tile) native restore | current: restore slot TBD; Windows matches old slot | current: TBD | current: old slot | behavior OPEN; implementation absent | OPEN | Table W thin; no selection |
| REQ-MNZ-03 | [R-MNZ-03](reference-outcomes/minimize.md#r-mnz-03-native-minimize-of-a-sole-workspace-window) minimize sole window | current: sole-minimize TBD | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | no selection |

<a id="minimum"></a>
## 10. Minimum size ([R-MIN](reference-outcomes/minimum-size.md#minimum-size-transitions-reference-outcomes))

Hooks: V-START-MIN, V-START-SEED. PROVISIONAL indexing, not chosen configuration.

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-MIN-01 | [R-MIN-01](reference-outcomes/minimum-size.md#r-min-01-newcomer-minimum-exceeds-shares) newcomer minimum exceeds shares | Minimum-infeasible tiles use origin+minimum (B6) | delivered offline: writable members keep origin, raise only violated extents; effective equality and bounded host-shortfall acceptance ([adapter](../../kwin/src/plan-adapter.ts) `overconstrainedEffective`, `writeGeometries`; [record](../changes/archive/kde-minimum-origin-placement.md)); live TBD | current: origin+minimum (accepted hints) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cross-platform-behavior) B6 2026-10-05 |
| REQ-MIN-02 | [R-MIN-02](reference-outcomes/minimum-size.md#r-min-02-shrink-makes-members-infeasible) shrink makes members infeasible | Same B6 policy applies to shrink-infeasible members | delivered offline: shrink uses origin+minimum, grow recovers feasible allocation ([adapter](../../kwin/src/plan-adapter.ts) `effectiveTargetFor`, `writeGeometries`; [fixtures](../../kwin/tests/workspace-send-engine-fixture.test.ts)); live TBD | current: journey TBD | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cross-platform-behavior) B6 2026-10-05 |
| REQ-MIN-03 | [R-MIN-03](reference-outcomes/minimum-size.md#r-min-03-oversized-sole-minimum) oversized sole minimum | Same B6 origin+minimum policy; no automatic floating fallback | delivered offline: sole tile writes origin+minimum, overflow settles quietly ([adapter](../../kwin/src/plan-adapter.ts) `overconstrainedEffective`, `writeGeometries`; [fixtures](../../kwin/tests/workspace-send-engine-fixture.test.ts)); live TBD | current: journey TBD | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cross-platform-behavior) B6 2026-10-05 |
| REQ-MIN-01b | [R-MIN-01](reference-outcomes/minimum-size.md#r-min-01-newcomer-minimum-exceeds-shares) overlay min-hint retention | Provisional Windows policy: tiled maximized/fullscreen members retain last-known declared minimum hints bound to lifetime token and canonical slot until fresh queries resume; floating/born-slotless/minimized/cloaked rows do not reuse hints; exact native fixture TBD | applicability OPEN | current: provisional retention | applicability OPEN | PROVISIONAL | [decisions](../decisions.md#cross-platform-behavior) retained Windows overlay minimums 2026-10-03 |
| REQ-MIN-V | [R-MIN-01](reference-outcomes/minimum-size.md#r-min-01-newcomer-minimum-exceeds-shares) + [R-MIN-02](reference-outcomes/minimum-size.md#r-min-02-shrink-makes-members-infeasible) + [R-MIN-03](reference-outcomes/minimum-size.md#r-min-03-oversized-sole-minimum) no-enforce variant | Pending: 7/8 no-enforce-by-default consensus vs selected B6 (recorded counterpoint) | current: B6 selected | current: B6 selected | behavior OPEN; implementation absent | OPEN (Table A R-MIN-01..03) | Table A R-MIN-01..03 |

<a id="close"></a>
## 11. Close ([R-CLOSE](reference-outcomes/close.md#close--reflow-reference-outcomes))

Hooks: V-CLOSE-FOCUS. PROVISIONAL indexing, not chosen configuration.

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-CLOSE-01 | [R-CLOSE-01](reference-outcomes/close.md#r-close-01-close-the-middle-tile) close middle tile | Focused removal selects source-domain MRU top; unfocused removal preserves focus | current: MRU top | current: MRU top | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cosmic-movement-and-groups) removal rule auth 2026-09-09 |
| REQ-CLOSE-02 | [R-CLOSE-02](reference-outcomes/close.md#r-close-02-close-refocus-fresh-reopen) close, refocus, fresh reopen | current: reopen admission/focus TBD | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U; no selection |
| REQ-CLOSE-03 | [R-CLOSE-03](reference-outcomes/close.md#r-close-03-close-the-sole-window-on-the-shown-workspace) close sole window | current: Engine collapse sourced; native journey TBD | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U; no selection |
| REQ-CLOSE-04 | [R-CLOSE-04](reference-outcomes/close.md#r-close-04-close-a-focused-ordinary-float-over-tiles) close focused float | current: exception-drop sourced; adapter journey TBD | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U; no selection |
| REQ-CLOSE-05 | [R-CLOSE-05](reference-outcomes/close.md#r-close-05-close-a-maximized-or-fullscreen-window) close maximized/fullscreen | current: removal + desired focus sourced; native cleanup TBD | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U; no selection |

<a id="groups"></a>
## 12. Groups and stacks ([R-GRP](reference-outcomes/groups-stacks.md#groups--stacks-reference-outcomes))

Hooks: V-GROUP-STACK (deferred; centre-stack refuse closed). PROVISIONAL indexing, not chosen configuration.

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-GRP-01 | [R-GRP-01](reference-outcomes/groups-stacks.md#r-grp-01-toggle-stack-and-switch-tabs) toggle stack, switch tabs | Grouping means nested split-tree only; no tab/stack carrier, controls or bindings | current: deferred | current: deferred | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cosmic-movement-and-groups) grouped/tabbed deferred |
| REQ-GRP-02 | [R-GRP-02](reference-outcomes/groups-stacks.md#r-grp-02-join-a-tile-into-a-stack-move-a-tab-out) join tile into stack | COSMIC middle-third center refused fail-closed, no plan | current: refused | current: refused | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#nested-placement-affordance) center-refuse |
| REQ-GRP-03 | [R-GRP-03](reference-outcomes/groups-stacks.md#r-grp-03-close-the-active-tab) close active tab | No close-tab verb (pending under standing deferral) | n/a | n/a | applicability OPEN | OPEN (Table A R-GRP-03) | Table A R-GRP-03 |

<a id="output"></a>
## 13. Multi-output ([R-OUT](reference-outcomes/multi-output.md#multi-output-reference-outcomes))

Hooks: V-R4-DIR. PROVISIONAL indexing, not chosen configuration.

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-OUT-01 | [R-OUT-01](reference-outcomes/multi-output.md#r-out-01-move-left-onto-an-occupied-output) move left onto occupied output | Exhausted horizontal move crosses into adjacent output's current workspace | current: crosses | current: TBD (multi-output parked) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cosmic-movement-and-groups) R4 USER step-3 2026-09-25 |
| REQ-OUT-02 | [R-OUT-02](reference-outcomes/multi-output.md#r-out-02-perpendicular-move-at-an-output-edge) perpendicular move at edge | current: local vs cross TBD | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table C; no selection |
| REQ-OUT-03 | [R-OUT-03](reference-outcomes/multi-output.md#r-out-03-focus-left-across-outputs) focus left across outputs | Exhausted horizontal focus transfers with no layout/membership writes | current: transfers | current: transfers (proposal) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cosmic-movement-and-groups) R4 focus-transfer route |
| REQ-OUT-04 | [R-OUT-04](reference-outcomes/multi-output.md#r-out-04-explicitly-send-a-window-to-the-other-output) explicit output send | No output-send verb (pending: add via shared Engine; distinct from directional move) | n/a | n/a | applicability OPEN | OPEN (Table A R-OUT-04) | Table A R-OUT-04 |
| REQ-OUT-05 | [R-OUT-05](reference-outcomes/multi-output.md#r-out-05-open-a-window-with-two-occupied-outputs) open with two outputs | current: admission routing TBD both | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U; no selection |
| REQ-OUT-06 | [R-OUT-06](reference-outcomes/multi-output.md#r-out-06-disconnect-and-reconnect-an-occupied-output) disconnect/reconnect output | Displaced workspaces return to original monitor with current contents; explicit moves stay | current: returns | current: TBD (parked PC) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) displacement policy |

<a id="drag"></a>
## 14. Mouse and drag ([R-DRAG/R-MOU](reference-outcomes/mouse.md#mouse-reference-outcomes))

Hooks: V-DRAG-ZONE (32px edges, 80px sticky prior). PROVISIONAL indexing, not chosen configuration.

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-DRAG-01 | [R-DRAG-01](reference-outcomes/mouse.md#r-drag-01-drag-onto-centre-stack-join) drag onto centre | Drop resolver: window-edge split, group-edge first/last or wrap, interior insert; center snaps back | current: resolver | current: resolver (same-output) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#production-interactive-edge-drag) option A 2026-09-27 |
| REQ-DRAG-02 | [R-DRAG-02](reference-outcomes/mouse.md#r-drag-02-drag-to-a-between-child-bar) drag to between-child bar | Same resolver at drop point; filled target-slot preview independent of outline, cleared at drop/cancel/refusal | current: preview | current: preview (same-output) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#production-interactive-edge-drag) preview 2026-09-27 |
| REQ-DRAG-03 | [R-DRAG-03](reference-outcomes/mouse.md#r-drag-03-two-drag-producers-same-drop) two producers, same drop | Provisional Windows producer policy: title-bar first; project Win+left keeps source frame and moves preview; native title-bar follows pointer; unfocused project subject activates only on valid drop | current: native producers | current: provisional producer policy | applicability OPEN | PROVISIONAL | [decisions](../decisions.md#windows-mouse-movement) 2026-10-04 |
| REQ-DRAG-04 | [R-DRAG-04](reference-outcomes/mouse.md#r-drag-04-esc-during-a-drag) Esc during drag | Esc cancels: cancelled verdict makes no plan | current: cancel | current: cancel | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#production-interactive-edge-drag) drop-intent 2026-09-24 + verdict routing |
| REQ-DRAG-04b | [R-DRAG-04](reference-outcomes/mouse.md#r-drag-04-esc-during-a-drag) drop/persist variant | Pending: D7 drop/persist consensus vs selected cancel | current: cancel | current: cancel | behavior OPEN; implementation absent | OPEN (Table A R-DRAG-04) | Table A R-DRAG-04 |
| REQ-DRAG-05 | [R-DRAG-05](reference-outcomes/mouse.md#r-drag-05-zero-move-pressrelease) zero-move press/release | Zero-move makes no plan | current: no plan | current: no plan | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#production-interactive-edge-drag) no-change verdict |
| REQ-DRAG-06 | [R-DRAG-06](reference-outcomes/mouse.md#r-drag-06-release-outside-the-work-area) release outside work area | No off-area parking | current: no parking | current: no parking | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#production-interactive-edge-drag) verdict routing |
| REQ-DRAG-07 | [R-DRAG-07](reference-outcomes/mouse.md#r-drag-07-dragged-frame-vs-retained-allocation) dragged frame vs allocation | Provisional Windows project Win+left preview-only movement; native title-bar movement still follows pointer. Cross-platform producer parity remains OPEN | current: follows | current: project preview-only; native title-bar follows | applicability OPEN | PROVISIONAL | [decisions](../decisions.md#windows-mouse-movement) stationary source policy; reference consensus exact split |
| REQ-DRAG-08 | [R-DRAG-08](reference-outcomes/mouse.md#r-drag-08-press-focus-on-an-unfocused-tile) press focus on unfocused tile | current: KDE timing TBD; Windows drop-activate only, press-focus unproven | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U; no selection |
| REQ-MOU-01 | [R-MOU-01](reference-outcomes/mouse.md#r-mou-01-pointer-hover-vs-click-focus) hover vs click focus | current: host click/hover journeys TBD both | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U; no selection |
| REQ-MOU-02 | [R-MOU-02](reference-outcomes/mouse.md#r-mou-02-drag-the-shared-edge-to-resize) drag shared edge to resize | Pointer resize adjusts shared split boundaries/ratios, reflows neighbors | current: adjusts shares | current: TBD journey | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) pointer-resize bullet |
| REQ-MOU-03 | [R-MOU-03](reference-outcomes/mouse.md#r-mou-03-drag-across-outputs-and-onto-a-workspace-target) drag across outputs | Tiled move joins destination output tiling at drop point, source membership removed | current: joins | current: TBD (multi-output parked) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#production-interactive-edge-drag) cross-output 2026-09-27 |

<a id="activation"></a>
## 15. Activation ([R-ACT](reference-outcomes/activation.md#activation-reference-outcomes))

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-ACT-01 | [R-ACT-01](reference-outcomes/activation.md#r-act-01-hidden-window-sends-an-unsolicited-activation-request) unsolicited activation request | current: native activation-request journey TBD | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | no selection |
| REQ-ACT-02 | [R-ACT-02](reference-outcomes/activation.md#r-act-02-urgency-marker-set-then-user-focuses-the-window) urgency marker then focus | current: native mark/clear journeys TBD; no attention signal in either adapter | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U; no selection |

<a id="startup"></a>
## 16. Restart, control, startup ([R-START/R-CTL/R-RST](reference-outcomes/restart-persistence.md#restart--persistence-reference-outcomes))

Hooks: V-FIRST-RUN, V-TRAY-LIFECYCLE, V-SHORTCUT-CONFLICT. PROVISIONAL indexing, not chosen configuration.

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-START-01 | [R-START-01](reference-outcomes/restart-persistence.md#r-start-01-enable-over-a-2x2-float-field) enable over 2x2 float field | Clean/tolerance-valid recursive-cut adoption preserved | current: TBD fixture | current: TBD fixture | behavior OPEN; implementation absent | PROVISIONAL | [decisions](../decisions.md#cross-platform-behavior) placement dogfood 2026-10-03 |
| REQ-START-02 | [R-START-02](reference-outcomes/restart-persistence.md#r-start-02-enable-over-a-cascade) enable over cascade | Overlapping fits decline centre splits to deterministic sequential long-edge seed; no 2x2 guarantee | current: TBD fixture | current: TBD fixture | behavior OPEN; implementation absent | PROVISIONAL | [decisions](../decisions.md#cross-platform-behavior) sequential seed; follows COSMIC |
| REQ-START-03 | [R-START-03](reference-outcomes/restart-persistence.md#r-start-03-enable-with-infeasible-minima) enable with infeasible minima | B6 origin+minimum applies at startup | delivered offline: minimum-infeasible fits still decline to sequential long-edge seed; writable infeasible leaves use origin+minimum ([adapter](../../kwin/src/plan-adapter.ts) `overconstrainedEffective`; [fixtures](../../kwin/tests/workspace-send-engine-fixture.test.ts)); live TBD | current: origin+minimum | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cross-platform-behavior) B6 2026-10-05 |
| REQ-CTL-01 | [R-CTL-01](reference-outcomes/restart-persistence.md#r-ctl-01-first-run-preset-choice) first-run preset choice | Windows-only provisional: native Yes=Authentic default, No=Compatible; KDE prompt deferred (no KDE/macOS same behavior selected) | current: deferred | current: prompt (provisional) | applicability OPEN | PROVISIONAL | [decisions](../decisions.md#windows-settings) settings provisional 2026-10-04 |
| REQ-CTL-02 | [R-CTL-02](reference-outcomes/restart-persistence.md#r-ctl-02-stale-prompt-choice) stale prompt choice | Windows-only provisional: discard stale choice, load authoritative file, bytes unchanged | current: TBD | current: provisional path | applicability OPEN | PROVISIONAL | [decisions](../decisions.md#windows-tray-and-first-run-follow-up) tray provisional 2026-10-04 |
| REQ-CTL-03 | [R-CTL-03](reference-outcomes/restart-persistence.md#r-ctl-03-notification-icon-lifecycle) notification icon lifecycle (KDE) | Tray stays alive without watcher; registers on confirmed owner; Stop follows ordinary teardown (KDE watcher lifecycle only) | current: TBD live | n/a (see REQ-CTL-03b) | applicability OPEN | NORMATIVE | [decisions](../decisions.md#tray) user decisions 2026-09-27/28 |
| REQ-CTL-03b | [R-CTL-03](reference-outcomes/restart-persistence.md#r-ctl-03-notification-icon-lifecycle) Windows tray lifecycle | Provisional: one owner Shell_NotifyIcon icon with stable GUID; stop removes it; TaskbarCreated revalidates or re-adds it; dead-owner recovery cleans it | n/a | current: native proof; real Explorer restart user-owned | applicability OPEN | PROVISIONAL | [decisions](../decisions.md#windows-tray-and-first-run-follow-up) 2026-10-04 |
| REQ-CTL-04 | [R-CTL-04](reference-outcomes/restart-persistence.md#r-ctl-04-workspace-tiling-default) workspace tiling default | Startup seeds from saved `defaultTiled=true`; live edits seed later workspaces only; overrides reset on restart | current: tray default | current: `core.workspace.default_tiled` | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#windows-workspace-tiling-mode) KDE parity 2026-10-04 |
| REQ-CTL-05 | [R-CTL-05](reference-outcomes/restart-persistence.md#r-ctl-05-shortcut-staging-and-apply) shortcut staging and apply | Provisional KDE controls: Keep/Disable staging; confirmed Apply/Force commits; ordinary Save isolated | current: provisional controls | intentional difference: settings Apply atomically saves ([decisions](../decisions.md#windows-settings)) | applicability OPEN | PROVISIONAL | [decisions](../decisions.md#cross-platform-behavior) KDE controls 2026-10-04 |
| REQ-CTL-05a | [R-CTL-05](reference-outcomes/restart-persistence.md#r-ctl-05-shortcut-staging-and-apply) basic conflict model | Settings per-binding keep/disable/rebind with authentic/compatible presets, all platforms | gap: integrated rebind deferred; external KDE Shortcuts editor available ([decisions](../decisions.md#cross-platform-behavior) deferred controls; [backlog](../backlog.md) P1 shortcut conflict model) | current: implemented actions offer rebind; modifier limits PROVISIONAL ([decisions](../decisions.md#windows-settings)) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#cross-platform-behavior) 2026-10-03 conflict model |
| REQ-CTL-06 | [R-CTL-06](reference-outcomes/restart-persistence.md#r-ctl-06-conflict-preview-and-disable) conflict preview and disable | Provisional compatible details: KDE resets Keep then disables compiled/discovered conflicts; Windows resets catalog then disables 35 OS-conflicting physical chords; neither invents replacements | current: compiled/discovered conflicts | current: 35 disabled chords | applicability OPEN | PROVISIONAL | [decisions](../decisions.md#cross-platform-behavior) KDE compatible; [decisions](../decisions.md#windows-settings) Windows compatible |
| REQ-CTL-07 | [R-CTL-07](reference-outcomes/restart-persistence.md#r-ctl-07-revert-restores-defaults) revert restores defaults | Force clears any holder after listing+confirmation with durable cleared-ID list; Revert restores defaults (KDE-only) | current: contract | n/a (KDE-only) | applicability OPEN | NORMATIVE | [decisions](../decisions.md#shortcuts) Force/Revert contract 2026-09-26 |
| REQ-RST-01 | [R-RST-01](reference-outcomes/restart-persistence.md#r-rst-01-orderly-owner-restart-with-apps-kept-alive) owner restart, apps kept | Intentional floats reset across restart (session-local id set / runtime store cleared); layout never restored by tiler | current: resets | current: resets (user-accepted 2026-10-03) | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) session-local float; [decisions](../decisions.md#windows-port) float/sticky restart |
| REQ-RST-01b | [R-RST-01](reference-outcomes/restart-persistence.md#r-rst-01-orderly-owner-restart-with-apps-kept-alive) float identity | Pending: preserve intentional-float identity across restart | current: resets | current: resets | behavior OPEN; implementation absent | OPEN (Table A R-RST-01) | Table A R-RST-01 float |
| REQ-RST-01c | [R-RST-01](reference-outcomes/restart-persistence.md#r-rst-01-orderly-owner-restart-with-apps-kept-alive) set/membership/focus | Pending: workspace set (host-owned), membership re-observation, post-restart focus | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U R-RST-01 legs |
| REQ-RST-02 | [R-RST-02](reference-outcomes/restart-persistence.md#r-rst-02-end-session-restore-session-and-apps) session restore | current: gaps/settings restore; host-max restore TBD | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U; no selection |

<a id="special"></a>
## 17. Special windows ([R-SPC](reference-outcomes/special-windows.md#special-windows-reference-outcomes))

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-SPC-01 | [R-SPC-01](reference-outcomes/special-windows.md#r-spc-01-open-a-transient-dialog-then-request-parent-focus-fresh-modal-variant) transient dialog, parent focus | current: KDE `normalWindow` mapping untraced; Windows excludes owned dialogs | current: TBD | current: excluded (observed divergence, eligibility unselected) | behavior OPEN; implementation absent | OPEN | Table U; eligibility gap |
| REQ-SPC-02 | [R-SPC-02](reference-outcomes/special-windows.md#r-spc-02-open-a-typed-splash-window-fresh-utility-variant) splash; utility variant | current: type eligibility TBD both; Windows toolwindow-excluded utility | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table C; no selection |
| REQ-SPC-03 | [R-SPC-03](reference-outcomes/special-windows.md#r-spc-03-enter-app-picture-in-picture-mode) picture-in-picture | current: app-specific eligibility TBD; no universal PiP type | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table C; no selection |
| REQ-SPC-04 | [R-SPC-04](reference-outcomes/special-windows.md#r-spc-04-open-a-fixed-size-window-minmax-640x480) fixed-size window | Pending: fixed-size floats instead of tiling (8/8 consensus; type-exception gap, unselected) | current: tiles | current: tiles with hint clamp | behavior OPEN; implementation absent | OPEN (Table A R-SPC-04) | Table A R-SPC-04 |
| REQ-SPC-05a | [R-SPC-05](reference-outcomes/special-windows.md#r-spc-05-app-owned-resize-and-minimum-hint-change-on-a-tile) app resize/hint change | Observed frame never gates admission; Engine allocation stays authoritative | current: authoritative | current: authoritative | same target; implementation gap (adapter absent) | NORMATIVE | [decisions](../decisions.md#window-and-workspace-behavior) permissive admission auth 2026-09-14 |
| REQ-SPC-05b | [R-SPC-05](reference-outcomes/special-windows.md#r-spc-05-app-owned-resize-and-minimum-hint-change-on-a-tile) hint reflow journey | Pending: host reaction and exact reflow TBD | current: TBD | current: TBD | behavior OPEN; implementation absent | OPEN | Table U remainders |

<a id="columns"></a>
## 18. Column mechanics ([R-COL](reference-outcomes/column-mechanics.md#scrollable-column-mechanics-reference-outcomes))

Scrolling profiles are a non-voting comparison lineage; nothing selected.

| Req | Scenario | Requirement / current | KDE | Win | macOS | Status | Source |
|---|---|---|---|---|---|---|---|
| REQ-COL-01 | [R-COL-01](reference-outcomes/column-mechanics.md#r-col-01-open-a-window-over-three-half-width-columns) open over three columns | No column/strip admission counterpart | n/a | n/a | applicability OPEN | OPEN | no selection |
| REQ-COL-02 | [R-COL-02](reference-outcomes/column-mechanics.md#r-col-02-cycle-column-width-through-presets-and-back) cycle column width | No width-preset counterpart | n/a | n/a | applicability OPEN | OPEN | no selection |
| REQ-COL-03 | [R-COL-03](reference-outcomes/column-mechanics.md#r-col-03-consume-a-column-then-expel-it) consume/expel column | No consume/expel counterpart | n/a | n/a | applicability OPEN | OPEN | no selection |
| REQ-COL-04 | [R-COL-04](reference-outcomes/column-mechanics.md#r-col-04-focus-an-off-screen-window-by-identity) focus off-screen window | Leaf-only focus; no viewport counterpart | n/a | n/a | applicability OPEN | OPEN | no selection |
| REQ-COL-05 | [R-COL-05](reference-outcomes/column-mechanics.md#r-col-05-explicitly-center-the-focused-columnwindow) center column/window | No viewport/center verb | n/a | n/a | applicability OPEN | OPEN | no selection |
| REQ-COL-06 | [R-COL-06](reference-outcomes/column-mechanics.md#r-col-06-toggle-column-tabbedstacked-display-then-select) tabbed/stacked display | No tab carrier or display toggle | n/a | n/a | applicability OPEN | OPEN | no selection |
| REQ-COL-07 | [R-COL-07](reference-outcomes/column-mechanics.md#r-col-07-send-a-whole-column-to-another-workspace) send whole column | Engine send is same-output; no cross-monitor column counterpart | n/a | n/a | applicability OPEN | OPEN | no selection |
| REQ-COL-08 | [R-COL-08](reference-outcomes/column-mechanics.md#r-col-08-scroll-the-viewport-without-a-focus-command) scroll viewport | No viewport counterpart | n/a | n/a | applicability OPEN | OPEN | no selection |
| REQ-COL-09 | [R-COL-09](reference-outcomes/column-mechanics.md#r-col-09-paneru-virtual-rows-send-across-rows) virtual rows | Index-only workspaces; no row counterpart | n/a | n/a | applicability OPEN | OPEN | no selection |
| REQ-COL-10 | [R-COL-10](reference-outcomes/column-mechanics.md#r-col-10-app-native-tabs-nested-in-a-vertical-stack) app-native tabs | Per-window admission gates; no native-tab counterpart | n/a | n/a | applicability OPEN | OPEN | no selection |

<a id="shortcuts"></a>
## 19. Shortcuts

Defaults: KDE Meta, Windows Win per 2026-10-01
([decisions](../decisions.md#windows-port)). macOS mapping OPEN
([decisions](../decisions.md#cross-platform-behavior)). Catalogs:
[KDE plan](../../kwin/src/plan-adapter-entry.ts) `planShortcutCatalog`
(all three configured profiles share one letter+arrow catalog; resize is
direction plus inwards/outwards mode),
[KDE workspace](../../kwin/src/workspace-native.ts) `workspaceShortcutCatalog`
(shown chords are the per-output-local default; the three modes
per-output-local (default), global-unique and shared use the same chord
catalog; Windows global-unique/shared mappings await runtime implementation),
[Windows](../../crates/tiler-windows/src/settings.rs) `binding_catalog`.
Spec links below point at behavior sections inside this file. No new verbs:
currently-unbound rows are unselected (no verb), not a pending feature.

| Action | KDE default | Windows default | macOS | Spec |
|---|---|---|---|---|
| Focus left | Meta+H, Meta+Left | Win+H, Win+Left | mapping OPEN | [#2 Focus](#focus) |
| Focus down | Meta+J, Meta+Down | Win+J, Win+Down | mapping OPEN | [#2 Focus](#focus) |
| Focus up | Meta+K, Meta+Up | Win+K, Win+Up | mapping OPEN | [#2 Focus](#focus) |
| Focus right | Meta+L, Meta+Right | Win+L (gated `--allow-win-l`, unproven), Win+Right (normal) | mapping OPEN | [#2 Focus](#focus) |
| Move left | Meta+Shift+H, Meta+Shift+Left | Win+Shift+H, Win+Shift+Left | mapping OPEN | [#3 Move](#move) |
| Move down | Meta+Shift+J, Meta+Shift+Down | Win+Shift+J, Win+Shift+Down | mapping OPEN | [#3 Move](#move) |
| Move up | Meta+Shift+K, Meta+Shift+Up | Win+Shift+K, Win+Shift+Up | mapping OPEN | [#3 Move](#move) |
| Move right | Meta+Shift+L, Meta+Shift+Right | Win+Shift+L, Win+Shift+Right | mapping OPEN | [#3 Move](#move) |
| Grow left/down/up/right | Meta+Alt+H/J/K/L, Meta+Alt+Left/Down/Up/Right | Win+Alt+H/J/K/L, Win+Alt+Left/Down/Up/Right (defaults listed, unavailable: `implemented:false`) | mapping OPEN | [#4 Resize](#resize) |
| Shrink from left/down/up/right | Meta+Alt+Shift+H/J/K/L, Meta+Alt+Shift+Left/Down/Up/Right | Win+Alt+Shift+H/J/K/L, Win+Alt+Shift+Left/Down/Up/Right (defaults listed, unavailable) | mapping OPEN | [#4 Resize](#resize) |
| Toggle float | Meta+G | Win+G (incomplete Xbox containment) | mapping OPEN | [#7 Floating](#floating) |
| Toggle sticky | Meta+Shift+G | Win+Shift+G | mapping OPEN | [#7 Floating](#floating) |
| Toggle maximize | Meta+M | Win+M | mapping OPEN | [#8 Maximize](#maximize) |
| Toggle fullscreen | Meta+F11 | Win+F11 (incomplete Xbox containment) | mapping OPEN | [#8 Maximize](#maximize) |
| Select workspace 1..9 | Meta+1..9 | Win+1..9 (taskbar conflict; compatible preset disables) | mapping OPEN | [#6 Workspaces](#workspaces) |
| Trailing empty select | Meta+0 | Win+0 | mapping OPEN | [#6 Workspaces](#workspaces) |
| Send to workspace 1..9 | Meta+Shift+1..9; Meta+!, Meta+@, Meta+#, Meta+$, Meta+%, Meta+^, Meta+&, Meta+*, Meta+( aliases | Win+Shift+1..9 (symbols share digit key, no separate row) | mapping OPEN | [#6 Workspaces](#workspaces) |
| Send to trailing/append | Meta+Shift+0, Meta+) alias | Win+Shift+0 | mapping OPEN | [#6 Workspaces](#workspaces) |
| Workspace tiling toggle | unbound (tray action, empty key sequence) | unbound (tray checkbox only) | mapping OPEN | [#7 Floating](#floating) |
| Previous-workspace toggle | unbound (no verb) | unbound (no verb) | mapping OPEN | [#6 Workspaces](#workspaces) |
| Relative switch | unbound (no verb) | unbound (no verb) | mapping OPEN | [#6 Workspaces](#workspaces) |
| Relative send | unbound (no verb) | unbound (no verb) | mapping OPEN | [#6 Workspaces](#workspaces) |
| Output send | unbound (no verb) | unbound (no verb) | mapping OPEN | [#13 Multi-output](#output) |
| Orientation/rotate/master/layout | unbound (no verb) | unbound (no verb) | mapping OPEN | [#5 Layout](#layout) |
| Cycle next/previous | unbound (no verb) | unbound (no verb) | mapping OPEN | [#2 Focus](#focus) |

Authentic vs compatible: authentic is the default catalog (user-preferred,
harder to implement); compatible resets to the default catalog then disables
35 OS-conflicting Windows physical chords including Win+G/F11 and invents no
replacement defaults. Win+L stays explicit opt-in only and unproven.
OS relocation note (not a project action): KDE `Meta+L` focus-right
relocates `ksmserver/Lock Session` to `Meta+Esc`
([decisions](../decisions.md#shortcuts)); Windows `Win+L` stays explicit
opt-in only and unproven ([decisions](../decisions.md#windows-port)).

<a id="contradictions"></a>
## 20. Contradictions and supersessions

Supersessions (explicit, not contradictions): one-shot admission maximize
clear (auth 2026-09-14,
[decisions](../decisions.md#window-and-workspace-behavior)) superseded by Q3
on both platforms
([decisions](../decisions.md#cross-platform-behavior);
[backlog](../backlog.md) P1 parity (b)); Windows 2026-10-02
skip-infeasible decision superseded by B6 (same anchor). Consensus
differences are not contradictions (consensus selects nothing).

- T-01: explicitly open ambiguity (not two contradictory normative rules):
  R-MAX-03 slotless hold is normative only for the floating-workspace toggle
  scope (resolved 2026-10-04,
  [decisions](../decisions.md#windows-workspace-tiling-mode)); Q3
  reserved-slot overlay (2026-10-05,
  [decisions](../decisions.md#cross-platform-behavior)) covers born-maximized
  scope. Open scope REQ-MAX-03b decides the floating-to-tiled admission; do
  not state an overlapping first-tiled restore as normative.
- T-02: B9 provisional unfloat-stays-maximized vs COSMIC R-FLT-06 source
  unmaximize-then-admit (matrix `S-cos` + consensus Table C). User COSMIC
  live check decides before Windows drops refusal
  ([decisions](../decisions.md#cross-platform-behavior) B9).
- T-03: Windows captionless-containment classification (matrix Ours R-MAX-07
  cell) vs selected no-inference requirement REQ-MAX-07
  ([decisions](../decisions.md#window-and-workspace-behavior) lines
  1290-1291). Gap, pending REQ-MAX-07b.
- T-04: [R-MAX-06 Ours cells](reference-outcomes/maximize-fullscreen.md#r-max-06-admit-a-first-seen-maximized-window)
  call preserve variants unselected, but [Q3](../decisions.md#cross-platform-behavior)
  selects reserved-slot overlay. Their current one-shot-clear description still
  matches lagging implementation; their selection label is stale.

<a id="open-index"></a>
## 21. Open-decisions index

All OPEN requirement IDs (grouped with spec section links; Table A items
marked with literal status in-row):

- [Insertion](#insertion): REQ-INS-01b, REQ-INS-03, REQ-INS-04, REQ-INS-05, REQ-INS-06, REQ-INS-07b, REQ-INS-08.
- [Focus](#focus): REQ-FOC-01, REQ-FOC-02, REQ-FOC-03, REQ-FOC-04.
- [Move](#move): REQ-MOV-01, REQ-MOV-02, REQ-MOV-03 (Table A), REQ-MOV-04, REQ-MOV-05, REQ-MOV-06, REQ-MOV-07, REQ-MOV-08b (Table A).
- [Resize](#resize): REQ-RSZ-01b (Table A), REQ-RSZ-02, REQ-RSZ-03, REQ-RSZ-04.
- [Layout](#layout): REQ-LAY-01 (Table A), REQ-LAY-02, REQ-LAY-03, REQ-LAY-04 (Table A).
- [Workspaces](#workspaces): REQ-WS-01b (Table A), REQ-WS-02b, REQ-WS-05, REQ-WS-07, REQ-WS-08 (Table A), REQ-WS-09, REQ-WS-10, REQ-WS-11 (Table A), REQ-WS-12 (Table A), REQ-WS-14 (Table A).
- [Floating](#floating): REQ-FLT-03, REQ-FLT-05 (Table A), REQ-FLT-06b (Table A), REQ-FLT-09b (Table A), REQ-FLT-12, REQ-FLT-13, REQ-FLT-14.
- [Maximize](#maximize): REQ-MAX-03b, REQ-MAX-05b (Table A), REQ-MAX-07b (Table A), REQ-MAX-08, REQ-MAX-09 (Table A).
- [Minimize](#minimize): REQ-MNZ-01, REQ-MNZ-02, REQ-MNZ-03.
- [Minimum](#minimum): REQ-MIN-V (Table A R-MIN-01..03).
- [Close](#close): REQ-CLOSE-02, REQ-CLOSE-03, REQ-CLOSE-04, REQ-CLOSE-05.
- [Groups](#groups): REQ-GRP-03 (Table A).
- [Output](#output): REQ-OUT-02, REQ-OUT-04 (Table A), REQ-OUT-05.
- [Drag](#drag): REQ-DRAG-04b (Table A), REQ-DRAG-08, REQ-MOU-01.
- [Activation](#activation): REQ-ACT-01, REQ-ACT-02.
- [Restart/control](#startup): REQ-RST-01b (Table A), REQ-RST-01c, REQ-RST-02.
- [Special](#special): REQ-SPC-01, REQ-SPC-02, REQ-SPC-03, REQ-SPC-04 (Table A), REQ-SPC-05b.
- [Columns](#columns): REQ-COL-01, REQ-COL-02, REQ-COL-03, REQ-COL-04, REQ-COL-05, REQ-COL-06, REQ-COL-07, REQ-COL-08, REQ-COL-09, REQ-COL-10.

PROVISIONAL discussion group (not final selections; awaiting discussion):
REQ-START-01, REQ-START-02, REQ-CTL-01, REQ-CTL-02, REQ-CTL-03b, REQ-CTL-05,
REQ-CTL-06, REQ-DRAG-03, REQ-DRAG-07, REQ-FLT-06,
REQ-MIN-01b. Spec format itself provisional to discuss.

Platform mapping and known decisions waiting native acceptance (separated
from product choices, for user review):
- macOS adapter absence: platform-wide once (all portable NORMATIVE rows
  carry `implementation gap (adapter absent)`; no per-row macOS parity
  implied).
- O-01 macOS mapping (mapping OPEN until macOS starts); O-02 Win+L opt-in
  vs gap acceptance; O-03 Win+G/F11 containment (compatible preset interim);
  O-04 Windows keyboard-resize trigger (REQ-RSZ-01b); O-05 Windows
  global-unique/shared mappings; O-06 KDE first-run prompt and rebind editor
  (deferred); O-07 R-DRAG-07 producer parity (PROVISIONAL); O-08 live-test
  acceptance queue (user-owned throughout).
