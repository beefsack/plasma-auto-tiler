# Plan: Native Effect Toolchain

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-15 by Orchestrator under autonomous mode

## Technical Approach

Add the requested direct packages to `devenv.nix`. Attribute evaluation found
KWin 6.7.3, Qt 6.11.1, and ECM/KPackage 6.28.0 in the current project Nix
context; `kdePackages.kwin.dev` exposes `lib/cmake/KWin`. Its development
closure supplies Qt/KF development dependencies, so none are declared
separately. The project lock pins NixOS/nixpkgs revision
`243895692ae2a2fbd08a05141462c0cc0d3ca10f`.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification |
|---|---|---|---|---|
| unit-01 | Declare the minimal native-effect build and archive toolchain. | - | `devenv.nix` | Nix parse and attribute evaluation. |
| unit-02 | Record evidence and archive the accepted change. | unit-01 | `docs/changes/native-effect-toolchain/` | Git diff, status, and commit inspection. |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Progress

- [x] unit-01 Declare and verify the toolchain.
- [x] unit-02 Archive the accepted change.

## Pending User Decisions

- None.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Requested direct tools without redundant Qt/KF declarations | `devenv.nix` declares seven direct packages only; `kdePackages.kwin.dev` supplies the KWin/Qt/KF development closure. |
| Valid Nix syntax and package attributes | `nix-instantiate --parse devenv.nix` succeeded; module evaluation resolved `cmake-4.3.4`, `ninja-1.13.2`, `pkg-config-wrapper-0.29.2`, `zip-3.0`, `extra-cmake-modules-6.28.0`, `kwin-6.7.3`, and `kpackage-6.28.0`. |
| Archive and mandatory restart record | This plan is archived; `docs/decisions.md` requires a restart before using the declared dependencies. |

## Residual Risks

- The effect source does not yet exist, so the exact exported KWin CMake target
  remains unverified.

## Final Outcome

- Accepted: the minimal declared toolchain is archived. No refreshed shell,
  effect build, or live KWin action was performed.
