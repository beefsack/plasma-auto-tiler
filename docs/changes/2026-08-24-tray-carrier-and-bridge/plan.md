# Plan: Tray Carrier and Command/State Bridge

Ownership and approval:
- Owner: Lead
- Status: The Orchestrator approved the fixture-first contract and this pre-start
  production split on 2026-08-27. The split consumes no attempt or reset.

## Technical Approach

This is an Expanded fixture-first route because a tray carrier crosses KWin,
session D-Bus, resident-process, autostart, distribution, security, and
live-host boundaries. The approved carrier is an external Rust SNI helper plus a
separately proven supported command/state bridge to the KWin script. The script
not automatically a strict System Tray item.

The fixture contract proves only an outbound snapshot boundary. It has no action
whitelist beyond its one state method, no shell or input injection, and no
helper-to-KWin path. The helper must fail closed when KWin state is absent or
stale. COSMIC menu structure is inspiration only; its workspace behavior, active
hint, exact icon, styling, and dynamic shortcut display are not requirements.

## Contract And Scope

- Fixed public surface: session-bus service `org.plasmaautotiler.Tray`, object
  `/org/plasmaautotiler/Tray`, interface `org.plasmaautotiler.Tray1`, and only
  `PublishSnapshot(i schema, s generation, i revision, b enabled)` from KWin to
  helper.
- Allowed fixture semantics: schema `1`; generation `[a-z0-9-]{1,32}`;
  signed-int revision `-2147483648..2147483647`; boolean enabled; the exact
  owner, state transition, replay, transport-failure, and 30-second stale rules
  in `spec.md` Constraints.
- Allowed `unit-02a-bridge-contract-fixture` paths only:
  `test-fixtures/tray-bridge-v1.json` and
  `kwin/tests/tray-bridge-protocol.test.ts`. The test owns a fixture-local codec
  and state machine, imports no production module, and receives the fixture only
  through the explicit `TRAY_BRIDGE_FIXTURE` canonical-gate input.
- Prohibited: production bridge or Rust helper code, package or dependency
  changes, D-Bus registration, signals, actions, `OpenSettings`, shell or input
  execution, helper-to-KWin traffic, sender-auth claims, live operations, and
  unrelated tracked or untracked paths.
- `unit-02b-kwin-publisher` may modify `kwin/src/entry.ts` and
  `kwin/src/controller.ts`, and add `kwin/src/tray-publisher.ts` and
  `kwin/tests/tray-publisher.test.ts`. It reads
  `test-fixtures/tray-bridge-v1.json` only as a canonical test input and does not
  modify `kwin/contents/code/main.js`, `kwin/dist`, package manifests, or build
  scripts.
- `unit-02c-helper-endpoint` may modify `Cargo.toml` and `src/main.rs`, and add
  `Cargo.lock`, `src/lib.rs`, `src/tray_endpoint.rs`, and
  `tests/tray_endpoint.rs`. The root Rust crate owns the endpoint. `zbus` with
  its blocking API, plus only necessary Rust crate or dev dependencies for
  shared-fixture consumption, is permitted. No system dependency or
  `devenv.nix` change is permitted.
- Both production children preserve the sole public method and all fixture
  contract prohibitions. `unit-02b` observes `TileController.isEnabled`, uses a
  process-lifetime generation, publishes revision `0` at startup, increments on
  enabled transitions, heartbeats every 1,000 milliseconds, rolls generation at
  signed-int maximum, and treats heartbeat re-invocation as one-way retry.
  `unit-02c` owns endpoint validation, cache, freshness, and KWin owner
  observation; it observes before resolving the exact current KWin owner and
  accepts any semantically valid snapshot after owner reacquisition, including a
  valid different generation at a nonzero revision.

## Work Units

