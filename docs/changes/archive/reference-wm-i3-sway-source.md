# i3 and sway source reference outcomes

## Goal and scope

- Assess all 58 i3 cells, then all 58 sway cells in the reference matrix against pinned local source and recorded profiles.
- Preserve other columns, scenario fixtures, Ours, Variant and product decisions. No live testing; upstream clones are read-only.
- i3 HEAD is 903bcd518df32b0e055b17f5da3f988a0187fd3d; sway HEAD is 1652c54b73f67df17b7b4ab0b0f7048204aa8104. Existing matrix pins already match both.

## Acceptance and approach

- Use source evidence keys with pinned repo:path:line references; retain short reasoned TBDs for unsupported actions, incomplete fixtures and native-only outcomes.
- Sequential bounded units assess insertion/move/workspaces, float/maximize/startup/close, groups/outputs/drag, and controls/minimums for each column.
- One independent source review per column before publishing that completed column.
- Verify all 12 tables, row identities, protected cells, citation resolution, evidence accounting and git diff --check after final edits.
- Never stage the existing devenv.nix. Inspect status, diff and recent log before each publication; no hook skipping or force push.

## Units and dependencies

1. i3 bounded source units, independent review, reconciliation and column publication.
2. sway bounded source units confirming shared reasoning in sway source, independent review, reconciliation and column publication.
3. Final counts, corrections, divergence summary and archived outcome.

## Current evidence

- Baseline main is 4f82534; only initial worktree change is user-owned devenv.nix.
- Existing i3 evidence/profile already pin the full local HEAD; no repin is required.
- Direct sequential units provide the requested shallow topology.

## Accepted i3 outcome

- All 58 cells assessed at 903bcd51: 57 source-cited, one wholly TBD (R-WS-07, unspecified external Alt+Tab switcher); 19 have no TBD and 39 retain partial/full unknowns.
- New source fills cover all sections. Existing minimum cells clarified without changing their policy; the floating-focus register anchor was corrected from commands.c:1515-1542 (sticky) to :1292-1324 (directional focus). No previously established outcome reversed.
- Independent source review passed after withdrawing an unrelated-worktree scope finding and confirming that exactly two floats always cycle F->G regardless insertion order. No matrix correction was needed from review.
- Source distinctions: flat sibling swap, persistent single-child wrappers, no-follow workspace move, float-retained sends, 10px floating moves, no maximize/workspace float-toggle counterpart, and Escape-cancelled tiled drag.
- i3 drag producers remain conditional because the recorded profile does not select shipped config vs code defaults. No arbitrary binding choice was added.
- Verification: 12 14-column tables, 58 unchanged IDs/order, protected cells/profiles/register/prose identical (apart from whitespace around removed target keys), all citation keys resolve, git diff --check clean. No live testing or new rows.
- One temporary integrity-check implementation needed two mechanical fixes (ignore blank lines left by removed target register keys; restrict citation matching to S-/D- keys). Both checks now pass; no product or matrix workaround.
- Committed and pushed as 4128bdf, Record source-proven i3 reference outcomes.

## Accepted sway outcome

- All 58 cells assessed at 1652c54b under shipped config.in: 57 source-cited, one wholly TBD (R-WS-07, unspecified external Alt+Tab switcher); 18 have no TBD and 40 retain partial/full unknowns.
- Shared tree reasoning confirmed in sway source, with sway file:line references throughout. No upstream clone/dependency addition or pin change required.
- Independent source review passed; reconciliation clarified the 10px zeroing bound vs MIN_SANE gap reservation, limited floating coordinate repair to output changes, and strengthened/narrowed the bare-Escape claim using keyboard dispatch and helper sources.
- Reconciliation also replaced undefined T notation with the existing S tabbed embedding and fixed promotion prose to say immediately before C (the tree outcome was already correct). No preexisting sway outcome was reversed; the column was initially all TBD.
- Differences from i3: floating focus uses center-axis geometry with opposite-edge wrapping, first-float sizing is centered half-width/three-quarter-height, both drag producers focus before begin, content-center drop swaps, titlebar hover can tabify, and bare Escape does not cancel the drag. i3 keeps floating-list navigation, stored geometry, modifier-before-focus, center move unless swap modifier, and key-press cancellation.
- Final review and integrity checks pass after the last edits: 12 consistent 14-column tables, 58 unchanged scenario IDs/order, all non-sway cells and other profiles/register/prose preserved against 4128bdf, all keys resolve, git diff --check clean.
- No rows added, live testing, product behavior/decision changes or user-owned devenv.nix staging.

## Residual TBD accounting

- IDs below omit the R- prefix. Grouping uses the primary unresolved reason once per cell; sourced policies remain valid in mixed cells.

| Primary reason | i3 IDs | sway IDs |
|---|---|---|
| Unsupported action/state/parameter | WS-03, WS-06, FLT-04, FLT-06, MAX-01, MAX-03, MAX-04, START-01..03, CTL-04 | Same |
| Owner-specific controls | CTL-01..03, CTL-05..07 | Same |
| External switcher unspecified | WS-07 | Same |
| Restart/carry-over journey unspecified | FLT-05 | Same (no process restart verb; reload is distinct) |
| Incomplete action/config/drop geometry | GRP-01, OUT-01, DRAG-01..03, DRAG-06 | Same, plus DRAG-04 hover/drop point |
| Native frames/response/focus/visuals | FLT-01..03, FLT-11, MAX-02, MAX-05..07, DRAG-05, DRAG-07..08, MIN-01..03 | Same |

## Handover

- Backlog advancement: requested i3 and sway reference source passes complete; all other reference columns and product decisions preserved.
- Exact next action for this change: none after the accepted sway column publication.
