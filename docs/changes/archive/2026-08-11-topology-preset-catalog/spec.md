# Specification: Topology Preset Catalog

Status: completed and archived on 2026-08-11.

## Intent

Provide a pure immutable deterministic catalog that produces compiled binary
topology instructions and stable ordinal leaf mappings for `columns`, `rows`,
and `balanced-grid` presets.

## Scope

- A closed preset-kind catalog and a smallest useful Result-returning API.
- Positive safe-integer count validation with fixed project Result errors.
- Deterministic, non-aliased immutable blueprint/instruction output and focused
  tests.

## Semantics

- `columns` uses KWin `Horizontal` / project `horizontal` at every branch.
- `rows` uses KWin `Vertical` / project `vertical` at every branch.
- `balanced-grid` uses a balanced binary tree, starts `horizontal` at its root,
  and alternates orientation at each depth.
- These describe topology only, never equal geometry or ratios.

## Non-goals

KWin imports or execution, controllers, geometry, ratios, persistence, UI,
configuration, and live testing.

## Acceptance Criteria

1. Singleton output has no splits and maps ordinal zero to the root for every
   preset.
2. Columns and rows use only their specified orientations at counts 2, 3, and 5.
3. Balanced-grid alternates from a horizontal root and remains balanced for
   representative non-power-of-two counts.
4. Every preset compiles to `count - 1` pre-order splits and a complete ordinal
   mapping.
5. Invalid counts and kinds return fixed Result errors; output is deterministic
   and free of mutable shared aliases; existing generator behavior is unchanged.
6. Typecheck, build, and the complete test suite pass.
