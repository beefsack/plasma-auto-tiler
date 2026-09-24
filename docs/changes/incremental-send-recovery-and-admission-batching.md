# Incremental send recovery and admission batching

Status: proposal accepted by the user as the working direction (2026-09-25),
open to refinement. Not designed in detail or reviewed. Replaces full AR11
([note](architecture-review-ar11-expectations.md)) and full AR4
([note](architecture-review-ar4-observation-sync.md)), which are parked.

## Why

Full AR11 is not only architectural: it would let a send recover after
native actuation, closing the send-specific exception to the user requirement
that a window/domain is never left permanently stuck. AR4's visible value is
removing the intermediate layout when several windows appear together. Both
were pursued as wholesale replacements and did not converge. This proposal
targets the same user-visible value with far smaller changes.

## Lessons from the failed attempts

1. Every rejected attempt failed on the native-observer-to-core seam that
   component tests missed. Gate any retry on the real-observer/real-Engine
   fixture (`kwin/tests/workspace-send-engine-fixture.test.ts`).
2. Wholesale replacement of a live-accepted path forced all six AR11
   invariants to be proven at once, every attempt. Add bounded behavior to the
   existing fenced model instead.
3. Every new authority token (observation sequence, world index, per-domain
   revision/fingerprint) needs a source at every entry point: first touch,
   restart, eviction. The existing send pending state avoids this because it
   exists only after a send started.
4. Removals are hard (Session requires pre-removal evidence); admissions are
   not. AR4 stalled on removals.
5. Paper design review passed while implementations failed. Derive fixture
   rows from the design before writing production code.

## A: bounded post-actuation send resolution (first)

Keep the existing send pending state, fences, ack/verify and prompt
native-proof follow. Add one resolution step at the existing single 5 s
deadline, from a fresh complete observation of the source and target domains:

- mover on target: settle as committed;
- mover still on source: restore the retained pre-send topology (as
  pre-actuation cancellation already does), advancing revisions monotonically;
- elsewhere or absent: release the pending state and let the ordinary
  admission/removal route handle the observed facts.

Resolution runs once, never replays a setter, never rebuilds topology from
geometry, and logs the outcome correlated with the send. Unreadable
observation at the deadline stays uncertain and resolves on the next valid
observation. Planner loss remains handled by wake transport recovery.

Proposed outcomes accepted as the working baseline; the design must confirm
each against current fences and pass independent review before code.

## B: batched admissions (second, or when intermediate jank is noticed)

When several windows appear together, admit them in one request and one plan
in stable first-seen order, from one complete observation. Removals stay on
the existing previous-snapshot route, avoiding the pre-removal evidence
problem. Drift/park policy migration and a single `sync` stay parked.

## Parked

Full AR11 expectation model and full AR4 `sync`. Their notes, the fixture and
ten skipped AR11 rows remain for reference.
