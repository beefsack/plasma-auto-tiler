# i3 and sway source reference outcomes

## Goal and scope

- Assess all 58 i3 cells, then all 58 sway cells in the reference matrix against pinned local source and recorded profiles.
- Preserve other columns, scenario fixtures, Ours, Variant and product decisions. No live testing; upstream clones are read-only.
- i3 HEAD is 903bcd518df32b0e055b17f5da3f988a0187fd3d; sway HEAD is 1652c54b73f67df17b7b4ab0b0f7048204aa8104. Existing matrix pins already match both.

## Acceptance and approach

- Use source evidence keys with pinned repo:path:line references; retain short reasoned TBDs for unsupported actions, incomplete fixtures and native-only outcomes.
- Sequential bounded muse-spark Workers assess insertion/move/workspaces, float/maximize/startup/close, groups/outputs/drag, and controls/minimums for each column.
- One independent source review per column before the Lead commits and pushes that completed column.
- Verify all 12 tables, row identities, protected cells, citation resolution, evidence accounting and git diff --check after final edits.
- Stage only intended documentation; never stage user-owned devenv.nix. Inspect status, diff and recent log before each commit; no hook skipping or force push.

## Units and dependencies

1. i3 bounded source units, independent review, Lead reconciliation and column commit/push.
2. sway bounded source units confirming shared reasoning in sway source, independent review, Lead reconciliation and column commit/push.
3. Final counts, corrections, divergence summary and archived outcome.

## Current evidence

- Baseline main is 4f82534; only initial worktree change is user-owned devenv.nix.
- Existing i3 evidence/profile already pin the full local HEAD; no repin is required.
- Direct sequential Workers provide the requested shallow topology; nested delegation is unnecessary.

## Accepted i3 outcome

- All 58 cells assessed at 903bcd51: 57 source-cited, one wholly TBD (R-WS-07, unspecified external Alt+Tab switcher); 19 have no TBD and 39 retain partial/full unknowns.
- New source fills cover all sections. Existing minimum cells clarified without changing their policy; the floating-focus register anchor was corrected from commands.c:1515-1542 (sticky) to :1292-1324 (directional focus). No previously established outcome reversed.
- Independent source review passed after withdrawing an unrelated-worktree scope finding and confirming that exactly two floats always cycle F->G regardless insertion order. No matrix correction was needed from review.
- Source distinctions: flat sibling swap, persistent single-child wrappers, no-follow workspace move, float-retained sends, 10px floating moves, no maximize/workspace float-toggle counterpart, and Escape-cancelled tiled drag.
- i3 drag producers remain conditional because the recorded profile does not select shipped config vs code defaults. No arbitrary binding choice was added.
- Lead verification: 12 14-column tables, 58 unchanged IDs/order, protected cells/profiles/register/prose identical (apart from whitespace around removed target keys), all citation keys resolve, git diff --check clean. No live testing or new rows.
- One temporary integrity-check implementation needed two mechanical fixes (ignore blank lines left by removed target register keys; restrict citation matching to S-/D- keys). Both checks now pass; no product or matrix workaround.
- Next bounded work: commit/push accepted i3 column, then source sway under shipped config.in with explicit sway file:line confirmation.
