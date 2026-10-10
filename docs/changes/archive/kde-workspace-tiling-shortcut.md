# KDE workspace-tiling shortcut default

## Goal and acceptance

- Deliver user decision 10 (2026-10-10): default `Meta+Y` for the existing per-workspace toggle on KDE, matching COSMIC `ToggleTiling`; every other currently-unbound action stays unbound.
- Align KWin registration, native/KCM catalog, presets, shortcut docs and default-set assertions. Check stock Plasma 6 conflicts without changing the selected key.
- Windows code is outside scope; keep `Win+Y` handoff item 21. Physical delivery, existing-assignment/restart persistence and live preset acceptance stay user-owned.

## Approach and bounded units

1. Worker implementation and static conflict investigation; offline canonical gates.
2. Lead diff/evidence inspection and spec/decisions/backlog reconciliation.
3. Independent Worker review of the shortcut catalog/public contract and conflict evidence; publish after resolving findings, then check CI.

## Accepted evidence and outcome

- KWin registration uses `Meta+Y`; native catalog adds the previously omitted action. Native catalog now has 129 rows: 93 bound and 36 unbound. Registration count stays 129. Known stock conflict table remains 23 rows.
- Stock KWin 6.7.5 source and installed global-shortcut desktop entries show no Meta+Y holder; third-party/user assignments can differ. Sources are in [the conflict record](../kde-shortcut-conflicts.md#workspace-tiling-toggle-default-metay-user-2026-10-10).
- `npm run typecheck` and `npm test` pass: bundle validation plus 1,308 tests, 188 suites, zero failures.
- `just build-native-effect` passes under `-Werror`; testing-enabled native build and CTest pass 32/32. The production recipe sets `BUILD_TESTING=OFF`, so CTest evidence requires freshly built testing-enabled binaries. Two native cases exposed stale 128-row status expectations on the first fresh run; those assertions were corrected before the green run, with no product behavior or oracle change.
- `cargo test --workspace --offline` passes: 1,327 tests, zero failures; Rust changes are tray comments only. Strict workspace clippy, fmt and `just check-portable` pass.
- Logs inspected under `/tmp/opencode`: `kwin-npm-test.log`, `kwin-typecheck.log`, `native-ctest.log`, `cargo-test-workspace.log`, `cargo-clippy.log`, `cargo-fmt.log`.
- Independent review accepted implementation, action-name tray routing and static conflict evidence. Reconciled the spec's stale aggregate counts, archived this record to its linked location, and clarified the new test's Compatible variable name; fresh native CTest passes 32/32 after that rename.
- KDE piece delivered offline; physical/existing-assignment/restart/preset acceptance is in [Pending live checks](../../backlog.md#pending-live-checks) and [the user-owned procedure](../../live-shortcut-override-verification.md#pending-workspace-tiling-default-metay). Windows `Win+Y` remains handoff item 21. No product questions or live KWin test. Hosted CI is checked after push and reported in the session handover.
