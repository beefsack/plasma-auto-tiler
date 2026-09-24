# Drop-intent edge drag

## Goal and scope

Replace strict opposite-edge-fixed inference with the edge(s) grabbed at
interactive resize start. Route the oracle's final position of those edges to
pointer-resize, ignoring changes elsewhere. Keep AR8's oracle-removal decision
pending and host testing offline. Record the 2026-09-24 native-boundary and
drop-intent user decisions separately from the Orchestrator's reliability
interpretation in `docs/decisions.md`.

## Acceptance and approach

- Capture edge intent with the start geometry and pointer under the existing
  finish-token/identity fence. No reliable grabbed-edge report is exposed by
  the available KWin script/effect signals; classify the nearest start edge,
  or both within 16 px of the corner. Use the oracle final *window edge*, not
  the finish pointer, as each target.
- Preserve the existing single-axis request. For a corner with two moved
  axes, carry one optional perpendicular second axis through the same
  `pointer-resize` request and single pending core transaction. An unmoved
  grabbed axis contributes no target. Core still applies its existing
  topology, capability and projectability guards.
- Log a bounded drag-correlated source, grabbed edge, target, ignored deltas,
  dispatch acceptance and specific no-route reasons. Keep trace-only AR8
  `deriveOracleEdge` measurement intact.
- Offline regressions: Firefox 789->939 left/1528->1529 right; opposite edge
  size-increment clamp; orthogonal self-resize; one-request/two-axis corner;
  cancellation, zero move, missing pointer and invalid/lost identity. Verify
  Rust workspace tests, format, clippy and portable check, plus KWin typecheck,
  tests and build. Native build only for native changes.

## Bounded units and material decisions

- KWin start capture, resolution, logging and proportionate route tests.
- Minimal dual-axis protocol/core/reconciler shape with one revision and one
  pending slot, checked against the existing response decoder. No native code
  changes; no change to AR8's drag-oracle outcome.
- Independent read-only review of the dual-axis public request/reply contract.
  A two-request sequential corner was rejected during Lead review because
  single-flight deferral could overwrite an axis; one atomic request replaced
  it. A broad outer-third corner zone was likewise replaced with a narrow
  physical-edge proximity, to avoid mistaking edge grabs for corners.

## Outcome and evidence

Offline change complete. The exact Firefox regression routes left:939 while
ignoring right:1528->1529; the corner regression sends one dual-axis command.
The Rust session/protocol regressions confirm both axes in one retained plan,
one revision and one pending transaction. Existing single-axis request/reply
shapes remain unchanged. Independent read-only contract review found no serious
correctness defect in the changed path.

Lead verification on the final code: `cargo test --workspace --offline` 590
passed; `cargo fmt --all -- --check` passed; `cargo clippy --workspace
--all-targets` passed with existing warnings and none added; `just
check-portable` passed. In `kwin/`, `npm run typecheck` passed, `npm test`
745 passed, `npm run build` passed. `git diff --check` passed. Native files
were not changed. No live KWin/Plasma action was performed.

Live risk: KWin start-signal pointer freshness and the 16 px corner
classification need Wayland validation, particularly non-pointer-initiated
resizes and resize handles near a corner. The user owns live acceptance of
Firefox left-edge jitter, a size-increment client, corner both axes, Esc and
zero-move; AR8's broader measurement and oracle disposition remain pending.
