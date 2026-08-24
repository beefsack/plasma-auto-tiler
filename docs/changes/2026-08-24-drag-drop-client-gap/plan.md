# Plan: Drag-Drop Client Gap Diagnostics And Final-Topology Management

Ownership and approval:
- Owner: Lead
- Status: Amended and approved 2026-08-24 by Orchestrator and user
- Execution mode: Autonomous for the remainder of this session. Governance and
  user-owned decisions remain parked; user-run live actions are unavailable.

Semantic sections - Technical Approach, Work Units, Pending User Decisions -
need Orchestrator approval before each edit. Record-keeping sections - Progress,
Attempt Accounting, Acceptance-Criterion Evidence, Residual Risks, Final Outcome
- are Lead-owned and edited directly.

## Technical Approach

The accepted diagnostic facts remain captured at the existing interactive-drop
after-snapshot boundary in `kwin/src/controller-interactive-drag.ts`.
`controller-settled` follows deferred origin removal, collapse, and
normalization, but is not evidence that rendering has settled.

Each transaction record contains transaction ID, stage, dragged-client ID,
resolved target leaf ID, output ID/work area, every final leaf ID/rectangle and
occupant ID, each occupied leaf's available client and frame geometries, explicit
unavailability for unsupported geometry, and origin-removal/collapse/
normalization/after-snapshot ordering. A `post-settle` record is allowed only
when an already supported client-geometry event arrives after
`controller-settled`; absence is evidence of unavailability, not a reason to add
a timer, polling, sleep, or API.

Before production work, extend the deterministic interactive-drag fixture only
to prove fixture capability and observability: operation tracing, public
interactive start/finish invocation, recursive snapshot/decode observations,
membership/focus observations, and seven approved structural failure injectors
with immutable pre-failure snapshots, decoded post-failure observations, trace
failure markers, and recovery-required records. The fixture neither prescribes
the transaction order nor reconstructs topology. It cannot prove native KWin
frame realization, decoration extents, compositor rendering, or absence of the
visual gap.

After the fixture contract is accepted and independently reviewed, reorder the
production interactive-drop transaction: capture snapshot and focus, unmanage
the dragged client, split the target, establish the target occupant, collapse
the now-empty origin, normalize final topology, then call `manage()` once on
the final target leaf. Re-decode and verify topology, membership, and focus
after each structural mutation and at completion. On a structural failure, do
not retry final manage; use snapshot-backed invariant reconstruction. Use only
existing supported boundary operations. Do not write frame geometry, duplicate
KWin private geometry calculations, or manufacture completion with timers,
polling, or sleeps.

`kwin/contents/code/main.js` is permitted only as deterministic output of
`gate.focused-build`. It is never hand-edited, must match that canonical build,
and is included in the eventual accepted commit with its authored source/test
inputs.

The one user-run retry follows `docs/live-kwin-testing.md`, reproduces the same
output configuration and final drag, and records an unmodified screenshot or
video frame, final leaves, occupant geometries, dragged frame geometry, and
user confirmation that the dragged frame aligns with its final leaf and the
visible gap is absent.

## Evidence Boundary

- The accepted diagnostic checkpoint remains inconclusive for delayed
  realization because no supported later geometry event was connected.
- This correction's source-backed claim is narrower: changed final tile
  association requests KWin's own private final tile geometry exactly once.
- Fixture results prove only tracing, public-route boundaries, state
  observability, and failure-injection capability. They do not prove desired
  production ordering, reconstruction, or native frame realization.
- The live retry is the only acceptance evidence for final dragged-frame/leaf
  alignment and absence of the reported rendered gap.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Gates and literal canonical commands | Expected baseline |
