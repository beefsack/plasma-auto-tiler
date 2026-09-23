# Correlated Pending Observability

## Goal

- Make authorized pending-status and pre-actuation cancellation outcomes
  attributable across Planner and KWin without exposing native data.

## Delivered Scope

- Planner emits bounded `plasma-auto-tiler:plan-summary` ingress and egress
  records for authorized `DescribePlan` status/cancel calls. Fixed uncorrelated
  terminal summaries cover busy, closed, oversize, and unauthorized early
  exits without parsing the rejected request. Opt-in trace adds bounded
  structural request/reply shape only.
- Workspace-send and directional R4 cancellation records carry component,
  route, stage, correlation, generation, known revision, event, outcome, and
  original trigger cause. KWin records the validated cancellation reply before
  the post-release `local-release` record; a later command emits normal-level
  `event=dispatch outcome=started` with its new correlation.
- Records use validated correlation, bounded revision/counts, and allowlisted
  outcome tokens. They never emit payloads, geometry, native/window IDs,
  domains, owners, captions, arbitrary error text, or secrets.

## Non-Goals

- No new recovery, retry, reconciliation, native-actuation, authorization, or
  capture-pipeline behavior.
- No observability claim for routes outside pending status and cancellation.

## Outcome And Evidence

- Planner summary emission happens after the operation lock is released.
  Unauthorized, oversize, busy, and closed handling retains its existing reply
  behavior.
- Cancellation diagnostics preserve terminal divergence without attempting a
  futile cancel round trip. Workspace cancellation uses the pending base
  revision consistently in its attempt diagnostics.
- The R4 divergence skip is the sole non-logging correction in this record: a
  direct Rust `diverged` reply is terminal and ineligible for cancellation.
  Its terminal kind is now preserved instead of sending a cancel that Rust
  must refuse.
- `onCancelR4Reply` intentionally stays silent when a transfer is already
  bound or the pending flight is absent. Current cancellation fencing makes
  that state unreachable: explicit disable disarms first and a cancel-armed
  original reply cannot bind transfer. No unreachable-path diagnostic was
  added solely for coverage.
- Focused verification passed: `cargo fmt --check`, Planner-service tests,
  KWin typecheck, the bundled workspace-send and directional test files, and
  the production KWin bundle build. The earlier full Rust and KWin suites also
  passed before this lifecycle-record refinement.
- No live KWin, Plasma, D-Bus, host, window, desktop, focus, session, runtime
  log, or residue action occurred.
