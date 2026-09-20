# Native Dev Setup Lifecycle

## Goal

- Close reviewed gaps in native dev delivery and its shared-path collision
  with dogfood: exact byte ownership, canonical newline, atomic no-clobber
  publication, friendly fail-closed option handling, and a state-aware
  dev-on to full-cleanup trap handoff.

## Scope

- `scripts/dev-native-effect.sh` setup/remove manage only the project-owned
  `plasma-workspace/env/60-plasma-auto-tiler-native-effect.sh` for this
  checkout's `target/kwin-native-effect-stage`. They never touch kwinrc,
  D-Bus, or a running KWin, and never remove parent dirs.
- `scripts/dogfood-install.sh` effect-install/effect-remove manage the same
  env-script path with dogfood double-quoted content for
  `$DATA_ROOT/plasma-auto-tiler-native-effect`. The two paths cannot coexist
  at that path: dogfood refuses dev-owned content and preserves it;
  the dev helper refuses dogfood/alternate content.
- preflight/load/unload perform transient D-Bus lifecycle against /Effects
  with strict JSON parsing and KWin unique-owner/PID/start-tick guards. They
  never write persisted enabled config and never claim a hot reload.
- `just dev` preflights before any build/startup mutation, skips the native
  rebuild when an effect is preloaded (preserving it), transiently loads only
  invocation-owned effects in order, unloads owned loads in reverse, and routes
  to full `dev-off` cleanup via a state-aware handoff once dev-on succeeds.

## Constraints

- Isolated fake tests and temp paths only; no live KWin/Plasma/setup/remove/
  dev lifecycle actions.
- Preserve unrelated/recovered work; the Orchestrator owns backlog disposition.
- No parallel lifecycle harness; one lifecycle structure, no durable recovery.

## Approach

- Exact ownership via raw `cmp -s -- "$ENV_FILE" <(expected_env_contents)`,
  never command-substitution string comparison (which strips trailing
  newlines). Canonical content ends with exactly one trailing newline;
  publication writes via `expected_env_contents > "$tmp"` directly.
- Robust single-quote escaping (`sq_escape`) for stage paths with spaces and
  shell metacharacters; POSIX sh sourcing verified (sh/dash), prepend/retain
  semantics with no stray colons.
- Setup publication is atomic no-clobber via same-directory hardlink
  `ln -T -- "$tmp" "$ENV_FILE"`; `-T` treats the destination as a normal
  file so a concurrently appeared directory fails instead of succeeding as a
  link inside that directory. Never `mv -n`. Existing files are preserved on
  refusal/race.
- Setup/remove refuse symlinks, non-regular files, unfamiliar content,
  alternate-checkout content, and (dev side) dogfood double-quoted content;
  (dogfood side) single-quoted or `kwin-native-effect-stage` dev content.
  Dogfood checks both early (before any staging/kwinrc write) and immediately
  before publishing/staging for removal.
- Dogfood effect-status `[b]` uses the same raw `cmp` identity; dev-owned
  content reports stale, never current.
- load/unload fail closed with friendly errors when `--expect-owner`,
  `--expect-pid`, or `--expect-start` values are missing
  (`--expect-owner requires a value`, etc.) rather than a bare shift failure;
  malformed/changed owner, pid, or start-tick never mutates.
- `just dev` parses/passes the strict preflight owner/pid/start, fails closed
  when missing/malformed, and keeps `native_early_cleanup` (owned-effects
  reverse unload only, never `dev-off` directly) from the first load through dev-on.
  A `DEV_ON_OK` flag (0 until observed dev-on success, set to 1 before any
  trap replacement) makes the still-installed early handlers state-aware:
  the EXIT handler delegates to the pre-defined full `dev_cleanup`
  (dev-off + owned native unload) once the flag is set, and the early INT
  handler sets `INT_RECEIVED=1` under the same flag so Ctrl-C normalization
  matches. The post-success `trap` replacements are sequential (one signal
  per builtin, not simultaneous); correctness comes from the flag, not from
  replacement timing. The full handler is only invoked after success, so dev-off
  is never called before success.
- Extended `dev-native-effect.test.sh` with canonical-newline,
  missing-newline, dogfood-collision, directory, and missing-option cases
  plus static `ln -T`/raw-cmp/handoff assertions; extended
  `dogfood-install.test.sh` with dev-owned install/remove/status cases.
