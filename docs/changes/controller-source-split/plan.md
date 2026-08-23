# Plan: Controller Source Split

## Technical Approach

First map `controller.ts` by ownership, callback lifetime, signal lifecycle,
deferred work, and mutation-flush boundaries. Extract cohesive domains behind
narrow capability contracts while keeping composition, public registration, and
textually constrained shortcut callbacks in `controller.ts`. No extracted domain
imports another extracted domain at runtime; shared substrate helpers and types
are allowed. Preserve behavior by moving code with its existing ordering and
closures before making any local cleanup.

Line counts are cohesion targets only. A module materially above about 1,000
lines is acceptable only when its ownership and boundaries are documented in
the unit checkpoint and `state.md`; no artificial split or dumping-ground
controller-types module is permitted.

## Work Units

### Unit 01 - Config and Catalog

- Dependencies: baseline and source inventory only; no prior semantic unit.
- Bounded scope: configuration interpretation, preset/catalog ownership, and
  their pure contracts. Keep public config and shortcut semantics unchanged.
- Invariants: same defaults, parsing, catalog ordering, callback identity, and
  no runtime import into another extracted domain.
- Verification: focused existing config/catalog tests, both TypeScript configs,
  full test suite when practical, diff and import-graph inspection; no live run.

### Unit 02 - Topology and Workspace State

- Dependencies: unit 01 accepted; its contracts are the only new inputs.
- Bounded scope: topology ownership, workspace/output state, and state lookup
  that currently belongs to the controller.
- Invariants: exact workspace/output identity and lifecycle behavior, topology
  and recovery semantics, signal registration/disconnection, and no geometry or
  N-ary behavior changes.
- Verification: topology, workspace, recovery, and fixture-scenario tests;
  typecheck; static lifecycle and import-boundary review.

### Unit 03 - Narrow Shared State and Capabilities

- Dependencies: units 01-02 accepted.
- Bounded scope: introduce only the smallest explicit capabilities and state
  interfaces needed by later domains; wire them at the facade composition root.
- Invariants: no generic god object, service locator, mutable bag, broad
  controller import, or dumping-ground types module; preserve object identity,
  closure lifetime, deferred cancellation, and mutation flush timing.
- Verification: contract-focused tests and static call-site/import checks;
  typecheck and full tests. This is the shared-context checkpoint and triggers
  the first independent review.

### Unit 04 - Input and Window Actions

- Dependencies: unit 03 accepted and independently reviewed.
- Bounded scope: input dispatch and window actions, excluding reflow/drag
  observers and reconstruction. Shortcut registration callbacks remain in
  `controller.ts` unless separate evidence and approval change that constraint.
- Invariants: public shortcut/config semantics, callback identity/lifetimes,
  focus, move, resize, float/sticky/maximize/fullscreen, and adapter behavior.
- Verification: focused controller action tests, all existing tests, both
  typechecks, and static textual shortcut checks; no live KWin operations.

### Unit 05 - Frozen Reflow, Observers, and Drag

- Status: permanently frozen before implementation. It retains attempts 2,
  cancellations 0, corrections 0, independent reviews 0, and circuit breaker
  1. Both attempts stopped at malformed Worker preflight with no source work,
  verification, or candidate to recover; another attempt is prohibited.

### Unit 05A - Reflow and Lifecycle Observers (`unit-05a-reflow-observers`)

- Dependencies: unit 04 accepted; unit 03 independent review complete.
- Bounded scope: selected-overlay reflow state and execution; reflow callbacks
  after removal, detach, and addition; non-interactive lifecycle observer
  callbacks; and the one-shot desktop-scope eligibility reevaluation with its
  token-identity cancellation on removal.
- Exclusions: interactive-watch attachment, drag state, outline, geometry-drop
  behavior, drag-origin deferred-work coordination, reconstruction, dwindle,
  workspace execution, public facade ownership, and shortcut registration.
