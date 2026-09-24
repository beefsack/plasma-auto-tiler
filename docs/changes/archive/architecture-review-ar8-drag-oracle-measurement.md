# AR8: Drag oracle measurement

## Goal and scope

Measure whether the script's Wayland frame geometry or the pointer can replace
the drag oracle's final-geometry source (architecture review 7.1). The original
offline slice instrumented the existing drag route without changing it; this
record also captures the subsequent live evidence and the 2026-09-24 closure.

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

## Live evidence and interpretation

- `/run/user/1000/plasma-auto-tiler-dev.v3rAzb.log:179,237,407,430,471,528,556,709,717,727,756,788`
  has twelve correlated records, all with script finish frame equal to oracle
  final geometry and `ok-moved`. Several first later frames are the tiler's
  own reflow or snap-back rather than evidence of delayed client commits
  (`:170-179,229-237,519-528,555-557`). The pointer-derived boundary matches
  the oracle in only one of the three strict single-edge measurements; the
  other two differ by 13 and 10 px (`:179,237,528`). No Esc or attributable
  size-increment-client case is established by this trace.
- The newer `/run/user/1000/plasma-auto-tiler-dev.mJaVwg.log:130,157` records
  a right-edge route (`grabbed=right+-`) with script finish equal to oracle
  final geometry. Lines `:288-293` and `:355-357` record two `cancelled=true`
  `no-change` verdicts without any pointer-resize plan. In the latter case,
  script finish `598,52,930,353` differs from oracle final
  `805,52,723,353`; the first later script frame returns to that final rect.
  The log cannot identify the user's Esc keypress or independently link the
  right/down resizes to a Ghostty Meta+right-drag. It contains no down-edge
  record. The user's manual report (2026-09-24) accepts right/down edge
  resizes including Ghostty Meta+right-drag and Esc cancellation as working;
  that visual/manual report is distinct from what the log proves.
- Since the review's proposal, the unified active-border plugin already hosts
  the oracle, and its passive native input spy carries matched resize-press
  evidence atomically in `LastVerdict`. The script can classify grabbed edges
  and observe frame geometry and pointer position, but cannot read native
  `moveResizeGeometry()` or capture that press from its public scripting
  surface. Removing the oracle would need a replacement native press
  transport; merging D-Bus objects or keying the last verdict per window
  would change the shipped integration. Neither is selected by this closure.

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

The user explicitly approved closing AR8 on 2026-09-24 after the targeted
manual capture. Outcome: **keep the shipped oracle integration**, following
the Lead's recommendation; the user approved closure and did not object to
that recommendation. This does not claim complete timed first-change data,
attributable client increments, or an independent log proof of Esc. Keep the
opt-in, trace-only `drag-measure` instrumentation: today's drag diagnoses used
its correlated geometry and cancellation records, while normal operation
incurs no measurement subscriptions or timers. No oracle behavior, endpoint,
or architecture change is made by this closure. Next action: none for AR8.
