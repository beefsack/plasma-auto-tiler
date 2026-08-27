# COSMIC Controller-Path Directional Movement

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-25 by user; reset semantic amendment approved 2026-08-27 by Orchestrator under autonomous implementation authorization

## Intent and Desired Outcome

Deliver COSMIC R1-R4 directional keyboard movement through the public controller
path. A COSMIC-local deterministic fixture-support corpus first accepts
native-like state, decode, snapshot, ambiguity, and failure primitives without
exercising production behavior. After adapter integration, a controller-path
corpus proves the behavior. A separately approved host KWin checkpoint then
validates the same contract with user-performed physical shortcuts.

## Scope and Non-Goals

In scope:

- A controller-owned adapter from registered directional shortcuts and controller
  guards to the accepted COSMIC runtime.
- A deterministic fixture-support corpus in new COSMIC-local test paths, with
  isolated recursive native-like state, fresh decode/snapshot observation,
  controlled ambiguity, and failure primitives.
- A controller-path conformance corpus that invokes `TileController.start()` and
  registered shortcuts after adapter integration.
- Static integration and preservation gates.
- A separately gated host KWin vector, reset, and evidence protocol.

Non-goals:

- A strategy selector, persisted setting, KCM control, shortcut catalog change,
  or non-COSMIC strategy.
- Workspace crossing, drag, resize, insertion, float, sticky, reconstruction, or
  unrelated behavior changes.
- Direct runtime construction, replacement environments, synthetic input, a
  nearest-leaf fallback, or a claim of restoration without fresh proof.
- Reusing, importing, modifying, or transferring ownership from
  `kwin/tests/controller-fixtures.ts`, or reading, applying, copying, altering,
  relabeling, or using `unit-01-candidate.patch` as acceptance evidence.
- Host execution until the host protocol receives Orchestrator sign-off and user
  approval.

## Applicable Principles and Decisions

- `docs/backlog.md`: the approved controller-integration successor exception is
  separate from the historically parked COSMIC change.
- `docs/decisions.md#native-effect-live-validation`: host operations are bounded,
  reversible, user-local, and session boundaries remain user-run.
- `docs/live-kwin-testing.md`: host evidence uses bounded controller lifecycle,
  diagnostics, cleanup, and no synthetic input.

## Constraints

- The parked `2026-08-24-cosmic-directional-movement-strategy` artifacts and
  counters remain historical and untouched.
- The controller owns shortcut registration, feature/scope/guard decisions,
  lifecycle, diagnostics, and composition. The adapter only translates narrowly
  scoped controller capabilities to runtime operations.
- The adapter must not own shortcuts, recreate or infer topology, infer native
  split order/cardinality, retain fixture state, widen mutable capability bags,
  change geometry-ordering locality, or retain a fallback route.
- Native results are opaque. Fresh decode and postconditions are required after
  mutation and before subsequent structural work.
- Topology corruption, duplicate occupancy, unsafe rollback, lost windows, and
  false restoration are hard stop conditions.
- A fixture recovery may be called restored only after exact fresh-decoded
  equality with the pre-invocation snapshot.
- Unit 02 changes only controller composition, one narrow controller adapter, and
  one new controller-path conformance test. Existing shortcut registration and
  static integration remain Unit 03 work.

## Acceptance Criteria

- [x] An independently accepted COSMIC-local fixture-support corpus in
  `kwin/tests/cosmic-fixture.ts` and
  `kwin/tests/cosmic-fixture-contract.test.ts` creates isolated recursive mutable
  native-like state, fresh decode/snapshot observation, controlled
  opaque/reversed/stale ambiguity, controlled failure primitives, exact
  restoration, unassigned-window rejection, cyclic-child rejection, isolated
  mutable defaults, and stale-root-parent rejection without exercising desired
  COSMIC behavior.
- [ ] The controller-path corpus starts `TileController`, invokes registered
  canonical and arrow-alias shortcuts, and covers R1-R4 and S1-S4 after adapter
  integration.
- [ ] Controller-path coverage validates opaque/reversed/stale native results,
  injected production-operation failures, fresh decode, focus, and occupancy
  invariants.
- [ ] Every claimed fixture or controller-path recovery proves exact
  fresh-decoded snapshot restoration; otherwise the result fails closed and is
  not reported as restored.
- [ ] Controller composition reaches the accepted COSMIC runtime without direct
  runtime construction, ownership leakage, or non-COSMIC fallback.
- [ ] Locked keyboard coverage and non-directional behavior remain preserved.
- [ ] G-01 through G-05 pass against their recorded baselines.
- [ ] After separate approval, the host checkpoint uses only user-performed
  physical shortcuts and passes its approved vector/reset/evidence protocol.

## Unresolved Questions

- Unit 04 must propose the exact host vector table, manual reset mechanism,
  topology observation schema, evidence retention, and pass/fail format. It
  cannot finalize them without Orchestrator sign-off and user approval.

## Consequential Decisions

- This remains a separately scoped successor. The one permitted changed-kind
  reset replaces the unaccepted shared-fixture ownership/oracle with the
  independently accepted COSMIC-local fixture/oracle unit above. Prior counters
  remain historical; this reset is not a relabeling or correction of the
  rejected candidate.