|---|---|---|---|---|---|
| `unit-drag-gap-diagnostic-contract` | Accepted diagnostic capture and static topology contract. | Approved prior plan | Authored historical scope; generated only: `kwin/contents/code/main.js` through `gate.focused-build` | Historical accepted evidence | Accepted; no rerun. |
| `unit-drag-gap-live-evidence` | Accepted initial user-run evidence. | `unit-drag-gap-diagnostic-contract` accepted | Historical user-run observation | Historical accepted evidence | Accepted; initial classification remained inconclusive. |
| `unit-drag-gap-final-manage-fixture-contract` | Independently establish fixture capability and observability before production. | Approved amended plan; accepted diagnostic contract | Direct interactive-drag fixture/scenario/reflow test files only | `gate.focused-reflow-bundle`; `gate.focused-reflow-test`; `gate.final-manage-fixture-review` | 1 suite, 13 tests, 13 passed, 0 failed, 0 skipped; fixture proves tracing, public-route boundaries, recursive observations, and seven injectors without transaction ordering or reconstruction. Independent review has no unresolved serious finding. |
| `unit-drag-gap-fixture-typecheck-fix` | Fix the accepted fixture self-contract's optional `remove` invocation so the production prerequisite typecheck can pass. | Orchestrator-approved dependency defect decision; accepted fixture contract | `kwin/tests/controller-interactive-drag-reflow.test.ts` exact optional call only | `gate.focused-reflow-bundle`; `gate.focused-reflow-test`; `gate.static-typecheck` | Current reflow: 1 suite, 13 tests, 13 passed, 0 failed, 0 skipped; current typecheck: one TS2722 at the exact optional call. Post-change: bundle/typecheck pass and reflow remains 1 suite, 13 tests, 13 passed, 0 failed, 0 skipped. |
| `unit-drag-gap-final-manage-production` | Reorder the live transaction using supported boundary operations only. | Fixture contract accepted and independently reviewed | `kwin/src/controller-interactive-drag.ts`; generated `kwin/contents/code/main.js` only through build | `gate.focused-build`; `gate.focused-reflow-bundle`; `gate.focused-reflow-test`; `gate.static-typecheck` | Build/typecheck and focused reflow suite pass with 1 suite, 15 tests, 15 passed, 0 failed, 0 skipped; source has one final manage and no direct frame write, geometry replication, timer, polling, or retry. |
| `unit-drag-gap-final-manage-integration` | Run focused regression coverage and the sole risk-tier broad static checkpoint. | Production reorder accepted | Focused drag diagnostics/reflow tests and generated build output | `gate.focused-build`; `gate.focused-diagnostics-bundle`; `gate.focused-diagnostics-test`; `gate.focused-reflow-bundle`; `gate.focused-reflow-test`; `gate.static-typecheck`; `gate.broad-tests`; `gate.broad-dogfood-script` | All focused and broad static gates pass; generated output matches the canonical build. |
| `unit-drag-gap-final-manage-live-retry` | Perform the one user-run confirmation on matching topology. | Integration accepted; user runs protocol | User-run KWin/Plasma observation under `docs/live-kwin-testing.md` | `gate.final-manage-live-retry` | Dragged frame aligns with final leaf and the visible gap is absent, with required capture and cleanup evidence. |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Gate Definitions And Baselines

| Gate ID | Type | Literal canonical command or observation | Current baseline | Prerequisites, cleanup, and evidence |
|---|---|---|---|---|
| `gate.focused-build` | Static | `npm --prefix kwin run build` | Baseline: pass, exit 0. Post-change: pass, exit 0 and generated output matches the build. | Deterministic generated `kwin/contents/code/main.js`; never hand-edit it. |
| `gate.focused-diagnostics-bundle` | Static | `npm --prefix kwin exec -- esbuild "kwin/tests/controller-drag-diagnostics-and-resize.test.ts" --bundle --platform=node --format=cjs --target=es2020 --outfile=/tmp/plasma-auto-tiler-drag-diagnostics.test.js` | Baseline: pass, exit 0. Post-change: pass, exit 0. | Repository-root-resolving input; `/tmp` bundle is disposable. |
| `gate.focused-diagnostics-test` | Static | `node --test /tmp/plasma-auto-tiler-drag-diagnostics.test.js` | Baseline: 45 tests, 5 suites, 45 passed, 0 failed, 0 skipped. Post-change: all tests pass, 0 failures. | Run only after the bundle gate passes; capture TAP count and failures. |
| `gate.focused-reflow-bundle` | Static | `npm --prefix kwin exec -- esbuild "kwin/tests/controller-interactive-drag-reflow.test.ts" --bundle --platform=node --format=cjs --target=es2020 --outfile=/tmp/plasma-auto-tiler-drag-reflow.test.js` | Baseline: pass, exit 0. Post-change: pass, exit 0. | Repository-root-resolving input; `/tmp` bundle is disposable. |
| `gate.focused-reflow-test` | Static | `node --test /tmp/plasma-auto-tiler-drag-reflow.test.js` | Baseline: 1 suite, 11 tests, 11 passed, 0 failed, 0 skipped. Post-fixture: 1 suite, 13 tests, 13 passed, 0 failed, 0 skipped. Post-production: 1 suite, 15 tests, 15 passed, 0 failed, 0 skipped. | Exact fixture entrypoint: `kwin/tests/controller-interactive-drag-reflow.test.ts`. Run only after its bundle gate passes; capture TAP count and failures. |
| `gate.final-manage-fixture-review` | Independent review | One independent Worker reviews the fixture-contract diff and its focused evidence before production dispatch. | Baseline: not run. Post-change: one finding set with no unresolved serious finding. | Required after fixture `review-ready`; any finding-fix follows normal correction limits. |
| `gate.static-typecheck` | Static | `npm --prefix kwin run typecheck` | Baseline: pass, exit 0. Post-change: pass, exit 0. | Record exact result. |
| `gate.broad-tests` | Static | `npm --prefix kwin test` | Baseline: 990 tests, 95 suites, 990 passed, 0 failed; secondary 255/0. Post-change: all tests pass, 0 failures. | Run only in `unit-drag-gap-final-manage-integration`. |
| `gate.broad-dogfood-script` | Static | `bash scripts/dogfood-install.test.sh` | Baseline: 347 passed, 0 failed; `/tmp/.../data` missing-path warning. Post-change: pass with the same permitted warning only. | Run only in `unit-drag-gap-final-manage-integration` after `gate.broad-tests` has finished; its install checks invoke the canonical build, which clears `kwin/dist`. No live host mutation. |
| `gate.final-manage-live-retry` | Live | One user-run retry after reading `docs/live-kwin-testing.md`. | Baseline: not run. Post-change: matching topology, dragged frame aligned with final leaf, visible gap absent, required capture and cleanup recorded. | User-run only; no additional retry is authorized. |

