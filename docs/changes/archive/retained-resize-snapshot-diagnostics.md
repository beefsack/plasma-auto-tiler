# Retained Resize And Snapshot Diagnostics

## Goal

Fix retained-session keyboard resize and any statically identifiable
post-membership `snapshot-invalid` failure. Add opt-in Planner request/reply
logging for remaining snapshot diagnostics.

## Scope

- Trace and repair the KWin-to-Planner resize path with regression coverage.
- Enumerate and repair retained membership snapshot validation defects.
- Add a default-off Planner file log enabled by one environment variable.
- Preserve the one-line journal diagnostic contract.

## Non-goals

- Live KWin or Planner lifecycle changes.
- Reintroducing removed route, provenance, or Custom Tile machinery.

## Verification

- Required Rust, KWin, and dev-loop checks from the change request.

## Units

- Resize path investigation and implementation.
- Snapshot validation and verbose diagnostics investigation and implementation.

## Outcome

- Keyboard resize was already implemented end-to-end. Its unbounded wire
  `press_index` overflowed the COSMIC `(10 + 2 + 2 * press_index).min(20)`
  calculation; calculate in `u64` before the 20px cap. Regressions cover the
  policy and retained route at high `u32` indices. The adapter fingerprint is
  membership/focus only, so geometry application does not reset its repeat
  counter; successive same-chord callbacks advance it.
- A successful retained remove then admit followed by a well-formed move
  reproduces successfully. No retained membership inconsistency was found.
  `PLASMA_AUTO_TILER_PLANNER_VERBOSE=1` logs full request and reply JSON to
  Planner stderr, captured in the dev Planner log. `just dev verbose` sets
  that environment variable for its launch.
- Evidence: `cargo build`, `cargo test` (221 library tests plus all integration
  suites), `cargo clippy` (only pre-existing `tray_endpoint.rs:386` warning),
  KWin tests (375), typecheck, build, and dev-loop split test (152) pass.
