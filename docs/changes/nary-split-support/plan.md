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

- [ ] unit-01 Pending new-window insertion sizing decision.
- [ ] unit-02 Binary characterization.
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

## Pending User Decisions

- New-window insertion sizing in `spec.md#user-decisions` is the only pending
  user decision. It blocks unit-01 and therefore implementation.
- Resolved 2026-08-21: after two failed `native-evidence-phase-2` attempts,
  the circuit breaker tripped. The Orchestrator froze that live-probe path and
  the user selected an isolation-first reset with E4 parked as source-only
  evidence. No third attempt is authorized.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
| --- | --- |
| Ordered direct children and deterministic malformed-list handling | unit-03 and unit-04 focused structural tests. |
| Same-axis wrapping, parent escape, collapse, and geometry independence | Independent synthetic N-ary structural tests in units 07 through 09. |
| Inventory coupling removed or made N-ary-safe | unit-09 audit against `research/binary-coupling.md`. |
| 13 test files and shared fixture covered | unit-09 test-surface audit. |
| Binary-only layouts remain byte-identical | unit-02 fixtures compare existing native serialization and window assignments, then rerun in units 03 through 09. |
| Complete test, typecheck, and dogfood gates | unit-09 command results. |

## Residual Risks

- Native result cardinality and whether a native 3+-child container survives
  restart or manual native edits remain unestablished. The separately scoped
  evidence unit gates unit-04; its outcome may redesign the adapter only.
- The project model's semantic authority is session-scoped until that evidence
  resolves restart and manual-native-edit behavior.
- The native-binding evidence unit is blocked: attempt-02 observed a host
  `kwinrc` SHA-256 change and hard-stopped; its strict loader parser also
  rejected an `i 0` reply before the probe could run. Its two attempts tripped
  the circuit breaker. The path is frozen pending the user-selected
  isolation-first reset; E4 is parked as source-only evidence.
- The controller is 9,191 lines and the inventory spans 24 functions and 13
  test files; narrow units reduce but do not eliminate regression risk.

## Final Outcome

- Pending approval and implementation.
