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
