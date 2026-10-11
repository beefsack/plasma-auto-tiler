# Mid-drag destination recovery

## Goal and evidence

Ensure a sent tiled window is re-tiled when its Meta drag releases on the destination workspace after the send. Keep the prior decision to ignore stale drop placement and converge from complete destination observation, without new timers, fences or product policy.

In `plasma-auto-tiler-dev.llROHi.log`, release routes `drag-1` through the stale-workspace refusal (`:1869-1874`), but `drag-reconcile ... dispatch=deferred` marks the departed source. The destination is foreground (`:1809-1811` desktop mismatch for source survivors, `:1815-1817` four-window destination preview); no destination reconcile appears after release, and the final frame remains `0,660,756,478` (`:1875`). The file contains one `drag-drop-refused-stale-workspace` and no `snapshot-invalid` line.

## Acceptance

- Keep the stale drop refused, log the decision normally, and run its existing restore reconciliation against the native destination containing the mover so its reserved tile is restored on release. Source send settlement continues its own reflow.
- Test entry-level mid-drag send/release without an additional geometry signal or workspace switch. Verify the destination reconcile is dispatched/applied and the stale drop does not dispatch; preserve legitimate pointer cross-domain drag and source-only marker behavior elsewhere.
- KWin typecheck/tests, Rust workspace tests/fmt/strict clippy, `git diff --check`; native build/CTest only if native changes. No live tests.

## Decision and outcome

- Orchestrator's existing mid-drag rule: old-workspace drop placement is ignored; ordinary send/admission tiles the mover on its observed destination. This is a correction of the restore marker's domain, not a new product choice.
- Lead correction: the stale-workspace refusal supplies the native destination containing the mover to the existing drag restore marker. It dispatches its reconcile as soon as the release is handled on that workspace; no stale drag-drop or extra setter replay. Source send settlement remains independent. The `stale-workspace` refusal and `drag-reconcile` dispatch/terminal logs stay visible at normal level.
- Entry regression now proves destination `reconcile` dispatch and mover tile write on release without another native signal or workspace switch, the correlated applied marker terminal, subsequent source reflow, and unaffected cross-output drag. The obsolete source-marker assertion was removed; no new test cases were needed. Production `+1/-1` (net 0); tests `+19/-26` (net -7).
- KWin `npm run typecheck` and `npm test` (805 passed), Rust `cargo test --workspace --offline --quiet`, `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --offline -- -D warnings`, and `git diff --check` passed. No native files or live KWin session changed.
- Live re-test: on workspace 1 with three tiled windows, hold Meta+left-drag, press Meta+Shift+2 while held, release near the reserved destination tile. Expect `[kwin]` `send-to-workspace ... follow outcome=state-confirmed`, `drag-verdict ... reason=ok-moved`, `drag-drop-refused-stale-workspace`, `drag-rejected ... reason=stale-workspace`, `drag-reconcile ... dispatch=dispatched`, `kind=reconcile ... outcome=planned-applied`, `drag-reconcile-settled ... outcome=applied`; the mover occupies its destination tile and source remains reflowed. Red flags: `drag-reconcile ... dispatch=deferred` with no later destination reconcile, repeated `snapshot-invalid`, or the mover left at the dropped frame.
- Residual: KWin's live geometry and signal ordering may differ from the offline fixture; user test system re-test is still required. This trace contains no `snapshot-invalid`, so it offers no evidence tying that claimed rejection to this drag. The separate off-screen native edge-tiling report has no demonstrated shared cause.