| ID | Objective | Depends on | File or subsystem scope | Gate IDs | Expected baseline |
|---|---|---|---|---|---|
| unit-01 | Historical governance reconciliation: record the active Tray decision for carrier, high-level bridge constraints, KCM ownership, distribution boundary, Rust-only scope, and bounded host authorization. | - | `docs/decisions.md`, product governance | `gate.user-governance`: user-approved written decisions | Decisions resolved and recorded. |
| unit-02a-bridge-contract-fixture | Independently prove the fixed state-only contract with a JSON fixture and local test codec/state machine. | unit-01 | Only `test-fixtures/tray-bridge-v1.json`, `kwin/tests/tray-bridge-protocol.test.ts` | `gate.tray-bridge-focused`: `ATTEMPT="$(mktemp -d /tmp/opencode/tray-bridge-focused-XXXXXXXX)" && (trap 'rm -rf "$ATTEMPT"' EXIT; export TRAY_BRIDGE_FIXTURE="$PWD/test-fixtures/tray-bridge-v1.json"; kwin/node_modules/.bin/esbuild kwin/tests/tray-bridge-protocol.test.ts --bundle --platform=node --format=cjs --target=es2020 --outfile="$ATTEMPT/tray-bridge-protocol.test.js" && node --test "$ATTEMPT/tray-bridge-protocol.test.js")` | Fixture conformance tests: 0 failures, 0 skips; `TRAY_BRIDGE_FIXTURE` is the exact source-snapshot fixture; the only generated bundle is under fresh nonce-owned `ATTEMPT`. |
| unit-02b-kwin-publisher | Implement the fixed one-way KWin snapshot publisher from the accepted fixture contract. | unit-02a-bridge-contract-fixture | `kwin/src/entry.ts`, `kwin/src/controller.ts`, new publisher and test paths named above | `gate.tray-publisher-focused`, `gate.tray-publisher-typecheck`, `gate.tray-publisher-build`, `gate.tray-publisher-broad` | Focused: 0 failures, 0 skips. Typecheck/build: exit 0. Broad: exit 0, 0 failures. |
| unit-02c-helper-endpoint | Implement the fixed Rust helper D-Bus endpoint, cache, freshness, and KWin owner-liveness boundary. | unit-02a-bridge-contract-fixture | Root Rust crate paths named above | `gate.tray-helper-static` | Format, tests, and check exit 0. |
| unit-02d-helper-lifecycle | Implement normal-path-only helper install/start/status/stop/remove lifecycle safety without changing the endpoint or publisher route. | unit-02c-helper-endpoint | Root Rust helper, focused lifecycle tests, and tray records | Rust/static, installer fixture, shell, package, and independent security gates | Lock before preflight; descriptor-safe ownership; exact PID binding; normal rollback; residual ambiguity fails closed; no durable recovery. |
| unit-03 | Implement the minimal Rust SNI helper, D-Bus menu, icon, whitelist, and fail-closed behavior. | unit-02b-kwin-publisher, unit-02c-helper-endpoint | Existing root helper crate only | `gate.sni-static`: command selected with the approved helper toolchain | Implementation not started. |
| unit-04 | Define and implement approved distribution, installation, autostart, update, and removal contracts. | unit-01, unit-03 | Approved packaging and installer boundary | `gate.package-static`: command selected after distribution approval | Implementation not started. |
| unit-05 | Run user-authorized live validation of registration, rendering, actions, state synchronization, restart recovery, and removal. | unit-02b-kwin-publisher, unit-02c-helper-endpoint, unit-03, unit-04 | User Plasma/KWin session | `gate.sni-live`: user-authorized live observation | Parked pending implementation and user-run live observation. |

## Progress

- [x] unit-01 historical governance reconciliation is accepted and recorded.
- [x] unit-02a-bridge-contract-fixture accepted after semantic attempt 2 under the approved fixture-delivery reset.
- [ ] unit-02b-kwin-publisher blocked pending reconciliation of concurrent
  `kwin/src/entry.ts` ownership, despite its accepted fixture dependency.
- [x] unit-02c-helper-endpoint accepted after semantic attempt 1, the approved
  nonce-build-directory gate amendment, host-unknown verification recovery, and
  closure of its one frozen startup owner-race finding.
- [x] unit-02d-helper-lifecycle accepted: ephemeral identity-checked
  command-duration rollback copies restore normal partial removal failures,
  while unsafe residue fails closed. Durable crash recovery remains excluded.
- [ ] unit-03 blocked on unit-02b.
- [ ] unit-04 blocked on unit-01 and unit-03.
- [ ] unit-05 blocked on units 02b-04 and user live authorization.

`unit-02a-bridge-contract-fixture` is the independently accepted fixture
dependency for both production children. The graph is
`unit-01 -> unit-02a-bridge-contract-fixture -> unit-02b-kwin-publisher ->
unit-03 -> unit-04 -> unit-05` and
`unit-02a-bridge-contract-fixture -> unit-02c-helper-endpoint -> unit-03`,
with unit-04 also depending on unit-01 and unit-05 on both production children.
It is acyclic. The pre-start split is not a changed-kind reset.

