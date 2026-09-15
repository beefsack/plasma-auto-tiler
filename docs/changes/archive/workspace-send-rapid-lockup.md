# Rapid Workspace Send Lockup

## Goal

- Keep rapid successive same-output workspace sends coherent: one accepted send
  must either commit and follow after exact fences, or diverge without poisoning
  later valid sends unnecessarily.

## Scope

- Recover the focused planned pre-ack timeout only when exact current native
  state proves the existing transaction completed its writes.
- Preserve Rust topology authority, exact identity/generation/ack verification,
  `desktopsChanged` and `frameGeometryChanged` fences, follow-after-commit,
  source/target reflow, and safe trailing-empty retirement.
- Cover overlapping `3->2->1` sends and later usable commands offline.

## Non-Goals

- No live KWin action, native rewrite, move replay, new transaction, polling,
  blind reset, fallback topology, discard/reseed, border rendering diagnosis,
  or new queuing/coalescing semantics.

## Acceptance

- A busy individual key leaves its active flight intact and is not represented
  as a completed command.
- Required signal timing cannot leave a successful native send permanently
  unavailable when exact post-observation can establish the outcome.
- An uncertain partial mutation never falsely commits.
- Proven pre-dispatch and explicit request-phase no-pending outcomes do not
  permanently disable a later valid send; ambiguous transport outcomes do.

## Evidence

- `3o88jX` lines 124-136 show `plan-1-w3` planned, two geometry echoes,
  busy-key refusals, then `adapter-lost` timeout. The border report is not
  evidence of Rust active workspace or renderer state.
- The planned `w3` shape changes only the mover and source survivor; its two
  target members retain their observed geometry. Current source therefore
  expects exactly two geometry fences, both logged at lines 129-130, plus the
  mover fence at line 126. A synchronous KWin-shaped regression for that
  exact shape passes current source, including geometry-before-desktop callback
  timing.

## Outcome And Evidence

- On the original timeout, only a valid planned flight with
  `verifiedObserved === null` takes one fresh complete observation and existing
  `verifyPlannedPost` equality check. Exact equality retires geometry and
  membership subscriptions and sends the original accepted ack with unchanged
  owner, generation, correlation, revision, preconditions, and operation; one
  new bounded ack/verify deadline follows. It makes no second native write,
  move replay, new transaction, polling, topology reconstruction, or false ack.
- Deadline epochs, flight tokens, one-shot echoes, and ack state protect the
  settled flight and later sends from late timers, frame/membership events, and
  duplicate callbacks. Ack or verify timeout is not replayed or reinterpreted
  as success and remains terminal.
- Rust creates `workspace_pending` only on the planned path. Activation failure
  before request dispatch and a well-formed request rejection other than
  `pending-exists` leave the adapter reusable with no adapter-lost report.
  Sent request/lost callback, malformed reply, request timeout, owner loss,
  `pending-exists`, `diverged`, and post-plan outcomes remain uncertain or
  pending and terminal. Discard/reseed requires separate generation and model
  recovery design and remains unselected.
- Static adapter coverage includes withheld-but-converged settlement through
  commit/follow and another send, mismatch/partial failure, late duplicates,
  stale deadlines, ack/verify non-replay, source-proven rejection recovery, the
  exact synchronous `w3` geometry shape, and a production-entry busy refusal
  while the first send settles. No live KWin/D-Bus action or current-log reread
  occurred. `3o88jX` still does not identify the original callback cause or
  prove the runtime source version.
