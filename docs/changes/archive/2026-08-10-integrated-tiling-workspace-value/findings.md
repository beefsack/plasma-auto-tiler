# Findings: Integrated Tiling and Workspace Value Audit - Product-Justification Verdict

## Amendment Status

- Status: amended unit-05 verdict, mechanically derived from the accepted
  reopened evidence. This replaces the pre-amendment provisional verdict for
  decision use; the provisional verdict is preserved as historical audit
  evidence in the prior version of this file and in `plan.md`.
- Unit: `unit-05/attempt-03`.
- Role: product-justification synthesis only. Sources: the accepted amended
  research evidence - `research/evaluation-rubric.md` (unit-01/attempt-02),
  `research/plasma-krohnkite-baseline.md` (unit-02/attempt-02),
  `research/cosmic-hyprland-comparison.md` (unit-03/attempt-02), and preserved
  `research/hands-on-validation.md` (unit-04, accepted) - plus the approved
  `spec.md` and `plan.md`. No
  `sustained-workload-validation` contact, no live session, no install, no
  configuration, no compositor, no test, no destructive action, no commit.
- Evidence date: 2026-08-10 (reopened research evidence); preserved unit-04
  evidence dated 2026-08-09.
- Boundary: applies the approved Decision Rules (rubric sections 8, 9, and 9.1)
  to the accepted matrix. This is NOT new evidence, NOT an architecture
  selection, and NOT a resumption or reinterpretation of sustained-workload
  validation. This unit edits only this file.

## Correction Trail (superseded, superseding, and unchanged)

- Pre-amendment provisional verdict (`unit-05/attempt-02`, accepted 2026-08-09,
  preserved): **narrow differentiated product**. It reasoned from the J1-J8
  matrix that the baseline had no evidenced high-frequency CB, that repeatable
  high-frequency MFs centered on multi-output, and that sustained-workload
  validation should stay paused pending the technical report's Phase 0
  benchmark.
- Superseding amendment and evidence: the user-approved 2026-08-10 amendment
  (spec/plan Amendment Status) added the structural-authoring/direct-placement
  workflow (J9-J10, D9.1-D9.6, D4.8-D4.11) and the bounded bspwm reference, and
  reopened units 01-03 and 05. The reopened accepted evidence supersedes the
  provisional verdict for decision use: unit-01/attempt-02 (D9 criteria,
  J9-J10 TS journeys, rubric 9.1 target-segment scoping), unit-02/attempt-02
  (baseline J9/J10 CBs, the X-06 single root limitation, the KWin Custom
  Tiling factual correction X-05), and unit-03/attempt-02 (COSMIC/Hyprland
  J9/J10 CBs, the bounded bspwm reference, the source-supported combination
  model X-10).
- Unchanged valid evidence, not re-derived: every J1-J8 cell classification for
  all four comparators; the empty companion set (baseline section 2.3); the
  multi-output MF evidence; the preserved unit-04 scoring, including COSMIC
  `autotile=false` as exactly ONE J1/D6.1 MF (hands-on Claim 3) and Krohnkite
  D4.1 per-output mis-keying as MF (hands-on Claim 1); Krohnkite D4.4 hotplug
  retained UK with K-16 risk evidence only (hands-on Claim 2); and accepted
  Q-A/Q-B evidence, thresholds, and unit definitions.
- Not carried forward: the provisional section 5 cost boundary citing the
  technical report's native binary plugin architecture. Step 4 below is applied
  from accepted audit evidence only, with no implementation language or native
  C++ architecture selected (spec non-goals).

## Non-Negotiable Synthesis Facts

- The baseline (stock Plasma 6.7.4 + Krohnkite fork 0.9.9.2, companion set
  empty) has no evidenced CB on any J1-J8 (universal) journey.
- The baseline has evidenced CBs on the target-segment (TS) journeys J9 and
  J10. All negative D9 cells in the baseline column trace to ONE common root
  structural-model limitation (X-06: the composed baseline has no functioning
  persistent authored region topology) except the distinct mechanism gap D9.3
  (no pointer drag-to-split placement). These are accounted once each; they are
  never counted as independent blockers per cell or per journey.
