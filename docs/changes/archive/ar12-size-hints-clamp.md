# AR12 size hints and clamp acceptance

## Goal and scope

User-approved 2026-09-24: carry observed min/max size hints through the KWin
adapter to the portable core; take space from siblings to honor satisfiable
minimums; mark unsatisfiable windows overconstrained instead of reasserting;
accept evidence-backed client-clamped geometry without drift/park. The
Orchestrator also approved bounded correlated diagnostics for geometry-cover
and partial-observation membership skew. Gates and native code remain intact.

## Approach and acceptance

- Keep size-hint policy and projection in zero-dependency `tiler-core`; observe
  and transport native hints using existing trace-only reads. Keep retained
  shares authoritative and leave any accepted short-frame space unfilled.
- Bound clamp acceptance using observed hints; absent evidence retains drift
  policy. Verify whether size increments can be observed reliably, and do not
  infer a Ghostty cause from geometry alone. Exclude native exception windows.
- Emit bounded correlated normal-operation clamp/overconstraint and mismatch
  diagnostics, respecting existing opaque window IDs and flags; do not alter
  mismatch gates. Test core geometry and clamp/no-park, protocol, adapter
  transport, gating, and diagnostic records.
- Verify requested Rust workspace/offline, format, Clippy and portable checks,
  KWin typecheck/tests/build; independent core/protocol/adapter review. No live
  mutation, host changes, staging or commit. Archive this note at completion.

## Units and evidence

- Core policy and protocol: implemented minimum-only hinted projection and
  axis-specific clamp assessment. The 2 px allowance covers rounding, not
  unobserved cell increments; the logged Ghostty max of `2147483647` is
  unbounded and does not explain a 56 px shortfall. Max hints affect clamp
  assessment, not sibling reallocation. Accepted short-frame space stays a
  gap; retained shares stay unchanged.
- Adapter: fresh min/max observation carried to the request, reply flags skip
  ordinary writes and explained reconcile drift, mixed genuine drift still
  counts toward park. Correlated default-visible per-member cover-skew logs
  include observed flags and known floating source; partial-observation
  compares adapter last-good when available, otherwise says retained unknown.
- The Orchestrator selected option (1), applying the user's approved AR12
  language: R4 never writes plan-flagged overconstrained members. Native proof
  reads every member's output, exact desktop membership and geometry; ack and
  verify carry fresh client-held geometry for flagged members and require exact
  planned geometry for all others. Rust verifies against its own staged flags,
  never inferred adapter flags. No new protocol phase, retry, or timeout.
  The correlated R4 verify record lists each flagged window. Core, protocol,
  and fake-native tests cover successful commit and a genuine mismatch failure.
- The reviewer's hintless drag-preview discrepancy is deferred: preview lacks
  a current observation, while drop receives one. Supplying equivalent hints
  requires a larger preview evidence change; tracked in the backlog.
- Independent read-only delta review found no blocking defect. Residual risks:
  exact membership readback for every R4 member can refuse a transiently
  unreadable sibling; an overconstrained mover can remain visibly displaced
  after transfer. Observed out-of-bounds geometry still fails Rust validation.
  Minor review observations: hint-attached snapshots are not frozen and
  membership-skew logging is bounded per rejection, not per time interval.
- Final offline checks: Rust workspace tests 656 pass, KWin tests 807 pass;
  format, Clippy (pre-existing warnings only), portable dependency check,
  typecheck, and build pass. No native files changed. No live mutation, host
  changes, staging, or commit. User-owned live AR12 acceptance remains open.
