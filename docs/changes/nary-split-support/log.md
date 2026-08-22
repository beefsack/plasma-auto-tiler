# Log: N-ary split container support

Append-only checkpoint log. Each entry records timestamp, role and work unit,
result, changed files or commit, verification, and discoveries or decisions.

## 2026-08-21

- Role / unit: Lead / scoping / attempt-01
- Result: Binary-coupling research accepted and checkpointed.
- Files / commit: `research/binary-coupling.md`; `46c7de0`
- Verification: 119 lines; 2 structural-binary types, 24 direct functions, and
  13 affected test files recorded with citations.
- Notes: Native split-result cardinality, proportion model, N-ary resize,
  normalization, ordered-child source, migration shape, and oracle role remain
  pending decisions.

## 2026-08-21

- Role / unit: Lead / baseline / attempt-01
- Result: Required baseline verified before planning.
- Files / commit: No production or test files changed.
- Verification: 924 tests / 81 suites / 0 failures; both tsconfigs clean; 336
  dogfood assertions / 0 failures; `main == origin/main == ad18cc9` before the
  research commit.
- Notes: The only pre-existing untracked paths are `CMakeFiles/`, `test-output`,
  and `Project Technical Report and Implementation Plan.md`.

## 2026-08-21

- Role / unit: Lead / scoping / attempt-02
- Result: Specification and implementation plan prepared for approval.
- Files / commit: `spec.md`, `plan.md`, `log.md`
- Verification: Plan contains nine stable work-unit IDs, per-unit verification,
  baseline gate, acceptance-evidence map, and circuit-breaker accounting.
- Notes: Pending user decisions block implementation; no file under `kwin/` was
  modified.

## 2026-08-21

- Role / unit: Lead / COSMIC sizing procedure / attempt-01
- Result: Accepted three isolated, manually resized sizing vectors for R2b,
  R2c, and R3; R1 is explicitly excluded because the stated hypotheses all
  predict a two-way half split.
- Files / commit: `research/cosmic-sizing-procedure.md`; uncommitted.
- Verification: Lead reread the procedure and confirmed each vector's
  H-equalize, H-preserve, and H-local predictions differ at coarse scale;
  `git diff --check` passed.
- Notes: This is a hand-executable research procedure only. No live COSMIC
  test was run and no file under `kwin/` was modified.

## 2026-08-21

- Role / unit: Lead / R2b target-axis coverage / attempt-01
- Result: Investigation accepted and checkpointed; the closed parity-only R2b
  wording contradicts two parallel-target corpus cases, both of which agree
  with the new live observation.
- Files / commit: `research/r2b-axis-coverage.md`; uncommitted.
- Verification: Three serial Worker investigations reconciled against direct
  Lead inspection of `S1-17`, `S7-02`, and the model's target-axis branch.
- Notes: `S1-17` remains a model-derived direction correction awaiting user
  confirmation. No file under `kwin/` was modified.

## 2026-08-21

- Role / unit: Worker / nary-split-support documentation and comments
- Result: Corrected R2b target-axis prose; recorded observed sizing and
  insertion findings; updated the perpendicular-branch corpus comment.
- Files / commit: `docs/cosmic-move-conformance.md`,
  `docs/changes/nary-split-support/research/cosmic-insertion-findings.md`,
  `kwin/tests/move-conformance-model.ts`, `log.md`; uncommitted.
- Verification: `npm --prefix kwin test` passed: 924 tests / 87 suites / 0
  failures. `npm --prefix kwin run typecheck` passed with both tsconfigs clean.
- Notes: No authored vectors, model executable code, or `main.js` changed.

## 2026-08-21

- Role / unit: Lead / unit-01 / attempt-01
- Result: Reconciled six settled decisions into the specification and aligned
  the plan's semantic sections. The conformance-model oracle role remains open.
- Files / commit: `spec.md`, `plan.md`, `log.md`; uncommitted.
- Verification: Confirmed the COSMIC corpus's S1-S4 sizing rules determine the
  insertion-normalization contract and cite R2b's target-axis precondition.
  `npm --prefix kwin run typecheck` passed for both tsconfigs; `npm --prefix
  kwin test` passed: 924 tests / 87 suites / 0 failures.
- Notes: The project-owned ordered N-ary model is authoritative for session
  semantics; a separately scoped native-binding evidence unit gates unit-04.
  The adapter, not the semantic model, changes if its candidate native contract
  is disproved. No file under `kwin/` was modified.

