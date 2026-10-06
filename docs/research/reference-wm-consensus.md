# Reference-WM consensus across the full matrix (analysis note)

Date: 2026-10-06. Base: main HEAD `9de7274`.
Matrix: [reference-outcomes matrix](../spec/reference-outcomes.md) (64 rows:
58-row historical audit preserved below, plus 6-row insertion expansion).
Profiles/legend: matrix profile and legend sections. Families (4, per user):
COSMIC n-ary; binary (Hyprland dwindle + bspwm); tree (i3 + sway, correlated);
layout-driven (xmonad + qtile + awesome, correlated triple).
Source passes: [bspwm/xmonad](../changes/archive/reference-wm-bspwm-xmonad-source.md),
[qtile/awesome](../changes/archive/reference-wm-qtile-awesome-source.md).
Decisions re-read: [decisions](../decisions.md) (cross-platform, window and
workspace behavior, COSMIC movement and groups), [post-Windows audit](cross-platform-core/post-windows-audit.md),
[KDE float nav](../changes/archive/kde-floating-directional-navigation.md),
[workspace tiling](../changes/archive/windows-workspace-tiling.md),
[alt-tab](windows-port/alt-tab-hidden-workspaces.md).

Scope: classify all 58 rows from matrix cells only; no product code, matrix,
decision, or record edits; no live testing.

## Evidence rule

A cell votes only if the source establishes the requested action's outcome on
an applicable fixture. `E` (no vote): EU no counterpart in the profiled
source; EO owner-specific/external; EG/EF/EN geometry, anchor/focus-identity,
or native journey TBD on the discriminating point; ET fixture inapplicable;
EP partial leg (votes for that leg only); ER recorded user test or authored
observation without an `S()` tag (non-voting qualifier). Missing maximize
state (EU) never votes: ordinary-manage reports from maximize-stateless
profiles are feature absence, not deliberate overlay rejection. Compound
predicates split into legs with explicit sub-leg voter lists.

Strength rule (user rule, no added floor): Strong = 5+ agreeing of 8, or
all-but-one of those with evidence; strong cross-family needs agreeing WMs
from 3+ of the 4 families. One row may place sub-legs in different tables;
table counts are per-predicate, not disjoint row partitions. Numerical
majority/all-but-one rows that fail cross-family breadth go to the weak
table, never called "no consensus" unqualified. 1-1 ties and 1/1 singletons
are not consensus (no floor needed, breadth disclosed).

Match vocabulary per platform (KDE / Windows): yes, no, partial, unknown
(offline, live-accepted, TBD). Audit Result points at summary tables
(A/B/U/C/W).

Ground truth applied (user, not reopened): B6 minimum-infeasible is
origin+minimum on BOTH platforms (KDE skip is the gap). Q3 born-maximized is
reserved slot + maximize overlay (selected). B9 overlaid unfloat stays
maximized (provisional, pending COSMIC live R-FLT-06); refusal sub-leg 4/4
no-refusal aligns B9, contradicts current Windows refusal; KDE allows it.
KDE float focus + half-snap delivered and live-accepted at 9de7274.
Stateful quarter-snap stays deferred.

## Full audit (58 rows; codes in C H B I X S Q A order)

C=COSMIC, H=Hyprland, B=bspwm, I=i3, X=xmonad, S=sway, Q=qtile, A=awesome.

