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
- Unit 1 committed as `df4edc5`; hosted CI green:
  <https://github.com/beefsack/plasma-auto-tiler/actions/runs/37164626150>.
- Unit 2 accepted: native Win32 settings window, CLI and Explorer-broker just
  recipe, per-user/session singleton, full-content stale-edit refusal,
  Apply/Revert/Close, scrolling conflict detail and preset/binding editors.
  Only feature flags on the existing `windows-sys` dependency were added.
- Unit 2 committed as `1c97c52`; all hosted CI jobs green:
  <https://github.com/beefsack/plasma-auto-tiler/actions/runs/37168520942>.
- Final pairing review reproduced two extra rebound-key faults: concurrent
  distinct physical keys sharing a canonical slot could steal each other's
  releases, and an untracked rebound-away key-up could close the held remap.
  A large per-family draft was rejected in favour of a bounded central guard:
  unpinned ups pass; colliding owned downs retain their own consumed refusal
  until release, without touching the original slot or dispatching an action.
  Four regression sequences cover both release orders, multiple colliders,
  modifier flips and remap removal. Current native gates pass after this fix;
   UI/native-effect evidence below remains the scoped pre-fix live run.
- Pairing correction committed as `999f2f3`; all hosted CI jobs green:
  <https://github.com/beefsack/plasma-auto-tiler/actions/runs/37169854020>.
- Initial UI screenshot acceptance failed: opaque topmost groupboxes covered
  their controls. Parent clipping alone did not fix it; native sibling-order
  inspection identified the cause, and lowering the groupboxes before show
  corrected both screen and PrintWindow output. Final screenshots were inspected
  by the Lead. CRLF details and saved-state labels were corrected too.
- Live proof on 2026-10-04, physical Windows 11 build 26200, medium/session 1,
  one output/DPI 120: two identified owned helpers, normal owner scoped to
  `tiler-test-window.exe`, native Settings window, and our own settings file.
  Proven exact-owner stop/restore and original file preimage were retained.
  No ordinary app was opened; gaming/lock chords were not injected.
- Evidence is local/ignored: `target/windows-settings/evidence.jsonl` and
  `shot-01-initial.png`, `shot-02-applied.png`, `shot-03-final.png`.
  Final run owner creation `01dd539f2f665289`; payload SHA-256
  `48D2A36CF93BA1ABDBC919023157ECD68D692D8A26C731306825CB3A7DB31BE6`.
  Final UI screenshot SHA-256
  `0EFE70CE226DEE908BCE370623303B1EAF2E99CF3577C7B81B4277D29BF7AE2B`.
- Apply demonstrated gap re-spacing (8/8 to 12/20), live red border/width 5
  with exact native outer geometry and one red-dominant composed pixel, border
  off/on, underlay hold/release visibility, mouse prevention off/on SPI 1/0,
  keyboard off/on configuration, compatible/authentic and rebind/disable live
  adoption through revision 12. Revert/validation/Close left saved bytes intact.
  Two opens retained one UI; a newly appeared revision-1 file refused stale
  Apply without overwrite. Save/adoption logs are not native-effect confirmation.
- Verification gotchas: use UI Automation or WM_GETTEXT for cross-process edit
  reads; native EDIT details require CRLF. Reuse the established x64 SendInput
  structure: the first hand-built prime failed, then the proven structure sent
  2/2 events. Owner/helper duration cap is 600 seconds; 900-second launches
  refused before effects. An earlier run expired before rebind adoption, so its
  revision-8 live claim was rejected and superseded by the final run.
- Latest native locked build/test, strict all-target clippy for the four Windows
  packages, full rustfmt and diff checks pass. Local mise was unavailable; direct
  installed MSVC Rust was used. Hosted Linux Rust/KWin/shell, Windows native
  gates and macOS tool smoke checks are green for every implementation unit.
- Final exact-tag helper close, exact-owner stop then restore: no processes,
  overlays, ledger or hidden helper; original settings-file absence restored;
  SPI arranging 1, pen visualization 35, normal taskbar present. Lead read-only
  cleanup recheck agrees. No Worker remains running.

## User-owned checks and deferred scope

- Physical input/Start/Snap containment, Win+L opt-in, real Xbox/Game Bar access,
  other output/DPI arrangements and Settings keyboard-navigation feel.
- Snap Layouts coverage remains unverified; G/F11 incomplete containment is
  displayed, and compatible disables their bindings rather than solving it.
- Optional later slice: first-run prompt, tray access, broader modifier rebinding.
  Workspace mode/default-tiled controls and keyboard resize await their runtime
  implementations. This slice exposes existing supported capabilities only.
