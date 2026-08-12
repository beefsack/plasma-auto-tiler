# Stage 1: Post-Drop Reflow Plan

## Approach

`Tile::manage()` has already moved the dragged window from its origin into the
native drop target when `interactiveMoveResizeFinished` fires. Extend the
existing `completeDrag` finish-only path to recognise that two-window target,
plan a split from the final pointer position, and perform only split/manage
operations in that dispatch. Then reuse `deferRemovalCollapse()` for the empty
origin. Its established one-shot yield leads to the removals-only collapse and
fresh whole-root decode.

The central dead-zone default is vertical: original occupant above, dragged
window below.

## Work Units

| Unit | Scope | Evidence | Status |
| --- | --- | --- | --- |
| unit-01 | Record approved Stage 1 specification and implementation plan. | Reviewed committed documentation. | Complete |
| unit-02 | Add finish-only Shift-overlap planning, split recovery, and deferred origin collapse using existing ownership machinery. | Focused logic and controller tests; typecheck, build, and test commands. | Pending |
| unit-03 | Independently review the implementation diff and verification evidence; commit accepted code. | Review findings and Git commit. | Pending |

## Acceptance Evidence Map

| Criterion | Evidence |
| --- | --- |
| Finish-only detection | Controller test emits `interactiveMoveResizeFinished` after modelling native target management; no stepped handler is added. |
| Position-directed reflow | Logic tests cover directional and central planning; controller test asserts child occupants. |
| Deferred origin collapse | Controller test asserts no removal before the queued yield and the collapsed shape after it. |
| Accepted example | Controller tree-shape test asserts `H[V[term1,term2],term3]`. |
| Static baseline | `npm --prefix kwin run typecheck`; `npm --prefix kwin run build`; `npm --prefix kwin test`; `bash scripts/start-test.test.sh`; `bash scripts/dogfood-install.test.sh`. |

## Risks

- This is static-only validation. Native KWin callback and structural behaviour
  on a live host remain unvalidated.
- The central default is a product choice to revisit after real use.
