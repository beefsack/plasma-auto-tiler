# qtile and awesome source reference outcomes

## Goal and scope

- Assess all 58 qtile cells, then all 58 awesome cells from pinned source under explicit shipped-config profiles.
- Preserve other columns, Ours, Variant, fixtures and product decisions. No live testing; upstream clones are read-only. Never stage user-owned devenv.nix.
- Pins: qtile 83c697a5621306c3586efca31867efcfa0482e2d; awesome 0a5e50cf7ee214fae47159e0e976ab4a78d2ed4f.

## Acceptance and approach

- Sequential bounded muse-spark Workers assess sections 1-6 and 7-12, followed by an independent review Worker per column. Direct Lead-to-Worker topology requires no nested delegation.
- Confirm qtile's shipped Columns/Max profile. Select awesome's first shipped tiling layout for tiling scenarios and explicitly retain shipped defaults otherwise.
- Source citations resolve to pinned repo:path:line evidence keys. Unsupported actions, underspecified fixtures and native outcomes retain short reasoned TBDs.
- Verify table widths, unchanged row IDs/order and protected cells, citation resolution and source pins, plus git diff --check before each column commit/push.
- Lead owns this note and, by explicit user authorization, the final backlog update. No new rows unless a finding requires minimal discriminating coverage.

## Units and dependencies

1. qtile profile and sections 1-6; sections 7-12; independent review; Lead verification, commit and push.
2. awesome profile and sections 1-6; sections 7-12; independent review; Lead verification, commit and push.
3. Final accounting, archive this note, update the functional-spec backlog line, commit and push.

## Current evidence

- Baseline main: 548146d. Sole initial worktree change: user-owned devenv.nix.
- Both read-only source checkouts match the recorded pins and have clean worktrees.

## Accepted qtile outcome

- All 58 rows assessed and source-tagged; 54 retain partial/full TBDs, four have no TBD (MOV-05, FLT-07, OUT-01, DRAG-05). A source tag can evidence an unsupported primitive without establishing the requested outcome.
- Shipped default config confirmed: Columns initially, Max available. X11/Wayland differences are qualified in cells, including native maximize restore and owner restart support.
- Columns admits C above focused B in the right column (`H[A,V[C*,B]]`), uses column-local reorder/carry rather than arbitrary tree restructure, and does not directionally transfer across outputs. Float-origin layout focus walks tiles; floated targets are excluded.
- Maximize/fullscreen use floating states with fresh tiled re-admission. Shipped drag uses the floating tweak path; explicit tiled pointer-hit swapping is unbound. No tab-stack or workspace floating-layout toggle is in this profile.
- Independent review corrected native maximize restoration: X11 client unmaximize only echoes the property and leaves MAXIMIZED, so repress toggles it off; Wayland request drives state, so repress maximizes again. Review also closed an answerable insertion-order gap and tightened restart/drag evidence. Lead expanded shorthand paths for unambiguous citation checking.
- Lead integrity verification passed against 548146d: 12 14-column tables, 58 unchanged IDs/order, protected cells/profiles/register/prose identical, all citation keys resolve and target pins/ranges valid; git diff --check clean. No new rows or live testing.
- Committed and pushed as c32eb48, Record source-proven qtile reference outcomes.

### qtile residual TBD accounting

- IDs omit R-. Each cell grouped once by primary unresolved reason.

| Reason | IDs |
|---|---|
| Unsupported primitive/state | WS-03, WS-06, FLT-02, FLT-04, FLT-10..11, MAX-03, START-01..03, GRP-01, CTL-04 |
| Owner-specific control/switcher | WS-07, CTL-01..03, CTL-05..07 |
| Inapplicable stack/N-ary/nested fixture | INS-02, MOV-01, MOV-03..04, FLT-03, CLOSE-01..02 |
| Geometry/focus/native/backend journey | INS-01, MOV-02, WS-01..02, WS-04..05, FLT-01, FLT-05..06, FLT-08..09, MAX-01..02, MAX-04..07, OUT-02, DRAG-01..04, DRAG-06..08, MIN-01..03 |

## Accepted awesome outcome

- All 58 rows assessed and source-tagged; 53 retain partial/full TBDs, five have no TBD (MOV-05, FLT-07..09, DRAG-05).
- Shipped tags initially use floating; tiling scenarios explicitly select the first shipped tiling choice, suit.tile (layouts[2]). Other shipped defaults/rules retained. Local semantic directional focus/swap use bydirection; multi-output rows use global_bydirection. These APIs differ from shipped index-based bindings.
- Focus includes floating and tiled candidates. Tile is stateless master/stack over the global client list; newcomers append last, tag transfers retain list position, close/reopen appends a new client. Maximize/fullscreen exclude the client from tile allocation without a placeholder.
- Per-tag floating/tile layout selection implements workspace disable/enable: floating layout does not arrange or change per-client floating intent; tile recalculates eligible clients in retained list order, preserving intentional floats. No rectangle-based startup inference.
- Tiled mouse movement swaps on hover, with no stack join, pickup threshold or Escape cancellation. Mod4 and titlebar producers are source-qualified. Explicit floating state and client order persist; sticky is also restored through EWMH hint roundtrip, with native visibility/origin journey TBD.
- Independent review corrected Mod1 to Mod4, traced insertion/order and native maximize requests into core C, and completed sticky restart evidence. Lead reconciliation rejected an initial unsupported-enable interpretation (one semantic failed approach): a workspace-scoped action maps to per-tag layout.set, not a nonexistent global flag. Review then corrected START-01..03/FLT-04/MAX-03 consistently. No unresolved findings or causal harness repair.
- Lead integrity verification passed against c32eb48: 12 14-column tables, 58 unchanged IDs/order, protected cells/profiles/register/prose identical, citations resolve and target pins/ranges valid; git diff --check clean. No new rows or live testing.

### awesome residual TBD accounting

| Reason | IDs |
|---|---|
| Inapplicable N-ary/nested fixture | MOV-01, MOV-03..04, FLT-03, CLOSE-01, OUT-02 |
| Unsupported parameter/owner control/switcher | WS-03, WS-07, GRP-01, CTL-01..07 |
| Geometry/focus/native/identity-order journey | INS-01..02, MOV-02, WS-01..02, WS-04..06, FLT-01..02, FLT-04..06, FLT-10..11, MAX-01..07, START-01..03, CLOSE-02, OUT-01, DRAG-01..04, DRAG-06..08, MIN-01..03 |
