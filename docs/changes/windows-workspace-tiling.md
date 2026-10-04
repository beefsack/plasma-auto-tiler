# Windows workspace tiling mode

## Goal and scope

- Match KDE's session-local per-workspace tiled/floating state, current-workspace
  tray checkbox, and persisted `defaultTiled` (initially true).
- Floating preserves native geometry and independent active border, suppresses
  tiling/group underlay/drop preview. Retile explicitly releases the shared
  Engine domain and freshly adopts observed geometry.
- New windows on floating workspaces remain native; cross-boundary sends change
  membership and reflow only the tiled side. Existing individual float/sticky
  and native maximize/fullscreen exceptions retain their semantics.
- No keyboard binding: KDE registers its tray action with an empty sequence.
- No backlog/principles edits, new toolkit/dependencies, registry/policy writes,
  persistent workspace overrides, or unrelated workspace-mode expansion.

## Acceptance and units

1. Implement portable workspace state, shared Engine release integration,
   native runtime/effect/send guards, tray truth, settings store/UI and bounded
   structured logs. Targeted behavior tests and four-package native gates.
2. Independent review of live/state boundaries; correct concrete findings and
   verify current gates. Commit/push accepted implementation; hosted CI green.
3. Scoped live Notepad/Calculator/Paint proof: tray toggle floating, native move,
   new-window admission, retile, sends across both boundaries, effects, default
   and settings UI. Capture screenshots and actual native effect readbacks.
4. Promote decisions, matrix evidence, archive this record, commit/push and
   verify hosted CI plus final clean tree/live state.

## Approach and authorization

- Initial source `7f9b733`, clean main tracking origin/main. KDE reference:
  `tray-workspace-toggle.md`, `tray-toggle-simplicity.md`, decisions Tray,
  `kwin/src/plan-adapter-entry.ts` keyless registration, shared release-domain.
- Existing workspaces take saved default at owner startup; live default edits
  affect only newly created workspaces. Overrides reset on owner restart.
- User standing autonomous authorization permits scoped input, movement,
  hiding/restyling, overlays and disposable Notepad/Calculator/Paint actors.
  Never close/kill/type into hosting Terminal; prefer explicit scope filters.
- Before live work bind artifact/owner/actors to exact identities and capture
  baseline/settings preimage. Use existing proven stop/restore paths. No broad
  cleanup; close only newly opened disposable apps. End with no project actor,
  overlay, ledger or hidden test window; original settings-file state restored,
  normal taskbar, SPI arranging 1 and pen visualization 35.
- Physical input/feel and other output/DPI setups remain user-owned.

## Evidence and decisions

- Research confirms KDE floating/tiled live acceptance and no assigned shortcut.
  Existing shared Engine release is the required reuse boundary; Windows
  managed-workspace mapping owns platform session mode just as KWin does.
- Initial implementation passes native tests/fmt/clippy. Independent review
  found missing tiled-source boundary-send reflow, release losing individual
  floats, stale/duplicate pending releases, unbound tray scope, and directional
  focus divergence. Correct these before acceptance/live proof. A reported
  Settings stale overwrite is rejected: existing full-content Apply refusal
  already reloads without writing (`settings_ui.rs:517`).
- Lead verified corrected native locked build/test/clippy/fmt. Live scoped
  Notepad/Calculator/Paint evidence confirms floating leaves frames untouched,
  native moves persist, new windows remain native, retile freshly fits, border
  remains, settings default applies live only to future workspaces and startup.
- First live Worker incorrectly read a menu screenshot as Tiled checked; Lead
  inspected `shot-menu-boot-floating.png` and rejected that bug claim: Floating
  is correctly checked. No product failed approach or correction follows it.
- Remaining send proof needs a minimal automation `workspace --send` command:
  normal owner intentionally rejects injected keyboard input. Reuse existing
  exact-owner request transport and native send dispatch with all fences.
- Cross-boundary sends and active gesture effects accepted below. Hosted CI
  pending before archival.

## Accepted verification and outcome

- Four Windows-built packages (`tiler-core`, `tiler-protocol`,
  `tiler-kwin-effect-ffi`, `tiler-windows`) pass locked build/test and strict
  all-target clippy; full rustfmt and diff checks pass after the final CLI
  change. Installed MSVC Cargo used; no dependencies installed. Shared core
  and KDE source remain unchanged; existing `ReleaseDomain` is reused.
- Independent findings corrected: one latest pending release per domain,
  successful-toggle stale release cancellation, exact-lifetime float carry
  across release, native tiled-source survivor reconcile, scoped tray request,
  and KDE-parity floating directional refusal. Existing stale Settings Apply
  refusal was retained. Actual Engine regressions exercise release/fresh float
  admission and native-boundary source removal/reflow; CLI tests cover exclusive
  select/send, malformed actions and exact transport fields.
