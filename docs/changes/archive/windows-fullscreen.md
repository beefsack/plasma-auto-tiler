# Windows Fullscreen Parity

## Outcome And Scope

- Windows parity item 4 implementation shipped with scoped acceptance,
  2026-10-03. Full live acceptance remains unaccepted where listed below.
  The gated, independently reviewed product has no known blocking defect;
  incomplete desktop proof is explicitly retained rather than counted as pass.
- KDE's current catalog/wrappers are the reference: Win+F11, retained slots,
  stable siblings, focus eligibility, movement/pointer/maximize/send refusals,
  workspace visibility and first-seen fullscreen hold. KDE is unchanged.
- Scope excludes parity item 5, settings UI, exclusive-mode probing, dependency
  installs and registry/policy writes. Detection remains captionless physical
  monitor coverage, without application-content inspection.
- Native implementation: `crates/tiler-windows/src/{snapkey,tiling,tiling_sys,
  workspace_owner}.rs`, focused `tests/{snapkey,tiling}.rs`, shortcut catalog
  row and `scripts/windows-fullscreen.ps1`. Durable choices promoted to
  `docs/decisions.md#windows-fullscreen`; backlog remains Orchestrator-owned.

## Material Choices And Review

- Provisional, to discuss: official Win32 style/frame calls implement project
  borderless fullscreen because Windows has no generic fullscreen setter.
  Inert window-lifetime scalar properties capture only cleared frame bits and
  prior maximize state. Owned metadata wins over geometry on exit; unrelated
  app style changes survive. Stop/crash leave frames and metadata in place.
  App-owned fullscreen without a preimage refuses; never send app F11 blindly.
- Provisional, to discuss: one attempt per discrete Win+F11 down, consuming
  held repeats without dispatch. No automatic retry/attempted-state map.
- Managed fullscreen remains observable and focusable, never writable for
  geometry; unmanaged fullscreen still suspends. Born-held members are
  slotless floating Engine exceptions but occupy hideable workspaces until
  exit or close. Restart follows the same first-seen hold rule.
- Previous review corrections preserved fresh pre-effect identity/scope fences,
  overlay-bypass safety gates and preimages after partial style effects. A new
  independent review found no blocking product defect or maximize/workspace
  regression. Low residual: `member_rects` also seeds born-held hidden snapshots;
  that seed is not an Engine tile slot and is removed on release/close.
- Harness review corrected overlapping owners, shortcut-only workspace mode,
  send-success crash setup, select-current-workspace hiding, DPI-mixed rect
  comparisons, normal-close-as-born labeling and style-only app entry proof.
  Activation now makes one bound attempt with diagnostics, without machine-
  specific waits or retry loops. Report status is `partial` if any required
  observation is unavailable/unaccepted/skipped; CLI marks precede dispatch.

## Native And Live Evidence

- Lead reran locked build/test/strict all-target Clippy for `tiler-core`,
  `tiler-protocol`, `tiler-kwin-effect-ffi`, `tiler-windows`: pass. Rustfmt,
  whitespace, fullscreen parse/mock and shortcuts mock: pass. Hosted Windows,
  Rust, KWin and shell checks are required on the pushed commit; their status
  is tracked with the commit's CI checks.
- Physical host: Windows 11 build 26200, medium integrity, one 2560x1440
  monitor, DPI 120, work area 0,0,2560,1380. Synthetic results are not physical
  input/display acceptance. Local receipts are under `target/windows-fullscreen/`.
- Production/shortcut working diff stayed byte-identical to the inherited
  `fbefea1` baseline throughout live work: SHA256
  `66C283BFCCA35B38C2CBE736D2B6350ABFE0A6865F136B6DE6FF172899B0FD5B`.
  Owner artifact SHA256
  `FC96AC747141ABD2E6B8C7D88018035477BF1EC5FB39568F299C1E603C08517B`;
  helper `EBCA63109CC5B1785363CF84562E166E65EAED374832624367A06E9772F4B993`.
  Each report pins its harness hash and operations.

| Receipt directory | Accepted observations | Limitation |
| --- | --- | --- |
| `20261003-054249-30968`, `20261003-054522-18352` | Unmanaged suspension/resume; project exact cover/style/preimage; immediate foreground held; stable siblings; both visuals hidden | Later refocus refused; full OwnedFs matrix did not finish |
| `20261003-060236-11048` | Born held once and slotless; workspace hide/return with intact frame; app-owned toggle refusal | Explorer foreground prevents post-restore resume |
| `20261003-060412-15916` | Notepad/Calculator/Paint normal tiling baseline and readback | Fullscreen app entry/exit journeys unavailable |
| `20261003-062006-33476` | Born native release and convergence; project enter/exit restores exact retained allocation | Normal close convergence timed out; log shows fullscreen-foreground suspension after exit |
| `20261003-062657-13604` | Independent born-fullscreen close, token removal/release once, no refire, two siblings converge, graceful cleanup | All executed stage oracles pass |
| `20261003-062944-24600` | Graceful stop/restore preserves project cover, valid preimage and sibling frames; zero overlays | Crash park unavailable; historical top-level `pass` is only partial evidence, fixed in final harness |

## Foreground Diagnosis And Unaccepted Checks

- Direct native reads identify the persistent foreground as an Explorer-owned
  `ApplicationFrameWindow`, with no child windows/process, no owner/parent,
  topmost/no-activate style and DWM cloak 2. It is not an identified hosted UWP
  app. Direct reads find it even when `EnumWindows` omits it. The precise shell
  surface/purpose remains unknown; Explorer was not terminated.
- Independent control reproduced helper activation refusal with zero project
  processes while ordinary Notepad held foreground. That establishes an
  environment activation problem, not causality for every later takeover.
  Entry's immediate foreground readback passes; seconds-later shell takeover
  remains unexplained. Official NOACTIVATE/NOZORDER flags and that immediate
  readback do not prove the product cannot trigger a later shell response.
- Earlier approaches were E8/attach activation, then raise-first activation;
  neither resolved the shell foreground. A 30-second release wait also failed
  and was removed. Independent stages obtained more evidence without a product
  workaround. Recovery attempt `20261003-062718-36268` timed out before born
  hold under the same suspension; attributed park in the next run was refused.
- Unaccepted/user-owned: sustained foreground retention and full owned
  repeat/focus-out-in/movement/maximize/send/held-underlay matrix; captionless
  pointer refusal (no native title-bar fixture); retained-fullscreen workspace
  journeys; hidden crash/watcher reveal/restart-owned exit; approved-app actual
  fullscreen cover/exit allocation; physical input/display/feel and other
  DPI/output arrangements. App exit harness explicitly lacks a plan-token
  allocation oracle and does not infer it from style/non-cover geometry.
- Every live run ended through exact stop/restore and helper cleanup: no
  project actors, overlays, ledger or hidden residue; arranging 1, pen 35.
  Hosting Terminal survived. No Worker remains running.
- Lead's final read-only audit at 2026-10-03 06:36:58 +10:00 independently
  verifies zero project processes/native surfaces, no ledger/stop/workspace
  request, ready false, arranging 1, pen 35 and Windows Terminal present.
- Next acceptance action: observe/dismiss the unidentified shell foreground
  during user dogfood, then rerun the bounded fullscreen stages. Do not proceed
  to parity item 5 as part of this change.
