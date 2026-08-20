# Specification: N-ary split container support

Ownership and approval:

- Owner: Lead
- Status: Ready for user decisions and approval

## Objective

Replace the project's structural assumption that every split has exactly two
children with support for ordered N-ary direct children. This is the shared
architectural prerequisite for the `controller.ts` source split and COSMIC
directional movement; it is not a COSMIC-only accommodation.

## Scope

In scope:

- Represent and validate an ordered list of direct split children. A nested
  group is exactly one direct child.
- Generalize split decoding, construction, reconstruction, validation,
  minimum-size checks, resize handling, and reflow normalization where their
  current contracts require two children.
- Support same-axis wrapping, parent escape, one-child collapse, and operations
  on splits with three or more direct children.
- Make every 3+-child topology decision from direct-child count and order, never
  width, screen position, or other geometry.
- Characterize and preserve every binary-only behavior. For identical
  binary-only inputs, the ordered layout serialization and window assignments
  must be byte-identical to the pre-migration baseline.
- Extend focused tests across the inventory in
  `research/binary-coupling.md`, without changing unrelated behavior.

## Non-Goals

- Implementing COSMIC directional-move runtime behavior, a model selector, or
  any other window-management strategy.
- Coupling or importing `kwin/tests/move-conformance-model.ts` into runtime
  code. It remains a pure, KWin-independent reference implementation.
- Claims about parity descent into a target nested more than one level deep.
- Claims about behavior after a manual split resize, beyond the resize contract
  selected under Pending User Decisions.
- Using geometry as a proxy for child count or child order in 3+-child
  operations.

## Constraints

- KWin native tiles are not assumed structurally binary. The current binary
  coupling is a project-layer concern.
- KWin's `split(direction)` input takes one direction. The available evidence
  does not establish native result cardinality; the project must not turn its
  current two-child decode policy into a native API claim.
- Existing binary-only strategies must retain byte-identical layout results.
- No runtime behavior may depend on the conformance model.

## Acceptance Criteria

- [ ] The core split contract accepts and preserves ordered direct-child lists,
  including a nested group as one child, and rejects malformed lists
  deterministically.
- [ ] Focused structural tests cover same-axis wrapping and parent escape in
  3+-child containers, including immediate adjacency, one-child collapse, and
  geometry-independent child count/order decisions.
- [ ] Each of the 24 direct binary-coupled functions and both named
  structural-binary types in `research/binary-coupling.md` is migrated,
  removed, or retained behind an explicitly N-ary-safe contract.
- [ ] The 13 affected test files and shared fixture identified by the research
  inventory have appropriate updated or added coverage.
- [ ] Characterization tests prove byte-identical ordered layout serialization
  and window assignments for all existing binary-only fixtures before and after
  the migration.
- [ ] `npm --prefix kwin test` passes, `npm --prefix kwin run typecheck` is
  clean for both tsconfigs, and `bash scripts/dogfood-install.test.sh` reports
  zero failures.

## Pending User Decisions

- Should this be a hard type migration to ordered child arrays, or may a
  temporary compatibility shim preserve tuple-shaped contracts at boundaries?
  Options: hard migration; boundary-only shim with an explicit removal unit.
- What represents N-ary proportions? Options: an N-length ratio array;
  per-child weights normalized at use; retain only native geometry with no
  project ratio representation.
- How does resize absorb a delta in a 3+-child split? Options: the immediate
  adjacent sibling only; all eligible siblings proportionally; a selected
  deterministic sibling policy; reject N-ary resize until separately designed.
- After insertion into an N-ary container, what normalization rule applies?
  Options: equalize all direct children; equalize only the inserted local pair;
  preserve existing proportions and assign a defined new-child proportion.
- What is the canonical ordered-child source independent of geometry? Options:
  stable native child enumeration; project-owned persisted order; another
  explicitly specified boundary contract.
- How should native split-result cardinality be handled? Options: retain and
  assert the known binary result at the native split boundary while N-ary
  containers are formed through composition; broaden the boundary to decode an
  arbitrary native list after evidence establishes its contract.
- Should `move-conformance-model.ts` be a test-only behavioral oracle for the
  new structural tests? Options: replay its relevant vectors against a
  test-only adapter; keep it independent and author equivalent focused N-ary
  vectors; use it only as reference documentation.

## Approval Boundary

Implementation begins only after the Pending User Decisions are resolved and
this specification is approved. Autonomous mode authorized preparation of this
artifact, not resolution of its consequential design choices.