- The J9/J10 failure is source-established by construction (K-17, K-18, K-19,
  K-20; P-26, P-27), not inferred from the open KDE wishlist bug 466057. That
  bug corroborates the source-level absence of split-on-drop only (P-27).
- COSMIC `autotile=false` is exactly ONE J1/D6.1 MF (C-03, C-14, C-29; hands-on
  Claim 3). It is not tiling-workflow friction and is not double-counted in the
  other J1 cells.
- UK cells never become failures. No decision is built on an assumed failure:
  Krohnkite D4.4 hotplug stays UK (K-16 is risk evidence only), and stock D4.10
  stays UK overall.
- An integrated user-facing product is one coherent install/enable/configure
  package and is never asserted to be one literal KWin plugin.

## 1. Mechanical Score Table (rubric section 9 Steps 1-2)

Journey frequencies from rubric section 6: H = high, M = medium, L = low;
J9-J10 carry the TS modifier (high-frequency daily within the bounded
persistent-authored-layout target segment, rubric section 6). Cell entries are
the recorded most-severe evidenced classification per report section 3.1, with
the driving criteria named. UK never counts toward CB/MF.

| Journey | Freq | Stock Plasma | Krohnkite+Plasma baseline | COSMIC 1.5.0 | Hyprland v0.56.2 |
|---|---|---|---|---|---|
| J1 Onboard/enable | L/H once | MF (D2.1) | MF (D6.1, D6.2, D7.1) | MF (D6.1 enable friction only) | PD |
| J2 Daily launch/placement | H | UK (D1.6), MF (D2.1, D2.3) | UK (D1.6) | UK (D1.6) | UK (D1.6) |
| J3 Focus/relocate | H | UK (D1.5) | PD | PD | PD |
| J4 Mixed session | H | PD | MF (D8.3 manual override) | PD | PD |
| J5 Multi-output | H/M | MF (D4.5, D5.1) | MF (D4.1 per-output, D4.2, D4.5, D5.1) | MF (D4.5) | MF (D4.5, D5.1) |
| J6 Dock/undock/hotplug | M | UK (D1.6) | UK (D1.6, D4.4) | UK (D1.6) | UK (D1.6) |
| J7 Workspace lifecycle | M | UK (D1.5) | PD | PD | CB (D1.3, D1.4) |
| J8 Configure/tune | M | PD | MF | PD | PD |
| J9 Author persistent structure | TS | CB (D9.2, D9.5) | CB (D9.1, D9.2, D9.4, D9.5, D9.6 - one root limitation, X-06) | CB (D9.1, D9.2, D9.4, D9.5, D9.6) | CB (D9.1, D9.4, D9.5, D9.6) |
| J10 Direct placement, empty branches | TS | CB (D9.3, D9.5) | CB (D9.3, D9.5, D9.6 - one root limitation, X-06; D9.3 distinct) | CB (D9.5, D9.6) | CB (D9.5, D9.6) |

Notes:

- COSMIC J5: the comparator report's section 3.1 parenthetical lists D5.1
  alongside D4.5, but the COSMIC D5.1 cell itself is PD (its on-demand
  Workspaces overlay shows names/numbers per output, C-28/C-14); the COSMIC J5
  journey score stays MF, driven by D4.5 (no persistent per-output indicator in
  the default panel). The parenthetical does not change the journey score.
- Hyprland's J7 CB (D1.3/D1.4) is medium-frequency and comparator-side only; it
  is input to the Decision Rule but never a baseline determination. The
  D1.4-reinterpretation caveat in the comparator report section 8 is a Lead
  rubric-interpretation question, not an evidence change; the CB is retained
  under the accepted rubric.
- The J9/J10 rows for the Krohnkite baseline column are CB, but per the
  accepted root-limitation accounting (baseline section 3.1 J9 note, X-06) they
  constitute ONE structural blocker for the Decision Rule - the absent
  functioning persistent authored topology - plus the distinct D9.3 mechanism
  gap. J9 and J10 are not two independent blockers.

## 2. Step 3 - Baseline Coverage (rubric 9.1 scoping)

