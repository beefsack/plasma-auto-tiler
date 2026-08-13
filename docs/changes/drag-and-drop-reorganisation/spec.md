# Stage 1: Post-Drop Reflow

## Intent

Preserve KWin's native Shift custom-tile drag target selection, then resolve its
post-drop overlap into a usable tiled layout without changing tiles during the
interactive drag.

## Scope

- On `interactiveMoveResizeFinished`, detect a native Shift drop whose target
  leaf contains the dragged window and exactly one other managed window.
- Split that target leaf and assign its original occupant and the dragged window
  to the resulting children according to the final pointer position in the
  target geometry.
- Collapse the dragged window's now-empty origin leaf through the existing
  ownership/reconstruction pipeline.
- Add focused unit tests, including the accepted three-window tree-shape
  example.

## Drag Diagnostics

The live host previously delivered zero `plasma-auto-tiler:drag-*` lines of any
kind. That absence is now explained: the attach path was skipped before any
connect (see "Live evidence" below), so "never attached" was the reality, and
"attached but never fires" was never actually observed. Every KWin scripting
API claim below is `documented`; citations are to the
KWin scripting API reference `https://develop.kde.org/docs/plasma/kwin/api/`,
`KWin::Window` -> Signals, unless noted.

### Live evidence: the false `no-interaction-signals` guard

The first live trial (unit-05/attempt-01) proved, before any drag event was
needed, that the attachment path itself was silently inert: **every** in-scope
window was skipped by `no-interaction-signals`, and the startup summary was
`0:0:0`. No `.connect()` was ever attempted. KWin non-delivery of the drag
signals was therefore **never tested**; the earlier "KWin delivers no drag
event" framing in the handover was wrong and is corrected here.

Root cause, source-derived: `isSignal` in `kwin/src/boundary.ts` requires
`isObject(value)`, but QV4 exposes QObject signal properties as **callable
`QObjectMethod` functions**, so `typeof` reads `"function"`, not `"object"`,
and the whole-window guard short-circuited before any per-signal connect.
Qt 6.10 evidence: `qqmlpropertycache.cpp:90-101,468-495` (signal methods load
with `FunctionType`), `qv4qobjectwrapper.cpp:322-323` (`Function.prototype`
gains `connect`/`disconnect`), `:360-367` and `:367-368` (signal access
returns `QObjectMethod::create`), `:1336-1418` (`method_connect` reads the
signal from the `this` object), `:2706-2712` (`QObjectMethod::create`).
Official docs: `https://doc.qt.io/qt-6/qjsengine.html` (QObject Integration)
and `https://doc.qt.io/qt-6/qtqml-syntax-signals.html` (Signal and Handler
Event System). KWin's window binding exposes the per-window signals at
`src/scripting/workspace_wrapper.h:642` and `src/scripting/scripting.cpp:230,713`.

**No pre-check policy:** the `no-interaction-signals` guard is **removed** and
is not replaced by any signal-shape pre-check. Attachment proceeds for every
window that passes the remaining guards; each individual `.connect()` either
succeeds or throws under its own `try/catch`. This is deliberate: only a live
host can decide which signals are reachable, and the per-signal diagnostics
make that decision visible.

### Documented per-window signals

- `interactiveMoveResizeStarted()` - `documented`.
- `interactiveMoveResizeStepped(const QRectF &geometry)` - `documented`.
- `interactiveMoveResizeFinished()` - `documented`.
- `moveResizedChanged()` - `documented`.
- Refuted: the workspace-level `windowStartUserMovedResized` /
  `windowFinishUserMovedResized` hypothesis. Those signals are `EffectWindow`
  signals for effects, not the scripting `Workspace`/`Window` surface
  (`/tmp/opencode/kwin/src/effect/effectwindow.h:687,703,710` at pinned
  v6.7.3). The third slot is `windowStepUserMovedResized`.

### Per-signal attach

- Each per-window signal is connected individually under `try/catch` in the
  attachment boundary.
- Each attempted connect emits exactly
  `plasma-auto-tiler:drag-attach-ok:<signal>` or
  `plasma-auto-tiler:drag-attach-failed:<signal>:<detail>`, where `<detail>`
  is the thrown message plus the observed `typeof` of the signal value.
- A window missing a diagnostic signal is NOT skipped: the individual connect
  fails and is logged, while the structural signals still attach.
- Because QV4 signals are function-valued, the attach path calls `.connect()`
  on the QObjectMethod function directly; no whole-window signal-shape check
  gates it.

### Guard skips

Every remaining guard skip/short-circuit in the attach path logs
`plasma-auto-tiler:drag-attach-skipped:<reason>`:

