# Log: Host Dogfooding (KWin Script + Native Effect)

Append-only. Append after a meaningful checkpoint: an accepted semantic unit,
verified partial result, blocker, pending user decision, unsuccessful host
attempt, context handover, semantic or governance change, independent review
finding, commit, or approved plan change. Each entry records timestamp, role
and work unit and attempt, result, changed files or commit, verification, and
any discovery, blocker, or required decision. No narration, copied output, or
speculation.

## 2026-08-18 (Lead dispatch start)

- Role / unit: Lead / plan / -
- Result: `plan.md` created with full A-G breakdown per Orchestrator
  approval; scope for this stint is Units A and B only.
- Files / commit: `docs/changes/host-dogfooding/plan.md`,
  `docs/changes/host-dogfooding/log.md`
- Verification: n/a (record-keeping)
- Notes: Confirmed via `man 5 environment.d` that environment.d files are
  read once at systemd user-manager start and support `${VAR:+...}` guarded
  expansion, informing Unit B's env-file format decision.

## 2026-08-18 (Unit A)

- Role / unit: Lead / A / attempt-1
- Result: accepted. Executed directly (material already loaded).
- Files / commit: `docs/decisions.md`, `docs/backlog.md` (uncommitted)
- Verification: `git diff` inspected; decisions.md matches Orchestrator text
  verbatim; backlog.md line 3 only line changed.
- Notes: none.

## 2026-08-18 (Lead resume after quota interruption)

- Role / unit: Lead / verify / -
- Result: Re-verified Unit A (decisions.md and backlog.md diffs re-diffed,
  confirmed still verbatim/correct) and re-checked Unit B host state
  (`~/.config/environment.d/` held only `10-home-manager.conf`; no staging
  root existed yet). Found `dogfood-install.test.sh` had zero functional
  tests for the four `effect-*` subcommands despite `dogfood-install.sh`
  already implementing them - plan.md's prior "both executed units
  completed first try" claim was inaccurate for B. Corrected plan.md attempt
  accounting.
- Files / commit: none yet (verification only)
- Verification: read `dogfood-install.sh` (457 lines) and
  `dogfood-install.test.sh` (737 lines) in full; ran existing test suite
  (178 pass, 0 fail) before dispatch.
- Notes: n/a.

## 2026-08-18 (Unit B, attempt 2)

- Role / unit: Lead (dispatched worker-anthropic) / B / attempt-2
- Result: accepted. Worker added functional test coverage for
  `effect-install`, `effect-reload`, `effect-status`, `effect-remove` to
  `dogfood-install.test.sh` (no changes to `dogfood-install.sh` itself - no
  bug found). Worker then ran `devenv shell --impure -- bash
  scripts/dogfood-install.sh effect-install` and `effect-status` for real on
  the host per standing authorization.
- Files / commit: `scripts/dogfood-install.test.sh` (uncommitted)
- Verification: Lead independently re-ran `bash
  scripts/dogfood-install.test.sh` (234 pass, 0 fail, not trusted from
  Worker report alone); Lead independently `cat`'d
  `~/.config/environment.d/60-plasma-auto-tiler-native-effect.conf`,
  `ls -la`'d the staged `.so`, `ls -la`'d `~/.config/environment.d/`,
  `readlink`'d `10-home-manager.conf`, and re-ran `effect-status` twice
  directly confirming md5-identical env file content (idempotent). All
  matched the Worker's report exactly.
- Notes: `effect-reload` and `effect-remove` intentionally not exercised for
  real on host this stint (would mutate live D-Bus state / undo the staged
  artifacts pending user inspection); both have functional test coverage
  only, pending the user's session boundary before live reload is
  meaningful.

## 2026-08-18 (Units C, D, E)

- Role / unit: Lead / C, D, E / attempt-1 (each)
- Result: accepted. Executed directly by the Lead, not dispatched -
  `docs/live-kwin-testing.md`, `docs/decisions.md`, `docs/backlog.md`, and
  `README.md` were already fully loaded for scoping, so dispatch would have
  duplicated cost per the Unit A corpus-ownership precedent.
