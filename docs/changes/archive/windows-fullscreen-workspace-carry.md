# Windows fullscreen workspace carry

## Goal and scope

- Deliver Windows handoff item 9 R-MAX-09, same-output workspace send only,
  using item 2 follow/stay. Windows adapter only unless a necessary tested core
  repair is separately identified. Preserve R-MAX-05 app-owned toggle refusal.
- Carry fullscreen without restoring first; retain target Engine allocation.
  No extra mover size/position/focus writes while fullscreen beyond native
  membership/hide/reveal. Preserve identity, scope, flag and recovery fences.

## Acceptance and units

- Bounded Worker implementation and retained-Engine regression coverage;
  independent review of live/public behavior; bounded ordinary-app CLI live
  verification; Lead integration, native gates, records, commit/push and CI.
- Follow/stay source reflow, target allocation, hidden target, flag drift,
  lifetime/recovery, maximized regression and fullscreen exit verified.
- Native four-package build/test, fmt, strict clippy and diff check pass.
- Dated revision-bound matrix/spec evidence distinguishes agent-observed
  effects from user-owned physical input and deferred multi-output/game checks.

## Authorized live scope

- Windows 11 host: exact owner plus newly opened Notepad/Calculator/Paint only;
  synthetic input/cursor authorized. Preserve terminal and pre-existing windows.
  No forced-owner/crash probes, helper windows, registry/policy or game/elevation
  probes. Avoid Win+G/Win+F11; reuse exact-owner CLI/test-needed routes.
- Read live-windows-testing.md, bind source/artifact/hash/owner identities and
  display/app baseline, prove independent graceful stop/restore before effects.
- End owner stopped, hooks released, hidden owned apps revealed, owned settings
  restored and test apps closed, with exact readbacks.

## Decisions and evidence

- Independent review found follow/select still explicitly actuated fullscreen
  focus and initial tests did not bind overlay variants to the claimed Engine
  evidence. Repair accepted: fullscreen-only send-follow suppression bypasses
  setter/prime/MRU fallback; tests bind overlay gates and actual Engine replies.
  Independent follow-up review accepted without serious findings.
- Tentative, pending user review: fullscreen follow reveals/selects the target
  but suppresses explicit focus actuation for that transition; native reveal
  may focus the mover. Gaming safety overrides checklist setter-based focus.
- Tentative, pending user review: managed app-owned fullscreen with a retained
  tile carries under the same stable-flag/identity/view fences. R-MAX-05 is a
  separate toggle refusal; slotless born-fullscreen remains ineligible.
- Existing unreadable-frame retained fallback is not evidence of live flag
  stability. Unknown pre-effect fullscreen now defers; established post-commit
  hidden fallback remains bounded. Hidden does not invariably mean unreadable.
- Tentative, pending user review: test-needed `workspace --fullscreen` toggle
  uses existing exact-owner request transport and origin/member/lifetime/scope
  gates, including the existing app-owned refusal and project-owned exit.
  Normal owner only; no injected-input bypass or helper-only proof expansion.

## Accepted evidence and outcome

- Windows adapter only; shared core/protocol/KDE unchanged. Native locked
  four-package build/test, fmt, strict all-target clippy and diff check passed
  2026-10-11 with Rust 1.99.0 MSVC, mise auto-install disabled.
- Base `6b76589` plus delivery diff. Final live artifact SHA-256
  `E1CDBC310EEC8CEA660474634D5184B3DA7802C04D9F523BAE8F0F6FFA636C25`;
  source diff SHA-256
  `C508681ABC4D8068AA4BECECF5BC59A33B70F087C612361A22D6AE0106869CBC`.
- Windows 11 Pro build 26300, DISPLAY1 primary full [0,0,2560,1440],
  work [0,0,2560,1380], DPI120. Medium session-1 Explorer-parented owner
  PID20988 creation `01dd58d6210ab2c4`; phase-zero stop/restore PID21848.
  Exact owned Notepad identities, executable path, baselines, machine responses
  and restoration are in the report `evidence.json`.
  Report SHA-256 `D22FF4847E60F07D4C1FB8DCBC8674B3FD43D44DDF0A8AA4DCBDB1DBD88A6823`.
- Occupied-target numbered follow/stay and relative follow passed: B remains
  captionless at full-output bounds, A reflows, target C shares the Engine
  allocation. Stay foreground A, B hidden; selecting target verifies carry.
  CLI project exit restores B to the target slot, C remains stable. Follow
  reports `focus-suppressed`, `focus_ms:0`; no explicit follow focus write.
  Later standalone select is the existing focus path, a distinct action.
- Maximized numbered stay/follow regression and independent graceful
  stop/restore passed in `evidence.json` (initial fullscreen route
  discovery blocked, zero fullscreen attempts). Final live cleanup: owner
  stopped/hooks released, ledger/requests absent, hidden apps revealed,
  settings absence and SPI arranging/pen35 restored, all three owned apps
  closed, all 19 baseline HWNDs present and terminal preserved. No forced loss.
- Failed harness attempts preserved: initial already-active anchor oracle;
  outer-event focus field; hidden source after follow; C solo-frame oracle;
  exit aimed at current foreground C rather than B. Repairs changed fixture
  assertions/owned-B targeting only. No passing product outcome is inferred
  from those failed whole runs; final report passes the corrected contract.
- Offline gates cover overlay admission/flag stability/unknown flags, writable
  exclusion, actual Engine allocation equality across overlay kinds/intents,
  source MRU/genuine-null policy and existing identity/view/recovery fences.
  Production native `stay_focus_token` mapping is not directly unit-tested;
  agent-observed MRU journey supplements Engine/policy tests.
- Physical shortcut effects, relative-stay physical journey, deterministic
  native flag-race injection, managed app-owned native carry, slotless native
  refusal, games/elevation and cross-output remain user-owned/deferred.
- Pushed `9d12c7f`. CI
  [38069107649](https://github.com/beefsack/plasma-auto-tiler/actions/runs/38069107649)
  completed success: windows, rust, kwin, shell, native and macos. Linux/KDE
  checks are hosted evidence, not locally run on the Windows host.
