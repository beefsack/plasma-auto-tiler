# KWin Destroyed Window Reply

## Goal

Prevent the bundled KWin `DescribePlan` script from touching a destroyed Window
object after an asynchronous Planner D-Bus reply.

## Scope And Non-Goals

- Replace Window-keyed identity with normalized `internalId` string identity.
- Keep only value snapshots across the D-Bus boundary and re-observe live
  windows before applying a reply.
- Evict removed native identities explicitly.
- No live KWin work, native-effect, KCM, shortcut, workspace, or gap changes.

## Acceptance

- The reply path never reads a property from a Window observed before dispatch.
- A destroyed-window reply test proves re-observation rejects safely without
  dereferencing the destroyed fixture.
- Native `internalId` uses the established braced-UUID normalization.
- KWin TypeScript, Rust format/clippy, Nix flake, and CTest gates pass.

## Approach And Dependencies

- Share the existing native-ID normalizer across KWin entries.
- Convert PlanAdapter retained and deferred state to immutable primitives, then
  resolve targets only from a fresh synchronous observation while handling the
  reply.

## Verification

- Hermetic KWin TypeScript suite: 385 tests passed, 0 failed, 47 suites.
  `plan-adapter.test.ts` contributes 31 tests, including non-remove and remove
  reply paths with property-throwing destroyed Window fixtures.
- `npm run typecheck`: passed with 0 errors.
- `cargo fmt --check`: passed.
- `cargo clippy --all-targets --all-features -- -D warnings`: passed.
- `nix flake check`: passed (0 flake checks; all declared outputs evaluated).
- CTest: 21/21 passed from an out-of-tree native-effect build.

## Material Decisions And Accepted Evidence

- The original fault path was confirmed in source: `OpaqueWindowIds` keyed a
  `WeakMap` by KWin Window wrappers, while `PendingFlight` retained
  `PlanObserved` refs through `callDBus`; non-remove replies revalidated then
  wrote those captured refs.
- `native-id.ts` now shares the established `String(internalId)` and exact
  braced-UUID normalization. The plan entry's `Map<string, string>` is evicted
  for every string ID missing from a refreshed observation without reading a
  removal-signal payload.
- Plan flight, deferred intent, and last-good state retain primitive snapshots
  only. Planned replies synchronously observe live windows, compare value
  snapshots, and resolve targets only from that fresh observation.

## Next Action

- None.
