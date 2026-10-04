# Windows settings (parity item 11)

## Goal and scope

- Persistent per-user Windows settings, a native settings window, Apply/Revert,
  live core-setting updates, and honest per-binding OS conflicts/presets.
- KDE is the reference for keys, validation and defaults. Replace the temporary
  yellow border with theme/accent on and configured `#2a82da` fallback.
- No registry/policy changes or new toolkit. Keep recovery ownership intact.
- Do not implement unsupported workspace modes or unrelated parity features.

## Acceptance

- Validated, atomically saved settings under LocalAppData; normal owner loads
  them at startup. Proof owners retain deterministic explicit configuration.
- Apply saves validated edits; Revert reloads the last saved values without
  writing or undoing already-applied settings. Failures are visible.
- Gaps, border/underlay and keyboard/mouse takeover settings apply live with
  existing safety/recovery fences and observable owner acknowledgement.
- Each implemented shortcut has keep/disable/rebind and truthful conflict text;
  authentic/compatible presets preserve KDE actions and the Win+L opt-in gate.
  Win+G/F11 explicitly disclose incomplete Xbox/Game Bar containment.
- Settings reachable via CLI plus a Windows just recipe; native Win32 controls.
- Native gates, independent review, synthetic live UI Apply/Revert/screenshot
  proof with a running scoped owner, verified clean end state, hosted CI green.

## Approach and units

1. Validated store and owner integration, core settings, binding model/presets,
   default correction; targeted tests and native gates.
2. Native settings window, CLI/recipe, live UI proof and review; native gates.
3. Accepted evidence, provisional decisions, final record archival.

## Product choices

- Provisional, to discuss: a JSON file under
  `%LOCALAPPDATA%\plasma-auto-tiler` and polling on the existing owner pump.
- Provisional, to discuss: use the existing `windows-sys` Win32 API route;
  expose `tiler-windows settings` plus a just recipe because no Windows tray
  exists. A tray can be a later separately bounded feature.
- Provisional, to discuss: compatible disables OS-conflicting chords rather
  than inventing replacement defaults. Manual rebinding remains available.
- Provisional, to discuss: defer an automatic first-run prompt; expose both
  presets prominently in Settings and retain authentic on first start.
- Provisional, to discuss: Windows uses system accent by default, with KDE's
  configured blue fallback and the existing explicit colour/theme switches.

## Verification and outcome

- Initial tree clean on `main`; research identified existing official Win32
  control, accent, hook and recovery paths.
- Unit 1 accepted: versioned bounded atomic file store, startup/live normal-owner
  integration, retained gap updates, visual settings, owned session-only mouse
  Snap reversal, authoritative explicit CLI overrides and accent default.
- Independent review found ineffective disable/rebind/preset routing, held-key
  pairing, stale queue ordering, file bounds and gap-route issues. Corrections
  add per-physical-chord suppression and pinned release routing, deterministic
  compatible reset and route-specific retained gap adoption. Targeted regression
  coverage and all four native package gates pass after the corrections.
- Shortcut catalog has 48 action rows, with separate letter/arrow focus/move
  bindings. Compatible disables 35 OS-conflicting rows; resize shortcut rows
  are explicitly unavailable (pointer resizing exists, keyboard resize does not).
  Manual rebinds support Win plus the action's existing Shift polarity; Alt/Ctrl
  and physical Win+L rebind targets refuse. Broader modifier rebinding is deferred.
- Owner settings lifecycle logs acknowledge validated configuration adoption;
  native geometry/SPI logs and readbacks remain the effect oracle, not that ack.
- Unit 2 UI/live proof remains pending.