Step 3: coverage is "coherent" iff no high-frequency journey is CB and material
frictions are limited to medium/low-frequency journeys; "broken" iff at least
one high-frequency journey is CB. High-frequency includes universal H journeys
(J2-J5) and, per rubric 9.1, TS journeys (J9-J10) only when the evidence is
scoped to the target segment's documented normal workflow.

- General-market scan (J1-J8): the baseline has no high-frequency CB and no
  medium-frequency CB. High-frequency MFs sit on J4 (D8.3) and J5 (D4.1
  per-output, D4.2, D4.5, D5.1). J1's onboarding friction is an MF but is
  setup-time/once (L/H once), not high-frequency. The general-market baseline has
  no evidenced high-frequency CB, while evidenced material frictions remain on
  high-frequency journeys.
- Target-segment scan (J9/J10): the baseline is CB on both TS journeys (section
  1). Section 3 determines whether, per rubric 9.1, these make baseline coverage
  "broken" for the bounded product thesis.

## 3. Target-Segment Blocker Determination (rubric 9.1)

Rubric 9.1: a CB on a TS journey makes baseline coverage "broken" for the
bounded product thesis only when the evidence shows the failure occurs in the
target segment's documented normal (daily, not setup-time-only) workflow and is
not rescued by an undocumented step. Determination, applied mechanically to the
accepted evidence:

1. Failure in the documented normal daily workflow: the target segment is
   defined by users whose daily work depends on persistent authored layouts
   (spec "Scope and Non-Goals"; rubric section 6). J9 (author a persistent
   structure) and J10 (direct placement and empty-branch handling in a live
   task) are that segment's documented high-frequency (daily) journeys. The
   source evidence establishes by construction that the composed baseline cannot
   complete either journey through documented affordances: Krohnkite has no
   authored-topology model and its layouts derive geometry from the ordered
   window set (K-18, K-19), stock KWin's authored custom-tile trees are inert
   under Krohnkite's geometry control (K-20, X-06), and there is no preselect
   (D9.2), no split-on-drop (D9.3), no automatic placement into authored regions
   (D9.5), and no authored empty-branch semantics (D9.6). Because the mechanism
   is absent at every point in time, the failure is not setup-time-only: there
   is no configuration-time success that then persists into daily use. This is a
   workflow failure, not a severity unknown; the rubric's "daily, not
   setup-time-only" distinction is satisfied by the mechanism evidence.
2. No undocumented rescue in normal use: the only path to authored-structure
   control is a bespoke KWin script driving the tile scripting API (P-28), which
   is explicitly not part of the baseline's documented configuration. No
   documented configuration step makes the composed baseline deliver the
   workflow (K-20/X-06: the composition conflict is unresolvable through
   coherent built-in configuration). D7.1 (no manual rescue step in normal use)
   is therefore not satisfied by any documented rescue.
3. Evidence-backed, repeatable, never UK: all J9/J10 CB cells for the baseline
   carry direct evidence records (K-17, K-18, K-19, K-20; P-26, P-27; X-06) at
   the pinned versions. The failure is repeatable by construction (it recurs on
   every arrange).
4. No general-market claim and no feature-wishlist claim: this determination is
   scoped to the bounded persistent-authored-layout target segment only, not to
   general-market prevalence. The open KDE wishlist bug 466057 is used only as
   corroboration of the source-level absence of split-on-drop (P-27); it is not
   itself the evidence for any blocker.

Conclusion: J9 and J10 are repeatable target-segment blockers. Per Step 3 and
9.1, baseline coverage is **broken for the bounded product thesis** (the
persistent-authored-layout target segment); for the general market (J1-J8) the
baseline has no evidenced high-frequency CB, while evidenced material frictions
remain on high-frequency journeys. This is the condition that distinguishes
strong justification from narrow differentiated product (rubric 9.1: "a TS
journey CB that is ... rescued by a documented configuration step maps to
'narrow differentiated product', never to 'strong justification'"; no such
documented rescue exists here).

## 4. Composition Determination: Can Plasma + Krohnkite Deliver the Workflow?

No. The composed baseline cannot coherently deliver persistent structural
authoring and direct placement, and combining KWin Custom Tiling with Krohnkite
does NOT close the gap - it widens it:

- Krohnkite 0.9.9.2 provides no authored-structure model at all: Tile is a fixed
  master+stack shape, BTree rebuilds a balanced tree from window count on every
  apply, Columns is a one-axis strip with in-memory membership; there is no
  leaf-split operation, no preselect, and no serialization (K-18, K-19).
- KWin 6.7.4 Custom Tiling IS a genuine persistent authored topology - a
  recursive binary tree with both-axis arbitrary-leaf splits, serialized to
  kwinrc keyed by desktop id and output uuid, with retained empty regions (P-25,
  P-30; factual correction X-05).
- The two mechanisms conflict rather than compose: Krohnkite is unaware of KWin
  custom tiles (`shouldIgnore`/`shouldFloat`/`commit` never reference tiles and
  set `frameGeometry` directly), and on the next Krohnkite arrange a custom-tile
  window is snapped back to Krohnkite's layout geometry (K-20, K-05). The
  authored tree persists in config but is inert while Krohnkite runs (D9.4 CB).
  A coherent built-in configuration of the composed baseline therefore cannot
  satisfy the J9/J10 authored-structure workflow end to end (X-06).
- Closing the gap requires an integrated dynamic tiler that is authored-topology
  aware - a tiler that respects and extends the persistent custom-tile structure
  instead of overriding it - plus the three stock-level gaps (keyboard-directed
  insertion D9.2, pointer drag-to-split D9.3, automatic placement into authored
  regions D9.5). None of this is present in the stock components or in
  Krohnkite.

## 5. Step 4 - Product Plausibility (accepted evidence only)

Assessed from the gap semantics and the spec thesis that one installable and
enableable Plasma product may package multiple KDE components internally. No
implementation language or native C++ architecture is selected (spec non-goals).

- Persistent authored topology (D9.1, D9.4, D9.6): already native stock Plasma
  capability via KWin Custom Tiling - recursive both-axis arbitrary-leaf splits,
  structure independent of window ordering, explicit retention of empty regions
  (P-25, P-30). An integrated product does not need to replace Plasma to obtain
  this foundation; it needs to keep it functional under dynamic tiling.
- Composition conflict (X-06): the conflict is a tiler-unawareness gap (K-20).
  An integrated, tile-aware dynamic tiler that respects authored custom tiles
  rather than overriding their geometry is a plausibly closable gap within the
  KWin layer, without replacing normal Plasma behavior.
- Keyboard-directed insertion (D9.2): precedent mechanisms are source-evidenced
  in Hyprland (`layoutmsg preselect`, H-24) and in the bounded bspwm reference
  (`bspc node -p`/`-o`, manual insertion mode, B-04/B-08). These establish the
  mechanism as real and implementable.
- Pointer drag-to-split placement (D9.3): precedent mechanisms are
  source-evidenced in COSMIC (overview drag -> `TargetZone::WindowSplit` ->
  `drop_window`, C-37) and Hyprland (mouse-drag re-tile splitting the node
  closest to the cursor, H-26). KWin's absence is corroborated by open wishlist
  bug 466057 (P-27), but the closure plausibility rests on the accepted
  precedent mechanisms, not on the wishlist.
- Automatic placement preserving authored structure (D9.5): the bounded bspwm
  reference documents how insertion into receptacles/preselected regions places
  windows into authored regions without restructuring authored branches (B-05).
- One coherent install/enable/configure experience: the spec thesis is one
  user-facing installable and enableable Plasma product, possibly packaging
  multiple KDE components internally. The required capabilities (persistent
  custom tiles, dynamic tiling, preselect, drag-to-split, automatic placement)
  are KWin/tiling-layer mechanisms that one user-facing package can plausibly
  install, enable, and configure coherently. This does not require one literal
  KWin plugin, and no plugin architecture is asserted.

Step 4 conclusion: plausible. One coherent install/enable/configure experience
of an integrated Plasma product can plausibly close the target-segment
structural gap without replacing normal Plasma behavior.

## 6. Workflow Precedent and the Desired Combination

Valid workflow precedent, all source-evidenced at pinned versions:

