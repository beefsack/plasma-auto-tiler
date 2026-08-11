# Specification: Blueprint Split Instructions

Status: completed and archived on 2026-08-11. Change class: Standard.

## Intent

Compile the accepted immutable binary layout blueprint into a pure, deterministic
pre-order split plan that a later KWin executor can perform without reading
mutable tile topology to decide the next split.

## Scope

- Add the smallest pure TypeScript compiler API and focused tests.
- Use topology-derived root/left/right paths, one pre-order instruction per
  branch, and ordinal-ordered final leaf paths.
- Reject malformed blueprint topology through existing project conventions.

## Non-goals

- KWin, CustomTile, controller, entry wiring, geometry, ratios, presets,
  layouts, persistence, or UI.

## Acceptance Criteria

1. A leaf blueprint yields no splits and ordinal 0 at the root path.
2. Every branch yields one pre-order split instruction naming an existing leaf
   path, orientation, and deterministic left/right child paths.
3. Final leaf paths are unique, complete, and ordered by blueprint ordinal.
4. Compilation is deterministic and preserves immutable input and output types
   without leaking mutable construction state.
5. Focused tests cover the above and balanced vertical and horizontal trees.
6. Typecheck, build, and full tests pass. Rebuild the bundle only when the
   production entry graph imports the new compiler.