| Row | Row-local classes | C H B I X S Q A | ev/noev | lead | Result |
|---|---|---|---|---|---|
| R-INS-01 | axis L long-edge, F flat-H, V vertical-stack; position after/before | L L L F V F V V | 8/0 | axis tie L3/V3 | U position after-5/7ev (C,B,I,S,A vs X,Q; H EF); C axis |
| R-INS-02 | J joins, N ordinary-admits | J J N J EU J N N | 7/1 | J4 | C audit-only |
| R-MOV-01 | R restructure, O noop, N in-column/swap only | ER EG O R EG R N N | 5/3 | tie R2/N2 | C audit-only |
| R-MOV-02 | W swap | ER W W W W W W W | 7/1 | W7 | B 7/7 sourced (COSMIC observed ER) |
| R-MOV-03 | W nested wrap, F flat swap, C column-carry | ER EG F F ET F C F | 5/3 | F4 | A (COSMIC observed wrap ER; H EG, X ET) |
| R-MOV-04 | E escape, N binary-retain, P partial extract, C carry, S swap/miss | ER N N P ET P C S | 6/2 | tie N2/P2 | C audit-only |
| R-MOV-05 | O noop | ER O O O O O O O | 7/1 | O7 | B 7/7 sourced (COSMIC observed ER) |
| R-WS-01 send verb | N Send stays, F Send follows | N F F N N N F N | 8/0 | N5 | A send-leg (Move-verb inventory 4/4 tie, not Send consensus) |
| R-WS-02 | A returns at A; order after/before; axis qualifier | A EG A A A A A EG | 6/2 | A6 | B anchor; U after-4/5ev (C,B,I,S vs X); axis qualifier |
| R-WS-03 | R reuses | R EU EU EU EU EU EU EU | 1/7 | - | C audit-only (singleton, not consensus) |
| R-WS-04 | D lands at surviving D, O other anchor (X at live C) | D D EF D O D EF EF | 5/3 | D4 | U (ours unknown) |
| R-WS-05 | T fresh-readmit, R float retained | T R R R R R R R | 8/0 | R7 | U (ours unknown) |
| R-WS-06 | M mode-clamped-origin, P per-tag unarranged | M EU EU EU EU EU EU P | 2/6 | - | C (1-1 tie, not consensus) |
| R-WS-07 | L listed plus switch | L EO EO EO EO EO EO EO | 1/7 | - | C (singleton, not consensus) |
| R-FLT-01 | F fresh admission, S same-slot | F F S F S F F F | 8/0 | F6 | B fresh-vs-oldslot leg only (anchor/order/frame differ) |
| R-FLT-02 | V visible, K flag-but-stays, R refused | V R V K EU K EU V | 6/2 | V3 | C audit-only |
| R-FLT-03 | R ratio preserved | ER EG EG R EG R EG EG | 2/6 | R2 | W (2/2 one family) |
| R-FLT-04 | T re-admit, P stateless recalc | T EU EU EU EU EU EU P | 2/6 | - | C (1-1 tie, not consensus) |
| R-FLT-05 | V sticky-visible; X sticky leg inapplicable | EN EO V V ET EU EO V | 3/5 | V3 thin | A (3/3ev, 3 families; native journey TBD) |
| R-FLT-06 | U unmax-then-admit, R retain, P proceed; I/B/X/S no native-max fixture | U R EU EU EU EU U R | 4/4 | refusal NO4; retention 2-2 | A refusal 4/4ev; C retention 2-2 |
| R-FLT-07 | T tile A | T T T T T T T T | 8/0 | T8 | B unanimous |
| R-FLT-08 | R retained, T enters tile | R R T R R R T T | 8/0 | R5 | B (COSMIC cell only, prose config-bound, see note) |
| R-FLT-09 | G focuses G, T focuses tile | G G T G G G T T | 8/0 | G5 | A (KDE live-accepted, Win no) |
| R-FLT-10 | Hf half-snap, Ee edge-snap, W swap, Px pixel, No noop | Hf Ee W Px No Px EU W | 7/1 | tie | C audit-only |
| R-FLT-11 | Q stateful quarter, S stateless | Q S EF S S S EU S | 6/2 | S5 | B (COSMIC differs) |
| R-MAX-01 | S slot overlay, M mode-obscure, L leaves tiling | S M EU EU EU EU L L | 4/4 | L2 | C audit-only |
| R-MAX-02 | K kept, Rm removed+remap, Rr removed+readmit | Rm K K K K K Rr Rr | 8/0 | K5 | B (COSMIC differs) |
| R-MAX-03 | F fresh-admit-all, H hold-in-floating | F EU EU EU EU EU EU H | 2/6 | - | C (1-1 tie, not consensus) |
| R-MAX-04 | N new attempt, S backend-split | N N EU EU EU EU S N | 4/4 | N3 thin | B thin (ours both new-attempt, physical TBD) |
| R-MAX-05 | N no refusal | N N N N N N N N | 8/0 | N8 | A unanimous (Win no) |
| R-MAX-06 | O overlay/state, F implicit float | O O EU EU EU EU EU F | 3/5 | O2 | W (2 agreeing families, thin) |
| R-MAX-07 | T ordinary tile, no size inference | T T T T T T T T | 8/0 | T8 | A unanimous (Win differs) |
| R-START-01 | N nested chain, P per-tag recalc | N EU EU EU EU EU EU P | 2/6 | - | C (1-1 tie, not consensus) |
| R-START-02 | N nested chain, P per-tag recalc | N EU EU EU EU EU EU P | 2/6 | - | W no-centre-cut sub-point 2/2ev, 2 families |
| R-START-03 | U ignores minima, S hint-shaped | U EU EU EU EU EU EU S | 2/6 | - | C (1-1 tie, not consensus) |
| R-CLOSE-01 | M MRU/stack/history, S spatial default, P positional | M S M M P M P M | 8/0 | M5 | B |
| R-CLOSE-02 | F fresh admission, no old-slot | F F F F F F F F | 8/0 | F8 | U (ours unknown) |
| R-GRP-01 | T single-tab, G one-window group, P parent retarget | T G EU P EU P EU EU | 4/4 | P2 | C (P tree-pair only) |
| R-OUT-01 | C cross, N noop | ER C C C EF C N C | 6/2 | C5 | B (COSMIC observed ER) |
| R-OUT-02 | W local wrap, C cross, L local split | ER EG C W ET W L C | 5/3 | tie W2/C2 | C audit-only |
| R-DRAG-01 | J join, W swap, M centre-move, F float-out | J F W M F W W W | 8/0 | W4 | C (4/8 not majority) |
| R-DRAG-02 | F bar-index, N stays, Ei edge-insert, Fl floats, Cd conditional | F EG N Ei Fl Cd N N | 7/1 | N3 | C audit-only |
| R-DRAG-03 | S same topology | S EF EF S EF S EF S | 4/4 | S4 thin | B thin |
| R-DRAG-04 | D drop/persist, C cancel-revert | D D D C D D D D | 8/0 | D7 | A (ours differs) |
| R-DRAG-05 | N no mutation, R retile, F floats | N R N N F N N N | 8/0 | N6 | B |
| R-DRAG-06 | N nopark, P parks off-area | N N N N P N N N | 8/0 | N7 | B |
| R-DRAG-07 | F follows pointer, R retained | F F R R F R F R | 8/0 | tie 4-4 | C exact split |
| R-DRAG-08 | F focus at press, N no focus write | F F N N F F F F | 8/0 | F6 | U (ours unknown/unknown) |
| R-CTL-01 | owner-only | EO EO EO EO EO EO EO EO | 0/8 | - | C no-evidence row |
| R-CTL-02 | owner-only | EO EO EO EO EO EO EO EO | 0/8 | - | C no-evidence row |
| R-CTL-03 | owner-only | EO EO EO EO EO EO EO EO | 0/8 | - | C no-evidence row |
| R-CTL-04 | owner-selected (COSMIC config leg only) | EN EU EU EU EU EU EU EU | 0/8 | - | C no-evidence row |
| R-CTL-05 | owner-only | EO EO EO EO EO EO EO EO | 0/8 | - | C no-evidence row |
| R-CTL-06 | owner-only | EO EO EO EO EO EO EO EO | 0/8 | - | C no-evidence row |
| R-CTL-07 | owner-only | EO EO EO EO EO EO EO EO | 0/8 | - | C no-evidence row |
| R-MIN-01 | U default-unclamped alloc, S hint-shaped | U U U U U U U S | 8/0 | U7 | A (ours min-enforced both; see MIN note) |
| R-MIN-02 | same | U U U U U U U S | 8/0 | U7 | A (same) |
| R-MIN-03 | same; all 8 tile the oversized sole (no auto-float) | U U U U U U U S | 8/0 | U7 | A (same; bspwm opt-in origin clamp off default) |

