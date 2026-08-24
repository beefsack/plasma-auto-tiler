# Change Log

## 2026-08-24

- User approved Standard change-artifact creation for the COSMIC directional
  movement strategy, without implementation authorization.
- Created the approved specification and plan. Existing bspwm and Hyprland
  shortcut-profile references remain catalog-only and unchanged.
- Unit 01 attempt 01 is blocked pending reconciliation of the approved 347/0
  dogfood threshold with the observed 255/0 result. No correction was run.
- Unit 01 is accepted after a same-scope verification correction: the approved
  `scripts/dogfood-install.test.sh` gate reported 347 assertions and 0
  failures. No independent review was triggered.
- Unit 02 is accepted: the pure ordered-topology planner, focused
  corpus-referenced coverage, fail-closed validation, and static gates passed
  without runtime integration. No independent review was triggered.
- Unit 03 is blocked after its one correction and mandatory independent review.
  The review found empty-output R4, maximized guard, partial-swap recovery,
  duplicate-occupancy, and COSMIC-only-path defects; a changed-path reset is
  required before further implementation. Required command records were also
  incomplete.
- User approved the semantic reset without implementation authorization.
  Original `unit-03` is frozen permanently at attempts 1, corrections 1,
  reviews 1, breaker 1: the mandatory findings would require prohibited
  correction 2 and potentially review 2 on the same semantic unit.
- Preserved rejected candidate evidence in path-scoped stash
  `8578bbf4f0e4e953be8c0128506c051de863fe0f`
  (`rejected cosmic unit-03 candidate`) containing only the six approved
  candidate production, test, and generated paths. It is not an accepted
  baseline and will be read-only comparison evidence for replacements.
- Approved replacement dependencies: `unit-03a-runtime-transaction-safety`
  depends on `unit-02`; `unit-03b-cosmic-integration-closure` depends on
  `unit-03a-runtime-transaction-safety`; `unit-04` depends on
  `unit-03b-cosmic-integration-closure`; `unit-05` remains dependent on
  `unit-04`. One independent review is reserved for Unit 03A transaction
  safety only. No product or enduring governance change.
