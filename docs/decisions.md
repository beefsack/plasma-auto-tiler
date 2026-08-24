# Current Decisions

Active user-approved decisions only. Superseded decisions remain recoverable in
Git history and archived change records.

## Active Window Border

- **Decision:** Adopt the Experimental border only fallback: a standalone,
  OpenGL-only native C++ KWin active-window-border effect. Border colour,
  width, outline radius, and outline gap are configurable; colour inherits the
  active KDE theme through narrowly scoped required KF6 dependencies by
  default, falling back to a configured custom colour when inheritance is
  unavailable.
- **Rationale:** This is the sole bounded fallback after research established no
  supported backend-portable attachment route. It is explicitly experimental,
  not a portable production rendering path.
- **Scope:** The disabled-by-default effect capability-gates rendering and is a
  clean no-op on unsupported renderers. It owns exactly one direct-value
  `KWin::OutlinedBorderItem` with automatic lifetime and exactly one approved
  scene attachment; the one-item renderer is unchanged. Configurable colour,
  width, outline radius, and gap affect only the drawn outline, never clipping
  or reshaping windows. Native border changes hot-apply. This selects no
  package, live behavior, or group feature.
- **Consequences:** The KWin/Plasma ABI rebuild risk remains explicit. Live KWin
  acceptance remains user-run.
- **Reconsider when:** KWin provides a supported backend-portable per-window
  border attachment API.

## Native C++ Safety Policy

- **Decision:** Use C++ only where the KWin platform ABI requires it, with the
  smallest public-API adapter/effect surface. The simple active border has no
  Rust bridge. The only additional native surfaces are the platform-required
  native QWidget KCM adapter and narrowly scoped KF6 Config, ColorScheme, KCM,
  and UI dependencies; the no-renderer and no-ownership broadening limits below
  remain unchanged.
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

- **Decision:** Nested-only/private live validation remains available and
  unchanged: it never launches or mutates host KWin, and visual acceptance is
  manual. Host dogfooding on the user's daily session is now a first-class,
  standing-authorized path: agents may execute reversible, user-local host
  operations without per-run authorization, and the user personally performs
  every session boundary.
- **Scope:** Standing agent authorization covers building the effect against the
  pinned KWin ABI; staging and removing the plugin under a stable, namespaced
  user-local directory; creating and removing exactly one uniquely-named session
  environment script under `~/.config/plasma-workspace/env/` owned by this
  project, and removing the superseded `~/.config/environment.d` entry of the
  same name; KWin `/Effects` D-Bus `loadEffect`/`unloadEffect` and read-only
  queries; KWin script install, enable, disable, and `reconfigure` via
  `kpackagetool6`, `kwriteconfig6`, and `qdbus6`; writing this project's own
  `[Plugins]` enablement keys in `~/.config/kwinrc` for both the KWin script and
  the native effect, which is the upstream-standard KDE mechanism for
  persistently enabling an effect and is reversible by removing the key; KWin
  `/Scripting` `loadScript` and `unloadScript` for bounded interactive test
  runs; and journal and status reads. Every session boundary - logout, login, or
  starting a session - is user-run only. Prohibited without separate approval:
  `sudo`, system plugin paths, editing or deleting any Home Manager-managed
  file, editing any `~/.config/environment.d` entry other than our own, pinning
  Home Manager generation paths, and broad cleanup of unrelated state.
- **Consequences:** Discovering the native effect requires exactly one user-run
  session boundary after the session environment script is first created;
  thereafter rebuild-and-reload is live over D-Bus and needs no boundary.
  Restoration is normal-path only: exact removal of what we created. Crash and
  power-loss rollback, hostile same-user races, and filesystem corruption remain
  out of scope. Host acceptance is a short eyeball checklist, not an automated
  evidence framework. This decision was written to govern live validation and
  dogfooding. It is now also the governing authorization for the project's
  ordinary installation path. If installation grows further host-facing steps,
  this decision should be split into separate validation and installation
  decisions rather than extended again by analogy.
- **Reconsider when:** The user withdraws standing authorization, or a required
  operation falls outside the reversible user-local set.

## Rounded Corners

- **Decision:** Rely on Plasma 6.5+ decoration-driven rounded corners.
- **Rationale:** This uses the platform capability rather than extending the
  effect to enforce corners itself.
