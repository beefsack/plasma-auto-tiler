# Change Log: Tiling Recovery Robustness

## 2026-08-12 - Lead - unit-01 accepted

- Source analysis found no JavaScript dwindle depth or instruction-count limit.
- The likely trigger is `dwindleInsert` marking the scope inert after
  `orderedChildren` rejects an empty child produced by KWin minimum geometry;
  later `isInert` checks suppress management for the session.
- Evidence: `kwin/src/controller.ts:2700-2736,3276-3280`; worker source report
  and its passing 430-test baseline.
