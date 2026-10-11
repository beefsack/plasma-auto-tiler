# Resilience change 3a: D, T, L (offline, 2026-09-27)

## Goal and scope

Keep drag-marker, group-highlight and native-ID lifecycles recoverable without inferring facts from incomplete observations. Offline KWin script and minimal effect FFI if ordered correlations require it. No live mutation, architecture review or dependency edits, commit or push.

## Decisions and approach

- D (user, option 2): on existing topology signals, independently validate complete desktop and output lists; settle and drop markers when a successful list lacks their workspace or output. A malformed or unreadable list proves nothing for that axis. No cap or timer.
- T: rotate ordered group correlations with old-reply invalidation in both bridge and FFI; entry retries null bridge attachment on later Plan-applied/config events, logging failure and recovery once each.
- L: interned IDs have exact native-ref owners; exact removal evicts only IDs still owned by that ref, without reading removed object properties.

## Units and acceptance

Units: D observability and implementation; T correlation and attachment areas separately; L ownership; lean behavioral regressions. Review each diff. Run KWin tests and typecheck, Rust workspace and native CTest if relevant.

## Evidence and outcome

- Baseline `8178edb` on main; pre-existing uncommitted backlog decision text preserved. No live testing.
- D follow-up accepted offline: a successfully validated full `workspace.desktops` ID or `workspace.screens` name list on the existing topology signals proves a missing marker domain is gone; failed/malformed axes prune nothing independently. Removed the prior marker count cap and its tests. Pruned drags settle `outcome=unavailable plan=none` exactly once. The marker-incarnation fence remains: a removed output name can return after replug while the old flight is still in flight, and its reply must not settle a recreated same-key marker (`kwin/src/plan-adapter.ts`, `kwin/src/plan-adapter-entry.ts`; `kwin/tests/drag-23-followup.test.ts`, `kwin/tests/drag-move-restore.test.ts`). Two lean tests cover entry workspace removal/failed lists and adapter output replug/late flight. During the previous D pass an existing stash was accidentally popped, the exact prior worktree plus D restored, and stash list retained `temp-groupC`; tracked diff and status inspected afterward.
- T accepted offline: ordered `g<epoch>r<seq>` rotation after legacy `g1000000` in script and effect FFI, with same-revision old-epoch refusal and pending-reply fence (`active-group-highlight.ts`, `group_highlight.rs`, targeted tests). Entry-owned attach retries after null on existing applied/config edges, logs failure/recovery once, no timer (`plan-adapter-entry.ts`, `plan-adapter.test.ts`). Rust workspace tests passed; no FFI layout change. Host-matched `just build-native-effect` rebuilt the FFI staticlib and linked/staged the native effect successfully. Native focused CTest 6/6 passed; full 29-test build is blocked by pre-existing `shortcutreconciler_test.cpp` `-Werror=missing-field-initializers` and a `CHECK`/`KConfig` call mismatch in untouched test code.
- L accepted offline: entry records id-to-ref ownership at every intern site (including send observation), evicts only still-owned IDs on the adapter's existing exact removal edge, never reads removed-object properties; applied departure cleanup also removes the send cache alongside owner evidence. Two behavioral tests cover pre-apply and unreadable-domain removal plus stale ref reuse (`plan-adapter-entry.ts`, `plan-adapter.ts`, `plan-adapter.test.ts`). KWin full 758/758 and typecheck passed after the cleanup.
- Final D follow-up checks: KWin `npm test` 758/758, `npm run typecheck`, `git diff --check` passed; Rust workspace tests passed for unchanged T FFI. Native effect host build and focused CTest results above. No live KWin/Plasma checks or mutation.
