# Log: Tray Carrier and Command/State Bridge

## 2026-08-25

- Role / unit: Lead / proposal / attempt-01
- Result: Durable proposal artifacts approved in autonomous mode; implementation parked.
- Files / commit: `spec.md`, `plan.md`, `log.md`, and `docs/backlog.md` pending commit.
- Verification: Links, ASCII content, scoped diff, cached scope, and recent history pending final verification.
- Notes: KWin script is not a tray carrier. A strict tray needs an external SNI helper and supported command/state bridge. User decisions are required for carrier, bridge semantics, Unified Settings, Core Distribution/autostart, language/native scope, and live authorization. No source, tests, decisions, README, or host state changed.
- Change-wide telemetry: implementation dispatches 0; dispatch-invalids 0; pre-review corrections 0; finding-fix corrections 0; independent reviews 0; changed-kind resets 0; broad gates 0; acceptance criteria moved 2; no-progress streak 0.

## 2026-08-25

- Role / unit: Lead / documentation reconciliation
- Result: Reconciled the tray artifacts with the active user-approved Tray decision without changing governance, source, tests, package scope, or the backlog.
- Files / commit: `spec.md`, `plan.md`, and `log.md` modified; no commit.
- Verification: Scoped artifact inspection; all unit and change-wide implementation, correction, review, reset, broad-gate, and no-progress counters remain zero, except the historical two proposal acceptance criteria moved.
- Notes: `unit-01` remains accepted historical governance reconciliation. `unit-02` is dispatch-invalid until an exact bridge contract, independently accepted fixture or harness dependency, and literal canonical static gate are approved in the semantic plan. Agent host authorization is limited to the named reversible user-local operations; session boundaries remain user-run.

## 2026-08-25

- Role / unit: Worker investigation / proposed bridge contract
- Result: Read-only evidence supports a smallest state-only outbound bridge proposal; no current KWin script API supports helper-to-KWin actions or an open-settings route.
- Files / commit: No Worker changes; no commit.
- Verification: Read-only inspection of the tray artifacts, active Tray decision, KWin `callDBus` and `QTimer` declarations, controller state, fixture behavior, package scripts, and `devenv.nix`.
- Notes: Proposed contract, fixture/harness dependency, and literal static gate map require an Orchestrator-approved semantic plan amendment. The investigation is not an implementation attempt; counters remain unchanged.

## 2026-08-27

- Role / unit: Worker confirmation / frozen F-03 gate correction
- Result: Blocked before source work. The fixture input required by the exact
  canonical focused gate is absent, so the proposed output-redirection correction
  could not be verified.
- Files / commit: No repository changes; the Worker created and removed only
  `/tmp/opencode/tray-bridge-f03-uxNTJ7`; no commit.
- Verification: At source snapshot `6466c99dd497779d8499e0fef41cc5618593bff2`,
  `esbuild` could not resolve `kwin/tests/tray-bridge-protocol.test.ts`. No
  bundle was produced, and existing unrelated worktree changes were untouched.
- Notes: F-03 remains open. Do not approve the state-only semantic amendment or
  dispatch the fixture/vector implementation until a successful fresh exact gate
  run proves output remains outside the repository. This was neither an
  implementation dispatch nor a correction or independent review; counters and
  no-progress streak remain unchanged.

## 2026-08-27

- Role / unit: Lead / semantic amendment and F-03 reconciliation
- Result: The Orchestrator ruling supersedes the prior F-03 stop condition. The
  attempted confirmation was an invalid post-implementation gate before the
  approved fixture input existed; F-03 is closed by static inspection of the
  corrected literal command, not by a pre-source execution.
- Files / commit: `spec.md`, `plan.md`, and `log.md` amended; no commit.
- Verification: The static command resolves the root-relative test input and
  writes only its generated bundle under a freshly bound nonce-owned
  `/tmp/opencode` ATTEMPT directory. The actual focused command is deferred to
  `unit-02a-bridge-contract-fixture` acceptance after its approved test exists.
- Notes: The state-only interface, semantic domains, owner/liveness transition
  rules, fixture-first graph, allowed/prohibited scope, and focused/typecheck/
  isolated-broad gate map are approved. Counters are unchanged: this is neither
  a semantic attempt nor a correction or review.

## 2026-08-27