## Attempt Accounting

### F-03 Ruling

- The prior F-03 confirmation incorrectly attempted a post-implementation gate
  before its approved new test input existed. F-03 concerns only command
  destination and construction, not pre-existing source.
- It is closed by static command inspection: the literal
  `gate.tray-bridge-focused` command resolves
  `kwin/tests/tray-bridge-protocol.test.ts` from repository root and writes its
  only generated bundle to a freshly bound nonce-owned `/tmp/opencode` ATTEMPT
  path. Actual execution is fixture-unit acceptance evidence after the Worker
  creates that approved file. No pre-source gate is run.

### unit-02a Dispatch Preflight

- 2026-08-27: Valid before-source preflight for the first semantic attempt.
  Lead role and parent Orchestrator role match supplied metadata; Task capability,
  one Worker depth, and required `processed-beef-work-unit` availability are
  confirmed. The dispatched Worker receives `process_role=Worker`,
  `parent_process_role=Lead`, parent-recorded `agent_selector=worker-openai`,
  unspecified model preference, distinct host-persona metadata, and context
  budget `150000`.
- The accepted `unit-01` dependency, `unit-02a` two-path scope, and
  `gate.tray-bridge-focused`, `gate.tray-bridge-typecheck`, and
  `gate.tray-bridge-broad` IDs, literal commands, and expected baselines match
  the work-unit and evidence maps at lines 45-46 and 127-129. No packet repair
  was required.

### unit-02c Dispatch Preflight

- 2026-08-27: Pre-source dispatch is `dispatch-invalid`. Lead/Orchestrator and
  proposed Worker/Lead process roles, `worker-openai` parent selector,
  unspecified model preference, distinct host persona, 150000 budget, one-child
  Task depth, and `processed-beef-work-unit` availability reconcile. The accepted
  `unit-02a` dependency commit `925d3ab` is an ancestor, its graph edge is
  acyclic, and no production workaround is proposed. The authorized Rust paths
  have no concurrent working-tree owner.
- `gate.tray-helper-static` exactly matches its plan evidence-map ID, literal
  command, working directory, environment, and exit-zero baseline. The supplied
  implementation packet required staleness at 3000 milliseconds and revision 0
  for every new generation, so this pre-source result consumed no attempt,
  correction, or review counter. The user selected the accepted fixture semantics:
  30000-millisecond staleness; KWin revision 0 at startup and rollover; and
  helper acceptance of any semantically valid different generation, including
  `beta` revision 1 and a post-reacquisition `gamma` revision 1. The single
  repaired packet is ready for implementation dispatch after docs acceptance.
- 2026-08-27: One fresh independent read-only contract-consistency review found
  no findings. It confirmed the selected semantics across this plan, `spec.md`,
  and the accepted fixture vectors; scoped `git diff --check` passed. This docs
  review increments only the change-wide independent-review record.
- 2026-08-27: Successor-Lead preflight is `dispatch-invalid` before source work.
  The repaired packet's nonnegative revision rule conflicts with the accepted
  fixture transition that accepts generation `limits` at revision
  `-2147483648`. The semantic scope therefore cannot both consume the fixture
  and enforce the supplied rule. No Worker dispatch, packet repair, source
  change, or static gate run is authorized; escalation is required.
- 2026-08-28: The user explicitly authorized one fresh `unit-02c-helper-endpoint`
  implementation dispatch after the two recorded packet failures. Preflight is
  valid: Worker `process_role=Worker` and `parent_process_role=Lead` match;
  parent-recorded selector `worker-openai`, unspecified model preference, and
  distinct host persona are non-blocking metadata. One-child Task depth and
  `processed-beef-work-unit` availability reconcile. Accepted dependency
  `unit-02a` commit `925d3ab` is present and the graph remains acyclic. The
  mutable Rust paths have no concurrent owner. `gate.tray-helper-static`
  literally matches the approved command and its all-exit-zero baseline. This
  valid dispatch begins unit-02c semantic attempt 1; the prior two
  `dispatch-invalid` records remain budget-neutral and no further packet repair
  is authorized.

### Fixture-Delivery Reset

