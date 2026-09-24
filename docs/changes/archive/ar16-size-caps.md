# AR16 Size Caps

## Goal and scope

Ship the approved 2026-09-24 replacement of the 64-window and 16-domain limits in core and KWin TS with one approximately 1 MiB codec request byte cap. Preserve separate native/FFI safety bounds and unrelated per-field limits. No live KWin mutation or host/toolchain changes.

## Acceptance

- Requests at the cap decode; requests above it receive bounded, correlated refusals in the planner and adapter where applicable.
- More than 64 windows and more than 16 domains succeed at core/protocol level. Old cap-asserting tests and current cap claims are updated.
- Workspace offline tests, format, lint, portable check, TS typecheck/tests/build pass; native build/tests only if native code changes. Independent diff review completed.

## Approach and bounded units

1. Inventory count and byte limits, request paths, existing tests and docs; classify separate native/FFI bounds.
2. Update Rust core/protocol and focused regression tests.
3. Update KWin adapter, logging, and TS tests.
4. Reconcile docs, run checks, review independently, archive this note.

## Outcome and evidence

- Removed 64-window and 16-domain guards from core Session/Engine, protocol
  validation/group replies, KWin Plan/workspace-send/group-highlight adapters,
  and 64-item focus-route, drag-index and resize-share gates. Retained-domain
  state no longer silently discards a committed new domain.
- Protocol decode rejects requests over 1,048,576 bytes. KWin request builders
  mirror the cap and log correlated, bounded `request-over-cap` refusals before
  dispatch. Oversize untrusted input at the service boundary logs a fixed
  uncorrelated early-exit without decoding it. The separate 64 KiB reply cap
  remains; overflow now returns a bounded correlated `reply-oversize` rejection.
- Separate bounds kept: 64 KiB Planner reply for response transport safety;
  native group-highlight 4096-byte JSON and drag-oracle 1024-byte JSON for the
  effect/FFI ABI; 128-byte opaque IDs, 64-byte generations, bounded geometry,
  gap and revision for typed identity/geometry validity; eight preconditions
  for fixed protocol semantics; 1024-item KWin native-list readers and 25/32
  desktop limits for host observation/native desktop limits; 64 drag
  correlations per restore marker for bounded transient event bookkeeping.
- Protocol/core tests prove 70 windows, 24 retained domains, 65-share resize,
  65-step focus and 65-index drag; TS tests prove >64-window and >16-domain
  dispatch. Both codec and TS exercise exactly 1 MiB and the next byte; a
  large valid request proves correlated reply overflow.
- Independent review caught lost correlation on oversized replies and weak
  production-path domain coverage; both were corrected. Subsequent sweep
  found and retired the three hidden 64-item core gates above. No native code
  changed; architecture-review section 7.13 remains read-only.
- `cargo test --workspace --offline`: 662 passed, zero failed (baseline 656).
  `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets`
  (existing warnings only), `just check-portable`, KWin `npm run typecheck`,
  `npm test` (814 passed, baseline 807), and `npm run build` passed.

Residual: the independent 64 KiB reply bound may refuse very large valid
requests with a correlated `reply-oversize`; retained multi-domain state can
grow across requests. Neither is a window/domain count gate. No live KWin
test or host mutation was performed.