## 2026-08-21

- Role / unit: Lead / unit-01 / correction-01
- Result: Restricted the settled insertion-normalization rule to directional
  move-insertion and recorded new-window insertion sizing as open.
- Files / commit: `spec.md`, `plan.md`, `log.md`; uncommitted.
- Verification: Confirmed the new-window findings are unpromoted research with
  no replay vectors and do not add behavior to the movement rules.
- Notes: S1-S4 govern existing-window directional move-insertion only; they do
  not establish new-window insertion sizing. No file under `kwin/` was modified.

## 2026-08-21

- Role / unit: Lead / native-evidence-phase-1 / attempt-01
- Result: Accepted pinned-source evidence. Native C++ supports ordered direct
  3+-child containers; same-axis split inserts a sibling in the parent. C++
  horizontal/vertical split paths return two entries, while the floating path
  returns one; QJSEngine marshalling remains unproven by source.
- Files / commit: `research/native-binding-evidence.md`; uncommitted.
- Verification: KWin `v6.7.3` archive source was matched to commit
  `45ec9a6d0ed312a803ff5658a2a3e61f221566c6`; citations recorded in the
  research file; `git diff --check` passed.
- Notes: The source result establishes native 3+-child topology but not the
  script-facing `tiles` representation, ordering, or identity.

## 2026-08-21

- Role / unit: Lead / native-evidence-phase-2 / attempt-01
- Result: Blocked by failed nested-KWin isolation acceptance. The host
  `~/.config/kwinrc` hash was unchanged but its nanosecond mtime changed, so
  the only runtime observation is invalidated and no retry was made.
- Files / commit: `research/native-binding-evidence.md`; uncommitted.
- Verification: Private nested resources were cleaned; `git diff --check`
  passed. Static gates passed: `npm --prefix kwin test` reported 924 tests /
  87 suites / 0 failures and `npm --prefix kwin run typecheck` was clean.
- Notes: E4 and the JavaScript binding contract remain unresolved. The native
  result-cardinality and restart/manual-native-edit residual risks remain open.

## 2026-08-21

- Role / unit: Lead / native-evidence-phase-2 / attempt-02
- Result: Hard-stopped. The final authorized nested-KWin probe observed a host
  `~/.config/kwinrc` SHA-256 change; no third attempt is permitted.
- Files / commit: `docs/live-kwin-testing.md`,
  `research/native-binding-evidence.md`, `plan.md`, `log.md`; uncommitted.
- Verification: Retained evidence at
  `/tmp/opencode/native-evidence-phase-2-attempt-02-20260821T035827482591912`
  records private XDG/runtime isolation, a private `kwinrc`, complete cleanup,
  and host before/after measurements. The attempt-owned loader parser rejected
  `i 0` before the probe executed.
- Static verification: `npm --prefix kwin test` passed with 924 tests / 87
  suites / 0 failures; `npm --prefix kwin run typecheck` was clean for both
  tsconfigs.
- Notes: The user relaxed the mtime tripwire to advisory after attempt-01;
  attempt-02 proved the mtime anomaly was a real isolation signal by observing
  content divergence. Mtime remains advisory only because SHA-256 is the
  stronger hard-stop check, not because the signal was benign. Two attempts
  spent the unit's budget and tripped the circuit breaker. The Orchestrator
  froze the path, and the user selected an isolation-first reset with E4 parked
  as source-only evidence. Native result cardinality and the 3-child binding
  observation remain unresolved.

## 2026-08-21

- Role / unit: Lead / isolation-breach-investigation
- Result: Accepted read-only investigation. The host `kwinrc` content divergence
  is established, but its writer and mechanism are undetermined. The explicit
  private-bus calls used the retained private address; the D-Bus-to-host
  hypothesis is neither confirmed nor refuted. E4 remains parked.
- Files / commit: `research/isolation-breach-investigation.md`,
  `docs/live-kwin-testing.md`, `plan.md`, `log.md`; uncommitted.
- Verification: Narrow time-bounded `journalctl --user` queries for KWin,
  Plasma, KDED, and D-Bus returned no entries. Static verification reported
  924 tests / 87 suites / 0 failures; typecheck was clean.
- Notes: The retained loader parser expected `u` and rejected the documented
  signed `i 0` `loadScript` reply before the probe body ran. Future live work
  requires the proposed isolation-first hardening and separately authorized
  writer attribution; this investigation ran no compositor, probe, or D-Bus
  mutation.