- Invariants: preserve observer registration, callback identity, lifecycle
  order, selected-overlay reflow ordering and rejection behavior, and exactly
  one eligibility callback per window. A stale eligibility callback is inert and
  removal cancels it before later removal processing. The domain receives only
  existing narrow capabilities and has no runtime import of another extracted
  domain.
- Shared mutation ownership: `controller.ts` remains composition root and the
  sole owner of `StructuralMutationCapability`, its pending flag,
  `flushStructuralMutation()`, and the only production
  `flashFocusedGroup()` invocation. This unit reports reflow writes only through
  that existing capability and creates no mutation or flush path.
- Verification: focused reflow/observer and eligibility-cancellation
  characterization as needed; both TypeScript configurations; the full existing
  suite; dogfood; two normal builds with matching generated-bundle SHA-256;
  `git diff --check`; and static facade export, import-cycle, runtime
  sibling-import, signal-lifetime, callback-order, and sole mutation-path
  inspection. No independent review occurs at this checkpoint.

### Unit 05B - Drag and Deferred-Work Coordination (`unit-05b-drag-deferred-work`)

- Dependencies: `unit-05a-reflow-observers` accepted.
- Bounded scope: interactive-watch attachment/disconnection, `DragState`,
  interactive callbacks, drop-outline state, drag geometry/drop recovery, drag
  snapshots, and drag-specific deferred-work coordination.
- Exclusions: non-interactive lifecycle observers and eligibility timer;
  reconstruction, dwindle, workspace algorithms, and pending-rebuild ownership;
  fullscreen/maximize behavior; public facade ownership; and shortcut
  registration.
- Deferred-work ownership: this unit owns live-drag detection, owed-invariant
  queueing and settlement ordering, and `armedDeferredRemoval`. It requests the
  existing deferred removal-collapse operation through a narrow facade callback;
  Unit 06 retains that operation's collapse/reconstruction execution and yield
  implementation.
- Invariants: preserve drag signal lifetimes, finish-only structural mutation,
  geometry/recovery behavior, and outline cleanup. An armed deferred removal
  suppresses immediate invariant settlement, which occurs after the existing
  deferred-removal completion; no duplicate or stale drag callback may act.
- Shared mutation ownership: `controller.ts` retains the sole structural
  reporting/flush implementation and production `flashFocusedGroup()` call site.
  This unit receives only the same existing narrow mutation capability and never
  creates a pending flag, flush implementation, or flash call site.
- Verification: focused interactive-watch, drag, outline, deferred-removal
  ordering, and owed-invariant tests; both TypeScript configurations; the full
  existing suite; dogfood; two normal builds with matching generated-bundle
  SHA-256; `git diff --check`; static facade/import/lifetime inspection; and the
  second independent review after this unit only.

### Unit 06 - Reconstruction, Dwindle, and Workspaces

- Dependencies: `unit-05a-reflow-observers` accepted and
  `unit-05b-drag-deferred-work` accepted and independently reviewed.
- Bounded scope: reconstruction, dwindle/layout execution coordination, and
  workspace-specific flows not already owned by unit 02.
- Invariants: preserve all layout execution, insertion, workspace, recovery,
  adapter, geometry, and deferred flush behavior; no N-ary or COSMIC changes.
- Verification: focused reconstruction, dwindle, insertion, workspace, and
  adapter tests; full tests and typechecks; static facade/import review.

### Unit 07 - Facade and Bundle Finalization

- Dependencies: units 01-04, `unit-05a-reflow-observers`,
  `unit-05b-drag-deferred-work`, and unit 06 accepted; all required reviews
  complete.
- Bounded scope: reduce `controller.ts` to the public facade/composition root,
  remove only obsolete internal code, regenerate the bundle normally, and
  reconcile package/typecheck inputs.
- Invariants: no public API or behavior change, no compatibility shim, one
  facade, one structural reporting/flush path, one production
  `flashFocusedGroup()` call site, and generated behavior equivalent even if
  bundle bytes/order differ.
