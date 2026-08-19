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

## 2026-08-19 (stage 3/4 scoping)

- Role / unit: Lead / (plan expansion)
- Result: new Lead took over stages 3-4 of this change under a separate
  Orchestrator directive that pre-approved the spec.md/plan.md semantic
  edits. Reconciled baseline: HEAD `4494b0d`, tree clean apart from the
  three permanently-untracked paths. Read `docs/decisions.md`,
  `docs/live-kwin-testing.md`, `scripts/dogfood-install.sh` (bounded
  windows), `scripts/dogfood-install.test.sh` (bounded windows, confirmed
  `FAKE_CMAKE_LOG` and the `DOGFOOD_*` test-override pattern),
  `kwin/native-effect/CMakeLists.txt`, `kwin/native-effect/metadata.json`,
  `README.md` structure. Added unit-03 (decisions.md amendment) through
  unit-07 (Stage 4 README) to plan.md; added Stage 3/4 scope, acceptance
  criteria, and two Consequential Decisions (plugin-ID single source of
  truth reusing `EFFECT_PLUGIN_ID`; `DOGFOOD_KWIN_DEV_CMAKE_DIR` test
  override) to spec.md.
- Files / commit: docs/changes/simple-install/{spec.md,plan.md,log.md} (not
  committed yet - planning only)
- Verification: n/a (planning artifacts only)
- Notes: confirmed the pinned KWin dev cmake path
  (`/nix/store/483vmk08g6bjaa3bvf3abn10cwpw6ap9-kwin-6.7.3-dev`) exists on
  this host today, so the Stage 4 conditional's "not exists" branch cannot
  be tested against real host state and needs the new test-only override.

## 2026-08-19 (unit-03)

- Role / unit: worker-anthropic / unit-03 / attempt-01
- Result: accepted first try. Applied the user-approved wording verbatim to
  docs/decisions.md's "Native Effect Live Validation" entry: Scope paragraph
  gained the `[Plugins]` kwinrc enablement-key clause after the
  kpackagetool6/kwriteconfig6/qdbus6 clause; Consequences paragraph gained
  the three governance-scope-widening sentences at its end. Re-wrapped only
  those two paragraphs to match the file's existing ~80-char hard-wrap
  style. Nothing else in the file changed.
- Files / commit: docs/decisions.md; commit `d35a727` (pushed)
- Verification: Lead read the full diff directly (`git diff docs/decisions.md`
  before commit, matched worker's report; `git log`/`git status` after
  confirmed the commit landed clean with no other file touched)
- Notes: none

## 2026-08-19 (unit-04)

- Role / unit: worker-anthropic / unit-04 / attempt-01
- Result: accepted first try. `scripts/dogfood-install.sh`: added
  `EFFECT_CONFIG_KEY="${EFFECT_PLUGIN_ID}Enabled"` plus a caution comment on
  the filename-derived plugin-ID fragility; `cmd_effect_install` now writes
  `[Plugins] plasma-auto-tiler-active-borderEnabled=true` via `kwriteconfig6`
  as its last mutation (no D-Bus call); `cmd_effect_remove` now reads the key
  via `kreadconfig6` and deletes it via `kwriteconfig6 --delete` only when
  present, counted toward `removed`; `usage()` text updated for both
  commands and the D-Bus/kwinrc-scope closing paragraph.
  `scripts/dogfood-install.test.sh`: fake `kwriteconfig6` extended
  additively with `--delete` support; new assertions on the existing
  effect-install/effect-remove scenarios; new static "plugin ID consistency"
  test reading `metadata.json`, `CMakeLists.txt`, and the script directly via
  grep/sed (no fake-tool harness), asserting all three agree and
  `EFFECT_CONFIG_KEY` is derived, not a second literal.
- Files / commit: scripts/dogfood-install.sh, scripts/dogfood-install.test.sh;
  commit `1aaf894` (pushed)
- Verification: Lead read the full diff directly (`git show HEAD` both
  files); independently re-ran `bash scripts/dogfood-install.test.sh` ->
  `passes: 331 failures: 0` (baseline 318/0, matches worker's reported
  count)
- Notes: no qdbus/D-Bus call added to effect-install/effect-remove, matching
  constraint; no autostart/.desktop/systemd file added

## 2026-08-19 (unit-05)

- Role / unit: worker-anthropic / unit-05 / attempt-01
- Result: accepted first try, plus one Lead follow-up fix. Worker corrected
  four passages in README.md: "One-command install"'s manual-steps list
  (collapsed from two items to one, added kwinrc-persistence explanation),
  "Native effect (dogfood)"'s loaded-state paragraph (two-things-involved
  framing, explicit not-yet-live-confirmed caveat), "Eyeball check"'s
  effect-status bullet (expects auto-load, treats non-auto-load as worth
  investigating), and "Scope of each command"'s effect-install/effect-remove
  bullet (kwinrc key write/remove, "never uses D-Bus" preserved). Every
  auto-load claim is worded as source-verified-but-not-live-confirmed,
  pointing at Eyeball check for user verification - never claimed proven.
  Worker correctly flagged one further stale sentence in the same section's
  narrative paragraph ("effect-install and effect-remove never touch KWin
  configuration or D-Bus") that was outside its exact brief; since the Lead
  had already loaded that exact passage during earlier scoping (corpus
  ownership forfeit), the Lead fixed it directly rather than a further
  dispatch.
- Files / commit: README.md; commits `20269ca` (worker, pushed) and
  `409e03a` (Lead direct fix-forward, pushed)
- Verification: Lead read the full diff of both commits directly; confirmed
  the env-script one-time-boundary paragraph and the "no further boundary"
  sentence were preserved verbatim as required; confirmed no claim of live
  verification anywhere
- Notes: none

## 2026-08-19 (unit-06)

- Role / unit: worker-anthropic / unit-06 / attempt-01
- Result: accepted first try. `scripts/dogfood-install.sh`:
  `KWIN_DEV_CMAKE_DIR` now reads `DOGFOOD_KWIN_DEV_CMAKE_DIR` (default
  unchanged); `cmd_effect_install` builds a `cmake_args` array and adds
  `-DKWin_DIR=` only when `[[ -d "$KWIN_DEV_CMAKE_DIR" ]]` - exactly one new
  conditional; `usage()` documents the new test-only override.
  `scripts/dogfood-install.test.sh`: threaded `TEST_KWIN_DEV_CMAKE_DIR`
  through `reset_state`/`run_script` matching the existing override
  pattern; two new scenarios cover both branches (pinned path exists ->
  flag passed; pinned path absent -> flag omitted, build still succeeds).
- Files / commit: scripts/dogfood-install.sh, scripts/dogfood-install.test.sh;
  commit `9b9d63a` (pushed)
- Verification: Lead read the full diff directly (`git show HEAD` both
  files); confirmed `git diff devenv.nix` is empty; independently re-ran
  `bash scripts/dogfood-install.test.sh` -> `passes: 336 failures: 0`
  (baseline 331/0, matches worker's reported count)
- Notes: none
