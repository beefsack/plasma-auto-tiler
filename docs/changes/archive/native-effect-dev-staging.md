# Native Effect Dev Staging

## Goal

- Stage the native active-border effect plus KCM via
  `just build-native-effect` into repo-local
  `target/kwin-native-effect-stage/` for `QT_PLUGIN_PATH` use.

## Scope

- Recipe only configures/builds against the pinned KWin CMake dir and freshly
  stages both `.so` files; no KWin, D-Bus, config, or
  user-path mutation.
- README documents manual env-script/`kwinrc` setup, undo, and the
  logout/login boundary; Nix checks build the existing `nativeEffect`
  derivation, which validates both plugin artifacts.

## Non-Goals

- No effect/KCM behavior, defaults, schema, dev-loop recipe, or
  `devenv.nix` change; no live session, reload, or rendering claim.

## Evidence

- `nativeEffect` built with its `installCheckPhase` asserting both plugin
  paths. It is now a `nix flake check` member; the full check remains blocked
  by an unrelated existing Home Manager service-attribute assertion.
- A rebuild needs logout/login; `just dev`, `just reload`, and controller
  reload are insufficient. No OpenGL backend means no border.
