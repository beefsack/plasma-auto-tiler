# Specification: Host Dogfooding (KWin Script + Native Effect)

Ownership and approval:
- Owner: Lead (host-dogfooding)
- Status: Pending user approval

## Intent and Desired Outcome

Give the user one simple, documented, repeatable, low-ceremony path to run
both the KWin script and the native active-border effect on his real daily
KDE Plasma session, so he can dogfood the project day to day. Optimize for
"easy to run and re-run," not for an exhaustive safety proof. This replaces
the narrower, more ceremonial native-effect-only host validation protocol in
`native-effect-host-live-runner`, which is archived rather than continued.

## Scope and Non-Goals

In scope:

- A dogfood path for the native effect: a stable user-local staging directory
  for the built plugin, a stable (non-nonce) uniquely-named session
  environment script under `~/.config/plasma-workspace/env/` that sets
  `QT_PLUGIN_PATH` so the staging directory is discoverable (migrating away
  the superseded `~/.config/environment.d` entry of the same name where
  present), a rebuild step, and a KWin `/Effects` D-Bus
  `loadEffect`/`unloadEffect` reload step. Created and enabled through exactly
  one user-run session boundary (logout/login or new session); every
  iteration after that is live via D-Bus with no further boundary.
- A KWin script dogfood path reusing the existing, already-working
  `scripts/dogfood-install.sh install|enable|disable|uninstall|status`
  surface, which needs no session boundary.
- The smallest practical command surface covering both components, stated
  exactly for the user to type.
- `docs/decisions.md` amended to record the narrowed host-mutation policy
  (below) superseding the conflicting clauses in "Native Effect Live
  Validation."
- Rewriting the superseded sections of `docs/live-kwin-testing.md` (Safety
  Boundary agent-mutation framing, the Native Effect Host Session-Boundary
  Exception section, and the Manual Start Launcher authorization framing) so
  the document matches the narrowed policy. Lines 457-503 are historical
  record and are left intact.
- `README.md` updated so the dogfood path (both components) is discoverable
  from the existing Quickstart/Live test material.
- A short (roughly 5-10 line) eyeball verification checklist the user reads
  and confirms after dogfooding, not an automated evidence framework.
- Archiving `docs/changes/native-effect-host-live-runner/` under
  `docs/changes/archive/`, preserving its accepted host ABI/development pin
  evidence and its lessons on session-boundary handling, and replacing
  `docs/backlog.md` line 32 with an entry for this change.
- Reconciling the five currently-uncommitted modified docs
  (`docs/backlog.md` and the four files under
  `native-effect-host-live-runner/`) as part of the archive deliverable.

Non-goals:

- A persistent phase state machine for the dogfood protocol.
- A fake-host simulator.
- Whole-namespace snapshot diffing of the session environment.
- Crash and power-loss rollback guarantees.
- Defending against hostile same-user races.
- Filesystem corruption handling.
- A multi-host or portable-target abstraction; this is scoped to the current,
  already-pinned host only.
- Automated evidence frameworks; restoration and verification are normal-path
  only, i.e. exact removal of what was created, confirmed by eye.

## Applicable Principles and Decisions

- `docs/decisions.md` - "Native Effect Live Validation" (superseded by this
  change's narrowed host-mutation policy; the decisions file amendment is
  itself a deliverable of this change).
- User-issued narrowed host-mutation policy (authoritative, recorded here for
  traceability, to be promoted into `docs/decisions.md` by this change):
  agents may execute, without asking each time: builds; staging/removing the
  plugin under a namespaced user-local directory; creating/removing the
  project's own uniquely-named session environment script under
  `~/.config/plasma-workspace/env/`, and removing the superseded
  `~/.config/environment.d` entry of the same name; KWin D-Bus `/Effects`
  `loadEffect`/`unloadEffect`; KWin script install/enable/disable via
  `kpackagetool6`/`kwriteconfig6`/`qdbus` reconfigure; journal and status
  reads. The user still personally performs every session boundary
  (logout/login or starting a session). Still prohibited: `sudo`, system
  plugin paths, editing or deleting any Home Manager-managed file, editing
  any `~/.config/environment.d` entry other than the project's own (the
  legacy entry being migrated away), pinning Home Manager generation paths,
  and broad cleanup of unrelated state.
  CORRECTED (see `docs/changes/host-dogfooding/plan.md` Unit M): this bullet
  originally named `~/.config/environment.d` as the delivery mechanism
  itself; Units J/K/L found `environment.d` structurally cannot survive
  Plasma's session-startup environment resync on this host and replaced it
  outright with the `~/.config/plasma-workspace/env/` mechanism above. The
  user-approved policy's *authorization scope* (what agents may do without
  asking) is unchanged; only the named target of "creating/removing the
  project's own environment entry" is corrected to match what was actually
  approved and delivered.
