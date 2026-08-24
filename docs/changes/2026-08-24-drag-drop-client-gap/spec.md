# Specification: Drag-Drop Client Gap Diagnostics And Final-Topology Management

Ownership and approval:
- Owner: Lead
- Status: Amended and approved 2026-08-24 by user and Orchestrator

## Intent and Desired Outcome

The user observed a visible gap directly below the top-right window after the
final drag/drop in dogfood evidence
`/run/user/1000/plasma-auto-tiler-live/live-20260824T194911-41198`. That
observation is ground truth. Accepted diagnostics established fully partitioned
final leaves while the dragged client retained its pre-drop frame after
normalization. The user and Orchestrator approved the supported correction:
associate the dragged client with its already-normalized final target exactly
once, so KWin performs its own initial tile geometry request.

The recorded final tile leaves completely partition the output work area, but
the evidence does not capture settled occupant client or frame geometry. This
change delivers the accepted diagnostic evidence, an independently accepted
fixture contract, the constrained ordering correction, focused integration
evidence, and one bounded user-run confirmation.

## Scope and Non-Goals

In scope:

- Transaction-scoped diagnostic capture in the interactive-drop completion
  path, limited to final leaf, occupant geometry, output-work-area, and event
  ordering evidence.
- Static diagnostic-contract coverage for the recorded final topology.
- An independently accepted fixture contract for deferred final target
  management, including recovery limits.
- Reorder the interactive-drop transaction to unmanage the dragged client,
  construct and normalize final topology, then manage it once on its final
  target with supported KWin boundary operations.
- Focused integration/static verification and one user-run live retry proving
  final dragged-frame/leaf alignment and absence of the visible gap.

Non-goals:

- Direct client/frame geometry writes or move/resize requests by project code.
- Replication of KWin's private tile `windowGeometry()` calculation.
- Timers, polling, sleeps, unsupported KWin APIs, or compositor-settle claims.
- Overlay/group-outline work and COSMIC directional-movement implementation.
- More than one bounded correction live retry.

## Applicable Principles and Decisions

- User observation is the source of truth for the reported visual gap.
- The user and Orchestrator approved this Expanded diagnostic scope and the
  supported final-topology-management correction on 2026-08-24.
- Drag-gap work is first priority. COSMIC directional movement remains parked
  and is next only after this drag-gap change, through a separately approved
  genuinely new successor acceptance path.

## Constraints

- Production scope is limited to `kwin/src/controller-interactive-drag.ts` and
  existing supported boundary operations. Do not hand-edit generated
  `kwin/contents/code/main.js`.
- Static fixture/test scope is limited to the direct interactive-drag fixtures,
  scenarios, reflow test, deferred-recovery test, and diagnostics assertions
  required by the approved units.
- `controller-settled` means the existing after-snapshot boundary after deferred
  origin removal, collapse, and normalization. It does not claim compositor
  settling.
- The fixture may assert operation intent and topology invariants, but never
  native KWin frame realization or compositor presentation.
- On a structural failure, recovery is snapshot-backed re-decode and invariant
  reconstruction, not atomic native topology rollback. Final manage is not
  retried after such a failure.
- The live checkpoint is user-run and follows `docs/live-kwin-testing.md`
  before live execution.

## Acceptance Criteria

- [x] Diagnostic records identify the drag transaction, target leaf, output
  work area, final leaves, occupancy, available client/frame geometries, and
  collapse/normalization ordering at `controller-settled`.
- [x] Static fixtures prove diagnostic payload and ordering for the recorded
  final topology, without claiming native KWin or compositor realization.
- [x] One bounded user-run reproduction captures the required before/after
  evidence or records its precise unavailability.
- [x] The initial checkpoint classifies available evidence as inconclusive under
  the no-supported-later-event rule and records the supported ordering route.
- [ ] The fixture self-contract proves operation tracing, public interactive
  start/finish invocation, recursive snapshot/decode observations,
  membership/focus observations, and the seven approved failure injections with
  immutable pre-failure snapshots, decoded post-failure observations, trace
  failure markers, and recovery-required records. It does not assert transaction
  ordering or reconstruction.
- [ ] The production transaction uses only snapshot/focus capture, dragged
  unmanage before target split, target-occupant preservation, recursive origin
  collapse, final normalization, one final target manage, and postcondition
  verification. It re-decodes after every structural mutation, preserves final
  partition/membership bijection and focus, reconstructs from its snapshot on
  structural failure, and never retries final manage after failure.
- [ ] Focused integration/static gates pass, including the named risk-tier broad
  checkpoint.
- [ ] One user-run retry on the matching topology proves the dragged frame
  aligns with its final leaf and the visible gap is absent.

## Unresolved Questions

- Does the one permitted user-run retry meet both final-frame alignment and
  rendered-gap acceptance conditions?
- Does any failure path expose a recovery invariant not covered by the fixture
  contract?

## Consequential Decisions

- The correction uses KWin's supported changed-association path, which computes
  its private final geometry during the one final `manage()` call; project code
  does not calculate or write that geometry.
- Fixture acceptance is required before production dispatch and receives one
  independent review. A fixture result cannot assert native frame realization.
- If the live retry lacks either required observation or uses a changed topology,
  it does not satisfy the correction acceptance criterion.
