# Plan: Simple Install (dogfood documentation + one-command setup)

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-19 by Orchestrator/user (directive gave exact
  scope and constraints; this plan's two work units and their split are a
  direct, non-consequential restatement of that scope)

Semantic sections - Technical Approach, Work Units, Pending User Decisions -
need Orchestrator approval before each edit. Record-keeping sections -
Progress, Attempt Accounting, Acceptance-Criterion Evidence, Residual Risks,
Final Outcome - are Lead-owned and edited directly.

## Technical Approach

Two independent, cleanly separable slices, matching the directive's Stage 1 /
Stage 2 split:

- **unit-01 (Stage 1, docs only).** Edit `README.md` and `docs/backlog.md`
  only. No script or test change. Verified by direct diff/content review
  (no live host action needed for prose accuracy).
- **unit-02 (Stage 2, script + tests).** Add one `cmd_setup` function plus a
  `setup)` case arm and usage-text entry to `scripts/dogfood-install.sh`,
  composing `cmd_install`, `cmd_enable`, `cmd_effect_install`, and
  `cmd_effect_reload` exactly as designed in `spec.md`'s Consequential
  Decisions (direct calls for the required half, subshell-wrapped calls for
  the optional native-effect half). Extend
  `scripts/dogfood-install.test.sh` with new cases in the existing fake-tool
  harness style. Verified by running the full existing + new test suite
  (`bash scripts/dogfood-install.test.sh`) against the throwaway
  `DOGFOOD_DATA_ROOT`/`DOGFOOD_CONFIG_ROOT` roots the harness already uses -
  no real host mutation.

No unit touches `kwin/src/controller.ts`, `kwin/tests/controller.test.ts`,
`devenv.nix`, `scripts/build-kpackage.sh`, or any file under
`docs/changes/trailing-empty-workspace/`.

Both units are dispatched to `worker-anthropic` - NEVER the bare `worker`
agent, which stalls the session on quota exhaustion - serially, unit-01 then
unit-02 (unit-02 does not depend on unit-01's content, but the process runs
exactly one subagent at a time regardless).

Commit protocol (standing-authorized this session, restated per unit): the
Lead commits and pushes directly after each accepted unit, conventional
commit subject only (no body), staging exactly the intended files - never
`git add -A`/`git add .`, and never `CMakeFiles/`,
`Project Technical Report and Implementation Plan.md`, or `test-output`.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification (static or live) |
|---|---|---|---|---|
| unit-01 | Fix README.md's native-effect reboot/logout persistence gap and README.md:279-283's misleading implication (preserving its true statement); document the full install process end to end including the one required logout/login; correct the stale docs/backlog.md:37 entry to match host-dogfooding/plan.md's Final Outcome (Unit N) | - | README.md, docs/backlog.md | static: Lead reads full diff against spec.md's Acceptance Criteria; no live host action |
| unit-02 | Add the `setup` subcommand to scripts/dogfood-install.sh per spec.md's Consequential Decisions (thin composition, graceful native-effect degrade, exit-0 on KWin-script-half success, explicit "what remains manual" summary); extend scripts/dogfood-install.test.sh to cover it | - | scripts/dogfood-install.sh, scripts/dogfood-install.test.sh | live (hermetic): `bash scripts/dogfood-install.test.sh` full pass, baseline 281/0, report new total; Lead reads full diff |

Only the Lead mutates plans and state. Semantic unit IDs are stable;
execution slices use `unit-<n>/attempt-<n>`.

## Progress

- [x] unit-01 Fix README.md and docs/backlog.md
- [x] unit-02 Add `setup` subcommand and its tests

## Attempt Accounting

No entries yet.

## Pending User Decisions

None.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| README.md plainly/prominently states re-`effect-reload` is needed after every reboot/logout-login | `README.md` "Native effect (dogfood)" section, new paragraph after the env-script boundary paragraph; commit `dd5e28b` |
| README.md:279-283 misleading implication corrected, true statement preserved | Same diff; original "no further boundary" sentence retained verbatim, new paragraph scopes it to env-script delivery and adds the loaded-state caveat |
| Full install process documented end to end including the one required logout/login | `README.md` new "### One-command install" section before "### Install"; commit `dd5e28b` |
| docs/backlog.md:37 matches host-dogfooding/plan.md Final Outcome (Unit N) | `docs/backlog.md` line 37 rewritten, one physical line, prefix/link unchanged; commit `dd5e28b` |
| New subcommand composes install/enable/effect-install/effect-reload, thin, no new install location/host-mutation category | `scripts/dogfood-install.sh` `cmd_setup` calls `cmd_install`/`cmd_enable` directly and `cmd_effect_install`/`cmd_effect_reload` unmodified inside `( ... )` subshells - no duplicated logic; commit `da12ffc` |
| Graceful degrade: KWin-script half completes and command exits 0 when native-effect half cannot run | `scripts/dogfood-install.test.sh` "cmake unavailable" scenario: `check_exit 0`, KWin script installed+enabled, effect stage reported skipped |
| Explicit "what remains manual" output | `cmd_setup` summary block; asserted via `assert_contains` in all three non-hard-failure test scenarios |
| Test suite covers success, degrade, pending-boundary, and install/enable hard-failure paths | `scripts/dogfood-install.test.sh` four new scenarios, `check_exit` 0/0/0/1 respectively |
| `bash scripts/dogfood-install.test.sh` passes in full | Ran directly by the Lead: `passes: 318 failures: 0` (baseline 281/0; +37, includes the two coverage-list additions plus 4 scenario blocks) |
| `npm --prefix kwin run typecheck` and KWin test suite unaffected | Ran directly by the Lead: typecheck clean on both tsconfigs; `tests 815 / pass 815 / fail 0` - unchanged from baseline, as expected since no file under `kwin/` was touched |
| Nothing out-of-scope touched | `git status --short` after both commits shows only the three pre-existing untracked paths plus this change's own directory; `git diff --stat` per commit confirms exactly README.md+docs/backlog.md (unit-01) and scripts/dogfood-install.sh+scripts/dogfood-install.test.sh (unit-02) |

## Residual Risks

- `scripts/build-kpackage.sh` (the `kpackage-distribution` artifact path) and
  `scripts/dogfood-install.sh` will keep diverging - the former packages a
  script-only KPackage artifact, the latter now also drives the native
  effect and this new one-command `setup` path. Not reconciled here per
  explicit out-of-scope instruction; flagged for a future change.
- Stage 3 (login autostart hook) remains the durable fix for the
  per-reboot/per-logout `effect-reload` burden this change only documents
  and reports on; it is explicitly blocked pending separate user approval
  and research, not attempted here.

## Final Outcome

- Accepted. Both units delivered first try, tested, committed, and pushed:
  `dd5e28b` (Stage 1 docs) and `da12ffc` (Stage 2 `setup` subcommand +
  tests). Full script test suite 318/318 (was 281/281); KWin typecheck clean
  on both tsconfigs; KWin test suite 815/815 unchanged. Nothing out-of-scope
  touched. Two residual risks recorded above, neither blocking.
