# Incremental send recovery and admission batching

Status: section A shipped offline 2026-09-25, superseded by
[observation-convergence step 3](archive/observation-convergence.md) on
2026-09-26. Its pending ack/verify/abandon and Plan-block paths are retired.
Section B's former previous-snapshot removal premise was retired by complete
observation reconcile in steps 1-2; any further batching remains a proposal.
Full AR11 and full AR4 are obsolete historical designs (see their notes).

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

## A: bounded workspace-send abandon (superseded historical implementation)

User decision, 2026-09-25, replacing the three-outcome proposal above under
the Simplicity and Resilience principles: exact ack/verify commit and prompt
native-proof follow remain the success path. Any send that cannot verify
cleanly (non-exact post-state, source/third-domain/absent mover, deadline,
lost/late reply, ack/verify timeout) uses one fenced correlated
`send-to-workspace-abandon` Planner operation. The original decision matched
only the exact pending, including acked/diverged. **User decision 2026-09-25,
option B, under Resilience:** the same operation now retires *any* live
workspace-send pending, including an orphan from an older generation or other
same-UID caller/correlation. An exact match replies `abandoned`; retirement of
another pending replies distinct `orphan-abandoned` under the requesting
correlation; absence replies `no-pending-unknown`. No reply claims commit.
Engine per-domain sessions and Plan baselines remain; there are no receipts,
new retained state, or setter replays. A displaced owner's late ack/verify
finds no pending and its subsequent abandon settles via option A. Lost
planned replies may use the original request revision; known planned replies
use their base revision to distinguish the exact reply from orphan retirement.
On a definitive reply KWin clears the Plan block, keeps send enabled, and
requests ordinary Plan resync from native observation (admission/removal,
existing partial-observation rebuild, fresh-domain fitting). Unreadable
observation may retry on a valid native echo within one bounded abandon wait;
an unanswered/invalid reply releases the *local* flight as `unconfirmed` at
the wait's deadline (immediately if the pinned owner or timer is invalid),
still handing off to ordinary
Plan, never claiming Engine retirement. The next send activates the current
Planner owner and can retire a surviving orphan. Structured correlated bounded
requested/replied/orphan/unconfirmed/handoff logs exclude native identifiers
and payloads. Directional R4 remains out of scope.

Acceptance: thirteen real-observer/real-Engine fixture rows cover source,
third-domain, absent, non-exact, unreadable/retry, dropped abandon reply,
lost planned/verify replies, late ack, ack/verify timeout, and a real
Plan-observer admission after the `blocksPlan` transition. Independent review
first identified a missing `no-pending-unknown` oracle and an observation-only
Plan check; both were corrected and re-reviewed before production work. A
later integrated check caught lost planned replies returning no-pending while
the exact Engine pending was still live; the revision fence and mismatch
reply were corrected and re-reviewed. Option B adds three rows for older-
generation orphan retirement, displaced-owner recovery, and bounded
no-definitive-reply handoff. A Worker who did not write them independently
reviewed the rows; reply/oracle precision was tightened before production.
After implementation independent review found stale comments and a
synchronous-deadline reentrancy edge; both were repaired and the edge was
tested. The ten older skipped AR11 rows remain parked reference only.

Offline evidence: KWin typecheck, 834 passed/10 parked skipped tests, and
build; Rust workspace tests, fmt, clippy, and portable check. Live KWin
acceptance remains pending: exercise native drift, close/escape, displaced
owner and older-generation pending, lost replies/unconfirmed handoff, and
follow responsiveness in a bounded live session before claiming runtime
behavior.

## B: batched admissions (historical candidate)

Step 2 replaced the previous-snapshot removal route with complete-observation
`reconcile`; one observation now converges simultaneous newcomers in stable
first-seen order and departures before projecting its plan. The separate AR4
`sync` and drift/park policy migration remain parked, not shipped by section B.

## Parked

Full AR11 expectation model and full AR4 `sync` remain historical proposals.
The ten skipped AR11 rows were removed in step 3; the real-Engine fixture now
tests immediate send and observation convergence.
