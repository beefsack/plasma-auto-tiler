# Windows Phase 1 implementation

- Goal: implement the approved owner/stop/restore route, owned-window recovery
  proof and physical-input spike, then progress to Engine-driven geometry.
- Current milestone: `tiler-windows` scaffold and offline ledger/identity tests;
  return for review/commit before the next meaningful milestone.
- Review revision: user requests minimal ledger/process identity, simple locked
  temp-file replacement, no validation machinery/stub CLI, focused tests and
  precise cleanup of old test fixtures. Milestone 2 has not started.
- Baseline: 036123b accepted/pushed; one M27Q on this dev PC, multi-monitor
  Windows testing deferred to the user's other Windows 11 PC. KDE host facts
  remain historical and must not be silently rewritten.
- Approved route (user 2026-09-30): one normal per-user/session executable with
  independent stop/restore, public hide/reveal, owned disposable test binary,
  RegisterHotKey vs low-level-hook comparison and proof order 1-5 from baseline.

## Standing live authorization (user 2026-09-30)

- Sandbox and physical desktop: tiler shortcut hooks/hotkeys including
  Win+Arrow, movement/resizing/hiding/restyling, overlays, intentional loss of
  verified tiler dev processes, Sandbox launch with read-only payload mapping.
- Guest-only registry/policy writes. No host registry/policy/autostart/boot,
  logoff/restart, security or display-setting changes; no writable host mappings.
- Owned disposable test windows first; prove restore after graceful exit and
  forced loss before hiding anything else. Never launch/manage other user apps.
  Exclude the Windows Terminal hosting opencode and its processes from every
  live run: never hide/minimize/close/restyle/kill them.
- Medium integrity only; no elevation, games, protected apps or secure desktop.
  Bound hook durations and retain out-of-hook recovery. Injected input is smoke
  evidence only; keep physical acceptance checks pending for the user.
- Per-run preflight/identity/recovery/evidence still follow the live guide.
  End each unit with all verified tiler/test processes stopped, windows restored
  or closed, and ledger clean or residue reported. Stop immediately on ambiguous
  restoration, effects on unowned resources or loss of agent control.

## Scope, units and verification

- Fresh sequential muse-spark Workers: implementation, precise fixture cleanup,
  review and native gates. No live launches in this offline milestone.
- Keep existing product crates/core dependencies and Linux jobs unchanged.
  Make the new crate Linux-workspace compatible; extend Windows package gates.
- Acceptance: minimal process/tag recovery model, locked/flushed temp-file
  replacement, different-owner/corrupt-ledger refusal and focused offline tests;
  Windows build/test/fmt/strict clippy plus whitespace. Linux gates deferred.
- No commits/push/index operations, system installs/configuration or backlog edits.
- Implemented after review: one process identity, HWND/lifetime-tag matching,
  version/duplicate/user-session checks; exclusive store, temp overwrite+sync,
  Windows MoveFileExW replacement or plain rename elsewhere. Minimal entry point;
  no stub commands, field validation, reparse/permission checks or journal logic.
- Cleanup: removed and verified absent 40 precise legacy TEMP fixtures matching
  `tiler-windows-<roundtrip|contended|invalid-preserve|corrupt|owner|orphan|pending-only|missing>-<11284|18400|29256|29388|4228>-<counter>`.
  New fixtures exclusively create their own directories and clean up on drop.
- Storage remains caller-selected; no crash/power-loss proof or live operations.
- Evidence: independent review passed; stable rustc/cargo 1.98.1 MSVC x64;
  four-package build/test (579 passed, including 10 ledger/restore tests), fmt-all,
  strict clippy and whitespace passed. Crate totals 508 physical lines. Existing
  crates, core dependencies, devenv, backlog and Linux jobs remain unchanged;
  index empty. Linux workspace gates remain deferred to CI.
- Cleanup independently rechecked: no legacy or current test fixtures remain.
- Next: return for milestone 1 review/commit. Do not start milestone 2 yet.

## Physical acceptance checks

- Pending: Win+Arrow all directions, down/up/repeat, Snap/Start suppression,
  disable/exit reversal; physical recovery readbacks; later second-PC multi-monitor
  geometry/DPI. No physical acceptance claimed by offline/synthetic tests.
