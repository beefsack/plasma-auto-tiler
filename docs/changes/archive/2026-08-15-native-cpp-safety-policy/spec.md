# Specification: Native C++ Safety Policy

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-15 by Orchestrator under autonomous mode

## Intent and Desired Outcome

Bind the selected native C++ KWin effect path to a small, risk-averse surface
and declare the required static-analysis and formatting tooling.

## Scope and Non-Goals

In scope:

- Record the approved C++ constraints in `docs/decisions.md`.
- Add the smallest direct C++ analysis and formatting dependency to `devenv.nix`.
- Preserve the explicit KWin/Plasma ABI rebuild risk.

Non-goals:

- Implement, build, run, package, or live-test a C++ effect.
- Add a Rust bridge, `cppcheck`, or any C++ source.
- Refresh the development shell, update `devenv.lock`, or use new tools.

## Applicable Principles and Decisions

- `docs/decisions.md` Active Window Border and Native C++ Safety Policy.

## Constraints

- C++ is limited to the platform-ABI-required adapter/effect surface.
- No manual ownership, `new`/`delete`, threads, custom shaders, or
  scene/window-texture manipulation without separate approval.
- C++ changes require warnings as errors, `clang-tidy`, deterministic
  `clang-format`, and focused tests.
- Verify Nix syntax and attributes only; restart the session before using the
  newly declared tools.

## Acceptance Criteria

- [x] The binding C++ safety decision records all approved constraints and ABI risk.
- [x] `devenv.nix` declares `clang-tools` without redundant tooling.
- [x] Nix syntax and the declared `clang-tools` attribute are verified without
  refreshing the shell or using the new tools.
- [x] The completed change can be archived with the restart requirement recorded.

## Unresolved Questions

- The future effect must select and document its focused C++ tests and compiler
  warning configuration when its build files are introduced.

## Consequential Decisions

- `pkgs.clang-tools` supplies both required tools with one direct dependency;
  `cppcheck` is not added because it is not required for the minimal isolated
  C++ surface.