- Role / unit: Lead / unit-02a-bridge-contract-fixture dispatch preflight
- Result: Valid. The Orchestrator approved the recorded fixture-first semantic
  plan. Lead-to-Worker role metadata, Task capability, one-child host depth,
  required Worker skill availability, accepted `unit-01` dependency, two-path
  scope, and exact three-gate evidence map all reconcile without packet repair.
- Files / commit: `plan.md` and `log.md` record keeping only; no commit.
- Verification: `gate.tray-bridge-focused`, `gate.tray-bridge-typecheck`, and
  `gate.tray-bridge-broad` literal commands and baselines match the approved
  plan.
- Notes: This dispatch is the first semantic attempt for `unit-02a`; no source
  or gate evidence exists yet.

## 2026-08-27

- Role / unit: Independent Worker review / unit-02a-bridge-contract-fixture
- Result: One serious frozen finding. JavaScript `$` matching accepts a trailing
  line terminator, so the fixture's declared generation pattern admits
  `alpha\n` through the local decoder.
- Files / commit: No review changes; no commit.
- Verification: The initial focused, typecheck, and isolated broad gates passed
  against the reviewed two-file snapshot; their evidence is stale after the
  authorized finding-fix correction starts.
- Notes: The sole permitted finding-fix is exact full-string generation
  validation plus a regression vector. No other finding was returned.

## 2026-08-27

- Role / unit: Worker finding-fix / unit-02a-bridge-contract-fixture
- Result: The frozen generation-newline finding is closed with exact full-string
  validation and an `alpha\n` regression vector. Focused and typecheck gates
  passed, but the fresh isolated broad gate failed because its generated test
  working directory could not locate the fixture.
- Files / commit: `test-fixtures/tray-bridge-v1.json` and
  `kwin/tests/tray-bridge-protocol.test.ts` modified; no commit.
- Verification: `gate.tray-bridge-focused` passed with 2 tests, 0 failures, and
  0 skips. `gate.tray-bridge-typecheck` exited 0. `gate.tray-bridge-broad` did
  not meet its baseline. Attempt-owned temporary paths were removed.
- Notes: The broad failure is not localized to the generation correction, so the
  correction-regression repair conditions are not met. The finding-fix budget is
  spent and `unit-02a` is parked pending an approved reset or boundary.

## 2026-08-27

- Role / unit: Successor Lead / unit-02a-bridge-contract-fixture reset
- Result: The Orchestrator approved and consumed the change's sole changed-kind
  reset for fixture delivery. The focused and isolated broad canonical gates now
  provide `TRAY_BRIDGE_FIXTURE` as an explicit source-snapshot input; typecheck
  is unchanged. This is semantic attempt 2, not a finding-fix correction.
- Files / commit: `plan.md` and `log.md` modified; no commit.
- Verification: Reset map preserves `unit-01 -> unit-02a` fixture-first
  dependency, exact two-path scope, the fixed public/security contract, and the
  pre-reset gate baselines. Fresh gates remain pending.
- Notes: Change-wide counters before attempt 2: implementation dispatches 1;
  dispatch-invalids 0; pre-review corrections 0; finding-fix corrections 1;
  independent reviews 1; changed-kind resets 1; broad gates 2; acceptance
  criteria moved 3; no-progress streak 1.

## 2026-08-27

- Role / unit: Lead / unit-02a-bridge-contract-fixture acceptance
- Result: Accepted. Semantic attempt 2 made fixture location a canonical-gate
  input without changing the fixed public/security contract or either approved
  fixture path. The formerly failed broad baseline now passes, recording
  `canonical_gate_advanced`; the fixture-proof acceptance criterion is newly met.
- Files / commit: `test-fixtures/tray-bridge-v1.json`,
  `kwin/tests/tray-bridge-protocol.test.ts`, `plan.md`, and `log.md` accepted;
  no commit yet.
- Verification: At HEAD `6466c99dd497779d8499e0fef41cc5618593bff2`, fresh
  source snapshot hashes are fixture
  `33b1c33a29b5ab391773fbfad34c8fb8421932cd1c839b9314b6a7d5630689cc`
  and test `5a5b568efd228e7e2e5e31f556d6dd878d0c13f15087d8a24fc280141b06f18c`.
  Focused: 2 passed, 0 failures, 0 skips. Typecheck: exit 0. Clean isolated
  broad: 996 passed, 0 failures. All outputs correspond to the latest snapshot.
