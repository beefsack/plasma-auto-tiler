# Plan: Pointer Interactive Resize

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-25 by user; semantic plan and artifact creation approved by Orchestrator
- Commit/push: agent commits false; agent pushes false; user commit required; staging prohibited until final completion; cleanup owner Lead; candidate preservation none unless triggered

## Technical Approach

Treat KWin 6.7.4 as the native pointer-resize authority. A supported tiled
resize enters and finishes through the watched interactive lifecycle without a
stepped signal. The controller owns only a separate observation transaction and
must never write tile geometry or ratios, infer cancellation, restore state,
assign focus, reconstruct topology, or normalize reflow.

The fixture contract owns simulated KWin mutations and is accepted before
controller integration. Finish observes the final native topology only when the
window remains valid and in scope. Invalidation or scope transition clears the
observation transaction without mutation.

## Gate Evidence Map

| ID | Type | Literal command or observation | Current baseline | Expected result |
|---|---|---|---|---|
| R-00 | static | KWin 6.7.4 realized source tarball: version `6.7.4`, fixed hash `sha256-23p9unGqyh5SGHM7gPkKmY2E4qs25NYtDj6gA3bFgC0=` | proved during approved investigation | source contract remains the implementation target |
 | R-01 | static | `ATTEMPT=/tmp/opencode/pointer-signal-contract-promotion-dd4449705-20260827 && WORKTREE="$ATTEMPT/worktree" && mkdir -p "$ATTEMPT/output" && (cd "$WORKTREE/kwin" && ./node_modules/.bin/esbuild "tests/controller-drag-diagnostics-and-resize.test.ts" --bundle --platform=node --format=cjs --target=es2020 --outfile="$ATTEMPT/output/pointer-resize-focused.cjs" && node --test --test-name-pattern='^TileController native pointer resize$' "$ATTEMPT/output/pointer-resize-focused.cjs")` | exit 0; 1 focused test passed, 0 failed | focused fixture passes |
 | R-02 | static | `ATTEMPT=/tmp/opencode/pointer-signal-contract-promotion-dd4449705-20260827 && WORKTREE="$ATTEMPT/worktree" && npm_config_cache="$ATTEMPT/npm-cache" npm_config_update_notifier=false npm --prefix "$WORKTREE/kwin" run typecheck` | exit 0 | pass |
| R-03 | static | `bash scripts/build-kpackage.test.sh` | exit 0 | pass |
| R-04 | static | `bash scripts/start-test.test.sh` | exit 0; 255 passes | pass |
| R-05 | static | `bash scripts/live-test.test.sh` | exit 0; 207 passes | pass |
| R-06 | static | `npm --prefix kwin test` | exit 0; 994 passes, 0 failures | pass |
| R-07 | static | `npm --prefix kwin run build` then `wc -c kwin/contents/code/main.js` and `sha256sum kwin/contents/code/main.js` | exit 0; 362668 bytes; `8d547fe268cf3ed4ebc1345675a36b2d906318d6f4a501cdaba9f5b2ef6a4780`; no bundle diff | pass; only `kwin/contents/code/main.js` generated |
 | R-08 | static | `ATTEMPT=/tmp/opencode/pointer-signal-contract-promotion-dd4449705-20260827 && WORKTREE="$ATTEMPT/worktree" && mkdir -p "$ATTEMPT/output" && (cd "$WORKTREE/kwin" && ./node_modules/.bin/esbuild "tests/controller-drag-diagnostics-and-resize.test.ts" --bundle --platform=node --format=cjs --target=es2020 --outfile="$ATTEMPT/output/pointer-resize-signal-contract.cjs" && node --test --test-name-pattern='^TileController native pointer resize signal contract$' "$ATTEMPT/output/pointer-resize-signal-contract.cjs")` | exit 0; 1 focused test passed, 0 failed | signal-contract fixture/harness passes |