## 2026-08-21

- Role / unit: Worker / unit-01 / decision-Q6
- Result: Settled Q6: `move-conformance-model.ts` is reference documentation
  only, not a behavioral oracle for N-ary structural tests. The sole pending
  user decision is new-window insertion sizing.
- Files / commit: `spec.md`, `plan.md`, `log.md`; uncommitted.
- Verification: Reconciled the structural acceptance boundary with spec
  Scope 28-32, Non-Goals 38-41, and Constraints 55-56; confirmed the archived
  corpus/model rule at
  `docs/changes/archive/2026-08-20-cosmic-move-model-closure/spec.md:9-13`.
- Notes: Native C++ evidence permits 3+-child topology and same-axis sibling
  insertion, and direction-only drag, keyboard, and preset split paths can
  potentially reach it. QJSEngine marshalling remains unproven; both binding
  probes were invalidated, so structural tests must use synthetic N-ary trees.

## 2026-08-21

- Role / unit: Worker / isolation-hardening / attempt-01
- Result: Blocked before edits. The signed-`i` loader parser is only retained in
  the untracked attempt `run.sh`; no tracked probe-script emitter exists to
  change. Writer-attributed monitoring needs an unrecorded kernel/audit
  collection mechanism and authorization boundary.
- Files / commit: No files changed by the worker; `log.md` updated by Lead.
- Verification: The worker read the accepted investigation and identified the
  retained parser at
  `/tmp/opencode/native-evidence-phase-2-attempt-02-20260821T035827482591912/run.sh:62-73`.
  No probe, host mutation, or static test command was run.
- Notes: The proposal requires a future signed-`i` JSON-envelope parser and
  writer attribution, but specifies neither a tracked emitter nor the required
  audit implementation. Escalated for an implementation-boundary decision.

## 2026-08-21

- Role / unit: Worker / unit-01 and unit-02 documentation ruling
- Result: Recorded the user ruling. The host write self-reverted within three
  seconds and current content is byte-identical; only the divergent hash was
  retained. Writer/mechanism remain undetermined, and root-tool attribution is
  prohibited without separate approval. Attribution would require `fanotify`
  with a global mark, an `auditd` watch rule, or `bpftrace`; each requires root.
  `docs/decisions.md#native-effect-live-validation` prohibits `sudo` without
  separate approval.
- Files / commit: `research/isolation-breach-investigation.md`,
  `docs/live-kwin-testing.md`, `log.md`; uncommitted.
- Verification: Re-read the retained attempt parser at untracked throwaway
  `run.sh:62-73`: it required `u`, rejected the signed `i 0`, and never invoked
  `run()`. Confirmed the documented `/Scripting` contract is signed `i` with a
  non-negative 32-bit ID and raw-output retention.
- Notes: The D-Bus fallback (a child escaping `DBUS_SESSION_BUS_ADDRESS`,
  reaching host KWin, and reconfiguring it) is neither confirmed nor refuted;
  this and the missing divergent bytes are unresolved-and-accepted, not
  benign-by-proof. `scripts/nested-kwin-spike.sh` remains unhardened: line 30
  lacks `env -i`, inherits its parent environment, and exports the absolute host
  Wayland socket. If nesting is ever needed, host `kwinrc` backup/restore or
  `bubblewrap` are cheap containment options; `bubblewrap` is neither in
  `devenv.nix` nor on `PATH`.

## 2026-08-21

- Role / unit: Lead / unit-03 (E4 read-only host probe) / attempt-02
- Result: Blocked before preflight. The attempt-owned runner exited at `mkdir`
  because creating its source with `apply_patch` had already created the
  evidence directory.
- Files / commit: `plan.md`, `log.md`, and the cursor procedure in
  `docs/live-kwin-testing.md`; uncommitted.
- Verification: No `loadScript`, `run`, or `unloadScript` call occurred. No
  `kwinrc` baseline or postflight was captured. A third attempt is prohibited
  by the circuit breaker and is escalated.
- Notes: E4 has no new runtime fact. The pre-existing source-only conclusion
  remains unchanged.

## 2026-08-22

- Role / unit: Lead / unit-02 / attempt-01
- Result: Accepted. Added a `serializeTileTree` fixture-seam helper and two
  pinned-golden characterization tests that drive the real `TileController`
  through a dwindle chain and a preset-shortcut insertion, establishing the
  "before migration" binary baseline.
