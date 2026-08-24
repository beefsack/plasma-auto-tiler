# State: Drag-Drop Client Gap Diagnostics

Expanded state created because proven tile coverage does not establish settled
client/frame or rendered geometry. The production correction remains parked and
separately scoped. Portable cross-WM/OS layout-engine research follows the COSMIC
successor and interactive-resize work; the proven KWin client-realization gap is
not classified as an engine defect.

- Execution mode: Autonomous for the remainder of this session. The production
  correction remains parked; user-run live actions are unavailable.

- Current major unit / attempt: `unit-drag-gap-final-manage-production` / parked
  after attempt 02.
- Completed units: `unit-drag-gap-diagnostic-contract`, `unit-drag-gap-live-evidence`,
  `unit-drag-gap-final-manage-fixture-contract`,
  `unit-drag-gap-fixture-typecheck-fix`.
- Blockers: the production unit reached the three-dispatch no-progress breaker.
  The final user-run retry remains blocked until static integration acceptance,
  user-run protocol, and user availability.
- Next dispatch: none. The production unit is parked pending a separately
  approved reset, scope reduction, or successor decision; portable engine
  research follows COSMIC and interactive resize.
- Separate host record: one cancelled read-only Lead host attempt; it is not an
  implementation dispatch.

| Unit | Implementation attempts | Pre-review corrections | Finding-fix corrections | Independent reviews |
|---|---:|---:|---:|---:|
| `unit-drag-gap-diagnostic-contract` | 1 | 1 | 0 | 0 |
| `unit-drag-gap-live-evidence` | 0 | 0 | 0 | 0 |
| `unit-drag-gap-mechanism-checkpoint` | 0 | 0 | 0 | 0 |
| `unit-drag-gap-final-manage-fixture-contract` | 1 | 0 | 0 | 1 |
| `unit-drag-gap-fixture-typecheck-fix` | 1 | 0 | 0 | 0 |
| `unit-drag-gap-final-manage-production` | 2 | 0 | 0 | 0 |
| `unit-drag-gap-final-manage-integration` | 0 | 0 | 0 | 0 |
| `unit-drag-gap-final-manage-live-retry` | 0 | 0 | 0 | 0 |

| Implementation dispatches | Dispatch-invalids | Changed-kind resets | Acceptance criteria moved | No-progress streak |
|---:|---:|---:|---:|---:|
| 5 | 1 | 2 | 3 | 3 |

- Recovery limit: after a structural mutation fails, stop final-manage retries;
  re-decode and reconstruct invariants from the transaction snapshot. Native
  atomic topology rollback and tile-identity preservation are not available.
- Fixture gate baseline: `kwin/tests/controller-interactive-drag-reflow.test.ts`
  bundles and passes through the canonical focused commands with 1 suite, 11
  tests, 11 passed, and 0 failures before the fixture contract changes.
- Dispatch-invalid reason: the plan does not state an exact expected post-change
  count for `gate.focused-reflow-test`, so attempt 01 was not dispatched and no
  source work occurred.
- Approved repair: the fixture gate expects 1 suite, 13 tests, 13 passed, 0
  failed, 0 skipped; the later production gate expects 1 suite, 15 tests, 15
  passed, 0 failed, 0 skipped. The dispatch-invalid history remains counted.
- Attempt 01 implementation accepted: the two fixture files add a public-route
  boundary observation, trace/snapshot/decode/membership/focus observability,
  and seven injectors. Focused TAP reported 1 suite, 13 tests, 13 passed, 0
  failed, 0 skipped. One independent review found no unresolved serious finding;
  the fixture contract is accepted and production is ready for separate
  authorization.
- Production attempt 01 stopped before source work: canonical build and reflow
  bundle/test passed at 1 suite, 13 tests, 13 passed, 0 failed, 0 skipped, but
  `gate.static-typecheck` reported TS2722 at the accepted fixture test's
  unguarded optional `remove()` call. Authorization is required for the minimal
  fixture-test repair.
- Fixture typecheck fix attempt 01 accepted: `fixture.origin.remove?.()` is the
  only authored change; reflow bundle/test remained 1 suite, 13 tests, 13
  passed, 0 failed, 0 skipped, and canonical typecheck passed. Production
  attempt 02 is ready for separate authorization.
- Production attempt 02 is rejected and parked: build, focused reflow bundle,
  focused reflow test (1 suite, 15 tests, 15 passed, 0 failed, 0 skipped), and
  typecheck passed, but the source does not reconstruct its topology snapshot or
  restore focus after a structural failure. Its seven-row failure test drives
  fixture operations directly, not the production transaction. No criterion
  moved, so the inherited no-progress streak reached three and prohibits a
  correction, review, further dispatch, broad gate, live action, staging,
  commit, or push.
- Parked foundation checkpoint: the rejected source and two production tests
  are removed with no preservation container. The retained `term2` declaration
  and deferred-collapse assertion repairs restore the accepted 13-test reflow
  contract. Build,
  diagnostics 45/5/45/0/0, reflow 13/1/13/0/0, and typecheck pass. The
  serialized broad run passes 993/95/993/0/0 with start-test 255/0; dogfood is
  347/0 with its permitted missing temporary-data warning. The prior 301/28
  274/27 broad result was concurrent dogfood-build interference, not a product
  finding. No acceptance criterion moved; the no-progress streak remains 3.
