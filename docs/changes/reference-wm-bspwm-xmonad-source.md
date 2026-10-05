# bspwm and xmonad source reference outcomes

## Goal and scope

- Assess all 58 bspwm cells, then all 58 xmonad cells against pinned source and explicit profiles.
- Preserve other columns, Ours, Variant, fixtures and product decisions. No live testing; existing upstream clones are read-only.
- bspwm HEAD is e11eff4cb3333216ad03c815609a4ed79e08929c (existing pin matches). xmonad HEAD is 284dd52c9c957cab6b6e5cc7580f2a63dafa00a7; replace the older a8055cd profile and evidence pins consistently.

## Acceptance and approach

- Sequential bounded muse-spark Workers source each column, followed by one independent review Worker per column.
- Source citations resolve to pinned repo:path:line keys. Unsupported actions, underspecified fixtures and native-only outcomes retain short reasoned TBDs.
- Decide an explicit xmonad-contrib profile from source if needed for well-defined directional/EWMH rows; clone via authorized SSH route only.
- Verify 12 consistent 14-column tables, unchanged row IDs/order and protected cells, citation resolution, source pins and git diff --check.
- Lead commits and pushes each completed column, staging intended docs only; never stage user-owned devenv.nix.

## Units and dependencies

1. bspwm sections 1-6, sections 7-12, independent review, Lead verification and commit/push.
2. xmonad profile and sections 1-6, sections 7-12, independent review, Lead verification and commit/push.
3. Final accounting and archived outcome.

## Current evidence

- Baseline main is 332afdc; sole initial worktree change is user-owned devenv.nix.
- Direct sequential Workers are the shallow topology; no nested delegation is needed.
- No rows added or profile extensions accepted yet.

## Accepted bspwm outcome

- All 58 rows assessed: 57 source-cited, one wholly TBD (R-WS-07, external switcher unspecified); 50 retain partial/full TBDs and eight contain no TBD.
- Pin/profile unchanged. Source establishes second-child insertion, no-target swap no-op, vacant same-slot float/fullscreen restoration, sticky relocation and full-state restart, cross-monitor directional swaps, and tiled hover-swaps without Escape cancellation.
- Existing incorrect R-OUT-01 transfer interpretation corrected to cross-output swap under the recorded profile. R-DRAG-01's floating-only claim corrected to tiled hover-swap. Other previously partial cells gain source qualifications; no product decision changes.
- Independent review passed after adding the close-request function citation and tightening the zero-motion drag mechanism. No unresolved findings.
- Lead read-only integrity check passed: 12 14-column tables, 58 unchanged IDs/order, all non-bspwm cells/profiles/register/prose preserved against 332afdc, all citation keys resolve and bspwm evidence pins/ranges are valid. git diff --check passes. No live testing or new rows.

### bspwm residual TBD accounting

- IDs omit R-. Each cell grouped once by primary unresolved reason; source policy remains established in mixed cells.

| Reason | IDs |
|---|---|
| Unsupported action/state/producer | WS-03, WS-06, FLT-04, FLT-06, GRP-01, MAX-01, MAX-03, START-01..02, CTL-04, DRAG-03 |
| Owner-specific controls | CTL-01..03, CTL-05..07 |
| External switcher unspecified | WS-07 |
| Binary embedding/anchor/history tie | MOV-03, FLT-03, FLT-11, WS-04, CLOSE-02 |
| Geometry/frames/hover/native focus | INS-01, MOV-04, WS-01..02, WS-05, FLT-01..02, FLT-10, OUT-01..02, DRAG-01..02, DRAG-04, DRAG-06..08, CLOSE-01, MAX-02, MAX-06..07 |
| Native acknowledgement/restart/minimum journey | MAX-04..05, FLT-05, MIN-01..03, START-03 |
