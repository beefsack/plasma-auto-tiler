# Production Resize Reconciliation

## Goal

- Stop same-membership geometry changes from silently replacing the production
  tiling baseline while preserving COSMIC allocation authority and the existing
  single-flight and fresh-observation fences.

## Evidence

- The production `DescribePlan` adapter records same-membership geometry drift
  as `lastGood` and sends no command.
- The isolated pointer-resize adapter cannot be wired directly: its backend
  `DescribePointerResize` route was removed and it requires exclusive authority
  plus interactive start/step/finish signals that production does not consume.
- Production's lone `moveResizedChanged` signal cannot distinguish a user edge
  drag, a client self-resize, or an adapter geometry-write echo.

## Accepted Scope

- Add the strict `{ "op": "reconcile" }` `DescribePlan` command. The retained
  Rust session projects its approved topology and allocation; it does not
  derive a new layout from client-drifted rectangles.
- Reconcile only same-scope geometry drift. Fresh membership, output, workspace,
  or domain changes remain normal baseline/admit/remove handling. Focus-only and
  fingerprint-only changes do not allow drifted geometry to become `lastGood`.
- Reassert the retained allocation at most three terminal reconcile attempts,
  then park that scope. Planned apply, rejection, timeout, service fault, stale
  result, and geometry-write failure all consume an attempt. Parking makes later
  repeated geometry signals no-ops: it neither adopts the client rectangle nor
  changes sibling shares.
- The exact three-attempt threshold is an explicit KWin policy, not a COSMIC
  constant. KWin has no verified post-write acknowledgement for constrained
  `frameGeometry` requests, so the policy bounds visible retries rather than
  claiming convergence.

## Interactive Edge Drag

- Production consumes each tiled Window's public interactive
  start/step/finish signals. A start classified as resize, followed by a
  projectable single-edge step, is an edge drag. Its latest step is coalesced
  into one `DescribePlan` pointer-resize command on finish.
- The retained Rust session derives the affected split shares from that proposed
  boundary, commits its accepted allocation through the existing acknowledgement
  and post-observation fences, and KWin writes changed neighbours only. The
  native-driven source window is not rewritten.
- While an interactive resize is active, its geometry signals do not enter the
  drift reconciler. The accepted pointer plan becomes the new baseline before
  later geometry signals are handled. A move gesture, invalid/mixed step,
  cancellation, adapter write echo, or client self-resize is not a pointer
  resize command; ordinary self-resize drift retains the bounded three-attempt
  reconcile and parking policy above.
- This production route is authorized without changing the global
  `engineAuthorityMode=legacy` default.

## Blocker

- Do not ship the current uncommitted production pointer route. KWin 6.7.4's
  public scripting `interactiveMoveResizeFinished` signal is parameterless,
  and no exposed property reports whether the interaction was cancelled.
- KWin's internal `finishInteractiveMoveResize(true)` restores
  `moveResizeGeometry()` before emitting that signal, but the script-visible
  `frameGeometry` is asynchronous for Wayland resize. At finish it can still
  be the last committed drag frame while the restore configure is awaiting the
  client. Comparing it to the captured start rectangle would therefore commit
  some Esc-cancelled drags.
- The internal `moveResizeGeometry()`,
  `initialInteractiveMoveResizeGeometry()`, and the `cancel` argument are not
  `Q_PROPERTY` or `Q_INVOKABLE` API. `move`, `resize`, stepped geometry,
  `frameGeometryChanged`, and `moveResizedChanged` also carry no cancellation
  result. Delaying a frame comparison does not establish when the final
  Wayland configure has settled.
- A start-rectangle equality heuristic has a benign committed net-zero-drag
  ambiguity, but also the non-benign asynchronous Esc false negative above.
  It cannot satisfy the required no-allocation-change cancellation contract.
- Evidence: KWin v6.7.4 `src/window.cpp:finishInteractiveMoveResize`,
  `src/window.h` Window Q_PROPERTY/signal declarations, and
  `src/xdgshellwindow.cpp:XdgSurfaceWindow::moveResizeInternal`. The upstream
  integration cancellation test awaits an xdg configure commit before
  observing restored `frameGeometry`.

## Bounded Units

- Add the strict retained `DescribePlan` pointer-resize command and its focused
  Rust contract coverage.
- Wire the production Plan adapter to the public interactive signals, coalesce
  steps, apply changed neighbours after a fenced reply, and retain existing
  drift reconciliation for non-gesture geometry.
- Cover classification, cancellation, acknowledgement/echo fencing, retained
  allocation, and no drift/park interaction before live user-owned validation.

## COSMIC Reference

- COSMIC assigns tiled geometry from the layout and configures the surface; it
  does not derive sibling allocation from the surface's committed size
  ([allocation authority](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L3115-L3143)).
- COSMIC gates configure progression on the latest requested size with bounded
  blockers ([latest-size gate](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/element/surface.rs#L628-L667),
  [blocker](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/blocker.rs#L15-L53)).
  This supports retaining allocation authority and bounded progression only; it
  does not establish KWin acknowledgement semantics or the three-attempt value.

## Static Verification

- `cargo test --lib planner_protocol`
- `npm test --prefix kwin` - 393 passing
- `npm run typecheck --prefix kwin`
- `cargo test`
- `git diff --check`

## User-Owned Rebuild And Live Check

- Rebuild the generated KWin bundle with
  `devenv shell --impure -- npm run build --prefix kwin`.
- Rebuild and swap the recorded worktree Planner with
  `devenv shell --impure -- just reload`. This does not reload the KWin script.
- Applying the new bundle to an already loaded script requires a user-authorized
  exact controller lifecycle action. No agent lifecycle action occurred.
- After the user applies the bundle, test a normal Wayland constrained client,
  a client self-resize, and an edge drag. Confirm no more than three reconcile
  writes occur for persistent drift, later drift produces no writes, and no
  sibling-share change is claimed from the edge drag.
