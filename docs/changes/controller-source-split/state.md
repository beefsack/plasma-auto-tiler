# State: Controller Source Split

- Current unit: `unit-06-reconstruction-dwindle-workspaces` - next approved
  successor after accepted Unit 05B.
- Completed units: unit 01 - config/catalog, accepted 2026-08-23; unit 02 - topology and workspace state, accepted 2026-08-23; unit 03 - narrow shared state and capabilities, accepted 2026-08-23.
- Blockers: none. Original Unit 05 remains permanently frozen after its
  malformed Worker preflights; it is not a dispatch target.
- Next dispatch: Unit 06 may be dispatched as the next approved successor.
- Status: units 01-04, Unit 05A, and Unit 05B accepted; frozen Unit 05 remains
  replaced by the accepted reset units. Unit 06 is next.
- Semantic units completed: 6/8.
- Unit 04 accounting: attempts 2, cancellations 1, corrections 1, independent
  reviews 1.
- Change-wide independent reviews: 3 (units 03, 04, and 05B).
- Circuit breakers: 1 - frozen Unit 05 attempt limit reached; no third attempt
  may be dispatched on that semantic unit.
- Frozen Unit 05 accounting: attempts 2, cancellations 0, corrections 0,
  independent reviews 0, circuit breaker 1. Both attempts stopped at malformed
  Worker preflight before source work, verification, or a reviewable candidate;
  no source recovery is required.
- Unit 05A accounting: attempts 1, cancellations 0, corrections 0,
  independent reviews 0, accepted 2026-08-23. It extracted selected-overlay
  reflow and lifecycle callbacks, including token-identity eligibility
  cancellation, into `controller-reflow-observers.ts`; drag and reconstruction
  remain excluded. Focused existing suites reported 46 tests / 3 suites / 0
  failures; the full suite reported 965 tests / 91 suites / 0 failures / 0
  skipped; both typechecks passed; dogfood reported 347/0; two normal builds
  matched SHA-256 `fbbfb573f9e5ab3e57a2edcedd9a424112a66da71afd7f2b768719fdd10275c0`.
  Lead inspection confirmed no runtime sibling-domain import, one production
  `flashFocusedGroup()` invocation, and the existing sole structural
  reporting/flush implementation. No independent review is scheduled.
- Unit 05B accounting: attempts 1, cancellations 0, corrections 1, independent
  reviews 1, accepted 2026-08-23. It extracted interactive watches, drag state,
  outlines, geometry/drop recovery, snapshots, and drag-specific deferred-work
  coordination into `controller-interactive-drag.ts`. Its independent review
  found explicit QRectF geometry capture, runtime extracted-domain imports, and
  disabled-path drag-state clearing; one same-scope correction fixed all three
  and Lead confirmation checked only that finding set. Focused existing suites
  reported 43 tests / 3 suites / 0 failures; the full suite reported 965 tests /
  91 suites / 0 failures / 0 skipped; both typechecks passed; dogfood reported
  347/0; two normal builds matched SHA-256
  `cd4145bd8b0d2b27d1e634483ab6ddb7936abb548a66382da72f268842c242cc`.
  Static inspection found only type imports from extracted domains, `entry.ts`
  as the sole runtime importer of `controller.ts`, one production
  `flashFocusedGroup()` invocation, and the existing sole structural
  reporting/flush implementation. The implementation Worker omitted its
  required identity-preflight line; this is a recorded process-compliance
  defect, not a technical acceptance gap. No second independent review ran.
- Reset ownership: `controller.ts` remains the composition root and sole owner
  of `StructuralMutationCapability`, its pending flag,
  `flushStructuralMutation()`, and the one production `flashFocusedGroup()`
  invocation. Units 05A and 05B receive only existing narrow capabilities.
- Dependency reset: Unit 06 has accepted Units 05A and 05B, with Unit 05B
  independently reviewed. Unit 07 depends on accepted Units 01-04, 05A, 05B,
  and 06 with all required reviews complete; neither later unit's semantic scope
  changed.
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
