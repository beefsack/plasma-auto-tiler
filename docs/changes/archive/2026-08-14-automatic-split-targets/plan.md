# Plan: Automatic Split Targets

## Approach

Introduce the setting and normalize it at the existing startup configuration
seam. Add a pure target-selection operation that receives current automatic
split intent and eligible occupied leaves, then use it only in the automatic
tiling controller path. Preserve existing orientation and topology operations.

## Work Units

| Unit | Scope | Status | Verification |
|---|---|---|---|
| `split-target-config-01` | Existing settings schema/UI, startup parser/config seam, focused parser/static tests | Accepted after Lead reconciliation | Focused parser/schema/UI tests and typecheck |
| `split-target-selection-02` | Pure automatic split target selection and focused tests | Accepted after Lead reconciliation | Focused selection tests and typecheck |
| `split-target-controller-03` | Automatic tiling controller integration and focused tests | Accepted after Lead reconciliation | Focused controller tests and typecheck |
| `split-target-static-04` | Static completion across the approved change scope | Accepted after independent review | Focused split-target/parser checks, typecheck, reproducible build, full test, package shell test, and diff check |

## Constraints

- `automaticSplitTarget` accepts `dwindle`, `largest`, and `active`; default
  and fallback value is `dwindle`.
- Missing, empty, and invalid values normalize to `dwindle`; only invalid
  non-empty input emits the existing invalid-setting diagnostic.
- Selection targets exactly one occupied leaf and preserves orientation.
- Unsplittable intent uses nearest stable `compareLeaves` ordinal, with earlier
  ordinal on equal distance.
- Active unavailable, ineligible, or scope-mismatched intent falls back to
  `dwindle`; largest-area ties use earlier order.
- No target keeps the newcomer floating and leaves topology unchanged.
- Ancestor resizing, hot apply, drag, keyboard, and new orientations are out
  of scope.

## Acceptance Evidence Map

| Criterion | Evidence | Status |
|---|---|---|
| Schema/UI enum and default | Lead diff inspection; bundle schema/UI assertions; independent full test | Accepted (`split-target-config-01`, `split-target-static-04`) |
| Parser normalization and diagnostics | Focused parser tests and independent full test | Accepted (`split-target-config-01`, `split-target-static-04`) |
| Pure selection semantics | Focused selector tests cover all strategies, area tie, active eligibility and foreign-scope fallback; independent full test | Accepted (`split-target-selection-02`, `split-target-static-04`) |
| Automatic controller integration | Focused insertion tests cover default, largest, active, selected-intent fallback, and no-target floating; independent full test | Accepted (`split-target-controller-03`, `split-target-static-04`) |
| Static and type safety | Independent review: `npm --prefix kwin run typecheck`, reproducible build with stable SHA-256 `eb78ab9d14fbfb8a1c19f5f63a4e763b8417254377e8b024d91236c542043d64`, `npm --prefix kwin test` (758 pass, 0 fail; package shell test 271 pass, 0 fail), and `git diff --check` | Accepted (`split-target-static-04`) |

## Pending User Decisions

- None.

## Risks

- No live KWin/Plasma session verification was run; static and package-level
  checks cover the change, while runtime interaction remains residual risk.

## Process Notes

- Earlier implementation Worker attempts exceeded the user-imposed 20-call
  maximum and were excluded as acceptance evidence. The retained diffs were
  accepted only after Lead reconciliation and current checks.
- The final independent review, `split-target-static-04/attempt-01`, returned
  at 16 own calls within the user-imposed limit.

## Final Outcome

- All acceptance criteria are accepted. No pending user decisions or
  acceptance gaps remain.
