# Rust toolchain tracking (2026-10-04)

## Goal and acceptance

- Check the recurring pre-1.0 latest-stable Rust policy against upstream and
  both repository Nix inputs; upgrade only when a suitable revision exists.
- Compare Rust, KWin/Plasma, Qt and Frameworks versions before selecting a pin;
  preserve the host-derived native development build authority.
- Document the missing bump procedure, run local Windows gates, and require all
  hosted CI jobs green for the delivered commit. Archive this record at handover.
- No tool installs, host/session changes, or backlog/principles edits.

## Approach and material finding

1. Investigate upstream releases, pin sources, lockfiles and build consumers.
2. Confirm candidate availability and native CI versions; document the procedure.
3. Verify Windows stable gates and hosted CI; fix concrete breakage if any.

Rust 1.99.0 was released on 2026-10-01. The current devenv pin and checked
`nixos-unstable`/`master` still package 1.98.1. A freshness-only bump would not
meet the Rust acceptance condition. Keep the bump parked pending an eligible
revision, rather than introduce package churn or a new Rust overlay policy.

Rust 1.99.0 has landed on nixpkgs `staging`, not yet on the checked
`staging-next`, `master` or `nixos-unstable` snapshots. The existing pin is an
ancestor of `nixos-unstable`; the user's NixOS host also follows that channel.
No repository file declares a named channel for the bare revision. Preserving
that unstable lineage is the scoped recommendation, not a new channel policy.

`devenv.yaml` and tracked `devenv.lock` agree on
`e554fab72f81915600f3f449b786fd9af40439a5`. Native CI uses the separate
`flake.nix`/`flake.lock` input, while native development uses the installed KWin
derivation. Record their separate version baselines and host-check limits.

## Evidence and outcome

- Checked 2026-10-04 through GitHub API/raw sources; no Nix available locally.

| Consumer / revision | Rust | KWin/Plasma | Qt | KDE Frameworks |
| --- | --- | --- | --- | --- |
| Devenv, `e554fab72f81915600f3f449b786fd9af40439a5` | 1.98.1 | 6.7.5 | 6.11.2 | 6.30.0 |
| Candidate unstable, `c59305bab2065cfecc4944690d9eedbb56f3a9fa` (2026-10-01) | 1.98.1 | 6.7.5 | 6.11.2 | 6.30.0 |
| Native CI / standalone flake, `54ba4bcec4043e72a4006d825e0d7aff5562008f` | 1.97.1 | 6.7.4 | 6.11.1 | 6.29.0 |

- Both tracked lockfiles match their respective declared pins. Old/new pins
  and all versions remain identical within each consumer; no lock hash edits.
- `kwin` CI runs script tests/typechecking in devenv, not a C++ effect build.
  The `native` job uses the flake input for CMake/Rust FFI/CTest. Native
  development uses the exact installed KWin derivation, including its Qt/KF
  build environment, as documented in
  [host-matched builds](archive/host-matched-native-development-builds.md) and
  [the earlier patch-version ABI failure](archive/native-dev-setup-lifecycle.md).
  Changing only the devenv pin does not replace that host-native authority.
- Source paths at each revision: Rust version in
  `pkgs/development/compilers/rust/1_97.nix` or `1_98.nix`, default selection
  in `pkgs/top-level/all-packages.nix`; KWin in
  `pkgs/kde/generated/sources/plasma.json`, KF in `frameworks.json`, Qt in
  `pkgs/development/libraries/qt-6/srcs.nix`.
- Upstream latest: [Rust 1.99.0](https://github.com/rust-lang/rust/releases/tag/1.99.0),
  published 2026-10-01. Nixpkgs
  [Rust update commit](https://github.com/NixOS/nixpkgs/commit/c9f19b6be67332ce2ee7520c1630c804685df838)
  is on `staging` snapshot `968b3b08d1d0148def15d7806dd7bb1579c52509`,
  with `1_99.nix` / default `rust_1_99`. Checked `staging-next`
  `7ee131c48718aa7f0aa4c2074e1bd58aa8db9ab9` and `master`
  `5bd4313236f003927898ffee33f06ea651fd6b5b` still select
  `rust_1_98`; there is no eligible unstable Rust upgrade yet.
- Options: wait for the update to reach unstable (recommended); use staging
  or an overlay (separate decision, expands dependency/toolchain scope); bump
  to `c59305ba` now (no Rust/KDE version improvement, unrelated package churn).
- Added the missing procedure in
  [Windows development environment](../windows-dev-environment.md#nixpkgs-rust-pin-bump-procedure-linux-windows-unaffected).
  `devenv update nixpkgs` syntax was checked against
  [CI's v2.4.0 CLI source](https://github.com/cachix/devenv/blob/v2.4.0/devenv/src/cli.rs).
- Windows local stable remains rustc 1.98.1, MSVC host, default with no override;
  mise is absent from this shell's PATH. The four-package locked build/test
  (1004 tests), all-workspace rustfmt check and strict all-target Clippy passed
  via the installed `cargo +stable`. No local Rust lint breakage found.
- Hosted CI for this record/procedure commit is pending. No live desktop
  testing, host realization, or native ABI claim from Windows.

## Handover and next action

- Pin bump parked on upstream channel availability; no provisional product
  decision or durable policy change. Keep the recurring P1 item open.
- Next: recheck `nixos-unstable` for default Rust 1.99.0 (or newer stable),
  compare KDE versions, regenerate the devenv lock on Linux, and rerun CI.
  Review the separate flake input when extending latest-stable coverage to
  native CI/standalone packages; do not infer it follows the devenv pin.
- User-owned: update Windows stable through mise when available; after any
  future Linux pin bump, exit and re-enter devenv before using new tools.
  Validate host-native builds on the user's KDE machines with `resolve`,
  host-matched rebuild and fresh Plasma activation. The host state cannot be
  checked from this Windows session; patch-level KWin ABI matters too.
