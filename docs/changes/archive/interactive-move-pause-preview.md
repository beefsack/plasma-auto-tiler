# Interactive move pause and preview

## Goal and scope

Keep a tiled window under KWin's control throughout an interactive move, including pauses longer than the old missing-Finished timeout, and show the projected drop preview during an ordinary tiled drag. Resolve the preview focus mismatch and any same-area drag correlation/start loss. No live KWin testing or unrelated policy changes.

## Acceptance and approach

- Reproduce the trace's paused move and real focused observation shape in behavior tests; stop ordinary reconcile from writing an observed moving window, using KWin move state rather than a timeout inference. Retain only recovery supported by observation.
- Preview and drop use the actual mover identity/focus semantics and retain stale/reply fences; explain drag-1 versus drag-4 and missing start, correcting lifecycle issues if necessary.
- Remove obsolete timer/internal tests; update diagnostic tokens in `docs/dev-loop.md` if changed. Do not touch existing Orchestrator/user edits to `docs/backlog.md` or `devenv.nix`.
- Verify KWin npm test and typecheck; Rust workspace tests/fmt/strict clippy if touched; native build and CTest if touched; git diff --check. Record evidence, line deltas, and archive on completion.

## Bounded units

1. Diagnose and fix move hold/reconcile while KWin reports an interactive move, with behavior regression.
2. Diagnose and fix preview focus and drag lifecycle correlation, with behavior regression.
3. Integrate, review, document and verify offline.

## Outcome and evidence

The 476-line test-system trace confirms `drag-move-timeout` at line 449 removed the Started hold while KWin was still moving; the next reconcile rewrote Ghostty at lines 463-465. Started-keyed move and resize expiry are removed. Holds survive while KWin reports the gesture active and release on a subsequent observed idle state (or exact window removal); the move's bounded post-Finish verdict wait remains, but cannot release a live move. An unreadable interactive state cannot prove an exit. Paused move/resize and delayed idle, including anomalous Finished/verdict while still moving, are covered by behavior tests. Legacy resize-finish fixtures were corrected to report idle before emitting Finished.

`observeNative` reads logical focus from `activeWindow` (`plan-adapter-entry.ts:1723`); during a Meta+drag that can be another tile. Preview and final drop now bind the observed mover as logical focused window, with the same binding at the drop's fresh-reply comparator; native focus is not changed at dispatch. The Engine's drag policy requires mover==focused leaf, explaining the 100 `focus-mismatch` preview refusals. Entry's preview `drag-1` is the Started-local epoch while final `drag-4` is the independent effect verdict counter; the preview prior is explicitly passed to final drop. Trace `start=missing` follows directly from the old timeout deleting the Started capture before Finish. Desktop-mismatch lines are expected exclusions for windows not on the current logical desktop, unrelated to the mover.

KWin `npm test`: 790/790 (109 suites); `npm run typecheck`: pass; `git diff --check`: pass. Production: +184/-192, net -8 lines across two KWin files. Tests: +179/-119, net +60 lines across six KWin files. No Rust or native files changed, and no agent ran live KWin/Plasma testing. Existing uncommitted edits to `docs/backlog.md` and `devenv.nix` were preserved. The diagnostic/lifecycle explanation in `docs/dev-loop.md` reflects the retired Started-timeout tokens. No product rule changed, so `docs/decisions.md` is unchanged. Live acceptance remains a user test system check: hold and pause a tiled Ghostty beyond the old timeout without a mid-drag snap, see an edge preview above windows, finish to place it, and verify center/cancel hide the overlay without fighting the drag.
