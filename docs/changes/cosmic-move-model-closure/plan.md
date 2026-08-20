# Plan: COSMIC Move Model Closure

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-20 by Orchestrator on user authorization

## Technical Approach

1. Keep `docs/cosmic-move-conformance.md` as the chained, human-readable
   ground truth. Transcribe the authored S4-S23 sequences exactly as supplied;
   sequence headings are the only boundaries and per-row starts are not
   duplicated in the corpus.
2. Transcribe self-contained test vectors from the authored sequence rows.
   Every test vector declares an explicit start, and a structural assertion
   compares that start with the preceding recorded result within its sequence.
   The assertion reuses the existing tree comparison and is a gate, not an
   exemption mechanism.
3. Keep single-output tree moves in the pure model, correcting R1-R3 and the
   R3 parent-perpendicular continuation. Add a small outer state only for
   output-aware R4 moves, with directional adjacency and one tree per output.
   Existing vectors remain a single-output projection.
4. Extend the test vectors to cover every new observation, including U1 and U2,
   then update the
   corpus prose, backlog wording, and controller-test-split exact baseline.

R3 implementation rule: after insertion into C's parent, only a perpendicular
parent invokes R1 in the same command. A parallel parent ends the command. This
is evidenced by G1 versus F3 sequence 2 and prevents escape from silently
becoming a general recursive re-application loop.

## Approved Reset

- First circuit breaker: `unit-02/attempt-01` stopped before mutation because
  the flat observation vectors encoded P4-02 as a fresh root instead of its
  prior result. The approach was retired.
- Second circuit breaker: three vector derivation attempts culminated in
  `unit-05/attempt-01`, which falsely marked sequential rows as rebuilt-layout
  boundaries. Do not repair or retry any of those artifacts.
- Reset: `unit-06` is approved to transcribe the Orchestrator-authored S4-S23
  sequences without deriving, adjusting, reordering, or declaring additional
  boundaries. It replaces unit-01 and unit-05 output, both discarded to
  `0cf9982` before this reset.
- Existing 40 vectors are left unchanged unless reshaping is clearly mechanical
  and their results are provably unchanged. Their existing passing behavior
  outranks vector-shape consistency.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Verification (static or live) |
|---|---|---|---|---|
| unit-06 | Transcribe authored S4-S23 corpus sequences and isolated test vectors exactly, with explicit starts and a per-sequence continuity assertion. | - | `docs/cosmic-move-conformance.md`, `kwin/tests/move-conformance.test.ts` | Static: `npm --prefix kwin test`; `npm --prefix kwin run typecheck`; every non-first vector start structurally equals the preceding recorded result. |
| unit-02 | Correct the pure single-output move model for R1-R3 and add replay coverage for all applicable new vectors. | unit-06 | `kwin/tests/move-conformance-model.ts`, `kwin/tests/move-conformance.test.ts` | Static: `npm --prefix kwin test`; `npm --prefix kwin run typecheck`. |
| unit-03 | Add output-aware pure-model state and R4 replay coverage for occupied/empty targets, edge eligibility, and workspace isolation. | unit-02 | `kwin/tests/move-conformance-model.ts`, `kwin/tests/move-conformance.test.ts` | Static: `npm --prefix kwin test`; `npm --prefix kwin run typecheck`. |
| unit-04 | Update the corpus explanation, backlog entries, and controller-test-split exact baseline after tests are added. | unit-06, unit-03 | `docs/cosmic-move-conformance.md`, `docs/backlog.md`, `docs/changes/controller-test-split/plan.md` | Static inspection; record measured `npm test` and suite-count result in controller-test-split plan. |

## Proposed Backlog Edits

- Replace line 42 with:
  ```text
  - P3 | open | dependencies: user-run bspwm and Hyprland reference-runtime access | COSMIC directional-move runtime behavior is validated end to end by [cosmic-move-model-closure](changes/cosmic-move-model-closure/); remaining work is to validate actual bspwm and Hyprland runtime behavior with the same corpus-replay methodology rather than source/documentation precedent | [comparison](reference-wm-comparison.md)
  ```
- Replace line 47 with:
  ```text
  - P3 | open | dependencies: N-ary split support and the `controller.ts` split (entries below and above) land first | COSMIC directional-move runtime behavior is validated end to end and ships first behind a strategy seam; any advertised bspwm or Hyprland mode remains gated on equivalent runtime corpus replay; no mode selector appears until at least two models are runtime-validated by this methodology | (not yet scoped)
  ```
