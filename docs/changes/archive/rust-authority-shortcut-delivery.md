# Rust Authority Shortcut Delivery

## Goal

Restore packaged global keyboard shortcut delivery while `engineAuthorityMode`
is `rust-development`, without starting legacy topology or pointer authority.

## Scope

- Register the existing focus, structural move, and keyboard resize actions once
  through a mode-independent packaged dispatcher.
- Route each registered callback exclusively to legacy or Rust authority.
- Preserve existing sequences, aliases, KCM overrides, and pointer-subscription
  exclusivity. Do not resolve the separate `Meta+R` collision.

## Acceptance

- Rust mode registers every existing focus/move/keyboard-resize action once,
  routes callbacks to Rust, and has no legacy topology/pointer attachment.
- Rust command loss refuses closed while the accelerator remains captured.
- Reconfigure and Legacy/Rust switching are idempotent and swap only callback
  authority. Legacy remains the default behavior.
- Generated package output contains the registration route without staging it.

## Evidence

- Read-only 2026-09-09 KGlobalAccel records show all eight focus and eight
  directional-move actions registered once under `kwin`; focus-right has the
  existing KCM override value. Bounded KWin startup diagnostics show legacy
  startup handlers but no Rust authority-ready/unavailable diagnostic and no
  shortcut callback evidence. Persisted records do not prove callback liveness.

## Outcome

- Root cause: `rust-development` returned before the legacy controller lifecycle
  that had been the sole shortcut-registration path. The persisted KGlobalAccel
  rows therefore did not have a current packaged callback to capture input.
- The packaged controller now registers catalog-backed focus, directional move,
  and keyboard resize commands once before authority selection. The callback
  reads current mode, routes solely to Rust or Legacy, and Rust refusal remains
  captured and fails closed. Legacy signals and pointer watches detach on a
  Legacy-to-Rust switch and reattach once on return.
- Typecheck, focused controller/authority/shortcut and KGlobalAccel static
  suites, temporary ES2017 bundle callback dispatch, and package checks pass.
  Generated package outputs were intentionally not staged. No live callback or
  manual retest claim is made.

## Plan

1. Separate shortcut registration and mode-gated command dispatch from legacy
   controller lifecycle.
2. Add focused authority/shortcut/package regressions and verify the bundle.
3. Record outcome, archive this note, and stage only reviewed files.