- Extended `dev-loop-split.test.sh` with an isolated `build-native-effect`
  restage check (new staged inode, new path bytes, already-open descriptor
  still reads the old bytes), an isolated `dev-native-setup` check (same
  native build dependency stages all three artifacts and writes the env
  script), and a dynamic early-INT check between owned native load and
  dev-on success (owned oracle unloaded, preloaded border preserved, no
  `start-test stop` and no `dogfood enable`, exit 130).

## Verification

- `bash scripts/dev-native-effect.test.sh` -> `PASS=149 FAIL=0`
- `bash scripts/dogfood-install.test.sh` -> `passes: 494 failures: 0`
- `bash scripts/dev-loop-split.test.sh` -> `PASS=324 FAIL=0`
- `just --fmt --check` -> exit 0
- `bash -n` on both helpers and both tests -> syntax ok
- `ln --help` confirms `-T`/`--no-target-directory` available in this project

## Outcome

- Static implementation is complete and all listed isolated checks pass. No
  host setup, session boundary, KWin load/unload, or visual test ran.

## Staging Safety Finding

- `build-native-effect` publishes via a payload directory, `rm -rf` of the
  old repo-local stage, then `mv` of the payload into place; it never
  opens/truncates an existing staged `.so`. Linux unlink keeps an open
  file's bytes reachable until its final descriptor closes, so the restage
  check shows a new inode with new bytes while the old descriptor still
  reads the old bytes. No runtime activation is claimed: a new session
  remains required before KWin discovers the staged effects.
- Source checked: KWin v6.7.5 `PluginEffectLoader` discovers plugins by
  `kwin/effects/plugins` and constructs `QPluginLoader` from the discovered
  file path; `EffectsHandler::unloadEffect` destroys the Effect object.
  Qt documents `QPluginLoader::PreventUnloadHint` as the default and does
  not make `isEffectLoaded=false` evidence that the library is unmapped.
  Linux `unlink(2)` preserves the old inode while it remains open. This
  establishes memory-safe replacement, not same-session new-code activation.

## Known Live-Evidence Limit

- Offline fake coverage only. Current-host KWin ABI, session delivery across
  logout/login, native load/unload in the running session, interrupt timing
  in `just dev`, and visual border rendering remain pending live evidence; no
  live result is claimed.

## Live Setup Diagnosis (2026-09-20)

- After the implemented `just dev-native-setup` and a logout/login, the
  project-owned env script was present with its exact stage prefix and the
  current user-manager `QT_PLUGIN_PATH` included that prefix. KWin's current
  `listOfEffects` included both plugin IDs and its boot journal named both
  exact staged `.so` paths. Discovery, stage structure, file permissions, and
  session delivery therefore succeeded.
- Both effects remained `isEffectSupported=false` because the staged plugins
  embed `org.kde.kwin.EffectPluginFactory6.7.4` and link KWin 6.7.4, while the
  running KWin 6.7.5 exposes `org.kde.kwin.EffectPluginFactory6.7.5`. KWin's
  factory IID has no binary-compatibility guarantee across this version
  boundary. The current `devenv.nix`/`build-native-effect` producer is pinned
  to the incompatible 6.7.4 package set.
- The host declares but has not realized its 6.7.5 `kwin.dev` output. Using it
  would materialize a host package and was not attempted. Correcting the
  pinned producer or selecting a host-matching development package requires a
  delivery-policy decision before implementation; no host state was changed.
- Preflight now detects this exact Nix ABI skew from each staged plugin's
  embedded factory IID and the running KWin package path. It reports the
  versions and says that setup alone cannot resolve the mismatch, while
  preserving the generic session-delivery guidance for unrecognized layouts.
- The host reports Nixpkgs revision
  `e554fab72f81915600f3f449b786fd9af40439a5`; the repository's
  `devenv.lock` instead resolves Nixpkgs
  `54ba4bcec4043e72a4006d825e0d7aff5562008f`. Replacing the latter's
  Cachix rolling input with the former is a reproducible repo-owned correction,
  but changes the complete development package set and remains a scoped
  source-authority decision.
