# Plan: Blueprint Instruction Executor

Status: completed and archived on 2026-08-11. Governing scope:
[specification](spec.md).

## Approach

Use compiled paths and a local path-to-tile mapping only. Keep KWin invocation
behind a small split seam and reuse the existing strict CustomTile boundary
decoder. A failure reports no identities or paths and never continues.

## Work Units

| ID | Status | Scope | Verification |
|---|---|---|---|
| unit-01 | Accepted 2026-08-11 | Executor, adapter, focused tests, build and full suite. | Typecheck, build, tests, bundle SHA-256. |

## Acceptance Evidence

| Criterion | Evidence |
|---|---|
| 1 | Singleton and nested pre-order vectors assert exact call sequence, orientation, and ordinal leaves. |
| 2-3 | Throw, malformed result, child/target/sibling aliases, inconsistent path, and final leaf mapping vectors assert stop and outcome status. |
| 4 | Input clone comparison and frozen readonly leaf-array checks. |
| 5 | `npm run typecheck` and `npm test` pass: 161 tests in 26 suites; build hash matches baseline. |

## Pending User Decisions

None.

## Final Outcome

- `executeBlueprintInstructions` snapshots and validates the compiler topology,
  then realizes it using only local path and identity mappings.
- `customTileSplitSeam` maps horizontal/vertical instructions to KWin layout
  directions and strictly decodes exactly two CustomTile children.
- Failures use `blueprint-execution-failed`, report completed splits and whether
  a seam invocation may have mutated, and never retry or claim rollback.
- The production entry graph remains unchanged. The rebuilt IIFE SHA-256 is
  `513e45d5c13c7eeba5ee4267577be657dc66f59928469e3ab6bb16766741d9da`.
