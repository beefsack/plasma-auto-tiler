# Planner Deleted-Exe Identity

## Goal

Make the development-loop Planner identity guard tolerate Cargo's deleted inode
form without weakening process ownership verification.

## Scope And Non-Goals

- Change only `justfile` identity checks and `docs/dev-loop.md`.
- Cover `dev-on`, `reload`, `dev-off`, and audit read-only `dev-status`.
- Do not change Planner, KWin, lifecycle scope, or physical-input behavior.

## Acceptance

- The worktree `$BIN` and only its exact kernel-generated `$BIN (deleted)`
  form verify as the same executable.
- A normalized `/nix/store` path and any other executable path reject closed.
- Existing `planner-service` cmdline and start-identity checks remain required.
- Authorized reload replaces the stale Planner and leaves dev mode up.

## Approach And Dependencies

- Each lifecycle recipe uses one local helper that strips at most one exact
  trailing ` (deleted)` marker before enforcing non-Nix and exact-worktree
  identity.
- A configured `$BIN` ending in ` (deleted)` is rejected as ambiguous rather
  than treating a potentially real filename as a kernel marker.

## Verification

- Isolated guard truth table for plain, deleted, wrong, and Nix paths.
- `bash scripts/start-test.test.sh`, `just --fmt --check`, `just --list`, and
  dry-runs for every recipe.
- Authorized `just reload` then `just dev-status` and Planner log inspection.

## Material Decisions And Accepted Evidence

- `dev-on` used strict equality in its verifier, recorded-PID already-up
  guard, and D-Bus-owner already-up guard. `reload` used it in preflight and
  its verifier; `dev-off` used it before and after unloading the exact script.
  `dev-status` only reports the raw executable and had no identity comparison.
- Each mutating recipe now uses a local helper that removes at most one exact
  trailing ` (deleted)` suffix, rejects a normalized `/nix/store` path, then
  requires the normalized result to equal `$BIN`. Cmdline and stat start
  identity checks are unchanged.
- `$BIN` itself ending in ` (deleted)` rejects before `dev-on` can mutate and
  before `reload` or `dev-off` can touch a PID. This declines to guess whether
  a real filename is a kernel deletion marker.
- Isolated helper truth table passed: worktree plain and deleted forms accept;
  wrong, `/nix/store`, `/nix/store ... (deleted)`, double suffix, and ambiguous
  configured-BIN cases reject.
- `bash scripts/start-test.test.sh` passed: 399 checks, 0 failures.
- `just --fmt --check`, `just --list`, and `just --dry-run` for `dev-on`,
  `reload`, `dev-off`, and `dev-status` passed.
- Authorized `just reload` built current `d6bb014`, replaced stale PID `19616`
  with PID `56802`, and left the KWin script loaded. `just dev-status` showed
  `56802` owns `org.plasmaautotiler.Planner` with the plain worktree exe and
  recorded script ID `0`. Its new log contains
  `event=started:gen=local-dev:version=0.1.0:result=ok`.

## Next Action

- None.
