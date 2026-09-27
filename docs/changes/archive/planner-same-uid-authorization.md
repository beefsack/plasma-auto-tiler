# Planner Same-UID Authorization

## Goal

Make Planner caller authorization usable on the session bus by accepting only a
caller whose D-Bus Unix UID equals the Planner process UID, and publish an
unauthorized request as a bounded in-band rejection.

## Scope And Non-Goals

- The Planner resolves the caller's unique D-Bus name through
  `GetConnectionUnixUser`; missing, malformed, failed, or differing UID data
  rejects closed.
- Only `DescribeFocus`, `DescribeMovement`, `DescribeResize`, and
  `DescribePointerResize` return a bounded rejection carrying `kind` rather
  than a D-Bus error reply. `EvaluateMove`, `DescribeAdvisoryPlan`, and
  `DescribeShadowProjection` retain D-Bus errors.
- No KWin bundle change, script lifecycle, Legacy fallback, or eligibility,
  scope, geometry, duplicate, retry, or refusal contract change is included.

## Acceptance

- Same UID accepts; a different or unavailable UID rejects closed.
- Process executable, PID/start-tick, boot ID, systemd parentage, wrapper-pair,
  cgroup, and pre/post owner revalidation no longer participate in Planner
  caller authorization.
- The four selected unauthorized request paths return JSON with
  `outcome: rejected` and bounded `kind`; the other three retain
  `PlannerError::Unauthorized`.

## Approach And Dependencies

- Keep the existing unique-name conversion and use the existing D-Bus proxy to
  read its Unix UID.
- Use a bounded fixed unauthorized rejection for the selected request routes;
  it never reflects untrusted request content.
- Add focused unit coverage for UID decisions and the in-band rejection.

## Verification

- Focused Planner service tests for same, differing, and unavailable UID data
  plus the unauthorized reply contract.
- Affected Rust module tests and changed-file clippy, distinguishing recorded
  pre-existing diagnostics.

## Material Decisions And Accepted Evidence

- The user approved same-UID session-bus authorization because process
  forensics add no guarantee beyond session-bus reachability and currently
  reject a valid KWin caller on this host.
- `devenv shell --impure -- cargo test --lib planner_service` passed 52 tests.
- `devenv shell --impure -- cargo clippy --lib -- -D warnings` passed with no
  diagnostics. `cargo fmt --check` passed after formatting the changed Rust
  file.

## Next Action

- Commit and push, then hot-swap only the Planner under the authorized live
  procedure.