Coverage: 58/58 rows audited, eight reference classifications per row.
Summary counts are per-predicate: A 11, B 14, U 6, C 15, W 3;
multi-leg rows overlap, and the full audit also covers unrelated rows.

## Table A: strong cross-family consensus where ours differs (11)

Ours differs = established follow/refusal/etc on at least one platform.

| Row | Consensus | Count | COSMIC | Ours KDE / Windows | Deliberate vs feature absence |
|---|---|---|---|---|---|
| R-WS-01 send | declared-profile Send stays (leaves source focus) | N5/8, 3/4 fam (C,I,X,S,A) | yes (Send stays; Move is alternate) | follow / follow (recorded verified-transfer policy) | Deliberate command semantics; profile/binding-dependent |
| R-MOV-03 | flat swap, not same-orientation nested wrap | F4/5ev, 3 fam | observed wrap ER, no source vote | no / no (Engine R2c wrap; fixture-qualified) | Deliberate swaps across models, not exact topology parity |
| R-FLT-05 | restart retains sticky visibility | V3/3ev thin (B,I,A), 3 fam | unknown | yes / no (normal-float marker consumption); native journey TBD | Deliberate state restoration; missing sticky/restart fixtures excluded |
| R-FLT-06 refusal | no refusal of overlaid-unfloat toggle | NO4/4ev (C,H,Q,A), 3 fam | yes (unmax-then-admits) | yes-allows / no-refuses (selected B9 is no-refusal) | Deliberate toggle paths; absent native-max fixtures excluded |
| R-FLT-09 | float-origin right focuses far float G | G5/8, 4/4 fam | yes | yes live-accepted / no (subject refusal; parity pending) | Deliberate focus policies; dissent mixes cross-layer search and absent float-only search |
| R-MAX-05 | no refusal of app-owned fullscreen toggle | N8/8 | yes | yes (public setter) / no (preimage-gate refusal, standing decision) | Deliberate fullscreen paths, distinct from missing maximize |
| R-MAX-07 | no size inference; caption cover tiles | T8/8 | yes | yes / no (Windows containment classifies fullscreen) | Deliberate state-based classification |
| R-MIN-01 | profile-default tiled alloc does not enforce minima | U7/8 | yes | no / no (B6 min-enforced both; KDE skip is the gap) | Default/absent tiled clamps; H/B opt-in clamps disabled |
| R-MIN-02 | same on shrink | U7/8 | yes | no / no (same B6 split) | Same default-clamp policy, not settled native frames |
| R-MIN-03 | same, oversized sole tiles | U7/8 | yes | no / no (flag + skip/raise gap) | Same clamp policy; tile admission itself is unanimous |
| R-DRAG-04 | Esc does not cancel (drop/persist) | D7/8 | yes | no / no (cancel verdict selected; i3 revert is the outlier) | Escape handling mixes normal drop and no cancellation path |

