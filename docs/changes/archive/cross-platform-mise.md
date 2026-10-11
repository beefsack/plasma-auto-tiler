# Cross-platform dev environment via mise

## Goal and scope

- Adopt one root `mise.toml` for the already approved Windows/macOS tools,
  including Rust via rustup stable; retain Linux devenv/Nix and system libraries.
- Update dependency guidance and both host runbooks; installations remain
  user-owned. Do not install mise or dependencies on this test system.
- Add proportionate hosted installation evidence. Consider pin comparison only
  where both managers actually pin the same tool.
- Exclude product code, backlog/principles edits and live desktop testing.

## Acceptance and approach

- Root config uses OS-filtered entries and no unapproved tools; Rust keeps
  latest stable, rustfmt/clippy and the Windows MSVC host.
- Runbooks distinguish mise-managed tools from OS prerequisites, give root-run
  install/exec commands, and preserve the user-performs-installs rule.
- Static validation without local mise, native Windows gates and hosted CI pass.
- Record ordinary reversible choices as provisional in `docs/decisions.md`;
  archive this record at completion and commit/push accepted work.

## Bounded units

1. Read-only investigation of approved tools, mise syntax and Rust/Nix policy.
2. Implement the root config, minimal guidance and hosted install checks.
3. Lead review, verification, accepted evidence and archive.

## Accepted evidence and decisions

- Initial tree clean at `432850e`.
- Official mise Rust backend uses rustup, installs configured components and
  selects a toolchain through `RUSTUP_TOOLCHAIN`; this is not a persisted rustup
  directory override. Root Rust entry is required by the user's selected route.
- Linux Rust comes from the nixpkgs revision in `devenv.yaml`; a rolling stable
  channel and a nixpkgs revision are not two exact pins to compare.
- Implemented six OS-filtered tools: rust/just/jq/gh/ripgrep on Windows/macOS,
  yq on Windows only. PowerShell remains the manual Store/MSIX host shell,
  avoiding a redundant portable installation and host-shell shadowing.
- Native rustup stable MSVC baseline passes locked four-package build/test,
  rustfmt and strict all-target clippy (2026-10-03); this is not local mise proof.
- TOML and workflow YAML parse with existing yq; `git diff --check` passes.
- Implementation commit `4e95150` passed all five hosted jobs (Rust, KWin,
  shell, Windows, macOS):
  [CI 37126973606](https://github.com/beefsack/omnitiler/actions/runs/37126973606).
- Hosted logs confirm six installed Windows tools and five on macOS 15 arm64,
  with stable Rust 1.99.0 (`x86_64-pc-windows-msvc` and
  `aarch64-apple-darwin`). Windows mise-selected locked Cargo gates pass;
  macOS tool/host/rustfmt/clippy smoke checks pass (24-second job).
- Provisional choices recorded in `docs/decisions.md`: rolling selectors without
  a lockfile; hosted installation checks instead of an exact Nix equality gate.
- User-owned acceptance: install mise and run `mise install` from the root on
  Windows and the future macOS host; verify local tool selection and OS SDKs.

## Outcome and handover

- Delivered root configuration, minimal dependency guidance, both runbooks,
  and hosted install coverage. No local installs or live desktop tests were run.
- No semantic failed approaches or causal repairs. No Worker remains running.
- Risks: rolling installs can change versions; local installation/SDK readiness
  remains user-owned. macOS CI is install smoke evidence, not product acceptance.
- Proposed backlog text: "Cross-platform dev environment (mise): delivered;
  root Windows/macOS config and hosted install checks green. User local mise
  setup pending; Linux remains devenv/Nix."
- Next action: user installs mise, then runs root `mise trust`, `mise install`
  and `mise exec -- rustc -vV`; Lead implementation work is complete.
