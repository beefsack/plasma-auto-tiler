# Specification: Simple Install (dogfood documentation + one-command setup)

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-19 by Orchestrator/user (initial directive specified
  exact scope, constraints, and acceptance criteria; the native-effect
  graceful-degradation design was explicitly delegated to the Lead to decide
  and justify here, per the directive's "Decide and justify..." instruction).
  Stages 3 and 4 below were added 2026-08-19 under a separate Orchestrator
  directive that explicitly approved this spec edit and superseded the
  original Stage 3/4 non-goals; the change stays open to absorb them rather
  than being archived after Stage 1/2.

## Intent and Desired Outcome

Two independent, additive improvements to the existing dogfood install path
(`scripts/dogfood-install.sh`), with no change to product behavior (KWin
script or native effect logic):

1. **Documentation accuracy.** `README.md` currently implies, at
   `README.md:279-283`, that after one logout/login boundary the native
   effect stays live forever ("every later rebuild and `effect-reload` is
   live over D-Bus with no further boundary"). That sentence is true for the
   *env-script delivery mechanism* (`QT_PLUGIN_PATH` via
   `~/.config/plasma-workspace/env/`), but the effect's *loaded* state is
   separate and does not survive a reboot or logout/login at all:
   `kwin/native-effect/metadata.json:6` sets `"EnabledByDefault": false`, no
   `kwinrc [Plugins]` key is ever written for the effect, and no autostart
   hook exists anywhere in the repo. `effect-reload` must be re-run by hand
   after every reboot or logout/login, not just once. Fix this
   misunderstanding without deleting the true statement it's built on, make
   the full install process (including the one required logout/login)
   documented end to end, and correct a stale `docs/backlog.md:37` line that
   still says native-effect live acceptance is pending that boundary when
   `docs/changes/host-dogfooding/plan.md` Unit N already confirmed live
   end-to-end loading on this host.
2. **One-command install.** Today a full working setup requires four
   separate invocations (`install`, `enable`, `effect-install`,
   `effect-reload`). Add one thin wrapper subcommand that composes exactly
   those four existing, already-tested operations, so a fresh checkout gets
   to a working session in one command, with clear reporting of what remains
   manual.
3. **Persistent native-effect enablement (Stage 3).** The native effect
   currently never survives a reboot or logout/login: `effect-reload` must be
   re-run by hand every time. Research (`inv-03`) established that KWin's
   `PluginEffectLoader` reads the exact same `[Plugins] <id>Enabled` kwinrc
   convention already used for the KWin script (`AbstractEffectLoader::
   readConfig()`), so writing `[Plugins]
   plasma-auto-tiler-active-borderEnabled=true` is the upstream-standard,
   reversible mechanism for persisting enablement across session starts, with
   a documented out-of-tree precedent. Add this write to `effect-install` and
   its exact removal to `effect-remove`, guard the fragile filename-derived
   plugin-ID linkage this depends on, and correct `README.md`'s now-stale
   "re-run after every reboot" claim. This is a live-unverified mechanism
   change: `inv-03` could not observe a real session start, so the plugin's
   actual auto-discovery/auto-load at session start remains an unverified
   acceptance criterion pending a user-run logout/login.
4. **Non-Nix build path (Stage 4).** `kwin/native-effect/CMakeLists.txt`
   already builds with a plain `find_package(KWin REQUIRED)`; only
   `scripts/dogfood-install.sh` layers a pinned Nix store `-DKWin_DIR=`
   override on top. Document the non-Nix path (distro KWin dev package, plain
   `cmake`, rebuild required every Plasma upgrade, no cross-distro/version
   portable binary) and make the script use its pinned override only when
   that exact path exists on disk, falling through to plain `find_package`
   resolution otherwise. `devenv.nix`'s own pin is unchanged and out of
   scope: its exact-ABI match to the running `kwin` is deliberate given
   KWin's zero ABI guarantee.

## Scope and Non-Goals

In scope:

- Fix `README.md` so it plainly and prominently states that the native
  effect must be `effect-reload`ed again after every reboot or logout/login.
- Correct `README.md:279-283`'s misleading implication in place, preserving
  the true statement it makes about the env-script boundary.
- Document the full install process end to end, including the one required
  logout/login.
- Update the stale `docs/backlog.md:37` entry to match
  `docs/changes/host-dogfooding/plan.md`'s Final Outcome (Unit N).
- Add one new thin wrapper subcommand to `scripts/dogfood-install.sh` that
  composes the existing `install`, `enable`, `effect-install`, and
  `effect-reload` operations into a single invocation, with clear per-stage
  output and an explicit "what remains manual" summary.
- Extend `scripts/dogfood-install.test.sh` to cover the new subcommand,
  matching the existing fake-tool test style.

In scope, added for Stage 3 and Stage 4:

- Writing `[Plugins] plasma-auto-tiler-active-borderEnabled=true` via
  `kwriteconfig6` in `effect-install`, and removing that exact key in
  `effect-remove`, mirroring the existing KWin-script `[Plugins]` pattern.
  No autostart hook, `.desktop` file, or systemd unit of any kind.
- Guarding the filename-derived plugin-ID linkage (CMake target name -> `.so`
  filename -> KWin's runtime plugin ID) the new kwinrc key depends on: a
  single source of truth for the ID inside `dogfood-install.sh`, an
  explanatory comment, and a test asserting the CMake target name,
  `metadata.json`'s `KPlugin.Id`, and the kwinrc key all agree.
- Correcting `README.md`'s "re-run `effect-reload` after every reboot"
  claim to state what Stage 3 makes automatic and what remains manual and
  live-unverified.
- Documenting the non-Nix build path in `README.md`: distro KWin dev
  package, plain `cmake` with no `-DKWin_DIR` override, honest rebuild-every-
  upgrade and no-cross-distro-portability statements.
- Making `scripts/dogfood-install.sh`'s pinned `-DKWin_DIR=` override
  conditional on that exact pinned path existing on disk (one conditional),
  falling through to plain `find_package` resolution otherwise; covered in
  `scripts/dogfood-install.test.sh`.

Non-goals (explicitly out of scope; do not touch, design, or spec):

- Any Nix, NixOS, or Home Manager packaging, derivation, flake output, or HM
  module. No read or write under `~/Development/dotfiles-nix`.
- `devenv.nix`. Its literal `builtins.storePath` pin (`devenv.nix:15-16`) is
  kept exactly as-is by explicit user ruling: its exact-ABI match to the
  running `kwin` is the point, and a mismatch is a live crash risk given
  KWin's zero ABI guarantee.
- The `kpackage-distribution` artifact path (`scripts/build-kpackage.sh`) and
  its divergence from `dogfood-install.sh`; recorded as a residual risk only.
- Renaming `dogfood-install.sh` or restructuring its existing subcommands.
- `kwin/src/controller.ts`, `kwin/tests/controller.test.ts`, and anything
  under the separate, in-flight `docs/changes/trailing-empty-workspace/`
  change.
- Any change to product behavior: the KWin script and native effect's
  runtime rendering/tiling logic, and all native C++ source, are unchanged.
  The "Native C++ Safety Policy" decision constrains that surface tightly and
  nothing here needs it.
- Reconciling how the QML effect API might do any of this: not applicable
  per the existing Active Window Border decision.

## Applicable Principles and Decisions

- `docs/decisions.md#native-effect-live-validation` - the new subcommand's
  operations (build, stage, D-Bus `loadEffect`/`unloadEffect`,
  `kwriteconfig6`/`qdbus6` enable/reconfigure) are a strict composition of
  operations already inside this decision's standing-authorized envelope. No
  new operation category is introduced. The Stage 3 kwinrc `[Plugins]`
  enablement key for the native effect is covered by this decision's
  user-approved 2026-08-19 amendment, which names writing this project's own
  `[Plugins]` enablement keys for both the KWin script and the native effect
  as standing-authorized and reversible.
- `docs/decisions.md#core-distribution` - background only; this change does
  not touch the script KPackage or native package paths and introduces no
  conflict.
- `docs/decisions.md#native-c++-safety-policy` - background only; Stage 3 and
  4 touch no C++ source, so this decision's constraints are unaffected and
  not exercised.
- `docs/live-kwin-testing.md` Safety Boundary and Native Effect Host
  Session-Boundary Exception - the new subcommand must stay inside the
  reversible, user-local envelope and must never simulate or perform a
  session boundary itself. Stage 3's kwinrc key write is a config-file write
  already inside the standing-authorized `kwriteconfig6` operation category;
  it does not perform or simulate a session boundary, and the one required
  boundary for native-effect discovery is unchanged.

## Constraints

- The new subcommand is a **thin composition** of existing, already-tested
  code paths (`cmd_install`, `cmd_enable`, `cmd_effect_install`,
  `cmd_effect_reload`). It must not reimplement, refactor, or otherwise
  change the behavior of those functions, add new install locations, or add
  new host-mutation categories.
- `install` and `enable` remain the required, fail-fast half: a real failure
  in either aborts the whole command with a non-zero exit, exactly as it
  does today when those commands are run standalone (via the script's
  existing `set -euo pipefail` propagation - no new error handling needed
  for this half).
- The native-effect half (`effect-install`, `effect-reload`) must never abort
  the whole command. When it cannot run - for example `cmake` (or another
  build prerequisite) is unavailable because the caller is not inside
  `devenv shell --impure` - or when `effect-reload` correctly reports the
  expected pending-boundary state, the command still completes, reports the
  KWin-script half as done, and states plainly what remains manual.
- No new destructive or irreversible operation. Every operation the new
  subcommand performs is one already covered by
  `docs/decisions.md#native-effect-live-validation`'s standing authorization.
- Match the existing test file's fake-tool harness style
  (`reset_state`/`run_script`/`assert_*` helpers, `FAKE_QDBUS_SUPPORTED`,
  the `cmake-fail` state marker, etc.) rather than introducing a new test
  pattern.
- Commit protocol (per this session's standing authorization): commit and
  push directly, conventional-commit subject line only (no body), stage
  exactly the intended files. Never `git add -A` or `git add .`. Never stage
  `CMakeFiles/`, `Project Technical Report and Implementation Plan.md`, or
  `test-output`. The `docs/decisions.md` amendment is its own commit,
  separate from any Stage 3/4 feature commit.
- Stage 3 adds no autostart hook, `.desktop` file, or systemd unit; the
  kwinrc `[Plugins]` key is the only persistence mechanism, and
  `effect-remove` must remove it exactly (no broader cleanup).
- Stage 3's kwinrc key write must not itself claim or attempt to prove live
  session-start auto-discovery/auto-load; that requires a user-run
  logout/login and is recorded as an unverified acceptance criterion.
- Stage 4's `-DKWin_DIR=` override change is exactly one conditional
  (existence check) with a sensible default; no other branching complexity.
  `devenv.nix` is not modified.
- No change to native C++ source (`kwin/native-effect/*.cpp`/`*.h`) in
  either stage.

## Acceptance Criteria

- [x] `README.md` plainly and prominently states the native effect must be
      `effect-reload`ed again after every reboot or logout/login, because
      `EnabledByDefault` is `false` and nothing auto-loads it.
- [x] `README.md:279-283`'s misleading implication is corrected in place; its
      true statement (no further *env-script* boundary after the first) is
      preserved, not deleted.
- [x] `README.md` documents the full install process end to end in one
      place, including the one required logout/login and its scope (native
      effect only, not the KWin script).
- [x] `docs/backlog.md:37` matches `docs/changes/host-dogfooding/plan.md`'s
      Final Outcome (Unit N: live end-to-end native-effect loading already
      confirmed on this host; only eyeball visual confirmation remains
      unclaimed).
- [x] One new subcommand exists in `scripts/dogfood-install.sh` (name
      decided below) that composes exactly `install`, `enable`,
      `effect-install`, `effect-reload`, with no reimplementation of their
      logic, no new install location, and no new host-mutation category.
- [x] The new subcommand degrades gracefully when the native-effect half
      cannot run: the KWin-script half still completes, is reported clearly,
      and the overall command still exits 0 - it never fails wholesale
      because of the optional half.
- [x] The new subcommand's output states exactly what remains manual (the
      one-time logout/login before the first `effect-reload` can load the
      effect, and the standing per-reboot/per-logout `effect-reload`
      requirement thereafter).
- [x] `scripts/dogfood-install.test.sh` covers the new subcommand: full
      success path, graceful degrade when the native-effect build tool is
      unavailable, the expected pending-boundary `effect-reload` outcome,
      and a hard failure in the required `install`/`enable` half.
- [x] `bash scripts/dogfood-install.test.sh` passes in full (baseline before
      this change: 281 passes, 0 failures).
- [x] `npm --prefix kwin run typecheck` and the KWin test suite are
      unaffected (baseline: 815/815 passing, clean typecheck on both
      tsconfigs at HEAD `4a3c044`) - expected, since no file under `kwin/`
      is touched by this change.
- [x] Nothing out-of-scope (see Non-goals) is touched.

Stage 3 (persistent native-effect enablement):

- [x] `docs/decisions.md`'s "Native Effect Live Validation" Scope and
      Consequences paragraphs are amended exactly as user-approved, verbatim
      apart from whitespace/line-wrapping; nothing else in that file changes.
- [x] `effect-install` writes `[Plugins]
      plasma-auto-tiler-active-borderEnabled=true` via `kwriteconfig6`;
      `effect-remove` removes that exact key; no other kwinrc key or file is
      touched by either.
- [x] No autostart hook, `.desktop` file, or systemd unit is created.
- [x] The plugin-ID linkage (CMake target name, `metadata.json`
      `KPlugin.Id`, kwinrc key) is guarded by a single source of truth for
      the ID inside `dogfood-install.sh`, an explanatory comment on the
      fragility, and a test asserting all three agree.
- [x] `README.md` no longer tells the user to re-run `effect-reload` after
      every reboot as an unconditional requirement; it states plainly what
      Stage 3 makes automatic (persistence via the kwinrc key, once
      discovered) and what remains manual (the one-time discovery boundary;
      rebuild-then-`effect-reload` for a live code change within a session).
- [x] `scripts/dogfood-install.test.sh` covers: `effect-install` writes the
      key, `effect-remove` removes it, and the plugin-ID consistency check.
- [x] Live session-start auto-discovery/auto-load of the persisted effect is
      recorded in `plan.md` as an unverified acceptance criterion (needs a
      user-run logout/login) and is not claimed as proven anywhere.

Stage 4 (non-Nix build path documentation):

- [x] `README.md` documents installing the distro KWin dev package and
      running plain `cmake` with no `-DKWin_DIR` override, honestly stating
      a rebuild is needed after every Plasma upgrade and no prebuilt binary
      is portable across distros or KWin versions; distro package names not
      directly verified by `inv-03` are worded as "typically", not fact.
- [x] `scripts/dogfood-install.sh`'s `-DKWin_DIR=` override is used only when
      the pinned path exists on disk; otherwise `cmake` runs without it
      (plain `find_package` resolution), via exactly one conditional.
- [x] `scripts/dogfood-install.test.sh` covers both branches of that
      conditional.
- [x] `devenv.nix` is unchanged.

## Unresolved Questions

Stage 1/2: none. The directive scoped that change exactly, including the
exit-code and graceful-degradation design, which this Lead resolved under
Consequential Decisions below.

Stage 3/4: none blocking implementation. The one open item - whether the
kwinrc-key mechanism actually auto-loads the effect at a real session start -
is not a question to resolve here; it is an acceptance criterion this change
cannot verify itself (user-run session boundary only) and is recorded as
such rather than guessed at.

## Consequential Decisions

- **New subcommand name: `setup`.** Chosen to read naturally as
  `bash scripts/dogfood-install.sh setup` and to avoid any collision with
  the existing `install`/`effect-install` verbs (which already mean "build
  and stage one specific artifact", not "get me a working session").
- **Graceful degradation and exit-code design**, directly answering the
  directive's "decide and justify" instruction:
  - `install` and `enable` run first, called directly (not in a subshell).
    Because the script has `set -euo pipefail`, a real failure in either
    (for example a build error, or a missing `kwriteconfig6`) terminates
    `setup` immediately with a non-zero exit, identically to running that
    command standalone today. This is intentional: these two are the
    required, always-available half (they need no `devenv shell --impure`
    and no native toolchain), so `setup` holds them to the same fail-fast
    standard as every other command in this script.
  - `effect-install` and `effect-reload` each run inside `( ... )` subshell
    invocations of the *exact same, unmodified* `cmd_effect_install`/
    `cmd_effect_reload` functions. A subshell's `exit` only terminates that
    subshell; `setup` captures its exit status via a plain `if`/`else`
    (which `set -e` does not trigger on), so a missing `cmake`, a real build
    failure, or the expected "not yet discovered, needs a logout/login"
    `effect-reload` outcome never aborts `setup` - it is caught, reported,
    and `setup` proceeds to its summary. This reuses `require_tool`'s
    existing missing-tool detection and message verbatim rather than adding
    a parallel "is cmake available" probe, keeping the composition thin.
  - `setup` exits 0 whenever `install` and `enable` both succeeded,
    regardless of the native-effect stage's outcome, because an unavailable
    build toolchain or a pending first-boundary `effect-reload` are both
    expected, non-error steady states of this project (documented in
    `README.md` and `docs/live-kwin-testing.md` already) - not defects. A
    non-zero exit is reserved for a genuine failure in the required
    KWin-script half, matching every other command in this script.
  - `setup` always ends with a summary block naming each stage's outcome
    (`ok`/`skipped`/`pending-boundary`/etc.) and an explicit "what remains
    manual" section, so a caller never has to infer state from scattered
    stage output.

Stage 3/4, added 2026-08-19:

- **Plugin-ID single source of truth: reuse the existing `EFFECT_PLUGIN_ID`
  shell variable, do not build cross-file tooling.** `dogfood-install.sh`
  already holds one `EFFECT_PLUGIN_ID` constant that names the staged `.so`
  filename and the D-Bus effect name. The new kwinrc key is derived from
  that same variable (`${EFFECT_PLUGIN_ID}Enabled`) rather than a second
  literal, so within the script there is exactly one place this identifier
  is spelled out. The deeper cross-file risk - this literal, the CMake
  target name, and `metadata.json`'s `KPlugin.Id` must all agree, because
  KWin derives the runtime plugin ID from the built `.so` filename, not
  `metadata.json` - is not solvable by a single shared source file without
  new build-time codegen the spec's Constraints rule out as over-engineering
  for a three-line identifier. Instead it is guarded by an explanatory
  comment plus a dedicated test that reads all three real files and asserts
  they agree, so drift fails a test rather than failing silently at runtime.
- **`-DKWin_DIR=` existence check needs one new test-only override, matching
  the script's existing `DOGFOOD_*` pattern.** The pinned Nix store path is
  a literal that happens to exist on this dev host today, so a hermetic test
  cannot assert both branches of the conditional against the literal alone.
  `KWIN_DEV_CMAKE_DIR` becomes `"${DOGFOOD_KWIN_DEV_CMAKE_DIR:-<literal
  pinned path>}"`, following the same test-only-override convention already
  used for `DOGFOOD_DATA_ROOT`/`DOGFOOD_CONFIG_ROOT`/
  `DOGFOOD_KWIN_ENVIRON_FILE`/`DOGFOOD_KWIN_NOT_RUNNING`. Real invocations
  with the variable unset are byte-identical to today's behavior whenever
  the pinned path exists, which it does inside `devenv shell --impure`.

Implementation does not begin until the specification is approved unless
autonomous mode was explicitly requested.