The fixture entrypoint baseline was re-established on 2026-08-24: the listed
bundle command and test command pass with 1 suite, 11 tests, and zero failures.
The fixture self-contract adds two top-level tests for a 13-test suite; the
later production regression adds two more for a 15-test suite. Current broad
values replace, rather than guess among, prior conflicting historical totals.

## Fixture/Harness Contract

| Contract evidence | Gate ID | Literal canonical command or observation | Expected baseline | Evidence |
|---|---|---|---|---|
| State ownership | `gate.focused-reflow-test` | `node --test /tmp/plasma-auto-tiler-drag-reflow.test.js` | Post-fixture: 1 suite, 13 tests, 13 passed, 0 failed, 0 skipped. | Harness exposes topology, membership, geometry, focus, and operation traces without claiming controller ordering. |
| Recursive child behavior | `gate.focused-reflow-test` | `node --test /tmp/plasma-auto-tiler-drag-reflow.test.js` | Post-fixture: 1 suite, 13 tests, 13 passed, 0 failed, 0 skipped. | Recursive snapshots and fresh decodes are observable; production later proves target preservation and recursive collapse behavior. |
| Re-decode and snapshot restoration | `gate.focused-reflow-test` | `node --test /tmp/plasma-auto-tiler-drag-reflow.test.js` | Post-fixture: 1 suite, 13 tests, 13 passed, 0 failed, 0 skipped. | Fixture records immutable snapshots and decoded post-failure observations; production later proves reconstruction. |
| Failure injection | `gate.focused-reflow-test` | `node --test /tmp/plasma-auto-tiler-drag-reflow.test.js` | Post-fixture: 1 suite, 13 tests, 13 passed, 0 failed, 0 skipped. | Cover split, unmanage, remove, manage, malformed/no-op topology, duplicate membership, and focus failure with trace markers and recovery-required records only. |
| Public-route constraints | `gate.focused-reflow-test` | `node --test /tmp/plasma-auto-tiler-drag-reflow.test.js` | Post-fixture: 1 suite, 13 tests, 13 passed, 0 failed, 0 skipped. | Drive public interactive start/finish signals and observe their boundary without asserting final-manage order, native frame realization, direct frame write, private geometry replication, timer, polling, sleep, overlay, or COSMIC work. |

## Progress

- [x] `unit-drag-gap-diagnostic-contract` accepted after attempt 01 and correction 01.
- [x] `unit-drag-gap-live-evidence` accepted from user-run evidence at `live-20260824T215510-62409`.
- [x] Initial mechanism checkpoint recorded inconclusive under the former
  no-supported-later-event rule; user and Orchestrator approved the supported
  final-topology-management correction.
- [x] `unit-drag-gap-final-manage-fixture-contract` accepted after attempt 01
  and one independent review with no unresolved serious finding.
- [x] `unit-drag-gap-fixture-typecheck-fix` accepted after attempt 01.
- [ ] `unit-drag-gap-final-manage-production` is parked after attempt 02 moved
  no acceptance criterion and reached the three-dispatch no-progress breaker.
- [ ] `unit-drag-gap-final-manage-integration` blocked on production acceptance.
- [ ] `unit-drag-gap-final-manage-live-retry` blocked on integration acceptance
  and user-run protocol.

## Attempt Accounting

