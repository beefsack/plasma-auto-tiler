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

- Pending verification.

## Next Action

- Verify, commit, push, and run the authorized Planner reload.
