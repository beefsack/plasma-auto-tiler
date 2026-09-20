# Host-Matched Native Development Builds

## Goal

Build native KWin effects for development with the installed NixOS KWin
derivation's exact development output and build environment, rather than this
repository's pinned native Plasma stack.

## Scope

- Resolve the current-system KWin package and fail closed when its derivation or
  matching `dev` output cannot be proven.
- Use one identity-keyed native builder for direct staging and dogfood builds.
- Preserve the existing staging and KWin session lifecycle scripts.
- Prove one native compile before removing the ABI-bound development packages
  and CMake export from `devenv.nix`.

## Non-Goals

- No host NixOS configuration, lockfile, or live KWin-session mutation.
- No fallback to a pinned or guessed native package set.
- No native hot-reload guarantee.

## Acceptance

- Native CMake configure/build runs in the resolved host derivation environment
  with the selected exact `dev` output and portable Rust tools explicitly
  available.
- Builder inputs, output paths, and diagnostics are identity/provenance-bound.
- Tests cover resolution failure, dev-output selection, isolated invocation,
  identity paths, and no shared-lock rewrite.
- After the proof, `devenv.nix` retains portable/test tooling but removes the
  native KWin/Qt/KF/CMake stack and locked KWin CMake export.

## Approach

1. Inspect the existing native build, test, Nix, and host package interfaces;
   determine the bounded realization plan before compiling.
2. Implement the host-derived builder and route staging/dogfood paths through it.
3. Run focused static checks and a real native compile, then remove obsolete
   development dependencies and document the workflow.
4. Review the final source and give the Orchestrator the backlog disposition.

## Outcome

Accepted real host compile proof (2026-09-20, current system):

- Proof identity/paths (`scripts/nix-host-kwin-build.sh resolve`, read-only,
  no realization):
  - `host_bin=/run/current-system/sw/bin/kwin_wayland`
  - `store_path=/nix/store/78pbwkmy3kkp91lbp2w43p0hcl87cqb8-kwin-6.7.5/bin/kwin_wayland`
  - `derivation=/nix/store/bq1w35sxymkigmvrsi0j3vmpnc2vxgw6-kwin-6.7.5.drv`
  - `dev_output=/nix/store/qa2kacf1gv0cl4ilc5i723qd1a2k1fj7-kwin-6.7.5-dev`
  - `kwin_cmake_dir=/nix/store/qa2kacf1gv0cl4ilc5i723qd1a2k1fj7-kwin-6.7.5-dev/lib/cmake/KWin`
  - `kwin_config=.../lib/cmake/KWin/KWinConfig.cmake`
  - `identity=bq1w35sxymkigmvrsi0j3vmpnc2vxgw6-kwin-6.7.5`
  - `default_build_dir=target/kwin-native-host-bq1w35sxymkigmvrsi0j3vmpnc2vxgw6-kwin-6.7.5-build`
  - `default_stage_dir=target/kwin-native-effect-stage`
- Proof artifacts (host-matched build dir, prior accepted compile):
  - `...-build/bin/kwin/effects/plugins/plasma-auto-tiler-active-border.so`
    (2688800 bytes, 2026-09-20 13:48:58 +1000)
  - `...-build/bin/kwin/effects/plugins/plasma-auto-tiler-drag-oracle.so`
    (2455664 bytes, 2026-09-20 13:49:05 +1000)
  - `...-build/bin/kwin/effects/configs/plasma-auto-tiler-active-border_config.so`
    (2574536 bytes, 2026-09-20 13:49:23 +1000)
- Bounded substitutions/environment derivation: identity derived opaquely
  from the derivation basename (sanitized, no version parsing); justfile
  staging uses `target/kwin-native-host-<identity>-build` with stage fixed
  at `target/kwin-native-effect-stage`; dogfood uses
  `<transaction>/host-<identity>-build`; `--expected-identity` pins caller
  resolve to build resolve. Build runs only
  `nix develop <host-drv> --command bash -c 'cmake -S ... -B ... -DKWin_DIR=<resolved-dev>/lib/cmake/KWin -DBUILD_TESTING=OFF; cmake --build ...'`
  with explicit `/nix/store` rustc bin dir on `PATH`; outer cmake/cargo
  never required or injected; cmake must resolve host-native inside the dev
  shell; legacy `PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR` /
  `DOGFOOD_KWIN_DEV_CMAKE_DIR` / `CMAKE_BIN` / `CARGO_BIN` are stripped
  outer and inner; `KWinConfig.cmake` is required inside the dev shell where
  Nix has realized the dev output.
- Behavior/workflow: `resolve` first (read-only provenance, metadata only);
  then optional manual `nix build --dry-run <dev>` for cost inspection
  (never run automatically by the builder); then `just build-native-effect`
  (staging) or dogfood `effect-install`. First-use `nix develop` may realize
  the host dev closure (download/store cost, potentially minutes) paid once
  via that single realizing command. Offline/missing provenance fails clear
  with `error:` and no fallback or shared-lock rewrite. No hot reload:
  `just dev` promises no hot reload; unload verification never proves the
  library is unmapped; native rebuild activation requires a fresh session.
- Dependencies removed from `devenv.nix`: `cmake`, `ninja`, `pkg-config`,
  `kdePackages.extra-cmake-modules`, `kdePackages.kcolorscheme`,
  `kdePackages.kconfig`, `kdePackages.kcmutils`,
  `kdePackages.kwidgetsaddons`, `pkgs.kdePackages.kwin`,
  `pkgs.kdePackages.kwin.dev`, and the locked
  `PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR` export. Retained portable/test
  and unrelated tooling: `clang-tools`, `just`, `python3`, `zip`,
  `kdePackages.kpackage`, `weston`, plus Rust/JS languages.
- Tool decision: `jq` stays portable repo system tooling, declared in
  devenv.nix packages. It is already declared (`README.md` Other runtime tool
  requirements; builder `JQ_BIN`/PATH lookup with fail-closed `error:`;
  host provides `jq-1.8.2`); devenv provides it for the repo shell.
  `scripts/nix-host-kwin-build.test.sh` covers the `CARGO_BIN` leak
  assertion (outer strip plus inner refuse) alongside the existing
  `CMAKE_BIN` coverage.
- Acceptance/outcome: native CMake configure/build runs in the resolved
  host derivation environment with the exact `dev` output; inputs, output
  paths, and diagnostics are identity/provenance-bound; hermetic builder
  tests cover resolution failure, dev-output selection, isolated
  invocation, identity paths, legacy-environment stripping, and no
  shared-lock rewrite. Final verification passed `bash -n` for affected
  scripts, `just --fmt --check`, `git diff --check`, hermetic builder (76),
  dogfood (505), dev-loop (325), and dev-native (155) suites, the actual
  `just build-native-effect` staging route, and all 27 native CTest cases in
  the same host derivation environment. The staged active-border and
  drag-oracle libraries both link `libkwin.so.6` with a RUNPATH beginning
  `/nix/store/78pbwkmy3kkp91lbp2w43p0hcl87cqb8-kwin-6.7.5/lib`; their plugin
  IDs are respectively `plasma-auto-tiler-active-border` and
  `plasma-auto-tiler-drag-oracle`.
