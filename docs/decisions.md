# Current Decisions

Only active, user-approved product and project choices are recorded here.
Historical implementation detail is recoverable in Git history.

## Native Active Border

- The active-window border is an MVP requirement. Use an experimental,
  disabled-by-default, OpenGL-only native C++ KWin effect
  for the active-window border. Colour, width, outline radius, and gap are
  configurable; `UseThemeColor` in `Effect-plasma-auto-tiler-active-border`
  defaults true, migration-free: enabled retains theme highlight with
  configured fallback, disabled selects configured colour unconditionally.
  The native QWidget KCM controls it through the existing hot-apply/repaint
  path.
- Nix delivery and exact host KWin ABI/session discovery are required for
  runtime delivery; neither is an optional enhancement. Runtime acceptance
  remains unproven.
- The outline never clips, reshapes, or changes window textures. Plasma 6.5+
  decoration-driven rounded corners remain the selected corner solution.
- C++ is limited to platform-required public-API adapters and effects. Manual
  ownership, threads, custom shaders or GL resources, QPainter, input,
  clipping, texture changes, and broader scene manipulation are excluded. The
  sole scene exception is one effect-owned automatic-lifetime
  `KWin::OutlinedBorderItem`.

## Settings And Distribution

- One native QWidget effect-scoped KCM owns tiling, workspace, shortcut,
  outline, and border settings through the Desktop Effects entry. Existing
  script groups, keys, values, and defaults remain unchanged. The KCM's
  hot-apply and any script reload or session-restart result remain live gates.
- The core distribution remains the script KPackage for KDE Store and an
  identical GitHub Release artifact. Platform-native packages for the native
  effect and KCM are permitted; their formats and publication are unselected.
- Nix-first current-host delivery is selected. The repository flake statically
  exports `packages.default`, `packages.kwin-script`,
  `packages.native-effect`, and `packages.tray`, plus
  `lib.mkKwinScript`, `lib.mkNativeEffect`, and `lib.mkTray`. It also exports
  default NixOS and Home Manager modules. The convenience
  `packages.native-effect` is built from this flake's pinned nixpkgs input, so
  an external consumer that directly uses it must make this repository's
  `nixpkgs` input follow the host nixpkgs. The `lib.mkNativeEffect` factory
  instead uses the caller's `pkgs` and matching `kdePackages.kwin.dev`; the
  NixOS module calls that factory with its caller `pkgs`, making factory/module
  consumption host-pkgs safe. This project does not inspect or change the
  external consumer repository. The current build baseline remains `devenv.nix`.
- The native effect is not a portable prebuilt binary; every build targets the
  Nix-managed Plasma/KWin package set used for that build.
- The NixOS module owns the system KPackage/native-effect packages and writes
  only `[Plugins] plasma-auto-tiler-kwinEnabled=true` in its immutable global
  KWin profile. It does not enable the native border or mutate shortcuts. The
  Home Manager module owns only the optional immutable tray XDG autostart file
  and has no activation hook.
- Flake source filesets are explicit for the KWin script, native effect/KCM,
  and tray package; build trees, generated artifacts, and unrelated repository
  files are excluded.
- Development iteration uses the packaged baseline plus a namespaced,
  reversible, user-local dogfood override as the smallest selected boundary.
  It must not coexist with a Nix-managed copy of the same KWin plugin IDs, must
  preserve exact normal-path restoration, and must not mutate system or
  unrelated state.

## Live KWin/Plasma Boundary

- Reversible, project-scoped live host tests may run under the reviewed
  repository protocol. They must be namespaced, fail closed, and provide exact
  restoration; if exact restoration cannot be verified, stop and leave the
  residue for user action.
- This covers project builds; native-effect staging/removal; the project's
  `plasma-workspace/env` script and same-name legacy migration; KWin `/Effects`
  load/unload and read-only queries; KWin script install, enable, disable, and
  reconfigure; bounded `/Scripting` load/unload; project tray-helper lifecycle,
  session-D-Bus operations, and journal/status reads; and disposable
  project-owned Custom Tile tests when exact restoration is verified.
- Physical or manual observations and every logout, login, or new-session
  boundary require user action. No `sudo`, system-path mutation,
  external-dotfiles mutation, unrelated host mutation, irreversible cleanup,
  or ambiguous-residue deletion is authorized.
- Current-host Nix integration, KWin/session load or reload, watcher ordering,
  login/autostart behavior, and update/rollback activation across Nix
  generations are pending live evidence, not passed by static evaluation or
  shell tests. A session boundary is a required evidence boundary for claims
  about session-delivered packages.
- Deleting or restoring preserved candidates, containers, or host artifacts
  needs explicit user authorization plus exact path and identity or hash
  verification.
- The Custom Tile acceptance harness is an accepted static, current-session
  read-only preflight. It strictly diagnoses KWin and KGlobalAccel ownership and
  fails closed on stale state, collisions, drift, or provenance ambiguity; it
  performs no lifecycle or mutation. Its rollback and journal contract is for a
  later authorized run only.
- `python3` was added intentionally to `devenv.nix`; the development session
  has been restarted and the committed dependency is available. The
  static carrier-only operational provenance harness is verified, but no
  successful carrier smoke occurred: bounded attempts either stopped before
  effect or were receipt-bound restored. A new smoke is blocked by two retained
  protected project runtime evidence records. Handling those records requires
  explicit user authorization under a race-safe recovery procedure; after that,
  one bounded carrier-only smoke must prove exact host baseline equality. A
  separately authorized Custom Tile journey remains a later gate.
- The inert checkout carrier establishes only operational lifecycle binding
  through its exact plugin/script identity, receipt, diagnostic, and unchanged
  KWin identity. Current public KWin APIs do not provide direct evaluated-memory
  source proof for the checkout controller, so `authoritative_ready` remains
  false; the carrier does not change that verdict.
