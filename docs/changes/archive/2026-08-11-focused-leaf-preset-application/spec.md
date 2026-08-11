# Specification: Focused-Leaf Preset Application

Status: completed and archived on 2026-08-11.

## Intent

Apply a selected compiled topology preset within the active tiled window's
occupied leaf, retaining all surrounding authored tile topology.

## Scope

- Register columns, rows, and balanced-grid actions with the stated defaults.
- Resolve the active scoped leaf and deterministic set of current scoped tiled
  occupants, then realize the preset only at that leaf.
- Assign occupants active-first then current leaf traversal order to ordinal
  leaves through guarded KWin seams.
- Add focused static tests, rebuild the bundle, and preserve private diagnostics.

## Non-goals

- Automatic reflow, replacement mode, ratios, configuration, persistence, UI,
  cross-scope migration, live KWin work, drag, and Esc behavior.

## Constraints

- All twelve shortcut registrations must succeed or the controller is inert.
- Preflight rejects malformed, duplicate, ineligible, or drifted occupancy
  before mutation. Splits and assignments fail fast without rollback claims.
- Diagnostics must use fixed private codes and disclose no scope or window
  identity. A singleton preset is valid without splitting.

## Acceptance Criteria

- [x] Exact action registrations and aggregate false gate cover all twelve.
- [x] Each action chooses its preset and uses the focused occupied leaf only.
- [x] Occupants map active-first and then deterministic leaf traversal order.
- [x] Preflight and split/assignment failures meet the stated safety contract.
- [x] Existing controller behavior, typecheck, build, and full tests pass.

## Decisions

- Overlay is applied inside the focused leaf, preserving surrounding topology.
- The application seam accepts explicit occupants so future strategies can
  supply another set without replacing realization.
