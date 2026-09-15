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
- The current `ZRzA7S` incident is distinct. `w0` planned at lines 64-65, then
  consumed its mover membership and one geometry fence at 66-70. While its
  remaining geometry fence was pending, Plan lifecycle dispatched `p5` admit
  for the moved window at 77-91. The delayed `w0` geometry fence then completed
  at 85 and failed `stale-revision` at 86; its one `adapter-lost` report is at
  75-76. The user-observed view on 3 and window on 2 remain the incident fact.
- The exact-timeout settlement did not run: the flight reached the normal
  post-write completion path and failed `stale-revision` before its deadline.
  Its timer was then retired, so there was no pre-ack timeout left to settle.
- A send now pins its retained source workspace for every post-plan
  observation, failing closed if that exact desktop disappears. The production
  entry excludes Plan lifecycle and foreground Plan dispatch while a workspace
  send is active, and excludes a workspace send while Plan is active. It drops
  blocked lifecycle work rather than queueing it, then makes one ordinary Plan
  resync only after a committed send has followed and focused. Terminal send
  uncertainty remains terminal and never resyncs, replays, or commits.
- `plan-send-coordination.test.ts` exercises real production entry wiring. On
  pre-correction source its held-send lifecycle assertion fails with an extra
  Plan admission. With the correction it holds native echoes, switches live
  current desktop to the target, proves the accepted ack retains the original
  source, commits and follows, permits exactly one resync, and completes a
  subsequent distinct send. It also covers Plan/send busy refusal in both
  directions, timeout terminal behavior, late callbacks, and same-target
  refusal. Physical rapid-send and same-target acceptance remain pending.

## 2026-09-15 First-Send Follow Confirmation

- The authorized `F2A19Z` trace has a distinct completion boundary from
  `ZRzA7S`: `plan-1-w0` is planned at lines 52-58, acknowledged at 94-95,
  committed at 96-97, and logs follow completed at 102-106. Its later Plan
  resync observes the target domain at 98-101 and applies no geometry changes
  at 107-111. It does not establish the user-visible desktop switch or a border
  cause.
- KWin's `setCurrentDesktopForScreen` scripting setter is void. Production
  follow now reads `currentDesktopForScreen` once after the existing setter and
  treats a missing, throwing, or mismatched direct read as an incomplete follow.
  It does not retry, poll, rebind, rewrite native state, or alter the committed
  Rust transaction; a later valid send remains usable.
- The production-entry F2A19Z regression fails against the old unconditional
  follow success, uses the full planned/ack/verify protocol shape and required
  native echoes, keeps a sabotaged switch from logging completion, then proves a
  distinct same-instance send commits, follows, and focuses. Focused TypeScript
  and Rust workspace-send lifecycle checks pass. No live KWin, D-Bus, or Plasma
  action occurred; first-send, rapid, and same-target physical acceptance remain
  user-owned gates.
