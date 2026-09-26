# Change 2: KWin script resilience fixes (offline, 2026-09-26)

## Goal and scope

Recover narrowly from ordinary KWin observation and actuation faults while keeping complete-observation, owner, identity, correlation and pre-write safety fences. Offline KWin only; preserve the accepted uncommitted multi-output fix. No live session mutation, new architecture, or learned size-limit policy. Do not edit backlog or the architecture review.

## Accepted decisions and approach

- I: tile windows without `maximizedChanged`, log once, use fresh `maximizeMode` reads.
- G: on a stale pre-write snapshot, replan the same command once with a fresh complete observation. No replay after a setter, and second staleness logs, drops and converges normally.
- A: after bounded reassertions, accept the exact client-held rectangle per window for automatic reconciliation; other domain drift keeps reconciling. No domain-wide park or fabricated native write success.
- Lost move Finished: bounded recovery using an existing event if sufficient; no fabricated drag outcome.
- T, D, F, K, L: implement only small, clearly correct fixes; skip and report design questions.

## Units and acceptance

One fresh Worker per bounded area, in the order I, G, A, move hold, then T/D/F/K/L. Review each actual diff and targeted regression evidence before acceptance. At each green point record result here. Full KWin `npm test` and typecheck at completion; Rust workspace tests if Rust changes. Update audit rows and authorized durable decisions at completion, then archive this note. No commit or push.

## Evidence and outcome

- Baseline `ddcfff0` on main; preexisting modifications to `kwin/src/plan-adapter.ts`, two KWin tests, `docs/backlog.md`, and an untracked archived multi-output note remain user-owned.
- I accepted: eligible signal-less windows remain tiled with one identity-free missing-signal log and fresh maximize reads (`kwin/src/plan-adapter-entry.ts`); startup/mixed/later-added regressions in `kwin/tests/plan-adapter.test.ts`. Targeted 168/168, full `npm test` 743/743 and `npm run typecheck` passed before comment cleanup; no live claim.
- G accepted: stale pre-write ordinary/directional replies re-dispatch the identical command once with a fresh complete snapshot and correlation; second staleness and scope/owner changes still drop and converge (`kwin/src/plan-adapter.ts`, `kwin/tests/plan-adapter.test.ts`, `kwin/tests/plan-directional.test.ts`). No mid-write replay. Targeted 204/204, full `npm test` 743/743 and typecheck passed before comment cleanup.
- A accepted: retired domain-wide park; after three bounded reassertion terminals, accept exact observed client rectangles individually as applied geometry evidence. Other or later drift still reconciles, hidden domains remain isolated, explicit moves work, and acceptance logs one bounded count (`kwin/src/plan-adapter.ts`; regressions in `kwin/tests/plan-adapter.test.ts`, `background-tiling.test.ts`, `hidden-terminal-isolation.test.ts`, `plan-ar12-clamp.test.ts`). A mechanical deduplication of foreground/hidden acceptance passed full `npm test` 745/745 and `npm run typecheck`.
- Lost move Finished accepted: a Started-keyed bounded expiry releases its own move hold and resyncs without a drag result, guarded against newer move and resize Starts; Finish, removal and stop cancel it (`kwin/src/plan-adapter-entry.ts`, `kwin/tests/drag-move-restore.test.ts`). Existing per-finish expiry remains. Regression failed before the epoch correction, passed after it; full `npm test` 747/747 and typecheck passed. A Worker inadvertently popped a pre-existing stash while attempting the regression; the original stash remains, the tracked diff was inspected, no staged changes remain, and an unrelated root npm lockfile created during verification was removed.
- T skipped: rotation is straightforward, but subscription failure currently returns a null bridge with no retained handle or in-module reattach event; retry would require choosing entry ownership or a degraded-handle contract. Group-only liveness remains a live-check risk; no edits or tests for T.
- D skipped: removing park removed one deferral, but markers for indefinitely unobserved domains still persist. There is no existing event with an unambiguous per-marker expiry: choosing an unrelated observation count, hidden reconcile ownership, or domain/window removal requires a decision. No edits or tests for D.
- F accepted: a proven quiet-equal foreground observation restores the pre-refresh epoch, so an in-flight Plan reply survives unchanged echoes; real drift still stales (`kwin/src/plan-adapter.ts`, `kwin/tests/plan-adapter.test.ts`). New regression fails without the fix and passes with it; targeted 171/171 and typecheck passed.
- K accepted: `onSignal("removed", exactRef)` evicts only that native object's sticky attempt; null/incomplete observations and other refs do not evict (`kwin/src/plan-adapter.ts`, `kwin/tests/plan-adapter.test.ts`). Targeted 172/172 and typecheck passed before comment cleanup.
- L skipped: native ID cache is string-keyed and removal callbacks intentionally never read IDs; exact eviction before an applied departure would need a new native-ref reverse index/ownership rule or a decision to read removal payloads. Clearing unrelated entries is not exact; no edits or tests for L.
- Final checks after all code and documentation changes: KWin `npm test` 749/749, `npm run typecheck` pass, `git diff --check` pass. Rust unchanged. Authorized I/G/A decisions promoted to `docs/decisions.md`, audit status updated, dev-loop tokens updated. No live KWin/Plasma testing or session mutation, commit or push. Existing multi-output fix and backlog edits remain in place for the user's later commit. Live acceptance should observe signal-less maximize reads, stale reply replan vs post-setter termination, stable drift and neighbour drift, missing move Finished expiry, and ordinary recovery on actual window removal.
- Combined KWin working-tree delta vs HEAD (includes the accepted preexisting multi-output fix in shared files): production +352/-109 lines across `plan-adapter.ts` and `plan-adapter-entry.ts`; tests +594/-75 across six test files. The multi-output fix was not re-attributed to this change.
