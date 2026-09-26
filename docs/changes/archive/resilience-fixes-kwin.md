# KWin resilience fixes (offline, 2026-09-26)

Audit source claims for H, J, B, C, E and U were rechecked against `dbbf822` before editing; all six held. This is an Orchestrator-approved ordinary implementation of the user's Resilience principle, with no product-choice or architecture change. No live KWin/Plasma testing or session mutation was performed.

| Row | Outcome and current source | Behavioral evidence |
| --- | --- | --- |
| H | Empty startup retains enabled observer and non-null handle, logs empty-startup and truthful ready, and tiles at the next complete observation (`kwin/src/plan-adapter-entry.ts`). | `kwin/tests/background-review-fixes.test.ts` adds a window after empty startup and sees a Plan request. |
| J | Missing/throwing shortcut lookup logs catalog unavailable with owner/generation and preserves automatic tiling (`kwin/src/plan-adapter-entry.ts`). | `kwin/tests/plan-adapter.test.ts` checks missing/throwing lookup and later Plan dispatch. |
| B | A two-second, per-Start epoch-guarded resize hold expires and schedules ordinary resync once other interactive holds release, without fabricating a drag result; Finish, removal and stop cancel the guard (`kwin/src/plan-adapter-entry.ts`). | `kwin/tests/drag-resize-timeout.test.ts` checks held reconcile, timeout, cancellation, stale timer and newer move Start. |
| C | A non-invoked maximize write clears only its attempt, allowing a later deliberate press (`kwin/src/plan-adapter.ts`). | `kwin/tests/plan-adapter.test.ts` checks failed first write and repeat press. |
| E | One deadline spans both Planner-loss identity callbacks, clears only that probe on silence, and resumes the pump without inferring loss or resetting topology (`kwin/src/plan-adapter.ts`). | `kwin/tests/plan-planner-loss-recovery.test.ts` checks both callback gaps, late replies and resumed marker pumping. |
| U | Plan and send rotate distinct bounded correlation namespaces at sequence exhaustion; old-reply fences and Engine session/topology remain (`kwin/src/plan-adapter.ts`, `kwin/src/workspace-send-adapter.ts`). | `kwin/tests/plan-adapter.test.ts`, `kwin/tests/workspace-send-adapter.test.ts` check boundary dispatch, distinct IDs and stale replies. |

Each recovery emits a bounded correlated cause/recovery line without raw native identifiers. No new transaction, polling or retry loop was added. Full offline KWin checks: `npm run typecheck`, `npm test` (741 pass, 104 suites, 0 fail), `npm run build`, and `git diff --check` passed. Live behavior remains unverified; audit rows outside this six-row scope remain open.

Independent read-only final-diff review found an interleaved newer move Start that could initially strand the older resize hold; the resize guard now releases only its own hold and leaves the newer move capture untouched. The audit's recovery column is explicitly historical, and unreachable rotation branches were removed. A separate move Started with no Finished can still hold automatic reconcile (its pre-existing timer arms at Finish); addressing that independent move fault was outside row B's resize scope. No live behavior is claimed.

A fresh independent read-only review verified the corrections and found no further concrete correctness or documentation findings.
