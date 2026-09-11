# Dev Focus Indicator

## Goal

Make the focused window immediately visible during development without adding
project code or reintroducing the experimental native active-border effect.

## Outcome

- Select KWin's built-in, disabled-by-default `Dim Inactive` effect: active
  windows stay bright and inactive windows are darkened.
- User action: System Settings, search `Desktop Effects`, under `Focus` enable
  `Dim Inactive`, then Apply. Disable it and Apply to undo.
- Equivalent user-run command: `kwriteconfig6 --file ~/.config/kwinrc --group Plugins --key diminactiveEnabled true && qdbus org.kde.KWin /KWin reconfigure`.
  Replace `true` with `false` to undo.

## Scope And Evidence

- This is an upstream KWin effect, not project code; no controller reload,
  project configuration mutation, native-effect build, load, or installation is
  required.
- KWin 6.7.4 metadata places it in `Focus`, defaults it disabled, and describes
  darkening inactive windows (`src/plugins/diminactive/metadata.json:3-4,51-53`).
- Its paint path leaves the active window undimmed and changes inactive-window
  brightness and saturation (`src/plugins/diminactive/diminactive.cpp:151-204`).
- The `diminactiveEnabled` key follows KWin's `[Plugins]` `<effect>Enabled`
  loader contract (`src/effect/effectloader.cpp:52-69`). Static source evidence
  only; the user owns live confirmation.