- Files / commit: `kwin/tests/controller-fixture-scenarios.ts`,
  `kwin/tests/nary-characterization.test.ts`; commit pending.
- Verification: Lead independently reran both commands after inspecting the
  diff directly: `npm --prefix kwin test` - 942 tests / 90 suites / 0
  failures (up from 940/89/0); `npm --prefix kwin run typecheck` - clean on
  both tsconfigs.
- Notes: Plan's Work Units table lists unit-02's file scope as
  `kwin/tests/logic.test.ts`, controller fixture/test seams. `logic.test.ts`
  tests pure `logic.ts` functions only and has no `TestTile`/controller
  involvement; achieving spec's "native layout serialization" acceptance
  criterion required exercising real `TestTile` trees through the controller,
  so the Lead placed the new characterization tests in a new file,
  `kwin/tests/nary-characterization.test.ts`, using the existing
  `controller-fixture-scenarios.ts` fixture seam instead. This is an
  execution-level file-location judgment, not a change to the unit's
  objective, dependencies, or verification. No `kwin/src/` file was touched.

## 2026-08-22

- Role / unit: Lead / COSMIC follow-up evidence / attempt-01
- Result: Accepted durable recording of the user's 1920x1080, 100% COSMIC
  observations. Between-child existing-window drag insertion confirms the
  already-settled `1/n` mover plus uniform existing-child scaling rule; float
  removal normalizes surviving children while preserving their relative ratio,
  including the observed manually resized 50/30/20 case.
- Files / commit: `docs/cosmic-move-conformance.md`,
  `research/cosmic-insertion-findings.md`, `research/cosmic-sizing-procedure.md`,
  `docs/backlog.md`; documentation commit pending.
- Verification: Lead inspected the exact four-file diff and confirmed
  `git diff --check` passed. No live KWin/Plasma operation ran.
- Notes: This closes the stale claim that a 3+-child between-child user drag has
  an unobserved single absorbing sibling, and narrows the manual-resize gap to
  still-unobserved directional-move and new-window behavior. It does not alter
  the approved directional-move or new-window semantics, so `spec.md` and
  `plan.md` were not edited.

## 2026-08-22

- Role / unit: Worker / unit-08 / attempt-01
- Result: Paused for a semantic construction conflict. The worker replaced both
  direct `split()` return decodes with live post-mutation target decoding through
  the adapter and added opaque-return/N-ary synthetic coverage, but did not find
  a supported way to keep new-window insertion local when native same-axis
  `split()` escapes to the parent.
- Files / commit: Unaccepted, uncommitted worktree changes in `kwin/src/controller.ts`,
  `kwin/tests/controller-keyboard-placement.test.ts`,
  `kwin/tests/controller-automatic-dwindle-insertion.test.ts`,
  `kwin/tests/controller-deferred-recovery-and-fullscreen.test.ts`,
  `kwin/tests/controller-fixture-scenarios.ts`, and generated
  `kwin/contents/code/main.js`.
- Verification: Focused affected tests 79 pass; complete suite 956 tests / 90
  suites / 0 failures; both tsconfigs clean; dogfood 347 assertions / 0 failures;
  two builds byte-identical; `git diff --check` passed. No live KWin/Plasma
  operation ran.
- Notes: The pending decision is recorded in `plan.md`. The worker's same-axis
  synthetic tests model a local nested split and therefore do not prove native
  same-axis construction; they are not acceptance evidence for that boundary.

## 2026-08-23

- Role / unit: Lead / unit-08 recovery and capability investigation / attempt-02
- Result: Reconciled the parked worktree, accepted history, and counters. The
  prior cancelled host dispatch is an unsuccessful, non-resumable unit-08
  attempt with no correction or review result. A bounded read-only KWin 6.7.3
  investigation found no qualifying local wrapper/reparent mechanism: a
  temporary writable-parent-`layoutDirection` flip can select the local split
  branch, but `split()` is non-transactional and leaves no supported rollback
  after partial mutation. It is unsuitable under the frozen atomicity and
  native-feel criteria.
- Files / commit: Lead recordkeeping only in `plan.md` and `log.md`; parked
  implementation files remain unaccepted and unmodified by this recovery.
- Verification: Re-read `spec.md:91-103`,
  `research/cosmic-insertion-findings.md:3-30`, and
  `research/native-binding-evidence.md:24-40`; inspected KWin v6.7.3 source
  citations supplied by the bounded Worker investigation. No live mutation ran.