- The preflight reports phased readiness: `setup_ready` proves only its
  read-only KWin, KGlobalAccel, shortcut, and persisted-state checks completed
  without drift; `journey_ready` and `authoritative_ready` remain false until
  the applicable acceptance gates are established. No readiness phase
  authorizes a Custom Tile lifecycle, live journey, or user physical or manual
  action on its own; carrier setup is limited to its bounded operational
  binding.

## Window And Workspace Behavior

- Pointer resize adjusts shared split boundaries or ratios and reflows
  neighbouring tiles.
- Floating is per-window, retains its tile leaf, and renders above tiled
  windows. `Meta+G` toggles it; `Meta+Shift+G` makes a floating window sticky.
- Maximize (`Meta+M`) is workspace-local. Fullscreen (`Meta+F11`) is separate:
  it is never tiled, resized, or reflowed, and preserves the tree for restore.
- `workspaceMode` supports `per-output-local`, `global-unique`, and `shared`.
  The active model maintains one structurally trailing empty workspace per
  relevant domain; `Meta+0` and `Meta+Shift+0` reuse it before creating one.

## Shortcuts

- The initial release supports standard US keyboards and preserves hardcoded
  shifted aliases. Layout detection, omission, opt-in configuration, migration,
  and KGlobalAccel reconciliation are deferred.
- Non-conflicting project shortcuts register by default. Conflicting
  Plasma-global shortcuts change only through explicit KCM Apply and Revert.
  Focus-right is `Meta+L`; the explicit override moves KDE lock to `Meta+Esc`.
  Recovery is explicit in the KCM, Revert restores only bindings still owned by
  that override, and unexpected conflicts are refused. Installation and startup
  never mutate global shortcuts.

## COSMIC Movement And Groups

- COSMIC-style tiling and directional movement are MVP. The directional path
  replaces the legacy path; there is no legacy fallback. Production promotion
  and live acceptance remain gated by the active review findings.
- Grouping here means nested split-tree structure and placement. `H[H[1 2] 3]`
  is distinct from `H[1 H[2 3]]`; tabs, stacked/shared groups, and compositor
  group behavior are excluded.
- Grouped/tabbed windows remain deferred pending compositor-owned KWin support
  and a live multi-window Custom Tile stability proof. No group carrier,
  controls, bindings, or shared active-border behavior is selected.

## Nested Placement Affordance

- Replace the temporary outline interaction with a minimal COSMIC-like,
  deterministic nested-placement affordance. It is a placement affordance, not
  opacity or dimming behavior.

## Tray

- Use a portable Rust StatusNotifierItem carrier with the KWin backend first;
  fail closed without a watcher. The bridge is whitelisted, outbound
  state-snapshot based, reconnecting, idempotent, and has no shell, input, or
  helper-to-KWin action route. The KCM remains the settings owner.
- Snapshot publication requires the current `org.kde.KWin` D-Bus owner and an
  exact canonical executable identity from the host current-system or
  `/usr/bin` KWin entrypoints; unlisted KWin launch paths fail closed.
- The static bridge includes freshness and ordering/generation checks,
  idempotent notifications, and bounded watcher retry. Watcher ordering,
  login, and XDG autostart behavior remain pending live evidence.
- Home Manager autostart uses the immutable store tray binary with the fixed
  `tray-managed` mode; `TryExec` remains the immutable store binary alone.
  Managed mode uses only `$XDG_RUNTIME_DIR/plasma-auto-tiler-managed` for its
  lock and PID state and never installs or mutates the dogfood helper state.
- Managed startup accepts only the current safe regular executable resolved
  under `/nix/store`, with exact PID, start-tick, path, device, inode, and
  content binding. Malformed, unowned, replaced, symlinked, wrong-mode,
  unreadable, or ambiguous state fails closed; cleanup removes only exact
  managed state. The no-argument endpoint and lifecycle commands retain the
  existing dogfood namespace and semantics.
- The helper is not required for core tiler operation. Normal lifecycle
  rollback is exact and in-process; interrupted, crash, power-loss, malformed,
  replaced, or ambiguous state fails closed. Durable recovery and automatic
  post-crash retry are not selected.
- The tray MVP provides basic status and Settings only. It has no direct tiling
  controls and no expansion of the helper boundary.
- One current-session manual start of the current-generation immutable store
  `tray-managed` binary proved only exact managed process/runtime binding under
  `$XDG_RUNTIME_DIR/plasma-auto-tiler-managed`, SNI registration with
  `unavailable` status, and one fixed Settings action with exact
  Settings-process cleanup. No KWin snapshot authority is claimed from that run.
- That run claims no visual panel behavior, no watcher-ordering/login/autostart
  delivery, no native ABI/plugin load, no baseline-restoration proof, and no
  KWin Script1 identity or cleanup.
- The pre-repair current immutable process held
  `org.plasmaautotiler.Tray/StatusNotifierItem` but timed out on every SNI
  object request, including `Peer.Ping`; Plasma could not obtain its icon,
  tooltip, menu, or activation from that process.
- One bounded disposable repaired candidate answered SNI `Peer.Ping`,
  introspection, and properties; returned valid icon-pixmap, tooltip, menu, and
  method contracts; completed one fixed Settings launch with exact resulting
  process cleanup; and terminated with exact original autostart restoration.
  It claims no panel visual behavior or session boundary.

## Deferred Scope

- Retain JavaScript for discrete window add/remove management. Portable
  cross-WM/OS engine research follows settlement of the COSMIC and pointer
  paths. Group behavior, inactive borders, Steam-specific handling, and
  complete keyboard-layout support remain deferred.
