# COSMIC Controller-Path Directional Movement Plan

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-25 by Orchestrator; reset semantic amendment approved 2026-08-27 under autonomous implementation authorization

Semantic sections are approved. Record-keeping sections are Lead-owned.

## Technical Approach

First independently accept COSMIC-local fixture support in
`kwin/tests/cosmic-fixture.ts` and
`kwin/tests/cosmic-fixture-contract.test.ts`. Each immutable vector receives a
fresh harness, recursive mutable native-like topology, and observer-only
decode/snapshot oracle. Fixture self-tests cover controlled opaque/reversed/stale
ambiguity, failure primitives, exact restoration, unassigned-window rejection,
cyclic-child rejection, isolated mutable defaults, and stale-root-parent
rejection without constructing a controller, invoking shortcuts, or exercising
production runtime operations. These paths must not import, modify, or take
ownership from `kwin/tests/controller-fixtures.ts`.

Only then compose the controller-owned adapter and exercise the controller path:
registered shortcut -> controller feature/scope/guard decision -> adapter ->
accepted COSMIC runtime -> native mutation -> fresh decode/postconditions ->
focus or verified recovery. The host checkpoint follows static integration but
remains blocked until Unit 04's vector, reset, observation, privacy, and
pass/fail protocol receives separate approval.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Gates | Expected baseline |
|---|---|---|---|---|---|
| `unit-01-cosmic-local-fixture` | Implement and independently accept a COSMIC-local fixture/oracle: fresh-per-vector recursive mutable native-like state; fresh decode/snapshot; opaque/reversed/stale ambiguity; split, malformed topology, assignment, stale state, duplicate occupancy, focus, and restoration-write failure primitives; exact restoration; unassigned-window, cyclic-child, shared-mutable-default, and stale-root-parent rejection. | Reset amendment approval and clean isolated `HEAD` snapshot | New paths only: `kwin/tests/cosmic-fixture.ts` and `kwin/tests/cosmic-fixture-contract.test.ts`. No imports from or edits to `kwin/tests/controller-fixtures.ts`; no controller, adapter, production runtime, catalog, profile, candidate patch, or host work. | G-01, G-02, G-03, G-04 | Regression/new-behavior tests first; focused and typecheck gates clean; keyboard lock unchanged; broad static checkpoint has zero failures/skips. |
| `unit-02-controller-adapter` | Compose the narrow controller-owned adapter and accept controller-path conformance: `TileController.start()`, registered canonical and arrow-alias shortcuts, R1-R4/S1-S4, native-result variants, injected production-operation failures, focus/occupancy postconditions, and exact restoration assertions. | `unit-01-cosmic-local-fixture` accepted | Only `kwin/src/controller.ts`, new `kwin/src/controller-directional-movement.ts`, and new `kwin/tests/controller-cosmic-directional-movement.test.ts`. The accepted COSMIC-local fixture/oracle is read-only input only. | G-02-01 through G-02-04 | No ownership leakage or fallback; existing shortcut registration and static integration remain Unit 03 work. |
| `unit-03-static-integration` | Run preservation and broad static integration acceptance. | `unit-02-controller-adapter` accepted | Approved directional path and static evidence only. | G-05, G-06 | Recorded baseline remains clean with no regression. |
| `unit-04-host-protocol` | Propose the exact host vector/reset/evidence protocol. | `unit-03-static-integration` accepted | Change-local host checkpoint procedure and its evidence schema. No host operation. | G-07 to G-09 remain blocked | Orchestrator sign-off and user approval are required before finalization. |
| `unit-05-host-checkpoint` | Execute the approved user-operated host controller-path corpus. | `unit-04-host-protocol` separately approved | Approved host protocol only. | G-07, G-08, G-09 | Every approved vector passes; cleanup succeeds; no synthetic input. |

## Gates