- COSMIC 1.5.0: a shipped, coherent desktop surface (no separate tiling install
  in the journeys), per-workspace live binary tiling with automatic insertion,
  overview pointer drag-to-split (D9.3), output-bound workspace sets, dynamic
  workspace lifecycle, pinned-workspace persistence (C-04..C-09, C-37, C-39).
- Hyprland v0.56.2: keyboard-directed insertion via `layoutmsg preselect`
  (D9.2), mouse-drag target-directed splitting (D9.3), cross-monitor default
  focus/move (H-11..H-13, H-24, H-26).
- bspwm 0.9.12 (bounded structural reference only, rubric sections 2.3/3.5):
  the complete authored-structure model the D9 criteria describe - receptacles
  as retained empty leaves, keyboard preselection/manual insertion mode,
  automatic insertion schemes, and `wm --dump-state`/`--load-state` persistent
  saved topology (B-03..B-06). Its reference D9.3 is an explicit negative: no
  pointer-directed drag-to-split placement (B-02, B-08, B-09). No desktop-wide,
  multi-output, installation, workspace, indication, or broad lifecycle claim is
  derived from bspwm.

Why the comparators' absence of a single complete model is neither automatic
invalidation nor automatic differentiation:

- Not automatic invalidation: the target is a coherent combination of selected
  workflows, not a claim that any one reference implements the complete model
  (spec Consequential Decisions). Each comparator's partial mechanisms
  establish that the individual capabilities are real, implementable
  mechanisms; the Decision Rule is applied to the Plasma-product question, and
  comparator evidence feeds plausibility (Step 4) and guards against unsupported
  claims.
- Not automatic differentiation: the comparators' failure to deliver the full
  model does not by itself prove an integrated Plasma product will succeed. Step
  4 must be assessed from the gap's semantics and the integration thesis, not
  from comparator failure.

The desired combination that exceeds every individual reference: persistent
authored structure independent of window ordering (D9.4) + automatic placement
that preserves that structure (D9.5) + keyboard-directed insertion (D9.2) +
pointer drag-to-split placement (D9.3) + explicit empty-branch
collapse/retention semantics (D9.6) + correct multi-output behavior + one
coherent install/enable/configure package, preserving normal Plasma behavior.
No single reference delivers this combination: COSMIC lacks authored structure,
preselect, and authored empty-branch semantics (C-36, C-38, C-39); Hyprland
lacks authored structure and authored empty-branch semantics (H-25, H-27); the
bspwm reference lacks pointer drag-to-split and is not a desktop (B-02, B-09);
stock Plasma lacks preselect, split-on-drop, and automatic placement into
authored regions (P-26, P-27, P-29).

## 7. Multi-Output as Complementary Evidence

Multi-output remains a first-class product dimension (spec) but is now
secondary evidence for this verdict; the Decision Rule result is driven by the
target-segment structural blocker (sections 3 and 8). Supported advantages and
frictions are stated below and are clearly separated from UK cells. No
unsupported hotplug/recovery or authored-tree claim is made.

Supported multi-output advantages on the baseline:

- Stock Plasma 6.7.4 provides per-output per-desktop custom-tile trees (each
  `LogicalOutput` owns a `TileManager`, `m_rootTiles` keyed by desktop),
  PlacementTracker-based window preservation across output-layout changes, and
  per-output last-desktop memory (P-12, P-13, P-23, P-30).
- Krohnkite documents a multi-screen setup (Separate Screen Focus, screen-switch
  shortcuts, per-screen default layout) with per-surface layout state (K-03,
  K-09, K-10).

Supported multi-output frictions on the baseline (all MF, evidence-backed):

- D4.1 per-output mode: with Plasma 6.7.4's opt-in per-output virtual-desktop
  mode enabled and differing per-output desktops, Krohnkite 0.9.9.2 keys every
  surface against the active output's current desktop, so non-active outputs'
  real desktops are never arranged; upstream issue #37 documents focus-steal /
  stranded-window / no-source-re-tile consequences, with the fix only
  post-0.9.9.2 (K-15, X-03; hands-on Claim 1).
- D4.2 cross-output focus/move: directional focus and move are confined to the
  current output surface; crossing requires a user-bound KWin screen-switch step
  on every crossing (K-06, K-03).
