# Specification: Native Effect Toolchain

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-15 by Orchestrator under autonomous mode

## Intent and Desired Outcome

Provide the minimal declared Nix toolchain needed to configure, build, and
archive the selected standalone native C++ KWin effect.

## Scope and Non-Goals

In scope:

- Declare CMake, Ninja, pkg-config, ZIP, ECM, KWin development metadata, and
  KPackage tooling in `devenv.nix`.
- Use `kdePackages.kwin.dev` rather than the full KWin runtime package when it
  contains the required headers and CMake metadata.

Non-goals:

- Build, install, package, or run a native effect.
- Add Qt or KDE Frameworks dependencies already propagated by KWin's
  development output.
- Update `devenv.lock`.

## Applicable Principles and Decisions

- `docs/decisions.md` Active Window Border: declare required system
  dependencies in `devenv.nix` before use and restart after the change.

## Constraints

- Do not enter a refreshed development shell or claim new tools are available
  in this session.
- Validate only Nix syntax and package attributes with currently available
  tooling.
- Do not add redundant dependencies.

## Acceptance Criteria

- [x] `devenv.nix` declares the requested build, archive, and KWin effect
  development tools without separately declaring propagated Qt/KF packages.
- [x] Nix syntax and all declared package attributes evaluate successfully.
- [x] The change is archived with a mandatory session-restart record.

## Unresolved Questions

- The native effect's future `CMakeLists.txt` must verify the exact exported
  KWin CMake target name before linking.

## Consequential Decisions

- Use `kdePackages.kwin.dev`, verified to expose KWin 6.7.3 development
  metadata at `lib/cmake/KWin`; do not add the full runtime package.
- Use `kdePackages.kpackage` once for both KPackage libraries and
  `kpackagetool6`.

Implementation does not begin until the specification is approved unless
autonomous mode was explicitly requested.
