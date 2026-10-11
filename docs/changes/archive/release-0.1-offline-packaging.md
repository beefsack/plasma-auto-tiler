# 0.1 offline packaging preparation

## Goal and scope

Prepare tag-only GitHub source releases and offline OBS/AUR packaging for KDE
0.1. Core (script, planner, tray and activation metadata) must remain independent
of the optional native effect/KCM. No publishing or external account creation.
External NixOS/Home Manager validation remains a separate P1 gate.

## Acceptance

- Reproducible source archive includes pre-built JavaScript and offline Rust
  dependencies, plus checksums; tag workflows remain inert without OBS credentials.
- RPM recipes cover Tumbleweed and Fedora 43/44; AUR recipe and source metadata
  cover Arch. Attempt Ubuntu 26.04/neon and document concrete blockers.
- Package relationships never hold KWin upgrades back. Revert-before-removal
  guidance appears in installation docs and package metadata/removal notes.
- Verify with available tools without ad hoc dependency installation or live
  desktop changes; distinguish builds from static checks and unavailable checks.
- Record tentative technical choices and surface the Settings-without-KCM
  product question. Publish coherent commits, reconcile concurrent main changes
  using clean-tree rebases, then inspect CI.

## Approach and units

1. Worker: source/build reconnaissance, release archive tooling and tag workflows.
2. Worker: distro recipes, OBS services and install/uninstall guidance, using the
   accepted source archive contract; investigate ABI upgrade and Ubuntu blockers.
3. Lead: integration, proportionate verification and independent review of public
   packaging/workflow contracts; project records and archived outcome.

## Constraints and current state

- 2026-10-11: initial clean-tree `git pull --rebase` succeeded at `e6f396d`.
- One muse-spark Worker active at a time; Workers load processed-beef-work-unit.
- Linux system dependencies only via devenv.nix; changes require session restart.
- No external accounts/tokens exist. No live KWin tests. Preserve user stashes.
- User explicitly authorizes implementation, verification, commit and push, and
  requests backlog updates (overriding the usual Lead/backlog ownership boundary).

## Decisions and evidence

- Source contract: tagged tracked source plus pre-built JS with tagged commit SHA,
  vendored crates, VERSION and SOURCE_REV; deterministic gzip archive and SHA-256
  sidecar. GitHub Release completes before a credential-gated OBS tag webhook.
- Tentative layout: packaging/{rpm,arch,debian,obs,systemd}; package names
  omnitiler (core) and omnitiler-native-effect (effect and KCMs).
- Worker evidence: offline archive Rust build; actual Tumbleweed/Fedora 43 RPM,
  Arch split-package and Ubuntu 26.04 core Debian builds in disposable containers.
  Independent integration review is still required before accepting these claims.
- Native factory embeds the build KWin version in its IID; the loader rejects
  mismatched IIDs. RPM ELF dependencies retain only the unversioned KWin SONAME,
  permitting upgrades within that SONAME. Same-IID ABI changes remain unproven.
- Ubuntu core removes the Node build requirement. Its native effect is blocked by
  ECM 6.24 below 6.26; neon OBS provisioning remains unavailable.
- Product question: without the native KCM, core still tiles but Settings cannot
  open. Recommend separating the KWin-independent KCM into core if feasible;
  retain this as a user decision rather than silently changing selected split.
- Corrections accepted in direction: Revert means Settings host-key/shortcut
  restoration, not script disabling; Arch remains AUR-only. OBS pinned-service
  automation has a per-release source/checksum handoff gap and remains blocked.

## Accepted outcome and verification

Offline preparation delivered; no publishing, release tags or external accounts.
One independent public-contract/security review completed and findings corrected.
The source archive was generated from the exact proposed code in an isolated
scratch commit/tag, leaving the repository's refs/index and three stashes alone.

- Archive: scratch commit `32610b0ff8915fb6770eccb83ac8c405b48687ed`, tag
  `v0.1.0`; SHA-256
  `bba1b613f3cad585c45502870f6d5520c60a017436a6e20017b739e453da990d`.
  Sidecar, VERSION, SOURCE_REV and baked JS identity checked. Real builder's
  fresh-Cargo-home offline Rust self-check passed. Earlier repeated source
  archive builds were byte-identical; fast default contract suite checks this
  with deterministic tool fixtures too.
