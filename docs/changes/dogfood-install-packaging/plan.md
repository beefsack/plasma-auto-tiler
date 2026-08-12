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
- [ ] unit-02 isolated shell coverage.
- [ ] unit-03 README and static verification.

## Pending User Decisions

- None.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Install and uninstall package path | Isolated test assertions for build invocation, copied package layout, and exact removal path. |
| Enable, disable, and status behavior | Fake `kwriteconfig6`, `kreadconfig6`, and `qdbus` logs plus isolated config assertions. |
| README quickstart and ownership disclosure | Lead review of `README.md` against the specified catalog and session-effect wording. |
| Throwaway-root prevalidation | Shell test uses `mktemp`, fake XDG roots, fake KWin tools, and verifies no host interaction. |
| Runtime prerequisites and static baseline | Isolated missing-tool assertions, README prerequisite review, and the specified typecheck, build, JavaScript, and shell test commands. |

## Residual Risks

- The commands require tools from the user's running Plasma session; mismatch or
  absence is reported before the relevant operation, while static tests exercise
  injected fake tools only.
- Static tests prove command construction and isolated filesystem behavior, not
  live KWin session effects. Live invocation remains explicitly outside scope.

## Final Outcome

- Implementation in progress.