- Notes: Confirmation inspected only the frozen generation-newline review
  finding, which remains closed; no second independent review occurred. Final
  counters: implementation dispatches 2; dispatch-invalids 0; pre-review
  corrections 0; finding-fix corrections 1; independent reviews 1;
  changed-kind resets 1; broad gates 3; acceptance criteria moved 4;
  no-progress streak 0.

## 2026-08-27

- Role / unit: Lead / pre-start production split
- Result: The Orchestrator approved replacement of the unattempted monolithic
  `unit-02b-production-bridge` with `unit-02b-kwin-publisher` and
  `unit-02c-helper-endpoint`. Both retain the accepted fixture dependency; the
  split is not a changed-kind reset and changes no attempt counter.
- Files / commit: `spec.md`, `plan.md`, and `log.md` amended; no source, test,
  Cargo, dependency, fixture, or governance file changed.
- Verification: Pending independent public/security-plan review and scoped docs
  consistency checks.
- Notes: `unit-02c-helper-endpoint` is the next eligible implementation unit.
  `unit-02b-kwin-publisher` is blocked until concurrent `kwin/src/entry.ts`
  ownership is reconciled. Change-wide counters remain implementation dispatches
  2; dispatch-invalids 0; pre-review corrections 0; finding-fix corrections 1;
  independent reviews 1; changed-kind resets 1; broad gates 3; acceptance
  criteria moved 4; no-progress streak 0.

## 2026-08-27

- Role / unit: Lead / `unit-02c-helper-endpoint` preflight.
- Result: `dispatch-invalid` before source work. Role metadata, Task depth,
  Worker skill availability, accepted fixture dependency `925d3ab`, acyclic
  graph, authorized Rust-path ownership, and the exact static gate reconcile.
  The supplied 3000-millisecond stale threshold and revision-0-only
  new-generation rule conflict with the approved 30000-millisecond contract and
  fixture vector accepting `beta` revision 1.
- Files / commit: `plan.md` and `log.md` record only; no source, dependency,
  fixture, test, Cargo lock, or runtime state changed; no commit.
- Verification: `gate.tray-helper-static` was compared literally, not run,
  because source work has not begun. The user selected the accepted fixture
  semantics: 30000-millisecond staleness, KWin revision 0 at startup and
  rollover, and helper acceptance of semantically valid new generations at
  nonzero revisions, including `beta` and post-reacquisition `gamma` revision 1.
  The one repaired packet is ready after docs acceptance.
- Notes: Unit and change-wide implementation, correction, and review counters
  remain unchanged. This preflight invalid result is not a semantic attempt.

## 2026-08-27

- Role / unit: Lead and independent Worker / tray contract reconciliation.
- Result: The user selected the accepted fixture semantics. `spec.md` and
  `plan.md` now distinguish KWin's revision-0 publication requirement from the
  helper's acceptance of any semantically valid different generation after owner
  reacquisition. No public route, signature, security, carrier, settings, or
  distribution behavior changed.
- Verification: One fresh read-only Worker contract-consistency review found no
  findings across the scoped records and accepted fixture; scoped `git diff
  --check` passed. No source or static gate ran.
- Notes: The prior `dispatch-invalid` remains pre-source and budget-neutral. The
  repaired implementation packet is ready. Change-wide independent reviews are
  3; implementation dispatches 2, dispatch-invalids 1, corrections 0/2,
  changed-kind resets 1, broad gates 3, acceptance criteria moved 4, and
  no-progress streak 0. Unit-02c counters remain unchanged.

## 2026-08-27

- Role / unit: Independent Worker review and Lead finding-fix / pre-start
  production split
- Result: The frozen public/security-plan finding set identified three
  documentation inconsistencies. The one authorized docs-only correction closes
  all three: fixture-path wording now permits only exact dispatched-unit paths,
  standing host authorization is explicitly excluded from production-child live
  scope, and publisher typecheck uses an isolated source snapshot.
- Files / commit: `spec.md`, `plan.md`, and `log.md` modified; no source, test,
  Cargo, dependency, fixture, or governance file changed.
- Verification: Independent read-only review completed; scoped docs consistency
  inspection and `git diff --check` passed.
- Notes: Change-wide counters are implementation dispatches 2; dispatch-invalids
  0; pre-review corrections 0; finding-fix corrections 2; independent reviews
  2; changed-kind resets 1; broad gates 3; acceptance criteria moved 4;
  no-progress streak 0. Unit counters remain unchanged.

