# State: Controller Source Split

- Current unit: unit 03 - narrow shared state and capabilities.
- Completed units: unit 01 - config/catalog, accepted 2026-08-23; unit 02 - topology and workspace state, accepted 2026-08-23.
- Blockers: none.
- Next dispatch: unit 03, subject to Lead execution thresholds and its independent-review checkpoint.
- Status: units 01-02 accepted; unit 03 not started.
- Semantic units completed: 2/7.
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
- Unit 02 checkpoint: `controller-topology.ts` owns bounded topology decoding,
  occupancy predicates, and geometry-derived preset traversal;
  `controller-geometry.ts` owns pure geometry predicates and drag diagnostics;
  `controller-workspace-state.ts` owns session output-key identity and pure
  workspace helpers. `controller.ts` remains the sole facade and composition
  root, re-exporting its prior `outputTuple`, `SessionOutputKeys`,
  `TrailingEmptyDomainRequest`, `TrailingEmptyDomainResult`, and
  `ensureTrailingEmptyDesktop` exports. The modules are 372, 65, and 158 lines;
  no material size exception applies.
- Verification: focused topology/workspace tests 47 tests / 8 suites / 0
  failures; both TypeScript configurations clean; full JS suite 965 tests / 91
  suites / 0 failures; established dogfood `bash scripts/dogfood-install.test.sh`
  347 passes / 0 failures. `npm test` remains the separate script-local
  255-pass / 0-failure gate. Two normal bundle builds matched SHA-256
  `778b54716f476f907373747d0c98f1519902362b9ae4dbb3433ffa7bb32e1c05`.
  No live KWin operations occurred.
