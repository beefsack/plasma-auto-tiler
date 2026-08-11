# Plan: Blueprint Split Instructions

Status: completed and archived on 2026-08-11. Governing scope: [specification](spec.md).

## Approach

Add a pure sibling compiler consuming `layout-blueprint.ts`. Its result exposes
pre-order split instructions and ordinal-ordered topology paths; it stays out
of `entry.ts`, so the production bundle should remain unchanged.

## Work Units

| ID | Status | Scope | Verification |
|---|---|---|---|
| unit-01 | Accepted 2026-08-11 | Compiler API, malformed-topology handling, and focused tests. | `npm run typecheck`, `npm run build`, and `npm test` pass; SHA-256 unchanged. |

## Acceptance Evidence

| Criterion | Evidence |
|---|---|
| 1-3 | Exact focused vectors for singleton, pre-order branches, paths, and ordinal mapping. |
| 4 | Repeated-compilation and immutability vectors plus source inspection. |
| 5-6 | Both orientations and full command results, including bundle hash. |

## Pending User Decisions

None.

## Final Outcome

- `compileBlueprintInstructions` emits immutable-by-type pre-order splits and
  ordinal-ordered root/left/right leaf paths from the accepted blueprint only.
- Typecheck and build pass; `npm test` passes 153 tests in 24 suites. The
  production IIFE remains SHA-256
  `513e45d5c13c7eeba5ee4267577be657dc66f59928469e3ab6bb16766741d9da` because
  `entry.ts` does not import the compiler.
