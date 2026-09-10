# Just Dev Loop

## Goal

Provide one-word `just` recipes for the documented worktree Planner and KWin
script development loop without obscuring which runtime components are active.

## Scope And Non-Goals

- Add `just` to the devenv package set and provide `dev-on`, `reload`,
  `dev-off`, and read-only `dev-status` recipes.
- Use the existing controller ownership receipt for the script ID and bind
  cleanup only to the recorded worktree Planner PID.
- `reload` swaps only the worktree Planner. It never reloads the KWin script.
- No live lifecycle command, shortcut, physical smoke test, installed Planner
  masking, Nix store resolution, or KWin script unload/reload is run here.

## Acceptance

- Preconditions fail closed with actionable diagnostics and `dev-on` preserves
  an already-running dev session.
- The Planner is detached with `setsid nohup`, and its PID is recorded for
  exact later termination.
- `dev-off` obtains the script ID from the generated controller receipt rather
  than accepting user input.
- Documentation leads with the recipes and retains manual commands as fallback.

## Approach And Dependencies

- Delegate one bounded implementation unit for the recipe shell logic,
  dependency declaration, documentation, and hermetic script test.
- Lead reviews all changed shell paths, updates the backlog, statically parses
  the justfile, records evidence, archives this change note, and commits.

## Verification

- `bash scripts/start-test.test.sh`.
- `just --list` and `just --dry-run` only; no recipe execution.
- Manual trace against `scripts/start-test.sh`, `dogfood-install.sh`, and the
  documented loop.

## Material Decisions And Accepted Evidence

- `reload` swaps only the Planner because a KWin script reload has a
  host-specific failed-unload recovery risk.
- The recipe creates one private per-run controller receipt directory with
  `mktemp -d` under `$XDG_RUNTIME_DIR`, passes its `ownership` path as
  `CONTROLLER_OWNERSHIP_FILE`, then reads `script_id` from that receipt.
- Planner state records PID, worktree executable, and `/proc/<pid>/stat`
  start identity. `reload` accepts the old worktree executable's exact
  ` (deleted)` suffix after Cargo atomically replaces it, but otherwise
  refuses identity drift.
- `bash scripts/start-test.test.sh` passed: 399 checks, 0 failures.
- `just --fmt --check`, `just --list`, and `just --dry-run` for all four
  recipes passed. Recipe lifecycle was not executed.

## Next Action

- None.