- 2026-08-27: The Orchestrator approved the sole changed-kind reset. It makes
  the test-only fixture location an explicit `TRAY_BRIDGE_FIXTURE` canonical-gate
  input rather than inferring it from a generated bundle's working directory.
  This changes the oracle/fixture-delivery acceptance mechanism only; it does
  not change the public route, security boundary, fixture semantics, typecheck,
  or the two approved fixture paths. The reset enables semantic attempt 2.

| Unit | Implementation attempts | Pre-review corrections | Finding-fix corrections | Independent reviews |
|---|---:|---:|---:|---:|
| unit-01 | 0 | 0 | 0 | 0 |
| unit-02a-bridge-contract-fixture | 2 | 0 | 1 | 1 |
| unit-02b-kwin-publisher | 0 | 0 | 0 | 0 |
| unit-02c-helper-endpoint | 1 | 0 | 1 | 1 |
| unit-03 | 0 | 0 | 0 | 0 |
| unit-04 | 0 | 0 | 0 | 0 |
| unit-05 | 0 | 0 | 0 | 0 |

### unit-02a Independent Review

- 2026-08-27: The required independent public/security-contract review froze one
  serious finding set against fixture blob `23be817842a2a17b6950949c756f6c5e7302873a`
  and test blob `1d8bf57140f5ab8747af78964718d5e233d3478d` at HEAD
  `6466c99dd497779d8499e0fef41cc5618593bff2`. `generationPattern` uses `$`,
  which JavaScript accepts before a trailing line terminator; the local decoder
  therefore accepts a malformed generation such as `alpha\n`. The one permitted
  finding-fix correction is limited to exact full-string generation validation
  and a regression vector.
- 2026-08-27: The sole finding-fix changed only the two authorized fixture paths
  and closes the frozen newline finding: focused and typecheck evidence passes
  on fixture blob `45c8c63233d0b7afe580ee75ec23c1b9556cab76` and test blob
  `a49ccad3667e8f45fb1a79912d524f9090985928`. The required fresh isolated broad
  gate failed because the generated test working directory could not locate the
  fixture. This is not localized to the correction's generation validation and
  no correction-regression repair is authorized. `unit-02a` is parked pending a
  new approved boundary or other authorized reset.
- 2026-08-27: Post-reset acceptance confirmation inspected only the frozen
  generation-newline finding set. The explicit fixture input preserves the exact
  full-string validation and `alpha\n` vector, so that finding remains closed.
  No second independent review was conducted and no new finding set exists.

### Change-Wide Ledger

| Implementation dispatches | Dispatch-invalids | Pre-review corrections | Finding-fix corrections | Independent reviews | Changed-kind resets | Broad gate runs | Worker tool-call proxy | Lead tool-call proxy | Acceptance criteria moved | No-progress streak |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 3 | 2 | 0 | 3 | 4 | 1 | 3 | 0 | 36 | 5 | 0 |

## Resolved Governance And Remaining Technical Work

- Resolved: use a portable Rust StatusNotifierItem helper, with the KWin backend
  first; fail closed without a watcher.
- Resolved: use a proof-first fixed D-Bus bridge with outbound state snapshots,
  reconnect and idempotence, no shell or input injection, and no action route.
- Resolved: KCM remains the sole settings owner; the fixture has no settings
  entry point.
- Resolved: development is dogfood-only; before release the helper becomes
  official core, while the tiler remains functional without it.
- Resolved: standing authorization covers reversible, namespaced user-local
  helper build, stage, start, and stop operations, its graphical-session
  autostart entry, and session D-Bus; non-project state is prohibited.
- This standing authorization does not authorize live operations for either
  production child. Build, start, stop, autostart, and session observation remain
  outside their static scope and are deferred to the separately authorized live
  unit.
- Resolved: the implementation is Rust-only, with no additional native C++ scope
  selected.
- Resolved fixture contract: the sole state-only method, schema, value domains,
  owner/liveness transitions, restart/replay behavior, stale timing, and literal
  canonical gates are recorded in `spec.md` and this plan.
- Pending production work: an implementation of this contract, any separately
  approved mutating action whitelist, and package mechanics. None are authorized
  by the fixture unit.

## Production Gate Map

All static commands run from repository root in the existing `devenv`
environment. They use fresh nonce-owned `/tmp/opencode` output and do not write
generated output under tracked `kwin/dist`.

