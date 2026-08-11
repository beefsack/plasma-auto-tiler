# AGENTS.md

## Live KWin/Plasma Testing

- Before any live KWin/Plasma testing, read and follow
  [docs/live-kwin-testing.md](docs/live-kwin-testing.md). It does not grant
  mutation authorization.

## Dependency Management

- System and toolchain dependencies for this project are managed by
  `devenv.nix` (devenv + Nix). Do not install dependencies globally or
  ad hoc.
- When a new system dependency is required, `devenv.nix` must be updated
  to add it.
- After `devenv.nix` is changed, advise the user to restart the session
  so the new dependencies are loaded into the environment. Do not assume
  the dependency is available until that has happened.
- Rust crate dependencies belong in `Cargo.toml`. `devenv.nix` is for
  system-level and toolchain dependencies only.