WS-01 notes: H silent (no-follow) path exists alongside profiled follow;
alternate Move-verb inventory is a 4/4 tie (C/H/B/Q follow vs I/X/S/A
default-stay), reported as inventory, never read as Send consensus. COSMIC
MoveToWorkspace follow is not a Send vote.

## Table B: strong consensus ours matches (14; pending explicit)

| Row | Consensus | Count | COSMIC | Ours KDE / Windows |
|---|---|---|---|---|
| R-WS-02 anchor | return lands at A | A6/6ev (C,B,I,X,S,Q), 4/4 fam | yes (target MRU) | yes (remembered A) |
| R-FLT-01 | unfloat is fresh admission (old-slot excluded only) | F6/8, 4/4 fam | yes | yes / yes |
| R-FLT-07 | tile-origin focus lands on tile A | T8/8 | yes | yes / yes |
| R-FLT-08 | float-origin miss retains F | R5/8, 4/4 fam | yes-cell (prose config-bound, see note) | yes-offline (live TBD) / yes-outcome via subject refusal (mechanism partial) |
| R-FLT-11 | no stateful quarter | S5/6ev | no (stateful quarter) | yes stateless-half (stateful deferred) / unknown |
| R-MAX-02 | fullscreen keeps tree, no node removal | K5/8, 3 fam | no (deliberate remove+remap) | yes / yes (focus sequence pending) |
| R-MAX-04 | repress after native restore is a new attempt | N3/4ev thin | yes | yes / yes (physical TBD) |
| R-MOV-02 | move-up swaps in place | W7/7 sourced | observed ER | yes / yes |
| R-MOV-05 | single-output edge is noop | O7/7 sourced | observed ER | yes / yes (offline) |
| R-OUT-01 | occupied-target move crosses outputs | C5/6ev, 3 fam | observed ER | yes-offline / yes-offline |
| R-CLOSE-01 | close refocus follows MRU/stack/history rule | M5/8, 4/4 fam | yes | yes / yes |
| R-DRAG-03 | both producers share one tiled-drag topology | S4/4ev thin, 3 fam | yes | yes / yes-synthetic (exact row TBD) |
| R-DRAG-05 | zero-move press/release does not mutate | N6/8, 4/4 fam | yes | yes / yes |
| R-DRAG-06 | no off-area parking | N7/8 | yes | yes / yes |