- Files / commit: `docs/live-kwin-testing.md` (Purpose, Safety Boundary,
  Native Effect Host Session-Boundary Exception sections rewritten; the
  Manual Start Launcher `start` bullet's authorization framing sentence
  clarified), `README.md` (new "Native effect (dogfood)" and "Eyeball check"
  subsections after Uninstall; Quickstart intro sentence added; "Scope of
  each command" gets three new bullets) - all uncommitted.
- Verification: actual line numbers verified before editing (Purpose 3-8,
  Safety Boundary 10-22, Native Effect exception 24-39, Manual Start
  Launcher framing at 194-196, not the brief's approximate 145-166); `git
  diff docs/live-kwin-testing.md` shows exactly 2 hunks, both inside the
  named scopes; lines 457-503 (original numbering) confirmed byte-identical
  to `HEAD` by section-bounded diff, not spot-check; `npx markdownlint-cli2`
  run on both edited files before and after, confirming zero new lint
  issues (26 pre-existing in `live-kwin-testing.md`, 4 pre-existing in
  `README.md`, all in untouched regions).
- Notes: caught and corrected one accuracy error during self-review before
  finalizing Unit D/E - `effect-reload` does not rebuild the plugin (only
  unloads/reloads the already-staged `.so` via D-Bus), so documenting a code
  change requires `effect-install` then `effect-reload`, not `effect-reload`
  alone. Unit C's Manual Start Launcher framing edit is a judgment call on
  an ambiguous brief instruction: `start-test.sh start`/`stop` use
  `/Scripting` `loadScript`/`unloadScript`, which is not in the
  standing-authorized operation list in `docs/decisions.md` (that list
  covers only `kpackagetool6`/`kwriteconfig6`/`qdbus6`
  install/enable/disable/reconfigure); the framing was clarified to state
  this explicitly rather than weakened, and no start-test.sh mechanics were
  changed. Unit E placed the eyeball checklist in `README.md` only (not
  duplicated in `live-kwin-testing.md`); rationale recorded in `plan.md`.

## 2026-08-18 (Units F, G - successor Lead)

- Role / unit: Lead / F, G / attempt-1 (each)
- Result: accepted. Executed directly by the Lead, not dispatched - all
  four `native-effect-host-live-runner/` files were fully loaded for
  scoping the move, and `docs/backlog.md` was already loaded from the prior
  stint's Unit A/re-verification, so dispatch would have duplicated cost
  per the Unit A corpus-ownership precedent.
- Files / commit: `docs/changes/native-effect-host-live-runner/{spec,plan,
  state,log}.md` moved via `git mv` to
  `docs/changes/archive/2026-08-18-native-effect-host-live-runner/` (staged
  rename, the one permitted exception to the no-stage constraint this
  stint); archived `spec.md`, `plan.md`, `state.md` further edited in place
  post-move (log.md append-only); `docs/backlog.md` lines 32 and 37
  (original numbering; current 34 and 39) edited - none of this was
  committed.
- Verification: confirmed the archive directory-naming convention against
  existing entries (`ls docs/changes/archive/`); confirmed the
  `supportInformation` D-Bus signature against the pinned KWin source tree
  at `/tmp/opencode/kwin-pinned/src/org.kde.kwin.Effects.xml` (one `name`
  string argument, input); read `/tmp/plasma-auto-tiler-host-20260818-
  7f3c9a2d/manifest.log`, `stage-record.txt`, `cmake-build.log`, and
  `recovery-transcript-host-20260818-7f3c9a2d.log` (read-only) to confirm
  the one real host attempt's pin/build/stage phases verified clean before
  it stopped pre-boundary-1 at an evidence-completeness gate; repository-
  wide `grep` for `native-effect-host-live-runner` before and after
  confirmed only `docs/backlog.md` (fixed), the new archive's own `log.md`
  (expected, describes the move), and `docs/changes/host-dogfooding/{spec,
  plan}.md` (expected, describe the unit) still reference the name, plus
  two out-of-scope dangling links reported below; `git status --short`
  after both units shows only the expected renames/modifications, no
  orphaned state.
- Notes: two dangling links to the pre-archive path remain outside this
  Lead's file scope and were reported, not edited:
  `docs/live-kwin-testing.md:54` (explicitly do-not-touch this stint) and
  `docs/changes/native-active-border-configuration/spec.md:112` (a
  different active change's own corpus). Full A-G acceptance-evidence map,
  residual risks, and a completion-readiness summary were returned to the
  Orchestrator/user in chat; the completion transaction was not run and
  nothing was committed, per the hard constraint.

## 2026-08-18 (Units H, I - successor Lead)

- Role / unit: Lead / H, I / attempt-1 (each)
- Result: accepted. Executed directly by the Lead, not dispatched - both
  edits (one paragraph in `docs/decisions.md`, one sentence in
  `docs/live-kwin-testing.md`, two link repoints) were small enough that
  dispatch would have duplicated cost per the Unit A corpus-ownership
  precedent; the Lead read every file before editing.
- Files / commit: `docs/decisions.md` (Scope clause of "Native Effect Live
  Validation" - inserted the `/Scripting` `loadScript`/`unloadScript`
  fragment, verified verbatim against the brief's required text, rewrapped
  by hand to the file's ~80-column/2-space-hanging-indent style since no
  `prettier` binary is available locally); `docs/live-kwin-testing.md`
  (Manual Start Launcher `start` bullet's authorization-framing sentence
  rewritten - 1 hunk; Interactive Live Runner checked, no superseded
  framing found, left unedited; the pre-existing dangling link at line 54
  repointed to the archive path); `docs/changes/native-active-border-
  configuration/spec.md` (the dangling link repointed to the archive path;
  one line rewrapped, no wording changed, to stay under the 80-column
  convention with the longer archive path) - all uncommitted.
- Verification: actual section boundaries verified before editing (Manual
  Start Launcher is 178-263, not the brief's approximate 145-166;
  Interactive Live Runner is 266-322, not 229-286); `git diff
  docs/live-kwin-testing.md` isolated to confirm exactly 1 new hunk beyond
  the already-accepted Unit C changes; `markdownlint-cli2` run on
  `docs/decisions.md`, `docs/live-kwin-testing.md`, and
  `docs/changes/native-active-border-configuration/spec.md` before (each
  file's `git show HEAD:...` copy) and after editing: 50 total pre-existing
  issues across the first two files both before and after (0 new), and 24
  pre-existing issues in the third file both before and after (0 new) once
  the link-repoint's line-length regression was caught and rewrapped;
  repository-wide `grep` after both edits confirms no remaining live
  markdown link to the non-archived `changes/native-effect-host-live-
  runner/` path anywhere under `docs/` (the one remaining textual match is
  a backtick-quoted historical description in `host-dogfooding/plan.md`'s
  own Unit G evidence prose, not a live link); `git status --short`
  confirms no new staged or committed content.
- Notes: deliberately left the Safety Boundary bulleted list and the
  Native Effect Host Session-Boundary Exception's "`/Compositor`,
  `/Scripting`, ... remain prohibited for these operations" line untouched
  - both are scoped to native-effect operations specifically (which never
  use `/Scripting`) and defer to `docs/decisions.md` as authoritative, so
  neither makes a now-false claim; outside the brief's named two-section
  scope for Unit H. `docs/live-kwin-testing.md`'s own Attempt
  Lessons/Current Boundary/Agent Discipline sections confirmed untouched.

## 2026-08-18 (Unit J - diagnostic, successor Lead)

- Role / unit: Lead / J / attempt-1
- Result: root cause found and confirmed with direct evidence; in-scope
  fix applied and tested; durable fix reported as a blocker outside
  standing authorization, not worked around.
- Trigger: user ran `install`+`enable` (script tiling confirmed working),
  then did a real reboot (confirmed via `who -b`/`journalctl
  --list-boots`), then `effect-status` still reported
  `isEffectSupported: false` with no border rendering.
- Root cause: H2 confirmed. `/proc/<kwin_wayland-pid>/environ` (directly
  readable this session, contrary to an earlier note that `ptrace_scope=1`
  blocked it) shows `kwin_wayland`'s live `QT_PLUGIN_PATH` never contained
  the staging root at all. Explanatory mechanism, confirmed via source
  reading (`systemd`'s `env-util.c`/`env-file.c`/`manager.c` from
  `/nix/store/mpbgd46vg338bdmbcpijgflxsar5rlyy-source/` matching the
  running systemd 261, and `strings` on
  `plasma-workspace-6.7.3/bin/.startplasma-wayland-wrapped` and
  `libKF6DBusAddons.so`): KDE Plasma's session startup
  (`KUpdateLaunchEnvironmentJob`, invoked from `startplasma-wayland`)
  unconditionally re-syncs the *entire* session `QProcessEnvironment` into
  the systemd `--user` manager via `SetEnvironment`, *after*
  `environment.d` generators run and *before* KWin services spawn - and
  the Nix-wrapped `startplasma-wayland`'s own `QT_PLUGIN_PATH` (baked in at
  build time) never includes our staging root, so this resync clobbers our
  generator's contribution. Verified the generator's own parsing/expansion
  of `${QT_PLUGIN_PATH:+:${QT_PLUGIN_PATH}}` is correct (ruled out H1) by
  running the exact generator binary paired with the live systemd version
  with debug logging against the real conf file. Verified `EFFECT_PLUGIN_ID`
  matches the built plugin's `KPlugin.Id` exactly (ruled out H4). This
  happens on every session start, so it is not a pending-boundary state;
  no number of future logout/login cycles fixes it as currently designed.
  This corrects the Unit A/B Residual Risk claim that a boundary alone was
  sufficient - that claim was never verified against a real post-boundary
  observation until now.
- Files / commit: `scripts/dogfood-install.sh` (`cmd_effect_status` only:
  added a read-only `systemctl --user show-environment` cross-check and
  `SYSTEMCTL_BIN` to the existing tool-override convention; distinguishes
  "QT_PLUGIN_PATH not yet in this session" from "QT_PLUGIN_PATH present but
  still unsupported" in the status note, so this failure mode is
  self-diagnosing next time), `scripts/dogfood-install.test.sh` (new fake
  `systemctl` tool; a `SYSTEMCTL_BIN` missing-tool probe; two new
  `effect-status` branch tests) - all uncommitted.
- Verification: 246/246 `dogfood-install.test.sh` pass (was 234/234);
  live `effect-status` re-run on host after the fix matches the real
  session state (the "does not yet include" branch, cross-checked
  independently by the Lead against `systemctl --user show-environment`).
- Notes: no durable fix exists inside `dogfood-install.sh` or the
  `environment.d` entry it writes, within the standing prohibitions on
  touching PAM/sddm/Home-Manager-managed files or system paths - reported
  to the Orchestrator/user as an open blocker requiring a scope decision,
  not silently worked around or papered over. The KWin-script path
  (confirmed working by the user) does not depend on `environment.d` and
  is unaffected by this finding.

## 2026-08-18 (Unit K - diagnostic, backfilled by the Unit L Lead)

- Role / unit: Lead / K / attempt-1
- Result: correct delivery mechanism identified with source-level evidence;
  investigation only, no files changed.
- Backfill note: Unit K was executed in an earlier successor-Lead session
  as pure investigation. Its findings were carried forward to the Unit L
  Lead only as an out-of-band "Established Facts" briefing, never recorded
  here at the time. This entry reconstructs that record from those
  findings (not a re-derivation) so `plan.md`/`log.md` remain the
  authoritative history, per governance ("Only the Lead mutates plans and
  state").
- Trigger: Unit J's unresolved scope question - no fix inside
  `environment.d` survives `KUpdateLaunchEnvironmentJob`'s session-wide
  resync, so a different delivery mechanism was needed.
- Finding: `~/.config/plasma-workspace/env/*.sh` is sourced by
  `startplasma-wayland.cpp`'s `runEnvironmentScripts()` (~line 66) into
  `startplasma-wayland`'s own process environment before
  `syncDBusEnvironment()` (~line 77) snapshots that same environment and
  hands it to `KUpdateLaunchEnvironmentJob`'s resync - i.e. a value set
  this way becomes the resync's own input rather than something it
  overwrites. The Nix `makeBinaryWrapper` `--prefix` chain populates
  `$QT_PLUGIN_PATH` at `execve()`, before `runEnvironmentScripts()` runs,
  so the env script must prepend and preserve the existing value.
  `~/.config/plasma-workspace/env/` did not exist on the host and Home
  Manager has zero references to `plasma-workspace`, so nothing conflicts.
  `runEnvironmentScripts()` still runs only once at session start, so one
  logout/login remains required - this fixes whether the boundary works,
  not the boundary count.
- Files / commit: none (investigation only).
- Verification: source citations above; confirmed absence of
  `~/.config/plasma-workspace/env/` and of any Home Manager reference to
  `plasma-workspace` on the host.

## 2026-08-18 (Unit L)

- Role / unit: Lead / L / attempt-1
- Result: accepted. `environment.d` mechanism replaced outright by
  `~/.config/plasma-workspace/env/60-plasma-auto-tiler-native-effect.sh`;
  `effect-remove` migrates the legacy entry away; `effect-status` rewritten
  as a five-stage self-diagnosing report; host migrated live.
- Files / commit: `scripts/dogfood-install.sh`, `scripts/dogfood-install.test.sh`,
  `README.md`, `docs/live-kwin-testing.md`, `docs/changes/host-dogfooding/{plan,log}.md`
  - all uncommitted.
- Verification: env script content verified with `sh -n` and functional
  `sh -c` runs (empty and non-empty inherited `QT_PLUGIN_PATH`) before
  writing the test assertion; 281/281 `dogfood-install.test.sh` pass (was
  246/246); `bash -n` on the full script; live on host - `effect-install`
  rebuilt and re-staged the plugin and created the new env script; the
  legacy `environment.d` entry was removed directly with `rm` (not via
  `effect-remove`, to avoid wiping the freshly staged state);
  `10-home-manager.conf` confirmed still a symlink into the Home Manager
  store path, untouched; `effect-status` re-run for real on host (with and
  without the `devenv shell --impure` wrapper, identical output both
  times) - exact output reported to the Orchestrator/user in chat;
  `markdownlint-cli2` on `README.md` and `docs/live-kwin-testing.md`
  before (`HEAD` copies) and after: 30 pre-existing issues both times, 0
  new.
- Discovery (reported, not silently resolved): `/proc/<kwin_wayland-pid>/
  environ` is not reliably readable on this host - direct `cat` on the
  real running `kwin_wayland` process returned `Permission denied`,
  contradicting Unit J's log claim that it "was directly readable on this
  host." `kwin_wayland`'s `CapEff`/`CapPrm` show `CAP_SYS_NICE` (bit 23)
  set, consistent with the kernel forcing the process non-dumpable at
  `execve()` for elevated file capabilities, which blocks `/proc/<pid>/
  {environ,exe,mem}` reads for any non-root/non-`CAP_SYS_PTRACE` reader
  regardless of matching UID. The readable parent `kwin_wayland_wrapper`
  process was deliberately not substituted as a proxy (it is itself
  further wrapped and its own `--prefix` logic is not guaranteed
  identical) - `effect-status` stage (c) reports "could not determine" in
  this case rather than guessing either outcome. This may mean stage (c)
  stays inconclusive even after the user's next logout/login; stage (d)
  (`isEffectSupported`) is the fallback authoritative signal.
- Notes: corrected residual-risk and evidence text in `plan.md` from Units
  A, B, and J that asserted or implied the `environment.d` mechanism
  worked or would work after a boundary, marking each inline rather than
  rewriting history. `docs/decisions.md` and
  `docs/changes/host-dogfooding/spec.md` still describe the superseded
  `environment.d` mechanism and were not in this unit's named file scope
  (`README.md` and `docs/live-kwin-testing.md` only per the brief);
  reported as now-inconsistent, not edited. No commit or push performed.

## 2026-08-18 (Unit M - documentation correction, successor Lead)

- Role / unit: Lead / M / attempt-1
- Result: accepted. Documentation-only correction: `docs/decisions.md` and
  `docs/changes/host-dogfooding/spec.md` corrected to match the delivered
  `~/.config/plasma-workspace/env/` mechanism; Unit J's unsound
  `/proc/<kwin_wayland-pid>/environ` evidence claim retracted (not
  deleted); `plan.md`/`log.md` swept for other stale `environment.d`
  claims. Executed directly by the Lead, not dispatched - all four files
  were already fully loaded for scoping, so dispatch would have duplicated
  cost per the Unit A corpus-ownership precedent.
- Files / commit: `docs/decisions.md` (Scope and Consequences clauses of
  "Native Effect Live Validation" - two user-approved fragment
  replacements, rewrapped by hand at the file's ~80-column convention; the
  prohibition on editing other `environment.d` entries left verbatim, as
  required), `docs/changes/host-dogfooding/spec.md` (every bullet
  describing `environment.d` as the current discovery route corrected and
  marked inline, structure and non-goals unchanged), `docs/changes/
  host-dogfooding/plan.md` (Unit J's `/proc/<pid>/environ` claim marked
  RETRACTED inline with reason; the Residual Risks entry about the
  Unit J/Unit L contradiction updated from "not resolved" to "resolved";
  Unit C's stale evidence bullet marked superseded; Work Units table,
  Progress checklist, and Final Outcome updated with a Unit M row/entry;
  new "Unit M - Accepted" section added), `docs/changes/host-dogfooding/
  log.md` (this entry, append-only - the original Unit J entry above was
  left byte-for-byte unedited per the log's own append-only header) - all
  uncommitted.
- Verification: `npx markdownlint-cli2` run on all four edited files after
  editing - `docs/decisions.md` and this `log.md` report 0 issues;
  `spec.md` reports the same 1 pre-existing MD032 issue at line 4
  (unrelated, untouched); `plan.md` reports the same pre-existing
  MD013/MD032/MD060 pattern confined to the Work Units table, plus exactly
  one new instance of that same pattern for the new M table row (not a new
  category of issue); no MD013/MD032 issues in any prose paragraph this
  unit edited or added. Repository-wide `grep -rl environment\.d docs/`
  re-run after editing: exactly seven files under `docs/` still mention
  `environment.d` (the four edited by this unit, `docs/live-kwin-testing.md`,
  and the two archived `native-effect-host-live-runner` files), all
  confirmed by direct reading to describe it either as the superseded/
  legacy mechanism being migrated away or as historical/archived record,
  never as the current working discovery route; `README.md` (not under
  `docs/`) separately confirmed clean.
- Notes: the H2 root-cause conclusion Unit J reached is explicitly NOT
  retracted - only the specific `/proc/<kwin_wayland-pid>/environ` reading
  claim is, since Unit L later found that file is not readable on this
  host for any non-root/non-`CAP_SYS_PTRACE` reader due to `kwin_wayland`'s
  `CAP_SYS_NICE` file capability forcing kernel non-dumpability at
  `execve()` - a deterministic property, not the session/timing/boot
  dependence the pre-existing Residual Risks entry had hedged toward. The
  conclusion stands independently on Unit J's own `systemctl --user
  show-environment` evidence and source-level `KUpdateLaunchEnvironmentJob`
  reading, corroborated by Unit K's separate `startplasma-wayland.cpp`
  reading. No scripts, tests, or non-documentation files touched. No commit
  or push performed; the no-commit restriction remains in force.

## 2026-08-18 (Unit N - live-host effect load, successor Lead)

- Role / unit: Lead / N / attempt-1
- Result: accepted. `effect-reload` run for real on host post-logout:
  `isEffectLoaded` is now `true`, corroborated independently by
  `activeEffects`/`loadedEffects` D-Bus queries and a clean journal (no
  plugin-load error, one benign repeated informational message). Source
  reading confirmed no config key gates the border's runtime paint logic;
  this session's compositing backend is confirmed OpenGL. Border
  visibility itself is not established - not claimed - by this unit.
- Trigger: the user logged out and back in; `effect-status` pre-check
  showed stages (a)/(b)/(d) `yes`, (c) "could not determine" (expected per
  Unit L), (e) `no` (never reloaded for real). This unit ran the reload.
- Files / commit: none - live D-Bus operations (`effect-reload`, read-only
  `/Effects` and `/KWin` queries) and a `journalctl --user -b` read only;
  no source, script, or documentation file changed.
- Verification: `effect-status` re-run shows `[e] loaded: yes`; direct
  `org.kde.kwin.Effects.activeEffects` and `.loadedEffects` queries both
  list `plasma-auto-tiler-active-border`; `journalctl --user -b` shows no
  error for this plugin; `org.kde.KWin.supportInformation` on `/KWin`
  confirms `Compositing Type: OpenGL`; full read of `activewindowborder.
  {cpp,h}`, `activeborderlogic.h`, `metadata.json`, `CMakeLists.txt`
  confirmed no `KConfigGroup`/`.kcfg`/`readConfig` code exists in the
  effect at all - `EnabledByDefault: false` only gates KWin's own
  session-start auto-load via `kwinrc`, not the runtime paint path, and
  `effect-reload`'s explicit `loadEffect` call bypasses it by design. The
  only runtime gates are `m_isOpenGL` (true) and `activeBorderState()`'s
  active/non-minimized/non-fullscreen/non-deleted window check.
- Notes: no `kwriteconfig6` call was made - none was needed, per the
  source-read finding above. Reported to the Orchestrator/user in chat:
  exact `effect-reload`/`effect-status` output, the loaded-vs-active
  evidence, the compositing-backend evidence, the config-key finding, and
  what the user should visually check (the currently-focused, non-
  minimized, non-fullscreen window's edges) - explicitly distinguished
  from "loaded" throughout, since only the user can confirm visual
  rendering. No commit or push performed.