- Notes: The approved fallback requires a spec and unit-08 plan amendment plus
  implementation and focused tests. Delegating that work would be
  `unit-08/attempt-03`, which trips the documented circuit breaker; work stops
  pending escalation rather than relabeling the attempt.

## 2026-08-23

- Role / unit: Worker / nary-split-support artifact reset / recordkeeping
- Result: Amended only the nary spec, plan, and this append-only log. Preserved
  original unit-08 as partially unaccepted with attempt-01 and attempt-02
  intact. Created fresh zeroed semantic units `unit-08a` and `unit-08b` with no
  acceptance.
- Files / commit: `spec.md`, `plan.md`, `log.md`; uncommitted. No production,
  generated, or test file changed.
- Verification: Read the three records and the complete parked diff. Performed
  documentation and diff review only; no full tests and no live KWin/Plasma
  operation ran.
- Notes: 08a is the supported local/perpendicular keyboard and
  automatic/dwindle insertion candidate, with requested-direction versus
  focused-cell-longest-axis selection and adapter-only opaque-return re-decode.
  08b is the unsupported same-axis new-window preflight rejection candidate,
  requiring zero topology writes and an unassigned/floating incoming window.
  Existing-window unit-07 same-axis drag remains direct parent expansion.
  Parked production and generated re-decode hunks are unsupported as parked,
  with only their re-decode fragments reusable as a shared prerequisite;
  fixture updates are shared prerequisites; local synthetic insertion tests are
  08a candidates; no parked hunk is an 08b candidate; the trailing test
  whitespace deletion is unsupported; existing plan/log changes are unrelated
  recordkeeping.

## 2026-08-23

- Role / unit: Worker and Lead review / unit-08a / attempt-01
- Result: Accepted supported local/perpendicular new-window insertion for
  keyboard and automatic/dwindle paths. Keyboard preserves requested direction;
  automatic/dwindle splits the focused cell's longest axis. Native `split()`
  returns are discarded and live children are adapter-re-decoded. The related
  preset reconstruction return decode was corrected to the same opaque-return
  contract.
- Files / commit: Uncommitted coherent worktree changes in `kwin/src/controller.ts`,
  `kwin/tests/controller-keyboard-placement.test.ts`,
  `kwin/tests/controller-automatic-dwindle-insertion.test.ts`,
  `kwin/tests/controller-deferred-recovery-and-fullscreen.test.ts`,
  `kwin/tests/controller-fixture-scenarios.ts`, and generated
  `kwin/contents/code/main.js`. Commit is deferred until unit-08b is accepted.
- Verification: Worker reports focused coverage plus `npm --prefix kwin test`
  at 956 tests / 90 suites / 0 failures, typecheck clean, bundle build clean,
  271 project checks passing, and `git diff --check` clean. Lead inspected the
  complete source/generated/test diff: opaque-return tests mutate only live
  children, keyboard cases retain requested direction, and automatic N-ary
  coverage preserves parent siblings while splitting the selected cell 50/50.
- Notes: Same-axis new-window mutation remains deliberately unaccepted and is
  unit-08b's required preflight boundary. Existing-window unit-07 drag is
  untouched.

## 2026-08-23

- Role / unit: Worker and Lead review / unit-08b / attempt-01
- Result: Implemented and behavior-reviewed the same-axis new-window preflight
  boundary for keyboard and automatic/dwindle insertion. Both paths reject
  before native `split()` or assignment writes, retain existing topology and
  assignments, and leave the incoming window unassigned/floating. Unit-07
  existing-window same-axis drag remains unchanged.
- Files / commit: Uncommitted coherent worktree changes in `kwin/src/controller.ts`,
  `kwin/tests/controller-keyboard-placement.test.ts`,
  `kwin/tests/controller-automatic-dwindle-insertion.test.ts`, and generated
  `kwin/contents/code/main.js`, together with the accepted-but-uncommitted
  unit-08a files. No commit or push: unit-08b is not accepted while a required
  final gate fails.
- Verification: Worker reports 69 targeted tests / 0 failures including
  unit-07 same-axis drag coverage; `npm --prefix kwin run typecheck` clean;
  `npm --prefix kwin test` 958 tests / 90 suites / 0 failures; `bash
  scripts/dogfood-install.test.sh` 347 assertions / 0 failures (with a
  non-fatal temporary-data `find` warning); generated bundle rebuilt and stable
  at SHA-256 `d4b59f0edfecefa80c08b21c2fb0378845859166a7d4b7db5635951bc66d8eb6`;
  `git diff --check` clean; one production `flashFocusedGroup()` call site.
  Lead inspected the preflight and the keyboard/automatic zero-write tests.