- Live 2026-10-04, physical Windows 11 Pro build 26200, medium/session 1,
  DISPLAY1 2560x1440, DPI120. Explorer-broker owners scoped to Notepad/Paint
  and ApplicationFrameHost with Calculator child gate, caps <=600 seconds.
  Existing user app windows were controlled but not closed; only newly opened
  Notepad extras were closed. Hosting Terminal was excluded by test scope.
- Initial artifact SHA-256
  `19761840E8FA082D62B9CCAA91389D95D210DF8F510D706B8CA41D4F59D75689`:
  floating toggle preserved all eight frames; a native move survived ticks;
  new Notepad frame remained native; retile released nine-member domain then
  fresh fit with every applied native readback matched. Border remained visible.
  UI Apply saved Floating and owner adopted future-only; fresh startup with
  saved false left all frames untouched. Initial evidence:
  `target/windows-workspace-tiling/20261004-155929-4012/evidence.jsonl`.
- Final source `7f9b733` plus reviewed implementation/CLI diff, artifact
  `target/windows-workspace-tiling/20261004-163221-live/tiler-windows.exe`, SHA-256
  `D649DA769C5B2EC9010900896336BE4D20DA1BE6990287C27E39C1071B1E9A60`.
  Owners bound to creation `01dd53c1fc55a5db` and `01dd53c3d4918d67`.
- Final live boundary roundtrip: Paint sent tiled->floating (`act-111`), frame
  `(1680,694,2560,1319)` unchanged, six source survivors reflowed before hide
  with all six readbacks matched; exact mover foreground confirmed after follow.
  Select-source confirmed filled layout; floating->tiled (`act-157`) admitted
  Paint into a seven-member plan with seven matched writes, no duplicate/missing
  member. No floating-side plan/write. Source action-summary fields are absent
  for the native route; correlated `send-source` tick/readback logs are the
  source effect evidence.
- Actual native title-bar drag shows underlay and preview when tiled; preview
  inspect/log rectangle `[870,694,401,678]` agrees with screenshot. Floating
  drag leaves both absent with `group-underlay reason=floating`, zero shown
  events, and moved native frame persists without snapback.
- Tray default picks both ways save only the default and acknowledge live
  adoption; existing workspace stays tiled, subsequently allocated workspace
  starts floating. Settings shows saved Floating and Close preserves file bytes.
- Lead inspected final menu/UI, floating Paint and tiled/floating drag screenshots.
  Final ignored evidence: `target/windows-workspace-tiling/20261004-163221-live/`.
  Key screenshot SHA-256 values:
  - `shot-menu-ws1-stilltiled.png`:
    `0C02B7B3BD40B4EF66C22AC3F49739666CA5D0B1CDCE7F0B42268D3C407AB96A`.
  - `shot-menu-newws2.png`:
    `5925DA7ED02849809549B0045CF86A858E74EFCB0409E04668F4BF9ACA873FEA`.
  - `shot-settings-floating.png`:
    `9C2DA3BC8904643F8F1E005FB579C0F5EE5EF55805EB9FF027EFAD0FE9E75694`.
  - `shot-ws2-floating-member.png`:
    `FFA77B4815652776C47D6AB82F04612AAE7C28ABC7AFF929F32ADA8D981283EE`.
  - `shot-tiled-drag2-hold.png`:
    `7F3CB84D69165A817800B523DCD1AB63EDD4C9C5F7B7EE250B2AD5659FB708E5`.
- Fixture lessons: use exact overflow-icon UIA Invoke and visible menu-row
  coordinates; normal owner filters synthetic keyboard chords/modifier holds,
  so CLI send/native title-bar drag supply valid automated effects. Empty
  intermediate workspace cleanup shifts ordinal indices; re-resolve the live
  scope before the next probe. An invalid suppression probe on a newly tiled
  workspace was rejected and superseded by a correctly toggled floating drag.
  Owner duration expiry was recovered with restore before further testing.
- Final stop/restore, extra-window close and Lead independent read-only recheck:
  no owner/helpers/UI/overlays or recovery ledger/request; original settings-file
  absence restored; numeric SPI GET success with arranging 1 and pen 35; normal
  taskbar and all baseline apps present/visible. Original hosting Terminal PID
  18224 creation `01dd512e9194d8b9` survives. No Worker remains running.
- Provisional decisions: existing JSON field location and minimal exact-owner
  send automation, recorded in `docs/decisions.md`. Runtime behavior follows KDE.

## Residual user-owned checks

- Physical tray/keyboard/mouse feel, rapid workspace/send/toggle use, per-window
  float/sticky/native maximize/fullscreen roundtrip feel, other DPI/outputs.
- Application minimums may still cause overlap/overflow on dense tiled layouts
  under the pre-existing minimum-size policy; workspace-mode toggles do not
  change that policy. No gaming/lock chord was injected in these proofs.
