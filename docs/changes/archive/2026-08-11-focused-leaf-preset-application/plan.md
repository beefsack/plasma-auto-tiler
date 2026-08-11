# Plan: Focused-Leaf Preset Application

Status: completed and archived on 2026-08-11. Governing scope:
[specification](spec.md).

## Approach

Use the accepted preset compiler and guarded executor against an explicitly
resolved focused leaf. Keep scope/occupancy discovery in the controller and
make the realization input an ordered occupant collection.

## Work Units

| ID | Status | Scope | Verification |
|---|---|---|---|
| unit-01 | Accepted 2026-08-11 | Controller actions, scoped occupancy preflight, preset realization, tests, bundle. | Focused tests; `npm run typecheck`; `npm run build`; `npm test`; SHA-256. |

## Acceptance Evidence

| Criterion | Evidence |
|---|---|
| Registrations and preset selection | Exact twelve-action/default and all-or-nothing controller vectors. |
| Mapping and topology preservation | Columns, rows, and grid vectors assert focused root, pre-order split directions, and active-first ordinal management. |
| Safety contract | Malformed, duplicate, ineligible, scope-drift, singleton, split-failure, and assignment-failure vectors assert fail-fast private diagnostics. |
| Regression checks | `npm run typecheck` and `npm test` pass: 265 tests in 37 suites; generated bundle SHA-256 below. |

## Pending User Decisions

None.

## Residual Risk

Static tests cannot prove KWin's runtime `CustomTile.split()` behavior or tile
assignment semantics.

## Final Outcome

- The controller registers three focused-leaf preset actions and requires all
  twelve shortcuts to register successfully.
- It compiles an explicit active-first occupant set, executes only the focused
  CustomTile leaf, then assigns ordinal leaves with fresh identity and scope
  checks. Existing topology is neither rebuilt nor used to plan splits.
- Structural failures stop before assignments; assignment failures stop later
  assignments. Diagnostics are fixed private codes.
- `npm run typecheck` and `npm test` pass. The rebuilt IIFE SHA-256 is
  `733b8b7e55df1848d7c5608e580bb466f9b4d556e0fae273331eaddacb425594`.