- `window-list-decode-failed` - the window list failed bounded sequential decode.
- `max-windows` - the interactive-window attachment map is at capacity.
- `not-window` - the value is not a `WindowCapability`.
- `duplicate` - the window is already attached.
- `no-scope` - no output/desktop scope resolves for the window.
- `out-of-scope` - the window is not in the resolved scope.

The `out-of-scope` skip uses exactly the same `scopeForWindow` + `windowInScope`
predicates as the `handleWindowAdded` tiling-eligibility and ownership paths;
this change does not widen scope. The only known timing asymmetry is that
`windowAdded` can be skipped during desktop settling and be re-evaluated later,
while the attach path simply does not attach until a later scope change.

### Startup summary

Exactly one startup existing-window summary is emitted after the initial
attachment pass in `start()`:
`plasma-auto-tiler:drag-attach-summary:<attempted>:<ok>:<failed>`, where
`attempted = ok + failed` aggregates every per-signal connect across every
startup existing window. The first live trial's `0:0:0` summary was the
signature of the removed guard; with the guard gone, a live
`drag-attach-summary` of non-zero size and matching `drag-attach-ok` lines is
the direct evidence that `.connect()` was attempted for every in-scope window.
Later-window (`windowAdded`) and scope-change re-attachments emit no summary, so
startup-existing versus later-window attachment is diagnosable by the presence
or absence of the summary and the per-window attach logs.

### Diagnostic event logs

- `drag-started` at `interactiveMoveResizeStarted` hook entry, before any guard.
- `drag-stepped` at `interactiveMoveResizeStepped`.
- `drag-move-resized-changed` at `moveResizedChanged`.
- These three are diagnostic-only and never mutate tiles. Only
  `interactiveMoveResizeFinished` triggers the existing reflow. There is no
  mid-drag tile mutation.

### Live-proof boundary

Static suites execute the instrumentation but cannot prove KWin delivers any
signal. Live proof is the presence of `drag-attach-*` and `drag-*` lines in the
user's journal, with the startup summary distinguishing an empty attach from a
failed one. A `drag-attach-summary` of `0:0:0` with no per-signal lines would
mean no window passed the guards; non-zero `attempted` with `ok = attempted`
means every per-signal `.connect()` succeeded; failed lines name exactly which
signals threw and their observed `typeof`. Known unknown: Esc-cancellation is
unverified - a cancelled drag's `interactiveMoveResizeFinished` firing and its
effect on the reflow are not established and are out of scope for this stage.

## Non-Goals

- No structural changes during `interactiveMoveResizeStepped`.
- No drag cancellation work, outline/preview rendering, C++ or Rust work,
  stacked/tabbed tiles, or workspace features.

## Constraints

- Reuse the existing reconstruction and ownership pipeline.
- A removal and a split must be in separate phases, with the established
  one-shot event-loop yield between them.
- After a removal, decode the whole root again before resolving any tile.
- Do not edit generated `kwin/contents/code/main.js`.
- No live-host mutation or nested-compositor validation is required for this
  stage.

## Behaviour

- A drop in the upper, lower, left, or right portion of the target creates the
  corresponding split and places the dragged window in that portion.
- A drop in the central dead zone defaults to a vertical split with the original
  occupant above and the dragged window below. This is the initial ergonomic
  default and may be refined from real use.
- Given `Left=term1`, `Right=[Top=term2, Bottom=term3]`, dropping `term2` in
  the lower portion of `Left` produces `Left=[Top=term1, Bottom=term2]` and
  `Right=term3`.

## Acceptance Criteria

1. Native post-drop two-window target overlaps are detected only after
   `interactiveMoveResizeFinished`.
2. The target is reflowed by a position-directed split, not a swap.
3. The vacated origin is collapsed after the required yield, leaving its sibling
   to reclaim the space.
4. The accepted three-window example is asserted as a tree shape by a unit test.
5. Every per-window drag signal attach emits its `drag-attach-ok:<signal>` or
   `drag-attach-failed:<signal>:<detail>` line; every guard skip emits its
   `drag-attach-skipped:<reason>` line.
6. Exactly one `drag-attach-summary:<attempted>:<ok>:<failed>` is emitted after
   the initial attachment pass.
7. `drag-started`, `drag-stepped`, and `drag-move-resized-changed` are logged
   without mutating tiles; only Finished drives reflow.
8. The attach path has no whole-window signal-shape pre-check: function-valued
   signal properties (approximating the QV4 `QObjectMethod` shape) attach
   successfully in a test fixture. The fixture explicitly approximates the
   QJSEngine shape and is not live proof.
9. New tests fail without the implementation and the static verification suite
   passes.