- Exact archive built with fresh Cargo homes and Docker `--network none`:
  Tumbleweed and Fedora 44 `rpmbuild -bb` produced core/native RPMs; Arch
  `makepkg` produced core/native/debug packages; Ubuntu 26.04
  `dpkg-buildpackage -us -uc` produced the core DEB/source metadata.
- Fedora 43: prior worker built both RPMs from a contract-shaped source tree;
  final exact-archive run used Fedora 44. This distinction remains explicit.
- RPM requires/file lists inspected: core has unversioned KWin dependency;
  companion adds unversioned KWin SONAME and same-version core dependency.
  All native builds confirmed KWin's versioned factory IID in target headers.
  [KWin 6.7.5 loader](https://github.com/KDE/kwin/blob/v6.7.5/src/effect/effectloader.cpp)
  checks metadata IID before `loader.instance()` and rejects mismatches.
- Arch `makepkg --printsrcinfo` matches the checked-in metadata; `namcap`
  PKGBUILD clean. Shipping packages have dependency warnings; generated
  debug package has symlink diagnostics. Earlier container `rpmlint` reported
  only `no-%check-section`; it was not rerun on final artifacts.
- Archive/webhook contract suite and existing KPackage suite passed; shell
  syntax checks passed. Local HTTP capture verifies exact tag/SHA payload,
  HMAC and secret-absent inert path, not actual OBS webhook compatibility.
  Version-helper sandbox verified no-op/current version, future version plus
  checksum and canonical `.SRCINFO` equality. Tests also pass from an already
  committed scratch tree (fixes the clean-tree/no-op clone case).
  Final metadata corrections update generated native dependency/source pins,
  fix GitHub CLI asset querying, and omit the RPM install-time preset macro
  so it cannot implicitly enable the opt-in tray. These do not change compiled
  Rust/JS/native code; syntax/recipe/contract checks cover the corrections.
- Payload/binary install probes passed. Only Arch's final install resolved
  KWin runtime dependencies; RPM/Ubuntu probes bypassed dependency checks.
  Fedora 44's build succeeded; a trailing tray smoke harness returned 1 due
  to pipefail, so full smoke acceptance is not claimed. No live compositor,
  tray, planner activation, KWin upgrade transaction or external Nix tests.
- Evidence included per-target logs, built packages, file lists and dependency
  dumps; the substantive verification results are recorded above.
- `devenv.nix` unchanged; Docker existed, dependencies installed only in
  disposable builder containers. No session restart required. Host
  rpmlint/namcap/actionlint unavailable; distro lint ran in containers as above.

## Blocked legs and user decisions

- OBS stable source update is blocked after two investigated semantic approaches:
  `branch_package` makes tag-suffixed packages rather than updating the chosen
  stable package; `verify_file` has no checksum-sidecar parameter. Current
  `trigger_services` only reruns committed sources. `_service` is a pinned,
  fail-closed template, not completed automation. Keep OBS_TOKEN unset;
  revisit the authenticated source handoff with actual OBS provisioning.
  No commit-back automation or second credential was introduced.
- Settings without native companion: recommend moving independent KCMs to
  core/non-effect settings companion; user decision needed. The existing
  split still leaves tiling functional, but makes Settings/Revert unavailable.
  A minimal remove-companion/Settings discriminator is recorded in
  `docs/spec/reference-outcomes.md`; native outcomes remain TBD.
- Ubuntu native: ECM 6.24 below 6.26; core-only builds prove the Node 22 vs 24
  issue is removed by prebuilt JS. Recommend retaining core-only as an attempt
  until Settings ownership is decided. Neon needs unverified OBS provisioning.
- Licensing: only KPlugin GPL declarations exist, no project-wide LICENSE or
  Rust-manifest license. Tentative package labels and partial Debian copyright
  template need user confirmation and vendored-crate inventory before publishing.
- Remaining 0.1 gate: absent/failed/removed-effect live checks and runtime
  install/update/revert checks; SONAME-changing updates and same-version ABI
  patches have no solver evidence. External Nix validation remains separate P1.

## Next action

User decides KCM ownership and Ubuntu/neon scope, and confirms first-party
licensing. Then provision unpublished OBS targets, resolve/test atomic stable
source/checksum handoff and only then supply/enable the trigger token. Backlog
retains P1 delivery acceptance. CI/publish outcome is reported by the Lead.