## 2026-08-27

- Role / unit: Successor Lead / `unit-02c-helper-endpoint` repaired-packet preflight.
- Result: `dispatch-invalid` before source work. The packet requires a signed
  nonnegative revision, while the independently accepted fixture requires
  acceptance of signed revision `-2147483648` for generation `limits`.
- Files / commit: `plan.md` and `log.md` record only; no Worker dispatch, source,
  dependency, fixture, test, Cargo lock, runtime state, commit, or push.
- Verification: The approved `spec.md` constraint and accepted fixture's signed
  revision boundary vector conflict with the repaired packet. The exact
  `gate.tray-helper-static` was not run because source work is not authorized.
- Notes: This consumes no implementation, correction, or review budget. No
  second packet repair is authorized. Change-wide dispatch-invalids are now 2;
  implementation dispatches remain 2; unit-02c counters remain zero.

## 2026-08-28

- Role / unit: Lead / `unit-02c-helper-endpoint` fresh implementation dispatch preflight.
- Result: Valid under the user's explicit one-dispatch exception after the two
  prior packet failures. This begins semantic attempt 1.
- Files / commit: `plan.md` and `log.md` record only; no source, fixture, Cargo
  lock, runtime state, commit, or push changed before dispatch.
- Verification: Worker/Lead `process_role` fields match. Parent-recorded
  `worker-openai` selector, unspecified model preference, and host persona are
  distinct non-blocking metadata. One-child Task depth and
  `processed-beef-work-unit` availability reconcile. Accepted `unit-02a`
  dependency commit `925d3ab`, acyclic graph, exact Rust path ownership, and
  literal `gate.tray-helper-static` command and all-exit-zero baseline reconcile.
- Notes: The two earlier `dispatch-invalid` records remain budget-neutral. No
  further packet repair is authorized. Change-wide implementation dispatches are
  3; dispatch-invalids 2; no-progress streak 1.

- Role / unit: Lead / `unit-02c-helper-endpoint` semantic attempt 1 gate review.
- Result: Blocked. Scoped implementation inspection found no pre-review source
  correction. The literal static command exits 0 and its five deterministic
  fixture-driven tests pass, but the target-output baseline is unmet.
- Files / commit: `Cargo.toml`, `src/main.rs`, new `Cargo.lock`, `src/lib.rs`,
  `src/tray_endpoint.rs`, and `tests/tray_endpoint.rs` remain unstaged; tray
  records remain unstaged; no commit or push.
- Verification: At HEAD `882fc0fe3264740012c69c22fcbcb75123d3e26f`, the exact
  `gate.tray-helper-static` command runs `fmt`, `test`, and `check` successfully.
  Tests: 5 passed, 0 failed. Despite its `CARGO_TARGET_DIR="$ATTEMPT/target"`
  export, Cargo writes under `/home/beefsack/.cache/cargo/build` rather than the
  nonce-owned target path required by the gate baseline. No live bus was used.
- Notes: This is a host/configuration output-boundary blocker outside the
  authorized mutable paths. The unit is not accepted; no independent review,
  commit, or push is authorized. Counters remain implementation dispatches 3;
  dispatch-invalids 2; pre-review corrections 0; unit-02c independent reviews
  0; acceptance criteria moved 4; no-progress streak 1.

- Role / unit: Orchestrator approval and Lead / `unit-02c-helper-endpoint` gate amendment.
- Result: Approved semantic amendment of `gate.tray-helper-static` only. The
  acceptance mechanism remains nonce-contained Cargo output.
- Files / commit: `plan.md` and `log.md` record only; no helper source, lock,
  fixture, runtime state, commit, or push changed.
- Verification: The superseded literal command is non-accepting evidence: all
  commands exited 0 with 5 passing tests, but Cargo 1.97 reused artifacts from
  `/home/beefsack/.cache/cargo/build`. The amended literal command additionally
  exports `CARGO_BUILD_BUILD_DIR="$ATTEMPT/target"`, alongside
  `CARGO_TARGET_DIR="$ATTEMPT/target"` and `CARGO_TERM_COLOR=never`.
- Notes: This is not a semantic attempt, correction, repair, reset, or changed
  acceptance mechanism. A fresh read-only gate verification is required before
  helper inspection and the required independent public/security review.

- Role / unit: Read-only Worker verification / `unit-02c-helper-endpoint` amended gate.
- Result: Blocked. The exact amended `gate.tray-helper-static` did not complete
  before the Worker host timeout.
