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
- R-INS-05 accepted: reference TBD cells 9 -> 2; overall 1,025 -> 1,018.
  Eight cells updated, seven resolved. Independent actual-source verification
  confirmed floating-anchor paths, including bspwm longest-side wrapping of
  vacant F, xmonad stack retention, niri focus, and paneru unmanaged-float miss.
  Initial fill added geometry placeholders outside this row's Observe; removed
  them rather than expanding scope. Corrected qtile conditional admission,
  citation coverage, and a duplicated PaperWM prefix. Latest checks pass.
- R-INS-05 residuals: Hyprland unspecified pointer target; karousel host focus.
  No material approved-rule contradiction.
- R-WS-07 accepted: reference TBD cells 9 -> 3; overall 1,018 -> 1,012.
  Eleven cells updated. Eight prior TBDs resolved; two formerly bare
  owner-specific cells now explicitly retain unsupported PaperWM shell-switch
  and paneru host listing/activation TBDs. PaperWM has native live-alt-tab
  (correcting prior absence claim); listing depends on unpinned GNOME setting.
  Independent source verification sampled all inventories/listing paths and
  traced karousel's native all-desktops listing/activation at KWin 8438567a.
  New KWin key links raw pinned sources. No new approved-rule contradiction.
- R-WS-07 residuals: pre-existing COSMIC visuals/timing, PaperWM unpinned shell
  activation, paneru host listing/activation. Source-defined KWin policy is
  complete for this Observe; no extra physical-journey requirement added.
- R-ACT-01..02 accepted: reference TBD cells 11 -> 5 (5 -> 3, 6 -> 2);
  overall 1,012 -> 1,006. Seven cells updated, six fully resolved.
  Independent actual-source verification confirmed qtile/awesome activation,
  COSMIC retained workspace urgency on same-workspace focus, xmonad's
  out-of-profile urgency hooks, and KWin 8438567a native hint mark/clear.
  Karousel unsolicited activation stays timestamp-dependent, explicitly TBD.
  All new KWin citations link raw pinned sources. No material rule conflict:
  activation/urgency requirements remain OPEN.

## Context handover

- Six groups accepted; 44 net fewer reference TBD cells (1,050 -> 1,006).
  Forty-six prior TBD cells resolved; two previously owner-only cells now
  explicitly acknowledge unsupported outcomes. Reference identities 1,896,
  Ours TBD 169/316, and index variant TBD rows 20 remain stable.
- Latest evidence: independent verification per group; citation resolution,
  duplicate-key baseline, table columns, profile identities, complete Ours
  cells, unchanged approved rules, and whitespace checks pass.
- Residual classification is deliberately conservative: 53 reference cells
  explicitly marked live-only; 953 not yet exhaustively source-traced or
  classified (49 without source tags, 904 with partial policy evidence).
  A source tag alone does not prove the remaining leg is live-only.
- The largest named groups retain 260 TBDs: SPC-06..13 72, WS-15..21 43,
  MOV-09..13 35, WS-22..26 27, WS-02/04/05 26, RST-03/04 24,
  MAX-01 12, START-03 11, OUT-07 10. Their policies are sourced, but missing
  geometry, host behavior, and compound legs are not automatically settled.
- Processed groups retain 30 TBD cells. In particular qtile refocus and
  PaperWM post-minimize selected-window reinsertion need further source work;
  unavailable host sources and unspecified pointers/timestamps/fixtures must
  remain qualified, not guessed.
- No new material approved-rule contradiction found; approved deliberate
  deviations remain unchanged. Three user stashes remain reserved.
- Exact next action: source-fill R-INS-08 in insertion.md, with independent
  verification, then commit/push that group. Trace preselect inventories plus
  bspwm/i3/sway consumption before considering INS-04, OUT-06, or focus/close.
- Reproduce counts with `python3 /tmp/opencode/tbd-count-20261009.py`;
  cumulative invariants with `python3 /tmp/opencode/verify-reference-source-fill.py`
  (session base e0e0963). Temporary tools are not repository deliverables.

### Exact remaining row groups

All numbers below count reference cells containing TBD, not occurrences.
Prefixes expand to `R-<prefix>-<number>`; omitted rows have zero TBD cells.

| Prefix | Remaining rows (row: TBD cells) |
|---|---|
| ACT | 01:3, 02:2 |
| CLOSE | 01:6, 02:8, 03:4, 04:5, 05:4 |
| COL | 01:4, 02:1, 03:3, 06:1, 07:3, 08:3, 09:1, 10:1 |
| CTL | 01..07:12 each |
| DRAG | 01:10, 02:10, 03:11, 04:9, 05:8, 06:11, 07:10, 08:11 |
| FLT | 01:11, 02:11, 03:8, 04:8, 05:11, 06:11, 07:1, 08:3, 09:3, 10:5, 11:8, 12:6, 13:5, 14:3 |
| FOC | 01:5, 02:1, 03:5, 04:3 |
| GRP | 01:8, 02:5, 03:4 |
| INS | 01:9, 02:6, 03:4, 04:12, 05:2, 06:12, 07:4, 08:10 |
| LAY | 04:1, 05:1, 06:5 |
| MAX | 01:12, 02:9, 03:8, 04:8, 05:8, 06:11, 07:8, 08:5, 09:6 |
| MIN | 01..03:12 each |
| MNZ | 01:4, 02:6, 03:6 |
| MOU | 01:4, 02:5, 03:8 |
| MOV | 01:10, 02:4, 03:10, 04:5, 05:2, 06:7, 07:2, 08:4, 09:10, 10:7, 11:5, 12:9, 13:4 |
| OUT | 01:6, 02:5, 03:3, 04:1, 05:3, 06:11, 07:10 |
| RST | 01:6, 02:12, 03:12, 04:12 |
| RSZ | 01:5, 02:2, 03:2 |
| SPC | 01:7, 02:12, 03:12, 04:2, 05:4, 07:4, 08:11, 09:11, 10:11, 11:12, 12:12, 13:11 |
| START | 01:11, 02:11, 03:11 |
| WS | 01:7, 02:9, 03:7, 04:9, 05:8, 06:8, 07:3, 09:3, 10:1, 12:8, 14:3, 15:3, 16:2, 17:8, 18:10, 19:6, 20:9, 21:5, 22:6, 23:7, 24:2, 25:4, 26:8, 27:11 |