- D4.5/D5.1 per-output indication: the shipped default panel (with its Pager)
  is primary-only, so at-a-glance per-output indication requires the documented
  per-output panel/Pager setup (P-19, P-24).
- D4.9 structural cross-output moves: a keyboard cross-output move of a
  custom-tiled window drops it from its tile and re-places it by the placement
  policy; only a Shift+drag drop re-assigns it. No authored position is
  preserved by Krohnkite (P-26, P-13; K-05, K-18).
- D4.10 structural persistence/recovery: stock is UK overall (session-restart
  window-to-tile assignment unestablished, inheriting D1.6); the baseline is MF
  (authored structure is inert under Krohnkite on restart) (P-25, P-30, P-12;
  K-19, K-20, X-06).
- D4.11 structural indication: authored structure is visible only inside the
  Tiling Editor overlay per screen; no persistent on-screen structural indicator
  exists (P-25, P-16).

UK cells, not converted into failure:

- D4.4 Krohnkite hotplug (J6): UK. Krohnkite handles `screensChanged` by arrange
  only, with no output-liveness logic; issue #43 is preserved as risk evidence
  for a stale-Output crash/mis-tile path fixed only post-0.9.9.2. No pinned
  integration test ran and no authorized observation occurred, so the end-to-end
  runtime outcome is unavailable, not proven (K-05, K-16; hands-on Claim 2).
- D1.6 session restore: UK for all comparators (Wayland client-side adoption
  unestablished, P-14/C-26/C-27/H-20).
- D7.2 repeated-action degradation: UK for all comparators (performance
  measurement is a spec non-goal).
- COSMIC/Hyprland D4.8-D4.11 are recorded OUT OF SCOPE for authored structure
  (neither supports authored structure; only the underlying live-tree model is
  recorded, C-40/C-41/H-28). No authored-tree multi-output capability is claimed
  for them.

## 8. Decision Rule Result (rubric section 9 Step 5)

**STRONG JUSTIFICATION, scoped to the approved persistent-authored-layout
target segment (J9/J10), not to the general market.**

- Step 3 is broken for the bounded product thesis: J9 and J10 are
  evidence-backed, repeatable target-segment CBs in the target segment's
  documented normal daily workflow, with no documented rescue (sections 2-3).
  This satisfies rubric 9.1's elevation condition (1) on a high-frequency
  journey (TS journeys count per 9.1).
- No undocumented rescue in normal use: D7.1 is not rescued by any documented
  step (section 3, point 2). This satisfies condition (2).
- Step 4 finds one coherent install/enable/configure experience of an integrated
  Plasma product plausibly closes the selected combined workflow without
  replacing normal Plasma behavior (section 5). This satisfies condition (3).
- Not "Insufficient value": the remaining differences are not preference or
  feature trivia; the target-segment structural blocker is a complete workflow
  failure with a plausible integrated closure.
- General-market scope is explicitly excluded: for J1-J8 the baseline has no
  evidenced high-frequency CB, while evidenced material frictions remain on
  high-frequency journeys (section 2), so this strong justification does not
  claim general-market prevalence or a universal high-frequency blocker.

## 9. Residual Unknowns and Reversal Assessment

