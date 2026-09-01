# Nix Current-Host Delivery

## Goal

Provide Nix-first current-host package, install, update, and rollback outputs
for the MVP without changing the external consumer repository.

## Scope And Non-Goals

- The repository exposes reproducible outputs for external consumption,
  including the script package, native build artifacts, and Rust tray binary;
  these outputs are not implemented yet.
- Installation remains user-local and namespaced; runtime lifecycle must not
  mutate system or unrelated state.
- This record does not establish runtime compatibility with an arbitrary KWin:
  exact host KWin ABI/session discovery remains required for the native effect.

## Acceptance

- Clean install, update, rollback, and session lifecycle operations restore
  exact prior project-owned state and fail closed on ambiguous state.
- The current host can consume the repository outputs without inspecting or
  changing the external consumer repository.

## Approach And Dependencies

- Keep `devenv.nix` as the current build baseline while adding the selected
  repository flake outputs.
- Package the existing KPackage archive, native CMake artifacts, and user-local
  tray binary; dogfood uses the namespaced/reversible override boundary.
- Depend on the Custom Tile, native border ABI/session, and tray lifecycle
  acceptance paths before declaring MVP delivery complete.

## Verification

- Existing packaged build paths are accepted by audit evidence. No repository
  flake, install/update implementation, or clean lifecycle validation is
  currently claimed.

## Material Decisions And Accepted Evidence

- Nix-first current-host delivery is selected, but a flake does not directly
  establish runtime installation or lifecycle behavior without explicit
  activation.
