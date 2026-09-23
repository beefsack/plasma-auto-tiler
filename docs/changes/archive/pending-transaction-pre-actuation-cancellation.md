# Pre-Actuation Pending Cancellation

## Goal

- Release a verified unactuated pending transaction without replaying native
  work or reporting success.

## Approved Slice

- `send-to-workspace-cancel` and `directional-move-cancel` apply only to a retained `PendingUnacked`
  transaction whose normalized current observation byte-exactly equals a
  transaction-local dispatch-time pre-image. KWin must attest, for the exact
  generation, flight token, and correlation, that it dispatched zero geometry,
  membership, or follow setters, then arm cancellation before taking that
  observation so a late planned reply cannot change the attestation.
- Rust drops only the pending reconciler slot and staged desired state. It
  preserves committed topology, focus, shares, exceptions, revision, and
  unrelated domains. The reply has `outcome:"cancelled"` with the exact route
  kind, never `committed`. It asserts only exact current equality and
  KWin-attested project non-actuation, not general compositor or user history.
- KWin releases its local terminal block only after that exact reply. It does
  not replay a native write or reuse the cancelled correlation.

## Fenced Cases

- `post-unacked` and `post-acked` may continue only through their existing
  ack/verify path while the original flight and exact payload remain live.
  Status after terminal teardown cannot settle them because the status reply
  intentionally contains no plan operation or preconditions.
- `unresolved`, `stale`, `diverged`, and `no-pending-unknown` remain blocked.
  No-pending never implies a lost commit succeeded.
- The first slice excludes commit receipts, pre/post settlement commands,
  cancellation after acknowledgement, native replay, reseeding, polling, and
  all diverged or changed-owner state.

## Required Decisions

- User approved bounded normalized pre-image and original dispatch revision
  retention for the pending lifetime, the non-divergent unacked-cancel primitive,
  same-UID zero-dispatch attestation, and one automatic pre-actuation attempt.

## Source Basis And Limits

- Pending state is retained only in `WorkspacePending`/`DirectionalMovePending`
  and commits alone update canonical sessions: `src/planner_protocol.rs`.
  Pending records retain their bounded pre-image and original request revision
  only until commit, divergence, or cancellation.
- `Session::note_adapter_loss` and reconciliation divergence discard staged
  desired state and latch terminal divergence: `src/session.rs` and
  `src/reconcile.rs`. Those states cannot be cancelled.
- Workspace terminal handling persists `planBlocked` and disables the adapter;
  R4 clears its local flight but Rust retains the pending: KWin adapters.
  Cancellation arms before observation, invalidates old write paths, and clears
  local state only on a matching cancellation reply.
- Lost request replies, request-phase timeouts, and client rejection of a
  well-formed plan before actuation leave an unacked Rust pending while current
  teardown sends no `adapter-lost`; they are the concrete reachable candidates.
  Post-actuation timeout and ack/verify failure are ineligible because they
  have dispatched setters and current teardown reports terminal adapter loss.
- Exact current observation does not establish general quiescence. A narrow
  `cancelArmed` guard blocks old replies, timers, echo completion, new commands,
  and all native setters before the observation and until cancellation settles.
  Any cancellation failure falls through to today's teardown unchanged.

## Outcome And Evidence

- Rust tests prove exact pre-actuation cancellation preserves canonical snapshot, focus,
  shares, revision, and unrelated domains; near-pre, acked, stale, diverged,
  duplicate, and post observations refuse without mutation.
- KWin tests prove cancellation is admitted only for a zero-dispatch matching flight;
  terminal old callbacks are inert before cancellation; a successful cancellation
  releases only its matching local block; later explicit commands use a new
  correlation without native replay. Status remains read-only.
- `cargo fmt --check`, `cargo check --lib --tests`, focused workspace and
  directional Rust tests, and full `cargo test` passed. Rust ran 314 library
  tests plus all integration suites. `npm run typecheck` and `npm test` passed
  with 909 KWin tests; after the final focused cancellation cases were added,
  typecheck and the two affected bundled files passed 151 tests. `npm run build`
  produced the production KWin bundle. An independent source review found four
  issues before acceptance: timeout follow diagnostics, live gap use, defensive
  drag kind, and recovery-flight cancellation. All were corrected and checked.
- No live KWin, Plasma, D-Bus, host, window, desktop, focus, or session action
  occurred.
