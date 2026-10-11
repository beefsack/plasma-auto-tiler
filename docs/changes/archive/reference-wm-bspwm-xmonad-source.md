# bspwm and xmonad source reference outcomes

## Goal and scope

- Assess all 58 bspwm cells, then all 58 xmonad cells against pinned source and explicit profiles.
- Preserve other columns, Ours, Variant, fixtures and product decisions. No live testing; existing upstream clones are read-only.
- bspwm HEAD is e11eff4cb3333216ad03c815609a4ed79e08929c (existing pin matches). xmonad HEAD is 284dd52c9c957cab6b6e5cc7580f2a63dafa00a7; replace the older a8055cd profile and evidence pins consistently.

## Acceptance and approach

- Sequential bounded units source each column, followed by one independent review per column.
- Source citations resolve to pinned repo:path:line keys. Unsupported actions, underspecified fixtures and native-only outcomes retain short reasoned TBDs.
- Decide an explicit xmonad-contrib profile from source if needed for well-defined directional/EWMH rows; clone via authorized SSH route only.
- Verify 12 consistent 14-column tables, unchanged row IDs/order and protected cells, citation resolution, source pins and git diff --check.
- Publish each completed column, staging intended docs only; never stage the existing devenv.nix.

## Units and dependencies

1. bspwm sections 1-6, sections 7-12, independent review, verification and publication.
2. xmonad profile and sections 1-6, sections 7-12, independent review, verification and publication.
3. Final accounting and archived outcome.

## Current evidence

- Baseline main is 332afdc; sole initial worktree change is user-owned devenv.nix.
- Direct sequential units are the shallow topology.
- No rows added. xmonad profile extension and source outcomes accepted below.

## Accepted bspwm outcome

- All 58 rows assessed: 57 source-cited, one wholly TBD (R-WS-07, external switcher unspecified); 50 retain partial/full TBDs and eight contain no TBD.
- Pin/profile unchanged. Source establishes second-child insertion, no-target swap no-op, vacant same-slot float/fullscreen restoration, sticky relocation and full-state restart, cross-monitor directional swaps, and tiled hover-swaps without Escape cancellation.
- Existing incorrect R-OUT-01 transfer interpretation corrected to cross-output swap under the recorded profile. R-DRAG-01's floating-only claim corrected to tiled hover-swap. Other previously partial cells gain source qualifications; no product decision changes.
- Independent review passed after adding the close-request function citation and tightening the zero-motion drag mechanism. No unresolved findings.
- Read-only integrity check passed: 12 14-column tables, 58 unchanged IDs/order, all non-bspwm cells/profiles/register/prose preserved against 332afdc, all citation keys resolve and bspwm evidence pins/ranges are valid. git diff --check passes. No live testing or new rows.
- Committed and pushed as e6b71cc, Record source-proven bspwm reference outcomes.

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

## Accepted xmonad outcome

- Repinned core profile and all core evidence to 284dd52c9c957cab6b6e5cc7580f2a63dafa00a7 (2026-10-03). Added xmonad-contrib 5097a457e7a409bc9a7584dc5aa82b34c69d6dda (2026-10-03), cloned via SSH; existing clones remained read-only.
- Profile extends active Tall (one master, ratio 1/2) with Navigation2D windowGo/windowSwap, default layer-specific strategies, wrap False, plus ewmh/ewmhFullscreen default doFullFloat/doSink event hooks. No initial fullscreen manage hook or extra tab/sticky/maximize/workspace-toggle modules are assumed.
- All 58 rows assessed: 57 source-cited, one wholly TBD (R-WS-07, external switcher unspecified); 50 retain partial/full TBDs and eight contain no TBD.
- Tall can project H[A,B] and H[A,V[C,B]], despite having no user split-tree structure. Admission above B gives H[A,V[C*,B]]; upward swap from B in the three-window projection gives H[A,V[B*,C]]. Flat three-plus-child H and arbitrary nesting remain inapplicable.
- Other accepted distinctions: same-layer float navigation, sole-float move no-op, no-follow workspace shift, positional close refocus, float-map carry-over on restart, float-based protocol fullscreen, and raw floating mouse movement including zero-motion float-on-release and off-workarea retention.
- Independent review passed after correcting newcomer focus and sole-float miss behavior. Reconciliation caught and resolved a copied ratio assumption, false Tall fixture incompatibility, a swap/remove-reinsert mismatch, an answerable workspace-focus gap, a restart evidence gap, and contradictory off-workarea prose. Source traces and the final review confirm the corrected cells.
- Final float-source reconciliation distinguishes managed native geometry from admission-only centering and the full-screen error fallback; geometry, resize and restart citations now cover the complete relevant implementations.
- Previously sourced core insertion/shift/minimum policies were not reversed; minimum and admission cells now explicitly use the pinned, extended profile. No product behavior or decision changes.
- Final read-only integrity checks pass: 12 14-column tables, valid 3-column profile table, 58 unchanged IDs/order, all non-xmonad cells/profiles/register/prose preserved against e6b71cc, all citations resolve, target source pins/ranges valid, old a8055cd pin absent, git diff --check clean.

### xmonad residual TBD accounting

| Reason | IDs |
|---|---|
| Unsupported action/state/producer | INS-02, WS-03, WS-06, FLT-02, FLT-04..06, MAX-01, MAX-03, START-01..03, GRP-01, CTL-04, DRAG-03 |
| Owner-specific controls | CTL-01..03, CTL-05..07 |
| External switcher unspecified | WS-07 |
| Inapplicable Tall fixture/target geometry | MOV-01, MOV-03..04, WS-02, FLT-03, CLOSE-01..02, OUT-01..02 |
| Native frames/focus/placement/response | INS-01, MOV-02, WS-04..05, FLT-01, MAX-02, MAX-05..07, MIN-01..03, DRAG-01..02, DRAG-04..08 |

## Handover

- Sequential source units and one independent review per column completed using the direct topology.
- No new rows, live testing, product/decision edits or existing devenv.nix staging. The note is archived with the completed xmonad column.
- Backlog advancement: bspwm and xmonad reference source passes complete; preserve other reference columns and product decisions.
- Exact next action: none after the xmonad column publication.