| Gate ID | Classification | Literal canonical command or observation | Expected baseline |
|---|---|---|---|
 | G-01 | Static | `ATTEMPT=/tmp/opencode/cosmic-fixture-promotion-dd4449705-20260827-retry-01 && WORKTREE="$ATTEMPT/worktree" && npm_config_cache="$ATTEMPT/npm-cache" npm_config_update_notifier=false npm --prefix "$WORKTREE/kwin" run typecheck` | Clean exit. |
 | G-02 | Static | `ATTEMPT=/tmp/opencode/cosmic-fixture-promotion-dd4449705-20260827-retry-01 && WORKTREE="$ATTEMPT/worktree" && mkdir -p "$ATTEMPT/output/g02" && "$WORKTREE/kwin/node_modules/.bin/esbuild" "$WORKTREE/kwin/tests/cosmic-fixture-contract.test.ts" --bundle --platform=node --format=cjs --target=es2020 --outfile="$ATTEMPT/output/g02/cosmic-fixture-contract.test.js" && (cd "$WORKTREE" && node --test "$ATTEMPT/output/g02/cosmic-fixture-contract.test.js")` | All COSMIC-local fixture-contract self-tests pass with zero failures/skips. |
 | G-03 | Static | `ATTEMPT=/tmp/opencode/cosmic-fixture-promotion-dd4449705-20260827-retry-01 && WORKTREE="$ATTEMPT/worktree" && sha256sum "$WORKTREE/kwin/tests/controller-keyboard-move-and-swap.test.ts"` | `2ec613d2c9ed7b8fc3c00981b6ee1e3e67ee88bf34ff6ac3169eb21ba99a2dc7`. |
 | G-04 | Static | `ATTEMPT=/tmp/opencode/cosmic-fixture-promotion-dd4449705-20260827-retry-01 && WORKTREE="$ATTEMPT/worktree" && mkdir -p "$ATTEMPT/output/g04/tests" && "$WORKTREE/kwin/node_modules/.bin/esbuild" "$WORKTREE/kwin/tests/*.test.ts" --bundle --platform=node --format=cjs --target=es2020 --outdir="$ATTEMPT/output/g04/tests" && (cd "$WORKTREE" && node --test "$ATTEMPT/output/g04/tests/**/*.test.js") && bash "$WORKTREE/scripts/start-test.test.sh"` | All bundled static tests, including the new fixture contract, pass with zero failures/skips; 1006 static tests pass; lifecycle shell gate remains 255 assertions, 0 failures. |
| G-02-01 | Static | `ATTEMPT=/tmp/opencode/cosmic-controller-adapter-6466c99-20260826T213005Z-68811 && WORKTREE="$ATTEMPT/worktree" && mkdir -p "$ATTEMPT/output/g02-01" && "$WORKTREE/kwin/node_modules/.bin/esbuild" "$WORKTREE/kwin/tests/controller-cosmic-directional-movement.test.ts" --bundle --platform=node --format=cjs --target=es2020 --outfile="$ATTEMPT/output/g02-01/controller-cosmic-directional-movement.test.js" && node --test "$ATTEMPT/output/g02-01/controller-cosmic-directional-movement.test.js"` | All controller-path conformance tests pass with zero failures/skips. |
| G-02-02 | Static | `ATTEMPT=/tmp/opencode/cosmic-controller-adapter-6466c99-20260826T213005Z-68811 && WORKTREE="$ATTEMPT/worktree" && npm_config_cache="$ATTEMPT/npm-cache" npm_config_update_notifier=false npm --prefix "$WORKTREE/kwin" run typecheck` | Clean exit. |
| G-02-03 | Static | `ATTEMPT=/tmp/opencode/cosmic-controller-adapter-6466c99-20260826T213005Z-68811 && WORKTREE="$ATTEMPT/worktree" && sha256sum "$WORKTREE/kwin/tests/controller-keyboard-move-and-swap.test.ts"` | `2ec613d2c9ed7b8fc3c00981b6ee1e3e67ee88bf34ff6ac3169eb21ba99a2dc7`. |
| G-02-04 | Static | `ATTEMPT=/tmp/opencode/cosmic-controller-adapter-6466c99-20260826T213005Z-68811 && WORKTREE="$ATTEMPT/worktree" && mkdir -p "$ATTEMPT/output/g02-04/tests" && "$WORKTREE/kwin/node_modules/.bin/esbuild" "$WORKTREE"/kwin/tests/*.test.ts --bundle --platform=node --format=cjs --target=es2020 --outdir="$ATTEMPT/output/g02-04/tests" && node --test "$ATTEMPT/output/g02-04/tests"/*.test.js && bash "$WORKTREE/scripts/start-test.test.sh"` | All bundled static tests pass with zero failures/skips; the pre-Unit-02 corpus remains 1003 passing tests and the increase is only named Unit 02 conformance tests; lifecycle shell gate remains 255 assertions, 0 failures. |
| G-05 | Static | `npm --prefix kwin run typecheck && npm --prefix kwin run build && npm --prefix kwin test` | Typecheck clean; pre-reset baseline 994 tests in 95 suites, 0 failures, 0 skipped; rerun required by Unit 03. |
| G-06 | Static | `bash scripts/start-test.test.sh` | 255 assertions, 0 failures; rerun required by Unit 03. |
| G-07 | Live, blocked | `bash scripts/live-test.sh run` | Pending Unit 04 approval: same-PID readiness, registration, diagnostics, error capture, and cleanup observations. |
| G-08 | Live, blocked | User manually performs each approved physical shortcut vector; agent records only the approved observation schema. | Pending Unit 04 approval: approved topology, occupancy, focus, diagnostics, reset, and pass/fail observations. |
| G-09 | Live, blocked | `bash scripts/start-test.sh stop` | Pending Unit 04 approval: runner-owned cleanup succeeds; no unsupported Custom Tile restoration claim. |

