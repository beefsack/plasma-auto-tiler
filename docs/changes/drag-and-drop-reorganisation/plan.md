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

The drag attachment boundary attaches each documented per-window signal
individually under `try/catch`, emits per-attempt `drag-attach-ok:<signal>` /
`drag-attach-failed:<signal>:<detail>`, logs every guard skip, and emits exactly
one startup existing-window `drag-attach-summary:<attempted>:<ok>:<failed>`.
Diagnostic-only event logs (`drag-started`, `drag-stepped`,
`drag-move-resized-changed`) prove KWin drag delivery without any mid-drag tile
mutation; only `interactiveMoveResizeFinished` drives reflow.

**No signal-shape pre-check.** The whole-window `no-interaction-signals` guard
is removed and not replaced. Live trial unit-05/attempt-01 proved it was a
false negative: every in-scope window was skipped and the summary was `0:0:0`,
so no `.connect()` was ever attempted and KWin non-delivery was never tested.
Root cause: `isSignal` requires `isObject`, but QV4 exposes QObject signal
properties as callable `QObjectMethod` functions. The attach path now attempts
each `.connect()` directly; per-signal failure lines carry the thrown message
and observed `typeof`.

## Work Units

| Unit | Scope | Evidence | Status |
| --- | --- | --- | --- |
| unit-01 | Record approved Stage 1 specification and implementation plan. | Reviewed committed documentation. | Complete |
| unit-02 | Add finish-only Shift-overlap planning, split recovery, and deferred origin collapse using existing ownership machinery. | Focused logic and controller tests; typecheck, build, and test commands. | Complete |
| unit-03 | Independently review the implementation diff and verification evidence; commit accepted code. | Review found no confirmed defect; static suite passed. | Complete |
| unit-04 | Add per-signal drag attach diagnostics, guard-skip logs, startup summary, and diagnostic event logs for started/stepped/moveResizedChanged. | Focused controller and artifact-smoke tests; typecheck, build, and test commands. | Stable |
| unit-05 | Remove the live-proven false `no-interaction-signals` guard without a replacement pre-check; keep per-signal try/catch diagnostics; add QV4-shape-fidelity regression tests and direct `max-windows` / `window-list-decode-failed` coverage; correct the three change artifacts. | Controller tests assert function-valued signal attachment (explicitly an approximation, not live proof), per-signal failure detail, and direct guard coverage; full static baseline. | Stable |

## Acceptance Evidence Map

| Criterion | Evidence |
| --- | --- |
| Finish-only detection | Controller test emits `interactiveMoveResizeFinished` after modelling native target management; no stepped handler mutates tiles. |
| Position-directed reflow | Logic tests cover directional and central planning; controller test asserts child occupants. |
| Deferred origin collapse | Controller test asserts no removal before the queued yield and the collapsed shape after it. |
| Accepted example | Controller tree-shape test asserts `H[V[term1,term2],term3]`. |
| No signal-shape pre-check | Controller test attaches a window whose signals are function-valued through a non-enumerable getter/prototype (approximating QV4 `QObjectMethod`), asserting `drag-attach-summary:6:6:0` and no `drag-attach-failed`; test name and comment state it approximates the QJSEngine shape and is not live proof. |
| Per-signal attach logs | Controller tests assert `drag-attach-skipped:<reason>` for each remaining guard (`out-of-scope`, `no-scope`, `not-window`, `duplicate`, `window-list-decode-failed`, `max-windows`) and a per-signal failure (`drag-attach-summary:6:5:1`) that skips no window. `no-interaction-signals` is asserted absent. |
| Startup summary | Controller test asserts exactly one `drag-attach-summary:12:12:0` across startup and scope-change passes; artifact-smoke executes the shipped bundle and asserts `drag-attach-summary:6:6:0` plus `drag-attach-ok:<signal>` lines against function-valued stub signals. |
| Diagnostic event logs | Controller test emits stepped/moveResizedChanged/started and asserts `drag-started`, `drag-stepped`, `drag-move-resized-changed` with unchanged tree shape. |
| Static baseline | `npm --prefix kwin run typecheck`; `npm --prefix kwin run build`; `npm --prefix kwin test`; `bash scripts/start-test.test.sh`; `bash scripts/dogfood-install.test.sh`. |

## Risks

- This is static-only validation. Native KWin callback and structural behaviour
  on a live host remain unvalidated. The diagnostics make the next live test
  decisive, but only the user's journal (`journalctl --user -f`) proves which
  signals KWin delivers: attach lines distinguish never-attached from
  attached-but-silent. The previous `no-interaction-signals` false negative is
  fixed, so the next live summary must be non-zero if any in-scope window
  exists; KWin non-delivery of drag signals was never tested and remains the
  open question.
- The function-valued QV4-shape test is a Node approximation of the QJSEngine
  shape, not live proof that KWin exposes these signals; it guards against a
  regression of the removed pre-check only.
- Esc-cancellation is a known unknown: whether a cancelled drag fires
  `interactiveMoveResizeFinished` and what that means for the reflow is
  unverified and out of scope for this stage.
- The central default is a product choice to revisit after real use.
