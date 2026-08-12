# Plan: Dogfood Install Packaging

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-12 by Orchestrator

## Technical Approach

Add one narrowly scoped shell management interface with install, uninstall,
enable, disable, and status subcommands. It will build before installing; derive
normal destinations from `XDG_DATA_HOME`/`HOME`; and provide explicit roots for
tests. The enable/disable path will write the metadata-derived key through
`kwriteconfig6` then invoke KWin's verified `reconfigure` D-Bus slot. Runtime
tool-path variables will support hermetic fake executables for tests while normal
use discovers host Plasma tools, avoiding a devenv-pinned Plasma toolchain.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification |
|---|---|---|---|---|
| unit-01 | Add the package-management shell interface with runtime tool checks and injected tool-path support. | - | new `scripts/dogfood-install.sh` | Script syntax check; package build; isolated fake-root command checks. |
| unit-02 | Add isolated shell coverage for all subcommands in the established harness style. | unit-01 | new `scripts/dogfood-install.test.sh` | `bash scripts/dogfood-install.test.sh`; assertions confirm no real destination/config access and logged fake reconfigure calls only. |
| unit-03 | Write the root quickstart and run the full static verification set. | unit-02 | `README.md`, change log | `npm --prefix kwin run typecheck`; `npm --prefix kwin run build`; `npm --prefix kwin test`; `bash scripts/start-test.test.sh`; new shell test. |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Progress

- [x] unit-01 investigation: config key and reconfigure mechanism verified.
- [x] unit-01 implementation: management script and runtime tool checks.
- [x] unit-02 isolated shell coverage.
- [x] unit-03 README and static verification.

## Pending User Decisions

- None.

## Acceptance-Criterion Evidence

| Acceptance criterion | Reproducible command | Result |
|---|---|---|
| Install and uninstall package path | `bash scripts/dogfood-install.test.sh` | 108 passes, 0 failures (unit-03/attempt-02). |
| Enable, disable, and status behavior | `bash scripts/dogfood-install.test.sh` | 108 passes, 0 failures (unit-03/attempt-02). |
| README quickstart and ownership disclosure | Compare `README.md` against `scripts/dogfood-install.sh` and the `registerShortcut` calls in `kwin/src/controller.ts` | Corrected in unit-03/attempt-01: every shown command, the plugin id and destination, the prerequisite wording, the shortcut identifiers and sequences, and the session-effect wording were cross-checked against the script, metadata, controller registrations, and devenv prerequisites; this is source-verification only, not test coverage or live-host validation. |
| Throwaway-root prevalidation | `bash scripts/dogfood-install.test.sh` | 108 passes, 0 failures (unit-03/attempt-02). |
| Runtime prerequisites and static baseline | `bash scripts/dogfood-install.test.sh` (missing-tool cases); `bash -n scripts/dogfood-install.sh`; `npm --prefix kwin run typecheck`; `npm --prefix kwin run build`; `npm --prefix kwin test`; `bash scripts/start-test.test.sh` | Missing-tool cases pass within the 108 shell-test assertions (unit-02); script syntax passes at unit-01; `npm --prefix kwin run typecheck` exit 0 with both `tsconfig.json` and `tsconfig.test.json`; `npm --prefix kwin run build` exit 0 generating a 154.5kb `contents/code/main.js` in 9ms; `npm --prefix kwin test` exit 0 with 430 tests across 49 suites (430 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo) and its included start-test run 248 passes, 0 failures; `bash scripts/start-test.test.sh` 248 passes, 0 failures. |

## Residual Risks

- The commands require tools from the user's running Plasma session; mismatch or
  absence is reported before the relevant operation, while static tests exercise
  injected fake tools only.
- Static tests prove command construction and isolated filesystem behavior, not
  live KWin session effects. Live invocation remains explicitly outside scope.

## Final Outcome

- All work units (unit-01 through unit-03) are implemented and the full static
  verification set passes with the results recorded above.
- The change is not yet archived; acceptance and completion remain the Lead's
  decision.