## Evidence Snapshots

  - `S-01-pre`: detached clean worktree at `/tmp/opencode/cosmic-fixture-promotion-dd4449705-20260827-retry-01/worktree`, `HEAD` revision `dd4449705b5366c0257ec4db1c4d180773c230c2`, and a symlink to the root repository's managed `kwin/node_modules` consumed read-only; scoped diff is empty for the two allowed COSMIC-local paths; relevant untracked inputs are none.
   - `S-01-post`: the same detached worktree revision plus only the scoped diff and untracked inputs for `kwin/tests/cosmic-fixture.ts` and `kwin/tests/cosmic-fixture-contract.test.ts`.
  - `S-02-pre`: a fresh detached worktree at `/tmp/opencode/cosmic-controller-adapter-6466c99-20260826T213005Z-68811/worktree`, base revision `6466c99dd497779d8499e0fef41cc5618593bff2`, the accepted workspace-floor hunk in `kwin/src/controller.ts` byte-identical, and the accepted COSMIC-local fixture/oracle paths as the only relevant untracked inputs. `kwin/node_modules` is a read-only-use symlink to the verified repository-managed locked dependency tree.
  - `S-02-post`: `S-02-pre` plus only new `kwin/src/controller-directional-movement.ts`, new `kwin/tests/controller-cosmic-directional-movement.test.ts`, and the Unit 02-only hunk in `kwin/src/controller.ts`; source correspondence proves the workspace-floor hunk unchanged.
    - G-01 through G-04 evidence must bind one of these snapshots, the literal command, exact output path under `/tmp/opencode/cosmic-fixture-promotion-dd4449705-20260827-retry-01`, result, and a post-latest-change freshness check. G-02-01 through G-02-04 must bind S-02-pre or S-02-post, their literal command, exact output path under `/tmp/opencode/cosmic-controller-adapter-6466c99-20260826T213005Z-68811`, result, and a post-latest-change freshness check. The gate commands must not install or update dependencies or write within `kwin/node_modules`. No generated output may be written outside its nonce-owned attempt directory.

## Verification-Only Gate Amendment

