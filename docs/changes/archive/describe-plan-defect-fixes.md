# DescribePlan Defect Fixes

## Goal

Fix the reported admission-axis, focus application, shortcut ownership,
retained topology, and stale Planner dev-loop defects.

## Decisions

- Admission uses the focused target leaf geometry, or domain bounds for an
  empty tree. Exact squares stack top-to-bottom because the portable COSMIC
  rule maps a height tie to `Vertical`.
- Planner sessions are retained per domain. A binding or observation divergence
  discards retained state and rebuilds once; an ambiguous rebuild rejects.
- Focus plans never write geometry in KWin. Move key registrations already
  dispatch `op=move`; Meta-digit sequences remain owned by Plasma.
- `just dev-on` refuses a D-Bus Planner whose executable is `(deleted)` and
  directs the user to `just reload` rather than restarting it implicitly.

## Scope

- No cross-domain workspace movement protocol, live KWin mutation, dependency,
  or diagnostic-system changes.

## Verification

- `cargo build` passed.
- `cargo test` passed: 217 library tests and all integration suites.
- `cargo clippy` passed with the one pre-existing `let_and_return` warning at
  `src/tray_endpoint.rs:386`.
- KWin test, typecheck, and build passed: 375 tests, 0 failures.
- `bash scripts/dev-loop-split.test.sh` passed: 84 checks, 0 failures.

## Next Action

- None.
