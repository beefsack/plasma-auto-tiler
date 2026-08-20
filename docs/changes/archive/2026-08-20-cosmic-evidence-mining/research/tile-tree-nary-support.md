# Research: does the tile/split tree support N-ary splits?

Scope: `kwin/src/` only, read-only. This is a findings document, not a
recommendation or implementation plan.

## Architectural note (relevant to all questions below)

The tile tree itself is **not** owned or defined by this project. It is
KWin's native C++ tile tree (`src/tiles/tile.h`, `src/tiles/customtile.h`
in KWin, not in this repo), exposed to this project's TypeScript only
through a narrow QML/scripting surface declared in
`kwin/src/kwin-globals.d.ts:188-239`:

- `Tile` (`kwin-globals.d.ts:188-216`): `relativeGeometry`, `parent`,
  `tiles` (QList, `unknown` until decoded), `windows`, `isLayout`,
  `canBeRemoved`.
- `CustomTile extends Tile` (`kwin-globals.d.ts:220-229`): adds
  `layoutDirection` (readonly), `split(direction): unknown`, `remove()`.
- `RootTile extends CustomTile` (`kwin-globals.d.ts:236-239`).

So "does the tree support N children" has two distinct answers: what
KWin's native tree structurally permits, and what this project's TS code
assumes/relies on when it walks or mutates that tree. They differ.

## Q1: Is the tile/split tree binary or N-ary?

**The underlying KWin `Tile`/`CustomTile` type itself is not binary.**
`tiles` is a `QList` (`kwin-globals.d.ts:199`, `:224`), i.e. an
arbitrary-length ordered collection, not a `left`/`right` pair or 2-tuple.
General tree-walking code in this project decodes it with no length cap
(`decodeSequential(..., MAX_SEQUENTIAL_LENGTH)` where
`MAX_SEQUENTIAL_LENGTH = 1024`, `boundary.ts:1`) - see e.g.
`controller.ts:1240`, `:1278`, `:1327`, `:1354`, `:1383`, `:6391`,
`:6490`, `:6701`. Nothing in the native type or these generic decodes
enforces exactly 2 children.

**However, this project's own logic layer is strictly binary in every
place that reasons about split structure**, via three independent
mechanisms:
- `decodeSequential(tile.tiles, isCustomTile, 2)` - hardcoded max length
  2 - at `controller.ts:1569`, `:2712`, `:2759`.
- `orderedChildren()` (`controller.ts:1480-1501`) has a type signature
  that returns `readonly [CustomTileCapability, CustomTileCapability] |
  null` and explicitly rejects `children.length !== 2` (line 1486).
- `EqualSplit` in `logic.ts:279-283` models a split as exactly `first`/
  `second` rects, not a list.
- The blueprint executor's split-creation path treats every split as
  producing exactly `left`/`right` (`layout-executor.ts:154-155`,
  `left = children[0]; right = children[1]`).

Conclusion: KWin's native tree type is N-ary-capable in principle (QList
children), but this project never creates, walks, or resizes anything
but 2-child splits. Everywhere split *structure* (as opposed to generic
whole-tree occupant/window enumeration) is reasoned about, the code shape
is fundamentally binary, not just binary-by-convention.

## Q2: Scoped impact assessment for N-ary support

This is binary by construction in the logic layer, not just by the type.
Specific call sites that assume exactly 2 children:

| Function | Location | Assumption |
|---|---|---|
| `orderedChildren` | `controller.ts:1480-1501` | Return type is a 2-tuple; rejects any `length !== 2` |
| `presetNodeMatches` | `controller.ts:1559-1582` | Decodes with cap 2 (`:1569`), matches against `node.left`/`node.right` |
| `resolveResizeSplit` | `controller.ts:2745-2788` | Decodes with cap 2 (`:2759`), computes `first`/`second`/`neighbor` from a 2-element `ordered` tuple |
| `resizeWouldViolateMinimum` | `controller.ts:2796-2819` | Takes `firstProposed`/`secondProposed` as the only two extents on the axis |
| resize commit path | `controller.ts:2712` (in the enclosing resize handler) | Re-decodes fresh children with cap 2 after a geometry write |
| `EqualSplit` / `planEqualSplit` | `logic.ts:279-283`, `:312-...` | Models a split as exactly two adjacent rects (`first`, `second`) filling the parent along one axis |
| blueprint split execution | `layout-executor.ts:148-159` | `seam.split()` result destructured as `children[0]`/`children[1]` only; a preset `Blueprint` node is itself `left`/`right`-shaped (see `layout-blueprint.ts`, not read line-by-line here but referenced via `node.left`/`node.right` at `controller.ts:1579-1580`) |

Rough invasiveness per area, without prescribing solutions:

- **Node/type shape**: the KWin-facing type (`CustomTile.tiles` as
  `QList`) already tolerates N children - no KWin-side type change
  needed. This project's own `Blueprint`/preset node shape
  (`left`/`right` in `layout-blueprint.ts`, exercised at
  `controller.ts:1579-1580`) and the `EqualSplit` type (`logic.ts:279`)
  are the parts that would need to become list-shaped. Moderate: touches
  a small number of type definitions but ripples into every consumer.
