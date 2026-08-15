# Current Decisions

Active user-approved decisions only. Superseded decisions remain recoverable in
Git history and archived change records.

## Active Window Border

- **Decision:** Use a standalone native C++ KWin effect for the active-window
  border, with the required `devenv.nix` toolchain work.
- **Rationale:** The declarative path requires scene reconstruction; a native
  effect is the smallest supported route for the border.
- **Scope:** This selects the implementation direction only. It does not claim
  an effect, toolchain change, package, or live behavior is delivered.
- **Consequences:** Declare required system dependencies in `devenv.nix` before
  use and restart the development session after that file changes. Live KWin
  acceptance remains user-run.
- **Reconsider when:** Native-effect APIs or packaging constraints make this
  path impractical.

## Native C++ Safety Policy

- **Decision:** Use C++ only where the KWin platform ABI requires it, with the
  smallest public-API adapter/effect surface. The simple active border has no
  Rust bridge.
- **Constraints:** C++ changes must not use manual ownership, `new`/`delete`,
  threads, custom shaders, or scene/window-texture manipulation without
  separate approval. They require compiler warnings as errors, `clang-tidy`
  static analysis, deterministic `clang-format` formatting, and focused tests.
- **Consequences:** Native C++ remains isolated and its ABI rebuild risk stays
  explicit for KWin/Plasma upgrades.
- **Reconsider when:** A separately approved platform requirement needs a
  broader native surface or an excluded capability.

## Rounded Corners

- **Decision:** Rely on Plasma 6.5+ decoration-driven rounded corners.
- **Rationale:** This uses the platform capability rather than extending the
  effect to enforce corners itself.
- **Scope:** Universal compositor-enforced rounding for CSD, non-Qt, and
  XWayland clients is a product non-goal for now.
- **Consequences:** The native effect is responsible for the active border, not
  universal corner treatment.
- **Reconsider when:** Decoration-driven corners no longer meet the supported
  Plasma baseline or product requirements change.

## Grouped Windows

- **Decision:** Keep grouped/tabbed windows as a future goal after the active
  border, gated by a live multi-window Custom Tile stability proof.
- **Rationale:** Group behavior depends on recoverable shared-tile membership
  under real KWin window lifecycle behavior.
- **Scope:** No group interaction, carrier, controls, bindings, or implementation
  is selected.
- **Consequences:** Do not begin group design or implementation before both
  prerequisites are satisfied.
- **Reconsider when:** The live proof changes the feasible Custom Tile model or
  product priorities change.

## Core Distribution

- **Decision:** The initial core distribution is one KPackage archive published
  through KDE Store and as an identical GitHub Release artifact.
- **Rationale:** One shared artifact keeps the initial distribution path simple
  and consistent.
- **Scope:** Native distribution packages are deferred until native effects or
  demand require them.
- **Consequences:** This selects the release target only; no archive or
  publication is claimed as delivered.
- **Reconsider when:** Native-effect delivery requires native packages or user
  demand justifies platform packages.
