# Windows workspace send follow/stay and maximized carry

## Goal and scope

- Deliver handoff item 2 (Workspaces 2.1-2.3), then verify item 20 G-D2
  retained-maximized carry, same-output only. Reuse item 1 `553c65b` local
  ring/action infrastructure; shared core remains owned by the KDE agent.
- Numbered follow retains defaults; relative follow uses Win+Ctrl+Shift
  arrows/H/J/K/L. Numbered/relative stay are bindable and unbound by default.
  Windows new arrow ownership is unknown; no new Compatible disables.
- Non-local/multi-output and fullscreen carry remain separately pending.

## Acceptance and approach

- Freeze one ordinal target before transfer, including trailing empty, >9 and
  wrap; ordinary lifecycle supplies the next spare after filling it.
- Same Engine admission/geometry for both intents. Follow selects/reveals
  verified target before mover focus; stay keeps source visible/selected,
  hidden target unwritten/unrevealed, source MRU focus or null with no setter.
- Floating boundaries remain native membership-only, float frames untouched,
  tiled sides reconcile. Preserve sticky/intentional-float eligibility.
- Maximize remains on arrival, without restore/remaximize; geometry skips
  overlays, live flag drift refuses/defer before effects. Native unmaximize
  on target should return to retained allocation.
- Exact modifiers/actions, hold pairing and unbound Keep/Disable/Rebind UI;
  tests use actual retained Engine replies and visibility/lifetime fences.
- Units: adapter implementation/offline regressions; independent public/native
  contract review and repairs; ordinary-app live CLI transport verification;
  Lead native gates, docs and publication.

## Material decisions and repairs

- Test-needed exact-owner CLI transport extended under the handoff allowance:
  `workspace --stay N`, `--send-relative previous|next`,
  `--stay-relative previous|next`, `--previous`, `--relative previous|next`.
  Old `--send N` follows. Consume-once/owner/scope/origin fences preserved;
  production injected-input filtering and helper-only proof gates unchanged.
  History forms give deterministic producer tests without physical input.
  CLI grammar extension is tentative, pending user review.
- Null source focus logs `ok/no-focus`; Some-but-stale focus logs
  `focus-unverified`, no setter. This is honest outcome reporting, not fallback.
- Independent review required both-gap/mode/view/lifetime gates, fresh overlay
  flag checks and hidden/stale-MRU exclusion. One coherent repair added
  production-called policy gates and direct regressions. Review withdrew its
  initial native-scope finding: caller already fenced scope before transfer.
- Final review found native overlay checking after assignment; the narrow
  correction moved the live check before assignment, retaining the later
  check for flag drift across transfer. No restore/remaximize is introduced.
- Lead found numbered stay rejected the checklist's Win+Ctrl+Shift+F6 example.
  Corrected only numbered stay to accept both Win+Shift and Win+Ctrl+Shift
  rebind arms, with pinned Ctrl repeat/release and full-key duplicate tests.
  Direct numbered follow still rejects Ctrl. Native UI verified the exact
  Ctrl+Shift example after this input-only repair.

## Authorized live experiment

- User standing authority: owner, disposable Notepad/Calculator/Paint,
  synthetic input/cursor; never touch pre-existing terminal/other windows.
  No helper windows or forced-owner/crash probes in this unit. Avoid Win+G
  and Win+F11, registry/policy, elevation and games.
- Read live-windows-testing.md; independent stop/restore already exercised
  in item 1, but recheck clean baseline and exact restoration for this run.
  Capture artifact/source hashes, owner PID/start/path/session/integrity,
  full/work display rectangles/DPI and exact owned app identities.
- Exercise follow/stay/relative, history and maximize via the exact-owner CLI;
  synthetic requests are agent-observed native effects, not physical shortcut
  containment. Use fresh scoped ordinary-app fixtures, retain all preimages.
- End owner stopped, hooks released, hidden apps revealed, owned settings
  restored and all test apps closed; verify native readbacks.

## Evidence and outcome

- Delivered item 2 and verified item 20 same-output, Windows-adapter-only.
  Lead independently ran all four native allowlisted build/test/fmt/strict
  clippy gates and diff check after the final repair: passed 2026-10-11.
- Portable regressions use real retained Engine replies: explicit intent,
  identical admission/geometry, source MRU/null, hidden-target no writes,
  frozen ring/spare/wrap/>9, floating carry, lifetime/view/modes/both gaps,
  overlay drift, exact modifiers, live holds, unbound states and presets.
- Agent-observed native experiments on Windows 11 Pro build 26300, DISPLAY1
  primary full [0,0,2560,1440], work [0,0,2560,1380], DPI 120. Medium owner
  (8192), session 1, Explorer-parented, scoped to newly opened Notepad HWNDs
  only. Each evidence report contains exact PID/start/path/user/session and
  frozen app identities. Pre-existing terminal/windows excluded.