- **Ratio/size handling**: there is no stored "ratio" field anywhere in
  this codebase - sizing is entirely derived from each child's own
  `relativeGeometry` rect (`kwin-globals.d.ts:195`), and the resize path
  computes two proposed extents directly (`resizeWouldViolateMinimum`,
  `controller.ts:2796-2819`) and writes `relativeGeometry` on exactly two
  siblings (`controller.ts:2665-2723`, referencing `target.focused`/
  `target.neighbor`). Generalizing "grow one child, shrink its neighbor"
  to N children changes which siblings absorb a resize delta and is a
  materially different algorithm, not a mechanical generalization.
  Substantial for the resize feature specifically.
- **Traversal**: generic traversal (`decodeSequential(..., MAX_SEQUENTIAL_LENGTH)`)
  already handles arbitrary child counts; low cost here.
- **Insertion**: split-creation is currently only ever binary
  (`layout-executor.ts:149`, one `split()` call producing exactly 2
  children per the preset `Blueprint` shape). Inserting a 3rd+ sibling
  into an existing split (rather than nesting another binary split) is
  not something any code path here does today; there's no "add child to
  existing split" primitive to generalize - it would be new, not
  modified, logic. Moderate-to-substantial depending on how insertion is
  meant to behave (append vs. re-derive geometry for all siblings).
- **Removal/collapse**: see Q3 - collapse behavior is delegated to native
  KWin plus a reconciliation pass; the invariant-check path
  (`presetEnsureInvariant`, referenced at `controller.ts:7379`, `:7387`)
  assumes a "dwindle" (binary) target shape when detecting drift. Any
  N-ary target shape would need its own invariant definition. Substantial,
  because the entire self-healing/invariant model is binary-preset-shaped.

Overall for Q2: not a localized fix. The binary assumption is load-bearing
across preset matching, resize, and the invariant/self-heal system, in
addition to the type shapes.

## Q3: Does the tree collapse a single-child split automatically?

No explicit "collapse single-child split" function exists anywhere in
`kwin/src/`. Removal is delegated to native KWin via
`removeCustomTile()` (`boundary.ts:406`), called from
`collapseFreedLeaf()` (`controller.ts:7353-7389`) and
`collapseOwnedScope()`/`collapseToRootLeaf` seam (`controller.ts:6367-6375`,
via `topology-reset.ts`).

The comment at `controller.ts:7383-7386` is direct evidence that KWin's
native removal does **not** reliably collapse a resulting single-child
split node on its own:

> "A changed managed count may leave the tree non-dwindle (for example
> removing the first chain window's leaf leaves a single-child root); the
> invariant check starts a reconstruction in this same removals-only
> dispatch and defers the split reconstruction."

So after `remove()`, this project calls `presetEnsureInvariant(scope)`
(`controller.ts:7379`, `:7387`) which detects a tree that no longer
matches the expected dwindle/binary preset shape and **reconstructs** it
(tears down and re-splits), rather than performing a targeted
collapse-and-promote-remaining-child operation. There is no code that
walks up from a removed leaf and replaces a degenerate single-child
parent with its remaining child in place.

## Q4: How does directional move decide "nothing in that direction"?

Move is **not** tree-relative (no walk to a sibling/cousin node). It is
implemented as geometric nearest-neighbor search over the flat leaf list
of the scope's topology:

- `findNeighborLeaf(leaves, current, direction)` - `logic.ts:183-206` -
  iterates all leaves, computes a facing-edge `neighborDistance`
  (`logic.ts:211-251`) per candidate, and returns the closest one on the
  requested side, or `null` if none qualifies (no candidate is strictly
  on that side with perpendicular-interval overlap; no wraparound).
- Call site: `controller.ts:2518`, inside the move handler starting
  around `controller.ts:2460`. On `null`:
  ```
  const targetLeaf = findNeighborLeaf(candidates, source.leaf, direction);
  if (targetLeaf === null) {
      this.diagnostic("move-rejected:no-target");
      return;
  }
  ```
  (`controller.ts:2518-2521`) - the handler simply returns, a no-op.

Focus-in-direction uses the same primitive: `findNeighborLeaf` at
`controller.ts:2424` inside the focus handler, with an equivalent
`null` -> `diagnostic("focus-rejected:...")` -> return pattern nearby
(`controller.ts:2391`).

## Q5: Is orientation per-node, and can it change in place?

Orientation (`layoutDirection`) is a per-node property on the native
`CustomTile` type, but it is declared **`readonly`** in this project's
own type surface: `readonly layoutDirection: LayoutDirection;`
(`kwin-globals.d.ts:221`), alongside `readonly layoutDirectionChanged:
Signal1<LayoutDirection>` (`:222`), which implies KWin notifies on
change but this project's declared surface gives it no setter.

No code in `kwin/src/` assigns to `.layoutDirection` (confirmed by
searching all `layoutDirection` occurrences in `controller.ts` - every
one is a read/comparison: `controller.ts:1566`, `:2659`, `:2758`,
`:7306`, `:7308`). Orientation is only ever set implicitly at creation
time via `CustomTile.split(direction)` (`kwin-globals.d.ts:225`, called
at `layout-executor.ts:149`) and never changed afterward. Whether KWin's
native C++ tile actually supports in-place orientation change is outside
this repo (not established here); this project's own code neither
attempts it nor exposes a way to.

## Summary of open questions / not established here

- Native KWin C++ behavior (e.g. whether `CustomTile::remove()` itself
  ever collapses a single-child parent under some conditions, or whether
  `layoutDirection` is mutable at the C++/QML level) is outside this
  repo and not verified by this investigation - only this project's own
  assumptions and workarounds around it are documented above.