- Approved 2026-08-27 by the Orchestrator under autonomous implementation authorization. For the one authorized `unit-01-cosmic-local-fixture` ordinary pre-review correction only, G-01 through G-04 bind the fresh nonce-owned `/tmp/opencode/cosmic-fixture-correction-6466c99-20260826T144407Z` attempt directory and its `worktree`, `output`, and `npm-cache` children. The former shared gate-output directories and all existing evidence remain preservation-protected and must not be read, overwritten, or removed.
- This changes only gate output isolation. Acceptance semantics, gate baselines, fixture contract, approved source scope, and downstream dependencies remain frozen. Commands may create, overwrite, or delete only within this newly created attempt directory. After evidence is retained, destructive cleanup is authorized only within this attempt directory.

## Unit 02 Gate Correction

- Approved 2026-08-27 by the Orchestrator under autonomous implementation authorization. G-02-04's Node 24-incompatible directory operand is replaced only by the shell-expanded output-file operand `node --test "$ATTEMPT/output/g02-04/tests"/*.test.js`.
- Esbuild still receives the same shell-expanded source test inputs and emits to the same nonce-owned directory. The replacement executes every resulting `*.test.js` bundle, preserves equivalent full bundled-test coverage and every baseline, and does not change Unit 02 source scope, fixture ownership, runtime behavior, acceptance, or dependencies.

## Fixture/Harness Contract

| Contract evidence | Gate | Required result |
|---|---|---|
| State ownership and isolation | G-02 / `unit-01-cosmic-local-fixture` | Fresh COSMIC-local harness, topology, callbacks, logs, and injectors for every immutable vector; no shared fixture import or ownership. |
| Recursive child behavior | G-02 / `unit-01-cosmic-local-fixture` | Stateful recursive native-like topology with parent, layout, geometry order, tile/window links, and live mutation behavior; cyclic children and stale root parents reject before recursive observation. |
| Fixture ambiguity primitives | G-02 / `unit-01-cosmic-local-fixture` | Controlled opaque return, reversed live order, and stale handle variants without production inference or reuse. |
| Fixture decode, snapshot, and failure primitives | G-02 / `unit-01-cosmic-local-fixture` | Fresh decode and exact snapshot oracle; controlled split, malformed topology, assignment, stale state, duplicate occupancy, focus, and restoration-write failure primitives fail closed. Unassigned windows reject and nested mutable defaults are isolated. |
| Public route | G-02 / Unit 02 | `TileController.start()`, readiness/registration checks, then registered canonical and arrow shortcut invocation only. |
| R1-R4 and S1-S4 matrix | G-02 / Unit 02 | Every applicable rule/sizing cell in each direction, with canonical/alias parity. |
| Production ambiguity and failure handling | G-02 / Unit 02 | Controller-path coverage handles opaque/reversed/stale native results and injected production-operation failures without inference, reuse, or fallback. |
| Re-decode, restoration, focus, and occupancy | G-02 / Unit 02 | Fresh decode after structural operations; exact pre-invocation snapshot equality before restoration is claimed; moved focus, one occupancy per window, matching window/tile links, no unassigned or lost windows. |

## Independent Review

- `unit-01-cosmic-local-fixture`: COSMIC-local fixture state ownership, fresh isolation, recursive
  child mutation behavior, ambiguity primitives, failure primitives, fresh
  decode, exact snapshot/restoration oracle, and no direct production/runtime
  bypass.
- `unit-02-controller-adapter`: capability boundary, shortcut/guard ownership,
  public-route conformance, native-result handling, production failure recovery,
  fresh decode, focus/occupancy, restoration proof, no fallback, no topology
  inference, and no forbidden bypass.
- `unit-04-host-protocol`: vector/reset/evidence/privacy contract before live
  execution.
- Also trigger review for changed vector expectations, keyboard-lock drift,
  capability-boundary changes, direct-runtime evidence, synthetic input, or an
  unverified recovery claim.

## Progress

- [x] Baseline reconciliation
- [x] `unit-01-cosmic-local-fixture` - historically accepted after independent review, frozen finding-fix correction, and Lead confirmation; its fixture files remain untracked and uncommitted, and current promotion freshness is unmet
- [ ] `unit-02-controller-adapter` - attempt-01 paused for an Orchestrator scope decision; no shared-source promotion or review
- [ ] `unit-03-static-integration`
- [ ] `unit-04-host-protocol` - blocked pending later approval
- [ ] `unit-05-host-checkpoint` - blocked pending Unit 04 approval