- Files / commit: No Worker file changes, staging, commit, or push. The literal
  trap owns and removes only its nonce path.
- Verification: `cargo fmt --check` passed. `cargo test --locked` passed with 5
  tests, 0 failures, and no live bus. Emitted Cargo paths were under
  `/tmp/opencode/tray-helper-Vyk5KPhT/target`. `cargo check --locked` exceeded
  the 120-second Worker timeout, so the all-exit-zero baseline and required
  source-hash/output correspondence are incomplete.
- Notes: This is verification evidence only, not an implementation dispatch,
  correction, repair, reset, or review. Stop conditions prohibit helper diff
  acceptance, independent review, staging, commit, and push. Counters remain
  implementation dispatches 3; dispatch-invalids 2; pre-review corrections 0;
  finding-fix corrections 2; independent reviews 3; acceptance criteria moved
  4; no-progress streak 1.

- Role / unit: Lead / `unit-02c-helper-endpoint` host-unknown verification reconciliation.
- Result: The prior read-only Worker interruption is a host-unknown result after
  valid source work, caused by the host's 120-second execution boundary during
  cold nonce-contained `cargo check`. It is not a semantic attempt, correction,
  repair, reset, or gate amendment.
- Files / commit: `log.md` record only; no helper source, lock, fixture, staging,
  commit, or push changed.
- Verification: Prior format and test evidence remains partial only: format
  passed, 5 tests passed with 0 failures, and emitted paths were nonce-contained;
  check, hashes, and complete correspondence were interrupted.
- Notes: A fresh compressed read-only verification Worker is authorized with the
  unchanged amended literal command and a host execution timeout of at least
  600000 milliseconds. Counters remain unchanged.

- Role / unit: Read-only Worker verification / `unit-02c-helper-endpoint` host recovery.
- Result: Recovery gate passed. The prior timeout is reconciled as host-unknown
  verification evidence and does not change implementation or correction counts.
- Files / commit: No Worker file changes, staging, commit, or push. The literal
  trap cleaned only its nonce-owned path.
- Verification: The exact amended command ran once from repository root with a
  600000-ms execution boundary. Format, test, and check exited 0; test reported
  5 passed and 0 failed; no live bus ran. Emitted Cargo output was contained in
  `/tmp/opencode/tray-helper-7f4KdPTo/target`. Full scoped SHA-256 correspondence
  is recorded in the plan evidence row. The Worker result did not retain elapsed
  duration beyond successful completion within the configured boundary.
- Notes: Fresh static evidence permits the one already-authorized independent
  public/security review. Counters remain unchanged.

- Role / unit: Independent Worker review / `unit-02c-helper-endpoint`.
- Result: One frozen medium public/security finding set. The initial KWin owner
  lookup can race owner loss: `name_has_owner` succeeds, `get_name_owner` then
  errors, and the helper exits instead of starting empty.
- Files / commit: No review changes, staging, commit, or push.
- Verification: Finding evidence is `src/tray_endpoint.rs:165-173` against the
  owner-liveness requirement in the approved tray spec and plan. No gate or live
  test ran during review.
- Notes: The sole finding-fix correction is limited to fail-closed startup owner
  reconciliation and regression proof within the existing helper scope. Counters
  are implementation dispatches 3; dispatch-invalids 2; finding-fix corrections
  2 change-wide and 0 for unit-02c before this correction; independent reviews 4
  change-wide and 1 for unit-02c.

- Role / unit: Worker finding-fix and Lead confirmation / `unit-02c-helper-endpoint`.
- Result: The frozen startup owner-race finding is closed. The initial resolution
  treats `NameHasNoOwner` after successful observation as an empty owner state;
  other D-Bus errors still propagate.
- Files / commit: Only `src/tray_endpoint.rs` changed in the correction; no
  staging, commit, or push yet.
- Verification: Deterministic regression proves observe then resolve ordering and
  empty startup on owner loss. The exact amended gate passed with a 600000-ms
  execution boundary: 1 unit test and 5 integration tests passed, 0 failures;
  format and check exited 0; no live bus ran; Cargo output was contained in
  `/tmp/opencode/tray-helper-WFxhPyqg/target` before trap cleanup. Lead
  confirmation checked only this frozen finding and its scoped SHA-256 snapshot.
