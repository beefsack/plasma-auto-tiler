# Native Effect KCM

## Goal

Provide the selected native effect-scoped settings page without broadening the
native safety boundary.

## Scope And Dependencies

- The KCM owns tiling, workspace, shortcut, outline, and border settings.
- Its KConfig, KCMUtils, and WidgetsAddons dependencies are declared in
  `devenv.nix`; restart the development session after that dependency change.
- Native-effect research remains at
  [active-border research](../../research/active-window-border/) and
  [declarative feasibility](../../research/active-border-declarative-feasibility/).

## Outcome

- Added the native effect-scoped QWidget KCM and shared KConfigXT border
  settings. Existing script keys, values, defaults, and config group are
  preserved and saved through the original `Script-plasma-auto-tiler-kwin`
  group.
- Added native color, width, radius, and gap settings under
  `Effect-plasma-auto-tiler-active-border`. The effect uses the theme highlight
  color with the configured color as fallback and reconfigures through KWin
  D-Bus after KCM Apply.
- Added native KCM staging to the reversible dogfood installer.
- Evidence: native CMake configure/build passed; CTest passed 6/6; static KCM
  tests passed 8/8; dogfood lifecycle tests passed 482/482; package contract,
  TypeScript typecheck, and isolated install-prefix layout passed.
- Static delivery is complete. Manual Desktop Effects KCM smoke plus separately
  authorized live active-border, host ABI, and session discovery remain in the
  native active-border backlog item.