## Attempt Accounting

Successor counters begin at zero. The prior parked change remains historical:
`03` 1/1/1, `03B` 1/1/0, checkpointed `03C` 1/1/0, and `03E` 1/0/0
(attempts/corrections/reviews). No historical counter transfers to this change.

| Unit | Implementation attempts | Pre-review corrections | Finding-fix corrections | Independent reviews | Breaker |
|---|---:|---:|---:|---:|---:|
| `unit-01-fixture-corpus` | 1 | 1 | 1 | 1 | 1 (retired unaccepted; candidate is audit/reference only) |
| `unit-01-cosmic-local-fixture` | 1 | 1 | 1 | 1 | 0 (accepted; F-01/F-02 closed by confirmation) |
| `unit-02-controller-adapter` | 1 | 0 | 0 | 0 | 0 (paused: controller runtime-capability boundary conflicts with frozen legacy-controller coverage) |
| `unit-03-static-integration` | 0 | 0 | 0 | 0 | 0 |
| `unit-04-host-protocol` | 0 | 0 | 0 | 0 | 0 |
| `unit-05-host-checkpoint` | 0 | 0 | 0 | 0 | 0 |

| Implementation dispatches | Dispatch-invalids | Pre-review corrections | Finding-fix corrections | Independent reviews | Changed-kind resets | Broad gate runs | Worker tool-call proxy | Lead tool-call proxy | Acceptance criteria moved | No-progress streak |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 3 | 1 | 2 | 2 | 2 | 1 | 5 | 4 + Unit 01 Workers unreported + Unit 02 attempt-01 unreported | 122 | 2 + G-02-01/G-02-02/G-02-03 canonical gates advanced | 0 |

## Startup VCS Policy

- Agent commits: no
- Agent pushes: no
- Staging owner: user at final completion only
- User commit required: yes
- Candidate audit/reference material: `docs/changes/2026-08-25-cosmic-controller-path-directional-movement/unit-01-candidate.patch` (SHA-256 `dbe28416517a1966ddf3d8a18e3a01700b83ab3c6bd6d183d4c8988d4c15a434`); non-authoritative and unaccepted, retained byte-for-byte, never read, applied, copied, altered, relabeled, or used as acceptance evidence.
- Cleanup owner: Lead / processed-beef process; active-source cleanup completed. The reset never modifies or imports ownership from `kwin/tests/controller-fixtures.ts`.

## Pending User Decisions

- Unit 04 may propose but cannot finalize the host vector table, manual reset,
  topology observation schema, privacy retention, or pass/fail baseline without
  Orchestrator sign-off and user approval. G-07 through G-09 cannot be dispatched
  before that approval.

## Acceptance-Criterion Evidence

