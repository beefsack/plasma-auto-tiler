# AGENTS.md

## Live KWin/Plasma Testing

- Before any live KWin/Plasma testing, read and follow
  [docs/live-kwin-testing.md](docs/live-kwin-testing.md). It does not grant
  mutation authorization.

## Live Windows Testing

- Before any live Windows testing (input hooks, moving/hiding/restyling other
  windows, desktop overlays, forced-crash recovery probes, or registry/policy
  writes), read and follow [docs/live-windows-testing.md](docs/live-windows-testing.md).
  It does not grant mutation authorization.

## Dependency Management

- Linux: system and toolchain dependencies for this project are managed by
  `devenv.nix` (devenv + Nix). Do not install dependencies globally or
  ad hoc.
- When a new Linux system dependency is required, `devenv.nix` must be
  updated to add it.
- After `devenv.nix` is changed, advise the user to restart the session
  so the new dependencies are loaded into the environment. Do not assume
  the dependency is available until that has happened.
- Windows: native dependencies, their install commands and the pinned Rust
  version are listed in
  [docs/windows-dev-environment.md](docs/windows-dev-environment.md). Use
  only listed tools. A new Windows dependency is added to that list first,
  with user approval. The user performs installs; ask before installing
  anything. Never add Windows tools to `devenv.nix`.
- Rust crate dependencies belong in `Cargo.toml`. `devenv.nix` and the
  Windows list are for system-level and toolchain dependencies only.
