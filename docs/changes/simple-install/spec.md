# Specification: Simple Install (dogfood documentation + one-command setup)

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-19 by Orchestrator/user (initial directive specified
  exact scope, constraints, and acceptance criteria; the native-effect
  graceful-degradation design was explicitly delegated to the Lead to decide
  and justify here, per the directive's "Decide and justify..." instruction)

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

Non-goals (explicitly out of scope; do not touch, design, or spec):

- A login autostart hook to auto-load the native effect (Stage 3). Nothing
  under `~/.config/autostart/` is created or modified.
- Cross-machine portability of the native effect build (Stage 4). No change
  to `devenv.nix`.
- Any Nix, NixOS, or Home Manager packaging, derivation, flake output, or HM
  module. No read or write under `~/Development/dotfiles-nix`.
- The `kpackage-distribution` artifact path (`scripts/build-kpackage.sh`) and
  its divergence from `dogfood-install.sh`; recorded as a residual risk only.
- Renaming `dogfood-install.sh` or restructuring its existing subcommands.
- `kwin/src/controller.ts`, `kwin/tests/controller.test.ts`, and anything
  under the separate, in-flight `docs/changes/trailing-empty-workspace/`
  change.
- Any change to product behavior: the KWin script and native effect's
  runtime logic are unchanged.

## Applicable Principles and Decisions

- `docs/decisions.md#native-effect-live-validation` - the new subcommand's
  operations (build, stage, D-Bus `loadEffect`/`unloadEffect`,
  `kwriteconfig6`/`qdbus6` enable/reconfigure) are a strict composition of
  operations already inside this decision's standing-authorized envelope. No
  new operation category is introduced.
- `docs/decisions.md#core-distribution` - background only; this change does
  not touch the script KPackage or native package paths and introduces no
  conflict.
- `docs/live-kwin-testing.md` Safety Boundary and Native Effect Host
  Session-Boundary Exception - the new subcommand must stay inside the
  reversible, user-local envelope and must never simulate or perform a
  session boundary itself.

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
  `test-output`.

## Acceptance Criteria

- [ ] `README.md` plainly and prominently states the native effect must be
      `effect-reload`ed again after every reboot or logout/login, because
      `EnabledByDefault` is `false` and nothing auto-loads it.
- [ ] `README.md:279-283`'s misleading implication is corrected in place; its
      true statement (no further *env-script* boundary after the first) is
      preserved, not deleted.
- [ ] `README.md` documents the full install process end to end in one
      place, including the one required logout/login and its scope (native
      effect only, not the KWin script).
- [ ] `docs/backlog.md:37` matches `docs/changes/host-dogfooding/plan.md`'s
      Final Outcome (Unit N: live end-to-end native-effect loading already
      confirmed on this host; only eyeball visual confirmation remains
      unclaimed).
- [ ] One new subcommand exists in `scripts/dogfood-install.sh` (name
      decided below) that composes exactly `install`, `enable`,
      `effect-install`, `effect-reload`, with no reimplementation of their
      logic, no new install location, and no new host-mutation category.
- [ ] The new subcommand degrades gracefully when the native-effect half
      cannot run: the KWin-script half still completes, is reported clearly,
      and the overall command still exits 0 - it never fails wholesale
      because of the optional half.
- [ ] The new subcommand's output states exactly what remains manual (the
      one-time logout/login before the first `effect-reload` can load the
      effect, and the standing per-reboot/per-logout `effect-reload`
      requirement thereafter).
- [ ] `scripts/dogfood-install.test.sh` covers the new subcommand: full
      success path, graceful degrade when the native-effect build tool is
      unavailable, the expected pending-boundary `effect-reload` outcome,
      and a hard failure in the required `install`/`enable` half.
- [ ] `bash scripts/dogfood-install.test.sh` passes in full (baseline before
      this change: 281 passes, 0 failures).
- [ ] `npm --prefix kwin run typecheck` and the KWin test suite are
      unaffected (baseline: 815/815 passing, clean typecheck on both
      tsconfigs at HEAD `4a3c044`) - expected, since no file under `kwin/`
      is touched by this change.
- [ ] Nothing out-of-scope (see Non-goals) is touched.

## Unresolved Questions

None. The directive scoped this change exactly, including the exit-code and
graceful-degradation design, which this Lead resolves under Consequential
Decisions below.

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

Implementation does not begin until the specification is approved unless
autonomous mode was explicitly requested.