- Replace line 48 with:
  ```text
  - P3 | open | dependencies: none | N-ary split container support is an unscoped architectural prerequisite for COSMIC-style movement: ordered direct children, nested groups counted as one direct child, same-axis wrapping, parent escape, and one-child collapse are confirmed requirements; 3+-child operations use child count/order rather than width or screen position, and manual-resize behavior remains unobserved. This project's split logic (`kwin/src/controller.ts`, `kwin/src/logic.ts`) is binary throughout, assessed as a substantial architectural change, not a mechanical generalization; feasibility findings only, no design or scope decided | [research](changes/archive/2026-08-20-cosmic-evidence-mining/research/tile-tree-nary-support.md)
  ```

The lines are exact proposed edits for the future implementation patch; this
planning artifact does not alter the backlog.

## Progress

- [-] unit-01 retired and discarded to `0cf9982`
- [-] unit-05 retired after second circuit-breaker trip
- [x] unit-06 transcribe authored sequences and isolated vectors
- [x] unit-02 correct single-output model
- [ ] unit-03 add multi-output model
- [ ] unit-04 update records and baseline

## Attempt Accounting

| Unit | Attempts | Corrections | Independent reviews |
|---|---|---|---|
| unit-01 | 1 | 1 | 0 |
| unit-06 | 1 | 1 | 0 |

Retired approaches: `unit-01` flat vectors, `unit-02/attempt-01` (no
mutation), and `unit-05/attempt-01` (false rebuilt-layout exemptions). They
are discarded, not corrected. Unit-06 starts a new approved transcription
approach from authored sequences.

## Pending User Decisions

No entries. S18/S19 author U1/U2 as executable sequences.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Existing 40 rows remain unchanged and pass | `docs/cosmic-move-conformance.md` S1-S3 rows; `kwin/tests/move-conformance.test.ts` sequential replay; static `npm --prefix kwin test`. |
| New live corpus is complete | Authored S4-S23 sequences in `docs/cosmic-move-conformance.md`, including the documented vertical-output finding. |
| Isolated vector start agrees with corpus chain | Unit-06 explicit-start vectors and its structural assertion using the existing tree comparison, with S4-S23 headings as the only boundaries. |
| R1-R3 including G1 reconciliation | P1-P5, F1-F3, G1 and existing S2-02/S3-04 corpus replay; model rule assertions. |
| R4 multi-output behavior | M2-M4 and the user-recorded M1 rule statement; output-state assertions for occupied, empty, eligible, and ineligible transfers. |
| No runtime coupling or generated-bundle change | Diff inspection limited to planned test/docs paths; no changed path below `kwin/src/` or `kwin/contents/code/main.js`. |
| Backlog and numeric gate are current | Line-level review of `docs/backlog.md`; measured post-change count recorded in `docs/changes/controller-test-split/plan.md`. |
| Static verification passes | `npm --prefix kwin test`; `npm --prefix kwin run typecheck`. |

## Verification Gate

Before commit, implementation must pass these static commands:

```bash
npm --prefix kwin test
npm --prefix kwin run typecheck
```

The current recorded gate is 879 tests / 79 suites. This change will move that
count; unit-04 must measure and record the new exact baseline in
`docs/changes/controller-test-split/plan.md` because that plan uses the count as
its correctness gate.

## Residual Risks

- Deeper parity descent and post-resize behavior remain intentionally unmodeled
  until observed.
- M1 is a user-stated generalization and M3 is an empty-target observation;
  tests must express only their stated parameters and not invent display
  topology beyond directional adjacency.
- The retired vector derivation approaches are not evidence. Unit-06 may only
  transcribe the authored rows; any inconsistency is an escalation.
- Unit-06 intentionally leaves 11 S4-S19 replay failures against the
  uncorrected model: S5-01, S6-03, S7-02, S9-02, S12-02, S14-03, S17-01
  through S17-04, and S19-02. Unit-02 owns their resolution; all S1-S3 rows
  passed in the same run.

## Final Outcome

- Unit-02 accepted: 915 tests / 80 suites / 915 pass / 0 fail and typecheck
  pass. S20-S23 remain non-replayed pending unit-03.