FLT-01 qualifier: anchors differ (MRU vs Dwindle vs after-focus vs
position/order); consensus covers fresh-vs-oldslot only. WS-02 after-order
leg (after-4/5ev C,B,I,S vs X before) is U (ours exact order TBD); tall/wide
axis stays a qualifier (X/Q inapplicable).

## Table U: strong consensus, ours unresolved (6)

| Row | Consensus | Count | COSMIC | Ours |
|---|---|---|---|---|
| R-INS-01 position | newcomer after focus | after-5/7ev (C,B,I,S,A vs X,Q; H EF), 4/4 fam | after (sourced) | order TBD / TBD |
| R-WS-02 after | B after A | after-4/5ev (C,B,I,S vs X before) | after | exact order TBD |
| R-WS-04 | B lands at surviving D (history vs sole-candidate) | D4/5ev, 3 fam | yes | unknown / unknown (selected history rule authorized, scenario TBD) |
| R-WS-05 | floated B transfers retaining float | R7/8 | no | unknown / unknown (roundtrip untested) |
| R-CLOSE-02 | reopen is fresh admission, no old-slot | F8/8 | yes | unknown / unknown (not checked) |
| R-DRAG-08 | Meta/Win press focuses mover | F6/8, 4/4 fam | yes | unknown / unknown (KDE timing TBD; Win drop-activate only, press-focus unproven) |

DRAG-08: unknown is not mismatch; B/I have deliberate no-focus paths.

## Table C: listed COSMIC differences without strong consensus (15)

| Row | COSMIC vs ours (recorded) | Reason |
|---|---|---|
| R-INS-01 axis | same (long-edge; order TBD both) | L3 vs F2 vs V3 full-axis split (position leg is U above) |
| R-WS-02 axis | same (remembered A both) | long-edge vs live-split vs parent vs inapplicable; no axis consensus |
| R-WS-06 | same (mode exists both) | 1-1 tie (mode-clamped-origin vs per-tag unarranged); 6 EU |
| R-WS-07 | partial (KDE same; Win omits) | singleton (COSMIC path only); 7 EO |
| R-FLT-02 | differs (output-set layer vs all-ws scope) | visible 3 vs flag-but-stays 2 (tree pair) vs refusal 1; X,Q EU |
| R-FLT-04 | same (toggle exists both) | 1-1 tie; 6 EU |
| R-FLT-06 retention | partial (KDE allows, Win refuses) | unmax-admit 2 (C,Q) vs retain 2 (H,A); refusal leg is A above |
| R-FLT-10 | partial (KDE half-snap matches; Win refuses) | half/edge/swap-2/pixel-2/noop split; Q EU |
| R-MAX-03 | partial (fresh-admit direction; ours one-shot clear) | 1-1 tie; 6 EU |
| R-START-01 | same direction (nested chain) | 1-1 tie; 6 EU |
| R-START-03 | differs (ignores minima vs B6) | 1-1 tie on handling; 6 EU |
| R-GRP-01 | differs (stack vs deferred/refuse) | parent-retarget 2 (tree pair) vs singletons; 4 EU |
| R-DRAG-01 | differs (join vs refuse) | swap 4/8 (not majority) vs join 1 / centre 1 / float-out 2 |
| R-DRAG-07 | partial (KDE follows; Win stationary) | exact 4-4 split |
| R-CTL-04 | N/A (config leg only) | 0 full-predicate votes; 7 EU |

Resolved without contradicting consensus: DRAG-01 refusal and GRP-01
deferral selected; START-02 long-edge chain provisional follows COSMIC;
FLT-10 KDE half-snap delivered matches COSMIC; WS-03 Windows reuse matches
COSMIC.

## Table W: numerical but not strong cross-family (3; weak, disclosed)

| Row | Numerical result | Breadth | Status |
|---|---|---|---|---|
| R-FLT-03 | ratio-preserve 2/2ev (I,S; COSMIC UT is ER) | 1 family (tree pair) | weak; ours unchecked |
| R-MAX-06 | overlay/state 2/3ev (C,H vs A implicit-float) | 2 agreeing families | thin; Q3 selected matches overlay direction, recorded one-shot-clear differs; no strong contradiction either way |
| R-START-02 sub-point | no-centre-cut 2/2ev (C,A) | 2 families | weak sub-point only; chain itself 1-1 |

