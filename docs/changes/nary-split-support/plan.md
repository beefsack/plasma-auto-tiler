# Plan: N-ary split container support

Ownership and approval:

- Owner: Lead
- Status: Ready for Orchestrator approval after new-window insertion sizing resolves

## Baseline Gate

Verified on 2026-08-21 before planning, from `main` at `ad18cc9`:

- `npm --prefix kwin test` - 924 tests, 81 suites, 0 failures, 81 describes.
- `npm --prefix kwin run typecheck` - clean for `tsconfig.json` and
  `tsconfig.test.json`.
- `bash scripts/dogfood-install.test.sh` - 336 assertions, 0 failures.

Every implementation unit starts only while this baseline is reproducible or a
documented accepted change explains its replacement.

## Pre-start Resize Characterization

- Accepted 2026-08-21: `resizeActiveWindow` container-edge behavior is pinned
  in `kwin/tests/controller-drag-diagnostics-and-resize.test.ts` before any
  migration unit starts. The cases cover outward and inward mode-mapped climbs
  that resize the outer container by 5% of its extent, plus outermost refusal
  with no write.
- Static verification after the added tests: `npm --prefix kwin test` - 927
  tests, 87 suites, 0 failures; `npm --prefix kwin run typecheck` - clean for
  both tsconfigs.

## Technical Approach

After the remaining new-window insertion sizing decision and approval, migrate
the project contract from binary child roles to a project-owned ordered
direct-child model. Establish
binary characterization evidence against existing native serialization and
window assignments before changing it, then apply the contract in narrow
operation groups: core logic, native boundary and order, preset reconstruction,
resize, drag, keyboard insertion, automatic/dwindle insertion, and reflow.
Every order-sensitive site consumes the same canonical model order; no site
retains a geometry sort or raw native traversal. A separately scoped
native-binding evidence unit gates native-boundary work: its result may redesign
the adapter but not the project semantic model. Each group carries its focused
tests; the final gate reruns the complete static suite and dogfood installer
test. The conformance model remains reference documentation only. Structural
tests construct independent synthetic N-ary fixtures for ordered direct
children, same-axis wrapping, parent escape, one-child collapse, and existing
binary behavior.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification |
| --- | --- | --- | --- | --- |
| unit-01 | Record the seven settled decisions, including the joint ordered-child/native-boundary contract and reference-only conformance model, and resolve the remaining new-window-insertion-sizing decision before freezing the contracts. | Baseline gate | Approved spec and this plan | Decision record matches the approved spec; static document-link inspection. |
| unit-02 | Add binary characterization fixtures that serialize ordered layouts and window assignments before topology migration. | unit-01 | `kwin/tests/logic.test.ts`, controller fixture/test seams | Focused characterization cases, then `npm --prefix kwin test` (static). |
| unit-03 | Generalize logic-layer split planning and equality contracts from pair roles to the approved ordered-child contract. | unit-02 | `kwin/src/logic.ts`, `kwin/tests/logic.test.ts` | N-ary structural cases plus existing logic tests; `npm --prefix kwin run typecheck` (static). |
| unit-04 | Generalize the pinned native adapter and canonical project-model order without claiming an unproven native result cardinality. A separately scoped native-binding evidence unit gates this work. | unit-01, unit-03, native-binding evidence | `kwin/src/boundary.ts`, split adapter/executor seams, controller child-order helpers, related tests | Boundary cardinality and ordered-child tests prove every listed order-sensitive site consumes canonical model order; `npm --prefix kwin test` and typecheck (static). |
| unit-05 | Migrate preset collection, pathing, rebuild, overlay validation, and invariant shape checks to ordered direct children. | unit-04 | Controller preset/overlay functions; pure-config, selected-overlay, keyboard-move tests | Focused preset and overlay tests, binary serialization comparison, complete test suite (static). |
| unit-06 | Implement the approved N-ary resize, minimum-size, and ratio/weight semantics. | unit-01, unit-04 | Controller resize/minimum functions; resize diagnostics tests | 2-child regression and approved 3+-child resize cases; typecheck and complete test suite (static). |
| unit-07 | Generalize drag target selection, split application, and reflow normalization for N-ary direct children. | unit-03, unit-04 | Controller drag/reflow functions; interactive drag, diagnostics, overlay-reflow tests | Same-axis wrapping, order-only 3+-child cases, binary characterization checks, complete suite (static). |
| unit-08 | Generalize keyboard insertion and automatic/dwindle insertion to the approved N-ary construction contract. | unit-03, unit-04 | Controller keyboard and dwindle functions; keyboard-placement, automatic-dwindle, deferred-recovery tests | Parent escape/one-child collapse structural cases, existing binary cases, typecheck and complete suite (static). |
| unit-09 | Close the inventory sweep, add independent synthetic N-ary structural coverage, and run final regression gates. | unit-05, unit-06, unit-07, unit-08 | All 13 identified test files and shared fixture | Inventory-to-test audit; `npm --prefix kwin test`, typecheck, and `bash scripts/dogfood-install.test.sh` (all static). |