- `gate.tray-publisher-focused`:
  `ATTEMPT="$(mktemp -d /tmp/opencode/tray-publisher-XXXXXXXX)" && (trap 'rm -rf "$ATTEMPT"' EXIT; export TRAY_BRIDGE_FIXTURE="$PWD/test-fixtures/tray-bridge-v1.json"; kwin/node_modules/.bin/esbuild kwin/tests/tray-publisher.test.ts --bundle --platform=node --format=cjs --target=es2020 --outfile="$ATTEMPT/tray-publisher.test.js" && node --test "$ATTEMPT/tray-publisher.test.js")`
  Expected baseline: 0 failures, 0 skips; only the fresh bundle is generated.
- `gate.tray-publisher-typecheck`:
  `ATTEMPT="$(mktemp -d /tmp/opencode/tray-publisher-typecheck-XXXXXXXX)" && (trap 'git worktree remove --force "$ATTEMPT" >/dev/null 2>&1 || rm -rf "$ATTEMPT"' EXIT; git worktree add --detach "$ATTEMPT" HEAD && mkdir -p "$ATTEMPT/kwin/src" "$ATTEMPT/kwin/tests" "$ATTEMPT/test-fixtures" && cp kwin/src/entry.ts kwin/src/controller.ts kwin/src/tray-publisher.ts "$ATTEMPT/kwin/src/" && cp kwin/tests/tray-publisher.test.ts "$ATTEMPT/kwin/tests/" && cp test-fixtures/tray-bridge-v1.json "$ATTEMPT/test-fixtures/" && ln -s "$PWD/kwin/node_modules" "$ATTEMPT/kwin/node_modules" && (cd "$ATTEMPT" && npm --prefix kwin run typecheck))`
  Expected baseline: exit 0 in an isolated source snapshot with no generated
  tracked output.
- `gate.tray-publisher-build`:
  `ATTEMPT="$(mktemp -d /tmp/opencode/tray-publisher-build-XXXXXXXX)" && (trap 'rm -rf "$ATTEMPT"' EXIT; kwin/node_modules/.bin/esbuild kwin/src/entry.ts --bundle --format=iife --target=es2017 --outfile="$ATTEMPT/main.js")`
  Expected baseline: exit 0; only `ATTEMPT/main.js` is generated.
- `gate.tray-publisher-broad`:
  `ATTEMPT="$(mktemp -d /tmp/opencode/tray-publisher-broad-XXXXXXXX)" && (trap 'git worktree remove --force "$ATTEMPT" >/dev/null 2>&1 || rm -rf "$ATTEMPT"' EXIT; git worktree add --detach "$ATTEMPT" HEAD && mkdir -p "$ATTEMPT/kwin/src" "$ATTEMPT/kwin/tests" "$ATTEMPT/test-fixtures" && cp kwin/src/entry.ts kwin/src/controller.ts kwin/src/tray-publisher.ts "$ATTEMPT/kwin/src/" && cp kwin/tests/tray-publisher.test.ts "$ATTEMPT/kwin/tests/" && cp test-fixtures/tray-bridge-v1.json "$ATTEMPT/test-fixtures/" && ln -s "$PWD/kwin/node_modules" "$ATTEMPT/kwin/node_modules" && (cd "$ATTEMPT" && export TRAY_BRIDGE_FIXTURE="$ATTEMPT/test-fixtures/tray-bridge-v1.json"; npm --prefix kwin test))`
  Expected baseline: exit 0, 0 failures; only the named source/test files and
  accepted fixture input are copied.
- `gate.tray-helper-static`:
  `ATTEMPT="$(mktemp -d /tmp/opencode/tray-helper-XXXXXXXX)" && (trap 'rm -rf "$ATTEMPT"' EXIT; export CARGO_TARGET_DIR="$ATTEMPT/target" CARGO_BUILD_BUILD_DIR="$ATTEMPT/target" CARGO_TERM_COLOR=never; cargo fmt --check && cargo test --locked && cargo check --locked)`
  Expected baseline: all commands exit 0 and Rust target output is only under
  `ATTEMPT/target`; the current deterministic tests have zero failures and no
  live bus is used. The prior command exported only `CARGO_TARGET_DIR`; Cargo
  1.97 placed reused test artifacts in its separate build directory
  `/home/beefsack/.cache/cargo/build`, so its exit-zero result was not accepting
  evidence. The approved `CARGO_BUILD_BUILD_DIR` addition makes both Cargo
  output directories the nonce target without changing the acceptance mechanism.