| R-09 | static | `cd kwin && ./node_modules/.bin/esbuild "tests/controller-drag-diagnostics-and-resize.test.ts" --bundle --platform=node --format=cjs --target=es2020 --outfile=/tmp/opencode/pointer-resize-observer-integration.cjs && node --test --test-name-pattern='^TileController native pointer resize observer integration$' /tmp/opencode/pointer-resize-observer-integration.cjs` | exit 0; 1 focused test passed, 0 failed | observer integration passes |
| L-01 | live | `bash scripts/live-test.sh run` | blocked: no authorized disposable/restoration layout | user-authorized live evidence recorded |

## Work Units

| ID | Objective | Depends on | Scope | Verification |
|---|---|---|---|---|
| unit-01 | Add and independently accept a KWin 6.7.4 native pointer-resize fixture contract. | R-00 and recorded baselines | Focused test fixture only; native mutation model owns all tile writes. | R-01, R-02 |
| recovery-c | Construct and independently verify checkpoint C before destructive restoration. | accepted unit-01 and user-approved reset-02 preservation authorization | Isolated temporary context only; reconstruct accepted unit-01 behavior in the two test paths and prove the ordered container reconstructs the current composite snapshot. | R-01, R-02 |
| unit-02 | Historical parked controller integration. | unit-01 | Frozen unaccepted source candidate; no source work, correction, repair, or relabelled retry. | historical R-01, R-02 evidence only |
| unit-02a-signal-contract | Independently accept the KWin 6.7.4 signal-contract fixture/harness. | recovery-c | `kwin/tests/controller-fixtures.ts` and `kwin/tests/controller-drag-diagnostics-and-resize.test.ts` only. Fixture/harness owns source-proven signal arity and subscription cleanup; no production workaround. | R-01, R-08, R-02 |
| unit-02b-observer-integration | Add the reset-02 isolated controller observer integration. | unit-02a-signal-contract | `kwin/src/controller-interactive-drag.ts`, `kwin/src/entry.ts`, `kwin/src/kwin-globals.d.ts`, and closest controller test only. It cannot modify the accepted fixture contract. | R-09, R-02 |
| unit-03 | Run static integration checkpoint and review generated scope. | unit-02b-observer-integration | Static verification and canonical bundle only. | R-03, R-04, R-05, R-06, R-07 |
| unit-04 | Run user-authorized live acceptance. | unit-03 and explicit user authorization | Exact disposable/restoration layout and live protocol only. | L-01 |

## Fixture and Review Boundaries

- `unit-01` is independently accepted before `unit-02`; production integration
  cannot work around a fixture failure.
- Checkpoint C is a freshly verified accepted-source reconstruction, not an
  assertion that a historical Git snapshot existed. Its base-to-C patch changes
  only the two unit-01 test paths; C and the C-to-current parked delta must
  reconstruct the complete candidate in an isolated base context before active
  restoration.
- `unit-02a-signal-contract` is independently accepted before
  `unit-02b-observer-integration`. It owns only source-proven signal arity and
  deterministic subscription cleanup. KWin retains native geometry, ratio,
  divider, reflow, floor, rounding, and final-state ownership.
- The user-approved no-progress waiver permits exactly one semantic dispatch of
  `unit-02a-signal-contract`. It permits no correction, retry, finding-fix, or
  subsequent unit dispatch on failure. Only accepted first-time signal-contract
  evidence may earn `acceptance_criterion_newly_met` and reset no-progress.
- `unit-01/reset-01` treats KWin internal tile-write sequence as
  non-contractual. Acceptance instead requires identity-keyed final per-tile
  geometry and ratios, correct subject/neighbor write ownership and counts
  without order, ordinary edge/corner finish state, and in-flight invalidation
  cleanup.
- Review is required for a controller geometry/ratio write, cancellation
  inference, tiled stepped-signal dependency, fixture/production ownership
  crossover, or scope/topology mutation at finish.
- Rollback removes the isolated observation lifecycle and regenerates only
  `kwin/contents/code/main.js`; no persisted-data migration exists.

## Live Gate Contract