| Acceptance criterion | Gate | Expected baseline | Evidence |
|---|---|---|---|
| Static type correctness | G-01 | Clean exit | Accepted baseline and Unit 01 pre-review evidence: clean exit. |
| COSMIC-local fixture support contract | G-01, G-02, G-03, G-04 | Typecheck clean; focused and broad fixture-contract tests pass with zero failures/skips; keyboard lock matches | Historically accepted: finding-fix evidence records amended isolated G-01 clean, G-02 9 tests, G-03 expected SHA-256, and G-04 1003 tests plus 255 lifecycle assertions. Current untracked/uncommitted promotion is not accepted: G-04 has no fresh passing evidence because its canonical output contract omitted package-relative paths and tray environment. |
| Controller-path conformance and restoration | G-02-01, G-02-04 | Controller-path vectors pass with zero failures/skips; fresh decoded recovery exactly equals its pre-invocation snapshot | G-02-01 passed in S-02 attempt-01: 5 named tests, zero failures/skips. G-02-04 is unmet; no recovery claim is accepted. |
| Locked keyboard coverage | G-02-03 | `2ec613d2c9ed7b8fc3c00981b6ee1e3e67ee88bf34ff6ac3169eb21ba99a2dc7` | G-02-03 passed in S-02 attempt-01. |
| Unit 02 static compatibility | G-02-02, G-02-04 | Typecheck clean; bundled static tests zero failures/skips; only named Unit 02 tests increase the 1003-test pre-unit corpus | G-02-02 passed in S-02 attempt-01. G-02-04 bundle completed but the canonical directory invocation failed and an equivalent expanded-file run exposed frozen legacy directional-controller failures due the absent runtime capability. |
| Lifecycle shell behavior | G-02-04, G-06 | 255 assertions, 0 failures | Pending Unit 02 broad recheck; G-06 rerun required by Unit 03. |
| Host controller readiness | G-07 | Pending Unit 04 approval | Blocked |
| Host vector behavior | G-08 | Pending Unit 04 approval | Blocked |
| Host cleanup | G-09 | Pending Unit 04 approval | Blocked |

## Residual Risks

- The exact host vector/reset observation protocol is unknown. Host work remains
  blocked rather than inferred.
- The prior read-only Worker opened excluded pure-model material. Its pure-model
  content is discarded and cannot establish successor acceptance; this planning
  scope breach consumed no successor implementation or correction budget.
- The consumed changed-kind reset retires the blocked shared-fixture Unit 01.
  Its candidate remains non-authoritative audit/reference material and cannot be
  read, applied, copied, altered, relabeled, or used as acceptance evidence.
- Unit 02 waits for the authorized Unit 01 promotion refresh and its independent
  correspondence review to pass. Downstream units remain blocked by Unit 02;
  pointer-owned paths and all host/live operations remain prohibited during this
  static phase.
- Unit 02's prior preflight was `dispatch-invalid`, not a semantic attempt or
  correction, because its then-approved semantic row supplied neither exact
  allowed paths nor literal controller-path gate commands and baselines. The
  Orchestrator approved this amendment under autonomous authorization on
   2026-08-27. The accepted Unit 01 dependency does not authorize candidate use
   or inference.
- Unit 02 attempt-01 remains unaccepted and ineligible evidence. The current
  authorization resolves its former capability blocker: it may carry
  `directionalMovement` through production controller composition and tests only
  as necessary, migrate locked legacy expectations to COSMIC, and retain no
  legacy fallback or dual route. The G-02-04 command correction remains part of
  the authorized static path.
- Unit 01 is historically accepted after the one authorized correction,
  independent review, and finding-fix confirmation, but its two fixture files
  remain untracked and uncommitted. The current promotion cannot reuse that
  acceptance: G-04 lacks fresh passing evidence because its canonical output
  contract omitted package-relative paths and tray environment. The sole reset
  is consumed; except for the current G-04-only refresh below, no second review,
  correction, or reset is authorized.

## Final Outcome

- Baseline accepted. The prior Unit 01 remains unaccepted and retired after its
  consumed finding-fix breaker. The approved single changed-kind reset
  historically accepted `unit-01-cosmic-local-fixture`; its untracked,
  uncommitted promotion lacks fresh G-04 evidence and remains unaccepted as a
  promotion. Unit 02 may proceed only under the current COSMIC replacement
  authorization; all later units and host work remain blocked by their recorded
  dependencies and approvals.

## Current Authorization

- One isolated refresh of the current Unit 01 promotion is authorized. It may
  correct only G-04 package-relative paths and tray environment. Run G-01,
  G-02, G-03, and G-04 from that isolated snapshot, then obtain independent
  source/output correspondence review. Any failure parks the promotion.
- Unit 02 is authorized to replace legacy directional expectations with COSMIC
  and to expand only as necessary to carry `directionalMovement` through
  production controller composition and tests. No legacy fallback is allowed.
- The old candidate remains prohibited: do not read, use, promote, relabel, or
  treat it as evidence. No live work or unrelated source scope is authorized.
