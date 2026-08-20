# Specification: COSMIC Move Model Closure

Ownership and approval:
- Owner: Lead
- Status: Approved 2026-08-20 by Orchestrator on user authorization

## Intent and Desired Outcome

Make the COSMIC directional-move corpus complete with the 2026-08-20 live
observations, replacing P1-P5 placeholders, and make the pure reference model
replay the existing 40 corpus transitions plus every newly observed transition.
The live corpus is ground truth: a model disagreement is a model defect, never a
reason to alter an existing corpus result.

## Scope and Non-Goals

In scope:

- Record P1-P5, F1-F3, G1-G2, M1-M4, U1, and U2 as first-class corpus scenarios in
  `docs/cosmic-move-conformance.md`, including input/output trees and observed
  geometry where supplied.
- Correct `kwin/tests/move-conformance-model.ts` and
  `kwin/tests/move-conformance.test.ts` so the original 40 rows remain
  unchanged and every new row is replayed.
- Extend the pure model with an outer multi-output state for R4: output trees,
  directional output adjacency, and focused output/window.
- Propose the required `docs/backlog.md` edits and record the eventual test
  baseline update in `docs/changes/controller-test-split/plan.md`.

Non-goals:

- No production runtime change, including anything below `kwin/src/`.
- No change to `kwin/contents/code/main.js`.
- No KWin import, controller/logic coupling, or runtime wiring for the model.
- No live KWin or COSMIC testing in this change; the supplied live results are
  the evidence source.
- No claim about bspwm or Hyprland runtime behavior.
- No guessed behavior for explicitly unobserved cases.

## Derived Move Rules

For focused leaf W in its direct containing split C and requested direction D,
parallel means D is C's axis and perpendicular means it is the other axis.
"Near side" is the side W arrived from after a move. Child position and count,
not width or screen-centre position, determine these rules.

- R1: If C is perpendicular to D, extract W and wrap C in a new D-axis split,
  placing W at the D end. Collapse C if extraction leaves one child.
- R2: If C is parallel to D and W has neighbour S in D:
  - R2a: with two C children and leaf S, swap W and S.
  - R2b: with two C children and container S, descend by S's direct child count
    n. For even n, insert W flat at index n/2. For odd n, replace child
    (n-1)/2 with a new D-axis split containing that child and W, with W on the
    near side. A nested group is one direct child.
  - R2c: with at least three C children, wrap W and S in a new
   split with C's orientation, W on the near side.
- R3: If C is parallel to D, W is on C's D edge, and C is not root, extract W
  and insert it in C's parent immediately on C's D side; collapse C if needed.
  This escape fires before any descent into an adjacent container. Escape
  normally ends the command. The sole same-command continuation is when the
  receiving parent is perpendicular to D: apply R1 at that parent. This is the
  G1 reconciliation and must not be generalized into reapplying R2, R3, or R4
  after every escape.
- R4: If W is a direct root child on the root's D edge, move it to an output in
  D when one exists. On an occupied target, create a new top-level D-axis split
  with W on the side nearest the source and the target tree on the other side;
  on an empty target, W fills it. Without an output in D, do nothing. The move
  never crosses workspaces.

U1 establishes that R2c is arity-driven: S may be a leaf or container. The
leaf-versus-container distinction applies only to the two-child R2a/R2b case.

## Constraints

- The existing 40 executable corpus rows are immutable acceptance evidence.
  The current artifact breakdown is S1=21, S2=5, S3=14; stale prose claiming
  41 rows or a 22/6/15 breakdown must not be treated as corpus evidence.
- If an implementation breaks an existing row, stop and escalate. Do not edit
  that row to fit the implementation.
- The model remains a pure reference implementation with no KWin imports and
  no dependency on `kwin/src/controller.ts` or `kwin/src/logic.ts`.
- The multi-output model is required rather than deferred: R4 necessarily
  mutates both source and destination trees, which one-root input/output cannot
  represent or assert.
- All currently observed splits are evenly spaced. Geometry after manual resize
  is not inferred.

## Acceptance Criteria

- [ ] The 40 existing rows replay unchanged and pass.
- [ ] P1-P5 placeholders are replaced by their observed live transitions, and
  F1-F3, G1-G2, M1-M4, U1, and U2 are recorded as corpus evidence without
  omission.
- [ ] R1, R2a, R2b, R2c for leaf and container neighbours, and R3 produce the recorded
  single-output results, including the limited perpendicular-parent continuation
  in G1.
- [ ] R4 replays occupied and empty target-output transfers, preserves the
  source tree, places the arrival on the source-adjacent target side, and has no
  cross-workspace transition.
- [ ] The reference model is still pure and is not imported by a runtime path;
  no file under `kwin/src/` and no generated `kwin/contents/code/main.js` is
  changed.
- [ ] `docs/backlog.md` and the controller-test-split baseline record are
  updated as planned, with the latter measured after the new tests are present.
- [ ] `npm --prefix kwin test` and `npm --prefix kwin run typecheck` pass.

## Explicitly Unobserved

- Parity descent into a target nested more than one level deep is unknown.
- Directional move behavior after manual split resize is unknown.

## Consequential Decisions

- Model outputs and directional adjacency rather than recording R4 only in
  prose. The acceptance objective requires executable replay of every supplied
  observation, and R4's two-tree mutation cannot be asserted with the current
  one-root API.
- Preserve a single-root projection for existing test vectors so their inputs,
  expected trees, and sequential replay remain unchanged.
- Treat the direct evidence for G1 as an exception to terminal escape only at a
  perpendicular receiving parent. This explains G1 while retaining F3 sequence
  2's non-descent after escape.
- U1 closes R2c's container-neighbour behavior as wrapping, and U2 closes
  odd-parity near-side placement as direction-symmetric.

Implementation does not begin until the specification is approved unless
autonomous mode was explicitly requested.