- Verification: full 965-test / 91-suite baseline comparison with 0 failures,
  clean `kwin/tsconfig.json` and `kwin/tsconfig.test.json` typechecks, dogfood
  347/0, generated-bundle regeneration/checks, final static review, and no
  live KWin operations. This is the final-facade independent review.

## Execution Record

| Unit | Attempts | Cancellations | Corrections | Independent reviews | Status |
|---|---:|---:|---:|---:|---|
| Unit 04 | 2 | 1 | 1 | 1 | Accepted: attempt 2 recovered the candidate; its one P1 input ownership finding was corrected and Lead-confirmed. |
| Unit 05 | 2 | 0 | 0 | 0 | Frozen permanently before implementation: two malformed Worker preflights performed no source work; circuit breaker 1 prohibits another attempt. |
| Unit 05A | 1 | 0 | 0 | 0 | Accepted: extracted reflow state/execution, lifecycle reflow callbacks, and eligibility token cancellation behind the approved narrow seam. |
| Unit 05B | 1 | 0 | 1 | 1 | Accepted: attempt 1 extracted drag and deferred-work coordination; its three independent-review findings were corrected and Lead-confirmed. The Worker omitted its required identity-preflight line, a recorded process-compliance defect with no role mismatch or technical acceptance gap. |
| Unit 06 | 2 | 0 | 1 | 1 | Accepted: attempt 01 stopped at a malformed role preflight before source work. Attempt 02 extracted layout/reconstruction and deferred workspace queues; its sole independent review found three issues, all corrected and Lead-confirmed. No third attempt or second review ran. |

- Change-wide independent reviews: 4, belonging to accepted Units 03, 04, 05B, and 06.
- Circuit breakers: 1 - frozen Unit 05 reached its attempt limit before
  implementation; no third attempt is authorized. The approved semantic reset
  creates independently accountable Units 05A and 05B with fresh counters.
- Next semantic unit: Unit 07 - facade and bundle finalization.
- Reconciliation evidence before Unit 04 attempt 2: the candidate changes
  `controller.ts`, adds the input/window action domains, and has an unverified
  generated bundle with 22 trailing-whitespace findings. The facade contains
  obsolete commented legacy action implementations that recovery must remove.
- Unit 04 independent review found P1: resize-mode state, entry/exit, and
  focus-versus-resize routing remained in `controller.ts` rather than the input
  domain. The one same-scope correction moved that state and routing into the
  input domain; Lead confirmation checked only that recorded finding. No second
  independent review ran or is available.
- Unit 04 acceptance evidence, all static: `npm --prefix kwin run typecheck`
  passed both configurations; `npm --prefix kwin test` reported 965 tests / 91
  suites / 0 failures / 0 skipped; `bash scripts/dogfood-install.test.sh`
  reported 347 passes / 0 failures; `git diff --check` was clean; two
  `npm --prefix kwin run build` runs followed by `sha256sum
  kwin/contents/code/main.js` matched
  `3434ccd9de8b264665083f83ba24485d0ba37ab78f78ea1dd34e88c4cf2b9e52`.
  Static import/facade inspection found type-only topology imports, no action
  domain runtime import of `controller.ts` or its sibling, one production
  `flashFocusedGroup()` invocation, and the existing sole structural
  reporting/flush path.
- Unit 05A acceptance evidence, all static: focused existing reflow/observer
  and eligibility-cancellation suites reported 46 tests / 3 suites / 0
  failures; `npm --prefix kwin run typecheck` passed both configurations;
  `npm --prefix kwin test` reported 965 tests / 91 suites / 0 failures / 0
  skipped; `bash scripts/dogfood-install.test.sh` reported 347 passes / 0
  failures; `git diff --check` was clean; two normal builds produced matching
  `kwin/contents/code/main.js` SHA-256
  `fbbfb573f9e5ab3e57a2edcedd9a424112a66da71afd7f2b768719fdd10275c0`.
  Lead inspection found `controller-reflow-observers.ts` is 393 lines, imports
  only boundary and type-only logic/catalog dependencies, and is composed by
  `controller.ts` without runtime sibling-domain imports. The facade retains
  the sole structural pending/flush implementation and sole production
  `flashFocusedGroup()` invocation; removal cancels eligibility before reflow
   and deferred eligibility re-enters the pre-existing placement, cleanup, and
   intent-drain order. No tests were changed and no independent review is due.
