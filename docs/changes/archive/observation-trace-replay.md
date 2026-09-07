# Stage 3 Observation Trace Replay

## Goal

Add a bounded, redacted, versioned offline observation-trace fixture contract
that replays platform-adapter sequencing through the existing Rust directional
planner and reconciler.

## Scope

- A portable JSON v1 trace envelope and strict bounded parsing.
- Deterministic replay through the existing planner and `Reconciler`.
- Canonical fixtures for convergence and required terminal divergence paths.
- A fixture lock that detects unreviewed semantic or expected-output changes.

## Non-Goals

- Live trace collection, platform adapter/runtime selection, IPC, FFI,
  packaging, KWin/Windows/macOS types, or any native action.
- A second planner or reconciler model, runtime timestamps, or a byte-portability
  claim beyond the checked-in fixture lock.

## Acceptance

- The trace contains bounded metadata, session-scoped opaque IDs, initial and
  post observations, semantic request, emitted plan identity/revision/
  preconditions, adapter outcome, and expected terminal state and diagnostic
  class.
- Sensitive application and user-identifying fields are unrepresentable by the
  schema.
- Replay rejects malformed/version-incompatible/oversized/out-of-order traces,
  maintains one pending plan, checks exact correlations and monotonic revisions,
  and derives the result from the production planner/reconciler.
- Canonical fixture lock, formatting, focused and full Rust tests, Clippy with
  warnings denied, and `git diff --check` pass.

## Approach

1. Define the trace model and bounded JSON decode using existing `serde` and
   `serde_json`.
2. Drive the existing directional planner and reconciler from each trace event.
3. Add canonical fixtures, semantic/byte lock, invariant tests, and independent
   adversarial review.

## Material Decisions

- V1 is a checked-in deterministic JSON fixture contract. Stability means the
  parsed semantic result and locked checked-in bytes are stable in this
  repository; it does not claim serializer-independent canonical bytes.
- Observations use opaque adapter fingerprints and session-scoped opaque IDs.
  Captions, titles, application identifiers, paths, native handles, user data,
  timestamps, and runtime metadata are not trace fields.

## Outcome

- JSON v1 accepts bounded metadata, opaque session identity, an initial and
  dispatch-time observation, ordered request/plan/ack/verify/adapter-loss
  events, and an assertion-only expected terminal result.
- Replay derives plans with the existing directional planner and executes the
  existing reconciler. It rejects invalid schemas, order, identities, bounds,
  plan assertions, and mismatched session metadata without echoing input.
- Eight canonical fixtures cover nested N-ary convergence, stale observation,
  partial apply, refusal, duplicate and mismatched acknowledgements, adapter
  loss, and postcondition mismatch. The fixture lock checks repository bytes
  by length/SHA-256 and independently locks plan/terminal replay assertions;
  it does not claim serializer-independent or cross-platform byte stability.

## Evidence

- `cargo fmt --check`, `cargo test trace`, `cargo test`, `cargo clippy -- -D
  warnings`, and `git diff --check` passed.
- Independent adversarial review found and corrected initial-observation session
  binding, optional escape-parent normalization, and weak byte checksums.
- No live trace collection, KWin or POC3 action, process/workdir/coredump
  inspection, host mutation, IPC, packaging, or platform selection occurred.

## Exact Next Action

None. Any trace recorder or platform adapter requires a separately scoped
decision and authorization.