`L-01` is blocked until the user authorizes one exact attempt and supplies a
disposable layout or restoration boundary. Before mutation, confirm KWin 6.7.4,
one KWin process, initial output/desktop/tile geometry, a fresh nonce, and a
journal cursor. Validate edges, corners, nested and multi-child reflow, floor,
Escape final state, and fullscreen/float/maximize/workspace/output guards.

## Progress

- [x] unit-01 - accepted 2026-08-25 after reset-01 final-state confirmation
- [ ] unit-02 - parked: finding-fix-01 R-02 failed; third implementation attempt without acceptance movement
- [x] recovery-c - accepted 2026-08-25: isolated checkpoint C and ordered candidate verified; active source restored to C
- [x] unit-02a-signal-contract - accepted, committed, and pushed as `e9f71aa35c4058ca37fc31cce7753b6f949597ae` after the bounded correction, fresh R-08/R-01/R-02 evidence, and clean independent review
- [ ] unit-02b-observer-integration - parked: independent-review F-01 remains open at the frozen `handleStarted` stale-drag invariant after the sole finding-fix correction; no retry is authorized
- [ ] unit-03 - blocked by parked unit-02b
- [ ] unit-04 - blocked: explicit user live authorization and disposable/restoration layout

## Attempt Accounting

- Change-wide implementation dispatches: 10
- Change-wide dispatch-invalid results: 0
- Change-wide pre-review corrections: 2
- Change-wide finding-fix corrections: 3
- Change-wide independent reviews: 4
- Change-wide changed-kind resets: 2 (reset-02 is user-approved exceptional override; no source dispatch yet)
- Change-wide broad-gate runs: 1
- Change-wide acceptance criteria moved: 2
- Change-wide no-progress streak: 1
- Change-wide verification/harness repair claims: 0
- Read-only baseline dispatches: 2 (not implementation attempts; first stopped at R-02, second passed R-02 through R-07)
- unit-01: 2 attempts; 0 pre-review corrections; 1 finding-fix correction; 1 independent review
- unit-02: 3 attempts; 1 pre-review correction; 1 finding-fix correction; 1 independent review; parked
- unit-02a-signal-contract: 1 semantic attempt; 1 pre-review correction; 0 finding-fix corrections; 1 independent review; accepted
- unit-02b-observer-integration: 1 semantic attempt; 0 pre-review corrections; 1 finding-fix correction; 1 independent review; parked with F-01 open
- unit-03: 0 attempts
- unit-04: 0 attempts

## Acceptance-Criterion Evidence

| Acceptance criterion | Required evidence | Status |
|---|---|---|
| KWin-native contract is version-pinned | R-00 source observation | met |
| Native fixture safely isolates KWin mutation ownership | R-01 and R-02; original finding set under reset-01 final-state evidence boundary | met |
| Controller observes without mutating | R-09/R-02/R-01 from the unit-02b isolated post-finding-fix snapshot; frozen F-01 confirmation | pending: gates pass, but F-01 remains open |
| Signal-contract fixture/harness is independently accepted | R-01, R-08, R-02; checkpoint C source/output correspondence and mandatory independent review | met: R-08/R-01/R-02 pass after the bounded correction; independent review clean |
| Static integration remains sound | R-02 through R-07 | baseline passes; rerun required after integration |
| Live behavior is accepted | L-01 user evidence | blocked |

## Residual Risks

- Backend signal timing and invalidation timing require live evidence.
- Independent review F-01 requires controller-side output/tile invalidation
  coverage and may require the watcher to clear resize observation on tile
  invalidation. F-02 requires direct controller release-completion coverage.
  The one authorized finding-fix added both but R-02 now rejects test wiring of
  the native fixture's payload-free output/tile signals to `TestSignal1<unknown>`
  fields. The user authorized exactly one bounded pre-review correction limited
  to the frozen signal-contract target and the two unit-02a test paths. F-03
  corrected this record's stale payload-typing risk statement; declarations,
  adapter, harness, and focused tests now type start/finish payload-free.
- KWin internal tile-write sequence is not an acceptance contract. `reset-01`
  retains the fixture's final-state ownership evidence and removes only ordered
  native-write acceptance. R-01 and R-02 pass; the original finding set and
  reset regressions are confirmed clear.
