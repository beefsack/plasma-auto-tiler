# Specification: Controller Source Split

## Status

Approved Expanded change. This is a behavior-equivalent source decomposition of
`kwin/src/controller.ts`, currently 9,348 lines. `controller.ts` remains the sole
public facade and composition root. There are no public API changes and no
compatibility shim.

## Scope

- Split controller internals into cohesive modules without changing product
  behavior, generated behavior, or public shortcut/config semantics.
- Preserve workspace, resize, drag, recovery, float/sticky/maximize/fullscreen,
  layout execution, insertion, and adapter semantics.
- Use only narrow, explicit internal capability/state contracts between domains.
  Domains may use substrate helpers and types, but extracted domains must not
  import each other at runtime.
- Keep shortcut registration callbacks in `controller.ts` while textual test
  constraints require them to remain there, unless separate evidence approves a
  change.

## Non-Goals and Constraints

- No product behavior, geometry, N-ary semantics, group outline, spacing,
  borders, COSMIC changes, or generated-bundle hand edits.
- Do not remove, skip, weaken, or relocate tests. Test-file moves are out of
  scope. Live testing is out of scope.
- Do not introduce a generic god object, service locator, mutable bag, broad
  controller import surface, or a dumping-ground `controller-types` module.
- Do not split artificially or add one-use abstractions. Module line counts are
  cohesion targets, not acceptance criteria. Any module materially over about
  1,000 lines must be justified in `plan.md`.
- Preserve callback identity and lifetimes, signal registration and
  disconnection, deferred ordering and cancellation, and mutation flush timing.
- Preserve exactly one production `flashFocusedGroup()` call site and exactly
  one structural-mutation reporting/flush path.

## Acceptance Criteria

- `controller.ts` is the only public facade and composition root; public exports,
  shortcut/config behavior, and runtime behavior remain equivalent.
- Extracted domains communicate through narrow explicit capabilities/state
  contracts and have no runtime imports between extracted domains.
- Callback, signal, deferred-work, cancellation, and structural-flush identity
  and lifetime invariants are evidenced by static inspection and tests.
- Existing tests are retained and pass with no removal, skip, or weakening;
  typecheck remains clean and the dogfood suite remains green.
- Generated `kwin/contents/code/main.js` is regenerated normally after source
  changes. Byte or ordering differences are allowed only when behavior is
  preserved.
- Baseline remains 965 tests / 91 suites / 0 failures, clean typecheck, and
  dogfood 347/0. No live KWin operations are performed or claimed.

## Relevant Paths

`kwin/src/controller.ts`, `kwin/src/entry.ts`, `kwin/src/boundary.ts`,
`kwin/src/custom-tile-split.ts`, `kwin/src/logic.ts`,
`kwin/src/layout-blueprint.ts`, `kwin/src/layout-executor.ts`,
`kwin/src/layout-instructions.ts`, `kwin/src/preset-catalog.ts`,
`kwin/src/topology-reset.ts`, `kwin/tests/*.test.ts`,
`kwin/tests/controller-fixtures.ts`, `kwin/tests/controller-fixture-scenarios.ts`,
`kwin/package.json`, `kwin/tsconfig.json`, `kwin/tsconfig.test.json`,
`kwin/contents/code/main.js`.

## Governance

The seven semantic units in `plan.md` are the approved sequence. A unit may be
subdivided before implementation only to keep one Worker bounded. Any semantic
plan change requires Orchestrator approval. Independent reviews occur after
shared-context introduction, lifecycle/drag extraction, and the final facade;
there is at most one independent review per semantic unit.
