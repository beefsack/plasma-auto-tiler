# Specification: Blueprint Instruction Executor

Status: completed and archived on 2026-08-11.

## Intent

Realize a compiled `BlueprintInstructions` plan serially through a supplied
CustomTile split seam, returning leaves in compiler ordinal order.

## Scope

- Add the smallest strict executor, production split adapter, and focused tests.
- Validate local path and tile identity state before each split.
- Stop on the first failure and report fixed, non-identifying mutation status.

## Non-goals

- Controller wiring, actions, presets, geometry, ratios, occupants,
  persistence, UI, live KWin work, and rollback.

## Acceptance Criteria

1. Singleton and multi-level plans return ordinal-aligned leaves and issue
   pre-order splits with mapped orientations.
2. Invalid local targets stop before mutation; every split is called once.
3. Throws, malformed returns, aliases, inconsistent paths, and final mapping
   failures stop immediately with a fixed private error code and truthful
   completed-split and mutation-possible status.
4. Inputs remain unmodified and returned leaf collections are readonly.
5. Typecheck, build, and full tests pass; bundle hash is reconciled.