| Unknown | Source | Can it reverse the verdict? |
|---|---|---|
| Krohnkite D4.4 hotplug end-to-end outcome (J6, UK; K-16 risk evidence only, hands-on Claim 2) | baseline section 5.3/5.4 | No. If a future authorized observation or runnable pinned test proved a failure, it would be a J6 (medium-frequency) MF or CB, which maps to the SAME or additional support, never away from strong justification (the strong result rests on the target-segment J9/J10 blockers). If resolved favorably, unchanged. |
| U04-7 observed behavior of the Krohnkite + custom-tile conflict on a live session | baseline section 5.4 | No. The conflict mechanism is source-established (K-20, X-06); observation would quantify degradation, not change the mechanism. Cannot make a nonexistent mechanism exist. |
| U04-8 observed friction of the J9/J10 daily workflow on the composed baseline | baseline section 5.4 | No. The blocker is established by construction (absence of the mechanism), not by measured severity; the target segment's daily workflow is defined by these journeys (rubric section 6). Observation cannot reverse the CB classification or the daily-workflow scoping. |
| Stock D4.10 session-restart window-to-tile assignment (UK overall) | baseline section 4 | No. A resolution reclassifies a stock multi-output cell (PD/MF); it does not touch the target-segment structural blocker. |
| D1.6 Wayland session restore (UK, shared by all comparators) | baseline P-14; comparator C-26/C-27/H-20 | No. A Plasma/app client-side behavior inherited by any integrated product; not a differentiator; resolution affects all comparators equally. |
| D7.2 repeated-action degradation (UK) | baseline/comparator section 5.3 | No. Performance measurement is a spec non-goal; the scoped performance path is the next gate's benchmark (section 11). |
| COSMIC U04-11 packaging-default override (UK) | hands-on Claim 3 | No. Affects only COSMIC's single J1/D6.1 classification; irrelevant to the Plasma-product decision. |
| Hyprland D1.4 reorder interpretation (CB vs PD) | comparator section 8 | No. Comparator-side only; a Lead reinterpretation would not change the baseline determination. |

No residual unknown can reverse the strong-justification verdict: it rests on
source-established mechanism absence (X-06, K-18..K-20), the definitional
daily-workflow scoping of the target segment, and evidence-backed Step 4
plausibility. No UK cell is converted into a failure, and no decision is built
on an assumed failure.

## 10. Acceptance-Criterion Evidence Map (spec `## Acceptance Criteria`)

| Acceptance criterion | Evidence |
|---|---|
| Versioned full-comparator comparison plus bounded bspwm reference | unit-01 rubric sections 2.3, 3.5; baseline report sections 1, 3, 4, 4A, 6; comparator report sections 1, 3, 4, 4A-4C, 6, 6.4 |
| Critical workflow gaps distinguished from isolated features | unit-01 rubric sections 5 D9, 8, 9, 9.1; this document sections 1-3 (J9/J10 CBs vs MF/PD/FT cells) |
| Structural-authoring workflow has evidence or explicit unknown for every element | unit-02 baseline section 4A (all D9.1-D9.6 classified); unit-03 comparator sections 4A, 4B (all classified; D9.3 bspwm = CB reference, explicit negative, U11 resolved); this document section 1 |
| Multi-output evaluated across every listed workflow | unit-02 baseline section 4; unit-03 comparator section 4; unit-04 hands-on Claims 1-2; this document section 7 (D4.1-D4.11 with UKs explicit) |
| Krohnkite/companion baseline not claimed to fail without evidence | unit-02 baseline sections 2.3 (empty companion set), 5.3 (UKs), 8; unit-04 hands-on Claim 2 (D4.4 UK retained); this document sections 1, 7 |
| Hands-on observations reproducible, non-destructive, environment recorded; unavailable checks explicit UK | unit-04 hands-on-validation.md (safety statement, evidence base, correction trail); no new runtime check authorized |
| Findings apply one Decision Rule and recommend the sustained-workload validation status | this document section 8 (strong justification, target-segment scoped) and section 11 (resumes narrowly; Q-A/Q-B preserved) |

## 11. Recommendation for Sustained-Workload Validation and the Smallest Next Gate

Decision Rule result: strong justification, scoped to the approved
persistent-authored-layout target segment (section 8).

- Smallest next product/technical gate: a scoped integrated-Plasma technical
  feasibility validation of the combined structural workflow - persistent
  authored topology + dynamic-tiling composition + keyboard-directed insertion
  (D9.2) + pointer drag-to-split (D9.3) + automatic placement preserving
  authored structure (D9.5) + explicit empty-branch semantics (D9.6) + one
  coherent install/enable/configure experience - confirming that Step 4's
  plausibility is deliverable without replacing normal Plasma behavior. This is
  the smallest gate that de-risks the target-segment thesis before broader
  investment; it is the technical report's Phase 0-style benchmark gate and
  selects no implementation language or architecture.
- Sustained-workload validation: **remains paused pending the proposed
  structural-feasibility gate**. The target-segment strong justification
  authorizes that gate rather than resuming sustained-workload execution. Full
  resumption of the broader sustained-workload program remains gated on that
  gate's outcome. Accepted Q-A evidence, the approved Q-B amendment,
  thresholds, and unit definitions are preserved unchanged and are not reopened
  by this finding.

