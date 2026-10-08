# D7: fixed-window tile overrides across KDE owner restart

## Goal and scope

- Persist successfully applied explicit fixed-window tile overrides in the
  existing planner-owned private intentional-float runtime store.
- Restore membership before startup admission for the same live native client;
  missing/degraded/unmatched records fall back to ordinary fixed classification.
- Clear on successful re-float, verified close and complete-inventory prune.
- Membership only; no positions, automatic fixed origin or extra float writes.
- KDE plus Linux planner implementation; Windows handoff documentation only.
- Offline only, no dependency installs. Initial HEAD `f6ef389`, clean.

## Acceptance and bounded units

1. One muse-spark Worker: implementation and meaningful lifecycle, restart,
   degraded/old-format and non-fixed regression coverage.
2. Lead: inspect actual diff and update decisions/spec/reference outcomes,
   Windows handoff and backlog (explicitly user-authorized).
3. One muse-spark Worker: full offline verification and exact gate evidence.
4. Fresh muse-spark Worker: independent review; resolve findings and rerun
   affected gates before authorized commit and push.

## Approach and verification

- Prefer a backward-compatible optional tile-membership field, reusing store
  authentication, bounds, privacy, native-success settlement and write ordering.
- Hydrated overrides preserve normal fullscreen/maximize/sticky safety fences;
  only explicitly chosen tile placement may write the restored client.
- Full gates: KWin tests/typecheck/bundle; Rust workspace tests/clippy/fmt;
  native CTest; portable checks; nine offline shell suites; diff whitespace.
- Baseline: KWin 1207, Rust 1264, native CTest 33/33.
- One active Worker at a time; Workers do not maintain project records.

## Outcome

- Implemented with additive optional `tile` membership in the existing v1
  file/wire. Legacy files read tile-empty; full writes replace both disjoint
  sets (absent write tile means empty). Existing privacy/namespace/atomic gates
  and separate storage ACK remain in force. Counts extend existing store logs.
- Lead choice: persist only fixed-window explicit tile commands (fixed hints
  or automatic fixed provenance), plus already durable overrides. Ordinary
  non-fixed commands gain no persistence. Matched saved overrides retain
  explicit identity through hint/predicate changes, with existing sticky and
  fullscreen/maximize safety fences; no positions or extra float writes.
- R-RST-04 / R-SPC-13 add minimal discriminating variants for these readings;
  unsupported reference and native outcomes remain TBD.
- Initial Worker implementation persisted non-fixed commands and hydrated
  non-fixed overrides as ordinary pins; Lead narrowed both before acceptance.
  Synchronous sticky echo initially clobbered adopted-float persistence;
  pre-write adoption capture fixed it. No unresolved semantic failed approach.
- Full gates: KWin 1216 tests / 172 suites, Rust workspace 1268 tests, native
  CTest 33/33; typecheck/bundle, clippy/fmt, portable and Linux Windows-allowlist
  build/test/clippy (1116 tests) pass. Nine offline shell suites pass (1713
  counted assertions plus build-kpackage contracts); logs:
  `/tmp/opencode/verify-D7-20261008/`. Verification's own Nix result symlink
  initially tripped two shell fixture guards; removed only that symlink,
  reran both successfully. No code change or unresolved gate failure.
- Decisions/spec/Ours reference cells, diagnostics and Windows handoff updated;
  D7 P0 sub-bullet removed and named user-owned live check added. Windows float
  persistence remains a gap; no Windows runtime edits or live tests.
- Fresh independent muse-spark review accepted the diff with no blockers and
  substantiated gate evidence. One stale write-request comment was corrected
  to match the tested absent-tile-clears contract; behavior unchanged.
- Offline delivery accepted; native acceptance remains user-owned.
