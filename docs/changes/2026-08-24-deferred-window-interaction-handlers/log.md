# Change Log: Deferred Window Interaction Handlers

- 2026-08-25 | planning | Orchestrator approved the Standard spec and plan in
  autonomous mode. No implementation telemetry: 0 dispatches, 0 attempts, 0
  corrections, 0 reviews. Commit/push is allowed only after acceptance; Lead
  owns staging.
- 2026-08-25 | baseline | Focused static gate `G-01` passed: 14 tests, 1
  suite, 14 pass, 0 fail. Broad static baselines passed: `G-02` typecheck,
  `G-03` KPackage contract, `G-04` 255 pass/0 fail, and `G-05` 207 pass/0
  fail. No live command was run.
- 2026-08-25 | blocker | `unit-03` is parked pending user-run live Steam
  move/placement evidence. Interactive resize support is a pending user
  product decision and remains out of scope.
- 2026-08-25 | verification-plan correction | Orchestrator approved `G-06` for
  `unit-02`: `npm --prefix kwin test` passed with 993 tests, 95 suites, 993
  pass, 0 fail, 0 skipped, 0 cancelled, and 0 todo. Its build phase left no
  additional tracked changes. `unit-01` remains ready for implementation.
- 2026-08-25 | unit-01/attempt-01 | Accepted. The deferred eligibility callback
  now uses existing `interactiveDrag.attach` before placement. One regression,
  `attaches interaction handlers when deferred desktop eligibility settles`,
  proves no subscribers before deferred desktop settlement, both subscribers
  after it, then successful move/finish handling. `G-01` passed: 15 tests, 1
  suite, 15 pass, 0 fail. `G-02` passed. No live or broad unit-02 gate ran.
- 2026-08-25 | verification-plan correction | Orchestrator approved `G-07` for
  `unit-02`: `npm --prefix kwin run build`. The committed `main.js` baseline is
  362621 bytes, SHA-256
  `eadec463b6872778466df6672322c2382441eed78efc8ddc394a59a9b2f17f58`.
  The build has not run. Its resulting bundle is the only allowed generated
  output and is required in the accepted commit; size/SHA-256 and generated
  drift are pending verification.
- 2026-08-25 | unit-02/attempt-01 | Accepted. `G-03` passed; `G-04` reported
  255 pass/0 fail; `G-05` reported 207 pass/0 fail; `G-06` passed with 994
  tests, 95 suites, 994 pass, 0 fail, 0 skipped, 0 cancelled, and 0 todo;
  `G-07` passed. Canonical `main.js` is 362668 bytes, SHA-256
  `8d547fe268cf3ed4ebc1345675a36b2d906318d6f4a501cdaba9f5b2ef6a4780`.
  Generated scope is limited to that required bundle. `unit-03` remains
  parked pending user-run Steam move/placement evidence.
