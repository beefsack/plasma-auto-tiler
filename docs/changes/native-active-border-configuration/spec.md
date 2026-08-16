# Specification: Native Active Border Configuration

Ownership and approval:
- Owner: Lead
- Status: Expanded, approved for planning by the user and Orchestrator on
  2026-08-16.

Planning and implementation are paused on the active nested controlled
unload/cleanup acceptance gate and later host read-only feasibility. No plan,
log, state, research, implementation, test, or live action is authorized by
this checkpoint.

## Intent

Deliver a single custom native QWidget effect-scoped KCM that owns every
existing tiling, workspace, shortcut, outline, and active-border setting,
placed through the proven Desktop Effects configuration entry. Border colour
inherits the active KDE theme colour through narrowly scoped required KF6
dependencies with a configured fallback; border width, outline radius, and
outline gap are configurable and affect border geometry only. Native border
changes hot-apply; script settings save with clear reload/session-restart
messaging for now.

## Scope

In scope:

- One custom native QWidget effect-scoped KCM, placed through the proven
  Desktop Effects configuration entry.
- Active-theme colour inheritance with a configured fallback colour.
- Configurable border width, outline radius, and outline gap; border geometry
  only, never clipping or reshaping windows.
- All existing tiling, workspace, shortcut, outline, and border settings in the
  one KCM.
- Hot-apply for native border changes.
- Reload/session-restart-required messaging for script settings.
- Removal of the duplicate generic scripted KCM page once the native KCM ships.
- Preservation of existing script groups/keys/values with no migration.

## Non-Goals

- Instant per-workspace or tray behavior (future, out of scope).
- Window clipping, reshaping, or window-texture/scene manipulation.
- Universal compositor-enforced corner rounding for CSD, non-Qt, and XWayland
  clients.
- Dependencies beyond the narrowly scoped KF6 theme-colour and QWidget KCM
  libraries.
- Automatic publication of platform-native packages; exact formats and
  publication remain gated.
- Agent-executed live or host KWin mutation.

## Governance

- This specification is approved for planning; planning and implementation stay
  paused on its recorded live-validation gates.
- Native C++ stays within the existing Native C++ Safety Policy: no manual
  ownership, `new`/`delete`, threads, custom shaders, manual GL resources,
  QPainter rendering, clipping, window-texture changes, input, or broader scene
  manipulation beyond the approved exception.
- Live validation stays nested-only/private by default; host validation is a
  separate user-run path.
- The settled inputs are the decisions recorded in
  [decisions.md](../../decisions.md): Active Window Border, Native C++ Safety,
  Rounded Corners, Unified Settings, and Core Distribution.

## Constraints

- Border colour, width, outline radius, and gap may change the one approved
  outline item's own geometry; they never clip or reshape windows, manipulate
  window texture, or broaden the scene beyond that one outline item.
- KF6 dependencies are narrowly scoped to active-theme colour access and the
  QWidget KCM; no other dependency is added.
- Existing script groups/keys/values are preserved exactly; no migration.
- Native border changes hot-apply; script settings do not hot-apply and must
  show reload/session-restart-required messaging.
- The duplicate generic scripted KCM page is removed only after the native KCM
  is functional.
- Compiler warnings as errors, `clang-tidy`, deterministic `clang-format`, and
  focused deterministic/static/fake tests remain required.

## Dependencies

Framework/build dependencies (CMake targets):

- `KF6::ConfigCore` (configuration read/write and `KConfigWatcher`).
- `KF6::ColorScheme` (`KColorScheme` active-theme colour access).
- `KF6::KCMUtils` (QWidget KCM framework).
- `KF6::ConfigWidgets` (config widgets for the KCM).
- `KF6::CoreAddons` (core KF6 utilities).
- `KF6::I18n` (KCM translations).
- `Qt6::Widgets` (QWidget KCM UI).
- `Qt6::DBus` (effect/KCM D-Bus integration).
- `KWin::kwin` (existing native effect toolchain).

Exact `devenv.nix` / nixpkgs attributes for these targets are a later
dependency work-unit responsibility; a session restart is required after any
`devenv.nix` change.

Theme-watch pattern (specification level):

- Read the active theme colour with `KColorScheme` and re-read on theme change
  via `KConfigWatcher`; no specific colour role is invented or hard-coded here.

Cross-change:

- Delivered native active-border effect
  ([change](../archive/2026-08-15-active-window-border-effect/plan.md)).
- Delivered unified settings KConfigXT and generic scripted KCM
  ([change](../archive/2026-08-14-unified-settings/plan.md)).
- Active [native-effect-live-runner](../native-effect-live-runner/) controlled
  unload/cleanup acceptance and later
  [native-effect-host-live-runner](../native-effect-host-live-runner/) read-only
  feasibility for theme, geometry, stacking, and hot-apply live validation.

## Config Preservation Map

| Setting | Group | Key | Preserved |
|---|---|---|---|
| Tiling algorithm | `Script-plasma-auto-tiler-kwin` | `tilingAlgorithm` (default `dwindle`) | yes, no migration |
| Automatic split target | `Script-plasma-auto-tiler-kwin` | `automaticSplitTarget` | yes, no migration |
| Workspace mode | `Script-plasma-auto-tiler-kwin` | `workspaceMode` (default `per-output-local`) | yes, no migration |
| Shortcut profile | `Script-plasma-auto-tiler-kwin` | `shortcutProfile` (default `cosmic`) | yes, no migration |
| Drop outline preview | `Script-plasma-auto-tiler-kwin` | `dropOutlinePreview` | yes, no migration |
| Colour mode | `Effect-plasma-auto-tiler-active-border` | `colorMode` (new) | n/a |
| Fallback colour | `Effect-plasma-auto-tiler-active-border` | `fallbackColor` (new) | n/a |
| Border width | `Effect-plasma-auto-tiler-active-border` | `width` (new) | n/a |
| Outline radius | `Effect-plasma-auto-tiler-active-border` | `radius` (new) | n/a |
| Outline gap | `Effect-plasma-auto-tiler-active-border` | `gap` (new) | n/a |

