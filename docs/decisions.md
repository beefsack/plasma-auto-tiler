# Current Decisions

Active user-approved decisions only. Superseded decisions remain recoverable in
Git history and archived change records.

## Active Window Border

- **Decision:** Adopt the Experimental border only fallback: a standalone,
  OpenGL-only native C++ KWin active-window-border effect with no external
  dependency.
- **Rationale:** This is the sole bounded fallback after research established no
  supported backend-portable attachment route. It is explicitly experimental,
  not a portable production rendering path.
- **Scope:** The disabled-by-default effect capability-gates rendering and is a
  clean no-op on unsupported renderers. It owns exactly one direct-value
  `KWin::OutlinedBorderItem` with automatic lifetime and exactly one approved
  scene attachment. This selects no package, live behavior, or group feature.
- **Consequences:** The KWin/Plasma ABI rebuild risk remains explicit. Live KWin
  acceptance remains user-run.
- **Reconsider when:** KWin provides a supported backend-portable per-window
  border attachment API.

## Native C++ Safety Policy

- **Decision:** Use C++ only where the KWin platform ABI requires it, with the
  smallest public-API adapter/effect surface. The simple active border has no
  Rust bridge.
- **Constraints:** C++ changes must not use manual ownership, `new`/`delete`,
  threads, custom shaders, manual GL resources or ownership, QPainter
  rendering, clipping, window-texture changes or manipulation, input, or
  broader scene manipulation without separate approval. The sole approved
  scene exception is exactly one effect-owned direct-value
  `KWin::OutlinedBorderItem` with automatic lifetime and one scene attachment
  for the eligible active-window border. It permits no heap allocation, smart
  ownership, raw owning pointer, or other renderer or resource exception. The
  capability gate must leave unsupported renderers as a clean no-op. Compiler
  warnings as errors, `clang-tidy` static analysis, deterministic
  `clang-format` formatting, and focused tests remain required.
- **Consequences:** Native C++ remains isolated and its ABI rebuild risk stays
  explicit for KWin/Plasma upgrades.
- **Reconsider when:** A separately approved platform requirement needs a
  broader native surface or an excluded capability.

## Native Effect Live Validation

- **Decision:** Live native-effect validation is nested-only/private and never
  launches or mutates host KWin; visual acceptance is manual.
- **Scope:** The user-run runner uses a visible nested Wayland backend, private
  environment and D-Bus state, and an absolute read-only host Wayland socket.
  It does not select host KWin, service, configuration, or plugin paths.
- **Consequences:** Native-effect lifecycle evidence is limited to nested
  `/Effects`; host behavior is neither exercised nor accepted.
- **Reconsider when:** The user explicitly approves a different validation
  boundary.

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

- **Decision:** Keep grouped/tabbed windows parked for compositor-owned KWin
  core support and the existing user-run multi-window Custom Tile stability
  proof.
- **Rationale:** Group behavior requires compositor-owned lifecycle, focus,
  input, hit-test, and shared-container behavior that an active-border effect
  cannot provide.
- **Scope:** Grouped windows must not share the active-border carrier. The
  Custom Tile proof is necessary but insufficient; no group interaction,
  carrier, controls, bindings, or implementation is selected.
- **Consequences:** Do not begin group design or implementation before the core
  support and proof gates are met.
- **Reconsider when:** KWin core support and the live proof establish a feasible
  compositor-owned group model.

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
