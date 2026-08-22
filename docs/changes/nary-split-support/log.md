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