Existing script keys keep their current group, key names, defaults, and values;
the native KCM reads and writes the same storage with no migration.

## Defaults and Ranges

| Setting | Default | Range |
|---|---|---|
| Colour mode | theme | theme / fixed fallback |
| Fallback colour | `#2a82da` | any valid colour |
| Border width | `2` | `1`-`10` logical px |
| Outline radius | `0` | `0`-`40` logical px |
| Outline gap | `0` | `0`-`32` logical px |

Example user-entered verification values (colour `#FF1493`, width `3`, radius
`0`, gap `0`) are input-only verification values, not a production preset or
hook.

## KCM Placement and Discovery

- One custom native QWidget KCM, effect-scoped, discovered through the proven
  Desktop Effects configuration entry (the effect's configuration button).
- The KCM is the single home for all tiling, workspace, shortcut, outline, and
  border settings.

## Duplicate Generic-Page Removal

- The existing generic scripted KCM page is removed once the native KCM ships,
  because the native KCM owns the same settings plus the border settings.
- Removal happens only when the native KCM is present and functional; no
  settings are migrated and existing stored values remain readable.

## Reload Semantics

- Native border changes (colour mode, fallback colour, width, radius, gap)
  hot-apply to the running effect.
- Script settings (tiling algorithm, workspace mode, shortcut profile) do not
  hot-apply and show clear reload/session-restart-required messaging for now.

## Theme Watching

- The border colour follows the active KDE theme colour via `KColorScheme`.
- Theme changes are observed with `KConfigWatcher` so the border re-reads the
  active colour without a manual reload; no specific colour role is invented.
- When theme colour inheritance is unavailable, the configured fallback colour
  is used.

## Rendering and Gap Geometry

- The border outline is drawn at a configurable gap (logical px) from the
  window frame edge, with a configurable width and outline radius.
- Outline geometry changes affect only the one approved outline item; they
  never clip or reshape the window, manipulate window texture, or broaden the
  scene beyond that item.
- The sole scene exception remains exactly one effect-owned direct-value
  `KWin::OutlinedBorderItem` with automatic lifetime and one scene attachment.

## Scaling and Edge Behavior

- Width, radius, and gap are logical pixels and scale with the output scale
  factor.
- Values are validated and clamped to their documented ranges; out-of-range
  values are clamped, and the default is used only for missing or invalid
  values.
- Small windows and thin margins are handled without clipping or reshaping the
  window; the outline degrades to the closest valid geometry.

## Native Package Boundary

- Platform-native packages for the native effect and KCM are approved alongside
  the retained script KPackage.
- Exact package formats and publication channels remain gated; this change does
  not select or deliver them.

## Deterministic, Static, and Fake Tests

- Deterministic unit tests for range clamping, fallback selection, and
  geometry computation (width/radius/gap).
- Static verification of KCM metadata, KConfigXT schema, and config key
  preservation.
- Fake-tool contract tests for KCM placement/discovery and reload messaging.
- Warnings-as-errors, `clang-tidy`, deterministic `clang-format`, and clean
  builds.

## User-Run Nested and Host Acceptance Gates

- Nested-only/private validation remains the default; it never mutates host
  KWin.
- Host validation is a separate user-run path gated by exact ABI/package/build
  identity, dynamic load/unload, snapshot, and rollback.
- Agents build and statically/fake-verify only; the user alone runs live
  mutation and visual acceptance, including hot-apply and theme-follow behavior.

## No Migration

- Existing script groups, keys, values, and defaults are preserved exactly.
- No migration of stored configuration is performed; the native KCM reads and
  writes the same storage.

## Rollback

- Reverting to the prior generic scripted KCM and disabled-by-default border
  effect restores prior behavior; no stored values are rewritten.
- Nested and host validation paths retain their existing snapshot and rollback
  guarantees.

## Residual Risks

- KWin/Plasma ABI rebuild risk for the native effect and KCM remains explicit.
- Theme-colour inheritance may not track every theme change without a confirmed
  change-notification seam.
- Removing the generic scripted KCM page could orphan the generic page if the
  native KCM fails to load; removal is gated on a functional native KCM.
- Hot-apply for border settings is unproven until user-run live acceptance.
- Native package formats and publication remain unresolved and gated.

## Acceptance Criteria

- [ ] One custom native QWidget effect-scoped KCM is discovered through the
      Desktop Effects configuration entry.
- [ ] Border colour inherits the active KDE theme colour through narrowly
      scoped KF6 dependencies, falling back to the configured colour.
- [ ] Width, outline radius, and gap are configurable within their ranges,
      affect border geometry only, and never clip or reshape windows.
- [ ] Native border changes hot-apply; script settings show reload or
      session-restart-required messaging.
- [ ] The duplicate generic scripted KCM page is removed only after the native
      KCM is functional; existing script groups/keys/values are preserved with
      no migration.
- [ ] Deterministic/static/fake tests, warnings-as-errors, `clang-tidy`,
      `clang-format`, and clean builds pass.
- [ ] User-run nested and host acceptance confirm hot-apply, theme-follow,
      geometry, scaling, and no clip/reshape behavior.

## Pending Decisions

- None. The approved specification remains paused on the recorded nested
  controlled unload/cleanup and later host read-only-feasibility gates.
