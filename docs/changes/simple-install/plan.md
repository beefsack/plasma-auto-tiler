# Plan: Simple Install (dogfood documentation + one-command setup)

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-19 by Orchestrator/user (directive gave exact
  scope and constraints; this plan's two work units and their split are a
  direct, non-consequential restatement of that scope). unit-03 through
  unit-07 (Stage 3/4) were added the same day under a separate Orchestrator
  directive that pre-approved this plan edit.

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

**unit-03 (decisions.md amendment).** Apply the exact user-approved wording
to `docs/decisions.md`'s "Native Effect Live Validation" entry (Scope and
Consequences paragraphs) only. Per governance, a `docs/decisions.md` edit is
made by a delegated subagent after Orchestrator/user approval (already
given), never by the Lead directly. Its own commit, separate from any
feature commit.

**unit-04 (Stage 3, script + tests).** In `scripts/dogfood-install.sh`: add
`EFFECT_CONFIG_KEY="${EFFECT_PLUGIN_ID}Enabled"`, write it via
`kwriteconfig6` in `cmd_effect_install` and remove it in
`cmd_effect_remove`; add the plugin-ID-fragility comment at the
`EFFECT_PLUGIN_ID` declaration; update `usage()`'s effect-install/
effect-remove/scope-of-commands text to reflect the new kwinrc write. In
`scripts/dogfood-install.test.sh`: new scenarios for the key being written
and removed, and a new consistency test reading `metadata.json`,
`kwin/native-effect/CMakeLists.txt`'s `kcoreaddons_add_plugin` target name,
and the script's `EFFECT_PLUGIN_ID` literal, asserting all three (plus the
derived kwinrc key) agree.

**unit-05 (Stage 3, docs).** `README.md`: correct the "Native effect
(dogfood)" section's now-stale "re-run `effect-reload` after every reboot"
claim, state plainly what Stage 3 makes automatic (kwinrc-key persistence
once discovered) versus what remains manual (the one-time discovery
boundary; rebuild-then-reload for a live code change), and note live
session-start auto-load has not itself been user-verified. Update "Scope of
each command"'s effect-install/effect-remove bullet to reflect the new
kwinrc write (no longer "never touch KWin configuration").

**unit-06 (Stage 4, script + tests).** In `scripts/dogfood-install.sh`:
`KWIN_DEV_CMAKE_DIR="${DOGFOOD_KWIN_DEV_CMAKE_DIR:-<existing literal>}"`;
in `cmd_effect_install`, pass `-DKWin_DIR="$KWIN_DEV_CMAKE_DIR"` to `cmake`
only when `[[ -d "$KWIN_DEV_CMAKE_DIR" ]]` (exactly one conditional),
otherwise omit it. In `scripts/dogfood-install.test.sh`: cover both branches
via the new `DOGFOOD_KWIN_DEV_CMAKE_DIR` test-only override and the existing
`FAKE_CMAKE_LOG` mechanism.

**unit-07 (Stage 4, docs).** `README.md`: document the non-Nix build path
(distro KWin dev package, plain `cmake`, no `-DKWin_DIR`), honestly stating
the rebuild-every-Plasma-upgrade requirement and no-cross-distro-portability;
word unverified distro package names as "typically", not fact.

Every unit is dispatched to `worker-anthropic` - NEVER the bare `worker`
agent, which stalls the session on quota exhaustion - serially, one at a
time regardless of inter-unit dependency, per the process's one-subagent-at-
a-time rule. unit-04 and unit-06 both touch `scripts/dogfood-install.sh` and
`scripts/dogfood-install.test.sh`; unit-04 is committed and pushed before
unit-06 starts so unit-06 works from the already-committed unit-04 diff.

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
| unit-03 | Apply the user-approved `docs/decisions.md` "Native Effect Live Validation" amendment verbatim (Scope + Consequences paragraphs only) | - | docs/decisions.md | static: Lead diffs the file, confirms only the two intended paragraphs changed and wording is verbatim apart from wrapping |
| unit-04 | Stage 3 script+tests: write/remove `[Plugins] plasma-auto-tiler-active-borderEnabled` kwinrc key in effect-install/effect-remove; plugin-ID single source of truth, comment, and consistency test; usage() text update | - | scripts/dogfood-install.sh, scripts/dogfood-install.test.sh | live (hermetic): `bash scripts/dogfood-install.test.sh` full pass, report new total; Lead reads full diff |
| unit-05 | Stage 3 docs: correct README.md's stale "re-run every reboot" claim, state what is now automatic vs. manual, note live session-start auto-load is unverified; update "Scope of each command" | unit-04 | README.md | static: Lead reads full diff against spec.md's Acceptance Criteria |
| unit-06 | Stage 4 script+tests: conditional `-DKWin_DIR=` override (only when the pinned path exists), `DOGFOOD_KWIN_DEV_CMAKE_DIR` test override, both branches covered | unit-04 (same files) | scripts/dogfood-install.sh, scripts/dogfood-install.test.sh | live (hermetic): `bash scripts/dogfood-install.test.sh` full pass, report new total; Lead reads full diff |
| unit-07 | Stage 4 docs: document the non-Nix build path (distro dev package, plain cmake, rebuild-every-upgrade, no cross-distro portability); unverified distro names worded as "typically" | unit-06 | README.md | static: Lead reads full diff against spec.md's Acceptance Criteria |