- Notes: This consumes unit-02c's sole finding-fix correction. The finding is
  closed, the helper acceptance criterion is newly met, and no second review or
  correction occurred. Change-wide counters: implementation dispatches 3;
  dispatch-invalids 2; finding-fix corrections 3; independent reviews 4;
  acceptance criteria moved 5; no-progress streak 0.

- Role / unit: Lead acceptance / `unit-02c-helper-endpoint`.
- Result: Accepted pending the authorized commit transaction.
- Files / commit: Accepted helper paths are `Cargo.toml`, `Cargo.lock`,
  `src/main.rs`, `src/lib.rs`, `src/tray_endpoint.rs`, and
  `tests/tray_endpoint.rs`; tray `plan.md` and `log.md` are acceptance records.
- Verification: Fixed zbus route and `InvalidSnapshot` name, fixture-driven
  signed state transitions, 30000-ms freshness, owner invalidation and startup
  reconciliation, minimal dependencies, no live bus tests, fresh nonce-contained
  canonical gate, and the closed frozen review finding are mapped in the plan.
- Notes: No serious finding or acceptance gap remains in unit-02c. The next
  action is scoped status/diff/log/staging inspection and the authorized commit.

## 2026-08-31

- Role / unit: Lead / `unit-02b-kwin-publisher` reconstruction and integration.
- Result: Accepted. The reconstructed publisher sends revision 0 at startup,
  immediately sends each authoritative enabled-state transition through the
  existing one-way `PublishSnapshot` route, and retains the 1000-ms heartbeat
  for retry and freshness. Same-state writes and heartbeats do not advance the
  revision; signed rollover creates a new generation at revision 0.
- Files / commit: `kwin/src/controller.ts`, `kwin/src/entry.ts`,
  `kwin/src/tray-publisher.ts`, `kwin/tests/controller-fixture-scenarios.ts`,
  and `kwin/tests/tray-publisher.test.ts`; tray records and backlog updated.
- Verification: Focused publisher 9 passed, typecheck passed, nonce build SHA-256
  `d80744656b464153785bb92dae5c96bf4c1f639ee4c63f8fdd408a7119c0bccc`, and
  broad KWin 1011 passed across 98 suites. Start, live-test, installer, and
  package static gates passed. Independent review found no findings.
- Notes: No live KWin, session, helper, or host operation ran. The fixed public
  route remains outbound-only and no action or helper-to-KWin path was added.

- Role / unit: Lead / isolated publisher-gate fixture repair.
- Result: The first literal isolated typecheck exposed an omitted test scenario
  helper. The gate now copies that already-scoped helper with the tray test; no
  production behavior, route, ownership, or test oracle changed.
- Verification: The corrected literal isolated typecheck passed; its isolated
  broad gate passed with 1011 tests across 98 suites, 0 failures, and 0 skips.
  All nonce worktrees and outputs were removed.

- Role / unit: Lead / `unit-02d-helper-lifecycle` normal-path boundary.
- Result: The controlling user decision restores the original host-install
  boundary. Crash and power-loss recovery, durable transaction state, and
  automatic post-crash retry are excluded. Ordinary commands lock before
  preflight; normal rollback remains required; ambiguous residue fails closed.
- Verification: Non-live gates passed: 25 Rust tests, 19 focused lifecycle and
  endpoint tests, 1002 JS tests, 255 start fixtures, 347 installer fixtures,
  build-package, nine shell syntax checks, and `git diff --check`. Independent
  review remains blocking: normal remove cannot restore a first artifact after
  a later deletion failure without an explicitly selected transaction model.
- Notes: No host, KWin, D-Bus, helper, or session mutation ran. No lifecycle
  source is accepted, staged, committed, or pushed.

- Role / unit: Lead acceptance / `unit-02d-helper-lifecycle` normal-path
  rollback correction.
- Result: Accepted. `tray-remove` holds identity-checked PID, data, and desktop
  rollback copies only during a command; it restores only absent canonical
  artifacts and retains unsafe partial-quarantine or replacement residue with
  `recovery-required`. No durable crash or power-loss recovery is claimed.
- Verification: Final static gates passed: 33 Rust tests, 20 focused lifecycle
  and endpoint tests, 347 installer assertions, nine shell syntax checks, 255
  start fixtures, package build/checksum, and 1002 KWin tests across 98 suites.
  Final independent security review accepted with no findings.
- Notes: No host, KWin, D-Bus, helper, or session mutation ran.
