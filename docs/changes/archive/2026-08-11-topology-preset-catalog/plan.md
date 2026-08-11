# Plan: Topology Preset Catalog

Status: completed and archived on 2026-08-11.

## Approach

Add a pure catalog sibling to the accepted blueprint compiler. Reuse the
balanced split shape and compiler, adding only the narrow generator capability
needed to alternate orientation by depth while preserving `buildBlueprint`.

## Work Units

| ID | Status | Scope | Verification |
|---|---|---|---|
| unit-01 | Accepted 2026-08-11 | Catalog API, minimal pure topology support, focused tests, and static checks. | Targeted vectors; `npm run typecheck`, `npm run build`, `npm test`; bundle hash. |

## Acceptance Evidence

| Criterion | Evidence |
|---|---|
| 1-4 | Focused catalog tests inspect singleton paths, orientations, balance, pre-order splits, and ordinals. |
| 5 | Invalid-input, repeated-result, and alias-isolation vectors; existing blueprint tests remain green. |
| 6 | Current toolchain command results and generated bundle SHA-256. |

## Pending User Decisions

None.

## Residual Risk

The catalog describes topology only; a future realization may not infer equal
geometry for non-power-of-two counts.

## Final Outcome

- `buildPreset` returns fresh compiled instructions and ordinal leaf paths for
  the closed `columns`, `rows`, and `balanced-grid` catalog. Columns are
  horizontal, rows are vertical, and balanced-grid starts horizontal and
  alternates by depth while preserving the accepted balanced shape.
- Typecheck and build pass. The complete suite reports 246 passing tests in 35
  suites; the generated IIFE remains SHA-256
  `513e45d5c13c7eeba5ee4267577be657dc66f59928469e3ab6bb16766741d9da`.