- Effect discovery mechanism (authoritative, to be recorded in
  `docs/decisions.md`; CORRECTED per Unit M below, superseding the original
  `environment.d`-based mechanism this bullet described): a stable (not
  per-run nonce) uniquely-named session environment script under
  `~/.config/plasma-workspace/env/`, sourced by `startplasma-wayland` into
  its own process environment before Plasma's session-wide environment
  resync (`KUpdateLaunchEnvironmentJob`) runs, pointing `QT_PLUGIN_PATH` at a
  stable user-local staging directory, created once and left in place, with
  one user-run session boundary total before daily iteration goes live via
  D-Bus. Removable on request.

## Constraints

- `devenv.nix:15-16` pins the exact `kwin-6.7.3` out and dev store paths via
  `builtins.storePath`, requiring impure eval for builds; the dogfood build
  step must account for this.
- `~/.config/environment.d/` is a real, writable, non-symlinked directory
  (confirmed by inspection); it currently holds exactly one Home
  Manager-owned entry, `10-home-manager.conf`, itself a symlink into the
  Home Manager store path and unrelated to `QT_PLUGIN_PATH`. This change's
  own entry under that directory (the mechanism originally chosen; see the
  next bullet) is superseded and migrated away by `effect-remove`; either
  way, no file added or removed by this change touches
  `10-home-manager.conf`.
- CORRECTED (Unit M, see `docs/changes/host-dogfooding/plan.md`): the
  following constraint originally argued, from indirect evidence only, that
  an `environment.d` entry's value would survive to reach the running
  `kwin_wayland` process. Units J and K established this reasoning was
  wrong: KDE Plasma's session startup
  (`KUpdateLaunchEnvironmentJob`, invoked from `startplasma-wayland`)
  unconditionally re-syncs `startplasma-wayland`'s own process environment
  into the systemd `--user` manager via `SetEnvironment` on every session
  start, *after* `environment.d` generators have already run - so this
  resync always overwrites (not merges with) whatever `environment.d`
  contributed, and the Nix-wrapped `startplasma-wayland`'s own baked-in
  `QT_PLUGIN_PATH` never includes the staging root. `QT_PLUGIN_PATH` is not
  set by any pre-existing `environment.d` or `plasma-workspace/env/` file
  on this host; it is established per-process by nixpkgs
  `makeBinaryWrapper` `--prefix` wrappers (confirmed for
  `kwin_wayland`/`kwin_wayland_wrapper` and for `startplasma-wayland`),
  which run once at `execve()` and prepend a fixed list of Nix store plugin
  directories onto whatever `QT_PLUGIN_PATH` value the wrapped process
  already inherited, rather than replacing it. The mechanism that actually
  survives the resync (identified by Unit K, source-cited against
  `startplasma-wayland.cpp`) is `~/.config/plasma-workspace/env/*.sh`:
  `runEnvironmentScripts()` (around line 66) sources every `*.sh` file
  under that directory into `startplasma-wayland`'s own process
  environment before `syncDBusEnvironment()` (around line 77) snapshots
  that same environment and hands it to `KUpdateLaunchEnvironmentJob` for
  the resync - so a value set this way is the resync's own input, not
  something it competes with. Because the Nix wrapper's `--prefix` chain
  runs before `runEnvironmentScripts()`, the env script must prepend and
  preserve the existing `$QT_PLUGIN_PATH` (the
  `${QT_PLUGIN_PATH:+:$QT_PLUGIN_PATH}` guarded-expansion idiom), not
  assume it starts unset. `~/.config/plasma-workspace/env/` did not exist
  on the host before this change, and a repository-wide search of Home
  Manager configuration found zero references to `plasma-workspace`, so
  nothing else claims this directory or competes with this project's
  script for `QT_PLUGIN_PATH`.