- Evidence: per-run `evidence.json` reports (local paths dropped). Source base `553c65b` plus this delivery diff.

| Evidence run | Agent-observed native outcome |
| --- | --- |
| `ws-verify2`, `ws-verify3` | History 1->2->3->2->3; same-view no-record; stay does not record, follow does. Numbered/relative sends and sole-source stay no setter. |
| `ws-verify7` | Maximized numbered/relative stay with source MRU A, target hidden; relative follow; unchanged maximized rect on arrival, native unmaximize returns target allocation. Genuine trailing/first selection wrap without creation. |
| `ws-verify8` | Both intents across both floating boundaries, floating frames stable, only tiled side reflows. Future-only default seeding and restoration observed. |
| `ws-verify9` | Ten simultaneously occupied workspaces plus trailing empty, genuine 11-ID ring; selection beyond 9 and both wraps. |
| `ws-verify10` | Native Settings 83 rows, Keep/Disable/Rebind Apply and saved-file Revert. |
| `ws-verify11` | Numbered stay Win+Ctrl+Shift+F6, relative stay Ctrl+Shift+F7, history Ctrl+F8 Apply; unbound Keep distinct from Disabled; staged Revert file unchanged. |
| `ws-verify12` | Passed checkpoints: ordinal-10 relative next fills pre-transfer spare; first relative previous stay fills pre-transfer trailing and retains MRU K; next spare appears. Final unrelated parking assertion failed on a stale oracle, not a product effect. See `read-only-analysis.json`. |

- Effect artifact SHA-256 (runs 2-10):
  `8A11556D918F9FF924271196BFEA3E356C1426EEFE69C7026240F79A47E1E99B`;
  source diff SHA-256
  `200B4DB03D94F6AFA77DCF27FF75C328695320F9CA97D648AE004A7AECF85598`.
- Final input/UI artifact SHA-256 (runs 11/12):
  `3DCE23CCB15FFA7EC384943685305E73138F8E6BFE5B4B033AE5D05BF7053B1C`;
  source diff SHA-256
  `8CF839CF23C550FDB02A83782383AA4684773CF7C67B8569125A94D1438EE3CE`.
- Representative maximize owner PID 3252, creation `01dd58b4408f002a`;
  final relative-send owner log `run-01dd58ba5611bbdd.log`. Exact copied
  executable and app identities are in each report, not product logs.
- Restoration: graceful exact-owner stop/independent restore, hidden app
  reveal with retained identities, owner/settings processes exited (hooks
  released), ledger/request residue absent, settings preimage absence restored,
  SPI arranging=true/pen=35 restored; exact-owned HWNDs closed, terminal intact.
  No forced-owner/helper probes in this item's live units.
- Failed harness runs preserved: wrong enum/id, radio/selection notification
  and cross-process EDIT reads were pre-effect tooling failures. Final run 12
  demanded A visible after sending A away to WS12 (`ws-verify12.ps1:357`);
  its accepted send checkpoints stand, whole-run status remains failed.
  Worker initially called this a timing race; Lead inspection corrected that
  unsupported diagnosis. No product race is inferred or passing run fabricated.
- Physical shortcut containment/preset OS effects remain user-owned. Native
  deterministic flag-drift injection remains pending (production-called gates
  tested offline). Non-local/multi-output/cross-output and fullscreen carry
  remain separately pending. No shared-core source change was required.
- Item 1 CI run 38047125001 completed success for `553c65b` (2026-10-10).
  Linux/KWin gates for this piece passed through CI below, not locally on
  the Windows host.
- Publication rebase integrated concurrent commits through `2a3b791`.
  Documentation conflicts were mechanically combined, retaining concurrent
  0.1 scope/triage rows and KDE heuristic note alongside Windows evidence.
  Concurrent shared-core change adds float-focus tests only; core/protocol
  production source is unchanged, so native effect artifact evidence remains
  applicable. All native allowlisted gates also passed on the integrated
  revision before publication.
- Integrated revision `4f488e6` passed all local native gates and was pushed.
  CI run 38056399139 found the native null-handle integration test referenced
  Windows-only `tiling_sys` without a cfg guard, breaking Linux compilation.
  One causal test-only repair adds `#[cfg(windows)]`; production and live
  evidence are unchanged. Windows/KWin/macOS jobs passed on that run;
  full CI verification followed the repair publication.
- Repair `0b0fdd5` pushed; native tiling tests (79), fmt, strict allowlisted
  clippy and diff check passed. CI run
  [38056677641](https://github.com/beefsack/omnitiler/actions/runs/38056677641)
  completed success 2026-10-11: windows, rust, kwin, shell, native and macos.
  Item 2/item 20 implementation and verification complete for the scoped
  single-output handoff; pending user-owned/deferred legs remain above.
- Environment install incident/accepted tentative decision is recorded in
  item 1; all further mise invocations require `MISE_AUTO_INSTALL=0`.
