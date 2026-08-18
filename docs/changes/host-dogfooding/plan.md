# Plan: Host Dogfooding (KWin Script + Native Effect)

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-18 by Orchestrator (Units A and B scope; wording for
  Unit A verbatim-approved by user via Orchestrator dispatch)

## Technical Approach

Deliver the seven spec deliverables as seven bounded work units, executed
serially. The native-effect dogfood commands extend the existing
`scripts/dogfood-install.sh` (decided; no sibling script). Unit A carries the
verbatim user-approved `docs/decisions.md` text and the minimal
`docs/backlog.md` line 3 governance-conflict fix. This stint executes only
Units A and B; C-G are scoped here so a successor Lead can pick them up
without re-deriving the breakdown.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification (static or live) |
|---|---|---|---|---|
| A | Replace `docs/decisions.md` "Native Effect Live Validation" with the verbatim user-approved text; minimally rewrite `docs/backlog.md` line 3 to remove the contradiction. | - | `docs/decisions.md`, `docs/backlog.md` line 3 only | Diff matches approved text exactly; line 3 no longer contradicts the new decision. |
| B | Extend `scripts/dogfood-install.sh` with native-effect subcommands: stable staging root, stable `environment.d` entry, build/stage/reload/status/remove. | - | `scripts/dogfood-install.sh` only | `--help` lists new subcommands; `status` runs read-only; staging path and env file verified present on host after a real run; idempotent re-run does not duplicate the env entry. |
| C | Rewrite `docs/live-kwin-testing.md` Safety Boundary, Native Effect Host Session-Boundary Exception, and Manual Start Launcher sections to match the narrowed policy; lines 457-503 unchanged. | A, B | `docs/live-kwin-testing.md` (named sections only) | Diff confirms only named sections changed; no residual "agents never execute host KWin mutations" claim; lines 457-503 byte-identical. |
| D | Document the full two-component command surface in `README.md`, discoverable from existing Quickstart/Live test material. | B, C | `README.md` | Exact command list present and matches `dogfood-install.sh` + Unit B subcommands. |
| E | Write a roughly 5-10 line eyeball verification checklist for the user to read/confirm after dogfooding both components. | B, C | `docs/live-kwin-testing.md` (new short section) or file named in this row when executed | Line count in range; checklist covers both components. |
| F | Archive `docs/changes/native-effect-host-live-runner/` under `docs/changes/archive/`, preserving accepted host ABI/dev pin evidence and session-boundary lessons. | A | `docs/changes/native-effect-host-live-runner/` -> `docs/changes/archive/YYYY-MM-DD-native-effect-host-live-runner/` | Directory moved; accepted pin evidence and lessons present in the archived files; no dangling references. |
| G | Replace `docs/backlog.md` line 32 with one `host-dogfooding` entry; reconcile the other 4 currently-uncommitted modified docs under `native-effect-host-live-runner/` as part of the archive move (no orphaned/contradictory state). | F | `docs/backlog.md` line 32; the 4 files under `docs/changes/native-effect-host-live-runner/` (moved by F) | `git status` shows no orphaned modifications; backlog line 32 points at `host-dogfooding`. |
| H | Extend standing authorization to KWin `/Scripting` `loadScript`/`unloadScript` for bounded interactive test runs (user-approved addition beyond the original 7-unit spec). | A | `docs/decisions.md` Scope clause; `docs/live-kwin-testing.md` Manual Start Launcher (and Interactive Live Runner if it repeats the superseded framing) | `docs/decisions.md` fragment matches the required text exactly; no residual "outside standing authorization" claim for `/Scripting` `loadScript`/`unloadScript` in the named sections; mechanics unchanged. |
| I | Repoint two dangling links to the archived `native-effect-host-live-runner` path (user-approved addition beyond the original 7-unit spec). | F | `docs/live-kwin-testing.md:54`; `docs/changes/native-active-border-configuration/spec.md:112` | Both links resolve to the archive path; repo-wide search shows no remaining live link to the non-archived path; no other content in either file changed. |
| J | Diagnostic unit: root-cause the host failure (`isEffectSupported: false` after install+enable+reboot); fix `effect-status`'s self-diagnosis, keep the test suite green. | B | `scripts/dogfood-install.sh` (`cmd_effect_status` only), `scripts/dogfood-install.test.sh` | Root cause identified with direct evidence (not guessed); `effect-status` distinguishes "QT_PLUGIN_PATH not yet in this session" from "QT_PLUGIN_PATH present but still unsupported"; 246/246 tests pass. |
| K | Diagnostic unit: `environment.d` is confirmed structurally wrong on this host (not merely pending a boundary); identify the correct Plasma-recognized delivery mechanism with source-level evidence. | J | (investigation only; no files changed) | `startplasma-wayland`'s `runEnvironmentScripts()`/`syncDBusEnvironment()` mechanism identified and cited by file/function; confirmed `~/.config/plasma-workspace/env/` does not yet exist and Home Manager has no reference to it (no conflict). |
| L | Implement the `plasma-workspace/env/` mechanism in place of `environment.d` (fully removing it, not layering); make `effect-status` a self-diagnosing staged report (5 stages, direct `/proc/<kwin_wayland-pid>/environ` read); migrate the host. | K | `scripts/dogfood-install.sh`, `scripts/dogfood-install.test.sh`, `README.md`, `docs/live-kwin-testing.md` | Env script content verified POSIX-sh-valid (`sh -n` plus functional test under both empty and non-empty `QT_PLUGIN_PATH`); legacy `environment.d` entry removed on host, `10-home-manager.conf` confirmed untouched; 281/281 tests pass; live `effect-status` run on host. |
| M | Documentation-correction unit: bring `docs/decisions.md` and `docs/changes/host-dogfooding/spec.md` in line with the delivered `plasma-workspace/env/` mechanism (out of Unit L's file scope); retract Unit J's unsound `/proc/<kwin_wayland-pid>/environ` evidence claim without deleting it or the root-cause conclusion it partly supported; sweep `plan.md`/`log.md` for other stale `environment.d`-worked claims. | L | `docs/decisions.md`, `docs/changes/host-dogfooding/spec.md`, `docs/changes/host-dogfooding/plan.md`, `docs/changes/host-dogfooding/log.md` | `docs/decisions.md` fragments match the user-approved wording exactly; `spec.md` no longer describes `environment.d` as the current discovery route anywhere, with the superseded mechanism still identifiable; Unit J's retraction is explicit and dated, not a silent deletion; `markdownlint-cli2` shows no new issues versus the pre-edit baseline. |
| N | Live-host unit: after the user's logout/login confirmed the `plasma-workspace/env/` mechanism delivers `QT_PLUGIN_PATH`, run `effect-reload` and re-check `effect-status`; if loaded, evidence it is actually active (not just registered) and determine whether default settings are sufficient for the border to render, from source, without guessing. | L, M | (investigation plus one live `effect-reload` D-Bus call; no source files changed) | `effect-status` stages (d)/(e) both `yes` on a live re-run; `activeEffects`/`loadedEffects` D-Bus queries and journal corroborate the effect is loaded with no plugin-load error; effect source (`activewindowborder.cpp`/`.h`, `metadata.json`, `CMakeLists.txt`) read in full to confirm or rule out a rendering-gating config key. |

This stint executes A and B only. C-G are not dispatched this stint per
Orchestrator instruction. H and I were added by later Orchestrator/user
dispatches after C-G were accepted; they are not part of the original
7-deliverable spec table (A-G) but are approved, bounded additions to this
change. J is a later diagnostic unit dispatched after the user reported a
real host failure post-reboot. K is a further diagnostic unit (investigation
only, executed by an earlier successor Lead session; its findings are
backfilled into this table and the Unit K section below by the Lead who
executed Unit L, since they were not recorded in `plan.md`/`log.md` at the
time). L implements K's findings, replacing the `environment.d` mechanism
outright rather than layering on top of it. M is a documentation-only
correction unit dispatched after Unit L, closing the two file-scope gaps
Unit L itself reported (`docs/decisions.md` and `spec.md` still describing
the superseded mechanism) and correcting Unit J's evidence record once the
`/proc/<pid>/environ` unreadability Unit L found was recognized as a
deterministic host property, not a one-off contradiction.

Only the Lead mutates plans and state. Semantic unit IDs are stable;
execution slices use `unit-<id>/attempt-<n>`.

## Progress

- [x] A - decisions.md + backlog.md line 3
- [x] B - native-effect dogfood tooling
- [x] C - live-kwin-testing.md rewrite
- [x] D - README.md command surface
- [x] E - eyeball checklist
- [x] F - archive native-effect-host-live-runner
- [x] G - backlog.md line 32 + doc reconciliation
- [x] H - extend standing authorization to KWin `/Scripting` `loadScript`/
      `unloadScript`
- [x] I - fix two dangling links to the archived
      `native-effect-host-live-runner` path
- [x] J - diagnose and partially address the real post-reboot
      `isEffectSupported: false` host failure (root cause found; durable
      fix is out of this Lead's authorized scope - see Unit J and Residual
      Risks)
- [x] K - identify the correct `plasma-workspace/env/` delivery mechanism
      (investigation only)
- [x] L - implement the `plasma-workspace/env/` mechanism, staged
      `effect-status` diagnostic, migrate the host
- [x] M - correct `docs/decisions.md`/`spec.md` to match the delivered
      mechanism; retract Unit J's unsound `/proc/<pid>/environ` evidence
      claim; sweep `plan.md`/`log.md` for other stale claims
- [x] N - live-host `effect-reload`; confirmed the effect loads and is
      active post-logout; confirmed from source that no config key gates
      rendering; border visibility itself remains for the user to confirm

## Attempt Accounting

- Unit B: 2 attempts. Attempt 1 (prior stint, pre-interruption) implemented
  the four `effect-*` subcommands but left them with zero functional test
  coverage (only parsing/help/missing-tool-probe tests existed) and never
  exercised them on the host. Attempt 2 (this stint) added functional test
  coverage for all four subcommands and ran `effect-install`/`effect-status`
  for real on the host under `devenv shell --impure`.

## Pending User Decisions

- None this stint.

## Acceptance-Criterion Evidence

| Acceptance criterion (spec.md) | Evidence |
|---|---|
| `docs/decisions.md` amended per narrowed policy, user-approved wording | Unit A diff; verbatim match to Orchestrator-supplied text |
| Native-effect dogfood path implemented, choice recorded here | Unit B diff to `scripts/dogfood-install.sh`; choice = extend existing script (Orchestrator decision, not re-litigated); 234/234 `dogfood-install.test.sh` pass including new functional coverage for all four `effect-*` subcommands; `effect-install`/`effect-status` run for real on host, staged `.so` and `environment.d` entry confirmed present, `10-home-manager.conf` confirmed untouched |
| `docs/live-kwin-testing.md` rewritten | Unit C diff; only Purpose/Safety Boundary/Native Effect Host Session-Boundary Exception sections and the Manual Start Launcher framing sentence changed (`git diff` shows exactly 2 hunks); lines 457-503 confirmed byte-identical by direct diff against `HEAD` |
| README + live-kwin-testing command surface documented | Unit D diff: `README.md` "Native effect (dogfood)" section states the exact four-command surface (`effect-install`/`effect-status`/`effect-reload`/`effect-remove`) plus the KWin script surface already documented; `docs/live-kwin-testing.md` Native Effect Host Session-Boundary Exception section states the same surface (Unit C) |
| Eyeball checklist | Unit E: `README.md` "Eyeball check" subsection, 6 bullet lines, placed once (not duplicated in `live-kwin-testing.md`); covers script tiling, effect supported/loaded, border rendering, reload-after-code-change, and remove-cleans-up |
| Archive native-effect-host-live-runner | Unit F: `git mv` of all four files to `docs/changes/archive/2026-08-18-native-effect-host-live-runner/`; ABI/dev pin evidence and session-boundary lessons preserved unedited; `spec.md`'s `supportInformation` argument error corrected; `plan.md`/`state.md`/`log.md` amended with an honest outcome record (over-engineering, evidence-completeness-gate stop not a defect, external evidence referenced not moved, superseded by this change) |
| backlog.md line 32 replaced | Unit G: `docs/backlog.md` original line 32 (current line 34, shifted +2 by Unit A) replaced with a `host-dogfooding` entry; original line 37 (current line 39) repointed from the archived path to `changes/host-dogfooding/` |
| 5 uncommitted docs reconciled | Unit G/F: the four `native-effect-host-live-runner/` files moved (not left orphaned) by Unit F; `docs/backlog.md` reconciled by Unit G; `git status` shows no orphaned modification under the old path |
| Session boundary is an explicit user-only step | Unit A decisions.md text states this; Unit C carries the same wording into `live-kwin-testing.md`; Unit D carries it into `README.md` |
| No file under `native-active-border-configuration/` or other active change touched | No such file touched by A, B, C, D, or E |

## Unit A - Accepted

- Verbatim diff confirmed against Orchestrator-supplied text (`git diff
  docs/decisions.md`) - exact match, no paraphrase.
- `docs/backlog.md` line 3 rewritten minimally to remove the contradiction;
  no other line in `backlog.md` touched.
- Executed directly by the Lead (not dispatched): both files were already
  fully loaded for scoping, so dispatch would have duplicated cost per the
  corpus-ownership rule.

## Residual Risks

- SUPERSEDED by Unit J: the claim below ("a session boundary is all that's
  needed") is INCOMPLETE and was not verified against a real post-boundary
  host state at the time it was written. Unit J later reproduced the exact
  scenario (install + enable + a real reboot) and found `isEffectSupported`
  still `false`, with direct evidence (`/proc/<kwin-pid>/environ`) that
  `QT_PLUGIN_PATH` never reached the running `kwin_wayland` process at all.
  The root cause is structural, not a pending-boundary state: KDE Plasma's
  own session startup (`KUpdateLaunchEnvironmentJob`, invoked from
  `startplasma-wayland`) unconditionally re-syncs the *entire* session
  `QProcessEnvironment` into the systemd `--user` manager via
  `org.freedesktop.systemd1.Manager.SetEnvironment` on every session start,
  *after* `environment.d` generators have already run and *before* KWin
  services are spawned. Since the Nix-wrapped `startplasma-wayland` binary's
  own `QT_PLUGIN_PATH` (baked in at build time) never includes the staging
  root, this resync overwrites whatever `environment.d` correctly
  contributed. This will repeat on every future logout/login on this host;
  no number of additional session boundaries fixes it as currently designed.
  See Unit J below for full evidence and the (currently unresolved) scope
  question this raises. FURTHER SUPERSEDED by Unit L: the "unresolved scope
  question" is now resolved - `environment.d` has been replaced outright
  (not patched) by `~/.config/plasma-workspace/env/`, which survives the
  same `KUpdateLaunchEnvironmentJob` resync because it is that resync's own
  input, not a competing write. See Unit K/Unit L below.
- `environment.d` is read only at systemd user-manager start (confirmed via
  `man 5 environment.d`), so the env entry created by Unit B has no effect
  until the user's next session boundary - consistent with spec intent;
  confirmed live on host: `effect-status` reports `isEffectSupported: false`
  and states the logout/login requirement plainly, matching the pre-boundary
  state. (Superseded by Unit J: a boundary is necessary but, on this host,
  not sufficient - see above. FURTHER SUPERSEDED by Unit L: this project no
  longer writes an `environment.d` entry at all; Unit L's `effect-remove`
  migrates the old one away.)
- The `QT_PLUGIN_PATH=${EFFECT_ROOT}${QT_PLUGIN_PATH:+:${QT_PLUGIN_PATH}}`
  form is the documented systemd `environment.d` idiom (verified against
  `man 5 environment.d` Example 1, `LD_LIBRARY_PATH` case): non-clobbering,
  emits no empty path element when `QT_PLUGIN_PATH` is unset. Filename
  `60-plasma-auto-tiler-native-effect.conf` sorts after `10-home-manager.conf`
  lexicographically, satisfying the ordering requirement with the simplest
  correct form; no more complex expansion was needed. SUPERSEDED by Unit L:
  this idiom and file are no longer written by this project; the equivalent
  POSIX-sh guarded-expansion form now lives in the `plasma-workspace/env/`
  script instead - see Unit L.
- Two dangling links to the pre-archive
  `changes/native-effect-host-live-runner/` path remain outside this Lead's
  file scope and were reported rather than edited: `docs/live-kwin-testing.md`
  line 54 (explicitly not-to-touch) and
  `docs/changes/native-active-border-configuration/spec.md` line 112 (a
  different active change's own corpus). Neither breaks this change's
  acceptance; both should be repointed by their respective owners.
- `effect-reload` and `effect-remove` have never been run for real on the
  host, and the native effect has never been observed rendering. Both are
  pending the user's one-time logout/login (see Unit B and Unit F/G
  evidence). Unit L re-ran `effect-install` for real under the new
  `plasma-workspace/env/` mechanism and removed the legacy
  `environment.d` entry directly (not via `effect-remove`, to avoid
  wiping the freshly staged state before the user inspects it); see Unit L.
- Unit L found that `/proc/<kwin_wayland-pid>/environ` is NOT reliably
  readable on this host: direct testing during Unit L got `Permission
  denied` reading the real running `kwin_wayland` process (`kwin_wayland`
  runs with `CapEff` bit 23 set, i.e. `CAP_SYS_NICE`, which the kernel
  treats as reason to force the process non-dumpable at `execve()`,
  blocking `/proc/<pid>/{environ,exe,mem}` reads for any non-root,
  non-`CAP_SYS_PTRACE` reader regardless of same-UID). This contradicts
  Unit J's claim that this file "was directly readable on this host."
  RESOLVED by Unit M (2026-08-18): the `CAP_SYS_NICE` non-dumpable
  transition at `execve()` is a deterministic kernel property of the
  capability, not session-, timing-, or boot-dependent, so the "may be
  session/timing-dependent" hedge above does not hold - Unit J's specific
  `/proc/<kwin_wayland-pid>/environ` reading claim is retracted (see Unit J
  above), most likely having actually read the readable parent
  `kwin_wayland_wrapper` process without saying so, not a real
  contradiction in host state. Unit J's H2 root-cause conclusion itself is
  unaffected - it stands independently on the `systemctl --user
  show-environment` evidence and the source-level explanatory mechanism,
  corroborated by Unit K's independent source reading.
  `effect-status`'s stage (c) is designed for exactly this failure mode -
  it reports "could not determine" rather than guessing - so this is a
  documented limitation, not a defect, but it means stage (c) may remain
  inconclusive even after the user's next logout/login. Stage (d)
  (`isEffectSupported`) is the fallback authoritative signal in that case.

## Unit B - Accepted

- `scripts/dogfood-install.sh` extends the existing script (no sibling
  script) with `effect-install`, `effect-reload`, `effect-status`,
  `effect-remove`.
- Staging root: `$XDG_DATA_HOME/plasma-auto-tiler-native-effect` (default
  `~/.local/share/plasma-auto-tiler-native-effect`), stable across runs, not
  a per-run nonce. Staged plugin:
  `<root>/kwin/effects/plugins/plasma-auto-tiler-active-border.so`.
- Env entry: `$XDG_CONFIG_HOME/environment.d/60-plasma-auto-tiler-native-effect.conf`,
  one file, sorts after `10-home-manager.conf`, sets `QT_PLUGIN_PATH` using
  the documented systemd guarded-expansion idiom.
- `scripts/dogfood-install.test.sh` extended with functional coverage for
  all four `effect-*` subcommands (build invocation, staging, env-file
  content and idempotency, status reporting in all four
  staged/env/supported/loaded combinations, reload's supported/unsupported
  branches and D-Bus call ordering, remove and its idempotent no-op case).
  234/234 tests pass (verified independently by the Lead, not just the
  Worker's report).
- Live host run (this stint, under standing authorization): `devenv shell
  --impure -- bash scripts/dogfood-install.sh effect-install` succeeded;
  `effect-status` re-run twice by the Lead directly (env file md5 unchanged
  across runs, confirming idempotency); `10-home-manager.conf` confirmed
  still a symlink into the Home Manager store path, untouched.
- `effect-reload` and `effect-remove` were deliberately NOT run for real on
  host this stint (reload would attempt a live D-Bus mutation while
  `isEffectSupported` is still false pre-logout; remove would undo the
  staged state the user should inspect first) - both are covered by
  functional tests only pending the user's session boundary.

## Unit C - Accepted

- Executed directly by the Lead (not dispatched): `docs/live-kwin-testing.md`
  (518 lines) was already fully loaded for scoping the exact section
  boundaries, so dispatch would have duplicated cost per the corpus-ownership
  rule established at Unit A.
- Verified exact line numbers before editing rather than trusting the
  brief's approximate ranges; the actual boundaries were Purpose
  (3-8)/Safety Boundary (10-22)/Native Effect Host Session-Boundary
  Exception (24-39), and the Manual Start Launcher framing sentence at
  194-196 (not 145-166 as approximated - the "requires one explicit, bounded
  authorization" language sits in the `start` bullet, not the section intro).
- Purpose and Safety Boundary now state the narrowed policy: a
  standing-authorized bullet listing the exact reversible user-local
  operation set (mirroring `docs/decisions.md#native-effect-live-validation`
  verbatim in scope), plus an explicit carve-out that all other live KWin
  mutation (window journeys, Custom Tile structural work, shortcut
  reconciliation, desktop creation) remains outside standing authorization
  and still needs per-attempt authorization - Units A/B did not touch that
  general live-testing ceremony and this rewrite does not either.
- Native Effect Host Session-Boundary Exception is rewritten to the accepted
  model: KWin script path needs no boundary; native effect needs exactly one
  user-run boundary, once, after `effect-install` first creates the
  `environment.d` entry, then `effect-reload` is live indefinitely. No
  residual "agents never execute host KWin mutations" claim remains.
  SUPERSEDED by Unit L (per Unit M sweep, 2026-08-18): this describes what
  the section said at the time Unit C wrote it; Units J/K found the
  `environment.d` entry never actually delivered `QT_PLUGIN_PATH` to
  `kwin_wayland`, and Unit L rewrote this same section of
  `docs/live-kwin-testing.md` to describe the `~/.config/plasma-workspace/
  env/` mechanism instead (see Unit L). This bullet is retained as a
  historical record of Unit C's own work, not a claim about the section's
  current content.
- The Manual Start Launcher framing sentence (for `scripts/start-test.sh
  start`, which loads/runs the script directly via `/Scripting`
  `loadScript`/`run` - a different mechanism from the standing-authorized
  `dogfood-install.sh install|enable|disable|reconfigure` surface) was
  clarified, not weakened: it now states explicitly that this operation sits
  outside the standing-authorized dogfood set and therefore still requires
  per-attempt authorization, unchanged. This is a judgment call on an
  ambiguous brief instruction ("superseded for the KWin script operations
  now standing-authorized") - `start-test.sh start`/`stop` use `/Scripting`
  `loadScript`/`unloadScript`, which is not in the standing-authorized list
  in `docs/decisions.md` (that list covers `kpackagetool6`/`kwriteconfig6`/
  `qdbus6` install/enable/disable/reconfigure only). No mechanics changed,
  only the framing sentence, per the brief's explicit constraint.
- Lines 457-503 (original numbering; the Attempt Lessons table through
  Current Boundary and Resumption) confirmed byte-identical to `HEAD` by
  direct section-bounded diff (`awk` between `## Attempt Lessons` and
  `## Agent Discipline`), not just spot-checked.
- `git diff docs/live-kwin-testing.md` shows exactly 2 hunks, both within
  the four named scopes; no other section touched.
- `npx markdownlint-cli2` on the edited file reports the same 26 pre-existing
  issues (verified by running it against the unmodified `HEAD` copy too),
  all in untouched regions; zero new lint issues introduced.

## Unit D - Accepted

- `README.md` gets a new `### Native effect (dogfood)` subsection placed
  after `### Uninstall` (the last KWin-script command subsection) and before
  `## Scope of each command`, matching the existing pattern of one H3 per
  command group with a prose paragraph plus a fenced `sh` command block.
  The Quickstart intro paragraph gets one added sentence pointing at it, per
  spec's "discoverable from existing Quickstart/Live test material"
  requirement, without restructuring the document.
- States plainly: KWin script commands need no session boundary; the native
  effect needs exactly one logout/login (or new session), once, after the
  first `effect-install`.
- Command surface matches `dogfood-install.sh` exactly, including the
  `devenv shell --impure` prefix required only for `effect-install`'s build
  step (verified against `usage()` and the live host run evidence recorded
  under Unit B).
- `## Scope of each command` gets three added bullets for
  `effect-install`/`effect-remove` (staging-only, no KWin/D-Bus), and
  `effect-reload` (the only one that mutates the running session, via
  `/Effects`), and `effect-status` (read-only) - mirroring the existing
  per-command bullet pattern for `install`/`enable`/`status`/`dry-run`.
- Caught and corrected one accuracy error during self-review before
  finalizing: `effect-reload` unloads/reloads the already-staged plugin only
  and does not rebuild, so a code change requires `effect-install` (rebuild)
  before `effect-reload`, not `effect-reload` alone; both the prose and the
  eyeball checklist state this correctly.
- `npx markdownlint-cli2 README.md` reports the same pre-existing 4 issues
  (all in the unrelated, untouched shortcut table at line 167) both before
  and after the edit; zero new issues.

## Unit E - Accepted

- Placed in `README.md` as an `### Eyeball check` subsection immediately
  after `### Native effect (dogfood)`, not duplicated in
  `docs/live-kwin-testing.md`. Rationale: Unit D already established
  `README.md` as the primary user-facing entry point for the dogfood command
  surface; the checklist is the natural "how do I know it worked" capstone
  read immediately after the commands that produce the state it checks.
  `docs/live-kwin-testing.md` is the agent/Lead-facing operational contract
  (nonces, evidence, ceremony) - a self-directed eyeball checklist for the
  user reading after logging back in fits the user-facing document, not the
  agent contract.
- 6 bullet lines (plus heading and one intro line, 8 lines total), within the
  spec's roughly-5-10-line target. Covers both components: script
  installed/enabled and tiling; effect supported/loaded; border rendering;
  reload-after-code-change; remove-cleans-up. No scripts, no evidence
  capture - purely a read-and-confirm list, matching the spec's
  "not an automated evidence framework" non-goal.

## Unit F - Accepted

- Executed directly by the Lead (not dispatched): all four files
  (`spec.md`, `plan.md`, `state.md`, `log.md`) were fully loaded for
  scoping the archive move, so dispatch would have duplicated cost per the
  Unit A corpus-ownership precedent.
- `docs/changes/native-effect-host-live-runner/` moved via `git mv` to
  `docs/changes/archive/2026-08-18-native-effect-host-live-runner/`,
  matching the established `YYYY-MM-DD-<name>` archive convention (verified
  against existing entries, e.g. `2026-08-17-native-effect-live-runner/`).
  Staging this rename is the sole permitted exception to the no-stage
  constraint for this stint.
- Corrected one factual error in the archived `spec.md`: step 4 originally
  read "(omit the plugin argument for `supportInformation`)"; verified
  against the pinned KWin source
  (`org.kde.kwin.Effects.xml`: `<method name="supportInformation"><arg
  type="s" direction="out"/><arg name="name" type="s" direction="in"/>`)
  that `supportInformation` takes exactly one string argument, same as
  every other method in the checklist. Fixed in place with an inline
  archival-correction note rather than silently rewritten.
- Archived `plan.md` amended (additively, nothing removed) with the exact
  external evidence path
  `/tmp/plasma-auto-tiler-host-20260818-7f3c9a2d` for the one real host
  attempt (nonce `host-20260818-7f3c9a2d`), and a new "Final Outcome
  (Archived 2026-08-18)" section stating plainly: the five-phase runner and
  its fake-host suite, and this simplified checklist, are both abandoned as
  over-engineering (no defect in either); the one host attempt completed
  pin verification, build, and staging cleanly and was stopped before user
  boundary 1 at an evidence-completeness gate (not a defect) and fully
  rolled back; this change is superseded by `docs/changes/host-dogfooding/`
  under the new standing-authorization policy. Archived `state.md` and
  `log.md` amended to match (append-only for `log.md`).
- No ABI/development pin evidence or lessons/attempt-history content was
  deleted; the external evidence at
  `/tmp/plasma-auto-tiler-host-20260818-7f3c9a2d` was read for verification
  only, never moved, copied, modified, or deleted.
- Repository-wide search confirmed no remaining reference to the old
  non-archived path except `docs/backlog.md` (reconciled by Unit G) and two
  files outside this Lead's scope, reported rather than edited:
  `docs/live-kwin-testing.md` line 54 (explicitly do-not-touch) and
  `docs/changes/native-active-border-configuration/spec.md` line 112 (a
  different active change's own corpus, not owned here).

## Unit G - Accepted

- `docs/backlog.md` original-numbering line 32 (current line 34; line
  numbers shifted +2 by Unit A's earlier 3-line expansion of the file's
  first bullet) replaced: the old entry named the superseded five-phase
  protocol and linked `changes/native-effect-host-live-runner/`; the new
  entry describes the delivered two-component dogfood path, the standing
  authorization for reversible user-local operations, and the one
  remaining user-run logout/login gate, linked to `changes/host-dogfooding/`.
- `docs/backlog.md` original-numbering line 37 (current line 39), the
  `native-active-border-configuration` dependency list, repointed minimally:
  `[native-effect-host-live-runner](changes/native-effect-host-live-runner/)
  read-only feasibility` became `[host-dogfooding](changes/host-dogfooding/)
  native-effect live acceptance` - the old "read-only feasibility"
  description was no longer accurate (that work is superseded, and
  host-dogfooding performs live mutation under standing authorization, not
  read-only feasibility), so the minimal wording needed to change to stay
  accurate; the entry's own substance (the `native-active-border-configuration`
  spec) was not restated or touched further.
- `docs/backlog.md` line 3 (Unit A, already accepted) was re-diffed and
  confirmed untouched by this unit.
- Repository-wide search after the edit confirms no remaining
  `changes/native-effect-host-live-runner` reference in `docs/backlog.md`.
- `git status` after F and G shows the four archived files as staged
  renames only (`RM`, required by the move) and `docs/backlog.md` as a
  modified-not-staged file, alongside the pre-existing A-E modifications;
  no orphaned or contradictory state.

## Unit H - Accepted

- User-approved rationale: KWin `/Scripting` `loadScript`/`unloadScript` is
  the same reversibility class as the operations already standing-authorized
  (loads a script into the running KWin, unloads on exit, no persistent
  state), and it is what `scripts/live-test.sh` and `scripts/start-test.sh`
  use.
- `docs/decisions.md` "Native Effect Live Validation" Scope clause: inserted
  "KWin `/Scripting` `loadScript` and `unloadScript` for bounded interactive
  test runs;" between the `kpackagetool6`/`kwriteconfig6`/`qdbus6` clause and
  "and journal and status reads." Verified verbatim against the brief's exact
  required fragment. Surrounding text, prose content, and ASCII-only
  typography preserved; only the line-wrap positions of that one paragraph
  changed to fit the insertion (no `prettier`/`markdownlint-cli2` available
  locally to reflow automatically - rewrapped by hand at the file's existing
  ~80-column, 2-space-hanging-indent style).
- `docs/live-kwin-testing.md`: verified actual section boundaries before
  editing rather than trusting the brief's approximate line ranges. Manual
  Start Launcher section is at lines 178-263 (not 145-166); its `start`
  bullet's authorization-framing sentence (previously: running it "is a live
  KWin mutation outside the standing-authorized dogfood operations above and
  still requires one explicit, bounded authorization under the Safety
  Boundary") was the only superseded framing found and was rewritten to
  state that `/Scripting` `loadScript`/`unloadScript` for this bounded
  interactive test run is now standing-authorized, while any further live
  KWin mutation beyond that bounded run (window journeys, Custom Tile
  structural work, shortcut reconciliation, desktop creation) still needs
  its own explicit, bounded authorization - preserving the general Safety
  Boundary carve-out. No `start-test.sh`/`live-test.sh` mechanics were
  changed, only this one sentence (1 hunk).
- Interactive Live Runner section (lines 266-322) was checked for the same
  inherited framing per the brief; none was present - the section describes
  mechanics and safety guarantees only and makes no "outside standing
  authorization" claim of its own (it wraps `start-test.sh start`, so the
  corrected framing on that bullet applies transitively). Left unedited.
- Deliberately NOT touched (outside the brief's named sections): the
  Safety Boundary bulleted list (lines 16-23) and the Native Effect Host
  Session-Boundary Exception's "`/Compositor`, `/Scripting`, ... remain
  prohibited for these operations" line - both are scoped to the
  native-effect dogfood operations specifically (which never use
  `/Scripting`) and defer to `docs/decisions.md` as the authoritative scope
  ("See `docs/decisions.md#native-effect-live-validation` for the full
  scope"), so neither makes a now-false claim. Reported here rather than
  edited, per the brief's explicit two-section scope and the no-scope-creep
  constraint.
- The attempt-history/lessons section near the end of the file (Remove-
  Contract Probe Crash Post-mortem through Agent Discipline) confirmed
  untouched.
- 1 attempt; no re-dispatch needed.

## Unit I - Accepted

- `docs/live-kwin-testing.md`: the
  `[native-effect-host-live-runner](changes/native-effect-host-live-runner/spec.md)`
  link repointed to
  `changes/archive/2026-08-18-native-effect-host-live-runner/spec.md`.
- `docs/changes/native-active-border-configuration/spec.md`: the
  `[native-effect-host-live-runner](../native-effect-host-live-runner/)`
  link repointed to `../archive/2026-08-18-native-effect-host-live-runner/`.
  No wording changed; the link's longer archive-path target no longer fits
  the file's 80-column line-length convention on one line with the trailing
  "read-only" text that followed it, so that one line was rewrapped
  (moving "read-only feasibility..." onto the following lines) with no word
  added, removed, or reordered. Verified with `markdownlint-cli2` against
  the file's own `HEAD` baseline: 24 issues before and after, all
  pre-existing, zero new.
- Repository-wide search after both edits confirms no remaining live
  markdown link to `changes/native-effect-host-live-runner/` (bare,
  non-archived) anywhere under `docs/`. The one remaining textual match
  (`docs/changes/host-dogfooding/plan.md` line 292, in Unit G's own
  evidence prose) is a backtick-quoted historical description of the old
  `backlog.md` text Unit G replaced, not a live link, and is out of this
  unit's scope to alter.
- 1 attempt; no re-dispatch needed.

## Unit J - Diagnostic (root cause found; durable fix out of scope)

- Trigger: user ran `install` + `enable` (confirmed tiling worked), then did
  a real reboot (session boundary confirmed via `who -b`/`journalctl
  --list-boots`: boot at 10:57, native-effect `environment.d` file birth
  time 10:21, well before the boot). Post-reboot `effect-status` still
  reported `isEffectSupported: false`.
- H1 (systemd `environment.d` doesn't support `${VAR:+...}` nested
  expansion) - ruled out. `man 5 environment.d` on this host documents
  `${FOO:+ALTERNATE_VALUE}` support explicitly; read the actual
  `systemd-environment-d-generator.c`/`env-util.c`
  (`replace_env_full`)/`env-file.c` (`merge_env_file`) source at
  `/nix/store/mpbgd46vg338bdmbcpijgflxsar5rlyy-source/src/basic/`, which
  tracks brace nesting depth (`nest` counter) through `ALTERNATE_VALUE`
  state, so `${QT_PLUGIN_PATH:+:${QT_PLUGIN_PATH}}` parses correctly. Ran
  the *exact* generator binary paired with the live running systemd 261
  (`/nix/store/axx9bvf0dmah41f39ds9xdkds1lsz6z9-systemd-261/lib/systemd/
  user-environment-generators/30-systemd-environment-d-generator`) with
  `SYSTEMD_LOG_LEVEL=debug` against the real
  `~/.config/environment.d/60-plasma-auto-tiler-native-effect.conf`; it
  correctly emits `QT_PLUGIN_PATH=<staging-root>:<rest>` with no literal
  `${...}`, no empty element, no stray colon.
- H4 (effect ID mismatch) - ruled out. `kwin/native-effect/metadata.json`
  `KPlugin.Id` is `plasma-auto-tiler-active-border`, an exact match for
  `EFFECT_PLUGIN_ID` in `dogfood-install.sh`.
- H2 (value present in the systemd user manager but doesn't reach
  `kwin_wayland`) - CONFIRMED as the root cause, with direct evidence:
  - `systemctl --user show-environment | grep QT_PLUGIN_PATH` on the live
    session showed the plain Nix-derived Qt plugin path list with **no**
    trace of the staging root anywhere in the value.
  - `/proc/<kwin_wayland-pid>/environ` was directly readable on this host
    (contrary to an earlier session's note that it was blocked by
    `ptrace_scope=1`) and confirmed conclusively: `kwin_wayland`'s actual
    live `QT_PLUGIN_PATH` (3902 bytes) contains zero occurrences of
    `plasma-auto-tiler-native-effect`. RETRACTED by Unit M
    (2026-08-18): Unit L found `/proc/<kwin_wayland-pid>/environ` is NOT
    readable on this host - `kwin_wayland` carries the `CAP_SYS_NICE` file
    capability, which unconditionally forces the kernel to mark the process
    non-dumpable at `execve()`, blocking `/proc/<pid>/{environ,exe,mem}`
    reads for any non-root, non-`CAP_SYS_PTRACE` reader regardless of
    matching UID. This is a deterministic property of the capability, not
    session-, timing-, or host-state-dependent, so the "may be
    session/timing-dependent" hedge in this unit's own Residual Risks entry
    below was itself incorrect. This specific claim - that the file "was
    directly readable" and that its content was `kwin_wayland`'s - is
    retracted, not deleted; it most likely actually read the readable
    parent `kwin_wayland_wrapper` process's `environ` without saying so.
    The H2 root-cause conclusion above is NOT retracted: it remains
    independently supported by the `systemctl --user show-environment`
    evidence immediately above (unaffected by this retraction - that is a
    D-Bus/systemctl query, not a `/proc/<pid>/environ` read) and by the
    source-level explanatory mechanism below, and is independently
    corroborated by Unit K's separate reading of
    `startplasma-wayland.cpp`'s `runEnvironmentScripts()`/
    `syncDBusEnvironment()`, which confirms the same resync architecture
    from the opposite direction (what *does* survive it) without relying on
    any `/proc/<pid>/environ` read at all.
  - Explanatory mechanism (why, not just that): `strings` on
    `/nix/store/.../plasma-workspace-6.7.3/bin/.startplasma-wayland-wrapped`
    shows it links `KUpdateLaunchEnvironmentJob` (from `libKF6DBusAddons`,
    constructed with a full `QProcessEnvironment`, confirmed via the
    `KUpdateLaunchEnvironmentJobPrivate::isSystemdApprovedValue`/
    `isPosixName` filter symbols and the `"Skipping syncing of environment
    variable "` log string - i.e. it syncs essentially the *whole* process
    environment, not a fixed allowlist). This job runs during Plasma
    session startup and calls `SetEnvironment` on the systemd `--user`
    manager for every variable in `startplasma-wayland`'s own process
    environment - which already has `QT_PLUGIN_PATH` baked in at Nix build
    time by `kwin_wayland_wrapper`'s/`startplasma-wayland`'s own
    `makeBinaryWrapper` `--prefix` logic, with no knowledge of our
    `environment.d` entry (that entry is only ever read by the
    `environment.d` generator, which only affects processes the systemd
    `--user` manager itself spawns - not `startplasma-wayland`, which PAM/
    sddm spawn directly). `manager.c`
    (`manager_run_environment_generators`/`deserialize_environment` ->
    `strv_env_replace_consume`) confirms generator output uses REPLACE
    semantics into the manager's `transient_environment`, so this later
    `SetEnvironment` call from `KUpdateLaunchEnvironmentJob` overwrites
    (not merges with) whatever the generator correctly set moments earlier
    - and it happens on **every** session start, not once.
  - H3 (plugin not loadable, ABI mismatch) was not reached: the plugin was
    never in KWin's search path to begin with, so ABI/symbol checks would
    not explain the current failure; not pursued further this unit.
- Consequence: this is not a pending-boundary state. No number of future
  logout/login cycles will make `isEffectSupported` become `true` as the
  native effect delivery is currently designed on this host, because the
  clobbering happens identically on every session start. This corrects the
  Unit A/B Residual Risk entries above, which assumed (without a real
  post-boundary observation) that `environment.d`'s "read once at manager
  start" behavior was the only relevant fact.
- Fix applied (in scope): `cmd_effect_status` in `scripts/dogfood-install.sh`
  now queries `systemctl --user show-environment` (read-only) and reports
  one of two distinct notes when `isEffectSupported` is `false`: "QT_PLUGIN_
  PATH ... does not yet include `<root>`" (boundary genuinely still
  pending) vs. "QT_PLUGIN_PATH ... already includes `<root>` ... A session
  boundary alone is not guaranteed to fix this" (the host-specific
  clobbering case actually observed here) - self-diagnosing per the brief,
  without claiming a fix that does not exist. `SYSTEMCTL_BIN` added to the
  script's existing tool-override convention (`require_tool`, `usage()`).
  `effect-install`'s and `effect-reload`'s own "logout/login required"
  notes were deliberately left unchanged (out of the brief's named scope
  for this unit; both remain literally true - a boundary is necessary, just
  not sufficient on this host - and rewriting them was not requested).
- Fix NOT applied (out of authorized scope, reported rather than
  guessed at): there is no change available inside `dogfood-install.sh` or
  the `environment.d` entry it writes that survives
  `KUpdateLaunchEnvironmentJob`'s unconditional resync, given the standing
  prohibitions on touching PAM/sddm/Home-Manager-managed files or system
  paths. A durable fix would need to seed `QT_PLUGIN_PATH` (or find another
  KWin-recognized plugin-search channel) earlier in the session chain than
  this Lead is authorized to reach. This is reported to the Orchestrator/
  user as a blocker requiring a scope decision, not silently worked around.
- Verification: 246/246 `dogfood-install.test.sh` pass (was 234/234; 12 new
  assertions across a new `SYSTEMCTL_BIN` missing-tool probe and two new
  `effect-status` branch tests using a new fake `systemctl` tool). Live
  `effect-status` re-run on host after the fix: correctly reports the
  "does not yet include" branch (matches the real current session state,
  confirmed by the same `systemctl --user show-environment` check done
  independently by the Lead).
- 1 attempt; executed directly by the Lead (not dispatched) - the
  investigation required reading systemd/KDE source across many files
  interactively to converge on evidence, which would have meant
  duplicating near all of the diagnostic cost through a dispatch per the
  Unit A corpus-ownership precedent.
- NOTE (backfilled by Unit L): the `SYSTEMCTL_BIN`/`systemctl --user
  show-environment` cross-check added here is removed entirely by Unit L,
  since `environment.d` (what it was cross-checking) is no longer used by
  this project at all. See Unit L.

## Unit K - Diagnostic (correct mechanism identified; not yet implemented)

- NOTE: this section is backfilled by the Lead who executed Unit L. Unit K
  was executed in an earlier successor-Lead session as pure investigation
  (no file changes), but its findings were never recorded in `plan.md` or
  `log.md` at the time; they were carried forward only as an out-of-band
  "Established Facts" briefing to this Lead. This entry reconstructs that
  record from those findings so the plan/log stay the authoritative
  history; it is not a re-derivation, per the Unit L brief's instruction
  not to re-derive them.
- Trigger: Unit J left an unresolved scope question - `environment.d` is
  structurally wrong on this host (`KUpdateLaunchEnvironmentJob`'s session
  resync always wins), and no fix inside `environment.d` itself can survive
  that resync. Unit K's task was to find a mechanism that does survive it.
- Finding: `environment.d` is the wrong *category* of mechanism entirely -
  it feeds the systemd `--user` manager's environment block, which
  `KUpdateLaunchEnvironmentJob` treats as a source to be overwritten, not
  read from. The correct mechanism is
  `~/.config/plasma-workspace/env/*.sh`: `startplasma-wayland.cpp`'s
  `runEnvironmentScripts()` (around line 66) sources every `*.sh` file
  under that directory into `startplasma-wayland`'s *own* process
  environment before session services start; `syncDBusEnvironment()`
  (around line 77) then snapshots that same process environment and hands
  it to `KUpdateLaunchEnvironmentJob` for the systemd `--user` resync. A
  value set this way is the resync's own input, not something the resync
  competes with - the opposite relationship `environment.d` had.
  - Nix-wrapper ordering: the `makeBinaryWrapper` `--prefix` chain that
    bakes a `QT_PLUGIN_PATH` default into `startplasma-wayland` runs once
    at `execve()`, before `main()` runs. By the time `main()` reaches
    `runEnvironmentScripts()`, `$QT_PLUGIN_PATH` is already populated with
    the wrapper's baked value, so the env script must prepend and preserve
    it (the `${QT_PLUGIN_PATH:+:$QT_PLUGIN_PATH}` guarded-expansion idiom),
    not assume it starts unset.
  - Confirmed no conflict: `~/.config/plasma-workspace/env/` did not exist
    on the host at the time of this investigation, and a repository-wide
    search of Home Manager configuration found zero references to
    `plasma-workspace`, so nothing else claims this directory.
  - `runEnvironmentScripts()` runs exactly once at session start with no
    live re-invocation mechanism, so - same as the superseded
    `environment.d` design - exactly one logout/login is still required
    after the first `effect-install`; this does not reduce the boundary
    count, it fixes whether the boundary actually works.
- Files / commit: none (investigation only).
- Verification: source-level citations above (`startplasma-wayland.cpp`
  `runEnvironmentScripts()`/`syncDBusEnvironment()`); confirmed absence of
  `~/.config/plasma-workspace/env/` and of any Home Manager reference to
  `plasma-workspace` on the host.
- Notes: this is a diagnostic unit only; Unit L implements the finding.

## Unit L - Accepted

- Replaced the `environment.d` mechanism outright (per user decision, not
  layered alongside it): `scripts/dogfood-install.sh`'s `EFFECT_ENV_FILE`
  now points at
  `$XDG_CONFIG_HOME/plasma-workspace/env/60-plasma-auto-tiler-native-effect.sh`
  (creating parent directories as needed); its content is
  `export QT_PLUGIN_PATH="<staging-root>${QT_PLUGIN_PATH:+:$QT_PLUGIN_PATH}"`,
  verified POSIX-sh-valid with `sh -n` and functionally correct under both
  an empty and a non-empty inherited `QT_PLUGIN_PATH` (tested directly with
  `sh -c` before writing the test-suite assertion, and covered by a new
  `sh -n` assertion in `dogfood-install.test.sh`).
- `effect-remove` now removes the new env script and the staging tree (as
  before) and additionally removes the legacy
  `~/.config/environment.d/60-plasma-auto-tiler-native-effect.conf` file if
  present, migrating cleanly; it touches no other file under
  `environment.d/`, and `10-home-manager.conf` was confirmed untouched
  (still a symlink into the Home Manager store path) both by a unit test
  and by direct host inspection after the live migration.
- `effect-status` is rewritten as a five-stage staged diagnostic - (a)
  staging, (b) env script present and current, (c) session delivery, (d)
  D-Bus discovery, (e) D-Bus loaded - each printed as an explicit pass/
  fail/could-not-determine line with guidance on what it means and what to
  do next, so a single post-logout run is conclusive. Stage (c) reads
  `/proc/<kwin_wayland-pid>/environ` directly rather than inferring
  delivery from `systemctl --user show-environment` (which Unit K/L
  established does not reflect what the *running* `kwin_wayland` process
  actually sees, since that process's own environment is set by the
  Nix-wrapped binary's own `execve()`-time `--prefix` logic, not by a live
  systemd query): it locates the process by scanning `/proc/[0-9]*/cmdline`
  for an `argv0` basename of exactly `kwin_wayland` (deliberately not
  `/proc/<pid>/comm`, which the Nix wrapper truncates to `.kwin_wayland-w`,
  and not `/proc/<pid>/exe`, which - see the readability finding below - is
  no more reliably readable than `environ` itself), then reads that PID's
  `environ`, degrading to an explicit "could not determine" (never a
  silent pass or fail) if the process cannot be found or its `environ`
  cannot be read. The old `SYSTEMCTL_BIN` cross-check from Unit J is
  removed entirely, since it is no longer a meaningful signal once the
  delivery mechanism itself changed.
  - Guidance is context-sensitive per the brief: stage (c) failing while
    stage (b) passes states plainly that a logout/login is pending or the
    env-script route did not work; stage (d) failing while stage (c)
    passed states plainly that the value reached KWin but the plugin was
    not loadable and points at the journal - the old blanket "a one-time
    logout/login is still required" note is never printed when stage (c)
    already proved delivery.
- Live host migration performed under standing authorization: ran
  `effect-install` for real (rebuilt and re-staged the plugin, created the
  new env script), then removed the legacy `environment.d` entry directly
  with `rm` (deliberately not via `effect-remove`, which would also have
  wiped the freshly staged state and new env script the user should be
  able to inspect before his next logout/login), then ran `effect-status`
  for real. Exact output and the current expected post-logout outcomes are
  reported to the Orchestrator/user in chat, not restated here.
- IMPORTANT DISCOVERY (reported, not silently resolved): direct testing
  during this unit found `/proc/<kwin_wayland-pid>/environ` is NOT
  reliably readable on this host - `cat` on the real running
  `kwin_wayland` process's `environ` returned `Permission denied`,
  contradicting Unit J's log claim that this file "was directly readable
  on this host." `kwin_wayland`'s `CapEff`/`CapPrm` show bit 23
  (`CAP_SYS_NICE`) set, which is consistent with the kernel's automatic
  non-dumpable transition at `execve()` for processes carrying elevated
  file capabilities - this blocks `/proc/<pid>/{environ,exe,mem}` reads for
  any reader who is not root or `CAP_SYS_PTRACE`, regardless of matching
  UID or `ptrace_scope`. The parent `kwin_wayland_wrapper` process's own
  `environ` remained readable, but was deliberately NOT substituted as a
  proxy for `kwin_wayland`'s, because `kwin_wayland` is itself a further
  Nix-wrapped binary (confirmed via its own `.kwin_wayland-w` truncated
  `comm`) whose own `--prefix` logic could differ from its parent's - using
  the parent's value would have been an unstated assumption, which the
  brief explicitly prohibits ("never silently assume"). This means stage
  (c) may remain "could not determine" even after the user's next
  logout/login; this is documented as a known limitation (see Residual
  Risks) with stage (d) as the fallback authoritative signal, not treated
  as a defect to paper over.
- Backfilled a Unit K record above (see its note) since the Unit L brief
  referenced Unit K findings that were never written to `plan.md`/`log.md`.
- Corrected residual-risk and evidence text from Units A, B, and J above
  (marked "FURTHER SUPERSEDED by Unit L" / "SUPERSEDED by Unit L" /
  "NOTE (backfilled by Unit L)" inline at each affected bullet) rather than
  rewriting history silently.
- Files / commit: `scripts/dogfood-install.sh`, `scripts/dogfood-install.test.sh`,
  `README.md`, `docs/live-kwin-testing.md`, `docs/changes/host-dogfooding/{plan,log}.md`
  - all uncommitted.
- Verification: 281/281 `dogfood-install.test.sh` pass (was 246/246; net +35
  assertions: removed the `SYSTEMCTL_BIN` probe and its two branch tests,
  added `sh -n` validation of the env script and full coverage of the five
  new `effect-status` stages including the legacy-migration path in
  `effect-remove`); `bash -n` on the full script; `markdownlint-cli2` run on
  `README.md` and `docs/live-kwin-testing.md` before (`HEAD` copies) and
  after editing: 30 pre-existing issues in both cases, 0 new, and both
  edited spans are outside any of the pre-existing flagged lines.
- Out of this unit's scope (reported, not edited): `docs/decisions.md`
  "Native Effect Live Validation" and `docs/changes/host-dogfooding/spec.md`
  still describe the superseded `environment.d` mechanism; the Unit L brief
  named only `README.md` and `docs/live-kwin-testing.md` for this
  correction. Both are now inconsistent with the implementation and should
  be corrected by whichever Lead next has file scope over them.
- 1 attempt; no re-dispatch needed (executed directly by the Lead per the
  brief's explicit worker-anthropic-only constraint and the corpus-ownership
  precedent - the investigation and implementation were tightly coupled to
  the same source material already loaded for scoping).

## Unit M - Accepted

- Documentation-correction unit closing the two gaps Unit L itself reported
  as out of its file scope, plus retracting an unsound evidence claim from
  Unit J. Executed directly by the Lead (not dispatched) - all four files
  were already fully loaded for scoping the exact fragments, so dispatch
  would have duplicated cost per the Unit A corpus-ownership precedent.
- `docs/decisions.md` "Native Effect Live Validation": Scope clause's
  "creating and removing exactly one uniquely-named `~/.config/environment.d`
  entry owned by this project" replaced verbatim with "creating and removing
  exactly one uniquely-named session environment script under
  `~/.config/plasma-workspace/env/` owned by this project, and removing the
  superseded `~/.config/environment.d` entry of the same name", per the
  user-approved exact wording; Consequences clause's "after the environment
  entry is first created" changed to "after the session environment script
  is first created"; the prohibition on editing any `~/.config/environment.d`
  entry other than our own left untouched, as required (it remains valid -
  the legacy entry still exists on this host pending migration by
  `effect-remove`). Both paragraphs rewrapped by hand at the file's existing
  ~80-column, 2-space-hanging-indent style; no other content in the file
  touched.
- `docs/changes/host-dogfooding/spec.md`: every place describing
  `~/.config/environment.d` as the current discovery route (Scope, the
  "User-issued narrowed host-mutation policy" and "Effect discovery
  mechanism" bullets under Applicable Principles, the Constraints section's
  reasoning about why an `environment.d` entry would reach `kwin_wayland`,
  and the Acceptance Criteria/Unresolved Questions/Consequential Decisions
  bullets that named it) corrected to describe the delivered
  `~/.config/plasma-workspace/env/` mechanism, each marked inline (e.g.
  "CORRECTED per Unit M") rather than silently rewritten, so the superseded
  `environment.d` mechanism remains identifiable in the text. The spec's
  structure and non-goals were not touched. The Constraints section's
  incorrect reasoning (that indirect evidence about Home Manager's
  `home.sessionVariables` implied an `environment.d` entry would "survive at
  the tail of the final `QT_PLUGIN_PATH`") is explicitly flagged as wrong,
  not merely updated, since Units J/K/L disproved it with direct evidence
  and source reading - replaced with Unit K's source-cited
  `runEnvironmentScripts()`/`syncDBusEnvironment()` mechanism.
- Unit J retraction: the `/proc/<kwin_wayland-pid>/environ`-was-"directly
  readable"-and-confirmed-`kwin_wayland`'s-own-value claim in both Unit J's
  plan.md section and the pre-existing Residual Risks entry about the
  Unit J/Unit L contradiction is marked RETRACTED inline, not deleted:
  `CAP_SYS_NICE`-forced non-dumpability at `execve()` is a deterministic
  kernel property of the process's file capabilities, not
  session/timing/boot-dependent as the Residual Risks entry had hedged, so
  the "contradiction" is resolved as Unit J's claim being unsound (most
  likely an unstated read of the readable parent `kwin_wayland_wrapper`
  process instead). The H2 root-cause conclusion itself is explicitly NOT
  retracted: it is called out as still standing on the `systemctl --user
  show-environment` evidence (unaffected - a D-Bus/systemctl query, not a
  `/proc/<pid>/environ` read) and the source-level `KUpdateLaunchEnvironmentJob`
  mechanism, independently corroborated by Unit K's separate reading of
  `startplasma-wayland.cpp`. `log.md` is append-only per its own header, so
  the original Unit J log entry was left byte-for-byte unedited; the
  retraction is recorded only as a new dated log entry for this unit,
  consistent with how Unit K's findings were later recorded as a new entry
  rather than an edit to an earlier one.
- Sweep of `plan.md`/`log.md` for other residual-risk/acceptance/evidence
  statements from Units A-I asserting the `environment.d` mechanism worked
  or would work after one boundary: Units A and B's Residual Risks entries
  and Unit J's Residual Risks entry were already correctly annotated
  "SUPERSEDED by Unit L"/"FURTHER SUPERSEDED by Unit L" by the Unit L Lead;
  no further correction needed there. Found and corrected one additional
  stale statement: Unit C's own "Accepted" evidence bullet described the
  `docs/live-kwin-testing.md` Native Effect Host Session-Boundary Exception
  section as stating the effect works "after `effect-install` first creates
  the `environment.d` entry" - accurate as a historical record of what Unit
  C wrote at the time, but Unit L later rewrote that same section of the
  live document; marked with a "SUPERSEDED by Unit L (per Unit M sweep)"
  note rather than rewritten, since it is Unit C's own historical record,
  not a claim about the document's current content. Unit B's own "Accepted"
  section (`Env entry: $XDG_CONFIG_HOME/environment.d/...`) and the
  Acceptance-Criterion Evidence table's Unit B row were left unedited: both
  are purely past-tense factual records of what Unit B built at the time
  (not forward-looking "worked or would work" claims), matching the
  standard the rest of the document already applies to historical unit
  records.
- Confirmed Units K, L, and M are all properly recorded as work units in the
  Work Units table and the Progress checklist with acceptance status: K and
  L were already present (K backfilled by the Unit L Lead, L accepted by
  that same Lead); M added to both by this unit.
- Repository-wide search (`grep -rl environment\.d docs/`) shows exactly
  seven files under `docs/` mention `environment.d` at all:
  `docs/decisions.md`, `docs/changes/host-dogfooding/{spec,plan,log}.md`
  (all four edited by this unit), `docs/live-kwin-testing.md` and the two
  archived files under
  `docs/changes/archive/2026-08-18-native-effect-host-live-runner/`. No
  other file under `docs/` mentions it. `docs/live-kwin-testing.md` (edited
  by Unit L, out of this unit's scope to touch) already correctly describes
  `~/.config/plasma-workspace/env/` as the current mechanism and the legacy
  `environment.d` entry as something migrated away, not the working
  mechanism - confirmed by reading its three matching lines directly, not
  just the grep hit. The two archived files describe the archived
  `native-effect-host-live-runner` protocol's own nonce-owned
  `environment.d` design, which was that protocol's own (different,
  never-completed, already-superseded) approach and is not presented as
  this change's current mechanism; reported here per the brief rather than
  edited, since editing archived files is outside this unit's named scope.
  `README.md` (not under `docs/`) was also checked and has zero mentions of
  `environment.d` as a currently-working mechanism (only in the context of
  migration cleanup, per Unit L's edit).
- Files / commit: `docs/decisions.md`, `docs/changes/host-dogfooding/spec.md`,
  `docs/changes/host-dogfooding/plan.md`, `docs/changes/host-dogfooding/log.md`
  - all uncommitted.
- Verification: `npx markdownlint-cli2` run on all four edited files.
  `docs/decisions.md` and `docs/changes/host-dogfooding/log.md` report 0
  issues; `docs/changes/host-dogfooding/spec.md` reports the same 1
  pre-existing MD032 issue at line 4 (unrelated, untouched by this unit).
  `docs/changes/host-dogfooding/plan.md` reports 40 issues, all
  MD013/MD032/MD060 confined to the Work Units table (lines 20-34) and its
  intro line 4 - the same pre-existing pattern as every other row in that
  table (compact-table-pipe-style and over-length single-cell rows), plus
  exactly one new instance of that same pre-existing MD013 pattern at line
  34 for the new M row this unit added to the table (not a new category of
  issue). None of the prose paragraphs this unit edited or added (Unit J
  bullet, Residual Risks entry, Unit C bullet, this Unit M section,
  Progress checklist) introduced any MD013/MD032 issue - all wrapped within
  the file's existing ~80-column convention.
- 1 attempt; no re-dispatch needed.

## Unit N - Accepted

- Trigger: the user logged out and back in (a real session boundary). Unit
  M's pre-boundary `effect-status` had already shown stages (a)/(b)/(d)
  `yes` and (c) "could not determine" (expected, per Unit L's `CAP_SYS_NICE`
  finding); stage (e) (`isEffectLoaded`) was `no` because `effect-reload`
  had never been run for real. This unit's job was to run it and interpret
  the result.
- `effect-reload` run for real on host (`devenv shell --impure -- bash
  scripts/dogfood-install.sh effect-reload`): output `reloaded:
  plasma-auto-tiler-active-border is loaded`. Re-ran `effect-status`
  immediately after: `[e] loaded: yes - isEffectLoaded reports true`; `[d]
  discovery: yes` (unchanged); `[c]` still "could not determine" (expected,
  same `CAP_SYS_NICE`-forced non-dumpable `kwin_wayland` limitation Unit L
  documented - not a regression).
- Evidence the effect is loaded and active, not merely registered
  (read-only D-Bus queries, all direct, none inferred): `org.kde.kwin.
  Effects.activeEffects` lists `plasma-auto-tiler-active-border` alongside
  `blur`; `org.kde.kwin.Effects.loadedEffects` lists it among ~30 loaded
  effects. `journalctl --user -b` around the load shows exactly three
  occurrences (matching three load attempts across this and prior units) of
  one benign KPluginMetaData informational message ("explicitly states an
  'Id' in the embedded metadata... will not be affected by it") and no
  error, crash, or plugin-load-rejection message for this plugin.
- Renderer/compositing backend, established directly (not assumed):
  `org.kde.KWin.supportInformation` on `/KWin` reports `Compositing Type:
  OpenGL`, `OpenGL renderer string: Mesa Intel(R) Iris(R) Xe Graphics (TGL
  GT2)`, confirming this session uses the OpenGL-capable path the effect's
  constructor gates on (`m_isOpenGL = effects->isOpenGLCompositing()` in
  `activewindowborder.cpp:13`). Queried `org.kde.kwin.Effects.
  supportInformation("plasma-auto-tiler-active-border")` directly per the
  brief: it returns only the effect name with no body (the effect does not
  override `Effect::supportInformation()`, so this is empty by design, not
  an error) - not decisive on its own, but consistent with (not
  contradicting) the OpenGL/loaded/active evidence above.
- Config-key question (source-read, not assumed): read `activewindowborder.
  cpp`/`.h`, `activeborderlogic.h`, `metadata.json`, and `CMakeLists.txt` in
  full. Finding: **no config key gates rendering**. The effect contains no
  `KConfigGroup`/`readConfig()`/`reconfigure()` code at all, and
  `CMakeLists.txt` defines no `.kcfg` config schema. `metadata.json`'s
  `"EnabledByDefault": false` only controls whether KWin's own
  `EffectLoader` auto-loads the plugin at session start by consulting
  `kwinrc`'s `[Plugins]` group - it has no effect on the C++ runtime logic
  once the plugin is loaded, and `effect-reload`'s explicit `loadEffect`
  D-Bus call bypasses that auto-load gate entirely (this is the documented,
  intended mechanism for a `EnabledByDefault: false` dogfood effect, not a
  workaround). The only runtime gates on the border actually painting are
  (1) `m_isOpenGL` (confirmed true this session, above) and (2)
  `activeBorderState()` in `activeborderlogic.h:14-20`: the border is
  visible only for the currently-active window, and only while that window
  is not deleted, not minimized, and not fullscreen. No `kwriteconfig6`
  call was made this unit - none was needed, and reporting "no config key
  required" is itself the finding, not a hedge.
- Explicitly NOT claimed: whether the border is visually rendering.
  `activeEffects`/`loadedEffects` and `Effect::isActive()`'s default
  (`true` unless an effect overrides it, which this one does not) establish
  that the effect is loaded and not self-declared idle - they do not
  constitute visual confirmation, and none was attempted or inferred. Only
  the user, looking at the screen, can confirm the border is visible.
- Files / commit: none (live D-Bus operations only: one `effect-reload`
  run, several read-only `/Effects` and `/KWin` D-Bus queries, one
  `journalctl --user -b` read). No source, script, or documentation file
  changed by this unit.
- Verification: `effect-status` re-run showed `[e] loaded: yes` immediately
  after `effect-reload`, independently corroborated by direct
  `activeEffects`/`loadedEffects` D-Bus queries and the journal read (three
  independent signals, not just the script's own self-report); compositing
  backend confirmed via `org.kde.KWin.supportInformation`, not assumed from
  `isEffectSupported` alone; config-key conclusion is a direct, complete
  read of all four effect-source files, not an inference from behavior.
- 1 attempt; executed directly by the Lead (not dispatched) per this unit's
  brief - almost entirely host D-Bus/journal queries and source reads, not
  editing, so dispatch would have duplicated the investigation cost with no
  editing benefit.

## Final Outcome

- A, B, C, D, and E accepted in an earlier stint; F and G accepted in the
  following stint; H and I accepted a later stint. All nine work units this
  Lead had scoped for `host-dogfooding` were accepted at that point. No
  unit was committed; the user has not lifted the no-commit restriction.
- Unit J: diagnosed a real post-reboot host failure the user reported. Root
  cause found and confirmed with direct evidence (see Unit J). The in-scope
  part of the fix at the time (self-diagnosing `effect-status` output) was
  applied and tested (246/246); the durable fix was reported as an open
  blocker outside that Lead's authorized scope.
- Units K and L: resolved Unit J's blocker. Unit K identified the correct
  delivery mechanism (`~/.config/plasma-workspace/env/`, source-cited).
  Unit L implemented it, replacing `environment.d` outright, migrated the
  host live, and rewrote `effect-status` as a five-stage self-diagnosing
  report that reads `kwin_wayland`'s own environment directly. The native
  effect's discoverability is still **not yet confirmed working end to
  end** - it remains pending the user's next logout/login, same as before
  - but the structural blocker Unit J found is resolved, and Unit L
  documented a newly-discovered limitation (stage (c) may stay
  inconclusive due to `kwin_wayland`'s non-dumpable process state on this
  host) so that outcome, if it occurs, is not mistaken for a regression.
  The KWin-script path (confirmed working by the user) is unaffected by
  any of this.
- Unit M: documentation-only correction closing the two gaps Unit L
  reported as outside its file scope (`docs/decisions.md` and `spec.md`
  still describing the superseded `environment.d` mechanism) and retracting
  Unit J's unsound `/proc/<kwin_wayland-pid>/environ` evidence claim once
  Unit L's finding (the read is blocked deterministically by
  `CAP_SYS_NICE`-forced non-dumpability, not by session/timing/boot state)
  was recognized as resolving, not merely reporting, that earlier
  contradiction. No mechanics, scripts, or non-doc files changed; no commit
  or push performed. The native effect's end-to-end discoverability is
  still unverified pending the user's next logout/login, unchanged by this
  unit.
- Unit N: the user's logout/login happened. `effect-reload` run for real
  confirmed the plugin loads (`isEffectLoaded: true`), corroborated
  independently via `activeEffects`/`loadedEffects`/journal, closing the
  gap Units L/M left open ("still not yet confirmed working end to end").
  Source reading confirmed no config key gates the border's runtime
  painting logic, and this session's compositing backend is OpenGL, so
  nothing found in the source or the live D-Bus/journal evidence explains
  an absent border under default settings for a normal, focused,
  non-minimized, non-fullscreen window. Whether the border is actually
  visible remains solely the user's call - not established, and not
  claimed, by this unit.
