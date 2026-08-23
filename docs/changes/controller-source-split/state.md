# State: Controller Source Split

- Current unit: unit 02 - topology and workspace state.
- Completed units: unit 01 - config/catalog, accepted 2026-08-23.
- Blockers: none.
- Next dispatch: unit 02, subject to Lead execution thresholds.
- Status: unit 01 accepted; unit 02 not started.
- Semantic units completed: 1/7.
- Independent reviews: 0.
- Circuit breakers: 0.
- Baseline: 965 tests / 91 suites / 0 failures; typecheck clean; dogfood
  347/0. No live KWin operations.
- Unit 01 checkpoint: `controller-config.ts` owns configuration interpretation,
  profile catalogs, and pure automatic-target contracts. `controller.ts` remains
  the sole facade and composition root and re-exports its existing public API.
  The module is 536 lines and has runtime dependencies only on `logic` and
  `preset-catalog`; no extracted-domain runtime dependency or cycle was found.
- Verification: focused config/catalog tests 167 tests / 19 suites / 0 failures;
  typecheck clean; full JS suite 965 tests / 91 suites / 0 failures. Two normal
  bundle builds matched SHA-256 `1fe1e11a959004a1d8a2636cf4148776b864257fbfe0d018efaa4faccc1e6ad3`.
  `npm test` also reported its current script-local check as 255 passes / 0
  failures; Unit 01 does not require dogfood as a checkpoint gate. No live KWin
  operations occurred.
