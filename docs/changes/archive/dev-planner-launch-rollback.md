# Dev Planner Launch Rollback

## Goal

Make the development Planner launch identify its process from D-Bus ownership
rather than the asynchronous `setsid` launch PID, and restore packaged state
when `dev-on` fails after disabling it.

## Scope And Non-Goals

- Change only the `just` development recipes and their documentation.
- Preserve fail-closed exact worktree Planner, no `/nix/store`, bounded-wait,
  and start-identity guarantees.
- Do not change application or KWin script code.
- Do not execute `dev-off`, unload a script directly, or perform physical input.

## Acceptance

- `dev-on` and `reload` derive the Planner PID from the D-Bus name owner and
  verify exact executable, cmdline, and start identity before recording it.
- `$!` is never used as Planner identity, and an unverified process is never
  terminated.
- Any post-disable `dev-on` failure re-enables the packaged script, removes
  only this run's receipt and state, and only tears down resources this run
  positively proved it owns.
- Live `dev-on`, `dev-status`, `reload`, and `dev-status` pass, leaving dev
  mode up.

## Approach And Dependencies

- One implementation unit updates recipe lifecycle handling and documentation.
- One independent review unit assesses the ownership and rollback diff.
- The Lead verifies static commands, an isolated rollback failure, then the
  authorized live dev-on and reload sequence.

## Verification

- `bash scripts/start-test.test.sh`.
- `just --fmt --check`, `just --list`, and `just --dry-run` for every recipe.
- Isolated failure-path rollback and authorized host lifecycle observations.

## Material Decisions And Accepted Evidence

- `$!` is a launch hint only. The verified Planner identity comes from the
  D-Bus owner PID, exact worktree executable, non-Nix path, `planner-service`
  cmdline, and `/proc` start identity.
- In this shell, a harmless `setsid nohup sleep ... &` observation did not
  fork: the launch PID was the final process. The recipes still do not depend
  on that environment-specific result.
- Independent rollback review found no defects.
- An isolated scratch-worktree failure after receipt allocation re-enabled the
  fake packaged script and left neither a receipt directory nor dev state.
- `bash scripts/start-test.test.sh` passed: 399 checks, 0 failures.
- `just --fmt --check`, `just --list`, and `just --dry-run` for all recipes
  passed.
- Authorized live verification passed: `dev-on` recorded Planner PID `19408`
  and script ID `0`; `dev-status` confirmed name ownership by the worktree
  executable, loaded script, receipt, and inactive unit. `reload` replaced it
  with PID `19616`; the final `dev-status` confirmed ownership and recorded
  state moved to PID `19616` while script ID `0` remained loaded.

## Next Action

- None.
