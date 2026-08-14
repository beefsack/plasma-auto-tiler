# Dwindle Insertion Preflight Plan

## Approved Constraints

- Apply `docs/handover.md` sections 8-10 structural safety rules.
- Do not change reconstruction or inert policy; escalate any need to do so.
- Do not run live KWin/Plasma commands.

## Units

### safe-insertion-regression-01

- Worker tier: `opencode-deepseek-pro`.
- Add regression-first tests that model an inline invalid split mutation and
  demonstrate the pre-change automatic behavior fails the approved criteria.
- Cover drag source retention, fallback ordering, equal-distance ordering, and
  no-candidate floating behavior where practical.
- Evidence: failing test result before implementation and focused test result
  recorded in `log.md`.

### safe-insertion-implementation-02

- Worker tier: `opencode-deepseek-pro`.
- Add the smallest pure candidate-selection and pre-mutation controller
  preflight needed to satisfy the specification.
- Preserve structural-batch and reconstruction constraints.
- Evidence: focused regression results, `npm --prefix kwin run typecheck`, and
  `npm --prefix kwin run build`.

### safe-insertion-static-03

- Worker tier: `opencode-deepseek-pro`.
- Run broader static verification and verify the bundle is reproducible through
  the declared build.
- Evidence: `npm --prefix kwin test` and a clean generated-bundle status after
  rebuilding.

## Live Acceptance Status

- Static and live acceptance complete: the undersized drag now routes through `bailDrag`
  and the regression captures the fixture startup-yield baseline before the
  refusal, requiring the refusal to add no yield.
- The user reported the corrected prescribed live drag test "worked perfectly".
  This is accepted live observational evidence; no live KWin/Plasma command was
  run in this session.

## Acceptance Evidence Map

| Criterion | Evidence |
| --- | --- |
| Drag refusal retains source tile and geometry | Fresh focused drag regression: one restoration, source reassociation, exact geometry, unchanged topology, and no additional yield; user-reported live drag success |
| Intended leaf is preflighted before split | Inline-mutating splitter regression |
| Eligible fallback and equal-distance rule | Planner/controller regression tests |
| No candidate floats only the newcomer | Regression test and topology assertions |
| No mutation-then-recovery path | Inline-mutating splitter regression |
| Unreadable work area remains permissive | Existing or targeted regression coverage |
| Type and bundle integrity | Declared typecheck and build commands |
| Broader static coverage | Declared full test command |

## Residual Risk

- The accepted live observation covers the prescribed corrected drag path;
  alternate live compositor and geometry conditions remain represented by static
  regression coverage rather than separate live observations.

## Pending User Decisions

None.
