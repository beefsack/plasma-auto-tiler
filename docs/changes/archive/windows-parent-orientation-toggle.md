# Windows immediate-parent orientation toggle

## Goal, scope and acceptance

- Deliver Windows handoff item 4, REQ-LAY-01 / R-LAY-01/05/06 using shared
  `CoreCommand::ToggleOrientation`, matching `TiledKind::ToggleOrientation`.
- Default exact Win+O, binding id `toggle-orientation`; Authentic takes over
  OS orientation-lock chord, Compatible disables it. Schema remains 1 with
  absent override Keep; dynamic Settings Keep/Disable/Rebind/presets/counts.
- Immediate parent (root included), order/shares/focus retained, twice exact
  tree roundtrip; lone/float/no tiled focus/floating workspace no write,
  focused overlays refuse and sibling overlays receive no native writes.
- Fresh origin/lifetime/suspension/view/minimum/hidden fences; reuse native
  geometry path without workspace switch or future-admission hint.
- Windows adapter only, shared core/KDE out of scope. Existing proof input
  security posture must remain intact. Physical OS suppression is user-owned.

## Approach and bounded units

- Worker adapter/catalog/input/preset/UI implementation accepted after independent
  review and native production-route regression follow-up; no blocking finding.
- Scoped native Settings/recovery evidence accepted; Lead native gates passed;
  publication and CI tracked below/in delivery handover.
- For live verification read live-windows-testing.md; standing authority only
  owner, new Notepad/Calculator/Paint and synthetic input/cursor. Never touch
  pre-existing windows/terminal, Win+G/F11/L, registry/policy, elevated/protected
  apps, games or forced-crash probes. Prove independent stop/restore, bind
  artifacts/source/owner/app identities and display baseline before effects.
- End owner stopped/hooks released, hidden apps revealed, owned settings
  restored and all disposable apps closed. Record limits of agent evidence.
- New repeat ambiguity gets minimal discriminator row with unsupported results
  TBD; any sensible temporary choice marked tentative pending user review.

## Material decisions and outcome

- Item 3 pushed as `755aab8`; its product input deliberately rejects injected
  events, so live movement remains physical/user-owned. Preserve that fence.
- Windows-only implementation: `ToggleKind::Orientation`, exact Win+O action/
  queue/hold/mask, dedicated `dispatch_orientation_intent`, matching Tiled kind
  via production `orientation_plan`, shared Engine then existing `apply_geometry`.
  Catalog/UI now 84 rows, Compatible 38 disabled bindings including orientation;
  Authentic keeps default, schema-v1 absent override Keep. No shared edits.
- Tentative, pending user review: one orientation toggle per discrete down;
  held repeats consumed without dispatch to avoid axis pingpong, matching other
  Windows toggles. Release/repress toggles again. Minimal held-key discriminator
  in reference-outcomes.md; physical and unsupported reference outcomes TBD.
- Retained Engine tests cover root H/V, nested parent-only, unequal-share exact
  double roundtrip, focus/minimums, lone no-op then long-edge admission,
  float/unknown/overlay refusals and real plan/write scoping. Native regressions
  exercise actual stale dispatch, production origin/lifetime resolver, suspended
  keyboard queue, matching-kind seam and overlay/retained-only writable guards.
- Initial direct lifetime-dispatch test failed: publication rebuilds origins from
  observation, so fabricated handles vanish first. One causal test repair pins
  lifetime/foreground outcomes at the production resolver; stale dispatch remains
  tested directly. No production behavior workaround, no live setters invoked.
- Existing Windows flag-clean observation contract retained (item 13 admission
  pending); focused overlays refuse in adapter before Engine mutation, sibling
  overlay geometry uses retained slots and fresh native write-time skip fences.
- Lead ran all four native allowlisted build/test/fmt/strict clippy gates plus
  diff check 2026-10-11 on `755aab8` + accepted diff: passed (216 Windows lib
  tests, 71 snapkey, 28 settings). Rust 1.99.0 MSVC, auto-install disabled.

## Agent-observed native evidence

- 2026-10-11 physical Windows 11 Pro build 26300, DISPLAY1 primary full
  `[0,0,2560,1440]`, work `[0,0,2560,1380]`, DPI 120, medium 8192, session 1;
  owner Explorer-parented, scoped to new Notepad HWNDs only.
- Evidence: `C:/Users/beefs/AppData/Local/Temp/opencode/ws-verify14/20261011-022558-27344/evidence.json`.
  Source base `755aab8` + delivery diff SHA-256
  `95002BBE573BA97BC887B35BF7C0D1BFC1F52C5B272A122FFD387091D58CA937`;
  copied artifact `bin/tiler-windows.exe` SHA-256
  `BC5C6D91C756ED893374EF8E4CF664CC4C5F6F5EFB5C1CA061F01B87C2AB8BFF`.
  Later source edit corrects only the speculative KDE-repeat comment, no behavior.
- Independent stop/restore proven first on owned Notepad; native Settings 84
  rows, exact Win+O orientation-lock conflict, Disable and safe Win+F8 Rebind
  Apply, staged saved-file Revert (byte-identical), Compatible 38 disables and
  Authentic 0 overrides/Keep all verified by native/file readbacks.
- Tiled owner PID 31392 creation `01dd58cbb0372678`, exact copied executable,
  three owned Notepad HWNDs; live Disable/Rebind/Keep adoption reports keyboard
  lane, geometry unchanged, zero run-errors. Takeover-off owner PID 20248
  creation `01dd58cbbaed988d` starts/stops/restores cleanly, no input-delivery claim.
  Exact identities, app baseline/readbacks and settings preimage in evidence.
- End clean: owners/watchers/Settings exited, hooks released by process exit,
  stop/independent restore and ledger clean, all disposable apps closed,
  settings absent preimage restored, SPI baseline and terminal inventory intact.
  No hide journey in this unit; no hidden apps left. No failed live run.
- Pending user-owned physical positive path: Win+O root/nested/double-toggle,
  lone/newcomer order/focus, float/floating-workspace/focused/sibling overlays,
  live flag drift/minimums, held repeat and OS orientation-lock suppression/
  pass-through under Authentic/Compatible/Disable/rebind/takeover-off.
  Product injected-input fence preserved; no helper-proof/CLI bypass introduced.
- Stale-dispatch offline regression reads host state before the origin fence;
  foreground suspension/elevation can yield a different refusal on such a host.
  Resolver and blocked-queue tests are separately direct; positive Win32 geometry
  actuation is not claimed by those tests or by the Settings live evidence.
