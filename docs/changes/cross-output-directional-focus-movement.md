# Cross-Output Directional Focus And Movement

## Goal

Restore the documented COSMIC output-edge behavior for `Meta+Arrow` focus and
`Meta+Shift+Arrow` tiled-window movement.

## Scope And Non-Goals

- Route directional focus at the output-axis edge to the adjacent output's
  active workspace and last-focused window.
- Route directional movement that reaches `MoveFurther` to the adjacent
  output's active workspace, retaining the existing transaction, ownership,
  acknowledgement, and verification fences.
- Preserve same-output movement, workspace-axis behavior, exception refusals,
  and fail-closed adjacency observation.
- Do not add shortcuts, live KWin mutation, workspace/output wrapping,
  uncertain-send recovery, or a new topology model.

## Evidence And Decision

- COSMIC Epoch 1.5.0, released 2026-07-29, pins `cosmic-comp`
  `81cd5fdbaa41c3973369ae85bccf829137836e20`. Its documented source evidence
  establishes output-edge `Focus` fallback to `SwitchOutput`, whose target is
  the target output's active workspace and last-focused window, and
  `MoveFurther` fallback to `MoveToOutput`; transfer re-inserts at the target
  tree's focused node or root and Move follows focus. See
  `docs/research/integrated-tiling-workspace-value/cosmic-hyprland-comparison.md`
  C-15 through C-18 and C-41 (lines 655-659 and 682), retrieved 2026-08-10.
- The user identifies S20-S23 as COSMIC observations: they establish crossing
  into an occupied or empty output, R1's no-cross precedence, and repeated
  internal movement before crossing
  (`docs/cosmic-move-conformance.md:61-65,373-405`). The pure replay model is
  reference-only, not those observations. Its occupied target has one leaf, so
  it does not distinguish whole-target-tree wrapping from focused-leaf
  insertion; COSMIC C-41 selects focused-leaf/root insertion for the untested
  multiwindow-target case.
- The user directed recovery of this bounded source-evidenced output-edge
  behavior. The durable decision is reconciled in `docs/decisions.md` with the
  bounded active `DescribePlan` contract selected here.

## Acceptance

- Output-axis exhausted focus selects the adjacent output's active workspace
  last-focused tiled window; unavailable, ambiguous, or empty targets refuse
  without mutation or focus fabrication.
- `MoveFurther` transfers the focused eligible tiled window through KWin 6.7.5
  `workspace.sendClientToScreen` using the exact target output object, then
  writes exact target desktop membership. It commits only after output,
  membership, geometry, and focus readback proves the planned result.
- Same-output directional behavior, workspace-axis fallthrough, full-screen,
  floating, maximized, sticky, topology, owner, and transaction safeguards
  remain unchanged.
- Targeted Rust and KWin adapter tests cover distinct output domains, current
  visible workspaces, focus entry, movement crossing, and existing no-cross
  guards; affected suites, type checks, and build pass.

## Approach

1. Trace the current one-domain focus request and local R4 movement route
   against the documented output-action semantics.
2. Extend the existing multi-domain Rust/adapter contracts to observe the
   adjacent output's current workspace, validate its target focus/root, and
   retain exact source/target identities across the current transaction fences.
3. Use the existing KWin per-output current-desktop surface for focus and
   transfer actuation, then add regression coverage for the documented behavior
   and failure boundaries.
4. Verify, reconcile the active decision, record outcome, and await
   Orchestrator backlog disposition before committing.

## Clarified Scope

- Current focus is single-domain and movement makes adjacency same-workspace,
  but the Session already owns domains keyed by `(output, workspace)` and the
  existing KWin surface reads and writes a desktop for an exact output. Adding
  target-domain identities, validation, and postconditions is ordinary bounded
  implementation within the selected Rust-authority/adapter architecture, not
  a new architecture decision.
- The correction scope is the source's default Vertical workspace layout:
  `Meta+Left` and `Meta+Right` cross horizontally adjacent outputs only after
  local focus/movement is exhausted. `Meta+Up` and `Meta+Down` retain current
  local behavior; directional workspace cycling is separate unimplemented
  source behavior and is not included. Transfer targets the adjacent output's
  currently active workspace, inserts beside its valid focused leaf or as its
  root, and follows focus. Missing, ambiguous, empty-for-focus, exceptional,
   or changed targets refuse before native action. This preserves S21's local
   perpendicular-wrap precedence and S20/S22/S23 crossing results.

## Outcome

- The active `DescribePlan` route validates complete two-domain evidence and
  applies cross focus without geometry or membership writes.
- R4 stages a transient canonical pair and returns `planned`; it does not
  structurally commit until exact `directional-move-ack` and
  `directional-move-verify` post-observation messages. The terminal boundary
  splits state back to canonical per-domain sessions.
- The KWin adapter uses public KWin 6.7.5 `workspace.sendClientToScreen`, exact
  desktop assignment, `outputChanged`, `desktopsChanged`, and active-window
  readback to follow once mover output plus exact desktop membership are proven.
  Full `frameGeometryChanged` readback still gates acknowledgement, verification,
  and commit, so an unsettled sibling cannot strand confirmed mover follow or
  relax the structural proof. It refuses/terminates on stale scope, timeout,
  wrong output, failed write, or incomplete proof, with no replay.
- Offline verification completed 2026-09-20: `git diff --check`,
  `cargo fmt --check`, `cargo test` (299 unit tests plus all integration
  suites), `npm --prefix kwin run typecheck`, `npm --prefix kwin run test`
  (805 passed, 0 failed), and `npm --prefix kwin run build` (496.0 kB bundle).
- No live KWin/Plasma test was run; public-slot JavaScript callability and
  rendered compositor behavior remain live-unverified.
