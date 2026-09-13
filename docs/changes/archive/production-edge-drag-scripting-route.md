# Production Edge-Drag Scripting Route

## Outcome

- The production edge-drag share-adjustment route is blocked by KWin's public
  scripting API. It is not shippable and is not on the MVP path as-is.
- Preserved implementation: branch
  `wip/production-edge-drag-scripting-route`, commit
  `5a760a09666c16ef36a70484446c4c6d96d9a1b6`.

## KWin API Limitation

- Public scripting exposes `interactiveMoveResizeStarted`,
  `interactiveMoveResizeStepped`, and parameterless
  `interactiveMoveResizeFinished`, plus `frameGeometry`,
  `frameGeometryChanged`, and `moveResizedChanged` observation.
- It exposes neither a cancellation result for the finished signal nor the
  internal `finishInteractiveMoveResize(cancel)` argument. It also does not
  expose `moveResizeGeometry()` or the drag's initial interactive geometry
  (`initialInteractiveMoveResizeGeometry()`) as `Q_PROPERTY` or `Q_INVOKABLE`.
- `move`, `resize`, stepped geometry, `frameGeometryChanged`, and
  `moveResizedChanged` provide no cancellation result.

## Unsafe Heuristic

- Do not use `frameGeometry == startRect` to infer cancellation. On Wayland,
  cancellation restores the internal move-resize geometry, then emits finish,
  while the client-visible `frameGeometry` updates asynchronously after the
  restore configure is committed. At finish, it can still be the final dragged
  frame, so an Esc-cancelled drag can be committed as a share change.
- A delay does not establish when the restore configure has settled. This is a
  cancellation correctness defect, not merely the benign ambiguity of a
  committed net-zero drag.
- Evidence: KWin 6.7.4 `src/window.cpp:finishInteractiveMoveResize`,
  `src/window.h` Window scripting declarations, and
  `src/xdgshellwindow.cpp:XdgSurfaceWindow::moveResizeInternal`. The upstream
  cancellation test waits for the xdg configure commit before observing the
  restored `frameGeometry`.

## Reusable Work

- The preserved route adds strict `DescribePlan` command shape
  `{ "op": "pointer-resize", "window", "direction", "boundary" }`.
- It wires production Window interactive start/step/finish signals, classifies
  projectable single-edge resizes, and coalesces their latest step into one
  command at finish.
- It uses retained-plan acknowledgement/post-observation fencing and writes
  changed neighbours only. Its step-coalescing approach remains reusable.
- An unsolved own-neighbour geometry echo hazard remains: adapter writes to
  neighbour windows can re-enter the drift reconciler and cause reassertion or
  parking after an otherwise successful drag.

## Open Options

- Native-effect route, where cancellation and move-resize geometry may be
  available through native KWin APIs.
- Accept the Esc-cancellation defect explicitly.
- Use a settle-delay heuristic, knowing it cannot prove configure settlement.
