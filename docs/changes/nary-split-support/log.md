# Log: N-ary split container support

Append-only checkpoint log. Each entry records timestamp, role and work unit,
result, changed files or commit, verification, and discoveries or decisions.

## 2026-08-21

- Role / unit: Lead / scoping / attempt-01
- Result: Binary-coupling research accepted and checkpointed.
- Files / commit: `research/binary-coupling.md`; `46c7de0`
- Verification: 119 lines; 2 structural-binary types, 24 direct functions, and
  13 affected test files recorded with citations.
- Notes: Native split-result cardinality, proportion model, N-ary resize,
  normalization, ordered-child source, migration shape, and oracle role remain
  pending decisions.

## 2026-08-21

- Role / unit: Lead / baseline / attempt-01
- Result: Required baseline verified before planning.
- Files / commit: No production or test files changed.
- Verification: 924 tests / 81 suites / 0 failures; both tsconfigs clean; 336
  dogfood assertions / 0 failures; `main == origin/main == ad18cc9` before the
  research commit.
- Notes: The only pre-existing untracked paths are `CMakeFiles/`, `test-output`,
  and `Project Technical Report and Implementation Plan.md`.

## 2026-08-21

- Role / unit: Lead / scoping / attempt-02
- Result: Specification and implementation plan prepared for approval.
- Files / commit: `spec.md`, `plan.md`, `log.md`
- Verification: Plan contains nine stable work-unit IDs, per-unit verification,
  baseline gate, acceptance-evidence map, and circuit-breaker accounting.
- Notes: Pending user decisions block implementation; no file under `kwin/` was
  modified.

## 2026-08-21

- Role / unit: Lead / COSMIC sizing procedure / attempt-01
- Result: Accepted three isolated, manually resized sizing vectors for R2b,
  R2c, and R3; R1 is explicitly excluded because the stated hypotheses all
  predict a two-way half split.
- Files / commit: `research/cosmic-sizing-procedure.md`; uncommitted.
- Verification: Lead reread the procedure and confirmed each vector's
  H-equalize, H-preserve, and H-local predictions differ at coarse scale;
  `git diff --check` passed.
- Notes: This is a hand-executable research procedure only. No live COSMIC
  test was run and no file under `kwin/` was modified.

## 2026-08-21

- Role / unit: Lead / R2b target-axis coverage / attempt-01
- Result: Investigation accepted and checkpointed; the closed parity-only R2b
  wording contradicts two parallel-target corpus cases, both of which agree
  with the new live observation.
- Files / commit: `research/r2b-axis-coverage.md`; uncommitted.
- Verification: Three serial Worker investigations reconciled against direct
  Lead inspection of `S1-17`, `S7-02`, and the model's target-axis branch.
- Notes: `S1-17` remains a model-derived direction correction awaiting user
  confirmation. No file under `kwin/` was modified.

## 2026-08-21

- Role / unit: Worker / nary-split-support documentation and comments
- Result: Corrected R2b target-axis prose; recorded observed sizing and
  insertion findings; updated the perpendicular-branch corpus comment.
- Files / commit: `docs/cosmic-move-conformance.md`,
  `docs/changes/nary-split-support/research/cosmic-insertion-findings.md`,
  `kwin/tests/move-conformance-model.ts`, `log.md`; uncommitted.
- Verification: `npm --prefix kwin test` passed: 924 tests / 87 suites / 0
  failures. `npm --prefix kwin run typecheck` passed with both tsconfigs clean.
- Notes: No authored vectors, model executable code, or `main.js` changed.

## 2026-08-21

- Role / unit: Lead / unit-01 / attempt-01
- Result: Reconciled six settled decisions into the specification and aligned
  the plan's semantic sections. The conformance-model oracle role remains open.
- Files / commit: `spec.md`, `plan.md`, `log.md`; uncommitted.
- Verification: Confirmed the COSMIC corpus's S1-S4 sizing rules determine the
  insertion-normalization contract and cite R2b's target-axis precondition.
  `npm --prefix kwin run typecheck` passed for both tsconfigs; `npm --prefix
  kwin test` passed: 924 tests / 87 suites / 0 failures.
- Notes: The project-owned ordered N-ary model is authoritative for session
  semantics; a separately scoped native-binding evidence unit gates unit-04.
  The adapter, not the semantic model, changes if its candidate native contract
  is disproved. No file under `kwin/` was modified.

## 2026-08-21

- Role / unit: Lead / unit-01 / correction-01
- Result: Restricted the settled insertion-normalization rule to directional
  move-insertion and recorded new-window insertion sizing as open.
- Files / commit: `spec.md`, `plan.md`, `log.md`; uncommitted.
- Verification: Confirmed the new-window findings are unpromoted research with
  no replay vectors and do not add behavior to the movement rules.
- Notes: S1-S4 govern existing-window directional move-insertion only; they do
  not establish new-window insertion sizing. No file under `kwin/` was modified.