- Unit 05B acceptance evidence, all static: focused existing interactive-watch,
  drag, and outline suites reported 43 tests / 3 suites / 0 failures;
  `npm --prefix kwin run typecheck` passed both configurations;
  `npm --prefix kwin test` reported 965 tests / 91 suites / 0 failures / 0
  skipped; `bash scripts/dogfood-install.test.sh` reported 347 passes / 0
  failures; `git diff --check` was clean; two normal `npm --prefix kwin run
  build` runs produced matching `kwin/contents/code/main.js` SHA-256
  `cd4145bd8b0d2b27d1e634483ab6ddb7936abb548a66382da72f268842c242cc`.
  Independent review found explicit QRectF geometry capture, runtime
  extracted-domain imports, and disabled-path drag-state clearing. One
  same-scope correction restored explicit field capture, replaced runtime
  sibling imports with narrow facade helper callbacks, and restored
  outline-only disabled cleanup; Lead confirmation checked only those findings.
  The implementation Worker omitted its required identity-preflight line; this
  is a recorded process-compliance defect, not a technical acceptance gap.
  Static inspection found type-only extracted-domain imports in
  `controller-interactive-drag.ts`, `entry.ts` as the sole runtime importer of
  `controller.ts`, one production `flashFocusedGroup()` invocation, and the
   existing sole structural reporting/flush path. No second independent review
   ran or is available.
- Unit 06 acceptance evidence, all static: the implementation Worker reported
  focused reconstruction, dwindle/insertion/removal, deferred-recovery,
  workspace-mode, trailing-empty lifecycle, output-isolation, and
  deferred-removal coverage within the full suite; `npm --prefix kwin run
  typecheck` passed both configurations; `npm --prefix kwin test` reported 965
  tests / 91 suites / 0 failures / 0 skipped; `bash
  scripts/dogfood-install.test.sh` reported 347 assertions / 0 failures; two
  normal `npm --prefix kwin run build` runs produced matching
  `kwin/contents/code/main.js` SHA-256
  `468ddf82db849c7d9ea50a1234709106ea2903353dc16bdc737d2c7f87b816a1`;
  `git diff --check` was clean. Lead inspection found the 387-line layout domain
  and 64-line workspace domain use only type-only sibling imports, have no
  mutable state exposure, and are composed by the facade. The sole review found
  an inert-removal diagnostic regression, duplicate reconstruction methods, and
  mutable/widened capabilities; correction 01 restored the diagnostic, removed
  the duplicate implementation, and returned mutable ownership to the facade
  behind explicit operations. Static inspection found `entry.ts` remains the
  sole runtime importer of `controller.ts`, geometry-ordering code was not
  changed outside `custom-tile-split.ts`, shortcut callbacks remain in the
  facade, and there is one production `flashFocusedGroup()` invocation and one
  `flushStructuralMutation()` implementation. No second review ran or is
  available.

## Checkpoints and Circuit Breakers

Each unit stops at its checkpoint for diff inspection, import-graph inspection,
focused verification, and preservation of the baseline. A circuit breaker is
incremented for a behavior regression, a broken callback/signal/deferred
lifetime invariant, a second structural flush or flash call site, a forbidden
runtime domain import, a test weakening/removal, or an unexplained module over
the line-count target. The worker stops and reports the finding; the next
dispatch requires correction or explicit Orchestrator approval. Counters are
recorded in `state.md`; no live-testing counter is opened because live testing
is excluded.

Units may be subdivided before implementation only to keep one Worker bounded.
Such subdivisions must preserve the unit's semantic boundary. Semantic plan
changes require Orchestrator approval.
