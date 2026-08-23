# State: Controller Source Split

- Current unit: unit 05 - reflow, observers, and drag, not started.
- Completed units: unit 01 - config/catalog, accepted 2026-08-23; unit 02 - topology and workspace state, accepted 2026-08-23; unit 03 - narrow shared state and capabilities, accepted 2026-08-23.
- Blockers: none.
- Next dispatch: unit 05 - reflow, observers, and drag, after this accepted Unit
  04 checkpoint is committed.
- Status: units 01-04 accepted; unit 04 attempt 1 was cancelled and
  non-resumable, attempt 2 recovered the candidate, and its one review finding
  was corrected and confirmed. Unit 05 is next.
- Semantic units completed: 4/7.
- Unit 04 accounting: attempts 2, cancellations 1, corrections 1, independent
  reviews 1.
- Change-wide independent reviews: 2 (unit 03 and unit 04).
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
- Unit 03 checkpoint: `controller.ts` retains all state ownership and public
  facade/composition responsibilities. Its private, narrow composition seams
  cover scope/topology resolution, structural mutation reporting, keyboard
  state, window action state, drag/watch/outline state, reflow state,
  reconstruction state, and workspace lifecycle state. No dispatch or domain
  behavior moved, no public API changed, and no test files changed.
- Review: one independent review reported 3 P1 broad-context findings: combined
  drag/watch/outline state, combined workspace lifecycle state, and a mutable
  pending-rebuild getter. One bounded same-scope correction split the first two
  into focused contracts and removed the mutable getter. Findings: 3 total, 3
  corrected, 0 open. Static inspection found `entry.ts` is the sole runtime
  importer of `controller.ts`; no extracted domain imports it or a sibling
  domain. One production `flashFocusedGroup()` call and one
  `flushStructuralMutation()` implementation remain.
- Verification: focused controller characterization 173 tests / 13 suites / 0
  failures; both TypeScript configurations clean; full JS suite 965 tests / 91
  suites / 0 failures with 0 skipped; established dogfood
  `bash scripts/dogfood-install.test.sh` 347 passes / 0 failures. `npm test`
  also reported its script-local 255 passes / 0 failures. Two normal bundle
  builds matched SHA-256
   `af5dfd49f430bc803d7289824201d2e1b421aab27bf28b318bd9cf13d82625a8`.
   No live KWin operations occurred.
- Unit 04 checkpoint: `controller-input-actions.ts` owns keyboard insertion,
  focus/move/swap, and resize-mode state/dispatch/validation;
  `controller-window-actions.ts` owns detach/attach, float/tile, sticky, scope
  fill, float geometry, and revalidation. `controller.ts` remains the public
  facade, composition root, and shortcut callback owner. The obsolete facade
  implementations were removed. The one P1 independent-review finding (resize
  mode ownership remaining in the facade) was corrected and Lead-confirmed; no
  second review ran.
- Verification: `npm --prefix kwin run typecheck` clean for both configurations;
  `npm --prefix kwin test` 965 tests / 91 suites / 0 failures / 0 skipped;
  `bash scripts/dogfood-install.test.sh` 347 passes / 0 failures; `git diff
  --check` clean. Two normal `npm --prefix kwin run build` runs matched SHA-256
  `3434ccd9de8b264665083f83ba24485d0ba37ab78f78ea1dd34e88c4cf2b9e52`.
  No live KWin operations occurred.
