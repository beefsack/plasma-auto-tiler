# Log: Simple Install (dogfood documentation + one-command setup)

Append-only. Append after a meaningful checkpoint: an accepted semantic unit,
verified partial result, blocker, pending user decision, unsuccessful host
attempt, context handover, semantic or governance change, independent review
finding, commit, or approved plan change. Each entry records timestamp, role
and work unit and attempt, result, changed files or commit, verification, and
any discovery, blocker, or required decision. No narration, copied output, or
speculation.

## 2026-08-19 (session start)

- Role / unit: Lead / (change setup)
- Result: created spec.md, plan.md, log.md under docs/changes/simple-install/
  per Orchestrator/user directive; baseline verified: HEAD 4a3c044, tree
  clean apart from the three permanently-untracked paths; existing script
  test suite baseline captured (281 passes, 0 failures, run directly by the
  Lead before any dispatch)
- Files / commit: docs/changes/simple-install/{spec.md,plan.md,log.md} (not
  committed yet - no code change)
- Verification: n/a (planning artifacts only)
- Notes: none

## 2026-08-19 (unit-01)

- Role / unit: worker-anthropic / unit-01 / attempt-01
- Result: accepted first try. README.md: added a loaded-state-does-not-
  survive-reboot paragraph right after the existing env-script-boundary
  paragraph (preserved verbatim); added a new "### One-command install"
  section before "### Install" documenting the `setup` subcommand end-to-end
  including the one-time logout/login and the standing per-reboot
  requirement; added one Eyeball-check bullet. docs/backlog.md:37 rewritten
  as one physical line to match host-dogfooding/plan.md Unit N's Final
  Outcome, prefix/link unchanged.
- Files / commit: README.md, docs/backlog.md; commit `dd5e28b` (pushed)
- Verification: Lead read the full diff directly (`git diff README.md`,
  `git diff docs/backlog.md`); confirmed accurate, preserves the true
  statement, only the two intended files touched
- Notes: none

## 2026-08-19 (unit-02)

- Role / unit: worker-anthropic / unit-02 / attempt-01
- Result: accepted first try. Added `cmd_setup` to
  scripts/dogfood-install.sh: direct (fail-fast, set -e-propagated) calls to
  `cmd_install`/`cmd_enable`; `( cmd_effect_install )` and
  `( cmd_effect_reload )` subshell-wrapped calls so a missing build
  toolchain or the expected first-run pending-boundary outcome never aborts
  the whole command; per-stage summary and "what remains manual" output;
  explicit `return 0`. Added `setup)` usage-text entry and case arm
  (matching existing pattern exactly). Extended
  scripts/dogfood-install.test.sh: added `setup` to the --help coverage
  assertions and the no-extra-arguments loop, plus 4 new scenarios (full
  success, cmake-unavailable graceful skip, effect-reload pending-boundary,
  install hard-failure), reusing existing fake-tool/state-marker mechanisms.
- Files / commit: scripts/dogfood-install.sh, scripts/dogfood-install.test.sh;
  commit `da12ffc` (pushed)
- Verification: Lead read the full diff directly (`git diff
  scripts/dogfood-install.sh`, `git diff scripts/dogfood-install.test.sh`);
  independently re-ran `bash scripts/dogfood-install.test.sh` ->
  `passes: 318 failures: 0` (baseline 281/0); independently ran `npm
  --prefix kwin run typecheck` (clean, both tsconfigs) and `npm --prefix
  kwin test` -> `tests 815 pass 815 fail 0` (unchanged from baseline)
- Notes: change complete; both units accepted, no circuit breaker trips, no
  out-of-scope files touched
