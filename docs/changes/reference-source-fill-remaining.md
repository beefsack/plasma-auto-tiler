# Remaining reference source fills

## Goal and scope

Reduce TBD reference cells in the reference-outcomes index and area files
using pinned source evidence and the existing citation conventions.
Documentation only; no live testing, source-checkout changes, or stash changes.
Unsupported or runtime-dependent outcomes remain TBD with their reason.
Approved project rules remain unchanged; material contradictions are reported.

## Acceptance and approach

- Recount TBD cells and triage source-determinable groups by expected value.
- Trace each selected group to the matrix's pinned revisions.
- Obtain an independent source re-verification sample from a separate Worker.
- Inspect diffs and citation/count integrity; commit and push each accepted group.
- Stop at live-only residuals or context handover, with exact remaining groups.

## Bounded units

1. Inventory and source-feasibility triage.
2. Descending-value source-fill groups, each followed by independent verification.
3. Final counts, residual classification, and handover.

Workers use muse-spark, one active at a time. The Lead owns this note.

## Evidence and outcome

- Initial tree clean at e0e0963; main tracks origin/main.
- Three user stashes present and reserved.
- Triage: 1,050/1,896 reference cells contain TBD (179 bare unknowns);
  Ours 169/316 and index variant rows 20 are counted separately.
- Largest requested groups mostly retain live/host-dependent legs after prior
  fills. Ranked candidates: R-INS-07, R-MNZ-01..03, R-RSZ-04, R-INS-05,
  R-WS-07, R-ACT-01..02, remaining move/focus/insertion/group inventories.
- Count command: `python3 /tmp/opencode/tbd-count-20261009.py`.
- R-INS-07 accepted: reference TBD cells 12 -> 4; overall 1,050 -> 1,042.
  Twelve reference cells updated; eight fully resolved, four partial.
  Independent verification sampled COSMIC/bspwm/xmonad/awesome/qtile and
  negative routing inventories, then niri/PaperWM completion. Reviewer found
  an undeclared qtile column-membership assumption; removed it and retained
  exact embedding TBD. No rule contradiction. Citation, identity, Ours,
  table-column, unchanged-rule, and whitespace checks pass at latest diff.
- R-INS-07 residuals: COSMIC unknown geometry, Hyprland pointer/geometry,
  qtile undeclared columns, karousel host focus/switch. No live claim.
- R-MNZ-01..03 accepted: reference TBD cells 25 -> 16 (rows 7 -> 4,
  9 -> 6, 9 -> 6); overall 1,042 -> 1,033. Twenty cells updated,
  nine resolved through exhaustive Hyprland/sway/xmonad request and verb
  inventories. Independent verification confirmed these paths and sampled
  qtile/PaperWM/karousel/paneru removal and reinsertion. First partial fill
  resolved no full cells; reviewer-directed deeper traces established the
  nine completions. No material rule contradiction or new consensus vote.
- Minimize residuals: host focus/frames and sole-workspace cleanup remain;
  qtile refocus bookkeeping and PaperWM selected-window-derived exact
  reinsertion are not yet exhaustively traced, not declared live-only.
- R-RSZ-04 accepted: reference TBD cells 8 -> 0; overall 1,033 -> 1,025.
  Eight exhaustive equalize inventories establish no in-profile counterpart;
  independent verification checked all eight and actively excluded internal
  normalization, single-target resets, and out-of-profile BSP verbs.
  No material rule contradiction. Latest integrity/whitespace checks pass.
- Next group: R-INS-05 inactive or floating admission anchor.
