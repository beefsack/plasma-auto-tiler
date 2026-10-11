# 0.1 core Settings packaging

## Goal and scope

Make the distro core package provide tiling plus Settings/Apply/Revert independently
of the optional native effect. Preserve Nix
consumers and offline distro builds. No live desktop mutation or OBS provisioning.

## Acceptance

- Establish KCM ABI ownership from CMake/link dependencies and built ELF evidence.
  Stop with options if Settings is KWin-ABI-bound.
- Core-only CMake and RPM/Arch/Debian/Nix builds install independent KCMs;
  companion contains only ABI-bound effect pieces. Assess Ubuntu ECM 6.24.
- Coherent installation/removal guidance and user-approved dated decision.
  Ubuntu effect/neon deferred scope remains explicit.
- Offline Tumbleweed, Fedora 43/44, Arch and Ubuntu builds; affected native,
  Nix and shell gates; inspect artifacts and CI after publishing.

## Approach and bounded units

1. Worker investigation: ABI ownership, feasible build split and verification tools.
2. Worker implementation: CMake, distro/Nix packaging and installation guidance.
3. Worker verification and independent packaging-contract review as needed.
4. Lead integration, decisions/evidence, archive and clean-tree rebase/push/CI.

## Constraints and decisions

- 2026-10-11: clean-tree initial pull succeeded at `37af573`.
- One muse-spark Worker active at a time; Workers load processed-beef-work-unit.
- Linux host dependencies only via devenv.nix. Disposable offline builder
  containers may reuse the prior packaging verification environment.
- Concurrent Windows main pushes: never pull dirty; stage only this change;
  commit, clean-tree rebase, push; stop on non-trivial conflict. Preserve stashes.
- Implementation, verification, commit and push authorized in autonomous mode.
- User-approved 2026-10-11: core `plasma-auto-tiler` owns both Settings KCMs;
  `plasma-auto-tiler-native-effect` owns only the ABI-bound effect. Core means
  the distro package, not `crates/tiler-core`; no KDE code enters that crate.
- Recovery verification was offline; no live KWin tests or host dependency
  installations.

## Evidence and outcome

- ABI finding accepted: both KCM targets link only Qt/KF6; extracted Arch ELF
  KCMs have no libkwin NEEDED or undefined KWin symbols. The effect control has
  libkwin NEEDED and 100 undefined KWin symbols. Lead reproduced script KCM
  readelf dependencies. Sources use D-Bus, not KWin headers.
- Implement both existing KCM identities in core without changing discovery
  paths or UI. Preserve default NixOS effect delivery and add independent Settings.
- Settings-only ECM floor 6.24 proven on Ubuntu; effect retains 6.26 and
  KWin SDK dependency.
- Implementation claims accepted after diff inspection: default full developer
  build preserved; independent build flags; RPM/Arch core owns both KCMs;
  Debian builds Settings without effect; Nix exports independent Settings and
  module installs it. Required helpers made hard dependencies. Existing full
  native CI coverage retained and settings-only check added.
- Worker built full native on Tumbleweed (32/32 CTest) and settings-only on
  Tumbleweed and Ubuntu (26/26 each). Ubuntu used ECM/KF6 6.24, Qt 6.10 and
  no kwin-dev. These CTest runs were reused after confirming the consumed
  source files predate the runs and have no later changes.
- Ownership recipes have no published predecessor; no migration transaction
  guarantee claimed. Recovery needs core alone, not a compatible effect.

## Accepted recovery verification (2026-10-11)

Verification artifacts were not published releases. Lead inspected the diff,
representative logs, Debian control/payload and Nix check/test logs;
independent Worker reviewed contracts.

- Original exact source archive SHA256:
  `2b0f27ffa81c76fa3266d6a454d317e94b4bd6e7e60a567ff3f65589f8ef416d`.
  The recorded diff matched the resumed implementation byte-for-byte. Container
  logs record this archive hash and assert recipe identities. Arch and Fedora
  43/44 completed packaging/payload/ELF evidence after the earlier session died;
  reused those artifacts. Core contains two KCMs with no `libkwin` dependency
  or undefined KWin symbols; companions contain one ABI-bound effect.
- Tumbleweed rerun in a network-disabled disposable builder passed.
  Prior RPM verification stopped after `--help` exited 1 under `set -e`;
  temp harness repaired to tolerate that documented exit and explicitly check
  SOURCE_REV. Fedora saved RPMs independently checked for baked SOURCE_REV=1;
  their earlier console logs lack DONE due to the same harness defect, but the
  completed payload/ELF/dependency assertions remain accepted evidence.
- Independent review found the inherited Debian `${shlibs:depends}` typo
  omitted generated runtime dependencies. Corrected to `${shlibs:Depends}`;
  old Ubuntu artifact superseded by a fresh exact archive rebuild.
  New scratch source revision: `d907d3b1ed66fb2d177613c3eeccd0c6f93fc54e`.
  New archive SHA256:
  `01b66632b6ac55927bc4c2abf0cec3ba369646f5cc1290ca480e8b569dc07883`.
  Archive/builder logs and source comparison establish identical consumed
  RPM/Arch/CMake/Rust/Nix inputs apart from source-revision literals
  and immaterial docs. Reuse remains valid for unaffected distro builds.
- Ubuntu rerun in a network-disabled disposable builder passed.
  Build and console/control/ELF logs pass: ECM/KF6 6.24,
  Qt 6.10, no kwin-dev; two KCMs, no effect, no libkwin; generated Depends
  contains actual Qt/KF6 runtimes plus config/shell helpers and no undefined
  substitution warning. `.deb` SHA256:
  `786f09de9d72329cc0bf753d783cc7b4b1814e7922e1a593852de6c1173ec8da`.
- Nix gates rerun with `nix build`:
  `.#checks.x86_64-linux.native-settings-tests` (26/26),
  `.#checks.x86_64-linux.native-effect-tests` (33/33),
  `.#native-settings`, `.#native-effect`, `.#kwin-script`, `.#tray`.
  Shipping installChecks and inspected outputs prove Settings=2 KCMs/0 effect,
  effect=1 plugin/0 KCMs. Cached test build logs were inspected.
- `nix flake check --print-build-logs` passed:
  x86_64 package/check/module assertions evaluated;
  zero rebuilds because checks were already realized. aarch64 was omitted.
- Shell suites: source archive and KPackage passed; rerun dogfood 572/572
  and dev-loop 380/380. Earlier signal-fixture failures did not recur;
  dev-loop failures were caused by a leftover Nix `result` symlink. Future
  verification builds use `--no-link` to avoid source-tree output links.

## Outcome and remaining release work

- Approved ownership implemented; decisions, installation/removal guidance and
  backlog updated. Default full developer build and NixOS effect delivery
  preserved. Settings-only CI gate added. Commit/rebase/push and CI result
  reported in handover.
- Runtime/solver and missing/failed/removed-effect live acceptance remain
  separate user-owned release gates. RPM/Ubuntu install probes use forced
  dependencies, not full solver acceptance. Arch has harmless empty split-dir
  and intentional dependency warnings. OBS provisioning/source handoff and
  licensing remain open; Ubuntu effect ECM floor and neon provisioning blocked.
