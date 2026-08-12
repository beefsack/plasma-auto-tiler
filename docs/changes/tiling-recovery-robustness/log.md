# Change Log: Tiling Recovery Robustness

## 2026-08-12 - Lead - unit-01 accepted

- Source analysis found no JavaScript dwindle depth or instruction-count limit.
- The likely trigger is `dwindleInsert` marking the scope inert after
  `orderedChildren` rejects an empty child produced by KWin minimum geometry;
  later `isInert` checks suppress management for the session.
- Evidence: `kwin/src/controller.ts:2700-2736,3276-3280`; worker source report
  and its passing 430-test baseline.

## 2026-08-12 - Lead - unit-02 unsuccessful

- The sole nested attempt returned no worker report. Reconciliation found
  `/tmp/opencode/pat-u22-a01` but its launch artifacts used a different private
  environment layout and lacked required host `kwinrc` hash/mtime evidence.
- It is not valid nested reproduction evidence. The no-harness-iteration
  constraint ends nested reproduction here; source evidence remains the basis
  for the correction.

## 2026-08-12 - Lead - unit-03 accepted

- `dwindleInsert` now treats strict post-split child-geometry rejection as a
  capacity failure: it emits `ownership-add-failed:no-child-geometry` and keeps
  the scope retryable instead of calling `markInert`.
- The regression test models KWin's empty-child result, proves the old source
  emits `ownership-inert`, and proves the corrected controller arms and
  completes the existing deferred reconstruction on a later lifecycle path.
- Verification: targeted pre-fix test failed 1/1 at
  `/tmp/opencode/tiling-recovery/pre-fix-regression.log`; corrected targeted
  test passed 1/1; `npm --prefix kwin run typecheck`, `npm --prefix kwin run
  build`, `npm --prefix kwin test` (431 pass), and
  `bash scripts/start-test.test.sh` (248 pass) passed.
- Commit: `aa8cc13`.
