# Dev Loop Split State

## Goal

- Treat development mode as healthy only when the verified worktree Planner and
  worktree KWin controller are both live.

## Scope And Non-Goals

- Update only development-loop tooling and documentation.
- Do not change Planner or KWin controller source, and do not alter live
  shortcut or tiling behavior.

## Acceptance

- `dev-on`, `dev-off`, and `dev-status` make all four Planner/controller
  combinations explicit.
- A verified live Planner with an unloaded controller is safely recovered
  without starting another Planner or modifying its prior receipt.
- A loaded controller with no Planner is never used to load a duplicate.
- Existing identity and rollback protections remain intact.

## Approach

- Preserve the existing worktree process proof and exact KWin lifecycle helper.
- Add isolated coverage for the four-state guard behavior, then run the
  prescribed formatting, dry-run, and lifecycle test checks.

## Outcome

- `dev-on` now treats only a verified worktree Planner plus a loaded controller
  as up. It recovers Planner-only state with a fresh receipt after confirming
  the same D-Bus owner and start identity, and refuses controller-only state.
- `dev-off` tears down either half independently without stopping an already
  unloaded controller or killing an absent/unverified Planner. `dev-status`
  reports the combined `UP`, `DOWN`, `SPLIT`, or `UNKNOWN` state.
- Isolated four-state coverage passed (`72` checks); `start-test.test.sh`
  passed `399` checks; just formatting, list, and dry-runs passed.
- The authorized recovery retained Planner PID `56802`, loaded script `0`, and
  recorded build `controller-v1-bd36a770b3b05f921ab8dbddd7aef2464732481548ea4c71ecea307b8cf319aa`.

## Unload Investigation

- The original unload is undetermined. KWin PID/start identity stayed stable,
  and neither bundle nor `kwinrc` changed during the observed interval; no
  journal evidence attributes a scripting reset, exception, or explicit unload.
  KWin 6.7.4 lacks the public lifecycle enumeration needed to reconstruct the
  actor. A future authorized observation must capture before/after loaded state,
  exact Script object presence, and KWin identity after each action.