Only the Lead mutates plans and state. Semantic unit IDs are stable;
execution slices use `unit-<n>/attempt-<n>`.

## Progress

- [x] unit-01 Fix README.md and docs/backlog.md
- [x] unit-02 Add `setup` subcommand and its tests
- [x] unit-03 Apply docs/decisions.md amendment
- [ ] unit-04 Stage 3 script + tests (kwinrc persistence)
- [ ] unit-05 Stage 3 README correction
- [ ] unit-06 Stage 4 script + tests (conditional -DKWin_DIR)
- [ ] unit-07 Stage 4 README (non-Nix build path)

## Attempt Accounting

No entries yet.

## Pending User Decisions

None outstanding. One acceptance criterion is permanently unverifiable by
this change without a user-run session boundary (see Residual Risks): live
session-start auto-discovery/auto-load of the persisted native effect via
the new kwinrc key. Recorded, not blocking implementation.

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
| docs/decisions.md amended verbatim, nothing else in it changed | `docs/decisions.md` diff: only the Scope and Consequences paragraphs of "Native Effect Live Validation" changed, new text verbatim; commit `d35a727` (pushed), separate from any feature commit |
| effect-install writes the kwinrc key; effect-remove removes it exactly; no autostart hook/`.desktop`/systemd unit | pending unit-04 |
| Plugin-ID single source of truth + comment + consistency test | pending unit-04 |
| README.md no longer states an unconditional every-reboot re-run requirement; states what is automatic vs. manual | pending unit-05 |
| Live session-start auto-discovery/auto-load recorded as unverified, not claimed proven | pending unit-04/unit-05; **unverified by design, needs a user-run logout/login this change cannot perform** |
| README.md documents the non-Nix build path honestly (rebuild-every-upgrade, no cross-distro portability, unverified distro names worded as "typically") | pending unit-07 |
| `-DKWin_DIR=` used only when the pinned path exists, via exactly one conditional; both branches covered in tests; devenv.nix unchanged | pending unit-06 |

## Residual Risks

- `scripts/build-kpackage.sh` (the `kpackage-distribution` artifact path) and
  `scripts/dogfood-install.sh` will keep diverging - the former packages a
  script-only KPackage artifact, the latter now also drives the native
  effect and this new one-command `setup` path. Not reconciled here per
  explicit out-of-scope instruction; flagged for a future change.
- **Live session-start auto-load of the persisted native effect is
  unverified.** `inv-03` established the kwinrc `[Plugins] <id>Enabled`
  mechanism against KWin source and out-of-tree precedent, but could not
  observe a real session start. This needs a user-run logout/login; until
  then, treat the persistence mechanism as correctly implemented per source
  research, not as live-proven. Do not claim it works from this change
  alone.
- The filename-derived plugin-ID linkage (CMake target name, `.so`
  filename, `metadata.json` `KPlugin.Id`, kwinrc key) has no structural
  single source of truth across files; a future rename that moves one
  without the others would silently break the kwinrc key despite the new
  consistency test catching it at test time (not at the point of the
  mistake). Flagged, not solved, per the spec's over-engineering
  constraint.

## Final Outcome

Stage 1/2 accepted and delivered: `dd5e28b` (Stage 1 docs) and `da12ffc`
(Stage 2 `setup` subcommand + tests). Full script test suite 318/318 (was
281/281); KWin typecheck clean on both tsconfigs; KWin test suite 815/815
unchanged. Stage 3/4 (unit-03 through unit-07) added 2026-08-19 and in
progress; final outcome for the whole change is recorded once all units are
accepted.
