# Specification: Binary Layout Blueprints

Ownership and approval:
- Owner: Lead (`lead-openai`).
- Change class: Standard.
- Status: Completed and archived on 2026-08-11 after autonomous alignment and
  result approval.
- Artifact map: [plan](plan.md).

## Intent and Desired Outcome

Deliver one pure TypeScript blueprint generator for a deterministic, balanced
binary split topology from a positive requested leaf count. The blueprint is an
authored-layout planning value only. It gives later Custom Tile work a tested
binary structure without invoking KWin or choosing how KWin realizes geometry.

## Scope and Constraints

In scope:

- An immutable, KWin/Qt-independent binary-topology value model.
- A deterministic generator that divides a positive leaf count into a balanced
  binary split tree with explicit split orientation supplied by the caller.
- Pure executable vectors for structure, determinism, invalid counts, and input
  immutability.

Constraints:

- The generator must not access KWin globals, Qt values, controller state, or
  runtime package metadata.
- The result must describe topology only. It must not include geometry, ratios,
  window association, workspace/output identity, persistence, or an execution
  instruction.
- The source-pinned KWin declaration exposes `CustomTile.split()` but no
  geometry or ratio-setting contract. This change must make no visual-equality
  or runtime-application claim.
- TypeScript remains the only authored production language. No `any`, unchecked
  cast, non-null assertion, or manual generated-JavaScript edit is permitted.

Non-goals:

- No KWin adapter, `controller.ts`, `entry.ts`, ambient declaration, generated
  bundle, metadata, shortcut, or live-session change.
- No layout-preset catalogue, grid, master-stack, spiral, arbitrary proportions,
  visual mode, effect, decoration, workspace policy, multi-output identity, or
  persistence decision.
- No dependency on Custom Tile structural acceptance or on keyboard navigation
  controller acceptance.

## Acceptance Criteria

- [ ] A pure immutable binary-topology type and balanced generator are authored
      in a new `kwin/src/layout-blueprint.ts` module with no KWin/Qt import or
      global access.
- [ ] For every positive tested count, the generated tree has exactly that many
      leaves, is binary at every interior node, has the caller-selected
      orientation at every split, and has subtree leaf counts differing by at
      most one at each split.
- [ ] Repeated calls with equivalent inputs return structurally equal blueprints
      and leave all caller-owned values unchanged.
- [ ] Zero, negative, non-finite, and non-integer counts reject through the
      project's existing `Result`/`Rejection` pattern without a partial plan.
- [ ] Focused Node tests plus `npm run typecheck`, `npm run build`, and `npm
      test` pass. The generated KWin bundle remains byte-identical because no
      production entry wiring is added.
