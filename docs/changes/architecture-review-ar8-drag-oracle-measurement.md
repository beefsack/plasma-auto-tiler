# AR8: Drag oracle measurement

## Goal and scope

Measure whether the script's Wayland frame geometry or the pointer can replace
the drag oracle's final-geometry source. This is the offline instrumentation
step of architecture review 7.1; the user performs the live capture later.
Keep the existing drag route and oracle unchanged. Do not infer a removal
decision from offline tests.

## Acceptance and approach

- In opt-in KWin trace mode, emit one bounded `route-diag:drag-measure` record
  for each instrumented interactive move/resize finish. Include the start
  rect, script frame at finish, first subsequent frame change or a 500 ms
  timeout marker, oracle verdict (cancelled, reason, final rect), script-derived
  edge, and `workspace.cursorPos` at start and finish. Pair the verdict to the
  existing `drag-N` correlation; use `seq` to distinguish finishes, including
  missing verdicts. A missing verdict is marked after 2,000 ms.
- Trace-only geometry has precedent in `kwin/src/plan-adapter.ts` (`:write`
  rect and `:rejected` rect/bounds). Keep titles, native IDs, application
  content, and raw D-Bus data out of the new record. Failed measurements or
  logging must not alter routing or geometry writes.
- Verify with KWin typecheck, full tests and build; regress record fields,
  first-change and timeout paths, synchronous and overlapping oracle replies,
  and no extra routing. Rust is unchanged, so its 585-test suite is not part
  of this offline slice. Request an independent implementation review.

## Checked review claims

- Review 7.1's claim that `cancelled` is *exactly* `start == end` is false:
  `kwin/native-effect/drag_oracle.rs` also returns `cancelled=true` for invalid
  geometry/range or identity; panic and no-observation yield cancelled
  verdicts. `no-change` is the equality case after those validations.
- `workspace.cursorPos` is exposed by KWin's scripting workspace wrapper
  (`docs/research/custom-tile/adapter-design.md`, source matrix) and declared
  readable (`kwin/src/kwin-globals.d.ts`);
  the script's existing `oracleStarts` start-rect map is in
  `kwin/src/plan-adapter-entry.ts`. This change measures script rects and
  pointers without changing oracle routing.

## User capture and interpretation (pending)

1. In the project's development environment, run `just dev trace` in a
   terminal. Wait for `just dev: up` and note the printed `combined log:` path.
   The recipe owns its startup and Ctrl-C teardown; do not invoke it from the
   offline verification step.
2. Perform about 20 manual Wayland edge drags spanning left, right, up and
   down edges, including a size-increment terminal such as Ghostty, then one
   drag cancelled with Esc. Wait at least two seconds after the final finish
   for timeout records. Press Ctrl-C to let `just dev` tear down and retain
   the printed combined log path.
3. Extract the lines from that log, replacing the path below with the printed
   one, and share the extracted file with the drag count/edge mix:

   ```sh
   rg -F 'plasma-auto-tiler:route-diag:drag-measure ' /path/from/combined-log > ar8-drag-records.log
   ```

   Each line contains `seq`, `correlation`, `start`, `finish`, `later`,
   `verdict`, `reason`, `final`, `edge`, `pointerStart`, `pointerFinish`.
   Rects are `x,y,w,h`; `later=timeout` means no later change in 500 ms,
   `later=missing` means a change fired but the rect was unreadable, or the
   window was removed before the change. A removal before the verdict is
   recorded with `verdict=missing`.
   `correlation=none`/`verdict=missing` cannot establish an oracle comparison.
   For each direction, compare script edge/boundary and geometry at finish or
   first change to the oracle final rect; allow the size-increment terminal's
   committed frame to differ from the requested size. For pointer fallback,
   compute `grab = pointerStart - edgeAt(start)` along the recorded edge and
   `boundary = pointerFinish - grab` on the same axis.
4. Apply the review 7.1 decision rule to the captured cases: if script
   geometry matches the oracle at finish or the first change, remove the
   oracle; if script geometry lags but the pointer-derived boundary matches,
   use the pointer; if both fail, keep the oracle and fold it into the
   existing `ActiveBorder` object. Decide only after reviewing the live
   evidence, including cancellations and increment-sized frames.

## Outcome and next action

Offline instrumentation is implemented in `kwin/src/plan-adapter-entry.ts`
and `kwin/src/drag-measure.ts`; 17 new regressions in
`kwin/tests/drag-measure.test.ts` cover record shape, real route-start capture,
first change, timeout, missing verdict, cancellation, synchronous/overlapping
finishes, removed windows, absent pull, and throwing logging. Independent
Worker review accepted the implementation after a follow-up correction for
stale starts in the absent-pull fallback. In `kwin/`, `npm run typecheck`,
`npm test` (732 passing, 0 failing; baseline 715 + 17), and `npm run build`
passed. `git diff --check` passed. Rust code was untouched; no Rust tests or
live KWin/Plasma tests were run. A rare per-window partial pull attachment
failure can leave an entry-observed finish without a corresponding measurement;
stopping the script before the measurement timer resolves also drops that
in-flight record. These are capture limitations, not runtime routing changes.

The next action is the user's live capture, then a decision on the oracle
based on the actual records. Review 7.1 proposes the decision rule; no
removal or new product decision is attributed to the offline implementation.