FLT-05 notes: A EWMH roundtrip (sticky reads on every selected tag) counts
as source policy like B/I full-state restores (exact journeys TBD in all
three); X ordinary-float carry is no-evidence because the sticky predicate
has no counterpart there. Q re-manage outcome stays EO.

MIN note: the counted conflict is default tiling-minimum policy (no
enforcement under profile defaults) vs selected B6 min-enforced behavior. It
is not source proof that settled native minima are ignored (exact
shrink/grow frames TBD in every cell). MIN-03 admission itself is unanimous
tile (no auto-float in any profile); the counted U7/S1 split is
minimum-clamp policy only (A hint-shaping; H/B opt-in clamps off default).
Fixed-size (min==max) float admission is recorded in cells but was not
counted as a discriminator here.

FLT-08 note: the COSMIC cell proves retain-on-miss for one output with no
next output. No-workspace-cycling generally comes from section prose
(Vertical layout routes missed horizontal focus to output fallback):
prose-tier, config-bound to that layout, disclosed here. The matrix does
not separately establish a cross-WM workspace-cycling predicate, so that
path has no counted consensus here.

Decision conflicts flagged (scope makes no decisions): B6 vs MIN rows;
selected R2c wrap vs MOV-03 (fixture-qualified); cancel verdict vs DRAG-04;
Windows preimage refusal vs MAX-05 and selected B9 no-refusal direction;
Windows containment vs MAX-07. MAX-06 thin 2/3 support is no strong
contradiction of Q3 in either direction.

## Limitations

- Thin/low-evidence passes (FLT-05 3/3, MAX-04 3/4, DRAG-03 4/4, Table W rows) are
  marked as such, never full 5+ weight.
- i3/sway-only legs never carry cross-family alone (FLT-02, FLT-10,
  GRP-01, OUT-02 wrap leg).
- awesome per-tag partials (WS-06, FLT-04) vote as their own distinct
  class, not toward the COSMIC outcome.
- Recorded-ours vs target gaps: WS-04/WS-05/CLOSE-02/INS-01-order/WS-02-order/
  DRAG-08 scenarios TBD; FLT-11 Windows pending; MAX-02/04 and DRAG-03/06
  exact journeys TBD; Windows float-subject parity pending (FLT-08/09/10).

## Insertion expansion (piece B1): R-INS-03..08 plus R-INS-01/02 scrolling backfill

Scope: piece B1 adds six GWT insertion scenarios (R-INS-03..08) and
additive scrolling backfill blocks for R-INS-01/02. Historical tables and
the 58-row audit above are preserved unchanged. Denominator, families, and
the strength rule are unchanged: consensus classification below counts the
original eight profiles only. The four scrolling profiles (niri, PaperWM,
karousel/Lazy, paneru) form one correlated lineage reported as an explicit
separate non-voting comparison; they never silently redefine a denominator.
Cell classes for the expansion are mutually exclusive per cell: E
complete outcome evidenced; P at least one predicate sub-leg evidenced
with the remainder TBD; T TBD-only (branch notes cited for non-coverage
do not promote a cell to P); Q all requested legs qualified
(fixture-inapplicable / no-counterpart / owner-specific, each with pinned
inventory evidence); M mixed qualified and applicable-TBD legs. Branch
evidence is not a full-fixture vote. Sub-leg discipline: topology, anchor,
focus, exact-geometry,
verb-inventory, and routing-mechanism sub-legs split with explicit voter
lists. Partial geometry/focus branch tags are never counted as complete
outcomes.