- Do not touch `CMakeFiles/`, `Project Technical Report and Implementation
  Plan.md`, `test-output`, or
  `/tmp/plasma-auto-tiler-host-20260818-7f3c9a2d.`
- Do not resurrect `scripts/live-native-effect-test.sh` or
  `scripts/live-native-effect.test.sh`; both are staged for deletion and
  stay deleted.
- No commits or pushes for this change until the user lifts that
  restriction.

## Acceptance Criteria

- [ ] `docs/decisions.md` "Native Effect Live Validation" is amended (or
      superseded by a new decision) recording the narrowed host-mutation
      policy and the stable session-environment-script discovery mechanism
      above (CORRECTED per Unit M: originally `~/.config/environment.d`;
      Units J/K/L found that mechanism structurally does not work on this
      host and replaced it with `~/.config/plasma-workspace/env/`), edited
      only after user approval per governance.
- [ ] `docs/live-kwin-testing.md` Safety Boundary, Native Effect Host
      Session-Boundary Exception, and Manual Start Launcher sections are
      rewritten to match the narrowed policy; lines 457-503 remain
      unchanged; the document contains no residual claim that "agents never
      execute host KWin mutations" where that no longer holds.
- [ ] The native-effect dogfood path is implemented as either new
      subcommands on `scripts/dogfood-install.sh` or exactly one small
      sibling script (final choice recorded in `plan.md` with rationale),
      covering: stage the built plugin into a stable user-local directory;
      create/verify the stable session environment script under
      `~/.config/plasma-workspace/env/` (CORRECTED per Unit M: originally
      an `~/.config/environment.d` entry; see Constraints and the Effect
      discovery mechanism bullet above for why); report the one-time
      session-boundary requirement; reload via `/Effects`
      `loadEffect`/`unloadEffect`; report status; and remove (unstage the
      plugin, delete the project's env script, and migrate away any legacy
      `~/.config/environment.d` entry of the same name) on request.
- [ ] The full two-component dogfood command surface is documented as an
      exact, minimal list of commands the user types, in both `README.md`
      and `docs/live-kwin-testing.md`.
- [ ] A short (roughly 5-10 line) eyeball verification checklist exists for
      the user to read and confirm after dogfooding both components.
- [ ] `docs/changes/native-effect-host-live-runner/` is moved under
      `docs/changes/archive/`, preserving its accepted host ABI/development
      pin evidence and its session-boundary lessons.
- [ ] `docs/backlog.md` line 32 (the `native-effect-host-live-runner` entry)
      is replaced with one line for `host-dogfooding`.
- [ ] The five currently-uncommitted modified docs (`docs/backlog.md` and
      the four files under `native-effect-host-live-runner/`) are reconciled
      as part of the archive step with no orphaned or contradictory state.
- [ ] The one required user-run session boundary is stated as an explicit
      user step in the acceptance path, never performed or simulated by an
      agent.
- [ ] No file under `docs/changes/native-active-border-configuration/` or
      any other active change is modified by this change.

## Unresolved Questions

- Whether to extend `scripts/dogfood-install.sh` with effect subcommands or
  add one small sibling script is a plan-level implementation choice, not
  resolved in this spec; `plan.md` will record the choice and rationale for
  Orchestrator approval.
- Exact naming for the new session environment script (CORRECTED per Unit M:
  under `~/.config/plasma-workspace/env/`, not `~/.config/environment.d`)
  and the stable staging directory path are plan-level detail.

## Consequential Decisions

- Replace the archived change's two-user-run-session-boundary,
  nonce-owned, per-attempt-authorization protocol with a single one-time
  session boundary plus a stable (non-nonce) session environment script
  under `~/.config/plasma-workspace/env/` (CORRECTED per Unit M: originally
  a stable `~/.config/environment.d` entry, superseded by Units J/K/L), per
  the user's explicit narrowed authorization recorded above. This trades the
  old protocol's per-attempt ceremony for day-to-day low-ceremony iteration,
  which is the explicit goal of this change.
- `docs/decisions.md` and `docs/live-kwin-testing.md` edits are specified
  here as deliverables but remain user-owned/Lead-edited-after-approval per
  governance; this spec does not itself constitute that approval.

Implementation does not begin until the specification is approved unless
autonomous mode was explicitly requested.
