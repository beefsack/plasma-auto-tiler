# Plan: Binary Layout Blueprints

Ownership and approval:
- Owner: Lead (`lead-openai`).
- Change class: Standard.
- Status: Completed and archived on 2026-08-11 after autonomous alignment and
  result approval.
- Governing scope: [specification](spec.md).

## Technical Approach

Add a new pure `layout-blueprint.ts` sibling to `logic.ts`, rather than extending
the controller or declaring KWin behavior. It will use the accepted `Result` and
`Rejection` contract from `logic.ts` and define a recursive immutable binary
topology whose leaves carry only a deterministic ordinal. Given a positive
integer leaf count and an explicit orientation, it will split the count into
floor/ceil halves recursively. This proves balanced binary structure, not window
geometry or a runnable KWin layout.

The focused test module will inspect output recursively and establish exact leaf
count, binary shape, per-node balance, orientation propagation, deterministic
ordering, rejection behavior, and immutability. `entry.ts` will not import the
new module, so the generated KWin payload is not changed.

## Work Units

| ID | Status | Objective | Depends on | File or subsystem scope | Invasive? | Verification |
|---|---|---|---|---|---|---|
| unit-01 | Accepted 2026-08-11 | Defined the pure immutable binary blueprint model and deterministic balanced generator. Reused `Result` and `Rejection` from accepted `logic.ts` with the narrow `invalid-leaf-count` union addition. | accepted Custom Tile pure logic | `kwin/src/layout-blueprint.ts`, narrowly `kwin/src/logic.ts` | No | Lead source inspection confirms no KWin/Qt/runtime dependency; typecheck passes. |
| unit-02 | Accepted 2026-08-11 | Added executable structural and rejection vectors. | unit-01 | `kwin/tests/layout-blueprint.test.ts` | No | `npm test` passes 140 tests across 23 suites; recursive vectors establish the specified invariants. |
| unit-03 | Accepted 2026-08-11 | Independently reviewed the bounded source/test changes and recorded static evidence, including the production-payload identity claim. | unit-01, unit-02 | Source/test scope and recorded command evidence | No | Fresh read-only review returned clean at 20/20 calls. Lead reconciled source/test invariants and current SHA-256 `866b594b922e46862c9113c6e0bb7ac601d855df6bd428037787a29d28841422`; Package 2 retained 140 passing tests. |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Pure binary model | Source inspection confirms no ambient KWin/Qt use, imports, or package entry wiring. |
| Balanced deterministic structure | Recursive test helper checks leaf count, binary arity, local floor/ceil balance, ordinal ordering, and orientation. |
| Safe invalid input | Focused vectors assert `Result` rejection for zero, negative, non-finite, and fractional counts. |
| Immutability | Focused vectors retain input values and compare repeated structural results. |
| Static delivery safety | Declared typecheck/build/test commands pass and generated `contents/code/main.js` SHA-256 is identical before and after. |

## Dependencies and Deferrals

- Depends only on accepted Custom Tile pure logic (`kwin/src/logic.ts`) and the
  existing TypeScript test/build toolchain.
- Does not depend on Custom Tile `unit-03`/`unit-05` structural/live acceptance
  or keyboard navigation `unit-02` controller acceptance.
- Application of a blueprint through `CustomTile.split()` is deferred because
  the source-pinned scripting surface does not establish JavaScript collection
  marshalling or geometry/ratio realization.
- Dynamic workspace lifecycle/ownership, stable multi-output identity, native
  visual effects/decorations, keyboard window-management semantics, packaging
  component architecture, and all live automation remain outside this change.

## Residual Risks

- A balanced binary tree is a topology representation only. It must not be
  presented as equal-size columns, rows, or a grid until a separately approved
  execution and geometry contract exists.
- Reusing `Rejection` may require a narrowly scoped shared union addition. If
  that change would broaden existing planning semantics, stop and seek a new
  scope decision rather than forcing reuse.

## Pending User Decisions

- None for the pure static slice. Runtime realization and any preset catalogue
  require separate approval.

## Final Outcome

- All scoped units and acceptance criteria are accepted. The retained evidence
  map records 140/140 passing tests and the byte-identical production IIFE SHA-256
  `866b594b922e46862c9113c6e0bb7ac601d855df6bd428037787a29d28841422`.
- No lasting documentation beyond this archived specification and plan was
  required. The active-change state and checkpoint log were transient and removed.
- Runtime blueprint realization, geometry or ratio behavior, and any layout-preset
  catalogue remain deferred and are not accepted by this change.
