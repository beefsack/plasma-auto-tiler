# Rust Focus KWin Adapter

## Goal

Deliver the first product-shaped, static-only KWin adapter for Rust-owned
directional focus/navigation. The adapter is disabled by default and has no
normal startup, shortcut, tray, KCM, autostart, or lifecycle activation route.

## Scope

- Add a strict KWin planner-service focus request, acknowledgement, and
  post-observation boundary backed by the portable `Session` focus plan and
  reconciler.
- Add a signal-driven KWin adapter command with one owner/generation and one
  in-flight plan. It observes an opaque current scope, revalidates before its
  one exact native focus write, and fails closed on every mismatch or loss.
- Cover disabled default, exclusivity, stale/signal invalidation, mapping,
  no-op, acknowledgement, divergence, and production-route isolation with
  durable Rust and KWin static tests.

## Non-Goals

- No live KWin work, runtime-residue inspection, lifecycle route, activation
  UI, shortcut registration, Custom Tile mutation, geometry write, topology
  mutation, workspace/output/configuration mutation, or generic IPC layer.

## Approach

- Keep portable domain/topology/focus selection, plan binding, revisions, and
  reconciliation in Rust. Keep lexical KWin observation, native identity
  mapping, signal ordering, focus write, and post-observation in TypeScript.
- The adapter command is an explicit exported entry point only. It refuses
  unless its caller proves exclusive focus-path ownership; production startup
  does not import or call it.

## Acceptance

- Rust plans and commits exact focus transactions only; mismatch, owner loss,
  partial/cross-domain input, or acknowledgement failure diverges fail closed.
- KWin applies at most one exact target focus write after fresh revalidation;
  it sends acknowledgement plus fresh post-observation and disables on fault.
- Existing Custom Tile production behavior and generated bundles remain
  untouched.

## Verification

- `cargo fmt --check`, `cargo check --all-targets`, focused Rust tests and
  Clippy.
- KWin typecheck/static tests, schema/fixture checks, and tracked diff review.

## Outcome

- `DescribeFocus` is an authenticated KWin planner-service method backed by one
  Rust-owned Session and its shared focus reconciler. First observation seeds
  the normalized current domain in Rust; requests, acknowledgements, fresh
  verification, and adapter loss are strict bounded JSON v1 actions.
- The standalone KWin adapter has no normal activation route. Its future caller
  supplies the exact owner/generation and exclusive focus-path proof. It uses
  active/window/output/desktop signals to invalidate, writes one exact target at
  most once, and disables on every fault.
- Static verification passed: `cargo fmt --check`, `cargo check --all-targets`,
  `cargo test`, `cargo clippy --lib --no-deps -- -D warnings`, KWin typecheck,
  and 32 focused KWin adapter tests. No live KWin work ran.
