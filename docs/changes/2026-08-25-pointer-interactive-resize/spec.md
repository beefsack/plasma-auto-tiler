# Specification: Pointer Interactive Resize

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-25 by user; Standard artifact creation approved by Orchestrator
- Commit/push: agent commits false; agent pushes false; user commit required; no staging before final completion; cleanup owner Lead; candidate preservation none unless triggered

## Intent and Desired Outcome

Recognize generic pointer interactive resize of a tiled window while preserving
KWin 6.7.4 as the sole owner of shared-divider selection, ratio and geometry
writes, neighbor reflow, minimum constraints, rounding, and final native state
after both Escape and release.

## Scope and Non-Goals

In scope:

- An isolated controller observation lifecycle for native tiled pointer resize.
- A separately accepted KWin 6.7.4 native-resize fixture contract.
- A separately accepted KWin 6.7.4 signal-contract fixture/harness before the
  reset-02 controller integration continuation.
- Static verification and later user-authorized live validation.
- Synchronizing the project KWin source-provenance declaration to 6.7.4.

Non-goals:

- A dependency on `interactiveMoveResizeStepped` for tiled resize.
- Controller geometry or ratio writes, cancellation inference or restoration,
  focus assignment, topology reconstruction, or reflow normalization.
- Pointer move/drop behavior, Steam-specific behavior, COSMIC work, live
  preview, and non-tiled resize behavior.
- Live work before separately authorized disposable/restoration layout and
  protocol.

## KWin 6.7.4 Contract

- KWin chooses the physical-edge shared divider, including matching-axis
  ancestor traversal and immediate multi-child sibling behavior.
- KWin owns Custom Tile relative geometry mutation, neighboring reflow, the
  normalized 15% minimum, padding, and rounded absolute geometry.
- Supported tiled resize does not emit `interactiveMoveResizeStepped`.
- Escape and release produce the same script-visible payload-free finish. Escape
  does not restore `Tile.relativeGeometry`; the controller retains the final
  KWin state without inference or restoration.

## Acceptance Criteria

- [ ] `R-00` records the version-pinned KWin 6.7.4 source contract.
- [ ] The `unit-01` fixture is independently accepted and models start, native
      tile mutation, no tiled stepped signal, finish, Escape final state, edges,
      corners, nested/multi-child dividers, floor, and rounding.
- [ ] Controller resize observation is isolated from move-drag state and makes
      no pointer-time or finish-time geometry, ratio, focus, or topology write.
- [ ] The signal-contract fixture/harness proves source-proven signal arity,
      deterministic subscription cleanup, and no fixture/production ownership
      crossover before controller integration.
- [ ] Fullscreen, floating, maximized, invalidated, workspace-changed, and
      output-changed paths clear or ignore resize observation without controller
      mutation.
- [ ] Static gates `R-01` through `R-09` pass with the recorded baselines and
      only canonical `kwin/contents/code/main.js` generated output.
- [ ] `L-01` records user-authorized KWin 6.7.4 live evidence for edge/corner,
      nested/multi-child, floor, Escape final-state, and scope-guard behavior.

## Constraints and Residual Risks

- Static fixtures cannot prove actual pointer grab/release/Escape delivery,
  backend geometry-notification timing, client acknowledgement, or output
  invalidation timing.
- The behavior is version-pinned to KWin 6.7.4. Future KWin upgrades require
  contract revalidation.
- The live runner does not restore Custom Tile geometry. Live validation needs a
  disposable layout or user-approved restoration boundary.
- User approved an exceptional second changed-kind reset on 2026-08-25. It does
  not relabel the parked `unit-02` correction or repair and does not clear the
  recorded no-progress streak. One separately approved semantic dispatch may
  establish the signal-contract criterion; any failure parks the change.