- **Scope:** Universal compositor-enforced rounding for CSD, non-Qt, and
  XWayland clients is a product non-goal for now. The configurable outline
  radius affects only the active-border outline geometry, never window corners,
  clipping, or reshaping.
- **Consequences:** The native effect is responsible for the active border, not
  universal corner treatment.
- **Reconsider when:** Decoration-driven corners no longer meet the supported
  Plasma baseline or product requirements change.

## Unified Settings

- **Decision:** One custom native QWidget effect-scoped KCM owns every existing
  tiling, workspace, shortcut, outline, and active-border setting, placed
  through the proven Desktop Effects configuration entry.
- **Rationale:** The generic scripted KCM cannot express the native effect's
  border and theme settings; a single effect-scoped KCM keeps all product
  settings in one proven discovery location.
- **Scope:** The native KCM contains all existing tiling/workspace/shortcut
  settings plus the new outline and border settings, and replaces the duplicate
  generic scripted KCM page. Native border changes hot-apply; script settings
  save with clear reload/session-restart-required messaging for now. Existing
  script groups/keys/values are preserved with no migration. Instant
  per-workspace behavior remains out of scope. The KCM remains the sole settings
  owner; the tray may expose state, actions, and open-settings only.
- **Consequences:** One KCM owns the whole settings surface; the generic
  scripted KCM page is removed once the native KCM ships.
- **Reconsider when:** A separately approved requirement needs instant
  per-workspace or tray behavior, or the effect-scoped placement proves
  insufficient.

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

- **Decision:** The core distribution retains the script KPackage (published
  through KDE Store and as an identical GitHub Release artifact) and permits
  platform-native packages for the native effect and KCM alongside it.
- **Rationale:** Retaining the script KPackage keeps the established path simple
  and consistent while the native effect and KCM gain a platform-native package
  path.
- **Scope:** `scripts/build-kpackage.sh` exclusively owns non-mutating,
  script-only release archive and checksum construction and validation in
  disposable roots. `scripts/dogfood-install.sh` owns local script/native-effect
  installation, setup, configuration, and the documented D-Bus lifecycle. It is
  not a release-artifact publisher. Shared script-package assembly duplication
  is separate maintenance and does not merge these contracts. Platform-native
  packages for the native effect and KCM are approved alongside the retained
  script artifact; exact native package formats and publication remain gated.
- **Consequences:** This selects the release target only; no archive or
  publication is claimed as delivered. The native effect and KCM gain an
  approved platform-native package path whose formats and publication are not
  yet selected. The Core Distribution decision does not extend Native Effect
  Live Validation by analogy.
- **Reconsider when:** Exact native package formats or publication channels are
  selected for delivery.

## Tray

- **Decision:** Use a portable Rust StatusNotifierItem carrier, with the KWin
  backend first, and fail closed without a watcher. Use a proof-first fixed
  D-Bus bridge with a whitelist, outbound state snapshots, reconnect and
  idempotence, and no shell or input injection.
- **Scope:** The KCM remains the sole settings owner. The tray exposes state,
  approved actions, and open-settings only. Development is dogfood-only. Before
  release, the helper becomes official core, while the tiler remains functional
  without it. Standing authorization covers reversible, namespaced user-local
  helper build, stage, start, and stop operations, its graphical-session
  autostart entry, and session D-Bus operations; non-project state is
  prohibited.
- **Consequences:** The KWin backend and bridge proof precede broader carrier or
  distribution work. The helper is not required for core tiler operation.
- **Reconsider when:** A separately approved requirement changes the carrier,
  bridge, settings ownership, or distribution boundary.

## Layout-Aware Shifted Shortcuts

- **Decision:** At startup, the exact US layout registers the existing shifted
  aliases. Non-US, unknown, unavailable, or malformed layout state omits only
  layout-sensitive move aliases and preserves unrelated shortcuts. Layout
  changes require reload. Agents may snapshot, reconcile, and roll back only
  this project's affected KGlobalAccel records; mutation of non-project records
  requires separate approval.
- **Scope:** The policy is fail-closed and reload-only. No dynamic layout-change
  subscription is selected.
- **Reconsider when:** A separately supported layout-change signal contract or
  a different supported layout matrix is approved.

## Interactive Resize

- **Decision:** Pointer-based resize of a tiled window adjusts the shared split
  boundaries or ratios and reflows neighboring tiles.
- **Scope:** Generic pointer interactive resize is baseline product scope.
- **Reconsider when:** A separately approved resize behavior or safety boundary
  is required.