Each production child receives one independent public/security-contract review
before acceptance. No additional independently accepted harness is required:
unit-02a remains the fixture prerequisite, and production tests may consume its
vectors without importing its fixture-local codec or state machine. A separate
bus-process harness would require a new semantic approval.

The semantic-amendment documentation commits separately. Each accepted
production child then commits only its approved paths and current canonical gate
evidence; neither folds in fixture delivery or unrelated work.

## Acceptance-Criterion Evidence

| Acceptance criterion | Gate ID | Literal canonical command or observation | Expected baseline | Evidence |
|---|---|---|---|---|
| KWin script carrier limitation and strict SNI requirement are recorded. | `gate.proposal-inspection` | Inspect `spec.md` and `plan.md`. | Recorded without source changes. | `spec.md` Intent and Scope; `plan.md` Technical Approach. |
| MVP, security boundaries, and COSMIC limits are recorded. | `gate.proposal-inspection` | Inspect `spec.md` and `plan.md`. | Recorded without implementation claims. | `spec.md` Scope and Constraints. |
| User governance decisions are explicit before implementation. | `gate.user-governance` | User-approved written decisions. | Resolved. | `docs/decisions.md#tray`; `plan.md` Resolved Governance And Remaining Technical Work. |
| Live validation uses only bounded host authorization. | `gate.sni-live` | User-authorized live observation. | Pending. | `plan.md` unit-05; `docs/decisions.md#tray`. |
| The fixed bridge surface and state rules are recorded without routes outside `PublishSnapshot`. | `gate.bridge-contract-inspection` | Inspect `spec.md` Constraints and `plan.md` Contract And Scope. | Exact fixed surface and prohibitions recorded. | Pending post-amendment inspection. |
| Fixture vectors enforce schema, generation, revision, enabled, owner, liveness, replay, restart, transport, malformed, and route-rejection rules. | `gate.tray-bridge-focused` | `ATTEMPT="$(mktemp -d /tmp/opencode/tray-bridge-focused-XXXXXXXX)" && (trap 'rm -rf "$ATTEMPT"' EXIT; export TRAY_BRIDGE_FIXTURE="$PWD/test-fixtures/tray-bridge-v1.json"; kwin/node_modules/.bin/esbuild kwin/tests/tray-bridge-protocol.test.ts --bundle --platform=node --format=cjs --target=es2020 --outfile="$ATTEMPT/tray-bridge-protocol.test.js" && node --test "$ATTEMPT/tray-bridge-protocol.test.js")` | 0 failures, 0 skips; `TRAY_BRIDGE_FIXTURE` is the exact source-snapshot fixture; only generated bundle under fresh `ATTEMPT`. | Semantic-attempt-2 snapshot: HEAD `6466c99dd497779d8499e0fef41cc5618593bff2`; untracked fixture SHA-256 `33b1c33a29b5ab391773fbfad34c8fb8421932cd1c839b9314b6a7d5630689cc`; untracked test SHA-256 `5a5b568efd228e7e2e5e31f556d6dd878d0c13f15087d8a24fc280141b06f18c`; fresh nonce output: 2 passed, 0 failures, 0 skips. |
| Fixture paths typecheck with repository-managed dependencies. | `gate.tray-bridge-typecheck` | `npm --prefix kwin run typecheck` | Exit 0. | Same semantic-attempt-2 source snapshot; fresh output exit 0. |
| Broad KWin suite accepts the isolated allowed snapshot. | `gate.tray-bridge-broad` | `ATTEMPT="$(mktemp -d /tmp/opencode/tray-bridge-broad-XXXXXXXX)" && (trap 'git worktree remove --force "$ATTEMPT" >/dev/null 2>&1 || rm -rf "$ATTEMPT"' EXIT; git worktree add --detach "$ATTEMPT" 6466c99dd497779d8499e0fef41cc5618593bff2 && mkdir -p "$ATTEMPT/test-fixtures" "$ATTEMPT/kwin/tests" && cp test-fixtures/tray-bridge-v1.json "$ATTEMPT/test-fixtures/tray-bridge-v1.json" && cp kwin/tests/tray-bridge-protocol.test.ts "$ATTEMPT/kwin/tests/tray-bridge-protocol.test.ts" && ln -s "$PWD/kwin/node_modules" "$ATTEMPT/kwin/node_modules" && (cd "$ATTEMPT" && export TRAY_BRIDGE_FIXTURE="$ATTEMPT/test-fixtures/tray-bridge-v1.json"; npm --prefix kwin test))` | Exit 0, 0 failures; the fresh worktree contains only the two uncommitted tray fixture inputs and uses the source-snapshot `TRAY_BRIDGE_FIXTURE`; no pointer, COSMIC candidate, or other untracked input is copied. | Same semantic-attempt-2 source snapshot copied into a fresh detached worktree; fresh output: 996 passed, 0 failures. This formerly unmet canonical baseline advanced. |
| KWin publisher has focused, typecheck, build, and isolated broad evidence. | `gate.tray-publisher-focused`, `gate.tray-publisher-typecheck`, `gate.tray-publisher-build`, `gate.tray-publisher-broad` | See Production Gate Map. | All production gate baselines pass on the same scoped snapshot. | Pending `unit-02b-kwin-publisher`; blocked on `kwin/src/entry.ts` ownership reconciliation. |
| Rust helper endpoint validates cache and owner-liveness behavior. | `gate.tray-helper-static` | See Production Gate Map. | Format, test, and check exit 0 with Rust target output only under `ATTEMPT/target`. | Attempt-1 scoped snapshot: HEAD `882fc0fe3264740012c69c22fcbcb75123d3e26f`, modified `Cargo.toml` and `src/main.rs`, new `Cargo.lock`, `src/lib.rs`, `src/tray_endpoint.rs`, and `tests/tray_endpoint.rs`. The superseded command's format, test (5 passed), and check commands exited 0, but reused artifacts were under `/home/beefsack/.cache/cargo/build`; baseline unmet. The first amended verification timed out during check. Host-unknown recovery reran the exact amended command with a 600000-ms execution boundary: format, test (5 passed, 0 failed), and check exit 0; emitted Cargo paths were contained in `/tmp/opencode/tray-helper-7f4KdPTo/target`; no live bus ran. The sole finding-fix added deterministic startup owner-loss proof; its fresh amended gate passed with 1 unit test and 5 integration tests, 0 failures, and output contained in `/tmp/opencode/tray-helper-WFxhPyqg/target`. SHA-256: `Cargo.toml` `3c1b288d17ccd5541b57405fcaae213dccebf429ad677663e650d98d488f9465`, `Cargo.lock` `b37e719f335012cf2ed4932a3d354825b347c5d413e6d29f9ee2b11289a26a1b`, `src/main.rs` `64be74af655e7850852db5cd0956cc2dd18a427dba81615b622ed481f99a8a4c`, `src/lib.rs` `e89c11a7806b9d191254aa0f134c056b46c548fa97588d4fe75e1d5a6290a4e8`, `src/tray_endpoint.rs` `3eeb7612d75f987ec584ad2e3c198fee3d2130c8bd2af61d8b11117ac16f8e36`, `tests/tray_endpoint.rs` `725a45a8e04a9330e5e60340598f290a5657c447fb9e83ed72165a4efd237c92`; fixture `33b1c33a29b5ab391773fbfad34c8fb8421932cd1c839b9314b6a7d5630689cc`. The frozen review finding is confirmed closed. |

## Residual Risks

- The fixture model is not an actual D-Bus endpoint. Production integration must
  prove platform dispatch and lifecycle semantics separately.
- The resident helper and autostart artifact remain implementation work under
  the resolved Core Distribution boundary.
- Static evidence cannot establish panel/tray rendering, watcher lifecycle, or
  restart behavior; these remain live-host risks.
- KWin `callDBus` has no delivery acknowledgement. Heartbeat re-invocation is a
  retry attempt, not proof of delivery; platform dispatch remains a production
  and live-validation risk.
- The helper endpoint's semantic attempt is unaccepted because host Cargo target
  configuration overrides the canonical gate's nonce-target expectation. The
  approved mutable scope excludes a host or Cargo configuration correction.
- `unit-02b-kwin-publisher` cannot start until concurrent ownership of
  `kwin/src/entry.ts` is reconciled. `unit-02c-helper-endpoint` has no such
  source-path blocker.

## Final Outcome

- Governance, the fixture contract, and the pre-start production split are
  reconciled. `unit-02c-helper-endpoint` is the next eligible implementation
  unit; the KWin publisher, SNI work, distribution work, and live validation
  remain open.