- Gate blocker: `orderCustomTilesByAxis` still has nine call sites outside
  `kwin/src/custom-tile-split.ts`, all pre-existing accepted controller work
  outside this unit's delegated scope. The mandatory no-semantic-order-site
  outside-adapter gate therefore fails. No correction was started because it
  would modify accepted work and conflicts with the frozen no-controller-
  structural-refactor scope.

## 2026-08-23

- Role / unit: Worker / unit-08c / attempt-01
- Result: Implemented the narrowly scoped adapter-ordering convergence exposed
  by the completion gate. The controller no longer imports or calls
  `orderCustomTilesByAxis`; collect-preset-leaves, resize postconditions and
  target resolution, drag split paths, and preset path resolution now consume
  `customTileSplitSeam.decodeChildren`. Acceptance remains pending.
- Files / commit: Uncommitted changes in `kwin/src/controller.ts`,
  `kwin/tests/controller-interactive-drag.test.ts`,
  `docs/changes/nary-split-support/plan.md`, this log, and generated
  `kwin/contents/code/main.js`; no commit or push.
- Verification: `npm --prefix kwin test` - 958 tests / 90 suites / 0 failures;
  `node --test` over the affected preset, resize, drag, keyboard/dwindle,
  deferred-recovery, and adapter/executor bundles - 212 tests / 23 suites / 0
  failures; `npm --prefix kwin run typecheck` - clean for both tsconfigs;
  `bash scripts/dogfood-install.test.sh` - 347 assertions / 0 failures;
  `npm --prefix kwin run build` completed and a second build was byte-identical
  by `cmp`; `git diff --check` passed. The final source search finds the two
  `orderCustomTilesByAxis` references only inside `custom-tile-split.ts`.
- Notes: Two existing drag direction-matrix fixtures did not write the live
  split target's `layoutDirection`; the adapter correctly rejected their
  duplicate axis positions, so those two mocks were minimally corrected
  without changing assertions. The dogfood harness emitted its existing
  non-fatal temporary-data `find` warning. No live KWin/Plasma operation ran.

## 2026-08-23

- Role / unit: Lead acceptance / unit-08c and unit-08b
- Result: Accepted unit-08c's one-attempt adapter-ordering convergence after
  confirming the completion gate found genuine controller-side native geometry
  ordering, not a stale interpretation. All controller ordering decisions now
  use `customTileSplitSeam.decodeChildren`; the ordering helper remains only
  inside `kwin/src/custom-tile-split.ts`. This closes the blocker and accepts
  unit-08b's already-reviewed same-axis preflight behavior. Historical
  unit-08, accepted unit-08a, and all existing counters remain intact.
- Files / commit: Coherent uncommitted unit-08a/08b/08c work remains in
  `docs/changes/nary-split-support/{spec,plan,log}.md`,
  `kwin/src/controller.ts`,
  `kwin/tests/controller-automatic-dwindle-insertion.test.ts`,
  `kwin/tests/controller-deferred-recovery-and-fullscreen.test.ts`,
  `kwin/tests/controller-fixture-scenarios.ts`,
  `kwin/tests/controller-interactive-drag.test.ts`,
  `kwin/tests/controller-keyboard-placement.test.ts`, and generated
  `kwin/contents/code/main.js`; commit and push remain pending.
- Verification: Lead reran `npm --prefix kwin test` serially after the bundle
  build: 958 tests / 90 suites / 0 failures. `npm --prefix kwin run typecheck`
  is clean for both tsconfigs; `bash scripts/dogfood-install.test.sh` reports
  347 assertions / 0 failures; the generated bundle build passes; and `git
  diff --check` is clean. The initial concurrent test/build run lost generated
  `dist` modules during the build and was rerun serially; it was not a code
  failure.
- Notes: The final source search has two `orderCustomTilesByAxis` references,
  both in `custom-tile-split.ts`; `controller.ts` neither imports nor calls it.
  The resize formula, unit-07 drag behavior, workspace invariants, dead drag
  planner, and the single production `flashFocusedGroup()` call site remain
  unchanged. No live KWin/Plasma operation ran.