| Row | Predicate sub-legs (original eight) | Voters per sub-leg | Result |
|---|---|---|---|
| R-INS-03 empty admission | anchor fallback; complete topology; newcomer focus; exact frames | partial policy branches: C `S-cos-axis`, H `S-hyp-ins`, B `S-bsp-insert`, S `S-sway-ins`, Q `S-qti-add`, A `S-awe-tile`/`S-awe-manage`; I/X focused-branch tags do not cover no-focus; empty-fixture topology/frames unresolved, focus policies partial (H,B; S gate, Q current-position fallback unresolved) | C audit-only (no agreed single predicate; applicable unknowns TBD) |
| R-INS-04 chained admission | leg 1 inherits R-INS-01 policy branches only (landscape work area does not prove B at 1200x600, so no dimension is re-voted); legs 2-3 topology/focus/geometry | leg-1 policy branches all 8 (P); legs 2-3: 0/8 evidenced (live-test route: pointer/focus updates plus repeated recalc) | C audit-only |
| R-INS-05 float-focus anchor | anchor exclusion vs fallback; newcomer layer/focus | 0/8 complete (anchor-branch notes only: C `S-cos-last`, H `S-hyp-ins`, B `S-bsp-insert`, S `S-sway-ins`; none proves float exclusion) | C audit-only |
| R-INS-06 over overlay | overlay retained/cleared/covering; newcomer focus/visibility; underlying layout; separate `B:max` vs fresh `B:full` legs | `B:max` leg no-counterpart: B (no maximize in the state inventory, `S-bsp-fs`), I (`S-i3-max`), X (`S-xmo-layout`), S (`S-sway-max`), all consistent with the R-FLT-06 no-native-max classification; `B:full` legs applicable but TBD in those four; C/H/Q/A legs applicable but TBD | C audit-only |
| R-INS-07 inactive-workspace routing | target-local anchor vs global focus; no focus steal; no output switch | 0/8 complete (routing TBD at pin in all eight) | C audit-only |
| R-INS-08 preselected direction | verb inventory; override vs unsupported; one-shot vs persistent | verb+override+consumption: H (`S-hyp-pre`: preselect verb, forced axis/side, one-shot reset under shipped default); verb+manual-mode: B (`S-bsp-pre`); verb only: I (`S-i3-split`), S (`S-sway-default`+`S-sway-split`); no-counterpart: X (`S-xmo-layout` fixed Tall); TBD: C,Q,A (a missing search term is not inventory proof) | C audit-only |
| R-INS-01 scrolling supplement | column admission position/focus/viewport under the separate column Given (no exact H projection; same A/B/C identities) | position-policy branches: niri (`S-nir-ins`: new column after active), PaperWM (`S-pap-ins`: selected+1 RIGHT), karousel (`S-kar-ins`: new column after last-focused), paneru (`S-pan-ins`: rule-index/overlap/end); focus/viewport 0/4 | non-voting comparison only |
| R-INS-02 scrolling supplement | tab join vs ordinary admission under `COL[C1[S[A*,B]]]` with open C (same identities/action as the tree fixture) | non-join position: niri (ordinary open wraps a new column, `S-nir-ins`), karousel (ordinary open a new column, `S-kar-ins`; stacked display exists but off default); TBD: PaperWM (accordion is not exact tabs), paneru (`Stack` is vertical, `Tabs` app-native, `S-pan-model`; exact fixture/admission TBD) | non-voting comparison only |

Counts for this expansion (92 cells: 84 new + 8 backfill; mutually
exclusive E/P/T/Q/M). Original-eight new-row cells (6x8=48): E 0, P 18
(R-INS-03: 6; R-INS-04: 8 leg-1-policy; R-INS-08: 4), T 25 (R-INS-03: 2;
R-INS-05: 8; R-INS-06: 4; R-INS-07: 8; R-INS-08: 3), Q 1
(R-INS-08: X), M 4 (R-INS-06: B,I,X,S each has no-counterpart `B:max`
and applicable-TBD `B:full`). Scrolling new-row cells (6x4=24): P 6
(R-INS-03: 4; R-INS-07 niri routing and PaperWM routing+no-steal: 2),
T 18, Q 0, M 0.
Backfill cells (2x4=8): P 6 (R-INS-01: 4 position-policy; R-INS-02:
niri+karousel non-join: 2), T 2 (R-INS-02: PaperWM, paneru), Q 0. Ours
cells (6x2=12; backfill blocks carry no Ours cells): P 6 (R-INS-03
topology+desired-focus: 2; R-INS-04 leg-1 topology: 2; R-INS-05
anchor-predicate: 2), T 6 (R-INS-06/07/08: 6), Q 0. Grand totals: E 0,
P 36, T 51, Q 1, M 4 (92 cells). All 36 P cells retain TBD remainders;
all four M cells retain applicable fullscreen TBD legs. These cell counts
measure documentation coverage, not consensus votes.

Ours-vs-consensus position (no behavior selected): the six new rows carry
no strong consensus (all C audit-only), so no new ours-vs-consensus
conflict is established. Ours empty-tree single-leaf and desired-focus
branches are sourced; reference empty-fixture comparisons remain partial.
Hyprland/bspwm preselect verbs are evidenced; Ours preselect inventory and
admission-over-overlay stay TBD on both platforms. No product choice is
selected by these source findings.