## 12. Evidence Citations (recorded IDs and report sections)

Primary evidence records, all as recorded in the accepted research reports:

- Baseline (unit-02/attempt-02): K-03 README install/config/reboot/multi-screen;
  K-05 driver (configChanged unbound, screensChanged arrange-only); K-06 engine
  (per-surface focus/move, keepTilingOnDrag, no preselect); K-17 Columns drag;
  K-18 no authored topology (derived structures); K-19 memory-only stores;
  K-20 custom-tile unawareness (composition); X-06 single root limitation -
  Krohnkite tag 0.9.9.2 (commit 1d7fd742).
- Baseline stock Plasma: P-12 PlacementTracker; P-13 output add/remove; P-16
  indication surfaces; P-19 default panel primary-only; P-20 default centered
  placement; P-24 ShellCorona::addOutput (no panel on new outputs); P-25
  recursive persistent custom-tile tree; P-26 existing-tile Shift+drag and no
  split-on-drop; P-27 KDE wishlist bug 466057 (corroboration only); P-28 tile
  scripting API not baseline config; P-29 no auto-placement into tiles; P-30
  per-output per-desktop structural scope and persistence; P-31 unbound custom
  quick-tile actions - KWin tag v6.7.4 (commit 8438567a).
- Comparator (unit-03/attempt-02): C-04..C-09 output-bound workspaces and
  lifecycle; C-14 shipped keybindings; C-28 workspace indication; C-34/C-35/
  C-36 auto insertion and no preselect; C-37 overview drag-to-split; C-38
  live-tree, no serialization; C-39 auto placement into the live tree; C-40/
  C-41 per-output live-tree scope - cosmic-comp commit 81cd5fd. H-11..H-13
  cross-monitor focus/move; H-24 `layoutmsg preselect`; H-25 dwindle insertion
  semantics; H-26 mouse-drag splitting; H-27 live tree, no serialization; H-28
  per-workspace tree - Hyprland v0.56.2 (commit efb509937). B-02..B-06 bspwm
  receptacles/preselection/dump-load; B-08 shipped sxhkdrc (no pointer
  bindings); B-09 pointer actions (move/resize/focus only) - bspwm tag 0.9.12
  (commit c5cf7d3), bounded reference only.
- Preserved unit-04 (hands-on-validation.md): Claim 1 (Krohnkite D4.1 per-output
  mis-keying = MF, K-15/X-03); Claim 2 (Krohnkite D4.4 hotplug retained UK,
  K-16 risk evidence only); Claim 3 (COSMIC `autotile=false` = exactly one
  J1/D6.1 MF, C-03/C-14/C-29).

Research report sections used: rubric sections 5 (D9 operational semantics,
D4.8-D4.11), 6 (J9-J10 TS frequency), 8 (classification), 9 (scoring and
Decision Rules), 9.1 (target-segment scoping); baseline report sections 3.1
(journey status), 4A (D9 matrix), 6 (citation register); comparator report
sections 3.1, 4A, 4B (bounded bspwm), 4C (combination model), 6 (citation
register).

## 13. Risks and Blockers for the Lead

- The strong-justification verdict hinges on the rubric 9.1 determination that
  the J9/J10 failure occurs in the target segment's documented normal daily
  workflow (section 3). That determination is mechanism-based (the workflow
  cannot complete through any documented affordance at any time), not
  runtime-severity-based. If the Lead instead requires a measured runtime
  severity for 9.1 scoping (candidate U04-8), an authorized safe observation
  would be needed and the verdict would be pending rather than strong.
- The strong justification is deliberately scoped to the target segment; no
  general-market claim is made. Extending it to the general market would be an
  unsupported claim under this evidence.
- Hyprland D1.4 reorder (CB vs PD) remains a Lead rubric-interpretation question
  (comparator report section 8); it is comparator-side and does not affect the
  baseline determination, but the comparator row in section 1 reflects the
  accepted CB.
- No live-session interaction, installation, configuration, system change,
  sustained-workload contact, destructive action, or commit occurred. Only this
  file was edited.