- The historical ledger records no-progress streak 3 while contemporaneous
  source dispatches include known correction classes. Preserve the recorded
  streak rather than retroactively recalculate it; the reset-02 waiver is one
  bounded exception and does not clear it.
- The 2026-08-26 amendment permits no semantic retry, reset, repair
  reclassification, broader waiver, or further correction after this one
  pre-review correction. It must reproduce R-08 before editing, then rerun
  R-08, R-01, and R-02 with current source/output correspondence.
- `unit-02b` independent review F-01 remains open after its sole finding-fix
  correction: resize start records observer state but still reaches the shared
  stale-drag clear/invariant-settlement branch. The post-fix R-09 test covers a
  live-drag crossover, release/Escape, output/tile invalidation, and emitted
  stepped suppression, but does not cover this stale-drag branch. A second
  finding-fix would be required, so the unit is parked rather than accepted.

## Current Correction Evidence

- The immediate pre-edit R-08 snapshot is
  `/tmp/opencode/unit-02a-r08-before/` at Git revision
  `6466c99dd497779d8499e0fef41cc5618593bff2`; its assertion compared the
  complete watcher result to `{ ok: 7, failed: 0 }` and failed because the
  result also carries `disconnect`.
- The corrected source snapshot is
  `/tmp/opencode/unit-02a-canonical-20260826/`, reconstructed from that Git
  revision with only the two allowed current test paths. Its source hashes are
  `118c29b6cbfc216e743c1e5c3ba01820cc23d8cc9ab446be2cd4740106dfdec9`
  for `controller-fixtures.ts` and
  `d4b5a8725f75c079ca71e048710d03984a217a93f52f2be99c3d776a4336a91f`
  for `controller-drag-diagnostics-and-resize.test.ts`, matching active source.
- R-08 and R-01 were rerun with their literal commands from that snapshot and
  generated only `/tmp/opencode/pointer-resize-signal-contract.cjs` and
  `/tmp/opencode/pointer-resize-focused.cjs`: each exited 0 with 1 focused test
  passed and 0 failed. R-02 `npm --prefix kwin run typecheck` exited 0 there.
  `kwin/node_modules` was the repository-managed read-only dependency input;
  no source changed after these outputs. `git diff --check` passed.
- Independent review `unit-02a-signal-contract/independent-review-01` found no
  signal-arity, cleanup, ownership, scope, or source/output-correspondence
  issue. The active source hashes still match the corrected snapshot after that
  review; this first-time independently accepted signal-contract evidence earns
   `acceptance_criterion_newly_met` and resets the no-progress streak.

## Unit-02a Promotion Record

- The Orchestrator-approved promotion exception permits only a source-hash-bound
  reconstruction of accepted `unit-02a-signal-contract` bytes into the index:
  whole `kwin/tests/controller-fixtures.ts` at
  `118c29b6cbfc216e743c1e5c3ba01820cc23d8cc9ab446be2cd4740106dfdec9` and
  only the accepted signal-contract hunks of
  `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`, producing
  `d4b5a8725f75c079ca71e048710d03984a217a93f52f2be99c3d776a4336a91f`.
- The mixed working-tree `unit-02b-observer-integration` delta is unsealed and
  prohibited from staging, editing, preservation action, or evidence use. The
  promotion snapshot is detached `dd4449705b5366c0257ec4db1c4d180773c230c2`
  plus exactly the reconstructed index candidate at
  `/tmp/opencode/pointer-signal-contract-promotion-dd4449705-20260827/worktree`.
- For this promotion verification only, R-08, R-01, and R-02 use the literal
  nonce-owned commands in the gate table. They retain their accepted baselines,
  coverage, and static classification; no pointer semantic scope, implementation
  source, review finding, or parking status changes. The active pointer records
  remain unstaged.

## Reset-02 Preservation and Evidence