`unit-drag-gap-diagnostic-contract/attempt-01` is accepted after its one
authorized same-scope pre-review correction. The correction added every final
leaf's ID, rectangle, occupancy, and occupant IDs; the deterministic generated
bundle is an approved build-only path. No independent review, reset, or candidate
preservation was dispatched.

| Unit | Implementation attempts | Pre-review corrections | Finding-fix corrections | Independent reviews |
|---|---:|---:|---:|---:|
| `unit-drag-gap-diagnostic-contract` | 1 | 1 | 0 | 0 |
| `unit-drag-gap-final-manage-fixture-contract` | 1 | 0 | 0 | 1 |
| `unit-drag-gap-fixture-typecheck-fix` | 1 | 0 | 0 | 0 |
| `unit-drag-gap-final-manage-production` | 2 | 0 | 0 | 0 |
| `unit-drag-gap-final-manage-integration` | 0 | 0 | 0 | 0 |
| `unit-drag-gap-final-manage-live-retry` | 0 | 0 | 0 | 0 |

### Change-Wide Ledger

| Implementation dispatches | Dispatch-invalids | Pre-review corrections | Finding-fix corrections | Independent reviews | Changed-kind resets | Broad gate runs | Worker tool-call proxy | Lead tool-call proxy | Acceptance criteria moved | No-progress streak |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 1 | 1 | 0 | 1 | 0 | 2 | not reported | not reported | 3 | 3 |

The initial baseline observation and cancelled read-only Lead host attempt are
recorded separately from implementation dispatches and do not consume an
implementation, correction, review, or reset budget.

`unit-drag-gap-final-manage-fixture-contract/attempt-01` was not dispatched:
preflight found that `gate.focused-reflow-test` records the 11-test baseline but
no exact expected post-change count. This is a dispatch-invalid result, not an
implementation attempt, correction, review, or acceptance movement.

The approved repair defines 13 tests after the fixture unit and 15 after the
production unit. The dispatch-invalid history and counters remain unchanged.

`unit-drag-gap-final-manage-fixture-contract/attempt-01` is implementation
accepted: its two allowed files add fixture tracing, snapshot/decode
observability, public-route boundaries, and the seven approved injectors. The
required independent review found no unresolved serious finding, so the fixture
contract is accepted and production is ready for its separately authorized unit.

`unit-drag-gap-final-manage-production/attempt-01` stopped before source work:
`gate.static-typecheck` reports TS2722 at the accepted fixture self-contract's
unguarded optional `fixture.origin.remove()` call. This counted implementation
dispatch moved no criterion; the one-line repair is outside the production
Worker's authorized scope.

`unit-drag-gap-fixture-typecheck-fix/attempt-01` is accepted: the exact optional
call now uses `fixture.origin.remove?.()`. The reflow bundle/test remain at 1
suite, 13 tests, 13 passed, 0 failed, 0 skipped, and typecheck passes. Production
attempt 02 is ready for separate authorization.

`unit-drag-gap-final-manage-production/attempt-02` is rejected and the unit is
parked. Although the canonical build, reflow bundle/test, and typecheck pass,
the production recovery path only re-manages the dragged window at its origin;
it does not reconstruct the pre-mutation topology snapshot or restore focus.
Its seven-row failure regression invokes fixture operations directly rather than
driving the production transaction, so it cannot establish transaction recovery
or a no-final-manage-retry invariant. The attempt moved no acceptance criterion;
the inherited no-progress streak therefore reaches three. No correction,
independent review, broad gate, live action, staging, commit, or further Worker
dispatch is authorized.

## Startup VCS Policy

- Agent commits: allowed.
- Agent pushes: allowed.
- Staging owner: Lead at accepted coherent checkpoints.
- User commit required: no.
- Candidate preservation container: none authorized.
- Manifest and cleanup owner: Lead; remove only approved transient diagnostic
  artifacts at completion.

## Pending User Decisions

- Autonomous mode is active for the remainder of this session. Governance and
  user-owned decisions remain non-delegable; the user-run live retry is parked
  while unavailable.
- Production is parked under the three-dispatch no-progress breaker. Reset
  options for Orchestrator review are to reduce the production acceptance scope,
  replace the snapshot-reconstruction approach, or freeze the accepted
  diagnostic/fixture partial result.

## Acceptance-Criterion Evidence

