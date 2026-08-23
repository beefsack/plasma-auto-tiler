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

### Unit 05 - Reflow, Observers, and Drag

- Dependencies: unit 04 accepted; unit 03 review complete.
- Bounded scope: reflow scheduling, observers, drag lifecycle, and related
  deferred work, without moving reconstruction/dwindle/workspace logic.
- Invariants: signal registration/disconnection, deferred ordering and
  cancellation, drag/reflow geometry and recovery semantics, and exactly one
  structural-mutation reporting/flush path and one production
  `flashFocusedGroup()` call site.
- Verification: focused observer/drag/reflow tests, full suite, typechecks,
  import/lifetime inspection, and the second independent review after lifecycle
  and drag extraction.

### Unit 06 - Reconstruction, Dwindle, and Workspaces

- Dependencies: unit 05 accepted and independently reviewed.
- Bounded scope: reconstruction, dwindle/layout execution coordination, and
  workspace-specific flows not already owned by unit 02.
- Invariants: preserve all layout execution, insertion, workspace, recovery,
  adapter, geometry, and deferred flush behavior; no N-ary or COSMIC changes.
- Verification: focused reconstruction, dwindle, insertion, workspace, and
  adapter tests; full tests and typechecks; static facade/import review.

### Unit 07 - Facade and Bundle Finalization

- Dependencies: units 01-06 accepted; all required reviews complete.
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