- One ordered preservation container is authorized at
  `unit-02-reset-02-candidate.tar`, retained through 2026-09-08. It contains a
  base-to-C accepted unit-01 checkpoint patch, a C-to-current parked unit-02
  delta patch, and a manifest. Container SHA-256:
  `20459f88e167342f175923322c57fde0e1f9104e288e7f89e85039ede4f2010a`.
- The manifest binds base `6466c99dd497779d8499e0fef41cc5618593bff2`, component
  and container SHA-256 values, ordered application proof, tracked/untracked
  inventory, source/output correspondence, reason, owner, retention, deadline,
  cleanup owner, and cleanup disposition. Lead owns cleanup; removal requires
  explicit completion or container-cleanup approval.
- Candidate paths are `kwin/src/controller-interactive-drag.ts`,
  `kwin/src/entry.ts`, `kwin/src/kwin-globals.d.ts`,
  `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`, and
  `kwin/tests/controller-fixtures.ts`; all are tracked. `docs/backlog.md`,
  pointer process artifacts, COSMIC preservation records/container, and
  unrelated untracked paths are excluded and protected.
- Each gate row binds Git revision, scoped diff, relevant untracked inputs,
  literal command, expected baseline, output reference, result, and freshness.
  Temporary focused bundles are output artifacts, not source inputs.
- Checkpoint C was reconstructed from the base in isolation with scoped-files
  digest `6b00a03052087f37e5e5570b193a64476531dd70252b1f2726450388722ed465`.
  R-01 passed with 1 focused test and 0 failures, and R-02 exited 0. Its
  base-to-C component SHA-256 is
  `88da3cdba5cbdb6bd3a40f070279c943ce090dfda91024da7f4c2ea6aab1743e`;
  C-to-current is
  `e46d69ba2580f43f696e36cddcf1471814ca98099a0f9b0fc5789c81e06a83f2`.
- The retained container binds the pre-waiver C-to-current parked candidate.
  The later failed unit-02a test-only delta remains active and unsealed because
  a second preservation container is prohibited and no replacement-container or
  destructive restoration authorization exists. Its snapshot evidence is under
  `/tmp/opencode/unit-02a-signal-contract/`; no acceptance relies on it.
- Lead reconciliation 2026-08-25: the active unsealed `unit-02a` delta is
  limited to tracked `kwin/tests/controller-fixtures.ts` and
  `kwin/tests/controller-drag-diagnostics-and-resize.test.ts`. It is owned by
  the parked pointer change and may not be edited, restored, deleted, staged,
  or included in other work. The existing container remains the sole immutable
  preservation container; no cleanup disposition is authorized.

## Unit-02b Evidence

- `unit-02b/attempt-01` added a fresh isolated observer candidate in the four
  approved paths. Its regression-first R-09 failed before implementation, then
  R-09, R-02, and original-target R-01 passed from
  `/tmp/opencode/unit-02b-observer-integration/post/` at revision
  `6466c99dd497779d8499e0fef41cc5618593bff2`.
- Mandatory independent review froze F-01 (resize start/finish/invalidation
  crossover into move-drag state) and F-02 (tiled stepped suppression). The
  sole finding-fix reran R-09/R-02/R-01 from
  `/tmp/opencode/unit-02b-observer-integration/finding-fix-01/post/`; all
  passed, the four post hashes match active source, and the immutable fixture
  remains `118c29b6cbfc216e743c1e5c3ba01820cc23d8cc9ab446be2cd4740106dfdec9`.
- Lead confirmation closed F-02 but found F-01 still open in
  `handleStarted`: the observer add does not return before stale move-drag
  cleanup. No acceptance credit applies. The retained old candidate is not
  evidence for this unit.

## Reconciliation

- `unit-02a-signal-contract` is the accepted pointer fixture/harness record
  published in `e9f71aa35c4058ca37fc31cce7753b6f949597ae`.
- `unit-02b-observer-integration` remains unaccepted with F-01 frozen at the
  `handleStarted` stale-drag invariant. Its sole finding-fix correction is
  spent; no retry, correction, or repair is authorized. `unit-03` and live work
  remain blocked by that parked unit and the existing live prerequisites.
