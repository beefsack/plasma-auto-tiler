# Plan: Keyboard Navigation Vertical Slice

Ownership and approval:
- Owner: Lead (`lead-openai`).
- Change class: Standard.
- Status: Static scope completed and archived on 2026-08-11 after autonomous
  alignment and result approval.
- Governing scope: [specification](spec.md).

## Technical Approach

Extend the accepted pure Custom Tile logic rather than introduce a navigation
model. Decode the active window's current scope and authored leaf topology
through the existing controller. Resolve a leaf using the pure facing-edge,
perpendicular-overlap rule, then select a validated target occupant and assign
only `workspace.activeWindow`. No topology or window association is modified.

The existing global shortcut registration path remains the sole registration
gate. The new actions are `plasma-auto-tiler-focus-left`,
`plasma-auto-tiler-focus-down`, `plasma-auto-tiler-focus-up`, and
`plasma-auto-tiler-focus-right`, with display texts `Focus window left`,
`Focus window down`, `Focus window up`, and `Focus window right`, respectively.
Their H/J/K/L defaults avoid the existing `Meta+Alt+Right` insertion binding.
Registration failure disables the feature through the existing aggregate gate;
registered callbacks remain guarded and inert after disablement.

## Work Units

| ID | Status | Objective | Depends on | File or subsystem scope | Invasive? | Verification |
|---|---|---|---|---|---|---|
| unit-01 | Accepted 2026-08-11 | Add the pure directional-neighbor result to `logic.ts`, based on existing leaf geometry and `compareLeaves`, with tests for directions, recursive/nested leaf shapes, overlap, gaps, ties, no-wrap, rejection, and immutability. | accepted Custom Tile unit-02 | `kwin/src/logic.ts`, `kwin/tests/logic.test.ts` | No | `findNeighborLeaf` vectors establish the geometry rule; `npm run typecheck` and `npm test` pass with 90 tests. |
| unit-02 | Accepted 2026-08-11 | Add guarded controller focus handling, a narrow writable `Workspace.activeWindow` declaration, and entry wiring. Reuse current scope/topology/eligibility decoding; register four focus shortcuts through the existing gate and emit fixed private diagnostics. | unit-01; accepted Custom Tile unit-01, unit-04 | `kwin/src/{controller,entry,kwin-globals.d.ts}`, `kwin/tests/controller.test.ts` | No | A compliant fresh independent review found no blocking defect. The candidate filter selects only non-layout, occupied leaves whose occupants all pass the exact-scope eligibility guard, with target revalidation retained. Controller vectors cover nearer empty/ineligible leaves skipped for a farther eligible target, no eligible candidate/no write, deterministic repeats, and fixed diagnostics. |
| unit-03 | Accepted 2026-08-11 | Independently review the bounded source/test changes for directional-rule fidelity, KWin declaration provenance, guarded boundaries, registration failure/inertness, diagnostics privacy, generated-artifact policy, and scope exclusions. | unit-02 | Static review and recorded command evidence | No | Fresh read-only Worker asserted the required role, returned `review-ready` at 22/22 calls, and found no defect. Lead reconciled the reviewed controller, tests, writable declaration, entry seam, and generated IIFE. Missing explicit multi-occupant and entry re-narrowing integration vectors are non-blocking coverage gaps. |
| unit-04 | Accepted 2026-08-11 | Run final automated verification and reconcile generated bundle/static controls. Record live runtime behavior as deferred, without live action. | unit-03 | Package verification and change artifacts | No | Current retained typecheck/static-scan evidence applies because the reviewed source is unchanged. Lead reran `npm test` only to resolve the stale test-count discrepancy: 140/140 tests across 23 suites pass, rebuilding the IIFE at SHA-256 `866b594b922e46862c9113c6e0bb7ac601d855df6bd428037787a29d28841422`. |

Only the Lead mutates plans and state. Semantic unit IDs are stable; execution
slices use `unit-<n>/attempt-<n>`.

## Acceptance-Criterion Evidence

| Acceptance criterion | Evidence |
|---|---|
| Deterministic pure navigation | `unit-01` executable `logic.test.ts` vectors against the specified edge-distance and tie rule |
| Exact-scope guarded no-ops | `unit-02` controller-harness cases reusing `windowInScope`, `scopeForWindow`, and decoded topology |
| Focus-only success | `unit-02` harness assertions on active target and unmodified tile/window doubles |
| Writable API fidelity | `unit-02` declaration diff tied to the pinned `workspace_wrapper.h` WRITE Q_PROPERTY evidence in the specification |
| Four shortcut gate behavior | `unit-02` registration-name/sequence/order/failure tests using the existing injected environment |
| Static delivery safety | `unit-03` review plus `unit-04` typecheck, build, test, bundle, privacy, and generated-artifact evidence |

## Dependencies and Deferrals

- Accepted Custom Tile `unit-01` supplies the strict toolchain and source-pinned
  declaration policy; `unit-02` supplies pure geometry and ordering seams;
  `unit-04` supplies static review/build controls.
- Custom Tile `unit-03` behavior and `unit-05` live acceptance are unaccepted.
  This change may achieve static delivery only. Runtime KWin focus-assignment,
  QList marshalling, and shortcut registration remain manual-blocked and cannot
  be claimed accepted here.
- The parked live automation/supervisor proof is not a dependency and must not
  be investigated, revived, or changed by these units.

## Residual Risks

- KWin's source-declared active-window WRITE property is not live-validated in
  the current environment.
- Registering multiple shortcuts cannot roll back prior KWin registrations on a
  later false return; the existing feature gate keeps resulting callbacks inert,
  while runtime cleanup semantics remain deferred.
- Geometry-only navigation across a gap is deliberate and deterministic, but
  future product policy may choose a different neighbor metric only through a
  separate approved change.

## Pending User Decisions

- None for static implementation. Any live validation requires fresh separate
  authorization after the parked supervisor-proof blocker is resolved.

## Final Outcome

- Static acceptance is complete for units 01 through 04. The retained evidence
  map records 140/140 passing tests across 23 suites and production IIFE SHA-256
  `866b594b922e46862c9113c6e0bb7ac601d855df6bd428037787a29d28841422`.
- No lasting documentation beyond this archived specification and plan was
  required. The active-change state and checkpoint log were transient and removed.
- Live KWin focus assignment, QList marshalling, shortcut registration, and
  Custom Tile runtime behavior remain deferred and are not accepted by this
  static change.
