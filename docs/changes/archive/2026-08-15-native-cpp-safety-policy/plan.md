# Plan: Native C++ Safety Policy

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-15 by Orchestrator under autonomous mode

## Technical Approach

Add the concise binding policy to the active decisions and add
`pkgs.clang-tools` to the existing direct `devenv.nix` package list. It
contains `clang-tidy` and `clang-format`, satisfying the required compiler-aware
analysis and deterministic formatting without an additional package.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification |
|---|---|---|---|---|
| unit-01 | Record and declare the policy/tooling. | - | `docs/decisions.md`, `devenv.nix` | Reviewed diff. |
| unit-02 | Verify and archive the accepted change. | unit-01 | `docs/changes/native-cpp-safety-policy/` | Nix parse/attribute evaluation, link check, Git checks. |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Progress

- [x] unit-01 Record and declare the policy/tooling.
- [x] unit-02 Verify and archive the accepted change.

## Pending User Decisions

- None.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Binding C++ safety decision records constraints and ABI risk | `docs/decisions.md` Native C++ Safety Policy. |
| One nonredundant analysis/formatting dependency | `devenv.nix` declares `clang-tools`; Nix resolves `clang-tools-21.1.8`. |
| Syntax and attribute verification without tool use | `nix-instantiate --parse devenv.nix` and `nix eval` of `pkgs.clang-tools.name` succeeded, resolving `clang-tools-21.1.8`. |
| Archive and restart requirement | Archive completion and the `devenv.nix` restart requirement are recorded here. |

## Residual Risks

- KWin/Plasma ABI changes can require native effect rebuilds; no effect source
  or build configuration exists yet to enforce the future C++ requirements.

## Final Outcome

- Accepted: the policy and declared `clang-tools` dependency are complete. The
  development session must be restarted before `clang-tidy` or `clang-format`
  are used. No shell refresh, C++ build, or live KWin action occurred.