## Progress

- [x] unit-01 Decision record and contracts frozen.
- [x] unit-02 Binary characterization.
- [ ] unit-03 Logic contract migration.
- [ ] unit-04 Native boundary and ordering.
- [ ] unit-05 Preset and overlay reconstruction.
- [ ] unit-06 Resize and minimum semantics.
- [ ] unit-07 Drag and reflow migration.
- [ ] unit-08 Keyboard and automatic insertion migration.
- [ ] unit-09 Inventory closure and final gates.

## Attempt Accounting

No implementation units have started. Counts will be recorded by stable unit ID
once any count exceeds 1. A third attempt, a second correction round, a second
independent review, or a repeated failure class with no acceptance progress
trips the circuit breaker and requires escalation with a loop report.

| Unit | Attempts | Corrections | Independent reviews |
| --- | --- | --- | --- |
| native-evidence-phase-2 | 2 | 0 | 0 |
| unit-03b (E4 read-only host probe) | 3 (final) | 0 | 0 |

- `unit-03b/attempt-01` and `attempt-02` stopped in bespoke harness setup
  before a D-Bus load call. The user-approved reset removed that harness.
- `unit-03b/attempt-03` loaded signed ID `1` directly on the host, ran the
  read-only probe, found its sentinel, unloaded successfully, and left the host
  `kwinrc` SHA-256 and mtime unchanged. It establishes only the scoped
  read-only E4 facts in `research/native-binding-evidence.md`; `split()` was
  intentionally not called and remains unproven.

## Pending User Decisions

None.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
| --- | --- |
| Seven settled decisions and frozen contracts | unit-01 approved record in `spec.md#user-decisions`, promoted replay vectors in `research/cosmic-insertion-findings.md`, and static citation inspection. |
| Ordered direct children and deterministic malformed-list handling | unit-03 and unit-04 focused structural tests. |
| Same-axis wrapping, parent escape, collapse, and geometry independence | Independent synthetic N-ary structural tests in units 07 through 09. |
| Inventory coupling removed or made N-ary-safe | unit-09 audit against `research/binary-coupling.md`. |
| 13 test files and shared fixture covered | unit-09 test-surface audit. |
| Binary-only layouts remain byte-identical | unit-02 fixtures compare existing native serialization and window assignments, then rerun in units 03 through 09. |
| Complete test, typecheck, and dogfood gates | unit-09 command results. |
| unit-02 binary "before" characterization baseline | `serializeTileTree` helper in `kwin/tests/controller-fixture-scenarios.ts`; two pinned-golden tests driving the real controller through a dwindle chain and a preset-shortcut insertion in `kwin/tests/nary-characterization.test.ts`; `npm --prefix kwin test`: 942 tests, 90 suites, 0 fail (up from the 940/89/0 baseline); typecheck clean on both tsconfigs. |

## Residual Risks

- Native result cardinality and whether a native 3+-child container survives
  restart or manual native edits remain unestablished. The separately scoped
  evidence unit gates unit-04; its outcome may redesign the adapter only.
- The project model's semantic authority is session-scoped until that evidence
  resolves restart and manual-native-edit behavior.
- The nested native-binding evidence path remains blocked and frozen: attempt-02
  observed a host `kwinrc` SHA-256 change and its strict loader parser rejected
  an `i 0` reply before the probe ran. The direct read-only host reset produced
  only scoped `tiles` marshalling facts, not native result cardinality.
- `unit-03b/attempt-03` is final. The adapter must not require a JavaScript
  array or two children; it may use defensive indexed/iterable enumeration for
  the observed host binding. `split()` return shape remains unproven and parked.
- The controller is 9,191 lines and the inventory spans 24 functions and 13
  test files; narrow units reduce but do not eliminate regression risk.

## Final Outcome

- `unit-03b/attempt-03` completed as the final E4 read-only host probe. Its
  scoped facts are recorded in `research/native-binding-evidence.md`; no
  `split()` fact was sought or obtained.