| Acceptance criterion | Gate ID | Literal canonical command or observation | Expected baseline | Evidence |
|---|---|---|---|---|
| Complete transaction diagnostic at controller-settled | `gate.focused-diagnostics-test` | `node --test /tmp/plasma-auto-tiler-drag-diagnostics.test.js` | 45 tests, 5 suites, 45 passed, 0 failed, 0 skipped | Static assertion of complete `finalLeaves`, client/frame availability limits, target, work area, and ordering. |
| Truthful static boundary | `gate.focused-reflow-test` | `node --test /tmp/plasma-auto-tiler-drag-reflow.test.js` | 11 tests, 1 suite, 11 passed, 0 failed, 0 skipped | Static topology/coverage/occupancy only; no native-render claim. |
| Bounded live evidence | Historical accepted evidence | User-run protocol and captured fields | One matching reproduction or inconclusive | Accepted: `/run/user/1000/plasma-auto-tiler-live/live-20260824T215510-62409`, log lines 59 and 78; user confirms persistent visible gap after moving the left-bottom window beneath the left-top window. |
| Mechanism classification without guesswork | Historical accepted evidence | Approved former decision rules | Inconclusive under the no-supported-later-event rule. | Final leaves partition the work area, while transaction 2 retains `window-2` drag frame geometry after normalization; this is the evidence supporting the approved correction route. |
| Fixture capability and observability | `gate.focused-reflow-test` | `node --test /tmp/plasma-auto-tiler-drag-reflow.test.js` | Post-fixture: 1 suite, 13 tests, 13 passed, 0 failed, 0 skipped. | Implementation accepted: focused bundle passed; focused TAP reported 1 suite, 13 tests, 13 passed, 0 failed, 0 skipped. Lead inspected the two-file diff: public-route boundary, trace/snapshot/decode observations, membership/focus observations, and seven injector records only; no production ordering, reconstruction, retry, or native-frame claim. |
| Fixture-contract independent review | `gate.final-manage-fixture-review` | One independent Worker review before production dispatch | One finding set with no unresolved serious finding. | Accepted: one independent review found no serious finding. It confirmed fixture independence, public-route boundary observation, immutable recursive snapshot/decode and membership/focus observations, isolated seven-injector records, no reconstruction/retry/native-frame claim, and deterministic 13-test isolation. |
| Supported production reorder | `gate.focused-build`; `gate.focused-reflow-test`; `gate.static-typecheck` | Listed canonical static commands | All pass, 0 failures; reflow suite 1/15/15/0/0; one final manage intent and no prohibited route. | Pending. |
| Risk-tier static integration | `gate.broad-tests`; `gate.broad-dogfood-script` | Listed canonical static commands | All pass, 0 failures; permitted dogfood warning only. | Pending; broad gates run only at integration. |
| Live corrected outcome | `gate.final-manage-live-retry` | One user-run matching-topology retry | Dragged frame aligned with final leaf and visible gap absent. | Pending. |

### Parked Foundation Checkpoint

- Rejected production attempt-02 source and its two 15-test production
  regressions were removed without a stash or preservation container. Retained
  authored scope is the accepted diagnostic instrumentation, its diagnostics
  test, the accepted fixture helper, and its two fixture self-contract tests.
- The fixture-only repair restored `term2` and the accepted deferred-collapse
  assertion to the retained reflow declaration; it adds no production behavior
  or assertion. Reflow is again 1 suite, 13 tests, 13 passed, 0 failed, and 0
  skipped.
- Current static evidence: canonical build passed; diagnostics focused TAP is 5
  suites, 45 tests, 45 passed, 0 failed, 0 skipped; typecheck passed; broad TAP
  is 95 suites, 993 tests, 993 passed, 0 failed, 0 skipped; its start-test
  phase reports 255 passed, 0 failed. The dogfood script passed 347, failed 0,
  with only its permitted missing temporary-data warning. `git diff --check`
  and ASCII/link checks pass.
- The first broad run is reconciled as concurrent command-state interference:
  dogfood invokes the canonical build, which clears `kwin/dist` while the broad
  Node runner loads bundles. It is not an acceptance run. Broad gates are now
  sequenced serially; the successful `npm --prefix kwin test` is the recorded
  broad-test evidence. Production and live acceptance criteria remain pending.

## Residual Risks

- A supported later client-geometry event may be unavailable, leaving delayed
  realization unprovable in this checkpoint.
- KWin has no atomic topology rollback; recovery is reconstruction after a
  structural failure and cannot guarantee native tile identity preservation.
- The fixture proves only observability; final-manage behavior is deferred to
  the production regression and native frame realization and rendered absence
  of the gap require the user-run retry.

## Final Outcome

- Diagnostic contract and initial live evidence accepted. The approved
  final-topology-management correction begins with independently accepted and
  independently reviewed fixture coverage.
- The correction implementation is hard-parked. Its rejected candidate was
  removed; accepted diagnostic and fixture foundation evidence is checkpointed
  and retained without claiming the production or live criteria.
