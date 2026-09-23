# Pending Transaction Status

## Goal

- Expose authoritative, read-only status for one exactly identified pending
  workspace-send or directional R4 transaction.

## Scope

- Add `send-to-workspace-status` and `directional-move-status` to the existing
  same-UID-authorized `DescribePlan` transport.
- Classify only exact planned post-observation with pending acknowledgement
  state, unresolved observation, stale identity, divergence, or unknown absent
  pending state.

## Non-Goals

- No acknowledgement, verification, commit, cancellation, recovery, retry,
  topology discard/reseed, native write, adapter integration, pre-observation
  retention, or commit receipt.

## Outcome And Evidence

- Both status evaluators take `&self`, use existing pure planned-post
  predicates, and return no native/window geometry, focus, operation, or
  preconditions. `no-pending-unknown` has no commit implication.
- Focused tests cover post-unacked, post-acked, unresolved, stale, diverged,
  no-pending-unknown, malformed/scope rejection, and successful ordinary
  acknowledgement and verification after status for workspace-send and R4.
- `cargo check --lib --tests`, focused workspace and directional tests, full
  `cargo test`, and `cargo fmt --check` passed. An independent source review
  found no authorization, mutation, validation, or response-leak defect.
- No live KWin, Plasma, D-Bus, host, window, desktop, focus, or session action
  occurred.
